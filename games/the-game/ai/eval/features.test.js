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

function consec(rows) {
    return F.consecutiveColours(inputMod.normalize({ board: board(rows) }));
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


// ---- consecutiveColours ----
// Maximal runs of one colour along a row or column, length 2 or more,
// counted once per run. In Puyo this is a separate signal from links
// because groups pop at FOUR, so runs of three sit around being counted.
// Panel Attack pops at THREE — which means a settled board can never hold
// a run longer than two, and every maximal run is a single pair. The last
// test in this block is the one that matters: it asks whether this feature
// is anything other than links on the boards we will actually score.

test('consecutiveColours: a pair is one run', function () {
    assert.strictEqual(consec(['11....']), 1);
});

test('consecutiveColours: a run of three is ONE run, where links counts two', function () {
    // The only shape where the two features differ at all.
    assert.strictEqual(consec(['111...']), 1);
    assert.strictEqual(links(['111...']), 2);
});

test('consecutiveColours: vertical runs count too', function () {
    assert.strictEqual(consec(['1.....', '1.....']), 1);
});

test('consecutiveColours: a single panel is not a run', function () {
    assert.strictEqual(consec(['1.....']), 0);
});

test('consecutiveColours: a different colour breaks the run', function () {
    assert.strictEqual(consec(['121...']), 0);
});

test('consecutiveColours: garbage breaks the run and is never part of one', function () {
    assert.strictEqual(consec(['1#1...']), 0);
    assert.strictEqual(consec(['##....']), 0);
});

test('consecutiveColours: a busy cell breaks the run', function () {
    assert.strictEqual(consec(['1x1...']), 0);
});

test('consecutiveColours: a 2x2 block is four runs, two across and two down', function () {
    assert.strictEqual(consec(['11....', '11....']), 4);
});

test('consecutiveColours: REDUNDANCY CHECK — it must differ from links somewhere', function () {
    // A feature that is arithmetically identical to another one on every
    // board we score is not a feature, it is a second weight on the first.
    // This asserts the two are distinguishable at all; the fidelity sweep
    // asks the sharper question — whether they ever differ on a SETTLED
    // board, which is the only kind the evaluator sees.
    assert.notStrictEqual(consec(['111...']), links(['111...']));
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
