#!/usr/bin/env node
// PANELS TO WORK WITH (survivor_prefer.js, profile raiseTo).
//
//   node raiseTo.test.js
//
// On real boards from a recorded game with no garbage on them and the stack
// below raiseTo, WasmSurvivor with raiseTo raises; once the stack reaches that
// row, or without raiseTo, it plays its own move.
var path = require('path'), fs = require('fs'), assert = require('assert');
var DIR = __dirname, PA = require(path.join(DIR, '..', '..', 'pa-engine.js')), SH = require(path.join(DIR, 'survivor_shared.js'));
var lines = require('zlib').gunzipSync(fs.readFileSync(path.join(DIR, 'pa.record.jsonl.gz'))).toString('utf8').trim().split('\n');
var level = null, low = [], tall = [];
for (var i = 0; i < lines.length && (low.length < 3 || tall.length < 2); i++) {
  var x = JSON.parse(lines[i]);
  if (x.levelData) level = { levelData: x.levelData, behaviours: x.behaviours, stackOverConditions: x.stackOverConditions };
  if (!x.state || !x.state.stack.stopWatchIsRunning || x.state.stack.in_countdown || x.state.stack.clock < 300) continue;
  var b = PA.fromLua(x.state, level, new PA.Unseen());
  if (SH.lowestGarbageRow(b) || (b.incoming || []).length) continue;
  // a raise the engine acts on: nothing in motion, none held back
  if (b.riseLock || b.preventManualRaise || b.manualRaise || b.shakeTime > 0) continue;
  var t = SH.top(b);
  if (t <= 6 && low.length < 3 && (!low.length || b.clock - low[low.length - 1].clock > 120)) low.push(b);
  if (t >= 8 && tall.length < 2 && (!tall.length || b.clock - tall[tall.length - 1].clock > 120)) tall.push(b);
}
assert(low.length && tall.length, 'boards: ' + low.length + ' low, ' + tall.length + ' tall');
function ask(profile, b) {
  var mind = require(path.join(DIR, 'survivor_think.js'))({ profile: profile, threads: 1 });
  return mind.answer({ id: 1, epoch: 0, at: b.clock + 30, lead: 30, ms: 300, board: b.copy(), hold: { left: 0, started: false }, arrivals: [], acted: false });
}
var base = SH.profile(), withRaise = JSON.parse(JSON.stringify(base));
withRaise.raiseTo = 8;
low.forEach(function (b) {
  var a = ask(withRaise, b);
  assert.strictEqual(a.kind, 'raise', 'top ' + SH.top(b) + ' at ' + b.clock + ': ' + a.kind + ' ' + JSON.stringify(a.move) + (a.error ? ' ' + a.error : ''));
});
tall.forEach(function (b) {
  var a = ask(withRaise, b), own = ask(base, b);
  assert.strictEqual(a.kind + JSON.stringify(a.move), own.kind + JSON.stringify(own.move), 'top ' + SH.top(b) + ' at ' + b.clock + ': raiseTo changed the move it plays at its row: ' + a.kind + ' against its own ' + own.kind);
});
console.log('ok: raiseTo 8 raises on ' + low.length + ' low boards with no garbage, and plays its own move on ' + tall.length + ' at row 8 or above');
