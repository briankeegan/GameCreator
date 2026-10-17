// THE OUTCOME AND THE SHARED LINE CHECK IN C ARE gambit_judge.js's: on boards of every kind, lines of one to four swaps and the break
// the break search finds, and the decision's facts every way they come -- topped or not, garbage shown coming or queued (nextLands) or
// none, time left for readiness or not, below the material floor or not -- outcome.c says what JUDGE.outcome says (dead, lostAt,
// lives, fits, ready, and the judge's answer it read) and lineFits what JUDGE.lineFits says. Run: node outcome.test.js
process.env.GC_NATIVE_WASM = process.env.GC_NATIVE_WASM || require('path').join(__dirname, 'gambit.wasm');
var assert = require('assert'), path = require('path'), EV = path.join(__dirname, '..', 'eval');
var PA = require(path.join(EV, '..', '..', 'pa-engine.js')), N = require(path.join(EV, 'native.js')).server, JUDGE = require(path.join(EV, 'gambit_judge.js'));
var SH = require(path.join(EV, 'survivor_shared.js'));
var A = require(path.join(EV, 'survivor_attack.js'))({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 });
var R0 = new N.Search({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 }), X = N.exports(), GB = require('./gambit.js').bind(X);
X.gb_config(12, 12, 4);
var rules = require(path.join(EV, 'survivor-profiles', 'gambit-rules.json'));
var list = rules.attack.filter(function (r) { return r.name === 'finish them'; })[0].aims.filter(function (a) { return typeof a === 'object'; });
A.useRules({ fits: JUDGE.stepFits(list), floorLow: false });
GB.list(list); X.gb_list_on(1);
var state = 777;
function rand(n) { state = (state * 1103515245 + 12345) % 2147483648; return Math.floor(state / 65536) % n; }
function lineOn(b, len) {
  var g = b.copy(), seq = [];
  for (var k = 0; k < len; k++) {
    var ms = g.legalSwaps(); if (!ms.length) break;
    var mv = ms[rand(ms.length)]; seq.push(mv);
    g.curRow = mv[0]; g.curCol = mv[1]; if (!g.tryQueueSwap(mv[0], mv[1])) break;
    for (var f = 0; f < 13; f++) g.run();
  }
  return seq;
}
var hold = { left: 0, started: false }, checked = 0, seen = { lives: 0, dies: 0, fits: 0, misfits: 0, lineOk: 0, lineNo: 0, ready: 0 };
for (var seed = 1; seed <= 24; seed++) {
  var b = PA.game({ level: 10, seed: seed, countdown: false }), kind = seed % 6;
  for (var f = 0; f < 150 + seed * 7; f++) b.run();
  if (kind >= 1) b.receiveGarbage([{ width: 6, height: 1 + seed % 3, isChain: false, isMetal: false }]);
  if (kind >= 3) b.receiveGarbage([{ width: 6, height: 2 + seed % 4, isChain: false, isMetal: false }]);
  for (f = 0; f < 120 + (seed % 5) * 30; f++) b.run();
  if (b.gameOverClock > 0) continue;
  var arr = kind === 2 || kind === 4 ? [{ at: 30 + seed * 3, width: 6, height: 2 }] : kind === 5 ? [{ at: 20, width: 6, height: 12 }] : [];
  var lines = [1, 2, 3, 4].map(function (len) { return lineOn(b, len); }).concat([[]]);
  // (and a swap that clears panels and breaks nothing: what a strict list, or the floor, refuses)
  var clr = b.legalSwaps().filter(function (mv) { var j = A.judge(b, hold, [mv], [], {}); return !j.dead && j.made.combo > 0 && !(j.made.broke > 0); })[0];
  if (clr) lines.push([clr]);
  if (SH.lowestGarbageRow(b)) {
    var br = SH.breakMoves(R0, b, hold, arr, 1, 0, Date.now() + 300, null, null, { touchInPop: true, near: true });
    if (br && br.depth) lines.push(br.path || [Object.keys(br.moves)[0].split(',').map(Number)]);
  }
  // (every other board under a strict list -- a chain of eight or more -- so lines that make what the list does not ask are judged too)
  var L = seed % 2 ? list : [{ chain: '>=8' }];
  A.useRules({ fits: JUDGE.stepFits(L), floorLow: false }); GB.list(L);
  [0, 1, 2, 3].forEach(function (fk) {
    var topped = fk === 1, nextLands = fk === 2 ? 50 : null, timeLeft = fk !== 3, floor = fk === 3 || seed % 4 === 0;
    var tight = seed % 3 === 0;
    var c = { board: b, m: { hold: hold }, arrivals: arr, attacker: A, tight: tight, left: function () { return timeLeft ? 1e9 : -1; } };
    var R = { list: L, keep: floor ? { material: '>=99' } : undefined, F: { us: { topped: topped, nextLands: nextLands, material: 10 } } };
    var land = JUDGE.lastLanding(c, R), root = R0.root(b.copy(), hold, arr, false);
    assert.strictEqual(X.gb_decision_start(R0.ctx, root._i, tight ? 1 : 0, land === null || land === undefined ? -1 : land, topped ? 1 : 0, timeLeft ? 1 : 0, floor ? 1 : 0), 0);
    lines.forEach(function (seq) { [false, true].forEach(function (st) {
      var js = JUDGE.outcome(c, R, seq, st), lf = JUDGE.lineFits(c, R, seq, st).ok, at = 'seed ' + seed + ' facts ' + fk + ' ' + JSON.stringify(seq) + (st ? ' settled' : '');
      var w = GB.body(64); seq.forEach(function (mv, i) { w[i] = mv[0] * 8 + mv[1]; });
      var n = X.gb_outcome(seq.length, st ? 1 : 0); w = GB.body(n);
      assert.strictEqual(w[5], 0, at + ': not late');
      assert.strictEqual(w[0] === 1, !!js.dead, at + ': dead');
      assert.strictEqual(w[1], js.lostAt === Infinity ? 0x7fffffff : js.lostAt, at + ': lostAt');
      assert.strictEqual(w[2] === 1, !!js.lives, at + ': lives');
      if (!js.dead) {
        assert.strictEqual(w[3] === 1, !!js.fits, at + ': fits');
        assert.strictEqual(w[4], js.ready === true ? 1 : js.ready === undefined ? -1 : 0, at + ': ready (' + js.ready + ')');
        assert.deepStrictEqual({ combo: w[6], chain: w[7], broke: w[8] }, { combo: js.made.combo, chain: js.made.chain, broke: js.made.broke }, at + ': made');
        assert.deepStrictEqual([w[9], w[10], w[11], w[12]], [js.chainAll, js.dropAt, js.done, js.fire === null ? -1 : js.fire], at + ': chainAll, dropAt, done, fire');
      }
      w = GB.body(64); seq.forEach(function (mv, i) { w[i] = mv[0] * 8 + mv[1]; });
      assert.strictEqual(X.gb_line_fits(seq.length, st ? 1 : 0) === 1, lf, at + ': the line check');
      checked++; seen[js.lives ? 'lives' : 'dies']++; if (!js.dead) seen[js.fits ? 'fits' : 'misfits']++; seen[lf ? 'lineOk' : 'lineNo']++; if (js.ready === true) seen.ready++;
    }); });
  });
}
Object.keys(seen).forEach(function (k) { assert.ok(seen[k] > 0, 'lines that ' + k + ': ' + seen[k]); });
console.log('ok: the outcome and the line check in C -- ' + checked + ' lines as gambit_judge.js judges them ' + JSON.stringify(seen));
