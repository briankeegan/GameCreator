// Shared GA logic: the weight spec, genome<->opts conversion, and the
// per-genome fitness evaluator (the real L10 bigBlocks drill, identical
// mechanics to full_report.js's runTrainingMode). Used by both the
// orchestrator (train_ga.js) and the parallel workers (ga_worker.js) so
// there's exactly one copy of "what a genome means" and "how fitness is
// measured" -- see train_ga.js's header comment for why this runs
// against the real engine instead of a Python reimplementation.
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = global.PanelEngine;
var PanelCpu = global.PanelCpu;

exports.SEEDS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
exports.STACK_LEVEL = 10;
var TIMING_MARGIN_MS = 85;

var LEAD_IN = 150, BURST_LEN = 50, GAP = 900;
var CYCLE = GAP + BURST_LEN;
// NOT a quality cap -- explicitly rejected as one. An earlier version of
// this capped fitness evaluation at 6000, then 9000 frames "for search
// speed," on the theory that every genome that matters dies well before
// that. That reasoning breaks the moment training actually works: a
// genome that survives long enough to brush the cap gets its fitness
// silently truncated and under-ranked against a genome that's actually
// worse but happens to die first, exactly backwards from what a fitness
// function is for. A genome is scored by when it actually dies, full
// stop. This is a hang-guard only, sized to never matter in practice --
// 120000 frames is 33 simulated minutes, ~30x the longest survival seen
// so far (~4000f) -- there purely so a genuinely unkillable genome (a
// real engine bug, not "good AI") can't hang a background training run
// forever.
var TRAINING_CEILING = 120000;
function fires(f) {
  if (f < LEAD_IN + 1) return false;
  var posInCycle = (f - LEAD_IN - 1) % CYCLE;
  return posInCycle < BURST_LEN;
}

// [min, max, isInt, default]
var WEIGHT_SPEC = {
  // reaction/depth defaults are the L10-TIGHTENED values panel-cpu.js's
  // constructor actually applies at maxHealth<=1 (reaction: min(12,8)=8;
  // depth: max(4,5)=5 at maxHealth<=21) when the caller leaves them
  // unset -- NOT the raw nightmare preset's 12/4. Using the preset's raw
  // values here would make "defaultGenome()" not actually reproduce the
  // currently-shipped L10 behavior, which is the whole point of seeding
  // the population with it.
  reaction:            [2, 40, true, 8],
  depth:               [1, 6, true, 5],
  beam:                [2, 16, true, 10],
  patience:            [0, 1, false, 0.85],
  patienceFillCeiling: [0.1, 1, false, 0.5],
  // Upper bound widened 0.9 -> 0.98 after round 3's winner (shipped
  // candidate: 2391avg) landed exactly on the old 0.9 ceiling -- a
  // search bound a genome pins against is a bound that's actively
  // costing quality, not a safe default. 1.0 itself is avoided since
  // dangerHeightFrac gates board.fillRatio() comparisons that are
  // meant to distinguish "dangerous" from "totally full."
  dangerHeightFrac:    [0.2, 0.98, false, 0.45],
  raiseFillFrac:       [0.3, 1.0, false, 0.75],
  chainWeight:         [50, 800, false, 380],
  comboWeight:         [10, 200, false, 70],
  garbageWeight:       [10, 300, false, 90],
  heightPenalty:       [5, 200, false, 60],
  potentialWeight:     [0, 50, false, 5],
  criticalFactor:      [0, 1, false, 0.5],
  runwayThreshold:     [1, 8, true, 3],
  toppedOutCooldown:   [1, 8, true, 1],
  queuedRunwayWeight:  [0, 1, false, 0.75],
  // Upper bound widened 20 -> 32 after round 3's winner pinned exactly
  // at 20 -- same reasoning as dangerHeightFrac above.
  rescueBranchCap:     [2, 32, true, 10],
  dropAmountWeight:    [0, 1000, false, 200],
  pressureThreshold:   [1, 40, false, 15],
  sentWeight:          [0, 10000, false, 5000]
};
// TrueSurvivalSearch's own structural knobs -- how far ahead each
// candidate is simulated, how many candidates are considered, and how
// many of them get the expensive follow-up ply. These govern the actual
// foresight of the search; the WEIGHT_SPEC fields above only govern how
// the plausible-continuation policy plays WITHIN that foresight window.
// Round 1 of this GA (searching WEIGHT_SPEC alone, module defaults
// ROLLOUT_DEPTH=20/ROLLOUT_SWAP_CAP=20/ROLLOUT_FOLLOWUP_RANK_CAP=2 held
// fixed) plateaued at 1806avg -- BELOW the already-shipped 1830avg -- by
// generation 2 of 15 and never moved again. That's a strong signal the
// continuation-policy weights aren't the bottleneck at a fixed 20-frame
// horizon; these structural knobs are module-level constants on
// PanelCpu.TrueSurvivalSearch, not per-cpu opts, so they're applied by
// temporarily overwriting them for the duration of one seed's run and
// restoring them in a finally block.
var STRUCTURAL_SPEC = {
  rolloutDepth:          [8, 40, true, 20],
  rolloutSwapCap:        [5, 30, true, 20],
  // Upper bound widened 6 -> 10 after round 3's winner found 5 --
  // getting close enough to the old ceiling to widen it preemptively
  // (same reasoning as dangerHeightFrac/rescueBranchCap above). The
  // per-genome timing-safety check already rejects any config that
  // can't afford the extra cost, so widening this can't ship anything
  // unsafe -- it can only let the search find MORE cost if the budget
  // allows it.
  rolloutFollowUpRankCap:[1, 10, true, 2]
};
var STRUCTURAL_TO_MODULE_FIELD = {
  rolloutDepth: 'ROLLOUT_DEPTH',
  rolloutSwapCap: 'ROLLOUT_SWAP_CAP',
  rolloutFollowUpRankCap: 'ROLLOUT_FOLLOWUP_RANK_CAP'
};
exports.STRUCTURAL_KEYS = Object.keys(STRUCTURAL_SPEC);
exports.STRUCTURAL_TO_MODULE_FIELD = STRUCTURAL_TO_MODULE_FIELD;

var FULL_SPEC = Object.assign({}, WEIGHT_SPEC, STRUCTURAL_SPEC);
exports.WEIGHT_SPEC = FULL_SPEC;
exports.KEYS = Object.keys(FULL_SPEC);

exports.defaultGenome = function () {
  var g = {};
  exports.KEYS.forEach(function (k) { g[k] = FULL_SPEC[k][3]; });
  return g;
};

exports.genomeToOpts = function (g) {
  var opts = { difficulty: 'nightmare', mistake: 0, chainExtend: true };
  Object.keys(WEIGHT_SPEC).forEach(function (k) { opts[k] = g[k]; });
  return opts;
};

function applyStructural(genome) {
  var saved = {};
  exports.STRUCTURAL_KEYS.forEach(function (k) {
    var field = STRUCTURAL_TO_MODULE_FIELD[k];
    saved[field] = PanelCpu.TrueSurvivalSearch[field];
    PanelCpu.TrueSurvivalSearch[field] = genome[k];
  });
  return function restore() {
    Object.keys(saved).forEach(function (field) {
      PanelCpu.TrueSurvivalSearch[field] = saved[field];
    });
  };
}

function runOneSeed(genome, seed) {
  var opts = exports.genomeToOpts(genome);
  opts.seed = seed + 55;
  var stack = new PanelEngine.Stack({ level: exports.STACK_LEVEL, seed: seed, countdown: false });
  var cpu = new PanelCpu.SearchCpu(stack, opts);
  var origChoose = PanelCpu.SearchCpu.prototype._choose;
  var localMax = 0;
  PanelCpu.SearchCpu.prototype._choose = function (board) {
    var t0 = Date.now();
    var r = origChoose.call(this, board);
    var dt = Date.now() - t0;
    if (dt > localMax) localMax = dt;
    return r;
  };
  var restoreStructural = applyStructural(genome);
  var f;
  try {
    for (f = 0; f < TRAINING_CEILING; f++) {
      if (fires(f)) stack.receiveGarbage([{ width: 6, height: 12, isChain: false }]);
      cpu.update();
      stack.run();
      stack.takeDeliverableGarbage();
      stack.drainEvents();
      if (stack.gameOver) break;
      if (localMax > TIMING_MARGIN_MS) break;
    }
  } finally {
    PanelCpu.SearchCpu.prototype._choose = origChoose;
    restoreStructural();
  }
  return { frames: f, localMax: localMax, unsafe: localMax > TIMING_MARGIN_MS };
}

exports.evaluate = function (genome) {
  var total = 0, maxSeen = 0;
  for (var i = 0; i < exports.SEEDS.length; i++) {
    var r = runOneSeed(genome, exports.SEEDS[i]);
    if (r.localMax > maxSeen) maxSeen = r.localMax;
    if (r.unsafe) return { fitness: 0, unsafe: true, maxTiming: maxSeen };
    total += r.frames;
  }
  return { fitness: total / exports.SEEDS.length, unsafe: false, maxTiming: maxSeen };
};
