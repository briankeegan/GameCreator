// LINING UP WITH WHAT HAS JUST BEEN REVEALED.
//
// A slab breaks. Its bottom row takes REAL COLOURS and then hovers for a while
// before it drops. Those colours are on the board — nothing is predicted — and
// for as long as the panels are in the air there is time to move what is
// underneath and beside them, so that the landing completes a chain instead of
// just filling the hole.
//
// THE WINDOW IS THE WHOLE POINT, and it is arithmetic: resolveFromMasks run on
// the engine's clock -- a fall a frame, a match swept FLASH + FACE + 1 + POP *
// size after it is made, HOVER before what stood on it drops -- says when the
// board comes to rest, and the same resolve with a swap made when the cursor
// arrives says what that swap does. A swap costs travel.cost() to reach; one that
// cannot be reached in time, or that canSwap would refuse by then, is never
// considered. While a break is still converting its row, the window is the
// matched timer instead, and the row is turned into panels in the masks.
//
// WHY IT PAYS. On 120 positions caught the moment a slab's colours appeared,
// doing nothing left 91 with no chain at all. One reachable swap turned 18 of
// them into something better, including one that went from nothing to a
// 7-chain. That is the information arriving being used while it is still worth
// something.
//
// A panel cannot be pulled out from under a hovering one — canSwap says so, and
// that is precisely the situation here, so every candidate is asked rather than
// assumed legal.
//
// bitbot reads this through revealPick, which plays the answer as `lineup`.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./travel.js'), require('./bitmatch.js'));
    } else {
        root.BitLineup = factory(root.PanelEval.travel, root.BitMatch);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (travel, bit) {
    'use strict';

    var W = 6;

    // Is anything still in the air, and has a slab just handed us colours?
    function revealed(snapshot, H) {
        var flying = 0, converted = 0;
        for (var r = 1; r <= H; r++) {
            if (!snapshot.motion || !snapshot.motion[r]) continue;
            for (var c = 1; c <= W; c++) {
                var m = snapshot.motion[r][c];
                if (!m) continue;
                if (m.state && m.state !== 'normal') flying++;
                if (m.fellFromGarbage) converted++;
            }
        }
        return { flying: flying, converted: converted, open: flying > 0 && converted > 0 };
    }

    // THE BOARD IN MASKS, WITH ITS CLOCK. What hovers now hovers out the timer of the
    // panels just out of a slab; the chain flags are the snapshot's, because a row out of
    // a slab carries the flag and its landing is a link.
    function timedOf(snapshot, frames, H) {
        var st = bit.maskState(snapshot.grid, snapshot.blocks, W, H, snapshot.motion);
        if (st.bad) return null;
        var hover = Infinity, chaining = new Int32Array(W + 2), hovering = new Int32Array(W + 2), r, c, m;
        for (r = 1; r <= H; r++) {
            for (c = 1; c <= W; c++) {
                if (snapshot.chaining && snapshot.chaining[r] && snapshot.chaining[r][c]) chaining[c] |= 1 << (r - 1);
                m = snapshot.motion && snapshot.motion[r] && snapshot.motion[r][c];
                if (m && m.state === 'hovering') {
                    hovering[c] |= 1 << (r - 1);
                    if ((m.timer || 0) < hover) hover = m.timer || 0;
                }
            }
        }
        return { st: st, opts: { frames: frames, hover: hover === Infinity ? 0 : hover,
                                 hovering: hovering, chaining: chaining } };
    }

    // HOW LONG THERE IS TO MOVE: the clock when the board, left alone, comes to rest.
    function windowFrames(snapshot, frames, H) {
        var t = timedOf(snapshot, frames, H);
        if (!t) return 0;
        return bit.resolveFromMasks(t.st, false, t.opts).frames || 0;
    }

    function score(chain, total) { return chain * 1000 + total; }

    // WHAT THE BOARD DOES, with one swap made at frame `at` -- resolveFromMasks on the
    // engine's clock. Returns the deepest chain, the panels cleared and the frames it
    // took; null when the swap would be refused by then.
    function play(snapshot, frames, H, swap, at) {
        var t = timedOf(snapshot, frames, H);
        if (!t) return null;
        var o = t.opts;
        var r = bit.resolveFromMasks(t.st, false, swap ? { frames: o.frames, hover: o.hover, hovering: o.hovering,
                                                            chaining: o.chaining, at: at || 0, swap: swap } : o);
        if (r.scope === 'refused') return null;
        return { scope: r.scope, chain: r.chain, total: r.total, frames: r.frames };
    }
    // THE PLAN: every swap reachable before the board settles, scored on what
    // it leaves, against the option of doing nothing.
    //
    // cursor is [row, col]; legalSwaps is the board's own list of swappable
    // cells. Returns null when nothing is in flight — that is bitmatch's job,
    // not this one's.
    // opts.spendLeast: among breaks, the one that clears the fewest panels on the way
    // wins, chain only between equals. Topped out the panels are all the material there
    // is, and a break converts the same row whatever it spent to get there.
    function bestInWindow(snapshot, frames, H, cursor, legalSwaps, opts) {
        var spendLeast = !!(opts && opts.spendLeast);
        function breakScore(chain, total) {
            return spendLeast ? -total * 1000 + chain : score(chain, total);
        }
        var conv = converting(snapshot);
        if (conv) return inMasks(snapshot, frames, H, cursor, legalSwaps, conv, breakScore);
        var state = revealed(snapshot, H);
        if (!state.open) return null;

        var window = api.windowFrames(snapshot, frames, H);
        var doNothing = api.play(snapshot, frames, H, null, 0);
        var baseKnown = doNothing && doNothing.scope === 'ok';
        var best = { swap: null, cost: 0, chain: baseKnown ? doNothing.chain : 0,
                     total: baseKnown ? doNothing.total : 0 };
        best.score = score(best.chain, best.total);
        var considered = 0, reachable = 0, unknown = 0, bestBroke = null;
        // DOING NOTHING CAN BE THE BREAK. The landing itself touches the slab, and a
        // swap that only makes a chain would spoil it, so standing still enters the
        // break tier and a swap has to break better to replace it.
        if (doNothing && doNothing.scope === 'garbage-broke') {
            bestBroke = { swap: null, cost: 0, chain: doNothing.chain, total: doNothing.total,
                          score: breakScore(doNothing.chain, doNothing.total), broke: true };
        }

        for (var i = 0; i < legalSwaps.length; i++) {
            var sw = legalSwaps[i];
            var cost = travel.cost(cursor[0], cursor[1], sw[0], sw[1]);
            if (cost > window) continue;                 // cannot get there in time
            reachable++;
            var out = api.play(snapshot, frames, H, sw, cost);
            if (!out) continue;                          // the swap was refused by then
            // A SECOND SLAB BREAKING MID-RUN IS NOT A SCORE. The run stops
            // there with whatever had finished popping, which is usually
            // nothing — ranking that against a finished run compares a
            // part-played position with a played-out one. Such a candidate is
            // unknown, and unknown is not a number to sort by.
            // BREAKING GARBAGE IS A TIER, NOT A SCORE, so it is not thrown away for
            // being unrankable. A run that reaches a break stops there, and its chain
            // number is a part-played position -- that is why it cannot be SORTED
            // against a finished one. It can still be PREFERRED: a break converts the
            // slab's bottom row into panels and holds the floor while it pops, and
            // bitbot states the same domination as a rule rather than a taste --
            // "sends and breaks beats sends, and that is not a preference".
            //
            // Only breaks are compared with each other, and only on what had finished
            // popping when the run stopped, so no part-played number is ever ranked
            // against a played-out one.
            if (out.scope === 'garbage-broke') {
                var bs = breakScore(out.chain, out.total);
                if (!bestBroke || bs > bestBroke.score) {
                    bestBroke = { swap: sw, cost: cost, chain: out.chain,
                                  total: out.total, score: bs, broke: true };
                }
                continue;
            }
            if (out.scope !== 'ok') { unknown++; continue; }
            considered++;
            var sc = score(out.chain, out.total);
            if (sc <= best.score) continue;
            best = { swap: sw, cost: cost, chain: out.chain, total: out.total, score: sc };
        }
        if (bestBroke) best = bestBroke;
        return { best: best, window: window, reachable: reachable, considered: considered,
                 unknown: unknown, doNothing: doNothing, converted: state.converted };
    }

    // RE-MEASURE EVERY TIME MORE COLOURS ARRIVE.
    //
    // A match converts exactly ONE ROW of the slab it touches —
    // matchGarbagePanels drops each touched panel's offset and only the row
    // reaching -1 becomes panels. So colours arrive one instalment per match
    // that touches garbage, and a chain that reaches back into the same slab
    // reveals another row. Each instalment is information the last plan did not
    // have, so the window is measured again and the plan redone; nothing is
    // carried over from the previous look.
    //
    // This is a driver, not a decision: `advance` steps the world one frame and
    // `read` hands back the current snapshot, so the same loop runs against a
    // real Stack or against bitframes. It returns what it planned and when.
    //
    // ON THE BOARDS MEASURED IT FIRES ONCE. Every captured position with a slab
    // break converts a single row and never reaches back, so re-planning has
    // nothing extra to use there and the result matches planning once. It is
    // written this way because arriving information should be used when it
    // arrives, not because a gain has been demonstrated.
    function planAsTheyAppear(advance, read, frames, H, cursorOf, legalSwapsOf, budget) {
        // AN INSTALMENT IS A RISE, NOT A NEW HIGH. fellFromGarbage is a
        // COUNTDOWN the engine sets to 12 and decays, not a flag: the first
        // instalment's six panels stop being counted long before a second
        // instalment arrives, and a second six is not greater than the first
        // six. Watching a running maximum therefore sees exactly one instalment
        // however many there are, which is what a board that really reveals
        // twice showed.
        var prev = 0, plans = [], pending = null, limit = budget || 900;
        for (var f = 0; f < limit; f++) {
            var snapshot = read();
            var state = api.revealed(snapshot, H);
            if (state.converted > prev) {
                prev = state.converted;
                if (state.flying > 0) {
                    var plan = api.bestInWindow(snapshot, frames, H, cursorOf(), legalSwapsOf());
                    if (plan && plan.best.swap) {
                        pending = { swap: plan.best.swap, at: f + plan.best.cost };
                        plans.push({ reveal: plans.length + 1, frame: f, swap: plan.best.swap,
                                     cost: plan.best.cost, window: plan.window,
                                     chain: plan.best.chain, total: plan.best.total });
                    }
                }
            } else {
                prev = state.converted;      // it decayed; the next rise is a new one
            }
            if (pending && f >= pending.at) {
                pending.played = advance(pending.swap) !== false;
                pending = null;
                continue;
            }
            if (advance(null) === 'done') break;
        }
        return { plans: plans, reveals: plans.length };
    }

    // THE ROW A BREAK IS CONVERTING, off the snapshot. convertGarbagePanels deals its
    // colours at the match, while the cells are still garbage, so they are on the board
    // for the whole of the matched timer: [row, col, colour], and the frames left.
    function converting(snapshot) {
        var cells = [], timer = Infinity, m, r, c;
        for (r = 1; snapshot.motion && r < snapshot.motion.length; r++) {
            if (!snapshot.motion[r]) continue;
            for (c = 1; c <= W; c++) {
                m = snapshot.motion[r][c];
                if (!m || !m.isGarbage || m.state !== 'matched' || !(m.color > 0) || m.color === 9) continue;
                cells.push([r, c, m.color]);
                if ((m.timer || 0) < timer) timer = m.timer || 0;
            }
        }
        return cells.length ? { cells: cells, timer: timer } : null;
    }

    // THE BOARD WHEN THAT ROW HAS BECOME PANELS, in masks. Its cells leave the slab and
    // the garbage and take their colours; the slab they came from is live again, since
    // updateMatched returns its other rows to 'normal' on the same frame.
    function landed(st, cells) {
        var W2 = st.W, stride = W2 + 2, N = st.N, i, c;
        for (i = 0; i < cells.length; i++) if (cells[i][2] > N) N = cells[i][2];
        var out = bit.copyState(st);
        if (N > out.N) {
            var col = new Int32Array((N + 1) * stride);
            col.set(out.colour);
            out.colour = col;
            out.N = N;
        }
        for (i = 0; i < cells.length; i++) {
            var r = cells[i][0], cc = cells[i][1], b = 1 << (r - 1);
            out.inert[cc] &= ~b;
            out.garb[cc] &= ~b;
            out.colour[cells[i][2] * stride + cc] |= b;
            for (var k = 0; k < out.slabs.length; k++) {
                if (out.slabs[k][cc] & b) { out.slabs[k][cc] &= ~b; out.slabLocked[k] = false; }
            }
        }
        for (c = 0; c < out.slabs.length; c++) {
            var any = false;
            for (i = 1; i <= W2; i++) if (out.slabs[c][i]) { any = true; break; }
            if (!any) { out.slabs.splice(c, 1); out.slabLocked.splice(c, 1); c--; }
        }
        return out;
    }

    // THE CONVERTING WINDOW, IN MASKS. The row's colours are on the board for the whole
    // matched timer, and that is long -- FLASH + FACE + POP * (combo + onScreen) -- so a
    // swap made inside it finishes its own cascade with the slab still locked, and only
    // then does the row come down. Both halves are resolveFromMasks: the swap on the
    // board as it is, then the row turned into panels on the board that left. A swap
    // counts only if its walk and its own cascade -- FLASH + FACE + HOVER a round and POP
    // a panel, the engine's frames -- are over before the timer is. landing.test.js
    // holds the landing to the engine. Nothing is run.
    function inMasks(snapshot, frames, H, cursor, legalSwaps, conv, breakScore) {
        var st = bit.maskState(snapshot.grid, snapshot.blocks, W, H, snapshot.motion);
        if (st.bad) return null;
        function outcome(swap) {
            var s1 = bit.copyState(st);
            s1.busy = st.busy;
            if (swap && !bit.swapMasks(s1, swap[0], swap[1])) return null;
            var first = bit.resolveFromMasks(s1, true);
            if (first.scope === 'garbage-broke') {
                return { scope: 'garbage-broke', chain: first.chain, total: first.total, own: first };
            }
            if (first.scope !== 'ok' || !first.settled) return null;
            var r = bit.resolveFromMasks(landed(first.settled, conv.cells), false);
            return { scope: r.scope, chain: r.chain, total: first.total + r.total, own: first };
        }
        var doNothing = outcome(null);
        var best = { swap: null, cost: 0, chain: doNothing && doNothing.scope === 'ok' ? doNothing.chain : 0,
                     total: doNothing && doNothing.scope === 'ok' ? doNothing.total : 0 };
        best.score = score(best.chain, best.total);
        var bestBroke = null, reachable = 0, considered = 0;
        if (doNothing && doNothing.scope === 'garbage-broke') {
            bestBroke = { swap: null, cost: 0, chain: doNothing.chain, total: doNothing.total,
                          score: breakScore(doNothing.chain, doNothing.total), broke: true };
        }
        for (var i = 0; i < legalSwaps.length; i++) {
            var sw = legalSwaps[i], cost = travel.cost(cursor[0], cursor[1], sw[0], sw[1]);
            if (cost > conv.timer) continue;
            var out = outcome(sw);
            if (!out) continue;
            var own = out.own, busyFor = own.rounds
                ? own.rounds * (frames.FLASH + frames.FACE + frames.HOVER) + frames.POP * own.total : 0;
            if (cost + busyFor > conv.timer) continue;
            reachable++;
            if (out.scope === 'garbage-broke') {
                var bs = breakScore(out.chain, out.total);
                if (!bestBroke || bs > bestBroke.score) {
                    bestBroke = { swap: sw, cost: cost, chain: out.chain, total: out.total, score: bs, broke: true };
                }
                continue;
            }
            if (out.scope !== 'ok') continue;
            considered++;
            var sc = score(out.chain, out.total);
            if (sc > best.score) best = { swap: sw, cost: cost, chain: out.chain, total: out.total, score: sc };
        }
        if (bestBroke) best = bestBroke;
        return { best: best, window: conv.timer, reachable: reachable, considered: considered,
                 unknown: 0, doNothing: doNothing, converted: conv.cells.length };
    }

    // Calls go through this object so a test can replace one step with a
    // broken one and prove the check notices.
    var api = { bestInWindow: bestInWindow, revealed: revealed,
                windowFrames: windowFrames, play: play,
                planAsTheyAppear: planAsTheyAppear,
                converting: converting, landed: landed };
    return api;
}));
