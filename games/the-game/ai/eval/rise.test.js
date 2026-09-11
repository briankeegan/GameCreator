// DOES THE BOARD RISE, AND DOES IT RESOLVE ALL THE WAY DOWN?
// Run: node rise.test.js
//
// THE BUG THIS EXISTS FOR. Every candidate move was scored at the ugliest
// instant it will ever have — the frame its match finished popping, hole
// open, cluster spent, colour scarce — while HOLDING was scored on a board
// that had not moved at all. Measured over 570 real level-10 decisions on
// the shipped weights, a swap clearing 7+ panels scored 1537 points WORSE
// than doing nothing on the same board, and the bot held 52% of its
// decisions with clears available, one of them a whole 3-chain.
//
// rise() is the fix: the stack goes up whatever the bot does, so every
// candidate is advanced by the SAME row before it is judged.
//
// WHAT THIS FILE IS REALLY GUARDING. A rise can set off a match, whose
// fall can set off another, and another. If rise() shifted the grid but
// the resolve stopped after one pass, a cascade would be silently
// truncated — the board would look settled, every score would be a
// plausible number, and the bot would be blind to exactly the moves it is
// supposed to be learning to make. So the cascade cases below assert the
// LINK COUNT, and every test ends by proving the board is genuinely
// finished: resolving it again finds nothing and changes nothing.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var PuyoCpu = require('./puyocpu.js');
var registry = require('./registry.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var W = 6, H = 8, COLORS = 6;

// rows[0] is the BOTTOM row (row 1). 0 = empty. Everything above a gap
// would be unsupported, so a board written here is settled by construction
// as long as each column is filled from the bottom up.
function make(rows) {
    var grid = [];
    for (var r = 0; r <= H; r++) {
        grid[r] = [];
        for (var c = 1; c <= W; c++) grid[r][c] = 0;
    }
    for (var i = 0; i < rows.length; i++) {
        for (var c2 = 1; c2 <= W; c2++) grid[i + 1][c2] = rows[i][c2 - 1];
    }
    return new LogicalBoard(W, H, COLORS, grid, {});
}

function dump(board) {
    var out = [];
    for (var r = H; r >= 1; r--) {
        var line = [];
        for (var c = 1; c <= W; c++) line.push(board.grid[r][c]);
        out.push(line.join(''));
    }
    return out.join('\n');
}

// THE END OF EVERY TEST. A board that still has a match in it is a board
// the search would score as settled while it is not.
function assertSettled(board) {
    var before = dump(board);
    var again = board.resolve();
    assert.strictEqual(again.chainLength, 0,
        'the board was not finished — resolving it again found ' + again.chainLength +
        ' more link(s), so a cascade was being truncated:\n' + before);
    assert.strictEqual(dump(board), before, 'resolving a settled board changed it');
}

// ---- the shift itself ----

test('every row moves up one and the incoming row lands at the bottom', function () {
    var b = make([[1, 2, 3, 4, 5, 6],
                  [6, 5, 4, 3, 2, 1]]);
    b.rise([null, 2, 3, 2, 3, 2, 3]);   // 1-indexed by column, like the grid
    assert.deepStrictEqual(b.grid[1].slice(1), [2, 3, 2, 3, 2, 3], 'incoming row is not at row 1');
    assert.deepStrictEqual(b.grid[2].slice(1), [1, 2, 3, 4, 5, 6], 'the old bottom row did not move up');
    assert.deepStrictEqual(b.grid[3].slice(1), [6, 5, 4, 3, 2, 1], 'the second row did not move up');
    assertSettled(b);
});

test('with no incoming row given, the new row is unknown rather than invented', function () {
    // A board whose next row genuinely is not decided yet must not be
    // handed six colours somebody made up — that is a hallucinated match
    // waiting to happen.
    var b = make([[1, 1, 2, 2, 3, 3]]);
    b.rise(null);
    for (var c = 1; c <= W; c++) assert.strictEqual(b.grid[1][c], -1);
});

test('row 0 is cleared to unknown, because the row after next cannot be known', function () {
    var b = make([[1, 2, 3, 4, 5, 6]]);
    b.grid[0] = [null, 1, 1, 1, 1, 1, 1];
    b.rise([null, 2, 2, 2, 3, 3, 3]);
    for (var c = 1; c <= W; c++) {
        assert.strictEqual(b.grid[0][c], -1,
            'row 0 still holds the row that just entered play, so the next rise would ' +
            'deal the same six panels twice');
    }
});

// ---- resolving all the way down ----

test('a rise that completes a match clears it', function () {
    var b = make([[4, 5, 4, 5, 4, 5]]);
    b.rise([null, 1, 1, 1, 2, 3, 2]);
    var res = b.resolve();
    assert.strictEqual(res.chainLength, 1, 'the arriving row matched and nothing popped');
    assert.deepStrictEqual(res.comboSizes, [3]);
    assertSettled(b);
});

test('BREAK, THEN BREAK AGAIN: the fall from one match sets off the next', function () {
    // By eye, bottom row first. The arriving row is 1,1,1 under three
    // columns whose second row holds 3,3 and whose fourth column already
    // shows a 3 in the arriving row:
    //
    //     row2   2 3 3 5 4 5
    //     row1   1 1 1 3 5 4     <- arrives
    //
    // The three 1s pop. Column 1-3 drop one, putting 3,3 beside the 3 that
    // was already sitting at row 1 column 4 — three in a row, second link.
    var b = make([[2, 3, 3, 5, 4, 5]]);
    b.rise([null, 1, 1, 1, 3, 5, 4]);
    var res = b.resolve();
    assert.strictEqual(res.chainLength, 2,
        'expected two links — the arriving row, then the fall — got ' + res.chainLength +
        '\n' + dump(b));
    assertSettled(b);
});

test('THREE LINKS, and the first one is two groups at once', function () {
    // Walked by hand, link by link. Settled board, bottom row first:
    //
    //     row4   1 4 4 1 3 2
    //     row3   3 4 2 5 2 3
    //     row2   2 5 3 5 5 1
    //     row1   4 2 2 1 5 1
    //
    // The arriving row is 2 1 1 5 5 5, so after the rise the bottom is
    // 2 1 1 5 5 5 with 4 2 2 1 5 1 above it.
    //
    //   LINK 1 — FIVE cells, not three: the arriving 5s at columns 4,5,6
    //     match sideways AND the column-5 fives above them (rows 2 and 3)
    //     match downwards, one connected group of five.
    //   LINK 2 — the fall drops a 1 into column 4 beside the arriving 1s
    //     at columns 2 and 3. Three cells.
    //   LINK 3 — that fall drops a 2 into column 1 beside the 2s that just
    //     landed in columns 2 and 3. Three cells.
    //
    // A single-pass resolve would report link 1 and stop, and the board it
    // handed back would still have two live matches sitting in it.
    var b = make([[4, 2, 2, 1, 5, 1],
                  [2, 5, 3, 5, 5, 1],
                  [3, 4, 2, 5, 2, 3],
                  [1, 4, 4, 1, 3, 2]]);
    b.rise([null, 2, 1, 1, 5, 5, 5]);
    var res = b.resolve();
    assert.strictEqual(res.chainLength, 3,
        'expected three links, got ' + res.chainLength + '\n' + dump(b));
    assert.deepStrictEqual(res.comboSizes, [5, 3, 3],
        'the links did not clear 5 then 3 then 3 — got ' + JSON.stringify(res.comboSizes) +
        '\n' + dump(b));
    assertSettled(b);
});

test('a pass that matches more than one group counts every cell in it', function () {
    // comboSizes records the cells cleared in a LINK, so two groups going
    // off together are one entry holding both. A resolve that counted only
    // the first group it found would report 3 here instead of 5, and every
    // combo feature downstream would under-read a multi-group pop.
    var b = make([[4, 2, 2, 1, 5, 1],
                  [2, 5, 3, 5, 5, 1],
                  [3, 4, 2, 5, 2, 3],
                  [1, 4, 4, 1, 3, 2]]);
    b.rise([null, 2, 1, 1, 5, 5, 5]);
    b._applyGravity();
    var first = b._findMatches();
    assert.strictEqual(Object.keys(first).length, 5,
        'the first pass found ' + Object.keys(first).length + ' cells, not the five that ' +
        'make up the sideways 5s and the two above them');
});

test('a truncated cascade is caught: one resolve pass is not enough', function () {
    // THE MUTATION THIS FILE EXISTS TO CATCH, asserted rather than trusted.
    // Resolve once by hand the way a single-pass implementation would, and
    // prove the board is left with a live match in it — which is exactly
    // what assertSettled refuses everywhere else.
    var b = make([[2, 3, 3, 5, 4, 5]]);
    b.rise([null, 1, 1, 1, 3, 5, 4]);
    b._applyGravity();
    var first = b._findMatches();
    assert.ok(Object.keys(first).length, 'the arriving row did not match at all');
    for (var k in first) b.grid[first[k][0]][first[k][1]] = 0;
    b._applyGravity();
    var second = b._findMatches();
    assert.ok(Object.keys(second).length,
        'a single pass left no second match, so this board cannot prove truncation ' +
        'would be noticed — rewrite it before trusting the cascade tests');
});

// ---- garbage keeps its blocks ----

test('garbage blocks move up with their cells', function () {
    // A block whose cell list still points at the old rows is the one way
    // this model goes quietly wrong: the grid says -2 in one place and
    // `blocks` says another, and _pruneClearedBlocks can only delete cells,
    // never repair a row index.
    var grid = [];
    for (var r = 0; r <= H; r++) { grid[r] = []; for (var c = 1; c <= W; c++) grid[r][c] = 0; }
    for (var c2 = 1; c2 <= W; c2++) grid[1][c2] = -2;
    var b = new LogicalBoard(W, H, COLORS, grid,
        { g1: { cells: [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6]] } });
    b.rise([null, 1, 2, 1, 2, 1, 2]);
    assert.strictEqual(b.blocks.g1.cells.length, 6, 'the block lost cells it should have kept');
    b.blocks.g1.cells.forEach(function (rc) {
        assert.strictEqual(rc[0], 2, 'the block did not move up with the grid');
        assert.strictEqual(b.grid[rc[0]][rc[1]], -2,
            'the block says garbage at r' + rc[0] + 'c' + rc[1] + ' and the grid does not');
    });
});

test('a block pushed past the ceiling leaves with its panels', function () {
    var grid = [];
    for (var r = 0; r <= H; r++) { grid[r] = []; for (var c = 1; c <= W; c++) grid[r][c] = 0; }
    for (var r2 = 1; r2 <= H; r2++) for (var c = 1; c <= W; c++) grid[r2][c] = (r2 === H) ? -2 : 1;
    var cells = [];
    for (var c3 = 1; c3 <= W; c3++) cells.push([H, c3]);
    var b = new LogicalBoard(W, H, COLORS, grid, { g1: { cells: cells } });
    b.rise([null, 1, 2, 1, 2, 1, 2]);
    assert.ok(!b.blocks.g1, 'the block was shifted above the ceiling but is still listed, ' +
        'so `blocks` now names cells the grid does not have');
});

// ---- through the bot ----

function zeros() { var w = {}; registry.keys.forEach(function (k) { w[k] = 0; }); return w; }
function sample() {
    var w = zeros();
    w.links = 25; w.colourVariance = 2; w.edgePenalty = 8;
    w.maxHeight = 30; w.garbageOnBoard = 25; w.roughness = 40; w.garbageSent = 60;
    return w;
}
function play(opts, frames) {
    var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
    var o = { weights: sample(), reaction: 12 };
    for (var k in opts) o[k] = opts[k];
    var cpu = new PuyoCpu(stack, o), moves = [];
    for (var f = 0; f < frames && !stack.gameOver; f++) {
        var before = cpu.decisions;
        cpu.update();
        stack.run();
        stack.drainEvents();
        if (cpu.decisions > before) moves.push(stack.curRow + ':' + stack.curCol);
    }
    return moves;
}

test('THE CASCADE THE RISE SETS OFF REACHES THE SCORE, not just the board', function () {
    // THE MUTATION THAT GOT THROUGH. Every cascade test above drives
    // LogicalBoard directly, so all of them stayed green when _score was
    // changed to rise the board and then NOT resolve it — the one place
    // the truncation would actually cost the bot anything. A cascade that
    // the search cannot see is a cascade the bot will never play for.
    //
    // So: score the three-link board from above with a weight set where
    // the only thing worth anything is garbage sent and chain length. If
    // the post-rise resolve runs, those are non-zero because the arriving
    // row sets off 5 then 3 then 3. If it does not, they are zero and the
    // score is zero, whatever the board looks like afterwards.
    var stack = new PanelEngine.Stack({ level: 10, seed: 4, countdown: false });
    var w = zeros();
    w.garbageSent = 100; w.chainLength = 100;
    var cpu = new PuyoCpu(stack, { weights: w, reaction: 12, rise: true });

    var board = make([[4, 2, 2, 1, 5, 1],
                      [2, 5, 3, 5, 5, 1],
                      [3, 4, 2, 5, 2, 3],
                      [1, 4, 4, 1, 3, 2]]);
    // What _decide would hand it: a settled board, and a move that itself
    // earned nothing. Everything below therefore comes from the rise.
    var nothingEarned = { chainLength: 0, comboSizes: [], garbage: [] };
    cpu._incoming = [null, 2, 1, 1, 5, 5, 5];

    var withRise = cpu._score(board.clone(), nothingEarned, null);
    cpu.rise = false;
    var without = cpu._score(board.clone(), nothingEarned, null);

    assert.strictEqual(without, 0,
        'the move earned nothing and rise is off, so nothing should have scored — got ' +
        without + ', which means this test is measuring something other than the cascade');
    assert.ok(withRise > 0,
        'the arriving row sets off a 5-3-3 cascade and the score came back ' + withRise +
        ' — the rise is happening but its resolve is being thrown away, so no cascade ' +
        'a rise causes can ever be worth anything to the search');
});

test('rise is OFF by default, so the shipped bot is untouched', function () {
    assert.deepStrictEqual(play({}, 1500), play({ rise: false }, 1500),
        'passing rise:false played a different game from passing nothing');
});

test('turning rise on plays a different game', function () {
    var off = play({}, 1500), on = play({ rise: true }, 1500);
    assert.notDeepStrictEqual(off, on,
        'rise:true changed nothing — the option is wired to nothing, which is how a ' +
        'knob attached to nothing gets trained against');
});

test('every candidate of one decision is risen by the SAME row', function () {
    // Otherwise the comparison is unfair again in a new way: one candidate
    // judged against a helpful arriving row, another against a useless one.
    var stack = new PanelEngine.Stack({ level: 10, seed: 3, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample(), reaction: 12, rise: true });
    for (var f = 0; f < 400; f++) { cpu.update(); stack.run(); stack.drainEvents(); }
    var seen = [];
    var orig = globalThis.PanelCpu.LogicalBoard.prototype.rise;
    globalThis.PanelCpu.LogicalBoard.prototype.rise = function (colors) {
        seen.push(colors ? colors.slice(1).join(',') : 'null');
        return orig.call(this, colors);
    };
    try { cpu._decide(); } finally { globalThis.PanelCpu.LogicalBoard.prototype.rise = orig; }
    assert.ok(seen.length > 1, 'only ' + seen.length + ' candidate was risen — the decision ' +
        'was too small to prove anything');
    seen.forEach(function (row) {
        assert.strictEqual(row, seen[0], 'candidates were risen by different rows: ' +
            seen[0] + ' vs ' + row);
    });
});

test('the incoming row the bot rises by is the one the engine will actually deal', function () {
    // The "not actually hooked up" failure: rise() could be fed a row of
    // nothing and every test above would still pass, because they all hand
    // it a row themselves.
    var stack = new PanelEngine.Stack({ level: 10, seed: 11, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: sample(), reaction: 12, rise: true });
    for (var f = 0; f < 300; f++) { cpu.update(); stack.run(); stack.drainEvents(); }
    var board = cpu._snapshot();
    assert.ok(board.incoming, 'the snapshot carries no incoming row at all');
    var real = [];
    for (var c = 1; c <= PanelEngine.WIDTH; c++) real.push(stack.panelAt(0, c).color);
    assert.deepStrictEqual(board.incoming.slice(1), real,
        'the row the search rises by is not the row sitting at stack row 0');
    real.forEach(function (v) {
        assert.ok(v > 0, 'the engine\'s own incoming row holds a non-colour (' + v + ')');
    });
});

test('THE REGRESSION THIS EXISTS FOR: a big clear stops being the worst move on the board', function () {
    // The measurement that started all of this, as an assertion, on the
    // weights the game actually ships and in the drill they were trained
    // in. Score every candidate of every decision against HOLDING on that
    // same board, and group by how many panels the candidate cleared:
    //
    //     cleared   rise off    rise on
    //        0        -134       -306
    //        3        -181       -838
    //      4-6       -1133      -1073
    //       7+       -1537       -409
    //
    // Off, it is monotonic: the more a move cleared, the worse it scored,
    // so the best thing on the board was always to do nothing. That is not
    // a weight the search chose — it is where the simulation STOPS, at the
    // instant the hole is open and the panels that refill it have not
    // arrived yet. On, the ordering is gone and the biggest clears are the
    // cheapest of the lot.
    //
    // IT MUST BE THE ENDLESS DRILL, NOT A BARE STACK. On a board with no
    // garbage arriving, the same sweep moves 7+ only from -1351 to -1116,
    // because the largest thing a big clear buys is taking GARBAGE off the
    // board with it, and a bare stack never has any. Measuring this on an
    // empty-handed board reports a 17% effect for a change worth 73%.
    //
    // The absolute numbers are the OLD weights driving a new bot, so they
    // are a mismatch by construction (frames 9514 -> 7687, sent 123 ->
    // 104). What is asserted here is the SHAPE, which is what a retrain
    // then has to work with.
    assert.ok(process.env.GC_TRAINING_DIR,
        'GC_TRAINING_DIR is unset, so bench.js cannot load the real attack files and ' +
        'this sweep would silently measure a garbage-free board — which reports a ' +
        'fifth of the real effect. Set it to panel-game/client/assets/default_data/training');
    var bench = require('./bench.js');
    require(path.join(__dirname, '..', 'trained-weights.js'));
    var shipped = globalThis.PanelEval.trained.weights;

    function panels(b) {
        var n = 0;
        for (var r = 1; r <= b.height; r++)
            for (var c = 1; c <= b.width; c++) if (b.grid[r][c] > 0) n++;
        return n;
    }
    function sweep(rise) {
        var buckets = { '0': { n: 0, sum: 0 }, '3': { n: 0, sum: 0 },
                        '4-6': { n: 0, sum: 0 }, '7+': { n: 0, sum: 0 } };
        var orig = PuyoCpu.prototype._decide;
        PuyoCpu.prototype._decide = function () {
            var board = this._snapshot();
            this._incoming = board.incoming || null;
            var before = panels(board);
            var hb = board.clone();
            var hold = this._score(hb, hb.resolve(), null);
            var legal = board.legalSwaps();
            for (var i = 0; i < legal.length; i++) {
                var t = board.clone();
                t.swap(legal[i][0], legal[i][1]);
                var res = t.resolve();
                var sc = this._score(t, res, legal[i]);
                var cl = before - panels(t);
                var k = cl === 0 ? '0' : (cl <= 3 ? '3' : (cl <= 6 ? '4-6' : '7+'));
                buckets[k].n++;
                buckets[k].sum += (sc - hold);
            }
            return orig.call(this);
        };
        try {
            [1, 2, 3].forEach(function (seed) {
                bench.run(shipped, seed, { brain: 'puyo', scenario: 'endless',
                                           checkTiming: false, rise: rise });
            });
        } finally { PuyoCpu.prototype._decide = orig; }
        var out = { n: buckets['7+'].n };
        ['0', '3', '4-6', '7+'].forEach(function (k) {
            out[k] = buckets[k].n ? buckets[k].sum / buckets[k].n : null;
        });
        return out;
    }

    var off = sweep(false), on = sweep(true);
    if (process.env.GC_SHOW) console.log('   off', JSON.stringify(off), '\n   on ', JSON.stringify(on));
    assert.ok(off.n > 20 && on.n > 20,
        'too few big clears sampled (' + off.n + ' / ' + on.n + ') to say anything');

    // 1. The defect is real and still reproduces with rise off. If this
    //    ever stops failing, the sweep has stopped measuring the thing.
    assert.ok(off['7+'] < off['0'] && off['4-6'] < off['3'] && off['3'] < off['0'],
        'without rise, the penalty is no longer monotonic in how much was cleared — ' +
        'either it got fixed elsewhere or this sweep broke: ' + JSON.stringify(off));

    // 2. Rise removes it, and by a lot. Not "improves it slightly": the
    //    biggest clears go from the worst bucket to the cheapest.
    assert.ok(on['7+'] > off['7+'] * 0.6,
        'rise barely moved the 7+ penalty: ' + off['7+'].toFixed(0) + ' -> ' +
        on['7+'].toFixed(0));
    assert.ok(on['7+'] > on['4-6'] && on['7+'] > on['3'],
        'with rise on, a 7+ clear is still scored worse than a smaller one (' +
        JSON.stringify(on) + '), so the ordering that makes the bot refuse to cash ' +
        'in is still there');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok  ', t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL', t.name, '\n     ', e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
if (failures.length) process.exit(1);
