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
// REMOVING A GIT REPOSITORY RACES GIT. `git commit` can start `gc --auto` in
// the background, which writes into .git while this is deleting it, and rmSync
// then fails with ENOTEMPTY. gc is turned off in the scratch repo below, and
// this retries anyway — cleanup is not what the suite is checking, and it must
// never be able to fail a five-hour run from a pre-flight step.
function scrub(dir) {
    for (var i = 0; i < 5; i++) {
        try {
            if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
            return;
        } catch (e) { /* try again */ }
    }
}

function stage(snapshot) {
    scrub(SCRATCH);
    fs.mkdirSync(SCRATCH, { recursive: true });
    cp.execSync('git init -q -b main', { cwd: SCRATCH });
    cp.execSync('git config gc.auto 0 && git config gc.autoDetach false', { cwd: SCRATCH });
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

// The islands keep one file per island; all of them together are the resume
// point, so all of them have to ride along with the champion.
//
// THE DIRECTORY IS THE RUN'S TAG. Keyed by ga_seed instead, two variants
// dispatched on one seed share a population and quietly overwrite each
// other, which is what default and r17 did on seed 317 for a day.
test("the islands' state is committed alongside the snapshot", function () {
    var src = stage({ mode: 'pbt', population: 16, updates: 250, weights: { maxHeight: 1 } });
    var dir = '.islands-test';
    fs.mkdirSync(path.join(SCRATCH, dir));
    ['island0.json', 'island1.json'].forEach(function (f) {
        fs.writeFileSync(path.join(SCRATCH, dir, f),
            JSON.stringify({ fingerprint: 'x', population: [], updates: 250 }));
    });
    var r = runHook(src, 250, { GC_MODE: 'pbt', GC_TAG: 'islands-test',
                                GC_MIN_POP: '16', GC_RUN_ID: 'testrun' });
    var tracked = cp.execSync('git show --name-only --format= HEAD',
        { cwd: SCRATCH, encoding: 'utf8' });
    ['island0.json', 'island1.json'].forEach(function (f) {
        assert.ok(tracked.indexOf(dir + '/' + f) >= 0,
            dir + '/' + f + ' was not committed, so a later job restarts the search ' +
            'from random weights:\n' + tracked);
    });
});

// AND ONLY ITS OWN. The hook used to glob every .pbt-*/ in the checkout, so a
// run committed its siblings' island files as well -- a stale copy landing
// back over a newer one, which is the same clobbering the per-tag directory
// exists to stop, arriving by a different door.
test("a run commits ITS islands and not another run's", function () {
    var src = stage({ mode: 'pbt', population: 16, updates: 250, weights: { maxHeight: 1 } });
    fs.mkdirSync(path.join(SCRATCH, '.islands-mine'));
    fs.writeFileSync(path.join(SCRATCH, '.islands-mine', 'island0.json'),
        JSON.stringify({ fingerprint: 'x', population: [], updates: 250 }));
    fs.mkdirSync(path.join(SCRATCH, '.islands-theirs'));
    fs.writeFileSync(path.join(SCRATCH, '.islands-theirs', 'island0.json'),
        JSON.stringify({ fingerprint: 'y', population: [], updates: 999 }));
    runHook(src, 250, { GC_MODE: 'pbt', GC_TAG: 'islands-mine',
                        GC_MIN_POP: '16', GC_RUN_ID: 'testrun' });
    var tracked = cp.execSync('git show --name-only --format= HEAD',
        { cwd: SCRATCH, encoding: 'utf8' });
    assert.ok(tracked.indexOf('.islands-mine/island0.json') >= 0,
        'its own island was not committed:\n' + tracked);
    assert.ok(tracked.indexOf('.islands-theirs/island0.json') < 0,
        "another run's island rode along:\n" + tracked);
});

// AND THE RESUME ITSELF. Committing the files is half of it; the other half is
// train_pbt.js opening them rather than starting over, and refusing one that
// belongs to a different search.
test('train_pbt resumes its islands, and refuses a foreign one', function () {
    var dir = path.join(__dirname, '.pbt-424242');
    var env = Object.assign({}, process.env, {
        GC_PBT_INIT_ONLY: '1', GC_GA_SEED: '424242', GC_PBT_ISLANDS: '2',
        GC_VS_POPULATION: '4', GC_LEVEL: '10', GC_DEPTH: '1'
    });
    function init() {
        return cp.execSync('node train_pbt.js', { cwd: __dirname, env: env, encoding: 'utf8' });
    }
    try {
        scrub(dir);
        var first = init();
        assert.ok(/resumed 0/.test(first), 'a fresh run claimed to resume:\n' + first);
        var before = fs.readFileSync(path.join(dir, 'island0.json'), 'utf8');

        var second = init();
        assert.ok(/resumed 2/.test(second),
            'train_pbt did not resume islands that were right there on disk, so a ' +
            'redispatched run starts a brand new search:\n' + second);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'island0.json'), 'utf8'), before,
            'the resume rewrote the island it claimed to resume');

        // A file from a search with different weights in it must NOT be adopted.
        var foreign = JSON.parse(before);
        foreign.fingerprint = 'something else entirely';
        fs.writeFileSync(path.join(dir, 'island0.json'), JSON.stringify(foreign));
        var third = init();
        assert.ok(/resumed 1/.test(third),
            'train_pbt adopted an island belonging to a different configuration:\n' + third);
        assert.notStrictEqual(fs.readFileSync(path.join(dir, 'island0.json'), 'utf8'),
            JSON.stringify(foreign), 'the foreign island was left in place');
    } finally {
        scrub(dir);
    }
});

// MIGRATION OFF IS A DIFFERENT SEARCH, so it must not open the populations of
// a migrating run — four independent loops resuming into pools that have been
// sharing weights is not the control it claims to be.
test('migration off gets its own populations', function () {
    var dir = path.join(__dirname, '.pbt-515151');
    function init(migrate) {
        var env = Object.assign({}, process.env, {
            GC_PBT_INIT_ONLY: '1', GC_GA_SEED: '515151', GC_PBT_ISLANDS: '2',
            GC_VS_POPULATION: '4', GC_LEVEL: '10', GC_DEPTH: '1',
            GC_PBT_MIGRATE: migrate
        });
        return cp.execSync('node train_pbt.js', { cwd: __dirname, env: env, encoding: 'utf8' });
    }
    try {
        scrub(dir);
        init('1');
        var migrating = JSON.parse(fs.readFileSync(path.join(dir, 'island0.json'), 'utf8'));
        var off = init('0');
        assert.ok(/MIGRATION OFF/.test(off), 'GC_PBT_MIGRATE=0 did not reach the trainer:\n' + off);
        assert.ok(/resumed 0/.test(off),
            'a no-migration run adopted the populations of a MIGRATING run — they have been ' +
            'sharing weights, so it is not an independent baseline:\n' + off);
        var independent = JSON.parse(fs.readFileSync(path.join(dir, 'island0.json'), 'utf8'));
        assert.notStrictEqual(independent.fingerprint, migrating.fingerprint,
            'both spellings hash the same, so either can open the other\'s populations');
    } finally {
        scrub(dir);
    }
});

// A CLEAN STOP MUST BE DISTINGUISHABLE FROM A CRASH. train_pbt.js stops when
// another leg will not fit, which can happen at half the budget after one long
// leg; the workflow's exited-early guard then has to be told not to treat that
// as a crash loop. islands-d2-c's chain died for being 7 minutes under that
// floor after a single 158-minute leg.
test('a stop for lack of room leaves the marker, and a normal exit does not', function () {
    var marker = path.join(__dirname, '.pbt-clean-stop');
    var dir = path.join(__dirname, '.pbt-606060');
    function run(env) {
        return cp.execSync('node train_pbt.js', {
            cwd: __dirname, encoding: 'utf8',
            env: Object.assign({}, process.env, {
                GC_GA_SEED: '606060', GC_PBT_ISLANDS: '2', GC_VS_POPULATION: '4',
                GC_LEVEL: '10', GC_DEPTH: '1'
            }, env)
        });
    }
    try {
        scrub(dir);
        try { fs.unlinkSync(marker); } catch (e) { /* none */ }

        // Init-only: it never reaches the leg loop, so no marker.
        run({ GC_PBT_INIT_ONLY: '1' });
        assert.ok(!fs.existsSync(marker),
            'a run that never started a leg left the clean-stop marker, so the workflow ' +
            'would chain past a crash');

        // A deadline already gone: the first leg cannot fit, so it stops for
        // exactly the reason the marker exists to report.
        var out = run({ GC_DEADLINE: String(Math.floor(Date.now() / 1000) + 5) });
        assert.ok(/stopping: .* a leg needs about/.test(out),
            'the run did not stop for lack of room:\n' + out);
        assert.ok(fs.existsSync(marker),
            'a run that stopped because no leg would fit left no marker, so the ' +
            'workflow treats the handover as a crash and the chain dies:\n' + out);

        // And a later run clears it before deciding anything.
        run({ GC_PBT_INIT_ONLY: '1' });
        assert.ok(!fs.existsSync(marker),
            'the marker survived into the next run, so any later stop looks clean');
    } finally {
        try { fs.unlinkSync(marker); } catch (e) { /* none */ }
        scrub(dir);
    }
});

// THE PEER OPPONENT IS THE BEST CHAMPION ON DISK, and it must never be a
// champion from a different feature set — those weights would be scored on
// features this run does not have. The shipped record is a FLOOR every chain
// now clears 12-0, so without a moving opponent the report cannot rank two
// champions at all.
test('the held-out set duels NOTHING SAVED, and a failed shard stops the leg', function () {
    var src = fs.readFileSync(path.join(__dirname, 'train_pbt.js'), 'utf8');

    // This used to check that the peer was chosen carefully — same features,
    // same switches, not a smoke file. There is no peer. A record against a
    // saved weight set measures that set as much as this champion, and
    // across a change of measurement set it measures nothing at all.
    assert.ok(!/function bestCommittedChampion/.test(src), 'the peer picker is back');
    assert.ok(!/trained-weights/.test(src), 'the shipped bot is loaded to duel again');

    var ho = /function buildReport\([\s\S]*?\n}/.exec(src);
    assert.ok(ho, 'buildReport is gone, so nothing assembles the held-out report');
    assert.ok(!/out\.peer = \{/.test(ho[0]), 'the report carries a peer record again');
    assert.ok(!/shipped: \{/.test(ho[0]), 'the report carries a shipped record again');
    assert.ok(/mirror: \{/.test(ho[0]), 'the report no longer carries the mirror counts');
    assert.ok(/paylessClears/.test(ho[0]) && /chainByLinks/.test(ho[0]),
        'the raw counts are missing, which are the whole of the report now');

    // A FAILED SHARD MUST STOP THE LEG rather than let a short result set be
    // tallied as if it were the full one.
    var hof = /function heldOut\([\s\S]*?\n}/.exec(src);
    assert.ok(hof, 'heldOut is gone');
    assert.ok(/duelJobs\(genome, genome\)/.test(hof[0]),
        'the held-out set is not a mirror, so something else is on the other side');
    assert.ok(/runDuels\(/.test(hof[0]),
        'heldOut runs its duels inline again — that is half a leg on one core');
    assert.ok(/if \(err\) return cb\(err\)/.test(hof[0]),
        'heldOut no longer surfaces a failed duel shard, so a short result set ' +
        'would be reported as a record');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
scrub(SCRATCH);
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
