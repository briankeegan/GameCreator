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
//
// THE COMMITTED FIXTURE IS STILL THE GARBAGE-FREE ONE, DELIBERATELY, AND THAT
// IS AN OPEN GAP RATHER THAN A CHOICE I LIKE. Capturing with garbage works —
// 4,898 boards, 30% carrying it — and running resolve_fidelity.js over that
// set reports 310 disagreements in 52,130 cases, 248 of them the final board
// alone. But those numbers cannot be believed yet, because BOTH SIDES of that
// comparison mishandle garbage identity:
//
//   - this fixture stores one character per cell, so "G" loses WHICH BLOCK a
//     garbage cell belongs to. LogicalBoard moves garbage by block
//     (_dropGarbageBlocks reads this.blocks), so a board rebuilt from the
//     fixture has garbage cells it can never move. The bot never sees that:
//     SearchCpu._snapshot builds blocks from each panel's garbageId.
//   - engineboard.paint() sets isGarbage but zeroes gWidth/gHeight and never
//     restores garbageId, so the Stack's garbage is malformed too.
//
// Swapping the fixture in before fixing both would hand the gate a pile of
// failures that are the harness's, and the first 300 boards being garbage-free
// means the gate would go on passing while the fixture contained them. Same
// shape as the rising-stack bug, and the same rule applies: fix the
// measurement before believing what it says about the code.
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
// GARBAGE MUST BE IN HERE OR THE FIXTURE LIES BY OMISSION. The first version
// played a bare Stack with no attacks, and 0 of its 3,320 boards carried a
// single garbage cell — so resolve()'s garbage handling (_connectedGarbage,
// _dropGarbageBlocks, conversion back into panels) was compared against the
// engine exactly never, while the fixture read as complete coverage.
// Attacks land on a schedule here, the shapes bench.js's comboStorm, factory
// and bigBlocks scenarios use.
var GARBAGE_EVERY = Number(process.env.GC_CAPTURE_GARBAGE_EVERY || 240);
var SHAPES = [{ width: 4, height: 1 }, { width: 6, height: 1 },
              { width: 6, height: 2 }, { width: 3, height: 1 }];
for (var s = 1; s <= SEEDS; s++) {
    var stack = new PanelEngine.Stack({ level: 10, seed: s * 7919, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: weights, reaction: 12, depth: 1, beam: 6 });
    var nextGarbage = GARBAGE_EVERY, shapeIdx = s;
    for (var f = 0; f < FRAMES; f++) {
        if (stack.gameOver) break;
        if (f >= nextGarbage) {
            var shape = SHAPES[(shapeIdx++) % SHAPES.length];
            stack.receiveGarbage([{ width: shape.width, height: shape.height, isChain: false }]);
            nextGarbage = f + GARBAGE_EVERY;
        }
        cpu.update();
        stack.run();
        if (f % 7) continue;
        if (stack.hasActivePanels() || stack.hasChainingPanels()) continue;
        // One char per cell, bottom row first: 0 empty, a colour digit, or a
        // LETTER for garbage. The letter is the block: a, b, c... per distinct
        // garbageId on this board.
        //
        // A single 'G' was not enough and the difference is not cosmetic.
        // Garbage falls as a SLAB, and LogicalBoard moves it by block
        // (_dropGarbageBlocks reads this.blocks), so a board rebuilt from a
        // fixture that forgot which cells belong together has garbage it can
        // never move — while the real bot never hits that, because
        // SearchCpu._snapshot builds blocks from each panel's garbageId. That
        // alone produced 310 "disagreements" that were the fixture's, not the
        // simulation's.
        var key = '', ids = {}, nextId = 0;
        for (var r = 1; r <= H; r++) {
            for (var c = 1; c <= W; c++) {
                var p = stack.panels[r] && stack.panels[r][c];
                if (!p) { key += '0'; continue; }
                if (p.isGarbage) {
                    var gid = 'g' + p.garbageId;
                    if (ids[gid] === undefined) ids[gid] = nextId++;
                    // 26 distinct blocks on one board is far beyond anything
                    // the game produces; if it ever happened the fixture would
                    // silently merge two, so it refuses instead.
                    if (ids[gid] > 25) throw new Error('more than 26 garbage blocks on one board');
                    key += String.fromCharCode(97 + ids[gid]);
                    continue;
                }
                key += String(p.color || 0);
            }
        }
        if (seen[key]) continue;
        // A SLAB RUNNING INTO THE BUFFER ROWS CANNOT BE STORED HONESTLY. The
        // engine keeps panels above row 12; this fixture stores rows 1..12, so
        // a garbage block that extends past the top is written as the part
        // that fits — and rebuilt from its bounding box it comes back the
        // wrong SIZE, which changes whether it is supported and how it pops.
        // Every disagreement left in resolve_fidelity.js was one of these.
        //
        // Dropped rather than stored wrong. A fixture that cannot represent a
        // position should not claim to: the alternative is a permanent pile of
        // "known failures" that are really the fixture's, which is how the
        // garbage gap hid in the first place.
        var touchesTop = false;
        for (var tc = 1; tc <= W; tc++) {
            var tp = stack.panels[H] && stack.panels[H][tc];
            if (tp && tp.isGarbage && tp.color !== 0) { touchesTop = true; break; }
        }
        if (touchesTop) continue;
        seen[key] = 1;
        out.push(key);
    }
}
fs.writeFileSync(OUT, JSON.stringify({ width: W, height: H, seeds: SEEDS, frames: FRAMES, boards: out }));
console.log('captured ' + out.length + ' distinct settled boards from ' + SEEDS + ' real games -> ' + OUT);
