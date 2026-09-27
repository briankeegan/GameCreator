# BitBot — the plan

A second bot, beside `PuyoCpu`, not a change to it. Same mode idea; everything
else from the bit arithmetic in `bitmatch.js`, `bitswap.js`, `bitoptions.js`,
`bitframes.js`.

## Why a fresh one

The shipped bot's weights are `garbageOnBoard 150, colourVariance 122,
stopTimeEarned 60, edgePenalty 53, maxHeight 39, linksV 16, linksH 5,
garbageAdjacency 5` — eight of thirty-two, and **not one of them is about
chains**. It keeps the board low and tidy and takes chains when they fall out.

`modes.js` says why, and it was measured rather than guessed: clamping the aim one
above the floor made the bot *worse* at everything, because "the bot has no way to
assemble a chain across moves — the search is two plies and no feature measures
chain structure". Suppressing the cheap sale does not produce a builder.

So the gap is not the weights. It is that nothing measures what a board can be
made to do, or what it costs, or what it buys. That is what this bot is given.

## INFO is not FEATURES

**A quantity that is the same for every candidate in a decision cannot change
which move is played.** It is info, not a feature. This is the repo's own
measured lesson: `incomingGarbage` "varied in 0 of 179 decisions … it is a
property of the queue, identical across every candidate, so it cancels out of the
ranking."

Info, read off the engine, shared by every candidate:

| | |
|---|---|
| `toppedOut` | flips DEFEND |
| `stopTime` on the clock | flips DEFEND when low |
| incoming garbage | queued against us |
| cursor row/col | prices every move |
| frames per row | turns frames into rows |
| health | the death condition |

Info picks the mode and gates the pool. It is never weighted.

## The features — 20

Measured on the board each candidate LEAVES.

**Surface — 3.** `bumpiness` `spread` `tallest`

Two roughness numbers, not one, because they are two questions and the
correlation says so: measured over 1,572 boards they do **not** reach 0.9, while
`tallest` against a headroom term was **−1.0** — the same feature twice, so
headroom is gone.

**Ways to clear — 8.** `chain2` `chain3` `chain4` `chain5plus`
`combo4` `combo5` `combo6` `combo7`

How many ways, at **exactly** that size. Cumulative counts put adjacent sizes
above 0.9 with each other by construction; exact counts do not. The count is the
point: a board with one way to a 4-combo and a board with six are different
boards, and weighting a size is how the bot is told what to aim for.

**Cost — 2.** `cheapestFrames` `moveFrames`

Frames to the nearest clear on the board it leaves, and what playing this
candidate costs. The stack rises while the cursor walks, so a payout with no
price is half an answer.

**After one setup — 3.** `nextBestChain` `nextBestCombo` `nextWays`

Not per size: `now…` against `next…` for the same size measured 0.90–0.99.

**Stop time — 2.** `stopEarned` `stopReachable`

What this move banks, and what the board it leaves could bank in time.

**Garbage — 2.** `breaksNow` `breakWays`

Whether this move breaks a slab, and how many ways the board it leaves has to.
DIGGING IS PROGRESS EVEN WHEN THE CLEAR ITSELF PAYS NOTHING — `modes.pays` already
says so, letting a garbage-breaking clear through a bar it would otherwise fail.
Without these the bot cannot see the lid it is under.

These were missing from the first draft, and worse than missing: `bitoptions`
discarded a move whose resolve came back `garbage-broke`, so every digging option
was invisible. They are kept now and flagged, with the payout that is known up to
the break.

### Why `chain5plus` rather than stopping at 4

Chain 5 and 6 measured flat over 2,358 captured boards, so an earlier draft
dropped them. That reasoning is **circular**: those boards are positions the
CURRENT bot played, and the current bot does not build chains, so its boards hold
no deep-chain material. Dropping the features on that evidence guarantees the new
bot cannot learn what the old one never did. The old registry fell into the same
hole from the other side — `reach7chain` measures 0.0% separation, on boards from
a bot that does not build.

So: one open-topped bucket, and it is validated against the **chip corpus**,
which reaches depth 6, rather than against this bot's own play.

The reason not to simply add `chain5` and `chain6` as separate dimensions:
`latentChain` never fired once in three full games and the trainer still assigned
it 267 of 300. A dimension that does nothing still absorbs weight.

## Stop time, and what DEFEND actually is

`awardStopTime` ends `if (stopTime > this.stopTime) this.stopTime = stopTime` — a
**MAX, not a sum**. Clearing while the clock is high buys nothing.

What the engine pays at level 10:

| | frames |
|---|---|
| a plain three | **0** |
| 4-combo | 30 |
| any chain | 60 |
| 6-chain | 68 |
| topped out, chaining | 88–98 |

Three consequences. A chain is worth about double a combo and depth barely moves
it. The bot's current favourite move — the plain three — buys **no survival at
all**. And chaining into the ceiling pays more than anything else in the game.

So keeping a supply is a matter of TIMING, not of clearing more, and surviving and
attacking are usually the same move. Nothing here prefers one; the weights decide.

## The modes

Four states, on info:

- **BUILD** — hold stays in the pool. Waiting is allowed, which is what building is
- **ATTACK** — hold drops. Cash anything that meets the aim
- **DEFEND** — `toppedOut`, or the clock too low to re-arm
- **REVEAL** — a slab has broken and its colours are on the board, still in the air

Which aim, when to raise, whether to prefer a chain over a combo: **all weights**.
Not rules here.

REVEAL **adds to the pool, it does not take it over.** During the window the bot
can still set up, dig, hold or cash anything else; the lineup swaps are extra
options beside those, priced the same way. A mode that seized the decision for 21
frames would be a second decider, which is the thing `modes.js` is careful not to
be — "a mode is a filter on the pool, not a second way to decide".

### Why REVEAL is a mode and not a feature

Every one of the 18 features assumes a SETTLED board: the surface maths and
`bitswap` both rest on "every column is a packed run from the floor". The reveal
window is by definition unsettled — panels hovering, colours just arrived — so in
the one situation the window exists for, the feature module cannot compute at all.
It needs `bitframes`, which carries the clock, not `bitoptions`.

A `landingChain` feature would also be zero on almost every board, which is
exactly how `latentChain` failed: never fired in three full games, and the trainer
still handed it 267 of 300.

So the window is a distinct situation with its own clock, and `bitlineup` already
answers it. Its answers JOIN the pool for those frames rather than replacing it.
Measured: 21 frames, the same every time, and on 100 positions a reachable swap
beat standing still on 19 of them.

### Lookahead

Already in, and not as a separate mode: the `next…` features are `bitoptions` at
depth 2 — a setup that clears nothing, then the swap that cashes it.

## The one rule that is not a weight

**It cannot die.** A candidate the engine would kill is not offered, however it
scores. A filter, never a term — the weights are free to be wrong about
everything except that.

## Raise is a move, not a feature

A raise is scored like a swap: on the board it leaves, with the same 18. If it
opens options, `nextWays` rises. If it is dangerous, `tallest` rises. If it wastes
the clock, `stopReachable` falls. `raiseSafe` would restate the filter and
`raiseOpensOptions` would be a worse copy of the Ways features. What a raise
costs attaches to the candidate, as `moveFrames`.

## How each piece is checked

- features: every one a share, none flat, nothing clamping, stop-time arithmetic
  against `Stack.awardStopTime` itself
- overlap: Pearson over real boards, anything ≥ 0.9 cut or justified
- deep chains: validated on the chip corpus, not on this bot's boards
- the bot: every chosen move played on a real `PanelEngine.Stack`
- the death rule: a sweep must contain candidates it refused, or the rule is untested

## DEFEND has no clock, and that is measured

The open question was where DEFEND's clock threshold sits. It does not sit
anywhere: `modes.forced` opens on `toppedOut` alone and deliberately not on the
clock, because opening it on the clock was tried — FORCED went from 0.8% of
decisions to 23.3% and the bot **lost 8-16-16 to the same weights without it**.
An emergency DISCARDS the build pool, and doing that on a quarter of all
decisions throws away the trained policy.

So the clock belongs in what is PREFERRED, not in what is ALLOWED. Here that is
`stopReachable`, which is a weight. DEFEND is `toppedOut`.

## ATTACK is derived from the aim, not from a constant

ATTACK opens when something in the pool clears at or above the aim, and the aim
is read off the weights — the chain size and combo size the vector scores
highest. Nothing in the bot names a bar.

## What the first round measured

`bitbot_round.js` runs the face-off the PBT trainer runs each leg, on these
features: every island duels every other on the same seeds, garbage crosses, the
fitness is who died.

**The machinery works.** A mirror duel draws, so two instances on identical
boards never diverge. Chosen swaps are legal on the board they were chosen from
and reach the engine (107 of them over three games). The pool is real: over 39
decisions it offered 175 clearing candidates, the best of them a **6-chain**.

**`STARTER` hoards, and the reason is structural.** It took 0 of those 175
clears, scored 0 and sent nothing. Eight of the twenty features count WAYS TO
CLEAR, and a clear necessarily destroys ways — so with positive weights on all
eight, potential is worth up to ~240 while the only feature that pays for
realising it, `stopEarned`, caps at 50. The vector is a guess and this is what
guesses do; it is recorded because the same trap is available to the trainer.

In a duel it does attack (24 sent, 5 chains, tied first of six islands), which
is the difference garbage crossing makes. Six islands over 30 duels, all decided
by death, none reaching the ceiling.

**Same depth, much cheaper.** BitBot is NOT searching deeper than the shipped
bot: both are two plies. `bitoptions` at depth 2 is a setup that clears nothing
followed by the swap that cashes it, and the shipped weights were fitted at
`GC_DEPTH=2`. What differs is what a ply costs, measured on one board, 360
frames, seed 101:

| | per decision |
|---|---|
| BitBot, depth 2, bit arithmetic | **160 ms** |
| PuyoCpu, depth 2, LogicalBoard | 750 ms |
| PuyoCpu, depth 2, `engine` — the shipped config | 5,012 ms |
| PuyoCpu, depth 1, LogicalBoard | 58 ms |

So 4.7× against the same depth on LogicalBoard, and 31× against the
configuration the shipped weights were actually fitted under, which pays a real
`Stack` per candidate. The extra depth that buys is HEADROOM, not something
spent yet.

### Against the shipped bot

`STARTER`, untrained and hand-set, against `ai/trained-weights.js` at depth 2
`rise` `raise` `engine` `modes`, seeds 101-106:

| | |
|---|---|
| duels | 3W - 3L - 0D |
| garbage sent | 84 vs 88 |
| frames a duel | 1,063 |

**SIX DUELS DECIDE NOTHING.** One run per condition measures nothing and the
seed-to-seed noise floor swallows a gap this size, so the number to take from
this is not "level with the shipped bot" — it is that an untrained guess is not
obviously worse, which says the features are wired to something real. A verdict
needs the island round with a trained population behind it.

## Open

- Survival is short: ~690 frames a duel in self-play, against the ~1,100
  `versus.js` records for PuyoCpu. Whether that is the vector or the pool is not
  yet separated
- Nothing is trained. The round measures whether the machinery can be searched,
  not how well it plays
- DEFEND was entered once in three games, so the mode is reached but barely
  exercised; the gate asserts BUILD and ATTACK only
- Whether ATTACK should drop hold as hard as the old bot does. Measured there as
  ~73% of champions aiming at the floor, which reads as "sell everything"
