#!/usr/bin/env node
// BITBOT ON THE BURST DRILLS -- comboStorm, factory, bigBlocks.
//
//   GC_LEVEL=10 node drill.js [scenario...]
//
// bench.js measures the evaluator; this puts bitbot on the same scenarios, using
// bench's own SCENARIOS and burstFires so the drill is the drill and not a copy.
// One board, garbage arriving on a schedule, run to gameOver or the ceiling.
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var BitBot = require(path.join(__dirname, 'bitbot.js'));
var bench = require(path.join(__dirname, 'bench.js'));
var E = globalThis.PanelEngine;

var want = process.argv.slice(2);
if (!want.length) want = ['comboStorm', 'factory', 'bigBlocks'];
var SEEDS = [1, 2, 3, 4];

function play(name, seed) {
    var sc = bench.SCENARIOS[name];
    if (!sc) throw new Error('no scenario ' + name);
    var stack = new E.Stack({ level: sc.level, seed: seed });
    var bot = new BitBot(stack, { allowRaise: true, reaction: 12, seed: seed });
    var gar = 0, maxGar = 0, broke = 0, last = 0, sent = 0, f;
    for (f = 0; f < sc.ceiling; f++) {
        if (sc.burst && bench.burstFires(f)) {
            stack.receiveGarbage([{ width: sc.garbageWidth, height: sc.garbageHeight,
                                    isChain: false }]);
        }
        bot.update();
        stack.run();
        var out = stack.takeDeliverableGarbage();
        if (out) for (var i = 0; i < out.length; i++) sent += out[i].width * out[i].height;
        gar = 0;
        for (var r = 1; r < stack.panels.length; r++) {
            for (var c = 1; c <= 6; c++) {
                var p = stack.panels[r] && stack.panels[r][c];
                if (p && p.isGarbage) gar++;
            }
        }
        if (gar > maxGar) maxGar = gar;
        if (last && gar < last) broke += last - gar;
        last = gar;
        if (stack.gameOver) break;
    }
    return { frames: f, died: !!stack.gameOver, ceiling: sc.ceiling,
             broke: broke, sent: sent, maxGar: maxGar };
}

var bad = 0;
want.forEach(function (name) {
    SEEDS.forEach(function (seed) {
        var r = play(name, seed);
        if (r.died) bad++;
        console.log('  ' + name.padEnd(11) + ' seed ' + seed + '  ' +
                    (r.died ? 'DIED@' + r.frames : 'survived ' + r.frames) +
                    ' / ' + r.ceiling +
                    '   broke ' + r.broke + '   sent ' + r.sent +
                    '   peak garbage ' + r.maxGar);
    });
});
console.log('drill: ' + bad + ' deaths over ' + (want.length * SEEDS.length) + ' runs');
process.exit(bad ? 1 : 0);
