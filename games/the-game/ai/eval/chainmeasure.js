// CAN THIS WEIGHT SET BUILD A CHAIN? — the one place that answers it.
//
// WHY IT IS A MODULE AND NOT SIX LINES INSIDE train.js. Score cannot tell you
// whether a bot learned to chain: one that survives and makes small clears
// scores respectably and never fires a four-chain. The trainer reported score
// alone for its whole life, which is how "no effect" kept being the answer to
// every experiment about chains. So the trainer reports this beside score —
// and the moment a second caller wants the same number, a copy of the recipe
// is a copy that drifts.
//
// IT READS DATA, IT DOES NOT SCRAPE PROSE. The first version regexed the
// "FIRED A CHAIN" line off puzzles.play.js's stdout. That is the failure this
// repo has already paid for twice (CLAUDE.md, "NEVER PARSE A TOOL'S PROSE"):
// a padding change or a short read through a pipe turns into a wrong number
// that looks like a result. puzzles.play.js writes GC_PLAY_JSON; this reads it.
//
// AND IT ASSERTS THE COUNT CAME BACK WHOLE. A run that played 40 of 84 chain
// puzzles reports a lower `fired`, which is indistinguishable by eye from a
// bot that chains less. Fewer played than found is a BROKEN RUN, not a score,
// and it throws. `chainmeasure.test.js` proves that throw fires, because an
// assertion nobody has seen reject anything is an assertion nobody knows works.
var path = require('path');
var fs = require('fs');
var child = require('child_process');

var PLAY = path.join(__dirname, 'puzzles.play.js');

// measure({ weights, switches }, opts) -> { attempted, played, fired, ... }
//
// `spec` null means "whatever the game ships" — switches.js falls back to
// trained-weights.js when GC_WEIGHTS is blank, so the shipped set is measured
// through exactly the same path as a candidate rather than quoted from a
// comment. The first version of this printed "shipped weights manage 10 / 84"
// from memory; the real figure was 9.
function measure(spec, opts) {
    opts = opts || {};
    var play = opts.play || PLAY;
    // Scratch beside the tool, never os.tmpdir() — a parent writing there and
    // a child reading an empty file is a failure this repo has already had.
    var stem = path.join(__dirname, '.chainmeasure.' + process.pid + '.' +
                         Math.random().toString(36).slice(2));
    var wfile = stem + '.weights.json';
    var rfile = stem + '.result.json';
    var env = Object.assign({}, process.env, opts.env || {}, { GC_PLAY_JSON: rfile });
    try {
        if (spec) {
            fs.writeFileSync(wfile, JSON.stringify(spec));
            env.GC_WEIGHTS = wfile;
        } else {
            env.GC_WEIGHTS = '';
        }
        child.execFileSync(process.execPath, [play], {
            env: env, encoding: 'utf8', timeout: opts.timeout || 600000
        });
        if (!fs.existsSync(rfile)) {
            throw new Error('wrote no result file — it reported nothing at all');
        }
        var j = JSON.parse(fs.readFileSync(rfile, 'utf8'));
        if (j.played !== j.attempted) {
            throw new Error('played ' + j.played + ' of ' + j.attempted +
                            ' chain puzzles — incomplete, not a score');
        }
        return j;
    } finally {
        [wfile, rfile].forEach(function (f) { try { fs.unlinkSync(f); } catch (e) {} });
    }
}

module.exports = { measure: measure, PLAY: PLAY };
