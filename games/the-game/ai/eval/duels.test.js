// DOES FANNING DUELS ACROSS CORES GIVE THE SAME ANSWER AS RUNNING THEM HERE?
// Run: node duels.test.js
//
// The face-off and the held-out check are ~42 duels a leg, and they ran one
// at a time in the parent while all four island workers sat idle. Sharding
// them is only safe if it is INVISIBLE: same results, same order, whatever
// the shard count. A fan-out that returned results in completion order would
// silently mis-attribute every win in the face-off, and the face-off decides
// which island's champion gets snapshotted and whose weights migrate.
//
// So the test is the equivalence, not the speed. Speed needs no test — it is
// either faster or it is not, and the leg log says which.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var versus = require('./versus.js');
var duels = require('./duels.js');
var registry = require('./registry.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// Small, fast and deliberately different from each other, so a mixed-up
// result is visible rather than a coin flip.
var OPTS = { depth: 1, beam: 0, rise: false, density: false, allowRaise: false, level: 10 };
function genome(scale) {
    var w = {};
    registry.keys.forEach(function (k, i) { w[k] = ((i % 5) - 2) * scale; });
    return w;
}
var A = genome(10), B = genome(-7), C = genome(3);

function jobsFor() {
    return [
        { a: A, b: B, seed: 1 },
        { a: A, b: C, seed: 2 },
        { a: B, b: C, seed: 3 },
        { a: C, b: A, seed: 1 },
        { a: B, b: A, seed: 2 }
    ];
}

function inline(jobs) {
    return jobs.map(function (j) { return versus.duel(j.a, j.b, j.seed, OPTS); });
}

function same(got, want, what) {
    assert.strictEqual(got.length, want.length, what + ': result count');
    for (var i = 0; i < want.length; i++) {
        assert.ok(got[i], what + ': result ' + i + ' is missing');
        assert.strictEqual(got[i].winner, want[i].winner, what + ': winner of job ' + i);
        assert.strictEqual(got[i].frames, want[i].frames, what + ': frames of job ' + i);
        assert.deepStrictEqual(got[i].sent, want[i].sent, what + ': sent of job ' + i);
    }
}

test('a sharded run gives the SAME results IN THE SAME ORDER as running them inline', function (done) {
    var jobs = jobsFor();
    var want = inline(jobs);
    duels.runDuels(jobs, OPTS, 4, function (err, got) {
        assert.ifError(err);
        same(got, want, '4 shards');
        done();
    });
});

test('the shard count changes nothing — 1, 2 and 3 shards all agree', function (done) {
    var jobs = jobsFor();
    var want = inline(jobs);
    var left = 3, failed = null;
    [1, 2, 3].forEach(function (n) {
        duels.runDuels(jobs, OPTS, n, function (err, got) {
            try {
                assert.ifError(err);
                same(got, want, n + ' shard(s)');
            } catch (e) { failed = failed || e; }
            if (--left === 0) done(failed);
        });
    });
});

test('MORE SHARDS THAN JOBS is not an error and loses nothing', function (done) {
    var jobs = jobsFor().slice(0, 2);
    var want = inline(jobs);
    duels.runDuels(jobs, OPTS, 9, function (err, got) {
        assert.ifError(err);
        same(got, want, '9 shards over 2 jobs');
        done();
    });
});

test('an empty job list comes straight back, without forking anything', function (done) {
    duels.runDuels([], OPTS, 4, function (err, got) {
        assert.ifError(err);
        assert.deepStrictEqual(got, []);
        done();
    });
});

test('a worker that dies REPORTS an error rather than returning short results', function (done) {
    // A silent short result is the failure mode that matters: the face-off
    // would tally the duels that came back and crown the wrong island.
    duels.runDuels(jobsFor(), OPTS, 2, function (err, got) {
        assert.ok(err, 'a failed shard must surface as an error, got: ' + JSON.stringify(got));
        done();
    }, { forceWorker: path.join(__dirname, 'no-such-worker-on-purpose.js') });
});

// ---- runner ----
(function run(i) {
    if (i >= tests.length) {
        console.log('');
        if (failures.length) {
            console.log(failures.length + ' failed:');
            failures.forEach(function (f) { console.log('\n' + f.name + '\n       ' + f.err); });
            process.exit(1);
        }
        console.log(tests.length + ' passed.');
        return;
    }
    var t = tests[i], finished = false;
    function done(err) {
        if (finished) return;
        finished = true;
        if (err) { failures.push({ name: t.name, err: err.message || err }); console.log('  FAIL ' + t.name); }
        else console.log('  ok   ' + t.name);
        run(i + 1);
    }
    try { t.fn(done); } catch (e) { done(e); }
})(0);
