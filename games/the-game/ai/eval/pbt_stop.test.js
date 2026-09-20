// A RUN THAT TRAINS NOTHING MUST NOT DISPATCH ANOTHER ONE. The deadline rule
// refuses to start a leg that would be killed mid-duel, and that refusal is a
// clean handover — but only if a leg was actually run. Refusing the FIRST leg
// and handing over produces a chain of runs that each cost a runner, train
// nothing and dispatch the next.
//
// Two pieces are checked here: the estimate scales with the leg size, and the
// marker the workflow reads says how many legs were done, in the shape the
// workflow's own grep matches.

var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var pass = 0;
function check(name, fn) { fn(); pass++; console.log('  ok  ' + name); }

var DIR = __dirname;
var TRAINER = path.join(DIR, 'train_pbt.js');
var MARKER = path.join(DIR, '.pbt-clean-stop');
var WORKFLOW = path.join(DIR, '..', '..', '..', '..', '.github', 'workflows', 'ai-train-pbt.yml');

function plan(env) {
    var e = Object.assign({}, process.env, { GC_PBT_PLAN_ONLY: '1' }, env);
    var r = cp.spawnSync(process.execPath, [TRAINER], { encoding: 'utf8', env: e });
    assert.strictEqual(r.status, 0, r.stderr);
    var m = /leg estimate: (\d+)s for (\d+) updates; budget leaves (\S+)s; fits: (\w+)/.exec(r.stdout);
    assert.ok(m, 'no plan line in:\n' + r.stdout);
    return { estimate: Number(m[1]), leg: Number(m[2]), fits: m[4] === 'true' };
}

var BASE = { GC_PBT_ISLANDS: '2', GC_VS_POPULATION: '4', GC_GA_SEED: '999991' };
function withLeg(leg, extra) {
    return Object.assign({}, BASE, { GC_PBT_LEG: String(leg) }, extra || {});
}

check('the estimate is per update, not per leg', function () {
    var long = plan(withLeg(250));
    var short = plan(withLeg(50));
    assert.strictEqual(long.estimate, 250 * 15);
    assert.strictEqual(short.estimate, 50 * 15);
    assert.strictEqual(long.estimate / short.estimate, 5,
        'a leg a fifth the size must be estimated a fifth as long');
});

check('250 updates reproduces the 60 minutes that was hardcoded', function () {
    // Measured: legs ran 47-52 minutes at 250 updates. The guess is
    // deliberately over that, and must not have moved when it was made to scale.
    var mins = plan(withLeg(250)).estimate / 60;
    assert.ok(mins > 52 && mins < 70, mins + ' minutes for a 250-update leg');
});

check('THE SPIN: a 50-update leg fits in a 30-minute budget', function () {
    var deadline = String(Math.floor(Date.now() / 1000) + 30 * 60);
    assert.strictEqual(plan(withLeg(50, { GC_DEADLINE: deadline })).fits, true);
    // and the leg size it was calibrated for still does not
    assert.strictEqual(plan(withLeg(250, { GC_DEADLINE: deadline })).fits, false);
});

check('an explicit guess still overrides the estimate', function () {
    assert.strictEqual(plan(withLeg(50, { GC_PBT_LEG_GUESS_MIN: '90' })).estimate, 90 * 60);
});

check('stopping before the first leg writes legs=0', function () {
    try { fs.unlinkSync(MARKER); } catch (e) { /* none */ }
    var env = Object.assign({}, process.env, withLeg(250, {
        GC_DEADLINE: String(Math.floor(Date.now() / 1000) + 60)
    }));
    var r = cp.spawnSync(process.execPath, [TRAINER], { encoding: 'utf8', env: env });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(/stopping: /.test(r.stdout), 'it did not stop:\n' + r.stdout);
    var marker = fs.readFileSync(MARKER, 'utf8');
    assert.ok(/^legs=0 /.test(marker), 'marker reads ' + JSON.stringify(marker));
    fs.unlinkSync(MARKER);
});

check('the workflow refuses exactly that marker and accepts a worked one', function () {
    var yml = fs.readFileSync(WORKFLOW, 'utf8');
    var m = /grep -q '([^']+)' "\$marker"/.exec(yml);
    assert.ok(m, 'the chain step no longer greps the marker');
    var pattern = m[1];
    function matches(text) {
        var f = path.join(DIR, '.pbt-marker-fixture');
        fs.writeFileSync(f, text);
        var r = cp.spawnSync('grep', ['-q', pattern, f]);
        fs.unlinkSync(f);
        return r.status === 0;
    }
    assert.strictEqual(matches('legs=0 at=1789929269'), true, 'a spin is not caught');
    assert.strictEqual(matches('legs=3 at=1789929269'), false, 'a handover is refused');
    assert.strictEqual(matches('legs=10 at=1789929269'), false, 'a handover is refused');
});

console.log('\n' + pass + '/' + pass + ' passed');
