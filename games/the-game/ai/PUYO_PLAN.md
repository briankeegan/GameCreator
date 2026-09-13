# The plan

Written after measuring, and corrected once: an earlier draft cut
`chainPotential`, which contradicts the reference it was citing.
`PUYO_REFERENCE.md` names the real ceiling as *greedy fires too early* and
says the fix is "an evaluation that scores the biggest chain I COULD fire
rather than the biggest chain available now" — that IS `chainPotential`. The
chain machinery stays. What goes is duplication.

## What we cut, and why — each from a number, not an opinion

Measured by `feature_overlap.js` over 4,447 real candidate boards (real
positions x every legal swap, resolved — what the search actually scores).

| cut | reason |
|---|---|
| `fillRatio` | 0.903 with colourVariance, 0.878 with maxHeight, 0.854 with edgePenalty. Nearly a combination of features we keep. |
| ~~`comboPotential`~~ | **NOT CUT — the owner overruled this, and they were right to.** Kept in the genome. |
| `scoreEarned`, `garbageCleared`, `chainLength` | All price the same event as `garbageSent`. Collinear terms split their weight arbitrarily, which is why 193 vs 45 cannot be read. |
| `roughness`, `flatTop`, `colourScarcity`, `staircase`, `staircaseReady` | Small weights, and each overlaps the height/shape group. Candidates to re-add in step 5, not to start with. |
| `garbageAdjacency`, `travelCost` | Never move on any measured board. Confirm in step 0 before cutting. |

## comboPotential stays. Read this before cutting it again.

It was cut here on a 0.887 correlation with `chainPotential` and it should not
have been. The owner asked for both, in those words, three separate times
("we should have it count potential both chains and combos", "We need both
chain and combos potential. Do we have that?", and finally "Why the fuck would
you cut the chain potential, combo potential, and map potential? Literally,
that is what we need"). The cut was then argued for four more times against
that and went into a training run anyway, on the strength of a correlation
number — the run was killed at generation 14 and restarted with 18 features.

The number was never the point. 0.887 is high and it is not 1.0: combo measures
WIDTH (the biggest single clear available) and chain measures DEPTH. They
answer different questions and the reference wants both. A correlation is a
reason to watch two terms split their weight, not a reason to delete one the
owner asked for — and "collinear so drop one" is a modelling convenience, not
a finding about the game.

The general rule this is an instance of: a measured overlap is evidence, and
evidence loses to an explicit instruction. If the number really does say
something the owner should hear, say it once and then do what they asked.

## What we keep — nine

**Density, the Puyo core — chains come out of this for free**
- `links` — same colours touching
- `consecutiveColours` — runs of one colour along rows and columns. **DOES NOT EXIST YET.** The reference calls this and links 41% of the score.
- `colourVariance` — is a colour gathered or scattered
- `edgePenalty` — side columns link to three neighbours, not four
- `maxHeight` — stay low

**Chains, deliberately kept**
- `chainPotential` — the deepest chain this board COULD fire. The patience half.
- `matchPotential` — how many swaps pay off at all. Correlates with nothing else measured.

**Payout and threat**
- `garbageSent` — what the opponent actually receives; prices depth and width non-linearly
- `garbageOnBoard` — junk sitting on us

## How success is measured — BOTH, every run

This is the part that was missing, and it is why "no effect" kept being the
answer.

1. **Score on held-out seeds** — games never trained on. Existing depth-1
   controls: 3023 / 2703 / 2707. The spread between those three IS the noise
   floor; a change must beat it to mean anything.
2. **Chains actually fired** — `puzzles.play.js`, 84 real authored chain
   puzzles, COUNTED ON A LIVE STACK. The shipped weights fire **9 / 84**, and
   the trainer now reports this beside score every run (`chainmeasure.js`,
   gated by `chainmeasure.test.js`), measuring the shipped set the same way
   rather than quoting a figure.
   - The "19-22" this document used to give was measured through
     `resolve()` while `resolve()` counted match-and-settle ROUNDS, so two
     independent combos landing one after another registered as a chain. That
     is judging the bot with the code under test: fixing `resolve()` moved the
     number from 23 to 12 without the bot changing at all. Do not quote either
     figure again.
   - Worth knowing before reading a delta: the shipped bot makes **zero swaps
     on 34 of the 84** and holds within one swap on 50. On a puzzle board
     nothing rises, so holding is free and every swap costs travel — so a
     large part of this measure is currently one hold decision, not chain
     building.

Score alone cannot tell you whether the bot learned to CHAIN: a bot that
survives and makes small clears scores respectably and never fires a 4-chain.
Report both or the experiment answers the wrong question.

## Order

- **Step 0 — confirm the dead features are dead.** Count how often each
  feature is non-zero over a real training game. Decides whether the garbage
  and travel terms are inert or just invisible to the overlap harness.
- **Step 1 — close the garbage fidelity gap.** `resolve()` matches the engine
  on 50,797 cases, NONE of which had garbage on the board. Eight features read
  `resolve()`. Do this before trusting any run.
- **Step 2 — write `consecutiveColours`**, with a test, and register it.
- **Step 3 — train the nine. Three seeds.** Baseline, and its spread is the
  noise floor. Report score AND chains fired.
- **Step 4 — add back one cut feature at a time**, each measured against that
  noise floor on both numbers. Anything that does not clear it stays out.

Steps 0, 1 and 2 are hours, not days. Step 3 is the long one.
