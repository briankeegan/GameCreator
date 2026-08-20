#!/usr/bin/env python3
"""Turn a raw portrait generation into the shipped talk-box portrait.

RULE: a dialogue portrait is a HEAD-AND-SHOULDERS BUST, square, with the face
in the upper half. The talk box is a small square well beside two lines of
text; whatever comes back from the generator has to be cropped to that shape
or the face ends up a thumbnail with a lot of robe under it.

The generator is asked for the bust on FLAT PURE WHITE (never transparency —
same reason as sprite sheets, see CHARACTER_SHEETS.md), and it obliges with a
lot of white margin around the subject. Doing this by eye is how portraits end
up at four different zoom levels beside each other in the same conversation,
so it is done here instead:

  1. find the subject — flat background keyed out (white, or the image's own
     alpha when it already has some, since keying white would eat a white lab
     coat exactly the way it would eat a white marble statue);
  2. crop to that silhouette;
  3. pad to a SQUARE anchored at the TOP, so the head keeps its headroom and
     the crop eats the chest instead of the face. A bust wider than it is tall
     is centred horizontally and grown downward;
  4. flatten onto the game's parchment-cream talk-box ground so every portrait
     sits on the same colour, and resize to 768x768 — the size every portrait
     already shipped at.

Usage:
    make_portrait.py <src.png> <dest.png> [--bg RRGGBB] [--size N]

Check the result with your eyes, not just the exit code: the one thing this
cannot decide is whether the generator drew the right person.
"""

import argparse
import sys

from PIL import Image

SIZE = 768
# The talk box's own ground. Portraits that already shipped were generated on
# a warm cream, so a new one keyed onto pure white reads as a hole beside them.
BG = (238, 220, 186)
# How close to the corner colour a pixel has to be to count as background.
KEY_TOL = 26
# Headroom kept above the subject when squaring up, as a fraction of the crop.
HEADROOM = 0.04


def subject_box(im):
    """Bounding box of the drawn subject, background keyed out."""
    rgba = im.convert("RGBA")
    alpha = rgba.getchannel("A")
    if alpha.getextrema()[0] < 250:
        # The generation already carries real transparency — trust it.
        box = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
        if box:
            return box
    # Otherwise key the flat background, sampled from the corner rather than
    # assumed to be white: a generation on cream is just as common.
    rgb = rgba.convert("RGB")
    key = rgb.getpixel((1, 1))
    w, h = rgb.size
    px = rgb.load()
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if abs(r - key[0]) + abs(g - key[1]) + abs(b - key[2]) > KEY_TOL:
                mp[x, y] = 255
    return mask.getbbox()


def make(src, dest, bg, size):
    im = Image.open(src).convert("RGBA")
    box = subject_box(im)
    if not box:
        sys.exit(f"{src}: the whole image keys out as background — nothing drawn?")
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    pad = int(h * HEADROOM)
    y0 = max(0, y0 - pad)
    h = y1 - y0

    # Square it. Taller than wide: grow sideways, centred. Wider than tall:
    # grow DOWNWARD only, so the head keeps its position at the top.
    if h >= w:
        side = h
        cx = (x0 + x1) // 2
        x0 = cx - side // 2
    else:
        side = w
    crop = Image.new("RGBA", (side, side), bg + (255,))
    src_box = (max(x0, 0), max(y0, 0), min(x0 + side, im.width), min(y0 + side, im.height))
    piece = im.crop(src_box)
    crop.paste(piece, (src_box[0] - x0, src_box[1] - y0), piece)

    out = Image.new("RGB", (side, side), bg)
    out.paste(crop, (0, 0), crop)
    out = out.resize((size, size), Image.LANCZOS)
    out.convert("RGBA").save(dest)
    print(f"{dest}  <- {src}  subject {w}x{y1 - y0} -> {size}x{size}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("dest")
    ap.add_argument("--bg", default=None,
                    help="ground colour as RRGGBB (default: the talk box's cream)")
    ap.add_argument("--size", type=int, default=SIZE)
    a = ap.parse_args()
    bg = BG if not a.bg else tuple(int(a.bg[i:i + 2], 16) for i in (0, 2, 4))
    make(a.src, a.dest, bg, a.size)


if __name__ == "__main__":
    main()
