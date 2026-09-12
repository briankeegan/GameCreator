// IS THE STAIRCASE ONE YOU CAN FIRE?  Run: node staircase.test.js
//
// docs/CHAIN_SHAPES.md, from the game's own documented library: the shape is
// a diagonal of pairs each with a gap beneath, and it goes off when a match
// AT THE BASE clears and lets the lowest step fall. No trigger, no chain —
// just a stack of loaded pairs.
//
// `staircase` counts the diagonal and never looks for the trigger, so both
// boards below score the same under it. They are not the same board: one
// fires this turn and the other cannot fire at all.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var F = require('./features.js');
var inputMod = require('./input.js');

var tests = [], failures = [];
function test(n, f) { tests.push({ name: n, fn: f }); }

var W = 6, H = 8;
function boardOf(rows) {
    var grid = [];
    for (var r = 0; r <= H; r++) {
        grid[r] = [];
        for (var c = 1; c <= W; c++) grid[r][c] = 0;
    }
    for (var i = 0; i < rows.length; i++)
        for (var c2 = 1; c2 <= W; c2++) grid[i + 1][c2] = rows[i][c2 - 1];
    return new LogicalBoard(W, H, 6, grid, {});
}
function feat(name, board) { return F[name](inputMod.normalize({ board: board })); }

// One step, and a base that CAN be set off.
//
//   row2   . . 1 . . .      the step: a 1 sitting on a 2
//   row1   1 1 2 2 3 2      the 1s are its pair; swapping the 3 and the
//                           last 2 makes 2-2-2 across columns 3-5, which
//                           clears the cell under the step
var READY = [[1, 1, 2, 2, 3, 2],
             [0, 0, 1, 0, 0, 0]];

// The same step, on a base nothing can clear: one 2 on the board, so no
// swap anywhere makes three of them.
//
//   row2   . . 1 . . .
//   row1   1 1 2 3 4 5
var INERT = [[1, 1, 2, 3, 4, 5],
             [0, 0, 1, 0, 0, 0]];

test('both boards hold the SAME staircase — otherwise this proves nothing', function () {
    assert.strictEqual(feat('staircase', boardOf(READY)), 1,
        'the ready board has no step in it; rewrite it');
    assert.strictEqual(feat('staircase', boardOf(INERT)), 1,
        'the inert board holds a different diagonal from the ready one, so any ' +
        'difference below would not be about the trigger');
});

test('a staircase WITH a trigger is ready', function () {
    assert.strictEqual(feat('staircaseReady', boardOf(READY)), 1,
        'a swap makes 2-2-2 under the step and this still reads 0');
});

test('a staircase with NO trigger is not — this is the whole feature', function () {
    assert.strictEqual(feat('staircaseReady', boardOf(INERT)), 0,
        'nothing on this board can clear the cell under the step, so the ' +
        'staircase cannot go off, and it scored anyway');
});

test('a deeper ready staircase counts its steps, not just one', function () {
    //   row3   . . . 1 . .     second step: a 1 on a 2, with 1s either side
    //   row2   . . 1 2 1 .        of it in the row below to fall between
    //   row1   1 1 2 2 3 2     base, triggerable as above
    var b = boardOf([[1, 1, 2, 2, 3, 2],
                     [0, 0, 1, 2, 1, 0],
                     [0, 0, 0, 1, 0, 0]]);
    var n = feat('staircase', b);
    assert.ok(n >= 2, 'this board was meant to hold a 2-step diagonal, reads ' + n);
    assert.strictEqual(feat('staircaseReady', b), n,
        'the base is triggerable, so ready should equal the full run (' + n + ')');
});

test('the grid is handed back exactly as it was', function () {
    // The trigger test swaps panels in place to see what a swap would do. A
    // pair left flipped would corrupt every feature computed after this one
    // on the same input, silently, and every number downstream with it.
    var b = boardOf(READY);
    var before = JSON.stringify(b.grid);
    feat('staircaseReady', b);
    assert.strictEqual(JSON.stringify(b.grid), before,
        'staircaseReady left the board mutated');
});

test('an empty board is 0, not a crash', function () {
    assert.strictEqual(feat('staircaseReady', boardOf([])), 0);
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok  ', t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL', t.name, '\n     ', e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
if (failures.length) process.exit(1);
