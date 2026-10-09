// WasmSurvivor's thinking: the survival bot deciding one question on the
// panel-game server's rules. survivor_mind.js asks it from a worker thread of
// survivor.js; survivor_duel.js asks it in-process, a question at a time.
//
// The bot is puyocpu.js's, unchanged: its candidates and scores read the
// board through PAEngine.View (pa-engine.js toPanelEngine), and its
// survival search plays the server's rules on native/pa.c (serverStack).
//
//   var mind = require('./survivor_think.js')({ profile, threads, abort, weights })
//   mind.answer(question) -> answer; mind.reset() between matches
//   abort: an Int32Array whose [0] is the newest question no longer wanted
//   weights: replace the profile's (a feature absent counts 0)
var path = require('path'), fs = require('fs');
var DIR = __dirname;
require(path.join(DIR, '..', '..', 'panel-cpu.js'));
var P = require(path.join(DIR, 'puyocpu.js')), PA = require(path.join(DIR, '..', '..', 'pa-engine.js'));
var SH = require(path.join(DIR, 'survivor_shared.js')), SP = require(path.join(DIR, 'survivor_prefer.js'));
var SPEND = Number(process.env.GC_SURVIVOR_SPEND) || 0.6;   // budget searched per millisecond over the last decisions, and the share of the time there is spent searching
// The search ends this long before the answer is due, for the rest of the decision and its post.
var DEADLINE_MARGIN_MS = Number(process.env.GC_SURVIVOR_MARGIN) || 30;
var TIGHT_MS = Number(process.env.GC_SURVIVOR_TIGHT) || 80;   // due sooner than this: one move deep
var LOOKAHEAD_MARGIN_MS = 15;   // the second ply ends this long before the answer is due, for the rest and the post
module.exports = function think(cfg) {
  var OPTS = SH.botOptions(cfg.profile, cfg.threads);
  if (cfg.weights) OPTS.weights = cfg.weights;
  var rates = [];   // budget searched per millisecond over the last decisions
  function search() {
    if (!BS) BS = new (require(path.join(DIR, 'native.js')).server.Search)({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames, threads: OPTS.threads || 1 });
    return BS;
  }
  var bot = null, snap = null, nat = null, candNat = null, BS = null;   // BS: a search context of its own for breakMoves   // nat, candNat: the search's and the candidates' C contexts, kept from match to match
  var NativeMem = function () {
    var N = require(path.join(DIR, 'native.js')).server, X = N.exports(), free = [];
    for (var k = 0; k < 4; k++) free.push(X.nb_pool_stat(k));
    return { bytes: N.memoryBytes(), heapMB: X.nb_pool_stat(-1) / 16, free: free, nodeCap: bot && bot._nat ? X.ns_ctx_cap(bot._nat.ctx) : 0 };
  };

  var failWritten = false;
  // The engine and its threads, compiled before the first question.
  (function () { var N = require(path.join(DIR, 'native.js')).server; if ((OPTS.threads || 1) > 1) N.initThreads(OPTS.threads); else N.init(); })();
  function answer(m) {
    // A question at or before the one the frame loop stopped is not wanted:
    // ids only grow, and only the newest is ever waited on.
    function stale() { return !!cfg.abort && Atomics.load(cfg.abort, 0) >= m.id; }
    if (stale()) return { id: m.id, epoch: m.epoch, at: m.at, aborted: true, ms: 0 };
    var t0 = Date.now(), board = PA.revive(m.packed ? require('v8').deserialize(m.packed) : m.board), arrivals = [], out;
    // When the answer is due: m.ms from when it was asked (m.posted), so the
    // time a question waited behind the one before counts.
    var due = m.ms > 0 ? (m.posted || t0) + m.ms : 0;
    // Garbage on its way arrives that many frames on (search.h runFrame).
    arrivals = SH.arrivalsFrom(board, m.arrivals || []);
    var th = SH.threat(cfg.profile, m.lead || 0);
    if (th && arrivals.length < 64) arrivals.push(th);
    var view = PA.toPanelEngine(board), comingRows = 0;
    (m.arrivals || []).forEach(function (a) { comingRows += a.g ? a.g.height : 0; });
    try {
      if (!bot) {
        bot = new P(view, OPTS);
        if (nat) bot._nat = nat;
        if (candNat) bot._candNat = candNat;
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
      var prep = SP.prepare(bot, board, { profile: cfg.profile, hold: m.hold, arrivals: arrivals, comingRows: comingRows, due: due, ms: m.ms, margin: DEADLINE_MARGIN_MS,
                                        search: search, stale: stale, aborted: P.ABORTED });
      var br = prep.br, brMs = prep.brMs, want = prep.want;
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
      bot._dueAt = due ? due - LOOKAHEAD_MARGIN_MS : 0;
      try { d = bot._decide(); } finally { bot._abort = null; N.deadline(0); bot.depth = depth0; bot._dueAt = 0; }
      var why = null;
      if (process.env.GC_SURVIVOR_WHY) {
        var sp = bot._searchProofs;
        why = { provenRanks: provenRanked.join(' '), ranked: ranked.join(' '), want: Object.keys(want), cands: sp ? sp.cands.map(key) : null, proven: sp ? sp.cands.filter(function (c, i) { return sp.proofs[i]; }).map(key) : null };
      }
      d = SP.overrule(d, prep, bot);   // a lineup while a slab pops (survivor_prefer.js)
      var overruled = !!d.overruled;
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
            diag: { tight: tight, budget: bot.SURVIVE_SEARCH_BUDGET, took: took, survive: bot._svMs || 0, doomed: bot.doomedDecisions, allDoomed: bot.allDoomedNow, unproven: bot.survivalUnproven || 0, fast: bot.followFast || 0, dropped: bot.doomedMovesDropped, bare3Dropped: bot.bareThreesDropped, bare3Kept: bot.bareThreesKept } };
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
    return out;
    }
  function reset() { if (bot && bot._nat) nat = bot._nat; if (bot && bot._candNat) candNat = bot._candNat; bot = null; snap = null; }
  // New weights take effect from the next match (reset).
  function setWeights(w) { OPTS.weights = w; }
  return { answer: answer, reset: reset, setWeights: setWeights };
};
