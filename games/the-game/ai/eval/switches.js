// A WEIGHT SET IS ONLY A BOT WHEN PAIRED WITH THE SWITCHES IT WAS FOUND UNDER.
//
// RULE: nothing loads weights and then decides separately how to score them.
// It asks here, and gets both.
//
// WHY THIS IS A FILE AND NOT THREE COPIES OF FOUR LINES. Every measuring tool
// in here grew its own hand-written list of switches, and every one of them
// lost a different switch:
//
//   - a probe hooked evaluator.evaluate(i, w) and dropped the third argument,
//     so a density sweep printed identical numbers on and off;
//   - behaviour.js read GC_DENSITY but never depth or beam, so a depth-2
//     snapshot was measured playing greedy — it carried a comment saying a
//     bot is its weights AND its switches while doing exactly that;
//   - puzzles.bench.js took density only from GC_DENSITY, so benchmarking a
//     snapshot meant remembering to type the flag that matched it;
//   - duel.js hand-wrote the options until export_weights.js started writing
//     a `switches` object for it to spread.
//
// The shipped set scores 14780 under depth 1 and 2550 under depth 2. That is
// the size of the mistake: a third of the score, from a flag nobody typed.
//
// SHAPE. A training snapshot records the switches at its top level
// (depth/beam/rise/density); trained-weights.js carries them in .switches.
// Both are handled, and an environment variable overrides either — that is
// for deliberately running one bot's weights under another's scoring, which
// is a real experiment, so it prints "(forced)" rather than being silent.
var fs = require('fs');
var path = require('path');

function envFlag(name) {
    var v = process.env[name];
    if (v === undefined || v === '') return undefined;
    return v === '1' || v === 'true';
}

function envNum(name) {
    var v = process.env[name];
    if (v === undefined || v === '') return undefined;
    var n = Number(v);
    return isFinite(n) ? n : undefined;
}

// load([file]) -> { weights, switches: {depth,beam,rise,density}, source, forced }
// file defaults to process.env.GC_WEIGHTS, and with neither it is the shipped set.
function load(file) {
    var f = file || process.env.GC_WEIGHTS;
    var weights, sw, source;
    if (f) {
        var snap = JSON.parse(fs.readFileSync(f, 'utf8'));
        weights = snap.weights || (snap.elite && snap.elite.weights);
        if (!weights) throw new Error(f + ' has no weights in it');
        // A snapshot records them flat; anything exported records .switches.
        sw = snap.switches || snap;
        source = f;
    } else {
        require(path.join(__dirname, '..', 'trained-weights.js'));
        var t = (typeof window !== 'undefined' ? window : globalThis).PanelEval.trained;
        weights = t.weights;
        sw = t.switches || {};
        source = 'shipped (trained-weights.js)';
    }

    var out = {
        depth: sw.depth === undefined ? 1 : Number(sw.depth),
        beam: sw.beam === undefined ? 6 : Number(sw.beam),
        rise: sw.rise === true,
        density: sw.density === true
    };

    var forced = [];
    var e;
    if ((e = envNum('GC_DEPTH')) !== undefined) { out.depth = e; forced.push('depth'); }
    if ((e = envNum('GC_BEAM')) !== undefined) { out.beam = e; forced.push('beam'); }
    if ((e = envFlag('GC_RISE')) !== undefined) { out.rise = e; forced.push('rise'); }
    if ((e = envFlag('GC_DENSITY')) !== undefined) { out.density = e; forced.push('density'); }

    return { weights: weights, switches: out, source: source, forced: forced };
}

// One line, printed by every tool, so a reader of the output never has to
// guess which bot produced it.
function describe(loaded) {
    var s = loaded.switches;
    return 'weights ' + loaded.source +
        '  [depth ' + s.depth + ' beam ' + s.beam +
        ' rise ' + (s.rise ? 'ON' : 'off') +
        ' density ' + (s.density ? 'ON' : 'off') + ']' +
        (loaded.forced.length ? '  (forced by env: ' + loaded.forced.join(', ') + ')' : '');
}

module.exports = { load: load, describe: describe };
