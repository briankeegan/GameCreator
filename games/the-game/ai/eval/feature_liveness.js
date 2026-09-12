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
var path = require('path');
var bench = require('./bench.js');
var registry = require('./registry.js');
var evaluator = require('./evaluator.js');

var SEEDS = Number(process.argv[2] || 2);
var WHICH = process.argv[3] || 'all';
var arena = WHICH === 'all' ? bench.ARENA : [WHICH];

var live = registry.all.filter(function (f) { return typeof f.fn === 'function'; });
var seen = {};
live.forEach(function (f) { seen[f.key] = { n: 0, min: Infinity, max: -Infinity, nonZero: 0 }; });

// THE TAP GOES ON THE EVALUATOR, not on the features. Wrapping the feature
// functions would prove they can be called; wrapping evaluate() proves the
// values the BOT actually saw, through whatever path it really uses.
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
    }
    return out;
};

// Every feature weighted, so nothing is skipped for being worth zero.
var weights = {};
registry.keys.forEach(function (k) { weights[k] = 1; });

var seeds = [];
for (var s = 1; s <= SEEDS; s++) seeds.push(s);
console.log('playing ' + seeds.length + ' seeds x ' + arena.length + ' scenario(s): ' + arena.join(', '));
arena.forEach(function (sc) {
    seeds.forEach(function (seed) {
        bench.run(weights, seed, { brain: 'puyo', scenario: sc, noTimingGuard: true });
    });
});

evaluator.evaluate = realEvaluate;

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
process.exit(dead.length ? 1 : 0);
