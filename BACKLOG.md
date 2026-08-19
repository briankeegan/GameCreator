# GameCreator — working backlog

Durable to-do list so work isn't forgotten across sessions. Session task lists
are ephemeral; this file is the source of truth. Keep it updated as things land.

## Ongoing role
- **Monitor + assist the Clubhouse autopilot.** Watch autonomous runs. When one
  has issues: (1) do the work manually to unblock, AND (2) fix the root cause in
  the workflow so it can't recur. Log new issues here.

## Open work
1. **Persist inspiration + plot for the new game.** ✅ 16 inspiration images
   saved (downscaled 512px) at `reference/new-game-inspiration/`. STILL TODO:
   save the written plot, and move/associate both with the correct game once
   identified.
2. **Reference-guided art generation (1:1 with plot).** Generated sprites/scenes
   should match the game's characters/plot, using the saved inspiration images
   as visual reference (small creative leeway OK). Likely needs gpt-image-1
   image-input/edits so references actually condition output, plus feeding the
   plot into art-style.json / prompts.
3. **Fix multi-image upload in the Clubhouse (online).** Chat currently can't
   send multiple images at once — user had to upload them to the CLI session
   instead. Fix `shared/clubhouse.js` + the worker `upload-image` flow.
4. **Build the new game — a Panel Attack clone** (Tetris Attack / Puzzle League
   style). The user has a copy in one of their repos — find it, study/play it,
   then build using the saved plot + inspiration art.

## Open questions (need user input)
- Which game do the inspiration images belong to — the new Panel Attack game, or
  `Newsey-the-game` (created recently)? Is the plot in a Clubhouse thread already?
- Which of the user's repos holds the Panel Attack copy to reference?

## Reliability fixes already shipped (autopilot)
- Sweep ALL unanswered messages per run (burst-safe).
- 30-min hang timeout + 45-min job cap (no more 6-hour stalls).
- Auto-retry on failure, 3× ~10 min apart, then give up + report.
- Auto-bump PWA cache version on any asset change.
- `shared/pwa.js` auto-reloads when a new service worker takes control.
- Direct-push-to-main ship step; pre-ship headless smoke test.
