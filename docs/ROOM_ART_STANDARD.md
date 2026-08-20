# Room art standard

How a room background is generated, framed and made walkable for a top-down
room-to-room game (Newsey is the reference implementation; the same rules
apply to any game of that shape going forward — Dog Punk's tiled levels are a
different scheme and are out of scope).

Companion to `.github/art/CHARACTER_SHEETS.md`, which covers the characters
that stand in these rooms. Both exist for the same reason: the expensive
failures were never "the picture is ugly", they were the art and the code
disagreeing about what the picture *means*.

## The room is a stage, not a scene

A room background is the set. Everything that acts is a sprite drawn on top of
it — so a generated room must be **completely empty of characters**. No
people, no figures, no animals, no silhouettes in the background, not even a
crowd blurred into the distance. A painted-in figure cannot be talked to,
cannot move, and permanently occupies floor the player can walk through.

Also absent: text of any kind. Signage, labels, book spines with readable
titles, posters with words — the generator spells them wrong, they cannot be
localised, and they date the art. Ask for symbols and shapes instead.

## Framing

- **Landscape, wide interior view, camera straight on.** Generate at
  1536x1024; the game samples it down to its own working size (320x200 in
  Newsey), so detail finer than a few pixels is wasted.
- **The floor fills the LOWER HALF of the frame** and is open — a clean,
  uncluttered walking surface. This is the single most important framing
  rule: the lower half is where the player actually exists, and a room that
  spends it on furniture leaves nowhere to stand.
- **Furniture and set dressing belong against the back and side walls**, in
  the upper half, where they read as depth rather than as obstacles.
- **The far wall is visible** behind the floor, so the room has a back. A
  room drawn as a floor plan from directly overhead has nowhere to put a door
  and no sense of place.

## Exits are art AND code — say where they are

Every way out must be **visibly drawn** (a door, an archway, a stairwell) and
its position stated in the prompt: "a wooden door on the right-hand wall",
"a stone archway at floor level on the back-left". The code wires exits by
coordinates; if the art puts the door somewhere else, the player walks through
a wall into the next room, or stands in a doorway that does nothing.

State the position when generating, and check it in the result before wiring.
A room whose door moved is worth regenerating, not working around.

## Lighting and palette come from the game, not the prompt

Per-room mood ("warm gold light", "cold blue dusk") is fine, but the base
palette, rendering technique and light logic live in that game's
`art-style.json` so rooms in the same building look like the same building.
If two rooms disagree, fix `art-style.json`, then regenerate — do not
hand-tune one prompt until it matches.

## Walkable floor is authored afterwards, never generated

**The generator will not draw a usable diagram of its own picture.** This was
tried directly: one prompt asking for a two-panel image — the finished room on
the left, the same room's walkable floor filled flat green on black on the
right — so the collision mask would be authored with the art and could never
drift out of register with it. It drew a cropped room in the left panel and
left the right one blank. It will draw a sheet of *things*; it will not draw a
schematic view of a scene it just painted.

Automatic detection failed too, twice: a flood fill leaks up the wall wherever
floor meets wall in a gradient, and climbing columns up from the bottom stops
dead at a grout line or a painted floor rune.

So the mask is **authored against the finished art** with
`.github/art/build_walkmask.py`, which takes the room's outline from the art's
own alpha silhouette (exact and free, and the reason diagonal corners come out
right) and combines it with per-room declarations measured against the art at
the game's working scale:

- `floorTop` — the row where the back wall meets the floor;
- `blocks` — polygons for what stands ON the floor (beds, counters, crates);
- `bounds` — only for art drawn as a full rectangle with a painted border,
  where the silhouette can't tell room from frame.

The result is eroded by about half a character's width so she can stand at an
edge without clipping into it. **Re-run it after changing any room's
background** — new art with an old mask is invisible until someone walks into
thin air.

## Checklist before wiring a new room

1. Empty of characters, empty of text.
2. Floor open across the lower half; furniture up against the walls.
3. Every exit visibly drawn, in the position the prompt asked for.
4. Palette and light consistent with the rest of that game's rooms.
5. `build_walkmask.py` re-run, with `floorTop` and `blocks` measured against
   *this* art.
6. Walked in-game: into each wall, through each door, and along each edge.
