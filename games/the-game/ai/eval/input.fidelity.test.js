// DOES THE INPUT ACTUALLY MATCH THE ENGINE? Run: node input.fidelity.test.js
//
// features.test.js proves a feature computes the right number from a
// hand-built input. It proves NOTHING about whether that input was built
// correctly from the live game — and a feature reading a field that is
// always 0, or the wrong field, produces perfectly plausible numbers and
// tunes into nonsense. "The features aren't hooked up correctly" is the
// failure that looks least like a failure, so it gets its own gate:
//
//   input.js's fromStack() is run against a REAL panel-engine.js Stack,
//   driven into the states the clock features care about, and every field
//   is compared to the engine's own value.
//
// This is the same lesson as ai/experiments/harness_fidelity.test.js, which
// exists because a harness got two engine behaviours wrong, twice, silently,
// invalidating every benchmark in that directory until someone happened to
// re-read the Lua. A snapshot that quietly disagrees with the engine is that
// bug with a new name.
//
// It is deliberately NOT a test of the features' meaning — only of the
// wiring. Meaning is features.test.js's job.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
var PanelEngine = globalThis.PanelEngine;
var inputMod = require('./input.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function newStack(opts) {
    var s = new PanelEngine.Stack(Object.assign({ level: 3, seed: 7 }, opts || {}));
    return s;
}
function run(stack, frames) { for (var i = 0; i < frames; i++) stack.run(); return stack; }

// Every clock field, read straight off the Stack, must equal what
// fromStack put in the input. Written as a table rather than a list of
// asserts so a field ADDED to the input without being wired here is
// visible as an absence, not hidden among a dozen similar lines.
var CLOCK_FIELDS = [
    ['toppedOut', function (s) { return !!s.wasToppedOut; }],
    ['riseLock', function (s) { return !!s.riseLock; }],
    ['preStopTime', function (s) { return s.preStopTime || 0; }],
    ['stopTime', function (s) { return s.stopTime || 0; }],
    ['shakeTime', function (s) { return s.shakeTime || 0; }],
    ['health', function (s) { return s.health || 0; }],
    ['maxHealth', function (s) { return s.levelData.maxHealth || 0; }]
];

function assertClockMatches(stack, label) {
    var got = inputMod.fromStack(stack, {}, {}, null, 0);
    CLOCK_FIELDS.forEach(function (f) {
        assert.strictEqual(got.clock[f[0]], f[1](stack),
            label + ': clock.' + f[0] + ' disagrees with the engine');
    });
}

test('the input covers every clock field the engine exposes', function () {
    var got = inputMod.fromStack(newStack(), {}, {}, null, 0);
    var wired = CLOCK_FIELDS.map(function (f) { return f[0]; }).sort();
    assert.deepStrictEqual(Object.keys(got.clock).sort(), wired,
        'a clock field was added to input.js without being checked here');
});

test('clock matches on a fresh stack', function () {
    assertClockMatches(run(newStack(), 1), 'fresh');
});

test('clock matches after the board has been running', function () {
    assertClockMatches(run(newStack(), 400), 'running');
});

test('health is read live, not captured at construction', function () {
    var s = run(newStack(), 60);
    s.health = 11;
    assert.strictEqual(inputMod.fromStack(s, {}, {}, null, 0).clock.health, 11);
});

test('maxHealth comes from levelData and differs between levels', function () {
    var a = inputMod.fromStack(newStack({ level: 3 }), {}, {}, null, 0).clock.maxHealth;
    var b = inputMod.fromStack(newStack({ level: 10 }), {}, {}, null, 0).clock.maxHealth;
    assert.ok(a > 0 && b > 0, 'maxHealth must be a real number, not 0');
    assert.notStrictEqual(a, b, 'level 3 and level 10 should not share maxHealth — ' +
        'if they do, this test is not proving the field is wired');
});

test('toppedOut reads wasToppedOut, the flag the engine itself acts on', function () {
    // advancePassiveRaise's health drain and awardStopTime's danger bonus
    // both read the latched flag, not the live predicate. A snapshot using
    // isToppedOut() would disagree with the rule it is modelling on
    // exactly the frames that matter.
    var s = run(newStack(), 10);
    s.wasToppedOut = true;
    assert.strictEqual(inputMod.fromStack(s, {}, {}, null, 0).clock.toppedOut, true);
    s.wasToppedOut = false;
    assert.strictEqual(inputMod.fromStack(s, {}, {}, null, 0).clock.toppedOut, false);
});

test('stop time is carried through after a real match awards it', function () {
    var s = run(newStack(), 30);
    s.awardStopTime(true, 4);        // a chain link: the big payer
    assert.ok(s.stopTime > 0, 'engine did not award stop time — test setup is wrong');
    assert.strictEqual(inputMod.fromStack(s, {}, {}, null, 0).clock.stopTime, s.stopTime);
});

test('incoming garbage is carried, by width and height', function () {
    var s = run(newStack(), 30);
    s.receiveGarbage([{ width: 6, height: 2, isChain: true }]);
    var got = inputMod.fromStack(s, {}, {}, null, 0);
    assert.strictEqual(got.incoming.length, s.incoming.length,
        'incoming queue length disagrees with the engine');
    assert.ok(got.incoming.length > 0, 'engine queued nothing — test setup is wrong');
    assert.strictEqual(got.incoming[0].width, s.incoming[0].width);
    assert.strictEqual(got.incoming[0].height, s.incoming[0].height);
});

test('an empty incoming queue is [] and not undefined', function () {
    var got = inputMod.fromStack(run(newStack(), 5), {}, {}, null, 0);
    assert.ok(Array.isArray(got.incoming));
});

test('displacement is carried — a board one pixel from a new row is not the same board', function () {
    var s = run(newStack(), 200);
    assert.strictEqual(inputMod.fromStack(s, {}, {}, null, 0).displacement, s.displacement);
});

test('the level colour count is carried, and is a real number', function () {
    // Carried but unread today. A field nobody reads is exactly the field
    // that rots into a silent 0, so it is checked against the engine now
    // rather than when a feature first depends on it.
    var s = run(newStack({ level: 3 }), 5);
    var got = inputMod.fromStack(s, {}, {}, null, 0);
    assert.strictEqual(got.colours, s.colors);
    assert.ok(got.colours >= 3, 'a level with fewer than 3 colours could not match at all');
});

test('earned comes from the resolved candidate, not from the stack', function () {
    // The move being scored has not happened on the real stack — it is a
    // hypothetical the search resolved on a LogicalBoard. Reading these off
    // the Stack would score every candidate identically.
    var s = run(newStack(), 30);
    var got = inputMod.fromStack(s, {}, { chainLength: 4, comboSizes: [5], garbage: [[6, 3]] }, null, 2);
    assert.strictEqual(got.earned.chainLength, 4);
    assert.deepStrictEqual(got.earned.comboSizes, [5]);
    assert.deepStrictEqual(got.earned.garbageSent, [[6, 3]]);
    assert.strictEqual(got.earned.garbageCleared, 2);
});

test('chainMarks stays null when not mid-cascade, and is the map when it is', function () {
    var s = run(newStack(), 30);
    assert.strictEqual(inputMod.fromStack(s, {}, {}, null, 0).chainMarks, null);
    var marks = { '3:4': true };
    assert.strictEqual(inputMod.fromStack(s, {}, {}, { chainMarks: marks }, 0).chainMarks, marks);
});

test('fromStack survives a null stack (recorded position, no engine in process)', function () {
    var got = inputMod.fromStack(null, { width: 6, height: 12, grid: [], blocks: {} }, {}, null, 0);
    assert.strictEqual(got.clock.health, 0);
    assert.strictEqual(got.board.width, 6);
});


// ---- the match rule itself, checked against getMatchingPanels ----
//
// features.js re-implements the engine's matching rule (runs of 3+ along
// both axes, unioned board-wide) because a feature must be a pure function
// of a snapshot and cannot call into a live Stack. A re-implementation is
// exactly the drift this directory exists to prevent, so it is checked
// against the real thing on random boards rather than trusted.
//
// This is the check that would have caught the subtle one: the engine's
// comboSize is `matching.length` across the WHOLE BOARD, every colour, not
// per connected group — which is why an L pays as a 5. A reasonable reading
// of "combo" as "one connected group" passes every hand-written test and
// disagrees with the engine here.
//
// SWEPT ACROSS SEEDS AND COLOUR COUNTS, and the sweep REPORTS ITS OWN
// COVERAGE. A randomised test on one seed is a hand-written test wearing a
// disguise — it exercises one arbitrary set of boards forever. And a sweep
// that happens to generate nothing interesting passes just as green as one
// that finds the bug, so the coverage assertions below fail if the boards
// were too sparse, too dense, or never contained the case being checked.
var features = require('./features.js');

var SEEDS = [1, 7, 42, 99, 1234, 31337, 20260907];
var COLOUR_COUNTS = [2, 3, 4, 5, 6, 8];   // 2 makes matches unavoidable, 8 makes them rare — both ends are the point

// A random board written straight onto a real Stack's panels, so the engine
// and the feature are looking at the same thing by construction. `garbage`
// sprinkles real garbage panels in, since garbage never matches but does
// decide whether a 3 is worth making.
function randomBoard(rng, colours, garbageChance) {
    var stack = newStack();
    var grid = [], blocks = {}, r, c;
    for (r = 0; r <= stack.height; r++) grid[r] = [];
    for (r = 1; r <= stack.height; r++) {
        for (c = 1; c <= PanelEngine.WIDTH; c++) {
            var p = stack.panelAt(r, c);
            var roll = rng();
            var v;
            if (garbageChance && roll < garbageChance) {
                v = -2;
                p.isGarbage = true; p.color = 9; p.state = 'normal';
                var id = 'g' + r + '_' + c;
                blocks[id] = { cells: [[r, c]] };
            } else {
                v = Math.floor(rng() * (colours + 1));   // 0 = empty
                p.isGarbage = false; p.color = v; p.state = 'normal';
            }
            grid[r][c] = v;
        }
    }
    return {
        stack: stack,
        board: { width: PanelEngine.WIDTH, height: stack.height, grid: grid, blocks: blocks }
    };
}

// getMatchingPanels marks the panels it returns, and mark() skips
// already-marked ones — so a second call on the same stack silently
// returns less. Every call here is followed by this.
function engineMatches(stack) {
    var found = stack.getMatchingPanels();
    var keys = found.map(function (p) { return p.row + ':' + p.col; }).sort();
    found.forEach(function (p) { p.matching = false; });
    return keys;
}

test('the feature match rule agrees with the engine across seeds and colour counts', function () {
    var boards = 0, withMatches = 0, empty = 0, big = 0;
    SEEDS.forEach(function (seed) {
        COLOUR_COUNTS.forEach(function (colours) {
            var rng = PanelEngine.makeRng(seed);
            for (var i = 0; i < 60; i++) {
                var rb = randomBoard(rng, colours, i % 3 === 0 ? 0.12 : 0);
                var mine = Object.keys(features._matchedCells(rb.board)).sort();
                assert.deepStrictEqual(mine, engineMatches(rb.stack),
                    'seed ' + seed + ', ' + colours + ' colours, board ' + i +
                    ': feature match set disagrees with getMatchingPanels');
                boards++;
                if (mine.length) { withMatches++; if (mine.length >= 5) big++; } else { empty++; }
            }
        });
    });
    // Coverage — a sweep that never generated the interesting case is not
    // evidence of anything.
    assert.ok(boards >= 2000, 'swept only ' + boards + ' boards');
    assert.ok(withMatches > boards * 0.2, 'only ' + withMatches + '/' + boards +
        ' boards had any match — the sweep is too sparse to be testing the rule');
    assert.ok(empty > boards * 0.08, 'only ' + empty + '/' + boards +
        ' boards had NO match — the sweep is too dense to be testing the rule');
    assert.ok(big > 20, 'only ' + big + ' boards produced a 5+ union — the ' +
        'board-wide-union case, the one a connected-group reading gets wrong, ' +
        'is barely exercised');
});

// ---- matchPotential itself, cross-checked against the engine ----
//
// The hand-built cases in features.test.js pin the RULE. This pins the
// IMPLEMENTATION against the engine on boards nobody chose: for every legal
// colour-to-colour swap, apply it to the real Stack, ask getMatchingPanels
// what happened, and decide independently whether it qualifies. The counts
// must agree exactly.
//
// Independent is the operative word — this deliberately does not reuse
// features.js's own helpers, since a shared helper with a bug agrees with
// itself perfectly.
test('matchPotential agrees with an engine-driven count across seeds', function () {
    var boards = 0, nonZero = 0, garbageQualified = 0, totalCounted = 0;
    SEEDS.forEach(function (seed) {
        COLOUR_COUNTS.forEach(function (colours) {
            var rng = PanelEngine.makeRng(seed + 5000);
            for (var i = 0; i < 25; i++) {
                var withGarbage = i % 2 === 0;
                var rb = randomBoard(rng, colours, withGarbage ? 0.12 : 0);
                var stack = rb.stack, grid = rb.board.grid;
                var W = PanelEngine.WIDTH, H = stack.height;
                var expected = 0;

                for (var r = 1; r <= H; r++) {
                    for (var c = 1; c < W; c++) {
                        var a = grid[r][c], b = grid[r][c + 1];
                        if (a <= 0 || b <= 0 || a === b) continue;
                        var pa = stack.panelAt(r, c), pb = stack.panelAt(r, c + 1);
                        pa.color = b; pb.color = a;
                        grid[r][c] = b; grid[r][c + 1] = a;

                        var keys = engineMatches(stack);
                        var caused = keys.indexOf(r + ':' + c) >= 0 ||
                                     keys.indexOf(r + ':' + (c + 1)) >= 0;
                        var garbage = false;
                        for (var k = 0; k < keys.length && !garbage; k++) {
                            var parts = keys[k].split(':');
                            var mr = Number(parts[0]), mc = Number(parts[1]);
                            var n = [[mr + 1, mc], [mr - 1, mc], [mr, mc + 1], [mr, mc - 1]];
                            for (var j = 0; j < n.length; j++) {
                                var np = (n[j][0] >= 1 && n[j][0] <= H && n[j][1] >= 1 && n[j][1] <= W)
                                    ? stack.panelAt(n[j][0], n[j][1]) : null;
                                if (np && np.isGarbage) { garbage = true; break; }
                            }
                        }
                        if (caused && (keys.length >= 4 || garbage)) {
                            expected++;
                            if (keys.length < 4 && garbage) garbageQualified++;
                        }

                        pa.color = a; pb.color = b;
                        grid[r][c] = a; grid[r][c + 1] = b;
                    }
                }

                var got = features.matchPotential(inputMod.normalize({ board: rb.board }));
                assert.strictEqual(got, expected,
                    'seed ' + seed + ', ' + colours + ' colours, board ' + i +
                    ': matchPotential said ' + got + ', engine-driven count said ' + expected);
                boards++;
                totalCounted += expected;
                if (expected > 0) nonZero++;
            }
        });
    });
    assert.ok(nonZero > boards * 0.2, 'only ' + nonZero + '/' + boards +
        ' boards had any qualifying swap — this is not exercising the feature');
    assert.ok(totalCounted > 100, 'only ' + totalCounted + ' qualifying swaps in total');
    assert.ok(garbageQualified > 5, 'only ' + garbageQualified + ' swaps qualified via the ' +
        'garbage clause — the plain-3-that-touches-garbage rule is barely covered');
});



// ---- garbageSent, against pushGarbage and the engine's own table ----
//
// The sizes a combo sends are a TABLE in panel-engine.js (COMBO_GARBAGE,
// ported from checkMatches.lua). Retyping any of its numbers into a test
// would mean the test agrees with my memory of the table rather than with
// the table, which is the whole class of bug this file exists for. So the
// expected values come from driving pushGarbage on a real Stack.
test('garbageSent matches what the engine actually queues, for combos', function () {
    var sizes = [3, 4, 5, 6, 7, 8, 11, 20], sawEmpty = false, sawReal = false;
    sizes.forEach(function (size) {
        var s = run(newStack(), 5);
        s.outgoing.length = 0;
        s.currentChain = null;
        s.pushGarbage({ row: 1, col: 1 }, false, size);
        var expected = 0;
        s.outgoing.forEach(function (g) { expected += g.width * g.height; });
        var got = features.garbageSent(inputMod.normalize({
            earned: { garbageSent: s.outgoing.map(function (g) { return [g.width, g.height]; }) }
        }));
        assert.strictEqual(got, expected, 'combo of ' + size);
        if (expected === 0) sawEmpty = true; else sawReal = true;
    });
    assert.ok(sawEmpty, 'no combo size sent nothing — comboGarbage returns [] below 4, ' +
        'so a 3 must be in this sweep or the zero case is untested');
    assert.ok(sawReal, 'no combo sent anything at all');
});

test('a 3-combo sends NOTHING, and the engine says so, not this test', function () {
    var s = run(newStack(), 5);
    s.outgoing.length = 0; s.currentChain = null;
    s.pushGarbage({ row: 1, col: 1 }, false, 3);
    assert.deepStrictEqual(s.outgoing, [], 'engine queued something for a 3-combo');
    assert.strictEqual(features.garbageSent(inputMod.normalize({ earned: { garbageSent: [] } })), 0);
});

test('garbageSent grows a full-width row per chain link, per the engine', function () {
    var s = run(newStack(), 5);
    s.outgoing.length = 0; s.currentChain = null;
    var seen = [];
    for (var link = 0; link < 4; link++) {
        s.pushGarbage({ row: 1, col: 1 }, true, 0);
        var cells = 0;
        s.outgoing.forEach(function (g) { cells += g.width * g.height; });
        seen.push(features.garbageSent(inputMod.normalize({
            earned: { garbageSent: s.outgoing.map(function (g) { return [g.width, g.height]; }) }
        })));
        assert.strictEqual(seen[link], cells);
    }
    for (var i = 1; i < seen.length; i++) {
        assert.strictEqual(seen[i] - seen[i - 1], PanelEngine.WIDTH,
            'each extra link must add exactly one full-width row');
    }
});


// ---- framesToDeath, against an actual death ----
//
// This is the assertion the whole feature rests on. Everything else about
// it is arithmetic on four fields, and arithmetic that agrees with itself
// proves nothing — the question is whether the number counts down to a
// real death at the real rate. So: top a Stack out, read the feature, then
// run the engine until it actually dies, and compare.
function toppedOutStack(level) {
    var s = new PanelEngine.Stack({ level: level || 3, seed: 3 });
    // PAST THE COUNTDOWN FIRST. Stack.run() only calls runPhysics once
    // stopWatchIsRunning, so a board built during the countdown never
    // latches wasToppedOut and the whole test silently measures a stack
    // that is not running yet. Cost an hour the first time.
    var guard = 0;
    while (!s.stopWatchIsRunning && guard++ < 1000) s.run();
    assert.ok(s.stopWatchIsRunning, 'countdown never finished');
    // Fill every column to the ceiling with a pattern that cannot match,
    // so nothing pops and the board stays topped out.
    for (var r = 1; r <= s.height; r++) {
        for (var c = 1; c <= PanelEngine.WIDTH; c++) {
            var p = s.panelAt(r, c);
            p.isGarbage = false;
            p.state = 'normal';
            p.color = ((r + 2 * c) % 3) + 1;   // no run of three anywhere
        }
    }
    s.run();
    return s;
}

test('framesToDeath counts down to a real death at the real rate', function () {
    var s = toppedOutStack();
    assert.ok(s.wasToppedOut, 'setup failed: the stack is not topped out');
    var predicted = features.framesToDeath(inputMod.fromStack(s, {}, {}, null, 0));
    assert.ok(isFinite(predicted) && predicted > 0,
        'a topped-out board with health should predict a finite countdown, got ' + predicted);
    assert.ok(predicted < features.SAFE_FRAMES,
        'a board that is actually dying must not read as saturated-safe');

    var frames = 0;
    while (!s.gameOver && frames < predicted * 4 + 600) { s.run(); frames++; }
    assert.ok(s.gameOver, 'the stack never died in ' + frames + ' frames — the prediction ' +
        'of ' + predicted + ' cannot be checked against anything');
    // Exactness is not the claim: the engine also re-latches wasToppedOut,
    // and a swap or a landing can pause the drain. The claim is that the
    // feature is measuring THIS, not something with the same units.
    assert.ok(Math.abs(frames - predicted) <= predicted * 0.5 + 10,
        'predicted ' + predicted + ' frames, actually survived ' + frames);
});

test('framesToDeath saturates for a board that is not topped out, and that board does not die', function () {
    var s = run(newStack(), 60);
    assert.strictEqual(features.framesToDeath(inputMod.fromStack(s, {}, {}, null, 0)),
                       features.SAFE_FRAMES);
    for (var i = 0; i < 600; i++) s.run();
    assert.ok(!s.gameOver, 'a board predicted unkillable died within 600 frames');
});

test('stop time does NOT bank — the engine takes a max, so the feature must not sum', function () {
    // The single most important assertion about this feature. awardStopTime
    // ends `if (stopTime > this.stopTime) this.stopTime = stopTime`, so a
    // chain awarded while more stop time is already on the clock earns
    // nothing at all. Scored as "banked + earned" the search would learn
    // the opposite of the truth.
    var s = toppedOutStack();
    s.stopTime = 0;
    s.awardStopTime(true, 4);
    var big = s.stopTime;
    assert.ok(big > 0, 'setup failed: no stop time awarded');
    var before = features.framesToDeath(inputMod.fromStack(s, {}, {}, null, 0));

    s.awardStopTime(false, 4);      // a smaller award, on a clock already full
    assert.strictEqual(s.stopTime, big, 'the engine itself did not apply the max');
    var after = features.framesToDeath(inputMod.fromStack(s, {}, {}, null, 0));
    assert.strictEqual(after, before,
        'the feature grew by the second award (' + before + ' -> ' + after + '), so it is ' +
        'summing where the engine takes a max');
});

tests.forEach(function (t) {
    try { t.fn(); process.stdout.write('  ok   ' + t.name + '\n'); }
    catch (e) { failures.push(t.name + '\n       ' + e.message); process.stdout.write('  FAIL ' + t.name + '\n'); }
});
if (failures.length) {
    process.stdout.write('\n' + failures.length + ' failed:\n\n' + failures.join('\n\n') + '\n');
    process.exit(1);
}
process.stdout.write('\n' + tests.length + ' passed — the input agrees with the real engine.\n');
