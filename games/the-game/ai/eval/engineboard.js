// THINK WITH THE ENGINE, NOT WITH A COPY OF IT.
//
// panel-engine.js runs the game. panel-cpu.js's LogicalBoard is a second,
// faster implementation of the same rules that the search clones a few
// hundred times a decision — and the two disagree. Measured against the
// fork's chip library, 372 templates fire correctly on a live Stack and come
// out wrong in LogicalBoard, EVERY one of them by the same amount: the right
// panels clear, in one round fewer. The engine lands groups that fell
// different distances a couple of frames apart and counts two chain links;
// LogicalBoard settles the whole board before matching and merges them.
//
// So the bot prices a real 3-chain as a 2-chain, on exactly the deep-chain
// shapes it is supposed to be learning to build.
//
// This module is the other answer: run the candidate on a REAL Stack. One
// scratch Stack is built once and repainted per candidate, which is what
// makes it affordable — measured 1.27ms a candidate against LogicalBoard's
// 0.017ms, so 30 candidates at depth 1 is 38ms of an 85ms budget.
//
// ONE IMPLEMENTATION, USED BY BOTH. The chip verifier had its own copy of
// paint-and-settle and the bot would have grown another; two copies of this
// drift exactly the way LogicalBoard drifted from the engine, and then
// "verified against the engine" stops meaning what it says.
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
    function paint(stack, grid, height, width, blocks) {
        for (var r = 0; r < stack.panels.length; r++) {
            for (var c = 1; c <= width; c++) {
                var p = stack.panels[r][c];
                if (!p) continue;
                var v = (r >= 1 && r <= height && grid[r]) ? (grid[r][c] || 0) : 0;
                p.color = v > 0 ? v : 0;
                p.isGarbage = v === -2;
                p.state = 'normal';
                p.timer = 0; p.initialTime = 0; p.popTime = 0; p.popIndex = 0;
                p.chaining = false; p.matching = false;
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
        stack.riseLock = true;
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
        for (var f = 0; f < cap; f++) {
            stack.events.length = 0;
            stack.run();
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
