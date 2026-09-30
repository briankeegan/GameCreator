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

    // THE SAME FIVE CASES AGAINST THE ARITHMETIC VERSION. slabReadyFast asks the
    // question with bit operations over three rows instead of sweeping every legal
    // swap and resolving each -- so it has to answer the same way on the cases that
    // pin the meaning, or it is a different question wearing the same name.
    var fast = opts.slabReadyFast;
    gok(fast(boardOf([[3, 4, 5, 3, 4, 5], [1, 1, 2, 1, 1, 1]])) === true,
        'slabReadyFast: missed a three one swap away in the top row');
    gok(fast(boardOf([[1, 1, 2, 1, 1, 1], [3, 4, 5, 3, 4, 5]])) === false,
        'slabReadyFast: counted a three that the slab lands above');
    gok(fast(boardOf([[1, 2, 3, 1, 2, 3], [2, 3, 1, 2, 3, 1]])) === false,
        'slabReadyFast: called a board with no clear one swap away ready');
    var full2 = [], f2;
    for (f2 = 0; f2 < 12; f2++) full2.push([1, 2, 3, 1, 2, 3]);
    gok(fast(boardOf(full2)) === false,
        'slabReadyFast: called a board with no room for a slab ready for one');
    gok(fast(boardOf([])) === false, 'slabReadyFast: called an empty board ready');

    // AND IT MAY NEVER SAY YES WHERE THE SWEEP SAYS NO.
    //
    // It looks at three rows and only at swaps between two occupied cells, so it
    // misses a cascade, a panel dropped into an empty cell, and any match outside
    // those rows. Every one of those is a missed yes, which costs an opportunity.
    // A yes the sweep does not agree with would be the opposite: the search
    // preferring a route to a board that cannot answer what lands on it.
    var over = 0, checked = 0;
    for (var bi = 0; bi < src.boards.length && checked < 120; bi++) {
        var rb = boardFromString(src.boards[bi]);
        var stb = bit.maskState(rb.grid, rb.blocks, W, H);
        if (!stb) continue;
        checked++;
        if (fast(stb) && !ready(stb)) over++;
    }
    gok(checked > 20, 'slabReadyFast: too few real boards to compare against (' + checked + ')');
    gok(over === 0,
        'slabReadyFast said a board was ready for the slab on ' + over + ' of ' +
        checked + ' real boards where the sweep says it is not -- it may be cheaper ' +
        'than the sweep, never less careful');

    console.log('  gating: ' + (gfails ? gfails + ' FAILED' :
                'slabReadyBoard answers for the row that lands, and the bit version agrees'));
    if (gfails) process.exit(1);
}());

// --------------------------------------------------------------------------
// SPREAD: THE NUMBER A SLAB IS MEASURED IN.
//
// Garbage rests on the TALLEST column and spans the whole width, so every
// shorter column ends up with the difference in dead rows under the slab,
// holding whatever material was beneath it. `spread` is that difference --
// fullest material column minus emptiest -- and it is a different number from
// `bumps`, which is what the board was judged by before.
//
// Arithmetic only, on boards built by hand: no engine, no search.
(function () {
    var sfails = 0;
    function sok(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); sfails++; } }

    // Columns given bottom-up as colours; 'G' is a garbage cell.
    function shapeOfColumns(cols) {
        var grid = [], blocks = { g: { cells: [] } }, r, c;
        for (r = 0; r <= H; r++) { grid[r] = []; for (c = 1; c <= W; c++) grid[r][c] = 0; }
        for (c = 1; c <= W; c++) {
            for (r = 1; r <= cols[c - 1].length; r++) {
                var v = cols[c - 1][r - 1];
                if (v === 'G') { grid[r][c] = -2; blocks.g.cells.push([r, c]); }
                else grid[r][c] = v;
            }
        }
        if (!blocks.g.cells.length) blocks = {};
        return opts.shapeOf(bit.maskState(grid, blocks, W, H));
    }
    // Heights alone, coloured so nothing matches: enough for a shape.
    function shapeOfHeights(h) {
        var cols = [], c, r;
        for (c = 1; c <= W; c++) {
            cols[c - 1] = [];
            for (r = 1; r <= h[c - 1]; r++) cols[c - 1].push(1 + ((r + c) % 3));
        }
        return shapeOfColumns(cols);
    }

    // A LEVEL BOARD HAS NO SPREAD. Nothing is sealed when a slab lands flat.
    var level = shapeOfHeights([3, 3, 3, 3, 3, 3]);
    sok(level.spread === 0,
        'a level board read spread ' + level.spread + ', so a slab landing on it ' +
        'would be scored as sealing rows that do not exist');
    sok(level.high === 3 && level.low === 3,
        'a level board read high ' + level.high + ' low ' + level.low);

    // THE BOARD THAT DIED: 4,2,2,2,3,6. Four rows go under the slab in columns
    // 2 to 4 the moment a load lands, and only column 6 can touch it.
    var died = shapeOfHeights([4, 2, 2, 2, 3, 6]);
    sok(died.spread === 4,
        'the board the bot died on read spread ' + died.spread + ' instead of 4 -- ' +
        'six minus two is what goes under the slab');
    sok(died.high === 6 && died.low === 2,
        'spread is high minus low and they disagree: high ' + died.high +
        ' low ' + died.low + ' spread ' + died.spread);

    // AND BUMPINESS CANNOT SEE IT. These two are the whole reason for the number:
    // a smooth ramp seals four rows and reads calm by neighbour steps, while a
    // sawtooth seals one and reads alarming. Judged by bumps the bot fixes the
    // wrong board.
    var ramp = shapeOfHeights([1, 2, 3, 4, 5, 5]);       // bumps 4, spread 4
    var saw  = shapeOfHeights([1, 3, 1, 3, 1, 3]);       // bumps 10, spread 2
    sok(ramp.spread === 4 && saw.spread === 2,
        'ramp spread ' + ramp.spread + ' saw spread ' + saw.spread +
        ' -- expected 4 and 2');
    sok(saw.bumps > ramp.bumps,
        'the sawtooth did not read bumpier than the ramp (' + saw.bumps + ' vs ' +
        ramp.bumps + '), so this pair no longer separates the two measures');
    sok(ramp.spread > saw.spread,
        'the ramp seals four rows under a slab and the sawtooth two, but spread ' +
        'ranked them ' + ramp.spread + ' and ' + saw.spread + ' -- bumpiness is ' +
        'what ranks them the other way round, and it is the one that is wrong');

    // MATERIAL ABOVE A SLAB IS NOT A TOWER. It is in another pocket: nothing the
    // bot plays can spread it sideways into the columns beside it, and the slab
    // it would be measured against is already below it. shapeOf counts only the
    // panels under the lowest garbage cell, so a column carrying five panels on
    // top of garbage must read as the empty column it is.
    var stranded = shapeOfColumns([
        [1, 2, 'G', 3, 1, 2, 3],   // one panel in the pocket, five stranded above
        [1, 2, 'G'],
        [1, 2, 'G'],
        [1, 2, 'G'],
        [1, 2, 'G'],
        [1, 2, 'G']
    ]);
    sok(stranded.spread === 0,
        'panels stranded above a slab were counted as a tower (spread ' +
        stranded.spread + ') -- they are in another pocket and cannot be spread');
    sok(stranded.high === 2,
        'the pocket holds two rows in every column but high read ' + stranded.high);

    console.log('  spread: ' + (sfails ? sfails + ' FAILED' :
                'measured as the rows a slab seals, and it is not bumpiness'));
    if (sfails) process.exit(1);
}());

// --------------------------------------------------------------------------
// `ready` ON EVERY OPTION: CAN THE BOARD THIS LANDS ON STILL FIRE.
//
// Firing anything holds the floor for its resolve, and at maxHealth 1 that hold
// is the difference between living and not. bestAttack and bestPlan narrow on
// this field, so it has to be BOTH values on the boards that deserve them --
// a field that is always true narrows nothing and every check on those paths
// passes anyway.
(function () {
    var rfails = 0;
    function rok(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); rfails++; } }
    function listOf(cols) {
        var grid = [], r, c;
        for (r = 0; r <= H; r++) { grid[r] = []; for (c = 1; c <= W; c++) grid[r][c] = 0; }
        for (c = 1; c <= W; c++)
            for (r = 1; r <= cols[c - 1].length; r++) grid[r][c] = cols[c - 1][r - 1];
        var base = new LogicalBoard(W, H, 6, grid, {});
        var l = opts.options(base, W, H, [1, 1], 2);
        return l.now.concat(l.next);
    }

    // A BOARD THAT SPENDS ITSELF EMPTY. One row, `1 1 2 1 1`: the swap in the
    // middle puts three 1s together and what is left behind is a 2 and a 1 with
    // nothing any swap can do to them.
    var spent = listOf([[1], [1], [2], [1], [1], []]);
    var cleared = spent.filter(function (o) { return o.total > 0; });
    rok(cleared.length > 0, '`ready`: the spend-itself-empty board offered no clear at all');
    rok(cleared.every(function (o) { return o.ready === false; }),
        '`ready`: a clear that leaves two panels and no swap between them came back ' +
        'ready -- the field is not being computed, and both paths that narrow on it ' +
        'are narrowing on nothing');

    // THE SAME CLEAR WITH THE BOARD STILL HOLDING ONE. Another pair of 3s under
    // it, so after the clear a swap still puts three together.
    var keeps = listOf([[1, 3, 3], [1, 4, 5], [2, 5, 4], [1, 3, 4], [1, 5, 3], [4, 3, 5]]);
    var kc = keeps.filter(function (o) { return o.total > 0; });
    rok(kc.length > 0, '`ready`: the board that keeps a clear offered none');
    rok(kc.some(function (o) { return o.ready === true; }),
        '`ready`: no option on a board that still holds a clear after firing came ' +
        'back ready, so the field is stuck false and the narrowing throws the list away');

    // AND IT IS SET ON EVERY OPTION OF A REAL BOARD, both values occurring.
    var seen = { true: 0, false: 0, other: 0 }, n = 0;
    for (var bi = 0; bi < src.boards.length && n < 60; bi++) {
        var rb = boardFromString(src.boards[bi]);
        if (Object.keys(rb.blocks).length) continue;
        var lb = new LogicalBoard(W, H, 6, rb.grid, rb.blocks);
        var ll = opts.options(lb, W, H, CURSOR, 2), aa = ll.now.concat(ll.next);
        if (!aa.length) continue;
        n++;
        aa.forEach(function (o) {
            if (o.ready === true) seen['true']++;
            else if (o.ready === false) seen['false']++;
            else seen.other++;
        });
    }
    rok(seen.other === 0,
        '`ready`: ' + seen.other + ' options on real boards came back neither true nor ' +
        'false, so the paths that narrow on it read undefined and keep everything');
    rok(seen['false'] > 0,
        '`ready`: over ' + n + ' real boards not one option landed on a board that ' +
        'cannot fire, so a field stuck true would pass every check there is');

    // A BREAK CARRIES null, NOT false. Its settled board is unknowable -- the
    // engine decides what the slab turns into -- so `ready` is null the way `low`
    // and `mat` already are, and the paths that narrow on it must see a null
    // rather than a no. A break is the only thing that takes garbage off the
    // board, so narrowing one out is the expensive mistake here.
    var gg = [], rr2, cc2;
    for (rr2 = 0; rr2 <= H; rr2++) { gg[rr2] = []; for (cc2 = 1; cc2 <= W; cc2++) gg[rr2][cc2] = 0; }
    var rows6 = [[2, 3, 4, 5, 3, 2], [3, 4, 5, 2, 4, 3], [4, 5, 2, 3, 5, 4],
                 [5, 2, 3, 4, 2, 5], [2, 3, 4, 5, 3, 2], [1, 1, 2, 1, 4, 5]];
    rows6.forEach(function (row, ri) { for (cc2 = 1; cc2 <= W; cc2++) gg[ri + 1][cc2] = row[cc2 - 1]; });
    var gcells = [];
    for (cc2 = 1; cc2 <= W; cc2++) { gg[7][cc2] = -2; gcells.push([7, cc2]); }
    var gb = new LogicalBoard(W, H, 6, gg, { s: { cells: gcells } });
    var gl = opts.options(gb, W, H, [1, 1], 2), ga = gl.now.concat(gl.next);
    var breaks = ga.filter(function (o) { return o.breaks; });
    rok(breaks.length > 0,
        '`ready`: the board with a three one swap under a slab offered no break, so ' +
        'this cannot check what a break carries');
    rok(breaks.every(function (o) { return o.ready === null; }),
        '`ready`: a break came back ' + (breaks[0] && breaks[0].ready) + ' rather than ' +
        'null -- its settled board is unknowable, and a false there narrows the one ' +
        'move that takes garbage off the board straight out of both paths');

    console.log('  ready: ' + (rfails ? rfails + ' FAILED' :
                'every option says whether the board it lands on can still fire'));
    if (rfails) process.exit(1);
}());

// --------------------------------------------------------------------------
// `breakReady` ON EVERY OPTION: CAN THE BOARD THIS LANDS ON BREAK ITS GARBAGE.
//
// A garbage cell comes off the board one way -- three panels in a line against
// it -- and a cell that never comes off is a row of ceiling gone for good. Both
// paths that pick moves narrow on this field, so it has to be BOTH values on
// the boards that deserve them, and null where the question does not apply.
(function () {
    var bfails = 0;
    function bok(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); bfails++; } }
    // Columns bottom-up; 'G' is a garbage cell.
    function listOf(cols) {
        var grid = [], cells = [], r, c;
        for (r = 0; r <= H; r++) { grid[r] = []; for (c = 1; c <= W; c++) grid[r][c] = 0; }
        for (c = 1; c <= W; c++)
            for (r = 1; r <= cols[c - 1].length; r++) {
                var v = cols[c - 1][r - 1];
                if (v === 'G') { grid[r][c] = -2; cells.push([r, c]); }
                else grid[r][c] = v;
            }
        var blocks = cells.length ? { s: { cells: cells } } : {};
        var base = new LogicalBoard(W, H, 6, grid, blocks);
        var l = opts.options(base, W, H, [1, 1], 2);
        return l.now.concat(l.next);
    }
    // THE SAME BOARD WITH THE DIGGING GOAL SET, which is what the bot passes
    // whenever there is garbage on the board. `dig` is only counted under it, so
    // a list built without it reads digGain zero everywhere and says nothing.
    function diggingListOf(cols) {
        var grid = [], cells = [], r, c;
        for (r = 0; r <= H; r++) { grid[r] = []; for (c = 1; c <= W; c++) grid[r][c] = 0; }
        for (c = 1; c <= W; c++)
            for (r = 1; r <= cols[c - 1].length; r++) {
                var v = cols[c - 1][r - 1];
                if (v === 'G') { grid[r][c] = -2; cells.push([r, c]); }
                else grid[r][c] = v;
            }
        var blocks = cells.length ? { s: { cells: cells } } : {};
        var base = new LogicalBoard(W, H, 6, grid, blocks);
        var l = opts.options(base, W, H, [1, 1], 2, null, null, true);
        return l.now.concat(l.next);
    }

    // NO GARBAGE ON THE LANDED BOARD: the question does not apply, so null. A
    // false here would narrow every option out of both paths on a clean board.
    var clean = listOf([[1, 3, 3], [1, 4, 5], [2, 5, 4], [1, 3, 4], [1, 5, 3], [4, 3, 5]]);
    var cc = clean.filter(function (o) { return o.total > 0; });
    bok(cc.length > 0, '`breakReady`: the clean board offered no clear at all');
    bok(cc.every(function (o) { return o.breakReady === null; }),
        '`breakReady`: a clear on a board with no garbage came back ' +
        (cc[0] && cc[0].breakReady) + ' rather than null -- there is nothing to break, ' +
        'and a false there narrows the whole list away every opening');

    // GARBAGE ON THE BOARD: both answers have to occur. Five rows of material
    // under a full-width slab, so there is enough left after a clear for some
    // routes to keep a break alive and enough spent on others that they do not.
    var spend = listOf([[1, 1, 1, 2, 5, 'G'], [1, 5, 1, 2, 2, 'G'], [4, 3, 3, 5, 3, 'G'],
                        [1, 3, 5, 2, 2, 'G'], [4, 1, 5, 3, 5, 'G'], [3, 1, 4, 5, 4, 'G']]);
    var sc = spend.filter(function (o) { return o.total > 0 && o.breakReady !== null; });
    bok(sc.length > 0,
        '`breakReady`: no option on the buried board carried a true/false, so the ' +
        'field is null wherever there IS garbage and narrows nothing');
    bok(sc.some(function (o) { return o.breakReady === false; }),
        '`breakReady`: not one option on a buried board left it unable to break, so ' +
        'a field stuck true would pass every check there is');
    bok(sc.some(function (o) { return o.breakReady === true; }),
        '`breakReady`: not one option on a buried board left it able to break, so a ' +
        'field stuck false would pass and the narrowing throws the list away');

    // AND IT IS A BREAK IT IS ASKING ABOUT, NOT A CLEAR. This is the whole rule:
    // all six boards that died had clears and were firing them, and none could
    // put three panels against the slab. A board six deep under a full slab that
    // offers plenty of both, so the two answers have to come apart.
    var apart = listOf([[3, 5, 4, 3, 5, 2, 'G'], [3, 5, 3, 2, 4, 5, 'G'], [5, 1, 2, 2, 1, 1, 'G'],
                        [4, 5, 2, 3, 2, 1, 'G'], [4, 4, 5, 5, 2, 4, 'G'], [1, 5, 2, 2, 4, 1, 'G']]);
    var canFire = apart.filter(function (o) { return o.ready === true; });
    bok(canFire.length > 0,
        '`breakReady`: no option on the six-deep board landed on a board that can ' +
        'fire, so the two questions cannot be told apart here');
    bok(canFire.some(function (o) { return o.breakReady === false; }),
        '`breakReady`: every option that lands on a board able to FIRE also reads ' +
        'able to BREAK, so this is asking "is there a clear" -- the question all ' +
        'six death boards answered yes to on their way to dying');

    // AND A BREAK CARRIES null, NOT false. Its settled board is unknowable, and a
    // break is the one move that takes garbage off -- narrowing it out of a rule
    // about breaking is the expensive mistake.
    var bl = listOf([[2, 3, 4, 5, 2, 1, 'G'], [3, 4, 5, 2, 3, 1, 'G'],
                     [4, 5, 2, 3, 4, 2, 'G'], [5, 2, 3, 4, 5, 1, 'G'],
                     [3, 4, 5, 2, 3, 4, 'G'], [2, 3, 4, 5, 2, 5, 'G']]);
    var brs = bl.filter(function (o) { return o.breaks; });
    bok(brs.length > 0,
        '`breakReady`: the board with a three one swap under a slab offered no ' +
        'break, so this cannot check what a break carries');
    bok(brs.every(function (o) { return o.breakReady === null; }),
        '`breakReady`: a break came back ' + (brs[0] && brs[0].breakReady) +
        ' rather than null -- a false there narrows the one move that takes ' +
        'garbage off the board straight out of both paths');

    // AND `closesBreak` IS THE TRANSITION, NOT THE STATE. The move that takes the
    // LAST way to break, the way opensHole is the move that empties a column.
    // `breakReady === false` on its own is just as true of a board that already
    // could not break, so a rule built on it punishes a position instead of the
    // move that made it -- and on a board with no break left it flags every
    // option at once, which is how the absolute form cost three deaths among
    // STARTER and ZERO in thirteen pairings.
    //
    // On a board that CAN break, some option has to close it and the flag has to
    // track breakReady exactly.
    var shut = apart.filter(function (x) { return x.closesBreak; });
    bok(shut.length > 0,
        '`closesBreak`: not one option on a breakable board takes the last break, ' +
        'so this checks nothing');
    bok(apart.every(function (x) { return x.closesBreak === (x.breakReady === false); }),
        '`closesBreak`: disagrees with `breakReady` on a board that can break -- on ' +
        'such a board the two are the same question and the transition is the state');

    // ON A BOARD THAT ALREADY CANNOT BREAK, NOTHING CLOSES ANYTHING. This is the
    // case the absolute form got wrong and the one that matters: every option
    // there carries breakReady false, so a rule built on the state flags all of
    // them at once and both paths lose their whole list. Three deaths among
    // STARTER and ZERO in thirteen pairings, against none in sixty.
    //
    // Three rows under a full slab with no one-swap break anywhere on it.
    var sealed = listOf([[4, 5, 1, 'G'], [4, 3, 3, 'G'], [2, 5, 1, 'G'],
                         [5, 1, 3, 'G'], [1, 3, 2, 'G'], [1, 3, 3, 'G']]);
    bok(sealed.length > 0, '`closesBreak`: the sealed board offered no options at all');
    bok(sealed.some(function (x) { return x.breakReady === false; }),
        '`closesBreak`: no option on the sealed board lands unable to break, so the ' +
        'state and the transition cannot be told apart here and this checks nothing');
    bok(sealed.every(function (x) { return x.closesBreak === false; }),
        '`closesBreak`: flagged an option on a board that ALREADY cannot break. ' +
        'Nothing can close a door that is shut, and flagging them takes the whole ' +
        'option list away from both paths -- which is the measured regression');

    // AND A CLEAN BOARD CLOSES NOTHING EITHER: with no garbage there is no break
    // to lose, so the flag must be off on every option.
    bok(clean.every(function (x) { return x.closesBreak === false; }),
        '`closesBreak`: flagged an option on a board with no garbage on it, where ' +
        'there is no break to take away');

    // `digGain` IS A DELTA AND IT HAS A SIGN. `dig` counts the cells that would
    // finish a line against the garbage -- the board's way out from under the
    // slab. A move can add to it or spend it, and only the change matters: the
    // absolute count is a property of the position, not of the move.
    //
    // Both signs have to occur on a buried board, or the term ranks nothing. And
    // a NEGATIVE one has to occur, because an absolute count is never negative --
    // that is what catches a base of zero, where every clear looks like progress.
    var buried = diggingListOf([[1, 2, 1, 5, 'G'], [1, 1, 1, 3, 'G'], [1, 2, 3, 1, 'G'],
                                [1, 5, 3, 3, 'G'], [5, 4, 4, 5, 'G'], [2, 1, 2, 3, 'G']]);
    bok(buried.length > 0, '`digGain`: the buried board offered no options at all');
    var gains = buried.filter(function (x) { return (x.digGain || 0) > 0; });
    var spends = buried.filter(function (x) { return (x.digGain || 0) < 0; });
    bok(gains.length > 0,
        '`digGain`: no option on a buried board moves the board TOWARD a break, so ' +
        'the term has no upside to rank and is dead weight');
    bok(spends.length > 0,
        '`digGain`: no option on a buried board reads negative. An absolute dig ' +
        'count never can, so the base is not being subtracted and every clear ' +
        'looks like progress');

    // THE TWO FALLBACK ROUTES ARE RANKED BY THE SAME NUMBER AS THE WINNERS.
    //
    // `ready` and `flattenReady` accept exactly the same landings -- the ones
    // readyOf says can fire. One is the caller's fallback route, the other the
    // flatten winner restricted the same way. So while both are ranked by `val`
    // they must land on the same value, every time. They disagree the moment
    // `ready` goes back to being chosen by what the walk costs.
    //
    // `save` has no twin to compare against, so it is checked structurally: a
    // route ranked by cost carries no value at all.
    var agreed = 0, disagreed = 0, savesSeen = 0, unvalued = 0;
    var DIGBOARDS = [
        [[1, 2, 1, 5, 'G'], [1, 1, 1, 3, 'G'], [1, 2, 3, 1, 'G'],
         [1, 5, 3, 3, 'G'], [5, 4, 4, 5, 'G'], [2, 1, 2, 3, 'G']],
        [[3, 2, 4, 'G'], [1, 1, 5, 'G'], [4, 2, 3, 'G'],
         [2, 5, 1, 'G'], [5, 3, 2, 'G'], [1, 4, 4, 'G']],
        [[2, 6, 1, 3, 2, 'G'], [4, 4, 5, 1, 6, 'G'], [1, 3, 3, 2, 4, 'G'],
         [5, 1, 2, 6, 3, 'G'], [3, 5, 4, 4, 1, 'G'], [6, 2, 6, 5, 5, 'G']]
    ];
    DIGBOARDS.forEach(function (cols) {
        var grid = [], cells = [], r, c;
        for (r = 0; r <= H; r++) { grid[r] = []; for (c = 1; c <= W; c++) grid[r][c] = 0; }
        for (c = 1; c <= W; c++)
            for (r = 1; r <= cols[c - 1].length; r++) {
                var v = cols[c - 1][r - 1];
                if (v === 'G') { grid[r][c] = -2; cells.push([r, c]); }
                else grid[r][c] = v;
            }
        var lb = new LogicalBoard(W, H, 6, grid, { s: { cells: cells } });
        var l = opts.options(lb, W, H, CURSOR, 2, null,
                             { framesPerRow: 120, deadline: 600 }, true);
        if (l.ready && l.flattenReady) {
            if (l.ready.value === l.flattenReady.value) agreed++; else disagreed++;
        }
        if (l.save) {
            savesSeen++;
            if (typeof l.save.value !== 'number') unvalued++;
        }
    });
    bok(agreed + disagreed > 0,
        '`ready`: no buried board produced both a fallback route and a flatten ' +
        'winner that can fire, so nothing here is compared');
    bok(disagreed === 0,
        '`ready`: ' + disagreed + ' of ' + (agreed + disagreed) + ' boards chose a ' +
        'different fallback route than the flatten winner over the same landings. ' +
        'Both rank readyOf landings, so they can only differ if one of them is ' +
        'ranking by what the walk costs instead of what it lands on');
    bok(savesSeen > 0,
        '`save`: no buried board offered a route back to holding a break, so the ' +
        'save route is unchecked here');
    bok(unvalued === 0,
        '`save`: ' + unvalued + ' of ' + savesSeen + ' save routes carry no value. ' +
        'A route chosen by cost has nothing to carry -- that is the shape of the bug');

    // A BOARD IS NOT SEALED BECAUSE ONE SWAP CANNOT BREAK IT.
    //
    // A clear underneath drops what was resting on it, the slab comes down onto
    // the material, and the break is on the board after. Asked one swap deep most
    // buried boards read sealed, and every rule built on breakReady then treats a
    // position with a way out as a position without one.
    //
    // Checked against a one-swap reference written here, over buried boards built
    // with real garbage blocks -- setting isGarbage by hand makes a cell that no
    // swap can ever break, which would make this pass for the wrong reason.
    //
    // TWO CLAIMS. It has to find breaks the one-swap test misses, or the drop is
    // not being modelled; and it must never MISS one the one-swap test finds,
    // because looking further can only add answers. The second is the invariant --
    // the first is only evidence the code runs.
    function oneSwapBreak(st) {
        var sw = bit.legalSwapsOf(st), i, r;
        for (i = 0; i < sw.length; i++) {
            if (!bit.swapMasks(st, sw[i][0], sw[i][1])) continue;
            r = bit.resolveFromMasks(st, false);
            bit.swapMasks(st, sw[i][0], sw[i][1]);
            if (r.scope === 'garbage-broke') return true;
        }
        return false;
    }
    var dseed = 12345;
    function drnd() { dseed = (dseed * 1103515245 + 12345) & 0x7fffffff; return dseed / 0x7fffffff; }
    var deeper = 0, lost = 0, agreed2 = 0, boardsTried = 0;
    for (var bt = 0; bt < 400; bt++) {
        var dg = [], dcells = [], dr, dc;
        for (dr = 0; dr <= H; dr++) { dg[dr] = []; for (dc = 1; dc <= W; dc++) dg[dr][dc] = 0; }
        var mh = 2 + Math.floor(drnd() * 4);
        for (dc = 1; dc <= W; dc++)
            for (dr = 1; dr <= mh + Math.floor(drnd() * 2); dr++)
                dg[dr][dc] = 1 + Math.floor(drnd() * 5);
        var gs = mh + 3;
        for (dr = gs; dr < gs + 3 && dr <= H; dr++)
            for (dc = 1; dc <= W; dc++) { dg[dr][dc] = -2; dcells.push([dr, dc]); }
        var dst = bit.maskState(dg, { s: { cells: dcells } }, W, H);
        if (dst.bad) continue;
        boardsTried++;
        var shallow = oneSwapBreak(dst);
        var deep = opts.breakReadyBoard(dst);
        if (deep && !shallow) deeper++;
        else if (shallow && !deep) lost++;
        else agreed2++;
    }
    bok(boardsTried > 100,
        '`breakReady`: only ' + boardsTried + ' buried boards were built, so this ' +
        'checks almost nothing');
    bok(deeper > 0,
        '`breakReady`: not one of ' + boardsTried + ' buried boards found a break ' +
        'past a drop that one swap could not reach. The drop is not being modelled, ' +
        'and every board with a way out still reads sealed');
    bok(lost === 0,
        '`breakReady`: ' + lost + ' boards report NO break where a single swap ' +
        'breaks the slab outright. Looking two swaps deep can only add answers, so ' +
        'this is the search losing a break it already had');

    // AND OFF THE SLAB IT IS SILENT. With no garbage there is nothing to dig
    // toward, so the term must not move a ranking it has no business in.
    bok(diggingListOf([[1, 3, 3], [1, 4, 5], [2, 5, 4], [1, 3, 4], [1, 5, 3], [4, 3, 5]])
           .every(function (x) { return (x.digGain || 0) === 0; }),
        '`digGain`: nonzero on a board with no garbage on it, where there is no ' +
        'way out to move toward and this term may not change anything');

    console.log('  breakReady: ' + (bfails ? bfails + ' FAILED' :
                'every option says whether the board it lands on can still break'));
    if (bfails) process.exit(1);
}());

(function () {
    // AND THE FLATTEN CARRIES WHAT ITS DESTINATION IS WORTH, IN FRAMES. The
    // route used to be chosen by whether the landing could fire; `landStop` is
    // what firing there holds the floor for, which is the number that separates a
    // bare three from a chain.
    var lsFails = 0;
    function lok(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); lsFails++; } }
    function price(r) {
        var isChain = r.chain >= 2;
        return opts.sizeOf && isChain ? 56 + 2 * Math.min(r.chain, 13)
             : (r.total > 3 ? 22 + 2 * r.total : 0);
    }
    var withStop = 0, seenBoards = 0, anyFlatten = 0;
    for (var li = 0; li < src.boards.length && seenBoards < 60; li++) {
        var lb = boardFromString(src.boards[li]);
        if (Object.keys(lb.blocks).length) continue;
        seenBoards++;
        var lbo = new LogicalBoard(W, H, 6, lb.grid, lb.blocks);
        var ll = opts.options(lbo, W, H, CURSOR, 2, null,
                              { framesPerRow: 120, deadline: 600, stopPrice: price }, false);
        if (!ll.flatten) continue;
        anyFlatten++;
        if ((ll.flatten.landStop || 0) > 0) withStop++;
    }
    lok(anyFlatten > 5,
        '`landStop`: only ' + anyFlatten + ' boards offered a flatten at all, so this ' +
        'checks nothing');
    lok(withStop > 0,
        '`landStop`: not one flatten on ' + anyFlatten + ' boards carried a priced ' +
        'destination, so the search is still choosing where to stand by a boolean');

    // AND READINESS FOR THE NEXT SLAB IS WORTH ONE PANEL OF LIFE, not a row.
    // A row converts to 6.4 cells in bestAttack -- a whole combo -- for a slab
    // that has not landed, and at that size it overturns clears ten times bigger.
    //
    // AND IT IS PRICED AT PLY ONE TOO. The depth-1 options are built near the top
    // of `options`, before the beam runs, so anything they read that is assigned
    // beside the beam is undefined when they read it -- a price off it comes out
    // NaN, and NaN fails `> 0` silently, which is exactly what a count of priced
    // options cannot see. Counted per ply, and every option checked for a number.
    var FPR = 120, prepped = 0, wrongSize = 0, notANumber = 0;
    var preppedNow = 0, preppedNext = 0;
    for (var pi = 0; pi < src.boards.length && prepped < 400; pi++) {
        var pb = boardFromString(src.boards[pi]);
        if (Object.keys(pb.blocks).length) continue;
        // WITH THE FLAG OFF FIRST. `PREPARE` is module state, so a second call
        // inherits the first one's value: read it too late and ply one still sees
        // a true left over from the call before, and the bug hides behind its own
        // history. One call with the flag off leaves a false there to be caught.
        opts.options(new LogicalBoard(W, H, 6, pb.grid, pb.blocks), W, H, CURSOR, 2,
                     null, { framesPerRow: FPR, deadline: 600, prepare: false }, false);
        var pl = opts.options(new LogicalBoard(W, H, 6, pb.grid, pb.blocks), W, H, CURSOR, 2,
                              null, { framesPerRow: FPR, deadline: 600, prepare: true }, false);
        [['now', pl.now], ['next', pl.next]].forEach(function (pair) {
            pair[1].forEach(function (x) {
                if (typeof x.slabWorth !== 'number' || !isFinite(x.slabWorth)) {
                    notANumber++;
                    return;
                }
                if (!(x.slabWorth > 0)) return;
                prepped++;
                if (pair[0] === 'now') preppedNow++; else preppedNext++;
                if (Math.abs(x.slabWorth - FPR / W) > 0.001) wrongSize++;
            });
        });
    }
    lok(notANumber === 0,
        '`slabWorth`: ' + notANumber + ' options carry a slabWorth that is not a finite ' +
        'number, so they are poisoning whatever ranks them and no count of priced ' +
        'options can see it');
    lok(preppedNow > 0 && preppedNext > 0,
        '`slabWorth`: priced on ' + preppedNow + ' depth-1 options and ' + preppedNext +
        ' depth-2 ones. Both plies must see the price -- the depth-1 list is built ' +
        'before the beam, so it is the one that reads a timing value too early');
    lok(prepped > 0,
        '`slabWorth`: not one option on ' + 400 + ' real boards was priced for slab ' +
        'readiness, so the term is dead and nothing checks its size');
    lok(wrongSize === 0,
        '`slabWorth`: ' + wrongSize + ' of ' + prepped + ' priced options are not one ' +
        'panel of life (' + (FPR / W) + ' frames). A row is 6.4 cells in bestAttack, ' +
        'a whole combo, for a slab that has not landed yet');

    // AND WITHOUT A PRICE IT MUST STILL WORK. The caller may not hand one over,
    // and a search that needs it is a search that breaks its own callers.
    var noPrice = opts.options(new LogicalBoard(W, H, 6,
        boardFromString(src.boards[0]).grid, {}), W, H, CURSOR, 2);
    lok(!!noPrice && !!noPrice.now,
        '`landStop`: the search failed when handed no price for a landing');

    console.log('  landStop: ' + (lsFails ? lsFails + ' FAILED' :
                withStop + ' of ' + anyFlatten + ' flattens carry what their destination is worth'));
    if (lsFails) process.exit(1);

}());

console.log('bitoptions: ' + R.listed + ' options listed over ' + R.boards +
            ' boards, ' + R.played + ' played on the engine exactly, priced by the walk');
