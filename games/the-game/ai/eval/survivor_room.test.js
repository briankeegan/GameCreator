#!/usr/bin/env node
// PANELS UP TO THE ROOM ARE KEPT, PAST IT SPENT.
//
//   node survivor_room.test.js
//
// survivor_shared.js keepRank ranks a settled board by its panels plus the
// cells a pop is turning into panels (convertingOf): lower is preferred.
// Under ROOM more panels rank better (large garbage: panels are what slabs
// are broken with); past it fewer do (combo storm: seven one-row pieces
// popping together land as 28 panels on the stack).
var assert = require('assert'), SH = require(require('path').join(__dirname, 'survivor_shared.js'));
function grid(n) {   // n panels, row by row from the bottom
  var g = [[0, 0, 0, 0, 0, 0, 0]];
  for (var r = 1; r <= 12; r++) { var row = [0]; for (var c = 1; c <= 6; c++) row.push(n-- > 0 ? 1 + ((r + c) % 5) : 0); g.push(row); }
  return { grid: g, width: 6 };
}
assert.strictEqual(SH.panelsOf(grid(30)), 30);
assert(SH.keepRank(grid(31), 6) < SH.keepRank(grid(30), 6), 'under the room a panel kept is not preferred');
assert(SH.keepRank(grid(21), 28) < SH.keepRank(grid(24), 28), 'past the room a panel spent is not preferred');
assert(SH.keepRank(grid(SH.ROOM - 2), 0) < SH.keepRank(grid(SH.ROOM - 5), 0), 'just under the room fewer panels won');
var cell = function (garbage, state, y) { return { color: garbage ? 9 : 2, isGarbage: garbage, state: state, yOffset: y }; };
var board = { panels: [null, [null, cell(true, 'matched', -1), cell(true, 'matched', -1), cell(true, 'matched', 0), cell(true, 'normal', -1), cell(false, 'normal', null), null]] };
assert.strictEqual(SH.convertingOf(board), 2, 'only a popping piece\'s bottom row is converting');
console.log('ok: panels kept up to ' + SH.ROOM + ', spent past it; a pop\'s bottom rows counted as panels to come');
