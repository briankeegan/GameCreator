#!/usr/bin/env node
// CAN THE BOT BUILD A CHAIN, NOT JUST TAKE ONE THAT IS ALREADY THERE?
//
//   node puzzles.play.js [GC_WEIGHTS=snap.json]   (switches come with them)
//
// WHY THIS EXISTS, given puzzles.bench.js already runs these boards. That
// bench asks a ONE-SWAP question: is a chain reachable in a single move, and
// does the bot take it? Every bot measured answers 18/18, and the other 66
// chain puzzles are not skipped for any technical reason — every one of them
// carries `Moves: 0`, meaning unlimited, because they are multi-swap SETUPS
// by design. A one-swap question of a multi-swap puzzle throws away 79% of
// the ground truth the game ships and then reports a saturated score.
//
// So this one lets the bot keep playing: up to BUDGET swaps on a static
// board (nothing rises, no new panels — a puzzle), and asks how deep a chain
// it ever fires. That is the Tier 1 / Tier 2 line from ../PUYO_REFERENCE.md
// stated as a measurement: a greedy bot takes the chain in front of it, a
// searching one assembles one that was not there.
//
// IT DRIVES THE REAL BOT, not a re-implementation. PuyoCpu._decide is called
// with a stubbed _snapshot, so depth, beam, rise and density are whatever
// the weights were found under and the decision is the one the game would
// make. A second copy of the scoring loop is exactly how puzzles.bench.js
// came to disagree with the game about which digits are colours.
var path = require('path');
var fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var PuyoCpu = require('./puyocpu.js');
var switches = require('./switches.js');

var loaded = switches.load();
console.log(switches.describe(loaded));

var PANEL_GAME = process.env.GC_PANEL_GAME || '/home/user/panel-game';
var FILE = path.join(PANEL_GAME, 'client/assets/default_data/puzzles/Puzzles.json');
var W = 6, H = 12;
// Enough rope to build something, short enough that a bot shuffling panels
// forever is reported as stuck rather than run until the heat death. Real
// solutions in Puzzles.json are a handful of swaps.
var BUDGET = Number(process.env.GC_BUDGET || 12);

function puzzles() {
    var j = JSON.parse(fs.readFileSync(FILE, 'utf8')), out = [];
    (function walk(node, trail) {
        (node['Puzzle Sets'] || []).forEach(function (s) {
            walk(s, trail.concat(s['Set Name'] || '?'));
        });
        (node['Puzzles'] || []).forEach(function (p) { out.push({ set: trail.join('/'), p: p }); });
    })(j, []);
    return out;
}

// Same reading as puzzles.bench.js, and for the same reason: 8 (shock) and
// 9 (colorless) are garbage, not colours — Panel.lua's colour arrays and
// checkMatches.lua's canMatch, which returns false for 9 outright.
function boardFrom(stack) {
    var s = String(stack).replace(/\s+/g, '');
    if (/[^0-9]/.test(s)) return null;
    while (s.length % W) s = '0' + s;
    var rows = [];
    for (var i = 0; i < s.length; i += W) rows.push(s.slice(i, i + W));
    var grid = [];
    for (var r = 0; r <= H; r++) { grid[r] = []; for (var c = 1; c <= W; c++) grid[r][c] = 0; }
    for (var k = 0; k < rows.length; k++) {
        var row = rows.length - k;
        if (row > H) continue;
        for (var c2 = 1; c2 <= W; c2++) {
            var d = Number(rows[k][c2 - 1]);
            grid[row][c2] = (d === 8 || d === 9) ? -2 : d;
        }
    }
    return new LogicalBoard(W, H, 9, grid, {});
}

// The least stack that _score and input.fromStack actually read. A puzzle
// has no rising, no incoming garbage and no health, so every one of these is
// genuinely zero rather than a placeholder standing in for something.
function stubStack(getBoard) {
    function Stub() {}
    Stub.WIDTH = W;
    var s = new Stub();
    s.colors = 6;
    s.displacement = 0;
    s.incoming = [];
    s.wasToppedOut = false;
    s.riseLock = false;
    s.preStopTime = 0;
    s.stopTime = 0;
    s.shakeTime = 0;
    s.health = 0;
    s.levelData = { maxHealth: 0 };
    s.curRow = 1;
    s.curCol = 1;
    s.panelAt = function (r, c) {
        var v = getBoard().grid[r][c];
        if (!v) return null;
        return { isGarbage: v === -2, color: v > 0 ? v : 0 };
    };
    return s;
}

function play(board) {
    var cur = board;
    var cpu = new PuyoCpu(stubStack(function () { return cur; }), {
        weights: loaded.weights,
        depth: loaded.switches.depth,
        beam: loaded.switches.beam,
        rise: loaded.switches.rise,
        density: loaded.switches.density
    });
    cpu._snapshot = function () { return cur.clone(); };

    var deepest = 0, swaps = 0, why = 'budget';
    for (var i = 0; i < BUDGET; i++) {
        var d = cpu._decide();
        if (!d || d.kind !== 'swap') { why = 'held'; break; }
        var next = cur.clone();
        next.swap(d.move[0], d.move[1]);
        var res = next.resolve();
        cur = next;
        swaps++;
        cpu.stack.curRow = d.move[0];
        cpu.stack.curCol = d.move[1];
        if (res.chainLength > deepest) deepest = res.chainLength;
        if (!cur.legalSwaps().length) { why = 'no legal swap'; break; }
    }
    return { deepest: deepest, swaps: swaps, why: why };
}

var chains = puzzles().filter(function (x) { return x.p['Puzzle Type'] === 'chain'; });
var n = 0, fired = 0, byDepth = {}, stuck = 0, t0 = Date.now();
chains.forEach(function (x) {
    var board = boardFrom(x.p.Stack);
    if (!board) return;
    n++;
    var r = play(board);
    if (r.deepest >= 2) { fired++; byDepth[r.deepest] = (byDepth[r.deepest] || 0) + 1; }
    if (r.why === 'held') stuck++;
});

console.log('\nPANEL ATTACK CHAIN PUZZLES, PLAYED OUT (budget ' + BUDGET + ' swaps)\n');
console.log('  chain puzzles played           : ' + n);
console.log('  FIRED A CHAIN (2+ links)       : ' + fired + ' / ' + n +
            ' (' + (n ? (fired / n * 100).toFixed(0) : 0) + '%)');
console.log('  stopped early by CHOOSING HOLD : ' + stuck);
console.log('\n  deepest chain reached, by count:');
Object.keys(byDepth).sort(function (a, b) { return a - b; }).forEach(function (k) {
    console.log('    ' + k + ' links   ' + byDepth[k]);
});
console.log('\n  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
