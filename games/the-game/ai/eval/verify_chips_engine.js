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
// SAME BOARD, BOTH ENGINES. GC_COMPARE_SIM=1 also runs LogicalBoard on the
// exact staged grid this file builds, and requires the two to agree.
//
// Why here rather than in resolve_fidelity.js: that tool compares on real
// in-play boards, and real play does not throw up the deep cascade shapes the
// library is made of. One of the four faults in LogicalBoard's resolve —
// matched panels vanishing instantly instead of holding their neighbours up
// for the dozens of frames a pop really takes — was invisible on 50,797 real
// cases and showed on 28 chip shapes. A gate that cannot see a fault it was
// built for is not a gate, so the chips get the same treatment.
var COMPARE_SIM = process.env.GC_COMPARE_SIM === '1';
var LogicalBoard = globalThis.PanelCpu && globalThis.PanelCpu.LogicalBoard;
if (COMPARE_SIM && !LogicalBoard) { require(path.join(__dirname, '..', '..', 'panel-cpu.js')); LogicalBoard = globalThis.PanelCpu.LogicalBoard; }
var simDiffer = 0, simSame = 0;
function compareSim(chip, lay, engChain, engCleared, stack) {
    var g = [];
    for (var r = 0; r <= lay.H; r++) { g[r] = []; for (var c = 1; c <= W; c++) g[r][c] = lay.grid[r][c]; }
    var lb = new LogicalBoard(W, lay.H, 9, g, {});
    var sChain = 0, sCleared = 0;
    for (var i = 0; i < chip.swaps.length; i++) {
        lb.swap(chip.swaps[i][0] + lay.rowOff, chip.swaps[i][1] + lay.colOff);
        var res = lb.resolve();
        sCleared += (res.comboSizes || []).reduce(function (a, b) { return a + b; }, 0);
        var cc = res.chainLength >= 2 ? res.chainLength : 0;
        if (cc > sChain) sChain = cc;
    }
    // AND THE BOARD ITSELF, not just the totals. Two engines can agree on
    // chain depth and panels cleared and still leave the panels in different
    // columns — and the next decision is made on the board, not on the score.
    // That comparison is what exposed the rising-harness bug; totals alone
    // were blind to it.
    var gridSame = true, why = '';
    for (var gr = 1; gr <= lay.H && gridSame; gr++) {
        for (var gc = 1; gc <= W; gc++) {
            var ep = stack.panels[gr] && stack.panels[gr][gc];
            var ev = !ep ? 0 : (ep.isGarbage ? -2 : (ep.color || 0));
            var sv = lb.grid[gr][gc] || 0;
            if (ev !== sv) { gridSame = false; why = 'r' + gr + 'c' + gc + ': engine ' + ev + ', simulation ' + sv; break; }
        }
    }
    if (sChain === engChain && sCleared === engCleared && gridSame) { simSame++; return; }
    simDiffer++;
    if (simDiffer <= 5) {
        console.log('  SIM DIFFERS  ' + chip.kind + '  engine ' + engChain + '/' + engCleared +
                    '  simulation ' + sChain + '/' + sCleared +
                    (gridSame ? '' : '  BOARD ' + why));
    }
}

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

var pass = 0, fail = 0, skipped = 0;
// A MACHINE-READABLE VERDICT, so no caller has to read the prose.
//
// Three separate bugs in this session came from parsing this file's own
// output: a kind longer than the padding ran into the word "ok" and the chip
// read as failing, twice; and a caller reading 4,380 verdict lines back
// through a pipe got a SHORT READ that varied run to run, which looks
// exactly like 1,200 chips failing. Prose is for people. GC_CHIP_JSON=<path>
// writes one entry per chip, and a caller that finds fewer entries than
// chips knows it rather than guessing.
// EXACTLY ONE VERDICT PER CHIP, BY CONSTRUCTION.
//
// The call sites are scattered across a dozen early returns, and getting the
// count right by placing them carefully failed twice in opposite directions:
// first six chips recorded nothing (an un-instrumented skip path), so a
// caller's index alignment silently slipped and five good chips read as
// failing; then a pass that added the missing calls produced THREE entries
// for some chips. Both are the same bug — the count depending on where the
// calls happen to sit. So the first record for a chip wins and the rest are
// ignored, and a chip that somehow records nothing is caught by the
// end-of-run check rather than shipping a short list.
var results = [];
var recordedFor = null;
function record(chip, verdict, why) {
    if (recordedFor === chip) return;
    recordedFor = chip;
    results.push({ kind: chip.kind, file: chip._file || null, verdict: verdict, why: why || '' });
}
console.log('verifying ' + chips.length + ' chips against the REAL engine, from ' +
    files.map(function (f) { return path.basename(f); }).join(', ') + '\n');

chips.forEach(function (chip) {
    var label = '  ' + chip.kind.padEnd(38);
    if (chip.swaps.length > 2) { console.log(label + 'SKIP  more than two swaps'); record(chip, 'skip'); skipped++; return; }
    // TRY A FEW FILLER PATTERNS BEFORE BLAMING THE CHIP.
    //
    // The support is this harness's invention, and the generator's own rule is
    // that support must never match. A three-colour pattern keyed on (row,
    // col) has no line of three while the board is still — but a cascade
    // COMPACTS columns, and rows 1, 4 and 7 all take the same colour, so three
    // fillers can end up stacked after the drop. That put 123 chips in the
    // "filler cleared" bucket, which is a staging failure wearing a chip's
    // name.
    //
    // So the offset is rotated and the chip re-staged until the support keeps
    // out of it. If no offset works the chip is reported as before — but it is
    // then a fact about the chip rather than about which colours I happened to
    // pick.
    var lay = null, attempt;
    for (attempt = 0; attempt < 3; attempt++) {
        var tryLay = layout(chip, attempt);
        if (tryLay.skip) { lay = tryLay; break; }
        if (!fillerTakesPart(chip, tryLay)) { lay = tryLay; break; }
        lay = tryLay;
    }
    if (lay.skip) { console.log(label + 'SKIP  ' + lay.skip); record(chip, 'skip'); skipped++; return; }

    // A stack with the rise stopped, so nothing arrives mid-chip and changes
    // the answer. Level 10 is what the bot plays.
    var stack = engineBoard.scratch(10);
    stack.speed = 0;
    engineBoard.paint(stack, lay.grid, lay.H, W);
    stack.curRow = lay.swapRow; stack.curCol = lay.swapCol;

    // Let it sit: the board must be STILL before the swap, or whatever follows
    // is the staging settling rather than the chip firing.
    var pre = engineBoard.settle(stack, 30);
    if (pre.comboSizes.length) {
        console.log(label + 'FAIL  the staged board resolves on its own before the swap');
        record(chip, 'fail');
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
            record(chip, 'fail');
            fail++; return;
        }
        stack.curRow = sr; stack.curCol = sc;
        stack.doSwap(sr, sc);
        var step = engineBoard.settle(stack, 900);
        // The setup swap must set up, not score. The generator keeps a chip
        // only if the first swap clears nothing.
        if (si === 0 && chip.swaps.length === 2 && step.comboSizes.length) {
            console.log(label + 'FAIL  the setup swap clears ' + step.clearedPanels +
                        ' panels on its own — it is supposed to only set up');
            record(chip, 'fail');
            fail++; return;
        }
        got.cleared += step.clearedPanels;
        got.matches += step.comboSizes.length;
        // settle() reports in resolve()'s units — a plain combo is 1 ROUND.
        // The chips record the engine's chain COUNTER, where that same combo
        // is 0. One place converts between them, and it is here.
        var counter = step.chainLength >= 2 ? step.chainLength : 0;
        if (counter > got.chain) got.chain = counter;
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
            record(chip, 'fail');
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
        record(chip, 'fail');
        fail++; return;
    }
    if (COMPARE_SIM) compareSim(chip, lay, got.chain, got.cleared, stack);
    var okChain = got.chain === chip.chain;
    var okTotal = got.cleared === chip.total;
    if (okChain && okTotal) {
        console.log(label + 'ok    chain ' + got.chain + ', ' + got.cleared + ' cleared');
        record(chip, 'ok');
        pass++;
    } else {
        console.log(label + 'FAIL  claims chain ' + chip.chain + ' / ' + chip.total +
                    ' cleared, the engine gives chain ' + got.chain + ' / ' + got.cleared);
        record(chip, 'fail');
        fail++;
    }
});

if (results.length !== chips.length) {
    console.error('INTERNAL: ' + results.length + ' verdicts for ' + chips.length +
                  ' chips — an exit path records nothing, so any caller lining ' +
                  'these up against its own list is reading the wrong chip');
    process.exit(2);
}
if (process.env.GC_CHIP_JSON) {
    fs.writeFileSync(process.env.GC_CHIP_JSON,
        JSON.stringify({ chips: chips.length, results: results }));
}
console.log('\n' + pass + ' verified, ' + fail + ' failed, ' + skipped + ' skipped');
if (COMPARE_SIM) {
    console.log(simSame + ' chips resolve IDENTICALLY on both boards, ' + simDiffer + ' differ');
    if (simDiffer) process.exit(1);
}
if (skipped) console.log('  a skipped chip is not a verified chip');
process.exit((fail || skipped) ? 1 : 0);
