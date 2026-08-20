#!/usr/bin/env python3
"""Bake each room's walkable-floor mask.

Collision boxes were guesswork: an isometric room is not a rectangle, its
walls run diagonally and its furniture is drawn in perspective. Detecting
the floor automatically was tried twice and neither survived contact with
the art — a flood fill leaks up the wall where floor and wall meet in a
gradient, and climbing columns from the bottom stops dead at a grout line
or a rune painted on the floor.

So the floor is authored, but never guessed at:

  * The room's OUTLINE comes from the art itself — the alpha silhouette of
    the background PNG, which is exact and free. That is what makes the
    diagonal corners of an isometric room correct.
  * The wall line and the furniture standing on the floor are declared
    below, per room, measured against the art at the game's own 320x200
    scale (the same way the doors were placed).
  * The result is eroded by about half the character's width, so she can
    stand at an edge without clipping into what is beside her.

Output is a 1-bit PNG per room (white = walkable) that the game samples
under her feet. Re-run after changing a room's background art.

Usage: build_walkmask.py <game-dir> [room ...]
"""
import sys, os
from PIL import Image, ImageDraw, ImageFilter

W, H = 320, 200
EROSION = 4

# floorTop: the row where the back wall meets the floor.
# blocks:   what stands ON the floor, as polygons following what is drawn.
ROOMS = {
    # bounds: for art drawn as a full rectangle with a dark border painted in,
    # where the alpha silhouette can't tell room from frame.
    "home_bedroom": {
        "floorTop": 96,
        "bounds": (52, 96, 286, 188),
        "blocks": [
            [(48, 96), (118, 96), (118, 138), (48, 138)],   # the bed
            [(118, 96), (158, 96), (158, 102), (118, 102)], # nightstand
            [(236, 96), (288, 96), (288, 106), (236, 106)], # moving boxes
        ],
    },
    "bedroom": {
        "floorTop": 100,
        "blocks": [
            [(20, 96), (74, 96), (76, 110), (22, 110)],          # mirror
            [(116, 96), (200, 96), (202, 118), (120, 118)],      # bed + nightstand
        ],
    },
    "lounge": {
        "floorTop": 95,
        "blocks": [
            [(18, 95), (152, 95), (152, 112), (36, 135), (18, 128)],  # the bar
        ],
    },
    "library": {
        "floorTop": 96,
        "blocks": [
            [(148, 96), (192, 96), (194, 116), (150, 116)],      # armchair
            [(192, 98), (218, 98), (218, 118), (192, 118)],      # candle table
        ],
    },
    "arena": {
        # The benches curve, so a straight floorTop across the room either
        # fences the player off the floor that rises at the sides or lets
        # them stand on the lowest tier. Cut high and let the bench block
        # follow the curve instead.
        "floorTop": 84,
        "blocks": [
            # the tiered stone benches, along their bottom edge
            [(0, 84), (40, 96), (90, 90), (150, 84), (150, 60), (0, 60)],
            [(0, 84), (0, 124), (34, 110), (44, 100), (40, 96)],
            # the right-hand wall base, which sits lower than the benches do
            [(252, 84), (320, 84), (320, 108), (300, 100), (262, 92)],
        ],
    },
    "house": {
        "floorTop": 100,
        "blocks": [
            [(104, 96), (214, 96), (214, 122), (104, 122)],      # kitchen table
            [(250, 96), (284, 96), (284, 128), (250, 128)],      # round candle table
        ],
    },
}


def build(game_dir, room):
    spec = ROOMS[room]
    src = os.path.join(game_dir, "art", "bg-%s.png" % room)
    art = Image.open(src).convert("RGBA").resize((W, H), Image.BILINEAR)
    alpha = art.split()[3]

    # walkable = inside the room's own silhouette, below the wall line
    mask = alpha.point(lambda a: 255 if a > 40 else 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle([0, 0, W, spec["floorTop"]], fill=0)
    if spec.get("bounds"):
        x0, y0, x1, y1 = spec["bounds"]
        draw.rectangle([0, 0, x0, H], fill=0)
        draw.rectangle([x1, 0, W, H], fill=0)
        draw.rectangle([0, y1, W, H], fill=0)
    for poly in spec["blocks"]:
        draw.polygon(poly, fill=0)

    for _ in range(EROSION):
        mask = mask.filter(ImageFilter.MinFilter(3))

    out = os.path.join(game_dir, "art", "walk-%s.png" % room)
    mask.convert("1").save(out)
    walkable = sum(1 for y in range(H) for x in range(W) if mask.getpixel((x, y)) > 127)
    print("%-8s %s  %d walkable px (%.0f%%)" % (room, out, walkable, 100.0 * walkable / (W * H)))


if __name__ == "__main__":
    game = sys.argv[1] if len(sys.argv) > 1 else "games/the-game"
    for r in (sys.argv[2:] or list(ROOMS)):
        build(game, r)
