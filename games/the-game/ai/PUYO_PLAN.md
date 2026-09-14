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

## Where the running experiment sits against the reference

`PUYO_REFERENCE.md`'s Tier 1 is seven features. The 3-seed run launched
2026-09-13 searches FIVE of them, and the two that are missing are 32% of the
reference's own weighting:

| reference | weight | here |
|---|---|---|
| Nuisance puyo count | 25% | `garbageOnBoard` |
| Puyo links | 25% | `links` |
| Coloured puyo count | 16% | `fillRatio` — **CUT** |
| Consecutive colours | 16% | **does not exist** — ruled out by the owner |
| Edge penalty | 8% | `edgePenalty` |
| Spawn distance penalty | 8% | `maxHeight` |
| Colour variance | 2% | `colourVariance` |

`consecutiveColours` is a decision, not a gap — the owner ruled it out.

`fillRatio` is the one to revisit. It was cut on a 0.903 correlation with
colourVariance, which is the same move that was wrong for `comboPotential`
above, and its own note in `registry.js` says "first candidate to cut if it
earns nothing" — while nothing ever measured whether it earns anything,
because it was cut before any run could tell. Restarting at generation 30 to
add it was offered and declined; the run continues without it. Add it back as
a single-feature variant against the noise floor this run produces, per step 4
below, rather than arguing the correlation again.

FIRST SNAPSHOT, seed 11, generation 30, for the record: held-out total 612 ->
2451 (+301%), chains fired 10/84 against the shipped set's 9/84. Score
quadrupled; chaining moved by one puzzle. `comboPotential` came out at 112 and
`chainPotential` at 95, so the feature that was nearly cut is carrying real
weight — more than the chain term it was said to duplicate.

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
2. **How DEEP the chains are — and this is currently MISSING.** Score alone
   cannot tell you whether the bot learned to chain: a bot that survives and
   makes small clears scores respectably and never fires a 4-chain. Measured
   on the real endless benchmark, every chain this bot fires is 2-3 links and
   the 4-6 and 7+ buckets are EMPTY. That, not the score, is the owner's bar.
   - The old measure — chains fired over 84 authored puzzles
     (`puzzles.play.js`) — was REMOVED 2026-09-13. It read a static puzzle
     set the bot has no reason to act in: nothing rises on a puzzle board, so
     holding is free and every swap costs travel, and the shipped bot made
     zero swaps on 34 of the 84. A large part of it was one hold decision
     rather than chain building. Do not put it back.
   - Numbers that came out of it are wrong and must never be quoted again:
     "19-22 chains fired", "23/84", "9/84". The 19-22 was measured through
     `resolve()` while `resolve()` counted match-and-settle ROUNDS, so two
     independent combos landing in sequence registered as a chain — judging
     the bot with the code under test.
   - What replaces it: the chain-length distribution off `ai/experiments/
     report.js`, recorded IN THE SNAPSHOT beside the score. Until that lands,
     every run is judged on a number that can climb the whole way while the
     thing we care about does not move. **This blocks the experiment batch
     below.**

Score alone cannot tell you whether the bot learned to CHAIN: a bot that
survives and makes small clears scores respectably and never fires a 4-chain.
Report both or the experiment answers the wrong question.

## Where depth-1 training actually got to, 2026-09-14

Seed 11, held-out score at every snapshot, against the shipped bot's 612:

```
gen   30    60    90   120   150   180   210   240   270   274   300   330   360   390
    2657  3032  2665  3710  2289  3465  2458  2529  2867  3495  3291  3058  3012  3058
```

Read it as: **the bot is 4-6x the shipped one, and it stopped improving
around generation 60.** The highest number in the run is at generation 120.
The whole spread is 1421 points, and the measured noise floor between two
baselines differing ONLY in RNG seed is 911. So nearly all the movement is
noise. Hours 1-2 bought everything; hours 3-13 bought nothing measurable.

That flatness is the Tier 1 ceiling the reference predicts, arriving on
schedule. More generations cannot fix it. Two things can: a different
SELECTION POLICY (lookahead), or a different FEATURE SET (Puyo's, which we
have never actually run).

Also worth knowing: the search's own stopping rule watches WEIGHT MOVEMENT,
not score. The weights wander on a flat plateau indefinitely, so it will
never declare itself done — which is how 390 generations happened with
nothing to show. It should stop when the held-out score stops improving.

## The experiment batch

Five variants, none of which need new code — they are dispatch inputs on
`ai-train.yml`. The concurrency group is keyed by variant, so they run side
by side rather than queueing.

| variant | change | why |
|---|---|---|
| `base` | depth 1, the current 18 | the comparator. Without it nothing else is readable |
| `d2` | depth 2, the current 18 | the lookahead. Attacks "greedy fires too early", which the reference names as the real cap |
| `noearn` | drop scoreEarned, stopTimeEarned, brokeGarbage | no reference bot in either game feeds "what did this move pay" into the evaluation. It is the one place we have diverged, and it diverges toward the named failure |
| `fill` | put `fillRatio` back | Puyo's #3 at 16%, cut here on an overlap with maxHeight |
| `dens` | density on | makes `links` a ratio rather than a count, so clearing stops subtracting tidiness it never lost. `links` is Puyo's biggest at 25% and ours has been driven to 0.5% |

**TWO RULES FOR THE BATCH, both learned the expensive way:**

1. **Every variant runs the SAME seed set, and at least two seeds.** One run
   per condition measures nothing and still hands you a number that looks
   like a result — five runs were once read as "staircase up, flatTop down,
   comboPotential promising" and all three readings were wrong. The proof was
   a second baseline identical but for its seed, 911 points away. Compare
   pairwise, seed against seed.
2. **Nothing launches until chain depth is in the snapshot** (see "How
   success is measured" above). Ten runs judged on score alone produce ten
   numbers that can all rise while every chain stays 2-3 links.

### Results — fill in as they land

| variant | seed | gen | held-out | 2-3 links | 4-6 | 7+ |
|---|---|---|---|---|---|---|
| base | | | | | | |
| d2 | | | | | | |
| noearn | | | | | | |
| fill | | | | | | |
| dens | | | | | | |

## Still owed

- **`consecutiveColours`** — scan every row and column, measure runs of one
  colour. 16% of meatfighter's bot, one of its two setup features, and we
  have never had it. `colourVariance` is NOT the same thing: it asks whether
  a colour is gathered anywhere on the board, not whether it is in a LINE.
  Needs the feature, a test, and a registry entry before it can be a variant.
- **The stopping rule**, per above: score, not weight movement.
- Of Puyo's top four — links 25%, consecutive colours 16%, coloured count
  16%, nuisance 25% — we currently run one at full strength, one at 0.5%,
  one cut, and one missing entirely. That is the gap this batch exists to
  close.

## Order

- **Step 0 — confirm the dead features are dead.** Count how often each
  feature is non-zero over a real training game. Decides whether the garbage
  and travel terms are inert or just invisible to the overlap harness.
- **Step 1 — close the garbage fidelity gap.** `resolve()` matches the engine
  on 50,797 cases, NONE of which had garbage on the board. Eight features read
  `resolve()`. Do this before trusting any run.
- **Step 2 — chain depth into the snapshot.** Blocks the batch.
- **Step 3 — run the batch**, same seeds, two each.
- **Step 4 — write `consecutiveColours`**, with a test, and register it. Then
  it gets a variant of its own against the same baseline.
