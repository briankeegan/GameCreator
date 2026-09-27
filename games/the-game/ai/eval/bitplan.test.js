#!/usr/bin/env node
// A PLAN THAT CLAIMS A CHAIN HAS TO PLAY ONE.
//
//   node bitplan.test.js
//
// bestSetup names two swaps and the chain they are worth. The check is not that
// the arithmetic agrees with itself: both swaps are played onto a real
// PanelEngine.Stack, in order, and the engine's own chain counter and cleared
// count have to be the numbers that were claimed.
//
// AND THE SECOND PLY HAS TO EARN ITS PLACE. A planner that never finds anything
// the first ply missed is a planner nobody needs, so the sweep counts the boards
// where looking a move further finds a deeper chain, and fails if there are
// none.
var path = require('path');
var fs = require('fs');
var ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'panel-engine.js'));
require(path.join(ROOT, 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var EB = require('./engineboard.js');
var plan = require('./bitplan.js');
var W = 6, H = 12;

// capture_boards.js writes row 1 (the floor) first, W chars per row. A digit is
// a colour, a letter is a garbage cell and names its block.
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
function paintBlocks(bl) { var o = {}; for (var k in bl) o[k] = bl[k].cells; return o; }

var src = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));
var HOW_MANY = 600;
var stack = EB.scratch(10);

function sweep(planner) {
    var out = { boards: 0, deeper: 0, verified: 0, wrong: 0, claimed: {}, worst: null };
    for (var i = 0; i < HOW_MANY && i < src.boards.length; i++) {
        var b = boardFromString(src.boards[i]);
        var base = new LogicalBoard(W, H, 6, b.grid, b.blocks);
        var now = plan.bestNow(base, W, H);
        var two = planner(base, W, H);
        out.boards++;
        if (!(two.chain > now.chain)) continue;
        out.deeper++;
        out.claimed[two.chain] = (out.claimed[two.chain] || 0) + 1;

        // Play it: the setup, then the payoff, on the engine itself.
        var mid = base.clone();
        mid.swap(two.setup[0], two.setup[1]);
        mid._applyGravity();
        var fired = mid.clone();
        fired.swap(two.fire[0], two.fire[1]);
        EB.paint(stack, fired.grid, H, W, paintBlocks(b.blocks));
        var t = EB.settle(stack, 900);
        if (t.chainLength === two.chain && t.clearedPanels === two.total) { out.verified++; continue; }
        out.wrong++;
        if (!out.worst) {
            out.worst = { board: i, setup: two.setup, fire: two.fire,
                          claimed: two.chain + ' chain, ' + two.total + ' cleared',
                          engine: t.chainLength + ' chain, ' + t.clearedPanels + ' cleared' };
        }
    }
    return out;
}

var R = sweep(plan.bestSetup);
console.log('  boards swept                    ' + String(R.boards).padStart(5));
console.log('  a setup beats playing now       ' + String(R.deeper).padStart(5) +
            '   depths claimed ' + JSON.stringify(R.claimed));
console.log('  played on the engine, correct   ' + String(R.verified).padStart(5) +
            (R.wrong ? '   ' + R.wrong + ' WRONG' : ''));
if (R.wrong) { console.error('FAIL a plan did not play out: ' + JSON.stringify(R.worst)); process.exit(1); }
if (!R.deeper) { console.error('FAIL the second ply never found anything the first missed'); process.exit(1); }

// AND IT CAN FAIL. The board the second swap is chosen on is the SETTLED board
// the first swap leaves — a swap can drop a panel into a hole, and choosing on
// the unsettled board picks a move for a position that never exists.
var realSetup = plan.bestSetup;
function unsettled(board, W2, H2) {
    var bit = require('./bitmatch.js');
    var swaps = board.legalSwaps(), best = { chain: 0, total: 0, setup: null, fire: null };
    var st = bit.maskState(board.grid, board.blocks, W2, H2);
    for (var i = 0; i < swaps.length; i++) {
        if (!bit.swapMasks(st, swaps[i][0], swaps[i][1])) continue;
        var first = bit.resolveFromMasks(st);
        bit.swapMasks(st, swaps[i][0], swaps[i][1]);
        if (first.scope !== 'ok' || first.total !== 0) continue;
        var mid = board.clone();
        mid.swap(swaps[i][0], swaps[i][1]);          // and NO settle
        var st2 = bit.maskState(mid.grid, mid.blocks, W2, H2), next = mid.legalSwaps();
        for (var j = 0; j < next.length; j++) {
            if (!bit.swapMasks(st2, next[j][0], next[j][1])) continue;
            var r = bit.resolveFromMasks(st2);
            bit.swapMasks(st2, next[j][0], next[j][1]);
            if (r.scope !== 'ok') continue;
            var cand = { chain: r.chain, total: r.total, setup: swaps[i], fire: next[j] };
            if (plan.better(cand, best)) best = cand;
        }
    }
    return best;
}
var broken = sweep(unsettled);
console.log('  break: ' + 'the setup board is not settled'.padEnd(34) +
            (broken.wrong ? broken.wrong + ' cases caught it' : 'NOT CAUGHT'));
if (!broken.wrong) {
    console.error('FAIL choosing on an unsettled board went unnoticed');
    process.exit(1);
}

console.log('bitplan: ' + R.verified + ' plans named two swaps and played out on the engine exactly');
