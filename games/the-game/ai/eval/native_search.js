#!/usr/bin/env node
// One engine's answers on the frozen heavy boards (native.fixtures.json: six
// boards from real games where the survival search goes deep). Run:
//   node native_search.js fast|native [THREADS]
// Prints one line per board: the decision, every move's verdict and the proven
// line (each node's time, move and board), hashed; then a JSON summary.
// native.test.js runs it once per engine and thread count and requires every
// line to be the same.
var fs = require('fs'), path = require('path'), crypto = require('crypto');
var DIR = __dirname;
require(path.join(DIR, '..', '..', 'panel-engine.js'));
require(path.join(DIR, '..', '..', 'panel-cpu.js'));
var P = require(path.join(DIR, 'puyocpu.js'));
var ENGINE = process.argv[2] || 'native', THREADS = Number(process.argv[3] || 0);
var W = JSON.parse(fs.readFileSync(path.join(DIR, 'trained.pbt.pbt-r01-s301.0926-142244.g00560.json'), 'utf8')).weights;
var fx = JSON.parse(fs.readFileSync(path.join(DIR, 'native.fixtures.json'), 'utf8'));
function dec(e) { return P.decodeStack({ meta: e.meta, rows: e.rows, row0: e.row0, buf: Int32Array.from(e.buf) }); }
var prints = [], total = 0;
fx.forEach(function (x) {
  var b = new P(dec(x.me), { weights: W, reaction: 12, depth: 2, beam: 0, rise: true, allowRaise: true, modes: true, engine: true,
                             threads: THREADS, fastEngine: ENGINE === 'fast', native: ENGINE === 'native' });
  b.opponent = dec(x.opp); b.raiseFrames = x.raiseFrames; b._raiseStarted = x.raiseStarted; b._predArr = x.arrivals;
  var v, ss = b._survivalSearch;
  b._survivalSearch = function (c) { v = ss.call(b, c); return v; };
  var t = Date.now(), d = b._decide();
  total += Date.now() - t;
  var line = b._proofLine && b._proofLine.line.map(function (n) { return [n.t, n.m, P.encodeStack(n.st).buf.join(',')]; });
  prints.push(crypto.createHash('md5').update(JSON.stringify({ d: d, v: v, l: line })).digest('hex').slice(0, 12));
});
console.log(JSON.stringify({ engine: ENGINE, threads: THREADS, prints: prints, ms: total }));
process.exit(0);
