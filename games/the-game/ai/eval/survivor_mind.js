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
var rates = [], SPEND = Number(process.env.GC_SURVIVOR_SPEND) || 0.6;   // budget searched per millisecond over the last decisions, and the share of the time there is spent searching
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
// HOW LONG A MOVE KEEPS THE BOARD ALIVE IS MEASURED, NOT PRICED. With the
// profile's measureLife, while garbage is on the board or on its way, the
// survival search plays each proven move's line on to LIFE_FRAMES on the
// engine and keeps the moves living longest, then holding the most panels
// (puyocpu.js _measureLife).
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
var bot = null, snap = null, nat = null, BS = null;   // BS: a search context of its own for breakMoves   // nat: the search's C context, kept from match to match
var NativeMem = function () {
  var N = require(path.join(DIR, 'native.js')).server, X = N.exports(), free = [];
  for (var k = 0; k < 4; k++) free.push(X.nb_pool_stat(k));
  return { bytes: N.memoryBytes(), heapMB: X.nb_pool_stat(-1) / 16, free: free, nodeCap: bot && bot._nat ? X.ns_ctx_cap(bot._nat.ctx) : 0 };
};

wt.parentPort.on('message', function (m) {
  if (m.type === 'reset') { if (bot && bot._nat) nat = bot._nat; bot = null; snap = null; return; }
  // A question at or before the one the frame loop stopped is not wanted:
  // ids only grow, and only the newest is ever waited on.
  function stale() { return !!cfg.abort && Atomics.load(cfg.abort, 0) >= m.id; }
  if (stale()) { wt.parentPort.postMessage({ id: m.id, epoch: m.epoch, at: m.at, aborted: true, ms: 0 }); return; }
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
    var popping = !!SH.popLeft(board);
    bot.measureLife = false;
    var br = null, brMs = 0, want = {}, tall = cfg.profile.tallRow && SH.top(board) >= cfg.profile.tallRow;
    if (cfg.profile.breakFirst) {
      bot._natSearch();   // the engine, on this bot's threads, before a second context is made on it
      if (!BS) BS = new (require(path.join(DIR, 'native.js')).server.Search)({ reaction: OPTS.reaction, cursorMoveFrames: OPTS.cursorMoveFrames, threads: OPTS.threads || 1 });
      var tb = Date.now();
      br = SH.breakMoves(BS, board, { left: m.hold.left, started: m.hold.started }, arrivals, cfg.profile.breakDepth, cfg.profile.lineup && SH.popLeft(board) ? SH.popLeft(board) + LINEUP_AFTER : 0,
                         Date.now() + (m.ms > 0 ? Math.max(LINEUP_MIN_MS, m.ms * LINEUP_SHARE) : LINEUP_MAX_MS));
      brMs = Date.now() - tb;
      if (stale()) throw P.ABORTED;
      want = br.depth ? br.moves : {};
      // BANK PANELS BEFORE THE GARBAGE LANDS: once a slab is on the board the
      // stack is topped out and cannot rise, so the panels there are all
      // there will be but what breaking brings. With the profile's bank,
      // while garbage of BANK_ROWS rows or more is on its way and none has
      // landed, a raise is played first, up to BANK_TOP.
      if (cfg.profile.bank && !br.depth && !SH.lowestGarbageRow(board) && SH.top(board) < BANK_TOP) {
        var coming = 0;
        (m.arrivals || []).forEach(function (a) { coming += a.g ? a.g.height : 0; });
        (board.incoming || []).forEach(function (g) { coming += g.height; });
        if (coming >= BANK_ROWS) want = { raise: true };
      }
      bot.preferRank = function (c, i) {
        if (want[c.kind === 'swap' && c.move ? c.move[0] + ',' + c.move[1] : c.kind]) return 0;
        var t = i >= 0 && this._nat ? this._nat.breakAt(i) : -1;
        return t >= 0 ? t : Infinity;
      };
    }
    // Before any lands, life is measured while a lot is on its way (BANK_ROWS):
    // the stack the first slab lands on is the one it is broken from.
    var comingRows = 0;
    (m.arrivals || []).forEach(function (a) { comingRows += a.g ? a.g.height : 0; });
    if (tall) bot.preferProven = function (c) { return c.settled ? TALL_RANK + SH.gridTop(c.settled) : Infinity; };
    else if (cfg.profile.measureLife && (board.incoming.length || SH.lowestGarbageRow(board) || comingRows >= BANK_ROWS)) bot.measureLife = true;
    else if (cfg.profile.lowerSlab && hanging(board)) bot.preferProven = function (c) { var b = this._settledOf(c); return b && b.grid ? HANG_RANK + slabRow(b) : Infinity; };
    // THE TIME THERE IS: the survival search's budget is what can be searched
    // in the milliseconds before the answer is due (m.ms; 0 waits for the
    // whole budget), at the slowest rate of the last few decisions: a tall
    // board searches several times slower than an empty one. GC_SURVIVOR_FULL,
    // _CHEAP and _SPEND override the most, the least and the share.
    var nodesPerMs = rates.length ? Math.min.apply(null, rates) : 30;
    var FULL = Number(process.env.GC_SURVIVOR_FULL) || P.prototype.SURVIVE_SEARCH_BUDGET, CHEAP = Number(process.env.GC_SURVIVOR_CHEAP) || P.prototype.SURVIVE_SEARCH_BUDGET_CHEAP;
    bot.SURVIVE_SEARCH_BUDGET = m.ms > 0 ? Math.max(CHEAP, Math.min(FULL, Math.round(m.ms * nodesPerMs * SPEND))) : FULL;
    // The frame loop stops a question it no longer needs (stale).
    bot._abort = cfg.abort ? stale : null;
    var d;
    var t1 = Date.now();
    var ranked = [], key = function (c) { return c.kind === 'swap' && c.move ? c.move[0] + ',' + c.move[1] : c.kind; };
    var provenRanked = [];
    if (process.env.GC_SURVIVOR_WHY && bot.preferProven) { var pp0 = bot.preferProven; bot.preferProven = function (c, i) { var r = pp0.call(this, c, i); provenRanked.push(key(c) + '=' + r); return r; }; }
    if (process.env.GC_SURVIVOR_WHY && bot.preferRank) { var pr0 = bot.preferRank; bot.preferRank = function (c, i) { var r = pr0.call(this, c, i); ranked.push(key(c) + '=' + r); return r; }; }
    try { d = bot._decide(); } finally { bot._abort = null; }
    var why = null;
    if (process.env.GC_SURVIVOR_WHY) {
      var sp = bot._searchProofs;
      why = { provenRanks: provenRanked.join(' '), ranked: ranked.join(' '), want: Object.keys(want), cands: sp ? sp.cands.map(key) : null, proven: sp ? sp.cands.filter(function (c, i) { return sp.proofs[i]; }).map(key) : null };
    }
    // A LINEUP WHILE A SLAB POPS IS PLAYED. Nothing can die before the pop
    // ends and the lineup breaks the slab when it does; the bot's own stages
    // (the lookahead, the modes) do not know what the pop's end brings.
    var overruled = false;
    if (br && (popping && br.lineup || br.touch) && !want[key(d)]) {
      var lk = Object.keys(want).filter(function (k) { return /^\d+,\d+$/.test(k); })[0];
      if (lk) { d = { kind: 'swap', move: lk.split(',').map(Number) }; overruled = true; }
    }
    var took = Date.now() - t1;
    if (took > 20) { rates.push(bot.SURVIVE_SEARCH_BUDGET / took); if (rates.length > 8) rates.shift(); }
    // The rest of the proven line behind the move, for the frame loop to play
    // on while the next decision is late: steps as the search played them
    // ([row, col], 'raise', null for a hold, { long: until }), from lineAt.
    var fl = overruled ? null : bot._following, line = fl && !fl.hold && fl.steps && fl.steps.length ? fl.steps : null;
    // An aimed lineup is its whole path: the swaps after the first are the
    // line, from wherever the first ends.
    var lineFree = false;
    if (br && br.path && d.kind === 'swap' && d.move && br.path[0][0] === d.move[0] && br.path[0][1] === d.move[1] && br.path.length > 1) { line = br.path.slice(1); lineFree = true; }
    out = { id: m.id, epoch: m.epoch, at: m.at, kind: d.kind, move: d.move ? [d.move[0], d.move[1]] : null, ms: Date.now() - t0, brMs: brMs, why: why,
          line: line, lineAt: line && !lineFree ? fl.at : null, lineFree: lineFree,
          mem: NativeMem(),
          breaks: br && br.depth ? { offered: br.depth, lineup: !!br.lineup, touch: !!br.touch, took: !!want[d.move ? d.move[0] + ',' + d.move[1] : d.kind] } : null,
          diag: { doomed: bot.doomedDecisions, allDoomed: bot.allDoomedNow, unproven: bot.survivalUnproven || 0, fast: bot.followFast || 0, dropped: bot.doomedMovesDropped } };
  } catch (e) {
    if (e === P.ABORTED) out = { id: m.id, epoch: m.epoch, at: m.at, aborted: true, ms: Date.now() - t0 };
    else out = { id: m.id, epoch: m.epoch, at: m.at, error: String(e && e.stack || e) + ' [inc ' + (m.board && m.board.incoming ? m.board.incoming.length : '?') + ', arr ' + (m.arrivals ? m.arrivals.length : '?') + ']', ms: Date.now() - t0 };
  }
  wt.parentPort.postMessage(out);
});
wt.parentPort.postMessage({ ready: true });
