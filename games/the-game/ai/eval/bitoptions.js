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
        // THE SPREAD IS WHAT A SLAB SEALS. Garbage rests on the TALLEST column and
        // spans the width, so every column shorter than that one ends up with the
        // difference in empty rows under the slab -- sealed, out of reach, and
        // holding whatever material was beneath. Bumpiness counts neighbour
        // differences and stays small while one column towers: the board that died
        // read 4,2,2,2,3,6, bumpiness 6, spread 4, with four rows sealed under
        // columns 2 to 4 and nothing able to reach the slab but column 6.
        // AND HOW MANY PANELS SHORT THE BOARD IS OF A HORIZONTAL THREE AT THE
        // SLAB'S FLOOR ROW -- the setup deficit.
        //
        // Named for what it measures and not for "distance to a break", which it is
        // not. Relaxed to the rule's true minimum -- the cheapest of a horizontal
        // three below the slab, a vertical three below it, or a cell reaching
        // alongside a partial slab -- it reads ZERO on the board it was written for,
        // because column six already touched the garbage there and still had no
        // break. The faithful measure is the inert one; this is the stricter target
        // that moves.
        //
        // Breaking needs three panels in a line touching the garbage, so every
        // column below the slab's floor is a column that cannot take part. Summed
        // over the board that is the panels still needed to reach it:
        //
        //     slabRowGap = SUM over c of max(0, (slabFloorRow - 1) - h[c])
        //
        // THE REFERENCE IS THE SLAB, NOT THE TALLEST COLUMN, and that is the whole
        // point. `spread` and the void both measure against `high`, so they can be
        // improved two ways -- raise the short columns, or pull the tall one down --
        // and only the first keeps the reach. Pulling the tall column down cannot
        // improve this, because the slab does not move when material leaves.
        //
        // Zero with no garbage on the board: nothing to reach.
        var gap = 0, floorRow = 0;
        for (c = 1; c <= w2; c++) {
            var gm = st2.garb[c] >>> 0;
            if (!gm) continue;
            var lowBit = gm & -gm, fr = 0;
            while (lowBit >>> fr) fr++;              // row index of the lowest garbage cell
            if (!floorRow || fr < floorRow) floorRow = fr;
        }
        // THE BEST THREE ADJACENT COLUMNS, NOT THE BOARD TOTAL.
        //
        // The total is invariant under the moves it was meant to steer. A swap that
        // clears nothing moves one panel sideways, so one column's deficit rises by
        // one and another's falls by one and the sum does not move at all -- it was
        // constant across nearly every candidate, and adding it changed not one
        // decision on the board it was written for.
        //
        // WHY THREE, WHEN THE RULE NEEDS ONLY ONE CELL. bitmatch breaks a slab when
        // any cleared cell is 4-way adjacent to any slab cell -- above, below or
        // beside (see the `hit` test in resolveFromMasks). So one column touching is
        // enough IN PRINCIPLE, and on the board this was written for column six was
        // already at the floor: the board touched the slab and still could not break
        // it, because its top three read 6,1,6.
        //
        // The two shapes are not equally available. A vertical three touching from
        // below needs three of the SAME colour stacked in one column. A horizontal
        // three along the slab's floor row needs three adjacent columns at that
        // height, and then any colour that matches across them will do. This measures
        // the distance to the second, which is the cheaper of the two to arrange --
        // not a claim that a break requires three columns.
        //
        // On heights 4,4,5,5,5,8 with the floor at r9 the windows read 11, 10, 9 and
        // 6: six panels short in columns four to six. Moving a panel from column
        // three into column four takes it to five, so unlike the total it ranks the
        // move -- it pays for gathering material where it can reach rather than
        // spreading it thin across columns that cannot.
        if (floorRow > 1) {
            var need = floorRow - 1, stride2 = w2 + 2;
            gap = Infinity;
            // THE HORIZONTAL ROUTE: three adjacent columns up at the slab's floor row,
            // after which any colour matching across them clears against the slab.
            for (c = 1; c + 2 <= w2; c++) {
                var win = Math.max(0, need - h[c]) + Math.max(0, need - h[c + 1]) +
                          Math.max(0, need - h[c + 2]);
                if (win < gap) gap = win;
            }
            // AND THE VERTICAL ROUTE, WITH ITS REAL COST. A column touching the slab
            // is not a column that can break it: on the board this was written for,
            // column six sat exactly at the floor and its top three read 6,1,6. Height
            // alone says zero and the board had no break at all. The honest cost is
            // the climb PLUS the panels missing from a run of three at the top, so
            // that column reads 0 + 2 = 2.
            for (c = 1; c <= w2; c++) {
                var climb = Math.max(0, need - h[c]);
                var run = 0;
                if (h[c] > 0) {
                    var topBit = 1 << (h[c] - 1), col = 0, a;
                    for (a = 1; a <= 12; a++) if (st2.colour[a * stride2 + c] & topBit) { col = a; break; }
                    if (col) {
                        var mask = st2.colour[col * stride2 + c] >>> 0;
                        for (var r2 = h[c]; r2 >= 1 && (mask & (1 << (r2 - 1))); r2--) run++;
                    }
                }
                // AND THE COLOUR HAS TO EXIST TO BE BROUGHT. A missing panel of HEIGHT
                // is any panel; a missing panel of a RUN is a specific colour that has
                // to be somewhere in the pocket and reachable. Counting them the same
                // undercounts badly: on the bowl 5,1,1,1,1,5 the horizontal route costs
                // 8 and this route claimed 2, so the board read two panels from a break
                // while it was really eight, and it sat in that shape for 560 frames
                // with no break available on a single decision.
                //
                // So the run is only worth continuing if the colour is actually there
                // in the pocket, three of them or more counting the ones already
                // stacked. Otherwise the route is not available and the horizontal one
                // governs.
                // IN THIS COLUMN OR BESIDE IT, not anywhere on the board. A run lives
                // in ONE column and a panel enters a column only from a horizontal
                // neighbour, so three of the colour scattered across columns one, two
                // and six are not three the run can use. Counting the whole pocket
                // still read the bowl at 2.
                var have = 0;
                if (col) {
                    for (var cc2 = Math.max(1, c - 1); cc2 <= Math.min(w2, c + 1); cc2++) {
                        var gm2 = st2.garb[cc2] >>> 0;
                        var fl2 = gm2 ? (gm2 & -gm2) : 0;
                        var bl2 = fl2 ? (fl2 - 1) : 0xffffffff;
                        have += bit.popcount((st2.colour[col * stride2 + cc2] & bl2) >>> 0);
                    }
                }
                var vert = (col && have >= 3) ? climb + Math.max(0, 3 - run) : Infinity;
                if (vert < gap) gap = vert;
            }
            if (!isFinite(gap)) gap = 0;
        }
        return { tall: tall, bumps: bumps, excess: dev / w2, mat: mean, low: low,
                 high: mx, spread: mx - low, slabRowGap: gap };
    }

    function optionOf(swaps, frames, r) {
        var sh = shapeOf(r.settled);
        return { kind: kindOf(r.chain), size: sizeOf(r.chain, r.total),
                 swaps: swaps, frames: frames, chain: r.chain, total: r.total,
                 garbage: r.garbage || 0,
                 // AND THE CELLS THAT ACTUALLY COME BACK. `garbage` is every on-screen
                 // cell of the slab, which is what the engine pops and what sets the
                 // resolve time; `converts` is its bottom row, the only part that
                 // becomes panels. See bitmatch for why both exist.
                 converts: r.converts || 0,
                 duration: durationOf(swaps, frames),
                 tall: sh ? sh.tall : null, bumps: sh ? sh.bumps : null,
                 mat: sh ? sh.mat : null, low: sh ? sh.low : null,
                 spread: sh ? sh.spread : null,
                 // THE VOID THE SLAB SEALS OVER, IN ROWS.
                 //
                 // Garbage rests on the TALLEST column and spans the width, so every
                 // column shorter than it has the difference in empty rows sealed
                 // underneath. Summed:
                 //
                 //   void = SUM(high - h[c]) = W*high - SUM(h) = W * (high - mat)
                 //
                 // so in rows it is (high - mat), and a row of void is a row of
                 // ceiling gone -- framesPerRow, like height.
                 //
                 // Nothing else sees it. `tall` does not move when a SHORT column
                 // drops, and `excess` is deviation about the mean, not a deficit
                 // against the column the slab rests on. Seed 103 reached 7,4,2,3,3,4
                 // -- 19 panels of void -- and by then every clear on the board
                 // emptied one of the short columns and made the seal worse, while
                 // nothing in the tower could be cleared at all. It has to be priced
                 // while the board is still healthy, which is why it is on the option
                 // and not in one route's value.
                 voidRows: sh ? (sh.high - sh.mat) : null,
                 // AND THE PANELS THE LANDED BOARD STILL NEEDS TO REACH ITS SLAB.
                 // shapeOf already computes it, colour feasibility included, so this
                 // costs nothing: see slabRowGap where it is derived.
                 slabGap: sh ? (sh.slabRowGap || 0) : null,
                 // CAN THE BOARD THIS LANDS ON STILL FIRE.
                 //
                 // Firing anything holds the floor for its resolve, and at
                 // maxHealth 1 that hold is the whole difference between living
                 // and not -- so a board with no clear anywhere on it is a board
                 // one row from dying, whatever it just sent. It is the same
                 // question `ready` asks of a route and readyOf asks of a node,
                 // asked of every option, because the paths that pick the move
                 // rank options and never look at either of those.
                 //
                 // null, not false, for a break: its settled board is unknowable,
                 // the way `low` is, and a null must not be read as "cannot fire".
                 ready: r.settled ? !!bit.anyOneSwapClear(r.settled) : null };
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
    var OVERHEAD = 0, RESOLVE = null, DIG = false, stopPrice = null, PREPARE = false;
    // The base board's own readiness, kept for breakReadyBoard below.
    var LASTBREAKREADY = null;

    // HOW MANY SWAPS BREAK A SLAB, BY BOARD. A pure function of the masks, asked of
    // every option the beam lands on and of the same boards again on the next decision,
    // which differs by one swap. Keyed on everything the answer reads: occupancy,
    // colours, garbage, the slabs and whether each is locked, and the cells busy enough
    // to refuse a swap.
    var SAVES = new Map(), SAVES_MAX = 50000;
    // THE FREEZE ONE SWAP CAN BUY, BY BOARD, the same way: bestOneSwapStop is a pure
    // function of the masks and of stopPrice, which reads only whether the board is
    // topped out -- timing.stopKey.
    var STOPS = new Map(), STOPKEY = '';
    function landStopOf(st) {
        if (!STOPKEY) return bit.bestOneSwapStop(st, stopPrice);
        var key = STOPKEY + boardKey(st), hit = STOPS.get(key);
        if (hit !== undefined) return hit;
        var v = bit.bestOneSwapStop(st, stopPrice);
        if (STOPS.size >= SAVES_MAX) STOPS.clear();
        STOPS.set(key, v);
        return v;
    }
    function boardKey(st) {
        var k = Array.prototype.join.call(st.occ, ',') + '|' + Array.prototype.join.call(st.inert, ',') +
                '|' + Array.prototype.join.call(st.garb, ',') + '|' + Array.prototype.join.call(st.colour, ',');
        for (var i = 0; st.slabs && i < st.slabs.length; i++) {
            k += '|' + Array.prototype.join.call(st.slabs[i], ',') + (st.slabLocked && st.slabLocked[i] ? 'L' : '');
        }
        if (st.busy) k += '|b' + Array.prototype.join.call(st.busy, ',');
        return k;
    }

    function options(board, W, H, cursor, depth, st, timing, dig) {
        // THE CLOCK IS NOT OPTIONAL, because every price in here is read off it.
        //
        // It used to be: `framesPerRow || 112`, `deadline || 0`, `reaction || 0`.
        // A caller that forgot got a board priced at a made-up rise, no deadline
        // and no cooldown -- and the setup gate below divides by the cooldown, so
        // the omission did not fail, it silently refused every setup on the board.
        // That is the same defect as the NaN this file already carries a test for,
        // with a number in place of the NaN, which is worse: it survives every
        // check that only asks for a finite number.
        // PRESENT, not merely truthy. A zero rise or a zero cooldown is a thing an
        // engine can say and a missing one is not, and `|| default` could not tell
        // them apart -- which is the whole defect being closed here.
        //
        // NOTHING IS UNPRICED. There is no caller that gets the list without the
        // clock: a list whose prices all read zero is a list with no ordering in
        // it, and every consumer of this -- the search, the feature vector, the
        // readiness gate -- is ranking or counting something off a board that has
        // a rise and a deadline whether or not the caller bothered to look them up.
        if (!timing || typeof timing.framesPerRow !== 'number' ||
            typeof timing.reaction !== 'number') {
            throw new Error('bitoptions.options: timing is required and needs ' +
                            'framesPerRow and reaction -- the rise and the cooldown ' +
                            'every price and the setup gate are derived from');
        }
        OVERHEAD = (timing && timing.overhead) || 0;
        RESOLVE = (timing && timing.resolve) || null;
        // DIGGING IS A GOAL, NOT A PREFERENCE. The caller sets it when the board
        // is buried and short of material, and it changes what the beam keeps --
        // see expandAll. Nothing else in here reads it.
        DIG = !!dig;
        // THE CLOCK, READ OFF THE ENGINE. framesPerRow is riseTime(speed) * 16 --
        // the engine's own rise, not a number typed here -- and deadline is how
        // long the board has before it tops out. Set here rather than beside the
        // beam because the depth-1 options below are built first, and `var` reads
        // as undefined until its statement runs: any price they took from these
        // came out NaN.
        var FPR = (timing && timing.framesPerRow) || 0;
        var DEADLINE = (timing && timing.deadline) || 0;
        stopPrice = (timing && timing.stopPrice) || null;
        STOPKEY = (timing && timing.stopKey) || '';
        PREPARE = !!(timing && timing.prepare);
        // ONE ROW OF CEILING, AT THE RATE THIS FILE PAYS FOR BEING NEAR A THING.
        // Breaking a row of slab hands the board back a row, which is FPR frames;
        // the hold that break also earns is priced separately, as `holds`. A board
        // that is one swap from the break rather than holding it counts at 1/W --
        // the same fraction a save (DEADLINE/W * W) and a dig cell one step from
        // one (DEADLINE/W) are already counted at.
        // WHAT READINESS IS WORTH, DERIVED, AND WHY BREAKING OUTRANKS FIRING.
        //
        // Holding a clear you can fire on demand buys the floor held for its own
        // resolve -- holdWorth, the engine's number, carried in because there is no
        // engine here. Breaking buys that hold AND a row of ceiling handed back, so
        // it is worth FPR more.
        //
        // Both are NEAR, not held: one swap away, and for the slab not even landed.
        // The file's rate for near-versus-holding is 1/W -- a save counts at
        // (DEADLINE/W)*W and a dig cell one step from one at DEADLINE/W -- so both
        // take it. Breaking then outranks firing by arithmetic rather than by a
        // precedence rule someone wrote.
        var HOLD = (timing && timing.holdWorth) || 0;
        var READYWORTH = HOLD / W;
        var PREPWORTH = (FPR + HOLD) / W;
        // THE MATERIAL FLOOR. bestAttack and bestPlan each refuse a move that
        // spends the board below it; none of the routes ranked in here did, and
        // they are the ones that pick the move on a dying board. Seed 103 walked
        // its columns to 1,0,1,0,3,4 -- nine panels under twenty-three cells of
        // garbage -- through six saves and four flattens, and died at 3,538.
        //
        // Priced the way bestPlan prices it, at a row of rise per row short, so a
        // route that starves the board pays what the starving costs.
        var WORK = (timing && timing.workingRows) || 0;
        // THE MOST A LANDING'S STOP TIME CAN BE WORTH, off the engine's own table
        // rather than guessed: the chain stop at the counter where it saturates.
        // Used only as a BOUND -- it decides which landings are worth the sweep that
        // measures them, never what one is worth.
        var MAXSTOP = stopPrice ? Math.max(stopPrice({ chain: 13, total: 3 }),
                                           stopPrice({ chain: 1, total: W * 2 })) : 0;
        // HOW MUCH SETUP THERE IS TIME FOR, which is the only question about a
        // setup worth asking.
        //
        // A break needs three panels in a line touching the slab. On a buried
        // board that is rarely one swap away, and the readiness credits above ask
        // exactly one -- slabReadyFast exchanges a single pair. So a break three
        // swaps out was priced the same as no break at all, on a board with four
        // hundred frames of ceiling and time for twenty swaps.
        //
        // DISTANCE IS NOT THE TEST. TIME IS. One decision costs one reaction
        // cooldown -- the bot issues a swap, waits it out, issues the next -- so
        // the decisions that fit before the board tops out are deadline/reaction.
        // That is the same division depthFor uses to pick the plan depth, read off
        // the same two engine numbers, so the search and the plan agree on how
        // much future there is.
        //
        // slabRowGap is the setup measured in panels and a swap places one, so a
        // setup of g panels is g decisions and fits when g <= setupSwaps. At a
        // deadline of several hundred that is most of them; with thirty frames
        // left it is none, which is right -- a board about to die cannot spend
        // four swaps building.
        //
        // AND IT IS THE CLOCK AT THE TIME THE SETUP WOULD BE PLAYED, not the clock
        // now. An option costs its own duration before any setup swap can follow it
        // -- the walk, the swap, the resolve -- and a depth-2 option costs two of
        // those. Measuring its setup against the frames the board has BEFORE
        // playing it credits a setup out of frames the option has already spent,
        // which is the same error as scoring a landed board by this frame's
        // deadline.
        // WHAT ONE SETUP SWAP COSTS, and it is not the cooldown alone. A decision is
        // a walk to the cell, the swap, and the cooldown before the next one -- which
        // is exactly `overhead`, already built by the caller as
        // travel.MOVE_FRAMES + reaction and already carried in here. Sixteen frames
        // at level 10, not twelve. Reusing it rather than dividing by `reaction`
        // means there is one answer in this file to "what does a move cost".
        var SWAP = OVERHEAD || ((timing && timing.reaction) || 0);
        //
        // AND WHAT THE SETUP IS WORTH, WHICH IS WHAT FINISHING IT BUYS.
        //
        // Finishing it is a break: a row of ceiling handed back, FPR, plus the floor
        // held for the clear's own resolve, HOLD. Both are the engine's numbers and
        // both are already here. That is the prize, so a setup `g` panels from done
        // is worth the prize discounted by the share of the remaining time it still
        // costs -- g swaps at SWAP frames each.
        //
        //     worth(g, left) = (FPR + HOLD) * (1 - g * SWAP / left)
        //
        // Full prize when there is nothing left to play, falling smoothly to zero as
        // the work grows to fill the time, and zero past that. No per-panel rate is
        // chosen: a panel is worth its share of the prize, so one of three done is
        // worth more than one of ten, which is the truth about setups. And no cliff
        // at the boundary -- the credit arrives at zero rather than dropping to it.
        function setupWorth(g, left) {
            if (g === null || g === undefined || !(left > 0)) return 0;
            var cost = g * Math.max(1, SWAP);
            if (cost >= left) return 0;
            return (FPR + HOLD) * (1 - cost / left);
        }
        // A CAP ON HOW MANY LANDINGS GET ASKED. slabReadyFast walks the landed
        // board, so neither list can ask it of everything. Declared here and reset
        // in expandAll, so the beam gets the same cap the depth-1 list does.
        var prepBudget = 24;
        // The drop test is a sweep inside a sweep, so it gets the tightest
        // budget of any of them.
        dropBudget = 8;
        var now = [], next = [], i, j;
        if (!st) st = bit.maskState(board.grid, board.blocks, W, H);
        // THE EMPTIEST COLUMN BEFORE ANY MOVE, so an option can be asked whether
        // IT is the one that opens a hole rather than merely landing on a board
        // that has one.
        var START = shapeOf(st);
        var BASELOW = START ? START.low : 0;
        var BASEBUMPS = START ? START.bumps : 0;
        // AND WHETHER THE BOARD CAN BREAK AT ALL BEFORE ANY MOVE, for the same
        // reason: an option is asked whether IT takes the last way to break, not
        // whether it merely lands on a board that has none. False when there is no
        // garbage, and then nothing can close what was never open.
        var BASEVOID = START ? (START.high - START.mat) : 0;
        // AND HOW FAR THE SETUP FOR A BREAK IS BEFORE ANY MOVE, for the same
        // reason the void has a base: the panels a board still needs to reach its
        // slab are a fact about the position, and only the CHANGE is about the move.
        var BASEGAP = START ? (START.slabRowGap || 0) : 0;
        var BASEBREAK = breakReadyOf(st) === true;
        LASTBREAKREADY = BASEBREAK;
        // AND HOW MANY WAYS THERE ARE TO REACH THE GARBAGE BEFORE ANY MOVE.
        //
        // THE SLOPE THE FLAG DOES NOT HAVE. `breakReady` is a cliff: on a buried
        // board it is false on nearly everything -- 7,863 of 8,653 landings over
        // one duel -- so it says the board is sealed and never says which way is
        // out. `dig` counts the cells that would finish a line against the slab,
        // so it moves one at a time and a move can be judged on whether it got
        // closer. Set here rather than in expandAll because the depth-1 options
        // are built before that runs, and a base of zero makes every gain look
        // like progress.
        BASEDIG = DIG ? reachOf(st).dig : 0;
        // THE MOVE JUST PLAYED, WHEN REPLAYING IT WOULD SIMPLY UNDO IT.
        //
        // Measured over one duel: 219 decisions repeated the previous move, 177 of
        // them with a panel in BOTH cells -- a true exchange, so the board came back
        // to exactly where it had been. 42 had one cell empty, which is a panel
        // sliding along and is ordinary play. The 177 are decisions spent going
        // nowhere while the floor keeps rising.
        //
        // The repeats came from every route -- bestAttack 47, levelFirst 31,
        // survivalPlan 28, flatten 28, digPlan 24, attackPlan 22 -- so a rule that
        // narrows one route's list cannot reach them. Excluded HERE, where all of
        // them get their options, so each picks its own next best and there is
        // nothing to substitute and nothing to reconcile.
        //
        // A move that CASHES is never excluded: swap, let a stack drop, swap the
        // same cells again is how a board reaches a slab it could not touch.
        var AVOID = (timing && timing.avoidSwap) || null;
        function undoesLast(row, col, res) {
            if (!AVOID || !AVOID.length) return false;
            if (res && (res.total > 0 || res.scope === 'garbage-broke')) return false;
            var b = 1 << (row - 1);
            if (!(st.occ[col] & b) || !(st.occ[col + 1] & b)) return false;
            for (var q = 0; q < AVOID.length; q++) {
                if (AVOID[q][0] === row && AVOID[q][1] === col) return true;
            }
            return false;
        }
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
            if (undoesLast(swaps[i][0], swaps[i][1], r)) { refused++; continue; }
            if (r.total === 0 && !broke) continue;           // clears nothing: a setup, not an option
            var opt = optionOf([swaps[i]], travel.cost(cursor[0], cursor[1], swaps[i][0], swaps[i][1]), r);
            opt.breaks = broke;
            // HORIZONTAL AND VERTICAL ARE NOT THE SAME MOVE, AND THE DIFFERENCE IS
            // THE SHAPE. A vertical three takes three panels out of ONE column and
            // drops it three below its neighbours; a horizontal three takes one from
            // each of three and leaves the surface where it was. No need to detect
            // which it is -- the landed board's bumpiness says it outright.
            opt.levels = opt.bumps !== null && opt.bumps <= BASEBUMPS;
            // THE STEP IS NOT PRICED, AND SIX ATTEMPTS AT A SHAPE TERM SAY WHY NOT.
            //
            // `bumps` is the total step between neighbouring columns, the one number here
            // that sees a CLIFF. Both rankers carry it and both use it only as a tiebreak
            // between plans buying life at the same rate -- which, as this file says of
            // `ways`, never happens. On a board that died holding 8,9,6,6,6,9 for forty
            // decisions that looked like dead decoration worth fixing.
            //
            // Priced as a delta at the per-cell rate, read by both rankers -- every lesson
            // from the day's earlier failures applied -- it cost both boards: 103 STARTER
            // v rand3 went 23,209 to 11,387, and 101 rand2 v rand3 went from alive on both
            // sides to dead at 19,201.
            //
            // THAT IS SIX FOR SIX. wells as a credit per row, wells per cell, wells charged
            // and never credited, the material ceiling, the raise stand-down, and this.
            // Every local geometry term added to the frames-priced rankers made boards
            // worse, at every size and sign tried. What those rankers already have -- the
            // void, the setup distance, the ceiling given back, the material floor -- is
            // what they can use, and a new shape term does not add information so much as
            // displace them.
            //
            // The one change that worked all day was not geometry: making preparation
            // unconditional, so the board is built for the slab before it lands instead of
            // reshaped after. Anticipation, not shape.
            opt.opensHole = opt.low === 0 && BASELOW > 0;
            opt.breakReady = r.settled ? breakReadyOf(r.settled) : null;
            // THE MOVE THAT TAKES THE LAST WAY TO BREAK.
            //
            // A TRANSITION, THE WAY opensHole IS, AND NOT A STATE. `breakReady`
            // false on its own says the landed board cannot break -- which is just
            // as true of a board that already could not, so refusing on it punishes
            // a position rather than the move that made it, and on a board with no
            // break left it throws every option away. Measured that way: three
            // deaths among STARTER and ZERO in thirteen pairings against none in
            // sixty. `low === 0 && BASELOW > 0` is the shape that works and this is
            // the same shape.
            //
            // It can never empty the list: silent when the base board cannot break,
            // and when it can, the move that KEEPS the break is by definition still
            // on it. And it is a cliff rather than a slope -- two ways to break
            // down to one is ordinary, one down to none ends the game -- which is
            // why a price was the wrong instrument for it.
            //
            // null on a break stays null: a break's settled board is unknowable and
            // a null is not a no.
            opt.closesBreak = BASEBREAK && opt.breakReady === false;
            // WHETHER IT GOT CLOSER TO A BREAK, OR FURTHER AWAY.
            //
            // Priced by both rankers at one panel of life a cell -- perPanel in
            // bestPlan, one cell sent in bestAttack -- and NOT at the deadline/W the
            // flatten value below pays a dig cell ("being NEAR one is worth a fraction
            // of it"). At a deadline of 600 that is 100 frames, near a whole row of
            // ceiling, and one cell that MIGHT finish a line outweighed a six-combo.
            // See bestAttack for the measurement. NOT CALIBRATED.
            //
            // The flatten pricing existed and was asked only of routes that CLEAR
            // NOTHING, so every combo and every chain was ranked without anyone asking
            // what it did to the board's way out from under the slab.
            //
            // Zero off the slab: with no garbage there is nothing to dig toward. Zero on
            // a break too -- its settled board is unknowable.
            opt.digGain = (DIG && r.settled) ? reachOf(r.settled).dig - BASEDIG : 0;
            // AND THE CHANGE IN THAT VOID, a delta for the same reason digGain is
            // one: an absolute count is a fact about the position, not the move.
            opt.voidGain = (opt.voidRows === null || opt.voidRows === undefined)
                             ? 0 : (BASEVOID - opt.voidRows);
            // AND HOW MUCH CLOSER IT GOT TO A SETUP THERE IS TIME FOR.
            //
            // Two halves, and the second is the one that was missing. `slabGap` is how
            // many panels the landing still needs before three in a line can touch the
            // slab; setupWorth turns that into the frames a finished setup pays --
            // a row of ceiling plus the hold -- discounted by the share of the time
            // left that the remaining work costs. This is its DELTA, read by both
            // rankers, each against its own clock: the option spends its own duration
            // before any setup swap can follow it.
            //
            // NO CLIFF AT THE BOUNDARY: the credit ARRIVES at zero as the work grows to
            // fill the time, rather than being cut off at a threshold. That is
            // what makes this a clock and not a distance: with four hundred frames of
            // ceiling a four-swap setup is worth starting, and with thirty frames left
            // the same setup is not.
            //
            // Zero off the slab -- slabGap is 0 with no garbage, so gain is 0 too -- and
            // zero on a break, whose settled board is unknowable.
            opt.slabGain = setupWorth(opt.slabGap, DEADLINE - (opt.duration || 0))
                             - setupWorth(BASEGAP, DEADLINE);
            // AND THE HOLES IT DIGS, as a delta for the same reason.
            // NO GEOMETRIC HOLE TERM. THREE OF THEM WERE MEASURED AND ALL WERE WORSE.
            //
            // `wells` was the depth of each column below the lower of its neighbours
            // -- the one shape number that can see a hole, since `excess` and the void
            // are averages, `slabRowGap` is a minimum over windows and read the move
            // that dug one as zero, and `spread` falls when the tallest column (the
            // one touching the slab) is pulled down.
            //
            // Credited as a delta at a row of rise per row of depth: 101 rand2 v
            // rand3, 101 rand2 v rand4 and 103 rand1 v rand4, all three alive before,
            // died; one death fixed. Repriced in cells, which is what a well actually
            // is: two of the first two pairings died, at 4,229 and 24,415. Made
            // one-sided -- charged for digging, never credited for filling, so that
            // lowering a hole's neighbours could not be paid for: FOUR deaths in eight
            // boards, two of them at 1,805 frames, which is the signature of a bot
            // that will not clear, because on an awkward board most clears deepen some
            // column somewhere.
            //
            // AND THE DEEPER REASON IT CANNOT WORK: A STEP IS WHAT A CHAIN IS MADE OF.
            //
            // A chain needs panels to FALL into place -- clear low, the stack above
            // drops, the drop completes the next group. The steps and dips in the
            // surface are that mechanism; a flat board cannot chain at all. So a term
            // charging for a column sitting below its neighbours is charging for the
            // structure combos and chains are built out of, which is why no price and
            // no sign for it came out ahead.
            //
            // THE GEOMETRY IS THE WRONG INSTRUMENT. A hole matters only if it costs
            // the board what it can DO, and that question is already asked by
            // lookahead rather than by shape: slabReadyFast on the landing (priced as
            // slabWorth), slabRowGap through the depth-2 beam (priced as slabGain),
            // waysOf, readyOf, breakReadyOf, and nextBestChain/nextBestCombo in the
            // vector. A hole that costs capability shows up in those; one that does
            // not is not worth charging for. And the board this chain started from
            // died holding 43 panels in FOUR columns -- height, which `tallest` and
            // bestPlan's `lowered` already price.
            // AND WHETHER THE BOARD IT LANDS ON COULD ANSWER THE NEXT SLAB.
            //
            // slabReadyFast asks whether a three can be put against the row the next
            // slab will rest on. Only asked when there IS a slab to be ready for, on
            // the board or queued, and only while the budget holds; zero otherwise,
            // never a charge. PREPWORTH is derived where it is declared.
            opt.slabWorth = (PREPARE && prepBudget > 0 && r.settled &&
                             (prepBudget--, slabReadyFast(r.settled))) ? PREPWORTH : 0;
            // AND WHAT THE BOARD HELD BEFORE THE MOVE, in rows of material. Whether the
            // board is BURIED AND SHORT is a fact about the position and not about the
            // move, so it cannot be read off the landing -- and `mat` is null on a break,
            // which is exactly the move that matters here. The threshold stays with the
            // caller: this carries the number, WORKING_ROWS lives in bitbot.
            opt.matNow = START ? START.mat : null;
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
            // ONE IMPLEMENTATION OF THIS QUESTION, IN bitmatch. hasFireable in
            // bitbot asked it too, with its own copy of the same sweep.
            return bit.anyOneSwapClear(state) ? 1 : 0;
        }

        // CAN THE BOARD THIS LANDS ON BREAK ITS GARBAGE.
        //
        // A garbage cell comes off the board one way: three panels in a line
        // against it. Every board in the six deaths of the last round-robin had
        // clears to fire and was firing them -- what none of them had was three
        // adjacent columns reaching the slab's underside. Measured across the
        // six: spread 4 to 6, and the longest run of columns touching the slab
        // was two. Two is not three, so the garbage could never come off, and a
        // garbage cell that never comes off is a row of ceiling gone for good.
        //
        // null when the landed board carries no garbage -- the question does not
        // apply, and a null is not a no. Being ready for the slab that has not
        // landed yet is a different question and the readiness credit already asks it.
        function breakReadyOf(state) {
            var c, any = false;
            for (c = 1; c <= W; c++) if (state.garb[c]) { any = true; break; }
            if (!any) return null;
            if (savesOfRaw(state) > 0) return true;
            // ONE SWAP IS NOT THE QUESTION. A board with no swap that breaks the
            // slab outright is not a sealed board: a clear underneath drops what
            // was resting on it, the slab comes down onto the material, and the
            // break is there on the board after. Asked one swap deep, most buried
            // boards read sealed -- and every rule built on this then treats a
            // position with a way out as a position without one.
            return breakAfterDropOf(state);
        }

        // THE BREAK ON THE OTHER SIDE OF A DROP.
        //
        // Each clearing swap is resolved to where the board SETTLES -- which is
        // the engine's own gravity, so the slab falling is not a guess -- and the
        // settled board is asked the one-swap question. Two swaps deep, no more:
        // the first makes room, the second reaches what came down.
        //
        // Budgeted, because this is a sweep inside a sweep. Out of budget returns
        // false, which is the same answer the one-swap test gave on its own, so
        // running short can only make this less informed, never wrong in a new way.
        function breakAfterDropOf(state) {
            if (dropBudget <= 0) return false;
            dropBudget--;
            var sw = bit.legalSwapsOf(state), i, r;
            for (i = 0; i < sw.length; i++) {
                if (!bit.swapMasks(state, sw[i][0], sw[i][1])) continue;
                r = bit.resolveFromMasks(state, true);
                bit.swapMasks(state, sw[i][0], sw[i][1]);
                if (r.scope === 'garbage-broke') return true;
                if (r.scope !== 'ok' || r.total === 0 || !r.settled) continue;
                // ASKED EXACTLY, on the board the drop leaves. `dig` is not a
                // cheaper form of this question: it counts cells that COMPLETE a
                // line and sit next to the slab, which is most of the answer
                // already, so gating on it threw away the landings this exists for
                // and the board died on its original frame. The sweep is the price.
                if (savesOfRaw(r.settled) > 0) return true;
            }
            return false;
        }

        function savesOfRaw(state) {
            var key = boardKey(state), hit = SAVES.get(key);
            if (hit !== undefined) return hit;
            var sw = bit.legalSwapsOf(state), n = 0, i, r;
            for (i = 0; i < sw.length; i++) {
                if (!bit.swapMasks(state, sw[i][0], sw[i][1])) continue;
                r = bit.resolveFromMasks(state, false);
                bit.swapMasks(state, sw[i][0], sw[i][1]);
                if (r.scope === 'garbage-broke') n++;
            }
            if (SAVES.size >= SAVES_MAX) SAVES.clear();
            SAVES.set(key, n);
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
        var slabBudget = 0, dropBudget = 0;

        function expandAll(state0, depth) {
            BASE = shapeOf(state0);
            BASEDIG = DIG ? reachOf(state0).dig : 0;
            saveBudget = 192;
            slabBudget = 24;
            prepBudget = 24;
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
                        // AND NOT THE UNDO, when it is the move that would be PLAYED.
                        // Only ply one is played; a repeat deeper in a sequence is a
                        // hypothetical continuation off a board that has already
                        // changed, which is not an undo of anything.
                        if (ply === 1 && undoesLast(sw[0], sw[1], res)) continue;
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
                                opt.breakReady = res.settled ? breakReadyOf(res.settled) : null;
                                opt.closesBreak = BASEBREAK && opt.breakReady === false;
                                // WHETHER IT GOT CLOSER TO A BREAK, OR FURTHER AWAY.
                                // See the one-swap path above for what it is and what
                                // it is priced at.
                                opt.digGain = (DIG && res.settled) ? reachOf(res.settled).dig - BASEDIG : 0;
                                // AND THE CHANGE IN THAT VOID, a delta for the same reason digGain is
                                // one: an absolute count is a fact about the position, not the move.
                                opt.voidGain = (opt.voidRows === null || opt.voidRows === undefined)
                                                 ? 0 : (BASEVOID - opt.voidRows);
                                // AND HOW MUCH CLOSER IT GOT TO A SETUP THERE IS TIME FOR.
                                //
                                // Two halves, and the second is the one that was missing. `slabGap` is how
                                // many panels the landing still needs before three in a line can touch the
                                // slab; setupWorth turns that into the frames a finished setup pays --
                                // a row of ceiling plus the hold -- discounted by the share of the time
                                // left that the remaining work costs. This is its DELTA, read by both
                                // rankers, each against its own clock.
                                //
                                // NO CLIFF AT THE BOUNDARY: the credit ARRIVES at zero as the work grows to
                                // fill the time, rather than being cut off at a threshold. That is
                                // what makes this a clock and not a distance: with four hundred frames of
                                // ceiling a four-swap setup is worth starting, and with thirty frames left
                                // the same setup is not.
                                //
                                // Zero off the slab -- slabGap is 0 with no garbage, so gain is 0 too -- and
                                // zero on a break, whose settled board is unknowable.
                                opt.slabGain = setupWorth(opt.slabGap, DEADLINE - (opt.duration || 0))
                             - setupWorth(BASEGAP, DEADLINE);
            // AND THE HOLES IT DIGS, as a delta for the same reason.
                                // AND WHETHER THE BOARD IT LANDS ON COULD ANSWER THE NEXT SLAB.
                                //
                                // slabReadyFast asks whether a three can be put against the row the next
                                // slab will rest on. Only asked when there IS a slab to be ready for, on
                                // the board or queued, and only while the budget holds; zero otherwise,
                                // never a charge. PREPWORTH is derived where it is declared.
                                opt.slabWorth = (PREPARE && prepBudget > 0 && res.settled &&
                                                 (prepBudget--, slabReadyFast(res.settled))) ? PREPWORTH : 0;
                                // AND WHAT THE BOARD HELD BEFORE THE MOVE, in rows of material. Whether the
                                // board is BURIED AND SHORT is a fact about the position and not about the
                                // move, so it cannot be read off the landing -- and `mat` is null on a break,
                                // which is exactly the move that matters here. The threshold stays with the
                                // caller: this carries the number, WORKING_ROWS lives in bitbot.
                                opt.matNow = START ? START.mat : null;
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
                            // `ready` and `save` -- the two routes the caller falls
                            // back on -- are chosen below, once `val` exists. Picking
                            // them here, by cost, was picking them before anyone had
                            // asked what board they land on.
                            var sh2 = shapeOf(res.settled);
                            var svNow = 0;
                            if (sh2) {
                                var dur = durationOf(seq, cost);
                                // FLATTENING HAS TO CREATE SETUP WHILE IT DOES IT.
                                //
                                // Flatness and height were the whole value, and ways
                                // -- the cells that would complete a line, which is
                                // the measure of whether a board is set up at all --
                                // only broke a tie between two routes scoring
                                // EXACTLY equal, which never happens. So the search
                                // walked to a perfectly level board with nothing on
                                // it to fire: seed 103 died at 1,581 on columns
                                // 5,4,4,4,4,4, bumpiness 1, four rows of material,
                                // and no clear one swap away anywhere -- while a
                                // three sat two swaps off, a 5 slid twice to the
                                // right onto a pair already stacked in column 5.
                                //
                                // So ways are part of the number, priced at what the
                                // clear they lead to holds.
                                // A WAY IS NOT WORTH A CLEAR, SO IT IS NOT A TERM.
                                //
                                // Priced linearly at what a clear holds, ways
                                // swamped everything: a real mid-game board carries
                                // twenty of them, so a route gaining eight scored
                                // 472 frames against 112 for a whole row of ceiling.
                                // The form is wrong, not the constant -- the board
                                // fires one clear at a time, so twenty ways do not
                                // buy twenty clears' worth of held floor. They buy
                                // the certainty that ONE is available, and that
                                // value saturates after the first.
                                //
                                // So setup enters as a condition, below, not as a
                                // number here.
                                var ways2 = waysOf(res.settled);
                                // AND WHAT THE BOARD IT LANDS ON CAN BUY, IN THE SAME
                                // FRAMES. Height and evenness are priced at FPR a row;
                                // a freeze is priced in frames outright, so it adds.
                                //
                                // Measured before this was a term: of 150 real boards,
                                // 72 offered a flatten and 69 of those landed somewhere
                                // worth ZERO frames. They could fire -- what they could
                                // fire was a payless three. Flatness chose every one of
                                // them, and a route landing on a chain lost to a route
                                // landing on nothing because the chain was not in the
                                // number.
                                //
                                // A QUOTA MADE THE COMPARISON ARBITRARY, so it is a
                                // bound instead.
                                //
                                // bestOneSwapStop is a sweep inside a sweep, so it
                                // cannot be asked of every landing -- it used to be
                                // capped at 24 a decision, first come first served.
                                // That is worse than not having it: two landings that
                                // can both fire a chain are compared as 94 against 0
                                // because the quota ran out between them, and the
                                // file's own test reports only 14 of 48 flattens
                                // carrying the term at all. The post-hoc fill at the
                                // bottom of this function then puts the number on the
                                // WINNER, after `val` has already chosen it, so the
                                // term reported rather than decided.
                                //
                                // Asked instead of any landing that could win if the
                                // credit were as large as the credit can get -- MAXSTOP
                                // off the engine's own table, the chain stop at the
                                // counter where it saturates. Every landing that could
                                // still win is asked, nothing that cannot is, and the
                                // comparison between the ones that matter is consistent.
                                // Same shape as the readiness credits below.
                                var base2 = (BASE.tall - sh2.tall) * FPR
                                          + (BASE.excess - sh2.excess) * FPR
                                          - Math.max(0, WORK - sh2.mat) * FPR
                                          - dur;
                                var landStop = 0;
                                if (stopPrice &&
                                    (!flat || base2 + MAXSTOP > flat.value)) {
                                    landStop = landStopOf(res.settled);
                                }
                                var val = base2 + landStop;
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
                                svNow = sv;
                                val += (sv - BASESAVE) * (DEADLINE / W) * W
                                     + (rr.dig - BASEDIG) * (DEADLINE / W);
                            }
                                // TWO WINNERS: THE FLATTEST, AND THE FLATTEST THAT
                                // LANDS ABLE TO FIRE.
                                //
                                // The caller refuses a route that lands with nothing
                                // to fire -- but refusing the winner after the fact
                                // means the route that IS ready and a shade less flat
                                // was never in the running. Seed 103 levelled to
                                // columns 5,4,4,4,4,4, bumpiness 1, and had no clear
                                // one swap away anywhere on it; a three sat two swaps
                                // off, a 5 slid twice right onto a pair already
                                // stacked in column 5.
                                //
                                // So both are kept and the ready one is preferred.
                                // readyOf is budgeted and only asked of a route that
                                // would otherwise win, which is a handful a sweep.
                                // ONE WINNER, WITH READINESS IN THE NUMBER.
                                //
                                // There were three -- the flattest, the flattest that
                                // lands able to fire, the flattest that lands able to
                                // break -- all ranked by this same `val` and differing
                                // only in which landings they would accept, then
                                // reconciled afterwards by hand: the firing one taken
                                // outright, the breaking one only on a tie. Those two
                                // lines WERE the ordering, and they had firing above
                                // breaking, which is backwards -- firing is how a board
                                // breaks and breaking is how it stops dying.
                                //
                                // Priced instead, there is one argmax and nothing to
                                // reconcile. It also answers the measurement that
                                // bounded the old override to ties: taken outright it
                                // cost 10 deaths over 24 pairings against 7 over 30,
                                // because it bought readiness at ANY loss of flatness.
                                // A credit cannot do that -- it is worth what it is
                                // worth and the flatter board still wins when it is
                                // worth more.
                                //
                                // THE PREDICATES ARE SWEEPS, so each is asked only of a
                                // landing that could win once credited. That is the
                                // bound the old budgets were protecting, stated exactly
                                // rather than as a quota.
                                var credit = 0;
                                var floor2 = flat ? flat.value : -Infinity;
                                if (slabBudget > 0 && val + PREPWORTH > floor2) {
                                    slabBudget--;
                                    if (slabReadyFast(res.settled)) credit = PREPWORTH;
                                }
                                if (!credit && val + READYWORTH > floor2 &&
                                    readyOf(res.settled)) {
                                    credit = READYWORTH;
                                }
                                val += credit;
                                var take = !flat || val > flat.value;
                                // AND THE TWO FALLBACK ROUTES, ON THE SAME NUMBER.
                                //
                                // `save` is the route back to holding a break and
                                // `ready` the route back to having anything to fire.
                                // Both were chosen by what the WALK cost, with no
                                // term for the board at the end of it, while the
                                // three winners above were chosen by `val` -- which
                                // prices height, evenness, what the landing can fire
                                // and what it digs. So the cheapest save could be the
                                // one that empties a column, and planSave plays the
                                // route it is handed: seed 103 walked its columns
                                // 5,5,5,2,2,3 -> 5,5,1,1,1,3 through four of them and
                                // the slab went from sealing three rows to four.
                                //
                                // Nothing here is new arithmetic. `val` is already
                                // computed for this landing a few lines up; these two
                                // were simply decided before it existed. Cost stays as
                                // the tiebreak, so between two landings worth the same
                                // the shorter walk still wins.
                                if (svNow > 0 && (!save || val > save.value ||
                                                  (val === save.value && cost < save.frames))) {
                                    save = { swaps: seq, frames: cost, value: val,
                                             duration: durationOf(seq, cost) };
                                }
                                if ((!ready || val > ready.value ||
                                     (val === ready.value && cost < ready.frames)) &&
                                    readyOf(res.settled)) {
                                    ready = { swaps: seq, frames: cost, value: val,
                                              duration: durationOf(seq, cost) };
                                }
                                if (take) {
                                    // THE BOARD IT LANDS ON, CARRIED WITH THE PLAN.
                                    // The swaps and the physics are deterministic, so
                                    // this is not a prediction -- it is where the board
                                    // WILL be. A caller can ask it anything it would ask
                                    // a real board before committing to the route.
                                    flat = { swaps: seq, frames: cost, value: val,
                                             tall: sh2.tall, bumps: sh2.bumps,
                                             ways: ways2, duration: dur,
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
        // THE ONE THAT LANDS READY, WHEN THERE IS ONE. Both are worth more than they
        // cost by the test above; between them, the board that can fire when it
        // arrives is the one to arrive at.

        // AND READY FOR WHAT LANDS BEATS MERELY READY -- BUT NEVER AT A PRICE.
        //
        // Taken outright it measured worse: 10 deaths over 24 pairings with 2 among
        // STARTER and ZERO, against 7 over 30 with none. The reason is in the shape
        // of the override -- it took the slab-ready route however much flatter the
        // alternative was, so readiness was bought with levelling the board needed.
        // Bounded to routes that are not worse, it can only pick a different winner
        // among equals.

        // AND THE BIGGEST FREEZE AT THE FAR END BEATS MERELY LANDING ABLE TO FIRE,
        // ON THE SAME TERMS THE SLAB OVERRIDE IS ON: never at the price of a
        // flatter board. Taken outright, the slab version of this measured 10
        // deaths over 24 pairings against 7 over 30 -- readiness bought with
        // levelling the board needed. Bounded to routes that are not worse, it can
        // only pick a different winner among equals.
        // AND WHATEVER WINS CARRIES WHAT ITS DESTINATION IS WORTH. One call on the
        // route actually chosen, not one per contender: the caller decides whether
        // to commit to a flatten by what it can do on arrival, and a route that
        // lands on a bare three and one that lands on a chain are 94 frames apart.
        if (stopPrice && flat && flat.lands && flat.landStop === undefined) {
            flat.landStop = landStopOf(flat.lands);
        }

        return { now: now, next: next, cheapest: cheapest, flatten: flat, save: save,
                 ready: ready,
                 swapsConsidered: swaps.length, refused: refused, unknown: unknown };
    }

    // Exposed so the exit gate asks the SAME question the option list asks.
    // `low === 0 && baseLow > 0` is the whole of opensHole, and two copies of it
    // is how the two lists come to disagree about what a hole is.
    // IS THIS BOARD ONE SWAP FROM A CLEAR THAT BREAKS WHAT LANDS ON IT.
    //
    // Garbage rests on the tallest column and spans the width, so the row that
    // comes down next is one block at that height, and only a clear reaching the
    // row beneath it touches that block. "Can this board fire" is a different
    // question and accepts a three in the pocket that answers nothing.
    //
    // Nothing in the search reads this today. Preferring a levelling route that
    // lands this way was measured and came back worse -- 10 deaths over 24
    // pairings with 2 among STARTER and ZERO, against 7 over 30 with none. It is
    // kept because the question is the right one and the unit tests pin its
    // meaning; what has not been found is where the answer is worth acting on.
    function slabReadyBoard(st) {
        var t = 0, c, top, Wl = (st && st.W) || 6, Hl = (st && st.H) || 12;
        for (c = 1; c <= Wl; c++) { top = 32 - Math.clz32(st.occ[c] >>> 0); if (top > t) t = top; }
        if (t >= Hl) return false;
        var s2 = bit.copyState(st), b = 1 << t, sm = new Int32Array(Wl + 2), i, r;
        for (c = 1; c <= Wl; c++) { s2.occ[c] |= b; s2.inert[c] |= b; s2.garb[c] |= b; sm[c] = b; }
        s2.slabs.push(sm);
        s2.slabLocked.push(false);
        var sw = bit.legalSwapsOf(s2);
        for (i = 0; i < sw.length; i++) {
            if (!bit.swapMasks(s2, sw[i][0], sw[i][1])) continue;
            r = bit.resolveFromMasks(s2, false);
            bit.swapMasks(s2, sw[i][0], sw[i][1]);
            if (r && r.scope === 'garbage-broke') return true;
        }
        return false;
    }

    // THE SAME QUESTION AS ARITHMETIC.
    //
    // slabReadyBoard lays a slab on a copy, sweeps every legal swap on the board
    // and resolves each one. Almost all of that work cannot matter: garbage lands
    // as one row at the height of the tallest column, so a clear only touches it
    // by lying IN the row beneath it, and only a swap in that row or the two below
    // can put one there. Everything else is a resolve spent to learn nothing.
    //
    // So this looks at three rows and does the matching with bit operations. A
    // swap exchanges two bits in one row; a horizontal three is three consecutive
    // columns carrying a colour in the target row, and a vertical three is one
    // column carrying it on three consecutive rows ending at the target.
    //
    // ONLY SWAPS BETWEEN TWO OCCUPIED CELLS. On a settled board those cannot make
    // anything fall, so the board after the swap is the board with two bits
    // exchanged and nothing else. A swap into an empty cell can drop a panel, and
    // a dropped panel never rises into the target row -- it can only leave it, so
    // the answer this gives is never a false yes.
    function slabReadyFast(st) {
        var Wl = (st && st.W) || 6, Hl = (st && st.H) || 12, stride = Wl + 2;
        var t = 0, c, top, a, r;
        for (c = 1; c <= Wl; c++) { top = 32 - Math.clz32(st.occ[c] >>> 0); if (top > t) t = top; }
        if (t >= Hl || t < 1) return false;
        var target = 1 << (t - 1);            // the row the slab rests on
        var N = st.N;
        // colour bits per column, copied so a swap can be applied and undone
        var col = [];
        for (a = 1; a <= N; a++) for (c = 1; c <= Wl; c++) col[a * stride + c] = st.colour[a * stride + c] >>> 0;

        function colourAt(cc, bitv) {
            for (var aa = 1; aa <= N; aa++) if (col[aa * stride + cc] & bitv) return aa;
            return 0;
        }
        function matchesTarget() {
            for (var aa = 1; aa <= N; aa++) {
                // horizontal: three consecutive columns carrying aa in the target row
                var runlen = 0;
                for (var cc = 1; cc <= Wl; cc++) {
                    if (col[aa * stride + cc] & target) { runlen++; if (runlen >= 3) return true; }
                    else runlen = 0;
                }
                // vertical: aa on three consecutive rows ending at the target row
                if (t >= 3) {
                    for (var c2 = 1; c2 <= Wl; c2++) {
                        var m = col[aa * stride + c2];
                        if ((m & target) && (m & (target >> 1)) && (m & (target >> 2))) return true;
                    }
                }
            }
            return false;
        }

        var rows = [t, t - 1, t - 2];
        for (var ri = 0; ri < rows.length; ri++) {
            r = rows[ri];
            if (r < 1) continue;
            var bitv = 1 << (r - 1);
            for (c = 1; c < Wl; c++) {
                var left = colourAt(c, bitv), right = colourAt(c + 1, bitv);
                if (!left || !right || left === right) continue;   // empty or nothing to exchange
                col[left * stride + c] &= ~bitv;  col[left * stride + c + 1] |= bitv;
                col[right * stride + c + 1] &= ~bitv; col[right * stride + c] |= bitv;
                var hit = matchesTarget();
                col[left * stride + c] |= bitv;   col[left * stride + c + 1] &= ~bitv;
                col[right * stride + c + 1] |= bitv; col[right * stride + c] &= ~bitv;
                if (hit) return true;
            }
        }
        return false;
    }

    // EXPOSED SO THE GATE ASKS THE SAME QUESTION THE SEARCH ASKS. The drop test
    // inside it is what separates a sealed board from one that only looks sealed
    // one swap deep, and a gate that cannot call it cannot check that.
    function breakReadyBoard(st, timing) {
        options(null, st.W, st.H, [1, 1], 1, st, timing, true);
        return LASTBREAKREADY;
    }
    return { options: options, kindOf: kindOf, sizeOf: sizeOf, shapeOf: shapeOf,
             slabReadyBoard: slabReadyBoard, slabReadyFast: slabReadyFast,
             breakReadyBoard: breakReadyBoard };
}));
