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
| `comboPotential` | 0.887 with chainPotential. Two terms, one question — keep the one that measures depth. |
| `scoreEarned`, `garbageCleared`, `chainLength` | All price the same event as `garbageSent`. Collinear terms split their weight arbitrarily, which is why 193 vs 45 cannot be read. |
| `roughness`, `flatTop`, `colourScarcity`, `staircase`, `staircaseReady` | Small weights, and each overlaps the height/shape group. Candidates to re-add in step 5, not to start with. |
| `garbageAdjacency`, `travelCost` | Never move on any measured board. Confirm in step 0 before cutting. |

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
   puzzles. The bot sits at 19-22 and that barely moved across depth 1, depth
   2 and the engine brain.

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
