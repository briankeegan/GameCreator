#!/usr/bin/env node
// A PLAN MADE IN THE WINDOW HAS TO PLAY OUT IN THE GAME.
//
//   node bitlineup.test.js
//
// bitlineup watches for the moment a broken slab hands over real colours while
// its panels are still in the air, measures how long they stay there, and picks
// the best swap reachable in that time.
//
// The check is not that it agrees with itself. Every position is found by
// PLAYING the real game until a slab's colours appear; the chosen swap is then
// played on a real PanelEngine.Stack — waiting the same number of frames the
// plan said the cursor needed — and the engine's own chain counter has to be
// the number the plan claimed.
//
// AND THE WINDOW HAS TO EARN ITS PLACE. If lining up never beat standing still,
// this file would be dead weight, so a sweep where nothing improves fails.
var path = require('path');
var fs = require('fs');
var ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'panel-engine.js'));
require(path.join(ROOT, 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var EB = require('./engineboard.js');
var bit = require('./bitmatch.js');
var lineup = require('./bitlineup.js');
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

// A slab's geometry goes in whatever its state: once part of it has popped, its
// offsets cannot be recovered from a bounding box.
function snapshot(stack) {
    var grid = [], blocks = {}, motion = [], chaining = [], r, c;
    for (r = 0; r <= H; r++) {
        grid[r] = []; motion[r] = []; chaining[r] = [];
        for (c = 1; c <= W; c++) { grid[r][c] = 0; motion[r][c] = null; chaining[r][c] = false; }
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
            } else { grid[r][c] = p.color || 0; }
            chaining[r][c] = !!p.chaining;
            if ((p.state && p.state !== 'normal') || p.timer || p.isGarbage) {
                motion[r][c] = {
                    state: p.state, timer: p.timer, initialTime: p.initialTime,
                    popTime: p.popTime, popIndex: p.popIndex, comboIndex: p.comboIndex,
                    comboSize: p.comboSize, fellFromGarbage: p.fellFromGarbage,
                    matchAnyway: !!p.matchAnyway, xOffset: p.xOffset, yOffset: p.yOffset,
                    gWidth: p.gWidth, gHeight: p.gHeight
                };
            }
        }
    }
    return { grid: grid, blocks: blocks, motion: motion, chaining: chaining };
}

function gridOf(stack) {
    var g = [];
    for (var r = 0; r <= H; r++) {
        g[r] = [];
        for (var c = 1; c <= W; c++) {
            var p = stack.panels[r] && stack.panels[r][c];
            g[r][c] = !p ? 0 : (p.isGarbage ? -2 : (p.color || 0));
        }
    }
    return g;
}

var src = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));
var HOW_MANY = 100;
var R = { positions: 0, planned: 0, improved: 0, verified: 0, wrong: 0,
          refused: 0, gains: {}, worst: null };

outer:
for (var i = 0; i < src.boards.length && R.positions < HOW_MANY; i++) {
    var b = boardFromString(src.boards[i]);
    if (!Object.keys(b.blocks).length) continue;
    var base = new LogicalBoard(W, H, 6, b.grid, b.blocks);
    var swaps = base.legalSwaps();
    for (var s = 0; s < swaps.length; s++) {
        var post = base.clone();
        post.swap(swaps[s][0], swaps[s][1]);
        if (bit.resolveBits(post.grid, post.blocks, W, H).scope !== 'garbage-broke') continue;

        // Play until the slab has handed over its colours and they are airborne.
        var stack = EB.scratch(10);
        EB.paint(stack, post.grid, H, W, paintBlocks(b.blocks));
        var at = -1;
        for (var f = 0; f < 600; f++) {
            stack.run();
            var conv = 0, fly = 0, rr, cc, pp;
            for (rr = 1; rr <= H; rr++) {
                for (cc = 1; cc <= W; cc++) {
                    pp = stack.panels[rr][cc];
                    if (!pp || pp.isGarbage || !pp.color) continue;
                    if (pp.fellFromGarbage) conv++;
                    if (pp.state && pp.state !== 'normal') fly++;
                }
            }
            if (conv && fly) { at = f; break; }
        }
        if (at < 0) continue;

        var snap = snapshot(stack);
        var live = new LogicalBoard(W, H, 6, gridOf(stack), snap.blocks);
        var cursor = [stack.curRow || 1, stack.curCol || 1];
        var plan = lineup.bestInWindow(snap, stack.frames, H, cursor, live.legalSwaps());
        R.positions++;
        if (!plan) { console.error('FAIL a mid-conversion position was not recognised'); process.exit(1); }
        if (!plan.best.swap) continue outer;               // standing still was best
        R.planned++;
        var gain = plan.best.chain - (plan.doNothing ? plan.doNothing.chain : 0);
        if (gain > 0) { R.improved++; R.gains[gain] = (R.gains[gain] || 0) + 1; }

        // PLAY THE PLAN ON THE REAL ENGINE: wait the frames the cursor needed,
        // then swap, then let it finish.
        var real = EB.scratch(10);
        EB.paint(real, post.grid, H, W, paintBlocks(b.blocks));
        for (f = 0; f <= at; f++) real.run();
        for (f = 0; f < plan.best.cost; f++) real.run();
        if (!real.canSwap(plan.best.swap[0], plan.best.swap[1])) { R.refused++; continue outer; }
        real.doSwap(plan.best.swap[0], plan.best.swap[1]);
        var peak = 0, clearedBefore = real.panelsCleared || 0;
        for (f = 0; f < 900; f++) {
            real.run();
            if (real.chainCounter > peak) peak = real.chainCounter;
        }
        // THE TWO CHAIN COUNTS ARE NOT THE SAME NUMBER. The engine's counter is
        // 0 for a plain combo and only starts at 2 for a real chain; the
        // resolvers report rounds, so that same combo is 1. They agree from 2
        // up. Compared in the resolvers' units.
        var engineCleared = (real.panelsCleared || 0) - clearedBefore;
        var engineChain = peak >= 2 ? peak : (engineCleared > 0 ? 1 : 0);
        if (engineChain === plan.best.chain) { R.verified++; continue outer; }
        R.wrong++;
        if (!R.worst) {
            R.worst = { board: i, swap: plan.best.swap, cost: plan.best.cost,
                        window: plan.window, claimed: plan.best.chain,
                        engine: engineChain, engineCleared: engineCleared,
                        claimedCleared: plan.best.total };
        }
        continue outer;
    }
}

console.log('  positions in the window ' + String(R.positions).padStart(4));
console.log('  a swap beat standing still ' + String(R.improved).padStart(3) +
            '   deeper by ' + JSON.stringify(R.gains));
console.log('  played on the engine       ' + String(R.verified).padStart(3) + ' correct' +
            (R.wrong ? ', ' + R.wrong + ' WRONG' : '') +
            (R.refused ? ', ' + R.refused + ' no longer legal' : ''));

if (R.wrong) { console.error('FAIL a plan did not play out: ' + JSON.stringify(R.worst)); process.exit(1); }
if (!R.positions) { console.error('FAIL no position with revealed colours was found'); process.exit(1); }
if (!R.improved) {
    console.error('FAIL lining up never beat standing still — this earns nothing');
    process.exit(1);
}

// AND IT CAN FAIL. The window is what makes the plan playable: ignore the
// cursor's travel and the plan names swaps there is no time to reach.
var realCost = require('./travel.js').cost;
var freeTravel = Object.create(null);
var lineupFree = require('./bitlineup.js');
var savedWindow = lineupFree.windowFrames;
lineupFree.windowFrames = function () { return 0; };   // no time at all
var starved = 0;
for (var z = 0; z < src.boards.length && starved < 1; z++) {
    var zb = boardFromString(src.boards[z]);
    if (!Object.keys(zb.blocks).length) continue;
    var zbase = new LogicalBoard(W, H, 6, zb.grid, zb.blocks);
    var zsw = zbase.legalSwaps();
    for (var zs = 0; zs < zsw.length; zs++) {
        var zp = zbase.clone();
        zp.swap(zsw[zs][0], zsw[zs][1]);
        if (bit.resolveBits(zp.grid, zp.blocks, W, H).scope !== 'garbage-broke') continue;
        var zstack = EB.scratch(10);
        EB.paint(zstack, zp.grid, H, W, paintBlocks(zb.blocks));
        for (var zf = 0; zf < 600; zf++) {
            zstack.run();
            var zc = 0, zy = 0, ar, ac, ap;
            for (ar = 1; ar <= H; ar++) for (ac = 1; ac <= W; ac++) {
                ap = zstack.panels[ar][ac];
                if (!ap || ap.isGarbage || !ap.color) continue;
                if (ap.fellFromGarbage) zc++;
                if (ap.state && ap.state !== 'normal') zy++;
            }
            if (zc && zy) break;
        }
        var zsnap = snapshot(zstack);
        var zlive = new LogicalBoard(W, H, 6, gridOf(zstack), zsnap.blocks);
        var zplan = lineupFree.bestInWindow(zsnap, zstack.frames, H,
                                            [zstack.curRow || 1, zstack.curCol || 1],
                                            zlive.legalSwaps());
        if (zplan && zplan.reachable === 0) starved++;
        break;
    }
}
lineupFree.windowFrames = savedWindow;
console.log('  break: ' + 'a window of no frames reaches nothing'.padEnd(38) +
            (starved ? 'caught' : 'NOT CAUGHT'));
if (!starved) {
    console.error('FAIL swaps were still considered with no time to reach them');
    process.exit(1);
}

console.log('bitlineup: ' + R.verified + ' plans made from colours that had just appeared, ' +
            'played on the engine exactly, ' + R.improved + ' of them deeper than standing still');
