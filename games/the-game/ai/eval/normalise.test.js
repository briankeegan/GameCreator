// EVERY FEATURE IS A SHARE, NOT A COUNT. Run: node normalise.test.js
//
// The reference scores seven metrics "normalized to a number in between 0 and
// 1 in attempt to make them comparable", and its weights sum to 1 — so a
// weight IS that feature's share of the decision, links settles at 0.25
// because a quarter of the decision is links.
//
// Ours were raw counts on different scales: linksH runs to 5 in live play,
// garbageOnBoard to 54, stopTimeEarned to 60. A weighted sum over those is
// badly conditioned — the search has to discover each feature's SCALE as well
// as its direction, and the +-5% jog that the Puyo loop applies to every
// weight moves a small-range feature far more coarsely than a large-range
// one. Dividing by a per-feature bound fixes both.
//
// WHERE THE DIVISORS COME FROM. Analytic wherever the board gives one
// (garbageOnBoard is 72 because a 6x12 board has 72 cells; stopTimeEarned is
// 100 because level 10's awardStopTime peaks at 98). Calibrated against live
// play otherwise, from feature_liveness over endless and factory, with the
// observed maximum recorded beside the number in registry.js.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var registry = require('./registry.js');
var evaluator = require('./evaluator.js');
var inputMod = require('./input.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var W = 6, H = 12;
var PANEL_GAME = process.env.GC_PANEL_GAME || '/home/user/panel-game';
var PUZZLES = path.join(PANEL_GAME, 'client/assets/default_data/puzzles/Puzzles.json');

function realBoards() {
    var j = JSON.parse(fs.readFileSync(PUZZLES, 'utf8')), out = [];
    (function walk(node) {
        (node['Puzzle Sets'] || []).forEach(walk);
        (node['Puzzles'] || []).forEach(function (p) { out.push(p); });
    })(j);
    var boards = [];
    out.forEach(function (p) {
        var s = String(p.Stack).replace(/\s+/g, '');
        if (/[^0-9]/.test(s)) return;
        while (s.length % W) s = '0' + s;
        var rows = [];
        for (var i = 0; i < s.length; i += W) rows.push(s.slice(i, i + W));
        var grid = [];
        for (var r = 0; r <= H; r++) { grid[r] = []; for (var c = 1; c <= W; c++) grid[r][c] = 0; }
        for (var k = 0; k < rows.length; k++) {
            var row = rows.length - k; if (row > H) continue;
            for (var c2 = 1; c2 <= W; c2++) {
                var d = Number(rows[k][c2 - 1]);
                grid[row][c2] = (d === 8 || d === 9) ? -2 : d;
            }
        }
        boards.push(new LogicalBoard(W, H, 9, grid, {}));
    });
    return boards;
}

test('EVERY registered feature carries a positive divisor', function () {
    // A feature added without one would silently go back to being a raw count
    // and quietly dominate or vanish, depending on its scale.
    registry.all.forEach(function (f) {
        assert.strictEqual(typeof f.norm, 'number', f.key + ' has no norm');
        assert.ok(f.norm > 0, f.key + ' has a non-positive norm: ' + f.norm);
    });
});

test('the evaluator divides by the divisor — a feature reports its SHARE', function () {
    var f = registry.byKey.garbageOnBoard;
    assert.strictEqual(f.norm, 72, 'this test is pinned to the 72-cell bound');
    // A board of nothing but garbage is the whole bound: share 1.
    var grid = [];
    for (var r = 0; r <= H; r++) { grid[r] = []; for (var c = 1; c <= W; c++) grid[r][c] = r >= 1 ? -2 : 0; }
    var board = new LogicalBoard(W, H, 9, grid, {});
    var out = evaluator.evaluate({ board: board }, { garbageOnBoard: 1 });
    assert.strictEqual(out.features.garbageOnBoard, 1,
        'a fully garbage board should report a share of 1, got ' + out.features.garbageOnBoard);
});

test('NO feature exceeds its share of 1 on the real boards', function () {
    // The bound being wrong is the failure this exists for: a feature that
    // routinely clamps has lost its top end, and one whose divisor is far too
    // large is squeezed into a sliver of the range and cannot steer.
    var boards = realBoards();
    assert.ok(boards.length > 100, 'expected the real puzzle set, got ' + boards.length);
    var weights = {};
    registry.keys.forEach(function (k) { weights[k] = 1; });
    var worst = {};
    boards.forEach(function (b) {
        var out = evaluator.evaluate({ board: b, liveBoard: b }, weights);
        for (var k in out.features) {
            var v = out.features[k];
            if (!(k in worst) || v > worst[k]) worst[k] = v;
        }
    });
    var over = Object.keys(worst).filter(function (k) { return worst[k] > 1; });
    assert.deepStrictEqual(over, [],
        'these exceeded their bound: ' +
        over.map(function (k) { return k + ' ' + worst[k].toFixed(2); }).join(', '));
});

test('a divisor is not so large that the feature is squashed to nothing', function () {
    // The opposite failure, and the quiet one. A board feature that never gets
    // above a few percent of its bound on any real board has been scaled into
    // irrelevance, and no weight can rescue it: the jog moves it in the same
    // proportion.
    var boards = realBoards();
    var weights = {};
    registry.keys.forEach(function (k) { weights[k] = 1; });
    var best = {};
    boards.forEach(function (b) {
        var out = evaluator.evaluate({ board: b, liveBoard: b }, weights);
        for (var k in out.features) if (!(k in best) || out.features[k] > best[k]) best[k] = out.features[k];
    });
    // Only board features — the earned group is 0 on a static board by
    // construction, since nothing was played.
    // A feature that is zero on EVERY real board is a liveness question, not
    // a scale one, and feature_liveness.js answers that against a real game.
    // This one is only about a divisor so large it squashes a feature that
    // does move.
    var squashed = registry.all.filter(function (f) {
        var b = best[f.key] || 0;
        return f.group === 'board' && b > 0 && b < 0.05;
    }).map(function (f) { return f.key + ' ' + ((best[f.key] || 0)).toFixed(3); });
    assert.deepStrictEqual(squashed, [],
        'these board features never reach 5% of their divisor on any real board: ' + squashed.join(', '));
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
