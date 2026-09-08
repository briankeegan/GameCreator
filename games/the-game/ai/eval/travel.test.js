// DOES THE COST MODEL MATCH WHAT THE CPU ACTUALLY PAYS? Run: node travel.test.js
//
// travel.js prices cursor movement in frames and the evaluator weights a
// feature on it. If that price is wrong, the search is trading against a
// cost the game never charges — which is exactly what happened before
// panel-cpu.js walked at all, when travel was priced and never billed.
//
// So this does NOT re-implement the walk and compare two of my own
// functions, which would agree with itself no matter how wrong it was. It
// runs the REAL cpu on a REAL stack and times its REAL walks: where the
// cursor was when a move was committed, where it went, and how many frames
// passed before the swap was queued. The formula has to match that.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PanelCpu = globalThis.PanelCpu;
var travel = require('./travel.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// Every walk the cpu makes over a real game: the distance it covered and
// the frames it took from committing to the move to queueing the swap.
function observeWalks(seed, frames) {
    var stack = new PanelEngine.Stack({ level: 3, seed: seed, countdown: false });
    var cpu = new PanelCpu.SearchCpu(stack, {
        difficulty: 'nightmare', seed: seed + 55, mistake: 0, chainExtend: true
    });
    var walks = [], open = null, f = 0;

    var origBegin = cpu._beginWalk;
    cpu._beginWalk = function (row, col, cooldown) {
        // Committed here, at this cursor, on this frame.
        // `open` still set means the previous commit never reached a
        // successful swap — this is _driveWalk's re-aim after a refusal,
        // and its clock starts partway through a journey.
        open = { from: [stack.curRow, stack.curCol], to: [row, col], start: f,
                 retry: open !== null, rises: 0 };
        return origBegin.call(this, row, col, cooldown);
    };
    var origQueue = stack.tryQueueSwap;
    stack.tryQueueSwap = function (row, col) {
        var ok = origQueue.call(this, row, col);
        if (ok && open) {
            open.frames = f - open.start;
            open.arrivedAt = [row, col];
            walks.push(open);
            open = null;
        }
        return ok;
    };

    for (; f < frames; f++) {
        if (f > 120 && f % 120 === 0) stack.receiveGarbage([{ width: 6, height: 3, isChain: false }]);
        cpu.update();
        stack.run();
        // A rising stack carries the cursor up with it for free
        // (Stack.newRow: curRow++), so a walk that spans one covers a
        // distance it never paid for. Counted, and those walks are left
        // out of the comparison rather than fudging the formula.
        for (var e = 0; e < stack.events.length; e++) {
            if (stack.events[e].type === 'newRow' && open) open.rises++;
        }
        stack.drainEvents();
        if (stack.gameOver) break;
    }
    return walks;
}

var WALKS = null;
function walks() {
    if (!WALKS) {
        WALKS = [];
        [1, 2, 3, 4].forEach(function (s) {
            observeWalks(s, 1500).forEach(function (w) { WALKS.push(w); });
        });
    }
    return WALKS;
}

test('the model prices the walks the cpu actually makes', function () {
    // A walk whose target is clamped mid-flight (the stack rises, so
    // topCurRow drops under the target row) arrives somewhere other than
    // where it aimed, and the distance it covered is the one to where it
    // ARRIVED. Price that, not the intent.
    var wrong = [], counted = 0, skipped = 0, distances = {};
    walks().forEach(function (w) {
        if (w.retry || w.rises) { skipped++; return; }
        var steps = Math.abs(w.arrivedAt[0] - w.from[0]) + Math.abs(w.arrivedAt[1] - w.from[1]);
        // The observed span is commit-frame to swap-frame. The last press
        // lands the cursor during that frame's stack.run() and the swap
        // goes in on the next update, which is why walkCost's "+1" is the
        // swap press rather than an extra step: 4 steps at cadence 4 is
        // 3 gaps of 4 plus the press = 13, and 13 is what the engine takes.
        var expect = travel.cost(w.from[0], w.from[1], w.arrivedAt[0], w.arrivedAt[1]);
        counted++;
        distances[steps] = (distances[steps] || 0) + 1;
        if (w.frames !== expect) {
            wrong.push('from ' + JSON.stringify(w.from) + ' to ' + JSON.stringify(w.arrivedAt) +
                       ' (' + steps + ' steps): engine took ' + w.frames + ', model says ' + expect);
        }
    });
    assert.ok(counted >= 100, 'only ' + counted + ' walks observed — not enough to mean anything');
    assert.ok(skipped < counted,
        skipped + ' walks were excluded against ' + counted + ' compared. Exclusions are ' +
        'for the two cases the model deliberately does not cover (a free ride on a rising ' +
        'stack, a re-aim after a refused swap); if they outnumber the rest, they are hiding ' +
        'the answer rather than sharpening it.');
    assert.ok(Object.keys(distances).length >= 5,
        'only ' + Object.keys(distances).length + ' distinct distances seen (' +
        JSON.stringify(distances) + '); a model can be wrong about the far half of the board ' +
        'and still pass a test that only ever walks one cell.');
    assert.deepStrictEqual(wrong.slice(0, 8), [],
        wrong.length + ' of ' + counted + ' walks were mispriced:\n  ' + wrong.slice(0, 8).join('\n  '));
});

test('cells above the stack top are unreachable, not expensive', function () {
    var stack = new PanelEngine.Stack({ level: 3, seed: 5, countdown: false });
    for (var i = 0; i < 200; i++) stack.run();
    var top = stack.topCurRow, W = PanelEngine.WIDTH;
    assert.strictEqual(travel.reachable(top + 1, 2, top, W), false, 'above the top must be unreachable');
    assert.strictEqual(travel.reachable(top, 2, top, W), true, 'the top row itself is reachable');
    assert.strictEqual(travel.reachable(2, W, top, W), false,
        'the rightmost column has no right-hand neighbour to swap with');
    assert.strictEqual(travel.reachable(0, 2, top, W), false, 'row 0 is below the playfield');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
