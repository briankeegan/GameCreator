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

## Why it was dying

Not the hoarding above. **It was undoing its own move.** On seed 701, 56 of 76
decisions repeated the previous cell — `(2,5)` thirteen times running, `(1,1)`
ten — and swapping the same cell twice is the identity, so the board never
changed. **Zero matches in 1,093 frames** while the floor climbed into the
ceiling, with a 6-chain and nine clears on the board the whole time.

The cause is that scoring is stateless: if board X's best swap leads to Y and
Y's best swap leads back to X, the pair is played forever. ATTACK made it fatal
by dropping hold, so the bot was forced to act and the only thing it would do
was undo. `_lastSwap` was tracked and never read.

Two filters, measured separately over seeds 701-704, capped at 4,000 frames:

| | avg frames | matches |
|---|---|---|
| neither | 1,858 | 40 |
| **no-return only** | **2,340** | **57** |
| death horizon only | 1,853 | 40 |
| both | 2,380 | 57 |

`refuseReturn` is the fix — seed 703 went 789 → 2,730 frames and 0 → 16 matches.
It is exact, not a heuristic: the resulting board is compared cell for cell
against the boards recent decisions were made on, and hold is exempt because
waiting is what BUILD is for.

**The death horizon did nothing measurable** (1,858 → 1,853, which is noise) and
the reason is arithmetic: the horizon is the walk plus the 12-frame reaction, and
`framesToNextRow` is larger than that on nearly every board, so it almost never
adds a row. It is kept because "would die" is the rule the plan asked for and
"already dead" was what was implemented, but nothing here has shown it earns its
place. Recorded so it is not re-measured as though it were new.

**The loop was not the only cause.** With the filter on, seed 701's repeats go
from 33 of 75 decisions to **0 of 72** — and it still makes **zero matches** in
1,100 frames. So there is a second failure underneath: having been stopped from
undoing, it now walks a longer orbit of non-clearing setups instead. That is the
hoarding above, and it is structural rather than a bug — eight features count
ways to clear, cashing destroys them, and `stopEarned` caps at 50 against ~240
of potential. ATTACK dropping hold means it must move, so it rearranges forever.

The gate holds the RULE (repeats fall, refusals happen, no clears are lost) and
not "it now plays well", because an untrained hand-set vector playing well is
not something a filter can deliver.

## How much of this is the new arithmetic

Less than it should be, and the split is worth stating rather than implying:

| | |
|---|---|
| features and scoring | `bitoptions` → `bitmatch` — masks |
| the death test | `bit.maskState` — masks |
| the reveal window | `bitlineup` → `bitframes` — masks |
| **candidate generation** | `board.legalSwaps()` — the old simulation |
| **what each swap does** | `LogicalBoard.clone/swap/resolve()` — the old simulation |

`bitoptions` is mask-native inside; the old calls are all in `BitBot.candidates`,
which is exactly the question `bitswap` and `resolveFromMasks` were built to
answer. Moving it over needs `bitoptions` and `bitfeatures` to take a mask state
instead of a `LogicalBoard`, because both currently re-derive masks from a grid
and `options` needs `clone`/`legalSwaps` for its second ply.

The enabling piece is in: `resolveFromMasks` now returns `settled`, the board the
cascade left, in the shape `maskState` builds. It could previously say what
happened but not what the position became, which is why a caller wanting the
resulting board had to go back to the simulation. Additive — `bitmatch.test.js`
still passes all 168,128 / 100,000 / 54,264 / 6,228 / 74,522 / 74,821 cases.

What masks do NOT carry is slab identity: `blocks` groups garbage cells into
slabs, and bridging depends on it, so materialising a board from masks alone
would guess it. That is the part to solve, not to paper over.

## Why it would not clear, and what it actually was

It found the clears. It priced them wrong. On seed 701 it found a **6-chain**,
scored it **+1**, and scored **raising +54**:

```
BEST CLEAR: a 6-chain, 18 panels      TOTAL  +1
   stopEarned +34   bumpiness -15  spread -9  tallest -27
IT PICKED: raise                      TOTAL +54
   nextBestChain +30  chain5plus +15  combo6 +8  nextWays +10
```

Paid +45 for HAVING a big chain against +34 for playing one, and playing it
deletes the material paying the +45.

**IT IS THE BALANCE, NOT THE STRUCTURE.** Two wrong explanations were tried and
both are recorded so they are not retried:

1. *"The features should measure a CHANGE in potential, not a LEVEL."* Wrong, and
   it would change no decision. Within one decision the two differ by the
   potential of the board every candidate started from — the same constant for
   all of them — so they rank identically. Measured over 40 candidates: exactly
   one distinct difference per feature.
2. *"Potential should not be weighted at all."* Wrong the other way. Zeroing those
   twelve weights took it from 2,380 frames and 57 matches to **906 and 7**. The
   potential features are load-bearing.

What fixed it was halving one group of numbers. Seeds 701-704, 4,000-frame cap:

| | frames | matches |
|---|---|---|
| as first guessed | 2,380 | 57 (one seed cleared nothing at all) |
| **potential x0.5** | **4,000 — died on no seed** | **133** |
| potential x0.25 | 3,627 | 104 |
| stopEarned x5 | 4,000 — died on no seed | 119 |

### That table is SOLO, and solo flatters it

No opponent, no garbage arriving, so `DEFEND` is entered 0 times and `BUILD`
900 against `ATTACK` 34. One-on-one against an instance of itself with garbage
crossing, the old balance against the new, 8 seeds:

| | |
|---|---|
| duels | NEW 5W - old 3W |
| garbage sent | 184 vs 201 — the new one sends LESS |
| every duel | ended in a death, average 1,393 frames |

Eight duels is inside the noise floor, so 5-3 is not a result. The honest reading
is that "never dies" was an artifact of having nothing to fight, and under
pressure it still dies every time. A real verdict needs training.

## DEFEND ranks by the clock, not by the weights

The bot is always attacking; the modes only change which shapes it prefers. The
one exception is survival: the weights score board QUALITY, which is not what
matters one frame from death. So in DEFEND the pool narrows to moves that bank
stop time and the MOST time wins, whatever the weights would rather do. If
nothing banks anything the ordinary ranking stands, because then no move is an
escape. `modes.js` FORCED does exactly this.

## Checks have to provoke their own defect

The loop and death checks were written against whatever `STARTER` was, and then
`STARTER` improved: the bot stopped looping, stopped nearing death, and **the
break tests passed with the filters switched off**. A check that only fires while
the default weights are bad retires itself the moment the bot gets better. The
defect vector is pinned in the test as `LOOPER` now, and the checks sweep that.

## Every frame is accounted for

The bot could not say what it did with a frame, so every question about its
behaviour was answered by inference — and three separate fixes landed in code
paths that never ran. `spend` now has one counter per exit from `update()` and
they must sum to the frames played; `frozen` is the same buckets restricted to
frames with the clock running. A frame in no bucket is a frame nobody can account
for.

It immediately contradicted two of my own readings. Frozen frames go mostly to
WALKING, not idling (287 of 423 on seed 101), and the `hold 195` on seed 103
survives the hold-drop because during a freeze a cascade is usually still
running — the board is changing without the bot touching it, which is not waste.

## DEFEND was opening one decision before death

Measured on seed 101, the last six decisions:

```
tallest 11   room 112 frames   stop 0   BUILD
tallest 11   room 112 frames   stop 0   BUILD
tallest 11   room 112 frames   stop 0   BUILD
tallest 11   room 112 frames   stop 0   BUILD
tallest 11   room 112 frames   stop 0   BUILD
tallest 12   room   0 frames   stop 0   DEFEND   <- too late
```

`framesPerRow` is **112**. So one row from death the bot has 112 frames of room,
and a trigger comparing that against the ~30 frames an escape costs to walk to
reads "plenty of time". FRAMES WERE THE WRONG UNIT. Rows are the right one,
because the danger is not the walk — it is having no workspace, and a chain needs
several rows to assemble in. `ESCAPE_RESERVE_ROWS = 2`, which is `modes.js`'s own
measured number rather than one invented here.

With that, DEFEND actually opens and the survival objective actually runs:
**1,758 to 2,339 average frames** over six one-on-one duels, seed 106 reaching
4,007.

## Survival is one number

Every fix before this was a symptom. The quantity to maximise is how long the
position you end up in can live, counting what it cost to get there:

```
clockAfter = max( max(0, S - cost), P )
value      = cost + framesToDeath(tallestAfter, clockAfter)
```

`framesToDeath` is `stopTime + health` topped out and `stopTime + rowsFree x
framesPerRow` otherwise, both the engine's own numbers. The inner `max` is
`awardStopTime` applied to the clock AS IT WILL BE WHEN THE MOVE LANDS, because it
drains while the cursor walks.

This subsumes the patches. A big payout too far away scores badly because
`max(0, S - cost)` has gone to zero by the time it arrives. A clear that pays
NOTHING but lowers the stack still scores, because `tallestAfter` falls and rows
free are frames — which is why digging 23 garbage cells was previously worth
nothing to it. Only in DEFEND; everywhere else the weights decide.

### The clock fixes, and one that was wrong twice

`awardStopTime` is a MAX, so `stopEarned` is the GAIN, not the payout — and the
gain is against the clock when the move LANDS, `max(0, left - cost)`, not the
clock now. Subtracting `left` flat was the second wrong version: it suppressed
every big clear while the clock was high, including the ones whose walk empties
it. `stopReachable`'s budget was the stop clock, which is 0 off a freeze, so the
feature read 0 for every candidate and cancelled out of the ranking on most frames
of the game.

## A check must provoke its own defect, deterministically

The no-return check compared the repeat rate of a real game with the filter on
against one with it off. It went vacuous **twice** — once when STARTER's weights
improved and once when DEFEND changed — because whether a game loops depends on
the whole decision path, and that path keeps moving. It is constructed now: the
bot is told it has just been at a position and the candidate returning it there
must be refused, with the flag off proving the refusal came from the filter.

The end-to-end version is kept as a BOUND, not zero, and the gap is the finding:
8 of 387 decisions still land on a board seen within the last three. The filter
refuses a PREDICTED return, the prediction comes from `LogicalBoard.resolve`, the
board that arrives comes from the engine, and the two part company when a row
rises mid-walk. That number tightens when the candidate path stops predicting with
the old simulation.

## Survival, as it actually measures

**Survival is a clear rate of 1.0.** Panels arriving against panels cleared, and
nothing in the bot was measuring it. Two thirds of the inflow is GARBAGE, not the
rising floor, so what a move REMOVES matters more than the freeze it buys.

One panel removed buys `framesPerRow / W` frames of life — 18.7 at level 10 — so
panels and stop time are the same currency and that is the exchange rate. Ranking
plans by the stop-time gain alone read the smaller half: a plan clearing 18 panels
buys 337 frames of life while the deepest chain in the game pays 68.

Ranking by frames-of-life-bought per frame-spent, at a 30,000-frame ceiling
(8 minutes), garbage crossing:

| seed | | rate |
|---|---|---|
| 101 | died at 19,308 | 0.94 |
| 103 | alive at the cap | 1.01 |
| 105 | alive at the cap | 0.99 |

**The rate predicts it.** 0.94 dies, 0.99 and 1.01 live. That is the model
holding, not a coincidence — and it is the number to watch, not frames survived.

A 7,200-frame run shows 0 of 6 dead, and that figure is worth nothing on its own:
every game ended AT the cap, so the cap ended them. Only the long run says
anything, and it says 2 of 3.

### They do attack, and weakly

Over 15,000 frames, each way (a mirror match, so identical by construction):

| seed | cells sent | pieces | pieces of 12+ cells |
|---|---|---|---|
| 101 | 93 | 14 | 2 |
| 103 | 190 | 32 | 3 |

So 6 to 13 cells per 1,000 frames, almost all of it small — combos and two-chains.
**The survival objective is why.** It maximises panels cleared per frame, which
prefers many small clears to few big ones; that is what holds the rate above 1.0
and it is also what makes the attack weak. Surviving and attacking pull opposite
ways at this setting, and the attacking half is still the untrained BUILD weights.

### Rejected, with numbers

- **Launching a plan so its cash LANDS as the clock empties** (`clock <= frames`
  rather than `clock == 0`). The obvious reading of the gain formula, and worse:
  4,593 frames against 5,040, payouts 92 against 100. Launching earlier wins
  continuity and loses building time, and the building time is worth more.
- **Re-planning every decision** instead of executing the plan. 2,521 frames
  against 2,892 for no plans at all — it starts plans and never finishes them.
- **A `keepUp` feature** for the clear rate, weighted in BUILD: 2,068 against
  2,404, and identical on four of six seeds because it barely varies between
  candidates. The rate belongs in the plan objective, not in the weight vector.

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
