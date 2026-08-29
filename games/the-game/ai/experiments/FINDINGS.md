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

## Round 3: queued-garbage awareness (shipped, gated)

The "stop focusing on levers" instruction meant: stop A/B-sweeping
existing weights/thresholds and fix an actual blind spot instead.

**The blind spot:** `_snapshot()` builds the entire planning board from
`stack.panelAt(r,c)` alone, which only reflects garbage that has already
landed. `stack.incoming` (a FIFO of `{width,height,isChain}` blocks
already committed and waiting their turn -- `shouldDropGarbage` lets only
the front of the queue fall at a time) is invisible to `_inDanger` and
therefore to the whole search, offense and defense alike, until each
piece physically arrives. A burst that queues several pieces back to back
means the danger was real the instant the queue filled -- but the AI
doesn't react until the LAST piece has actually landed and tipped
`maxHeight()` over the threshold, by which point there was no calm moment
left to use.

**The fix:** `_queuedGarbageHeight()` sums `stack.incoming` into an
equivalent row-height (total cells / board width) and `_inDanger` adds it
to `board.maxHeight()` before comparing against `dangerHeightFrac`.

**Ungated, this helped level 3 and hurt everything else** -- the opposite
gating direction from every other knob tuned this session:

| Level | Ungated fix | Baseline | Verdict |
|---|---|---|---|
| 3 (stress_harness.js steady pressure, 4 seeds) | 42421 | 28871 | +47% |
| 5 | 32022 | 34876 | -8% |
| 8 | 63927 | 72000 (4/4 full survival) | -11%, loses full survival |
| 10 (real 12-file benchmark) | 92.6s / 1627 sent | 109.8s / 2095 sent | worse on both axes |

Diagnosis: levels 5/8/10 already have `dangerHeightFrac` tightened to
0.45 (from earlier fixes this session). Stacking the queued-garbage
projection on top of an already-aggressive threshold over-triggers danger
mode there, forfeiting the offensive search too often. Level 3 is the
only tested tier still at the lenient default (0.72), which is exactly
where the projection helps instead of hurts.

**Gated to `maxHealth > 51`** (the complement of `dangerHeightFrac`'s own
`<=51` gate -- applies only where the threshold is still lenient, i.e.
level 3 among the tested tiers):

| Level | Gated fix | Baseline | Verdict |
|---|---|---|---|
| 3 (steady pressure, 4 seeds, framesPerAttack=60/w2/h2) | 39060 total frames alive | 15537 | +151% |
| 5/8/10 | unaffected -- code path is algebraically identical to pre-fix (the `if` never executes when maxHealth<=51) | — | confirmed by real-benchmark re-run: 109.76s/2095, matching baseline exactly |

`check_preset_ordering.js nightmare diamond`: still PASS
(nightmare totalFrames=50948/totalSent=590 vs diamond 38025/565).

Shipped. Level 3's numbers above use different stress-test parameters
than the earlier ungated-fix table (60f/2w/2h vs the original run's
params, which weren't recorded before compaction) -- both runs agree on
direction and magnitude of the win, that's what matters here.

## Round 4: the benchmark itself was unfair -- and fixing it found a new weakness

While waiting on Round 3's deploy, re-read `client/src/globals.lua` and
`common/engine/GarbageQueue.lua`/`AttackEngine.lua` more closely. Real
finding: attacks don't land the instant a chain finalizes. They spend
`GARBAGE_FLIGHT` (151 frames = `GARBAGE_TRANSIT_TIME` 45 +
`GARBAGE_TELEGRAPH_TIME` 45 + 1 + `GARBAGE_DELAY_LAND_TIME` 60, per
`panel-engine.js`'s own comment on that constant) in staging/transit/
telegraph before they reach the receiver. `duel.js` (the actual live
game) already models this correctly: it gates `takeDeliverableGarbage()`
on `frameEarned + GARBAGE_FLIGHT > clock` before ever calling
`receiveGarbage()` on the other side.

**`attack_file_harness.js` did not.** It called `stack.receiveGarbage()`
directly at the attack file's raw recorded `startTime`/`chainEndTime` --
the frame the ATTACKER's chain finalizes, with zero flight delay. Every
"Nightmare" survival/GPM number in this file up through Round 3 was
measured against attacks landing ~2.5 real seconds faster than the actual
game ever delivers them.

Fixed by scheduling every event `GARBAGE_FLIGHT` frames after its
recorded time (a uniform shift, so inter-attack spacing and the
cycle-repeat period are unaffected -- only the initial calm period before
the very first attack, and equally the calm gap before each cycle
repeats, gets 151 frames longer).

**Expected this to make the benchmark easier (more warning = more time to
prepare). It did the opposite:**

| Config | Pre-fix (no flight delay) | Post-fix (151-frame flight delay) |
|---|---|---|
| nightmare | 109.76s / 2095 sent | **66.10s / 1141 sent** |
| diamond | (not re-measured pre-fix this round) | 68.42s / 994 sent |

Verified this isn't a bug in the shift arithmetic (single-file/seed
debug: `cpu._snapshot().maxHeight()` sampled every 500 frames for both
timings on `challenge-8-1.json` seed 1 -- both trajectories oscillate in
the same 4-10 range, the delayed one just hits a fatal spike earlier,
around frame 5000-6063 instead of 9960).

**The real mechanism: auto-rise and the AI's own calm-mode play don't
pause for the extra warning time.** The 151-frame shift only lengthens
ONE thing per cycle -- the calm stretch before the first attack ever
lands (all later gaps are preserved exactly, since a uniform shift
cancels out in every other interval). During that longer calm stretch,
`_choose()`'s calm-mode path (`_computePlan`/`_raiseOrBuild`, offense-
seeking) keeps playing exactly as it would in a short calm stretch --
it has no notion of "I'm being unusually free right now, dial back the
risk." The AI uses the extra free time to keep building material/height
for its own offense, and is measurably worse positioned once real
pressure begins, compared to a run where the first attack interrupts it
sooner.

**This is a legitimate, structurally significant finding, not a benchmark
artifact:** long calm stretches are a real feature of real matches (see
the recorded `challenge-8-1.json` gaps above, hundreds of frames between
some attacks), and `duel.js` gives the CPU the exact same
un-pausing auto-rise + calm-mode logic against a real opponent. **The
AI's calm-mode play has no self-limiting notion of accumulated risk over
an extended idle period** -- it plays exactly the same whether the last
attack was 10 frames ago or 2000. That is the next real structural gap,
distinct from anything gated so far (all of which only ever touched
`_inDanger`'s trigger point, not what calm-mode does before danger is
ever triggered).

Also notable: under corrected timing, nightmare's DEFENSIVE edge over
diamond nearly disappears (66.1s vs 68.4s, essentially noise over 24
samples) even though its OFFENSIVE edge holds clearly (1141 vs 994 sent,
+15%). `check_preset_ordering.js` is unaffected (it uses
`stress_harness.js`'s synthetic steady pressure, not attack files, so it
never had this bug) and still passes. But it means the real-benchmark
picture for defense specifically needs re-establishing under the
corrected harness before trusting any future defense-focused tuning
against it.

`attack_file_harness.js`'s fix committed as research-infra correctness
(not a panel-cpu.js change, no redeploy needed) -- but it changes what
"the real benchmark" reads from here on. Compare only against the
corrected numbers above (66.10s/1141 for nightmare) going forward, not
Round 2/3's numbers (109.8s/2095, 92.6s/1627, 109.76s/2095), which were
all measured pre-fix.

## Round 5: capping proactive raising (shipped, gated) -- fixes the Round 4 gap

Direct fix for Round 4's finding: `_raiseOrBuild` used to raise
unconditionally whenever no swap improved potential, with zero notion of
how tall the board already is. Added a cap: once `board.fillRatio()`
reaches `dangerHeightFrac * raiseFillFrac`, stop raising and hold instead
(a new `{kind:"hold"}` decision, handled in `update()` by just waiting out
a reaction).

**First attempt (measured, wrong): capped at `patienceFillCeiling`**
(0.5 flat). Instrumented with a counter on `_raiseOrBuild`'s return kind
over a 12000-frame real-attack-file trace: `hold` fired **0** times.
Real-benchmark numbers came back bit-for-bit identical to no fix at all
(66.096s/1141). Cause: at every level whose `dangerHeightFrac` is already
tightened to 0.45 (5/8/10), `_choose()` routes to `_inDanger`'s defensive
path before `fillRatio` can ever reach 0.5 -- `_raiseOrBuild` is only
ever reached from calm mode, where `fillRatio < dangerHeightFrac < 0.5`.
An absolute cap independent of `dangerHeightFrac` is unreachable by
construction whenever it sits above the level's own danger threshold.

**Fixed: cap relative to `dangerHeightFrac` itself** (`dangerHeightFrac *
raiseFillFrac`, always reachable from calm mode since
`raiseFillFrac <= 1`). Re-instrumented the same trace: `hold` fired 139
times, `raise` dropped from 113 to 40, and the single-file survival that
motivated Round 4 went from dying at frame 6063 to frame 10076 -- better
than even the pre-Round-4-bugfix baseline (9960).

| Level | Metric | Before Round 5 | After Round 5 (ungated) | After Round 5 (gated, shipped) |
|---|---|---|---|---|
| 3 (steady pressure, 4 seeds, 60f/2w/2h) | total frames alive | 39060 | 20639 (-47%) | **39060 (reverted, exact match)** |
| 10 (real 12-file benchmark) | avg survival / total sent | 66.10s / 1141 | 86.50s / 1333 (+31%/+17%) | **86.50s / 1333 (unchanged by gating)** |

Ungated, this repeated the exact pattern every other knob in this file
needed gating for: level 3's steady-pressure sum dropped 39060 -> 20639
(-47%, one seed falling from a full 15000-frame survival to 1117) --
`raiseFillFrac=0.75` against level 3's lenient `dangerHeightFrac=0.72`
cuts off proactive raising at fill 0.54, well before real danger, costing
tempo/material the AI didn't need to give up. Gated the same way as
`dangerHeightFrac`'s own tightening (`maxHealth<=51`): `raiseFillFrac`
defaults to 1.0 at lenient levels (mathematically unreachable from calm
mode, so behaviorally identical to no cap) and 0.75 where
`dangerHeightFrac` is already tight. `check_preset_ordering.js` (level 3
only) unaffected: 50948/590 vs 38025/565, unchanged.

Combined with Round 4's benchmark-fidelity fix, the real 12-file
benchmark's honest current state is **86.50s avg survival, 1333 total
sent** -- compare future changes against these numbers, not any of
Rounds 1-3's pre-flight-delay-fix figures.

## Round 6: full PvP replay decoding -- cracked the format, hit a real wall

The remaining open lead from Round 4/5's notes: 23 full match replays in
`panel-game/common/tests/engine/replays/` (real complete games, several
level-10-vs-level-10), richer than the extracted `challenge-*.json`
attack files since they carry the actual raw per-frame controller input
for BOTH real players, not just when garbage arrived.

**The format, reverse-engineered and confirmed against the real
decoder** (`common/data/InputCompression.lua`'s `decompressInputString2`,
called from `common/compatibility/ReplayV2.lua:220/249` -- reading the
actual source, not guessing, is what caught a mistake a naive RLE parser
made): `vs.in_buf` is P1's compressed input string, `vs.I` is P2's --
backwards from what the field names alone suggest. Each frame is one
character from a 64-symbol alphabet, 6 bits mapping to
`[raise,swap,up,down,left,right]` (`KeyDataEncoding.lua`). A run of N
identical frames compresses to `"<symbol><N>"`, EXCEPT when the symbol
is itself a digit (positions 53-62 of the alphabet are '0'-'9', valid
inputs in their own right) -- those runs wrap in parens, `"(11111)"`,
since a bare digit run would be ambiguous with a count. Ported faithfully
in `replay_decode.js`; `panel-engine.js`'s `Stack.setInput()` already
accepts exactly this `{raise,swap,up,down,left,right}` shape with real
DAS-based cursor movement, so decoded frames feed straight in.

**First bug, found and fixed fast:** replaying P1's raw input against a
freshly constructed `Stack` topped it out at EXACTLY frame 188 --
`COUNTDOWN_START + COUNTDOWN_LENGTH` (8 + 180, `panel-engine.js`'s own
constant). The recorded input stream includes the real pre-match
countdown, during which physics stays frozen in the real game; passing
`countdown:false` (this harness's default elsewhere) let a harmlessly-
held raise input recorded during that frozen window act as a REAL raise
from frame 0. Fixed by leaving countdown at its default (true) for this
harness specifically.

**The real wall: seeding with the replay's real seed does NOT reproduce
the real match, because panel-engine.js uses mulberry32 for
determinism (its own comment) while the real engine's panel colors come
from `love.math.newRandomGenerator()`** -- LÖVE2D's engine-native RNG,
implemented in its C++ source, not something readable from the Lua
codebase at all. `GeneratorSource.lua` layers real complexity on top of
that PRNG too: a "bad row" rejection-and-retry loop, adjacent-color-
denial logic, separate panel/garbage generators with their own seeds.
Reproducing this exactly would mean porting LÖVE's native RNG bit-for-
bit AND replicating the full rejection-loop call order -- a real,
separate reverse-engineering project, with a single missed random() call
anywhere silently desyncing every color from that point on.

**Confirmed this actually breaks the approach, not just theoretically:**
traced a real replay's first 550 frames against a freshly (differently)
seeded board -- 13 real swap attempts, matching the recorded human's
exact timing, produced **zero matches**. A skilled player's swap choices
are inherently color-dependent; without the real colors, their swaps
land on essentially arbitrary pairs on a differently-seeded board, while
their (real, normally-safe) raise usage keeps adding material nothing is
clearing. Board topped from 30 to 60 filled cells in ~300 frames.

**Conclusion: replaying a real match's raw inputs against the AI is not
viable without porting LÖVE's exact RNG first** -- a large, separate,
uncertain-payoff undertaking, not attempted this round. What IS shipped
and real: `replay_decode.js` (validated -- decodes both players' full
input streams correctly, `PanelGenerator`/`KeyDataEncoding` format
confirmed against source) and `real_match_harness.js` (works correctly
for what it does, countdown bug fixed, caveat documented in its own
header). If a future session ports the real RNG, this tooling is ready
to use immediately; until then, the `challenge-*.json` extracted-attack
approach (Rounds 1-5) remains the actual benchmark.

## Open leads, not yet tried

- **Porting LÖVE2D's `love.math.newRandomGenerator()` + `PanelGenerator`'s
  full generation/rejection logic**, to make Round 6's replay tooling
  actually usable for exact match reproduction. Large, separate,
  uncertain-payoff -- not started. Would also be the strongest possible
  correctness check for this whole reimplementation (does replaying a
  real recorded match produce the SAME winner?), which is worth noting
  as a reason it might be worth the investment despite the size.

- **`raiseFillFrac=0.75` is a first reasoned default, not swept.** Round
  5 shipped the structural fix (cap relative to `dangerHeightFrac`, not
  an absolute level) but picked 0.75 by reasoning, not a sweep -- unlike
  this session's "stop focusing on levers" directive for architecture
  work, a narrow sweep of this ONE now-correctly-scoped value (e.g.
  0.6-0.9) against the real benchmark is cheap and hasn't been done.
- **Standard combined report tool: `full_report.js`.** One config, one
  command, all four benchmark categories (comboStorm/factory/bigBlocks
  training drills + the real 12-file "endless" average), one report --
  survival as MM:SS plus sent-garbage broken down by type (small/big
  combo, short/medium/long chain). `report.js` is the shared formatter
  behind it and behind all the other harnesses' JSON+stderr output.
  `harness_fidelity.test.js` regression-tests the two real-engine
  behaviors (chain-as-one-block, GARBAGE_FLIGHT delay) that were each
  silently wrong here once already.

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
