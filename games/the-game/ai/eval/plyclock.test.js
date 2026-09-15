// DOES THE SECOND PLY KNOW WHAT TIME IT IS? Run: node plyclock.test.js
//
// THE RULE: a ply that does not advance the clock cannot value timing.
//
// Every clock field reaches a feature off the LIVE stack (input.js's
// fromStack), read before any swap happens. At depth 1 that is right — the
// move is being made now. At depth 2 it is a lie: the second ply is a move
// made AFTER the first one, and it was being scored against the clock as it
// stood before the first one.
//
// The cost is that "fire the chain now" and "hold, then fire it" score
// identically on stop time. They are not the same move. awardStopTime ends
// `if (stopTime > this.stopTime) this.stopTime = stopTime` -- a MAX -- so
// firing under a full clock buys nothing and firing under an empty one buys
// everything. A second ply reading the pre-move clock cannot see which of
// those it is looking at.
//
// This is the same argument _lookahead already makes about travel: "a second
// ply that treats it as free values a great follow-up on the far side of the
// board exactly like one under the cursor". Time is the other thing the
// second ply was treating as free.
//
// WHAT IS ADVANCED, and why only these two. Both are exact -- neither is an
// estimate of anything:
//   - stopTime becomes max(live stopTime, what ply 1 earned), which is
//     awardStopTime's own line, not a restatement of it.
//   - toppedOut becomes true if ply 1's SETTLED BOARD has anything in its
//     top row, which is isToppedOut's own rule, applied to the board the
//     search already holds.
// Draining the clock by the frames ply 1 consumes is NOT done here. Travel
// frames are exact, but the cascade's duration is not available on the board
// the training path resolves with (panel-cpu.js's LogicalBoard counts row
// drops, not frames), and inventing a second copy of the engine's flash/pop
// timing is the failure this directory keeps writing comments about.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require('./puyocpu.js');
var evaluator = require('./evaluator.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var W = { matchPotential: 229, chainPotential: 258, colourVariance: 168,
          maxHeight: 136, roughness: 294, garbageSent: 107, travelCost: 10,
          stopTimeGain: 200 };

function freshCpu(opts) {
    var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
    var guard = 0;
    while (!stack.stopWatchIsRunning && guard++ < 1000) stack.run();
    return new PuyoCpu(stack, Object.assign({ weights: W, reaction: 12, depth: 2 }, opts || {}));
}

// A board whose TOP ROW is occupied, in the grid shape the search passes
// around: rows 1..height, row `height` is the top.
function toppedBoard(height, width) {
    var grid = [];
    for (var r = 0; r <= height; r++) {
        grid[r] = [];
        for (var c = 1; c <= width; c++) grid[r][c] = (r === height && c === 1) ? 1 : 0;
    }
    return { height: height, width: width, grid: grid };
}
function emptyBoard(height, width) {
    var grid = [];
    for (var r = 0; r <= height; r++) {
        grid[r] = [];
        for (var c = 1; c <= width; c++) grid[r][c] = 0;
    }
    return { height: height, width: width, grid: grid };
}


test('the ply clock takes the MAX of what is banked and what ply 1 earned', function () {
    // awardStopTime's own line. A sum would say 160 and the engine says 100.
    var cpu = freshCpu();
    cpu.stack.stopTime = 100;
    var c = cpu._plyClock({ board: emptyBoard(12, 6), earnedStop: 60 });
    assert.strictEqual(c.stopTime, 100);
});

test('the ply clock takes ply 1 s award when it beats the clock', function () {
    var cpu = freshCpu();
    cpu.stack.stopTime = 30;
    var c = cpu._plyClock({ board: emptyBoard(12, 6), earnedStop: 90 });
    assert.strictEqual(c.stopTime, 90);
});

test('the ply clock reads toppedOut from PLY 1 s board, not from the live stack', function () {
    // The half that makes "you will be in danger by then" visible. The live
    // stack here is a fresh board: not topped out.
    var cpu = freshCpu();
    assert.ok(!cpu.stack.wasToppedOut, 'setup: a fresh stack should not be topped out');
    assert.strictEqual(cpu._plyClock({ board: toppedBoard(12, 6), earnedStop: 0 }).toppedOut, true);
    assert.strictEqual(cpu._plyClock({ board: emptyBoard(12, 6), earnedStop: 0 }).toppedOut, false);
});

test('a live stack that IS topped out stays topped out whatever ply 1 s board looks like', function () {
    // wasToppedOut is the flag the engine acts on. A candidate that settles
    // lower does not un-top the stack the move is being made from.
    var cpu = freshCpu();
    cpu.stack.wasToppedOut = true;
    assert.strictEqual(cpu._plyClock({ board: emptyBoard(12, 6), earnedStop: 0 }).toppedOut, true);
});


// ---- the wiring, through a real decision ----
//
// _resolveCandidate is STUBBED so exactly one candidate earns stop time.
// That is deliberate: what is under test is whether ply 2 is scored against
// ply 1's clock, not whether the engine awards the right number for a given
// board -- input.fidelity.test.js's sweep owns that question, against the
// real engine. A board hand-built to fire a real 4-combo would make this
// test depend on both, and a failure would not say which.
function taps(cpu, earner) {
    var seen = [];
    var realEval = evaluator.evaluate;
    evaluator.evaluate = function (input, w, o) {
        seen.push(input.clock.stopTime);
        return realEval.call(this, input, w, o);
    };
    var realResolve = cpu._resolveCandidate;
    var n = 0;
    cpu._resolveCandidate = function (board) {
        var out = realResolve.call(this, board);
        out.stopTimeEarned = (n++ === earner) ? 90 : 0;
        return out;
    };
    return function () { evaluator.evaluate = realEval; cpu._resolveCandidate = realResolve; return seen; };
}

test('SETUP: the live stack has no stop time, so every 90 seen came from ply 1', function () {
    var cpu = freshCpu();
    assert.strictEqual(cpu.stack.stopTime || 0, 0);
});

test('ply 2 is scored against the clock ply 1 leaves behind', function () {
    var cpu = freshCpu();
    cpu.stack.stopTime = 0;
    var done = taps(cpu, 1);          // the FIRST SWAP earns; hold is index 0
    cpu._decide();
    var seen = done();
    assert.ok(seen.length > 20, 'only ' + seen.length + ' evaluations — the search did not run');
    assert.ok(seen.indexOf(90) >= 0,
        'no evaluation ever saw the 90 frames ply 1 earned, so the second ply is ' +
        'still being scored against the pre-move clock');
});

test('and only the children of the candidate that EARNED it see it', function () {
    // The ACCEPT half. A clock advanced for every child regardless of which
    // candidate they descend from would pass the test above and be wrong in
    // the more damaging direction: it would tell the search that waiting is
    // pointless because the clock is full either way.
    var cpu = freshCpu();
    cpu.stack.stopTime = 0;
    var done = taps(cpu, 1);
    cpu._decide();
    var seen = done();
    var withStop = seen.filter(function (v) { return v === 90; }).length;
    var without = seen.filter(function (v) { return v === 0; }).length;
    assert.ok(withStop > 0, 'nothing saw the award');
    assert.ok(without > withStop,
        withStop + ' evaluations saw the award and only ' + without + ' did not — ' +
        'the clock is being advanced for candidates that earned nothing');
});

test('DEPTH 1 IS UNTOUCHED: with no lookahead, every evaluation sees the live clock', function () {
    // The move is being made NOW at depth 1, so the live clock is correct
    // there and advancing it would be the bug in reverse.
    var cpu = freshCpu({ depth: 1 });
    cpu.stack.stopTime = 7;
    var done = taps(cpu, 1);
    cpu._decide();
    var seen = done();
    assert.ok(seen.length > 5, 'the search did not run');
    var odd = seen.filter(function (v) { return v !== 7; });
    assert.deepStrictEqual(odd, [],
        'depth 1 saw ' + odd.length + ' evaluations at a clock other than the live 7');
});

tests.forEach(function (t) {
    try { t.fn(); process.stdout.write('  ok   ' + t.name + '\n'); }
    catch (e) { failures.push(t.name + '\n       ' + e.message); process.stdout.write('  FAIL ' + t.name + '\n'); }
});
if (failures.length) {
    process.stdout.write('\n' + failures.length + ' failed:\n\n' + failures.join('\n\n') + '\n');
    process.exit(1);
}
process.stdout.write('\n' + tests.length + ' passed — the second ply knows what time it is.\n');
