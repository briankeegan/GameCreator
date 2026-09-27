#!/usr/bin/env node
// THE ENGINE DECIDES WHILE PANELS ARE IN THE AIR, AND ONLY THEN.
//
//   node bitdecide.test.js
//
// Two claims, and the second is why this exists.
//
// On a SETTLED board the arithmetic answers and the engine is never touched —
// asserted by counting the calls, because a decision that quietly reached for
// the engine would still be right and would blow the 85ms budget.
//
// On a board caught MID-CONVERSION — a slab has broken, its bottom row has
// taken real colours and is still hovering — the move chosen has to be the move
// the engine itself would choose. Those positions are found by playing the real
// game until one appears, not by constructing one, because the thing under test
// is exactly what the engine does that a still picture does not show.
var path = require('path');
var fs = require('fs');
var ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'panel-engine.js'));
require(path.join(ROOT, 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var EB = require('./engineboard.js');
var bit = require('./bitmatch.js');
var decide = require('./bitdecide.js');
var W = 6, H = 12;

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
            } else { grid[r][c] = Number(ch); }
        }
    }
    return { grid: grid, blocks: blocks };
}
function paintBlocks(bl) { var o = {}; for (var k in bl) o[k] = bl[k].cells; return o; }

// The board and the per-panel state, as a planner watching the game would have
// them: colours it can see, and which panels have not landed.
function snapshot(stack) {
    var grid = [], blocks = {}, motion = [], r, c;
    for (r = 0; r <= H; r++) {
        grid[r] = []; motion[r] = [];
        for (c = 1; c <= W; c++) { grid[r][c] = 0; motion[r][c] = null; }
    }
    for (r = 1; r <= H; r++) {
        for (c = 1; c <= W; c++) {
            var p = stack.panels[r] && stack.panels[r][c];
            if (!p) continue;
            if (p.isGarbage) {
                grid[r][c] = -2;
                var id = 'g' + p.garbageId;
                if (!blocks[id]) blocks[id] = { cells: [] };
                blocks[id].cells.push([r, c]);
            } else {
                grid[r][c] = p.color || 0;
            }
            if (p.state && p.state !== 'normal') motion[r][c] = { state: p.state, timer: p.timer || 0 };
        }
    }
    return { grid: grid, blocks: blocks, motion: motion };
}

var src = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));

// --------------------------------------------------------------------------
// A SETTLED BOARD MUST NOT REACH FOR THE ENGINE.
var realScratch = EB.scratch, engineCalls = 0;
EB.scratch = function (lvl) { engineCalls++; return realScratch(lvl); };
var settled = 0;
for (var i = 0; i < 400; i++) {
    var b = boardFromString(src.boards[i]);
    var base = new LogicalBoard(W, H, 6, b.grid, b.blocks);
    var d = decide.bestMove(base, W, H, null, paintBlocks(b.blocks));
    settled++;
    if (d.decidedBy !== 'arithmetic') {
        console.error('FAIL a settled board was decided by the ' + d.decidedBy);
        process.exit(1);
    }
}
EB.scratch = realScratch;
console.log('  settled boards      ' + String(settled).padStart(5) +
            '   decided by the arithmetic, engine calls: ' + engineCalls);
if (engineCalls !== 0) {
    console.error('FAIL the engine was built ' + engineCalls + ' times for settled boards');
    process.exit(1);
}

// --------------------------------------------------------------------------
// MID-CONVERSION: the move chosen has to be the engine's own best.
//
// Found by playing: break a slab, then run frames until its converted row is on
// the board and still in flight.
var HOW_MANY = 120;
var R = { positions: 0, agreed: 0, arithmeticWouldHaveMissed: 0, worst: null };
outer:
for (var bi = 0; bi < src.boards.length && R.positions < HOW_MANY; bi++) {
    var gb = boardFromString(src.boards[bi]);
    if (!Object.keys(gb.blocks).length) continue;
    var gbase = new LogicalBoard(W, H, 6, gb.grid, gb.blocks);
    var swaps = gbase.legalSwaps();
    for (var s = 0; s < swaps.length; s++) {
        var post = gbase.clone();
        post.swap(swaps[s][0], swaps[s][1]);
        if (bit.resolveBits(post.grid, post.blocks, W, H).scope !== 'garbage-broke') continue;
        var stack = EB.scratch(10);
        EB.paint(stack, post.grid, H, W, paintBlocks(gb.blocks));
        for (var f = 0; f < 600; f++) {
            stack.run();
            var converted = 0, flying = 0, r2, c2, p2;
            for (r2 = 1; r2 <= H; r2++) {
                for (c2 = 1; c2 <= W; c2++) {
                    p2 = stack.panels[r2] && stack.panels[r2][c2];
                    if (!p2 || p2.isGarbage || !p2.color) continue;
                    if (p2.fellFromGarbage) converted++;
                    if (p2.state && p2.state !== 'normal') flying++;
                }
            }
            if (!converted || !flying) continue;

            var snap = snapshot(stack);
            var live = new LogicalBoard(W, H, 6, snap.grid, snap.blocks);
            if (!live.legalSwaps().length) continue outer;
            R.positions++;

            var chosen = decide.bestMove(live, W, H, snap.motion, paintBlocks(snap.blocks));
            if (chosen.decidedBy !== 'engine') {
                console.error('FAIL a board with panels in flight was decided by the arithmetic');
                process.exit(1);
            }
            // What the engine says the chosen move is worth, and the best on offer.
            var truth = decide.rankByEngine(live, W, H, paintBlocks(snap.blocks), 10);
            var bestScore = truth[0].score;
            var chosenScore = null;
            for (var t = 0; t < truth.length; t++) {
                if (truth[t].swap[0] === chosen.best.swap[0] && truth[t].swap[1] === chosen.best.swap[1]) {
                    chosenScore = truth[t].score; break;
                }
            }
            if (chosenScore === bestScore) R.agreed++;
            else if (!R.worst) {
                R.worst = { board: bi, frame: f, chose: chosen.best.swap,
                            worth: chosenScore, best: bestScore };
            }
            // And what the arithmetic alone would have picked, to say what this buys.
            var arith = decide.rankByArithmetic(live, W, H);
            var arithScore = null;
            for (t = 0; t < truth.length; t++) {
                if (truth[t].swap[0] === arith[0].swap[0] && truth[t].swap[1] === arith[0].swap[1]) {
                    arithScore = truth[t].score; break;
                }
            }
            if (arithScore !== bestScore) R.arithmeticWouldHaveMissed++;
            continue outer;
        }
    }
}
console.log('  panels in flight    ' + String(R.positions).padStart(5) +
            '   decided by the engine, matching its own best: ' + R.agreed);
console.log('  the arithmetic alone would have missed on ' + R.arithmeticWouldHaveMissed +
            ' of those ' + R.positions);
if (R.agreed !== R.positions) {
    console.error('FAIL the engine-decided move was not the engine best: ' + JSON.stringify(R.worst));
    process.exit(1);
}
if (!R.positions) { console.error('FAIL no mid-conversion position was ever found'); process.exit(1); }
// If the arithmetic never lost, the whole detour is dead weight and should go.
if (!R.arithmeticWouldHaveMissed) {
    console.error('FAIL the arithmetic alone was right every time — this switch earns nothing');
    process.exit(1);
}

console.log('bitdecide: ' + settled + ' settled boards on the arithmetic with no engine built, ' +
            R.positions + ' in flight on the engine, ' + R.arithmeticWouldHaveMissed +
            ' of which the arithmetic alone would have got wrong');
