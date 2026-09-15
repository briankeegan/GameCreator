// DOES THE SEARCH SEE THE BOARD IT WILL ACTUALLY FACE? Run: node elapsed.test.js
//
// THE RULE: the board the search judges is the board as it will be when the
// move LANDS, not as it is when the move is chosen. If a row arrives in
// between, show the row. If none arrives, do not.
//
// The bot walks to a swap -- travel.cost frames, the same number _score
// already charges as a penalty -- and the stack rises the whole way. So a
// far swap and a near swap are not being judged on the same board, and the
// old behaviour judged them on the same board anyway: `rise: true` added
// exactly one row to every candidate regardless of how long it took to
// reach, and `rise: false` added none to any of them.
//
// WHAT IS EXACT HERE, and why nothing is estimated:
//   - travel frames: travel.cost, already computed per candidate.
//   - the rise rate: PanelEngine.riseTime(speed), the engine's own table,
//     frames per pixel, 16 pixels to a row, counted from the live riseTimer
//     and displacement.
//   - the pause: advancePassiveRaise only rises inside
//     (!riseLock && stopTime === 0), so banked stop time postpones the row
//     frame for frame. That is why holding stop time keeps the board still.
//
// THE CASCADE'S DURATION IS NOT NEEDED, which was the open question this
// closes. updateRiseLock sets riseLock whenever hasActivePanels(), and a
// cascade is active panels -- so THE STACK DOES NOT RISE DURING A CASCADE
// AT ALL. Only the walk moves the board, and the walk is exact. No second
// copy of the engine's flash/pop timing has to exist for this to be right.
//
// riseLock as it stands at the moment of the decision is deliberately NOT
// consulted: it lasts only while panels are active, and by the time the
// walk ends the board is settled by construction. Reading a flag that will
// be false for almost all of the frames being counted would understate the
// rise, which is the direction that hides the problem.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require('./puyocpu.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var W = { colourVariance: 168, maxHeight: 136, roughness: 294, travelCost: 10 };

function cpuAt(opts) {
    var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
    var guard = 0;
    while (!stack.stopWatchIsRunning && guard++ < 1000) stack.run();
    return new PuyoCpu(stack, Object.assign({ weights: W, reaction: 12, rise: true }, opts || {}));
}
// The frame at which the Nth pixel of rise lands, from the engine's own
// table and the live timers. Used to choose test inputs, never as an
// expected answer -- every assertion below is a relation, not a number.
function framesForPixels(stack, pixels) {
    if (pixels <= 0) return 0;
    return stack.riseTimer + (pixels - 1) * PanelEngine.riseTime(stack.speed);
}

test('no travel, no row: a move that lands instantly faces the board as it stands', function () {
    var cpu = cpuAt();
    cpu.stack.stopTime = 0;
    assert.strictEqual(cpu._rowsArriving(0, null), 0);
});

test('a walk shorter than the next pixel brings no row', function () {
    var cpu = cpuAt();
    cpu.stack.stopTime = 0;
    var justShort = Math.max(0, Math.floor(framesForPixels(cpu.stack, 1)) - 1);
    assert.strictEqual(cpu._rowsArriving(justShort, null), 0);
});

test('the first row lands exactly when the 16th pixel does, not before', function () {
    var cpu = cpuAt();
    cpu.stack.stopTime = 0;
    var s = cpu.stack;
    var atRow = Math.ceil(framesForPixels(s, s.displacement));
    assert.strictEqual(cpu._rowsArriving(atRow - 1, null), 0, 'a row arrived early');
    assert.ok(cpu._rowsArriving(atRow, null) >= 1, 'the row never arrived');
});

test('sixteen more pixels is exactly one more row', function () {
    var cpu = cpuAt();
    cpu.stack.stopTime = 0;
    var s = cpu.stack;
    var one = Math.ceil(framesForPixels(s, s.displacement));
    var two = Math.ceil(framesForPixels(s, s.displacement + 16));
    assert.strictEqual(cpu._rowsArriving(two, null), cpu._rowsArriving(one, null) + 1);
});

test('it never goes backwards as the walk gets longer', function () {
    var cpu = cpuAt();
    cpu.stack.stopTime = 0;
    var last = -1;
    for (var f = 0; f <= 400; f += 7) {
        var n = cpu._rowsArriving(f, null);
        assert.ok(n >= last, 'rows fell from ' + last + ' to ' + n + ' at ' + f + ' frames');
        last = n;
    }
});

test('THE PAUSE: banked stop time postpones the row frame for frame', function () {
    // advancePassiveRaise rises only inside (!riseLock && stopTime === 0).
    // Stated as an invariant rather than a number: S frames of stop time
    // buy exactly S frames of stillness, whatever the rate happens to be.
    var cpu = cpuAt();
    var bad = [];
    [0, 13, 40, 97, 160].forEach(function (S) {
        [0, 25, 60, 120, 240, 400].forEach(function (F) {
            cpu.stack.stopTime = 0;
            var without = cpu._rowsArriving(F, null);
            var with_ = cpu._rowsArriving(F + S, { stopTime: S, toppedOut: false });
            if (without !== with_) bad.push('stop ' + S + ', walk ' + F + ': ' + without + ' vs ' + with_);
        });
    });
    assert.deepStrictEqual(bad.slice(0, 5), [], bad.length + ' mismatches:\n  ' + bad.slice(0, 5).join('\n  '));
});

test('ACCEPT: enough stop time and the board does not move at all', function () {
    var cpu = cpuAt();
    assert.strictEqual(cpu._rowsArriving(300, { stopTime: 100000, toppedOut: true }), 0);
});

test('A HOLD WAITS TOO: the cadence brings the row in', function () {
    // Charging only travel would rise every swap and never a hold, so
    // waiting would look safer than acting for a reason that is an artefact
    // of the model rather than anything the engine does.
    var cpu = cpuAt();
    var stack = cpu.stack;
    stack.stopTime = 0;
    stack.displacement = 1;       // one pixel from a new row
    stack.riseTimer = 1;
    assert.ok(cpu._rowsArriving(cpu.reaction, null) >= 1,
        'reaction alone (' + cpu.reaction + ' frames) brought no row with the stack one pixel away');

    // And through _score: the HOLD is scored first, and it must be risen.
    var count = 0, perScore = [];
    var orig = globalThis.PanelCpu.LogicalBoard.prototype.rise;
    var realScore = PuyoCpu.prototype._score;
    PuyoCpu.prototype._score = function () {
        count = 0;
        var out = realScore.apply(this, arguments);
        perScore.push(count);
        return out;
    };
    globalThis.PanelCpu.LogicalBoard.prototype.rise = function (c) { count++; return orig.call(this, c); };
    try { cpu._decide(); } finally {
        globalThis.PanelCpu.LogicalBoard.prototype.rise = orig;
        PuyoCpu.prototype._score = realScore;
    }
    assert.ok(perScore[0] > 0, 'the hold was scored on a board that never moved');
});

test('one pixel is not one row: sixteen of them are', function () {
    var cpu = cpuAt();
    var stack = cpu.stack;
    stack.stopTime = 0;
    stack.displacement = 16;
    stack.riseTimer = 1;
    assert.strictEqual(cpu._rowsArriving(Math.ceil(framesForPixels(stack, 2)), null), 0,
        'two pixels of rise produced a whole row');
});

test('WIRING: over a real game the row sometimes arrives and sometimes does not', function () {
    // At level 10 a row takes about 47 frames (riseTime 47/16 per pixel, 16
    // pixels) and a decision spans reaction + travel, roughly 12 to 25 -- so
    // most decisions bring no row and some do, depending where the live
    // displacement has got to. Both must happen, or the rule is not being
    // applied: all-zero is the old `rise: false`, all-one is the old
    // `rise: true`.
    var cpu = cpuAt();
    var stack = cpu.stack;
    var perScore = [], count = 0, decisions = 0;
    var orig = globalThis.PanelCpu.LogicalBoard.prototype.rise;
    var realScore = PuyoCpu.prototype._score;
    PuyoCpu.prototype._score = function () {
        count = 0;
        var out = realScore.apply(this, arguments);
        perScore.push(count);
        return out;
    };
    globalThis.PanelCpu.LogicalBoard.prototype.rise = function (colors) { count++; return orig.call(this, colors); };
    try {
        for (var f = 0; f < 3000 && !stack.gameOver; f++) {
            if (!cpu._walk && cpu.cooldown === 0) { cpu._decide(); decisions++; }
            cpu.update(); stack.run(); stack.drainEvents();
        }
    } finally {
        globalThis.PanelCpu.LogicalBoard.prototype.rise = orig;
        PuyoCpu.prototype._score = realScore;
    }
    assert.ok(decisions > 20, 'only ' + decisions + ' decisions — too few to prove anything');
    var none = perScore.filter(function (n) { return n === 0; }).length;
    var some = perScore.filter(function (n) { return n > 0; }).length;
    assert.ok(none > 0, 'every candidate in the whole game was risen — that is the old rise:true');
    assert.ok(some > 0, 'no candidate in the whole game was ever risen — that is the old rise:false');
});

test('rise stays OFF by default, so the shipped bot is untouched', function () {
    var cpu = cpuAt({ rise: false });
    var count = 0;
    var orig = globalThis.PanelCpu.LogicalBoard.prototype.rise;
    globalThis.PanelCpu.LogicalBoard.prototype.rise = function (c) { count++; return orig.call(this, c); };
    try { cpu._decide(); } finally { globalThis.PanelCpu.LogicalBoard.prototype.rise = orig; }
    assert.strictEqual(count, 0, 'rise ran ' + count + ' times with the option off');
});

tests.forEach(function (t) {
    try { t.fn(); process.stdout.write('  ok   ' + t.name + '\n'); }
    catch (e) { failures.push(t.name + '\n       ' + e.message); process.stdout.write('  FAIL ' + t.name + '\n'); }
});
if (failures.length) {
    process.stdout.write('\n' + failures.length + ' failed:\n\n' + failures.join('\n\n') + '\n');
    process.exit(1);
}
process.stdout.write('\n' + tests.length + ' passed — the search sees the board the move will land on.\n');
