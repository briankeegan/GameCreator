// Faithful port of common/compatibility/LegacyPanelGenerator.lua, the
// panel-color generator the real "046"-engine replays actually used
// (see love_rng.js's header and FINDINGS.md Round 6/7). Validated
// against the exact ground-truth strings in
// common/tests/engine/PanelGenTests.lua's testLegacyPanelGenForGarbage1/2
// and testLegacyStartingBoard1-4 -- see legacy_panel_gen.test.js.
"use strict";
var loveRng = require('./love_rng.js');

var COLOR_TO_NUMBER = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 0,
  a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 0,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 0
};
var NUMBER_TO_UPPER = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F', 7: 'G', 8: 'H', 9: 'I', 0: '0' };
var NUMBER_TO_LOWER = { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e', 6: 'f', 7: 'g', 8: 'h', 9: 'i', 0: '0' };

function colorAt(str, negIndexFromEnd) {
  // negIndexFromEnd=1 -> last char, 2 -> second-to-last, etc. (Lua's
  // string.sub(s, -n, -n)). Returns undefined if out of range, matching
  // Lua's empty-string behavior on an out-of-range negative sub (COLOR_TO_NUMBER[nil]
  // lookup is nil in Lua, i.e. "not equal to any real color").
  if (negIndexFromEnd > str.length) return undefined;
  var ch = str[str.length - negIndexFromEnd];
  return COLOR_TO_NUMBER[ch];
}

function LegacyPanelGenerator(seed) {
  this.rng = new loveRng.RandomGenerator(seed);
  this.generatedCount = 0;
}

LegacyPanelGenerator.prototype.random = function (min, max) {
  this.generatedCount++;
  return this.rng.random(min, max);
};

// rowsToMake, rowWidth, ncolors, previousPanels (string), disallowAdjacentColors (bool)
LegacyPanelGenerator.prototype.privateGeneratePanels = function (rowsToMake, rowWidth, ncolors, previousPanels, disallowAdjacentColors) {
  if (ncolors < 2) throw new Error('Trying to generate panels with only ' + ncolors + ' colors');
  var result = previousPanels || '';
  for (var x = 0; x < rowsToMake; x++) {
    for (var y = 0; y < rowWidth; y++) {
      var previousTwoMatchOnThisRow = y > 1 && colorAt(result, 1) === colorAt(result, 2);
      var belowColor = colorAt(result, rowWidth);
      var color = 0, nogood = true;
      while (nogood) {
        color = this.random(1, ncolors);
        nogood = (previousTwoMatchOnThisRow && color === colorAt(result, 1)) ||
          color === belowColor ||
          (y > 0 && color === colorAt(result, 1) && disallowAdjacentColors);
      }
      result += String(color);
    }
  }
  return result;
};

LegacyPanelGenerator.prototype.assignMetalLocations = function (ret, rowWidth) {
  var newRet = '0'.repeat(rowWidth);
  for (var i = 1; i <= ret.length / rowWidth; i++) {
    var currentRow = ret.slice((i - 1) * rowWidth, (i - 1) * rowWidth + rowWidth);
    var newRow;
    if (!isNaN(Number(currentRow))) {
      var prevRow = newRet.slice(-rowWidth);
      var first, second;
      while (first === undefined || isNaN(Number(prevRow[first - 1]))) {
        first = this.random(1, rowWidth);
      }
      while (second === undefined || second === first || isNaN(Number(prevRow[second - 1]))) {
        second = this.random(1, rowWidth);
      }
      var chars = [];
      for (var j = 1; j <= rowWidth; j++) {
        var chrFromRet = currentRow[j - 1];
        var numFromRet = COLOR_TO_NUMBER[chrFromRet];
        if (j === first) chars.push(NUMBER_TO_UPPER[numFromRet] !== undefined ? NUMBER_TO_UPPER[numFromRet] : (chrFromRet || '0'));
        else if (j === second) chars.push(NUMBER_TO_LOWER[numFromRet] !== undefined ? NUMBER_TO_LOWER[numFromRet] : (chrFromRet || '0'));
        else chars.push(chrFromRet);
      }
      newRow = chars.join('');
    } else {
      newRow = currentRow;
    }
    newRet += newRow;
  }
  return newRet.slice(rowWidth);
};

module.exports = { LegacyPanelGenerator: LegacyPanelGenerator, COLOR_TO_NUMBER: COLOR_TO_NUMBER };
