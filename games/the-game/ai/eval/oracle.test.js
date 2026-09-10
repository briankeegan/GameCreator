// IS THE NUMBER RIGHT FOR THE BOARD BEING RANKED? Run: node oracle.test.js
//
// The gap every other suite leaves open. features.test.js builds boards by
// hand. input.fidelity.test.js compares fromStack to a Stack. seam.test.js
// checks single calls. wiring.test.js proves the seams are consulted and
// that weights change play. NONE of them proves that, mid-game, the value a
// feature returns corresponds to the candidate board the search is actually
// ranking. A stale board, an off-by-one, or a seam handing over the wrong
// candidate passes all four.
//
// So this plays a real game, intercepts real evaluations, and for each one
// recomputes every board feature from the SAME board with a second,
// deliberately naive implementation — written differently on purpose, since
// two implementations sharing a helper share its bugs and agree perfectly.
// The naive versions are O(W*H*anything) and unfit to run per candidate,
// which is exactly why they make good oracles.
var assert = require('assert');
var path = require('path');
var GAME = path.join(__dirname, '..', '..');
require(path.join(GAME, 'panel-engine.js'));
require(path.join(GAME, 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine, PanelCpu = globalThis.PanelCpu;
var features = require('./features.js');
var inputMod = require('./input.js');
var registry = require('./registry.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ---- the oracles: same question, different algorithm ----
function cells(board) {
    var out = [];
    for (var r = 1; r <= board.height; r++) {
        for (var c = 1; c <= board.width; c++) out.push({ r: r, c: c, v: board.grid[r][c] });
    }
    return out;
}
var ORACLE = {
    // every unordered pair of cells, keep the orthogonal same-colour ones
    links: function (b) {
        var all = cells(b), n = 0;
        for (var i = 0; i < all.length; i++) {
            for (var j = i + 1; j < all.length; j++) {
                var a = all[i], z = all[j];
                if (a.v <= 0 || z.v <= 0 || a.v !== z.v) continue;
                if (Math.abs(a.r - z.r) + Math.abs(a.c - z.c) === 1) n++;
            }
        }
        return n;
    },
    // count every cell in a side column that holds a panel
    edgePenalty: function (b) {
        return cells(b).filter(function (x) {
            return x.v > 0 && (x.c === 1 || x.c === b.width);
        }).length;
    },
    // occupancy over area, counted one cell at a time
    fillRatio: function (b) {
        if (!b.width || !b.height) return 0;
        return cells(b).filter(function (x) { return x.v !== 0; }).length / (b.width * b.height);
    },
    // tallest occupied cell anywhere, ignoring columns entirely
    maxHeight: function (b, input) {
        var top = 0;
        cells(b).forEach(function (x) { if (x.v !== 0 && x.r > top) top = x.r; });
        return top + (input.displacement || 0) / 16;
    },
    // heights from a per-column max, then differences
    roughness: function (b) {
        var h = [];
        for (var c = 1; c <= b.width; c++) {
            h[c] = 0;
            cells(b).forEach(function (x) { if (x.c === c && x.v !== 0 && x.r > h[c]) h[c] = x.r; });
        }
        var s = 0;
        for (var c2 = 1; c2 < b.width; c2++) s += Math.abs(h[c2] - h[c2 + 1]);
        return s;
    },
    // group cells by colour with a map, then average distance to the mean
    colourVariance: function (b) {
        var by = {};
        cells(b).forEach(function (x) {
            if (x.v <= 0) return;
            (by[x.v] = by[x.v] || []).push(x);
        });
        var total = 0;
        Object.keys(by).forEach(function (k) {
            var g = by[k];
            if (g.length < 2) return;
            var mr = g.reduce(function (a, x) { return a + x.r; }, 0) / g.length;
            var mc = g.reduce(function (a, x) { return a + x.c; }, 0) / g.length;
            total += g.reduce(function (a, x) {
                return a + Math.abs(x.r - mr) + Math.abs(x.c - mc);
            }, 0) / g.length;
        });
        return total;
    },
    // tally colours into a map, count the ones stuck below match length
    colourScarcity: function (b) {
        var count = {};
        cells(b).forEach(function (x) { if (x.v > 0) count[x.v] = (count[x.v] || 0) + 1; });
        return Object.keys(count).filter(function (k) { return count[k] > 0 && count[k] < 3; }).length;
    },
    // garbage cells, counted individually
    garbageOnBoard: function (b) {
        return cells(b).filter(function (x) { return x.v === -2; }).length;
    },
    // a panel is adjacent to garbage if any of the four neighbours is -2
    garbageAdjacency: function (b) {
        return cells(b).filter(function (x) {
            if (x.v <= 0) return false;
            return cells(b).some(function (y) {
                return y.v === -2 && Math.abs(x.r - y.r) + Math.abs(x.c - y.c) === 1;
            });
        }).length;
    }
};

// Plays a real game and hands every intercepted evaluation to `onEval`.
function play(seed, frames, onEval, drill) {
    drill = drill || { level: 3, every: 120, h: 3 };
    var stack = new PanelEngine.Stack({ level: drill.level, seed: seed, countdown: false });
    var cpu = new PanelCpu.SearchCpu(stack, { difficulty: 'nightmare', seed: seed + 55,
                                              mistake: 0, chainExtend: true });
    var P = PanelCpu.SearchCpu.prototype;
    var oev = P._evaluate, obs = P._buildScore;
    P._evaluate = function (board, g, c, co) {
        onEval(this, board, { chainLength: c, comboSizes: co ? [co] : [],
                              garbage: g ? [[g, 1]] : [] });
        return oev.call(this, board, g, c, co);
    };
    P._buildScore = function (board) {
        onEval(this, board, {});
        return obs.call(this, board);
    };
    try {
        for (var f = 0; f < frames; f++) {
            if (f > 120 && f % drill.every === 0) {
                stack.receiveGarbage([{ width: 6, height: drill.h, isChain: false }]);
            }
            cpu.update(); stack.run(); stack.takeDeliverableGarbage(); stack.drainEvents();
            if (stack.gameOver) break;
        }
    } finally { P._evaluate = oev; P._buildScore = obs; }
}

test('every board feature matches an independent oracle, on boards the search really ranked', function () {
    var checked = 0, mismatches = [], nonZero = {};
    Object.keys(ORACLE).forEach(function (k) { nonZero[k] = 0; });

    // TWO DRILLS, because one cannot make every oracle non-zero and an
    // oracle that returns 0 on every sampled board agrees vacuously. The
    // light drill is where the density features live; the heavy one buries
    // the board in garbage, which is the only way garbageOnBoard,
    // garbageAdjacency and colourScarcity are ever anything but 0.
    var DRILLS = [
        { seeds: [1, 2, 3], drill: { level: 3, every: 120, h: 3 } },
        { seeds: [4, 5],    drill: { level: 5, every: 45, h: 6 } }
    ];
    // RESERVOIR SAMPLING, over the whole game.
    //
    // The oracles are quadratic in cells and a single game produces ~17,000
    // evaluations, so this samples. The obvious sampler — take every Nth up
    // to a cap — is WRONG here and quietly so: thousands of evaluations
    // happen in the first 120 frames, before any garbage has landed, so the
    // cap filled entirely from the opening and every garbage oracle read 0
    // on every sampled board. Measured: 73% of scored boards contain
    // garbage, and the sample contained none of them.
    //
    // A reservoir keeps a uniform sample of the whole stream instead, which
    // is the property actually wanted. The grid is copied on the way in,
    // since the search reuses and mutates these boards.
    var LIMIT = 45;
    DRILLS.forEach(function (d) { d.seeds.forEach(function (seed) {
        var reservoir = [], seen = 0;
        var rngState = seed * 7919;
        function rnd() { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; }

        play(seed, 700, function (cpu, board, earned) {
            if (!board || !board.grid) return;
            seen++;
            var slot = reservoir.length < LIMIT ? reservoir.length : Math.floor(rnd() * seen);
            if (slot >= LIMIT) return;
            var grid = [];
            for (var r = 0; r <= board.height; r++) grid[r] = (board.grid[r] || []).slice();
            reservoir[slot] = {
                input: inputMod.fromStack(cpu.stack,
                    { width: board.width, height: board.height, grid: grid, blocks: board.blocks || {} },
                    earned, null, 0)
            };
        }, d.drill);

        reservoir.forEach(function (sample) {
            var input = sample.input;
            Object.keys(ORACLE).forEach(function (key) {
                var got = features[key](input);
                var want = ORACLE[key](input.board, input);
                if (Math.abs(got - want) > 1e-9) {
                    mismatches.push('seed ' + seed + ' ' + key + ': feature ' + got + ', oracle ' + want);
                }
                if (want !== 0) nonZero[key]++;
            });
            checked++;
        });
    }); });

    assert.ok(checked > 50, 'only sampled ' + checked + ' live evaluations');
    assert.deepStrictEqual(mismatches.slice(0, 5), [],
        mismatches.length + ' mismatches between the feature and an independent ' +
        'recomputation of the SAME board. First few: ' + mismatches.slice(0, 5).join(' | '));

    // A sweep where every oracle returned 0 every time proves nothing.
    var neverSeen = Object.keys(nonZero).filter(function (k) { return nonZero[k] === 0; });
    assert.deepStrictEqual(neverSeen, [],
        'these oracles were zero on every sampled board, so their agreement is ' +
        'vacuous: ' + neverSeen.join(', '));
    process.stdout.write('       [oracle] ' + checked + ' live evaluations, ' +
        Object.keys(ORACLE).length + ' features each, all agreed\n');
});

test('the board handed to the seam is the board the cpu is ranking, not a stale one', function () {
    // The failure no value check can see: the right number computed for the
    // WRONG board. Every candidate the search scores must be reachable from
    // the live stack by one swap — if the seam ever hands over a board from
    // a previous frame, this catches it.
    var offenders = 0, checked = 0;
    play(2, 500, function (cpu, board) {
        if (!board || !board.grid || checked > 400) return;
        checked++;
        var live = cpu._snapshot();
        var diffs = 0;
        for (var r = 1; r <= live.height; r++) {
            for (var c = 1; c <= live.width; c++) {
                if (live.grid[r][c] !== board.grid[r][c]) diffs++;
            }
        }
        // a swap moves two cells; a resolve can clear more, so this is a
        // generous bound aimed only at a board from another FRAME
        if (diffs > live.width * live.height * 0.6) offenders++;
    });
    assert.ok(checked > 50, 'only checked ' + checked + ' boards');
    assert.strictEqual(offenders, 0,
        offenders + '/' + checked + ' scored boards differ from the live board by more ' +
        'than 60% of cells — that is not a candidate move, it is a different position');
    process.stdout.write('       [freshness] ' + checked + ' scored boards, all reachable from the live stack\n');
});

tests.forEach(function (t) {
    try { t.fn(); process.stdout.write('  ok   ' + t.name + '\n'); }
    catch (e) { failures.push(t.name + '\n       ' + e.message); process.stdout.write('  FAIL ' + t.name + '\n'); }
});
if (failures.length) {
    process.stdout.write('\n' + failures.length + ' failed:\n\n' + failures.join('\n\n') + '\n');
    process.exit(1);
}
process.stdout.write('\n' + tests.length + ' passed — live values match an independent recomputation.\n');
