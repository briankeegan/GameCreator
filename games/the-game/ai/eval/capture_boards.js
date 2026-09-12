#!/usr/bin/env node
// REAL BOARDS, FROM REAL PLAY — the fixture the chip claims are checked on.
//
//   node capture_boards.js [outfile]
//
// Every board this writes is one the shipped bot actually sat on, playing
// the real engine at level 10. None was built to suit a chip, which is the
// entire point: a chip verified only on staging this repo invents is
// verified against our own imagination. chips.realboard.test.js fires chips
// from these and compares the result to what the chip claims.
//
// SETTLED BOARDS ONLY. A board mid-cascade is not a position anything gets
// to plan from, and its panels are in states no template can describe.
//
// Deterministic: fixed seeds, fixed frame budget, so regenerating gives the
// same fixture and a failure reproduces by rerunning.
var path = require('path'), fs = require('fs');
var GAME = path.join(__dirname, '..', '..');
require(path.join(GAME, 'panel-engine.js'));
require(path.join(GAME, 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require('./puyocpu.js');
var switches = require('./switches.js');
var W = PanelEngine.WIDTH, H = 12;

var SEEDS = Number(process.env.GC_CAPTURE_SEEDS || 8);
var FRAMES = Number(process.env.GC_CAPTURE_FRAMES || 20000);
var OUT = process.argv[2] || path.join(__dirname, 'realboards.json');

var weights = switches.load().weights || {};
var out = [], seen = {};
for (var s = 1; s <= SEEDS; s++) {
    var stack = new PanelEngine.Stack({ level: 10, seed: s * 7919, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: weights, reaction: 12, depth: 1, beam: 6 });
    for (var f = 0; f < FRAMES; f++) {
        if (stack.gameOver) break;
        cpu.update();
        stack.run();
        if (f % 7) continue;
        if (stack.hasActivePanels() || stack.hasChainingPanels()) continue;
        // One char per cell, bottom row first: 0 empty, G garbage, else the
        // colour. Compact enough to commit; 800KB of JSON arrays was not.
        var key = '';
        for (var r = 1; r <= H; r++) {
            for (var c = 1; c <= W; c++) {
                var p = stack.panels[r] && stack.panels[r][c];
                var v = !p ? 0 : (p.isGarbage ? -2 : (p.color || 0));
                key += (v === -2) ? 'G' : String(v);
            }
        }
        if (seen[key]) continue;
        seen[key] = 1;
        out.push(key);
    }
}
fs.writeFileSync(OUT, JSON.stringify({ width: W, height: H, seeds: SEEDS, frames: FRAMES, boards: out }));
console.log('captured ' + out.length + ' distinct settled boards from ' + SEEDS + ' real games -> ' + OUT);
