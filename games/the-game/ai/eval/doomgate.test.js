// THE DEEP-SURVIVAL FILTER'S GATE ASKS ABOUT THE BOARDS IT JUDGES.
// Run: node doomgate.test.js
//
// THE BUG THIS EXISTS FOR. _doomed refuses a move that no line of play
// survives once the stack rises, and it is gated on height for cost. The gate
// read the LIVE board's top row; every test below it is applied to a
// candidate's SETTLED board, which can be rows taller -- a raise adds one, a
// slab can land during the settle, and the walk's own rise is already in it.
// So a decision could hold a candidate standing in row 12 and be skipped
// because the board the bot was standing on was low.
//
// Read off 20 duels: shut on 101 decisions where some candidates were doomed
// and others were not, 69 of them at a live top row of exactly 8 -- one row
// under the threshold -- with up to 8 of 18 candidates dead; and on 15 more
// where EVERY candidate was doomed, which also left allDoomedNow unset and
// _lastResort blind.
//
// The second half is that staleness. allDoomedNow, allAboveCapNow and
// allCorneredNow are written by filters that can decline to run, so the last
// answer stood in for the missing one and _lastResort could fire on a decision
// nothing had judged.
//
// WHAT BINDS HERE: the gate must open on a pool that contains a doomed
// candidate however low the live board is, and must still stay shut when the
// candidates themselves are all low -- the cost guard is the reason the gate
// exists and a test that only proves it opens would accept deleting it.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var PuyoCpu = require('./puyocpu.js');

var failures = [];
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures.push(name); }
}

var W = 6, H = 12;

// Rows 1..top filled with colours laid so nothing matches, so a resolve
// changes nothing and the only thing moving in an answer is the floor.
function boardTo(top) {
    var grid = [], r, c;
    for (r = 0; r <= H; r++) { grid[r] = []; for (c = 1; c <= W; c++) grid[r][c] = 0; }
    for (r = 1; r <= top; r++) for (c = 1; c <= W; c++) grid[r][c] = ((r + c) % 4) + 1;
    return new LogicalBoard(W, H, 6, grid, {});
}

function quietStack() {
    var stack = new PanelEngine.Stack({ width: W, height: H, level: 10 });
    stack.displacement = 0;
    stack.riseTimer = 100;
    stack.stopTime = 0;
    stack.preStopTime = 0;
    stack.shakeTime = 0;
    stack.peakShakeTime = 0;
    stack.incoming = [];
    return stack;
}

// PuyoCpu(stack, opts) -- two arguments. A third is silently dropped and the
// engine path is never exercised, which makes every resolve below a no-op.
function cpuOn() {
    var cpu = new PuyoCpu(quietStack(), { engine: true, level: 10 });
    assert.ok(cpu.engine, 'fixture built a CPU with the engine path off');
    assert.ok(cpu.refuseSuicide && cpu.deepSurvival,
              'fixture built a CPU with the filter switched off');
    return cpu;
}

function cand(board) {
    return { kind: 'swap', move: [1, 1], settled: board, board: board,
             resolved: { chainLength: 0, comboSizes: [], garbage: [],
                         clearedPanels: 0, stopTimeEarned: 0 } };
}

check('the gate OPENS on a doomed candidate while the live board is low', function () {
    var cpu = cpuOn();
    cpu._board = boardTo(3);
    assert.strictEqual(cpu._topRowOf(cpu._board), 3, 'fixture live board should be low');
    var dead = cand(boardTo(H));       // standing in the lid: no line survives it
    var alive = cand(boardTo(3));
    assert.ok(!cpu._survivesRise(dead.settled, cpu.DOOMED_DEPTH),
              'fixture: the tall candidate should not survive the rise');
    assert.ok(cpu._survivesRise(alive.settled, cpu.DOOMED_DEPTH),
              'fixture: the low candidate should survive the rise');
    var out = cpu._doomed([dead, alive]);
    assert.strictEqual(out.length, 1,
        'the gate stayed shut on a pool holding a candidate in row ' + H +
        ' because the LIVE board was at row 3 -- ' + out.length + ' of 2 kept');
    assert.strictEqual(out[0], alive, 'it kept the doomed move instead of the living one');
});

check('the gate STAYS SHUT when the candidates themselves are low', function () {
    var cpu = cpuOn();
    cpu._board = boardTo(3);
    var a = cand(boardTo(3)), b = cand(boardTo(4));
    var pool = [a, b];
    var out = cpu._doomed(pool);
    assert.strictEqual(out, pool,
        'the gate ran on a pool of low boards, which is the ten-times cost it ' +
        'exists to avoid');
    assert.strictEqual(cpu.doomedDecisions, 0, 'it recorded a verdict it never reached');
});

check('a decision that judges nothing does not inherit the last one\'s verdict', function () {
    var cpu = cpuOn();
    cpu.allDoomedNow = true;
    cpu.allAboveCapNow = true;
    cpu.allCorneredNow = true;
    cpu._candidates();
    assert.strictEqual(cpu.allDoomedNow, false,
        'allDoomedNow carried into a decision no filter had judged, which is ' +
        'what let _lastResort fire on a verdict from an earlier board');
    assert.strictEqual(cpu.allAboveCapNow, false, 'allAboveCapNow carried over');
    assert.strictEqual(cpu.allCorneredNow, false, 'allCorneredNow carried over');
});

if (failures.length) {
    console.log('\n' + failures.length + ' FAILED: ' + failures.join(', '));
    process.exit(1);
}
console.log('\nall ok');
