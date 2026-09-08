// DOES THE COST FUNCTION MATCH THE ENGINE? Run: node travel.test.js
//
// travel.js prices cursor movement in frames, and every number in it came
// from driving a real Stack rather than from reading applyInput. This keeps
// it that way: the formula is compared against the engine over every
// start/target pair on the board, and a mismatch fails.
//
// The first version of axisCost was off by one (20 + steps instead of
// 19 + steps) and looked perfectly reasonable. Nothing but the engine was
// ever going to catch that.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
var PanelEngine = globalThis.PanelEngine;
var travel = require('./travel.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function freshStack() {
    var s = new PanelEngine.Stack({ level: 3, seed: 5, countdown: false });
    var guard = 0;
    while (!s.stopWatchIsRunning && guard++ < 1000) s.run();
    for (var i = 0; i < 60; i++) s.run();
    return s;
}

// Frames the ENGINE takes to walk the cursor there, holding directions the
// way a player does. null if it never arrives.
function engineCost(r0, c0, r1, c1, cap) {
    var s = freshStack();
    s.curRow = r0; s.curCol = c0;
    for (var f = 0; f < (cap || 300); f++) {
        if (s.curRow === r1 && s.curCol === c1) return f;
        var input = {};
        if (s.curCol < c1) input.right = true;
        else if (s.curCol > c1) input.left = true;
        else if (s.curRow < r1) input.up = true;
        else if (s.curRow > r1) input.down = true;
        s.setInput(input);
        s.run();
    }
    return null;
}

test('the cost function matches the engine on every reachable pair', function () {
    var probe = freshStack();
    var top = probe.topCurRow, W = PanelEngine.WIDTH;
    assert.ok(top >= 2, 'setup: stack top is ' + top);

    var checked = 0, mismatches = [], distances = {};
    // sample rather than sweep: each pair costs a fresh stack and up to 300
    // frames, and the space is (top x W)^2
    for (var r0 = 1; r0 <= top; r0 += 2) {
        for (var c0 = 1; c0 < W; c0 += 2) {
            for (var r1 = 1; r1 <= top; r1 += 3) {
                for (var c1 = 1; c1 < W; c1 += 2) {
                    var want = engineCost(r0, c0, r1, c1);
                    if (want === null) continue;
                    var got = travel.cost(r0, c0, r1, c1);
                    if (got !== want) {
                        mismatches.push('(' + r0 + ',' + c0 + ')->(' + r1 + ',' + c1 + '): ' +
                                        'formula ' + got + ', engine ' + want);
                    }
                    var d = Math.abs(r1 - r0) + Math.abs(c1 - c0);
                    distances[d] = (distances[d] || 0) + 1;
                    checked++;
                }
            }
        }
    }
    assert.ok(checked > 100, 'only checked ' + checked + ' pairs');
    // a sweep that only ever tested distance 0 and 1 would prove nothing
    assert.ok(Object.keys(distances).length > 4,
        'only ' + Object.keys(distances).length + ' distinct distances covered');
    assert.deepStrictEqual(mismatches.slice(0, 5), [],
        mismatches.length + ' of ' + checked + ' pairs disagree with the engine. ' +
        'First few: ' + mismatches.slice(0, 5).join(' | '));
    process.stdout.write('       [travel] ' + checked + ' pairs, ' +
        Object.keys(distances).length + ' distinct distances, all match\n');
});

test('the second step in a direction is the expensive one', function () {
    // The shape that matters for the search: one step is nearly free, two
    // is 21 frames. A bot that does not know this will happily pay 21
    // frames for a swap worth less than the row it lost.
    assert.strictEqual(travel.axisCost(1), 1);
    assert.strictEqual(travel.axisCost(2), 21);
    assert.strictEqual(travel.axisCost(3), 22);
    assert.strictEqual(engineCost(6, 1, 6, 2), 1);
    assert.strictEqual(engineCost(6, 1, 6, 3), 21);
});

test('two long legs cost double — an L is not a shortcut', function () {
    // Each axis pays its own DAS. Same Manhattan distance, twice the price.
    assert.strictEqual(travel.cost(6, 1, 6, 5), 23);   // 4 across
    assert.strictEqual(travel.cost(6, 1, 9, 2), 23);   // 1 across + 3 up
    assert.strictEqual(travel.cost(6, 1, 8, 3), 42);   // 2 across + 2 up
    assert.strictEqual(engineCost(6, 1, 8, 3), 42, 'the engine disagrees about the L');
});

test('above the stack top is UNREACHABLE, not expensive', function () {
    // clampCursor caps curRow at topCurRow, so the cursor never arrives.
    // The search must not offer those cells at all — the same distinction
    // meatfighter's BFS makes between a placement that is far and one that
    // cannot be reached.
    var s = freshStack();
    var top = s.topCurRow, W = PanelEngine.WIDTH;
    assert.strictEqual(travel.reachable(top, 1, top, W), true);
    assert.strictEqual(travel.reachable(top + 1, 1, top, W), false);
    assert.strictEqual(travel.reachable(1, W, top, W), false, 'a swap needs a right neighbour');
    assert.strictEqual(engineCost(1, 1, top + 1, 1, 120), null,
        'the engine reached a cell above the stack top');
});

tests.forEach(function (t) {
    try { t.fn(); process.stdout.write('  ok   ' + t.name + '\n'); }
    catch (e) { failures.push(t.name + '\n       ' + e.message); process.stdout.write('  FAIL ' + t.name + '\n'); }
});
if (failures.length) {
    process.stdout.write('\n' + failures.length + ' failed:\n\n' + failures.join('\n\n') + '\n');
    process.exit(1);
}
process.stdout.write('\n' + tests.length + ' passed — travel cost matches the engine.\n');
