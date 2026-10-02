#!/usr/bin/env node
// A TOPPED-OUT BOARD IS KEPT BUSY, NOT CHANGED.
//
//   node survivor_busy.test.js
//
// On a board slabs keep topped out health is never given back, and every
// frame with nothing active spends it. Hands.idle (survivor_shared.js) spends
// such a frame toward swapping two panels of one colour side by side. From
// real boards (the Lua record) buried under two 6x12 slabs till they lie
// quiet: busyPair finds a pair of one colour; thirty frames of Hands.idle
// lose less health than thirty frames of nothing and leave every colour
// where it was; and with stop time in hand there is nothing to keep busy.
var fs = require('fs'), path = require('path'), assert = require('assert');
var DIR = __dirname, PA = require(path.join(DIR, 'pa-engine.js')), SH = require(path.join(DIR, 'survivor_shared.js'));
var lines = require('zlib').gunzipSync(fs.readFileSync(path.join(DIR, 'pa.record.jsonl.gz'))).toString('utf8').trim().split('\n');
var level = null, boards = [], n = 0;
lines.forEach(function (l) {
  var x = JSON.parse(l);
  if (x.levelData) level = { levelData: x.levelData, behaviours: x.behaviours, stackOverConditions: x.stackOverConditions };
  if (!x.state) return;
  var st = x.state.stack;
  if (st.stopWatchIsRunning && !st.in_countdown && st.clock > 190 && n++ % 11 === 4 && boards.length < 60) boards.push(PA.fromLua(x.state, level, new PA.Unseen()));
});
function frame(b, bits) { b.setInput(bits & ~PA.IN.swap); if (bits & PA.IN.swap) b.pressSwap = true; b.run(); }
function colours(b) {
  return b.panels.map(function (row) { return row ? row.slice(1, 7).map(function (p) { return p && p.color ? (p.isGarbage ? 'G' : p.color) : 0; }).join('') : ''; }).join('/');
}
function buried(b) {
  // The record's level has one frame of health; a slab-fed drill's has more.
  b.levelData = Object.assign({}, b.levelData, { maxHealth: 121 }); b.health = 121;
  b.receiveGarbage([{ width: 6, height: 12, isChain: true }, { width: 6, height: 12, isChain: true }]);
  for (var i = 0; i < 3000 && b.gameOverClock <= 0; i++) {
    frame(b, 0);
    if (b.isToppedOut() && !b.stopTime && !b.preStopTime && !b.shakeTime && !b.riseLock && b.health < 121 && b.health > 40) return b;   // draining
  }
  return null;
}
var hands = new SH.Hands(SH.profile()), tried = 0, checked = 0;
for (var k = 0; k < boards.length && checked < 5; k++) {
  var b = buried(boards[k]); tried++;
  if (!b || !SH.busyPair(b)) continue;
  var m = SH.busyPair(b), p = b.panels[m[0]];
  assert.strictEqual(p[m[1]].color, p[m[1] + 1].color, 'busyPair chose two colours');
  var stopped = b.copy(); stopped.stopTime = 10;
  assert.strictEqual(SH.busyPair(stopped), null, 'a board with stop time in hand was kept busy');
  var idle = b.copy(), busy = b.copy(), hold = { left: 0, started: false }, before = colours(b);
  for (var f = 0; f < 30; f++) {
    frame(idle, 0);
    var id = hands.idle(busy, hold, []); hold = id.hold; frame(busy, id.bits);
  }
  assert(busy.health > idle.health, 'busy frames lost as much health as idle ones (' + busy.health + ' vs ' + idle.health + ')');
  assert.strictEqual(colours(busy), before, 'keeping busy moved a colour');
  checked++;
}
assert(checked >= 3, 'only ' + checked + ' of ' + tried + ' buried boards had a pair to keep busy with');
console.log('ok: ' + checked + ' buried boards kept busy: less health spent than idle, every colour where it was');
