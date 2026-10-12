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
var SH = require(path.join(DIR, 'survivor_shared.js')), SP = require(path.join(DIR, 'survivor_prefer.js')), MODES = require(path.join(DIR, 'modes.js'));
var ATTACK = require(path.join(DIR, 'survivor_attack.js'));
var SPEND = Number(process.env.GC_SURVIVOR_SPEND) || 0.6;   // budget searched per millisecond over the last decisions, and the share of the time there is spent searching
// The search ends this long before the answer is due, for the rest of the decision and its post.
var DEADLINE_MARGIN_MS = Number(process.env.GC_SURVIVOR_MARGIN) || 30;
var TIGHT_MS = Number(process.env.GC_SURVIVOR_TIGHT) || 80;   // due sooner than this: one move deep
var LOOKAHEAD_MARGIN_MS = 15;   // the second ply ends this long before the answer is due, for the rest and the post
// The frames the cursor walks to the swap played (null for anything else).
function walkOf(bot, d) {
  if (!d || d.kind !== 'swap' || !d.move) return null;
  var all = bot._allCands || [];
  for (var i = 0; i < all.length; i++)
    if (all[i].kind === 'swap' && all[i].move && all[i].move[0] === d.move[0] && all[i].move[1] === d.move[1]) return all[i].travel == null ? null : all[i].travel;
  return null;
}
// The panels the swap played clears at once (0 for anything else): a swap back
// with this is a move, not a stall.
function clearsOf(bot, d) {
  if (!d || d.kind !== 'swap' || !d.move) return 0;
  var all = bot._allCands || [];
  for (var i = 0; i < all.length; i++)
    if (all[i].kind === 'swap' && all[i].move && all[i].move[0] === d.move[0] && all[i].move[1] === d.move[1]) return (all[i].resolved && all[i].resolved.clearedPanels) || 0;
  return 0;
}
module.exports = function think(cfg) {
  var OPTS = SH.botOptions(cfg.profile, cfg.threads);
  var floored = SH.floorTravel;
  if (cfg.weights) OPTS.weights = floored(cfg.weights);
  var rates = [];   // budget searched per millisecond over the last decisions
  function search() {
    if (!BS) BS = new (require(path.join(DIR, 'native.js')).server.Search)({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames, threads: OPTS.threads || 1 });
    return BS;
  }
  var bot = null, snap = null, nat = null, candNat = null, BS = null, attacker = null, attackLogged = 0, attackGate = 0, warmPlan = null;   // BS: a search context of its own for breakMoves   // nat, candNat: the search's and the candidates' C contexts, kept from match to match
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
      bot.allowance = m.allowance == null ? Infinity : m.allowance;
      bot.allowanceCalm = comingRows === 0 && SH.top(board) < 9;
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
      // WHILE CALM, THE PROFILE'S calmGoal IS WHAT IS BUILT, pulled toward by calmToward; otherwise the bot's own.
      // VERSUS: while the board is calm (always, with vsAlways -- the survival search still keeps it alive), what is built depends on the opponent -- combos as fast as they come
      // when it is topped out, large combos while it is not.
      if (cfg.profile.vs) {
        if (!bot._baseAim) bot._baseAim = { goal: bot.goal, toward: bot.buildToward };
        var opp = m.opp, near = opp && opp.out;
        var aim = (prep.calm || cfg.profile.vsAlways) && opp ? (near ? cfg.profile.vs.out : cfg.profile.vs.idle) : null;
        bot.goal = aim ? MODES.goal(aim.goal, aim.alsoTake) : bot._baseAim.goal;
        bot.buildToward = aim ? aim.toward : bot._baseAim.toward;
      } else if (cfg.profile.pressure) {
        // PRESSURE: keep the opponent topped out. Topped out: a combo as soon as one comes. Not: the attack that
        // fills the rows it has left -- a chain of N links is a slab N - 1 rows tall -- so the goal is sized to them.
        if (!bot._baseAim) bot._baseAim = { goal: bot.goal, toward: bot.buildToward };
        var po = m.opp, press = cfg.profile.pressure, aimP = null;
        if (po) {
          if (po.out) aimP = press.out;
          else {
            var need = (press.rows || 12) - po.top;
            aimP = need <= 3 ? press.small : need <= 5 ? press.medium : press.large;
          }
        }
        bot.goal = aimP ? MODES.goal(aimP.goal, aimP.alsoTake) : bot._baseAim.goal;
        bot.buildToward = aimP ? aimP.toward : bot._baseAim.toward;
      } else if (cfg.profile.calmGoal) {
        if (!bot._baseAim) bot._baseAim = { goal: bot.goal, toward: bot.buildToward };
        bot.goal = prep.calm ? MODES.goal(cfg.profile.calmGoal, cfg.profile.alsoTake) : bot._baseAim.goal;
        bot.buildToward = prep.calm ? (cfg.profile.calmToward || bot._baseAim.toward) : bot._baseAim.toward;
      }
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
      // ATTACK: while the board is safe, the line to the biggest fire it can reach is played, one swap at a time.
      var A = cfg.profile.attack, HT = cfg.profile.holdThrees, safeA = false, attackLine = null, attackMove = null;
      if (A && attackGate++ < 8) console.error('ATTACKGATE clock ' + board.clock + ' garbageRow ' + SH.lowestGarbageRow(board) + ' coming ' + comingRows + ' top ' + SH.top(board));
      // a board with no garbage on it, little coming and the stack low is safe: a plain three is not played on it
      if (HT && !SH.lowestGarbageRow(board) && comingRows <= (HT.maxComing === undefined ? 6 : HT.maxComing) && SH.top(board) < (HT.maxTop || 8)) safeA = true;
      bot._attackCells = 0;
      // LIFE COMES BEFORE ANYTHING ELSE (lifeFirst): when the stack is topped out, garbage has landed on a stack that is tall, or what is
      // coming and queued would fill it, the attack logic is off and the survival logic decides, threes included
      var queuedRows = 0;
      (board.incoming || []).forEach(function (g) { queuedRows += g.height || 0; });
      // topped out, or one row from it with no stop time running: the stack rises by itself into the top row and, with no stop time,
      // is lost -- from here a three is a move like any other (life first), where below it it is the last resort
      var toppedEarly = !!m.topped || (typeof board.isToppedOut === 'function' && board.isToppedOut()) || (SH.top(board) >= 11 && (board.stopTime || 0) + (board.preStopTime || 0) === 0);
      bot.toppedOutNow = toppedEarly;
      var danger = !!(A && A.lifeFirst && (toppedEarly || (SH.lowestGarbageRow(board) && SH.top(board) >= (A.dangerTop || 9)) || SH.top(board) + comingRows + queuedRows >= 12 - (A.dangerRoom === undefined ? 1 : A.dangerRoom)));
      bot._danger = danger;
      if (danger) bot._dangers = (bot._dangers || 0) + 1;
      // A BIG CHAIN COMES BEFORE EVERYTHING ELSE: with garbage on the board only a chain found is played (the setups, raising and the holds are for a board without)
      if (A && !danger && comingRows <= (A.maxComing === undefined ? 6 : A.maxComing) && SH.top(board) < (A.maxTop || 8)) {
        var garb = !!SH.lowestGarbageRow(board);
        safeA = !garb;
        if (!attacker) attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames });
        var oppOut = !A.ignoreOpp && !!(m.opp && m.opp.out), aggro = !!A.aggro, minChainOf = A.minChain === undefined ? 4 : A.minChain;
        // BELOW lowTop AND NOT UNDER ATTACK, THE STACK IS RAISED, AND ON UNTIL raiseTo
        var quietBoard = comingRows <= (A.quietComing || 0) && !(board.incoming && board.incoming.length > (A.quietComing ? 1 : 0));
        if (bot._refill && (SH.top(board) >= (A.raiseTo || 8) || !quietBoard)) bot._refill = false;
        else if (!bot._refill && SH.top(board) < (A.lowTop || 6) && quietBoard) bot._refill = true;
        // a chain running is left alone: a swap made while it goes can break it (not when the opponent is topped out: combos are short)
        // (stop time only matters to a stack that is topped out: with freeRaise a board whose panels have settled is free
        // again at once, and a raise ends the stop time that is left)
        var rdy = null, busy = cascadeLive(board, A.freeRaise);
        // A MANUAL RAISE BRINGS ONE ROW, and the next waits until something has moved (the engine lets go of it when the floor has
        // been locked and is free again) or the stack has risen by itself -- which it does not while stop time runs. So a stack that
        // is to be raised and cannot be only because of that is let go of by a swap: the build swap, or any.
        var unlock = !!(A.alwaysRaise && !busy && SH.top(board) < raiseCap(board, comingRows, A) && bot.stack && bot.stack.preventManualRaise && !bot._canRaise());
        if (busy && (!oppOut || aggro)) {
          // a chain going is continued: the line of swaps made while it pops that makes it longest, else it is left alone
          var ex = A.minRows && lowPeak(board) < A.minRows ? { seq: [], cells: 0, base: 0 } : attacker.extend(board, m.hold, { ms: Math.min(A.extendMs || 250, due ? Math.max(40, due - Date.now() - DEADLINE_MARGIN_MS) : 250), width: A.extendWidth || 40, depth: A.extendDepth || 6 });
          if (ex.seq.length && ex.cells >= ex.base + (A.extendGain || 6)) { d = { kind: 'swap', move: ex.seq[0], overruled: true }; attackLine = ex.seq.slice(1); attackMove = ex.seq[0]; bot._extends = (bot._extends || 0) + 1; }
          else { d = { kind: 'hold', overruled: true }; bot._chainHolds = (bot._chainHolds || 0) + 1; }
        }
        else if (!oppOut && warmPlan && !warmPlan.used && warmPlan.ap.seq.length && warmPlan.ap.cells >= 1 && !(A.minRows && warmPlan.ap.after < A.minRows) && warmPlan.key === boardKey(board)) {
          // the plan made in the countdown, while the board is still the one it was made for
          warmPlan.used = true;
          var wp = warmPlan.ap;
          d = { kind: 'swap', move: wp.seq[0], overruled: true }; bot._attackCells = wp.cells; attackLine = wp.seq.slice(1); attackMove = wp.seq[0]; bot._planUntil = board.clock + 40 * wp.seq.length;
          console.error('WARM played at ' + board.clock + ': ' + wp.cells + ' cells chain ' + wp.chain + ' swaps ' + wp.seq.length);
        }
        else if (A.readyBreak && !garb && arrivals.length && (rdy = attacker.readyFor(board, m.hold, arrivals, { ms: A.readyMs || 150 })) && !rdy.ready && rdy.setup) {
          // garbage is on its way and no swap will break it when it lands: the swap that makes one ready, before the stack is raised
          d = { kind: 'swap', move: rdy.setup, overruled: true }; bot._readies = (bot._readies || 0) + 1;
        }
        else if (A.alwaysRaise && SH.top(board) < raiseCap(board, comingRows, A) && bot._canRaise()) {
          // not in the middle of a chain: the stack is raised as far as it will go, garbage coming or not (the survival logic takes over when it is tall)
          d = { kind: 'raise', overruled: true }; bot._raises = (bot._raises || 0) + 1;
        }
        else if (bot._refill && bot._canRaise()) {
          // the stack has run low and nothing is coming: raised for panels, and on, up to raiseTo
          d = { kind: 'raise', overruled: true }; bot._raises = (bot._raises || 0) + 1;
        }
        else if (!garb && !oppOut && SH.top(board) < (A.raiseTo || 8) && bot._canRaise()) {
          // the first thing: the stack is raised for panels to build with, up to raiseTo
          d = { kind: 'raise', overruled: true }; bot._raises = (bot._raises || 0) + 1;
        }
        else if (!garb && !oppOut && bot._replanAt > board.clock && SH.top(board) < (A.raiseMax || 10) && bot._canRaise()) {
          // the board was looked at a moment ago and holds no chain: raised on until the next row has come
          d = { kind: 'raise', overruled: true }; bot._raises = (bot._raises || 0) + 1;
        }
        else {
          // nothing on the board, nothing coming and the stack low: all the time and depth it takes to plan a big attack
          var quiet = !garb && comingRows === 0 && SH.top(board) < (A.quietTop || 9) && !(bot._planUntil > board.clock), P2 = quiet ? { ms: A.boundPlans && due ? Math.min(A.bigMs || 1500, Math.max(60, due - Date.now() - DEADLINE_MARGIN_MS)) : A.bigMs || 1500, width: A.bigWidth || 100, depth: A.bigDepth || 14 } : { ms: Math.min(A.ms || 300, due ? Math.max(40, due - Date.now() - DEADLINE_MARGIN_MS) : 300), width: A.width || 60, depth: A.depth || 10 };
          // the opponent topped out: any combo or chain there is, soonest. Not: a big chain, however tall the stack.
          var minChain = oppOut ? 0 : minChainOf;
          var floor = oppOut || aggro ? (A.outCells || 3) : 1;
          var ap = attacker.plan(board, m.hold, { ms: oppOut ? Math.min(P2.ms, 300) : P2.ms, width: P2.width, depth: P2.depth, pool: A.pool || 250, stopAt: oppOut ? floor : 0, minChain: minChain, guideChain: A.guideChain, rate: A.rate });
          if (attackLogged++ < 60) console.error('ATTACK clock ' + board.clock + ' out ' + oppOut + ' quiet ' + quiet + ' plan ' + (ap ? ap.cells + ' cells chain ' + ap.chain + ' swaps ' + ap.seq.length + ' first ' + JSON.stringify(ap.seq[0] || null) + ' setup ' + JSON.stringify(ap.setup) + ' base ' + ap.base + ' in ' + ap.ms + ' ms' : 'none'));
          // a board that can be built on while it is low and little is coming: garbage on it or not, the bot builds a chain, it does not break
          var building = unlock || !oppOut && (!garb || (!A.alwaysRaise && SH.top(board) < (A.setupTop || 9) && comingRows <= (A.setupComing === undefined ? 3 : A.setupComing)));
          if (ap && ap.cells >= floor && ap.seq.length && !(A.minRows && ap.after < A.minRows)) { d = { kind: 'swap', move: ap.seq[0], overruled: true }; bot._attackCells = ap.cells; attackLine = ap.seq.slice(1); attackMove = ap.seq[0]; bot._planUntil = board.clock + 40 * ap.seq.length; }
          // no fire in reach: more panels to build with (the stack is raised) up to raiseMax, then the swap that builds the board toward one
          else if (!garb && !oppOut && SH.top(board) < (A.raiseMax || 10) && bot._canRaise()) { d = { kind: 'raise', overruled: true }; bot._raises = (bot._raises || 0) + 1; bot._replanAt = board.clock + (A.replanFrames || 30); }
          else if (building && ap && (ap.setup || (unlock && ap.anySwap))) { d = { kind: 'swap', move: ap.setup || ap.anySwap, overruled: true }; bot._setups = (bot._setups || 0) + 1; if (unlock) bot._unlocks = (bot._unlocks || 0) + 1; }
          else if (building) { d = { kind: 'hold', overruled: true }; bot._buildHolds = (bot._buildHolds || 0) + 1; }
        }
      }
      // THE STACK IS RAISED AS FAR AS IT WILL GO WHEREVER THE BOARD IS (alwaysRaise): past the gate too, garbage coming or not, until
      // what is coming would no longer fit; the survival logic breaks what lands
      // GARBAGE ON ITS WAY, WHEREVER THE BOARD IS (danger too): before the stack is raised for it, a swap that will break it when it lands
      // is made ready -- the hit is told of 150 frames before it lands
      if (A && !toppedEarly && A.readyBreak && !d && !SH.lowestGarbageRow(board) && arrivals.length && !cascadeLive(board, true)) {
        var rdy2 = attacker ? attacker.readyFor(board, m.hold, arrivals, { ms: A.readyMs || 150 }) : null;
        if (!attacker) { attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames }); rdy2 = attacker.readyFor(board, m.hold, arrivals, { ms: A.readyMs || 150 }); }
        if (rdy2 && !rdy2.ready && rdy2.setup) { d = { kind: 'swap', move: rdy2.setup, overruled: true }; bot._readies = (bot._readies || 0) + 1; }
      }
      if (A && !toppedEarly && A.alwaysRaise && !d && !cascadeLive(board, true) && SH.top(board) < raiseCap(board, comingRows, A) && bot._canRaise()) { d = { kind: 'raise', overruled: true }; bot._raises = (bot._raises || 0) + 1; }
      // A BIG CHAIN COMES FIRST WHEREVER THE BOARD IS: past the gate above (the stack tall, a lot coming, garbage all over it) a chain
      // the planner finds in a few swaps -- on the board with the garbage on its way counted -- is played before anything else
      if (A && !danger && !d && !(!A.ignoreOpp && m.opp && m.opp.out)) {
        var chainMs = due ? Math.min(A.chainMs || 250, due - Date.now() - DEADLINE_MARGIN_MS) : (A.chainMs || 250);
        if (chainMs >= 60) {
          if (!attacker) attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames });
          var cp = attacker.plan(board, m.hold, { ms: chainMs, width: A.width || 60, depth: A.chainSwaps || 6, pool: A.pool || 250, minChain: A.minChain === undefined ? 4 : A.minChain, guideChain: A.guideChain, arrivals: arrivals, rate: A.rate });
          if (cp && cp.cells >= 1 && cp.seq.length && !(A.minRows && cp.after < A.minRows)) { d = { kind: 'swap', move: cp.seq[0], overruled: true }; bot._attackCells = cp.cells; attackLine = cp.seq.slice(1); attackMove = cp.seq[0]; bot._planUntil = board.clock + 40 * cp.seq.length; bot._chainFirst = (bot._chainFirst || 0) + 1; }
        }
      }
      // IN DANGER THE ATTACK IS STILL WANTED, BUT ONLY AS A MOVE THE SURVIVAL SEARCH PROVES TO LIVE: the fire the planner finds is asked for
      // like a break (it is chosen if it is among the proven moves, never over them) and must leave minRows rows
      if (A && danger && A.dangerAttack !== false && !d) {
        // only with time to spare: the survival search is the decision here, and it is given what is left
        var dms = due ? Math.min(A.dangerMs || 80, due - Date.now() - 2 * DEADLINE_MARGIN_MS - 120) : (A.dangerMs || 80);
        if (dms >= 40) {
          if (!attacker) attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames });
          var dp = attacker.plan(board, m.hold, { ms: dms, width: A.width || 60, depth: A.chainSwaps || 6, pool: A.pool || 250, minChain: A.minChain === undefined ? 4 : A.minChain, guideChain: A.guideChain, arrivals: arrivals, rate: A.rate });
          if (dp && dp.seq.length && dp.cells >= (A.aggro ? (A.outCells || 3) : 1) && !(A.minRows && dp.after < A.minRows)) {
            var dk = dp.seq[0][0] + ',' + dp.seq[0][1];
            if (!prep.want[dk]) prep.want[dk] = 0.5;   // after a break (0), before the rest
            bot._dangerFires = (bot._dangerFires || 0) + 1;
          }
          // the survival search has what the planning left of the time
          bot.SURVIVE_SEARCH_BUDGET = due ? Math.max(CHEAP, Math.min(FULL, Math.round((due - Date.now()) * nodesPerMs * SPEND))) : FULL;
        }
      }
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
      bot.threeForced = false;
      try { if (!d) d = bot._decide(); } finally { bot._abort = null; N.deadline(0); bot.depth = depth0; bot._dueAt = 0; }
      // A PLAIN THREE IS A LAST RESORT: while the board is safe it is not played -- the bot waits, and the stack rises
      // to bring more to build with. (Breaking garbage, a chain, a bigger match and a topped-out board are not plain threes.)
      // (the attack profile: a three is played only when the survival search left nothing else -- bot.threeForced)
      // (threesOnlyTopped: not even then, unless the stack is topped out -- a failsafe)
      var toppedNow = toppedEarly;
      if ((((A || HT) && safeA || (A && !bot.threeForced)) || (A && A.threesOnlyTopped && !toppedNow)) && !d.overruled && d.kind === 'swap' && d.move && bot.threeOnlySwap(d.move)) { d = { kind: 'hold', overruled: true }; bot._threesHeld = (bot._threesHeld || 0) + 1; }
      // A CLEAR THAT LEAVES THE STACK UNDER minRows ROWS is not made while the stack is not topped out: panels are kept to break what lands with
      if (A && A.minRows && !toppedNow && !danger && !d.overruled && d.kind === 'swap' && d.move) {
        var mc = (bot._allCands || []).filter(function (c) { return c.kind === 'swap' && c.move && c.move[0] === d.move[0] && c.move[1] === d.move[1]; })[0];
        var sb = mc && mc.resolved && mc.resolved.clearedPanels > 0 ? bot._settledOf(mc) : null;
        if (sb && sb.grid && lowPeakOf(sb.grid) < A.minRows) { d = { kind: 'hold', overruled: true }; bot._rowsHeld = (bot._rowsHeld || 0) + 1; }
      }
      // WHILE THE BOARD IS SAFE AND THE OPPONENT IS NOT TOPPED OUT a combo is held back too: the bot builds toward a chain
      if (A && safeA && !oppOut && !A.aggro && !d.overruled && d.kind === 'swap' && d.move && bot.comboOnlySwap(d.move)) { d = { kind: 'hold', overruled: true }; bot._combosHeld = (bot._combosHeld || 0) + 1; }
      var why = null;
      if (process.env.GC_SURVIVOR_WHY) {
        var sp = bot._searchProofs;
        why = { provenRanks: provenRanked.join(' '), ranked: ranked.join(' '), want: Object.keys(want), cands: sp ? sp.cands.map(key) : null, proven: sp ? sp.cands.filter(function (c, i) { return sp.proofs[i]; }).map(key) : null };
      }
      // NEVER IDLE (noIdle): a hold on a board that is safe, with nothing resolving, is a move wasted -- the stack is raised, or the best fire
      // is played, or a swap that builds toward one
      if (A && A.noIdle && d.kind === 'hold' && !danger && !toppedEarly && !cascadeLive(board, true)) {
        var niMs = due ? Math.min(A.noIdleMs || 80, due - Date.now() - 2 * DEADLINE_MARGIN_MS - 100) : (A.noIdleMs || 80);
        if (SH.top(board) < raiseCap(board, comingRows, A) && bot._canRaise()) { d = { kind: 'raise', overruled: true }; bot._idleFilled = (bot._idleFilled || 0) + 1; }
        else if (niMs >= 30) {
          if (!attacker) attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames });
          var nip = attacker.plan(board, m.hold, { ms: niMs, width: 30, depth: 4, pool: 100, minChain: A.minChain === undefined ? 4 : A.minChain, arrivals: arrivals, rate: A.rate });
          if (nip && nip.seq.length && nip.cells >= (A.aggro ? (A.outCells || 3) : 1) && !(A.minRows && nip.after < A.minRows)) { d = { kind: 'swap', move: nip.seq[0], overruled: true }; attackLine = nip.seq.slice(1); attackMove = nip.seq[0]; bot._idleFilled = (bot._idleFilled || 0) + 1; }
          else if (nip && (nip.setup || nip.anySwap)) { d = { kind: 'swap', move: nip.setup || nip.anySwap, overruled: true }; bot._idleFilled = (bot._idleFilled || 0) + 1; }
        }
      }
      // (no three is played below the top, so no aimed lineup to a break -- its last swap is a three -- is either)
      var noAimed = !!(A && A.threesOnlyTopped && !toppedNow);
      d = SP.overrule(d, noAimed ? Object.assign({}, prep, { br: null, want: {} }) : prep, bot);   // a lineup while a slab pops (survivor_prefer.js)
      var overruled = !!d.overruled;
      var took = Date.now() - t1;
      if (took > 20) { rates.push(bot.SURVIVE_SEARCH_BUDGET / took); if (rates.length > 8) rates.shift(); }
      // The rest of the proven line behind the move, for the frame loop to play
      // on while the next decision is late: steps as the search played them
      // ([row, col], 'raise', null for a hold, { long: until }), from lineAt.
      var fl = overruled ? null : bot._following, line = fl && !fl.hold && fl.steps && fl.steps.length ? fl.steps : null;
      if (A && A.threesOnlyTopped && !toppedNow) line = null;
      // An aimed lineup is its whole path: the swaps after the first are the
      // line, from wherever the first ends.
      var lineFree = false;
      // the rest of an attack line is played on while the next question is thought about
      if (attackLine && attackLine.length && d.kind === 'swap' && d.move && attackMove && d.move[0] === attackMove[0] && d.move[1] === attackMove[1]) { line = attackLine; lineFree = true; }
      if (!noAimed && br && br.path && d.kind === 'swap' && d.move && br.path[0][0] === d.move[0] && br.path[0][1] === d.move[1] && br.path.length > 1) { line = br.path.slice(1); lineFree = true; }
      out = { id: m.id, epoch: m.epoch, at: m.at, kind: d.kind, move: d.move ? [d.move[0], d.move[1]] : null, ms: Date.now() - t0, queued: m.posted ? t0 - m.posted : 0, brMs: brMs, why: why,
            line: line, lineAt: line && !lineFree ? fl.at : null, lineFree: lineFree,
            mem: NativeMem(),
            breaks: br && br.depth ? { offered: br.depth, lineup: !!br.lineup, touch: !!br.touch, took: !!want[d.move ? d.move[0] + ',' + d.move[1] : d.kind] } : null,
            diag: { tight: tight, budget: bot.SURVIVE_SEARCH_BUDGET, took: took, survive: bot._svMs || 0, doomed: bot.doomedDecisions, allDoomed: bot.allDoomedNow, unproven: bot.survivalUnproven || 0, fast: bot.followFast || 0, dropped: bot.doomedMovesDropped, bare3Dropped: bot.bareThreesDropped, bare3Kept: bot.bareThreesKept, bare3Topped: bot.bareThreesTopped, unaffordable: bot.unaffordableDropped, walk: walkOf(bot, d), clears: clearsOf(bot, d), attack: bot._attackCells, setups: bot._setups || 0, threesHeld: bot._threesHeld || 0, combosHeld: bot._combosHeld || 0, chainHolds: bot._chainHolds || 0, extends: bot._extends || 0, buildHolds: bot._buildHolds || 0, raises: bot._raises || 0, chainFirst: bot._chainFirst || 0, readies: bot._readies || 0, unlocks: bot._unlocks || 0, rowsHeld: bot._rowsHeld || 0, dangers: bot._dangers || 0, dangerFires: bot._dangerFires || 0, idleFilled: bot._idleFilled || 0 } };
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
  // THE COUNTDOWN IS PLANNING TIME: the board the match opens on is planned for while the game counts down, and the line
  // is played from the first frame the board still is what was planned for.
  // A CHAIN OR A CLEAR IS LIVE: a chain counting, panels falling from a clear, or -- while stop time runs -- panels still matched
  // or popping. Nothing is swapped then: a swap can take a panel out of what is about to fall or pop. With free, a board whose
  // panels have all settled is free at once whatever stop time is left (it only matters to a stack that is topped out).
  // How high the stack may be raised: raiseMax -- garbage coming is a reason to raise (panels to break it with), not to hold back --
  // or, with raiseLeaveRoom, less the rows on their way and queued, so that what lands still fits.
  function raiseCap(board, coming, A) {
    var queued = 0;
    if (A.raiseLeaveRoom) (board.incoming || []).forEach(function (g) { queued += g.height || 0; });
    // (while stop time runs the stack does not rise by itself, so one row more is safe: raiseStopBonus, from raiseStopFrames of it)
    var bonus = (A.raiseStopBonus || 0) && (board.stopTime || 0) + (board.preStopTime || 0) >= (A.raiseStopFrames || 60) ? A.raiseStopBonus : 0;
    return (A.raiseMax || 11) + bonus - (A.raiseLeaveRoom ? coming + queued : 0);
  }
  // The lowest peak: the fewest panels any column has -- a stack with one tall column and the rest empty has nothing to break with.
  function lowPeak(board) {
    var low = 99, c, r, pk;
    for (c = 1; c <= 6; c++) { pk = 0; for (r = board.panels.length - 1; r >= 1 && !pk; r--) { var p = board.panels[r] && board.panels[r][c]; if (p && p.color && !p.isGarbage) pk = r; } if (pk < low) low = pk; }
    return low;
  }
  function lowPeakOf(grid) {
    var low = 99, c, r, pk;
    for (c = 1; c <= 6; c++) { pk = 0; for (r = grid.length - 2; r >= 1 && !pk; r--) if (grid[r] && grid[r][c] > 0 && grid[r][c] < 8) pk = r; if (pk < low) low = pk; }
    return low;
  }
  function panelCount(board) {
    var n = 0, r, c;
    for (r = 1; r < board.panels.length; r++) for (c = 1; c <= 6; c++) { var p = board.panels[r] && board.panels[r][c]; if (p && p.color && !p.isGarbage) n++; }
    return n;
  }
  function cascadeLive(board, free) {
    if ((board.chainCounter || 0) > 0) return true;
    var stop = (board.stopTime || 0) + (board.preStopTime || 0) > 0;
    if (!free) return stop;
    if (typeof board.hasChainingPanels === 'function' && board.hasChainingPanels()) return true;
    return stop && typeof board.hasActivePanels === 'function' && board.hasActivePanels();
  }
  function boardKey(board) {
    var k = '', r, c;
    for (r = 1; r <= 12; r++) for (c = 1; c <= 6; c++) { var p = board.panels[r] && board.panels[r][c]; k += p ? (p.isGarbage ? 'G' : (p.color || 0)) : 0; }
    return k;
  }
  function warm(m) {
    var A = cfg.profile.attack;
    if (!A) return;
    var board = PA.revive(m.packed ? require('v8').deserialize(m.packed) : m.board);
    if (!attacker) attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames });
    // a plan that cannot be made is no plan: the mind goes on with the match
    try {
      var ap = attacker.plan(board, { left: 0, started: false }, { ms: A.warmMs || 2500, width: A.warmWidth || A.bigWidth || 100, depth: A.warmDepth || A.bigDepth || 14, pool: A.pool || 250, minChain: A.minChain === undefined ? 4 : A.minChain, guideChain: A.guideChain });
      warmPlan = { key: boardKey(board), ap: ap, used: false };
      console.error('WARM plan ' + ap.cells + ' cells chain ' + ap.chain + ' swaps ' + ap.seq.length + ' in ' + ap.ms + ' ms');
    } catch (e) {
      warmPlan = null;
      console.error('WARM plan failed: ' + String(e && e.message || e));
    }
  }
  function reset() { if (bot && bot._nat) nat = bot._nat; if (bot && bot._candNat) candNat = bot._candNat; bot = null; snap = null; }
  // New weights take effect from the next match (reset).
  function setWeights(w) { OPTS.weights = floored(w); }
  return { answer: answer, reset: reset, setWeights: setWeights, warm: warm };
};
