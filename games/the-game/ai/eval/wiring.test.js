// IS THE EVALUATOR ACTUALLY WIRED INTO THE GAME? Run: node wiring.test.js
//
// The other three suites can all be green while the evaluator does nothing.
// features.test.js scores hand-built inputs. input.fidelity.test.js compares
// fromStack to a Stack. seam.test.js checks single calls to patched methods.
// None of them plays the game — and every wiring defect this directory has
// had was invisible until something played 900 frames:
//
//   - _evaluate was attached to a benchmark that never calls it. Counted:
//     level 3 -> 7519 calls, level 5 -> 0, level 8 -> 0, level 10 -> 15.
//   - even where it was called, INVERTED scoring produced byte-identical
//     play, because the ranking decided ~5% of moves.
//   - framesToDeath returned Infinity, so every candidate tied and every
//     other feature was annihilated.
//   - at zero weights the seam picked the FIRST swap instead of keeping the
//     shipped choice, dropping survival from 2546 frames to 810. A
//     single-board unit test asserted exactly that property and passed.
//
// Every one of those looked like "no difference" or "fine". So this file
// exists, and it is slow on purpose: it runs the real cpu against the real
// engine and asserts the laws that make a later measurement mean anything.
var assert = require('assert');
var bench = require('./bench.js');
var registry = require('./registry.js');

var SEEDS = [1, 2, 3];
var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function zeros() { var z = {}; registry.keys.forEach(function (k) { z[k] = 0; }); return z; }
function frames(w, opts) { return SEEDS.map(function (s) { return bench.run(w, s, opts).frames; }); }

// LAW 1. An untrained evaluator is neutral, not a handicap.
test('LAW: at zero weights the game plays EXACTLY as shipped', function () {
    var shipped = frames(null);
    var inert = frames(zeros());
    assert.deepStrictEqual(inert, shipped,
        'zero weights changed play: shipped ' + JSON.stringify(shipped) +
        ' vs inert ' + JSON.stringify(inert) + '. Some seam is replacing the ' +
        'shipped answer instead of adding to it, so every future A/B would ' +
        'compare shipped against something already broken.');
});

// LAW 2. The measurement is repeatable. Without this a GA fits noise.
test('LAW: the benchmark is deterministic', function () {
    assert.deepStrictEqual(frames(null), frames(null), 'shipped arm varies between runs');
    assert.deepStrictEqual(frames(zeros()), frames(zeros()), 'inert arm varies between runs');
});

// LAW 3. Detaching restores the shipped AI completely.
test('LAW: an evaluator arm cannot contaminate the shipped arm', function () {
    var before = frames(null);
    frames({ maxHeight: 100, links: 50 });
    assert.deepStrictEqual(frames(null), before, 'the shipped arm changed after an evaluator arm');
});

// LAW 4. The evaluator can actually change how the game is played.
test('LAW: weighting features changes play at all', function () {
    var shipped = frames(null);
    var weighted = frames(Object.assign(zeros(), { maxHeight: 200, roughness: 200 }));
    assert.notDeepStrictEqual(weighted, shipped,
        'no weighting changed a single frame — the seam is not reaching the game');
});

// LAW 5. Each feature is REACHABLE, or is listed as unreachable ON PURPOSE.
//
// This is the one that keeps finding things. A feature nobody can reach is
// not a feature — and worse, a GA will happily assign it a weight, since
// noise moves the fitness as readily as signal.
//
// UNREACHABLE is an explicit list, not a tolerance. Adding to it is a
// deliberate statement that this benchmark cannot exercise that feature,
// with the reason written down; removing something from it happens when a
// seam grows to feed it. A feature that becomes reachable while still
// listed here also FAILS, so the list cannot rot into a permanent excuse.
var UNREACHABLE = {
    matchPotential: 'candidates are already-resolved boards, so the swaps this counts are one move further ahead than anything the search ranks',
    latentChain: 'needs a live cascade; bench.js positions are settled, so chainMarks is null',
    garbageOnBoard: 'the defensive seam has no board, and the building seam only runs when garbage is not the problem',
    incomingGarbage: 'constant across the candidates of any one decision — it is a property of the queue, not of the move',
    garbageAdjacency: 'same as garbageOnBoard: the paths that see garbage are not the paths that get a board',
    colourScarcity: 'rarely non-zero at level 3 with 5 colours in play',
    garbageCleared: 'constant across candidates on a board with no garbage down',
    framesToDeath: 'saturates at SAFE_FRAMES on every candidate until the board is actually topping out'
};

test('LAW: every feature is reachable, or listed as unreachable on purpose', function () {
    // CHECKED IN BOTH MODES; reachable in EITHER is enough. 'add' is
    // anchored to a heuristic that multiplies cleared garbage by
    // 1,000,000, so an earned feature cannot move that ranking however
    // correct it is — judging reachability only there condemns features
    // for the anchor's size rather than their own uselessness. 'replace'
    // is the mode PUYO_REFERENCE.md describes, where the features ARE the
    // scoring, and is the fair test of whether one can steer the game.
    var base = JSON.stringify(frames(zeros()));
    var baseReplace = JSON.stringify(frames(zeros(), { mode: 'replace' }));
    var wronglyDead = [], wronglyListed = [];
    registry.keys.forEach(function (k) {
        var w = zeros();
        w[k] = 100;
        var moved = JSON.stringify(frames(w)) !== base ||
                    JSON.stringify(frames(w, { mode: 'replace' })) !== baseReplace;
        if (!moved && !UNREACHABLE[k]) wronglyDead.push(k);
        if (moved && UNREACHABLE[k]) wronglyListed.push(k);
    });
    assert.deepStrictEqual(wronglyDead, [],
        'these features change nothing and are not listed as unreachable: ' +
        wronglyDead.join(', ') + '. Either the seam does not feed them, or they ' +
        'do not vary between the candidates of a decision. Find out which before ' +
        'training a weight for them.');
    assert.deepStrictEqual(wronglyListed, [],
        'these are listed as unreachable but DO change play now: ' +
        wronglyListed.join(', ') + '. Remove them from UNREACHABLE — the list is ' +
        'a statement about this benchmark, not a permanent excuse.');
});

// LAW 6. Enough of the game's decisions go through the evaluator to be worth
// measuring. Before the seam fixes this was about 5%, and a GA on that would
// have produced numbers that look learned and mean nothing.
test('LAW: a real share of decisions consults the evaluator', function () {
    var path = require('path');
    var GAME = path.join(__dirname, '..', '..');
    require(path.join(GAME, 'panel-engine.js'));
    require(path.join(GAME, 'panel-cpu.js'));
    var PanelEngine = globalThis.PanelEngine, PanelCpu = globalThis.PanelCpu;
    var P = PanelCpu.SearchCpu.prototype;
    var seen = { decisions: 0, consulted: 0 };
    // EVERY seam, INCLUDING _buildScore. Leaving it out is how this law
    // reported an unchanged 28% immediately after the hook that exists to
    // raise that number — the law was watching the old seams only, and a
    // full 50-game run was spent discovering a gap in the counter rather
    // than in the code.
    var oc = P._choose, orb = P._raiseOrBuild, odk = P._defensiveKey,
        oev = P._evaluate, obs = P._buildScore;
    var touched = false;
    P._choose = function (b) { seen.decisions++; touched = false; var r = oc.call(this, b); if (touched) seen.consulted++; return r; };
    P._raiseOrBuild = function (b) { touched = true; return orb.call(this, b); };
    P._defensiveKey = function (a, b, c, d) { touched = true; return odk.call(this, a, b, c, d); };
    P._evaluate = function (a, b, c, d) { touched = true; return oev.call(this, a, b, c, d); };
    P._buildScore = function (b) { touched = true; return obs.call(this, b); };
    try {
        SEEDS.forEach(function (seed) {
            var stack = new PanelEngine.Stack({ level: bench.LEVEL, seed: seed, countdown: false });
            var cpu = new PanelCpu.SearchCpu(stack, { difficulty: 'nightmare', seed: seed + 55, mistake: 0, chainExtend: true });
            for (var f = 0; f < 900; f++) {
                if (f > 120 && f % 120 === 0) stack.receiveGarbage([{ width: 6, height: 3, isChain: false }]);
                cpu.update(); stack.run(); stack.takeDeliverableGarbage(); stack.drainEvents();
                if (stack.gameOver) break;
            }
        });
    } finally { P._choose = oc; P._raiseOrBuild = orb; P._defensiveKey = odk; P._evaluate = oev; P._buildScore = obs; }
    var share = seen.consulted / seen.decisions;
    process.stdout.write('       [share] ' + seen.consulted + '/' + seen.decisions +
        ' decisions consult a seam (' + (share * 100).toFixed(0) + '%)\n');
    assert.ok(share > 0.5, 'only ' + (share * 100).toFixed(0) + '% of decisions consult the ' +
        'evaluator. Training weights against that is fitting noise — this was 5% before the ' +
        'seam fixes and is the reason they exist.');
});

// RUN ONE LAW: node wiring.test.js <substring>. These laws play real games
// and the whole file is minutes; checking a single one should not cost
// fifty of them, which is exactly what it cost once.
var only = process.argv[2];
if (only) tests = tests.filter(function (t) { return t.name.indexOf(only) >= 0; });

tests.forEach(function (t) {
    try { t.fn(); process.stdout.write('  ok   ' + t.name + '\n'); }
    catch (e) { failures.push(t.name + '\n       ' + e.message); process.stdout.write('  FAIL ' + t.name + '\n'); }
});
if (failures.length) {
    process.stdout.write('\n' + failures.length + ' failed:\n\n' + failures.join('\n\n') + '\n');
    process.exit(1);
}
process.stdout.write('\n' + tests.length + ' laws hold — the evaluator is wired into the game.\n');
