(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        var path = require('path');
        require(path.join(__dirname, '..', '..', 'panel-engine.js'));
        require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
        module.exports = factory(require('./bitmatch.js'), require('./bitfeatures.js'),
                                 require('./bitlineup.js'), require('./travel.js'),
                                 require('./bitnative.js'), require('./bitoptions.js'));
    } else {
        root.BitBot = factory(root.BitMatch, root.BitFeatures, root.BitLineup,
                              root.PanelEval.travel, root.BitNative, root.BitOptions);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (bit, BF, lineup, travel, native, bitoptions) {
    'use strict';

    var W = 6, H = 12, WORKING_ROWS = 4;

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

    var IN = { TOPPED: 0, STOP: 1, INCOMING: 2, NEXTSLAB: 3, FALLING: 4, CROW: 5, CCOL: 6, HEALTH: 7, DRAIN: 8,
               FPR: 9, FTNR: 10, SPEED: 11, NEXTUP: 12, STARTSPEED: 13, CLOCK: 14, STACKCLOCK: 15, HASRISEN: 16,
               RAISEROOM: 17, INFLIGHT: 18, DRAINBOUND: 19, STACKTOPPED: 20, MOVING: 21, HASTIMED: 22,
               REVEALOPEN: 23, CONVN: 24, CONVTIMER: 25, BCROW: 26, BCCOL: 27, NLEGAL: 28, HASINROW: 29,
               INROW: 30, HASLAST: 37, LASTR: 38, LASTC: 39, SETTLING: 40, SF: 50, CONV: 60, LEGAL: 300, T: 560, SIZE: 600 };
    var T = { RISE: 0, COMBO: 100, STOP: 200, LF: 210, W: 220, OPT: 250, SIZE: 270 };
    var KINDS = ['hold', 'raise', 'swap'], MODES = ['BUILD', 'DEFEND', 'ATTACK'];
    var VIAS = [null, 'raise:opening', 'raise:material', 'raising', 'readyFirst', 'awaitLanding', 'break',
                'lineupHold', 'lineup', 'breakReach', 'breakSpend', 'digPlan', 'digWait', 'attackWait', 'attackPlan',
                'bestAttack', 'planWait', 'survivalPlan', 'flattenWait', 'flatten', 'noBest', 'setup', 'WEIGHTS',
                'ruled', 'planSave', 'keepSave', 'awaitDrain', 'keepHealth'];
    var COUNTS = ['refusedDeadly', 'allDead', 'refusedReturn', 'refusedTooSlow', 'planned', 'planDropped', 'attacked',
                  'attackDropped', 'cellsPlanned', 'refusedPayless', 'refusedStarving', 'refusedOther', 'refusedAtExit',
                  'raisedForMaterial', 'waitedToRaise', 'dugFor', 'digDropped', 'brokeNow', 'flattenBlind',
                  'openingRaises', 'saveKept', 'saveUnkeepable', 'savePlanned', 'heldTheBreak', 'forcedBreak',
                  'forcedBoth', 'refusedEarly', 'revealSwaps', 'revealWindows', 'digging', 'flattened',
                  'flattenDropped', 'refusedStranded', 'refusedNoFailsafe', 'refusedSameSwap', 'readiedFirst',
                  'heldForLanding', 'brokeReached', 'brokePreempt', 'brokeSpending', 'waitedForDrain', 'keptHealth'];
    var C_DECISIONS = COUNTS.length, C_BYMODE = C_DECISIONS + 1;

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

    function tallestBoard(st) {
        if (!st) return H;
        var t = 0;
        for (var c = 1; c <= W; c++) {
            var o = st.occ[c];
            if (!o) continue;
            var top = 32 - Math.clz32(o >>> 0);
            if (top > t) t = top;
        }
        return t;
    }

    function signature(st) {
        var out = [], a, c, stride = st.W + 2;
        for (c = 1; c <= st.W; c++) out.push(st.occ[c] + ':' + st.garb[c]);
        for (a = 1; a <= st.N; a++) for (c = 1; c <= st.W; c++) out.push(st.colour[a * stride + c]);
        return out.join(',');
    }

    function putInfo(info, s) {
        var bi = native.botIn(), d = bi.d, b = bi.at;
        d.fill(0, b, b + IN.SIZE);
        d[b + IN.TOPPED] = info.toppedOut ? 1 : 0;
        d[b + IN.STOP] = info.stopTime || 0;
        d[b + IN.INCOMING] = info.incoming || 0;
        d[b + IN.NEXTSLAB] = info.nextSlab || 0;
        d[b + IN.FALLING] = info.fallingGarbage ? 1 : 0;
        d[b + IN.CROW] = num(info.cursorRow); d[b + IN.CCOL] = num(info.cursorCol);
        d[b + IN.HEALTH] = num(info.health);
        d[b + IN.DRAIN] = info.drainRun || 0;
        d[b + IN.FPR] = info.framesPerRow || 0;
        d[b + IN.FTNR] = num(info.framesToNextRow);
        d[b + IN.SPEED] = num(info.speed); d[b + IN.NEXTUP] = num(info.nextSpeedUp);
        d[b + IN.STARTSPEED] = num(info.startingSpeed); d[b + IN.CLOCK] = num(info.clock);
        d[b + IN.STACKCLOCK] = s ? num(s.clock) : NaN;
        return bi;
    }

    function num(v) { return v === undefined || v === null ? (v === null ? 0 : NaN) : Number(v); }

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

        this._snapshot = PanelCpu().snapshot;
        this._beginWalk = PanelCpu().beginWalk;
        this._driveWalk = PanelCpu().driveWalk;
        this._nearestSwappable = PanelCpu().nearestSwappable;

        this.cooldown = 0;
        this.raiseFrames = 0;
        this._raiseStarted = false;
        this._walk = null;
        this._park = null;
        this._wantRaise = false;
        this._wantRows = 0;
        this._lastSwap = null;
        this._escapeWalk = Infinity;
        this.decisions = 0;
        this.lastLog = null;
        this.spend = { gameOver: 0, walking: 0, cooling: 0, decided: 0 };
        this.frozen = { walking: 0, cooling: 0, hold: 0, raise: 0, swap: 0 };
        this.counts = { refusedDeadly: 0, allDead: 0, byMode: {},
                        refusedReturn: 0, defendByClock: 0, refusedTooSlow: 0, planned: 0, planDropped: 0,
                        attacked: 0, attackDropped: 0, cellsPlanned: 0, refusedPayless: 0, refusedStarving: 0, refusedOther: 0, refusedAtExit: 0,
                        raisedForMaterial: 0, waitedToRaise: 0, dugFor: 0, digDropped: 0, brokeNow: 0, flattenBlind: 0,
                        openingRaises: 0, saveKept: 0, saveUnkeepable: 0, savePlanned: 0, heldTheBreak: 0, forcedBreak: 0, forcedBoth: 0, refusedEarly: 0,
                        raises: 0, holds: 0, swaps: 0, revealSwaps: 0,
                        revealWindows: 0, digging: 0, flattened: 0, flattenDropped: 0,
                        refusedStranded: 0, refusedNoFailsafe: 0, refusedSameSwap: 0 };
        this._id = native.botNew(this.table());
    }

    BitBot.prototype.table = function () {
        var e = PanelEngine(), tab = new Array(T.SIZE).fill(0), i, j, keys = BF.keys(), w = this.weights;
        for (i = 0; i < 99; i++) tab[T.RISE + i] = e.riseTime(i + 1);
        for (i = 0; i < 100; i++) {
            var pieces = e.comboGarbage(i) || [], cells = 0;
            for (j = 0; j < pieces.length; j++) cells += pieces[j];
            tab[T.COMBO + i] = cells;
        }
        var lv = e.LEVELS[9], st = lv.stop, f = lv.frames;
        tab[T.STOP] = st.comboConstant; tab[T.STOP + 1] = st.chainConstant; tab[T.STOP + 2] = st.dangerConstant;
        tab[T.STOP + 3] = st.coefficient; tab[T.STOP + 4] = st.dangerCoefficient;
        tab[T.LF] = f.FLASH; tab[T.LF + 1] = f.FACE; tab[T.LF + 2] = f.POP;
        for (i = 0; i < keys.length; i++) tab[T.W + i] = w[keys[i]] || 0;
        var o = T.OPT;
        tab[o] = this.reaction; tab[o + 1] = this.reveal ? 1 : 0; tab[o + 2] = this.allowRaise ? 1 : 0;
        tab[o + 3] = this.refuseReturn ? 1 : 0; tab[o + 4] = this.refusePayless ? 1 : 0; tab[o + 5] = this.beam;
        tab[o + 6] = this.maxDepth; tab[o + 7] = this.horizonDeath ? 1 : 0; tab[o + 8] = travel.pressOf();
        return tab;
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
            framesPerRow: framesPerRow(s),
            framesToNextRow: framesToNextRow(s),
            speed: s.speed,
            nextSpeedUp: s.nextSpeedIncreaseClock,
            startingSpeed: s.levelData ? s.levelData.startingSpeed : s.speed,
            clock: s.clock
        };
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

    BitBot.prototype._prepare = function (board, info) {
        var s = this.stack, i, c, r;
        var base = bit.maskState(board.grid, board.blocks, W, board.height, board.motion);
        var risen = null;
        if (this.canRaise() && board.rise) {
            var rb = board.clone().rise(board.incoming);
            rb.incoming = false;
            risen = bit.maskState(rb.grid, rb.blocks, W, rb.height, rb.motion);
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
        var conv = this.reveal ? lineup.converting(board) : null;
        var open = this.reveal && !conv ? lineup.revealed(board, board.height).open : false;
        var tm = (moving || open) ? lineup.timedOf(board, s.frames, board.height) : null;
        var legal = (conv || open) ? board.legalSwaps() : [];
        var bi = putInfo(info, s), d = bi.d, b = bi.at;
        d[b + IN.HASRISEN] = risen ? 1 : 0;
        d[b + IN.RAISEROOM] = (s.panels && s.height) ? this.raiseRoom() : 0;
        d[b + IN.INFLIGHT] = this.inFlight() ? 1 : 0;
        d[b + IN.DRAINBOUND] = info.toppedOut ? this.drainBound() : 0;
        var t = this._test;
        if (t) {
            d[b + IN.T] = (t.deadly ? 1 : 0) | (t.force ? 2 : 0) | (t.refuse ? 4 : 0) | (t.raise !== undefined ? 8 : 0) |
                          (t.flatten ? 16 : 0) | (t.slabReady !== undefined ? 32 : 0);
            d[b + IN.T + 6] = t.slabReady ? 1 : 0;
            if (t.flatten) { d[b + IN.T + 4] = t.flatten[0]; d[b + IN.T + 5] = t.flatten[1]; }
            var fs = t.force || t.refuse;
            if (fs) { d[b + IN.T + 1] = fs[0]; d[b + IN.T + 2] = fs[1]; }
            if (t.raise !== undefined) d[b + IN.T + 3] = t.raise === 'opening' ? 1 : t.raise === 'material' ? 2 : 0;
        }
        d[b + IN.STACKTOPPED] = typeof s.isToppedOut === 'function' && s.isToppedOut() ? 1 : 0;
        d[b + IN.MOVING] = moving ? 1 : 0;
        d[b + IN.HASTIMED] = tm ? 1 : 0;
        d[b + IN.REVEALOPEN] = open ? 1 : 0;
        if (conv) {
            d[b + IN.CONVN] = conv.cells.length; d[b + IN.CONVTIMER] = conv.timer;
            for (i = 0; i < conv.cells.length; i++) {
                d[b + IN.CONV + 3 * i] = conv.cells[i][0]; d[b + IN.CONV + 3 * i + 1] = conv.cells[i][1];
                d[b + IN.CONV + 3 * i + 2] = conv.cells[i][2];
            }
        }
        d[b + IN.BCROW] = board.cursor ? board.cursor.row : 1;
        d[b + IN.BCCOL] = board.cursor ? board.cursor.col : 1;
        d[b + IN.NLEGAL] = legal.length;
        for (i = 0; i < legal.length; i++) { d[b + IN.LEGAL + 2 * i] = legal[i][0]; d[b + IN.LEGAL + 2 * i + 1] = legal[i][1]; }
        if (board.incoming) {
            d[b + IN.HASINROW] = 1;
            for (c = 1; c <= W; c++) d[b + IN.INROW + c] = num(board.incoming[c]);
        }
        if (this._lastSwap) {
            d[b + IN.HASLAST] = 1; d[b + IN.LASTR] = this._lastSwap[0]; d[b + IN.LASTC] = this._lastSwap[1];
        }
        var P = s.panels;
        for (c = 1; c <= W; c++) {
            var settling = 0;
            for (r = 1; P && r < P.length; r++) {
                var q = P[r] && P[r][c];
                if (q && q.color !== 0 && !q.isGarbage &&
                    (q.state === 'hovering' || q.state === 'falling' || q.state === 'swapping')) { settling = 1; break; }
            }
            d[b + IN.SETTLING + c] = settling;
        }
        var f = s.frames || {};
        d[b + IN.SF] = num(f.HOVER); d[b + IN.SF + 1] = num(f.FLASH); d[b + IN.SF + 2] = num(f.FACE); d[b + IN.SF + 3] = num(f.POP);

        native.botStates(base, risen, tm ? tm.st : null, tm ? tm.opts : null);
        this._incomingRow = board.incoming;
        this._lastBase = base;
        return base;
    };

    BitBot.prototype.decide = function () {
        var board = this._snapshot(), info = this.info(board), i;
        this._prepare(board, info);
        var tabv = native.botTab(this._id);
        tabv.d[tabv.at + T.OPT + 8] = travel.pressOf();
        var res = native.botDecide(this._id);
        var o = res.d, at = res.out, cn = res.counts;
        var kind = KINDS[o[at]], via = VIAS[o[at + 7]];
        var out = { kind: kind, mode: { name: MODES[o[at + 10]] }, alive: o[at + 11], via: via };
        out.move = o[at + 1] ? [o[at + 2], o[at + 3]] : null;
        if (o[at + 4]) out.park = [o[at + 5], o[at + 6]];
        if (o[at + 8]) out.spends = true;
        if (o[at + 9]) out.reveal = true;
        this._wantRaise = !!o[at + 12];
        this._wantRows = o[at + 13];
        if (o[at + 14]) this.raiseFrames = 0;
        this._escapeWalk = o[at + 15];
        var log = { poolBreaks: o[at + 16], firstBreak: o[at + 16] ? [o[at + 17], o[at + 18]] : null,
                    built: !!o[at + 19], lines: o[at + 20], line: null, spend: o[at + 21] };
        if (log.built && log.lines) {
            log.line = [];
            for (i = 0; i < o[at + 22]; i++) log.line.push([o[at + 24 + 2 * i], o[at + 25 + 2 * i]]);
        }
        this.lastLog = log;
        this._lastSwap = kind === 'swap' && out.move ? [out.move[0], out.move[1]] : null;
        for (i = 0; i < COUNTS.length; i++) {
            if (o[cn + i] || this.counts[COUNTS[i]] !== undefined) this.counts[COUNTS[i]] = o[cn + i];
        }
        this.decisions = o[cn + C_DECISIONS];
        for (i = 0; i < 3; i++) if (o[cn + C_BYMODE + i]) this.counts.byMode[MODES[i]] = o[cn + C_BYMODE + i];
        return out;
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

    var SCRATCH = null;
    function idOf(self) {
        if (self && self._id !== undefined) return self._id;
        var me = Object.assign({}, self || {});
        if (!me.weights) me.weights = STARTER;
        var tab = BitBot.prototype.table.call(me);
        tab[T.OPT + 7] = me.horizonDeath ? 1 : 0;
        if (SCRATCH === null) SCRATCH = native.botNew(tab);
        var tv = native.botTab(SCRATCH);
        for (var i = 0; i < tab.length; i++) tv.d[tv.at + i] = tab[i];
        return SCRATCH;
    }
    function putRes(res) {
        var bi = native.botIn(), d = bi.d, a = bi.at + IN.T + 8, r = bi.at + IN.T + 16;
        d[a] = res ? 1 : 0;
        if (res) {
            d[r] = res.chain || 0; d[r + 1] = res.total || 0; d[r + 2] = res.garbage || 0;
            d[r + 3] = res.brokeGarbage || res.scope === 'garbage-broke' ? 1 : 0;
            d[r + 4] = res.converts || 0; d[r + 5] = res.voidAfter || 0;
        }
        return d;
    }
    function arg(i, v) { var bi = native.botIn(); bi.d[bi.at + IN.T + 8 + i] = v; }
    function hookInfo(self, info) {
        var bi = putInfo(info || {}, self && self.stack);
        var t = self && self._test;
        if (t && t.slabReady !== undefined) { bi.d[bi.at + IN.T] = 32; bi.d[bi.at + IN.T + 6] = t.slabReady ? 1 : 0; }
        if (self && self._incomingRow) {
            bi.d[bi.at + IN.HASINROW] = 1;
            for (var c = 1; c <= W; c++) bi.d[bi.at + IN.INROW + c] = num(self._incomingRow[c]);
        }
        return bi;
    }

    BitBot.prototype.deadly = function (st, resolved, info, horizon) {
        var id = idOf(this);
        hookInfo(this, info);
        native.botPut('in', st);
        putRes(resolved);
        arg(1, horizon || 0);
        return native.botTest(id, 1).v === 1;
    };
    BitBot.prototype.score = function (st, moveFrames, resolved, info) {
        var id = idOf(this);
        hookInfo(this, info);
        native.botPut('in', st);
        putRes(resolved);
        arg(1, moveFrames || 0);
        return native.botTest(id, 2).v;
    };
    BitBot.prototype.idleScore = function (cand, base, info) {
        if (!cand.masks) return -(cand.moveFrames || 0);
        var id = idOf(this);
        hookInfo(this, info);
        native.botPut('in', base);
        native.botPut('risen', cand.masks);
        putRes(null);
        arg(1, cand.moveFrames || 0);
        return native.botTest(id, 3).v;
    };
    BitBot.prototype.refuses = function (cand, info, base, survivalNeeded, breakAvailable) {
        if (!cand || cand.kind !== 'swap' || !cand.resolved) return null;
        var id = idOf(this);
        hookInfo(this, info);
        native.botPut('in', base);
        putRes(cand.resolved);
        arg(2, 2); arg(3, cand.swap ? cand.swap[0] : 0); arg(4, cand.swap ? cand.swap[1] : 0);
        arg(5, survivalNeeded ? 1 : 0); arg(6, breakAvailable ? 1 : 0);
        var v = native.botTest(id, 4).v;
        return v === 1 ? 'payless' : v === 2 ? 'starving' : null;
    };
    BitBot.prototype.raiseMode = function (info, base, poolBreak) {
        var id = idOf(this);
        var bi = hookInfo(this, info);
        bi.d[bi.at + IN.RAISEROOM] = (this.stack && this.stack.panels && this.stack.height) ? this.raiseRoom() : 0;
        native.botPut('in', base);
        arg(1, poolBreak ? 1 : 0);
        var v = native.botTest(id, 5).v;
        return v === 1 ? 'opening' : v === 2 ? 'material' : null;
    };
    BitBot.prototype.towering = function (base) {
        var shp = base && bitoptions.shapeOf(base);
        return !!shp && (shp.spread || 0) >= WORKING_ROWS;
    };
    BitBot.prototype.mode = function (info, pool, revealOpen, deadline, escape) {
        var id = idOf(this);
        var bi = hookInfo(this, info), i, n = 0;
        for (i = 0; i < pool.length; i++) {
            var r = pool[i].resolved;
            bi.d[bi.at + IN.LEGAL + 2 * n] = r ? (r.total || 0) : 0;
            bi.d[bi.at + IN.LEGAL + 2 * n + 1] = r ? (r.chain || 0) : 0;
            n++;
        }
        var has = escape !== null && escape !== undefined;
        arg(1, has ? 1 : 0); arg(2, has ? escape : 0); arg(3, deadline === undefined ? NaN : deadline); arg(4, n);
        return { name: MODES[native.botTest(id, 13).v], reveal: !!revealOpen };
    };
    BitBot.prototype.setOpening = function (v) { native.opening(this._id, v); };
    BitBot.prototype.opening = function () { return native.opening(this._id) === 1; };
    BitBot.prototype.candidates = function (board, info) {
        var base = this._prepare(board, info);
        var r = native.botTest(this._id, 8), n = r.v, out = [], i;
        for (i = 0; i < n; i++) {
            var o = r.d, b = r.out + 8 * i, kind = KINDS[o[b]];
            var res = { chain: o[b + 4], total: o[b + 5], brokeGarbage: o[b + 6] ? 1 : 0 };
            out.push({ kind: kind, swap: kind === 'swap' ? [o[b + 1], o[b + 2]] : null,
                       masks: o[b + 7] < 0 ? base : null, moveFrames: o[b + 3], resolved: res, _slot: o[b + 7] });
        }
        for (i = 0; i < n; i++) if (out[i]._slot >= 0) out[i].masks = native.botPoolMasks(out[i]._slot, base.bad);
        return out;
    };
    BitBot.prototype.timing = function (info, deadline) {
        var id = idOf(this);
        hookInfo(this, info);
        arg(1, deadline || 0);
        var r = native.botTest(id, 12), P = r.d, b = r.out, avoid = [], i;
        for (i = 0; i < P[b + 18]; i++) avoid.push([P[b + 19 + 2 * i], P[b + 20 + 2 * i]]);
        var t = { framesPerRow: P[b], workingRows: P[b + 7], holdWorth: P[b + 6], deadline: P[b + 1],
                  reaction: this.reaction, overhead: P[b + 8], prepare: true, stopKey: info.toppedOut ? 'top' : 'free',
                  avoidSwap: avoid };
        var toppedOut = !!info.toppedOut;
        t.stopPrice = function (res) {
            var isChain = res.chain >= 2;
            return BF.stopTimeOf(PanelEngine(), isChain, isChain ? 0 : (isChain ? res.chain : res.total),
                                 isChain ? res.chain : 0, toppedOut);
        };
        t.resolve = function (size, garbage) { return BF.resolveFramesOf(PanelEngine(), size, garbage); };
        if (info.toppedOut) t.lock = P[b + 2];
        return t;
    };

    function pick(list, fn, args) {
        var all = list.now.concat(list.next);
        native.putRecords(all);
        var id = idOf(null);
        for (var i = 0; i < args.length; i++) arg(i + 1, args[i]);
        arg(1, all.length);
        var r = native.botTest(id, fn);
        if (r.v < 0) return null;
        var o = all[r.v];
        return { rate: r.d[r.out], cells: r.d[r.out + 1], gain: r.d[r.out + 2], frames: r.d[r.out + 3],
                 move: o.swaps[0], option: o };
    }
    function framesInto(frames) {
        var bi = native.botIn(), f = frames || {};
        bi.d[bi.at + IN.SF] = num(f.HOVER); bi.d[bi.at + IN.SF + 1] = num(f.FLASH);
        bi.d[bi.at + IN.SF + 2] = num(f.FACE); bi.d[bi.at + IN.SF + 3] = num(f.POP);
    }
    function bestAttack(list, weights, engine, deadline, framesTable, perPanelFrames) {
        idOf({ weights: weights });
        putInfo({}, null);
        framesInto(framesTable);
        return pick(list, 9, [0, deadline || 0, perPanelFrames || 0]);
    }
    function bestPlan(list, clock, deadline, engine, toppedOut, fpr, framesTable, tallNow) {
        idOf(null);
        putInfo({}, null);
        framesInto(framesTable);
        return pick(list, 10, [0, clock || 0, deadline || 0, toppedOut ? 1 : 0, fpr || 0, tallNow || 0]);
    }
    function ruinsShape(o) {
        native.putRecords([o]);
        arg(1, 1);
        return native.botTest(idOf(null), 11).v === 1;
    }
    function framesToRise(rows, info, fpr, startClock) {
        var id = idOf(null);
        putInfo(info, null);
        arg(1, rows); arg(2, fpr || 0);
        arg(3, (startClock === undefined || startClock === null) ? num(info.clock) : startClock);
        return native.botTest(id, 6).v;
    }
    function framesToDeath(info, tallest, fpr) {
        var id = idOf(null);
        putInfo(info, null);
        arg(1, tallest); arg(2, fpr || 0);
        return native.botTest(id, 7).v;
    }

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
