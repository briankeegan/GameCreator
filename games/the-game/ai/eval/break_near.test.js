// HOW NEAR A BREAK IS (survivor_shared.js breakNear, nearScore): the break search's beam ranks its lines by the fewest swaps to a match
// touching garbage, so a line a swap nearer a break ranks above one that is not -- and on a factory board where a slab rests on one
// column, the search finds the break four swaps away. Run: node break_near.test.js
var assert = require('assert'), path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), SH = require('./survivor_shared.js');

// a grid from rows written top first, the coming-up row last: G garbage, . empty, a digit a colour
function grid(txt) { return txt.trim().split('\n').reverse().map(function (l) { return [0].concat(l.trim().split(/\s+/).map(function (x) { return x === 'G' ? -2 : x === '.' ? 0 : +x; })); }); }
var pad = '. . . . . .\n';
// a game of factory (frame 1149): a slab of three rows rests on column 6 alone; the 2 in row 8 walked to column 6 makes three 2s under it
var FACTORY = 'G G G G G G\nG G G G G G\nG G G G G G\n. . . . . 2\n1 4 1 5 1 2\n1 2 3 1 3 4\n3 4 5 4 5 3\n4 1 4 2 1 5\n4 1 1 3 2 3\n' +
              '2 5 4 1 1 3\n5 2 2 3 5 2\n3 4 3 1 5 4\n2 5 2 3 3 2\n3 4 5 4 1 4';
assert.strictEqual(SH.breakNear(grid(FACTORY)), 4, 'four swaps: the 2 in row 8 walked from column 2 to column 6');
// one swap along the walk: three away
var oneOn = FACTORY.replace('1 2 3 1 3 4', '1 3 2 1 3 4');
assert.strictEqual(SH.breakNear(grid(oneOn)), 3, 'a swap along the walk is a swap nearer');
assert.ok(SH.nearScore(grid(oneOn)) > SH.nearScore(grid(FACTORY)), 'the nearer line ranks higher');
// a row of three under the garbage, one swap away; garbage in the way of a walk stops it; no garbage, no break
assert.strictEqual(SH.breakNear(grid(pad.repeat(8) + 'G G G G G G\n1 1 2 1 3 4\n5 4 3 2 5 4\n1 2 3 4 5 1')), 1, 'a row of 1s, one swap from three');
assert.strictEqual(SH.breakNear(grid(pad.repeat(9) + 'G G G . . .\n1 1 2 4 3 1\n1 2 3 4 5 1')), 3, 'under a narrow slab: the 1 in column 6 walked to column 3');
assert.strictEqual(SH.breakNear(grid(pad.repeat(9) + 'G G G . . .\n1 1 2 G 3 1\n1 2 3 4 5 1')), Infinity, 'never walked across garbage');
assert.strictEqual(SH.breakNear(grid(pad.repeat(9) + '. . . . . .\n1 1 2 1 3 4\n1 2 3 4 5 1')), Infinity, 'no garbage: no break');

// THE SEARCH, on the engine: the factory board as the game had it (health 51, stop 60, shake 17), its slab one block
var b = PA.game({ level: 10, seed: 7, countdown: false });
for (var f = 0; f < 60; f++) b.run();
var G = grid(FACTORY), id = 1000;
while (b.panels.length < b.height + 4) {
  var tm = b.panels[1], nr = [null];
  for (var c = 1; c <= 6; c++) { var np = Object.create(Object.getPrototypeOf(tm[c])); Object.assign(np, tm[c], { row: b.panels.length }); nr.push(np); }
  b.panels.push(nr);
}
for (var r = 0; r < b.panels.length; r++) for (c = 1; c <= 6; c++) {
  var p = b.panels[r][c], v = G[r] ? G[r][c] : 0;
  Object.assign(p, { color: v > 0 ? v : 0, isGarbage: false, garbageId: null, xOffset: null, yOffset: null, gWidth: 0, gHeight: 0, state: 'normal', timer: 0, chaining: false, matching: false, id: ++id });
  if (v < 0) Object.assign(p, { isGarbage: true, color: 9, garbageId: 1, gWidth: 6, gHeight: 3, xOffset: c - 1, yOffset: r - 11 });
}
Object.assign(b, { garbageCreatedCount: 1, highestGarbageIdMatched: 0, panelIdCount: id, health: 51, stopTime: 60, shakeTime: 17 });
var S = new (require('./native.js').server.Search)({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 }), hold = { left: 0, started: false };
var found = SH.breakMoves(S, b, hold, [], 1, 0, Date.now() + 2000, null, null, { touchInPop: true, near: true });
assert.ok(found && found.depth && found.path && found.path.length <= 4, 'the search finds the break within four swaps: ' + JSON.stringify(found && found.path));
console.log('ok: break near -- the beam ranks by swaps to a break, and finds the factory board\'s in ' + found.path.length);

// ONE PRESS CLOCK: with the input budget tight the frame loop walks held from two cells and presses later. The break search searches on
// that clock (opts.tight), so every line it finds is one the judge, pressing as the frame loop presses, sees break
var A = require('./survivor_attack.js')({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 }), lines = 0, agree = 0, fastOff = 0;
for (var seed = 1; seed <= 60 && lines < 20; seed++) {
  var eb = PA.game({ level: 10, seed: seed, countdown: false });
  for (f = 0; f < 150 + (seed % 6) * 40; f++) eb.run();
  eb.receiveGarbage([{ width: 3 + seed % 4, height: 1 + seed % 2, isChain: false, isMetal: false }]);
  for (f = 0; f < 120 + (seed % 7) * 15; f++) eb.run();
  if (eb.gameOverClock > 0 || !SH.lowestGarbageRow(eb)) continue;
  [true, false].forEach(function (tight) {
    var br = SH.breakMoves(S, eb, hold, [], 1, 0, Date.now() + 200, null, null, { touchInPop: true, near: true, tight: tight });
    if (!br || !br.depth) return;
    var seqs = br.path ? [br.path] : Object.keys(br.moves).map(function (k) { return [k.split(',').map(Number)]; });
    seqs.forEach(function (seq) {
      var ok = A.judge(eb, hold, seq, [], { settled: false, tight: true }).made.broke > 0;
      if (tight) { lines++; if (ok) agree++; } else if (!ok) fastOff++;
    });
  });
}
assert.ok(lines >= 10, 'break lines found on the tight clock: ' + lines);
assert.strictEqual(agree, lines, 'every line the break search finds on the tight clock breaks as the judge presses it: ' + agree + ' of ' + lines);
console.log('ok: one press clock -- ' + agree + ' of ' + lines + ' break lines agree with the judge (' + fastOff + ' found on the untight walk do not)');
