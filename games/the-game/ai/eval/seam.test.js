// DOES THE SEAM ACTUALLY FEED THE FEATURES? Run: node seam.test.js
//
// attach.js replaces SearchCpu.prototype._evaluate at runtime. Everything
// about that is invisible from the other two suites: features.test.js
// builds inputs by hand, and input.fidelity.test.js checks fromStack
// against a Stack. Neither touches the adapter, so a seam that quietly
// passed nothing would leave both of them green while every weighted
// feature read zero in the only place that ships.
//
// That is this repo's oldest failure shape — a check satisfied by something
// other than the thing it checks — so the seam gets its own gate, against
// the REAL SearchCpu and the REAL Stack.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var SearchCpu = globalThis.PanelCpu.SearchCpu;
var attach = require('./attach.js').attach;
var registry = require('./registry.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function liveCpu() {
    var stack = new PanelEngine.Stack({ level: 3, seed: 11 });
    var guard = 0;
    while (!stack.stopWatchIsRunning && guard++ < 1000) stack.run();
    for (var i = 0; i < 120; i++) stack.run();
    return new SearchCpu(stack, { difficulty: 'nightmare' });
}

test('attaching replaces _evaluate and detaching restores the shipped one', function () {
    var original = SearchCpu.prototype._evaluate;
    var detach = attach(SearchCpu, {});
    assert.notStrictEqual(SearchCpu.prototype._evaluate, original);
    assert.ok(SearchCpu.prototype._evaluate.__panelEvalAttached);
    detach();
    assert.strictEqual(SearchCpu.prototype._evaluate, original,
        'detach did not put the shipped scoring back — an A/B run would be comparing ' +
        'the new evaluator against itself');
});

test('with all weights zero the attached evaluator scores every board 0', function () {
    var cpu = liveCpu();
    var detach = attach(SearchCpu, {});
    try {
        assert.strictEqual(cpu._evaluate(cpu._snapshot(), 0, 0, 0), 0);
    } finally { detach(); }
});

// EVERY FEATURE IS REACHABLE THROUGH THE SEAM.
//
// The test that catches a silently-zero term. Each feature is weighted
// ALONE, on a board and stack built so that it MUST be non-zero, and the
// score through the real SearchCpu._evaluate has to move.
//
// One shared board does not do this job: most features are legitimately
// zero on most boards, so a single-board sweep reports "not fed" for
// features that are fine and proves nothing about the ones that are not.
// Each row below therefore says what would make its feature fire.
function blank(cpu) {
    var b = cpu._snapshot();
    for (var r = 1; r <= b.height; r++) {
        for (var c = 1; c <= b.width; c++) b.grid[r][c] = 0;
    }
    b.blocks = {};
    return b;
}

var REACHABLE = [
    // key, setup(cpu) -> board, and anything the stack needs doing to it
    ['matchPotential', function (cpu) {
        // one swap away from a merged 5: row of 1,1,2,1 with a column of 1s
        var b = blank(cpu);
        b.grid[1][1] = 1; b.grid[1][2] = 1; b.grid[1][3] = 2; b.grid[1][4] = 1;
        b.grid[2][3] = 1; b.grid[3][3] = 1;
        return b;
    }],
    ['links', function (cpu) {
        var b = blank(cpu); b.grid[1][1] = 1; b.grid[1][2] = 1; return b;
    }],
    ['colourVariance', function (cpu) {
        var b = blank(cpu); b.grid[1][1] = 1; b.grid[4][6] = 1; return b;
    }],
    ['edgePenalty', function (cpu) {
        var b = blank(cpu); b.grid[1][1] = 1; return b;
    }],
    ['garbageOnBoard', function (cpu) {
        var b = blank(cpu); b.grid[1][1] = -2; return b;
    }],
    ['garbageAdjacency', function (cpu) {
        var b = blank(cpu); b.grid[1][1] = -2; b.grid[1][2] = 3; return b;
    }],
    ['maxHeight', function (cpu) {
        var b = blank(cpu); b.grid[5][3] = 1; return b;
    }],
    ['fillRatio', function (cpu) {
        var b = blank(cpu); b.grid[1][1] = 1; return b;
    }],
    ['roughness', function (cpu) {
        var b = blank(cpu); b.grid[1][1] = 1; b.grid[2][1] = 1; b.grid[3][1] = 1; return b;
    }],
    ['colourScarcity', function (cpu) {
        var b = blank(cpu); b.grid[1][1] = 4; b.grid[1][2] = 4; return b;   // two of a colour
    }],
    ['incomingGarbage', function (cpu) {
        // queued and NOT landed — the grid cannot show it, which is the
        // entire point of the feature, so nothing is run afterwards.
        cpu.stack.receiveGarbage([{ width: 6, height: 2, isChain: false }]);
        return blank(cpu);
    }],
    ['framesToDeath', function (cpu) { return blank(cpu); }],   // Infinity on a safe board
    ['garbageSent', function (cpu) { return blank(cpu); }],     // fed by cumGarbage
    ['chainLength', function (cpu) { return blank(cpu); }],     // fed by cumChain
    ['garbageCleared', function (cpu) {
        // live board holds garbage, candidate does not: the seam differences them
        for (var c = 1; c <= 6; c++) {
            var p = cpu.stack.panelAt(1, c);
            p.isGarbage = true; p.color = 9; p.state = 'normal';
        }
        return blank(cpu);
    }],
    ['latentChain', function (cpu) {
        // Mid-cascade is a live-stack condition the adapter reads through
        // _cascadePrediction, so this stubs that method and asserts the
        // SEAM carries its chainMarks into the input — which is the only
        // thing this file is testing. Whether the prediction itself is
        // right is panel-cpu.js's business.
        var b = blank(cpu);
        b.grid[1][1] = 1; b.grid[1][2] = 1; b.grid[1][3] = 1;
        cpu._cascadePrediction = function () { return { chainMarks: { '1:2': true } }; };
        return b;
    }]
];

test('EVERY feature is reachable through the seam, each on a board that makes it fire', function () {
    assert.strictEqual(REACHABLE.length, registry.all.length,
        'a feature was added to the registry without a reachability case here — ' +
        'which is exactly how one ends up weighted and reading zero');

    var dead = [];
    REACHABLE.forEach(function (row) {
        var key = row[0], setup = row[1];
        assert.ok(registry.byKey[key], 'unknown feature in this table: ' + key);
        var cpu = liveCpu();
        var board = setup(cpu);
        var w = {}; w[key] = 1;
        var detach = attach(SearchCpu, w);
        var score;
        try { score = cpu._evaluate(board, 4, 2, 5); }
        finally { detach(); }
        if (score === 0) dead.push(key);
    });

    assert.deepStrictEqual(dead, [],
        'these scored exactly 0 through the seam on a board built to trigger them, ' +
        'which is what a feature the seam cannot feed looks like: ' + dead.join(', '));
});

test('garbageCleared is fed: a candidate with the garbage gone scores above one without', function () {
    var cpu = liveCpu();
    var stack = cpu.stack;
    stack.receiveGarbage([{ width: 6, height: 1, isChain: false }]);
    for (var i = 0; i < 240; i++) stack.run();

    var withGarbage = cpu._snapshot();
    var live = 0, r, c, p;
    for (r = 1; r <= withGarbage.height; r++) {
        for (c = 1; c <= withGarbage.width; c++) {
            p = stack.panelAt(r, c);
            if (p && p.isGarbage) live++;
        }
    }
    assert.ok(live > 0, 'setup failed: no garbage landed, so there is nothing to clear');

    // The same board with the garbage removed — i.e. a candidate move that
    // cleared it. The seam derives `cleared` by differencing the two.
    var cleared = cpu._snapshot();
    for (r = 1; r <= cleared.height; r++) {
        for (c = 1; c <= cleared.width; c++) if (cleared.grid[r][c] === -2) cleared.grid[r][c] = 0;
    }

    var detach = attach(SearchCpu, { garbageCleared: 10 });
    try {
        var a = cpu._evaluate(withGarbage, 0, 0, 0);
        var b = cpu._evaluate(cleared, 0, 0, 0);
        assert.strictEqual(a, 0, 'clearing nothing should score nothing');
        assert.strictEqual(b, live * 10,
            'expected ' + live + ' cleared cells at weight 10, got ' + b);
    } finally { detach(); }
});

test('garbageCleared never goes negative when garbage ARRIVES', function () {
    // A candidate holding MORE garbage than the live board is garbage
    // landing, not garbage cleared. Left unguarded this would pay the
    // search for taking damage.
    var cpu = liveCpu();
    var board = cpu._snapshot();
    for (var c = 1; c <= board.width; c++) board.grid[1][c] = -2;
    var detach = attach(SearchCpu, { garbageCleared: 10 });
    try { assert.strictEqual(cpu._evaluate(board, 0, 0, 0), 0); }
    finally { detach(); }
});

test('the cascade prediction is computed once per frame, not once per candidate', function () {
    // The search evaluates hundreds of candidates per frame and the
    // prediction is a property of the live stack, so recomputing it per
    // candidate is the same answer at a few hundred times the cost.
    var cpu = liveCpu();
    var calls = 0;
    var real = cpu._cascadePrediction;
    cpu._cascadePrediction = function () { calls++; return real.apply(this, arguments); };

    var detach = attach(SearchCpu, { latentChain: 1 });
    try {
        var board = cpu._snapshot();
        for (var i = 0; i < 50; i++) cpu._evaluate(board, 0, 0, 0);
        assert.strictEqual(calls, 1, 'computed ' + calls + ' times for 50 candidates in one frame');
        cpu.stack.run();                       // next frame
        cpu._evaluate(board, 0, 0, 0);
        assert.strictEqual(calls, 2, 'a new frame must recompute it');
    } finally { detach(); cpu._cascadePrediction = real; }
});

test('a throwing cascade prediction does not take the evaluation down with it', function () {
    var cpu = liveCpu();
    var real = cpu._cascadePrediction;
    cpu._cascadePrediction = function () { throw new Error('boom'); };
    var detach = attach(SearchCpu, { latentChain: 1, maxHeight: 1 });
    try {
        var score = cpu._evaluate(cpu._snapshot(), 0, 0, 0);
        assert.ok(isFinite(score), 'evaluation died with the prediction');
    } finally { detach(); cpu._cascadePrediction = real; }
});

tests.forEach(function (t) {
    try { t.fn(); process.stdout.write('  ok   ' + t.name + '\n'); }
    catch (e) { failures.push(t.name + '\n       ' + e.message); process.stdout.write('  FAIL ' + t.name + '\n'); }
});
if (failures.length) {
    process.stdout.write('\n' + failures.length + ' failed:\n\n' + failures.join('\n\n') + '\n');
    process.exit(1);
}
process.stdout.write('\n' + tests.length + ' passed — the seam feeds every feature.\n');
