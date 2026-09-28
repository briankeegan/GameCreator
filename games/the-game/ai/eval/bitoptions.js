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

    // WHAT A SEQUENCE ACTUALLY TAKES, which is not what it costs to walk.
    //
    //   frames    cursor travel, and only that
    //   overhead  the swap, plus the reaction cooldown when one applies. A plan's
    //             moves are played one per decision, so every move pays it. The
    //             cooldown is skipped while stop time runs, so the caller says
    //             which number is right at this moment.
    //   resolve   FLASH + FACE + POP * (comboSize + garbage) -- the engine's own
    //             preStop. The board is busy for this long after the cash and the
    //             next move cannot land until it is over. 59 frames for a bare
    //             three, 143 for a three into twelve garbage panels.
    //
    // Left out, a three-move plan ending in a clear prices at ~15 frames and
    // really takes 120 or more, so the deadline test passed plans the floor
    // arrives in the middle of.
    function durationOf(swaps, frames, r) {
        var d = frames + swaps.length * OVERHEAD;
        if (RESOLVE && r && r.total > 0) d += RESOLVE(r.total, r.garbage || 0);
        return d;
    }

    function optionOf(swaps, frames, r) {
        return { kind: kindOf(r.chain), size: sizeOf(r.chain, r.total),
                 swaps: swaps, frames: frames, chain: r.chain, total: r.total,
                 garbage: r.garbage || 0, duration: durationOf(swaps, frames, r) };
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
    // Set per call by the caller, which knows its own reaction and whether the
    // clock is running.
    var OVERHEAD = 0, RESOLVE = null;

    function options(board, W, H, cursor, depth, st, timing) {
        OVERHEAD = (timing && timing.overhead) || 0;
        RESOLVE = (timing && timing.resolve) || null;
        var now = [], next = [], i, j;
        if (!st) st = bit.maskState(board.grid, board.blocks, W, H);
        var swaps = board ? board.legalSwaps() : bit.legalSwapsOf(st);
        var refused = 0, unknown = 0;

        for (i = 0; i < swaps.length; i++) {
            if (!bit.swapMasks(st, swaps[i][0], swaps[i][1])) { refused++; continue; }
            var r = bit.resolveFromMasks(st);
            bit.swapMasks(st, swaps[i][0], swaps[i][1]);
            // A MOVE THAT BREAKS A SLAB IS AN OPTION, NOT AN UNKNOWN. The cascade
            // past the break is unknowable — the engine draws the converted row's
            // colours from its own rng — but the BREAK is the point of the move,
            // and digging is progress even when the clear itself pays nothing.
            // Discarding these made every digging option invisible.
            var broke = r.scope === 'garbage-broke';
            if (r.scope !== 'ok' && !broke) { unknown++; continue; }
            if (r.total === 0 && !broke) continue;           // clears nothing: a setup, not an option
            var opt = optionOf([swaps[i]], travel.cost(cursor[0], cursor[1], swaps[i][0], swaps[i][1]), r);
            opt.breaks = broke;
            now.push(opt);
        }

        // SETUPS, TO WHATEVER DEPTH IS ASKED FOR.
        //
        // THIS IS CHEAP AND I TALKED MYSELF OUT OF IT ONCE. The claim was that a
        // third ply explodes -- thirty swaps cubed, twenty-seven thousand boards a
        // decision. Measured on a real mid-game board: NINE legal swaps, and
        // resolveFromMasks runs in 0.9 MICROSECONDS, 1,111 of them a millisecond.
        // Depth 2 is 90 resolves and 0.3ms; depth 3 is 729 and about 1ms. Even at
        // a pessimistic twenty swaps a ply, depth 3 is 7ms and depth 4 is 144ms.
        // Being able to afford this is the entire reason the arithmetic exists.
        //
        // WHY DEPTH MATTERS HERE AND DID NOT FOR SURVIVAL. A stop-time plan exists
        // at two plies on most boards -- measured, 86 of 103 starving decisions --
        // so survival never needed more. An ATTACK does: a 4-chain takes three or
        // four coordinated placements, and a two-ply search finds only the chains
        // that are already one move from existing. Over 990 decisions it offered
        // 5,176 bare threes and a 3-chain twice.
        //
        // A SETUP CLEARS NOTHING, at every ply. That is what makes the recursion
        // terminate on something meaningful rather than wandering: each step holds
        // the board still while it arranges, and the last step cashes.
        // A BEAM INSIDE THE RECURSION, WHICH IS WHAT MAKES DEPTH AFFORDABLE.
        //
        // Every legal swap is a branch and a board offers thirty to sixty of them,
        // so an exhaustive search costs b^d and only four plies ever fit. That is
        // the whole reason depth was capped at 4: not a judgement about how far
        // ahead is useful, but the only thing holding back the explosion.
        //
        // Keeping the best SETUPS_KEPT setups at each ply makes the cost
        // SETUPS_KEPT * b * d -- linear in depth instead of exponential -- so the
        // depth can be whatever the deadline affords.
        //
        // Setups are ranked by what they cost, because a setup clears nothing by
        // definition and price is the only thing that separates two of them. The
        // cheap ones leave the most frames for the cash at the end.
        var SETUPS_KEPT = 6;

        function expand(state, chain, from, spent, left) {
            var list = bit.legalSwapsOf(state), k;
            var setups = [];
            // PRUNE THE SETUPS THAT CANNOT LEAD ANYWHERE, but only below the top
            // ply: ply one stays exhaustive so an immediate clear is never missed.
            // A swap out of reach of any pair cannot make a line however many moves
            // follow it, and the reach is a handful of cells rather than the board.
            var reach = chain.length ? bit.reachMask(state) : null;
            for (k = 0; k < list.length; k++) {
                var sw = list[k];
                if (reach) {
                    var rb = 1 << (sw[0] - 1);
                    if (!((reach[sw[1]] | reach[sw[1] + 1]) & rb)) continue;
                }
                if (!bit.swapMasks(state, sw[0], sw[1])) continue;
                // The settled board is only needed when we are going deeper.
                var res = bit.resolveFromMasks(state, left > 1);
                bit.swapMasks(state, sw[0], sw[1]);
                var cost = spent + travel.cost(from[0], from[1], sw[0], sw[1]);
                var broke = res.scope === 'garbage-broke';
                if (res.scope === 'ok' || broke) {
                    if (res.total > 0 || broke) {
                        // A CASH ENDS THE LINE. Recorded only when something was
                        // set up first -- a cash with an empty chain is a depth-1
                        // option and `now` already holds it, so pushing it here
                        // would list every immediate clear twice and make the two
                        // lists disagree about what is on offer.
                        if (chain.length) {
                            var opt = optionOf(chain.concat([sw]), cost, res);
                            opt.breaks = broke;
                            next.push(opt);
                        }
                        continue;
                    }
                    // Cleared nothing, so it is a setup. Collected rather than
                    // recursed into immediately, so the ply can be ranked whole
                    // and only its best few are paid for.
                    if (left > 1 && res.settled) {
                        setups.push({ state: res.settled, sw: sw, cost: cost });
                    }
                }
            }
            if (!setups.length) return;
            setups.sort(function (a, b) { return a.cost - b.cost; });
            var take = Math.min(setups.length, SETUPS_KEPT);
            for (k = 0; k < take; k++) {
                var su = setups[k];
                expand(su.state, chain.concat([su.sw]), su.sw, su.cost, left - 1);
            }
        }
        if ((depth || 1) >= 2) expand(st, [], cursor, 0, depth || 1);

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
