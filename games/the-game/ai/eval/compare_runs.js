// WHICH FEATURES ACTUALLY DID ANYTHING? Run: node compare_runs.js
//
// WHY THIS EXISTS, and it is the most expensive lesson of the day it was
// written. Five runs were dispatched — one baseline, three single-feature
// variants, and a second baseline differing only by RNG seed — and their
// final scores read 3054, 3057, 2883, 2492, 3420. Read one at a time those
// look like results: staircase up, flatTop down. They are not. The two
// BASELINES, identical in every way except the seed, differ by 928. Every
// variant gap is smaller than that.
//
// The mistake was structural, not arithmetic: ONE run per condition, with
// no measurement of what one run's own variance is. PUYO_REFERENCE.md's
// loop does not cover this because meatfighter was tuning one bot, not
// comparing five — "run it until the numbers stop moving" tells you when a
// search is done, not whether two finished searches differ.
//
// So this refuses to compare conditions until the baseline has been run
// more than once, computes the noise floor from those repeats, and calls a
// difference real only when it clears that floor. It reports the verdict
// rather than the numbers alone, because the numbers were what got misread.
//
// It reads the SNAPSHOTS on disk, keeping the last generation of each run
// (the converged one), and groups runs by which features they searched.
var fs = require('fs');
var path = require('path');

var DIR = __dirname;
var SHAPES = ['staircase', 'flatTop', 'comboPotential'];

function load() {
    var runs = {};
    fs.readdirSync(DIR).forEach(function (f) {
        var m = /^trained\.replace\.(.+)\.(\d{4}-\d{6})\.g(\d+)\.json$/.exec(f);
        if (!m) return;
        var tag = m[1], runId = m[2], gen = Number(m[3]);
        var d;
        try { d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); }
        catch (e) { return; }
        var held = d.holdout && d.holdout.learned && d.holdout.learned.fitness;
        if (typeof held !== 'number') return;
        var key = tag + '.' + runId;
        // Keep the LAST generation of each run: that is the converged answer,
        // and an earlier snapshot of the same run is not an independent
        // sample of anything.
        if (!runs[key] || gen > runs[key].gen) {
            runs[key] = { tag: tag, runId: runId, gen: gen, held: held,
                          features: d.features || [], excluded: d.excluded || [],
                          depth: d.depth || 1, beam: d.beam || null,
                          population: d.population || null,
                          weights: d.weights || {} };
        }
    });
    return Object.keys(runs).map(function (k) { return runs[k]; });
}

// A CONDITION IS EVERYTHING THAT CHANGES WHAT IS BEING MEASURED — not just
// the features. The first version grouped on features alone, which was fine
// while every run was depth 1 at population 200 and silently wrong the
// moment it was not: a lookahead run and a greedy run would have been
// averaged together as "baseline" and the comparison would have reported a
// difference that was really two different bots in one bucket.
//
// Depth is the sharpest of these. The SAME weights score 14780 points under
// depth 1 and 2550 under depth 2 — weights describe a bot, not a board.
// Population changes how well the search converges, so it belongs here too.
//
// Snapshots written before depth was recorded have no `depth` field; they
// were all depth 1, which is what the default reads.
function conditionOf(run) {
    var have = SHAPES.filter(function (s) { return run.features.indexOf(s) >= 0; });
    var base = have.length ? have.join('+') : 'baseline';
    var depth = run.depth || 1;
    if (depth > 1) base += ' d' + depth + 'b' + (run.beam || '?');
    if (run.population && run.population !== 200) base += ' pop' + run.population;
    return base;
}

function stats(xs) {
    var n = xs.length, mean = xs.reduce(function (a, b) { return a + b; }, 0) / n;
    var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
    return { n: n, mean: mean, lo: lo, hi: hi, spread: hi - lo };
}

var runs = load();
if (!runs.length) { console.log('no snapshots found in ' + DIR); process.exit(0); }

var byCond = {};
runs.forEach(function (r) {
    var c = conditionOf(r);
    (byCond[c] = byCond[c] || []).push(r);
});

console.log('CONVERGED RUNS, grouped by which shape features they searched\n');
console.log('  condition          runs   mean    range');
Object.keys(byCond).sort().forEach(function (c) {
    var s = stats(byCond[c].map(function (r) { return r.held; }));
    console.log('  ' + c.padEnd(18) + String(s.n).padStart(4) + '  ' +
        String(Math.round(s.mean)).padStart(5) + '   ' +
        Math.round(s.lo) + '-' + Math.round(s.hi));
});

// The floor is the plain depth-1 population-200 baseline. A condition run
// at a different depth or population needs its OWN matched baseline before
// it can be judged, which is why those carry a distinct condition name and
// will report NOT MEASURED until one exists.
var base = byCond.baseline || [];
console.log('');
if (base.length < 2) {
    console.log('NO VERDICT. The baseline has been run ' + base.length + ' time' +
        (base.length === 1 ? '' : 's') + ', so the search\'s own spread is unmeasured and');
    console.log('no gap between conditions can be told from luck. Run the baseline at');
    console.log('two or more GC_GA_SEED values before comparing anything.');
    process.exit(0);
}

var bs = stats(base.map(function (r) { return r.held; }));
var floor = bs.spread;
console.log('NOISE FLOOR: ' + base.length + ' baseline runs differing only by seed span ' +
    Math.round(floor) + ' points (' + Math.round(bs.lo) + '-' + Math.round(bs.hi) + ').');
console.log('A condition counts as different only if its whole range clears that.\n');

Object.keys(byCond).sort().forEach(function (c) {
    if (c === 'baseline') return;
    var s = stats(byCond[c].map(function (r) { return r.held; }));
    var verdict;
    if (s.n < 2) {
        verdict = 'NOT MEASURED — one run only, needs ' + base.length + ' like the baseline';
    } else if (s.lo > bs.hi) {
        verdict = 'BETTER — its worst run beats the baseline\'s best';
    } else if (s.hi < bs.lo) {
        verdict = 'WORSE — its best run loses to the baseline\'s worst';
    } else {
        verdict = 'NO EFFECT — overlaps the baseline\'s own spread';
    }
    console.log('  ' + c.padEnd(18) + verdict);
});
