#!/usr/bin/env node
// A LANDING THE LINEUP SAYS BREAKS, BREAKS -- AND ONE IT SAYS DOES NOT, DOES NOT.
//
// Topped out, the bot lines up only a landing that breaks the slab above, and holds
// still when standing still is that landing, so bitlineup's outcome of the converting
// window is the whole decision -- and it is bit logic, with nothing run. Checked against
// the engine on real mid-break boards: play bigBlocks with the bot, and wherever a row
// is converting, take bitlineup's outcome of standing still, and run a copy of the engine
// with no input and nothing more to drop until the landing has settled. Whether either
// breaks garbage must agree on every board. Played twice: on panel-engine.js, and on the
// server's rules (pa-engine.js, the bot reading it through PA.view).
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var BitBot = require(path.join(__dirname, 'bitbot.js'));
var lineup = require(path.join(__dirname, 'bitlineup.js'));
var P = require(path.join(__dirname, 'puyocpu.js'));
var bench = require(path.join(__dirname, 'bench.js'));
var PA = require(path.join(__dirname, 'pa-engine.js')), GEN = require(path.join(__dirname, 'pa-generator.js'));
var E = globalThis.PanelEngine, sc = bench.SCENARIOS.bigBlocks;
var agree = 0, wrong = 0, broke = 0, onServer = 0;
[false, true].forEach(function (server) {
    var st, view;
    if (server) {
        var ld = PA.vsLevel(3).levelData;
        st = PA.create(3, new PA.Seeded(new GEN.GeneratorSource(1, true, ld.colors, ld.adjacentDenialFrequency)));
        view = function () { return PA.view(st, E); };
    } else {
        st = new E.Stack({ level: 3, seed: 1 });
        view = function () { return st; };
    }
    var bot = new BitBot(view(), { allowRaise: true, reaction: 12, seed: 1 });
    for (var f = 0; f < 4000 && !st.gameOver && !(st.gameOverClock > 0); f++) {
        if (bench.burstFires(f)) st.receiveGarbage([{ width: sc.garbageWidth, height: sc.garbageHeight, isChain: false, isMetal: false, frameEarned: st.stopWatch, finalized: true }]);
        bot.stack = view();
        if (f % 25 === 0 && !st.swapQueued()) {
            var snap = bot._snapshot();
            if (lineup.converting(snap)) {
                var plan = lineup.bestInWindow(snap, bot.stack.frames, snap.height, [st.curRow, st.curCol], snap.legalSwaps());
                var said = plan && plan.doNothing;
                var sim = server ? st.copy() : P.cloneStack(st), engBroke = false, quiet = 0;
                sim.incoming = [];
                for (var n = 0; n < 2000 && !engBroke && quiet < 3; n++) {
                    var k = sim.events.length;
                    sim.setInput(server ? 0 : {}); sim.run();
                    for (var i = k; i < sim.events.length; i++) {
                        if (sim.events[i].type === 'match' && sim.events[i].garbage > 0) engBroke = true;
                    }
                    quiet = sim.hasActivePanels() || sim.hasFallingGarbage() ? 0 : quiet + 1;
                }
                var saidBroke = !!(said && said.scope === 'garbage-broke');
                if (saidBroke) broke++;
                if (server) onServer++;
                if (saidBroke === engBroke) agree++;
                else {
                    wrong++;
                    if (wrong <= 5) console.log('  ' + (server ? 'server' : 'engine') + ' f' + f + '  bitlineup ' + (saidBroke ? 'breaks' : 'does not break') +
                                                ', engine ' + (engBroke ? 'breaks' : 'does not'));
                }
            }
        }
        bot.update(); st.run();
        if (st.events.length > 500) st.events.length = 0;
    }
});
console.log('landing: ' + (agree + wrong) + ' windows (' + onServer + ' on the server\'s rules), ' + broke + ' landings that break, ' +
            wrong + ' disagree with the engine');
process.exit(wrong || !broke || !onServer ? 1 : 0);
