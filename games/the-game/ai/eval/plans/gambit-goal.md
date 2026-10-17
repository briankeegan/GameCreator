# Gambit: the goal

**Every Gambit mode survives all 24 training games, within its own list, and Gambit switches between modes mid-game without losing a
step.**

The 24 games: 8 combo_storm, 8 factory, 8 large_garbage -- the real client's Training mode (`training-mode.yml`), the server's
engine at level 10, the game's own think and input budgets.

## Order -- each finished before the next

1. **finish them** -- 24/24.
2. **pressure** -- 24/24.
3. **big chain** -- 24/24.
4. **build** -- 24/24.
5. **Switching** -- a run that changes mode mid-game as the rules' `when` does (the enemy topping out and the like): every mode still
   24/24 with switches happening, and nothing carried from one mode leaks into the next (the carried break search, the dig, a line in
   progress).

## Done, for each mode

- 24/24 in **two runs in a row** (one run is too noisy).
- Played within the mode's list; a few made outside it by what falls on its own (combo_storm above all) are accepted.
- 0 frames over the think budget, 0 keys dropped, **0 late moves**.
- The default bot still survives its 24 (it shares the engine and the searches).

## The rules set for it -- none changed without asking

- Play within the mode's list.
- **Health is ignored completely**: every board is planned at `planHealth`, never with the health a game gives -- health spent never
  comes back.
- Topped out, there is always some stop.
- Ready when everything lands, with a plan -- several steps if it takes them.
- Raise in the opening.
- Every answer arrives in time for its move; a decision may think across frames.
- Every number comes from the engine -- no invented constants.
- **Everything runs on GitHub Actions** -- the games, the reports, any experiment. Nothing is run in the sandbox: it edits code and
  pushes.

## How -- infra, not patches

- **Gambit is its own program, in C**, in `games/the-game/ai/gambit/` -- its layout: `gambit/README.md`.

- **One of each**: one judge (`judge.c`, `outcome.c`), one ranking (`rank.c`), one shared line check every play keeps its lines
  through (`lineFits`), one set of rules handed to every search (`rules.c`), one clock (`core/clock.h`: in the client, the game's own
  frame).
- **When something fails, find where two things measure the same fact differently, and make them one.**
- **The true test is that things survive**: the 24 games. A test is kept only where it holds something the games cannot.
- **Each change is measured once on the real game**, all 24, and reported: survived per mode and the frames lost at; the combos and
  chains made; the budgets (frames over, keys dropped, late moves); the loss report (`gambit_losses.js`), the reach report and the turn
  (`gambit_reach.js`) -- written by the run on Actions; and the time it finishes, in EDT.
- Commit and push every change. Never rerun code that has not changed.

## Where it stands

| mode | survived | runs |
|---|---|---|
| finish them | accepted at 23 of 24 (the owner: close enough; checked again as the infra changes) | 19, 19, 17, 17, 17, 17, 22, 21 (C), 22, 23, 21, 22, 23 (C in the client) |
| pressure | 17 of 24 | 0 (no chain begun), 17 (chains begun and continued) |
| big chain | not yet run | |
| build | not yet run | |
| switching | not yet built | |
