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

**The recipe now has ONE canonical copy**, `.github/art/walksheet_prompt.txt`,
and one-dispatch tooling around it:
`.github/workflows/generate-walksheet.yml` (game, character id, description,
optional references) builds the prompt from that file, generates the sheet,
slices it with `.github/art/slice_walksheet.py`, verifies the full 3x3 set came
out, and commits the frames. Edit the recipe there — the copy below is kept as
the explanation of WHY it reads the way it does, not as a second source to
retype from.

Prompt template — fill in `{...}`:

> A top-down RPG character walk-cycle sprite sheet, RPG-Maker-charset
> convention, laid out as a precise grid with THIN SOLID MAGENTA
> (#FF00FF) DIVIDER LINES, 2px wide, separating every row and column,
> clearly visible for mechanical slicing. Every cell's background must be
> flat, solid, pure CHROMA-KEY GREEN (#00FF00), completely uniform, crisp
> hard edge against the character. Grid: 4 rows × 3 columns, each cell
> the exact same size. CRITICAL, every cell without exception: the
> character must be a FULL BODY figure, head down to feet, visible
> feet/shoes, filling nearly the full cell height — NEVER a bust, NEVER
> cropped at the waist/hip. Character centered, same scale everywhere.
> RPG-Maker 3-frame walk cycle per row: Column 2 (middle) = neutral
> standing pose, straight legs together, arms relaxed — what the
> character looks like standing still. Column 1 = mid-step, left leg
> forward, weight shifted, opposite arm swung. Column 3 = mid-step, right
> leg forward, exact mirror of column 1. Row 1 (top) = facing DOWN. Row 2
> = facing LEFT in profile. Row 3 = facing RIGHT in profile, mirror of
> Row 2. Row 4 (bottom) = facing UP, back view — CRITICAL even from
> behind: full standing body, head with hair, shoulders, torso, legs,
> visible feet — NOT a shapeless blob of hair with no visible body. The
> character: {character description}. Use the reference ONLY for
> design/color likeness, not pose/crop.

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

Slicing (`.github/art/slice_walksheet.py`) — tuned to what the model
actually renders, not the literal prompt text:
- the "magenta" divider often renders as a softer, desaturated pink
  (observed RGB ≈ (201,124,168)), not pure #FF00FF — key on R and B both
  clearly exceeding G, not an exact hue match.
- row dividers run edge-to-edge reliably (threshold ~0.5 is fine). Column
  dividers get interrupted by arms/feet in some rows and can read as low
  as ~25-30% coverage — too high a threshold misses a real one entirely.
- whether the detected lines are pure interior dividers (need canvas
  edges added as outer bounds) or already include explicit border lines
  near-but-not-at the edge varies sheet to sheet, unpredictably. Try
  both interpretations and keep whichever gives the most uniform segment
  widths (excluding any 1-segment candidate, which trivially has zero
  variance and would always "win" on that alone) — a real grid was asked
  for as equal cells, so the correct interpretation is the one that
  actually looks equal-size.
- flood-fill the chroma-green background inward from the crop's border
  (follows the anti-aliased blend to the character's true edge, and
  correctly leaves alone any background-colored pixel trapped inside the
  silhouette, e.g. in shadow, since it's never reached from the border).
- still dilate-kill leftover magenta fringe from the divider line itself,
  THEN crop tight to content on all four edges. Skipping that final tight
  crop is how John's regenerated sprite once got ~14% invisible padding
  below his feet — his shadow was correctly placed by the code, but the
  sprite's own bottom edge (where the draw box ends) landed below where
  his feet actually were.

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

All 9 characters done — every wandering NPC in the game now has real
per-direction walk animation instead of a static sprite sliding around.

| Character  | Reference used         | Walk sheet | Notes |
|------------|-------------------------|:----------:|-------|
| Nella (Infinity/demon avatar) | `nella.png` | ✅ done | `nella_down/left/up_0/1/2.png` |
| Nella (human, pre-transformation) | `nella_human_top.png` | ✅ done | `nella_human_down/left/up_0/1/2.png`, wired via `FACING_FRAMES_HUMAN` |
| Chuck      | `chuck_top.png`          | ✅ done | `chuck_down/left/up_0/1/2.png`, wired via `NPC_FACING_FRAMES` |
| Devil      | `devil_top.png`          | ✅ done, but **unused** | Has a sheet (`devil_down/left/up_0/1/2.png`) from before the story changed — the devil isn't a standing character any more (see below), so this art doesn't currently render anywhere. Left in place in case a standing-devil moment is wanted later. |
| Kat        | `kat_top.png`            | ✅ done | `kat_down/left/up_0/1/2.png`, wired via `NPC_FACING_FRAMES` |
| May        | `may_top.png`            | ✅ done | `may_down/left/up_0/1/2.png`, wired via `NPC_FACING_FRAMES` |
| Timothy    | `timothy_top.png`        | ✅ done | `timothy_down/left/up_0/1/2.png`, wired via `NPC_FACING_FRAMES` |
| Michael    | `michael_top.png`        | ✅ done | `michael_down/left/up_0/1/2.png`, wired via `NPC_FACING_FRAMES` |
| John       | `john_top.png`           | ✅ done | `john_down/left/up_0/1/2.png`, wired via `NPC_FACING_FRAMES` |

TV is a prop, not a character — no walk cycle needed. The bed/save-point
and the lounge portal are also non-characters. The devil is now a
mirror-triggered popup (`marker: true` on his story.js entry, no sprite),
not a standing character — see the "devil is a mirror popup" commit — so
his walk sheet above is currently unused, not a bug.
