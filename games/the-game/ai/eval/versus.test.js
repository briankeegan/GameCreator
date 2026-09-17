// DOES THE DUEL MEASURE THE WEIGHTS, OR SOMETHING ELSE?
// Run: GC_TRAINING_DIR=<...> node versus.test.js
//
// A head-to-head fitness is one bit, so every way that bit can be wrong is a
// way the whole training signal is wrong, silently. Three things have to
// hold before the bit means anything:
//
//   1. Identical weights must DRAW. If a mirror match has a winner, the
//      board or the loop favours a side and the bit is measuring that.
//   2. Swapping the sides must mirror the result. Same thing from the other
//      direction, and it catches a bias the mirror cannot (one that needs
//      two different players to show up).
//   3. Garbage must actually cross. Two bots playing solitaire in the same
//      process would produce a perfectly stable, perfectly meaningless bit.
var assert = require('assert');
var path = require('path');

if (!process.env.GC_TRAINING_DIR) {
    console.error('GC_TRAINING_DIR is unset — set it to panel-game/client/assets/default_data/training');
    process.exit(1);
}
process.env.GC_LEVEL = process.env.GC_LEVEL || '10';

var versus = require('./versus.js');
var PanelEngine = globalThis.PanelEngine;   // versus.js loads the engine
var registry = require('./registry.js');

var pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}

var TRAINED = require('./trained.replace.l10-puyo-puyo18-s11.0914-020835.g00274.json').weights;
var FLAT = {};
registry.keys.forEach(function (k) { FLAT[k] = 1; });

check('a mirror match is a DRAW — neither side is favoured', function () {
    var r = versus.duel(TRAINED, TRAINED, 1, {});
    assert.strictEqual(r.winner, null,
        'identical weights on identical boards produced a winner (' + r.winner + '), so ' +
        'something other than the weights decides this duel');
    assert.strictEqual(r.sent[0], r.sent[1],
        'the two sides sent different amounts from identical play: ' + JSON.stringify(r.sent));
});

check('swapping the sides mirrors the result', function () {
    var ab = versus.duel(TRAINED, FLAT, 1, {});
    var ba = versus.duel(FLAT, TRAINED, 1, {});
    assert.strictEqual(ab.winner, 0, 'the trained set lost to flat weights as player 0');
    assert.strictEqual(ba.winner, 1, 'the trained set lost to flat weights as player 1');
    assert.strictEqual(ab.frames, ba.frames,
        'the same duel ran for a different length depending on which seat each bot took (' +
        ab.frames + ' vs ' + ba.frames + '), so seat position changes play');
    assert.deepStrictEqual(ab.sent, ba.sent.slice().reverse(),
        'garbage sent did not mirror when the seats swapped');
});

check('garbage actually crosses', function () {
    var r = versus.duel(TRAINED, FLAT, 1, {});
    assert.ok(r.sent[0] > 0 && r.sent[1] > 0,
        'one side sent nothing at all (' + JSON.stringify(r.sent) + ') — if neither board ' +
        'can reach the other this is two solitaire games and the bit means nothing');
});

check('a duel ends, and says why', function () {
    var r = versus.duel(TRAINED, FLAT, 1, {});
    assert.ok(['death', 'both', 'ceiling'].indexOf(r.reason) !== -1, 'unknown reason ' + r.reason);
    assert.ok(r.frames > 0);
});

// THE OTHER DIRECTION: a bit that always says the same thing is not a
// measurement. Different seeds must be able to produce different outcomes,
// or every genome is being ranked by one fixed board.
check('the outcome depends on the seed, not just the weights', function () {
    var seen = {};
    [1, 2, 3, 4, 5].forEach(function (s) {
        var r = versus.duel(TRAINED, FLAT, s, {});
        seen[String(r.winner) + ':' + r.frames] = true;
    });
    assert.ok(Object.keys(seen).length > 1,
        'five seeds produced one identical outcome — the duel is not reading the seed');
});

// THE BREAKDOWN IS THE GARBAGE THAT ACTUALLY CROSSED, not a plausible object
// of zeroes. Every piece the duel hands over is classified here too, by the
// same rule, and the two tallies must agree exactly — which an empty
// breakdown, or one built from anything else, cannot do.
check('chainDepth is the garbage the duel really sent, per side', function () {
    var report = require(path.join(__dirname, '..', 'experiments', 'report.js'));
    var mine = [ {}, {} ];
    report.CATEGORY_ORDER.forEach(function (c) { mine[0][c] = 0; mine[1][c] = 0; });

    var proto = PanelEngine.Stack.prototype;
    var orig = proto.takeDeliverableGarbage;
    var order = [];
    proto.takeDeliverableGarbage = function () {
        var out = orig.apply(this, arguments);
        if (out && out.length) {
            var side = order.indexOf(this);
            if (side < 0) { order.push(this); side = order.length - 1; }
            for (var i = 0; i < out.length; i++) mine[side][report.classify(out[i])]++;
        }
        return out;
    };
    var r;
    try { r = versus.duel(TRAINED, FLAT, 7, {}); }
    finally { proto.takeDeliverableGarbage = orig; }

    assert.ok(r.chainDepth, 'the duel reported no chainDepth at all');
    var total = 0;
    report.CATEGORY_ORDER.forEach(function (c) {
        total += r.chainDepth[0][c] + r.chainDepth[1][c];
    });
    assert.ok(total > 0,
        'neither side sent any garbage in this duel — nothing to compare, so this ' +
        'test would pass for a breakdown that is always empty. SETUP failure.');

    // The interceptor numbers the boards by which delivered first, which is
    // not necessarily A then B, so compare the PAIR as a set of two tallies.
    var got = [r.chainDepth[0], r.chainDepth[1]].map(function (d) {
        return report.CATEGORY_ORDER.map(function (c) { return d[c]; }).join(',');
    }).sort();
    var want = mine.map(function (d) {
        return report.CATEGORY_ORDER.map(function (c) { return d[c]; }).join(',');
    }).sort();
    assert.deepStrictEqual(got, want,
        'the reported breakdown is not the garbage that crossed:\n  reported ' +
        JSON.stringify(got) + '\n  actual   ' + JSON.stringify(want));
});

console.log('');
console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
