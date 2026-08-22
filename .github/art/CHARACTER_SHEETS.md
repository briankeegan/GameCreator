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
- **Front and back rows** — see below. The step is SMALL, and most of the
  animation is not in the legs at all.

### How a front or back walk is actually built

The side view is easy: the legs scissor and the eye reads it. Front-on, the
legs move almost entirely *toward and away from the camera*, where they are
foreshortened to nothing — so a front walk drawn by describing the legs comes
back as a muddle. Three attempts on Dog Punk failed exactly that way ("left
foot forward" → invisible difference; "thigh raised" → a brown blob; "boot
lifted a couple of pixels" → readable but still not a walk).

The convention every pixel-art walk cycle tutorial converges on — RPG-Maker
charsets, the finalbossblues walk-cycle series, the Lospec tutorials — builds
the row out of four rules, and only one of them is about legs:

1. **The head and torso are drawn ONCE and reused unchanged in all three
   frames.** Same pixels, same position. Only the limbs and the vertical
   offset differ. This is the single biggest one: when the head redraws
   frame-to-frame, the character reads as jittering rather than walking, and
   every "random bits in it" complaint against these rows traced back to a
   body that was redrawn each frame.
2. **The two step frames sit ONE PIXEL LOWER than the standing frame.** The
   body dips as weight transfers. One pixel, on a ~64px sprite — it is the
   bob, and it is felt more than seen.
3. **The arms swing as a pendulum, and they carry the animation.** Opposite
   arm to lifted leg: left boot up ⇒ RIGHT arm forward. Same-side arm and leg
   is a waddle, and it is what an unspecified prompt produces about half the
   time. To fake depth on a flat front view, draw the arm swinging *back*
   slightly **smaller and darker**, and the arm swinging *forward* slightly
   **larger and brighter**.
4. **The legs do the bare minimum: lift, plant, push.** Both legs vertical,
   clearly separated with background visible between them, one boot raised a
   couple of pixels (heel up, knee barely bent), the other flat. Nothing more
   fits — at this scale a character's legs are perhaps ten pixels tall, and a
   raised thigh has nowhere to go.

The tutorials are honest that (4) "does not accurately portray the movement of
walking". It is the standard compromise, and it works *because* (1)–(3) are
carrying it. Drop the reused torso or the arm swing and the leg lift alone
reads as a twitch.

The middle frame is the odd one out and stays simple: both feet flat on the
ground at the same height, both legs straight, both arms hanging straight
down, no dip. It is the standing pose, symmetrical.

### …and then don't ask for it. Build it.

All four rules above go in the prompt and they help, but they do not hold. The
step frames are the ones a generator draws worst: across a dozen Dog Punk rows
the standing frame came back clean nearly every time — two legs, a gap between
them, both feet flat — while the step frames fused the legs into a dark mass,
crossed them, splayed them sideways, or lifted **the same foot in both**, which
is what "is the same foot moving twice?" looks like from the sofa. Six front
rows in a row did the last one, including ones that named the feet, named the
*viewer's* left and right, and asked outright for "frame 3 is frame 1
mirrored".

So ask for the pose it draws well and construct the two it does not:

**Cut every walk sheet with `build_sheet.py --build-steps 0,2`.** It builds the
front and back rows' two step frames out of their own standing frame by lifting
each leg in turn, so the steps are opposite BY CONSTRUCTION and only the middle
frame has to be drawn well. Six front rows in a row lifted the same foot twice
before this existed, which draws a character walking with one leg.

The neutral frame's legs are separated by a gap of background. The cutter finds
that gap, lifts the leg on one side of it — that is a step — then lifts the
other, which is the opposite step. What this buys, all of it by construction
rather than by hope:

- the two steps are true opposites, so the same-foot repeat cannot happen;
- everything above the legs is *the same pixels* in all three frames, which is
  rule 1 enforced instead of requested;
- the middle frame is a true neutral, because it is the frame that was drawn;
- one clean pose per row is all a generation has to land.

It costs the arm swing (rule 3) between the two step frames, which at 64px is
a couple of pixels. That is a good trade for a walk that reads.

**Only for front and back rows.** A side stride is a fore/aft split, not a
lift, and the same cutter flag on a side row would produce nonsense.

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

0. **Use the Action**: `.github/workflows/generate-walkrow.yml` (game,
   character, view). It does steps 1-6 below — builds the prompt from
   `walkgrid_prompt.txt` plus the game's `art-style.json`, generates one row,
   verifies it, and commits it only if it passes. The steps are written out
   here because the Action is only that recipe made executable; if you are
   doing it by hand, do these.
1. **One row per image**, landscape 1536x1024, three sprites across.
2. **Flat pure white background**, keyed out afterwards — never ask for
   transparency, it comes back as a beige wash.
3. **Name the foot** (left forward / standing / right forward) and state the
   row's camera angle **per frame**, including on the standing frame. On a
   front or back row also say: same head and torso in all three frames,
   opposite arm to the lifted boot, body one pixel lower on the step frames.
4. **State the margin**: wide empty space on all four sides, clear gaps
   between sprites, nothing touching an edge.
5. **List the locked details** from the game's `art-style.json` in the prompt
   — sleeves, ears, which hand holds the weapon.
6. **Verify before cutting**: `verify_sheet.py raw <row>.png --frames 3 --walk`,
   adding `--mirrored` on a front or back row. It fails on clipping, wrong
   frame count, duplicate frames, a missing neutral, and the same foot lifted
   in both step frames. Cutting an unverified row is how a bad set reaches the
   game.
   Add `--steps-built` whenever the row's steps will be CONSTRUCTED by
   `build_sheet.py --build-steps` (i.e. on every front and back row — step 7).
   The same-foot verdict then warns instead of failing, because the frames it
   judges are thrown away before anything ships; `generate_row.py` passes it
   for you. Without it, a row with a perfectly good standing frame — the only
   frame that row has to land — is binned for a defect that cannot reach the
   game, at a generation each. That happened twice in one run.
   A row that does fail is MOVED to `art-src/rejected/`, not deleted: nothing
   points a build at that directory, so it still cannot reach a sheet, but you
   can LOOK at it. That is the difference between "regenerate, the drawing is
   wrong" and "keep it, only the background came back dirty" — a distinction
   that is impossible to make once the file is gone, and two of the three
   rejects in that same run turned out to be good drawings on a dark backdrop.
7. **Cut with `build_sheet.py`**, one `--row` per direction, `--build-steps 0,2`
   so the front and back steps are constructed rather than trusted, and
   `@height` per row if the character is a different height from different
   angles.
8. **`medium` quality is enough** for flat cartoon pixel art; `high` is for a
   showcase asset, and costs about four times as much.

## Obvious to a person, invisible to a generator

Every line here is a rule a human would never break and a generator breaks
routinely. State them in the prompt, every time — the canonical prompts
already do:

- **The body stays square to the camera** in the front and back rows. Rotating
  into a three-quarter pose to suggest movement makes a character walking
  toward you read as walking sideways.
- **A step is drawn per view**: fore/aft split in the side row, lifted boot in
  the front and back rows. A leg moving toward the camera is invisible.
- **The head and torso do not redraw between frames of a row.** Same pixels,
  same place; only limbs and a one-pixel body dip change.
- **Opposite arm to lifted leg.** Left boot up, right arm forward. Same-side
  arm and leg is a waddle, and a prompt that does not say so gets one about
  half the time.
- **The defining feature survives every frame** — mohawk, hat, horns — from
  behind and mid-attack included. It is the first thing to vanish.
- **The same character, every frame**: species, build, palette, and the
  `lockedDetails` from `art-style.json` (sleeves, ears, which hand holds the
  weapon).
- **A back view is a body, not a hairstyle**: head, shoulders, torso, legs,
  feet — not a shapeless mass of hair with no visible body under it.
- **The head is a separate shape from the shoulders.** Say it explicitly, and
  say what separates them: a head narrower than the shoulders, sitting above
  the shoulder line, with background visible on both sides of it. Two
  consecutive back rows for Dog Punk came back as one wide orange lump with a
  mohawk on top and no head at all — from behind there is no face to anchor
  the head, so the generator merges it into the torso unless told not to.
  **This is the least tractable rule on the list, and worth knowing before you
  spend on it.** Four more Dog Punk back rows were generated against
  progressively more explicit wording — outlined ears either side, a collar-
  width neck, "no wider than half the shoulder width", the failure named in the
  prompt — and all four came back as the same lump, three of them also dropping
  the jacket off the torso to sit round the hips as a skirt with the chest left
  in bare fur. The row that ships is still an older one. Budget one generation
  for a back row, look at it, and if it lumps, keep the best back row you
  already have rather than chasing it: it is the one view where the colour and
  the outfit matter more than the anatomy, because the player is looking at the
  character's back.
- **Both legs and both boots visible in every frame**, with background between
  them. "Legs vertical and separated" is not enough on its own: the step
  frames still came back with the two legs fused into one brown mass while the
  standing frame was fine.
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

One of these was tried mechanically and abandoned, so it is not tried again:
"the head and torso must not redraw between frames" looks measurable — compare
the top third of each frame and flag a row where it changes as much as the
rest. Measured on real rows it does not discriminate at all. Frames are cropped
independently before comparison, so a one-pixel difference in crop moves the
whole head; the ratio came out 0.86 on the side row that was accepted by eye
and 0.53 on the front row that was rejected — backwards. The rule stays in the
prompt, where it demonstrably helps; it does not become a gate.

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

## Don't generate a row from a reference image

The obvious fix for rows drifting apart — generate the front and back rows
*from* the approved side row, using "Generate referenced asset"
(OpenAI `/v1/images/edits`) — was tried three times for Dog Punk and is worse
than plain text generation, every time:

- the output came back at visibly lower detail than the reference, with the
  chunky pixel grid smeared;
- the palette drifted anyway (orange-tan fur returned as flat yellow in one
  run, dark brown in another) — the exact thing referencing was supposed to
  prevent;
- one row still rotated its third frame into a three-quarter pose.

Referencing is for matching a *look* on a one-off asset (a scene, a portrait).
For a sprite row, the text prompt plus the game's `art-style.json` and the
cutter's palette snap holds the character together better, and the cutter
normalises scale afterwards regardless.

(The Newsey pipeline does use a single 4x3 grid — with magenta gridlines on
green cells, which gives the model a much stronger layout signal, and even
there the bottom row was the thing that came back cropped. It also drops the
gridlines outright often enough to need a checker; see "Two cutters" below.)

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

  **The gridlines are the single point of failure, and the model does drop
  them.** May's sheet came back with the art perfect — pink hair, royal-blue
  robe, three clean rows, every head whole — and *zero magenta pixels
  anywhere in the image*. With no dividers to find, the slicer reported
  "1 rows x 11 cols" and wrote three 30x343 slivers of coat as her
  front-facing walk cycle. Chuck's came back with gridlines but only two
  readable rows, so his back view was never cut at all. Both runs reported
  success.

  **And the cutter itself was eating May's hair.** The reason her head kept
  coming back half-missing was never the generation: the divider-removal pass
  keys out magenta, her hair *is* magenta (sampled at `(236,62,91)`), and the
  colour test that hunts the divider matched every pixel of her head. She came
  out with a thin dark outline where her hair had been in the front and side
  rows, and a headless coat in the back row. A character cannot be told from a
  gridline by colour when they are the same colour — so it is settled by
  geometry instead: cells are cut from the END of one green gutter to the
  START of the next, never through their middles, so no divider pixel is
  inside the crop and there is nothing to remove.

  Three things now stop that, and all three are needed:
  1. `slice_walksheet.py` **cuts on the green gutters** when the magenta grid
     does not resolve to 3–4 rows of 3, and refuses only if the green fails
     too. The background is the one thing the model cannot forget to draw,
     because it is what it draws the characters on. It also **drops a
     trailing row far shorter than its siblings** — the cropped bottom row
     this document already warned about, which is where the headless frames
     came from.
  2. `generate-walksheet.yml` **deletes the character's existing frames
     before slicing.** Its completeness check asks "is there a file here",
     and a file from the previous generation answers yes: that is precisely
     how May kept her old antlered, decapitated cycle through a regeneration
     that had already drawn her correctly.
  3. That workflow then runs `verify_sheet.py frames` before committing,
     because present is not the same as usable — nine real files that happen
     to be slivers pass a existence check and fail this one.

Both produce the same *semantics* above; they differ only in how much the art
is normalised afterwards.

## The character spec — the thing that makes consistency enforceable

Every animated character has an entry under `characters` in its game's
`art-style.json`, written **before** any of its art is generated. That entry is
the single source of truth, and it is used twice:

- **Prompts are built from it.** `generate_row.py` turns the spec into the
  description it sends, every time. Nobody retypes it, so nobody can leave a
  bit out.
- **Sheets are checked against it.** `verify_sheet.py character <gameDir> <id>`
  compares every sheet of that character **view by view** and fails when a
  material the spec marks `appears: always` is present in one sheet and gone
  from another.

```jsonc
"characters": {
  "hero": {
    "name": "Beverly",
    "species": "a stocky punk-rock GOLDEN DOODLE — dog snout, floppy ears. Not a bear, wolf or fox.",
    "materials": {
      "mohawk": { "base": "#ff5c9a", "shade": "#e8306f", "appears": "always",
                  "note": "A TALL upright crest. NOT a flat cap, NOT a beret." },
      "dagger": { "blade": "#dfe4ea", "grip": "#4e2e15", "appears": "attack sheets" }
    },
    "proportions": "about three and a half heads tall, head roughly a quarter of total height",
    "neverDraw": ["a curly coat", "brown ears", "a sleeveless jacket"]
  }
}
```

**`appears` is the field that makes the check possible at all.** Beverly's
mohawk disappearing from her attack sheet is a bug; her dagger blade appearing
only in that same sheet is correct — she draws it to swing it. To anything
counting pixels those are identical. `appears: always` is the only thing that
separates them, which is why the spec is infrastructure rather than
documentation.

Two rules learned building it:

- **A colour shared by an always material and a conditional one cannot be
  required.** Beverly's jacket studs and her dagger blade are both `#dfe4ea`,
  so its presence proves nothing about either — the first version of the check
  duly failed her walk sheet for containing no blade. Shared hexes are dropped
  from enforcement and flagged as a spec problem to fix.
- **Compare like with like.** A front view and a back view legitimately show
  different materials — Beverly's shorts are 0% from behind in every sheet
  because her jacket covers them. Only the *same view across different sheets*
  is a fair comparison.

**Add to a spec the moment a detail is caught drifting.** That is the entire
point of it: the mohawk note, the "ears are never brown" note and the flat-coat
note are all things that shipped wrong first.

## Consistency is a written rule, not a re-description

Anything that must not change between generations belongs in that game's
`art-style.json` — palette, build, and the small details that quietly drift:
sleeves vs sleeveless, ears up vs down, which hand holds the weapon. If a
detail is only in the prompt you happened to type, the next generation will
change it. Dog Punk's jacket came back sleeved in some frames and sleeveless
in others for exactly this reason.

### `lockedColours`: the EXACT HEX PER MATERIAL, in every prompt

`lockedPalette` is not enough, and believing it was cost Dog Punk a dozen
rounds. The cutter maps every pixel to the NEAREST palette colour — it enforces
*membership*, not *choice*. A palette wide enough to hold fur, fur shadow and
brown boots contains both a light orange and a mid brown, so a row the
generator happened to draw one step darker snaps to the browns and ships as a
different-coloured animal. Dog Punk's front and back rows were `#f0a35a`; its
side row was `#7a4a24`. Beverly changed colour when you walked left, and every
regeneration of a single row just landed somewhere else again.

The shade has to stop being the generator's choice, so `art-style.json` carries
a `lockedColours` map and `generate_row.py` quotes it into EVERY row it builds:

```json
"lockedColours": {
  "mainCharacter": "fur #f0a35a with #e0791c shading …; boots #7a4a24 …",
  "Junk Rat": "body fur #8a7a62 with #6b5c48 shading; …"
}
```

Keyed by character: `mainCharacter` by default, or the key whose name appears
in the `--description` passed for that row. Write it out material by material —
"fur", "jacket", "boots" — because a bare list of hexes gets distributed at
random over the drawing.

`verify_sheet.py sheet` warns when rows disagree anyway (`COLOUR DRIFT`), which
is how you find out before a player does.

### What a colour-drift gate CANNOT be, and the numbers

Two metrics were tried as a hard gate first, and both rank the CORRECTED sheet
worse than the broken one, because rows legitimately show different amounts of
each material — a back view is mostly jacket, a side view mostly head and
snout:

| metric (per row pair) | broken sheet | corrected sheet |
|---|---|---|
| mean row colour, Lab dE | 9.0 / 10.1 / 13.9 | 6.9 / 11.4 / **16.8** |
| colour-histogram overlap | 0.54 / 0.73 / 0.55 | 0.76 / 0.69 / **0.61** |

What does discriminate is a colour carrying a large share of one row and
almost none of another (outline colours excluded — their share swings with how
busy a silhouette is). Measured, biggest offender per sheet: broken hero
`#f0a35a` 17% vs 4.2%; the rat sheet as shipped `#8a7a62` 21% vs 1.6%; the
corrected hero `#3d434f` 11% vs 2.4% — and that last one is *legitimate*, a
jacket highlight visible from behind and not from the front. Trigger at 15% of
a row with under 30% of that share elsewhere, and it separates them — but a
metric with a known false positive of that shape stays a WARNING, never a
build failure.
