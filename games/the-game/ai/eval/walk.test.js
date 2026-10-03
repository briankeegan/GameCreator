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
// WHY THIS TEST EXISTS. Stack.touchSwap is the TOUCH input path — it puts
// the cursor on (row, col) and presses swap there, in one frame, from
// anywhere. A CPU that calls it for its decisions teleports all game. The tell is
// invisible in play (the cursor is drawn wherever it ends up, and it ends
// up somewhere legal), invisible in the benchmark (the games run, the
// scores look like scores), and fatal to the training: a travel-cost
// feature was added to the evaluator, weighted, and trained — pricing a
// cost the simulation never charged. That is this repo's oldest failure
// shape, a check satisfied by something other than the thing it checks.
//
// WHAT IT CHECKS, on real games on the server's engine (pa-engine.js)
// driven by the real CPU (PuyoCpu.onPA):
//   1. the cursor never moves more than one cell in one frame;
//   2. it never moves on two axes in the same frame;
//   3. it DOES move, a lot — a bot that never touches the cursor would
//      pass 1 and 2 trivially, so the coverage assertion is part of the
//      test rather than a nicety;
//   4. every swap the bot presses, and every swap the engine makes, is at
//      the cursor's own cell, and touchSwap is never called.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
var PuyoCpu = require('./puyocpu.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var SEEDS = [1, 2, 3, 4, 5, 6];
var FRAMES = 1800;   // 30 seconds of real play per seed

// Play a real game and watch the cursor every frame. Returns the jumps it
// saw (a jump being any single-frame move of more than one cell, or on
// two axes at once), how many single-cell steps happened, and every swap
// that was queued away from the cursor.
function watch(seed) {
    var stack = PA.game({ level: 10, seed: seed, countdown: false });
    var cpu = PuyoCpu.onPA(stack, {
        weights: require('./registry.js').keys.reduce(function (a, k) { a[k] = 1; return a; }, {}),
        reaction: 12, seed: seed + 55
    });

    // WRAPPING A STACK METHOD IS SAFE ONLY BECAUSE OF THE GUARD BELOW.
    // Assigning here puts an OWN field on the instance, and Stack.copy()
    // carries own fields into every copy the search plays forward, so
    // without `this === stack` each rollout's hypothetical presses would be
    // counted as the live match's.
    var offCursorSwaps = [], touches = [];
    var origQueue = stack.tryQueueSwap;
    stack.tryQueueSwap = function (row, col) {
        // Every press aimed anywhere but the cursor's own cell, made or
        // refused: the engine refuses one off the cursor, so counting only
        // the ones that went through would count nothing.
        if (this === stack && (row !== this.curRow || col !== this.curCol))
            offCursorSwaps.push({ frame: f, at: [row, col], cursor: [this.curRow, this.curCol] });
        return origQueue.call(this, row, col);
    };
    // touchSwap is the TOUCH input path: it puts the cursor on (row, col)
    // and presses swap there, from anywhere, in one frame.
    var origTouch = stack.touchSwap;
    stack.touchSwap = function (row, col) {
        if (this === stack) touches.push({ frame: f, at: [row, col] });
        return origTouch.call(this, row, col);
    };

    var jumps = [], steps = 0, swaps = 0, rides = 0;
    var pr = stack.curRow, pc = stack.curCol, f;
    for (f = 0; f < FRAMES; f++) {
        if (f > 120 && f % 120 === 0) {
            stack.receiveGarbage([{ width: 6, height: 3, isChain: false }]);
        }
        cpu.update();
        var made = stack.swapCount;
        stack.run();
        // The swap the engine made this frame is made at the cursor
        // (Stack.run: tryQueueSwapPanels at curRow, curCol), so the queued
        // pair and the cursor agree once the frame is over.
        if (stack.swapCount > made) {
            swaps++;
            if (stack.queuedSwapRow !== stack.curRow || stack.queuedSwapCol !== stack.curCol)
                offCursorSwaps.push({ frame: f, at: [stack.queuedSwapRow, stack.queuedSwapCol],
                                      cursor: [stack.curRow, stack.curCol] });
        }
        // A rising stack carries the cursor up a row with it (Stack.newRow:
        // curRow + 1). That is the board moving, not the bot, so the ride is
        // taken out before the cursor's own move is measured.
        var ev = stack.drainEvents(), ride = 0;
        for (var e = 0; e < ev.length; e++) if (ev[e].type === 'newRow' && pr !== 0) ride++;
        rides += ride;
        var dr = Math.abs(stack.curRow - Math.min(pr + ride, stack.topCurRow)), dc = Math.abs(stack.curCol - pc);
        if (dr + dc === 1) steps++;
        else if (dr + dc > 1) jumps.push({ frame: f, from: [pr, pc], to: [stack.curRow, stack.curCol], ride: ride });
        pr = stack.curRow; pc = stack.curCol;
        if (stack.gameOver) break;
    }
    return { jumps: jumps, steps: steps, rides: rides, swaps: swaps, frames: f, offCursorSwaps: offCursorSwaps, touches: touches };
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
        if (x.r.touches.length) {
            bad.push('seed ' + x.seed + ': touchSwap called ' + x.r.touches.length + ' time(s), first ' +
                     JSON.stringify(x.r.touches[0]));
        }
    });
    assert.deepStrictEqual(bad, [],
        'the cursor teleported:\n  ' + bad.join('\n  ') +
        '\nEvery swap must be reached by walking, one key at a time ' +
        '(PanelCpu.driveWalk), never by stack.touchSwap.');
});

test('the cursor really is being driven (coverage, not decoration)', function () {
    // A RATE, not a count: games end at different lengths, so an absolute
    // threshold fails a short game that was perfectly active. Measured
    // 0.100-0.136 steps per frame at level 10 on pa-engine.js, seeds 1-6,
    // rides on a rising stack excluded.
    var quiet = [];
    results().forEach(function (x) {
        // Under 0.01 means the bot is not travelling and laws 1-2 above
        // are passing for the wrong reason.
        if (x.r.steps / Math.max(1, x.r.frames) < 0.01)
            quiet.push('seed ' + x.seed + ': only ' + x.r.steps +
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
        '\nA press anywhere but the cursor is the bot reaching for a swap it has ' +
        'not walked to, which is the teleport this whole file exists to forbid.');
});


tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
