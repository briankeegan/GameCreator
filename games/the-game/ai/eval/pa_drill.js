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
//
// GC_TRACE=<frame> also writes, from that frame on, every frame's board and
// every decision (the run is the same run every time from the same seed):
//   F <frame> stop <n> shake <n> health <n> disp <n> cur <r>,<c> queue <w>x<h>,... | <row 12> ... <row 1>
//   D <frame> <kind> <via> <move>
// A cell is its colour digit, '.' empty, 'g' garbage; upper-case X is a cell in motion.
var path = require('path'), fs = require('fs');
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
var trace = process.env.GC_TRACE ? Number(process.env.GC_TRACE) : Infinity;
var via = {}, decide = bot.decide.bind(bot);
bot.decide = function () {
  var d = decide();
  via[d.via] = (via[d.via] || 0) + 1;
  if (pa.clock >= trace) out('D ' + f + ' ' + d.kind + ' ' + d.via + ' ' + JSON.stringify(d.move || d.park || null));
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
