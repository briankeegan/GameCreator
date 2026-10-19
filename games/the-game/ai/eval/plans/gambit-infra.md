# Gambit's infra: several things at once, every move on the way, every core

What it is for: `plans/gambit-goal.md` -- survival, every move on the way, several chains or combos built at once and fired
together. A mode stays only its list (its priorities); everything here is infra the one decision reads. Nothing is built until this
design is agreed; then each piece is built and measured by a 24-game run of every mode before the next.

## Where it stands

- Each decision starts from scratch: the planner, the break search and the extension run one after another on one thread, sharing
  the decision's time, and their lines are judged one after another. Only the line in progress (the carry) is kept.
- One line is followed at a time. A second chain or combo is never built beside the first.
- The cursor's walk counts only as time and as the order's last key; nothing is done on the way.
- The game runs on one core and Gambit on one more: a 4-core runner leaves two idle. The engine's phase runner (`eval/native/search.h`
  runPhase, `ns_advance_many`) already steps a batch on several threads in the JS host; natively it has no workers.
- Panel Attack's own CPU (`panel-game/common/engine/computerPlayers`) is an interface and a DummyCpu: nothing to borrow.

## The questions that shape it

1. A hard deadline every decision (about 200 ms), and a perfect simulator (the engine; the truth holds).
2. One worker that moves (the cursor), and moving costs time.
3. Several goals at once (chains, combos, breaks, setups), each with a window (a falling panel, a block landing).
4. New work arriving all the time (garbage sent, panels risen), told as it is sent, never before.
5. Each decision should build on the last, not start again.
6. Time spent waiting (a chain falling, a pop) that other work could fill.
7. Cores left idle.

## Who else answers them

| question | field | how they do it |
|---|---|---|
| 2, 3, 4 | dynamic vehicle routing, warehouse order picking | a route of stops with time windows, kept; a new request is INSERTED where it adds the least travel and keeps every window; the route is improved a little at a time (adaptive large neighbourhood search: remove a few stops, reinsert them better) on a rolling horizon |
| 5 | robot path replanning (D* Lite, anytime D*), model predictive control | keep the last solution; when the world changes, repair only what the change touched; play the first step of the plan and plan on from the rest |
| 6 | compilers (list scheduling) | a dependence graph of what must wait for what; while one instruction's latency runs, issue independent ones; priority to the critical path (least slack) |
| 3 | agents with several goals (BDI intention interleaving) | each goal an intention with its own plan; each step chooses which intention to advance; conflicts and synergies read off what each needs |
| 7 | chess engines (lazy SMP) | every thread searches the same position, sharing one table of positions already judged; the gain is a deeper search in the same time |
| 1, 3 | Puyo and Tetris bots | an exact simulator, a beam over moves, a transposition table, and chain potential: how far the board is from the chains it could set off |

## The design

### A. Intentions (the requests)

An INTENTION is a goal the board is on its way to: a chain being built, a combo made ready, a break under garbage, a setup. Each
carries its swaps (its stops), the cells it needs left alone, the frame its window closes, and what it makes (the engine's count:
blocks thrown, garbage broken, the board's life after). The proposers that exist now (planner entries, chains begun, the break
search, ready, setups) become sources of intentions. Intentions are kept across decisions and re-checked like D* Lite repairs: only
an intention whose cells the game changed is judged again; one that no longer makes what it said is dropped. The carry becomes one
intention among several.

### B. The route (the schedule)

The decision's line is a ROUTE through the stops of several intentions, in the order the cursor reaches them, each before its window
closes. It is kept between decisions (the rolling horizon): the first stop is played, the rest stays. Each decision:

1. insert the new intentions' stops where they add the least walk and keep every window (insertion);
2. improve it while time is left: take a few stops out and put them back better (large neighbourhood search), or swap the order of
   two (every order for six stops or fewer, as `rank.c` judgeWalked does for one line now);
3. each candidate route is judged whole on the engine and ranked in the one order, the hold and the bare lines beside it.

A cell the cursor passes anyway is a free stop: a swap there that sets up (D) costs no walk.

### C. Waiting filled (the dependence graph)

While a chain falls or a slab pops, the cells it will move are taken; a swap that touches none of them is independent and can be
made meanwhile (list scheduling). The route's stops are ordered by slack: the one whose window closes soonest, first.

### D. How near the board is to what it needs (cheap shape math)

On the bitboard (`search/bits.c`), for each swap: what it sets off (the trigger map, a chain's potential as Puyo bots measure it); the
swaps to the nearest break (`search/break.c` nearOf); how connected the colours are (`search/plan.c` connectedOf); how far the board
is from each entry the list asks for (the planner's lead). These value a setup stop, and say which intentions are worth keeping.

### E. Every core (the shared table)

Worker threads on the spare cores, sharing one table of lines already judged (the outcome cache, keyed by the board and the line):

- first the planner's levels (each a batch of independent steps: the phase runner already does it);
- then the judging (each candidate route an independent playout);
- then the searches as a portfolio, each on its own thread for the whole decision.

The same answer as one thread when given the same work, checked by the replay.

### F. One plan, kept and repaired (incremental replanning) -- the backbone

How robots that move while they plan do it (LPA*, D* Lite, anytime D*, time-bounded A*), and how planners keep a plan stable (plan
repair over replanning): the search is never thrown away; a change is repaired where it touched; the agent acts on the best plan so
far while the search goes on.

- WHAT CHANGES IS KNOWN EXACTLY. The engine predicts every frame and the truth holds, so between decisions the plan's own board is the
  game's. Only new information changes anything: garbage newly sent (the telegraph), the colours of a row as it rises, and the swap
  just played. With none of it, the plan is still exactly right -- D* Lite with no edge changed -- and the search simply goes deeper
  from where it was.
- THE PLAN IS KEPT. The route (B) and its intentions (A), and the planner's frontier, re-rooted at the board the played swap leads
  to, as Monte Carlo tree search keeps the subtree under the move it played and time-bounded A* keeps one search running across
  steps.
- A CHANGE IS REPAIRED WHERE IT TOUCHED. A block sent changes when the board is lost and the windows after it lands: the route and the
  intentions are judged again from that frame, lines finished before it keep their outcome (the cache keyed by the board and the
  line). A row risen touches the cells at the bottom: an intention that needs none of them keeps. Repair stops once the order is
  settled (truncated D*: no more work than the answer needs).
- STABLE. Of two repaired plans that rank alike, the one nearer the old (fewer stops changed, less walk) -- a plan that does not
  thrash is one the cursor does not swing for. Measured: stops changed a decision, jumps of six or more.
- ANYTIME AND CONTINUOUS. The answer is always ready (the kept route's next stop); the time left improves it (anytime repairing A*).
  The planning runs between questions too, on its own thread, so a question is answered from a plan already made, never from a cold
  start.
- NEVER TRAPPED BY ITS OWN PLAN. A warm start misleads after a sharp change (the MPC warm-start papers): every decision also has the
  proposers' fresh lines beside the repaired plan, all ranked in the one order, so a large block sent cannot hold the board to a plan
  made before it.

### E, measured (`build.sh test speed`: 60 questions, each the wall clock's 150 ms, 4 cores)

The workers are in (`native.c` gn_setup, `host.c` hostWorkers; GC_GAMBIT_WORKERS, else the cores less two), and the planner's
levels, the break search's beam (its swaps and the settles that score it) and the survival search's levels are stepped on them all
and taken in order (`core/nodes.h` stepBatch / stepTake): the same answers with 3 workers as with none, on the replay's work clock.
The engine work a decision does: 165k frames with none, 176k with 3 -- 7%. A profile says why: 77% of a decision is the judge, and
72% is one call, the readiness check (`judge.c` breaksAfterLanding), which runs a whole break search on each candidate's landed board,
one candidate after another. Batching the steps inside a search cannot reach it. What can: whole candidates judged on their own
threads (the break search made reentrant: its state a thread's own), and the searches as a portfolio -- coarse-grained, as lazy SMP
is. That is E's next step, and it comes with F: a kept plan asks readiness of the few lines that changed, not of every line again.

In the game's own process the workers took the client down after its first decision (runs 362-365: every game "no result", the log
ending after one GAMBITD line with `GAMBIT workers 2`); the C checks, with no game beside them, pass with them. The workers are off
unless GC_GAMBIT_WORKERS is set (gambit-24.yml's `workers`). The cause found: the game's thread makes its keys with engine steps
(`front.c` keyCtx) as the engine's thread 0 -- Gambit's own, the pool the workers' phases hand boards out of. The game's thread is now
the engine's last (`native.c` gn_setup), its own pool.

### F, its first piece: the breaks already found, kept (`search/break.c` readyKept)

The readiness check -- 72% of a decision -- asks the break search of each line's landed board. The board a line lands on next decision
is the same board whenever nothing new was told, so a break found on it is kept, keyed by the whole board as it plays on, the blocks
still on their way, the hold and the press; a board that differs anywhere is searched afresh. Only a break found is kept. The log's
`rdy=hit/asked`, the summary's "kept plan".
Measured (`e19b1870`, runs 366-369): 80 of 96 against 70; 9% of the checks answered by a break already found.

### A and B, built: the intentions and the route (`decide.c` keepIntents, keptJudged, routeJudged)

Each decision keeps up to four of its best lines that make something (a clear, a chain, a combo, a break) besides the one it plays, each
with a bottom-row panel it does not touch; the next decision finds each again by it and judges it on the engine like any line. And of
the lines ranked, the best four that make something and are pressed settled are made into routes two at a time when they touch columns
apart (one's clears cannot move the other's panels): one line, in walking order, judged whole and ranked with the rest. Logged as
`kept=N[/played]` and `route=N[/played]`.
Measured (`c9638fca`, runs 370-373): 68 of 96 against 80. Every option added is one more readiness check
splitting the same time, so each break search got less. A line judged already this decision is not judged again (`judgedHas`), and
the time is split over the options still to be asked, not over every option ranked.

### B and D, built: work on the way, and the nearer line (`propose.c` wayLines, `rank.c` key 8b)

A settled line whose first swap is four or more cursor actions away is offered again with a swap made first on a cell the cursor
passes anyway (a step aside at most) that does something: it clears, or it brings the nearest break nearer (under garbage), or it joins
the colours (the planner's connectedness). Only the swaps on some line's way are stepped, on every thread. And of two lines that meet
the same entry of the list, the one the cursor walks less comes first: a far line earns its walk. Logged as `way=N[/played]`.

## Build order

1. E, the threads: no behaviour of its own -- the same decisions, searched deeper in the same time.
2. F with A and B: the kept plan (intentions and the route, the carry the first intention), repaired on new information only,
   planned on between questions.
3. C, waiting filled.
4. D, the shape math feeding B's setup stops.

Measured each time: survival per pattern, blocks thrown a minute, cells walked a minute, the share of swaps that clear, break or set
up, intentions held at once, think ms and the decisions the clock cuts.

## Sources

- [Lifelong Planning A*](https://en.wikipedia.org/wiki/Lifelong_Planning_A*) and [D* Lite (Koenig & Likhachev, AAAI 2002)](https://cse-robotics.engr.tamu.edu/dshell/cs625/aaai02b.pdf)
- [Anytime Dynamic A* (Likhachev et al.)](https://www.ri.cmu.edu/publications/anytime-dynamic-a-an-anytime-replanning-algorithm) -- used by the 2007 DARPA Urban Challenge winner
- [Plan stability: replanning versus plan repair (Fox et al., ICAPS 2006)](https://strathprints.strath.ac.uk/2776/) and [optimising stability in plan repair (ICAPS 2022)](https://ojs.aaai.org/index.php/ICAPS/article/view/19815)
- [Time-bounded A* (Björnsson, Bulitko, Sturtevant)](https://www.cs.du.edu/~sturtevant/papers/TBA.pdf) and [RTAA* (Koenig & Likhachev)](https://www.eecs.ucf.edu/~gitars/cap6671/Papers/rtaa_aamas06.pdf)
- [Tree reuse in real-time MCTS](https://arxiv.org/pdf/2407.03049)
- [Warm starts mislead after sharp changes (MPC)](https://arxiv.org/pdf/2310.02918)
- [Anytime incremental planning with experience graphs](https://www.ri.cmu.edu/publications/anytime-incremental-planning-with-e-graphs)

- [Insertion heuristics for dynamic vehicle routing](https://optimization-online.org/2022/11/insertion-heuristics-for-a-class-of-dynamic-vehicle-routing-problems/)
- [Asynchronous adaptive large neighbourhood search for dynamic routing](https://portal.fis.tum.de/en/publications/asynchronous-adaptive-large-neighborhood-search-algorithm-for-dyn/)
- [Rolling horizon routing (hEART 2019)](https://transp-or.epfl.ch/heart/2019/abstracts/hEART_2019_paper_121.pdf)
- [The time-window strategy in online order batching](https://grafo.etsii.urjc.es/en/publication/gil-borr-s-2023/)
- [Truncated incremental search (D* Lite family)](https://ojs.aaai.org/index.php/SOCS/article/download/18295/18086)
- [List scheduling (JMU CS432)](https://w3.cs.jmu.edu/lam2mo/cs432_2023_01/files/14-list_scheduling.pdf)
- [Lazy SMP (chessprogramming)](https://www.chessprogramming.org/Special:MobileDiff/23086) and
  [a full-engine measurement (Oslo thesis)](https://www.duo.uio.no/bitstream/handle/10852/53769/master.pdf)
- [Logan, intention progression](https://wesaac2024.unb.br/wp-content/uploads/2024/08/Brian-Logan-Multi-Agent-Intention-Recognition-and-Progression.pdf)
- [ama, a Puyo bot: beam search, transposition table, chain detection](https://github.com/citrus610/ama)
- [Applying AI to Famicom Puyo Puyo](https://meatfighter.com/puyopuyoai/)
- [Hanson & Moffat, Monte Carlo search for Puyo-Puyo](https://www.doc.gold.ac.uk/aisb50/AISB50-S02/AISB50-S2-Hanson-paper.pdf)
