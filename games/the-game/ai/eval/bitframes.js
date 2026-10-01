// THE CLOCK, SO THE ARITHMETIC IS NEVER ASKED A QUESTION IT CANNOT ANSWER.
//
// bitmatch.js is exact on a board where everything has landed. It is not exact
// on one where panels are still in the air, and that is not a flaw in the
// arithmetic — it is missing input. A still picture of the board records where
// each panel sits and not that it has yet to land, and what a hovering panel
// does next depends on a FRAME COUNTDOWN that the picture does not carry.
//
// So this carries the countdown. It is the engine's panel loop, on the same
// states and the same timers, run from a snapshot that includes them.
//
// A THIRD IMPLEMENTATION OF A RULE IS ONLY SAFE IF DRIFT CANNOT LAND. This one
// is checked in LOCKSTEP against a real PanelEngine.Stack — every panel's
// colour, state and timer compared on every frame, not just the answer at the
// end — so the frame the two disagree on is the frame the gate names. And the
// run rule itself is NOT copied: PanelRules.scanRuns decides a match here
// exactly as it does for the engine and for LogicalBoard.
//
// What is deliberately absent, because none of it changes what a static
// position resolves to: the rise, incoming garbage, input, score, health and
// stop time.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../../panel-rules.js'));
    else root.BitFrames = factory(root.PanelRules);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (PanelRules) {
    'use strict';

    var W = 6;

    // The engine's clearFlags, all of it. It RESETS THE STATE — a panel that
    // has finished popping goes back to being an ordinary empty cell — and
    // clears the combo bookkeeping, the swap flags and the garbage-fall
    // counter. Leaving any of it out strands a cell in the state it popped
    // from, and nothing above it ever learns the cell went empty.
    function clearFlags(p, clearChaining) {
        p.state = 'normal';
        p.comboIndex = null;
        p.comboSize = null;
        p.swapFromLeft = null;
        p.dontSwap = false;
        p.queuedHover = false;
        if (clearChaining) p.chaining = false;
        p.fellFromGarbage = 0;
        p.stateChanged = false;
        p.propagatesChaining = false;
        p.matchAnyway = false;
    }

    function clearPanel(p, clearChaining, clearColor) {
        if (clearColor) p.color = 0;
        p.timer = 0; p.initialTime = 0; p.popTime = 0; p.popIndex = 0;
        p.xOffset = null; p.yOffset = null; p.gWidth = 0; p.gHeight = 0;
        p.shakeTime = 0; p.isGarbage = false;
        clearFlags(p, clearChaining);
    }

    function makePanel(row, col) {
        var p = { row: row, col: col, color: 0, chaining: false, matching: false,
                  comboIndex: 0, comboSize: 0, garbageId: 0, fellFromGarbage: 0,
                  queuedHover: false, dontSwap: false, propagatesFalling: false };
        clearPanel(p, true, true);
        return p;
    }

    function below(st, p) { return st.panels[p.row - 1][p.col]; }

    function switchPanels(st, a, b) {
        var aRow = a.row, aCol = a.col;
        a.row = b.row; a.col = b.col;
        b.row = aRow; b.col = aCol;
        st.panels[a.row][a.col] = a;
        st.panels[b.row][b.col] = b;
    }

    function supportedFromBelow(st, p) {
        if (p.row <= 1) return true;
        if (!p.isGarbage) return st.panels[p.row - 1][p.col].color !== 0;
        // Garbage rests if ANY column under the WHOLE block is blocked — a
        // 6-wide slab on one panel does not fall. An empty cell under it holds
        // nothing up, so it keeps looking; only another row of the SAME block
        // fails to count as support.
        var start = p.col - p.xOffset, end = start + p.gWidth - 1;
        for (var col = start; col <= end; col++) {
            var b = st.panels[p.row - 1][col];
            if (b.color === 0) continue;
            if (!b.isGarbage) return true;
            if (p.garbageId === b.garbageId) {
                if (p.yOffset !== b.yOffset) return true;
            } else {
                return true;
            }
        }
        return false;
    }

    function fall(st, p) {
        var b = below(st, p);
        switchPanels(st, p, b);
        if (p.isGarbage) { b.propagatesFalling = true; b.stateChanged = true; }
        if (p.state !== 'falling') { p.state = 'falling'; p.timer = 0; p.stateChanged = true; }
    }

    function land(st, p) {
        if (p.isGarbage) { p.state = 'normal'; }
        else { p.fellFromGarbage = 0; p.state = 'landing'; p.timer = 12; }
        p.stateChanged = true;
    }

    function enterHoverFromNormal(st, p, b, hoverTime) {
        clearFlags(p, false);
        p.state = 'hovering';
        if (b.propagatesChaining) {
            p.propagatesChaining = true;
            p.chaining = true;
            if (b.color === 0 || b.matchAnyway) {
                p.matchAnyway = true;
            } else {
                var source = b;
                while (source.state === 'swapping' ||
                       (source.stateChanged && source.propagatesChaining &&
                        !source.matchAnyway && source.state === 'hovering')) {
                    source = below(st, source);
                }
                if (source.propagatesChaining) p.matchAnyway = source.color === 0 || source.matchAnyway;
            }
        }
        p.timer = hoverTime;
        p.stateChanged = true;
    }

    function popped(st, p) {
        st.panelsCleared++;
        clearPanel(p, true, true);
        p.propagatesChaining = true;
        p.stateChanged = true;
    }

    function updateNormal(st, p) {
        if (p.isGarbage) { if (!supportedFromBelow(st, p)) fall(st, p); return; }
        if (p.color === 0 || p.row < 1) return;
        var b = below(st, p);
        if (!b.stateChanged) return;
        if (b.state === 'hovering') {
            enterHoverFromNormal(st, p, b, b.timer);
        } else if (b.color === 0) {
            if (b.propagatesFalling) fall(st, p);
            else if (b.state === 'normal') enterHoverFromNormal(st, p, b, st.frames.HOVER);
        } else if (b.queuedHover && b.propagatesChaining && b.state === 'swapping') {
            var hoverTime = b.timer, hp = below(st, b);
            while (hp && hp.state === 'swapping') {
                hoverTime += hp.timer;
                hp = hp.row > 1 ? below(st, hp) : null;
            }
            hoverTime += (hp && hp.state === 'hovering') ? hp.timer : st.frames.HOVER;
            enterHoverFromNormal(st, p, b, hoverTime);
        }
    }

    function finishSwap(p) { p.state = 'normal'; p.dontSwap = false; p.stateChanged = true; }

    function updateSwapping(st, p) {
        if (p.timer > 0) p.timer--;
        if (p.timer === 0) {
            var b = p.row > 1 ? below(st, p) : null;
            if (p.color === 0 || !b) { finishSwap(p); }
            else if (b.color === 0 || b.state === 'hovering' || p.queuedHover) {
                clearFlags(p, false);
                p.state = 'hovering';
                p.propagatesChaining = b.propagatesChaining;
                p.matchAnyway = (b.color !== 0 && b.state === 'hovering') ? b.matchAnyway : false;
                p.timer = st.frames.HOVER;
                p.stateChanged = true;
            } else { finishSwap(p); }
        }
    }

    function updateMatched(st, p) {
        if (p.timer > 0) p.timer--;
        if (p.timer !== 0) return;
        if (p.isGarbage) {
            if (p.yOffset === -1) {
                // A ROW CONVERTED INSIDE THIS RUN HAS NO COLOURS -- the engine deals
                // them from its rng at the match -- so the run is marked and stops. A
                // row converted before the snapshot carries its colours (see build)
                // and becomes panels like the engine's.
                if (p.color === 9) st.brokeGarbage = true;
                clearPanel(p, false, false);
                p.chaining = true;
                p.propagatesChaining = true;
                p.timer = st.frames.GARBAGE_HOVER;
                p.fellFromGarbage = 12;
                p.state = 'hovering';
                p.stateChanged = true;
            } else {
                p.state = 'normal';
            }
        } else {
            p.state = 'popping';
            p.timer = p.comboIndex * st.frames.POP;
            p.stateChanged = true;
        }
    }

    function updatePopping(st, p) {
        if (p.timer > 0) p.timer--;
        if (p.timer !== 0) return;
        if (p.comboSize === p.comboIndex) {
            popped(st, p);
        } else {
            p.state = 'popped';
            p.timer = (p.comboSize - p.comboIndex) * st.frames.POP;
            p.stateChanged = true;
        }
    }

    function updatePopped(st, p) {
        if (p.timer > 0) p.timer--;
        if (p.timer === 0) popped(st, p);
    }

    function updateHovering(st, p) {
        if (p.timer > 0) p.timer--;
        if (p.matchAnyway) p.matchAnyway = false;
        if (p.timer === 0) {
            var b = below(st, p);
            if (b.state === 'hovering') p.timer = b.timer;
            else if (b.color !== 0) land(st, p);
            else fall(st, p);
        }
        if (!p.stateChanged && p.fellFromGarbage) p.fellFromGarbage--;
    }

    function updateFalling(st, p) {
        if (p.row === 1) {
            land(st, p);
        } else if (supportedFromBelow(st, p)) {
            if (p.isGarbage) { land(st, p); }
            else {
                var b = below(st, p);
                if (b.state === 'hovering') {
                    clearFlags(p, false);
                    p.state = 'hovering';
                    p.stateChanged = true;
                    p.propagatesChaining = b.propagatesChaining;
                    p.timer = b.timer;
                } else { land(st, p); }
            }
        } else {
            fall(st, p);
        }
        if (!p.stateChanged && p.fellFromGarbage) p.fellFromGarbage--;
    }

    function updateLanding(st, p) {
        updateNormal(st, p);
        if (!p.stateChanged) {
            if (p.timer > 0) p.timer--;
            if (p.timer === 0) { p.state = 'normal'; p.stateChanged = true; }
        }
    }

    function updatePanel(st, p) {
        p.stateChanged = false;
        p.propagatesChaining = false;
        p.propagatesFalling = false;
        p.matching = false;
        switch (p.state) {
            case 'normal': updateNormal(st, p); break;
            case 'swapping': updateSwapping(st, p); break;
            case 'matched': updateMatched(st, p); break;
            case 'popping': updatePopping(st, p); break;
            case 'popped': updatePopped(st, p); break;
            case 'hovering': updateHovering(st, p); break;
            case 'falling': updateFalling(st, p); break;
            case 'landing': updateLanding(st, p); break;
            default: break;
        }
    }

    function canMatch(p) {
        if (p.color === 0 || p.color === 9) return false;
        return p.state === 'normal' || p.state === 'landing' || (p.matchAnyway && p.state === 'hovering');
    }

    function sortByPopOrder(list, isGarbage) {
        return list.sort(function (a, b) {
            if (a.row === b.row) return isGarbage ? b.col - a.col : a.col - b.col;
            return isGarbage ? a.row - b.row : b.row - a.row;
        });
    }

    // Every garbage panel the match touches, and every block those touch in
    // turn. The two eligibility guards are the engine's: a block keeps colour 9
    // for its whole clear animation, so one already clearing is not re-entered.
    function connectedGarbage(st, matching) {
        var seen = {}, queue = [], found = [];
        function addNeighbour(row, col) {
            var deltas = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (var d = 0; d < deltas.length; d++) {
                var r = row + deltas[d][0], c = col + deltas[d][1];
                if (r < 1 || r >= st.panels.length || c < 1 || c > W) continue;
                var q = st.panels[r][c];
                if (!q.isGarbage || q.color !== 9 || q.state !== 'normal') continue;
                if (seen[q.garbageId]) continue;
                seen[q.garbageId] = true;
                queue.push(q.garbageId);
            }
        }
        for (var i = 0; i < matching.length; i++) addNeighbour(matching[i].row, matching[i].col);
        while (queue.length) {
            var id = queue.shift(), block = [];
            for (var row = 1; row < st.panels.length; row++) {
                for (var col = 1; col <= W; col++) {
                    var p = st.panels[row][col];
                    if (p.isGarbage && p.garbageId === id && p.color === 9) block.push(p);
                }
            }
            for (var b = 0; b < block.length; b++) { found.push(block[b]); addNeighbour(block[b].row, block[b].col); }
        }
        return found;
    }

    function clearChainingFlags(st) {
        for (var row = 1; row < st.panels.length; row++) {
            for (var col = 1; col <= W; col++) {
                var p = st.panels[row][col];
                if (!p.chaining) continue;
                if (p.color === 0 || p.state === 'normal' || p.state === 'landing') {
                    if (!p.matching) p.chaining = false;
                }
            }
        }
    }

    function checkMatches(st) {
        var H = st.height, stride = W + 2;
        var eff = new Int8Array((H + 2) * stride), matching = [], row, col, p, i;
        for (row = 1; row <= H; row++) {
            for (col = 1; col <= W; col++) {
                p = st.panels[row][col];
                eff[row * stride + col] = (p && canMatch(p)) ? p.color : 0;
            }
        }
        PanelRules.scanRuns(eff, W, H, stride, function (mr, mc) {
            var panel = st.panels[mr][mc];
            if (panel && !panel.matching) { panel.matching = true; matching.push(panel); }
        });
        for (i = 0; i < matching.length; i++) {
            if (matching[i].state === 'hovering') matching[i].chaining = false;
        }

        var comboSize = matching.length;
        if (comboSize > 0) {
            var f = st.frames, isChainLink = false;
            for (i = 0; i < comboSize; i++) if (matching[i].chaining) isChainLink = true;
            if (isChainLink) st.chainCounter = st.chainCounter === 0 ? 2 : st.chainCounter + 1;
            st.rounds++;
            sortByPopOrder(matching, false);
            for (i = 0; i < comboSize; i++) {
                p = matching[i];
                p.state = 'matched';
                p.timer = f.FLASH + f.FACE + 1;
                if (isChainLink) p.chaining = true;
                p.fellFromGarbage = 0;
                p.comboIndex = i + 1;
                p.comboSize = comboSize;
            }
            var garbage = connectedGarbage(st, matching);
            // A ROW OF A BROKEN SLAB TAKES COLOURS FROM THE ENGINE'S OWN RNG.
            // Those are not on the board yet and nothing here may invent them,
            // so the run stops and says so. A board snapshotted AFTER the
            // conversion carries the colours already, and runs normally.
            if (garbage.length) st.brokeGarbage = true;
            if (garbage.length) {
                var onScreen = 0;
                for (i = 0; i < garbage.length; i++) if (garbage[i].row <= st.height) onScreen++;
                var t = f.FLASH + f.FACE + f.POP * (comboSize + onScreen);
                sortByPopOrder(garbage, true);
                for (i = 0; i < garbage.length; i++) {
                    p = garbage[i];
                    p.yOffset -= 1;
                    p.gHeight -= 1;
                    p.state = 'matched';
                    p.timer = t + 1;
                    p.initialTime = t;
                    p.popTime = f.POP * (onScreen - (i + 1));
                    p.popIndex = Math.min(i + 1, 10);
                }
            }
        }
        clearChainingFlags(st);
    }

    function hasChainingPanels(st) {
        for (var row = 1; row < st.panels.length; row++) {
            for (var col = 1; col <= W; col++) if (st.panels[row][col].chaining) return true;
        }
        return false;
    }

    function anyBusy(st) {
        for (var row = 1; row < st.panels.length; row++) {
            for (var col = 1; col <= W; col++) {
                var p = st.panels[row][col];
                if (p.color !== 0 && p.state !== 'normal') return true;
            }
        }
        return false;
    }

    function allowsSwap(p) {
        if (p.dontSwap || p.isGarbage) return false;
        return p.state === 'normal' || p.state === 'swapping' ||
               p.state === 'landing' || p.state === 'falling';
    }

    // The engine's canSwap. The rule that matters here: a panel cannot be
    // pulled out from under a HOVERING one, which is exactly the situation a
    // broken slab creates — so a plan made in that window has to ask.
    function canSwap(st, row, col) {
        if (row < 1 || row > st.height || col < 1 || col >= W) return false;
        var left = st.panels[row][col], right = st.panels[row][col + 1];
        if (left.color === 0 && right.color === 0) return false;
        if (!allowsSwap(left) || !allowsSwap(right)) return false;
        var above1 = null, above2 = null;
        if (row < st.height) {
            above1 = st.panels[row + 1][col];
            above2 = st.panels[row + 1][col + 1];
            if (above1.state === 'hovering' || above2.state === 'hovering') return false;
        }
        if (left.color === 0 || right.color === 0) {
            if (above1 && above2 && above1.state === 'swapping' && above2.state === 'swapping' &&
                (above1.color === 0 || above2.color === 0) &&
                (above1.color !== 0 || above2.color !== 0)) return false;
            if (row > 1) {
                var b1 = st.panels[row - 1][col], b2 = st.panels[row - 1][col + 1];
                if (b1.state === 'swapping' && b2.state === 'swapping' &&
                    (b1.color === 0 || b2.color === 0) &&
                    (b1.color !== 0 || b2.color !== 0)) return false;
            }
        }
        return true;
    }

    function startSwap(p, fromLeft) {
        var chaining = p.chaining;
        clearFlags(p, false);
        p.stateChanged = true;
        p.state = 'swapping';
        p.chaining = chaining;
        p.timer = 4;
        p.swapFromLeft = fromLeft;
        p.fellFromGarbage = 0;
    }

    // A swap is not instant: both panels enter 'swapping' for four frames and
    // only then settle or hover. A panel swapped over a hole cannot be swapped
    // back, because it is already on its way down.
    function doSwap(st, row, col) {
        var panels = st.panels;
        var left = panels[row][col], right = panels[row][col + 1];
        startSwap(left, true);
        startSwap(right, false);
        switchPanels(st, left, right);
        var tmp = left; left = right; right = tmp;
        if (row !== 1) {
            if (left.color !== 0 && (panels[row - 1][col].color === 0 ||
                panels[row - 1][col].state === 'falling')) left.dontSwap = true;
            if (right.color !== 0 && (panels[row - 1][col + 1].color === 0 ||
                panels[row - 1][col + 1].state === 'falling')) right.dontSwap = true;
        }
        if (row !== st.height) {
            if (left.color === 0 && panels[row + 1][col].color !== 0) left.dontSwap = true;
            if (right.color === 0 && panels[row + 1][col + 1].color !== 0) right.dontSwap = true;
        }
    }

    // snapshot: { grid, blocks, motion, chaining } as a planner reads the board.
    // grid holds colours, -2 for garbage; motion[r][c] is the engine's own
    // { state, timer, ... } for a panel it still has in flight.
    function build(snapshot, frames, height) {
        var H = height || 12, rows = H + 4;
        var st = { panels: [], height: H, frames: frames, chainCounter: 0,
                   panelsCleared: 0, rounds: 0, clock: 0 };
        for (var r = 0; r < rows; r++) {
            st.panels[r] = [];
            for (var c = 0; c <= W + 1; c++) st.panels[r][c] = makePanel(r, c);
        }
        var blockOf = {}, gid = 1, id;
        for (id in (snapshot.blocks || {})) {
            var cells = snapshot.blocks[id].cells || snapshot.blocks[id];
            var minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity, i;
            for (i = 0; i < cells.length; i++) {
                if (cells[i][0] < minR) minR = cells[i][0];
                if (cells[i][0] > maxR) maxR = cells[i][0];
                if (cells[i][1] < minC) minC = cells[i][1];
                if (cells[i][1] > maxC) maxC = cells[i][1];
            }
            for (i = 0; i < cells.length; i++) {
                blockOf[cells[i][0] + ':' + cells[i][1]] = {
                    id: gid, xOffset: cells[i][1] - minC, yOffset: cells[i][0] - minR,
                    gWidth: maxC - minC + 1, gHeight: maxR - minR + 1
                };
            }
            gid++;
        }
        for (r = 1; r <= H; r++) {
            for (var c2 = 1; c2 <= W; c2++) {
                var v = snapshot.grid[r] ? snapshot.grid[r][c2] : 0;
                var p = st.panels[r][c2];
                if (v === 0 || v === undefined) continue;
                if (v === -2) {
                    var g = blockOf[r + ':' + c2];
                    p.color = 9; p.isGarbage = true;
                    p.garbageId = g ? g.id : 1;
                    p.xOffset = g ? g.xOffset : 0; p.yOffset = g ? g.yOffset : 0;
                    p.gWidth = g ? g.gWidth : 1; p.gHeight = g ? g.gHeight : 1;
                    p.state = 'normal';
                } else {
                    p.color = v;
                    p.state = 'normal';
                }
                var m = snapshot.motion && snapshot.motion[r] && snapshot.motion[r][c2];
                if (m) {
                    p.state = m.state;
                    p.timer = m.timer || 0;
                    if (m.initialTime !== undefined) p.initialTime = m.initialTime;
                    if (m.popTime !== undefined) p.popTime = m.popTime;
                    if (m.popIndex !== undefined) p.popIndex = m.popIndex;
                    if (m.comboIndex !== undefined) p.comboIndex = m.comboIndex;
                    if (m.comboSize !== undefined) p.comboSize = m.comboSize;
                    if (m.fellFromGarbage !== undefined) p.fellFromGarbage = m.fellFromGarbage;
                    if (m.matchAnyway !== undefined) p.matchAnyway = !!m.matchAnyway;
                    if (m.xOffset !== undefined && m.xOffset !== null) p.xOffset = m.xOffset;
                    if (m.yOffset !== undefined && m.yOffset !== null) p.yOffset = m.yOffset;
                    if (m.gWidth) p.gWidth = m.gWidth;
                    if (m.gHeight) p.gHeight = m.gHeight;
                    // THE ROW A BREAK IS CONVERTING ALREADY HAS ITS COLOURS:
                    // convertGarbagePanels deals them at the match, while the cells are
                    // still garbage. The grid reads them as -2, the motion carries them.
                    if (p.isGarbage && m.color > 0 && m.color !== 9) p.color = m.color;
                }
                if (snapshot.chaining && snapshot.chaining[r] && snapshot.chaining[r][c2]) p.chaining = true;
            }
        }
        return st;
    }

    // One frame, in the engine's own order.
    function step(st) {
        checkMatches(st);
        for (var row = 1; row < st.panels.length; row++) {
            for (var col = 1; col <= W; col++) updatePanel(st, st.panels[row][col]);
        }
        if (st.chainCounter !== 0 && !hasChainingPanels(st)) st.chainCounter = 0;
        st.clock++;
    }

    // Run until nothing is in flight. The budget is a guard, not a schedule.
    function settle(st, budget) {
        var peakChain = 0, guard = budget || 2000;
        while (guard-- > 0) {
            step(st);
            if (st.chainCounter > peakChain) peakChain = st.chainCounter;
            if (st.brokeGarbage) {
                return { scope: 'garbage-broke', chain: st.rounds ? Math.max(peakChain, 1) : 0,
                         total: st.panelsCleared, rounds: st.rounds, frames: st.clock };
            }
            if (!anyBusy(st)) break;
        }
        return { scope: 'ok', chain: st.rounds ? Math.max(peakChain, 1) : 0, total: st.panelsCleared,
                 rounds: st.rounds, frames: st.clock };
    }

    function readGrid(st) {
        var g = [];
        for (var r = 0; r <= st.height; r++) {
            g[r] = [];
            for (var c = 1; c <= W; c++) {
                var p = st.panels[r][c];
                g[r][c] = p.isGarbage ? -2 : (p.color || 0);
            }
        }
        return g;
    }

    function readStates(st) {
        var s = [];
        for (var r = 0; r <= st.height; r++) {
            s[r] = [];
            for (var c = 1; c <= W; c++) {
                var p = st.panels[r][c];
                s[r][c] = p.color === 0 && !p.isGarbage ? null : { state: p.state, timer: p.timer };
            }
        }
        return s;
    }

    return { build: build, step: step, settle: settle, readGrid: readGrid,
             readStates: readStates, anyBusy: anyBusy, canSwap: canSwap, doSwap: doSwap };
}));
