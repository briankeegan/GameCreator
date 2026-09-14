#!/usr/bin/env node
// THE CROSS-LANGUAGE FEATURE FIXTURE — what the Lua port has to match.
//
//   node export_reference.js [outfile]
//   default outfile: ../../../../panel-game/bot/fixtures/paneleval_reference.json
//
// The evaluator is being ported to Lua so Panel Attack's own bots can use it
// (panel-game bot/PanelEval.lua). A port is a SECOND IMPLEMENTATION of rules
// that already exist, which is the exact shape this repo keeps getting wrong:
// both copies look fine, neither is obviously stale, and the drift is only
// visible in play. So the port is not reviewed, it is CHECKED — against this
// file, by bot/tests/panelEvalVerify.lua, on every push.
//
// WHAT IS IN IT. Real boards from realboards.json (captured from the shipped
// bot playing the real engine at level 10 — never hand-built, per CLAUDE.md),
// each recorded with:
//   grid      the position, flattened, in LogicalBoard's encoding
//             (0 empty, -1 busy, -2 garbage, >0 colour)
//   earned    what a move paid: chainLength, comboSizes, garbageSent,
//             garbageCleared, stopTimeEarned, brokeGarbage
//   features  every implemented feature's raw magnitude on that input
//
// EARNED IS DATA, NOT SOMETHING THE LUA SIDE RECOMPUTES. The two languages
// have different resolve() implementations (LogicalBoard here, BoardSim
// there), each already verified against its own engine. Comparing features
// means feeding both the SAME numbers, so a disagreement is a feature bug
// rather than a resolve bug wearing its clothes. The four lookahead features
// (matchPotential / chainPotential / comboPotential / staircaseReady) are the
// exception — they ask the board what a swap would do, so they do exercise
// both resolves, and a disagreement there is worth having.
//
// THE GARBAGE IN IT IS REAL, NOT STAMPED. 1,281 of realboards.json's 4,716
// boards carry garbage, written as a letter per BLOCK (capture_boards.js:
// 'a', 'b', ... per garbageId) precisely so block membership survives — which
// matters, because clearing propagates block to block and a cell with no block
// is not the same cell. A first version of this script read those letters as
// NaN and laid synthetic slabs on top instead; the fixture came out with 102
// rows of JSON nulls in it and the Lua side fell over on the first one. Decode
// the letters.
'use strict';
var path = require('path');
var fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var registry = require('./registry.js');
var inputMod = require('./input.js');

var OUT = process.argv[2] ||
    path.join(__dirname, '..', '..', '..', '..', '..', 'panel-game', 'bot', 'fixtures', 'paneleval_reference.json');

var src = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));
var W = src.width, H = src.height;

// Every Nth board, so the fixture is a few hundred rows rather than 4,716 —
// the Lua test runs in CI and each row costs a full lookahead pass. Fixed
// stride, so regenerating gives the same file and a failure reproduces.
var STRIDE = Number(process.env.GC_STRIDE || 12);

// -> { grid, blocks }. Digits are colours; a letter is a garbage cell and the
// letter itself names its block.
function boardFromString(s) {
    var grid = [], blocks = {}, r, c;
    for (r = 0; r <= H; r++) { grid[r] = []; for (c = 1; c <= W; c++) grid[r][c] = 0; }
    // capture_boards.js writes row 1 (the floor) first, W chars per row.
    for (r = 1; r <= H; r++) {
        for (c = 1; c <= W; c++) {
            var ch = s[(r - 1) * W + (c - 1)];
            if (ch >= 'a' && ch <= 'z') {
                grid[r][c] = -2;
                if (!blocks[ch]) blocks[ch] = { cells: [] };
                blocks[ch].cells.push([r, c]);
            } else {
                grid[r][c] = Number(ch);
            }
        }
    }
    return { grid: grid, blocks: blocks };
}

function garbageCellsOf(b) {
    var n = 0;
    for (var r = 1; r <= H; r++) for (var c = 1; c <= W; c++) if (b.grid[r][c] === -2) n++;
    return n;
}

function flatten(grid) {
    var out = [];
    for (var r = 1; r <= H; r++) for (var c = 1; c <= W; c++) out.push(grid[r][c]);
    return out;
}

var rows = [], i, n = 0;
for (i = 0; i < src.boards.length; i += STRIDE) {
    var built = boardFromString(src.boards[i]);
    n++;
    var board = new LogicalBoard(W, H, 6, built.grid, built.blocks);

    // Play the board's BEST-PAYING legal swap and record what it paid, so
    // the earned features carry real numbers rather than zeroes. The grid
    // stored is the board the swap LEAVES, which is what the evaluator
    // scores. Taking the first legal swap instead left 12 of 393 rows with
    // any chain on them and 2 with any garbage sent — garbageSent,
    // chainLength, scoreEarned and stopTimeEarned would each have been
    // checked against zero nearly everywhere, which is the gate-that-cannot-
    // fail shape. Deterministic: ties break on swap order.
    var legal = board.legalSwaps();
    var after = null, res = null, bestPaid = -1;
    for (var s2 = 0; s2 < legal.length; s2++) {
        var trial = board.clone();
        trial.swap(legal[s2][0], legal[s2][1]);
        var tres = trial.resolve();
        var sizes = tres.comboSizes || [], paid = 0;
        for (var z = 0; z < sizes.length; z++) paid += sizes[z];
        paid += (tres.chainLength || 0) * 100 + (tres.garbageCleared || 0) * 10;
        if (paid > bestPaid) { bestPaid = paid; after = trial; res = tres; }
    }
    if (!after) { after = board.clone(); res = after.resolve(); }

    var raw = {
        board: after,
        liveBoard: after,
        travelFrames: (n % 5) * 4,          // exercises travelCost over its range
        displacement: n % 16,                // exercises maxHeight's sub-row term
        earned: {
            chainLength: res.chainLength,
            comboSizes: res.comboSizes || [],
            garbageSent: res.garbage || [],
            // A LIVE-SEAM QUANTITY, NOT SOMETHING resolve() REPORTS: the
            // drop in garbage cells between the board before the swap and
            // the board after it (input.js's fromStack takes it as its own
            // argument for the same reason). Computed rather than left at
            // zero — a weighted feature whose fixture column never moves is
            // a column that cannot disagree.
            garbageCleared: garbageCellsOf(board) - garbageCellsOf(after),
            stopTimeEarned: res.stopTimeEarned || 0,
            brokeGarbage: res.brokeGarbage || 0
        }
    };
    var input = inputMod.normalize(raw);

    var features = {};
    for (var k = 0; k < registry.all.length; k++) {
        var f = registry.all[k];
        if (typeof f.fn !== 'function') continue;
        var v = f.fn(input);
        features[f.key] = (v === Infinity) ? 'Infinity' : v;
    }

    rows.push({
        grid: flatten(after.grid),
        blocks: Object.keys(after.blocks).length,
        travelFrames: raw.travelFrames,
        displacement: raw.displacement,
        earned: raw.earned,
        features: features
    });
}

// A FIXTURE WITH A HOLE IN IT IS WORSE THAN NO FIXTURE: an undefined cell
// serialises as JSON null, and `!== 0` reads it as occupied while `> 0` reads
// it as empty, so half the features would be compared against nonsense and
// half would agree. That is how the first run of this script produced 102 bad
// rows and looked like a Lua bug. Refuse instead.
for (var q = 0; q < rows.length; q++) {
    for (var z = 0; z < rows[q].grid.length; z++) {
        if (typeof rows[q].grid[z] !== 'number' || !isFinite(rows[q].grid[z])) {
            throw new Error('board ' + q + ' cell ' + z + ' is ' + rows[q].grid[z] +
                            ' — the source string held a character gridFromString cannot read');
        }
    }
}

var payload = {
    _comment: 'GENERATED by ai/eval/export_reference.js in the GameCreator repo. ' +
              'Do not edit by hand — regenerate it. Consumed by bot/tests/panelEvalVerify.lua.',
    source: 'realboards.json (' + src.boards.length + ' boards, seeds ' + src.seeds + '), stride ' + STRIDE,
    width: W, height: H,
    features: registry.implemented(),
    boards: rows
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload));
console.log('wrote ' + OUT + ': ' + rows.length + ' boards, ' + payload.features.length + ' features');
var withGarbage = rows.filter(function (r) { return r.blocks > 0; }).length;
var withChain = rows.filter(function (r) { return r.earned.chainLength > 0; }).length;
var withSent = rows.filter(function (r) { return r.earned.garbageSent.length > 0; }).length;
console.log('  carrying garbage: ' + withGarbage + '  chained: ' + withChain + '  sent garbage: ' + withSent);
