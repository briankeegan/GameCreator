// IS THE CHAIN DEPTH IN THE RESULT, AND IS IT THE REAL ONE?
// Run: node chaindepth.test.js
//
// WHY THIS EXISTS. A training run records the score. The owner's bar is not
// the score: measured on the real endless benchmark every chain this bot
// fires is 2-3 links, and the 4-6 and 7+ buckets are EMPTY. Score can climb
// the whole way without that moving — a bot that survives and makes small
// clears scores respectably and never fires a 4-chain. So a batch of runs
// judged on score alone produces numbers that all go up while the thing we
// care about does not, and that reads as progress.
//
// The records were already there and already thrown away. bench.js called
// stack.takeDeliverableGarbage(), got {width, height, isChain} per piece,
// and reduced it to a cell count on the next line — the same "present,
// correct, quietly discarded one layer down" shape that has cost this repo
// twice already.
//
// WHAT IS ASSERTED. Not that a breakdown exists — an object of zeroes would
// satisfy that. That it is the SAME garbage the Stack actually delivered,
// checked by intercepting the delivery and classifying it independently.
var assert = require('assert');
var registry = require('./registry.js');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var bench = require('./bench.js');
var report = require(path.join(__dirname, '..', 'experiments', 'report.js'));

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// A weight set that actually plays — the shipped trained one, so the run
// produces real garbage rather than a bot that dies in thirty frames.

// AN ARCHIVED SNAPSHOT IS STILL A BOT, minus the weights for measurements
// that no longer exist. evaluate() refuses an unknown feature — rightly, it
// is how a typo is caught — so a fixture pinned to an old champion has to
// drop what the registry no longer carries.
function liveWeights(w) {
    var out = {};
    registry.keys.forEach(function (k) { if (w[k]) out[k] = w[k]; });
    return out;
}
var W = liveWeights( require('./trained.replace.l10-puyo-puyo18-s11.0914-020835.g00274.json').weights);
// The level comes from GC_LEVEL; bench.run does not read a 'level' option.
var OPTS = { brain: 'puyo', objective: 'score' };

test('a game result carries the chain-depth breakdown', function () {
    var r = bench.fitness(W, [7], OPTS);
    assert.ok(r.chainDepth, 'no chainDepth on the result at all');
    report.CATEGORY_ORDER.forEach(function (c) {
        assert.ok(typeof r.chainDepth[c] === 'number',
            'bucket "' + c + '" missing or not a number: ' + JSON.stringify(r.chainDepth));
    });
});

test('and it is the garbage the Stack actually delivered, not a plausible object', function () {
    // THE CHECK THAT CANNOT BE SATISFIED BY ZEROES. Every piece the Stack
    // hands over is classified here too, by the same rule, and the two
    // tallies must agree exactly. A breakdown computed from anything else —
    // or not computed at all — disagrees.
    var mine = {};
    report.CATEGORY_ORDER.forEach(function (c) { mine[c] = 0; });
    var proto = PanelEngine.Stack.prototype;
    var orig = proto.takeDeliverableGarbage;
    proto.takeDeliverableGarbage = function () {
        var out = orig.apply(this, arguments);
        if (out && out.length) {
            for (var i = 0; i < out.length; i++) mine[report.classify(out[i])]++;
        }
        return out;
    };
    var r;
    try { r = bench.fitness(W, [7], OPTS); }
    finally { proto.takeDeliverableGarbage = orig; }

    var total = 0;
    report.CATEGORY_ORDER.forEach(function (c) { total += mine[c]; });
    assert.ok(total > 0,
        'the Stack delivered no garbage at all in this game — nothing to compare, so this ' +
        'test would pass for a breakdown that is always empty. SETUP failure, not a verdict.');
    assert.deepStrictEqual(r.chainDepth, mine,
        'the reported breakdown is not the garbage that was delivered:\n  reported ' +
        JSON.stringify(r.chainDepth) + '\n  actual   ' + JSON.stringify(mine));
});

test('it survives the arena, summed across all four categories', function () {
    // The arena branch builds its own result object by hand, which is
    // exactly where a field gets silently dropped — it happened to
    // stopTimeEarned and brokeGarbage in _score for the same reason.
    var r = bench.fitness(W, [7], Object.assign({ arena: ['comboStorm', 'endless'] }, OPTS));
    assert.ok(r.chainDepth, 'the arena result dropped chainDepth');
    var summed = 0;
    report.CATEGORY_ORDER.forEach(function (c) { summed += r.chainDepth[c]; });
    var perCat = 0;
    Object.keys(r.perCategory).forEach(function (cat) {
        var cd = r.perCategory[cat].chainDepth;
        assert.ok(cd, 'category "' + cat + '" has no chainDepth');
        report.CATEGORY_ORDER.forEach(function (c) { perCat += cd[c]; });
    });
    assert.strictEqual(summed, perCat,
        'the arena total (' + summed + ') is not the sum of its categories (' + perCat + ')');
    assert.ok(summed > 0, 'no garbage across two whole arena categories — SETUP failure');
});

test('it tells a chain from a combo', function () {
    // A breakdown that puts everything in one bucket is not a breakdown. The
    // engine itself distinguishes them — combo garbage is 1-row slabs 3-6
    // wide, chain garbage is 6 wide and one row per link — so over a real
    // run both kinds must appear, or the classification is collapsing.
    var r = bench.fitness(W, [7, 3], Object.assign({ arena: ['comboStorm', 'endless'] }, OPTS));
    var combo = r.chainDepth['combo-small'] + r.chainDepth['combo-big'];
    var chain = r.chainDepth['chain-short'] + r.chainDepth['chain-medium'] + r.chainDepth['chain-long'];
    assert.ok(combo > 0, 'not one combo across two categories and two seeds');
    assert.ok(chain > 0, 'not one chain across two categories and two seeds');
});

// THE HOP THAT HAS SILENTLY EATEN OPTIONS BEFORE.
//
// train.js does not call bench directly — it forks train_worker.js, which
// used to rebuild the options object field by field, so every option added
// after that line was written stopped there. depth and beam were added for
// the lookahead experiment, recorded faithfully in every snapshot, and never
// reached the bot: three "depth 2" runs were greedy runs wearing a depth-2
// label, caught only because they matched their depth-1 controls to the
// digit. A field that is computed, recorded and never delivered reads
// exactly like a field that works, so the crossing is asserted rather than
// assumed.
test('it survives the worker, which is where options have died before', function (done) {
    var cp = require('child_process');
    var w = cp.fork(path.join(__dirname, 'train_worker.js'), { silent: true });
    var replied = false;
    var timer = setTimeout(function () {
        if (!replied) { w.kill(); throw new Error('the worker never replied — SETUP failure'); }
    }, 90000);
    w.on('message', function (msg) {
        replied = true;
        clearTimeout(timer);
        w.kill();
        var r = msg.result;
        assert.ok(r, 'the worker replied with no result at all');
        assert.ok(r.chainDepth,
            'the worker dropped chainDepth on the way back: ' + JSON.stringify(Object.keys(r)));
        var total = 0;
        report.CATEGORY_ORDER.forEach(function (c) { total += r.chainDepth[c] || 0; });
        assert.ok(total > 0,
            'the worker returned an all-zero breakdown — it crossed, but empty, which is ' +
            'what a dropped field looks like one layer up');
        done();
    });
    w.send({ id: 1, weights: W, seeds: [7], brain: 'puyo', objective: 'score' });
});

// One test forks a process, so the runner waits for a `done` rather than
// assuming everything is synchronous — a test whose assertion fires after
// the summary prints is a test that cannot fail the run.
(function runNext(i) {
    if (i >= tests.length) {
        console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
        process.exit(failures.length ? 1 : 0);
        return;
    }
    var t = tests[i];
    function pass() { console.log('ok   ' + t.name); runNext(i + 1); }
    function fail(e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); runNext(i + 1); }
    try {
        if (t.fn.length) { t.fn(pass); }
        else { t.fn(); pass(); }
    } catch (e) { fail(e); }
})(0);
