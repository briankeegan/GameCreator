# Newsey — running to-do list

Working list for this game, kept across sessions. Owner adds items in chat;
this file is the memory. Newest requests go at the bottom of **Open**.

Rules of the road for whoever picks this up:
- Ship to `main` — Pages deploys from nowhere else.
- Re-run the headless checks before pushing (see **Testing** below).
- Bump the `sw.js` cache name on any runtime change, or installed PWAs keep
  the old files.

---

## Open

_(nothing queued — owner adds here)_

## Noticed, not asked for

Things spotted while working. Don't act on these without a nod from the owner.

- **The game answers to three different names.** `games.json` calls it
  "Newsey-the-game", the page `<title>` and the nav bar say "Puzzle Attack",
  and the folder is `games/the-game/`. The title screen says PUZZLE ATTACK
  with "Newsey — the game" under it, which papers over it but doesn't settle
  it. Worth picking one.
- **Dead space under the stage on a phone.** The stage is locked to 640:400,
  so on a tall screen the game is a short strip with a lot of empty purple
  below it. The menus dodge this by covering the whole game area; the game
  itself doesn't.
- **Your Old Room has no reason to exist after the opening.** Once Chuck is
  in, the only thing upstairs is the bed you woke up in. It isn't a save
  point (you're pre-Infinity there and the save point is the Infinity bed) —
  it could be.

## Done

- **Game shell** — title screen, three save files, file select with
  PLAY/COPY/ERASE, pause menu, save point at the Infinity bed, autosave,
  playtime clock, resume-where-you-stood, migration of the old single save
  into File 1.
- **Replay intro removed**; **erase is start-screen only**.
- **No more "Next ▶" chips**, and **portraits stopped bleeding across
  cutscene slides** — a portrait belongs to its own line now.
- **A real opening** — the intro fades to black on its last slide and comes
  back up on Nella asleep in her own room upstairs (new room
  `home_bedroom`, new background art), knocking at the front door. Move to
  get out of bed, take the stairs down, and the closed door in the living
  room is what brings Chuck inside. The dream cutscene fades the same way.
- **Walking is bounded by the floor the artist drew.** Per-room
  `art/walk-<room>.png` masks, baked by `.github/art/build_walkmask.py`
  (white = walkable), sampled under her feet. Corrected the arena's bench
  line, which a straight wall line cut across, and the house's candle
  table, which you could walk through.

## Collision — how to change it

`.github/art/build_walkmask.py` owns it. Each room declares its wall line
and what stands on its floor; the room's OUTLINE comes free from the art's
own silhouette, which is what makes the diagonal corners right. Re-run
`python3 .github/art/build_walkmask.py games/the-game [room ...]` after
changing a background, and LOOK at the result before believing it.

Five things were tried and failed before this, worth not repeating: a
rectangle (no room here is one), a hand-traced polygon per room (magic
numbers that go stale the moment a background is regenerated), a flood
fill of the black around a room (leaks up any wall where floor and wall
meet in a gradient, and can't tell a wall face from the floor beside it),
climbing each column to the first hard edge (stops on a grout line, and on
the rune painted on the arena floor), and asking the image generator to
draw the mask alongside the room in one sheet (see CLAUDE.md — it won't).

## Testing

Headless suites live outside the repo (scratchpad), so they don't survive a
new session — rewrite them as needed. What they cover, worth re-covering:

1. **Shell flow** — boots to title; new game in a slot plays the intro; Escape
   pauses and freezes movement; save writes the slot; quit → reload →
   CONTINUE lands on the exact saved position; copy; erase-with-confirm;
   migration of a legacy `gc:the-game:save`.
2. **Save point** — the bed is in interact range from the floor below it,
   its dialogue saves the file, and line progress persists.
3. **Duels** — ☰ hides during a duel, Escape won't pause one, forfeit
   restores the button, quitting to title tears a live duel down.

Plus the repo's own gate: `node .github/autopilot/smoke-test.js
games/the-game/index.html` (needs `playwright` installed at the repo root —
install it somewhere else and copy `node_modules` in, then delete it, so it
never gets committed).

## Where things live

| File | What it owns |
|---|---|
| `app.js` | The world: rooms, movement, dialogue, cutscenes. Does not boot itself — `menu.js` starts it via `window.NewseyGame`. |
| `menu.js` | Title, file select, pause, confirmations, toasts. |
| `saves.js` | The three save files (`gc:the-game:slot1..3` + `lastSlot`), including the `flags` object story switches live in. |
| `settings.js` | Controls: on-screen pad toggle, key rebinding, gamepad. |
| `story.js` | Characters, cutscene scripts, rooms, NPCs, duel configs. |
| `duel.js` + `panel-engine.js` + `panel-cpu.js` | The Panel Attack match. |
| `art-style.json` | Locked camera/palette/style for generated art. |
