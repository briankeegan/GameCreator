// GAMBIT'S DECISION, end to end (gambit_decide.js, plans/decision.md): on real boards of every mode, the judge counts what a line makes
// as it is pressed, and every line the decision ranks fits the mode's list, in rank order. Run: node gambit_decide.test.js
var assert = require('assert'), path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
var ATTACK = require('./survivor_attack.js'), GAMBIT = require('./gambit.js'), DECIDE = require('./gambit_decide.js'), JUDGE = require('./gambit_judge.js');
var at = ATTACK({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 }), hold = { left: 0, started: false };
var rules = GAMBIT.rulesFor({ gambit: { rules: 'survivor-profiles/gambit-rules.json' } }, __dirname);

// THE JUDGE: a planned line judged settle by settle makes what the planner said; the ok check stops it at the step that breaks it
var judged = 0;
for (var seed = 1; seed <= 30 && judged < 3; seed++) {
  var b = PA.game({ level: 10, seed: seed, countdown: false });
  for (var f = 0; f < 200; f++) b.run();
  var pa = at.plan(b, hold, { ms: 300, width: 30, depth: 4, pool: 120, aims: [function (mk) { return mk.chain >= 2; }] }).perAim[0];
  if (!pa) continue;
  judged++;
  var j = at.judge(b, hold, pa.seq, [], { settled: true });
  assert.ok(!j.dead && j.made.chain >= pa.chain, 'seed ' + seed + ': the judge sees the chain of ' + pa.chain + ' the planner made, got ' + JSON.stringify(j.made));
  var stop = at.judge(b, hold, pa.seq, [], { settled: true, ok: function (mk) { return mk.chain < 2; } });
  assert.strictEqual(stop.cut, pa.seq.length - 1, 'seed ' + seed + ': cut at the step that makes the chain');
  assert.strictEqual(at.judge(b, hold, pa.seq, [], { settled: true, ok: function () { return true; } }).cut, pa.seq.length, 'nothing outside: no cut');
}
assert.ok(judged >= 2, 'boards with a chain line to judge');

// THE DECISION: every mode, on boards a few seconds in -- it runs, ranks in order, and every line ranked fits the list
var modes = ['finish them', 'pressure', 'big chain', 'build'], decided = 0;
modes.forEach(function (mode) {
  for (var seed = 1; seed <= 4; seed++) {
    var b = PA.game({ level: 10, seed: seed, countdown: false });
    for (var f = 0; f < 240; f++) b.run();
    var bot = { _canRaise: function () { return true; } };
    var c = { bot: bot, m: { at: b.clock, hold: hold, topped: false, opp: null }, board: b, arrivals: [], br: null, brMs: 0, attacker: at, rules: rules,
              GP: { mode: mode, ms: 60, width: 30, depth: 5, pool: 120 }, pace: null, canRaise: function () { return false; }, left: function () { return 200; } };
    var R = DECIDE.read(c);
    assert.ok(R && R.pick.rule.name === mode, mode + ': the mode read');
    var cands = DECIDE.ranked(c, R, require('./gambit_propose.js').search(c, R));
    for (var i = 1; i < cands.length; i++) assert.ok(JUDGE.compare(cands[i - 1], cands[i]) <= 0, mode + ': ranked in order');
    cands.forEach(function (k) {
      var mk = at.judge(b, hold, k.seq, [], { settled: JUDGE.settled(k.play) }).made;
      assert.ok(GAMBIT.fits(R.list, mk), mode + ' seed ' + seed + ': ' + k.play + ' ' + JSON.stringify(k.seq) + ' makes ' + JSON.stringify(mk) + ', outside the list');
    });
    var D = DECIDE.decide(c);
    assert.ok(D && D.order.length, mode + ': a decision');
    decided++;
  }
});
console.log('ok: gambit decision -- the judge on ' + judged + ' planned lines, ' + decided + ' decisions over ' + modes.length + ' modes');
