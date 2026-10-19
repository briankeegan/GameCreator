# Gambit: the goal

**Gambit plays like a player: it survives every game at level 11, it plays the mode it is in, it never spoils a chain the board is
already making, and its cursor goes where the next swap is instead of across the board.**

The 24 games: 8 combo_storm, 8 factory, 8 large_garbage -- the real client's Training mode (`training-mode.yml`), the server's
engine at **level 11**, the game's own think and input budgets. Live: Gambit against the default on the fork's server
(`bot-prod-smoke-test.yml`, `mode: fight`) and on the main server.

## The list -- each finished before the next

1. **Level 11.** Training, `lua/check.lua`, the fight and the live run all play `LevelPresets.getModern(11)`; every place that
   assumes level 10 (its health, its frame constants, the docs) reads the level it is handed.
2. **Never spoil the board's own chain.** A line is judged on what the board ends up making, the cascade already under way included:
   a swap that cuts a 4-chain in progress to a 2-chain is a line that makes a 2-chain, ranked below leaving it alone -- never ranked
   as "makes nothing, like the hold". Measured: the decisions where the board alone made a bigger chain than the line played (0
   unless it was the only line that lives).
3. **The modes are played, and played accurately.** Each mode's attacks meet its own aim -- pressure 4-chains, build 5-chains, big
   chain 8+, finish them its combos -- built on purpose from its own stack, not the chains garbage colours happen to make. Measured
   every run: of the attacks fired in each mode, the share that met the mode's aim. Last measured: pressure 38%, build 26%, big chain
   10%. The target is the owner's to set.
4. **The cursor walks the shortest way.** A line's swaps are pressed in the order the cursor reaches them soonest, kept only where the
   engine says the board comes out no worse (`rank.c` `judgeWalked`). Measured: the mean cells between one swap and the next, and the
   share of jumps of 6 or more. Last measured (main server): 3.4 cells, 17%.
5. **Aggressive.** It attacks far more than it does now: every board that can send garbage without giving up its life sends it, and
   a mode's attack is fired as soon as it is made, not held. Measured every run and every fight: attacks a minute and the garbage
   cells they send a minute (gambit_summary.js `aggression`), against the default bot's on the same server. Live play too: the opening
   raise held through its rows; never holding while the hold dies and a line that lives is offered.
6. **Every mode 24/24 at level 11, twice in a row**, then switching (5-30 s, every direction) 24/24 with the switches happening.

## Open questions for the owner

- A material reserve before garbage lands, and how many panels.
- Whether the chain modes build their chains on their own stack only, or may fire the chains garbage colours make without breaking.
- Whether the opening raise goes higher than 10 rows, or recurs later in the game.

## Done, for each mode

- 24/24 in **two runs in a row** at level 11 (one run is too noisy).
- Played within the mode's list, its aim met at the share item 3 sets.
- 0 frames over the think budget, 0 keys dropped, **0 late moves**, 0 divergences ("The truth held").
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
- **Nothing is assumed about garbage not yet shown.** Training's patterns are exercises standing in for a real opponent, who throws anything at any time: Gambit plans on the garbage the game shows on its way and nothing else -- never the pattern's size, rhythm or next block.
- **Gambit sees only what the screen shows.** A colour a break converts garbage into is unseen until the client draws it
  (`gambit/lua/board.lua` `shown`, held by `board.test.lua` in every run).
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

What is done next, and in what order: `plans/gambit-next.md` -- the one plan.

Those runs were not at level 10: nothing set the level, so the client's default, 5 (51 health), was played. `7ab7a861` sets it.

| mode | level 11 | runs |
|---|---|---|
| finish them | 14/24 (combo_storm 2, factory 7, large_garbage 5); aim 83% | `7ab7a861` |
| pressure | 18/24 (combo_storm 4, factory 8, large_garbage 6); aim 17% | `7ab7a861` |
| big chain | 12/24 (3, 5, 4); aim 3% | `50dba0ce` |
| build | 15/24 (2, 6, 7); aim 11% | `50dba0ce` |
| switching | | |

At `01290f76` (no assumed garbage; the board's own chain this decision's): finish them 19 (combo_storm 7, factory 5, large_garbage 7),
aim 83%; pressure 18 (6, 7, 5), aim 16%; big chain 13 (1, 6, 6), aim 3%; build 14 (1, 6, 7), aim 10%; switching 16 (4, 4, 8), 376
switches over all 12 directions. Walk 3.5-3.6 cells, 19-20% of jumps 6 or more.

Flags, one run each against it: keep -- big chain 16, build 16; attack -- finish 15, pressure 17 (Training has no enemy to hurt: the
attack only spends material; it is a fight's to judge).

Every run with 0 divergences and 0 late moves. Half the searches' time to the break search under garbage (share50): finish 13, pressure 16 -- no better. At the turn of every loss the move was mostly the hold (finish 437 of 443, pressure 112
of 118).
