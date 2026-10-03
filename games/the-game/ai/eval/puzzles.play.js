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
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
var snapshot = globalThis.PanelCpu.snapshot;
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

// The puzzle's stack on the server's rules (PAEngine.puzzle), or null for one
// with [====] garbage blocks.
function boardFrom(stack) { return /[^0-9\s]/.test(String(stack)) ? null : PA.puzzle(stack); }

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

// THE ENGINE IS THE BOARD. The bot only ever reads it: each turn the bot is
// handed the server's board as it reads any board (PanelCpu.snapshot), the
// swap is made ON the engine, the engine settles, and the chain depth is the
// engine's. Nothing is simulated twice, so nothing can disagree.
// A COLOURLESS panel (9) never matches (checkMatches.lua canMatch), so the
// bot reads it as a cell that cannot match, as it reads garbage.
function play(stack) {
    function view() {
        var b = snapshot.call({ stack: stack });
        for (var r = 1; r < b.grid.length; r++) for (var c = 1; c <= W; c++) if (b.grid[r][c] === 9) b.grid[r][c] = -2;
        return b;
    }
    var cur = view();
    var cpu = new PuyoCpu(stubStack(function () { return cur; }), {
        weights: loaded.weights,
        depth: loaded.switches.depth,
        beam: loaded.switches.beam,
        rise: loaded.switches.rise,
        density: loaded.switches.density
    });
    cpu._snapshot = function () { return cur.clone(); };

    var deepest = 0, swaps = 0, why = 'budget', refused = 0;
    for (var i = 0; i < BUDGET; i++) {
        var d = cpu._decide();
        if (!d || d.kind !== 'swap') { why = 'held'; break; }
        // The engine decides what is legal. The board the bot read came from
        // this same stack one line ago, so a refusal is a real disagreement.
        if (!stack.canSwap(d.move[0], d.move[1])) { refused++; why = 'engine refused the swap'; break; }
        stack.curRow = d.move[0];
        stack.curCol = d.move[1];
        stack.tryQueueSwap(d.move[0], d.move[1]);
        var res = stack.settle(900);
        swaps++;
        cpu.stack.curRow = d.move[0];
        cpu.stack.curCol = d.move[1];
        if (res.chain > deepest) deepest = res.chain;
        cur = view();
        if (!stack.legalSwaps().length) { why = 'no legal swap'; break; }
    }
    return { deepest: deepest, swaps: swaps, why: why, refused: refused };
}

var chains = puzzles().filter(function (x) { return x.p['Puzzle Type'] === 'chain'; });
var n = 0, fired = 0, byDepth = {}, stuck = 0, refused = 0, t0 = Date.now(), rows = [];
chains.forEach(function (x) {
    var board = boardFrom(x.p.Stack);
    if (!board) return;
    n++;
    var r = play(board);
    if (r.deepest >= 2) { fired++; byDepth[r.deepest] = (byDepth[r.deepest] || 0) + 1; }
    if (r.why === 'held') stuck++;
    refused += r.refused;
    rows.push({ set: x.set, deepest: r.deepest, swaps: r.swaps, why: r.why });
});

console.log('\nPANEL ATTACK CHAIN PUZZLES, PLAYED OUT (budget ' + BUDGET + ' swaps)\n');
console.log('  chain puzzles played           : ' + n);
console.log('  FIRED A CHAIN (2+ links)       : ' + fired + ' / ' + n +
            ' (' + (n ? (fired / n * 100).toFixed(0) : 0) + '%)');
console.log('  stopped early by CHOOSING HOLD : ' + stuck);
// The bot reads the engine's own board, so anything here is a real legality
// disagreement and worth chasing, not noise.
console.log('  swaps the ENGINE REFUSED         : ' + refused);
console.log('\n  deepest chain reached, by count:');
Object.keys(byDepth).sort(function (a, b) { return a - b; }).forEach(function (k) {
    console.log('    ' + k + ' links   ' + byDepth[k]);
});
console.log('\n  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

// A MACHINE-READABLE RESULT, BECAUSE SOMETHING ELSE CONSUMES THIS.
//
// train.js reports chains fired beside score at the end of a run, and the
// first version of that got the number by regexing the "FIRED A CHAIN" line
// off this script's stdout. That is the failure this repo has already paid
// for twice (CLAUDE.md, "NEVER PARSE A TOOL'S PROSE"): a padding change or a
// short read through a pipe turns into a wrong number that looks like a
// result. Printed output is for people.
//
// `attempted` is here so the consumer can ASSERT it got a full run rather
// than a truncated one: 84 chain puzzles ship, and a file reporting fewer
// played than were found is a failure, not a lower score.
if (process.env.GC_PLAY_JSON) {
    fs.writeFileSync(process.env.GC_PLAY_JSON, JSON.stringify({
        attempted: chains.length,
        played: n,
        fired: fired,
        stuckHolding: stuck,
        engineRefused: refused,
        byDepth: byDepth,
        budget: BUDGET,
        weights: loaded.source,
        switches: loaded.switches,
        seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
        puzzles: rows
    }, null, 2) + '\n');
}
