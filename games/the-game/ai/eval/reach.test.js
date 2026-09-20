// WHAT CAN THIS BOARD FIRE NEXT MOVE, SIZE BY SIZE? Run: node reach.test.js
//
// Seven features, one per target a player would name: a combo 4, 5, 6 or 7
// wide, or a chain 4, 5 or 6 links deep. Each says whether the board a move
// LEAVES can fire that thing next move.
//
// THEY REPLACE A SETTING. What the bot builds toward used to be one knob
// picked by hand — 5-chain, 6-combo — which meant every choice was a guess
// to be swept. As features the weights decide instead: a bot can learn that
// a 5-chain is worth a lot, a 4-combo a little, and that it wants both.
//
// FREE. The search at depth 2 already resolves every swap from every
// candidate board to find its best follow-up, so this reads work already
// done. Asking it as a separate sweep costs ~900 resolves a decision — 166ms
// against an 85ms budget, measured.
var assert = require('assert');
var modes = require('./modes.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('the targets are the ones a player would name', function () {
    assert.deepStrictEqual(modes.REACH, [
        'reach4combo', 'reach5combo', 'reach6combo', 'reach7combo',
        'reach4chain', 'reach5chain', 'reach6chain'
    ]);
});

test('nothing below four is a target, because nothing below four pays', function () {
    // COMBO_GARBAGE sends nothing under 4 and a bare three scores 0.
    modes.REACH.forEach(function (k) {
        assert.ok(Number(k.replace(/\D/g, '')) >= 4, k + ' targets something the engine does not pay for');
    });
});

test('a board that can fire a 6-wide reads on 6 and on everything below it', function () {
    // Being able to fire a six means being able to fire a four. A weight set
    // that values only sixes then still sees the sixes, and one that values
    // fours is not blind to a board holding something better.
    var r = modes.reach({ links: 0, wide: 6 });
    assert.strictEqual(r.reach4combo, 1);
    assert.strictEqual(r.reach5combo, 1);
    assert.strictEqual(r.reach6combo, 1);
    assert.strictEqual(r.reach7combo, 0);
});

test('a board that can fire a 5-chain reads on 4 and 5, not 6', function () {
    var r = modes.reach({ links: 5, wide: 0 });
    assert.strictEqual(r.reach4chain, 1);
    assert.strictEqual(r.reach5chain, 1);
    assert.strictEqual(r.reach6chain, 0);
});

test('chains and combos are counted separately', function () {
    // Different weapons: pushGarbage sends a chain as one full-width slab
    // held until the cascade ends, and a combo as separate one-row pieces
    // that leave at once. A weight set may want one and not the other.
    var r = modes.reach({ links: 6, wide: 0 });
    assert.strictEqual(r.reach6chain, 1);
    assert.strictEqual(r.reach4combo, 0);
});

test('an empty board reaches nothing', function () {
    var r = modes.reach({ links: 0, wide: 0 });
    modes.REACH.forEach(function (k) { assert.strictEqual(r[k], 0, k); });
});

test('no reach at all is still every key, never a hole', function () {
    // A missing key reads as undefined in the evaluator and scores nothing,
    // which is a dead feature wearing a live one's name.
    var r = modes.reach(null);
    modes.REACH.forEach(function (k) { assert.strictEqual(r[k], 0, k + ' is missing'); });
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
