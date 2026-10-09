#!/usr/bin/env node
// THE CURSOR WALKS AS LITTLE AS IT CAN (survivor_shared.js TRAVEL_FLOOR,
// PuyoCpu nearestFirst), for every WasmSurvivor profile, with no switch.
//
//   node cursorWalk.test.js
//
// A travelCost weight below TRAVEL_FLOOR is raised to it wherever weights are
// loaded (the profile's, a duel's, an island's reload); of the moves the bot's
// rules rank the same, the ones the cursor reaches soonest are kept, and of the
// breaks a lineup would force, the nearest.
var assert = require('assert');
var SH = require('./survivor_shared.js'), P = require('./puyocpu.js'), SP = require('./survivor_prefer.js');
var F = SH.TRAVEL_FLOOR;
var p = JSON.parse(JSON.stringify(SH.profile()));
var o = SH.botOptions(p, 1);
assert(o.weights.travelCost >= F, 'profile weights: travelCost ' + o.weights.travelCost);
assert.strictEqual(o.nearestFirst, true, 'nearestFirst is always on');
p.nearestFirst = false; p.travelFloor = 0;
assert.strictEqual(SH.botOptions(p, 1).nearestFirst, true, 'a profile cannot switch nearestFirst off');
assert(SH.botOptions(p, 1).weights.travelCost >= F, 'a profile cannot switch the floor off');
assert.strictEqual(SH.floorTravel({ travelCost: F - 50 }).travelCost, F, 'a weight below the floor is raised');
assert.strictEqual(SH.floorTravel({}).travelCost, F, 'a missing weight is the floor');
assert.strictEqual(SH.floorTravel({ travelCost: F + 50 }).travelCost, F + 50, 'a weight above the floor stays');
var w = { travelCost: 1 }; SH.floorTravel(w);
assert.strictEqual(w.travelCost, 1, 'the caller\'s weights are not changed');
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
