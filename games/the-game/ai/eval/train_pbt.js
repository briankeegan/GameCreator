#!/usr/bin/env node
// ISLANDS: THE PUYO LOOP ON EVERY CORE, AND THE CHAMPIONS FACE OFF.
//
//   node train_pbt.js
//
// train_versus.js is the Puyo loop, single-threaded — one duel at a time on a
// four-core runner, so three quarters of the machine sits idle. This runs one
// ISLAND per core: separate populations, each doing the same loop, each with
// its own RNG seed. Between legs the islands' champions duel each other
// directly, and an island whose champion lost adopts the winner's weights.
//
// That is Population-Based Training, and it is also exactly the thing the
// owner described: a bunch of copies doing the same thing, and the winners of
// each carrying on against each other.
//
// WHY ISLANDS RATHER THAN ONE BIGGER POOL. The 80/20 merge is aggressive —
// every loser jumps most of the way to its winner — so a single pool loses
// diversity fast and ends up searching with one vector plus mutation noise.
// Separate pools cannot collapse into each other. The cost is that a good
// discovery is stuck on its island, which is what the migration below is for.
//
// WHY CHAMPIONS DUEL RATHER THAN COMPARE HELD-OUT RECORDS. A 12-duel held-out
// record carries +/-13 points of seed noise (measured: the same weights
// against the same opponent scored 0%, 8% and 17% across blocks). Comparing
// two such records is comparing two noisy samples. A direct duel over a fixed
// seed set asks the question once, of both, on the same boards.
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var os = require('os');

var registry = require('./registry.js');
var SEEDS = require('./seeds.js');
var versus = require('./versus.js');

var ISLANDS      = Number(process.env.GC_PBT_ISLANDS || Math.max(2, Math.min(4, os.cpus().length)));
var POP          = Number(process.env.GC_VS_POPULATION || 16);
var LEG          = Number(process.env.GC_PBT_LEG || 250);      // updates per island per leg
var FACEOFF      = Number(process.env.GC_PBT_FACEOFF || 3);    // seeds per champion pairing
var MAX_WEIGHT   = 300, MIN_WEIGHT = -MAX_WEIGHT;
var MUTATE       = Number(process.env.GC_VS_MUTATE || 0.05);
// MIGRATION OFF makes this four INDEPENDENT loops sharing a runner — the
// control for "does carrying a discovery between islands help", and a way to
// use all four cores for a baseline instead of one.
var MIGRATE      = process.env.GC_PBT_MIGRATE !== '0';
var DEADLINE     = Number(process.env.GC_DEADLINE || 0);
var SNAPSHOT_HOOK = process.env.GC_SNAPSHOT_HOOK || null;

var EXCLUDE = (process.env.GC_EXCLUDE || '').split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);
var KEYS = registry.keys.filter(function (k) { return EXCLUDE.indexOf(k) < 0; });
if (!KEYS.length) throw new Error('GC_EXCLUDE excluded every feature');

var OPTS = {
    depth: Number(process.env.GC_DEPTH || 1), beam: Number(process.env.GC_BEAM || 0),
    rise: process.env.GC_RISE === '1', density: process.env.GC_DENSITY === '1',
    allowRaise: process.env.GC_RAISE === '1', level: Number(process.env.GC_LEVEL || 10)
};

var baseSeed = Number(process.env.GC_GA_SEED || 11) >>> 0;
var rngState = baseSeed;
function rng() { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; }

var DIR = path.join(__dirname, '.pbt-' + baseSeed);
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR);
function islandFile(i) { return path.join(DIR, 'island' + i + '.json'); }

function randomGenome() {
    var g = {};
    KEYS.forEach(function (k) { g[k] = rng() < 0.4 ? rng() * MAX_WEIGHT : 0; });
    return g;
}

// AN ISLAND FILE IS A RESUME POINT, and it carries a hash of the configuration
// so two runs that would search differently can never open each other's
// population. Same rule as train.js and train_versus.js; here the files are
// committed by commit_snapshot.sh, so a foreign one can actually turn up in a
// fresh checkout.
function fingerprint() {
    return ['pbt', MIGRATE ? 'migrate' : 'nomigrate', ISLANDS, POP, MUTATE, OPTS.level, baseSeed,
            String(OPTS.depth), String(OPTS.beam), OPTS.rise ? 'rise' : '',
            OPTS.density ? 'density' : '', OPTS.allowRaise ? 'allowRaise' : '',
            KEYS.join(',')].join('|');
}
var FP = fingerprint();

// EACH ISLAND GETS ITS OWN SEED, or they are one search run four times. This
// repo has already read two identical runs as a reproduction — they finished
// at the same score on the same generation because they were the same search.
var resumed = 0;
for (var i = 0; i < ISLANDS; i++) {
    if (fs.existsSync(islandFile(i))) {
        try {
            var old = JSON.parse(fs.readFileSync(islandFile(i), 'utf8'));
            if (old.fingerprint === FP && Array.isArray(old.population) &&
                old.population.length === POP) { resumed++; continue; }
            console.log('island ' + i + ' was searching something else — starting it fresh');
        } catch (e) { console.log('island ' + i + ' unreadable, starting fresh: ' + e.message); }
    }
    var pop = [];
    for (var p = 0; p < POP; p++) pop.push(randomGenome());
    fs.writeFileSync(islandFile(i), JSON.stringify({
        fingerprint: FP, population: pop, updates: 0, seed: (baseSeed + i * 7919) >>> 0,
        wins: pop.map(function () { return 0; }), played: pop.map(function () { return 0; })
    }));
}
if (resumed) console.log('resumed ' + resumed + ' of ' + ISLANDS + ' islands');

// Decide the islands and stop, without duelling. The resume decision above is
// the difference between continuing a five-hour search and silently restarting
// it, and it is the one part of this file that can be checked in milliseconds.
if (process.env.GC_PBT_INIT_ONLY === '1') {
    console.log('islands ready: ' + ISLANDS + ', resumed ' + resumed +
                (MIGRATE ? '' : ', MIGRATION OFF'));
    process.exit(0);
}

function readIsland(i) { return JSON.parse(fs.readFileSync(islandFile(i), 'utf8')); }

// THE CHAMPION IS PICKED FROM DUELS THE ISLAND ALREADY PLAYED. A bracket would
// spend fresh duels to learn what the leg just revealed; the tally is free.
// Ties and unplayed vectors fall back to index order, which is arbitrary and
// harmless — the face-off below is what actually decides anything.
function champion(state) {
    var best = 0, bestRate = -1;
    for (var j = 0; j < state.population.length; j++) {
        var n = state.played[j] || 0;
        var rate = n ? (state.wins[j] || 0) / n : 0;
        if (rate > bestRate) { bestRate = rate; best = j; }
    }
    return { index: best, weights: state.population[best], rate: bestRate };
}

// HOW FAR APART THE ISLAND STILL IS, in mean pairwise distance per weight.
// The merge is aggressive enough to collapse a pool into near-copies of one
// vector, and a collapsed island keeps reporting plausible weights while
// searching almost nothing. Free to compute, and invisible without it.
function spread(pop) {
    var tot = 0, pairs = 0;
    for (var a = 0; a < pop.length; a++) {
        for (var b = a + 1; b < pop.length; b++) {
            var d = 0;
            KEYS.forEach(function (k) { d += Math.abs((pop[a][k] || 0) - (pop[b][k] || 0)); });
            tot += d / KEYS.length; pairs++;
        }
    }
    return pairs ? tot / pairs : 0;
}

function runLeg(cb) {
    var left = ISLANDS, failed = null;
    for (var i = 0; i < ISLANDS; i++) {
        (function (i) {
            var st = readIsland(i);
            var child = cp.fork(path.join(__dirname, 'pbt_worker.js'),
                [islandFile(i), String(LEG), String(st.seed)],
                { env: process.env, silent: false });
            child.on('exit', function (code) {
                if (code !== 0) failed = 'island ' + i + ' exited ' + code;
                if (--left === 0) cb(failed);
            });
        })(i);
    }
}

// CHAMPIONS MEET ON THE SAME BOARDS. Every pairing plays the same FACEOFF
// seeds, so a champion cannot win by having drawn friendlier panels.
function faceOff(champs) {
    var score = champs.map(function () { return 0; });
    var seeds = SEEDS.TRAIN.slice(0, FACEOFF);
    for (var a = 0; a < champs.length; a++) {
        for (var b = a + 1; b < champs.length; b++) {
            seeds.forEach(function (sd) {
                var d = versus.duel(champs[a].weights, champs[b].weights, sd, OPTS);
                if (d.winner === 0) score[a]++;
                else if (d.winner === 1) score[b]++;
                else { score[a] += 0.5; score[b] += 0.5; }
            });
        }
    }
    return score;
}

// ------------------------------------------------------------- held out
var shipped = null;
try {
    require(path.join(__dirname, '..', 'trained-weights.js'));
    var t = (globalThis.PanelEval || {}).trained;
    shipped = (t && t.weights) || null;
} catch (e) { /* no shipped bot: the record is against zero weights */ }

function heldOut(genome) {
    var wins = 0, draws = 0, sentUs = 0, sentThem = 0;
    var depthUs = versus.zeroDepth(), depthThem = versus.zeroDepth();
    SEEDS.HOLDOUT.forEach(function (sd) {
        var d = versus.duel(genome, shipped || {}, sd, OPTS);
        if (d.winner === 0) wins++; else if (d.winner === null) draws++;
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

function writeSnapshot(best, report, totalUpdates, diversity) {
    var out = {
        mode: 'pbt', objective: 'versus', brain: 'puyo', level: OPTS.level,
        selection: 'champion of ' + ISLANDS + ' islands after ' + totalUpdates + ' updates',
        updates: totalUpdates, islands: ISLANDS, population: POP, leg: LEG,
        depth: OPTS.depth, beam: OPTS.beam, rise: OPTS.rise, density: OPTS.density,
        allowRaise: OPTS.allowRaise, diversity: diversity,
        features: KEYS.slice(), excluded: EXCLUDE.slice(),
        holdoutSeeds: SEEDS.HOLDOUT, holdout: report, weights: best
    };
    var file = path.join(__dirname, 'trained.pbt.json');
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log('written to trained.pbt.json');
    if (SNAPSHOT_HOOK) {
        try {
            cp.spawnSync(SNAPSHOT_HOOK, [file, String(totalUpdates)], { stdio: 'inherit' });
        } catch (e) { console.log('  (snapshot hook failed: ' + e.message + ')'); }
    }
}

console.log('PBT: ' + ISLANDS + ' islands x ' + POP + ' vectors, ' + LEG +
            ' updates a leg, ' + KEYS.length + ' features, depth ' + OPTS.depth +
            (MIGRATE ? '' : ', MIGRATION OFF'));
console.log('state in ' + path.basename(DIR));

var started = Date.now();
(function leg() {
    if (DEADLINE && Date.now() / 1000 > DEADLINE) { console.log('\nout of time'); return; }
    runLeg(function (err) {
        if (err) { console.error(err); process.exit(1); }

        var states = [], champs = [], total = 0, div = [];
        for (var i = 0; i < ISLANDS; i++) {
            var st = readIsland(i);
            states.push(st); champs.push(champion(st));
            total += st.updates; div.push(Number(spread(st.population).toFixed(1)));
        }

        var score = faceOff(champs);
        var bestI = 0;
        for (var j = 1; j < score.length; j++) if (score[j] > score[bestI]) bestI = j;

        // EXPLOIT AND EXPLORE. An island whose champion lost the face-off takes
        // the winner's weights, jogged — so a discovery escapes the island that
        // made it. It replaces that island's WORST vector, not its whole pool:
        // wiping the pool would throw away the diversity islands exist for.
        // The face-off still runs with migration off: it is what picks which
        // island's champion gets snapshotted, and it moves no weights.
        for (var i2 = 0; MIGRATE && i2 < ISLANDS; i2++) {
            if (i2 === bestI) continue;
            var st2 = states[i2];
            var worst = 0, worstRate = Infinity;
            for (var k = 0; k < st2.population.length; k++) {
                var n = st2.played[k] || 0;
                var rate = n ? (st2.wins[k] || 0) / n : 0;
                if (rate < worstRate) { worstRate = rate; worst = k; }
            }
            var copy = {};
            KEYS.forEach(function (k2) {
                var v = (champs[bestI].weights[k2] || 0) + (rng() * 2 - 1) * MUTATE * MAX_WEIGHT;
                copy[k2] = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, v));
            });
            st2.population[worst] = copy;
            st2.wins[worst] = 0; st2.played[worst] = 0;
            fs.writeFileSync(islandFile(i2), JSON.stringify(st2));
        }

        var rec = heldOut(champs[bestI].weights);
        var n2 = rec.learned.duels, w2 = Math.round(rec.learned.winRate * n2), dr = rec.learned.draws;
        console.log('updates ' + total + '  [' + ((Date.now() - started) / 60000).toFixed(1) + ' min]' +
                    '  island ' + bestI + ' wins the face-off (' + score.join('/') + ')' +
                    '   held-out ' + w2 + 'W ' + (n2 - w2 - dr) + 'L ' + dr + 'D of ' + n2 +
                    '   spread ' + div.join('/'));
        writeSnapshot(champs[bestI].weights, rec, total, div);
        leg();
    });
})();
