(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./bitmatch.js'), require('./travel.js'), require('./bitnative.js'));
    } else {
        root.BitOptions = factory(root.BitMatch, root.PanelEval.travel, root.BitNative);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (bit, travel, native) {
    'use strict';

    function kindOf(chain) { return chain >= 2 ? 'chain' : 'combo'; }

    function sizeOf(chain, total) { return chain >= 2 ? chain : total; }

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

    function byPrice(a, b) {
        if (a.frames !== b.frames) return a.frames - b.frames;
        return b.size - a.size;
    }

    var LASTBREAKREADY = null;

    function options(board, W, H, cursor, depth, st, timing, dig) {
        if (!timing || typeof timing.framesPerRow !== 'number' ||
            typeof timing.reaction !== 'number') {
            throw new Error('bitoptions.options: timing needs framesPerRow and reaction');
        }
        if (!st) st = bit.maskState(board.grid, board.blocks, W, H);
        var t = Object.assign({}, timing, { press: travel.pressOf() });
        var out = native.options(st, cursor, depth, t, dig, board ? board.legalSwaps() : null);
        if (!timing.lean) LASTBREAKREADY = out.baseBreak;
        delete out.baseBreak;
        out.now.sort(byPrice);
        out.next.sort(byPrice);
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
        offer(out.now);
        offer(out.next);
        return { now: out.now, next: out.next, cheapest: cheapest, flatten: out.flatten, save: out.save,
                 ready: out.ready, trigger: out.trigger,
                 swapsConsidered: out.swapsConsidered, refused: out.refused, unknown: out.unknown };
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
