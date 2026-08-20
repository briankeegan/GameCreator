# Tiled level art standard

How a level made of **repeating tiles** is made in this repo. Written to be
handed to someone who has never seen the codebase.

This is one of three shapes of art here, and picking the right one first
matters:

| the level is… | standard | front door |
|---|---|---|
| a grid of repeating tiles | **this document** | `.github/art/tileset.py` |
| one picture per room | `docs/ROOM_ART_STANDARD.md` | `.github/art/room.py` |
| characters that walk and fight | `.github/art/CHARACTER_SHEETS.md` | `.github/art/generate_row.py` |

Reference implementation: Dog Punk (`games/dog-punk`).

---

## The rule

**A tiled level is TWO SHEETS, generated separately, and the seam is made by
the cutter — never asked for.**

**Sheet 1 — texture tiles.** The floor and the walls. Each one is a *material*
seen from directly above, opaque, filling its square edge to edge.

**Sheet 2 — object tiles.** Obstacles, gates, puddles — anything drawn *on top
of* a floor tile. Cut out on flat white and keyed to transparency.

They are separate images because a texture swatch and a cut-out object drawn in
the same picture come back at different scales.

---

## Why — five defects, all of which shipped in one pass

Each of these reached a player, and the reaction was "this is awful". Four of
them are now caught mechanically by `tileset.py verify`; the fifth needs eyes,
which is what `tileset.py check` is for.

1. **NO OUTLINE ON A FLOOR TILE.** A game's `art-style.json` says "thick black
   outline around the whole silhouette", which is correct for a character and
   catastrophic for a floor. Every cell then draws its own border and the level
   reads as **graph paper**. Say NO OUTLINE, NO BORDER, TEXTURE RUNS OFF ALL
   FOUR EDGES in the prompt, every time — the canonical prompt does.

2. **THE SEAM IS THE CUTTER'S JOB.** A generator will not draw a tile that
   repeats, however loudly it is asked. `build_tiles.py` makes a `texture:`
   tile seamless by offset-and-blend. A tile that skipped that step draws a
   grid across the level.

3. **A FLAT BLOCK OF COLOUR IS A MISSING TEXTURE.** The level shipped with
   concrete slabs that were flat grey rectangles with hard edges. On screen
   they read as an asset that failed to load. A material must carry material.

4. **DARK AND SOLID READS AS A HOLE.** The oil puddles were near-black blobs,
   so the floor looked punctured. Anything lying *on* the ground needs a rim or
   a highlight that says it is on the surface.

5. **AN INTERIOR OBSTACLE IS NOT THE BOUNDARY WALL.** Dog Punk's level map used
   its wall character for free-standing obstacles, so the fence texture ended
   up **lying flat in the middle of the floor** — it reads as planks dropped on
   the ground, not as something you cannot walk through. An obstacle needs its
   own tile, drawn as an object with a visible base. This one is a *level-map*
   defect rather than an art defect, so no checker catches it: it is the first
   thing to look for in `tileset.py check`.

And one that is not a defect but a constant: **one art pixel = one screen
pixel.** Dog Punk's first tiles were 64px drawn at 32, so half of every tile
never reached the screen.

---

## Contrast is part of the level, not the characters

A floor generated at the same confident mid-key as everything else leaves the
sprites standing on a surface as bright as they are, and they stop reading.
Fix it in the level: `build_tiles.py` takes a per-tile brightness multiplier.
Never repaint the characters to fit the floor — they are the thing the player
is looking at, and their palette is locked for a reason.

`verify_tiles.py` warns when the floor's luma sits within 28 of the nearest
colour in the game's `lockedPalette`.

---

## Pipeline

```
# 1. the two sheets — same command from anywhere (a person, the "Generate
#    tileset sheet" Action, or the Clubhouse autopilot):
python3 .github/art/tileset.py generate games/<id> ground \
        --n 3 --items "cracked asphalt; concrete slab; rusted corrugated fence"
python3 .github/art/tileset.py generate games/<id> objects \
        --n 4 --items "a tyre-and-drum junk pile; a chained gate; an oil puddle; a weed tuft"

# 2. cut them into the shipped strip, one --tile per cell, left to right
python3 .github/art/tileset.py cut games/<id> \
        --tile texture:games/<id>/art-src/tiles_ground_raw.png:0 \
        --tile texture:games/<id>/art-src/tiles_ground_raw.png:1:0.2,0.2,0.5:0.8 \
        --tile object:games/<id>/art-src/tiles_objects_raw.png:0

# 3. the gate, then the picture you have to actually look at
python3 .github/art/tileset.py verify games/<id>
python3 .github/art/tileset.py check  games/<id>
```

`texture:` makes a tile seamless; `object:` keys it out on transparency. The
optional `:x,y,w` crops a sub-square (use it when the generator centred one big
feature in a swatch, which would otherwise repeat across the whole level) and
the optional trailing `:mul` scales brightness.

Raw generations live in `art-src/`; the shipped strip is always rebuilt from
them, never hand-edited. Put the rebuild command in that game's
`art-style.json` so the next pass re-runs the pipeline instead of re-deriving
it.

---

## Checklist

- [ ] Floor tiles have no outline, no border, no vignette, no centred feature.
- [ ] Floor tiles were cut as `texture:` (so they are seamless).
- [ ] No tile is a flat block of colour.
- [ ] Nothing lying on the ground is so dark it reads as a hole.
- [ ] Interior obstacles use an OBJECT tile, not the boundary wall's texture.
- [ ] One art pixel is one screen pixel.
- [ ] The floor is darker than the characters standing on it.
- [ ] `tileset.py verify` passes.
- [ ] `tileset.py check` rendered and **actually looked at** — repeated floor
      (row 2) shows no grid, mixed field (row 3) shows no wall-on-the-floor.
- [ ] The rebuild command is recorded in the game's `art-style.json`.
