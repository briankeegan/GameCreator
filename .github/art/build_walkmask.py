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
        "floorTop": 98,
        "bounds": (56, 98, 250, 190),
        "blocks": [
            [(52, 98), (114, 98), (114, 128), (52, 128)],   # the bed
            [(110, 98), (142, 98), (142, 104), (110, 104)], # nightstand
            [(188, 98), (252, 98), (252, 108), (188, 108)], # moving boxes
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
            # The bar. bg-lounge.png was mirrored horizontally so the arch
            # sits on the LEFT wall (you come out of your room's right-hand
            # door, so you come into this room from its left); the bar mirrored
            # with it, hence the x values being 320-x of the originals.
            [(302, 95), (168, 95), (168, 112), (284, 135), (302, 128)],  # the bar
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
        # Regenerated art (the plot's "library-like stadium"): tiered stands
        # ring the room on both sides and the flagstone duelling floor is the
        # hexagon between them. floorTop is the line where the stands' bottom
        # step meets that floor at the back wall.
        "floorTop": 100,
        "blocks": [
            # the left-hand stands, along the edge where they meet the floor
            [(0, 100), (66, 100), (30, 140), (42, 190), (0, 190)],
            # the right-hand stands, same
            [(250, 100), (320, 100), (320, 190), (283, 190), (292, 140)],
        ],
    },
    # The one OUTDOOR room. Its background is a bare GROUND PLATE — the trees
    # and the weeping fountains are props (see `props` in story.js), drawn as
    # their own sprites so the player can walk behind them. So the only things
    # this mask has to fence off are the pool at the back and the low garden
    # wall; everything standing up off the grass fences itself.
    "garden": {
        "floorTop": 40,
        "bounds": (4, 40, 316, 198),
        "blocks": [
            # the low wall, either side of the gap the path passes through
            [(0, 141), (114, 141), (114, 161), (0, 161)],
            [(188, 141), (320, 141), (320, 161), (188, 161)],
        ],
    },
    "lab": {
        "floorTop": 100,
        "bounds": (36, 100, 286, 186),
        "blocks": [
            [(80, 96), (222, 96), (222, 112), (80, 112)],   # the workbench
            # The cart is pulled clear of the doorway's approach — its box
            # reached across the arch and fenced the only way out of the room.
            [(252, 96), (284, 96), (284, 120), (252, 120)], # the instrument cart
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
