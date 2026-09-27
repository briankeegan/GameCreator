// WHICH MOVE, AND WHO DECIDES IT.
//
// The arithmetic in bitmatch.js is exact on a board where everything has
// landed, and 18us buys every legal swap on one. It is NOT exact while panels
// are still in the air: a row of a broken slab takes real colours and then
// HOVERS for a few frames before it drops, and a board read at that moment
// records where those panels sit but not that they have yet to land. Matching
// them a beat early changes the answer.
//
// Modelling the hover as one extra round was tried and made things worse — 191
// right out of 200 against 195 for ignoring it, missing in both directions —
// because the hover is a frame timer that other matches land around, not a
// round. Carrying real frame timers means a third copy of the engine's panel
// loop, which is the thing panel-rules.js exists to prevent.
//
// So: ask the engine instead, and only then.
//
// WHAT IT COSTS, and why it fits. A position with panels in flight persists for
// 21 frames — 350ms, measured, the same every time — so there is room for
// engineboard's 3.2ms a candidate across about thirty swaps. On a settled board
// nothing changes: the arithmetic answers, and the engine is not touched.
//
// HOW OFTEN IT MATTERS. Panels are in flight for 299 of 74,821 swaps, and on
// those positions the arithmetic already picks the engine's own best move 136
// times in 150. So this changes roughly one decision in two thousand. It is
// here because that decision is otherwise wrong for a reason nothing reports.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./bitmatch.js'), require('./engineboard.js'));
    } else {
        root.BitDecide = factory(root.BitMatch, root.PanelEval.engineBoard);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (bit, EB) {
    'use strict';

    // A panel the engine still has in flight — hovering, falling, swapping,
    // flashing, popping. Anything but settled.
    function anyInFlight(motion, H, W) {
        if (!motion) return false;
        for (var r = 1; r <= H; r++) {
            if (!motion[r]) continue;
            for (var c = 1; c <= W; c++) {
                var m = motion[r][c];
                if (m && m.state && m.state !== 'normal') return true;
            }
        }
        return false;
    }

    function score(chain, total) { return chain * 1000 + total; }

    // Every legal swap scored by the arithmetic. Masks built once for the
    // board, mutated four bits at a time.
    function rankByArithmetic(board, W, H) {
        var st = bit.maskState(board.grid, board.blocks, W, H);
        var swaps = board.legalSwaps(), out = [];
        for (var i = 0; i < swaps.length; i++) {
            if (!bit.swapMasks(st, swaps[i][0], swaps[i][1])) continue;
            var r = bit.resolveFromMasks(st);
            bit.swapMasks(st, swaps[i][0], swaps[i][1]);
            out.push({ swap: swaps[i], chain: r.chain, total: r.total, scope: r.scope,
                       score: r.scope === 'ok' ? score(r.chain, r.total) : -1 });
        }
        out.sort(function (a, b) { return b.score - a.score; });
        return out;
    }

    // The same, asked of a real Stack. Used only when something is in flight.
    function rankByEngine(board, W, H, blocks, level) {
        var swaps = board.legalSwaps(), out = [];
        var stack = EB.scratch(level || 10);
        for (var i = 0; i < swaps.length; i++) {
            var cand = board.clone();
            cand.swap(swaps[i][0], swaps[i][1]);
            EB.paint(stack, cand.grid, H, W, blocks);
            var t = EB.settle(stack, 900);
            out.push({ swap: swaps[i], chain: t.chainLength, total: t.clearedPanels,
                       scope: 'engine', score: score(t.chainLength, t.clearedPanels) });
        }
        out.sort(function (a, b) { return b.score - a.score; });
        return out;
    }

    // motion is the per-panel state the snapshot carries; blocks is
    // { id: [[row,col], ...] } as engineboard.paint wants it. Both optional —
    // without motion there is nothing to say the board is unsettled, so the
    // arithmetic answers, which is what it is for.
    function bestMove(board, W, H, motion, blocks, level) {
        var unsettled = anyInFlight(motion, H, W);
        var ranked = unsettled ? rankByEngine(board, W, H, blocks || {}, level)
                               : rankByArithmetic(board, W, H);
        var best = ranked.length ? ranked[0] : null;
        return { best: best, ranked: ranked, decidedBy: unsettled ? 'engine' : 'arithmetic' };
    }

    return { bestMove: bestMove, anyInFlight: anyInFlight,
             rankByArithmetic: rankByArithmetic, rankByEngine: rankByEngine };
}));
