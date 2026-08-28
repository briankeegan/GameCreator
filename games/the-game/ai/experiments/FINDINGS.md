# Nightmare AI survival research — findings log

Working log for the "make the AI survive as long as possible" investigation.
Read this before repeating any of the dead ends below.

## The benchmark that misled the whole first pass

`training_harness.js` + `TrainingMenu.lua`'s `createBasicTrainingMode`
(Combo Storm 4x1, Factory 6x2, Large Garbage 6x12) fire **50 identical
attacks, one per frame, then a long gap, forever**. Every AI strategy tried
against this — proactive raising (JS and Python), garbage-first greedy
(Python), periodic-raise maintenance (Python), pressure-gated reaction
speed — died within 1-3 burst cycles, 7-65 seconds, at every Stack level
including Easy. `DummyCpu` (`common/engine/computerPlayers/DummyCpu/`),
the only bot shipped in the actual source game
(`/home/user/briankeegan/panel-game`), holds one constant input forever —
there is no reference "smart" AI to learn from there.

**These patterns are Training Mode: solo practice drills with no win
condition, not calibrated to be beatable.** Chasing survival against them
was solving the wrong problem — confirmed by finding the real, winnable
content described below and seeing dramatically different, achievable
numbers against it.

## The real benchmark: Challenge Mode's actual attack files

`client/assets/default_data/training/challenge-<difficulty>-<stage>.json`
(66 files, difficulties 1-8) are **recorded replays of real players'
actual attack output** — each carries `extraInfo: {playerName, gpm,
matchLength, dateGenerated}`. These are what Challenge Mode's CPU opponent
actually plays back (`ChallengeMode.lua`), the source game's real,
completed, winnable content.

Real difficulty-8 (hardest) attack rates: **20.9-32.9 GPM** (garbage cells
per minute) — for comparison, `stress_harness.js`'s "moderate" synthetic
test (4 cells/2s) already runs at 120 GPM, and Training Mode's raw bursts
are in the tens of thousands. The synthetic tests this repo had been using
were already far harsher than genuine top-level human play; Combo
Storm/Factory/Large Garbage were harsher still, off the scale.

There's also a `common/tests/engine/replays/` folder with 23 full match
replays (including real level-10-vs-level-10 games) — richer data
(complete move sequences, not just extracted attack timing), not yet used
here.

### Tooling: `attack_file_harness.js`

Plays a real `challenge-*.json` file against the real `panel-engine.js`
Stack + `panel-cpu.js` SearchCpu. Ported `AttackEngine.lua`'s event
expansion faithfully, including one bug found and fixed along the way:

**Chain attacks are not N separate deliveries.** `GarbageQueue:addChainLink`
(the real engine) keeps ONE garbage piece staged and grows it by one row
per link (`currentChain.height += 1`); it only actually lands — as a
single 6-wide, N-tall block — when `finalizeCurrentChain` fires at
`chainEndTime`. First implementation delivered each link as its own
small immediate block, which is measurably GENTLER than reality (a big
block arriving all at once is worse than the same total material
trickling in — consistent with the Large Garbage finding above). Fixing
this dropped average survival at level 10 from ~149s to ~70s across the
same 24 (file, seed) pairs — the corrected number is the one to trust.

Usage: `node attack_file_harness.js <file.json> <seed> [difficulty|cfgJSON] [stackLevel] [maxFrames]`

## Current measured state (level 10 "Nightmare", all 12 challenge-8-*.json files, 2 seeds each, corrected chain semantics)

| Config | Avg survival | Full survivals |
|---|---|---|
| Without today's earlier fixes (dangerHeightFrac 0.72, reaction 12) | 49.4s | 0/24 |
| **Shipped nightmare (today's fixes: dangerHeightFrac 0.45 + reaction 8 at maxHealth<=1/<=51)** | **69.6s** | **0/24** |

So today's earlier, synthetically-validated fixes carry a real ~41%
improvement over to genuine recorded human attack data too — they weren't
overfit to the synthetic tests. Individual files vary enormously (18.8s on
`challenge-8-10` seed 2 to 231.7s on `challenge-8-2` seed 2) — the AI is
not yet uniformly strong across all real attack shapes.

## Round 2: search widening (shipped) + weight tuning (dead end)

Two structural fixes shipped, both gated the same way (only at
`stack.levelData.maxHealth <= 21`, i.e. levels 8/10; both measurably hurt
levels 3/5 when tried ungated) and both timing-checked safe for real-time
play before picking their value:

| Change | Level 10 avg survival | Level 10 total sent |
|---|---|---|
| Baseline | 69.6s | 1138 |
| + `rescueBranchCap` 6 -> 10 (worst-case decision: 62ms, safe; 15 measured 159ms, NOT safe) | 95.9s | 1575 |
| + `depth` 4 -> 5 (agents.py's actual tournament-proven default, never previously ported; worst-case: 50.7ms) | **109.8s** | **2095** |

That's +58% survival and +84% garbage sent over the original baseline,
both from search WIDTH/DEPTH, not evaluation weights.

Six weight variants tried on top of the above, all on the real 12-file
benchmark, all a dead end:

| Change | Avg survival | Total sent | Verdict |
|---|---|---|---|
| `beam` 10 -> 14 | 64.7s | 1054 | worse on both axes |
| `garbageWeight` 90 -> 150 | 109.8s | 2095 | zero effect (already saturated) |
| `patience` 0.85 -> 0.6 | 65.9s | 1098 | much worse |
| `patience` 0.85 -> 0.95 | 106.0s | 1973 | slightly worse |
| `patienceFillCeiling` 0.5 -> 0.65 | 109.8s | 2095 | zero effect |
| `pressureThreshold` 15 -> 30 (looser chain-extend gate) | 76.0s | 1283 | much worse |

Conclusion: `patience=0.85` is already a real local optimum (both
directions measured worse), `garbageWeight`/`patienceFillCeiling` are
already non-binding at real attack rates, and loosening the chain-extend
gate reproduces the exact heavy-rate death this repo already has a
comment about (search "ungated extension" in panel-cpu.js). The current
hand-tuned weight space appears to be a genuine local optimum -- further
gains likely need a structural change (see below), not another weight
sweep.

### Tried and reverted: explicit "merge separate garbage blocks" bonus

Direct test of the "line up the garbage" idea: added a scoring bonus to
`_defensiveKey` for a move that connects and clears TWO OR MORE
previously-separate garbage blocks in one touch (`getConnectedGarbagePanels`
already floods through any adjacent block once one is touched -- this
just rewarded the search for setting that up, on top of the cell-count
reward it already gets). Measured **zero effect** on the real 12-file
benchmark (109.8s/2095, bit-for-bit identical) and zero effect at level 3.

Conclusion: the "multiple separate blocks needing to be merged" situation
this targets is specific to the synthetic Large Garbage drill (a single
6x12 block landing repeatedly) -- real recorded human attack files don't
fragment the board that way often enough for this to ever matter. Reverted
rather than ship unproven complexity. The `rescueBranchCap`/`depth`
widening already captures whatever "think ahead about what a sequence
produces" benefit exists in real play, implicitly, without a
special-cased heuristic.

## Open leads, not yet tried

- **No telegraph modeled for incoming garbage.** The real engine gives
  `GARBAGE_TELEGRAPH_TIME` (45 frames) of advance warning before an
  attack lands — `receiveGarbage` here delivers instantly with zero lead
  time. A real player (or an honest AI reading telegraphed state) gets a
  chance to prepare for a known-size, known-time chain finalization
  before it lands. Not modeled at all currently; could be a genuine,
  legitimate lever specific to chain attacks (their size and timing are
  no longer information the AI has to react to blind).
- **23 full match replays** in `panel-game/common/tests/engine/replays/`
  (real complete games, including level-10-vs-level-10) are richer than
  the extracted attack files and untouched so far.
- User has "hundreds" of additional saved sequences beyond what's in this
  checkout — location not yet shared/available in this sandbox; fold them
  in once available.
