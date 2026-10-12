#!/usr/bin/env node
// THREES LAST (puyocpu.js _noBareThree, profile threesLast).
//
//   node threesLast.test.js
//
// A move whose clears are all threes, breaking no garbage and starting no
// chain, is dropped while any other move is left; it is kept when it is all
// there is (the survival search has already said what lives), and when the
// stack is topped out with nothing holding it. A three that breaks garbage,
// a chain, a combo of four and a move clearing nothing all stay.
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
assert.strictEqual(names(bot._noBareThree([bare, hold, brk, chain, four, two3])), 'hold,break,chain,four');
assert.strictEqual(bot.bareThreesDropped, 2);
assert.strictEqual(names(bot._noBareThree([bare, brk])), 'break', 'breaking garbage comes first');
assert.strictEqual(names(bot._noBareThree([bare])), 'bare', 'the only move left is played');
assert.strictEqual(bot.bareThreesKept, 1);
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
assert.strictEqual(bot.threeOnlySwap([3, 2]), false, 'a three that breaks garbage is not held back');
assert.strictEqual(bot.threeOnlySwap([4, 2]), false);
var SP = require('./survivor_prefer.js'), prep = { br: { touch: true }, want: { '5,2': true }, popping: false };
bot.refuseBareThree = true;
assert.strictEqual(SP.overrule({ kind: 'hold' }, prep, bot).kind, 'hold', 'a three is not forced over the bot');
prep.want = { '3,2': true };
assert.deepStrictEqual(SP.overrule({ kind: 'hold' }, prep, bot).move, [3, 2], 'a three that breaks garbage still is');
prep.want = { '4,2': true };
assert.deepStrictEqual(SP.overrule({ kind: 'hold' }, prep, bot).move, [4, 2], 'and anything else');
// THREE BREAKS LAST (threeBreaksLast): a three that breaks garbage is held to the same rule.
bot.refuseThreeBreak = true; bot.bareThreesDropped = 0; bot.bareThreesKept = 0;
assert.strictEqual(names(bot._noBareThree([brk, hold, chain, four])), 'hold,chain,four', 'a three break is dropped while another move is left');
assert.strictEqual(names(bot._noBareThree([bare, brk])), 'bare,break', 'only threes left: they stay');
assert.strictEqual(bot.bareThreesKept, 1);
assert.strictEqual(bot.threeOnlySwap([3, 2]), true);
assert.strictEqual(bot.threeOnlySwap([4, 2]), false, 'a chain is not held back');
prep.want = { '3,2': true };
assert.strictEqual(SP.overrule({ kind: 'hold' }, prep, bot).kind, 'hold', 'a three break is not forced over the bot');
bot.refuseThreeBreak = false;
assert.deepStrictEqual(SP.overrule({ kind: 'hold' }, prep, bot).move, [3, 2], 'off unless the profile asks');
// NO THREE UNTIL TOPPED OUT (threesOnlyTopped): of the proven moves a three is never chosen below the top; none left, none returned
bot.refuseThreeBreak = true; bot.noThreesUntilTopped = true; bot.stack = { wasToppedOut: false }; bot._board = null;
assert.strictEqual(names(bot._noBareThree([bare, brk, hold, chain], true)), 'hold,chain', 'a three break goes too');
assert.strictEqual(names(bot._noBareThree([bare, brk], true)), '', 'only threes proven: the others are left to the unproven ones');
assert.strictEqual(names(bot._noBareThree([bare, brk], false)), 'bare,break', 'the pool that is not the proven one keeps what it has');
bot.stack = { wasToppedOut: true };
assert.strictEqual(names(bot._noBareThree([bare, brk, hold], true)), 'hold', 'topped out: a three is still the last resort');
assert.strictEqual(names(bot._noBareThree([bare, brk], true)), 'bare,break', 'topped out and only threes proven: they are played');
bot.stack = { wasToppedOut: false }; bot._danger = true;
assert.strictEqual(names(bot._noBareThree([bare, brk, chain], true)), 'chain', 'in danger: a three is the last resort');
assert.strictEqual(names(bot._noBareThree([bare, brk], true)), '', 'in danger but not topped out: not even then, the unproven moves are looked at');
bot.toppedOutNow = true;
assert.strictEqual(names(bot._noBareThree([bare, brk], true)), 'bare,break', 'topped out (as the frame loop says) and only threes proven: they are played');
bot.toppedOutNow = false;
bot._danger = false;
bot.noThreesUntilTopped = false;
console.log('threesLast: ok');
