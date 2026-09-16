// EVERY SUITE THE TRAINING PRE-FLIGHT RUNS MUST ALSO BE A GATE.
//
// RULE. gate_all is the one list of "is this repo safe to ship", and the
// rule above it says to run it before pushing to main. That rule is worth
// nothing while gate_all is a SUBSET of what CI runs afterwards: a change
// passes locally, lands on main, and is rejected by a check that only ever
// runs on a runner -- which is the same failure the "RUN gate_all BEFORE
// PUSHING" rule was written for, wearing the other half of the costume.
//
// It happened on 2026-09-16. ai-train.yml's pre-flight runs five suites and
// gate_all ran one of them (features). The predictive deadline stop replaced
// the comparison training.test.js was grepping for; gate_all reported 46
// gates green; the next two training dispatches both died on the pre-flight
// in six minutes, and the runs they were meant to be did not happen.
//
// WHY THE PRE-FLIGHT IS THE SOURCE OF TRUTH and not gates.sh: the pre-flight
// is the list somebody decided was worth three minutes before spending five
// hours. If a suite is important enough to guard a training run it is
// important enough to guard a push to main.
//
// The check is one direction only. gate_all may hold MORE than the
// pre-flight -- it holds forty other things -- it may not hold less.

import fs from 'node:fs';

const WORKFLOW = '.github/workflows/ai-train.yml';
const GATES = '.github/scripts/gates.sh';
const STEP = 'Check the harness before spending five hours on it';

const wf = fs.readFileSync(WORKFLOW, 'utf8');
const gates = fs.readFileSync(GATES, 'utf8');

const at = wf.indexOf(STEP);
if (at === -1) {
    console.error(`no step named "${STEP}" in ${WORKFLOW}.`);
    console.error('If the pre-flight was renamed, rename STEP here too — this check ' +
                  'silently passing because it cannot find the step is the whole ' +
                  'failure mode it exists to prevent.');
    process.exit(1);
}
// The step's `run:` block, up to the next step at the same indentation.
const next = wf.indexOf('\n      - name:', at);
const block = wf.slice(at, next === -1 ? wf.length : next);

const suites = [...block.matchAll(/^\s*(?:[A-Z_]+=\S+\s+)*node\s+(\S+\.test\.js)/gm)]
    .map(m => m[1]);

if (!suites.length) {
    console.error(`found the pre-flight step but no "node <suite>.test.js" lines in it.`);
    process.exit(1);
}

const missing = suites.filter(s => !gates.includes(s));
if (missing.length) {
    console.error('These suites guard a five-hour training run but NOT a push to main:\n');
    missing.forEach(s => console.error('  ' + s));
    console.error('\nAdd a gate_* for each in ' + GATES + ' and list it in GATES, so ' +
                  'gate_all rejects what the pre-flight would reject.');
    process.exit(1);
}

console.log(`pre-flight gated OK — all ${suites.length} suites are in gate_all ` +
            `(${suites.join(', ')}).`);
