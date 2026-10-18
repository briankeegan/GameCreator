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
  (`gambit_reach.js`) -- written by the run on Actions; and the time it finishes, in ET on the 24-hour clock.
- Commit and push every change. Never rerun code that has not changed.

## Where it stands

| mode | survived | runs |
|---|---|---|
| finish them | **24/24 twice** (`5bacb738d0`, `51b51405f5`) | ... 24, 18, 24, 18, 17, 18, 18, 21, 21, 16 |
| pressure | best 22 of 24 (`52a35feccd`, `5bacb738d0`) | ... 22, 18, 18, 19, 13, 14, 15, 17, 15, 15, 15 |
| big chain | best 18 of 24 (`f13a5c5966`) | 13, 17, 16, 17, 15, 17, 16, 18, 12 |
| build | best 19 of 24 (`5bacb738d0`, `db1f1dce3c`) | 19, 17, 19, 16, 14, 15 |
| switching | not yet built | |

## What the losses share

- **One run is noise.** The same decisions scored finish 24 and 18 (`51b51405f5`, `77fff4d883`): the bot thinks to the wall clock, so
  no two runs play the same games. A gap of a few games between two builds is not a result.
- **combo_storm in the chain modes (pressure, big chain, build) is the hole: 1-3 of 8.** The board's material -- the panels under and
  beside the garbage a break is made from -- drains between blocks: nothing lives (a queue that long is never all ready for), so the
  later loss ranks first, and the lines that lose later are survival clears that spend 3-6 panels each (49 to 5 in a thousand frames).
  The block lands on nothing to break it with (`breakNear`: 53 of 55 boards before those losses had no break to build).
- **Chain building leaves a tower** (heights like 5,7,12,11,8,6 with 49 panels): the board is topped by its own stack with room for a
  level one. `levelLine` walks it level, judged whole.
- Tried and taken out, each below the runs above: the judge asking past the stop a line ends on; the chain stopper; the floor for the
  block on its way; crediting a ready line with where its break leads; a line ready for the next block before a later loss.

