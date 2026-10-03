#!/usr/bin/env node
// MORE GARBAGE ON ITS WAY THAN THE SEARCH HOLDS. A drill can have hundreds of
// pieces in flight; the search holds MAXARR (search.h) and its io body has
// room for no more after the board. A root given more keeps the soonest, in
// their order, and writes nothing past that room.
var path = require('path'), assert = require('assert');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), N = require(path.join(__dirname, 'native.js')).server;
var st = PA.game({ level: 10, seed: 3, countdown: false }), arrivals = [];
for (var i = 0; i < 300; i++) arrivals.push({ at: 5 + ((i * 37) % 290), width: 3 + (i % 4), height: 1, isChain: false });
var S = new N.Search({ reaction: 3, cursorMoveFrames: 4, threads: 1 });
var r = S.root(st.copy(), { left: 0, started: false }, arrivals, false), got = r.arrivals;
var want = arrivals.map(function (a, i) { return [a.at, i]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; })
  .slice(0, 64).map(function (x) { return x[1]; }).sort(function (a, b) { return a - b; }).map(function (i) { return arrivals[i]; });
assert.strictEqual(got.length, 64, 'kept ' + got.length + ' arrivals');
got.forEach(function (a, i) { assert.strictEqual(a.at, want[i].at, 'arrival ' + i + ': at'); assert.strictEqual(a.width, want[i].width, 'arrival ' + i + ': width'); });
// the board after it is the board: a step from this root plays as from a root given the 64 alone
var T = new N.Search({ reaction: 3, cursorMoveFrames: 4, threads: 1 }), r2 = T.root(st.copy(), { left: 0, started: false }, want, false);
var a = S.advance(r, 'long', null, 200), b = T.advance(r2, 'long', null, 200);
assert.strictEqual(!!a.dead, !!b.dead, 'a long step: dead one way only');
assert.strictEqual(a.t, b.t, 'a long step: frame');
if (a.b || b.b) assert.deepStrictEqual(a.b.grid, b.b.grid, 'a long step: grid');
console.log('ok: 300 arrivals on their way, the search keeps the 64 soonest and plays as given them alone');
