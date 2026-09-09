// DOES THE TRAINING HARNESS DO WHAT IT CLAIMS? Run: node training.test.js
//
// WHY THIS EXISTS, stated plainly because it is the lesson of the session
// that produced it: the GAME code here was built test-first and had no
// bugs. The harness around it — train.js, rounds.sh, the seed sets — was
// hand-written with no tests, and every defect found in an audit was in
// that harness. Five of them, all the same shape: a number measured one
// way compared against a number measured another way.
//
//   - rounds compared on the HELD-OUT seeds, so champions were selected on
//     the seeds used to report them (22% inflation, measured)
//   - the starting champion's bar read the held-out score while rounds
//     reported the finals score
//   - the finals set covered 8 of 12 attack files
//   - a result's `brain` label read a global mutated across an async call
//   - results did not record which seeds their score came from, which is
//     what made all of the above invisible
//
// Every one of them made the search look like it was failing. None of them
// would have survived a test. So these are the claims the harness makes,
// checked — cheaply, on tiny runs, so this file costs seconds rather than
// the half hour a real round takes.
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var cp = require('child_process');

var DIR = __dirname;
var seeds = require('./seeds.js');
var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ---------------------------------------------------------------- seeds

test('the three seed sets never overlap', function () {
    // seeds.js throws at load if they do, so this proves the guard exists
    // rather than re-implementing the check: a set used to CHOOSE must
    // never also be a set used to REPORT.
    function overlap(a, b) { return a.filter(function (x) { return b.indexOf(x) >= 0; }); }
    assert.deepStrictEqual(overlap(seeds.TRAIN, seeds.HOLDOUT), []);
    assert.deepStrictEqual(overlap(seeds.TRAIN, seeds.FINALS), []);
    assert.deepStrictEqual(overlap(seeds.HOLDOUT, seeds.FINALS), []);
});

test('choosing and reporting sets each cover every attack file exactly once', function () {
    // endless picks its file from the seed. A set that is not a multiple of
    // the file count weights some attack files double and silently omits
    // others — the finals set covered 8 of 12 for a while, so champions
    // were chosen against two thirds of the real opponents.
    var bench = require('./bench.js');
    var n = bench.endlessFileCount();
    [['FINALS', seeds.FINALS], ['HOLDOUT', seeds.HOLDOUT]].forEach(function (pair) {
        var files = pair[1].map(function (s) { return (s - 1 + n * 100) % n; });
        var distinct = files.filter(function (v, i, a) { return a.indexOf(v) === i; });
        assert.strictEqual(distinct.length, n,
            pair[0] + ' covers ' + distinct.length + ' of ' + n + ' attack files (' +
            files.join(',') + '). Every file exactly once, or some opponents count double.');
        assert.strictEqual(pair[1].length % n, 0,
            pair[0] + ' has ' + pair[1].length + ' seeds for ' + n + ' files — not a multiple');
    });
});

// ------------------------------------------------------------- train.js

// A real run, kept tiny: 2 generations of 8. Seconds, not half an hour.
function tinyRun(env) {
    var e = Object.assign({}, process.env, { GC_LEVEL: '10', GC_BRAIN: 'puyo' }, env || {});
    var out = cp.execSync('node train.js 2 8 replace 4 score', {
        cwd: DIR, env: e, encoding: 'utf8', timeout: 900000
    });
    return { stdout: out, result: JSON.parse(fs.readFileSync(path.join(DIR, 'trained.replace.json'), 'utf8')) };
}

var RUN = null;
function run() { if (!RUN) RUN = tinyRun({ GC_GA_SEED: '4242' }); return RUN; }

test('a result records the seeds its score was measured on', function () {
    // The field whose absence made every units bug invisible. Without it,
    // two numbers from different seed sets look identical on the page.
    var d = run().result;
    assert.ok(Array.isArray(d.finalsSeeds), 'no finalsSeeds recorded');
    assert.deepStrictEqual(d.finalsSeeds, seeds.FINALS,
        'the result claims different finals seeds than the run used');
    assert.deepStrictEqual(d.holdoutSeeds, seeds.HOLDOUT);
});

test('a result is labelled with the brain it TRAINED, not the baseline brain', function () {
    // The baseline row runs SearchCpu while the trained brain is puyo, by
    // swapping a global across an async call. This was correct by luck.
    var d = run().result;
    assert.strictEqual(d.brain, 'puyo',
        'trained the puyo brain and the result says "' + d.brain + '" — the baseline\'s ' +
        'brain leaked into the label');
    assert.strictEqual(d.level, 10);
});

test('the winner is crowned from several finalists, not one game', function () {
    // The whole point of the finals stage: a single game cannot tell two
    // good weight sets apart (the same weights measured 1380-6070 across
    // seeds), so crowning the best of one generation's single seed is a
    // coin flip.
    var out = run().stdout;
    assert.ok(/choosing between \d+ finalists/.test(out),
        'no finalist selection happened at all');
    var listed = (out.match(/finalist \d+: /g) || []).length;
    assert.ok(listed >= 2,
        'only ' + listed + ' finalist scored — crowning is back to a single candidate');
    var d = run().result;
    assert.ok(d.finalists >= 2, 'result records finalists=' + d.finalists);
});

test('trainFitness is the FINALS score, which is what rounds are compared on', function () {
    // rounds.sh reads trainFitness. If it ever became the training-seed or
    // held-out number again, champions would be selected on the wrong
    // thing and nothing would say so.
    var d = run().result;
    var holdout = d.holdout && d.holdout.learned && d.holdout.learned.fitness;
    assert.ok(typeof d.trainFitness === 'number' && d.trainFitness > 0, 'no trainFitness');
    assert.notStrictEqual(d.trainFitness, holdout,
        'trainFitness equals the held-out score exactly, which means rounds are being ' +
        'compared on the seeds used to report them — the 22% inflation bug');
});

test('the baseline row is a real opponent, not a bot with no opinions', function () {
    // Under the puyo brain the zero genome holds forever and scores 0, so
    // the report once read "shipped 0 ... +0.0%" on every row: a baseline
    // that is always zero makes any result look infinite.
    var d = run().result;
    var s = d.holdout && d.holdout.shipped;
    assert.ok(s && s.fitness > 0,
        'the baseline scored ' + (s && s.fitness) + ' — a zero baseline is a broken column');
});

test('two GA seeds give two different runs (rounds are not replays)', function () {
    // Without this the crank runs the same round forever: seeded from the
    // same champion with the same arguments, every round returned the
    // identical held-out total to fifteen decimal places, and would have
    // stopped after three "flat" rounds having searched nothing.
    var a = tinyRun({ GC_GA_SEED: '111' }).result.trainFitness;
    var b = tinyRun({ GC_GA_SEED: '222' }).result.trainFitness;
    assert.notStrictEqual(a, b,
        'GC_GA_SEED 111 and 222 both produced ' + a + ' — the GA is ignoring its seed ' +
        'and every round is a replay of the last');
});

// ------------------------------------------------------------ rounds.sh

test('the champion guard rejects a result measured on different seeds', function () {
    // And it must ACCEPT a good one: this guard failed the first time it
    // ever ran, on its own quoting bug, exiting 3 on a perfectly valid
    // champion. A checker only ever seen to fail is not known to work.
    var good = path.join(DIR, 'trained.replace.json');
    var stale = path.join(require('os').tmpdir(), 'training-test-stale.json');
    var d = JSON.parse(fs.readFileSync(good, 'utf8'));
    var s = JSON.parse(JSON.stringify(d));
    s.finalsSeeds = seeds.FINALS.slice(0, seeds.FINALS.length - 2);
    fs.writeFileSync(stale, JSON.stringify(s));

    function guard(file) {
        try {
            cp.execSync('node -e "' +
                'var d=require(process.env.GC_CHAMP_FILE);' +
                'var want=require(\'./seeds.js\').FINALS;' +
                'if((d.finalsSeeds||[]).join(\',\')!==want.join(\',\')) process.exit(3);' +
                'process.stdout.write(String(d.trainFitness||0));"',
                { cwd: DIR, env: Object.assign({}, process.env, { GC_CHAMP_FILE: file }), encoding: 'utf8' });
            return 'accepted';
        } catch (e) { return 'rejected(' + e.status + ')'; }
    }
    assert.strictEqual(guard(good), 'accepted', 'the guard rejected a VALID champion');
    assert.strictEqual(guard(stale), 'rejected(3)', 'the guard accepted a champion measured on the wrong seeds');
});

test('rounds.sh compares champions on finals, never on the reporting seeds', function () {
    // Read the script rather than run it: a round is half an hour. The
    // thing being asserted is which FIELD the comparison reads, and that
    // is visible in the source.
    var src = fs.readFileSync(path.join(DIR, 'rounds.sh'), 'utf8');
    var compareBlock = src.slice(src.indexOf('score=$('), src.indexOf('holdout=$('));
    assert.ok(/trainFitness/.test(compareBlock),
        'the round comparison does not read trainFitness');
    assert.ok(!/holdout/.test(compareBlock),
        'the round comparison reads the held-out score — champions are being selected ' +
        'on the seeds used to report them');
});

test('rounds.sh gives every round a name no other run can claim', function () {
    // The second crank wrote r1.json — the name the first crank's champion
    // already had — and clobbered it, leaving the champion pointer aimed at
    // a worse genome while the bar still read the better one's score.
    var src = fs.readFileSync(path.join(DIR, 'rounds.sh'), 'utf8');
    assert.ok(/RUN_ID=/.test(src), 'no per-invocation run id');
    assert.ok(/result="trained\.\$\{MODE\}\.\$\{TAG\}\.\$\{RUN_ID\}\.r\$\{r\}\.json"/.test(src),
        'round result files are not namespaced by run id, so a second crank overwrites ' +
        'the first crank\'s champion');
});

test('rounds.sh seeds each round from the CHAMPION and varies the GA seed', function () {
    var src = fs.readFileSync(path.join(DIR, 'rounds.sh'), 'utf8');
    assert.ok(/GC_SEED_GENOME="\$champion"/.test(src),
        'rounds do not seed from the champion — a bad round would become the point the ' +
        'next round clusters around');
    assert.ok(/gaSeed=\$\(\( *20260907 *\+ *r *\* *7919 *\)\)/.test(src),
        'the GA seed does not vary per round, so every round is a replay');
    assert.ok(/GC_GA_SEED=\$gaSeed/.test(src), 'the varying seed is computed but not passed');
});

test('a champion rounds.sh actually writes is not gitignored', function () {
    // THE FAILURE THIS EXISTS FOR, exactly as it happened. .gitignore
    // ignored trained.*.json with an exception for `trained.*.round*.json`,
    // and rounds.sh named its output `...r1.json`. `r1` is not `round1`, so
    // the exception never fired once: every champion the crank has ever
    // produced was silently ignored. A container restart killed a crank
    // mid-round and the surviving champion was untracked — an hour of
    // compute one restart from unrecoverable, with `git status` clean the
    // whole time, because an ignored file looks exactly like a saved one.
    //
    // So the name here is not typed by hand: it is BUILT from rounds.sh's
    // own template, which means renaming the output without updating the
    // pattern fails this test instead of quietly un-tracking every result.
    var src = fs.readFileSync(path.join(__dirname, 'rounds.sh'), 'utf8');
    var m = /result="([^"]+)"/.exec(src);
    assert.ok(m, 'rounds.sh no longer assigns result="..." — this test cannot ' +
                 'find the name it is supposed to check');
    var name = m[1]
        .replace('${MODE}', 'replace').replace('${TAG}', 'l10-puyo')
        .replace('${RUN_ID}', '0908-234107').replace('${r}', '7');
    assert.ok(!/\$\{/.test(name),
        'the champion name still has an unresolved variable in it (' + name +
        '), so this test would be checking a filename that never exists');

    var res = cp.spawnSync('git', ['check-ignore', '-q', name], { cwd: __dirname });
    // git check-ignore: 0 = ignored, 1 = not ignored, >1 = error.
    assert.notStrictEqual(res.status, 0,
        'rounds.sh writes ' + name + ' and .gitignore IGNORES it. Every round of ' +
        'every crank would exist only on disk, and a restart would take it. Fix the ' +
        'pattern in .gitignore to match the name rounds.sh builds — do not fix this ' +
        'test.');
    assert.ok(res.status === 1,
        'git check-ignore failed to run (status ' + res.status + '), so this gate ' +
        'is not actually checking anything');
});

test('rounds.sh saves each champion itself, and cannot die trying', function () {
    // A crank runs unattended for hours, so "commit it afterwards" loses
    // every result the machine dies in the middle of. The save has to be
    // part of the round.
    var src = fs.readFileSync(path.join(__dirname, 'rounds.sh'), 'utf8');
    var save = src.slice(src.indexOf('result="'));
    assert.ok(/git add -f "\$result"/.test(save),
        'rounds.sh does not commit the champion it just wrote, so the only copy is ' +
        'on a disk that goes away');
    assert.ok(/git commit/.test(save) && /git push/.test(save),
        'the champion is staged but never committed and pushed');
    // And the other direction: bookkeeping must never cost the run. Every
    // git call is guarded, so a missing identity or a lost network prints a
    // line instead of killing hours of training.
    assert.ok(/git push[^\n]*\|\|/.test(save),
        'the push is unguarded — a lost network would abort the whole crank');

    // AND IT REBASES FIRST. A crank runs for hours; anything pushed to the
    // branch meanwhile leaves its checkout behind and the push is rejected
    // as a non-fast-forward. Guarded, that prints one line and carries on —
    // so a five-hour run would commit twenty champions locally and lose
    // every one when the runner is recycled. Caught from timestamps
    // (checkout 14:16:46, an unrelated push at 14:21:57) before it cost a
    // run, which is the only reason this is a test and not a post-mortem.
    // Matched on the real COMMANDS, not the words: the comment above the
    // rebase mentions `git push` while explaining why it exists, and an
    // indexOf on the bare word found that instead — the test failed against
    // correct code, which is the fastest way to get a check deleted.
    var pushAt = save.indexOf('git push -q origin HEAD');
    var rebaseAt = save.indexOf('git rebase -q');
    assert.ok(rebaseAt !== -1 && rebaseAt < pushAt,
        'rounds.sh pushes without first rebasing onto the remote branch, so any ' +
        'commit that lands during a long run makes every later champion unpushable ' +
        '— silently, because the push failure is deliberately non-fatal');
    assert.ok(/COULD NOT COMMIT/.test(save),
        'a failed commit passes silently, which is the same as not knowing the ' +
        'result is unsaved');
});

test('a smoke-sized run is never committed as a champion', function () {
    // Six 8-genome, 1-generation results reached the repo in one night, all
    // scoring 1842.5, sitting in `git log` looking exactly like real rounds
    // and eligible to be picked as a seed by the resume hook. `rounds.sh 1 1
    // 8 1` is how this script gets exercised, so it will keep producing them.
    var src = fs.readFileSync(path.join(__dirname, 'rounds.sh'), 'utf8');
    var save = src.slice(src.indexOf('result="'));
    assert.ok(/\$POP" -lt 50 \]\s*\|\|\s*\[ "\$GENS" -lt 10/.test(save),
        'rounds.sh commits a champion without checking the run was big enough to ' +
        'mean anything, so every smoke test leaves a fake result in the repo');
    // The file is still WRITTEN — a smoke run that produced nothing at all
    // would be much harder to debug than one that leaves its output on disk.
    var guard = save.slice(save.indexOf('-lt 50'));
    assert.ok(/NOT committed/.test(guard.slice(0, 400)),
        'the guard does not say what it did, so a missing champion after a small ' +
        'run looks like a bug rather than the rule working');
});

test('the crank stops itself before a job timeout can kill it mid-round', function () {
    // The crank now lives on a GitHub runner, because this sandbox's microVM
    // is reclaimed between turns and took three runs with it in one night. A
    // runner has a hard 6-hour cap that kills a job outright — no chance to
    // finish a round, commit it, or clear the marker — so the crank has to
    // stop itself first.
    var src = fs.readFileSync(path.join(__dirname, 'rounds.sh'), 'utf8');
    assert.ok(/GC_DEADLINE/.test(src),
        'rounds.sh has no time budget, so a runner will kill it holding a ' +
        'half-finished round');
    assert.ok(/roundSecs=\$\(\( \$\(date \+%s\) - roundStart \)\)/.test(src),
        'the budget is not measuring how long rounds actually take. Rounds get ' +
        'slower as genomes survive longer, so a budget built on a constant will ' +
        'start a round it cannot finish.');
    // No budget must mean no behaviour change: a person at a terminal wants it
    // to run until the cap or until the numbers stop moving.
    assert.ok(/DEADLINE="\$\{GC_DEADLINE:-\}"/.test(src) && /if \[ -n "\$DEADLINE" \]/.test(src),
        'the time budget is not optional, so running this by hand would now stop ' +
        'for a reason that only exists on a runner');
});

test('the training workflow exists and cannot run two cranks at once', function () {
    var wf = path.join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'ai-train.yml');
    assert.ok(fs.existsSync(wf), 'no ai-train.yml — the crank has nowhere to live but a ' +
        'sandbox that gets reclaimed');
    var y = fs.readFileSync(wf, 'utf8');
    assert.ok(/concurrency:/.test(y) && /group: ai-train/.test(y),
        'no concurrency group: two cranks would fight over the cores AND over the ' +
        'same trained.<mode>.json scratch file, and both results would be junk');
    assert.ok(/cancel-in-progress: false/.test(y),
        'cancel-in-progress must be false — a run halfway through a round has earned ' +
        'that round, and killing it for a fresher one throws the work away');
    assert.ok(/timeout-minutes: 350/.test(y) && /340 \* 60/.test(y),
        'the job timeout and the crank deadline must leave the crank room to stop ' +
        'itself first, or the runner kills it mid-round');
    assert.ok(/contents: write/.test(y),
        'without write permission the crank cannot commit the champions it earns, ' +
        'which is the entire point of running it somewhere durable');
});

test('a killed run does not lose its generations', function () {
    // THE BUG THIS EXISTS FOR, and it is the one that mattered most.
    // train.js wrote its result only in finish(), after ALL generations. A
    // round killed at generation 45 of 60 wrote NOTHING: the population was
    // in memory, fully evaluated, and never written down. That is why round
    // 3 was started and killed three times in one night without ever
    // producing a champion — there was no last champion to feed forward,
    // because the round never finished one. Proved by killing a real run at
    // generation 3: no result file, and a checkpoint holding all 30 genomes.
    var src = fs.readFileSync(path.join(__dirname, 'train.js'), 'utf8');
    assert.ok(/function saveCheckpoint\(\)/.test(src),
        'train.js has no checkpoint, so a killed run loses every generation it ran');
    var loop = src.slice(src.indexOf('population = next;'));
    assert.ok(/^population = next;\s*\n\s*saveCheckpoint\(\);/m.test(loop),
        'the checkpoint is not written as each generation completes, so a kill ' +
        'still costs more than one generation');

    // ATOMIC, or the safety feature becomes the thing that loses the run: a
    // kill landing mid-write leaves truncated JSON the next run cannot parse.
    assert.ok(/renameSync/.test(src),
        'the checkpoint is written in place rather than renamed into place, so a ' +
        'kill during the write leaves a corrupt file');

    // FINGERPRINTED, or a 60-generation checkpoint silently resumes into an
    // 8-genome smoke run — a different search wearing the same filename.
    assert.ok(/fingerprint\(\)/.test(src) && /ck\.fingerprint !== fingerprint\(\)/.test(src),
        'the checkpoint is not checked against the config that made it');

    // CLEARED ON A REAL FINISH, or every later run resumes a search that
    // already ended, at its last generation, forever — but ONLY AFTER THE
    // RESULT IS WRITTEN. Deleting it at the top of finish() reopened the
    // exact hole the checkpoint closes: finish() replays every finalist on
    // the finals seeds first, the slowest part of a round, and a kill in that
    // window left no checkpoint AND no result. Observed live, once.
    var fin = src.slice(src.indexOf('function finish()'));
    var unlinkAt = fin.indexOf('unlinkSync(CHECKPOINT)');
    var writeAt = fin.indexOf("writeFileSync(path.join(__dirname, 'trained.'");
    assert.ok(unlinkAt !== -1, 'finish() never clears the checkpoint, so the next run ' +
        'resumes a search that already completed');
    assert.ok(writeAt !== -1, 'this test cannot find where the result is written, so it ' +
        'cannot check the ordering it exists to check');
    assert.ok(unlinkAt > writeAt,
        'finish() deletes the checkpoint BEFORE writing the result. A kill between the ' +
        'two — during the finalist replay, which is the slowest part of a round — loses ' +
        'the checkpoint and the result together, which is the whole failure the ' +
        'checkpoint exists to prevent.');

    // And it must never be able to kill the run it is protecting.
    var save = src.slice(src.indexOf('function saveCheckpoint'));
    assert.ok(/catch \(e\)/.test(save.slice(0, 900)),
        'a failed checkpoint write would take down a running GA — losing the ability ' +
        'to resume is bad, killing hours of training over it is worse');
});

test('a resumed crank comes back as the round it died in', function () {
    // TWO CORRECT FEATURES THAT BROKE EACH OTHER. The GA seed is derived
    // from the round number, so a resume that restarts the counter at 1
    // after dying in round 2 is genuinely running a different search — and
    // train.js's per-generation checkpoint, correctly, refuses to load into
    // it. Observed live: the crank died mid-round-2, came back as round 1,
    // and printed "ignoring a checkpoint from a different search" while
    // discarding real banked generations. Neither half was wrong on its own.
    var src = fs.readFileSync(path.join(__dirname, 'rounds.sh'), 'utf8');
    assert.ok(/START_ROUND=\$\{GC_START_ROUND:-1\}/.test(src) &&
              /for \(\( r=START_ROUND;/.test(src),
        'rounds.sh always starts at round 1, so every resume changes the GA seed and ' +
        'throws away the checkpoint of the round it is resuming');
    assert.ok(/CRANK_ROUND=\$r/.test(src),
        'the round in flight is never written to the marker, so a resume has no way ' +
        'to know which round to come back as');

    var hook = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..',
                                         '.claude', 'hooks', 'resume-training.sh'), 'utf8');
    assert.ok(/GC_START_ROUND="\$CRANK_ROUND"/.test(hook),
        'the hook restarts the crank without passing the round back, so rounds.sh ' +
        'cannot honour it');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
