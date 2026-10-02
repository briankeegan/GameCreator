(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        var path = require('path');
        require(path.join(__dirname, '..', '..', 'panel-engine.js'));
        require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
        module.exports = factory(require('./bitmatch.js'), require('./bitfeatures.js'),
                                 require('./bitlineup.js'), require('./travel.js'),
                                 require('./bitoptions.js'));
    } else {
        root.BitBot = factory(root.BitMatch, root.BitFeatures, root.BitLineup,
                              root.PanelEval.travel, root.BitOptions);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (bit, BF, lineup, travel, bitoptions) {
    'use strict';

    var W = 6, H = 12;

    function tallestOf(pool) {
        for (var i = 0; i < pool.length; i++) {
            if (pool[i].kind === 'hold') return tallestBoard(pool[i].masks);
        }
        return 0;
    }

    function G() { return (typeof window !== 'undefined' ? window : globalThis); }
    function PanelCpu() { return G().PanelCpu; }
    function PanelEngine() { return G().PanelEngine; }

    var STARTER = {
        bumpiness: -20, spread: -10, tallest: -40,
        chain2: 5, chain3: 13, chain4: 20, chain5plus: 30,
        combo4: 4, combo5: 6, combo6: 8, combo7: 10,
        cheapestFrames: 10, moveFrames: 5,
        nextBestChain: 15, nextBestCombo: 5, nextWays: 5,
        breaksNow: 25, breakWays: 5,
        stopEarned: 50, stopReachable: 30
    };

    function framesPerRow(s) {
        var e = PanelEngine();
        return e.riseTime ? e.riseTime(s.speed) * 16 : 0;
    }
    function framesToNextRow(s) {
        var e = PanelEngine();
        if (!e.riseTime) return Infinity;
        var perPixel = e.riseTime(s.speed);
        var disp = s.displacement === undefined ? 16 : s.displacement;
        return (s.riseTimer || 0) + Math.max(0, disp - 1) * perPixel;
    }

    function signature(st) {
        var out = [], a, c, stride = st.W + 2;
        for (c = 1; c <= st.W; c++) out.push(st.occ[c] + ':' + st.garb[c]);
        for (a = 1; a <= st.N; a++) for (c = 1; c <= st.W; c++) out.push(st.colour[a * stride + c]);
        return out.join(',');
    }

    function BitBot(stack, opts) {
        opts = opts || {};
        this.stack = stack;
        travel.setPress(stack.swapLatency);
        this.weights = opts.weights || STARTER;
        this.reaction = opts.reaction === undefined ? 12 : opts.reaction;
        this.cursorMoveFrames = travel.MOVE_FRAMES;
        this.reveal = opts.reveal !== false;
        this.allowRaise = opts.allowRaise !== false;
        this.refuseReturn = opts.refuseReturn !== false;
        this.refusePayless = opts.refusePayless !== false;
        this.beam = opts.beam === undefined ? 8 : opts.beam;
        this.maxDepth = opts.maxDepth === undefined ? 20 : opts.maxDepth;
        this.horizonDeath = opts.horizonDeath !== false;
        this._seen = [];
        this._plan = null;
        this._flatten = null;
        this._opening = true;
        this._attack = null;

        this._snapshot = PanelCpu().snapshot;
        this._beginWalk = PanelCpu().beginWalk;
        this._driveWalk = PanelCpu().driveWalk;
        this._nearestSwappable = PanelCpu().nearestSwappable;

        this.cooldown = 0;
        this.raiseFrames = 0;
        this._raiseStarted = false;
        this._walk = null;
        this._lastSwap = null;
        this._recentSwaps = [];
        this.decisions = 0;
        this.spend = { gameOver: 0, walking: 0, cooling: 0, decided: 0 };
        this.frozen = { walking: 0, cooling: 0, hold: 0, raise: 0, swap: 0 };
        this.counts = { refusedDeadly: 0, allDead: 0, byMode: {},
                        refusedReturn: 0, defendByClock: 0, refusedTooSlow: 0, planned: 0, planDropped: 0,
                        attacked: 0, attackDropped: 0, cellsPlanned: 0, refusedPayless: 0, refusedStarving: 0, refusedOther: 0, refusedAtExit: 0,
                        raisedForMaterial: 0, waitedToRaise: 0, dugFor: 0, digDropped: 0, brokeNow: 0, flattenBlind: 0,
                        openingRaises: 0, waitedToRaise: 0, saveKept: 0, saveUnkeepable: 0, savePlanned: 0, heldTheBreak: 0, forcedBreak: 0, forcedBoth: 0, refusedEarly: 0,
                        raises: 0, holds: 0, swaps: 0, revealSwaps: 0,
                        revealWindows: 0, digging: 0, flattened: 0, flattenDropped: 0,
                        refusedStranded: 0, refusedNoFailsafe: 0, refusedSameSwap: 0 };
    }

    BitBot.prototype.info = function (board) {
        var s = this.stack, incoming = 0, nextSlab = 0;
        if (s.incoming) {
            for (var i = 0; i < s.incoming.length; i++) {
                incoming += (s.incoming[i].width || 0) * (s.incoming[i].height || 1);
            }
            if (s.incoming.length) {
                nextSlab = (s.incoming[0].width || 0) * (s.incoming[0].height || 1);
            }
        }
        return {
            toppedOut: (typeof s.isToppedOut === 'function' && s.isToppedOut()) || !!s.wasToppedOut,
            stopTime: s.stopTime || 0,
            incoming: incoming,
            nextSlab: nextSlab,
            fallingGarbage: typeof s.hasFallingGarbage === 'function' && s.hasFallingGarbage(),
            cursorRow: board.cursor ? board.cursor.row : (s.curRow || 1),
            cursorCol: board.cursor ? board.cursor.col : (s.curCol || 1),
            health: s.health,
            drainRun: (s.panels && s.height) ? this.drainBound() : 1,
            fillRatio: typeof s.fillRatio === 'function' ? s.fillRatio() : 0,
            framesPerRow: framesPerRow(s),
            framesToNextRow: framesToNextRow(s),
            speed: s.speed,
            nextSpeedUp: s.nextSpeedIncreaseClock,
            startingSpeed: s.levelData ? s.levelData.startingSpeed : s.speed,
            clock: s.clock
        };
    };

    BitBot.prototype.aim = function () {
        var w = this.weights, best = 0, links = 0, wide = 0, i, v;
        var CH = [['chain2', 2], ['chain3', 3], ['chain4', 4], ['chain5plus', 5]];
        var CO = [['combo4', 4], ['combo5', 5], ['combo6', 6], ['combo7', 7]];
        for (i = 0; i < CH.length; i++) { v = w[CH[i][0]] || 0; if (v > best) { best = v; links = CH[i][1]; } }
        best = 0;
        for (i = 0; i < CO.length; i++) { v = w[CO[i][0]] || 0; if (v > best) { best = v; wide = CO[i][1]; } }
        return { links: links || 2, wide: wide || 4 };
    };

    BitBot.prototype.mode = function (info, pool, revealOpen, deadline, escape) {
        var name = 'BUILD';
        if (info.toppedOut) name = 'DEFEND';
        else if (escape !== null && escape !== undefined &&
                 deadline <= escape + this.reaction) name = 'DEFEND';
        else {
            for (var i = 0; i < pool.length; i++) {
                var r = pool[i].resolved;
                if (!r || !r.total) continue;
                if (cellsSent(PanelEngine(), r.chain >= 2 ? 'chain' : 'combo',
                              r.total, r.chain) > 0) { name = 'ATTACK'; break; }
            }
        }
        return { name: name, reveal: !!revealOpen };
    };

    function materialRows(st) {
        var n = 0;
        for (var c = 1; c <= W; c++) n += bit.popcount((st.occ[c] & ~st.garb[c]) >>> 0);
        return n / W;
    }

    function bumpiness(st) {
        var h = [], c, n = 0;
        for (c = 1; c <= W; c++) {
            var g = st.garb[c] >>> 0;
            var floor = g ? (g & -g) : 0;
            var below = floor ? (floor - 1) : 0xffffffff;
            h[c] = bit.popcount((st.occ[c] & ~g & below) >>> 0);
        }
        for (c = 1; c < W; c++) n += Math.abs(h[c] - h[c + 1]);
        return n;
    }

    function matchWays(st) {
        var r = bit.reachMask(st), n = 0;
        for (var c = 1; c <= W; c++) n += bit.popcount(r[c] >>> 0);
        return n;
    }

    BitBot.prototype.deadly = function (st, resolved, info, horizon) {
        var tallest = tallestBoard(st);
        var banked = info.stopTime || 0;
        if (resolved && resolved.total > 0) {
            var isChain = resolved.chain >= 2;
            banked = Math.max(banked, BF.stopTimeOf(PanelEngine(), isChain,
                                                    isChain ? 0 : resolved.total,
                                                    isChain ? resolved.chain : 0, true));
        }

        var rows = 0;
        if (this.horizonDeath && info.framesToNextRow !== undefined) {
            var spend = (horizon || 0) - banked;
            if (spend >= info.framesToNextRow && isFinite(info.framesToNextRow)) {
                rows = 1 + (info.framesPerRow > 0
                            ? Math.floor((spend - info.framesToNextRow) / info.framesPerRow) : 0);
            }
        }
        if (tallest + rows < H) return false;                  // room left: not dead

        var held = Math.max(banked, info.toppedOut ? Math.max(0, (info.drainRun || 1) - 1) : 0);
        if (resolved && (resolved.total > 0 || resolved.garbage > 0)) {
            held += BF.resolveFramesOf(PanelEngine(), resolved.total || 0,
                                       resolved.garbage || 0);
        }
        return held <= travel.MOVE_FRAMES;                     // full, nothing holding it
    };

    BitBot.prototype.lookahead = function (st, info, horizon) {
        var sw = bit.legalSwapsOf(st), i, r;
        var out = { stranded: true, hasClear: false, hasBreak: false };
        for (i = 0; i < sw.length; i++) {
            if (!bit.swapMasks(st, sw[i][0], sw[i][1])) continue;
            r = bit.resolveFromMasks(st, true);
            bit.swapMasks(st, sw[i][0], sw[i][1]);
            if (r.scope !== 'ok' && r.scope !== 'garbage-broke') continue;
            if (r.scope === 'garbage-broke') { out.hasBreak = true; out.hasClear = true; }
            else if (r.total > 0) out.hasClear = true;
            if (out.stranded && !this.deadly(r.settled || st, r, info, horizon)) {
                out.stranded = false;
            }
            if (out.hasBreak && !out.stranded) break;
        }
        return out;
    };

    var FLOOR = { bumpiness: -20, tallest: -40, spread: -10 };

    BitBot.prototype.score = function (st, moveFrames, resolved, info) {
        var isChain = !!resolved && resolved.chain >= 2;
        var earned = resolved
                   ? BF.stopTimeOf(PanelEngine(), isChain,
                                   isChain ? 0 : resolved.total,
                                   isChain ? resolved.chain : 0, !!info.toppedOut)
                   : 0;
        var after = {};
        for (var ik in info) after[ik] = info[ik];
        after.stopTime = (info.stopTime || 0) + earned;
        var lands = framesToDeath(after, tallestBoard(st), info.framesPerRow);
        var out = BF.features(null, [info.cursorRow, info.cursorCol], moveFrames,
                             resolved, info, PanelEngine(), st,
                             this.clock(after, lands, st));
        var w = this.weights, total = 0, keys = BF.keys();
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i], v = out.f[k];
            if (v === undefined) continue;
            var wk = w[k] || 0;
            if (FLOOR[k] !== undefined) wk = Math.min(wk, FLOOR[k]);
            if (!wk) continue;
            total += wk * v;
        }
        return total;
    };

    BitBot.prototype.canRaise = function () {
        if (!this.allowRaise) return false;
        if (this.raiseFrames > 0) return false;
        var s = this.stack;
        if (s.preventManualRaise || s.manualRaise) return false;
        if (typeof s.isToppedOut === 'function' && s.isToppedOut()) return false;
        if (typeof s.hasFallingGarbage === 'function' && s.hasFallingGarbage()) return false;
        if (s.riseLock) return false;
        if (typeof s.hasActivePanels === 'function' && s.hasActivePanels()) return false;
        if ((s.shakeTime || 0) > 0) return false;
        return true;
    };

    function summarise(res) {
        return { chain: res.chain || 0, total: res.total || 0,
                 biggest: res.rounds === 1 ? (res.total || 0) : 0,
                 brokeGarbage: res.scope === 'garbage-broke' ? 1 : 0,
                 converts: res.converts || 0, voidAfter: res.voidAfter || 0,
                 scope: res.scope };
    }

    BitBot.prototype.candidates = function (board, info) {
        var out = [], i, r, c;
        var base = bit.maskState(board.grid, board.blocks, W, board.height, board.motion);

        out.push({ kind: 'hold', swap: null, board: board, masks: base,
                   moveFrames: 0, resolved: null });

        if (this.canRaise() && board.rise) {
            var risen = board.clone().rise(board.incoming);
            risen.incoming = false;
            var rst = bit.maskState(risen.grid, risen.blocks, W, risen.height, risen.motion);
            var rres = bit.resolveFromMasks(rst, true);
            var rmasks = rres.settled || rst;
            var rres2 = summarise(rres);
            var inRows = Math.ceil((info.incoming || 0) / W);
            if (tallestBoard(rmasks) + inRows + 1 < H) {
                out.push({ kind: 'raise', swap: null,
                           board: null,
                           masks: rmasks,
                           moveFrames: 0, resolved: rres2 });
            }
        }

        var moving = false;
        if (board.motion) {
            for (r = 1; r <= board.height && !moving; r++) {
                for (c = 1; c <= W; c++) {
                    var mo = board.motion[r] && board.motion[r][c];
                    if (mo && mo.state && mo.state !== 'normal') { moving = true; break; }
                }
            }
        }
        var tm = moving ? lineup.timedOf(board, this.stack.frames, board.height) : null;
        out[0].resolved = summarise(tm
            ? bit.resolveFromMasks(bit.copyState(tm.st), false, tm.opts)
            : bit.resolveFromMasks(base, false));
        var legal = bit.legalSwapsOf(base);
        for (i = 0; i < legal.length; i++) {
            r = legal[i][0]; c = legal[i][1];
            if (!bit.swapMasks(base, r, c)) continue;       // refused: not a move
            var res = bit.resolveFromMasks(base, true);
            if (tm) {
                {
                    var rt = bit.resolveFromMasks(bit.copyState(tm.st), false, {
                        frames: tm.opts.frames, hover: tm.opts.hover, hovering: tm.opts.hovering,
                        chaining: tm.opts.chaining, popping: tm.opts.popping, popAt: tm.opts.popAt,
                        swap: [r, c],
                        at: travel.cost(info.cursorRow, info.cursorCol, r, c) });
                    if (rt.scope === 'refused') { bit.swapMasks(base, r, c); continue; }
                    res = { scope: rt.scope, chain: rt.chain, total: rt.total, rounds: rt.rounds,
                            settled: res.scope === rt.scope ? res.settled : null };
                }
            }
            var after = res.settled || bit.copyState(base);
            bit.swapMasks(base, r, c);                     // put it back
            var rs0 = this._recentSwaps || [], skip0 = false;
            if (!(res && (res.total > 0 || res.scope === 'garbage-broke'))) {
                for (var z0 = 0; z0 < rs0.length; z0++) {
                    if (rs0[z0][0] !== r || rs0[z0][1] !== c) continue;
                    var ub = 1 << (r - 1);
                    if ((base.occ[c] & ub) && (base.occ[c + 1] & ub)) { skip0 = true; break; }
                }
            }
            if (skip0) continue;
            out.push({ kind: 'swap', swap: [r, c],
                       board: null,
                       masks: after,
                       moveFrames: travel.cost(info.cursorRow, info.cursorCol, r, c),
                       resolved: summarise(res) });
        }
        return out;
    };

    BitBot.prototype.revealPick = function (board) {
        if (!this.reveal) return null;
        var plan;
        try {
            plan = lineup.bestInWindow(board, this.stack.frames, board.height,
                                       [board.cursor ? board.cursor.row : 1,
                                        board.cursor ? board.cursor.col : 1],
                                       board.legalSwaps(),
                                       { spendLeast: this.stack.isToppedOut() });
        } catch (e) { return null; }                 // an unreadable window is not a move
        if (!plan) return null;
        this.counts.revealWindows++;
        if (this.stack.isToppedOut()) return plan.best && plan.best.broke ? plan : null;
        return plan.best && plan.best.swap ? plan : null;
    };

    function tallestBoard(st) {
        if (!st) return H;                  // unknown position: treat as full
        var t = 0;
        for (var c = 1; c <= W; c++) {
            var o = st.occ[c];
            if (!o) continue;
            var top = 32 - Math.clz32(o >>> 0);
            if (top > t) t = top;
        }
        return t;
    }

    function endsAt(swaps, info) {
        var last = swaps && swaps.length ? swaps[swaps.length - 1] : null;
        return last ? [last[0], last[1]] : [info.cursorRow, info.cursorCol];
    }

    function framesToRise(rows, info, framesPerRow, startClock) {
        var e = PanelEngine();
        if (!e || !e.riseTime || !(rows > 0)) return Math.max(0, rows) * (framesPerRow || 0);
        var speed = info.speed, up = info.nextSpeedUp;
        var clock = (startClock === undefined || startClock === null)
                  ? info.clock : startClock;
        if (!(speed > 0) || !(up > info.clock)) return rows * (framesPerRow || 0);
        var steps = Math.max(1, speed - (info.startingSpeed || speed) + 1);
        var every = up / steps;
        if (!(every > 0)) return rows * (framesPerRow || 0);
        var frames = 0, left = rows, guard = 0;
        while (up <= clock && guard++ < 128) {
            speed = Math.min(speed + 1, 99);
            up += every;
        }
        guard = 0;
        while (left > 0 && guard++ < 128) {
            var fpr = e.riseTime(speed) * 16;
            if (!(fpr > 0)) return frames + left * (framesPerRow || 0);
            var until = up - clock;                   // frames until the next step up
            var canDo = until / fpr;                  // rows that fit before it
            if (canDo >= left) return frames + left * fpr;
            frames += until;
            left -= canDo;
            clock = up;
            up += every;
            speed = Math.min(speed + 1, 99);
        }
        return frames;
    }

    function garbageRows(masks) {
        if (!masks || !masks.garb) return 0;
        var best = 0;
        for (var c = 1; c <= W; c++) {
            var n = bit.popcount(masks.garb[c] >>> 0);
            if (n > best) best = n;
        }
        return best;
    }

    function framesToDeath(info, tallest, framesPerRow) {
        var clock = info.stopTime || 0;
        if (info.toppedOut) return Math.max(0, (info.drainRun || 1) - 1);
        var queued = Math.ceil((info.nextSlab || 0) / W);
        return clock + framesToRise(Math.max(0, H - tallest - queued), info, framesPerRow,
                                    (info.clock || 0) + clock);
    }

    BitBot.prototype.windowOpen = function () {
        var s = this.stack, flying = 0, converted = 0;
        for (var r = 1; r <= s.height; r++) {
            var row = s.panels[r];
            if (!row) continue;
            for (var c = 1; c <= s.width; c++) {
                var p = row[c];
                if (!p) continue;
                if (p.state && p.state !== 'normal') flying++;
                if (p.fellFromGarbage) converted++;
                if (flying && converted) return true;
            }
        }
        return false;
    };

    BitBot.prototype.inFlight = function () {
        var s = this.stack;
        if (typeof s.hasActivePanels === 'function' && s.hasActivePanels()) return true;
        return (s.shakeTime || 0) > 0;
    };

    var NOT_STRANDED = { stranded: false, hasClear: false, hasBreak: false };

    function tierOf(cand) {
        var r = cand.resolved;
        if (!r || !r.total) return 3;
        var cells = cellsSent(PanelEngine(), r.chain >= 2 ? 'chain' : 'combo', r.total, r.chain);
        if (cells > 0) return r.brokeGarbage ? 0 : 1;
        return r.brokeGarbage ? 2 : 4;
    }

    function depthFor(deadline, reaction, tallest) {
        var playable = Math.max(1, Math.floor(deadline / Math.max(1, reaction)));
        return playable;
    }

    var WORKING_ROWS = 4;

    function heldFrames(frames, stopGain, cleared, garbagePanels) {
        if (!frames) return stopGain || 0;
        var popping = 0;
        if (cleared > 0 || garbagePanels > 0) {
            popping = (frames.FLASH || 0) + (frames.FACE || 0) +
                      (frames.POP || 0) * (cleared + garbagePanels);
        }
        return Math.max(stopGain || 0, popping);
    }

    function cellsSent(engine, kind, size, chain) {
        var cells = 0, i;
        if (kind !== 'chain') {
            var pieces = engine.comboGarbage(size) || [];
            for (i = 0; i < pieces.length; i++) cells += pieces[i];   // each one row tall
            return cells;
        }
        return chain > 1 ? W * (chain - 1) : 0;
    }

    function ruinsShape(o) {
        if (o.opensHole) return true;
        if (o.closesBreak) return true;
        return false;
    }

    function shortfallOf(o) {
        return (o.mat === null || o.mat === undefined)
             ? 0 : Math.max(0, WORKING_ROWS - o.mat);
    }

    function bestAttack(list, weights, engine, deadline, framesTable, perPanelFrames) {
        var best = null, all = list.now.concat(list.next), i;
        var level = [];
        for (i = 0; i < all.length; i++) if (all[i].levels) level.push(all[i]);
        if (level.length) all = level;
        var keep = [];
        for (i = 0; i < all.length; i++) {
            var ot = all[i].tall;
            if (ot !== null && ot !== undefined && ot >= H - WORKING_ROWS &&
                all[i].breakReady === false) continue;
            keep.push(all[i]);
        }
        if (keep.length) all = keep;
        for (i = 0; i < all.length; i++) {
            var o = all[i];
            if (!o.swaps || !o.swaps.length) continue;
            if ((o.duration || o.frames) > deadline) continue;
            if (ruinsShape(o)) continue;
            var isChain = o.kind === 'chain';
            var cells = cellsSent(engine, o.kind, o.size, o.chain);
            if (o.breaks && perPanelFrames > 0) {
                cells += heldFrames(framesTable, 0, o.total, o.garbage || W) / perPanelFrames;
            }
            var short = shortfallOf(o);
            cells -= short * W;
            cells += (o.voidGain || 0) * W;
            if (perPanelFrames > 0) cells += (o.slabGain || 0) / perPanelFrames;
            if (perPanelFrames > 0) {
                cells += (o.converts || 0) *
                         Math.max(perPanelFrames, (deadline || 0) / W) / perPanelFrames;
            }
            if (perPanelFrames > 0) cells += (o.slabWorth || 0) / perPanelFrames;
            if (o.matNow !== null && o.matNow !== undefined &&
                o.matNow < WORKING_ROWS) cells += Math.max(0, o.digGain || 0);
            if (cells <= 0) continue;                       // sends nothing, holds nothing
            var key = isChain
                ? 'chain' + (o.chain >= 5 ? '5plus' : Math.max(2, Math.min(4, o.chain)))
                : 'combo' + Math.max(4, Math.min(7, o.size));
            var taste = 1 + ((weights[key] || 0) / 100);
            if (taste < 0.1) taste = 0.1;
            var rate = (cells / Math.max(1, o.duration || o.frames)) * taste;
            var win = !best || rate > best.rate;
            if (!win && best && rate === best.rate) {
                var ob = o.bumps === null || o.bumps === undefined ? 1e9 : o.bumps;
                var bb = best.option && best.option.bumps !== null &&
                         best.option.bumps !== undefined ? best.option.bumps : 1e9;
                win = ob < bb;
            }
            if (win) {
                best = { rate: rate, cells: cells, frames: o.frames,
                         move: o.swaps[0], option: o };
            }
        }
        return best;
    }

    function bestPlan(list, clock, deadline, engine, toppedOut, framesPerRow, framesTable, tallNow, fitsOf) {
        var best = null, over = null, all = list.now.concat(list.next), i;
        var lvl = [];
        for (i = 0; i < all.length; i++) if (all[i].levels) lvl.push(all[i]);
        if (lvl.length) all = lvl;
        var keep = [];
        for (i = 0; i < all.length; i++) {
            var ot = all[i].tall;
            if (ot !== null && ot !== undefined && ot >= H - WORKING_ROWS &&
                all[i].breakReady === false) continue;
            keep.push(all[i]);
        }
        if (keep.length) all = keep;
        var perPanel = (framesPerRow || 0) / W;
        for (i = 0; i < all.length; i++) {
            var o = all[i];
            if (!o.swaps || !o.swaps.length) continue;
            var took = o.duration || o.frames;
            var fits = fitsOf ? fitsOf(o) : took <= deadline;
            var isChain = o.kind === 'chain';
            var pays = BF.stopTimeOf(engine, isChain, isChain ? 0 : o.size,
                                     isChain ? o.chain : 0, toppedOut);
            var stopGain = Math.max(0, pays - Math.max(0, clock - took));
            var gain = heldFrames(framesTable, stopGain, o.total,
                                  o.garbage || (o.breaks ? W : 0));
            var perCell = Math.max(perPanel, (deadline || 0) / W);
            var lowered = (tallNow && o.tall !== null && o.tall !== undefined)
                        ? Math.max(0, tallNow - o.tall) : 0;
            if (o.mat !== null && o.mat !== undefined && o.mat < WORKING_ROWS &&
                !o.breaks && (o.total || 0) > 0) continue;
            if (ruinsShape(o)) continue;
            var shortfall = shortfallOf(o);
            var holds = (o.total > 0 || (o.garbage || 0) > 0)
                      ? BF.resolveFramesOf(engine, o.total || 0, o.garbage || 0) : 0;
            var digs = (o.matNow !== null && o.matNow !== undefined &&
                        o.matNow < WORKING_ROWS)
                     ? Math.max(0, o.digGain || 0) * perPanel : 0;
            var bought = o.total * perPanel + holds + (o.converts || 0) * perCell
                       + lowered * (framesPerRow || 0) + gain
                       - shortfall * (framesPerRow || 0)
                       + (o.voidGain || 0) * (framesPerRow || 0)
                       + (o.slabGain || 0)
                       + digs
                       + (o.slabWorth || 0);
            var rate = bought / Math.max(1, took);
            var cur = fits ? best : over;
            var better = !cur || rate > cur.rate;
            if (!better && cur && rate === cur.rate) {
                var mb = o.bumps === null || o.bumps === undefined ? 1e9 : o.bumps;
                var cb = cur.option.bumps === null || cur.option.bumps === undefined
                       ? 1e9 : cur.option.bumps;
                better = mb < cb || (mb === cb && took < cur.frames);
            }
            if (better) {
                cur = { rate: rate, gain: gain, frames: took, move: o.swaps[0], option: o };
                if (fits) best = cur; else over = cur;
            }
        }
        return best || over;
    }

    BitBot.prototype.timing = function (info, deadline, base) {
        var t = this.clock(info, deadline, base);
        t.avoidSwap = this._recentSwaps;
        if (info.toppedOut) t.lock = Math.max(0, (info.drainRun || 1) - 1);
        return t;
    };

    BitBot.prototype.clock = function (info, deadline, base) {
        if (base) info._base = base;
        var frozen = (info.stopTime || 0) > 0 || !!info.toppedOut;
        return {
            framesPerRow: info.framesPerRow || 0,
            workingRows: WORKING_ROWS,
            holdWorth: BF.resolveFramesOf(PanelEngine(), 3, 0),
            deadline: deadline || 0,
            reaction: this.reaction,
            overhead: travel.MOVE_FRAMES + (frozen ? 0 : this.reaction),
            resolve: function (size, garbage) {
                return BF.resolveFramesOf(PanelEngine(), size, garbage);
            },
            prepare: true,
            stopKey: info.toppedOut ? 'top' : 'free',
            stopPrice: function (r) {
                var isChain = r.chain >= 2;
                return BF.stopTimeOf(PanelEngine(), isChain,
                                     isChain ? 0 : bitoptions.sizeOf(r.chain, r.total),
                                     isChain ? r.chain : 0, !!info.toppedOut);
            }
        };
    };

    BitBot.prototype._decide = function () {
        var self = this;
        var board = this._snapshot();
        var info = this.info(board);
        var pool = this.candidates(board, info);
        var base = pool.length ? pool[0].masks : bit.maskState(board.grid, board.blocks, W, board.height, board.motion);
        this._lastInfo = info; this._lastPool = pool; this._lastBase = base;
        this._incomingRow = board.incoming;
        this._lastOptions = null; this._lastDeadline = 0;
        var rev = this.revealPick(board);
        var deadline = framesToDeath(info, tallestOf(pool), info.framesPerRow);
        this._lastDeadline = deadline;
        var queued = Math.ceil((info.incoming || 0) / W);
        var landed = garbageRows(base);
        if (landed > (this._maxSlab || 0)) this._maxSlab = landed;
        var poolBreak = false;
        for (i = 0; i < pool.length; i++) {
            if (pool[i].resolved && pool[i].resolved.brokeGarbage) { poolBreak = true; break; }
        }
        var lookDepth = Math.min(this.maxDepth, depthFor(info.toppedOut
            ? Math.max(deadline, BF.resolveFramesOf(PanelEngine(), 3, 0)) : deadline, this.reaction, tallestOf(pool)));
        var raising = this.raiseMode(info, base, poolBreak);
        this._wantRaise = !!raising;
        var options = null;
        var digging = false;
        for (i = 1; i <= W; i++) if (base.garb[i]) { digging = true; break; }
        if (digging) this.counts.digging++;
        var survival = null, planWait = null, planWaitEscape = Infinity;
        var swept = false;
        if (raising) {
            this._plan = null;
            this._attack = null;
            this._flatten = null;
        } else if (info.toppedOut || !(info.stopTime > 0)) {
            swept = true;
            if (this._plan && this._plan.moves.length) {
                var nx = this._plan.moves[0];
                var stillLegal = playable(nx);
                var spent = Math.max(0, this.stack.clock - (this._plan.startedAt || 0));
                var remains = Math.max(0, this._plan.frames - spent);
                var planFits = this.planInTime(this._plan.moves, remains, base, info, deadline);
                if (stillLegal && planFits) {
                    survival = { move: nx, gain: this._plan.gain, frames: remains, rate: this._plan.rate };
                    this._plan.moves = this._plan.moves.slice(1);
                    if (!this._plan.moves.length) this._plan = null;
                } else if (planFits && settling(nx)) {
                    planWait = nx;
                    planWaitEscape = this._plan.rate >= 1 ? remains : Infinity;
                } else {
                    this._plan = null;
                    this.counts.planDropped++;
                }
            }
            if (!survival && !planWait) {
                options = this._lastOptions = options || bitoptions.options(null, W, H, [info.cursorRow, info.cursorCol], lookDepth, base,
                                                   this.timing(info, deadline, base), digging);
                var self0 = this;
                var plan = bestPlan(options, info.stopTime || 0, deadline, PanelEngine(),
                                    !!info.toppedOut, info.framesPerRow, this.stack.frames,
                                    tallestOf(pool), function (o) {
                                        return self0.planInTime(o.swaps, o.duration || o.frames, base, info, deadline);
                                    });
                if (plan && plan.rate > 0) {
                    this._plan = { moves: plan.option.swaps.slice(1), frames: plan.frames,
                                   gain: plan.gain, rate: plan.rate,
                                   startedAt: this.stack.clock };
                    if (!this._plan.moves.length) this._plan = null;
                    survival = { move: plan.move, gain: plan.gain, frames: plan.frames, rate: plan.rate };
                }
            }
        } else if (this._plan) {
            this._plan = null;                    // clock running again: the plan is stale
        }

        var escape = null;
        if (swept) escape = (survival && survival.rate >= 1) ? survival.frames : Infinity;
        if (swept && planWait) escape = planWaitEscape;
        var mode = this.mode(info, pool, !!rev, deadline, escape);
        this._last = { mode: mode.name, deadline: deadline, escape: escape,
                       pool: pool.length, tallest: tallestOf(pool),
                       stopTime: info.stopTime | 0, health: info.health,
                       toppedOut: !!info.toppedOut };
        this.decisions++;
        this.counts.byMode[mode.name] = (this.counts.byMode[mode.name] || 0) + 1;

        var survivalNeeded = mode.name === 'DEFEND';
        this._lastSurvivalNeeded = survivalNeeded;
        var breakOnPool = false;
        for (var bo = 0; bo < pool.length; bo++) {
            var br = pool[bo].resolved;
            if (br && br.brokeGarbage) { breakOnPool = true; break; }
        }
        this._lastBreakOnPool = breakOnPool;
        var here = signature(base);
        var allowed = [];
        for (var i = 0; i < pool.length; i++) {
            if (pool[i].kind === 'hold') continue;
            var why = this.refuses(pool[i], info, base, survivalNeeded, breakOnPool);
            if (why) {
                if (why === 'payless') this.counts.refusedPayless++;
                else if (why === 'starving') this.counts.refusedStarving++;
                else this.counts.refusedOther++;
                continue;
            }
            if (info.stopTime > 0 && pool[i].kind === 'swap' && pool[i].resolved &&
                pool[i].resolved.total > 0 && !pool[i].resolved.brokeGarbage) {
                var pr3 = pool[i].resolved, isCh = pr3.chain >= 2;
                var pays3 = BF.stopTimeOf(PanelEngine(), isCh, isCh ? 0 : pr3.total,
                                          isCh ? pr3.chain : 0, !!info.toppedOut);
                var left3 = info.stopTime - (pool[i].moveFrames || 0);
                if (pays3 - Math.max(0, left3) <= 0) { this.counts.refusedEarly++; continue; }
            }
            if (pool[i].kind === 'swap' && (pool[i].moveFrames || 0) > deadline) {
                this.counts.refusedTooSlow++; continue;
            }
            allowed.push(pool[i]);
        }
        if (!allowed.length) allowed = pool;
        if (this.refuseReturn) {
            var kept = [];
            for (i = 0; i < allowed.length; i++) {
                if (allowed[i].kind === 'swap' && allowed[i].masks) {
                    var sig = signature(allowed[i].masks);
                    if (sig === here || this._seen.indexOf(sig) >= 0) { this.counts.refusedReturn++; continue; }
                }
                kept.push(allowed[i]);
            }
            if (kept.length) allowed = kept;
            var ls = this._lastSwap;
            if (ls) {
                var notSame = [];
                for (i = 0; i < allowed.length; i++) {
                    var ac = allowed[i];
                    var cashesA = ac.resolved &&
                                  (ac.resolved.total > 0 || ac.resolved.brokeGarbage);
                    if (!cashesA && ac.kind === 'swap' && ac.swap &&
                        ac.swap[0] === ls[0] && ac.swap[1] === ls[1]) {
                        this.counts.refusedSameSwap++;
                        continue;
                    }
                    notSame.push(ac);
                }
                if (notSame.length) allowed = notSame;
            }
        }

        var both = [];
        for (var bi = 0; bi < allowed.length; bi++) if (tierOf(allowed[bi]) === 0) both.push(allowed[bi]);
        if (both.length) { this.counts.forcedBoth++; allowed = both; }

        this._seen.push(here);
        if (this._seen.length > 3) this._seen.shift();

        if (materialRows(base) < 6) {
            var digs = [];
            for (i = 0; i < allowed.length; i++) {
                if (allowed[i].resolved && allowed[i].resolved.brokeGarbage) digs.push(allowed[i]);
            }
            if (digs.length) { this.counts.forcedBreak++; allowed = digs; }
        }
        if (this.beam > 0 && allowed.length > this.beam) {
            var perPanel2 = (info.framesPerRow || 0) / W;
            var scored = [];
            for (i = 0; i < allowed.length; i++) {
                var ac = allowed[i], arr = ac.resolved;
                var cheap = (arr && arr.total ? arr.total * perPanel2 : 0)
                          + (arr && arr.garbage ? arr.garbage * perPanel2 : 0)
                          - tallestBoard(ac.masks) * 8
                          - (ac.moveFrames || 0) * 0.5;
                scored.push({ cand: ac, cheap: cheap });
            }
            scored.sort(function (x, y) { return y.cheap - x.cheap; });
            allowed = [];
            for (i = 0; i < scored.length && i < this.beam; i++) allowed.push(scored[i].cand);
        }

        var noneClear = true;
        for (i = 0; i < allowed.length; i++) {
            if (allowed[i].resolved && allowed[i].resolved.total > 0) { noneClear = false; break; }
        }

        var buried = false;
        for (i = 1; i <= W; i++) if (base.garb[i]) { buried = true; break; }
        var best = null, alive = 0, spare = [], ranked = [];
        for (i = 0; i < allowed.length; i++) {
            var cand = allowed[i];
            var horizon = Math.max((cand.moveFrames || 0) + this.reaction,
                                   info.framesPerRow || 0);
            if (cand.kind === 'swap' && spendsReserve(cand.resolved, cand.masks)) continue;
            if (this.deadly(cand.masks, cand.resolved, info, horizon)) { this.counts.refusedDeadly++; continue; }
            var cashes = cand.resolved && (cand.resolved.total > 0 || cand.resolved.brokeGarbage);
            var ahead = cashes ? NOT_STRANDED : this.lookahead(cand.masks, info, horizon);
            if (ahead.stranded) { this.counts.refusedStranded++; continue; }
            alive++;
            var held = buried ? ahead.hasBreak : ahead.hasClear;
            if (!cashes && !held) {
                this.counts.refusedNoFailsafe++;
                spare.push(cand);
                continue;
            }
            ranked.push(cand);
        }
        var bestDone = false;
        function bestOf() {
            if (bestDone) return best;
            bestDone = true;
            for (var ri = 0; ri < ranked.length; ri++) {
                var rc0 = ranked[ri];
                var rs0 = noneClear
                        ? self.idleScore(rc0, base, info)
                        : self.score(rc0.masks, rc0.moveFrames, rc0.resolved, info);
                if (!best || rs0 > best.score) best = { cand: rc0, score: rs0 };
            }
            rankSpare();
            return best;
        }
        function rankSpare() {
        if (!best && spare.length) {
            for (i = 0; i < spare.length; i++) {
                var sc = spare[i];
                var ss = noneClear
                       ? self.idleScore(sc, base, info)
                       : self.score(sc.masks, sc.moveFrames, sc.resolved, info);
                if (!best || ss > best.score) best = { cand: sc, score: ss };
            }
        }

        if (!best) {
            self.counts.allDead++;
            for (i = 0; i < allowed.length; i++) {
                var s2 = noneClear
                       ? self.idleScore(allowed[i], base, info)
                       : self.score(allowed[i].masks, allowed[i].moveFrames,
                                    allowed[i].resolved, info);
                if (!best || s2 > best.score) best = { cand: allowed[i], score: s2 };
            }
        }
        }

        var self = this;
        function settling(mv) {
            if (!mv) return false;
            var P = self.stack.panels, cc, rr;
            for (cc = mv[1]; cc <= mv[1] + 1; cc++) {
                for (rr = 1; rr < P.length; rr++) {
                    var q = P[rr] && P[rr][cc];
                    if (q && q.color !== 0 && !q.isGarbage &&
                        (q.state === 'hovering' || q.state === 'falling' || q.state === 'swapping')) return true;
                }
            }
            return false;
        }
        function waitFor(mv, via) {
            return { kind: 'hold', mode: mode, alive: alive, via: via, park: mv };
        }
        function slabOnScreen() {
            for (var gc0 = 1; gc0 <= W; gc0++) if (base.garb[gc0]) return true;
            return false;
        }
        function spendsReserve(r, after) {
            if (!r || !(r.total > 0) || r.brokeGarbage) return false;
            if (info.toppedOut && slabOnScreen()) return true;
            var sh = bitoptions.shapeOf(after);
            return !!sh && sh.mat < WORKING_ROWS;
        }
        function playable(mv) {
            if (!mv) return false;
            var pc0 = null;
            for (var q0 = 0; q0 < pool.length; q0++) {
                if (pool[q0].kind === 'swap' && pool[q0].swap[0] === mv[0] && pool[q0].swap[1] === mv[1]) { pc0 = pool[q0]; break; }
            }
            if (!pc0 || !pc0.masks) return false;
            if (returnsToSeen(mv)) return false;
            if (spendsReserve(pc0.resolved, pc0.masks)) return false;
            return !self.deadly(pc0.masks, pc0.resolved, info,
                                Math.max((pc0.moveFrames || 0) + self.reaction, info.framesPerRow || 0));
        }
        function playableSpending(mv) {
            if (!mv) return false;
            for (var q0 = 0; q0 < pool.length; q0++) {
                var pc0 = pool[q0];
                if (pc0.kind === 'swap' && pc0.swap[0] === mv[0] && pc0.swap[1] === mv[1]) {
                    return !!pc0.masks && !returnsToSeen(mv) && !spendsReserve(pc0.resolved, pc0.masks);
                }
            }
            return false;
        }
        function returnsToSeen(mv) {
            if (!self.refuseReturn || !mv) return false;
            for (var q = 0; q < pool.length; q++) {
                var pc = pool[q];
                if (pc.kind === 'swap' && pc.swap[0] === mv[0] &&
                    pc.swap[1] === mv[1] && pc.masks) {
                    var sg = signature(pc.masks);
                    return sg === here || self._seen.indexOf(sg) >= 0;
                }
            }
            return false;
        }

        if (!poolBreak && !info.toppedOut && !bitoptions.slabReadyFast(base)) {
            options = this._lastOptions = options || bitoptions.options(null, W, H, [info.cursorRow, info.cursorCol],
                                                   lookDepth, base, this.timing(info, deadline, base), digging);
            var ready = options.trigger;
            if (ready && ready.swaps.length && this.planInTime(ready.swaps, ready.duration, base, info, deadline)) {
                var rm0 = ready.swaps[0];
                if (playable(rm0)) {
                    this._wantRaise = false;
                    this.raiseFrames = 0;
                    this.counts.readiedFirst = (this.counts.readiedFirst || 0) + 1;
                    return { kind: 'swap', move: rm0, mode: mode, alive: alive, via: 'readyFirst' };
                }
            }
        }

        if (raising) {
            var rc = null;
            for (i = 0; i < pool.length; i++) if (pool[i].kind === 'raise') rc = pool[i];
            if (rc) {
                if (raising === 'opening') this.counts.openingRaises++;
                else this.counts.raisedForMaterial++;
                return { kind: 'raise', mode: mode, alive: alive, via: 'raise:' + raising };
            }
            this.counts.waitedToRaise++;
            return { kind: 'hold', mode: mode, alive: alive, via: 'raising' };
        }

        if (digging) {
            var haveBreak = false;
            for (i = 0; i < pool.length; i++) {
                if (pool[i].resolved && pool[i].resolved.brokeGarbage) { haveBreak = true; break; }
            }
            var stillComing = (info.incoming || 0) > 0 || !!info.fallingGarbage;
            var bk = null;
            for (i = 0; i < pool.length; i++) {
                var bc = pool[i];
                if ((bc.kind !== 'swap' && bc.kind !== 'hold') || !bc.resolved || !bc.resolved.brokeGarbage) continue;
                if ((bc.moveFrames || 0) > deadline) continue;
                if (this.deadly(bc.masks, bc.resolved, info,
                                Math.max((bc.moveFrames || 0) + this.reaction,
                                         info.framesPerRow || 0))) continue;
                var cv = bc.resolved.converts || 0, kv = bk ? (bk.resolved.converts || 0) : -1;
                var vv = bc.resolved.voidAfter || 0, kvv = bk ? (bk.resolved.voidAfter || 0) : 0;
                if (!bk || cv > kv || (cv === kv && (vv < kvv ||
                    (vv === kvv && (bc.moveFrames || 0) < (bk.moveFrames || 0))))) bk = bc;
            }
            if (bk && stillComing && !info.toppedOut) {
                this.counts.heldForLanding = (this.counts.heldForLanding || 0) + 1;
                return { kind: 'hold', mode: mode, alive: alive, via: 'awaitLanding', park: bk.swap };
            }
            if (bk) {
                this._dig = null;
                this._digIsBreak = false;
                this._plan = null;
                this.counts.brokeNow++;
                if (bk.kind === 'hold') return { kind: 'hold', mode: mode, alive: alive, via: 'break' };
                return { kind: 'swap', move: bk.swap, mode: mode, alive: alive,
                         via: 'break' };
            }
            if (haveBreak) { this._dig = null; this._digIsBreak = false; }
            if (rev && rev.best && rev.best.broke) {
                this.counts.revealSwaps++;
                if (!rev.best.swap) return { kind: 'hold', mode: mode, alive: alive, via: 'lineupHold' };
                return { kind: 'swap', move: rev.best.swap, mode: mode, alive: alive, reveal: true,
                         via: 'lineup' };
            }
            var digLeft = Infinity;
            if (this._dig && this._dig.moves.length) {
                var dspent0 = Math.max(0, this.stack.clock - (this._dig.startedAt || 0));
                digLeft = Math.max(0, (this._dig.frames || 0) - dspent0);
            }
            if (!haveBreak && !(this._dig && this._digIsBreak)) {
                options = this._lastOptions = options || bitoptions.options(null, W, H,
                    [info.cursorRow, info.cursorCol], lookDepth, base,
                    this.timing(info, deadline, base), digging);
                var reach = null, pile = options.now.concat(options.next);
                for (i = 0; i < pile.length; i++) {
                    var ro = pile[i];
                    if (!ro.breaks || !ro.swaps.length) continue;
                    if (!this.planInTime(ro.swaps, ro.duration, base, info, deadline)) continue;
                    var rc0 = ro.converts || 0, kc0 = reach ? (reach.converts || 0) : -1;
                    var rv0 = ro.voidAfter || 0, kv0 = reach ? (reach.voidAfter || 0) : 0;
                    if (!reach || rc0 > kc0 ||
                        (rc0 === kc0 && (rv0 < kv0 ||
                         (rv0 === kv0 && (ro.duration || 0) < (reach.duration || 0))))) reach = ro;
                }
                if (reach) {
                    var rm = reach.swaps[0];
                    if (playable(rm) &&
                        (digLeft === Infinity || mode.name === 'DEFEND')) {
                        this._plan = null;
                        this._dig = reach.swaps.length > 1
                                  ? { moves: reach.swaps.slice(1), frames: reach.duration || 0,
                                      startedAt: this.stack.clock }
                                  : null;
                        this._digIsBreak = !!this._dig;
                        this.counts.brokeReached = (this.counts.brokeReached || 0) + 1;
                        if (digLeft !== Infinity) {
                            this.counts.brokePreempt = (this.counts.brokePreempt || 0) + 1;
                        }
                        return { kind: 'swap', move: rm, mode: mode, alive: alive,
                                 via: 'breakReach' };
                    }
                }
                if (!reach && info.toppedOut && (info.health || 0) > 1 && digLeft === Infinity) {
                    var tm2 = this.timing(info, deadline, base);
                    tm2.spend = info.health - 1;
                    var last = bitoptions.options(null, W, H, [info.cursorRow, info.cursorCol], lookDepth, base, tm2, digging);
                    var pile2 = last.now.concat(last.next), lr = null, lrSpend = Infinity;
                    for (i = 0; i < pile2.length; i++) {
                        var lo = pile2[i];
                        if (!lo.breaks || !lo.swaps.length) continue;
                        var sp = this.planSpend(lo.swaps, base, info);
                        if (sp < lrSpend || (sp === lrSpend && (lo.converts || 0) > (lr.converts || 0))) { lr = lo; lrSpend = sp; }
                    }
                    if (lr && lrSpend < info.health && playableSpending(lr.swaps[0])) {
                        this._plan = null;
                        this._dig = lr.swaps.length > 1
                                  ? { moves: lr.swaps.slice(1), frames: lr.duration || 0, startedAt: this.stack.clock, spend: true }
                                  : null;
                        this._digIsBreak = !!this._dig;
                        this.counts.brokeSpending = (this.counts.brokeSpending || 0) + 1;
                        return { kind: 'swap', move: lr.swaps[0], mode: mode, alive: alive, via: 'breakSpend', spends: true };
                    }
                }
            }
            if (!haveBreak && this._dig && this._dig.moves.length) {
                var dn = this._dig.moves[0], dnOk = this._dig.spend ? playableSpending(dn) : playable(dn);
                var dspent = Math.max(0, this.stack.clock - (this._dig.startedAt || 0));
                var digOk = this._dig.spend ? this.planSpend(this._dig.moves, base, info) < (info.health || 0)
                                            : this.planInTime(this._dig.moves, Math.max(0, this._dig.frames - dspent), base, info, deadline);
                if (dnOk && digOk) {
                    var digSpends = !!this._dig.spend;
                    this._dig.moves = this._dig.moves.slice(1);
                    if (!this._dig.moves.length) { this._dig = null; this._digIsBreak = false; }
                    this._plan = null;
                    this.counts.dugFor++;
                    return { kind: 'swap', move: dn, mode: mode, alive: alive, via: 'digPlan', spends: digSpends };
                }
                if (!dnOk && settling(dn) && digOk) {
                    return waitFor(dn, 'digWait');
                }
                this._dig = null;
                this._digIsBreak = false;
                this.counts.digDropped++;
            }
            if (!haveBreak) {
                options = this._lastOptions = options || bitoptions.options(null, W, H, [info.cursorRow, info.cursorCol],
                                                       lookDepth, base, this.timing(info, deadline, base), digging);
                var dp = options.save;
                if (dp && dp.swaps.length && this.planInTime(dp.swaps, dp.duration, base, info, deadline)) {
                    var dm = dp.swaps[0];
                    if (playable(dm)) {
                        this._digIsBreak = false;
                        this._dig = { moves: dp.swaps.slice(1), frames: dp.duration || 0,
                                      startedAt: this.stack.clock };
                        if (!this._dig.moves.length) { this._dig = null; this._digIsBreak = false; }
                        this.counts.dugFor++;
                        return { kind: 'swap', move: dm, mode: mode, alive: alive, via: 'digPlan' };
                    }
                }
            }
        }

        if (!survival) {
            if (this._attack && this._attack.moves.length) {
                var an = this._attack.moves[0];
                var aspent = Math.max(0, this.stack.clock - (this._attack.startedAt || 0));
                var aFits = this.planInTime(this._attack.moves, Math.max(0, (this._attack.frames || 0) - aspent),
                                            base, info, deadline);
                var okNext = aFits && playable(an);
                if (!okNext && aFits && settling(an)) return waitFor(an, 'attackWait');
                if (okNext) {
                    this._attack.moves = this._attack.moves.slice(1);
                    if (!this._attack.moves.length) this._attack = null;
                    this.counts.attacked++;
                    return { kind: 'swap', move: an, mode: mode, alive: alive, via: 'attackPlan' };
                }
                this._attack = null;
                this.counts.attackDropped++;
            }
            options = this._lastOptions = options || bitoptions.options(null, W, H, [info.cursorRow, info.cursorCol], lookDepth, base,
                                                   this.timing(info, deadline, base), digging);
            var atk = bestAttack(options, this.weights, PanelEngine(), deadline,
                                 this.stack.frames, (info.framesPerRow || 0) / W);
            if (atk && atk.move && !playable(atk.move)) {
                atk = null;
                this._attack = null;
                this.counts.refusedReturn++;
            }
            if (atk && atk.move) {
                this._attack = { moves: atk.option.swaps.slice(1), frames: atk.option.duration || 0,
                                 startedAt: this.stack.clock };
                if (!this._attack.moves.length) this._attack = null;
                this.counts.attacked++;
                this.counts.cellsPlanned += atk.cells;
                return { kind: 'swap', move: atk.move, mode: mode, alive: alive, via: 'bestAttack' };
            }
        }

        if (planWait) return waitFor(planWait, 'planWait');
        if (survival && survival.move) {
            if (!playable(survival.move)) {
                this._plan = null;
                this.counts.refusedReturn++;
                survival = null;
            } else {
                this.counts.planned++;
                return { kind: 'swap', move: survival.move, mode: mode, alive: alive, via: 'survivalPlan' };
            }
        }

        var shapeTime = noneClear || (info.stopTime || 0) > 0 || this.towering(base);
        if (shapeTime && (!this._flatten || !this._flatten.moves.length)) {
            options = this._lastOptions = options || bitoptions.options(null, W, H, [info.cursorRow, info.cursorCol],
                                                    lookDepth, base, this.timing(info, deadline, base), digging);
        }
        var shapeBudget = (info.stopTime || 0) > 0
                        ? Math.min(info.stopTime, deadline) : deadline;
        var landsOk = true;
        if (options && options.flatten && options.flatten.lands && digging) {
            landsOk = !!this.hasFireable(options.flatten.lands, info,
                                         endsAt(options.flatten.swaps, info));
            if (!landsOk) this.counts.flattenBlind++;
        }
        if (shapeTime && landsOk && options && options.flatten && options.flatten.swaps.length &&
            (options.flatten.duration || 0) <= shapeBudget) {
            if (!this._flatten || !this._flatten.moves.length) {
                this._flatten = { moves: options.flatten.swaps.slice(),
                                  frames: options.flatten.duration,
                                  startedAt: this.stack.clock,
                                  blind: !digging };
            }
        }
        if (digging && this._flatten && this._flatten.blind) {
            this._flatten = null;
            this.counts.flattenBlind++;
        }
        if (shapeTime && this._flatten && this._flatten.moves.length) {
            var fm = this._flatten.moves[0], fok = playable(fm);
            var fspent = Math.max(0, this.stack.clock - (this._flatten.startedAt || 0));
            var fFits = this.planInTime(this._flatten.moves, Math.max(0, (this._flatten.frames || 0) - fspent),
                                        base, info, deadline);
            if (!fok && fFits && settling(fm)) return waitFor(fm, 'flattenWait');
            fok = fok && fFits;
            if (fok) {
                this._flatten.moves = this._flatten.moves.slice(1);
                if (!this._flatten.moves.length) this._flatten = null;
                this.counts.flattened++;
                return { kind: 'swap', move: fm, mode: mode, alive: alive, via: 'flatten' };
            }
            this._flatten = null;
            this.counts.flattenDropped++;
        }

        if (rev && rev.best && rev.best.swap && !rev.best.broke && (rev.best.total || 0) > 0) {
            var rsh = bitoptions.shapeOf(base);
            if ((info.toppedOut && slabOnScreen()) || (rsh && rsh.mat - rev.best.total / W < WORKING_ROWS)) rev = null;
        }
        if (rev && rev.best && rev.best.swap) {
            this.counts.revealSwaps++;
            return { kind: 'swap', move: rev.best.swap, mode: mode, alive: alive, reveal: true, via: 'lineup' };
        }
        bestOf();
        if (!best) return { kind: 'hold', mode: mode, alive: alive, via: 'noBest' };
        return { kind: best.cand.kind, move: best.cand.swap, mode: mode, alive: alive, via: (noneClear ? 'setup' : 'WEIGHTS') };
    };

    BitBot.prototype.idleScore = function (cand, base, info) {
        var m = cand.masks;
        if (!m) return -(cand.moveFrames || 0);
        var fpr = info.framesPerRow || 0, perPanel = fpr / W;
        var was = bitoptions.shapeOf(base), now = bitoptions.shapeOf(m);
        var s = ((was ? was.high : 0) - (now ? now.high : 0)) * fpr;
        if (bitoptions.slabReadyFast(m)) s += fpr;
        if (this._incomingRow) {
            var up = bit.risenMasks(m, this._incomingRow);
            if (up && bitoptions.slabReadyFast(up)) s += fpr;
        }
        s += matchWays(m) * perPanel;
        s -= bumpiness(m) * perPanel;
        s -= Math.max(0, WORKING_ROWS - (now ? now.mat : 0)) * fpr;
        var left = framesToDeath(info, tallestBoard(m), fpr);
        var affordable = Math.floor(left / Math.max(1, this.reaction));
        var gapNow = now ? (now.slabRowGap || 0) : 0;
        if (gapNow <= affordable) s -= gapNow * perPanel;
        return s - (cand.moveFrames || 0);
    };

    BitBot.prototype.towering = function (base) {
        var shp = base && bitoptions.shapeOf(base);
        return !!shp && (shp.spread || 0) >= WORKING_ROWS;
    };

    BitBot.prototype.hasFireable = function (masks, info, at) {
        if (bit.anyOneSwapClear(masks)) return true;
        if (!info || !at) {
            throw new Error('hasFireable: needs the engine state and the cursor -- ' +
                            'whether a board can fire is a question about time, and ' +
                            'the one-swap answer on its own is the rule this replaced');
        }
        return this.saveAfter(masks, at[0], at[1], info, true) >= 1;
    };

    BitBot.prototype.withSlab = function (masks) {
        var t = tallestBoard(masks);
        if (t >= H) return null;
        var st = bit.copyState(masks), b = 1 << t, sm = new Int32Array(W + 2), c;
        for (c = 1; c <= W; c++) { st.occ[c] |= b; st.inert[c] |= b; st.garb[c] |= b; sm[c] = b; }
        st.slabs.push(sm);
        st.slabLocked.push(false);
        return st;
    };

    BitBot.prototype.slabToAnswer = function (masks) {
        masks = this.restingBoard(masks);
        for (var c = 1; c <= W; c++) if (masks.garb[c]) return masks;
        return this.withSlab(masks) || masks;
    };

    BitBot.prototype.restingBoard = function (masks) {
        if (!this.inFlight()) return masks;
        var r = bit.resolveFromMasks(bit.copyState(masks), true);
        return (r && r.settled) || masks;
    };

    BitBot.prototype.drainBound = function () {
        var s = this.stack, pre = s.preStopTime || 0, stop = s.stopTime || 0;
        var k = stop > 0 ? pre + stop : 1;
        k = Math.max(k, s.shakeTime || 0);
        var air = 0, active = (s.nActive || 0) > 0 || (s.nPrevActive || 0) > 0;
        for (var r = 1; r <= s.height; r++) {
            for (var c = 1; c <= W; c++) {
                var p = s.panels[r][c];
                if (p.color === 0) continue;
                var busy = p.isGarbage ? p.state !== 'normal' : (p.state !== 'normal' && p.state !== 'landing');
                if (!busy) continue;
                active = true;
                if ((p.timer || 0) > air) air = p.timer || 0;
            }
        }
        if (active) k = Math.max(k, 1 + Math.max(1, air));
        return k;
    };

    var SWAP_RUNS = 4;
    BitBot.prototype.planSpend = function (swaps, base, info) {
        var memo = base._fits || (base._fits = new Map());
        var st = base, at = [info.cursorRow, info.cursorCol];
        var t = 0, lock = Math.max(0, (info.drainRun || 1) - 1), spend = 0, eng = PanelEngine(), key = '';
        for (var i = 0; i < swaps.length; i++) {
            key += swaps[i][0] + ',' + swaps[i][1] + ';';
            var hit = memo.get(key);
            if (hit === undefined) {
                var t2 = t + travel.cost(at[0], at[1], swaps[i][0], swaps[i][1]) + (i ? 1 : 0);
                var paid = spend + Math.max(0, t2 - lock), from = Math.max(lock, t2);
                var s2 = bit.copyState(st);
                if (!bit.swapMasks(s2, swaps[i][0], swaps[i][1])) hit = Infinity;
                else {
                    var r = bit.resolveFromMasks(s2, true);
                    if (r.scope === 'garbage-broke') hit = paid;
                    else if (r.scope !== 'ok' || !r.settled) hit = Infinity;
                    else hit = { st: r.settled, t: t2, spend: paid,
                                 lock: Math.max(from, t2 + SWAP_RUNS,
                                                r.total > 0 ? t2 + 5 + BF.resolveFramesOf(eng, r.total, 0) : 0) };
                }
                memo.set(key, hit);
            }
            if (typeof hit === 'number') return hit;
            st = hit.st; t = hit.t; lock = hit.lock; spend = hit.spend;
            at = swaps[i];
        }
        return spend;
    };
    BitBot.prototype.planFits = function (swaps, base, info) { return this.planSpend(swaps, base, info) === 0; };

    BitBot.prototype.planInTime = function (swaps, duration, base, info, deadline) {
        return info.toppedOut ? this.planFits(swaps, base, info) : (duration || 0) <= deadline;
    };

    BitBot.prototype.raiseRoom = function () {
        var stack = this.stack, top = stack.height, r, c, p;
        for (r = top; r >= 1; r--) {
            for (c = 1; c <= W; c++) {
                p = stack.panels[r][c];
                if (p.isGarbage ? p.state !== 'falling' : p.color !== 0) return top - r;
            }
        }
        return top;
    };

    BitBot.prototype.raiseFits = function (rows) {
        return this.raiseRoom() > 1 + (rows || 0);
    };

    BitBot.prototype.raiseMode = function (info, base, poolBreak) {
        if (!this.allowRaise || info.toppedOut) { this._opening = false; return null; }
        if (info.fallingGarbage) return null;
        var rows = Math.ceil((info.nextSlab || 0) / W);
        var reserve = Math.max(rows, this._maxSlab || 0);
        var fits = this.raiseFits(reserve);
        this._wantRows = rows;
        if (this._opening && (info.incoming || !fits)) this._opening = false;
        if (!fits) return null;
        var stillComing = (info.incoming || 0) > 0 || !!info.fallingGarbage;
        if (poolBreak && !stillComing) return null;
        return this._opening ? 'opening' : 'material';
    };

    BitBot.prototype.saveAfter = function (masks, row, col, info, deep) {
        var deadline = framesToDeath(info, tallestBoard(masks), info.framesPerRow);
        var frozen = (info.stopTime || 0) > 0 || !!info.toppedOut;
        var step = travel.MOVE_FRAMES + (frozen ? 0 : this.reaction);
        masks = this.slabToAnswer(masks);
        var sw = bit.legalSwapsOf(masks), i, j, r, best = 0, setups = [];
        for (i = 0; i < sw.length; i++) {
            var walk = travel.cost(row, col, sw[i][0], sw[i][1]) + step;
            if (walk > deadline) continue;
            if (!bit.swapMasks(masks, sw[i][0], sw[i][1])) continue;
            var want = deep && !best;
            r = bit.resolveFromMasks(masks, want);
            bit.swapMasks(masks, sw[i][0], sw[i][1]);
            if (r.scope === 'garbage-broke') return 2;
            if (r.total > 0) { best = 1; continue; }
            if (want && r.settled) setups.push({ st: r.settled, at: sw[i], spent: walk });
        }
        if (best) return best;
        if (!deep) return best;
        setups.sort(function (a, b) { return a.spent - b.spent; });
        for (i = 0; i < setups.length && i < 6; i++) {
            var st2 = setups[i].st, from = setups[i].at, left = deadline - setups[i].spent;
            if (left <= 0) continue;
            var sw2 = bit.legalSwapsOf(st2);
            for (j = 0; j < sw2.length; j++) {
                if (travel.cost(from[0], from[1], sw2[j][0], sw2[j][1]) + step > left) continue;
                if (!bit.swapMasks(st2, sw2[j][0], sw2[j][1])) continue;
                r = bit.resolveFromMasks(st2, false);
                bit.swapMasks(st2, sw2[j][0], sw2[j][1]);
                if (r.scope === 'garbage-broke') return 2;
                if (r.total > 0) best = 1;
            }
            if (best) return best;
        }
        return best;
    };

    BitBot.prototype.refuses = function (cand, info, base, survivalNeeded, breakAvailable) {
        if (!cand || cand.kind !== 'swap' || !cand.resolved) return null;
        if (survivalNeeded) return null;
        if (this.refusePayless && tierOf(cand) === 4) return 'payless';
        if (cand.resolved.total > 0 && !cand.resolved.brokeGarbage &&
            materialRows(base) < WORKING_ROWS && breakAvailable) return 'starving';
        return null;
    };

    BitBot.prototype.decide = function () {
        var d = this._decideGated();
        this._lastSwap = (d && d.kind === 'swap' && d.move) ? [d.move[0], d.move[1]] : null;
        if (this._lastSwap) {
            var depth = 2;
            this._recentSwaps = [this._lastSwap].concat(this._recentSwaps || []);
            if (this._recentSwaps.length > depth) this._recentSwaps.length = depth;
        }
        return d;
    };

    BitBot.prototype._decideGated = function () {
        return this._onePlan(this._waitForDrain(this._decideRuled()));
    };

    var PLAN_OF = { digPlan: '_dig', breakReach: '_dig', breakSpend: '_dig', attackPlan: '_attack', bestAttack: '_attack',
                    survivalPlan: '_plan', flatten: '_flatten' };
    BitBot.prototype._onePlan = function (d) {
        if (!d || d.kind !== 'swap') return d;
        var keep = PLAN_OF[d.via] || null;
        if (keep !== '_dig') { this._dig = null; this._digIsBreak = false; }
        if (keep !== '_attack') this._attack = null;
        if (keep !== '_plan') this._plan = null;
        if (keep !== '_flatten') this._flatten = null;
        return d;
    };

    var ENDS_IN_A_BREAK = { digPlan: 1, breakReach: 1, 'break': 1, lineup: 1, lineupHold: 1 };
    var SWAP_FRAMES = 4;
    BitBot.prototype._waitForDrain = function (d) {
        var info = this._lastInfo, pool = this._lastPool, base = this._lastBase;
        if (!d || !info || !pool || !base || !info.toppedOut) return d;
        var i;
        var clears = [], picked = null;
        for (i = 0; i < pool.length; i++) {
            var pc = pool[i];
            if (pc.kind !== 'swap' || !pc.resolved) continue;
            if (d.kind === 'swap' && d.move && pc.swap[0] === d.move[0] && pc.swap[1] === d.move[1]) picked = pc;
            if (pc.resolved.total > 0 || pc.resolved.brokeGarbage) clears.push(pc);
        }
        if (!clears.length) {
            var settled = bit.resolveFromMasks(base, true).settled;
            if (settled) {
                var sws = bit.legalSwapsOf(settled);
                for (i = 0; i < sws.length; i++) {
                    if (!bit.swapMasks(settled, sws[i][0], sws[i][1])) continue;
                    var rs = bit.resolveFromMasks(settled, false);
                    bit.swapMasks(settled, sws[i][0], sws[i][1]);
                    if (!(rs.total > 0 || rs.scope === 'garbage-broke')) continue;
                    clears.push({ kind: 'swap', swap: sws[i], future: true,
                                  moveFrames: travel.cost(info.cursorRow, info.cursorCol, sws[i][0], sws[i][1]),
                                  resolved: summarise(rs) });
                }
            }
        }
        if (!clears.length) return d;
        if (d.spends) return d;
        var k = this.drainBound(), pr = picked && picked.resolved;
        if (pr && pr.brokeGarbage && (picked.moveFrames || 0) + 1 <= k) return d;
        if (!picked && ENDS_IN_A_BREAK[d.via]) return d;
        function hold(at) { return { kind: 'hold', mode: d.mode, alive: d.alive, via: 'awaitDrain', park: at }; }
        if (pr && pr.total > 0 && !pr.brokeGarbage && (picked.moveFrames || 0) + 1 <= k) {
            if ((picked.moveFrames || 0) + 2 > k) return d;
            this.counts.waitedForDrain = (this.counts.waitedForDrain || 0) + 1;
            return hold(picked.swap);
        }
        var nearest = Infinity;
        for (i = 0; i < clears.length; i++) nearest = Math.min(nearest, clears[i].moveFrames || 0);
        if (picked) {
            var back = Infinity;
            if (picked.masks) {
                var after = bit.copyState(picked.masks), sw2 = bit.legalSwapsOf(after);
                for (i = 0; i < sw2.length; i++) {
                    var cst = travel.cost(picked.swap[0], picked.swap[1], sw2[i][0], sw2[i][1]);
                    if (cst >= back || !bit.swapMasks(after, sw2[i][0], sw2[i][1])) continue;
                    var ra = bit.resolveFromMasks(after, false);
                    bit.swapMasks(after, sw2[i][0], sw2[i][1]);
                    if (ra.total > 0 || ra.scope === 'garbage-broke') back = cst;
                }
            }
            if ((picked.moveFrames || 0) + SWAP_FRAMES + back + 1 <= k) return d;
        } else if (nearest + 2 <= k) {
            return d;
        }
        this.counts.keptHealth = (this.counts.keptHealth || 0) + 1;
        var breakNow = null, clearNow = null, f = this.stack.frames, eng = PanelEngine();
        for (i = 0; i < clears.length; i++) {
            var cl = clears[i], r = cl.resolved;
            if ((cl.moveFrames || 0) + 1 > k) continue;
            if (r.brokeGarbage) {
                if (!breakNow || (r.converts || 0) > (breakNow.resolved.converts || 0) ||
                    ((r.converts || 0) === (breakNow.resolved.converts || 0) &&
                     (cl.moveFrames || 0) < (breakNow.moveFrames || 0))) breakNow = cl;
                continue;
            }
            var isCh = r.chain >= 2;
            var rate = (f.FLASH + f.FACE + f.POP * r.total +
                        BF.stopTimeOf(eng, isCh, isCh ? 0 : r.total, isCh ? r.chain : 0, true)) / r.total;
            var shc = cl.masks ? bitoptions.shapeOf(cl.masks) : null;
            var vd = shc ? shc.high - shc.mat : 0;
            var tn = r.total || 0;
            if (!clearNow || tn < clearNow.tn || (tn === clearNow.tn && (vd < clearNow.vd ||
                (vd === clearNow.vd && rate > clearNow.rate)))) clearNow = { cand: cl, rate: rate, vd: vd, tn: tn };
        }
        if (breakNow && !breakNow.future) return { kind: 'swap', move: breakNow.swap, mode: d.mode, alive: d.alive, via: 'break' };
        if (breakNow) return hold(breakNow.swap);
        var esc = clearNow ? clearNow.cand : null;
        if (!esc) {
            for (i = 0; i < clears.length; i++) if (!esc || (clears[i].moveFrames || 0) < (esc.moveFrames || 0)) esc = clears[i];
        }
        if (esc.future || (esc.moveFrames || 0) + 2 <= k) return hold(esc.swap);
        return { kind: 'swap', move: esc.swap, mode: d.mode, alive: d.alive, via: 'keepHealth' };
    };

    BitBot.prototype._decideRuled = function () {
        var d = this._decide();
        var info = this._lastInfo, pool = this._lastPool, base = this._lastBase;
        if (!d || d.kind !== 'swap' || !d.move || !info || !pool || !base) return d;
        var i;
        var ARITHMETIC = { survivalPlan: 1, planSave: 1, digPlan: 1, 'break': 1, keepSave: 1 };

        var picked = null;
        for (i = 0; i < pool.length; i++) {
            var pk = pool[i];
            if (pk.kind === 'swap' && pk.swap[0] === d.move[0] &&
                pk.swap[1] === d.move[1] && pk.masks) { picked = pk; break; }
        }
        if (picked && !ARITHMETIC[d.via] &&
            this.refuses(picked, info, base, this._lastSurvivalNeeded, this._lastBreakOnPool)) {
            var sub = null;
            for (i = 0; i < pool.length; i++) {
                var sc0 = pool[i];
                if (sc0 === picked || sc0.kind !== 'swap' || !sc0.masks) continue;
                if (this.refuses(sc0, info, base, this._lastSurvivalNeeded, this._lastBreakOnPool)) continue;
                if ((sc0.moveFrames || 0) > this._lastDeadline) continue;
                if (this.deadly(sc0.masks, sc0.resolved, info,
                                Math.max((sc0.moveFrames || 0) + this.reaction,
                                         info.framesPerRow || 0))) continue;
                var sv0 = this.score(sc0.masks, sc0.moveFrames, sc0.resolved, info);
                if (!sub || sv0 > sub.score) sub = { cand: sc0, score: sv0 };
            }
            if (sub) {
                this.counts.refusedAtExit++;
                d = { kind: 'swap', move: sub.cand.swap, mode: d.mode,
                      alive: d.alive, via: 'ruled' };
            }
        }

        if (!this.saveAfter(base, info.cursorRow, info.cursorCol, info, true)) {
            if (ARITHMETIC[d.via]) return d;
            var route = null;
            if (this._lastOptions) {
                if (this._lastOptions.save && this._lastOptions.save.swaps.length) {
                    route = this._lastOptions.save;
                } else if (this._lastOptions.ready && this._lastOptions.ready.swaps.length) {
                    route = this._lastOptions.ready;
                }
            }
            if (route) {
                var sp0 = route, sm0 = sp0.swaps[0];
                var lg0 = bit.legalSwapsOf(base), ok0 = false;
                for (i = 0; i < lg0.length; i++) {
                    if (lg0[i][0] === sm0[0] && lg0[i][1] === sm0[1]) { ok0 = true; break; }
                }
                if (ok0 && (sp0.duration || 0) <= this._lastDeadline) {
                    this.counts.savePlanned++;
                    return { kind: 'swap', move: sm0, mode: d.mode, alive: d.alive,
                             via: 'planSave' };
                }
            }
            return d;
        }
        if (d.via === 'survivalPlan') return d;

        var chosen = null;
        for (i = 0; i < pool.length; i++) {
            var pc = pool[i];
            if (pc.kind === 'swap' && pc.swap[0] === d.move[0] &&
                pc.swap[1] === d.move[1] && pc.masks) { chosen = pc; break; }
        }
        if (!chosen) return d;
        if (chosen.resolved && chosen.resolved.brokeGarbage) {
            if (materialRows(base) < 6) return d;
            if (this.saveAfter(chosen.masks, chosen.swap[0], chosen.swap[1], info, true)) return d;
            this.counts.heldTheBreak++;
        } else if (this.saveAfter(chosen.masks, chosen.swap[0], chosen.swap[1], info, true)) {
            return d;
        }
        var keep = null;
        for (i = 0; i < pool.length; i++) {
            var alt = pool[i];
            if (alt === chosen || alt.kind !== 'swap' || !alt.masks) continue;
            if (this.deadly(alt.masks, alt.resolved, info,
                            Math.max((alt.moveFrames || 0) + this.reaction,
                                     info.framesPerRow || 0))) continue;
            var q = this.saveAfter(alt.masks, alt.swap[0], alt.swap[1], info);
            if (!q) continue;
            var sc = this.score(alt.masks, alt.moveFrames, alt.resolved, info);
            if (!keep || q > keep.q || (q === keep.q && sc > keep.score)) {
                keep = { cand: alt, score: sc, q: q };
            }
        }
        if (!keep) { this.counts.saveUnkeepable++; return d; }
        this.counts.saveKept++;
        return { kind: 'swap', move: keep.cand.swap, mode: d.mode,
                 alive: d.alive, via: 'keepSave' };
    };

    BitBot.prototype.swapLanding = function () {
        var s = this.stack;
        return (s.queuedSwapRow || 0) > 0 || (s.swappingCount || 0) > 0;
    };

    BitBot.prototype.update = function () {
        var stack = this.stack;
        if (stack.gameOver) { this.spend.gameOver++; return; }
        var froz = (stack.stopTime || 0) > 0;
        var input = {};

        if (this._wantRaise && !this.raiseFits(this._wantRows)) {
            this._wantRaise = false;
            this.raiseFrames = 0;
        }
        if (this._wantRaise && this.raiseFrames === 0 &&
            !stack.preventManualRaise && !stack.manualRaise &&
            !(typeof stack.hasFallingGarbage === 'function' && stack.hasFallingGarbage())) {
            this.raiseFrames = 20;
            this._raiseStarted = false;
        }
        if (this.raiseFrames > 0) {
            if (stack.manualRaise) this._raiseStarted = true;
            if (stack.preventManualRaise || (this._raiseStarted && !stack.manualRaise)) this.raiseFrames = 0;
            else { this.raiseFrames--; input.raise = true; }
        }

        if (this._walk) {
            this.spend.walking++; if (froz) this.frozen.walking++;
            this._driveWalk(input); stack.setInput(input); return;
        }
        if (this._park) this._parkStep(input);
        stack.setInput(input);
        var urgent = (stack.stopTime || 0) > 0 ||
                     (typeof stack.isToppedOut === 'function' && stack.isToppedOut());
        if (this.cooldown > 0) {
            var lift = (urgent || (this.reveal && this.windowOpen())) && !this.swapLanding();
            if (lift && stack.isToppedOut() && !(this.reveal && this.windowOpen()) &&
                this._boardKey() === this._decidedOn && this.drainBound() > this._escapeWalk + 2) lift = false;
            if (!lift) {
                this.spend.cooling++; if (froz) this.frozen.cooling++;
                this.cooldown--; return;
            }
            this.cooldown = 0;
        }

        this.spend.decided++;
        this._decidedOn = this._boardKey();
        var d = this.decide();
        this._escapeWalk = Infinity;
        var ep = this._lastPool || [];
        for (var ei = 0; ei < ep.length; ei++) {
            var er = ep[ei].resolved;
            if (ep[ei].kind === 'swap' && er && (er.total > 0 || er.brokeGarbage)) {
                this._escapeWalk = Math.min(this._escapeWalk, ep[ei].moveFrames || 0);
            }
        }
        if (d.kind === 'raise') {
            if (froz) this.frozen.raise++;
            this.counts.raises++;
            this.raiseFrames = 20;
            this._raiseStarted = false;
            this.cooldown = this.reaction;
            return;
        }
        if (d.kind === 'hold' || !d.move) {
            if (froz) this.frozen.hold++;
            this.counts.holds++;
            this.cooldown = this.reaction;
            var pk0 = this._park;
            if (d.park && pk0 && pk0.target && pk0.target[0] === d.park[0] && pk0.target[1] === d.park[1]) return;
            this._park = d.park ? { row: d.park[0], col: d.park[1], timer: 0, target: [d.park[0], d.park[1]],
                                    disp: stack.displacement } : null;
            return;
        }
        this._park = null;
        this.counts.swaps++;
        if (froz) this.frozen.swap++;
        this._beginWalk(d.move[0], d.move[1], this.reaction);
        this._driveWalk(input);
        stack.setInput(input);
    };

    BitBot.prototype._parkStep = function (input) {
        var stack = this.stack, pk = this._park;
        if (stack.displacement > pk.disp) pk.row++;
        pk.disp = stack.displacement;
        var row = Math.max(1, Math.min(pk.row, stack.topCurRow));
        var col = Math.max(1, Math.min(pk.col, W - 1));
        if (stack.curRow === row && stack.curCol === col) return;
        if (pk.timer > 0) { pk.timer--; return; }
        if (stack.curCol < col) input.right = true;
        else if (stack.curCol > col) input.left = true;
        else if (stack.curRow < row) input.up = true;
        else input.down = true;
        pk.timer = this.cursorMoveFrames - 1;
    };

    BitBot.prototype._boardKey = function () {
        var s = this.stack, out = '', r, c, p, top = Math.min(s.panels.length - 1, s.height + 2);
        for (r = 1; r <= top; r++) {
            for (c = 1; c <= W; c++) {
                p = s.panels[r][c];
                out += p.color + (p.isGarbage ? 'g' : '') + (p.state ? p.state.charAt(0) : '') + ',';
            }
        }
        return out + (s.incoming && s.incoming.length ? 'q' : '');
    };

    BitBot.tallestOfMasks = tallestBoard;
    BitBot.signatureOf = signature;
    BitBot.bestAttackOf = bestAttack;
    BitBot.bestPlanOf = bestPlan;
    BitBot.ruinsShapeOf = ruinsShape;
    BitBot.framesToRiseOf = framesToRise;
    BitBot.framesToDeathOf = framesToDeath;
    BitBot.WORKING_ROWS = WORKING_ROWS;
    BitBot.STARTER = STARTER;
    return BitBot;
}));
