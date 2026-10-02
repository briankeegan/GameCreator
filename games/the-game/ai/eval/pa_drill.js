#!/usr/bin/env node
// A DRILL ON THE SERVER'S RULES: BitBot playing bench.js's scenario on
// pa-engine.js, its rows and garbage colours dealt by the server's generator
// from the seed.
//
//   node pa_drill.js SCENARIO SEED [FRAMES]     (FRAMES defaults to the scenario's ceiling)
//
// The bot reads the board through PA.view, a panel-engine board rebuilt every
// frame, and its input and swaps go to the pa-engine stack. Garbage arrives
// as bench.js sends it: on a burst frame, straight into the queue.
//
// One line every 250 frames and one at the end, written as they happen:
//   f<frame> panels <n> garb <n> top <0|1> {<decision kinds since the last line>}
//   died <frame>  |  alive <frame>
//   MISS <frame> <via> <kind> <move> -- a decision that counted on a break (break,
//     breakReach, breakSpend, awaitLanding) and saw the engine break nothing in the
//     next MISS_WINDOW frames: the bit engine predicted something pa-engine did not
//     do. The stack as it was at that decision is written to GC_DUMP/<scenario><seed>
//     .<frame>.json (PA.revive reads it), so a miss is checked without a replay.
//
// And every frame's board and every decision, from the first frame, so a
// death is read off the run that died -- never a replay. GC_TRACE=<frame>
// starts them later instead, for a run whose early frames are not wanted:
//   F <frame> stop <n> shake <n> health <n> disp <n> cur <r>,<c> queue <w>x<h>,... | <row 12> ... <row 1>
//   D <frame> <kind> <via> <move> | breaks <n> <best> | lines <n> <best break line>
//     breaks: the one-swap breaks in the decision's pool, and the first of them;
//     lines: the multi-swap breaks its option list held (when it built one), and
//     the first, with what planSpend prices it at. What it COULD have done is in
//     the log beside what it did, so a death is read off the run; ms: what the
//     decision took, which a live match has 16.7 of per frame.
// A cell is its colour digit, '.' empty, 'g' garbage; upper-case X is a cell in motion.
var path = require('path'), fs = require('fs');
// LEVEL 10, the level the server is played at (one health), unless GC_LEVEL says
// otherwise; bench.js reads it when it is loaded.
if (!process.env.GC_LEVEL) process.env.GC_LEVEL = '10';
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var BitBot = require(path.join(__dirname, 'bitbot.js'));
var bench = require(path.join(__dirname, 'bench.js'));
var PA = require(path.join(__dirname, 'pa-engine.js')), GEN = require(path.join(__dirname, 'pa-generator.js'));
var E = globalThis.PanelEngine;

var name = process.argv[2], seed = Number(process.argv[3] || 1), sc = bench.SCENARIOS[name];
if (!sc) { console.error('pa_drill: no scenario ' + name); process.exit(2); }
var frames = Number(process.argv[4] || sc.ceiling);
var ld = PA.vsLevel(sc.level).levelData;
var pa = PA.create(sc.level, new PA.Seeded(new GEN.GeneratorSource(seed, true, ld.colors, ld.adjacentDenialFrequency)));
var bot = new BitBot(PA.view(pa, E), { allowRaise: true, reaction: 12, seed: seed });
var trace = process.env.GC_TRACE ? Number(process.env.GC_TRACE) : 0;
var via = {}, decide = bot.decide.bind(bot);
var MISS_WINDOW = 240, watch = null, dumpDir = process.env.GC_DUMP || null;
var BREAKS = { break: 1, breakReach: 1, breakSpend: 1, awaitLanding: 1 };
bot.decide = function () {
  var t0 = process.hrtime.bigint();
  var d = decide();
  // The board the decision read: deciding sets only the next input, never the board.
  if (BREAKS[d.via] && !watch) watch = { f: f, via: d.via, kind: d.kind, move: d.move || d.park || null, until: f + MISS_WINDOW,
                                         state: dumpDir ? JSON.stringify(pa) : null };
  var ms = Number(process.hrtime.bigint() - t0) / 1e6;
  via[d.via] = (via[d.via] || 0) + 1;
  if (pa.clock >= trace) {
    var pool = bot._lastPool || [], ob = bot._lastOptions, pb = [], lb = [];
    for (var i = 0; i < pool.length; i++) if (pool[i].kind === 'swap' && pool[i].resolved && pool[i].resolved.brokeGarbage) pb.push(pool[i].swap);
    if (ob) ob.now.concat(ob.next).forEach(function (o) { if (o.breaks && o.swaps.length) lb.push(o); });
    var lbest = lb.length ? JSON.stringify(lb[0].swaps) + ' spend ' + bot.planSpend(lb[0].swaps, bot._lastBase, bot._lastInfo) : '-';
    out('D ' + f + ' ' + d.kind + ' ' + d.via + ' ' + JSON.stringify(d.move || d.park || null) +
        ' | breaks ' + pb.length + ' ' + (pb.length ? JSON.stringify(pb[0]) : '-') +
        ' | lines ' + (ob ? lb.length : 'unbuilt') + ' ' + lbest + ' | ms ' + ms.toFixed(1));
  }
  return d;
};
function board() {
  var rows = [];
  for (var r = Math.min(pa.panels.length - 1, 13); r >= 0; r--) {
    var t = '';
    for (var c = 1; c <= 6; c++) {
      var q = pa.panels[r][c], ch = q.isGarbage ? 'g' : q.color ? String(q.color % 10) : '.';
      if (q.color && q.state !== 'normal' && q.state !== 'dimmed') ch = q.isGarbage ? 'G' : 'X';
      t += ch;
    }
    rows.push(t);
  }
  return rows.join(' ');
}
function out(s) { fs.writeSync(1, s + '\n'); }
function cells() {
  var p = 0, g = 0;
  for (var r = 1; r < pa.panels.length; r++) for (var c = 1; c <= 6; c++) {
    var q = pa.panels[r][c];
    if (q.color) { if (q.isGarbage) g++; else p++; }
  }
  return 'panels ' + p + ' garb ' + g;
}
for (var f = 0; f < frames; f++) {
  if (sc.burst && bench.burstFires(f)) {
    pa.receiveGarbage([{ width: sc.garbageWidth, height: sc.garbageHeight, isChain: false, isMetal: false, frameEarned: pa.stopWatch, finalized: true }]);
  }
  bot.stack = PA.view(pa, E);
  bot.update();
  pa.run();
  if (watch) {
    for (var ei = 0; ei < pa.events.length; ei++) if (pa.events[ei].type === 'match' && pa.events[ei].garbage > 0) { watch = null; break; }
    if (watch && f >= watch.until) {
      out('MISS ' + watch.f + ' ' + watch.via + ' ' + watch.kind + ' ' + JSON.stringify(watch.move));
      if (dumpDir) fs.writeFileSync(path.join(dumpDir, name + seed + '.' + watch.f + '.json'), watch.state);
      watch = null;
    }
  }
  pa.events.length = 0;
  if (pa.clock >= trace) {
    out('F ' + f + ' stop ' + pa.stopTime + ' shake ' + pa.shakeTime + ' health ' + pa.health + ' disp ' + pa.displacement + ' cur ' + pa.curRow + ',' + pa.curCol +
        ' queue ' + pa.incoming.map(function (g) { return g.width + 'x' + g.height; }).join(',') + ' | ' + board());
  }
  var dead = pa.gameOverClock > 0;
  if (f % 250 === 0 || dead) { out('f' + f + ' ' + cells() + ' top ' + (pa.isToppedOut() ? 1 : 0) + ' ' + JSON.stringify(via)); via = {}; }
  if (dead) { out('died ' + f); process.exit(1); }
}
out('alive ' + f);
