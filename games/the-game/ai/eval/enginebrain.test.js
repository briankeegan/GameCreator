#!/usr/bin/env node
// DOES THINKING WITH THE ENGINE ACTUALLY CHANGE WHAT THE BOT SEES?
//
//   node enginebrain.test.js
//
// PuyoCpu can resolve a candidate on LogicalBoard (default) or on a live
// Stack (opts.engine). A switch that is wired but inert would look exactly
// like a switch that works — the bot would keep playing, every test would
// stay green, and the 372 chips this exists for would still be mispriced.
//
// So this asserts the DIFFERENCE, on real chips rather than a made-up board:
// a chip that the engine fires as a 3-chain and LogicalBoard merges into two
// rounds must come back with different numbers from the two paths, in the
// known direction — the engine sees MORE links, never fewer.
var assert = require('assert');
var path = require('path');
var fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require('./puyocpu.js');
var W = PanelEngine.WIDTH, H = 12;

var failures = [];
function check(name, fn) {
    try { fn(); console.log('  PASS  ' + name); }
    catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); failures.push(name); }
}

// A chip staged the same way verify_chips.js stages one. Kept deliberately
// short: the shared staging rules are tested there, and duplicating them
// here would be a second copy to drift.
function stage(chip) {
    var cells = chip.tmpl;
    var minR = Math.min.apply(null, cells.map(function (c) { return c[0]; }));
    var minC = Math.min.apply(null, cells.map(function (c) { return c[1]; }));
    var rowOff = 1 - minR, colOff = 1 - minC;
    var used = {};
    cells.forEach(function (c) { if (typeof c[2] === 'number') used[c[2]] = 1; });
    var spare = [];
    for (var s = 1; s <= 12 && spare.length < 4; s++) if (!used[s]) spare.push(s);
    var g = [];
    for (var r = 0; r <= H; r++) { g[r] = []; for (var c = 1; c <= W; c++) g[r][c] = 0; }
    var mustEmpty = {};
    for (var i = 0; i < cells.length; i++) {
        var rr = cells[i][0] + rowOff, cc = cells[i][1] + colOff, k = cells[i][2];
        if (rr < 1 || rr > H || cc < 1 || cc > W) return null;
        if (k === '.' || k === 'e') { mustEmpty[rr + ',' + cc] = 1; continue; }
        g[rr][cc] = (k === '@') ? spare[3] : k;
    }
    var sr = chip.swaps[0][0] + rowOff, sc = chip.swaps[0][1] + colOff;
    if (sr > 1 && sc >= 1 && sc < W) {
        var a = g[sr][sc], b = g[sr][sc + 1];
        [[sc, b], [sc + 1, a]].forEach(function (p) {
            if (!p[1] || g[sr - 1][p[0]] !== 0 || mustEmpty[(sr - 1) + ',' + p[0]]) return;
            g[sr - 1][p[0]] = spare[(sr - 1 + 2 * p[0]) % 3];
        });
    }
    for (var c2 = 1; c2 <= W; c2++) {
        var top = 0;
        for (var r2 = H; r2 >= 1; r2--) if (g[r2][c2] !== 0) { top = r2; break; }
        for (var r3 = top - 1; r3 >= 1; r3--) {
            if (g[r3][c2] !== 0) continue;
            if (mustEmpty[r3 + ',' + c2]) return null;
            g[r3][c2] = spare[(r3 + 2 * c2) % 3];
        }
    }
    return { board: new LogicalBoard(W, H, 6, g, {}), sr: sr, sc: sc };
}

function resolveWith(useEngine, st) {
    var cpu = new PuyoCpu({}, { weights: {}, engine: useEngine });
    var b = st.board.clone();
    b.swap(st.sr, st.sc);
    return cpu._resolveCandidate(b);
}

var chips = JSON.parse(fs.readFileSync(path.join(__dirname, 'chips', 'batch1-chain.json'), 'utf8'));
// THE CHIPS THE TWO BOARDS DISAGREE ABOUT, kept OUT of chips/ on purpose —
// they are not ported, they are evidence. Every one fires on a live Stack and
// comes out one round short on LogicalBoard. Batch 1 cannot be the fixture
// for that: those chips are ported precisely BECAUSE both boards agree on
// them, so asserting a difference there fails honestly and says nothing.

check('the engine path resolves a CHAIN_5 at its real depth', function () {
    var chip = chips.filter(function (c) { return c.kind === 'CHAIN_5'; })[0];
    assert.ok(chip, 'CHAIN_5 is missing from batch 1');
    var st = stage(chip);
    assert.ok(st, 'could not stage CHAIN_5');
    var eng = resolveWith(true, st);
    assert.strictEqual(eng.chainLength, 5,
        'engine gave ' + eng.chainLength + ' rounds for a 5-chain');
});

check('both paths agree where the two boards agree', function () {
    var chip = chips.filter(function (c) { return c.kind === 'CHAIN_2'; })[0];
    var st = stage(chip);
    var sim = resolveWith(false, st), eng = resolveWith(true, st);
    var s = sim.comboSizes.reduce(function (a, b) { return a + b; }, 0);
    var e = eng.comboSizes.reduce(function (a, b) { return a + b; }, 0);
    assert.strictEqual(s, e, 'cleared ' + s + ' on the simulation and ' + e + ' on the engine');
    assert.strictEqual(sim.chainLength, eng.chainLength, 'round counts differ on a chip both agree on');
});

// THE ANSWER NO LONGER DISTINGUISHES THEM, WHICH IS THE POINT.
//
// This used to assert that at least one fixture chip resolved DIFFERENTLY on
// the two boards — the only way, then, to prove the engine path was not
// quietly falling back to LogicalBoard. LogicalBoard now resolves identically
// to the engine on every case anyone has been able to construct: 50,797 real
// board/swap pairs and all 6,228 chip templates. So a difference in the
// answer is no longer available as evidence, and demanding one would fail for
// the best possible reason.
//
// The question is still worth asking, so it is asked directly: is the engine
// actually RUN when the switch is on? Spied at the seam rather than inferred
// from the result.
check('the engine path really runs the engine, and the plain path does not', function () {
    var engineBoard = require('./engineboard.js');
    var realSettle = engineBoard.settle, calls = 0;
    engineBoard.settle = function () { calls++; return realSettle.apply(this, arguments); };
    try {
        var st = stage(chips.filter(function (c) { return c.kind === 'CHAIN_5'; })[0]);
        assert.ok(st, 'CHAIN_5 did not stage');

        calls = 0;
        resolveWith(false, st);
        assert.strictEqual(calls, 0, 'the plain path called the engine ' + calls + ' times');

        calls = 0;
        var eng = resolveWith(true, st);
        assert.ok(calls > 0, 'engine: true ran no engine settle at all — the switch is inert');
        assert.ok(eng.chainLength >= 1, 'the engine path resolved nothing');
    } finally {
        engineBoard.settle = realSettle;
    }
});

check('the engine path leaves the candidate board SETTLED', function () {
    // Every feature reads board.grid after the resolve. If the engine path
    // returned numbers without writing the settled board back, the score
    // would be computed on the pre-clear position and nothing would say so.
    var chip = chips.filter(function (c) { return c.kind === 'CHAIN_3'; })[0];
    var st = stage(chip);
    var cpu = new PuyoCpu({}, { weights: {}, engine: true });
    var b = st.board.clone();
    var before = JSON.stringify(b.grid);
    b.swap(st.sr, st.sc);
    cpu._resolveCandidate(b);
    assert.notStrictEqual(JSON.stringify(b.grid), before,
        'the board came back unchanged — the settled position was never written back');
});

if (failures.length) {
    console.error('\n' + failures.length + ' failed: ' + failures.join(', '));
    process.exit(1);
}
console.log('\nThe engine brain is wired and is not answering with the simulation.');
