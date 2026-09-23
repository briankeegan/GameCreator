// THINK WITH THE ENGINE, NOT WITH A COPY OF IT.
//
// panel-engine.js runs the game. panel-cpu.js's LogicalBoard is a second
// implementation of the same rules that the search clones a few hundred
// times a decision. This module runs a candidate on a REAL Stack instead:
// one scratch Stack, built once and repainted per candidate.
//
// WHAT IT COSTS, measured at depth 2 on a real duel: 3,168us a resolve
// against LogicalBoard's 209us, which is 1,904ms a decision against 87ms.
// The budget is 85ms. So this is the referee, not the thinker — PuyoCpu's
// `engine` option switches _resolveCandidate over to it, and nothing in
// training or the shipped bot sets it.
//
// WHERE THE TWO STAND TODAY, both re-measured rather than recalled:
//   verify_chips_engine.js with GC_COMPARE_SIM=1 — 6,228 chips, 0 differ.
//   live_fidelity.js — 272 swaps in live play, 0 differ.
// Deep cascade shapes and live unsettled boards. Neither covers a deep
// cascade ON an unsettled board, which is the gap that remains.
//
// ONE IMPLEMENTATION, USED BY BOTH. The chip verifier had its own copy of
// paint-and-settle and the bot would have grown another; two copies of this
// drift exactly the way a copy drifts, and then "verified against the
// engine" stops meaning what it says.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PanelEval = root.PanelEval || {}, root.PanelEval.engineBoard = factory();
}(this, function () {
    'use strict';

    function engine() { return (typeof window !== 'undefined' ? window : globalThis).PanelEngine; }

    // A Stack kept aside for thinking on. Built once — construction runs a
    // thousand frames of countdown and costs more than the whole evaluation.
    function scratch(level) {
        var PanelEngine = engine();
        var stack = new PanelEngine.Stack({ level: level || 10, seed: 7 });
        var guard = 0;
        while (!stack.stopWatchIsRunning && guard++ < 1000) stack.run();
        // ONLY THIS STACK SKIPS. It exists to answer "what would this move
        // do", never to be played, so jumping the frames where nothing can
        // change costs a player nothing and saves the search most of its
        // time. A Stack a person is playing never sets this.
        stack.allowIdleSkip = true;
        return stack;
    }

    // Write a LogicalBoard-shaped grid onto the scratch Stack. The engine
    // mutates Panel objects in place, so they are RESET rather than replaced:
    // a timer, a chaining flag or a garbage size left over from the previous
    // candidate would run on into this one and be read as part of it.
    // blocks: { id: [[row,col], ...] } — which cells form each garbage SLAB.
    // Optional, and its absence is why the garbage half of this was unverified
    // for so long: a garbage panel is not just "isGarbage". The engine reads
    // gWidth, gHeight and the per-cell x/y offsets to decide whether a slab is
    // supported (supportedFromBelow walks the whole width of the block) and to
    // pop it as a unit. Painting isGarbage alone and zeroing the rest leaves a
    // slab the engine cannot reason about, so every garbage comparison was
    // measuring the harness.
    // chaining: [row][col] booleans, the engine's own per-PANEL chaining flag.
    // It is what makes a clear a chain LINK rather than a fresh combo, and it
    // lives on the panel, so a board painted without it cannot produce a chain
    // the game would produce. snapshot() collects it; nothing passed it here
    // and the loop below zeroed it on every cell.
    // motion: [row][col] -> {state, timer} for panels the engine has in flight.
    // Giving every floating panel a fresh full hover lands it late, and a panel
    // that lands late can come to rest a row above where it belongs because
    // something settled under it first.
    function paint(stack, grid, height, width, blocks, chaining, motion) {
        for (var r = 0; r < stack.panels.length; r++) {
            for (var c = 1; c <= width; c++) {
                var p = stack.panels[r][c];
                if (!p) continue;
                var v = (r >= 1 && r <= height && grid[r]) ? (grid[r][c] || 0) : 0;
                p.color = v > 0 ? v : 0;
                p.isGarbage = v === -2;
                p.state = 'normal';
                p.timer = 0; p.initialTime = 0; p.popTime = 0; p.popIndex = 0;
                p.chaining = !!(chaining && chaining[r] && chaining[r][c]);
                p.matching = false;
                // dontSwap IS PANEL STATE TOO. The engine sets it when a swap
                // would leave a panel unsupported, and it lives on the Panel
                // object this module reuses candidate after candidate. Left
                // standing, canSwap refuses a move on a board where it is
                // legal, _resolveCandidate settles the UNMOVED board, and the
                // candidate is scored as a move that changes nothing.
                p.dontSwap = false;
                p.fellFromGarbage = 0; p.stateChanged = false;
                p.propagatesChaining = false; p.matchAnyway = false;
                p.xOffset = null; p.yOffset = null;
                p.gWidth = 0; p.gHeight = 0; p.shakeTime = 0;
            }
        }
        // REBUILD THE SLABS. A garbage block in this game is always a
        // rectangle, so its bounding box is its shape, and each cell's offset
        // from the block's origin is what the engine walks.
        if (blocks) {
            var gid = 1;
            for (var id in blocks) {
                var cells = blocks[id];
                if (!cells || !cells.length) continue;
                var minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
                for (var i = 0; i < cells.length; i++) {
                    if (cells[i][0] < minR) minR = cells[i][0];
                    if (cells[i][0] > maxR) maxR = cells[i][0];
                    if (cells[i][1] < minC) minC = cells[i][1];
                    if (cells[i][1] > maxC) maxC = cells[i][1];
                }
                var gw = maxC - minC + 1, gh = maxR - minR + 1;
                for (i = 0; i < cells.length; i++) {
                    var gp = stack.panels[cells[i][0]][cells[i][1]];
                    if (!gp) continue;
                    gp.isGarbage = true;
                    gp.color = 9;                       // COLORLESS, as the engine writes it
                    gp.garbageId = gid;
                    gp.gWidth = gw; gp.gHeight = gh;
                    gp.yOffset = cells[i][0] - minR;
                    gp.xOffset = cells[i][1] - minC;
                    gp.state = 'normal';
                }
                gid++;
            }
            stack.garbageIdCounter = Math.max(stack.garbageIdCounter || 0, gid);
        }
        // GRAVITY NEEDS A STATE IT CAN ACT ON.
        //
        // updateNormal only asks whether a panel should fall when the panel
        // BELOW changed state THIS FRAME, and updatePanel clears that flag at
        // the top of every panel's turn. In a real game the check is free: a
        // hole only ever opens because something below just moved. A board
        // painted wholesale has holes nobody opened, so a panel left hanging
        // over one is never examined and stays there for the entire settle —
        // measured directly: a panel painted at row 6 over an empty column is
        // still at row 6 after 900 frames.
        //
        // snapshot() keeps falling and hovering panels at the cell they
        // occupy so that "the engine's own gravity then drops them where they
        // will actually land". This is what lets it. A colour panel with an
        // empty cell under it is exactly a panel entering hover, so it is
        // painted as one and the engine does the rest. Garbage needs nothing:
        // updateNormal checks supportedFromBelow before the stateChanged
        // guard and falls on its own.
        // NOT SUPPORTED IS NOT THE SAME AS "THE CELL BELOW IS EMPTY". A panel
        // resting on a panel that is itself about to fall is going down too,
        // and giving a state only to the lowest one leaves the rest `normal`,
        // where updateNormal never re-examines them. Measured: a column of
        // four left five rows above where the engine settles it.
        //
        // Walked per column from the floor up, tracking where the next panel
        // actually comes to rest. Garbage is skipped — it spans columns and
        // the engine's supportedFromBelow handles it before the stateChanged
        // guard.
        for (var gc = 1; gc <= width; gc++) {
            var rest = 1;
            for (var gr = 1; gr <= height; gr++) {
                var gp = stack.panels[gr] && stack.panels[gr][gc];
                if (!gp || gp.color === 0) continue;
                // GARBAGE IS NOT A FLOOR. A slab with a gap under it falls, and
                // everything resting on it falls the same distance. Treating
                // it as fixed left the colour panels above a sinking slab
                // marked normal, where updateNormal never looks at them again.
                if (gp.isGarbage) { rest = gr + 1; continue; }
                // Anything with an empty cell somewhere below it in this column
                // is going down, whether the gap is directly beneath or under a
                // slab that is itself about to sink.
                var gap = gr > rest;
                if (!gap) {
                    for (var gb = gr - 1; gb >= 1; gb--) {
                        var bp = stack.panels[gb] && stack.panels[gb][gc];
                        if (!bp || bp.color === 0) { gap = true; break; }
                    }
                }
                if (gap) {
                    var mv = motion && motion[gr] && motion[gr][gc];
                    if (mv) { gp.state = mv.state; gp.timer = mv.timer; }
                    else { gp.state = 'hovering'; gp.timer = stack.frames.HOVER; }
                }
                rest++;
            }
        }
        stack.riseLock = true;
        // AND RESET THE STACK ITSELF, not just its panels. This module exists
        // so ONE Stack can be repainted per candidate instead of built each
        // time — and every piece of stack-level state left behind is a way for
        // the last candidate to change this one's answer.
        //
        // highestGarbageIdMatched is the worst of them: the engine gates which
        // garbage is eligible to be matched on it, so a slab from a previous
        // board could make this board's garbage behave differently. Caught by
        // running the same comparison with a fresh Stack per case and getting
        // a different answer — 19 "unexplained" disagreements that were the
        // harness all along, and the bot's own engine path (puyocpu's
        // _resolveCandidate) reuses this scratch Stack the same way.
        // AND THE RNG POSITION. It is deterministic from a seed, but a reused
        // Stack has advanced it and a fresh one has not — so the same board
        // painted onto each can resolve differently the moment anything draws
        // from it. Reseeded per paint, which makes a repainted Stack
        // indistinguishable from a new one.
        if (PanelEngine.makeRng) stack.rng = PanelEngine.makeRng(7);
        stack.stopTime = 0;
        stack.chainCounter = 0;
        stack.shakeTime = 0;
        stack.highestGarbageIdMatched = 0;
        stack.nActive = 0; stack.nPrevActive = 0; stack.swappingCount = 0;
        stack.queuedSwapRow = 0; stack.queuedSwapCol = 0;
        stack.manualRaise = false; stack.preventManualRaise = false;
        stack.wasToppedOut = false; stack.gameOver = false;
        // AND THE HEALTH, WHICH IS WHY A TALL BOARD RESOLVED TO NOTHING.
        //
        // A board painted near the ceiling reads topped out, and at level 10
        // maxHealth is 1 — so one frame drains it to zero, checkGameOver
        // fires, and run() returns early for the rest of the settle. The
        // scratch dies on frame 1 and the resolve hands back the board it was
        // given, unchanged. That is the answer the bot got for every candidate
        // on a tall board: the moment it most needs to know what a move does.
        stack.health = stack.maxHealth;
        if (stack.incoming) stack.incoming.length = 0;
        if (stack.garbageLandedThisFrame) stack.garbageLandedThisFrame.length = 0;
        if (stack.swapStallBacklog) stack.swapStallBacklog.length = 0;
        if (stack.events) stack.events.length = 0;
        // AND STOP THE FLOOR MOVING. riseLock alone does not: the engine
        // re-decides it every frame (updateRiseLock), so a settle long enough
        // to run a cascade — 70 to 90 frames — is long enough for the stack to
        // climb a row, shift every panel up, and feed a fresh row in at the
        // bottom. The totals survive that (the same panels cleared), which is
        // why the chip gates never saw it; the BOARD does not, and a board
        // read after an uninvited rise shows floating panels over a gap, which
        // no settled position can hold.
        //
        // riseTimer is the honest lever. The rise only fires when the timer
        // reaches zero (`if (!this.riseLock && this.stopTime === 0)` ->
        // `this.riseTimer--`), so parking it far away stops the row arriving
        // without touching riseLock's meaning or the timing of anything else.
        // Found by comparing final GRIDS rather than final scores: 195 of 213
        // disagreements between this and LogicalBoard were this harness
        // rising, and would have been "fixed" in LogicalBoard.
        stack.riseTimer = 1e9;
    }

    // Run until the board is STILL, collecting what the engine says happened.
    // Not for a fixed number of frames: riseLock is re-decided every frame, so
    // idle frames let the stack climb a row — which silently moved the board
    // between the two swaps of a two-swap chip and made thirteen good chips
    // read as clearing nothing.
    function settle(stack, budget) {
        var chain = 0, comboSizes = [], garbage = [], cleared = 0;
        var cap = budget || 900;
        var quiet = false;
        for (var f = 0; f < cap; f++) {
            // THE SCRATCH IS NOT PLAYING, IT IS ANSWERING A QUESTION.
            //
            // A board painted near the ceiling reads topped out, and the
            // engine drains health whenever a topped-out stack is not locked
            // — updateRiseLock re-decides that flag every frame, so it cannot
            // be held off from outside. At level 10 maxHealth is 1: the
            // scratch dies on the first frame, run() returns early, and the
            // resolve hands back the board it was given, unchanged. That was
            // the answer for every candidate on a tall board, which is exactly
            // when the bot needs a real one.
            //
            // Dying is the match's business. What settles is this module's.
            stack.health = stack.maxHealth;
            stack.gameOver = false;
            // ONLY ATTEMPT THE JUMP AFTER A SILENT FRAME. idleSkip walks the
            // board to find the soonest timer, and on a busy frame it pays
            // for that walk and then refuses — measured slower in real duels
            // than not trying at all. A frame that emitted nothing is the
            // cheap signal that a countdown is what is left.
            if (quiet) stack.idleSkip();
            stack.events.length = 0;
            stack.run();
            quiet = stack.events.length === 0;
            for (var i = 0; i < stack.events.length; i++) {
                var e = stack.events[i];
                if (e.type !== 'match') continue;
                comboSizes.push(e.size);
                cleared += e.size;
                if (e.chainCounter > chain) chain = e.chainCounter;
                if (e.garbage) garbage.push([e.garbage, 1]);
            }
            if (f >= 3 && !stack.hasActivePanels() && !stack.hasChainingPanels()) break;
        }
        // resolve()'s chainLength counts match-and-settle ROUNDS: a plain combo
        // is 1 where the engine's chain counter is 0. Reported in resolve()'s
        // units so nothing downstream has to know which board it came from.
        return {
            chainLength: comboSizes.length ? Math.max(chain, 1) : 0,
            comboSizes: comboSizes,
            garbage: garbage,
            clearedPanels: cleared
        };
    }

    // Read the settled board back out, in LogicalBoard's grid shape.
    function readGrid(stack, height, width) {
        var grid = [];
        for (var r = 0; r <= height; r++) {
            grid[r] = [];
            for (var c = 1; c <= width; c++) {
                var p = stack.panels[r] && stack.panels[r][c];
                grid[r][c] = !p ? 0 : (p.isGarbage ? -2 : (p.color || 0));
            }
        }
        return grid;
    }

    // The garbage SLABS as they now stand: { id: [[row,col], ...] }. Comparing
    // grids alone cannot see a difference here — every garbage cell reads -2
    // either way — so two boards can agree cell for cell while one has a
    // 6x2 slab and the other two 6x1s, which fall and pop differently on the
    // very next move.
    function readBlocks(stack, height, width) {
        var out = {};
        for (var r = 1; r <= height; r++) {
            for (var c = 1; c <= width; c++) {
                var p = stack.panels[r] && stack.panels[r][c];
                if (!p || !p.isGarbage || p.color === 0) continue;
                var k = 'g' + p.garbageId;
                (out[k] = out[k] || []).push([r, c]);
            }
        }
        return out;
    }

    return { scratch: scratch, paint: paint, settle: settle, readGrid: readGrid, readBlocks: readBlocks };
}));
