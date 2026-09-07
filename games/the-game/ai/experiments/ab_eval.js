// A/B: THE SHIPPED SCORING vs THE FROM-SCRATCH EVALUATOR, SAME SEEDS,
// SAME PROCESS, SAME ENGINE.
//
// Usage: node ab_eval.js [weightsFile] [seeds] [level]
//   level defaults to 3, and that is not arbitrary: SearchCpu._evaluate —
//   the seam ../eval replaces — is only called on the offensive search
//   path. At maxHealth<=21 the cpu routes through TrueSurvivalSearch and
//   the defensive tiers instead, and _evaluate is never called at all.
//   Measured over 1500 frames of steady pressure: level 3 -> 7519 calls,
//   level 5 -> 0, level 8 -> 0, level 10 -> 15. Running this A/B at L10
//   produces a perfect tie no matter what the weights are, which looks
//   exactly like "no difference" and is really "not measuring anything".
//   weightsFile: JSON of ../eval weights (a GA genome's eval_* fields, or
//                a plain {feature: number} object). Omit to run the inert
//                evaluator, which should tie with the shipped scoring and
//                is the sanity check that this harness measures anything.
//
// NOT A NEW HARNESS. ga_core.js already drives the real panel-engine.js and
// panel-cpu.js against the L10 bigBlocks drill that full_report.js
// validates against, with timing-safety rejection built in. Writing a
// fourth harness to answer "is the new scoring better" would mean tuning
// against a benchmark nobody else uses — this repo has already paid for a
// misleading synthetic benchmark once (FINDINGS.md). This runs the
// established one twice.
//
// Why both arms in ONE process: attach.js returns a detach(), so the same
// loaded engine, the same prototypes and the same seeds serve both. Two
// separate invocations would differ by whatever else the process picked up,
// and the difference being measured here is often small.
var path = require('path');
var fs = require('fs');

function run(evalOn, weights, seeds, level) {
  process.env.GC_EVAL_LEVEL = String(level);
  // ga_core reads GC_EVAL_WEIGHTS at require time, so each arm gets its own
  // freshly-required copy. Deleting it from the cache is what makes "same
  // process" possible without the flag leaking between arms.
  process.env.GC_EVAL_WEIGHTS = evalOn ? '1' : '';
  Object.keys(require.cache).forEach(function (k) {
    if (k.indexOf('ga_core.js') >= 0 || k.indexOf('/eval/') >= 0) delete require.cache[k];
  });
  var core = require('./ga_core.js');
  var genome = core.defaultGenome();
  if (evalOn) {
    core.EVAL_KEYS.forEach(function (k) {
      var name = k.slice(5);
      genome[k] = (weights && (weights[k] !== undefined ? weights[k] : weights[name])) || 0;
    });
  }
  var out = [];
  seeds.forEach(function (seed) {
    var r = core.runOneSeed(genome, seed);
    out.push(r);
  });
  var frames = out.map(function (r) { return r.frames; });
  return {
    frames: frames,
    avg: frames.reduce(function (a, b) { return a + b; }, 0) / frames.length,
    worst: Math.min.apply(null, frames),
    unsafe: out.filter(function (r) { return r.unsafe; }).length,
    errors: out.filter(function (r) { return r.evalError; }).map(function (r) { return r.evalError; })
  };
}

var weightsFile = process.argv[2];
var weights = null;
if (weightsFile && weightsFile !== '-') {
  weights = JSON.parse(fs.readFileSync(weightsFile, 'utf8'));
  // accept a whole GA genome or a bare weights object
  if (weights.genome) weights = weights.genome;
}
var seedCount = Number(process.argv[3] || 15);
var level = Number(process.argv[4] || 3);
var seeds = [];
for (var i = 1; i <= seedCount; i++) seeds.push(i);

var shipped = run(false, null, seeds, level);
var evaluator = run(true, weights, seeds, level);

if (evaluator.errors.length) {
  console.error('evaluator refused to attach: ' + evaluator.errors[0]);
  process.exit(2);
}

var delta = evaluator.avg - shipped.avg;
var pct = shipped.avg ? (delta / shipped.avg) * 100 : 0;
console.log(JSON.stringify({
  level: level,
  seeds: seeds.length,
  weightsFile: weightsFile || '(all zero — inert)',
  shipped: { avg: Math.round(shipped.avg), worst: shipped.worst, unsafe: shipped.unsafe },
  evaluator: { avg: Math.round(evaluator.avg), worst: evaluator.worst, unsafe: evaluator.unsafe },
  delta: Math.round(delta),
  pct: Number(pct.toFixed(1)),
  verdict: Math.abs(pct) < 1 ? 'tie' : (delta > 0 ? 'evaluator better' : 'shipped better')
}, null, 2));
