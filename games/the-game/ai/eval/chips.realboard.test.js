#!/usr/bin/env node
// DO THE CHIPS HOLD ON BOARDS WE DID NOT BUILD?
//
// This is the gate that answers the caveat the other two cannot. Both
// verifiers stage a chip onto a board THIS REPO CONSTRUCTS — colour slots
// placed where the template says, blockers invented, and filler chosen
// specifically so it can never take part in the chip (the per-column
// distinct-colour scheme in verify_chips_engine.js). That staging is
// necessary and it is also the whole of the doubt: a live board offers no
// such choice, its don't-care cells hold real colours, and real colours can
// join a match and change what the chip does.
//
// So: take boards the shipped bot actually played (realboards.json, written
// by capture_boards.js), find chips that genuinely occur on them, fire each
// chip's own swaps on a LIVE Stack settled to stillness, and compare against
// what the chip claims.
//
// MEASURED, 3,320 real settled boards, the whole library:
//
//   145  distinct chips ever located at all — 2.6% of 5,672. The library is
//        mostly shapes this game does not produce, which is worth knowing
//        before anyone builds a feature on top of it.
//    94% of located chips cleared something
//    83% hit the claimed chain depth exactly
//    74% hit chain AND panel count exactly
//
// The floors below sit under those with margin. They exist to catch a
// REGRESSION, not to certify the percentages: a matcher that stops enforcing
// its colour slots matches everything and fires nothing, which is exactly
// what happened (see the Int32Array note in chipmatch.js) and what the
// "cleared something" floor is aimed at.
var assert = require('assert');
var path = require('path'), fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var eb = require('./engineboard.js');
var cm = require('./chipmatch.js');
var W = globalThis.PanelEngine.WIDTH, H = 12;

// Measured 2026-09-12 on the committed fixture; see the header.
var FLOOR_FIRES = 0.85;   // measured 94%
var FLOOR_CHAIN = 0.70;   // measured 83%
var FLOOR_BOTH  = 0.55;   // measured 74%
var FLOOR_FOUND = 60;     // measured 145 distinct chips located

var fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));
assert.ok(fixture.boards.length > 500, 'fixture is too small to mean anything');

function gridOf(str) {
    var g = [];
    for (var r = 0; r <= H; r++) { g[r] = []; for (var c = 1; c <= W; c++) g[r][c] = 0; }
    var i = 0;
    for (r = 1; r <= H; r++) for (var c2 = 1; c2 <= W; c2++) {
        var ch = str[i++];
        g[r][c2] = ch === 'G' ? -2 : Number(ch);
    }
    return g;
}

var chips = [];
['chips', 'chips-engine-only'].forEach(function (d) {
    var dir = path.join(__dirname, d);
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort().forEach(function (f) {
        JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).forEach(function (c) { chips.push(c); });
    });
});

var lib = chips.map(function (c) {
    var t = cm.compile(c);
    var minR = Math.min.apply(null, c.tmpl.map(function (x) { return x[0]; }));
    var minC = Math.min.apply(null, c.tmpl.map(function (x) { return x[1]; }));
    t.swaps = c.swaps.map(function (s) { return [s[0] - minR, s[1] - minC]; });
    t.claimChain = c.chain; t.claimTotal = c.total; t.kind = c.kind;
    return t;
});

var stack = eb.scratch(10);
stack.speed = 0;
var tested = 0, fires = 0, chainOk = 0, bothOk = 0;
var seen = {};
for (var bi = 0; bi < fixture.boards.length; bi++) {
    var grid = gridOf(fixture.boards[bi]);
    for (var ti = 0; ti < lib.length; ti++) {
        if (seen[ti]) continue;                 // one real sighting per chip is enough
        var t = lib[ti], done = false;
        for (var R = 1; R <= H - t.h && !done; R++) {
            for (var C = 1; C <= W - t.w && !done; C++) {
                if (!cm.matchAt(grid, t, R, C)) continue;
                done = true;
                eb.paint(stack, grid, H, W);
                // The board must be STILL before the chip, or what follows is
                // the board settling rather than the chip firing.
                if (eb.settle(stack, 60).comboSizes.length) break;
                var chain = 0, cleared = 0, legal = true;
                for (var s = 0; s < t.swaps.length; s++) {
                    var sr = R + t.swaps[s][0], sc = C + t.swaps[s][1];
                    if (sr < 1 || sr > H || sc < 1 || sc >= W || !stack.canSwap(sr, sc)) { legal = false; break; }
                    stack.curRow = sr; stack.curCol = sc;
                    stack.doSwap(sr, sc);
                    var st = eb.settle(stack, 900);
                    cleared += st.clearedPanels;
                    var cc = st.chainLength >= 2 ? st.chainLength : 0;
                    if (cc > chain) chain = cc;
                }
                if (!legal) break;
                seen[ti] = 1;
                tested++;
                if (cleared) fires++;
                if (chain === t.claimChain) chainOk++;
                if (chain === t.claimChain && cleared === t.claimTotal) bothOk++;
                break;
            }
        }
    }
}

var failures = [];
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures.push(name); }
}

console.log('  ' + tested + ' distinct chips located across ' + fixture.boards.length + ' real in-play boards');
check('enough of the library actually occurs in real play to measure', function () {
    assert.ok(tested >= FLOOR_FOUND, 'only ' + tested + ' chips located, floor is ' + FLOOR_FOUND +
              ' — either the fixture or the matcher stopped working');
});
check('a chip found on a real board FIRES on a real engine', function () {
    var r = fires / tested;
    console.log('       ' + Math.round(100 * r) + '% cleared something');
    assert.ok(r >= FLOOR_FIRES, Math.round(100 * r) + '% fired, floor is ' + Math.round(100 * FLOOR_FIRES) + '%');
});
check('and reaches the chain depth it claims', function () {
    var r = chainOk / tested;
    console.log('       ' + Math.round(100 * r) + '% hit the claimed chain exactly');
    assert.ok(r >= FLOOR_CHAIN, Math.round(100 * r) + '%, floor is ' + Math.round(100 * FLOOR_CHAIN) + '%');
});
check('and clears the panel count it claims', function () {
    var r = bothOk / tested;
    console.log('       ' + Math.round(100 * r) + '% hit chain AND panels exactly');
    assert.ok(r >= FLOOR_BOTH, Math.round(100 * r) + '%, floor is ' + Math.round(100 * FLOOR_BOTH) + '%');
});

console.log('');
if (failures.length) { console.log(failures.length + ' failed.'); process.exit(1); }
console.log('The chips hold up on boards nobody built for them.');
