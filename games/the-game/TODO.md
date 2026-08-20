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
Items that are done have moved to **Done**; what is left is here.

1. ~~The 59-minute timer~~ — **ignored on purpose.** John says it out loud
   and nothing counts down. The owner has looked at this and does not want a
   clock. Don't add one, and don't re-raise it.

2. ~~Rex, Diamond, Eric, Magma, Kyran~~ — **done.** All five are in the
   game with their own portraits and walk sets; nothing renders a fallback
   token any more. See **Done**.

3. **John's mirror scene** — the chapter's hinge, currently four compressed
   lines in the library. Beat-by-beat plan below, under **John's mirror
   scene**.

4. **The duel is fought standing under the ribbons** — the big one. Design
   below, under **What a duel should look like**.

5. **Spectators in the arena stands.** "He pointed to the 'stands'... most of
   the people who were at the bar standing up there and cheering." Small
   silhouettes bobbing along the stands behind the orb, brighter after a big
   chain. Procedural — no generated art. Needs 4 first.

## Loose ends worth knowing about

- **The garden's pool and waterfalls are static.** They are props now rather
  than paint, which is what makes animating them possible; nothing animates
  them yet. Scrolling the water is the obvious first move.
- **Kyran's walk set warns "NO NEUTRAL" on all three rows**, and so does
  Michael's. Looked at: the sheet is correct — down really is
  [step, NEUTRAL, step] — but his third frame is a very weak step, so the
  metric is telling the truth rather than misfiring. He barely walks; not
  worth another generation. Left as a warning, which is what warnings are
  for.

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

- **Kat's table, and Kyran** — Rex, Diamond, Eric, Magma and Kyran all have
  portraits and full walk sets, generated one dispatch each off the VERBATIM
  plot's descriptions rather than the distilled one. Rex's portrait is the
  bust that came back as `art-src/lounge_folk.png`, cut by the new
  `.github/art/make_portrait.py`. Magma's portrait carries the seam her
  dialogue describes, and her second line now narrates the shift itself,
  which in the plot happens DURING the handshake.
  - The lounge layout is a rule now, not a guess: everyone stands on a lit
    pixel of `walk-lounge.png`, no two are within 16px (NPC_COLLIDE_RADIUS
    is 8), and NOBODY stands in the corridor to the rune door. That last one
    is a bug that shipped: Kat's table was first placed either side of the
    approach and fenced the exit off completely.
  - Gate: `.github/scripts/check_art_refs.mjs` ("Verify art references" in
    `pages.yml`). The runtime deliberately falls back to a coloured initial
    for missing art, so nothing ever failed when a file was absent — that is
    exactly how a "K" stood in Kyran's lab for as long as it did. Forgiving
    runtime, strict build.

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

## Rooms are three passes now

Full write-up, shareable on its own: **`docs/ROOM_ART_STANDARD.md`**.
One front door for all of it: **`.github/art/room.py`**.

1. **A composed scene** (`art-src/<room>_scene.png`) — never shipped. It
   exists to be MEASURED: every prop's ground point, height, width and count
   comes off it.
2. **The walkable surface and nothing else** — the shipped background. Its
   silhouette IS the collision mask, so the room goes in `FLOOR_PLATE_ROOMS`
   and there is nothing else to declare.
3. **Everything you cannot walk on, as props** — plus flat ground cover you
   can walk over. Placed at the numbers from pass 1.

```
room.py prompt scene|plate|props   canned prompts, filled in
room.py plate  games/<id> <room>   fit the plate + rebuild its mask
room.py props  games/<id> <room> name1 name2 ...
room.py check  games/<id> <room>   render the overlays — LOOK at them
room.py verify games/<id>          the gate, also runs in CI
```

The Anarchy Garden is the reference room. Its walk mask is one line.

**Do not go back to painting scenery into a room.** It cost the mask (five
failed techniques, recorded in `build_walkmask.py`), it made scenery flat, and
moving one object meant regenerating the whole picture.

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
7. **The room a check is aimed at.** Derive probe coordinates from the data
   (`ROOMS.<id>.props`, `exits`), never hard-code them — two walk-test checks
   silently started pointing at empty grass after props moved, and a test
   aimed at nothing passes. For the same reason, ask the game rather than
   re-deriving its rules: `__newseyDebug.blockedAt(x, y)` runs the real
   `blockedByProp`, including the depth scale a hand-written copy forgot.
8. **Nothing standing in a doorway.** Every room's NPCs must sit on the walk
   mask, be at least 16px apart, and leave the corridor to each exit clear —
   then WALK it to prove it. Kat's table fenced the rune door off completely
   and the symptom appeared three checks later as "the door lists no words".
9. **Input needs the talk box gone.** `enterRoom()` leaves arrival narration
   up, and movement is blocked while it is. Press `z` a dozen times first,
   or a key-rebinding check reads as broken input either way.

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
