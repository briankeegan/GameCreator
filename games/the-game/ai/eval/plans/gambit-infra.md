# Gambit's infra: several things at once, every move on the way, every core

What it is for: `plans/gambit-goal.md` -- survival, every move on the way, several chains or combos built at once and fired
together. Each piece below is infra the one decision reads; none is a rule of its own. Built in this order, each measured by a
24-game run of every mode before the next.

## Where it stands

- One decision at a time, made from scratch: the searches (planner, break search, extension) run one after another on one thread,
  sharing the decision's time, and their lines are judged one after another. Nothing from the last decision is kept but the line in
  progress (the carry).
- One line is followed at a time. A second chain or combo is never built beside the first.
- The cursor's walk counts only as the time it takes and as the last key of the order.
- The game runs on one core and Gambit on one more; a 4-core runner leaves two idle.

## 1. Every core (threads)

How chess engines do it (lazy SMP): several threads search the same position at once and share one table of positions already
judged; the shared table is what makes the extra threads pay.

- A pool of worker threads beside Gambit's own (one per spare core; `GC_GAMBIT_CPUS` already pins Gambit off the game's core).
- The judging is the first to go parallel: each candidate's outcome is an independent engine playout, so N workers judge N lines at
  once. The outcome cache (`outcome.c` cached) becomes the shared table, keyed by the line and the board.
- Then the searches as a portfolio: the planner, the break search and the extension each on their own thread for the whole decision
  rather than a share of it each.
- The engine already has a threaded build (`eval/native/search.h` THREADS, per-thread pools in `memory.h`).

Measured: candidates judged a decision, the searches' depth reached, think ms -- with every decision's answer the same as on one
thread when given the same work (the replay's check).

## 2. Several things at once (intentions)

How agents that pursue several goals do it (BDI intention interleaving; Yao & Logan pick which intention to advance each step): each
goal is kept as an intention, with its own plan and progress, and each step chooses which intention to advance.

- An INTENTION: a goal the board is on its way to -- a chain being built (its trigger and its links), a combo made ready, a break
  under garbage, a setup -- with its swaps, the cells it needs left alone, the frame its window closes (a falling panel's, a block's
  landing), and what it is worth (blocks thrown, garbage broken, the board's life).
- Kept across decisions: re-checked on the engine against the board the game made (the truth holds, so the boards are the same), kept
  while it still makes what it said, dropped when done or spoiled. The carry is one intention; there can be several.
- The proposers add intentions as they find them (the planner's entries, a chain begun, the break search's breaks, the setups).
- Two intentions that need the same cells conflict; one that leaves panels another needs is a synergy. Both are read off the cells
  each needs.

## 3. Every move on the way (the schedule)

How routing does it (the orienteering problem, prize-collecting routing with time windows): a vehicle with limited time visits the
stops worth the most, each within its window, along the shortest route.

- A decision's line is a SCHEDULE: the swaps of several intentions interleaved, in the order the cursor reaches them, each before its
  window closes. The cursor's walk is the route; an intention's swaps are its stops.
- Solved exactly for a few intentions (every order of up to six stops, as `rank.c` judgeWalked walks a line now), nearest-next past
  that; each schedule is judged whole on the engine like any line, and ranked in the one order.
- On the route, the swaps that set up (4) fill the walk: a cell the cursor passes anyway is a free stop.
- Measured: cells walked a minute, the share of swaps that clear, break or set up, and the jumps of six or more.

## 4. How near the board is to what it needs (cheap shape math)

How Puyo bots do it: chain potential -- for each place a piece could go, the chain it would set off, found by simulating -- so a
board is valued by the chains it is a few moves from, not only the ones it has.

- On the bitboard (`search/bits.c`): for each swap, what it sets off (the trigger map); the swaps to the nearest break
  (`search/break.c` nearOf, already there); how connected the colours are (`search/plan.c` connectedOf, already there); how far the
  board is from each entry the list asks for (the planner's lead, already there).
- These value a setup: a swap on the route that brings a chain, a combo or a break nearer is a stop worth making.

## 5. The search kept between decisions (warm start)

How model predictive control does it: plan over a horizon, play the first step, keep the plan, and start the next one from it.

- The planner's beam and the intentions' lines are kept, re-rooted at the board the game made, and searched further, rather than
  thrown away each decision.
- Measured: the depth the planner reaches, the decisions the clock cuts.

## Sources

- [Applying Artificial Intelligence to Famicom Puyo Puyo](https://meatfighter.com/puyopuyoai/) -- lookahead over placements, each
  board scored.
- [Puyo Nexus: Hardest Puyo Puyo AI](https://puyonexus-staging.com/forum/viewtopic.php?p=67884) -- pattern matching with depth search.
- [Hanson & Moffat, Monte Carlo search for Puyo-Puyo](https://www.doc.gold.ac.uk/aisb50/AISB50-S02/AISB50-S2-Hanson-paper.pdf).
- [Logan, intention recognition and progression](https://wesaac2024.unb.br/wp-content/uploads/2024/08/Brian-Logan-Multi-Agent-Intention-Recognition-and-Progression.pdf)
  -- interleaving intentions, conflicts and synergies.
- [Intention progression with temporally extended goals (IJCAI 2024)](https://object.cloud.sdsc.edu/v1/AUTH_da4962d3368042ac8337e2dfdd3e7bf3/ml-papers-txt/IJCAI/2024/intention_progression_with_temporally_extended_goals__0842aa0d.txt).
- [Heuristic search for Tetris](https://uni-klu.academia.edu/GiacomoDaCol) -- how much search pays beyond the evaluation.
