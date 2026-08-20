# Room art standard

How a room is generated, framed, populated and made walkable for a top-down
room-to-room game. Newsey (`games/the-game`) is the reference implementation and
its Anarchy Garden is the reference room. Dog Punk's tiled levels are a
different scheme and out of scope.

Companion to `.github/art/CHARACTER_SHEETS.md`, which covers the characters that
stand in these rooms. Both exist for the same reason: the expensive failures
were never "the picture is ugly", they were the art and the code disagreeing
about what the picture *means*.

Written to be handed to someone who has never seen this repo.

---

## 1. A room is generated in THREE PASSES

**This is the rule everything else hangs off.** A room used to be one picture
with its scenery painted into it, and everything downstream fought that.

### Pass 1 — the composed scene (a reference, never shipped)

Generate the room as a complete picture, everything in it, exactly as you want
it to look. **This one is not shipped.** It exists so that a composition you can
see is the thing you measure from — the models compose a whole scene far better
than they place a bare floor, and a floor invented on its own comes back with
the path somewhere else and nothing where you expect it.

Keep it at `art-src/<room>_scene.png`.

### Pass 2 — the WALKABLE SURFACE, and only that

Regenerate the room as **just the ground you can stand on** — grass,
floorboards, path, tile — on flat white, with *nothing else in the frame*.

This is the shipped background, and because it is exactly the walkable area, the
collision mask is its own silhouette: add the room to `FLOOR_PLATE_ROOMS` in
`build_walkmask.py` and **there is nothing else to declare**. No wall line to
measure, no furniture polygons to subtract, and no way for the mask to drift out
of step with the art — because the art *is* the declaration.

Run it through `fit_plate.py` before shipping it (see §7).

### Pass 3 — everything you CANNOT walk on, as props

Sheets of 2–4 items each, **drawn side by side in one image** on flat white,
upright, whole from base to top, on a common ground line, no shadow. Walls,
water, waterfalls, trees, statues, tables — plus flat ground cover like flowers,
which you *can* walk on but which still isn't part of the plate.

Cut with `build_props.py`, then place at the numbers measured off pass 1.

### What this buys

- **The mask stops being hand-authored.** See §6 for the five techniques that
  failed at recovering a floor from a finished picture.
- **Scenery gets depth.** A painted tree is flat: you either walk over it or are
  fenced away from it. A prop sorts by foot position, so you walk *behind* it
  and stop at its trunk.
- **A room stops being one indivisible thing.** Move a table, replace a statue,
  add a bench — no regenerating the room, no re-deriving its floor.
- **Water can move.** Once the pool and the waterfall are their own assets
  rather than paint, they can be animated. Impossible while they are baked in.

---

## 2. The room is a stage, not a scene

A room background is the set. Everything that acts is a sprite drawn on top of
it — so a generated room must be **completely empty of characters**. No people,
no figures, no animals, no silhouettes, not even a crowd blurred into the
distance. A painted-in figure cannot be talked to, cannot move, and permanently
occupies floor the player can walk through.

Also absent: **text of any kind.** Signage, labels, readable book spines, posters
with words — the generator spells them wrong, they cannot be localised, and they
date the art. Ask for symbols and shapes instead.

## 3. Framing

- **Landscape, wide view, camera straight on.** Generate at 1536x1024; the game
  samples down to its working size (320x200 in Newsey), so detail finer than a
  few pixels is wasted.
- **The floor fills the LOWER HALF of the frame** and is open. The lower half is
  where the player actually exists.
- **Depth belongs to props**, not to the plate. The far wall, the shelving, the
  pool — all of it is pass 3.

### Doors are art AND code

Every way out must be **visibly drawn** and its position **stated in the
prompt**: "a stone archway at floor level on the back-right wall". The code
wires exits by coordinates; if the art puts the door somewhere else, the player
walks through a wall or stands in a doorway that does nothing. A room whose door
moved is worth regenerating, not working around.

In Newsey each exit carries `to`, `arriveAt` (real unobstructed floor in the
destination, with clearance from every *other* exit there) and `arriveFacing`
(without it the player reads as materialising rather than stepping through).
`check_room_exits.mjs` enforces all three.

**A room's own `playerStart` must not sit inside its own exit trigger.** Doors
stay disarmed until you step off them — that is what stops an arrival throwing
you straight back out — so a spawn point on a threshold means the door never
arms at all, and you can walk into it forever with nothing happening. This
shipped once and was found by the walk test in §8.

### Lighting and palette come from the game, not the prompt

Per-room mood ("warm gold light", "cold blue dusk") is fine, but the base
palette, rendering technique and light logic live in that game's
`art-style.json`, so rooms in the same building look like the same building.

---

## 4. Placing and sizing props

Getting this wrong is what makes a room look like objects were sprinkled on it.

### Use the numbers from pass 1

**First choice, every time: the position and size the composed scene used.**
Measure them, then use them. They are a composition that already proved it works.
Only invent a position when the floor plate came back with the path or the
doorway somewhere the scene didn't have it — and then move the prop the smallest
distance that clears it.

### Sizing, and when NOT to use a depth ramp

**Take the size from pass 1.** If the composed scene drew a thing the same size
front and back, ship it that way and give the room **no `depthScale`** — the
artist was telling you the room's perspective is shallow enough not to matter.
The Anarchy Garden is exactly this case: all four of its weeping fountains are
~56px in a 200px-tall frame regardless of depth. Placed by eye at 30–42px with a
ramp on, they read as garden ornaments instead of life-size statues, and three
rounds of "that still looks wrong" went by before the cause was found.

Only reach for a ramp when the art has strong depth and props at the two ends
genuinely need to differ:

```js
depthScale: { nearY: 198, farY: 40, far: 0.62 }
```

1.0 at `nearY`, `far` at `farY`, straight line between, clamped outside. A
prop's `h` is then its height at the front of the room; footprint and ground
shadow scale with it.

### Density is part of the composition

Count the ground cover in the composed scene before you place three tidy patches
and call it done. The garden's scene has *drifts* of white and orange flowers
across most of the lawn; the first assembly had three patches and read as a
different, emptier place even though every standing prop was correct.

### Composing, when you do have to place by hand

- **Anchor the edges.** The biggest props sit hard against the left and right
  margins so their canopies run off the side. That crop is what makes a room
  read as a corner of a real place rather than lollipops on a lawn.
- **Work in pairs and rows.** Two matching props flanking a path read as
  deliberate; one alone at a random offset reads as a mistake.
- **Keep the traffic lane clear**, and **leave the exits alone** — no prop's
  base within about a character's width of a doorway trigger.
- **Nothing overlapping terrain it can't stand on.** A prop's artwork rises from
  its base, so a statue based just below a pool has its head in the water.

---

## 5. Prompting

`games/<id>/art-style.json` carries the whole rule, so a prompt only has to say
**which pass** it is and what is in it.

**Pass 2, the floor plate** — say it plainly and say it twice, because "an empty
room" is not how these models read a room:

> THE <ROOM>, WALKABLE SURFACE ONLY. This image is the GROUND YOU CAN WALK ON
> and nothing else. Draw, on a background of FLAT PURE WHITE (#FFFFFF) with a
> crisp hard edge: … CRITICAL: absolutely NOTHING else in the frame. No water,
> no wall, no trees, no furniture, no people, no sky, no background scenery of
> any kind, no shadow cast from anything off-frame.

**Pass 3, a prop sheet** — the sheet is the point. Props generated one per image
drift apart in palette, lighting angle and pixel scale, exactly the way character
frames do. Drawn together, they cannot.

> A SHEET OF N PROPS, drawn side by side in ONE image so they share a palette
> and a scale. The background of the whole image must be FLAT PURE WHITE
> (#FFFFFF), completely uniform, with a crisp hard edge against each prop, a
> wide band of flat white between them so they never touch, and a generous white
> margin all round. All drawn from the SAME view, standing upright, each sitting
> on the same invisible ground line at the bottom, seen whole from base to top,
> casting no shadow.

Ask for **flat white, never transparency** — asking for transparency usually
returns a beige or gradient wash. (`build_props.py` handles both: if a sheet
does come back with real alpha it uses that, because keying white would eat a
white marble statue.)

**Keep sheets small.** A request for five portrait busts side by side came back
as a single close-up of one of them. Two to four items is reliable; more is not.

---

## 6. Why the mask can't be generated or detected

**The generator will not draw a usable diagram of its own picture.** Tried
directly: one prompt asking for a two-panel image — the finished room on the
left, its walkable floor filled flat green on black on the right. It drew a
cropped room in the left panel and left the right one blank. It will draw a
sheet of *things*; it will not draw a schematic view of a scene it just painted.

Automatic detection off a finished picture failed too. Five techniques, all
abandoned: a rectangle (no room in perspective is one); a hand-traced polygon
per room (magic numbers that go stale the moment the art is regenerated); a
flood fill of the surround (leaks up any wall where floor meets wall in a
gradient); climbing each column to the first hard edge (stops on a grout line,
and on a rune painted flat on the floor); and asking the generator directly.

**Pass 2 exists precisely so none of this is needed.**

For rooms whose art still has scenery painted in, `build_walkmask.py` keeps the
older path: the outline from the art's alpha, plus hand-measured `floorTop`,
`blocks` and `bounds`. Both paths erode the result by about half a character's
width so she can stand at an edge without clipping into what is beside her.
**Re-run it after changing any room's background.**

---

## 7. Pipeline — the tools, in order

Every step is a tool. None of this is meant to be done by eye: every single
thing that went wrong with the reference room went wrong by eye and was
invisible in the numbers.

```
# ---- pass 1: the composed scene ------------------------------------------
#   generate it, keep it, never ship it -> art-src/<room>_scene.png

# ---- pass 2: the walkable surface ----------------------------------------
#   generate "the ground you can walk on and nothing else"
#                                        -> art-src/<room>_floor.png
#   then make it fill the frame:
python3 .github/art/fit_plate.py \
        games/<id>/art-src/<room>_floor.png \
        games/<id>/art/bg-<room>.png --margin 3

#   add <room> to FLOOR_PLATE_ROOMS, then the mask is free:
python3 .github/art/build_walkmask.py games/<id> <room>
python3 .github/art/show_walkmask.py games/<id> <room>    # and LOOK at it

# ---- pass 3: props -------------------------------------------------------
python3 .github/art/build_props.py \
        games/<id>/art-src/<room>_props.png \
        games/<id>/art  prop_cherry prop_fountain     # names, left to right

# ---- placing them --------------------------------------------------------
#   measure the composed scene: every non-floor object's ground point, height
#   and width, with an overlay of what it found
python3 .github/art/measure_props.py games/<id>/art-src/<room>_scene.png \
        --floor grass --floor path --overlay /tmp/measured.png

#   write the props block, then CHECK IT against the scene it came from
python3 .github/art/preview_room.py games/<id> <room> \
        --scene games/<id>/art-src/<room>_scene.png --mode side
#   (--mode blend lays them over each other like tracing paper instead)

#   optionally let it fit each prop: searches a window around each current
#   position and scale for the best silhouette match and prints a corrected
#   block. A SUGGESTION — it scores against a colour mask, so busy ground
#   cover pulls it around.
python3 .github/art/preview_room.py games/<id> <room> \
        --scene games/<id>/art-src/<room>_scene.png --fit --floor grass --floor path

# ---- doors ---------------------------------------------------------------
node .github/scripts/check_room_exits.mjs games/<id>/story.js
```

**`--mode side` is the step that finds things.** The assembled room next to the
scene it came from shows in one look everything the numbers hide. All four of
the reference room's problems were found this way and none were findable any
other way:

| what it looked like | what it actually was |
|---|---|
| room feels cramped, black bars at the edges | the plate never filled the frame |
| statues look like garden ornaments | placed at ⅔ size, plus a depth ramp the scene didn't use |
| garden looks bare next to the scene | 3 patches of ground cover where the scene has drifts |
| a tree floats off its own shadow | shadow drawn to the footprint, not to the sprite |

Raw generations live in `art-src/`; shipped art is rebuilt from them, never
hand-edited.

### Room data

```js
props: [
  { art: "prop_cherry",  x: 54,  y: 96,  h: 94, base: { rx: 15, ry: 5 } },
  { art: "prop_pool",    x: 160, y: 64,  h: 44, w: 250, base: { w: 240, h: 16 } },
  { art: "prop_flowers_white", x: 66, y: 150, h: 44, flat: true }
]
```

- `x, y` — where the prop **meets the ground**, not its top-left corner: both
  its sort key and the centre of its footprint. For a `flat` prop it is the
  centre of the patch instead, since flat props have no foot.
- `h` — height at the front of the room.
- `w` — optional. Width normally follows the art's own aspect so a tree keeps
  its proportions; a pool or a run of wall has to span the room instead.
- `flat: true` — ground cover: flowers, grass tufts, a rug. Painted with the
  floor, never sorted, never blocking. Sorted like a standing prop, the player's
  own feet would sometimes vanish behind a flower.
- `base` — the footprint nothing walks into:
  - `{ rx, ry }` — an ellipse at its foot, for anything round-ish.
  - `{ w, h }` — a rectangle, for anything long and straight: a wall, the coping
    of a pool, a counter. An ellipse can't describe those and leaves walkable
    gaps at the corners.

  Cover only what touches the ground — a cherry tree blocks its **trunk**, not
  its canopy. Omit `base` entirely for flat ground cover.

---

## 8. Checklist before wiring a new room

1. Pass 1 composed scene generated FIRST and kept in `art-src/`.
2. Floor plate is *only* the walkable surface — no walls, water, furniture or
   scenery anywhere in it.
3. Plate run through `fit_plate.py` so it fills the frame.
4. Room added to `FLOOR_PLATE_ROOMS`; no `floorTop`/`blocks` needed.
5. Empty of characters, empty of text.
6. Every door visibly drawn, in the position the prompt asked for.
7. `playerStart` is NOT inside any exit trigger.
8. Props came from sheets of 2–4, not one image each; flat white or real alpha.
9. Props placed and sized on the pass-1 numbers, not by eye — including how
   MANY patches of ground cover the scene has.
10. `depthScale` only if the composed scene actually varied size with depth.
11. Each prop's `x, y` is its ground contact point; each `base` is the right
    shape and covers only what touches the ground; flat cover has `flat: true`
    and no `base`.
12. `build_walkmask.py` re-run and `show_walkmask.py` actually looked at.
13. `preview_room.py --mode side` actually looked at, against the composed
    scene. **This is the step that finds things.**
14. `check_room_exits.mjs` passes.
15. Walked in-game: into each wall, through each door, along each edge, and
    behind each prop.
