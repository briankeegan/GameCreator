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
var cfg = wt.workerData;
var weights = JSON.parse(fs.readFileSync(path.join(DIR, cfg.weights), 'utf8')).weights;
var bot = null, snap = null;
var NativeMem = function () {
  var N = require(path.join(DIR, 'native.js')).server, X = N.exports(), free = [];
  for (var k = 0; k < 4; k++) free.push(X.nb_pool_stat(k));
  return { bytes: N.memoryBytes(), heapMB: X.nb_pool_stat(-1) / 16, free: free, nodeCap: bot && bot._nat ? X.ns_ctx_cap(bot._nat.ctx) : 0 };
};

wt.parentPort.on('message', function (m) {
  if (m.type === 'reset') { bot = null; snap = null; return; }
  var t0 = Date.now(), board = PA.revive(m.board), arrivals = [], out;
  // Garbage on its way arrives that many frames on (search.h runFrame
  // receives it once the frame before has run, as the server does).
  (m.arrivals || []).forEach(function (a) {
    if (a.at > board.stopWatch) arrivals.push({ at: a.at - board.stopWatch, width: a.g.width, height: a.g.height, isChain: !!a.g.isChain, isMetal: !!a.g.isMetal });
  });
  var view = PA.toPanelEngine(board, PE);
  try {
    if (!bot) {
      bot = new P(view, { weights: weights, reaction: cfg.reaction, depth: 2, beam: 0, rise: true, allowRaise: true, modes: true,
                          engine: true, native: true, threads: cfg.threads, cursorMoveFrames: cfg.cursorMoveFrames });
    }
    // A decision that was never played is taken back, as Mind.think does.
    if (snap && !m.acted) {
      for (var k in bot) if (Object.prototype.hasOwnProperty.call(bot, k) && !Object.prototype.hasOwnProperty.call(snap, k)) delete bot[k];
      for (k in snap) bot[k] = snap[k];
    }
    snap = Object.assign({}, bot);
    bot.stack = view;
    bot.serverStack = board;
    bot.serverArrivals = arrivals.slice(0, 16);   // search.h MAXARR
    bot.raiseFrames = m.hold.left; bot._raiseStarted = m.hold.started;
    bot.opponent = null;
    bot._predArr = [];
    bot.decisions = (bot.decisions || 0) + 1;
    var d = bot._decide();
    out = { id: m.id, epoch: m.epoch, at: m.at, kind: d.kind, move: d.move ? [d.move[0], d.move[1]] : null, ms: Date.now() - t0,
          mem: NativeMem(),
          diag: { doomed: bot.doomedDecisions, allDoomed: bot.allDoomedNow, unproven: bot.survivalUnproven || 0, fast: bot.followFast || 0, dropped: bot.doomedMovesDropped } };
  } catch (e) {
    out = { id: m.id, epoch: m.epoch, at: m.at, error: String(e && e.stack || e), ms: Date.now() - t0 };
  }
  wt.parentPort.postMessage(out);
});
wt.parentPort.postMessage({ ready: true });
