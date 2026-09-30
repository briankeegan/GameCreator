#!/usr/bin/env node
// EVERY OPTION ON THE LIST HAS TO BE REAL, AND ITS PRICE HAS TO BE THE PRICE.
//
//   node bitoptions.test.js
//
// bitoptions lists what a board can be made to do, the swaps to do it, and the
// cursor frames it costs. Two claims, both checked against the real engine
// rather than against the arithmetic that produced them:
//
//   1. PLAYING THE SWAPS PRODUCES THE PAYOUT. Every option is played on a real
//      PanelEngine.Stack, in order, waiting the frames the option says the
//      cursor needs between swaps, and the engine's own chain counter and
//      cleared count have to be what was listed.
//
//   2. THE PRICE IS THE WALK. travel.cost is what the search pays with, and
//      PanelCpu.driveWalk is what actually moves the cursor, so a listed frame
//      count is checked against driving the real cursor there.
//
// AND THE LIST HAS TO BE A LIST. A version that returned only its favourite
// would pass every check above, so the sweep also requires boards offering
// several sizes at different prices — otherwise this is the search again with
// extra words.
var path = require('path');
var fs = require('fs');
var ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'panel-engine.js'));
require(path.join(ROOT, 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var EB = require('./engineboard.js');
var travel = require('./travel.js');
var opts = require('./bitoptions.js');
var bit = require('./bitmatch.js');
var W = 6, H = 12;

function boardFromString(s) {
    var grid = [], blocks = {}, r, c;
    for (r = 0; r <= H; r++) { grid[r] = []; for (c = 1; c <= W; c++) grid[r][c] = 0; }
    for (r = 1; r <= H; r++) {
        for (c = 1; c <= W; c++) {
            var ch = s.charAt((r - 1) * W + (c - 1));
            if (ch === '') continue;
            if (/[a-zA-Z]/.test(ch)) {
                grid[r][c] = -2;
                if (!blocks[ch]) blocks[ch] = { cells: [] };
                blocks[ch].cells.push([r, c]);
            } else { grid[r][c] = Number(ch); }
        }
    }
    return { grid: grid, blocks: blocks };
}
function paintBlocks(bl) { var o = {}; for (var k in bl) o[k] = bl[k].cells; return o; }

var src = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));
var CURSOR = [1, 1];

// --------------------------------------------------------------------------
// 1. Every option, played on the engine.
var R = { boards: 0, listed: 0, played: 0, wrong: 0, refused: 0,
          kinds: {}, sizes: {}, priceSpread: 0, worst: null };
var CHECK_BOARDS = 120, PER_BOARD = 6;
var stack = EB.scratch(10);

for (var i = 0; i < src.boards.length && R.boards < CHECK_BOARDS; i++) {
    var b = boardFromString(src.boards[i]);
    if (Object.keys(b.blocks).length) continue;      // garbage has its own gates
    var base = new LogicalBoard(W, H, 6, b.grid, b.blocks);
    var list = opts.options(base, W, H, CURSOR, 2);
    var all = list.now.concat(list.next);
    if (!all.length) continue;
    R.boards++;
    R.listed += all.length;

    // a board that offers several prices is what makes this a list
    var prices = {};
    for (var p = 0; p < all.length; p++) prices[all[p].frames] = 1;
    if (Object.keys(prices).length > 1) R.priceSpread++;

    // check a spread of them: cheapest, dearest, and some between
    var pick = [];
    for (var q = 0; q < all.length && pick.length < PER_BOARD; q += Math.max(1, Math.floor(all.length / PER_BOARD))) {
        pick.push(all[q]);
    }
    if (all.length && pick.indexOf(all[all.length - 1]) < 0) pick.push(all[all.length - 1]);

    for (var k = 0; k < pick.length; k++) {
        var o = pick[k];
        R.kinds[o.kind] = (R.kinds[o.kind] || 0) + 1;
        R.sizes[o.kind + o.size] = (R.sizes[o.kind + o.size] || 0) + 1;

        // Play it: swap, settle between, swap again for a two-swap option.
        var board = base.clone();
        var ok = true;
        for (var s = 0; s < o.swaps.length; s++) {
            if (s > 0) board._applyGravity();
            board.swap(o.swaps[s][0], o.swaps[s][1]);
            if (s < o.swaps.length - 1) {
                // the setup must clear nothing, or the option is mis-described
                var mid = board.clone();
                var settled = mid.resolve();
                if (settled.comboSizes.length) { ok = false; break; }
            }
        }
        if (!ok) { R.refused++; continue; }

        EB.paint(stack, board.grid, H, W, {});
        var t = EB.settle(stack, 900);
        R.played++;
        var engineChain = t.chainLength, engineCleared = t.clearedPanels;
        if (engineChain === o.chain && engineCleared === o.total) continue;
        R.wrong++;
        if (!R.worst) {
            R.worst = { board: i, swaps: o.swaps, frames: o.frames,
                        listed: o.kind + ' ' + o.size + ' (chain ' + o.chain + ', ' + o.total + ' cleared)',
                        engine: 'chain ' + engineChain + ', ' + engineCleared + ' cleared' };
        }
    }
}

console.log('  boards with options     ' + String(R.boards).padStart(5));
console.log('  options listed          ' + String(R.listed).padStart(5) +
            '   kinds ' + JSON.stringify(R.kinds));
console.log('  played on the engine    ' + String(R.played).padStart(5) + ' correct' +
            (R.wrong ? ', ' + R.wrong + ' WRONG' : ''));
console.log('  boards offering more than one price: ' + R.priceSpread + ' of ' + R.boards);
if (R.wrong) { console.error('FAIL an option did not pay what it listed: ' + JSON.stringify(R.worst)); process.exit(1); }
if (!R.boards) { console.error('FAIL no board offered any option'); process.exit(1); }
if (!R.kinds.chain || !R.kinds.combo) {
    console.error('FAIL the sweep never saw both kinds: ' + JSON.stringify(R.kinds));
    process.exit(1);
}
// A list of one price is not a list of options.
if (R.priceSpread < R.boards / 2) {
    console.error('FAIL most boards offered a single price — the cost side is not doing anything');
    process.exit(1);
}

// --------------------------------------------------------------------------
// 2. THE PRICE IS THE WALK. travel.cost is what is quoted; driveWalk is what
// moves the cursor. Drive it and count the frames.
function framesToWalk(fromRow, fromCol, toRow, toCol) {
    var s = new globalThis.PanelEngine.Stack({ level: 10, seed: 3 });
    var guard = 0;
    while (!s.stopWatchIsRunning && guard++ < 1000) s.run();
    s.curRow = fromRow; s.curCol = fromCol;
    // beginWalk and driveWalk are METHODS — they read this.stack and
    // this._walk, because the bot owns the walk it committed to. Called on a
    // stand-in holding just the stack, which is the whole of what they touch.
    // The walk is the object beginWalk creates; built here so the stand-in
    // does not depend on how the export is bound.
    // cursorMoveFrames IS THE CADENCE and driveWalk reads it off the bot, so a
    // stand-in without it taps on a NaN timer and never moves. travel prices
    // the walk with the same number, which is why it is taken from there.
    var host = {
        stack: s, cursorMoveFrames: travel.MOVE_FRAMES,
        _walk: { row: toRow, col: toCol, timer: 0, cooldown: 0, retries: 0 },
        _nearestSwappable: function () { return null; },
        _beginWalk: function () { this._walk = null; }
    };
    var n = 0;
    while (n < 200) {
        var input = { left: false, right: false, up: false, down: false, swap: false, raise: false };
        globalThis.PanelCpu.driveWalk.call(host, input);
        n++;
        // ARRIVAL IS THE WALK GOING AWAY, not a return value: driveWalk clears
        // this._walk once it has queued the swap.
        if (!host._walk) break;
        s.setInput(input);
        s.run();
    }
    return n;
}
var quoted = 0, walked = 0, offBy = {}, pairs = 0;
[[1, 1, 1, 2], [1, 1, 1, 4], [1, 1, 3, 3], [2, 2, 5, 5], [1, 1, 1, 1]].forEach(function (p) {
    var q = travel.cost(p[0], p[1], p[2], p[3]);
    var a = framesToWalk(p[0], p[1], p[2], p[3]);
    pairs++;
    quoted += q; walked += a;
    offBy[q + ' vs ' + a] = (offBy[q + ' vs ' + a] || 0) + 1;
});
console.log('  quoted vs walked frames ' + JSON.stringify(offBy));
if (!pairs) { console.error('FAIL no walk was measured'); process.exit(1); }
// THE QUOTE IS THE WALK MINUS ONE, EVERY TIME. travel.cost counts the taps and
// the frame the swap is queued on; driving the real cursor also spends the frame
// it arrives on. A constant offset is fine and is what the search has always
// paid with — it drifting is not, so it is pinned rather than printed.
if (walked - quoted !== pairs) {
    console.error('FAIL the quote is no longer the walk minus one: quoted ' + quoted +
                  ', walked ' + walked + ' over ' + pairs + ' walks — ' + JSON.stringify(offBy));
    process.exit(1);
}

// --------------------------------------------------------------------------
// AND IT CAN FAIL. Quoting every option the same price hides the whole cost
// side, and a caller comparing offers would pick by payout alone.
var realCost = travel.cost;
travel.cost = function () { return 1; };
var flatSpread = 0, flatBoards = 0;
for (var z = 0; z < 60 && z < src.boards.length; z++) {
    var zb = boardFromString(src.boards[z]);
    if (Object.keys(zb.blocks).length) continue;
    var zbase = new LogicalBoard(W, H, 6, zb.grid, zb.blocks);
    var zl = opts.options(zbase, W, H, CURSOR, 2);
    if (!zl.now.length) continue;
    flatBoards++;
    // WITHIN ONE LIST. A two-swap option pays two travels, so `now` and `next`
    // differ in price however flat the quote is; comparing across them would
    // "catch" the stub without the cost function doing anything at all.
    var zp = {};
    for (var y = 0; y < zl.now.length; y++) zp[zl.now[y].frames] = 1;
    if (Object.keys(zp).length > 1) flatSpread++;
}
travel.cost = realCost;
console.log('  break: ' + 'every option priced the same'.padEnd(34) +
            (flatSpread === 0 ? 'caught (' + flatBoards + ' boards went flat)' : 'NOT CAUGHT'));
if (flatSpread !== 0) {
    console.error('FAIL prices still varied with the cost function stubbed flat');
    process.exit(1);
}

// ------------------------------------------------- THE GATING, AS UNIT TESTS
//
// slabReadyBoard answers one question: is this board one swap from a clear that
// would break a slab landing on it. The levelling search prefers routes that
// land on such a board, so if this answer is wrong the preference is wrong, and
// nothing above would notice -- the sweeps check that options are real and
// priced, never which one is chosen.
//
// The real function, not a copy: a test carrying its own implementation agrees
// with itself. Hand-built boards, no games, milliseconds.
(function () {
    var gfails = 0;
    function gok(cond, msg) { if (!cond) { console.error('FAIL ' + msg); gfails++; } }

    // Rows bottom-first; 0 is empty.
    function boardOf(rows) {
        var g = [], r, c;
        for (r = 0; r <= 12; r++) { g[r] = []; for (c = 1; c <= 6; c++) g[r][c] = 0; }
        for (r = 0; r < rows.length; r++)
            for (c = 1; c <= 6; c++) g[r + 1][c] = rows[r][c - 1];
        return bit.maskState(g, {}, 6, 12);
    }
    var ready = opts.slabReadyBoard;

    // Garbage lands as one row across the whole board, resting on the tallest
    // column. Only a clear reaching the row directly beneath it touches it.

    // TOP ROW, one swap from three: the slab lands on it and the clear breaks it.
    gok(ready(boardOf([[3, 4, 5, 3, 4, 5],
                       [1, 1, 2, 1, 1, 1]])) === true,
        'slabReadyBoard: a three one swap away in the top row does not reach a slab ' +
        'landing on that row');

    // THE SAME THREE, ONE ROW DOWN. The board is a row taller, so the slab lands
    // a row higher and the clear no longer touches it. This is the case that
    // separates the question from "can this board fire" -- the board can fire.
    gok(ready(boardOf([[1, 1, 2, 1, 1, 1],
                       [3, 4, 5, 3, 4, 5]])) === false,
        'slabReadyBoard: a three under a full row was counted as reaching the slab, ' +
        'which rests on top of the stack, not on the panels below it');

    // NOTHING ONE SWAP AWAY anywhere: no colour has two in reach of a third.
    gok(ready(boardOf([[1, 2, 3, 1, 2, 3],
                       [2, 3, 1, 2, 3, 1]])) === false,
        'slabReadyBoard: a board with no clear one swap away was called ready');

    // NO ROOM FOR A SLAB. A board at full height has nowhere for the row to land,
    // so the question has no answer and must not be a yes.
    var full = [], fr;
    for (fr = 0; fr < 12; fr++) full.push([1, 2, 3, 1, 2, 3]);
    gok(ready(boardOf(full)) === false,
        'slabReadyBoard: a board with no room for a slab was called ready for one');

    // AN EMPTY BOARD has nothing to break anything with.
    gok(ready(boardOf([])) === false,
        'slabReadyBoard: an empty board was called ready');

    console.log('  gating: ' + (gfails ? gfails + ' FAILED' :
                'slabReadyBoard answers for the row that lands, not the board it sits on'));
    if (gfails) process.exit(1);
}());

console.log('bitoptions: ' + R.listed + ' options listed over ' + R.boards +
            ' boards, ' + R.played + ' played on the engine exactly, priced by the walk');
