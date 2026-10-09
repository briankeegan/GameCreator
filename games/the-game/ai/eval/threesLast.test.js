#!/usr/bin/env node
// THREES LAST (puyocpu.js _noBareThree, profile threesLast).
//
//   node threesLast.test.js
//
// A move whose clears are all threes, break no garbage and start no chain is
// dropped while any other move is left; it is kept when it is all there is
// (the survival search has already said what lives). A three breaking
// garbage, a chain, a combo of four and a move clearing nothing all stay. A
// tall stack (THREES_FROM_ROW up) or a topped-out one may play any three.
var assert = require('assert');
var P = require('./puyocpu.js');
function cand(name, comboSizes, chainLength, brokeGarbage) {
  return { name: name, resolved: { comboSizes: comboSizes, chainLength: chainLength, brokeGarbage: brokeGarbage } };
}
var bot = Object.create(P.prototype);
bot.refuseBareThree = true; bot.bareThreesDropped = 0; bot.bareThreesKept = 0;
var bare = cand('bare', [3], 1, 0), hold = cand('hold', [], 0, 0), brk = cand('break', [3], 1, 2),
    chain = cand('chain', [3, 3], 2, 0), four = cand('four', [4], 1, 0), two3 = cand('two threes', [3, 3], 1, 0);
var names = function (l) { return l.map(function (c) { return c.name; }).join(','); };
assert.strictEqual(names(bot._noBareThree([bare, hold, brk, chain, four, two3])), 'hold,break,chain,four');
assert.strictEqual(bot.bareThreesDropped, 2);
assert.strictEqual(names(bot._noBareThree([bare, brk])), 'break');
assert.strictEqual(names(bot._noBareThree([bare])), 'bare', 'the only move left is played');
assert.strictEqual(bot.bareThreesKept, 1);
bot.stack = { wasToppedOut: true };
assert.strictEqual(names(bot._noBareThree([bare, hold])), 'bare,hold', 'topped out, a three is allowed');
bot.stack = { wasToppedOut: false };
function board(top) { var g = []; for (var r = 0; r <= 12; r++) g[r] = r >= 1 && r <= top ? [0, 1, 2, 3, 4, 5, 6] : [0, 0, 0, 0, 0, 0, 0]; return { grid: g, width: 6, height: 12 }; }
bot._board = board(7);
assert.strictEqual(names(bot._noBareThree([bare, hold])), 'hold', 'a low stack plays no bare three');
bot._board = board(bot.THREES_FROM_ROW);
assert.strictEqual(names(bot._noBareThree([bare, hold])), 'bare,hold', 'a tall stack may');
bot._board = null;
bot.refuseBareThree = false;
assert.strictEqual(names(bot._noBareThree([bare, hold])), 'bare,hold', 'off unless the profile asks');
bot._allCands = [{ kind: 'swap', move: [3, 2], resolved: brk.resolved }, { kind: 'swap', move: [4, 2], resolved: chain.resolved }];
bot._allCands.push({ kind: 'swap', move: [5, 2], resolved: bare.resolved });
assert.strictEqual(bot.threeOnlySwap([5, 2]), true);
assert.strictEqual(bot.threeOnlySwap([3, 2]), false, 'a three that breaks garbage is allowed');
assert.strictEqual(bot.threeOnlySwap([4, 2]), false);
var SP = require('./survivor_prefer.js'), prep = { br: { touch: true }, want: { '5,2': true }, popping: false };
bot.refuseBareThree = true;
assert.strictEqual(SP.overrule({ kind: 'hold' }, prep, bot).kind, 'hold', 'a three is not forced over the bot');
prep.want = { '3,2': true };
assert.deepStrictEqual(SP.overrule({ kind: 'hold' }, prep, bot).move, [3, 2], 'a break still is');
console.log('threesLast: ok');
