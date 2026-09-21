// THE GATE FOR THIS DIRECTORY. Run: node features.test.js
//
// Two kinds of test live here, and the second is the one that matters.
//
// HARNESS TESTS cover the machinery: the input normalises, the guards
// fire, zero weights score zero. They are cheap and they stay green
// forever.
//
// FEATURE TESTS are added ONE PER FEATURE, with the feature, and each one
// has to do two things:
//   - REJECT: fire on the thing the feature exists to find.
//   - ACCEPT: stay quiet on the near-miss that looks like it.
// Only asserting the first is how a feature that fires on everything ships
// — it passes, it looks sensitive, and it is useless. Only asserting the
// second is how a feature that fires on nothing ships — it passes, it
// looks safe, and it is invisible. This repo has shipped both.
//
// Boards are written as text, one string per row, TOP ROW FIRST, so the
// test reads the way the board looks on screen:
//   '.'  empty      'x'  busy (mid-animation)      '#'  garbage
//   1-5  a colour
var assert = require('assert');
var registry = require('./registry.js');
var inputMod = require('./input.js');
require(require('path').join(__dirname, '..', '..', 'panel-engine.js'));
require(require('path').join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelCpu = globalThis.PanelCpu;
var evaluator = require('./evaluator.js');
var weights = require('./weights.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// Text rows, top first, to a LogicalBoard-encoded grid (rows 1..height,
// bottom row = 1) plus the garbage blocks. Contiguous '#' regions become
// one block each, 4-way connected — matching _connectedGarbage's rule, so
// a test cannot accidentally describe a garbage shape the engine could
// never produce.
function board(rows) {
    var height = rows.length, width = rows[0].length, grid = [], r, c;
    for (r = 0; r <= height; r++) { grid[r] = []; }
    for (r = 0; r < height; r++) {
        var line = rows[r], row = height - r; // first string is the TOP row
        assert.strictEqual(line.length, width, 'row ' + r + ' is a different width');
        for (c = 1; c <= width; c++) {
            var ch = line[c - 1];
            grid[row][c] = ch === '.' ? 0 : ch === 'x' ? -1 : ch === '#' ? -2 : Number(ch);
            assert.ok(!isNaN(grid[row][c]), 'bad cell "' + ch + '"');
        }
    }
    // flood the garbage cells into blocks
    var blocks = {}, seen = {}, next = 1;
    for (r = 1; r <= height; r++) for (c = 1; c <= width; c++) {
        if (grid[r][c] !== -2 || seen[r + ':' + c]) continue;
        var id = 'g' + (next++), cells = [], stack = [[r, c]];
        while (stack.length) {
            var n = stack.pop(), k = n[0] + ':' + n[1];
            if (seen[k] || grid[n[0]] === undefined || grid[n[0]][n[1]] !== -2) continue;
            seen[k] = true; cells.push(n);
            stack.push([n[0] + 1, n[1]], [n[0] - 1, n[1]], [n[0], n[1] + 1], [n[0], n[1] - 1]);
        }
        blocks[id] = { cells: cells };
    }
    // A REAL LogicalBoard, not a plain snapshot — the same class the cpu
    // plans against, so gravity, matching and garbage behave here exactly as
    // they do in the game. It used to return a plain object, which meant
    // every feature needing `liveBoard` silently scored 0 in these tests:
    // matchPotential's blind spot was asserted as a LIMIT for months partly
    // because the harness could not have shown otherwise.
    return new PanelCpu.LogicalBoard(width, height, 9, grid, blocks);
}

// ---------------------------------------------------------------- harness

test('every declared feature has a key, a sign and a description', function () {
    assert.ok(registry.all.length > 0);
    registry.all.forEach(function (f) {
        assert.ok(f.key, 'feature missing key');
        assert.ok(f.sign === 1 || f.sign === -1, f.key + ': sign must be +1 or -1');
        // 'move' joined board/earned/clock when travelCost arrived: it
        // measures what a candidate costs to PLAY rather than what it
        // leaves behind, which is a fourth kind of thing.
        assert.ok(['board', 'earned', 'clock', 'move'].indexOf(f.group) >= 0,
                  f.key + ': bad group "' + f.group + '"');
        assert.ok(f.what && f.what.length > 20, f.key + ': needs a real description');
    });
});

test('normalize fills every field a feature may read', function () {
    var n = inputMod.normalize({});
    ['board', 'displacement', 'chainMarks', 'earned', 'incoming', 'clock'].forEach(function (k) {
        assert.ok(k in n, 'missing ' + k);
    });
    assert.strictEqual(n.chainMarks, null, 'chainMarks defaults to null (not mid-cascade), never {}');
    assert.deepStrictEqual(n.earned.comboSizes, []);
    assert.strictEqual(n.clock.toppedOut, false);
});

test('normalize does not mutate or alias its argument', function () {
    var raw = { earned: { chainLength: 3 } };
    var n = inputMod.normalize(raw);
    n.earned.chainLength = 99;
    assert.strictEqual(raw.earned.chainLength, 3, 'normalize aliased the caller object');
});

test('the board helper reads top-row-first and blocks garbage 4-way', function () {
    var b = board([
        '..##..',
        '..##..',
        '11.222'
    ]);
    assert.strictEqual(b.width, 6);
    assert.strictEqual(b.height, 3);
    assert.strictEqual(b.grid[1][1], 1, 'bottom row is row 1');
    assert.strictEqual(b.grid[3][3], -2, 'top row is row height');
    assert.strictEqual(Object.keys(b.blocks).length, 1, 'the 2x2 is ONE block, not four cells');
    assert.strictEqual(b.blocks.g1.cells.length, 4);
});

test('zero weights score exactly zero and compute nothing', function () {
    var r = evaluator.evaluate({ board: board(['111']) }, weights.ZERO);
    assert.strictEqual(r.score, 0);
    assert.deepStrictEqual(r.features, {}, 'a zero-weight feature must not even be computed');
});

test('no weights at all is the same as zero weights', function () {
    assert.strictEqual(evaluator.evaluate({}, {}).score, 0);
    assert.strictEqual(evaluator.evaluate({}).score, 0);
});

test('a weight on an unknown key throws rather than tuning nothing', function () {
    assert.throws(function () { evaluator.evaluate({}, { roughnes: 40 }); }, /unknown feature/);
});

test('a weight on a declared-but-unimplemented feature throws', function () {
    var unbuilt = registry.all.filter(function (f) { return typeof f.fn !== 'function'; });
    if (!unbuilt.length) return; // all thirteen built — this guard has retired
    var w = {};
    w[unbuilt[0].key] = 1;
    assert.throws(function () { evaluator.evaluate({}, w); }, /declared but not implemented/);
});

test('a zero weight on an unimplemented feature is allowed', function () {
    // Otherwise weights.ZERO itself could not be passed, and every caller
    // would have to know which features happen to be built today.
    assert.doesNotThrow(function () { evaluator.evaluate({}, weights.ZERO); });
});

test('weights.ZERO covers every declared feature', function () {
    assert.deepStrictEqual(Object.keys(weights.ZERO).sort(), registry.keys.slice().sort());
});

// --------------------------------------------------------------- features
// One block per feature, added with the feature.

// ---- matchPotential ----
// Counts legal swaps that would produce a match worth making: combo size
// 4+, or any size that touches garbage. A plain 3 is not a near-miss of a
// good move, it IS the bad move — comboGarbage() sends nothing below 4 —
// so it must score zero. That ACCEPT case is the important half of these
// tests: a version of this feature that counts every 3 would still pass
// every "does it fire?" test and would be measuring the wrong thing.
var F = require('./features.js');

function latent(rows, marks) {
    return F.latentChain(inputMod.normalize({ board: board(rows), chainMarks: marks }));
}
function cleared(n) { return F.garbageCleared(inputMod.normalize({ earned: { garbageCleared: n } })); }


function chain(earned) { return F.chainLength(inputMod.normalize({ earned: earned })); }

function gOnBoard(rows) { return F.garbageOnBoard(inputMod.normalize({ board: board(rows) })); }
function gIncoming(list) { return F.incomingGarbage(inputMod.normalize({ incoming: list })); }
function gAdj(rows) { return F.garbageAdjacency(inputMod.normalize({ board: board(rows) })); }

function edge(rows) { return F.edgePenalty(inputMod.normalize({ board: board(rows) })); }
function maxH(rows, disp) { return F.maxHeight(inputMod.normalize({ board: board(rows), displacement: disp || 0 })); }
function mat(rows) { return F.material(inputMod.normalize({ board: board(rows) })); }

function variance(rows) {
    return F.colourVariance(inputMod.normalize({ board: board(rows) }));
}

function popSize(rows) {
    return F.popSize(inputMod.normalize({ board: board(rows) }));
}

function linksH(rows) {
    return F.linksH(inputMod.normalize({ board: board(rows) }));
}

function linksV(rows) {
    return F.linksV(inputMod.normalize({ board: board(rows) }));
}










// THE BLIND SPOT THAT USED TO BE ASSERTED HERE AS A LIMIT.
//
// This file carried a test named "LIMIT — swaps into an empty cell are not
// counted", justified by "gravity is not a pure function of this snapshot".
// The snapshot part was true; the conclusion was not. LogicalBoard.resolve()
// is the gravity the bot plans with, and input.js already carried a real
// board through as liveBoard. Measured on Panel Attack's 144 readable
// authored puzzle boards, the limit cost 65% of every chain-firing swap.
//
// The three tests below are what replaced it: the move is seen when it pays,
// seen when the panel has to FALL first, and still ignored when the fall only
// produces a plain 3.







// ---- popSize ----
// For every horizontal swap the cursor could make, HOW MANY PANELS WOULD POP,
// summed over the board. Three is the minimum to pop, not the prize: a match
// is the union of every run of 3 or more through the swapped cell, across its
// row AND its column, so an L or a T pops five at once — and comboSize is what
// drives comboGarbage and the combo score. A feature that only asked "is there
// a three" would price a 5 and a 3 identically.
//
// This is the Panel Attack half of meatfighter's "consecutive colours". His
// game pops four touching blobs, so touching IS one-short-of-popping and his
// links term already covers it. Ours pops three in a LINE and the cursor only
// swaps two cells sideways, so what matters is whether the third panel is one
// move from its slot, and how much comes with it — neither of which `links`
// can see.
//
// It is NOT matchPotential: that one clones the board and resolves the whole
// cascade, 8.38us of a 111us budget. This is the immediate pop only — nothing
// falls, nothing cascades, and garbage dragged in by the match is left to
// garbageAdjacency.
//
// Three engine rules it has to obey, each with a test below:
//   - garbage and mid-animation panels cannot be swapped at all (allowsSwap:
//     !dontSwap && !isGarbage, states normal/swapping/landing/falling; the
//     bot's snapshot marks anything busy as -1)
//   - a panel swapped over a hole FALLS, leaving the row before it can match
//   - a match already on the board is not potential, so runs are only counted
//     through one of the two swapped cells
//
// Note for anyone extending this: a horizontal FOUR cannot be made in one
// swap — it would need three already in a line, which would have popped. Pops
// above 3 are vertical runs (a swap can drop a panel into a column that has
// two below it and one above) and L/T unions of a row and a column.
//
// Written before the function exists.













// ---- links ----
// Same-coloured panels orthogonally adjacent, counted as PAIRS. 25% of
// meatfighter's score and the biggest single term in a bot that has no
// chain logic at all: reward clustering and the board fills with groups of
// three, which is stored chain potential.
//
// Written before the function exists. The near-misses that matter here are
// diagonals (which never link) and everything that is not a panel —
// garbage, busy cells and empty space — since a version that counted those
// would report a wall of garbage as beautifully clustered.













// ---- linksH and linksV ----
// links, split by direction. Same single scan, two counters: linksH counts
// same-coloured panels SIDE BY SIDE, linksV counts them STACKED.
//
// They are separate features because in this game the two are not the same
// move. The cursor only swaps two cells SIDEWAYS, so a horizontal pair is
// finished by walking over and bringing the third in yourself. A vertical
// pair is finished by a panel FALLING into place, which means something
// under it has to clear first — that is a cascade, not a decision. One is a
// trigger you hold, the other is fuel. A lumped links scores them the same
// and training cannot say it wants more of one.
//
// The mechanic that makes this concrete: a broken garbage row takes its
// colours from garbageRowColors, which refuses to repeat left to right. So
// a freshly converted row can NEVER contain a horizontal pair. Every bit of
// its value is vertical, and lumped links cannot express that.
//
// The last test is the one that matters: linksH + linksV must equal links on
// every board. A split that drops a pair or counts one twice would pass
// every other test here.
//
// Written before the functions exist.

test('linksH: FIRES on a pair side by side', function () {
    assert.strictEqual(linksH(['11....']), 1);
});

test('linksH: a run of three is two overlapping pairs', function () {
    assert.strictEqual(linksH(['111...']), 2);
});

test('linksH: STAYS QUIET on a stacked pair, which is linksV\'s job', function () {
    assert.strictEqual(linksH(['1.....', '1.....']), 0);
});

test('linksH: STAYS QUIET on different colours touching', function () {
    assert.strictEqual(linksH(['12....']), 0);
});

test('linksH: garbage and busy cells are not colours', function () {
    assert.strictEqual(linksH(['##....']), 0);
    assert.strictEqual(linksH(['xx....']), 0);
});

test('linksH: counts every row', function () {
    assert.strictEqual(linksH(['11....', '22....']), 2);
});

test('linksV: FIRES on a stacked pair', function () {
    assert.strictEqual(linksV(['1.....', '1.....']), 1);
});

test('linksV: a column of three is two overlapping pairs', function () {
    assert.strictEqual(linksV(['1.....', '1.....', '1.....']), 2);
});

test('linksV: STAYS QUIET on a pair side by side, which is linksH\'s job', function () {
    assert.strictEqual(linksV(['11....']), 0);
});

test('linksV: STAYS QUIET on diagonals', function () {
    assert.strictEqual(linksV(['1.....', '.1....']), 0);
});

test('linksV: garbage and busy cells are not colours', function () {
    assert.strictEqual(linksV(['#.....', '#.....']), 0);
    assert.strictEqual(linksV(['x.....', 'x.....']), 0);
});

test('linksV: counts every column', function () {
    assert.strictEqual(linksV(['12....', '12....']), 2);
});




// ---- colourVariance ----
// Per colour, the mean position of its panels, then the mean distance of
// those panels from it, summed over colours. Low = each colour is gathered
// somewhere rather than sprinkled everywhere. Sign is negative, so the
// feature returns SCATTER and the evaluator subtracts it.
//
// The trap this must avoid: a measure dominated by where the clump sits
// rather than how tight it is. Same shape in the corner and in the middle
// must score the same, or the feature is really "distance from the board
// centre" wearing a disguise.

test('colourVariance: a tight clump is the LOWEST-scoring arrangement of its panels', function () {
    // Not zero — a 2x2 block genuinely has mean deviation, since every
    // cell sits half a square from the centre. Zero is only true of a
    // single panel. What matters is that no other arrangement of four
    // panels beats the block, so this asserts the ordering rather than a
    // number the formula happens to produce.
    var block = variance(['11....', '11....']);
    assert.ok(block > 0, 'a 2x2 block has real deviation: ' + block);
    [['1.1...', '1.1...'],
     ['11..11'],
     ['1....1', '1....1'],
     ['1.....', '.1....', '..1...', '...1..']].forEach(function (rows) {
        assert.ok(variance(rows) > block,
            JSON.stringify(rows) + ' scored ' + variance(rows) + ', not worse than the block ' + block);
    });
});

test('colourVariance: the same panels spread out score more than gathered', function () {
    var gathered = variance(['11....', '11....', '......']);
    var spread   = variance(['1....1', '......', '1....1']);
    assert.ok(spread > gathered, 'spread ' + spread + ' should exceed gathered ' + gathered);
});

test('colourVariance: POSITION-INVARIANT — the same clump anywhere scores the same', function () {
    // The near-miss. A version that measured distance from the board
    // centre, or forgot to subtract the mean, would fail this and pass
    // every other test in this block.
    assert.strictEqual(variance(['11....', '11....', '......']),
                       variance(['......', '....11', '....11']));
});

test('colourVariance: a single panel of a colour has no scatter', function () {
    assert.strictEqual(variance(['1.....']), 0);
});

test('colourVariance: a colour absent from the board contributes nothing', function () {
    // Adding a colour that is not on the board must change nothing, and
    // must not divide by zero. Asserted as an equality between two boards
    // rather than against a constant.
    var one = variance(['11....']);
    assert.ok(isFinite(one) && one > 0, 'got ' + one);
    assert.strictEqual(variance(['11....', '......']), one,
        'an empty row introduced no colour and must not change the score');
});

test('colourVariance: an empty board is zero, not NaN', function () {
    var v = variance(['......', '......']);
    assert.strictEqual(v, 0);
});

test('colourVariance: colours are measured separately, then summed', function () {
    // Two colours each in their own tight clump at opposite ends is TIDY —
    // it is the structure that makes chains — so it must score exactly
    // twice one clump, not as one enormous scattered blob. A version that
    // pooled every colour into a single mean fails this badly, and passes
    // every other test in this block.
    var one = variance(['11....', '11....']);
    var two = variance(['11..22', '11..22']);
    assert.strictEqual(two, one * 2);
    var pooled = variance(['11..11', '11..11']);   // same shape, ONE colour
    assert.ok(pooled > two, 'one colour split across the board (' + pooled +
        ') must score worse than two colours each gathered (' + two + ')');
});

test('colourVariance: garbage and busy cells are not a colour', function () {
    assert.strictEqual(variance(['#....#', '#....#']), 0);
    assert.strictEqual(variance(['x....x']), 0);
});

test('colourVariance: measures SCATTER, not how much of a colour there is', function () {
    // Found by mutation: dropping the per-colour division by n makes the
    // term grow with panel COUNT, so a large tidy block outscores two
    // panels flung to opposite corners — exactly backwards. Eight panels
    // in a 2x4 block are gathered; two panels at opposite corners are not.
    var bigTidy   = variance(['1111..', '1111..', '......', '......']);
    var tinyScattered = variance(['1.....', '......', '......', '.....1']);
    assert.ok(tinyScattered > bigTidy,
        'two scattered panels (' + tinyScattered + ') must score worse than ' +
        'eight gathered ones (' + bigTidy + ')');
});

test('colourVariance: weighting it works end to end through the evaluator', function () {
    var r = evaluator.evaluate({ board: board(['1....1']) }, { colourVariance: 2 });
    assert.ok(r.features.colourVariance > 0);
    assert.ok(r.terms.colourVariance < 0, 'sign is -1, so scatter must subtract');
});


// ---- edgePenalty ----
// Panels in the side columns, which have three orthogonal neighbours
// instead of four and so link less. A count of edge panels — the simplest
// thing matching the reference.

test('edgePenalty: a panel in column 1 counts', function () {
    assert.strictEqual(edge(['1.....']), 1);
});

test('edgePenalty: a panel in the last column counts', function () {
    assert.strictEqual(edge(['.....1']), 1);
});

test('edgePenalty: both edges of the same row count separately', function () {
    assert.strictEqual(edge(['1....1']), 2);
});

test('edgePenalty: STAYS QUIET on every interior column', function () {
    assert.strictEqual(edge(['.1111.']), 0);
});

test('edgePenalty: garbage on an edge is not a panel we are trying to link', function () {
    assert.strictEqual(edge(['#....#']), 0);
});

test('edgePenalty: busy and empty edge cells score nothing', function () {
    assert.strictEqual(edge(['x....x']), 0);
    assert.strictEqual(edge(['......']), 0);
});

test('edgePenalty: it is a count, so a taller edge column scores more', function () {
    assert.strictEqual(edge(['1.....', '1.....', '1.....']), 3);
});

// ---- maxHeight ----
// Highest occupied row, plus displacement. Displacement is 0..15 sub-row
// pixels of rise, so a board one pixel from gaining a row is not the same
// board as one that just gained it.

test('maxHeight: an empty board is zero', function () {
    assert.strictEqual(maxH(['......', '......']), 0);
});

test('maxHeight: one panel on the floor is one', function () {
    assert.strictEqual(maxH(['......', '1.....']), 1);
});

test('maxHeight: it is the TALLEST column, not the average', function () {
    assert.strictEqual(maxH(['1.....', '1.....', '111...']), 3);
});

test('maxHeight: garbage is in the way just as much as a panel', function () {
    assert.strictEqual(maxH(['#.....', '......', '......']), 3);
});

test('maxHeight: a buried gap does not reduce it — the top is what matters', function () {
    // The ACCEPT case for anyone tempted to make this count occupancy.
    assert.strictEqual(maxH(['1.....', '......', '1.....']), 3);
});

test('maxHeight: displacement makes a rising board score above a still one', function () {
    // The part that gets skipped. Same grid, different rise.
    assert.ok(maxH(['1.....'], 15) > maxH(['1.....'], 0));
    assert.ok(maxH(['1.....'], 15) < maxH(['1.....'], 0) + 1,
        'a whole row of displacement would double-count the row it is about to become');
});

// ---- material ----
// Colour panels over total cells: the stock a move leaves to build with.
// NOT occupancy -- garbage and the dimmed incoming row take up space without
// being usable, and counting them is what made one term answer both "have I
// got stock" and "am I near the ceiling" with a single weight.

test('material: empty is 0 and a full board of colour is 1', function () {
    assert.strictEqual(mat(['......', '......']), 0);
    assert.strictEqual(mat(['111111', '111111']), 1);
});

test('material: half the cells is 0.5 wherever they are', function () {
    assert.strictEqual(mat(['......', '111111']), 0.5);
    assert.strictEqual(mat(['111...', '111...']), 0.5);
});

test('material: NOT A DUPLICATE OF maxHeight', function () {
    // Same panel count, one stacked tall and one spread flat. maxHeight must
    // separate them; material must not. If either fails the two are measuring
    // one thing and one should be cut.
    var tall = ['1.....', '1.....', '1.....', '1.....'];
    var flat = ['......', '......', '......', '1111..'];
    assert.strictEqual(mat(tall), mat(flat), 'material must ignore shape');
    assert.notStrictEqual(maxH(tall), maxH(flat), 'maxHeight must not');
});

test('material: garbage is not material', function () {
    // The case the split exists for. Both boards are full to the same
    // height, so maxHeight cannot tell them apart -- one is all stock and
    // the other is all slab, and nothing in a colour-blind occupancy count
    // can say so.
    assert.strictEqual(mat(['######']), 0);
    assert.strictEqual(mat(['111111']), 1);
    assert.strictEqual(maxH(['######']), maxH(['111111']));
});

test('material: the dimmed incoming row is not stock until it rises', function () {
    assert.strictEqual(mat(['xxxxxx']), 0);
});

test('material: a mixed board counts only the colour', function () {
    assert.strictEqual(mat(['###...', '111...']), 3 / 12);
});

// ---- roughness ----
// Sum of absolute height differences between adjacent columns. Not height:
// a uniformly tall board is perfectly smooth.










// ---- garbageOnBoard ----
// Garbage CELLS, not blocks. A 6x2 slab is twelve cells of wall, and
// counting it as one would make a full-board block look like a pebble.

test('garbageOnBoard: an empty board has none', function () {
    assert.strictEqual(gOnBoard(['......', '111111']), 0);
});

test('garbageOnBoard: counts cells, not blocks', function () {
    assert.strictEqual(gOnBoard(['####..', '####..']), 8);
});

test('garbageOnBoard: two separate blocks both count', function () {
    assert.strictEqual(gOnBoard(['#....#']), 2);
});

test('garbageOnBoard: real panels and busy cells are not garbage', function () {
    assert.strictEqual(gOnBoard(['111111', 'xxxxxx']), 0);
});

// THE DESCRIPTION SAID "on-screen weighted above off-screen" FOR A LONG TIME
// AND THE CODE NEVER DID THAT. Pinned here so the claim cannot come back
// without a test failing: a cell at the ceiling is worth exactly what a cell
// on the floor is worth. If a row weighting is ever genuinely wanted, this is
// the test that has to change first, deliberately.
test('garbageOnBoard: a cell high up counts the SAME as a cell on the floor', function () {
    assert.strictEqual(gOnBoard(['#.....', '......', '......']),
                       gOnBoard(['......', '......', '#.....']),
                       'garbage is weighted by row somewhere — the flat count is no longer flat');
});

// And the reason the old claim was not merely unimplemented but
// UNIMPLEMENTABLE here: the board this feature reads is the visible one.
// panel-engine.js allocates MAX_ROWS = 24 and lands garbage above the visible
// board, but panel-cpu.js builds the LogicalBoard with stack.height = 12, so
// off-screen garbage never reaches any feature at all.
test('garbageOnBoard: the board it reads is the VISIBLE board, 12 rows', function () {
    var PanelEngine = globalThis.PanelEngine;
    assert.ok(PanelEngine, 'this test needs the engine loaded');
    assert.strictEqual(PanelEngine.HEIGHT, 12,
        'the visible height changed; the note on garbageOnBoard needs rechecking');
    // MAX_ROWS (24) is module-internal and deliberately not asserted here —
    // a test cannot read it, and asserting on a number it cannot see would be
    // a test of this file's memory rather than of the engine.
});

// ---- incomingGarbage ----
// Attacks that have arrived and are queued but have NOT landed. The grid
// cannot show these, which is the whole point: panel-cpu.js records that a
// burst arriving back-to-back is the mechanism behind its worst deaths,
// because danger only trips once each piece has physically landed.

test('incomingGarbage: an empty queue is zero', function () {
    assert.strictEqual(gIncoming([]), 0);
});

test('incomingGarbage: one piece is its cell count', function () {
    assert.strictEqual(gIncoming([{ width: 6, height: 2 }]), 12);
});

test('incomingGarbage: several queued pieces sum', function () {
    assert.strictEqual(gIncoming([{ width: 6, height: 1 }, { width: 3, height: 1 }]), 9);
});

test('incomingGarbage: it is cells, so a tall block outweighs a wide one', function () {
    assert.ok(gIncoming([{ width: 6, height: 12 }]) > gIncoming([{ width: 6, height: 1 }]));
});

// ---- garbageAdjacency ----
// Matchable panels orthogonally touching garbage. Garbage has no colour,
// so this is the ONLY way it ever clears.

test('garbageAdjacency: a panel beside garbage counts', function () {
    assert.strictEqual(gAdj(['#1....']), 1);
});

// NO ELIGIBILITY TEST, despite what the description used to claim. The grid
// marks every isGarbage panel -2 whatever its state, so this counts a
// neighbour of any garbage cell. Pinned because "eligible" is exactly the
// kind of word that reads as though a check exists.
test('garbageAdjacency: counts a neighbour of ANY garbage cell, eligible or not', function () {
    // The feature only ever sees -2. There is no state to be ineligible in,
    // which is precisely why the word was misleading.
    assert.strictEqual(gAdj(['1#....']), 1);
    assert.strictEqual(gAdj(['1#1...']), 2,
        'both panels touching the same garbage cell must count');
    assert.strictEqual(gAdj(['1....1']), 0, 'no garbage, nothing to touch');
});

test('garbageAdjacency: STAYS QUIET on a diagonal', function () {
    assert.strictEqual(gAdj(['#.....', '.1....']), 0);
});

test('garbageAdjacency: STAYS QUIET on ALL FOUR diagonals', function () {
    // Found by mutation: testing one diagonal proves nothing about the
    // other three, and a version that reached up-right passed the
    // single-diagonal case cleanly.
    assert.strictEqual(gAdj(['#.....', '.1....']), 0, 'up-left');
    assert.strictEqual(gAdj(['.#....', '1.....']), 0, 'up-right');
    assert.strictEqual(gAdj(['.1....', '#.....']), 0, 'down-left');
    assert.strictEqual(gAdj(['1.....', '.#....']), 0, 'down-right');
});

test('garbageAdjacency: a panel touching two garbage cells counts once', function () {
    // It is one panel, and one match through it clears what it touches.
    // Counting per-contact would make a panel in a garbage pocket look
    // like several opportunities.
    assert.strictEqual(gAdj(['.#....', '#1....']), 1);
    // Found by mutation: the board above has garbage to the LEFT and ABOVE,
    // and a version that double-counted a second contact BELOW still
    // scored it 1. This one wedges the panel with garbage left and below.
    assert.strictEqual(gAdj(['#1....', '##....']), 1);
});

test('garbageAdjacency: garbage touching garbage is not an opportunity', function () {
    assert.strictEqual(gAdj(['##....', '##....']), 0);
});

test('garbageAdjacency: a busy cell cannot be matched, so it is not adjacency', function () {
    assert.strictEqual(gAdj(['#x....']), 0);
});

test('garbageAdjacency: NOT A DUPLICATE OF garbageOnBoard', function () {
    // Same garbage, once buried among panels and once alone on the board.
    // If these score the same, this feature is just counting garbage again.
    var surrounded = ['1111..', '1##1..', '1111..'];
    var alone      = ['......', '.##...', '......'];
    assert.strictEqual(gOnBoard(surrounded), gOnBoard(alone));
    assert.ok(gAdj(surrounded) > gAdj(alone));
});

// ---- colourScarcity ----
// Colours with fewer than 3 matchable panels left — a colour that can no
// longer form a match at all. This is the "stuck" death panel-cpu.js
// describes: once no legal swap can match anything, the AI wiggles until
// the anti-stall punishment kills it.







// ---- garbageSent ----
// The attack this move actually launched, in cells. Combo and chain are
// two DIFFERENT attacks: a combo sends a set of 1-high blocks of varying
// width, a chain sends one full-width block that grows a row per link.





// ---- chainLength ----
// The chain counter after the move. The off-by-one is the whole feature:
// the match that STARTS a chain is not a link, and the first link makes it
// x2 (Stack.incrementChainCounter), so there is no such thing as a chain
// of 1.

test('chainLength: a match that starts a chain is not a link', function () {
    assert.strictEqual(chain({ chainLength: 0 }), 0);
});

test('chainLength: the first link is x2, never x1', function () {
    assert.strictEqual(chain({ chainLength: 2 }), 2);
});

test('chainLength: longer chains score higher', function () {
    assert.ok(chain({ chainLength: 5 }) > chain({ chainLength: 2 }));
});


// The framesToDeath weighting test that lived here is gone with the
// feature. What it guarded — one term swallowing all the others — is now
// guarded generally rather than for one feature: puyocpu.test.js's "no
// feature is silently dead" measures every feature's spread within a
// decision, which catches both a term that dominates and a term that never
// varies. framesToDeath failed the second of those: 0 of 179 decisions.
test('no single feature can swamp the rest at equal weight', function () {
    // The general form of the Infinity bug. Every feature at weight 1, on
    // two boards that differ in every way; no single term may account for
    // more than most of the gap, or that term IS the evaluator.
    var w = {};
    registry.keys.forEach(function (k) { w[k] = 1; });
    var a = evaluator.evaluate({ board: board(['......', '......', '1.....']),
                                 clock: { toppedOut: false } }, w);
    var b = evaluator.evaluate({ board: board(['111111', '111111', '111111']),
                                 clock: { toppedOut: false } }, w);
    assert.ok(isFinite(a.score) && isFinite(b.score), 'scores must be finite');
    // Against the TOTAL absolute movement, not the net gap. Terms have
    // opposite signs and cancel, so a single term's change can legitimately
    // exceed the net difference — measured at 143% for links, which is why
    // the first version of this test was wrong rather than the code.
    assert.notStrictEqual(a.score, b.score, 'two very different boards scored identically');
    var moves = registry.keys.map(function (k) {
        return { key: k, d: Math.abs((a.terms[k] || 0) - (b.terms[k] || 0)) };
    });
    var total = moves.reduce(function (s, m) { return s + m.d; }, 0);
    assert.ok(total > 0, 'no term moved at all between two different boards');
    moves.forEach(function (m) {
        assert.ok(m.d <= total * 0.75,
            m.key + ' is ' + (100 * m.d / total).toFixed(0) + '% of all the movement ' +
            'between two boards at equal weight. A feature that large is not ' +
            'contributing to the score, it is the score — which is what framesToDeath ' +
            '(mean 586 against everything else under 22) and travelCost in frames ' +
            '(spread 21 against a next-biggest of 2.8) both were.');
    });
});



// ---- stopTimeGain ----
// STOP TIME IS THE ONLY CLOCK THAT KEEPS YOU ALIVE AT LEVEL 10, AND IT IS
// WORTH NOTHING WHEN YOU CANNOT DIE.
//
// advancePassiveRaise drains health only inside (!riseLock && stopTime === 0),
// so stop time does not sit beside health as a second reserve — it FREEZES
// the health drain. At level 10 maxHealth is 1, so there is no health to
// keep up; the reserve IS stop time.
//
// Two things the existing stopTimeEarned cannot say, and both of them decide
// whether a move is worth making:
//   - awardStopTime ends `if (stopTime > this.stopTime) this.stopTime = stopTime`
//     — a MAX against stopTime, not a +=. Earning 90 frames while 120 are on
//     the clock buys NOTHING, and stopTimeEarned reports 90.
//   - a weighted sum cannot multiply "how much stop time" by "how close to
//     death", so the conjunction goes INSIDE the feature, the way flatTop
//     holds flat-AND-high. Flat, stopTimeEarned pays the same on a board at
//     row 3 as on one topped out, and the search correctly averages that to
//     nothing.

var SAFE_ROWS = ['......', '......', '......', '......', '1.....'];
var TOPPED    = ['1.....', '111111', '111111', '111111', '111111'];
var ONE_BELOW = ['......', '111111', '111111', '111111', '111111'];












// ---- latentChain ----
// WILL THIS LANDING CONTINUE THE CHAIN. Counts cells that carry the chain
// flag AND sit inside a match on the settled board. The forward-looking
// half of chainLength.
//
// The distinction that makes it possible at all: a panel gets `chaining`
// by falling because of an earlier clear. A match made of freshly-fallen
// but NOT chain-flagged panels is a new combo, not a link — and a hovering
// panel can never START a chain (Panel.matchAnyway). Nothing counting
// cells can tell those apart without the flags.

test('latentChain: not mid-cascade at all is zero', function () {
    // chainMarks null means "no cascade in flight", which is different
    // from {} — see input.js. Both are zero here, but for different
    // reasons, and conflating them is how the feature would start
    // reporting on boards it knows nothing about.
    assert.strictEqual(latent(['111...'], null), 0);
});

test('latentChain: mid-cascade with nothing landing chaining is zero', function () {
    assert.strictEqual(latent(['111...'], {}), 0);
});

test('latentChain: a chain-flagged cell inside a match fires', function () {
    // Row 1 is a match of three; the middle cell is flagged as having
    // fallen from an earlier clear, so this match IS the next link.
    assert.strictEqual(latent(['111...'], { '1:2': true }), 1);
});

test('latentChain: STAYS QUIET when the flagged cell is not in a match', function () {
    // The near-miss, and the one that matters. A panel falling from an
    // earlier clear is only a chain link if it lands INTO a match; landing
    // beside one it does not complete is nothing.
    assert.strictEqual(latent(['112...'], { '1:1': true }), 0);
});

test('latentChain: a match with no flagged cell is a new combo, not a link', function () {
    // Freshly fallen but not chaining. This is exactly the case a cell
    // count cannot distinguish, and getting it wrong inflates every
    // ordinary match into a chain.
    assert.strictEqual(latent(['111...'], { '3:6': true }), 0);
});

test('latentChain: counts the flagged cells in the match, not the match size', function () {
    assert.strictEqual(latent(['111...'], { '1:1': true, '1:3': true }), 2);
});

test('latentChain: garbage carries no chain flag of its own', function () {
    assert.strictEqual(latent(['#11...'], { '1:1': true }), 0);
});

// ---- garbageCleared ----
// Garbage cells this move converted, propagation included.

test('garbageCleared: clearing nothing is zero', function () {
    assert.strictEqual(cleared(0), 0);
});

test('garbageCleared: it is cells, so a whole slab outweighs one cell', function () {
    assert.ok(cleared(12) > cleared(1));
});


// ---- travelCost ----
// What THIS candidate costs to reach from where the cursor is, in frames.
// The bot has always been able to teleport (stack.touchSwap), so it has
// never paid for distance; a person holds a direction and waits, and the
// second step in a direction costs 21 frames. Measured in travel.js and
// pinned to the engine in travel.test.js.
//
// The value is set by whichever seam knows the move. A seam that cannot see
// the move passes nothing, and this reads 0 — no cost invented where none
// is known.

test('travelCost: converts the seam\'s frames into STEPS', function () {
    // The seam measures FRAMES, because that is what a walk costs. The
    // feature reports STEPS, because that is the scale every other feature
    // lives on — each of the others is a count of something on the board and
    // spreads under about 3 across the candidates of a decision, while this
    // one spread 21.12 in frames, seven times the next biggest. At any
    // weight that mattered it stopped contributing to a decision and became
    // it: the GA pinned it at exactly 0, and a champion trained while the
    // feature was accidentally dead collapsed from 1123 frames to 429 the
    // moment it went live at weight 173.
    //
    // travel.js prices a walk at MOVE_FRAMES * (steps - 1) + 1, so at
    // cadence 4, 21 frames is 6 steps. Nothing is lost — the cost is
    // monotonic in steps — and the cadence stays in the simulation that
    // charges for it instead of being counted twice.
    assert.strictEqual(F.travelCost(inputMod.normalize({ travelFrames: 21 })), 6);
    assert.strictEqual(F.travelCost(inputMod.normalize({ travelFrames: 1 })), 1);
    assert.strictEqual(F.travelCost(inputMod.normalize({ travelFrames: 13 })), 4);
});

test('travelCost: an unknown move costs nothing, rather than something invented', function () {
    assert.strictEqual(F.travelCost(inputMod.normalize({})), 0);
});

test('travelCost: it is a MAGNITUDE — the registry carries the sign', function () {
    // Every feature here returns "how much of this thing is there", never
    // "how good is this", so a bigger number means further away and the
    // registry's -1 makes that worse.
    assert.ok(F.travelCost(inputMod.normalize({ travelFrames: 42 })) >
              F.travelCost(inputMod.normalize({ travelFrames: 1 })));
    assert.strictEqual(registry.byKey.travelCost.sign, -1);
});

test('travelCost: weighting it subtracts through the evaluator', function () {
    var norm = registry.byKey.travelCost.norm;
    var r = evaluator.evaluate({ travelFrames: 21 }, { travelCost: 2 });
    assert.strictEqual(r.features.travelCost, 6 / norm, '21 frames at cadence 4 is 6 steps, as a share');
    assert.strictEqual(r.terms.travelCost, -12 / norm, 'sign -1 times weight 2 times the share');
});


// ---- staircase ----
// The longest DIAGONAL RUN of loaded steps — how deep the staircase built on
// this board goes. A loaded step is a panel that would complete a horizontal
// three if the cell under it cleared and it fell one row. See features.js for
// where the shape comes from, why depth rather than count, and why the first
// version of this feature was rejected by the search at 13/300.









// ---- flatTop ----
// Columns level with the tallest, scaled by how high the tallest is. The
// documented way to die, and an interaction a weighted sum cannot express
// out of roughness and maxHeight separately.





// ------------------------------------------------------------------ runner
tests.forEach(function (t) {
    try { t.fn(); process.stdout.write('  ok   ' + t.name + '\n'); }
    catch (e) { failures.push(t.name + '\n       ' + e.message); process.stdout.write('  FAIL ' + t.name + '\n'); }
});
if (failures.length) {
    process.stdout.write('\n' + failures.length + ' failed:\n\n' + failures.join('\n\n') + '\n');
    process.exit(1);
}
process.stdout.write('\n' + tests.length + ' passed. ' +
    registry.implemented().length + '/' + registry.all.length + ' features implemented.\n');
