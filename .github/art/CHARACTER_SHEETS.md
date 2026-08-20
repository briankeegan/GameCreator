# Character sheet standard

The layout every animated character in this repo uses. It exists because the
expensive failures here were never "the drawing is bad" — they were the art
and the code disagreeing about what a frame *means*, or the same character
being drawn slightly differently in two images.

Applies to top-down games with directional movement (Dog Punk, Newsey) and to
every new game of that shape. A game with a different camera can ignore it,
but should not invent a second scheme for the same job. Rooms have their own
standard: `docs/ROOM_ART_STANDARD.md`.

## Frames

**Walk — 3 frames per direction: `[step, NEUTRAL, step]`**

| col | pose |
|-----|------|
| 0 | mid-step, **LEFT foot forward**, right foot back |
| 1 | **neutral** — standing still, both feet together under the body |
| 2 | mid-step, **RIGHT foot forward**, left foot back |

**A stride is drawn differently depending on the row, because a leg moving
toward the camera is foreshortened to nothing.** State it per row:

- **Side row** — a true fore/aft split: one foot planted ahead of the body,
  the other behind, a clear gap between them. This is the only row where the
  step reads as displacement.
- **Front and back rows** — the step is SMALL. Both legs stay vertical and
  clearly separated with background visible between them; one boot lifts a
  couple of pixels (heel up, knee barely bent) while the other stays planted,
  and the arms swing. That is all the room there is.

  Do not ask for a high knee or a march step. It was tried, twice: "left foot
  forward" on a front view produced a muddle of legs with the difference
  invisible, and the over-correction — thigh raised to horizontal — merged the
  raised leg into the body and shipped as a brown blob where the legs should
  be. At 16-bit scale a character's legs are perhaps ten pixels tall; a raised
  thigh has nowhere to go. **What sells a front-on walk at this size is the
  arm swing and a one-pixel body bob, not the legs.**

Frames 0 and 2 swap which leg does the work: left lifted, then right lifted
(front/back), or left forward, then right forward (side).

Name the actual foot in the prompt. "One leg forward" and "the opposite leg
forward" is too vague to hold: a generated back row came back with frame 0 as
a real stride and frames 1 and 2 as two near-identical standing poses, so the
cycle read as a character bobbing rather than walking. Left-forward / stand /
right-forward is unambiguous, and it makes the two step frames true opposites,
which is what gives the cycle its swing.

Column 1 is a true standing-still pose and is used **both** when idle **and**
as the resting beat mid-walk. Playback while moving is `[1, 0, 1, 2]` on a
loop — middle → step → middle → step, the RPG-Maker charset cadence — and it
snaps straight back to 1 the instant movement stops, so nothing freezes
mid-stride.

Asking a generator for "three different walking poses" produces a set with no
correct idle frame. Dog Punk shipped exactly that: its side row had no neutral
column, so standing still facing left or right looked like walking on the
spot.

**Attack — 3 frames per direction: `[wind-up, strike, recover]`**

| col | pose |
|-----|------|
| 0 | wind-up — weapon pulled back and raised, body coiled, before contact |
| 1 | **strike** — mid-slash, the weapon sweeping through an arc across the body as it lands |
| 2 | recover — follow-through, weapon carried past the target and down |

The strike frame is the one that lands: **damage is dealt on frame 1**, so the
hit and the drawing agree.

For a bladed weapon the swing is a **slash — an arc across the body — not a
thrust**. Prompting "attacking with the dagger" reliably produces a stab with
the blade pointed straight ahead, which reads as poking rather than cutting;
the arc has to be described explicitly, per frame. The canonical prompt does
this, which is the reason to use it rather than writing a fresh one. Three frames rather than one because a single
lunging pose reads as a shove, and because attacks are where weapons vary —
swapping a weapon swaps the attack sheet and the timing code is untouched.

**The columns mean the same thing in every row.** Front, side and back all
use left-forward / standing / right-forward; the only thing that changes
between rows is the camera angle. That is what lets one playback sequence
drive every direction, and it is why a row that quietly reinterprets its
columns (a "neutral" that is really a third stride, or a standing frame drawn
from a different angle than its own row) breaks the cycle in that direction
only — the hardest kind of bug to spot, because the other directions look fine.

## Directions

Three rows, in order: **down, side (drawn facing RIGHT), up.**

**RIGHT is never drawn.** It is the side row mirrored with `ctx.scale(-1, 1)`,
for players and NPCs alike. A side row that is not a true side profile
therefore breaks both horizontal directions at once — and a "neutral" frame
that quietly turns to face the viewer makes the character spin to camera every
other beat while walking.

## The recipe that works (use it; don't re-derive it)

Settled after a long run of failures, all recorded above. Follow it and the
first generation is usually the one that ships:

1. **One row per image**, landscape 1536x1024, three sprites across.
2. **Flat pure white background**, keyed out afterwards — never ask for
   transparency, it comes back as a beige wash.
3. **Name the foot** (left forward / standing / right forward) and state the
   row's camera angle **per frame**, including on the standing frame.
4. **State the margin**: wide empty space on all four sides, clear gaps
   between sprites, nothing touching an edge.
5. **List the locked details** from the game's `art-style.json` in the prompt
   — sleeves, ears, which hand holds the weapon.
6. **Verify before cutting**: `verify_sheet.py raw <row>.png --frames 3 --walk`.
   It fails on clipping, wrong frame count, duplicate frames and a missing
   neutral. Cutting an unverified row is how a bad set reaches the game.
7. **Cut with `build_sheet.py`**, one `--row` per direction, `@height` per row
   if the character is a different height from different angles.
8. **`medium` quality is enough** for flat cartoon pixel art; `high` is for a
   showcase asset, and costs about four times as much.

## Obvious to a person, invisible to a generator

Every line here is a rule a human would never break and a generator breaks
routinely. State them in the prompt, every time — the canonical prompts
already do:

- **The body stays square to the camera** in the front and back rows. Rotating
  into a three-quarter pose to suggest movement makes a character walking
  toward you read as walking sideways.
- **A step is drawn per view**: fore/aft split in the side row, lifted knee in
  the front and back rows. A leg moving toward the camera is invisible.
- **The defining feature survives every frame** — mohawk, hat, horns — from
  behind and mid-attack included. It is the first thing to vanish.
- **The same character, every frame**: species, build, palette, and the
  `lockedDetails` from `art-style.json` (sleeves, ears, which hand holds the
  weapon).
- **A back view is a body, not a hairstyle**: head, shoulders, torso, legs,
  feet — not a shapeless mass of hair with no visible body under it.
- **The weapon stays in the same hand** across walk and attack sheets.
- **A blade slashes, it doesn't poke**: an arc across the body, not a thrust
  with the blade pointed along the direction of travel.
- **The standing frame is standing**: feet together, no stride, no lean, and
  drawn from its own row's angle.
- **Nothing touches the edge of the image**, and sprites never overlap each
  other.
- **No ground line under the feet.** Given "no shadows" a generator will
  still often draw a floor bar or plinth for the character to stand on; it
  gets cut into the sprite and ships as a black stripe under the boots. The
  character floats on empty background — the game draws its own floor.

## What the checker cannot decide

`verify_sheet.py` covers the mechanical half — clipping, frame count,
duplicate frames, missing neutral, detached specks, off-palette colour. It
deliberately does not judge:

- whether a row is actually drawn from the view it was asked for;
- whether the legs read as a walk or as a muddle;
- whether debris is *touching* the character (any connectivity test sees that
  as part of the silhouette);
- whether it looks good.

Those need eyes, which is the point: the tool exists so the eyes are spent on
the half that needs them, not on counting frames.

## Files

```
games/<id>/art-src/<char>_walk_raw.png     raw generation, 3 rows x 3 cols
games/<id>/art-src/<char>_attack_raw.png   raw generation, 3 rows x 3 cols
games/<id>/<char>_sheet.png                shipped walk sheet
games/<id>/<char>_attack_sheet.png         shipped attack sheet
```

Raws are source material and are never edited; shipped sheets are always
rebuilt from them, so a sheet can be regenerated byte-for-byte.

## Generate ONE ROW PER IMAGE, not a grid

Ask for a 3x3 grid and you get one of two failures, reliably:

- **square canvas (1024x1024)** — lays out 3x3 correctly, then clips the
  BOTTOM row at the edge of the image;
- **tall canvas (1024x1536)** — silently drops to TWO columns.

Both happened on consecutive attempts for the same character, with the grid
and the margins spelled out. A single row of three sprites on a landscape
canvas (1536x1024) has not failed yet — so generate the rows separately (one
image per direction) and let the cutter assemble them. `build_sheet.py` takes
one `--row` per output row for exactly this reason.

The cost is the same three images either way; the difference is that a bad
grid wastes the whole generation, while a bad row wastes one third of it.

(The Newsey pipeline does use a single 4x3 grid — with magenta gridlines on
green cells, which gives the model a much stronger layout signal, and even
there the bottom row was the thing that came back cropped.)

## Sheets are the standard; individual frame files are legacy

**New characters ship as SHEETS** — one PNG per animation, cut at load. Newsey
predates this and ships each frame as its own file
(`<id>_<dir>_<n>.png`, nine files per character plus a walk sheet kept only as
source). That layout is supported and gated, but it is **not the pattern to
copy**:

- nine files per character per animation is nine chances for one to be
  missing, stale, or trimmed to a different size than its neighbours — and a
  set with a missing frame renders as a character that flickers or freezes;
- each file is trimmed independently, so their natural width:height ratios
  drift (Newsey's range from 1.18 to 2.15) and the game needs a clamp to stop
  sprites reading as stretched next to each other;
- one HTTP request per frame instead of one per animation.

A sheet makes all three impossible: the frames are cut from one image, so
they cannot go missing individually, cannot be scaled inconsistently, and
arrive together.

Do not migrate Newsey for its own sake — it works, and rewriting working art
plumbing is not free. New characters there can still be added as frame files
if that is what its code path wants. But a NEW GAME uses sheets.

## Two cutters, pick by game

- **`build_sheet.py`** (Dog Punk): rows generated on flat white, cut at the
  gutters or as connected blobs, snapped to a locked palette and a chunky
  art-pixel grid, laid out on a common foot baseline in fixed cells. Use when
  the game wants hard pixel-art normalisation and palette enforcement.
- **`slice_walksheet.py`** (Newsey): one grid image with magenta (#FF00FF)
  gridlines on chroma-green (#00FF00) cells, flood-keyed and sliced into
  individual `<id>_<dir>_<n>.png` files. Use when the game wants the
  generator's own rendering preserved per frame.

Both produce the same *semantics* above; they differ only in how much the art
is normalised afterwards.

## Consistency is a written rule, not a re-description

Anything that must not change between generations belongs in that game's
`art-style.json` — palette, build, and the small details that quietly drift:
sleeves vs sleeveless, ears up vs down, which hand holds the weapon. If a
detail is only in the prompt you happened to type, the next generation will
change it. Dog Punk's jacket came back sleeved in some frames and sleeveless
in others for exactly this reason.
