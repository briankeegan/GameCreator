#!/usr/bin/env node
// A QUESTION THE FRAME LOOP STOPPED IS NOT THOUGHT ABOUT.
//
//   node survivor_mind.test.js
//
// survivor.js stores in ABORT the newest question it no longer wants; every
// question before it is unwanted too, since only the newest is waited on. The
// mind (survivor_mind.js) must answer each of those at once, aborted, without
// starting on it -- a queue of stopped questions each thought through in full
// leaves the board unplayed for seconds -- and answer the next one in full.
var path = require('path'), fs = require('fs'), assert = require('assert'), wt = require('worker_threads');
var DIR = __dirname, PA = require(path.join(DIR, '..', '..', 'pa-engine.js')), SH = require(path.join(DIR, 'survivor_shared.js'));
var lines = require('zlib').gunzipSync(fs.readFileSync(path.join(DIR, 'pa.record.jsonl.gz'))).toString('utf8').trim().split('\n');
var board = null, level = null;
for (var i = 0; i < lines.length && !board; i++) {
  var x = JSON.parse(lines[i]);
  if (x.levelData) level = { levelData: x.levelData, behaviours: x.behaviours, stackOverConditions: x.stackOverConditions };
  if (x.state && x.state.stack.stopWatchIsRunning && !x.state.stack.in_countdown && x.state.stack.clock > 300) board = PA.fromLua(x.state, level, new PA.Unseen());
}
assert(board, 'no board in the record');
var ABORT = new Int32Array(new SharedArrayBuffer(4));
var mind = new wt.Worker(path.join(DIR, 'survivor_mind.js'), { workerData: { profile: SH.profile(), threads: 1, abort: ABORT } });
var got = {}, timer = setTimeout(function () { console.error('FAIL: the mind did not answer'); process.exit(1); }, 120000);
function ask(id) { mind.postMessage({ id: id, epoch: 0, at: board.clock + 30, lead: 30, ms: 300, board: board.copy(), hold: { left: 0, started: false }, arrivals: [], acted: false }); }
mind.on('message', function (a) {
  if (a.ready) { Atomics.store(ABORT, 0, 4); [1, 2, 3, 4, 5].forEach(ask); return; }
  got[a.id] = a;
  if (a.id !== 5) return;
  clearTimeout(timer);
  for (var k = 1; k <= 4; k++) {
    assert(got[k] && got[k].aborted, 'question ' + k + ' (at or before the stopped one) was not dropped: ' + JSON.stringify(got[k]).slice(0, 200));
    assert(got[k].ms === 0, 'question ' + k + ' was started on before it was dropped (' + got[k].ms + ' ms)');
  }
  assert(!a.aborted && !a.error && a.kind, 'the question after the stopped one was not answered: ' + JSON.stringify(a).slice(0, 300));
  console.log('ok: four stopped questions dropped unstarted, the next answered (' + a.kind + ' ' + JSON.stringify(a.move) + ', ' + a.ms + ' ms)');
  process.exit(0);
});
mind.on('error', function (e) { console.error('FAIL: ' + (e && e.stack || e)); process.exit(1); });
