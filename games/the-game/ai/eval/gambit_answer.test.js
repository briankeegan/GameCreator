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
    answered++; if (a.src === 'gambit') gambit++;
    mind.reset();
  }
});
assert.ok(gambit >= answered / 2, 'Gambit chooses most moves: ' + gambit + ' of ' + answered);
console.log('ok: gambit answers -- ' + answered + ' questions over ' + modes.length + ' modes, ' + gambit + ' Gambit\'s own');
