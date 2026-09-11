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
                          rise: !!d.rise, density: !!d.density,
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
    // EVERY SCORING SWITCH BELONGS IN THE KEY. rise and density each change
    // what a board is worth, so a run with one of them on is a different bot
    // from one without — exactly as much as a depth change is. Left out, its
    // runs pool with the very control they are supposed to be measured
    // against, and the pooled mean hides the effect in both directions. This
    // was live: three rise runs scoring 1216/1492/1743 sat in the same
    // bucket as their 2553/2935/2589 control and the tool reported the group
    // as a single condition.
    if (run.rise) base += ' rise';
    if (run.density) base += ' density';
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
// EVERY CONDITION IS JUDGED AGAINST A CONTROL THAT DIFFERS IN EXACTLY ONE
// THING, and which thing depends on what is being tested.
//
// Two earlier versions of this got it wrong in opposite directions. The
// first compared everything to the plain depth-1 population-200 baseline,
// so a depth-2 run at population 100 was measured against a greedy run at
// population 200 and the verdict mixed three differences into one number.
// The second defined a control as "same features, same population, depth 1"
// for everything, which is right for a depth test and makes a FEATURE test
// its own control — so the feature conditions silently stopped being judged
// at all, which looks identical to having no opinion about them.
//
// So: what is being tested decides the control.
//   depth > 1        -> the same features and population at DEPTH 1
//   extra features   -> the same depth and population with NO shape features
//   neither          -> it is a control; nothing to say about it
//
// Population defaults to 200 and depth to 1 for snapshots written before
// those fields existed, which is what those runs were.
function shapeKey(r) { return SHAPES.filter(function (k) { return r.features.indexOf(k) >= 0; }).sort().join(','); }
function popOf(r) { return r.population || 200; }
function depthOf(r) { return r.depth || 1; }

function riseOf(r) { return !!r.rise; }
function densityOf(r) { return !!r.density; }

// A SCORING SWITCH IS A DIMENSION, and the control must differ in exactly
// one of them. When rise arrived, it was absent from BOTH the condition key
// and from here, so its three runs (1216/1492/1743) landed in the same
// bucket as their control (2553/2935/2589) — and then, once the key was
// fixed but this was not, they were still counted INSIDE the control for
// the depth test, widening that control's range from 2553-2935 to
// 1216-2935 and turning a 762-point gap into "no effect". One omission,
// two wrong answers in opposite directions.
//
// So the test is whichever switch is on, and every OTHER dimension must
// match the probe exactly.
function controlFor(runs) {
    var probe = runs[0], want, testing;
    var sameRest = function (r, ignore) {
        return popOf(r) === popOf(probe) &&
               (ignore === 'shape'   || shapeKey(r) === shapeKey(probe)) &&
               (ignore === 'depth'   || depthOf(r) === depthOf(probe)) &&
               (ignore === 'rise'    || riseOf(r) === riseOf(probe)) &&
               (ignore === 'density' || densityOf(r) === densityOf(probe));
    };
    if (riseOf(probe)) {
        testing = 'rise-adjusted scoring';
        want = function (r) { return !riseOf(r) && sameRest(r, 'rise'); };
    } else if (densityOf(probe)) {
        testing = 'density scoring';
        want = function (r) { return !densityOf(r) && sameRest(r, 'density'); };
    } else if (depthOf(probe) > 1) {
        testing = 'lookahead';
        want = function (r) { return depthOf(r) === 1 && sameRest(r, 'depth'); };
    } else if (shapeKey(probe)) {
        testing = 'features';
        want = function (r) { return shapeKey(r) === '' && sameRest(r, 'shape'); };
    } else {
        return null;                       // this IS a control
    }
    var out = [];
    Object.keys(byCond).forEach(function (other) {
        byCond[other].forEach(function (r) { if (want(r)) out.push(r); });
    });
    return { runs: out, testing: testing };
}

function stat(runs) { return stats(runs.map(function (r) { return r.held; })); }

console.log('');
var judged = 0;
Object.keys(byCond).sort().forEach(function (c) {
    var runs = byCond[c];
    var control = controlFor(runs);
    if (!control) return;
    judged++;
    var label = (c.length > 44 ? c.slice(0, 41) + '...' : c);
    if (control.runs.length < 2) {
        console.log('  ' + label.padEnd(46) + 'NOT MEASURED — its ' + control.testing +
            ' control has ' + control.runs.length + ' run' +
            (control.runs.length === 1 ? '' : 's') + ', needs 2+ for a floor');
        return;
    }
    if (runs.length < 2) {
        console.log('  ' + label.padEnd(46) + 'NOT MEASURED — ' + runs.length + ' run only');
        return;
    }
    var a = stat(runs), b = stat(control.runs);
    var span = '(control ' + Math.round(b.lo) + '-' + Math.round(b.hi) +
               ', ' + control.runs.length + ' runs)';
    var verdict;
    if (a.lo > b.hi) verdict = 'BETTER — its worst run beats the control\'s best ' + span;
    else if (a.hi < b.lo) verdict = 'WORSE — its best run loses to the control\'s worst ' + span;
    else verdict = 'NO EFFECT — overlaps the control ' + span;
    console.log('  ' + label.padEnd(46) + verdict);
});
if (!judged) console.log('  nothing to judge yet — every condition is a control');
