// BOTH DIRECTIONS. A stop rule that never fires loses every generation since
// the last snapshot, every run, silently — that is the bug this exists for.
// A stop rule that fires too eagerly ends a healthy five-hour run after
// twenty minutes, which is worse and would get it switched off in a week.

var assert = require('assert');
var d = require('./deadline.js');
var pass = 0;
function check(name, fn) { fn(); pass++; console.log('  ok  ' + name); }

var HOUR = 3600;

check('no deadline means never stop', function () {
    assert.strictEqual(d.outOfTime(1e9, null, 600), false);
    assert.strictEqual(d.outOfTime(1e9, 0, 600), false);
});

check('nothing timed yet falls back to the plain comparison', function () {
    assert.strictEqual(d.outOfTime(100, 200, 0), false);
    assert.strictEqual(d.outOfTime(300, 200, 0), true);
});

check('a fast run is NOT stopped early', function () {
    // 90-second generations, half an hour left. Stopping here would throw
    // away twenty good generations for nothing.
    assert.strictEqual(d.outOfTime(0, 1800, 90), false);
});

check('a fast run near the end still runs one more if it fits', function () {
    assert.strictEqual(d.outOfTime(0, 120, 90), false, '90s * 1.15 = 103s < 120s');
});

check('a fast run stops when the next one would not fit', function () {
    assert.strictEqual(d.outOfTime(0, 100, 90), true, '90s * 1.15 = 103s > 100s');
});

check('THE survdens2 CASE: an 11.5-minute generation stops with time to spare', function () {
    // Run #122's real numbers. Crank start t=0, GC_DEADLINE at 340 minutes,
    // the runner's own cap at 350. A generation takes ~690s.
    var DEADLINE = 340 * 60, CAP = 350 * 60, gen = 690;

    // The old rule: at any moment before the deadline, start another
    // generation. The last one it starts runs past the cap and the job is
    // cancelled — which is exactly what happened.
    var lastStart = DEADLINE - 1;
    assert.ok(lastStart + gen > CAP,
        'the old rule starts a generation that cannot finish before the cap');

    // The new rule stops instead, and stops BEFORE the cap.
    assert.strictEqual(d.outOfTime(lastStart, DEADLINE, gen), true);
    var firstStop = DEADLINE - gen * d.MARGIN;
    assert.strictEqual(d.outOfTime(firstStop + 1, DEADLINE, gen), true);
    assert.ok(firstStop + gen < CAP,
        'the generation in flight when the rule fires still finishes inside the cap');
});

check('...and it still gets most of the budget', function () {
    // The point is a clean stop, not a timid one: it must not cost so many
    // generations that the slow variant still never reaches a snapshot.
    var DEADLINE = 340 * 60, gen = 690;
    var stopsAt = DEADLINE - gen * d.MARGIN;
    assert.ok(stopsAt / DEADLINE > 0.95,
        'stops after ' + (100 * stopsAt / DEADLINE).toFixed(1) + '% of the budget');
});

check('the margin is over the SLOWEST generation, not the last', function () {
    // A population that survives longer plays longer games, so generations
    // get slower as a run improves. Judging by the last one is a point
    // estimate that is too low exactly when it matters.
    var slowest = 800, last = 500, remaining = 700;
    assert.strictEqual(d.outOfTime(0, remaining, slowest), true);
    assert.strictEqual(d.outOfTime(0, remaining, last), false,
        'judging by the last generation would start one that overruns');
});

check('a five-hour run of one-minute generations is untouched', function () {
    // The regression that matters: every healthy variant must behave as it
    // did. Walk the whole budget a generation at a time and assert the rule
    // fires exactly once, at the end.
    var DEADLINE = 340 * 60, gen = 60, fired = 0, t = 0;
    while (t < DEADLINE) {
        t += gen;
        if (d.outOfTime(t, DEADLINE, gen)) { fired++; break; }
    }
    assert.strictEqual(fired, 1);
    assert.ok(t > DEADLINE - 2 * gen, 'fires at the end, not in the middle');
});

console.log('\n' + pass + '/' + pass + ' passed');
