#!/usr/bin/env node
var path = require('path'), fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var BitBot = require(path.join(__dirname, process.env.GC_BOT || 'bitbot.js'));
var bench = require(path.join(__dirname, 'bench.js'));
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), GEN = require(path.join(__dirname, '..', '..', 'pa-generator.js'));
var E = globalThis.PanelEngine;

var name = process.argv[2], seed = Number(process.argv[3] || 1), sc = bench.SCENARIOS[name];
if (!sc) { console.error('pa_drill: no scenario ' + name); process.exit(2); }
if (sc.level !== 10) { console.error('pa_drill: drills run at level 10 only, not ' + sc.level + ' (unset GC_LEVEL)'); process.exit(2); }
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
  if (BREAKS[d.via] && !watch) watch = { f: f, via: d.via, kind: d.kind, move: d.move || d.park || null, until: f + MISS_WINDOW,
                                         state: dumpDir ? JSON.stringify(pa) : null };
  var ms = Number(process.hrtime.bigint() - t0) / 1e6;
  via[d.via] = (via[d.via] || 0) + 1;
  if (pa.clock >= trace) {
    var L = bot.lastLog;
    if (!L) {
      var pool = bot._lastPool || [], ob = bot._lastOptions, pb = [], lb = [];
      for (var i = 0; i < pool.length; i++) if (pool[i].kind === 'swap' && pool[i].resolved && pool[i].resolved.brokeGarbage) pb.push(pool[i].swap);
      if (ob) ob.now.concat(ob.next).forEach(function (o) { if (o.breaks && o.swaps.length) lb.push(o); });
      L = { poolBreaks: pb.length, firstBreak: pb[0] || null, built: !!ob, lines: lb.length, line: lb.length ? lb[0].swaps : null,
            spend: lb.length ? bot.planSpend(lb[0].swaps, bot._lastBase, bot._lastInfo) : 0 };
    }
    var lbest = L.line ? JSON.stringify(L.line) + ' spend ' + L.spend : '-';
    out('D ' + f + ' ' + d.kind + ' ' + d.via + ' ' + JSON.stringify(d.move || d.park || null) +
        ' | breaks ' + L.poolBreaks + ' ' + (L.firstBreak ? JSON.stringify(L.firstBreak) : '-') +
        ' | lines ' + (L.built ? L.lines : 'unbuilt') + ' ' + lbest + ' | ms ' + ms.toFixed(1) + (L.work ? ' | work ' + L.work.join(' ') : ''));
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
// GC_TAPE_OUT=file records every frame's input; GC_TAPE_IN=file with
// GC_TAKEOVER=frame plays those inputs back and hands the board to the bot at
// that frame, so a change is tried on the exact board an earlier bot reached.
var tapeOut = process.env.GC_TAPE_OUT ? new Int32Array(2 * frames) : null;
var tapeIn = process.env.GC_TAPE_IN ? new Int32Array(fs.readFileSync(process.env.GC_TAPE_IN).buffer.slice(0)) : null;
var takeover = Number(process.env.GC_TAKEOVER || 0);
process.on('exit', function () { if (tapeOut) fs.writeFileSync(process.env.GC_TAPE_OUT, Buffer.from(tapeOut.buffer, 0, 8 * f)); });
for (var f = 0; f < frames; f++) {
  if (sc.burst && pa.stopWatchIsRunning && bench.burstFires(pa.stopWatch)) {
    pa.receiveGarbage([{ width: sc.garbageWidth, height: sc.garbageHeight, isChain: false, isMetal: false, frameEarned: pa.stopWatch, finalized: true }]);
  }
  if (tapeIn && f < takeover) {
    pa.nextInput = tapeIn[2 * f]; pa.pressSwap = !!tapeIn[2 * f + 1];
  } else {
    bot.stack = PA.view(pa, E);
    bot.update();
  }
  if (tapeOut) { tapeOut[2 * f] = pa.nextInput; tapeOut[2 * f + 1] = pa.pressSwap ? 1 : 0; }
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
