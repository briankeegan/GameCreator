#!/usr/bin/env python3
"""One command for the whole room pipeline. See docs/ROOM_ART_STANDARD.md.

The standard is three passes and five scripts, which is four too many things to
remember at 11pm. This is the front door:

  room.py plate  <game> <room>   fit the pass-2 floor plate + rebuild its mask
  room.py props  <game> <room> <name>...   cut a pass-3 prop sheet
  room.py check  <game> <room>   render the overlays a human has to look at
  room.py verify <game>          the gate: every mistake we actually made
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
    end = src.index("\n    },", start)
    block = src[start:end]

    def num(key, where=block):
        m = re.search(r"\b%s:\s*(-?\d+)" % key, where)
        return int(m.group(1)) if m else None

    props = []
    for m in re.finditer(r"\{\s*art:\s*\"([^\"]+)\"((?:[^{}]|\{[^{}]*\})*)\}", block):
        art, rest = m.group(1), m.group(2)
        base = None
        bm = re.search(r"base:\s*\{([^}]*)\}", rest)
        if bm:
            base = {k: int(v) for k, v in re.findall(r"(\w+):\s*(-?\d+)", bm.group(1))}
        props.append(dict(art=art, x=num("x", rest), y=num("y", rest), h=num("h", rest),
                          flat="flat: true" in rest, base=base))

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


def verify(game_dir):
    problems = []
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
            if not p["flat"] and not p["base"]:
                problems.append("%s: standing prop '%s' has no base — you walk through it"
                                % (room, p["art"]))
            # a footprint on a doorway makes the door unreachable
            if p["base"] and p["x"] is not None:
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

    p = sub.add_parser("check", help="render the overlays a human has to look at")
    p.add_argument("game"); p.add_argument("room")
    p.add_argument("--out", default="/tmp")

    p = sub.add_parser("verify", help="the CI gate")
    p.add_argument("game")

    p = sub.add_parser("prompt", help="print the canned prompt for a pass")
    p.add_argument("which", choices=["scene", "plate", "props"])
    p.add_argument("--room", default="{{ROOM}}")
    p.add_argument("--floor", default="{{FLOOR}}")
    p.add_argument("--n", default="{{N}}")
    p.add_argument("--items", default="{{ITEMS}}")

    a = ap.parse_args()

    if a.cmd == "prompt":
        f = {"scene": "1_composed_scene.txt", "plate": "2_floor_plate.txt",
             "props": "3_prop_sheet.txt"}[a.which]
        text = open(os.path.join(HERE, "room_prompts", f), encoding="utf-8").read()
        for k, v in (("{{ROOM}}", a.room), ("{{FLOOR}}", a.floor),
                     ("{{N}}", a.n), ("{{ITEMS}}", a.items)):
            text = text.replace(k, v)
        print(text)
        return 0

    game = a.game.rstrip("/")

    if a.cmd == "plate":
        src = a.src or os.path.join(game, "art-src", "%s_floor.png" % a.room)
        rc = sh("python3", os.path.join(HERE, "fit_plate.py"), src,
                os.path.join(game, "art", "bg-%s.png" % a.room), "--margin", a.margin)
        if rc: return rc
        return sh("python3", os.path.join(HERE, "build_walkmask.py"), game, a.room)

    if a.cmd == "props":
        src = a.src or os.path.join(game, "art-src", "%s_props.png" % a.room)
        return sh("python3", os.path.join(HERE, "build_props.py"), src,
                  os.path.join(game, "art"), *a.names)

    if a.cmd == "check":
        scene = os.path.join(game, "art-src", "%s_scene.png" % a.room)
        sh("python3", os.path.join(HERE, "show_walkmask.py"), game, a.room,
           os.path.join(a.out, "walk-%s.png" % a.room))
        if os.path.exists(scene):
            sh("python3", os.path.join(HERE, "preview_room.py"), game, a.room,
               "--scene", scene, "--mode", "side",
               "--out", os.path.join(a.out, "side-%s.png" % a.room))
        else:
            print("no composed scene at %s — pass 1 is what you measure from, keep it"
                  % scene)
            sh("python3", os.path.join(HERE, "preview_room.py"), game, a.room,
               "--out", os.path.join(a.out, "room-%s.png" % a.room))
        print("\nLOOK AT THESE. The side-by-side is the step that finds things.")
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


if __name__ == "__main__":
    sys.exit(main())
