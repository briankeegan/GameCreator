// THE CHECKS THE ATTACK PROFILES MAKE ON A BOARD, in one place and held to the engine by survivor_checks.test.js: how high a stack is,
// how few panels its lowest column holds, whether a chain or clear is live on it, how far it may be raised, whether it is in danger.
var PA = require('../../pa-engine.js');
// A board is a pa-engine.js Stack (or View): board.panels[row][col] with .color and .isGarbage, and the stack's own fields.
function eachPanel(board, fn) {
  for (var r = 1; r < board.panels.length; r++) for (var c = 1; c <= 6; c++) { var p = board.panels[r] && board.panels[r][c]; if (p) fn(p, r, c); }
}
// garbage still falling has not landed: it is above the stack, not on it
function falling(p) { return !!(p.isGarbage && p.state === 'falling'); }
// the highest row with a panel or LANDED garbage on it (garbage still falling is not part of the stack yet)
function fullTop(board) {
  var top = 0;
  eachPanel(board, function (p, r) { if ((p.color || p.isGarbage) && !falling(p) && r > top) top = r; });
  return top;
}
// where the stack will reach when the garbage falling now has landed: each column's landed height and the rows of garbage over it
function projectedTop(board) {
  var landed = [0, 0, 0, 0, 0, 0, 0], fall = [0, 0, 0, 0, 0, 0, 0], top = 0, c;
  eachPanel(board, function (p, r, col) {
    if (falling(p)) fall[col]++;
    else if ((p.color || p.isGarbage) && r > landed[col]) landed[col] = r;
  });
  for (c = 1; c <= 6; c++) if (landed[c] + fall[c] > top) top = landed[c] + fall[c];
  return top;
}
// the highest row with a panel (not garbage) on it
function panelTop(board) {
  var top = 0;
  eachPanel(board, function (p, r) { if (p.color && !p.isGarbage && r > top) top = r; });
  return top;
}
// The lowest peak: the fewest panels any column has to match with (its highest panel's row under the column's lowest garbage). A row
// converted and buried under the next slab is out of reach until that slab is broken through: it is no panel to spare.
function lowPeak(board) {
  var low = 99, c, r;
  for (c = 1; c <= 6; c++) {
    var pk = 0;
    for (r = 1; r < board.panels.length; r++) { var p = board.panels[r] && board.panels[r][c]; if (!p) continue; if (p.isGarbage) break; if (p.color) pk = r; }
    if (pk < low) low = pk;
  }
  return low;
}
// the same on a grid (node boards: 0 empty, -2 garbage, 1..7 colours, 8 and up shock and the like)
function lowPeakOf(grid) {
  var low = 99, c, r, pk;
  for (c = 1; c <= 6; c++) { pk = 0; for (r = grid.length - 2; r >= 1 && !pk; r--) if (grid[r] && grid[r][c] > 0 && grid[r][c] < 8) pk = r; if (pk < low) low = pk; }
  return low;
}
function panelCount(board) {
  var n = 0;
  eachPanel(board, function (p) { if (p.color && !p.isGarbage) n++; });
  return n;
}
// A CHAIN OR A CLEAR IS LIVE: a chain counting, panels falling from a clear, or -- while stop time runs -- panels still matched or popping.
// With free, a board whose panels have all settled is free at once whatever stop time is left.
function cascadeLive(board, free) {
  if ((board.chainCounter || 0) > 0) return true;
  var stop = (board.stopTime || 0) + (board.preStopTime || 0) > 0;
  if (!free) return stop;
  if (typeof board.hasChainingPanels === 'function' && board.hasChainingPanels()) return true;
  return stop && typeof board.hasActivePanels === 'function' && board.hasActivePanels();
}
// How high the stack may be raised (the profile's raiseMax, one row more while stop time runs).
function raiseCap(board, coming, A) {
  var queued = 0;
  if (A.raiseLeaveRoom || A.raiseNoTop) (board.incoming || []).forEach(function (g) { queued += g.height || 0; });
  var bonus = (A.raiseStopBonus || 0) && (board.stopTime || 0) + (board.preStopTime || 0) >= (A.raiseStopFrames || 60) ? A.raiseStopBonus : 0;
  var cap = (A.raiseMax || 11) + bonus - (A.raiseLeaveRoom ? coming + queued : 0);
  // (raiseNoTop: never raised to where the garbage already on its way would reach the top row: the stack plus the hit stops at row 11)
  if (A.raiseNoTop && coming + queued > 0) cap = Math.min(cap, 11 - coming - queued);
  return cap;
}
// How many frames until the stack is topped out if nothing stops it rising: the stop time left, then the rest of the row it is rising
// through and a whole row for each one more it has to go (a row is 16 steps of the rise time at the stack's speed). 0 for a stack
// already topped out with no stop time running; with stop time running, that much longer.
function framesToTop(board) {
  var h = board.height || 12, rows = h - fullTop(board), stop = (board.stopTime || 0) + (board.preStopTime || 0);
  if (rows <= 0) return stop;
  var T = PA.riseTime(board.speed || 1), disp = Math.max(1, board.displacement || 16);
  return stop + Math.max(0, board.riseTimer || 0) + (disp - 1) * T + (rows - 1) * 16 * T;
}
// Topped out, or so near it that the next row up tops it out within nearFrames (the stack rises by itself into the top row, and is lost
// without stop time). One row from the top is not that on its own: it is that many frames of time to act in.
function toppedOrNearly(board, toppedReal, A) {
  var h = board.height || 12, full = fullTop(board);
  // (realTopped: the board asked about is a prediction, with the garbage still queued landed on it: only the stack as the game shows it
  // is topped out, and a stack of panels one row from the top within nearFrames of it)
  if (A && A.realTopped) return !!toppedReal || (panelTop(board) >= h - 1 && framesToTop(board) <= (A.nearFrames || 90));
  return !!toppedReal || (typeof board.isToppedOut === 'function' && board.isToppedOut()) || full >= h ||
         (full >= h - 1 && framesToTop(board) <= ((A && A.nearFrames) || 90));
}
// Why the stack is in jeopardy, or '' when it is not: 'topped' (topped out, or the next row up would, within nearFrames), 'tall' (its
// height with the garbage on it at dangerTop or more and within dangerFrames of the top), 'landing' (garbage falling now will top the stack out when it lands), or 'incoming' (a hit landing within dangerSoon
// frames that would overflow the board: rows coming and queued on top of its height, dangerOver rows over the 12 -- a hit that reaches row 12 tops it out).
// arrivals: the garbage on its way, as the bot's serverArrivals ({ at: frames to landing }).
function dangerWhy(board, arrivals, comingRows, toppedReal, A) {
  var queued = 0, soon = Infinity;
  (board.incoming || []).forEach(function (g) { queued += g.height || 0; });
  (arrivals || []).forEach(function (a) { if (a.at < soon) soon = a.at; });
  var full = fullTop(board);
  if (toppedOrNearly(board, toppedReal, A)) return 'topped';
  if ((A.realTopped ? panelTop(board) : full) >= (A.dangerTop || 11) && framesToTop(board) <= (A.dangerFrames || 240)) return 'tall';
  if (!A.realTopped && projectedTop(board) >= (board.height || 12)) return 'landing';
  if (soon <= (A.dangerSoon || 120) && full + comingRows + queued >= 12 + (A.dangerOver || 0)) return 'incoming';
  return '';
}
function inDanger(board, arrivals, comingRows, toppedReal, A) { return dangerWhy(board, arrivals, comingRows, toppedReal, A) !== ''; }
module.exports = { projectedTop: projectedTop, framesToTop: framesToTop, dangerWhy: dangerWhy, fullTop: fullTop, panelTop: panelTop, lowPeak: lowPeak, lowPeakOf: lowPeakOf, panelCount: panelCount, cascadeLive: cascadeLive, raiseCap: raiseCap, toppedOrNearly: toppedOrNearly, inDanger: inDanger };
