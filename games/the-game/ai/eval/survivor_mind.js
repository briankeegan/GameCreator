// WasmSurvivor's mind: the survival bot deciding on the panel-game server's
// rules, in a worker thread of survivor.js so the frame loop never waits on
// it. Each request is a board the loop predicts for a frame still to come;
// the answer is the decision for that frame.
//
// The bot is puyocpu.js's, unchanged: its candidates and scores read the
// board through PAEngine.View (pa-engine.js toPanelEngine), and its
// survival search plays the server's rules on native/pa.c (serverStack).
var wt = require('worker_threads'), path = require('path'), fs = require('fs');
// The frame loop must never wait for a core: on Linux a thread's nice is its
// own, and the search threads this thread makes are born with it.
// GC_SURVIVOR_NICE (default 10; 0 leaves it).
try { require('os').setPriority(0, process.env.GC_SURVIVOR_NICE === undefined ? 10 : Number(process.env.GC_SURVIVOR_NICE)); } catch (e) {}
var DIR = __dirname;
require(path.join(DIR, '..', '..', 'panel-cpu.js'));
var P = require(path.join(DIR, 'puyocpu.js')), PA = require(path.join(DIR, '..', '..', 'pa-engine.js'));
var SH = require(path.join(DIR, 'survivor_shared.js'));
var cfg = wt.workerData, OPTS = SH.botOptions(cfg.profile, cfg.threads);
var rates = [], SPEND = Number(process.env.GC_SURVIVOR_SPEND) || 0.6;   // budget searched per millisecond over the last decisions, and the share of the time there is spent searching
// The search ends this long before the answer is due, for the rest of the decision and its post.
var DEADLINE_MARGIN_MS = Number(process.env.GC_SURVIVOR_MARGIN) || 30;
var TIGHT_MS = Number(process.env.GC_SURVIVOR_TIGHT) || 80;   // due sooner than this: one move deep
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
var bot = null, snap = null, nat = null, BS = null;   // BS: a search context of its own for breakMoves   // nat: the search's C context, kept from match to match
var NativeMem = function () {
  var N = require(path.join(DIR, 'native.js')).server, X = N.exports(), free = [];
  for (var k = 0; k < 4; k++) free.push(X.nb_pool_stat(k));
  return { bytes: N.memoryBytes(), heapMB: X.nb_pool_stat(-1) / 16, free: free, nodeCap: bot && bot._nat ? X.ns_ctx_cap(bot._nat.ctx) : 0 };
};

var failWritten = false;
wt.parentPort.on('message', function (m) {
  if (m.type === 'reset') { if (bot && bot._nat) nat = bot._nat; bot = null; snap = null; return; }
  // A question at or before the one the frame loop stopped is not wanted:
  // ids only grow, and only the newest is ever waited on.
  function stale() { return !!cfg.abort && Atomics.load(cfg.abort, 0) >= m.id; }
  if (stale()) { wt.parentPort.postMessage({ id: m.id, epoch: m.epoch, at: m.at, aborted: true, ms: 0 }); return; }
  var t0 = Date.now(), board = PA.revive(m.packed ? require('v8').deserialize(m.packed) : m.board), arrivals = [], out;
  // When the answer is due: m.ms from when it was asked (m.posted), so the
  // time a question waited behind the one before counts.
  var due = m.ms > 0 ? (m.posted || t0) + m.ms : 0;
  // Garbage on its way arrives that many frames on (search.h runFrame).
  arrivals = SH.arrivalsFrom(board, m.arrivals || []);
  var th = SH.threat(cfg.profile, m.lead || 0);
  if (th && arrivals.length < 64) arrivals.push(th);
  var view = PA.toPanelEngine(board);
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
    var popping = !!(cfg.profile.conserve && SH.popLeft(board)), converting = popping ? SH.convertingOf(board) : 0;
    var br = null, brMs = 0, want = {}, tall = cfg.profile.tallRow && SH.top(board) >= cfg.profile.tallRow;
    // No break search on a question due sooner than it could take (one asked
    // for the next frame, the plan dying): the answer would come late. The
    // survival search's own soonest breaks (breakAt) still rank the moves.
    var breakTime = !due || due - Date.now() >= DEADLINE_MARGIN_MS + LINEUP_MIN_MS;
    if (cfg.profile.breakFirst) {
      bot._natSearch();   // the engine, on this bot's threads, before a second context is made on it
      if (!BS) BS = new (require(path.join(DIR, 'native.js')).server.Search)({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames, threads: OPTS.threads || 1 });
      var tb = Date.now();
      if (breakTime) br = SH.breakMoves(BS, board, { left: m.hold.left, started: m.hold.started }, arrivals, cfg.profile.breakDepth, cfg.profile.lineup && SH.popLeft(board) ? SH.popLeft(board) + LINEUP_AFTER : 0,
                         due ? Math.min(Date.now() + Math.max(LINEUP_MIN_MS, m.ms * LINEUP_SHARE), due - DEADLINE_MARGIN_MS) : Date.now() + LINEUP_MAX_MS);
      brMs = Date.now() - tb;
      if (stale()) throw P.ABORTED;
      want = br && br.depth ? br.moves : {};
      // BANK PANELS BEFORE THE GARBAGE LANDS: once a slab is on the board the
      // stack is topped out and cannot rise, so the panels there are all
      // there will be but what breaking brings. With the profile's bank,
      // while garbage of BANK_ROWS rows or more is on its way and none has
      // landed, a raise is played first, up to BANK_TOP.
      if (cfg.profile.bank && !(br && br.depth) && !SH.lowestGarbageRow(board) && SH.top(board) < BANK_TOP) {
        var coming = 0;
        (m.arrivals || []).forEach(function (a) { coming += a.g ? a.g.height : 0; });
        (board.incoming || []).forEach(function (g) { coming += g.height; });
        if (coming >= BANK_ROWS) want = { raise: true };
      }
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
    var comingRows = 0;
    (m.arrivals || []).forEach(function (a) { comingRows += a.g ? a.g.height : 0; });
    if (tall) bot.preferProven = function (c) { return c.settled ? TALL_RANK + SH.gridTop(c.settled) : Infinity; };
    else if (cfg.profile.conserve && (board.incoming.length || SH.lowestGarbageRow(board) || comingRows >= BANK_ROWS)) {
      // A SLAB RESTING ON TWO COLUMNS OR FEWER is brought down first: nothing
      // can touch it from the columns it is not resting on, and the clear that drops it
      // costs the same panels now as when the bot is forced to it later.
      var drop = !popping && resting(board) <= RESTING;
      bot.preferProven = function (c) { var b = this._settledOf(c); return b && b.grid ? KEEP_RANK + (drop ? DROP_ROW * slabRow(b) - DROP_PANEL * SH.panelsOf(b) : SH.keepRank(b, converting)) + gapOf(b) : Infinity; };
    }
    else if (cfg.profile.lowerSlab && hanging(board)) bot.preferProven = function (c) { var b = this._settledOf(c); return b && b.grid ? HANG_RANK + slabRow(b) : Infinity; };
    // THE TIME THERE IS: the survival search's budget is what can be searched
    // in the milliseconds before the answer is due (m.ms; 0 waits for the
    // whole budget), at the slowest rate of the last few decisions: a tall
    // board searches several times slower than an empty one. GC_SURVIVOR_FULL,
    // _CHEAP and _SPEND override the most, the least and the share.
    var nodesPerMs = rates.length ? Math.min.apply(null, rates) : 30;
    var FULL = Number(process.env.GC_SURVIVOR_FULL) || P.prototype.SURVIVE_SEARCH_BUDGET, CHEAP = Number(process.env.GC_SURVIVOR_CHEAP) || P.prototype.SURVIVE_SEARCH_BUDGET_CHEAP;
    bot.SURVIVE_SEARCH_BUDGET = due ? Math.max(CHEAP, Math.min(FULL, Math.round((due - Date.now()) * nodesPerMs * SPEND))) : FULL;
    // The frame loop stops a question it no longer needs (stale). A search
    // still running DEADLINE_MARGIN_MS before the answer is due ends there
    // with what it has proven, as if its budget had run out.
    bot._abort = cfg.abort ? stale : null;
    var N = require(path.join(DIR, 'native.js')).server;
    if (due) N.deadline(due - DEADLINE_MARGIN_MS);
    var d;
    var t1 = Date.now();
    bot._svMs = 0;
    var ranked = [], key = function (c) { return c.kind === 'swap' && c.move ? c.move[0] + ',' + c.move[1] : c.kind; };
    var provenRanked = [];
    if (process.env.GC_SURVIVOR_WHY && bot.preferProven) { var pp0 = bot.preferProven; bot.preferProven = function (c, i) { var r = pp0.call(this, c, i); provenRanked.push(key(c) + '=' + r); return r; }; }
    if (process.env.GC_SURVIVOR_WHY && bot.preferRank) { var pr0 = bot.preferRank; bot.preferRank = function (c, i) { var r = pr0.call(this, c, i); ranked.push(key(c) + '=' + r); return r; }; }
    // A question due within TIGHT_MS is decided one move deep: the lookahead
    // has no clock, and its second ply is most of what is left.
    var depth0 = bot.depth;
    var tight = !!(due && due - Date.now() < TIGHT_MS);
    if (tight) bot.depth = 1;
    try { d = bot._decide(); } finally { bot._abort = null; N.deadline(0); bot.depth = depth0; }
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
    out = { id: m.id, epoch: m.epoch, at: m.at, kind: d.kind, move: d.move ? [d.move[0], d.move[1]] : null, ms: Date.now() - t0, queued: m.posted ? t0 - m.posted : 0, brMs: brMs, why: why,
          line: line, lineAt: line && !lineFree ? fl.at : null, lineFree: lineFree,
          mem: NativeMem(),
          breaks: br && br.depth ? { offered: br.depth, lineup: !!br.lineup, touch: !!br.touch, took: !!want[d.move ? d.move[0] + ',' + d.move[1] : d.kind] } : null,
          diag: { tight: tight, budget: bot.SURVIVE_SEARCH_BUDGET, took: took, survive: bot._svMs || 0, doomed: bot.doomedDecisions, allDoomed: bot.allDoomedNow, unproven: bot.survivalUnproven || 0, fast: bot.followFast || 0, dropped: bot.doomedMovesDropped } };
  } catch (e) {
    if (e === P.ABORTED) out = { id: m.id, epoch: m.epoch, at: m.at, aborted: true, ms: Date.now() - t0 };
    else out = { id: m.id, epoch: m.epoch, at: m.at, error: String(e && e.stack || e) + ' [inc ' + (board && board.incoming ? board.incoming.length : '?') + ', arr ' + (m.arrivals ? m.arrivals.length : '?') + ']', ms: Date.now() - t0 };
    // GC_SURVIVOR_FAILS=file: the first failed question, as survivor.js's dump writes one (asked), to be asked again offline
    if (!(e === P.ABORTED) && process.env.GC_SURVIVOR_FAILS && !failWritten) {
      failWritten = true;
      require('fs').appendFileSync(process.env.GC_SURVIVOR_FAILS, JSON.stringify({ asked: [{ id: m.id, at: m.at, hold: m.hold, arrivals: m.arrivals, acted: m.acted,
        board: Buffer.from(m.packed || require('v8').serialize(m.board)).toString('base64') }] }) + '\n');
    }
  }
  wt.parentPort.postMessage(out);
});
wt.parentPort.postMessage({ ready: true });
