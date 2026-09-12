#!/usr/bin/env node
// THE FOUR CONSTRAINTS THAT GIVE A TEMPLATE ITS TEETH, PINNED DIRECTLY.
//
// A template says four things about a board: cells sharing a colour SLOT hold
// the same colour, cells in different slots hold DIFFERENT colours, a "." is
// empty, and an "@" is a panel in none of the slot colours. Drop any one and
// the matcher degenerates toward "are these cells non-empty", which matches
// almost every board and means nothing.
//
// That is not hypothetical. Two of these were silently unenforced for the
// matcher's whole first life, because the stamp arrays were Int8Array and the
// generation counter truncated past 127 — see chipmatch.js. It matched 3,538
// chips on ONE real board, 92% of which cleared nothing.
//
// It got that far because the test that existed (chips.hookup.test.js) asks
// the matcher to find a chip on a board built FROM that chip, and on such a
// board there is one placement and one colour per slot — nothing for the
// constraints to reject. A test that cannot see the defect it is nearest to
// is the shape of bug this directory keeps producing, so these are unit
// tests on the rule itself, both directions, and they run past 127 matchAt
// calls on purpose.
var assert = require('assert');
var cm = require('./chipmatch.js');
var W = 6, H = 12;

function boardOf(rows) {
    var g = [];
    for (var r = 0; r <= H; r++) { g[r] = []; for (var c = 1; c <= W; c++) g[r][c] = 0; }
    for (r = 0; r < rows.length; r++) {
        var row = rows.length - r;              // first string is the TOP row
        for (var c2 = 1; c2 <= rows[r].length; c2++) {
            var ch = rows[r][c2 - 1];
            g[row][c2] = ch === '.' ? 0 : ch === 'G' ? -2 : Number(ch);
        }
    }
    return g;
}
// A chip-shaped object is all compile() needs.
function tmpl(cells) { return cm.compile({ tmpl: cells, swaps: [[0, 0]], chain: 2, total: 6 }); }

function anywhere(grid, t) {
    for (var R = 1; R <= H - t.h; R++)
        for (var C = 1; C <= W - t.w; C++)
            if (cm.matchAt(grid, t, R, C)) return true;
    return false;
}

var failures = [];
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures.push(name); }
}

// PAST THE BYTE. Every case is run 200 times, so a stamp that truncates at
// 127 is inside the window rather than just outside it.
function repeat(fn) { var last; for (var i = 0; i < 200; i++) last = fn(); return last; }

var SAME_SLOT = [[0, 0, 1], [0, 1, 1], [0, 2, 1]];
check('cells in one slot must be the SAME colour — accepts', function () {
    assert.strictEqual(repeat(function () { return anywhere(boardOf(['333...']), tmpl(SAME_SLOT)); }), true);
});
check('cells in one slot must be the SAME colour — rejects', function () {
    assert.strictEqual(repeat(function () { return anywhere(boardOf(['345...']), tmpl(SAME_SLOT)); }), false);
});

var TWO_SLOTS = [[0, 0, 1], [0, 1, 2]];
check('two slots must be DIFFERENT colours — accepts', function () {
    assert.strictEqual(repeat(function () { return anywhere(boardOf(['34....']), tmpl(TWO_SLOTS)); }), true);
});
check('two slots must be DIFFERENT colours — rejects', function () {
    assert.strictEqual(repeat(function () { return anywhere(boardOf(['33....']), tmpl(TWO_SLOTS)); }), false);
});

var WITH_GAP = [[0, 0, 1], [0, 1, '.'], [0, 2, 1]];
check('a "." cell must be EMPTY — accepts', function () {
    assert.strictEqual(repeat(function () { return anywhere(boardOf(['3.3...']), tmpl(WITH_GAP)); }), true);
});
check('a "." cell must be EMPTY — rejects a panel sitting in it', function () {
    assert.strictEqual(repeat(function () { return anywhere(boardOf(['343...']), tmpl(WITH_GAP)); }), false);
});

var WITH_BLOCK = [[0, 0, 1], [0, 1, '@'], [0, 2, 1]];
check('an "@" must be a panel in NO slot colour — accepts', function () {
    assert.strictEqual(repeat(function () { return anywhere(boardOf(['343...']), tmpl(WITH_BLOCK)); }), true);
});
check('an "@" must be a panel in NO slot colour — rejects a slot colour', function () {
    assert.strictEqual(repeat(function () { return anywhere(boardOf(['333...']), tmpl(WITH_BLOCK)); }), false);
});
check('an "@" must be a panel in NO slot colour — rejects an empty cell', function () {
    assert.strictEqual(repeat(function () { return anywhere(boardOf(['3.3...']), tmpl(WITH_BLOCK)); }), false);
});
check('garbage is never a colour slot', function () {
    assert.strictEqual(repeat(function () { return anywhere(boardOf(['GGG...']), tmpl(SAME_SLOT)); }), false);
});

console.log('');
if (failures.length) { console.log(failures.length + ' failed.'); process.exit(1); }
console.log('The matcher enforces every constraint a template carries.');
