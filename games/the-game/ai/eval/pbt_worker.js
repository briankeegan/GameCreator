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
var path = require('path');
var switches = require('./switches.js');
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
    goal: process.env.GC_GOAL || undefined,
    alsoTake: process.env.GC_ALSO_TAKE ? Number(process.env.GC_ALSO_TAKE) : undefined,
    buildToward: process.env.GC_BUILD_TOWARD ? Number(process.env.GC_BUILD_TOWARD) : undefined,
    stopFloor: process.env.GC_STOP_FLOOR ? Number(process.env.GC_STOP_FLOOR) : undefined
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

// WHAT THE LEG IS DOING, WHILE IT DOES IT, AND FOR NOTHING.
//
// Every update already plays a full duel, and versus.duel already returns
// the frames, who died, what each side sent and scored, and the exact chain
// and combo histograms. The loop kept `winner` and dropped the rest, so a
// leg was silent until it ended and a snapshot was the only moment anything
// became visible.
//
// EMITTED RAW, AND NOTHING IS DERIVED. No sums across duels, no rates, no
// buckets — a line is one duel's own result, exactly as the duel reported
// it, and whoever reads it does the arithmetic. "4+ links" hides whether
// that was a 4 or a 9, and a mean hides the spread it came from.
//
// AND AS DATA, NOT PROSE. One JSON object a line, so a consumer parses it
// instead of a regex over a sentence.
//
// GC_PBT_TICK is a SAMPLE RATE, not a summary window: 1 emits every duel, 5
// emits every fifth, 0 emits none.
var TICK = Number(process.env.GC_PBT_TICK === undefined ? 1 : process.env.GC_PBT_TICK);
var ISLAND = path.basename(file, '.json');

function emit(u, sd, a, b, d) {
    console.log(JSON.stringify({
        island: ISLAND, update: u, seed: sd, pair: [a, b],
        winner: d.winner, reason: d.reason, frames: d.frames,
        sent: d.sent, scores: d.scores,
        chains: [d.exact[0].chain, d.exact[1].chain],
        combos: [d.exact[0].combo, d.exact[1].combo]
    }));
}

for (var u = 0; u < UPDATES; u++) {
    var a = pick(pop.length), b = a;
    while (b === a) b = pick(pop.length);
    var sd = SEEDS.TRAIN[pick(SEEDS.TRAIN.length)];
    var d = versus.duel(pop[a], pop[b], sd, OPTS);
    if (TICK > 0 && (u + 1) % TICK === 0) emit(u + 1, sd, a, b, d);
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
