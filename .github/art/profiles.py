#!/usr/bin/env python3
"""Generation settings, one table, keyed by WHAT IS BEING DRAWN.

    python3 .github/art/profiles.py            # show the table
    python3 .github/art/profiles.py walk       # show one profile

WHY A TABLE. Every knob the image API takes is a decision that depends on the
KIND of art, and each one was learned the expensive way — then written down in
a different place. The canvas was a constant at the top of generate_row.py; the
`--blobs` verification flag was an `if kind == 'attack'`; `background` was sent
by the broker and not by the direct path, so the two transports quietly
disagreed; room and tileset passes each carried their own defaults. Adding a
new kind of art meant finding four files and remembering four lessons.

So the settings live here, next to the reason for each, and every front door
(generate_row.py, room.py, tileset.py) reads them. Adding a kind of art is a
row in this table. Changing a lesson changes it once.

WHAT THE API ACTUALLY OFFERS (checked against the docs, not assumed):
    size            1024x1024 | 1024x1536 | 1536x1024   — nothing else
    quality         low | medium | high | auto
    background      transparent | opaque                — png or webp only
    output_format   png | webp | jpeg
There is NO parameter for composition, framing or margins. A subject drawn
into the edge of the frame can only be prevented by the prompt, and caught
afterwards by the CLIPPED check — which is why that check exists and why a
clipped generation is retried rather than argued with.
"""

import json
import sys

# background: 'opaque' everywhere for now, and that is a deliberate hold rather
# than an oversight. The pipeline keys a flat white background out itself, and
# the cutters are built around it (build_sheet.py's tolerance, build_props.py
# preferring real alpha when it finds it). `background: "transparent"` is a
# real API parameter and is very likely better — it would remove the keying
# step and the grey ground-shadow-welded-to-the-boots failure with it — but
# switching it is a pipeline change to make deliberately, with one character
# regenerated and compared, not a flag flipped at the bottom of a long night.
# MODEL, for every front door, in one place — which is the entire reason this
# table exists. It was gpt-image-1 everywhere, hardcoded in three files.
#
# gpt-image-2 is CHEAPER: $8/$30 per million input/output tokens against
# gpt-image-1's $10/$40, roughly 20-25% less. It also takes more (2048x2048,
# background "auto", a moderation setting, streaming partials) and meters
# tokens differently, so per-image cost is not exactly those ratios — but it is
# not more expensive, which was the bar.
#
# The risk of being wrong about it is bounded, and that is why it is worth
# trying rather than deliberating: every generation goes through the gates, so
# a model that frames worse or drops a column gets its art rejected and
# quarantined instead of shipped. The cost of a bad switch is wasted
# generations that announce themselves, not bad art in the game.
#
# Revert is this one line.
MODEL = "gpt-image-2"

PROFILES = {
    "walk": {
        "model": MODEL,
        "size": "1536x1024",
        "quality": "medium",
        "background": "opaque",
        # ONE ROW PER IMAGE, LANDSCAPE. A 3x3 grid on a square canvas clips its
        # bottom row; on a tall canvas it silently drops a column. Both happened
        # on consecutive attempts at the same character. A single row of three
        # on 1536x1024 has not failed that way yet.
        "verify": {"frames": 3, "walk": True, "blobs": False},
        # A front or back row's steps are BUILT from its standing frame by
        # build_sheet.py --build-steps, so a same-foot-twice verdict on the
        # drawn steps is reported, not fatal.
        "steps_built_views": ["front", "back"],
        # Mirroring a side profile turns it into the other direction, so the
        # mirrored-step test is meaningless there.
        "mirrored_views": ["front", "back"],
    },
    "attack": {
        "model": MODEL,
        "size": "1536x1024",
        "quality": "medium",
        "background": "opaque",
        # COUNT BY BLOB, NOT BY GUTTER. A swung blade reaches into the white gap
        # beside it — that is what a swing looks like — so two frames touch and
        # a gutter count reports "found 2 sprites, expected 3" on good art. The
        # cutter was always given --blobs for attack sheets; the verifier was
        # not, and it threw away two perfectly good rows before anyone noticed
        # the flag was missing from one side of the same pipeline.
        "verify": {"frames": 3, "walk": False, "blobs": True},
        "steps_built_views": [],
        "mirrored_views": [],
    },
    "room_scene": {
        "model": MODEL,
        "size": "1536x1024",
        "quality": "medium",
        "background": "opaque",
        # Pass 1 is measured, never shipped: every prop's ground point, height
        # and count comes off it. No frame checks — it is one picture.
        "verify": None,
    },
    "room_plate": {
        "model": MODEL,
        "size": "1536x1024", "quality": "medium", "background": "opaque",
        # The plate IS the walkable area: its silhouette becomes the collision
        # mask, so it is checked by room.py verify against the mask, not here.
        "verify": None,
    },
    "room_props": {
        "model": MODEL,
        "size": "1536x1024", "quality": "medium", "background": "opaque",
        # Props are cut apart by build_props.py, which uses real alpha if the
        # sheet has any and keys white otherwise — keying white would eat a
        # white marble statue.
        "verify": None,
    },
    "tileset_ground": {
        "model": MODEL,
        "size": "1536x1024", "quality": "medium", "background": "opaque",
        # Checked after cutting by verify_tiles.py (seams, flatness), because
        # the properties that matter only exist once a tile is cut and repeated.
        "verify": None,
    },
    "tileset_objects": {
        "model": MODEL,
        "size": "1536x1024", "quality": "medium", "background": "opaque",
        "verify": None,
    },

    # THE OTHER TWO KINDS OF ART A GAME NEEDS, BEYOND CHARACTERS/ROOMS/TILES.
    #
    # These used to be one unbounded "freeform" escape hatch — any prompt, any
    # size, any background, decided by whoever typed the workflow_dispatch
    # form. That is how Trebor ended up with 200 card icons on a transparent
    # background and 8 that were not: nothing said what a "card icon" was
    # SUPPOSED to be, so nothing could catch when one drifted from it.
    #
    # A KIND is a rule, not a request. Add one here whenever a game needs a
    # shape of art that doesn't fit an existing kind — a ship silhouette, a
    # card face, a UI badge — rather than reaching for raw flags. That is the
    # whole point of this table: the next "ship icon" gets a kind of its own
    # when it is needed, not a one-off prompt nobody can hold to a standard.
    "icon": {
        "model": MODEL, "size": "1024x1024", "quality": "medium",
        "background": "transparent",
        "verify": None,
        "note": "A single item dropped onto the game's own UI as a sprite — a "
                "card, a weapon, a ship, a badge. ALWAYS transparent: it has to "
                "sit on whatever background the UI already has, not carry its own.",
    },
    "cutscene": {
        "model": MODEL, "size": "1536x1024", "quality": "medium",
        "background": "opaque",
        "verify": None,
        "note": "Full-bleed narrative art meant to fill its own frame — a "
                "splash screen, a story illustration. Opaque on purpose: this "
                "is the one kind where the background IS the picture.",
    },
}

# Which kinds a human or model may ask for with NO dedicated front door — a
# one-off icon or cutscene, typed by hand. Character rows, room passes and
# tile sheets are NOT here: they have their own front doors (generate_row.py,
# room.py, tileset.py) that build the prompt from a spec and verify before
# anything ships, and imagegen.py's own `--kind` CLI choices are restricted to
# exactly this tuple so a person cannot reach for a raw `walk` or `room_scene`
# generation and skip that verification.
NO_FRONT_DOOR_KINDS = ("icon", "cutscene")

# Which kinds the THREE FRONT DOORS may generate as, when their request has to
# cross the broker. generate_row.py, room.py and tileset.py hold no API key of
# their own — a Clubhouse run deliberately keeps it out of the model's
# environment — so their own generations go through the same local broker as
# everything else, and the broker (.github/autopilot/image-broker.js) will
# only resolve a `kind` it can find in `profiles.FREEFORM_KINDS` by name. That
# file cannot import a differently-named constant, so this name has to be the
# one thing both "kinds with no front door" (safe from any caller) and "kinds
# ONLY the three front doors ask for" belong to. What actually keeps a raw
# curl from using a pipeline kind to clobber a SHIPPED sheet unverified is the
# broker's separate, unconditional refusal of any output path under
# `art-src/` — which is exactly why `imagegen._via_broker` stages a pipeline
# generation one directory outside `art-src/` and moves it into place itself
# once the broker has written it, rather than asking the broker to write
# there directly. See imagegen.py's `_via_broker` for that half of the fix.
PIPELINE_KINDS = ("walk", "attack", "room_scene", "room_plate", "room_props",
                  "tileset_ground", "tileset_objects")
FREEFORM_KINDS = NO_FRONT_DOOR_KINDS + PIPELINE_KINDS


def get(kind):
    if kind not in PROFILES:
        raise KeyError(f'no generation profile for "{kind}"; known: {", ".join(PROFILES)}')
    return PROFILES[kind]


def verify_args(kind, view):
    """The verify_sheet.py flags this kind and view should be checked with."""
    p = get(kind)
    v = p.get("verify")
    if not v:
        return None
    args = ["--frames", str(v["frames"])]
    if v.get("walk"):
        args.append("--walk")
    if v.get("blobs"):
        args.append("--blobs")
    if view in p.get("mirrored_views", []):
        args.append("--mirrored")
    if view in p.get("steps_built_views", []):
        args.append("--steps-built")
    return args


if __name__ == "__main__":
    if len(sys.argv) > 1:
        print(json.dumps(get(sys.argv[1]), indent=2))
        print("verify flags (front):", verify_args(sys.argv[1], "front"))
    else:
        for k, v in PROFILES.items():
            print(f'{k:16} {v["size"]}  {v["quality"]:6} bg={v["background"]:9} '
                  f'verify={"yes" if v.get("verify") else "later"}')
