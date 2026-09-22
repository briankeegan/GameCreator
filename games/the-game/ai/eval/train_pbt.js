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
var crypto = require('crypto');

var registry = require('./registry.js');
var SEEDS = require('./seeds.js');
var switches = require('./switches.js');
var modes = require('./modes.js');
var versus = require('./versus.js');
var duels = require('./duels.js');

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
var KEYS = registry.genomeKeys(process.env.GC_EXCLUDE, process.env.GC_INCLUDE);
if (!KEYS.length) throw new Error('GC_EXCLUDE excluded every feature');

// ONE SPELLING OF A FLAG, EVERYWHERE. The workflow passes its own inputs
// through, so GC_RISE arrives as 'true', and a hand-rolled === '1' reads that
// as OFF while the dispatch, the log and the snapshot all say rise is on.
function flag(name) { return switches.envFlag(name) === true; }

var OPTS = {
    depth: Number(process.env.GC_DEPTH || 1), beam: Number(process.env.GC_BEAM || 0),
    rise: flag('GC_RISE'), density: flag('GC_DENSITY'),
    allowRaise: flag('GC_RAISE'), level: Number(process.env.GC_LEVEL || 10),
    // THE MODES ARE PART OF THE BOT BEING TRAINED. Without this the islands
    // fit weights for a bot with the filter off, and the champion then plays
    // a different game from the one it was scored on.
    modes: flag('GC_MODES'),
    engine: flag('GC_ENGINE'),
    goal: process.env.GC_GOAL || undefined,
    alsoTake: process.env.GC_ALSO_TAKE ? Number(process.env.GC_ALSO_TAKE) : undefined,
    buildToward: process.env.GC_BUILD_TOWARD ? Number(process.env.GC_BUILD_TOWARD) : undefined,
    stopFloor: process.env.GC_STOP_FLOOR ? Number(process.env.GC_STOP_FLOOR) : undefined
};

var baseSeed = Number(process.env.GC_GA_SEED || 11) >>> 0;
var rngState = baseSeed;
function rng() { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; }

var DIR = path.join(__dirname, '.pbt-' + baseSeed);
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR);
function islandFile(i) { return path.join(DIR, 'island' + i + '.json'); }

// A marker left by a previous run in the same checkout would make this run's
// stop look clean whatever happened, so it is cleared before ANY path that can
// exit — including GC_PBT_INIT_ONLY.
var CLEAN_STOP = path.join(__dirname, '.pbt-clean-stop');
try { fs.unlinkSync(CLEAN_STOP); } catch (e) { /* none to clear */ }

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
            OPTS.engine ? 'engine' : '',
            // THE RULES, NOT JUST THE SWITCHES. modes.RULES names the decision
            // procedure; a population fitted under one plays a different game
            // from a population fitted under the next, so they must not resume
            // each other.
            'rules' + modes.RULES,
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

// DROP A GENOME INTO EVERY POOL, ONCE, AND LET IT TAKE ITS CHANCES.
//
// inject.json (absent = this does nothing) names a weight set that each
// island adopts as ORDINARY MEMBERS: they duel, they are scored, exploit and
// explore may copy them across the island or overwrite them, and a better
// vector replaces them like any other. Nothing is pinned and nothing is held
// outside the population as a fixed opponent — the search has to be able to
// SURPASS it, which it cannot do against something that never dies.
//
// WHY A FILE AND NOT AN ENV VAR. A leg dispatches its own continuation with
// a fixed input list, so a variable set on one dispatch does not reach the
// next one; a file in the checkout reaches every leg of every chain. It is
// also the one place to look to answer "is anything being injected", and
// deleting it stops it.
//
// ONCE PER ISLAND, not once per leg. A leg re-runs this file, so re-reading
// the genome every time would reinstate it after the search had killed it —
// a fixed target wearing a member's clothes, and the island would converge
// on beating that one vector instead of playing the game. Each island
// records the hash of what it has taken and skips it thereafter.
//
// COPIES, NOT ONE. A single vector is one sample of an idea and the island
// can lose it to a bad early draw. The donor goes in as itself plus jogged
// variants, at the explore step's own scale, so the idea gets a few
// independent chances.
//
// THEY TAKE THE WORST SLOTS, by the island's own win rate, so the cost is
// the vectors the island was about to discard anyway.
//
// NOT IN THE FINGERPRINT, deliberately. The fingerprint decides whether a
// saved population may be RESUMED, and a chain with 12,000 generations
// behind it must not read its own islands as foreign and restart from random
// vectors. Nothing about how the island searches has changed; some of its
// members arrived from somewhere else, which is what migration already does.
var INJECT = path.join(__dirname, 'inject.json');
if (fs.existsSync(INJECT)) {
    var donorFile = JSON.parse(fs.readFileSync(INJECT, 'utf8'));
    var donor = donorFile.weights || donorFile;
    var copies = Math.max(1, Math.min(POP, Number(donorFile.copies) || 4));
    var seedGenome = {};
    KEYS.forEach(function (k) { seedGenome[k] = Number(donor[k]) || 0; });
    var mark = crypto.createHash('sha1')
        .update(KEYS.map(function (k) { return k + '=' + seedGenome[k]; }).join('|'))
        .digest('hex').slice(0, 12);

    // The donor itself first, then jogs of it at widening strengths — the
    // explore step's own MUTATE, and multiples of it.
    function variantOf(strength) {
        var g = {};
        KEYS.forEach(function (k) {
            var v = seedGenome[k] + (rng() * 2 - 1) * strength * MAX_WEIGHT;
            g[k] = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, v));
        });
        return g;
    }

    for (var q = 0; q < ISLANDS; q++) {
        var st = readIsland(q);
        st.injected = st.injected || [];
        if (st.injected.indexOf(mark) >= 0) continue;
        var taken = [];
        for (var c = 0; c < copies; c++) {
            var worst = -1, worstRate = Infinity;
            for (var m = 0; m < st.population.length; m++) {
                if (taken.indexOf(m) >= 0) continue;
                var pl = st.played[m] || 0;
                var rt = pl ? (st.wins[m] || 0) / pl : 0;
                if (rt < worstRate) { worstRate = rt; worst = m; }
            }
            if (worst < 0) break;
            st.population[worst] = c === 0 ? seedGenome : variantOf(MUTATE * (1 + c * 2));
            st.wins[worst] = 0;
            st.played[worst] = 0;
            taken.push(worst);
        }
        st.injected.push(mark);
        fs.writeFileSync(islandFile(q), JSON.stringify(st));
        console.log('island ' + q + ': injected ' + mark + ' into slots ' + taken.join(',') +
                    ' (1 donor + ' + (taken.length - 1) + ' jogged), as ordinary members');
    }
}

// Decide the islands and stop, without duelling. The resume decision above is
// the difference between continuing a five-hour search and silently restarting
// it, and it is the one part of this file that can be checked in milliseconds.
if (flag('GC_PBT_INIT_ONLY')) {
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
function faceOff(champs, cb) {
    var score = champs.map(function () { return 0; });
    var seeds = SEEDS.TRAIN.slice(0, FACEOFF);
    var jobs = [], who = [];
    for (var a = 0; a < champs.length; a++) {
        for (var b = a + 1; b < champs.length; b++) {
            for (var q = 0; q < seeds.length; q++) {
                jobs.push({ a: champs[a].weights, b: champs[b].weights, seed: seeds[q] });
                who.push([a, b]);
            }
        }
    }
    // Results come back at their own index, so who[i] is the pairing that
    // played jobs[i]. A short or reordered result set is an error, not a
    // tally — this is what decides which island is snapshotted.
    duels.runDuels(jobs, OPTS, ISLANDS, function (err, out) {
        if (err) return cb(err);
        for (var i = 0; i < out.length; i++) {
            var d = out[i], pa = who[i][0], pb = who[i][1];
            if (d.winner === 0) score[pa]++;
            else if (d.winner === 1) score[pb]++;
            else { score[pa] += 0.5; score[pb] += 0.5; }
        }
        cb(null, score);
    });
}

// ------------------------------------------------------------- held out
//
// NOTHING SAVED IS DUELLED. The champion is measured by what it does, not by
// what it beats: no shipped bot, no previous snapshot. A record against a
// saved weight set says as much about that set as about this champion, and
// the best-committed one moves every leg, so the figure is not even
// comparable with itself.

// The duels of one held-out set, as jobs. Kept separate from the tally so
// every set in a leg can go out in ONE fan-out rather than one per opponent.
function duelJobs(genome, opponent) {
    return SEEDS.HOLDOUT.map(function (sd) {
        return { a: genome, b: opponent || {}, seed: sd };
    });
}

function tally(out) {
    var wins = 0, draws = 0, sentUs = 0, sentThem = 0, frames = 0, longest = 0;
    var depthUs = versus.zeroDepth(), depthThem = versus.zeroDepth();
    var exactUs = versus.zeroExact();
    out.forEach(function (d) {
        if (d.winner === 0) wins++; else if (d.winner === null) draws++;
        sentUs += d.sent[0]; sentThem += d.sent[1];
        // HOW LONG THE GAMES ACTUALLY RAN. A record read without it cannot
        // tell a bot that wins long games from one whose opponent topped out
        // in the first ten seconds, and those are not the same bot.
        frames += d.frames || 0;
        if ((d.frames || 0) > longest) longest = d.frames;
        versus.addDepth(depthUs, d.chainDepth[0]);
        versus.addDepth(depthThem, d.chainDepth[1]);
        versus.addExact(exactUs, d.exact[0]);
    });
    return { wins: wins, draws: draws, n: out.length, frames: frames, longest: longest,
             sentUs: sentUs, sentThem: sentThem,
             depthUs: depthUs, depthThem: depthThem, exactUs: exactUs };
}

// WHAT THE CHAMPION DOES, NOT WHO IT BEAT. It plays the held-out seeds
// against ITSELF, and what is reported is the raw count of what fired:
// chains by link, combos by size, clears that paid nothing, garbage broken,
// how long the games ran.
//
// NO SAVED BOT ON THE OTHER SIDE. A record against a snapshot says as much
// about that snapshot as about this champion, and it moves under you — the
// peer changes every leg, so the number is not comparable with itself from
// one leg to the next. A mirror is the same bot on both sides, so the
// record is 50% by construction and carries no information; the counts
// carry all of it.
function heldOut(genome, cb) {
    duels.runDuels(duelJobs(genome, genome), OPTS, ISLANDS, function (err, res) {
        if (err) return cb(err);
        cb(null, buildReport(genome, tally(res)));
    });
}

function comboFour(combo) {
    var out = {};
    for (var k in combo) if (Number(k) > 3) out[k] = combo[k];
    return out;
}

function threeCount(combo) {
    var n = 0;
    for (var k in combo) if (Number(k) <= 3) n += combo[k];
    return n;
}

function buildReport(genome, r) {
    var n = r.n;
    return {
        avgFrames: r.frames / n, longestFrames: r.longest,
        mirror: { duels: n, avgSent: r.sentUs / n, chainDepth: r.depthUs,
                  // A COMBO IS FOUR OR MORE. Three is the minimum match, the
                  // size the engine pays nothing for -- pushGarbage fires iff
                  // isChainLink || comboSize > 3 -- so listing it as
                  // "combos 3x15" puts the floor in the same row as the
                  // payouts and makes the row unreadable. The threes are still
                  // reported, under their own name and split by what they did.
                  comboBySize: comboFour(r.exactUs.combo),
                  threes: threeCount(r.exactUs.combo),
                  chainByLinks: r.exactUs.chain,
                  paylessClears: r.exactUs.payless,
                  // Threes that OPENED a chain, held apart from the ones that
                  // cleared alone. Without it a rise in payless cannot be told
                  // from a rise in chain building, because a chain starts with
                  // exactly the match that used to be counted against it.
                  openedChain: r.exactUs.openedChain,
                  brokeGarbage: r.exactUs.broke }
    };
}

function writeSnapshot(best, report, totalUpdates, diversity) {
    var out = {
        mode: 'pbt', objective: 'versus', brain: 'puyo', level: OPTS.level,
        selection: 'champion of ' + ISLANDS + ' islands after ' + totalUpdates + ' updates',
        updates: totalUpdates, islands: ISLANDS, population: POP, leg: LEG,
        depth: OPTS.depth, beam: OPTS.beam, rise: OPTS.rise, density: OPTS.density,
        allowRaise: OPTS.allowRaise, engine: OPTS.engine,
        diversity: diversity, rules: modes.RULES,
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

// A LEG IS NOT INTERRUPTIBLE, so the question is never "is there time left" but
// "is there time for ANOTHER ONE". Stopping only once the deadline has passed
// starts a leg that runs past the job's own timeout and is killed mid-duel,
// losing everything since the last snapshot. Measured here: legs run 47-52
// minutes, against the 20 the first deadline was set for.
//
// The first leg has nothing measured yet, so it uses a deliberately pessimistic
// guess; after that the last leg's own duration decides, with a fifth added
// because legs lengthen as the populations converge.
// THE GUESS IS PER UPDATE, NOT PER LEG. Legs measured 47-52 minutes at 250
// updates, so 15 seconds an update reproduces the 60 that was hardcoded for
// that size and scales to any other. A flat per-leg number refuses to start a
// leg a fifth as long, and stopping before the first leg is still a clean
// stop, so the chain re-dispatches and spins without training.
// AND THE ENGINE PATH IS NOT THE SAME UPDATE. Resolving candidates on a real
// Stack costs 3.6x LogicalBoard on identical candidates, measured after
// idleSkip. 60 seconds an update is that with room over it. The 150 this
// carried before was calibrated when the engine path was ten times slower,
// and a guess that large refuses to start a leg inside a short job — which
// is how the jobs grew to five hours and snapshots stopped being frequent.
var GUESS_PER_UPDATE = Number(process.env.GC_PBT_UPDATE_GUESS_SEC ||
                              (process.env.GC_ENGINE && flag('GC_ENGINE') ? 60 : 15));
var FIRST_LEG_GUESS = process.env.GC_PBT_LEG_GUESS_MIN
    ? Number(process.env.GC_PBT_LEG_GUESS_MIN) * 60
    : LEG * GUESS_PER_UPDATE;
var lastLeg = null;
var legsDone = 0;
function timeForAnotherLeg() {
    if (!DEADLINE) return true;
    var need = (lastLeg === null ? FIRST_LEG_GUESS : lastLeg * 1.2);
    var left = DEADLINE - Date.now() / 1000;
    if (left >= need) return true;
    console.log('\nstopping: ' + Math.round(left / 60) + ' min left and a leg needs about ' +
                Math.round(need / 60) + '. Starting one would be killed mid-duel.');
    // SAY SO WHERE THE WORKFLOW CAN SEE IT. Stopping here is a clean handover,
    // however early in the budget it happens — one long leg can end the run at
    // half the deadline. The chain step refuses to continue a run that exited
    // early, because that is what a crash loop looks like, and without this it
    // cannot tell the two apart. It killed islands-d2-c for being 7 minutes
    // under the floor after a single 158-minute leg.
    // THE LEG COUNT GOES IN THE MARKER. A clean stop after work done is a
    // handover; a clean stop before the first leg is a run that changed
    // nothing, and continuing it dispatches a run that will do the same.
    try { fs.writeFileSync(CLEAN_STOP, 'legs=' + legsDone + ' at=' + Date.now()); }
    catch (e) { console.log('  (could not mark the clean stop: ' + e.message + ')'); }
    return false;
}

// WHAT THE RULE WOULD DECIDE, WITHOUT SPENDING A RUNNER TO FIND OUT. The
// estimate is the only thing standing between a deadline and a run that does
// nothing, so it is answerable from a shell and from a test.
if (process.env.GC_PBT_PLAN_ONLY) {
    var planLeft = DEADLINE ? Math.round(DEADLINE - Date.now() / 1000) : Infinity;
    console.log('leg estimate: ' + Math.round(FIRST_LEG_GUESS) + 's for ' + LEG +
                ' updates; budget leaves ' + planLeft + 's; fits: ' +
                (planLeft >= FIRST_LEG_GUESS));
    console.log('switches: rise=' + OPTS.rise + ' modes=' + OPTS.modes +
                ' density=' + OPTS.density + ' depth=' + OPTS.depth +
                ' engine=' + OPTS.engine);
    process.exit(0);
}

(function leg() {
    if (!timeForAnotherLeg()) return;
    var legStarted = Date.now();
    runLeg(function (err) {
        if (err) { console.error(err); process.exit(1); }

        var states = [], champs = [], total = 0, div = [];
        for (var i = 0; i < ISLANDS; i++) {
            var st = readIsland(i);
            states.push(st); champs.push(champion(st));
            total += st.updates; div.push(Number(spread(st.population).toFixed(1)));
        }

        faceOff(champs, function (foErr, score) {
        if (foErr) { console.error(foErr); process.exit(1); }
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

        heldOut(champs[bestI].weights, function (hoErr, rec) {
        if (hoErr) { console.error(hoErr); process.exit(1); }
        // WHAT IT FIRED, not what it beat. Chains by link and combos by
        // size, straight from the engine's own match events.
        var m = rec.mirror;
        function hist(o) {
            var k = Object.keys(o).sort(function (a, b) { return a - b; });
            return k.length ? k.map(function (x) { return x + 'x' + o[x]; }).join(' ') : 'none';
        }
        console.log('updates ' + total + '  [' + ((Date.now() - started) / 60000).toFixed(1) + ' min]' +
                    '  island ' + bestI + ' wins the face-off (' + score.join('/') + ')' +
                    '   chains ' + hist(m.chainByLinks) + '   combos ' + hist(m.comboBySize) +
                    '   threes ' + m.threes + ' (payless ' + m.paylessClears +
                    ', opened ' + m.openedChain + ')   broke ' + m.brokeGarbage +
                    '   avg ' + Math.round(rec.avgFrames / 60) + 's' +
                    '   spread ' + div.join('/'));
        writeSnapshot(champs[bestI].weights, rec, total, div);
        lastLeg = (Date.now() - legStarted) / 1000;
        legsDone++;
        leg();
        });
        });
    });
})();
