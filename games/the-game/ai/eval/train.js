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
// THE ZERO GENOME IS ALWAYS IN THE POPULATION. At zero weights the attached
// evaluator is exactly the shipped AI (wiring.test.js law 1), so the
// shipped behaviour is a candidate in every generation and the best genome
// can never be worse than shipping nothing. That is not a safety net for
// the search, it is the definition of an honest baseline.
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

var GENERATIONS = Number(process.argv[2] || 12);
var POPULATION = Number(process.argv[3] || 20);
var MODE = process.argv[4] || 'add';
var WORKERS = Number(process.argv[5] || 4);

var TRAIN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
var HOLDOUT_SEEDS = [9, 10, 11, 12, 13, 14];
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

var pool = [], queue = [], pending = 0, onDone = null;
for (var w = 0; w < WORKERS; w++) pool.push(fork(path.join(__dirname, 'train_worker.js')));
pool.forEach(function (child) {
    child.on('message', function (msg) {
        var job = queue.find(function (j) { return j.id === msg.id; });
        if (job) job.done(msg.result);
        pending--;
        pump();
    });
});
function pump() {
    while (pending < pool.length) {
        var job = queue.find(function (j) { return !j.sent; });
        if (!job) break;
        job.sent = true;
        pending++;
        pool[pending % pool.length].send({ id: job.id, weights: job.weights, seeds: job.seeds,
                                          mode: MODE, checkTiming: false, scenario: job.scenario || 'build' });
    }
    if (!pending && queue.every(function (j) { return j.sent; }) && onDone) { var f = onDone; onDone = null; f(); }
}
var nextId = 1;
function evaluateAll(genomes, seeds, cb, scenario) {
    var results = new Array(genomes.length);
    queue = genomes.map(function (g, i) {
        return { id: nextId++, weights: g, seeds: seeds, sent: false, scenario: scenario,
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

var population = [zeroGenome()];
while (population.length < POPULATION) population.push(randomGenome());

var generation = 0;
var best = null, bestFit = -Infinity;
var t0 = Date.now();

function step() {
    evaluateAll(population, TRAIN_SEEDS, function (results) {
        var scored = population.map(function (g, i) {
            return { genome: g, fit: (results[i] && results[i].fitness) || 0, detail: results[i] };
        });
        scored.sort(function (a, b) { return b.fit - a.fit; });
        if (scored[0].fit > bestFit) { bestFit = scored[0].fit; best = scored[0].genome; }

        var zeroFit = scored.find(function (s) { return KEYS.every(function (k) { return s.genome[k] === 0; }); });
        console.log('gen ' + String(generation + 1).padStart(2) + '/' + GENERATIONS +
            '  best ' + scored[0].fit.toFixed(0) +
            '  median ' + scored[Math.floor(scored.length / 2)].fit.toFixed(0) +
            (zeroFit ? '  shipped-baseline ' + zeroFit.fit.toFixed(0) : '') +
            '  [' + ((Date.now() - t0) / 60000).toFixed(1) + 'm]');
        console.log('       ' + summarise(scored[0].genome));

        generation++;
        if (generation >= GENERATIONS) return finish();

        var next = scored.slice(0, ELITES).map(function (s) { return s.genome; });
        // the shipped baseline never leaves the population
        if (!next.some(function (g) { return KEYS.every(function (k) { return g[k] === 0; }); })) {
            next.push(zeroGenome());
        }
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
    var bench = require('./bench.js');
    var worst = 0, unsafe = 0;
    HOLDOUT_SEEDS.forEach(function (seed) {
        var r = bench.run(genome, seed, { mode: MODE });
        if (r.localMax > worst) worst = r.localMax;
        if (r.unsafe) unsafe++;
    });
    cb({ worstMs: worst, unsafeSeeds: unsafe });
}

function finish() {
    // BOTH SCENARIOS, held-out seeds, never trained on, with the shipped
    // baseline measured on the same seeds in the same process.
    //
    // Reporting one number would hide the failure this is most likely to
    // produce: a weight set that wins the drill it was trained on by
    // playing recklessly, and falls apart under pressure it never saw.
    // That is specialisation, not improvement, and a single mean cannot
    // tell the two apart. Training still uses `build` alone — siege is not
    // calibrated yet (task 26) — so its numbers here are a REPORT, not a
    // verdict, and are labelled that way.
    evaluateAll([best, zeroGenome()], HOLDOUT_SEEDS, function (res) {
        var learned = res[0], shipped = res[1];
        var out = {
            mode: MODE,
            generations: GENERATIONS,
            population: POPULATION,
            trainSeeds: TRAIN_SEEDS,
            holdoutSeeds: HOLDOUT_SEEDS,
            trainFitness: bestFit,
            holdout: { learned: learned, shipped: shipped },
            improvementPct: shipped.fitness ? ((learned.fitness - shipped.fitness) / shipped.fitness) * 100 : 0,
            weights: best
        };
        console.log('\n=== HELD-OUT SEEDS (never trained on) ===');
        console.log('build (trained on this drill)');
        console.log('  shipped ' + (shipped.fitness || 0).toFixed(0) +
                    '   learned ' + (learned.fitness || 0).toFixed(0) +
                    '   ' + (out.improvementPct >= 0 ? '+' : '') + out.improvementPct.toFixed(1) + '%');
        console.log('\nweights: ' + summarise(best));
        // The second drill: NOT trained on, so this is the transfer test.
        evaluateAll([best, zeroGenome()], HOLDOUT_SEEDS, function (siegeRes) {
        var siegeLearned = siegeRes[0], siegeShipped = siegeRes[1];
        var siegePct = siegeShipped.fitness
            ? ((siegeLearned.fitness - siegeShipped.fitness) / siegeShipped.fitness) * 100 : 0;
        out.siege = { learned: siegeLearned, shipped: siegeShipped, improvementPct: siegePct };
        console.log('siege (NOT trained on — transfer)');
        console.log('  shipped ' + (siegeShipped.fitness || 0).toFixed(0) +
                    '   learned ' + (siegeLearned.fitness || 0).toFixed(0) +
                    '   ' + (siegePct >= 0 ? '+' : '') + siegePct.toFixed(1) + '%');
        if (out.improvementPct > 3 && siegePct < -3) {
            console.log('  ^ WINS ITS OWN DRILL AND LOSES THE OTHER: specialised, not better.');
        }
        checkWinnerTiming(best, function (timing) {
            out.timing = timing;
            console.log('timing (single-threaded): worst decision ' + timing.worstMs +
                        'ms, unsafe seeds ' + timing.unsafeSeeds + '/' + HOLDOUT_SEEDS.length);
            fs.writeFileSync(path.join(__dirname, 'trained.' + MODE + '.json'), JSON.stringify(out, null, 2));
            console.log('written to trained.' + MODE + '.json');
            pool.forEach(function (c) { c.kill(); });
        });
        }, 'siege');
    });
}

console.log('training ' + KEYS.length + ' weights, mode=' + MODE + ', pop=' + POPULATION +
            ', gens=' + GENERATIONS + ', ' + WORKERS + ' workers');
step();
