#!/usr/bin/env node
// THE CLOSED FORM IS THE SAME ANSWER AS DOING IT.
//
//   node bitswap.test.js
//
// bitswap computes what a swap clears without applying it: no gravity loop, no
// settle. The check is the other way round — apply the swap, run gravity, read
// the clear off the settled board — and the two have to name the SAME CELLS.
//
// THE FALL CASES ARE THE POINT. An earlier derivation from the masks alone got
// three quarters of clearing swaps and lost the rest, because the rest are
// completed by a panel FALLING into place, and that was the part it could not
// write down. So this does not merely report a total: it counts the cases where
// something fell and requires every one of them to agree. A sweep with no fall
// cases in it would pass while proving nothing, so that fails too.
//
// The two broken variants at the bottom are the two ways the fall can be got
// wrong, and each must break only the fall cases — a mistake that also breaks
// the still cases is a different mistake.
var path = require('path');
var fs = require('fs');
var ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'panel-engine.js'));
require(path.join(ROOT, 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var bit = require('./bitmatch.js');
var bs = require('./bitswap.js');
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

var src = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));

function sweep(clearsFn) {
    var out = { cases: 0, agree: 0, differ: 0, fell: 0, fellAgree: 0,
                fired: 0, scopes: {}, worst: null };
    for (var i = 0; i < src.boards.length; i++) {
        var b = boardFromString(src.boards[i]);
        var base = new LogicalBoard(W, H, 6, b.grid, b.blocks);
        var st = bit.maskState(base.grid, base.blocks, W, H);
        var swaps = base.legalSwaps();
        for (var s = 0; s < swaps.length; s++) {
            var mine = clearsFn(st, swaps[s][0], swaps[s][1]);
            out.scopes[mine.scope] = (out.scopes[mine.scope] || 0) + 1;
            if (mine.scope !== 'ok') continue;

            // Doing it: swap, let gravity run, read the clear off the result.
            var t = base.clone();
            t.swap(swaps[s][0], swaps[s][1]);
            t._applyGravity();
            var truth = bit.clearedCells(t.grid, t.blocks, W, H);

            var tk = Object.keys(truth).sort(), mk = Object.keys(mine.cells).sort();
            out.cases++;
            if (mine.fell) out.fell++;
            if (tk.length) out.fired++;
            var same = tk.length === mk.length && tk.every(function (k) { return mine.cells[k]; });
            if (same) { out.agree++; if (mine.fell) out.fellAgree++; continue; }
            out.differ++;
            if (!out.worst) {
                out.worst = { board: i, swap: swaps[s], fell: !!mine.fell,
                              missed: tk.filter(function (k) { return !mine.cells[k]; }),
                              invented: mk.filter(function (k) { return tk.indexOf(k) < 0; }) };
            }
        }
    }
    return out;
}

var R = sweep(bs.clears);
console.log('  swaps computed        ' + String(R.cases).padStart(6) + '   ' +
            R.fired + ' of them clear something');
console.log('  agree with doing it   ' + String(R.agree).padStart(6) +
            (R.differ ? '   ' + R.differ + ' DIFFER' : '   all of them'));
console.log('  of which a panel fell ' + String(R.fell).padStart(6) + '   ' +
            R.fellAgree + ' agree');
console.log('  out of scope          ' + JSON.stringify(R.scopes));

if (R.differ) { console.error('FAIL ' + JSON.stringify(R.worst)); process.exit(1); }
if (!R.cases) { console.error('FAIL nothing was computed'); process.exit(1); }
if (!R.fired) { console.error('FAIL no swap in the sweep cleared anything'); process.exit(1); }
// The fall is the hard half. A sweep without it proves the easy half twice.
if (!R.fell) {
    console.error('FAIL no swap in the sweep moved a panel into an empty cell — ' +
                  'the fall case is the one this file exists for');
    process.exit(1);
}
if (R.fellAgree !== R.fell) {
    console.error('FAIL ' + (R.fell - R.fellAgree) + ' fall cases disagree');
    process.exit(1);
}
// Garbage columns must be refused, not guessed: a slab bridges and does not drop
// when a panel under it leaves, so the packed-column premise is false there.
if (!R.scopes['garbage-column']) {
    console.error('FAIL no garbage column was ever refused — the premise is untested');
    process.exit(1);
}

// --------------------------------------------------------------------------
// AND IT CAN FAIL, in the two ways the fall can be got wrong.
var real = bs.after;

// 1. The hole does not close: the panel crosses but nothing above it drops.
function noCompaction(st, r, c) {
    var res = real(st, r, c);
    if (res.scope !== 'ok' || !res.fell) return res;
    // put the source column back as it was, keeping the arrival
    var W2 = st.W, stride = W2 + 2, o = c + 1;
    var srcIsC = (st.occ[c] & (1 << (r - 1))) !== 0;
    var col = srcIsC ? res.c : res.o;
    for (var a = 1; a <= st.N; a++) col[a] = st.colour[a * stride + (srcIsC ? c : o)];
    return res;
}

// 2. The panel lands where it was pushed instead of on top of the run it joins.
function landsWherePushed(st, r, c) {
    var res = real(st, r, c);
    if (res.scope !== 'ok' || !res.fell) return res;
    var W2 = st.W, stride = W2 + 2, o = c + 1, a;
    var srcIsC = (st.occ[c] & (1 << (r - 1))) !== 0;
    var toCol = srcIsC ? res.o : res.c;
    var toIdx = srcIsC ? o : c;
    var landed = 1 << popcountLocal(st.occ[toIdx]);
    for (a = 1; a <= st.N; a++) {
        if (toCol[a] & landed) { toCol[a] &= ~landed; toCol[a] |= (1 << (r - 1)); }
    }
    return res;
}
function popcountLocal(x) { var n = 0; while (x) { x &= x - 1; n++; } return n; }

var BREAKS = { 'the hole never closes': noCompaction,
               'it lands where it was pushed': landsWherePushed };
var missed = [];
Object.keys(BREAKS).forEach(function (name) {
    bs.after = BREAKS[name];
    var broken = sweep(bs.clears);
    bs.after = real;
    console.log('  break: ' + name.padEnd(32) + broken.differ + ' cases caught it' +
                ' (' + (broken.fell - broken.fellAgree) + ' of them fall cases)');
    if (!broken.differ) missed.push(name);
});
if (missed.length) {
    missed.forEach(function (m) { console.error('FAIL the sweep did not notice: ' + m); });
    process.exit(1);
}

console.log('bitswap: ' + R.cases + ' swaps answered without applying them, ' +
            R.fell + ' of them settling a panel, all identical to doing it');
