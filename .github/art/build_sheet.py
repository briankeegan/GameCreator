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
    """
    a = np.array(im)
    alpha = a[:, :, 3] > 0
    h, w = alpha.shape
    if h < 20:
        return im
    max_w = alpha.sum(axis=1).max() or 1
    cut = h
    for y in range(h - 1, int(h * 0.75), -1):
        row = a[y][alpha[y]]
        if len(row) < max_w * 0.4:
            break
        rgb = row[:, :3].astype(np.int32)
        luma = rgb.mean(axis=1)
        pale = luma > 175
        if pale.mean() < 0.75:
            break
        # near-uniform: the pale pixels are all about the same colour
        if rgb[pale].std(axis=0).mean() > 14:
            break
        cut = y
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


def build(rows, out_path, pal, body_heights, cols):
    sheet = Image.new('RGBA', (CELL * cols, CELL * len(rows)), (0, 0, 0, 0))
    for ri, row in enumerate(rows):
        body_h = body_heights[ri] if isinstance(body_heights, list) else body_heights
        row = [trim(strip_baseline(trim(f))) for f in row][:cols]
        if not row:
            raise SystemExit('a row came back empty — check the raw image framing')
        # ONE scale for the row, from its idle frame: the character must not
        # change size between idle, walking and attacking.
        scale = body_h / row[0].size[1]
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
    ap.add_argument('--row', action='append', required=True, metavar='FILE[:N]',
                    help='raw image for one output row; :N picks a row within a multi-row raw')
    ap.add_argument('--body-height', type=int, default=168,
                    help='height of the idle frame inside its cell (default 168; use less for smaller creatures)')
    ap.add_argument('--cols', type=int, default=3, help='frames per row (default 3: idle, walk, attack)')
    ap.add_argument('--blobs', action='store_true', help='cut by connected blob (use when sprites overlap)')
    ap.add_argument('--tol', type=int, default=22, help='background keying tolerance')
    args = ap.parse_args()

    pal = load_palette(args.style)
    if pal is None:
        print(f'note: {args.style} has no lockedPalette — shipping the generated colours as-is. '
              'Add one so this game\'s art cannot drift between sheets.', file=sys.stderr)

    rows, heights = [], []
    for spec in args.row:
        spec, _, h = spec.partition('@')
        path, _, idx = spec.partition(':')
        img = key_background(path, tol=args.tol)
        rows.append(frames_by_blob(img, want=args.cols) if args.blobs
                    else frames_by_gutter(img, int(idx or 0)))
        heights.append(int(h) if h else args.body_height)
    build(rows, args.out, pal, heights, args.cols)


if __name__ == '__main__':
    main()
