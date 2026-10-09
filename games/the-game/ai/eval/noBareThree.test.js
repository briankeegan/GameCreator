#!/usr/bin/env node
// NO BARE THREES (puyocpu.js _noBareThree, profile noBareThree).
//
//   node noBareThree.test.js
//
// A clear of three that breaks no garbage and starts no chain is dropped
// while any other move is left; it is kept when it is all there is (the
// survival search has already said what lives). A three that breaks garbage,
// a chain, a combo of four and a move clearing nothing all stay.
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
assert.strictEqual(names(bot._noBareThree([bare])), 'bare', 'the only move left is played');
assert.strictEqual(bot.bareThreesKept, 1);
bot.refuseBareThree = false;
assert.strictEqual(names(bot._noBareThree([bare, hold])), 'bare,hold', 'off unless the profile asks');
console.log('noBareThree: ok');
