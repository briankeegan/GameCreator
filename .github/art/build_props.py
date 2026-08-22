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
     specks, and take them in reading order — top-to-bottom rows, left to
     right within a row (see reading_order: a wide item on its own row, like
     a balustrade rail, breaks a plain left-to-right sort).
  3. Trim each to its own bounding box and save it at its natural aspect.

The game scales a prop by HEIGHT when it draws it (see `props` in story.js), so
what matters here is that each prop is trimmed tight and keeps its shape.

Usage: build_props.py <sheet.png> <out-dir> [--trim-bottom N] <name> [<name> ...]

--trim-bottom drops N rows off the bottom of every prop on the sheet, as a
percentage of that prop's own height. A sheet often draws a scrap of GROUND
under each item even when the prompt asks for none — the Lounge's wall panels
came back standing on a pale threshold, which assembled into a chalky line
running the width of the room where the wall met the floor. It is part of the
picture, not a keying artefact, so nothing automatic can tell it from art.
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
    return dehalo(~near_white, arr)


# A hard white key leaves the anti-aliased rim behind: the pixels where the
# prop's outline fades into the background sit at luma ~190-225, above the
# prop and below the key's threshold, so they survive as a pale fringe. On a
# prop that stands ON something it is not subtle — the Lounge's wall panels
# shipped with a 3px chalky line along their base, which read as a strip of
# pale floor running the width of the room where the wall met the planks.
#
# Widening WHITE_TOL is the wrong fix: it eats genuinely light art (the
# fountain's white marble) everywhere, not just at the edge. This only ever
# removes pixels that are BOTH very light AND on the current boundary, three
# rounds of it, so an interior highlight is untouched however white it is.
HALO_LUMA = 195
HALO_ROUNDS = 3


def dehalo(mask, arr):
    lum = arr[..., :3].mean(axis=2)
    for _ in range(HALO_ROUNDS):
        inner = mask.copy()
        inner[1:, :] &= mask[:-1, :]
        inner[:-1, :] &= mask[1:, :]
        inner[:, 1:] &= mask[:, :-1]
        inner[:, :-1] &= mask[:, 1:]
        edge = mask & ~inner
        mask = mask & ~(edge & (lum > HALO_LUMA))
    return mask


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


# SORTING BY X ALONE ASSUMES ONE ROW. The bedroom's sheet asked for 7 props
# — the balustrade rail included, its own item, wider than everything above
# it — and the generator laid it out as 6 items in a row plus the rail on a
# second row below rather than cramming 7 into one strip. A rail spanning the
# full width has its mean x at the sheet's own centre, which lands in the
# MIDDLE of the row above's left-to-right order: sorting purely by x put the
# rail's art into the bed's name slot and shifted every name after it by one,
# invisibly, because the tool never printed anything wrong — it found exactly
# 7 blobs for 7 names, the failure mode "found N but expected M" can't catch.
#
# So: cluster into rows by vertical overlap first, THEN sort each row by x
# and read rows top to bottom. A single-row sheet — everything this shipped
# with until now — has exactly one row after clustering, which sorts by x
# alone and is unchanged from before.
def reading_order(found):
    def bbox(pts):
        ys = [y for y, _ in pts]
        xs = [x for _, x in pts]
        return min(ys), max(ys), sum(xs) / len(xs)

    rows = []
    for pts in sorted(found, key=lambda pts: bbox(pts)[0]):
        y0, y1, cx = bbox(pts)
        for row in rows:
            if y0 <= row["y1"] and row["y0"] <= y1:
                row["y0"] = min(row["y0"], y0)
                row["y1"] = max(row["y1"], y1)
                row["items"].append((cx, pts))
                break
        else:
            rows.append({"y0": y0, "y1": y1, "items": [(cx, pts)]})

    rows.sort(key=lambda r: r["y0"])
    out = []
    for row in rows:
        row["items"].sort(key=lambda item: item[0])
        out.extend(pts for _, pts in row["items"])
    return out


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    sheet_path, out_dir = sys.argv[1], sys.argv[2]
    rest = sys.argv[3:]
    trim_pct = 0.0
    if "--trim-bottom" in rest:
        i = rest.index("--trim-bottom")
        trim_pct = float(rest[i + 1])
        rest = rest[:i] + rest[i + 2:]
    names = rest

    img = Image.open(sheet_path).convert("RGBA")
    mask = keyed(img)
    h, w = mask.shape
    found = [p for p in blobs(mask) if len(p) >= MIN_BLOB * h * w]
    # reading order: top-to-bottom rows, left-to-right within a row
    found = reading_order(found)

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
        if trim_pct:
            y1 = max(y0 + 1, y1 - int(round((y1 - y0) * trim_pct / 100.0)))
            pts = [(y, x) for y, x in pts if y < y1]
            ys = [y for y, _ in pts]
            xs = [x for _, x in pts]
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
