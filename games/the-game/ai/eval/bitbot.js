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
        // A CEILING ON HOW DEEP TO LOOK. depthFor spends rows of headroom, and a
        // cap lets a run ask what the depth is actually worth -- measured in live
        // duels rather than on static boards, because a board in play is fuller
        // than a quiet one and offers more swaps a ply.
        // FOUR, BECAUSE PRUNING CHANGED THE ANSWER.
        //
        // Unpruned, deeper measured WORSE -- 8,000-frame duels on two seeds:
        //
        //     depth 2     9s wall    sent 71
        //     depth 3    20s wall    sent 47
        //     depth 4    57s wall    sent 30
        //
        // That was the search drowning in setups that could not lead anywhere.
        // With bit.reachMask pruning the deeper plies to cells that could complete
        // a pair, the same duels give:
        //
        //     depth 2     7s wall    sent  90
        //     depth 3     5s wall    sent  48
        //     depth 4    17s wall    sent 101, and the only big pieces
        //
        // So depth is worth having and the naive expansion was what made it look
        // like it was not: 3.4x cheaper than before and now the best attacker.
        // Two seeds, so this is a direction and not a calibration.
        this.maxDepth = opts.maxDepth === undefined ? 20 : opts.maxDepth;
        this.horizonDeath = opts.horizonDeath !== false;
        // The boards recent decisions were made on. Three, because a swap is an
        // involution -- it can only walk back one step at a time -- and a
        // longer memory starts refusing legitimate revisits of a position the
        // rising stack has genuinely changed.
        this._seen = [];
        // The plan being executed, if any. See the commitment note in decide().
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
                        raisedForMaterial: 0, refusedRaise: 0, waitedToRaise: 0,
                        openingRaises: 0, openingWaits: 0, saveKept: 0, saveUnkeepable: 0, savePlanned: 0, heldTheBreak: 0, forcedBreak: 0, forcedBoth: 0, refusedEarly: 0,
                        raises: 0, holds: 0, swaps: 0, revealSwaps: 0,
                        revealWindows: 0, digging: 0, flattened: 0, flattenDropped: 0,
                        refusedStranded: 0, refusedNoFailsafe: 0 };
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
            // THE ENGINE'S OWN DANGER SIGNAL, not a reimplementation of it.
            // fillRatio is what the renderer paints the danger state from and what
            // the reference CPU panics on: the highest occupied row over the board
            // height. For the LIVE board there is no reason to derive it again.
            fillRatio: typeof s.fillRatio === 'function' ? s.fillRatio() : 0,
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
    BitBot.prototype.mode = function (info, pool, revealOpen, deadline, escape) {
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
        // DEFENCE TIMING IS ARITHMETIC, NOT A ROW COUNT.
        //
        // The question is not "is the board tall" -- height is fine, and a tall
        // board is where chains come from. It is whether the escape can still be
        // reached before the floor arrives:
        //
        //     framesToDeath  <=  frames to play the cheapest plan that survives
        //
        // Both sides are measured. framesToDeath is the engine's own drain and
        // rise; the plan's cost is travel.cost over its moves. Below that line
        // there is no longer time to choose, so the weights stop choosing.
        //
        // `escape` is null when the caller has no plan to offer, and then there is
        // nothing to be late for: topped out still opens DEFEND above.
        else if (escape !== null && escape !== undefined &&
                 deadline <= escape + this.reaction) name = 'DEFEND';
        else {
            // THE BAR IS THE ENGINE'S TABLE, NOT A WEIGHT.
            //
            // This asked aim(), which reads the weights: whichever chain or combo
            // weight is highest sets the shape that counts as worth cashing. A
            // vector whose top chain weight is chain5plus therefore only enters
            // ATTACK when a 5-chain exists -- the vector deciding WHETHER to
            // attack, not which shape to build.
            //
            // Measured on seed 103: STARTER cashes 708 times and survives 30000
            // frames; a random vector cashes FOUR times in the whole game and dies
            // at 10163. It never sends, so it is never un-buried, so nothing
            // clears, and its last twelve decisions are setups at tallest 12.
            //
            // A shape is worth cashing when it sends cells, which comboGarbage
            // already answers: a 4-combo sends 3, a 6-chain sends 30, a bare three
            // sends nothing. Every vector now attacks on the same trigger and
            // chooses only among the shapes that pay.
            for (var i = 0; i < pool.length; i++) {
                var r = pool[i].resolved;
                if (!r || !r.total) continue;
                if (cellsSent(PanelEngine(), r.chain >= 2 ? 'chain' : 'combo',
                              r.total, r.chain) > 0) { name = 'ATTACK'; break; }
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
    // HOW MUCH THIS BOARD CAN STILL BE MATCHED ON.
    //
    // reachMask marks every cell that would complete a vertical or horizontal
    // pair, so its popcount is how many ways a clear can still be made. A board
    // with none has no clear at any depth and dies whatever the clock says.
    //
    // This is the number a SETUP moves. Seed 104 spent eight decisions holding at
    // tallest 8 with 202 frames in hand and no clear anywhere -- the moment to
    // build one -- because nothing in the bot could tell a swap that improves the
    // board from a swap that does nothing. bitoptions only names a setup when a
    // cash follows it inside the search depth; with nothing to aim at it is
    // silent, and that is exactly when the board most needs arranging.
    // MATERIAL, IN FLAT ROWS: non-garbage panels over the width.
    //
    // GARBAGE DOES NOT COUNT. A slab is inert until something breaks it, and
    // breaking needs panels beside it -- so a board can be twelve rows tall and
    // have nothing to play with. Seed 101 died under seven rows of garbage
    // holding eighteen panels, two of them in the row beneath the slab.
    function materialRows(st) {
        var n = 0;
        for (var c = 1; c <= W; c++) n += bit.popcount((st.occ[c] & ~st.garb[c]) >>> 0);
        return n / W;
    }

    // HOW UNEVEN THE STACK IS: the total step between neighbouring columns.
    //
    // A tower is where it dies -- one column reaches the ceiling while the rest of
    // the board still has room, and the game ends with half the board empty. It is
    // never a reason to choose a worse move, but between two moves worth the same
    // the flatter board is strictly better: more columns in reach of the cursor,
    // no panel stranded on top of a spike, and a slab that lands sits level
    // instead of bridging a gap.
    // HOW UNEVENLY THE MATERIAL IS SPREAD, counted in PANELS PER COLUMN and not
    // in column heights.
    //
    // Height is the wrong ruler on a buried board. Garbage caps every column at
    // the same row, so six columns holding 6, 1, 1, 2, 2, 2 panels under a slab
    // all measure the same height and the board reads as flat while one column
    // hoards the material and the rest have nothing to build with. Panels per
    // column sees that; height cannot.
    //
    // Garbage is excluded for the same reason it is excluded from materialRows:
    // a slab is not material, and the bot cannot move it.
    function bumpiness(st) {
        var h = [], c, n = 0;
        for (c = 1; c <= W; c++) {
            // Only the pocket under the lowest slab: a slab splits the board and
            // panels above one cannot be spread into the surface below it.
            var g = st.garb[c] >>> 0;
            var floor = g ? (g & -g) : 0;
            var below = floor ? (floor - 1) : 0xffffffff;
            h[c] = bit.popcount((st.occ[c] & ~g & below) >>> 0);
        }
        for (c = 1; c < W; c++) n += Math.abs(h[c] - h[c + 1]);
        return n;
    }

    function matchWays(st) {
        // PAIRS, NOT MATCHES. reachMask marks every cell that would complete an
        // adjacent same-colour pair, so its popcount is how much the board can
        // still be built on.
        //
        // Counting the swaps that actually clear right now was tried and is the
        // worst thing measured all day -- 8 deaths in 8. Maximising it maximises
        // structure about to be SPENT: a board covered in ready triples has no
        // vertical structure left, because every pair is one swap from being
        // cashed and gone. A pair is a chain waiting to happen; a match is a chain
        // about to stop existing.
        //
        // Restricting the mask to reachable cells was also worse, in both
        // directions -- above the stack (6 deaths) and level with it (5). The
        // unreachable pairs still count because the board moves: the floor rises
        // under them and a slab above them breaks.
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

    // A MOVE THAT LEAVES NOWHERE TO GO IS DEADLY, whatever the horizon says.
    //
    // deadly() asks one question: is there room for the rows that land before the
    // bot acts again. A position that is lost in TWO rows passes it cleanly, and
    // that is how every death in the tournament looks -- eight healthy options at
    // tallest 10, then one row lands and `alive` is 0. The mistake was made
    // several decisions earlier and nothing reported it.
    //
    // So a candidate has to leave a board that still has a move: at least one
    // legal swap whose own result survives its own row. One more ply, applied to
    // every candidate, which is what turns "would die now" into "would be
    // stranded".
    //
    // THE CONTINUATION IS JUDGED ON THE SAME HORIZON, not a deeper one. Asking it
    // to survive an EXTRA row means asking a board at tallest 10 to survive to
    // 12, which is the ceiling, so every continuation read as fatal and every
    // candidate was refused: `alive` was 0 from tallest 10 upward and the bot fell
    // through to the fallback ranking for the rest of the game.
    //
    // The caller keeps its fallback: when nothing passes, the best-scoring move is
    // played anyway. This narrows the choice, it never refuses to move.
    // AND WHETHER THERE IS STILL A THREE IN HAND.
    //
    // The same pass answers both. A clear that can be fired the instant something
    // lands is the only thing that buys stop time on demand, and a board with
    // none has to build one first -- which is time it does not have when a slab
    // arrives. So the sweep reports whether any legal swap on this board clears
    // anything, and the caller keeps one.
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

    // A TOWER IS WHERE THE BOARD DIES, so how much it minds one is not the
    // vector's to choose. Death is the tallest column reaching the ceiling while
    // the material is spread over all six, so an uneven board is holding rows of
    // life it is not using. A vector that zeroes or reverses these two is a
    // vector choosing to die, and that is not what the weights are for: they say
    // how much MORE than this to care, never less.
    //
    // The numbers are STARTER's own, so the starting vector is unchanged and only
    // the ones that went tower-friendly are clamped.
    var FLOOR = { bumpiness: -20, tallest: -40 };

    BitBot.prototype.score = function (st, moveFrames, resolved, info) {
        var out = BF.features(null, [info.cursorRow, info.cursorCol], moveFrames,
                             resolved, info, PanelEngine(), st);
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

    // Can the engine act on a raise at all. Every clause is one the engine
    // itself checks; a raise it refuses is not a move, and offering one means
    // scoring a board that never arrives.
    // A RAISE IS HELD FOR, NOT ASKED FOR ONCE.
    //
    // riseLock is set while a swap is queued or panels are still in motion, which
    // for this bot is nearly every frame -- it swaps almost every decision. Asking
    // "can I raise THIS INSTANT" therefore answers no almost always: measured over
    // a duel, 2,402 of the 2,723 decisions taken under four rows of material were
    // refused on riseLock alone, and the board starved to eight panels with nine
    // rows of headroom going spare.
    //
    // A player does not ask once, they hold the button and the engine grants the
    // row when the lock clears. update() already holds it for twenty frames, so
    // the decision only has to say whether raising is WRONG, not whether it is
    // possible this instant.
    //
    // These are the refusals that do not clear on their own: already raising, the
    // engine refusing manual raises outright, topped out, or garbage still
    // falling. riseLock, panels in motion and shake time all pass, because holding
    // is exactly how those are waited out.
    BitBot.prototype.canRaise = function () {
        if (!this.allowRaise) return false;
        // ONE RAISE AT A TIME. update() holds the input for twenty frames and the
        // engine re-grants a row on every frame it is held, so one decision buys
        // two or three rows. Re-arming the hold on the next decision holds it
        // forever and walks the stack into the ceiling.
        if (this.raiseFrames > 0) return false;
        var s = this.stack;
        if (s.preventManualRaise || s.manualRaise) return false;
        if (typeof s.isToppedOut === 'function' && s.isToppedOut()) return false;
        if (typeof s.hasFallingGarbage === 'function' && s.hasFallingGarbage()) return false;
        // AND NOT WHILE THE ENGINE IS BUSY. riseLock is set while a swap is queued
        // or panels are still in motion, and a raise asked for then is not a move
        // the engine will take. It clears on its own; the answer is to do
        // something else this decision, not to hold the button through it.
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
            var rmasks = rres.settled || rst;
            var rres2 = summarise(rres);
            // AND ONLY IF THE BOARD SURVIVES IT.
            //
            // canRaise() is the ENGINE's list of refusals and says nothing about
            // whether the row kills. A raise that tops the board out is not an
            // option any more than an illegal swap is, so it does not go in the
            // pool -- otherwise every path that reads the pool can pick one and
            // only the branch that happens to re-check is safe.
            //
            // Every queued cell lands, so it counts toward the height, and the
            // risen board faces the death filter over a full row of rise like any
            // other candidate.
            var inRows = Math.ceil((info.incoming || 0) / W);
            if (tallestBoard(rmasks) + inRows < H &&
                !this.deadly(rmasks, rres2, info,
                             Math.max(this.reaction, info.framesPerRow || 0))) {
                out.push({ kind: 'raise', swap: null,
                           board: null,
                           masks: rmasks,
                           moveFrames: 0, resolved: rres2 });
            }
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

    // THE TOPMOST OCCUPIED ROW, WHICH IS NOT A POPCOUNT.
    //
    // A popcount counts the cells in a column. That equals the height only while
    // the column is a PACKED RUN from the floor, and garbage breaks that: a slab
    // BRIDGES the columns it spans, so cells sit above holes and the top row runs
    // ahead of the count.
    //
    // This read the popcount, and every height decision in the bot understated the
    // danger by exactly the number of holes -- worst when the board is full of
    // garbage, which is precisely when it matters. Seed 103 died with its top row
    // at 11 while this reported 9, so framesToDeath thought there was room that was
    // not there, DEFEND fired twice in 1,154 decisions and the death filter agreed.
    // It stood at the ceiling refusing to clear and was eaten.
    //
    // The highest set bit, then. 32 - clz32 gives the 1-based row of the top cell.
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
    // HOW DEEP THERE IS TIME TO SEARCH, off the engine rather than off the mode.
    //
    // A plan of d moves cannot be PLAYED in under d reaction cooldowns: the bot
    // issues one swap, waits out `reaction`, then issues the next. So searching
    // past `deadline / reaction` plies is searching for plans the board will not
    // be there for.
    //
    // That replaces an arm keyed on the mode name reading DEFEND. The mode is
    // downstream of this number now -- it is chosen from the timing -- so keying
    // the depth on it would be circular, and the cooldown says the same thing
    // without the constant.
    // WHAT AN ACTION IS WORTH, from the engine's garbage table and nothing else.
    // Lower is better.
    //
    //   0  sends and breaks -- attacks and digs in one move
    //   1  sends
    //   2  breaks but sends nothing -- a three into a slab, the last resort: it
    //      pays no cells and spends the vertical structure a chain is made of,
    //      but it turns an inert slab back into panels
    //   3  clears nothing: building, holding, raising
    //   4  clears something and neither sends nor breaks -- not an action at all
    function tierOf(cand) {
        var r = cand.resolved;
        if (!r || !r.total) return 3;
        var cells = cellsSent(PanelEngine(), r.chain >= 2 ? 'chain' : 'combo', r.total, r.chain);
        if (cells > 0) return r.brokeGarbage ? 0 : 1;
        return r.brokeGarbage ? 2 : 4;
    }

    function depthFor(deadline, reaction, tallest) {
        var playable = Math.max(1, Math.floor(deadline / Math.max(1, reaction)));
        // THE DEADLINE SETS THE DEPTH. The constant here capped the search at four
        // plies -- about 80 frames of play against a deadline of several hundred.
        // It was holding back an explosion that no longer exists: bitoptions beams
        // across the ply rather than per node, so cost is BEAM * branching * depth
        // and depth 20 measures the same as depth 4, 0.27ms a frame.
        return playable;
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
    // A BARE THREE IS THE ONE MOVE A SHORT BOARD CANNOT AFFORD.
    //
    // It sends nothing, breaks nothing and spends three of the panels a chain
    // would have been built from. A break is always allowed, at any material
    // level, and a break behind a combo or a chain is better still; combos and
    // chains are always allowed because they send. Only the bare three is
    // refused, and only below the working minimum.
    //
    // The pool filter says this already, but it narrows `allowed` and this reads
    // `options`, so attacking walked past it: on seed 101 the board sat between
    // half a row and one and a half rows of material for three thousand frames
    // firing threes off six panels, and a 31-cell slab landed on nothing.
    function bestAttack(list, weights, engine, deadline, framesTable, perPanelFrames) {
        var best = null, all = list.now.concat(list.next), i;
        for (i = 0; i < all.length; i++) {
            var o = all[i];
            if (!o.swaps || !o.swaps.length) continue;
            if ((o.duration || o.frames) > deadline) continue;
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
                cells += heldFrames(framesTable, 0, o.total, o.garbage || W) / perPanelFrames;
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
            var rate = (cells / Math.max(1, o.duration || o.frames)) * taste;
            // AN ATTACK THAT ALSO FLATTENS IS THE BETTER ATTACK. Between two
            // sending at the same rate, the one leaving the flatter board -- it
            // costs nothing to prefer and a tower is where the board dies.
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

    function bestPlan(list, clock, deadline, engine, toppedOut, framesPerRow, framesTable, tallNow) {
        var best = null, over = null, all = list.now.concat(list.next), i;
        // ONE PANEL REMOVED IS framesPerRow / W FRAMES OF LIFE -- 18.7 at level 10.
        // Panels and stop time are the same currency and this is the exchange rate.
        var perPanel = (framesPerRow || 0) / W;
        for (i = 0; i < all.length; i++) {
            var o = all[i];
            if (!o.swaps || !o.swaps.length) continue;
            // CAN IT BE FINISHED IN THE TIME THERE IS. The duration, not the walk:
            // the swap, the cooldown when one applies, and the frames the board is
            // busy resolving the cash at the end of it.
            var took = o.duration || o.frames;
            // A PLAN THAT DOES NOT FIT IS STILL THE ANSWER IF NOTHING DOES.
            //
            // Honest durations mean plans genuinely run past the deadline, and
            // returning nothing then hands the board to the weights -- which is
            // how a vector ends up choosing a death. There is no board on which
            // the right answer is "no opinion": if nothing fits, the best of what
            // does not fit is what the bot plays, ranked by the same objective.
            var fits = took <= deadline;
            var isChain = o.kind === 'chain';
            var pays = BF.stopTimeOf(engine, isChain, isChain ? 0 : o.size,
                                     isChain ? o.chain : 0, toppedOut);
            // WHAT THE CLOCK GAINS, against the clock as it will be when the
            // move LANDS, because it drains while the cursor walks.
            var stopGain = Math.max(0, pays - Math.max(0, clock - took));
            // AND THEN THE WHOLE HOLD, of which that is only one part. A break
            // holds the floor for as long as the slab takes to come apart and pays
            // no stop time at all, which is why digging looked worthless.
            // The real count, not W as a stand-in: the slab the match touches is
            // what sets the resolve, and the resolver reports it now.
            var gain = heldFrames(framesTable, stopGain, o.total,
                                  o.garbage || (o.breaks ? W : 0));
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
            // AND THE CELLS A BREAK RETURNS TO THE BOARD, WHICH ARE WORTH FAR
            // MORE THAN ONE CLEAR EACH.
            //
            // THIS IS NOT A PREFERENCE FOR DIGGING. A cleared panel buys perPanel
            // frames ONCE. A garbage cell is a cell of board that can never be
            // freed, so it costs perPanel EVERY TIME the board would have cycled
            // through it -- for the whole of the rest of the game. Converting it
            // hands all of that back.
            //
            // The rest of the game, in rows, is deadline / framesPerRow, so a
            // converted cell is worth perPanel * that, which is deadline / W.
            // Nothing is chosen here: it is the same exchange rate as a clear,
            // multiplied by the number of times the board still gets to use the
            // cell. It falls to one clear's worth as the deadline runs out, which
            // is right -- one frame from death the immediate clear is the only
            // thing that matters.
            //
            // Priced at one clear instead, a break stopped winning and rand2 went
            // from 0 deaths in 4 to 3, converting 83% of the garbage that landed
            // against 98%.
            var perCell = Math.max(perPanel, (deadline || 0) / W);
            // AND THE CEILING IT GIVES BACK. Death comes at the TALLEST column, so
            // the rows a clear takes off the top of the board are frames of life in
            // the plainest sense -- one row is framesPerRow. The same clear taken
            // off a short column gives none of them back, which is the difference
            // between a move that works and a move that works AND flattens.
            var lowered = (tallNow && o.tall !== null && o.tall !== undefined)
                        ? Math.max(0, tallNow - o.tall) : 0;
            // WHAT SPENDING THE PANELS COSTS, which is nothing until the board
            // cannot afford it.
            //
            // A cleared panel buys perPanel frames once, and that is already
            // counted above. Left on the board it would have bought the same
            // later, so spending it early is free -- UNTIL the board drops below
            // the material it needs to make any clear at all. Under that floor
            // the panels have to be put back, and the only way to put them back
            // is a row of rise: framesPerRow per row short.
            //
            // This is what makes a bare three a bad move on a healthy board and
            // the right move on a dying one. It sends nothing and breaks nothing,
            // so all it has is the panels it removes -- and when the board is
            // short, removing them costs more than they buy. Banning it outright
            // instead died at 6,936 frames where the engine's own arithmetic
            // survives, because a three is genuinely the move when nothing else
            // is there.
            var shortfall = (o.mat === null || o.mat === undefined)
                          ? 0 : Math.max(0, WORKING_ROWS - o.mat);
            var bought = o.total * perPanel + (o.garbage || 0) * perCell
                       + lowered * (framesPerRow || 0) + gain
                       - shortfall * (framesPerRow || 0);
            var rate = bought / Math.max(1, took);
            var cur = fits ? best : over;
            // Between two plans buying life at the same rate, the one leaving the
            // flatter board; between two of those, the cheaper.
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
        // The best that fits, or if nothing fits, the best there is.
        return best || over;
    }

    // WHAT A MOVE COSTS AT THIS MOMENT, which is not a constant.
    //
    // The reaction cooldown is skipped whenever stop time is running or the board
    // is topped out -- see `urgent` in update() -- so an action inside a freeze
    // costs the swap alone and one outside it also pays the reaction. Measured at
    // 2.8 frames an action while frozen against 17 outside.
    //
    // The resolve time is the engine's own preStop and depends on the match, so
    // it is a function rather than a number.
    BitBot.prototype.timing = function (info, deadline) {
        var frozen = (info.stopTime || 0) > 0 || !!info.toppedOut;
        return {
            framesPerRow: info.framesPerRow || 0,
            deadline: deadline || 0,
            overhead: travel.MOVE_FRAMES + (frozen ? 0 : this.reaction),
            resolve: function (size, garbage) {
                return BF.resolveFramesOf(PanelEngine(), size, garbage);
            }
        };
    };

    BitBot.prototype._decide = function () {
        var board = this._snapshot();
        var info = this.info(board);
        var pool = this.candidates(board, info);
        var base = pool.length ? pool[0].masks : bit.maskState(board.grid, board.blocks, W, board.height);
        this._lastInfo = info; this._lastPool = pool; this._lastBase = base;
        this._lastOptions = null; this._lastDeadline = 0;
        var rev = this.revealPick(board);
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
        this._lastDeadline = deadline;
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
        // The plan arithmetic used to be gated behind DEFEND, so on a board with
        // room it never ran and the weights decided instead.
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
        var lookDepth = Math.min(this.maxDepth, depthFor(deadline, this.reaction, tallestOf(pool)));
        // BURIED AND SHORT: WIDEN THE SEARCH, NOT THE PREFERENCE.
        //
        // This says where to LOOK, and nothing about what to play. Ranked by price
        // alone the beam keeps the twelve cheapest setups and a position one swap
        // from a break falls out of it whenever twelve cheaper ones exist, so a
        // break was something the search stumbled on rather than something it
        // could see. Six more slots, ranked by how close the board is to a slab,
        // make it visible; bestPlan then prices it against everything else and
        // takes it only when it buys more life.
        //
        // Finding is not preferring, and the bot does not prefer digging. It
        // prefers not dying, and under a slab those are usually the same move.
        var digging = false;
        for (i = 1; i <= W; i++) if (base.garb[i]) { digging = true; break; }
        if (digging) this.counts.digging++;
        var survival = null;
        var swept = false;
        if (info.toppedOut || !(info.stopTime > 0)) {
            swept = true;
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
                // WHAT IS LEFT OF THE PLAN, NOT WHAT IT COST WHEN IT WAS MADE.
                //
                // The plan is priced once and then executed over several
                // decisions. Checking its original total against the current
                // deadline compares a number that still includes the moves
                // already played against a clock that has since drained -- both
                // sides stale, in opposite directions.
                //
                // The engine's own frame counter is the clock, so the plan stamps
                // it when it starts and the frames since are subtracted. What is
                // left is what has to fit.
                var spent = Math.max(0, this.stack.frames - (this._plan.startedAt || 0));
                var remains = Math.max(0, this._plan.frames - spent);
                if (stillLegal && remains <= deadline) {
                    survival = { move: nx, gain: this._plan.gain, frames: remains, rate: this._plan.rate };
                    this._plan.moves = this._plan.moves.slice(1);
                    if (!this._plan.moves.length) this._plan = null;
                } else {
                    this._plan = null;
                    this.counts.planDropped++;
                }
            }
            if (!survival) {
                options = this._lastOptions = options || bitoptions.options(null, W, H, [info.cursorRow, info.cursorCol], lookDepth, base,
                                                   this.timing(info, deadline), digging);
                var plan = bestPlan(options, info.stopTime || 0, deadline, PanelEngine(),
                                    !!info.toppedOut, info.framesPerRow, this.stack.frames,
                                    tallestOf(pool));
                if (plan && plan.rate > 0) {
                    this._plan = { moves: plan.option.swaps.slice(1), frames: plan.frames,
                                   gain: plan.gain, rate: plan.rate,
                                   startedAt: this.stack.frames };
                    if (!this._plan.moves.length) this._plan = null;
                    survival = { move: plan.move, gain: plan.gain, frames: plan.frames, rate: plan.rate };
                }
            }
        } else if (this._plan) {
            this._plan = null;                    // clock running again: the plan is stale
        }

        // WHAT THE MODE IS LATE AGAINST: the frames of the cheapest plan that HOLDS
        // STATION. Survival is a clear rate of 1.0 -- a plan buying a frame of life
        // per frame spent breaks even and anything under that loses ground, so
        // `rate >= 1` is the whole test and there is no threshold to pick.
        //
        // A plan merely worth playing is not an escape. Ranked by `rate > 0` the
        // cheapest one costs a frame or two, so `deadline <= escape + reaction`
        // reads 52 <= 13 and DEFEND cannot open however close the ceiling is.
        //
        // NOTHING HOLDING STATION IS THE DANGEROUS CASE, NOT THE SAFE ONE, so it is
        // Infinity rather than null: every deadline is inside it and DEFEND opens.
        // null is reserved for not having looked -- while stop time runs the floor
        // is held and the sweep does not run, and that is not the same as finding
        // nothing.
        var escape = null;
        if (swept) escape = (survival && survival.rate >= 1) ? survival.frames : Infinity;
        var mode = this.mode(info, pool, !!rev, deadline, escape);
        // THE TIMING THE DECISION WAS MADE ON, so a death can be read back off the
        // bot rather than reconstructed from the board afterwards.
        this._last = { mode: mode.name, deadline: deadline, escape: escape,
                       pool: pool.length, tallest: tallestOf(pool),
                       stopTime: info.stopTime | 0, health: info.health,
                       toppedOut: !!info.toppedOut };
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
        // (identical histograms over 990 decisions). DEFEND opens when the floor
        // arrives before the escape can be reached, which is survival being at
        // stake and nothing else is.
        var survivalNeeded = mode.name === 'DEFEND';
        var here = signature(base);
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
            // HOLDING IS WAITING ONLY WHILE THE BOARD CHANGES ON ITS OWN.
            //
            // With panels in flight the cascade is doing the work and waiting for
            // it is real. Settled, it is not: either the clock runs, and holding
            // spends a freeze for nothing, or it does not, and the floor is
            // advancing while holding buys zero frames. It is the one action that
            // is never survival.
            //
            // Seed 104 held eight decisions running at tallest 8 with 202 frames
            // in hand and no clear anywhere on the board. By the time it acted the
            // deadline was 47, then 1.
            if (pool[i].kind === 'hold' && (mode.name !== 'BUILD' || !this.inFlight())) continue;
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
            // A THREE THAT NEITHER SENDS NOR BREAKS IS NOT AN ACTION.
            //
            // It spends the vertical structure a chain is made of and the engine's
            // table pays nothing for it. Measured over 990 decisions: 5,176 of the
            // options on offer were size-three combos and a 3-chain appeared twice.
            //
            // Survival is exempt -- a board that needs the clock takes whatever
            // buys it.
            if (this.refusePayless && !survivalNeeded && pool[i].kind === 'swap' &&
                tierOf(pool[i]) === 4) {
                this.counts.refusedPayless++;
                continue;
            }
            // A CASH THAT GAINS NOTHING IS NOT AN ACTION YET: FIRE AT THE LAST
            // SECOND.
            //
            // awardStopTime takes a MAX, not a sum, so a payout only counts for
            // what it adds on top of the clock still running:
            //
            //     gain = max(0, pays - max(0, clock - frames))
            //
            // Inside a 2-chain's 60-frame freeze, cashing a 4-combo 17 frames in
            // pays 30 against 43 still on the clock and gains ZERO. The same combo
            // fired as the clock reaches zero is worth the whole 30.
            //
            // A freeze is a fixed budget of free actions, and it is a large one:
            // the reaction cooldown is skipped while the clock runs (see `urgent`
            // in update), so an action costs travel plus the swap -- about 5
            // frames adjacent, measured at 2.8 over a real game. Sixty frames of
            // stop time buys roughly a dozen moves, not three. So there is room to
            // build inside a window and still cash at the end of it. Refusing a zero-gain cash is
            // what spends the window that way, and it is the engine's own formula
            // deciding, not a preference.
            if (info.stopTime > 0 && pool[i].kind === 'swap' && pool[i].resolved &&
                pool[i].resolved.total > 0) {
                var pr3 = pool[i].resolved, isCh = pr3.chain >= 2;
                var pays3 = BF.stopTimeOf(PanelEngine(), isCh, isCh ? 0 : pr3.total,
                                          isCh ? pr3.chain : 0, !!info.toppedOut);
                var left3 = info.stopTime - (pool[i].moveFrames || 0);
                if (pays3 - Math.max(0, left3) <= 0) { this.counts.refusedEarly++; continue; }
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

        // SENDS AND BREAKS BEATS SENDS, and that is not a preference.
        //
        // One move that attacks and digs at the same time does both jobs, and
        // garbage is two thirds of what arrives. It dominates a plain clear of the
        // same size on the axis that matters -- it pays the same cells and leaves
        // less garbage on the board -- so there is nothing for a vector to weigh.
        //
        // Only this one domination is enforced. Forcing the best tier generally
        // was measured at 7 deaths in 8: it cashes every clear the frame it
        // appears and nothing survives long enough to become a chain.
        var both = [];
        for (var bi = 0; bi < allowed.length; bi++) if (tierOf(allowed[bi]) === 0) both.push(allowed[bi]);
        if (both.length) { this.counts.forcedBoth++; allowed = both; }

        this._seen.push(here);
        if (this._seen.length > 3) this._seen.shift();


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

        // Does anything on this board clear at all? If not, every option is a
        // setup and they are judged as setups.
        var noneClear = true;
        for (i = 0; i < allowed.length; i++) {
            if (allowed[i].resolved && allowed[i].resolved.total > 0) { noneClear = false; break; }
        }
        // SHORT OF MATERIAL: BREAKING GARBAGE IS THE PRIORITY.
        //
        // A slab is material already on the board, just inert, and breaking is the
        // only thing that converts it. Below six flat rows the board cannot afford
        // to leave it sitting there: the panels a chain is made of are locked
        // inside it, and every row of slab is a row of ceiling gone.
        //
        // It costs almost nothing to say so. Material is under six rows for 98% of
        // a game, but a break is only AVAILABLE on about 4% of decisions -- a
        // match has to land beside a slab -- so this narrows the choice on one
        // decision in twenty-five and leaves the rest alone.
        if (materialRows(base) < 6) {
            var digs = [];
            for (i = 0; i < allowed.length; i++) {
                if (allowed[i].resolved && allowed[i].resolved.brokeGarbage) digs.push(allowed[i]);
            }
            if (digs.length) { this.counts.forcedBreak++; allowed = digs; }
        }

        var buried = false;
        for (i = 1; i <= W; i++) if (base.garb[i]) { buried = true; break; }
        var best = null, alive = 0, spare = [];
        for (i = 0; i < allowed.length; i++) {
            var cand = allowed[i];
            // WHAT THE HORIZON IS: the frames before this bot decides again --
            // the walk to the move, then the reaction cooldown. A candidate has
            // to survive its own cost, which is why it is per candidate.
            // THE HORIZON IS A ROW, NOT A WALK.
            //
            // Judging a candidate over the frames it takes to reach it -- about 70
            // at most -- asks whether it kills immediately. A row of rise is 112
            // frames, so a move that kills as the next row lands passes that test
            // and gets offered as though it were survivable. It is the engine's
            // own unit and it is the shortest horizon on which a death can
            // actually happen.
            var horizon = Math.max((cand.moveFrames || 0) + this.reaction,
                                   info.framesPerRow || 0);
            if (this.deadly(cand.masks, cand.resolved, info, horizon)) { this.counts.refusedDeadly++; continue; }
            var ahead = this.lookahead(cand.masks, info, horizon);
            if (ahead.stranded) { this.counts.refusedStranded++; continue; }
            alive++;
            // KEEP A THREE IN HAND, IF THE BOARD CAN AFFORD ONE. A clear that can
            // be fired the instant something lands is the only thing that buys
            // stop time on demand; a board with none must build a match first,
            // which is time it does not have when a slab arrives.
            //
            // A PREFERENCE THAT BECOMES A RULE WHEN IT CAN BE KEPT, not a veto.
            // Most mid-game boards genuinely hold no immediate clear -- refusing
            // those outright threw away 6,945 candidates in a duel and dropped the
            // bot into its fallback 565 times. So these are set aside and used
            // only if nothing that keeps a three survives.
            // A GARBAGE BREAK IS WHAT IS WORTH HOLDING, when there is a slab to
            // break. It converts the slab into panels and holds the floor for the
            // whole of its resolve; a bare three buys 59 frames and takes three
            // panels off the board. With no garbage on it there is nothing to
            // break, so any clear is the fail-safe.
            var cashes = cand.resolved && (cand.resolved.total > 0 ||
                                           cand.resolved.brokeGarbage);
            var held = buried ? ahead.hasBreak : ahead.hasClear;
            if (!cashes && !held) {
                this.counts.refusedNoFailsafe++;
                spare.push(cand);
                continue;
            }
            // NOTHING CLEARS ANYWHERE: FLATTEN. Flattening IS the setup.
            //
            // LEXICOGRAPHIC, NOT A WEIGHTED SUM: the flatter board wins; between
            // two equally flat ones, the one offering more ways to make a line;
            // between two of those, the cheaper move. Each term is scaled past the
            // next so it cannot be outvoted, and there is no weight here to get
            // wrong.
            //
            // WAYS-TO-BUILD LED THIS AND IT BUILT TOWERS. Two boards rarely offer
            // the same count, so flatness was a tiebreak that never fired, and the
            // bot stacked columns 1-3 five and six high with columns 5-6 empty and
            // a hole in the bottom row. The same panels spread across six columns
            // offer more lines anyway and are not against the ceiling.
            var s = noneClear
                  ? -bumpiness(cand.masks) * 10000 + matchWays(cand.masks) * 100 - (cand.moveFrames || 0)
                  : this.score(cand.masks, cand.moveFrames, cand.resolved, info);
            if (!best || s > best.score) best = { cand: cand, score: s };
        }
        // NOTHING KEPT A THREE: rank the ones that survive but spend it, which is
        // still better than the lost-position fallback below.
        if (!best && spare.length) {
            for (i = 0; i < spare.length; i++) {
                var sc = spare[i];
                var ss = noneClear
                       ? -bumpiness(sc.masks) * 10000 + matchWays(sc.masks) * 100 - (sc.moveFrames || 0)
                       : this.score(sc.masks, sc.moveFrames, sc.resolved, info);
                if (!best || ss > best.score) best = { cand: sc, score: ss };
            }
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
        // AND AN ATTACK THAT PUTS THE BOARD BACK IS NOT AN ATTACK, IT IS THE LOOP.
        //
        // The survival plan has refused a move returning to a board it has just
        // been on; the attack path did not, and it reaches the cursor first. On
        // rand4 seed 101 the last seventeen decisions before the death alternate
        // bestAttack and attackPlan one frame apart with the board unchanged
        // throughout -- a whole freeze spent walking between two boards, under 45
        // cells of garbage, and then it topped out.
        //
        // The candidate loop already refuses these, but it filters `allowed` and
        // the attack path reads `pool`, so it walked straight past the guard.
        var self = this;
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

        // THE OPENING: THE FIRST THING IT DOES IS RAISE.
        //
        // The board is dealt nearly empty and a chain is built out of panels, so
        // the opening is not a decision -- it is holding raise until there is
        // something to play with. Nothing else is considered while it lasts.
        //
        // It ends the moment the board has the material, or the moment the game
        // starts happening to it: garbage on the way, or topped out. After that
        // the ordinary floor rule takes over.
        if (this._opening) {
            // The board is not dealt empty, so this is not a material-floor rule:
            // it is filling the board while filling it is free. It ends when the
            // game starts happening -- garbage on the way, or topped out -- or
            // when another row would not leave the room a chain needs to stand in.
            // The only height bound is the one that matters: the row it adds,
            // plus every cell already queued, still has to fit under the ceiling.
            // There is no headroom reserve beyond that, and the raise in the pool
            // has already faced the death filter besides.
            var openRows = Math.ceil((info.incoming || 0) / W);
            if (info.incoming || info.toppedOut ||
                tallestOf(pool) + 1 + openRows >= H) {
                this._opening = false;
            } else {
                var openRaise = null;
                for (i = 0; i < pool.length; i++) if (pool[i].kind === 'raise') openRaise = pool[i];
                if (openRaise) {
                    this.counts.openingRaises++;
                    return { kind: 'raise', mode: mode, alive: alive, via: 'opening' };
                }
                var o0 = this.stack;
                // A RAISE ALREADY IN FLIGHT IS NOT A RAISE REFUSED. update() holds
                // the input for twenty frames after one is asked for, which makes
                // canRaise() false and takes the raise out of the pool -- so the
                // opening read its own success as "no raise is possible" and ended
                // after a single row.
                // ONLY IN BUILD. ATTACK and DEFEND drop hold from the pool because
                // there is something that has to be done now; a wait is still a
                // decision spent doing nothing, and the rule does not care why.
                if (this.raiseFrames > 0 && mode.name === 'BUILD') {
                    this.counts.openingWaits++;
                    return { kind: 'hold', mode: mode, alive: alive, via: 'opening' };
                }
                // The engine is mid-swap or mid-resolve. That clears on its own,
                // and waiting for the row beats spending the decision elsewhere.
                if (this.allowRaise && mode.name === 'BUILD' &&
                    !o0.preventManualRaise && !o0.manualRaise &&
                    !(typeof o0.hasFallingGarbage === 'function' && o0.hasFallingGarbage())) {
                    this.counts.openingWaits++;
                    return { kind: 'hold', mode: mode, alive: alive, via: 'opening' };
                }
                this._opening = false;
            }
        }

        // MATERIAL BEFORE ATTACKING. A board under the floor has nothing to
        // attack WITH -- every clear it fires spends panels a chain would have
        // been built from -- so the raise comes first, at the start of the game
        // when the board is nearly empty and every time it drops back under.
        // Ranked after the attack, the bot spent the opening attacking off two
        // rows instead of building up.
        // WHETHER A RAISE IS AVAILABLE IS THE POOL'S ANSWER, NOT THIS BRANCH'S.
        //
        // A raise the engine refuses, or one the board would not survive, is not
        // in the pool -- the same way an illegal swap is not. So finding one there
        // IS the validity test, and this branch asks only its own question: is the
        // board short of material.
        if (!survival && materialRows(base) < WORKING_ROWS) {
            var risenCand = null;
            for (i = 0; i < pool.length; i++) if (pool[i].kind === 'raise') risenCand = pool[i];
            if (risenCand) {
                this.counts.raisedForMaterial++;
                return { kind: 'raise', mode: mode, alive: alive, via: 'raiseMaterial' };
            }
            this.counts.refusedRaise++;

            // WAIT A BEAT FOR IT. riseLock is set while a swap is queued or panels
            // are in motion, and the bot swaps on nearly every decision, so the
            // engine is busy on 2,514 of the 2,723 decisions taken below the floor
            // -- the raise it owes itself is almost never available and the board
            // sits under four rows for 90% of a game.
            //
            // The lock clears on its own in a few frames. Below the floor, with
            // nothing to survive and nothing queued against it, standing still for
            // one decision and taking the row is the move; swapping past the
            // opportunity is how the board never refills.
            //
            // Only for a lock that clears: topped out or garbage still falling are
            // refusals that waiting does not fix.
            var s0 = this.stack;
            var busy = !!s0.riseLock ||
                       (typeof s0.hasActivePanels === 'function' && s0.hasActivePanels()) ||
                       (s0.shakeTime || 0) > 0;
            var wontClear = s0.preventManualRaise || s0.manualRaise ||
                            (typeof s0.isToppedOut === 'function' && s0.isToppedOut()) ||
                            (typeof s0.hasFallingGarbage === 'function' && s0.hasFallingGarbage());
            if (this.allowRaise && busy && !wontClear && !this.raiseFrames &&
                mode.name === 'BUILD' && !info.incoming && !info.toppedOut) {
                this.counts.waitedToRaise++;
                return { kind: 'hold', mode: mode, alive: alive, via: 'waitRaise' };
            }
        }

        if (!survival) {
            if (this._attack && this._attack.moves.length) {
                var an = this._attack.moves[0];
                var okNext = false, als = bit.legalSwapsOf(base);
                for (i = 0; i < als.length; i++) {
                    if (als[i][0] === an[0] && als[i][1] === an[1]) { okNext = true; break; }
                }
                if (okNext && returnsToSeen(an)) { okNext = false; this.counts.refusedReturn++; }
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
                                                   this.timing(info, deadline), digging);
            var atk = bestAttack(options, this.weights, PanelEngine(), deadline,
                                 this.stack.frames, (info.framesPerRow || 0) / W);
            if (atk && atk.move && returnsToSeen(atk.move)) {
                atk = null;
                this._attack = null;
                this.counts.refusedReturn++;
            }
            if (atk && atk.move) {
                this._attack = { moves: atk.option.swaps.slice(1) };
                if (!this._attack.moves.length) this._attack = null;
                this.counts.attacked++;
                this.counts.cellsPlanned += atk.cells;
                return { kind: 'swap', move: atk.move, mode: mode, alive: alive, via: 'bestAttack' };
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
        // LOW ON MATERIAL: RAISE OR BREAK. Those two make panels and nothing else
        // does -- a raise adds W of them, breaking a slab converts its cells. The
        // board starts near empty, so this fires from the first decision.
        //
        // MATERIAL, NOT HEIGHT. The test was tallestOf(pool), so garbage counted
        // as material and a buried board never raised while holding three flat
        // rows of panels and no way to dig out.
        //
        // ONLY IF ABLE TO: canRaise() is the engine's own list of refusals, and
        // the risen board still faces the death filter just below.
        // AND SOMEWHERE TO PUT THE ROW. Material alone fires on nearly every
        // decision -- a board with fewer than WORKING_ROWS * W non-garbage panels
        // is the ordinary state -- so on its own it raises the stack into the
        // ceiling: 8 deaths in 8, average life 10,369 frames.
        //
        // A raise adds a row and a chain needs WORKING_ROWS to stand in, so the
        // row must leave that much. deadly() only refuses a raise once the board
        // is FULL, which is far too late to be this guard.
        // RAISE OR BREAK, AND WHICH ONE THE BOARD DECIDES. Both make panels and
        // nothing else does. But a slab is material already on the board, just
        // inert -- breaking converts it for free, while raising buys the same
        // panels with a row of headroom. So raising is for a board with no
        // garbage on it; buried, the answer is to dig.
        //
        // GARBAGE ON THE BOARD IS NOT A REASON NOT TO RAISE. Raise first, then
        // break: both make panels and a board short of them needs whichever it can
        // get. Refusing while buried starved the board that needed material most --
        // on rand4 seed 101 it was holding 2 rows when a 24-cell slab landed, and
        // died with 20 panels in four columns and no line left in them.
        //
        // The guards that matter are still every one of them: canRaise() is the
        // engine's own list of refusals, the row has to leave WORKING_ROWS of
        // headroom under the ceiling -- and garbage counts toward that height --
        // and the risen board faces the death filter like any other move.
        // NOR IS GARBAGE ON THE WAY. Same reasoning as the slab already on the
        // board: under the floor the thing it is short of is panels, and the only
        // two ways to get them are raising and breaking. Measured on seed 101, it
        // sat at 3 rows for six straight decisions under the floor of 4, refusing
        // to raise because a slab was queued, and died 150 frames later.

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
                return { kind: 'swap', move: survival.move, mode: mode, alive: alive, via: 'survivalPlan' };
            }
        }

        // NOTHING CLEARS: FLATTEN, TO A PLAN.
        //
        // Ranking single swaps by the flatness they leave is greedy -- it takes
        // the best step available this frame and has no idea where it is going, so
        // it walks the board into a spike one locally-flattest swap at a time.
        // Measured on seed 101: columns at heights 8,5,4,3,4,3 with the tall one
        // pressed against the slab, and every decision that built it was a setup.
        //
        // bitoptions plans it instead. Every node it keeps IS a landed board --
        // where the panels came to rest -- so it knows the shape each sequence
        // arrives at and the swaps that get there, and it names the flattest one
        // it can reach. The plan is then played in order like a survival or attack
        // plan: re-choosing every frame is how the greedy version got here.
        //
        // Dropped the moment it stops being true -- the next move must still be
        // legal and must not put the board back where it has just been.
        if (noneClear && (!this._flatten || !this._flatten.moves.length)) {
            options = this._lastOptions = options || bitoptions.options(null, W, H, [info.cursorRow, info.cursorCol],
                                                    lookDepth, base, this.timing(info, deadline), digging);
        }
        // AND IT HAS TO FIT IN THE TIME THERE IS. The plan is priced in frames like
        // every other -- the walk to each swap, the swap, and the cooldown when one
        // applies -- and a plan that runs past the deadline is not a plan, however
        // flat the board at the end of it.
        if (noneClear && options && options.flatten && options.flatten.swaps.length &&
            (options.flatten.duration || 0) <= deadline) {
            if (!this._flatten || !this._flatten.moves.length) {
                this._flatten = { moves: options.flatten.swaps.slice(),
                                  frames: options.flatten.duration,
                                  startedAt: this.stack.frames };
            }
        }
        if (noneClear && this._flatten && this._flatten.moves.length) {
            var fm = this._flatten.moves[0], fok = false, fls = bit.legalSwapsOf(base);
            for (i = 0; i < fls.length; i++) {
                if (fls[i][0] === fm[0] && fls[i][1] === fm[1]) { fok = true; break; }
            }
            if (fok && returnsToSeen(fm)) fok = false;
            // WHAT IS LEFT OF IT AGAINST THE CLOCK AS IT IS NOW, not what it cost
            // when it was made: the plan is priced once and played over several
            // decisions, and the clock drains the whole time.
            if (fok) {
                var fspent = Math.max(0, this.stack.frames - (this._flatten.startedAt || 0));
                if (Math.max(0, (this._flatten.frames || 0) - fspent) > deadline) fok = false;
            }
            if (fok) {
                this._flatten.moves = this._flatten.moves.slice(1);
                if (!this._flatten.moves.length) this._flatten = null;
                this.counts.flattened++;
                return { kind: 'swap', move: fm, mode: mode, alive: alive, via: 'flatten' };
            }
            this._flatten = null;
            this.counts.flattenDropped++;
        }

        if (rev && rev.best && rev.best.swap) {
            this.counts.revealSwaps++;
            return { kind: 'swap', move: rev.best.swap, mode: mode, alive: alive, reveal: true, via: 'lineup' };
        }
        if (!best) return { kind: 'hold', mode: mode, alive: alive, via: 'noBest' };
        return { kind: best.cand.kind, move: best.cand.swap, mode: mode, alive: alive, via: (noneClear ? 'setup' : 'WEIGHTS') };
    };

    // A BREAK HAS TO SURVIVE THE MOVE, AND BE REACHABLE IN TIME.
    //
    // The bot may do whatever it likes -- attack, flatten, raise, set up -- as
    // long as the board it leaves behind still holds a break it could get to.
    // "Could get to" is the arithmetic used everywhere else: the walk from where
    // the cursor ends up, plus the swap, against the frames that board has before
    // it tops out. A break on the far side with twenty frames left is not a save.
    BitBot.prototype.saveAfter = function (masks, row, col, info) {
        var deadline = framesToDeath(info, tallestBoard(masks), info.framesPerRow);
        var frozen = (info.stopTime || 0) > 0 || !!info.toppedOut;
        var step = travel.MOVE_FRAMES + (frozen ? 0 : this.reaction);
        var sw = bit.legalSwapsOf(masks), i, r;
        for (i = 0; i < sw.length; i++) {
            if (travel.cost(row, col, sw[i][0], sw[i][1]) + step > deadline) continue;
            if (!bit.swapMasks(masks, sw[i][0], sw[i][1])) continue;
            r = bit.resolveFromMasks(masks, false);
            bit.swapMasks(masks, sw[i][0], sw[i][1]);
            if (r.scope === 'garbage-broke') return true;
        }
        return false;
    };

    // THE GATE EVERY DECISION LEAVES BY.
    //
    // The rule belongs at the exit, not inside one of the paths that can pick a
    // move: a filter wired into the candidate loop only ever shaped the fallback,
    // and the moves that actually get played come from the attack and survival
    // plans, which walked straight past it.
    //
    // Soft: if nothing keeps a save, the original move stands. This narrows the
    // choice, it never refuses to move.
    BitBot.prototype.decide = function () {
        var d = this._decide();
        var info = this._lastInfo, pool = this._lastPool, base = this._lastBase;
        if (!d || d.kind !== 'swap' || !d.move || !info || !pool || !base) return d;
        var buried = false, i;
        for (i = 1; i <= W; i++) if (base.garb[i]) { buried = true; break; }
        if (!buried) return d;

        // ONLY WITH TIME TO SPARE. Keeping a save means playing something other
        // than what the decision chose, and the substitute is ranked by the
        // weights rather than by whatever objective picked the original -- so on
        // a board that needs to survive, this trades a survival plan for a move
        // whose only qualification is that it leaves a break standing. Measured:
        // 6 deaths in 16 boards against 1 in 30.
        //
        // Two rows of rise is the slack. Inside that the decision stands as made.
        if (this._lastDeadline < 2 * (info.framesPerRow || 0)) return d;

        var chosen = null;
        for (i = 0; i < pool.length; i++) {
            var pc = pool[i];
            if (pc.kind === 'swap' && pc.swap[0] === d.move[0] &&
                pc.swap[1] === d.move[1] && pc.masks) { chosen = pc; break; }
        }
        if (!chosen) return d;
        // A BREAK THAT LEAVES ANOTHER BREAK IS FREE. That is the whole rule: the
        // save may be spent as long as spending it makes a new one.
        //
        // Neither extreme works. Guarding a break on its result refuses the very
        // move the save exists to enable and the board ends up buried on five
        // times as many decisions. Exempting every break cashes the save the
        // instant one appears, and the board holds one on 3% of decisions.
        //
        // So a break that leaves none is the save being CASHED, and that is for
        // when the board needs it: short of material, where the garbage has to be
        // prioritised because the panels are locked inside it. With material in
        // hand there is something else to do and the break keeps.
        if (chosen.resolved && chosen.resolved.brokeGarbage) {
            if (materialRows(base) < 6) return d;
            if (this.saveAfter(chosen.masks, chosen.swap[0], chosen.swap[1], info)) return d;
            this.counts.heldTheBreak++;
        } else if (this.saveAfter(chosen.masks, chosen.swap[0], chosen.swap[1], info)) {
            return d;
        }
        var keep = null;
        for (i = 0; i < pool.length; i++) {
            var alt = pool[i];
            if (alt === chosen || alt.kind !== 'swap' || !alt.masks) continue;
            if (this.deadly(alt.masks, alt.resolved, info,
                            Math.max((alt.moveFrames || 0) + this.reaction,
                                     info.framesPerRow || 0))) continue;
            if (!this.saveAfter(alt.masks, alt.swap[0], alt.swap[1], info)) continue;
            var sc = this.score(alt.masks, alt.moveFrames, alt.resolved, info);
            if (!keep || sc > keep.score) keep = { cand: alt, score: sc };
        }
        // NO SINGLE SWAP KEEPS ONE: PLAN FOR IT.
        //
        // The pool is one ply deep, and at one ply there is almost never another
        // move that leaves a break standing -- 2 of 100. The search is not: it
        // walks landed boards several moves out and can name the cheapest route
        // to one that holds a save. Asking the pool and stopping there was the
        // reason this rule had nothing to do.
        if (!keep && this._lastOptions && this._lastOptions.save &&
            this._lastOptions.save.swaps.length) {
            var sp = this._lastOptions.save, sm = sp.swaps[0];
            var legal = bit.legalSwapsOf(base), okMove = false;
            for (i = 0; i < legal.length; i++) {
                if (legal[i][0] === sm[0] && legal[i][1] === sm[1]) { okMove = true; break; }
            }
            if (okMove && (sp.duration || 0) <= this._lastDeadline) {
                this.counts.savePlanned++;
                return { kind: 'swap', move: sm, mode: d.mode, alive: d.alive,
                         via: 'planSave' };
            }
        }
        if (!keep) { this.counts.saveUnkeepable++; return d; }
        this.counts.saveKept++;
        return { kind: 'swap', move: keep.cand.swap, mode: d.mode,
                 alive: d.alive, via: 'keepSave' };
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
    // Exposed so the gate can hold it against the engine's own fillRatio, which
    // is the canonical answer to "how close to the top is this board". The two
    // must agree: when they did not, every height decision in the bot was wrong
    // and the bot stood at the ceiling believing it had room.
    BitBot.tallestOfMasks = tallestBoard;
    BitBot.signatureOf = signature;
    BitBot.STARTER = STARTER;
    return BitBot;
}));
