# Walk-cycle art tracking

Every character needs real per-direction walk animation — not a static
pose slid around the room. This sheet exists so each generation follows
the exact same recipe (same grid, same technique) instead of drifting.

## The recipe (proven — this is how Nella's Infinity avatar was made)

Use `generate-referenced-asset.yml`, reference = the character's existing
`*_top.png` (or portrait if no sprite exists yet) for design/color
likeness only. Prompt template — fill in the `{...}` parts:

> A top-down RPG character sprite sheet laid out as a precise grid with
> THIN SOLID MAGENTA (#FF00FF) DIVIDER LINES, 2 pixels wide, separating
> every row and every column — these magenta gridlines are REQUIRED and
> must be clearly visible so the grid can be mechanically sliced
> afterward. Grid: 3 rows × 3 columns, each cell exactly the same size,
> the character centered and the exact same scale in every single cell.
> Row 1 (top) = facing DOWN toward viewer, 3-frame walk cycle
> (left-foot-forward, neutral, right-foot-forward). Row 2 = facing LEFT
> in side profile, same 3-frame walk cycle. Row 3 (bottom) = facing UP,
> back view, same 3-frame walk cycle. The character in every cell:
> {character description}. Use the reference ONLY for character
> design/color likeness, not its pose. Background of each cell: plain
> solid white (#FFFFFF), NOT transparent — only the magenta gridlines
> separate cells, no other text or labels.

RIGHT-facing is never generated — it's LEFT mirrored in code (a side
profile flipped is identical), same as the player already does.

Slicing: detect the magenta gridlines programmatically (PIL + numpy,
scan rows/columns for the magenta hue), cut each cell, then per cell:
key the white background to transparent, crop tight to content on all
four edges (this step was missed once — see `git log --oneline -- 'art/*_top.png'`
around "untrimmed bottom padding" for why it matters: any leftover
padding lands the shadow below the character's real feet).

Output files per character: `<id>_down_0/1/2.png`, `<id>_left_0/1/2.png`,
`<id>_up_0/1/2.png` (9 files). Wire into `app.js` the same way
`FACING_FRAMES` already does for Nella — a per-NPC facing+frame lookup,
generalized off the existing player code, driven by the NPC's wander
direction instead of keyboard input.

## Status

| Character  | Reference used         | Walk sheet | Notes |
|------------|-------------------------|:----------:|-------|
| Nella (Infinity/demon avatar) | `nella.png` | ✅ done | `nella_down/left/up_0/1/2.png` |
| Nella (human, pre-transformation) | `nella_human_top.png` | ❌ not started | only a single static pose exists — the gap explicitly flagged |
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
