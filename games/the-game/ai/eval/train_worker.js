// One genome, evaluated against the real engine. Forked by train.js — the
// evaluation is CPU-bound at roughly 3.5s per seed, so the only way to use
// more than one core is more than one process.
var bench = require('./bench.js');

// FORWARD THE WHOLE JOB, NEVER A HAND-WRITTEN LIST OF ITS KEYS.
//
// This used to rebuild the options object field by field — mode,
// checkTiming, scenario, arena, objective, brain — and every option added to
// train.js after that line was written silently stopped here. depth and beam
// were added for the lookahead experiment, recorded faithfully in every
// snapshot, and never reached the bot: three "depth 2" runs were greedy runs
// wearing a depth-2 label. They were caught only because they matched their
// depth-1 controls to the digit, and noise does not repeat to the last digit.
//
// The same shape as GC_GA_SEED being unreachable from the workflow, and as
// two "independent" runs finishing at 3397 at generation 360 both times. A
// knob that is declared, recorded and never delivered reads exactly like a
// knob that works.
//
// So: pass what was sent. `weights` and `seeds` are positional arguments to
// fitness and `id` is the reply tag, so those three are removed and
// everything else goes through untouched. Adding an option to train.js now
// requires nothing here, which is the point.
process.on('message', function (job) {
    var r;
    var opts = {};
    Object.keys(job).forEach(function (k) {
        if (k !== 'weights' && k !== 'seeds' && k !== 'id') opts[k] = job[k];
    });
    try {
        r = bench.fitness(job.weights, job.seeds, opts);
    } catch (e) {
        r = { fitness: 0, error: e.message };
    }
    process.send({ id: job.id, result: r });
});
