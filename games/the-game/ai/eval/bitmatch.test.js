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
            for (a = 1; a <= B.nColours; a++) {
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
            var N = Math.max(1, bit.topColour(grid, w, h));
            var rest = bit.restingMask(grid, blocks, w, h), B = [], a, c;
            for (a = 1; a <= N; a++) { B[a] = []; for (c = 1; c <= w; c++) B[a][c] = 0; }
            for (var r = 1; r <= h; r++) {
                for (c = 1; c <= w; c++) {
                    var v = grid[r][c];
                    if (v === -2) v = 1;
                    if (v >= 1 && v <= N && (rest[c] & (1 << (r - 1)))) B[v][c] |= (1 << (r - 1));
                }
            }
            B.nColours = N;
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

// ---------------------------------------------------------------------------
// THE CHIP LIBRARY, WHICH IS WHERE THE DEEP CHAINS ARE.
//
// Real play barely reaches depth 4 — three cases in the whole sweep above — so
// the cascade check cannot tell a correct deep chain from a truncated one. The
// chips are 6,228 positions built for exactly that, up to depth 6, and their
// boards are staged by verify_chips.js, borrowed rather than copied.
//
// They also carry FILLER in colours no real board uses, so this is the check
// that the arithmetic reads the colour count off the board instead of assuming
// the six the game plays.
var V = require('./verify_chips.js');
function chipSweep() {
    var out = { cases: 0, agree: 0, chainBad: 0, totalBad: 0, depth: {}, worst: null };
    V.chips.forEach(function (chip) {
        if (chip.swaps.length > 2) return;
        var st = V.stage(chip, V.MAP);
        if (st.skip) return;
        var b = st.board, i, r, c;
        for (i = 0; i < chip.swaps.length; i++) {
            r = chip.swaps[i][0] + st.rowOff; c = chip.swaps[i][1] + st.colOff;
            if (r < 1 || r > V.H || c < 1 || c >= V.W) return;
            if (i > 0) b._applyGravity();
            b.swap(r, c);
        }
        var truth = b.clone().resolve();
        var mine = bit.resolveBits(b.clone().grid, b.blocks, V.W, V.H);
        out.cases++;
        if (mine.scope !== 'ok') {
            out.chainBad++;
            if (!out.worst) out.worst = { kind: chip.kind, scope: mine.scope };
            return;
        }
        var tTotal = truth.comboSizes.reduce(function (x, y) { return x + y; }, 0);
        out.depth[truth.chainLength] = (out.depth[truth.chainLength] || 0) + 1;
        var okChain = mine.chain === truth.chainLength, okTotal = mine.total === tTotal;
        if (okChain && okTotal) { out.agree++; return; }
        if (!okChain) out.chainBad++;
        if (!okTotal) out.totalBad++;
        if (!out.worst) {
            out.worst = { kind: chip.kind, file: chip._file,
                          chain: truth.chainLength + ' vs ' + mine.chain,
                          cleared: tTotal + ' vs ' + mine.total, combos: truth.comboSizes };
        }
    });
    return out;
}
var chipsR = chipSweep();
console.log('  chips               ' + String(chipsR.cases).padStart(7) + ' cases  ' +
            'depths ' + JSON.stringify(chipsR.depth) + '  ' +
            (chipsR.agree === chipsR.cases ? 'all agree' : (chipsR.cases - chipsR.agree) + ' DISAGREE'));
if (chipsR.agree !== chipsR.cases) {
    console.error('FAIL the chips: ' + JSON.stringify(chipsR.worst));
    process.exit(1);
}
if (chipsR.cases !== V.chips.length) {
    console.error('FAIL only ' + chipsR.cases + ' of ' + V.chips.length + ' chips were staged');
    process.exit(1);
}
// The point of this sweep is the depth real play does not reach.
if (!chipsR.depth[5] || !chipsR.depth[6]) {
    console.error('FAIL no chain of depth 5 and 6 among the chips — this sweep is not testing depth');
    process.exit(1);
}

// A MATCHED GROUP HOLDS UP WHAT STANDS ON IT UNTIL THE BOARD RESTS. Empty its
// cells the moment it matches and panels drop early, so a group that was about
// to complete its own match lands elsewhere and that match never happens: the
// chain reads short and fewer panels clear. Twenty-eight chips say so.
var realBits = bit.resolveBits;
bit.resolveBits = function (grid, blocks, W, H) {
    if (blocks && Object.keys(blocks).length) return { scope: 'garbage', chain: 0, total: 0, rounds: 0 };
    var N = bit.topColour(grid, W, H), occ = [], colour = [], chaining = [], a, c, r;
    for (a = 1; a <= N; a++) { colour[a] = []; for (c = 1; c <= W; c++) colour[a][c] = 0; }
    for (c = 1; c <= W; c++) { occ[c] = 0; chaining[c] = 0; }
    for (r = 1; r <= H; r++) for (c = 1; c <= W; c++) {
        var v = grid[r][c];
        if (v === 0) continue;
        if (v < 1) return { scope: 'unknown-cell', chain: 0, total: 0, rounds: 0 };
        occ[c] |= (1 << (r - 1)); colour[v][c] |= (1 << (r - 1));
    }
    var counter = 0, rounds = 0, total = 0, guard = 0;
    while (guard++ <= W * H * H) {
        var rest = [], k = [], link = false, any = false;
        for (c = 1; c <= W; c++) { var o = occ[c], lz = (~o) & (o + 1); rest[c] = o & (lz - 1); }
        var B = [];
        for (a = 1; a <= N; a++) { B[a] = []; for (c = 1; c <= W; c++) B[a][c] = colour[a][c] & rest[c]; }
        for (c = 1; c <= W; c++) k[c] = 0;
        for (a = 1; a <= N; a++) {
            for (c = 1; c <= W; c++) { var bb = B[a][c], cv = bb & (bb >> 1) & (bb >> 2); k[c] |= cv | (cv << 1) | (cv << 2); }
            for (c = 1; c + 2 <= W; c++) { var hc = B[a][c] & B[a][c + 1] & B[a][c + 2]; k[c] |= hc; k[c + 1] |= hc; k[c + 2] |= hc; }
        }
        for (c = 1; c <= W; c++) { if (k[c]) any = true; if (k[c] & chaining[c]) link = true; }
        if (any) {
            rounds++;
            if (link) counter = counter === 0 ? 2 : counter + 1;
            for (c = 1; c <= W; c++) {
                total += bit.popcount(k[c]);
                if (!k[c]) continue;
                var lowest = k[c] & -k[c], keep = occ[c] & ~k[c];
                chaining[c] = (chaining[c] | (keep & ~(lowest - 1))) & keep;
                for (a = 1; a <= N; a++) colour[a][c] &= keep;
                occ[c] = keep;
            }
            continue;
        }
        var fell = false;
        for (c = 1; c <= W; c++) {
            var hole = (~occ[c]) & (occ[c] + 1), above = ~((hole << 1) - 1);
            if (!(occ[c] & above)) continue;
            fell = true;
            var below = hole - 1;
            for (a = 1; a <= N; a++) colour[a][c] = (colour[a][c] & below) | ((colour[a][c] & above) >> 1);
            chaining[c] = (chaining[c] & below) | ((chaining[c] & above) >> 1);
            occ[c] = (occ[c] & below) | ((occ[c] & above) >> 1);
        }
        if (!fell) break;
    }
    return { scope: 'ok', chain: rounds ? Math.max(counter, 1) : 0, total: total, rounds: rounds };
};
var brokenChips = chipSweep();
bit.resolveBits = realBits;
var sweptEarly = brokenChips.cases - brokenChips.agree;
console.log('  break: ' + 'matches swept the instant they fire'.padEnd(34) +
            (sweptEarly ? sweptEarly + ' cases caught it' : 'NOT CAUGHT'));
if (!sweptEarly) {
    console.error('FAIL the chip sweep did not notice matches being swept early');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// AGAINST THE ENGINE THAT RUNS THE GAME, not against the simulation.
//
// resolve() is a second implementation of these rules and is not the authority;
// engineboard.js paints a candidate onto a real PanelEngine.Stack and runs
// frames until the board is still, which is. Every legal swap on every captured
// board, garbage and all.
//
// TWO KINDS OF CASE, and they are asserted differently. Where no match touches a
// slab, nothing is unknown and the arithmetic must equal the engine exactly.
// Where one does, the engine colours the popped row from its own rng, so the
// answer is not predictable and the arithmetic reports the floor — what clears
// whatever the draw is — which must not exceed what the engine got.
var EB = require('./engineboard.js');
function paintBlocks(bl) { var o = {}; for (var k in bl) o[k] = bl[k].cells; return o; }
var stack = EB.scratch(10);
var eng = { exact: 0, exactBad: 0, bounded: 0, boundedBad: 0, fired: 0, depth: {}, worst: null };
for (var ei = 0; ei < src.boards.length; ei++) {
    var eb = boardFromString(src.boards[ei]);
    var ebase = new LogicalBoard(W, H, 6, eb.grid, eb.blocks);
    var eswaps = ebase.legalSwaps();
    for (var es = 0; es < eswaps.length; es++) {
        var post = ebase.clone();
        post.swap(eswaps[es][0], eswaps[es][1]);
        EB.paint(stack, post.grid, H, W, paintBlocks(eb.blocks));
        var truthE = EB.settle(stack, 900);
        var mine = bit.resolveBits(post.grid, post.blocks, W, H);
        if (truthE.clearedPanels) eng.fired++;
        eng.depth[truthE.chainLength] = (eng.depth[truthE.chainLength] || 0) + 1;
        var bad = null;
        if (mine.scope === 'ok') {
            eng.exact++;
            if (mine.chain !== truthE.chainLength || mine.total !== truthE.clearedPanels) {
                eng.exactBad++;
                bad = 'exact case differs';
            }
        } else if (mine.scope === 'garbage-broke') {
            eng.bounded++;
        } else {
            eng.boundedBad++;
            bad = 'unexpected scope ' + mine.scope;
        }
        if (bad && !eng.worst) {
            eng.worst = { why: bad, board: ei, swap: eswaps[es],
                          chain: truthE.chainLength + ' vs ' + mine.chain,
                          cleared: truthE.clearedPanels + ' vs ' + mine.total,
                          combos: truthE.comboSizes };
        }
    }
}
console.log('  engine, exact       ' + String(eng.exact).padStart(7) + ' cases  ' +
            (eng.exactBad ? eng.exactBad + ' DISAGREE' : 'all agree'));
console.log('  engine, slab broke  ' + String(eng.bounded).padStart(7) + ' cases  ' +
            (eng.boundedBad ? eng.boundedBad + ' BAD SCOPE' : 'reported, not guessed'));
console.log('  engine depths       ' + JSON.stringify(eng.depth));
if (eng.exactBad || eng.boundedBad) {
    console.error('FAIL against the engine: ' + JSON.stringify(eng.worst));
    process.exit(1);
}
if (!eng.bounded) { console.error('FAIL no case broke a slab — that path is untested'); process.exit(1); }
if (!eng.depth[2]) { console.error('FAIL the engine sweep saw no chain'); process.exit(1); }

// ---------------------------------------------------------------------------
// THE FAST PATH IS THE SAME PATH.
//
// Reading a grid costs 72 double-indexed reads; a swap changes four bits. So a
// caller scoring every swap on one board builds the masks once and mutates them
// per swap. That is a second way into the same arithmetic, and a second way in
// is a second thing to drift — it has to give the identical verdict on every
// legal swap of every captured board, scope included.
var fast = { cases: 0, differ: 0, skipped: 0, worst: null };
for (var fi = 0; fi < src.boards.length; fi++) {
    var fb = boardFromString(src.boards[fi]);
    var fbase = new LogicalBoard(W, H, 6, fb.grid, fb.blocks);
    var fswaps = fbase.legalSwaps();
    var st = bit.maskState(fbase.grid, fbase.blocks, W, H);
    for (var fs = 0; fs < fswaps.length; fs++) {
        var viaGrid = fbase.clone();
        viaGrid.swap(fswaps[fs][0], fswaps[fs][1]);
        var want = bit.resolveBits(viaGrid.grid, viaGrid.blocks, W, H);
        if (!bit.swapMasks(st, fswaps[fs][0], fswaps[fs][1])) { fast.skipped++; continue; }
        var got = bit.resolveFromMasks(st);
        bit.swapMasks(st, fswaps[fs][0], fswaps[fs][1]);   // and put it back
        fast.cases++;
        if (want.scope === got.scope && want.chain === got.chain && want.total === got.total) continue;
        fast.differ++;
        if (!fast.worst) {
            fast.worst = { board: fi, swap: fswaps[fs],
                           grid: want.scope + ' chain ' + want.chain + ' cleared ' + want.total,
                           masks: got.scope + ' chain ' + got.chain + ' cleared ' + got.total };
        }
    }
}
console.log('  mask path           ' + String(fast.cases).padStart(7) + ' swaps  ' +
            (fast.differ ? fast.differ + ' DIFFER' : 'identical to the grid path'));
if (fast.differ) { console.error('FAIL mask path: ' + JSON.stringify(fast.worst)); process.exit(1); }
if (!fast.cases) { console.error('FAIL the mask path was never exercised'); process.exit(1); }

// AND IT CAN FAIL: a swap that moves only one of the two cells leaves the masks
// disagreeing with the board, which is the mistake this path invites.
var realSwap = bit.swapMasks;
bit.swapMasks = function (st2, r, c) {
    var W2 = st2.W, b = 1 << (r - 1), o = c + 1, stride = W2 + 2, a, left = 0;
    if ((st2.inert[c] & b) || (st2.inert[o] & b)) return false;
    for (a = 1; a <= st2.N; a++) if (st2.colour[a * stride + c] & b) left = a;
    if (left) { st2.colour[left * stride + c] &= ~b; st2.colour[left * stride + o] |= b; }
    if (left) st2.occ[o] |= b;
    return true;
};
var halfBad = 0;
for (var hi = 0; hi < 400; hi++) {
    var hb = boardFromString(src.boards[hi]);
    var hbase = new LogicalBoard(W, H, 6, hb.grid, hb.blocks);
    var hsw = hbase.legalSwaps(), hst = bit.maskState(hbase.grid, hbase.blocks, W, H);
    for (var hs = 0; hs < hsw.length; hs++) {
        var hg = hbase.clone(); hg.swap(hsw[hs][0], hsw[hs][1]);
        var hwant = bit.resolveBits(hg.grid, hg.blocks, W, H);
        if (!bit.swapMasks(hst, hsw[hs][0], hsw[hs][1])) continue;
        var hgot = bit.resolveFromMasks(hst);
        hst = bit.maskState(hbase.grid, hbase.blocks, W, H);   // this break cannot undo itself
        if (hwant.chain !== hgot.chain || hwant.total !== hgot.total) halfBad++;
    }
}
bit.swapMasks = realSwap;
console.log('  break: ' + 'only one half of the swap moves'.padEnd(34) +
            (halfBad ? halfBad + ' cases caught it' : 'NOT CAUGHT'));
if (!halfBad) { console.error('FAIL a half-applied swap went unnoticed'); process.exit(1); }

console.log('bitmatch: ' + cases + ' cases agree with _findMatches, ' + ruleCases +
            ' with the run rule itself, ' + casc.cases + ' cascades agree with resolve(), ' +
            chipsR.cases + ' chips up to depth 6, ' + eng.exact +
            ' exact against the engine with ' + eng.bounded +
            ' stopped where a slab broke, ' + fast.cases +
            ' swaps identical through the mask path, and 7 breaks are caught');

// ------------- anyOneSwapClear answers what the sweep answers, far cheaper
//
// "Is any single swap a clear" was asked in two places with two copies of the
// same sweep: apply every legal swap, run a full resolve, look at the result. A
// resolve allocates a scratch board the size of the stack, once per swap.
//
// The arithmetic reads lines through the two cells a swap exchanges. It takes
// the slow path only where a cell is empty, because a hole makes everything
// above it fall and a match can form among panels no line through those two
// cells passes.
//
// IT NEEDS A SETTLED BOARD. Mid-flight it disagrees both ways, and both callers
// pass one: restingBoard in bitbot, res.settled in bitoptions.
(function () {
    function sweep(st) {
        var sw = bit.legalSwapsOf(st), i, r;
        for (i = 0; i < sw.length; i++) {
            if (!bit.swapMasks(st, sw[i][0], sw[i][1])) continue;
            r = bit.resolveFromMasks(st, false);
            bit.swapMasks(st, sw[i][0], sw[i][1]);
            if (r.scope === 'garbage-broke' || r.total > 0) return true;
        }
        return false;
    }
    var P = globalThis.PanelEngine;
    var boards = [], seeds = [101, 103, 211];
    seeds.forEach(function (sd) {
        var st = new P.Stack({ level: 10, seed: sd, countdown: false });
        var BitBot = require('./bitbot.js');
        var bot = new BitBot(st, { allowRaise: true });
        for (var f = 0; f < 900; f++) {
            bot.update(); st.run();
            if (f % 180 === 0 && f > 0) st.receiveGarbage([{ width: 6, height: 1, isMetal: false }]);
            st.drainEvents();
            if (f % 11 === 0) {
                var b = bot._snapshot();
                var m = bit.maskState(b.grid, b.blocks, 6, b.height);
                var rr = bit.resolveFromMasks(bit.copyState(m), true);
                boards.push((rr && rr.settled) || m);       // settled, as callers pass
            }
            if (st.gameOver) break;
        }
    });
    var over = 0, under = 0, yes = 0;
    boards.forEach(function (b) {
        var s = sweep(bit.copyState(b)), f = bit.anyOneSwapClear(b);
        if (s) yes++;
        if (s !== f) { if (f) over++; else under++; }
    });
    var bad = 0;
    if (boards.length < 100) { console.error('FAIL anyOneSwapClear: only ' + boards.length + ' boards to compare'); bad++; }
    if (over > 0) {
        console.error('FAIL anyOneSwapClear said a clear was available on ' + over + ' of ' +
                      boards.length + ' settled boards where the sweep says none is. A false ' +
                      'yes here tells the raise a dead board is ready and tells the save ' +
                      'invariant it has something it does not.');
        bad++;
    }
    if (under > boards.length * 0.01) {
        console.error('FAIL anyOneSwapClear missed a clear on ' + under + ' of ' + boards.length +
                      ' settled boards, over the 1% the empty-cell fallback is meant to leave');
        bad++;
    }
    console.log('  anyOneSwapClear: ' + boards.length + ' settled boards, sweep finds a clear on ' +
                yes + ', disagreements ' + over + ' over / ' + under + ' under');
    if (bad) process.exit(1);
}());

var P = globalThis.PanelEngine, W = 6;
var BF = require('./bitfeatures.js');
var opts = require('./bitoptions.js');
var BitBot = require('./bitbot.js');

// ---- bestOneSwapStop: the freeze a board can buy, in frames
//
// anyOneSwapClear answers whether a board can fire, which is a boolean where the
// answer is a number: a bare three buys 0 held frames, a combo 4 buys 60 topped
// out, a chain 4 buys 94. A caller ranking landings by "can it fire" scores
// those the same, and the gap between them is most of a row of ceiling.
(function () {
    var bfails = 0;
    function bok(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); bfails++; } }
    // The same pricing the features use, so this and stopReachable cannot drift.
    function priceOf(toppedOut) {
        return function (r) {
            var isChain = r.chain >= 2;
            return BF.stopTimeOf(P, isChain, isChain ? 0 : opts.sizeOf(r.chain, r.total),
                                 isChain ? r.chain : 0, toppedOut);
        };
    }
    // EXACT, CHECKED AGAINST BRUTE FORCE on real boards. Not "cheaper and close":
    // a landing ranked on a number that is sometimes wrong is a landing chosen
    // for a freeze that does not arrive.
    function brute(st, price) {
        var sw = bit.legalSwapsOf(st), best = 0, i;
        for (i = 0; i < sw.length; i++) {
            var cp = bit.copyState(st);
            if (!bit.swapMasks(cp, sw[i][0], sw[i][1])) continue;
            var r = bit.resolveFromMasks(cp, false);
            if (r && r.total > 0) { var p = price(r) || 0; if (p > best) best = p; }
        }
        return best;
    }
    var checked = 0, wrong = 0, nonzero = 0, seen = {};
    var st0 = new P.Stack({ level: 10, seed: 101, countdown: false });
    var probe = new BitBot(st0, { allowRaise: true });
    for (var f = 0; f < 2500 && !st0.gameOver; f++) {
        probe.update(); st0.run();
        if (f % 150 === 0 && f > 0) st0.receiveGarbage([{ width: 6, height: 1, isMetal: false }]);
        st0.drainEvents();
        if (f % 11) continue;
        var b = probe._snapshot();
        var m = bit.maskState(b.grid, b.blocks, W, b.height);
        [false, true].forEach(function (top) {
            var price = priceOf(top);
            var got = bit.bestOneSwapStop(m, price), want = brute(m, price);
            checked++;
            if (got !== want) wrong++;
            if (got > 0) { nonzero++; seen[got] = (seen[got] || 0) + 1; }
        });
    }
    bok(checked > 100, 'bestOneSwapStop: only ' + checked + ' boards checked');
    bok(wrong === 0,
        'bestOneSwapStop: disagreed with brute force on ' + wrong + ' of ' + checked +
        ' real boards -- a landing ranked on a number that is sometimes wrong is a ' +
        'landing chosen for a freeze that never arrives');
    bok(nonzero > 0,
        'bestOneSwapStop: returned 0 on every one of ' + checked + ' boards, so it ' +
        'ranks nothing');
    bok(Object.keys(seen).length > 1,
        'bestOneSwapStop: every board that can fire returned the SAME number (' +
        Object.keys(seen)[0] + '), which is the boolean it exists to replace');

    // AND A BARE THREE IS WORTH NOTHING, which is the case the boolean got wrong.
    // Three in a row on an otherwise empty board: it clears, and it buys no freeze.
    var st1 = new P.Stack({ level: 10, seed: 101, countdown: false });
    var r2, c2;
    for (r2 = 1; r2 <= st1.height; r2++)
        for (c2 = 1; c2 <= W; c2++) { st1.panels[r2][c2].color = 0; st1.panels[r2][c2].isGarbage = false; }
    // c3 <-> c4 puts three 1s together: a clear that buys no freeze at all.
    [1, 1, 2, 1, 4, 5].forEach(function (v, i2) { st1.panels[1][i2 + 1].color = v; });
    var bot1 = new BitBot(st1, { allowRaise: false }), s1 = bot1._snapshot();
    var m1 = bit.maskState(s1.grid, s1.blocks, W, s1.height);
    bok(bit.anyOneSwapClear(m1) === true,
        'bestOneSwapStop: the bare-three board offers no clear, so this checks nothing');
    bok(bit.bestOneSwapStop(m1, priceOf(true)) === 0,
        'bestOneSwapStop: a bare three was priced above zero. It clears and it buys ' +
        'no freeze, and telling those apart is the whole point of the number');

    console.log('  bestOneSwapStop: ' + (bfails ? bfails + ' FAILED' :
                'the freeze a board can buy, exact against brute force over ' + checked + ' boards'));
    if (bfails) process.exit(1);
}());
