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
    var used = {};
    for (var u0 = 0; u0 < cells.length; u0++) {
        if (typeof cells[u0][2] === 'number') used[cells[u0][2]] = 1;
    }
    var spare = [];
    for (var sc0 = 1; sc0 <= 12 && spare.length < 4; sc0++) if (!used[sc0]) spare.push(sc0);
    if (spare.length < 4) return { skip: 'no spare colours for blockers and props' };
    var g = [];
    for (var r = 0; r <= H; r++) { g[r] = []; for (var c = 1; c <= W; c++) g[r][c] = 0; }
    var mustEmpty = {};
    for (var i = 0; i < cells.length; i++) {
        var rr = cells[i][0] + rowOff, cc = cells[i][1] + colOff, k = cells[i][2];
        if (rr < 1 || rr > H || cc < 1 || cc > W) return { skip: 'does not fit' };
        if (k === '.' || k === 'e') { mustEmpty[rr + ',' + cc] = 1; continue; }
        // "@" IS A PANEL, NOT GARBAGE. chipCache's own header calls it
        // "blocker(solid,not-a-solving-color)" — an ordinary panel in a
        // colour that takes no part in the chip. Staging it as garbage made
        // the chip's OWN swap illegal wherever the swap lands on one (16 of
        // the chips already ported turned out to be swapping a garbage block
        // with a panel, a move no player can make, and passing anyway).
        // Staged as a spare colour it blocks, falls and swaps like the real
        // thing and still cannot join a match.
        g[rr][cc] = (k === '@') ? '@' : (colorMap[k] || k);
    }
    for (var ar = 1; ar <= H; ar++) for (var ac = 1; ac <= W; ac++) {
        if (g[ar][ac] === '@') g[ar][ac] = spare[3];
    }

    // GROUND UNDER THE SWAP'S OWN PAIR, AND NOWHERE ELSE.
    //
    // A template describes a local pattern on a board that is packed
    // underneath, and says nothing about columns it does not touch. Stage it
    // on an empty field and the swap can push a panel sideways into a column
    // with no ground: gravity takes it away before _findMatches runs, so the
    // swap really did line three up and the chip reads as firing nothing.
    //
    // Exactly two cells, because wider is wrong. Bedding the whole swap row
    // instead broke 54 chips that already verified — a don't-care gap below
    // the pattern is often the very hole the cascade falls into, and a
    // harness must not fill holes the chip is using.
    //
    // Panels in a colour the chip does not use, never over a cell the
    // template says must be empty. Garbage will not do: our engine pops
    // garbage that a match touches, and a garbage bed failed all 161 chips
    // that were already verified.
    // Narrower still: only the cell that RECEIVES a panel and has nothing
    // under it. Propping both halves of the pair was net worse — the other
    // half is usually the gap the panel came out of, and the cascade wants
    // that gap open.
    var swapRow = chip.swaps[0][0] + rowOff, swapCol = chip.swaps[0][1] + colOff;
    var bedCells = [];
    if (swapRow > 1 && swapCol >= 1 && swapCol < W) {
        var a = g[swapRow][swapCol], b = g[swapRow][swapCol + 1];
        var post = [[swapCol, b], [swapCol + 1, a]];   // what each column holds after the swap
        for (var pi = 0; pi < 2; pi++) {
            var col = post[pi][0], val = post[pi][1];
            if (!val) continue;                                   // lands empty: nothing to hold up
            if (g[swapRow - 1][col] !== 0) continue;              // already supported
            if (mustEmpty[(swapRow - 1) + ',' + col]) continue;   // the template wants that gap
            g[swapRow - 1][col] = spare[(swapRow - 1 + 2 * col) % 3];
            bedCells.push([swapRow - 1, col]);
        }
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
            // PROPS ARE PANELS, NOT GARBAGE. Garbage is wrong twice over: the
            // real game cannot swap it (legalSwaps rejects any pair touching
            // a negative cell), and our engine pops garbage that a match
            // touches, so a prop beside a clear vanishes and everything above
            // it drops. Tracing one failure found the harness swapping a
            // garbage prop with a panel — a move no player could make —
            // because swap() applies whatever it is told.
            //
            // Checkerboarded across two colours the chip does not use, so the
            // props can never line up three of a kind with each other or join
            // a match with the template.
            g[r3][c2] = spare[(r3 + 2 * c2) % 3];
        }
    }
    // Which colours this harness invented, and how many of them there are.
    // Counted by COLOUR rather than by cell: a cascade drops everything above
    // it, so filler moves rather than disappearing.
    var fillerColours = {}, fillerBefore = 0;
    fillerColours[spare[0]] = 1; fillerColours[spare[1]] = 1; fillerColours[spare[2]] = 1;
    for (var qr = 1; qr <= H; qr++) for (var qc = 1; qc <= W; qc++) {
        if (fillerColours[g[qr][qc]]) fillerBefore++;
    }
    return { board: new LogicalBoard(W, H, 6, g, {}), rowOff: rowOff, colOff: colOff,
             bedCells: bedCells, fillerColours: fillerColours, fillerBefore: fillerBefore };
}

var MAP = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
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
console.log('verifying ' + chips.length + ' chips from ' +
    files.map(function (f) { return path.basename(f); }).join(', ') + '\n');

chips.forEach(function (chip) {
    var label = '  ' + chip.kind.padEnd(38);
    if (chip.swaps.length > 2) { console.log(label + 'SKIP  more than two swaps'); record(chip, 'skip'); skipped++; return; }
    var st = stage(chip, MAP);
    if (st.skip) { console.log(label + 'SKIP  ' + st.skip); record(chip, 'skip'); skipped++; return; }

    // The board must be STILL before the swap, or whatever happens next is
    // the staging resolving itself rather than the chip firing.
    if (st.board.clone().resolve().chainLength !== 0) {
        console.log(label + 'FAIL  the staged board is not settled — it resolves before the swap');
        record(chip, 'fail');
        fail++; return;
    }
    var sw = chip.swaps[0];
    var r = sw[0] + st.rowOff, c = sw[1] + st.colOff;
    if (r < 1 || r > H || c < 1 || c >= W) { console.log(label + 'SKIP  swap falls off the board'); record(chip, 'skip'); skipped++; return; }

    // THE SWAP MUST BE ONE THE GAME WOULD ALLOW. swap() applies whatever it
    // is handed; legalSwaps() is what knows the rules (nothing touching
    // garbage, not two of the same, not two empties). Skipping this check is
    // how the harness came to swap a garbage prop with a panel and then
    // report the chip as firing the wrong thing.
    // NOTHING THIS HARNESS ADDS MAY BE GARBAGE. Both staging bugs found so
    // far were garbage: "@" blockers staged as garbage made 16 chips' own
    // swaps illegal, and garbage props pop when a match touches them, which
    // silently drops everything above. A staged board is all panels now, so
    // any garbage left in one means that rule has been broken again.
    for (var gr = 1; gr <= H; gr++) for (var gc = 1; gc <= W; gc++) {
        if (st.board.grid[gr][gc] === -2) {
            console.log(label + 'FAIL  staged board contains garbage at (' + gr + ',' + gc +
                        ') — the harness must stage blockers and props as panels');
            record(chip, 'fail');
            fail++; return;
        }
    }
    // TWO SWAPS, RESOLVED BETWEEN THEM. LogicalBoard has no clock and no
    // rise, so "settle" here is just resolve() — which is the one place this
    // simulation is EASIER to be right about than the engine, where a fixed
    // frame budget let the stack rise a row between the two swaps.
    var t = st.board.clone();
    var out = { chainLength: 0, comboSizes: [] }, total = 0;
    for (var si = 0; si < chip.swaps.length; si++) {
        var sr = chip.swaps[si][0] + st.rowOff, sc = chip.swaps[si][1] + st.colOff;
        if (sr < 1 || sr > H || sc < 1 || sc >= W) { console.log(label + 'SKIP  swap falls off the board'); record(chip, 'skip'); skipped++; return; }
        var legal = t.legalSwaps().some(function (m) { return m[0] === sr && m[1] === sc; });
        if (!legal) {
            console.log(label + 'FAIL  staged board makes swap ' + (si + 1) + ' of this chip illegal ' +
                        '(' + sr + ',' + sc + ') — the staging is wrong, not the chip');
            record(chip, 'fail');
            fail++; return;
        }
        t.swap(sr, sc);
        var step = t.resolve();
        var stepTotal = step.comboSizes.reduce(function (a, b) { return a + b; }, 0);
        if (si === 0 && chip.swaps.length === 2 && stepTotal) {
            console.log(label + 'FAIL  the setup swap clears ' + stepTotal +
                        ' panels on its own — it is supposed to only set up');
            record(chip, 'fail');
            fail++; return;
        }
        total += stepTotal;
        if (step.chainLength > out.chainLength) out.chainLength = step.chainLength;
        out.comboSizes = out.comboSizes.concat(step.comboSizes);
    }
    // NO FILLER MAY EVER MATCH — the generator's own rule, and until now only
    // the ENGINE verifier enforced it. That gap is exactly how two chips came
    // to pass the simulation and fail the game, which is the one direction
    // that could ship a bad chip: the simulation was not asking the question.
    // Both verifiers ask it now.
    var fillerAfter = 0;
    for (var vr = 1; vr <= H; vr++) for (var vc = 1; vc <= W; vc++) {
        if (st.fillerColours[t.grid[vr][vc]]) fillerAfter++;
    }
    if (fillerAfter < st.fillerBefore) {
        console.log(label + 'FAIL  ' + (st.fillerBefore - fillerAfter) + ' filler panels cleared — ' +
                    'this harness\'s support is taking part in the chip, so the numbers are the staging');
        record(chip, 'fail');
        fail++; return;
    }

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
        record(chip, 'ok');
        pass++;
    } else {
        console.log(label + 'FAIL  claims chain ' + chip.chain + ' (= ' + wantChain +
                    ' rounds) / ' + chip.total + ' cleared, ours gives ' +
                    out.chainLength + ' rounds / ' + total);
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
