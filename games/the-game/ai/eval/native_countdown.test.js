#!/usr/bin/env node
// A COUNTDOWN JUMP IS THE FRAMES IT JUMPS.
//
//   node native_countdown.test.js [FRAMES] [SEED]
//
// pa.c countdown plays at once the frames on which only timers run (garbage
// popping, everything else at rest, nothing pressed), and the search jumps
// them in waits and cooldowns. From real boards (the Lua record), with slabs
// dropped on them and matches made under them by random play and idle
// stretches, on every frame where a jump is possible a copy jumps and another
// copy runs the same frames one at a time; the two must be the same board,
// every field. pa.c itself is held to pa-engine.js frame by frame
// (native_pa.test.js); this holds the jump to pa.c.
var fs = require('fs'), path = require('path'), assert = require('assert');
var DIR = __dirname, PA = require(path.join(DIR, 'pa-engine.js')), N = require(path.join(DIR, 'native.js')).server.init(), X = N.exports();
var FRAMES = Number(process.argv[2] || 30000), SEED = Number(process.argv[3] || 1);
var state = SEED * 2654435761 % 4294967296;
function rand(n) { state = (state * 1103515245 + 12345) % 2147483648; return Math.floor(state / 65536) % n; }
var lines = require('zlib').gunzipSync(fs.readFileSync(path.join(DIR, 'pa.record.jsonl.gz'))).toString('utf8').trim().split('\n');
var boards = [], level = null, n = 0;
lines.forEach(function (l) {
  var x = JSON.parse(l);
  if (x.levelData) level = { levelData: x.levelData, behaviours: x.behaviours, stackOverConditions: x.stackOverConditions };
  if (!x.state) return;
  var st = x.state.stack;
  if (st.stopWatchIsRunning && !st.in_countdown && st.clock > 190 && n++ % 7 === 3) boards.push(PA.fromLua(x.state, level, new PA.Unseen()));
});
assert(boards.length, 'no boards in the record');
assert(X.nb_countdown, 'pa.c has no countdown');
var BIT = { right: 1, left: 2, down: 4, up: 8, swap: 16 };
function same(a, b, where) {
  var tpl = boards[0];
  var u = JSON.stringify(N.toStack(a, tpl.copy())), v = JSON.stringify(N.toStack(b, tpl.copy()));
  if (u === v) return;
  var A = JSON.parse(u), B = JSON.parse(v), k;
  for (k in A) if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) { console.log('DIFFERENT ' + where + ': ' + k + ' ' + JSON.stringify(A[k]).slice(0, 300) + ' vs ' + JSON.stringify(B[k]).slice(0, 300)); process.exit(1); }
}
var frames = 0, runs = 0, jumps = 0, jumped = 0;
while (frames < FRAMES) {
  var h = N.fromStack(boards[runs++ % boards.length].copy());
  X.nb_receive(h, 6, 1 + rand(12), 1, 0, 0, 1);
  if (rand(2)) X.nb_receive(h, 6, 1 + rand(12), 1, 0, 0, 1);
  var idle = 0, dir = 0, held = 0;
  for (var f = 0; f < 900 && frames < FRAMES; f++, frames++) {
    var bits = 0;
    if (idle > 0) idle--;
    else if (rand(40) === 0) idle = 20 + rand(80);
    else {
      if (held-- <= 0) { dir = [0, 0, BIT.up, BIT.down, BIT.left, BIT.right][rand(6)]; held = rand(4); }
      bits = dir | (rand(6) === 0 ? BIT.swap : 0);
    }
    X.nb_set_input(h, bits);
    if (!bits) {
      var a = X.nb_new(), b = X.nb_new();
      X.nb_clone(a, h); X.nb_clone(b, h);
      var k = X.nb_countdown(a, 1 + rand(120));
      if (k > 0) {
        for (var i = 0; i < k; i++) { X.nb_set_input(b, 0); assert.strictEqual(X.nb_run(b), 0, 'engine error'); }
        same(a, b, 'run ' + runs + ' frame ' + f + ', a jump of ' + k);
        jumps++; jumped += k;
      }
      X.nb_free(a); X.nb_free(b);
    }
    assert.strictEqual(X.nb_run(h), 0, 'engine error');
    if (N.toStack(h, boards[0].copy()).gameOverClock > 0) break;
  }
  X.nb_free(h);
}
assert(jumps >= 50, 'only ' + jumps + ' jumps were tried, so the jump went untested');
console.log('ok: ' + jumps + ' jumps (' + jumped + ' frames) the same as the frames run one at a time, over ' + frames + ' frames of ' + runs + ' runs');
