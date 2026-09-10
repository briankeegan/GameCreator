// THE CURSOR MOVES ONE CELL AT A TIME, OR IT IS NOT PLAYING THE GAME.
// Run: node walk.test.js
//
// THE RULE. A person plays Panel Attack with four direction keys and a
// swap key. The cursor travels; distance costs frames; a swap on the far
// side of the board is not the same move as a swap under your hand. The
// CPU must be bound by that, because every weight this repo trains is
// answering "which swap is best" and the answer is worthless if the bot
// gets any swap on the board for free.
//
// WHY THIS TEST EXISTS. It did get them for free. Stack.touchSwap is the
// TOUCH input path — it queues a swap at (row, col) and then assigns
// curRow/curCol to that cell, in one frame, from anywhere. The CPU called
// it for every decision, so the cursor teleported all game. The tell is
// invisible in play (the cursor is drawn wherever it ends up, and it ends
// up somewhere legal), invisible in the benchmark (the games run, the
// scores look like scores), and fatal to the training: a travel-cost
// feature was added to the evaluator, weighted, and trained — pricing a
// cost the simulation never charged. That is this repo's oldest failure
// shape, a check satisfied by something other than the thing it checks.
//
// WHAT IT CHECKS, on real games driven by the real CPU:
//   1. the cursor never moves more than one cell in one frame;
//   2. it never moves on two axes in the same frame;
//   3. it DOES move, a lot — a bot that never touches the cursor would
//      pass 1 and 2 trivially, so the coverage assertion is part of the
//      test rather than a nicety;
//   4. every swap the engine queues is queued at the cursor's own cell.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PanelCpu = globalThis.PanelCpu;

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var SEEDS = [1, 2, 3, 4, 5, 6];
var FRAMES = 1800;   // 30 seconds of real play per seed

// Play a real game and watch the cursor every frame. Returns the jumps it
// saw (a jump being any single-frame move of more than one cell, or on
// two axes at once), how many single-cell steps happened, and every swap
// that was queued away from the cursor.
function watch(seed) {
    var stack = new PanelEngine.Stack({ level: 3, seed: seed, countdown: false });
    var cpu = new PanelCpu.SearchCpu(stack, {
        difficulty: 'nightmare', seed: seed + 55, mistake: 0, chainExtend: true
    });

    // WRAPPING A STACK METHOD IS SAFE ONLY BECAUSE OF THE GUARD BELOW.
    // Assigning here puts an OWN field on the instance, shadowing the
    // prototype. TrueSurvivalSearch._cloneStack copies own fields into
    // every simulated future, and a copied closure is still bound to the
    // ORIGINAL stack — so without the guard, each rollout's hypothetical
    // swaps would land on the live match. It went unnoticed for a while:
    // this file's laws hold on a corrupted game just as well as a real one,
    // and the corruption only surfaced as a 546-frame game becoming a
    // 681-frame one in identity.test.js. See the last test in this file.
    var offCursorSwaps = [];
    var origQueue = stack.tryQueueSwap;
    stack.tryQueueSwap = function (row, col) {
        // Read the cursor BEFORE the call: touchSwap queues first and
        // moves the cursor afterwards, so checking after would always
        // agree with itself.
        var cr = this.curRow, cc = this.curCol;
        var ok = origQueue.call(this, row, col);
        if (ok && (row !== cr || col !== cc)) offCursorSwaps.push({ frame: f, at: [row, col], cursor: [cr, cc] });
        return ok;
    };

    var jumps = [], steps = 0;
    var pr = stack.curRow, pc = stack.curCol, f;
    for (f = 0; f < FRAMES; f++) {
        if (f > 120 && f % 120 === 0) {
            stack.receiveGarbage([{ width: 6, height: 3, isChain: false }]);
        }
        cpu.update();
        stack.run();
        stack.drainEvents();
        var dr = Math.abs(stack.curRow - pr), dc = Math.abs(stack.curCol - pc);
        if (dr + dc === 1) steps++;
        else if (dr + dc > 1) jumps.push({ frame: f, from: [pr, pc], to: [stack.curRow, stack.curCol] });
        pr = stack.curRow; pc = stack.curCol;
        if (stack.gameOver) break;
    }
    return { jumps: jumps, steps: steps, frames: f, offCursorSwaps: offCursorSwaps };
}

var runs = null;
function results() {
    if (!runs) runs = SEEDS.map(function (s) { return { seed: s, r: watch(s) }; });
    return runs;
}

test('the cursor never moves more than one cell in a frame', function () {
    // Collected across every seed and reported together — one run per
    // failed assertion is how a four-minute test turns into an afternoon.
    var bad = [];
    results().forEach(function (x) {
        if (x.r.jumps.length) {
            bad.push('seed ' + x.seed + ': ' + x.r.jumps.length + ' jump(s), first ' +
                     JSON.stringify(x.r.jumps[0]));
        }
    });
    assert.deepStrictEqual(bad, [],
        'the cursor teleported:\n  ' + bad.join('\n  ') +
        '\nEvery swap must be reached by walking. If this fires after a change ' +
        'to panel-cpu.js, something is calling stack.touchSwap again.');
});

test('the cursor really is being driven (coverage, not decoration)', function () {
    var quiet = [];
    results().forEach(function (x) {
        // A game of this length makes hundreds of decisions; anything
        // under 50 steps means the bot is not travelling and laws 1-2
        // above are passing for the wrong reason.
        if (x.r.steps < 50) quiet.push('seed ' + x.seed + ': only ' + x.r.steps +
                                       ' cursor steps in ' + x.r.frames + ' frames');
    });
    assert.deepStrictEqual(quiet, [],
        'the cursor barely moved:\n  ' + quiet.join('\n  ') +
        '\nThe no-teleport laws are trivially satisfied by a bot that never ' +
        'moves the cursor at all, so this is what stops them rotting into that.');
});

test('every queued swap happens at the cursor', function () {
    var bad = [];
    results().forEach(function (x) {
        if (x.r.offCursorSwaps.length) {
            bad.push('seed ' + x.seed + ': ' + x.r.offCursorSwaps.length + ' remote swap(s), first ' +
                     JSON.stringify(x.r.offCursorSwaps[0]));
        }
    });
    assert.deepStrictEqual(bad, [],
        'swaps were queued away from the cursor:\n  ' + bad.join('\n  ') +
        '\nThat is touchSwap: it queues at (row,col) and moves the cursor there ' +
        'afterwards, which is the teleport this whole file exists to forbid.');
});

test('instrumenting the real stack cannot leak into a simulated future', function () {
    // THE GUARD THIS FILE DEPENDS ON, checked in both directions.
    //
    // The rule: a rollout is a HYPOTHETICAL. Nothing it does may touch the
    // real match. _cloneStack copies every own-enumerable field of the
    // Stack, and its own comment justified that with "the only
    // instance-level function field anywhere on Stack is rng" — true of the
    // shipped code and false the moment any test wraps a method to watch
    // it, which both this file and identity.test.js do. A function survives
    // _deepClone by reference, so the clone called a closure bound to the
    // real stack.
    //
    // Direction 1: the clone must NOT carry an own method planted on the
    // original — it must fall through to the prototype.
    var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
    var calls = [];
    var real = stack.tryQueueSwap;
    stack.tryQueueSwap = function (r, c) { calls.push([r, c]); return real.call(this, r, c); };

    var clone = PanelCpu.TrueSurvivalSearch._cloneStack(stack, 12345);
    assert.ok(!Object.prototype.hasOwnProperty.call(clone, 'tryQueueSwap'),
        'the clone carries the wrapper as an own field, so a simulated swap runs the ' +
        'observer that is closed over the REAL stack');
    assert.strictEqual(clone.tryQueueSwap, Object.getPrototypeOf(stack).tryQueueSwap,
        'the clone is not using the prototype method, so it is not behaving like an ' +
        'uninstrumented stack');

    // Direction 2: it must still copy ordinary DATA fields, or the guard
    // has been written so broadly that a clone starts a different game.
    stack.gcMarker = { deep: [1, 2, 3] };
    var clone2 = PanelCpu.TrueSurvivalSearch._cloneStack(stack, 12345);
    assert.deepStrictEqual(clone2.gcMarker, { deep: [1, 2, 3] },
        'plain data stopped being cloned — the function guard is too broad');
    assert.notStrictEqual(clone2.gcMarker, stack.gcMarker,
        'the clone shares a data object with the original rather than copying it');

    // And the observable end of it: a swap on the clone must not call the
    // observer that was attached to the original.
    calls.length = 0;
    clone.tryQueueSwap(1, 1);
    assert.deepStrictEqual(calls, [],
        'a swap inside a clone ran the real stack\'s observer — the leak is back');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
