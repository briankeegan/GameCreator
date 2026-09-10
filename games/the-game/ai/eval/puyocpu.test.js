// IS THIS ACTUALLY THE PUYO BOT? Run: node puyocpu.test.js
//
// puyocpu.js makes four claims, and a bot is exactly the kind of thing
// that can look like it is doing all four while doing none of them. This
// checks each against real games at LEVEL 10, which is the level that
// matters and the level SearchCpu's evaluator seams do not reach.
//
//   1. EVERY decision goes through the evaluator. The whole reason this
//      brain exists: at level 10, SearchCpu consults the evaluator on 4%
//      of decisions because TrueSurvivalSearch decides the rest, so
//      weights trained against it there would be weights for 4% of the
//      game. If this one has any path that decides without scoring, it has
//      the same disease and none of the numbers mean anything.
//   2. It scores EVERY legal move, not a shortlist. meatfighter's bot
//      enumerates all 22 placements; a bot that quietly considers the
//      first few is a different, worse bot that would still train.
//   3. The weights decide. Zero weights must make it indifferent, and
//      changing them must change how it plays — otherwise the GA is
//      turning knobs attached to nothing.
//   4. It scores the board a move LEAVES, resolved. If it scored the board
//      before the cascade, a chain would be invisible to it and the whole
//      "chains happen for free" mechanism could never appear.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require('./puyocpu.js');
var registry = require('./registry.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var LEVEL = 10;
function zeros() { var w = {}; registry.keys.forEach(function (k) { w[k] = 0; }); return w; }

// A plausible weight set, in the shape of the reference's own: mostly
// clustering, a height penalty, an edge penalty. Not trained — this file
// tests the MACHINE, not the numbers.
function sample() {
    var w = zeros();
    w.links = 25; w.colourVariance = 2; w.edgePenalty = 8;
    w.maxHeight = 30; w.garbageOnBoard = 25;
    return w;
}

function play(weights, seed, frames) {
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: seed, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: weights });
    var f;
    for (f = 0; f < (frames || 2000); f++) {
        if (f > 120 && f % 120 === 0) {
            stack.receiveGarbage([{ width: 6, height: 3, isChain: false }]);
        }
        cpu.update();
        stack.run();
        stack.drainEvents();
        if (stack.gameOver) break;
    }
    return { frames: f, score: stack.score || 0, cpu: cpu, stack: stack };
}

test('every decision goes through the evaluator', function () {
    // Counted from inside: _score bumps `evaluations`, _decide is the only
    // caller, and update() bumps `decisions` exactly once per decision. A
    // decision that reached a move without scoring would show up as a
    // decision with no evaluations behind it.
    var bad = [];
    [1, 2, 3, 4].forEach(function (seed) {
        var r = play(sample(), seed);
        if (r.cpu.decisions === 0) { bad.push('seed ' + seed + ': no decisions at all'); return; }
        if (r.cpu.evaluations < r.cpu.decisions) {
            bad.push('seed ' + seed + ': ' + r.cpu.decisions + ' decisions but only ' +
                     r.cpu.evaluations + ' evaluations');
        }
    });
    assert.deepStrictEqual(bad, [],
        'decisions were made without consulting the evaluator:\n  ' + bad.join('\n  '));
});

test('it scores EVERY legal move, not a shortlist', function () {
    // The count per decision must equal the legal swaps on that board plus
    // one for hold. Checked against the board's own legalSwaps(), so a
    // shortlist, a cap, or an early exit all fail.
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample() });
    var mismatches = [], checked = 0, widths = {};
    for (var f = 0; f < 1200; f++) {
        if (f > 120 && f % 120 === 0) stack.receiveGarbage([{ width: 6, height: 3, isChain: false }]);
        var before = cpu.evaluations;
        var willDecide = !cpu._walk && cpu.cooldown === 0;
        var expected = willDecide ? cpu._snapshot().legalSwaps().length + 1 : 0;
        cpu.update();
        var spent = cpu.evaluations - before;
        if (willDecide) {
            checked++;
            widths[expected] = (widths[expected] || 0) + 1;
            if (spent !== expected) {
                mismatches.push('frame ' + f + ': ' + expected + ' legal moves, ' + spent + ' scored');
            }
        }
        stack.run(); stack.drainEvents();
        if (stack.gameOver) break;
    }
    assert.ok(checked >= 20, 'only ' + checked + ' decisions observed — too few to mean anything');
    assert.ok(Object.keys(widths).length >= 3,
        'every decision had the same number of candidates (' + JSON.stringify(widths) +
        '), so this would pass for a bot with a fixed cap');
    assert.deepStrictEqual(mismatches.slice(0, 5), [],
        mismatches.length + ' decisions scored the wrong number of moves:\n  ' +
        mismatches.slice(0, 5).join('\n  '));
});

test('the weights decide: changing them changes the game', function () {
    // Two different weight sets must play differently on the same seed. If
    // they do not, the GA is turning knobs attached to nothing — the exact
    // failure that made this repo's first evaluator worthless.
    var a = play(sample(), 3).frames;
    var flipped = zeros();
    flipped.roughness = 40; flipped.fillRatio = 60; flipped.matchPotential = 20;
    var b = play(flipped, 3).frames;
    assert.notStrictEqual(a, b,
        'two very different weight sets played identically (' + a + ' frames each). ' +
        'Either the weights are not reaching the scoring or every candidate ties.');
});

test('at zero weights every candidate ties, and it still plays legally', function () {
    // Not a no-op check: with nothing to prefer, the strictly-greater
    // comparison must leave `hold` standing rather than crashing or
    // picking an illegal move. A bot that dies instantly here would make
    // the zero genome look catastrophic to the GA for the wrong reason.
    var r = play(zeros(), 5, 600);
    assert.ok(r.frames > 0, 'it did not survive a single frame at zero weights');
    assert.ok(r.cpu.decisions > 0, 'it never made a decision');
});

test('it scores the board AFTER the cascade, not before', function () {
    // The reference's central point: "it never scores a move, it scores the
    // board the move results in", which is why chains need no special case.
    // If _score saw the pre-resolve board, a move that fires a chain would
    // look identical to one that does not.
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 11, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample() });
    for (var i = 0; i < 200; i++) { cpu.update(); stack.run(); stack.drainEvents(); }
    var board = cpu._snapshot();
    var seen = [];
    var origScore = cpu._score;
    cpu._score = function (b, resolved) {
        seen.push({ resolved: resolved });
        return origScore.call(this, b, resolved);
    };
    cpu._decide();
    cpu._score = origScore;
    assert.ok(seen.length > 1, 'only ' + seen.length + ' candidates were scored');
    seen.forEach(function (s, i) {
        assert.ok(s.resolved && typeof s.resolved.chainLength === 'number',
            'candidate ' + i + ' was scored without a resolve() result, so the board it ' +
            'was given had not settled — a chain would be invisible');
    });
});

test('it plays level 10 at all, and faster than the search bot', function () {
    // Coverage in both directions. A brain that dies in 30 frames would
    // pass most of the laws above while being useless to train, and the
    // whole reason for this design is that it is cheap enough to run
    // thousands of games.
    var t = Date.now();
    var r = play(sample(), 2, 3000);
    var ms = Date.now() - t;
    assert.ok(r.frames > 200,
        'survived only ' + r.frames + ' frames at level 10 — too fragile to learn from');
    assert.ok(ms < 2000,
        'one game took ' + ms + 'ms; the point of a one-ply bot is that a training ' +
        'run is minutes rather than hours');
});

// NO FEATURE IS SILENTLY DEAD UNDER THIS BRAIN.
//
// The gate that would have saved an evening. An audit of the trained
// champion found THREE features reading exactly zero on every one of 2,185
// evaluations — latentChain, garbageCleared and travelCost — while the GA
// was assigning them real weight (282, 107 and 173). Three of eighteen
// search dimensions were knobs attached to nothing, and nothing said so.
// travelCost was the worst: this bot walks its cursor, so it was blind to
// the one cost it always pays.
//
// None of them were the features' fault. _score fed them nothing: cascade
// null, clearedCount zero, travelFrames never set.
//
// UNREACHABLE is an explicit list with a reason, not a tolerance — the same
// shape wiring.test.js uses for the other brain. A feature that becomes
// reachable while still listed here ALSO fails, so the list cannot rot into
// an excuse.
var UNREACHABLE = {
    latentChain: 'scores whether a cell already carrying the chain flag settles into a match, which requires deciding MID-CASCADE. _cascadePrediction returns null unless panels are in flight, and this brain decides on cooldown boundaries when the board has settled: 0 of 33 calls returned anything in a full game. Reachable only by a brain that re-decides during a cascade.'
};

test('no feature is silently dead under this brain', function () {
    var evaluator = require('./evaluator.js');
    var registry = require('./registry.js');
    var all = {};
    registry.keys.forEach(function (k) { all[k] = 1; });
    var seen = {}, total = 0;
    registry.keys.forEach(function (k) { seen[k] = 0; });

    var orig = evaluator.evaluate;
    evaluator.evaluate = function (input, w) {
        // Score with EVERY feature weighted, to see what each reads, then
        // return the real score so play is unaffected.
        var probe = orig.call(this, input, all);
        total++;
        registry.keys.forEach(function (k) { if (probe.features[k]) seen[k]++; });
        return orig.call(this, input, w);
    };
    try {
        [101, 102, 103, 104].forEach(function (seed) { play(sample(), seed, 3000); });
    } finally { evaluator.evaluate = orig; }

    assert.ok(total > 1000, 'only ' + total + ' evaluations sampled — too few to call anything dead');
    var dead = [], wronglyListed = [];
    registry.keys.forEach(function (k) {
        if (seen[k] === 0 && !UNREACHABLE[k]) dead.push(k);
        if (seen[k] > 0 && UNREACHABLE[k]) wronglyListed.push(k);
    });
    assert.deepStrictEqual(dead, [],
        'these features read zero on all ' + total + ' evaluations: ' + dead.join(', ') +
        '. The GA will still assign them weight, so each one is a search dimension ' +
        'attached to nothing. Feed them in _score, or list them in UNREACHABLE with ' +
        'the reason.');
    assert.deepStrictEqual(wronglyListed, [],
        'listed as unreachable but they DO fire now: ' + wronglyListed.join(', ') +
        '. Remove them — the list is a statement about this brain, not a permanent excuse.');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
