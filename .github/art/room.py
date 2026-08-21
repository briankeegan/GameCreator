#!/usr/bin/env python3
"""One command for the whole room pipeline. See docs/ROOM_ART_STANDARD.md.

The standard is three passes and five scripts, which is four too many things to
remember at 11pm. This is the front door:

  room.py plate  <game> <room>   fit the pass-2 floor plate + rebuild its mask
  room.py props  <game> <room> <name>...   cut a pass-3 prop sheet
  room.py check  <game> <room>   render the overlays a human has to look at
  room.py verify <game>          the gate: every mistake we actually made
  room.py approve <game> <room>  sign off pass 1 — pass 2 and 3 refuse without it
  room.py prompt <pass>          print the canned prompt for a generation pass

`verify` is the one that runs in CI. Every check in it is a bug that shipped:

  * a plate that doesn't fill the frame — the floor is the mask, so a plate
    floating in the generator's margin is the ROOM being smaller than its own
    frame. Cost: a garden that read cramped and "much worse" than its scene.
  * playerStart inside its own exit trigger — doors stay disarmed until you
    step off them, so a spawn on a threshold means the door never arms and you
    can walk into it forever with nothing happening.
  * a prop whose footprint sits on a doorway, making the door unreachable.
  * a prop pointing at art that doesn't exist — renders as nothing, silently.
  * a flat prop carrying a `base`, or a standing prop missing one.
  * a floor-plate room still declaring floorPoly/obstacles — dead data that
    contradicts the mask and sends the next reader the wrong way.
  * a room nobody rendered the overlay for since its art last changed —
    the one step of the process with no gate was the one that kept being
    skipped, so now it has one.
  * a pass-1 COMPOSED SCENE shipped as the room background. It looks finished,
    so it is the tempting shortcut, and it throws away the mask, the depth and
    every prop's independence in one move.
  * art-style.json restating the room recipe — it is prepended to every pass
    prompt, so a stale copy there overrides the real one. Cost: a floor plate
    generated on a painted vignette instead of on flat white.
  * a mask that no longer matches its plate, i.e. someone changed the art and
    forgot to rebuild.
"""
import sys, os, re, subprocess, argparse
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 320, 200
PLATE_FILL_MIN = 0.55      # a plate should cover at least this much of the frame
DOOR_CLEARANCE = 12        # px a prop's footprint must keep off an exit trigger


def sh(*cmd):
    print("$ " + " ".join(str(c) for c in cmd))
    return subprocess.call([str(c) for c in cmd])


def floor_plate_rooms():
    src = open(os.path.join(HERE, "build_walkmask.py"), encoding="utf-8").read()
    m = re.search(r"FLOOR_PLATE_ROOMS\s*=\s*\{(.*?)\}", src, re.S)
    return set(re.findall(r'"([^"]+)"', m.group(1))) if m else set()


def read_room(game_dir, room):
    """The bits of a room's story.js entry this needs. A regex, not a parser:
    story.js is plain object literals and this only ever wants numbers."""
    src = open(os.path.join(game_dir, "story.js"), encoding="utf-8").read()
    try:
        start = src.index("\n    %s: {" % room)
    except ValueError:
        return None
    # The LAST room in ROOMS has no trailing comma, so "\n    }," never
    # matches it and verify used to die with a ValueError instead of checking
    # it. A gate that crashes on a valid file is worse than no gate: it does
    # not say what is wrong, and the room it cannot read is the one it never
    # checks.
    end = min(i for i in (src.find("\n    },", start), src.find("\n    }\n", start))
              if i != -1)
    block = src[start:end]

    def num(key, where=block):
        m = re.search(r"\b%s:\s*(-?\d+)" % key, where)
        return int(m.group(1)) if m else None

    props = []
    # FIELD ORDER MUST NOT MATTER. This regex once stopped at the nested
    # base: {...}, so `behind: true` written after it was invisible to every
    # check and to the preview — the lab's wall panels silently kept sorting
    # against the player and drew over the doorway they surround. The pattern
    # below spans the whole entry including nested objects.
    for m in re.finditer(r"\{\s*art:\s*\"([^\"]+)\"((?:[^{}]|\{[^{}]*\})*)\}", block):
        art, rest = m.group(1), m.group(2)
        base = None
        bm = re.search(r"base:\s*\{([^}]*)\}", rest)
        if bm:
            base = {k: int(v) for k, v in re.findall(r"(\w+):\s*(-?\d+)", bm.group(1))}
        props.append(dict(art=art, x=num("x", rest), y=num("y", rest), h=num("h", rest),
                          flat="flat: true" in rest, door="door: true" in rest,
                          behind="behind: true" in rest, base=base))

    exits = []
    em = re.search(r"exits:\s*\[(.*?)\n      \]", block, re.S)
    if em:
        for line in re.finditer(r"\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}", em.group(1)):
            t = line.group(1)
            if "arriveAt" in t and re.search(r"\bx:\s*-?\d+", t):
                exits.append({k: int(v) for k, v in re.findall(r"\b([xywh]):\s*(-?\d+)", t)[:4]})
            elif re.search(r"\bx:\s*-?\d+", t):
                exits.append({k: int(v) for k, v in re.findall(r"\b([xywh]):\s*(-?\d+)", t)[:4]})

    ps = re.search(r"playerStart:\s*\{\s*x:\s*(-?\d+),\s*y:\s*(-?\d+)", block)
    return dict(props=props, exits=exits,
                playerStart=(int(ps.group(1)), int(ps.group(2))) if ps else None,
                has_floorpoly="floorPoly:" in block,
                has_obstacles=re.search(r"obstacles:\s*\[\s*\{", block) is not None)


# A room's walk mask must be exactly what its CURRENT art produces. Checking
# that by content, not by timestamps: a timestamp check cried wolf the first
# time it saw a revert (art restored to its original bytes, mask identical,
# but the commit was newer), and it can't see an art change committed in the
# same commit as a stale mask either. Rebuild it in memory and compare.
#
# Until now this was only checked for floor-plate rooms — which left the
# LEGACY rooms, still the majority, with no check at all. bg-lounge.png was
# regenerated through the wrong Action, landed, and nothing objected: the
# mask, the floorPoly and every obstacle in that room still described the
# picture it had replaced.
def stale_masks(game_dir):
    art = os.path.join(game_dir, "art")
    if not os.path.isdir(art):
        return []
    sys.path.insert(0, HERE)
    try:
        import build_walkmask as bw
    except Exception as e:
        return ["could not import build_walkmask (%s) — mask freshness unchecked" % e]
    from PIL import Image
    out = []
    for name in sorted(os.listdir(art)):
        if not name.startswith("bg-") or not name.endswith(".png"):
            continue
        room = name[3:-4]
        mask_path = os.path.join(art, "walk-%s.png" % room)
        if not os.path.exists(mask_path):
            continue      # not every bg- is a room: cutscene backdrops share the prefix
        if room not in bw.FLOOR_PLATE_ROOMS and room not in bw.ROOMS:
            continue      # a background with a mask but no recipe — nothing to compare against
        try:
            want = rebuild_mask(bw, game_dir, room)
        except Exception as e:
            out.append("%s: could not rebuild its mask to compare (%s)" % (room, e))
            continue
        have = np.asarray(Image.open(mask_path).convert("L")) > 127
        if want.shape != have.shape:
            out.append("%s: walk-%s.png is %s, the art makes %s" % (room, room, have.shape, want.shape))
        elif int((want ^ have).sum()) > 64:
            out.append("%s: walk-%s.png doesn't match what bg-%s.png produces (%d px differ) "
                       "— the art changed and the mask wasn't rebuilt. Run "
                       "`python3 .github/art/build_walkmask.py %s %s`."
                       % (room, room, room, int((want ^ have).sum()), game_dir, room))
    return out


def rebuild_mask(bw, game_dir, room):
    """What build_walkmask would write for `room`, as an array, without writing."""
    from PIL import Image, ImageDraw, ImageFilter
    src = os.path.join(game_dir, "art", "bg-%s.png" % room)
    alpha = Image.open(src).convert("RGBA").resize((bw.W, bw.H), Image.BILINEAR).split()[3]
    mask = alpha.point(lambda a: 255 if a > 40 else 0)
    if room not in bw.FLOOR_PLATE_ROOMS:
        spec = bw.ROOMS[room]
        draw = ImageDraw.Draw(mask)
        draw.rectangle([0, 0, bw.W, spec["floorTop"]], fill=0)
        if spec.get("bounds"):
            x0, y0, x1, y1 = spec["bounds"]
            draw.rectangle([0, 0, x0, bw.H], fill=0)
            draw.rectangle([x1, 0, bw.W, bw.H], fill=0)
            draw.rectangle([0, y1, bw.W, bw.H], fill=0)
        for poly in spec["blocks"]:
            draw.polygon(poly, fill=0)
    for _ in range(bw.EROSION):
        mask = mask.filter(ImageFilter.MinFilter(3))
    return np.asarray(mask.convert("1").convert("L")) > 127


# The game's art-style.json is prepended to EVERY prompt for that game, pass
# prompts included — so anything it says about how a room is built wins over
# the pass prompt it is sitting in front of. It drifted exactly that way once:
# it still described the old TWO-LAYER room ("a ROOM GROUND PLATE: a complete
# floor AND ITS SURROUNDING ARCHITECTURE", "a door MUST be on the back-right
# wall") long after the standard became three passes, and the lounge's pass-2
# plate duly came back as planks in a painted brown vignette — which keys to
# nothing, so the whole frame would have been walkable.
#
# So: art-style.json carries the CAMERA, the RENDERING and the PALETTE. The
# recipe lives in .github/art/room_prompts/ and docs/ROOM_ART_STANDARD.md, in
# one copy. This fails the build on the vocabulary that only the recipe has any
# business using — a word list, so it is a fact and not a judgement call.
# Phrases only the recipe uses. Deliberately NOT the bare word "walkable" —
# "a clearly readable walkable space" is a fair thing for a style to ask for,
# and a check that fires on a correct file is worse than no check (see the
# threshold note in verify_sheet.py). Each of these names a mechanism instead.
STYLE_MUST_NOT_SAY = [
    "ground plate", "layer 1", "layer 2", "two layers", "back-right wall",
    "walk mask", "walkable-floor mask", "walkable floor mask", "collision",
    "build_props", "exit trigger", "walkable exit",
]


# A pass-1 composed scene is MEASURED and NEVER SHIPPED. It is the one rule of
# the three-pass standard with the most obvious shortcut behind it: the scene
# is a finished-looking picture of the room, so copying it to art/bg-<room>.png
# "works" — the room looks right immediately, and every cost lands later. The
# floor cannot be recovered from it (build_walkmask.py records the five
# techniques that failed), the scenery is paint so you can never walk behind
# it, the water can never move, and moving one object means regenerating the
# whole picture. That is the entire reason the standard exists.
#
# Prose did not stop it: this check exists because shipping the scene was
# proposed out loud, as a saving, by someone who had just read the standard.
SCENE_SHIP_TOL = 0.045      # mean per-channel difference, 0-1, over the frame


def shipped_scenes(game_dir):
    art = os.path.join(game_dir, "art")
    src = os.path.join(game_dir, "art-src")
    if not (os.path.isdir(art) and os.path.isdir(src)):
        return []
    out = []
    for name in sorted(os.listdir(src)):
        if not name.endswith("_scene.png"):
            continue
        room = name[:-len("_scene.png")]
        bg = os.path.join(art, "bg-%s.png" % room)
        if not os.path.exists(bg):
            continue
        try:
            a = np.asarray(Image.open(bg).convert("RGB").resize((W, H), Image.LANCZOS)).astype(float)
            b = np.asarray(Image.open(os.path.join(src, name)).convert("RGB")
                           .resize((W, H), Image.LANCZOS)).astype(float)
        except Exception as e:
            out.append("%s: could not compare bg against its scene (%s)" % (room, e))
            continue
        diff = float(np.abs(a - b).mean()) / 255.0
        if diff < SCENE_SHIP_TOL:
            out.append("%s: art/bg-%s.png IS art-src/%s (mean difference %.3f, "
                       "under %.3f). A composed scene is pass 1 — it is MEASURED "
                       "and never shipped. The shipped background is pass 2, the "
                       "walkable surface and nothing else, because its silhouette "
                       "is the collision mask. See docs/ROOM_ART_STANDARD.md and "
                       "run `room.py plate %s %s`."
                       % (room, room, name, diff, SCENE_SHIP_TOL, game_dir, room))
    return out


# EVERY ROOM HAS A SAVED SPEC, THE WAY EVERY CHARACTER HAS ONE.
#
# A character's look does not live in whatever prompt somebody typed that day —
# it lives in art-style.json's lockedDetails and lockedColours, because details
# retyped from memory drift (Beverly's ears kept coming back brown). Rooms had
# no such thing. Every regeneration was a fresh paragraph typed by hand, so the
# Lounge came back three times with three different walls, and once with a
# right-hand door and no left-hand one — because the paragraph that mentioned
# the left-hand door was not the paragraph that got sent.
#
# So a room is a file: games/<id>/rooms/<room>.json
#
#   name      what the room is called in game
#   summary   what the room IS, one or two sentences
#   floor     what the player walks on — this is pass 2's whole prompt
#   doors     one entry per way out: which WALL it is in and what it looks
#             like. THE MAP DECIDES THESE. A room asked for without them gets
#             doors wherever the generator feels like putting them.
#   contains  the things standing in the room — these become pass 3's sheet
#
# All three passes are built from it, so regenerating a room is the same
# request every time and the map cannot drift out of the art.
def spec_path(game_dir, room):
    return os.path.join(game_dir, "rooms", "%s.json" % room)


def load_spec(game_dir, room):
    import json
    try:
        return json.load(open(spec_path(game_dir, room), encoding="utf-8"))
    except OSError:
        return None


WALL_PHRASE = {
    "back": "in the BACK WALL",
    "back-left": "in the BACK WALL, left of centre",
    "back-right": "in the BACK WALL, right of centre",
    "left": "at the FAR LEFT EDGE of the frame, in the left-hand side wall, "
            "seen edge-on with its face turned to the right",
    "right": "at the FAR RIGHT EDGE of the frame, in the right-hand side wall, "
             "seen edge-on with its face turned to the left",
    "near": "a gap in the low rail along the NEAR EDGE, where the floor runs "
            "off the bottom of the picture toward the viewer",
}


def spec_doors(spec):
    parts = []
    for d in spec.get("doors", []):
        where = WALL_PHRASE.get(d.get("wall", "back"), d.get("wall", ""))
        parts.append("%s %s" % (d.get("look", "an open doorway"), where))
    if not parts:
        return "NO door and NO doorway anywhere in any wall — the walls are unbroken."
    return ("The ways out of this room, and there are no others: "
            + "; ".join(parts) + ".")


def spec_scene_desc(spec):
    return "%s %s %s The floor is %s." % (
        spec.get("summary", ""), spec_doors(spec),
        (" ".join(spec.get("contains", []))), spec.get("floor", "a plain floor"))


# PASS 1 IS A DECISION POINT, NOT A STEP TO WALK PAST.
#
# Everything downstream is measured off the composed scene, so a scene that is
# wrong makes every later pass wrong too — and none of it is repairable. The
# Victorian bedroom's first scene came back an isometric CORNER room. Before
# anyone noticed, it had been given a floor plate, three prop sheets and two
# full assemblies, all of which had to be thrown away, because a rectangular
# plate does not fit a diamond floor and props measured off a corner view land
# at the wrong depth.
#
# The cost is entirely front-loaded and entirely avoidable: LOOK at the scene,
# and if it is not right, regenerate the scene and nothing else. So pass 2 and
# pass 3 refuse to run until someone has recorded that they looked.
#
#   room.py approve <game> <room>     after opening art-src/<room>_scene.png
#
# The approval is a digest of that scene, so regenerating it revokes it.
def scene_ok_path(game_dir, room):
    return os.path.join(game_dir, "art-src", "%s_scene_ok.txt" % room)


def scene_digest(game_dir, room):
    import hashlib
    path = os.path.join(game_dir, "art-src", "%s_scene.png" % room)
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def scene_approved(game_dir, room):
    want = scene_digest(game_dir, room)
    if want is None:
        return False
    try:
        return open(scene_ok_path(game_dir, room), encoding="utf-8").read().strip() == want
    except OSError:
        return False


def style_drift(game_dir):
    path = os.path.join(game_dir, "art-style.json")
    if not os.path.exists(path):
        return []
    import json
    st = json.load(open(path, encoding="utf-8"))
    out = []
    for field in ("camera", "style", "palette", "background", "constraints"):
        body = (st.get(field) or "").lower()
        for phrase in STYLE_MUST_NOT_SAY:
            if phrase in body:
                out.append("art-style.json: %s says %r — that is the room RECIPE, "
                           "which lives in .github/art/room_prompts/ and "
                           "docs/ROOM_ART_STANDARD.md. This file is prepended to "
                           "every pass prompt, so a stale copy here overrides the "
                           "real one. Carry the camera, the rendering and the "
                           "palette; point at the standard for the rest."
                           % (field, phrase))
    return out


# THE OVERLAY IS A STEP OF THE PROCESS, SO IT IS GATED LIKE ONE.
#
# `room.py check` renders the assembled room beside the scene it was measured
# from, and the standard calls it "the step that finds things". It is also the
# step most easily skipped, because skipping it costs nothing at the time and
# everything later: props at two thirds size, a rug that was never made, a
# camera that was wrong three passes back. Every one of those shipped, was
# invisible in the numbers, and was obvious in one glance at the side-by-side.
#
# Prose did not make it happen. So `check` now records WHAT IT LOOKED AT — a
# digest of the plate, every prop the room places, and the scene — and verify
# fails when that record is missing or no longer matches. You cannot ship a
# room whose art changed after the last time somebody rendered the overlay.
#
# It cannot force a person to actually look. It can guarantee there was a
# current picture in front of them, which is the part a machine can check.
def room_digest(game_dir, room):
    import hashlib
    h = hashlib.sha256()
    art = os.path.join(game_dir, "art")
    paths = [os.path.join(art, "bg-%s.png" % room),
             os.path.join(game_dir, "art-src", "%s_scene.png" % room)]
    r = read_room(game_dir, room)
    for pr in (r["props"] if r else []):
        paths.append(os.path.join(art, pr["art"] + ".png"))
    for path in paths:
        h.update(os.path.basename(path).encode())
        try:
            with open(path, "rb") as f:
                h.update(f.read())
        except OSError:
            h.update(b"<missing>")
    # the placement numbers matter too: moving a prop changes the picture
    h.update(repr(r["props"] if r else []).encode())
    return h.hexdigest()


def checked_path(game_dir, room):
    return os.path.join(game_dir, "art-src", "%s_checked.txt" % room)


def rendered_path(game_dir, room):
    return os.path.join(game_dir, "art-src", "%s_rendered.txt" % room)


def unchecked_rooms(game_dir):
    out = []
    for room in sorted(floor_plate_rooms()):
        if read_room(game_dir, room) is None:
            continue
        want = room_digest(game_dir, room)
        path = checked_path(game_dir, room)
        try:
            have = open(path, encoding="utf-8").read().strip()
        except OSError:
            have = None
        if have != want:
            out.append("%s: nobody has signed off this room since its art last "
                       "changed. Run `python3 .github/art/room.py check %s %s`, "
                       "OPEN the side-by-side it writes, fix what it shows you — "
                       "it is the step that finds props at the wrong size, "
                       "scenery the scene has and the room does not, and a "
                       "camera that was wrong three passes ago — and then "
                       "`room.py signoff %s %s`. Rendering is not looking, so "
                       "check alone does not clear this."
                       % (room, game_dir, room, game_dir, room))
    return out


def verify(game_dir):
    problems = []
    problems += style_drift(game_dir)
    problems += shipped_scenes(game_dir)
    problems += stale_masks(game_dir)
    problems += unchecked_rooms(game_dir)
    plate_rooms = floor_plate_rooms()
    art = os.path.join(game_dir, "art")
    for room in sorted(plate_rooms):
        r = read_room(game_dir, room)
        if r is None:
            problems.append("%s: in FLOOR_PLATE_ROOMS but not a room in story.js" % room)
            continue

        # the plate fills the frame
        pp = os.path.join(art, "bg-%s.png" % room)
        if not os.path.exists(pp):
            problems.append("%s: no bg-%s.png" % (room, room))
        else:
            a = np.asarray(Image.open(pp).convert("RGBA").resize((W, H), Image.LANCZOS))
            fill = float((a[..., 3] > 40).mean())
            if fill < PLATE_FILL_MIN:
                problems.append("%s: floor plate covers only %.0f%% of the frame — run "
                                "room.py plate (the plate IS the walkable area, so this "
                                "is the room being smaller than its own frame)"
                                % (room, fill * 100))
            # mask matches plate
            mp = os.path.join(art, "walk-%s.png" % room)
            if not os.path.exists(mp):
                problems.append("%s: no walk-%s.png — run room.py plate" % (room, room))
            else:
                mask = np.asarray(Image.open(mp).convert("L").resize((W, H), Image.NEAREST)) > 127
                plate = a[..., 3] > 40
                # the mask is the plate eroded, so it must be a near-subset of it
                stray = int((mask & ~plate).sum())
                if stray > 200:
                    problems.append("%s: walk mask has %d px outside its floor plate — "
                                    "the art changed and the mask wasn't rebuilt"
                                    % (room, stray))

        # dead collision data
        if r["has_floorpoly"]:
            problems.append("%s: floor-plate room still declares floorPoly — dead data "
                            "that contradicts the mask" % room)
        if r["has_obstacles"]:
            problems.append("%s: floor-plate room still declares obstacles — props carry "
                            "their own footprints" % room)

        # playerStart must not sit in an exit trigger
        if r["playerStart"] and r["exits"]:
            px, py = r["playerStart"]
            for ex in r["exits"]:
                if all(k in ex for k in "xywh"):
                    if (px + 14 > ex["x"] and px < ex["x"] + ex["w"] and
                            py + 18 > ex["y"] and py < ex["y"] + ex["h"]):
                        problems.append("%s: playerStart (%d,%d) is inside an exit trigger "
                                        "— the door never arms" % (room, px, py))

        for p in r["props"]:
            path = os.path.join(art, p["art"] + ".png")
            if not os.path.exists(path):
                problems.append("%s: prop '%s' has no art at %s" % (room, p["art"], path))
            if p["flat"] and p["base"]:
                problems.append("%s: flat prop '%s' has a base — flat ground cover is "
                                "walked over" % (room, p["art"]))
            # A prop marked door: true IS a doorway. It deliberately has no
            # footprint (you walk into it to go through) and its own exit
            # trigger sits ON it, so both of the checks below would fire on a
            # correct room. Putting the trigger on the floor UNDER the door
            # instead is what made doors read as being in the wrong place.
            # behind: true means the prop is drawn with the background — it is
            # part of the WALL (a shelf hung on it, a doorway through it), and
            # the wall panels it sits on already carry the footprint. Requiring
            # it to block again would put an invisible wall in front of the
            # wall.
            if not p["flat"] and not p["base"] and not p["door"] and not p["behind"]:
                problems.append("%s: standing prop '%s' has no base — you walk through it"
                                % (room, p["art"]))
            # a footprint on a doorway makes the door unreachable
            if p["base"] and p["x"] is not None and not p["door"]:
                if "w" in p["base"]:
                    hw, hh = p["base"]["w"] / 2, p["base"]["h"] / 2
                else:
                    hw, hh = p["base"].get("rx", 0), p["base"].get("ry", 0)
                for ex in r["exits"]:
                    if not all(k in ex for k in "xywh"):
                        continue
                    dx = max(ex["x"] - (p["x"] + hw), p["x"] - hw - (ex["x"] + ex["w"]), 0)
                    dy = max(ex["y"] - (p["y"] + hh), p["y"] - hh - (ex["y"] + ex["h"]), 0)
                    if dx == 0 and dy == 0:
                        problems.append("%s: prop '%s' footprint covers an exit trigger "
                                        "at (%d,%d) — the door can't be reached"
                                        % (room, p["art"], ex["x"], ex["y"]))
                        break
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("plate", help="fit the floor plate and rebuild its mask")
    p.add_argument("game"); p.add_argument("room")
    p.add_argument("--src"); p.add_argument("--margin", type=int, default=3)

    p = sub.add_parser("props", help="cut a prop sheet")
    p.add_argument("game"); p.add_argument("room"); p.add_argument("names", nargs="+")
    p.add_argument("--src")
    p.add_argument("--trim-bottom", type=float, default=0,
                   help="drop this %% off the bottom of every prop — for a sheet "
                        "that drew a scrap of ground under each item")

    p = sub.add_parser("check", help="render the overlays a human has to look at")
    p.add_argument("game"); p.add_argument("room")
    p.add_argument("--out", default="/tmp")

    p = sub.add_parser("approve", help="record that you have LOOKED at pass 1 "
                                       "and it is right — unlocks pass 2 and 3")
    p.add_argument("game"); p.add_argument("room")

    p = sub.add_parser("signoff", help="record that you have LOOKED at the "
                                       "assembled room and it is right")
    p.add_argument("game"); p.add_argument("room")

    p = sub.add_parser("verify", help="the CI gate")
    p.add_argument("game")

    p = sub.add_parser("prompt", help="print the canned prompt for a pass")
    p.add_argument("which", choices=["scene", "plate", "props"])
    p.add_argument("--room", default="{{ROOM}}")
    p.add_argument("--floor", default="{{FLOOR}}")
    p.add_argument("--n", default="{{N}}")
    p.add_argument("--items", default="{{ITEMS}}")

    p = sub.add_parser("generate", help="generate one pass into its canonical path")
    p.add_argument("game"); p.add_argument("room")
    p.add_argument("which", choices=["scene", "plate", "props"])
    # The room id names the FILE; this says what is actually IN the room. They
    # used to be the same string, so the only way to describe a room to the
    # generator was to put the description in its id — which then named the
    # file too. Pass 1 gets "lounge — the room as a complete scene", which is
    # not enough to draw a lounge from.
    p.add_argument("--doors", default="",
                   help="PASS 1, required: which WALL each way out is in, e.g. "
                        "'a door in the LEFT wall, an arch in the BACK wall left "
                        "of centre'. The map decides these; asked without them "
                        "the generator puts doors where it likes, which is how "
                        "the Lounge came back with a right-hand door and no "
                        "left-hand one.")
    p.add_argument("--desc", default="",
                   help="what the room contains (pass 1). Defaults to the room id.")
    p.add_argument("--floor", default="", help="what the floor is made of (pass 2)")
    p.add_argument("--n", default="", help="how many props are on the sheet (pass 3)")
    p.add_argument("--items", default="", help="what the props are (pass 3)")
    p.add_argument("--quality", default="medium", choices=["low", "medium", "high"])
    p.add_argument("--force", action="store_true",
                   help="regenerate (and re-bill) even if the file already exists")

    a = ap.parse_args()

    # WHERE EACH PASS LANDS. plate and props are read back by `room.py plate`
    # and `room.py props`, so the names are not a convention to remember — they
    # are the contract between the passes. The scene is never shipped: it is
    # the thing you MEASURE, and `check` puts it beside the assembled room.
    PASS_PATH = {"scene": "%s_scene.png", "plate": "%s_floor.png",
                 "props": "%s_props.png"}

    def pass_template(which):
        f = {"scene": "1_composed_scene.txt", "plate": "2_floor_plate.txt",
             "props": "3_prop_sheet.txt"}[which]
        return open(os.path.join(HERE, "room_prompts", f), encoding="utf-8").read()

    # The game's camera, palette and rendering, exactly as
    # generate-game-asset.yml assembles them. room.py did NOT do this: its
    # prompts went to imagegen.py unstyled, while imagegen.py's own comment
    # promised "every prompt that reaches here was already built from that
    # same art-style.json by its front door". The pass-1 prompt file still
    # said to run it through "Generate game asset" — which is where the
    # styling lived — so when room.py generate was added, the camera was
    # quietly dropped. It cost a Lounge scene rendered at eye level, in a
    # game where every other room is top-down.
    def styled(game_dir, body):
        path = os.path.join(game_dir, "art-style.json")
        if not os.path.exists(path):
            print("error: no %s — a room needs the game's camera and palette, or it "
                  "comes back in a different world from every other room." % path,
                  file=sys.stderr)
            raise SystemExit(1)
        import json
        st = json.load(open(path, encoding="utf-8"))
        return ("%s %s. %s Color palette: %s Background: %s %s"
                % (st.get("camera", ""), body, st.get("style", ""),
                   st.get("palette", ""), st.get("background", ""),
                   st.get("constraints", "")))

    def pass_prompt(which, room, floor, n, items, strip_notes=False):
        text = pass_template(which)
        if strip_notes:
            # The leading # block is guidance for whoever is reading the file,
            # not part of the prompt. Sending it to the generator asks it to
            # draw the instructions.
            text = "\n".join(l for l in text.splitlines() if not l.startswith("#"))
        for k, v in (("{{ROOM}}", room), ("{{FLOOR}}", floor),
                     ("{{N}}", n), ("{{ITEMS}}", items)):
            text = text.replace(k, v)
        return text.strip()

    if a.cmd == "prompt":
        print(pass_prompt(a.which, a.room, a.floor, a.n, a.items))
        return 0

    game = a.game.rstrip("/")

    if a.cmd == "approve":
        d = scene_digest(game, a.room)
        if d is None:
            print("no composed scene at games/.../art-src/%s_scene.png — "
                  "generate pass 1 first" % a.room, file=sys.stderr)
            return 1
        with open(scene_ok_path(game, a.room), "w", encoding="utf-8") as f:
            f.write(d + "\n")
        print("approved %s's composed scene. pass 2 and pass 3 are unlocked "
              "until it is regenerated." % a.room)
        return 0

    if a.cmd == "generate":
        if a.which in ("plate", "props") and not scene_approved(game, a.room):
            print("REFUSING: nobody has signed off %s's composed scene.\n"
                  "  Everything downstream is MEASURED off it, so a wrong scene "
                  "makes every later pass wrong and none of it is repairable — "
                  "a corner-view scene once cost a plate, three prop sheets and "
                  "two assemblies before anyone noticed.\n"
                  "  Open games/%s/art-src/%s_scene.png. If it is right, run:\n"
                  "    python3 .github/art/room.py approve %s %s\n"
                  "  If it is not, regenerate THE SCENE and nothing else."
                  % (a.room, os.path.basename(game), a.room, game, a.room),
                  file=sys.stderr)
            return 1

        # Same transport as characters: an in-run broker if one is listening,
        # otherwise OPENAI_API_KEY. See .github/art/imagegen.py. This exists so
        # that "redo the room" is the same shape of job as "redo the walk
        # cycle" — before it, rooms could only PRINT a prompt, and whoever
        # asked had to carry the text to a generator by hand and save the
        # result to exactly the right filename for the next pass to find it.
        sys.path.insert(0, HERE)
        import imagegen, profiles
        prof = profiles.get("room_" + a.which)
        # Check the ARGUMENTS, not the filled text: substituting an empty
        # string removes the placeholder, so "is {{FLOOR}} still in there?"
        # can never catch a missing one. What reaches the generator instead is
        # a sentence with a hole in it, and it draws something to fill it.
        # RESOLVE FROM THE SPEC FIRST. The placeholder check below reads these
        # values, so filling them in afterwards meant every spec-driven pass 2
        # and pass 3 was rejected for "needs --floor" while the answer sat in
        # the room's own spec file.
        spec = load_spec(game, a.room)
        if spec is None:
            print("REFUSING: games/%s/rooms/%s.json does not exist.\n"
                  "  Every room has a saved spec, the way every character has "
                  "lockedDetails — what the room is, what it contains, what its "
                  "floor is, and WHICH WALL each way out is in. A prompt retyped "
                  "from memory is how the same room comes back three times with "
                  "three different walls and a door on the wrong side.\n"
                  "  Write it, then generate."
                  % (os.path.basename(game), a.room), file=sys.stderr)
            return 1
        desc = (a.desc or "").strip() or spec_scene_desc(spec)
        floor = (a.floor or "").strip() or spec.get("floor", "")
        # The room's own back wall is a prop like everything else, and it goes
        # FIRST on the sheet so it is never the thing that gets forgotten.
        sheet = ([spec["wall"]] if spec.get("wall") else []) + spec.get("contains", [])
        items = (a.items or "").strip() or "; ".join(sheet)
        n = (a.n or "").strip() or str(len(sheet) or 2)

        template = pass_template(a.which)
        need = {"{{ROOM}}": ("room name", desc), "{{FLOOR}}": ("--floor or spec.floor", floor),
                "{{N}}": ("--n", n), "{{ITEMS}}": ("--items or spec.contains", items)}
        missing = [name for k, (name, val) in need.items()
                   if k in template and not str(val).strip()]
        if missing:
            print("error: the %s prompt needs %s. Run `room.py prompt %s` to see "
                  "what it is asking for." % (a.which, ", ".join(missing), a.which),
                  file=sys.stderr)
            return 1
        out = os.path.join(a.game.rstrip("/"), "art-src",
                           PASS_PATH[a.which] % a.room)
        prompt = styled(a.game.rstrip("/"),
                        pass_prompt(a.which, desc, floor, n, items,
                                    strip_notes=True))
        if not imagegen.generate(" ".join(prompt.split()), out,
                                 size=prof["size"], quality=a.quality or prof["quality"],
                                 force=a.force, background=prof["background"],
                                 model=prof["model"]):
            return 0
        print("\nwrote %s" % out)
        nxt = {"scene": "MEASURE it — every prop's ground point, height, width "
                        "and COUNT comes off this image. It is never shipped.",
               "plate": "room.py plate %s %s   (fits it and rebuilds the mask)"
                        % (a.game, a.room),
               "props": "room.py props %s %s <name>... (left to right)"
                        % (a.game, a.room)}[a.which]
        print("next: %s" % nxt)
        return 0

    if a.cmd == "plate":
        src = a.src or os.path.join(game, "art-src", "%s_floor.png" % a.room)
        scene = os.path.join(game, "art-src", "%s_scene.png" % a.room)
        extra = ["--match", scene] if os.path.exists(scene) else []
        rc = sh("python3", os.path.join(HERE, "fit_plate.py"), src,
                os.path.join(game, "art", "bg-%s.png" % a.room),
                "--margin", a.margin, *extra)
        if rc: return rc
        return sh("python3", os.path.join(HERE, "build_walkmask.py"), game, a.room)

    if a.cmd == "props":
        src = a.src or os.path.join(game, "art-src", "%s_props.png" % a.room)
        extra = ["--trim-bottom", a.trim_bottom] if a.trim_bottom else []
        return sh("python3", os.path.join(HERE, "build_props.py"), src,
                  os.path.join(game, "art"), *extra, *a.names)

    if a.cmd == "check":
        scene = os.path.join(game, "art-src", "%s_scene.png" % a.room)
        sh("python3", os.path.join(HERE, "show_walkmask.py"), game, a.room,
           os.path.join(a.out, "walk-%s.png" % a.room))
        if os.path.exists(scene):
            rc = sh("python3", os.path.join(HERE, "preview_room.py"), game, a.room,
                    "--scene", scene, "--mode", "side",
                    "--out", os.path.join(a.out, "side-%s.png" % a.room))
        else:
            print("no composed scene at %s — pass 1 is what you measure from, keep it"
                  % scene)
            rc = sh("python3", os.path.join(HERE, "preview_room.py"), game, a.room,
                    "--out", os.path.join(a.out, "room-%s.png" % a.room))
        # rc, not a bare print: `check` used to announce "LOOK AT THESE" even
        # when preview_room.py had died and rendered nothing, which is the
        # worst possible outcome for the one step whose entire job is to make
        # a person look at a picture.
        if rc:
            print("\nthe overlay did NOT render — fix that before trusting anything above",
                  file=sys.stderr)
            return rc
        # RENDERING IS NOT LOOKING. This used to write the sign-off digest
        # right here, which meant the gate asking "has anyone looked at this
        # room?" was satisfied by running the renderer — nobody had to open
        # the picture. It was caught the only way it could be: the files
        # turned up as unexpected uncommitted changes after a session ran
        # `check` on three rooms it had NOT approved, one of which was
        # visibly wrong (planks at the wrong scale, the scene's four-stool
        # tables rendered as a single stool).
        #
        # So `check` records only that the overlay was rendered for THIS
        # art, and `signoff` is the separate, deliberate act. signoff refuses
        # unless this marker matches, so you cannot sign off a room you never
        # rendered either.
        with open(rendered_path(game, a.room), "w", encoding="utf-8") as f:
            f.write(room_digest(game, a.room) + "\n")
        print("\nLOOK AT THESE. The side-by-side is the step that finds things.")
        print("When you have LOOKED and it is right:")
        print("  python3 .github/art/room.py signoff %s %s" % (game, a.room))
        return 0

    if a.cmd == "signoff":
        want = room_digest(game, a.room)
        try:
            rendered = open(rendered_path(game, a.room), encoding="utf-8").read().strip()
        except OSError:
            rendered = None
        if rendered != want:
            print("nothing to sign off: the overlays have not been rendered for "
                  "%s's current art. Run\n"
                  "  python3 .github/art/room.py check %s %s\n"
                  "then OPEN what it writes, and come back." % (a.room, game, a.room),
                  file=sys.stderr)
            return 1
        with open(checked_path(game, a.room), "w", encoding="utf-8") as f:
            f.write(want + "\n")
        print("signed off %s. This says a person looked at the side-by-side and "
              "it was right — it will go stale the moment the art or the props "
              "change." % a.room)
        return 0

    if a.cmd == "verify":
        problems = verify(game)
        for p in problems:
            print("FAIL %s" % p)
        if problems:
            print("\n%d problem(s). See docs/ROOM_ART_STANDARD.md" % len(problems))
            return 1
        print("OK — every floor-plate room in %s checks out." % game)
        return 0

    # NO SUBCOMMAND HANDLED IT. This is not reachable through normal use —
    # argparse rejects an unknown command — but it is exactly what happens when
    # an edit detaches a branch's body from its `if`, which is how `generate`
    # came to print nothing, generate nothing and exit 0. A front door that
    # reports success having done nothing is the failure this repo has paid for
    # more than once, so the fall-through is loud.
    print("room.py: nothing handled %r — a subcommand's body has been detached "
          "from its branch." % a.cmd, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
