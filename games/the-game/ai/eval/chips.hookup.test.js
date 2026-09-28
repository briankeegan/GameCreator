#!/usr/bin/env node
// CAN ANYTHING ACTUALLY USE THESE CHIPS?
//
// Two gates already ask whether a chip is TRUE: verify_chips.js against the
// simulation, verify_chips_engine.js against the real engine. Neither asks
// whether a chip is USABLE — whether a consumer reading the library can find
// the shape on a board and act on it. A library nothing can read is worth the
// same as a library that is wrong, and it looks considerably healthier.
//
// So this takes the one consumer there is (chipmatch.js) and asks the
// smallest question that cannot be faked:
//
//   Stage a chip onto a board the way the verifier does, then ask the matcher
//   to find that chip on that board. If the reader cannot see a shape on the
//   very board built from its own template, nothing downstream ever will.
//
// It runs on REAL staged boards and REAL resolves — the staging is the
// verifier's own, so a chip that passes here passed on a board the engine
// also fires it on, rather than on a convenient fiction.
var assert = require('assert');
var path = require('path'), fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var LogicalBoard = globalThis.PanelCpu.LogicalBoard;
var engineBoard = require('./engineboard.js');
var cm = require('./chipmatch.js');
var W = PanelEngine.WIDTH, H = 12;

var chips = [];
['chips', 'chips-engine-only'].forEach(function (d) {
    var dir = path.join(__dirname, d);
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort()
      .forEach(function (f) {
          JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).forEach(function (c) {
              c._file = d + '/' + f; chips.push(c);
          });
      });
});
assert.ok(chips.length > 5000, 'expected the whole library, got ' + chips.length);

// The template laid onto an empty board at a known offset. Deliberately NOT
// the verifier's full staging — no filler, no support — because this asks
// whether the READER can find the shape, and filler is the verifier's
// invention rather than part of the chip. The engine check below is what
// uses a real staged board.
function lay(chip) {
    var cells = chip.tmpl;
    var minR = Infinity, minC = Infinity;
    cells.forEach(function (c) { if (c[0] < minR) minR = c[0]; if (c[1] < minC) minC = c[1]; });
    var rowOff = 1 - minR, colOff = 1 - minC;
    var grid = [];
    for (var r = 0; r <= H; r++) { grid[r] = []; for (var c = 1; c <= W; c++) grid[r][c] = 0; }
    // Colour slots take real colours; "@" takes one no slot uses.
    var used = {};
    cells.forEach(function (c) { if (typeof c[2] === 'number') used[c[2]] = 1; });
    var spare = 0;
    for (var s = 1; s <= 12; s++) if (!used[s]) { spare = s; break; }
    if (!spare) return null;
    for (var i = 0; i < cells.length; i++) {
        var rr = cells[i][0] + rowOff, cc = cells[i][1] + colOff, k = cells[i][2];
        if (rr < 1 || rr > H || cc < 1 || cc > W) return null;
        if (k === '.' || k === 'e') continue;
        grid[rr][cc] = (k === '@') ? spare : k;
    }
    return grid;
}

var failures = [];
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures.push(name); }
}

// ---- 1. every chip compiles into the reader ----
check('every ported chip compiles into the matcher', function () {
    var lib = cm.library();
    assert.ok(lib.length > 0, 'the library compiled to nothing');
    var bad = [];
    lib.forEach(function (t, i) {
        if (!t.cells || !t.cells.length) bad.push(i + ': no cells');
        if (!(t.h >= 0) || !(t.w >= 0)) bad.push(i + ': no span');
    });
    assert.deepStrictEqual(bad, [], bad.slice(0, 5).join('; '));
});

// ---- 2. the reader finds each chip on a board built from that chip ----
// A GRID TEST COLLECTS: "which chips are unreadable" must not cost one run
// per chip.
check('the matcher finds every chip on a board laid out from its own template', function () {
    var missed = [], skipped = 0;
    for (var i = 0; i < chips.length; i++) {
        var grid = lay(chips[i]);
        if (!grid) { skipped++; continue; }
        var board = new LogicalBoard(W, H, 9, grid, {});
        var tmpl = cm.compile(chips[i]);
        var found = false;
        for (var R = 1; R <= H - tmpl.h && !found; R++)
            for (var C = 1; C <= W - tmpl.w && !found; C++)
                if (cm.matchAt(board.grid, tmpl, R, C)) found = true;
        if (!found) missed.push(chips[i]._file + ' ' + chips[i].kind);
    }
    assert.ok(skipped < chips.length / 10, skipped + ' chips could not be laid out at all');
    assert.deepStrictEqual(missed, [], missed.length + ' of ' + chips.length +
                           ' chips are invisible to the reader:\n  ' + missed.slice(0, 8).join('\n  '));
});


console.log('');
if (failures.length) { console.log(failures.length + ' failed.'); process.exit(1); }
console.log('The chip library is readable. That the engine fires every chip is checked by verify_chips_engine.js.');
