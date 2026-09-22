// DO THE MODES DO WHAT THEY CLAIM? Run: node modes.test.js
//
// modes.js is a pool filter and nothing else: it decides which candidates a
// decision is allowed to choose between, and the evaluator still picks. Each
// claim below is one that can hold in prose while failing in play.
//
//   1. BUILD keeps a move that clears NOTHING. That is what building is. A
//      filter that demanded a payout every move would be the opposite bot.
//   2. BUILD drops a clear that paid nothing, and keeps one that paid — by
//      links, by width, or by breaking garbage. Three arms, each tested
//      alone, because two working arms hide a dead third.
//   3. The thresholds are read. A test that only ever passes T=4 cannot
//      tell a threshold from a constant.
//   4. FORCED opens on exactly two things. Not on a deep stack, not on an
//      empty pool for its own sake.
//   5. A broken plan is COUNTED. It is the defect this design is judged on,
//      and an uncounted defect is one nobody can drive down.
//   6. Modes off is today's bot, decision for decision. Off has to be free.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require('./puyocpu.js');
var registry = require('./registry.js');
var modes = require('./modes.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var LEVEL = 10;
var T = 4, S = 4;

// A resolve() result, in the shape panel-cpu.js actually returns.
function res(o) {
    return { chainLength: o.chainLength || 0,
             comboSizes: o.comboSizes || [],
             brokeGarbage: o.brokeGarbage || 0,
             stopTimeEarned: 0, garbage: [], truncated: false };
}

function zeros() { var w = {}; registry.keys.forEach(function (k) { w[k] = 0; }); return w; }
function sample() {
    var w = zeros();
    w.linksH = 13; w.linksV = 12; w.colourVariance = 2; w.edgePenalty = 8;
    w.maxHeight = 30; w.garbageOnBoard = 25;
    return w;
}

// ---------------------------------------------------------------- 1. building

test('BUILD keeps a move that clears nothing — that IS the build move', function () {
    assert.strictEqual(modes.pays(res({}), T, S), true);
});

test('hold, which clears nothing, is never filtered out of BUILD', function () {
    // Stated separately from the case above because it is the one candidate
    // that must ALWAYS survive: a pool without hold cannot wait, and waiting
    // is how a chain gets built.
    assert.strictEqual(modes.pays(res({}), T, S), true);
});

// ------------------------------------------------------------ 2. the three arms

test('BUILD drops a bare 3 — it scores nothing and sends nothing', function () {
    assert.strictEqual(modes.pays(res({ chainLength: 1, comboSizes: [3] }), T, S), false);
});

test('BUILD keeps a 4-wide combo (the width arm, alone)', function () {
    assert.strictEqual(modes.pays(res({ chainLength: 1, comboSizes: [4] }), T, S), true);
});

test('BUILD keeps a 4-link chain (the links arm, alone)', function () {
    // Every link a bare 3, so the width arm cannot be what passed it.
    assert.strictEqual(modes.pays(res({ chainLength: 4, comboSizes: [3, 3, 3, 3] }), T, S), true);
});

test('BUILD keeps a bare 3 that breaks garbage (the garbage arm, alone)', function () {
    assert.strictEqual(modes.pays(res({ chainLength: 1, comboSizes: [3], brokeGarbage: 2 }), T, S), true);
});

// ------------------------------------------------------------- 3. thresholds

test('the link threshold is read, not assumed', function () {
    var three = res({ chainLength: 3, comboSizes: [3, 3, 3] });
    assert.strictEqual(modes.pays(three, 4, S), false, 'T=4 must reject a 3-link chain');
    assert.strictEqual(modes.pays(three, 3, S), true,  'T=3 must accept the same chain');
});

test('the width threshold is read, not assumed', function () {
    var five = res({ chainLength: 1, comboSizes: [5] });
    assert.strictEqual(modes.pays(five, T, 6), false, 'S=6 must reject a 5-wide combo');
    assert.strictEqual(modes.pays(five, T, 5), true,  'S=5 must accept the same combo');
});

test('payout reports links and width separately', function () {
    var p = modes.payout(res({ chainLength: 2, comboSizes: [3, 6] }));
    assert.strictEqual(p.links, 2);
    assert.strictEqual(p.wide, 6, 'width is the BIGGEST link, not the last or the sum');
});

test('a move that clears nothing has no payout and does not count as firing', function () {
    assert.strictEqual(modes.fires(res({}), T, S), false);
});

test('fires is the payout arms only — breaking garbage is not firing', function () {
    // Breaking garbage keeps a move in the pool. It is not a payout, so it
    // is not what records the decision as ATTACK.
    assert.strictEqual(modes.fires(res({ chainLength: 1, comboSizes: [3], brokeGarbage: 4 }), T, S), false);
    assert.strictEqual(modes.pays(res({ chainLength: 1, comboSizes: [3], brokeGarbage: 4 }), T, S), true);
});

// --------------------------------------------- 3b. target, and the bar it sets

test('about to die is TOPPED OUT', function () {
    // THE ENGINE'S OWN CONDITION, not a proxy for it. advancePassiveRaise:
    //
    //   if (!riseLock && stopTime === 0) {
    //     if (isToppedOut()) health--;   else { rise }
    //   }
    //
    // Stop time freezes everything — the stack does not rise and health does
    // not drain while it runs. So danger is exactly those two together, and
    // at level 10 maxHealth is 1, so one frame of it is death.
    assert.strictEqual(modes.forced({ toppedOut: true, stopTime: 0, stopFloor: 30 }), true);
});

test('topped out fires whatever the clock says', function () {
    // The clock used to gate this. It never bit: over 12 duels only 14 of
    // 1,370 decisions were topped out at all, and on every one of them no
    // candidate banked time, so escapeFrames returned Infinity and the
    // comparison was true by construction. The condition described a
    // behaviour the bot did not have.
    assert.strictEqual(modes.forced({ toppedOut: true, stopTime: 120, stopFloor: 30 }), true);
    assert.strictEqual(modes.forced({ toppedOut: true, stopTime: 0, stopFloor: 30 }), true);
});

test('height alone is still NOT the trigger', function () {
    // A rows-to-the-ceiling margin was tried and fired FORCED on 47% of
    // decisions while buying zero extra survival. Topped out means a panel
    // in the top row, not a tall stack.
    assert.strictEqual(modes.forced({ toppedOut: false, stopTime: 0, stopFloor: 30 }), false);
});

test('a full board that is not topped out is not about to die either', function () {
    assert.strictEqual(modes.forced({ toppedOut: false, stopTime: 0, stopFloor: 30 }), false);
});

test('the stop floor no longer decides anything', function () {
    assert.strictEqual(modes.forced({ toppedOut: true, stopTime: 20, stopFloor: 10 }), true);
    assert.strictEqual(modes.forced({ toppedOut: true, stopTime: 20, stopFloor: 30 }), true);
});

test('pre-stop time counts toward the clock', function () {
    // decrementTimers drains preStopTime FIRST and only then stopTime, and
    // the rise gate reads stopTime alone — so pre-stop does not protect on
    // its own, it postpones the drain. Frames of safety are the sum. Still
    // measured, and still reported; it just does not gate FORCED.
    assert.strictEqual(modes.clock({ stopTime: 20, preStopTime: 40 }), 60);
    assert.strictEqual(modes.clock({ stopTime: 20, preStopTime: 0 }), 20);
});

test('an escape is a move that BANKS TIME, not just one that clears', function () {
    // awardStopTime is gated on `comboSize > 3 || isChain`, so a bare three
    // clears panels and banks nothing. It is not a way out. The two that are:
    // break something, or make a combo — plus a chain, which is the biggest
    // payer of all at the ceiling.
    assert.strictEqual(modes.banksTime(res({ chainLength: 1, comboSizes: [3] })), false);
    assert.strictEqual(modes.banksTime(res({ chainLength: 1, comboSizes: [4] })), true);
    assert.strictEqual(modes.banksTime(res({ chainLength: 2, comboSizes: [3, 3] })), true);
});

test('breaking garbage banks time even on a three', function () {
    // The popping garbage extends preStopTime (FLASH + FACE + POP per panel
    // INCLUDING the garbage cells), which postpones the stop-time drain. It
    // is time, so it is an escape.
    assert.strictEqual(modes.banksTime(res({ chainLength: 1, comboSizes: [3], brokeGarbage: 3 })), true);
});

test('a move that clears nothing banks nothing', function () {
    assert.strictEqual(modes.banksTime(res({})), false);
});

test('the floor is DERIVED from what it takes to act, not guessed', function () {
    // The bot is a computer; it can be exact. What it needs to escape is
    // one more decision (reaction), the walk to the move (travel.cost), and
    // the frames panels take to fall before they match (HOVER). Below that
    // sum it physically cannot reach anything that banks stop time before
    // the stack unfreezes, and at level 10 unfreezing at the ceiling is
    // death in one frame.
    assert.strictEqual(modes.escapeFrames({ reaction: 12, travel: 9, hover: 6 }), 27);
    assert.strictEqual(modes.escapeFrames({ reaction: 12, travel: 0, hover: 6 }), 18);
});

test('no reachable escape means the floor is infinite', function () {
    // Nothing clears from here, so no move banks stop time and no clock is
    // enough. Danger, whatever the number says.
    assert.strictEqual(modes.escapeFrames({ reaction: 12, travel: null, hover: 6 }), Infinity);
});

test('escapeFrames is still what it takes to act, and is still reported', function () {
    // It no longer gates FORCED, but it is the honest measure of whether a
    // move is reachable in time and the survivable() ranking is built on it.
    assert.strictEqual(modes.escapeFrames({ reaction: 12, travel: 9, hover: 6 }), 27);
});

test('FORCED opens when the plan broke, whatever the clock says', function () {
    assert.strictEqual(modes.forced({ toppedOut: false, stopTime: 999, stopFloor: 30,
                                      broke: true }), true);
});

// ------------------------------------------------------------- 5. broken plans

test('a plan breaks when what it was saving for is gone', function () {
    assert.strictEqual(modes.planBroke({ links: 4, wide: 3 }, { links: 1, wide: 3 }, false, T, S), true);
});

test('a plan does not break when we spent it on purpose', function () {
    assert.strictEqual(modes.planBroke({ links: 4, wide: 3 }, { links: 1, wide: 3 }, true, T, S), false,
        'firing the chain is why it is gone — that is success, not a defect');
});

test('a plan not yet worth saving cannot break', function () {
    assert.strictEqual(modes.planBroke({ links: 2, wide: 3 }, { links: 0, wide: 0 }, false, T, S), false,
        'nothing above the threshold was ever being held');
});

test('a plan holds when the potential is unchanged', function () {
    assert.strictEqual(modes.planBroke({ links: 4, wide: 3 }, { links: 4, wide: 3 }, false, T, S), false);
});

test('a widening plan is not a broken one', function () {
    assert.strictEqual(modes.planBroke({ links: 4, wide: 3 }, { links: 6, wide: 3 }, false, T, S), false);
});

// ------------------------------------- 5b. what the RISE is about to do

test('a move that clears nothing but rises into a bare 3 does not pay', function () {
    // The stack rises whether or not the bot acts, and the row that is
    // coming is known BEFORE the move is chosen. So a three the board makes
    // by itself is not unavoidable: it is a move the bot should have
    // declined. The merged resolve carries the rise's own clears, so this is
    // the same predicate reading a longer list — nothing new decides it.
    assert.strictEqual(modes.pays(res({ chainLength: 1, comboSizes: [3] }), T, S), false);
});

test('a paying move that also rises into a 3 still pays', function () {
    // The rise's bare 3 rides along in comboSizes; the 6 is why the move is
    // worth making. Dropping it because of the 3 would be the filter eating
    // the moves it exists to keep.
    assert.strictEqual(modes.pays(res({ chainLength: 1, comboSizes: [6, 3] }), T, S), true);
});

test('the widest link decides, wherever in the cascade it sits', function () {
    assert.strictEqual(modes.payout(res({ chainLength: 1, comboSizes: [3, 3, 7, 3] })).wide, 7);
});

// ------------------------------------------------- 6. wired into the bot

// THESE USE THE SHIPPED WEIGHTS, and the unit tests above do not.
//
// sample() exists to test the MACHINE — it is a plausible-shaped set that
// was never trained, and at level 10 it tops out in ten to twenty seconds.
// A bot that dies that fast never gets a board worth building on, so BUILD
// has nothing to filter and the mode shares say nothing. Measured: 20 to 60
// swaps a game and one or two clears total.
//
// The claims below are about PLAY, so they need a bot that survives. They
// assert a DIRECTION and never a magnitude, so re-shipping a different set
// moves the numbers without breaking the test.
// AT DEPTH 1, and deliberately. The filter sits in _decide ahead of the
// depth branch, so it is the same filter either way, and depth 2 beam 0
// costs 13x the wall clock for the same answer — measured on seed 101 at
// 6000 frames: payless 44 -> 16 at depth 1, 44 -> 19 at depth 2 beam 0,
// 43 -> 14 at depth 2 beam 6, 0.25s a game against 3.3s. A gate nobody will
// wait for is a gate that gets skipped. The ply-2 filter has its own test
// below, at depth 2, because that is the only claim depth 1 cannot make.
var switches = require('./switches.js');
var SHIPPED = switches.load();
function shipped(extra) {
    var o = { weights: SHIPPED.weights, depth: 1, beam: 0, rise: true, density: false };
    for (var k in extra) o[k] = extra[k];
    return o;
}

// Returns what the ENGINE saw, not what the bot believed: a payless clear is
// a match of exactly 3 that is not a chain link and broke no garbage. The
// engine's own tables score it 0 and send nothing, so it is the thing BUILD
// exists to refuse.
function playGame(opts, seed, frames, garbageEvery) {
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: seed, countdown: false });
    var cpu = new PuyoCpu(stack, opts);
    var payless = 0, paying = 0, moves = [];
    for (var f = 0; f < (frames || 4000); f++) {
        if (garbageEvery && f > 120 && f % garbageEvery === 0) {
            stack.receiveGarbage([{ width: 6, height: 2, isChain: false }]);
        }
        cpu.update();
        stack.run();
        var evs = stack.drainEvents();
        for (var e = 0; e < evs.length; e++) {
            var ev = evs[e];
            if (ev.type === 'swap') moves.push(f + ':' + ev.row + ',' + ev.col);
            if (ev.type !== 'match') continue;
            if (!ev.chain && ev.size === 3 && !ev.garbage) payless++; else paying++;
        }
        if (stack.gameOver) break;
    }
    return { cpu: cpu, stack: stack, payless: payless, paying: paying, moves: moves, frames: f };
}

test('modes OFF is today\'s bot, swap for swap', function () {
    // Off has to be free. Every number this repo has was taken without modes,
    // and a default that quietly changes play invalidates all of them. Run on
    // sample() as well as shipped: this claim is about the machine.
    [101, 102, 103].forEach(function (seed) {
        var a = playGame({ weights: sample() }, seed, 2500);
        var b = playGame({ weights: sample(), modes: false }, seed, 2500);
        assert.deepStrictEqual(b.moves, a.moves, 'seed ' + seed + ': sample weights diverged');
        var c = playGame(shipped({}), seed, 3000);
        var d = playGame(shipped({ modes: false }), seed, 3000);
        assert.deepStrictEqual(d.moves, c.moves, 'seed ' + seed + ': shipped weights diverged');
    });
});

test('modes ON changes how it plays', function () {
    // Not a formality: a filter wired to a field the candidates do not carry
    // filters nothing and passes every unit test in this file.
    [101, 102, 103].forEach(function (seed) {
        var off = playGame(shipped({}), seed, 4000);
        var on = playGame(shipped({ modes: true }), seed, 4000);
        assert.notDeepStrictEqual(on.moves, off.moves, 'seed ' + seed + ': modes changed nothing');
    });
});

test('modes ON makes fewer payless clears, and more paying ones', function () {
    // THE POINT OF STEP 1. Both halves matter: a bot that simply clears less
    // would pass the first and fail the second, and it would be a worse bot.
    var seeds = [101, 102, 103, 104, 105];
    var onPayless = 0, offPayless = 0, onPaying = 0, offPaying = 0;
    seeds.forEach(function (seed) {
        var off = playGame(shipped({}), seed, 6000);
        var on = playGame(shipped({ modes: true }), seed, 6000);
        offPayless += off.payless; offPaying += off.paying;
        onPayless += on.payless;  onPaying += on.paying;
    });
    assert.ok(onPayless < offPayless,
        'payless clears ' + onPayless + ' on vs ' + offPayless + ' off — the filter is not filtering');
    assert.ok(onPaying > offPaying,
        'paying clears ' + onPaying + ' on vs ' + offPaying + ' off — it stopped clearing rather than started paying');
});

test('the bot reports its mode shares, and they account for every decision', function () {
    var g = playGame(shipped({ modes: true }), 101, 6000);
    var m = g.cpu.modeCounts;
    assert.ok(m, 'no modeCounts on the bot at all');
    assert.strictEqual(m.BUILD + m.ATTACK + m.FORCED, g.cpu.decisions,
        'modes account for ' + (m.BUILD + m.ATTACK + m.FORCED) + ' of ' + g.cpu.decisions + ' decisions');
    assert.ok(m.BUILD > 0, 'never once in BUILD — the mode does not engage');
});

test('FORCED is the exception, not the bot', function () {
    // The diagnostic that separates "the filter is wrong" from "the escape
    // hatch is too wide". A bot that is FORCED most of the time is today's
    // bot with machinery around it, and would score exactly like it.
    var worst = 0;
    [101, 102, 103].forEach(function (seed) {
        var g = playGame(shipped({ modes: true }), seed, 6000);
        var m = g.cpu.modeCounts, t = m.BUILD + m.ATTACK + m.FORCED;
        worst = Math.max(worst, m.FORCED / t);
    });
    assert.ok(worst < 0.5, 'FORCED on ' + (100 * worst).toFixed(0) + '% of decisions at worst');
});

test('broken plans are counted', function () {
    var g = playGame(shipped({ modes: true }), 101, 6000);
    assert.strictEqual(typeof g.cpu.brokenPlans, 'number',
        'the defect this design is judged on is not being counted');
});

test('modes OFF counts nothing, so the instrumentation cannot cost anything', function () {
    var g = playGame(shipped({ modes: false }), 101, 3000);
    assert.strictEqual(g.cpu.modeCounts.BUILD + g.cpu.modeCounts.ATTACK + g.cpu.modeCounts.FORCED, 0);
    assert.strictEqual(g.cpu.brokenPlans, 0);
});

test('the goal reaches the filter', function () {
    // A goal says what to refuse as well as what to build, so two goals must
    // reach modes.js and produce different pools. Asserted on the POOL, not
    // on a game: whether two bots diverge within N frames of one seed is a
    // proxy, and a proxy that happens to coincide reports a wiring failure
    // that is not there.
    function poolAt(goal) {
        var stack = new PanelEngine.Stack({ level: LEVEL, seed: 1, countdown: false });
        var cpu = new PuyoCpu(stack, shipped({ depth: 1, modes: true, goal: goal }));
        var hold = { kind: 'hold', score: 0, travel: 0, resolved: res({}), risen: null };
        var five = { kind: 'swap', score: 0, travel: 0,
                     resolved: res({ chainLength: 1, comboSizes: [5] }), risen: null };
        var pool = cpu._applyModes([hold, five]);
        return { bar: cpu._bar(), mode: cpu._mode, holdKept: pool.indexOf(hold) >= 0 };
    }
    var small = poolAt('4-combo'), big = poolAt('7-combo');
    assert.strictEqual(small.bar.wide, 4, 'the 4-combo goal did not reach the bar');
    assert.strictEqual(big.bar.wide, 7, 'the 7-combo goal did not reach the bar');
    // A five is at or over the small goal and under the big one, so one
    // cashes in and the other keeps building.
    assert.strictEqual(small.mode, 'ATTACK', 'a 5-wide did not reach the 4-combo goal');
    assert.strictEqual(big.mode, 'BUILD', 'a 5-wide already satisfied the 7-combo goal');
    assert.strictEqual(small.holdKept, false, 'ATTACK kept hold on the list');
    assert.strictEqual(big.holdKept, true, 'BUILD took hold off the list');
});

test('a chain goal and a combo goal are different bots', function () {
    // At depth 2 with a climb, where the difference actually lives: a chain
    // goal walks toward cascade depth and a combo goal toward clear width,
    // and they are different boards. At depth 1 with no climb the two differ
    // only by the also-take bar, which is too little to prove anything.
    var d2 = { depth: 2, beam: 6, modes: true, stopFloor: 0, buildToward: 20 };
    var chain = playGame(shipped(Object.assign({ goal: '5-chain' }, d2)), 101, 2500);
    var combo = playGame(shipped(Object.assign({ goal: '5-combo' }, d2)), 101, 2500);
    assert.notDeepStrictEqual(chain.moves, combo.moves,
        'both goals climbed the same thing');
});
test('a candidate is judged on what the RISE leaves, not on the instant it popped', function () {
    // THE BUG THIS EXISTS FOR. _score already rises every candidate and
    // merges the second resolve, and then returned only a number — so the
    // resolve the filter read was the PRE-rise one and could not see a three
    // the rise was about to make. Measured on the engine's own events.
    var seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], before = 0, after = 0;
    seeds.forEach(function (seed) {
        before += playGame(shipped({ modes: true, stopFloor: 0, riseAware: false }), seed, 9000).payless;
        after  += playGame(shipped({ modes: true, stopFloor: 0 }), seed, 9000).payless;
    });
    assert.ok(after < before,
        'bare 3s ' + after + ' rise-aware vs ' + before + ' blind — the filter still cannot see the rise');
});

test('buildToward reaches the evaluator and changes how it plays', function () {
    // The claim is that the bot WALKS TOWARD the target rather than waiting
    // for it, so the test is that its play changes.
    var d2 = { depth: 2, beam: 6 };
    var off = playGame(shipped(Object.assign({ modes: true, stopFloor: 0, goal: '5-chain',
                                               buildToward: 0 }, d2)), 101, 2500);
    var on  = playGame(shipped(Object.assign({ modes: true, stopFloor: 0, goal: '5-chain',
                                               buildToward: 20 }, d2)), 101, 2500);
    assert.notDeepStrictEqual(on.moves, off.moves, 'buildToward changed nothing');
});

test('buildToward 0 turns the climb off completely', function () {
    // The default is 20, from measurement — see PuyoCpu's constructor.
    var d2 = { depth: 2, beam: 6 };
    var on   = playGame(shipped(Object.assign({ modes: true, stopFloor: 0, goal: '5-chain' }, d2)), 101, 2500);
    var zero = playGame(shipped(Object.assign({ modes: true, stopFloor: 0, goal: '5-chain',
                                                buildToward: 0 }, d2)), 101, 2500);
    assert.notDeepStrictEqual(zero.moves, on.moves, '0 played the same game as the default 20');
});
test('buildToward does nothing to a bot with modes off', function () {
    // No modes means no target, so there is nothing to build toward, and
    // every number this repo already has must be untouched.
    var a = playGame(shipped({}), 101, 3000);
    var b = playGame(shipped({ buildToward: 20 }), 101, 3000);
    assert.deepStrictEqual(b.moves, a.moves);
});

test('the bot does not mutate the weight set it was handed', function () {
    // It adds the target's potential to its OWN copy. A trainer scoring many
    // genomes from one object would otherwise accumulate the term every time
    // it built a bot, and the weights would drift without anything saying so.
    var w = { links: 25, maxHeight: 30 };
    var before = JSON.stringify(w);
    new PuyoCpu(new PanelEngine.Stack({ level: LEVEL, seed: 1, countdown: false }),
                { weights: w, modes: true, depth: 2, goal: '5-chain', buildToward: 20 });
    assert.strictEqual(JSON.stringify(w), before, 'the caller\'s weights were modified');
});

test('the climb needs a lookahead, and says so rather than doing nothing', function () {
    // PROVED SEPARATELY: over 2,151 candidate boards, the deepest chain among
    // _value's own children equalled chainPotential's answer 2,151 times out
    // of 2,151. So at depth 2 the climb is free.
    //
    // At depth 1 there is no second ply to read. Synthesising one as a
    // feature measured 166ms a decision against an 85ms budget, and could
    // not be switched off for FORCED. A knob that is set and quietly does
    // nothing is worse than one that refuses.
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 1, countdown: false });
    assert.throws(function () {
        new PuyoCpu(stack, shipped({ depth: 1, modes: true, goal: '5-chain', buildToward: 20 }));
    }, /lookahead/);

    // Depth 2 builds fine, and the climb is nowhere near the weights.
    var deep = new PuyoCpu(stack, shipped({ depth: 2, modes: true, goal: '5-chain', buildToward: 20 }));
    assert.ok(!deep.weights.chainPotential, 'depth 2 weighted chainPotential — paying twice');
    assert.ok(!deep.weights.comboPotential, 'depth 2 weighted comboPotential');

    // Depth 1 with no climb is fine: that is the bot every old number describes.
    assert.doesNotThrow(function () {
        new PuyoCpu(stack, shipped({ depth: 1, modes: true, goal: '5-chain', buildToward: 0 }));
    });
});
test('the climb changes play at depth 2, where it is free', function () {
    var off = playGame(shipped({ depth: 2, beam: 6, modes: true, stopFloor: 0, goal: '5-chain',
                                  buildToward: 0 }), 101, 2500);
    var on  = playGame(shipped({ depth: 2, beam: 6, modes: true, stopFloor: 0, goal: '5-chain',
                                  buildToward: 20 }), 101, 2500);
    assert.notDeepStrictEqual(on.moves, off.moves, 'the free climb changed nothing');
});

test('THE AIM IS READ OFF THE WEIGHTS, not set by hand', function () {
    assert.deepStrictEqual(modes.aim({ reach5chain: 120, reach3chain: 36,
                                       reach6combo: 50, reach4combo: 10 }),
                           { links: 5, wide: 6 });
    assert.deepStrictEqual(modes.aim({}), { links: 2, wide: 4 },
                           'wanting nothing yet aims at the floor the engine pays for');
    assert.deepStrictEqual(modes.aim({ reach8chain: -5, reach9combo: 0 }), { links: 2, wide: 4 });
});

function poolFor(weights, cands) {
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 1, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: weights, depth: 1, beam: 0, rise: true, modes: true });
    return { pool: cpu._applyModes(cands), cpu: cpu };
}
function cand(kind, resolved) {
    return { kind: kind, score: 0, travel: 0, resolved: resolved, risen: null };
}

test('BELOW THE AIM IT KEEPS BUILDING: a 2-chain does not open ATTACK at aim 5', function () {
    // The rule this exists for: the bar used to be the floor, so any payout
    // opened the attack and the only attacks available were scraps. The bot
    // sold the smallest chain that existed, every time one existed.
    var w = { reach5chain: 120 };
    var hold = cand('hold', res({}));
    var twoChain = cand('swap', res({ chainLength: 2, comboSizes: [3] }));

    var r = poolFor(w, [hold, twoChain]);
    assert.strictEqual(r.cpu._mode, 'BUILD', 'a 2-chain is below an aim of 5');
    assert.ok(r.pool.indexOf(hold) >= 0, 'it must still be allowed to wait');
    assert.ok(r.pool.indexOf(twoChain) >= 0,
        'and the 2-chain stays on the list — under the aim is the weights\' call, ' +
        'not the pool\'s. Refusing it here is what suffocated the bot: at an aim ' +
        'of 9-wide it held 159 of 163 decisions.');
});

test('AT THE AIM IT ATTACKS, and the weights pick which attack', function () {
    var w = { reach5chain: 120, reach6combo: 50 };
    var hold = cand('hold', res({}));
    var fiveChain = cand('swap', res({ chainLength: 5, comboSizes: [3, 3, 3, 3, 3] }));
    var sixWide = cand('swap', res({ chainLength: 1, comboSizes: [6] }));
    var bareThree = cand('swap', res({ chainLength: 1, comboSizes: [3] }));

    var r = poolFor(w, [hold, fiveChain, sixWide, bareThree]);
    assert.strictEqual(r.cpu._mode, 'ATTACK');
    assert.strictEqual(r.pool.indexOf(hold), -1, 'the aim is on the board — this is the moment');
    assert.ok(r.pool.indexOf(fiveChain) >= 0, 'the chain it aimed at');
    assert.ok(r.pool.indexOf(sixWide) >= 0, 'AND the combo, so the weights choose between them');
    assert.strictEqual(r.pool.indexOf(bareThree), -1);
});

test('the worthless clear is refused while building', function () {
    var hold = cand('hold', res({}));
    var bareThree = cand('swap', res({ chainLength: 1, comboSizes: [3] }));
    var r = poolFor({ reach5chain: 120 }, [hold, bareThree]);
    assert.strictEqual(r.cpu._mode, 'BUILD');
    assert.ok(r.pool.indexOf(hold) >= 0);
    assert.strictEqual(r.pool.indexOf(bareThree), -1);
});

test('FORCED lifts the filter at both plies and the climb with it', function () {
    // The invariant, asserted directly rather than through a game: FORCED
    // means play like the bot with no modes at all. It was not true twice —
    // ply 1 took every move while ply 2 still valued them through the
    // filter, and later the climb kept pulling while FORCED was open.
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 1, countdown: false });
    var cpu = new PuyoCpu(stack, shipped({ depth: 2, modes: true, goal: '5-chain', buildToward: 20 }));

    cpu._mode = 'BUILD';
    assert.strictEqual(cpu._filtering(), true, 'BUILD must filter');
    cpu._mode = 'ATTACK';
    assert.strictEqual(cpu._filtering(), true, 'ATTACK must filter');
    cpu._mode = 'FORCED';
    assert.strictEqual(cpu._filtering(), false, 'FORCED must not filter, at either ply');
});

test('modes off is still swap-for-swap the old bot', function () {
    [101, 102].forEach(function (seed) {
        var a = playGame(shipped({}), seed, 3000);
        var b = playGame(shipped({ modes: false }), seed, 3000);
        assert.deepStrictEqual(b.moves, a.moves, 'seed ' + seed);
    });
});

test('the danger zone narrows to what survives — it does not pick for you', function () {
    // FORCED must not lock the bot into one move. It removes everything that
    // buys no time and hands the rest to the evaluator: the same contract
    // every other mode has. How much the clock is worth against everything
    // else is then LEARNED, through stopTimeEarned and the danger weight
    // set, rather than being a rule written here.
    var cands = [
        { kind: 'swap', score: 900, resolved: { chainLength: 0, comboSizes: [], stopTimeEarned: 0 } },
        { kind: 'swap', score: 100, resolved: { chainLength: 2, comboSizes: [3, 3], stopTimeEarned: 64 } },
        { kind: 'swap', score: 500, resolved: { chainLength: 1, comboSizes: [5], stopTimeEarned: 32 } }
    ];
    var pool = modes.survivable(cands);
    assert.strictEqual(pool.length, 2, 'the move that buys no time is still on the table');
    assert.strictEqual(pool.indexOf(cands[0]), -1);
});

test('the survivors keep candidate order, so ties break as they always do', function () {
    var cands = [
        { kind: 'swap', score: 100, resolved: { comboSizes: [4], stopTimeEarned: 32 } },
        { kind: 'swap', score: 800, resolved: { comboSizes: [6], stopTimeEarned: 34 } }
    ];
    assert.deepStrictEqual(modes.survivable(cands), cands);
});

test('nothing survives means no filter, not no move', function () {
    // The bot still has to play something, and nothing here saves it anyway.
    var cands = [
        { kind: 'hold', score: 900, resolved: { comboSizes: [], stopTimeEarned: 0 } },
        { kind: 'swap', score: 100, resolved: { comboSizes: [3], stopTimeEarned: 0 } }
    ];
    assert.deepStrictEqual(modes.survivable(cands), cands);
});

test('the danger weight set is used only in danger', function () {
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 1, countdown: false });
    var build = { links: 10 }, danger = { stopTimeEarned: 99 };
    var cpu = new PuyoCpu(stack, shipped({ depth: 2, modes: true,
                                            weights: build, dangerWeights: danger }));
    cpu._mode = 'BUILD';
    assert.deepStrictEqual(cpu._weightsNow(), cpu.weights);
    cpu._mode = 'FORCED';
    assert.deepStrictEqual(cpu._weightsNow(), cpu.dangerWeights);
});

test('no danger set means the ordinary weights, so off is free', function () {
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 1, countdown: false });
    var cpu = new PuyoCpu(stack, shipped({ depth: 2, modes: true }));
    cpu._mode = 'FORCED';
    assert.deepStrictEqual(cpu._weightsNow(), cpu.weights);
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
