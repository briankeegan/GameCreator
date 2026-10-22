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
   unless it was the only line that lives) -- reported apart by how many lines lived: two or more (the 0), one, or none (the line
   played was the one lost latest; run 420: all 178 cuts were here).
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
   and the share of swaps that clear, set up, or break (`front.c` follows every swap pressed by the panels it moved until one clears:
   before the next swap a clear, after it a set-up, with garbage broken a break, none in 10 s nothing -- gambit_summary.js `every move
   on the way`).
5. **Aggressive** -- after survival (6), once the games are survived. It throws far more blocks than it does now: every board that can send garbage without giving up its life sends
   it, and a mode's attack is fired as soon as it is made, not held. Aggression is the blocks thrown a minute (gambit_summary.js
   `aggression`), measured every run. Live play too: the opening raise held through its rows; never holding while the hold dies and
   a line that lives is offered.
   **Several ideas at once** is how the attack rate goes up: several chains built at once (several 8-chains, or different chains),
   or several combos made ready at once, each continued on its own, then fired together. An IDEA is a swap that fires an entry of the
   list (`search/ideas.c`; two that clear a panel in common are one). The planner builds on the board with more ideas of two as near
   the list, and keeps the line that fires two (`pair`); a route's two lines are pressed at once too; a line throws every attack it
   fires (`judge.c` `blocks`). Of two lines that live and meet the same entry, the one that throws more, then (no garbage on the board)
   the one that leaves more ideas ready (`rank.c` 8a, 8c); a set-up that lives and leaves more ideas ready than the hold is something
   done. Measured: clears begun while
   another still clears, the pair lines played, the lines that threw two blocks or more, the ideas left ready (gambit_summary.js
   `several ideas at once`).
6. **Every mode 24/24 at level 11, twice in a row**, then switching (5-30 s, every direction) 24/24 with the switches happening.
   **The order (the owner's):** the goal stays 24/24 in every mode; 22 of 24 is where a mode is left for the next -- a change made for
   one mode can undo another's, so the last two are won with every mode run together. Once every mode is at 22, they are run together
   and each change is checked for a mode it set back, until all are at 24, twice.
   Finish them reached 22 in run 432; big chain next.

## Open questions for the owner

- A material reserve before garbage lands, and how many panels.
- Whether the chain modes build their chains on their own stack only, or may fire the chains garbage colours make without breaking.
- Whether the opening raise goes higher than 10 rows. After the opening the stack is raised again to keep the floor (the owner: there
  should be a reserve), its 10 rows counting panels, garbage aside (`decide.c` refill, `facts.c panelTop`).

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
done, each keeping the best it found, so Gambit's thread never waits on them (answer.c breakEnd) -- measured with the next (run 415):
finish 14, 18 of 120 boards searched again had a break the live search missed where 1 to 3 had: the other searches end early, and
the break search was cut short with them. Backed out: the workers run to the end of the searches' time.
ALL THE SEARCHES AT ONCE: with three workers the decision's searches run side by side, each its own thread's nodes and buffers
(LOCAL): the break search, the survival search, the chain extended or begun (propose.c searchExt) and the planner's list split in two
-- its first entries planned on Gambit's thread, the rest on a worker, two beams each led by its own entries, their lines merged
(propose.c searchPrep, searchMerge; answer.c breakJob). Two workers by default became three.
Measured (`fc7867b1`, run 417): 15 of 24 games crashed in their first seconds. ThreadSanitizer on the C checks with three workers
found the races, 838 reports: the floor's scratch board (facts.c endFacts EB, ES), the board facts' (FB, FS), the fill's, one of the
planner's arrays (jobN), and poolBusy read unordered -- each thread's own, or atomic, now; 0 reports. `build.sh tsan` runs it, in
gambit-24's C checks and gate_gambit_engine. And the readiness the last decision left on the workers is taken back as a decision
begins, not at its judging: the pool was still busy when the searches were to begin, so none of them ran on a worker.
Measured (`ee9dfef7`, run 418): no game crashed, finish 17 (3, 7, 7); Gambit's thread 0.45 to 0.54 of a CPU, the workers 0.33 to 0.40
each, the machine a third idle -- every search side by side still took half of what was left, as one after another, and Gambit's
thread waited for the break search. Now each has the searches' whole time, Gambit's planner keeping back a fifth for the level and the
readiness lines (propose.c searchBeside).
Measured (`eb712c0e`, run 419): finish 21 (7, 6, 8), no crash, 0 boards predicted otherwise; aim met 81%, the list's entries 83% of
the lines played; the workers 0.47 to 0.53 of a CPU each, the machine 17 to 26% idle where it was 49; both factory losses after frame
19,700.
THE FLOOR KEPT BY RAISING: combo_storm-6 (run 419) spent its panels from 53 to 11 over 850 frames -- attacks, then breaks -- and was
lost with none left to break with; the raise was the opening's only ("never after"), and the rules' material floor only kept clears
that break nothing out. Now below the floor, not topped and under `to`, the stack is raised as the opening raises it -- a line that
lives or breaks before it (decide.c refill, answer.c).
Measured (`19e641e6`, run 420): finish 23 (7, 8, 8) -- the best yet; aim met 82%, the list's entries 83%, 0 boards predicted otherwise.
The one loss (combo_storm-3, 13995): at 13897 a break was there the live search missed and the reach report's wide search found in
148 ms.
TWO WIDTHS AT ONCE: the touch beam is searched 30 wide and then, if it finds nothing, 100 wide, one after the other in the break
search's time -- the wider is what the time cuts. Under garbage, a fourth worker searches the wider beam from the start beside the
narrower, and its break is played when the narrower finds none (answer.c JOB_WIDE, search/break.c touchFrom). Measured (`ff565443`, four workers,
run 421): finish 21 (7, 6, 8), 5 of 31 boards searched again had a break the live search missed where run 420 had 1 -- the misses
the narrower beam's, at 132 to 221 ms: four workers on the two CPUs the game and Gambit's thread leave are no more CPU, each search
slower. Three workers by default again; the wider beam runs only with a fourth.
The break search on Gambit's own thread under garbage, the planner on a worker in its place (`c60b511c`, run 422): finish 18 -- the
planner at the idle class lost more than the break search gained, and Gambit's thread still sat half idle (the break search ends early
once it has a break). Backed out: the layout of run 420.
EVERY STEP DOES SOMETHING: the lines with work on their way (propose.c wayLines) were offered 2,500 times a run and played 12 to 24:
of two that meet the same entry the order took the one the cursor walks less, and a line on the way walks a step more; a route (two
lines made one) walks more still. Now of two that meet the same entry, one that presses every swap of the other and more that helps --
work on its way, a route -- comes first, however far it walks (rank.c 8b, holdsLine).
Every run with 0 divergences and 0 late moves. Half the searches' time to the break search under garbage (share50): finish 13, pressure 16 -- no better. At the turn of every loss the move was mostly the hold (finish 437 of 443, pressure 112
of 118).
SEVERAL IDEAS AT ONCE (`8391d630`, run 424, finished 00:19 ET): finish 20 (5, 8, 7) -- combo_storm lost at 387, 3063, 16863,
large_garbage at 7093; combos and chains about as run 420; 0 frames over, 0 keys dropped, 0 late moves, 0 divergences. The clock cut
221 of 20,238 decisions where run 420 cut 17: every line ranked was asked its ideas, under garbage too, where they came to 0.06 on
average. Lines firing two ideas: 1,576 offered, 233 played; 1,691 lines threw two blocks or more; 380 clears begun while another
cleared. Every move on the way: 401 cells a minute; of 15,943 swaps 14% cleared, 31% set up, 38% broke, 16% nothing. Aggression 16.5
(420: 16.9), aim met 84%, the list 85%. Own chain cut 112 times: 108 with no line living, 4 with lines living -- the two in progress
(combo_storm-6, 1654 and 1679) cut a chain outside the list while the hold died. Now the ideas are asked only with no garbage on the
board, 8 lines a decision at most, and more thrown and more ideas decide only between lines that live; the log says how many living
lines kept the board's chain (`ownKept`).
Measured (`a141a6ae`, run 425, finished 00:36 ET): finish 22 (7, 8, 7) -- combo_storm-3 lost at 9700, large_garbage-6 at 6517;
0 frames over, 0 keys dropped, 0 late moves, 0 divergences; the clock cut 27 decisions (run 424: 221). Own chain cut 154 times: 0
while a line that lives kept it (the plan's 0), 14 while every line that lives cut it, 140 while none lived. Aggression 17.0 -- the
most yet -- aim met 81%, the list 85%. Every move on the way: 407 cells a minute; of 16,974 swaps 14% cleared, 32% set up, 37%
broke, 16% nothing; walk 3.2 cells, 17% jumps of 6 or more. Several ideas: 244 lines firing two played, 1,822 lines threw two
blocks or more, 394 clears begun while another cleared; the ideas were asked 12 times (the boards are under garbage 84 to 99% of
decisions). Both losses ran out of material under garbage: large_garbage-6 held 14 to 23 panels for 800 frames, combo_storm-3 went
from 45 to 26 in 500 frames of breaks, each with no break left to make -- the open question of a reserve before garbage lands.
THE RAISE IS A PLAY: the floor's raise (run 420) was a gate -- below 30 panels, the stack under 10 rows counting garbage, nothing
moving -- that in both of run 425's losses never opened: one raise each, the opening's, at frame 216, the board under a slab or popping
nine decisions in ten. Now after the opening a raise of one row and of two is a candidate whenever the board is still and not topped,
judged as the hold is on the board it leaves (garbage on its way landing as it comes, the frames it takes in its loss) and ranked with
the rest: played where it does better than holding -- a later loss, a break nearer or ready.
Measured (`35fb2778`, run 426, finished 01:50 ET): finish 16 (4, 6, 6) -- factory lost twice (3116, 10807) for the first time since
run 418; 1 late move, the clock cut 55, lines that lived 313 (run 425: 494). Factory-2 never raised: the raise judged its readiness on
every still decision, out of the time the lines' readiness had. Now the raise is judged only where nothing fits -- no line lives, or the
board is below the floor -- after the lines' readiness, in the time left; the log counts it (`raises=`).
Measured (`a8ab8ce6`, run 427, finished 02:04 ET): finish 19 (5, 8, 6); the raise was offered in no decision -- it waited for a board
with nothing moving, and a board where nothing lives always has something moving. Now it is offered where the floor's raise was (no
chain falling, the game allowing a raise) and the engine's raise says whether the rows come in.
Measured (`31a71b71`, run 428, finished 02:17 ET): finish 19 (5, 7, 7); the raise offered in 2 decisions -- judged after the lines'
readiness, in time the readiness had already spent. Runs with the floor's raise: 23, 22; with the raise as a judged play: 16, 19, 19.
The floor's raise is back, its 10 rows counted on the panels, garbage aside: a board under a slab is raised again.
Measured (`a3219524`, run 429, finished 02:31 ET): finish 19 (5, 8, 6); lines that lived 577, the clock cut 33, 0 late moves. Two
losses had a reason in the ranking: combo_storm-1 at 351 raised in the opening while nothing lived and the garbage landed that frame
(a break that lasted 310 frames was offered) -- now the opening's raise gives way to a break where nothing lives, as the floor's
does; large_garbage-3 at 2873 played a break lost in 46 frames over a hold lost in 290 -- of two that die a break came first while
it outlived the next decision's reaction (13 frames); now while it leaves the next decision a break's time (rankSave), the bar the
order's "lost alike" already reads.
Measured (`ee07a342`, run 430, finished 02:44 ET): finish 18 (5, 6, 7). Factory-4 was lost at 828 holding a line it could not press:
three answers running (797, 806, 821) were refused by the frame loop, their 14 keys over the input allowance (GUARDED), while the
judge had priced the walk under the allowance and kept the line -- two measures of one fact. Now the judge cuts a line whose first
swap's walk is over what the allowance leaves, as the frame loop refuses it, and the order takes one that can be pressed; the summary
counts the answers refused.
Measured (`68de6463`, run 431, finished 02:59 ET): finish 21 -- combo_storm 8/8 for the first time, factory 8/8, large_garbage 5/8
(4121, 12744, 12977); 0 answers refused by the input allowance, 0 late moves, 0 frames over, 0 divergences; aim met 81%, the list
85%, aggression 16.9; own chain cut while a living line kept it: 0. Every large_garbage loss ran out of material on a board topped
out under slabs (large_garbage-5: 23 panels for 2,000 frames, then 9): topped, the rules never raise ("A raise is never made on a
board topped out"), so the reserve there is kept only by what the breaks convert.
THE NEXT BREAK'S PANELS: topped under garbage, or below the floor -- where the stack is never raised, or is short -- of two breaks the
one that leaves more panels under the lowest garbage comes first (rank.c 7a, after the material and the saving keys, before the list):
what a break converts lands there, and the next break is made of it (`outcome.c matLeft`, the facts' own material reading).
Measured (`dd0f1f81`, run 432, finished 03:14 ET): finish 22 -- large_garbage 8/8, combo_storm 7/8 (7884), factory 7/8 (2105); 1
late move, 0 refused, 0 divergences; aim met 80%, the list 82%, aggression 15.8; own chain cut while a living line kept it: 0.
combo_storm-5 lived at 7642 and 7656 (5 lines of 13) and nothing lived from 7682: a life not kept. factory-3 was lost with breaks
there the live search did not find -- at 2063 (the break search cut by the clock, br=0/t3/cut; the reach report's touch search found
one with 5 touches in 74 ms) and 2097.
UNDER GARBAGE WITH NOTHING LIVING, THE WORKERS TO THE BREAK: the decision after one where no line lived does not split the planner
or extend the chain on a worker -- both stay on Gambit's thread, one after another -- so the break search and the survival search have
the two cores the game leaves (propose.c searchPrep, lastNoneLived).
Measured (`9b25576f`, run 433, finished 09:30 ET): finish 21 (8, 7, 6) -- a life kept 72% (run 432: 80%), aim met 78%, walk 3.5 cells
with 20% jumps of 6 or more. The chain, kept on Gambit's thread, ran first and took half the searches' time before the planner began.
Now only the planner's split is given up there -- its whole list on Gambit's thread in its full share -- and the chain stays on its
worker beside the break and survival searches.
Measured (`8345dccd`, run 434, finished 09:44 ET): finish 19 (4, 8, 7), a life kept 74% (run 432: 80%). The workers given to the
break search under garbage, two ways (runs 433, 434: 21, 19), against the layout of run 432 (22): the idea is kept open -- what costs
the lines that live is not found yet -- and the layout of run 432 is back while the next mode is worked on. Finish them is at 22 (run
432): big chain next.
BIG CHAIN, the first run (`0e077871`, run 438, finished 09:57 ET): 20 (combo_storm 4/8 -- 3501, 7854, 16748, 17981 -- factory 8/8,
large_garbage 8/8); 0 late moves, 1 frame over, 0 divergences; own chain cut while a living line kept it: 0; aim met 1% (17 of 1,327
attacks an 8-chain or more), the list 2%, threes that break 67%, last resorts 32%; aggression 18.1. Every loss ran out of panels (12
to 19) on boards the floor's raise left short, combo_storm-3 with no garbage on it at 7644: the floor's raise was held to readiness,
and a board too short to make a break leaves none once everything lands at any row count. Now below the floor the rows the board
lives through are raised when none is ready, and the log says what the floor's raise did (`refill=`).
Measured (`6dd968cf`, run 439, big chain, finished 10:14 ET): 20 (combo_storm 5/8, factory 8/8, large_garbage 7/8). The floor's
raise was asked in 1,057 decisions and pressed in none: 915 on a board busy with a cascade, 142 where the game took no raise -- in
combo_storm the board is falling or popping nearly every time it is asked. THE FLOOR'S RAISE, TIMED: a board busy now is run on, left
alone, to the first frame the engine would act on a raise (search/ready.c raiseOpenIn, the host's own test), the raise judged on that
board and handed to the frame loop to be pressed then (front.c, raiseWait) -- a line that lives or breaks still first.
Measured (`4f53d6f0`, run 440, big chain, finished 10:34 ET): 17 (combo_storm 4/8, factory 7/8, large_garbage 6/8); the floor's
raise asked in 785 decisions, pressed once: 784 times the board left alone took no raise within 120 frames by the test as written
(the host's, and no chain running). Now the test is the host's alone, and what held the raise shut on every frame searched is logged
(`refill=.../sN`) and summed.
Measured (`b27034b8`, run 441, big chain, finished 10:49 ET): 20 (combo_storm 4/8, factory 8/8, large_garbage 8/8). The floor's
raise, timed: shut on every one of 120 frames in 814 of 816 asks -- the rise locked 414, topped once the garbage lands 275, panels
moving 252, the shake 112: in combo_storm the garbage never stops, and a board left alone takes no raise until it is topped. The losses
there were not short (23 to 51 panels at the turn). Big chain's list is 8-chains only, so under garbage a combo that breaks is outside
it, and where nothing lives the order put every line within the list -- a plain three -- before it (key 5). Now between two breaks
under garbage that both die, the list's ask does not decide: the garbage broken and the material left do.
Measured (`d8c285ae`, run 442, big chain, finished 11:02 ET): 23 (combo_storm 7/8 -- 2418 -- factory 8/8, large_garbage 8/8); 0 late
moves, 0 frames over, 0 divergences; a life kept 86%; aggression 19.8; own chain cut while a living line kept it: 0; aim met 1%.
Big chain is at 22: pressure next.
PRESSURE, the first run (`b4344884`, run 443, finished 11:23 ET): 17 (combo_storm 3/8 -- 4578, 7673, 10008, 19832, 20525 -- factory
7/8, large_garbage 7/8); 1 late move, 0 divergences; own chain cut while a living line kept it: 0; aim met 12%, the list 12%, threes
that break 39%, last resorts 50%; aggression 18.6. Of two lines that die, a break came first while it left a break's time, however much
later the other was lost (combo_storm-5, 7359: a break lost at 193 over a line lost at 335). Now a break comes first only where the
other is lost less than a break's time later.
Measured (`d7e22a03`, run 444, pressure, finished 11:36 ET): 14 (combo_storm 3/8, factory 8/8, large_garbage 3/8 from 7/8). With
the break held to the later loss everywhere, large_garbage -- short boards, 23 panels -- lost the panels its breaks convert. Now the
break comes first as before on a board below the floor, and is held to the later loss only where the board has panels to spare.
Measured (`ecb6b40d`, run 445, pressure, finished 11:49 ET): 21 (combo_storm 5/8 -- 2019, 11957, 20808 -- factory 8/8,
large_garbage 8/8); 1 late move, 0 divergences; own chain cut while a living line kept it: 0; aim met 12%; aggression 18.1. One short
of 22, with no fault found in its losses the order is not built to make (combo_storm-6 at 7 panels after a break of 36 cells; -5 the
material key choosing the break that keeps the next one's panels; -4 a short board's break 91 frames sooner): pressure is left at 21,
to be won with every mode run together. Build next -- its first run.
BUILD, the first run (`3cd40adf`, run 446, finished 12:04 ET): 19 (combo_storm 6/8 -- 10501, 11135 -- factory 7/8 -- 11292 --
large_garbage 6/8 -- 7792, 17252); 1 late move, 0 divergences; own chain cut while a living line kept it: 0; aim met 7%, the list 9%,
last resorts 50%; aggression 18.9. Of two lines that die, any two lost past two breaks' time were alike (combo_storm-2, 10837: a line
lost at 266 taken over one lost at 385 that broke more). Now two survive alike when they leave the next decisions as many breaks'
time -- tries, a break's time each -- or three or more each.
Measured (`3219c4c1`, run 447, build, finished 12:18 ET): 20 (combo_storm 6/8 -- 13050, 17166 -- factory 8/8, large_garbage 6/8 --
16664, 21467); 0 late moves, 1 frame over, 0 divergences; own chain cut while a living line kept it: 0; aim met 5%; aggression 18.5.
combo_storm-2 was lost with a one-swap break there (the reach report's first search, 3 ms) that was never searched for: the question
was due sooner than the searches' share leaves the break search. Now short of that share it takes the judging's quarter, BREAK_MIN_MS.
Measured (`d0a4b449`, run 448, build, finished 12:31 ET): 17 (combo_storm 4/8, factory 8/8, large_garbage 5/8); 0 late moves, 0
divergences. Its 5 missed breaks searched again in the live search's own time (the reach report, written again by `21f64613`): 1
found, 4 not -- the live search had 3 to 27 ms, the breaks took 5 to 186. Near the end the frame loop asked a few frames ahead, as
recent answers had taken, and the answer had ms. Now after a hold on a board that dies with no break found, the question is asked a
reaction ahead at least (front.c), the board lost sooner asked for its last frame alive as before.
Measured (`a196edac`, run 450, build, finished 12:48 ET): 17 (combo_storm 6/8, factory 6/8, large_garbage 5/8); 1 late move, 0
divergences; missed breaks 1 of 78 boards searched again (run 448: 5), found in its own 237 ms -- the time was won; 77 had none to find.
At the turn of most losses the order took a line lost at 304 or 317 over one lost at 368 or 377 that broke as much: three tries or more
counted alike. Now two lines that die survive alike only when they leave as many tries.
Measured (`3844777e`, run 451, build, finished 13:02 ET): 15 (combo_storm 3/8, factory 8/8, large_garbage 4/8); material under
garbage down (large_garbage 19 from 23, combo_storm 25 from 26): the later loss taken past three tries spent the panels the material
key keeps. Three tries or more alike again; the turn of run 450's losses is still open -- to be won by the material, not the later loss.
THE NEXT BREAKS' PANELS, ONCE EVERYTHING LANDS: of two breaks on a short or topped board under garbage, the one that leaves more
panels under the lowest garbage on the board the readiness lands -- everything shown landed, settled (judge.c readyMat) -- comes first
(rank.c 7a); the line's own end board where the landing was not asked. Measured on the two patterns that lose (combo_storm,
large_garbage), twice -- the patterns input -- as much as one run of 24 costs.
Measured (`a22dd377`, runs 452 and 453, build, combo_storm and large_garbage only, finished 13:3x ET): 8 and 10 of 16 -- combo_storm 3/8
and 6/8 on the same build; the five build runs before it 12, 12, 9, 11, 7 of 16 on the same two patterns (10.2). THE NOISE: the same
build swings three games of eight in one pattern, so a change worth a game or two is invisible in one run, or two -- and most of the
single-run verdicts above (a game or two either way) are inside it. Measuring a change now needs the same games played again: a run
that plays each of the 16 games more than once, or fixed seeds.
A SET-UP KNOWN TO THE NEXT DECISION: the planner's set-up was one swap -- the first toward the board it built toward -- and once pressed
nothing kept where it was going, so the next decision might build something else and the set-up go unused. Now the set-up is offered
as its whole way there too (search/plan.c setupLine): its first swap played, the rest carried on as the line in progress, judged again
each decision (decide.c carryOf).
Seeded (`616dc8af`, runs 454 and 455, build, combo_storm and large_garbage, seed 1): 9 and 10 of 16. The seed holds -- combo_storm-2's
board at its first search (frame 364) is the same in both runs -- and the games part there, on the first answer the clock bounds: the
same panels, the bot's own timing the noise. The seed takes the panels out of it, not the timing.
A LINE WHOSE BREAK IS MADE IS PLAYED ON: large_garbage-7 (run 455) at 3932 carried a line that lived, its swap pressed then the break
(the board searched again: [2,2], one swap); at 3946 the rest of it was asked to break again, did not -- the slab was popping already --
and the line that lived was dropped for one that died (lost at 4092). Now a line begun for a break is carried on when the slab is
popping on its board and was not when it was begun (decide.c carriedCand): the rest is judged for what it makes, as every line is.
GARBAGE UNFORESEEN DROPS ONLY WHAT COMES AFTER IT: combo_storm-3 (run 455) at 6942 had one swap that broke 28 cells and lived to 290,
due at once on a board that died the frame after; garbage the decision had not counted on arrived, the whole plan was dropped, and the
board died before a question could be answered. Garbage lands on the stack's top and changes nothing before it lands, so now the keys
planned before it lands are pressed as planned and only the rest is dropped and asked again (front.c dropFrom).
Measured (`b7f4f47b`, run 456, build, combo_storm and large_garbage, seed 1, finished 13:46 ET): 8 of 16 (combo_storm 4/8,
large_garbage 4/8) against 9 and 10 on `616dc8af`; 1 late move, 0 divergences. Lost: combo_storm 1, 3, 7, 8; large_garbage 1, 6, 7, 8.
large_garbage-6 lost to the carried break dropped while its slab popped again (3749 to 3763), large_garbage-7 to the one late move (3508:
a carried line that lived to 334, its answer late, nothing pressed).
A LINE JUDGED PRESSED LATER IS PRESSED THEN: a line whose first swap the judge pressed after the answer's frame (answer.c timed) is
answered as a hold with the whole line handed on, and the hold's keys ran a reaction (12 frames) -- the first swap pressed at +12 where it
was judged at +1, and the line no longer the one judged (run 456, large_garbage-7, 3508: a line that lived to 334, lost at 3533). Now
the hold lasts until the line's first swap is due (front.c take).
Measured (`0f29137a`, run 457, build, combo_storm and large_garbage, seed 1, finished 13:52 ET): 13 of 16 (combo_storm 6/8 -- 1826,
12371 -- large_garbage 7/8 -- 20265) against 8, 9 and 10 on the builds before it on the same games, and 7-12 on every build before
the seed: the best yet on the two patterns that lose. 0 late moves, 0 divergences.
Measured (`31c9518b`, run 458, build, the same games): 8 of 16 (combo_storm 5/8, large_garbage 3/8) against 13 on `0f29137a` -- and
large_garbage met no garbage unforeseen (large_garbage-2: 0), so the change never ran there: four of its games lost in 458 and survived
in 457 on the same panels and the same play. THE NOISE IS THE BOT'S OWN TIMING, and it is as wide on fixed seeds as without them (7/8
against 3/8): one run of 16 games cannot tell a build from the one before it. Now a run plays rounds (gambit-24.yml `rounds`, each round
the patterns' games again on seeds of its own) and a build is measured over 32 games or more. The drop kept from the unforeseen garbage
on also tells the frame loop of that garbage at once (front.c dropFrom), so it is not dropped again every frame till the plan ends.
Measured (`9bba87af`, run 459, build, the same games): 8 of 16 (combo_storm 2/8, large_garbage 6/8); combo_storm-4 lost at 394 to an
early raise and garbage, no line pressed later in that game -- a game 457 survived. Noise, not the change. Run 460 measures `1d16e23c`
(every change since 456) over three rounds, 48 games.
Measured (`1d16e23c`, run 460, build, combo_storm and large_garbage, three rounds, finished 14:20 ET): 31 of 48 (combo_storm 16/24,
large_garbage 15/24), 65%, against 56 of 96 (58%) over runs 454-459 -- inside the noise of 48 games, the right way. 0 divergences, 1
late move. Of 7868 lines in progress dropped, 3955 at a step no longer there, 1881 of those at the very next swap; 96% of decisions are
made with 40 actions or fewer left of the input limit (76 in 600 frames), and the busiest windows reach 70-76. Whether those 1881 are
the allowance, a swap not there, or a walk not begun within a reaction, the log now says (carryDrop=2:...c0a|n|w), and every decision
logs the allowance it was made under (allow=); the summary sums both.
Measured (`f79188c7`, run 461, build, all three patterns, two rounds, finished 14:4x ET): 30 of 48 (combo_storm 8/16, factory 12/16,
large_garbage 10/16) -- 15 a 24. Of the 1809 lines in progress cut at their next swap, 1566 for a walk not begun within a reaction, 238
with no swap there, 5 over the allowance; the allowance is 6-40 left in 96% of decisions and 0-5 in none, so the input limit is not what
cuts them. combo_storm-7 (seed 1) lost at 837 in 459 and 461 and lasted to 6964+ otherwise: its first decision, on the same board, raised
in those two (the opening raise fires when the stack can raise on the frame asked) and cleared in the others -- the timing again, not a
change; over 96 games the opening raise is no worse (combo_storm 14/18 raised early, 10/22 not).
A SETTLED LINE IN PROGRESS WAITS FOR THE BOARD: a settled line's next step was judged again on a board still moving from the step before
and cut when its walk could not begin within a reaction -- where it was judged on that board settled. Now the line in progress is judged
on its board settled (decide.c carriedCand, waitTo), offered as the carry that waits, and judged so by the order (rank.c judgeCand).
Measured (`a2dcd5cf`, run 462, build, all three patterns, two rounds): 31 of 48 (combo_storm 12/16, factory 10/16, large_garbage 9/16)
against 30 on `f79188c7`; lines in progress cut at their next swap 234 against 1809 (68 for a walk not begun within a reaction, against
1566). FACTORY: 22 of 32 over 461 and 462, against 37 of 40 over runs 446-451 (random panels then): a regression since `3844777e`, or the
seeded games harder -- run 463 plays the Gambit of `3844777e` on the same factory games (gambit-24.yml `gambit_from`) to say which.
Measured (run 464, factory only, two rounds, the Gambit of `3844777e` on today's harness and seeds): 13 of 16, against 22 of 32 for the
builds since on the same games -- two games of sixteen apart, inside the noise: no regression; the seeded factory games are harder than
the random ones 446-451 played. Build stands at about 65% on all three patterns, 15-16 a 24.
THE BREAK SOONER (rank.c 7c): a break put off decision after decision -- each new line breaking as much a few frames later and lived a
few frames longer, alike by the tries -- till the board has no time to make it (run 457, combo_storm-6, 1585 to 1816). Now of two breaks
under garbage that neither lives and every key before leaves equal, the one whose last swap is pressed sooner comes first.
Measured (`c0e01ab1`, run 465, build, all three patterns, two rounds, finished 15:4x ET): 39 of 48 (combo_storm 12/16, factory 15/16,
large_garbage 12/16), 81%, against 30 and 31 of 48 on the two builds before it on the same games -- eight games of 48, two standard
errors: the break sooner holds. About 19.5 a 24. 0 late moves, 0 divergences. Finish next on the same commit, for what 7c does there.
Measured (`e038118b`, run 466, finish them, all three patterns, two rounds): 36 of 48 (combo_storm 9/16, factory 14/16, large_garbage
13/16), 18 a 24; aim met 63%.
A SWAP PLAYED FOR THE BREAK IT LEAVES IN REACH carries that break: a one-swap line played because a break is in reach once everything
lands (its readiness) now hands that break to the next decision as the line in progress, as a hold waiting for one does (decide.c
carryReady) -- run 465, large_garbage-6 round 2, 3543: a ready swap that lived by it, then a decision whose search was cut and found none.
Measured (`3a24e52a`, run 467, build, two rounds): 34 of 48 (combo_storm 13/16, factory 16/16, large_garbage 5/16) -- large_garbage
lost seven games to it. The line in progress is put first of its tier, and a break found on the board once everything lands is a break
on a board the stack is not yet: put first, it took the place of lines the order ranks above it. Now the break a ready swap leaves is
carried and offered, judged as every line is, and not put first (decide.c carriedFromReady).
Measured (`f4f9921a`, run 468, build, two rounds): 35 of 48 (combo_storm 10/16, factory 13/16, large_garbage 12/16): the ready break
offered, not first, is about even. THE BREAK SOONER BEFORE THE MATERIAL (rank.c 5a, where 7c was): the key that took run 465 to 39 of
48, asked before the material keys.
Measured (`4b9afcea`, run 469, build, two rounds): 35 of 48 (large_garbage 9/16, its material under garbage 21.8): the break sooner put
before the material spends the panels. Back after it (7c). The 7c builds over 192 games: 39, 34, 35, 35 of 48 -- 74%, about 18 a 24.
Measured (`4ad1c1ff`, run 470, build, two rounds, four workers -- the break search's wider beam on a thread of its own): 33 of 48
(combo_storm 6/16, factory 16/16, large_garbage 11/16): no better than three; the runner's four CPUs are shared with the client and its
renderer. Three stay.
Measured (`3a82fdae`, run 471, build, two rounds on seeds 3 and 4): 38 of 48 (combo_storm 10/16, factory 16/16, large_garbage 12/16).
The judge cut 49299 lines for a walk not begun within a reaction -- 13218 of them the break search's -- and 31365 for no swap there.
A SWAP THAT WAITS IS PRESSED WHEN ITS WALK BEGINS: a line whose swap could not be walked to within a reaction was cut, though the frame
loop presses every swap of a line from the frame its walk was judged to begin (the hand's frames, and a first swap's timed hold, which
ends when it is due). The cut is gone (judge.c); a swap is waited for as long as the press waits (core/nodes.h PRESS_WAIT).
Measured (`85ce8628`, run 472, build, four rounds on seeds 1-4, 96 games): 75 of 96 (combo_storm 25/32, factory 27/32, large_garbage
23/32), 78% -- the swap that waits pressed when its walk begins is even with the cut (36 of 48 on seeds 1-2, 38 on 3-4). The cut counts
then counted the walking order's trial judgings too; they are kept out now, as the drops are (rank.c judgeWalked).
Measured on `9d927c18`, two rounds each: pressure 35 of 48 (combo_storm 10/16, factory 15/16, large_garbage 10/16; aim met 8%), big
chain 33 of 48 (9/16, 14/16, 10/16; aim 1%). Every mode stands at 16.5-19 a 24. From here a run is one 24 (the owner's).
THE PLANNER'S BREAK, AS THE JUDGE COUNTS IT: in 2088 decisions of run 469's large_garbage the planner's entry said it broke 6 and the
judge 0 -- the planner counted what a step's settle converted, the board's own popping slab or cascade with it, where the judge and the
break search count what the line has broken beyond the board left alone. The planner now counts a step's break that way (search/plan.c
BROKE_OF, stillAt), so its beam is built on breaks the line makes.
Measured (`c9c12992`, run 475, build, one 24): 18 (combo_storm 4/8, factory 6/8, large_garbage 8/8 -- its first 8 on these games); the
planner's entry claiming a break the judge does not see went from 16% of large_garbage's decisions to 3%.
UNDER GARBAGE THE NEARER BREAK BEFORE THE PANELS KEPT: combo_storm-3 (run 475, 12294): a break made, 294 frames of stop, no break in
reach -- the hold kept, as the line whose panels give the board the most life, over lines that brought the next break nearer, and the
stop ran out on a board eight slabs deep. Now under garbage, within a tier, the line nearer its next break comes before the life its
panels leave (rank.c, nearAfter before lifeLeft).
Measured (`ca81b2c2`, run 476, build, one 24, finished 18:5x ET): 20 (combo_storm 6/8 -- 11509, 20060 -- factory 8/8, large_garbage 6/8
-- 3785, 9978); 0 divergences.
A LINE'S FIRST SWAP STILL WALKED WITHIN A REACTION: with the cut gone, the frame loop refused 204 answers in run 476 (144 in 475, none
before) -- a first swap whose walk could not begin within a reaction, on a line with no frames to hand on (a level line, a slab
popping): nothing pressed, asked again. The cut is back for a line's first swap; its later swaps are pressed from the frame their walk
begins. The summary's budgets now count the answers refused so (gambit_summary.js).
Measured (`8bdf75af`, run 477, build, one 24): 17 (combo_storm 4/8, factory 8/8, large_garbage 5/8); 0 answers refused (204 in 476).
A LINE THAT BREAKS IS CARRIED WHATEVER ITS TIER: three of run 477's four combo_storm losses were a line chosen for a break of 24-36
cells, its first swap pressed, and at its second swap's frame no line that lived -- the line forgotten: under garbage while the break
waits, a breaking line ranks in the last tier (facts.c tierOf, 6), and only lines of tier 4 or better were carried (decide.c carryOf).
Now a line that breaks is carried whatever its tier.
Measured (`f5b63ce4`, run 478, build, one 24): 17 (combo_storm 6/8, factory 5/8, large_garbage 6/8); none of its losses the line
forgotten after its first swap -- each a board with no break in reach for 200-300 frames before it died.
Every mode on `a83c820f`, one 24 each (runs 479-481): finish 17 (6, 7, 4; aim 64%), pressure 20 (8, 5, 7; aim 9%), big chain 18 (7, 7,
4; aim 0%); build 17-20 (476-478). large_garbage the weakest pattern in three modes of four.
THE BREAK A LINE LIVES BY IS CARRIED NEXT: one line in five judged to live had none that lived at the next decision (the summary's "a
life kept", 79-80%). Big chain's large_garbage (run 481, 11360): the line in progress lived by a break in reach once everything lands;
its swaps pressed, the next decision's break search did not find that break, and nothing lived. Now a line played that lives by its
readiness carries that break as well, made the line in progress once its own swaps are pressed (decide.c theCarryNext), offered and
judged as every line is.
Measured (`78ce3ee1`, run 482, build, one 24, finished 21:1x ET): 21 (combo_storm 7/8 -- 8902 -- factory 8/8, large_garbage 6/8 --
9682, 10660); a life kept 84% (79-80% before); 0 divergences.
Measured (`53fe0953`, run 483, build, one 24 on seed 3): 15 (combo_storm 5/8, factory 6/8, large_garbage 4/8). The breaks the live
search missed and found again in its own time (3418, 4762, 6217) ran on a worker given a second (brAt=1/1088) and ended in 1-3 ms with
none: on a board 0-28 frames from death, with the allowance tight, the search walks the cursor held from two cells, as the frame loop
then would -- later than the taps the search again took -- and the break is too late. 96% of decisions were tight at 40 actions left,
and the busiest 10 s used 53 of 76. THE ALLOWANCE TIGHT AT 20 LEFT, not 40 (core/nodes.h, survivor_keys.js HOLDTIGHT): a walk is tapped,
on time, till the input limit is near.
Measured (`96701edf`, run 484, build, one 24): 17 (combo_storm 5/8 -- 835 -- factory 6/8 -- 836 -- large_garbage 6/8): tight at 20
spent the allowance -- 53% of decisions made with 6-20 actions left where 19% had been -- and at 777-829 and 786-812 every line was
cut for a walk over it, the hold the only line left. Back to 40.
TAPPED NEAR THE END: a board topped with its stop and shake about to run out (45 frames) walks tapped while the allowance keeps 12 actions
to spare (core/nodes.h tightAt, pressTap) -- the decision says so and hands it on with the line it plays, and the frame loop presses
that line so (front.c lineTap); only where the host's frame loop reads it (the native one: native.c gn_setup).
Measured (`8d6adfc1`, run 485, build, one 24, finished 23:0x ET): 21 (combo_storm 5/8 -- 3759, 6080, 7023 -- factory 8/8,
large_garbage 8/8); 1 break missed (5 in 483), 0 divergences.
The same build on more games (runs 486, 487): seed 2 21 (combo_storm 6/8, factory 8/8, large_garbage 7/8), seed 3 19 (6/8, 6/8, 7/8)
against 15 there on `53fe0953` -- build 21, 21, 19 over three sets of games, 20.3.
UNDER A POP, THE TOUCH BEAM FIRST: with a slab popping the break search tried the popping slab's line-ups first and the touch beam on
the garbage elsewhere with what was left -- factory-1 (run 487, 6992-7019) missed breaks of 7 and 8 swaps searched again in 95-106 ms of
the 210-257 it had, each decision cut. Now under a pop the touch beam has the first half of what is left, the line-ups and the touch beam
after them the rest (search/break.c).
Measured (`d5e0df46`, run 488, build, seed 3): 18 (combo_storm 4/8, factory 7/8, large_garbage 7/8) against 19 on the same games.
TAPPED WHEN THE BOARD DIES SOON, NOT ONLY TOPPED: combo_storm-3 and -4 (run 488) lost one-swap breaks at 11525 and 12841 (found again in
0-1 ms), the boards 10-12 frames from their stop's end and not yet topped, or with 12 actions left -- no tap. Now a board lost within 60
frames left alone (its stop, or its rise to the top, and its health: facts.c framesToTop) taps while 8 actions are left to spare.
Measured (`008850af`, run 489, build, seed 3): 20 (combo_storm 7/8, factory 8/8, large_garbage 5/8) against 18 and 19 on the same games.
Measured (`73d8d6c6`, run 490, build, seed 1): 18 (combo_storm 5/8, factory 7/8, large_garbage 6/8), against 21 on 485's build. Build
over runs 482-490: 21, 15, 17, 21, 21, 19, 18, 20, 18 -- one 24 swings three games either way.
THE TAP KEEPS 16: factory-4 (run 490, 13331-13357) died with no actions left (allow=0), every line cut for a walk over the allowance --
the taps had spent down to the reserve of 8 and past it on the walks they made. The reserve is 16 (core/nodes.h TAP_RESERVE).
Measured (`0ef152bb`, run 491, build, seed 1): 19 (combo_storm 7/8, factory 8/8, large_garbage 4/8).
DYING UNDER GARBAGE, THE LIST DOES NOT ORDER, AND A BREAK BEATS THE HOLD IT OUTLASTS: run 491's large_garbage-6 (13932) played a hold lost
at 194 over a line toward a break lost at 212 -- the line outside the list, put after the hold by key 5 -- and large_garbage-4 (7531) a
hold lost at 44 over two breaks lost at 44, the breaks taken for lines no better than holding. Now under garbage, between two that both
die, the list orders only a line that spends panels below the floor (rank.c 5, J->spends); and a break lost no sooner than the hold beats
it (rank.c beatsHold).
Measured (`d8a50696`, run 492, build, seed 1): 18 (combo_storm 3/8, factory 8/8, large_garbage 7/8).
Measured (`b18d0d90`, run 493, build, seed 2): 20 (combo_storm 6/8, factory 7/8, large_garbage 7/8). Build stands at 19-20 a 24.
MORE BROKEN BEFORE THE PANELS KEPT (the owner: a board running out of panels is a board not breaking): of two breaks under garbage that
neither lives, the one that breaks more now comes before the material keys (rank.c 7b before 6 and 7a) -- the garbage a break gets off is
the board's next panels.
UNDER GARBAGE A BREAK FIRST, ALWAYS (the owner: breaking is how the board gets more blocks): of two lines that neither lives under
garbage, the one that breaks comes first whatever their losses (rank.c 2) -- before, a break gave way to a line lost a break's time
later on a board with panels to spare, and to any line when the break itself was lost within a break's time.
Measured (`687b06a7`, runs 494 and 495, build, seeds 1 and 2): 16 and 18 (34 against 38 on the same games before) -- and the share of
swaps that broke garbage the same, 31-32%: ranking breaks higher makes no more of them, the board has to have one in reach. Both order
changes taken back (rank.c as at `ba4c312f`).
BUILD THE NEXT BREAK RATHER THAN HOLD: under garbage a break was in reach in 50-66% of decisions (run 495), and in large_garbage 47% of
them had none in reach with more than 60 frames of stop -- and held in most (1028). Two dying lines alike by the tries were ordered by
the later loss before anything else (rank.c 9), which the hold nearly always is. Now, under garbage, of two alike the one nearer its next
break comes first.
Measured (`8e26111d`, run 496, build, seed 1, finished 01:4x ET): 22 (combo_storm 7/8 -- 10973 -- factory 8/8, large_garbage 7/8 --
7767): build's first 22.
Measured (`8e26111d`, run 497, build, seed 2): 23 (combo_storm 8/8, factory 8/8, large_garbage 7/8 -- 18471). BUILD AT 22: 22 and 23 on
two sets of games. Left at 22 for the next mode (the owner's order); every mode measured next on this build.
Every mode on `db5af9c7`, seed 1 (runs 498-500): finish 19 (7, 7, 5; aim 62%), pressure 20 (7, 7, 6; aim 8%), big chain 15 (5, 7, 3;
aim 1%); build 22 and 23. Big chain next.
Measured (run 501, big chain, seed 2): 17 (combo_storm 3/8, factory 7/8, large_garbage 7/8) -- with seed 1's 15, big chain stands well
below build (22, 23) on the same engine; the two differ only in the list. UNDER GARBAGE A LIST OF LONG CHAINS TAKES THE CHAINS THAT BREAK:
a list asking a chain over five (big chain's 8) led the searches toward nothing a buried board can make -- a chain of 2-7 that breaks met
no entry and was near none, where build's 5 made 2-4 near. Now such a list, under garbage, takes every chain of two or more that breaks,
after its own entries and before the three that breaks (rules.c withChains; decide.c read).
Measured (`89af27c3`, runs 502 and 503, big chain, seeds 1 and 2): 18 and 17 (15 and 17 before) -- combo_storm 3/8 on seed 2 again,
where build is 8/8; the panels on the board the same in both modes, off garbage (41) and under it (27). UNDER GARBAGE A LONG CHAIN IS
LED AS A CHAIN OF FIVE: the searches and the order under garbage take a list's chain over five as a chain of five or more, breaking --
the lead build plays under garbage by; the list itself, what fits and what meets, stays the mode's (rules.c guideShort, in place of
withChains).
Measured (`9814de13`, run 504, big chain, seed 2): 18 (combo_storm 7/8 -- 3/8 before -- factory 6/8, large_garbage 5/8).
THE OPENING RAISE LEAVES ROOM FOR THE GARBAGE ON ITS WAY: large_garbage-3 on seed 2 died at 421 in runs 495 and 504 -- the opening raise
took the stack to 42 panels under a slab 105 frames off. The rows raised to now lose the rows on their way (a slab its height, narrower
pieces their cells a row's worth at a time; decide.c read).
Measured (`dc1b4337`, run 505, big chain, seed 2): 21 (combo_storm 6/8, factory 8/8, large_garbage 7/8) against 17 and 18 there.
The opening raise taken back to as it was (the owner: raising at the start is important -- if anything it should raise more; the bot is
to be aggressive). Measured with it: big chain 21 on seed 2 against 17 and 18. decide.c as at `9814de13`.
THE OPENING RAISE TO 11 ROWS (the owner: if anything it should raise more): measured on big chain's seed 2, 18 at 10 rows.
Measured (`5f4e7ece`, run 507, big chain, seed 2, raised to 11 rows): 22 (combo_storm 7/8, factory 8/8, large_garbage 7/8) against 18
at 10 rows.
Measured (run 508, big chain, seed 1, 11 rows): 19 (combo_storm 7/8, factory 8/8, large_garbage 4/8) against 18 at 10. Big chain 22, 19.
Measured (run 509, build, seed 1, 11 rows): 20 (combo_storm 5/8, factory 8/8, large_garbage 7/8) against 22 at 10 -- inside a run's
three games. 11 rows stay (the owner's).
NEARER WHEN NONE IS NEAR: past breakNear's reach (no three lined up by walking panels along their rows, NEAR_MISS) every board was as
far as every other -- the break search's beam and the order's nearAfter had nothing to go by, and large_garbage played 200-400 frames
toward no break. Now there the makings of one count: of the panels touching garbage, the most of its colour in its row and the two
under it, and how many touch (search/break.c touchPotential) -- the beam's score and nearAfter both.
Measured (`daab542f`, run 510, big chain, seed 1): 12 (combo_storm 3/8, factory 5/8, large_garbage 4/8) against 19 -- the makings of a
break as nearness took the order's nearAfter (the tier, the alike rule, beating the hold) over by small differences, and the panels
went. Taken back (search/break.c as at `5f4e7ece`).
THE MAKINGS OF A BREAK, THE BEAM'S ONLY: the same measure as the break search's beam score past breakNear's reach, and nowhere else
(search/break.c nearScore); the order's nearness stays breakNear's.
Measured (`91dbdcf4`, run 511, big chain, seed 1): 23 (combo_storm 7/8, factory 8/8, large_garbage 8/8) against 19 on the same games.
Measured (`91dbdcf4`, run 512, big chain, seed 2): 15 (combo_storm 3/8, factory 6/8, large_garbage 6/8) against 22 -- 38 over both
seeds against 41. Past breakNear's reach the makings counted 100 a unit, up to 2,400, where the unevenness it is set against runs to
about a hundred: the beam no longer kept the stack level there at all.
THE MAKINGS WEIGH AS THE UNEVENNESS DOES: 25 a unit (up to 600), so a level stack still counts where no break is near.
Measured (`a10b61bb`, runs 513 and 514, big chain, seeds 1 and 2): 19 and 18 -- 37 over both seeds, against 38 at 100 a unit and 41
without the makings. Taken back (search/break.c as at `5f4e7ece`).
Big chain reached 22 at `5f4e7ece` (run 507); on to pressure and finish, measured on this build (`5f4e7ece`'s Gambit).
Measured (`92d19244`, runs 515 and 516, seed 1): pressure 18 (combo_storm 4/8, factory 8/8, large_garbage 6/8), finish 18
(combo_storm 5/8, factory 7/8, large_garbage 6/8). Every mode's combo_storm is its weakest pattern; two of its losses come before
frame 1600.
BOUGHT WITH THE PANELS: pressure's combo_storm-6 (run 515) spent 39 panels to 18 before garbage ever reached the board -- every
decision a clear lost later than the hold, each clear's stop holding the stack from rising, its chains keeping the rise locked (the
floor's raise asked and never open). Now the later loss a line that spends panels below the floor buys is no reason to pass over one
that spends none and leaves the next decision a try: the two survive alike, and the list puts the one that keeps its panels first
(rank.c key 3).
Measured (`9fb7b62c`, runs 517 and 518, seed 1): pressure 21 (combo_storm 6/8, factory 7/8, large_garbage 8/8) against 18, finish
19 (combo_storm 6/8, factory 7/8, large_garbage 6/8) against 18.
Measured (`5e78e866`, runs 519 and 520, seed 2): pressure 22 (combo_storm 6/8, factory 8/8, large_garbage 8/8) -- pressure at 22 --
and big chain 16 (combo_storm 3/8, factory 7/8, large_garbage 6/8) against 22 on `5f4e7ece` (seed 2's big chain has run 15 to 22:
504 18, 505 21, 507 22, 512 15, 514 18); its combo_storm-3 lost at 1016, under garbage from 516 at 26 panels.
Measured (`5e78e866`, run 521, finish, seed 2): 21 (combo_storm 7/8, factory 8/8, large_garbage 6/8). Finish 19 and 21.
Measured (`5e78e866`, run 522, big chain, seed 1): 21 (combo_storm 7/8, factory 8/8, large_garbage 6/8) against 19 and 19 there.
Measured (`5e78e866`, run 523, build, seed 1): 16 (combo_storm 4/8, factory 8/8, large_garbage 4/8) against 20 at `5f4e7ece` (run
509). Over the seeds measured on both builds the rule's runs are +3, +1, +2, -6, -4: inside a run's noise either way; it stays.
FOUR WORKERS: the runners' four CPUs sit 63% idle with three; a fourth gives the break search its wider beam (workers input).
Measured (`5e78e866`, four workers, runs 524 and 525, seed 1): build 17 against 16 with three, finish 21 against 19. Four is the
workflow's default.
Measured (`29e5ec1c`, run 526, build, seed 2): 16 (combo_storm 5/8, factory 7/8, large_garbage 4/8). Build 17 and 16 on this build;
the same games played with `92d19244`'s Gambit next (before the panels rule), to see whether the rule is what build lost.
Measured (run 527, build, seed 1, `92d19244`'s Gambit, four workers): 21 (combo_storm 7/8, factory 6/8, large_garbage 8/8) against 17
with the panels rule -- the rule costs build. Now it holds only with no garbage on the board, the case it was made for (pressure's
combo_storm-6 spent its panels before garbage reached it).
Measured (`073c8349`, runs 528 and 529, seed 1): build 22 (combo_storm 7/8, factory 8/8, large_garbage 7/8) -- build at 22 -- against
17 with the rule everywhere and 21 without it; pressure 19 (combo_storm 5/8, factory 8/8, large_garbage 6/8) against 21 and 18.
Measured (`7dc3b42c`, runs 530 and 531, seed 2): build 21 (combo_storm 8/8, factory 8/8, large_garbage 5/8) against 16, pressure 18
(combo_storm 8/8, factory 7/8, large_garbage 3/8) against 22. Build and pressure over both seeds: 80 with the rule off garbage, 76
with it everywhere -- it stays off garbage.
NEARER, IF THE ALLOWANCE AFFORDS IT: run 530's large_garbage-2 walked eight-swap lines toward a break through a slab's 170-frame pop,
chosen by the nearer-next-break key, and had 9 actions of the allowance left when the pop ended -- no break's walk. That key now
takes a nearer line only when its walk leaves a break's (BREAK_WALK 20 actions) in the allowance (rank.c).
Measured (`77b3b8b3`, runs 532 and 533, seed 2): pressure 21 against 18, build 17 against 21 -- 38 against 39. Seed 1 next.
Measured (`6a5231a3`, runs 534 and 535, seed 1): pressure 23 (combo_storm 7/8, factory 8/8, large_garbage 8/8) against 19, build 20
(combo_storm 6/8, factory 8/8, large_garbage 6/8) against 22. The allowance rule over both seeds: 81 against 80; it stays. Pressure
23 and 21; build 20 and 17.
THE ALLOWANCE'S RESERVE: run 533's factory-8 had 7 to 14 actions of the input allowance through its last 400 frames -- lines toward a
break and set-ups had walked it down -- and the break it found (18 cells) was carried 100 frames, pressed later at every decision,
and never made. Now of two lines lost alike, one that breaks nothing and walks the allowance below a break's walk ranks after one
that keeps it (rank.c, after key 3).
Measured (`8adc9abc`, runs 536 and 537, build): seed 2 17 against 17, seed 1 22 (combo_storm 6/8, factory 8/8, large_garbage 8/8)
against 20. It stays. Two of the losses are at 394 and 421, the first garbage on the opening raise.
Measured (`8adc9abc`+, runs 538 and 539, finish): seed 1 23 (combo_storm 8/8, factory 8/8, large_garbage 7/8) -- finish at 22 -- and
seed 2 21 (combo_storm 8/8, factory 8/8, large_garbage 5/8). Big chain on this build next.
Measured (`8adc9abc`+, runs 540 and 541, big chain): seed 1 22 (combo_storm 7/8, factory 8/8, large_garbage 7/8), seed 2 20. EVERY
MODE HAS REACHED 22 on this build's seeds: big chain 22, build 22 (537), finish 23 (538); pressure 23 on `6a5231a3` (534), measured on
this build next. Then every mode on one build, every change checked against all four.
Measured (`8adc9abc`+, runs 542 and 543, pressure): 22 and 22. EVERY MODE ON ONE BUILD (seed 1 / seed 2): big chain 22/20, build
22/17, finish 23/21, pressure 22/22 -- 169 of 192. The 23 losses: large_garbage 11, combo_storm 10, factory 2.
UNDER GARBAGE, THE PANELS KEPT: run 538's large_garbage-1 played clears through a slab's pops that bought 6 frames over the hold (236
against 230, 175 against 169) and took its panels from 19 to 7 -- the hold and the clear both outside the list, key 5 had nothing
to decide, and the nearer-next-break key took the clear. Now under garbage, of two lost alike, the one that spends no panels below the
floor comes first (rank.c, before the nearer-break key).
Measured (`0a952dc6`, runs 544-547, seed 1): big chain 23, build 20, finish 21, pressure 17 -- 81 against 89. Taken back (rank.c as at
`8adc9abc`). Pressure's combo_storm lost 4 of 8, three of them after frame 17900.
THE HORIZON 300: a line lives when its board is alive 240 frames on -- four seconds at level 11, where a line alive to 250 and one
alive to 600 are both "lives" and the list's keys, not survival, order them. Now 300 (outcome.c HORIZON).
Measured (`a5241725`, runs 548-551, seed 1, HORIZON 300): big chain 20, build 14, finish 19, pressure 20 -- 73 against 89. The
horizon decides a great deal; the other way next: HORIZON 200.
RANDOM SEEDS (the owner): every run plays new games -- the seed input's default is empty. The fixed-seed runs above measured the
same 24 games each time.
TWICE AS AGGRESSIVE (the owner, watching the fight: "still going for threes, which are worthless -- twice as aggressive"): every
mode's list now ends with every attack it can throw -- a chain of 2 or more, a combo of 4 or more (finish them: its own combos and
2-chain, then any combo of 4 or more and chain of 3 or more, before its three) -- so a line that throws ranks within the list, after
the mode's own aim and before the three that breaks (gambit-rules.json). Measured by the summary's blocks thrown a minute.
HORIZON 240 again, its runs cancelled: the aggression is measured alone.
Measured (`f80146c3`, runs 560-562, random seeds): big chain 20, build 17, finish 20; blocks thrown a minute 18.9, 19.4, 17.8 -- as
before (17-19). Under garbage -- 99% of training's decisions -- every entry asks a break, so an attack that leaves the garbage meets
none and ranks with the hold. THE ATTACKS UNDER GARBAGE: after the three that breaks, the mode's own entries again with no break
asked (rules.c withAttacks), so a board that lives throws rather than holds; breaks still first.
Measured (`7080a5de`, runs 564-567, random seeds): big chain 22, build 21, finish 20, pressure 20 -- survival held -- and 18.9, 19.0,
17.5, 19.4 blocks a minute: still as before. Between two breaks the material keys (6-7c) come before the list, and a three spends
fewer panels than a combo or a chain, so the three is played even where both lines live. TWO THAT LIVE: the list before the material
(rank.c 5a).
EVERY MOVE ON THE WAY, PRESSED THROUGH (the owner, watching the fight: big moves corner to corner, nothing done on the way): the fight
offered 2658 lines with a swap on the way and played 69 -- each pressed its way swap and then waited for the board to settle, so a
clear on the way put the line it led to off by that clear's time. Now each is offered pressed straight through too (propose.c
wayLines). NO WASTED THREE (the owner: "still wasting 3s for no reason"): of two lines that live, one whose clears break nothing and
throw nothing ranks after one that does not (rank.c 2a) -- 80 such decisions in the fight's 4781.
THE LINE THAT THROWS (the owner: "still randomly breaking 3s"): under garbage the three that breaks came before an attack that leaves
the garbage. Now of two lines that live, one that throws comes before one that throws nothing -- the three that breaks, a set-up, the
hold (rank.c 2b).
A LOW STACK RAISES (the owner: below six rows, raise high, if not topped; the break is held ready and made after it raises): the
floor's raise now asks for a stack under LOW_ROWS (6) rows of panels as well as below the material floor, not topped, raising toward
`raise.to` (11) -- and gives way to nothing (it gave way to any line that lived or broke, so in a fight it never raised). Its rows are
the ones that leave a break once everything lands (decide.c read, answer.c).
NO WASTED THREE, DYING TOO (the owner: "wasted 3s are the worst thing you can do"): where nothing lives, a three that breaks nothing
and throws nothing ranks after a line that wastes none, unless that line is lost within a break's time (rank.c 2a, neither lives).
NO WASTED THREE, EVER (the owner: "you shouldn't have to count the wasted, you just shouldn't allow"): a line whose clears break
nothing and throw nothing is dropped before it is ranked (rank.c, DROP_WASTE -- 'w' in the log's dropped counts); the rank keys that
ordered such lines last are gone.
A WASTED THREE ONLY TO STAY ALIVE (the owner: it should not die rather than take one -- it took them when it would not have died):
not dropped; it comes after every line that wastes none -- before the lives key -- unless that line is lost within a break's time
(rankSave): the horizon calling the hold lost 200 frames on is no reason to spend three panels (rank.c key 0).
NO WASTED THREE, NOT AN OPTION (the owner): a line whose clears break nothing and throw nothing is taken out of the order -- unless every
other line is lost before the next decision could make a break, when the three that saves the board is no waste (decide.c ranked,
'w' in the log's dropped counts). The rank key for it is gone.
Only topped out (the owner: "not allowed if not topped out, that's not a save"): the wasted three is let back only when the board is
topped and nothing else keeps it.
Measured (`d514b767`, runs 592-595, random seeds): big chain 19, build 20, finish 22, pressure 21 -- 82; 17.9-19.3 blocks a minute.
WASTED THREES COUNTED ON THE GAME, NOT THE PLAN: the frame loop counts every clear of three that broke no garbage and was no link of a
chain (front.c countAttacks, the match's moves.wasted; gambit_summary.js `wasted threes`) -- the number the owner wants at 0.
Measured (`079e0b86`, runs 596 and 597): finish 20, pressure 18; 9.2 and 10.0 wasted threes a minute on the game -- where 2 of a game's
984 decisions played a line the judge saw as one. The count now splits a swap's three (a panel a followed swap moved is in it) from
the stack's own (front.c, `wasted` and `wastedAlone`).
THE LOW RAISE INTO GARBAGE: the fight on `079e0b86` lost 26 of 26 in 22 minutes -- the low stack's raise, giving way to nothing, raised
rows the board lived through none of with garbage on its way, and the board topped out with 26-49 panels. With garbage on its way the
floor's raise now takes no more rows than the board lives through once it lands (decide.c read).
Topped, or about to be: 132 of that fight's decisions dropped a wasted three with nothing else living and the board not yet topped.
At one health a board that tops out is lost, so the three is let back when the hold is lost within a break's time too.
EVERY THREE IN THE LINE (the owner: fix the three problem): the judge took a line by its biggest clear, so a stray three beside a combo
passed. Now it counts each clear of three that breaks nothing and begins no chain, step by step, beyond the board left alone's
(judge.c threes), and a line with any is a wasted three (rank.c wastesThree) -- out of the order unless it is the save.
The fight on `ba9b51db`: 1 of 13, raising 4 rows with garbage ON the board (none on its way, so the cap did not hold). The floor's raise
now never takes the stack's top, garbage counted, up to the top row (decide.c read). Its wasted threes there: 15 a game, every one a
swap's (wastedAlone 0).
Measured (fight on `7fbcbd79`, 20 minutes, Gambit against the default on the fork's server at level 10): 2 won, 5 lost (1-12 and 0-26
before the raise was capped). 13 wasted threes over the run, every one a save -- nothing lived and the hold was lost within a break's
time; 1875 decisions dropped a wasted three.
Measured (`7fbcbd79`, runs 602-605, random seeds): big chain 24 (the first 24), build 20, finish 22, pressure 22 -- 88 of 96; 19.5-20.3
blocks a minute; 5.8-6.0 wasted threes a minute, every one a swap's -- where the decisions played 2 lines a game the judge saw as one.
THE FIRST SWAP'S THREE: run 606's wasted threes (GAMBITW) were each made 6 frames after the first swap of a line the judge took as an
attack -- a three now, a 2-chain 280 frames on: pressed straight through, the three falls in a step its later chain is counted in. Now
the first swap is settled alone too, and a three it makes for nothing makes the line a wasted three (judge.c).
Measured (`95df54f2`, run 607, factory, 8 games): 8/8, 21.9 blocks a minute, 6.5 wasted threes a minute -- the first-swap check missed:
under garbage the first swap's settle breaks the garbage already popping and runs the chain already falling, so a three of its own read
as part of them. Now the swap's threes are counted beyond the board left alone's, a break or a chain only when it is more than the
board's own (judge.c threesBeyond).
The game's wasted threes are real (run 609: 66 of 67 touched no garbage). The first swap's own clear is now read off the board, as the
frame loop counts it: the swap run 12 frames beside the board left alone, the panels it matched that the board did not -- three, none
beside garbage, its settle no longer a chain than the board's -- and that line is a wasted three (judge.c firstThree).
THE COUNT WAS WRONG: the frame loop booked a three as wasted the frame the chain counter read 0 -- before the panels it let fall made
their link (run 612, frame 1133: a three of 4s in column 1, its fall a three of 1s, the 2-chain the judge saw). A three is now counted,
and logged, once its clear and every panel falling from it have settled with no chain (front.c countAttacks). The 6 a minute were mostly
chains' first links.
Measured (`339bb3d9`, runs 613-616, random seeds, the count corrected): big chain 22, build 20, finish 23, pressure 22 -- 87 of 96; 20
blocks a minute; 0.77-1.00 wasted threes a minute (6 a minute was the miscount). Of 14 in three games: 4 from lines the judge saw as
lost (their threes were not read: now they are, rank.c wastesThree), 2 the save, 8 lines the judge saw none in.
Measured (fight on `339bb3d9`): 5 won, 6 lost against the default (6-6 before this round's raise and three changes; 0-26 and 1-12 while
the raise was uncapped).
THE PRESS GUARD (the owner: "why are threes still wasted"): the judge's word is a prediction, and where it is wrong a three gets through.
Now every swap about to be pressed is played first on a copy of the board as it is; one that makes a clear of three beside no garbage
whose fall makes no chain is not pressed -- the plan dropped, the next decision asked -- unless the board is topped out (front.c
wastedSwap; the summary's `swaps refused at the press`).
THE JUDGE READS CLEARS AS THE GAME COUNTS THEM (the owner: "fix the infra"): the engine now records, for each clear a step makes, whether
it is a chain's link (its panels fell from one) and whether garbage is joined to it (pa.c checkMatches, sLink and sTouch -- after the
board's bytes, no board changed). The judge's wasted three is the frame loop's own test a clear at a time: a three, no link, no garbage,
no link after it in the step -- where it read the step's chain counter, which a three made while the board's own chain falls shares.
Measured (`9ac440f5`, runs 625-627): big chain 21, build 23, finish 21; 0.58-0.75 wasted threes a minute, 6-11 swaps refused at the press.
Under garbage the board is topped with hundreds of frames of stop left, and "topped" let every three through. Now the save is only a
board lost within a break's time: the press guard lets a three through only topped with GUARD_SAVE (90) stop frames or fewer left, the
order only where the hold is lost within rankSave.
Measured (`9ac440f5`, run 628, pressure): 24 of 24 -- pressure's first 24 -- 0.55 wasted threes a minute. The fight there: 2 won, 5 lost.
A THREE ONLY WHERE NOT PLAYING IT LOSES THE BOARD (the owner). `12b4b919` let one through wherever the board left alone was lost
within 120 frames. Measured (runs 633-635): big chain 23, build 24, finish 19; 19.7 blocks a minute; but 1.4-2.2 wasted threes a
minute -- under garbage 99% of the time, the board left alone is nearly always lost. The fight there: 6 won, 4 lost against the
default, each side's log agreeing on every result.
Now (`05543891`) the press guard plays the board on both ways and lets a three through only when the board is lost without the swap
and alive with it (front.c savedByThree); the order keeps a three only when it lives and nothing else does, or all is lost and it is
lost a break's time (rankSave) later.
ON THE WAY (the owner: "going really far for moves"): 18 of 702 decisions in a fight played a line with work on its way. Now
(`fe49d86c`) wayLines also offers two useful swaps the cursor passes in turn, searches the way from three actions out, and no longer
counts a three for nothing as work; of two lines that live and both attack, one walking more than WALK_EARN (6) actions further loses.
Measured (`05543891`, runs 641-644): 0, 1, 2 and 0 of 24, 0.3-0.6 wasted threes a minute; the fight 2 won, 17 lost. Under garbage no
line is predicted to live, and a three that buys less than a break's time was dropped: reverted (`e5492043`). In a 12b4b919 game every
wasted three was the order's (w3 on the decision played), none the press guard's: lines that break garbage and make a three as well.
Measured (`fe49d86c`, runs 645-648, the walk alone): big chain 19, build 20, finish 22, pressure 22; 1.4-2.4 wasted threes a minute.
THE THREE TAKEN OUT (`e5c1638b`): the three best lines that waste a three are judged again with one swap left out at a time, so the
order has the same line without the three to keep in its place.
SELF-PLAY: each side calls a match from its own board -- lost when its own death comes before the other's -- so both sides can count a
loss when both boards die within the network's delay (13 of 38 on 05543891). Against another bot the logs agree on every result.
Measured (`e5c1638b`, runs 649-651): big chain 19, build 20, finish 21; 1.3-2.2 wasted threes a minute -- the three taken out changed
nothing. Of 47 wasted threes traced in six games, 37 were the order's own, played with every line predicted lost (32 within rankSave);
10 the judge did not see, let through by the press guard as the board left alone was lost. The fight there: 10 won, 6 lost.
`900b2b8a`: a three the plan did not see is pressed only when the board is lost without it and alive with it (the answer's `wastes`).
THE WALK WHEN NOTHING LIVES (the owner: "moving all over the board"): 94% of decisions have no line predicted to live, so the walk rule
for two that live seldom applied (15% of moves walked 6 cells or more). `d35d39cd`: two lost alike, both breaking or neither, are
ranked by the walk too (WALK_EARN). Runs on d35d39cd were dispatched, not yet read.
`d9245160`: GambitNative.lua's VIEW_FRESH is defined again (8e328efb dropped it; the live client on panelattack.com errored at its first
match).
Measured (`d35d39cd`, runs 657-660 -- the strict press guard of 900b2b8a and the walk for lines lost alike): 8, 7, 6 and 9 of 24;
75-116 swaps refused at the press a run. (`0cf136d2`, runs 661-662, on it): 16 and 12; 0.4-0.5 wasted threes a minute, 23-24 refused --
the order taking a three only where every other line is lost within rankSave. The walk rule reverted (`d69255a4`); `70ea377e` puts the
press guard back to the board lost without the swap. Both dispatched on all four modes (A: d69255a4, B: 70ea377e).
Measured (runs 665-672, each mode both ways): B `70ea377e` (the press guard lets a three through whenever the board is lost without it)
-- big chain 22, build 20, finish 19, pressure 21; 0.5-0.8 wasted threes a minute; 0-1 swaps refused a run. A `d69255a4` (a three the
plan did not see must also leave the board alive) -- 10, 14, 14, 11 of 23; 18-29 refused. A refused swap drops the plan, and dropped
plans under garbage are deaths: B stays. Against 12b4b919 the wasted threes fell from 1.4-2.2 a minute; what is left is the order's
save, every other line lost within rankSave.
Measured (`59ae4b9b`, runs 673-676: a three that buys a break's time kept however far off the loss): big chain 23, build 22, finish 20,
pressure 20 -- 85 of 96 to B's 82, within the noise -- with 0.9-1.2 wasted threes a minute to B's 0.5-0.8. Reverted to 0cf136d2's rule.
THE OPENING RAISE (run 676, combo_storm-3, lost at 376): raised to 48 panels as a slab landed, over lines lost 300 frames later. It now
has the floor raise's caps, and where nothing lives gives way to a line lost a break's time later than the hold (`1a67e26d`).
Measured (`1a67e26d`, runs 677-680): big chain 23, build 22, finish 17, pressure 21 (83 of 96); 0.50-0.58 wasted threes a minute.
THE INPUT RESERVE (run 680, factory-2, lost at 812): the game allows 76 actions in any 600 frames. Breaks and carries of 3-8 swaps took
the allowance from 33 to 1 in 250 frames; then 27 lines were cut for their walk and the board was lost. Now, where nothing lives, a line
that walks the allowance below BREAK_WALK loses to one that keeps it unless it is lost a break's time later (`a98fcad9`).
Measured (`a98fcad9`, runs 681-684): big chain 21, build 20, finish 19, pressure 19 (79 of 96); 0.54-0.60 wasted threes a minute.
No gain over 1a67e26d's 83: reverted (`7ba8a71b`).
THE MACHINE: in runs 677-684, most breaks the live search missed were found again in its own time (r678: 12 of 14) -- the runner's
four cores shared by four workers, the client and its software renderer. Measured with three workers (`9dccf512`, runs 685-688):
big chain 18, build 20, finish 23, pressure 22 (83 of 96, as with four); missed breaks 3 in 171 boards searched again, against 25.
Fewer misses, no more survival: the losses are elsewhere. Of ten traced on 1a67e26d, two spent the input allowance; the rest were
boards short of panels under garbage (large_garbage-8: 17 panels, no break, topped and so no raise) and lines cut for a swap not there.
Measured (`9b674af6`, runs 689-692: a three a save when every other line is lost within two breaks' time): big chain 21, build 23,
finish 17, pressure 21 (82 of 96); 0.7-0.9 wasted threes a minute. Reverted.
THE TURN, the last decision a break was there, in the losses of runs 677-688: mostly a break played, then none to make -- the board
spent of material under garbage, each line lost sooner than the last (combo_storm-5: 281, 237, 220 ... 59, 45 frames). Rule changes to
the order have stopped moving the total (79-85 of 96 since 12b4b919); what is left is the defence itself.
Measured (`6e09e4bf`, runs 693-696: of two lines lost within half a break's time, a row more material first): big chain 22, build
21, finish 19, pressure 19 (81 of 96); 0.51-0.58 wasted threes a minute. Reverted.
Measured (`c97fbb3c`, runs 697-700: the touch beam ten swaps deep, from eight): big chain 21, build 22, finish 21, pressure 21 (85 of
96, every mode 21 or more); 0.44-0.74 wasted threes a minute. Kept; twelve next.
Measured (`258dad7b`, runs 701-704: twelve deep): big chain 21, build 20, finish 23, pressure 22 (86 of 96); 0.46-0.65 wasted threes
a minute. Kept; the beam wider (TOUCH_BEAM 45) next.
Measured (`7339b7ad`, runs 705-708: the touch beam 45 wide, from 30): big chain 24, build 23, finish 21, pressure 22 (90 of 96 -- the
most yet); 0.59-0.65 wasted threes a minute. Kept; 60 wide next.
Measured (`eb5d0a9b`, runs 709-712: 60 wide): big chain 22, build 24, finish 21, pressure 21 (88 of 96); 0.53-0.64 wasted threes a
minute. Level with 45; kept. The wider beam (TOUCH_WIDE 150, from 100) next.
Measured (`aaee65b0`, runs 713-716: the wider pass 150, from 100): big chain 21, build 20, finish 21, pressure 22 (84 of 96); 0.62-0.74
wasted threes a minute. Reverted: the touch beam stands at 12 deep, 60 wide, its wider pass 100.
Measured (`04a8e7bd`, runs 717-720: the aimed line-up 12 wide, from 8): big chain 23, build 21, finish 24, pressure 23 (91 of 96 --
the most yet, finish's first 24); 0.44-0.64 wasted threes a minute. Kept; the line-up 10 deep next.
Measured (`7baf778b`, runs 721-724: the line-up 10 deep): big chain 24, build 17, finish 22, pressure 22 (85 of 96). Reverted; the
line-up 16 wide next.
Measured (`4df2894f`, runs 725-728: the line-up 16 wide): big chain 24, build 21, finish 22, pressure 21 (88 of 96). Reverted to 12
(`04a8e7bd`'s 91). The search now stands: touch beam 12 deep, 60 wide, wider pass 100; line-up 8 deep, 12 wide.
Measured (`e23514b2`, runs 729-732: the survival search 45 wide): big chain 22, build 23, finish 19, pressure 23 (87 of 96). Reverted.
Measured (`fd575ba0`, runs 733-736: the planner 60 wide): big chain 23, build 21, finish 21, pressure 21 (86 of 96). Reverted.
Of the search's widths and depths, two moved the total: the touch beam (8 to 12 deep, 30 to 45-60 wide: 83 to 88-90) and the line-up
(8 to 12 wide: 91). Wider still, deeper still, the survival search and the planner wider: 84-88, no better.
Measured (`a3a56192`, runs 737-740: touch beam 45 beside the line-up 12): big chain 22, build 22, finish 16, pressure 23 (83 of 96).
Reverted. Finish went 24 to 16 between two builds a beam width apart: one run of a mode on random seeds swings by up to eight games,
so the totals of runs 697-740 (83-91) do not tell the settings apart. Every mode at 24, twice, asks for a board that survives about 199
games in 200; the builds here survive about 9 in 10.
TWO AHEAD (`fda7e868`, runs 741-744): where nothing lives, each of the three best lines played to its end and the survival search
asked of the board it leaves; the line whose continuation is lost a break's time later first. Asked in 943 of 950 decisions of a
game. Big chain 24, build 21, finish 22, pressure 21 (88 of 96); 0.57-0.66 wasted threes a minute. No gain: reverted.
THE THREES LEFT (`04a8e7bd`, twelve games of runs 717-720): 36 wasted threes. 22 the order's own, every one with the board lost within
rankSave (the save the rule allows); 14 the judge did not see. Of those, one traced (factory-3, 15883): a 2-chain planned through a
slab popping (pop=232), its first link the three -- the colours the slab turned into were not the ones the judge played it with, the
chain did not follow, and the three stood alone. The colours a slab converts to are not shown until it pops: a line that needs them is
a guess, and the judge does not say so.
Measured (`f74f5421`, runs 745-748: a three starting a chain counted wasted while a colour is not shown): big chain 19 of 22, build 20,
finish 22, pressure 22; 0.47-0.62 wasted threes a minute -- no fewer. Reverted.
REAL GAMES (panel-game run 39702680320, Ranmaru_CPU live on panelattack.com, 3 hours): 31 matches, 17 won, 13 lost, 2 aborted
(desynced, clocks 1681 against 1435). The frame loop's board diverged from the game 482 times -- in training, never: 396 an incoming
piece the game had and the prediction had not yet received, 86 garbageCreatedCount a piece ahead. Each divergence drops the plan.
Measured against the decision before each: the game received the piece 6-8 frames before the prediction did (154 at 8, 57 at 6,
44 at 7). The cause: an opponent played here from its relayed keys runs behind this stack, and its transits are read against its own
stopWatch (front.c arrivalsOf: offset = mine - its), so every piece was predicted the frames it is behind too late. GambitNative.lua
now gives its stopWatch caught up (the frames behind added) -- nothing changes where the source keeps up (training, local play).
REAL GAMES, the rest: the two aborted matches are desyncs (this stack's clock 1681 against the opponent copy's 1435 -- the copy
246 frames behind); the other (match 23, 155 s) logged no desync, its board alive (stop 97) and its pace 0.37 frames off schedule
against 0.13 in the rest. Every one of the 13 losses ends on a board the frame loop has dead (stop 0, lost); every win with stop left.
THE DEATHS (351 losses of runs 657-748, the reports' last decisions): 176 broke garbage to the end and were lost anyway; 123 were short
of panels (24 or fewer) under garbage; 29 in the opening (before frame 1500); 23 found no break at all. Of the 2483 decisions made 30
or more frames before a loss, 993 played a line predicted to outlive the board by a break's time or more, or to live -- carries 283 of
464, breaks 227 of 330, entries 124 of 162 -- while holds and lines toward a break were predicted right (389 of 411, 302 of 321). The
lines that do something are the ones the prediction overrates; the frame loop never diverged in those games, so it is the judge's
horizon, not the board.
LINES PUT DOWN HALFWAY (runs 749-752, `3a0d69c8`, the log's seq=): of 5470 decisions that followed one playing a line of three or
more swaps, 59% carried it on (allowing a row's rise and a swap's timing), 39% switched to another line -- entry to entry 445, break
line to break line 270, break line to entry 182 -- and 3% held or raised. Each line was chosen on its forecast played whole; two in
five were put down at the next decision for a near-equal one. Now (1a, rank.c) the line in progress, judged again on the board as it
is, ranks before another of the same life unless the other is lost a break's time later or meets an earlier entry.
Measured (`3a0d69c8`, runs 749-752): big chain 22, build 21 of 23, finish 24, pressure 20.
Measured (`014e6f74`, runs 753-756, the line in progress kept): switches 39% to 27%; big chain 22, build 23, finish 22 of 23, pressure
20 (87 of 95); 0.65-0.83 wasted threes a minute. Of the switches left, 78% had no line in progress among the options at all -- the
carry turned it down (decide.c carriedCand): 48% dead once judged again (new garbage; a fair switch), 39% because the rest no longer
met the entry the line was begun for (the swaps pressed so far made part of it), 3% a break it no longer made. The last is now carried
on for no entry (carryDrop=5 in the log) and ranked as the line in progress.
Measured (`19ae0cec`, runs 757-760): switches 27% to 19%; big chain 23, build 21, finish 21, pressure 19 (84 of 96); 0.54-0.66 wasted
threes a minute. And the prediction: in the losses, lines played 30 or more frames out that outlived the board by a break's time or
more fell from 40% (runs 657-748) to 13%. The lines are played as judged now, and the board is lost where the judge said it would be:
what is left is a board with no line that lives -- the defence, not the infra.
THE POINT OF NO RETURN (the 12 losses of runs 757-760): at the last decision with a line that lives, every one played it (v=lives);
at the next, 15-40 frames on, none lived -- the garbage shown next (often landing 290-400 frames out) is what no line survives. "Lives"
is against the garbage shown; the board had no margin for the next. In large_garbage the board sits with 12-30 panels under the slabs
for thousands of frames, each break converting one row (broke=6) while the slabs come several rows tall: the breaks are a row at a
time and the garbage is not.
STOP TIME SPENT WAITING (the 12 losses' games, decisions under garbage with nothing that lives): with 60 or more frames of stop, 40%
were carry_wait -- the line in progress waiting for the board to settle before its next swap, mostly a slab converting -- and 24%
holds. Now, the board moving, the line in progress is offered pressed straight through as well, each swap as soon as the board lets
it, and the judge says which lives longer.
THE SURVIVAL BACKUP WAS NOT THERE (games of runs 753-760): of 19601 decisions with no line that lives, 92% had no survival line at all.
Two faults. The rank took the survival worker's line only while leftMs() > 0 -- the searches' time, always spent by the rank -- so a
line the worker had found was thrown away. And the survival job was the last of up to five handed to four threads, and a job no thread
has begun when the searches end is not begun at all (jobsDone). Now the worker's line is taken whenever it has finished, and the
survival job is handed out second, after the break search; the log's sv=1 when it finished, /asked when the rank asked it.
Measured (`3dcf4bfb`, runs 777-780, a three kept only when it lives and nothing else does): 2, 1, 3 and 6 of 24; 0.22-0.32 wasted
threes a minute, 0-10 played as saves. "Lives" is against the garbage shown, and nothing lives in 94% of the decisions of games the
board survives: the judge's verdict cannot say which three the board needs not to die, and a three that only buys time is what keeps
it alive until the next break. Reverted, with no-three-chosen (`3dcd7382`) and the rank's own time (`3d71201b`, runs 769-772: big
chain 21, build 17, finish 20, pressure 20 -- 78 of 96 to 84-87, 0.59-0.72 wasted threes a minute): main is c616fec3's Gambit.
THE SAVE ASKED (the owner: either it needs it not to die, or it is wasted): where the rule lets a three through -- every other line
lost within rankSave -- the best line that wastes one and the best that does not (the hold among them) are each played to the end and
the survival search asked of the board each leaves, garbage still on its way landing as it would. A three whose board, with the best
line on, outlasts the other's by less than half a break's time was not needed: it is dropped. In the decision's own time, SAVE_MS
(10) each at most, SAVE_KEEP_MS (4) kept; the log's saveAsk=not needed/asked.
Measured (`38da0132`, runs 781-784, the save asked): big chain 24, build 21, finish 22, pressure 20 (87 of 96); 0.44-0.64 wasted
threes a minute; of 42 saves asked in four games, none found not needed. The threes left are saves by the owner's rule, and the count
called them wasted. Now a three of a line the survival search found the board needed (saveOk) is counted saved, apart; the rest are
the wasted -- and the log gives both boards' loss (saveAsk=not/asked:with/without).
Measured (`453a3bc3`, runs 785-788): big chain 23, build 22, finish 20, pressure 18 (83 of 96); 0.45-0.57 wasted threes a minute, 0-6
saves confirmed a run. Of 42 saves asked, 34 could not finish the side without a three (no time left). Of 37 wasted threes in twelve
games, 26 the order's (carries 12, breaks 8, the survival line 5), 11 the judge did not see. The side without a three is now the
survival search's own line from now when it wastes none -- searched on its worker already -- and the decision's time goes to the
three's side.
THE THREES THE JUDGE DID NOT SEE (35 in the games of runs 717-788): 18 on a still board, the swap pressed within 30 frames of its
decision -- not a guess. Traced (785, factory-3, 13524): a three planned as a 2-chain's first link (chain=2); at the next decision,
the chain falling (casc=1), a break line lost at 353 was played through its column, the chain was cut, and the three stood alone.
Where nothing lives the board's own chain was kept only between lines lost alike. Now (1b) a line that cuts it ranks after one that
keeps it, unless keeping it loses the board within rankSave.
Measured (`e1987b02`, runs 789-792): big chain 21, build 21, finish 21, pressure 20 (83 of 96); 0.36-0.60 wasted threes a minute.
(`32bc7f2f`, runs 793-796, the board's own chain kept): 22, 17, 21, 23 (83 of 96); 0.47-0.64. Of 34 wasted threes in twelve of its
games 27 were the order's saves and 7 the judge's misses (35 of 35 sampled before were misses, 17 a chain cut by a later swap) -- the
misses are mostly gone; the saves are left. Of 142 saves asked, 51 confirmed needed, 6 found not needed, 85 without an answer: the
three's side not searched in 34, the other in 51. Now the three's side is searched first with the time, the other bounded below by
what is known (the best line's own loss, the survival line's) and searched only when the bound does not settle it.
