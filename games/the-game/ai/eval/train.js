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
var SEED_POOL = [];
for (var sp = 1; sp <= 40; sp++) SEED_POOL.push(sp);
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
var HOLDOUT_SEEDS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112];
var KEYS = registry.keys;
var MAX_WEIGHT = 300;

var ELITES = 2;
var TOURNAMENT = 3;
var MUTATION_RATE = 0.25;
var MUTATION_SIGMA = MAX_WEIGHT * 0.15;

var rngState = 20260907;
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
function crossover(a, b) {
    var g = {};
    KEYS.forEach(function (k) { g[k] = rng() < 0.5 ? a[k] : b[k]; });
    return g;
}
function mutate(g) {
    var out = {};
    KEYS.forEach(function (k) {
        var v = g[k];
        if (rng() < MUTATION_RATE) v += gauss() * MUTATION_SIGMA;
        out[k] = Math.max(0, Math.min(MAX_WEIGHT, v));
    });
    return out;
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
                             scenario: job.scenario, arena: job.arena,
                             objective: OBJECTIVE });
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
var best = null, bestFit = -Infinity;
var t0 = Date.now();

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

        var next = scored.slice(0, ELITES).map(function (s) { return s.genome; });
        while (next.length < POPULATION) {
            var a = pick(scored), b = pick(scored);
            next.push(mutate(crossover(a, b)));
        }
        population = next;
        step();
    });
}
function pick(scored) {
    var best = null;
    for (var i = 0; i < TOURNAMENT; i++) {
        var c = scored[Math.floor(rng() * scored.length)];
        if (!best || c.fit > best.fit) best = c;
    }
    return best.genome;
}

// The winner's timing IS checked, single-threaded, where wall-clock means
// something. A config that cannot decide inside a frame is not a faster
// player, it is a broken one — the guard is not dropped, it is moved to the
// only place it can be measured honestly.
function checkWinnerTiming(genome, cb) {
    var worst = 0, unsafe = 0;
    HOLDOUT_SEEDS.forEach(function (seed) {
        var r = bench.run(genome, seed, { mode: MODE, scenario: 'endless' });
        if (r.localMax > worst) worst = r.localMax;
        if (r.unsafe) unsafe++;
    });
    cb({ worstMs: worst, unsafeSeeds: unsafe });
}

function finish() {
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
    evaluateAll([best, zeroGenome()], HOLDOUT_SEEDS, function (res) {
        var learned = res[0], shipped = res[1];
        var out = {
            mode: MODE,
            objective: OBJECTIVE,
            arena: ARENA === true ? bench.ARENA : ARENA,
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
        console.log('\n=== HELD-OUT SEEDS (never trained on) ===');
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
            console.log('written to trained.' + MODE + '.json');
            pool.forEach(function (s) { s.child.kill(); });
        });
    });
}

console.log('training ' + KEYS.length + ' weights, objective=' + OBJECTIVE + ', mode=' + MODE +
            ', pop=' + POPULATION + ', gens=' + GENERATIONS + ', ' + WORKERS + ' workers');
step();
