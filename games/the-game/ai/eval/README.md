# The move evaluator

A move is chosen by scoring the position it leads to. This directory is
that scoring function, rebuilt from scratch as a standalone, pluggable
module: **pure feature functions + a weights vector**, with the seam into
the shipped AI (`attach.js`) doing the plumbing so `panel-cpu.js` never has
to be edited to try something.

Nothing here is wired into the game. `weights.js` is all zeros, and a
zero-weight feature is not even computed — so adding to this directory
cannot change how the game plays until somebody deliberately turns a
feature on.

## Why it is a separate module

Two problems in the existing code, both found by reading it:

1. **There are two implementations and they drift.** Scoring lives in
   `ai/agents.py` (where experiments run) and in `panel-cpu.js` (what
   ships). `panel-cpu.js:1184` already records a weight of 200 where
   `agents.py` says 20000. Measuring in one and shipping the other proves
   nothing. This module is written ONCE, in JavaScript — the language the
   game is in — and the Python side drives it the same way it already
   drives `stress_harness.js`, through a subprocess.

2. **The old seam could not carry the questions.**
   `_evaluate(board, cumGarbage, cumChain, cumCombo)` sees a settled grid
   and three running totals. Queued attacks live on `stack.incoming`, the
   death clock on `stack.stopTime/health/shakeTime`, and "will this landing
   continue the chain" needs the chain flags `_cascadePrediction` already
   computes and then discards. So the INPUT is defined first (`input.js`)
   and features are written against it.

## Files

| File | What it owns |
|---|---|
| `registry.js` | The one list of features: key, group, sign, what it measures. Declared even when unbuilt |
| `input.js` | The snapshot every feature reads, and `fromStack()` — the single definition of how engine state maps into it |
| `features.js` | One pure function per feature. Raw magnitudes only, never "how good" |
| `evaluator.js` | `evaluate(input, weights) → { score, features, terms }` |
| `weights.js` | Defaults. All zero |
| `attach.js` | Patches `SearchCpu.prototype._evaluate` at runtime; returns a `detach()` |
| `features.test.js` | Does each feature compute what the registry says? |
| `input.fidelity.test.js` | Does the input agree with the REAL engine? |

## Two test files, because there are two ways to be wrong

`features.test.js` proves a feature computes the right number **from a
hand-built input**. It says nothing about whether that input was built
correctly from the live game.

`input.fidelity.test.js` runs `fromStack()` against a real
`panel-engine.js` Stack and compares every field to the engine's own
value. This is the "not actually hooked up" failure, and it is the one
that looks least like a failure: a feature reading a field that is always
0, or the wrong field, produces perfectly plausible numbers and tunes into
nonsense. `ai/experiments/harness_fidelity.test.js` exists because that
happened twice, silently, and invalidated every benchmark in that
directory.

Run both:

```
node features.test.js
node input.fidelity.test.js
```

## Adding a feature — four steps, in order

Features go in **one at a time**. Nothing starts until the previous one has
finished step 4, so we always know which change caused which result.

1. **Define** — write the exact computation into its `what` in
   `registry.js`.
2. **Implement** — the function in `features.js`, `fn` pointed at it.
   Weight stays 0.
3. **Prove it computes that**, three ways:
   - a case in `features.test.js` on a hand-built board whose answer is
     known by eye, asserting BOTH directions — it **fires** on the thing it
     exists for and **stays quiet** on the near-miss. Only the first is how
     a feature that fires on everything ships; only the second is how a
     feature that fires on nothing ships. This repo has shipped both.
   - a cross-check in `input.fidelity.test.js` against the REAL engine,
     swept over seeds and colour counts, where the expected answer is
     computed independently — not with the feature's own helpers, since a
     shared helper with a bug agrees with itself perfectly. The sweep
     asserts its own coverage: too sparse, too dense, or never producing
     the case being checked all fail.
   - **mutation-check it by hand**: break the feature on purpose and
     confirm the suites go red. `matchPotential` was checked four ways —
     counting plain 3s, dropping the garbage clause, altering the match
     rule, and failing to restore the board it swaps in place. All four
     were caught, and one of them (the match rule) was caught ONLY by the
     fidelity suite, which is the case for having both.
4. **Measure** — turn the weight on and compare. Board and earned features
   go on `tournament.py`. **`framesToDeath` cannot** — that harness drops
   frame timing on purpose ("none of that changes WHICH SWAP is good",
   which stopped being true the moment stop time became a feature), so the
   clock feature is measured on `experiments/stress_harness.js` /
   `training_harness.js`, which run the real engine.

## The sixteen

Grouped by what they measure, not by importance. The four density features
come from `../PUYO_REFERENCE.md`: in the Puyo bot that works, `links` and
consecutive colours together are 41% of the score and there is **no chain
logic at all** — chains emerge because near-complete groups end up packed
against each other. That is the cheapest known route to a chain-building
bot, so those four are declared here rather than left as an idea.

**Board** — what the position looks like once the move settles

| Feature | Sign | Notes |
|---|---|---|
| `matchPotential` | + | **BUILT.** Legal swaps that would produce a match of combo size 4+, or any size touching garbage. A plain 3 scores 0 — `comboGarbage()` sends nothing below 4 |
| `links` | + | **BUILT.** Same-coloured panels orthogonally adjacent, counted as pairs. 25% of meatfighter's score |
| `colourVariance` | − | **BUILT.** Per colour, mean distance of its panels from that colour's OWN mean. Position-invariant, per-colour, and per-panel averaged — each of those three is a mutation that survived a careless test |
| `edgePenalty` | − | Side columns have three neighbours, not four |
| `latentChain` | + | Does a chain-flagged cell settle into a match. The forward-looking half of `chainLength` |
| `garbageOnBoard` | − | On-screen weighted above off-screen |
| `incomingGarbage` | − | Committed height the grid cannot show yet |
| `maxHeight` | − | Plus displacement |
| `fillRatio` | − | Overlaps `maxHeight`; first candidate to cut |
| `roughness` | − | Σ \|height[c] − height[c+1]\| |
| `garbageAdjacency` | + | Garbage has no colour, so touching it is the only way it clears |
| `colourScarcity` | − | A colour with fewer than 3 matchable panels can no longer match |

**Earned** — what this move just paid out

| Feature | Sign | Notes |
|---|---|---|
| `garbageSent` | + | Combo → 1-high blocks of varying width; chain → one full-width block growing a row per link |
| `chainLength` | + | Backward-looking |
| `garbageCleared` | + | Including propagation into touching blocks |

**Clock** — one composite, not three

| Feature | Sign | Notes |
|---|---|---|
| `framesToDeath` | + | `toppedOut ? preStop + stop + shake + health : ∞`, and ∞ while `riseLock` holds |

### Why the clock is one feature

Stop time, health and shake are not three resources sitting beside each
other — they **pause** each other:

- Health only decrements inside `!riseLock && stopTime === 0`
  (`advancePassiveRaise`).
- Game over needs `health <= 0 && shakeTime <= 0` (`checkGameOver`).
- `preStopTime` drains before `stopTime` does (`decrementTimers`), so the
  real clock is their sum.

And **stop time does not bank**: `awardStopTime` ends
`if (stopTime > this.stopTime) this.stopTime = stopTime` — a **max**, not
`+=`. A 4-chain paying 90 frames while 120 are still on the clock earns
nothing. Scored as two additive features ("earned" plus "banked") the bot
learns the opposite of the truth.

## Not features — these belong in move legality

| Rule | Where |
|---|---|
| Manual raise on a topped-out board is instant death, whatever the clocks say | `checkGameOver`, 2nd condition |
| A repeated identical swap while topped out costs 4 health | `SWAP_STALLING_PUNISH` |
| A swap always in flight holds `riseLock`, so health never drains | already noted in `panel-cpu.js` |

Model health as free frames and the search rediscovers the wiggle exploit
that punishment exists to stop.

## What a match is

Straight from `getMatchingPanels` / `canMatch`, because two features depend
on it:

- 3+ of one colour in a straight **run**, horizontal or vertical. No
  diagonals.
- Both axes are scanned and the results **merged**: an L or T is one
  5-combo, not two 3s. `awardStopTime` uses that merged `comboSize`.
- A panel can match while `normal`, `landing`, or `hovering` with
  `matchAnyway`. Colour 0 (empty) and 9 (garbage) never match.
- **Garbage never matches.** It clears by adjacency to a match, and the
  clear propagates block to block.
- A match is a **chain link** if any matched panel carries `chaining` —
  set by falling from an earlier clear. A hovering panel can never *start*
  a chain.

## Cut: `consecutiveColours`

Built, measured, removed. It counts maximal runs of one colour where `links`
counts the adjacent pairs inside them, and in Puyo those disagree — groups
pop at **four**, so runs of three sit on the board being counted twice by
one feature and once by the other.

Panel Attack pops at **three**. A settled board cannot hold a run longer
than two, so every maximal run is exactly one pair and the two features
return the same number. Swept to be sure rather than argued: 1050 boards
resolved to settlement across 7 seeds and 6 colour counts, agreeing on
every one.

Two weights on one signal is worse than one — it splits the credit and
doubles the search for the right value. `links` survives because it is the
term the reference measures at 25%, and because it can tell a three-run
from a pair, which the other cannot.

Recorded here rather than left in the code, so the next person reading
PUYO_REFERENCE.md's "41% of the score" does not add it back.
