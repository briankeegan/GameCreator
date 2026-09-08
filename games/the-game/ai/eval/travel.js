// WHAT IT COSTS TO MOVE THE CURSOR, IN FRAMES.
//
// The cpu used to call stack.touchSwap(row, col), which queues a swap at
// any cell and teleports the cursor there in the same frame. A person
// cannot do that: they press a direction, wait, press it again. So every
// weight trained against the teleporting bot answered a question nobody is
// asked at the keyboard. panel-cpu.js walks the cursor now (see the block
// comment above beginWalk there), and this file is the search's model of
// what that walk costs — the same currency as everything else, frames.
//
// THE POLICY THE CPU ACTUALLY PLAYS, and therefore the only one worth
// pricing: tap a direction, one axis at a time, once every
// cursorMoveFrames frames. Both alternatives were measured against a real
// Stack before this was chosen:
//
//   HOLDING a direction   1 step = 1 frame, and then DAS_DELAY = 20 more
//                         frames before the second: 2 steps = 21, 4 = 23.
//                         An L-shaped path pays DAS on each axis, so
//                         2 across + 2 up = 42 while 4 across = 23.
//   TAPPING every frame   is a hold, not two taps — applyInput only moves
//                         on a direction CHANGE or after DAS.
//   TAPPING every G       one cell per press: G * (steps - 1) + 1 frames.
//
// Holding prices half the board absurdly (a two-cell move costing 21
// frames is not a real decision, it is a wall), and the fastest legal tap
// is 30 inputs a second, which no person does. G = 4 is the cadence
// panel-cpu.js plays and what this prices.
//
// NOTHING HERE IS DERIVED FROM READING applyInput. Every number came off a
// real Stack, and travel.test.js pins the formula to the CPU'S OWN WALKS
// rather than to a re-implementation of them — an earlier version of this
// file was off by one and looked perfectly reasonable.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanelEval = root.PanelEval || {}, root.PanelEval.travel = factory();
}(this, function () {
  'use strict';

  var DAS_DELAY = 20;          // panel-engine.js, frames a held direction repeats after
  var MOVE_FRAMES = 4;         // panel-cpu.js CURSOR_MOVE_FRAMES — the tap cadence

  // Frames to walk `steps` cells at cadence `g`. The first press lands on
  // the frame it is made, every later one waits out the cadence, so it is
  // g * (steps - 1) + 1 and not g * steps.
  function walkCost(steps, g) {
    if (steps <= 0) return 0;
    return (g || MOVE_FRAMES) * (steps - 1) + 1;
  }

  // Frames to bring the cursor from (r0,c0) to (r1,c1). One axis at a time
  // but at the same cadence throughout, so an L-shaped path costs exactly
  // its total step count — unlike the held-direction policy, where turning
  // a corner doubled the bill.
  function cost(r0, c0, r1, c1, g) {
    return walkCost(Math.abs(r1 - r0) + Math.abs(c1 - c0), g);
  }

  // The cursor cannot go above the top of the stack: clampCursor caps
  // curRow at topCurRow, and curCol at WIDTH-1 since a swap needs a
  // right-hand neighbour. A target outside that is not expensive, it is
  // UNREACHABLE, and the search must not offer it at all — the same
  // distinction meatfighter's BFS makes.
  function reachable(row, col, topCurRow, width) {
    return row >= 1 && row <= topCurRow && col >= 1 && col <= width - 1;
  }

  return { DAS_DELAY: DAS_DELAY, MOVE_FRAMES: MOVE_FRAMES,
           walkCost: walkCost, cost: cost, reachable: reachable };
}));
