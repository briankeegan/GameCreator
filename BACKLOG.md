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
   ✅ NPCs render as real full-body standing sprites (`npc.sprite`, feet
   anchored to a ground shadow) — was: a portrait image stretched into a
   rectangle mid-air ("floating heads"), then a round bust token, now an
   actual body. Falls back to the round bust token, then a plain colored
   circle, if no sprite exists for a character.
   ✅ Nella (the player) also has her own standing sprite (`nella_walk.png`,
   mirrored for left-facing) — was rendering as a plain colored blob.
   ✅ All 12 prologue cutscene backgrounds generated and landed (childhood,
   mall, news, rain, porch, kitchen, cartridge, crt, crt_red, latin, chaos)
   plus bg-bedroom — every cutscene beat and room now has real art matching
   its actual described scene (not generic/random imagery).
   ✅ NPC y-coordinates moved into the same floor band the player walks in.
   ✅ Cutscene lines distinguish narration (internal thought/memory — no
   speaker nameplate, italic caption) from actual spoken dialogue.
   Verified end-to-end via headless mobile Playwright: zero console errors,
   correct room transitions, NPC portraits load in the talk box.
   Remaining for this game: Kyran, Diamond, Eric, Magma, Rex, Anarchy have
   no art or in-room presence yet (not needed until they're written into a
   room). Devil currently only has a text-prompt (no inspo reference) sprite.
2. **Art-gen resize step was hanging, not just slow — fixed.** `apt-get
   install imagemagick` in `generate-game-asset.yml` /
   `generate-referenced-asset.yml` was confirmed to hang SILENTLY for a full
   10-minute step timeout (zero log output) against a bad/busy mirror —
   this is what silently dropped 12 paid-for prologue-background
   generations earlier. Root-cause fixed by dropping apt-get/imagemagick
   entirely in favor of Python + Pillow (installs from PyPI, verified
   working locally and in production runs). No longer an open item.
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
5. **No animated walk-cycle sprite sheets** — each character (including
   Nella) has one static standing pose, not a multi-frame walk animation.
   gpt-image-1 (single-shot text-to-image) isn't reliable at producing
   clean, aligned multi-frame sprite sheets, so this would need a different
   approach (e.g. hand-built frame interpolation, or a purpose-built sprite
   tool) if pursued.

## Reliability fixes already shipped (autopilot)
- Sweep ALL unanswered messages per run (burst-safe).
- 30-min hang timeout + 45-min job cap (no more 6-hour stalls).
- Auto-retry on failure, 3× ~10 min apart, then give up + report.
- Auto-bump PWA cache version on any asset change.
- `shared/pwa.js` auto-reloads when a new service worker takes control.
- Direct-push-to-main ship step; pre-ship headless smoke test.
