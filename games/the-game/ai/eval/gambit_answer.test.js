// GAMBIT'S TURN through the mind (survivor_think.js -> gambit_answer.js), every mode, on real boards and on a board with a block landed:
// an answer comes back, Gambit's or the survival search's, and nothing it plays makes a chain past GAMBIT.MAXCHAIN.
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
    // (the choice is Gambit's: when any of its moves lives, the one played is Gambit's -- not the survival search's own ranking)
    var liveN = +String(a.diag.gambit.live || '0').split('/')[0];
    if (liveN > 0) assert.ok(a.src === 'gambit' && a.diag.gambit.why === 'gambit', mode + ' seed ' + seed + ': ' + liveN + ' of Gambit\'s moves live, but ' + a.src + ' (' + a.diag.gambit.why + ') chose');
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
// WHICH MOVES LIVE: a line of Gambit's that breaks, played out on the engine, lives though the survival search judged its first swap alone
// to die; the hold does not while the garbage shown loses the board and no plan is left; a line the judge could not play out does not
var GA = require('./gambit_answer.js'), brk = { seq: [[3, 2], [4, 2]], ap: { played: true, broke: 6 } }, lost = { seq: [[5, 1]], ap: { played: false, broke: 6 } };
var Lv = GA.living({ '3,2': 'dies', '5,1': 'dies', hold: 'weak' }, [brk, lost], true);
assert.ok(Lv.lived('3,2'), 'a break line the judge played out lives');
assert.ok(!Lv.lived('5,1'), 'a line the judge could not play out is the survival search\'s to judge');
assert.ok(!Lv.lived('hold'), 'no hold while the garbage shown loses an unready board');
assert.ok(GA.living({ hold: 'weak' }, [], false).lived('hold'), 'with a plan left, the hold is the survival search\'s to judge');
assert.ok(gambit >= answered / 2, 'Gambit chooses most moves: ' + gambit + ' of ' + answered);
console.log('ok: gambit answers -- ' + answered + ' questions over ' + modes.length + ' modes, ' + gambit + ' Gambit\'s own');
