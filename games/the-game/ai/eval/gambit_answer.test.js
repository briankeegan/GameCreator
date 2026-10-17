// GAMBIT'S TURN through the mind (survivor_think.js -> gambit_answer.js), every mode, on real boards and on a board with a block landed:
// an answer comes back, Gambit's, and nothing it plays makes a chain past GAMBIT.MAXCHAIN.
// Run: node gambit_answer.test.js
var assert = require('assert'), path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), GAMBIT = require('./gambit.js');
var modes = ['finish', 'pressure', 'bigchain', 'build'], answered = 0, gambit = 0;
modes.forEach(function (mode) {
  process.env.GC_SURVIVOR_PROFILE = path.join(__dirname, 'survivor-profiles', 'gambit-' + mode + '.json');
  var profile = require('./survivor_shared.js').profile();
  var mind = require('./survivor_think.js')({ profile: profile, threads: 1 });
  for (var seed = 1; seed <= 3; seed++) {
    var b = PA.game({ level: 10, seed: seed, countdown: false });
    for (var f = 0; f < 300; f++) b.run();
    // (the second board: a block of garbage landed on it)
    if (seed === 3) { b.receiveGarbage && b.receiveGarbage({ width: 6, height: 2, isChain: false, isMetal: false }); for (f = 0; f < 120; f++) b.run(); }
    var a = mind.answer({ id: answered + 1, epoch: 0, at: b.clock, ms: 0, hold: { left: 0, started: false }, arrivals: [], board: b.copy(), acted: true });
    assert.ok(!a.error, mode + ' seed ' + seed + ': ' + a.error);
    assert.ok(a.kind === 'swap' || a.kind === 'hold' || a.kind === 'raise', mode + ' seed ' + seed + ': a move (' + a.kind + ')');
    assert.ok(a.src === 'gambit' || a.src === 'survival', mode + ': answered by Gambit or the survival search, got ' + a.src);
    assert.ok(a.diag && a.diag.gambit && a.diag.gambit.name, mode + ': the decision is Gambit\'s');
    // (the opening: a low stack with no garbage yet is raised)
    if (seed === 1) assert.strictEqual(a.kind, 'raise', mode + ': the opening raise is played (' + a.kind + ' ' + JSON.stringify(a.move) + ')');
    // (the one order's choice is what is played: when any candidate lives, the move played lives -- or is the opening's raise)
    var liveN = +String(a.diag.gambit.live || '0').split('/')[0];
    if (liveN > 0 && a.kind !== 'raise') assert.ok(a.diag.gambit.verdict === 'lives', mode + ' seed ' + seed + ': ' + liveN + ' candidates live, but ' + a.kind + ' (' + a.diag.gambit.verdict + ') was played');
    answered++; if (a.src === 'gambit') gambit++;
    mind.reset();
  }
});
// THE RAISE HELD DOWN: on a stack of a few rows the opening raise leaves the button held for the rows on to the rule's `to`
process.env.GC_SURVIVOR_PROFILE = path.join(__dirname, 'survivor-profiles', 'gambit-finish.json');
var low = PA.game({ level: 10, seed: 2, countdown: false });
for (var f0 = 0; f0 < 30; f0++) low.run();
var mindL = require('./survivor_think.js')({ profile: require('./survivor_shared.js').profile(), threads: 1 });
var up = mindL.answer({ id: 99, epoch: 0, at: low.clock, ms: 0, hold: { left: 0, started: false }, arrivals: [], board: low.copy(), acted: true });
assert.ok(up.kind === 'raise' && up.raiseFrames > 0 && up.raiseAfter > 0, 'a low stack is raised held down: ' + up.kind + ' ' + up.raiseFrames + '+' + up.raiseAfter);
// THE RAISE IS HELD FOR THE ROWS THAT LEAVE A PLAN: with nothing shown coming, every row asked; with more rows shown coming than the
// board can take once raised, fewer -- each row tried raised on the engine, everything landed, and a break line the board survives looked for
var AT = require('./survivor_attack.js')({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 }), H0 = { left: 0, started: false };
var flood = Array.apply(null, Array(9)).map(function (_, i) { return { at: 90 + i, width: 6, height: 1 }; });
assert.strictEqual(AT.raiseReady(low, H0, [], 5, 150), 5, 'nothing coming: every row');
var fewer = AT.raiseReady(low, H0, flood, 5, 300);
assert.ok(fewer < 5, 'nine rows coming: fewer rows raised (' + fewer + ')');
var est = GAMBIT.facts(low, flood, false).dies;
assert.ok(AT.diesIn(low, H0, flood, est) < est, 'the garbage on its way decides the frames left, not the rise alone');
// WHICH MOVES LIVE, from the one outcome (JUDGE.outcome): a low board with nothing coming lives held; under fourteen slabs shown coming
// it is lost left alone; topped out the hold buys no stop, so a break left for later is no life for it
var JUDGE = require('./gambit_judge.js'), AT0 = require('./survivor_attack.js')({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 });
var Rq = function (topped) { return { list: [{ combo: '>=5' }, { combo: '<=3', chain: '==1' }], F: { us: { nextLands: null, topped: !!topped } } }; };
var cOf = function (b, arr) { return { board: b, m: { hold: H0 }, arrivals: arr, attacker: AT0, tight: false, left: function () { return 1e9; } }; };
assert.ok(JUDGE.outcome(cOf(low, []), Rq(), [], false).lives, 'nothing coming: the hold lives');
var heavy = Array.apply(null, Array(14)).map(function (_, i) { return { at: 40 + i, width: 6, height: 2 }; });
var hv = JUDGE.outcome(cOf(low, heavy), Rq(), [], false);
assert.ok(!hv.lives && hv.lostAt < Infinity, 'fourteen slabs coming: the hold is lost (' + hv.lostAt + ')');
var tb = null;
for (var ts = 1; ts <= 20 && !tb; ts++) {
  var tg = PA.game({ level: 10, seed: ts, countdown: false });
  for (var tf = 0; tf < 400; tf++) tg.run();
  tg.receiveGarbage([{ width: 6, height: 4, isChain: false, isMetal: false }]);
  for (tf = 0; tf < 600 && !(tg.isToppedOut && tg.isToppedOut()) && tg.gameOverClock <= 0; tf++) tg.run();
  if (tg.gameOverClock <= 0 && tg.isToppedOut && tg.isToppedOut()) { tg.stopTime = 90; tb = tg; }
}
assert.ok(tb, 'a topped board');
var th = JUDGE.outcome(cOf(tb, []), Rq(true), [], false);
assert.ok(th.dead || th.ready !== true, 'topped: the hold buys no stop, and no plan left for later makes it live (ready ' + th.ready + ')');
// THE MOVE PLAYED IS THE ORDER'S FIRST: the raise only as the opening called for it; else the first candidate's first swap, or the hold
var GA = require('./gambit_answer.js'), lv = { o: { lives: true } }, dd = { o: { lives: false, lostAt: 50 } };
assert.strictEqual(GA.chosen({ R: { up: true }, info: {}, top: null, line: null }).d.kind, 'raise', 'the raise the opening called for');
assert.strictEqual(GA.chosen({ R: { up: false }, info: {}, top: Object.assign({ play: 'hold', hold: true }, lv), line: null }).d.kind, 'hold', 'the hold, ranked first');
var ln = Object.assign({ play: 'break search', seq: [[3, 2], [4, 2]] }, dd);
assert.deepStrictEqual(GA.chosen({ R: { up: false }, info: {}, top: ln, line: ln }).d.move, [3, 2], 'a line ranked first: its first swap');
// THE LINE PRESSED ON: an answer for a line the judge plays swap after swap hands the frame loop the swaps after the first
var handed = 0, settledHanded = 0;
['finish'].forEach(function (mode) {
  process.env.GC_SURVIVOR_PROFILE = path.join(__dirname, 'survivor-profiles', 'gambit-' + mode + '.json');
  var mindH = require('./survivor_think.js')({ profile: require('./survivor_shared.js').profile(), threads: 1 });
  for (var hs = 1; hs <= 12; hs++) {
    var hb = PA.game({ level: 10, seed: hs, countdown: false });
    for (var hf = 0; hf < 200; hf++) hb.run();
    hb.receiveGarbage([{ width: 6, height: 2, isChain: false, isMetal: false }]);
    for (hf = 0; hf < 100; hf++) hb.run();
    if (hb.gameOverClock > 0) continue;
    var ha = mindH.answer({ id: 500 + hs, epoch: 0, at: hb.clock, ms: 0, hold: { left: 0, started: false }, arrivals: [], board: hb.copy(), acted: true });
    var g = ha.diag && ha.diag.gambit;
    if (ha.kind === 'swap' && g && g.seq && g.seq.length > 1) {
      if (ha.line) { handed++; assert.ok(ha.lineFree && ha.line.length === g.seq.length - 1, 'seed ' + hs + ': the rest of the line is handed on'); }
    }
    mindH.reset();
  }
});
assert.ok(handed > 0, 'lines handed on to the frame loop: ' + handed);
// THE SEARCH CARRIED ON PAST WHAT WAS PRESSED: the kept lines less the move decided and the steps of the handed-on line the frame loop
// says it pressed (lineFrom, linePressed); a question about another answer's line strips the decided move alone
var cb = PA.game({ level: 10, seed: 4, countdown: false });
for (var cf = 0; cf < 200; cf++) cb.run();
cb.receiveGarbage([{ width: 6, height: 1, isChain: false, isMetal: false }]);
for (cf = 0; cf < 100; cf++) cb.run();
var gid0 = null, gr0 = require('./survivor_shared.js').lowestGarbageRow(cb);
for (var gc0 = 1; gc0 <= 6 && gid0 === null; gc0++) if (cb.panels[gr0][gc0].isGarbage) gid0 = cb.panels[gr0][gc0].garbageId;
var K0 = { paths: [[[2, 1], [2, 3], [3, 4], [4, 5]], [[2, 2], [2, 3]]], gid: gid0, anchor: { row: 1, col: 6, id: cb.panels[1][6].id }, id: 77, played: [2, 1], handed: [[2, 3], [3, 4], [4, 5]] };
var cc0 = function (from, pressed) { return { bot: { _brKeep: K0 }, board: cb, m: { lineFrom: from, linePressed: pressed } }; };
assert.deepStrictEqual(GA.carriedPaths(cc0(77, 1)), [[[3, 4], [4, 5]]], 'the move and one pressed step of the handed line taken off');
assert.deepStrictEqual(GA.carriedPaths(cc0(12, 3)), [[[2, 3], [3, 4], [4, 5]]], 'another answer\'s line: the decided move alone taken off');
// A DECISION'S TIME IS THE TIME TO ITS MOVE: a question asked 90 frames ahead, with 1.5 s to spare, is answered within a reaction's
// frames (13 at 60 a second, 217 ms) -- the answer's margin over it at most
process.env.GC_SURVIVOR_PROFILE = path.join(__dirname, 'survivor-profiles', 'gambit-finish.json');
var mindT = require('./survivor_think.js')({ profile: require('./survivor_shared.js').profile(), threads: 1 }), worstT = 0;
for (var ts2 = 1; ts2 <= 4; ts2++) {
  var tb2 = PA.game({ level: 10, seed: ts2, countdown: false });
  for (var tf2 = 0; tf2 < 200; tf2++) tb2.run();
  tb2.receiveGarbage([{ width: 6, height: 2, isChain: false, isMetal: false }]);
  for (tf2 = 0; tf2 < 100; tf2++) tb2.run();
  if (tb2.gameOverClock > 0) continue;
  var tq = Date.now(), ta = mindT.answer({ id: 900 + ts2, epoch: 0, at: tb2.clock, lead: 90, ms: 1500, posted: tq, hold: { left: 0, started: false }, arrivals: [{ at: 60, width: 6, height: 2 }], board: tb2.copy(), acted: true });
  assert.ok(ta && !ta.error, 'answered: ' + (ta && ta.error));
  worstT = Math.max(worstT, Date.now() - tq);
  mindT.reset();
}
assert.ok(worstT < 217 + 30 + 60, 'a decision asked 90 frames ahead takes the time to its move, not the lead: ' + worstT + ' ms');
// A DIG NEVER GOES ROUND IN A CIRCLE: a topped board under a twelve-row slab, played decision after decision as the frame loop plays it,
// each move pressed on the engine -- every swap toward a break leaves a board this dig has not stood on before
var SHt = require('./survivor_shared.js'), mindD = require('./survivor_think.js')({ profile: SHt.profile(), threads: 1 }), towardN = 0, dugBoards = 0;
for (var ds = 1; ds <= 3; ds++) {
  var db = PA.game({ level: 10, seed: ds, countdown: false });
  for (var dfr = 0; dfr < 200; dfr++) db.run();
  db.receiveGarbage([{ width: 6, height: 12, isChain: false, isMetal: false }]);
  for (dfr = 0; dfr < 120 && !SHt.lowestGarbageRow(db) && db.gameOverClock <= 0; dfr++) db.run();
  if (db.gameOverClock > 0 || !SHt.lowestGarbageRow(db)) continue;
  db.stopTime = 600;   // (landed: the stop a break would have bought, the time the dig is given)
  var stood = new Set();
  for (var dn = 0; dn < 20 && db.gameOverClock <= 0; dn++) {
    stood.add(SHt.boardKey(db));
    var da = mindD.answer({ id: 2000 + ds * 50 + dn, epoch: 0, at: db.clock, lead: 13, ms: 216, posted: Date.now(), hold: { left: 0, started: false }, arrivals: [], board: db.copy(), acted: true });
    if (!da || da.kind !== 'swap') { for (dfr = 0; dfr < 13; dfr++) db.run(); continue; }
    var dplay = da.diag && da.diag.gambit && da.diag.gambit.play;
    db.curRow = da.move[0]; db.curCol = da.move[1];
    if (!db.tryQueueSwap(da.move[0], da.move[1])) { for (dfr = 0; dfr < 13; dfr++) db.run(); continue; }
    for (dfr = 0; dfr < 6; dfr++) db.run();
    if (dplay === 'toward') { towardN++; assert.ok(!stood.has(SHt.boardKey(db)), 'seed ' + ds + ' decision ' + dn + ': a swap toward a break went back to a board the dig stood on'); }
    for (dfr = 0; dfr < 7; dfr++) db.run();
    dugBoards++;
  }
  mindD.reset();
}
assert.ok(towardN > 0, 'swaps toward a break played: ' + towardN + ' of ' + dugBoards + ' moves');
// (and the rule itself: of two lines toward a break, the first leading back to a board the dig stood on, the second is offered)
var PROPt = require('./gambit_propose.js'), tbd = PA.game({ level: 10, seed: 5, countdown: false });
for (dfr = 0; dfr < 200; dfr++) tbd.run();
var tsw = tbd.legalSwaps(), backLine = [tsw[0]], fwdLine = [tsw[1]], seenT = new Set([SHt.boardAfter(tbd, tsw[0])]);
var offeredT = PROPt.toward({ board: tbd, br: { towards: [backLine, fwdLine] }, seenDig: seenT }, { under: true });
assert.deepStrictEqual(offeredT[0] && offeredT[0].seq, fwdLine, 'the line back to a board stood on is passed over');
assert.deepStrictEqual(PROPt.toward({ board: tbd, br: { towards: [backLine, fwdLine] }, seenDig: new Set() }, { under: true })[0].seq, backLine, 'with nothing stood on, the first line');
// READY WHEN EVERYTHING LANDS: with garbage on its way, a line that breaks nothing lives only when a break is there once it has landed --
// standing on stop time is not enough. A board under a slab with 600 frames of stop, a second twelve-row slab shown coming: the hold
// stands to the horizon, and lives only as it is ready
var Rr = { list: [{ combo: '>=5' }, { combo: '<=3', chain: '==1' }], F: { us: { nextLands: null, topped: false } } }, readyChecked = 0;
for (var rs = 1; rs <= 6; rs++) {
  var rb = PA.game({ level: 10, seed: rs, countdown: false });
  for (var rf = 0; rf < 200; rf++) rb.run();
  rb.receiveGarbage([{ width: 6, height: 6, isChain: false, isMetal: false }]);
  for (rf = 0; rf < 160 && rb.gameOverClock <= 0 && !SHt.lowestGarbageRow(rb); rf++) rb.run();
  if (rb.gameOverClock > 0) continue;
  rb.stopTime = 600;
  var ro = JUDGE.outcome(cOf(rb, [{ at: 40, width: 6, height: 12 }]), Rr, [], false);
  if (ro.dead || ro.lostAt !== Infinity) continue;
  assert.strictEqual(ro.lives, ro.ready === true, 'seed ' + rs + ': the hold stands on its stop (lostAt Infinity) and lives only as it is ready (' + ro.ready + ')');
  readyChecked++;
}
assert.ok(readyChecked > 0, 'boards standing on stop with a slab coming: ' + readyChecked);
// HEALTH IS IGNORED: every board Gambit judges has level 10's health (planHealth), and one where nothing lives is judged so again --
// no decision ever counts on the health a game gives
var SHh = require('./survivor_shared.js'), mindH2 = require('./survivor_think.js')({ profile: SHh.profile(), threads: 1 }), doomedSeen = 0;
var origErr = console.error;
for (var hs2 = 1; hs2 <= 6 && !doomedSeen; hs2++) {
  var hb2 = PA.game({ level: 10, seed: hs2, countdown: false });
  for (var hf2 = 0; hf2 < 200; hf2++) hb2.run();
  hb2.receiveGarbage([{ width: 6, height: 12, isChain: false, isMetal: false }]);
  for (hf2 = 0; hf2 < 160 && hb2.gameOverClock <= 0 && !(SHh.lowestGarbageRow(hb2) && hb2.isToppedOut && hb2.isToppedOut()); hf2++) hb2.run();
  if (hb2.gameOverClock > 0) continue;
  hb2.health = 51;   // (training's health: never counted on)
  var logs = [];
  console.error = function (x) { if (typeof x === 'string' && x.indexOf('GAMBITD ') === 0) logs.push(x); };
  var a1 = mindH2.answer({ id: 3000 + hs2, epoch: 0, at: hb2.clock, lead: 13, ms: 216, posted: Date.now(), hold: { left: 0, started: false }, arrivals: [], board: hb2.copy(), acted: true });
  mindH2.answer({ id: 3100 + hs2, epoch: 0, at: hb2.clock + 13, lead: 13, ms: 216, posted: Date.now(), hold: { left: 0, started: false }, arrivals: [], board: hb2.copy(), acted: true });
  console.error = origErr;
  logs.forEach(function (l) { assert.strictEqual(+((/ hp=(\d+)/.exec(l) || [])[1]), 1, 'every board judged at level 10 health: ' + l.slice(0, 40)); });
  if (a1.diag.gambit.lives === false) doomedSeen++;
  mindH2.reset();
}
assert.ok(doomedSeen > 0, 'a board where nothing lives at level 10 health, judged at it again');
assert.ok(gambit >= answered / 2, 'Gambit chooses most moves: ' + gambit + ' of ' + answered);
console.log('ok: gambit answers -- ' + answered + ' questions over ' + modes.length + ' modes, ' + gambit + ' Gambit\'s own');
