// WasmSurvivor's mind: the survival bot deciding on the panel-game server's
// rules, in a worker thread of survivor.js so the frame loop never waits on
// it. Each request is a board the loop predicts for a frame still to come;
// the answer is the decision for that frame.
//
// The bot is puyocpu.js's, unchanged: its candidates and scores read the
// board as panel-engine.js holds it (pa-engine.js toPanelEngine), and its
// survival search plays the server's rules on native/pa.c (serverStack).
var wt = require('worker_threads'), path = require('path'), fs = require('fs');
var DIR = __dirname;
require(path.join(DIR, '..', '..', 'panel-engine.js'));
require(path.join(DIR, '..', '..', 'panel-cpu.js'));
var P = require(path.join(DIR, 'puyocpu.js')), PA = require(path.join(DIR, 'pa-engine.js')), PE = globalThis.PanelEngine;
var SH = require(path.join(DIR, 'survivor_shared.js'));
var cfg = wt.workerData, OPTS = SH.botOptions(cfg.profile, cfg.threads);
var rates = [], SPEND = 0.6;   // budget searched per millisecond over the last decisions, and the share of the time there is spent searching
var TALL_RANK = 30;
var LINEUP_AFTER = 30;   // frames past a pop's end a lined-up row has to have matched by
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
function panelsOf(b) {
  var n = 0;
  if (b && b.grid) for (var r = 1; r < b.grid.length; r++) { var row = b.grid[r]; if (row) for (var c = 1; c <= b.width; c++) if (row[c] > 0) n++; }
  return n;
}
// Of those, the flattest under the garbage: the cells between each column's
// top and the lowest garbage (or, none landed yet, the tallest column). Garbage
// rests on the tallest column, and only a column it rests on can touch it.
function gapOf(b) {
  var g = 0, r, c, tops = [], hi = 0, gap = 0;
  for (r = 1; r < b.grid.length && !g; r++) { var row = b.grid[r]; if (row) for (c = 1; c <= b.width; c++) if (row[c] < 0) { g = r; break; } }
  for (c = 1; c <= b.width; c++) {
    var t = 0;
    for (r = 1; r < (g || b.grid.length); r++) if (b.grid[r] && b.grid[r][c] > 0) t = r;
    tops.push(t); if (t > hi) hi = t;
  }
  var under = g ? g - 1 : hi;
  tops.forEach(function (t) { gap += Math.max(0, under - t); });
  return gap;
}
function hanging(board) {
  var g = 0, r, c;
  for (r = 1; r < board.panels.length && !g; r++) { var row = board.panels[r]; if (row) for (c = 1; c <= 6; c++) if (row[c] && row[c].isGarbage) { g = r; break; } }
  if (!g) return false;
  for (c = 1; c <= 6; c++) {
    var h = 0;
    for (r = 1; r < g; r++) if (board.panels[r] && board.panels[r][c] && board.panels[r][c].color) h = r;
    if (h < g - 1) return true;
  }
  return false;
}   // frames: a break sooner than this outranks lowering a tall board
var bot = null, snap = null, nat = null, BS = null;   // BS: a search context of its own for breakMoves   // nat: the search's C context, kept from match to match
var NativeMem = function () {
  var N = require(path.join(DIR, 'native.js')).server, X = N.exports(), free = [];
  for (var k = 0; k < 4; k++) free.push(X.nb_pool_stat(k));
  return { bytes: N.memoryBytes(), heapMB: X.nb_pool_stat(-1) / 16, free: free, nodeCap: bot && bot._nat ? X.ns_ctx_cap(bot._nat.ctx) : 0 };
};

wt.parentPort.on('message', function (m) {
  if (m.type === 'reset') { if (bot && bot._nat) nat = bot._nat; bot = null; snap = null; return; }
  var t0 = Date.now(), board = PA.revive(m.board), arrivals = [], out;
  // Garbage on its way arrives that many frames on (search.h runFrame).
  arrivals = SH.arrivalsFrom(board, m.arrivals || []);
  var th = SH.threat(cfg.profile, m.lead || 0);
  if (th && arrivals.length < 64) arrivals.push(th);
  var view = PA.toPanelEngine(board, PE);
  try {
    if (!bot) {
      bot = new P(view, OPTS);
      if (nat) bot._nat = nat;
    }
    // A decision that was never played is taken back, as Mind.think does.
    if (snap && !m.acted) {
      for (var k in bot) if (Object.prototype.hasOwnProperty.call(bot, k) && !Object.prototype.hasOwnProperty.call(snap, k)) delete bot[k];
      for (k in snap) bot[k] = snap[k];
    }
    snap = Object.assign({}, bot);
    bot.stack = view;
    bot.serverStack = board;
    bot.serverArrivals = arrivals;
    bot.raiseFrames = m.hold.left; bot._raiseStarted = m.hold.started;
    bot.opponent = null;
    bot._predArr = [];
    bot.decisions = (bot.decisions || 0) + 1;
    // BREAK GARBAGE FIRST: of the moves proven to live, one that breaks
    // garbage now; failing that, the one whose lines in the survival search
    // break it soonest (native Search.breakAt); only then the rest. A board
    // reaching the profile's tallRow -- panels or garbage -- plays the move
    // that leaves its top lowest: a move leaving the top at row h ranks as a
    // break TALL_RANK + h frames away. Six-wide garbage lands on the tallest
    // column, so that column is the board's height.
    bot.preferRank = null; bot.preferProven = null;
    var popping = !!(cfg.profile.conserve && SH.popLeft(board));
    var br = null, brMs = 0, want = {}, tall = cfg.profile.tallRow && SH.top(board) >= cfg.profile.tallRow;
    if (cfg.profile.breakFirst) {
      bot._natSearch();   // the engine, on this bot's threads, before a second context is made on it
      if (!BS) BS = new (require(path.join(DIR, 'native.js')).server.Search)({ reaction: OPTS.reaction, cursorMoveFrames: OPTS.cursorMoveFrames, threads: OPTS.threads || 1 });
      var tb = Date.now();
      br = SH.breakMoves(BS, board, { left: m.hold.left, started: m.hold.started }, arrivals, cfg.profile.breakDepth, cfg.profile.lineup && SH.popLeft(board) ? SH.popLeft(board) + LINEUP_AFTER : 0);
      brMs = Date.now() - tb;
      want = br.depth ? br.moves : {};
      bot.preferRank = function (c, i) {
        if (want[c.kind === 'swap' && c.move ? c.move[0] + ',' + c.move[1] : c.kind]) return 0;
        // While a slab pops nothing can die, so a line breaking garbage later
        // earns no place over keeping panels (conserve): only a break now or a
        // lineup outranks it.
        if (popping) return Infinity;
        var t = i >= 0 && this._nat ? this._nat.breakAt(i) : -1;
        return t >= 0 ? t : Infinity;
      };
    }
    if (tall) bot.preferProven = function (c) { return c.settled ? TALL_RANK + SH.gridTop(c.settled) : Infinity; };
    else if (cfg.profile.conserve && (board.incoming.length || SH.lowestGarbageRow(board))) bot.preferProven = function (c) { var b = this._settledOf(c); return b && b.grid ? KEEP_RANK - 100 * panelsOf(b) + gapOf(b) : Infinity; };
    else if (cfg.profile.lowerSlab && hanging(board)) bot.preferProven = function (c) { var b = this._settledOf(c); return b && b.grid ? HANG_RANK + slabRow(b) : Infinity; };
    // THE TIME THERE IS: the survival search's budget is what can be searched
    // in the milliseconds before the answer is due (m.ms; 0 waits for the
    // whole budget), at the slowest rate of the last few decisions: a tall
    // board searches several times slower than an empty one.
    var nodesPerMs = rates.length ? Math.min.apply(null, rates) : 30;
    var FULL = P.prototype.SURVIVE_SEARCH_BUDGET, CHEAP = P.prototype.SURVIVE_SEARCH_BUDGET_CHEAP;
    bot.SURVIVE_SEARCH_BUDGET = m.ms > 0 ? Math.max(CHEAP, Math.min(FULL, Math.round(m.ms * nodesPerMs * SPEND))) : FULL;
    // The frame loop stops a question it no longer needs (cfg.abort holds its id).
    bot._abort = cfg.abort ? function () { return Atomics.load(cfg.abort, 0) === m.id; } : null;
    var d;
    var t1 = Date.now();
    var ranked = [], key = function (c) { return c.kind === 'swap' && c.move ? c.move[0] + ',' + c.move[1] : c.kind; };
    if (process.env.GC_SURVIVOR_WHY && bot.preferRank) { var pr0 = bot.preferRank; bot.preferRank = function (c, i) { var r = pr0.call(this, c, i); ranked.push(key(c) + '=' + r); return r; }; }
    try { d = bot._decide(); } finally { bot._abort = null; }
    var why = null;
    if (process.env.GC_SURVIVOR_WHY && br && br.depth) {
      var sp = bot._searchProofs;
      why = { ranked: ranked.join(' '), want: Object.keys(want), cands: sp ? sp.cands.map(key) : null, proven: sp ? sp.cands.filter(function (c, i) { return sp.proofs[i]; }).map(key) : null };
    }
    // A LINEUP WHILE A SLAB POPS IS PLAYED. Nothing can die before the pop
    // ends and the lineup breaks the slab when it does; the bot's own stages
    // (the lookahead, the modes) do not know what the pop's end brings.
    var overruled = false;
    if (popping && br && br.lineup && !want[key(d)]) {
      var lk = Object.keys(want).filter(function (k) { return /^\d+,\d+$/.test(k); })[0];
      if (lk) { d = { kind: 'swap', move: lk.split(',').map(Number) }; overruled = true; }
    }
    var took = Date.now() - t1;
    if (took > 20) { rates.push(bot.SURVIVE_SEARCH_BUDGET / took); if (rates.length > 8) rates.shift(); }
    // The rest of the proven line behind the move, for the frame loop to play
    // on while the next decision is late: steps as the search played them
    // ([row, col], 'raise', null for a hold, { long: until }), from lineAt.
    var fl = overruled ? null : bot._following, line = fl && !fl.hold && fl.steps && fl.steps.length ? fl.steps : null;
    out = { id: m.id, epoch: m.epoch, at: m.at, kind: d.kind, move: d.move ? [d.move[0], d.move[1]] : null, ms: Date.now() - t0, brMs: brMs, why: why,
          line: line, lineAt: line ? fl.at : null,
          mem: NativeMem(),
          breaks: br && br.depth ? { offered: br.depth, lineup: !!br.lineup, took: !!want[d.move ? d.move[0] + ',' + d.move[1] : d.kind] } : null,
          diag: { doomed: bot.doomedDecisions, allDoomed: bot.allDoomedNow, unproven: bot.survivalUnproven || 0, fast: bot.followFast || 0, dropped: bot.doomedMovesDropped } };
  } catch (e) {
    if (e === P.ABORTED) out = { id: m.id, epoch: m.epoch, at: m.at, aborted: true, ms: Date.now() - t0 };
    else out = { id: m.id, epoch: m.epoch, at: m.at, error: String(e && e.stack || e) + ' [inc ' + (m.board && m.board.incoming ? m.board.incoming.length : '?') + ', arr ' + (m.arrivals ? m.arrivals.length : '?') + ']', ms: Date.now() - t0 };
  }
  wt.parentPort.postMessage(out);
});
wt.parentPort.postMessage({ ready: true });
