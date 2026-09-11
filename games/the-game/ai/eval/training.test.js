// DOES THE TRAINING HARNESS DO WHAT IT CLAIMS? Run: node training.test.js
//
// WHY THIS EXISTS, stated plainly because it is the lesson of the session
// that produced it: the GAME code here was built test-first and had no
// bugs. The harness around it — train.js, crank.sh, the seed sets — was
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

test('a result records how its genome was chosen', function () {
    // The field whose absence made every units bug invisible: two numbers
    // measured different ways look identical on the page.
    //
    // It used to record finalsSeeds — the fixed set the finalist stage
    // selected on. There is no such stage and no such set now, so the
    // result records the thing that IS true: the genome is the elite of a
    // generation, by its own training fitness.
    var d = run().result;
    assert.ok(typeof d.selection === 'string' && /elite of generation \d+/.test(d.selection),
        'a result no longer says how its genome was chosen (selection=' + d.selection + ')');
    assert.strictEqual(d.finalsSeeds, undefined,
        'finalsSeeds is back. A fixed set that selects is a fixed set to overfit — it ' +
        'is what this rewrite deleted.');
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

test('NOTHING selects on a fixed seed set', function () {
    // THE LAW THIS REWRITE EXISTS FOR, and the one that would have caught
    // the original mistake three patches earlier.
    //
    // ../PUYO_REFERENCE.md runs one continuous loop and never picks a
    // winner, because there is no boundary to pick one at. We chopped the
    // search into rounds, which forced a pick, which needed a trustworthy
    // score, which needed fixed seeds — and a fixed set selected against
    // round after round is a target to overfit. Measured before it was
    // removed: +19% on the seeds that chose the champion, -13% on seeds it
    // had never seen.
    //
    // So: no finalist stage, and the held-out set is a report and never a
    // selector.
    var out = run().stdout;
    assert.ok(!/choosing between \d+ finalists/.test(out),
        'finalist selection is back — that is the round boundary returning');
    var src = fs.readFileSync(path.join(__dirname, 'train.js'), 'utf8');
    var chooses = src.split('\n').filter(function (l) {
        return /FINALS_SEEDS/.test(l) && !/^\s*(\/\/|\*)/.test(l);
    });
    assert.deepStrictEqual(chooses, [],
        'train.js still uses FINALS_SEEDS in code:\n  ' + chooses.join('\n  ') +
        '\nNothing may select on a fixed set.');
});

test('the search is CONTINUOUS: the population is never rebuilt from one genome', function () {
    // The round boundary discarded 199 of 200 genomes every 60 generations
    // and rebuilt the population from the winner plus mutations of it. That
    // is what forced everything above. crank.sh must never reintroduce it.
    var crank = fs.readFileSync(path.join(__dirname, 'crank.sh'), 'utf8');
    var seeding = crank.split('\n').filter(function (l) {
        return /GC_SEED_GENOME/.test(l) && !/^\s*#/.test(l);
    });
    assert.deepStrictEqual(seeding, [],
        'crank.sh seeds a search from a single genome:\n  ' + seeding.join('\n  ') +
        '\nThat is the round boundary. The population carries itself in the checkpoint.');
    assert.ok(!/for \(\( *r=/.test(crank) && !/round/i.test(crank.replace(/^#.*$/gm, '')),
        'crank.sh has a round loop again');
});

test('trainFitness is a training score, never the held-out one', function () {
    // If these were ever the same number, the search would be reporting on
    // the seeds it selected with — the 22% inflation this repo already
    // measured once.
    var d = run().result;
    var holdout = d.holdout && d.holdout.learned && d.holdout.learned.fitness;
    assert.ok(typeof d.trainFitness === 'number' && d.trainFitness > 0, 'no trainFitness');
    assert.notStrictEqual(d.trainFitness, holdout,
        'trainFitness equals the held-out score exactly, which means the answer is being ' +
        'chosen on the seeds used to report it');
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

// ------------------------------------------------------------ crank.sh

test('every snapshot gets a name no other run can claim', function () {
    // train.js overwrites trained.<mode>.json on every snapshot, so a
    // snapshot kept under that name is one waiting to be silently replaced
    // thirty generations later.
    var src = fs.readFileSync(path.join(__dirname, 'commit_snapshot.sh'), 'utf8');
    assert.ok(/GC_RUN_ID/.test(src) && /\$\{GC_TAG\}/.test(src) && /printf '%05d'/.test(src),
        'snapshot names do not carry run id, tag and generation, so two runs can collide');
});

test('a snapshot commit_snapshot.sh actually writes is not gitignored', function () {
    // .gitignore ignores trained.*.json — right, since every smoke test
    // writes one — with an exception for real results. That exception said
    // `round*` while the files were named `r1`, so it never fired ONCE and
    // every champion was silently ignored, with `git status` clean the whole
    // time. The name here is BUILT from commit_snapshot.sh's own template,
    // so renaming the output without fixing the pattern fails this test
    // instead of quietly un-tracking every result.
    var src = fs.readFileSync(path.join(__dirname, 'commit_snapshot.sh'), 'utf8');
    // Greedy to the LAST quote on the line: the template contains "$gen",
    // so a non-greedy [^"]+ captured a truncated name and this test failed
    // against a correct script.
    var m = /^out="(.+)"$/m.exec(src);
    assert.ok(m, 'commit_snapshot.sh no longer assigns out="..." — this test cannot find ' +
                 'the name it is supposed to check');
    var name = m[1]
        .replace('${GC_MODE:-replace}', 'replace').replace('${GC_TAG}', 'l10-puyo')
        .replace('${GC_RUN_ID}', '0909-160000')
        .replace(/\$\(printf[^)]*\)/, '00030');
    assert.ok(!/\$[({]/.test(name),
        'the snapshot name still has an unresolved variable in it (' + name + ')');
    var res = cp.spawnSync('git', ['check-ignore', '-q', name], { cwd: __dirname });
    assert.notStrictEqual(res.status, 0,
        'commit_snapshot.sh writes ' + name + ' and .gitignore IGNORES it. Every snapshot ' +
        'would exist only on disk. Fix the pattern in .gitignore — not this test.');
    assert.strictEqual(res.status, 1,
        'git check-ignore failed to run (status ' + res.status + '), so this gate checks nothing');
});

test('snapshots save themselves, and cannot die trying', function () {
    // A search runs unattended for hours, so "commit it afterwards" loses
    // everything the machine dies in the middle of. The save is part of the
    // search: train.js calls GC_SNAPSHOT_HOOK, commit_snapshot.sh commits.
    var src = fs.readFileSync(path.join(__dirname, 'commit_snapshot.sh'), 'utf8');
    assert.ok(/git add -f "\$out"/.test(src) && /git commit/.test(src) && /git push/.test(src),
        'commit_snapshot.sh does not commit and push the snapshot it was handed');

    // AND IT REBASES FIRST. Anything landing on the branch during a long run
    // leaves this checkout behind and the push is rejected as a
    // non-fast-forward. The push is deliberately non-fatal, so that would
    // print one line and carry on — hours of snapshots committed locally and
    // lost when the machine is recycled.
    var pushAt = src.indexOf('git push -q origin HEAD');
    var rebaseAt = src.indexOf('git rebase -q');
    assert.ok(rebaseAt !== -1 && rebaseAt < pushAt,
        'commit_snapshot.sh pushes without rebasing first');

    // Bookkeeping must never cost the run.
    assert.ok(/git push[^\n]*\|\|/.test(src), 'the push is unguarded');
    assert.ok(/COULD NOT COMMIT/.test(src),
        'a failed commit passes silently, which is the same as not knowing');

    // And train.js must actually call it.
    var tj = fs.readFileSync(path.join(__dirname, 'train.js'), 'utf8');
    assert.ok(/GC_SNAPSHOT_HOOK/.test(tj) && /spawnSync\(SNAPSHOT_HOOK/.test(tj),
        'train.js never calls the snapshot hook, so nothing is ever committed');
});

test('a smoke-sized run is never committed', function () {
    // Six 8-genome results reached the repo in one night, all scoring the
    // same, indistinguishable in `git log` from real ones and eligible to be
    // read back as if they meant something. `./crank.sh 8 1` is how this
    // gets exercised, so it will keep producing them.
    var src = fs.readFileSync(path.join(__dirname, 'commit_snapshot.sh'), 'utf8');
    assert.ok(/GC_MIN_POP/.test(src) && /-lt "\$GC_MIN_POP"/.test(src),
        'commit_snapshot.sh commits without checking the run was big enough to mean ' +
        'anything, so every smoke test leaves a fake result in the repo');
    // The file is still WRITTEN — a smoke run that produced nothing at all is
    // harder to debug than one that leaves its output on disk.
    var guard = src.slice(src.indexOf('GC_MIN_POP"'));
    assert.ok(/NOT committed/.test(guard.slice(0, 400)),
        'the guard does not say what it did, so a missing snapshot after a small run ' +
        'looks like a bug rather than the rule working');
});

test('the search stops itself before a job timeout can kill it', function () {
    // It lives on a GitHub runner now, because this sandbox\'s microVM is
    // reclaimed between turns and took three runs with it in one night. A
    // runner has a hard 6-hour cap that kills a job outright, so the search
    // has to stop first — at a generation boundary, with a snapshot written.
    var src = fs.readFileSync(path.join(__dirname, 'train.js'), 'utf8');
    assert.ok(/GC_DEADLINE/.test(src),
        'train.js has no time budget, so a runner will kill it mid-generation');
    assert.ok(/DEADLINE && Date\.now\(\) \/ 1000 > DEADLINE/.test(src),
        'the deadline is read but never checked in the generation loop');
    // Optional: running by hand must be unaffected.
    assert.ok(/process\.env\.GC_DEADLINE \? Number\(process\.env\.GC_DEADLINE\) : null/.test(src),
        'the budget is not optional, so running this by hand would stop for a reason ' +
        'that only exists on a runner');

    // AND IT STOPS WHEN THE NUMBERS STOP MOVING — the reference\'s own rule,
    // read literally: the WEIGHTS settle ("links settles at 0.25"). A rule
    // based on a score would need a fixed seed set to measure it on, which is
    // the mistake this rewrite deleted.
    assert.ok(/STILL_ENOUGH/.test(src) && /stillCount >= STILL_SNAPSHOTS/.test(src),
        'no convergence rule: the search would run to the generation cap and report ' +
        '"we got bored" as if it were a plateau');
    // Scoped to the convergence block itself. A crude window either side
    // caught report()'s legitimate use of the held-out seeds and failed
    // against correct code — the fastest way to get a check deleted.
    var blockStart = src.indexOf('HAVE THE NUMBERS STOPPED MOVING?');
    var block = src.slice(blockStart, src.indexOf('advance(scored);', blockStart));
    assert.ok(blockStart !== -1 && block.length > 100,
        'this test cannot find the convergence block it is meant to check');
    assert.ok(!/SEEDS|fitness|holdout/i.test(block),
        'the stop rule reads a score or a seed set. It must read only the weights — ' +
        'anything else needs seeds to measure on, and a fixed set that decides when to ' +
        'stop is a fixed set being selected against.');
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

test('the search is cross-entropy method, the way the reference runs it', function () {
    // ../PUYO_REFERENCE.md steps 5 and 6: "keep the highest-scoring SETS,
    // generate new sets CLUSTERED NEAR THOSE WINNERS" — and it names the
    // method: "same loop as Tetris's cross-entropy method".
    //
    // What was here was a genetic algorithm, and it was wrong rather than
    // merely different. Its mutation never annealed, so the elite's weights
    // kept moving by a fifth of the range forever — measured over five
    // snapshots of a 40-genome run: 23.6%, 24.1%, 15.5%, 21.2%, 12.5%,
    // against a stop rule that waits for under 2%. The rule could never have
    // fired and the crank would have run to its cap reporting "we got bored"
    // as a plateau. Under CEM the spread narrows as the elites agree, so the
    // search and the stopping rule are the same mechanism.
    var src = fs.readFileSync(path.join(__dirname, 'train.js'), 'utf8');
    var code = src.split('\n').filter(function (l) { return !/^\s*(\/\/|\*)/.test(l); }).join('\n');

    assert.ok(!/crossover\s*\(/.test(code),
        'crossover is back. A child takes each weight from one parent or the other, so ' +
        'it can land far from BOTH — that is not "clustered near those winners".');
    assert.ok(!/MUTATION_SIGMA/.test(code),
        'a fixed mutation sigma is back. It never anneals, so the weights cannot settle ' +
        'and the convergence rule can never fire.');
    assert.ok(!/TOURNAMENT/.test(code),
        'tournament selection is back. CEM keeps the top slice; a tournament lets a ' +
        'below-median genome parent the next generation.');

    assert.ok(/ELITE_FRACTION/.test(code) && /scored\.slice\(0, eliteCount\)/.test(code),
        'the next generation is not built from the top slice of scorers');
    assert.ok(/mean\[k\] \+ gauss\(\) \* s/.test(code),
        'the next generation is not SAMPLED from the elites\' mean and spread, which is ' +
        'the whole of step 6');
    assert.ok(/spread\[k\] = Math\.sqrt/.test(code),
        'the spread is not measured from how much the elites disagree, so it cannot ' +
        'narrow as they converge');

    // The noise floor must DECAY to zero, or it becomes the fixed mutation
    // sigma wearing a different name and convergence is impossible again.
    assert.ok(/NOISE_FLOOR \* \(1 - generation \/ NOISE_ZERO_AT\)/.test(code),
        'the noise floor does not decay with the generation number, so it is a constant ' +
        'kick under another name and the weights can never settle');
});


// ------------------------------------------------- one feature at a time

test('GC_EXCLUDE drops a feature from the genome instead of pinning it at zero', function () {
    // Two features that arrive together cannot be measured together: the
    // search trades them off from generation 1, so neither weight answers
    // "what is this one worth". GC_EXCLUDE is how each gets its own run.
    // Pinning at zero would leave a dead dimension in the search space and
    // in every reported weight set; dropping it means the run is honestly
    // smaller.
    //
    // Checked against the SOURCE, the way the cross-entropy laws below are,
    // because the only other way to see KEYS is to start a real run — and
    // the first draft of this test did exactly that, launched a full
    // training run inside the test suite, and had to be killed.
    var code = fs.readFileSync(path.join(DIR, 'train.js'), 'utf8');
    assert.ok(/KEYS = registry\.keys\.filter\(function \(k\) \{ return EXCLUDE\.indexOf\(k\) < 0; \}\)/.test(code),
        'KEYS must be registry.keys minus EXCLUDE — a genome dimension that is merely ' +
        'zeroed is still searched and still reported');
    assert.ok(/if \(!KEYS\.length\) throw/.test(code),
        'excluding everything must fail rather than search an empty genome');
    assert.ok(/EXCLUDE\.length\) console\.log\('excluding '/.test(code),
        'the run must say out loud which features it left out');

    // And the registry itself must be untouched: GC_EXCLUDE is the
    // trainer's filter, not a global that would also change the evaluator.
    var registry = require('./registry.js');
    process.env.GC_EXCLUDE = 'staircase,flatTop';
    delete require.cache[require.resolve('./registry.js')];
    assert.strictEqual(require('./registry.js').keys.length, registry.keys.length);
    delete process.env.GC_EXCLUDE;
});

test('GC_EXCLUDE refuses a name that is not a feature', function () {
    // A typo'd exclusion that is ignored trains the FULL set and reports it
    // as the reduced one — the same shape of lie as a gate that cannot fail.
    var threw = false, msg = '';
    try {
        cp.execSync('GC_EXCLUDE=stairkase node train.js 1 4 replace 1 score 2>&1',
            { cwd: DIR, shell: '/bin/bash', stdio: 'pipe' });
    } catch (e) { threw = true; msg = String(e.stdout || '') + String(e.stderr || ''); }
    assert.ok(threw, 'a misspelled feature name must stop the run, not be ignored');
    assert.ok(/is not a feature/.test(msg), 'and must say so: ' + msg.slice(0, 200));
});

test('a snapshot records which features its run searched', function () {
    // Two runs that differ only by their feature set produce weight sets
    // that cannot be told apart from the numbers alone.
    var code = fs.readFileSync(path.join(DIR, 'train.js'), 'utf8');
    assert.ok(/features: KEYS\.slice\(\)/.test(code),
        'the result must carry the feature list it was trained on');
    assert.ok(/excluded: EXCLUDE\.slice\(\)/.test(code),
        'and what was deliberately left out');
});

test('GC_GA_SEED reaches the search, and a different seed walks a different one', function () {
    // WHY THIS EXISTS: runs 5 and 6 finished at 3397 at generation 360 BOTH
    // TIMES and were read as a result and its reproduction. They were one
    // search walked twice — GC_GA_SEED defaults to a constant and no caller
    // set it. Without a varying seed the search's own spread cannot be
    // measured, and without that number a variant at 2883 against a baseline
    // at 3397 cannot be told from the baseline's own 3784 -> 3146 -> 3397
    // wobble. Verified by running the search rather than by reading the
    // source, because the source has been right and the wiring wrong before.
    var code = fs.readFileSync(path.join(DIR, 'train.js'), 'utf8');
    assert.ok(/rngState = Number\(process\.env\.GC_GA_SEED \|\| \d+\)/.test(code),
        'the search RNG must seed from GC_GA_SEED with a default, or runs cannot be varied');

    function run(seed) {
        return cp.execSync('GC_LEVEL=10 GC_BRAIN=puyo GC_ARENA=comboStorm GC_GA_SEED=' + seed +
            ' node train.js 1 2 replace 2 score 2>&1 | grep -E "^gen |weights:" | head -2',
            { cwd: DIR, shell: '/bin/bash', timeout: 600000 }).toString();
    }
    var a = run(31415926), b = run(27182818);
    assert.ok(a.length && b.length, 'a one-generation run must report something');
    assert.notStrictEqual(a, b,
        'two seeds produced an IDENTICAL first generation, so the seed is not reaching the ' +
        'search and every "independent" run is a replay:\n' + a + '\n' + b);
});

test('the training workflow exposes exclude, variant and ga_seed, and wires each to its env', function () {
    // A dispatch input that is declared but never passed to the step reads
    // as a working knob and does nothing — which is what GC_GA_SEED was
    // before it was an input at all. Both halves are checked.
    var wf = fs.readFileSync(path.join(DIR, '..', '..', '..', '..',
                                       '.github', 'workflows', 'ai-train.yml'), 'utf8');
    // depth/beam are here because they were the half of the lookahead bug
    // nobody looked for: train.js read GC_DEPTH, fingerprinted it, and
    // recorded it on every snapshot, while the workflow offered no way to
    // set it. A knob is not wired until it is wired end to end.
    [['exclude', 'GC_EXCLUDE'], ['variant', 'GC_VARIANT'], ['ga_seed', 'GC_GA_SEED'],
     ['depth', 'GC_DEPTH'], ['beam', 'GC_BEAM'], ['rise', 'GC_RISE']]
        .forEach(function (pair) {
            var input = pair[0], env = pair[1];
            assert.ok(new RegExp('^\\s+' + input + ':', 'm').test(wf),
                'the workflow does not offer a "' + input + '" input');
            assert.ok(new RegExp(env + ':\\s*\\$\\{\\{ github\\.event\\.inputs\\.' + input).test(wf),
                env + ' is not wired to the ' + input + ' input, so the knob does nothing');
        });
    // Blank must mean "as before": every consumer treats the empty string as
    // absent, so a run that sets nothing behaves exactly like every run
    // dispatched before these inputs existed.
    var train = fs.readFileSync(path.join(DIR, 'train.js'), 'utf8');
    assert.ok(/process\.env\.GC_EXCLUDE \|\| ''/.test(train));
    assert.ok(/process\.env\.GC_GA_SEED \|\| \d+/.test(train));
    assert.ok(/Number\(process\.env\.GC_DEPTH \|\| 1\)/.test(train));
    assert.ok(/Number\(process\.env\.GC_BEAM \|\| \d+\)/.test(train));
    assert.ok(/process\.env\.GC_RISE === '1'/.test(train));
    var crank = fs.readFileSync(path.join(DIR, 'crank.sh'), 'utf8');
    assert.ok(/VARIANT=\$\{GC_VARIANT:-\}/.test(crank));
});

test('the workflow runs one experiment per concurrency group, not one in total', function () {
    // GitHub keeps a single PENDING run per group. Under one shared group,
    // dispatching two variants back to back cancels the first silently and
    // leaves two experiments looking like one.
    var wf = fs.readFileSync(path.join(DIR, '..', '..', '..', '..',
                                       '.github', 'workflows', 'ai-train.yml'), 'utf8');
    assert.ok(/group: ai-train-\$\{\{ github\.event\.inputs\.variant/.test(wf),
        'the concurrency group must be keyed by variant or parallel experiments cancel ' +
        'each other');
});

test('the worker forwards EVERY option train.js sends, not a hand-written list', function () {
    // THE BUG THIS EXISTS FOR. train_worker.js rebuilt the options object
    // field by field, so every option added to train.js after that line was
    // written stopped dead there. depth and beam were added for the
    // lookahead experiment, recorded faithfully in every snapshot, and never
    // reached the bot: three "depth 2" runs were greedy runs wearing a
    // depth-2 label. They were caught only because they matched their
    // depth-1 controls to the digit — noise does not repeat to the last
    // digit — and not by anything that was watching.
    var code = fs.readFileSync(path.join(DIR, 'train_worker.js'), 'utf8');
    assert.ok(/Object\.keys\(job\)\.forEach/.test(code),
        'the worker is rebuilding its options object by hand again, so every option ' +
        'added to train.js after that line will silently stop there');
    assert.ok(!/mode: job\.mode, checkTiming: job\.checkTiming/.test(code),
        'the hand-written key list is back');
    // And the list train.js SENDS must be the list it means to send — if a
    // new option is added to the search and not to the job, the forward
    // above cannot save it.
    var train = fs.readFileSync(path.join(DIR, 'train.js'), 'utf8');
    assert.ok(/depth: DEPTH, beam: BEAM/.test(train),
        'train.js no longer sends depth/beam with the job');
});

test('depth REACHES THE BOT, end to end through bench', function () {
    // The source check above covers train.js -> worker. This covers
    // worker -> bench -> PuyoCpu, which is the half that was broken, and it
    // does it by playing: the same weights and the same seed at depth 1 and
    // depth 2 must produce DIFFERENT games. If they match, the option is
    // being dropped somewhere in that chain and every lookahead result is a
    // greedy result wearing a label.
    //
    // Deliberately not a source check. The defect was invisible in the
    // source too — a list of six plausible fields looks exactly like a
    // complete one.
    process.env.GC_LEVEL = '10';
    var bench = require('./bench.js');
    var W = { matchPotential: 229, chainPotential: 258, colourVariance: 168,
              maxHeight: 136, roughness: 294, garbageSent: 107, travelCost: 10 };
    var one = bench.run(W, 1, { scenario: 'comboStorm', brain: 'puyo', mode: 'replace',
                                checkTiming: false, depth: 1 });
    var two = bench.run(W, 1, { scenario: 'comboStorm', brain: 'puyo', mode: 'replace',
                                checkTiming: false, depth: 2, beam: 3 });
    assert.notStrictEqual(one.frames + ':' + one.score, two.frames + ':' + two.score,
        'depth 1 and depth 2 played an IDENTICAL game (' + one.frames + ' frames, ' +
        one.score + ' points) on the same seed and weights — the depth option is not ' +
        'reaching the bot, so every lookahead run is a greedy run with a label on it');
});

test('rise REACHES THE BOT, end to end through bench', function () {
    // WRITTEN BECAUSE IT WAS ALREADY BROKEN ONCE, the same day, in the same
    // place: bench.js builds PuyoCpu's options by hand, so a new option is
    // dropped there by default and every run "with" it is a run without it.
    // depth was the first. rise was the second, and it was caught only
    // because the on and off sweeps came back equal to the last digit —
    // noise does not repeat to the last digit.
    process.env.GC_LEVEL = '10';
    var bench = require('./bench.js');
    var W = { matchPotential: 229, chainPotential: 258, colourVariance: 168,
              maxHeight: 136, roughness: 294, garbageSent: 107, travelCost: 10 };
    var off = bench.run(W, 1, { scenario: 'comboStorm', brain: 'puyo', mode: 'replace',
                                checkTiming: false });
    var on = bench.run(W, 1, { scenario: 'comboStorm', brain: 'puyo', mode: 'replace',
                               checkTiming: false, rise: true });
    assert.notStrictEqual(off.frames + ':' + off.score, on.frames + ':' + on.score,
        'rise on and rise off played an IDENTICAL game (' + off.frames + ' frames, ' +
        off.score + ' points) on the same seed and weights — the rise option is not ' +
        'reaching the bot, so every run measuring it would measure nothing');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
