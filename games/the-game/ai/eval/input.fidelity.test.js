// DOES THE INPUT ACTUALLY MATCH THE ENGINE? Run: node input.fidelity.test.js
//
// features.test.js proves a feature computes the right number from a
// hand-built input. It proves NOTHING about whether that input was built
// correctly from the live game — and a feature reading a field that is
// always 0, or the wrong field, produces perfectly plausible numbers and
// tunes into nonsense. "The features aren't hooked up correctly" is the
// failure that looks least like a failure, so it gets its own gate:
//
//   input.js's fromStack() is run against a REAL panel-engine.js Stack,
//   driven into the states the clock features care about, and every field
//   is compared to the engine's own value.
//
// This is the same lesson as ai/experiments/harness_fidelity.test.js, which
// exists because a harness got two engine behaviours wrong, twice, silently,
// invalidating every benchmark in that directory until someone happened to
// re-read the Lua. A snapshot that quietly disagrees with the engine is that
// bug with a new name.
//
// It is deliberately NOT a test of the features' meaning — only of the
// wiring. Meaning is features.test.js's job.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
var PanelEngine = globalThis.PanelEngine;
var inputMod = require('./input.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function newStack(opts) {
    var s = new PanelEngine.Stack(Object.assign({ level: 3, seed: 7 }, opts || {}));
    return s;
}
function run(stack, frames) { for (var i = 0; i < frames; i++) stack.run(); return stack; }

// Every clock field, read straight off the Stack, must equal what
// fromStack put in the input. Written as a table rather than a list of
// asserts so a field ADDED to the input without being wired here is
// visible as an absence, not hidden among a dozen similar lines.
var CLOCK_FIELDS = [
    ['toppedOut', function (s) { return !!s.wasToppedOut; }],
    ['riseLock', function (s) { return !!s.riseLock; }],
    ['preStopTime', function (s) { return s.preStopTime || 0; }],
    ['stopTime', function (s) { return s.stopTime || 0; }],
    ['shakeTime', function (s) { return s.shakeTime || 0; }],
    ['health', function (s) { return s.health || 0; }],
    ['maxHealth', function (s) { return s.levelData.maxHealth || 0; }]
];

function assertClockMatches(stack, label) {
    var got = inputMod.fromStack(stack, {}, {}, null, 0);
    CLOCK_FIELDS.forEach(function (f) {
        assert.strictEqual(got.clock[f[0]], f[1](stack),
            label + ': clock.' + f[0] + ' disagrees with the engine');
    });
}

test('the input covers every clock field the engine exposes', function () {
    var got = inputMod.fromStack(newStack(), {}, {}, null, 0);
    var wired = CLOCK_FIELDS.map(function (f) { return f[0]; }).sort();
    assert.deepStrictEqual(Object.keys(got.clock).sort(), wired,
        'a clock field was added to input.js without being checked here');
});

test('clock matches on a fresh stack', function () {
    assertClockMatches(run(newStack(), 1), 'fresh');
});

test('clock matches after the board has been running', function () {
    assertClockMatches(run(newStack(), 400), 'running');
});

test('health is read live, not captured at construction', function () {
    var s = run(newStack(), 60);
    s.health = 11;
    assert.strictEqual(inputMod.fromStack(s, {}, {}, null, 0).clock.health, 11);
});

test('maxHealth comes from levelData and differs between levels', function () {
    var a = inputMod.fromStack(newStack({ level: 3 }), {}, {}, null, 0).clock.maxHealth;
    var b = inputMod.fromStack(newStack({ level: 10 }), {}, {}, null, 0).clock.maxHealth;
    assert.ok(a > 0 && b > 0, 'maxHealth must be a real number, not 0');
    assert.notStrictEqual(a, b, 'level 3 and level 10 should not share maxHealth — ' +
        'if they do, this test is not proving the field is wired');
});

test('toppedOut reads wasToppedOut, the flag the engine itself acts on', function () {
    // advancePassiveRaise's health drain and awardStopTime's danger bonus
    // both read the latched flag, not the live predicate. A snapshot using
    // isToppedOut() would disagree with the rule it is modelling on
    // exactly the frames that matter.
    var s = run(newStack(), 10);
    s.wasToppedOut = true;
    assert.strictEqual(inputMod.fromStack(s, {}, {}, null, 0).clock.toppedOut, true);
    s.wasToppedOut = false;
    assert.strictEqual(inputMod.fromStack(s, {}, {}, null, 0).clock.toppedOut, false);
});

test('stop time is carried through after a real match awards it', function () {
    var s = run(newStack(), 30);
    s.awardStopTime(true, 4);        // a chain link: the big payer
    assert.ok(s.stopTime > 0, 'engine did not award stop time — test setup is wrong');
    assert.strictEqual(inputMod.fromStack(s, {}, {}, null, 0).clock.stopTime, s.stopTime);
});

test('incoming garbage is carried, by width and height', function () {
    var s = run(newStack(), 30);
    s.receiveGarbage([{ width: 6, height: 2, isChain: true }]);
    var got = inputMod.fromStack(s, {}, {}, null, 0);
    assert.strictEqual(got.incoming.length, s.incoming.length,
        'incoming queue length disagrees with the engine');
    assert.ok(got.incoming.length > 0, 'engine queued nothing — test setup is wrong');
    assert.strictEqual(got.incoming[0].width, s.incoming[0].width);
    assert.strictEqual(got.incoming[0].height, s.incoming[0].height);
});

test('an empty incoming queue is [] and not undefined', function () {
    var got = inputMod.fromStack(run(newStack(), 5), {}, {}, null, 0);
    assert.ok(Array.isArray(got.incoming));
});

test('displacement is carried — a board one pixel from a new row is not the same board', function () {
    var s = run(newStack(), 200);
    assert.strictEqual(inputMod.fromStack(s, {}, {}, null, 0).displacement, s.displacement);
});

test('earned comes from the resolved candidate, not from the stack', function () {
    // The move being scored has not happened on the real stack — it is a
    // hypothetical the search resolved on a LogicalBoard. Reading these off
    // the Stack would score every candidate identically.
    var s = run(newStack(), 30);
    var got = inputMod.fromStack(s, {}, { chainLength: 4, comboSizes: [5], garbage: [[6, 3]] }, null, 2);
    assert.strictEqual(got.earned.chainLength, 4);
    assert.deepStrictEqual(got.earned.comboSizes, [5]);
    assert.deepStrictEqual(got.earned.garbageSent, [[6, 3]]);
    assert.strictEqual(got.earned.garbageCleared, 2);
});

test('chainMarks stays null when not mid-cascade, and is the map when it is', function () {
    var s = run(newStack(), 30);
    assert.strictEqual(inputMod.fromStack(s, {}, {}, null, 0).chainMarks, null);
    var marks = { '3:4': true };
    assert.strictEqual(inputMod.fromStack(s, {}, {}, { chainMarks: marks }, 0).chainMarks, marks);
});

test('fromStack survives a null stack (recorded position, no engine in process)', function () {
    var got = inputMod.fromStack(null, { width: 6, height: 12, grid: [], blocks: {} }, {}, null, 0);
    assert.strictEqual(got.clock.health, 0);
    assert.strictEqual(got.board.width, 6);
});

tests.forEach(function (t) {
    try { t.fn(); process.stdout.write('  ok   ' + t.name + '\n'); }
    catch (e) { failures.push(t.name + '\n       ' + e.message); process.stdout.write('  FAIL ' + t.name + '\n'); }
});
if (failures.length) {
    process.stdout.write('\n' + failures.length + ' failed:\n\n' + failures.join('\n\n') + '\n');
    process.exit(1);
}
process.stdout.write('\n' + tests.length + ' passed — the input agrees with the real engine.\n');
