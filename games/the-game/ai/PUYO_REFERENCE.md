# What successful Puyo Puyo AIs measure

Reference notes for building Puzzle Attack's next bot. We are starting from
Puyo's ideas rather than inventing a feature vocabulary from nothing, so this
records what the AIs that actually work measure, how they combine it, and
which parts are worth copying.

Puyo is the right game to copy from — not Tetris. Tetris is unusually
greedy-friendly: a board that looks good is good, so a static scorer with no
lookahead reaches ~35 million lines. Puyo is not like that. Its whole game is
**setup with deferred payoff** — twenty placements that each look worthless,
building toward one cascade. That is the shape Puzzle Attack has too.

---

## Tier 1 — the emergent bot

[meatfighter's Famicom Puyo AI](https://meatfighter.com/puyopuyoai/). Seven
features, weighted sum, two-piece lookahead. Weights found by training, not
by hand. **It contains no chain-building logic whatsoever.**

### How it plays

1. A piece spawns. Breadth-first search finds every legal lock position
   (position + rotation) it can come to rest in.
2. Puyo shows the next piece, so for each of those outcomes it enumerates
   every lock position of the next piece too.
3. For each combination it **actually simulates the consequences** — locks
   the pieces, pops groups of 4+, drops what falls, pops again if the
   cascade continues.
4. It scores the finished board with the weighted sum below.
5. Highest score wins; it plays that move.

Note step 3. It never scores a *move*. It scores the *board the move
produces*, cascade already resolved. This is what lets one scoring function
handle both "is this tidy" and "did this just fire a 5-chain" — the chain is
already in the board it is looking at.

### The seven features

| # | Feature | Weight | Definition |
|---|---|---|---|
| 1 | Nuisance puyo count | 25% | Garbage blocks on the playfield |
| 2 | Puyo links | 25% | Same-coloured puyos touching orthogonally (not diagonally) |
| 3 | Coloured puyo count | 16% | Total non-garbage puyos on the field |
| 4 | Consecutive colours | 16% | Scan every row and column, measure runs of a single colour |
| 5 | Edge penalty | 8% | Puyos on the side walls score worse — they can link to 3 neighbours, not 4 |
| 6 | Spawn distance penalty | 8% | Puyos near the spawn point are penalised, which keeps the stack low |
| 7 | Colour variance | 2% | Per colour, the average puyo coordinate, then deviation from it — low variance means that colour is gathered |

Two of these are the setup features, and together they are 41% of the score:
**links** and **consecutive colours**. Both are just "same colours near each
other." Neither knows what a chain is.

### Why chains happen anyway

Reward clustering and the board fills with groups of **three** — one short of
popping. Each is stored potential, and because the scorer rewards clustering
*everywhere*, they end up packed against each other.

So when something finally pops, the panels falling into the gap land on
another group of three and complete it. That pops, more falls, completes
another. **A chain is what happens when near-complete groups are dense enough
to touch.**

Nothing aimed at it. The scorer only ever aimed at "tidy," and tidy at high
density is a chain.

### Why it caps out around 3–4 links

Worth being clear about the ceiling before adopting the approach:

1. **Density is not order.** A long chain needs each link's debris to
   complete the *next specific* link — an ordered dependency. Clustering
   scatters groups of three at random, so whether a fall completes another
   group is luck. You get lucky once or twice and the cascade dies.
   Twelve links is a designed structure; random density cannot produce it
   any more than shaking a box of dominoes stands them in a line.

2. **Greedy fires too early, and this is the real cap.** The scorer values
   the board *now*, so the moment a chain is available, taking it scores
   well and it takes it. Building a 12-chain means *not popping* for a long
   time — sitting on a scary stack, refusing free points, adding to a loaded
   chain you deliberately will not trigger. A greedy scorer has no concept
   of holding, so potential never accumulates.

The fix for (2) is a patience/hold term and an evaluation that scores
"biggest chain I *could* fire" rather than "biggest chain available now."

---

## Tier 2 — the deliberate bot

[citrus610's `ama`](https://github.com/citrus610/ama), a competitive Puyo Puyo
Tsu AI. Builds chains scoring 100,000+ in 78% of its games. Here the setup is
measured explicitly instead of emerging.

### What it measures on top of the basics

| Feature | What it is |
|---|---|
| **Chain detection** | Find the chains that actually exist in the current board |
| **Chain extension** | Can this chain be made longer from here? |
| **Trigger height** | Where you must reach to set the chain off, and how exposed that is |
| **Field shape** | Is the board still buildable, or has it painted itself into a corner |
| **Avoid tearing** | Don't split a piece across columns unnecessarily |
| **Avoid wasting resources** | Don't spend colours on nothing |
| **Pattern matching** | Match the board against named human chain templates — GTR, Sullen GTR, Fron |

That last one is the important one philosophically: **it does not discover
chain shapes, it is told them.** Humans worked out good chain structures over
decades of competitive play, and the bot matches against that library. Same
lesson as Tetris's hand-designed features — put the knowledge in rather than
paying to rediscover it.

### Search

- Best-first search combined with beam search, parallelised across cores
- Monte-Carlo-inspired sampling over predetermined piece queues
- Selection policy: **highest expected chain score**, not highest score now
- Quiescence search (don't evaluate mid-cascade)
- Transposition table, value-preferred with aging replacement
- Negamax-style lookahead: 3 moves ahead attacking, 2 defending
- Bitfield board representation with SIMD for fast chain simulation

### Academic middle ground

Ikeda, Tomizawa, Viennot & Tanaka, *Playing PuyoPuyo: Two search algorithms
for constructing chain and tactical heuristics* — two tree search algorithms
plus tactical heuristics, reaching an **average chain length of 11**, which
they note is well above commercial game AIs.

---

## The three ideas we are actually stealing

**1. Score the resulting board, not the move.** Simulate the swap, resolve
the whole cascade, then measure. One scoring function then covers both
building and firing, with no special cases.

**2. Reward density and get chains for free.** Links and consecutive colours
are cheap to compute and carry 41% of the score. We get a chain-building bot
out of a handful of numbers and no chain logic at all. Explicit chain
machinery is what you add *afterwards*, to compete — not what you start with.

**3. Learn the weights, do not type them.** meatfighter's seven weights were
found by generating random weight vectors and training against performance.
Tetris's best controller went from 660,000 lines to 35,000,000 on the same
features once cross-entropy method set the dials instead of a human. Hand-set
weights are the single biggest unforced error available here.

---

## What does and does not translate to Puzzle Attack

Puzzle Attack is Panel de Pon, not Puyo, and four differences matter:

| | Puyo | Puzzle Attack |
|---|---|---|
| Action | Drop a piece into a column | Swap two adjacent panels, anywhere |
| Timing | Turn-based-ish, one piece at a time | Real time, board rises continuously |
| Chain mechanism | Groups of 4+ pop, things fall | Runs of 3+ pop, things fall |
| Move budget | One placement per piece | Many swaps per second, limited only by reaction |

Consequences for the feature set:

- **Links and consecutive colours port directly.** Same idea, same reason.
- **Edge penalty ports** — side columns still have fewer neighbours.
- **Spawn distance penalty becomes stack height.** Same purpose: stay low.
- **Nuisance count ports directly** as garbage blocks.
- **Colour variance ports directly.**
- **Two-piece lookahead does not port.** There are no discrete pieces to
  look ahead at. The analogue is looking ahead over *swap sequences*, which
  is a much larger branching factor, and over the rows about to rise from
  the bottom (which are visible, and are the real "next piece").
- **Something Puyo lacks: we choose when to raise.** That is a genuine extra
  lever with no Puyo equivalent, and probably wants its own feature.
- **Something Puyo lacks: near-matches are cheap to detect.** Because a move
  is a swap rather than a drop, "one swap away from a match" is directly
  measurable and is a sharper setup signal than raw adjacency.

---

## Sources

- [Applying Artificial Intelligence to Famicom Puyo Puyo](https://meatfighter.com/puyopuyoai/) — the seven-feature emergent bot
- [citrus610/ama](https://github.com/citrus610/ama) — competitive Puyo Puyo Tsu AI
- Ikeda, Tomizawa, Viennot, Tanaka — [Playing PuyoPuyo: Two search algorithms for constructing chain and tactical heuristics](https://ieeexplore.ieee.org/document/6374140/)
- [Building Controllers for Tetris](https://inria.hal.science/inria-00418954/document) — Thiery & Scherrer, for the weight-training comparison
