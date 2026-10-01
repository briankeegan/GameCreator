#!/usr/bin/env node
// THE FEATURES ARE SHARES, THEY VARY, AND NOTHING IN THEM IS A SECOND COPY.
//
//   node bitfeatures.test.js
//
// Five things:
//
//   1. THE STOP-TIME SUM IS THE ENGINE'S OWN. This file computes what a clear
//      would earn without asking the engine, so it is checked against
//      Stack.awardStopTime over every combination that matters. A second copy of
//      a rule is only safe while something compares them.
//   2. EVERY KEY IS PRODUCED, on every board, as a finite number in [0,1]. A
//      missing key reads as undefined in a weighted sum and scores nothing,
//      silently.
//   3. A FEATURE THAT NEVER VARIES CANNOT BE LEARNED, and a search will still
//      assign it weight — latentChain never fired in three full games and was
//      given 267 of 300. A flat feature fails.
//   4. NOTHING IS A SECOND COPY OF SOMETHING ELSE. Pearson over real boards, the
//      repo's own 0.9 threshold. Collinear terms split their weight arbitrarily,
//      so the weights that come out cannot be read.
//   5. THE DEEP-CHAIN BUCKET IS VALIDATED OFF THIS BOT'S OWN BOARDS. chain5plus
//      is flat on captured play, because the current bot does not build chains —
//      judging it there is circular. The chip corpus reaches depth 6, so it is
//      judged there.
var path = require('path');
var fs = require('fs');
var ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'panel-engine.js'));
require(path.join(ROOT, 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var PE = globalThis.PanelEngine;
var BF = require('./bitfeatures.js');
var W = 6, H = 12;
// THE CLOCK EVERY features() CALL HANDS OVER. bitoptions requires one -- the
// depth-2 half of its list is beam-ranked in frames -- and the rise is the
// engine's own at the level the game runs: a level-10 stack's speed through
// riseTime, times 16. The cooldown is the bot's default.
var T_LEVEL = 10, T_REACTION = 12;
var T_FPROW = (function () {
    var st = new globalThis.PanelEngine.Stack({ level: T_LEVEL });
    return globalThis.PanelEngine.riseTime(st.speed) * 16;
}());
function CLOCKOF(info) {
    return { framesPerRow: T_FPROW, reaction: T_REACTION,
             deadline: (12 - 0) * T_FPROW + ((info && info.stopTime) || 0) };
}


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

var src = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));
var KEYS = BF.keys();

// --------------------------------------------------------------------------
// 1. The arithmetic first: a wrong sum makes everything after it measure a wrong
// number. A fresh clock each time, because awardStopTime only writes when its
// result beats what is already there.
var stack = new PE.Stack({ level: 10, seed: 5 });
var checked = 0, nonZero = 0, wrong = null;
[false, true].forEach(function (toppedOut) {
    [0, 2, 3, 4, 6, 13, 20].forEach(function (chainCounter) {
        [0, 3, 4, 5, 6, 7, 9, 12].forEach(function (comboSize) {
            [false, true].forEach(function (isChain) {
                stack.stopTime = 0;
                stack.wasToppedOut = toppedOut;
                stack.chainCounter = chainCounter;
                stack.awardStopTime(isChain, comboSize);
                var theirs = stack.stopTime;
                var mine = BF.stopTimeOf(PE, isChain, comboSize, chainCounter, toppedOut);
                checked++;
                if (theirs) nonZero++;
                if (theirs !== mine && !wrong) {
                    wrong = { toppedOut: toppedOut, chain: chainCounter, combo: comboSize,
                              isChain: isChain, engine: theirs, mine: mine };
                }
            });
        });
    });
});
console.log('  stop time vs the engine   ' + checked + ' combinations, ' +
            (wrong ? 'DIFFER' : 'all agree') + ' (' + nonZero + ' non-zero)');
if (wrong) { console.error('FAIL ' + JSON.stringify(wrong)); process.exit(1); }
if (!nonZero) { console.error('FAIL nothing earned anything — nothing was compared'); process.exit(1); }
// A plain three earning nothing is the fact the whole defend design rests on.
if (BF.stopTimeOf(PE, false, 3, 0, false) !== 0) {
    console.error('FAIL a plain three now earns stop time — the defend design assumes it does not');
    process.exit(1);
}

// --------------------------------------------------------------------------
// 2, 3 and 4 over real boards. moveFrames and resolved are varied so the two
// candidate-owned features are exercised rather than sitting at one value.
BF.resetClamps();
var seen = {}, rows = [], boards = 0, missing = null, bad = null;
KEYS.forEach(function (k) { seen[k] = {}; });
for (var i = 0; i < src.boards.length; i += 2) {
    var b = boardFromString(src.boards[i]);
    var lb = new LogicalBoard(W, H, 6, b.grid, b.blocks);
    var info = { stopTime: (i * 7) % 99, toppedOut: (i % 11) === 0 };
    var moveFrames = (i * 5) % 64;
    var resolved = (i % 3) === 0
        ? { chain: 1 + (i % 4), total: 3 + (i % 6), brokeGarbage: (i % 7) === 0 ? 6 : 0 }
        : null;
    var out = BF.features(lb, [1, 1], moveFrames, resolved, info, PE, null, CLOCKOF(info));
    boards++;
    var row = [];
    for (var k = 0; k < KEYS.length; k++) {
        var key = KEYS[k], v = out.f[key];
        if (v === undefined) { if (!missing) missing = { board: i, key: key }; row.push(0); continue; }
        if (!isFinite(v) || v < 0 || v > 1) { if (!bad) bad = { board: i, key: key, value: v }; }
        seen[key][Math.round(v * 1000)] = 1;
        row.push(v);
    }
    rows.push(row);
}
console.log('  boards                    ' + boards + ', features ' + KEYS.length);
if (missing) { console.error('FAIL ' + missing.key + ' not produced on board ' + missing.board); process.exit(1); }
if (bad) { console.error('FAIL ' + JSON.stringify(bad) + ' is not a share'); process.exit(1); }
if (BF.clamps()) {
    console.error('FAIL ' + BF.clamps() + ' values clamped — an observed divisor has been outgrown');
    process.exit(1);
}

var flat = KEYS.filter(function (k) { return Object.keys(seen[k]).length <= 1; });
console.log('  flat on captured play     ' + (flat.length ? flat.join(' ') : 'none'));

// chain5plus is EXPECTED flat here and judged on the chips below; anything else
// flat is a dead dimension.
var unexpected = flat.filter(function (k) { return k !== 'chain5plus'; });
if (unexpected.length) {
    console.error('FAIL these took one value on every board and cannot be learned: ' + unexpected.join(' '));
    process.exit(1);
}

// 4. Pearson, the repo's own threshold.
function pearson(a, b) {
    var n = a.length, ma = 0, mb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    var num = 0, da = 0, db = 0;
    for (i = 0; i < n; i++) { var x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    if (da === 0 || db === 0) return NaN;
    return num / Math.sqrt(da * db);
}
var cols = KEYS.map(function (_, k) { return rows.map(function (r) { return r[k]; }); });
var strong = [];
for (var a1 = 0; a1 < KEYS.length; a1++) {
    for (var b1 = a1 + 1; b1 < KEYS.length; b1++) {
        var r2 = pearson(cols[a1], cols[b1]);
        if (!isNaN(r2) && Math.abs(r2) >= 0.9) strong.push(KEYS[a1] + '~' + KEYS[b1] + '=' + r2.toFixed(2));
    }
}
console.log('  pairs at |r| >= 0.9       ' + (strong.length ? strong.join('  ') : 'none'));
if (strong.length) {
    console.error('FAIL collinear features split their weight arbitrarily: ' + strong.join(' '));
    process.exit(1);
}

// --------------------------------------------------------------------------
// 5. The deep bucket, on boards that HOLD deep chains. The chips are staged by
// verify_chips.js, borrowed rather than copied.
var V = require('./verify_chips.js');


var deepSeen = {}, staged = 0, deepest = 0;
V.chips.forEach(function (chip) {
    if (chip.swaps.length > 2) return;
    var st = V.stage(chip, V.MAP);
    if (st.skip) return;
    var board = st.board;
    for (var s = 0; s < chip.swaps.length; s++) {
        var r = chip.swaps[s][0] + st.rowOff, c = chip.swaps[s][1] + st.colOff;
        if (r < 1 || r > V.H || c < 1 || c >= V.W) return;
        if (s > 0) board._applyGravity();
        board.swap(r, c);
    }
    board._applyGravity();
    var out = BF.features(board, [1, 1], 0, null, { stopTime: 50, toppedOut: false }, PE, null, CLOCKOF({ stopTime: 50 }));
    staged++;
    deepSeen[Math.round(out.f.chain5plus * 1000)] = 1;
    var best = BF.bestSize(out.options.now.concat(out.options.next), 'chain');
    if (best > deepest) deepest = best;
});
console.log('  chip boards               ' + staged + ', deepest chain on offer ' + deepest +
            ', chain5plus values ' + Object.keys(deepSeen).length);
if (!staged) { console.error('FAIL no chip board was staged'); process.exit(1); }
if (Object.keys(deepSeen).length < 2) {
    console.error('FAIL chain5plus is flat even on the chip corpus — it is a dead dimension everywhere');
    process.exit(1);
}

// --------------------------------------------------------------------------
// WITHOUT THE ENGINE STATE, NOTHING IS GUESSED.
var noInfo = BF.features(new LogicalBoard(W, H, 6, boardFromString(src.boards[0]).grid, {}),
                         [1, 1], 0, null, null, PE, null, CLOCKOF(null));
['stopEarned', 'stopReachable'].forEach(function (k) {
    if (noInfo.f[k] !== undefined) {
        console.error('FAIL ' + k + ' was computed with no clock to compute it from');
        process.exit(1);
    }
});
console.log('  with no engine state      stop-time features absent, not zero');

// --------------------------------------------------------------------------
// AND IT CAN FAIL. The surface is arithmetic over column heights; reporting every
// column the same height flattens all three of its features, which is the
// dead-dimension defect above.
var realSurface = BF.surface;
BF.surface = function () {
    return { heights: [0, 6, 6, 6, 6, 6, 6], bumpiness: 0, spread: 0, tallest: 6, shortest: 6 };
};
var flatSeen = { bumpiness: {}, spread: {}, tallest: {} };
for (var z = 0; z < 400 && z < src.boards.length; z++) {
    var zb = boardFromString(src.boards[z]);
    var zo = BF.features(new LogicalBoard(W, H, 6, zb.grid, zb.blocks), [1, 1], 10, null,
                         { stopTime: 50, toppedOut: false }, PE, null, CLOCKOF({ stopTime: 50 }));
    Object.keys(flatSeen).forEach(function (k) { flatSeen[k][Math.round(zo.f[k] * 1000)] = 1; });
}
BF.surface = realSurface;
var caught = Object.keys(flatSeen).filter(function (k) { return Object.keys(flatSeen[k]).length <= 1; });
console.log('  break: ' + 'every column the same height'.padEnd(30) +
            (caught.length === 3 ? 'caught (all three went flat)' : 'NOT CAUGHT'));
if (caught.length !== 3) {
    console.error('FAIL a stubbed-flat surface still varied: ' + JSON.stringify(flatSeen));
    process.exit(1);
}

// And the counts: cumulative instead of exact is how adjacent sizes become the
// same dimension, which is the collinearity check above.
var realWays = BF.ways;
BF.ways = function (options, kind, size) {
    var n = 0;
    for (var i = 0; i < options.length; i++) {
        if (options[i].kind === kind && options[i].size >= size) n++;
    }
    return n;
};
var cumRows = [];
for (var y = 0; y < 900 && y < src.boards.length; y += 2) {
    var yb = boardFromString(src.boards[y]);
    var yo = BF.features(new LogicalBoard(W, H, 6, yb.grid, yb.blocks), [1, 1], 10, null,
                         { stopTime: 50, toppedOut: false }, PE, null, CLOCKOF({ stopTime: 50 }));
    cumRows.push(KEYS.map(function (k) { return yo.f[k] || 0; }));
}
BF.ways = realWays;
var cumCols = KEYS.map(function (_, k) { return cumRows.map(function (r) { return r[k]; }); });
var cumStrong = 0;
for (var a2 = 0; a2 < KEYS.length; a2++) {
    for (var b2 = a2 + 1; b2 < KEYS.length; b2++) {
        var rr = pearson(cumCols[a2], cumCols[b2]);
        if (!isNaN(rr) && Math.abs(rr) >= 0.9) cumStrong++;
    }
}
console.log('  break: ' + 'counts made cumulative'.padEnd(30) + cumStrong + ' collinear pairs appear');
if (!cumStrong) {
    console.error('FAIL cumulative counts did not produce collinearity — the exact-count choice is untested');
    process.exit(1);
}

console.log('bitfeatures: ' + KEYS.length + ' features over ' + boards +
            ' boards, none flat, none collinear, stop time agreeing with the engine');
