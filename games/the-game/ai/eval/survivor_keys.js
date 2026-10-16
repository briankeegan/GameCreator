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
var HOLDTIGHT = 40;      // the actions short of the limit at which every walk of two cells or more is held, later than taps (native/front.c HOLDTIGHT)

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
// THE SAME WALKS, HELD FROM TWO CELLS, when the allowance is tight: a held key is one action however far the cursor
// goes, and two cells of it arrive 6 frames after taps would, three 3 (the first cell on the press, the second after
// the engine's repeat delay, then one a frame). The frames the cursor is late by are put in before the next key, as
// native/front.c walkEnds counts them, so a plan made with held walks is played as it was judged. `holds` is the
// raise held after each frame; the frames put in carry the state of the frame they follow.
function slowWalks(inputs, holds, minLeg) {
  var out = [], oh = [], held = 0, min = minLeg || 2, i = 0;
  while (i < inputs.length) {
    var v = inputs[i], base = inputs[i + 1], dir = v & 15;
    if (!dir || (dir & (dir - 1)) || base === undefined || (base & 15) || (v & ~15) !== base) { out.push(v); oh.push(holds[i]); i++; continue; }
    var n = 1, p = i;
    while (inputs[p + TAP_GAP] === v && inputs[p + 1] === base && inputs[p + 2] === base && inputs[p + 3] === base) { p += TAP_GAP; n++; }
    var last = i + n + REPEAT_FIRST - 2;
    var end = p;
    while (end + 1 < inputs.length && end + 1 <= p + TAP_GAP - 1 && inputs[end + 1] === base) end++;
    if (n < min) { for (var f = i; f <= end; f++) { out.push(inputs[f]); oh.push(holds[f]); } i = end + 1; continue; }
    // held: v on every frame the cursor is still going, and no later than the leg was
    for (var g = i; g <= Math.max(last, end); g++) {
      out.push(g <= last ? v : base);
      oh.push(holds[Math.min(g, end)]);
    }
    held++;
    i = end + 1;
  }
  out.held = held;
  return { inputs: out, holds: oh, held: held };
}
// The actions a swap at `move` costs from the cursor at (row, col): its walk,
// across then up or down, each walk held when holdWalks would hold it (or from
// two cells, when `left`, the allowance still to spend, is tight), and the swap.
function actionsFor(row, col, move, left) {
  var tight = left != null && left <= HOLDTIGHT;
  var legs = [Math.abs(move[1] - col), Math.abs(move[0] - row)].filter(function (n) { return n > 0; }), cost = 1;
  legs.forEach(function (n, k) {
    var inner = k < legs.length - 1;
    cost += tight ? (n >= 2 ? 1 : n) : n >= MIN_LEG + 1 || (n === MIN_LEG && inner) ? 1 : n;
  });
  return cost;
}
var SWAP_KEY = require(require('path').join(__dirname, '..', '..', 'pa-engine.js')).IN.swap;
// THE PRESS AS THE FRAME LOOP MAKES IT: with the input budget tight (o.tight: the decision's allowance at or under KEYS.HOLDTIGHT) the
// frame loop walks the cursor held from two cells (survivor_match.js walkKeys, KEYS.slowWalks), which presses the swap later than the
// search's own walk. The frames later, from node n: the search's keys for the swap, walked as the frame loop walks them.
function pressDelay(s, n, mv, tight) {
  if (!tight || !mv) return 0;
  var k = s.keys(n, 'swap', mv, 0);
  if (!k) return 0;
  var at = function (ins) { for (var i = 0; i < ins.length; i++) if (ins[i] & SWAP_KEY) return i; return -1; };
  var tap = at(k.inputs), slow = at(slowWalks(k.inputs, k.holds, 2).inputs);
  return tap >= 0 && slow > tap ? slow - tap : 0;
}
module.exports = { pressDelay: pressDelay, holdWalks: holdWalks, slowWalks: slowWalks, actionsFor: actionsFor, MIN_LEG: MIN_LEG, HOLDTIGHT: HOLDTIGHT };
