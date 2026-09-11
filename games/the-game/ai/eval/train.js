// LEARN THE WEIGHTS. DO NOT TYPE THEM.
//
// Usage: node train.js [generations] [population] [mode] [workers]
//
// PUYO_REFERENCE.md's third stolen idea, and the one with the largest
// measured payoff behind it: meatfighter's seven weights were found by
// training, and Tetris's best controller went from 660,000 lines to
// 35,000,000 on the SAME features once cross-entropy method set the dials
// instead of a person. Hand-set weights are the single biggest unforced
// error available here, which is why weights.js ships all zeros and why
// every number this produces carries the run that earned it.
//
// WHAT IS SEARCHED: magnitude only, [0, 300] per feature. The registry
// already carries each feature's SIGN, so the GA never has to discover that
// height is bad — that halves the space and makes a sign-flipped fluke that
// happens to fit eight seeds impossible.
//
// NO BASELINE IN THE LOOP. The reference's population is random and then
// evolved sets, ranked against each other on absolute score. Nothing is
// ever compared to a previous bot, because there isn't one.
//
// The zero genome used to sit in every generation so the winner "could
// never be worse than shipping nothing". That is a DEPLOYMENT safeguard
// wearing a training costume, and it anchors the search around the shipped
// heuristic — the population spends its selection pressure staying near a
// point the method never asked it to respect. Whether to replace the
// current AI is a real question and it is answered ONCE, at the end, by
// verify.js. It is not the loop's business.
//
// HELD-OUT SEEDS. Training uses seeds 1-8; 9-14 are never seen until the
// final report. A weight set that only wins on the seeds it was fitted to
// has learned those boards, not the game — and this repo has already paid
// once for a benchmark that flattered what was tuned against it
// (FINDINGS.md's misleading synthetic benchmark).
var fork = require('child_process').fork;
var path = require('path');
var fs = require('fs');
var registry = require('./registry.js');
var bench = require('./bench.js');
var SEEDS = require('./seeds.js');

var GENERATIONS = Number(process.argv[2] || 12);
var POPULATION = Number(process.argv[3] || 20);
var MODE = process.argv[4] || 'add';
var WORKERS = Number(process.argv[5] || 4);
// WHAT A GOOD GAME MEANS. PUYO_REFERENCE.md calls this one of only two
// things that are ours to decide, and the one that "silently defines
// everything the bot becomes". meatfighter used final score; the first run
// here used survival and produced exactly the bot that choice predicts —
// weighted almost entirely on tidiness, chainLength=3, barely attacking.
var OBJECTIVE = process.argv[6] || 'score';

// TRAIN ON THE FOUR CATEGORIES THE BENCHMARK REPORTS, not on a stand-in.
//
// The synthetic `build` drill this trainer used ranked two real candidates
// in the OPPOSITE order to full_report.js's endless — round 1 beat round 2
// on build's held-out seeds and lost to it on endless by 54% of sent
// garbage. That is not an imperfect proxy, it is the wrong question, and
// forty generations of answering it well bought nothing. bench.js's four
// scenarios are now full_report's four, frame for frame and gated
// (bench.fidelity.test.js), so a genome is scored on the same games it
// will be reported on.
//
// GC_ARENA=build (or any single scenario name) falls back to the old
// single-drill behaviour for a quick smoke run.
// WHICH BRAIN THE WEIGHTS DRIVE.
//
// 'puyo' (puyocpu.js) is the reference's bot: score every legal move's
// resulting board with the weighted sum, play the best, nothing else. It
// reaches 100% of decisions at every level by construction, and it is the
// only option that means anything at LEVEL 10 — SearchCpu consults the
// evaluator on 4% of decisions there, so weights trained against it would
// be weights for 4% of the game.
//
// It is also ~40x cheaper per game (14-39ms against 550-2650ms), because
// there is no beam search and no engine rollout behind it. That is what
// makes "hundreds of weight sets" affordable rather than aspirational.
var BRAIN = process.env.GC_BRAIN || 'search';
// The brain being TRAINED, captured once. BRAIN itself is swapped
// temporarily while the baseline row runs a different brain, and reading it
// across that async boundary is how a result file comes to be labelled with
// the baseline's brain instead of its own.
var TRAINED_BRAIN = BRAIN;

var ARENA = process.env.GC_ARENA
    ? (process.env.GC_ARENA === 'all' ? true : process.env.GC_ARENA.split(','))
    : true;

// SEEDS ROTATE EVERY GENERATION, AND THE POOL IS LARGE.
//
// The first run of this trainer scored +56% on eight fixed training seeds
// and -22% on held-out ones. It had not learned to play, it had learned
// those eight boards — and with the shipped AI itself scoring 1888 on one
// set and 1671 on the other, eight samples of a quantity that varies that
// much is simply not a measurement.
//
// Two changes, both aimed at the same thing. The pool is 40 seeds instead
// of 8, and each generation draws a fresh subset of 12 from it, so no fixed
// set exists to memorise: a genome that wins by suiting one batch is
// re-tested on a different batch next generation and does not survive.
// Elites are re-evaluated every generation for the same reason — carrying a
// stale high score forward is how a lucky batch becomes a permanent king.
//
// Costs 50% more per generation (12 seeds rather than 8) and is worth it:
// the previous run spent an hour producing a number that was worse than
// doing nothing.
var SEED_POOL = SEEDS.TRAIN;
// ONE GAME PER WEIGHT SET, WHICH IS WHAT THE REFERENCE ACTUALLY DOES.
//
// PUYO_REFERENCE.md's loop is "play a full game with them, record the final
// score, repeat for HUNDREDS of random weight sets". The diversity comes
// from the number of SETS, not from averaging seeds within a set. Running
// twelve seeds per genome spends twelve times the compute per candidate to
// get a smoother number, and then explores sixteen candidates where they
// explore hundreds — backwards for a search.
//
// The noise this leaves per candidate is real and is handled the way it is
// there: by volume. Selection pressure across hundreds of genomes finds the
// signal; the WINNER is then re-evaluated on the full pool and on held-out
// seeds before any claim is made, so nothing is ever reported off one game.
// Elites are re-evaluated every generation, or a genome that drew one easy
// seed becomes a permanent king.
var SEEDS_PER_GENERATION = Number(process.env.GC_SEEDS_PER_GEN || 1);
// TWELVE, AND NOT BY COINCIDENCE ANY MORE. endless picks its attack file
// from the seed, and 101-112 map to file indices 4,5,6,7,8,9,10,11,0,1,2,3
// — all twelve, exactly once each. So the held-out endless number is the
// SAME average full_report.js prints for its headline, rather than a
// sample of it, and the two can be compared directly. Changing the count
// breaks that; changing it to a non-multiple of twelve silently weights
// some attack files double.
// THE FINALS SET IS GONE, and seeds.js still defines it only so an old
// result file can be read back.
//
// It existed to choose between finalists at the end of a round. Rounds are
// gone, so there is nothing to choose between — and a fixed set that
// SELECTS is a fixed set to overfit, which is what it started doing:
// measured +19% on the seeds that chose a champion and -13% on seeds it had
// never seen. Two sets remain and each has exactly one job: 1-40 to train,
// 101-112 to report. Nothing selects on anything fixed.
// CONTINUOUS SEARCH KNOBS.
//
// SNAPSHOT_EVERY — how often the search stops to report. It does not
// interrupt the search: the population carries straight on afterwards. It
// exists so a run that goes for hours still produces a champion anyone can
// look at, and so the crank has something to commit.
var SNAPSHOT_EVERY = Number(process.env.GC_SNAPSHOT_EVERY || 30);
var SNAPSHOT_HOOK = process.env.GC_SNAPSHOT_HOOK || null;

// A wall-clock budget, so this can live on a runner with a job timeout.
// Unset means run to the generation cap or to convergence.
var DEADLINE = process.env.GC_DEADLINE ? Number(process.env.GC_DEADLINE) : null;

// "RUN THAT UNTIL THE NUMBERS STOP MOVING" — the reference's own stopping
// rule, taken literally. It does not say "until the score stops improving";
// it says the WEIGHTS settle ("links settles at 0.25, variance at 0.02").
//
// That distinction matters here. Any rule based on a score has to pick a
// seed set to measure the score on, and a fixed set that decides when to
// stop is a fixed set being selected against — the exact mistake that made
// this rewrite necessary. Weight movement needs no seeds at all.
//
// Converged when the elite's weights move less than STILL_ENOUGH of the
// weight range per snapshot, three snapshots running. Three rather than one
// for the same reason the old rule used three rounds: a single still
// snapshot is as likely to be noise as a plateau, and the cost of a false
// stop (losing the run) is far worse than a false continue (30 more
// generations).
var STILL_ENOUGH = Number(process.env.GC_STILL_ENOUGH || 0.02);
var STILL_SNAPSHOTS = 3;
var lastSnapshotWeights = null;
var stillCount = 0;

// How many of the final generation get that treatment.
var HOLDOUT_SEEDS = SEEDS.HOLDOUT;
// WHICH FEATURES THIS RUN SEARCHES. Everything in the registry, unless
// GC_EXCLUDE names some to leave out — a comma list of keys, which are
// dropped from the genome entirely rather than pinned at zero, so the run
// searches a smaller space instead of carrying dead dimensions.
//
// This exists so two features can be measured SEPARATELY before they are
// combined. staircase and flatTop arrived together; run them in the same
// search and neither one's weight answers "what is this worth", because the
// search can trade them off against each other from the first generation.
// Two runs, one feature each, then a third with both, is three answers
// instead of one — and the third is only worth running if either of the
// first two moved.
//
// An unknown key is fatal: a typo'd exclusion would silently train the full
// set and be reported as the reduced one, which is the same shape of lie as
// a gate that cannot fail.
// THE SEARCH DEPTH THE WEIGHTS ARE BEING FOUND FOR.
//
// The weights describe a BOT, not a board, so they are only valid for the
// decision procedure that was running while they were searched. Measured,
// on the shipped depth-1 weights over eight level-10 games: depth 1 reaches
// 22378 frames and 14780 points, the same weights under depth 2 reach 7496
// and 2550. Roughly a third, from changing nothing but how the move is
// chosen. A lookahead bot needs its own run; it cannot borrow.
var DEPTH = Number(process.env.GC_DEPTH || 1);
var BEAM = Number(process.env.GC_BEAM || 6);

var EXCLUDE = (process.env.GC_EXCLUDE || '').split(',')
    .map(function (k) { return k.trim(); })
    .filter(function (k) { return k.length; });
EXCLUDE.forEach(function (k) {
    if (!registry.byKey[k]) {
        throw new Error('GC_EXCLUDE names "' + k + '", which is not a feature — known: ' +
                        registry.keys.join(', '));
    }
});
var KEYS = registry.keys.filter(function (k) { return EXCLUDE.indexOf(k) < 0; });
if (!KEYS.length) throw new Error('GC_EXCLUDE excluded every feature; there is nothing to search');
var MAX_WEIGHT = 300;

// THE SEARCH IS CROSS-ENTROPY METHOD, because that is what the reference
// runs. ../PUYO_REFERENCE.md steps 5 and 6: "keep the highest-scoring SETS,
// generate new sets CLUSTERED NEAR THOSE WINNERS", and it names the method
// outright — "same loop as Tetris's cross-entropy method".
//
// WHAT WAS HERE BEFORE, and why it was wrong rather than merely different.
// A genetic algorithm: tournament-of-3 selection, uniform crossover, and a
// gaussian mutation at a FIXED sigma of 15% of the weight range. Three
// mismatches, in order of how much they cost:
//
//   1. The mutation never annealed. Every generation kicked the weights by
//      the same amount forever, so they could not settle — measured on a
//      40-genome run, the elite moved 23.6% then 24.1% of the range between
//      snapshots, flat, no downward trend. The stop rule added with the
//      continuous search waits for movement under 2%, so it could NEVER
//      HAVE FIRED. The crank would have run to its generation cap and
//      reported "we got bored" as if it were a plateau.
//   2. Uniform crossover takes each weight from one parent or the other, so
//      a child can land far from BOTH. That is not "clustered near those
//      winners"; it is a jump to a corner of the box between them.
//   3. Tournament-of-3 out of 200 barely selects — a below-median genome is
//      a likely parent. CEM keeps only the top slice.
//
// CEM instead: score everyone, keep the top ELITE_FRACTION, fit a mean and
// a spread to those elites per weight, and draw the next generation from
// that distribution. The spread narrows on its own as the elites agree,
// which is exactly what "run until the numbers stop moving" describes — the
// stopping rule and the search are the same mechanism seen from two sides.
var ELITE_FRACTION = Number(process.env.GC_ELITE_FRACTION || 0.15);

// A NOISE FLOOR THAT DECAYS, which is part of the method rather than a knob
// bolted on. CEM's known failure is premature collapse: one lucky
// generation agrees, the spread goes to nearly zero, and the search stops
// exploring while it is still wrong. Szita and Lorincz's Tetris work — the
// one the reference cites for 660,000 -> 35,000,000 lines — adds a decaying
// term to the variance for exactly this reason.
//
// It decays to zero, so it cannot prevent convergence; it only stops the
// distribution collapsing before the search has looked around.
var NOISE_FLOOR = MAX_WEIGHT * 0.04;
var NOISE_ZERO_AT = Number(process.env.GC_NOISE_ZERO_AT || 300);

// THE GA'S OWN RANDOMNESS, AND WHY IT MUST BE SETTABLE.
//
// This was a fixed constant, which made a run reproducible — a good
// property, and the reason the default is still that constant. It also
// made every run with the same arguments a bit-identical REPLAY. That was
// fatal when the search was chopped into rounds — each round restarted from
// the champion and returned the identical held-out total, to fifteen decimal
// places, so "run until the numbers stop moving" could not mean anything.
//
// Rounds are gone and the search no longer restarts, so a replay is much
// harder to cause. It stays settable anyway: two runs from the same
// checkpoint should be able to explore differently, and a fixed constant
// would mean a resumed search always redoes the same generations.
//
// Caught because two consecutive rounds reported 2195.8333333333335. Noise
// does not repeat to the last digit; that is the shape of a replay, and it
// would otherwise have stopped the crank after three identical rounds
// having explored nothing.
var rngState = Number(process.env.GC_GA_SEED || 20260907);
function rng() {           // deterministic, so a run can be repeated exactly
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
}
function gauss() {
    var u = Math.max(rng(), 1e-9), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function zeroGenome() { var g = {}; KEYS.forEach(function (k) { g[k] = 0; }); return g; }
function randomGenome() {
    var g = {};
    // Sparse on purpose: a genome with every feature switched on at once
    // says nothing about which one did the work, and the reference's own
    // bot carries most of its score in two features.
    KEYS.forEach(function (k) { g[k] = rng() < 0.4 ? rng() * MAX_WEIGHT : 0; });
    return g;
}

// A JOB GOES TO A WORKER THAT IS FREE, NOT TO THE NEXT NUMBER.
//
// This used to pick the child as pool[pending % pool.length] — a counter,
// not an answer to "who is idle". A worker's messages queue up inside it,
// so nothing failed and nothing looked wrong: jobs just piled onto
// whichever child the counter kept landing on while the rest sat still.
// Caught by `ps`, not by the trainer — one worker at 104% CPU with 57
// seconds of it banked, the other three on one second each, and
// generation 1 of a 40-generation run had not finished. A four-worker run
// was running one worker deep, so every wall-clock estimate made from it
// was out by four.
var pool = [], queue = [], onDone = null;
for (var w = 0; w < WORKERS; w++) {
    pool.push({ child: fork(path.join(__dirname, 'train_worker.js')), busy: false });
}
pool.forEach(function (slot) {
    slot.child.on('message', function (msg) {
        var job = queue.find(function (j) { return j.id === msg.id; });
        if (job) job.done(msg.result);
        slot.busy = false;
        pump();
    });
});
function busyCount() {
    return pool.filter(function (s) { return s.busy; }).length;
}
function pump() {
    for (var i = 0; i < pool.length; i++) {
        if (pool[i].busy) continue;
        var job = queue.find(function (j) { return !j.sent; });
        if (!job) break;
        job.sent = true;
        pool[i].busy = true;
        pool[i].child.send({ id: job.id, weights: job.weights, seeds: job.seeds,
                             mode: MODE, checkTiming: false,
                             depth: DEPTH, beam: BEAM,
                             scenario: job.scenario, arena: job.arena,
                             objective: OBJECTIVE, brain: BRAIN });
    }
    if (!busyCount() && queue.every(function (j) { return j.sent; }) && onDone) {
        var f = onDone; onDone = null; f();
    }
}
var nextId = 1;
function evaluateAll(genomes, seeds, cb, scenario, arena) {
    var results = new Array(genomes.length);
    queue = genomes.map(function (g, i) {
        return { id: nextId++, weights: g, seeds: seeds, sent: false,
                 scenario: scenario, arena: arena === undefined ? ARENA : arena,
                 done: function (r) { results[i] = r; } };
    });
    onDone = function () { cb(results); };
    pump();
}

function summarise(g) {
    return KEYS.filter(function (k) { return g[k] > 0.5; })
               .map(function (k) { return k + '=' + g[k].toFixed(0); })
               .join(' ') || '(all zero — the shipped AI)';
}

// STEP 6 OF THE REFERENCE'S LOOP, ACROSS RUNS AS WELL AS WITHIN ONE:
// "generate new sets clustered near those winners", then "run that until
// the numbers stop moving". A fresh run that starts from scratch throws the
// previous round's winners away, so a seed file carries them forward — the
// winner itself, variants of it at three mutation strengths, and the rest
// random so the search can still leave its basin.
var population = [];
var seedFile = process.env.GC_SEED_GENOME;
if (seedFile && fs.existsSync(seedFile)) {
    var prior = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    var seedGenome = prior.weights || prior;
    population.push(seedGenome);
    var strengths = [0.1, 0.25, 0.5];
    while (population.length < Math.floor(POPULATION * 0.6)) {
        var strength = strengths[population.length % strengths.length];
        var g = {};
        KEYS.forEach(function (k) {
            var v = (seedGenome[k] || 0) + gauss() * MAX_WEIGHT * strength;
            g[k] = Math.max(0, Math.min(MAX_WEIGHT, v));
        });
        population.push(g);
    }
    console.log('seeded from ' + seedFile + ': winner + ' +
                (population.length - 1) + ' variants, rest random');
}
while (population.length < POPULATION) population.push(randomGenome());

var generation = 0;
var best = null, bestFit = -Infinity, finalists = [];
var t0 = Date.now();

// A CHECKPOINT AFTER EVERY GENERATION, because until now a run that was
// killed wrote NOTHING.
//
// This only ever saved at finish(), after all GENERATIONS. A round killed at
// generation 45 of 60 therefore threw away 45 generations of real work — the
// population was sitting in memory the whole time, fully evaluated, and
// nobody had written it down. That is what made the Claude Code sandbox
// unusable for training: its microVM is reclaimed between turns and a round
// takes ~15 minutes, so round after round died at some generation and
// produced no champion at all. Nothing could be fed forward because nothing
// was ever saved.
//
// The state a generation needs is small: the population, which generation it
// is, the GA's rng cursor, and the finalists collected so far. Written after
// each one, a kill costs at most a single generation instead of a whole
// round.
//
// WHY A FINGERPRINT. A checkpoint from a 60-generation run resumed into an
// 8-genome smoke test would be silently wrong — a different search, wearing
// the same filename. So the checkpoint records the config that made it and
// is IGNORED, loudly, when anything that shapes the search differs.
var CHECKPOINT = path.join(__dirname, '.train-checkpoint.' + MODE + '.json');
function fingerprint() {
    // 'cem' is in here because a checkpoint written by the old genetic
    // algorithm holds a population bred a different way. Resuming one into
    // this search would be continuing somebody else's run.
    return ['cem', ELITE_FRACTION, GENERATIONS, POPULATION, MODE, BRAIN, TRAINED_BRAIN,
            process.env.GC_LEVEL || '', process.env.GC_GA_SEED || '',
            String(DEPTH), String(BEAM),
            SEEDS_PER_GENERATION, KEYS.join(',')].join('|');
}
function saveCheckpoint() {
    // Written to a temp file and RENAMED. A kill lands somewhere, and a kill
    // halfway through writing this file would leave truncated JSON that the
    // next run cannot parse — turning a crash-safety feature into the thing
    // that loses the run. rename() is atomic, so the checkpoint on disk is
    // always a whole one.
    try {
        var tmp = CHECKPOINT + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({
            fingerprint: fingerprint(), generation: generation, rngState: rngState,
            population: population, finalists: finalists,
            best: best, bestFit: bestFit === -Infinity ? null : bestFit
        }));
        fs.renameSync(tmp, CHECKPOINT);
    } catch (e) {
        // Never fatal. Losing the ability to resume is bad; killing a running
        // GA over it is worse.
        console.log('  (could not write checkpoint: ' + e.message + ')');
    }
}
if (fs.existsSync(CHECKPOINT)) {
    try {
        var ck = JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8'));
        if (ck.fingerprint !== fingerprint()) {
            // SAY WHICH FIELD DIFFERS. "config changed" sent me hunting
            // through nine possibilities by hand the first time this fired,
            // for what turns out to be one string comparison the code
            // already has both sides of.
            var names = ['generations', 'population', 'mode', 'brain', 'trainedBrain',
                         'level', 'gaSeed', 'seedsPerGen', 'features'];
            var was = String(ck.fingerprint).split('|'), now = fingerprint().split('|');
            var diff = names.filter(function (n, i) { return was[i] !== now[i]; })
                            .map(function (n, k) {
                                var i = names.indexOf(n);
                                return n + ' ' + was[i] + ' -> ' + now[i];
                            });
            console.log('ignoring a checkpoint from a different search: ' +
                        (diff.length ? diff.join(', ') : 'fingerprint shape changed'));
        } else if (ck.generation >= GENERATIONS) {
            console.log('ignoring a finished checkpoint');
        } else {
            population = ck.population;
            generation = ck.generation;
            rngState = ck.rngState;
            finalists = ck.finalists || [];
            best = ck.best; bestFit = ck.bestFit === null ? -Infinity : ck.bestFit;
            console.log('RESUMED from checkpoint at generation ' + generation +
                        '/' + GENERATIONS + ' — the previous run was killed, not restarted');
        }
    } catch (e) {
        console.log('unreadable checkpoint, starting fresh: ' + e.message);
    }
}

function seedsForGeneration() {
    // A deterministic shuffle of the pool, different every generation, so a
    // run is reproducible but no genome ever sees the same batch twice.
    var pool = SEED_POOL.slice();
    for (var i = pool.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, SEEDS_PER_GENERATION);
}

function step() {
    var genSeeds = seedsForGeneration();
    evaluateAll(population, genSeeds, function (results) {
        var scored = population.map(function (g, i) {
            return { genome: g, fit: (results[i] && results[i].fitness) || 0, detail: results[i] };
        });
        scored.sort(function (a, b) { return b.fit - a.fit; });
        // Best-of-generation, NOT best-ever: fitnesses from different
        // generations are measured on different seed batches and are not
        // comparable. Keeping a best-ever across batches would just keep
        // whichever genome drew the easiest twelve.
        bestFit = scored[0].fit;
        best = scored[0].genome;
        // THE TOP SETS, PLURAL. The reference's step 5 is "keep the highest
        // scoring SETS" and step 6 clusters near "those WINNERS" — plural
        // both times. Crowning scored[0] treats one generation's single
        // seed as the answer, and a single game cannot tell two good weight
        // sets apart: measured, the SAME weights score 1380 to 6070 across
        // seeds, a 4.4x swing, while two genuinely different sets differ in
        // the mean by 17%. So the last generation's ranking is a fair
        // comparison on one board and a coin flip as a verdict.
        //
        // These are carried to finish(), which plays them all on the finals
        // seeds and crowns the best. Selection within a generation is
        // unchanged: every genome in a generation plays the identical seed
        // and always did.


        console.log('gen ' + String(generation + 1).padStart(2) + '/' + GENERATIONS +
            '  best ' + scored[0].fit.toFixed(0) +
            '  median ' + scored[Math.floor(scored.length / 2)].fit.toFixed(0) +
            '  [frames ' + (scored[0].detail && scored[0].detail.avgFrames || 0).toFixed(0) +
            ' sent ' + (scored[0].detail && scored[0].detail.avgSent || 0).toFixed(1) +
            ' died ' + ((scored[0].detail && scored[0].detail.deathRate || 0) * 100).toFixed(0) + '%]' +
            '  [' + ((Date.now() - t0) / 60000).toFixed(1) + 'm]');
        var pc = scored[0].detail && scored[0].detail.perCategory;
        if (pc) {
            console.log('       ' + Object.keys(pc).map(function (k) {
                return k + ' ' + pc[k].raw.toFixed(0);
            }).join('  '));
        }
        console.log('       ' + summarise(scored[0].genome));

        generation++;
        if (generation >= GENERATIONS) return finish();

        // OUT OF TIME. Stop cleanly with a real result rather than being
        // killed mid-generation by a job timeout.
        if (DEADLINE && Date.now() / 1000 > DEADLINE) {
            console.log('\n=== OUT OF TIME at generation ' + generation + ' ===');
            return finish();
        }

        // HAVE THE NUMBERS STOPPED MOVING?
        if (generation % SNAPSHOT_EVERY === 0) {
            var elite = scored[0].genome;
            if (lastSnapshotWeights) {
                var moved = 0;
                KEYS.forEach(function (k) {
                    moved += Math.abs((elite[k] || 0) - (lastSnapshotWeights[k] || 0));
                });
                moved = moved / KEYS.length / MAX_WEIGHT;
                stillCount = moved < STILL_ENOUGH ? stillCount + 1 : 0;
                console.log('\nweights moved ' + (moved * 100).toFixed(2) + '% of range since the ' +
                            'last snapshot (still ' + stillCount + '/' + STILL_SNAPSHOTS + ')');
            }
            lastSnapshotWeights = {};
            KEYS.forEach(function (k) { lastSnapshotWeights[k] = elite[k] || 0; });

            best = elite;
            bestFit = scored[0].fit;
            if (stillCount >= STILL_SNAPSHOTS) {
                console.log('=== THE NUMBERS HAVE STOPPED MOVING ===');
                return finish();
            }
            // A snapshot, then straight on — the population is untouched.
            return report(false, function () { advance(scored); });
        }

        advance(scored);
    });
}

// Breed the next generation. Pulled out of the loop so a snapshot can hand
// control back to exactly the same place a normal generation does.
function advance(scored) {
        // STEP 5: keep the highest-scoring sets. They stay in the population
        // — "keep" is the reference's own word — so the best genome found can
        // never be lost to an unlucky draw.
        var eliteCount = Math.max(2, Math.round(POPULATION * ELITE_FRACTION));
        var elites = scored.slice(0, eliteCount).map(function (s) { return s.genome; });

        // STEP 6: generate new sets clustered near those winners. The cluster
        // is a gaussian per weight, centred on the elites' mean and as wide
        // as the elites disagree. When they agree the spread is small and the
        // next generation lands close in; when they disagree it stays wide
        // and the search keeps looking.
        var mean = {}, spread = {};
        KEYS.forEach(function (k) {
            var sum = 0, i;
            for (i = 0; i < elites.length; i++) sum += elites[i][k] || 0;
            var m = sum / elites.length, v = 0;
            for (i = 0; i < elites.length; i++) {
                var d = (elites[i][k] || 0) - m;
                v += d * d;
            }
            mean[k] = m;
            spread[k] = Math.sqrt(v / elites.length);
        });

        var floor = Math.max(0, NOISE_FLOOR * (1 - generation / NOISE_ZERO_AT));
        var next = elites.slice();
        while (next.length < POPULATION) {
            var g = {};
            KEYS.forEach(function (k) {
                var s = Math.max(spread[k], floor);
                g[k] = Math.max(0, Math.min(MAX_WEIGHT, mean[k] + gauss() * s));
            });
            next.push(g);
        }

        population = next;
        saveCheckpoint();
        step();
}


// The winner's timing IS checked, single-threaded, where wall-clock means
// something. A config that cannot decide inside a frame is not a faster
// player, it is a broken one — the guard is not dropped, it is moved to the
// only place it can be measured honestly.
function checkWinnerTiming(genome, cb) {
    var worst = 0, unsafe = 0;
    HOLDOUT_SEEDS.forEach(function (seed) {
        var r = bench.run(genome, seed, { mode: MODE, scenario: 'endless', brain: TRAINED_BRAIN });
        if (r.localMax > worst) worst = r.localMax;
        if (r.unsafe) unsafe++;
    });
    cb({ worstMs: worst, unsafeSeeds: unsafe });
}

function finish() {
    // NO FINALIST SELECTION, AND NO ROUND BOUNDARY FOR IT TO SERVE.
    //
    // THE CHAIN, because it is worth not repeating. The search used to be
    // chopped into ROUNDS. A round could carry only ONE genome across its
    // boundary — the winner, plus mutations of it — so 199 of 200 genomes
    // were discarded every 60 generations. If you bet the next 60
    // generations on one genome you had better be sure it is not a fluke,
    // and it was: the same weights score 1380 to 6070 across seeds, a 4.4x
    // swing, while genuinely different sets differ by 17%. So finalist
    // selection was added. To keep rounds comparable its seeds were FIXED.
    // A fixed set, selected against round after round, is a target to
    // overfit — and the numbers began to show exactly that: a champion +19%
    // on the seeds that chose it and -13% on seeds it had never seen.
    //
    // Every step patched the step before, and the first step was rounds.
    // ../PUYO_REFERENCE.md has none: "keep the highest-scoring SETS,
    // generate new sets clustered near those winners, go back to step 2 …
    // run that until the numbers stop moving". One loop, plural winners, no
    // boundary — so nothing to pick at and nothing to overfit.
    //
    // rounds.sh read "go back to step 2" as "start a new search from the
    // winner". It means "keep this one going". That single misreading is
    // where all of the above came from.
    //
    // The answer is now the elite of the last generation, best by its own
    // training fitness. The held-out set is a REPORT and never a selector.
    report(true);
}

function report(isFinal, cb) {
    // HELD-OUT SEEDS, ALL FOUR CATEGORIES, BROKEN OUT.
    //
    // A single mean cannot tell improvement from specialisation, and this
    // trainer has already produced the latter twice: a set that wins the
    // drill it was trained on by playing recklessly and falls apart on
    // pressure it never saw. Now that the arena IS the benchmark's four
    // categories there is no "trained on / transfer" split to make — every
    // category is trained on and every one is reported, so a genome that
    // bought endless by abandoning bigBlocks is visible in the row rather
    // than hidden in the average.
    //
    // The shipped scoring is measured on the same seeds in the same
    // process. That is a REPORT, not a step of the search: the loop never
    // saw it, and whether to replace the current AI is a question answered
    // once, here, at the end.
    // THE BASELINE ROW IS THE REAL GAME AI, NOT THE ZERO GENOME.
    //
    // Under the search brain, zero weights ARE the shipped bot — that is
    // the whole point of additive mode, and the wiring law that says so.
    // Under the PUYO brain they are nothing of the kind: with no
    // preferences every candidate ties, it holds forever and scores 0, so
    // the report printed "shipped 0 ... +0.0%" on every row. A baseline
    // that is always zero is not a baseline, it is a broken column that
    // makes any result look infinite.
    //
    // So the comparison for the puyo brain is SearchCpu with no evaluator
    // attached — the AI the game actually ships at this level. It is run
    // here, once, as a REPORT: the loop never saw it, and the reference's
    // rule is about the search, not about whether a result may be compared
    // to anything at the end.
    var baselineJob = BRAIN === 'puyo'
        ? { genome: null, label: 'game AI (SearchCpu)', brain: 'search' }
        : { genome: zeroGenome(), label: 'shipped', brain: BRAIN };
    evaluateAll([best], HOLDOUT_SEEDS, function (learnedRes) {
      evaluateBaseline(baselineJob, HOLDOUT_SEEDS, function (baseRes) {
        var res = [learnedRes[0], baseRes];
        var learned = res[0], shipped = res[1];
        var out = {
            mode: MODE,
            objective: OBJECTIVE,
            brain: TRAINED_BRAIN,
            level: bench.LEVEL,
            // WHAT trainFitness MEANS, recorded with it: the elite's score
            // on the training seeds of the generation this snapshot was
            // taken at. Nothing compares snapshots on it — there is no
            // champion contest any more — so it is a progress reading, not
            // a verdict. The verdict is the held-out report below.
            // No finalsSeeds, no finalists: nothing selects on a fixed set
            // any more. Kept as an explicit false so an old consumer that
            // reads finalsSeeds gets undefined rather than a stale answer.
            selection: 'elite of generation ' + generation + ', by training fitness',
            arena: ARENA === true ? bench.ARENA : ARENA,
            // WHICH FEATURES THIS RUN SEARCHED. A snapshot that does not
            // say so is unreadable the moment two runs differ by their
            // feature set, which is exactly what GC_EXCLUDE is for.
            // The DECISION PROCEDURE these weights were found for. Weights
            // describe a bot, not a board: the same set is worth 14780
            // points under depth 1 and 2550 under depth 2. A snapshot that
            // does not say which is unreadable the moment both exist.
            depth: DEPTH,
            beam: BEAM,
            features: KEYS.slice(),
            excluded: EXCLUDE.slice(),
            generations: GENERATIONS,
            population: POPULATION,
            seedPool: SEED_POOL,
            seedsPerGeneration: SEEDS_PER_GENERATION,
            holdoutSeeds: HOLDOUT_SEEDS,
            trainFitness: bestFit,
            holdout: { learned: learned, shipped: shipped },
            improvementPct: shipped.fitness ? ((learned.fitness - shipped.fitness) / shipped.fitness) * 100 : 0,
            weights: best
        };
        console.log('\n=== HELD-OUT SEEDS (never trained on), baseline = ' + baselineJob.label + ' ===');
        var lp = learned.perCategory || {}, sp = shipped.perCategory || {};
        var lost = [];
        Object.keys(lp).forEach(function (k) {
            var l = lp[k].raw, sh = sp[k] ? sp[k].raw : 0;
            var pct = sh ? ((l - sh) / sh) * 100 : 0;
            if (pct < -3) lost.push(k);
            console.log('  ' + k.padEnd(11) +
                        ' shipped ' + sh.toFixed(0).padStart(6) +
                        '   learned ' + l.toFixed(0).padStart(6) +
                        '   ' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%');
        });
        console.log('  ' + 'TOTAL'.padEnd(11) +
                    ' shipped ' + (shipped.fitness || 0).toFixed(0).padStart(6) +
                    '   learned ' + (learned.fitness || 0).toFixed(0).padStart(6) +
                    '   ' + (out.improvementPct >= 0 ? '+' : '') + out.improvementPct.toFixed(1) + '%');
        out.lostCategories = lost;
        if (lost.length) {
            console.log('  ^ LOSES TO SHIPPED ON: ' + lost.join(', ') +
                        '. A gain bought by giving a category away is specialisation.');
        }
        console.log('\nweights: ' + summarise(best));
        checkWinnerTiming(best, function (timing) {
            out.timing = timing;
            console.log('timing (single-threaded): worst decision ' + timing.worstMs +
                        'ms, unsafe seeds ' + timing.unsafeSeeds + '/' + HOLDOUT_SEEDS.length);
            fs.writeFileSync(path.join(__dirname, 'trained.' + MODE + '.json'), JSON.stringify(out, null, 2));
            // NOW the checkpoint can go: the result it was protecting exists.
            // Leaving it would make the next run resume a search that already
            // finished, at its last generation, forever.
            try { fs.unlinkSync(CHECKPOINT); } catch (e) { /* never existed */ }
            console.log('written to trained.' + MODE + '.json');
            if (SNAPSHOT_HOOK) {
                // Whoever is running this decides what a snapshot is FOR —
                // committing it, pushing it, printing it. train.js does not
                // know about git and should not learn.
                try {
                    require('child_process').spawnSync(SNAPSHOT_HOOK,
                        [path.join(__dirname, 'trained.' + MODE + '.json'), String(generation)],
                        { stdio: 'inherit' });
                } catch (e) { console.log('  (snapshot hook failed: ' + e.message + ')'); }
            }
            if (isFinal) {
                // Only a real finish clears the checkpoint. A snapshot is a
                // progress report from a search that is still running, so
                // "this run was killed part-way" is still true afterwards.
                try { fs.unlinkSync(CHECKPOINT); } catch (e) { /* never existed */ }
                pool.forEach(function (s) { s.child.kill(); });
            } else if (cb) { cb(); }
        });
      });
    });
}

// One genome, one brain, straight through the workers. Separate from
// evaluateAll because the baseline may run a DIFFERENT brain than the one
// being trained, which the shared queue has no way to express.
function evaluateBaseline(job, seeds, cb) {
    var saved = BRAIN;
    BRAIN = job.brain;
    evaluateAll([job.genome], seeds, function (r) {
        BRAIN = saved;
        cb(r[0]);
    });
}

if (EXCLUDE.length) console.log('excluding ' + EXCLUDE.join(', ') + ' from the genome');
if (DEPTH > 1) console.log('lookahead: depth ' + DEPTH + ', beam ' + BEAM);
console.log('training ' + KEYS.length + ' weights, brain=' + BRAIN + ', level=' + bench.LEVEL +
            ', objective=' + OBJECTIVE + ', mode=' + MODE +
            ', pop=' + POPULATION + ', gens=' + GENERATIONS + ', ' + WORKERS + ' workers');
step();
