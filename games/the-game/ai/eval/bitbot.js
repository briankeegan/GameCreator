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
                                 require('./bitlineup.js'), require('./travel.js'));
    } else {
        root.BitBot = factory(root.BitMatch, root.BitFeatures, root.BitLineup,
                              root.PanelEval.travel);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (bit, BF, lineup, travel) {
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
            if (pool[i].kind !== 'hold') continue;
            var st = bit.maskState(pool[i].board.grid, pool[i].board.blocks, W, H);
            var t = 0;
            for (var c = 1; c <= W; c++) {
                var n = 0, o = st.occ[c];
                while (o) { o &= o - 1; n++; }
                if (n > t) t = n;
            }
            return t;
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

    // THE BOARD AS A STRING, so "have we been here" is an exact question and
    // not a similarity score. Only the settled colours matter: two boards with
    // the same panels in the same cells are the same position to swap from.
    function signature(board) {
        var out = [], r, c;
        for (r = 1; r <= board.height; r++) {
            var row = board.grid[r];
            if (!row) { out.push(''); continue; }
            var line = '';
            for (c = 1; c <= W; c++) line += (row[c] === undefined ? -1 : row[c]) + ',';
            out.push(line);
        }
        return out.join('|');
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
        this.horizonDeath = opts.horizonDeath !== false;
        // The boards recent decisions were made on. Three, because a swap is an
        // involution -- it can only walk back one step at a time -- and a
        // longer memory starts refusing legitimate revisits of a position the
        // rising stack has genuinely changed.
        this._seen = [];

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
                        refusedReturn: 0, defendByClock: 0, refusedTooSlow: 0,
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
    BitBot.prototype.deadly = function (board, resolved, info, horizon) {
        var st = bit.maskState(board.grid, board.blocks, W, board.height);
        var tallest = 0;
        for (var c = 1; c <= W; c++) {
            var n = 0, o = st.occ[c];
            while (o) { o &= o - 1; n++; }
            if (n > tallest) tallest = n;
        }
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
        if (tallest + rows < board.height) return false;       // room left: not dead
        return banked <= 0;                                    // full, nothing holding it
    };

    BitBot.prototype.score = function (board, moveFrames, resolved, info) {
        var out = BF.features(board, [info.cursorRow, info.cursorCol], moveFrames,
                             resolved, info, PanelEngine());
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

    function summarise(res) {
        var total = 0, biggest = 0;
        for (var i = 0; i < res.comboSizes.length; i++) {
            total += res.comboSizes[i];
            if (res.comboSizes[i] > biggest) biggest = res.comboSizes[i];
        }
        return { chain: res.chainLength || 0, total: total, biggest: biggest,
                 brokeGarbage: res.brokeGarbage || 0 };
    }

    // THE POOL: hold, raise, every legal swap, and during a reveal window the
    // lineup swaps as well. Hold is always built — that is what waiting is, and
    // without it the bot cannot build — but a mode may filter it out.
    BitBot.prototype.candidates = function (board, info) {
        var out = [], i;

        out.push({ kind: 'hold', swap: null, board: board, moveFrames: 0, resolved: null });

        // A raise is scored like a swap, on the board it leaves. Not a feature:
        // if it opens options nextWays rises, if it is dangerous tallest rises,
        // if it wastes the clock stopReachable falls.
        //
        // THE RAISE SPENDS THE KNOWN ROW AND NO MORE. The row behind it comes
        // from the match rng, which nothing here reads, so `incoming = false`
        // says unknown rather than copying the visible row into its place and
        // inventing matches the game will not deal.
        if (this.canRaise() && board.rise) {
            var risen = board.clone().rise(board.incoming);
            risen.incoming = false;
            out.push({ kind: 'raise', swap: null, board: risen, moveFrames: 0,
                       resolved: summarise(risen.resolve()) });
        }

        var swaps = board.legalSwaps();
        for (i = 0; i < swaps.length; i++) {
            var b = board.clone();
            b.swap(swaps[i][0], swaps[i][1]);
            var res = b.resolve();
            out.push({ kind: 'swap', swap: swaps[i], board: b,
                       moveFrames: travel.cost(info.cursorRow, info.cursorCol,
                                               swaps[i][0], swaps[i][1]),
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

    // The tallest column of any board, from the masks.
    function tallestBoard(board) {
        var st = bit.maskState(board.grid, board.blocks, W, board.height || H);
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

    BitBot.prototype.decide = function () {
        var board = this._snapshot();
        var info = this.info(board);
        var pool = this.candidates(board, info);
        var rev = this.revealPick(board);
        var mode = this.mode(info, pool, !!rev);
        this.decisions++;
        this.counts.byMode[mode.name] = (this.counts.byMode[mode.name] || 0) + 1;

        // THE MODE FILTERS, IT DOES NOT PICK. ATTACK and DEFEND drop hold:
        // there is something to cash, or idling is what kills us.
        var here = signature(board);
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
            if (this.refuseReturn && pool[i].kind === 'swap' && pool[i].board) {
                var sig = signature(pool[i].board);
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
        // SURVIVAL IS ONE NUMBER, AND IT IS THE ONE TO MAXIMISE.
        //
        // Every patch before this was a symptom. The quantity that actually
        // matters is how long the position you end up in can live, counting what
        // it cost to get there:
        //
        //     clockAfter = max( max(0, S - cost), P )
        //     value      = cost + framesToDeath(tallestAfter, clockAfter)
        //
        // S is the clock now, cost the frames to play the move, P what its clear
        // pays. The inner max is awardStopTime being a MAX, applied to the clock
        // as it will be WHEN THE MOVE LANDS rather than as it is now -- the clock
        // drains while the cursor walks.
        //
        // This subsumes the lot. A big payout too far away scores badly because
        // max(0, S - cost) has gone to zero by the time it arrives. A clear that
        // pays NOTHING but lowers the stack still scores, because tallestAfter
        // falls and rows free are frames. Ranking by the payout alone could see
        // neither, which is why the bot spent a 29-frame freeze walking 60 frames
        // and why digging 23 garbage cells was never worth anything to it.
        //
        // Only in DEFEND. Everywhere else the weights decide, which is the plan:
        // the modes change which shapes it prefers, and survival is the one place
        // that preference is overruled.
        var survival = null;
        if (mode.name === 'DEFEND') {
            survival = [];
            var S = info.stopTime || 0;
            for (i = 0; i < allowed.length; i++) {
                var cd = allowed[i], cost = cd.moveFrames || 0;
                var rr = cd.resolved, P = 0;
                if (rr && rr.total > 0) {
                    var ch = rr.chain >= 2;
                    P = BF.stopTimeOf(PanelEngine(), ch, ch ? 0 : rr.total,
                                      ch ? rr.chain : 0, !!info.toppedOut);
                }
                var clockAfter = Math.max(Math.max(0, S - cost), P);
                var tAfter = tallestBoard(cd.board);
                var after = { stopTime: clockAfter, health: info.health,
                              toppedOut: tAfter >= (cd.board.height || H) };
                survival.push({ cand: cd,
                                value: cost + framesToDeath(after, tAfter, info.framesPerRow) });
            }
        }

        var best = null, alive = 0;
        for (i = 0; i < allowed.length; i++) {
            var cand = allowed[i];
            // WHAT THE HORIZON IS: the frames before this bot decides again --
            // the walk to the move, then the reaction cooldown. A candidate has
            // to survive its own cost, which is why it is per candidate.
            var horizon = (cand.moveFrames || 0) + this.reaction;
            if (this.deadly(cand.board, cand.resolved, info, horizon)) { this.counts.refusedDeadly++; continue; }
            alive++;
            // In DEFEND, a move that banks time is ranked by the time it banks
            // and beats every move that banks none.
            var s;
            if (survival) {
                s = 0;
                for (var q = 0; q < survival.length; q++) if (survival[q].cand === cand) s = survival[q].value;
                this.counts.defendByClock++;
            } else {
                s = this.score(cand.board, cand.moveFrames, cand.resolved, info);
            }
            if (!best || s > best.score) best = { cand: cand, score: s };
        }
        // NOTHING SURVIVES: the position is lost either way, so the best-scoring
        // move is played rather than freezing. Counted, because a bot reaching
        // here often is a bot about to die and the count is the warning.
        if (!best) {
            this.counts.allDead++;
            for (i = 0; i < allowed.length; i++) {
                var s2 = this.score(allowed[i].board, allowed[i].moveFrames,
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

    BitBot.STARTER = STARTER;
    return BitBot;
}));
