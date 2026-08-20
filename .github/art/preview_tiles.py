#!/usr/bin/env python3
"""Lay a game's tile strip out as a floor, so a person can look at it.

    python3 .github/art/preview_tiles.py games/dog-punk --out /tmp/tiles.png

The counterpart of `room.py check`. Three things that no number catches and one
glance does, all of which shipped to Dog Punk in a single pass:

  * a floor that reads as a GRID — the seam check catches a bad one, not a
    borderline one, and a grid is unmistakable when you see 200 of them;
  * a CHESSBOARD — a second floor material scattered cell by cell instead of
    laid in slabs, which is what "1-in-5 pale concrete" looks like in practice;
  * a WALL TEXTURE LYING FLAT in the middle of the room, because the level map
    used the boundary wall's tile for an interior obstacle. Planks lying on the
    floor read as debris, not as something you cannot walk through.

The strip is drawn three ways: raw (each tile once, labelled by index), tiled
(each tile repeated, which is the only way a seam shows), and a mixed field
using the same position hash a level renderer would.
"""

import argparse
import os
import sys

import numpy as np
from PIL import Image

SCALE = 4
REPEAT = 5


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("game")
    ap.add_argument("--out", default="/tmp/tiles.png")
    ap.add_argument("--floors", default="0,1,2")
    a = ap.parse_args()

    strip_path = os.path.join(a.game.rstrip("/"), "tiles.png")
    if not os.path.exists(strip_path):
        sys.exit(f"no {strip_path}")
    strip = Image.open(strip_path).convert("RGBA")
    size = strip.height
    n = strip.width // size
    tiles = [strip.crop((i * size, 0, (i + 1) * size, size)) for i in range(n)]
    floors = [int(x) for x in a.floors.split(",") if x.strip() != ""]

    band = size * SCALE
    row_h = band
    tiled_h = band * REPEAT
    W = max(n * band, REPEAT * band * max(1, len(floors)))
    out = Image.new("RGBA", (W, row_h + tiled_h + tiled_h + 24), (24, 22, 28, 255))

    # 1. every tile once
    for i, t in enumerate(tiles):
        out.paste(t.resize((band, band), Image.NEAREST), (i * band, 0))

    # 2. each floor tile repeated — a seam only exists next to a copy of itself
    y = row_h + 8
    for k, idx in enumerate(floors):
        if idx >= n:
            continue
        block = Image.new("RGBA", (band * REPEAT, band * REPEAT))
        for r in range(REPEAT):
            for c in range(REPEAT):
                block.paste(tiles[idx].resize((band, band), Image.NEAREST), (c * band, r * band))
        out.paste(block, (k * band * REPEAT, y))

    # 3. a mixed field, the way a level actually draws it
    y2 = y + tiled_h + 8
    cols = W // band
    for r in range(REPEAT):
        for c in range(cols):
            h = (np.sin(c * 12.9898 + r * 78.233) * 43758.5453) % 1.0
            idx = floors[int(h * len(floors))] if floors else 0
            cell = tiles[idx].resize((band, band), Image.NEAREST)
            if h > 0.93 and n > len(floors):
                cell = cell.copy()
                obj = tiles[min(n - 1, len(floors))].resize((band, band), Image.NEAREST)
                cell.alpha_composite(obj)
            out.paste(cell, (c * band, y2 + r * band))

    out.save(a.out)
    print(f"wrote {a.out}")
    print("LOOK AT IT. Row 1 is each tile once; row 2 is each floor tile repeated "
          "(a grid shows here or nowhere); row 3 is a mixed field.")


if __name__ == "__main__":
    main()
