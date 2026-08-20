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
import os
import sys

import numpy as np
from PIL import Image

import build_sheet as bs
from imagegen import status as _announce   # one status hook for the whole pipeline


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


# SAME FOOT TWICE. In a front or back row the two step frames are opposite
# steps, so their leg bands are near MIRROR IMAGES of each other. When a
# generator draws one step pose and then repeats it, the bands match better
# UN-mirrored — the character then walks with the same foot twice and the
# other leg never moves, which is exactly what it looks like.
#
# Compared on the bottom 22% of the silhouette only (the legs), normalised to
# 48x16 so independent crops don't matter. The number is
# diff(f0, mirror(f2)) / diff(f0, f2): below 1.0 the steps alternate, above
# 1.0 the same foot is up twice. Measured:
#   dog-punk back v5    0.25   <- alternates
#   dog-punk back v12   0.74   <- alternates, the row that shipped
#   dog-punk back v7    0.84   <- alternates
#   dog-punk back v6    1.00   <- ambiguous (both boots flat in every frame)
#   dog-punk back v11   1.02   <- ambiguous
#   dog-punk front v3   1.68   <- same foot twice; shipped, and spotted by eye
#   dog-punk front v5   1.85   <- same foot twice
#   dog-punk back v10   2.00   <- same foot twice
# The gate sits at 1.10, so the ambiguous rows pass: a row is failed only when
# the mirrored comparison is clearly WORSE, which cannot happen when the steps
# are genuine opposites.
#
# ONLY for front and back rows, which is why it is opt-in (--mirrored). A SIDE
# row scores 1.63 while being perfectly correct: mirroring a right-facing
# profile turns it into a left-facing one, so the comparison is meaningless
# there. Its steps are checked by eye, as a fore/aft split always has been.
MIRROR_STEP_MAX = 1.10


def _leg_band(im, frac=0.22, size=(48, 16)):
    """The bottom slice of a frame's silhouette, normalised for comparison."""
    a = np.array(im.convert('RGBA'))
    alpha = a[:, :, 3] > 0
    ys, xs = np.nonzero(alpha)
    if len(ys) == 0:
        return None
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    band = alpha[y1 - int((y1 - y0 + 1) * frac):y1 + 1, x0:x1 + 1]
    if band.size == 0:
        return None
    im8 = Image.fromarray((band * 255).astype('uint8')).resize(size, Image.NEAREST)
    return np.array(im8) > 127


def _same_foot_twice(f0, f2):
    """None if undecidable, else (ratio, is_same_foot)."""
    a, b = _leg_band(f0), _leg_band(f2)
    if a is None or b is None:
        return None
    plain = float(np.abs(a.astype(int) - b.astype(int)).mean())
    mirror = float(np.abs(a.astype(int) - b[:, ::-1].astype(int)).mean())
    if plain == 0:
        return None
    ratio = mirror / plain
    return ratio, ratio > MIRROR_STEP_MAX


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


def check_raw(path, frames_expected, blobs, walk, tol, mirrored=False, steps_built=False):
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
        if mirrored:
            verdict = _same_foot_twice(cut[0], cut[2])
            if verdict and verdict[1]:
                msg = (
                    f'{path}: SAME FOOT TWICE — the two step frames are not opposite steps '
                    f'(mirrored/plain leg diff {verdict[0]:.2f}, must be under {MIRROR_STEP_MAX}). '
                    'The same boot is lifted in both, so one leg never moves. Regenerate asking '
                    "for frame 3 to be frame 1's mirror image from the waist down, naming the "
                    "legs by the VIEWER'S left and right.")
                if steps_built:
                    # A WARNING, not a failure, when the caller is going to
                    # BUILD both step frames out of the standing frame
                    # (build_sheet.py --build-steps 0,2), which is the standard
                    # recipe for every front and back row. The frames this
                    # check looks at are then thrown away before anything
                    # ships, so failing on them deletes a row for a defect that
                    # cannot reach the game — and CHARACTER_SHEETS.md openly
                    # says the generator draws these two badly and that only
                    # the middle frame has to land. Two perfectly usable rows
                    # were binned exactly that way, at a generation each,
                    # before this flag existed. The shipped sheet is still
                    # gated: check_sheet runs the same comparison on the built
                    # rows, where the steps are real.
                    print(f'WARNING (steps will be rebuilt): {msg}', file=sys.stderr)
                else:
                    problems.append(msg)
    return problems


# COLOUR DRIFT BETWEEN ROWS. Each row of a sheet is a separate generation, so
# each one picks its own shade of the character — and the palette snap does NOT
# save you: it maps every pixel to the NEAREST lockedPalette colour, and a
# palette wide enough to hold fur, fur shadow and brown boots contains both a
# light orange and a mid brown, so a row drawn one step darker snaps to a
# different entry and ships as a different-coloured animal. Dog Punk shipped a
# hero whose front and back rows were light orange (#f0a35a, 17% of the row)
# and whose side row was mid brown (#f0a35a: 4.2%) — she changed colour when
# you walked left, and no check saw it for a dozen rounds.
#
# WARNS, never fails, and the reason is measured rather than assumed. Two
# obvious metrics were tried first and BOTH rank the corrected sheet as worse
# than the broken one, because rows legitimately show different amounts of each
# material (a back view is mostly jacket, a side view mostly head and snout):
#   mean colour of the row in Lab, dE between rows: broken sheet 9.0/10.1/13.9,
#     corrected sheet 6.9/11.4/16.8  <- worse on the pair that matters
#   histogram overlap between rows:  broken 0.54/0.73/0.55,
#     corrected 0.76/0.69/0.61       <- also worse on one pair
# What does discriminate is a colour that carries a LOT of one row and is
# essentially absent from another. Measured shares, biggest offender per sheet:
#   dog-punk hero (broken)  #f0a35a  17%  vs  4.2%   ratio 0.25  <- the bug
#   dog-punk rat (shipped)  #8a7a62  21%  vs  1.6%   ratio 0.08  <- real drift
#   dog-punk hero (fixed)   #3d434f  11%  vs  2.4%   ratio 0.22  <- legitimate:
#     a jacket highlight visible from behind and not from the front
# So the trigger is 15% of a row (above the legitimate case) with under 30% of
# that share elsewhere (above the two real ones). It stays a warning because
# that last line is exactly the kind of false positive a gate must not have.
DRIFT_SHARE = 0.15
DRIFT_RATIO = 0.30


def _colour_drift(path, a, rows, ch):
    hist = []
    for r in range(rows):
        px = a[r * ch:(r + 1) * ch][a[r * ch:(r + 1) * ch][:, :, 3] > 128][:, :3]
        if not len(px):
            return []
        cols, counts = np.unique(px, axis=0, return_counts=True)
        hist.append({tuple(int(v) for v in c): float(n) / counts.sum()
                     for c, n in zip(cols, counts)})
    out = []
    for i in range(rows):
        for j in range(rows):
            if i == j:
                continue
            for col, share in hist[i].items():
                # The OUTLINE is excluded. Every sprite is drawn in the same
                # near-black, but how much of a frame is outline depends on how
                # busy the silhouette is, so it swings 28% to 8% between rows of
                # a perfectly consistent sheet and drowns the real findings.
                if max(col) < 40:
                    continue
                other = hist[j].get(col, 0.0)
                if share >= DRIFT_SHARE and other < DRIFT_RATIO * share:
                    out.append(
                        f'{path}: COLOUR DRIFT — row {i} is #%02x%02x%02x over {share * 100:.0f}%% '
                        'of its pixels and row %d is only %.1f%%. The rows were drawn as separate '
                        'generations and landed in different colour worlds, so the character '
                        'changes colour when it turns. Fix it in the PROMPT: put the exact hex per '
                        'material in the game\'s art-style.json "lockedColours" and regenerate the '
                        'odd row — the palette snap cannot fix this, it only maps each pixel to the '
                        'nearest allowed colour. (A WARNING: a row can legitimately show more of a '
                        'material than another.)' % (col + (j, other * 100)))
    return out


def check_sheet(path, style, rows, cols):
    problems, soft = [], []
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

    # SAME FOOT TWICE, on the front and back rows. Rows 0 and 2 of a 3x3 sheet
    # are the camera-on views, whose two step frames must be mirror opposites;
    # the side row (1) is skipped — see the note on MIRROR_STEP_MAX — and an
    # attack sheet is skipped by name, its outer frames being wind-up and
    # recover rather than steps.
    #
    # WARNS rather than fails, unlike the same check in raw mode. A built sheet
    # carries no record of what its columns mean: Dog Punk's rat sheet is the
    # legacy [idle, walk, attack] layout, where "the two step frames" do not
    # exist and the number is meaningless. In raw mode the caller passes
    # --mirrored, which IS that assertion, so there it fails the build.
    if rows == 3 and cols == 3 and 'attack' not in os.path.basename(path):
        for r, name in ((0, 'front'), (2, 'back')):
            fr = [Image.fromarray(a[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]) for c in (0, 2)]
            verdict = _same_foot_twice(*fr)
            if verdict and verdict[1]:
                soft.append(
                    f'{path}: SAME FOOT TWICE in the {name} row — its two step frames are not '
                    f'opposite steps (mirrored/plain leg diff {verdict[0]:.2f}, must be under '
                    f'{MIRROR_STEP_MAX}). The same boot is lifted in both, so one leg never '
                    'moves. Rebuild that row with build_sheet.py --build-steps, which '
                    'constructs both steps from the standing frame. (A WARNING, not a failure: '
                    'a sheet cannot say whether its columns are [step, NEUTRAL, step] or the '
                    'legacy [idle, walk, attack], and on a legacy sheet this means nothing.)')

    if rows > 1:
        soft += _colour_drift(path, a, rows, ch)

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
    return problems, soft


# See the CROPPED check in check_frames for how this was calibrated.
FRAME_ASPECT_SPREAD = 1.45


def check_frames(art_dir, char_id, dirs):
    """The walk-cycle rules, applied to individual frame files.

    Returns (hard, soft). A missing or duplicated frame is unambiguous and
    fails the build. "No neutral" is a judgment call on a fuzzy metric — it
    is reported as a warning so a borderline-but-fine set can't block a
    deploy, which matters when the gate runs on every push.
    """
    import os
    problems, soft = [], []
    shapes = []          # (aspect, label, w, h) for every frame in the whole set
    for d in dirs:
        paths = [os.path.join(art_dir, f'{char_id}_{d}_{n}.png') for n in (0, 1, 2)]
        missing = [p for p in paths if not os.path.exists(p)]
        if missing:
            problems.append(
                f'{char_id} ({d}): MISSING FRAMES — ' + ', '.join(os.path.basename(m) for m in missing)
                + '. A partial set animates as a character that flickers or freezes.')
            continue
        fr = [Image.open(p).convert('RGBA') for p in paths]
        for n, im in enumerate(fr):
            shapes.append((im.width / im.height, f'{d}_{n}', im.width, im.height))
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

    # CROPPED — the whole set is one character standing on one floor, tightly
    # trimmed, so every frame should have roughly the same width:height. A
    # frame far wider than its siblings is one where part of the character
    # fell outside the image.
    #
    # This is the check that would have caught May. Her nine frames shipped
    # with the crown of her head sliced off in every front and side pose and
    # NO HEAD AT ALL in the three back ones — just a collar and a pair of
    # floating antler wisps — and nothing failed, because a set can be
    # complete, distinct and correctly posed while still being decapitated.
    # It was found by a person looking at the screen and asking why May had
    # half a face, which is exactly the failure mode a forgiving runtime is
    # supposed to have a build-time check beside.
    #
    # Calibrated against the real set (CLAUDE.md: record the numbers). Every
    # healthy character here spreads 1.09 (Kat) to 1.39 (the devil, whose
    # side profile is genuinely much narrower than his front view). May's
    # broken set spread 1.55 — her headless up_1 is 127x148, ar 0.86, against
    # a left_2 of 120x217, ar 0.55. 1.45 sits between the two with room for a
    # character whose profile is narrower still.
    if len(shapes) >= 6:
        shapes.sort()
        lo, hi = shapes[0], shapes[-1]
        spread = hi[0] / lo[0] if lo[0] else 0
        if spread > FRAME_ASPECT_SPREAD:
            problems.append(
                f'{char_id}: CROPPED — {hi[1]} is far wider for its height than {lo[1]} '
                f'(spread {spread:.2f}, limit {FRAME_ASPECT_SPREAD}). '
                f'{hi[1]} is {hi[2]}x{hi[3]} (ratio {hi[0]:.2f}), {lo[1]} is {lo[2]}x{lo[3]} '
                f'(ratio {lo[0]:.2f}). Every frame is the same character trimmed the same '
                'way, so one that is much squatter than the rest has had part of the '
                'character — usually the top of the head — cut off by the frame edge.')
    return problems, soft


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='mode', required=True)

    r = sub.add_parser('raw', help='check a generated row before cutting')
    r.add_argument('image')
    r.add_argument('--frames', type=int, default=3)
    r.add_argument('--blobs', action='store_true')
    r.add_argument('--walk', action='store_true', help='also require a distinct neutral middle frame')
    r.add_argument('--mirrored', action='store_true',
                   help='front/back row: the two step frames must be opposite (mirrored) steps')
    r.add_argument('--steps-built', action='store_true',
                   help='the two step frames will be BUILT from the standing frame by '
                        'build_sheet.py --build-steps, so a same-foot-twice verdict on them '
                        'warns instead of failing (they never reach the game)')
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
        problems = check_raw(args.image, args.frames, args.blobs, args.walk, args.tol,
                             args.mirrored, args.steps_built)
    elif args.mode == 'frames':
        problems, soft = check_frames(args.art_dir, args.char_id, args.dirs.split(','))
        for w in soft:
            print(f'WARNING {w}', file=sys.stderr)
    else:
        problems, soft = check_sheet(args.image, args.style, args.rows, args.cols)
        for w in soft:
            print(f'WARNING {w}', file=sys.stderr)

    subject = getattr(args, 'image', None) or args.char_id
    for p in problems:
        print(p, file=sys.stderr)
    if problems:
        print(f'{len(problems)} problem(s).', file=sys.stderr)
        _announce(f'checked {subject} — FAILED ({len(problems)} problem(s))')
        sys.exit(1)
    _announce(f'checked {subject} — passed')
    print(f'{subject}: OK')


if __name__ == '__main__':
    main()
