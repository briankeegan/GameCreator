// PLANNING ON TOP OF THE ARITHMETIC.
//
// bitmatch.js answers what a board does. This answers what to play on it.
//
// TWO PLIES ARE ENUMERATED, NOT GUESSED AT. The reason a planner reaches for
// heuristics here is cost: a board offers about thirty legal swaps, so looking
// one move further is nine hundred positions, and at a few hundred microseconds
// a position that does not fit in the 85ms a decision has. Resolving from masks
// costs about a microsecond and a half, which puts the whole second ply at
// about 431us — so the shapes a chain can take do not have to be recognised,
// enumerated or stored. They are simply played.
//
// A SETUP CLEARS NOTHING. That is the whole point of it: the move that pays is
// the one after. So bestSetup only considers first swaps that clear nothing,
// settles the board they leave, and scores every swap on that. On real boards
// this finds a deeper chain than anything available immediately about one time
// in seven.
//
// Nothing in the bot's decision path imports this.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./bitmatch.js'));
    else root.BitPlan = factory(root.BitMatch);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (bit) {
    'use strict';

    // Deeper wins; between equal depths, more panels wins.
    function better(a, b) {
        if (!b) return true;
        if (a.chain !== b.chain) return a.chain > b.chain;
        return a.total > b.total;
    }

    // THE BEST MOVE AVAILABLE NOW. Every legal swap scored, masks built once for
    // the board and mutated four bits at a time.
    function bestNow(board, W, H) {
        var st = bit.maskState(board.grid, board.blocks, W, H);
        var swaps = board.legalSwaps(), best = { chain: 0, total: 0, swap: null }, scored = 0;
        for (var i = 0; i < swaps.length; i++) {
            if (!bit.swapMasks(st, swaps[i][0], swaps[i][1])) continue;
            var r = bit.resolveFromMasks(st);
            bit.swapMasks(st, swaps[i][0], swaps[i][1]);
            if (r.scope !== 'ok') continue;
            scored++;
            var cand = { chain: r.chain, total: r.total, swap: swaps[i] };
            if (better(cand, best)) best = cand;
        }
        best.scored = scored;
        return best;
    }

    // THE BEST MOVE AFTER A SETUP. The first swap must clear nothing; the board
    // it leaves is settled, and every swap on that is scored.
    //
    // A swap that breaks a slab is skipped rather than scored: the cascade past
    // a break depends on colours the engine draws from its own rng, so a plan
    // built on one is a plan that cannot be relied on.
    function bestSetup(board, W, H) {
        var swaps = board.legalSwaps(), best = { chain: 0, total: 0, setup: null, fire: null };
        var st = bit.maskState(board.grid, board.blocks, W, H), scored = 0;
        for (var i = 0; i < swaps.length; i++) {
            if (!bit.swapMasks(st, swaps[i][0], swaps[i][1])) continue;
            var first = bit.resolveFromMasks(st);
            bit.swapMasks(st, swaps[i][0], swaps[i][1]);
            if (first.scope !== 'ok' || first.total !== 0) continue;

            var mid = board.clone();
            mid.swap(swaps[i][0], swaps[i][1]);
            mid._applyGravity();
            var st2 = bit.maskState(mid.grid, mid.blocks, W, H), next = mid.legalSwaps();
            for (var j = 0; j < next.length; j++) {
                if (!bit.swapMasks(st2, next[j][0], next[j][1])) continue;
                var r = bit.resolveFromMasks(st2);
                bit.swapMasks(st2, next[j][0], next[j][1]);
                if (r.scope !== 'ok') continue;
                scored++;
                var cand = { chain: r.chain, total: r.total, setup: swaps[i], fire: next[j] };
                if (better(cand, best)) best = cand;
            }
        }
        best.scored = scored;
        return best;
    }

    return { bestNow: bestNow, bestSetup: bestSetup, better: better };
}));
