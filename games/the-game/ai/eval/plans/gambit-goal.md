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
3. **The modes are played, and played accurately.** A mode is only its list -- its priorities, in order; everything else is one rule
   for every mode: after the list's entries, a three that breaks garbage; last of all (they cost blocks), a clear that makes a chain or
   a combo the list does not ask for; nothing else clears (`judge.c` the one rule). Every mode defends itself while it attacks. Each mode's attacks meet its own aim -- pressure 4-chains, build 5-chains, big
   chain 8+, finish them its combos -- built on purpose from its own stack, not the chains garbage colours happen to make. Measured
   every run: of the attacks fired in each mode, the share that met the mode's aim. Last measured: pressure 38%, build 26%, big chain
   10%. The target is the owner's to set.
4. **The cursor walks the shortest way.** A line's swaps are pressed in the order the cursor reaches them soonest, kept only where the
   engine says the board comes out no worse (`rank.c` `judgeWalked`). Measured: the mean cells between one swap and the next, and the
   share of jumps of 6 or more. Last measured (main server): 3.4 cells, 17%.
   **Every move on the way.** The nearer move is the better one: of the lines that do what the board needs, the one with the fewest
   cursor moves comes first, and a far one has to earn its walk. With a goal across the board (a break at the top right, the cursor at
   the bottom left), the cursor does things on its way there -- a chain or a combo nearby, setting up as it climbs, another in the
   middle -- then the break. Never a swing from one corner to the other with nothing done between. Measured: cells walked a minute,
   and the share of swaps that clear, set up, or break.
5. **Aggressive** -- after survival (6), once the games are survived. It throws far more blocks than it does now: every board that can send garbage without giving up its life sends
   it, and a mode's attack is fired as soon as it is made, not held. Aggression is the blocks thrown a minute (gambit_summary.js
   `aggression`), measured every run. Live play too: the opening raise held through its rows; never holding while the hold dies and
   a line that lives is offered.
   **Several ideas at once** is how the attack rate goes up: several chains built at once (several 8-chains, or different chains),
   or several combos made ready at once, each continued on its own, then fired together.
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

What is done next, and in what order: `plans/gambit-next.md` -- the one plan; the infra under it (threads, intentions, the schedule, the shape math, the warm start): `plans/gambit-infra.md`.

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

Flags against it: keep -- big chain 16 and 15, build 16 and 15, finish 18, pressure 15: on for the chain modes (their profiles), off
for the attack modes. Attack first (of two breaks, the one that sends garbage) -- finish 15, pressure 17, and no more attacks a minute
(finish 13.2 against 13.5, pressure 10.9 against 10.7): gone. Aggression at the baseline: finish 13.5 attacks and 83 garbage cells a
minute, pressure 10.7 and 98.

A second run at `3250be09` (keep on in the chain modes): finish 17 (6, 5, 6), pressure 18 (6, 5, 7), big chain 12 (1, 6, 5), build 14
(2, 5, 7). The spread of one condition is about 2 games a run; keep is +1 over three runs in each chain mode, within it. combo_storm in
the chain modes (1-2 of 8) is where the games are lost. Aggression holds at 10-13 attacks and 83-102 garbage cells a minute.

The material floor at 30 in the chain modes (an experiment, gambit-rules-floor30.json; the rules keep 24): build 17, big chain 18 --
combo_storm 4 and 5 of 8 against 1-2. On combo_storm the chain modes held 26 panels under garbage against finish's 32: their own
5-chains spend what the board lives on.
Repeated: big chain 18 and 16 (13, 12 at the floor of 24), build 17 and 15 (14, 14); finish 16 (19, 17) and pressure 18 (18, 18) at
30 -- the chain modes gain, the attack modes do not. The rules' floor is 30 for every mode.
At `35e93c15` (the rules' floor 30, every mode): finish 18 (5, 6, 7), pressure 15 (2, 8, 5), big chain 15 (1, 8, 6), build 18 (4, 8,
6). Blocks thrown a minute: finish 15.0, pressure 16.8, big chain 17.3, build 17.8. Big chain's combo_storm 1 of 8 against 4-5 a
run before: the floor is within the noise; combo_storm is still where the games go.
On combo_storm under garbage (the games' own logs, 342 and 344), finish was offered 4379 entry lines, 2444 break lines and 982
clears; big chain 207, 1042 and 8. The searches aim at the list, and big chain's (8-chains, and the defence's combos of 4) holds
almost no break the board can make.
At `0a332d80` (the one rule: the list's entries, then a three that breaks, then the last resort; no defence entries): finish 16 (4, 7,
5), aim 81%; pressure 20 (6, 8, 6), aim 17%; big chain 16 (4, 7, 5), aim 1%; build 14 (4, 4, 6), aim 6%. Blocks thrown a minute 15.9,
17.2, 17.8, 18.3. combo_storm in the chain modes 4 of 8 against 1-4 before; build's factory 4 of 8 against 8.
The chain modes' early deaths (game 6 of combo_storm, frames 680-840, in four runs) were the keep flag: before the first volley lands
nothing lives, and keep put the line that spends fewest panels before the later loss -- big chain held where finish broke the volley
as it landed. A mode is only its list: the flags are gone.
At `27c2b421` (no flags): finish 17 (5, 7, 5), pressure 18 (4, 7, 7), big chain 20 (6, 8, 6), build 15 (4, 5, 6) -- 70 of 96 against
66. Big chain's early deaths are gone. Of the lines played that met the rule: finish 85% entries, 0% threes, 15% last resort;
pressure 22/55/23; big chain 2/71/27; build 13/63/24. Blocks thrown a minute 15.8, 16.6, 17.1, 16.4. Build's factory (4-5 of 8 in
two runs, 8 before) is where it loses.
Under garbage, 15-25% of decisions played a line that loses 60 frames or more before another offered (a carry or the three's break,
where a line breaking the same garbage and ending in a combo -- a last resort -- outlasted it by 100-180 frames): both outlived the
next decision, so they ranked alike and the list chose. Alike within a break's time of each other (`fa3305e0`): finish 14, pressure
13, big chain 14, build 17 -- 58 against 70, the last resorts up from 15-27% to 20-41% of the lines played. The frames a last resort
buys now the board pays for later: reverted.
At `e19b1870` (the breaks already found, kept across decisions -- plans/gambit-infra.md F): finish 19 (5, 7, 7), pressure 20 (6, 8,
6), big chain 22 (6, 8, 8), build 19 (6, 7, 6) -- 80 of 96 against 70, the best yet. 9% of the readiness checks answered by a break
already found; think 300 ms a decision; 0 divergences, 0 late moves.
At `c9638fca` (intentions kept across decisions, and routes -- gambit-infra.md A, B): finish 17 (5, 6, 6), pressure 16 (5, 6, 5), big
chain 20, build 15 (5, 7, 3) -- 68 of 96 against 80. Kept lines played about 800 times in 20,000 decisions, routes 13. The readiness
checks rose from 10-11 a decision to 12-13 with every break search's share cut with them, and the decisions left no time to judge
anything doubled (6-17 to 14-31).

Every run with 0 divergences and 0 late moves. Half the searches' time to the break search under garbage (share50): finish 13, pressure 16 -- no better. At the turn of every loss the move was mostly the hold (finish 437 of 443, pressure 112
of 118).
