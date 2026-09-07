#!/usr/bin/env python3
"""Turn raw generated art into a shipped sprite sheet.

WHY THIS EXISTS
---------------
Generating one sprite per image does not work. Each image is drawn from
scratch, so the character's colours, proportions and pixel scale drift between
frames — Dog Punk shipped a hero whose front view was an orange dog with a
magenta mohawk and whose side view was a tan dog with a pink beret, and
walking alternated the two. Regenerating single frames never converges,
because each new frame just drifts somewhere else.

The fix is to generate a WHOLE ROW of frames (idle, walk, attack) in ONE
image, so they share a palette and a scale by construction, and then do the
mechanical part here rather than asking the model for it:

  1. Key the flat background out to real transparency. (Asking the image
     generator for a transparent background reliably returns a beige or
     gradient wash instead, so we ask for flat white and cut it ourselves.)
  2. Clear background trapped INSIDE the silhouette — between the legs, in the
     crook of an arm — which a flood from the border can never reach.
  3. Cut the row into frames, either at empty gutters or, when sprites overlap
     horizontally, as connected blobs masked to themselves.
  4. Scale every frame in a row by ONE factor taken from its idle frame, so the
     character cannot change size mid-animation.
  5. Snap to a chunky art-pixel grid and harden the alpha, so it reads as
     pixel art rather than a smooth image that has been shrunk.
  6. Map every pixel to the game's lockedPalette, so a character and its
     enemies cannot end up in different colour worlds.
  7. Lay the frames out on a common foot baseline in fixed-size cells.

Usage:
  build_sheet.py --style games/<id>/art-style.json --out games/<id>/hero_sheet.png \
                 --row raw_front.png --row raw_side.png:1 --row raw_back.png \
                 [--body-height 168] [--blobs] [--cols 3]

  --row FILE[:N][@H]  one output row per flag, in order. N picks which row of
                  a multi-row raw image to use (default 0). H overrides
                  --body-height for THAT row, which matters whenever a
                  character is a different height from different angles: a
                  four-legged animal is tall from the front and long-and-low
                  from the side, so scaling both rows to one height makes the
                  side view look like a different, much bigger animal.
  --blobs         cut frames as connected blobs instead of at empty gutters;
                  use when sprites in the raw image overlap horizontally.
  --body-height   height in pixels of the row's idle frame inside its cell.
                  This is how relative size between characters is expressed:
                  keep the cell and the pixel grid identical everywhere, give a
                  small enemy a smaller body height, and draw every character
                  at one on-screen cell size so their pixels match exactly.
"""

import argparse
import json
import sys
from collections import deque

import numpy as np
from PIL import Image

CELL = 256      # cell size in the output sheet
PIXEL = 4       # art-pixel size => CELL / PIXEL "real" pixels per cell
BASELINE = 236  # y of the feet inside a cell


# ---------------------------------------------------------------- background

def key_background(path, tol=22):
    """Flat generated background -> transparency."""
    im = Image.open(path).convert('RGBA')
    a = np.array(im).astype(np.int16)
    h, w = a.shape[:2]
    bg = np.median(np.concatenate([a[0, :, :3], a[-1, :, :3], a[:, 0, :3], a[:, -1, :3]]), axis=0)
    close = (np.abs(a[:, :, :3] - bg).max(axis=2) <= tol)

    # Flood from the border, so interior light pixels (eye whites, a blade)
    # survive: only background CONNECTED to an edge is removed.
    seen = np.zeros((h, w), bool)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if close[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if close[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and close[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))

    # Background TRAPPED inside the silhouette stays behind as opaque white
    # blobs in the middle of the character. Clear any sizeable one; the size
    # floor keeps small light details (an eye, a tooth) safe.
    min_hole = int(0.0015 * h * w)
    holes = np.zeros((h, w), bool)
    for sy in range(h):
        for sx in range(w):
            if not close[sy, sx] or seen[sy, sx] or holes[sy, sx]:
                continue
            comp = [(sy, sx)]
            holes[sy, sx] = True
            qq = deque([(sy, sx)])
            while qq:
                y, x = qq.popleft()
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and close[ny, nx] and not seen[ny, nx] and not holes[ny, nx]:
                        holes[ny, nx] = True
                        qq.append((ny, nx))
                        comp.append((ny, nx))
            if len(comp) < min_hole:
                for y, x in comp:
                    holes[y, x] = False

    out = np.array(im)
    out[seen | holes] = (0, 0, 0, 0)
    return Image.fromarray(out)


# ------------------------------------------------------------------- cutting

def bands(mask, min_gap=6, min_run=20):
    """Runs of rows containing any opaque pixel (transpose for columns)."""
    occupied = mask.any(axis=1)
    runs, start, gap = [], None, 0
    for i, v in enumerate(occupied):
        if v:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                if i - gap - start >= min_run:
                    runs.append((start, i - gap))
                start = None
    if start is not None and len(occupied) - start >= min_run:
        runs.append((start, len(occupied)))
    return runs


def frames_by_gutter(img, row_index=0):
    a = np.array(img)[:, :, 3] > 0
    rows = bands(a)
    if not rows:
        raise SystemExit('no sprites found — is the background flat and the art inside the frame?')
    if row_index >= len(rows):
        raise SystemExit(f'raw image has {len(rows)} row(s); asked for row {row_index}')
    r0, r1 = rows[row_index]
    return [img.crop((c0, r0, c1, r1)) for c0, c1 in bands(a[r0:r1].T)]


def frames_by_blob(img, want=3, min_frac=0.02):
    """Cut frames as connected blobs.

    The gutter split needs an empty column between sprites; when the generator
    lets one sprite's tail reach back under its neighbour there is none, and
    two frames merge into one. Each sprite is a single connected shape, so
    label the blobs, keep the biggest, and mask each crop to its own blob so a
    neighbour overlapping the bounding box is not dragged in with it.
    """
    a = np.array(img)
    mask = a[:, :, 3] > 0
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    boxes = []
    n = 0
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or lab[sy, sx]:
                continue
            n += 1
            lab[sy, sx] = n
            q = deque([(sy, sx)])
            x0 = x1 = sx
            y0 = y1 = sy
            size = 0
            while q:
                y, x = q.popleft()
                size += 1
                x0, x1 = min(x0, x), max(x1, x)
                y0, y1 = min(y0, y), max(y1, y)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = n
                        q.append((ny, nx))
            boxes.append((size, x0, y0, x1, y1, n))
    if not boxes:
        raise SystemExit('no sprites found in the raw image')
    boxes.sort(key=lambda b: -b[0])
    keep = [b for b in boxes[:want] if b[0] >= min_frac * boxes[0][0]]
    keep.sort(key=lambda b: b[1])
    out = []
    for _, x0, y0, x1, y1, blob in keep:
        sub = a[y0:y1 + 1, x0:x1 + 1].copy()
        sub[lab[y0:y1 + 1, x0:x1 + 1] != blob] = (0, 0, 0, 0)
        out.append(Image.fromarray(sub))
    return out


# ---------------------------------------------------------------- normalising

def strip_baseline(im, min_rows=4):
    """Drop a drawn ground line/platform from under a sprite's feet.

    The prompts forbid one and generators keep drawing one anyway — a
    character standing on nothing seems to read as wrong to them. It has come
    back three times now: dark (keyed away by luck), and pale grey twice
    (survived keying and shipped as a bar under the boots).

    It cannot be found by connectivity — it touches the boots — and not by
    width either: this one was NARROWER than the character's shoulders, so
    "wider than the body" missed it. What identifies it is that the bottom
    band is a nearly UNIFORM PALE SLAB spanning most of the sprite's width,
    sitting under feet that are a completely different colour. So: walk up
    from the bottom while each row is mostly one pale colour and wide, and cut
    there.

    Guard: only strips a band at least `min_rows` tall, so a pale sole or a
    light shoe edge is never eaten. A character in white boots would need
    --keep-baseline.

    A DARK bar is handled too, on the same shape test but a much stricter
    width (85% instead of 40%): the back-view rows came back standing on a
    solid
    black line, which survived keying because it is not pale, and which then
    welded the two legs together — enough to defeat the gap detection that
    build_steps needs. A boot sole is dark and near-uniform as well, but it is
    one boot wide; the bar spans the whole sprite.
    """
    a = np.array(im)
    alpha = a[:, :, 3] > 0
    h, w = alpha.shape
    if h < 20:
        return im
    max_w = alpha.sum(axis=1).max() or 1

    def scan(pale_side):
        want_w = 0.4 if pale_side else 0.85
        cut = h
        for y in range(h - 1, int(h * 0.75), -1):
            row = a[y][alpha[y]]
            if len(row) < max_w * want_w:
                break
            rgb = row[:, :3].astype(np.int32)
            luma = rgb.mean(axis=1)
            hit = luma > 175 if pale_side else luma < 70
            if hit.mean() < 0.75:
                break
            # near-uniform: the matching pixels are all about the same colour
            if rgb[hit].std(axis=0).mean() > 14:
                break
            cut = y
        return cut

    cut = min(scan(True), scan(False))
    if cut >= h - min_rows:
        return im
    print(f'  stripped a {h - cut}px ground line from a frame')
    return im.crop((0, 0, w, cut))


def trim(im):
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def pixelate(im, target_h):
    w, h = im.size
    sw = max(1, round(w * target_h / h / PIXEL))
    sh = max(1, round(target_h / PIXEL))
    small = im.resize((sw, sh), Image.LANCZOS)
    a = np.array(small)
    # Hard alpha: a pixel sprite has no half-transparent fringe.
    a[:, :, 3] = np.where(a[:, :, 3] > 110, 255, 0)
    return Image.fromarray(a).resize((sw * PIXEL, sh * PIXEL), Image.NEAREST)


def load_palette(style_path):
    hexes = json.load(open(style_path)).get('lockedPalette') or []
    if not hexes:
        return None
    return np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in hexes], dtype=np.int32)


def snap_palette(im, pal):
    """Map every pixel to its nearest locked-palette colour."""
    a = np.array(im).astype(np.int32)
    # int32, not int16: a squared channel difference reaches 65025 and three of
    # them sum past 32767, which wraps and maps every pixel to nonsense.
    d = ((a[:, :, None, :3] - pal[None, None, :, :]) ** 2).sum(axis=3)
    a[:, :, :3] = pal[d.argmin(axis=2)]
    return Image.fromarray(a.astype('uint8'))


# THE STEP FRAMES OF A FRONT OR BACK ROW ARE MIRROR OPPOSITES, and the
# generator will not draw them that way. Six consecutive front rows for Dog
# Punk came back with the SAME boot lifted in both step frames — the character
# then walks with one leg while the other never moves, which is what
# "is the same foot moving twice?" looks like. Naming the feet, naming the
# viewer's left and right, and asking outright for "frame 3 is frame 1
# mirrored" all failed; it is not a prompt problem.
#
# So the row is constructed instead of asked for. Frame 2 keeps frame 0's body
# and gets frame 0's LEGS FLIPPED left-to-right. Everything above the leg band
# is untouched, which also satisfies the standard's "same head and torso in
# every frame" rule, and keeps a hand-held weapon in the same hand — a full
# mirror would swap it, and a dagger jumping between paws every other beat is
# worse than no arm swing.
#
# The band is the bottom LEG_FRAC of the sprite's own silhouette, so it scales
# with whatever was drawn. 0.30 covers boots and bare leg on Beverly at both
# camera angles without reaching the jacket hem.
LEG_FRAC = 0.30


def mirror_legs(step_frame):
    """Frame 0 with its legs flipped: the opposite step, by construction."""
    im = step_frame.convert('RGBA')
    a = np.array(im)
    ys, xs = np.nonzero(a[:, :, 3] > 0)
    if len(ys) == 0:
        return im
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    top = y1 - int((y1 - y0 + 1) * LEG_FRAC)
    band = a[top:y1 + 1, x0:x1 + 1]
    a[top:y1 + 1, x0:x1 + 1] = band[:, ::-1]
    return Image.fromarray(a)


# THE WHOLE FRONT/BACK ROW BUILT FROM ITS NEUTRAL FRAME.
#
# mirror_legs above fixes the second step, but it still needs a good FIRST
# step, and that is the frame generators draw worst: across a dozen Dog Punk
# rows the standing frame came back clean nearly every time — two legs, a gap
# between them, both boots flat — while the step frames fused the legs into a
# dark mass, crossed them, or splayed them sideways. That is not surprising:
# a character standing still is the pose the model has seen a million of.
#
# So ask for the pose it draws well, and construct the two it does not. The
# neutral frame's legs are separated by a gap of background; find that gap,
# lift the leg on one side of it, and that is a step. Lift the other and that
# is the opposite step. Everything above the legs is the same pixels in all
# three frames, which is the "reuse the head and torso" rule enforced rather
# than requested — and it removes the drifting head, the fused legs, the
# same-foot-twice repeat and the missing neutral in one move.
#
# LIFT_FRAC of the sprite's height, so it scales with the drawing. 0.035 is
# about three art pixels on a Dog Punk hero: enough to read at 64px, small
# enough not to look like a march.
LIFT_FRAC = 0.035


def _leg_gap(alpha, x0, x1, top, bottom):
    """Column of the gap between the two legs, or None if they are fused.

    Takes an INK mask, not raw alpha. The gap between a character's legs is
    often an enclosed pocket of background that survived keying — it is too
    small for key_background's interior-hole pass, which has a minimum size so
    it cannot eat an eye white — so by alpha alone the legs read as fused.
    """
    band = alpha[top:bottom + 1, x0:x1 + 1]
    if band.size == 0:
        return None
    counts = band.sum(axis=0)
    w = len(counts)
    lo, hi = int(w * 0.30), int(w * 0.70)          # only look near the middle
    if hi <= lo:
        return None
    mid = counts[lo:hi]
    col = lo + int(np.argmin(mid))
    # A real gap is a column with far less ink than the legs beside it.
    if mid.min() > 0.5 * counts.max():
        return None
    return x0 + col


def build_steps(neutral):
    """A cleaned standing frame and the two opposite step frames built from it."""
    im = neutral.convert('RGBA')
    a = np.array(im)
    alpha = a[:, :, 3] > 0
    ink = alpha & (a[:, :, :3].mean(axis=2) < 230)
    ys, xs = np.nonzero(alpha)
    if len(ys) == 0:
        return None
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    h = y1 - y0 + 1
    top = y1 - int(h * LEG_FRAC)
    gap = _leg_gap(ink, x0, x1, top, y1)
    if gap is None:
        return None
    lift = max(1, int(round(h * LIFT_FRAC)))
    # Clear that leftover pale pocket, or the lifted leg drags a white sliver
    # up with it and the gap shows as a bar hanging off the boot.
    a = a.copy()
    band = a[top:y1 + 1, x0:x1 + 1]
    band[(band[:, :, 3] > 0) & (band[:, :, :3].mean(axis=2) >= 230)] = 0

    def stepped(left_side):
        b = a.copy()
        sl = slice(x0, gap) if left_side else slice(gap, x1 + 1)
        leg = b[top:y1 + 1, sl].copy()
        b[top:y1 + 1, sl] = 0                       # clear, then paste higher
        b[top - lift:y1 + 1 - lift, sl] = leg
        return Image.fromarray(b)

    return stepped(True), Image.fromarray(a), stepped(False)


def build(rows, out_path, pal, body_heights, cols, mirror_rows=(), step_rows=(), ref_frames=()):
    sheet = Image.new('RGBA', (CELL * cols, CELL * len(rows)), (0, 0, 0, 0))
    for ri, row in enumerate(rows):
        body_h = body_heights[ri] if isinstance(body_heights, list) else body_heights
        ref_i = ref_frames[ri] if ri < len(ref_frames) else 0
        row = [trim(strip_baseline(trim(f))) for f in row][:cols]
        if not row:
            raise SystemExit('a row came back empty — check the raw image framing')
        if ri in step_rows and len(row) >= 2:
            built = build_steps(row[1])
            if built is None:
                raise SystemExit(
                    f'row {ri}: --build-steps needs a standing frame whose two legs are '
                    'separated by a gap of background, and frame 1 has none. Regenerate that '
                    'row; the middle frame is the only one that has to be right.')
            row = list(built)
            print(f'  row {ri}: built both step frames from the standing frame')
        if ri in mirror_rows and len(row) >= 3:
            row[2] = mirror_legs(row[0])
            print(f'  row {ri}: built the second step by mirroring the first step\'s legs')
        # ONE scale for the row, from its REFERENCE frame (frame 0 unless a
        # row overrides it with #F — see the --row help): the character must
        # not change size between idle, walking and attacking. Frame 0 is the
        # right default for walk/attack, where it sits close to standing
        # height. It is the WRONG default for a row whose frame 0 is a
        # deliberately non-standing pose — a dodge-roll's frame 0 is a
        # crouched tuck, shorter than her real standing height, and scaling
        # the whole row to make THAT frame 168px tall inflates every other
        # frame in the row past her actual size. Caught for real on Dog
        # Punk's roll sheet: the recover frame (meant to end back at normal
        # height) measured 220px, 31% taller than every other sheet's 168px.
        scale = body_h / row[ref_i].size[1]
        for ci, f in enumerate(row):
            s = pixelate(f, max(PIXEL, int(round(f.size[1] * scale))))
            if pal is not None:
                s = snap_palette(s, pal)
            x = ci * CELL + (CELL - s.size[0]) // 2
            y = ri * CELL + BASELINE - s.size[1]
            sheet.alpha_composite(s, (max(ci * CELL, x), max(ri * CELL, y)))
    sheet.save(out_path)
    print(f'wrote {out_path} {sheet.size} ({len(rows)} row(s) x {cols})')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--style', required=True, help='games/<id>/art-style.json (supplies lockedPalette)')
    ap.add_argument('--out', required=True, help='sheet to write, e.g. games/<id>/hero_sheet.png')
    ap.add_argument('--row', action='append', required=True, metavar='FILE[:N][@H][#F]',
                    help='raw image for one output row; :N picks a row within a multi-row raw; '
                         '#F picks which FRAME (0-based) in the cut row is the height reference '
                         '(default 0) — override it when frame 0 is not a standing-height pose, '
                         'e.g. a dodge-roll row whose frame 0 is a crouched tuck: --row '
                         'roll.png#2 anchors the scale to frame 2 (recover) instead')
    ap.add_argument('--body-height', type=int, default=168,
                    help='height of the idle frame inside its cell (default 168; use less for smaller creatures)')
    ap.add_argument('--cols', type=int, default=3, help='frames per row (default 3: idle, walk, attack)')
    ap.add_argument('--blobs', action='store_true', help='cut by connected blob (use when sprites overlap)')
    ap.add_argument('--tol', type=int, default=22, help='background keying tolerance')
    ap.add_argument('--mirror-step', metavar='ROWS', default='',
                    help='comma-separated row indices whose third frame should be built by '
                         'mirroring the first frame\'s legs (front/back walk rows — see '
                         'mirror_legs above). Never use it on a side row.')
    ap.add_argument('--build-steps', metavar='ROWS', default='',
                    help='comma-separated row indices whose TWO step frames should be built '
                         'from the standing middle frame by lifting each leg in turn '
                         '(front/back walk rows — see build_steps above). Only the middle '
                         'frame of such a row has to be drawn well. Never use it on a side row.')
    args = ap.parse_args()

    pal = load_palette(args.style)
    if pal is None:
        print(f'note: {args.style} has no lockedPalette — shipping the generated colours as-is. '
              'Add one so this game\'s art cannot drift between sheets.', file=sys.stderr)

    rows, heights, ref_frames = [], [], []
    for spec in args.row:
        spec, _, ref = spec.partition('#')
        spec, _, h = spec.partition('@')
        path, _, idx = spec.partition(':')
        img = key_background(path, tol=args.tol)
        rows.append(frames_by_blob(img, want=args.cols) if args.blobs
                    else frames_by_gutter(img, int(idx or 0)))
        heights.append(int(h) if h else args.body_height)
        ref_frames.append(int(ref) if ref else 0)
    mirror_rows = {int(x) for x in args.mirror_step.split(',') if x.strip()}
    step_rows = {int(x) for x in args.build_steps.split(',') if x.strip()}
    build(rows, args.out, pal, heights, args.cols, mirror_rows, step_rows, ref_frames)


if __name__ == '__main__':
    main()
