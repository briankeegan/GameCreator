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
    function paint(stack, grid, height, width) {
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
        stack.riseLock = true;
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

    return { scratch: scratch, paint: paint, settle: settle, readGrid: readGrid };
}));
