#!/usr/bin/env node
// WHAT DOES EACH FEATURE COST, ON REAL BOARDS?
//
//   node profile_features.js [repeats]
//
// The search clones and scores a few hundred candidates per decision against
// an 85ms budget, so a feature's price is not a detail — it is the thing that
// decides whether a correct feature can ship. This existed nowhere, which is
// how "if profiling says that is too much" ended up written in features.js
// beside a feature nobody had profiled.
//
// BOARDS ARE REAL ONES. Panel Attack's 235 authored puzzles, same source as
// puzzles.bench.js: a hand-typed board measures whatever the typist believed,
// and a random one has none of the density that makes the expensive features
// expensive. 8 and 9 are SHOCK and COLORLESS — garbage, not colours — and are
// read as garbage here for the same reason that bench does it.
var path = require('path'), fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var registry = require('./registry.js');
var inputMod = require('./input.js');

var W = 6, H = 12;
var PANEL_GAME = process.env.GC_PANEL_GAME || '/home/user/panel-game';
var FILE = path.join(PANEL_GAME, 'client/assets/default_data/puzzles/Puzzles.json');
var REPEATS = Number(process.argv[2] || 20);

function puzzles() {
    var j = JSON.parse(fs.readFileSync(FILE, 'utf8')), out = [];
    (function walk(node) {
        (node['Puzzle Sets'] || []).forEach(walk);
        (node['Puzzles'] || []).forEach(function (p) { out.push(p); });
    })(j);
    return out;
}
function boardFrom(stack) {
    var s = String(stack).replace(/\s+/g, '');
    if (/[^0-9]/.test(s)) return null;
    while (s.length % W) s = '0' + s;
    var rows = [];
    for (var i = 0; i < s.length; i += W) rows.push(s.slice(i, i + W));
    var grid = [];
    for (var r = 0; r <= H; r++) { grid[r] = []; for (var c = 1; c <= W; c++) grid[r][c] = 0; }
    for (var k = 0; k < rows.length; k++) {
        var row = rows.length - k; if (row > H) continue;
        for (var c2 = 1; c2 <= W; c2++) {
            var d = Number(rows[k][c2 - 1]);
            grid[row][c2] = (d === 8 || d === 9) ? -2 : d;
        }
    }
    return new LogicalBoard(W, H, 9, grid, {});
}

var boards = [];
puzzles().forEach(function (p) { var b = boardFrom(p.Stack); if (b) boards.push(b); });
var inputs = boards.map(function (b) { return inputMod.normalize({ board: b, liveBoard: b }); });

var live = registry.all.filter(function (f) { return typeof f.fn === 'function'; });

// Warm up, so the first feature measured is not paying for JIT the rest skip.
for (var w = 0; w < 3; w++) live.forEach(function (f) { inputs.forEach(function (i) { f.fn(i); }); });

// THE NUMBER THAT MATTERS IS PER CANDIDATE, WITH A COLD CACHE.
//
// Features that share one resolve pass are cached per board, so timing them
// one at a time across the same boards charges the pass to whichever feature
// runs first and hands every later one a free ride. That reads as a 5x win
// and the search would see none of it: the search scores a FRESH CLONE every
// candidate, so it pays the pass every time.
//
// So the headline is measured the way the evaluator runs: one new board, all
// features once. The per-feature table below it is attribution only, and says
// so, because a shared cost cannot be attributed to one of its sharers.
var t0 = process.hrtime.bigint();
var candidates = 0;
for (var rep0 = 0; rep0 < REPEATS; rep0++) {
    for (var bi = 0; bi < boards.length; bi++) {
        var fresh = boards[bi].clone();
        var inp = inputMod.normalize({ board: fresh, liveBoard: fresh });
        for (var fi = 0; fi < live.length; fi++) live[fi].fn(inp);
        candidates++;
    }
}
var perCandidate = Number(process.hrtime.bigint() - t0) / 1000 / candidates;

var rows = [], total = 0;
live.forEach(function (f) {
    var t = process.hrtime.bigint();
    for (var rep = 0; rep < REPEATS; rep++)
        for (var i = 0; i < inputs.length; i++) f.fn(inputs[i]);
    var ns = Number(process.hrtime.bigint() - t);
    var us = ns / 1000 / (REPEATS * inputs.length);
    rows.push({ key: f.key, us: us });
    total += us;
});
rows.sort(function (a, b) { return b.us - a.us; });
console.log(boards.length + ' real boards x ' + REPEATS + ' repeats');
console.log('');
console.log('PER CANDIDATE, COLD  ' + perCandidate.toFixed(2).padStart(8) + ' us   <- what the search pays');
console.log('');
console.log('attribution only — a shared pass is charged to whoever asks first:');
rows.forEach(function (r) {
    console.log((r.key + '                    ').slice(0, 20) +
                r.us.toFixed(2).padStart(8) + ' us   ' +
                (100 * r.us / total).toFixed(1).padStart(5) + '%');
});
console.log(('sum of the above    ').slice(0, 20) + total.toFixed(2).padStart(8) + ' us');
if (process.env.GC_PROFILE_JSON) {
    fs.writeFileSync(process.env.GC_PROFILE_JSON,
                     JSON.stringify({ boards: boards.length, repeats: REPEATS, perCandidateUs: perCandidate, features: rows, attributedUs: total }, null, 1));
}
