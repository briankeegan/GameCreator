#!/usr/bin/env node
// THE GAME'S ALLOWANCE OF KEYS, built into the decision: node allowance.test.js
//
// The game counts the swap and direction keys going down and allows 76 in any
// 600 frames. A swap that costs more keys than are left is not a candidate (a
// hold is), a calm board leaves a reserve for the moves that clear, and
// actionsFor prices a swap exactly as the keys the search writes are played.
var assert = require('assert');
var PA = require('./pa-engine.js'), IN = PA.IN, K = require('./survivor_keys.js'), P = require('./puyocpu.js');
function presses(a) { var n = 0, prev = 0; a.forEach(function (b) { var d = b & ~prev & (IN.right | IN.left | IN.down | IN.up | IN.swap); for (var k = 1; k <= 16; k <<= 1) if (d & k) n++; prev = b; }); return n; }
// the search writes the walk across, then up or down, a tap every four frames, the swap the frame after the last
function keysFor(row, col, move) {
  var a = [], legs = [[move[1] > col ? IN.right : IN.left, Math.abs(move[1] - col)], [move[0] > row ? IN.up : IN.down, Math.abs(move[0] - row)]].filter(function (l) { return l[1] > 0; });
  legs.forEach(function (l, i) { for (var k = 0; k < l[1]; k++) { a.push(l[0]); if (k < l[1] - 1 || i < legs.length - 1) a.push(0, 0, 0); } });
  a.push(IN.swap); return a;
}
for (var r = 1; r <= 11; r += 2) for (var c = 1; c <= 5; c += 2) for (var mr = 1; mr <= 11; mr += 2) for (var mc = 1; mc <= 5; mc++) {
  assert.strictEqual(K.actionsFor(r, c, [mr, mc]), presses(K.holdWalks(keysFor(r, c, [mr, mc]))), 'cost of ' + r + ',' + c + ' to ' + mr + ',' + mc);
}
var bot = Object.create(P.prototype);
bot.stack = { curRow: 6, curCol: 3 };
bot.unaffordableDropped = 0;
var hold = { kind: 'hold' }, near = { kind: 'swap', move: [6, 3] }, far = { kind: 'swap', move: [1, 5] };
bot.allowance = Infinity;
assert.strictEqual(bot._affordable([hold, near, far]).length, 3, 'no allowance given: every move');
bot.allowance = 3;
assert.deepStrictEqual(bot._affordable([hold, near, far]), [hold, near], 'what costs more than is left is not offered');
bot.allowance = 0;
assert.deepStrictEqual(bot._affordable([hold, near, far]), [hold], 'nothing left: a hold');
bot.allowance = 30; bot.allowanceCalm = true;
var clears = { kind: 'swap', move: [6, 3], resolved: { clearedPanels: 3 } };
assert.deepStrictEqual(bot._affordable([hold, near, clears]).length, 3, 'plenty left: all');
bot.allowance = 24;
assert.deepStrictEqual(bot._affordable([hold, near, clears]), [hold, clears], 'calm: a move that clears nothing leaves the reserve');
bot.allowanceCalm = false;
assert.strictEqual(bot._affordable([hold, near, clears]).length, 3, 'not calm: no reserve');
console.log('allowance: ok');
