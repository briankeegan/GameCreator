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

## Build order

1. E, the threads: no behaviour of its own -- the same decisions, searched deeper in the same time.
2. A and B together, intentions and the route, with the carry as the first intention.
3. C, waiting filled.
4. D, the shape math feeding B's setup stops.

Measured each time: survival per pattern, blocks thrown a minute, cells walked a minute, the share of swaps that clear, break or set
up, intentions held at once, think ms and the decisions the clock cuts.

## Sources

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
