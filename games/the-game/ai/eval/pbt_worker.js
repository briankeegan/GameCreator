#!/usr/bin/env node
// ONE ISLAND, RUN FOR A FIXED NUMBER OF UPDATES, THEN HAND THE POPULATION BACK.
//
//   node pbt_worker.js <population.json> <updates> <seed>
//
// The Puyo loop exactly as train_versus.js runs it — pick two, duel, drag the
// loser 80% toward the winner, jog it — but bounded and stateless, so the
// parent can fork one of these per core and decide what happens between legs.
// Every knob comes from the environment, so an island cannot quietly search a
// different configuration from its siblings.
var fs = require('fs');
var versus = require('./versus.js');
var registry = require('./registry.js');

var file = process.argv[2];
var UPDATES = Number(process.argv[3] || 100);
var seed = (Number(process.argv[4] || 1) >>> 0) || 1;

var MERGE = Number(process.env.GC_VS_MERGE || 0.8);
var MUTATE = Number(process.env.GC_VS_MUTATE || 0.05);
var MAX_WEIGHT = 300, MIN_WEIGHT = -MAX_WEIGHT;
var EXCLUDE = (process.env.GC_EXCLUDE || '').split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);
var KEYS = registry.genomeKeys(process.env.GC_EXCLUDE, process.env.GC_INCLUDE);
var SEEDS = require('./seeds.js');
var OPTS = {
    depth: Number(process.env.GC_DEPTH || 1), beam: Number(process.env.GC_BEAM || 0),
    rise: process.env.GC_RISE === '1', density: process.env.GC_DENSITY === '1',
    allowRaise: process.env.GC_RAISE === '1', level: Number(process.env.GC_LEVEL || 10)
};

function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick(n) { return Math.floor(rng() * n); }
function clamp(v) { return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, v)); }
function merge(loser, winner) {
    var out = {};
    KEYS.forEach(function (k) {
        var v = (1 - MERGE) * (loser[k] || 0) + MERGE * (winner[k] || 0);
        out[k] = clamp(v + (rng() * 2 - 1) * MUTATE * MAX_WEIGHT);
    });
    return out;
}

var state = JSON.parse(fs.readFileSync(file, 'utf8'));
var pop = state.population;
// EACH ISLAND KEEPS ITS OWN WIN TALLY, over the duels it is already playing.
// It costs nothing and it is what picks the champion later: a bracket would
// spend fresh duels to learn what these updates already revealed.
var wins = state.wins || pop.map(function () { return 0; });
var played = state.played || pop.map(function () { return 0; });

for (var u = 0; u < UPDATES; u++) {
    var a = pick(pop.length), b = a;
    while (b === a) b = pick(pop.length);
    var sd = SEEDS.TRAIN[pick(SEEDS.TRAIN.length)];
    var d = versus.duel(pop[a], pop[b], sd, OPTS);
    played[a]++; played[b]++;
    if (d.winner !== null) {
        var w = d.winner === 0 ? a : b, l = d.winner === 0 ? b : a;
        wins[w]++;
        pop[l] = merge(pop[l], pop[w]);
        // A vector that was just overwritten is not the vector that earned
        // those wins, so its record starts again.
        wins[l] = 0; played[l] = 0;
    }
}

state.population = pop; state.wins = wins; state.played = played;
state.updates = (state.updates || 0) + UPDATES;
state.seed = seed;
fs.writeFileSync(file, JSON.stringify(state));
