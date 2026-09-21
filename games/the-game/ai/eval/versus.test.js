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


// AN ARCHIVED SNAPSHOT IS STILL A BOT, minus the weights for measurements
// that no longer exist. evaluate() refuses an unknown feature — rightly, it
// is how a typo is caught — so a fixture pinned to an old champion has to
// drop what the registry no longer carries.
function liveWeights(w) {
    var out = {};
    registry.keys.forEach(function (k) { if (w[k]) out[k] = w[k]; });
    return out;
}
var TRAINED = liveWeights( require('./trained.replace.l10-puyo-puyo18-s11.0914-020835.g00274.json').weights);
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

// REACHING THE CEILING ALIVE IS NOT A SHARED RESULT. Under a half-point draw,
// declining to attack is a winning policy: clearing opens your own board and
// the reply lands on you, so the safest way to not lose is to not play. The
// higher score takes the ceiling instead, and only an exact tie draws.
check('the ceiling is decided on score, and only a tie draws', function () {
    [
        [true,  false, [9, 1], 1,    'one side dead must lose whatever the score says'],
        [false, true,  [1, 9], 0,    'one side dead must lose whatever the score says'],
        [true,  true,  [9, 1], null, 'both dead on one frame is a draw, not a score win'],
        [false, false, [9, 1], 0,    'the higher score must take the ceiling'],
        [false, false, [1, 9], 1,    'the higher score must take the ceiling'],
        [false, false, [4, 4], null, 'an exact tie at the ceiling is still a draw']
    ].forEach(function (c) {
        assert.strictEqual(versus.decideWinner(c[0], c[1], c[2]), c[3],
            c[4] + ' (dead ' + c[0] + '/' + c[1] + ', scores ' + JSON.stringify(c[2]) + ')');
    });
});

check('a real duel that reaches the ceiling alive has a winner', function () {
    // FLIPPED, NOT SCALED. Doubling maxHeight leaves two bots that still
    // rank candidates the same way and tie at the ceiling — measured,
    // 1460 each. Reversing the sign makes them genuinely different players:
    // 1330 against 1180, and both sides send.
    var other = JSON.parse(JSON.stringify(TRAINED));
    other.maxHeight = -(other.maxHeight || 50);

    // FIND A CEILING DUEL, DO NOT PIN ONE. Whether a given seed survives to a
    // given ceiling is a property of how the bot plays, and that moves every
    // time the bot changes — a pinned seed reports "the ceiling is broken"
    // when all that happened is that someone died sooner. What is under test
    // is what happens AT the ceiling.
    var r = null, seed = 0;
    for (var sd = 1; sd <= 12 && !r; sd++) {
        var d = versus.duel(TRAINED, other, sd, { ceiling: 1800 });
        if (d.reason === 'ceiling') { r = d; seed = sd; }
    }
    assert.ok(r, 'no seed of 12 kept both sides alive to the ceiling');
    assert.notStrictEqual(r.winner, null,
        'a ceiling duel with scores ' + JSON.stringify(r.scores) + ' was still called a draw');
    assert.strictEqual(r.winner, r.scores[0] > r.scores[1] ? 0 : 1,
        'the ceiling went to the lower score: ' + JSON.stringify(r.scores));

    // The awkward correct case: a mirror reaches the same ceiling with the
    // same score and must still draw.
    var m = versus.duel(TRAINED, TRAINED, seed, { ceiling: 1800 });
    assert.strictEqual(m.scores[0], m.scores[1], 'a mirror scored differently on each side');
    assert.strictEqual(m.winner, null, 'a mirror match at the ceiling produced a winner');
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
    // SEED 1, MEASURED. Seed 7 is now a duel where neither side sends
    // anything (0/0 over 600 frames), which fails this test's own setup
    // guard — the guard is the point, since an empty breakdown would
    // otherwise pass. Seed 1 crosses garbage both ways, 15 and 3.
    try { r = versus.duel(TRAINED, FLAT, 1, {}); }
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

// THE SIZES ARE THE ENGINE'S OWN NUMBERS, not something re-derived from the
// garbage. The engine emits { type: 'match', size, chain } for every match and
// { type: 'chainEnd', length } carrying the finished chain's true length, so
// this intercepts drainEvents, tallies them independently, and requires the
// duel's report to match exactly.
//
// The defect it exists for: the first version keyed chains on the garbage
// HEIGHT, which is links MINUS ONE, and reported every chain a link short —
// twelve 2-chains came out as twelve 1-chains, a thing that cannot exist.
check('combo size and chain length come from the engine, unaltered', function () {
    var mine = [ { combo: {}, chain: {} }, { combo: {}, chain: {} } ];
    var proto = PanelEngine.Stack.prototype;
    var orig = proto.drainEvents;
    var order = [];
    proto.drainEvents = function () {
        var evs = orig.apply(this, arguments);
        var side = order.indexOf(this);
        if (side < 0) { order.push(this); side = order.length - 1; }
        for (var i = 0; i < evs.length; i++) {
            var ev = evs[i];
            if (ev.type === 'chainEnd') {
                mine[side].chain[ev.length] = (mine[side].chain[ev.length] || 0) + 1;
            } else if (ev.type === 'match' && !ev.chain) {
                mine[side].combo[ev.size] = (mine[side].combo[ev.size] || 0) + 1;
            }
        }
        return evs;
    };
    var r;
    try { r = versus.duel(TRAINED, FLAT, 7, {}); }
    finally { proto.drainEvents = orig; }

    assert.ok(r.exact, 'the duel reported no exact histogram at all');

    var any = 0;
    [0, 1].forEach(function (side) {
        Object.keys(r.exact[side].chain).forEach(function (l) {
            any += r.exact[side].chain[l];
            assert.ok(Number(l) >= 2,
                'a chain was counted at ' + l + ' links. A chain starts at 2, so this ' +
                'is the garbage height (links minus one) rather than the length the ' +
                'engine reported.');
        });
        Object.keys(r.exact[side].combo).forEach(function (w) {
            any += r.exact[side].combo[w];
            assert.ok(Number(w) >= 3, 'a combo was counted at size ' + w + '; a match is 3+');
        });
    });
    assert.ok(any > 0,
        'neither side matched anything, so this test would pass for a histogram that ' +
        'is always empty. SETUP failure.');

    // The interceptor numbers the boards by which drained first, so compare the
    // PAIR as a set rather than assuming A then B.
    var key = function (e) { return JSON.stringify([e.combo, e.chain]); };
    assert.deepStrictEqual([key(r.exact[0]), key(r.exact[1])].sort(),
                           [key(mine[0]), key(mine[1])].sort(),
        'the reported sizes are not the ones the engine emitted:\n  reported ' +
        JSON.stringify(r.exact) + '\n  engine   ' + JSON.stringify(mine));
});


// A CHAIN'S LENGTH COMES FROM THE CALLER, AND THE CALLER CAPTURES IT FIRST.
//
// runPhysics clears chainCounter and THEN finalises the chain. While
// finalizeCurrentChain read this.chainCounter itself, every chainEnd event
// said 0 links -- not a length a chain can have, since a chain starts at 2.
// The duel-level check above only sees this when a duel happens to fire a
// chain, so it passed locally and failed on the runner, taking 35 training
// chains down with it. Neither assertion below needs a chain to fire.
check('finalizeCurrentChain reports the length it is GIVEN, not the counter it reads', function () {
    var stack = Object.create(PanelEngine.Stack.prototype);
    stack.events = [];
    stack.clock = 123;
    stack.chainCounter = 0;                 // as runPhysics leaves it
    stack.currentChain = { finalized: false, frameEarned: 0 };
    stack.finalizeCurrentChain(5);
    var ends = stack.events.filter(function (e) { return e.type === 'chainEnd'; });
    assert.strictEqual(ends.length, 1, 'no chainEnd event was pushed');
    assert.strictEqual(ends[0].length, 5,
        'the length was read off the stack instead of taken from the caller');
});

check('runPhysics CAPTURES the chain length before it clears the counter', function () {
    var fs = require('fs');
    var src = fs.readFileSync(path.join(__dirname, '..', '..', 'panel-engine.js'), 'utf8');
    var m = /if \(this\.chainCounter !== 0 && !this\.hasChainingPanels\(\)\)[\s\S]*?\n    }/.exec(src);
    assert.ok(m, 'the chain-end block in runPhysics has moved or gone');
    var body = m[0];
    assert.ok(body.indexOf('this.chainCounter = 0') >= 0, 'the block no longer clears the counter');
    assert.ok(/finalizeCurrentChain\(\s*[A-Za-z_$][\w$]*\s*\)/.test(body),
        'finalizeCurrentChain is called with no length, so it falls back to a counter ' +
        'cleared on the line above and every chain reports 0 links');
});

console.log('');
console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
