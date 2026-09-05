// Genetic-algorithm weight search for L10 bigBlocks survival, scoped
// exactly per FINDINGS.md's guardrails: this level, this category, this
// benchmark, nothing else.
//
// Why a GA in NODE and not a Python reimplementation: this repo already
// paid for that exact mistake once (see FINDINGS.md's "misleading
// synthetic benchmark" section, and games/the-game/ai/simulate.py, which
// is a TURN-BASED proxy engine with no health, no swap-stalling, and no
// frame-driven attack timing -- none of which can be retrofitted cheaply,
// and swap-stalling is THE mechanic that governs survival at maxHealth=1,
// per panel-cpu.js's TrueSurvivalSearch comments). Training against a
// simulator that can't represent the thing you're optimizing for produces
// weights that don't transfer. This uses the REAL panel-engine.js +
// panel-cpu.js (via ga_core.js) -- zero fidelity gap, because it's the
// exact same code full_report.js validates against, just called in a
// loop instead of once.
//
// What it evolves: the named weight set SearchCpu reads from `opts`
// (dangerHeightFrac, chainWeight, comboWeight, ... -- see ga_core.js's
// WEIGHT_SPEC), the same fields TrueSurvivalSearch's rollout continuation
// policy carries from the real cpu (see _makeRolloutCpu's `carry` list in
// panel-cpu.js). These decide what candidates TSS considers and how the
// simulated rollout continuation plays out -- exactly what "hand-tuning
// one field at a time" was doing manually. This searches all of them
// jointly instead.
//
// Fitness = avg frames survived over the same 15-seed L10 bigBlocks drill
// full_report.js runs. A genome that makes any seed's worst _choose()
// call exceed a safety margin under the real ~100ms budget is rejected
// outright (fitness 0) -- an unsafe config isn't a real result, per this
// session's Object.assign lesson.
//
// Single-genome evaluation against the real engine is expensive (~3ms per
// simulated frame -- this IS the AI TrueSurvivalSearch was built to be),
// so the population is evaluated in parallel across one forked worker per
// core (see ga_worker.js) instead of sequentially in-process.
//
// Usage: node train_ga.js [populationSize] [generations] [seed] [workers]
var os = require('os');
var path = require('path');
var cp = require('child_process');
var gaCore = require('./ga_core.js');

var POP = parseInt(process.argv[2], 10) || 24;
var GENERATIONS = parseInt(process.argv[3], 10) || 30;
var RNG_SEED = parseInt(process.argv[4], 10) || 1;
var NUM_WORKERS = parseInt(process.argv[5], 10) || Math.max(1, os.cpus().length - 1);

var KEYS = gaCore.KEYS;
var WEIGHT_SPEC = gaCore.WEIGHT_SPEC;

function makeGaRng(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var gaRng = makeGaRng(RNG_SEED);
function randRange(lo, hi) { return lo + gaRng() * (hi - lo); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function randomGenome() {
  var g = {};
  KEYS.forEach(function (k) {
    var spec = WEIGHT_SPEC[k];
    var v = randRange(spec[0], spec[1]);
    g[k] = spec[2] ? Math.round(v) : v;
  });
  return g;
}

function tournamentSelect(scored) {
  var a = scored[Math.floor(gaRng() * scored.length)];
  var b = scored[Math.floor(gaRng() * scored.length)];
  return (a.fitness >= b.fitness) ? a.genome : b.genome;
}
function crossover(g1, g2) {
  var child = {};
  KEYS.forEach(function (k) { child[k] = gaRng() < 0.5 ? g1[k] : g2[k]; });
  return child;
}
function mutate(g, rate) {
  var out = {};
  KEYS.forEach(function (k) {
    var spec = WEIGHT_SPEC[k];
    var v = g[k];
    if (gaRng() < rate) {
      var span = spec[1] - spec[0];
      v = clamp(v + (gaRng() - 0.5) * span * 0.3, spec[0], spec[1]);
      if (spec[2]) v = Math.round(v);
    }
    out[k] = v;
  });
  return out;
}

// ---- worker pool ----
var workers = [];
for (var w = 0; w < NUM_WORKERS; w++) {
  workers.push(cp.fork(path.join(__dirname, 'ga_worker.js')));
}
process.on('exit', function () { workers.forEach(function (wk) { wk.kill(); }); });

function evaluatePopulation(pop) {
  return new Promise(function (resolve) {
    var chunks = workers.map(function () { return []; });
    pop.forEach(function (g, i) { chunks[i % workers.length].push(g); });
    var results = new Array(pop.length);
    var pending = workers.length;
    workers.forEach(function (wk, wi) {
      if (chunks[wi].length === 0) { pending--; if (pending === 0) resolve(results); return; }
      function onMessage(msg) {
        if (msg.type !== 'batchResult') return;
        wk.removeListener('message', onMessage);
        for (var j = 0; j < chunks[wi].length; j++) {
          results[wi + j * workers.length] = msg.results[j];
        }
        pending--;
        if (pending === 0) resolve(results);
      }
      wk.on('message', onMessage);
      wk.send({ type: 'evaluateBatch', batchId: wi, genomes: chunks[wi] });
    });
  });
}

// ---- main loop ----
async function main() {
  console.log('GA weight search: L10 bigBlocks, pop=' + POP + ' gen=' + GENERATIONS +
    ' rngSeed=' + RNG_SEED + ' workers=' + NUM_WORKERS);
  console.log('Params evolved (' + KEYS.length + '): ' + KEYS.join(', '));
  console.log('');

  var population = [gaCore.defaultGenome()];
  while (population.length < POP) population.push(randomGenome());

  var allTimeBest = null;
  var startTime = Date.now();

  for (var gen = 0; gen < GENERATIONS; gen++) {
    var results = await evaluatePopulation(population);
    var scored = population.map(function (g, i) {
      return { genome: g, fitness: results[i].fitness, unsafe: results[i].unsafe, maxTiming: results[i].maxTiming };
    });
    scored.sort(function (a, b) { return b.fitness - a.fitness; });

    if (!allTimeBest || scored[0].fitness > allTimeBest.fitness) allTimeBest = scored[0];

    var elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    var safeCount = scored.filter(function (s) { return !s.unsafe; }).length;
    console.log('gen ' + gen + '  best=' + scored[0].fitness.toFixed(0) +
      '  allTimeBest=' + allTimeBest.fitness.toFixed(0) +
      '  safe=' + safeCount + '/' + POP +
      '  maxTiming=' + scored[0].maxTiming + 'ms' +
      '  elapsed=' + elapsed + 's');

    var nextPop = [scored[0].genome, scored[1].genome, scored[2].genome];
    var mutationRate = 0.15;
    while (nextPop.length < POP) {
      nextPop.push(mutate(crossover(tournamentSelect(scored), tournamentSelect(scored)), mutationRate));
    }
    population = nextPop;
  }

  console.log('');
  console.log('=== BEST GENOME (avg frames=' + allTimeBest.fitness.toFixed(0) + ', maxTiming=' + allTimeBest.maxTiming + 'ms) ===');
  console.log(JSON.stringify(allTimeBest.genome, null, 2));
  var validateOpts = gaCore.genomeToOpts(allTimeBest.genome);
  validateOpts._tss = {};
  gaCore.STRUCTURAL_KEYS.forEach(function (k) {
    validateOpts._tss[gaCore.STRUCTURAL_TO_MODULE_FIELD[k]] = allTimeBest.genome[k];
  });
  console.log('');
  console.log('Validate with: node full_report.js \'' + JSON.stringify(validateOpts) + '\' 10 1 15000 bigBlocks 15');

  workers.forEach(function (wk) { wk.kill(); });
  process.exit(0);
}

main();
