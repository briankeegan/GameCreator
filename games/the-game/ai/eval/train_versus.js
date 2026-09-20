#!/usr/bin/env node
// THE PUYO TRAINER, FOR THIS GAME.
//
//   node train_versus.js            # runs until the deadline or forever
//
// meatfighter's Trainer.java, which is what PUYO_REFERENCE.md documents:
//
//     keep 16 weight vectors
//     pick two at random, play ONE duel
//     loser[i] = 0.2 * loser[i] + 0.8 * winner[i]
//     mutate the loser by +/-5%
//     repeat, forever
//
// WHY THIS EXISTS BESIDE train.js. train.js is cross-entropy method: score
// every genome, rank them, fit a mean and sigma to the elite, resample. CEM
// needs a SCALAR to rank by. A duel yields one BIT. Under `versus` train.js
// manufactures a scalar by playing three duels and counting wins — seven
// possible values out of three bits — and pays 150 duels per update for a
// ranking signal this loop does not need at all.
//
// Measured on the same hardware: a CEM generation at population 50 is ~3
// minutes; one update here is one duel, ~5 seconds. In the time CEM makes one
// update this makes roughly forty.
//
// CEM is not wrong — it is right for `score`, where every genome has a real
// number. It is the wrong shape for head-to-head.
//
// THREE THINGS DO NOT PORT, and each is a real difference rather than a
// simplification:
//
//   1. NO NORMALISING TO SUM 1. Puyo's seven features are all 0-1, so a
//      weight there IS a share of the decision and the sum is meaningful.
//      Ours are raw magnitudes on unrelated scales — maxHeight is ~12, links
//      ~40, garbageSent is a cell count — so a sum means nothing. Clamped to
//      [MIN_WEIGHT, MAX_WEIGHT] instead, as train.js does.
//
//   2. MUTATION IS +/-5% OF THE RANGE, NOT OF THE WEIGHT. w * 1.05 cannot
//      move a weight that is at zero, and a fresh genome starts most of them
//      there. Puyo never meets this because normalising keeps every weight
//      non-zero.
//
//   3. A HELD-OUT RECORD AGAINST THE SHIPPED BOT. Puyo's population only
//      ever plays itself, which is how a bot that beats its siblings and
//      loses to everything else looks like progress. Every CHECK_EVERY
//      updates the current best duels the shipped weights on seeds nothing
//      trained on, and that record is what a snapshot reports.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var registry = require('./registry.js');
var SEEDS = require('./seeds.js');
var versus = require('./versus.js');

var POPULATION   = Number(process.env.GC_VS_POPULATION || 16);
var MERGE        = Number(process.env.GC_VS_MERGE || 0.8);   // toward the winner
var MUTATE       = Number(process.env.GC_VS_MUTATE || 0.05); // of the RANGE
var CHECK_EVERY  = Number(process.env.GC_VS_CHECK_EVERY || 200);
var MAX_UPDATES  = Number(process.env.GC_VS_UPDATES || 0);   // 0 = until the deadline
var MAX_WEIGHT   = 300;
var MIN_WEIGHT   = -MAX_WEIGHT;

var DEPTH   = Number(process.env.GC_DEPTH || 1);
var BEAM    = Number(process.env.GC_BEAM || 0);
var RISE    = process.env.GC_RISE === '1';
var DENSITY = process.env.GC_DENSITY === '1';
var ALLOW_RAISE = process.env.GC_RAISE === '1';
var LEVEL   = Number(process.env.GC_LEVEL || 10);
var VARIANT = process.env.GC_VARIANT || '';
var EXCLUDE = (process.env.GC_EXCLUDE || '').split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);
var KEYS = registry.genomeKeys(process.env.GC_EXCLUDE, process.env.GC_INCLUDE);
if (!KEYS.length) throw new Error('GC_EXCLUDE excluded every feature');

var DEADLINE = Number(process.env.GC_DEADLINE || 0);   // unix seconds, 0 = none
var SNAPSHOT_HOOK = process.env.GC_SNAPSHOT_HOOK || null;

// ---------------------------------------------------------------- rng
// Seeded, because "two runs of the same config" has to mean something.
var seed = Number(process.env.GC_GA_SEED || 11) >>> 0;
function rng() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}
function pick(n) { return Math.floor(rng() * n); }

// ------------------------------------------------------- the population
function randomGenome() {
    var g = {};
    // Same shape train.js starts from: most weights at zero, a minority live.
    // registry.sign is the STARTING GUESS for the live ones — the merge and
    // the mutation are free to walk any of them through zero from there.
    KEYS.forEach(function (k) {
        g[k] = rng() < 0.4 ? rng() * MAX_WEIGHT : 0;
    });
    return g;
}
function clamp(v) { return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, v)); }

// THE WHOLE UPDATE RULE, and it is the reason this file exists.
function merge(loser, winner) {
    var out = {};
    KEYS.forEach(function (k) {
        var v = (1 - MERGE) * (loser[k] || 0) + MERGE * (winner[k] || 0);
        // +/- MUTATE of the RANGE, not of the value: see (2) in the header.
        v += (rng() * 2 - 1) * MUTATE * MAX_WEIGHT;
        out[k] = clamp(v);
    });
    return out;
}

var OPTS = { depth: DEPTH, beam: BEAM, rise: RISE, density: DENSITY,
             allowRaise: ALLOW_RAISE, level: LEVEL };

// ------------------------------------------------------------- held out
var shipped = null;
try {
    require(path.join(__dirname, '..', 'trained-weights.js'));
    var t = (globalThis.PanelEval || {}).trained;
    shipped = (t && t.weights) || null;
} catch (e) { /* no shipped bot yet: the record is against zero weights */ }

function heldOut(genome) {
    var wins = 0, draws = 0, sentUs = 0, sentThem = 0;
    var depthUs = versus.zeroDepth(), depthThem = versus.zeroDepth();
    SEEDS.HOLDOUT.forEach(function (sd) {
        var d = versus.duel(genome, shipped || {}, sd, OPTS);
        if (d.winner === 0) wins++;
        else if (d.winner === null) draws++;
        sentUs += d.sent[0]; sentThem += d.sent[1];
        versus.addDepth(depthUs, d.chainDepth[0]);
        versus.addDepth(depthThem, d.chainDepth[1]);
    });
    var n = SEEDS.HOLDOUT.length;
    return {
        learned: { fitness: (wins + 0.5 * draws) / n, winRate: wins / n, draws: draws,
                   avgSent: sentUs / n, duels: n, chainDepth: depthUs, versus: true },
        shipped: { fitness: (n - wins - draws + 0.5 * draws) / n,
                   label: shipped ? 'shipped weights' : 'zero weights',
                   avgSent: sentThem / n, chainDepth: depthThem, versus: true }
    };
}

// ---------------------------------------------------------- checkpoint
// Same rule as train.js: the filename is a hash of the configuration, so two
// runs that would search differently can never open each other's population.
function fingerprint() {
    return ['puyoloop', POPULATION, MERGE, MUTATE, LEVEL, process.env.GC_GA_SEED || '',
            String(DEPTH), String(BEAM), RISE ? 'rise' : '', DENSITY ? 'density' : '',
            ALLOW_RAISE ? 'allowRaise' : '', KEYS.join(',')].join('|');
}
var FP = fingerprint();
var CHECKPOINT = path.join(__dirname, '.versus-checkpoint.' +
    crypto.createHash('sha1').update(FP).digest('hex').slice(0, 10) + '.json');

var population = [], updates = 0;
if (fs.existsSync(CHECKPOINT)) {
    try {
        var ck = JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8'));
        if (ck.fingerprint === FP && Array.isArray(ck.population)) {
            population = ck.population; updates = ck.updates || 0;
            console.log('resumed at update ' + updates + ' from ' + path.basename(CHECKPOINT));
        }
    } catch (e) { console.log('checkpoint unreadable, starting fresh: ' + e.message); }
}
while (population.length < POPULATION) population.push(randomGenome());

function saveCheckpoint() {
    fs.writeFileSync(CHECKPOINT, JSON.stringify(
        { fingerprint: FP, updates: updates, population: population }));
}

function writeSnapshot(best, report) {
    var out = {
        mode: 'versus-loop', objective: 'versus', brain: 'puyo', level: LEVEL,
        selection: 'best of ' + POPULATION + ' after ' + updates + ' updates, by held-out record',
        updates: updates, population: POPULATION, merge: MERGE, mutate: MUTATE,
        depth: DEPTH, beam: BEAM, rise: RISE, density: DENSITY, allowRaise: ALLOW_RAISE,
        features: KEYS.slice(), excluded: EXCLUDE.slice(),
        holdoutSeeds: SEEDS.HOLDOUT, holdout: report, weights: best
    };
    var file = path.join(__dirname, 'trained.versus.json');
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log('written to trained.versus.json');
    if (SNAPSHOT_HOOK) {
        try {
            require('child_process').spawnSync(SNAPSHOT_HOOK, [file, String(updates)],
                { stdio: 'inherit' });
        } catch (e) { console.log('  (snapshot hook failed: ' + e.message + ')'); }
    }
}

// ------------------------------------------------------------- the loop
console.log('PUYO LOOP: ' + POPULATION + ' vectors, merge ' + MERGE + ', mutate +/-' +
            (MUTATE * 100) + '% of range, ' + KEYS.length + ' features, depth ' + DEPTH);
console.log('checkpoint ' + path.basename(CHECKPOINT));

var bestSeen = null, bestRecord = null, started = Date.now();
for (;;) {
    if (MAX_UPDATES && updates >= MAX_UPDATES) break;
    if (DEADLINE && Date.now() / 1000 > DEADLINE) {
        console.log('\nout of time at update ' + updates);
        break;
    }

    // PICK TWO, NEVER THE SAME ONE. A mirror match is a guaranteed draw and
    // would merge a vector with itself, which is a no-op plus a mutation.
    var a = pick(POPULATION), b = a;
    while (b === a) b = pick(POPULATION);
    var sd = SEEDS.TRAIN[pick(SEEDS.TRAIN.length)];

    var d = versus.duel(population[a], population[b], sd, OPTS);
    updates++;

    // A DRAW TEACHES NOTHING HERE. Puyo's trainer only ever has a loser
    // because its game cannot draw; ours can (the ceiling, or both topping
    // out on one frame), and merging on a draw would pick a winner at random.
    if (d.winner !== null) {
        var win = d.winner === 0 ? a : b;
        var lose = d.winner === 0 ? b : a;
        population[lose] = merge(population[lose], population[win]);
    }

    if (updates % CHECK_EVERY === 0) {
        // WHICH VECTOR IS BEST is not knowable from the pairwise history —
        // nothing keeps a score — so the held-out record decides, on seeds
        // nothing trained on.
        var bestI = 0, bestFit = -1, rec = null;
        for (var i = 0; i < POPULATION; i++) {
            var r = heldOut(population[i]);
            if (r.learned.fitness > bestFit) { bestFit = r.learned.fitness; bestI = i; rec = r; }
        }
        bestSeen = population[bestI]; bestRecord = rec;
        var n = rec.learned.duels, w = Math.round(rec.learned.winRate * n), dr = rec.learned.draws;
        var mins = ((Date.now() - started) / 60000).toFixed(1);
        console.log('update ' + updates + '  [' + mins + ' min]  best of ' + POPULATION +
                    ': ' + w + 'W ' + (n - w - dr) + 'L ' + dr + 'D of ' + n +
                    '   win rate ' + Math.round(rec.learned.winRate * 100) + '%' +
                    '   sent ' + rec.learned.avgSent.toFixed(1) +
                    ' vs ' + rec.shipped.avgSent.toFixed(1));
        writeSnapshot(bestSeen, bestRecord);
        saveCheckpoint();
    }
}

if (bestSeen) { writeSnapshot(bestSeen, bestRecord); }
saveCheckpoint();
console.log('stopped at update ' + updates);
