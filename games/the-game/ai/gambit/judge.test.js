// THE JUDGE IN C IS attacker.judge: on boards of every kind -- quiet, garbage resting, a slab popping, garbage on its way, topped -- and
// lines of one to four swaps, settled and not, walked tight and not, with readiness and the loss asked, judge.c gives every field the
// JavaScript judge gives: dead and when, what it makes, the chain it reaches, its clears of their own, when garbage can next drop,
// every press, when it is done, when the board is lost, whether it is ready and the line that makes it so. Both run on gambit.wasm,
// on the same nodes. Run: node judge.test.js
process.env.GC_NATIVE_WASM = process.env.GC_NATIVE_WASM || require('path').join(__dirname, 'gambit.wasm');
var assert = require('assert'), path = require('path'), EV = path.join(__dirname, '..', 'eval');
var PA = require(path.join(EV, '..', '..', 'pa-engine.js')), N = require(path.join(EV, 'native.js')).server, JUDGE = require(path.join(EV, 'gambit_judge.js'));
var A = require(path.join(EV, 'survivor_attack.js'))({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 });
var R0 = new N.Search({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 }), X = N.server ? null : N.exports(), G = require('./gambit.js');
X = N.exports();
var GB = G.bind(X);
X.gb_config(12, 12, 4);
var rules = require(path.join(EV, 'survivor-profiles', 'gambit-rules.json'));
var list = GAMBITlist('finish them');
function GAMBITlist(name) { return rules.attack.filter(function (r) { return r.name === name; })[0].aims.filter(function (a) { return typeof a === 'object'; }); }
A.useRules({ fits: JUDGE.stepFits(list), floorLow: false });
GB.list(list); X.gb_list_on(1);

var state = 12345;
function rand(n) { state = (state * 1103515245 + 12345) % 2147483648; return Math.floor(state / 65536) % n; }
function boards() {
  var out = [];
  for (var seed = 1; seed <= 24; seed++) {
    var b = PA.game({ level: 10, seed: seed, countdown: false }), kind = seed % 6;
    for (var f = 0; f < 150 + seed * 7; f++) b.run();
    if (kind >= 1) b.receiveGarbage([{ width: 6, height: 1 + seed % 3, isChain: false, isMetal: false }]);
    if (kind >= 3) b.receiveGarbage([{ width: 6, height: 2 + seed % 4, isChain: false, isMetal: false }]);
    for (f = 0; f < 120 + (seed % 5) * 30; f++) b.run();
    if (b.gameOverClock > 0) continue;
    var arr = kind === 2 || kind === 4 ? [{ at: 30 + seed * 3, width: 6, height: 2 }] : kind === 5 ? [{ at: 20, width: 6, height: 12 }, { at: 90, width: 6, height: 3 }] : [];
    out.push({ b: b, arr: arr, seed: seed });
  }
  return out;
}
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
function read(w) {
  var k = 0, o = { dead: w[k++], deadAt: w[k++], made: { combo: w[k++], chain: w[k++], broke: w[k++] }, chainAll: w[k++], dropAt: w[k++], done: w[k++],
                   fire: w[k++], lostAt: w[k++], ready: w[k++], late: w[k++] };
  var n = w[k++]; o.ats = Array.prototype.slice.call(w, k, k + n); k += n;
  n = w[k++]; o.singles = Array.prototype.slice.call(w, k, k + n); k += n;
  n = w[k++]; o.readyLine = Array.prototype.slice.call(w, k, k + n); k += n;
  return o;
}
var judged = 0, kinds = { dead: 0, broke: 0, ready: 0, notReady: 0, lost: 0, tight: 0, singles: 0 };
boards().forEach(function (B) {
  var hold = { left: 0, started: false }, root = R0.root(B.b.copy(), hold, B.arr, false);
  // (the lines: random ones of each length, and the break the break search finds on a board under garbage)
  var SH = require(path.join(EV, 'survivor_shared.js')), lines = [0, 1, 2, 3, 4].map(function (len) { return lineOn(B.b, len); });
  if (SH.lowestGarbageRow(B.b)) {
    var br = SH.breakMoves(R0, B.b, hold, B.arr, 1, 0, Date.now() + 300, null, null, { touchInPop: true, near: true });
    if (br && br.depth) lines.push(br.path || [Object.keys(br.moves)[0].split(',').map(Number)]);
  }
  lines.forEach(function (line, len) {
    [false, true].forEach(function (settled) { [false, true].forEach(function (tight) {
      var seq = line, land = B.arr.length ? Math.max.apply(null, B.arr.map(function (a) { return a.at; })) : 40;
      var o = { settled: settled, tight: tight, readyAt: land, lifeTo: 360, lifeRest: 120, readyIfLost: !B.arr.length, readyIfBreak: len % 2 === 1, why: true };
      var js = A.judge(B.b, hold, seq, B.arr, o);
      root = R0.root(B.b.copy(), hold, B.arr, false);
      assert.strictEqual(X.gb_question(R0.ctx, root._i, tight ? 1 : 0), 0, 'the question');
      var w = GB.body(64); seq.forEach(function (mv, i) { w[i] = mv[0] * 8 + mv[1]; });
      var nw = X.gb_judge(seq.length, settled ? 1 : 0, tight ? 1 : 0, o.readyAt, o.readyIfLost ? 1 : 0, o.readyIfBreak ? 1 : 0, o.lifeTo, o.lifeRest, 1);
      var c = read(GB.body(nw)), at = 'seed ' + B.seed + ' ' + JSON.stringify(seq) + (settled ? ' settled' : '') + (tight ? ' tight' : '');
      assert.strictEqual(c.late, 0, at + ': not late');
      assert.strictEqual(c.dead === 1, js.dead, at + ': dead');
      assert.deepStrictEqual(c.made, js.made, at + ': made');
      assert.strictEqual(c.chainAll, js.chainAll, at + ': chainAll');
      assert.deepStrictEqual(c.singles, js.singles.slice().sort(function (a, b) { return a - b; }), at + ': singles');
      assert.strictEqual(c.dropAt, js.dropAt, at + ': dropAt');
      assert.strictEqual(c.done, js.done, at + ': done');
      assert.deepStrictEqual(c.ats, js.ats, at + ': ats');
      assert.strictEqual(c.fire, js.fire === null ? -1 : js.fire, at + ': fire');
      assert.strictEqual(c.lostAt, js.lostAt === Infinity ? 0x7fffffff : js.lostAt, at + ': lostAt');
      assert.strictEqual(c.ready, js.ready === true ? 1 : js.ready === undefined ? -1 : 0, at + ': ready (' + js.ready + ')');
      if (js.readyLine) assert.deepStrictEqual(c.readyLine, js.readyLine.seq.map(function (mv) { return mv[0] * 8 + mv[1]; }), at + ': the ready line');
      judged++;
      if (js.dead) kinds.dead++; if (js.made.broke > 0) kinds.broke++; if (js.ready === true) kinds.ready++; if (js.ready === false) kinds.notReady++;
      if (js.lostAt !== Infinity) kinds.lost++; if (tight) kinds.tight++; if (js.singles.length) kinds.singles++;
    }); });
  });
});
Object.keys(kinds).forEach(function (k) { if (k !== 'singles') assert.ok(kinds[k] > 0, 'lines judged that are ' + k + ': ' + kinds[k]); });
console.log('ok: the judge in C -- ' + judged + ' lines judged as attacker.judge judges them ' + JSON.stringify(kinds));
