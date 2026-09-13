#!/usr/bin/env node
// THE SMOKE CHECKER, IN BOTH DIRECTIONS.
//
// It exists to stop a five-hour run starting on a broken harness, so the only
// thing that matters about it is whether it can FAIL. A checker that always
// passes is indistinguishable from a repo that is always fine — this project
// has shipped that exact thing more than once.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var dir = fs.mkdtempSync(path.join(__dirname, '.smokecheck-test-'));
var script = path.join(__dirname, 'check_smoke_run.js');
var fails = 0;

function good() {
    return {
        trainFitness: 1234,
        weights: { a: 10, b: -20, c: 30 },
        holdout: {
            learned: { fitness: 900, categories: { comboStorm: 1, factory: 1, bigBlocks: 1, endless: 1 } },
            shipped: { fitness: 600 }
        }
    };
}
function run(obj, expected) {
    var f = path.join(dir, 'snap' + Math.random().toString(36).slice(2) + '.smoke.json');
    if (obj !== null) fs.writeFileSync(f, JSON.stringify(obj));
    var args = [script, f];
    if (expected !== undefined) args.push(String(expected));
    try { cp.execFileSync(process.execPath, args, { encoding: 'utf8', stdio: 'pipe' });
          return { ok: true }; }
    catch (e) { return { ok: false, out: (e.stderr || '') + (e.stdout || '') }; }
}
function check(name, cond) {
    if (cond) { console.log('  ok    ' + name); }
    else { console.log('  FAIL  ' + name); fails++; }
}

console.log('\nTHE SMOKE-RUN CHECKER\n');

check('ACCEPTS a healthy smoke run', run(good(), 3).ok);

var r = run(null);
check('REJECTS a run that produced no snapshot at all', !r.ok && /no smoke snapshot/.test(r.out));

r = run(good(), 18);
check('REJECTS a genome that is not the size asked for', !r.ok && /expected 18/.test(r.out));

// The bar is HALF the genome, not all of it: a healthy short run legitimately
// leaves some weights at zero, and the first version of this check failed a
// real one for exactly that.
var g = good(); g.weights.c = 0;
check('ACCEPTS one weight still at zero after a short run', run(g, 3).ok);

g = good(); g.weights.b = 0; g.weights.c = 0;
r = run(g, 3);
check('REJECTS a genome where most weights never moved', !r.ok && /not getting traction/.test(r.out));

g = good(); g.trainFitness = 0;
r = run(g, 3);
check('REJECTS a run where nothing survived to score', !r.ok && /nothing survived/.test(r.out));

g = good(); delete g.holdout;
r = run(g, 3);
check('REJECTS a run with no held-out report', !r.ok && /no held-out report/.test(r.out));

g = good(); g.holdout.shipped.fitness = 0;
r = run(g, 3);
check('REJECTS a held-out comparison with a zero side', !r.ok && /not measuring anything/.test(r.out));

g = good(); delete g.holdout.learned.categories.endless;
r = run(g, 3);
check('REJECTS a report missing a scenario', !r.ok && /only 3 scenarios/.test(r.out));

// The awkward-but-correct case: a negative weight is fine, and a checker that
// treated "falsy" as "dead" would reject it.
g = good(); g.weights.a = -500;
check('ACCEPTS negative weights, which are legitimate', run(g, 3).ok);

fs.rmSync(dir, { recursive: true, force: true });
console.log('');
if (fails) { console.log('  ' + fails + ' FAILED\n'); process.exit(1); }
console.log('  all good\n');
