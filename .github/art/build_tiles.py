#!/usr/bin/env python3
"""Cut a generated tile sheet into this game's shipped tile strip.

The counterpart of .github/art/build_sheet.py for the OTHER shape of top-down
game: the one whose level is a grid of repeating tiles (this one) rather than
one picture per room (Newsey — that is .github/art/room.py). The prompt that
feeds it is tileset_prompt.txt next door.

Normally reached through `.github/art/tileset.py`, the front door — the same
shape as room.py for rooms and generate_row.py for characters. Call it directly
when you want a cut with no generation:

    python3 .github/art/build_tiles.py \
        --style games/dog-punk/art-style.json \
        --out   games/dog-punk/tiles.png \
        --tile  texture:games/dog-punk/art-src/tiles_ground_raw.png:0 \
        --tile  object:games/dog-punk/art-src/tiles_objects_raw.png:1

(It was written into games/dog-punk/art-src/ by an autopilot run, whose own
docstring explained why: the run's commit allowlist covered games/ and nothing
else, so a shared tool could not be put in a shared place. That allowlist now
admits .github/art/, which is what this file's move records.)

One --tile per output cell, left to right, each naming which raw sheet it comes
off and which item in that sheet (0-based, left to right). Two kinds:

  texture  the floor and the walls. Opaque, fills the cell, and MADE SEAMLESS
           here (offset-and-blend: the tile is blended with a copy of itself
           rolled half a tile, so opposite edges meet) — a generator will not
           draw a tile that repeats, and an un-seamed floor tile laid 200 times
           is the grid-of-squares look the whole redo was about.
  object   an obstacle, gate or puddle drawn ON TOP of a floor tile, so the
           background is keyed to transparency and the item is fitted into the
           cell with its own margin preserved.

Optionally `:x,y,w` (fractions of the item's own box) crops a sub-square out of
a texture before it is scaled down — use it to avoid a big one-off feature the
generator centred in a swatch, which would otherwise repeat across the level —
and after that `:mul` scales its brightness. Brightness is a LEVEL-DESIGN
control, not a fix for bad art: the generator draws every material at the same
confident mid-key, so a floor patch and a wall come back competing with the
characters standing on them. Knocking the walls and the concrete down is what
puts the sprites in front of the scenery.

PALETTE. Every pixel of every tile is mapped to `environmentPalette` in the
game's art-style.json, exactly as build_sheet.py maps characters to
`lockedPalette`. Same reason: the ground, the walls and the props cannot drift
into different colour worlds, and the flattening is what turns the generator's
noisy grain into flat 16-bit colour blocks. Run with --print-palette (and no
environmentPalette in the file yet) to have a candidate palette median-cut out
of the art and printed, ready to paste in.
"""
import argparse
import json
import pathlib
import sys

import numpy as np
from PIL import Image

BG_LUM = 205      # a pixel this bright and this grey is background/soft shadow
BG_SAT = 16       # ... the generator draws a light grey drop shadow it was told not to


def _bands(mask, axis, minimum):
    """Runs of "there is ink somewhere along this line", along one axis."""
    on_line = mask.any(axis=axis)
    bands, run = [], None
    for i, on in enumerate(on_line):
        if on and run is None:
            run = i
        elif not on and run is not None:
            if i - run > minimum:
                bands.append((run, i))
            run = None
    if run is not None and len(on_line) - run > minimum:
        bands.append((run, len(on_line)))
    return bands


def load_items(raw_path):
    """Split one raw sheet into its items, in READING ORDER, by ink profile.

    Bands rather than connected components on purpose: an item can be several
    separate blobs (a puddle with weed tufts around it), and those must stay
    one item.

    ROWS FIRST, THEN COLUMNS. The prompt asks for the items side by side in one
    line, and for three or four of them on a landscape canvas that is usually
    what comes back — but ask for four and the generator will happily lay them
    out as a 2x2 GRID instead, because a grid fits the canvas better. A
    column-only split then reads each column of that grid as ONE tall item, so
    `--tile texture:raw:2` silently cuts a square out of the wrong material.
    That cost a level pass. Detecting the row bands first makes both layouts cut
    the same, and a single row is just the one-band case.
    """
    im = Image.open(raw_path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    lum = a.max(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    ink = ~((lum >= BG_LUM) & (sat <= BG_SAT))
    out = []
    for y0, y1 in _bands(ink, 1, im.height // 40) or [(0, im.height)]:
        strip = ink[y0:y1]
        for x0, x1 in _bands(strip, 0, im.width // 40):
            rows = strip[:, x0:x1].any(axis=1)
            ys = np.nonzero(rows)[0]
            t, b = y0 + int(ys[0]), y0 + int(ys[-1]) + 1
            out.append((im.crop((x0, t, x1, b)), ink[t:b, x0:x1]))
    return out


def seamless(a, frac=0.28):
    """Offset-and-blend, the classic seamless-texture trick.

    b is the tile rolled half a tile, so b's borders are a's centre. Blending
    a into b with a weight that falls to zero at the border leaves the border
    pixels equal to b's, which are neighbours in the original — so laying the
    tile beside a copy of itself has no seam.
    """
    h, w = a.shape[:2]
    b = np.roll(np.roll(a, h // 2, axis=0), w // 2, axis=1)
    yy = np.linspace(-1, 1, h)[:, None]
    xx = np.linspace(-1, 1, w)[None, :]
    d = np.maximum(np.abs(yy), np.abs(xx))
    wgt = np.clip((1 - d) / frac, 0, 1)[:, :, None]
    return (a * wgt + b * (1 - wgt)).astype(np.float32)
    # frac is how wide the blended band is, as a fraction of the half-tile. Keep
    # it NARROW (0.3): blending the whole tile leaves a mirrored butterfly motif
    # in the middle of every tile, which repeats across the level and reads as a
    # pattern printed on the ground rather than as a surface.


def to_palette(rgb, palette):
    flat = rgb.reshape(-1, 3).astype(np.int32)
    d = ((flat[:, None, :] - palette[None, :, :]) ** 2).sum(axis=2)
    return palette[d.argmin(axis=1)].reshape(rgb.shape).astype(np.uint8)


def build_texture(item, size, crop):
    im, _ = item
    w, h = im.size
    s = min(w, h)
    if crop:
        fx, fy, fw = crop
        side = int(s * fw)
        x0 = int(w * fx)
        y0 = int(h * fy)
        im = im.crop((x0, y0, min(x0 + side, w), min(y0 + side, h)))
    else:
        # centre square, inset a little: the outermost pixels of a generated
        # swatch carry the edge of the drawing, not the material.
        inset = int(s * 0.04)
        x0 = (w - s) // 2 + inset
        y0 = (h - s) // 2 + inset
        im = im.crop((x0, y0, x0 + s - 2 * inset, y0 + s - 2 * inset))
    small = np.asarray(im.resize((size, size), Image.BOX)).astype(np.float32)
    return seamless(small), None


def build_object(item, size, pad):
    im, ink = item
    w, h = im.size
    side = max(w, h)
    canvas = Image.new('RGB', (side, side), (255, 255, 255))
    mask = np.zeros((side, side), bool)
    ox, oy = (side - w) // 2, (side - h) // 2
    canvas.paste(im, (ox, oy))
    mask[oy:oy + h, ox:ox + w] = ink
    inner = max(1, size - 2 * pad)
    # ALPHA-WEIGHTED downscale. Averaging the RGB of a cut-out and its white
    # background together, then keying, welds a pale rim onto every object —
    # the shipped gate had a white bar along its bottom rail from exactly this.
    # So the background is excluded from the average: shrink colour*mask and
    # mask separately, then divide.
    m = mask.astype(np.float32)
    def shrink(a):
        return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize((inner, inner), Image.BOX))
    a_small = shrink(m)
    src = np.asarray(canvas).astype(np.float32)
    rgb = np.dstack([shrink(src[:, :, ch] * m) for ch in range(3)])
    rgb = np.where(a_small[:, :, None] > 1e-3, rgb / np.maximum(a_small, 1e-3)[:, :, None], 255.0)
    alpha = a_small * 255.0
    full_rgb = np.full((size, size, 3), 255, np.float32)
    full_a = np.zeros((size, size), np.float32)
    full_rgb[pad:pad + inner, pad:pad + inner] = rgb
    full_a[pad:pad + inner, pad:pad + inner] = alpha
    return full_rgb, full_a


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--style', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--tile', action='append', required=True,
                    help='kind:raw.png:index[:x,y,w][:brightness] — kind is texture or object')
    ap.add_argument('--size', type=int, default=32, help='cell size in px (default 32 — one art pixel per screen pixel)')
    ap.add_argument('--pad', type=int, default=1, help='transparent margin inside an object cell')
    ap.add_argument('--colors', type=int, default=14, help='palette size when --print-palette invents one')
    ap.add_argument('--print-palette', action='store_true')
    args = ap.parse_args()

    style = json.loads(pathlib.Path(args.style).read_text())
    sheets, cells = {}, []
    for spec in args.tile:
        parts = spec.split(':')
        kind, raw, idx = parts[0], parts[1], int(parts[2])
        crop = tuple(float(v) for v in parts[3].split(',')) if len(parts) > 3 and parts[3] else None
        mul = float(parts[4]) if len(parts) > 4 and parts[4] else 1.0
        if raw not in sheets:
            sheets[raw] = load_items(raw)
            print(f'{raw}: {len(sheets[raw])} item(s)')
        item = sheets[raw][idx]
        rgb, alpha = (build_texture(item, args.size, crop) if kind == 'texture'
                      else build_object(item, args.size, args.pad))
        cells.append((rgb * mul, alpha))

    if args.print_palette or 'environmentPalette' not in style:
        merged = np.concatenate([c[0].astype(np.uint8).reshape(-1, 3) for c in cells])
        side = int(np.ceil(np.sqrt(len(merged))))
        pad = np.full((side * side - len(merged), 3), 255, np.uint8)
        img = Image.fromarray(np.concatenate([merged, pad]).reshape(side, side, 3))
        q = img.quantize(colors=args.colors, method=Image.MEDIANCUT).convert('RGB')
        pal = sorted({tuple(p) for p in np.asarray(q).reshape(-1, 3)})
        print('candidate environmentPalette:')
        print(json.dumps([f'#{r:02x}{g:02x}{b:02x}' for r, g, b in pal], indent=2))
        if 'environmentPalette' not in style:
            sys.exit(f'{args.style} has no environmentPalette — paste the above in and re-run')
        if args.print_palette:
            return

    palette = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)]
                        for h in style['environmentPalette']], np.int32)
    out = Image.new('RGBA', (args.size * len(cells), args.size), (0, 0, 0, 0))
    for i, (rgb, alpha) in enumerate(cells):
        mapped = to_palette(np.clip(rgb, 0, 255).astype(np.uint8), palette)
        a = np.full((args.size, args.size), 255, np.uint8) if alpha is None else (alpha > 128).astype(np.uint8) * 255
        out.paste(Image.fromarray(np.dstack([mapped, a]), 'RGBA'), (i * args.size, 0))
    pathlib.Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    out.save(args.out)
    print(f'wrote {args.out} — {len(cells)} tiles of {args.size}px')


if __name__ == '__main__':
    main()
