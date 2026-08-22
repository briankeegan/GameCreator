#!/usr/bin/env python3
"""Render a composed scene with a labelled pixel grid, so a person can read
real x/y coordinates off it instead of eyeballing a prop's size and position.

WHY THIS EXISTS
---------------
Automated matching between a composed scene and its cut props was tried and
failed — three pixel/gradient correlation metrics and ORB feature matching +
RANSAC all failed to recover a known-correct size or position, because the
scene and its props are independently generated: recognizably the same
object to a person, not similar enough at the pixel or feature level for any
of those techniques to lock onto. See the "why automated matching doesn't
work here" note in docs/ROOM_ART_STANDARD.md §5 for the full account.

So the reliable measurement is the human eye reading real numbers off a
picture with a ruler drawn on it — which is what actually found the bedroom's
undersized rug (w=120 against an actual ~225px) and its bed's canopy drawn
14px into the wall, this session, using exactly this kind of image built by
hand with a one-off script each time. This makes that a real, reusable tool.

Usage:
  grid_overlay.py <scene.png> [--crop x0,y0,x1,y1] [--step 10] [--zoom 3]
                  [--out grid.png]

The scene is read at the game's own 320x200 scale (matching every other
measurement in this pipeline), then cropped and zoomed for readability.
--crop is in that 320x200 coordinate space, so numbers read off the picture
are numbers you can paste straight into a props: entry.
"""
import sys, argparse
from PIL import Image, ImageDraw

W, H = 320, 200


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scene")
    ap.add_argument("--crop", help="x0,y0,x1,y1 in 320x200 room space; default is the whole frame")
    ap.add_argument("--step", type=int, default=10, help="gridline spacing, in room-space px")
    ap.add_argument("--zoom", type=int, default=4, help="output pixels per room-space px")
    ap.add_argument("--out", default="grid.png")
    a = ap.parse_args()

    scene = Image.open(a.scene).convert("RGB").resize((W, H), Image.LANCZOS)
    if a.crop:
        x0, y0, x1, y1 = (int(t) for t in a.crop.split(","))
    else:
        x0, y0, x1, y1 = 0, 0, W, H
    crop = scene.crop((x0, y0, x1, y1))

    big = crop.resize((crop.width * a.zoom, crop.height * a.zoom), Image.NEAREST)
    d = ImageDraw.Draw(big)
    for x in range(0, crop.width + 1, a.step):
        d.line([(x * a.zoom, 0), (x * a.zoom, big.height)], fill=(0, 255, 0), width=1)
        d.text((x * a.zoom + 2, 2), str(x + x0), fill=(0, 255, 0))
    for y in range(0, crop.height + 1, a.step):
        d.line([(0, y * a.zoom), (big.width, y * a.zoom)], fill=(255, 255, 0), width=1)
        d.text((2, y * a.zoom + 2), str(y + y0), fill=(255, 255, 0))
    big.save(a.out)
    print("%s crop (%d,%d)-(%d,%d), %dpx grid, %dx zoom -> %s"
          % (a.scene, x0, y0, x1, y1, a.step, a.zoom, a.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
