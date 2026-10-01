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

// Names pick scenarios, numbers pick seeds, so `drill.js comboStorm 3` runs the one
// failure being worked on and nothing else.
var args = process.argv.slice(2);
var want = args.filter(function (a) { return !/^[0-9]+$/.test(a); });
var SEEDS = args.filter(function (a) { return /^[0-9]+$/.test(a); }).map(Number);
if (!want.length) want = ['comboStorm', 'factory', 'bigBlocks'];
if (!SEEDS.length) SEEDS = [1, 2, 3, 4];

function play(name, seed) {
    var sc = bench.SCENARIOS[name];
    if (!sc) throw new Error('no scenario ' + name);
    var stack = new E.Stack({ level: sc.level, seed: seed });
    var bot = new BitBot(stack, { allowRaise: true, reaction: 12, seed: seed });
    // THE LAST DECISIONS, the way roundrobin keeps them: a drill death is read the
    // same way a duel death is, and the mistake that kills is made long before it.
    var ring = [];
    var bit = require(path.join(__dirname, 'bitmatch.js'));
    var realDecide = bot.decide.bind(bot);
    bot.decide = function () {
        var d = realDecide();
        var m = bot._lastBase;
        var cols = [], gcells = 0, tall = 0, clears = 0, breaks = 0;
        if (m) {
            for (var c = 1; c <= 6; c++) {
                var g = m.garb[c] >>> 0, fl = g ? (g & -g) : 0, bel = fl ? (fl - 1) : 0xffffffff;
                var h = 0, mm = (m.occ[c] & ~g & bel) >>> 0;
                while (mm) { h += mm & 1; mm >>>= 1; }
                cols.push(h);
                var gg = g; while (gg) { gcells += gg & 1; gg >>>= 1; }
                var t = 32 - Math.clz32(m.occ[c] >>> 0); if (t > tall) tall = t;
            }
            var sw = bit.legalSwapsOf(m);
            for (var i = 0; i < sw.length; i++) {
                if (!bit.swapMasks(m, sw[i][0], sw[i][1])) continue;
                var rz = bit.resolveFromMasks(m, true);
                bit.swapMasks(m, sw[i][0], sw[i][1]);
                if (rz.scope === 'garbage-broke') breaks++;
                if (rz.total > 0 || rz.scope === 'garbage-broke') clears++;
            }
        }
        ring.push({ f: stack.clock, via: d && d.via, mode: d && d.mode && d.mode.name,
                    mv: d && d.move ? d.move.join('-') : (d && d.kind),
                    cols: cols.join(','), gar: gcells, tall: tall,
                    clears: clears, breaks: breaks,
                    queued: stack.incoming ? stack.incoming.length : 0 });
        if (ring.length > 30) ring.shift();
        return d;
    };
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
             broke: broke, sent: sent, maxGar: maxGar, stack: stack, bot: bot, ring: ring,
             queued: stack.incoming ? stack.incoming.length : 0 };
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
                    '   peak garbage ' + r.maxGar +
                    '   still queued ' + r.queued);
        // THE BOARD IT DIED ON, and how much was still waiting to land on it. A drill
        // death is read the same way a duel death is.
        if (r.died && process.env.GC_DRILL_BOARD) {
            console.log('   frame mode    via           tall gar queued cols         ' +
                        ' move  clears breaks');
            r.ring.forEach(function (x) {
                console.log('  ' + String(x.f).padStart(6) + ' ' +
                            String(x.mode).padEnd(7) + ' ' + String(x.via).padEnd(13) +
                            String(x.tall).padStart(4) + String(x.gar).padStart(4) +
                            String(x.queued).padStart(7) + '  ' + x.cols.padEnd(13) +
                            String(x.mv).padStart(6) + String(x.clears).padStart(7) +
                            String(x.breaks).padStart(7));
            });
            var st = r.stack;
            for (var rr = 12; rr >= 1; rr--) {
                var line = '  r' + String(rr).padStart(2) + ' ';
                for (var cc = 1; cc <= 6; cc++) {
                    var p = st.panelAt(rr, cc);
                    line += !p || p.color === 0 ? ' . ' : (p.isGarbage ? '[#]' : ' ' + p.color + ' ');
                }
                console.log(line);
            }
        }
    });
});
console.log('drill: ' + bad + ' deaths over ' + (want.length * SEEDS.length) + ' runs');
process.exit(bad ? 1 : 0);
