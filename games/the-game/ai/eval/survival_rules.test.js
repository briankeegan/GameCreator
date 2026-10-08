#!/usr/bin/env node
// SURVIVAL'S ORDER ON A REAL SHAPE: a board topped by slabs, the pile
// resting on the stack, as the combo_storm deaths end. Breaking comes first:
// a swap that makes three against the garbage is played over one that makes
// a bigger combo away from it, however much stop time the combo would earn.
// One decision of the bot on the server's engine (pa-engine.js).
var assert = require('assert'), path = require('path');
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var BitBot = require('./bitbot.js');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), GEN = require(path.join(__dirname, '..', '..', 'pa-generator.js'));

function stackOf(rows) {
  var ld = PA.vsLevel(10).levelData;
  var pa = PA.create(10, new PA.Seeded(new GEN.GeneratorSource(1, true, ld.colors, ld.adjacentDenialFrequency)));
  // the slabs drop and land; then the panels under them are set by hand
  for (var k = 0; k < 9; k++) pa.receiveGarbage([{ width: 6, height: 1, isChain: false, isMetal: false, frameEarned: pa.stopWatch, finalized: true }]);
  for (var f = 0; f < 900 && (pa.incoming.length || f < 400); f++) pa.run();
  var low = 0;
  for (var r = 1; r < pa.panels.length && !low; r++) if (pa.panels[r][1].isGarbage) low = r;
  assert.strictEqual(low, rows.length + 1, 'the pile rests on row ' + low + ', the board sets ' + rows.length + ' rows under it');
  rows.forEach(function (row, i) {
    var r = rows.length - i;
    for (var c = 1; c <= 6; c++) {
      var q = pa.panels[r][c];
      q.color = Number(row[c - 1]); q.state = 'normal'; q.isGarbage = false; q.timer = 0; q.chaining = false; q.matching = false;
    }
  });
  return pa;
}

// rows top to bottom, under the pile. Row 7: swapping columns 3 and 4 makes
// 1-1-1 against the slab above (a break). Row 5: the same swap makes 5-5-5
// with 5-5 under it in column 3, five panels away from any garbage.
var pa = stackOf(['112134', '234562', '556523', '345616', '615431', '461235', '326342']);
assert.ok(pa.wasToppedOut, 'the pile reaches the top');
var d = new BitBot(PA.view(pa), { allowRaise: true, reaction: 12, seed: 1 }).decide();
assert.strictEqual(d.kind, 'swap', 'a swap, not a ' + d.kind);
assert.deepStrictEqual(d.move, [7, 3], 'the break at 7,3, not ' + JSON.stringify(d.move) + ' (' + d.via + ')');
console.log('survival_rules: the break is played over a bigger clear (' + d.via + ')');
