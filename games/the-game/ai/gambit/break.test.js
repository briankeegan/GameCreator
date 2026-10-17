// THE BREAK SEARCH IN C IS breakMoves, AS GAMBIT ASKS IT: on boards under garbage -- resting, a slab popping, garbage on its way --
// with Gambit's rules (each step within the list, the swap back refused as a first swap, every break through the shared line check)
// and the lines the last decision carried on, search/break.c finds what survivor_shared.js breakMoves finds, with nothing to stop
// either: the depth, the first swaps that break and how (the line, the line-up pairs, the beam it was found in, carried or not), when,
// and with none found the line toward a break, the lines to choose among and the frontier carried on. Run: node break.test.js
process.env.GC_NATIVE_WASM = process.env.GC_NATIVE_WASM || require('path').join(__dirname, 'gambit.wasm');
var assert = require('assert'), path = require('path'), EV = path.join(__dirname, '..', 'eval');
var PA = require(path.join(EV, '..', '..', 'pa-engine.js')), N = require(path.join(EV, 'native.js')).server, JUDGE = require(path.join(EV, 'gambit_judge.js'));
var SH = require(path.join(EV, 'survivor_shared.js'));
var A = require(path.join(EV, 'survivor_attack.js'))({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 });
var R0 = new N.Search({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 }), BS = new N.Search({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 });
var X = N.exports(), GB = require('./gambit.js').bind(X);
X.gb_config(12, 12, 4); X.gb_clock_start(0);
var rules = require(path.join(EV, 'survivor-profiles', 'gambit-rules.json'));
var list = rules.attack.filter(function (r) { return r.name === 'finish them'; })[0].aims.filter(function (a) { return typeof a === 'object'; });
GB.list(list); X.gb_list_on(1);
var LINEUP_AFTER = 30, hold = { left: 0, started: false };
function enc(mv) { return mv[0] * 8 + mv[1]; }
function readPaths(w, k) { var n = w[k.i++], out = []; for (var i = 0; i < n; i++) { var len = w[k.i++], p = []; for (var j = 0; j < len; j++) p.push(w[k.i++]); out.push(p); } return out; }
function cOf(b, arr) {
  var c = { board: b, m: { hold: hold, at: b.clock }, arrivals: arr, attacker: A, tight: false, bot: {}, left: function () { return 1e9; } };
  var Rl = { list: list, keep: undefined, F: { us: { material: 99 } } };
  A.useRules({ fits: JUDGE.stepFits(list), floorLow: false, first: function (mv, clears) { return !JUDGE.swapBack(c, mv, clears); },
               line: function (seq, st) { return JUDGE.lineFits(c, Rl, seq, st).ok; } });
  return c;
}
var seen = { depth1: 0, none: 0, touch: 0, lineup: 0, carried: 0, back: 0, toward: 0 }, checked = 0;
function check(b, arr, resume, label, c) {
  var pop = SH.popLeft(b), wait = pop ? pop + LINEUP_AFTER : 0, keepOut = {};
  var js = SH.breakMoves(BS, b, hold, arr, 1, wait, 0, null, null,
                         { touchInPop: true, near: true, ok: A.allowed, stepOk: A.stepOk, firstOk: A.firstOk, resume: resume, keepOut: keepOut, lineOk: A.lineOk });
  var root = R0.root(b.copy(), hold, arr, false);
  assert.strictEqual(X.gb_decision_start(R0.ctx, root._i, 0, -1, 0, 1, 0), 0);
  var lp = c.bot._gambitLastPair;
  if (lp) { var ab = lp.split(',').map(Number); X.gb_back(ab[0], ab[1], 0, 0, 0, 0, b.clock); } else X.gb_back(0, 0, 0, 0, 0, 0, b.clock);
  var w = GB.body(4096), k = 0;
  (resume || []).forEach(function (p) { w[k++] = p.length; p.forEach(function (mv) { w[k++] = enc(mv); }); });
  var nw = X.gb_break(wait, (resume || []).length); w = GB.body(nw);
  var r = { i: 0 }, g = { depth: w[r.i++], at: w[r.i++], touch: w[r.i++], carried: w[r.i++], wide: w[r.i++], lineup: w[r.i++], full: w[r.i++] };
  var nm = w[r.i++]; g.moves = []; g.pairs = [];
  for (var i = 0; i < nm; i++) { g.moves.push(w[r.i++]); g.pairs.push([w[r.i++], w[r.i++]]); }
  var pl = w[r.i++]; g.path = Array.prototype.slice.call(w, r.i, r.i + pl); r.i += pl;
  var tl = w[r.i++]; g.toward = Array.prototype.slice.call(w, r.i, r.i + tl); r.i += tl;
  g.towards = readPaths(w, r); g.keepOut = readPaths(w, r);
  var at = label + ' wait ' + wait + (resume ? ' resumed ' + resume.length : '');
  assert.strictEqual(g.full, 0, at + ': the lines had room');
  assert.strictEqual(g.depth, js.depth, at + ': depth');
  var jsMoves = Object.keys(js.moves || {}).map(function (key) { return enc(key.split(',').map(Number)); });
  assert.deepStrictEqual(g.moves, jsMoves, at + ': the first swaps that break');
  if (js.depth) {
    assert.strictEqual(!!g.touch, !!js.touch, at + ': touch');
    assert.strictEqual(!!g.carried, !!js.carried, at + ': carried');
    if (js.path) assert.deepStrictEqual(g.path, js.path.map(enc), at + ': the line');
    if (js.at !== undefined) assert.strictEqual(g.at, js.at, at + ': when');
    if (js.wide !== undefined) assert.strictEqual(g.wide, js.wide, at + ': the beam');
    var LU = { true: 1, 2: 2, aimed: 3, ready: 4 };
    assert.strictEqual(g.lineup, js.lineup ? LU[js.lineup] : 0, at + ': the line-up (' + js.lineup + ')');
    if (js.lines) jsMoves.forEach(function (m, i) { var key = Object.keys(js.moves)[i]; if (js.lines[key]) assert.deepStrictEqual(g.pairs[i], js.lines[key].map(enc), at + ': the pair'); });
    seen.depth1++; if (js.touch) seen.touch++; if (js.lineup) seen.lineup++; if (js.carried) seen.carried++;
  } else {
    assert.deepStrictEqual(g.toward, (js.toward || []).map(enc), at + ': toward');
    assert.deepStrictEqual(g.towards, (js.towards || []).map(function (p) { return p.map(enc); }), at + ': towards');
    seen.none++; if (js.toward) seen.toward++;
  }
  assert.deepStrictEqual(g.keepOut, (keepOut.paths || []).map(function (p) { return p.map(enc); }), at + ': the frontier carried on');
  checked++;
  return keepOut.paths;
}
for (var seed = 1; seed <= 40; seed++) {
  var b = PA.game({ level: 10, seed: seed, countdown: false }), kind = seed % 5;
  for (var f = 0; f < 150 + seed * 5; f++) b.run();
  b.receiveGarbage([{ width: 6, height: 1 + seed % 4, isChain: false, isMetal: false }]);
  if (kind === 3) b.receiveGarbage([{ width: 3 + seed % 4, height: 1, isChain: false, isMetal: false }]);
  for (f = 0; f < 100 + (seed % 7) * 25; f++) b.run();
  if (b.gameOverClock > 0 || !SH.lowestGarbageRow(b)) continue;
  var arr = kind === 2 ? [{ at: 40, width: 6, height: 2 }] : [];
  var c = cOf(b, arr);
  // (every fourth board: the last swap made is the pair of its first legal swap -- the swap back the rules refuse)
  if (seed % 4 === 0) { var mv = b.legalSwaps()[0], pa = b.panels[mv[0]][mv[1]], pb = b.panels[mv[0]][mv[1] + 1]; c.bot._gambitLastPair = [pa.id, pb.id].sort().join(','); seen.back++; }
  var frontier = check(b, arr, null, 'seed ' + seed, c);
  if (frontier && frontier.length) check(b, arr, frontier, 'seed ' + seed, c);
}
['depth1', 'none', 'touch', 'carried', 'back', 'toward'].forEach(function (k) { assert.ok(seen[k] > 0, 'searches that are ' + k + ': ' + seen[k]); });
console.log('ok: the break search in C -- ' + checked + ' searches as breakMoves makes them ' + JSON.stringify(seen));
