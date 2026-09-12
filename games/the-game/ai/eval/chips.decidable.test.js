#!/usr/bin/env node
// IS EVERY PORTED CHIP INDIVIDUALLY DECIDABLE?
//
//   node chips.decidable.test.js
//
// chips.test.sh proves the VERIFIERS can fail: break one and the run goes
// red. That is a different claim from the one that matters here. A verifier
// that rejects damage somewhere in a 4,380-chip batch says nothing about
// whether any PARTICULAR chip is being tested — a chip whose staging happens
// to satisfy its claim trivially would pass forever, and the batch would
// still look green because the other 4,379 carry it.
//
// So this corrupts EVERY chip's OWN claim, one chip at a time, and requires
// the verifier to reject that chip. A chip that still passes while claiming
// something untrue is not being checked by anything.
//
// WHAT IT ALREADY CAUGHT, and it is about this test rather than the chips:
// the first mutation was "claim one more chain link", and 787 chips survived
// it in the SIMULATION. All but seven of them are chips claiming chain 0.
// LogicalBoard.resolve() counts match-and-settle ROUNDS, so verify_chips.js
// compares against Math.max(1, chip.chain) — which maps chain 0 and chain 1
// to the same expected round count. For a plain combo those two claims ARE
// the same statement, so the mutation was invisible rather than the check
// being blind.
//
// The engine verifier caught all 787, because the engine's chain counter goes
// 0 -> 2 and is never 1, so a claim of 1 is impossible there. That asymmetry
// is worth keeping in mind: the simulation is the weaker of the two gates on
// chain depth, and it is only safe because nothing ships on one gate.
//
// The mutation is +2 for that reason: distinguishable in both units.
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var DIR = __dirname;
var chipDir = path.join(DIR, 'chips');
var files = fs.readdirSync(chipDir).filter(function (f) { return /\.json$/.test(f); }).sort();
var all = [];
files.forEach(function (f) {
    JSON.parse(fs.readFileSync(path.join(chipDir, f), 'utf8')).forEach(function (c) {
        c._file = f;
        all.push(c);
    });
});
if (!all.length) { console.error('no chips to check'); process.exit(1); }

// Scratch files live BESIDE this test, not in os.tmpdir(). The first version
// used the system temp dir and the child process read an EMPTY file from it —
// the parent's write and the child's read were not looking at the same place
// in this sandbox. That failed as "0 verdicts for 4380 chips", which reads
// like the verifier collapsing rather than like a path problem.
var work = fs.mkdtempSync(path.join(DIR, '.decidable-'));
var tmp = path.join(work, 'chips.json');
var out = path.join(work, 'verdicts.json');
process.on('exit', function () {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
});

// READ THE VERDICTS AS DATA, NEVER FROM THE PROSE.
//
// This function previously parsed the verifier's printed lines, and it was
// wrong twice in one sitting for two different reasons: a chip kind longer
// than the column padding ran into the word "ok" so the line failed the
// regex, and then reading 4,380 lines back through a pipe produced a SHORT
// READ that varied between runs — 1,200 undamaged chips "rejected" one run,
// 1,201 the next. A number that moves when nothing moved is the tell.
//
// GC_CHIP_JSON makes the verifier write one entry per chip, and the count is
// asserted against the number of chips sent. A short or partial result is now
// an error that says so instead of a plausible-looking pile of failures.
var lastOut = '';
function verdicts(script, chips) {
    lastOut = '';
    fs.writeFileSync(tmp, JSON.stringify(chips));
    try { fs.unlinkSync(out); } catch (e) {}
    try {
        cp.execFileSync('node', [path.join(DIR, script), tmp],
                        { cwd: DIR, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024,
                          env: Object.assign({}, process.env, { GC_CHIP_JSON: out }) });
    } catch (e) { lastOut = (e.stdout || '') + (e.stderr || ''); }
    if (!fs.existsSync(out)) throw new Error(script + ' wrote no verdict file');
    var data = JSON.parse(fs.readFileSync(out, 'utf8'));
    if (data.results.length !== chips.length) {
        throw new Error(script + ' [child saw ' + data.chips + ' chips, file ' + fs.statSync(tmp).size + ' bytes] returned ' + data.results.length +
                        ' verdicts for ' + chips.length + ' chips\n' + lastOut.split('\n').slice(-6).join('\n'));
    }
    return data.results.map(function (r) { return r.verdict === 'ok' ? 'ok' : 'no'; });
}

function mutate(fn) {
    return all.map(function (c) {
        var m = JSON.parse(JSON.stringify(c));
        fn(m);
        return m;
    });
}

var CASES = [
    { name: 'claims two more chain links than it fires',
      fn: function (m) { m.chain = (m.chain || 0) + 2; } },
    { name: 'claims three more panels cleared than it clears',
      fn: function (m) { m.total = (m.total || 0) + 3; } },
    { name: 'claims three fewer panels cleared than it clears',
      fn: function (m) { m.total = Math.max(0, (m.total || 0) - 3); } }
];

var failures = [];
console.log(all.length + ' ported chips, each corrupted individually\n');
['verify_chips.js', 'verify_chips_engine.js'].forEach(function (script) {
    // The undamaged set must pass first, or "it rejected the damage" means
    // nothing — a verifier that rejects everything rejects damage too.
    var clean = verdicts(script, all);
    var cleanOk = clean.filter(function (v) { return v === 'ok'; }).length;
    if (cleanOk !== all.length) {
        console.log('  ' + script + ': rejects ' + (all.length - cleanOk) +
                    ' UNDAMAGED chips — nothing below means anything');
        failures.push(script + ' fails on the undamaged set');
        return;
    }
    CASES.forEach(function (c) {
        var v = verdicts(script, mutate(c.fn));
        var survived = [];
        for (var i = 0; i < v.length && i < all.length; i++) {
            if (v[i] === 'ok') survived.push(all[i]);
        }
        var tag = '  ' + script.replace('.js', '').padEnd(22) + c.name;
        if (survived.length) {
            console.log(tag + '\n      ' + survived.length + ' chips still passed, e.g. ' +
                survived.slice(0, 3).map(function (s) { return s.kind + ' (' + s._file + ')'; }).join(', '));
            failures.push(script + ': ' + survived.length + ' chips survive "' + c.name + '"');
        } else {
            console.log(tag + '  — all ' + all.length + ' rejected');
        }
    });
});

if (failures.length) {
    console.error('\nNOT DECIDABLE:\n  - ' + failures.join('\n  - '));
    process.exit(1);
}
console.log('\nEvery ported chip is individually decidable, on both boards.');
