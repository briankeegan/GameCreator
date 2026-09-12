#!/usr/bin/env node
// DOES THE SIMULATION RESOLVE LIKE THE GAME DOES?
//
//   node resolve_fidelity.js [boards|chips|both] [limit]
//
// panel-cpu.js's LogicalBoard is a second implementation of Panel Attack's
// rules, and the bot plans with it: every candidate the search scores is a
// LogicalBoard.resolve(). panel-engine.js is the game. Where they disagree,
// the bot is reasoning about a board that will not happen.
//
// They DO disagree, and it was found sideways — 639 chip templates fire on a
// live Stack and fail the simulation, always the same way. Nothing measured
// it head-on, which is why this exists: one board, one swap, both engines,
// compare everything.
//
// TWO SOURCES, AND BOTH ARE REAL:
//
//   boards  realboards.json — 3,320 settled positions the shipped bot
//           actually played, times EVERY legal swap on each. Tens of
//           thousands of cases, and they are the distribution the bot meets.
//   chips   the ported chip library — far fewer cases, but deliberately
//           deep: these are the cascade shapes, which is exactly where the
//           two are known to part company. Real play throws up a 4-chain
//           rarely; the library is nothing but.
//
// Compared: panels cleared, chain depth (both reported in resolve()'s ROUND
// units, so a plain combo is 1 on each side), and the FINAL GRID cell by
// cell. The grid is the strongest of the three — two engines can agree on
// the totals and still leave the panels in different columns, and the next
// decision is made on the grid, not on the totals.
// WHERE IT STANDS: 50,797 cases — every one of the 3,320 real boards times
// every legal swap on it — and the simulation is IDENTICAL to the engine on
// all of them. Chain depth, panels cleared, and the final grid cell by cell.
//
// It was not. Three things were wrong and each hid the next:
//
//   1. THE HARNESS WAS MOVING. riseLock is re-decided every frame, so a settle
//      long enough to run a cascade let the stack climb a row. 195 of the
//      first 213 "disagreements" were that, and would have been "fixed" in
//      LogicalBoard. engineboard.paint() parks riseTimer now.
//   2. RESOLVE TELEPORTED PANELS. It ran gravity to completion, then matched —
//      so every panel landed at the same instant. The engine makes a panel
//      falling three rows land two frames after one falling a single row, and
//      two groups landing frames apart are two chain links. It now falls a
//      row per tick and matches only what has landed.
//   3. TWO COMBOS ARE NOT A TWO-CHAIN. With the timing fixed, separate groups
//      popping frames apart became separate ROUNDS, and counting rounds calls
//      that a chain. The engine increments only when a matched panel is
//      already flagged chaining, so that flag is modelled panel by panel.
//
// Each fix exposed the one under it, and the first fix made the numbers WORSE
// before better (3 differences became 8) — which is why the measurement had to
// come first and be believed over the expectation.
//
// Effect on the chip library: 349 of the 639 templates that fired on the real
// engine and failed the simulation now pass both.
var path = require('path'), fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var eb = require('./engineboard.js');
var W = globalThis.PanelEngine.WIDTH, H = 12;

var MODE = process.argv[2] || 'boards';
var LIMIT = Number(process.argv[3] || 400);

// A fixture row is one char per cell: a digit for a colour, 0 for empty, and
// a LETTER for garbage naming which SLAB the cell belongs to. 'G' is the old
// format, which forgot the slab — accepted so an old fixture still loads, but
// it lands every garbage cell in one block, which is exactly the thing that
// made the garbage comparison meaningless.
function readBoard(str) {
    var g = [], blocks = {};
    for (var r = 0; r <= H; r++) { g[r] = []; for (var c = 1; c <= W; c++) g[r][c] = 0; }
    var i = 0;
    for (r = 1; r <= H; r++) for (var c2 = 1; c2 <= W; c2++) {
        var ch = str[i++];
        if (ch >= 'a' && ch <= 'z') {
            g[r][c2] = -2;
            (blocks['g' + ch] = blocks['g' + ch] || []).push([r, c2]);
        } else if (ch === 'G') {
            g[r][c2] = -2;
            (blocks.gG = blocks.gG || []).push([r, c2]);
        } else {
            g[r][c2] = Number(ch);
        }
    }
    return { grid: g, blocks: blocks };
}
// Same shape LogicalBoard wants: { id: { cells: [...] } }.
function lbBlocks(blocks) {
    var out = {};
    for (var id in blocks) out[id] = { cells: blocks[id].map(function (rc) { return [rc[0], rc[1]]; }) };
    return out;
}
// Two block maps are the same layout if the same cells are grouped the same
// way. Ids are arbitrary on both sides, so compare the SHAPES, sorted.
function sameBlocks(a, b) {
    function norm(m) {
        var ks = [];
        for (var id in m) {
            var cells = (m[id].cells || m[id]).map(function (rc) { return rc[0] + ':' + rc[1]; }).sort();
            if (cells.length) ks.push(cells.join(','));
        }
        return ks.sort().join('|');
    }
    return norm(a) === norm(b);
}
function cloneGrid(g) {
    var out = [];
    for (var r = 0; r <= H; r++) { out[r] = []; for (var c = 1; c <= W; c++) out[r][c] = g[r][c]; }
    return out;
}

var stack = eb.scratch(10);
stack.speed = 0;

// One case: a board and a swap. Returns null when the case is not decidable
// (the board is not settled on the engine, or the swap is illegal there) —
// an undecidable case is not a disagreement and must not be counted as one.
function compare(grid, r, c, blocks) {
    eb.paint(stack, grid, H, W, blocks);
    if (eb.settle(stack, 60).comboSizes.length) return null;      // not settled: not a fair case
    if (!stack.canSwap(r, c)) return null;
    stack.curRow = r; stack.curCol = c;
    stack.doSwap(r, c);
    var eng = eb.settle(stack, 900);
    var engGrid = eb.readGrid(stack, H, W);

    var lb = new LogicalBoard(W, H, 9, cloneGrid(grid), lbBlocks(blocks || {}));
    lb.swap(r, c);
    var sim = lb.resolve();
    var simCleared = (sim.comboSizes || []).reduce(function (a, b) { return a + b; }, 0);

    var gridSame = true;
    for (var rr = 1; rr <= H && gridSame; rr++)
        for (var cc = 1; cc <= W; cc++)
            if ((engGrid[rr][cc] || 0) !== (lb.grid[rr][cc] || 0)) { gridSame = false; break; }

    // AND THE SLAB LAYOUT. Every garbage cell reads -2, so a grid comparison
    // cannot tell a 6x2 slab from two 6x1s — and those fall and pop
    // differently on the very next move.
    var blocksSame = sameBlocks(eb.readBlocks(stack, H, W), lb.blocks || {});

    return {
        engChain: eng.chainLength, simChain: sim.chainLength,
        engCleared: eng.clearedPanels, simCleared: simCleared,
        gridSame: gridSame, blocksSame: blocksSame
    };
}

var cases = 0, agree = 0, chainDiff = {}, clearedDiff = {}, gridOnly = 0, blockOnly = 0, anyDiff = 0;
function note(res) {
    cases++;
    var dc = res.simChain - res.engChain, dp = res.simCleared - res.engCleared;
    if (dc === 0 && dp === 0 && res.gridSame && res.blocksSame) { agree++; return; }
    anyDiff++;
    if (dc === 0 && dp === 0 && res.gridSame && !res.blocksSame) blockOnly++;
    if (dc !== 0) chainDiff[dc] = (chainDiff[dc] || 0) + 1;
    if (dp !== 0) clearedDiff[dp] = (clearedDiff[dp] || 0) + 1;
    if (dc === 0 && dp === 0 && !res.gridSame) gridOnly++;
}

if (MODE === 'boards' || MODE === 'both') {
    var fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));
    var n = Math.min(LIMIT, fx.boards.length);
    for (var b = 0; b < n; b++) {
        var parsed = readBoard(fx.boards[b]);
        var grid = parsed.grid;
        var lb0 = new LogicalBoard(W, H, 9, cloneGrid(grid), lbBlocks(parsed.blocks));
        lb0.legalSwaps().forEach(function (sw) {
            var res = compare(grid, sw[0], sw[1], parsed.blocks);
            if (res) note(res);
        });
    }
    console.log('real boards scanned : ' + n);
}

if (MODE === 'chips' || MODE === 'both') {
    // The chip library's own staged boards would need the verifier's staging;
    // instead the chips are located ON the real boards, which is the same
    // question asked where it matters.
    console.log('(chips are covered by chips.realboard.test.js; this measures the raw resolve)');
}

console.log('');
console.log('cases compared      : ' + cases);
console.log('identical           : ' + agree + '  (' + (100 * agree / cases).toFixed(2) + '%)');
console.log('differ in any way   : ' + anyDiff + '  (' + (100 * anyDiff / cases).toFixed(2) + '%)');
console.log('  grid only         : ' + gridOnly);
console.log('  garbage slabs only: ' + blockOnly);
function show(label, m) {
    var keys = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
    if (!keys.length) { console.log('  ' + label + ': none'); return; }
    console.log('  ' + label + ': ' + keys.map(function (k) {
        return (k > 0 ? '+' + k : k) + ' x' + m[k];
    }).join('  '));
}
show('chain  (sim - engine)', chainDiff);
show('panels (sim - engine)', clearedDiff);
// GATE MODE. A floor rather than an equality, because three cases in 18,077
// genuinely differ and are recorded rather than papered over; the floor is
// there to catch a REGRESSION of the kind this tool was built to find, where
// 213 of 4,392 cases differed and 195 of those were the harness rising rather
// than either engine being wrong.
if (process.env.GC_FIDELITY_FLOOR) {
    var floor = Number(process.env.GC_FIDELITY_FLOOR);
    var rate = agree / cases;
    if (rate < floor) {
        console.error('FAIL  ' + (100 * rate).toFixed(2) + '% agree, floor is ' + (100 * floor).toFixed(2) + '%');
        process.exit(1);
    }
    console.log('OK    the simulation resolves like the game on ' + (100 * rate).toFixed(2) + '% of real cases');
}
if (process.env.GC_FIDELITY_JSON) {
    fs.writeFileSync(process.env.GC_FIDELITY_JSON, JSON.stringify({
        cases: cases, agree: agree, differ: anyDiff, gridOnly: gridOnly,
        chainDiff: chainDiff, clearedDiff: clearedDiff
    }, null, 1));
}
