// WHAT THIS BOARD CAN BE MADE TO DO, WITH THE PRICE OF EACH.
//
// The bot's existing reach* features answer "could a 5-chain be fired from
// here" as a yes or no. A yes with no price is half an answer: a 5-chain two
// swaps away across the board and a 5-chain under the cursor are not the same
// offer, and the thing that decides between them is FRAMES — the stack is
// rising the whole time.
//
// So every option carries what it pays and what it costs:
//
//   kind    'combo' for a single clear, 'chain' for a cascade
//   size    combo width, or chain depth — the number a player would say
//   swaps   the swaps to play, in order
//   frames  cursor frames to play them: travel.cost to the first, then from
//           each to the next. This is the price, not the settle.
//   chain   what the last swap resolves to, in resolve's units
//   total   panels it clears
//
// NOW AND NEXT ARE SEPARATE LISTS, because they are different promises. `now`
// fires this move. `next` needs a setup swap that clears nothing first, so it
// pays two travels and is a claim about a board that does not exist yet.
//
// COST IS WHY THIS IS NOT JUST THE SEARCH AGAIN. Resolving from masks is about
// a microsecond and a half, so the whole two-swap set is a few hundred
// microseconds against the 85ms a decision has — the options can be listed in
// full rather than pruned to a winner.
//
// Nothing in the bot's decision path imports this.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./bitmatch.js'), require('./travel.js'));
    } else {
        root.BitOptions = factory(root.BitMatch, root.PanelEval.travel);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (bit, travel) {
    'use strict';

    // A clear is a COMBO when it resolves in one round and a CHAIN when the
    // cascade carried — the same split the engine scores by, since it sends a
    // chain as one full-width slab and a combo as separate rows.
    function kindOf(chain) { return chain >= 2 ? 'chain' : 'combo'; }

    // Size is the number a player would name: how deep for a chain, how wide
    // for a combo.
    function sizeOf(chain, total) { return chain >= 2 ? chain : total; }

    function optionOf(swaps, frames, r) {
        return { kind: kindOf(r.chain), size: sizeOf(r.chain, r.total),
                 swaps: swaps, frames: frames, chain: r.chain, total: r.total };
    }

    // Cheapest first, then bigger — the order a caller wants to read.
    function byPrice(a, b) {
        if (a.frames !== b.frames) return a.frames - b.frames;
        return b.size - a.size;
    }

    // EVERY OPTION THIS BOARD OFFERS.
    //
    // board is a LogicalBoard; cursor is [row, col]. `depth` 1 lists only what
    // fires this move, 2 also lists what a setup opens up.
    function options(board, W, H, cursor, depth) {
        var now = [], next = [], i, j;
        var st = bit.maskState(board.grid, board.blocks, W, H);
        var swaps = board.legalSwaps();
        var refused = 0, unknown = 0;

        for (i = 0; i < swaps.length; i++) {
            if (!bit.swapMasks(st, swaps[i][0], swaps[i][1])) { refused++; continue; }
            var r = bit.resolveFromMasks(st);
            bit.swapMasks(st, swaps[i][0], swaps[i][1]);
            if (r.scope !== 'ok') { unknown++; continue; }
            if (r.total === 0) continue;                    // clears nothing: not an option, a setup
            now.push(optionOf([swaps[i]], travel.cost(cursor[0], cursor[1], swaps[i][0], swaps[i][1]), r));
        }

        if ((depth || 1) >= 2) {
            for (i = 0; i < swaps.length; i++) {
                if (!bit.swapMasks(st, swaps[i][0], swaps[i][1])) continue;
                var first = bit.resolveFromMasks(st);
                bit.swapMasks(st, swaps[i][0], swaps[i][1]);
                if (first.scope !== 'ok' || first.total !== 0) continue;   // a setup clears nothing

                var mid = board.clone();
                mid.swap(swaps[i][0], swaps[i][1]);
                mid._applyGravity();
                var st2 = bit.maskState(mid.grid, mid.blocks, W, H);
                var then = mid.legalSwaps();
                var toSetup = travel.cost(cursor[0], cursor[1], swaps[i][0], swaps[i][1]);
                for (j = 0; j < then.length; j++) {
                    if (!bit.swapMasks(st2, then[j][0], then[j][1])) continue;
                    var r2 = bit.resolveFromMasks(st2);
                    bit.swapMasks(st2, then[j][0], then[j][1]);
                    if (r2.scope !== 'ok' || r2.total === 0) continue;
                    var frames = toSetup + travel.cost(swaps[i][0], swaps[i][1], then[j][0], then[j][1]);
                    next.push(optionOf([swaps[i], then[j]], frames, r2));
                }
            }
        }

        now.sort(byPrice);
        next.sort(byPrice);

        // THE CHEAPEST WAY TO EACH SIZE, which is what a caller comparing
        // offers actually wants. Keyed 'chain2'..'chain8' and 'combo4'..,
        // holding the cheapest option that reaches at least that size — so a
        // board holding a 5-chain answers chain2, chain3, chain4 and chain5,
        // the way the reach* features are cumulative.
        var cheapest = {};
        function offer(list) {
            for (var k = 0; k < list.length; k++) {
                var o = list[k];
                var top = o.kind === 'chain' ? 8 : 10;
                for (var s = (o.kind === 'chain' ? 2 : 4); s <= o.size && s <= top; s++) {
                    var key = o.kind + s;
                    if (!cheapest[key] || o.frames < cheapest[key].frames) cheapest[key] = o;
                }
            }
        }
        offer(now);
        offer(next);

        return { now: now, next: next, cheapest: cheapest,
                 swapsConsidered: swaps.length, refused: refused, unknown: unknown };
    }

    return { options: options, kindOf: kindOf, sizeOf: sizeOf };
}));
