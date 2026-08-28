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
