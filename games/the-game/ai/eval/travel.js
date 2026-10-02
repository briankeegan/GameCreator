(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanelEval = root.PanelEval || {}, root.PanelEval.travel = factory();
}(this, function () {
  'use strict';

  var DAS_DELAY = 20;          // panel-engine.js, frames a held direction repeats after (the Lua: 10)
  var MOVE_FRAMES = 4;         // panel-cpu.js CURSOR_MOVE_FRAMES — the tap cadence

  function walkCost(steps, g) {
    if (steps <= 0) return 0;
    return (g || MOVE_FRAMES) * (steps - 1) + 1;
  }

  var press = 0;
  function setPress(n) { press = n || 0; }
  function pressOf() { return press; }
  function cost(r0, c0, r1, c1, g) {
    return walkCost(Math.abs(r1 - r0) + Math.abs(c1 - c0), g) + press;
  }

  function reachable(row, col, topCurRow, width) {
    return row >= 1 && row <= topCurRow && col >= 1 && col <= width - 1;
  }

  return { DAS_DELAY: DAS_DELAY, MOVE_FRAMES: MOVE_FRAMES,
           walkCost: walkCost, cost: cost, setPress: setPress, pressOf: pressOf, reachable: reachable };
}));
