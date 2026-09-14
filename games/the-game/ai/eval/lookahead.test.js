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
        // The second move starts where the first one left the cursor — at
        // the swap's own cell, or unmoved after a hold.
        var from = cand.kind === 'hold' ? null : cand.move;
        cand.board.legalSwaps().forEach(function (s) {
            var child = cand.board.clone();
            child.swap(s[0], s[1]);
            var f = cpu._score(child, cpu._resolveCandidate(child), s, from);
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

test('every hypothetical board is scored RESOLVED, at both plies', function () {
    // The scores only mean anything if each candidate board is the board
    // the game would actually be left with — cascade fired, panels fallen,
    // chain counted. A board scored mid-cascade makes a chain invisible,
    // and it makes it invisible SILENTLY: the number still looks like a
    // number.
    //
    // Two facts, both counted from inside: every scored board went through
    // _resolveCandidate, and every _score call was handed that resolve's
    // result. The second ply is checked the same way as the first, through
    // the same function, so the two plies cannot drift apart.
    var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: W, reaction: 12, depth: 2 });
    for (var f = 0; f < 300; f++) { cpu.update(); stack.run(); stack.drainEvents(); }
    while (cpu._walk || cpu.cooldown > 0) { cpu.update(); stack.run(); stack.drainEvents(); }

    var resolves = 0, scored = 0, unresolved = [];
    var origResolve = cpu._resolveCandidate, origScore = cpu._score;
    var lastOut = null;
    cpu._resolveCandidate = function (b) { resolves++; lastOut = origResolve.call(this, b); return lastOut; };
    cpu._score = function (b, resolved, move) {
        scored++;
        if (!resolved || typeof resolved.chainLength !== 'number') {
            unresolved.push('candidate ' + scored + ' scored with no resolve result');
        } else if (resolved !== lastOut) {
            unresolved.push('candidate ' + scored + ' scored against a DIFFERENT board\'s resolve');
        }
        return origScore.apply(this, arguments);
    };
    cpu._decide();
    cpu._resolveCandidate = origResolve; cpu._score = origScore;

    assert.ok(scored > 100, 'only ' + scored + ' boards scored — this is not a depth-2 decision');
    assert.strictEqual(resolves, scored,
        scored + ' boards were scored but only ' + resolves + ' were resolved — ' +
        (scored - resolves) + ' were scored in whatever state the swap left them');
    assert.deepStrictEqual(unresolved.slice(0, 5), [],
        unresolved.length + ' boards scored against the wrong settle:\n  ' + unresolved.slice(0, 5).join('\n  '));
});

test('the second ply branches from the board the first ply was SCORED on', function () {
    // The two must be the same position. If a candidate is scored on one
    // board and searched from another, its number and its future describe
    // different games, and nothing in the output would look wrong.
    //
    // Run with rise ON, because that is the switch that separates them:
    // rise advances the candidate a whole incoming row. Applied to a
    // throwaway clone, the score sees the risen board and the search sees
    // the un-risen one.
    //
    // THE FIRST VERSION OF THIS TEST COULD NOT FIRE, which is why it says
    // this. It compared the board object handed to _score against the board
    // _value branched from — and under the bug those are the SAME un-risen
    // object, because the rise went to a copy _score kept to itself. It
    // passed with the defect restored. So it asks two things now: that
    // _score ADVANCED the candidate at all, and that the second ply
    // branches from what it advanced to.
    var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: W, reaction: 12, depth: 2, rise: true });
    for (var f = 0; f < 300; f++) { cpu.update(); stack.run(); stack.drainEvents(); }
    while (cpu._walk || cpu.cooldown > 0) { cpu.update(); stack.run(); stack.drainEvents(); }

    var n = cpu._snapshot().legalSwaps().length + 1;
    var print = function (b) { return JSON.stringify(b.grid); };
    var before = [], after = [], k = 0, stale = [];
    var origScore = cpu._score, origValue = cpu._value;
    cpu._score = function (b) {
        var pre = print(b);
        var out = origScore.apply(this, arguments);
        if (before.length < n) { before.push(pre); after.push(print(b)); }
        return out;
    };
    cpu._value = function (cand) {
        if (print(cand.board) !== after[k]) {
            stale.push('candidate ' + k + ' was scored on one board and searched from another');
        }
        k++;
        return origValue.call(this, cand);
    };
    cpu._decide();
    cpu._score = origScore; cpu._value = origValue;

    assert.strictEqual(k, n, 'expanded ' + k + ' of ' + n + ' candidates');
    var unmoved = 0;
    for (var i = 0; i < n; i++) if (before[i] === after[i]) unmoved++;
    assert.strictEqual(unmoved, 0,
        unmoved + ' of ' + n + ' candidates came out of _score on the board they went in on, ' +
        'with rise ON — the rise went somewhere the search cannot see');
    assert.deepStrictEqual(stale.slice(0, 5), [],
        stale.length + ' of ' + n + ' candidates search a position they were not scored on:\n  ' +
        stale.slice(0, 5).join('\n  '));
});

test('the second move pays travel from where the first move leaves the cursor', function () {
    // Travel is the only cost this game charges for CHOOSING a move, and a
    // second ply that treats it as free values a follow-up on the far side
    // of the board like one under the cursor — so the search would prefer
    // first moves whose payoff it could never reach in time.
    //
    // driveWalk walks to the swap's own cell and swaps there, so after
    // playing (r,c) the cursor is at (r,c). A hold moves nothing. Both
    // directions are asserted by watching what travel.cost is actually
    // asked, which a plausible-looking number cannot satisfy.
    var travel = require('./travel.js');
    var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: W, reaction: 12, depth: 2 });
    for (var f = 0; f < 300; f++) { cpu.update(); stack.run(); stack.drainEvents(); }
    while (cpu._walk || cpu.cooldown > 0) { cpu.update(); stack.run(); stack.drainEvents(); }

    var board = cpu._snapshot();
    cpu._incoming = board.incoming || null;
    var sw = board.legalSwaps()[0];
    var trial = board.clone();
    trial.swap(sw[0], sw[1]);
    var swapCand = { kind: 'swap', move: sw, board: trial,
                     score: cpu._score(trial, cpu._resolveCandidate(trial), sw) };
    var held = board.clone();
    var holdCand = { kind: 'hold', board: held,
                     score: cpu._score(held, cpu._resolveCandidate(held), null) };

    function originsOf(cand) {
        var seen = [], orig = travel.cost;
        travel.cost = function (r0, c0) { seen.push(r0 + ',' + c0); return orig.apply(this, arguments); };
        try { cpu._value(cand); } finally { travel.cost = orig; }
        return seen;
    }

    var afterSwap = originsOf(swapCand);
    assert.ok(afterSwap.length >= 10,
        'only ' + afterSwap.length + ' follow-ups were priced — nothing was expanded');
    var wrong = afterSwap.filter(function (o) { return o !== sw[0] + ',' + sw[1]; });
    assert.strictEqual(wrong.length, 0,
        wrong.length + ' of ' + afterSwap.length + ' follow-ups were priced from ' +
        (wrong[0] || '') + ' instead of ' + sw[0] + ',' + sw[1] + ', the cell the first move ends on');

    var afterHold = originsOf(holdCand);
    var cursor = stack.curRow + ',' + stack.curCol;
    var wrongHold = afterHold.filter(function (o) { return o !== cursor; });
    assert.strictEqual(wrongHold.length, 0,
        'after a hold the cursor has not moved, but ' + wrongHold.length + ' follow-ups were priced from ' +
        (wrongHold[0] || '') + ' instead of ' + cursor);
});

test('and that travel is IN the value, at the right size', function () {
    // Checking WHICH CELL travel.cost was asked about proves the input is
    // right and nothing more — it would pass if the answer were discarded.
    // Checking _score in isolation proves _score can price an origin, but
    // not that the search hands it one. Neither is the claim. The claim is
    // that a candidate's VALUE is lower when its best follow-up is further
    // away, so this goes through _value, the function the search actually
    // calls, and requires the number to the digit.
    //
    // travelCost is one unit per cell walked (features.js inverts
    // travel.js's frame formula) and its sign is -1, so the arithmetic is
    // exact: every extra cell is exactly weights.travelCost off the score.
    // "It goes down" would pass for a cost applied at the wrong scale, and
    // a cost at the wrong scale loses to roughness when it should win.
    var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: W, reaction: 12, depth: 2 });
    for (var f = 0; f < 300; f++) { cpu.update(); stack.run(); stack.drainEvents(); }
    while (cpu._walk || cpu.cooldown > 0) { cpu.update(); stack.run(); stack.drainEvents(); }

    var board = cpu._snapshot();
    cpu._incoming = board.incoming || null;
    var sw = board.legalSwaps()[0];
    var trial = board.clone();
    trial.swap(sw[0], sw[1]);
    var cand = { kind: 'swap', move: sw, board: trial,
                 score: cpu._score(trial, cpu._resolveCandidate(trial), sw) };

    // The same expansion done here, twice: once charging the walk from the
    // cell the first move ends on, once not charging it at all.
    function expand(from) {
        var best = cand.score;
        trial.legalSwaps().forEach(function (mv) {
            var child = trial.clone();
            child.swap(mv[0], mv[1]);
            var f = cpu._score(child, cpu._resolveCandidate(child), from ? mv : null, from);
            if (f > best) best = f;
        });
        return best;
    }
    var charged = expand(sw), free = expand(null);

    assert.ok(free > charged,
        'charging the walk changed nothing (' + free.toFixed(4) + ' either way) — the board ' +
        'has no follow-up far enough from ' + sw.join(',') + ' for this to be testing anything');
    assert.strictEqual(cpu._value(cand), charged,
        '_value returned ' + cpu._value(cand).toFixed(4) + '; charging the second move its real ' +
        'walk from ' + sw.join(',') + ' gives ' + charged.toFixed(4) + ', and moving for free gives ' +
        free.toFixed(4) + '. It is valuing a follow-up it could not reach in time.');

    // AND THE SIZE, not just the direction: one cell of walking is exactly
    // one travelCost off, so a cost applied at the wrong scale fails here
    // even though it would pass the comparison above.
    var mv = trial.legalSwaps()[0];
    function scoreFrom(from) {
        var child = trial.clone();
        child.swap(mv[0], mv[1]);
        return cpu._score(child, cpu._resolveCandidate(child), mv, from);
    }
    var base = scoreFrom([mv[0], mv[1]]), wrong = [];
    [[mv[0], mv[1] + 1], [mv[0] + 2, mv[1] + 3], [1, 1]].forEach(function (from) {
        var steps = Math.abs(mv[0] - from[0]) + Math.abs(mv[1] - from[1]);
        var got = scoreFrom(from), want = base - W.travelCost * steps;
        if (Math.abs(got - want) > 1e-6) {
            wrong.push(steps + ' cells away scored ' + got.toFixed(4) + ', and ' + steps +
                       ' cells at ' + W.travelCost + ' a cell is ' + want.toFixed(4));
        }
    });
    assert.deepStrictEqual(wrong, [], 'travel is priced at the wrong scale:\n  ' + wrong.join('\n  '));
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

// GC_ONLY=<substring> runs one test, so a single question costs seconds
// rather than the whole suite. Used to prove a check fires both ways.
if (process.env.GC_ONLY) tests = tests.filter(function (t) { return t.name.indexOf(process.env.GC_ONLY) >= 0; });
tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
