#!/usr/bin/env python3
"""Scale a floor plate to fill the room's frame.

A pass-2 plate comes back as a shape floating in white with however much margin
the generator felt like leaving. Shipped as-is, the room is smaller than the
frame: black bars down the sides, and every prop placed against it reads
cramped even when its own numbers are right. That is what a plate looks like
next to the composed scene it came from, and it is not obvious until you put
them side by side.

So: key the white out, trim to the shape's own bounding box, and scale it to
fill the frame with a stated margin. The silhouette is the walk mask, so this
sets the size of the walkable floor too — which is the point.

Usage: fit_plate.py <src.png> <out.png> [--margin 4] [--keep-aspect]
"""
import sys, argparse
import numpy as np
from PIL import Image

W, H = 320, 200
WHITE_TOL = 26


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--margin", type=int, default=4,
                    help="px of frame left around the floor, at 320x200")
    ap.add_argument("--keep-aspect", action="store_true",
                    help="don't stretch; fit inside the frame instead")
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGBA")
    arr = np.asarray(im).copy()
    alpha = arr[..., 3]
    if (alpha < 8).mean() <= 0.02:
        # no real alpha — the generator gave us flat white, so key it
        near_white = (arr[..., :3].astype(np.int16) > 255 - WHITE_TOL).all(axis=2)
        alpha = np.where(near_white, 0, 255).astype(np.uint8)
        arr[..., 3] = alpha

    ys, xs = np.where(alpha > 40)
    if not len(ys):
        print("nothing but background in %s" % a.src, file=sys.stderr)
        return 2
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    cut = Image.fromarray(arr[y0:y1, x0:x1], "RGBA")

    tw, th = W - a.margin * 2, H - a.margin * 2
    if a.keep_aspect:
        k = min(tw / cut.width, th / cut.height)
        tw, th = max(1, int(cut.width * k)), max(1, int(cut.height * k))
    cut = cut.resize((tw, th), Image.LANCZOS)

    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.alpha_composite(cut, ((W - tw) // 2, (H - th) // 2))
    out.save(a.out)
    print("%s  %dx%d -> filled %dx%d with a %dpx margin  -> %s"
          % (a.src.split("/")[-1], x1 - x0, y1 - y0, tw, th, a.margin, a.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
