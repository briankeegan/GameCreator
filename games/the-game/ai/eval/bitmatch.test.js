#!/usr/bin/env node
// THE BIT ARITHMETIC ANSWERS WHAT THE SIMULATION ANSWERS.
//
//   node bitmatch.test.js
//
// bitmatch.js computes the cleared cells from AND and popcount; _findMatches
// walks the grid for runs. They must agree on the CELL SET, not the count — a
// right-sized clear in the wrong place is a defect that a total would hide.
//
// AGREEING ON NOTHING IS NOT AGREEING. Every real board in realboards.json is
// settled, so a sweep of them alone is 4,716 cases of both sides finding no
// match: a check that passes with the arithmetic deleted. So each board is
// swept in five states, and the states where a match is expected have to
// actually produce some — asserted per state, not summed.
//
//   settled               the captured position: nothing matches
//   swapped, no gravity   panels can be airborne; only landed ones may match
//   swapped, settled      the combo the swap makes
//   holes open            cleared cells blanked, before anything falls
//   cascade round 2       and after, which is the next link of a chain
//
// Then the same sweep with one step of the arithmetic broken, four ways, each
// of which must be caught.
var path = require('path');
var fs = require('fs');
var ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'panel-engine.js'));
require(path.join(ROOT, 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var bit = require('./bitmatch.js');
var PanelRules = require(path.join(ROOT, 'panel-rules.js'));
var W = 6, H = 12;

// capture_boards.js writes row 1 (the floor) first, W chars per row. A digit
// is a colour, a letter is a garbage cell and names its block.
function boardFromString(s) {
    var grid = [], blocks = {}, r, c;
    for (r = 0; r <= H; r++) { grid[r] = []; for (c = 1; c <= W; c++) grid[r][c] = 0; }
    for (r = 1; r <= H; r++) {
        for (c = 1; c <= W; c++) {
            var ch = s.charAt((r - 1) * W + (c - 1));
            if (ch === '') continue;
            if (/[a-zA-Z]/.test(ch)) {
                grid[r][c] = -2;
                if (!blocks[ch]) blocks[ch] = { cells: [] };
                blocks[ch].cells.push([r, c]);
            } else {
                grid[r][c] = Number(ch);
            }
        }
    }
    return { grid: grid, blocks: blocks };
}

var src = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));
if (!src.boards || !src.boards.length) throw new Error('realboards.json holds no boards');

function sweep() {
    var R = {};
    function check(tag, b) {
        var truth = Object.keys(b._findMatches(true)).sort();
        var mine = bit.clearedCells(b.grid, b.blocks, W, H);
        var mk = Object.keys(mine).sort();
        var same = truth.length === mk.length && truth.every(function (k) { return mine[k]; });
        var s = R[tag] || (R[tag] = { cases: 0, fired: 0, agree: 0, disagree: 0, worst: null });
        s.cases++;
        if (truth.length) s.fired++;
        if (same) { s.agree++; return; }
        s.disagree++;
        if (!s.worst) {
            s.worst = {
                missed: truth.filter(function (k) { return !mine[k]; }),
                invented: mk.filter(function (k) { return truth.indexOf(k) < 0; })
            };
        }
    }

    for (var i = 0; i < src.boards.length; i++) {
        var built = boardFromString(src.boards[i]);
        var base = new LogicalBoard(W, H, 6, built.grid, built.blocks);
        check('settled', base);
        var swaps = base.legalSwaps();
        for (var s2 = 0; s2 < swaps.length; s2++) {
            var mid = base.clone();
            mid.swap(swaps[s2][0], swaps[s2][1]);
            check('swapped_no_gravity', mid);
            var settled = mid.clone();
            settled._applyGravity();
            check('swapped_settled', settled);
            var m = settled._findMatches(true);
            if (!Object.keys(m).length) continue;
            var open = settled.clone();
            for (var k in m) open.grid[m[k][0]][m[k][1]] = 0;
            check('holes_open', open);
            var next = open.clone();
            next._applyGravity();
            check('cascade_round2', next);
        }
    }
    return R;
}

// A state that fires nothing proves nothing, so say which ones must.
var MUST_FIRE = { swapped_no_gravity: 1, swapped_settled: 1, cascade_round2: 1 };
var R = sweep();
var cases = 0, fired = 0, bad = [];
Object.keys(R).sort().forEach(function (tag) {
    var s = R[tag];
    cases += s.cases; fired += s.fired;
    if (s.cases !== s.agree + s.disagree) bad.push(tag + ': verdicts do not add up');
    if (s.disagree) {
        bad.push(tag + ': ' + s.disagree + ' of ' + s.cases + ' disagree; first missed ' +
                 JSON.stringify(s.worst.missed) + ' invented ' + JSON.stringify(s.worst.invented));
    }
    if (MUST_FIRE[tag] && !s.fired) bad.push(tag + ': nothing matched in any case — agreement here is vacuous');
    console.log('  ' + tag.padEnd(20) + String(s.cases).padStart(7) + ' cases  ' +
                String(s.fired).padStart(6) + ' fired  ' +
                (s.disagree ? s.disagree + ' DISAGREE' : 'all agree'));
});
console.log('  ' + 'TOTAL'.padEnd(20) + String(cases).padStart(7) + ' cases  ' +
            String(fired).padStart(6) + ' fired');
if (bad.length) { bad.forEach(function (b) { console.error('FAIL ' + b); }); process.exit(1); }

// ---------------------------------------------------------------------------
// AND IT CAN FAIL. One step broken at a time, each the defect the step exists
// to prevent. A break that the sweep does not notice is a step nothing checks.
var real = { restingMask: bit.restingMask, clears: bit.clears, colourMasks: bit.colourMasks };
var BREAKS = {
    // Everything matches whether it has landed or not.
    'resting ignored': function () {
        bit.restingMask = function (grid, blocks, w, h) {
            var occ = [];
            for (var c = 1; c <= w; c++) {
                occ[c] = 0;
                for (var r = 1; r <= h; r++) if (grid[r][c] !== 0) occ[c] |= (1 << (r - 1));
            }
            return occ;
        };
    },
    // Resting read off the column's lowest gap, which cannot see a garbage
    // slab bridging the hole under the cells standing on it.
    'resting read from the lowest gap': function () {
        bit.restingMask = function (grid, blocks, w, h) {
            var rest = [];
            for (var c = 1; c <= w; c++) {
                var o = 0;
                for (var r = 1; r <= h; r++) if (grid[r][c] !== 0) o |= (1 << (r - 1));
                var lowestZero = (~o) & (o + 1);
                rest[c] = o & (lowestZero - 1);
            }
            return rest;
        };
    },
    // The core of a run clears, the rest of the run does not.
    'run cores not expanded': function () {
        bit.clears = function (grid, blocks, w, h) {
            var B = bit.colourMasks(grid, blocks, w, h), mask = [], a, c;
            for (c = 1; c <= w; c++) mask[c] = 0;
            for (a = 1; a <= 6; a++) {
                for (c = 1; c <= w; c++) {
                    var b = B[a][c];
                    mask[c] |= b & (b >> 1) & (b >> 2);
                }
                for (c = 1; c + 2 <= w; c++) {
                    var hc = B[a][c] & B[a][c + 1] & B[a][c + 2];
                    mask[c] |= hc; mask[c + 1] |= hc; mask[c + 2] |= hc;
                }
            }
            var total = 0;
            for (c = 1; c <= w; c++) total += bit.popcount(mask[c]);
            return { mask: mask, total: total };
        };
    },
    // Garbage treated as a colour, so a slab joins a match.
    'garbage allowed to match': function () {
        bit.colourMasks = function (grid, blocks, w, h) {
            var rest = bit.restingMask(grid, blocks, w, h), B = [], a, c;
            for (a = 1; a <= 6; a++) { B[a] = []; for (c = 1; c <= w; c++) B[a][c] = 0; }
            for (var r = 1; r <= h; r++) {
                for (c = 1; c <= w; c++) {
                    var v = grid[r][c];
                    if (v === -2) v = 1;
                    if (v >= 1 && v <= 6 && (rest[c] & (1 << (r - 1)))) B[v][c] |= (1 << (r - 1));
                }
            }
            return B;
        };
    }
};

var missed = [];
Object.keys(BREAKS).forEach(function (name) {
    bit.restingMask = real.restingMask;
    bit.clears = real.clears;
    bit.colourMasks = real.colourMasks;
    BREAKS[name]();
    var broken = sweep(), caught = 0;
    Object.keys(broken).forEach(function (t) { caught += broken[t].disagree; });
    console.log('  break: ' + name.padEnd(34) + (caught ? caught + ' cases caught it' : 'NOT CAUGHT'));
    if (!caught) missed.push(name);
});
bit.restingMask = real.restingMask;
bit.clears = real.clears;
bit.colourMasks = real.colourMasks;

if (missed.length) {
    missed.forEach(function (m) { console.error('FAIL the sweep did not notice: ' + m); });
    process.exit(1);
}
// ---------------------------------------------------------------------------
// THE RUN RULE ITSELF, against the one copy of it both engines call.
//
// _findMatches is a CALLER of PanelRules.scanRuns; agreeing with it leaves the
// rule checked only on the boards real play throws up. Random boards with
// every cell filled take eligibility out of the question — no holes, nothing
// airborne — so a disagreement can only be the run rule, and they reach run
// lengths a real board rarely does, up to a column of twelve.
function xorshift(seed) {
    var s = seed >>> 0;
    return function () {
        s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
        return s / 4294967296;
    };
}
var stride = W + 1;
var ruleCases = 0, ruleAgree = 0, ruleBad = null, lengths = {};
[2, 3, 4, 5, 6].forEach(function (nColours) {
    var rand = xorshift(0x9e3779b9 ^ (nColours * 2654435761));
    for (var t = 0; t < 20000; t++) {
        var grid = [], r, c;
        for (r = 0; r <= H; r++) { grid[r] = []; for (c = 1; c <= W; c++) grid[r][c] = 0; }
        for (r = 1; r <= H; r++) for (c = 1; c <= W; c++) grid[r][c] = 1 + Math.floor(rand() * nColours);

        var eff = new Array((H + 1) * stride).fill(0);
        for (r = 1; r <= H; r++) for (c = 1; c <= W; c++) eff[r * stride + c] = grid[r][c];
        var truth = {};
        PanelRules.scanRuns(eff, W, H, stride, function (rr, cc) { truth[rr + ':' + cc] = 1; });

        // Longest run seen, so the report says which lengths were exercised.
        for (r = 1; r <= H; r++) {
            var n = 1;
            for (c = 2; c <= W + 1; c++) {
                if (c <= W && grid[r][c] === grid[r][c - 1]) { n++; continue; }
                if (n >= 3) lengths['across ' + n] = (lengths['across ' + n] || 0) + 1;
                n = 1;
            }
        }
        for (c = 1; c <= W; c++) {
            var m2 = 1;
            for (r = 2; r <= H + 1; r++) {
                if (r <= H && grid[r][c] === grid[r - 1][c]) { m2++; continue; }
                if (m2 >= 3) lengths['down ' + m2] = (lengths['down ' + m2] || 0) + 1;
                m2 = 1;
            }
        }

        var mine = bit.clearedCells(grid, {}, W, H);
        var tk = Object.keys(truth).sort(), mk = Object.keys(mine).sort();
        ruleCases++;
        if (tk.length === mk.length && tk.every(function (k) { return mine[k]; })) { ruleAgree++; continue; }
        if (!ruleBad) {
            ruleBad = { colours: nColours, missed: tk.filter(function (k) { return !mine[k]; }),
                        invented: mk.filter(function (k) { return tk.indexOf(k) < 0; }) };
        }
    }
});
console.log('  run rule            ' + String(ruleCases).padStart(7) + ' random boards  ' +
            (ruleCases === ruleAgree ? 'all agree' : (ruleCases - ruleAgree) + ' DISAGREE'));
if (ruleCases !== ruleAgree) {
    console.error('FAIL the run rule: missed ' + JSON.stringify(ruleBad.missed) +
                  ' invented ' + JSON.stringify(ruleBad.invented));
    process.exit(1);
}
if (!lengths['down 12'] || !lengths['across 6']) {
    console.error('FAIL the random boards never produced a full-width or full-height run');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// THE WHOLE CASCADE: resolveBits against resolve(), chain counter and panels
// cleared, over every legal swap on every board that carries no garbage.
//
// A cascade past a garbage break is unknowable — the engine turns the popped
// row into panels whose colours come from its own rng — so resolveBits reports
// those boards as out of scope and they are counted here, not skipped quietly.
function cascadeSweep() {
    var out = { cases: 0, outOfScope: 0, agree: 0, chainBad: 0, totalBad: 0, depth: {}, worst: null };
    for (var i = 0; i < src.boards.length; i++) {
        var built = boardFromString(src.boards[i]);
        if (Object.keys(built.blocks).length) { out.outOfScope++; continue; }
        var base = new LogicalBoard(W, H, 6, built.grid, built.blocks);
        var swaps = base.legalSwaps();
        for (var s = 0; s < swaps.length; s++) {
            var t = base.clone(); t.swap(swaps[s][0], swaps[s][1]);
            var truth = t.resolve();
            var tTotal = truth.comboSizes.reduce(function (x, y) { return x + y; }, 0);
            var m = base.clone(); m.swap(swaps[s][0], swaps[s][1]);
            var mine = bit.resolveBits(m.grid, m.blocks, W, H);
            out.cases++;
            out.depth[truth.chainLength] = (out.depth[truth.chainLength] || 0) + 1;
            var okChain = mine.chain === truth.chainLength, okTotal = mine.total === tTotal;
            if (okChain && okTotal) { out.agree++; continue; }
            if (!okChain) out.chainBad++;
            if (!okTotal) out.totalBad++;
            if (!out.worst) {
                out.worst = { board: i, swap: swaps[s], chain: truth.chainLength + ' vs ' + mine.chain,
                              cleared: tTotal + ' vs ' + mine.total, combos: truth.comboSizes };
            }
        }
    }
    return out;
}
var casc = cascadeSweep();
console.log('  cascade             ' + String(casc.cases).padStart(7) + ' cases  ' +
            'depths ' + JSON.stringify(casc.depth) + '  ' +
            (casc.agree === casc.cases ? 'all agree' : (casc.cases - casc.agree) + ' DISAGREE'));
if (casc.agree !== casc.cases) {
    console.error('FAIL the cascade: ' + JSON.stringify(casc.worst));
    process.exit(1);
}
// A cascade sweep that never saw a chain proves only that combos still work.
if (!casc.depth[2]) { console.error('FAIL no chain of depth 2 in the whole sweep'); process.exit(1); }

// AND THE CASCADE CAN FAIL. Both breaks are the ones the loop is shaped to
// avoid, and each must show up as a wrong chain counter.
var realResolve = bit.resolveBits;
var CASCADE_BREAKS = {
    // Rounds counted instead of links: two combos a beat apart read as a chain.
    'links counted as rounds': function (grid, blocks, w, h) {
        var r = realResolve(grid, blocks, w, h);
        if (r.scope !== 'ok') return r;
        return { scope: 'ok', chain: r.rounds, total: r.total, rounds: r.rounds };
    }
};
var cascadeMissed = [];
Object.keys(CASCADE_BREAKS).forEach(function (name) {
    bit.resolveBits = CASCADE_BREAKS[name];
    var broken = cascadeSweep();
    bit.resolveBits = realResolve;
    var caught = broken.cases - broken.agree;
    console.log('  break: ' + name.padEnd(34) + (caught ? caught + ' cases caught it' : 'NOT CAUGHT'));
    if (!caught) cascadeMissed.push(name);
});
if (cascadeMissed.length) {
    cascadeMissed.forEach(function (m) { console.error('FAIL the cascade sweep did not notice: ' + m); });
    process.exit(1);
}

console.log('bitmatch: ' + cases + ' cases agree with _findMatches, ' + ruleCases +
            ' with the run rule itself, ' + casc.cases + ' cascades agree with resolve(), ' +
            'and 5 breaks are caught');
