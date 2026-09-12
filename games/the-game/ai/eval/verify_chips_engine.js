#!/usr/bin/env node
// DO THESE CHIPS FIRE IN THE GAME ITSELF?
//
//   node verify_chips_engine.js [chips/batch1-chain.json]
//
// verify_chips.js checks them against LogicalBoard — the bot's SIMULATION of
// the board, the thing it clones a few hundred times a decision. That is the
// right first gate, because it is what the search will actually reason with.
// It is not the game. panel-engine.js is the game: hover frames, pop timers,
// garbage timing, a chain counter that only increments when a matched panel
// was already flagged chaining. A chip can be true of the simulation and
// false of the engine, and a bot built on the first would chase shapes that
// pay nothing on the second, with nothing downstream to say so.
//
// So a chip has to pass BOTH, and this is the second one. It stages the
// template onto a live Stack, asks the engine's own canSwap whether the move
// is legal, performs it with the engine's own doSwap, runs frames until the
// board is still, and reads the chain depth and cleared count off the match
// events the engine emits for itself.
var path = require('path');
var fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
var PanelEngine = globalThis.PanelEngine;
var W = PanelEngine.WIDTH;

var dir = path.join(__dirname, 'chips');
var files = process.argv[2] ? [process.argv[2]]
    : fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); })
        .sort().map(function (f) { return path.join(dir, f); });
var chips = [];
files.forEach(function (f) {
    JSON.parse(fs.readFileSync(f, 'utf8')).forEach(function (c) { chips.push(c); });
});

// The same staging rules verify_chips.js uses, and for the same reasons:
// "@" is a panel in a colour the chip does not use, props are panels rather
// than garbage, and the cell the swap lands in gets ground under it.
function layout(chip) {
    var cells = chip.tmpl;
    var drs = cells.map(function (c) { return c[0]; });
    var dcs = cells.map(function (c) { return c[1]; });
    var minR = Math.min.apply(null, drs);
    var minC = Math.min.apply(null, dcs), maxC = Math.max.apply(null, dcs);
    if (maxC - minC + 1 > W) return { skip: 'wider than the board' };
    var rowOff = 1 - minR, colOff = 1 - minC;
    var used = {};
    cells.forEach(function (c) { if (typeof c[2] === 'number') used[c[2]] = 1; });
    var spare = [];
    for (var s = 1; s <= 12 && spare.length < 4; s++) if (!used[s]) spare.push(s);
    if (spare.length < 4) return { skip: 'no spare colours' };

    var H = 12;
    var grid = [];
    for (var r = 0; r <= H; r++) { grid[r] = []; for (var c = 1; c <= W; c++) grid[r][c] = 0; }
    var mustEmpty = {};
    for (var i = 0; i < cells.length; i++) {
        var rr = cells[i][0] + rowOff, cc = cells[i][1] + colOff, k = cells[i][2];
        if (rr < 1 || rr > H || cc < 1 || cc > W) return { skip: 'does not fit' };
        if (k === '.' || k === 'e') { mustEmpty[rr + ',' + cc] = 1; continue; }
        grid[rr][cc] = (k === '@') ? spare[3] : k;
    }
    var swapRow = chip.swaps[0][0] + rowOff, swapCol = chip.swaps[0][1] + colOff;
    if (swapRow > 1 && swapCol >= 1 && swapCol < W) {
        var a = grid[swapRow][swapCol], b = grid[swapRow][swapCol + 1];
        [[swapCol, b], [swapCol + 1, a]].forEach(function (p) {
            if (!p[1]) return;
            if (grid[swapRow - 1][p[0]] !== 0) return;
            if (mustEmpty[(swapRow - 1) + ',' + p[0]]) return;
            grid[swapRow - 1][p[0]] = spare[(swapRow - 1 + 2 * p[0]) % 3];
        });
    }
    for (var c2 = 1; c2 <= W; c2++) {
        var top = 0;
        for (var r2 = H; r2 >= 1; r2--) if (grid[r2][c2] !== 0) { top = r2; break; }
        for (var r3 = top - 1; r3 >= 1; r3--) {
            if (grid[r3][c2] !== 0) continue;
            if (mustEmpty[r3 + ',' + c2]) return { skip: 'needs support where the template demands empty' };
            grid[r3][c2] = spare[(r3 + 2 * c2) % 3];
        }
    }
    var fillerColours = {}, fillerBefore = 0;
    fillerColours[spare[0]] = 1; fillerColours[spare[1]] = 1; fillerColours[spare[2]] = 1;
    for (var fr = 1; fr <= H; fr++) for (var fc = 1; fc <= W; fc++) {
        if (fillerColours[grid[fr][fc]]) fillerBefore++;
    }
    return { grid: grid, swapRow: swapRow, swapCol: swapCol, H: H, rowOff: rowOff, colOff: colOff,
             fillerColours: fillerColours, fillerBefore: fillerBefore };
}

// Write a grid onto a live Stack. The engine keeps Panel objects in place and
// mutates them, so the panels are reset rather than replaced — anything left
// over (a timer, a chaining flag, a garbage size) would run on after the swap
// and be read as part of the chip.
function paint(stack, grid, H) {
    for (var r = 0; r < stack.panels.length; r++) {
        for (var c = 1; c <= W; c++) {
            var p = stack.panels[r][c];
            if (!p) continue;
            p.color = (r >= 1 && r <= H) ? (grid[r][c] || 0) : 0;
            p.state = 'normal';
            p.timer = 0; p.initialTime = 0; p.popTime = 0; p.popIndex = 0;
            p.chaining = false; p.matching = false; p.isGarbage = false;
            p.fellFromGarbage = 0; p.stateChanged = false;
            p.propagatesChaining = false; p.matchAnyway = false;
            p.xOffset = null; p.yOffset = null;
            p.gWidth = 0; p.gHeight = 0; p.shakeTime = 0;
        }
    }
}

// RUN UNTIL THE BOARD IS STILL, THEN STOP — NOT FOR A FIXED NUMBER OF FRAMES.
//
// riseLock and speed = 0 do not hold the stack still forever: the engine
// re-decides riseLock every frame (it is set when something is active, not
// kept by us), so a fixed 900-frame settle let the board RISE A ROW between
// the two swaps of a two-swap chip. The second swap then addressed the cells
// the first swap's panels used to be in, and thirteen perfectly good chips
// read as clearing nothing. A probe of the same chip, running 400 frames,
// cleared 3 — the two disagreed because of idle frames, not the chip.
//
// So the budget is only a backstop against a board that never settles, and
// the real exit is stillness: no active panels, no chaining panels. That is
// exactly the condition the fork's own generators wait on
// (getComboSetups.lua: "if j >= 3 and not st:hasActivePanels() and not
// st:hasChainingPanels() then break").
function settle(stack, budget) {
    var got = { chain: 0, cleared: 0, matches: 0 };
    for (var f = 0; f < budget; f++) {
        stack.events.length = 0;
        stack.run();
        for (var i = 0; i < stack.events.length; i++) {
            var e = stack.events[i];
            if (e.type === 'match') {
                got.matches++;
                got.cleared += e.size;
                if (e.chainCounter > got.chain) got.chain = e.chainCounter;
            }
        }
        // Give it a few frames first: a swap takes some to even become
        // active, and exiting on frame 1 would call every chip inert.
        if (f >= 3 && !stack.hasActivePanels() && !stack.hasChainingPanels()) break;
    }
    return got;
}

var pass = 0, fail = 0, skipped = 0;
console.log('verifying ' + chips.length + ' chips against the REAL engine, from ' +
    files.map(function (f) { return path.basename(f); }).join(', ') + '\n');

chips.forEach(function (chip) {
    var label = '  ' + chip.kind.padEnd(30);
    if (chip.swaps.length > 2) { console.log(label + 'SKIP  more than two swaps'); skipped++; return; }
    var lay = layout(chip);
    if (lay.skip) { console.log(label + 'SKIP  ' + lay.skip); skipped++; return; }

    // A stack with the rise stopped, so nothing arrives mid-chip and changes
    // the answer. Level 10 is what the bot plays.
    var stack = new PanelEngine.Stack({ level: 10, seed: 7 });
    var guard = 0;
    while (!stack.stopWatchIsRunning && guard++ < 1000) stack.run();
    stack.riseLock = true;
    stack.speed = 0;
    paint(stack, lay.grid, lay.H);
    stack.curRow = lay.swapRow; stack.curCol = lay.swapCol;

    // Let it sit: the board must be STILL before the swap, or whatever follows
    // is the staging settling rather than the chip firing.
    var pre = settle(stack, 30);
    if (pre.matches) {
        console.log(label + 'FAIL  the staged board resolves on its own before the swap');
        fail++; return;
    }
    // TWO SWAPS, SETTLED BETWEEN THEM, CURSOR TELEPORTED — which is exactly
    // how the fork's getComboSetups.lua verifies them: for each swap in
    // order it assigns cur_row/cur_col outright and then runs frames until
    // hasActivePanels and hasChainingPanels are both false.
    //
    // So the walk between the two swaps is NOT part of the chip's
    // definition. cursorMoves (and the MOVE_n in the kind, which always
    // agrees with it — checked below) is what the chip COSTS to play, in
    // cursor steps, and travel.js is what turns that into frames for the
    // planner. Verification asks whether the shape works; the move count
    // prices it afterwards. Conflating the two would make a chip's validity
    // depend on how fast the cursor happens to be.
    var got = { chain: 0, cleared: 0, matches: 0 };
    for (var si = 0; si < chip.swaps.length; si++) {
        var sr = chip.swaps[si][0] + lay.rowOff, sc = chip.swaps[si][1] + lay.colOff;
        if (!stack.canSwap(sr, sc)) {
            console.log(label + 'FAIL  the engine refuses swap ' + (si + 1) +
                        ' of this chip at (' + sr + ',' + sc + ')');
            fail++; return;
        }
        stack.curRow = sr; stack.curCol = sc;
        stack.doSwap(sr, sc);
        var step = settle(stack, 900);
        // The setup swap must set up, not score. The generator keeps a chip
        // only if the first swap clears nothing.
        if (si === 0 && chip.swaps.length === 2 && step.matches) {
            console.log(label + 'FAIL  the setup swap clears ' + step.cleared +
                        ' panels on its own — it is supposed to only set up');
            fail++; return;
        }
        got.cleared += step.cleared;
        got.matches += step.matches;
        if (step.chain > got.chain) got.chain = step.chain;
    }

    // THE MOVE COUNT MUST BE THE ONE THE PLANNER WILL PAY. cursorMoves is
    // the Manhattan distance between the two swap cells, and travel.js
    // charges the cursor for exactly that walk. A chip whose recorded cost
    // disagrees with its own geometry would be priced wrong every time it
    // was considered, and nothing downstream would notice.
    if (chip.swaps.length === 2) {
        var walk = Math.abs(chip.swaps[1][0] - chip.swaps[0][0]) +
                   Math.abs(chip.swaps[1][1] - chip.swaps[0][1]);
        if (walk !== chip.nMoves) {
            console.log(label + 'FAIL  records ' + chip.nMoves + ' cursor moves but its two ' +
                        'swaps are ' + walk + ' apart — the planner would price it wrong');
            fail++; return;
        }
    }

    // The engine's chain counter is 0 for a combo that does not cascade and 2
    // for a 2-chain, exactly like the chips' own meta — no translation here,
    // unlike LogicalBoard's round count.
    // THE GENERATOR'S OWN RULE, MADE INTO A CHECK. getCascadeShapes.lua keeps a
    // chip only if "ZERO support cleared (no wildcard/filler may ever match)".
    // It could enforce that because it verified on the FULL board it built;
    // what ships is the GENERALIZED template, with the don't-care cells
    // dropped, so the filler here is this harness's invention and can match
    // where theirs did not. Left unchecked that shows up as a chip quietly
    // clearing three more panels than it claims — which is exactly what it
    // did, 37 times, until a three-colour filler replaced the checkerboard.
    // Asserted rather than hoped for, because the next filler scheme will
    // have its own blind spot.
    // COUNTED BY COLOUR, NOT BY COORDINATE. The first version of this check
    // asked whether each filler CELL still held a panel, and failed 152
    // chips that were perfectly fine: a cascade drops everything above it, so
    // a filler panel moves rather than disappears. The generator counts the
    // same way (cntFill sums colours >= 5 across the whole board).
    var fillerAfter = 0;
    for (var vr = 1; vr <= lay.H; vr++) for (var vc = 1; vc <= W; vc++) {
        var vp = stack.panels[vr][vc];
        if (vp && lay.fillerColours[vp.color]) fillerAfter++;
    }
    if (fillerAfter < lay.fillerBefore) {
        console.log(label + 'FAIL  ' + (lay.fillerBefore - fillerAfter) + ' filler panels cleared — ' +
                    'this harness\'s support is taking part in the chip, so the numbers are the staging');
        fail++; return;
    }
    var okChain = got.chain === chip.chain;
    var okTotal = got.cleared === chip.total;
    if (okChain && okTotal) {
        console.log(label + 'ok    chain ' + got.chain + ', ' + got.cleared + ' cleared');
        pass++;
    } else {
        console.log(label + 'FAIL  claims chain ' + chip.chain + ' / ' + chip.total +
                    ' cleared, the engine gives chain ' + got.chain + ' / ' + got.cleared);
        fail++;
    }
});

console.log('\n' + pass + ' verified, ' + fail + ' failed, ' + skipped + ' skipped');
if (skipped) console.log('  a skipped chip is not a verified chip');
process.exit((fail || skipped) ? 1 : 0);
