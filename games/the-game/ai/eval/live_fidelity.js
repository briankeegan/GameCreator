#!/usr/bin/env node
// SAME BOARD IN, SAME BOARD OUT — on a board that is still moving.
//
//   node live_fidelity.js [weights.json] [seeds]
//
// Exits nonzero on any disagreement.
//
// resolve_fidelity.js asks this of settled positions and they agree. The bot
// never decides on a settled position: panels are falling, a cascade is
// running, garbage is breaking. This asks it there.
//
// At the instant of a swap: snapshot, apply the same swap in LogicalBoard,
// resolve to a final grid. Then let the ENGINE run until it settles and
// snapshot again. The two grids must match.
//
// Cases where a row rose or garbage landed during the settle are DISCARDED,
// not counted as disagreements — the simulation was never told about those.
var path = require('path');
var DIR = __dirname;
require(path.join(DIR, '..', '..', 'panel-engine.js'));
require(path.join(DIR, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require(path.join(DIR, 'puyocpu.js'));
var SEEDS = require(path.join(DIR, 'seeds.js'));
var arg = process.argv[2];
var snapWeights = arg ? (require(path.resolve(arg)).weights || {}) : {};

var R = { compared: 0, agree: 0, disagree: 0, skipped: 0, cells: 0, examples: [] };

function settled(stack) {
    if (stack.currentChain) return false;
    for (var r = 0; r <= stack.height; r++) {
        for (var c = 1; c <= PanelEngine.WIDTH; c++) {
            var p = stack.panelAt(r, c);
            if (!p || p.color === 0) continue;
            var st = p.state;
            if (st === 'falling' || st === 'hovering' || st === 'swapping' ||
                st === 'matched' || st === 'popping' || st === 'popped') return false;
        }
    }
    return true;
}
function gridOf(board) {
    var out = [];
    for (var r = 1; r <= board.height; r++) out.push(board.grid[r].slice(1).join(','));
    return out.join('|');
}

var seeds = SEEDS.HOLDOUT.slice(0, Number(process.argv[3] || 3));
seeds.forEach(function (seed) {
    var stacks = [ new PanelEngine.Stack({ level: 10, seed: seed, countdown: false }),
                   new PanelEngine.Stack({ level: 10, seed: seed, countdown: false }) ];
    function mk(st) {
        return new PuyoCpu(st, { weights: snapWeights, reaction: 12, depth: 2, beam: 0,
                                 rise: true, density: false, modes: true });
    }
    var cpus = [ mk(stacks[0]), mk(stacks[1]) ];
    cpus[0].opponent = stacks[1]; cpus[1].opponent = stacks[0];

    var open = null;
    var orig = stacks[0].doSwap;
    stacks[0].doSwap = function (row, col) {
        // A SECOND SWAP INSIDE THE WINDOW IS NOT WHAT WAS PREDICTED. The bot
        // keeps playing while the engine settles, and the simulation was
        // asked about one swap on one board.
        if (open) { open.dirty = true; }
        else {
            var b = cpus[0]._snapshot().clone();
            b.swap(row, col);
            var pred = b.resolve();
            var states = [];
            for (var rr = 1; rr <= this.height; rr++) {
                var cells = [];
                for (var cc = 1; cc <= PanelEngine.WIDTH; cc++) {
                    var pp = this.panelAt(rr, cc);
                    cells.push(!pp || pp.color === 0 ? '.' :
                             pp.isGarbage ? 'G' : (pp.state || '?').slice(0, 4));
                }
                states.push(cells.join(' '));
            }
            open = { predicted: gridOf(b), predLinks: pred.chainLength || 0,
                     engLinks: 0, dirty: false, since: 0,
                     before: gridOf(cpus[0]._snapshot()), swap: row + ',' + col,
                     states: states, chain: !!this.currentChain };
        }
        return orig.call(this, row, col);
    };

    for (var f = 0; f < 21600; f++) {
        cpus[0].update(); cpus[1].update();
        stacks[0].run(); stacks[1].run();
        for (var i = 0; i < 2; i++) {
            var out = stacks[i].takeDeliverableGarbage();
            if (out && out.length) { if (i === 1 && open) open.dirty = true; stacks[i ^ 1].receiveGarbage(out); }
        }
        var evs = stacks[0].drainEvents();
        stacks[1].drainEvents();
        if (open) {
            for (var q = 0; q < evs.length; q++) {
                var t = evs[q].type;
                // THE CASCADE'S OWN LENGTH, from the engine. The grid says
                // which panels went; this says what the engine PAID for them,
                // and the reach measurements are built on it.
                if (t === 'chainEnd') open.engLinks = evs[q].length;
                else if (t === 'match' && !evs[q].chain && !open.engLinks) open.engLinks = 1;
                // The simulation was told about none of these.
                if (t === 'newRow' || t === 'garbageDrop' || t === 'garbageLand') open.dirty = true;
            }
            open.since++;
            // SETTLED FOR A WHILE, NOT SETTLED FOR AN INSTANT.
            //
            // Sampling on the first settled frame reports the engine leaving
            // three of a colour in a column, which it never does. Every
            // "disagreement" this tool found before the wait was the harness,
            // not the bot: 272 of 272 agree once it samples a moment that
            // actually exists. Inside a frame
            // there is a window where a swap has completed and checkMatches
            // has not run yet: every panel reads normal and a match that is
            // about to fire has not fired. Sampling there reports the engine
            // leaving three in a column, which it never does.
            open.stable = settled(stacks[0]) ? (open.stable || 0) + 1 : 0;
            if (open.since > 2 && open.stable >= 8) {
                if (open.dirty) R.skipped++;
                else {
                    R.compared++;
                    var actual = gridOf(cpus[0]._snapshot());
                    var sameGrid = actual === open.predicted;
                    var sameLinks = (open.predLinks || 0) === (open.engLinks || 0);
                    if (!sameLinks) R.linksDiffer = (R.linksDiffer || 0) + 1;
                    if (sameGrid && sameLinks) R.agree++;
                    else {
                        R.disagree++;
                        open.why = (sameGrid ? '' : 'grid ') + (sameLinks ? '' : 'links');
                        if (R.examples.length < 3) {
                            R.examples.push(open), open.actual = actual;
                        }
                    }
                }
                open = null;
            }
        }
        if (stacks[0].gameOver || stacks[1].gameOver) break;
    }
});

console.log('compared   ' + R.compared);
console.log('agree      ' + R.agree);
console.log('disagree   ' + R.disagree +
            (R.compared ? '   (' + (100 * R.disagree / R.compared).toFixed(1) + '%)' : ''));
console.log('  of which chain length ' + (R.linksDiffer || 0));
console.log('skipped    ' + R.skipped + '   (a row rose, garbage arrived, or the bot swapped again mid-settle)');
process.exitCode = R.disagree ? 1 : 0;
R.examples.slice(0, 1).forEach(function (e, i) {
    console.log('\n--- disagreement ' + (i + 1) + '   swap at ' + e.swap +
                '   cascade already running: ' + e.chain + ' ---');
    var B = e.before.split('|'), P = e.predicted.split('|'), A = e.actual.split('|');
    console.log('row   board the sim was given      panel states                    sim predicts        engine settled');
    for (var r = B.length - 1; r >= 0; r--) {
        console.log(String(r + 1).padStart(3) + '   ' + B[r].padEnd(24) + '  ' +
                    (e.states[r] || '').padEnd(30) + ' ' + P[r].padEnd(19) +
                    ' ' + A[r] + (P[r] === A[r] ? '' : '   <-'));
    }
});
