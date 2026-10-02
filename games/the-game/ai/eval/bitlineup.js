(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./travel.js'), require('./bitmatch.js'));
    } else {
        root.BitLineup = factory(root.PanelEval.travel, root.BitMatch);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (travel, bit) {
    'use strict';

    var W = 6;

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

    function timedOf(snapshot, frames, H) {
        var st = bit.maskState(snapshot.grid, snapshot.blocks, W, H, snapshot.motion);
        if (st.bad) return null;
        var hover = Infinity, chaining = new Int32Array(W + 2), hovering = new Int32Array(W + 2), r, c, m;
        var popping = new Int32Array(W + 2), popAt = 0, stride = W + 2;
        for (r = 1; r <= H; r++) {
            for (c = 1; c <= W; c++) {
                if (snapshot.chaining && snapshot.chaining[r] && snapshot.chaining[r][c]) chaining[c] |= 1 << (r - 1);
                m = snapshot.motion && snapshot.motion[r] && snapshot.motion[r][c];
                if (m && m.state === 'hovering') {
                    hovering[c] |= 1 << (r - 1);
                    if ((m.timer || 0) < hover) hover = m.timer || 0;
                }
                if (m && !m.isGarbage && (m.state === 'matched' || m.state === 'popping' || m.state === 'popped')) {
                    var size = m.comboSize || 0, idx = m.comboIndex || 0, t = m.timer || 0;
                    var at = m.state === 'matched' ? t + size * frames.POP
                           : m.state === 'popping' ? t + (size - idx) * frames.POP : t;
                    popping[c] |= 1 << (r - 1);
                    st.occ[c] |= 1 << (r - 1);
                    if (m.color > 0) {
                        st.colour[m.color * stride + c] |= 1 << (r - 1);
                        if (m.color > st.N) st.N = m.color;
                    }
                    if (at > popAt) popAt = at;
                }
            }
        }
        return { st: st, opts: { frames: frames, hover: hover === Infinity ? 0 : hover,
                                 hovering: hovering, chaining: chaining,
                                 popping: popping, popAt: popAt } };
    }

    function windowFrames(snapshot, frames, H) {
        var t = timedOf(snapshot, frames, H);
        if (!t) return 0;
        return bit.resolveFromMasks(t.st, false, t.opts).frames || 0;
    }

    function score(chain, total) { return chain * 1000 + total; }

    function play(snapshot, frames, H, swap, at) {
        var t = timedOf(snapshot, frames, H);
        if (!t) return null;
        var o = t.opts;
        var r = bit.resolveFromMasks(t.st, false, swap ? { frames: o.frames, hover: o.hover, hovering: o.hovering,
                                                            chaining: o.chaining, popping: o.popping, popAt: o.popAt,
                                                            at: at || 0, swap: swap } : o);
        if (r.scope === 'refused') return null;
        return { scope: r.scope, chain: r.chain, total: r.total, frames: r.frames };
    }
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

    function planAsTheyAppear(advance, read, frames, H, cursorOf, legalSwapsOf, budget) {
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

    var api = { bestInWindow: bestInWindow, revealed: revealed,
                windowFrames: windowFrames, play: play, timedOf: timedOf,
                planAsTheyAppear: planAsTheyAppear,
                converting: converting, landed: landed };
    return api;
}));
