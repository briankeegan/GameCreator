# Nightmare AI survival research — findings log

Working log for the "make the AI survive as long as possible" investigation.
Read this before repeating any of the dead ends below.

## Working rules (guardrails)

- **Every scenario is run through `full_report.js`, never a one-off
  script.** `node full_report.js [difficulty|cfgJSON] [levels] [seed]
  [endlessMaxFrames] [categories]` -- `levels` and `categories` are how
  you scope it (e.g. `10` and `bigBlocks`). A hand-rolled bash/node
  probe is fine for DIAGNOSING why a number is what it is, but the
  number itself -- the thing reported back -- always comes from this
  tool, so every run is comparable to every other run.
- **When told to focus on one level and/or one category, test ONLY
  that level/category and report ONLY those numbers.** Do not run the
  other three levels or the other three categories "while you're at
  it," and do not fold in real-benchmark or other-level results
  unprompted. Report the requested numbers, then stop -- next scope
  change comes from the user, not from noticing something else
  interesting.
- A fix that helps the requested scope but changes behavior somewhere
  OUT of scope (a different level, the real benchmark) gets gated to
  the requested scope specifically, not shipped broadly, unless told
  otherwise.

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

## Round 7: ported the real RNG -- the Round 6 wall is down

Round 6 concluded the LÖVE-native RNG was a large, separate,
uncertain-payoff undertaking. Checked anyway (public source, not a black
box): `love.math.newRandomGenerator()` is **xorshift64\***, a well-known,
fully documented algorithm, seeded via Thomas Wang's 64-bit hash. Full
algorithm confirmed against LÖVE's actual public source
(`love2d/love` on GitHub, `src/modules/math/RandomGenerator.cpp/.h` +
`wrap_RandomGenerator.lua`):
1. `setSeed(seed)`: state = `wangHash64(seed)`, repeated while 0.
2. `rand()`: `s^=s>>12; s^=s<<25; s^=s>>27; return s*2685821657736338717`
   (mod 2^64 throughout).
3. `random()` -> double in [0,1): top 52 bits of `rand()` OR'd into an
   IEEE-754 exponent field, bit-cast to double, minus 1.
4. `random(min,max)`: `floor(random() * (max-min+1)) + min`
   (`wrap_RandomGenerator.lua`'s `getrandom` -- floor, not round).

Ported to `love_rng.js` (JS `BigInt` for the 64-bit arithmetic, a
`DataView` for the bit-cast). Then found the SECOND piece needed: the
real `046`-engine replays (Round 6's files) predate the modern
`GeneratorSource` and use `common/compatibility/LegacyPanelGenerator.lua`
+ `LegacyPanelSource.lua` instead -- a different, simpler generation
algorithm (flat allow/disallow-adjacent boolean, no probabilistic
`adjacentDenialFrequency` tracking, a `generatedCount`-driven re-seed
scheme where each new batch re-seeds as `seed + panelGenCount` rather
than continuing one stream). Ported both (`legacy_panel_gen.js`,
`legacy_panel_source.js`).

**Validated against the real engine's OWN test suite**
(`panel-game/common/tests/engine/PanelGenTests.lua`), not self-derived
expectations -- copied its literal expected strings and checked this
port reproduces them bit for bit. 9 of 10 independent vectors pass,
including two 100-row-long generations with metal-panel assignment
(`love_rng.test.js`, gated the same way `harness_fidelity.test.js` is).
One vector (`testLegacyStartingBoard4`, seed 4530333, a seed the test's
own comment says was chosen to probe a historical edge-case bug) does
not reproduce -- installed Lua 5.3 in-sandbox, ported the SAME RNG
algorithm independently in native Lua, and ran the REAL unmodified
`LegacyPanelGenerator.lua`/`LegacyPanelSource.lua` source files (not a
reimplementation) against it: they produce the exact same output this
JS port does, not the fixture's asserted string. That rules out a
translation bug in this port; most likely explanation is a stale
assertion in that one fixture in this checkout. Documented, not silently
dropped -- see `love_rng.test.js`'s own comment.

**This closes Round 6's wall for the pieces it covers**, but full
match-replay reproduction needs one more piece, not yet done: wiring
these generators into `panel-engine.js`'s actual row-creation call
sites. `panel-engine.js`'s own `generateRowColors`/`buildStartingBoard`
already port a DIFFERENT algorithm (the modern `GeneratorSource`'s
bad-row-reroll + probabilistic adjacent-denial scheme, not Legacy's) --
so the fix isn't swapping its RNG source, it's bypassing its color
SELECTION entirely for a real-replay run and directly assigning
`panel.color` from this port's output at each of panel-engine.js's
several row-creation points (starting board, auto-rise, garbage-
converted rows), timed to match the real re-seed-per-batch scheme. That
integration work is real but now unblocked -- the hard, uncertain part
(the RNG itself) is done and validated.

## Round 8: the rescue chain was blowing its own real-time budget on real boards

Round 5's `full_report.js` fix (labeling every section by level, per an
explicit correction that an earlier report silently dropped level from
its summary) surfaced level 8/10 numbers for the first time. Getting
there required instrumenting `_bestDefensiveMove` directly against a
real recorded attack file (`challenge-8-4.json`, level 10) -- and found
calls taking up to **225ms**, more than 2x the ~100ms real-time decision
budget this file's own comments had been asserting was safe. Traced to
`_nPlyRescue`'s depth-2/3/4 fallback chain (`_bestDefensiveMove`'s "true
last resort"), up to 202ms in a single call. Correlated directly with
`board.fillRatio()` climbing toward 1.0 -- exactly the near-topped-out
boards where a slow decision is most dangerous.

**Root cause:** `rescueBranchCap` (Round-earlier, 6->10 at
`maxHealth<=21`) bounds branching but not `legalSwaps()` itself, which
scales with board occupancy. The "62ms worst-case, safe" claim made when
`rescueBranchCap=10` shipped was measured against synthetic boards, not
real ones, and simply didn't cover a board this dense.

**First attempt (reverted): a `Date.now()` wall-clock deadline.** Fixed
the timing violation (confirmed: maxBDM 225ms -> 75ms on the exact
file/level that found the bug, 0 over-budget calls across 178 rescue
invocations) but introduced a worse problem -- the AI's own decisions
became dependent on host machine load, not just board state. Proof: the
identical 12-file, seed-1, level-8 benchmark gave 741 cells sent at a
70ms deadline and 651 at a 90ms deadline in back-to-back runs on the
same otherwise-idle sandbox. A WIDER time budget scoring worse than a
narrower one is not a real effect; it's measurement noise from whatever
else the machine happened to be doing at the moment each decision ran.
An AI whose strength varies with unrelated background load can't be
tuned, benchmarked, or have a bug report reproduced against it -- the
exact "invariant-shaped non-invariant" trap `docs/DOOR_STANDARD.md` §6
warns about, in a new place.

**Shipped fix: a deterministic eval-count budget instead of wall-clock
time.** `_nPlyRescue`'s depth-2/3/4 fallback chain now shares one
`{ used, max }` counter of board evaluations (clone+swap+resolve),
checked on entry to each recursion node and partway through its swap
loop. Same board, same seed -> same result, on every machine, every
time -- while still bounding real wall time in practice, because
per-evaluation cost is itself bounded (instrumented on the same real
file/level: 0.0034-0.0079ms/eval depending on board fill, the same
occupancy-scaling root cause as the timing bug). Picked
`rescueEvalBudget=10000` by testing the actual boundary: 13000 evals hit
100ms exactly (zero margin, rejected); 10000 gave 79ms with real headroom
on the worst real board found so far.

**Cost, measured and accepted, not hidden:** the eval cap is strictly
tighter than the old *unsafe* unbounded search on dense boards, so it
gives up some of the quality that unsafe search was buying. Same 12-file
real benchmark, `maxFrames=15000`, seed 1:
- L8: 103.7s avg / 847 sent (unbounded, unsafe) -> **96.7s / 689 sent**
  (capped, safe) -- reproduced identically across two back-to-back runs.
- L10: 86.7s avg / 641 sent (unbounded, unsafe) -> **73.1s / 605 sent**
  (capped, safe).

This is the deliberate trade a real-time decision budget requires: an
AI that occasionally takes 225ms to decide is not a valid solution
regardless of what it scores on an offline benchmark, because a real
browser can't wait that long between frames. The numbers above are the
honest cost of enforcing that, on the exact real files that exposed the
violation -- not a regression to chase back down without also
reintroducing the timing bug. Verified against
`check_preset_ordering.js`, `love_rng.test.js`, and
`harness_fidelity.test.js` (all still pass).

**Tried and rejected: fair-sharing the eval budget across sibling
branches.** Plain DFS-with-a-global-cutoff has an obvious-looking flaw:
`unmatched` branches are explored in strict potential-ranked order, so
an expensive dead-end first branch can burn the *entire* budget before
its siblings (the 2nd/3rd-best first move) ever get tried. The fix
looked structural, not a lever: give each branch a fair, shrinking slice
of whatever budget remains (nested at every recursion depth, not just
the top) instead of letting the first branch spend everything. Measured
worse, not better -- same 12-file L8 benchmark, deterministic across two
runs both ways: 96.7s/689 sent (plain DFS, shipped) vs **89.5s/624 sent
(fair-shared, rejected)**. Root cause understood after the fact: a real
rescue combo usually needs several plies lined up in sequence to
materialize, and `boardPotential` ranking already steers the DFS at the
top-ranked branch correctly often enough that spending the *whole*
budget going deep on it beats spending a *thin slice* of budget on many
branches that each individually don't reach far enough to find anything.
Depth matters more than breadth here. Reverted; not shipped.

**Tried and rejected: narrowing rescueBranchCap specifically at high
fillRatio, to buy the eval budget more depth on the dense boards it's
tightest on.** Sounds like the natural complement to the fair-share
result above (if breadth doesn't help, spend less of the budget on it)
-- measured the opposite. Swept three configs
(threshold=0.75/cap=5, threshold=0.75/cap=3, threshold=0.6/cap=5)
against the same 12-file L8 benchmark; every one was worse than the
unconditional cap=10 baseline (689 sent), the worst by nearly half
(365 sent at threshold=0.75/cap=5). Reconciles with the fair-share
result rather than contradicting it: `legalSwaps()` is exactly LARGEST
at high fillRatio (more occupied cells, more candidate swaps), so a
narrower cap there discards more genuinely-good candidate first moves
than it does anywhere else on the board -- the opposite of where a
breadth cut is cheap. Depth-vs-breadth in this search isn't a dial to
tune per state; the existing flat cap already sits closer to right than
either direction tried. Reverted; not shipped.

## Round 9: the board can go permanently dead, and the fix has to act before it does

Delivering the level-by-level real-benchmark report `full_report.js` was
now producing surfaced a much sharper question than "how many seconds does
it survive": each real `challenge-8-*.json` file's `extraInfo.matchLength`
is the actual recorded human's own survival time against that exact real
level-8 attack pattern, which then **loops forever**
(`disableQueueLimit`/`delayBeforeRepeat`). That is the real success bar --
not an arbitrary averaged number, but "does the AI survive at least as
long as a real human did on this exact file." Checked against all 12
files at level 8 (nightmare): **6 of 12 lost outright** (died before the
human's own recorded time) -- challenge-8-1/5/6/7/8/10.

**Root cause, confirmed not guessed:** every one of the 6 losses shares
the same signature -- `board.fillRatio()` pinned at 1.0, `wasToppedOut`
true, health draining to 0 over 50-100+ consecutive frames with ZERO
legal swaps anywhere producing a match. Direct instrumentation on
`challenge-8-5` (dies at 74.85s vs the human's 193s) found the exact
death board: 46 of 72 cells garbage (64%), the surviving real panels
split into small pockets by full-width garbage rows, none of which
contains 3 of the same color. Proved this isn't a search-quality problem
by running `_nPlyRescue` UNCAPPED (no budget, no branch cap) at
increasing depth on that exact board: depth 6 (865,694 evaluations, ~8
seconds -- absurdly beyond any real-time budget) still found **nothing**.
The board is mathematically dead. No search, at any depth, can rescue a
position where the answer doesn't exist. All 5 other losses show the
same signature (checked directly: 375-770-frame streaks with zero legal
matches, 63-74% garbage at death).

This reframes the whole problem: a fix that scores candidate moves
better **at the moment of crisis** cannot work, because by then there
are no good candidates left to score -- confirmed by three attempts
below, each individually reasonable, each measured to do nothing or
worse:

**Tried and rejected: `hasFullyGarbageRow` forcing `_inDanger` true.** A
row that's 100% garbage is a permanent wall (no match can ever cross
it -- see the comment left on `LogicalBoard.hasFullyGarbageRow` briefly
in-tree during this round). Reasoned that reacting to a wall's mere
EXISTENCE, sooner than fillRatio alone would, should help. It doesn't:
`_inDanger` is **already true from frame 0** at level 8 (dangerHeightFrac
0.45 is below the starting board's own 0.583 fillRatio), so `_choose`'s
calm-mode path is essentially unreachable at this tier and the trigger
is entirely redundant. Confirmed by direct diagnosis: `challenge-8-1`'s
death frame was bit-for-bit identical (3253 frames, 27 sent) with and
without the trigger. Measured net negative on the full 12-file set (two
previously cap-surviving files started dying early). Reverted.

**Tried and rejected: a `sealsBroken` tiebreak in `_defensiveKey`.**
Reward matches that reduce the fully-garbage-row count, as a modest
tiebreak alongside the existing `garbageCleared`/`chainBonus` terms.
Measured as a complete no-op -- identical outcomes on all 12 files,
bit-for-bit, at every weight tested including deliberately extreme ones.
Reverted.

**Tried and rejected: `strandedRealPanelCount`, a connectivity/flood-fill
penalty for "building" (non-matching) moves.** The most structurally
promising-looking of the three: flood-fill the board's non-garbage cells,
penalize a candidate move that leaves more real panels outside the
largest connected pocket. First wiring (into `_bestDefensiveMove`'s
per-ply beam `ev` scoring) was **also** a complete no-op even at an
absurd weight (100000) -- traced to a real bug: that scoring is entirely
discarded whenever nothing matches at any ply, falling through to a
SEPARATE `gainMove` loop (plain `boardPotential(trial)-base`, recomputed
from scratch) that never consulted it. Fixed the wiring to apply the
penalty there too -- **still zero effect**, even at the same extreme
weight. The actual reason, found by direct measurement: a non-matching
swap NEVER touches a garbage cell (`legalSwaps()` explicitly excludes
any swap involving one), so garbage placement -- and therefore
`strandedRealPanelCount` -- is **structurally invariant** across every
candidate in that branch. The metric can never differentiate the moves
it was scoring, at any weight, because the thing it measures cannot
change without a match. Both attempts reverted; the underlying
LogicalBoard helper deleted rather than left as dead infrastructure.

**Shipped fix: `queuedRunwayWeight`, using garbage the search already
had access to but wasn't using.** `_queuedGarbageHeight()` (Round 3's
helper, summing `this.stack.incoming` -- garbage already committed and
in flight, ~151 frames out via `GARBAGE_FLIGHT`, but not yet landed) was
only ever wired into `_inDanger`'s danger-mode trigger, and even there
only at `maxHealth>51` (Round 3 found it over-triggered defense at the
tighter tiers). It was never wired into anything that decides WHAT TO DO
about incoming pressure -- only whether to be worried about it. This
round wires it into `_bestDefensiveMove`'s `runwayLow` check instead:
`projectedRunway = board.runwayHeight() - _queuedGarbageHeight() *
queuedRunwayWeight`, so the AI raises proactively (buying a fresh row of
real material) while there's still time and room, instead of waiting
until the runway is already gone and the board is already fragmenting.
This is the one lever, among four tried, that changes EARLY-game
decisions (before a crisis, while raising is still safe and useful) --
which is the only place a fix for a many-moves-in-the-making death can
actually act.

**Sweep was highly non-monotonic** (small weight changes cascade into
very different move sequences and RNG draws downstream -- not a smooth
dial): 0/0.25/0.5/0.6/0.75/0.85/1/1.5/2/4 tested against the real 12-file
benchmark at level 8. 0.25 (8 losses) and 0.6 (7 losses) were both worse
than baseline's 6; **0.75 measured best (5 losses)**.

| Level 8 file | Baseline (w=0) | w=0.75 | Human target |
|---|---|---|---|
| challenge-8-1 | LOST 3253f | **WIN 14040f (survived)** | 10440f |
| challenge-8-5 | LOST 4491f | LOST 4235f | 11580f |
| challenge-8-6 | LOST 3991f | **WIN 7980f (survived)** | 4380f |
| challenge-8-7 | LOST 7373f | LOST 3089f | 10440f |
| challenge-8-8 | LOST 2542f | LOST 1965f | 5460f |
| challenge-8-10 | LOST 1809f | **beat human, 4292f** | 3360f |
| challenge-8-4 | WIN 9000f (survived) | **LOST 2312f (regressed)** | 5400f |
| challenge-8-11 | beat human, 3417f | **LOST 1316f (regressed)** | 2940f |

Net: 6 losses -> 5, recovering 3 (1/6/10) at the cost of regressing 2
(4/11) that were previously fine -- a real, measured, **partial** win,
not a total fix. Level 10 fared better with the same 0.75 (no sweep
re-run there, same value reused): baseline 7 losses -> 5 with the fix,
4 files recovered (3/4/10/11) against 2 regressed (6/8) -- a cleaner net
gain than level 8's trade.

**Shipped gated to `maxHealth<=21`** (same tier as `rescueBranchCap`/
`depth`, the only tier measured) -- `queuedRunwayWeight` defaults to 0
(old, purely-reactive behavior) everywhere else. Timing verified safe
throughout (max `_bestDefensiveMove` observed 79-95ms across the round's
variants, comfortably under the ~100ms budget; proactive raising if
anything makes decisions cheaper on average, since it keeps boards from
reaching the dense states `_nPlyRescue` is expensive on). Verified
against `check_preset_ordering.js`, `love_rng.test.js`, and
`harness_fidelity.test.js` (all pass).

**Still open:** 5 of the original 6 level-8 losses remain (only 3
recovered net of the 2 regressions). challenge-8-5/7/8 never improved
under any tested weight. The failure mode is understood and real
(permanently dead boards from garbage fragmentation) but the fix found
so far only partially prevents reaching it -- next steps belong in "Open
leads" below: a genuinely richer use of `stack.incoming` (not just a
scalar height sum, but WHERE a pending block will land and whether it
would seal a specific row) is the more direct fix this round's
`queuedRunwayWeight` only approximates.

## Open leads, not yet tried

- **A genuinely position-aware use of `stack.incoming`.** Round 9's
  `queuedRunwayWeight` treats incoming garbage as a scalar height, fed
  into ONE decision (raise vs. search). The actual mechanism it's
  fighting -- a pending block landing and sealing a row -- is about
  WHICH columns/rows it will occupy, information `stack.incoming`
  already carries (`{width,height,isChain}`) but nothing reads yet. A
  search that could simulate "if this specific pending block lands
  where the engine will place it, does any real panel get sealed off
  unmatchably" could target the exact mechanism instead of a proxy for
  it, and might recover the remaining 3 level-8 losses (5/7/8) that
  `queuedRunwayWeight` never touched.
- **Wire `love_rng.js`/`legacy_panel_gen.js`/`legacy_panel_source.js`
  into `panel-engine.js`'s row-creation** (see Round 7's last paragraph)
  to actually enable exact real-match reproduction end to end --
  `real_match_harness.js` could then seed both stacks with real colors
  instead of the current mulberry32 substitute, making replaying a real
  recorded human's raw inputs against the AI (Round 6) finally viable,
  and giving the whole reimplementation its strongest possible
  correctness check (does replaying a real match produce the SAME
  winner?).

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
