#!/usr/bin/env node
// DOES EVERY FEATURE ACTUALLY HOOK UP — IN A REAL GAME?
//
//   node feature_liveness.js [seeds] [scenario|all]
//
// A feature can be registered, implemented, unit-tested and still do nothing,
// and every way that has happened here looked like "fine" at the time. The
// cheap version of this check lies: scoring static boards in a script said
// scoreEarned, chainLength, garbageCleared, garbageSent, garbageAdjacency and
// travelCost NEVER MOVE — and six features were nearly cut on that. They move
// fine. The script had no incoming garbage, no cursor and no live game, so it
// never gave them anything to measure.
//
// So this plays the REAL scenarios through bench.run — comboStorm, factory
// and bigBlocks all drop garbage, endless reads real attack files — and taps
// the evaluator at the seam it actually runs through, recording what each
// feature returned on every candidate the bot ever scored.
//
// A feature that never varies across a whole game cannot be learned: every
// genome sees the same value, so its weight is free to drift anywhere and the
// search wastes a dimension on it. That is a finding, not a footnote.
//
// AND VARYING ACROSS THE GAME IS NOT ENOUGH. A decision picks between the
// candidates of ONE board, so only the spread WITHIN a decision can change
// which move is played. A feature that climbs steadily all game but reads the
// same on every candidate of every decision contributes an identical term to
// all of them and cancels out of the ranking exactly as a constant does --
// while the first table below calls it "varies: yes". That is the shape
// incomingGarbage was removed for (see registry.js); nothing was checking
// whether any other feature had it. The second table is that check: for each
// feature, on what share of decisions does it separate the candidates at all,
// and by how much when it does.
var path = require('path');
var bench = require('./bench.js');
var registry = require('./registry.js');
var evaluator = require('./evaluator.js');

var SEEDS = Number(process.argv[2] || 2);
var WHICH = process.argv[3] || 'all';
// DEPTH 2 BY DEFAULT, because that is what training runs and because the
// reach* family exists only there -- PuyoCpu._value is what puts reach on the
// input, and a depth-1 bench never calls it. Run at depth 1 and all fourteen
// read a flat 0, which is indistinguishable from "not wired" and has already
// cost one feature its life.
var DEPTH = Number(process.argv[4] || process.env.GC_DEPTH || 2);
var arena = WHICH === 'all' ? bench.ARENA : [WHICH];

var live = registry.all.filter(function (f) { return typeof f.fn === 'function'; });
var seen = {};
live.forEach(function (f) { seen[f.key] = { n: 0, min: Infinity, max: -Infinity, nonZero: 0 }; });

// THE TAP GOES ON THE EVALUATOR, not on the features. Wrapping the feature
// functions would prove they can be called; wrapping evaluate() proves the
// values the BOT actually saw, through whatever path it really uses.
// THE NUMBERS A DECISION ACTUALLY RANKS. At depth 2 a candidate is not
// ranked by its own score but by _value's best-of: its own board, every child
// of it, and -- when the weights ask for reach -- a rescore of its own board
// with reach attached. So the feature vector that decides between two
// candidates is the ARGMAX evaluation inside each one's _value, not the score
// _candidates left on it. Measuring the pool's .score instead reads the whole
// reach family as flat, because reach is null during that first pass; it is
// set only inside _value. Ranking the wrong numbers is how a feature gets
// called dead while it is steering every decision.
var PuyoCpu = require('./puyocpu.js');
var within = {};
live.forEach(function (f) { within[f.key] = { decisions: 0, separated: 0, sum: 0 }; });
var recent = {};
var decisions = 0;
var pool = null;
function keyOf(x) { return (typeof x === 'number' ? x : 0).toFixed(9); }

function closePool() {
    if (!pool || pool.length < 2) { pool = null; return; }
    var lo = {}, hi = {}, i, k, v, e;
    for (i = 0; i < pool.length; i++) {
        e = pool[i];
        for (k in e) {
            if (!e.hasOwnProperty(k)) continue;
            v = e[k];
            if (typeof v !== 'number' || !isFinite(v)) continue;
            if (lo[k] === undefined || v < lo[k]) lo[k] = v;
            if (hi[k] === undefined || v > hi[k]) hi[k] = v;
        }
    }
    decisions++;
    for (k in within) {
        if (!within.hasOwnProperty(k) || lo[k] === undefined) continue;
        within[k].decisions++;
        if (hi[k] > lo[k]) { within[k].separated++; within[k].sum += hi[k] - lo[k]; }
    }
    pool = null;
}

var realValue = PuyoCpu.prototype._value;
PuyoCpu.prototype._value = function (cand) {
    recent = {};
    var v = realValue.apply(this, arguments);
    if (!pool) pool = [];
    var e = recent[keyOf(v)];
    if (e) pool.push(e);
    return v;
};
var realLookahead = PuyoCpu.prototype._lookahead;
PuyoCpu.prototype._lookahead = function () {
    pool = null;
    var out = realLookahead.apply(this, arguments);
    closePool();
    return out;
};
// Depth 1 never calls _value, and there the pool IS the candidates' own
// scores; keep that path working so the table is not silently empty.
var realCandidates = PuyoCpu.prototype._candidates;
PuyoCpu.prototype._candidates = function () {
    var cands = realCandidates.apply(this, arguments);
    if (DEPTH < 2 && cands && cands.length > 1) {
        pool = [];
        for (var i = 0; i < cands.length; i++) {
            var e = recent[keyOf(cands[i].score)];
            if (e) pool.push(e);
        }
        closePool();
    }
    return cands;
};

var realEvaluate = evaluator.evaluate;
evaluator.evaluate = function (input, weights, opts) {
    var out = realEvaluate.call(this, input, weights, opts);
    if (out && out.features) {
        for (var k in out.features) {
            var rec = seen[k];
            if (!rec) continue;
            var v = out.features[k];
            if (typeof v !== 'number' || !isFinite(v)) continue;
            rec.n++;
            if (v < rec.min) rec.min = v;
            if (v > rec.max) rec.max = v;
            if (v !== 0) rec.nonZero++;
        }
        recent[keyOf(out.score)] = out.features;
    }
    return out;
};

// Every feature weighted, so nothing is skipped for being worth zero.
var weights = {};
registry.genomeKeys('', process.env.GC_INCLUDE).forEach(function (k) { weights[k] = 1; });

var seeds = [];
for (var s = 1; s <= SEEDS; s++) seeds.push(s);
console.log('playing ' + seeds.length + ' seeds x ' + arena.length + ' scenario(s) at depth ' + DEPTH + ': ' + arena.join(', '));
arena.forEach(function (sc) {
    seeds.forEach(function (seed) {
        bench.run(weights, seed, { brain: "puyo", scenario: sc, checkTiming: false,
                                   depth: DEPTH, modes: true, rise: true });
    });
});

evaluator.evaluate = realEvaluate;
PuyoCpu.prototype._candidates = realCandidates;
PuyoCpu.prototype._value = realValue;
PuyoCpu.prototype._lookahead = realLookahead;

console.log('');
console.log('feature            | scored      | varies | non-zero | range');
var dead = [], flat = [];
live.forEach(function (f) {
    var r = seen[f.key];
    var varies = r.n > 0 && r.max > r.min;
    if (!r.n) dead.push(f.key);
    else if (!varies) flat.push(f.key);
    console.log('  ' + f.key.padEnd(17) + '| ' + String(r.n).padStart(9) + '   | ' +
                (varies ? 'yes   ' : 'NO    ') + ' | ' +
                (r.n ? String(Math.round(100 * r.nonZero / r.n)).padStart(6) + '%' : '      -') + '   | ' +
                (r.n ? r.min.toFixed(2) + ' .. ' + r.max.toFixed(2) : '-'));
});
console.log('');
if (dead.length) console.log('NEVER SCORED AT ALL (not wired): ' + dead.join(', '));
if (flat.length) console.log('SCORED BUT CONSTANT (unlearnable): ' + flat.join(', '));
if (!dead.length && !flat.length) console.log('Every feature is scored and varies — all of them are wired.');

console.log('');
console.log('CAN IT CHANGE THE CHOICE? spread among the candidates of ONE decision, over ' +
            decisions + ' decisions');
console.log('feature            | separates | mean spread when it does');
var mute = [];
live.forEach(function (f) {
    var r = within[f.key];
    if (!r.decisions) return;
    var pct = 100 * r.separated / r.decisions;
    if (pct < 5) mute.push(f.key);
    console.log('  ' + f.key.padEnd(17) + '| ' + pct.toFixed(1).padStart(7) + '%  | ' +
                (r.separated ? (r.sum / r.separated).toFixed(3) : '    -'));
});
console.log('');
if (mute.length) {
    console.log('SEPARATES THE CANDIDATES ON UNDER 5% OF DECISIONS — its weight is nearly free: ' +
                mute.join(', '));
}
// READ OFF 2 seeds x 4 scenarios, 688 decisions, depth 2: reach10combo 4.5%,
// reach6chain 0.4%, reach7chain and reach8chain 0.0% — four dimensions the
// search cannot learn. pressure and overkill also read 0.0% HERE and that
// number is about the harness, not the features: bench plays no opponent, and
// both are opponent measurements. Check those two in a duel before believing
// anything about them.
process.exit(dead.length ? 1 : 0);
