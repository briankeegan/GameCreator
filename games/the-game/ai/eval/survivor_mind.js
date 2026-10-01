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
var TALL_RANK = 30;   // frames: a break sooner than this outranks lowering a tall board
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
    var br = null, want = {}, tall = cfg.profile.tallRow && SH.top(board) >= cfg.profile.tallRow;
    if (cfg.profile.breakFirst) {
      bot._natSearch();   // the engine, on this bot's threads, before a second context is made on it
      if (!BS) BS = new (require(path.join(DIR, 'native.js')).server.Search)({ reaction: OPTS.reaction, cursorMoveFrames: OPTS.cursorMoveFrames, threads: OPTS.threads || 1 });
      br = SH.breakMoves(BS, board, { left: m.hold.left, started: m.hold.started }, arrivals, cfg.profile.breakDepth);
      want = br.depth ? br.moves : {};
      bot.preferRank = function (c, i) {
        if (want[c.kind === 'swap' && c.move ? c.move[0] + ',' + c.move[1] : c.kind]) return 0;
        var t = i >= 0 && this._nat ? this._nat.breakAt(i) : -1;
        return t >= 0 ? t : Infinity;
      };
    }
    if (tall) bot.preferProven = function (c) { return c.settled ? TALL_RANK + SH.gridTop(c.settled) : Infinity; };
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
    try { d = bot._decide(); } finally { bot._abort = null; }
    var took = Date.now() - t1;
    if (took > 20) { rates.push(bot.SURVIVE_SEARCH_BUDGET / took); if (rates.length > 8) rates.shift(); }
    // The rest of the proven line behind the move, for the frame loop to play
    // on while the next decision is late: steps as the search played them
    // ([row, col], 'raise', null for a hold, { long: until }), from lineAt.
    var fl = bot._following, line = fl && !fl.hold && fl.steps && fl.steps.length ? fl.steps : null;
    out = { id: m.id, epoch: m.epoch, at: m.at, kind: d.kind, move: d.move ? [d.move[0], d.move[1]] : null, ms: Date.now() - t0,
          line: line, lineAt: line ? fl.at : null,
          mem: NativeMem(),
          breaks: br && br.depth ? { offered: br.depth, took: !!want[d.move ? d.move[0] + ',' + d.move[1] : d.kind] } : null,
          diag: { doomed: bot.doomedDecisions, allDoomed: bot.allDoomedNow, unproven: bot.survivalUnproven || 0, fast: bot.followFast || 0, dropped: bot.doomedMovesDropped } };
  } catch (e) {
    if (e === P.ABORTED) out = { id: m.id, epoch: m.epoch, at: m.at, aborted: true, ms: Date.now() - t0 };
    else out = { id: m.id, epoch: m.epoch, at: m.at, error: String(e && e.stack || e), ms: Date.now() - t0 };
  }
  wt.parentPort.postMessage(out);
});
wt.parentPort.postMessage({ ready: true });
