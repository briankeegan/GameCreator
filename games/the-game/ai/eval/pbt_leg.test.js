// DOES A WHOLE LEG STILL FINISH? Run: node pbt_leg.test.js
//
// Everything else that touches train_pbt.js runs it with GC_PBT_INIT_ONLY,
// which returns before a leg ever happens. So the part that actually does the
// work — run the islands, face the champions off, migrate, play the held-out
// duels, write the snapshot, go round again — had no test at all, and it is
// the part that was rewired when the face-off and the held-out duels were
// fanned out across cores instead of run one at a time in the parent.
//
// The failure this exists for is a callback chain that never calls back: the
// leg would simply stop, the job would sit until its timeout, and every sign
// from outside would look like a slow leg rather than a broken one. Thirty
// five chains were live when this was written.
//
// It asserts the leg's OUTPUT, not its internals: the log line a finished leg
// prints, and the snapshot on disk with a held-out report in it.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var SCRATCH = path.join(__dirname, '.pbt-leg-test');
function scrub() {
    try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch (e) { /* gone */ }
    // The islands live in .pbt-<seed>/ beside the module, named from the seed
    // this test uses and nothing else.
    try { fs.rmSync(path.join(__dirname, '.pbt-919191'), { recursive: true, force: true }); }
    catch (e) { /* gone */ }
    try { fs.unlinkSync(path.join(__dirname, '.pbt-clean-stop')); } catch (e) { /* gone */ }
}

// Deliberately tiny: two islands, four vectors, two updates a leg, one
// face-off seed. The leg's SHAPE is what is under test, not its quality.
function run() {
    var env = {};
    for (var k in process.env) if (process.env.hasOwnProperty(k)) env[k] = process.env[k];
    env.GC_PBT_ISLANDS = '2';
    env.GC_VS_POPULATION = '4';
    env.GC_PBT_LEG = '2';
    env.GC_PBT_FACEOFF = '1';
    env.GC_GA_SEED = '919191';
    env.GC_LEVEL = '10';
    env.GC_DEPTH = '1';
    env.GC_SNAPSHOT_HOOK = '';
    env.GC_MODE = 'pbt';
    env.GC_TAG = 'pbt-leg-test';
    env.GC_CHECKPOINT_DIR = SCRATCH;
    // timeForAnotherLeg will not START a leg it cannot finish, and its guess
    // for a first leg is 60 MINUTES — against a short clock that means no leg
    // ever runs and the test passes on an empty log. Zero the guess so the
    // first leg goes, and let the measured length of that leg stop the next.
    env.GC_PBT_LEG_GUESS_MIN = '0';
    env.GC_DEADLINE = String(Math.floor(Date.now() / 1000) + 100);
    return cp.execSync('node train_pbt.js', {
        cwd: __dirname, env: env, encoding: 'utf8', timeout: 600000
    });
}

var out = null, ran = null;
try { out = run(); } catch (e) { ran = e; }

test('a leg RUNS TO THE END and says so', function () {
    assert.ok(!ran, 'train_pbt did not finish: ' + (ran && (ran.stdout || ran.message)));
    assert.ok(/wins the face-off/.test(out),
        'no face-off line, so the leg never got past the islands:\n' + out);
    assert.ok(/chains .*combos /.test(out),
        'no counts line, so the fanned-out duels never came back:\n' + out);
    assert.ok(/written to trained\.pbt\.json/.test(out),
        'no snapshot was written, so the leg ended before its payload:\n' + out);
});

test('the snapshot reports what the champion FIRED, and duels nothing saved', function () {
    var file = path.join(__dirname, 'trained.pbt.json');
    assert.ok(fs.existsSync(file), 'trained.pbt.json is missing');
    var snap = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(snap.holdout, 'the snapshot has no held-out report, which the gates reject');
    var m = snap.holdout.mirror;
    assert.ok(m, 'the mirror report is missing');
    assert.ok(m.duels > 0, 'it reports zero duels, so nothing was actually played');
    assert.ok(m.chainByLinks && m.comboBySize, 'the raw counts are missing');
    assert.strictEqual(typeof m.paylessClears, 'number', 'paylessClears is not a number');

    // NOTHING SAVED IS ON THE OTHER SIDE. A record against a shipped bot or
    // a previous snapshot measures that bot as much as this one, and across
    // a change of measurement set it does not measure anything at all.
    assert.ok(!snap.holdout.peer, 'the report duels a previous snapshot again');
    assert.ok(!snap.holdout.shipped, 'the report duels the shipped bot again');
    var src = fs.readFileSync(path.join(__dirname, 'train_pbt.js'), 'utf8');
    assert.ok(!/function bestCommittedChampion/.test(src),
              'bestCommittedChampion is back');
});

test('the fanned-out duels leave no scratch files behind', function () {
    var left = fs.readdirSync(__dirname).filter(function (f) { return /^\.duels\./.test(f); });
    assert.deepStrictEqual(left, [], 'duel scratch files were not cleaned up: ' + left.join(', '));
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
scrub();
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
