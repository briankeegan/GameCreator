#!/usr/bin/env node
// A SLAB THE ENGINE WILL NOT TAKE IS NOT BROKEN.
//
// getConnectedGarbagePanels takes only garbage that is colour 9 and state 'normal',
// so a slab still matched from the last break, or one in the air, is not part of a
// break, and a match beside it is an ordinary clear. bitmatch reads that off the
// snapshot's motion (slabLocked in maskState). Checked against the engine on real
// boards: play bigBlocks with the bot, and on every board with garbage in a state
// other than normal, play each legal swap on a copy of the engine and read whether
// the first match it makes took garbage. The bot's answer must agree on every one.
// Played twice: on panel-engine.js, and on the server's rules (pa-engine.js, the
// bot reading it through PA.view).
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var BitBot = require(path.join(__dirname, 'bitbot.js'));
var bit = require(path.join(__dirname, 'bitmatch.js'));
var P = require(path.join(__dirname, 'puyocpu.js'));
var bench = require(path.join(__dirname, 'bench.js'));
var PA = require(path.join(__dirname, 'pa-engine.js')), GEN = require(path.join(__dirname, 'pa-generator.js'));
var E = globalThis.PanelEngine, W = E.WIDTH;
var sc = bench.SCENARIOS.bigBlocks;

function busyGarbage(st) {
    for (var r = 1; r <= st.height; r++) for (var c = 1; c <= W; c++) {
        var p = st.panels[r][c];
        if (p.isGarbage && p.state !== 'normal') return true;
    }
    return false;
}
// THE SWAP'S OWN FIRST MATCH. The board is mid-break, so panels are in the air and
// matches happen without any swap; the one the swap makes is the first match that a
// run without it does not have.
function matches(stack, swap) {
    var server = !!stack.source, sim = server ? stack.copy() : P.cloneStack(stack), out = [];
    if (server && swap) { sim.curRow = swap[0]; sim.curCol = swap[1]; if (!sim.canSwap(swap[0], swap[1])) return null; }
    if (swap && !sim.tryQueueSwap(swap[0], swap[1])) return null;
    for (var f = 0; f < 20; f++) {
        var n = sim.events.length;
        sim.setInput({}); sim.run();
        for (var i = n; i < sim.events.length; i++) {
            var e = sim.events[i];
            if (e.type === 'match') out.push({ key: f + ':' + e.row + ':' + e.col + ':' + e.size, garbage: e.garbage });
        }
    }
    return out;
}
function firstOwnMatch(stack, swap, base) {
    var mine = matches(stack, swap);
    if (!mine) return null;
    var seen = {};
    base.forEach(function (e) { seen[e.key] = true; });
    for (var i = 0; i < mine.length; i++) if (!seen[mine[i].key]) return mine[i];
    return null;
}

var checked = 0, wrong = 0, lockedSeen = 0, boards = 0, onServer = 0;
// The stack the bot plays: panel-engine's own, or a pa-engine stack it reads through
// PA.view (rebuilt every frame).
function game(server, seed) {
    if (!server) { var st = new E.Stack({ level: 10, seed: seed }); return { st: st, view: function () { return st; } }; }
    var ld = PA.vsLevel(10).levelData;
    var pa = PA.create(10, new PA.Seeded(new GEN.GeneratorSource(seed, true, ld.colors, ld.adjacentDenialFrequency)));
    return { st: pa, view: function () { return PA.view(pa, E); } };
}
[false, true].forEach(function (server) {
    var seed = 1, g = game(server, seed), st = g.st;
    var bot = new BitBot(g.view(), { allowRaise: true, reaction: 12, seed: seed });
    for (var f = 0; f < 2500 && !st.gameOver && !(st.gameOverClock > 0); f++) {
        if (bench.burstFires(f)) st.receiveGarbage([{ width: sc.garbageWidth, height: sc.garbageHeight, isChain: false, isMetal: false, frameEarned: st.stopWatch, finalized: true }]);
        bot.stack = g.view();
        if (f % 15 === 0 && busyGarbage(st) && !st.swapQueued()) {
            var board = bot._snapshot();
            var m = bit.maskState(board.grid, board.blocks, W, board.height, board.motion);
            if (!m.bad) {
                boards++;
                for (var i = 0; i < m.slabLocked.length; i++) if (m.slabLocked[i]) lockedSeen++;
                var sw = bit.legalSwapsOf(m), base = matches(st, null);
                for (var s = 0; s < sw.length; s++) {
                    if (!bit.swapMasks(m, sw[s][0], sw[s][1])) continue;
                    var rz = bit.resolveFromMasks(m, false);
                    bit.swapMasks(m, sw[s][0], sw[s][1]);
                    if (!rz || rz.rounds < 1) continue;          // makes no match of its own
                    if (rz.rounds > 1 && rz.scope === 'garbage-broke') continue;   // a later link
                    var said = rz.scope === 'garbage-broke' && rz.rounds === 1;
                    var ev = firstOwnMatch(st, sw[s], base);
                    if (!ev) continue;
                    checked++;
                    if (server) onServer++;
                    if (said !== (ev.garbage > 0)) {
                        wrong++;
                        if (wrong <= 10) console.log('  ' + (server ? 'server' : 'engine') + ' seed ' + seed + ' f' + f + ' swap ' + sw[s].join('-') +
                                                     '  bot says ' + (said ? 'breaks' : 'clears') +
                                                     ', engine took ' + ev.garbage + ' garbage');
                    }
                }
            }
        }
        bot.update(); st.run();
        if (server) st.events.length = 0;
    }
});
console.log('breaklive: ' + boards + ' boards with garbage mid-break, ' + lockedSeen + ' locked slabs, ' +
            checked + ' first matches (' + onServer + ' on the server\'s rules), ' + wrong + ' disagree with the engine');
process.exit(wrong || !checked || !onServer || !lockedSeen ? 1 : 0);
