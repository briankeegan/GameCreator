#!/usr/bin/env node
// DO THESE CHIP TEMPLATES ACTUALLY FIRE IN OUR ENGINE?
//
//   node verify_chips.js [chips/batch1-chain.json]
//
// The chips come from the owner's Panel Attack fork (bot/chipCache.lua on
// claude/bot-verification-handoff-w7b53s), where the header says
// "engine-verified". That was Panel Attack's Lua engine. panel-cpu.js's
// LogicalBoard is a separate implementation of the same rules, so the claim
// has to be re-earned here before a chip is allowed to steer the bot — a
// template that fires there and not here would make the bot chase a shape
// that pays nothing, and nothing downstream would say so.
//
// IT IS DELIBERATELY RUN IN BATCHES, SMALLEST FIRST. 6,270 chips arriving at
// once would mean tuning the staging harness against thousands of failures
// with no way to tell a bad chip from a badly-staged one. Batch 1 is the six
// pure CHAIN chips, which are self-supporting and cannot be mis-staged. See
// chips/README.md.
var path = require('path');
var fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var W = 6, H = 12;

// WITH NO ARGUMENT, EVERY BATCH. A gate pinned to one filename stops
// covering the library the moment a second batch lands, and nothing says so.
var dir = path.join(__dirname, 'chips');
var files = process.argv[2] ? [process.argv[2]]
    : fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); })
        .sort().map(function (f) { return path.join(dir, f); });
var chips = [];
files.forEach(function (f) {
    JSON.parse(fs.readFileSync(f, 'utf8')).forEach(function (c) {
        c._file = path.basename(f);
        chips.push(c);
    });
});

// tmpl is [dr, dc, class] relative to the swap; dr + 1 is one row UP.
// class: integer = colour slot, "." / "e" = must be empty, "@" = a solid that
// is not one of the solving colours (staged as garbage, which never matches).
function stage(chip, colorMap) {
    var cells = chip.tmpl;
    var drs = cells.map(function (c) { return c[0]; });
    var dcs = cells.map(function (c) { return c[1]; });
    var minR = Math.min.apply(null, drs);
    var minC = Math.min.apply(null, dcs), maxC = Math.max.apply(null, dcs);
    if (maxC - minC + 1 > W) return { skip: 'wider than the board' };
    var rowOff = 1 - minR, colOff = 1 - minC;
    var g = [];
    for (var r = 0; r <= H; r++) { g[r] = []; for (var c = 1; c <= W; c++) g[r][c] = 0; }
    var mustEmpty = {};
    for (var i = 0; i < cells.length; i++) {
        var rr = cells[i][0] + rowOff, cc = cells[i][1] + colOff, k = cells[i][2];
        if (rr < 1 || rr > H || cc < 1 || cc > W) return { skip: 'does not fit' };
        if (k === '.' || k === 'e') { mustEmpty[rr + ',' + cc] = 1; continue; }
        g[rr][cc] = (k === '@') ? -2 : (colorMap[k] || k);
    }
    // A panel with nothing under it falls, and a chip describes a SETTLED
    // board, so anything hanging gets propped with garbage — never over a
    // cell the template says must be empty. A chip that needs a prop there
    // is one this harness cannot stage, which is reported, not guessed at.
    for (var c2 = 1; c2 <= W; c2++) {
        var top = 0;
        for (var r2 = H; r2 >= 1; r2--) if (g[r2][c2] !== 0) { top = r2; break; }
        for (var r3 = top - 1; r3 >= 1; r3--) {
            if (g[r3][c2] !== 0) continue;
            if (mustEmpty[r3 + ',' + c2]) return { skip: 'needs support where the template demands empty' };
            g[r3][c2] = -2;
        }
    }
    return { board: new LogicalBoard(W, H, 6, g, {}), rowOff: rowOff, colOff: colOff };
}

var MAP = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
var pass = 0, fail = 0, skipped = 0;
console.log('verifying ' + chips.length + ' chips from ' +
    files.map(function (f) { return path.basename(f); }).join(', ') + '\n');

chips.forEach(function (chip) {
    var label = '  ' + chip.kind.padEnd(13);
    if (chip.swaps.length !== 1) { console.log(label + 'SKIP  multi-swap, needs the swap-settle-swap harness'); skipped++; return; }
    var st = stage(chip, MAP);
    if (st.skip) { console.log(label + 'SKIP  ' + st.skip); skipped++; return; }

    // The board must be STILL before the swap, or whatever happens next is
    // the staging resolving itself rather than the chip firing.
    if (st.board.clone().resolve().chainLength !== 0) {
        console.log(label + 'FAIL  the staged board is not settled — it resolves before the swap');
        fail++; return;
    }
    var sw = chip.swaps[0];
    var r = sw[0] + st.rowOff, c = sw[1] + st.colOff;
    if (r < 1 || r > H || c < 1 || c >= W) { console.log(label + 'SKIP  swap falls off the board'); skipped++; return; }

    var t = st.board.clone();
    t.swap(r, c);
    var out = t.resolve();
    var total = out.comboSizes.reduce(function (a, b) { return a + b; }, 0);
    // TWO DIFFERENT THINGS ARE BOTH CALLED "chain", and conflating them
    // failed 60 of 60 plain COMBO chips while the clear counts matched
    // exactly — which is the shape of a harness bug, not a library one.
    // Panel Attack's meta.chain is the CHAIN COUNTER: 0 means "clears, but
    // nothing cascades", 2 means a 2-chain. LogicalBoard.resolve() reports
    // the number of match-and-settle ROUNDS, so the same plain combo is 1.
    // They agree from 2 upward and differ only at the bottom.
    var wantChain = Math.max(1, chip.chain);
    var okChain = out.chainLength === wantChain;
    var okTotal = total === chip.total;
    if (okChain && okTotal) {
        console.log(label + 'ok    chain ' + out.chainLength + ', ' + total + ' cleared');
        pass++;
    } else {
        console.log(label + 'FAIL  claims chain ' + chip.chain + ' (= ' + wantChain +
                    ' rounds) / ' + chip.total + ' cleared, ours gives ' +
                    out.chainLength + ' rounds / ' + total);
        fail++;
    }
});

console.log('\n' + pass + ' verified, ' + fail + ' failed, ' + skipped + ' skipped');

// A SKIPPED CHIP IS NOT A VERIFIED CHIP, so a skip fails the batch too.
// Found by the break test: moving a chip's swap off its own shape put the
// swap outside the staged footprint, which read as "cannot stage" and exited
// 0 — a corrupted chip passing as fine. A batch file is a claim that every
// chip in it has been re-earned against this engine; anything this harness
// could not put a number on belongs in a later batch, not in a green run.
if (skipped) {
    console.log('  a skipped chip is not a verified chip — move it to a later batch ' +
                'rather than shipping a batch that only partly checked out');
}
process.exit((fail || skipped) ? 1 : 0);
