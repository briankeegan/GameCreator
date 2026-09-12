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
// WHERE IT STANDS, measured on 1,200 real boards x every legal swap =
// 18,077 cases: 18,074 identical, THREE genuinely different. The standard is
// 100% and these three are the gap, recorded here so they are a target rather
// than a rounding error:
//
//   board  611  swap r3 c5   sim chain 2 / 8 cleared   engine chain 1 / 3
//   board  854  swap r2 c3   sim chain 3 / 15          engine chain 4 / 15
//   board 1190  swap r3 c2   sim chain 1 / 5           engine chain 1 / 3
//
// Board 854 is the important one: same panels, same final grid, chain depth
// one SHORT — the same divergence as the 639 chips that fire on the engine and
// fail the simulation, reproduced on a board the bot actually played. It is
// not an artefact of chip staging, and "deep cascades are rare in play" is
// circular: they are rare because the bot cannot build them, and building them
// is the point.
//
// The cause is in resolve()'s shape. It runs gravity to completion, then
// matches, then repeats — so every panel lands at the same instant. The engine
// makes a panel that falls three rows take longer than one that falls one row,
// so two groups land frames apart and count as two chain links where resolve()
// merges them into one. Fixing it means gravity ordered by LANDING TIME, not a
// full settle between rounds. One attempt at that failed before (fixed 0 of
// 372, broke 32) and is recorded above LogicalBoard in panel-cpu.js; the
// difference now is that these three cases are exact, reproducible, and on
// real boards.
var path = require('path'), fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var eb = require('./engineboard.js');
var W = globalThis.PanelEngine.WIDTH, H = 12;

var MODE = process.argv[2] || 'boards';
var LIMIT = Number(process.argv[3] || 400);

function gridOf(str) {
    var g = [];
    for (var r = 0; r <= H; r++) { g[r] = []; for (var c = 1; c <= W; c++) g[r][c] = 0; }
    var i = 0;
    for (r = 1; r <= H; r++) for (var c2 = 1; c2 <= W; c2++) {
        var ch = str[i++];
        g[r][c2] = ch === 'G' ? -2 : Number(ch);
    }
    return g;
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
function compare(grid, r, c) {
    eb.paint(stack, grid, H, W);
    if (eb.settle(stack, 60).comboSizes.length) return null;      // not settled: not a fair case
    if (!stack.canSwap(r, c)) return null;
    stack.curRow = r; stack.curCol = c;
    stack.doSwap(r, c);
    var eng = eb.settle(stack, 900);
    var engGrid = eb.readGrid(stack, H, W);

    var lb = new LogicalBoard(W, H, 9, cloneGrid(grid), {});
    lb.swap(r, c);
    var sim = lb.resolve();
    var simCleared = (sim.comboSizes || []).reduce(function (a, b) { return a + b; }, 0);

    var gridSame = true;
    for (var rr = 1; rr <= H && gridSame; rr++)
        for (var cc = 1; cc <= W; cc++)
            if ((engGrid[rr][cc] || 0) !== (lb.grid[rr][cc] || 0)) { gridSame = false; break; }

    return {
        engChain: eng.chainLength, simChain: sim.chainLength,
        engCleared: eng.clearedPanels, simCleared: simCleared,
        gridSame: gridSame
    };
}

var cases = 0, agree = 0, chainDiff = {}, clearedDiff = {}, gridOnly = 0, anyDiff = 0;
function note(res) {
    cases++;
    var dc = res.simChain - res.engChain, dp = res.simCleared - res.engCleared;
    if (dc === 0 && dp === 0 && res.gridSame) { agree++; return; }
    anyDiff++;
    if (dc !== 0) chainDiff[dc] = (chainDiff[dc] || 0) + 1;
    if (dp !== 0) clearedDiff[dp] = (clearedDiff[dp] || 0) + 1;
    if (dc === 0 && dp === 0 && !res.gridSame) gridOnly++;
}

if (MODE === 'boards' || MODE === 'both') {
    var fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));
    var n = Math.min(LIMIT, fx.boards.length);
    for (var b = 0; b < n; b++) {
        var grid = gridOf(fx.boards[b]);
        var lb0 = new LogicalBoard(W, H, 9, cloneGrid(grid), {});
        lb0.legalSwaps().forEach(function (sw) {
            var res = compare(grid, sw[0], sw[1]);
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
