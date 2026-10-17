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
assert.ok(gambit >= answered / 2, 'Gambit chooses most moves: ' + gambit + ' of ' + answered);
console.log('ok: gambit answers -- ' + answered + ' questions over ' + modes.length + ' modes, ' + gambit + ' Gambit\'s own');
