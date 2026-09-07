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
    return { width: width, height: height, grid: grid, blocks: blocks };
}

// ---------------------------------------------------------------- harness

test('every declared feature has a key, a sign and a description', function () {
    assert.ok(registry.all.length > 0);
    registry.all.forEach(function (f) {
        assert.ok(f.key, 'feature missing key');
        assert.ok(f.sign === 1 || f.sign === -1, f.key + ': sign must be +1 or -1');
        assert.ok(['board', 'earned', 'clock'].indexOf(f.group) >= 0, f.key + ': bad group');
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

function death(clock) { return F.framesToDeath(inputMod.normalize({ clock: clock })); }

function sent(earned) { return F.garbageSent(inputMod.normalize({ earned: earned })); }
function chain(earned) { return F.chainLength(inputMod.normalize({ earned: earned })); }

function gOnBoard(rows) { return F.garbageOnBoard(inputMod.normalize({ board: board(rows) })); }
function gIncoming(list) { return F.incomingGarbage(inputMod.normalize({ incoming: list })); }
function gAdj(rows) { return F.garbageAdjacency(inputMod.normalize({ board: board(rows) })); }
function scarce(rows, colours) { return F.colourScarcity(inputMod.normalize({ board: board(rows), colours: colours })); }

function edge(rows) { return F.edgePenalty(inputMod.normalize({ board: board(rows) })); }
function maxH(rows, disp) { return F.maxHeight(inputMod.normalize({ board: board(rows), displacement: disp || 0 })); }
function fill(rows) { return F.fillRatio(inputMod.normalize({ board: board(rows) })); }
function rough(rows) { return F.roughness(inputMod.normalize({ board: board(rows) })); }

function variance(rows) {
    return F.colourVariance(inputMod.normalize({ board: board(rows) }));
}

function links(rows) {
    return F.links(inputMod.normalize({ board: board(rows) }));
}

function potential(rows, extra) {
    return F.matchPotential(inputMod.normalize(Object.assign({ board: board(rows) }, extra || {})));
}

test('matchPotential: fires on a swap that completes a merged 5', function () {
    // Swapping the 2 and the 1 in the bottom row puts a 1 at column 3,
    // making BOTH a row of three (cols 1-3) and a column of three
    // (rows 1-3) that share that cell — the engine unions them into one
    // 5-combo, which is exactly why an L is worth more than two 3s.
    var n = potential([
        '..1...',
        '..1...',
        '1121..'
    ]);
    assert.strictEqual(n, 1, 'expected exactly the one qualifying swap');
});

test('matchPotential: STAYS QUIET on a swap that only makes a plain 3', function () {
    // Same shape with the column removed: the only swap available now
    // completes three in a row and nothing else. Sends no garbage, spends
    // three panels. Must not count.
    assert.strictEqual(potential(['1121..']), 0);
});

test('matchPotential: a plain 3 DOES count when it touches garbage', function () {
    // Identical swap to the test above. The only difference is the garbage
    // sitting on top of it — and touching garbage is the only way garbage
    // ever clears, so the same move that was worthless is now the point.
    assert.strictEqual(potential([
        '##....',
        '1121..'
    ]), 1);
});

test('matchPotential: the near-miss inside the same board is rejected', function () {
    // The 5-combo board above also contains a swap that completes only a
    // vertical 3 (swapping the 1 and 2 the other way). If this feature
    // counted plain 3s the first test would read 2, not 1 — so that test
    // and this one together pin the rule from both sides.
    var rows = ['..1...', '..1...', '1121..'];
    assert.strictEqual(potential(rows), 1);
    // and prove that near-miss really is there to be miscounted:
    var b = board(rows);
    b.grid[1][2] = 2; b.grid[1][3] = 1;          // apply that other swap by hand
    var m = F._matchedCells(b);
    assert.strictEqual(Object.keys(m).length, 3, 'the near-miss should be a real 3-match');
});

test('matchPotential: an empty board scores zero', function () {
    assert.strictEqual(potential(['......', '......']), 0);
});

test('matchPotential: a board with no useful swap scores zero', function () {
    assert.strictEqual(potential([
        '123123',
        '231231'
    ]), 0);
});

test('matchPotential: garbage and busy cells are never swapped', function () {
    // -2 and -1 are not panels. A version that treated them as swappable
    // would invent matches out of the wall.
    assert.strictEqual(potential(['#1#1##']), 0);
    assert.strictEqual(potential(['x1x1xx']), 0);
});

test('matchPotential: swapping two of the same colour is not a move', function () {
    assert.strictEqual(potential(['111...']), 0, 'a settled board has no standing match to find');
});

test('matchPotential: LIMIT — swaps into an empty cell are not counted', function () {
    // Documented blind spot, asserted so it stays visible. Sliding the 1
    // at column 4 left into the gap would line up three, but the board
    // then falls, and gravity is not a pure function of this snapshot.
    // Guessing at it would be an invisible wrong answer; leaving it is a
    // known one.
    assert.strictEqual(potential(['11.1..']), 0);
});

test('matchPotential: LIMIT — it does not look past one swap', function () {
    // Two swaps from a match is setup, and real, and not measured here.
    assert.strictEqual(potential(['1212..']), 0);
});

test('matchPotential: the input is not mutated by scoring it', function () {
    // It swaps cells in place to test them and swaps them back. If it ever
    // failed to restore one, every later evaluation in the search would be
    // scoring a board that never existed.
    var b = board(['..1...', '..1...', '1121..']);
    var before = JSON.stringify(b.grid);
    F.matchPotential(inputMod.normalize({ board: b }));
    assert.strictEqual(JSON.stringify(b.grid), before, 'matchPotential left the board altered');
});

test('matchPotential: weighting it now works end to end through the evaluator', function () {
    var r = evaluator.evaluate({ board: board(['..1...', '..1...', '1121..']) },
                               { matchPotential: 10 });
    assert.strictEqual(r.features.matchPotential, 1);
    assert.strictEqual(r.terms.matchPotential, 10, 'sign is +1, so the term is +10');
    assert.strictEqual(r.score, 10);
});


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

test('links: two panels of one colour side by side is one link', function () {
    assert.strictEqual(links(['11....']), 1);
});

test('links: vertical counts the same as horizontal', function () {
    assert.strictEqual(links(['1.....', '1.....']), 1);
});

test('links: a run of three is two links, not three', function () {
    assert.strictEqual(links(['111...']), 2);
});

test('links: a 2x2 block of one colour is four links, not six', function () {
    // Four orthogonal pairs; the two diagonals must NOT count.
    assert.strictEqual(links(['11....', '11....']), 4);
});

test('links: STAYS QUIET on diagonals', function () {
    assert.strictEqual(links(['1.....', '.1....']), 0);
});

test('links: different colours touching are not links', function () {
    assert.strictEqual(links(['12....', '21....']), 0);
});

test('links: empty space never links to itself', function () {
    assert.strictEqual(links(['......', '......']), 0);
});

test('links: garbage never links, to itself or to a panel', function () {
    // A wall of garbage is the opposite of good clustering. If it counted,
    // taking damage would look like progress.
    assert.strictEqual(links(['##....', '##....']), 0);
    assert.strictEqual(links(['#1....']), 0);
    assert.strictEqual(links(['#.....', '1.....']), 0);
});

test('links: busy cells never link', function () {
    // -1 is a panel mid-animation. Its colour is not knowable from the
    // snapshot, so pairing it with anything would be inventing one.
    assert.strictEqual(links(['x1....']), 0);
    assert.strictEqual(links(['xx....']), 0);
});

test('links: counts every colour on the board, not just the biggest group', function () {
    assert.strictEqual(links(['11.22.']), 2);
});

test('links: weighting it works end to end through the evaluator', function () {
    var r = evaluator.evaluate({ board: board(['111...']) }, { links: 3 });
    assert.strictEqual(r.features.links, 2);
    assert.strictEqual(r.terms.links, 6, 'sign is +1');
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

// ---- fillRatio ----
// Occupied cells over total. NOT LogicalBoard.fillRatio, which is
// maxHeight/height and is therefore a second copy of maxHeight.

test('fillRatio: empty is 0 and full is 1', function () {
    assert.strictEqual(fill(['......', '......']), 0);
    assert.strictEqual(fill(['111111', '111111']), 1);
});

test('fillRatio: half the cells occupied is 0.5 wherever they are', function () {
    assert.strictEqual(fill(['......', '111111']), 0.5);
    assert.strictEqual(fill(['111...', '111...']), 0.5);
});

test('fillRatio: NOT A DUPLICATE OF maxHeight', function () {
    // Same panel count, one stacked tall and one spread flat. maxHeight
    // must separate them; fillRatio must not. If either fails, the two
    // features are measuring one thing and one should be cut — the same
    // call already made against consecutiveColours.
    var tall = ['1.....', '1.....', '1.....', '1.....'];
    var flat = ['......', '......', '......', '1111..'];
    assert.strictEqual(fill(tall), fill(flat), 'fillRatio must ignore shape');
    assert.notStrictEqual(maxH(tall), maxH(flat), 'maxHeight must not');
});

test('fillRatio: garbage occupies space', function () {
    assert.strictEqual(fill(['######']), 1);
});

test('fillRatio: a busy cell is occupied — a panel mid-animation is still there', function () {
    assert.strictEqual(fill(['xxxxxx']), 1);
});

// ---- roughness ----
// Sum of absolute height differences between adjacent columns. Not height:
// a uniformly tall board is perfectly smooth.

test('roughness: a flat board is zero at any height', function () {
    assert.strictEqual(rough(['111111']), 0);
    assert.strictEqual(rough(['111111', '111111', '111111']), 0);
});

test('roughness: STAYS QUIET on a tall flat board — it is not measuring height', function () {
    assert.strictEqual(rough(['111111', '111111']), 0);
    assert.ok(maxH(['111111', '111111']) > 0, 'and maxHeight is the one that sees it');
});

test('roughness: a single step is the size of that step', function () {
    assert.strictEqual(rough(['111...', '111111']), 1);
});

test('roughness: a staircase is the sum of its steps, INCLUDING the drop to the floor', function () {
    // Heights 3,2,1,0,0,0 — the steps are 1+1+1, not 1+1. The fall from
    // the last built column to empty ground is a step like any other, and
    // forgetting it is the easy mistake (I made it writing this test).
    assert.strictEqual(rough(['1.....', '11....', '111...']), 3);
    // and the same staircase with the empties filled to height 1 loses
    // exactly that last step:
    assert.strictEqual(rough(['1.....', '11....', '111111']), 2);
});

test('roughness: one deep well costs both its walls', function () {
    assert.strictEqual(rough(['11.111', '11.111']), 4);
});

test('roughness: the step at the RIGHT-HAND edge is counted', function () {
    // Found by mutation: a loop bound of `c < W - 1` skips the last pair
    // of columns, and every other case here happens to have two flat empty
    // columns on the right, so nothing caught it. A lone panel in the last
    // column is the shape that does.
    assert.strictEqual(rough(['.....1']), 1);
    assert.strictEqual(rough(['.....1', '.....1']), 2);
});

test('roughness: an empty board is zero', function () {
    assert.strictEqual(rough(['......']), 0);
});

test('roughness: a buried hole does not change column height', function () {
    // Column height is the topmost occupied row. A hole underneath is a
    // real problem and is NOT this feature's problem — written down so
    // nobody half-implements it here.
    assert.strictEqual(rough(['111111', '1.1111', '111111']), 0);
});


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

test('colourScarcity: two panels of a colour is scarce, three is not', function () {
    assert.strictEqual(scarce(['11....'], 1), 1);
    assert.strictEqual(scarce(['111...'], 1), 0);
});

test('colourScarcity: a colour with NO panels is not scarce', function () {
    // The near-miss, and getting it backwards makes an empty board look
    // desperate when it is simply empty. You cannot be stuck for want of a
    // colour you are not holding.
    assert.strictEqual(scarce(['......'], 5), 0);
});

test('colourScarcity: each scarce colour counts', function () {
    assert.strictEqual(scarce(['1122..'], 2), 2);
});

test('colourScarcity: a healthy board scores zero', function () {
    assert.strictEqual(scarce(['111222', '111222'], 2), 0);
});

test('colourScarcity: garbage and busy cells are not a colour supply', function () {
    // A board with two 1s and a wall of garbage is still short of 1s.
    assert.strictEqual(scarce(['11####'], 1), 1);
    assert.strictEqual(scarce(['11xxxx'], 1), 1);
    // Found by mutation: treating any non-empty cell as a colour also
    // passed both boards above, because four garbage cells is not itself
    // "scarce". A board with a healthy colour and ONE garbage cell is what
    // exposes it — the garbage registers as a colour down to its last
    // panel, and the board reads as in trouble when it is fine.
    assert.strictEqual(scarce(['111#..'], 1), 0, 'one garbage cell is not a scarce colour');
    assert.strictEqual(scarce(['111x..'], 1), 0, 'nor is one busy cell');
});


// ---- garbageSent ----
// The attack this move actually launched, in cells. Combo and chain are
// two DIFFERENT attacks: a combo sends a set of 1-high blocks of varying
// width, a chain sends one full-width block that grows a row per link.

test('garbageSent: nothing sent is zero', function () {
    assert.strictEqual(sent({ garbageSent: [] }), 0);
});

test('garbageSent: a piece is counted in cells', function () {
    assert.strictEqual(sent({ garbageSent: [[3, 1]] }), 3);
    assert.strictEqual(sent({ garbageSent: [[6, 4]] }), 24);
});

test('garbageSent: several pieces sum', function () {
    assert.strictEqual(sent({ garbageSent: [[3, 1], [4, 1]] }), 7);
});

test('garbageSent: a chain block outweighs a combo block of the same width', function () {
    // Combo -> width, chain -> height. A 4-link chain is four full-width
    // rows; the biggest combo is one row of at most width 6.
    assert.ok(sent({ garbageSent: [[6, 3]] }) > sent({ garbageSent: [[6, 1]] }));
});

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


// ---- framesToDeath ----
// toppedOut ? preStop + stop + shake + health : Infinity, and Infinity
// while riseLock holds. ONE feature, not three, because stop time, health
// and shake do not sit beside each other — they pause each other:
//   - health only decrements inside (!riseLock && stopTime === 0)
//   - game over needs health <= 0 AND shakeTime <= 0
//   - preStopTime drains before stopTime does

test('framesToDeath: a board that is not topped out cannot die', function () {
    assert.strictEqual(death({ toppedOut: false, health: 1 }), Infinity);
});

test('framesToDeath: topped out with health is that many frames', function () {
    assert.strictEqual(death({ toppedOut: true, health: 40 }), 40);
});

test('framesToDeath: stop time is added, because it pauses the drain', function () {
    assert.strictEqual(death({ toppedOut: true, health: 40, stopTime: 60 }), 100);
});

test('framesToDeath: preStop is added too — it drains BEFORE stop', function () {
    assert.strictEqual(death({ toppedOut: true, health: 40, stopTime: 60, preStopTime: 12 }), 112);
});

test('framesToDeath: shake is added — you cannot die at 0 health while shaking', function () {
    assert.strictEqual(death({ toppedOut: true, health: 0, shakeTime: 18 }), 18);
});

test('framesToDeath: riseLock alone makes it unkillable, even topped out at 1 health', function () {
    // A swap always in flight holds riseLock, so health never decrements —
    // panel-cpu.js records exactly this, and a version without it would
    // panic at a board in no danger at all.
    assert.strictEqual(death({ toppedOut: true, health: 1, riseLock: true }), Infinity);
});

test('framesToDeath: topped out with nothing left is zero, not Infinity', function () {
    assert.strictEqual(death({ toppedOut: true, health: 0 }), 0);
});


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
