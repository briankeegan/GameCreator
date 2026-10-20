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
chain 20, build 15 (5, 7, 3) -- 68 of 96 against 80.
At `fd23d88f` (no line judged twice, the readiness time split over the checks still to ask, work on the way): finish 17 (4, 7, 6).
From here one mode at a time, finish first, on the latest build only; every mode again once finish holds, for regressions.
At `880cca5b` (the readiness searched on every thread, two workers): finish 14 (5, 5, 4) -- the readiness checks fell from 12 a
decision to 8, and two games died before frame 1400. The workers are off by default again. Next: the intentions and routes taken out.
At `f9a30f5c` (the intentions and routes taken out): finish 19 (7, 7, 5), the best's again. Of the boards after each loss's turn,
searched again with more time, 58 of 60 had no break to find (run 374): the board is lost at the turn, by the line played there.
Of two lines that do not live, the one leaving the nearer next break before the list's entry (`1659fda8`): finish 14 (2, 8, 4) --
the last resorts from 16% to 38% of the lines played, the material under garbage 25 to 22. Reverted: the list orders what the board
can afford, and a nearer break bought with a last resort is paid for in panels, as the narrower alike was.
The material floor (outcome.c) judged a line that leaves no break to build lost the frame it is done -- measured against the board
as it was asked, once a game: never asked again after the game's first decision under garbage, and blind to a board that loses its
break by itself (a slab's pop ending). In 384's large_garbage-2 it held through 14 decisions of a 424-frame stop, every walk toward
the break judged lost 41 frames before the hold. It is now measured against the board left alone, asked every decision.
At `e4aa58dc`: finish 22 (6, 8, 8) -- the best yet; one of its two losses 24 frames from the end. The other's turn played an entry
lost at 128 over a break lost at 371: the narrower alike measured again, now that the floor no longer marks lines lost early.
Narrower alike at `778441d5`: finish 18 (5, 8, 5), last resorts 25% -- reverted for good. At `f2edda00` the incremental infra whole
(plans/gambit-infra.md "E and F, built whole"), measured as one: with two workers 9 -- on a runner's two cores (its log: two threads a
core) a worker takes Gambit's own -- so the workers are off. At `145d58a5` (no workers, the readiness asked by its yield, every
landed board searched once a decision): finish 20 (6, 6, 8); 54,000 of 250,000 checks were a board searched already that decision.
Its early loss (factory, frame 723): 190 frames with no break in reach, every decision a line within the list lost 58 frames before a
last resort, the two "alike". Alike only while a break is in reach (`727c7248`): finish 14 (4, 7, 3), last resorts 27%, material
22.9 -- the third measure of the same thing (with the narrower alike twice): a later loss bought with a last resort is paid for in
panels. Reverted; the alike rule stands as it is.
A LIFE KEPT: of the lines played under garbage that lived, with nothing new told after (the next block landing on the same frame, as
many queued), the next decision had a line that lived 79% of the time (run 389) -- the engine predicts every frame, so it should be
all. One cause: readiness looked from a frame on past a line's end, the hold the next decision asked from where the board settled --
one trajectory, two boards a frame apart, so the break found on one was never found again by its key. Now a line past the landing is
ready from where it ends. The summary counts it ("a life kept"). The most of the rest (7 of 17): the line in progress itself -- it was
never asked readiness, so a line that lived by a break in reach lost it the moment it was carried on. It is asked now, as any line.
Measured: `284b3a33` finish 19 (5, 8, 6), a life kept 82% of 422; `2a8a1f38` finish 19 (4, 8, 7), a life kept 88% of 672 -- lines
that live half again as many. Two combo_storm games lost in the first wave (frames 387, 551): the opening raise toward the rules' ten
rows, then the rest of the wave shown after it -- new information, not a prediction gone wrong.
Ablation (`bd0cf187`, the kept plan's seeds, intentions and routes off): finish 17 (5, 8, 4) against 19 with them -- they stay. Builds
this close have run 17 to 22: one run of 24 games has a deviation near two, so a change of a game or two is under one run's noise. Kept lines played about 800 times in 20,000 decisions, routes 13. The readiness
checks rose from 10-11 a decision to 12-13 with every break search's share cut with them, and the decisions left no time to judge
anything doubled (6-17 to 14-31).

TWO DEATHS ARE TWO FRAMES: in large_garbage (run 393, games 6 and 7) the hold was played over a toward line known to die 61 and
53 frames later -- every line on the board a known death, and a dead line never beat the hold (rank.c beatsHold), so the later one
was marked idle and ranked under it. A known death beats holding now when the hold's is a death too, and later.
Measured (`22947c95`): finish 20 (6, 8, 6).
EVERY SWAP ON ITS JUDGED FRAME: combo_storm-3 of that run held four decisions for the line in progress waiting on the board
(carry_wait, lost at 478), then dropped it as dead -- its next swap was due between two decisions, and a decision takes about as long
as the gap. The judge presses a settled line's next swap as soon as its pair can be walked to, so the hold played was never the line
judged. Now the line played is handed to the frame loop whole, each swap with the frame the judge pressed it from (answer.c handAt,
front.c lineDue): a settled line's swaps after the board settles, a line whose first swap waits a hold with the whole line handed.
A JavaScript host (gambit.js) presses a hand as soon as it can, so it is handed only what the judge pressed so.
Measured (`5c374828`): finish 16 (4, 8, 4). In large_garbage-2 the line in progress lived (13047, its first swap two frames off), was
handed on behind a hold and never pressed: the frame loop followed a hand only while the question out was unpaced, and the question
after a hold is paced. A swap with its judged frame is now pressed on it, paced or not, and a line the frame loop cannot press on is
logged with why ("LINE dropped").
Measured (`595d88f3`): finish 21 (5, 8, 8) -- large_garbage 8 of 8; the three losses combo_storm, a life kept 90% of 644.
THE LINE IN PROGRESS AT ITS FIRST FRAMES (`9dc31485`, backed out): of the lives not kept, the line in progress judged again at the
next decision pressed its swaps as soon as it could, not when the decision that began it did, and could stop breaking
(carryDrop=3). Judging each carried swap no sooner than its first frame: finish 7 (2, 2, 3), a life kept 82% -- the carried line
judged to live to 559 while the game was lost at 1525 (factory-8), so the line judged and the line pressed parted.
NOISE, MEASURED: `da1c30e7` decides exactly as `595d88f3` (it only logs more) and scored 17 (4, 8, 5) against 21. One run of 24
spans at least 17 to 21 on the same code, so a single run tells nothing under about five games; a change is judged on two or more.
A LIFE NOT KEPT, LOOKED AT (GAMBITK, both boards logged): the four pairs of large_garbage-5 (run 398) are the horizon, not a fault --
a line lives when its board stands HORIZON + REST (360) frames past now, and a decision later the same lines are judged lost at 411
to 684: past where the last one looked. The engine did not disagree with itself.
THE HORIZON, LONGER (`dbdb4b3c`, backed out): HORIZON 240 -> 360, so a line that only outlasts 360 frames no longer reads as one
that lives: finish 20 and 18 against the same code's 21 and 17 at 240 -- no better, and the clock cut up to 152 decisions a run.
SAVING WEIGHS EVERY LINE (`66e29793`, backed out): while saving panels up under garbage, key 7 weighed every line's panels, the
hold among them, not only two breaks': finish 20 of 23 and 18 -- the same as without it, so the list keeps its place.
UNDER GARBAGE, THE MORE BROKEN: in combo_storm a line lives on 3-21% of the decisions under garbage -- nearly every choice is between
lines that are all lost, ordered by the list, which in finish them ranks attacks, not the garbage broken. Of two breaks under garbage
that neither lives, the one that breaks more now comes before the list (rank.c 7b). Measured (`9d55ecb4`): finish 21 (7, 7, 7) and
19 (5, 6, 8) -- combo_storm 12 of 16 against 9, aim met 80% as before. Kept.
ONE TRY OR TWO: large_garbage-4 (run 403, 3604) played a break lost at 109 over one lost at 348 -- alike, both past rankSave (97),
the list deciding. Two that do not live are no longer alike when the shorter leaves the board only one break's time (under twice
rankSave) and the other a break's time more. Narrower than `778441d5` (any gap of a break's time), which raised the last resorts to
25%. Measured (`4ee0bf1b`, and `31347edc` that decides alike): finish 21 (8, 7, 6), 22 (6, 8, 8), 21 (6, 8, 7) -- against about
19 before; the list's entries fell from 84% of the lines played to 79%. Kept.
WHERE THE MACHINE GOES (cpu_watch.sh, run 407): a game's runner is 53% idle -- Gambit's thread 0.86 of a CPU, the game's drawing
(llvmpipe) 0.84, the rest a tenth; its four CPUs are two cores (0 and 1 one, 2 and 3 the other), and Gambit could be put on CPU 1,
the drawing's own core. Now the game is on CPU 0, Gambit's thread alone on the other core, and its workers, at the idle class
(SCHED_IDLE), on the two CPUs left.
Measured: one worker, not pinned (run 408), finish 20 -- the worker 0.09 to 0.18 of a CPU, the machine still 49% idle; pinned, two
workers (run 410), 19 -- each 0.07 to 0.11. The workers had nothing to do: the readiness jobs are a few boards a decision. TWO PLANS AT
ONCE: with workers, the break search (92 ms of a decision's 310) runs on one of them beside the other searches (149 ms), in all of
their time (answer.c breakBegin, breakEnd), its judging its thread's own (judge.c judgeCtx, outcome.c cache: LOCAL).
With a second worker, the survival search (32 ms, asked after the judging when nothing lives) runs on it from the start too, in the
same time, its board the decision's alone; the judging takes it when it asks (decide.c svJob).
Measured: the break search on a worker (run 411) 19, the workers 0.20 to 0.31 of a CPU, Gambit's own thread down to 0.78 -- it waited
for the break search to reach the end of the searches' time; with the survival search on the second (run 412) 22 (7, 8, 7), the
workers 0.42 to 0.48 each, the machine 30% idle where it was 49. Now the workers are taken back the moment the other searches are
done, each keeping the best it found, so Gambit's thread never waits on them (answer.c breakEnd).
Every run with 0 divergences and 0 late moves. Half the searches' time to the break search under garbage (share50): finish 13, pressure 16 -- no better. At the turn of every loss the move was mostly the hold (finish 437 of 443, pressure 112
of 118).
