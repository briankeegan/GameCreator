#!/usr/bin/env node
// THE CURSOR'S WALK (profile travelFloor, nearestFirst).
//
//   node cursorWalk.test.js
//
// travelFloor raises a travelCost weight below it to it, wherever weights are
// loaded (the profile's, a duel's, an island's reload); nearestFirst keeps, of
// the moves the bot's rules rank the same, the ones the cursor reaches
// soonest, and the nearest of the breaks a lineup would force.
var assert = require('assert'), path = require('path');
var SH = require('./survivor_shared.js'), P = require('./puyocpu.js'), SP = require('./survivor_prefer.js');
var base = SH.profile(), p = JSON.parse(JSON.stringify(base));
p.travelFloor = 60;
var w = SH.botOptions(p, 1).weights;
assert(w.travelCost >= 60, 'profile weights: travelCost ' + w.travelCost);
delete p.travelFloor;
var raw = SH.botOptions(p, 1).weights.travelCost;
p.travelFloor = raw + 1000;
assert.strictEqual(SH.botOptions(p, 1).weights.travelCost, raw + 1000, 'a floor above the weight raises it');
p.travelFloor = raw - 1000;
assert.strictEqual(SH.botOptions(p, 1).weights.travelCost, raw, 'a weight above the floor stays');
// nearest of equally ranked
var bot = Object.create(P.prototype);
bot.preferRank = function () { return 0; };
var far = { kind: 'swap', move: [3, 1], travel: 40 }, mid = { kind: 'swap', move: [3, 4], travel: 12 }, near = { kind: 'swap', move: [5, 2], travel: 4 };
bot.nearestFirst = false;
assert.strictEqual(bot._preferred([far, mid, near], []).length, 3, 'off: every equal move kept');
bot.nearestFirst = true;
assert.deepStrictEqual(bot._preferred([far, mid, near], []), [near], 'on: the nearest');
bot.preferRank = function (c) { return c === far ? 0 : 5; };
assert.deepStrictEqual(bot._preferred([far, mid, near], []), [far], 'rank first, distance only between equals');
// the lineup a break forces: the nearest
bot._allCands = [far, mid, near];
var prep = { br: { touch: true }, want: { '3,1': true, '5,2': true }, popping: false };
assert.deepStrictEqual(SP.overrule({ kind: 'hold' }, prep, bot).move, [5, 2], 'the nearest break wanted');
console.log("cursorWalk: ok");
