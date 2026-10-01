#!/usr/bin/env node
// framesToTopOut AGAINST THE ENGINE ACTUALLY RUNNING.
//
// The break hold fires by these numbers. Play the drill with the bot, and at each
// sample frame ask when the board tops out and when health would first fall if the
// bot does nothing. The answer is checked on a real Stack: the bot's inputs are
// recorded and replayed onto a fresh one with the same seed up to that frame, which
// is then run with the queue it has and no input. Both numbers must agree to the
// frame. Only boards with garbage queued or in the air are checked: that is the case
// the hold is for.
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var BitBot = require(path.join(__dirname, 'bitbot.js'));
var bench = require(path.join(__dirname, 'bench.js'));
var E = globalThis.PanelEngine;
var sc = bench.SCENARIOS.comboStorm;
var LIMIT = 4000, END = 6000, EVERY = 23, checked = 0, wrong = 0;

function slab(st) { st.receiveGarbage([{ width: sc.garbageWidth, height: sc.garbageHeight, isChain: false }]); }

[1, 2, 3].forEach(function (seed) {
    var st = new E.Stack({ level: 3, seed: seed });
    var bot = new BitBot(st, { allowRaise: true, reaction: 12, seed: seed });
    // every call the bot makes on the stack, frame by frame
    var log = [], calls = null;
    var setInput = st.setInput, tryQueueSwap = st.tryQueueSwap;
    st.setInput = function (i) { calls.push(['i', Object.assign({}, i)]); return setInput.call(st, i); };
    st.tryQueueSwap = function (r, c) { calls.push(['s', r, c]); return tryQueueSwap.call(st, r, c); };
    var asked = [];
    for (var f = 0; f < END && !st.gameOver; f++) {
        if (bench.burstFires(f)) slab(st);
        if (f > 150 && f % EVERY === 0 && !st.isToppedOut() &&
            ((st.incoming && st.incoming.length) || st.hasFallingGarbage())) {
            asked.push({ at: f, said: bot.framesToTopOut(LIMIT) });
        }
        calls = [];
        bot.update(); st.run();
        log.push(calls);
    }
    asked.forEach(function (q) {
        var re = new E.Stack({ level: 3, seed: seed });
        for (var g = 0; g < q.at; g++) {
            if (bench.burstFires(g)) slab(re);
            log[g].forEach(function (k) { if (k[0] === 'i') re.setInput(k[1]); else re.tryQueueSwap(k[1], k[2]); });
            re.run();
        }
        if (bench.burstFires(q.at)) slab(re);
        var n = 0, top = LIMIT, drain = LIMIT, hp = re.health;
        while (n < LIMIT && !re.gameOver) {
            if (top === LIMIT && re.isToppedOut()) top = n;
            re.setInput({}); re.run();
            if (re.health < hp || re.gameOver) { drain = n; top = Math.min(top, n); break; }
            hp = re.health; n++;
        }
        checked++;
        if (q.said.top !== top || q.said.drain !== drain) {
            wrong++;
            console.log('  seed ' + seed + ' f' + String(q.at).padStart(5) + '  predicted top ' +
                        q.said.top + ' drain ' + q.said.drain + '  engine top ' + top + ' drain ' + drain);
        }
    });
});
console.log('topout: ' + checked + ' checks, ' + wrong + ' disagree with the engine');
process.exit(wrong || !checked ? 1 : 0);
