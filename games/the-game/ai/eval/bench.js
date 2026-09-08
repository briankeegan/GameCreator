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

var LEVEL = 3;
var GARBAGE_EVERY = 120;
var GARBAGE_HEIGHT = 3;
var LEAD_IN = 120;
var CEILING = 4000;

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

// One run. `weights` null means the SHIPPED scoring, untouched — that is
// the control arm, and it must go through this identical code path or the
// comparison is between two different benchmarks.
exports.run = function (weights, seed, opts) {
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: seed, countdown: false });
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
        for (f = 0; f < CEILING; f++) {
            if (f > LEAD_IN && f % GARBAGE_EVERY === 0) {
                stack.receiveGarbage([{ width: 6, height: GARBAGE_HEIGHT, isChain: false }]);
            }
            cpu.update();
            stack.run();
            var out = stack.takeDeliverableGarbage();
            if (out && out.length) {
                for (var i = 0; i < out.length; i++) sent += out[i].width * out[i].height;
            }
            stack.drainEvents();
            if (stack.gameOver) break;
            if (localMax > TIMING_MARGIN_MS) break;
        }
    } finally {
        PanelCpu.SearchCpu.prototype._choose = origChoose;
        if (detach) detach();
    }
    return { frames: f, sent: sent, localMax: localMax, unsafe: localMax > TIMING_MARGIN_MS };
};

// FITNESS IS FRAMES SURVIVED, WITH GARBAGE SENT AS A TIE-BREAK ONLY.
//
// Survival is the thing the benchmark applies pressure to, and it is what
// the shipped scoring is already good at, so it is the honest comparison.
// Sent is folded in at a deliberately small factor: two genomes that
// survive equally are not equally good, and without a tie-break the GA has
// no gradient at all between them — but weight it heavily and it learns to
// attack while drowning, which is the failure the survival benchmark exists
// to avoid.
//
// An unsafe genome scores 0 outright. A config that cannot decide inside a
// frame is not a faster player, it is a broken one.
exports.fitness = function (weights, seeds, opts) {
    seeds = seeds || exports.SEEDS;
    var frames = 0, sent = 0, i, r;
    for (i = 0; i < seeds.length; i++) {
        r = exports.run(weights, seeds[i], opts);
        if (r.error) return { fitness: 0, error: r.error };
        if (r.unsafe) return { fitness: 0, unsafe: true };
        frames += r.frames;
        sent += r.sent;
    }
    return {
        fitness: frames / seeds.length + (sent / seeds.length) * 0.5,
        avgFrames: frames / seeds.length,
        avgSent: sent / seeds.length
    };
};
