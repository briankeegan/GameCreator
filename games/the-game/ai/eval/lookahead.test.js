// DOES THE DEPTH-2 SEARCH ACTUALLY SEARCH? Run: node lookahead.test.js
//
// The old version of this file passed 4/4 against a lookahead with three
// separate defects, which is the whole lesson: it asserted that depth 2
// was WIRED (different moves, more work for a wider beam) and never once
// asserted that it was RIGHT. "Wired" and "correct" look identical from
// the outside, so every test here is a property of the CHOICE, measured
// against real level-10 play.
//
// THE ONE INVARIANT. A depth-2 search picks the move with the best
// two-move future. So for every real decision: no candidate may have a
// strictly higher two-move value than the one the bot played. A candidate
// here is HOLD or any legal swap; its two-move value is the best board
// reachable from it in one more move, or its own score if nothing is
// reachable. Everything below is that invariant, or a guard that the
// invariant is being asked on positions where it can fail.
//
// The three defects it catches, all of which the old file passed:
//   1. only the top BEAM candidates by IMMEDIATE score were expanded, so
//      the move that looks poor now and pays later — the only reason to
//      search at all — could never be found;
//   2. HOLD was never expanded, so waiting was judged one move deep while
//      swapping was judged two. Waiting is how a chain gets built;
//   3. the incumbent was carried as a depth-1 number and challengers as
//      depth-2 numbers, so the comparison mixed two different quantities.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require('./puyocpu.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var W = { matchPotential: 229, chainPotential: 258, colourVariance: 168,
          maxHeight: 136, roughness: 294, garbageSent: 107, travelCost: 10 };
var EPS = 1e-9;

// GROUND TRUTH, COMPUTED THE SLOW OBVIOUS WAY.
//
// Every candidate, every follow-up, no beam, no shortcuts — through the
// bot's own _score and _resolveCandidate so the numbers are the numbers it
// works in. This is not a second implementation of the policy: it returns
// the VALUES, and the tests assert relations between them and what the
// bot played.
function valuations(cpu) {
    var board = cpu._snapshot();
    cpu._incoming = board.incoming || null;
    var cands = [];

    var hold = board.clone();
    cands.push({ kind: 'hold', board: hold,
                 score: cpu._score(hold, cpu._resolveCandidate(hold), null) });

    board.legalSwaps().forEach(function (s) {
        var t = board.clone();
        t.swap(s[0], s[1]);
        cands.push({ kind: 'swap', move: s, board: t,
                     score: cpu._score(t, cpu._resolveCandidate(t), s) });
    });

    cands.forEach(function (cand) {
        var v = cand.score;
        cand.board.legalSwaps().forEach(function (s) {
            var child = cand.board.clone();
            child.swap(s[0], s[1]);
            var f = cpu._score(child, cpu._resolveCandidate(child), null);
            if (f > v) v = f;
        });
        cand.value = v;
    });
    return cands;
}

function key(d) { return d.kind === 'hold' ? 'hold' : 'swap:' + d.move[0] + ',' + d.move[1]; }

// Run a real game at level 10 and stop at each decision point with the
// board the bot is about to decide on. Real engine, real boards — nothing
// here is typed out by hand.
function playOut(opts, limit, seed) {
    var stack = new PanelEngine.Stack({ level: 10, seed: seed, countdown: false });
    var cpu = new PuyoCpu(stack, Object.assign({ weights: W, reaction: 12 }, opts));
    var out = [];
    for (var f = 0; f < 4000 && out.length < limit; f++) {
        if (f > 120 && f % 120 === 0) stack.receiveGarbage([{ width: 6, height: 3, isChain: false }]);
        if (!cpu._walk && cpu.cooldown === 0 && !stack.gameOver) {
            var cands = valuations(cpu);
            out.push({ at: seed + '/' + f, cands: cands, played: cpu._decide() });
        }
        cpu.update(); stack.run(); stack.drainEvents();
        if (stack.gameOver) break;
    }
    return out;
}

// Across several real seeds, because one level-10 game does not last long
// enough to be a sample.
function decisions(opts, limit) {
    var out = [];
    [7, 3, 11, 5, 19].forEach(function (seed) {
        if (out.length < limit) out = out.concat(playOut(opts, limit - out.length, seed));
    });
    return { list: out };
}

test('setup: real decisions, with something to choose between', function () {
    var d = decisions({ depth: 2 }, 40);
    assert.ok(d.list.length >= 30, 'only ' + d.list.length + ' decisions observed');
    var widths = {};
    d.list.forEach(function (x) { widths[x.cands.length] = 1; });
    assert.ok(Object.keys(widths).length >= 3,
        'every decision had the same number of candidates — this would pass for a fixed cap');
});

test('it plays the best two-move future, on every decision', function () {
    // THE invariant. Collected over every decision rather than thrown on
    // the first, so a failure says how often and by how much.
    var d = decisions({ depth: 2 }, 40);
    var bad = [];
    d.list.forEach(function (x) {
        var played = x.cands.filter(function (c) { return key(c) === key(x.played); })[0];
        if (!played) { bad.push('frame ' + x.frame + ': played ' + key(x.played) + ', not a candidate'); return; }
        var best = x.cands.reduce(function (a, b) { return b.value > a.value ? b : a; });
        if (best.value > played.value + EPS) {
            bad.push('frame ' + x.frame + ': played ' + key(played) + ' worth ' + played.value.toFixed(1) +
                     ' when ' + key(best) + ' was worth ' + best.value.toFixed(1));
        }
    });
    assert.deepStrictEqual(bad.slice(0, 6), [],
        bad.length + ' of ' + d.list.length + ' decisions took a worse two-move future:\n  ' +
        bad.slice(0, 6).join('\n  '));
});

test('the move that looks bad NOW and pays LATER is the one it plays', function () {
    // The reason a search exists. Scored by immediate value, the winner is
    // often nowhere near the top — a beam over the immediate ranking
    // cannot reach it. This asserts those decisions EXIST (or the
    // invariant above is being asked somewhere it cannot fail) and that
    // the bot got them right.
    var d = decisions({ depth: 2 }, 40);
    var interesting = 0, wrong = [];
    d.list.forEach(function (x) {
        var byNow = x.cands.slice().sort(function (a, b) { return b.score - a.score; });
        var best = x.cands.reduce(function (a, b) { return b.value > a.value ? b : a; });
        var rank = byNow.map(key).indexOf(key(best));
        if (rank < 6) return;              // inside the old beam: proves nothing
        interesting++;
        if (key(x.played) !== key(best) &&
            best.value > x.cands.filter(function (c) { return key(c) === key(x.played); })[0].value + EPS) {
            wrong.push('frame ' + x.frame + ': best future ranked #' + (rank + 1) + ' by immediate score, played ' + key(x.played));
        }
    });
    assert.ok(interesting >= 3,
        'only ' + interesting + ' decisions where the best future was outside the top 6 by immediate ' +
        'score — too few for this to be testing anything');
    assert.deepStrictEqual(wrong.slice(0, 6), [], wrong.length + ' missed:\n  ' + wrong.slice(0, 6).join('\n  '));
});

test('holding is judged at the same depth as swapping', function () {
    // Waiting is how a chain gets built, so a search that scores hold one
    // move deep and every swap two moves deep is biased against the only
    // move that builds — and it is biased invisibly, because hold still
    // gets a number.
    //
    // Counted exactly rather than bounded: an unbeamed depth-2 decision
    // scores every candidate once plus every candidate's follow-ups. Hold
    // is a candidate. A short count names how many expansions are missing.
    var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: W, reaction: 12, depth: 2 });
    for (var f = 0; f < 300; f++) { cpu.update(); stack.run(); stack.drainEvents(); }
    while (cpu._walk || cpu.cooldown > 0) { cpu.update(); stack.run(); stack.drainEvents(); }

    var cands = valuations(cpu);
    var expected = cands.length;
    cands.forEach(function (c) { expected += c.board.legalSwaps().length; });
    var holdFollowUps = cands.filter(function (c) { return c.kind === 'hold'; })[0]
                             .board.legalSwaps().length;

    var before = cpu.evaluations;
    cpu._decide();
    var spent = cpu.evaluations - before;
    assert.strictEqual(spent, expected,
        'a depth-2 decision over ' + cands.length + ' candidates scored ' + spent +
        ' boards where a full expansion is ' + expected + '. Hold alone accounts for ' +
        holdFollowUps + ' of them.');
});

test('depth 1 is the old bot, move for move', function () {
    // Everything already measured — the shipped weights, the held-out
    // numbers, identity.golden.json — describes a bot with no lookahead.
    // They stay true only if the default path is untouched.
    function play(opts) {
        var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
        var cpu = new PuyoCpu(stack, Object.assign({ weights: W, reaction: 12 }, opts));
        var moves = [];
        for (var f = 0; f < 1200; f++) {
            cpu.update(); stack.run(); stack.drainEvents();
            if (stack.gameOver) break;
            if (cpu._walk) moves.push(cpu._walk.row + ':' + cpu._walk.col);
        }
        return { moves: moves.join(','), score: stack.score, decisions: cpu.decisions };
    }
    var a = play({}), b = play({ depth: 1 });
    assert.strictEqual(a.moves, b.moves, 'depth 1 is not the default behaviour');
    assert.strictEqual(a.score, b.score);
    assert.ok(a.decisions > 20, 'only ' + a.decisions + ' decisions — the game barely ran');
});

test('an explicit beam still obeys the invariant on what it kept', function () {
    // The beam is opt-in now (engine mode cannot afford full expansion),
    // and a bounded search is allowed to miss — but it is NOT allowed to
    // mix depths. Within the candidates it expanded, the choice must still
    // be the best two-move future.
    var d = decisions({ depth: 2, beam: 8 }, 25);
    var bad = [];
    d.list.forEach(function (x) {
        var byNow = x.cands.slice().sort(function (a, b) { return b.score - a.score; });
        var kept = byNow.slice(0, 8);
        if (!kept.some(function (c) { return c.kind === 'hold'; })) kept.push(
            x.cands.filter(function (c) { return c.kind === 'hold'; })[0]);
        var played = x.cands.filter(function (c) { return key(c) === key(x.played); })[0];
        var best = kept.reduce(function (a, b) { return b.value > a.value ? b : a; });
        if (played && best.value > played.value + EPS) {
            bad.push('frame ' + x.frame + ': beam kept ' + key(best) + ' (' + best.value.toFixed(1) +
                     ') and played ' + key(played) + ' (' + played.value.toFixed(1) + ')');
        }
    });
    assert.deepStrictEqual(bad.slice(0, 6), [],
        bad.length + ' beamed decisions chose worse than what the beam held:\n  ' + bad.slice(0, 6).join('\n  '));
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
