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
    w.links = 25; w.colourVariance = 2; w.edgePenalty = 8;
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
    // Breaking garbage keeps a move in BUILD's pool. It is not a reason to
    // stop building and cash in, which is what FIRE means.
    assert.strictEqual(modes.fires(res({ chainLength: 1, comboSizes: [3], brokeGarbage: 4 }), T, S), false);
    assert.strictEqual(modes.pays(res({ chainLength: 1, comboSizes: [3], brokeGarbage: 4 }), T, S), true);
});

// --------------------------------------------- 3b. target, and the bar it sets

test('either: both arms at their base bars', function () {
    var bars = modes.bars('either', 4, 4, 6, 5);
    assert.deepStrictEqual(bars, { links: 4, wide: 4 });
});

test('chain: the combo bar rises, it does NOT switch off', function () {
    // MEASURED, 24 games each, T=4: S=6 gives 0.7 deep chains a minute and
    // 728 points a minute; S=8 and S=99 give ZERO deep chains, a third of
    // the garbage and a 30% shorter game. Refusing to cash a combo at all
    // starves the bot of the pressure and the stop time it needs to build
    // anything. So a target raises the other weapon's bar and never closes
    // it, and a bar of Infinity is not reachable through this function.
    var bars = modes.bars('chain', 4, 4, 6, 5);
    assert.strictEqual(bars.links, 4, 'the target arm keeps its own bar');
    assert.strictEqual(bars.wide, 6, 'the off-target arm is raised to the off-target bar');
});

test('combo: the mirror image', function () {
    var bars = modes.bars('combo', 4, 4, 6, 5);
    assert.strictEqual(bars.wide, 4);
    assert.strictEqual(bars.links, 5);
});

test('an off-target bar below the base bar cannot LOWER it', function () {
    // A target must never make the bot sell cheaper than `either` would.
    var bars = modes.bars('chain', 4, 4, 2, 5);
    assert.strictEqual(bars.wide, 4, 'off-target 2 must not undercut the base bar of 4');
});

test('an unknown target is refused rather than silently meaning either', function () {
    assert.throws(function () { modes.bars('chian', 4, 4, 6, 5); }, /chian/);
});

// ------------------------------------------- 3d. building TOWARD the target

test('the target picks which potential the bot climbs', function () {
    // The floor says what not to sell. This says what to walk toward.
    // chainPotential and comboPotential are the resolve asked one move
    // further out — the deepest cascade, and the biggest single clear, any
    // one swap could make from the board a move LEAVES. Without one of them
    // weighted, the bot scores tidiness and a six-wide only ever turns up by
    // accident; the filter can refuse a cheap sale but cannot aim.
    assert.deepStrictEqual(modes.toward('chain', 120), { chainPotential: 120 });
    assert.deepStrictEqual(modes.toward('combo', 120), { comboPotential: 120 });
});

test('either climbs both, so no target is not no ambition', function () {
    assert.deepStrictEqual(modes.toward('either', 120),
        { chainPotential: 120, comboPotential: 120 });
});

test('strength 0 adds nothing at all', function () {
    // Load-bearing: evaluate() skips a feature whose weight is 0, and
    // chainPotential costs 14.9ms of an 85ms budget. Off has to be free,
    // not merely neutral.
    assert.deepStrictEqual(modes.toward('chain', 0), {});
    assert.deepStrictEqual(modes.toward('either', 0), {});
});

test('a negative strength is refused', function () {
    assert.throws(function () { modes.toward('chain', -50); }, /negative/);
});

test('an unknown target is refused here too', function () {
    assert.throws(function () { modes.toward('combos', 120); }, /combos/);
});

test('the climb is priced exactly as the feature prices it', function () {
    // Same weight, same number. The registry divides by a norm so a weight
    // means the same thing for every feature — chainPotential 16,
    // comboPotential 36 — and the reused-from-the-search version has to use
    // those same divisors or `buildToward: 120` means two different
    // strengths at two different depths.
    assert.strictEqual(modes.climb('chain', 120, { links: 8, wide: 0 }), 120 * 8 / 16);
    assert.strictEqual(modes.climb('combo', 120, { links: 0, wide: 9 }), 120 * 9 / 36);
});

test('either climbs whichever is further along', function () {
    // Not the sum: one good chain and one good combo on the same board is
    // not twice as good a board, and adding them would make `either` pull
    // twice as hard as a target for no stated reason.
    assert.strictEqual(modes.climb('either', 120, { links: 8, wide: 0 }), 120 * 8 / 16);
    assert.strictEqual(modes.climb('either', 120, { links: 0, wide: 9 }), 120 * 9 / 36);
    assert.strictEqual(modes.climb('either', 120, { links: 8, wide: 9 }),
        Math.max(120 * 8 / 16, 120 * 9 / 36));
});

test('no strength, no climb, and nothing to climb is no climb', function () {
    assert.strictEqual(modes.climb('chain', 0, { links: 8, wide: 0 }), 0);
    assert.strictEqual(modes.climb('chain', 120, { links: 0, wide: 0 }), 0);
});

// ----------------------------------------------------------------- 4. FORCED

test('FORCED opens when the runway is gone', function () {
    assert.strictEqual(modes.forced({ runway: 1, margin: 2, broke: false }), true);
});

test('FORCED opens when the plan broke', function () {
    assert.strictEqual(modes.forced({ runway: 99, margin: 2, broke: true }), true);
});

test('a deep stack alone does NOT open FORCED', function () {
    // The whole point: room left is room left. Height is not the trigger.
    assert.strictEqual(modes.forced({ runway: 3, margin: 2, broke: false }), false);
});

test('the margin is read, not assumed', function () {
    assert.strictEqual(modes.forced({ runway: 3, margin: 2, broke: false }), false);
    assert.strictEqual(modes.forced({ runway: 3, margin: 4, broke: false }), true);
});

test('runway is rows to the ceiling MINUS the garbage already in the air', function () {
    var open = modes.runway({ height: 12, top: 4 }, 0);
    var underAttack = modes.runway({ height: 12, top: 4 }, 3);
    assert.strictEqual(open, 8);
    assert.strictEqual(underAttack, 5,
        'three rows queued against this board have already spent three rows of runway');
});

test('runway never goes below zero', function () {
    assert.strictEqual(modes.runway({ height: 12, top: 11 }, 9), 0);
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
    assert.strictEqual(m.BUILD + m.FIRE + m.FORCED, g.cpu.decisions,
        'modes account for ' + (m.BUILD + m.FIRE + m.FORCED) + ' of ' + g.cpu.decisions + ' decisions');
    assert.ok(m.BUILD > 0, 'never once in BUILD — the mode does not engage');
});

test('FORCED is the exception, not the bot', function () {
    // The diagnostic that separates "the filter is wrong" from "the escape
    // hatch is too wide". A bot that is FORCED most of the time is today's
    // bot with machinery around it, and would score exactly like it.
    var worst = 0;
    [101, 102, 103].forEach(function (seed) {
        var g = playGame(shipped({ modes: true }), seed, 6000);
        var m = g.cpu.modeCounts, t = m.BUILD + m.FIRE + m.FORCED;
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
    assert.strictEqual(g.cpu.modeCounts.BUILD + g.cpu.modeCounts.FIRE + g.cpu.modeCounts.FORCED, 0);
    assert.strictEqual(g.cpu.brokenPlans, 0);
});

test('the fire thresholds reach the filter', function () {
    // 99 links and 99 wide can never be met, so FIRE never opens and BUILD
    // keeps only non-clearing moves and garbage breaks. Playing the same game
    // as 4 and 4 would mean the options stop somewhere short of modes.js.
    var low = playGame(shipped({ modes: true, fireLinks: 4, fireWide: 4 }), 101, 4000);
    var high = playGame(shipped({ modes: true, fireLinks: 99, fireWide: 99 }), 101, 4000);
    assert.notDeepStrictEqual(low.moves, high.moves, 'the fire thresholds are not reaching the filter');
});

test('the forced margin reaches the filter', function () {
    // A margin as tall as the board makes every decision about-to-die, which
    // is today's bot. If that plays the same game as margin 2, the option is
    // not arriving.
    var tight = playGame(shipped({ modes: true, forcedMargin: 2 }), 101, 4000);
    var always = playGame(shipped({ modes: true, forcedMargin: 99 }), 101, 4000);
    var off = playGame(shipped({}), 101, 4000);
    assert.notDeepStrictEqual(always.moves, tight.moves, 'the forced margin is not reaching the filter');
    assert.deepStrictEqual(always.moves, off.moves,
        'margin 99 means FORCED every decision, which must be exactly the unfiltered bot');
});

test('the ply-2 filter bites, and FORCED lifts it at both plies', function () {
    // _value's own invariant: a move the bot cannot make at ply 1 must not be
    // what ply 2 values a candidate for, or the imagined future is a different
    // game from the real one. Only depth 2 can make this claim, so it is the
    // one test here that pays for depth 2.
    var d2 = { depth: 2, beam: 6 };
    var off = playGame(shipped(d2), 101, 2500);
    var on = playGame(shipped(Object.assign({ modes: true }, d2)), 101, 2500);
    assert.notDeepStrictEqual(on.moves, off.moves, 'modes changed nothing at depth 2');

    // FORCED every decision must be EXACTLY the unfiltered bot. It was not:
    // ply 1 took every move and ply 2 still valued them through the filter,
    // which is neither bot.
    var always = playGame(shipped(Object.assign({ modes: true, forcedMargin: 99 }, d2)), 101, 2500);
    assert.deepStrictEqual(always.moves, off.moves,
        'FORCED is not lifting the filter at ply 2');
});

test('a candidate is judged on what the RISE leaves, not on the instant it popped', function () {
    // THE BUG THIS EXISTS FOR. _score already rises every candidate and
    // merges the second resolve, and then returned only a number — so the
    // resolve the filter read was the PRE-rise one and could not see a three
    // the rise was about to make. Measured on the engine's own events.
    var seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], before = 0, after = 0;
    seeds.forEach(function (seed) {
        before += playGame(shipped({ modes: true, forcedMargin: -1, riseAware: false }), seed, 9000).payless;
        after  += playGame(shipped({ modes: true, forcedMargin: -1 }), seed, 9000).payless;
    });
    assert.ok(after < before,
        'bare 3s ' + after + ' rise-aware vs ' + before + ' blind — the filter still cannot see the rise');
});

test('every fire knob reaches the filter', function () {
    // An option the filter never reads changes nothing and looks exactly
    // like one that worked. But asking whether it changed the MOVES cannot
    // tell a dead wire from a knob that is correctly inert on one seed: a
    // 4+ link chain is rarely on offer, so a higher links bar often binds on
    // nothing, and the weights may already prefer the biggest clear, so the
    // relative bar can remove only moves that would have lost anyway.
    //
    // So this counts what the filter REMOVED. That is the knob's own claim,
    // and it is true or false regardless of what the weights then do.
    function removed(opts) {
        var stack = new PanelEngine.Stack({ level: LEVEL, seed: 101, countdown: false });
        var o = shipped(opts), cpu = new PuyoCpu(stack, o), cut = 0, seen = 0;
        var orig = cpu._applyModes.bind(cpu);
        cpu._applyModes = function (c) {
            var pool = orig(c);
            seen += c.length; cut += c.length - pool.length;
            return pool;
        };
        for (var f = 0; f < 4000; f++) {
            cpu.update(); stack.run(); stack.drainEvents();
            if (stack.gameOver) break;
        }
        return { cut: cut, seen: seen };
    }
    var base = removed({ modes: true, forcedMargin: -1 });
    assert.ok(base.seen > 500, 'only ' + base.seen + ' candidates seen — too few to call anything dead');

    var knobs = {
        fireLinks:   { fireLinks: 99 },
        fireWide:    { fireWide: 8 },
        fireTarget:  { fireTarget: 'chain' },
        fireWideOff: { fireTarget: 'chain', fireWideOff: 8 },
    };
    var dead = [];
    Object.keys(knobs).forEach(function (k) {
        var o = { modes: true, forcedMargin: -1 };
        for (var kk in knobs[k]) o[kk] = knobs[k][kk];
        // fireWideOff is measured against the target it modifies, not
        // against `either`, where it is correctly inert.
        var ref = (k === 'fireWideOff') ? removed({ modes: true, forcedMargin: -1, fireTarget: 'chain' }) : base;
        if (removed(o).cut === ref.cut) dead.push(k);
    });
    assert.deepStrictEqual(dead, [], 'these knobs removed exactly as many candidates as the baseline: ' +
        dead.join(', '));
});

test('target combo is not target chain', function () {
    var chain = playGame(shipped({ modes: true, forcedMargin: -1, fireTarget: 'chain' }), 101, 4000);
    var combo = playGame(shipped({ modes: true, forcedMargin: -1, fireTarget: 'combo' }), 101, 4000);
    assert.notDeepStrictEqual(chain.moves, combo.moves, 'both targets play the same game');
});

test('a bad target name stops the run rather than quietly meaning either', function () {
    assert.throws(function () {
        playGame(shipped({ modes: true, fireTarget: 'chains' }), 101, 500);
    }, /chains/);
});

test('buildToward reaches the evaluator and changes how it plays', function () {
    // The claim is that the bot WALKS TOWARD the target rather than waiting
    // for it, so the test is that its play changes.
    var off = playGame(shipped({ modes: true, forcedMargin: -1, fireWide: 6 }), 101, 4000);
    var on  = playGame(shipped({ modes: true, forcedMargin: -1, fireWide: 6,
                                 buildToward: 120 }), 101, 4000);
    assert.notDeepStrictEqual(on.moves, off.moves, 'buildToward changed nothing');
});

test('buildToward 0 is exactly the bot without it', function () {
    // Off has to be free: evaluate() skips a zero-weight feature, and
    // chainPotential is the most expensive one there is.
    var off  = playGame(shipped({ modes: true, forcedMargin: -1, fireWide: 6 }), 101, 4000);
    var zero = playGame(shipped({ modes: true, forcedMargin: -1, fireWide: 6,
                                   buildToward: 0 }), 101, 4000);
    assert.deepStrictEqual(zero.moves, off.moves);
});

test('the target decides WHICH potential is climbed', function () {
    var chain = playGame(shipped({ modes: true, forcedMargin: -1,
                                    fireTarget: 'chain', buildToward: 120 }), 101, 4000);
    var combo = playGame(shipped({ modes: true, forcedMargin: -1,
                                    fireTarget: 'combo', buildToward: 120 }), 101, 4000);
    assert.notDeepStrictEqual(chain.moves, combo.moves,
        'both targets climb the same thing');
});

test('buildToward does nothing to a bot with modes off', function () {
    // No modes means no target, so there is nothing to build toward, and
    // every number this repo already has must be untouched.
    var a = playGame(shipped({}), 101, 3000);
    var b = playGame(shipped({ buildToward: 200 }), 101, 3000);
    assert.deepStrictEqual(b.moves, a.moves);
});

test('the bot does not mutate the weight set it was handed', function () {
    // It adds the target's potential to its OWN copy. A trainer scoring many
    // genomes from one object would otherwise accumulate the term every time
    // it built a bot, and the weights would drift without anything saying so.
    var w = { links: 25, maxHeight: 30 };
    var before = JSON.stringify(w);
    new PuyoCpu(new PanelEngine.Stack({ level: LEVEL, seed: 1, countdown: false }),
                { weights: w, modes: true, buildToward: 120 });
    assert.strictEqual(JSON.stringify(w), before, 'the caller\'s weights were modified');
});

test('at depth 2 the climb is free — the search already resolved it', function () {
    // PROVED SEPARATELY: over 2,151 candidate boards, the deepest chain among
    // _value's own children equalled chainPotential's answer for that board
    // 2,151 times out of 2,151. So at depth 2 the feature re-runs ~900
    // resolves a decision to reach a number the search is already holding.
    //
    // This is the claim that it stopped doing that: with a lookahead, the
    // climb must not put chainPotential into the weights at all.
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 1, countdown: false });
    var deep = new PuyoCpu(stack, shipped({ depth: 2, modes: true, buildToward: 120 }));
    assert.ok(!deep.weights.chainPotential,
        'depth 2 still weighted chainPotential — it is paying twice for one number');
    assert.ok(!deep.weights.comboPotential,
        'depth 2 still weighted comboPotential');

    // At depth 1 there is no second ply, so there is nothing to reuse and
    // the feature is the only way to ask. That cost is real and expected.
    var flat = new PuyoCpu(stack, shipped({ depth: 1, modes: true, buildToward: 120 }));
    assert.ok(flat.weights.chainPotential > 0,
        'depth 1 has no lookahead to reuse, so it must pay for the feature');
});

test('the climb changes play at depth 2, where it is free', function () {
    var off = playGame(shipped({ depth: 2, beam: 6, modes: true, forcedMargin: -1, fireWide: 6 }), 101, 2500);
    var on  = playGame(shipped({ depth: 2, beam: 6, modes: true, forcedMargin: -1, fireWide: 6,
                                  buildToward: 120 }), 101, 2500);
    assert.notDeepStrictEqual(on.moves, off.moves, 'the free climb changed nothing');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
