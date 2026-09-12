#!/usr/bin/env node
// THE BOT MAY ONLY KNOW WHAT THE ENGINE HAS SHOWN IT.
//
// When a match touches a garbage slab the engine pops ONE ROW of it and turns
// that row into coloured panels — colours drawn from this.rng()
// (Stack.garbageRowColors). A planner that predicted them would be reading
// dice it is not allowed to see, and every chain it "found" past that point
// would be a chain it cannot actually play.
//
// So resolve() stops at a garbage break. These tests fix what it must get
// right UP TO that point, and that it refuses to go past it. See
// ../GARBAGE_PLAN.md.
//
// Written before the fix, and failing, on purpose.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var eb = require('./engineboard.js');
var W = 6, H = 12;

var failures = [];
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures.push(name); }
}

// Rows top-first. Digits are colours, '.' empty, a LETTER is a garbage slab —
// same encoding the fixture uses, so a board here reads like a board there.
function build(rows) {
    var height = rows.length, grid = [], blocks = {};
    for (var r = 0; r <= H; r++) { grid[r] = []; for (var c = 1; c <= W; c++) grid[r][c] = 0; }
    for (r = 0; r < height; r++) {
        var row = height - r;
        for (var c = 1; c <= rows[r].length; c++) {
            var ch = rows[r][c - 1];
            if (ch === '.') continue;
            if (ch >= 'a' && ch <= 'z') {
                grid[row][c] = -2;
                (blocks['g' + ch] = blocks['g' + ch] || { cells: [] }).cells.push([row, c]);
            } else grid[row][c] = Number(ch);
        }
    }
    return { grid: grid, blocks: blocks };
}
function board(rows) {
    var b = build(rows);
    return new LogicalBoard(W, H, 9, b.grid, b.blocks);
}
function occupied(g, r, c) { return g[r][c] !== 0; }
function garbageCells(b) {
    var n = 0;
    for (var r = 1; r <= H; r++) for (var c = 1; c <= W; c++) if (b.grid[r][c] === -2) n++;
    return n;
}

// A 6x2 slab sitting on a row that is one swap from a horizontal three.
// Swapping r2c3 with r2c4 lines up 1,1,1 directly under the slab.
var ROWS = [
    'aaaaaa',
    'aaaaaa',
    '11.1..',
    '332233'
];

check('a match under a slab breaks ONE ROW of it, not the whole slab', function () {
    var b = board(ROWS);
    var before = garbageCells(b);
    assert.strictEqual(before, 12, 'the fixture should start with a 6x2 slab');
    b.swap(2, 3);
    b.resolve();
    var after = garbageCells(b);
    assert.notStrictEqual(after, 0,
        'the whole slab was deleted — the engine pops one row and leaves the rest');
    assert.strictEqual(after, 6,
        'expected one row of six to pop, leaving six; got ' + after + ' left of ' + before);
});

check('the popped row is still OCCUPIED afterwards, not empty', function () {
    // The engine converts that row into panels. Their colours are unknowable,
    // but the cells are NOT empty — a board that empties them reads shorter
    // than it is, and every height-based feature is wrong on it.
    var b = board(ROWS);
    b.swap(2, 3);
    b.resolve();
    // -1 is this board's "a panel is here and its colour is not known", which
    // is exactly what a converted garbage cell is. Counted wherever they ended
    // up rather than at a fixed row, since the resolve stops before gravity
    // and the row they occupy is not the point — that they still EXIST is.
    var unknown = 0;
    for (var r = 1; r <= H; r++) for (var c = 1; c <= W; c++) if (b.grid[r][c] === -1) unknown++;
    assert.strictEqual(unknown, 6,
        'expected the six popped garbage cells to remain as panels of unknown colour, got ' +
        unknown + ' — emptying them makes the stack read shorter than the engine has it');
});

check('a resolve stopped at a garbage break SAYS SO', function () {
    var b = board(ROWS);
    b.swap(2, 3);
    var res = b.resolve();
    assert.ok(res.truncated === true,
        'resolve() broke garbage and reported a finished cascade — a caller cannot tell ' +
        'a stopped resolve from a completed one, which is the same mistake one layer up');
    assert.ok(typeof res.brokeGarbage === 'number' && res.brokeGarbage > 0,
        'resolve() does not report how much garbage broke');
});

check('the stop time reported is the stop time the ENGINE awards', function () {
    // Frames are survival, and this is the real payoff for breaking garbage.
    // Asserted against the engine rather than against a number I expected:
    // under the modern formula a plain three earns NOTHING (awardStopTime
    // needs comboSize > 3 or a chain), so "greater than zero" would have been
    // testing my assumption instead of the rule. ROWS clears a three, so the
    // honest expectation here is zero, and a wider clear is checked below.
    var b = board(ROWS);
    b.swap(2, 3);
    var res = b.resolve();
    assert.strictEqual(typeof res.stopTimeEarned, 'number', 'stopTimeEarned is not reported at all');

    var bi = build(ROWS), blocks = {};
    for (var id in bi.blocks) blocks[id] = bi.blocks[id].cells;
    var stack = eb.scratch(10);
    stack.speed = 0;
    eb.paint(stack, bi.grid, H, W, blocks);
    eb.settle(stack, 60);
    stack.stopTime = 0;
    stack.curRow = 2; stack.curCol = 3;
    stack.doSwap(2, 3);
    var peak = 0;
    for (var f = 0; f < 200; f++) {
        stack.run();
        if (stack.stopTime > peak) peak = stack.stopTime;
        if (f >= 3 && !stack.hasActivePanels() && !stack.hasChainingPanels()) break;
    }
    assert.strictEqual(res.stopTimeEarned, peak,
        'reports ' + res.stopTimeEarned + ' frames of stop time, the engine awards ' + peak);
});

check('a clear wide enough to earn stop time reports it', function () {
    // Four in a row under the slab: comboSize > 3, so the engine does award
    // stop time and a zero here would mean the term is dead rather than right.
    var wide = ['aaaaaa', 'aaaaaa', '111.1.', '332233'];
    var b = board(wide);
    b.swap(2, 4);
    var res = b.resolve();
    assert.ok(res.brokeGarbage > 0, 'the fixture did not break garbage');
    assert.ok(res.stopTimeEarned > 0,
        'a four-panel clear broke garbage and reported no stop time');
});

check('a resolve that touches no garbage is NOT truncated', function () {
    // The near-miss: the flag must mean something, so an ordinary cascade
    // must not carry it.
    var b = board(['11.1..', '332233']);
    b.swap(2, 3);
    var res = b.resolve();
    assert.ok(!res.truncated, 'an ordinary resolve reported itself truncated');
    assert.ok(!res.brokeGarbage, 'an ordinary resolve reported breaking garbage');
});

check('up to the break, the simulation agrees with the engine exactly', function () {
    var b = build(ROWS);
    var stack = eb.scratch(10);
    stack.speed = 0;
    eb.paint(stack, b.grid, H, W, (function () {
        var out = {};
        for (var id in b.blocks) out[id] = b.blocks[id].cells;
        return out;
    })());
    assert.strictEqual(eb.settle(stack, 60).comboSizes.length, 0, 'the fixture is not settled');
    assert.ok(stack.canSwap(2, 3), 'the engine refuses the fixture swap');
    stack.curRow = 2; stack.curCol = 3;
    stack.doSwap(2, 3);
    var eng = eb.settle(stack, 900);

    var lb = board(ROWS);
    lb.swap(2, 3);
    var sim = lb.resolve();
    var simCleared = (sim.comboSizes || []).reduce(function (a, x) { return a + x; }, 0);

    // The FIRST match is entirely before the break and must match exactly.
    assert.strictEqual(sim.comboSizes[0], eng.comboSizes[0],
        'the first combo differs: simulation ' + sim.comboSizes[0] + ', engine ' + eng.comboSizes[0]);
    assert.ok(simCleared <= eng.clearedPanels,
        'the simulation cleared MORE than the engine (' + simCleared + ' vs ' +
        eng.clearedPanels + ') — it resolved past the break it cannot see');
});

console.log('');
if (failures.length) { console.log(failures.length + ' failed.'); process.exit(1); }
console.log('Garbage breaks stop the resolve, and everything up to them is exact.');
