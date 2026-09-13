#!/usr/bin/env node
// DID THE TINY RUN ACTUALLY TRAIN, OR DID IT JUST EXECUTE?
//
//   node check_smoke_run.js <snapshot.smoke.json> [expectedGenomeSize]
//
// WHY THIS EXISTS. A short run before the long one is only worth the minutes
// it costs if it can FAIL. The obvious version — run two generations, check
// the exit code — passes on every disaster this project has actually had:
// a feature wired to nothing, a genome one key short, a fitness of zero, a
// held-out report that never ran. All of those exit 0.
//
// So this reads the snapshot the smoke run wrote and asserts the things that
// would be true only if training really happened. Each check below is a
// failure that reached a real five-hour run, or in one case a whole day of
// them.
var fs = require('fs');
var path = require('path');

var file = process.argv[2];
var expected = process.argv[3] ? Number(process.argv[3]) : null;
var problems = [];

if (!file || !fs.existsSync(file)) {
    console.error('no smoke snapshot at ' + file +
                  ' — the run produced nothing to check, which is itself the failure');
    process.exit(1);
}
var snap = JSON.parse(fs.readFileSync(file, 'utf8'));
var w = snap.weights || {};
var keys = Object.keys(w);

// 1. THE GENOME IS THE SIZE ASKED FOR. A typo in GC_EXCLUDE drops a feature
//    silently — train.js refuses an unknown name, but a name that IS a
//    feature is removed without comment, and 17 weights look exactly like 18
//    in a log nobody reads. comboPotential went missing this way and cost a
//    run that had to be killed at generation 14.
if (expected !== null && keys.length !== expected) {
    problems.push('genome has ' + keys.length + ' weights, expected ' + expected +
                  ': ' + keys.sort().join(' '));
}

// 2. THE NUMBERS MOVED. This is the point of the whole exercise: a short run
//    cannot tell you the weights are GOOD, but it can tell you the search is
//    doing something, which is what every disaster here had in common.
//
//    NOT "every weight is non-zero" — that was the first version and it
//    failed a perfectly healthy run. The search starts at the origin and
//    walks; after two generations some weights genuinely have not moved yet,
//    and a check that rejects that is a check someone switches off. Measured
//    on a real 12-genome 2-generation run: 15 of 18 had moved. The bar is
//    HALF, which is comfortably clear of that and still catches a genome that
//    is sitting still because nothing is wired to it.
var moved = keys.filter(function (k) { return w[k]; });
if (keys.length && moved.length * 2 < keys.length) {
    problems.push('only ' + moved.length + ' of ' + keys.length +
                  ' weights moved off zero — the search is not getting traction, ' +
                  'which usually means the features are not reaching the evaluator');
}

// 3. IT SCORED SOMETHING. A fitness of zero means every genome died instantly
//    — a broken scenario, a missing training file, an evaluator throwing and
//    being caught somewhere. The number is meaningless this short; that it is
//    ABOVE ZERO is not.
if (!(snap.trainFitness > 0)) {
    problems.push('trainFitness is ' + snap.trainFitness +
                  ' — nothing survived long enough to score, so the scenarios are broken');
}

// 4. THE HELD-OUT REPORT RAN, and produced both sides. This is the number
//    every decision gets made on. It has silently not run before, and a
//    missing number reads like a modest result rather than like an absence.
var h = snap.holdout;
if (!h || !h.learned || !h.shipped) {
    problems.push('no held-out report in the snapshot — the number every ' +
                  'verdict is read off did not get produced');
} else if (!(h.learned.fitness > 0) || !(h.shipped.fitness > 0)) {
    problems.push('held-out fitness is zero on one side (learned ' +
                  (h.learned.fitness) + ', shipped ' + (h.shipped.fitness) +
                  ') — the comparison is not measuring anything');
}

// 5. IT PLAYED EVERY SCENARIO. Training on three of four and reporting a
//    total is how a run gets read as worse than it is, or better.
if (h && h.learned && h.learned.categories) {
    var cats = Object.keys(h.learned.categories);
    if (cats.length < 4) {
        problems.push('only ' + cats.length + ' scenarios in the held-out report (' +
                      cats.join(', ') + ') — expected all four');
    }
}

if (problems.length) {
    console.error('\nTHE SMOKE RUN RAN, BUT IT DID NOT TRAIN:\n');
    problems.forEach(function (p) { console.error('  - ' + p); });
    console.error('\nNot starting the long run. ' + path.basename(file) + '\n');
    process.exit(1);
}

// Reports what was actually checked. The first version said "all non-zero"
// while the check is "at least half moved" — a success line claiming more
// than it verified is the same lie as a gate that cannot fail, just quieter.
console.log('smoke run OK: ' + moved.length + ' of ' + keys.length +
            ' weights moved, trainFitness ' + Math.round(snap.trainFitness) +
            ', held-out learned ' + Math.round(h.learned.fitness) +
            ' vs shipped ' + Math.round(h.shipped.fitness));
