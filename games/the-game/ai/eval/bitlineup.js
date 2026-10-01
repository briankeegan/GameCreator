// LINING UP WITH WHAT HAS JUST BEEN REVEALED.
//
// A slab breaks. Its bottom row takes REAL COLOURS and then hovers for a while
// before it drops. Those colours are on the board — nothing is predicted — and
// for as long as the panels are in the air there is time to move what is
// underneath and beside them, so that the landing completes a chain instead of
// just filling the hole.
//
// THE WINDOW IS THE WHOLE POINT. It is measured, not assumed: the planner runs
// the position forward until nothing is in flight, and that many frames is what
// there is to spend. A swap costs travel.cost() to reach plus the frames it
// takes to settle, so most windows buy one swap near the cursor and a wide one
// buys two. A swap that cannot be reached in time is never considered.
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
        module.exports = factory(require('./bitframes.js'), require('./travel.js'));
    } else {
        root.BitLineup = factory(root.BitFrames, root.PanelEval.travel);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (BF, travel) {
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

    // How many frames until everything has landed. Run a throwaway copy
    // forward; the board is what it is, so this is measurement, not a guess.
    function windowFrames(snapshot, frames, H, cap) {
        var probe = BF.build(snapshot, frames, H), n = 0, limit = cap || 600;
        while (n < limit) {
            BF.step(probe);
            n++;
            if (probe.brokeGarbage) break;     // past here the colours are not ours to know
            if (!BF.anyBusy(probe)) break;
        }
        return n;
    }

    function score(chain, total) { return chain * 1000 + total; }

    // Run a position to rest, optionally playing one swap once `at` frames have
    // passed. Returns the deepest chain reached, not the counter at the end —
    // the engine zeroes it when the chain finishes.
    function play(snapshot, frames, H, swap, at, cap) {
        var st = BF.build(snapshot, frames, H), peak = 0, n = 0, limit = cap || 900, played = !swap;
        while (n < limit) {
            if (!played && n >= at) {
                if (!BF.canSwap(st, swap[0], swap[1])) return null;   // not legal by then
                BF.doSwap(st, swap[0], swap[1]);
                played = true;
            }
            BF.step(st);
            n++;
            if (st.chainCounter > peak) peak = st.chainCounter;
            if (st.brokeGarbage) {
                return { scope: 'garbage-broke', chain: Math.max(peak, st.rounds ? 1 : 0),
                         total: st.panelsCleared, frames: n };
            }
            if (played && !BF.anyBusy(st)) break;
        }
        return { scope: 'ok', chain: st.rounds ? Math.max(peak, 1) : 0,
                 total: st.panelsCleared, frames: n };
    }

    // THE PLAN: every swap reachable before the board settles, scored on what
    // it leaves, against the option of doing nothing.
    //
    // cursor is [row, col]; legalSwaps is the board's own list of swappable
    // cells. Returns null when nothing is in flight — that is bitmatch's job,
    // not this one's.
    function bestInWindow(snapshot, frames, H, cursor, legalSwaps) {
        var state = revealed(snapshot, H);
        if (!state.open) return null;

        var window = api.windowFrames(snapshot, frames, H);
        var doNothing = api.play(snapshot, frames, H, null, 0);
        var baseKnown = doNothing && doNothing.scope === 'ok';
        var best = { swap: null, cost: 0, chain: baseKnown ? doNothing.chain : 0,
                     total: baseKnown ? doNothing.total : 0 };
        best.score = score(best.chain, best.total);
        var considered = 0, reachable = 0, unknown = 0, bestBroke = null;

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
                var bs = score(out.chain, out.total);
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

    // Calls go through this object so a test can replace one step with a
    // broken one and prove the check notices.
    var api = { bestInWindow: bestInWindow, revealed: revealed,
                windowFrames: windowFrames, play: play,
                planAsTheyAppear: planAsTheyAppear };
    return api;
}));
