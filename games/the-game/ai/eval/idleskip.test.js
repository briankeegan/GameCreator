#!/usr/bin/env node
// THE SKIP CHANGES NOTHING BUT THE TIME IT TAKES.
//
// Stack.idleSkip jumps the frames where only timers are counting down. That
// is safe exactly as long as nothing in the skipped window could have
// changed something a timer does not predict, and three things could:
//
//   the clamp      bounding the jump by a few chosen timers and clamping the
//                  rest zeroed a panel that should have stayed ahead, so two
//                  matches two frames apart fired together — a 3-chain
//                  resolving as a 2-chain
//   the counters   preStopTime and stopTime run in SEQUENCE, and updateSpeed
//                  fires on an exact clock equality
//   geometry       a match already available is not predicted by any timer,
//                  so a jump lands it late against everything popping
//
// Each was found here, in seconds, on a generated board. This runs the same
// boards both ways and requires the event streams to be identical.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var eb = require('./engineboard.js');
var H = 12, W = 6;

var seed = Number(process.env.GC_SKIP_SEED || 7) >>> 0;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function board() {
    var g = [];
    for (var r = 0; r <= H; r++) { g[r] = []; for (var c = 1; c <= W; c++) g[r][c] = 0; }
    for (var c2 = 1; c2 <= W; c2++) {
        var h = 1 + Math.floor(rnd() * 8), run = 0, last = 0;
        for (var r2 = 1; r2 <= h; r2++) {
            var v = (last && run < 2 && rnd() < 0.5) ? last : 1 + Math.floor(rnd() * 4);
            run = (v === last) ? run + 1 : 1; last = v;
            g[r2][c2] = v;
        }
    }
    return g;
}
function clone(g) { var o = []; for (var r = 0; r <= H; r++) o[r] = g[r].slice(); return o; }

function trace(g, r, c, useSkip) {
    var st = eb.scratch(10);
    st.allowIdleSkip = !!useSkip;
    eb.paint(st, g, H, W);
    if (!st.canSwap(r, c)) return null;
    st.doSwap(r, c);
    var log = [];
    for (var f = 0; f < 900; f++) {
        st.events.length = 0;
        st.idleSkip();
        st.run();
        for (var e = 0; e < st.events.length; e++) {
            var ev = st.events[e];
            if (ev.type === 'match') log.push('M' + ev.size + (ev.chain ? 'c' : ''));
            else if (ev.type === 'chainEnd') log.push('END' + ev.length);
        }
        if (f >= 3 && !st.hasActivePanels() && !st.hasChainingPanels()) break;
    }
    return { log: log.join('|'), grid: eb.readGrid(st, H, W).map(function (row) {
        return row.slice(1).join(',');
    }).join('|') };
}

var BOARDS = Number(process.env.GC_SKIP_BOARDS || 400);
var compared = 0, cleared = 0;
for (var i = 0; i < BOARDS; i++) {
    var g = board();
    var lb = new LogicalBoard(W, H, 9, clone(g), {});
    lb.legalSwaps().forEach(function (sw) {
        var off = trace(g, sw[0], sw[1], false);
        if (!off) return;
        var on = trace(g, sw[0], sw[1], true);
        compared++;
        if (off.log) cleared++;
        assert.strictEqual(on.log, off.log,
            'board ' + i + ' swap ' + sw + ': the skip changed what fired\n' +
            '  without: ' + off.log + '\n  with   : ' + on.log);
        assert.strictEqual(on.grid, off.grid,
            'board ' + i + ' swap ' + sw + ': the skip changed the settled board');
    });
}
assert.ok(cleared > 100, 'only ' + cleared + ' of these settles cleared anything — ' +
                         'a corpus that never cascades proves nothing about cascades');
console.log('  ok  ' + compared + ' settles resolve identically with the skip on and off' +
            '   (' + cleared + ' of them cleared)');
console.log('\n1/1 passed');
