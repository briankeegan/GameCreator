// THE GATE for a bug class that has now bitten twice: a "hardest" AI
// preset silently performing NO BETTER than a weaker one, because the
// knobs that actually govern behavior under real pressure (danger-mode
// thresholds, not just reaction/depth/beam) never got exercised or
// tuned. First time: nightmare's reaction/depth/beam/mistake were all
// being overridden or capped once _inDanger() was true, and nobody had
// ever actually run nightmare through stress_harness.js to notice
// (e734966). Second time: once those knobs were exposed as real
// instance properties, nightmare's VALUES for them were still copy-
// pasted identical to diamond's, so exposing the knobs changed nothing
// on its own — a preset with different fields but the same numbers in
// every field that matters under sustained pressure is still the same
// preset in practice.
//
// RULE: whatever preset this repo calls its hardest / most-relentless
// tier must measurably outperform a clearly-weaker tier on BOTH
// survival and offense, under the same stress conditions. "Measurably"
// is intentionally not "always wins every seed" — these are stochastic
// simulations — it is: averaged over several seeds, strictly ahead on
// both axes past a small noise tolerance.
//
// TOOL: this script. Runs both presets through stress_harness.js at a
// rate with enough slack for a real skill gap to show (moderate, not
// the heaviest rate — at the heaviest rate everything converges to the
// same physical ceiling regardless of skill, which is not what this is
// checking), several seeds each, compares aggregate survival time and
// aggregate garbage sent.
//
// GATE: wire into pages.yml (see the door/art checks for the pattern)
// once this repo has more than one "top tier" preset worth protecting
// — right now it is a manual/CI-optional check because the two
// presets it compares (nightmare vs diamond) are still being actively
// tuned; promote it to a real always-run step once nightmare's numbers
// stop moving.
//
// Usage: node check_preset_ordering.js [strongerName] [weakerName]
var path = require('path');
var cp = require('child_process');

var stronger = process.argv[2] || 'nightmare';
var weaker = process.argv[3] || 'diamond';
var SEEDS = [1, 2, 3, 4, 5, 6];
var FRAMES_PER_ATTACK = 120, WIDTH = 4, HEIGHT = 1; // moderate rate: real slack for skill to matter
var MAX_FRAMES = 3600; // 60s
// The bug this exists to catch is "no better than," not "worse than" —
// a first draft of this check required only NOT_WORSE on both axes,
// which a preset IDENTICAL to the one it's compared against trivially
// passes (100% >= 97%). That is precisely the failure mode from the
// header comment, so it must actually fail here. Two-part bar: neither
// axis may regress past noise, AND at least one axis must show a real
// improvement.
var NOT_WORSE = 0.97;
var REAL_IMPROVEMENT = 1.10;

var harness = path.join(__dirname, 'stress_harness.js');

function run(cfg, seed) {
  var out = cp.execFileSync('node', [harness, 'baseline', String(FRAMES_PER_ATTACK), String(WIDTH), String(HEIGHT), String(seed), String(MAX_FRAMES), cfg], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

function aggregate(cfg) {
  var totalFrames = 0, totalSent = 0, survived = 0;
  for (var i = 0; i < SEEDS.length; i++) {
    var r = run(cfg, SEEDS[i]);
    totalFrames += r.framesAlive;
    totalSent += r.garbageCellsSent;
    if (r.survived) survived++;
  }
  return { totalFrames: totalFrames, totalSent: totalSent, survived: survived, n: SEEDS.length };
}

console.log('Comparing ' + stronger + ' (should be stronger) vs ' + weaker + ' at moderate sustained pressure, ' + SEEDS.length + ' seeds each...');
var s = aggregate(stronger);
var w = aggregate(weaker);

console.log(stronger + ': survived ' + s.survived + '/' + s.n + ', totalFrames=' + s.totalFrames + ', totalSent=' + s.totalSent);
console.log(weaker + ':   survived ' + w.survived + '/' + w.n + ', totalFrames=' + w.totalFrames + ', totalSent=' + w.totalSent);

var survivalNotWorse = s.totalFrames >= w.totalFrames * NOT_WORSE;
var offenseNotWorse = s.totalSent >= w.totalSent * NOT_WORSE;
var survivalBetter = s.totalFrames >= w.totalFrames * REAL_IMPROVEMENT;
var offenseBetter = s.totalSent >= w.totalSent * REAL_IMPROVEMENT;
var pass = survivalNotWorse && offenseNotWorse && (survivalBetter || offenseBetter);

if (!pass) {
  console.error('');
  console.error('FAIL: "' + stronger + '" is not measurably ahead of "' + weaker + '".');
  if (!survivalNotWorse) console.error('  survival regressed: ' + s.totalFrames + ' < ' + w.totalFrames + ' * ' + NOT_WORSE + ' (' + (w.totalFrames * NOT_WORSE).toFixed(0) + ')');
  if (!offenseNotWorse) console.error('  offense regressed:  ' + s.totalSent + ' < ' + w.totalSent + ' * ' + NOT_WORSE + ' (' + (w.totalSent * NOT_WORSE).toFixed(0) + ')');
  if (survivalNotWorse && offenseNotWorse) console.error('  neither axis regressed, but neither improved by >= ' + REAL_IMPROVEMENT + 'x either -- "' + stronger + '" is indistinguishable from "' + weaker + '", which IS the failure.');
  console.error('This is the exact bug class described at the top of this file — a');
  console.error('"hardest" preset has drifted back to indistinguishable from (or worse');
  console.error('than) a weaker one. Check dangerHeightFrac/criticalFactor/');
  console.error('runwayThreshold/rescueBranchCap/dropAmountWeight/pressureThreshold/');
  console.error('sentWeight, not just reaction/depth/beam/mistake — those are the ones');
  console.error('that actually govern behavior once _inDanger() is true, which is most');
  console.error('of a real game.');
  process.exit(1);
}

console.log('');
console.log('PASS: "' + stronger + '" is measurably ahead of "' + weaker + '" (neither axis');
console.log('regressed, and at least one shows a real >= ' + REAL_IMPROVEMENT + 'x improvement).');
