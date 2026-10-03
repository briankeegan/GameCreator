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
var DIR = __dirname, PA = require(path.join(DIR, '..', '..', 'pa-engine.js')), N = require(path.join(DIR, 'native.js')).server, SH = require(path.join(DIR, 'survivor_shared.js'));
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
  assert.deepStrictEqual(a.pos, b.pos, what + ': cursor');
}
function stepsFrom(node) {
  var out = node.b.legalSwaps().map(function (m) { return [node, 'swap', m, 0]; });
  out.push([node, 'hold', null, 0], [node, 'long', null, 40]);
  node.b.legalSwaps().slice(0, 6).forEach(function (m) { out.push([node, 'settle', m, 120]); });
  out.push([node, 'settle', null, 0]);
  return out;
}
// Each board three ways: as it is; a raise held through the walks; garbage
// landing while they walk. A swap's walk is played once for all a parent's
// swaps (search.h SHARED WALKS), so whatever moves under it must move alike.
var ROOTS = [
  { hold: { left: 0, started: false }, arrivals: [] },
  { hold: { left: 14, started: false }, arrivals: [] },
  { hold: { left: 0, started: false }, arrivals: [{ at: 3, width: 6, height: 2, isChain: true }, { at: 9, width: 4, height: 1, isChain: false }] }
];
var played = 0, touched = 0, underGarbage = 0;
boards.forEach(function (board, bj) {
  ROOTS.forEach(function (R, ri) {
  var bi = bj + '/' + ri;
  A.reset(); B.reset();
  var ra = A.root(board.copy(), R.hold, R.arrivals, false), rb = B.root(board.copy(), R.hold, R.arrivals, false);
  var sa = stepsFrom(ra), got = A.advanceMany(sa), live = [];
  // The engine's touchScore is survivor_shared.js's, on every board made.
  var withBoard = got.filter(function (g) { return g && !g.dead; }), ts = A.touchScores(withBoard);
  withBoard.forEach(function (g, q) { assert.strictEqual(ts.score[q], SH.touchScore(g.b.grid), 'board ' + bi + ': touch score'); touched++; if (g.b.grid.some(function (row) { return row.some(function (v) { return v < 0; }); })) underGarbage++; });
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
});
// BOARDS GO ROUND. The same batches again and again, each let go, must not
// grow the heap: boards one thread lets go that another made are handed back
// (memory.h SPARES), or the heap grows a little every phase till it is out.
// Which thread frees which board varies with timing, so a thread may take one
// more chunk once; growth on more than one pass is the leak. Over 40 passes
// three runs stayed flat at 516, 520, and 506 then 513 once at pass 31.
var X = N.exports(), pages = [];
for (var pass = 0; pass < 10; pass++) {
  boards.slice(0, 12).forEach(function (board) {
    A.reset();
    var r = A.root(board.copy(), { left: 0, started: false }, [], false), made = A.advanceMany(stepsFrom(r), true);
    A.advanceMany([].concat.apply([], made.filter(function (m) { return m && !m.dead; }).slice(0, 6).map(stepsFrom)), true);
  });
  pages.push(X.nb_pool_stat(-1));
}
var grew = 0;
for (var q = 2; q < pages.length; q++) if (pages[q] > pages[q - 1]) grew++;
if (grew > 1) { console.log('FAIL: the heap grew on ' + grew + ' passes of the same batches (' + pages.join(',') + ' pages)'); process.exit(1); }
if (underGarbage < 100) { console.log('FAIL: too few boards under garbage to test the touch score on'); process.exit(1); }
console.log('ok: ' + played + ' steps on ' + boards.length + ' boards (' + ROOTS.length + ' ways each), batched on 3 threads, the same as one at a time; ' + touched + ' touch scores the same (' + underGarbage + ' under garbage); heap steady at ' + pages[pages.length - 1] + ' pages');
process.exit(0);
