<!-- GENERATED from .github/art/CHARACTER_SHEETS.md by .github/art/rules_card.py — do not edit.
     Edit the standard; the card is extracted from it and CI checks it matches. -->

# Character sheet standard
## Frames
- **Walk — 3 frames per direction: `[step, NEUTRAL, step]`**
| col | pose |
|-----|------|
| 0 | mid-step, **LEFT foot forward**, right foot back |
| 1 | **neutral** — standing still, both feet together under the body |
| 2 | mid-step, **RIGHT foot forward**, left foot back |
- **A stride is drawn differently depending on the row, because a leg moving toward the camera is foreshortened to nothing.** State it per row:
- **Side row** — a true fore/aft split: one foot planted ahead of the body, the other behind, a clear gap between them. This is the only row where the step reads as displacement.
- **Front and back rows** — see below. The step is SMALL, and most of the animation is not in the legs at all.
### How a front or back walk is actually built
### …and then don't ask for it. Build it.
- **Cut every walk sheet with `build_sheet.py --build-steps 0,2`.** It builds the front and back rows' two step frames out of their own standing frame by lifting each leg in turn, so the steps are opposite BY CONSTRUCTION and only the middle frame has to be drawn well. Six front rows in a row lifted the same foot twice before this existed, which draws a character walking with one leg.
- **Only for front and back rows.** A side stride is a fore/aft split, not a lift, and the same cutter flag on a side row would produce nonsense.
- **Attack — 3 frames per direction: `[wind-up, strike, recover]`**
| col | pose |
|-----|------|
| 0 | wind-up — weapon pulled back and raised, body coiled, before contact |
| 1 | **strike** — mid-slash, the weapon sweeping through an arc across the body as it lands |
| 2 | recover — follow-through, weapon carried past the target and down |
- **The columns mean the same thing in every row.** Front, side and back all use left-forward / standing / right-forward; the only thing that changes between rows is the camera angle. That is what lets one playback sequence drive every direction, and it is why a row that quietly reinterprets its columns (a "neutral" that is really a third stride, or a standing frame drawn from a different angle than its own row) breaks the cycle in that direction only — the hardest kind of bug to spot, because the other directions look fine.
- **Roll / dodge — OPTIONAL, 3 frames, ONE ROW ONLY: `[tuck, mid-roll, recover]`**
| col | pose |
|-----|------|
| 0 | tuck — crouching in, ball up, about to go over |
| 1 | **mid-roll** — curled sideways mid-tumble, the silhouette rolled onto its side/back, legs and arms tucked in |
| 2 | recover — popping back up out of the tuck, momentum settling |
- **Invulnerability spans the whole roll, not one frame.** Unlike the attack sheet's single strike-frame hit, there is no one column that "lands" — the character cannot be hit for the whole duration the roll animation plays, so gate that in code off the same clock that drives which of the 3 columns is on screen, not off a specific frame index.
- **The same character, materials and locked colours as every other sheet of that character** — a roll sheet is still checked against the spec like a walk or attack sheet; drawing it in a different pose is not licence to redraw the mohawk, the jacket or any other `appears: always` material out of frame.
## Directions
- **RIGHT is never drawn.** It is the side row mirrored with `ctx.scale(-1, 1)`, for players and NPCs alike. A side row that is not a true side profile therefore breaks both horizontal directions at once — and a "neutral" frame that quietly turns to face the viewer makes the character spin to camera every other beat while walking.
## The recipe that works (use it; don't re-derive it)
## Obvious to a person, invisible to a generator
- **The body stays square to the camera** in the front and back rows. Rotating into a three-quarter pose to suggest movement makes a character walking toward you read as walking sideways.
- **A step is drawn per view** : fore/aft split in the side row, lifted boot in the front and back rows. A leg moving toward the camera is invisible.
- **The head and torso do not redraw between frames of a row.** Same pixels, same place; only limbs and a one-pixel body dip change.
- **Opposite arm to lifted leg.** Left boot up, right arm forward. Same-side arm and leg is a waddle, and a prompt that does not say so gets one about half the time.
- **The defining feature survives every frame** — mohawk, hat, horns — from behind and mid-attack included. It is the first thing to vanish.
- **The same character, every frame** : species, build, palette, and the `lockedDetails` from `art-style.json` (sleeves, ears, which hand holds the weapon).
- **A back view is a body, not a hairstyle** : head, shoulders, torso, legs, feet — not a shapeless mass of hair with no visible body under it.
- **The head is a separate shape from the shoulders.** Say it explicitly, and say what separates them: a head narrower than the shoulders, sitting above the shoulder line, with background visible on both sides of it. Two consecutive back rows for Dog Punk came back as one wide orange lump with a mohawk on top and no head at all — from behind there is no face to anchor the head, so the generator merges it into the torso unless told not to.
- **This is the least tractable rule on the list, and worth knowing before you spend on it.** Four more Dog Punk back rows were generated against progressively more explicit wording — outlined ears either side, a collar- width neck, "no wider than half the shoulder width", the failure named in the prompt — and all four came back as the same lump, three of them also dropping the jacket off the torso to sit round the hips as a skirt with the chest left in bare fur. The row that ships is still an older one. Budget one generation for a back row, look at it, and if it lumps, keep the best back row you already have rather than chasing it: it is the one view where the colour and the outfit matter more than the anatomy, because the player is looking at the character's back.
- **Both legs and both boots visible in every frame** , with background between them. "Legs vertical and separated" is not enough on its own: the step frames still came back with the two legs fused into one brown mass while the standing frame was fine.
- **The weapon stays in the same hand** across walk and attack sheets.
- **A blade slashes, it doesn't poke** : an arc across the body, not a thrust with the blade pointed along the direction of travel.
- **The standing frame is standing** : feet together, no stride, no lean, and drawn from its own row's angle.
- **Nothing touches the edge of the image** , and sprites never overlap each other.
- **No ground line under the feet.** Given "no shadows" a generator will still often draw a floor bar or plinth for the character to stand on; it gets cut into the sprite and ships as a black stripe under the boots. The character floats on empty background — the game draws its own floor.
## What the checker cannot decide
## Files
## Generate ONE ROW PER IMAGE, not a grid
## Don't generate a row from a reference image
## Sheets are the standard; individual frame files are legacy
- **New characters ship as SHEETS** — one PNG per animation, cut at load. Newsey predates this and ships each frame as its own file (`<id>_<dir>_<n>.png`, nine files per character plus a walk sheet kept only as source). That layout is supported and gated, but it is **not the pattern to copy**:
## Two cutters, pick by game
- **`build_sheet.py`** (Dog Punk): rows generated on flat white, cut at the gutters or as connected blobs, snapped to a locked palette and a chunky art-pixel grid, laid out on a common foot baseline in fixed cells. Use when the game wants hard pixel-art normalisation and palette enforcement.
- **`slice_walksheet.py`** (Newsey): one grid image with magenta (#FF00FF) gridlines on chroma-green (#00FF00) cells, flood-keyed and sliced into individual `<id>_<dir>_<n>.png` files. Use when the game wants the generator's own rendering preserved per frame.
- **The gridlines are the single point of failure, and the model does drop them.** May's sheet came back with the art perfect — pink hair, royal-blue robe, three clean rows, every head whole — and *zero magenta pixels anywhere in the image*. With no dividers to find, the slicer reported "1 rows x 11 cols" and wrote three 30x343 slivers of coat as her front-facing walk cycle. Chuck's came back with gridlines but only two readable rows, so his back view was never cut at all. Both runs reported success.
- **And the cutter itself was eating May's hair.** The reason her head kept coming back half-missing was never the generation: the divider-removal pass keys out magenta, her hair *is* magenta (sampled at `(236,62,91)`), and the colour test that hunts the divider matched every pixel of her head. She came out with a thin dark outline where her hair had been in the front and side rows, and a headless coat in the back row. A character cannot be told from a gridline by colour when they are the same colour — so it is settled by geometry instead: cells are cut from the END of one green gutter to the START of the next, never through their middles, so no divider pixel is inside the crop and there is nothing to remove.
## The character spec — the thing that makes consistency enforceable
- **Prompts are built from it.** `generate_row.py` turns the spec into the description it sends, every time. Nobody retypes it, so nobody can leave a bit out.
- **Sheets are checked against it.** `verify_sheet.py character <gameDir> <id>` compares every sheet of that character **view by view** and fails when a material the spec marks `appears: always` is present in one sheet and gone from another.
- **`appears` is the field that makes the check possible at all.** Beverly's mohawk disappearing from her attack sheet is a bug; her dagger blade appearing only in that same sheet is correct — she draws it to swing it. To anything counting pixels those are identical. `appears: always` is the only thing that separates them, which is why the spec is infrastructure rather than documentation.
- **A colour shared by an always material and a conditional one cannot be required.** Beverly's jacket studs and her dagger blade are both `#dfe4ea`, so its presence proves nothing about either — the first version of the check duly failed her walk sheet for containing no blade. Shared hexes are dropped from enforcement and flagged as a spec problem to fix.
- **Compare like with like.** A front view and a back view legitimately show different materials — Beverly's shorts are 0% from behind in every sheet because her jacket covers them. Only the *same view across different sheets* is a fair comparison.
- **NO SPEC, NO GENERATION — the generator refuses.** A spec written *after* the art is a description of whatever came out; the point is to fix what the character is before anything draws them. `generate-walksheet.yml` looks the character up in `art-style.json` and fails with "write the character spec FIRST" if it is not there, and builds its prompt from the spec when it is. Its `description` input is now an optional extra note for one run, not the character — because a typed description is exactly what drifted: Rex came back a smooth-faced youth in a scarf against a sprite and a plot that both say a bearded man in a gold robe, and May's antlers survived three regenerations, because nothing mechanical had any idea what either of them looks like.
- **Add to a spec the moment a detail is caught drifting.** That is the entire point of it: the mohawk note, the "ears are never brown" note and the flat-coat note are all things that shipped wrong first.
## Consistency is a written rule, not a re-description
### `lockedColours`: the EXACT HEX PER MATERIAL, in every prompt
### What a colour-drift gate CANNOT be, and the numbers
| metric (per row pair) | broken sheet | corrected sheet |
|---|---|---|
| mean row colour, Lab dE | 9.0 / 10.1 / 13.9 | 6.9 / 11.4 / **16.8** |
| colour-histogram overlap | 0.54 / 0.73 / 0.55 | 0.76 / 0.69 / **0.61** |
