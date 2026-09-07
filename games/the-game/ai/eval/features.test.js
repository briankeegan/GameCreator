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
// One block per feature, added with the feature. Nothing here yet — see
// registry.js for the thirteen declared and the order they get built in.

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
