#!/usr/bin/env node
// WHICH FEATURES ARE MEASURING THE SAME THING?
//
//   node feature_overlap.js [boards]
//
// PUYO_REFERENCE.md's bot has SEVEN features. This evaluator has twenty, and
// four of them (garbageSent, scoreEarned, garbageCleared, chainLength) all
// answer roughly "what did this move just pay". When two features move
// together, the search splits the weight between them arbitrarily — so the
// shipped set reading garbageSent 193 and chainLength 45 says almost nothing
// about which matters more, and neither number can be read on its own.
//
// That is a cost, not a curiosity: correlated features need far more runs to
// converge, and the weights that come out cannot be interpreted.
//
// So this measures it. Every feature is computed over REAL candidate boards —
// real in-play positions times every legal swap, resolved, which is exactly
// what the evaluator scores — and every pair gets a Pearson correlation.
// Pairs above the threshold are the ones worth collapsing.
var path = require('path'), fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var registry = require('./registry.js');
var inputMod = require('./input.js');
var W = 6, H = 12;

var LIMIT = Number(process.argv[2] || 300);
var STRONG = Number(process.env.GC_OVERLAP_STRONG || 0.9);

var fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));
function gridOf(str) {
    var g = [];
    for (var r = 0; r <= H; r++) { g[r] = []; for (var c = 1; c <= W; c++) g[r][c] = 0; }
    var i = 0;
    for (r = 1; r <= H; r++) for (var c2 = 1; c2 <= W; c2++) {
        var ch = str[i++]; g[r][c2] = ch === 'G' ? -2 : Number(ch);
    }
    return g;
}
var live = registry.all.filter(function (f) { return typeof f.fn === 'function'; });
var cols = {};
live.forEach(function (f) { cols[f.key] = []; });

var n = Math.min(LIMIT, fx.boards.length);
for (var b = 0; b < n; b++) {
    var grid = gridOf(fx.boards[b]);
    var base = new LogicalBoard(W, H, 9, grid.map(function (row) { return row.slice(); }), {});
    base.legalSwaps().forEach(function (sw) {
        var t = base.clone();
        t.swap(sw[0], sw[1]);
        var res = t.resolve();
        // The board this candidate LEAVES, scored exactly as the search does.
        var inp = inputMod.normalize({ board: t, liveBoard: t, resolved: res,
                                      chainLength: res.chainLength, garbage: res.garbage });
        live.forEach(function (f) {
            var v = f.fn(inp);
            cols[f.key].push(typeof v === 'number' && isFinite(v) ? v : 0);
        });
    });
}
var keys = Object.keys(cols), N = cols[keys[0]].length;
console.log(N + ' real candidate boards, ' + keys.length + ' features');

function corr(a, b) {
    var ma = 0, mb = 0, i;
    for (i = 0; i < N; i++) { ma += a[i]; mb += b[i]; }
    ma /= N; mb /= N;
    var sa = 0, sb = 0, sab = 0;
    for (i = 0; i < N; i++) {
        var da = a[i] - ma, db = b[i] - mb;
        sa += da * da; sb += db * db; sab += da * db;
    }
    if (sa === 0 || sb === 0) return 0;
    return sab / Math.sqrt(sa * sb);
}
var pairs = [];
for (var i = 0; i < keys.length; i++)
    for (var j = i + 1; j < keys.length; j++)
        pairs.push({ a: keys[i], b: keys[j], r: corr(cols[keys[i]], cols[keys[j]]) });
pairs.sort(function (x, y) { return Math.abs(y.r) - Math.abs(x.r); });

console.log('');
console.log('STRONGLY OVERLAPPING (|r| >= ' + STRONG + ') — candidates to collapse:');
var strong = pairs.filter(function (p) { return Math.abs(p.r) >= STRONG; });
if (!strong.length) console.log('  none');
strong.forEach(function (p) {
    console.log('  ' + (p.r > 0 ? '+' : '') + p.r.toFixed(3) + '  ' + p.a + '  <->  ' + p.b);
});
console.log('');
console.log('next strongest:');
pairs.filter(function (p) { return Math.abs(p.r) < STRONG; }).slice(0, 10).forEach(function (p) {
    console.log('  ' + (p.r > 0 ? '+' : '') + p.r.toFixed(3) + '  ' + p.a + '  <->  ' + p.b);
});
// A feature that never moves cannot be learned at all.
console.log('');
console.log('CONSTANT on every candidate (unlearnable):');
var dead = keys.filter(function (k) {
    var v0 = cols[k][0];
    return cols[k].every(function (v) { return v === v0; });
});
console.log('  ' + (dead.length ? dead.join(', ') : 'none'));
