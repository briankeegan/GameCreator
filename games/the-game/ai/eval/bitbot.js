// BITBOT — a second bot, beside PuyoCpu, not a change to it. Plan: BITBOT.md.
//
// Every decision is: read the info, build the pool, let the mode filter it,
// throw out what dies, score what is left with the weights, play the winner.
//
// THE ONE RULE THAT IS NOT A WEIGHT: it cannot die. A candidate the engine
// would kill is not offered, however well it scores. The weights are free to be
// wrong about everything else.
//
// A MODE IS A FILTER ON THE POOL, NOT A SECOND WAY TO DECIDE. The evaluator
// still picks, from whatever the mode allows. Borrowed from modes.js
// deliberately: a mode that played a move directly would end the claim that
// every decision goes through the same scoring.
//
// THE SAME SHAPE AS PuyoCpu, because versus.js drives both. update() takes no
// argument, builds its own input object and calls stack.setInput itself; a
// raise is held for 20 frames because setInput latches manualRaise on a rising
// edge and the row takes frames to arrive.
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

    // HOW MUCH SLACK COUNTS AS NONE, IN ROWS, which is modes.js's own
    // ESCAPE_RESERVE_ROWS and a measured number rather than one invented here.
    //
    // Frames were the wrong unit and the mistake is worth keeping written down. A
    // row is 112 frames at this speed, so one row from death the bot has 112
    // frames of room -- which beats the ~30 frames an escape costs to walk to, so
    // a frames-against-walk-cost trigger reads "plenty of time" and stays in
    // BUILD. Read off seed 101: the last five decisions before death were all
    // BUILD at tallest 11, and DEFEND opened on the single frame it topped out,
    // one decision before it died.
    //
    // Rows are the right unit because the danger is not the walk, it is having no
    // workspace: a chain needs several rows to assemble in, and at tallest 11
    // there is one.
    var ESCAPE_RESERVE_ROWS = 2;

    function tallestOf(pool) {
        for (var i = 0; i < pool.length; i++) {
            if (pool[i].kind === 'hold') return tallestBoard(pool[i].masks);
        }
        return 0;
    }

    function G() { return (typeof window !== 'undefined' ? window : globalThis); }
    function PanelCpu() { return G().PanelCpu; }
    function PanelEngine() { return G().PanelEngine; }

    // A STARTER VECTOR. Still not trained -- it is a hand-set guess with ONE
    // number group measured -- so nothing about how well the bot plays should be
    // read off a result it produces.
    //
    // WHY THE POTENTIAL WEIGHTS ARE HALF WHAT THEY WERE. The first guess made
    // the bot refuse to clear at all: it found a 6-chain, scored it +1, and
    // scored RAISING +54, because it was paid +45 for HAVING a big chain
    // available against +34 for playing one. On seeds 701-704 capped at 4,000
    // frames, halving this group and changing nothing else:
    //
    //   as first guessed   2,380 frames   57 matches   (one seed cleared nothing)
    //   potential x0.5     4,000 frames  133 matches   (died on no seed)
    //   potential x0.25    3,627 frames  104 matches
    //   stopEarned x5      4,000 frames  119 matches
    //
    // IT IS A BALANCE, NOT A STRUCTURE. An earlier reading of this blamed the
    // features for measuring a LEVEL of potential rather than a CHANGE in it.
    // That is wrong and the test is in the history: within one decision the two
    // differ by the potential of the board every candidate started from, which
    // is the same constant for all of them, so they rank identically -- measured
    // over 40 candidates, one distinct difference per feature. Rewriting them as
    // changes would alter no decision. Do not retry it.
    var STARTER = {
        bumpiness: -20, spread: -10, tallest: -40,
        chain2: 5, chain3: 13, chain4: 20, chain5plus: 30,
        combo4: 4, combo5: 6, combo6: 8, combo7: 10,
        cheapestFrames: 10, moveFrames: 5,
        nextBestChain: 15, nextBestCombo: 5, nextWays: 5,
        breaksNow: 25, breakWays: 5,
        stopEarned: 50, stopReachable: 30
    };

    // The engine rises one PIXEL at a time and a row is sixteen of them, so
    // riseTime is frames per pixel. Rows do not move at all while stop time is
    // running -- updateRise returns before the timer on any frame with
    // stopTime above zero.
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

    // THE BOARD AS A STRING, so "have we been here" is an exact question and not
    // a similarity score. Straight off the masks: one integer per colour per
    // column plus the occupancy, which IS the settled position. Built from the
    // grid before, which meant a candidate's signature came from a board the old
    // simulation had predicted -- so a return the engine actually made could go
    // unrecognised.
    function signature(st) {
        var out = [], a, c, stride = st.W + 2;
        for (c = 1; c <= st.W; c++) out.push(st.occ[c] + ':' + st.garb[c]);
        for (a = 1; a <= st.N; a++) for (c = 1; c <= st.W; c++) out.push(st.colour[a * stride + c]);
        return out.join(',');
    }

    function BitBot(stack, opts) {
        opts = opts || {};
        this.stack = stack;
        this.weights = opts.weights || STARTER;
        // FRAMES BETWEEN DECISIONS. 12 is the human-paced default PuyoCpu uses
        // and every duel is run at, so the two bots think equally often and the
        // bit that comes out is not about reaction time.
        this.reaction = opts.reaction === undefined ? 12 : opts.reaction;
        this.cursorMoveFrames = travel.MOVE_FRAMES;
        // The reveal window needs bitframes to run the position forward, which
        // is the one part of the pool that is not cheap. On by default because
        // it is the reason bitlineup exists; off for a run measuring what it
        // is worth.
        this.reveal = opts.reveal !== false;
        this.allowRaise = opts.allowRaise !== false;
        // TWO FILTERS THAT ARE NOT WEIGHTS, both off only for the run that
        // measures what they are worth. See refuseReturn and deadly below.
        this.refuseReturn = opts.refuseReturn !== false;
        // Off only for the run that measures what the rule is worth.
        this.refusePayless = opts.refusePayless !== false;
        // HOW MANY CANDIDATES GET THE EXPENSIVE SCORE. Scoring one runs a depth-2
        // option sweep -- about 900 cascade resolves -- and there are ~30
        // candidates, so a full decision is ~27,000 resolves and 171ms. A cheap
        // pre-rank on the surface and the candidate's own clear costs nothing and
        // orders them well enough that the winner is almost always in the top few.
        // 0 disables the beam and scores everything, for a run measuring what the
        // beam costs in quality.
        this.beam = opts.beam === undefined ? 8 : opts.beam;
        this.horizonDeath = opts.horizonDeath !== false;
        // The boards recent decisions were made on. Three, because a swap is an
        // involution -- it can only walk back one step at a time -- and a
        // longer memory starts refusing legitimate revisits of a position the
        // rising stack has genuinely changed.
        this._seen = [];
        // The plan being executed, if any. See the commitment note in decide().
        this._plan = null;
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
        this.decisions = 0;
        // WHERE EVERY FRAME WENT. Not diagnostics bolted on -- the bot could not
        // say what it did with a frame, so every question about its behaviour was
        // answered by inference and three separate fixes landed in code paths that
        // never ran. One counter per exit from update(), and they must sum to the
        // frames played: a frame that is not in exactly one bucket is a frame
        // nobody can account for.
        //
        // `frozen` is the same buckets restricted to frames with stop time
        // running, because those are the frames that decide whether the bot lives.
        this.spend = { gameOver: 0, walking: 0, cooling: 0, decided: 0 };
        this.frozen = { walking: 0, cooling: 0, hold: 0, raise: 0, swap: 0 };
        this.counts = { refusedDeadly: 0, allDead: 0, byMode: {},
                        refusedReturn: 0, defendByClock: 0, refusedTooSlow: 0, planned: 0, planDropped: 0,
                        attacked: 0, attackDropped: 0, cellsPlanned: 0, refusedPayless: 0,
                        raisedForMaterial: 0, refusedRaise: 0,
                        raises: 0, holds: 0, swaps: 0, revealSwaps: 0,
                        revealWindows: 0 };
    }

    // WHAT THE ENGINE KNOWS, shared by every candidate in the decision. None of
    // it is weighted: it picks the mode and gates the pool.
    BitBot.prototype.info = function (board) {
        var s = this.stack, incoming = 0;
        if (s.incoming) {
            for (var i = 0; i < s.incoming.length; i++) {
                incoming += (s.incoming[i].width || 0) * (s.incoming[i].height || 1);
            }
        }
        return {
            toppedOut: (typeof s.isToppedOut === 'function' && s.isToppedOut()) || !!s.wasToppedOut,
            stopTime: s.stopTime || 0,
            incoming: incoming,
            cursorRow: board.cursor ? board.cursor.row : (s.curRow || 1),
            cursorCol: board.cursor ? board.cursor.col : (s.curCol || 1),
            health: s.health,
            framesPerRow: framesPerRow(s),
            // FRAMES UNTIL THE NEXT ROW LANDS, not a whole row's worth: the
            // floor is already part way up. displacement is the pixels left and
            // riseTimer the frames left of the current pixel, both read off the
            // engine, so nothing here is a constant.
            framesToNextRow: framesToNextRow(s)
        };
    };

    // WHAT IS WORTH CASHING IN, READ OFF THE WEIGHTS — not a setting here.
    // modes.aim's own argument: a bot that has learned to value a 5-chain above
    // every other chain size IS a bot aiming at a 5-chain. The floor is what the
    // engine pays anything at all for, 2 links and 4 wide.
    BitBot.prototype.aim = function () {
        var w = this.weights, best = 0, links = 0, wide = 0, i, v;
        var CH = [['chain2', 2], ['chain3', 3], ['chain4', 4], ['chain5plus', 5]];
        var CO = [['combo4', 4], ['combo5', 5], ['combo6', 6], ['combo7', 7]];
        for (i = 0; i < CH.length; i++) { v = w[CH[i][0]] || 0; if (v > best) { best = v; links = CH[i][1]; } }
        best = 0;
        for (i = 0; i < CO.length; i++) { v = w[CO[i][0]] || 0; if (v > best) { best = v; wide = CO[i][1]; } }
        return { links: links || 2, wide: wide || 4 };
    };

    // BUILD, ATTACK, DEFEND — and REVEAL alongside whichever of those applies,
    // because REVEAL ADDS TO THE POOL RATHER THAN TAKING IT OVER.
    //
    // DEFEND IS modes.forced's OWN TRIGGER AND NOT A CLOCK. Opening the
    // emergency on the danger clock as well was measured: FORCED went from 0.8%
    // of decisions to 23.3% and the bot lost 8-16-16 to the same weights
    // without it, because the emergency DISCARDS the build pool. The clock
    // belongs in what is preferred, not in what is allowed — here that is
    // stopReachable, a weight.
    //
    // ATTACK is derived, not triggered by a constant: if anything in the pool
    // clears at or above the aim, there is something to cash and hold drops.
    BitBot.prototype.mode = function (info, pool, revealOpen) {
        var name = 'BUILD';
        // DEFEND OPENS WHEN THE FLOOR ARRIVES BEFORE AN ESCAPE CAN BE REACHED,
        // not on topped out alone.
        //
        // Topped out is too late: by then health is already draining. The
        // condition that matters is the one modes.warned states -- the room left
        // measured in frames against the frames to the nearest move that banks
        // time -- and it is arithmetic, not a threshold written here.
        //
        // WHY THIS IS SAFE HERE AND WAS NOT IN modes.js. Opening FORCED on the
        // clock made PuyoCpu worse (8-16-16) because FORCED narrows the pool to
        // moves that bank time and PuyoCpu usually had none: over the last
        // fifteen seconds of ten deaths, 84% of its decisions had no such move at
        // all, so narrowing left it with nothing. BitBot is the opposite case,
        // measured on one duel -- of 53 decisions taken with an EMPTY clock, 50
        // had a payout of 30 to 66 frames on the board and it declined 45 of
        // them. Narrowing to those moves is narrowing to something.
        if (info.toppedOut) name = 'DEFEND';
        else if (H - tallestOf(pool) <= ESCAPE_RESERVE_ROWS) name = 'DEFEND';
        else {
            var goal = this.aim();
            for (var i = 0; i < pool.length; i++) {
                var r = pool[i].resolved;
                if (!r || !r.total) continue;
                if (r.chain >= goal.links || r.biggest >= goal.wide) { name = 'ATTACK'; break; }
            }
        }
        return { name: name, reveal: !!revealOpen };
    };

    // A CANDIDATE IS DEAD WHEN THE ENGINE WOULD KILL IT, not when its top row is
    // occupied. checkGameOver is `health <= 0 && shakeTime <= 0`, and health
    // only drains on a frame where `!riseLock && stopTime === 0 &&
    // isToppedOut()` — so a topped-out board holding stop time is alive, and
    // chaining INTO the ceiling is how the position is meant to be played.
    // Borrowed from PuyoCpu's own note, which records getting this wrong.
    BitBot.prototype.deadly = function (st, resolved, info, horizon) {
        var tallest = tallestBoard(st);
        var banked = info.stopTime || 0;
        if (resolved && resolved.total > 0) {
            var isChain = resolved.chain >= 2;
            banked = Math.max(banked, BF.stopTimeOf(PanelEngine(), isChain,
                                                    isChain ? 0 : resolved.total,
                                                    isChain ? resolved.chain : 0, true));
        }

        // THE ROWS THAT LAND BEFORE THE BOT CAN ACT AGAIN COUNT AS HEIGHT.
        //
        // Without this the filter says "already dead", not "would die": it fired
        // only once a board was FULL, which at stopTime 0 is the frame health
        // starts draining. Measured on seed 701 -- twelve consecutive decisions
        // at tallest 11 with nothing refused, then topped out and dead. The
        // plan's rule is that a candidate the engine WOULD KILL is not offered,
        // and one row is the granularity the engine rises at.
        //
        // Stop time freezes the floor, so what is banked is subtracted from the
        // horizon before asking how much of it the floor gets.
        var rows = 0;
        if (this.horizonDeath && info.framesToNextRow !== undefined) {
            var spend = (horizon || 0) - banked;
            if (spend >= info.framesToNextRow && isFinite(info.framesToNextRow)) {
                rows = 1 + (info.framesPerRow > 0
                            ? Math.floor((spend - info.framesToNextRow) / info.framesPerRow) : 0);
            }
        }
        if (tallest + rows < H) return false;                  // room left: not dead
        return banked <= 0;                                    // full, nothing holding it
    };

    BitBot.prototype.score = function (st, moveFrames, resolved, info) {
        var out = BF.features(null, [info.cursorRow, info.cursorCol], moveFrames,
                             resolved, info, PanelEngine(), st);
        var w = this.weights, total = 0, keys = BF.keys();
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i], v = out.f[k];
            if (v === undefined || !w[k]) continue;
            total += w[k] * v;
        }
        return total;
    };

    // Can the engine act on a raise at all. Every clause is one the engine
    // itself checks; a raise it refuses is not a move, and offering one means
    // scoring a board that never arrives.
    BitBot.prototype.canRaise = function () {
        if (!this.allowRaise) return false;
        var s = this.stack;
        if (s.preventManualRaise || s.manualRaise) return false;
        if (typeof s.isToppedOut === 'function' && s.isToppedOut()) return false;
        if (typeof s.hasFallingGarbage === 'function' && s.hasFallingGarbage()) return false;
        if (s.riseLock) return false;
        if (typeof s.hasActivePanels === 'function' && s.hasActivePanels()) return false;
        if ((s.shakeTime || 0) > 0) return false;
        return true;
    };

    // What the mask resolver reports, in the shape the rest of the bot reads.
    // `biggest` is the widest single clear, and for a cascade of one round that is
    // the whole of it -- which is the only case the aim needs it for, since a
    // chain is judged on its depth.
    function summarise(res) {
        return { chain: res.chain || 0, total: res.total || 0,
                 biggest: res.rounds === 1 ? (res.total || 0) : 0,
                 brokeGarbage: res.scope === 'garbage-broke' ? 1 : 0,
                 scope: res.scope };
    }

    // THE POOL: hold, raise, every legal swap, and during a reveal window the
    // lineup swaps as well. Hold is always built — that is what waiting is, and
    // without it the bot cannot build — but a mode may filter it out.
    BitBot.prototype.candidates = function (board, info) {
        var out = [], i, r, c;
        var base = bit.maskState(board.grid, board.blocks, W, board.height);

        out.push({ kind: 'hold', swap: null, board: board, masks: base,
                   moveFrames: 0, resolved: null });

        // A raise is the one candidate that still needs the simulation, and for a
        // reason that is not going away: the row being dealt is ENGINE data that no
        // arithmetic here can produce. The row behind it comes from the match rng,
        // so `incoming = false` says unknown rather than inventing matches the game
        // will not deal.
        if (this.canRaise() && board.rise) {
            var risen = board.clone().rise(board.incoming);
            risen.incoming = false;
            var rst = bit.maskState(risen.grid, risen.blocks, W, risen.height);
            var rres = bit.resolveFromMasks(rst, true);
            out.push({ kind: 'raise', swap: null,
                       board: null,
                       masks: rres.settled || rst,
                       moveFrames: 0, resolved: summarise(rres) });
        }

        // EVERY SWAP, ANSWERED BY THE ARITHMETIC AND NOT BY A SECOND SIMULATION.
        //
        // swapMasks refuses what an engine swap cannot touch, so it is the legality
        // test as well as the move -- no legalSwaps() call. resolveFromMasks says
        // what the cascade does and now hands back the board it left, so the
        // position every candidate is scored on comes from the same arithmetic that
        // is checked frame-exact against the engine on 74,522 cases and 74,821
        // swaps. LogicalBoard.resolve() was a different implementation predicting
        // it, and a prediction that disagrees is a decision made about a board the
        // game will not produce -- measured as 26 decisions revisiting a position
        // the no-return filter had already refused.
        var legal = bit.legalSwapsOf(base);
        for (i = 0; i < legal.length; i++) {
            r = legal[i][0]; c = legal[i][1];
            if (!bit.swapMasks(base, r, c)) continue;       // refused: not a move
            var res = bit.resolveFromMasks(base, true);
            // A MOVE THAT BREAKS A SLAB HAS NO SETTLED BOARD. The engine draws the
            // converted row's colours from its own rng, so the cascade past the
            // break is unknowable and the resolver refuses to invent it. The BREAK
            // is still the point of the move, so the candidate is scored on the
            // position as swapped -- what is known up to the break -- rather than
            // being dropped, which is how every digging option went invisible once
            // before.
            var after = res.settled || bit.copyState(base);
            bit.swapMasks(base, r, c);                     // put it back
            // A broken slab hands us colours the engine draws from its own rng, so
            // there is no settled board to score. The BREAK is still the point of
            // the move, so the candidate is kept with what is known up to it.
            out.push({ kind: 'swap', swap: [r, c],
                       board: null,
                       masks: after,
                       moveFrames: travel.cost(info.cursorRow, info.cursorCol, r, c),
                       resolved: summarise(res) });
        }
        return out;
    };

    // THE REVEAL WINDOW. Every feature assumes a SETTLED board, and this window
    // is by definition unsettled, so the swap bitlineup names cannot be scored
    // by the same 20 — it is priced by what it makes the landing do, which is
    // what bitlineup measures, and it JOINS the pool rather than replacing it.
    BitBot.prototype.revealPick = function (board) {
        if (!this.reveal) return null;
        var plan;
        try {
            plan = lineup.bestInWindow(board, this.stack.frames, board.height,
                                       [board.cursor ? board.cursor.row : 1,
                                        board.cursor ? board.cursor.col : 1],
                                       board.legalSwaps());
        } catch (e) { return null; }                 // an unreadable window is not a move
        if (!plan) return null;
        this.counts.revealWindows++;
        return plan.best && plan.best.swap ? plan : null;
    };

    // The tallest column, from the masks. On a settled board a column is a packed
    // run from the floor, so its height is a popcount.
    function tallestBoard(st) {
        if (!st) return H;                  // unknown position: treat as full
        var t = 0;
        for (var c = 1; c <= W; c++) {
            var n = 0, o = st.occ[c];
            while (o) { o &= o - 1; n++; }
            if (n > t) t = n;
        }
        return t;
    }

    // HOW MANY FRAMES ARE LEFT BEFORE THIS BOARD IS DEAD.
    //
    // The engine drains health by one on every frame where it is topped out with
    // no stop time (updateRise: `if (!riseLock && stopTime === 0)` then `if
    // (isToppedOut()) this.health--`), and checkGameOver ends it at health 0. So:
    //
    //   topped out      stopTime + health      -- the freeze, then the drain
    //   not topped out  stopTime + the rows still free, in frames
    //
    // Both terms are the engine's own numbers, so this is a measurement and not a
    // budget invented here.
    function framesToDeath(info, tallest, framesPerRow) {
        var clock = info.stopTime || 0;
        if (info.toppedOut) return clock + (info.health === undefined ? 0 : info.health);
        return clock + Math.max(0, H - tallest) * (framesPerRow || 0);
    }

    // IS A REVEAL WINDOW OPEN, read straight off the live stack.
    //
    // Cheap on purpose: this is asked on EVERY frame, so it cannot afford the
    // snapshot that bestInWindow needs. A slab's converted row carries
    // fellFromGarbage and something is still in the air -- the same two
    // conditions bitlineup's own `revealed` tests, against the engine's panels
    // instead of a copy of them.
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

    // IS ANYTHING MOVING. A cascade in progress changes the board without the
    // bot doing anything, so those frames are not idle even when it holds.
    BitBot.prototype.inFlight = function () {
        var s = this.stack;
        if (typeof s.hasActivePanels === 'function' && s.hasActivePanels()) return true;
        return (s.shakeTime || 0) > 0;
    };

    // THE BEST PLAN THAT FINISHES IN TIME AND ARRIVES AT THE RIGHT MOMENT.
    //
    // A plan is a sequence of moves with a total frame cost -- bitoptions prices
    // both plies, the walk to the setup and the walk from it to the cash. Three
    // questions, all arithmetic:
    //
    //   how many frames does it take     o.frames
    //   will the board still be alive     o.frames <= framesToDeath
    //   how much time does it GAIN        max(0, pays - max(0, clock - o.frames))
    //
    // The third is the one that makes timing matter. awardStopTime is a MAX, so a
    // payout only counts for what it adds ON TOP of what is still running -- and
    // what is still running when the move LANDS is the clock now minus the frames
    // spent getting there. Fire early and the gain is nothing; the same move a
    // moment later is worth its full value. That is "hit it at the right moment",
    // and it falls out of the subtraction rather than needing a rule.
    //
    // Ties go to the cheaper plan, because the frames not spent are frames still
    // available for the plan after this one.
    // HOW DEEP TO LOOK, GIVEN HOW MUCH TROUBLE THE BOARD IS IN.
    //
    // Looking costs time and time is what a threatened board does not have, so the
    // depth is spent out of the same budget everything else is: rows of headroom.
    // Calm board, look further; one row from the ceiling, answer now.
    //
    // WHAT EACH PLY COSTS, measured over 51 real mid-game boards with the bit
    // arithmetic -- a resolve is 0.9 microseconds and a real board offers about
    // nine legal swaps:
    //
    //     depth 2    0.4 ms      no chains found at all
    //     depth 3    5.0 ms      2-chains start appearing
    //     depth 4   95.1 ms      245 two-chains over the same boards
    //
    // AND NO DEPTH FOUND A 3-CHAIN, not once in 51 boards even at four plies. That
    // is not the search running out of room, it is the board having no material:
    // survival keeps it low and flat by clearing, and a low board cannot be chained
    // from however long you stare at it. Depth is worth having and is not the
    // answer to attacking.
    //
    // The thresholds are rows and are NOT calibrated -- halfway up the board is a
    // landmark, not a measurement, and it is written here rather than implied.
    function depthFor(mode, tallest) {
        if (mode === 'DEFEND') return 2;              // answer now
        if (tallest <= H / 2) return 4;               // room to think
        return 3;
    }

    // THE WORKING BAND: A BOARD TOO LOW HAS NOTHING TO PLAY WITH.
    //
    // Survival is a clear rate at or above 1.0 and the objective that delivers it
    // maximises panels removed per frame -- which drives the board as low as it
    // can go. That is what keeps it alive and it is also why it cannot attack:
    // measured over 51 real mid-game boards, a 3-chain was on offer ZERO times,
    // at two plies and at four. Not because the search ran out of room, but
    // because a nearly empty board has no material to chain with.
    //
    // A chain is built out of panels. Raising ADDS material and breaking garbage
    // CONVERTS it; clearing spends it. So below the band the bot stops cashing
    // small change and puts panels on the board instead.
    //
    // ORDER: living, then material, then attacking. Nothing here outranks
    // survival -- this only applies when survival is not at stake.
    //
    // FOUR ROWS IS NOT CALIBRATED. It is a third of the board and roughly what a
    // chain needs to stand in, written here rather than implied so the next
    // measurement can move it.
    // How thin is too thin to have anything to play with. A third of the board,
    // roughly what a chain needs to stand in. NOT calibrated.
    var WORKING_ROWS = 4;

    // TRIED AND MEASURED WORSE, so the numbers are here rather than the code.
    // Below four rows: refuse to cash anything under W cells, and raise instead to
    // put panels on the board. Over four duels it went from 1 death, 510 cells and
    // 7 big pieces to 2 DEATHS, 378 cells and 3 big pieces. Raising to build walks
    // the stack up and the bot dies in the middle of building; withholding small
    // attacks only cuts the output that was working.
    //
    // The REASONING still stands and this is the honest state of it: a board kept
    // low by the survival objective has no material to chain with, and material is
    // what raising and breaking garbage provide. What is wrong is doing it with a
    // height threshold and a blanket refusal. It wants to be a property of the
    // plan -- build toward a shape, spend only what the shape does not need --
    // which is not a threshold at all.

    // FRAMES THE FLOOR CANNOT MOVE. The one quantity all of this ever wanted.
    //
    // THE ENGINE HAS ONE RULE, NOT THREE. The floor rises, and health drains, only
    // on a frame where `!riseLock && stopTime === 0`, and
    //
    //     riseLock = swapQueued || shakeTime > 0 || hasActivePanels()
    //
    // So stop time, shake time and panels-in-motion are not three mechanisms to be
    // handled separately -- they are three ways of setting one bit. Anything that
    // holds that bit buys exactly the same thing: frames in which the board cannot
    // kill you. Measuring only stop time, which is what this did, sees one of the
    // three and misses the two that digging earns.
    //
    // THEY OVERLAP, SO IT IS A MAX AND NOT A SUM. A clear that takes 100 frames to
    // play out while 60 of stop time is running holds the floor for 100, not 160.
    //
    // WHAT A CLEAR HOLDS, from the engine's own frame table via stack.frames:
    // every matched panel runs FLASH then FACE then POP per panel, and garbage
    // pops alongside its own cells -- matchGarbagePanels gives each garbage panel
    // FLASH + FACE + POP * (size + onScreen). Read, never restated.
    //
    // WHY THIS IS NOT A PATCH. stopTimeOf answers "what did the clock get", and
    // that is a real number the engine computes, so it stays. What changed is that
    // nothing ranks on it directly any more: every objective asks how long the
    // floor is held, and the clock is one of the three things that holds it.
    function heldFrames(frames, stopGain, cleared, garbagePanels) {
        if (!frames) return stopGain || 0;
        var popping = 0;
        if (cleared > 0 || garbagePanels > 0) {
            popping = (frames.FLASH || 0) + (frames.FACE || 0) +
                      (frames.POP || 0) * (cleared + garbagePanels);
        }
        return Math.max(stopGain || 0, popping);
    }

    // WHAT AN OPTION SENDS, from the engine's own tables and never restated here.
    //
    //   a combo of N panels   PanelEngine.comboGarbage(N), each piece 1 row tall
    //   a chain of L links    ONE piece, full width, height L - 1
    //
    // The numbers are the reason the bot has to chain. A 4-combo sends 3 cells and
    // the widest realistic combo sends 12; a 3-chain sends 12 and a 6-chain sends
    // 30. A chain is worth up to TEN TIMES a combo, and nothing that ranks by
    // panels cleared or by stop time can see that -- the deepest chain pays only
    // 68 frames of stop time against a two-chain's 60, while sending five times
    // the garbage.
    function cellsSent(engine, kind, size, chain) {
        var cells = 0, i;
        if (kind !== 'chain') {
            var pieces = engine.comboGarbage(size) || [];
            for (i = 0; i < pieces.length; i++) cells += pieces[i];   // each one row tall
            return cells;
        }
        // A chain also fires its opening combo, but the opener is what STARTS the
        // chain and its size is not carried on the option -- so this counts the
        // chain card alone and is a floor on what the move sends, never an
        // overstatement.
        return chain > 1 ? W * (chain - 1) : 0;
    }

    // THE BEST ATTACK, AND IT IS ARITHMETIC LIKE SURVIVAL IS.
    //
    // The bot is ALWAYS attacking. Whether to attack is not a preference and the
    // weights get no vote on it -- exactly as they get no vote on whether to
    // survive. What they steer is WHICH attack: a vector that likes deep chains
    // holds out for one, a vector that likes wide combos takes them. That is what
    // a feature is for here, and it is the only thing it does.
    //
    // This was the hole. Attacking had no plan at all: BUILD ranked single
    // candidates by the weighted features and played the winner, so a vector that
    // happened to prefer setups never cashed anything and the bot sent 93 cells in
    // 15,000 frames. Nothing made it attack.
    //
    // RANKED BY CELLS PER FRAME, so a big attack that takes a long walk is
    // compared fairly against a small one that is already under the cursor. The
    // weight is a MULTIPLIER on that rate rather than an addition to it, so a
    // preference can say "a chain is worth twice a combo to me" without being able
    // to say "attack nothing at all" -- a zero or negative weight leaves the shape
    // merely unloved, not forbidden.
    function bestAttack(list, weights, engine, deadline, framesTable, perPanelFrames) {
        var best = null, all = list.now.concat(list.next), i;
        for (i = 0; i < all.length; i++) {
            var o = all[i];
            if (!o.swaps || !o.swaps.length) continue;
            if (o.frames > deadline) continue;
            var isChain = o.kind === 'chain';
            var cells = cellsSent(engine, o.kind, o.size, o.chain);
            // A BREAK IS AN ATTACK ON YOUR OWN BOARD. It sends nothing, and it is
            // still one of the best moves in the game: it holds the floor while the
            // slab comes apart, and it CONVERTS a garbage row into coloured panels.
            // Material is what chains are built out of, and breaking is the only
            // source of it once the opponent starts sending -- raising is the only
            // other one, and that is unavailable under attack.
            //
            // Counted in the same units as the garbage it would otherwise send, so
            // one number ranks both: the frames it holds, divided by the frames a
            // panel of life is worth.
            if (o.breaks && perPanelFrames > 0) {
                cells += heldFrames(framesTable, 0, o.total, W) / perPanelFrames;
            }
            if (cells <= 0) continue;                       // sends nothing, holds nothing
            // The vector's taste for this shape, read off the same buckets the
            // features use, floored so it can only ever scale the rate down to a
            // tenth and never to nothing.
            var key = isChain
                ? 'chain' + (o.chain >= 5 ? '5plus' : Math.max(2, Math.min(4, o.chain)))
                : 'combo' + Math.max(4, Math.min(7, o.size));
            var taste = 1 + ((weights[key] || 0) / 100);
            if (taste < 0.1) taste = 0.1;
            var rate = (cells / Math.max(1, o.frames)) * taste;
            if (!best || rate > best.rate) {
                best = { rate: rate, cells: cells, frames: o.frames,
                         move: o.swaps[0], option: o };
            }
        }
        return best;
    }

    function bestPlan(list, clock, deadline, engine, toppedOut, framesPerRow, framesTable) {
        var best = null, all = list.now.concat(list.next), i;
        // ONE PANEL REMOVED IS framesPerRow / W FRAMES OF LIFE -- 18.7 at level 10.
        // Panels and stop time are the same currency and this is the exchange rate.
        var perPanel = (framesPerRow || 0) / W;
        for (i = 0; i < all.length; i++) {
            var o = all[i];
            if (!o.swaps || !o.swaps.length) continue;
            if (o.frames > deadline) continue;                 // cannot finish in time
            var isChain = o.kind === 'chain';
            var pays = BF.stopTimeOf(engine, isChain, isChain ? 0 : o.size,
                                     isChain ? o.chain : 0, toppedOut);
            // WHAT THE CLOCK GAINS, against the clock as it will be when the
            // move LANDS, because it drains while the cursor walks.
            var stopGain = Math.max(0, pays - Math.max(0, clock - o.frames));
            // AND THEN THE WHOLE HOLD, of which that is only one part. A break
            // holds the floor for as long as the slab takes to come apart and pays
            // no stop time at all, which is why digging looked worthless.
            var gain = heldFrames(framesTable, stopGain, o.total, o.breaks ? W : 0);
            // WHAT SURVIVAL ACTUALLY REQUIRES IS A CLEAR RATE OF 1.0, and ranking
            // by the stop-time gain alone cannot see it. Measured over three duels:
            // panels arriving 234, 147, 224 against panels cleared 225, 114, 195 --
            // rates of 0.96, 0.78 and 0.87, and the only board that survived was
            // the 0.96. The deficit is 9 to 33 panels a game, three to eight extra
            // clears. TWO THIRDS OF THE INFLOW IS GARBAGE, not the rising floor, so
            // the panels a move removes matter more than the freeze it buys.
            //
            // So the objective is frames of life bought per frame spent. A plan
            // clearing 18 panels is worth 337 frames before any stop time; the
            // deepest chain pays only 68. The panels were always the larger half and
            // the gain-only ranking was reading the smaller one.
            var bought = o.total * perPanel + gain;
            var rate = bought / Math.max(1, o.frames);
            if (!best || rate > best.rate || (rate === best.rate && o.frames < best.frames)) {
                best = { rate: rate, gain: gain, frames: o.frames, move: o.swaps[0], option: o };
            }
        }
        return best;
    }

    BitBot.prototype.decide = function () {
        var board = this._snapshot();
        var info = this.info(board);
        var pool = this.candidates(board, info);
        var base = pool.length ? pool[0].masks : bit.maskState(board.grid, board.blocks, W, board.height);
        var rev = this.revealPick(board);
        var mode = this.mode(info, pool, !!rev);
        this.decisions++;
        this.counts.byMode[mode.name] = (this.counts.byMode[mode.name] || 0) + 1;

        // THE MODE FILTERS, IT DOES NOT PICK. ATTACK and DEFEND drop hold:
        // there is something to cash, or idling is what kills us.
        // Whether survival is at stake, decided before the pool is filtered so the
        // payless rule knows when to stand aside.
        //
        // DEFEND AND ONLY DEFEND. An empty clock is not danger -- it is the normal
        // state of a board with room, true on almost every frame -- so exempting
        // on that made the rule stand aside always and changed nothing at all
        // (identical histograms over 990 decisions). DEFEND opens at two rows of
        // headroom, which is the measured threshold for survival actually being at
        // stake.
        var survivalNeeded = mode.name === 'DEFEND';
        var here = signature(base);
        // ONLY OPTIONS IT CAN ACTUALLY FINISH IN THE TIME IT HAS LEFT.
        //
        // Every candidate is already priced in frames -- travel.cost to the cell
        // plus the swap -- and the frames before this board is dead are arithmetic
        // off the engine's own health drain and rise rate. A move costing more
        // than that cannot be completed before the game ends, so it is not a move,
        // however well it scores. Measured on seed 101: the bot spent a 29-frame
        // freeze walking toward something 60 frames away and died holding the
        // cursor mid-walk.
        //
        // It almost never bites -- a walk is at most 64 frames and a healthy board
        // has hundreds -- which is the point: it bites exactly in the spiral, and
        // nowhere else.
        var deadline = framesToDeath(info, tallestOf(pool), info.framesPerRow);
        var allowed = [];
        for (var i = 0; i < pool.length; i++) {
            // HOLD IS NOT AN OPTION WHILE THE CLOCK IS BURNING.
            //
            // A freeze is a fixed number of frames in which the floor is held and
            // the board can be changed for free. Holding through one spends a
            // resource with a deadline and gets nothing for it. Measured after the
            // reaction was lifted for freezes: 339 decisions on seed 101 and 526
            // frozen frames on which the board did not change at all, because
            // BUILD kept hold in the pool and holding kept winning.
            //
            // Only on a SETTLED board. With panels in the air the right move is
            // often to let the cascade land, and that is not idling -- the board
            // is changing without the bot touching it.
            var wasting = info.stopTime > 0 && !this.inFlight();
            if (pool[i].kind === 'hold' && (mode.name !== 'BUILD' || wasting)) continue;
            // A PAYLESS CLEAR IS NOT PROGRESS, IT IS UNBUILDING.
            //
            // A bare three sends no garbage and earns no stop time -- the engine's
            // own tables say so -- and it spends the vertical structure a chain is
            // made of. Measured over 990 decisions: 5,176 of the options on offer
            // were size-three combos and a 3-chain appeared twice. The bot was
            // cashing threes constantly and then finding no chains, which is cause
            // and effect, not coincidence.
            //
            // So when nothing is at stake the weights may not spend a three. They
            // can still hold, raise, or play a swap that clears nothing -- which is
            // what building IS. Survival is exempt: a board that needs the clock
            // takes whatever buys it.
            if (this.refusePayless && !survivalNeeded && pool[i].kind === 'swap') {
                var pr2 = pool[i].resolved;
                // UNLESS IT BREAKS GARBAGE. A three that opens a slab is the one
                // payless clear worth playing: digging is progress even when the
                // clear itself pays nothing, and garbage is two thirds of what
                // arrives. modes.pays says the same about the old bot.
                if (pr2 && pr2.total > 0 && !pr2.brokeGarbage &&
                    cellsSent(PanelEngine(), pr2.chain >= 2 ? 'chain' : 'combo',
                              pr2.total, pr2.chain) <= 0) {
                    this.counts.refusedPayless++;
                    continue;
                }
            }
            if (pool[i].kind === 'swap' && (pool[i].moveFrames || 0) > deadline) {
                this.counts.refusedTooSlow++; continue;
            }
            // A MOVE THAT PUTS THE BOARD BACK WHERE IT WAS IS NOT A MOVE.
            //
            // The scoring is stateless, so if board X's best swap leads to Y and
            // Y's best swap leads back to X, the bot plays that pair forever. It
            // did: 56 of 76 decisions on seed 701 repeated the previous cell --
            // (2,5) thirteen times running -- and a swap of the same cell twice
            // is the identity, so ZERO matches were made in 1,093 frames while
            // the floor climbed into the ceiling, with a 6-chain on the board
            // throughout. ATTACK made it fatal by dropping hold, so the bot was
            // forced to act and the only thing it would do was undo.
            //
            // Exact, not a heuristic: the resulting board is compared cell for
            // cell against the boards recent decisions were made on. Hold is
            // exempt -- waiting is not a failure to progress, it is the thing
            // BUILD is for, and it is how the board legitimately stays put.
            if (this.refuseReturn && pool[i].kind === 'swap' && pool[i].masks) {
                var sig = signature(pool[i].masks);
                if (sig === here || this._seen.indexOf(sig) >= 0) { this.counts.refusedReturn++; continue; }
            }
            allowed.push(pool[i]);
        }
        if (!allowed.length) allowed = pool;

        this._seen.push(here);
        if (this._seen.length > 3) this._seen.shift();

        // DEFEND RANKS BY THE CLOCK, NOT BY THE WEIGHTS.
        //
        // The bot is always attacking -- the modes only change which shapes it
        // prefers -- with ONE exception: when survival is on the line it does
        // whatever survives, even against its own preferences. The weights score
        // board quality, and board quality is not what matters one frame from
        // death; the clock is. So among the moves that bank time, the MOST time
        // wins, and that is the whole of DEFEND.
        //
        // If nothing banks anything the ordinary ranking stands, because then no
        // move here is an escape and there is nothing for this to choose between.
        // Borrowed from modes.js, whose FORCED does exactly this.
        // SURVIVAL IS A PLAN THAT FINISHES IN TIME.
        //
        // Ranking single candidates could never express it: the move that saves
        // the position is often the SETUP, which clears nothing and rates zero on
        // any measure of what it does by itself. A plan is priced over both plies
        // by bitoptions, so the setup is paid for by the cash it leads to.
        //
        // One call for the whole decision, not one per candidate -- the plans are
        // a property of the position, not of the move being scored.
        // AN EMPTY CLOCK IS ALWAYS LOSING GROUND, whatever the headroom.
        //
        // The plan arithmetic was gated behind DEFEND, which opens at two rows --
        // so on a board with room it never ran and the weights decided instead.
        // Measured on one duel: 103 decisions were taken with the clock at zero,
        // 86 of them had a setup-then-cash plan worth 32 to 62 frames sitting on
        // the board, and 81 were in BUILD where that plan was never consulted.
        // That is the whole of the 455-to-873 frame gaps between payouts.
        //
        // While the clock runs the floor is held and there is time to build. While
        // it is empty the floor is advancing every frame, so keeping it supplied
        // comes first -- which is the constant supply this bot was asked for. The
        // plan still has to gain time and finish in time, so on a board with
        // nothing worth cashing this changes nothing.
        // WHEN TO START THE NEXT PLAN, AND WHY IT IS NOT "SO IT LANDS AS THE CLOCK
        // RUNS OUT".
        //
        // That refinement is the obvious one and it was tried. A plan costing
        // `frames` looks like it should be STARTED when `clock <= frames`, so the
        // cash lands exactly as the clock reaches zero -- no dead frames with the
        // floor moving, and maximum value, since the gain is
        // max(0, pays - max(0, clock - frames)) and a plan arriving at clock zero
        // has nothing left to beat.
        //
        // It measures WORSE: 4,593 frames against 5,040, payouts 92 against 100,
        // over the same six duels. Launching earlier wins continuity and loses
        // building time, and the building time is worth more -- every frame spent
        // walking toward a cash is a frame not spent assembling the bigger one.
        //
        // So the plan runs when the clock is EMPTY, which is the latest it can be
        // started, and the frames the floor moves during execution are the price.
        // Do not re-derive the earlier launch from the gain formula; the formula is
        // right and the trade it misses is the cost of not building.
        // ONE OPTION SWEEP FOR THE WHOLE DECISION. Survival and attack both read
        // it and it is the expensive call in here -- two sweeps a decision would
        // double the cost of every frame for an answer that cannot have changed.
        var options = null;
        // Spent once for the decision, so both halves search the same board at the
        // same depth and cannot disagree about what is on offer.
        var lookDepth = depthFor(mode.name, tallestOf(pool));
        var survival = null;
        if (mode.name === 'DEFEND' || !(info.stopTime > 0)) {
            // A PLAN IS EXECUTED, NOT RE-CHOSEN EVERY FRAME.
            //
            // Re-planning each decision and playing the first move of whatever
            // came back means starting plans and never finishing them: the setup
            // is played, the board changes, a different plan now looks best, and
            // its setup is played instead. The cash at the end of either one never
            // arrives. Measured as wild variance -- one seed reached 5,397 frames
            // and another 1,370, with 204 planned moves and the gaps between
            // payouts unchanged.
            //
            // So the remaining moves are held and played in order. The plan is
            // dropped the moment it stops being true: its next move must still be
            // legal, and the whole thing must still fit inside the frames left.
            // That is the arithmetic of "how many moves will it take, and will the
            // board still be there when they are done".
            if (this._plan && this._plan.moves.length) {
                var nx = this._plan.moves[0];
                var stillLegal = false;
                var ls = bit.legalSwapsOf(base);
                for (i = 0; i < ls.length; i++) {
                    if (ls[i][0] === nx[0] && ls[i][1] === nx[1]) { stillLegal = true; break; }
                }
                if (stillLegal && this._plan.frames <= deadline) {
                    survival = { move: nx, gain: this._plan.gain };
                    this._plan.moves = this._plan.moves.slice(1);
                    if (!this._plan.moves.length) this._plan = null;
                } else {
                    this._plan = null;
                    this.counts.planDropped++;
                }
            }
            if (!survival) {
                options = options || bitoptions.options(null, W, H, [info.cursorRow, info.cursorCol], lookDepth, base);
                var plan = bestPlan(options, info.stopTime || 0, deadline, PanelEngine(),
                                    !!info.toppedOut, info.framesPerRow, this.stack.frames);
                if (plan && plan.rate > 0) {
                    this._plan = { moves: plan.option.swaps.slice(1), frames: plan.frames, gain: plan.gain };
                    if (!this._plan.moves.length) this._plan = null;
                    survival = { move: plan.move, gain: plan.gain };
                }
            }
        } else if (this._plan) {
            this._plan = null;                    // clock running again: the plan is stale
        }

        // THE BEAM: pre-rank cheaply, then pay for the top few only.
        //
        // The cheap score is the two things that need no option sweep -- how much
        // the move clears, and how flat and low it leaves the board. Candidates the
        // survival objective will rank are exempt, because that objective is itself
        // cheap and DEFEND is the one place a wrong cut is fatal.
        if (this.beam > 0 && allowed.length > this.beam) {
            var perPanel2 = (info.framesPerRow || 0) / W;
            var scored = [];
            for (i = 0; i < allowed.length; i++) {
                var ac = allowed[i], arr = ac.resolved;
                var cheap = (arr && arr.total ? arr.total * perPanel2 : 0)
                          - tallestBoard(ac.masks) * 8
                          - (ac.moveFrames || 0) * 0.5;
                scored.push({ cand: ac, cheap: cheap });
            }
            scored.sort(function (x, y) { return y.cheap - x.cheap; });
            allowed = [];
            for (i = 0; i < scored.length && i < this.beam; i++) allowed.push(scored[i].cand);
        }

        var best = null, alive = 0;
        for (i = 0; i < allowed.length; i++) {
            var cand = allowed[i];
            // WHAT THE HORIZON IS: the frames before this bot decides again --
            // the walk to the move, then the reaction cooldown. A candidate has
            // to survive its own cost, which is why it is per candidate.
            var horizon = (cand.moveFrames || 0) + this.reaction;
            if (this.deadly(cand.masks, cand.resolved, info, horizon)) { this.counts.refusedDeadly++; continue; }
            alive++;
            var s = this.score(cand.masks, cand.moveFrames, cand.resolved, info);
            if (!best || s > best.score) best = { cand: cand, score: s };
        }
        // NOTHING SURVIVES: the position is lost either way, so the best-scoring
        // move is played rather than freezing. Counted, because a bot reaching
        // here often is a bot about to die and the count is the warning.
        if (!best) {
            this.counts.allDead++;
            for (i = 0; i < allowed.length; i++) {
                var s2 = this.score(allowed[i].masks, allowed[i].moveFrames,
                                    allowed[i].resolved, info);
                if (!best || s2 > best.score) best = { cand: allowed[i], score: s2 };
            }
        }

        // A REVEAL SWAP BEATS STANDING STILL, and only that. It is not ranked
        // against the settled candidates, because the two are not priced on the
        // same scale — so it is taken when the ordinary decision was to wait,
        // which is the case the window exists for.
        // TAKEN WHENEVER ONE EXISTS, because bestInWindow has ALREADY established
        // that it beats standing still -- it scores every reachable swap against
        // doing nothing and returns a swap only when one wins. Requiring the
        // settled decision to be `hold` too made this unreachable: ATTACK and
        // DEFEND drop hold from the pool, so the branch needed a mode that had
        // already been ruled out. Measured -- 4 windows over 9,510 frames of
        // duelling and 0 lineup swaps ever played, so the module the window
        // exists for had never once run in a game.
        // A PLAN THAT GAINS TIME AND FINISHES IN TIME BEATS THE WEIGHTS. The one
        // place preference is overruled, and it is overruled by arithmetic. Only
        // the FIRST move is played: by the next decision the board has moved, and
        // a plan committed to blind is a plan about a board that no longer exists.
        // ATTACKING IS NOT A PREFERENCE EITHER.
        //
        // Survival comes first -- a board about to die has nothing to attack with
        // -- and everything after that is an attack. The weights choose WHICH one
        // inside bestAttack; they cannot choose not to.
        //
        // Committed like a survival plan, and for the same measured reason:
        // re-choosing every frame plays the first move of a different plan each
        // time and never finishes any of them, which was worth LESS than having no
        // plans at all (2,521 frames against 2,892).
        if (!survival) {
            if (this._attack && this._attack.moves.length) {
                var an = this._attack.moves[0];
                var okNext = false, als = bit.legalSwapsOf(base);
                for (i = 0; i < als.length; i++) {
                    if (als[i][0] === an[0] && als[i][1] === an[1]) { okNext = true; break; }
                }
                if (okNext) {
                    this._attack.moves = this._attack.moves.slice(1);
                    if (!this._attack.moves.length) this._attack = null;
                    this.counts.attacked++;
                    return { kind: 'swap', move: an, mode: mode, alive: alive };
                }
                this._attack = null;
                this.counts.attackDropped++;
            }
            options = options || bitoptions.options(null, W, H, [info.cursorRow, info.cursorCol], lookDepth, base);
            var atk = bestAttack(options, this.weights, PanelEngine(), deadline,
                                 this.stack.frames, (info.framesPerRow || 0) / W);
            if (atk && atk.move) {
                this._attack = { moves: atk.option.swaps.slice(1) };
                if (!this._attack.moves.length) this._attack = null;
                this.counts.attacked++;
                this.counts.cellsPlanned += atk.cells;
                return { kind: 'swap', move: atk.move, mode: mode, alive: alive };
            }
        }

        // NOTHING TO PLAY WITH AND NOTHING COMING: PUT PANELS ON THE BOARD.
        //
        // A chain is built out of panels and an empty board has none. Material
        // arrives two ways: raising, and breaking a slab -- which converts a
        // garbage row into coloured panels. At the START there is no garbage,
        // because the opponent has not attacked yet, so raising is the only source
        // there is.
        //
        // NOTHING INCOMING IS THE CONDITION, not merely a thin board. An earlier
        // version raised whenever the board was thin, at any point in the game,
        // and it walked the stack up while under attack and died mid-build: 1
        // death, 510 cells and 7 big pieces became 2 deaths, 378 and 3. With
        // nothing queued against us the row costs nothing we need back.
        //
        // Survival has already had its turn above; this cannot preempt it.
        if (!survival && !info.incoming && tallestOf(pool) < WORKING_ROWS && this.canRaise()) {
            // ONLY IF IT DOES NOT KILL. canRaise() is the engine's own list of
            // refusals -- whether the raise is LEGAL -- and says nothing about
            // whether the board survives it. Returning here skipped the death
            // filter every other move faces, on the one move that pushes the stack
            // up on purpose. Under attack a raise is how the bot kills itself.
            var risenCand = null;
            for (i = 0; i < pool.length; i++) if (pool[i].kind === 'raise') risenCand = pool[i];
            if (risenCand && !this.deadly(risenCand.masks, risenCand.resolved, info, this.reaction)) {
                this.counts.raisedForMaterial++;
                return { kind: 'raise', mode: mode, alive: alive };
            }
            this.counts.refusedRaise++;
        }

        // A PLAN MOVE IS STILL A MOVE, so it faces the no-return rule like any
        // other. Returning early with it skipped that check and the bot went back
        // to oscillating -- 48 decisions on a board it had been on within the last
        // three, against the 8 the prediction gap accounts for. A plan that walks
        // the board in a circle is not a plan, it is the loop with extra steps.
        if (survival && survival.move) {
            var planSig = null;
            for (i = 0; i < pool.length; i++) {
                var pc = pool[i];
                if (pc.kind === 'swap' && pc.swap[0] === survival.move[0] &&
                    pc.swap[1] === survival.move[1] && pc.masks) { planSig = signature(pc.masks); break; }
            }
            if (this.refuseReturn && planSig && (planSig === here || this._seen.indexOf(planSig) >= 0)) {
                this._plan = null;
                this.counts.refusedReturn++;
                survival = null;
            } else {
                this.counts.planned++;
                return { kind: 'swap', move: survival.move, mode: mode, alive: alive };
            }
        }

        if (rev && rev.best && rev.best.swap) {
            this.counts.revealSwaps++;
            return { kind: 'swap', move: rev.best.swap, mode: mode, alive: alive, reveal: true };
        }
        if (!best) return { kind: 'hold', mode: mode, alive: alive };
        return { kind: best.cand.kind, move: best.cand.swap, mode: mode, alive: alive };
    };

    // One call per frame from the match loop, the same shape PuyoCpu has.
    BitBot.prototype.update = function () {
        var stack = this.stack;
        if (stack.gameOver) { this.spend.gameOver++; return; }
        var froz = (stack.stopTime || 0) > 0;
        var input = {};

        // ONE RAISE IS ONE ROW. The engine re-latches manualRaise on every frame
        // the input is held while preventManualRaise is clear, so a fixed hold
        // serves two or three rows for one decision. Released the frame the
        // engine HANDS THE RAISE OFF, which always sets preventManualRaise.
        if (this.raiseFrames > 0) {
            if (stack.manualRaise) this._raiseStarted = true;
            if (stack.preventManualRaise || (this._raiseStarted && !stack.manualRaise)) this.raiseFrames = 0;
            else { this.raiseFrames--; input.raise = true; }
        }

        // A committed move owns the frame — the cursor has to get there.
        if (this._walk) {
            this.spend.walking++; if (froz) this.frozen.walking++;
            this._driveWalk(input); stack.setInput(input); return;
        }
        stack.setInput(input);
        // THE COOLDOWN DOES NOT GET TO SLEEP THROUGH A REVEAL WINDOW. The window
        // is 21 frames and the bot decides every 12, so on cooldown it misses
        // most of them -- and a window missed is information that arrived and went
        // unused, which is the whole thing bitlineup was built for. The reaction
        // still applies everywhere else: this does not make the bot faster in
        // general, it makes it awake for the one situation that is over before the
        // next decision would have come round.
        // FROZEN TIME IS FREE TIME, AND IT WAS BEING THROWN AWAY.
        //
        // Read off seed 101, the last 30 frames of a duel: topped out, 29 frames
        // of stop time on the clock, and the board IDENTICAL on every one of
        // them -- 31 panels and 23 garbage cells, unchanged -- until the clock hit
        // 0 and health with it. The one thing stop time is FOR is acting while
        // the floor is held, and the bot sat through all of it.
        //
        // The arithmetic: at reaction 12, a 29-frame freeze buys two decisions,
        // and a walk can cost 60. So the reaction has to lift while the clock is
        // running or while topped out -- the two states where an idle frame is a
        // frame of life spent for nothing. Everywhere else it still applies.
        var urgent = (stack.stopTime || 0) > 0 ||
                     (typeof stack.isToppedOut === 'function' && stack.isToppedOut());
        if (this.cooldown > 0) {
            if (!urgent && !(this.reveal && this.windowOpen())) {
                this.spend.cooling++; if (froz) this.frozen.cooling++;
                this.cooldown--; return;
            }
            this.cooldown = 0;
        }

        this.spend.decided++;
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
            return;
        }
        this.counts.swaps++;
        if (froz) this.frozen.swap++;
        this._beginWalk(d.move[0], d.move[1], this.reaction);
        this._driveWalk(input);
        stack.setInput(input);
    };

    // Exposed so a test can ask what the bot considers "the same position" rather
    // than reimplementing it -- two implementations of a sameness rule is how a
    // test ends up agreeing with itself.
    BitBot.signatureOf = signature;
    BitBot.STARTER = STARTER;
    return BitBot;
}));
