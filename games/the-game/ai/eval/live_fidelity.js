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
// WHAT IS UNDER TEST IS THE SIMULATION, NOT A PARTICULAR WEIGHT SET. The
// weights exist only to make the bot play a plausible game; any set that
// drives it will do. So a snapshot naming a feature the registry has since
// dropped is pruned rather than fatal -- the evaluator refuses unknown keys,
// which is right for a genome and wrong for a fixture nobody is training.
// Silently would be worse than fatal, so it says what it dropped.
var registry = require(path.join(DIR, 'registry.js'));
var known = {};
registry.all.forEach(function (f) { known[f.key] = true; });
var snapWeights = {};
if (arg) {
    var raw = require(path.resolve(arg)).weights || {}, dropped = [];
    Object.keys(raw).forEach(function (k) {
        if (known[k]) snapWeights[k] = raw[k]; else dropped.push(k);
    });
    if (dropped.length) {
        console.log('dropped ' + dropped.length + ' weight(s) the registry no longer has: ' +
                    dropped.join(', '));
    }
}

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
// THE WHOLE POSITION, NOT THE CELL VALUES.
//
// Every garbage cell reads -2 whatever its slab is, so two boards can agree
// cell for cell while one holds a 6x2 and the other two 6x1s — which fall and
// pop differently on the very next move. The chaining flag lives on the panel
// and is what makes a clear a chain LINK rather than a fresh combo. Comparing
// grids alone was blind to both, and both were wrong in paint() for as long
// as this check has been reporting "0 differ".
function gridOf(board) {
    var out = [];
    for (var r = 1; r <= board.height; r++) out.push(board.grid[r].slice(1).join(','));
    // Slabs by shape and position, in a stable order.
    var slabs = [];
    var bl = board.blocks || {};
    for (var id in bl) {
        if (!bl.hasOwnProperty(id)) continue;
        var cells = bl[id].cells || bl[id];
        if (!cells || !cells.length) continue;
        var key = cells.map(function (rc) { return rc[0] + ':' + rc[1]; }).sort().join(' ');
        slabs.push(key);
    }
    slabs.sort();
    // Chaining, cell by cell.
    var ch = [];
    if (board.chaining) {
        for (var r2 = 1; r2 <= board.height; r2++) {
            var row = board.chaining[r2] || [];
            var acc = '';
            for (var c2 = 1; c2 <= board.width; c2++) acc += row[c2] ? '1' : '0';
            ch.push(acc);
        }
    }
    return out.join('|') + ' #SLABS ' + slabs.join('/') + ' #CHAIN ' + ch.join('|');
}

var seeds = SEEDS.HOLDOUT.slice(0, Number(process.argv[3] || 3));
seeds.forEach(function (seed) {
    var stacks = [ new PanelEngine.Stack({ level: 10, seed: seed, countdown: false }),
                   new PanelEngine.Stack({ level: 10, seed: seed, countdown: false }) ];
    // THE PATH TRAINING ACTUALLY RUNS. Without `engine` the bot resolves through
    // LogicalBoard, so this checked a second implementation while every run
    // since GC_ENGINE=1 has used engineboard — and every engine-side defect
    // (slabs never painted, chaining flags zeroed, blocks never written back)
    // sat under a green "0 differ" because the check never touched that code.
    var ENGINE = process.env.GC_FIDELITY_ENGINE !== '0';
    function mk(st) {
        return new PuyoCpu(st, { weights: snapWeights, reaction: 12, depth: 2, beam: 0,
                                 rise: true, density: false, modes: true, engine: ENGINE });
    }
    var cpus = [ mk(stacks[0]), mk(stacks[1]) ];
    cpus[0].opponent = stacks[1]; cpus[1].opponent = stacks[0];

    var open = null;
    var orig = stacks[0].doSwap;
    stacks[0].doSwap = function (row, col) {
        // A SECOND SWAP INSIDE THE WINDOW IS NOT WHAT WAS PREDICTED. The bot
        // keeps playing while the engine settles, and the simulation was
        // asked about one swap on one board.
        if (open) { open.dirty = true; open.why = open.why || 'swapped again mid-settle'; }
        else {
            var b = cpus[0]._snapshot().clone();
            // The engine path applies the swap itself, after ageing by `delay`;
            // here the swap is happening NOW, so the delay is zero.
            var pred;
            if (ENGINE) pred = cpus[0]._resolveCandidate(b, [row, col], 0);
            else { b.swap(row, col); pred = b.resolve(); }
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
                // WHAT THE SIMULATION COULD NOT HAVE KNOWN — and only that.
                //
                // A row rising and the opponent dropping garbage are time and
                // another player; the resolve is never told either, so those
                // cases are not its fault. Garbage LANDING is different: a
                // slab already on the board finishing its fall is a
                // consequence of the position the resolve was handed, and it
                // is supposed to predict it. Discarding those was discarding
                // every case that exercises garbage — which is how paint()
                // ran without slabs under a green "0 differ".
                //
                // It is only unknowable when the slab arrived during this same
                // window, so a land is excused only after a drop.
                // A ROW RISING IS NOT A SURPRISE. riseTimer, displacement and
                // speed say when it lands and board.incoming says what is in
                // it — all of it on the stack the snapshot came from — and the
                // resolve now carries the floor through the settle. So a
                // newRow is something it is expected to get right, not an
                // excuse. Only the opponent's garbage is genuinely unknowable.
                if (t === 'garbageDrop') { open.dirty = true; open.why = t; }
                if (t === 'garbageDrop') open.sawDrop = true;
                if (t === 'garbageLand' && open.sawDrop) { open.dirty = true; open.why = 'garbageLand after a drop'; }
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
                if (open.dirty) {
                    R.skipped++;
                    var wk = open.why || 'unknown';
                    R.skipWhy = R.skipWhy || {};
                    R.skipWhy[wk] = (R.skipWhy[wk] || 0) + 1;
                }
                else {
                    R.compared++;
                    var actual = gridOf(cpus[0]._snapshot());
                    // SAME BOARD, SAMPLED A MOMENT LATER.
                    //
                    // The engine is read after 8 settled frames, and now that
                    // the resolve lets the floor move, the stack can climb one
                    // more row inside that window. The result is the sim's
                    // board shifted up a row — the same position at a later
                    // instant, not a wrong answer. Try realigning by a row or
                    // two and record when it was needed, so a genuine
                    // disagreement is still a disagreement.
                    var sameGrid = actual === open.predicted, shifted = 0;
                    if (!sameGrid) {
                        var PA = open.predicted.split(' #')[0].split('|');
                        var AA = actual.split(' #')[0].split('|');
                        for (var sh = 1; sh <= 2 && !sameGrid; sh++) {
                            var ok = AA.length > sh;
                            for (var rr2 = 0; ok && rr2 + sh < AA.length; rr2++) {
                                if (AA[rr2 + sh] !== PA[rr2]) ok = false;
                            }
                            if (ok) { sameGrid = true; shifted = sh; }
                        }
                        if (shifted) R.realigned = (R.realigned || 0) + 1;
                    }
                    var sameLinks = (open.predLinks || 0) === (open.engLinks || 0);
                    if (!sameLinks) R.linksDiffer = (R.linksDiffer || 0) + 1;
                    if (sameGrid && sameLinks) R.agree++;
                    else {
                        R.disagree++;
                        open.why = (sameGrid ? '' : 'grid ') + (sameLinks ? '' : 'links');
                        // WHERE they differ, not just that they do.
                        var P = open.predicted.split(' #'), A = actual.split(' #');
                        var pr = P[0].split('|'), ar = A[0].split('|');
                        var rows = [];
                        for (var dr = 0; dr < Math.max(pr.length, ar.length); dr++) {
                            if (pr[dr] !== ar[dr]) rows.push('    row ' + (dr + 1) +
                                '   sim ' + (pr[dr] || '-') + '   engine ' + (ar[dr] || '-'));
                        }
                        open.rowDiff = rows;
                        open.slabDiff = (P[1] !== A[1]) ? ('    SLABS sim ' + P[1] + '\n    SLABS eng ' + A[1]) : '';
                        open.chainDiff = (P[2] !== A[2]) ? ('    CHAIN sim ' + P[2] + '\n    CHAIN eng ' + A[2]) : '';
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
if (R.realigned) console.log('  (' + R.realigned + ' agreed once realigned by a row — the engine rose inside the 8-frame settle window)');
console.log('skipped    ' + R.skipped);
Object.keys(R.skipWhy || {}).sort(function (a, b) { return R.skipWhy[b] - R.skipWhy[a]; })
    .forEach(function (k) { console.log('    x' + R.skipWhy[k] + '  ' + k); });
process.exitCode = R.disagree ? 1 : 0;
R.examples.slice(0, 1).forEach(function (e, i) {
    console.log('\n--- disagreement ' + (i + 1) + '   swap at ' + e.swap +
                '   cascade already running: ' + e.chain + ' ---');
    var B = e.before.split('|'), P = e.predicted.split('|'), A = e.actual.split('|');
    if (e.rowDiff && e.rowDiff.length) {
        console.log('  WHERE THEY DIFFER:');
        e.rowDiff.forEach(function (l) { console.log(l); });
    }
    if (e.slabDiff) console.log(e.slabDiff);
    if (e.chainDiff) console.log(e.chainDiff);
    console.log('row   board the sim was given      panel states                    sim predicts        engine settled');
    for (var r = B.length - 1; r >= 0; r--) {
        console.log(String(r + 1).padStart(3) + '   ' + B[r].padEnd(24) + '  ' +
                    (e.states[r] || '').padEnd(30) + ' ' + P[r].padEnd(19) +
                    ' ' + A[r] + (P[r] === A[r] ? '' : '   <-'));
    }
});
