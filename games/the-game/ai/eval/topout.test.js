#!/usr/bin/env node
// framesToTopOut AGAINST THE ENGINE ACTUALLY RUNNING.
//
// The hold fires the break by this number, so it is checked the way the deadline is:
// play the drill with the bot to a frame, ask the bot how long until row 12 fills if
// it does nothing, then stop the bot and run the real engine -- garbage schedule and
// all -- until isToppedOut. The prediction must never be LONGER than what happens:
// that is the direction that kills.
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var BitBot = require(path.join(__dirname, 'bitbot.js'));
var bench = require(path.join(__dirname, 'bench.js'));
var E = globalThis.PanelEngine;
var sc = bench.SCENARIOS.comboStorm;
var checked = 0, over = 0, worst = 0, sumGap = 0;
var AT = []; for (var a = 160; a <= 6000; a += 37) AT.push(a);
AT.forEach(function (at) {
    [1, 2, 3].forEach(function (seed) {
        var st = new E.Stack({ level: 3, seed: seed });
        var bot = new BitBot(st, { allowRaise: true, reaction: 12, seed: seed });
        var f, dead = false;
        for (f = 0; f < at; f++) {
            if (bench.burstFires(f)) st.receiveGarbage([{ width: 4, height: 1, isChain: false }]);
            bot.update(); st.run();
            if (st.gameOver) { dead = true; break; }
        }
        if (dead || st.isToppedOut()) return;
        // only meaningful on a calm board with garbage still to come -- the case the
        // hold is for
        if (!(st.incoming && st.incoming.length) || st.hasActivePanels()) return;
        var info = bot.info(bot._snapshot());
        var tall = 0;
        for (var r = 1; r < st.panels.length; r++)
            for (var c = 1; c <= 6; c++) {
                var p = st.panels[r][c];
                if (p && p.color !== 0 && !(p.isGarbage && p.state === 'falling') && r > tall) tall = r;
            }
        var said = bot.framesToTopOut(tall, info);
        var n = 0;
        while (!st.isToppedOut() && n < 4000) {
            if (bench.burstFires(f + n)) st.receiveGarbage([{ width: 4, height: 1, isChain: false }]);
            st.setInput({}); st.run(); n++;
        }
        checked++;
        sumGap += n - said;
        if (said > n + 1) { over++; if (said - n > worst) worst = said - n; }
        if (said !== n) console.log('  seed ' + seed + ' f' + String(at).padStart(5) + '  predicted ' +
                    String(said).padStart(4) + '  engine ' + String(n).padStart(4));
    });
});
console.log('topout: ' + checked + ' checks, ' + over + ' predicted LONGER than the engine' +
            (over ? ' (worst by ' + worst + ')' : '') +
            ', mean gap ' + (checked ? (sumGap / checked).toFixed(1) : '-') + ' frames short');
process.exit(over ? 1 : 0);
