// A RECOVERY TOOL'S BUG IS SILENT BY CONSTRUCTION: it either restores a
// population nothing will ever open, or it overwrites a live one with an
// older copy, and in both cases the run afterwards looks ordinary. So this
// tests BOTH directions — that it recovers the stranded file, and that it
// refuses the one that would lose work.
//
// The name it computes is checked against TRAIN.JS ITSELF, not against a
// restated copy of the spelling. A migrator that agrees with its own idea
// of the fingerprint and disagrees with the trainer's would put every
// population at a second wrong name — the same failure, twice.

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var mig = require('./migrate_checkpoints.js');
var pass = 0;
function check(name, fn) { fn(); pass++; console.log('  ok  ' + name); }

// Scratch beside the test, never os.tmpdir(): a child process reading an
// empty file out of the system temp dir is a failure this repo has already
// paid for once.
var DIR = fs.mkdtempSync(path.join(__dirname, '.migrate-test-'));
process.on('exit', function () { fs.rmSync(DIR, { recursive: true, force: true }); });

function trainFingerprint(env) {
    var e = Object.assign({}, process.env, env, { GC_PRINT_FINGERPRINT: '1' });
    var r = cp.execFileSync(process.execPath,
        [path.join(__dirname, 'train.js'), '100000', '200', 'replace', '4', env.GC_OBJECTIVE || 'score'],
        { env: e, encoding: 'utf8' }).trim().split('\n');
    return { fingerprint: r[0], file: r[1] };
}

function write(dir, file, fingerprint, generation) {
    fs.writeFileSync(path.join(dir, file), JSON.stringify({
        fingerprint: fingerprint, generation: generation,
        rngState: 'rng-' + generation, population: [{ w: generation }],
        finalists: [], best: { w: generation }, bestFit: generation * 10
    }));
}

// Re-spell a current fingerprint the broken way: objective INSERTED at
// index 7, and an allowRaise slot before SEEDS whether or not it is filled.
// This is the shape that stranded five runs.
function brokenSpelling(fp) {
    var p = fp.split('|');
    var objective = 'score', raise = false;
    while (p.length && (p[p.length - 1] === 'allowRaise' || /^objective=/.test(p[p.length - 1]))) {
        var t = p.pop();
        if (t === 'allowRaise') raise = true; else objective = t.slice(10);
    }
    p.splice(7, 0, objective);
    p.splice(p.length - 2, 0, raise ? 'allowRaise' : '');
    return p.join('|');
}

var BASE = { GC_LEVEL: '10', GC_GA_SEED: '11', GC_BRAIN: 'puyo' };
var CONFIGS = [
    ['score, greedy',            {}],
    ['score, depth 2 + rise',    { GC_DEPTH: '2', GC_RISE: '1' }],
    ['survival, depth 2 + rise', { GC_DEPTH: '2', GC_RISE: '1', GC_OBJECTIVE: 'survival' }],
    ['survival + density',       { GC_DEPTH: '2', GC_RISE: '1', GC_DENSITY: '1', GC_OBJECTIVE: 'survival' }],
    ['survival + raise',         { GC_DEPTH: '2', GC_RISE: '1', GC_OBJECTIVE: 'survival', GC_RAISE: '1' }]
];

CONFIGS.forEach(function (c) {
    var env = Object.assign({}, BASE, c[1]);
    var real = trainFingerprint(env);

    check('recovers a stranded ' + c[0] + ' run to the name train.js looks under', function () {
        var d = fs.mkdtempSync(path.join(DIR, 'case-'));
        var broken = brokenSpelling(real.fingerprint);
        assert.notStrictEqual(broken, real.fingerprint, 'the broken spelling must differ, or this proves nothing');
        var orphan = mig.nameFor('replace', broken);
        write(d, orphan, broken, 87);

        var entries = mig.plan(d);
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].verdict, 'migrate');
        assert.strictEqual(entries[0].target, real.file,
            'migrator and train.js must agree on the filename');
        assert.strictEqual(entries[0].fingerprint, real.fingerprint,
            'migrator and train.js must agree on the fingerprint');

        mig.apply(d, entries);
        var moved = JSON.parse(fs.readFileSync(path.join(d, real.file), 'utf8'));
        assert.strictEqual(moved.fingerprint, real.fingerprint, 'rewritten so train.js will resume it');
        assert.strictEqual(moved.generation, 87);
        assert.strictEqual(moved.rngState, 'rng-87', 'the population must arrive intact');
        assert.deepStrictEqual(moved.population, [{ w: 87 }]);
    });
});

var REAL = trainFingerprint(Object.assign({}, BASE, { GC_DEPTH: '2', GC_RISE: '1', GC_OBJECTIVE: 'survival' }));
var BROKEN = brokenSpelling(REAL.fingerprint);

check('refuses to overwrite a target that is AHEAD', function () {
    var d = fs.mkdtempSync(path.join(DIR, 'ahead-'));
    write(d, mig.nameFor('replace', BROKEN), BROKEN, 56);
    write(d, REAL.file, REAL.fingerprint, 120);
    var entries = mig.plan(d);
    var orphan = entries.filter(function (e) { return e.verdict !== 'current'; })[0];
    assert.strictEqual(orphan.verdict, 'behind');
    mig.apply(d, entries);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, REAL.file), 'utf8')).generation, 120,
        'the live run must be untouched');
});

check('refuses on a TIE — same generation is the same work', function () {
    var d = fs.mkdtempSync(path.join(DIR, 'tie-'));
    write(d, mig.nameFor('replace', BROKEN), BROKEN, 56);
    write(d, REAL.file, REAL.fingerprint, 56);
    assert.strictEqual(mig.plan(d).filter(function (e) { return e.verdict === 'migrate'; }).length, 0);
});

check('replaces a target that is BEHIND', function () {
    var d = fs.mkdtempSync(path.join(DIR, 'behind-'));
    write(d, mig.nameFor('replace', BROKEN), BROKEN, 56);
    write(d, REAL.file, REAL.fingerprint, 29);
    var entries = mig.plan(d);
    mig.apply(d, entries);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, REAL.file), 'utf8')).generation, 56);
});

check('does nothing at all to a healthy directory', function () {
    var d = fs.mkdtempSync(path.join(DIR, 'healthy-'));
    write(d, REAL.file, REAL.fingerprint, 200);
    var before = fs.readdirSync(d).slice().sort();
    var entries = mig.plan(d);
    assert.deepStrictEqual(entries.map(function (e) { return e.verdict; }), ['current']);
    mig.apply(d, entries);
    assert.deepStrictEqual(fs.readdirSync(d).sort(), before, 'a checker that fires on healthy input gets switched off');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, REAL.file), 'utf8')).generation, 200);
});

check('survives a corrupt checkpoint without touching anything else', function () {
    var d = fs.mkdtempSync(path.join(DIR, 'corrupt-'));
    fs.writeFileSync(path.join(d, '.train-checkpoint.replace.0123456789.json'), '{ truncated');
    write(d, mig.nameFor('replace', BROKEN), BROKEN, 56);
    var entries = mig.plan(d);
    assert.strictEqual(entries.filter(function (e) { return e.verdict === 'unreadable'; }).length, 1);
    assert.strictEqual(entries.filter(function (e) { return e.verdict === 'migrate'; }).length, 1);
});

check('the ORIGINAL spelling still recovers — it predates both broken ones', function () {
    var d = fs.mkdtempSync(path.join(DIR, 'orig-'));
    var plain = trainFingerprint(Object.assign({}, BASE, { GC_DEPTH: '2' }));
    // A survival run's config written in the original spelling has no way to
    // say 'survival' at all, so the case that matters is the reverse: a
    // score run's original fingerprint must still hash to where it always did.
    assert.strictEqual(mig.nameFor('replace', mig.spell(mig.parse(plain.fingerprint))), plain.file,
        'a run at every default must hash exactly as it did before either option existed');
});

console.log('\n' + pass + '/' + pass + ' passed');
