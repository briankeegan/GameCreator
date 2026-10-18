// GAMBIT'S TURN through the mind (survivor_think.js -> gambit/gambit.wasm), every mode, on real boards and on a board with a block landed:
// an answer comes back, Gambit's, and what it plays lives when anything does.
// Run: node gambit_answer.test.js
var assert = require('assert'), path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
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
