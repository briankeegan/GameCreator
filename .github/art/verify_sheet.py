#!/usr/bin/env python3
"""Check generated art for the failures that actually happen, before it ships.

Every one of these checks exists because the failure it catches wasted at
least one generation in this repo:

  CLIPPED      the subject runs off the edge of the image. The single most
               common generator failure — a 3x3 grid on a square canvas laid
               out correctly and then cut the bottom row off; a rat row lost
               its tail at x=0. Caught by looking for opaque pixels on the
               border after the background is keyed.
  FRAME COUNT  the row didn't come back with the number of sprites asked for.
               A tall canvas silently dropped a 3-column layout to 2 columns,
               and the cutter happily produced a 2-frame "walk cycle".
  IDENTICAL    two frames that are supposed to be different poses are the
               same drawing. A "walk cycle" of three near-identical frames
               animates as a character standing still while sliding.
  NO NEUTRAL   for a walk row, the middle frame is supposed to be a distinctly
               different (standing) pose. If it is as similar to frame 0 as
               frame 0 is to frame 2, there is no real idle frame and the
               character freezes mid-stride when it stops — the exact bug
               reported on Dog Punk.
  SPECKS       loose fragments floating beside the character — background
               that survived keying, or bits drawn detached. Only catches
               fragments that are genuinely SEPARATE from the silhouette:
               debris the generator drew touching a leg is part of the shape
               as far as any connectivity test is concerned, and stays a
               judgment call. Ditto "the legs are a muddle" — see the note
               below on what this tool does not check.
  PALETTE      (shipped sheets) a pixel outside the game's lockedPalette,
               meaning something bypassed the cutter.

What it deliberately does NOT check: whether the view is right (is the side
row actually a side profile?), or whether the art is good. Those need eyes.
This is the mechanical half, so the eyes are spent on the half that needs
them.

Which checks apply depends on how a game ships its art, so there are three
modes rather than one:

  raw     a freshly generated row, before cutting (any game)
  sheet   a built sprite sheet, games/<id>/<char>_sheet.png (Dog Punk shape)
  frames  a set of individual <id>_<dir>_<n>.png files (Newsey shape) — the
          same walk-cycle rules, checked on files instead of cells, because a
          sheet-shaped gate silently covers nothing in a game that doesn't
          use sheets

Usage:
  verify_sheet.py raw    <image.png> [--frames 3] [--blobs] [--walk]
  verify_sheet.py sheet  <sheet.png> --style games/<id>/art-style.json
                         [--rows N] [--cols N]
  verify_sheet.py frames <art-dir> <char-id> [--dirs down,left,up]

Exits non-zero if any check fails, printing one line per problem.
"""

import argparse
import json
import sys

import numpy as np
from PIL import Image

import build_sheet as bs


def _norm(im, size=(64, 64)):
    """Frames come out at different crops; compare them on equal footing."""
    return np.array(im.convert('RGBA').resize(size, Image.LANCZOS)).astype(np.int16)


def _diff(a, b):
    return float(np.abs(_norm(a) - _norm(b)).mean())


# "How far the middle frame sits from the nearest step" over "how far the two
# steps sit from each other". A real neutral is a genuinely different pose and
# scores high; a middle frame that is just another stride scores low.
# Measured, not guessed:
#   synthetic ideal [step, NEUTRAL, step]        1.09
#   nella_human left (verified correct by eye)   0.85   <- real art, must pass
#   nella down                                   0.85
#   nella_human up                               0.70   <- borderline
#   [neutral, step, attack]  (middle is a step)  0.62   <- must fail
#   [idle, run, pounce]      (middle is a step)  0.65   <- must fail
# 0.85 was tried first and rejected: it failed nella_human's left set, which
# IS a correct step/neutral/step. Real neutrals score far lower than a
# synthetic ideal, so the threshold sits just above the known-bad pair.
NEUTRAL_RATIO = 0.70


def _components(mask):
    """Sizes of the connected opaque regions in a frame."""
    from collections import deque
    h, w = mask.shape
    seen = np.zeros((h, w), bool)
    sizes = []
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or seen[sy, sx]:
                continue
            seen[sy, sx] = True
            q = deque([(sy, sx)])
            n = 0
            while q:
                y, x = q.popleft()
                n += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            sizes.append(n)
    return sizes


def check_raw(path, frames_expected, blobs, walk, tol):
    problems = []
    img = bs.key_background(path, tol=tol)
    a = np.array(img)
    alpha = a[:, :, 3] > 0
    if not alpha.any():
        return [f'{path}: nothing left after keying the background — is the background flat?']

    # CLIPPED: subject pixels sitting on the image border.
    edges = {
        'top': alpha[0, :].sum(), 'bottom': alpha[-1, :].sum(),
        'left': alpha[:, 0].sum(), 'right': alpha[:, -1].sum(),
    }
    touching = {k: int(v) for k, v in edges.items() if v > 0}
    if touching:
        problems.append(
            f'{path}: CLIPPED — subject touches the image edge ('
            + ', '.join(f'{k}: {v}px' for k, v in touching.items())
            + '). Regenerate asking for a wider empty margin; the bottom edge is the usual one.')

    # FRAME COUNT
    cut = bs.frames_by_blob(img, want=frames_expected) if blobs else bs.frames_by_gutter(img, 0)
    if len(cut) != frames_expected:
        problems.append(
            f'{path}: FRAME COUNT — found {len(cut)} sprite(s), expected {frames_expected}. '
            '(A tall canvas tends to drop a column; generate one row per image on a landscape canvas.)')
        return problems  # the checks below are meaningless without the right frames

    # IDENTICAL frames
    for i in range(len(cut) - 1):
        for j in range(i + 1, len(cut)):
            d = _diff(cut[i], cut[j])
            if d < 3.0:
                problems.append(
                    f'{path}: IDENTICAL — frames {i} and {j} are the same drawing (diff {d:.1f}); '
                    'they are supposed to be different poses.')

    # SPECKS: a frame should be essentially one connected shape. Small
    # detached blobs are keying leftovers or drawing debris. The threshold is
    # generous (2% of the biggest piece) so a legitimately separate element —
    # a thrown weapon, a detached ear tip — is not flagged, while the pixel
    # confetti that shipped between Beverly's legs is.
    for idx, fr in enumerate(cut):
        comps = _components(np.array(fr)[:, :, 3] > 0)
        if len(comps) > 1:
            big = max(comps)
            # A size WINDOW, not just an upper bound. Below 0.2% of the main
            # shape a fragment is a pixel or two — invisible once the sprite is
            # drawn at 64px, and flagging it just trains people to ignore the
            # checker. Above 2% it is probably a real detached element.
            junk = [c for c in comps if c != big and big * 0.002 <= c <= big * 0.02]
            if junk:
                shown = ', '.join(f'{j}px' for j in sorted(junk, reverse=True)[:4])
                problems.append(
                    f'{path}: SPECKS — frame {idx} has {len(junk)} loose fragment(s) ({shown}) '
                    'detached from the character. Keying leftovers or drawing debris; in-game they '
                    'read as dirt around the sprite.')

    # NO NEUTRAL: the middle frame must stand apart from the two steps.
    if walk and len(cut) == 3:
        d01, d12, d02 = _diff(cut[0], cut[1]), _diff(cut[1], cut[2]), _diff(cut[0], cut[2])
        if min(d01, d12) < d02 * NEUTRAL_RATIO:
            problems.append(
                f'{path}: NO NEUTRAL — the middle frame is not a distinct standing pose '
                f'(middle-vs-steps {d01:.1f}/{d12:.1f}, steps-vs-each-other {d02:.1f}). '
                'Idle will look like walking on the spot.')
    return problems


def check_sheet(path, style, rows, cols):
    problems = []
    a = np.array(Image.open(path).convert('RGBA'))
    h, w = a.shape[:2]
    # Every shipped sheet is laid out in CELL-sized cells, so the geometry can
    # be inferred — a repo-wide gate can then check every sheet without a
    # per-file config to keep in sync (and to forget to update).
    if rows is None:
        rows = max(1, h // bs.CELL)
    if cols is None:
        cols = max(1, w // bs.CELL)
    ch, cw = h // rows, w // cols

    for r in range(rows):
        for c in range(cols):
            cell = a[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
            if not (cell[:, :, 3] > 0).any():
                problems.append(f'{path}: EMPTY CELL at row {r}, col {c} — the cutter produced nothing there.')

    pal = bs.load_palette(style) if style else None
    if pal is not None:
        px = a[a[:, :, 3] > 0][:, :3].astype(np.int32)
        if len(px):
            uniq = np.unique(px.reshape(-1, 3), axis=0)
            allowed = {tuple(int(v) for v in row) for row in pal}
            stray = [tuple(int(v) for v in u) for u in uniq if tuple(int(v) for v in u) not in allowed]
            if stray:
                shown = ', '.join('#%02x%02x%02x' % s for s in stray[:6])
                problems.append(
                    f'{path}: PALETTE — {len(stray)} colour(s) outside lockedPalette ({shown}'
                    + (', …' if len(stray) > 6 else '') + '). Something bypassed the cutter.')
    return problems


def check_frames(art_dir, char_id, dirs):
    """The walk-cycle rules, applied to individual frame files.

    Returns (hard, soft). A missing or duplicated frame is unambiguous and
    fails the build. "No neutral" is a judgment call on a fuzzy metric — it
    is reported as a warning so a borderline-but-fine set can't block a
    deploy, which matters when the gate runs on every push.
    """
    import os
    problems, soft = [], []
    for d in dirs:
        paths = [os.path.join(art_dir, f'{char_id}_{d}_{n}.png') for n in (0, 1, 2)]
        missing = [p for p in paths if not os.path.exists(p)]
        if missing:
            problems.append(
                f'{char_id} ({d}): MISSING FRAMES — ' + ', '.join(os.path.basename(m) for m in missing)
                + '. A partial set animates as a character that flickers or freezes.')
            continue
        fr = [Image.open(p).convert('RGBA') for p in paths]
        for i in range(3):
            for j in range(i + 1, 3):
                if _diff(fr[i], fr[j]) < 3.0:
                    problems.append(f'{char_id} ({d}): IDENTICAL — frames {i} and {j} are the same drawing.')
        d01, d12, d02 = _diff(fr[0], fr[1]), _diff(fr[1], fr[2]), _diff(fr[0], fr[2])
        if min(d01, d12) < d02 * NEUTRAL_RATIO:
            soft.append(
                f'{char_id} ({d}): NO NEUTRAL — frame 1 is not a distinct standing pose '
                f'(middle-vs-steps {d01:.1f}/{d12:.1f}, steps-vs-each-other {d02:.1f}). '
                'Idle will look like walking on the spot.')
    return problems, soft


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='mode', required=True)

    r = sub.add_parser('raw', help='check a generated row before cutting')
    r.add_argument('image')
    r.add_argument('--frames', type=int, default=3)
    r.add_argument('--blobs', action='store_true')
    r.add_argument('--walk', action='store_true', help='also require a distinct neutral middle frame')
    r.add_argument('--tol', type=int, default=22)

    s = sub.add_parser('sheet', help='check a built sheet')
    s.add_argument('image')
    s.add_argument('--style')
    s.add_argument('--rows', type=int, default=None, help='default: inferred from the 256px cell size')
    s.add_argument('--cols', type=int, default=None)

    f = sub.add_parser('frames', help='check a set of individual <id>_<dir>_<n>.png frames')
    f.add_argument('art_dir')
    f.add_argument('char_id')
    f.add_argument('--dirs', default='down,left,up')

    args = ap.parse_args()
    if args.mode == 'raw':
        problems = check_raw(args.image, args.frames, args.blobs, args.walk, args.tol)
    elif args.mode == 'frames':
        problems, soft = check_frames(args.art_dir, args.char_id, args.dirs.split(','))
        for w in soft:
            print(f'WARNING {w}', file=sys.stderr)
    else:
        problems = check_sheet(args.image, args.style, args.rows, args.cols)

    for p in problems:
        print(p, file=sys.stderr)
    if problems:
        print(f'{len(problems)} problem(s).', file=sys.stderr)
        sys.exit(1)
    print(f'{getattr(args, "image", None) or args.char_id}: OK')


if __name__ == '__main__':
    main()
