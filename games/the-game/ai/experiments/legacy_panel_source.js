// Faithful port of common/compatibility/LegacyPanelSource.lua -- the
// buffer-management layer on top of legacy_panel_gen.js's raw color
// generator. Handles the starting board's "non-uniform" elimination
// pass and the re-seed-per-batch scheme (LegacyPanelGenerator gets
// setSeed(seed + panelGenCount) before each new batch, not a
// continuously-advancing single stream).
"use strict";
var legacyPanelGen = require('./legacy_panel_gen.js');

function LegacyPanelSource(seed, shockEnabled) {
  this.seed = seed;
  this.panelBuffer = '';
  this.garbagePanelBuffer = '';
  this.panelGenCount = 0;
  this.garbageGenCount = 0;
  this.allowAdjacentColors = false;
  this.allowAdjacentColorsOnStartingBoard = false;
  this.shockEnabled = shockEnabled;
}

LegacyPanelSource.prototype.setAllowAdjacentColorsOnStartingBoard = function (allow) {
  this.allowAdjacentColorsOnStartingBoard = allow;
};

LegacyPanelSource.prototype.getStartingBoardHeight = function () { return 7; };

// stackWidth, colors: stack.width / stack.levelData.colors in the source.
LegacyPanelSource.prototype.generateStartingBoard = function (stackWidth, colors) {
  var gen = new legacyPanelGen.LegacyPanelGenerator(this.seed + this.panelGenCount);
  var ret = gen.privateGeneratePanels(this.getStartingBoardHeight(), stackWidth, colors, this.panelBuffer, !this.allowAdjacentColorsOnStartingBoard);
  // Called even though the starting board can never actually have metal,
  // purely to advance the RNG the same number of calls the real game did
  // (source's own comment) -- skipping this would desync everything after.
  ret = gen.assignMetalLocations(ret, stackWidth);
  this.panelGenCount++;

  ret = '0'.repeat(stackWidth) + ret;
  var arr = ret.split('');
  var maxStartingHeight = 7;
  var height = new Array(stackWidth).fill(maxStartingHeight);
  var toRemove = 2 * stackWidth;
  while (toRemove > 0) {
    var idx = gen.random(1, stackWidth); // 1-indexed column
    if (height[idx - 1] > 0) {
      arr[idx - 1 + stackWidth * (-height[idx - 1] + 8)] = '0';
      height[idx - 1]--;
      toRemove--;
    }
  }
  ret = arr.join('');
  ret = ret.slice(stackWidth);
  return ret;
};

LegacyPanelSource.prototype.generatePanels = function (stackWidth, colors) {
  var gen = new legacyPanelGen.LegacyPanelGenerator(this.seed + this.panelGenCount);
  var panelColors = gen.privateGeneratePanels(100, stackWidth, colors, this.panelBuffer, !this.allowAdjacentColors);
  panelColors = gen.assignMetalLocations(panelColors, stackWidth);
  this.panelGenCount++;
  return panelColors;
};

LegacyPanelSource.prototype.generateGarbagePanels = function (stackWidth, colors) {
  var gen = new legacyPanelGen.LegacyPanelGenerator(this.seed + this.garbageGenCount);
  this.garbageGenCount++;
  return gen.privateGeneratePanels(20, stackWidth, colors, this.garbagePanelBuffer, !this.allowAdjacentColors);
};

module.exports = { LegacyPanelSource: LegacyPanelSource };
