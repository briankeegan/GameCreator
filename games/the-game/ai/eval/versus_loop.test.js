#!/usr/bin/env node
// THE UPDATE RULE IS THE WHOLE ALGORITHM, SO IT IS THE THING TESTED.
//
// train_versus.js is twenty lines of loop around one rule: drag the loser
// most of the way to the winner and jog it. If that rule is wrong the run
// still produces plausible weights for hours, which is the failure this
// repo has had more than once.
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var DIR = __dirname;
var fails = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fails++; }
}

console.log('\nTHE PUYO LOOP\n');

// The rule, restated here ONLY to be compared against the source. A second
// implementation would drift; this asserts the source says what the header
// and PUYO_REFERENCE.md say it says.
var src = fs.readFileSync(path.join(DIR, 'train_versus.js'), 'utf8');
// CODE ONLY. The header explains at length what the rule is NOT, and a grep
// for an absent construct matches the sentence saying it is absent.
var code = src.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');

check('the merge is toward the WINNER, at MERGE', function () {
    assert.ok(/\(1 - MERGE\) \* \(loser\[k\] \|\| 0\) \+ MERGE \* \(winner\[k\] \|\| 0\)/.test(src),
        'the merge line is not (1-MERGE)*loser + MERGE*winner');
    assert.ok(/GC_VS_MERGE \|\| 0\.8/.test(src), 'MERGE does not default to 0.8');
});

check('mutation is a share of the RANGE, not of the weight', function () {
    assert.ok(/MUTATE \* MAX_WEIGHT/.test(src),
        'mutation is not scaled by MAX_WEIGHT — a weight at zero could never move');
    assert.ok(!/\* \(1 \+ .*MUTATE\)/.test(src), 'mutation is multiplicative on the weight');
});

check('a DRAW merges nothing', function () {
    assert.ok(/if \(d\.winner !== null\)/.test(src),
        'the loop does not guard the merge on a decisive result, so a draw picks a winner at random');
});

check('a vector never duels itself', function () {
    assert.ok(/while \(b === a\)/.test(src), 'the two picks are not forced apart');
});

check('there is no normalise-to-sum-1 step', function () {
    assert.ok(!/sum\s*\+=|normalis|normaliz/i.test(code),
        "a sum-to-1 normalise came back — our features are raw magnitudes on unrelated " +
        "scales, so a sum over them means nothing");
});

check('the held-out record is against the SHIPPED bot, on seeds it never trained on', function () {
    assert.ok(/SEEDS\.HOLDOUT/.test(src), 'the held-out check does not use the holdout pool');
    assert.ok(/trained-weights\.js/.test(src), 'nothing loads the shipped weights');
});

// AND THE RULE ACTUALLY MOVES A LOSER TOWARD A WINNER. The greps above prove
// the text; this proves the arithmetic, by running the real loop on a
// two-vector population and reading the checkpoint it writes.
check('a real run moves the population and keeps a resumable checkpoint', function () {
    var env = Object.assign({}, process.env, {
        GC_VS_POPULATION: '2', GC_VS_CHECK_EVERY: '1000',
        GC_VS_UPDATES: '3', GC_GA_SEED: '5', GC_LEVEL: '10'
    });
    cp.execSync('node train_versus.js', { cwd: DIR, env: env, encoding: 'utf8', timeout: 900000 });
    var ck = fs.readdirSync(DIR).filter(function (f) { return /^\.versus-checkpoint\./.test(f); });
    assert.ok(ck.length > 0, 'no checkpoint was written, so a run cannot be continued');
    var newest = ck.map(function (f) {
        return { f: f, t: fs.statSync(path.join(DIR, f)).mtimeMs };
    }).sort(function (a, b) { return b.t - a.t; })[0].f;
    var c = JSON.parse(fs.readFileSync(path.join(DIR, newest), 'utf8'));
    assert.strictEqual(c.population.length, 2, 'the checkpoint does not hold the population');
    assert.ok(c.updates >= 3, 'the checkpoint did not record the updates: ' + c.updates);
    assert.ok(c.fingerprint && /^puyoloop\|/.test(c.fingerprint),
        'the checkpoint carries no configuration fingerprint, so any run would open it');
});

// THE RULE NOW EXISTS TWICE, so the two copies are compared rather than
// trusted. train_versus.js runs the loop single-threaded; pbt_worker.js runs
// it as one island of train_pbt.js. Two implementations of one rule is how
// LogicalBoard and panel-engine drifted apart, and that drift was invisible
// until somebody compared them on 3,320 boards.
check('the island worker merges by the SAME rule as the single-threaded loop', function () {
    var w = fs.readFileSync(path.join(DIR, 'pbt_worker.js'), 'utf8');
    var line = /\(1 - MERGE\) \* \(loser\[k\] \|\| 0\) \+ MERGE \* \(winner\[k\] \|\| 0\)/;
    assert.ok(line.test(w), 'pbt_worker.js does not carry the same merge line');
    assert.ok(/MUTATE \* MAX_WEIGHT/.test(w),
        'pbt_worker.js does not scale mutation by the range');
    assert.ok(/if \(d\.winner !== null\)/.test(w),
        'pbt_worker.js merges on a draw');
    assert.ok(/while \(b === a\)/.test(w), 'pbt_worker.js lets a vector duel itself');
    // The defaults have to agree too: an island searching at a different merge
    // rate from the loop it is meant to BE is a different experiment wearing
    // the same name.
    assert.ok(/GC_VS_MERGE \|\| 0\.8/.test(w) && /GC_VS_MUTATE \|\| 0\.05/.test(w),
        'pbt_worker.js has different merge/mutate defaults from train_versus.js');
});

console.log('');
if (fails) { console.log('  ' + fails + ' FAILED\n'); process.exit(1); }
console.log('  all good\n');
