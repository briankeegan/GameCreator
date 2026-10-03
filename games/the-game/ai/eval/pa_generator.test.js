#!/usr/bin/env node
// THE SERVER'S PANEL GENERATOR IN JS DEALS WHAT THE LUA DEALS.
//
//   node pa_generator.test.js
//
// pa-generator.js against the starting boards PanelGenTests.lua asserts
// (seed 1, modern 10 / 5 / 1), and against every panel buffer, garbage buffer,
// dealt row and garbage row in pa.record.jsonl.gz. A record carries its seed
// (lua/engineRecord.lua: SEED * 1000 + match); one written before it did is
// found by trying SEED 1..99.
var fs = require('fs'), path = require('path'), zlib = require('zlib');
var G = require(path.join(__dirname, '..', '..', 'pa-generator.js'));
var fails = 0;
function fail(m) { console.log('FAIL: ' + m); fails++; }

// PanelGenTests.lua testPanelGenForStartingBoard.
[[6, 1, '0000200020E025A010C4602d4e2F5261E34cE416a4'],
 [5, G.safeFraction(4, 7), '0b000003200004A0533520cAaD4323423B5daD2513'],
 [5, 0, '0000000020400254Eb013C231b41E4e4323B42bE44']].forEach(function (t) {
  var got = new G.GeneratorSource(1, true, t[0], t[1]).panelBuffer;
  if (got !== t[2]) fail('seed 1, ' + t[0] + ' colours, denial ' + t[1] + ': ' + got + ' vs Lua ' + t[2]);
});
if (G.safeFraction(4, 7) !== 0.57142857142857) fail('safeFraction(4, 7) ' + G.safeFraction(4, 7));

// Stack:starting_state deals eight rows before the first frame.
function source(seed, ld) {
  var g = new G.GeneratorSource(seed, true, ld.colors, ld.adjacentDenialFrequency);
  for (var i = 0; i < 8; i++) g.nextRowString();
  return g;
}
function list(x) { return Array.isArray(x) ? x : []; }
var lines = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'pa.record.jsonl.gz'))).toString().split('\n').filter(Boolean);
var n = { matches: 0, rows: 0, garbageRows: 0, buffers: 0 }, g = null, last = null, broken = false;
lines.forEach(function (l) {
  var o = JSON.parse(l);
  if (!last || o.match !== last.match || o.clock <= last.clock) {
    var ld = o.levelData, seed = o.seed;
    if (seed === undefined) {
      for (var S = 1; S < 100 && seed === undefined; S++) if (source(S * 1000 + o.match, ld).panelBuffer === o.state.panelBuffer) seed = S * 1000 + o.match;
    }
    if (seed === undefined) { fail('match ' + o.match + ': no seed deals its board'); g = null; }
    else { g = source(seed, ld); n.matches++; }
    broken = false;
  }
  last = o;
  if (!g || broken) return;
  var where = 'match ' + o.match + ' clock ' + o.clock;
  list(o.newRows).forEach(function (r) { var got = g.nextRowString(); n.rows++; if (got !== r && !broken) { fail(where + ': row ' + got + ' vs Lua ' + r); broken = true; } });
  list(o.garbageRows).forEach(function (r) { var got = g.garbageRowString(); n.garbageRows++; if (got !== r && !broken) { fail(where + ': garbage row ' + got + ' vs Lua ' + r); broken = true; } });
  if (o.state && !broken) {
    n.buffers++;
    if (o.state.panelBuffer !== g.panelBuffer) { fail(where + ': panelBuffer ' + g.panelBuffer + ' vs Lua ' + o.state.panelBuffer); broken = true; }
    else if (o.state.garbagePanelBuffer !== g.garbagePanelBuffer) { fail(where + ': garbagePanelBuffer differs'); broken = true; }
  }
});
// A copy deals what the original deals.
var a = new G.GeneratorSource(7, true, 6, 1), b;
for (var i = 0; i < 40; i++) a.nextRowString();
b = a.copy();
for (i = 0; i < 300; i++) if (a.nextRowString() !== b.nextRowString() || a.garbageRowString() !== b.garbageRowString()) { fail('a copy deals differently at ' + i); break; }
if (n.matches < 20 || n.rows < 40 || n.buffers < 600) fail('exercised too little: ' + JSON.stringify(n));
if (fails) process.exit(1);
console.log('ok: the Lua\'s starting boards, and ' + JSON.stringify(n) + ' from the recording, dealt identically');
