# Gambit's machinery: the searches go on between decisions

The rule: **the workers search whenever Gambit's own thread does not need the machine, and never when it does.** A decision runs
exactly as it does now; between its answer and the next question, the searches that keep a frontier go on growing it, and the next
decision begins from there. This is `gambit-infra.md` E (every core) and F (one plan, kept and repaired) made concrete for the gap
between decisions.

## Where it stands

- The runner's 4 CPUs are 2 cores. The game runs on CPU 0, Gambit's thread alone on the other core, the four workers on the two CPUs
  left -- each the other hyperthread of a busy core -- at the idle class (`host.c` `workerStart`: at the normal class they took cycles
  from Gambit's thread and the game's, and lost games).
- Measured (`cpu_watch.sh`, every game's `results.txt`; run 1400, factory-6, 189 s): Gambit's thread 0.82 of a CPU, each worker
  0.31-0.32, the game 0.17, the machine 42% idle.
- A decision has the frames to its move, about 18 (300 ms), on the work clock (`core/clock.h` `WORK_PER_MS`). Its jobs (`answer.c`
  `breakBegin`) begin with it and are taken back at the searches' end (`propose.c` `searchesEnd`); the judging is spread over the
  workers (`decide.c` `judgeJob`); the readiness checks already run past the decision until the next one takes the pool back
  (`readySpread`, `readyStop`) -- the pattern this plan extends.
- Ideas are handed on once a decision: the break, plan, landed and survive frontiers are kept keyed by board (`search/frontier.c`)
  and the next decision's searches grow them on.
- The clock cuts the break search in most decisions: 557 of 895 in factory-1 (run 1393). factory-1's break at 14034 (run 1390) takes
  300k frames of work; the decision had 180k.

## The rules every step keeps

1. **Gambit's thread is never slowed.** The work added runs only while Gambit's thread is waiting for its next question: a decision
   begins by taking the pool back (as `readyStop` does) before it does anything else, and runs from there exactly as it does now. A
   hyperthread beside Gambit's is busy only while Gambit's thread is not.
2. **Nothing new is played unjudged.** What the work between decisions finds goes to the next decision as its searches' seeds (the
   resumed frontier, as now): every line is still judged on the engine before it is played.
3. **The game stays its seed's.** In lockstep the work between decisions is a fixed amount a frame -- one frame's ms at `WORK_PER_MS`
   for each worker -- and the frame loop waits for it, so the same build plays the same games. Live, it is whatever the wall gives
   in the gap, which is the machine's own.
4. **Nothing is shared while it is being written.** The frontier is handed over at the next decision's start, once the work is
   stopped, as `readyStop` hands the readiness over now.
5. **Memory is bounded.** The work keeps its own node store, capped; its high water is logged.
6. **A step is kept only if the 24 holds what the build before held** (22 now), and its checks hold.

## Steps, each with its check

1. **Report the machine every run.** Per pattern: each thread's share of a CPU (`results.txt`'s `cpu over` line), Gambit's own engine
   frames per wall ms (each decision's `work` over its `wallMs`), and the share of decisions whose break search the clock cut.
   Check: the lines are in every 24-game report.
2. **The break search goes on between decisions.** Once a decision answers, its break search's frontier goes on growing on the
   board the answer leaves -- the board the frame loop predicts for the next question -- on the workers, until the next decision
   takes the pool back and resumes from it. Checks: Gambit's own frames per wall ms (step 1) no lower than the build before, beyond
   the runs' spread; a C check that the frontier handed over after W frames of work is the one W frames of search grow; `test`'s
   "the line pressed as judged" and "the truth" hold; `build.sh tsan` clean.
3. **The board to come and the survival search go on the same way**, the same checks.
4. **The live clock.** A `gambit-paced` 24 (the wall clock, no lockstep): the answers late and past their frame no more than the build
   before -- the test that rule 1 holds where it matters.

## What it buys, and what it does not

- The gap between decisions is Gambit's thread's idle share, about 18% of the game; the workers' two CPUs in that gap are about a
  third of a CPU more search, all of it on boards the next decision searches anyway -- the break search's frontier deeper at every
  decision that follows one.
- During a decision nothing changes: the extra search never competes with the decision's own work.
