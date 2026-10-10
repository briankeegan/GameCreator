// THE CURSOR'S WALK IN THE FEWEST KEYS.
//
// The game counts an action each time a swap or direction key goes down
// (InputBudget); a direction held down is one action however far the cursor
// goes. A walk of n cells in one direction is played as n taps four frames
// apart; from four cells up a held key gets the cursor to the same cell on
// the same frame or sooner (the first cell on the press, the second after the
// engine's repeat delay, then one a frame), so it is held for as long as the
// cursor needs and released. A walk is held only when the cursor is there by
// the frame the next key would have gone down, so nothing waits on it: from
// four cells up, and three where another walk follows. Everything else in the
// keys is left as it is.
var REPEAT_FIRST = 10;   // frames from the press to the second cell (curWaitTime 20, counted twice a frame)
var TAP_GAP = 4;         // frames between taps (cursorMoveFrames)
var MIN_LEG = 3;         // the shortest walk a held key can be no later on

function holdWalks(inputs, minLeg) {
  var out = inputs.slice(), min = minLeg || MIN_LEG, held = 0, i = 0;
  while (i < inputs.length) {
    var v = inputs[i], base = inputs[i + 1], dir = v & 15;
    if (!dir || (dir & (dir - 1)) || base === undefined || (base & 15) || (v & ~15) !== base) { i++; continue; }
    // taps of this direction, each followed by three frames of base
    var n = 1, p = i;
    while (inputs[p + TAP_GAP] === v && inputs[p + 1] === base && inputs[p + 2] === base && inputs[p + 3] === base) { p += TAP_GAP; n++; }
    var last = i + n + REPEAT_FIRST - 2;   // the frame the n-th cell arrives on
    var end = p;                            // the last frame before the next key
    while (end + 1 < inputs.length && end + 1 <= p + TAP_GAP - 1 && inputs[end + 1] === base) end++;
    if (n >= min && last <= end) {
      for (var f = i; f <= end; f++) out[f] = f <= last ? v : base;
      held++;
    }
    i = p + 1;
  }
  out.held = held;
  return out;
}
// The actions a swap at `move` costs from the cursor at (row, col): its walk,
// across then up or down, each walk held when holdWalks would hold it, and the swap.
function actionsFor(row, col, move) {
  var legs = [Math.abs(move[1] - col), Math.abs(move[0] - row)].filter(function (n) { return n > 0; }), cost = 1;
  legs.forEach(function (n, k) {
    var inner = k < legs.length - 1;
    cost += n >= MIN_LEG + 1 || (n === MIN_LEG && inner) ? 1 : n;
  });
  return cost;
}
module.exports = { holdWalks: holdWalks, actionsFor: actionsFor, MIN_LEG: MIN_LEG };
