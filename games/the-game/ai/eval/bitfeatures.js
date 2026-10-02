(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./bitmatch.js'), require('./bitoptions.js'));
    } else {
        root.BitFeatures = factory(root.BitMatch, root.BitOptions);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (bit, bitoptions) {
    'use strict';

    var W = 6, H = 12;

    var CHAIN_BUCKETS = [2, 3, 4, 5];
    var COMBO_BUCKETS = [4, 5, 6, 7];
    var CHAIN_TOP = 5, COMBO_TOP = 7;

    function popcount(x) { var n = 0; while (x) { x &= x - 1; n++; } return n; }

    function surface(st) {
        var h = [], c;
        for (c = 1; c <= W; c++) h[c] = popcount(st.occ[c]);
        var bump = 0, lo = Infinity, hi = 0;
        for (c = 1; c <= W; c++) {
            if (h[c] < lo) lo = h[c];
            if (h[c] > hi) hi = h[c];
            if (c < W) bump += Math.abs(h[c] - h[c + 1]);
        }
        return { heights: h, bumpiness: bump, spread: hi - lo, tallest: hi, shortest: lo };
    }

    function resolveFramesOf(engine, comboSize, garbageOnScreen) {
        var f = engine.LEVELS[9].frames;
        return f.FLASH + f.FACE + f.POP * ((comboSize || 0) + (garbageOnScreen || 0));
    }

    function stopTimeOf(engine, isChain, comboSize, chainCounter, toppedOut) {
        var stop = engine.LEVELS[9].stop, t = 0;
        if (comboSize > 3 || isChain) {
            if (toppedOut && isChain) {
                var len = chainCounter > 4 ? 6 : chainCounter;
                t = stop.dangerConstant + (len - 1) * stop.dangerCoefficient;
            } else if (toppedOut) {
                t = stop.coefficient * (comboSize < 9 ? 2 : 3) + stop.chainConstant;
            } else if (isChain) {
                t = stop.coefficient * Math.min(chainCounter, 13) + stop.chainConstant;
            } else {
                t = stop.coefficient * comboSize + stop.comboConstant;
            }
        }
        return t;
    }

    var NORM = {
        bumpiness: 20,        // observed over 2,358 boards (analytic bound is 60)
        spread: 7,            // observed (analytic bound is 12)
        tallest: 12,          // analytic — board height
        ways: 4,              // observed 3, counting one exact size
        nextWays: 220,        // observed 210 — this counts ALL setup options, not
        frames: 41,           // observed — cheapest clear on a board
        moveFrames: 64,       // analytic — the longest walk on a 6x12 board, plus the swap
        chainTop: 6,          // analytic — the deepest chain the chip corpus holds
        comboTop: 8,          // observed — the widest single clear real boards reach
        breakWays: 56,        // observed 49 — ways to reach a slab, now or after a
        stop: 100             // analytic — level 10's awardStopTime peaks at 98
    };

    var clamped = 0;
    function share(v, norm) {
        var s = v / norm;
        if (s > 1) { clamped++; return 1; }
        return s < 0 ? 0 : s;
    }

    function ways(options, kind, size, top) {
        var n = 0;
        for (var i = 0; i < options.length; i++) {
            var o = options[i];
            if (o.kind !== kind) continue;
            if (size === top ? o.size >= size : o.size === size) n++;
        }
        return n;
    }

    function bestSize(options, kind) {
        var best = 0;
        for (var i = 0; i < options.length; i++) {
            if (options[i].kind === kind && options[i].size > best) best = options[i].size;
        }
        return best;
    }

    function cheapestFrames(options) {
        var f = Infinity;
        for (var i = 0; i < options.length; i++) if (options[i].frames < f) f = options[i].frames;
        return f;
    }

    function features(board, cursor, moveFrames, resolved, info, engine, masks, timing) {
        var st = masks || bit.maskState(board.grid, board.blocks, W, H);
        var surf = api.surface(st);
        var list = bitoptions.options(masks ? null : board, W, H, cursor || [1, 1], 2, st,
                                      timing && Object.assign({}, timing, { lean: true }));
        var f = {}, i;

        f.bumpiness = share(surf.bumpiness, NORM.bumpiness);
        f.spread = share(surf.spread, NORM.spread);
        f.tallest = share(surf.tallest, NORM.tallest);

        for (i = 0; i < CHAIN_BUCKETS.length; i++) {
            var cs = CHAIN_BUCKETS[i];
            f['chain' + (cs === CHAIN_TOP ? '5plus' : cs)] =
                share(api.ways(list.now, 'chain', cs, CHAIN_TOP), NORM.ways);
        }
        for (i = 0; i < COMBO_BUCKETS.length; i++) {
            var bs = COMBO_BUCKETS[i];
            f['combo' + bs] = share(api.ways(list.now, 'combo', bs, COMBO_TOP), NORM.ways);
        }

        var near = cheapestFrames(list.now);
        f.cheapestFrames = near === Infinity ? 0 : 1 - share(near, NORM.frames);
        f.moveFrames = 1 - share(moveFrames || 0, NORM.moveFrames);

        f.nextBestChain = share(bestSize(list.next, 'chain'), NORM.chainTop);
        f.nextBestCombo = share(bestSize(list.next, 'combo'), NORM.comboTop);
        f.nextWays = share(list.next.length, NORM.nextWays);

        f.breaksNow = (resolved && resolved.brokeGarbage) ? 1 : 0;
        var breakWays = 0;
        var every = list.now.concat(list.next);
        for (i = 0; i < every.length; i++) if (every[i].breaks) breakWays++;
        f.breakWays = share(breakWays, NORM.breakWays);

        if (info && engine && info.stopTime !== undefined) {
            var toppedOut = !!info.toppedOut;
            var left = info.stopTime || 0;

            var earned = 0;
            if (resolved && resolved.total > 0) {
                var isChain = resolved.chain >= 2;
                earned = api.stopTimeOf(engine, isChain, isChain ? 0 : resolved.total,
                                        isChain ? resolved.chain : 0, toppedOut);
            }
            var cost = moveFrames || 0;
            var whenItLands = Math.max(0, left - cost);
            f.stopEarned = share(Math.max(0, earned - whenItLands), NORM.stop);

            var budget = left;
            var room = (H - surf.tallest) * (info.framesPerRow || 0);
            if (room > budget) budget = room;
            var reachable = 0;
            var all = list.now.concat(list.next);
            for (i = 0; i < all.length; i++) {
                var o = all[i];
                var oChain = o.kind === 'chain';
                var pays = api.stopTimeOf(engine, oChain, oChain ? 0 : o.size,
                                          oChain ? o.chain : 0, toppedOut);
                if (pays > reachable && o.frames <= budget) reachable = pays;
            }
            f.stopReachable = share(reachable, NORM.stop);
        }

        return { f: f, surface: surf, options: list };
    }

    function keys() {
        var out = ['bumpiness', 'spread', 'tallest'];
        CHAIN_BUCKETS.forEach(function (s) { out.push('chain' + (s === CHAIN_TOP ? '5plus' : s)); });
        COMBO_BUCKETS.forEach(function (s) { out.push('combo' + s); });
        out.push('cheapestFrames', 'moveFrames',
                 'nextBestChain', 'nextBestCombo', 'nextWays',
                 'breaksNow', 'breakWays',
                 'stopEarned', 'stopReachable');
        return out;
    }

    function infoKeys() {
        return ['toppedOut', 'stopTime', 'incoming', 'cursorRow', 'cursorCol',
                'framesPerRow', 'health'];
    }

    var api = { features: features, keys: keys, infoKeys: infoKeys, surface: surface,
                stopTimeOf: stopTimeOf, resolveFramesOf: resolveFramesOf,
                ways: ways, bestSize: bestSize, NORM: NORM,
                CHAIN_BUCKETS: CHAIN_BUCKETS, COMBO_BUCKETS: COMBO_BUCKETS,
                CHAIN_TOP: CHAIN_TOP, COMBO_TOP: COMBO_TOP,
                clamps: function () { return clamped; },
                resetClamps: function () { clamped = 0; } };
    return api;
}));
