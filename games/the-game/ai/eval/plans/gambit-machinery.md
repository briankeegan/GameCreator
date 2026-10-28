# Gambit's machinery: every core searching, every frame

The rule: **no core sits idle while a search has more to find, every answer arrives in time for its move, and the compute is the live
game's.** The answer's deadline bounds the decision, not the search: searches run on, and every decision takes what they have found
so far. This is `gambit-infra.md` E (every core) and F (one plan, kept and repaired) made concrete for the searches.

## Where it stands

- The runner has 4 cores; `gambit-24.yml` runs 4 workers (`GC_GAMBIT_WORKERS`, default 4) beside Gambit's thread and the game's.
- A decision has the frames to its move, about 18 (300 ms), on the work clock (`core/clock.h` `WORK_PER_MS` 600, measured at run 1055;
  decisions of 20 ms or more on runs 1389-1390 ran 760-897 frames a wall ms at the median).
- The searches' jobs (`answer.c` `breakBegin`: the break search, its wider beam, the survival search, the board to come, the planner's
  half, the extension, the flatten search) begin with the decision and are taken back at the searches' end (`propose.c`
  `searchesEnd`, three quarters of the decision). The judging is spread over the workers (`decide.c` `judgeJob`); the readiness
  checks run past the decision until the next takes the pool back (`readySpread`, `readyStop`).
- Ideas are handed on once a decision: the break, plan, landed and survive frontiers are kept keyed by board (`search/frontier.c`)
  and the next decision's searches grow them on.
- The clock cuts the break search in most decisions: 557 of 895 in factory-1 (run 1393). factory-1's break at 14034 (run 1390) takes
  300k frames of work; the decision had 180k.
- The machine (`cpu_watch.sh`, every game's `results.txt`; run 1400, factory-6, 189 s): Gambit's thread 0.82 of a CPU, each of the
  four workers 0.31-0.32, the game 0.17, the machine 42% idle of 4 CPUs. The runner's 4 CPUs are 2 cores: the game on CPU 0, Gambit's
  thread on the other core, the workers on the two CPUs left -- each the other hyperthread of a busy core -- at the idle class
  (`host.c` `workerStart`: at the normal class they took cycles from Gambit's thread and the game's, and lost games). The workers use
  1.25 of their 2 CPUs; what standing searches can add is the rest, about 0.75 of a hyperthread -- some 1.6x the workers' search, not
  a multiple.

## The design: standing searches

- **A search that keeps a frontier stands.** The break search (narrow and wide), the board to come and the survival search each run
  on a worker of their own for the whole game, not for a decision. Each grows its frontier on the newest board the frame loop has --
  the board predicted for the next question's frame, which the truth holds -- and keeps growing it until the board moves on.
- **A decision takes a snapshot.** At its searches' end it reads what each standing search has found -- the lines, as the resumed
  frontier is read now -- and judges and ranks them with the rest. The searches go on; the decision never waits for them.
- **The board moving on re-roots them.** A swap pressed, a line followed, a block landing: the frontier is carried onto the new board
  by the keys it already has (`frontierResumeKeyed`, the anchor panel). A board that differs from the one predicted, garbage not
  foreseen, a colour shown: the lines that no longer hold are let go, as now.
- **The decision's own work comes first.** When a decision spreads its judging (`startJobs`), a standing search yields its worker for
  the judging and takes it back after. No answer is later than it is now.

## The budget: the live game's compute

- **Each worker: one frame of compute a game frame.** A standing search does at most `WORK_PER_MS` x one frame's ms of engine work
  for each frame the game plays, counted on the work clock as every search is. In lockstep the game waits on Gambit, so without the
  cap a worker would search for as long as the game waits -- compute the live game does not have.
- **Lockstep stays the seed's.** Each frame the frame loop hands every standing search exactly its frame's work, in a fixed order, so
  the same build plays the same games.
- **Live, the cap is the wall.** Off lockstep the worker runs on the wall clock; a frame's work is what a core does in a frame.

## Steps, each with its check

1. **Measure the machine.** (The per-thread CPU is measured already, above; what is left is reporting it per run.) At each game's end, each worker's CPU time (`hostThreadStats`) and the wall time, and for each search the
   share of decisions its clock cut; `gambit_summary.js` writes them per pattern ("the machine: Gambit's thread N%, workers a/b/c/d%,
   the break search cut in K% of decisions"). Check: the line is in every 24-game report (`gambit_summary.js` fails without it).
2. **The work clock at the runner's speed.** `WORK_PER_MS` from step 1's numbers, the measurement recorded beside it.
3. **The break search stands** (narrow and wide), the decision reading its snapshot. Checks: a C check that the snapshot read after W
   frames of standing work equals what the search finds in W frames begun from the same board; `test` "the line pressed as judged"
   and "the truth" still hold; the per-frame cap never exceeded (counted, red when it is).
4. **The board to come and the survival search stand**, the same checks.
5. **The judging and the readiness take workers first** (step 3's yield). Check: the answers' lateness (`late`, `pastFrame` in the
   stats) no higher than the build before.
6. **Measured on the 24**: survived per pattern, the searches the clock cut, each worker's busy share -- against the build before.

- **Search efficiency beside it**: on two cores, the lines found per engine frame weigh as much as the frames: the break search's
  cost per line (`search/break.c` touch beam: boards built, lines judged twice) measured before the frames are added.

## What could go wrong

- Memory: each standing search keeps its own node store across frames; the store's high water is logged and capped.
- Staleness: a frontier grown on a board the game no longer reaches is let go by the same keys that carry it.
- Determinism: anything a standing search reads must be the frame loop's, handed over at the frame, never the decision thread's
  state as it happens to be.
