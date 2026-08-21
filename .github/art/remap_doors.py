#!/usr/bin/env python3
"""Put every exit trigger where the ART says the doorway is.

    python3 .github/art/remap_doors.py games/the-game            # report only
    python3 .github/art/remap_doors.py games/the-game --write    # apply
    python3 .github/art/remap_doors.py games/the-game --skip arena

WHY THIS EXISTS. A trigger rectangle is four numbers typed next to a door, and
four typed numbers are the thing this repo keeps paying for. They are measured
off a picture by eye, the picture is regenerated, and nothing anywhere compares
the two again. The Arena's way out was typed at (230,78) — up in the STANDS,
above the top edge of the walkable platform. Every structural check passed: the
link was paired, the destination was real, the arrival was derivable. It was
simply somewhere a player could not walk to, and the only foot position whose
body box touched it grazed one corner by a single pixel, so holding one
direction out of the spawn walked straight past it into the wall.

So the numbers are DERIVED here instead. The room's walk mask already is the
art — it is built from the floor plate, which is the shipped picture — and a
doorway is the notch where that floor reaches furthest toward its wall. This
finds the notch and lays the trigger across its lip: mostly on the floor, so
you can stand on it, and far enough over the lip that walking at the wall
crosses it rather than stopping beside it.

WHAT IT DOES NOT KNOW. Prop collision. The mask says where the floor is; props
with a `base` block parts of it and are placed separately, so a rectangle this
tool calls good can still sit behind a statue. That is not a gap to paper over
with a guess — it is why the reachability sweep in browser.test.js walks the
room with the GAME's own canStand and is the thing that actually gates this.
Static tool proposes, real game disposes.

WHICH DOOR IS WHICH is never re-derived. The authored rectangle says which
opening a door means — the Lounge has two doorways in one back wall and
nothing in the mask distinguishes them. This moves a trigger to the nearest
opening on its own wall; it cannot swap two doors around.
"""

import argparse
import json
import os
import re
import subprocess
import sys

import numpy as np
from PIL import Image

W, H = 320, 200
PLAYER_W, PLAYER_H = 14, 18      # must match app.js's player.w/h

# How the trigger straddles the lip of the floor. Mostly inside, because that
# is the part you can stand on; enough outside that walking into the wall
# crosses it. Both in world pixels, and both roughly a stride at the player's
# 70px/s — a trigger thinner than this can be stepped over between frames.
INSIDE, OUTSIDE = 16, 8
MIN_SPAN, MAX_SPAN = 20, 64      # a doorway's width along its own wall

# How far into a doorway a player must be able to get for it to count as a
# door rather than a technicality. Calibrated against the doors that exist —
# see the run this tool prints; the Arena's old (230,78) rectangle scored 1px
# and was a dead end in play, while every working door scores far more.
MIN_ENTRY_DEPTH = 6

SIDES = {"left": (-1, 0), "right": (1, 0), "back": (0, -1), "near": (0, 1)}


def read_rooms(game_dir):
    """Room data straight out of story.js — evaluated, not parsed."""
    js = ("global.window={};eval(require('fs').readFileSync('%s/story.js','utf8'));"
          "const S=Object.values(global.window).find(v=>v&&v.ROOMS);const o={};"
          "for(const [id,r] of Object.entries(S.ROOMS)) o[id]={exits:(r.exits||[])"
          ".map(e=>({x:e.x,y:e.y,w:e.w,h:e.h,to:e.to,link:e.link})),"
          "doors:(r.props||[]).filter(p=>p.door).map(p=>({art:p.art,x:p.x,y:p.y,w:p.w,h:p.h}))};"
          "console.log(JSON.stringify(o));" % game_dir)
    return json.loads(subprocess.run(["node", "-e", js], capture_output=True,
                                     text=True, check=True).stdout)


def frame(rooms):
    """The frame every room shares — see check_room_exits.mjs, same reasoning."""
    xs, ys = [], []
    for r in rooms.values():
        for e in r["exits"]:
            xs += [e["x"], e["x"] + e["w"]]
            ys += [e["y"], e["y"] + e["h"]]
    return min(xs), min(ys), max(xs), max(ys)


def wall_of(fr, e):
    x0, y0, x1, y1 = fr
    cx, cy = e["x"] + e["w"] / 2, e["y"] + e["h"] / 2
    fx, fy = (cx - x0) / (x1 - x0), (cy - y0) / (y1 - y0)
    if fx <= 0.15:
        return "left"
    if fx >= 0.85:
        return "right"
    return "back" if fy <= 0.5 else "near"


def opening(mask, side, near_at):
    """The doorway on `side`, as (span_lo, span_hi, lip).

    A doorway is the notch where the walkable floor reaches furthest toward its
    own wall. Scanning every column (or row) gives that extreme; the opening is
    the run of columns that get within a couple of pixels of it, nearest to
    where the door was authored — `near_at` is what keeps two doorways in one
    wall from being confused for each other.
    """
    horizontal = side in ("left", "right")
    n = H if horizontal else W
    reach = np.full(n, np.nan)
    for i in range(n):
        line = mask[i, :] if horizontal else mask[:, i]
        idx = np.where(line)[0]
        if not len(idx):
            continue
        reach[i] = idx.min() if side in ("left", "back") else idx.max()
    if np.all(np.isnan(reach)):
        return None
    best = np.nanmin(reach) if side in ("left", "back") else np.nanmax(reach)
    tol = 3
    close = np.where(~np.isnan(reach) & (np.abs(reach - best) <= tol))[0]
    if not len(close):
        return None
    # contiguous runs, then the one nearest the authored position
    runs, s, p = [], close[0], close[0]
    for v in close[1:]:
        if v == p + 1:
            p = v
            continue
        runs.append((s, p))
        s = p = v
    runs.append((s, p))
    runs = [r for r in runs if r[1] - r[0] + 1 >= 6] or runs
    lo, hi = min(runs, key=lambda r: abs((r[0] + r[1]) / 2 - near_at))
    return int(lo), int(hi), int(best)


# TWO SOURCES, AND THE ROOM DECIDES WHICH.
#
# A room built to the three-pass standard ships ONLY its floor, and that plate
# fills the frame — so its mask has no doorway notch to find, and asking for
# "where the floor reaches furthest toward the wall" just returns the edge of
# the picture. Their doorways are PROPS (`door: true`), drawn on the wall and
# placed by hand, and the prop's own footprint is the truth.
#
# The older painted rooms have no door props at all: their doorway is a real
# hole in the walkable floor, and the notch IS the answer.
#
# Getting this wrong is not a small error. Run against every room with the
# notch rule alone, this tool proposed moving all four of the Lounge's doors to
# y=0 — the top edge of the frame — and cut their reachable footprint roughly
# in half. So when a room offers neither source, it refuses instead of
# guessing: no proposal is much cheaper than a confident wrong one.
def derive_from_prop(prop, side):
    """A door prop is placed by its FOOT, so its (x, y) is where the doorway
    meets the floor. The trigger straddles that line."""
    span = int(min(max((prop.get("w") or MIN_SPAN) * 0.55, MIN_SPAN), MAX_SPAN))
    if side in ("left", "right"):
        return {"x": int(prop["x"] - (INSIDE + OUTSIDE) / 2), "y": int(prop["y"] - span / 2),
                "w": INSIDE + OUTSIDE, "h": span}
    return {"x": int(prop["x"] - span / 2), "y": int(prop["y"] - INSIDE),
            "w": span, "h": INSIDE + OUTSIDE}


def nearest_door_prop(doors, e, side, fr):
    """The door prop for this exit — and ONLY one in the same wall.

    Nearest-by-distance alone is not enough and gets it confidently wrong: the
    Library has two exits and exactly one door prop (the one to the Garden, in
    its back wall), so plain proximity matched the way back to the Lounge — a
    near-wall door — to the garden doorway and proposed dragging it across the
    room. Same for the Lounge, where the east door matched the portal in the
    back wall. A doorway in a different wall is a different doorway."""
    if not doors:
        return None
    cx, cy = e["x"] + e["w"] / 2, e["y"] + e["h"] / 2
    same = [p for p in doors
            if wall_of(fr, {"x": p["x"] - (p.get("w") or 8) / 2, "y": p["y"] - 1,
                            "w": p.get("w") or 8, "h": 2}) == side]
    if not same:
        return None
    return min(same, key=lambda p: (p["x"] - cx) ** 2 + (p["y"] - cy) ** 2)


def has_notch(mask, side):
    """Is there a real doorway notch, or does the floor just run to the frame?

    A plate that fills its frame reaches the edge along nearly its whole
    length; a notch is a short run that pokes out well beyond the rest.
    """
    horizontal = side in ("left", "right")
    n = H if horizontal else W
    reach = []
    for i in range(n):
        line = mask[i, :] if horizontal else mask[:, i]
        idx = np.where(line)[0]
        if len(idx):
            reach.append(idx.min() if side in ("left", "back") else idx.max())
    if len(reach) < 8:
        return False
    reach = np.array(reach, float)
    best = reach.min() if side in ("left", "back") else reach.max()
    # the notch has to stand out from the body of the wall by more than a
    # stride, or it is not a doorway, it is the edge of the picture
    return abs(best - np.median(reach)) >= INSIDE


def derive(mask, side, e):
    horizontal = side in ("left", "right")
    near_at = (e["y"] + e["h"] / 2) if horizontal else (e["x"] + e["w"] / 2)
    op = opening(mask, side, near_at)
    if not op:
        return None
    lo, hi, lip = op
    span = min(max(hi - lo + 1, MIN_SPAN), MAX_SPAN)
    mid = (lo + hi) / 2
    a = int(round(mid - span / 2))
    dx, dy = SIDES[side]
    # inside is against the direction the wall lies in
    if side == "left":
        return {"x": lip - OUTSIDE, "y": a, "w": INSIDE + OUTSIDE, "h": span}
    if side == "right":
        return {"x": lip - INSIDE, "y": a, "w": INSIDE + OUTSIDE, "h": span}
    if side == "back":
        return {"x": a, "y": lip - OUTSIDE, "w": span, "h": INSIDE + OUTSIDE}
    return {"x": a, "y": lip - INSIDE, "w": span, "h": INSIDE + OUTSIDE}


def entry_depth(mask, r):
    """How DEEPLY the player can get onto this trigger, in pixels.

    Counting positions is not enough on its own. A trigger armed just past the
    lip of the floor can be touched only by the very corner of the player's
    box — the Arena's way out could be entered by exactly ONE pixel — and a
    one-pixel graze is indistinguishable from a working door in any yes/no
    check, while in play it means holding a direction walks you straight past
    it. So measure the best overlap achievable in its NARROWER axis: that is
    how far into the doorway a player can actually get, and it is the number
    that separates a door from a technicality.
    """
    best = 0
    for y in range(max(0, r["y"] - PLAYER_H + 1), min(H - PLAYER_H, r["y"] + r["h"])):
        for x in range(max(0, r["x"] - PLAYER_W + 1), min(W - PLAYER_W, r["x"] + r["w"])):
            fy, fx = y + PLAYER_H, x + PLAYER_W // 2
            if fy >= H or fx >= W or not mask[fy, fx]:
                continue
            ox = min(x + PLAYER_W, r["x"] + r["w"]) - max(x, r["x"])
            oy = min(y + PLAYER_H, r["y"] + r["h"]) - max(y, r["y"])
            if ox > 0 and oy > 0:
                best = max(best, min(ox, oy))
    return best


def standable_overlap(mask, r):
    """How many foot positions put the player's body across this trigger.

    Not a percentage of the rectangle: a trigger fires on the BODY box while
    the feet stand on floor, so a doorway drawn high in a wall is entered from
    below it and scores 0% walkable while being perfectly fine. Counting the
    positions that work asks the question the game asks.
    """
    n = 0
    for y in range(max(0, r["y"] - PLAYER_H + 1), min(H - PLAYER_H, r["y"] + r["h"])):
        for x in range(max(0, r["x"] - PLAYER_W + 1), min(W - PLAYER_W, r["x"] + r["w"])):
            fy, fx = y + PLAYER_H, x + PLAYER_W // 2
            if fy < H and fx < W and mask[fy, fx]:
                n += 1
    return n


def rewrite(story, room_id, e, new):
    """Replace one exit's four numbers, matched on its link and destination."""
    pat = re.compile(
        r'(\{\s*x:\s*)%d(\s*,\s*y:\s*)%d(\s*,\s*w:\s*)%d(\s*,\s*h:\s*)%d'
        r'([^}]*?to:\s*"%s"[^}]*?link:\s*"%s")' % (
            e["x"], e["y"], e["w"], e["h"], re.escape(e["to"]), re.escape(e["link"])))
    out, n = pat.subn(
        lambda m: "%s%d%s%d%s%d%s%d%s" % (m.group(1), new["x"], m.group(2), new["y"],
                                          m.group(3), new["w"], m.group(4), new["h"],
                                          m.group(5)),
        story, count=1)
    return out, n


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("game_dir")
    ap.add_argument("--write", action="store_true", help="apply to story.js")
    ap.add_argument("--skip", nargs="*", default=[], help="room ids to leave alone")
    a = ap.parse_args()

    rooms = read_rooms(a.game_dir)
    fr = frame(rooms)
    story_path = os.path.join(a.game_dir, "story.js")
    story = open(story_path).read()
    moved = unchanged = shallow = 0

    for rid in sorted(rooms):
        if rid in a.skip:
            print("%-13s skipped" % rid)
            continue
        mp = os.path.join(a.game_dir, "art", "walk-%s.png" % rid)
        if not os.path.exists(mp):
            print("%-13s no walk mask — nothing to derive from" % rid)
            continue
        mask = np.asarray(Image.open(mp).convert("L").resize((W, H), Image.NEAREST)) > 127
        for e in rooms[rid]["exits"]:
            side = wall_of(fr, e)
            # MEASURE FIRST, always. Whether this tool can propose a better
            # rectangle is a separate question from whether the current one is
            # any good — and the rooms it cannot derive from are exactly the
            # ones nobody would otherwise have numbers for.
            was, was_d = standable_overlap(mask, e), entry_depth(mask, e)
            if was_d < MIN_ENTRY_DEPTH:
                print("%-13s %-11s %-5s SHALLOW: deepest a player can get onto this trigger "
                      "is %dpx (want >= %d) — grazed, not entered"
                      % (rid, e["link"], side, was_d, MIN_ENTRY_DEPTH))
                shallow += 1
            prop = nearest_door_prop(rooms[rid].get("doors"), e, side, fr)
            if prop:
                new, src = derive_from_prop(prop, side), "prop " + prop["art"]
            elif has_notch(mask, side):
                new, src = derive(mask, side, e), "floor notch"
            else:
                print("%-13s %-11s %-5s reach %-5d depth %2dpx — no source to re-derive "
                      "from (the plate fills this wall and there is no door prop), so the "
                      "authored rectangle stands"
                      % (rid, e["link"], side, was, was_d))
                unchanged += 1
                continue
            if not new:
                print("%-13s %-11s %-5s could not find an opening" % (rid, e["link"], side))
                continue
            now, now_d = standable_overlap(mask, new), entry_depth(mask, new)
            same = all(new[k] == e[k] for k in "xywh")
            shift = max(abs(new["x"] - e["x"]), abs(new["y"] - e["y"]))
            # Never take a proposal that makes the door HARDER to reach. The
            # authored value was measured off the art by a person; this tool is
            # only worth obeying where it can show the art disagrees.
            if now < was:
                print("%-13s %-11s %-5s keeps (%3d,%3d) %2dx%-2d  reach %-5d depth %2dpx "
                      "(%s would give %d/%dpx — worse, ignored)"
                      % (rid, e["link"], side, e["x"], e["y"], e["w"], e["h"], was, was_d,
                         src, now, now_d))
                unchanged += 1
                continue
            if same or (shift <= 2 and was >= now):
                unchanged += 1
                print("%-13s %-11s %-5s keeps (%3d,%3d) %2dx%-2d  reach %-5d depth %2dpx"
                      % (rid, e["link"], side, e["x"], e["y"], e["w"], e["h"], was, was_d))
                continue
            print("%-13s %-11s %-5s (%3d,%3d) %2dx%-2d reach %-5d depth %2dpx ->  "
                  "(%3d,%3d) %2dx%-2d reach %-5d depth %2dpx  [%s]"
                  % (rid, e["link"], side, e["x"], e["y"], e["w"], e["h"], was, was_d,
                     new["x"], new["y"], new["w"], new["h"], now, now_d, src))
            moved += 1
            if a.write:
                story, n = rewrite(story, rid, e, new)
                if not n:
                    print("    !! could not find that exit's numbers in story.js — not written")

    if a.write and moved:
        open(story_path, "w").write(story)
        print("\nwrote %s" % story_path)
    print("\n%d door(s) would move, %d already on their opening, %d grazed rather than "
          "entered." % (moved, unchanged, shallow))
    print("A move is a PROPOSAL: prop collision is invisible here, so run the "
          "reachability sweep (games/<id>/browser.test.js) before believing it.")


if __name__ == "__main__":
    main()
