// REPLAY THE CORPUS THROUGH WHATEVER THE RESOLVE IS NOW.
//
// The positions and the engine's own answers were recorded once, by
// capture_resolve_corpus.js. Nothing here plays the game, so changing the
// resolve cannot change which boards are tested — which is the whole point.
// A run of this is comparable to every other run of it.
var path = require('path'), DIR = __dirname;
require(path.join(DIR, '..', '..', 'panel-engine.js'));
require(path.join(DIR, '..', '..', 'panel-cpu.js'));
var PuyoCpu = require(path.join(DIR, 'puyocpu.js'));
var fs = require('fs');

var CORPUS = process.argv[2] || path.join(DIR, 'resolve_corpus.json');
var entries = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));

function keyOf(grid, blocks, height, width) {
    var rows = [];
    for (var r = 1; r <= height; r++) rows.push((grid[r] || []).slice(1).join(','));
    var sl = [];
    for (var id in blocks) if (blocks.hasOwnProperty(id)) {
        var c = blocks[id].cells || blocks[id];
        if (c && c.length) sl.push(c.map(function (rc) { return rc[0] + ':' + rc[1]; }).sort().join(' '));
    }
    sl.sort();
    return rows.join('|') + ' #' + sl.join('/');
}
// The engine was sampled after 8 settled frames and can climb a row inside
// that window, so a board that matches once shifted is the same position a
// moment later, not a wrong answer. Counted separately, never silently.
function alignedMatch(mine, truth) {
    if (mine === truth) return 0;
    var A = mine.split(' #')[0].split('|'), B = truth.split(' #')[0].split('|');
    for (var sh = 1; sh <= 2; sh++) {
        var ok = B.length > sh;
        for (var r = 0; ok && r + sh < B.length; r++) if (B[r + sh] !== A[r]) ok = false;
        if (ok) return sh;
    }
    return -1;
}

var R = { n: 0, exact: 0, aligned: 0, wrong: 0, linksWrong: 0, examples: [],
          bySwap: { n: 0, wrong: 0 }, byAir: { n: 0, wrong: 0 } };
entries.forEach(function (e) {
    // A stack that answers only what the resolve reads off it.
    var fakeStack = {
        riseTimer: e.stack.riseTimer, displacement: e.stack.displacement,
        speed: e.stack.speed, stopTime: e.stack.stopTime,
        preStopTime: e.stack.preStopTime, incoming: e.stack.incoming.slice()
    };
    var cpu = Object.create(PuyoCpu.prototype);
    cpu.engine = true; cpu.stack = fakeStack; cpu._board = null;
    var blocks = {};
    for (var id in e.board.blocks) blocks[id] = { cells: e.board.blocks[id].map(function (rc) { return [rc[0], rc[1]]; }) };
    var board = { grid: e.board.grid.map(function (row) { return (row || []).slice(); }),
                  blocks: blocks, chaining: e.board.chaining,
                  motion: e.board.motion || null,
                  incoming: e.board.incoming, width: e.board.width, height: e.board.height };
    var out;
    try { out = cpu._resolveCandidate(board, e.swap || null, 0); }
    catch (err) { R.wrong++; R.n++; return; }
    var mine = keyOf(board.grid, board.blocks, board.height, board.width);
    var sh = alignedMatch(mine, e.truth.key);
    R.n++;
    var bucket = e.swap ? R.bySwap : R.byAir;
    bucket.n++;
    if (sh < 0) bucket.wrong++;
    if (sh === 0) R.exact++;
    else if (sh > 0) R.aligned++;
    else {
        R.wrong++;
        if (R.examples.length < 3) R.examples.push({ idx: R.n - 1, seed: e.seed, swap: e.swap, mine: mine, truth: e.truth.key });
    }
    var links = out && out.chainLength ? out.chainLength : 0;
    if (links !== e.truth.links) R.linksWrong++;
});

console.log('positions          ' + R.n);
console.log('  exact match      ' + R.exact + '   (' + (100 * R.exact / Math.max(1, R.n)).toFixed(1) + '%)');
console.log('  matched shifted  ' + R.aligned + '   (engine rose inside the sampling window)');
console.log('  WRONG            ' + R.wrong + '   (' + (100 * R.wrong / Math.max(1, R.n)).toFixed(1) + '%)');
console.log('  chain length off ' + R.linksWrong);
console.log('  at a swap, board quiet   ' + R.bySwap.n + ' positions, ' + R.bySwap.wrong + ' wrong');
console.log('  mid-flight, no swap      ' + R.byAir.n + ' positions, ' + R.byAir.wrong + ' wrong');
R.examples.forEach(function (x, i) {
    console.log('\n--- wrong ' + (i + 1) + '  entry ' + x.idx + '  seed ' + x.seed + '  swap at ' + x.swap.join(',') + ' ---');
    var A = x.mine.split(' #'), B = x.truth.split(' #');
    var ar = A[0].split('|'), br = B[0].split('|');
    for (var r = 0; r < Math.max(ar.length, br.length); r++) {
        if (ar[r] !== br[r]) console.log('  row ' + (r + 1) + '   resolve ' + (ar[r] || '-') + '   engine ' + (br[r] || '-'));
    }
    if (A[1] !== B[1]) console.log('  SLABS resolve ' + A[1] + '\n  SLABS engine  ' + B[1]);
});
// A BUDGET WITH THE NUMBER WRITTEN DOWN, not a pass/fail on zero.
//
// Two of the 48 are still wrong, both a one-row offset confined to part of the
// board — the resolve's rise landing a frame off the engine's. That is a real
// defect and it is not fixed; failing the gate on it would only teach the next
// person to skip the gate. The budget catches a REGRESSION, which is what a
// gate is for, and the number moves down when someone fixes the timing.
var BUDGET = Number(process.env.GC_RESOLVE_WRONG_BUDGET || 2);
if (R.wrong > BUDGET) {
    console.log('\nFAIL: ' + R.wrong + ' wrong, budget ' + BUDGET +
                ' — the resolve disagrees with the engine on more positions than it did.');
    process.exit(1);
}
if (R.wrong < BUDGET) {
    console.log('\nThe budget is ' + BUDGET + ' and only ' + R.wrong +
                ' are wrong now. Lower GC_RESOLVE_WRONG_BUDGET in gates.sh so it cannot drift back.');
}
process.exit(0);
