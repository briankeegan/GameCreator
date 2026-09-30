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
    //
    // RESOLVE TIME IS NOT A COST AND MUST NOT BE ADDED HERE. While a clear
    // resolves, hasActivePanels() holds riseLock, so the floor does not move for
    // the whole of it -- the engine's resolve time is floor HELD, not time spent.
    // heldFrames counts it on the other side of the ledger; adding it here as
    // well priced the same frames as both a gain and a cost.
    function durationOf(swaps, frames) {
        return frames + swaps.length * OVERHEAD;
    }

    // AND THE SHAPE OF THE BOARD IT LEAVES BEHIND. A clear that comes off the
    // tall column flattens; the same clear off a short one deepens the spike. The
    // resolver already settles the cascade, so the height it lands at is there to
    // be read, and a move that clears AND flattens is the one worth playing.
    // `tall` is the whole board, garbage and all, because that is what reaches
    // the ceiling. `bumps` is PANELS PER COLUMN, because height is the wrong
    // ruler for how the material is spread: under a slab every column measures
    // the same height however lopsided the panels beneath it are.
    // `tall` is the whole board, garbage and all, because that is what reaches
    // the ceiling.
    //
    // `excess` is how far the panels are from an even spread, as the MEAN
    // DEVIATION from their own mean -- the average number of rows a column is away
    // from where it would be if the material were level.
    //
    // NOT max MINUS mean. That only ever sees the single fullest column, so moving
    // a panel into a four-deep hole changed nothing whenever a second column
    // matched the tallest, and the objective had no reason to fill holes at all.
    // A mean deviation moves for every panel shifted toward level, which is the
    // gradient the plan needs.
    //
    // It is in rows, so it converts to frames at framesPerRow like any other row.
    // Garbage is left out for the same reason it is left out of materialRows: a
    // slab is not material and cannot be spread.
    //
    // `bumps` is the same panel counts as a sum of steps, kept for tie-breaks.
    function shapeOf(st2) {
        var h = [], c, tall = 0, bumps = 0, sum = 0, mx = 0, w2 = st2 && (st2.W || 6);
        if (!st2) return null;
        for (c = 1; c <= w2; c++) {
            var top = 32 - Math.clz32(st2.occ[c] >>> 0);
            if (top > tall) tall = top;
            // ONLY THE PANELS THAT CAN BE SPREAD INTO EACH OTHER.
            //
            // A slab splits the board into pockets and nothing crosses it, so
            // panels sitting above one are not part of the surface being
            // levelled. Counting the whole column made a column holding five
            // workable panels and two stranded above a slab read as the fullest
            // on the board, and the plan spent its effort on material it could
            // not move.
            var g = st2.garb[c] >>> 0;
            var floor = g ? (g & -g) : 0;            // lowest garbage cell
            var below = floor ? (floor - 1) : 0xffffffff;
            h[c] = bit.popcount((st2.occ[c] & ~g & below) >>> 0);
            sum += h[c];
            if (h[c] > mx) mx = h[c];
        }
        for (c = 1; c < w2; c++) bumps += Math.abs(h[c] - h[c + 1]);
        var mean = sum / w2, dev = 0;
        for (c = 1; c <= w2; c++) dev += Math.abs(h[c] - mean);
        // `mat` is the pocket's material in rows, which is what the caller has to
        // decide whether it can afford to spend.
        // `low` is the emptiest column of the pocket. A column at zero holds no
        // vertical match and breaks the adjacency a horizontal one needs, and it
        // is where a slab bridges: garbage rests on the tall columns and the empty
        // one can never reach it.
        var low = h[1];
        for (c = 2; c <= w2; c++) if (h[c] < low) low = h[c];
        return { tall: tall, bumps: bumps, excess: dev / w2, mat: mean, low: low };
    }

    function optionOf(swaps, frames, r) {
        var sh = shapeOf(r.settled);
        return { kind: kindOf(r.chain), size: sizeOf(r.chain, r.total),
                 swaps: swaps, frames: frames, chain: r.chain, total: r.total,
                 garbage: r.garbage || 0, duration: durationOf(swaps, frames),
                 tall: sh ? sh.tall : null, bumps: sh ? sh.bumps : null,
                 mat: sh ? sh.mat : null, low: sh ? sh.low : null };
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
    var OVERHEAD = 0, RESOLVE = null, DIG = false;

    function options(board, W, H, cursor, depth, st, timing, dig) {
        OVERHEAD = (timing && timing.overhead) || 0;
        RESOLVE = (timing && timing.resolve) || null;
        // DIGGING IS A GOAL, NOT A PREFERENCE. The caller sets it when the board
        // is buried and short of material, and it changes what the beam keeps --
        // see expandAll. Nothing else in here reads it.
        DIG = !!dig;
        var now = [], next = [], i, j;
        if (!st) st = bit.maskState(board.grid, board.blocks, W, H);
        // THE EMPTIEST COLUMN BEFORE ANY MOVE, so an option can be asked whether
        // IT is the one that opens a hole rather than merely landing on a board
        // that has one.
        var START = shapeOf(st);
        var BASELOW = START ? START.low : 0;
        var BASEBUMPS = START ? START.bumps : 0;
        var swaps = board ? board.legalSwaps() : bit.legalSwapsOf(st);
        var refused = 0, unknown = 0;

        for (i = 0; i < swaps.length; i++) {
            if (!bit.swapMasks(st, swaps[i][0], swaps[i][1])) { refused++; continue; }
            var r = bit.resolveFromMasks(st, true);
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
            // HORIZONTAL AND VERTICAL ARE NOT THE SAME MOVE, AND THE DIFFERENCE IS
            // THE SHAPE. A vertical three takes three panels out of ONE column and
            // drops it three below its neighbours; a horizontal three takes one from
            // each of three and leaves the surface where it was. No need to detect
            // which it is -- the landed board's bumpiness says it outright.
            opt.levels = opt.bumps !== null && opt.bumps <= BASEBUMPS;
            opt.opensHole = opt.low === 0 && BASELOW > 0;
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
        // A BEAM ACROSS THE PLY, WHICH IS WHAT MAKES DEPTH AFFORDABLE.
        //
        // Every legal swap is a branch and a board offers thirty to sixty, so an
        // exhaustive search costs b^d and only four plies ever fit. Keeping the
        // best few setups AT EACH NODE does not fix that -- it only lowers the
        // base, so six kept per node is 6^d and depth 8 is 1.7 million boards.
        //
        // Keeping the best BEAM setups across the WHOLE ply does fix it: every
        // ply costs BEAM * b resolves whatever its number, so the total is
        // BEAM * b * depth. Linear. Depth is then a question of what the clock
        // affords rather than what the search survives.
        //
        // Setups are ranked by price, because a setup clears nothing by
        // definition and cost is the only thing separating two of them. The cheap
        // ones leave the most frames for the cash at the end.
        var BEAM = 12, DIG_BEAM = 6;

        // HOW UNEVEN A LANDED BOARD IS: the sum of the steps between neighbouring
        // column heights. Zero is flat. Death comes at the TALLEST column while
        // the material is spread over all six, so the steps are rows of life the
        // board is not using.
        // WHAT A LANDED BOARD CAN STILL BUILD: the cells where putting the right
        // colour would finish a line. A flat board that cannot make a match is not
        // a place worth walking to.
        function waysOf(state) {
            var r = bit.reachMask(state), n = 0, c;
            for (c = 1; c <= W; c++) n += bit.popcount(r[c]);
            return n;
        }

        function bumpsOf(state) {
            var h = [], c, n = 0;
            for (c = 1; c <= W; c++) h[c] = bit.popcount((state.occ[c] & ~state.garb[c]) >>> 0);
            for (c = 1; c < W; c++) n += Math.abs(h[c] - h[c + 1]);
            return n;
        }

        // WHERE A CLEAR CAN STILL BE MADE, AND HOW MUCH OF IT IS AGAINST A SLAB.
        //
        // reachMask marks the cells that would complete a same-colour pair. A
        // cell touching garbage counts as reachable too: a match landing beside a
        // slab breaks it, and breaking is the only thing that converts a slab
        // back into panels.
        //
        // `dig` is the board's own count of ways this position is one move from a
        // break -- reachable cells that are against a slab, before the widening.
        //
        // WHEN DIGGING THIS RUNS AT BIRTH, for every node born in the ply, because
        // the dig count is what the beam ranks by and a node cannot be ranked
        // after it has been culled. Otherwise it runs at expansion, for the twelve
        // that survived -- the mask is the same either way, and paying for the
        // hundreds that did not survive cost 13% of a decision for nothing.
        // BREAKS IN HAND: legal swaps on this board that touch a slab and clear.
        //
        // `dig` counts cells where the right colour WOULD finish a line against
        // the garbage, which is satisfied by a board that is near a break and
        // never closes it -- and that is where the bot parks, on half of all
        // buried decisions. This counts the ones it can actually play.
        //
        // Only asked of nodes that already have somewhere to break (dig > 0), so
        // the resolve sweep runs on a minority of the nodes rather than all of
        // them.
        // BUDGETED. Each call is a full swap sweep of the landed board, and the
        // search offers hundreds of nodes a decision -- unbudgeted it took a
        // decision from 47ms to 77ms against an 85ms guard. The nodes arrive
        // cheapest-first, so the budget spends itself on the ones most likely to
        // become the plan, and the rest fall back to the proximity term.
        var saveBudget = 0;
        function savesOf(state) {
            if (saveBudget <= 0) return 0;
            saveBudget--;
            return savesOfRaw(state);
        }
        // IS THERE ANY CLEAR ON THIS BOARD AT ALL -- the emergency valve, not the
        // break. Firing anything holds the floor for its resolve, and at
        // maxHealth 1 that is the whole difference between living and not, so a
        // board with no clear on it is a board one full row from dying.
        //
        // Cheap because it stops at the first one and is only asked while no
        // route has been found yet: the frontier grows in cost order, so the
        // first node that answers is the cheapest way to a board that can fire.
        function readyOf(state) {
            if (readyBudget <= 0) return 0;
            readyBudget--;
            var sw = bit.legalSwapsOf(state), i, r;
            for (i = 0; i < sw.length; i++) {
                if (!bit.swapMasks(state, sw[i][0], sw[i][1])) continue;
                r = bit.resolveFromMasks(state, false);
                bit.swapMasks(state, sw[i][0], sw[i][1]);
                if (r.total > 0 || r.scope === 'garbage-broke') return 1;
            }
            return 0;
        }

        function savesOfRaw(state) {
            var sw = bit.legalSwapsOf(state), n = 0, i, r;
            for (i = 0; i < sw.length; i++) {
                if (!bit.swapMasks(state, sw[i][0], sw[i][1])) continue;
                r = bit.resolveFromMasks(state, false);
                bit.swapMasks(state, sw[i][0], sw[i][1]);
                if (r.scope === 'garbage-broke') n++;
            }
            return n;
        }

        function reachOf(state) {
            var reach = bit.reachMask(state), dig = 0, c, adj;
            for (c = 1; c <= W; c++) {
                adj = ((state.garb[c] >> 1) | (state.garb[c] << 1) |
                       state.garb[c - 1] | state.garb[c + 1]) & ~state.garb[c];
                dig += bit.popcount(reach[c] & adj);
                reach[c] |= adj;
            }
            return { mask: reach, dig: dig };
        }

        var flat = null, save = null, ready = null, BASE = null, BASEDIG = 0, BASESAVE = 0;
        var readyBudget = 0;
        var FPR = (timing && timing.framesPerRow) || 112;
        var DEADLINE = (timing && timing.deadline) || 0;

        function expandAll(state0, depth) {
            BASE = shapeOf(state0);
            BASEDIG = DIG ? reachOf(state0).dig : 0;
            saveBudget = 192;
            // TWENTY-FOUR, because the frontier grows in cost order and the
            // cheapest route is found in the first few nodes or not at all. At 96
            // this swept up to thirty swaps on each of ninety-six landed boards
            // whenever no route existed, which is exactly the board where the
            // whole sweep is already expensive: gate_bitbot went 11s to 40s.
            readyBudget = 24;
            BASESAVE = (DIG && BASEDIG > 0) ? savesOfRaw(state0) : 0;
            // The root has no reach mask: ply one stays exhaustive so an immediate
            // clear is never missed.
            var frontier = [{ st: state0, chain: [], from: cursor, spent: 0, reach: null, dig: 0 }], ply;
            // depth LEVELS, not depth-1. The first level's cashes belong to `now`
            // (they are one swap from the board as it stands) and are skipped here;
            // the levels after it are what this exists to find.
            for (ply = 1; ply <= depth && frontier.length; ply++) {
                var born = [], fi, k;
                for (fi = 0; fi < frontier.length; fi++) {
                    var node = frontier[fi], state = node.st;
                    var list = bit.legalSwapsOf(state);
                    // PRUNE BELOW THE TOP PLY ONLY: ply one stays exhaustive so an
                    // immediate clear is never missed. A swap out of reach of any
                    // pair cannot make a line however many moves follow it.
                    // THE PRUNE MUST NOT HIDE THE DIGGING.
                    //
                    // reachMask marks cells that would complete a same-colour
                    // PAIR. A setup that puts a panel beside a slab is not near a
                    // pair, so it was discarded -- and with it every sequence that
                    // breaks garbage. Measured on seed 106's final board: an
                    // exhaustive three-swap search finds 2 breaks and 323 clears,
                    // and this search found 0 breaks at depth 3, 6 or 12.
                    //
                    // So a cell against garbage is in reach too. Breaking is the
                    // only thing that converts a slab back into panels, and the
                    // search exists to find it.
                    // Scored at birth when digging, because the dig count is what
                    // the beam ranks by; otherwise built here, for the twelve
                    // nodes that survived the cull rather than the hundreds born.
                    var reach = node.reach;
                    if (!reach && node.chain.length) reach = reachOf(state).mask;
                    for (k = 0; k < list.length; k++) {
                        var sw = list[k];
                        if (reach) {
                            var rb = 1 << (sw[0] - 1);
                            if (!((reach[sw[1]] | reach[sw[1] + 1]) & rb)) continue;
                        }
                        if (!bit.swapMasks(state, sw[0], sw[1])) continue;
                        var res = bit.resolveFromMasks(state, true);
                        bit.swapMasks(state, sw[0], sw[1]);
                        var cost = node.spent + travel.cost(node.from[0], node.from[1], sw[0], sw[1]);
                        var broke = res.scope === 'garbage-broke';
                        if (res.scope !== 'ok' && !broke) continue;
                        if (res.total > 0 || broke) {
                            // A CASH ENDS THE LINE. Recorded only when something was
                            // set up first -- a cash with an empty chain is a depth-1
                            // option and `now` already holds it, so pushing it here
                            // would list every immediate clear twice.
                            if (node.chain.length) {
                                var opt = optionOf(node.chain.concat([sw]), cost, res);
                                opt.breaks = broke;
                                // HORIZONTAL AND VERTICAL ARE NOT THE SAME MOVE, AND THE DIFFERENCE IS
                                // THE SHAPE. A vertical three takes three panels out of ONE column and
                                // drops it three below its neighbours; a horizontal three takes one from
                                // each of three and leaves the surface where it was. No need to detect
                                // which it is -- the landed board's bumpiness says it outright.
                                opt.levels = opt.bumps !== null && opt.bumps <= BASEBUMPS;
                                opt.opensHole = opt.low === 0 && BASELOW > 0;
                                next.push(opt);
                            }
                            continue;
                        }
                        // Cleared nothing, so it is a setup and can be built on.
                        if (res.settled) {
                            var rr = DIG ? reachOf(res.settled) : null;
                            var seq = node.chain.concat([sw]);
                            // THE FLATTEST BOARD THIS SEARCH CAN REACH, AND THE
                            // SWAPS THAT REACH IT.
                            //
                            // res.settled is where everything LANDED, which is the
                            // board the next move is played on, so the sequence is
                            // planned against boards that will exist rather than
                            // against the one in front of the cursor. The search
                            // already built them and threw the geometry away.
                            //
                            // Cheapest wins a tie, because a flat board arrived at
                            // sooner is flat for longer.
                            // FLAT FIRST, THEN WHAT IT CAN BUILD, THEN CHEAPEST.
                            //
                            // Flatness is the goal, but two boards equally flat are
                            // not equally useful: the one offering more ways to
                            // finish a line is the one worth arriving at. Ways are
                            // only counted on a board that ties or beats the best
                            // flatness, so the mask is built for a handful of nodes
                            // a ply rather than all of them.
                            // WHAT FLATTENING IS WORTH, IN FRAMES.
                            //
                            //   (tallNow - tallAfter) * framesPerRow
                            // the ceiling it hands back. Death comes at the TALLEST
                            // column, so a row off the top is framesPerRow frames --
                            // 112 at level 10. A one-block spike swapped sideways
                            // into a shorter column lowers the whole board by a row
                            // for one swap.
                            //
                            //   (excessNow - excessAfter) * framesPerRow
                            // the ceiling the board owns and is not using: the rows
                            // the fullest column carries above an even spread of the
                            // same panels. Also rows, so also framesPerRow.
                            //
                            //   - duration
                            // what the walk costs, in the same frames.
                            //
                            // One number. Ties go to the board offering more ways to
                            // finish a line, and there is no tier for the arithmetic
                            // to be outvoted by.
                            // THE CHEAPEST ROUTE TO A BOARD THAT CAN FIRE. Not
                            // gated on digging: a board with nothing to fire is
                            // in danger whether or not there is garbage on it.
                            if (!ready && readyOf(res.settled)) {
                                ready = { swaps: seq, frames: cost,
                                          duration: durationOf(seq, cost) };
                            }
                            var sh2 = shapeOf(res.settled);
                            if (sh2) {
                                var dur = durationOf(seq, cost);
                                var val = (BASE.tall - sh2.tall) * FPR
                                        + (BASE.excess - sh2.excess) * FPR
                                        - dur;
                                // UNDER A SLAB, FLAT AND LOW IS THE WRONG GOAL.
                                //
                                // A slab is not only a threat, it is panels and a
                                // long hold waiting to be unlocked, and the only
                                // thing standing between the board and them is a
                                // match that touches it. A board spread low and
                                // even cannot reach the slab's floor at all: on
                                // seed 101 the floor was at r6 and the material
                                // topped out at r5 in two columns, with plenty of
                                // panels and no way to put three of them together
                                // against it.
                                //
                                // So while digging, every cell that would finish a
                                // line against the slab is worth what it unlocks --
                                // the same deadline/W a converted cell is priced at
                                // everywhere else, since that is what it leads to.
                                // Reaching the slab IS the flattening here.
                                // A BREAK IN HAND IS WORTH WHAT IT UNLOCKS; being NEAR
                            // one is worth a fraction of it. Both are priced at the
                            // same deadline/W a converted cell gets, because that
                            // is what a break leads to -- but only the one it can
                            // actually play counts in full.
                            if (DIG && rr) {
                                var sv = rr.dig > 0 ? savesOf(res.settled) : 0;
                                // THE CHEAPEST ROUTE BACK TO HOLDING A BREAK.
                                //
                                // Kept separately from the flatten plan because it
                                // answers a different question: not "is this board
                                // better" but "is there a save on it". At one ply
                                // there is almost never another move that keeps
                                // one -- 2 of 100 -- so it has to be planned over
                                // several.
                                if (sv > 0 && (!save || cost < save.frames)) {
                                    save = { swaps: seq, frames: cost,
                                             duration: durationOf(seq, cost) };
                                }
                                val += (sv - BASESAVE) * (DEADLINE / W) * W
                                     + (rr.dig - BASEDIG) * (DEADLINE / W);
                            }
                                var take = !flat || val > flat.value;
                                if (!take && flat && val === flat.value) {
                                    take = waysOf(res.settled) > flat.ways;
                                }
                                if (take) {
                                    // THE BOARD IT LANDS ON, CARRIED WITH THE PLAN.
                                    // The swaps and the physics are deterministic, so
                                    // this is not a prediction -- it is where the board
                                    // WILL be. A caller can ask it anything it would ask
                                    // a real board before committing to the route.
                                    flat = { swaps: seq, frames: cost, value: val,
                                             tall: sh2.tall, bumps: sh2.bumps,
                                             ways: waysOf(res.settled), duration: dur,
                                             lands: bit.copyState(res.settled) };
                                }
                            }
                            born.push({ st: res.settled, chain: seq,
                                        from: sw, spent: cost,
                                        reach: rr && rr.mask, dig: rr ? rr.dig : 0 });
                        }
                    }
                }
                born.sort(function (a, b) { return a.spent - b.spent; });
                frontier = born.length > BEAM ? born.slice(0, BEAM) : born;
                // AND, WHEN DIGGING, THE NODES CLOSEST TO A SLAB AS WELL.
                //
                // Ranked by price alone the beam keeps the cheapest twelve setups,
                // and a position one swap from a break falls out of it whenever
                // twelve cheaper setups exist -- which is most buried boards. That
                // is why breaking was something the search stumbled on rather than
                // looked for: over a duel on seed 103 the starting weights dug out
                // 339 of 339 panels of garbage and a random vector dug 45 of 92,
                // carried the rest to the ceiling and died at 10,163 frames.
                //
                // ADDED, NOT SUBSTITUTED. Splitting the beam -- half by price, half
                // by proximity -- found breaks on 11 more boards of 194 and LOST
                // them on 21, because the cheap setups it dropped led to breaks of
                // their own. Widening instead can only gain: every node the price
                // order kept is still kept, and the extra slots cost half a ply's
                // search again, on the boards that are already losing.
                if (DIG && born.length > frontier.length) {
                    var spare = born.slice(frontier.length);
                    spare.sort(function (a, b) { return (b.dig - a.dig) || (a.spent - b.spent); });
                    for (k = 0; k < spare.length && k < DIG_BEAM; k++) {
                        if (spare[k].dig) frontier.push(spare[k]);
                    }
                }
            }
        }

        if ((depth || 1) >= 2) expandAll(st, depth || 1);

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

        // Worth naming only if it buys more frames than it costs. Standing still is
        // worth zero.
        if (flat && !(flat.value > 0)) flat = null;

        return { now: now, next: next, cheapest: cheapest, flatten: flat, save: save,
                 ready: ready,
                 swapsConsidered: swaps.length, refused: refused, unknown: unknown };
    }

    return { options: options, kindOf: kindOf, sizeOf: sizeOf };
}));
