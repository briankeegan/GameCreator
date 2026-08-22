#!/usr/bin/env python3
"""Bake each room's walkable-floor mask.

Collision boxes were guesswork: an isometric room is not a rectangle, its
walls run diagonally and its furniture is drawn in perspective. Detecting
the floor automatically was tried twice and neither survived contact with
the art — a flood fill leaks up the wall where floor and wall meet in a
gradient, and climbing columns from the bottom stops dead at a grout line
or a rune painted on the floor.

THE SHORT VERSION, for a room made the current way: put the room's name in
FLOOR_PLATE_ROOMS and you are done. Its background art is ONLY the surface you
can walk on — grass, floorboards, path — with every wall, pool, tree and table
generated separately as a prop and drawn on top. So the walkable mask is that
picture's own silhouette. Nothing to measure, nothing to declare, and nothing
that can drift out of step with the art, because the art IS the declaration.
See docs/ROOM_ART_STANDARD.md.

Everything below is the OLDER way, kept working for rooms whose backgrounds
still have their scenery painted into them. There the floor is authored, but
never guessed at:

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
import json
import sys, os
from PIL import Image, ImageDraw, ImageFilter

W, H = 320, 200
EROSION = 4

# floorTop: the row where the back wall meets the floor.
# blocks:   what stands ON the floor, as polygons following what is drawn.
FLOOR_PLATE_ROOMS = {
    # The Anarchy Garden is the reference room for the three-pass standard:
    # bg-garden.png is grass and path and NOTHING else — the pool, the
    # waterfalls, the wall, the trees and the fountains are all props drawn on
    # top of it — so this set membership is the whole of its collision data.
    "garden",
    # Regenerated to the three-pass standard. bg-lounge.png is the plank floor
    # and nothing else: the back wall, its three ways out (the arch, the black
    # rune door, the red portal), the bar and the furniture are all props drawn
    # on top of it. Before this, the bar's footprint was hand-measured off a
    # painted picture, and the picture had been regenerated underneath it.
    "lounge",
    # Regenerated to the standard as the plot's VICTORIAN bedroom, and with no
    # door in any wall: you reach it by walking UP through the Lounge's back
    # wall, so you arrive at its near edge and leave the same way, through the
    # gap in the balustrade. The old art painted a door on the right-hand wall
    # that the map no longer had any use for.
    "bedroom",
    # Regenerated with the grid map: the Lounge is WEST of the lab, so the
    # lab's way out is a door in its west wall; the library sits between the
    # Lounge (south, off its near edge) and the Anarchy Garden (north, through
    # the arch in its bookcase wall).
    "lab",
    "library",
}

# EVERY ROOM BELOW IS LEGACY. Do not copy this shape for a new room, and do
# not read it as "how rooms work here" — it is how they worked before the
# three-pass standard, and it is the majority only because these rooms predate
# it. Each entry is hand-measured against a picture with its scenery painted
# in, which means every one of these numbers silently becomes wrong the moment
# that picture is regenerated.
#
# A new room, or a regenerated one, goes in FLOOR_PLATE_ROOMS above and has NO
# entry here: its background is the walkable surface, its walls and furniture
# are props, and its mask is the picture's own silhouette. See
# docs/ROOM_ART_STANDARD.md, and generate it with .github/art/room.py — never
# through "Generate game asset", which makes the old kind of picture and is
# now blocked from writing bg-*.png for exactly that reason.
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
    "house": {
        "floorTop": 100,
        "blocks": [
            [(104, 96), (214, 96), (214, 122), (104, 122)],      # kitchen table
            [(250, 96), (284, 96), (284, 128), (250, 128)],      # round candle table
        ],
    },
}


def wall_seam(game_dir, room):
    """The y where this room's back wall meets its floor, from its spec.

    Not only for interiors. An outdoor room has no back WALL but it still has a
    back EDGE, and that is what the number means there: the Anarchy Garden's is
    its water line. Relying on the pool prop to block instead did not work — its
    base is 240px wide in a 320px room, so the player walked around both ends of
    the water and on up to y=0, behind the waterfalls."""
    p = os.path.join(game_dir, "rooms", "%s.json" % room)
    if not os.path.exists(p):
        return None
    # NOT a bare except. The first version of this swallowed everything and
    # returned None, so a missing `import json` reported "no seam" for every
    # room in the game and the clip below silently did nothing — the masks
    # rebuilt byte-identical and looked fine. A checker that cannot fail is
    # worse than no checker; only a genuinely absent value may be None here.
    with open(p) as fh:
        return json.load(fh).get("wallSeam")


def compute(game_dir, room):
    """The mask for `room`, as a PIL image, WITHOUT writing it.

    The single copy of this calculation. room.py's staleness check used to
    carry its own, and the moment the floor-plate branch learned about
    wallSeam the two disagreed and every room in the game was reported stale.
    Two copies of a calculation is one copy too many; build() writes what this
    returns and the checker compares against it."""
    src = os.path.join(game_dir, "art", "bg-%s.png" % room)
    art = Image.open(src).convert("RGBA").resize((W, H), Image.BILINEAR)
    alpha = art.split()[3]
    mask = alpha.point(lambda a: 255 if a > 40 else 0)

    # THE CURRENT WAY. The background is (almost) the walkable surface, so the
    # mask is its own silhouette — nothing to declare and nothing that can drift
    # out of step with the art. Prefer this for every new room.
    if room in FLOOR_PLATE_ROOMS:
        # THE PLATE IS NOT ALWAYS ONLY THE FLOOR, and taking it on trust let the
        # player walk into the walls of four rooms. "The background IS the
        # walkable surface" is the RULE; what actually ships is whatever the
        # generator drew, and for the Library, the Lounge and the Bedroom that
        # is a picture whose top third is the back wall — plates covering 77-89%
        # of the frame, so the mask called bookcases, bar and brickwork floor.
        # Measured against the rooms that are right: the painted rooms put their
        # floor's top edge at y=103-105 of 200.
        #
        # The room already records where its wall meets its floor — `wallSeam`,
        # measured by `room.py wallseam` and looked at once by a person. Clip
        # there. This is the one number that cannot be derived from the plate,
        # because the plate is the thing that is wrong.
        seam = wall_seam(game_dir, room)
        if seam is not None:
            ImageDraw.Draw(mask).rectangle([0, 0, W, seam], fill=0)
        return erode(mask)

    # THE OLDER WAY, for rooms whose art still has its scenery painted in: the
    # outline comes from the alpha silhouette, but the wall line and everything
    # standing on the floor have to be measured by hand against the picture.
    spec = ROOMS[room]
    draw = ImageDraw.Draw(mask)
    draw.rectangle([0, 0, W, spec["floorTop"]], fill=0)
    if spec.get("bounds"):
        x0, y0, x1, y1 = spec["bounds"]
        draw.rectangle([0, 0, x0, H], fill=0)
        draw.rectangle([x1, 0, W, H], fill=0)
        draw.rectangle([0, y1, W, H], fill=0)
    for poly in spec["blocks"]:
        draw.polygon(poly, fill=0)

    return erode(mask)


def erode(mask):
    """Shrink by about half a character's width.

    This is why she can stand at the edge of the floor without her sprite
    clipping into whatever is beside her."""
    for _ in range(EROSION):
        mask = mask.filter(ImageFilter.MinFilter(3))
    return mask


def build(game_dir, room):
    """Compute the mask and write it."""
    mask = compute(game_dir, room)
    out = os.path.join(game_dir, "art", "walk-%s.png" % room)
    mask.convert("1").save(out)
    walkable = sum(1 for y in range(H) for x in range(W) if mask.getpixel((x, y)) > 127)
    print("%-8s %s  %d walkable px (%.0f%%)" % (room, out, walkable, 100.0 * walkable / (W * H)))


if __name__ == "__main__":
    game = sys.argv[1] if len(sys.argv) > 1 else "games/the-game"
    for r in (sys.argv[2:] or sorted(set(ROOMS) | FLOOR_PLATE_ROOMS)):
        build(game, r)
