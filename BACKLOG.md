# GameCreator — working backlog

Durable to-do list so work isn't forgotten across sessions. Session task lists
are ephemeral; this file is the source of truth. Keep it updated as things land.

## Ongoing role
- **Monitor + assist the Clubhouse autopilot.** Watch autonomous runs. When one
  has issues: (1) do the work manually to unblock, AND (2) fix the root cause in
  the workflow so it can't recur. Log new issues here.

## Open work
1. **`games/the-game` ("Puzzle Attack") build.** ✅ Plot saved
   (`reference/the-game/PLOT.md`) + 16 inspiration images
   (`reference/the-game/inspo-*.png`). ✅ Trimmed cutscene + playable bedroom
   → lounge → library rooms with NPC dialogue. ✅ Mobile layout bugs fixed
   (dialogue panel covering screen, touch d-pad showing during cutscene,
   blank space below stage, missing install-banner CSS).
   ✅ NPCs now render as a round token + ground shadow (was: portrait image
   stretched into a rectangle mid-air — reported live as "floating heads").
   ✅ NPC y-coordinates moved into the same floor band the player walks in,
   since generated background art doesn't guarantee a floor line at any
   given y (reported live as "how do I walk on bottles" — NPCs were placed
   up near a bar shelf in the generated lounge art).
   ✅ Cutscene lines now distinguish narration (internal thought/memory —
   no speaker nameplate, italic caption) from actual spoken dialogue
   (nameplate + normal styling) — was: all lines shown as if Nella were
   saying her own internal narration out loud, reported live as "why is
   internal dialog showing up".
   **PAUSED on the user's explicit instruction ("stop wasting my money"):
   no further OpenAI art generation until asked again.**
2. **Imagemagick "Resize + trim for web" step timeout — unresolved.** 12
   `generate-game-asset.yml` runs (prologue backgrounds: bg-childhood,
   bg-mall, bg-news, bg-rain, bg-porch, bg-kitchen, bg-cartridge, bg-crt,
   bg-crt_red, bg-latin, bg-chaos, bg-bedroom) all paid for the OpenAI
   generation but failed at the resize step
   (`The action 'Resize + trim for web' has timed out after 3 minutes`,
   confirmed via job log on run 32303601540) — likely apt-get contention
   from dispatching all 12 near-simultaneously. Images were never
   committed. **Do not re-dispatch or generate more art until the user
   asks — this item is on hold along with all other art generation.**
   When resumed: fix the timeout (longer `timeout-minutes`, and/or
   don't fire 12 runs at once) before re-running.
3. **Fix multi-image upload in the Clubhouse (online).** Chat currently can't
   send multiple images at once — user had to upload them to the CLI session
   instead. Fix `shared/clubhouse.js` + the worker `upload-image` flow.
4. **Build the actual Panel Attack duel mechanic** (currently a "coming
   soon" placeholder in `games/the-game`). Reference source:
   **`briankeegan/panel-game`** (a Lua/LÖVE2D fork of Panel Attack, default
   branch `beta`) — match colored panels in rows/columns of 3+, gravity,
   chains attack the opponent. Explicitly deferred by the user until the
   characters/rooms were in place — that's now done, so this is next once
   picked back up.
5. **No sprite sheets exist yet** — only single static character portraits.
   Walking/talking animation would need real sprite sheets, not generated
   yet (also blocked by the art-generation pause above).

## Reliability fixes already shipped (autopilot)
- Sweep ALL unanswered messages per run (burst-safe).
- 30-min hang timeout + 45-min job cap (no more 6-hour stalls).
- Auto-retry on failure, 3× ~10 min apart, then give up + report.
- Auto-bump PWA cache version on any asset change.
- `shared/pwa.js` auto-reloads when a new service worker takes control.
- Direct-push-to-main ship step; pre-ship headless smoke test.
