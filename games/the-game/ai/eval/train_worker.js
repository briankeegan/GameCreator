// One genome, evaluated against the real engine. Forked by train.js — the
// evaluation is CPU-bound at roughly 3.5s per seed, so the only way to use
// more than one core is more than one process.
var bench = require('./bench.js');

process.on('message', function (job) {
    var r;
    try {
        r = bench.fitness(job.weights, job.seeds,
                          { mode: job.mode, checkTiming: job.checkTiming, scenario: job.scenario,
                            objective: job.objective });
    } catch (e) {
        r = { fitness: 0, error: e.message };
    }
    process.send({ id: job.id, result: r });
});
