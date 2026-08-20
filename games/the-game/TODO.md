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

- **Game shell** (`ffd5673`) — title screen, three save files, file select
  with PLAY/COPY/ERASE, pause menu, save point at the Infinity bed, autosave,
  playtime clock, resume-where-you-stood, migration of the old single save
  into File 1.
- **Replay intro removed** (`ffd5673`) — starting a new file plays it.
- **Erase is start-screen only** (`ddf36da`) — dropped from the pause menu.
- **No more "Next ▶" chips** (`44f7874`) — the whole dialogue panel is the
  tap target, so the chip was decoration that read like the only way through.
- **Portraits stopped bleeding across cutscene slides** (`44f7874`) — a
  portrait belongs to its own line now. Child Nella appears on the opening
  line only; the mid-scream face no longer sits through four calm lines.
- **A real opening** — the intro fades to black on its last slide and comes
  back up on Nella asleep in her own room upstairs (new room
  `home_bedroom`, new background art), knocking at the front door. Move to
  get out of bed, take the stairs down, and the closed door in the living
  room is now something you open — which is what brings Chuck inside. The
  dream cutscene fades the same way, since its last line says it does.
- **Every room got real walls and marked doors** — each room now has its own
  `floor` rect measured off its art (the shared default was wider than every
  room, so you could walk out through the walls), the front door and the
  lounge portal draw as glowing markers instead of a disc with a letter
  stamped on it, and every doorway carries the same pulsing marker plus the
  name of where it goes once you're standing on it.

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
