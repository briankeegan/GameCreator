#!/usr/bin/env node
// A BATCH OF STEPS IS THE SAME STEPS.
//
//   node native_batch.test.js [BOARDS]
//
// Search.advanceMany plays its steps on every thread. From real boards (the
// Lua record native_pa.test.js uses), every legal swap, a hold, a wait and a
// settle of each are played both ways -- in one batch on three threads, and
// one advance at a time in a context of its own -- and each answer must be
// the same: refused or not, dead and when, the frame, the key, the grid and
// what a settle did. Then a second batch from the first's nodes, as the break
// search plays them.
var fs = require('fs'), path = require('path'), assert = require('assert');
var DIR = __dirname, PA = require(path.join(DIR, 'pa-engine.js')), N = require(path.join(DIR, 'native.js')).server;
var MAX = Number(process.argv[2] || 40);
var lines = require('zlib').gunzipSync(fs.readFileSync(path.join(DIR, 'pa.record.jsonl.gz'))).toString('utf8').trim().split('\n');
var boards = [], level = null, n = 0;
lines.forEach(function (l) {
  var x = JSON.parse(l);
  if (x.levelData) level = { levelData: x.levelData, behaviours: x.behaviours, stackOverConditions: x.stackOverConditions };
  if (!x.state) return;
  var st = x.state.stack;
  if (!(st.stopWatchIsRunning && !st.in_countdown && st.clock > 190)) return;
  if (n++ % 13 === 5 && boards.length < MAX) boards.push(PA.fromLua(x.state, level, new PA.Unseen()));
});
assert(boards.length, 'no boards in the record');
var A = new N.Search({ reaction: 3, cursorMoveFrames: 4, threads: 3 }), B = new N.Search({ reaction: 3, cursorMoveFrames: 4, threads: 3 });
assert(N.threads() === 3, 'the batch is not on threads (' + N.threads() + ')');
function same(a, b, what) {
  if (!a || !b) return assert.strictEqual(!!a, !!b, what + ': refused one way only');
  assert.strictEqual(!!a.dead, !!b.dead, what + ': dead one way only');
  assert.strictEqual(a.t, b.t, what + ': frame');
  if (a.dead && !a.b) return assert(!b.b, what + ': a board one way only');
  assert.strictEqual(String(a.b.key), String(b.b.key), what + ': key');
  assert.deepStrictEqual(a.b.grid, b.b.grid, what + ': grid');
}
function stepsFrom(node) {
  var out = node.b.legalSwaps().map(function (m) { return [node, 'swap', m, 0]; });
  out.push([node, 'hold', null, 0], [node, 'long', null, 40]);
  node.b.legalSwaps().slice(0, 6).forEach(function (m) { out.push([node, 'settle', m, 120]); });
  out.push([node, 'settle', null, 0]);
  return out;
}
var played = 0;
boards.forEach(function (board, bi) {
  A.reset(); B.reset();
  var ra = A.root(board.copy(), { left: 0, started: false }, [], false), rb = B.root(board.copy(), { left: 0, started: false }, [], false);
  var sa = stepsFrom(ra), got = A.advanceMany(sa), live = [];
  sa.forEach(function (s, i) {
    var want = B.advance(rb, s[1], s[2], s[3]), what = 'board ' + bi + ' ' + s[1] + ' ' + JSON.stringify(s[2]);
    same(got[i], want, what);
    if (s[1] === 'settle' && want && want.b) assert.deepStrictEqual(A.stepStats(got[i]), B.stepStats(want), what + ': what it did');
    if (want && !want.dead && s[1] === 'swap' && live.length < 4) live.push([got[i], want]);
    played++;
  });
  live.forEach(function (p, li) {
    var s2 = stepsFrom(p[0]), g2 = A.advanceMany(s2);
    s2.forEach(function (s, i) { same(g2[i], B.advance(p[1], s[1], s[2], s[3]), 'board ' + bi + ' line ' + li + ' ' + s[1] + ' ' + JSON.stringify(s[2])); played++; });
  });
});
console.log('ok: ' + played + ' steps on ' + boards.length + ' boards, batched on 3 threads, the same as one at a time');
process.exit(0);
