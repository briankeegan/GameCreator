(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./bitmatch.js'), require('./travel.js'));
    } else {
        root.BitOptions = factory(root.BitMatch, root.PanelEval.travel);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (bit, travel) {
    'use strict';

    function kindOf(chain) { return chain >= 2 ? 'chain' : 'combo'; }

    function sizeOf(chain, total) { return chain >= 2 ? chain : total; }

    function durationOf(swaps, frames) {
        return frames + swaps.length * OVERHEAD;
    }

    function shapeOf(st2) {
        if (!st2) return null;
        if (st2._shape !== undefined) return st2._shape;
        return (st2._shape = shapeOfRaw(st2));
    }
    function shapeOfRaw(st2) {
        var h = [], c, tall = 0, bumps = 0, sum = 0, mx = 0, w2 = st2 && (st2.W || 6);
        if (!st2) return null;
        for (c = 1; c <= w2; c++) {
            var top = 32 - Math.clz32(st2.occ[c] >>> 0);
            if (top > tall) tall = top;
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
        var low = h[1];
        for (c = 2; c <= w2; c++) if (h[c] < low) low = h[c];
        var gap = 0, floorRow = 0;
        for (c = 1; c <= w2; c++) {
            var gm = st2.garb[c] >>> 0;
            if (!gm) continue;
            var lowBit = gm & -gm, fr = 0;
            while (lowBit >>> fr) fr++;              // row index of the lowest garbage cell
            if (!floorRow || fr < floorRow) floorRow = fr;
        }
        if (floorRow > 1) {
            var need = floorRow - 1, stride2 = w2 + 2;
            gap = Infinity;
            for (c = 1; c + 2 <= w2; c++) {
                var win = Math.max(0, need - h[c]) + Math.max(0, need - h[c + 1]) +
                          Math.max(0, need - h[c + 2]);
                if (win < gap) gap = win;
            }
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
                 converts: r.converts || 0,
                 voidAfter: r.voidAfter || 0,
                 duration: durationOf(swaps, frames),
                 tall: sh ? sh.tall : null, bumps: sh ? sh.bumps : null,
                 mat: sh ? sh.mat : null, low: sh ? sh.low : null,
                 spread: sh ? sh.spread : null,
                 voidRows: sh ? (sh.high - sh.mat) : null,
                 slabGap: sh ? (sh.slabRowGap || 0) : null,
                 ready: (r.settled && !LEAN) ? canFireOf(r.settled) : null };
    }

    function byPrice(a, b) {
        if (a.frames !== b.frames) return a.frames - b.frames;
        return b.size - a.size;
    }

    var OVERHEAD = 0, RESOLVE = null, DIG = false, stopPrice = null, PREPARE = false, LEAN = false;
    var LASTBREAKREADY = null;

    var SAVES = new Map(), SAVES_MAX = 50000, ANYBREAK = new Map();
    var STOPS = new Map(), STOPKEY = '', LOCK = Infinity, SPEND = 0, SWAP_RUNS = 4;
    function landStopOf(st) {
        if (!STOPKEY) return bit.bestOneSwapStop(st, stopPrice);
        var key = STOPKEY + ':' + boardKey(st), hit = STOPS.get(key);
        if (hit !== undefined) return hit;
        var v = bit.bestOneSwapStop(st, stopPrice);
        if (STOPS.size >= SAVES_MAX) STOPS.clear();
        STOPS.set(key, v);
        return v;
    }
    function boardKey(st) {
        var h1 = 0x811c9dc5 | 0, h2 = 0x9747b28c | 0, a, i, v;
        var arrs = BK_ARRS;
        arrs[0] = st.occ; arrs[1] = st.inert; arrs[2] = st.garb; arrs[3] = st.colour;
        for (var k = 0; k < 4; k++) {
            a = arrs[k];
            for (i = 0; i < a.length; i++) {
                v = a[i] | 0;
                h1 = Math.imul(h1 ^ v, 0x01000193);
                h2 = Math.imul(h2 ^ (v + 0x5bd1e995), 0x5bd1e995) ^ (h2 >>> 13);
            }
            h1 = Math.imul(h1 ^ -1, 0x01000193);
            h2 = Math.imul(h2 ^ (-1 + 0x5bd1e995), 0x5bd1e995) ^ (h2 >>> 13);
        }
        for (var j = 0; st.slabs && j < st.slabs.length; j++) {
            a = st.slabs[j];
            for (i = 0; i <= a.length; i++) {
                v = i < a.length ? a[i] | 0 : (st.slabLocked && st.slabLocked[j] ? 7 : 3);
                h1 = Math.imul(h1 ^ v, 0x01000193);
                h2 = Math.imul(h2 ^ (v + 0x5bd1e995), 0x5bd1e995) ^ (h2 >>> 13);
            }
        }
        if (st.busy) {
            a = st.busy;
            for (i = 0; i < a.length; i++) {
                v = a[i] | 0;
                h1 = Math.imul(h1 ^ v, 0x01000193);
                h2 = Math.imul(h2 ^ (v + 0x5bd1e995), 0x5bd1e995) ^ (h2 >>> 13);
            }
        }
        return (h1 >>> 0) * 2097152 + (h2 >>> 11);
    }
    var BK_ARRS = [null, null, null, null];

    function canFireOf(st) {
        if (st._fire !== undefined) return st._fire;
        return (st._fire = !!bit.anyOneSwapClear(st));
    }

    var SETTLES = new Map();
    function settleOf(st) {
        var key = boardKey(st), hit = SETTLES.get(key);
        if (hit !== undefined) return hit;
        var r = bit.resolveFromMasks(st, true);
        if (SETTLES.size >= SAVES_MAX) SETTLES.clear();
        SETTLES.set(key, r);
        return r;
    }

    function options(board, W, H, cursor, depth, st, timing, dig) {
        if (!timing || typeof timing.framesPerRow !== 'number' ||
            typeof timing.reaction !== 'number') {
            throw new Error('bitoptions.options: timing is required and needs ' +
                            'framesPerRow and reaction -- the rise and the cooldown ' +
                            'every price and the setup gate are derived from');
        }
        OVERHEAD = (timing && timing.overhead) || 0;
        RESOLVE = (timing && timing.resolve) || null;
        DIG = !!dig;
        var FPR = (timing && timing.framesPerRow) || 0;
        var DEADLINE = (timing && timing.deadline) || 0;
        stopPrice = (timing && timing.stopPrice) || null;
        STOPKEY = (timing && timing.stopKey) || '';
        LOCK = (timing && timing.lock !== undefined) ? timing.lock : Infinity;
        SPEND = (timing && timing.spend) || 0;
        LEAN = !!(timing && timing.lean);
        PREPARE = !!(timing && timing.prepare);
        var HOLD = (timing && timing.holdWorth) || 0;
        var READYWORTH = HOLD / W;
        var PREPWORTH = (FPR + HOLD) / W;
        var WORK = (timing && timing.workingRows) || 0;
        var MAXSTOP = stopPrice ? Math.max(stopPrice({ chain: 13, total: 3 }),
                                           stopPrice({ chain: 1, total: W * 2 })) : 0;
        var SWAP = OVERHEAD || ((timing && timing.reaction) || 0);
        function setupWorth(g, left) {
            if (g === null || g === undefined || !(left > 0)) return 0;
            var cost = g * Math.max(1, SWAP);
            if (cost >= left) return 0;
            return (FPR + HOLD) * (1 - cost / left);
        }
        var prepBudget = 24;
        dropBudget = 8;
        var now = [], next = [], i, j;
        if (!st) st = bit.maskState(board.grid, board.blocks, W, H);
        var START = shapeOf(st);
        var BASELOW = START ? START.low : 0;
        var BASEBUMPS = START ? START.bumps : 0;
        var BASEVOID = START ? (START.high - START.mat) : 0;
        var BASEGAP = START ? (START.slabRowGap || 0) : 0;
        var BASEBREAK = LEAN ? false : breakReadyOf(st) === true;
        if (!LEAN) LASTBREAKREADY = BASEBREAK;
        BASEDIG = DIG ? reachOf(st).dig : 0;
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
            var broke = r.scope === 'garbage-broke';
            if (r.scope !== 'ok' && !broke) { unknown++; continue; }
            if (undoesLast(swaps[i][0], swaps[i][1], r)) { refused++; continue; }
            if (r.total === 0 && !broke) continue;           // clears nothing: a setup, not an option
            var opt = optionOf([swaps[i]], travel.cost(cursor[0], cursor[1], swaps[i][0], swaps[i][1]), r);
            opt.breaks = broke;
            opt.levels = opt.bumps !== null && opt.bumps <= BASEBUMPS;
            opt.opensHole = opt.low === 0 && BASELOW > 0;
            if (!LEAN) {
                opt.breakReady = r.settled ? breakReadyOf(r.settled) : null;
                opt.closesBreak = BASEBREAK && opt.breakReady === false;
                opt.digGain = (DIG && r.settled) ? reachOf(r.settled).dig - BASEDIG : 0;
                opt.voidGain = (opt.voidRows === null || opt.voidRows === undefined)
                                 ? 0 : (BASEVOID - opt.voidRows);
                opt.slabGain = setupWorth(opt.slabGap, DEADLINE - (opt.duration || 0))
                                 - setupWorth(BASEGAP, DEADLINE);
                opt.slabWorth = (PREPARE && prepBudget > 0 && r.settled &&
                                 (prepBudget--, slabReadyFast(r.settled))) ? PREPWORTH : 0;
                opt.matNow = START ? START.mat : null;
            }
            now.push(opt);
        }

        var BEAM = 12, DIG_BEAM = SPEND ? 24 : 6;

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

        var saveBudget = 0;
        function savesOf(state) {
            if (saveBudget <= 0) return 0;
            saveBudget--;
            return savesOfRaw(state);
        }
        function readyOf(state) {
            return canFireOf(state) ? 1 : 0;
        }

        function breakReadyOf(state) {
            var c, any = false;
            for (c = 1; c <= W; c++) if (state.garb[c]) { any = true; break; }
            if (!any) return null;
            if (anyBreakOf(state)) return true;
            return breakAfterDropOf(state);
        }

        function breakAfterDropOf(state) {
            if (dropBudget <= 0) return false;
            dropBudget--;
            var sw = bit.legalSwapsOf(state), i, r;
            for (i = 0; i < sw.length; i++) {
                if (!bit.swapCanClear(state, sw[i][0], sw[i][1])) continue;     // clears nothing: skipped below anyway
                if (!bit.swapMasks(state, sw[i][0], sw[i][1])) continue;
                r = bit.resolveFromMasks(state, true);
                bit.swapMasks(state, sw[i][0], sw[i][1]);
                if (r.scope === 'garbage-broke') return true;
                if (r.scope !== 'ok' || r.total === 0 || !r.settled) continue;
                if (anyBreakOf(r.settled)) return true;
            }
            return false;
        }

        function anyBreakOf(state) {
            var key = boardKey(state), n = SAVES.get(key);
            if (n !== undefined) return n > 0;
            var hit = ANYBREAK.get(key);
            if (hit !== undefined) return hit;
            var sw = bit.legalSwapsOf(state), i, r, any = false;
            for (i = 0; i < sw.length && !any; i++) {
                if (!bit.swapCanClear(state, sw[i][0], sw[i][1])) continue;
                if (!bit.swapMasks(state, sw[i][0], sw[i][1])) continue;
                r = bit.resolveFromMasks(state, false);
                bit.swapMasks(state, sw[i][0], sw[i][1]);
                if (r.scope === 'garbage-broke') any = true;
            }
            if (ANYBREAK.size >= SAVES_MAX) ANYBREAK.clear();
            ANYBREAK.set(key, any);
            return any;
        }
        function savesOfRaw(state) {
            var key = boardKey(state), hit = SAVES.get(key);
            if (hit !== undefined) return hit;
            var sw = bit.legalSwapsOf(state), n = 0, i, r;
            for (i = 0; i < sw.length; i++) {
                if (!bit.swapCanClear(state, sw[i][0], sw[i][1])) continue;     // breaks nothing: no line
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

        var flat = null, save = null, ready = null, trigger = null, BASE = null, BASEDIG = 0, BASESAVE = 0;
        var slabBudget = 0, dropBudget = 0;

        function expandAll(state0, depth) {
            BASE = shapeOf(state0);
            BASEDIG = DIG ? reachOf(state0).dig : 0;
            saveBudget = 192;
            slabBudget = 24;
            prepBudget = 24;
            BASESAVE = (DIG && BASEDIG > 0 && !LEAN) ? savesOfRaw(state0) : 0;
            var frontier = [{ st: state0, chain: [], from: cursor, spent: 0, reach: null, dig: 0, lock: LOCK }], ply;
            for (ply = 1; ply <= depth && frontier.length; ply++) {
                var born = [], fi, k;
                for (fi = 0; fi < frontier.length; fi++) {
                    var node = frontier[fi], state = node.st;
                    var list = bit.legalSwapsOf(state);
                    var reach = node.reach;
                    if (!reach && node.chain.length) reach = reachOf(state).mask;
                    for (k = 0; k < list.length; k++) {
                        var sw = list[k];
                        if (reach && !SPEND) {
                            var rb = 1 << (sw[0] - 1);
                            if (!((reach[sw[1]] | reach[sw[1] + 1]) & rb)) continue;
                        }
                        if (!bit.swapMasks(state, sw[0], sw[1])) continue;
                        var res = settleOf(state);
                        bit.swapMasks(state, sw[0], sw[1]);
                        var cost = node.spent + travel.cost(node.from[0], node.from[1], sw[0], sw[1]);
                        var tPlan = cost + ply - 1;
                        if (tPlan > node.lock + SPEND) continue;
                        var broke = res.scope === 'garbage-broke';
                        if (res.scope !== 'ok' && !broke) continue;
                        if (ply === 1 && undoesLast(sw[0], sw[1], res)) continue;
                        if (res.total > 0 || broke) {
                            if (node.chain.length) {
                                var opt = optionOf(node.chain.concat([sw]), cost, res);
                                opt.breaks = broke;
                                opt.levels = opt.bumps !== null && opt.bumps <= BASEBUMPS;
                                opt.opensHole = opt.low === 0 && BASELOW > 0;
                                if (!LEAN) {
                                    opt.breakReady = res.settled ? breakReadyOf(res.settled) : null;
                                    opt.closesBreak = BASEBREAK && opt.breakReady === false;
                                    opt.digGain = (DIG && res.settled) ? reachOf(res.settled).dig - BASEDIG : 0;
                                    opt.voidGain = (opt.voidRows === null || opt.voidRows === undefined)
                                                     ? 0 : (BASEVOID - opt.voidRows);
                                    opt.slabGain = setupWorth(opt.slabGap, DEADLINE - (opt.duration || 0))
                                 - setupWorth(BASEGAP, DEADLINE);
                                    opt.slabWorth = (PREPARE && prepBudget > 0 && res.settled &&
                                                     (prepBudget--, slabReadyFast(res.settled))) ? PREPWORTH : 0;
                                    opt.matNow = START ? START.mat : null;
                                }
                                next.push(opt);
                            }
                            continue;
                        }
                        if (res.settled) {
                            var rr = DIG ? reachOf(res.settled) : null;
                            var seq = node.chain.concat([sw]);
                            var sh2 = LEAN ? null : shapeOf(res.settled);
                            var svNow = 0;
                            if (sh2) {
                                var dur = durationOf(seq, cost);
                                var ways2 = waysOf(res.settled);
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
                            if (DIG && rr) {
                                var sv = rr.dig > 0 ? savesOf(res.settled) : 0;
                                svNow = sv;
                                val += (sv - BASESAVE) * (DEADLINE / W) * W
                                     + (rr.dig - BASEDIG) * (DEADLINE / W);
                            }
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
                                if ((!trigger || val > trigger.value ||
                                     (val === trigger.value && cost < trigger.frames)) &&
                                    slabReadyFast(res.settled)) {
                                    trigger = { swaps: seq, frames: cost, value: val,
                                                duration: durationOf(seq, cost) };
                                }
                                if (take) {
                                    flat = { swaps: seq, frames: cost, value: val,
                                             tall: sh2.tall, bumps: sh2.bumps,
                                             ways: ways2, duration: dur,
                                             lands: bit.copyState(res.settled) };
                                }
                            }
                            born.push({ st: res.settled, chain: seq,
                                        from: sw, spent: cost,
                                        reach: rr && rr.mask, dig: rr ? rr.dig : 0,
                                        lock: Math.max(node.lock, tPlan + SWAP_RUNS) });
                        }
                    }
                }
                born.sort(function (a, b) { return a.spent - b.spent; });
                frontier = born.length > BEAM ? born.slice(0, BEAM) : born;
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

        if (flat && !(flat.value > 0)) flat = null;

        if (stopPrice && flat && flat.lands && flat.landStop === undefined) {
            flat.landStop = landStopOf(flat.lands);
        }

        return { now: now, next: next, cheapest: cheapest, flatten: flat, save: save,
                 ready: ready, trigger: trigger,
                 swapsConsidered: swaps.length, refused: refused, unknown: unknown };
    }

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

    function slabReadyFast(st) {
        var Wl = (st && st.W) || 6, Hl = (st && st.H) || 12, stride = Wl + 2;
        var t = 0, c, top, a, r;
        for (c = 1; c <= Wl; c++) { top = 32 - Math.clz32(st.occ[c] >>> 0); if (top > t) t = top; }
        if (t >= Hl || t < 1) return false;
        var target = 1 << (t - 1);            // the row the slab rests on
        var N = st.N;
        var col = [];
        for (a = 1; a <= N; a++) for (c = 1; c <= Wl; c++) col[a * stride + c] = st.colour[a * stride + c] >>> 0;

        function colourAt(cc, bitv) {
            for (var aa = 1; aa <= N; aa++) if (col[aa * stride + cc] & bitv) return aa;
            return 0;
        }
        function matchesTarget() {
            for (var aa = 1; aa <= N; aa++) {
                var runlen = 0;
                for (var cc = 1; cc <= Wl; cc++) {
                    if (col[aa * stride + cc] & target) { runlen++; if (runlen >= 3) return true; }
                    else runlen = 0;
                }
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

    function breakReadyBoard(st, timing) {
        options(null, st.W, st.H, [1, 1], 1, st, timing, true);
        return LASTBREAKREADY;
    }
    return { options: options, kindOf: kindOf, sizeOf: sizeOf, shapeOf: shapeOf,
             slabReadyBoard: slabReadyBoard, slabReadyFast: slabReadyFast,
             breakReadyBoard: breakReadyBoard };
}));
