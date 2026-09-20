// ONE SPELLING OF A FLAG. The workflow hands its own dispatch inputs through,
// so a switch arrives as the string 'true', and a hand-rolled === '1' reads
// that as off while the dispatch, the log and the snapshot all say it is on.
// rise is in the island fingerprint, so getting this wrong also means the
// populations are searching a different bot from the one that was asked for.

var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var path = require('path');
var switches = require('./switches.js');

var pass = 0;
function check(name, fn) { fn(); pass++; console.log('  ok  ' + name); }

check('envFlag takes both spellings, and nothing else', function () {
    ['GC_TEST_FLAG'].forEach(function (k) { delete process.env[k]; });
    assert.strictEqual(switches.envFlag('GC_TEST_FLAG'), undefined);
    process.env.GC_TEST_FLAG = '';
    assert.strictEqual(switches.envFlag('GC_TEST_FLAG'), undefined, 'empty is unset, not false');
    process.env.GC_TEST_FLAG = '1';    assert.strictEqual(switches.envFlag('GC_TEST_FLAG'), true);
    process.env.GC_TEST_FLAG = 'true'; assert.strictEqual(switches.envFlag('GC_TEST_FLAG'), true);
    process.env.GC_TEST_FLAG = '0';    assert.strictEqual(switches.envFlag('GC_TEST_FLAG'), false);
    process.env.GC_TEST_FLAG = 'false';assert.strictEqual(switches.envFlag('GC_TEST_FLAG'), false);
    delete process.env.GC_TEST_FLAG;
});

check('neither trainer hand-rolls a flag comparison', function () {
    ['train_pbt.js', 'pbt_worker.js'].forEach(function (f) {
        var src = fs.readFileSync(path.join(__dirname, f), 'utf8');
        var bad = src.match(/process\.env\.GC_[A-Z_]+ *===? *'(1|true)'/g);
        assert.strictEqual(bad, null, f + ' still compares a flag by hand: ' + bad);
    });
});

check("THE BUG: GC_RISE='true' reaches the bot as rise on", function () {
    var env = Object.assign({}, process.env, {
        GC_PBT_PLAN_ONLY: '1', GC_PBT_ISLANDS: '2', GC_VS_POPULATION: '4',
        GC_GA_SEED: '999992', GC_RISE: 'true', GC_MODES: 'true', GC_DENSITY: 'false'
    });
    var r = cp.spawnSync(process.execPath, [path.join(__dirname, 'train_pbt.js')],
                         { encoding: 'utf8', env: env });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(/switches: rise=true modes=true density=false/.test(r.stdout),
              'switches line reads: ' + (/switches:.*/.exec(r.stdout) || [''])[0]);
    fs.rmSync(path.join(__dirname, '.pbt-999992'), { recursive: true, force: true });
});

check("...and '1' still means the same thing", function () {
    var env = Object.assign({}, process.env, {
        GC_PBT_PLAN_ONLY: '1', GC_PBT_ISLANDS: '2', GC_VS_POPULATION: '4',
        GC_GA_SEED: '999993', GC_RISE: '1', GC_MODES: '1'
    });
    var r = cp.spawnSync(process.execPath, [path.join(__dirname, 'train_pbt.js')],
                         { encoding: 'utf8', env: env });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(/switches: rise=true modes=true/.test(r.stdout), r.stdout);
    fs.rmSync(path.join(__dirname, '.pbt-999993'), { recursive: true, force: true });
});

check('the workflow passes a value envFlag accepts', function () {
    var yml = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..',
                                        '.github', 'workflows', 'ai-train-pbt.yml'), 'utf8');
    var m = /GC_RISE: \$\{\{ github\.event\.inputs\.rise \|\| '([^']*)' \}\}/.exec(yml);
    assert.ok(m, 'GC_RISE is no longer taken from the rise input');
    process.env.GC_TEST_FLAG = m[1];
    assert.strictEqual(switches.envFlag('GC_TEST_FLAG'), true, 'the default reads as off');
    // and the value the dispatch actually sends
    process.env.GC_TEST_FLAG = 'true';
    assert.strictEqual(switches.envFlag('GC_TEST_FLAG'), true);
    delete process.env.GC_TEST_FLAG;
});

check('a peer fitted under different switches is not a peer', function () {
    // The held-out record is measured against the best committed champion.
    // It is picked out of the snapshot archive by feature set, and a snapshot
    // also records the switches it was fitted under.
    var src = fs.readFileSync(path.join(__dirname, 'train_pbt.js'), 'utf8');
    var fn = /function bestCommittedChampion\(\)[\s\S]*?\n}/.exec(src);
    assert.ok(fn, 'bestCommittedChampion is gone');
    ['rise', 'density', 'allowRaise', 'depth', 'beam', 'level'].forEach(function (k) {
        assert.ok(new RegExp('j\\.' + k).test(fn[0]),
                  'a peer is chosen without comparing ' + k);
    });
});

check('a peer fitted under different RULES is not a peer', function () {
    // The switches describe the run; RULES describes the decision procedure,
    // which is code. Changing what the candidate pool contains makes every
    // earlier weight set a bot that played a different game while every
    // switch still matches — which is how a run came to measure itself
    // against a bot fitted before the attack mode existed.
    var modes = require('./modes.js');
    assert.strictEqual(typeof modes.RULES, 'number', 'modes must publish a RULES version');

    var src = fs.readFileSync(path.join(__dirname, 'train_pbt.js'), 'utf8');
    var fn = /function bestCommittedChampion\(\)[\s\S]*?\n}/.exec(src);
    assert.ok(fn, 'bestCommittedChampion is gone');
    assert.ok(/j\.rules !== modes\.RULES/.test(fn[0]),
              'a peer is chosen without comparing the rules it was fitted under');

    // and every snapshot this run writes has to carry it, or the comparison
    // above silently rejects everything including its own successors.
    assert.ok(/rules: modes\.RULES/.test(src), 'the snapshot does not record RULES');
});

console.log('\n' + pass + '/' + pass + ' passed');
