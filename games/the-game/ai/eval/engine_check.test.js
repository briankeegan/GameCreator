#!/usr/bin/env node
// THE SEARCH ON THE FAST ENGINE, CHECKED STEP BY STEP. Run: node engine_check.test.js [FRAMES]
//
// With engineCheck every step the survival search takes is played on both
// engines -- faststack.js and panel-engine.js -- and the first difference in
// the board, the time, the raise in hand, the garbage in flight or what the
// search reads off the board throws (_engineAdvance in puyocpu.js). This runs
// that check where the search goes deep: the frozen board of
// brain.fixture.json, on one thread and on two (the workers check their own
// steps), then a duel of FRAMES frames. It fails if a step differs, and if
// fewer steps were checked than a real search takes, so a check that stopped
// running cannot pass.
var fs = require('fs'), path = require('path'), assert = require('assert');
var DIR = __dirname;
require(path.join(DIR, '..', '..', 'panel-engine.js'));
require(path.join(DIR, '..', '..', 'panel-cpu.js'));
var P = require(path.join(DIR, 'puyocpu.js')), E = globalThis.PanelEngine;
var FRAMES = Number(process.argv[2] || 600);
var W = ['trained.pbt.pbt-r22-s322.0926-142336.g03120.json', 'trained.pbt.pbt-r01-s301.0926-142244.g00560.json']
  .map(function (f) { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).weights; });
function opts(i, threads) {
  return { weights: W[i], reaction: 12, depth: 2, beam: 0, rise: true, allowRaise: true, modes: true, engine: true,
           engineCheck: true, threads: threads || 0 };
}
var fx = JSON.parse(fs.readFileSync(path.join(DIR, 'brain.fixture.json'), 'utf8'));
function dec(e) { return P.decodeStack({ meta: e.meta, rows: e.rows, row0: e.row0, buf: Int32Array.from(e.buf) }); }
[0, 2].forEach(function (threads) {
  var b = new P(dec(fx.me), opts(1, threads));
  b.opponent = dec(fx.opp); b.raiseFrames = fx.raiseFrames; b._raiseStarted = fx.raiseStarted; b._predArr = fx.arrivals;
  b._decide();
  // One thread: 9,500 steps on this board. On two the workers check theirs
  // and the main thread checks the ones it takes itself.
  if (!threads) assert.ok(b.engineChecks > 5000, 'only ' + b.engineChecks + ' steps were checked');
  console.log('ok: the deep search on ' + (threads || 1) + ' thread(s), ' + (b.engineChecks || 0) + ' steps checked here');
});

var st = [0, 1].map(function () { return new E.Stack({ level: 10, seed: 703, countdown: false }); });
var cp = [0, 1].map(function (i) { return new P(st[i], opts(i, 0)); });
cp[0].opponent = st[1]; cp[1].opponent = st[0];
for (var f = 0; f < FRAMES && !st[0].gameOver && !st[1].gameOver; f++) {
  cp[0].update(); cp[1].update(); st[0].run(); st[1].run();
  for (var i = 0; i < 2; i++) {
    var o = st[i].takeDeliverableGarbage();
    if (o.length) st[i ^ 1].receiveGarbage(o);
    st[i].drainEvents();
  }
}
var checked = cp[0].engineChecks + cp[1].engineChecks;
assert.ok(checked > FRAMES, 'only ' + checked + ' steps were checked in ' + f + ' frames of a duel');
console.log('ok: ' + f + ' frames of a duel, ' + checked + ' search steps identical on both engines');
P.closePools();
process.exit(0);
