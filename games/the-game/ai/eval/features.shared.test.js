#!/usr/bin/env node
// THE SHARED RESOLVE PASS RETURNS EXACTLY WHAT THE SEPARATE PASSES DID.
//
// matchPotential, comboPotential, chainPotential and staircaseReady's trigger
// all ask the same question — clone the board, make each legal swap, let it
// settle — and they now share one pass instead of running four. That took the
// cost of a correct matchPotential from +102% per candidate to +2.8%.
//
// The saving is only honest if the answers are identical, and "identical"
// is exactly the claim that hides its own failure: a shared pass that
// answers one feature from another feature's board looks like a fast bot,
// not like a broken one. So every feature is recomputed here the slow,
// separate way and compared, on REAL boards — Panel Attack's own 235
// authored puzzles, the same source puzzles.bench.js reads, because a
// hand-typed board only tests what the typist thought to type.
//
// The cache is checked in the direction that can rot: a board MUTATED
// between two reads must not answer from the pass taken before the change.
var assert = require('assert');
var path = require('path'), fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var F = require('./features.js');
var inputMod = require('./input.js');

var W = 6, H = 12;
var PANEL_GAME = process.env.GC_PANEL_GAME || '/home/user/panel-game';
var FILE = path.join(PANEL_GAME, 'client/assets/default_data/puzzles/Puzzles.json');

function puzzles() {
    var j = JSON.parse(fs.readFileSync(FILE, 'utf8')), out = [];
    (function walk(node) {
        (node['Puzzle Sets'] || []).forEach(walk);
        (node['Puzzles'] || []).forEach(function (p) { out.push(p); });
    })(j);
    return out;
}
function boardFrom(stack) {
    var s = String(stack).replace(/\s+/g, '');
    if (/[^0-9]/.test(s)) return null;
    while (s.length % W) s = '0' + s;
    var rows = [];
    for (var i = 0; i < s.length; i += W) rows.push(s.slice(i, i + W));
    var grid = [];
    for (var r = 0; r <= H; r++) { grid[r] = []; for (var c = 1; c <= W; c++) grid[r][c] = 0; }
    for (var k = 0; k < rows.length; k++) {
        var row = rows.length - k; if (row > H) continue;
        for (var c2 = 1; c2 <= W; c2++) {
            var d = Number(rows[k][c2 - 1]);
            // 8 is SHOCK and 9 is COLORLESS — garbage, not colours.
            grid[row][c2] = (d === 8 || d === 9) ? -2 : d;
        }
    }
    return new LogicalBoard(W, H, 9, grid, {});
}

// ---- the same four questions, each asked the slow separate way ----
function garbageCells(b) {
    var n = 0;
    for (var r = 1; r <= b.height; r++)
        for (var c = 1; c <= b.width; c++) if (b.grid[r][c] === -2) n++;
    return n;
}
function slowEach(board, visit) {
    var before = garbageCells(board), swaps = board.legalSwaps();
    for (var i = 0; i < swaps.length; i++) {
        var t = board.clone();
        t.swap(swaps[i][0], swaps[i][1]);
        var res = t.resolve(), sizes = res.comboSizes || [], biggest = 0;
        for (var k = 0; k < sizes.length; k++) if (sizes[k] > biggest) biggest = sizes[k];
        visit({ cleared: sizes.length > 0, biggest: biggest, chainLength: res.chainLength,
                ateGarbage: garbageCells(t) < before, grid: t.grid });
    }
}
function slowMatchPotential(board) {
    var n = 0;
    slowEach(board, function (o) {
        if (o.cleared && (o.biggest >= 4 || o.chainLength >= 2 || o.ateGarbage)) n++;
    });
    return n;
}
function slowComboPotential(board) {
    var best = 0;
    slowEach(board, function (o) { if (o.biggest > best) best = o.biggest; });
    return best;
}
function slowChainPotential(board) {
    var best = 0;
    slowEach(board, function (o) { if (o.chainLength > best) best = o.chainLength; });
    return best;
}
function slowStaircaseReady(board) {
    // staircaseReady's shape scan is not duplicated here — only its TRIGGER
    // goes through the shared pass, so the feature is compared whole against
    // itself computed on a board the cache has never seen.
    return F.staircaseReady(inputMod.normalize({ board: board, liveBoard: board }));
}

var boards = [];
puzzles().forEach(function (p) { var b = boardFrom(p.Stack); if (b) boards.push(b); });
assert.ok(boards.length > 100, 'expected a hundred-odd readable puzzle boards, got ' + boards.length);

// A GRID TEST COLLECTS. Throwing on the first mismatch turns "which feature
// drifted, and on how many boards" into one question per run.
var bad = [];
boards.forEach(function (b, idx) {
    // One input, all four features — the order the evaluator uses, and the
    // order in which a stale cache would do its damage.
    var inp = inputMod.normalize({ board: b, liveBoard: b });
    var got = {
        matchPotential: F.matchPotential(inp),
        comboPotential: F.comboPotential(inp),
        chainPotential: F.chainPotential(inp),
        staircaseReady: F.staircaseReady(inp)
    };
    // Recomputed on a FRESH clone so the slow side cannot read the cache.
    var fresh = b.clone();
    var want = {
        matchPotential: slowMatchPotential(fresh),
        comboPotential: slowComboPotential(fresh),
        chainPotential: slowChainPotential(fresh),
        staircaseReady: slowStaircaseReady(fresh)
    };
    Object.keys(want).forEach(function (k) {
        if (got[k] !== want[k]) bad.push('board ' + idx + ' ' + k + ': shared ' + got[k] + ', separate ' + want[k]);
    });
});

var failures = [];
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures.push(name); }
}

check('the shared pass agrees with four separate passes on every real board', function () {
    assert.deepStrictEqual(bad, [], bad.length + ' of ' + (boards.length * 4) +
                           ' answers differ:\n  ' + bad.slice(0, 12).join('\n  '));
});

check('a board MUTATED between two reads is not answered from the stale pass', function () {
    // The cache is keyed on the board object, and the board object is the
    // one thing a caller can change under it. Find a board where a swap
    // changes chainPotential, read it, apply the swap, read it again.
    var moved = null;
    for (var i = 0; i < boards.length && !moved; i++) {
        var b = boards[i].clone();
        var inp = inputMod.normalize({ board: b, liveBoard: b });
        var first = F.chainPotential(inp);
        var swaps = b.legalSwaps();
        for (var s = 0; s < swaps.length; s++) {
            var t = b.clone(); t.swap(swaps[s][0], swaps[s][1]);
            var tin = inputMod.normalize({ board: t, liveBoard: t });
            if (F.chainPotential(tin) === first) continue;
            var want = F.chainPotential(tin);
            // Now do it IN PLACE on the board already in the cache.
            b.swap(swaps[s][0], swaps[s][1]);
            var after = F.chainPotential(inputMod.normalize({ board: b, liveBoard: b }));
            moved = { want: want, after: after };
            break;
        }
    }
    assert.ok(moved, 'no board in the set changes chainPotential under a swap — the test proves nothing');
    assert.strictEqual(moved.after, moved.want,
                       'the cache answered from the board as it was before it was mutated');
});

check('no real board to plan on means 0, never an invented number', function () {
    var plain = { width: 6, height: 12, grid: [], blocks: {} };
    for (var r = 0; r <= 12; r++) { plain.grid[r] = []; for (var c = 1; c <= 6; c++) plain.grid[r][c] = 0; }
    var inp = inputMod.normalize({ board: plain });
    assert.strictEqual(F.matchPotential(inp), 0);
    assert.strictEqual(F.comboPotential(inp), 0);
    assert.strictEqual(F.chainPotential(inp), 0);
    assert.strictEqual(F.staircaseReady(inp), 0);
});

console.log('');
if (failures.length) {
    console.log(failures.length + ' failed.');
    process.exit(1);
}
console.log('The shared pass is the same answer, on ' + boards.length + ' real boards.');
