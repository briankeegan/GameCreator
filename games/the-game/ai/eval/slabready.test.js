// A SLAB IS READY ONLY IF THE ENGINE BREAKS IT.
//
// The bot keeps a break in hand for the next slab, so "ready" decides what it
// may spend. Native slabReady places the real next slab -- its width, at the
// column the drop cycle gives it, on the tallest of its own columns -- and asks
// whether one swap breaks it. Here the same question goes to the engine: settle
// a real drill board, drop that slab, try every swap and run each to the end.
//
// A false "ready" is a break the bot believes in and does not have, so the
// budget for it is zero. A miss only costs a setup the bot did not need; the
// measured misses are a slab falling into a match that is already flashing,
// which the native resolver does not model (2 in 2079 boards, comboStorm seeds
// 1-3 to frame 15000).
//
// The check fires: the same boards asked of the full-row estimate this replaced
// (column 0) must break one of the budgets. On seed 3 to frame 5000 it calls 72
// of 337 ready boards not ready.
var path = require('path');
require('../../panel-engine.js'); require('../../panel-cpu.js');
var BitBot = require('./bitbot.js'), bench = require('./bench.js'), bit = require('./bitmatch.js');
var native = require('./bitnative.js');
var PA = require('../../pa-engine.js'), GEN = require('../../pa-generator.js'), E = globalThis.PanelEngine;

var SEED = 3, FRAMES = 5000, EVERY = 7, MISS_BUDGET = 1, MIN_BOARDS = 150;

function engineBreaks(s) {
    for (var r = 1; r <= Math.min(s.height, 12); r++) for (var c = 1; c <= 5; c++) {
        var a = s.panels[r] && s.panels[r][c], b = s.panels[r] && s.panels[r][c + 1];
        if (!a || !b || (!a.color && !b.color) || a.isGarbage || b.isGarbage) continue;
        var t = s.copy(); t.incoming = []; t.health = 1e9; t.curRow = r; t.curCol = c; t.events = [];
        if (!t.canSwap(r, c) || !t.tryQueueSwap(r, c)) continue;
        for (var k = 0; k < 900; k++) {
            t.setInput({}); t.run();
            for (var e = 0; e < t.events.length; e++) if (t.events[e].type === 'match' && t.events[e].garbage > 0) return true;
            t.events.length = 0;
            if (k > 10 && !t.hasActivePanels()) break;
        }
    }
    return false;
}
function settle(s) {
    for (var k = 0; k < 900 && (k < 2 || s.hasActivePanels() || s.hasFallingGarbage() || s.incoming.length); k++) {
        s.setInput({}); s.run(); s.events.length = 0;
    }
}

var sc = bench.SCENARIOS.comboStorm, ld = PA.vsLevel(10).levelData;
var pa = PA.create(10, new PA.Seeded(new GEN.GeneratorSource(SEED, true, ld.colors, ld.adjacentDenialFrequency)));
var bot = new BitBot(PA.view(pa, E), { allowRaise: true, reaction: 12, seed: SEED });
var n = 0, falseReady = 0, missed = 0, estimateFalse = 0, estimateMissed = 0;
for (var f = 0; f < FRAMES && !(pa.gameOverClock > 0); f++) {
    if (f % EVERY === 0 && pa.incoming.length && !pa.hasFallingGarbage() && !pa.isToppedOut()) {
        var g = pa.incoming[pa.incoming.length - 1];
        var q = pa.copy(); q.incoming = []; q.health = 1e9; q.events = [];
        settle(q);
        var v = PA.view(q, E), board = new BitBot(v, {})._snapshot();
        var st = bit.maskState(board.grid, board.blocks, 6, board.height, board.motion);
        var col = v.nextSpawnColumn(g.width);
        var said = native.slabReady(st, g.width, g.height, col), estimate = native.slabReady(st, g.width, g.height, 0);
        var t = q.copy(); t.incoming = [g]; t.health = 1e9; t.events = [];
        settle(t);
        t.stopTime = 999;
        var real = engineBreaks(t);
        n++;
        if (said && !real) { falseReady++; console.log('FAIL: frame ' + f + ' slabReady says a break the engine does not have'); }
        if (!said && real) missed++;
        if (estimate && !real) estimateFalse++;
        if (!estimate && real) estimateMissed++;
    }
    if (sc.burst && pa.stopWatchIsRunning && bench.burstFires(pa.stopWatch)) {
        pa.receiveGarbage([{ width: sc.garbageWidth, height: sc.garbageHeight, isChain: false, isMetal: false, frameEarned: pa.stopWatch, finalized: true }]);
    }
    bot.stack = PA.view(pa, E); bot.update(); pa.run(); pa.events.length = 0;
}
var fails = falseReady;
if (n < MIN_BOARDS) { fails++; console.log('FAIL: only ' + n + ' boards sampled, want ' + MIN_BOARDS); }
if (missed > MISS_BUDGET) { fails++; console.log('FAIL: ' + missed + ' missed breaks, budget ' + MISS_BUDGET); }
if (!estimateFalse && estimateMissed <= MISS_BUDGET) { fails++; console.log('FAIL: the full-row estimate passed too -- this check cannot see the defect it exists for'); }
console.log('slabready: ' + n + ' boards, ' + falseReady + ' false ready, ' + missed + ' missed; the full-row estimate claimed ' +
            estimateFalse + ' breaks the engine does not have and missed ' + estimateMissed);
if (fails) { console.log('slabready: FAIL'); process.exit(1); }
console.log('slabready: OK');
