// A SWAP IS CREDITED WITH WHAT IT DOES IN THE GAME.
//
// Every route reads the candidate pool's result for a swap: does it clear, does
// it break. On a board in motion the clear already resolving is in every
// result the resolver gives, so the pool credits a swap only with what it adds
// (causedBy). Here the pool is asked about every swap on real comboStorm boards
// at level 10, and pa-engine plays each one -- pressed when the bot's walk
// would arrive -- against the same board left alone. A swap clears in the game
// if it adds cleared cells or a garbage hit.
//
// A board in motion is played on the server's engine itself (pa.c, linked into
// the bot). Budgets are the measured counts (seed 13, frames 300-2500, every
// 29th, 1843 swaps): 2 predicted clears the game does not make, 5 it makes
// that the pool misses. Both are to be driven to zero; the budget stops them
// growing.
//
// The check fires: credited with the board's own clear as well, as the pool
// was before causedBy, the same swaps give hundreds of false clears.
require('../../panel-engine.js'); require('../../panel-cpu.js');
var BitBot = require('./bitbot.js'), bench = require('./bench.js');
var PA = require('../../pa-engine.js'), GEN = require('../../pa-generator.js'), E = globalThis.PanelEngine;

var SEED = 13, FROM = 300, TO = 2500, EVERY = 29, FALSE_BUDGET = 2, MISS_BUDGET = 5, MIN_SWAPS = 800;

function played(s, r, c, at) {
    var t = s.copy(); t.incoming = []; t.health = 1e9; t.stopTime = 999; t.events = [];
    var cells = 0, hits = 0, pressed = !r;
    // Until nothing moves, as the engine in the bot runs it: a chain can
    // outlast any fixed window (one here ran to frame 339).
    for (var k = 0; k < 900; k++) {
        if (pressed && k > at + 5 && !t.hasActivePanels() && !t.swapQueued()) break;
        if (!pressed && k >= at) {
            t.curRow = r; t.curCol = c;
            if (!t.canSwap(r, c) || !t.tryQueueSwap(r, c)) return null;
            pressed = true;
        }
        t.setInput({}); t.run();
        for (var e = 0; e < t.events.length; e++) if (t.events[e].type === 'match') { cells += t.events[e].size; if (t.events[e].garbage > 0) hits++; }
        t.events.length = 0;
    }
    return { cells: cells, hits: hits };
}

var sc = bench.SCENARIOS.comboStorm, ld = PA.vsLevel(10).levelData;
var pa = PA.create(10, new PA.Seeded(new GEN.GeneratorSource(SEED, true, ld.colors, ld.adjacentDenialFrequency)));
var bot = new BitBot(PA.view(pa, E), { allowRaise: true, reaction: 12, seed: SEED });
var n = 0, falseClear = 0, missed = 0, oldFalse = 0;
for (var f = 0; f < TO && !(pa.gameOverClock > 0); f++) {
    if (f >= FROM && f % EVERY === 0 && pa.hasActivePanels()) {
        var probe = new BitBot(PA.view(pa, E), { allowRaise: true }), b = probe._snapshot();
        var pool = probe.candidates(b, probe.info(b)), alone = played(pa, 0, 0, 0), hold = pool[0].resolved || {};
        var holdClears = hold.total > 0 || hold.brokeGarbage > 0;
        pool.forEach(function (p) {
            if (p.kind !== 'swap') return;
            var o = played(pa, p.swap[0], p.swap[1], p.moveFrames || 0);
            if (!o) return;
            var game = o.cells > alone.cells || o.hits > alone.hits;
            var said = !!(p.resolved && (p.resolved.total > 0 || p.resolved.brokeGarbage > 0));
            n++;
            if (said && !game) falseClear++;
            if (!said && game) missed++;
            if ((said || holdClears) && !game) oldFalse++;
        });
    }
    if (sc.burst && pa.stopWatchIsRunning && bench.burstFires(pa.stopWatch)) {
        pa.receiveGarbage([{ width: sc.garbageWidth, height: sc.garbageHeight, isChain: false, isMetal: false, frameEarned: pa.stopWatch, finalized: true }]);
    }
    bot.stack = PA.view(pa, E); bot.update(); pa.run(); pa.events.length = 0;
}
var fails = 0;
function fail(m) { fails++; console.log('FAIL: ' + m); }
if (n < MIN_SWAPS) fail('only ' + n + ' swaps on moving boards, want ' + MIN_SWAPS);
if (falseClear > FALSE_BUDGET) fail(falseClear + ' predicted clears the game does not make, budget ' + FALSE_BUDGET);
if (missed > MISS_BUDGET) fail(missed + ' clears the game makes that the pool misses, budget ' + MISS_BUDGET);
if (oldFalse <= FALSE_BUDGET * 10) fail('crediting the board\'s own clear gave only ' + oldFalse + ' false clears -- this check cannot see the defect it exists for');
console.log('swapcredit: ' + n + ' swaps on moving boards, ' + falseClear + ' false clears, ' + missed + ' missed; with the board\'s own clear credited, ' + oldFalse + ' false clears');
if (fails) { console.log('swapcredit: FAIL'); process.exit(1); }
console.log('swapcredit: OK');
