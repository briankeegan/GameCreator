// WHAT IS THIS BOT BUILDING? Run: node goal.test.js
//
// A goal is one setting that says the whole plan: "5-chain", "6-combo".
// It replaces four separate knobs — fireLinks, fireWide, fireTarget and
// buildToward — that were all expressing one decision in four abstract
// numbers, none of which said the thing a player would say.
//
// It means three things at once, because they ARE one thing:
//   CLIMB   — move toward a board that can fire it
//   REFUSE  — do not sell anything smaller
//   FIRE    — cash in the moment it exists
//
// AND IT SATURATES. The old climb was linear and unbounded, so more
// potential was always better forever, and cranking it built a tall loaded
// board that died. A goal gives full credit AT the goal and nothing beyond:
// at five links you are supposed to fire, not keep stacking.
var assert = require('assert');
var modes = require('./modes.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function res(o) {
    return { chainLength: o.chainLength || 0, comboSizes: o.comboSizes || [],
             brokeGarbage: o.brokeGarbage || 0, stopTimeEarned: 0, garbage: [], truncated: false };
}

// ------------------------------------------------------------- the menu

test('the menu is the goals a player would name', function () {
    assert.deepStrictEqual(modes.GOALS,
        ['4-chain', '5-chain', '6-chain', '4-combo', '5-combo', '6-combo', '7-combo']);
});

test('every goal on the menu parses', function () {
    modes.GOALS.forEach(function (g) {
        var parsed = modes.goal(g);
        assert.ok(parsed.kind === 'chain' || parsed.kind === 'combo', g + ' has no kind');
        assert.ok(parsed.size >= 4, g + ' has no size');
    });
});

test('a goal reads as what it says', function () {
    assert.strictEqual(modes.goal('5-chain').kind, 'chain');
    assert.strictEqual(modes.goal('5-chain').size, 5);
    assert.strictEqual(modes.goal('6-combo').kind, 'combo');
    assert.strictEqual(modes.goal('6-combo').size, 6);
});

test('no goal means no target at all', function () {
    // The plain filter and nothing else, which is the bot before any of this.
    assert.strictEqual(modes.goal(null), null);
});

test('a goal that is not on the menu stops the run', function () {
    // Not a silent fallback: a typo would then read as a deliberate setting
    // and quietly measure a different bot.
    assert.throws(function () { modes.goal('5-chains'); }, /5-chains/);
    assert.throws(function () { modes.goal('3-chain'); }, /3-chain/);
});

// ------------------------------------------------- what a goal asks for

test('a chain goal sets the chain bar, and ALSO TAKE sets the other', function () {
    // Measured: a bot that will not cash a combo AT ALL starves — 24 games
    // apiece showed zero deep chains, a third of the garbage and a 30%
    // shorter game at a combo bar of 8 or 99. So a goal names what it is
    // building and still takes the other weapon when it is big enough.
    var g = modes.goal('5-chain', 6);
    assert.strictEqual(g.links, 5, 'the chain bar is the goal itself');
    assert.strictEqual(g.wide, 6, 'the combo bar is alsoTake');
});

test('a combo goal is the mirror', function () {
    var g = modes.goal('6-combo', 5);
    assert.strictEqual(g.wide, 6);
    assert.strictEqual(g.links, 5);
});

test('alsoTake cannot undercut what the engine pays for', function () {
    // COMBO_GARBAGE sends nothing below 4 and a bare three scores 0, so no
    // setting may make the bot sell one.
    assert.strictEqual(modes.goal('5-chain', 2).wide, 4);
    assert.strictEqual(modes.goal('6-combo', 1).links, 2);
});

// ------------------------------------------------------- the saturation

test('the climb pays progress toward the goal', function () {
    var g = modes.goal('5-chain', 6);
    assert.strictEqual(modes.climbTo(g, 100, { links: 0, wide: 0 }), 0);
    assert.strictEqual(modes.climbTo(g, 100, { links: 1, wide: 0 }), 20);
    assert.strictEqual(modes.climbTo(g, 100, { links: 4, wide: 0 }), 80);
    assert.strictEqual(modes.climbTo(g, 100, { links: 5, wide: 0 }), 100);
});

test('and STOPS at the goal — this is the whole point', function () {
    // Past the goal you are supposed to fire, not keep stacking. The old
    // linear climb had no ceiling, so cranking it built a tall loaded board
    // and killed the bot: survival fell from 10.1 minutes to 7.7 as strength
    // rose.
    var g = modes.goal('5-chain', 6);
    assert.strictEqual(modes.climbTo(g, 100, { links: 6, wide: 0 }), 100);
    assert.strictEqual(modes.climbTo(g, 100, { links: 9, wide: 0 }), 100);
});

test('a chain goal does not climb combo width, and vice versa', function () {
    // Otherwise "I am building a five-chain" would be pulled off course by
    // every wide combo the board happens to offer.
    assert.strictEqual(modes.climbTo(modes.goal('5-chain', 6), 100, { links: 0, wide: 9 }), 0);
    assert.strictEqual(modes.climbTo(modes.goal('6-combo', 5), 100, { links: 9, wide: 0 }), 0);
});

test('no goal, no climb', function () {
    assert.strictEqual(modes.climbTo(null, 100, { links: 5, wide: 9 }), 0);
});

test('no strength, no climb', function () {
    assert.strictEqual(modes.climbTo(modes.goal('5-chain', 6), 0, { links: 5, wide: 0 }), 0);
});

// ----------------------------------------------- refuse, and fire, at it

test('a goal refuses anything smaller', function () {
    var g = modes.goal('5-chain', 6);
    assert.strictEqual(modes.pays(res({ chainLength: 4, comboSizes: [3, 3, 3, 3] }), g.links, g.wide), false);
    assert.strictEqual(modes.pays(res({ chainLength: 5, comboSizes: [3, 3, 3, 3, 3] }), g.links, g.wide), true);
});

test('a goal still takes the other weapon at alsoTake', function () {
    var g = modes.goal('5-chain', 6);
    assert.strictEqual(modes.pays(res({ chainLength: 1, comboSizes: [5] }), g.links, g.wide), false);
    assert.strictEqual(modes.pays(res({ chainLength: 1, comboSizes: [6] }), g.links, g.wide), true);
});

test('building and digging are never refused, whatever the goal', function () {
    var g = modes.goal('6-chain', 7);
    assert.strictEqual(modes.pays(res({}), g.links, g.wide), true);
    assert.strictEqual(modes.pays(res({ chainLength: 1, comboSizes: [3], brokeGarbage: 2 }), g.links, g.wide), true);
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
