// WHAT IT COSTS TO MOVE THE CURSOR, IN FRAMES.
//
// The CPU currently calls stack.touchSwap(row, col), which teleports the
// cursor to any cell and swaps in the same frame. A person cannot do that:
// they hold a direction and wait. So every weight trained against the
// teleporting bot answers a question nobody is asked at the keyboard, and
// the fix starts here — with what movement actually costs.
//
// meatfighter's search handles this as a REACHABILITY filter: breadth-first
// search over "every legal lock position it can come to rest in", and
// everything reachable then scores equally. That works because Puyo has
// TURNS — the movement happens while the piece falls, so getting to a far
// column costs nothing you would otherwise have spent. Panel Attack has no
// turns. The board rises continuously and every cursor step burns frames
// that could have been another swap, so here travel is a COST rather than a
// gate, and it has to be in the same currency as everything else: frames.
//
// THESE NUMBERS ARE MEASURED, NOT DERIVED. Driven against a real Stack,
// holding real directions, counting the frames it actually took:
//
//     1 step  ->  1 frame        (a direction change moves immediately)
//     2 steps -> 21 frames       (the second step waits out DAS_DELAY = 20)
//     3 steps -> 22 frames
//     4 steps -> 23 frames
//
// So a single step is nearly free and the second one is brutal — which
// makes an L-shaped path with two long legs cost DOUBLE, since each axis
// pays its own DAS:
//
//     4 across          -> 23 frames
//     1 across + 3 up   -> 23 frames
//     2 across + 2 up   -> 42 frames
//
// I had assumed direction changes were cheap because each one moves
// immediately. They are not; that free step is followed by another 20-frame
// wait. Guessing here would have priced half the board wrong.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanelEval = root.PanelEval || {}, root.PanelEval.travel = factory();
}(this, function () {
  'use strict';

  var DAS_DELAY = 20;   // panel-engine.js, frames a direction must be held

  // Frames to move `steps` cells along ONE axis, holding that direction.
  // 19 + steps, not 20 + steps: the first step lands on the frame the
  // direction changes, and the second lands ON the frame the DAS counter
  // reaches DAS_DELAY rather than after it. Written as DAS_DELAY - 1 + steps
  // so it moves with the constant, and pinned to the engine by
  // travel.test.js rather than trusted — the off-by-one was there in the
  // first version of this function and only the measurement caught it.
  function axisCost(steps) {
    if (steps <= 0) return 0;
    if (steps === 1) return 1;
    return DAS_DELAY - 1 + steps;
  }

  // Frames to bring the cursor from (r0,c0) to (r1,c1). Each axis is held
  // in turn and pays its own DAS, which is why two long legs cost double.
  function cost(r0, c0, r1, c1) {
    return axisCost(Math.abs(r1 - r0)) + axisCost(Math.abs(c1 - c0));
  }

  // The cursor cannot go above the top of the stack: clampCursor caps
  // curRow at topCurRow, and curCol at WIDTH-1 since a swap needs a
  // right-hand neighbour. A target outside that is not expensive, it is
  // UNREACHABLE, and the search must not offer it at all — the same
  // distinction meatfighter's BFS makes.
  function reachable(row, col, topCurRow, width) {
    return row >= 1 && row <= topCurRow && col >= 1 && col <= width - 1;
  }

  return { DAS_DELAY: DAS_DELAY, axisCost: axisCost, cost: cost, reachable: reachable };
}));
