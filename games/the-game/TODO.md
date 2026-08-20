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

Owner's list from the plot audit (2026-08-20), in the order it was given.
The audit itself is in **Where the plot lives** below — read that first.

1. ~~The 59-minute timer~~ — **ignored on purpose.** John says it out loud
   and nothing counts down. The owner has looked at this and does not want a
   clock. Don't add one, and don't re-raise it.

2. **The Anarchy Garden and Kyran's Lab.** Two of the plot's Places with no
   room behind them. Garden: open-air, waterfalls, pools, marble
   crying-woman fountains whose water is their tears, cherry blossom, a
   stone path, blackberry bushes with fist-sized CryBerries, a rose-covered
   sign. Lab: interior, experimental plants in jars, tablets, a bench. Both
   need generated backgrounds, `build_walkmask.py` entries, floor polygons
   traced against the new art, and `story.js` rooms. The garden is OUTDOORS,
   so its prompt has to override `art-style.json`'s orthogonal-interior
   camera rule in so many words or it will come back as a room with walls.

3. **The black rune door.** The plot's navigation: a black marble door
   carved with runes. Push it and you land somewhere you didn't mean to
   (that is how Nella hits the Garden); touch the chaos rune and the
   carvings resolve into a list — Observatory, Basement, Garden (Closed),
   Office, Library — and touching one dissolves the door onto that room.
   Replaces the lounge's bottom doorway. Library, Garden and Lab go
   somewhere; Observatory, Basement and Office are listed and locked, which
   is what the plot shows and is honest about what exists.

4. **Rex, Diamond, Eric, Magma, Kyran.** Five plot characters with no NPC
   anywhere (Rex isn't even in `CHARACTERS`). Rex — scruffy red hair,
   deep-gold robe, copper bracelet with amethysts; smirks and says nothing
   while May has him by the collar. Diamond — black hair with rainbow
   highlights, "I'm the only person you really need to meet around here".
   Eric — blonde, broad shoulders, gray robe, warm laugh, "that honour goes
   to Anarchy". Magma — very young shapeshifter whose face shifts mid
   handshake, sensitive about her avatar, storms out. Kyran — head of
   research, lab coat and tablet, CryBerries, "stop by my lab later".
   Diamond/Eric/Magma sit at Kat's lounge table, Rex stands in the lounge,
   Kyran is in the Garden and his Lab.

5. **John's mirror scene** — the chapter's hinge, currently four compressed
   lines in the library. Plan below, under **John's mirror scene**.

6. **The duel is fought standing under the ribbons** — the big one. Design
   below, under **What a duel should look like**.

7. **Kat's arena duel is first to five.** A `set: { firstTo: 5 }` block on a
   duel config; running tally under the names; a short interstitial with the
   score and a Next button between games; the real result card only when
   someone reaches the target. Matches "First to five wins" and the 5-1 loss.

8. **Spectators in the arena stands.** "He pointed to the 'stands'... most of
   the people who were at the bar standing up there and cheering." Small
   silhouettes bobbing along the stands behind the orb, brighter after a big
   chain. Procedural — no generated art. Needs 6 first.

## What a duel should look like

The owner's question was whether the character belongs below the blocks and
whether losing should drop them on you. Yes to both, and the plot is precise
enough to build from:

> "I nervously looked up and saw the attacks that Kat had created as
> represented by large concrete slabs. The slabs looked to be several hundred
> pounds each, and were balanced as if by magic about 10 feet directly above
> me... the concrete slabs fell and literally smashed me flat, I felt the
> crunch of my own bones. I seemed to dissolve, and then reappear in front of
> Kat in one piece."

So each side of the screen is one column, top to bottom:

| | |
|---|---|
| the cracked orb | shared, centre, already drawn |
| the ribbon's neck | already drawn |
| **the board** | the panels, on the ribbon |
| **hovering slabs** | incoming garbage, waiting overhead — replaces the `▼ N` label |
| **the duellist** | standing on the arena floor, facing the other one |

`layout()` reserves a floor strip at the bottom the same way it already
reserves `orbRoom` at the top. Incoming garbage becomes slabs that hang over
the board with a shadow on it and then drop in. On a loss: the buzzer freezes
the loser, the queued slabs and the top of their stack rain down past the
board onto their sprite, it squashes flat, and then it dissolves and re-forms
in one piece before the result card — driven off the existing
`s.over`/`s.overDelay` path with a longer delay, not a new loop.

Watch the phone case. `cell` is already width-bound at ~29px on a 390px
screen, so the floor strip costs height that is there; on a SHORT wide window
it is not, so cap the strip the way `orbRoom` is capped and let the board win.

## John's mirror scene

Beats, in the plot's order. The first time you sleep in the Infinity bed you
wake to a knock and John is in the doorway — a cutscene, not room dialogue.

1. "Nella, I'm glad you have finally arrived."
2. "Nella, you can't leave."
3. He names himself: John Boxley, creator of Puzzle Attack, trapped here.
4. She draws the chaos symbol on the mirror in lipstick off the vanity.
5. "The deal that was struck was for your soul in exchange for magical
   powers." — then, quietly, "It didn't work the way that I thought it would."
6. "Am I dead?" / "Not yet."
7. He taps the mirror and it becomes a screen: her real body, cross-legged in
   front of the television, pale, eyes rolled back, a trickle of blood from
   her right ear.
8. One hour from the ritual or she dies. A day here is a minute there. 59
   minutes and 30 seconds left.
9. For everyone else there is no body left to go back to.
10. The hug. "I'm sorry, Nella."
11. "When you're ready, come see me at the library."

Two new cutscene backgrounds: the lipstick chaos symbol on the mirror, and
the mirror-as-screen showing her body. John's existing library lines become
the follow-up conversation rather than the reveal.

## Where the plot lives

`reference/the-game/PLOT.md` is a DISTILLATION. The verbatim plot — which is
much more specific, and is what settled every question in the list above — is
the owner's long comment on Clubhouse PR #30 (`clubhouse/the-game`). Read the
verbatim one before making a call about what the game should be; the
distilled file has lost detail (it says "the Lounge (bar + portals to duels)"
where the original says which WALL the bar is on and which wall the portals
are on, and that mattered).

Where the two disagree with the game, the plot wins unless the owner says
otherwise — that call has already been made once, over whether the duel
portal could move to the bedroom mirror. It could not: the plot reserves that
mirror as the menu/screen, and the portals stay in the lounge.

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
- **You wake up in bed, in both bedrooms**, and the first direction press
  slides you out from under the covers rather than teleporting you beside
  it. Lean into a bed for ~0.8s and she climbs back in — and THAT is the
  save now; the invisible save-point token at the foot of the Infinity bed
  is gone.
- **The lounge is mirrored** (`bg-lounge.png` flipped, and the walk mask's
  bar block with it) so the map reads the way it connects and the way the
  plot describes it: bar on the right, the arch you came in through on the
  left, portals on the left. The bottom doorway goes down to the library.
- **The arena is the plot's arena** — a library-like stadium with tiered
  stands and the gigantic cracked golden orb overhead, its two ribbons
  unrolling. The duel screen uses the same scheme: the boards hang off the
  orb as ribbons rather than floating in boxes on a gradient.
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
3. **Duels** — ☰ hides during a duel, Escape neither pauses nor ends one
   (there is no forfeit), quitting to title tears a live duel down.
4. **The opening** — the intro fades to black and back up on her asleep in
   bed, the knocking reads, moving gets her up (wait out `player.bedSlide`
   before driving her anywhere), downstairs, open the front door, Chuck
   takes over, and the flag survives a reload.
5. **The bed** — lean into `bedZone` and she climbs in, which writes the
   file; press away and she gets back out.
6. **Swapping** — all three gestures: drag sideways, tap the seam between
   two panels, tap one panel then its neighbour. Wait for
   `NewseyDuel.debug().countdown === 0` first or every swap is refused.

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
