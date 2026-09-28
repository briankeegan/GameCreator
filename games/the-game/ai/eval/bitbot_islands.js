#!/usr/bin/env node
// THE ISLAND LOOP FOR BITBOT: population, duels, selection, mutation, repeat.
//
//   node bitbot_islands.js [population] [generations] [seedsPerPairing]
//
// bitbot_round.js runs ONE round and measures nothing on its own -- random
// vectors with no selection pressure are not expected to beat a hand-set one,
// and in the round that was run the hand-set control won. This is the part that
// makes a round mean something: the winners breed and the losers are replaced,
// so the population moves.
//
// FITNESS IS THE ONE BIT, WHO DIED, exactly as versus.js decides it. Garbage
// crosses, so attacking and defending are both paid for without anyone weighting
// them against each other -- which is the whole reason a duel is the fitness and
// a score is not.
//
// WHAT IS BEING SEARCHED IS THE ATTACK, NOT SURVIVAL. Survival is arithmetic in
// bitbot.js and is not a weight: the plan objective ranks by frames of life
// bought per frame spent and the weights never see it. What the weights decide is
// what the bot BUILDS toward when it is not saving itself -- which shapes, at
// what size, at what cost. So a run that produces a better island is a run that
// found a better way to attack.
//
// SEEDED, so a run can be repeated. GC_GA_SEED sets it. One run of one condition
// measures nothing and the seed is what makes the repeat possible.
var fs = require('fs');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var duels = require('./duels.js');
var BF = require('./bitfeatures.js');
var BitBot = require('./bitbot.js');

var POP = Number(process.argv[2] || 8);
var GENS = Number(process.argv[3] || 8);
var SEEDS = Number(process.argv[4] || 1);
var SHARDS = Number(process.env.GC_SHARDS || 4);

// A CEILING, BECAUSE THE BOT NOW SURVIVES. Duels ran about 1,000 frames before
// today and run 14,000 to 16,700 now, so an unbounded pairing can hold up a whole
// generation. A duel that reaches the ceiling is decided on score, which
// versus.js warns is not what that tie-break was calibrated for -- the count is
// reported every generation so a run where most pairings hit it is visible rather
// than silently meaning something else.
// NOTHING DIES ANY MORE, so a long ceiling buys nothing but wall clock. The
// fitness at the ceiling is garbage sent, and 8,000 frames is plenty to measure
// that -- 21,600 was sized when duels ended on a death at about 1,100.
var CEILING = Number(process.env.GC_VERSUS_CEILING || 8000);
var OPTS = { bot: 'bitbot', level: 10, reaction: 12, allowRaise: true, ceiling: CEILING };

var rngState = (Number(process.env.GC_GA_SEED || 20250928) >>> 0) || 1;
function rnd() { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; }
function gauss() {
    // Box-Muller, so a mutation is a nudge with occasional large jumps rather
    // than a uniform step -- most children stay near the parent and a few explore.
    var u = Math.max(1e-9, rnd()), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

var KEYS = BF.keys();
var SCALE = 100;                       // weights live in roughly [-100, 100]

function randomVector() {
    var w = {};
    for (var i = 0; i < KEYS.length; i++) w[KEYS[i]] = Math.round((rnd() * 2 - 1) * SCALE);
    return w;
}

// A CHILD IS A NUDGED PARENT. Every weight moves a little; a tenth of them move a
// lot. Copying the parent exactly wastes a slot, and re-rolling from scratch
// throws away what the parent knew.
function mutate(parent, strength) {
    var w = {};
    for (var i = 0; i < KEYS.length; i++) {
        var k = KEYS[i];
        var step = gauss() * strength * (rnd() < 0.1 ? 4 : 1);
        w[k] = Math.max(-SCALE, Math.min(SCALE, Math.round((parent[k] || 0) + step)));
    }
    return w;
}

var pop = [BitBot.STARTER];            // island 0 is the control, as in the round
for (var p = 1; p < POP; p++) pop.push(randomVector());

var history = [];

function generation(g, done) {
    var jobs = [], who = [];
    for (var a = 0; a < pop.length; a++) {
        for (var b = a + 1; b < pop.length; b++) {
            for (var s = 0; s < SEEDS; s++) {
                // A DIFFERENT SEED EACH GENERATION, so a vector cannot win by
                // fitting the handful of boards it was scored on. Same seed for
                // both sides of a pairing, always -- a duel where one side draws
                // friendlier panels measures the draw.
                jobs.push({ a: pop[a], b: pop[b], seed: 700 + g * 37 + s });
                who.push([a, b]);
            }
        }
    }

    duels.runDuels(jobs, OPTS, SHARDS, function (err, out) {
        if (err) return done(err);
        var score = [], sent = [], frames = [], chains = [], i;
        for (i = 0; i < pop.length; i++) { score[i] = 0; sent[i] = 0; frames[i] = 0; chains[i] = 0; }
        var ceilings = 0;
        for (i = 0; i < out.length; i++) {
            var d = out[i], pa = who[i][0], pb = who[i][1];
            // WHO DIED IS NO LONGER A SIGNAL, so the ceiling decides most duels.
            //
            // The bot used to die in about 1,100 frames and the fitness was one bit:
            // who topped out. It now survives 30,000, so nearly every pairing runs to
            // the ceiling and versus.decideWinner falls through to the game's SCORE --
            // a tie-break its own comment says was never calibrated for this, because
            // it pays for grinding threes.
            //
            // GARBAGE SENT IS WHAT IS BEING SEARCHED. Survival is arithmetic in
            // bitbot.js and no weight touches it; what the weights decide is the
            // attack. So a duel that ends in a death is still decided by the death --
            // dying is losing, whatever you sent -- and a duel that reaches the
            // ceiling goes to whoever sent more.
            if (d.reason === 'ceiling') {
                if (d.sent[0] > d.sent[1]) score[pa]++;
                else if (d.sent[1] > d.sent[0]) score[pb]++;
                else { score[pa] += 0.5; score[pb] += 0.5; }
            }
            else if (d.winner === 0) score[pa]++;
            else if (d.winner === 1) score[pb]++;
            else { score[pa] += 0.5; score[pb] += 0.5; }
            if (d.reason === 'ceiling') ceilings++;
            [pa, pb].forEach(function (side, z) {
                sent[side] += d.sent[z];
                frames[side] += d.frames;
                var ch = d.exact[z].chain || {};
                Object.keys(ch).forEach(function (n) { if (Number(n) >= 3) chains[side] += ch[n]; });
            });
        }

        var order = [];
        for (i = 0; i < pop.length; i++) order.push(i);
        order.sort(function (x, y) { return score[y] - score[x]; });

        // WRITTEN EVERY GENERATION, NOT ONLY AT THE END.
        //
        // A run that only delivers when it finishes delivers nothing when it is
        // cancelled or times out -- which is what happened to the first twenty,
        // an hour of runners each and not one champion between them. Every
        // generation now overwrites the same per-tag file, so the best vector so
        // far is on disk from the first one and the results are readable while the
        // run is still going.
        writeChampion(pop[order[0]], g + 1);

        var champ = order[0];
        history.push({ gen: g, champion: champ, wins: score[champ],
                       sent: sent[champ], chains: chains[champ], ceilings: ceilings });
        console.log('gen ' + String(g).padStart(2) + '  best island ' +
                    (champ === 0 ? 'CONTROL' : String(champ)) +
                    '  wins ' + String(score[champ]).padStart(4) +
                    '  sent ' + String(sent[champ]).padStart(5) +
                    '  chains3+ ' + String(chains[champ]).padStart(4) +
                    '  ceilinged ' + ceilings + '/' + out.length +
                    '  control placed ' + (order.indexOf(0) + 1) + '/' + pop.length);

        // THE TOP HALF BREEDS. The bottom half is replaced by children of the top
        // half rather than by fresh random vectors: a random vector at generation
        // 8 is a slot that starts from nothing while everything around it has
        // eight generations of selection behind it.
        var keep = Math.max(2, Math.floor(pop.length / 2));
        var next = [];
        for (i = 0; i < keep; i++) next.push(pop[order[i]]);
        // Mutation strength decays, so early generations explore and later ones
        // refine. Not calibrated -- the shape is conventional and the numbers are
        // written here rather than implied.
        var strength = 30 * (1 - 0.6 * (g / Math.max(1, GENS - 1)));
        while (next.length < pop.length) {
            next.push(mutate(next[Math.floor(rnd() * keep)], strength));
        }
        pop = next;
        done(null);
    });
}

var g = 0;
console.log('population ' + POP + ', generations ' + GENS + ', ' + SEEDS +
            ' seed(s) per pairing, ceiling ' + CEILING + ', shards ' + SHARDS);
console.log('island 0 is BitBot.STARTER, the control -- watch where it places\n');

function writeChampion(weights, gensDone) {
    var tag = process.env.GC_TAG || String(process.env.GC_GA_SEED || 'default');
    try { fs.mkdirSync(path.join(__dirname, 'islands'), { recursive: true }); } catch (e) { /* already there */ }
    var out = path.join(__dirname, 'islands', 'bitbot.island.' + tag + '.json');
    var controlWins = history.filter(function (h) { return h.champion === 0; }).length;
    fs.writeFileSync(out, JSON.stringify({ weights: weights, history: history,
                                           population: POP, generations: gensDone,
                                           generationsPlanned: GENS,
                                           controlWins: controlWins,
                                           seed: Number(process.env.GC_GA_SEED || 20250928) }, null, 2));
    return { out: out, tag: tag, controlWins: controlWins };
}

(function step() {
    if (g >= GENS) {
        var done = writeChampion(pop[0], GENS);
        console.log('\nchampion written to ' + path.basename(done.out));
        console.log('control placed: ' + history.map(function (h) { return h.champion === 0 ? 'won' : '-'; }).join(' '));
        var last = history[history.length - 1];
        console.log('FINAL tag=' + done.tag + ' controlWins=' + done.controlWins + '/' + GENS +
                    ' lastChampion=' + (last.champion === 0 ? 'CONTROL' : last.champion) +
                    ' wins=' + last.wins + ' sent=' + last.sent + ' chains=' + last.chains);
        return;
    }
    generation(g, function (err) {
        if (err) { console.error('GENERATION ' + g + ' FAILED: ' + err); process.exit(1); }
        g++;
        step();
    });
}());
