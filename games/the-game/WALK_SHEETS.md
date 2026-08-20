# Walk-cycle art tracking

Every character needs real per-direction walk animation — not a static
pose slid around the room. This sheet exists so each generation follows
the exact same recipe (same grid, same technique) instead of drifting.

## The recipe (proven — this is how human-Nella's walk sheet was made)

Use `generate-referenced-asset.yml`, reference = the character's existing
`*_top.png` (or portrait if no sprite exists yet) for design/color
likeness only. Prompt template — fill in the `{...}` parts. Ask for 4
rows (down/left/right/up) even though the model reliably only delivers
3 (down/left/up, silently dropping RIGHT) — asking for 4 anyway seems to
be what keeps the 3 it does deliver distinct and correctly-posed; asking
for exactly 3 up front produced a worse, garbled result once in testing:

> A top-down RPG character sprite sheet laid out as a precise grid with
> THIN SOLID MAGENTA (#FF00FF) DIVIDER LINES, 2 pixels wide, separating
> every row and every column — these magenta gridlines are REQUIRED and
> must be clearly visible so the grid can be mechanically sliced
> afterward. Grid: 4 rows × 3 columns, each cell exactly the same size,
> the character centered and the exact same scale in every single cell.
> Row 1 (top) = facing DOWN toward viewer, 3-frame walk cycle. Row 2 =
> facing LEFT in side profile, 3-frame walk cycle. Row 3 = facing RIGHT
> in side profile — this MUST be the exact horizontal mirror image of
> Row 2 — do NOT repeat Row 2's left-facing pose here. Row 4 (bottom) =
> facing UP, back view, 3-frame walk cycle. The character in every cell:
> {character description}. Use the reference ONLY for character
> design/color likeness, not its pose. Background of each cell: plain
> solid white (#FFFFFF), NOT transparent — only the magenta gridlines
> separate cells, no other text or labels.

RIGHT-facing isn't needed even when the model drops it — it's LEFT
mirrored in code (a side profile flipped is identical), same as the
player already does.

Slicing (`slice_walksheet.py`, written this session — ask for it if it's
not already in the repo, it lived in scratch space): detect gridlines
programmatically, but tune to what the model actually renders, not the
literal prompt text —
- the "magenta" divider is a softer, desaturated pink (observed RGB
  ≈ (201,124,168)), not pure #FF00FF — key on R and B both clearly
  exceeding G, not an exact hue match.
- row dividers run edge-to-edge reliably (high threshold, ~0.5, is fine).
  Column dividers get interrupted by arms/feet crossing them in some
  rows, so a real one can read as low as ~30-40% coverage — use a looser
  threshold (~0.25) or a real divider gets missed entirely.
- the model sometimes frames the whole grid with left/right border lines
  a bit inset from the canvas edge, instead of running columns flush to
  x=0/width. Detect this (first/last line far from the canvas edge) and
  use the detected lines AS the outer bounds — don't also prepend x=0 or
  append width, or the outer "column" becomes a blank margin sliver.
- after cropping a cell, still kill leftover magenta fringe (dilate the
  magenta mask a few px — a soft/anti-aliased divider leaves a faint
  halo the raw color test alone won't catch) THEN crop tight to content
  on all four edges. Skipping the tight final crop is how John's
  regenerated sprite ended up with ~14% invisible padding below his feet
  — his shadow was correctly placed by the code, but the sprite's own
  bottom edge (where the draw box ends) landed below where his feet
  actually were. See `git log --oneline -- 'art/*_top.png'` around
  "untrimmed bottom padding".

Output files per character: `<id>_down_0/1/2.png`, `<id>_left_0/1/2.png`,
`<id>_up_0/1/2.png` (9 files). Wire into `app.js` the same way
`FACING_FRAMES` already does for Nella — a per-NPC facing+frame lookup,
generalized off the existing player code, driven by the NPC's wander
direction instead of keyboard input.

## Status

| Character  | Reference used         | Walk sheet | Notes |
|------------|-------------------------|:----------:|-------|
| Nella (Infinity/demon avatar) | `nella.png` | ✅ done | `nella_down/left/up_0/1/2.png` |
| Nella (human, pre-transformation) | `nella_human_top.png` | ✅ done | `nella_human_down/left/up_0/1/2.png`, wired via `FACING_FRAMES_HUMAN` |
| Chuck      | `chuck_top.png`          | ❌ not started | |
| Devil      | `devil_top.png`          | ❌ not started | |
| Kat        | `kat_top.png`            | ❌ not started | |
| May        | `may_top.png`            | ❌ not started | |
| Timothy    | `timothy_top.png`        | ❌ not started | |
| Michael    | `michael_top.png`        | ❌ not started | |
| John       | `john_top.png`           | ❌ not started | |

TV is a prop, not a character — no walk cycle needed. The bed/save-point
and the lounge portal are also non-characters.

## Order of work

1. One test generation to confirm the grid/slicing still works for a
   *different* character than Nella (this file's recipe was only ever
   proven once). Human Nella first — it's the most-flagged gap.
2. Once verified, the remaining 7 follow the same recipe.
3. Generalize `drawPlayer`'s `FACING_FRAMES` pattern into `drawNpc` so
   wandering NPCs actually animate instead of gliding.
