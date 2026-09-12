#!/usr/bin/env node
// chips-engine-only/ MUST NOT BECOME A PLACE TO DODGE A GATE.
//
//   node chips.engineonly.test.js
//
// chips/ holds templates that clear BOTH verifiers. chips-engine-only/ holds
// ones that clear only the engine — the game itself — because LogicalBoard
// gets them wrong. That is a real distinction and worth keeping, but it is
// one loosened rule away from being a dumping ground: move a chip that fails
// for any other reason into that directory and it stops being checked by the
// simulation, quietly, with no gate going red.
//
// So membership is asserted in BOTH directions. A chip in there must pass the
// engine AND fail the simulation. A chip that passes both belongs in chips/;
// a chip that fails both belongs in neither.
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var DIR = __dirname;
var eoDir = path.join(DIR, 'chips-engine-only');
if (!fs.existsSync(eoDir)) { console.log('no chips-engine-only/ yet — nothing to check'); process.exit(0); }
var files = fs.readdirSync(eoDir).filter(function (f) { return /\.json$/.test(f); }).sort();
var all = [];
files.forEach(function (f) {
    JSON.parse(fs.readFileSync(path.join(eoDir, f), 'utf8')).forEach(function (c) {
        c._file = f;
        all.push(c);
    });
});
if (!all.length) { console.log('chips-engine-only/ is empty'); process.exit(0); }

var work = fs.mkdtempSync(path.join(DIR, '.engineonly-'));
process.on('exit', function () { try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {} });
var chipFile = path.join(work, 'chips.json');
fs.writeFileSync(chipFile, JSON.stringify(all));

function verdicts(script) {
    var out = path.join(work, script + '.verdicts.json');
    try {
        cp.execFileSync('node', [path.join(DIR, script), chipFile],
                        { cwd: DIR, stdio: 'ignore',
                          env: Object.assign({}, process.env, { GC_CHIP_JSON: out }) });
    } catch (e) { /* non-zero is expected: these fail the simulation by design */ }
    var data = JSON.parse(fs.readFileSync(out, 'utf8'));
    if (data.results.length !== all.length) {
        throw new Error(script + ' returned ' + data.results.length + ' verdicts for ' + all.length + ' chips');
    }
    return data.results;
}

var eng = verdicts('verify_chips_engine.js');
var sim = verdicts('verify_chips.js');

var notEngine = [], alsoSim = [];
for (var i = 0; i < all.length; i++) {
    if (eng[i].verdict !== 'ok') notEngine.push(all[i]);
    if (sim[i].verdict === 'ok') alsoSim.push(all[i]);
}

console.log(all.length + ' chips in chips-engine-only/, from ' + files.join(', ') + '\n');
var bad = false;
if (notEngine.length) {
    bad = true;
    console.log('  FAIL  ' + notEngine.length + ' do not fire on the real engine either — they belong in neither directory');
    notEngine.slice(0, 5).forEach(function (c) { console.log('        ' + c.kind + ' (' + c._file + ')'); });
} else {
    console.log('  PASS  every chip fires on the real engine');
}
if (alsoSim.length) {
    bad = true;
    console.log('  FAIL  ' + alsoSim.length + ' also pass the SIMULATION — those belong in chips/, under both gates');
    alsoSim.slice(0, 5).forEach(function (c) { console.log('        ' + c.kind + ' (' + c._file + ')'); });
} else {
    console.log('  PASS  every chip fails the simulation, which is why it is here');
}

if (bad) process.exit(1);
console.log('\nchips-engine-only/ earns its name in both directions.');
