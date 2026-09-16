// STOP BEFORE THE NEXT GENERATION, NOT AFTER THE DEADLINE.
//
// The run is given GC_DEADLINE ten minutes short of the job's own
// timeout-minutes, and checks it BETWEEN generations, because a generation
// cannot be interrupted halfway. That works while a generation is short
// relative to the margin. It fails completely when it is not:
//
//   survdens2, run #122. Crank started 03:42:53, deadline 09:22:53, job cap
//   09:28:53. Its generations run about 11.5 minutes (plan features, which
//   share one sweep at 11.5 resolves per score, at depth 2). At 09:14 it was
//   inside the deadline, so it started another generation; that generation
//   was still running at 09:28:53 and the runner cancelled the job.
//
// A cancelled job never reaches finish(), so the snapshot hook never fires,
// so the checkpoint is never committed — and the checkpoint is only
// committed at snapshots, every 30 generations. survdens2 has never
// completed 30 generations in one run. It therefore did 5h46m of work, threw
// all of it away, and the next run started at generation 0 and did the same.
// TWICE, for about twelve hours of runner time and zero generations kept,
// while every other variant progressed normally and nothing reported an
// error, because from outside a run that starts at generation 0 looks
// exactly like a run that is merely new.
//
// The fix is to ask the question that was always meant: not "am I past the
// deadline" but "would ANOTHER generation take me past it". The run already
// knows how long a generation takes — it has just timed several.
//
// SLOWEST, NOT LAST. Generations vary: a population that survives longer
// plays longer games, so a generation can be meaningfully slower than the
// one before it. The last one is a point estimate that is too low exactly
// when it matters. The slowest seen is the honest bound.
//
// MARGIN is over that bound, for the same reason. 1.15 stops a run roughly
// one short generation early, which costs nothing against a killed run
// costing every generation since the last snapshot.
var MARGIN = 1.15;

// No deadline: never stop. Nothing timed yet (the first generation has not
// finished): fall back to the old comparison, which is all there is to go
// on and is still correct the moment the deadline has genuinely passed.
function outOfTime(nowSeconds, deadline, slowestGenerationSeconds) {
    if (!deadline) return false;
    if (!slowestGenerationSeconds) return nowSeconds > deadline;
    return nowSeconds + slowestGenerationSeconds * MARGIN > deadline;
}

module.exports = { outOfTime: outOfTime, MARGIN: MARGIN };
