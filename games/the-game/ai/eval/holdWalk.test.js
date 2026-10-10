#!/usr/bin/env node
// THE CURSOR'S WALK IN THE FEWEST KEYS: node holdWalk.test.js
//
// A walk held down gets the cursor to the cell the taps would, no later, and
// costs one action instead of one per cell. Run on the engine's stack from
// every start square, each direction, walks of 1 to 9 cells.
var assert = require('assert');
var PA = require('./pa-engine.js'), K = require('./survivor_keys.js'), IN = PA.IN;
function game() { var g = PA.game({ level: 10, seed: 3 }); for (var i = 0; i < 400 && g.inCountdown; i++) g.run(); return g; }
var DIRS = [IN.right, IN.left, IN.up, IN.down];
// the keys as the search writes them: a tap every four frames, the swap the frame after the last
function taps(dir, n, base, dir2, n2) {
  var a = [];
  [[dir, n], [dir2, n2]].forEach(function (leg) { for (var k = 0; k < (leg[1] || 0); k++) { a.push(leg[0] | base); if (k < leg[1] - 1 || (leg === undefined)) a.push(base, base, base); } if (leg[1]) a.push(base, base, base); });
  while (a.length && a[a.length - 1] === base) a.pop();
  a.push(IN.swap | base); for (var t = 0; t < 12; t++) a.push(base); return a;
}
function play(inputs, row, col) {
  var g = game(); g.curRow = row; g.curCol = col; var seen = [];
  for (var f = 0; f < inputs.length; f++) { g.setInput(inputs[f] & ~IN.swap); if (inputs[f] & IN.swap) g.pressSwap = true; g.run(); seen.push([g.curRow, g.curCol]); }
  return { seen: seen, swapAt: inputs.indexOf(IN.swap | (inputs[1] & 32)) };
}
function presses(a) { var n = 0, prev = 0; a.forEach(function (b) { var d = b & ~prev & (IN.right | IN.left | IN.down | IN.up | IN.swap); for (var k = 1; k <= 16; k <<= 1) if (d & k) n++; prev = b; }); return n; }
var checked = 0, saved = 0;
[0, IN.raise].forEach(function (base) {
  DIRS.forEach(function (dir) {
    for (var n = 1; n <= 9; n++) for (var row = 3; row <= 9; row += 3) for (var col = 1; col <= 5; col += 2) {
      var tap = taps(dir, n, base), held = K.holdWalks(tap), swapFrame = tap.indexOf(IN.swap | base);
      assert.strictEqual(held.length, tap.length);
      assert.strictEqual(held[swapFrame], tap[swapFrame], 'the swap stays on its frame');
      var a = base ? null : play(tap, row, col), b = base ? null : play(held, row, col);
      // the cursor is on the same square when the swap goes down, and at the end
      if (!base) {   // a held raise scrolls the stack under the cursor, so squares are compared without it
        assert.deepStrictEqual(b.seen[swapFrame], a.seen[swapFrame], 'dir ' + dir + ' n ' + n + ' from ' + row + ',' + col + ': the swap square');
        assert.deepStrictEqual(b.seen[b.seen.length - 1], a.seen[a.seen.length - 1], 'the end square');
      }
      if (n < 4) assert.deepStrictEqual(held.slice(), tap, 'a walk the swap follows at once is held from four cells');
      else { assert(presses(held) < presses(tap)); saved += presses(tap) - presses(held); }
      checked++;
    }
  });
});
// a walk followed by another walk, then the swap
[0, IN.raise].forEach(function (base) {
  [[IN.right, IN.down], [IN.left, IN.up]].forEach(function (d) {
    for (var n = 1; n <= 6; n++) for (var m = 1; m <= 6; m++) {
      var tap = taps(d[0], n, base, d[1], m), held = K.holdWalks(tap), sf = tap.indexOf(IN.swap | base);
      assert.strictEqual(held[sf], tap[sf], 'the swap stays on its frame');
      if (!base) {
        var a = play(tap, 6, 3), b = play(held, 6, 3);
        assert.deepStrictEqual(b.seen[sf], a.seen[sf], 'two walks ' + n + ',' + m + ': the swap square');
      }
      assert(presses(held) <= presses(tap));
      checked++;
    }
  });
});
// other keys in the sequence are left as they are
var mixed = [IN.right, 0, 0, 0, IN.right, 0, 0, 0, IN.down, 0, 0, 0, IN.down, 0, 0, 0, IN.down, 0, 0, 0, IN.down, IN.swap | 0];
assert.strictEqual(K.holdWalks(mixed)[0], IN.right);
assert.strictEqual(K.holdWalks(mixed)[mixed.length - 1], IN.swap);
console.log('holdWalk: ok (' + checked + ' walks, ' + saved + ' presses saved)');
