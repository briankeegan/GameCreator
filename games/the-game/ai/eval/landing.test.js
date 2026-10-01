#!/usr/bin/env node
// A LANDING THE LINEUP SAYS BREAKS, BREAKS -- AND ONE IT SAYS DOES NOT, DOES NOT.
//
// Topped out, the bot lines up only a landing that breaks the slab above, and holds
// still when standing still is that landing, so bitframes' run of the in-flight board
// is the whole decision. Checked against the engine on real mid-break boards: play
// bigBlocks with the bot, and wherever a reveal window is open, run bitframes with no
// input and a copy of the engine for as many frames, and compare whether either
// breaks garbage. They must agree on every board.
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var BitBot = require(path.join(__dirname, 'bitbot.js'));
var lineup = require(path.join(__dirname, 'bitlineup.js'));
var P = require(path.join(__dirname, 'puyocpu.js'));
var bench = require(path.join(__dirname, 'bench.js'));
var E = globalThis.PanelEngine, sc = bench.SCENARIOS.bigBlocks;
var st = new E.Stack({ level: 3, seed: 1 });
var bot = new BitBot(st, { allowRaise: true, reaction: 12, seed: 1 });
var agree = 0, wrong = 0, broke = 0;
for (var f = 0; f < 9000 && !st.gameOver; f++) {
    if (bench.burstFires(f)) st.receiveGarbage([{ width: sc.garbageWidth, height: sc.garbageHeight, isChain: false }]);
    if (f % 10 === 0 && !st.swapQueued()) {
        var snap = bot._snapshot();
        if (lineup.revealed(snap, snap.height).open) {
            var said = lineup.play(snap, st.frames, snap.height, null, 0);
            var sim = P.cloneStack(st), engBroke = false;
            var lim = said ? said.frames + 2 : 1500;
            for (var n = 0; n < lim && !engBroke; n++) {
                var k = sim.events.length;
                sim.setInput({}); sim.run();
                for (var i = k; i < sim.events.length; i++) {
                    if (sim.events[i].type === 'match' && sim.events[i].garbage > 0) engBroke = true;
                }
            }
            var saidBroke = !!(said && said.scope === 'garbage-broke');
            if (saidBroke) broke++;
            if (saidBroke === engBroke) agree++;
            else {
                wrong++;
                if (wrong <= 5) console.log('  f' + f + '  bitframes ' + (saidBroke ? 'breaks' : 'does not break') +
                                            ', engine ' + (engBroke ? 'breaks' : 'does not'));
            }
        }
    }
    bot.update(); st.run();
    if (st.events.length > 500) st.events.length = 0;
}
console.log('landing: ' + (agree + wrong) + ' reveal windows, ' + broke + ' landings that break, ' +
            wrong + ' disagree with the engine');
process.exit(wrong || !broke ? 1 : 0);
