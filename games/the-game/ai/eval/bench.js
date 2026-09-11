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
var PuyoCpu = require('./puyocpu.js');
var fs = require('fs');
var attackSchedule = require(path.join(__dirname, '..', 'experiments', 'attack_schedule.js'));

// THE REAL ATTACK FILES — the ones full_report.js's `endless` category
// plays, which is the benchmark anyone here actually reads. Resolved the
// same way full_report.js resolves them; if the panel-game checkout is not
// beside this one the endless scenario is simply unavailable and says so,
// rather than silently falling back to a synthetic drill and reporting a
// number that means something else.
// SEARCHED, NOT HARD-CODED. This was one absolute path into a sibling
// checkout — /home/user/briankeegan/panel-game/... — which exists only in
// the sandbox it was written in. The comment above claimed the scenario
// would be "simply unavailable and say so" if that checkout were missing;
// it did not. readdirSync threw ENOENT and killed the process, which is how
// the first GitHub Actions run of the trainer died: eight tests failed with
// a stack trace naming a directory that could never exist on a runner, and
// nothing in the message said "check out panel-game".
//
// Order matters: an explicit GC_TRAINING_DIR wins, then a checkout beside
// this repo, then a checkout INSIDE it (which is what CI does, since
// actions/checkout cannot write above the workspace), then the original
// absolute path so existing sandboxes keep working.
var REPO = path.join(__dirname, '..', '..', '..', '..');
var TRAINING_SUFFIX = path.join('client', 'assets', 'default_data', 'training');
var TRAINING_CANDIDATES = [
    process.env.GC_TRAINING_DIR,
    path.join(REPO, '..', 'panel-game', TRAINING_SUFFIX),
    path.join(REPO, 'panel-game', TRAINING_SUFFIX),
    '/home/user/briankeegan/panel-game/' + TRAINING_SUFFIX.split(path.sep).join('/')
].filter(Boolean);

var TRAINING_DIR = null;
var ENDLESS_FILES = null;
function endlessFiles() {
    if (ENDLESS_FILES) return ENDLESS_FILES;
    for (var i = 0; i < TRAINING_CANDIDATES.length && !TRAINING_DIR; i++) {
        try {
            if (fs.statSync(TRAINING_CANDIDATES[i]).isDirectory()) TRAINING_DIR = TRAINING_CANDIDATES[i];
        } catch (e) { /* next candidate */ }
    }
    if (!TRAINING_DIR) {
        // Name every place looked and what to do, because the failure this
        // replaces was a bare ENOENT on one path in a stack trace.
        throw new Error('the endless scenario needs the real attack files from the ' +
            'panel-game repo, and none of these exist:\n  ' +
            TRAINING_CANDIDATES.join('\n  ') +
            '\nClone briankeegan/panel-game beside this repo, or set GC_TRAINING_DIR ' +
            'to its client/assets/default_data/training directory.');
    }
    ENDLESS_FILES = fs.readdirSync(TRAINING_DIR)
        .filter(function (f) { return /^challenge-8-\d+\.json$/.test(f); })
        .sort()
        .map(function (f) { return path.join(TRAINING_DIR, f); });
    if (!ENDLESS_FILES.length) throw new Error('no challenge-8-*.json in ' + TRAINING_DIR);
    return ENDLESS_FILES;
}
exports.endlessFileCount = function () { return endlessFiles().length; };

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
// full_report.js's LEAD_IN / BURST_LEN / GAP, and its CYCLE derived the
// same way. Copied rather than imported because that file is a CLI that
// runs a whole report on require; the fidelity test is what stops the copy
// drifting, which is the only reason a copy is acceptable here at all.
// Prefixed BURST_ because this file already had a `LEAD_IN` further down
// (build's own 120-frame one) and a bare second `var LEAD_IN = 150` here
// shared its binding — the later assignment won at load, so the burst
// drills silently ran on a 120-frame lead-in and factory came out 1317
// frames against full_report's 1329. Twelve frames, no error, and the only
// reason it was caught is that the fidelity check demands EXACT equality
// rather than "close enough".
var BURST_LEAD_IN = 150, BURST_LEN = 50, BURST_GAP = 900;
var BURST_CYCLE = BURST_GAP + (BURST_LEAD_IN + BURST_LEN) - BURST_LEAD_IN;
function burstFires(f) {
    if (f < BURST_LEAD_IN + 1) return false;
    return ((f - BURST_LEAD_IN - 1) % BURST_CYCLE) < BURST_LEN;
}

// The tier every scenario runs at. GC_LEVEL picks it; 3 is what the first
// rounds trained on and remains the default so an old command line means
// what it meant.
var LEVEL = Number(process.env.GC_LEVEL || 3);

var SCENARIOS = {
    build: {
        level: 3,
        garbageEvery: 120,
        garbageWidth: 6,
        garbageHeight: 3,
        leadIn: 120
    },
    // THE THREE BURST DRILLS full_report.js CALLS ITS TRAINING MODES,
    // reproduced here so training and reporting are the SAME GAME.
    //
    // Same shape as that file's runTrainingMode, and deliberately not
    // "something similar": a 50-frame burst every 950, after a 150-frame
    // lead-in, differing only in the slab it throws. bench.js's original
    // `build`/`siege` were invented drills that resembled these, and the
    // resemblance is exactly what let a fitness drift away from the
    // benchmark without anyone noticing. Pinned by bench.fidelity.test.js,
    // which runs full_report's own runner beside these and fails on any
    // difference at all.
    // LEVEL IS A PARAMETER, NOT A PROPERTY OF THE DRILL. full_report.js
    // runs every category at every level it is asked for (default
    // 3,5,8,10), so a scenario carries a default and GC_LEVEL overrides it
    // — otherwise training is pinned to one tier while the benchmark
    // reports four, which is the same stand-in problem as training on a
    // synthetic drill.
    //
    // The tiers are the SAME GAME with different constants, not different
    // games: same board, same matching, same swaps, same garbage. What
    // changes is maxHealth 81 -> 1, colours 5 -> 6, startingSpeed 9 -> 32,
    // GARBAGE_HOVER 31 -> 4, adjacentDenial 0.29 -> 1.0, and the stop-time
    // economics (comboConstant -12 -> +22, so combos go from penalised to
    // rewarded). A weight set learned on one tier has learned those
    // constants along with the game.
    comboStorm: { level: LEVEL, burst: true, garbageWidth: 4, garbageHeight: 1, ceiling: 120000 },
    factory:    { level: LEVEL, burst: true, garbageWidth: 6, garbageHeight: 2, ceiling: 120000 },
    bigBlocks:  { level: LEVEL, burst: true, garbageWidth: 6, garbageHeight: 12, ceiling: 120000 },

    // THE ONE THAT IS NOT A DRILL AT ALL.
    //
    // `build` and `siege` are synthetic: a fixed slab on a fixed period.
    // `endless` replays a REAL attack file — the twelve challenge-8-*.json
    // the source game ships, the same twelve full_report.js averages for
    // its headline number — so a game here is a game of the thing being
    // measured rather than a stand-in for it.
    //
    // WHY THIS EXISTS. Two training rounds ranked in the OPPOSITE order on
    // the build drill and on endless: round 1 beat round 2 on build's
    // held-out seeds (734 vs 681) and lost to it on endless by 54% of sent
    // garbage (276 vs 424). A fitness that inverts the benchmark is not an
    // imperfect proxy, it is the wrong target, and every extra generation
    // spent on it improves a number nobody looks at. See FINDINGS.md.
    //
    // ONE FILE PER GAME, picked by the seed. That is Puyo's shape and not a
    // shortcut: the reference plays ONE full game per weight set and gets
    // its diversity from the NUMBER of sets, not from averaging within one.
    // The seed pool rotates, so a genome that suits one attack file is
    // re-tested against a different one next generation.
    endless: {
        level: LEVEL,
        file: true,
        ceiling: 36000
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
        leadIn: 120
    }
};

var GARBAGE_EVERY = SCENARIOS.build.garbageEvery;
var GARBAGE_HEIGHT = SCENARIOS.build.garbageHeight;
var LEAD_IN = SCENARIOS.build.leadIn;


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
    // A file scenario picks its attack file from the seed, so the seed
    // selects BOTH the board and the opponent — two genomes on the same
    // seed always face the same game, and the rotating pool means no genome
    // can win by suiting one file.
    var schedule = null;
    if (sc.file) {
        var files = endlessFiles();
        var raw = JSON.parse(fs.readFileSync(files[(seed - 1 + files.length * 100) % files.length], 'utf8'));
        schedule = attackSchedule.buildEventSchedule(raw, PanelEngine.GARBAGE_FLIGHT);
    }
    var stack = new PanelEngine.Stack({ level: sc.level, seed: seed, countdown: false });

    // TWO BRAINS, AND AT LEVEL 10 ONLY ONE OF THEM CAN BE TRAINED.
    //
    // 'search' is SearchCpu with the evaluator attached through seams. It
    // is the shipped bot and it reaches 100% of decisions at levels 3, 5
    // and 8 — and 4% at level 10, where TrueSurvivalSearch decides
    // instead. Weights trained against it there would be weights for 4%
    // of the game.
    //
    // 'puyo' is puyocpu.js: score every legal move's resulting board with
    // the weighted sum, play the best, and nothing else. That is the
    // reference's bot, it reaches 100% of decisions by construction at
    // every level, and it is ~6x cheaper per game because there is no beam
    // search and no rollout behind it.
    var brain = opts.brain || 'search';
    var cpu, detach = null;
    if (brain === 'puyo') {
        cpu = new PuyoCpu(stack, {
            weights: weights || {},
            // Matched to SearchCpu's nightmare preset so a comparison
            // between the brains is about the scoring, not the cadence.
            reaction: 12,
            // Lookahead, when the caller asks for it. Absent means depth 1,
            // which is the bot every existing result describes — so a run
            // that does not pass these is byte-for-byte the old experiment.
            depth: opts.depth || 1,
            beam: opts.beam || 6
        });
    } else {
        cpu = new PanelCpu.SearchCpu(stack, {
            difficulty: 'nightmare', seed: seed + 55, mistake: 0, chainExtend: true
        });
        if (weights) {
            try { detach = attach(PanelCpu.SearchCpu, weights, opts); }
            catch (e) { return { frames: 0, sent: 0, unsafe: false, error: e.message }; }
        }
    }

    // Time whichever brain is actually deciding. SearchCpu decides in
    // _choose; PuyoCpu decides in _decide. Timing the wrong one reports a
    // reassuring 0ms for a bot that might be far too slow.
    var localMax = 0;
    var origChoose = PanelCpu.SearchCpu.prototype._choose;
    var origDecide = PuyoCpu.prototype._decide;
    function timed(orig) {
        return function () {
            var t0 = Date.now();
            var r = orig.apply(this, arguments);
            var dt = Date.now() - t0;
            if (dt > localMax) localMax = dt;
            return r;
        };
    }
    if (brain === 'puyo') PuyoCpu.prototype._decide = timed(origDecide);
    else PanelCpu.SearchCpu.prototype._choose = timed(origChoose);

    var f, sent = 0;
    try {
        // NO FRAME CAP. The reference plays a FULL game — step 2 is "play a
        // full game with them" — and it ends when the board tops out.
        //
        // There was a 4,000-frame ceiling here as a termination safety net,
        // and it was censoring the objective on exactly the candidates that
        // matter: four of the first ten rounds of the faithful run ended
        // with died:0%, meaning those genomes were still alive and still
        // scoring when they were cut off. A genome that would have reached
        // 5,000 and one that would have reached 50,000 both reported
        // whatever they had banked at the cut-off, and selection between
        // them was luck.
        //
        // The run now ends when the game ends: gameOver, or the timing
        // guard. A genome this drill cannot kill will run until it is
        // killed, which is the honest consequence of measuring a full game.
        for (f = 0; ; f++) {
            if (schedule) {
                // A real file's deliveries, at their real frames, already
                // offset by GARBAGE_FLIGHT the way the engine delivers them.
                var fired = attackSchedule.eventsAt(schedule, f);
                for (var q = 0; q < fired.length; q++) {
                    stack.receiveGarbage([{ width: fired[q].width, height: fired[q].height,
                                            isChain: fired[q].isChain }]);
                }
            } else if (sc.burst) {
                if (burstFires(f)) {
                    stack.receiveGarbage([{ width: sc.garbageWidth, height: sc.garbageHeight,
                                            isChain: false }]);
                }
            } else if (f > sc.leadIn && f % sc.garbageEvery === 0) {
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
            // THE BENCHMARK'S OWN CEILINGS, and only the benchmark's.
            //
            // This is not the 4,000-frame ceiling that used to be here and
            // was rightly removed: that one censored the objective, cutting
            // off genomes that were still alive and still scoring, so
            // selection between "would have reached 5,000" and "would have
            // reached 50,000" was luck. These are full_report.js's numbers
            // — 36,000 for endless (its ENDLESS_MAX_FRAMES, 10 simulated
            // minutes per file) and 120,000 for the burst drills (its
            // TRAINING_CEILING, ~30x the longest survival ever seen on one).
            // Matching them is the POINT of this file: a game that ends
            // differently here than in the report is a game the report does
            // not describe. They also stop an unkillable genome hanging a
            // run forever, which no-cap could and did threaten.
            if (sc.ceiling && f >= sc.ceiling - 1) { f++; break; }
        }
    } finally {
        PanelCpu.SearchCpu.prototype._choose = origChoose;
        PuyoCpu.prototype._decide = origDecide;
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
// THE FOUR CATEGORIES full_report.js REPORTS, which is what a run is
// judged on, so it is what a run should be trained on.
exports.ARENA = ['comboStorm', 'factory', 'bigBlocks', 'endless'];

// NO NORMALISERS, NO BASELINE, NOTHING BUT THE SCORE.
//
// There were per-category normalisers here — the SHIPPED bot's mean score
// on each drill — so that the four counted equally and fitness read as
// "multiples of shipped". That is a baseline in the loop wearing a unit
// conversion's clothes, and PUYO_REFERENCE.md's loop has no baseline in it
// at all: the population is ranked against ITSELF on absolute score,
// because there is no previous bot to rank against. Dividing by shipped
// makes every fitness a statement about shipped.
//
// It also stopped the thing being recorded from being a SCORE. Step 3 of
// the reference is "record the final score", and a geometric mean of four
// ratios is not the final score of anything. What a bot playing four games
// scores is the four scores added up, so that is what this is.
//
// The objection normalising answered was real — comboStorm and endless are
// worth ~1200-1400 a game and bigBlocks ~370, so the small drill moves the
// sum least. That is not a distortion to correct, it is what those games
// are worth. Puyo does not reweight its own scoring to make each board
// count equally either.

exports.fitness = function (weights, seeds, opts) {
    seeds = seeds || exports.SEEDS;
    opts = opts || {};
    var objective = opts.objective || 'survival';

    // MULTI-CATEGORY. Every seed is played on every category in the arena
    // and the categories are averaged after normalising — one game per
    // (weight set, category). Still Puyo's one-full-game-per-set: once per
    // problem the bot has to be good at, rather than a smoothed average
    // over seeds within a single problem.
    if (opts.arena) {
        var cats = Array.isArray(opts.arena) ? opts.arena : exports.ARENA;
        var per = {}, total = 0, allFrames = 0, allSent = 0, allDeaths = 0, games = 0;
        for (var c = 0; c < cats.length; c++) {
            var sub = Object.assign({}, opts, { arena: null, scenario: cats[c] });
            var r = exports.fitness(weights, seeds, sub);
            if (r.error) return { fitness: 0, error: r.error };
            if (r.unsafe) return { fitness: 0, unsafe: true };
            per[cats[c]] = { raw: r.fitness, avgFrames: r.avgFrames,
                             avgSent: r.avgSent, deathRate: r.deathRate };
            total += r.fitness;
            allFrames += r.avgFrames; allSent += r.avgSent; allDeaths += r.deathRate;
            games++;
        }
        // THE FOUR FINAL SCORES, ADDED UP. Step 3 of the reference is
        // "record the final score"; a bot that plays four games scores the
        // sum of them. No baseline, no reweighting, no ratio.
        return {
            fitness: total,                  // the four final scores, summed
            objective: objective,
            arena: cats,
            perCategory: per,
            avgFrames: allFrames / games,
            avgSent: allSent / games,
            deathRate: allDeaths / games
        };
    }

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
