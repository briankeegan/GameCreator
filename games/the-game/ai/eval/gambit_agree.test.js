// EVERY CHECK AGREES WITH THE JUDGE (plans/decision.md: one judge, one ranking). Each search Gambit's decision reads on the engine says
// something about a board; the judge (attacker.judge), or the game's own engine (pa-engine.js), is asked the same thing on the same
// board, and the two must give the same answer:
//   readiness   a board called ready has a break on it, once everything shown has landed, that the judge plays as a break within the list
//   outlive     a line the survival search says lives, the judge plays out alive to the same frame, within the list
//   lostAt      the frame the judge says a board left alone is lost is the frame the game's engine loses it
//   dropAt      the frame the judge says garbage can next drop (stop, pre-stop, shake) is the frame the game's engine has them all spent
//   offered     every line the break search and the survival search offer, the judge takes: within the list, and below the material
//               floor clearing nothing that breaks no garbage (attacker.allowed, the rules every search on the engine reads)
// Boards from real games at level 10, with garbage on them, on its way, and topped out under stop time. Run: node gambit_agree.test.js
var assert = require('assert'), path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), JUDGE = require('./gambit_judge.js'), CPU = require('./puyocpu.js').prototype;
var A = require('./survivor_attack.js')({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 }), H0 = { left: 0, started: false };
var LIST = require('./survivor-profiles/gambit-rules.json'), SH0 = require('./survivor_shared.js'), S00 = new (require('./native.js').server.Search)({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 });
var list = (function find(o) { if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) { var f = find(o[i]); if (f) return f; } return null; } if (o && typeof o === 'object') { if (o.name === 'finish them' && (o.aims || o.list)) return o.aims || o.list; for (var k in o) { var g = find(o[k]); if (g) return g; } } return null; })(LIST);
assert.ok(list && list.length, 'the finish list is read from the rules file');
list = list.filter(function (a) { return typeof a !== 'string'; });
A.useList(JUDGE.stepFits(list));
var HORIZON = CPU.SURVIVE_FRAMES, REST = CPU.SURVIVE_REST;

// THE BOARDS: real games, each with a different load -- slabs landed, slabs on their way, a combo storm's small blocks -- and some topped
// out under stop time
var boards = [];
for (var seed = 1; seed <= 12; seed++) {
  var b = PA.game({ level: 10, seed: seed, countdown: false });
  for (var f = 0; f < 150 + seed * 23; f++) b.run();
  var kind = seed % 4;
  if (kind === 0) b.receiveGarbage([{ width: 6, height: 2, isChain: false, isMetal: false }]);
  if (kind === 1) b.receiveGarbage([{ width: 6, height: 1, isChain: false, isMetal: false }, { width: 4, height: 1, isChain: false, isMetal: false }]);
  for (f = 0; f < 120; f++) b.run();
  if (b.gameOverClock > 0) continue;
  var arr = kind === 2 ? [{ at: 40, width: 6, height: 2 }, { at: 70, width: 6, height: 2 }] : kind === 3 ? Array.apply(null, Array(8)).map(function (_, i) { return { at: 30 + i, width: 4, height: 1 }; }) : [{ at: 60, width: 6, height: 1 }];
  boards.push({ b: b, arr: arr, name: 'seed ' + seed });
  if (seed % 3 === 0) { var t = b.copy(); t.stopTime = 60 + seed * 5; boards.push({ b: t, arr: arr, name: 'seed ' + seed + ' with stop ' + t.stopTime }); }
}
// (and a board whose break is one the list forbids: the 1 in row 3 swapped into column 1 makes four 1s under the slab, a combo of four)
(function () {
  var rows = ['G G G G G G', '1 4 2 3 4 5', '2 1 5 2 3 4', '1 3 4 5 2 3', '1 2 3 4 5 2'];   // top first
  var G = rows.reverse().map(function (l) { return [0].concat(l.split(' ').map(function (x) { return x === 'G' ? -2 : +x; })); });
  var fb = PA.game({ level: 10, seed: 3, countdown: false });
  for (var q = 0; q < 60; q++) fb.run();
  var id = 1000;
  for (var r = 0; r < fb.panels.length; r++) for (var c = 1; c <= 6; c++) {
    var p = fb.panels[r][c], v = r >= 1 && G[r - 1] ? G[r - 1][c] : (r === 0 ? p.color : 0);
    if (r === 0) continue;
    Object.assign(p, { color: v > 0 ? v : 0, isGarbage: false, garbageId: null, xOffset: null, yOffset: null, gWidth: 0, gHeight: 0, state: 'normal', timer: 0, chaining: false, matching: false, id: ++id });
    if (v < 0) Object.assign(p, { isGarbage: true, color: 9, garbageId: 1, gWidth: 6, gHeight: 1, xOffset: c - 1, yOffset: 0 });
  }
  Object.assign(fb, { garbageCreatedCount: 1, highestGarbageIdMatched: 0, panelIdCount: id });
  var probe = SH0.breakMoves(S00, fb, H0, [], 1, 0, Date.now() + 300, null, null, { touchInPop: true, near: true });
  assert.ok(probe && probe.depth, 'the built board has a break (the four)');
  boards.push({ b: fb, arr: [], name: 'the board whose break is a four', forbidden: true });
})();
assert.ok(boards.length >= 12, 'boards: ' + boards.length);

var n = { ready: 0, outlive: 0, outliveLost: 0, lost: 0, drop: 0, offered: 0 };
var SH = require('./survivor_shared.js'), PROPOSE = require('./gambit_propose.js'), S0 = new (require('./native.js').server.Search)({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 });
var landOf = function (arr) { var l = 0; arr.forEach(function (a) { if (a.at > l) l = a.at; }); return l; };
boards.forEach(function (B) {
  var b = B.b, arr = B.arr, land = landOf(arr);
  // READINESS: the hold and every swap, each called ready or not; every one called ready has its break judged again on its landed board
  var seqs = [[]].concat(b.legalSwaps().map(function (m) { return [m]; }));
  seqs.forEach(function (seq) {
    var j = A.judge(b, H0, seq, arr, { readyAt: land, why: true });
    if (j.dead || j.ready !== true) return;
    assert.ok(j.readyLine, B.name + ' ' + JSON.stringify(seq) + ': ready, with the break it found');
    var jb = A.judge(j.readyLine.board, H0, j.readyLine.seq, [], {});
    assert.ok(!jb.dead && jb.made.broke > 0, B.name + ' ' + JSON.stringify(seq) + ': called ready, but its break ' + JSON.stringify(j.readyLine.seq) + ' breaks nothing as the judge plays it');
    assert.ok(JUDGE.fitsList(list, jb.made, jb), B.name + ' ' + JSON.stringify(seq) + ': called ready on a break the list forbids (' + JSON.stringify(jb.made) + ')');
    n.ready++;
  });
  // OUTLIVE: the survival search's line, judged
  var sv = A.outlive(b, H0, arr, { to: HORIZON + REST, rest: REST, beam: 30, ms: 400 });
  if (sv && sv.seq.length) {
    var jl = A.judge(b, H0, sv.seq, arr, { lifeTo: HORIZON + REST, lifeRest: REST });
    if (sv.lostAt === Infinity) {
      assert.ok(!jl.dead && jl.lostAt === Infinity, B.name + ': the survival search says ' + JSON.stringify(sv.seq) + ' lives, the judge loses it at ' + jl.lostAt);
      assert.ok(JUDGE.fitsList(list, jl.made, jl), B.name + ': the survival search lives by ' + JSON.stringify(sv.seq) + ', which the list forbids (' + JSON.stringify(jl.made) + ')');
      n.outlive++;
    } else {
      assert.ok(jl.lostAt !== Infinity, B.name + ': the survival search says ' + JSON.stringify(sv.seq) + ' is lost at ' + sv.lostAt + ', the judge says it lives');
      n.outliveLost++;
    }
  }
  // OFFERED: the break search's lines, and the survival search's under the floor too, each taken by the judge's filters
  [false, true].forEach(function (low) {
    A.useRules({ fits: JUDGE.stepFits(list), floorLow: low });
    var br = SH.breakMoves(S0, b, H0, arr, 1, 0, Date.now() + 300, null, null, { touchInPop: true, near: true, ok: A.allowed, stepOk: A.stepOk });
    var lines = PROPOSE.breaks({ br: br }).map(function (k) { return k.seq; });
    var so = A.outlive(b, H0, arr, { to: HORIZON + REST, rest: REST, beam: 30, ms: 300 });
    if (so && so.seq.length && so.lostAt === Infinity) lines.push(so.seq);
    lines.forEach(function (seq) {
      var jo = A.judge(b, H0, seq, arr, {});
      if (jo.dead) return;
      assert.ok(JUDGE.fitsList(list, jo.made, jo), B.name + ': a search offered ' + JSON.stringify(seq) + ', which the list forbids (' + JSON.stringify(jo.made) + ')');
      if (low) assert.ok(!(jo.made.combo > 0 || jo.made.chain > 0) || jo.made.broke > 0, B.name + ': below the floor a search offered ' + JSON.stringify(seq) + ', which clears and breaks nothing');
      n.offered++;
    });
  });
  A.useRules({ fits: JUDGE.stepFits(list), floorLow: false });
  // LOSTAT: the board left alone, nothing coming but what is queued, against the game's engine run on until it is lost
  var jn = A.judge(b, H0, [], [], { lifeTo: 3000 }), g = b.copy(), c0 = g.clock;
  while (g.gameOverClock <= 0 && g.clock - c0 < 3000) g.run();
  var engineLost = g.gameOverClock > 0 ? g.clock - c0 : Infinity;
  assert.ok(Math.abs(jn.lostAt - engineLost) <= 1 || jn.lostAt === engineLost, B.name + ': the judge loses the board alone at ' + jn.lostAt + ', the engine at ' + engineLost);
  n.lost++;
  // DROPAT: one swap, pressed as the judge presses it, then the engine run on until stop, pre-stop and shake are all spent
  var mv = b.legalSwaps()[0], jd = A.judge(b, H0, [mv], [], {});
  if (!jd.dead && jd.ats && jd.ats.length) {
    var d = b.copy(), d0 = d.clock, pressed = false;
    for (var k = 0; k < 600 && !pressed; k++) { if (d.clock - d0 >= jd.ats[0] + 1) { d.curRow = mv[0]; d.curCol = mv[1]; pressed = !!d.tryQueueSwap(mv[0], mv[1]); } d.run(); }
    while (d.gameOverClock <= 0 && d.clock - d0 < jd.done) d.run();
    while (d.gameOverClock <= 0 && Math.max((d.stopTime || 0) + (d.preStopTime || 0), d.shakeTime || 0) > 0 && d.clock - d0 < 3000) d.run();
    if (pressed && d.gameOverClock <= 0) {
      assert.ok(Math.abs((d.clock - d0) - jd.dropAt) <= 2, B.name + ': the judge says garbage can drop at ' + jd.dropAt + ', the engine at ' + (d.clock - d0));
      n.drop++;
    }
  }
});
assert.ok(n.ready >= 10, 'ready lines judged again: ' + n.ready);
assert.ok(n.outlive + n.outliveLost >= 8, 'survival lines judged: ' + (n.outlive + n.outliveLost));
assert.ok(n.drop >= 8, 'drop frames checked: ' + n.drop);
assert.ok(n.offered >= 10, 'offered lines checked: ' + n.offered);
console.log('ok: every check agrees with the judge -- ' + n.ready + ' ready boards, ' + n.outlive + ' living and ' + n.outliveLost + ' losing survival lines, ' + n.lost + ' loss frames and ' + n.drop + ' drop frames, ' + n.offered + ' offered lines taken, on ' + boards.length + ' boards');
