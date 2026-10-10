// WASMSURVIVOR'S ORDER AMONG THE MOVES PROVEN TO LIVE: what survivor_mind.js
// sets on the bot before each decision, and the duel's WasmSurvivor
// (versus.js, bot 'survivor') sets the same way. The weights only rank what
// these leave tied.
var path = require('path');
var SH = require(path.join(__dirname, 'survivor_shared.js'));
var TALL_RANK = 30;   // frames: a break sooner than this outranks lowering a tall board
var LINEUP_AFTER = 30;   // frames past a pop's end a lined-up row has to have matched by
var BANK_ROWS = 12, BANK_TOP = 10;   // garbage rows on the way that make banking worth it, and the row it banks up to
// The share of the time before an answer is due that the lineup search may
// spend, and its floor; a question with no time given (m.ms 0) gets the most.
var LINEUP_SHARE = 0.4, LINEUP_MIN_MS = 40, LINEUP_MAX_MS = 400;
// A SLAB HANGING over a gap cannot be touched from the columns under the gap.
// With the profile's lowerSlab, of the moves proven to live and none breaking
// garbage, the ones leaving the lowest garbage lowest are played: clearing
// the columns it rests on brings it down to where it can be broken.
var HANG_RANK = 1e6;
function slabRow(b) {
  if (!b || !b.grid) return 0;
  for (var r = 1; r < b.grid.length; r++) { var row = b.grid[r]; if (row) for (var c = 1; c <= b.width; c++) if (row[c] < 0) return r; }
  return 0;
}
// PANELS ARE WHAT GARBAGE IS BROKEN WITH. A break turns a row of it into
// panels; a clear that touches no garbage only spends them, and while a slab
// pops the stack cannot rise to replace them. With the profile's conserve,
// while garbage is on the board or on its way, of the moves proven to live
// and none breaking garbage, the ones leaving the most panels are played --
// a raise, which brings a row, among them.
var KEEP_RANK = 1e7;
var RESTING = 2;   // columns or fewer the lowest garbage rests on for it to be brought down first
// Bringing it down is worth a row per 1000, and every panel spent 400: a clear's
// three cost more than the row it lowers the slab, so the slab comes down by
// panels moved off the columns it rests on, and by a clear only when nothing
// else is proven to live.
var DROP_ROW = 1000, DROP_PANEL = 400;
// How many columns the lowest garbage rests on: those whose top panel is
// right under it. Only those can touch it.
function resting(board) {
  var g = SH.lowestGarbageRow(board), n = 0, c;
  if (!g) return 6;
  for (c = 1; c <= 6; c++) { var p = board.panels[g - 1] && board.panels[g - 1][c]; if (p && p.color && !p.isGarbage) n++; }
  return n;
}
// Of those, the flattest under the garbage: each column's shortfall from the
// tallest below it, squared, so filling a well counts though the tallest
// stays. Garbage rests on the tallest column and only a column it rests on
// can touch it; and a converted row lands flush only on a flat top.
// (The gap up to the garbage itself is no measure: every move that clears
// nothing leaves the same.)
function gapOf(b) {
  var g = 0, r, c, tops = [], hi = 0, gap = 0;
  for (r = 1; r < b.grid.length && !g; r++) { var row = b.grid[r]; if (row) for (c = 1; c <= b.width; c++) if (row[c] < 0) { g = r; break; } }
  for (c = 1; c <= b.width; c++) {
    var t = 0;
    for (r = 1; r < (g || b.grid.length); r++) if (b.grid[r] && b.grid[r][c] > 0) t = r;
    tops.push(t); if (t > hi) hi = t;
  }
  tops.forEach(function (t) { gap += (hi - t) * (hi - t); });
  return gap;
}
function hanging(board, gap) {
  gap = gap || 1;
  var g = 0, r, c;
  for (r = 1; r < board.panels.length && !g; r++) { var row = board.panels[r]; if (row) for (c = 1; c <= 6; c++) if (row[c] && row[c].isGarbage) { g = r; break; } }
  if (!g) return false;
  for (c = 1; c <= 6; c++) {
    var h = 0;
    for (r = 1; r < g; r++) if (board.panels[r] && board.panels[r][c] && board.panels[r][c].color) h = r;
    if (h < g - gap) return true;
  }
  return false;
}

// prepare(bot, board, o) before bot._decide(); overrule(d, prep) after it.
//   o.profile   the WasmSurvivor profile
//   o.hold      { left, started }: the raise in hand
//   o.arrivals  garbage on its way, as the bot's serverArrivals
//   o.comingRows  rows of garbage on its way, by the senders' telegraphs
//   o.due, o.ms, o.margin  when the answer is due (0: no clock), the time
//               it was given, and how long before that the searches end
//   o.search()  the native Search the break search runs on
//   o.stale(), o.aborted  a question no longer wanted, and what is thrown
function prepare(bot, board, o) {
  bot.preferRank = null; bot.preferProven = null;
  var popping = !!(o.profile.conserve && SH.popLeft(board)), converting = popping ? SH.convertingOf(board) : 0;
  var br = null, brMs = 0, want = {}, tall = o.profile.tallRow && SH.top(board) >= o.profile.tallRow;
  // No break search on a question due sooner than it could take (one asked
  // for the next frame, the plan dying): the answer would come late. The
  // survival search's own soonest breaks (breakAt) still rank the moves.
  var breakTime = !o.due || o.due - Date.now() >= o.margin + LINEUP_MIN_MS;
  if (o.profile.breakFirst) {
    bot._natSearch();   // the engine, on this bot's threads, before a second context is made on it
    var tb = Date.now();
    if (breakTime) br = SH.breakMoves(o.search(), board, { left: o.hold.left, started: o.hold.started }, o.arrivals, o.profile.breakDepth, o.profile.lineup && SH.popLeft(board) ? SH.popLeft(board) + LINEUP_AFTER : 0,
                       o.due ? Math.min(Date.now() + Math.max(LINEUP_MIN_MS, o.ms * LINEUP_SHARE), o.due - o.margin) : Date.now() + LINEUP_MAX_MS,
                       o.stale ? function () { return o.stale() ? o.aborted : null; } : null);
    brMs = Date.now() - tb;
    if (o.stale && o.stale()) throw o.aborted;
    want = br && br.depth ? br.moves : {};
    // BANK PANELS BEFORE THE GARBAGE LANDS: once a slab is on the board the
    // stack is topped out and cannot rise, so the panels there are all
    // there will be but what breaking brings. With the profile's bank,
    // while garbage of BANK_ROWS rows or more is on its way and none has
    // landed, a raise is played first, up to BANK_TOP.
    if (o.profile.bank && !(br && br.depth) && !SH.lowestGarbageRow(board) && SH.top(board) < BANK_TOP) {
      var coming = o.comingRows;
      (board.incoming || []).forEach(function (g) { coming += g.height; });
      if (coming >= BANK_ROWS) want = { raise: true };
    }
    // PANELS TO WORK WITH: with the profile's raiseTo, while no garbage is on
    // the board and no break is to be made, a raise is played first until the
    // stack's top reaches that row -- from the first frame of a match on.
    if (o.profile.raiseTo && !(br && br.depth) && !SH.lowestGarbageRow(board) && SH.top(board) < o.profile.raiseTo) want = { raise: true };
    bot.preferRank = function (c, i) {
      if (want[c.kind === 'swap' && c.move ? c.move[0] + ',' + c.move[1] : c.kind]) return 0;
      // While a slab pops nothing can die, so a line breaking garbage later
      // earns no place over keeping panels (conserve): only a break now or a
      // lineup outranks it.
      // The survival search is not run on a board with nothing to fear,
      // so conserve's order is applied here too.
      if (popping) { var sb = this._settledOf(c); return sb && sb.grid ? KEEP_RANK + SH.keepRank(sb, converting) + gapOf(sb) : Infinity; }
      var t = i >= 0 && this._nat ? this._nat.breakAt(i) : -1;
      return t >= 0 ? t : Infinity;
    };
  }
  // Before any lands, conserve applies while a lot is on its way (BANK_ROWS):
  // the stack the first slab lands on is the one it is broken from.
  var comingRows = o.comingRows;
  if (tall) bot.preferProven = function (c) { return c.settled ? TALL_RANK + SH.gridTop(c.settled) : Infinity; };
  else if (o.profile.conserve && (board.incoming.length || SH.lowestGarbageRow(board) || comingRows >= BANK_ROWS)) {
    // A SLAB RESTING ON TWO COLUMNS OR FEWER is brought down first: nothing
    // can touch it from the columns it is not resting on, and the clear that drops it
    // costs the same panels now as when the bot is forced to it later.
    var drop = !popping && resting(board) <= RESTING;
    bot.preferProven = function (c) { var b = this._settledOf(c); return b && b.grid ? KEEP_RANK + (drop ? DROP_ROW * slabRow(b) - DROP_PANEL * SH.panelsOf(b) : SH.keepRank(b, converting)) + gapOf(b) : Infinity; };
  }
  else if (o.profile.lowerSlab && hanging(board)) bot.preferProven = function (c) { var b = this._settledOf(c); return b && b.grid ? HANG_RANK + slabRow(b) : Infinity; };
  return { br: br, brMs: brMs, want: want, popping: popping };
}
function key(c) { return c.kind === 'swap' && c.move ? c.move[0] + ',' + c.move[1] : c.kind; }
// A LINEUP WHILE A SLAB POPS IS PLAYED. Nothing can die before the pop
// ends and the lineup breaks the slab when it does; the bot's own stages
// (the lookahead, the modes) do not know what the pop's end brings.
// With threesLast, a three is not forced over the bot's own move.
function overrule(d, prep, bot) {
  var br = prep.br, want = prep.want;
  if (br && (prep.popping && br.lineup || br.touch) && !want[key(d)]) {
    var keys = Object.keys(want).filter(function (k) { return /^\d+,\d+$/.test(k); }), lk = keys[0];
    // of the breaks wanted, the one the cursor reaches soonest
    if (bot && bot.nearestFirst && keys.length > 1) {
      var near = Infinity;
      (bot._allCands || []).forEach(function (c) {
        if (c.kind === 'swap' && c.move && c.travel != null && c.travel < near && keys.indexOf(c.move[0] + ',' + c.move[1]) >= 0) { near = c.travel; lk = c.move[0] + ',' + c.move[1]; }
      });
    }
    var mv = lk && lk.split(',').map(Number);
    if (mv && bot && bot.refuseBareThree && bot.threeOnlySwap(mv)) return d;
    // a break the allowance of keys cannot pay for is not forced
    if (mv && bot && bot.allowance < Infinity && bot.stack && require('./survivor_keys.js').actionsFor(bot.stack.curRow, bot.stack.curCol, mv) > bot.allowance) return d;
    if (mv) return { kind: 'swap', move: mv, overruled: true };
  }
  return d;
}
module.exports = { prepare: prepare, overrule: overrule, key: key };
