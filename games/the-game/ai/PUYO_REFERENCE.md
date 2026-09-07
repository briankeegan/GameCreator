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

---

# How the four parts actually fit together

The section above is *what* successful Puyo AIs measure. This section is
*how a measurement turns into a move*, worked through one real turn, because
"seven weighted features" is easy to nod along to and hard to picture.

There are four parts. They form a chain, and each stage deliberately throws
information away.

```
BOARD          .  R  .  .  .  .
               B  B  .  G  Y  .
                  │
   FEATURES       │  count 7 things
                  ▼
               4 links, 8 puyos, 4 runs, 1 edge, 3 height, 5 variance, 0 garbage
                  │
   WEIGHTS        │  multiply each by its multiplier, add them up
                  ▼
               2.50
                  │
   MOVE CHOICE    │  compare against the other 21 candidate placements
                  ▼
               drop in column 5


   WHAT'S GOOD   final score at game over = 4,200
                  │
                  └──────► decides which WEIGHTS get kept for next time
```

| | Input | Output | How often it runs |
|---|---|---|---|
| **Feature** | one board | 7 numbers | ~22× per piece |
| **Weight** | 7 numbers | 1 number | ~22× per piece |
| **Move choice** | 22 numbers | a move | once per piece |
| **What's good** | a finished game | a score | once per game — **training only** |

The only place an *opinion* enters is the weights. Features just count. Move
choice just compares. And the weights were not chosen by anyone — they are
whatever survived thousands of games (see "Where the weights come from"
below).

---

## One worked turn

Board:

```
h3:   .  R  .  .  .  .
h2:   .  R  .  G  .  .
h1:   B  B  .  G  Y  .
     c1 c2 c3 c4 c5 c6
```

A red pair spawns. There are ~22 legal placements; three of them:

- **A** — drop in column 2. Four reds connect, so it **pops**.
- **B** — drop in column 5, on top of the yellow.
- **C** — drop in column 6, against the right wall.

For each, the bot imagines the board *after everything settles* — piece
locked, anything that pops popped, anything that falls fallen, cascade fully
resolved — and counts seven things on that settled board.

### The seven counts

| Feature | What it counts | A | B | C |
|---|---|---|---|---|
| Nuisance | garbage blocks | 0 | 0 | 0 |
| Links | same colours touching orthogonally | 2 | 4 | 4 |
| Puyo count | total puyos on the field | 5 | 8 | 8 |
| Consecutive colours | runs of one colour along rows/columns | 2 | 4 | 4 |
| Edge | puyos against a side wall | 1 | 1 | 3 |
| Spawn distance | stack height near the spawn point | 2 | 3 | 3 |
| Colour variance | how scattered each colour is from its own average | 3 | 5 | 6 |

### Multiplied by the weights

| Feature | Weight | A | B | C |
|---|---|---|---|---|
| Nuisance | −0.25 | 0.00 | 0.00 | 0.00 |
| Links | +0.25 | 0.50 | 1.00 | 1.00 |
| Puyo count | +0.16 | 0.80 | 1.28 | 1.28 |
| Consecutive colours | +0.16 | 0.32 | 0.64 | 0.64 |
| Edge | −0.08 | −0.08 | −0.08 | −0.24 |
| Spawn distance | −0.08 | −0.16 | −0.24 | −0.24 |
| Colour variance | −0.02 | −0.06 | −0.10 | −0.12 |
| | **TOTAL** | **1.32** | **2.50** | **2.32** |

**B wins. Drop in column 5.**

### What that turn demonstrates

**A had a free pop available and lost anyway.** Popping cost it 3 puyos and
2 links — −0.78 and −0.50 — and bought nothing the scorer measures. So the
bot declines the pop and keeps stacking.

Nobody told it to build. There is no chain logic anywhere in it. Building is
what falls out of the arithmetic when material and adjacency are worth more
than a small pop. **This is the emergent chain-building from the section
above, visible in one turn.**

**C lost on the wall.** It is identical to B except two puyos landed on the
edge and the reds ended up further apart: −0.16 on edge, −0.02 on variance.
That 0.18 decided the move.

**Nuisance did nothing here** because the board has no garbage. It would
dominate if it did — it is tied for the heaviest weight in the set.

Then the next piece spawns and the whole thing runs again from nothing. No
memory of this turn, no plan carried forward. The bot is only ever answering
"which of these 22 boards do I like best."

---

## Where the weights come from

Not from a person. Nobody worked out that clustering matters more than colour
spread.

```
1. Pick 7 random numbers as the weights.
2. Play a full game with them.
3. Record the final score.
4. Repeat for hundreds of random weight sets.
5. Keep the highest-scoring sets.
6. Generate new sets clustered near those winners.
7. Go back to step 2.
```

Run that until the numbers stop moving. Links settles at 0.25, variance at
0.02 — not because clustering was judged good, but because **the bots that
happened to value clustering scored higher, and their weights got copied.**

Same loop as Tetris's cross-entropy method, which took the same feature set
from 660,000 lines (hand-tuned by a human) to 35,000,000 (tuned by search).

## The division of labour

Two things are ours to decide, and only two:

1. **What to measure** — the seven features. This is where domain knowledge
   goes, and it is the real work.
2. **What a good game means** — final score, survival time, matches won.
   This is step 3 above, and it silently defines everything the bot becomes.

Everything in between — every notion of which board beats which — is
discovered by playing.

Worth being blunt about the second one, because it is the easiest thing to
get wrong: train against survival time and you get a bot that clears
constantly and never builds; train against damage dealt and you get one that
hoards. Same features, same search, completely different opponent.
