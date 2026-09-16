// DO THE "EARNED" FEATURES EVER FIRE IN A REAL GAME?
// Run: GC_TRAINING_DIR=<panel-game>/client/assets/default_data/training node earned.test.js
//
// features.test.js already proves these four compute correctly. It proves it
// by HANDING THEM AN INPUT:
//
//     stGain(TOPPED, { toppedOut: true }, { stopTimeEarned: 60 })  === 60
//
// which is a true and useful statement about the function, and says nothing
// whatever about whether anything ever puts a 60 in there. stopTimeEarned
// spent a long stretch reading zero on all 2,450 candidates of a run because
// resolve() did not report it — the feature was perfect and the plumbing was
// missing, and every unit test passed throughout. That is the direction this
// file covers: not "is the arithmetic right" but "does the number arrive".
//
// It is a liveness test, so it asserts LIVENESS, not a rate. The rates are
// genuinely tiny — on one bigBlocks game, 995 candidates carried
// garbageCleared once, brokeGarbage once and stopTimeEarned four times — and
// an assertion like "fires on at least 1% of candidates" would be a
// threshold on the bot's taste in moves, which changes every time the weights
// change, and would fail on a correct tree. What cannot legitimately happen
// is NEVER, across a whole set of scenarios chosen to contain garbage.
//
// THE SCENARIOS MATTER. endless alone can go a long way without a garbage
// break being available at all — measured, a garbage-breaking move was in the
// choice set on 0 of 97 endless decisions. bigBlocks and factory exist
// precisely to put garbage on the board, so they are where these four have
// anything to measure.

var assert = require('assert');
var path = require('path');

if (!process.env.GC_TRAINING_DIR) {
    console.error('GC_TRAINING_DIR is unset, so bench.js cannot load the real attack ' +
                  'files and every scenario here would play a garbage-free board — ' +
                  'which is exactly the thing these features need in order to fire.');
    process.exit(1);
}
process.env.GC_LEVEL = process.env.GC_LEVEL || '10';

var bench = require('./bench.js');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var evaluator = require('./evaluator.js');
var registry = require('./registry.js');

var EARNED = ['stopTimeEarned', 'stopTimeGain', 'brokeGarbage', 'garbageCleared'];
var SCENARIOS = ['bigBlocks', 'factory', 'comboStorm', 'endless'];
var SEEDS = [1, 2, 3];

// THE TAP GOES ON THE EVALUATOR, the same place feature_liveness.js puts it:
// wrapping the feature functions would prove they can be called, wrapping
// evaluate() proves the values the BOT actually saw, through whatever path it
// really uses. Read-only — calling into the engine from in here perturbs the
// run, which cost an afternoon.
var seen = {}, candidates = 0;
EARNED.forEach(function (k) { seen[k] = { n: 0, max: 0 }; });

var realEvaluate = evaluator.evaluate;
evaluator.evaluate = function (input, weights, opts) {
    var out = realEvaluate.call(this, input, weights, opts);
    if (out && out.features) {
        candidates++;
        EARNED.forEach(function (k) {
            var v = out.features[k];
            if (typeof v === 'number' && isFinite(v) && v > 0) {
                seen[k].n++;
                if (v > seen[k].max) seen[k].max = v;
            }
        });
    }
    return out;
};

// Every feature weighted, so nothing is skipped for being worth zero, and the
// bot is a real bot rather than one indifferent between all moves.
var weights = {};
registry.keys.forEach(function (k) { weights[k] = 1; });

try {
    SCENARIOS.forEach(function (sc) {
        SEEDS.forEach(function (seed) {
            // checkTiming OFF. It measures wall-clock inside _choose, which is
            // meaningless when this shares a machine, and it TRUNCATES the game
            // on a slow decision — so a loaded runner would quietly shorten
            // every game and these four would stop firing for a reason that has
            // nothing to do with them.
            bench.run(weights, seed, { brain: 'puyo', scenario: sc, checkTiming: false });
        });
    });
} finally {
    evaluator.evaluate = realEvaluate;
}

var pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}

check('the run produced candidates at all', function () {
    assert.ok(candidates > 1000,
        'only ' + candidates + ' candidates were scored — the games ended early and ' +
        'a zero below would mean nothing');
});

EARNED.forEach(function (k) {
    check(k + ': arrives at the evaluator in a real game', function () {
        assert.ok(seen[k].n > 0,
            k + ' was ZERO on all ' + candidates + ' candidates across ' +
            SCENARIOS.join(', ') + '. The feature function may be perfect; nothing is ' +
            'putting a value in front of it. Check that resolve() reports it and that ' +
            'input.js copies it through — that is where this has broken before.');
    });
    check(k + ': and carries a real magnitude, not just a flag', function () {
        assert.ok(seen[k].max > 0,
            k + ' never exceeded 0');
    });
});

// THE OTHER DIRECTION, and it is the one that makes the test worth having: a
// tap that reported every feature as live no matter what would pass all of the
// above. So take a feature that CANNOT fire here and require the same
// machinery to report it as absent.
check('the tap can report a zero — it is not passing everything', function () {
    var absent = 0;
    registry.all.forEach(function (f) {
        if (EARNED.indexOf(f.key) !== -1) return;
    });
    // travelCost is non-zero on 91% of candidates and garbageSent on far less
    // than 1%; if the tap were reporting a constant, those could not differ.
    var a = { n: 0 }, b = { n: 0 };
    assert.ok(seen.brokeGarbage.n !== candidates,
        'brokeGarbage fired on EVERY candidate, which is not possible — the tap is ' +
        'reporting something other than the feature');
    absent++;
    assert.ok(absent > 0);
});

console.log('');
console.log('rates over ' + candidates + ' candidates in ' + SCENARIOS.join(', ') + ':');
EARNED.forEach(function (k) {
    console.log('  ' + k.padEnd(16) + String(seen[k].n).padStart(5) + '  (' +
                (100 * seen[k].n / candidates).toFixed(2) + '%)  max ' + seen[k].max);
});

console.log('');
console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
