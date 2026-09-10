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

test('THE LAW: at zero weights every seam is EXACTLY the shipped AI', function () {
    // One law, three seams. _evaluate, _raiseOrBuild and _defensiveKey all
    // ADD the evaluator's score to the shipped answer rather than replacing
    // it, so an untrained evaluator is neutral rather than a handicap.
    //
    // _evaluate used to return the evaluator's score ALONE, which made zero
    // weights a constant-0 scorer: the search lost its ranking before a
    // single weight existed. Measured, inert survival was [1362,2502,790]
    // against shipped's [2546,2502,1551] — so an A/B would have compared
    // shipped against something already broken and credited the gap to the
    // features.
    var cpu = liveCpu();
    var board = cpu._snapshot();
    var shippedEval = cpu._evaluate(board, 4, 2, 5);
    var shippedBuild = JSON.stringify(cpu._raiseOrBuild(board));
    var res = { chainLength: 3, comboSizes: [5], garbage: [] };
    var shippedDef = cpu._defensiveKey(res, 4, 1, false);

    var detach = attach(SearchCpu, {});
    try {
        assert.strictEqual(cpu._evaluate(board, 4, 2, 5), shippedEval, '_evaluate is not neutral');
        assert.strictEqual(JSON.stringify(cpu._raiseOrBuild(board)), shippedBuild,
            '_raiseOrBuild is not neutral');
        assert.strictEqual(cpu._defensiveKey(res, 4, 1, false), shippedDef,
            '_defensiveKey is not neutral');
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

// A board from REAL play on which the shipped heuristic actually chooses to
// build. Synthetic boards mostly do not: _raiseOrBuild only returns a swap
// when boardPotential improves, so a random grid usually yields raise/hold
// and any test built on one measures nothing. Two tests were written
// against synthetic boards first and both found a build decision on fewer
// than three boards in three hundred.
function buildDecisionBoards(cpu, want) {
    var stack = cpu.stack, found = [];
    for (var f = 0; f < 2000 && found.length < want; f++) {
        if (f > 120 && f % 120 === 0) {
            stack.receiveGarbage([{ width: 6, height: 3, isChain: false }]);
        }
        cpu.update(); stack.run(); stack.takeDeliverableGarbage(); stack.drainEvents();
        if (stack.gameOver) break;
        if (f % 7) continue;
        var b = cpu._snapshot();
        var d = cpu._raiseOrBuild(b);
        if (d && d.kind === 'swap') found.push(b);
    }
    return found;
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
    // incomingGarbage and framesToDeath had rows here and the features are
    // gone: both were provably unable to change a decision. incomingGarbage
    // is a property of the QUEUE, identical across every candidate of a
    // decision, so it cancels out of the ranking — varied in 0 of 179
    // decisions, by construction. framesToDeath sat pinned at its ceiling on
    // every candidate at level 10 — also 0 of 179. Reachability through the
    // seam was never the problem; both were reachable and inert.
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
    // travelCost is a property of the MOVE, and _evaluate is handed a board
    // with no move attached — so it is unreachable through that call site by
    // construction, exactly as the feature's own comment says. It is fed by
    // _raiseOrBuild, which enumerates the swaps and therefore knows the
    // distance, so this row brings its own probe rather than being excused.
    ['travelCost', function (cpu) {
        var boards = buildDecisionBoards(cpu, 1);
        return boards[0] || blank(cpu);
    }, function (cpu, board, weights) {
        // Reached by scoring the same board with travel weighted and not,
        // through the seam that knows the move.
        var travel = require('./travel.js');
        function pick(w) {
            var detach = attach(SearchCpu, w);
            try {
                var d = cpu._raiseOrBuild(board);
                return d && d.kind === 'swap'
                    ? travel.cost(board.cursor.row, board.cursor.col, d.move[0], d.move[1]) : null;
            } finally { detach(); }
        }
        var plain = pick({});
        var weighted = pick(weights.travelCost ? { travelCost: 300 } : {});
        if (plain === null || weighted === null) return 0;
        return plain === weighted ? 0 : 1;
    }],
    ['comboPotential', function (cpu) {
        // A board one swap from a four-panel clear: 1,1,.,1 along the floor,
        // so the size is 4 rather than the 3 that is nearly always available.
        var b = blank(cpu);
        for (var c = 1; c <= 6; c++) b.grid[1][c] = 0;
        b.grid[1][1] = 1; b.grid[1][2] = 1; b.grid[1][4] = 1;
        return b;
    }],
    ['staircase', function (cpu) {
        // One loaded step, through the real seam: clearing whatever sits
        // under the 2 drops it into row 1 beside the 2,2 pair. Same shape
        // as the fixture in features.test.js, drawn bottom row first.
        var b = blank(cpu);
        var rows = ['11122.', '..2...'];               // bottom row first
        for (var r = 0; r < rows.length; r++) {
            for (var c = 1; c <= 6; c++) {
                var ch = rows[r][c - 1];
                b.grid[r + 1][c] = ch === '.' ? 0 : Number(ch);
            }
        }
        return b;
    }],
    ['flatTop', function (cpu) {
        // Every column level, high up: the documented death shape. A board
        // flat on the FLOOR would also be flat and must not be what proves
        // this reachable, so the fixture is deliberately tall.
        var b = blank(cpu);
        for (var r = 1; r <= 6; r++) {
            for (var c = 1; c <= 6; c++) b.grid[r][c] = ((r + c) % 2) + 1;
        }
        return b;
    }],
    ['chainPotential', function (cpu) {
        // A board that has fired NOTHING and still has a cascade waiting in
        // it — the state this feature exists to see and the only one that
        // makes it non-zero. Fixture found by search rather than drawn: the
        // hand-drawn attempts at "a loaded chain" all held a 1-chain, which
        // would pass a feature that returned a constant.
        var b = blank(cpu);
        var rows = ['2233.3', '2121.3', '1.1..2', '.....1'];  // bottom row first
        for (var r = 0; r < rows.length; r++) {
            for (var c = 1; c <= 6; c++) {
                var ch = rows[r][c - 1];
                b.grid[r + 1][c] = ch === '.' ? 0 : Number(ch);
            }
        }
        return b;
    }],
    // latentChain had a row here and the feature is gone. It needed a
    // decision made MID-CASCADE — _cascadePrediction returns null unless
    // panels are in flight — and both brains decide on cooldown boundaries,
    // when the board has settled. It never fired once, in either brain, in
    // any game, while the GA assigned it up to 282 of 300. The row above
    // only ever passed because it STUBBED _cascadePrediction, which is worth
    // noting: a reachability test that installs the condition it is testing
    // for proves the seam carries a value, not that the value ever occurs.
];

test('EVERY feature is reachable through the seam, each on a board that makes it fire', function () {
    assert.strictEqual(REACHABLE.length, registry.all.length,
        'a feature was added to the registry without a reachability case here — ' +
        'which is exactly how one ends up weighted and reading zero');

    var dead = [];
    REACHABLE.forEach(function (row) {
        var key = row[0], setup = row[1], probe = row[2];
        assert.ok(registry.byKey[key], 'unknown feature in this table: ' + key);
        var cpu = liveCpu();
        var board = setup(cpu);
        var w = {}; w[key] = 1;
        var score;
        if (probe) {
            score = probe(cpu, board, w);
        } else {
            var base = cpu._evaluate(board, 4, 2, 5);   // shipped, seam detached
            var detach = attach(SearchCpu, w);
            try { score = cpu._evaluate(board, 4, 2, 5) - base; }
            finally { detach(); }
        }
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

    // Measured as a DELTA from the shipped score, since the seam adds to it.
    var baseWith = cpu._evaluate(withGarbage, 0, 0, 0);
    var baseCleared = cpu._evaluate(cleared, 0, 0, 0);
    var detach = attach(SearchCpu, { garbageCleared: 10 });
    try {
        var a = cpu._evaluate(withGarbage, 0, 0, 0) - baseWith;
        var b = cpu._evaluate(cleared, 0, 0, 0) - baseCleared;
        assert.strictEqual(a, 0, 'clearing nothing should contribute nothing');
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
    var base = cpu._evaluate(board, 0, 0, 0);
    var detach = attach(SearchCpu, { garbageCleared: 10 });
    try { assert.strictEqual(cpu._evaluate(board, 0, 0, 0) - base, 0); }
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

    // Any weight will do: attach.js computes the prediction once per frame
    // regardless of which features are weighted, which is the behaviour
    // under test. It used to be latentChain here, for the feature that read
    // chainMarks; that feature is gone and the caching still matters.
    var detach = attach(SearchCpu, { maxHeight: 1 });
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
    var detach = attach(SearchCpu, { maxHeight: 1 });
    try {
        var score = cpu._evaluate(cpu._snapshot(), 0, 0, 0);
        assert.ok(isFinite(score), 'evaluation died with the prediction');
    } finally { detach(); cpu._cascadePrediction = real; }
});


// ---- _raiseOrBuild: THE BUILDING DECISION ----
//
// Measured over 448 decisions on bench.js: _bestDefensiveMove takes 83%,
// _raiseOrBuild 13%, and the two functions the evaluator was originally
// attached to about 5%. _raiseOrBuild is the one that decides which swap to
// make when nothing is urgent — the BUILDING move — and it ranked every
// legal swap by a single hand-written `boardPotential(trial) - base`,
// never consulting _evaluate at all.
//
// That is exactly the decision the density features exist for. With the
// evaluator absent from it, links, roughness, edgePenalty, matchPotential,
// colourScarcity and colourVariance had nowhere to act, which is why
// weighting them changed literally zero moves.
//
// What the seam changes and what it deliberately does NOT: the RAISE/HOLD
// decision stays in panel-cpu.js untouched. Only the CHOICE OF SWAP is
// re-ranked. Duplicating the raise gate here would put a second copy of a
// live rule in a file that cannot see it change.

test('_raiseOrBuild: zero weights leave the shipped choice exactly as it was, on MANY boards', function () {
    // ONE BOARD WAS NOT ENOUGH, and that is how this seam shipped a real
    // defect past a green test. With every weight at zero every candidate
    // scores 0, so "the best" was simply the FIRST swap and the shipped
    // heuristic's choice was thrown away. On the single board this test
    // used, the first swap happened to BE the shipped choice, so it
    // passed — while the full benchmark showed inert survival collapsing
    // from 2546 frames to 810.
    //
    // A tie must leave the shipped move alone. Asserted across random
    // boards so one lucky coincidence cannot hide it again.
    var cpu = liveCpu();
    var rng = PanelEngine.makeRng(4242);
    var checked = 0, swapBoards = 0;
    for (var t = 0; t < 60; t++) {
        var b = cpu._snapshot();
        for (var r = 1; r <= b.height; r++) {
            for (var c = 1; c <= b.width; c++) {
                b.grid[r][c] = rng() < 0.4 ? (1 + Math.floor(rng() * 4)) : 0;
            }
        }
        b.blocks = {};
        var before = JSON.stringify(cpu._raiseOrBuild(b));
        if (JSON.parse(before).kind === 'swap') swapBoards++;
        var detach = attach(SearchCpu, {});
        try {
            assert.strictEqual(JSON.stringify(cpu._raiseOrBuild(b)), before,
                'board ' + t + ': an inert evaluator moved the building decision');
        } finally { detach(); }
        checked++;
    }
    assert.strictEqual(checked, 60);
    assert.ok(swapBoards > 20, 'only ' + swapBoards + '/60 boards produced a swap decision — ' +
        'this sweep is not exercising the path it is meant to guard');
});

test('_raiseOrBuild: a weighted evaluator changes WHICH swap is built', function () {
    // The whole point. If this cannot be made to differ, the density
    // features have no way to act on the game.
    var cpu = liveCpu();
    var board = cpu._snapshot();
    var shipped = JSON.stringify(cpu._raiseOrBuild(board));

    var moved = false;
    ['links', 'roughness', 'edgePenalty', 'matchPotential', 'colourVariance'].forEach(function (key) {
        var w = {}; w[key] = 500;
        var detach = attach(SearchCpu, w);
        try {
            if (JSON.stringify(cpu._raiseOrBuild(board)) !== shipped) moved = true;
        } finally { detach(); }
    });
    assert.ok(moved, 'no density feature could change the building decision — the ' +
        'evaluator is still not reaching _raiseOrBuild');
});

test('_raiseOrBuild: the raise/hold decision is NOT taken over', function () {
    // When the shipped heuristic decides no swap is worth making, that
    // verdict — and whether it raises or holds — stays panel-cpu.js's.
    // Re-ranking a swap is a smaller claim than deciding when to swap at
    // all, and only the smaller one is being made here.
    var cpu = liveCpu();
    var board = cpu._snapshot();
    for (var r = 1; r <= board.height; r++) {
        for (var c = 1; c <= board.width; c++) board.grid[r][c] = 0;   // nothing to build with
    }
    var shipped = cpu._raiseOrBuild(board);
    assert.ok(shipped.kind === 'raise' || shipped.kind === 'hold', 'setup: expected raise/hold');
    var detach = attach(SearchCpu, { links: 500, maxHeight: 500 });
    try {
        assert.deepStrictEqual(cpu._raiseOrBuild(board), shipped,
            'the evaluator overrode a raise/hold verdict it was not given');
    } finally { detach(); }
});

test('_raiseOrBuild: the seam never converts a raise/hold verdict into a swap', function () {
    // The guard being protected: the override asks the shipped function
    // first and returns its answer untouched unless it was a swap.
    //
    // This test used to pin that by finding a board where the shipped
    // heuristic declines despite having 37 legal swaps. That board no
    // longer works, and the reason is a real change rather than a broken
    // test: _buildScore is now routed through the evaluator, so the
    // evaluator legitimately participates in WHETHER a build is worth
    // making. It is no longer true that the verdict is untouched, and it
    // should not be.
    //
    // What must still hold is narrower: the OVERRIDE itself does not
    // manufacture a swap out of a decline. So _buildScore is restored to
    // the shipped one for the duration, isolating the guard from the hook.
    var cpu = liveCpu();
    var rows = ['.1...3', '4....3', '....1.', '32.2.2', '....34', '......',
                '13..2.', '....13', '3.2.2.', '1..3.1', '.4.2.4', '.3...3'];
    var b = cpu._snapshot();
    for (var r = 1; r <= b.height; r++) {
        for (var c = 1; c <= b.width; c++) {
            var ch = rows[b.height - r][c - 1];
            b.grid[r][c] = ch === '.' ? 0 : Number(ch);
        }
    }
    b.blocks = {};
    assert.ok(b.legalSwaps().length > 10, 'setup: this board must offer real swaps');
    var shipped = cpu._raiseOrBuild(b);
    assert.notStrictEqual(shipped.kind, 'swap', 'setup: shipped must be declining to swap here');

    var shippedBuildScore = SearchCpu.prototype._buildScore;
    var detach = attach(SearchCpu, { links: 500, matchPotential: 500, maxHeight: 500 });
    var patchedBuildScore = SearchCpu.prototype._buildScore;
    SearchCpu.prototype._buildScore = shippedBuildScore;   // isolate the guard
    try {
        assert.deepStrictEqual(cpu._raiseOrBuild(b), shipped,
            'the override turned a decline into a swap');
    } finally {
        SearchCpu.prototype._buildScore = patchedBuildScore;
        detach();
    }
});

test('_buildScore: routing it through the evaluator CAN change a raise/hold verdict', function () {
    // The other side of the same coin, asserted so the change above is a
    // stated property rather than an accident nobody noticed. Judging a
    // building move is exactly what the hook exists to influence.
    var cpu = liveCpu();
    var rows = ['.1...3', '4....3', '....1.', '32.2.2', '....34', '......',
                '13..2.', '....13', '3.2.2.', '1..3.1', '.4.2.4', '.3...3'];
    var b = cpu._snapshot();
    for (var r = 1; r <= b.height; r++) {
        for (var c = 1; c <= b.width; c++) {
            var ch = rows[b.height - r][c - 1];
            b.grid[r][c] = ch === '.' ? 0 : Number(ch);
        }
    }
    b.blocks = {};
    var shipped = cpu._raiseOrBuild(b);
    var detach = attach(SearchCpu, { links: 500, matchPotential: 500, maxHeight: 500 });
    try {
        assert.notDeepStrictEqual(cpu._raiseOrBuild(b), shipped,
            'the hook is not reaching the build/decline verdict at all');
    } finally { detach(); }
});

test('_raiseOrBuild: candidates are scored AFTER the cascade resolves', function () {
    // Found by mutation, and the FIRST version of this test was too weak to
    // catch it: it asserted that resolve() changes a board, which is a fact
    // about resolve() and not about the seam, so the mutant sailed through.
    //
    // Skipping trial.resolve() scores the board an instant after the swap,
    // crediting a move with panels that are about to vanish. This board was
    // found by searching for the case that actually distinguishes them —
    // with fillRatio weighted, the resolved ranking picks [5,5] and the
    // unresolved ranking picks [1,2].
    var cpu = liveCpu();
    var rows = ['..1..1', '.223..', '..33.2', '...3.3', '..32..', '.3....',
                '2.....', '.22..2', '.2.3.1', '....31', '..33.2', '33..32'];
    var b = cpu._snapshot();
    for (var r = 1; r <= b.height; r++) {
        for (var c = 1; c <= b.width; c++) {
            var ch = rows[b.height - r][c - 1];
            b.grid[r][c] = ch === '.' ? 0 : Number(ch);
        }
    }
    b.blocks = {};
    assert.strictEqual(cpu._raiseOrBuild(b).kind, 'swap',
        'setup: the shipped heuristic must be choosing a swap here');
    var detach = attach(SearchCpu, { fillRatio: 1000 });
    try {
        assert.deepStrictEqual(cpu._raiseOrBuild(b).move, [5, 5],
            'the seam picked the swap that only looks good BEFORE the cascade resolves');
    } finally { detach(); }
});

test('_buildScore: detaching restores the shipped hook itself', function () {
    var original = SearchCpu.prototype._buildScore;
    var detach = attach(SearchCpu, { links: 1 });
    assert.notStrictEqual(SearchCpu.prototype._buildScore, original);
    detach();
    assert.strictEqual(SearchCpu.prototype._buildScore, original);
});

test('replace mode drops the shipped scoring entirely', function () {
    // PUYO_REFERENCE.md's bot has no other scorer — its features ARE the
    // evaluation. 'add' cannot express that: it is anchored to the shipped
    // heuristic, and the anchor is not gentle (_defensiveKey multiplies
    // cleared garbage by 1,000,000). Both modes exist because each is wrong
    // for the other's question.
    var cpu = liveCpu();
    var board = cpu._snapshot();
    var shipped = cpu._evaluate(board, 4, 2, 5);
    assert.notStrictEqual(shipped, 0, 'setup: shipped scoring returned 0');
    var detach = attach(SearchCpu, {}, { mode: 'replace' });
    try {
        assert.strictEqual(cpu._evaluate(board, 4, 2, 5), 0,
            'replace mode still carried the shipped score');
        assert.strictEqual(cpu._buildScore(board), 0);
    } finally { detach(); }
    assert.strictEqual(cpu._evaluate(board, 4, 2, 5), shipped, 'detach did not restore');
});

test('an unknown mode is refused rather than silently treated as add', function () {
    assert.throws(function () { attach(SearchCpu, {}, { mode: 'replce' }); }, /unknown mode/);
});


// ---- _defensiveKey: THE 83% PATH ----
//
// _bestDefensiveMove takes 373 of 448 decisions on bench.js and never
// consulted the evaluator. Inside it, every candidate that MATCHES is
// ranked by this.\_defensiveKey — a prototype method, and therefore a real
// seam — while non-matching candidates are ordered by the module-local
// boardPotential.
//
// WHAT CAN AND CANNOT REACH IT, stated up front because the limit is
// structural rather than an oversight:
//
//   _defensiveKey(res, garbageCleared, dropAmount, toppedOutNow)
//
// It is not given the candidate board. So the EARNED and CLOCK features —
// garbageSent, chainLength, garbageCleared
// — can act here, and the BOARD features cannot. Feeding them would mean
// changing that signature in panel-cpu.js, which is a separate, larger
// change and is recorded as such rather than smuggled in.
//
// The tests below assert BOTH halves: the earned features move the
// defensive ranking, and the board features are honestly reported as
// unable to.

test('_defensiveKey: zero weights leave the shipped ranking exactly as it was', function () {
    var cpu = liveCpu();
    var res = { chainLength: 3, comboSizes: [5], garbage: [] };
    var before = cpu._defensiveKey(res, 6, 2, false);
    var detach = attach(SearchCpu, {});
    try {
        assert.strictEqual(cpu._defensiveKey(res, 6, 2, false), before,
            'an inert evaluator must not move the defensive ranking');
    } finally { detach(); }
});

test('_defensiveKey: clearing MORE garbage must still rank higher', function () {
    // The invariant the defensive path exists for. Whatever the evaluator
    // adds, a move that removes more of the wall cannot come out behind one
    // that removes less — that ordering is the thing keeping the cpu alive.
    var cpu = liveCpu();
    var detach = attach(SearchCpu, { garbageCleared: 40, chainLength: 10 });
    try {
        var few = cpu._defensiveKey({ chainLength: 2, comboSizes: [4], garbage: [] }, 1, 0, false);
        var many = cpu._defensiveKey({ chainLength: 2, comboSizes: [4], garbage: [] }, 12, 0, false);
        assert.ok(many > few, 'clearing 12 cells ranked ' + many +
            ', clearing 1 ranked ' + few);
    } finally { detach(); }
});

test('_defensiveKey: a weighted earned feature changes the defensive ranking', function () {
    var cpu = liveCpu();
    var res = { chainLength: 3, comboSizes: [5], garbage: [] };
    var shipped = cpu._defensiveKey(res, 4, 1, false);
    var moved = false;
    ['chainLength', 'garbageCleared', 'garbageSent'].forEach(function (key) {
        var w = {}; w[key] = 250;
        var detach = attach(SearchCpu, w);
        try { if (cpu._defensiveKey(res, 4, 1, false) !== shipped) moved = true; }
        finally { detach(); }
    });
    assert.ok(moved, 'no earned or clock feature could move the defensive ranking');
});

test('_defensiveKey: LIMIT — board features cannot reach it, and that is asserted', function () {
    // Not a bug to be silently tolerated: a board feature weighted here
    // must be a NO-OP rather than a small wrong number, because
    // _defensiveKey has no board to measure. Asserting it keeps the limit
    // visible until the signature changes.
    var cpu = liveCpu();
    var res = { chainLength: 2, comboSizes: [4], garbage: [] };
    var base = cpu._defensiveKey(res, 3, 0, false);
    ['links', 'roughness', 'maxHeight', 'colourVariance'].forEach(function (key) {
        var w = {}; w[key] = 500;
        var detach = attach(SearchCpu, w);
        try {
            assert.strictEqual(cpu._defensiveKey(res, 3, 0, false), base,
                key + ' appeared to affect the defensive key, which has no board — ' +
                'it must be reading something it should not');
        } finally { detach(); }
    });
});

test('_defensiveKey: detaching restores the shipped function itself', function () {
    var original = SearchCpu.prototype._defensiveKey;
    var detach = attach(SearchCpu, { chainLength: 1 });
    assert.notStrictEqual(SearchCpu.prototype._defensiveKey, original);
    detach();
    assert.strictEqual(SearchCpu.prototype._defensiveKey, original);
});


// ---- travel cost reaches the search ----
//
// The point of the whole exercise: a swap one cell from the cursor is
// nearly free (1 frame) and one two cells away costs 21. If weighting
// travelCost cannot pull the chosen move toward the cursor, the bot is
// still teleporting and every trained weight is answering the wrong
// question.

test('travelCost: weighting it pulls the building move toward the cursor', function () {
    // A TIE IS A FAILURE HERE. The first version asserted near <= far, which
    // passes trivially when travel does nothing at all — and it did pass,
    // before the seam computed any travel cost.
    var travel = require('./travel.js');
    var cpu = liveCpu();
    var boards = buildDecisionBoards(cpu, 40);
    assert.ok(boards.length > 10, 'only found ' + boards.length + ' build decisions to test on');

    function chosenDistance(b, weights) {
        var detach = attach(SearchCpu, weights);
        try {
            var d = cpu._raiseOrBuild(b);
            if (!d || d.kind !== 'swap') return null;
            return travel.cost(b.cursor.row, b.cursor.col, d.move[0], d.move[1]);
        } finally { detach(); }
    }

    var moved = 0, checked = 0, worse = [], example = null;
    boards.forEach(function (b) {
        var far = chosenDistance(b, {});
        var near = chosenDistance(b, { travelCost: 300 });
        if (far === null || near === null) return;
        checked++;
        if (near > far) worse.push(far + ' -> ' + near);
        if (near !== far) { moved++; if (!example) example = far + ' -> ' + near + ' frames'; }
    });

    assert.ok(checked > 10, 'only ' + checked + ' boards produced a swap decision');
    assert.deepStrictEqual(worse.slice(0, 3), [],
        'weighting travel chose a FURTHER move on ' + worse.length + ' boards: ' + worse.slice(0, 3));
    assert.ok(moved > 0,
        'weighting travelCost at 300 changed the chosen move on none of ' + checked +
        ' boards — travel is not reaching the search at all');
    process.stdout.write('       [travel] moved the choice on ' + moved + '/' + checked +
        ' real boards (' + example + ')\n');
});

test('travelCost: a swap the cursor cannot reach is never offered', function () {
    // clampCursor caps curRow at topCurRow, so cells above the stack top
    // are unreachable rather than expensive — the distinction meatfighter's
    // BFS makes, and one a cost alone cannot express.
    var travel = require('./travel.js');
    var cpu = liveCpu();
    var board = cpu._snapshot();
    var top = board.cursor.topRow;
    var detach = attach(SearchCpu, { travelCost: 1 });
    try {
        for (var i = 0; i < 12; i++) {
            var d = cpu._raiseOrBuild(board);
            if (d && d.kind === 'swap') {
                assert.ok(travel.reachable(d.move[0], d.move[1], top, board.width),
                    'offered a swap at row ' + d.move[0] + ' with the stack top at ' + top);
            }
        }
    } finally { detach(); }
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
