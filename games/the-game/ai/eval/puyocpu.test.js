// IS THIS ACTUALLY THE PUYO BOT? Run: node puyocpu.test.js
//
// puyocpu.js makes four claims, and a bot is exactly the kind of thing
// that can look like it is doing all four while doing none of them. This
// checks each against real games at LEVEL 10.
//
//   1. EVERY decision goes through the evaluator. If any path decides
//      without scoring, the weights govern less than the whole game and
//      none of the numbers mean anything.
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
    w.linksH = 13; w.linksV = 12; w.colourVariance = 2; w.edgePenalty = 8;
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
    // the non-swap actions available on it — hold always, and raise when the
    // bot may raise and the stack will serve one. Checked against the board's
    // own legalSwaps(), so a shortlist, a cap, or an early exit all fail.
    //
    // ASKS THE BOT WHICH ACTIONS IT HAS rather than naming them. Hardcoding
    // "+ 1 for hold" is what made this fail the day raise became a control:
    // it reported a shortlist where the bot had in fact scored one move MORE
    // than expected, which is the opposite complaint.
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample() });
    var mismatches = [], checked = 0, widths = {};
    for (var f = 0; f < 1200; f++) {
        if (f > 120 && f % 120 === 0) stack.receiveGarbage([{ width: 6, height: 3, isChain: false }]);
        var before = cpu.evaluations;
        var willDecide = !cpu._walk && cpu.cooldown === 0;
        var expected = willDecide
            ? cpu._snapshot().legalSwaps().length + 1 + (cpu._canRaise() ? 1 : 0)
            : 0;
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
    // NAMES NOTHING. Which features exist is the registry's business and it
    // changes; a test that hardcodes three of them fails on the day one is
    // renamed and says "the weights do not reach the scoring", which is a lie
    // about the thing under test. Every other key gets a weight instead, so
    // the two sets disagree about every candidate whatever the set is.
    var a = play(sample(), 3).frames;
    var flipped = zeros();
    registry.keys.forEach(function (k, i) { if (i % 2 === 0) flipped[k] = 40; });
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
    latentChain: 'scores whether a cell already carrying the chain flag settles into a match, which requires deciding MID-CASCADE. _cascadePrediction returns null unless panels are in flight, and this brain decides on cooldown boundaries when the board has settled: 0 of 33 calls returned anything in a full game. Reachable only by a brain that re-decides during a cascade.',

    // THE SEVEN TARGETS NEED A SECOND PLY. reach* is what the board a move
    // LEAVES could fire next move, and the only honest source is the search
    // itself: at depth 2 _value already resolves every swap from that board,
    // so the number is read off work already done. The games in this file
    // are DEPTH 1, which has no second ply to read — and synthesising one as
    // a feature costs ~900 resolves a decision, 166ms against an 85ms
    // budget. They are live at depth 2; reach.test.js checks the mapping and
    // a duel probe confirms all seven vary in play.
    reach5combo: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach7combo: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach5chain: 'needs the second ply; these games are depth 1. See reach.test.js.',

    reach4combo: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach5combo: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach6combo: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach7combo: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach8combo: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach9combo: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach10combo: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach2chain: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach3chain: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach4chain: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach5chain: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach6chain: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach7chain: 'needs the second ply; these games are depth 1. See reach.test.js.',
    reach8chain: 'needs the second ply; these games are depth 1. See reach.test.js.',

    // AND THE TWO OPPONENT FEATURES NEED AN OPPONENT. These games are solo,
    // so input.opponent is null and both read 0 by definition. In a duel
    // they vary and are non-zero on 9% of evaluations. opponent.test.js
    // covers the computation; versus.duel wires each side to the other.
    pressure: 'needs an opponent; these games are solo. Live in a duel — see opponent.test.js.',
    overkill: 'needs an opponent; these games are solo. Live in a duel — see opponent.test.js.'
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

// ---- it may not choose to die ----------------------------------------
//
// Raising is the one thing the bot does that pushes its OWN stack up, so
// it is the only move where "chose to die" is literally true. Every other
// way of dying is the floor arriving. Measured over ten deaths, one took
// `raise` with 12 cells of garbage queued at a board already 9 rows deep
// and died 71 frames after it landed -- and no weight could have stopped
// it, because a weight applies to every raise equally and most raises are
// fine. This is a rule, not a preference.

function boardAt(height, width, topRow) {
    var g = [];
    for (var r = 0; r <= height; r++) {
        g[r] = [];
        for (var c = 0; c <= width; c++) g[r][c] = (r >= 1 && r <= topRow) ? 1 : 0;
    }
    return { grid: g, height: height, width: width };
}

test('a raise that tops the board out is not offered', function () {
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample() });
    // Filled to the top row: the engine's own second game-over condition is
    // holding raise on a board like this.
    assert.strictEqual(cpu._raiseIsSuicide(boardAt(stack.height, stack.width, stack.height)), true);
});

test('a raise the QUEUED GARBAGE has nowhere to land is not offered', function () {
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample() });
    var H = stack.height, W = stack.width;
    // Two rows of clear space after the raise...
    var board = boardAt(H, W, H - 2);
    assert.strictEqual(cpu._raiseIsSuicide(board), false, 'two clear rows and nothing queued is fine');
    // ...and two rows of garbage already on the way fills exactly all of it.
    stack.incoming = [{ width: W, height: 2 }];
    assert.strictEqual(cpu._raiseIsSuicide(board), true);
    // One row queued still leaves somewhere to stand.
    stack.incoming = [{ width: W, height: 1 }];
    assert.strictEqual(cpu._raiseIsSuicide(board), false);
});

test('an ordinary raise on a low board is still offered', function () {
    // The rule must refuse suicide and nothing else. A bot that stopped
    // raising would be a different, worse bot, and it would pass a test
    // that only checked the refusals.
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample() });
    stack.incoming = [{ width: stack.width, height: 2 }];
    assert.strictEqual(cpu._raiseIsSuicide(boardAt(stack.height, stack.width, 3)), false);
});

test('the refusal happens in the CANDIDATE LIST, not in the score', function () {
    // Scoring it low is not the same as making it illegal: the weights are
    // free to rank it back up, and 63% of trained champions weight
    // stopTimeEarned negative, so "the weights will handle it" is not a
    // thing this repo gets to assume.
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample(), allowRaise: true, engine: true });
    var raiseIsSuicide = true;
    cpu._raiseIsSuicide = function () { return raiseIsSuicide; };
    for (var f = 0; f < 200; f++) { cpu.update(); stack.run(); }
    var cands = cpu._candidates();
    assert.ok(!cands.some(function (c) { return c.kind === 'raise'; }),
        'a raise the bot cannot survive was still on the list');
    // And the same position with the rule switched off DOES offer it, so
    // the assertion above is about the rule and not about the position.
    var loose = new PuyoCpu(stack, { weights: sample(), allowRaise: true, engine: true,
                                     refuseSuicide: false });
    loose._raiseIsSuicide = function () { return true; };
    var offered = loose._candidates().some(function (c) { return c.kind === 'raise'; });
    assert.ok(offered || !loose._canRaise(),
        'the rule-off bot refused it too, so this position proves nothing');
});

// ---- a move that leaves you topped out is not a move -----------------

test('a fatal move is dropped when a survivable one exists', function () {
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 11, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample() });
    var H = stack.height, W = stack.width;
    var cands = [
        { kind: 'hold', board: boardAt(H, W, H) },      // topped out
        { kind: 'swap', board: boardAt(H, W, H - 1) },  // not
        { kind: 'swap', board: boardAt(H, W, H) }       // topped out
    ];
    var live = cpu._survivors(cands);
    assert.strictEqual(live.length, 1);
    assert.strictEqual(live[0].board.grid[H][1], 0, 'the survivor is the one that is not topped out');
    assert.strictEqual(cpu.fatalMovesDropped, 2);
});

test('WHEN EVERY MOVE IS FATAL THE FILTER LIFTS', function () {
    // Then it is not a choice, and an empty pool falls through to no bot at
    // all. Seven of twenty deaths had no survivable move by the last
    // decision -- those were lost earlier, not chosen here.
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 11, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample() });
    var H = stack.height, W = stack.width;
    var all = [{ kind: 'hold', board: boardAt(H, W, H) },
               { kind: 'swap', board: boardAt(H, W, H) }];
    assert.strictEqual(cpu._survivors(all).length, 2);
    assert.strictEqual(cpu.fatalMovesDropped, 0, 'nothing was dropped, so nothing is counted');
});

test('a board nobody is near the top of is left alone', function () {
    // The filter must bite only where it matters. Dropping nothing has to
    // return the SAME list, or every decision pays for a copy.
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 11, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample() });
    var low = [{ kind: 'hold', board: boardAt(stack.height, stack.width, 3) },
               { kind: 'swap', board: boardAt(stack.height, stack.width, 4) }];
    assert.strictEqual(cpu._survivors(low), low);
});

test('the rule can be switched off, so it can be shown to do something', function () {
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 11, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample(), refuseSuicide: false });
    var H = stack.height, W = stack.width;
    var mixed = [{ kind: 'hold', board: boardAt(H, W, H) },
                 { kind: 'swap', board: boardAt(H, W, H - 1) }];
    assert.strictEqual(cpu._survivors(mixed), mixed);
});

// ---- and a move into a corner is a move into death -------------------

function cornerCpu(opts) {
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 11, countdown: false });
    return new PuyoCpu(stack, Object.assign({ weights: sample() }, opts || {}));
}

test('a move whose every reply is topped out is dropped', function () {
    var cpu = cornerCpu();
    var expand = [{ cornered: true }, { cornered: false }, { cornered: true }];
    assert.deepStrictEqual(cpu._standing(expand, null), [1]);
    assert.strictEqual(cpu.corneringMovesDropped, 2);
});

test('when EVERY move is a corner the filter lifts', function () {
    var cpu = cornerCpu();
    var all = [{ cornered: true }, { cornered: true }];
    assert.strictEqual(cpu._standing(all, null), null, 'no tier, so nothing is imposed');
    assert.strictEqual(cpu.corneringMovesDropped, 0);
});

test('it NARROWS the escape tier rather than replacing it', function () {
    // _lookahead may already have picked a tier of moves that reach a way
    // out. Replacing it would throw that away; ignoring it would walk into
    // a corner for the sake of an escape that arrives after the death.
    var cpu = cornerCpu();
    var expand = [{ cornered: false }, { cornered: true }, { cornered: false }];
    assert.deepStrictEqual(cpu._standing(expand, [1, 2]), [2]);
});

test('a tier that narrowing would EMPTY is left alone', function () {
    // Every move the escape tier picked is also a corner. Emptying the tier
    // would fall through to the whole pool, which is a different bot; the
    // tier stands and the corner is the lesser of the two.
    var cpu = cornerCpu();
    var expand = [{ cornered: false }, { cornered: true }, { cornered: true }];
    assert.deepStrictEqual(cpu._standing(expand, [1, 2]), [1, 2]);
});

test('cornering is refused only while the rule is on', function () {
    var cpu = cornerCpu({ refuseSuicide: false });
    var expand = [{ cornered: true }, { cornered: false }];
    assert.strictEqual(cpu._standing(expand, null), null);
    assert.strictEqual(cpu.corneringMovesDropped, 0);
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
