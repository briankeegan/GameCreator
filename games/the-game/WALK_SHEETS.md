# Walk-cycle art tracking

Every character needs real per-direction walk animation — not a static
pose slid around the room. This sheet exists so each generation follows
the exact same recipe (same grid, same technique) instead of drifting.

## The recipe (proven working — human-Nella's walk sheet, 2nd generation)

Costly lesson: the first version of this recipe (still visible in early
git history) got two real things wrong and it took several failed/wasted
generations each to find. Both are fixed below — don't regress them.

**Wrong thing #1 — the middle frame.** Researched against the real
RPG Maker charset convention (source: Galv's RPG Maker Scripts,
Studio Xehryn's spritesheet tutorial): a 3-frame walk row is NOT three
walking poses. The **middle column is a true neutral standing pose**
(straight legs, relaxed arms) — the same pose used both at rest AND as
the walk cycle's resting beat (animation plays middle→step→middle→
step). The two outer columns are the two mirrored step poses. Asking for
"3 clearly different walking poses" (no neutral column) produces a
character that has no correct idle frame — it freezes mid-stride the
instant it stops moving. `app.js`'s `drawPlayer` picks frame index 1 for
idle and cycles `[1,0,1,2]` while walking — the code and the art must
agree on which column is neutral.

**Wrong thing #2 — background color for busy-palette characters.** Plain
white cell backgrounds and pixel-art rendering do NOT produce a hard
edge — the model anti-aliases the boundary into a blended halo (pale
gray/off-white ring visible on every sprite, confirmed live). A flat
color threshold can't fully remove it; the fix is **flood-fill background
removal** (`slice_walksheet.py`'s `flood_fill_background`) which follows
the blend all the way in from the border, PLUS switching the cell
background from white to **solid chroma-key green (#00FF00)** — a
classic green-screen color, chosen because it's rare in character
palettes (verify per-character: don't use green for a character who
actually wears green).

**Wrong thing #3 — that same clash rule was never extended to the
DIVIDER, and it cost the most.** The line above says: check the key colour
against the character. It was written about the green background, and the
magenta gridlines are a key colour too. May's hair is magenta — sampled at
`(236,62,91)` — and the pass that removes the divider by colour matched
every pixel of her head. She came out of the cutter with her hair deleted:
a face with a thin dark outline where it used to be in the front and side
rows, and a headless coat in the back row. Three separate generations were
drawn correctly and destroyed on the way in, and the failure was reported
as a bad generation every time. The fix is not a better colour test — a
character and a gridline that are the same colour cannot be separated by
colour. **Cells are cut from the END of one green gutter to the START of
the next**, never through their middles, so no divider pixel is inside the
crop and there is nothing to remove. See "Slicing" below.

**The recipe now has ONE canonical copy**, `.github/art/walksheet_prompt.txt`,
and one-dispatch tooling around it:
`.github/workflows/generate-walksheet.yml` (game, character id, description,
optional references) builds the prompt from that file, generates the sheet,
slices it with `.github/art/slice_walksheet.py`, verifies the full 3x3 set came
out, and commits the frames. Edit the recipe there — the copy below is kept as
the explanation of WHY it reads the way it does, not as a second source to
retype from.

The prompt itself is NOT reproduced here any more. It used to be, "kept as
the explanation of WHY it reads the way it does" — and it drifted anyway: the
copy below this line still asked for 2px dividers and described the slicing
as a magenta-keying step long after both had changed. A second copy of a
recipe is a second thing to keep in sync, and this one lost. Read
`.github/art/walksheet_prompt.txt`; it is the only copy.

What is worth recording here is what the prompt CANNOT fix, which is the rest
of this page.

**The back-view (Row 4/UP) fails inside a 4-row grid, reliably, across
many attempts** — the model either draws only a hair blob with no body,
or (once fixed to full-body) crops the two side step-poses off the
canvas edge, leaving only the middle neutral frame usable. What worked:
generate the back view as its **own separate single reference image**
first (plain "Nella viewed from directly behind, full body, standing,
chroma-green background" — no grid, no walk cycle, just nail the camera
angle and full-body framing alone), verify it, THEN generate a 1×3
walk-cycle grid **using that clean back-view image as the reference**
(not the front-facing portrait) so the camera angle is anchored. Even
then the two side step-frames may still crop off-canvas — if so, ship
the working neutral middle frame as all three `_up_0/1/2` files rather
than a broken/cut-off pose; a correct static back view beats an animated
broken one. Revisit real back-view walk animation later if it matters.

RIGHT isn't generated even when asked for — it's LEFT mirrored in code
(a side profile flipped is identical), same as the player already does.

**The LEFT/RIGHT middle column can fail even with the standalone-reference
trick above.** Human-Nella's first LEFT sheet shipped with all three frames
being mid-stride (no neutral at all — missed in review because only the
DOWN row's middle frame was checked closely, not LEFT's). Regenerating with
explicit "column 2 is NOT a walking pose" wording still didn't produce a
neutral middle frame. What did work: generate the neutral pose as its own
**standalone single reference image** first (exact recipe as the back-view
fix above), which came out perfect — but then using that image as the
reference for a fresh 1×3 walk-cycle grid drifted the *middle* column's
camera angle back to front-facing, even though the two step-frame columns
correctly stayed in profile. Fallback that actually worked: don't trust one
generation to deliver all 3 correct frames — **manually combine sources**,
taking the two step-pose frames from the walk-cycle grid attempt and the
neutral frame from the standalone reference image (sliced with the same
`cut_and_trim()`, called directly rather than through the grid-detecting
`main()`). Lesson: always visually check the STOP pose in-game per
direction, not just an aggregate contact-sheet glance — a wrong middle
frame reads fine in a still image and only shows up as "legs still walking"
once the character actually stops.

**That fallback is a command now, and the check for it is automatic.** Two
reasons it had to become both:

- The last step above ("sliced with the same `cut_and_trim()`, called
  directly rather than through the grid-detecting `main()`") described a
  python call somebody had to write by hand. A recipe whose final step is
  "write some code" gets followed once, written down, and then not followed
  again — which is exactly what happened: twelve of fourteen characters
  shipped side rows with no standing frame in them. It is
  `slice_walksheet.py single <image> <out-dir> <id> <dir> [index]`.
- The defect was invisible to the checker. `NEUTRAL_RATIO` asks how
  DIFFERENT the three frames are from each other; three mid-stride poses
  that differ nicely from one another sail through it. `STANCE_RATIO` asks
  the question that matters — is frame 1 a person standing still — by
  measuring the width of the silhouette at the FEET: a stand has them
  together, a stride has them apart. Side row only, because the standard
  says the side row is the only one where the step is real displacement.

The whole fix, per character:

```sh
# 1. generate the standing side pose ALONE (Actions -> Generate referenced
#    asset, referencing that character's own _left_0 and _top), into
#    games/the-game/art-src/<id>_left_stand.png
# 2. cut it into the neutral slot, keeping the two step frames from the grid
python3 .github/art/slice_walksheet.py single \
    games/the-game/art-src/<id>_left_stand.png games/the-game/art <id> left 1
# 3. confirm the checker agrees it is now a stand
python3 .github/art/verify_sheet.py frames games/the-game/art <id>
```

Slicing is `.github/art/slice_walksheet.py`. **Its behaviour is not described
here.** Every tuning decision in it — why the divider is keyed on relative
channel dominance rather than an exact hue, why the two grid interpretations
are both tried, why the background is flood-filled from the border instead of
thresholded, why the final crop is tight, and why cells are cut between the
green gutters rather than through them — is written in the comments beside the
code that does it, next to the sample values that forced each choice. Read it
there.

This page had a copy of that list. It drifted: it still described the cutter
as removing the divider by colour after that had been replaced, which is the
failure mode it was written to prevent.

Output files per character: `<id>_down_0/1/2.png`, `<id>_left_0/1/2.png`,
`<id>_up_0/1/2.png` (9 files, frame index 1 = neutral/idle in every
direction). Wired into `app.js` via `NPC_FACING_FRAMES` (`npcDirFrames()`),
a per-NPC facing+frame lookup generalized off the player's own
`FACING_FRAMES_HUMAN` pattern (`WALK_SEQUENCE = [1,0,1,2]`) — driven by the
NPC's wander direction/state (`updateNpcWander` tracks `facing`/`walking`/
`walkPhase` on the same wander-state object) instead of keyboard input. An
id absent from `NPC_FACING_FRAMES` just falls back to the old static
sprite/bust, so this was safe to land before every character had a sheet.

## Status

**Not listed here.** This page used to carry a per-character table of which
sheets were done. It said May ✅ and Chuck ✅ while May's frames had her hair
deleted and no head in the back row, and Chuck's were a bald man in an orange
suit instead of the moustached one in his portrait — and it did not mention
Rex, Diamond, Eric, Magma or Kyran at all, who had been added since. A
hand-kept list of what is finished is a claim, and claims rot.

Ask the tooling instead. It reads the actual files:

```sh
# every character's frame set: missing, duplicated, cropped, no-neutral
for ch in $(ls games/the-game/art/*_down_0.png | sed 's#.*/##;s/_down_0.png//'); do
  python3 .github/art/verify_sheet.py frames games/the-game/art "$ch"
done
```

The same checker runs on every push (`pages.yml`, "Verify character frame
sets"), so a set that is broken cannot sit here being described as done.

Which characters are WIRED to their frames is likewise a fact about the code,
not about this page — `NPC_FACING_FRAMES` in `app.js` is the list, and an id
absent from it falls back to the static sprite rather than breaking.
