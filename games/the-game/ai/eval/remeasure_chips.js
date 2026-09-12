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
// ONE implementation of paint-and-settle, shared with the bot. This file used
// to carry its own copy; a second copy of the thing that talks to the engine
// is how LogicalBoard drifted from the engine in the first place, and it would
// quietly make "verified against the engine" stop meaning what it says.
var engineBoard = require('./engineboard.js');

// BOTH chip directories. chips/ holds what clears both boards; the engine is
// the only gate chips-engine-only/ can clear, and it must still clear it.
var files;
if (process.argv[2]) {
    files = [process.argv[2]];
} else {
    files = [];
    ['chips', 'chips-engine-only'].forEach(function (d) {
        var dir = path.join(__dirname, d);
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); })
            .sort().forEach(function (f) { files.push(path.join(dir, f)); });
    });
}
var chips = [];
files.forEach(function (f) {
    JSON.parse(fs.readFileSync(f, 'utf8')).forEach(function (c) { chips.push(c); });
});

// The same staging rules verify_chips.js uses, and for the same reasons:
// "@" is a panel in a colour the chip does not use, props are panels rather
// than garbage, and the cell the swap lands in gets ground under it.
function layout(chip, fillerOffset) {
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
    for (var s = 1; s <= 12; s++) if (!used[s]) spare.push(s);
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
    // The swap's landing cell used to be propped up here as a special case;
    // the support rule below reaches the swap row in every column the swap
    // touches, so it is redundant. See verify_chips.js for the full note.
    // FILLER COLOURS ARE DISTINCT WITHIN A COLUMN, and that is the whole
    // trick. A pattern keyed on (row, col) has no line of three while the
    // board is still — but a cascade COMPACTS columns, and any three fillers
    // in one column can end up adjacent afterwards. Keyed on (row, col) with
    // three colours, rows 1, 4 and 7 all take the same one, so they stack
    // into a match: 123 chips landed in the "filler cleared" bucket, which is
    // a staging failure wearing a chip's name. Rotating the pattern does not
    // help — an offset permutes the colours and keeps the collision.
    //
    // Compaction preserves ORDER within a column, so giving each filler in a
    // column a different colour makes a vertical filler match impossible
    // however far things drop. The per-column start is staggered so three
    // columns cannot line up horizontally either.
    // WHAT THE TEMPLATE DOES NOT MENTION IS GROUND, NOT AIR.
    //
    // The shipped chips are GENERALIZED: the generator verified each one on a
    // full board and then dropped every cell the shape did not depend on. A
    // dropped cell was a panel of some irrelevant colour — it is NOT empty.
    // Empty is spelled out, as "." or "e".
    //
    // Filling only the gaps below a column's topmost PANEL therefore leaves a
    // column whose sole template cell is a required-empty, or the cell the
    // swap lands in, with no floor under it at all. The swapped panel then
    // free-falls past the one-row gap the chip is built around and lands on
    // the bottom row, so the cascade it exists to start never happens and the
    // chip reads as firing nothing. That was 672 chips — every one of them a
    // CASCADE, which is the whole point of the library.
    //
    // So a column's support runs up to the highest row the template says
    // ANYTHING about in that column: a panel, a required-empty, or a swap
    // cell (either half of the pair — the swap moves a panel between them).
    var reach = {};
    function touch(r, c) { if (c >= 1 && c <= W && !(reach[c] > r)) reach[c] = r; }
    for (var ti = 0; ti < cells.length; ti++) touch(cells[ti][0] + rowOff, cells[ti][1] + colOff);
    for (var si2 = 0; si2 < chip.swaps.length; si2++) {
        touch(chip.swaps[si2][0] + rowOff, chip.swaps[si2][1] + colOff);
        touch(chip.swaps[si2][0] + rowOff, chip.swaps[si2][1] + colOff + 1);
    }
    // The LOWEST required-empty cell in a column is the ceiling of its
    // support: below it the column is solid ground; at and above it the
    // template is describing the hole the chip falls into. A template PANEL
    // above that hole would be floating, which no settled board can hold —
    // that is the one genuinely unstageable shape, and it is skipped.
    var holeAt = {};
    for (var mk in mustEmpty) {
        var mr = +mk.split(',')[0], mc = +mk.split(',')[1];
        if (!(holeAt[mc] <= mr)) holeAt[mc] = mr;
    }
    for (var hc = 1; hc <= W; hc++) {
        if (holeAt[hc] === undefined) continue;
        for (var hr = holeAt[hc] + 1; hr <= H; hr++) {
            if (grid[hr][hc] !== 0) return { skip: 'needs support where the template demands empty' };
        }
    }
    for (var c2 = 1; c2 <= W; c2++) {
        var top = Math.min(reach[c2] === undefined ? 0 : reach[c2],
                           holeAt[c2] === undefined ? 1e9 : holeAt[c2]);
        var nth = 0;
        for (var r3 = 1; r3 < top; r3++) {
            if (grid[r3][c2] !== 0) continue;
            // The retry varies the column STAGGER, not just an additive
            // offset: adding a constant permutes the colours and preserves
            // every collision, which is why rotating the offset alone
            // recovered exactly zero chips. Different staggers space the
            // columns differently, so a horizontal run of three fillers that
            // survives compaction under one does not under another.
            var stagger = [2, 3, 5][(fillerOffset || 0) % 3];
            grid[r3][c2] = spare[(nth + stagger * c2 + (fillerOffset || 0)) % spare.length];
            nth++;
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

// Does the support take part, on this staging? Runs the chip on its own
// scratch Stack so the answer costs nothing but time and cannot disturb the
// real attempt.
function fillerTakesPart(chip, lay) {
    var st = engineBoard.scratch(10);
    st.speed = 0;
    engineBoard.paint(st, lay.grid, lay.H, W);
    engineBoard.settle(st, 30);
    for (var si = 0; si < chip.swaps.length; si++) {
        var sr = chip.swaps[si][0] + lay.rowOff, sc = chip.swaps[si][1] + lay.colOff;
        if (!st.canSwap(sr, sc)) return false;
        st.curRow = sr; st.curCol = sc;
        st.doSwap(sr, sc);
        engineBoard.settle(st, 900);
    }
    var after = 0;
    for (var r = 1; r <= lay.H; r++) for (var c = 1; c <= W; c++) {
        var p = st.panels[r][c];
        if (p && lay.fillerColours[p.color]) after++;
    }
    return after < lay.fillerBefore;
}

// ---------------------------------------------------------------------------
// RE-MEASURE THE CHAIN DEPTH THE FORK NEVER MEASURED.
//
//   node remeasure_chips.js <in.json> <out.json>
//
// 594 chips were left unported because the chain depth they claim is one
// deeper than our engine reaches. Traced, the claim is the soft part, not the
// engine:
//
//   516 of them are SETUP (two-swap) chips, and the fork's own generator says
//   in a comment that it never measured them — "a SETUP fires the SAME combo
//   as its base, so inherit what it DOES (clears/garbage/chain/timing) with NO
//   engine call" (bot/chipAnalyze.lua). The setup swap changes the board; the
//   inherited depth did not.
//
//   The rest were measured, and contradict themselves. Stack:incrementChainCounter
//   only fires when a matched panel is already `chaining`, which on a SETTLED
//   board the first match never is — so chain 3 needs THREE matches. Every one
//   of these produces two, while clearing EXACTLY the panel count it claims. A
//   third match would have to clear three more panels and break that total.
//   The fork measured them on a board that still had a chaining panel on it;
//   engineboard.paint() clears that flag on every panel, so ours provably
//   starts clean — and a clean board is the only thing the bot can plan from.
//
// So the shape is real and the panel count is confirmed exactly. Only `chain`
// is wrong, and it is rewritten here to what the engine actually does.
//
// WHAT IS AND IS NOT CORRECTED. Only chips whose cleared panel count matches
// `total` EXACTLY survive — that is the evidence the shape is right and the
// number is the only casualty. A chip whose panels are also wrong is a chip
// this harness cannot vouch for, and it is dropped rather than tuned green.
//
// Provenance is kept, not laundered: the corrected chip carries chainClaimed
// (what the fork recorded) and chainSource: "measured" beside the new chain,
// so nothing downstream mistakes our number for theirs.
var outPath = process.argv[3];
if (!outPath) { console.error('usage: remeasure_chips.js <in.json> <out.json>'); process.exit(2); }

var fixed = [], dropped = 0, unchanged = 0, reasons = {};
function drop(why) { dropped++; reasons[why] = (reasons[why] || 0) + 1; }

chips.forEach(function (chip) {
    if (chip.swaps.length > 2) return drop('more than two swaps');
    var lay = null, attempt;
    for (attempt = 0; attempt < 3; attempt++) {
        var tryLay = layout(chip, attempt);
        if (tryLay.skip) { lay = tryLay; break; }
        if (!fillerTakesPart(chip, tryLay)) { lay = tryLay; break; }
        lay = tryLay;
    }
    if (lay.skip) return drop('cannot be staged');

    var stack = engineBoard.scratch(10);
    stack.speed = 0;
    engineBoard.paint(stack, lay.grid, lay.H, W);
    stack.curRow = lay.swapRow; stack.curCol = lay.swapCol;
    if (engineBoard.settle(stack, 30).comboSizes.length) return drop('staged board resolves before the swap');

    var chain = 0, cleared = 0;
    for (var si = 0; si < chip.swaps.length; si++) {
        var sr = chip.swaps[si][0] + lay.rowOff, sc = chip.swaps[si][1] + lay.colOff;
        if (!stack.canSwap(sr, sc)) return drop('the engine refuses one of its swaps');
        stack.curRow = sr; stack.curCol = sc;
        stack.doSwap(sr, sc);
        var step = engineBoard.settle(stack, 900);
        if (si === 0 && chip.swaps.length === 2 && step.comboSizes.length)
            return drop('the setup swap scores on its own');
        cleared += step.clearedPanels;
        var counter = step.chainLength >= 2 ? step.chainLength : 0;
        if (counter > chain) chain = counter;
    }
    if (chip.swaps.length === 2) {
        var walk = Math.abs(chip.swaps[1][0] - chip.swaps[0][0]) +
                   Math.abs(chip.swaps[1][1] - chip.swaps[0][1]);
        if (walk !== chip.nMoves) return drop('its move count disagrees with its own geometry');
    }
    var fillerAfter = 0;
    for (var vr = 1; vr <= lay.H; vr++) for (var vc = 1; vc <= W; vc++) {
        var vp = stack.panels[vr][vc];
        if (vp && lay.fillerColours[vp.color]) fillerAfter++;
    }
    if (fillerAfter < lay.fillerBefore) return drop('the staging support takes part');

    // THE PANEL COUNT IS THE EVIDENCE. It is not corrected, ever — a chip that
    // clears a different number of panels than it claims is a different chip.
    if (cleared !== chip.total) return drop('clears a different number of panels than it claims');
    if (chain === chip.chain) { unchanged++; return; }

    var out = {};
    Object.keys(chip).forEach(function (k) { if (k[0] !== '_') out[k] = chip[k]; });
    out.chainClaimed = chip.chain;
    out.chain = chain;
    out.chainSource = 'measured';
    fixed.push(out);
});

fs.writeFileSync(outPath, JSON.stringify(fixed));
console.log('corrected   : ' + fixed.length);
console.log('already ok  : ' + unchanged);
console.log('dropped     : ' + dropped);
Object.keys(reasons).sort().forEach(function (r) { console.log('    ' + String(reasons[r]).padStart(4) + '  ' + r); });
