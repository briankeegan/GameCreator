#!/usr/bin/env node
// RUN A BATCH OF DUELS AND HAND THE RESULTS BACK.
//
//   node duel_worker.js <jobs.json> <out.json>
//
// jobs.json is [{ a: weights, b: weights, seed }]; out.json comes back as the
// duel results in THE SAME ORDER. Order is the contract: the caller matches
// results to jobs by index, so a worker that reordered or dropped one would
// mis-attribute wins in the face-off, which is what decides whose weights
// migrate.
//
// Search options come from the environment, exactly as pbt_worker.js reads
// them, so a duel run out here cannot quietly search a different
// configuration from the islands it is judging.
var fs = require('fs');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var versus = require('./versus.js');

var jobsFile = process.argv[2];
var outFile = process.argv[3];

var OPTS = {
    depth: Number(process.env.GC_DEPTH || 1), beam: Number(process.env.GC_BEAM || 0),
    rise: process.env.GC_RISE === '1', density: process.env.GC_DENSITY === '1',
    allowRaise: process.env.GC_RAISE === '1', level: Number(process.env.GC_LEVEL || 10)
};
if (process.env.GC_DUEL_OPTS) {
    try { OPTS = JSON.parse(process.env.GC_DUEL_OPTS); } catch (e) { /* keep the env build */ }
}

var jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
var out = jobs.map(function (j) {
    return versus.duel(j.a, j.b, j.seed, OPTS);
});
fs.writeFileSync(outFile, JSON.stringify(out));
