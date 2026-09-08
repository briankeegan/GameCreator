// THE BENCHMARK THIS EVALUATOR CAN ACTUALLY BE MEASURED ON.
//
// Not a new harness for its own sake — a necessary one, and here is the
// evidence, because "the established tool" was tried first and does not
// work for this.
//
// ../experiments/ga_core.js drives the real engine against the L10
// bigBlocks drill and is what every existing GA round trained against. It
// cannot measure this evaluator at all. SearchCpu._evaluate — the seam
// attach.js replaces — is only reached on the OFFENSIVE search path; at
// maxHealth <= 21 the cpu routes through TrueSurvivalSearch and the
// defensive tiers instead. Counted directly over 1500 frames of steady
// pressure:
//
//     level 3  (maxHealth 81)  ->  7519 calls to _evaluate
//     level 5  (maxHealth 51)  ->     0
//     level 8  (maxHealth 21)  ->     0
//     level 10 (maxHealth  1)  ->    15
//
// And even at level 3 the L10 drill's 6x12 blocks keep the cpu permanently
// in danger mode, so the calls that do happen change nothing. Proved rather
// than assumed, by replacing _evaluate outright and running the drill:
//
//     shipped      [616, 1024, 1710]
//     constant 0   [616, 1024, 1710]
//     random       [616, 1024, 1710]
//     INVERTED     [616, 1024, 1710]
//
// Identical to the frame. An A/B on that drill returns a perfect tie for
// any weights whatsoever, which looks exactly like "the new evaluator makes
// no difference" and is really "this benchmark does not run it" — the
// oldest failure shape in this repo, a check satisfied by something other
// than the thing it checks.
//
// The same experiment on the scenario below separates them immediately:
//
//     shipped      [3000, 3000, 2966]
//     constant 0   [2403, 3000, 1231]
//     INVERTED     [2403, 3000, 1293]
//
// THE SCENARIO. Level 3, one 6x3 garbage block every 120 frames after a
// 120-frame lead-in, run until the board tops out or the ceiling. Chosen by
// calibration, not by taste: the pressure has to be high enough that the
// shipped cpu dies before the ceiling (otherwise every genome scores
// "survived everything" and the GA is searching noise) and low enough that
// the offensive search actually runs. Measured over six seeds:
//
//     every 120 h3  [2546,2502,1551,791,864,2231]  no ceiling hits  <- this
//     every  90 h3  [1658, 917, 641,643,969, 717]  floor-ish, little spread
//     every 120 h4  [ 748,1931,1850,836,847,1808]
//     every  90 h4  [1896, 687,2583,1040,723,1506]
//
// WHAT THIS DOES NOT COVER, said plainly: survival at the tightened levels
// is TrueSurvivalSearch's own scoring, which this evaluator does not touch
// and this benchmark does not exercise. Weights learned here govern the
// offensive search and nothing else.
var path = require('path');
var GAME = path.join(__dirname, '..', '..');
require(path.join(GAME, 'panel-engine.js'));
require(path.join(GAME, 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PanelCpu = globalThis.PanelCpu;
var attach = require('./attach.js').attach;

// TWO SCENARIOS, BECAUSE ONE CANNOT MEASURE EVERYTHING.
//
// `build` is the original: level 3, moderate pressure, the offensive search
// running most of the time. It is where the density features live and it is
// calibrated so the shipped cpu dies well before the ceiling.
//
// It also cannot exercise five features, and wiring.test.js says so by
// name: framesToDeath saturates because the board rarely tops out,
// colourScarcity because level 3 never starves a colour, garbageOnBoard and
// incomingGarbage because the queue is never deep, latentChain because
// every scored position has settled. Those are statements about THIS
// SCENARIO, not about the features — so `siege` exists to make four of the
// five vary: heavier, faster garbage at a tighter level, where the board is
// genuinely topping out and the clock is the thing that decides.
//
// Trained weights should be reported on BOTH. A weight set that wins the
// build drill by playing recklessly under pressure is not better, it is
// specialised, and one number cannot tell those apart.
var SCENARIOS = {
    build: {
        level: 3,
        garbageEvery: 120,
        garbageWidth: 6,
        garbageHeight: 3,
        leadIn: 120,
        ceiling: 4000
    },
    siege: {
        // Level 5 tightens maxHealth from 81 to 51 and dangerHeightFrac
        // with it, and the garbage arrives twice as often and twice as
        // tall. The point is a board that spends real time topped out,
        // where framesToDeath is not a constant and the garbage features
        // vary between candidates.
        level: 5,
        garbageEvery: 60,
        garbageWidth: 6,
        garbageHeight: 6,
        leadIn: 120,
        ceiling: 4000
    }
};

var LEVEL = SCENARIOS.build.level;
var GARBAGE_EVERY = SCENARIOS.build.garbageEvery;
var GARBAGE_HEIGHT = SCENARIOS.build.garbageHeight;
var LEAD_IN = SCENARIOS.build.leadIn;
var CEILING = SCENARIOS.build.ceiling;

// A genome that makes any single decision take longer than this is not a
// real result — the game gives the cpu one frame. Same guard, and the same
// number, as ga_core.js's TIMING_MARGIN_MS.
//
// 85, not 50. Set to 50 first, and the SHIPPED scoring failed it on two
// seeds out of three (54ms and 55ms) — which would have scored the control
// arm at zero and made every genome look like an improvement. A safety
// threshold the unmodified game cannot pass is not measuring safety, it is
// measuring the machine it happens to be running on.
var TIMING_MARGIN_MS = 85;

exports.SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
exports.LEVEL = LEVEL;
exports.CEILING = CEILING;
exports.SCENARIOS = SCENARIOS;

// One run. `weights` null means the SHIPPED scoring, untouched — that is
// the control arm, and it must go through this identical code path or the
// comparison is between two different benchmarks.
// THE TIMING GUARD IS NOT VALID UNDER PARALLEL LOAD.
//
// It measures wall-clock inside _choose, which is the right question when
// one process has a core to itself and a meaningless one when four workers
// share four cores with everything else on the machine. Left on during
// training it rejected the SHIPPED baseline as unsafe — fitness 0 for a
// genome that scores 1671 when run alone — so the search was being told
// the thing it must beat is worthless.
//
// So training passes checkTiming:false and the winner is re-checked
// single-threaded afterwards, where the number means something. Turning the
// guard off for a measurement it cannot make is honest; leaving it on and
// believing the result is not.
exports.run = function (weights, seed, opts) {
    opts = opts || {};
    var checkTiming = opts.checkTiming !== false;
    var sc = SCENARIOS[opts.scenario || 'build'];
    if (!sc) throw new Error('unknown scenario "' + opts.scenario + '" — expected ' +
                             Object.keys(SCENARIOS).join(' or '));
    var stack = new PanelEngine.Stack({ level: sc.level, seed: seed, countdown: false });
    var cpu = new PanelCpu.SearchCpu(stack, {
        difficulty: 'nightmare', seed: seed + 55, mistake: 0, chainExtend: true
    });

    var detach = null;
    if (weights) {
        try { detach = attach(PanelCpu.SearchCpu, weights, opts); }
        catch (e) { return { frames: 0, sent: 0, unsafe: false, error: e.message }; }
    }

    var origChoose = PanelCpu.SearchCpu.prototype._choose;
    var localMax = 0;
    PanelCpu.SearchCpu.prototype._choose = function (board) {
        var t0 = Date.now();
        var r = origChoose.call(this, board);
        var dt = Date.now() - t0;
        if (dt > localMax) localMax = dt;
        return r;
    };

    var f, sent = 0;
    try {
        for (f = 0; f < sc.ceiling; f++) {
            if (f > sc.leadIn && f % sc.garbageEvery === 0) {
                stack.receiveGarbage([{ width: sc.garbageWidth, height: sc.garbageHeight,
                                        isChain: false }]);
            }
            cpu.update();
            stack.run();
            var out = stack.takeDeliverableGarbage();
            if (out && out.length) {
                for (var i = 0; i < out.length; i++) sent += out[i].width * out[i].height;
            }
            stack.drainEvents();
            if (stack.gameOver) break;
            if (checkTiming && localMax > TIMING_MARGIN_MS) break;
        }
    } finally {
        PanelCpu.SearchCpu.prototype._choose = origChoose;
        if (detach) detach();
    }
    return { frames: f, sent: sent, score: stack.score || 0, died: !!stack.gameOver,
             localMax: localMax, unsafe: checkTiming && localMax > TIMING_MARGIN_MS };
};

// TWO OBJECTIVES, AND CHOOSING BETWEEN THEM IS THE REAL DECISION.
//
// PUYO_REFERENCE.md calls this one of only two things that are ours to
// decide, and the one that "silently defines everything the bot becomes":
//
//   "train against survival time and you get a bot that clears constantly
//    and never builds; train against damage dealt and you get one that
//    hoards. Same features, same search, completely different opponent."
//
// meatfighter trained against FINAL SCORE, and this engine has one —
// panel-engine.js ports Panel Attack's real Tsu-Attack tables, where a
// 5-chain pays 300 and a 10-chain pays 1100 while a 4-combo pays 20. That
// is a number that rewards BUILDING, because the only way to reach it is to
// let potential accumulate rather than clearing every three that appears.
//
//   'survival' — frames survived, garbage sent as a small tie-break. What
//               the first run used, and it produced a genome weighted
//               almost entirely on tidiness with chainLength=3: the bot
//               that reference paragraph describes.
//   'score'    — the engine's own score. What the reference used.
//
// NO DEATH PENALTY, and that is a considered choice rather than an
// omission. Score already prices dying, because it is a LIFETIME total:
// the game ends when the board tops out, so a genome that kills itself
// early simply stops earning. Survival is the duration over which points
// accrue, not a second term to be weighted against them — which is what
// makes score and aggression trade off automatically. Clear every three
// that appears and you live long earning 20 a time; hoard for a 10-chain
// and you risk topping out for 1100. Both are denominated in the same
// currency, so the search finds its own balance.
//
// In Puyo the don't-die instinct lives in the FEATURES instead: a spawn
// distance penalty at 8% of the score, which keeps the stack low. That is
// the slot maxHeight occupies here, with a weight the search picks. Nobody
// tells the bot that dying is bad; it works out how much height costs.
//
// deathRate is still REPORTED, because it is how a suicide-chainer would
// be spotted — score climbing while the board tops out on every seed.
//
// Score does not need survival bolted onto it: the game ends when the board
// tops out, so a genome that dies early cannot accumulate one. That is the
// property that makes it a better single objective than a hand-mixed sum,
// where the mixing ratio is one more number nobody measured.
//
// An unsafe genome scores 0 under either. A config that cannot decide
// inside a frame is not a faster player, it is a broken one.
exports.fitness = function (weights, seeds, opts) {
    seeds = seeds || exports.SEEDS;
    opts = opts || {};
    var objective = opts.objective || 'survival';
    var frames = 0, sent = 0, score = 0, deaths = 0, i, r;
    for (i = 0; i < seeds.length; i++) {
        r = exports.run(weights, seeds[i], opts);
        if (r.error) return { fitness: 0, error: r.error };
        if (r.unsafe) return { fitness: 0, unsafe: true };
        frames += r.frames;
        sent += r.sent;
        score += r.score;
        if (r.died) deaths++;
    }
    var n = seeds.length;
    var fitness;
    var fitnessByObjective = {
        score: score / n,
        survival: frames / n + (sent / n) * 0.5
    };
    if (!(objective in fitnessByObjective)) {
        throw new Error('unknown objective "' + objective + '" — expected ' +
                        Object.keys(fitnessByObjective).join(' or '));
    }
    fitness = fitnessByObjective[objective];
    // Every number is reported whichever one is being optimised, so a run
    // can always be read for the failure the objective invites: survival
    // rising while sent falls, or score rising while frames collapse.
    return {
        fitness: fitness,
        objective: objective,
        avgFrames: frames / n,
        avgSent: sent / n,
        avgScore: score / n,
        deathRate: deaths / n
    };
};
