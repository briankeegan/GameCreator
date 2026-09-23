// TWO VARIANTS ON ONE SEED MUST NOT SHARE A POPULATION. Run: node pbt_dirs.test.js
//
// The island files are a resume point. Keyed by ga_seed alone, two variants
// dispatched on the same seed open the same four files: each leg loads what
// the other just wrote, both keep committing snapshots, and from outside
// both chains look healthy. `default` and `r17` ran that way on seed 317 for
// a day -- 211 island writes from one and 109 from the other into the same
// directory -- and nothing reported it, because nothing counted the writers.
//
// So: the directory is named for the RUN, and the fingerprint carries the
// run's name as well, so a stray file that lands in the wrong place is
// refused rather than resumed.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var child = require('child_process');

var DIR = __dirname;
var failures = [], tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// Ask the trainer itself where it would keep state and what it would refuse
// to resume, without letting it run a single duel. GC_PBT_INIT_ONLY exists
// for exactly this.
function probe(env) {
    var e = Object.assign({}, process.env, {
        GC_PBT_INIT_ONLY: '1', GC_LEVEL: '10', GC_PBT_ISLANDS: '2',
        GC_VS_POPULATION: '4', GC_MIN_POP: '1'
    }, env);
    var out = child.execFileSync(process.execPath, [path.join(DIR, 'train_pbt.js')],
                                 { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    var m = out.match(/state in (\S+)/);
    return { dir: m && m[1], out: out };
}

test('two variants on the same seed get different directories', function () {
    var a = probe({ GC_TAG: 'pbt-tA-s909', GC_GA_SEED: '909' });
    var b = probe({ GC_TAG: 'pbt-tB-s909', GC_GA_SEED: '909' });
    assert.ok(a.dir, 'no state directory reported: ' + a.out);
    assert.notStrictEqual(a.dir, b.dir,
        'both variants kept state in ' + a.dir + ' — this is the seed-317 collision');
});

test('the same variant on the same seed RESUMES its own directory', function () {
    // The separation must not be so thorough that a chain cannot continue
    // itself, which would quietly restart every run at generation 0.
    var a = probe({ GC_TAG: 'pbt-tC-s908', GC_GA_SEED: '908' });
    var b = probe({ GC_TAG: 'pbt-tC-s908', GC_GA_SEED: '908' });
    assert.strictEqual(a.dir, b.dir);
    assert.ok(/resum|island/i.test(b.out), 'second run said nothing about resuming:\n' + b.out);
});

test('an island file from another run is refused, not adopted', function () {
    // Belt and braces: even copied into the right directory by hand, a
    // foreign population must not be resumed.
    var a = probe({ GC_TAG: 'pbt-tD-s907', GC_GA_SEED: '907' });
    var b = probe({ GC_TAG: 'pbt-tE-s907', GC_GA_SEED: '907' });
    var src = path.join(a.dir.charAt(0) === '.' ? path.join(DIR, a.dir) : a.dir, 'island0.json');
    var dst = path.join(b.dir.charAt(0) === '.' ? path.join(DIR, b.dir) : b.dir, 'island0.json');
    fs.copyFileSync(src, dst);
    var again = probe({ GC_TAG: 'pbt-tE-s907', GC_GA_SEED: '907' });
    assert.ok(/searching something else/.test(again.out),
        'a foreign island was resumed:\n' + again.out);
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
// Scratch beside the test, cleaned up here rather than left in the checkout.
['pbt-tA-s909', 'pbt-tB-s909', 'pbt-tC-s908', 'pbt-tD-s907', 'pbt-tE-s907'].forEach(function (t) {
    try { fs.rmSync(path.join(DIR, '.' + t), { recursive: true, force: true }); } catch (e) { /* gone */ }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
