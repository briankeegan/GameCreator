#!/usr/bin/env python3
"""Cut a sheet of scenery props into one transparent PNG each.

WHY THIS AND NOT build_sheet.py
-------------------------------
build_sheet.py exists for CHARACTER animation: it forces every frame onto a
common foot baseline in fixed-size cells and locks the palette, because a walk
cycle whose frames change size or colour looks broken. A prop is not an
animation. A tree and a fountain are different heights on purpose, and squeezing
them into equal cells throws away the one thing that makes a prop read as
scenery — its own proportions.

What DOES carry over is the reason the sheet exists at all: props generated one
per image drift apart in palette, lighting angle and pixel scale, the same way
sprites do. So they are drawn together in one image and cut apart here.

  1. Key the flat white background out to real transparency (asking the
     generator for transparency returns a beige wash — see CLAUDE.md).
  2. Find each prop as a connected blob of non-background pixels, ignoring
     specks, and take them left to right.
  3. Trim each to its own bounding box and save it at its natural aspect.

The game scales a prop by HEIGHT when it draws it (see `props` in story.js), so
what matters here is that each prop is trimmed tight and keeps its shape.

Usage: build_props.py <sheet.png> <out-dir> <name> [<name> ...]
"""
import sys, os
from PIL import Image
import numpy as np

WHITE_TOL = 30        # how far off pure white still counts as background
MIN_BLOB = 0.002      # ignore blobs smaller than this share of the sheet


def keyed(img):
    """Mask: True where the pixel is part of a prop.

    Prefer the sheet's OWN alpha when it has any. The house rule is to ask for
    flat white because transparency usually comes back as a beige wash — but
    when the generator does honour it, its own cut-out is cleaner than anything
    a colour key can do, and white-keying a transparent sheet would key the
    fountain's white marble instead of the background.
    """
    arr = np.asarray(img.convert("RGBA"))
    alpha = arr[..., 3]
    if (alpha < 8).mean() > 0.05:
        return alpha > 128
    near_white = (arr[..., :3].astype(np.int16) > 255 - WHITE_TOL).all(axis=2)
    return ~near_white


def blobs(mask):
    """Connected components, 4-way, iterative so a big sheet can't blow the
    stack the way a recursive flood fill does."""
    h, w = mask.shape
    seen = np.zeros((h, w), dtype=bool)
    out = []
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or seen[y0, x0]:
                continue
            stack = [(y0, x0)]
            seen[y0, x0] = True
            pts = []
            while stack:
                y, x = stack.pop()
                pts.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            out.append(pts)
    return out


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    sheet_path, out_dir = sys.argv[1], sys.argv[2]
    names = sys.argv[3:]

    img = Image.open(sheet_path).convert("RGBA")
    mask = keyed(img)
    h, w = mask.shape
    found = [p for p in blobs(mask) if len(p) >= MIN_BLOB * h * w]
    # left to right, by the blob's own centre
    found.sort(key=lambda pts: sum(x for _, x in pts) / len(pts))

    if len(found) != len(names):
        print("found %d props but %d names given — check the sheet before "
              "trusting this" % (len(found), len(names)))
    os.makedirs(out_dir, exist_ok=True)
    src = np.asarray(img).copy()
    for i, name in enumerate(names):
        if i >= len(found):
            break
        pts = found[i]
        ys = [y for y, _ in pts]
        xs = [x for _, x in pts]
        y0, y1, x0, x1 = min(ys), max(ys) + 1, min(xs), max(xs) + 1
        cut = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
        # only this blob's pixels — a neighbouring prop overlapping the same
        # bounding box must not come along for the ride
        own = np.zeros((h, w), dtype=bool)
        own[ys, xs] = True
        region = own[y0:y1, x0:x1]
        cut[region] = src[y0:y1, x0:x1][region]
        cut[..., 3] = np.where(region, 255, 0)
        out = os.path.join(out_dir, name + ".png")
        Image.fromarray(cut, "RGBA").save(out)
        print("%-22s %4dx%-4d  %s" % (name, x1 - x0, y1 - y0, out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
