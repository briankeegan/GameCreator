// THE OPTIONS, AS FEATURES. The plan is BITBOT.md; this is the measuring half.
//
// A quantity that is the same for every candidate in a decision cannot change
// which move is played, so it is INFO and does not belong here. The clock, the
// incoming queue and whether we are topped out are all info: they pick the mode
// and gate the pool. What is here is measured on the board a candidate LEAVES.
//
// EVERY FEATURE IS A SHARE. Divisor analytic where the board gives one, otherwise
// the observed maximum over real boards, recorded beside it. Nothing here decides
// whether more of a feature is good — that is a weight.
//
// THE DIVISORS AND THE BUCKETS WERE BOTH WRONG FIRST TIME, and both times by
// measuring the wrong thing, so the provenance is written down rather than
// implied:
//   - the counts were sized against the NUMBER of options, when the feature
//     counts options reaching a given size, which is a far smaller number
//   - chain 5 and 6 were dropped for reading flat over 2,358 captured boards.
//     Those boards are positions the CURRENT bot played, and it does not build
//     chains, so they hold no deep-chain material. Circular: drop them on that
//     evidence and the next bot cannot learn what the last one never did. One
//     open-topped bucket instead, validated against the chip corpus.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./bitmatch.js'), require('./bitoptions.js'));
    } else {
        root.BitFeatures = factory(root.BitMatch, root.BitOptions);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (bit, bitoptions) {
    'use strict';

    var W = 6, H = 12;

    // Chains counted at 2, 3, 4 and then 5-OR-MORE; combos at 4, 5, 6 and
    // 7-or-more. The top bucket is open because a ceiling read off this bot's own
    // boards is a ceiling the next bot inherits.
    var CHAIN_BUCKETS = [2, 3, 4, 5];
    var COMBO_BUCKETS = [4, 5, 6, 7];
    var CHAIN_TOP = 5, COMBO_TOP = 7;

    function popcount(x) { var n = 0; while (x) { x &= x - 1; n++; } return n; }

    // THE SURFACE, FROM THE MASKS. On a settled board a column is a packed run,
    // so its height is a popcount.
    //
    // Two roughness numbers, because they are two questions and the correlation
    // agrees. bumpiness is step to step — what a horizontal three needs flat and
    // a vertical three does not care about. spread is only tallest against
    // shortest. A staircase is bumpy and even; a tower beside a pit is smooth and
    // lopsided. Measured over 1,572 boards the two stay under 0.9 with each
    // other, while tallest against a headroom term came out at exactly -1.0 — the
    // same feature twice, which is why there is no headroom here.
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

    // Level 10's own numbers, read off LEVELS rather than restated, so a level
    // table change cannot leave a stale copy here saying otherwise.
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
                              // the options reaching one size, which is where a
                              // divisor of 60 came from and clamped 117 of them
        frames: 41,           // observed — cheapest clear on a board
        moveFrames: 64,       // analytic — the longest walk on a 6x12 board, plus the swap
        chainTop: 6,          // analytic — the deepest chain the chip corpus holds
        comboTop: 8,          // observed — the widest single clear real boards reach
        breakWays: 56,        // observed 49 — ways to reach a slab, now or after a
                              // setup. Only 187 of 2,358 boards have any at all,
                              // so the feature is mostly 0 and that is the board
                              // talking, not the divisor
        stop: 100             // analytic — level 10's awardStopTime peaks at 98
    };

    // A divisor is no use if what it divides can exceed it, so a share is clamped
    // and the clamping is COUNTED rather than hidden: clamps climbing means an
    // observed maximum has been outgrown and a feature is going constant near the
    // top of its range.
    var clamped = 0;
    function share(v, norm) {
        var s = v / norm;
        if (s > 1) { clamped++; return 1; }
        return s < 0 ? 0 : s;
    }

    // Exactly this size — or, for the top bucket, this size or more. Cumulative
    // counts put adjacent sizes above 0.9 with each other by construction, which
    // is collinearity built in rather than discovered.
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

    // EVERY FEATURE, for the board a candidate leaves.
    //
    //   board       a LogicalBoard, settled
    //   cursor      [row, col] — what prices the options on it
    //   moveFrames  what playing THIS candidate cost; belongs to the move
    //   resolved    what the candidate's own clear did — { chain, total } or null
    //   info        engine state every candidate shares: { stopTime, toppedOut }.
    //               Without it the stop-time features are ABSENT rather than
    //               guessed, the way modes.warned refuses to be warned on a guess.
    function features(board, cursor, moveFrames, resolved, info, engine) {
        var st = bit.maskState(board.grid, board.blocks, W, H);
        var surf = api.surface(st);
        var list = bitoptions.options(board, W, H, cursor || [1, 1], 2);
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

        // NEARER IS MORE, so every feature reads the same way round. With nothing
        // on offer there is no price at all — reported 0, and told apart from a
        // free clear by the Ways features beside it also being 0.
        var near = cheapestFrames(list.now);
        f.cheapestFrames = near === Infinity ? 0 : 1 - share(near, NORM.frames);
        f.moveFrames = 1 - share(moveFrames || 0, NORM.moveFrames);

        // After one setup, NOT per size: now against next for the same size
        // measured 0.90 to 0.99, which is one dimension wearing two names.
        f.nextBestChain = share(bestSize(list.next, 'chain'), NORM.chainTop);
        f.nextBestCombo = share(bestSize(list.next, 'combo'), NORM.comboTop);
        f.nextWays = share(list.next.length, NORM.nextWays);

        // DIGGING IS PROGRESS EVEN WHEN THE CLEAR PAYS NOTHING — modes.pays says
        // so, letting a garbage-breaking clear through a bar it would otherwise
        // fail. Without these the bot cannot see the lid it is under.
        f.breaksNow = (resolved && resolved.brokeGarbage) ? 1 : 0;
        var breakWays = 0;
        var every = list.now.concat(list.next);
        for (i = 0; i < every.length; i++) if (every[i].breaks) breakWays++;
        f.breakWays = share(breakWays, NORM.breakWays);

        if (info && engine && info.stopTime !== undefined) {
            var toppedOut = !!info.toppedOut;
            var left = info.stopTime || 0;

            // WHAT THIS MOVE BANKED -- MINUS WHAT WAS ALREADY ON THE CLOCK.
            //
            // awardStopTime ends `if (stopTime > this.stopTime) this.stopTime =
            // stopTime`: a MAX, not a sum. A clear paying 60 with 90 still
            // running buys NOTHING, and this feature paid the full share for it
            // anyway -- so the bot was rewarded for spending a chain on nothing,
            // fired early, and had no material left when the clock ran out. That
            // is why a supply is a matter of TIMING and not of clearing more.
            //
            // THE GAIN IS NOT THE PAYOUT SHIFTED BY A CONSTANT, which is the
            // trap the potential features fell into. `left` is the same for every
            // candidate, but max(0, earned - left) CLAMPS, so every payout under
            // the running clock collapses to the same 0 while the ones above it
            // stay ordered. That changes the ranking: while the clock is high
            // nothing is worth cashing and the bot does something else; as it
            // empties, payouts separate again and firing becomes the best move.
            var earned = 0;
            if (resolved && resolved.total > 0) {
                var isChain = resolved.chain >= 2;
                earned = api.stopTimeOf(engine, isChain, isChain ? 0 : resolved.total,
                                        isChain ? resolved.chain : 0, toppedOut);
            }
            // THE CLOCK DRAINS WHILE THE CURSOR WALKS, so what this clear has to
            // beat is not the clock NOW but the clock WHEN IT LANDS. stopTime
            // decrements every frame it is above zero, so after the move's own
            // cost only max(0, left - cost) is still running:
            //
            //     gain = max(0, earned - max(0, left - cost))
            //
            // Subtracting `left` flat was wrong the other way: it suppressed
            // every big clear while the clock was high, including the ones whose
            // walk is long enough to empty it. A 6-chain 60 frames away with 70
            // running lands with 10 left and gains about 50, not nothing.
            //
            // This is the whole of "do not fire until it is low enough to gain
            // more", and it is arithmetic rather than a preference -- the weight
            // only decides how much the gain is worth against everything else.
            var cost = moveFrames || 0;
            var whenItLands = Math.max(0, left - cost);
            f.stopEarned = share(Math.max(0, earned - whenItLands), NORM.stop);

            // AND WHAT THE BOARD IT LEAVES COULD BANK BEFORE THE CLOCK EMPTIES.
            // Stop time is a MAX, not a sum, so an option worth 98 frames that
            // takes 120 to reach does not keep the supply up.
            // THE BUDGET IS THE CLOCK WHILE IT RUNS, AND THE FLOOR'S ARRIVAL
            // WHEN IT DOES NOT. With `left` alone the budget is 0 on every frame
            // the board is not frozen -- which is most of them -- so the feature
            // read 0 for every candidate and cancelled out of the ranking
            // exactly when the bot needed to be lining the next payout up.
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

    // Fixed order, so a weight vector means the same thing every time it is read.
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

    // What a decision reads off the engine and shares across every candidate.
    // Written down here so the split lives in one place rather than being implied
    // by which arguments happen to get passed.
    function infoKeys() {
        return ['toppedOut', 'stopTime', 'incoming', 'cursorRow', 'cursorCol',
                'framesPerRow', 'health'];
    }

    // Calls go through this object so a test can replace one step with a broken
    // one and prove the sweep notices.
    var api = { features: features, keys: keys, infoKeys: infoKeys, surface: surface,
                stopTimeOf: stopTimeOf, ways: ways, bestSize: bestSize, NORM: NORM,
                CHAIN_BUCKETS: CHAIN_BUCKETS, COMBO_BUCKETS: COMBO_BUCKETS,
                CHAIN_TOP: CHAIN_TOP, COMBO_TOP: COMBO_TOP,
                clamps: function () { return clamped; },
                resetClamps: function () { clamped = 0; } };
    return api;
}));
