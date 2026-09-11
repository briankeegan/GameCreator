// DOES TIDINESS STOP SHRINKING JUST BECAUSE THE BOARD DID?
// Run: node density.test.js   (GC_TRAINING_DIR required for the last case)
//
// THE MEASUREMENT THIS EXISTS FOR. Over three real level-10 games, the
// mean change in each feature when a swap cleared 7+ panels, against
// holding that same board:
//
//     links         -4.66   (-0.639 per panel removed)
//     garbageSent   +7.31   (+1.004 per panel removed)
//
// Two near-identical per-panel slopes pointing opposite ways: a third of
// the reward for a big clear was cancelled before anything about the
// resulting board was weighed. links COUNTS PANELS, so it falls when
// panels leave, whatever shape the board is left in. That is arithmetic,
// not a judgement, and the search cannot weight its way out of it because
// the same weight prices both the real signal and the artefact.
//
// roughness is deliberately NOT in this: measured, it punishes small
// clears (+1.36 at three panels) and is exactly 0.00 on big ones, so it is
// reading real shape and is left alone.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var evaluator = require('./evaluator.js');
var registry = require('./registry.js');
var inputMod = require('./input.js');
var features = require('./features.js');
var PuyoCpu = require('./puyocpu.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var W = 6, H = 8;
function boardOf(rows) {
    var grid = [];
    for (var r = 0; r <= H; r++) {
        grid[r] = [];
        for (var c = 1; c <= W; c++) grid[r][c] = 0;
    }
    for (var i = 0; i < rows.length; i++)
        for (var c2 = 1; c2 <= W; c2++) grid[i + 1][c2] = rows[i][c2 - 1];
    return new globalThis.PanelCpu.LogicalBoard(W, H, 6, grid, {});
}
function val(key, board, density) {
    var w = {}; w[key] = 1;
    return evaluator.evaluate({ board: board }, w, { density: density }).features[key];
}

// ---- scoreEarned ----

test('scoreEarned pays what the GAME pays, and a bare three pays nothing', function () {
    function sc(sizes) {
        return features.scoreEarned(inputMod.normalize({ earned: { comboSizes: sizes } }));
    }
    // A plain 3 clears panels, keeps you alive, and earns zero — which is
    // 54 of the shipped bot's 67 matches across three games.
    assert.strictEqual(sc([3]), 0, 'a bare 3-match scored something; the engine pays 0 for it');
    assert.strictEqual(sc([]), 0, 'a move that cleared nothing scored something');
    assert.strictEqual(sc([4]), 20, 'a 4-combo is 20 points in SCORE_COMBO_TA');
    // 3+3+3+3+3: no combo bonus at all, four chain links at 50/80/150/300.
    assert.strictEqual(sc([3, 3, 3, 3, 3]), 580, 'a five-link chain is 580, not ' + sc([3, 3, 3, 3, 3]));
    // And the ordering that the proxies get wrong: 15x in points where
    // garbage cells say 8x.
    assert.ok(sc([3, 3, 3, 3, 3]) / sc([4]) > 14,
        'a 5-chain should be worth more than fourteen 4-combos in points');
});

test('the score tables are NOT restated in features.js', function () {
    // Point at a standard, never copy it: a second copy of the Tsu-Attack
    // tables would drift from the engine that is actually keeping score.
    var src = require('fs').readFileSync(path.join(__dirname, 'features.js'), 'utf8');
    assert.ok(/PanelEngine[\s\S]{0,80}moveScore/.test(src),
        'scoreEarned does not go through PanelEngine.moveScore');
    assert.ok(!/SCORE_COMBO_TA|SCORE_CHAIN_TA|\b1100\b/.test(src),
        'features.js contains its own copy of the score tables');
});

test('scoreEarned is non-zero exactly when the REAL engine pays', function () {
    // The "not actually hooked up" direction, done the way the engine
    // allows. A cascade's links land in DIFFERENT FRAMES, so a per-frame
    // total cannot see chain position and would under-count every chain —
    // which is why this asserts AGREEMENT ON WHETHER ANYTHING WAS EARNED
    // rather than a total. Re-deriving the total here would mean keeping a
    // second copy of the tables, which is the thing the test above forbids.
    require(path.join(__dirname, '..', 'trained-weights.js'));
    var shipped = globalThis.PanelEval.trained.weights;
    var paid = 0, quiet = 0, disagreed = [];
    [9, 10, 11, 12, 13, 14].forEach(function (seed) {
    var stack = new PanelEngine.Stack({ level: 10, seed: seed, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: shipped, reaction: 12 });
    for (var f = 0; f < 4000 && !stack.gameOver; f++) {
        var before = stack.score || 0;
        cpu.update();
        stack.run();
        var evs = stack.drainEvents(), sizes = [], chained = false;
        for (var i = 0; i < evs.length; i++) {
            if (evs[i].type !== 'match') continue;
            sizes.push(evs[i].size);
            // chainCounter, NOT the `chain` flag. A match that is not itself
            // a chain link still collects SCORE_CHAIN_TA[counter] while a
            // cascade is in flight (updateScoreWithChain is unconditional),
            // so a bare 3 really can be paid. Filtering on `chain` let two
            // of those through and read as a disagreement.
            if (evs[i].chainCounter > 0) chained = true;
        }
        if (!sizes.length) continue;
        var enginePaid = (stack.score || 0) > before;
        // A chain link's bonus depends on its position in the cascade, which
        // a single frame does not carry, so only the un-chained frames are
        // decidable here.
        if (chained) continue;
        var featurePaid = PanelEngine.moveScore(sizes) > 0;
        if (enginePaid !== featurePaid) disagreed.push(sizes.join('+') + ' engine:' + enginePaid);
        if (enginePaid) paid++; else quiet++;
    }
    });
    assert.ok(paid > 0 && quiet > 0,
        'saw ' + paid + ' paying and ' + quiet + ' non-paying matches — need both to prove ' +
        'the feature is not simply always-on or always-off');
    assert.deepStrictEqual(disagreed, [],
        'the feature and the engine disagreed on whether a match earned anything: ' +
        disagreed.slice(0, 5).join(', '));
});

// ---- density ----

test('a count made of panels is SIZE-INVARIANT in density mode', function () {
    // The claim is NOT "a taller board scores the same" — stacking a shape
    // adds vertical adjacencies, so it is genuinely denser. The claim is the
    // one that matters after a clear: a board with HALF AS MUCH of the same
    // tidiness should score the same tidiness.
    //
    //   one cluster        two identical clusters
    //     1 1 . . . .         1 1 . 2 2 .
    //     1 1 . . . .         1 1 . 2 2 .
    //
    // Four panels and four links against eight and eight. The count doubles;
    // the density is identical. That is exactly the situation a move creates
    // when it clears one cluster and leaves the other.
    var one = boardOf([[1, 1, 0, 0, 0, 0],
                       [1, 1, 0, 0, 0, 0]]);
    var two = boardOf([[1, 1, 0, 2, 2, 0],
                       [1, 1, 0, 2, 2, 0]]);
    var rawOne = val('links', one, false), rawTwo = val('links', two, false);
    assert.strictEqual(rawTwo, rawOne * 2,
        'the two-cluster board should have exactly twice the links (' + rawOne +
        ' vs ' + rawTwo + '); rewrite these boards');
    var dOne = val('links', one, true), dTwo = val('links', two, true);
    assert.strictEqual(dOne, dTwo,
        'density still scales with how much board there is: ' + dOne + ' vs ' + dTwo);
});

test('density touches ONLY the features the registry marks perPanel', function () {
    var marked = registry.all.filter(function (f) { return f.perPanel; }).map(function (f) { return f.key; });
    assert.deepStrictEqual(marked.sort(), ['edgePenalty', 'links'],
        'the perPanel set changed — if that is deliberate, update this test and say why');
    var board = boardOf([[1, 1, 2, 3, 3, 2],
                         [2, 1, 3, 1, 2, 3],
                         [1, 2, 2, 3, 1, 1]]);
    registry.keys.forEach(function (k) {
        var raw = val(k, board, false), dense = val(k, board, true);
        if (marked.indexOf(k) >= 0) {
            assert.notStrictEqual(raw, dense, k + ' is marked perPanel but density did not change it');
        } else {
            assert.strictEqual(raw, dense, k + ' is not marked perPanel but density changed it');
        }
    });
});

test('density is OFF unless asked for', function () {
    var board = boardOf([[1, 1, 2, 2, 3, 3]]);
    var w = { links: 1 };
    assert.strictEqual(evaluator.evaluate({ board: board }, w).score,
                       evaluator.evaluate({ board: board }, w, {}).score);
    assert.strictEqual(evaluator.evaluate({ board: board }, w).score,
                       evaluator.evaluate({ board: board }, w, { density: false }).score);
});

test('an empty board is 0, not NaN', function () {
    // Dividing by a panel count of zero would hand the search a NaN, which
    // propagates through every comparison as false and silently makes the
    // bot pick whatever was first in the list.
    var empty = boardOf([]);
    registry.keys.forEach(function (k) {
        var v = val(k, empty, true);
        assert.ok(!isNaN(v), k + ' came back NaN on an empty board');
    });
});

test('density REACHES THE BOT, end to end through bench', function () {
    // The third time this test has been needed: bench.js builds PuyoCpu's
    // options by hand, so depth was dropped, then rise was dropped. Same
    // shape of bug, same check.
    assert.ok(process.env.GC_TRAINING_DIR,
        'GC_TRAINING_DIR unset — bench cannot load the attack files');
    var bench = require('./bench.js');
    var w = { matchPotential: 229, links: 43, colourVariance: 168, edgePenalty: 110,
              maxHeight: 136, roughness: 294, garbageSent: 107 };
    var off = bench.run(w, 1, { scenario: 'comboStorm', brain: 'puyo', mode: 'replace',
                                checkTiming: false });
    var on = bench.run(w, 1, { scenario: 'comboStorm', brain: 'puyo', mode: 'replace',
                               checkTiming: false, density: true });
    assert.notStrictEqual(off.frames + ':' + off.score, on.frames + ':' + on.score,
        'density on and off played an IDENTICAL game (' + off.frames + ' frames, ' +
        off.score + ' points) — the option is not reaching the bot');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok  ', t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL', t.name, '\n     ', e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
if (failures.length) process.exit(1);
