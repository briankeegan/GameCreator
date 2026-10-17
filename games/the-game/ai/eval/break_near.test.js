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
// (a board from rows written top first, its one slab gh rows tall with its lowest row at g0)
function boardOf(txt, gh, g0) {
  var bd = PA.game({ level: 10, seed: 7, countdown: false });
  for (var f0 = 0; f0 < 60; f0++) bd.run();
  var G = grid(txt), id = 1000;
  while (bd.panels.length < bd.height + 4) {
    var tm = bd.panels[1], nr = [null];
    for (var c0 = 1; c0 <= 6; c0++) { var np = Object.create(Object.getPrototypeOf(tm[c0])); Object.assign(np, tm[c0], { row: bd.panels.length }); nr.push(np); }
    bd.panels.push(nr);
  }
  for (var r = 0; r < bd.panels.length; r++) for (var c = 1; c <= 6; c++) {
    var p = bd.panels[r][c], v = G[r] ? G[r][c] : 0;
    Object.assign(p, { color: v > 0 ? v : 0, isGarbage: false, garbageId: null, xOffset: null, yOffset: null, gWidth: 0, gHeight: 0, state: 'normal', timer: 0, chaining: false, matching: false, id: ++id });
    if (v < 0) Object.assign(p, { isGarbage: true, color: 9, garbageId: 1, gWidth: 6, gHeight: gh, xOffset: c - 1, yOffset: r - g0 });
  }
  Object.assign(bd, { garbageCreatedCount: 1, highestGarbageIdMatched: 0, panelIdCount: id, health: 51, stopTime: 60, shakeTime: 17 });
  return bd;
}
var b = boardOf(FACTORY, 3, 11), f;
var S = new (require('./native.js').server.Search)({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 }), hold = { left: 0, started: false };
var found = SH.breakMoves(S, b, hold, [], 1, 0, Date.now() + 2000, null, null, { touchInPop: true, near: true });
assert.ok(found && found.depth && found.path && found.path.length <= 4, 'the search finds the break within four swaps: ' + JSON.stringify(found && found.path));
console.log('ok: break near -- the beam ranks by swaps to a break, and finds the factory board\'s in ' + found.path.length);
// THE SEARCH'S CHECKS ARE ITS WORK: a line check that takes 20 ms and refuses every line is asked only until the deadline -- the search
// ends within it and one check, not after a check of every line that breaks
var slowB = boardOf(pad.repeat(8) + 'G G G G G G\n1 1 2 1 3 4\n5 4 3 2 5 4\n1 2 3 4 5 1', 1, 3), slowT0 = Date.now(), slowN = 0;
SH.breakMoves(S, slowB, hold, [], 1, 0, Date.now() + 60, null, null, { touchInPop: true, near: true,
  lineOk: function () { slowN++; for (var w0 = Date.now(); Date.now() - w0 < 20;) {} return false; } });
assert.ok(Date.now() - slowT0 < 60 + 20 + 60, 'a search 60 ms long with 20 ms checks took ' + (Date.now() - slowT0) + ' ms (' + slowN + ' checks)');

// BUSY BOARDS: a break made and its slab popping, the board read every few frames while it pops and falls -- every line the break search
// finds there (a line-up is its whole line, two swaps; one pressed once the pop is over is judged settle by settle) breaks as the judge
// plays it
var A = require('./survivor_attack.js')({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 }), CK = require('./survivor_checks.js'), busyLines = 0, busyBroke = 0;
for (var seed = 1; seed <= 150 && busyLines < 30; seed++) {
  var eb = PA.game({ level: 10, seed: seed, countdown: false });
  for (f = 0; f < 150 + (seed % 6) * 40; f++) eb.run();
  eb.receiveGarbage([{ width: 6, height: 2, isChain: false, isMetal: false }]);
  eb.receiveGarbage([{ width: 6, height: 1, isChain: false, isMetal: false }]);
  for (f = 0; f < 250; f++) eb.run();
  if (eb.gameOverClock > 0 || !SH.lowestGarbageRow(eb)) continue;
  var br0 = SH.breakMoves(S, eb, hold, [], 1, 0, Date.now() + 200, null, null, { touchInPop: true, near: true });
  if (!br0 || !br0.depth) continue;
  var seq0 = br0.path || [Object.keys(br0.moves)[0].split(',').map(Number)], j0 = A.judge(eb, hold, seq0, [], { settled: false });
  var gb = eb.copy(), c0 = gb.clock, pressed = 0;
  for (var t = 0; t < 400 && pressed < seq0.length; t++) { if (gb.clock - c0 >= j0.ats[pressed] + 1) { gb.curRow = seq0[pressed][0]; gb.curCol = seq0[pressed][1]; if (gb.tryQueueSwap(seq0[pressed][0], seq0[pressed][1])) pressed++; } gb.run(); }
  for (var k = 0; k < 12; k++) {
    for (f = 0; f < 6; f++) gb.run();
    if (!(SH.popLeft(gb) > 0 || CK.cascadeLive(gb, true)) || gb.gameOverClock > 0 || !SH.lowestGarbageRow(gb)) continue;
    var pop = SH.popLeft(gb), b2 = SH.breakMoves(S, gb, hold, [], 1, pop > 0 ? pop + 30 : 0, Date.now() + 150, null, null, { touchInPop: true, near: true });
    if (!b2 || !b2.depth) continue;
    (b2.path ? [b2.path] : Object.keys(b2.moves).map(function (q) { return b2.lines && b2.lines[q] ? b2.lines[q] : [q.split(',').map(Number)]; })).forEach(function (seq) {
      var jb = A.judge(gb, hold, seq, [], { settled: b2.lineup === 'ready' && seq.length > 1 });
      if (jb.dead) return;
      busyLines++; if (jb.made.broke > 0) busyBroke++;
    });
  }
}
assert.ok(busyLines >= 20, 'lines found on busy boards: ' + busyLines);
assert.strictEqual(busyBroke, busyLines, 'every line the break search finds on a busy board breaks as the judge plays it: ' + busyBroke + ' of ' + busyLines);
console.log('ok: busy boards -- ' + busyBroke + ' of ' + busyLines + ' break lines found while a slab pops break as the judge plays them');
