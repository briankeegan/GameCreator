#!/usr/bin/env node
// THREES LAST (puyocpu.js _noBareThree, profile threesLast).
//
//   node threesLast.test.js
//
// A move whose clears are all threes and start no chain -- garbage broken or
// not -- is dropped while any other move is left; it is kept when it is all
// there is (the survival search has already said what lives), and when the
// stack is topped out with nothing holding it. A chain, a combo of four and a move clearing nothing
// all stay.
var assert = require('assert');
var P = require('./puyocpu.js');
function cand(name, comboSizes, chainLength, brokeGarbage) {
  return { name: name, resolved: { comboSizes: comboSizes, chainLength: chainLength, brokeGarbage: brokeGarbage } };
}
var bot = Object.create(P.prototype);
bot.refuseBareThree = true; bot.bareThreesDropped = 0; bot.bareThreesKept = 0; bot.bareThreesTopped = 0;
var bare = cand('bare', [3], 1, 0), hold = cand('hold', [], 0, 0), brk = cand('break', [3], 1, 2),
    chain = cand('chain', [3, 3], 2, 0), four = cand('four', [4], 1, 0), two3 = cand('two threes', [3, 3], 1, 0);
var names = function (l) { return l.map(function (c) { return c.name; }).join(','); };
assert.strictEqual(names(bot._noBareThree([bare, hold, brk, chain, four, two3])), 'hold,chain,four');
assert.strictEqual(bot.bareThreesDropped, 3);
assert.strictEqual(names(bot._noBareThree([bare, brk])), 'bare,break', 'threes only: all kept');
assert.strictEqual(names(bot._noBareThree([bare])), 'bare', 'the only move left is played');
assert.strictEqual(bot.bareThreesKept, 2);
bot.stack = { wasToppedOut: true };
assert.strictEqual(names(bot._noBareThree([bare, hold])), 'bare,hold', 'topped out with nothing holding it, a three is allowed');
bot.stack = { wasToppedOut: true, stopTime: 40 };
assert.strictEqual(names(bot._noBareThree([bare, hold])), 'hold', 'topped out in stop time: no three');
bot.stack = { wasToppedOut: true, shakeTime: 10 };
assert.strictEqual(names(bot._noBareThree([bare, hold])), 'hold', 'topped out while garbage shakes it: no three');
bot.stack = { wasToppedOut: false };
function board(top) { var g = []; for (var r = 0; r <= 12; r++) g[r] = r >= 1 && r <= top ? [0, 1, 2, 3, 4, 5, 6] : [0, 0, 0, 0, 0, 0, 0]; return { grid: g, width: 6, height: 12 }; }
bot._board = board(11);
assert.strictEqual(names(bot._noBareThree([bare, hold])), 'hold', 'tall but not topped out: no three');
bot._board = board(12);
assert.strictEqual(names(bot._noBareThree([bare, hold])), 'bare,hold', 'topped out: a three may');
bot._board = null;
bot.refuseBareThree = false;
assert.strictEqual(names(bot._noBareThree([bare, hold])), 'bare,hold', 'off unless the profile asks');
bot._allCands = [{ kind: 'swap', move: [3, 2], resolved: brk.resolved }, { kind: 'swap', move: [4, 2], resolved: chain.resolved }];
bot._allCands.push({ kind: 'swap', move: [5, 2], resolved: bare.resolved });
assert.strictEqual(bot.threeOnlySwap([5, 2]), true);
assert.strictEqual(bot.threeOnlySwap([3, 2]), true, 'a three that breaks garbage is a three');
assert.strictEqual(bot.threeOnlySwap([4, 2]), false);
var SP = require('./survivor_prefer.js'), prep = { br: { touch: true }, want: { '5,2': true }, popping: false };
bot.refuseBareThree = true;
assert.strictEqual(SP.overrule({ kind: 'hold' }, prep, bot).kind, 'hold', 'a three is not forced over the bot');
prep.want = { '3,2': true };
assert.strictEqual(SP.overrule({ kind: 'hold' }, prep, bot).kind, 'hold', 'nor a three that breaks garbage');
prep.want = { '4,2': true };
assert.deepStrictEqual(SP.overrule({ kind: 'hold' }, prep, bot).move, [4, 2], 'anything else still is');
console.log('threesLast: ok');
