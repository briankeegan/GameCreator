#!/usr/bin/env node
// ONE ISLAND ROUND FOR BITBOT: random vectors, round-robin, garbage crossing.
//
//   node bitbot_round.js [islands] [seeds]
//
// This is the face-off the PBT trainer runs each leg, on BitBot's own feature
// set: every island duels every other on the same seeds, garbage crosses, and
// the fitness is the one bit versus.js already decides -- who died.
//
// WHY RANDOM VECTORS AND NOT A HAND-SET ONE. BitBot.STARTER is hand-set and
// hoards: eight of its twenty features count WAYS TO CLEAR, which a clear
// necessarily destroys, so realising anything costs more than it pays and the
// bot never cashes. Measured -- 175 clearing candidates offered across 39
// decisions, 0 taken, score 0. That is a property of the vector, so a round
// reporting on it would be reporting on a guess. A spread of random vectors is
// what an island starts from and is what says whether the MACHINERY can be
// searched.
//
// STARTER IS STILL ISLAND 0, as the control: a round where it wins is a round
// that has measured nothing.
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var duels = require('./duels.js');
var BF = require('./bitfeatures.js');
var BitBot = require('./bitbot.js');

var ISLANDS = Number(process.argv[2] || 6);
var SEEDS = Number(process.argv[3] || 2);
var SHARDS = Number(process.env.GC_SHARDS || 4);
var OPTS = { bot: 'bitbot', level: 10, reaction: 12,
             // A raise is a move in BitBot's pool (BITBOT.md), so the round
             // that judges the pool has to allow it.
             allowRaise: true,
             ceiling: Number(process.env.GC_VERSUS_CEILING || 10800) };

// A SEEDED GENERATOR, so a round can be repeated. One run of one condition
// measures nothing and the seed is what makes the repeat possible.
var rngState = Number(process.env.GC_ROUND_SEED || 20250927) >>> 0;
function rnd() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

var keys = BF.keys();
var vectors = [BitBot.STARTER];
for (var i = 1; i < ISLANDS; i++) {
    var w = {};
    for (var k = 0; k < keys.length; k++) w[keys[k]] = Math.round((rnd() * 2 - 1) * 100);
    vectors.push(w);
}

var jobs = [], who = [];
for (var a = 0; a < vectors.length; a++) {
    for (var b = a + 1; b < vectors.length; b++) {
        for (var s = 0; s < SEEDS; s++) {
            jobs.push({ a: vectors[a], b: vectors[b], seed: 700 + s });
            who.push([a, b]);
        }
    }
}

console.log('islands ' + vectors.length + ' (0 = STARTER), seeds ' + SEEDS +
            ', duels ' + jobs.length + ', shards ' + SHARDS);

var t0 = Date.now();
duels.runDuels(jobs, OPTS, SHARDS, function (err, out) {
    if (err) { console.error('ROUND FAILED: ' + err); process.exit(1); }

    var wins = [], frames = [], played = [], sent = [], chains = [], combos = [], payless = [];
    for (var i = 0; i < vectors.length; i++) {
        wins[i] = 0; frames[i] = 0; played[i] = 0; sent[i] = 0;
        chains[i] = 0; combos[i] = 0; payless[i] = 0;
    }
    var draws = 0, ceilings = 0;
    for (i = 0; i < out.length; i++) {
        var d = out[i], pa = who[i][0], pb = who[i][1], side = [pa, pb];
        if (d.winner === 0) wins[pa]++;
        else if (d.winner === 1) wins[pb]++;
        else { wins[pa] += 0.5; wins[pb] += 0.5; draws++; }
        if (d.reason === 'ceiling') ceilings++;
        for (var z = 0; z < 2; z++) {
            var p = side[z];
            played[p]++; frames[p] += d.frames; sent[p] += d.sent[z];
            payless[p] += d.exact[z].payless;
            var ch = d.exact[z].chain || {}, co = d.exact[z].combo || {};
            Object.keys(ch).forEach(function (n) { chains[p] += ch[n]; });
            Object.keys(co).forEach(function (n) { if (Number(n) >= 4) combos[p] += co[n]; });
        }
    }

    var order = [];
    for (i = 0; i < vectors.length; i++) order.push(i);
    order.sort(function (x, y) { return wins[y] - wins[x]; });

    console.log('\nran ' + out.length + ' duels in ' + ((Date.now() - t0) / 1000).toFixed(0) +
                's  (' + draws + ' draws, ' + ceilings + ' reached the ceiling)');
    console.log('\nisland   wins   frames/duel   sent   chains   combos4+   payless');
    for (var q = 0; q < order.length; q++) {
        var p = order[q];
        console.log('  ' + (p === 0 ? 'STARTER' : String(p) + '      ').slice(0, 7) +
                    String(wins[p]).padStart(6) +
                    String(Math.round(frames[p] / Math.max(1, played[p]))).padStart(14) +
                    String(sent[p]).padStart(7) +
                    String(chains[p]).padStart(9) +
                    String(combos[p]).padStart(11) +
                    String(payless[p]).padStart(10));
    }

    // THE ROUND'S OWN VERDICT. A round where nothing attacked has not measured
    // a bot, it has measured a bug, and saying so is the point of running it.
    var anySent = 0, anyChain = 0;
    for (i = 0; i < vectors.length; i++) { anySent += sent[i]; anyChain += chains[i]; }
    console.log('\ntotal garbage sent ' + anySent + ', total chains ' + anyChain);
    if (!anySent) console.log('NOTHING ATTACKED: no vector in this round cleared enough to send. ' +
                              'That is a finding about the pool or the features, not about the weights.');
});
