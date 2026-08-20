# Room art standard — ground plate + props

How a room is made for a top-down game in this repo. Written to be handed to
someone who has never seen the codebase.

Reference implementation: the Anarchy Garden in `games/the-game`
(`art/bg-garden.png` + `art/prop_cherry.png` + `art/prop_fountain.png`).

---

## The rule

**A room is generated in two layers, never one.**

**Layer 1 — the ground plate.** The floor, the walls behind it, doorways, and
anything that is genuinely part of the architecture (wall panelling, built-in
shelving, a painted rug). *Nothing that stands up off the floor out in the
room.* No free-standing furniture, no trees, no statues, no crates, no tables.
The open floor must be wide, unobstructed, and fill most of the lower frame.

**Layer 2 — a prop sheet.** Every free-standing thing, drawn **side by side in
one image**, upright, whole from base to top, each on the same invisible ground
line, no shadow, on **flat pure white**. Cut apart into one transparent PNG per
prop.

The game then places each prop by the point where it **meets the ground**, sorts
it against the player by that point, and blocks a small ellipse at its base.

---

## Why — the three problems this fixes

These are not hypothetical. Each one cost real time before the standard existed.

1. **The walkable floor stopped being a reverse-engineering job.** With
   furniture painted into the room, the walkable area has to be recovered *out
   of the finished picture*. Five techniques were tried and all failed: a
   rectangle (no room in perspective is one), a hand-traced polygon per room
   (magic numbers that go stale the moment the art is regenerated), a flood fill
   of the black around the room (leaks up any wall where floor and wall meet in
   a gradient), climbing each column to the first hard edge (stops on a grout
   line, and on a rune painted flat on the floor), and asking the image
   generator to draw the mask as a second panel beside the room (it will not —
   see below). With a bare ground plate, the mask is a wall line and a
   rectangle.

2. **Scenery got depth.** A tree painted into the background is a flat picture:
   the player either walks over it or is fenced away from it, and both look
   wrong. A prop sorts by foot position, so you walk *behind* the tree and stop
   at its trunk.

3. **A room stopped being one indivisible thing.** Moving a table, replacing a
   statue, or adding a bench no longer means regenerating the whole room and
   re-deriving its floor.

**The generator will not draw a technical diagram of its own picture.** This was
tried directly: one prompt asking for a two-panel sheet — the finished room on
the left, the same room's walkable floor filled flat green on black on the right
— so that collision data would be authored *with* the art and could never drift
out of register with it. `gpt-image-1` drew a cropped room in the left panel and
left the right one blank white. It will happily draw a sheet of *things* (a walk
cycle, a set of props); it will not draw a second, schematic view of a scene it
just painted. Collision has to be authored against the art afterwards, which is
what the ground plate makes cheap.

---

## Prompting

The style file (`games/<id>/art-style.json`) already carries the whole rule, so
a prompt only has to say **which layer it is asking for** and what is in it.

**Ground plate** — say it plainly and say it twice, because "an empty room" is
not how these models read a room:

> Draw ONLY the ground and the far background: … CRITICAL: draw NO TREES of any
> kind, NO statues, NO fountains, NO benches, NO people — nothing standing up
> off the ground anywhere in the frame except [whatever genuinely is
> architecture]. The floor must be wide, open and completely unobstructed
> across the whole middle and lower frame.

**Prop sheet** — the sheet is the point. Props generated one per image drift
apart in palette, lighting angle and pixel scale, exactly the way character
frames do. Drawn together, they cannot.

> A SHEET OF N PROPS, drawn side by side in ONE image so they share a palette
> and a scale. The background of the whole image must be FLAT PURE WHITE
> (#FFFFFF), completely uniform, with a crisp hard edge against each prop, a
> wide band of flat white between them so they never touch, and a generous
> white margin all round. All props drawn from the SAME view, standing upright,
> each sitting on the same invisible ground line at the bottom, seen whole from
> base to top, casting no shadow.

Ask for **flat white, never transparency** — asking for transparency usually
returns a beige or gradient wash. (The cutter handles both: if a sheet does come
back with real alpha it uses that, because keying white would eat a white marble
statue.)

**Doors:** if the ground plate has a doorway leading elsewhere, it goes on the
**back-right wall**, in roughly the rightmost 15–20% of the frame width, with
its threshold at floor level — the exit trigger is placed against it, and a door
drawn anywhere else is a door players can see and cannot use.

---

## Pipeline

```
# 1. ground plate  ->  games/<id>/art/bg-<room>.png
#    (Actions -> "Generate game asset", or the equivalent for your setup)

# 2. prop sheet    ->  games/<id>/art-src/<room>_props.png
#    then cut it:
python3 .github/art/build_props.py \
        games/<id>/art-src/<room>_props.png \
        games/<id>/art \
        prop_cherry prop_fountain          # names, left to right

# 3. walkable-floor mask -> games/<id>/art/walk-<room>.png
#    declare the room in .github/art/build_walkmask.py, then:
python3 .github/art/build_walkmask.py games/<id> <room>
```

Raw generations live in `art-src/`; shipped art is rebuilt from them, never
hand-edited.

**Look at the mask before believing it.** Overlay `walk-<room>.png` on
`bg-<room>.png` and check by eye. It is the single cheapest step and it has
caught every collision bug so far.

---

## Declaring the room

Walk mask (`.github/art/build_walkmask.py`) — with a bare ground plate this is
usually all it takes:

```python
"garden": {
    "floorTop": 40,                    # where the back wall meets the floor
    "bounds": (4, 40, 316, 198),       # for art drawn as a full rectangle,
                                       # where the alpha silhouette can't tell
                                       # room from painted frame
    "blocks": [                        # only real architecture, not props
        [(0, 141), (114, 141), (114, 161), (0, 161)],
        [(188, 141), (320, 141), (320, 161), (188, 161)],
    ],
},
```

The room's *outline* comes free from the art's own alpha silhouette, which is
what makes the diagonal corners of a room in perspective correct. The result is
eroded by about half a character's width so she can stand at an edge without
clipping into what is beside her.

Props (in the game's room data):

```js
props: [
  { art: "prop_cherry",   x: 46, y: 126, h: 66, base: { rx: 13, ry: 5 } },
  { art: "prop_fountain", x: 92, y: 68,  h: 46, base: { rx: 15, ry: 6 } }
]
```

- `x, y` — where the prop **meets the ground**, not its top-left corner. This is
  both its sort key and the centre of its footprint.
- `h` — drawn height. Width follows the art's own aspect, so a tree keeps its
  proportions instead of being squeezed into a cell.
- `base` — the ellipse at its foot that nothing walks into. Keep it to the part
  that actually touches the ground: a cherry tree blocks its *trunk*, not its
  canopy, or the canopy fences off floor you can see is empty.

---

## Checklist

- [ ] Ground plate has nothing standing up off the floor.
- [ ] Open floor fills most of the lower frame.
- [ ] Any doorway is on the back-right wall, threshold at floor level.
- [ ] Props came from ONE sheet, not one image each.
- [ ] Sheet background was flat white (or real alpha), not beige.
- [ ] Each prop's `x, y` is its ground contact point.
- [ ] Each `base` covers what touches the ground, not the whole silhouette.
- [ ] Mask overlaid on the art and checked by eye.
