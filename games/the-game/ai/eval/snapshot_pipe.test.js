// DOES A SNAPSHOT SURVIVE THE TRIP TO main? Run: node snapshot_pipe.test.js
//
// WHY THIS EXISTS. A trainer writing trained.<mode>.json is the first of five
// steps, and the other four are commit_snapshot.sh: read the population out of
// the file, compare it against GC_MIN_POP, name it, commit it, push it. Two
// five-hour loop legs were dispatched whose every snapshot failed step two —
// GC_MIN_POP defaults to 50, a CEM population, and the loop holds 16 — and
// nothing failed, no step went red, and the first sign was that main stayed
// empty for ninety minutes.
//
// So this runs the hook for real, against a throwaway repository, on a
// snapshot with nothing in it but the fields the hook reads. It takes about a
// second and it answers the only question the ninety minutes answered.
//
// THE REPOSITORY IS A FRESH `git init` IN A SCRATCH DIR, NOT A WORKTREE. A
// worktree shares the real repository's config file, so setting an identity
// inside one rewrites the identity of the checkout. The identity here goes in
// the ENVIRONMENT, which is per-process and cannot leak.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var SCRATCH = path.join(__dirname, '.snapshot-pipe-scratch');
var HOOK = path.join(__dirname, 'commit_snapshot.sh');
var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var IDENT = {
    GIT_AUTHOR_NAME: 'pipe test', GIT_AUTHOR_EMAIL: 'pipe@test.invalid',
    GIT_COMMITTER_NAME: 'pipe test', GIT_COMMITTER_EMAIL: 'pipe@test.invalid'
};

// One throwaway repo per case, with its own copy of the hook: the hook cds to
// its own directory and commits there, so the copy IS how it is aimed.
function stage(snapshot) {
    if (fs.existsSync(SCRATCH)) fs.rmSync(SCRATCH, { recursive: true, force: true });
    fs.mkdirSync(SCRATCH, { recursive: true });
    cp.execSync('git init -q -b main', { cwd: SCRATCH });
    fs.writeFileSync(path.join(SCRATCH, '.gitignore'), '*.smoke.json\n');
    cp.execSync('git add -A && git commit -q -m base',
        { cwd: SCRATCH, env: Object.assign({}, process.env, IDENT) });
    fs.copyFileSync(HOOK, path.join(SCRATCH, 'commit_snapshot.sh'));
    fs.chmodSync(path.join(SCRATCH, 'commit_snapshot.sh'), 0o755);
    var src = path.join(SCRATCH, 'trained.' + (snapshot.mode || 'replace') + '.json');
    fs.writeFileSync(src, JSON.stringify(snapshot, null, 2));
    return src;
}

function runHook(src, gen, env) {
    var e = Object.assign({}, process.env, IDENT, env || {});
    var r = cp.spawnSync(path.join(SCRATCH, 'commit_snapshot.sh'), [src, String(gen)],
        { cwd: SCRATCH, env: e, encoding: 'utf8' });
    return {
        out: (r.stdout || '') + (r.stderr || ''),
        committed: cp.execSync('git log --oneline', { cwd: SCRATCH, encoding: 'utf8' })
            .split('\n').filter(Boolean),
        files: fs.readdirSync(SCRATCH)
    };
}

// THE CASE THAT WAS BROKEN. A head-to-head run holds 16 vectors, and the
// workflows set GC_MIN_POP to 16 to say so.
test('a 16-vector head-to-head snapshot is committed, not dropped', function () {
    var src = stage({ mode: 'pbt', population: 16, updates: 250, weights: { maxHeight: 1 } });
    var r = runHook(src, 250, { GC_MODE: 'pbt', GC_TAG: 'islands-test',
                                GC_MIN_POP: '16', GC_RUN_ID: 'testrun' });
    assert.ok(!/smoke-sized run/.test(r.out),
        'the hook called a real 16-vector run a smoke run and threw the snapshot away:\n' + r.out);
    assert.strictEqual(r.committed.length, 2,
        'the snapshot was not committed — git log still has only the base commit:\n' + r.out);
    var named = r.files.filter(function (f) { return /^trained\.pbt\.islands-test\./.test(f); });
    assert.strictEqual(named.length, 1,
        'expected one named snapshot, found: ' + JSON.stringify(r.files));
    assert.ok(/\.g00250\.json$/.test(named[0]),
        'the snapshot name does not carry the update count: ' + named[0]);
    var tracked = cp.execSync('git show --name-only --format= HEAD',
        { cwd: SCRATCH, encoding: 'utf8' });
    assert.ok(tracked.indexOf(named[0]) >= 0,
        'the commit does not contain the snapshot file:\n' + tracked);
});

// AND THE GUARD STILL GUARDS. The floor exists so a smoke run cannot be
// mistaken for a result; moving it for the loop must not have removed it.
test('a smoke-sized run is still refused at the same floor', function () {
    var src = stage({ mode: 'pbt', population: 4, updates: 10, weights: { maxHeight: 1 } });
    var r = runHook(src, 10, { GC_MODE: 'pbt', GC_TAG: 'islands-test',
                               GC_MIN_POP: '16', GC_RUN_ID: 'testrun' });
    assert.ok(/smoke-sized run/.test(r.out),
        'a 4-vector run was committed as a result:\n' + r.out);
    assert.strictEqual(r.committed.length, 1,
        'a smoke-sized run reached git log:\n' + r.out);
    assert.ok(r.files.some(function (f) { return /\.smoke\.json$/.test(f); }),
        'the refused snapshot was not kept as .smoke.json: ' + JSON.stringify(r.files));
});

// THE DEFAULT IS THE TRAP. Unset, GC_MIN_POP is 50 and a 16-vector run is
// silently discarded — which is exactly what happened. Pinned here so the
// workflows cannot quietly stop setting it.
test('without GC_MIN_POP a 16-vector run IS discarded', function () {
    var src = stage({ mode: 'versus', population: 16, updates: 200, weights: { maxHeight: 1 } });
    var r = runHook(src, 200, { GC_MODE: 'versus', GC_TAG: 'loop-test',
                                GC_RUN_ID: 'testrun', GC_MIN_POP: '' });
    assert.ok(/smoke-sized run/.test(r.out),
        'the default floor no longer discards a 16-vector run, so the workflows no ' +
        'longer need GC_MIN_POP and the check that they set it is measuring nothing:\n' + r.out);
});

// The loop's resume point rides along with the champion, or the next job
// starts a brand new search.
test("the loop's checkpoint is committed alongside the snapshot", function () {
    var src = stage({ mode: 'versus', population: 16, updates: 200, weights: { maxHeight: 1 } });
    fs.writeFileSync(path.join(SCRATCH, '.versus-checkpoint.abc1234567.json'),
        JSON.stringify({ fingerprint: 'x', updates: 200, population: [] }));
    var r = runHook(src, 200, { GC_MODE: 'versus', GC_TAG: 'loop-test',
                                GC_MIN_POP: '16', GC_RUN_ID: 'testrun' });
    var tracked = cp.execSync('git show --name-only --format= HEAD',
        { cwd: SCRATCH, encoding: 'utf8' });
    assert.ok(tracked.indexOf('.versus-checkpoint.abc1234567.json') >= 0,
        "the loop's checkpoint was not committed with the snapshot, so a later job " +
        'cannot resume the population:\n' + tracked);
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
if (fs.existsSync(SCRATCH)) fs.rmSync(SCRATCH, { recursive: true, force: true });
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
