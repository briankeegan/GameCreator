#!/usr/bin/env node
// framesToTopOut AGAINST THE ENGINE ACTUALLY RUNNING.
//
// The break hold fires by this number. Play the drill with the bot to a frame, ask
// how long until the board tops out if the bot does nothing, then stop the bot and
// run the real stack -- with the queue it already has and no input -- until
// isToppedOut. The two must agree to the frame. Only boards with garbage queued or
// in the air are checked: that is the case the hold is for.
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var BitBot = require(path.join(__dirname, 'bitbot.js'));
var bench = require(path.join(__dirname, 'bench.js'));
var E = globalThis.PanelEngine;
var sc = bench.SCENARIOS.comboStorm;
var LIMIT = 4000, checked = 0, wrong = 0;
[1, 2, 3].forEach(function (seed) {
    var AT = [];
    for (var a = 151; a <= 6000; a += 23) AT.push(a);
    AT.forEach(function (at) {
        var st = new E.Stack({ level: 3, seed: seed });
        var bot = new BitBot(st, { allowRaise: true, reaction: 12, seed: seed });
        for (var f = 0; f < at; f++) {
            if (bench.burstFires(f)) st.receiveGarbage([{ width: sc.garbageWidth, height: sc.garbageHeight, isChain: false }]);
            bot.update(); st.run();
            if (st.gameOver) return;
        }
        if (st.isToppedOut()) return;
        if (!(st.incoming && st.incoming.length) && !st.hasFallingGarbage()) return;
        var said = bot.framesToTopOut(LIMIT);
        var n = 0;
        while (n < LIMIT && !st.isToppedOut() && !st.gameOver) { st.setInput({}); st.run(); n++; }
        checked++;
        if (said !== n) {
            wrong++;
            console.log('  seed ' + seed + ' f' + String(at).padStart(5) + '  predicted ' +
                        String(said).padStart(4) + '  engine ' + String(n).padStart(4));
        }
    });
});
console.log('topout: ' + checked + ' checks, ' + wrong + ' disagree with the engine');
process.exit(wrong || !checked ? 1 : 0);
