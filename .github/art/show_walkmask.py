#!/usr/bin/env python3
"""Render a room's walkable area over its art, for eyeballing.

The mask is the one piece of room data nobody can check by reading it — it is a
picture, and the only honest test is looking at it on top of the art it belongs
to. Every collision bug so far was obvious in one glance at this and invisible
in the numbers.

Green = walkable. Unshaded = not.

Usage: show_walkmask.py <game-dir> <room> [out.png]
"""
import sys, os
from PIL import Image

W, H = 320, 200
SCALE = 3


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    game_dir, room = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else "walk-%s-check.png" % room

    bg = Image.open(os.path.join(game_dir, "art", "bg-%s.png" % room))
    bg = bg.convert("RGBA").resize((W, H), Image.LANCZOS)
    # A floor plate is transparent everywhere off the floor. Composite it onto
    # a dark ground so that area reads as "not floor" rather than as whatever
    # the viewer happens to render transparency as.
    flat = Image.new("RGBA", (W, H), (18, 12, 26, 255))
    flat.alpha_composite(bg)
    bg = flat.convert("RGB")

    mask = Image.open(os.path.join(game_dir, "art", "walk-%s.png" % room))
    mask = mask.convert("L").resize((W, H), Image.NEAREST)

    tint = Image.new("RGB", (W, H), (60, 255, 120))
    shot = Image.composite(Image.blend(bg, tint, 0.38), bg, mask)
    shot.resize((W * SCALE, H * SCALE), Image.NEAREST).save(out)

    walkable = sum(1 for p in list(mask.convert("L").tobytes()) if p > 127)
    print("%s  %d walkable px (%.0f%%)  -> %s"
          % (room, walkable, 100.0 * walkable / (W * H), out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
