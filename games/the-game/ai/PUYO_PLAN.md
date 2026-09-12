# Getting back to the Puyo shape

A proposal, written after measuring the evaluator rather than reading it.
Everything here is a number from a tool in `ai/eval/`, and every step below
ends in a measurement rather than an opinion.

## Where we actually are

`PUYO_REFERENCE.md` describes a bot with **seven** features and no chain logic
at all, and argues that a handful of cheap density numbers produces chains for
free. We have **twenty**, and the numbers say that is costing us three
different ways.

**1. Half the Puyo core is missing.** The reference names links and
consecutive colours as 41% of the score. `links` exists. `consecutiveColours`
does not — not in `features.js`, not in the registry. It cannot be weighted
and the search has never been able to find it.

**2. Four features answer one question.** `garbageSent`, `scoreEarned`,
`garbageCleared` and `chainLength` all measure what the move just paid. When
features move together the search splits the weight between them arbitrarily,
so the shipped `garbageSent 193` against `chainLength 45` says almost nothing
about which matters — and neither number can be read alone.

**3. Measured overlap** (`feature_overlap.js`, 4,447 real candidate boards —
real positions times every legal swap, resolved):

    +0.903  colourVariance  <->  fillRatio        collapse candidate
    +0.887  chainPotential  <->  comboPotential
    +0.878  maxHeight       <->  fillRatio
    +0.854  edgePenalty     <->  fillRatio
    +0.825  colourVariance  <->  edgePenalty

`fillRatio` correlates above 0.85 with three separate features. It is close to
a linear combination of the rest of the board group.

**4. Seven features never move at all** on those boards: `garbageOnBoard`,
`garbageAdjacency`, `garbageSent`, `chainLength`, `scoreEarned`,
`garbageCleared`, `travelCost`. Two causes, and they need separating before
anyone acts on this:

  - The four garbage terms are constant because **no garbage ever appeared**:
    0 of 3,320 captured boards had any. If that holds in the training
    scenario too, four features are dead weight there.
  - The earned terms and `travelCost` may be constant because
    `feature_overlap.js` scores a static board with no cursor and no live
    game, not because they are inert in training. THIS IS UNCONFIRMED and is
    step 0 below.

## What the reference's seven map onto

| meatfighter | weight | ours |
|---|---|---|
| Nuisance puyo count | 25% | `garbageOnBoard` |
| Puyo links | 25% | `links` |
| Coloured puyo count | 16% | `fillRatio` |
| Consecutive colours | 16% | **missing** |
| Edge penalty | 8% | `edgePenalty` |
| Spawn distance penalty | 8% | `maxHeight` |
| Colour variance | 2% | `colourVariance` |

Six of seven already exist. The gap is one feature, not a rewrite.

## The plan

**Step 0 — find out whether the dead features are really dead.** Instrument a
real training game and count how often each feature is non-zero. If the
garbage terms never fire in the scenario we train on, they are noise in the
search regardless of how good they are. Cheap, and it decides steps 2 and 3.

**Step 1 — close the garbage fidelity gap.** `resolve()` matches the engine on
50,797 cases, none of which contained garbage. Its garbage handling
(`_connectedGarbage`, `_dropGarbageBlocks`, conversion) has never been
compared. Capture boards from games where garbage lands and re-run
`resolve_fidelity.js`. Nothing below is worth running until this is done,
because eight of the twenty features read `resolve()`.

**Step 2 — write `consecutiveColours`, with its test.** The one genuinely
missing piece of the Puyo core. Scan every row and column, measure runs of a
single colour. Register it so it can carry a weight.

**Step 3 — train THE SEVEN, as the reference's own bot.** Everything else
excluded via `GC_EXCLUDE`. Three seeds, because one run per condition measures
nothing. This becomes the baseline and its spread becomes the noise floor.
It is also the honest test of the reference's central claim: that seven cheap
numbers with no chain logic build chains.

**Step 4 — collapse the payout group to ONE term** and measure against step 3.
`garbageSent` is the candidate to keep: it is what the opponent actually
receives, and it already prices chain depth and combo width non-linearly.

**Step 5 — add the chain machinery back ONE AT A TIME**, each against step 3's
noise floor: `chainPotential`, then `comboPotential`, then `matchPotential`,
then the staircase pair. The reference is explicit that this layer comes
AFTER density, to compete — not as the starting point. Anything that does not
clear the noise floor does not go back in.

## Why this order

The reference's third idea is "learn the weights, do not type them", and a
twenty-feature search with four collinear terms and seven inert ones is not a
search that can do that. Fewer, sharper features converge faster and produce
weights a person can read. Steps 0 and 1 come first only because they are the
two places where a number we already believe might be wrong.
