#!/usr/bin/env node
// THE CLOCK KEEPS TIME WITH THE ENGINE, FRAME BY FRAME.
//
//   node bitframes.test.js
//
// bitframes.js is a THIRD implementation of rules the engine and LogicalBoard
// already have, which is only safe if drift cannot land quietly. So this does
// not compare the answer at the end: it steps a real PanelEngine.Stack, the
// same board on the server's rules (pa-engine.js), and bitframes together,
// one frame at a time, and compares EVERY panel's colour, state and timer
// after every frame. The frame they first differ on is the
// frame the failure names.
//
// Three sweeps:
//
//   1. Swaps that clear something, on settled boards. The ordinary case.
//   2. The same, on boards carrying garbage, where slabs bridge and fall.
//   3. Positions caught MID-CONVERSION — a slab has broken, its bottom row has
//      taken real colours and is still hovering. This is the case a still
//      picture cannot answer and the reason the clock exists, so it is checked
//      on what the engine actually clears from there, not only on lockstep.
//
// A run that would have to INVENT a colour stops instead. A row of a broken
// slab draws its colours from the engine's rng; those are not on the board, so
// the run reports 'garbage-broke' and gets counted as refused, never guessed.
var path = require('path');
var fs = require('fs');
var ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'panel-engine.js'));
require(path.join(ROOT, 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var EB = require('./engineboard.js');
var BF = require('./bitframes.js');
var PA = require('./pa-engine.js');
var bit = require('./bitmatch.js');
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

// The board as a planner reads it: colours, slabs, the chaining flag, and the
// per-panel state and timer for anything the engine still has in flight. A
// slab's geometry goes in whatever its state, because a settled slab's offsets
// cannot be recovered from a bounding box once part of it has popped.
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
            } else {
                grid[r][c] = p.color || 0;
            }
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

// One comparable string per cell, so a divergence names a cell and not a diff.
function cellsOf(get) {
    var out = [];
    for (var r = 1; r <= H; r++) {
        for (var c = 1; c <= W; c++) {
            var p = get(r, c);
            if (!p) { out.push('-'); continue; }
            var empty = p.color === 0 && !p.isGarbage;
            out.push((p.isGarbage ? 'G' : (p.color || 0)) + ':' + (empty ? '' : p.state) + ':' + (p.timer || 0));
        }
    }
    return out;
}

var src = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));

// THE SAME BOARD ON THE SERVER'S RULES. The Lua looks for a match only around a
// panel whose state changed this frame (a swap ending, a landing, a new row);
// a painted board is one where every panel has just arrived, so every panel is
// flagged. panel-engine.js looks everywhere, which comes to the same thing.
function serverOf(stack) {
    var s = PA.fromPanelEngine(stack);
    for (var r = 1; r < s.panels.length; r++) for (var c = 1; c <= W; c++) if (s.panels[r][c].color) s.panels[r][c].stateChanged = true;
    return s;
}

// --------------------------------------------------------------------------
// 1 and 2: lockstep from a settled board, with and without garbage.
function lockstep(wantGarbage, howMany, frames) {
    var out = { cases: 0, inStep: 0, diverged: 0, refused: 0, worst: null };
    outer:
    for (var i = 0; i < src.boards.length && out.cases < howMany; i++) {
        var b = boardFromString(src.boards[i]);
        var hasGarbage = Object.keys(b.blocks).length > 0;
        if (hasGarbage !== wantGarbage) continue;
        var base = new LogicalBoard(W, H, 6, b.grid, b.blocks);
        var swaps = base.legalSwaps();
        for (var s = 0; s < swaps.length; s++) {
            var post = base.clone();
            post.swap(swaps[s][0], swaps[s][1]);
            var quick = bit.resolveBits(post.grid, post.blocks, W, H);
            if (quick.total === 0) continue;                 // nothing happens, nothing to compare
            var stack = EB.scratch(10);
            EB.paint(stack, post.grid, H, W, paintBlocks(b.blocks));
            var mine = BF.build(snapshot(stack), stack.frames, H);
            var server = serverOf(stack);
            out.cases++;
            var refused = false, diverged = null;
            for (var f = 1; f <= frames; f++) {
                stack.run();
                server.run();
                BF.step(mine);
                if (mine.brokeGarbage) { refused = true; break; }
                var m = cellsOf(function (r, c) { return mine.panels[r][c]; });
                [['engine', stack], ['server', server]].forEach(function (e) {
                    if (diverged) return;
                    var a = cellsOf(function (r, c) { return e[1].panels[r] && e[1].panels[r][c]; });
                    for (var k = 0; k < a.length; k++) {
                        if (a[k] === m[k]) continue;
                        diverged = { against: e[0], board: i, swap: swaps[s], frame: f,
                                     cell: 'r' + (Math.floor(k / W) + 1) + 'c' + (k % W + 1),
                                     engine: a[k], mine: m[k] };
                        break;
                    }
                });
                if (diverged) break;
            }
            if (refused) out.refused++;
            else if (diverged) { out.diverged++; if (!out.worst) out.worst = diverged; }
            else out.inStep++;
            continue outer;
        }
    }
    return out;
}

var plain = lockstep(false, 300, 300);
console.log('  settled, no garbage ' + String(plain.cases).padStart(5) + ' cases  ' +
            plain.inStep + ' in step, ' + plain.refused + ' refused' +
            (plain.diverged ? ', ' + plain.diverged + ' DIVERGED' : ''));
if (plain.diverged) { console.error('FAIL ' + JSON.stringify(plain.worst)); process.exit(1); }
if (!plain.inStep) { console.error('FAIL nothing was actually compared'); process.exit(1); }

var garb = lockstep(true, 200, 300);
console.log('  settled, with garbage' + String(garb.cases).padStart(4) + ' cases  ' +
            garb.inStep + ' in step, ' + garb.refused + ' refused' +
            (garb.diverged ? ', ' + garb.diverged + ' DIVERGED' : ''));
if (garb.diverged) { console.error('FAIL ' + JSON.stringify(garb.worst)); process.exit(1); }
if (!garb.refused) {
    console.error('FAIL no garbage case ever refused — the rng guard is not being exercised');
    process.exit(1);
}

// --------------------------------------------------------------------------
// 3: mid-conversion, which is the whole point.
var MID = 150;
var R = { positions: 0, inStep: 0, refused: 0, diverged: 0, clearedRight: 0, worst: null };
outer2:
for (var bi = 0; bi < src.boards.length && R.positions < MID; bi++) {
    var gb = boardFromString(src.boards[bi]);
    if (!Object.keys(gb.blocks).length) continue;
    var gbase = new LogicalBoard(W, H, 6, gb.grid, gb.blocks);
    var gsw = gbase.legalSwaps();
    for (var gs = 0; gs < gsw.length; gs++) {
        var gpost = gbase.clone();
        gpost.swap(gsw[gs][0], gsw[gs][1]);
        if (bit.resolveBits(gpost.grid, gpost.blocks, W, H).scope !== 'garbage-broke') continue;
        var st2 = EB.scratch(10);
        EB.paint(st2, gpost.grid, H, W, paintBlocks(gb.blocks));
        for (var ff = 0; ff < 600; ff++) {
            st2.run();
            var converted = 0, flying = 0, rr, cc, pp;
            for (rr = 1; rr <= H; rr++) {
                for (cc = 1; cc <= W; cc++) {
                    pp = st2.panels[rr] && st2.panels[rr][cc];
                    if (!pp || pp.isGarbage || !pp.color) continue;
                    if (pp.fellFromGarbage) converted++;
                    if (pp.state && pp.state !== 'normal') flying++;
                }
            }
            if (!converted || !flying) continue;

            R.positions++;
            var mine2 = BF.build(snapshot(st2), st2.frames, H), server2 = PA.fromPanelEngine(st2);  // mid-play: its flags are the engine's own
            var before = 0;
            for (rr = 1; rr <= H; rr++) for (cc = 1; cc <= W; cc++) {
                pp = st2.panels[rr][cc];
                if (pp && pp.color && !pp.isGarbage) before++;
            }
            var refused2 = false, diverged2 = null;
            for (var k2 = 0; k2 < 400; k2++) {
                st2.run();
                server2.run();
                BF.step(mine2);
                if (mine2.brokeGarbage) { refused2 = true; break; }
                var m2 = cellsOf(function (r, c) { return mine2.panels[r][c]; });
                [['engine', st2], ['server', server2]].forEach(function (e) {
                    if (diverged2) return;
                    var a2 = cellsOf(function (r, c) { return e[1].panels[r] && e[1].panels[r][c]; });
                    for (var j = 0; j < a2.length; j++) {
                        if (a2[j] === m2[j]) continue;
                        diverged2 = { against: e[0], board: bi, frame: k2,
                                      cell: 'r' + (Math.floor(j / W) + 1) + 'c' + (j % W + 1),
                                      engine: a2[j], mine: m2[j] };
                        break;
                    }
                });
                if (diverged2) break;
            }
            if (refused2) { R.refused++; continue outer2; }
            if (diverged2) { R.diverged++; if (!R.worst) R.worst = diverged2; continue outer2; }
            R.inStep++;
            var after = 0;
            for (rr = 1; rr <= H; rr++) for (cc = 1; cc <= W; cc++) {
                pp = st2.panels[rr][cc];
                if (pp && pp.color && !pp.isGarbage) after++;
            }
            if (mine2.panelsCleared === before - after) R.clearedRight++;
            continue outer2;
        }
    }
}
console.log('  mid-conversion      ' + String(R.positions).padStart(5) + ' positions  ' +
            R.inStep + ' in step, ' + R.refused + ' refused' +
            (R.diverged ? ', ' + R.diverged + ' DIVERGED' : '') +
            ', cleared count right on ' + R.clearedRight);
if (R.diverged) { console.error('FAIL ' + JSON.stringify(R.worst)); process.exit(1); }
if (!R.positions) { console.error('FAIL no mid-conversion position was found'); process.exit(1); }
if (R.clearedRight !== R.inStep) {
    console.error('FAIL a position kept in step but reported the wrong cleared count');
    process.exit(1);
}

// --------------------------------------------------------------------------
// AND IT CAN FAIL. Garbage rests when ANY column under the whole slab is
// blocked, and an EMPTY cell under it holds nothing up. Treating empty as
// support leaves a slab hanging where the engine drops it.
var realSupport = BF.settle;
console.log('  break: ' + 'lockstep notices a one-frame slip'.padEnd(34) + 'checked below');
var slipped = 0;
for (var si = 0; si < 60; si++) {
    var sb = boardFromString(src.boards[si]);
    if (Object.keys(sb.blocks).length) continue;
    var sbase = new LogicalBoard(W, H, 6, sb.grid, sb.blocks);
    var ssw = sbase.legalSwaps();
    for (var ss = 0; ss < ssw.length; ss++) {
        var sp = sbase.clone();
        sp.swap(ssw[ss][0], ssw[ss][1]);
        if (bit.resolveBits(sp.grid, sp.blocks, W, H).total === 0) continue;
        var sstack = EB.scratch(10);
        EB.paint(sstack, sp.grid, H, W, {});
        var smine = BF.build(snapshot(sstack), sstack.frames, H);
        // one frame of head start is a defect lockstep must catch
        BF.step(smine);
        var caught = false;
        for (var sf = 1; sf <= 200 && !caught; sf++) {
            sstack.run(); BF.step(smine);
            var sa = cellsOf(function (r, c) { return sstack.panels[r] && sstack.panels[r][c]; });
            var sm = cellsOf(function (r, c) { return smine.panels[r][c]; });
            for (var sk = 0; sk < sa.length; sk++) if (sa[sk] !== sm[sk]) { caught = true; break; }
        }
        if (caught) slipped++;
        break;
    }
}
console.log('  break: ' + 'a frame of head start'.padEnd(34) + slipped + ' cases caught it');
if (!slipped) { console.error('FAIL lockstep did not notice a board running a frame ahead'); process.exit(1); }

console.log('bitframes: ' + (plain.inStep + garb.inStep + R.inStep) +
            ' runs kept frame-for-frame time with the engine, ' +
            (plain.refused + garb.refused + R.refused) + ' refused rather than invent a colour');
