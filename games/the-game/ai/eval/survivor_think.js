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
var CK = require(path.join(DIR, 'survivor_checks.js')), fullTop = CK.fullTop, lowPeak = CK.lowPeak, lowPeakOf = CK.lowPeakOf, panelCount = CK.panelCount, raiseCap = CK.raiseCap, cascadeLive = CK.cascadeLive;
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
    if (all[i].kind === 'swap' && all[i].move && all[i].move[0] === d.move[0] && all[i].move[1] === d.move[1]) {
      // (measureAdded, the agro bot: what the move clears beyond what the board left alone clears -- a chain popping clears panels whatever is swapped)
      var hold = bot.measureAdded && all.filter(function (c) { return c.kind === 'hold' && c.resolved; })[0], base = hold ? hold.resolved.clearedPanels || 0 : 0;
      return Math.max(0, ((all[i].resolved && all[i].resolved.clearedPanels) || 0) - base);
    }
  return 0;
}
// The garbage cells on a board (landed).
function garbCells(st) {
  var n = 0, r, c, p;
  for (r = 1; r < st.panels.length; r++) for (c = 1; c <= (st.width || 6); c++) { p = st.panels[r] && st.panels[r][c]; if (p && p.isGarbage) n++; }
  return n;
}
module.exports = function think(cfg) {
  var OPTS = SH.botOptions(cfg.profile, cfg.threads);
  // (the agro profile's holdThrough: a held raise goes on through the rows it brings in, in every search this mind makes)
  if (cfg.profile.attack && cfg.profile.attack.holdThrough) require(path.join(DIR, 'native.js')).server.holdThrough();
  var floored = SH.floorTravel;
  if (cfg.weights) OPTS.weights = floored(cfg.weights);
  var rates = [];   // budget searched per millisecond over the last decisions
  function search() {
    if (!BS) BS = new (require(path.join(DIR, 'native.js')).server.Search)({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames, threads: OPTS.threads || 1 });
    return BS;
  }
  var matchMode = 'unknown', planRealUntil = -1;
  var bot = null, snap = null, nat = null, candNat = null, BS = null, attacker = null, attackLogged = 0, attackGate = 0, noRaiseLogged = 0, threeLogged = 0, warmPlan = null;   // BS: a search context of its own for breakMoves   // nat, candNat: the search's and the candidates' C contexts, kept from match to match
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
    // LEVEL 10 HEALTH (planHealth): every board is judged with the health level 10 gives, whatever the game's own -- a topped board
    // that stops moving with no stop time and no shake left dies that frame. Training gives 51; spending it is a loss at level 10.
    // (while every move dies at that health, the decisions for planReal frames after are judged on the health the board has: a
    // board level 10 has lost is still fought for, not given up)
    var planned = !!(cfg.profile.planHealth && !(planRealUntil > m.at));
    if (planned) {
      board.health = Math.min(board.health, cfg.profile.planHealth);
      board.levelData = Object.assign({}, board.levelData, { maxHealth: Math.min(board.levelData.maxHealth, cfg.profile.planHealth) });
    }
    // When the answer is due: m.ms from when it was asked (m.posted), so the
    // time a question waited behind the one before counts.
    var due = m.ms > 0 ? (m.posted || t0) + m.ms : 0;
    // Garbage on its way arrives that many frames on (search.h runFrame).
    arrivals = SH.arrivalsFrom(board, m.arrivals || []);
    var th = SH.threat(cfg.profile, m.lead || 0);
    if (th && arrivals.length < 64) arrivals.push(th);
    var view = PA.toPanelEngine(board), comingRows = 0;
    // (garbage the game holds back -- a chain's pieces not finalized -- is not a hit on its way for the danger and readiness checks)
    var heldOff = !!(cfg.profile.attack && cfg.profile.attack.heldChain);
    (m.arrivals || []).forEach(function (a) { if (heldOff && a.g && a.g.isChain && a.g.finalized === false) return; comingRows += a.g ? a.g.height : 0; });
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
      // (under threat with defendUnderThreat the preferences are the defence's own: the profile with no attack block, at defendRaiseTo)
      var A0 = cfg.profile.attack;
      var defendA = !!(A0 && A0.defendUnderThreat && matchMode !== 'timeattack' && (SH.lowestGarbageRow(board) || (board.incoming || []).length || arrivals.length));
      var prepProfile = defendA ? Object.assign({}, cfg.profile, { attack: undefined, raiseTo: A0.defendRaiseTo || cfg.profile.raiseTo }) : cfg.profile;
      // (keepLine: the rest of the touch line the last decision began, on this board's rows -- found again by a bottom-row panel's id)
      var keepL = null, KL = A0 && A0.keepLine ? bot._keepLine : null;
      if (KL && m.at > KL.at && m.at - KL.at <= (A0.keepFrames || 180)) {
        for (var kr = 1; kr < board.panels.length && keepL === null; kr++) { var kp0 = board.panels[kr] && board.panels[kr][KL.col]; if (kp0 && kp0.id === KL.id) { var kd = kr - KL.row; keepL = KL.rest.map(function (mv) { return [mv[0] + kd, mv[1]]; }); } }
      }
      bot._keepLine = null;
      var verdictNo0 = bot._verdictNo || 0;
      var prep = SP.prepare(bot, board, { profile: prepProfile, hold: m.hold, arrivals: arrivals, comingRows: comingRows, due: due, ms: m.ms, margin: DEADLINE_MARGIN_MS,
                                        search: search, stale: stale, aborted: P.ABORTED, keep: keepL });
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
      // DEFENCE UNDER THREAT (defendUnderThreat): with garbage on the board, queued, or on its way, the decision is the defence's --
      // the survival search alone, as the profile with no attack block plays it (8 of 8 to six minutes of large_garbage, where the
      // attack logic over it lost 7 of 8) -- and the attack plays only on a board with nothing on it or coming. Not in time attack.
      // (attackFirst under threat too: a followed survival line is not played on unranked while a combo, a chain or a ranked line is
      // among the moves -- otherwise the line's next swap, a three, is played without the bigger break being looked at)
      // (panels to spare: the lowest column of panels at floorRows or more. Under it a bigger break burns the panels the next slab is
      // broken with, so the cheapest break that works comes first and a line that breaks comes after it -- in any match alike)
      var spareD = !(A0 && A0.floorRows && lowPeak(board) < A0.floorRows);
      bot.attackFirst = !!OPTS.attackFirst && (!defendA || !!A0.defendRanked);
      // (under threat the moves the attack ranks are played only when proven: what stands unproven past the horizon is the defence's
      // own break, as it always was)
      bot.weakAttacks = !defendA;
      // (a three that breaks nothing waits for the stack to top out under threat too with defendNoBareThrees; a three that breaks garbage
      // is let through either way -- the profile has no threeBreaksLast)
      bot.noThreesUntilTopped = !!OPTS.threesOnlyTopped && (!defendA || !!A0.defendNoBareThrees);
      // THE BIGGER BREAK FIRST (defendBigBreaks): of the breaks the defence's preferences put first, a plain three breaking garbage
      // comes after anything bigger breaking garbage -- a combo or a chain -- when one is among the moves; with none it keeps its place
      bot.breakOrder = null;
      var bigOfMove = function (mv) {
        var c = (bot._allCands || []).filter(function (x) { return x.kind === 'swap' && x.move && x.move[0] === mv[0] && x.move[1] === mv[1]; })[0], r = c && (c.added || c.resolved);
        return !!(r && (r.brokeGarbage || 0) > 0 && ((r.chainLength || 0) >= 2 || (r.comboSizes || []).some(function (x) { return x >= 4; })));
      };
      if (defendA && spareD && A0.defendBigBreaks && bot.preferRank) {
        var pr0D = bot.preferRank, candsD = null, bigD = false;
        var bigBreak = function (c) { var r = c && (c.added || c.resolved); if (!r || !((r.brokeGarbage || 0) > 0)) return false; return (r.chainLength || 0) >= 2 || (r.comboSizes || []).some(function (x) { return x >= 4; }); };
        var threeBreakD = function (c) { var r = c && (c.added || c.resolved); if (!r || !((r.brokeGarbage || 0) > 0) || (r.chainLength || 0) >= 2) return false; var z = r.comboSizes || []; return z.length > 0 && z.every(function (x) { return x <= 3; }); };
        bot.breakOrder = function (k) {
          var c = (bot._allCands || []).filter(function (x) { return x.kind === 'swap' && x.move && x.move[0] + ',' + x.move[1] === k; })[0];
          return c ? bot.preferRank(c, -1) : 1;
        };
        bot.preferRank = function (c, i) {
          var r = pr0D.call(this, c, i);
          if (bot._allCands !== candsD) { candsD = bot._allCands; bigD = (candsD || []).some(function (x) { return x.kind === 'swap' && bigBreak(x); }); }
          // (and so does the first swap of a line toward a break, ranked with the breaks: a bigger break now is not traded for a walk to one)
          if (c.kind === 'swap' && bigD) { if (bigBreak(c)) return Math.min(r, 0); if (r === 0) { bot._threeAfterBig = (bot._threeAfterBig || 0) + 1; return 0.4; } }
          return r;
        };
      }
      if (defendA) {
        HT = A.defendHoldThrees || null; A = null;
        bot.SURVIVE_FRAMES = P.prototype.SURVIVE_FRAMES;   // (bot.preferRank stays the one prepare made for the defence's profile)
        bot._defended = (bot._defended || 0) + 1;
      }
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
      var toppedEarly = CK.toppedOrNearly(board, m.topped, A);
      // (realTopped: the stack as the game shows it -- its height with the garbage landed on it and the frames until the next row tops it
      // out -- is what is near the top; the board asked about is a prediction)
      var realNear = !!(A && A.realTopped && m.realTop >= 11 && m.realFtt <= (A.nearFrames || 90));
      if (realNear) toppedEarly = true;
      // a three is played only on a stack the engine says is topped out (a panel in the top row), and then only as the last resort
      // (a stack topped out with no stop time is lost the frame it is: a three is the last resort from nearFrames before that, on the stack as the game shows it)
      // (realThrees: a three is the last resort on the stack as the game shows it -- topped out, or within nearFrames of it by the time the
      // swap is pressed -- never on the prediction, which can show garbage that is held back)
      var toppedReal = A && A.realTopped ? (!!m.topped || realNear)
        : A && A.realThrees ? (!!m.topped || (m.realTop >= (A.threeTop || 11) && m.realFtt <= (A.threeFrames || A.nearFrames || 90) + (m.lead || 0)))
        : (!!m.topped || toppedEarly);
      bot.toppedOutNow = toppedReal;
      // (the stack is raised, and a break made ready, unless it is near the top as the game shows it -- realThrees)
      var toppedForRaise = A && A.realThrees ? (!!m.topped || (m.realTop >= 11 && m.realFtt <= (A.nearFrames || 90) + 30)) : toppedEarly;
      bot.realToppedOnly = !!(A && (A.realTopped || A.realThrees));
      // (danger is the stack in jeopardy, not the stack raised high: its height counting the garbage on it, or what is about to land on it
      // overflowing the board -- raising to row 10 is the plan, and a hit of a row or two on it is not an emergency)
      // GARBAGE ON ITS WAY for the readiness check: the game's landing times, else -- when the stack's own queue holds garbage the link has
      // given no time for -- a landing in readyAt frames
      var realArrivals = heldOff ? arrivals.filter(function (a) { return !a.held; }) : arrivals;
      var readyArr = realArrivals.length ? realArrivals : (board.incoming || []).slice(0, 8).map(function (g) {
        return { at: A && A.readyAt || 90, width: g.width, height: g.height, isChain: !!g.isChain, isMetal: !!g.isMetal, capped: false };
      });
      // A BREAK STAYS READY WITHIN THE TIME THERE IS: an attack is played while the first garbage on its way still leaves the time to finish
      // it and then make a break (readyFrames); a chain of three or more is worth the risk
      var firstLand = Infinity;
      readyArr.forEach(function (a) { if (a.at < firstLand) firstLand = a.at; });
      var leavesBreakTime = function (plan) { return !(A && A.readyFrames) || firstLand === Infinity || plan.chain >= 3 || plan.seq.length * 18 + A.readyFrames <= firstLand; };
      var dangerWhy = A && A.lifeFirst ? CK.dangerWhy(board, realArrivals, comingRows, m.topped, A) : '';
      // DANGER IS THE REAL STACK, OR A REAL HIT (realDanger): the stack as the game shows it topped out, or within the time it takes to
      // get out of it -- or garbage the game will land that overflows it. Not the board predicted ahead, with the garbage queued on it.
      if (A && A.lifeFirst && A.realDanger) {
        var rNear = m.realTop >= 11 && m.realFtt <= (A.nearFrames || 90) + (m.lead || 0);
        var dw0 = dangerWhy;
        dangerWhy = m.topped || rNear ? 'topped' : (m.realTop >= (A.dangerTop || 11) && m.realFtt <= (A.dangerFrames || 240)) ? 'tall' : dw0 === 'incoming' ? 'incoming' : '';
      }
      // A HIT THAT WOULD TOP THE STACK OUT, on its way by the game's own landing times, makes a three a last resort now: it is the one way left
      // to lower the stack before it lands (realThrees)
      // A VOLLEY (volley): what is coming and queued fills the board by itself, wherever the stack is -- lowering the stack cannot keep it
      // from topping out, so the hit is no danger to play threes against: the panels are what it is broken with, and are kept
      var volleyA = !!(A && A.volley) && comingRows + queuedRows >= (board.height || 12);
      if (volleyA && dangerWhy === 'incoming') { dangerWhy = ''; bot._volley = (bot._volley || 0) + 1; }
      if (A && A.realThrees && dangerWhy === 'incoming' && !toppedReal) { toppedReal = true; bot.toppedOutNow = true; bot._threesForHit = (bot._threesForHit || 0) + 1; }
      if (A && A.lifeFirst && A.realTopped && !dangerWhy) {
        if (realNear) dangerWhy = 'topped';
        else if (m.realTop >= (A.dangerTop || 11) && m.realFtt <= (A.dangerFrames || 240)) dangerWhy = 'tall';
      }
      // TOPPED OUT WITH STOP TIME LEFT (toppedStop) is a clock, not a loss: nothing but a raise ends stop time, so the frames it has left
      // are the time to play an attack in -- one that fits them, and never a plain three that digs nothing (below)
      var stopLeft = (board.stopTime || 0) + (board.preStopTime || 0);
      var toppedFree = !!(A && A.toppedStop && dangerWhy === 'topped' && toppedReal && stopLeft >= A.toppedStop);
      var danger = dangerWhy !== '' && !toppedFree;
      if (toppedFree) bot._toppedFree = (bot._toppedFree || 0) + 1;
      bot._danger = danger;
      if (danger) { bot._dangers = (bot._dangers || 0) + 1; bot._dangerWhy = bot._dangerWhy || {}; bot._dangerWhy[dangerWhy] = (bot._dangerWhy[dangerWhy] || 0) + 1; }
      // A BIG CHAIN COMES BEFORE EVERYTHING ELSE: with garbage on the board only a chain found is played (the setups, raising and the holds are for a board without)
      // (survivalFirst: the attack is planned in danger too -- what it chooses has to be proven to live -- so danger does not switch it off)
      if (A && !A.arbiter && (!danger || A.survivalFirst) && comingRows <= (A.maxComing === undefined ? 6 : A.maxComing) && SH.top(board) < (A.maxTop || 8)) {
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
        var unlock = !!(A.alwaysRaise && !busy && fullTop(board) < raiseCap(board, comingRows, A) && bot.stack && bot.stack.preventManualRaise && !bot._canRaise());
        if (busy && (!oppOut || aggro)) {
          // a chain going is continued: the line of swaps made while it pops that makes it longest, else it is left alone
          var ex = A.minRows && lowPeak(board) < A.minRows ? { seq: [], cells: 0, base: 0 } : attacker.extend(board, m.hold, { ms: Math.min(A.extendMs || 250, due ? Math.max(40, due - Date.now() - DEADLINE_MARGIN_MS) : 250), width: A.extendWidth || 40, depth: A.extendDepth || 6 });
          if (ex.seq.length && ex.cells >= ex.base + (A.extendGain || 6)) { d = { kind: 'swap', move: ex.seq[0], overruled: true, src: 'extend', cells: ex.cells }; attackLine = ex.seq.slice(1); attackMove = ex.seq[0]; bot._extends = (bot._extends || 0) + 1; }
          else {
            // A CHAIN POPPING IS NOT THE END OF THE ATTACK: its stop time is spent setting up the next fire -- a swap the engine shows leaves what
            // is popping as it is (no shorter a chain, no fewer cells) -- and the survival search has the last word on it (survivalFirst)
            var bsw = null;
            if (A.setupBusy) {
              if (!attacker) attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames });
              var bms = due ? Math.min(A.busyMs || 120, due - Date.now() - 2 * DEADLINE_MARGIN_MS - 100) : (A.busyMs || 120);
              var bp = bms >= 40 ? attacker.plan(board, m.hold, { ms: bms, width: 30, depth: 4, pool: 100, minChain: A.minChain === undefined ? 4 : A.minChain, arrivals: arrivals, rate: A.rate }) : null;
              var bmv = bp && (bp.setup || bp.anySwap);
              if (bmv) {
                var sum = function (r) { return r.combos.reduce(function (a, b) { return a + b; }, 0); };
                var b0 = board.copy(); b0.behaviours = Object.assign({}, b0.behaviours, { passiveRaise: false }); var r0 = b0.settle();
                var b1 = board.copy(); b1.behaviours = Object.assign({}, b1.behaviours, { passiveRaise: false }); b1.curRow = bmv[0]; b1.curCol = bmv[1];
                var r1 = b1.tryQueueSwap(bmv[0], bmv[1]) ? b1.settle() : null;
                if (r1 && r1.chain >= r0.chain && sum(r1) >= sum(r0)) bsw = bmv;
              }
            }
            if (bsw) { d = { kind: 'swap', move: bsw, overruled: true, src: 'busySetup' }; bot._busySetups = (bot._busySetups || 0) + 1; }
            else { d = { kind: 'hold', overruled: true }; bot._chainHolds = (bot._chainHolds || 0) + 1; }
          }
        }
        else if (!oppOut && warmPlan && !warmPlan.used && warmPlan.ap.seq.length && warmPlan.ap.cells >= 1 && !(A.minRows && warmPlan.ap.after < A.minRows) && warmPlan.key === boardKey(board)) {
          // the plan made in the countdown, while the board is still the one it was made for
          warmPlan.used = true;
          var wp = warmPlan.ap;
          d = { kind: 'swap', move: wp.seq[0], overruled: true, src: 'warm', planChain: wp.chain }; bot._attackCells = wp.cells; attackLine = wp.seq.slice(1); attackMove = wp.seq[0]; bot._planUntil = board.clock + 40 * wp.seq.length;
          console.error('WARM played at ' + board.clock + ': ' + wp.cells + ' cells chain ' + wp.chain + ' swaps ' + wp.seq.length);
        }
        else if (A.readyBreak && !garb && readyArr.length && (rdy = attacker[A.readyTime ? 'readyInTime' : 'readyFor'](board, m.hold, readyArr, { ms: A.readyMs || 150 })) && !rdy.ready && rdy.setup) {
          // garbage is on its way and no swap will break it when it lands: the swap that makes one ready, before the stack is raised
          d = { kind: 'swap', move: rdy.setup, overruled: true, src: 'ready' }; bot._readies = (bot._readies || 0) + 1;
        }
        else if (A.alwaysRaise && fullTop(board) < raiseCap(board, comingRows, A) && bot._canRaise()) {
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
          var quiet = !garb && comingRows === 0 && SH.top(board) < (A.quietTop || 9) && !(bot._planUntil > board.clock),
              // THE STACK CREEPING UP is cleared by combos and chains, not threes: the whole time there is goes to finding one (climbBig)
              climbing = !!(A.climbBig && SH.top(board) >= (A.climbTop || 9)), P2 = quiet || climbing ? { ms: A.boundPlans && due ? Math.min(A.bigMs || 1500, Math.max(60, due - Date.now() - DEADLINE_MARGIN_MS)) : A.bigMs || 1500, width: A.bigWidth || 100, depth: A.bigDepth || 14 } : { ms: Math.min(A.ms || 300, due ? Math.max(40, due - Date.now() - DEADLINE_MARGIN_MS) : 300), width: A.width || 60, depth: A.depth || 10 };
          // the opponent topped out: any combo or chain there is, soonest. Not: a big chain, however tall the stack.
          var minChain = oppOut ? 0 : minChainOf;
          var floor = oppOut || aggro ? (A.outCells || 3) : 1;
          var ap = attacker.plan(board, m.hold, { ms: oppOut ? Math.min(P2.ms, 300) : P2.ms, width: P2.width, depth: P2.depth, pool: A.pool || 250, stopAt: oppOut ? floor : 0, minChain: minChain, guideChain: A.guideChain, rate: A.rate, arrivals: A.continuousLines ? arrivals : undefined, horizon: A.continuousLines ? bot.SURVIVE_FRAMES : 0, breakFirst: !!(A.breakFirst && garb) });
          if (attackLogged++ < 60) console.error('ATTACK clock ' + board.clock + ' out ' + oppOut + ' quiet ' + quiet + ' plan ' + (ap ? ap.cells + ' cells chain ' + ap.chain + ' swaps ' + ap.seq.length + ' first ' + JSON.stringify(ap.seq[0] || null) + ' setup ' + JSON.stringify(ap.setup) + ' base ' + ap.base + ' in ' + ap.ms + ' ms' : 'none'));
          // a board that can be built on while it is low and little is coming: garbage on it or not, the bot builds a chain, it does not break
          var building = unlock || !oppOut && (!garb || (!A.alwaysRaise && SH.top(board) < (A.setupTop || 9) && comingRows <= (A.setupComing === undefined ? 3 : A.setupComing)));
          // (why no fire was played, counted for the diag)
          var fw = !ap || !ap.seq.length ? 'none' : !(ap.cells >= floor || (A.breakFirst && ap.brk)) ? 'small' : (A.minRows && ap.after < A.minRows) ? 'minRows' : (toppedFree && ap.seq.length * 18 + 30 > stopLeft) ? 'stop' : !leavesBreakTime(ap) ? 'time' : 'fire';
          bot._fireWhy = bot._fireWhy || {}; bot._fireWhy[fw] = (bot._fireWhy[fw] || 0) + 1;
          if (ap && (ap.cells >= floor || (A.breakFirst && ap.brk)) && ap.seq.length && !(A.minRows && ap.after < A.minRows) && !(toppedFree && ap.seq.length * 18 + 30 > stopLeft) && leavesBreakTime(ap)) { d = { kind: 'swap', move: ap.seq[0], overruled: true, src: 'fire', planChain: ap.chain, cells: ap.cells, continuous: !!ap.continuous }; bot._attackCells = ap.cells; attackLine = ap.seq.slice(1); attackMove = ap.seq[0]; bot._planUntil = board.clock + 40 * ap.seq.length; }
          // no fire in reach: more panels to build with (the stack is raised) up to raiseMax, then the swap that builds the board toward one
          else if (!garb && !oppOut && SH.top(board) < (A.raiseMax || 10) && bot._canRaise()) { d = { kind: 'raise', overruled: true }; bot._raises = (bot._raises || 0) + 1; bot._replanAt = board.clock + (A.replanFrames || 30); }
          // (a profile that attacks builds toward the next fire whatever is on the board or whoever is topped out: the swap, never a hold)
          else if ((building || A.aggro) && ap && (ap.setup || (unlock && ap.anySwap))) { d = { kind: 'swap', move: ap.setup || ap.anySwap, overruled: true, src: 'setup' }; bot._setups = (bot._setups || 0) + 1; if (unlock) bot._unlocks = (bot._unlocks || 0) + 1; }
          else if (building) { d = { kind: 'hold', overruled: true }; bot._buildHolds = (bot._buildHolds || 0) + 1; }
        }
      }
      // THE STACK IS RAISED AS FAR AS IT WILL GO WHEREVER THE BOARD IS (alwaysRaise): past the gate too, garbage coming or not, until
      // what is coming would no longer fit; the survival logic breaks what lands
      // GARBAGE ON ITS WAY, WHEREVER THE BOARD IS (danger too): before the stack is raised for it, a swap that will break it when it lands
      // is made ready -- the hit is told of 150 frames before it lands
      if (A && !A.arbiter && !toppedForRaise && A.readyBreak && !d && !SH.lowestGarbageRow(board) && readyArr.length && !cascadeLive(board, true)) {
        var rdy2 = attacker ? attacker[A.readyTime ? 'readyInTime' : 'readyFor'](board, m.hold, readyArr, { ms: A.readyMs || 150 }) : null;
        if (!attacker) { attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames }); rdy2 = attacker[A.readyTime ? 'readyInTime' : 'readyFor'](board, m.hold, readyArr, { ms: A.readyMs || 150 }); }
        if (rdy2 && !rdy2.ready && rdy2.setup) { d = { kind: 'swap', move: rdy2.setup, overruled: true, src: 'ready' }; bot._readies = (bot._readies || 0) + 1; }
      }
      if (A && !A.arbiter && !toppedForRaise && A.alwaysRaise && !d && !cascadeLive(board, true) && fullTop(board) < raiseCap(board, comingRows, A) && bot._canRaise()) { d = { kind: 'raise', overruled: true }; bot._raises = (bot._raises || 0) + 1; }
      // (why the stack was not raised this decision, counted for the diag)
      if (A && A.alwaysRaise && !(d && d.kind === 'raise')) {
        var nr = toppedEarly ? 'topped' : danger ? 'danger' : fullTop(board) >= raiseCap(board, comingRows, A) ? 'cap' : cascadeLive(board, true) ? 'busy' : bot.stack && bot.stack.preventManualRaise ? 'prevent' : bot.stack && bot.stack.riseLock ? 'riseLock' : bot.stack && bot.stack.hasActivePanels && bot.stack.hasActivePanels() ? 'active' : bot.stack && (bot.stack.shakeTime || 0) > 0 ? 'shake' : bot.stack && bot.stack.hasFallingGarbage && bot.stack.hasFallingGarbage() ? 'fallG' : d ? 'other-' + d.kind : 'none';
        bot._noRaise = bot._noRaise || {}; bot._noRaise[nr] = (bot._noRaise[nr] || 0) + 1;
        if ((nr === 'danger' || nr === 'none' || nr.indexOf('other') === 0) && bot.stack && !bot.stack.riseLock && noRaiseLogged++ < 150) console.error('NORAISE clock ' + board.clock + ' top ' + fullTop(board) + ' why ' + nr + (danger ? '/' + dangerWhy : '') + ' kind ' + (d ? d.kind : 'default') + ' coming ' + comingRows + ' soon ' + (arrivals.length ? Math.min.apply(null, arrivals.map(function (a) { return a.at; })) : '-') + ' stop ' + ((board.stopTime || 0) + (board.preStopTime || 0)));
      }
      // A BIG CHAIN COMES FIRST WHEREVER THE BOARD IS: past the gate above (the stack tall, a lot coming, garbage all over it) a chain
      // the planner finds in a few swaps -- on the board with the garbage on its way counted -- is played before anything else
      if (A && !A.arbiter && !danger && !d && !(!A.ignoreOpp && m.opp && m.opp.out)) {
        var chainMs = due ? Math.min(A.chainMs || 250, due - Date.now() - DEADLINE_MARGIN_MS) : (A.chainMs || 250);
        if (chainMs >= 60) {
          if (!attacker) attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames });
          var cp = attacker.plan(board, m.hold, { ms: chainMs, width: A.width || 60, depth: A.chainSwaps || 6, pool: A.pool || 250, minChain: A.minChain === undefined ? 4 : A.minChain, guideChain: A.guideChain, arrivals: arrivals, rate: A.rate });
          if (cp && cp.cells >= 1 && cp.seq.length && !(A.minRows && cp.after < A.minRows) && !(toppedFree && cp.seq.length * 18 + 30 > stopLeft) && leavesBreakTime(cp)) { d = { kind: 'swap', move: cp.seq[0], overruled: true, src: 'chainFirst', planChain: cp.chain }; bot._attackCells = cp.cells; attackLine = cp.seq.slice(1); attackMove = cp.seq[0]; bot._planUntil = board.clock + 40 * cp.seq.length; bot._chainFirst = (bot._chainFirst || 0) + 1; }
        }
      }
      // IN DANGER THE ATTACK IS STILL WANTED, BUT ONLY AS A MOVE THE SURVIVAL SEARCH PROVES TO LIVE: the fire the planner finds is asked for
      // like a break (it is chosen if it is among the proven moves, never over them) and must leave minRows rows
      if (A && !A.arbiter && danger && A.dangerAttack !== false && !d) {
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
      // ONE ORDERED CHOICE (arbiter): the attack logic proposes -- the extension of a chain popping, the line to the best fire (with
      // garbage on the board, the lines that break it first), a break made ready for what is on its way, a setup, a raise -- and
      // decides nothing. The survival search then picks, among the moves that live its horizon, the one ranked first:
      //   an attack now that breaks garbage; a planned line that breaks garbage; a break now (or the break search's line to one);
      //   an attack now (a combo of four or more, a longer chain: what the move adds to the board left alone); a three on a stack
      //   at the top (the last resort); a planned fire or extension; a break made ready; a setup; a raise;
      // bigger before smaller within each, and, when none of them lives, the survival search's own choice.
      var arbProps = null, arbKey = function (mv) { return mv[0] + ',' + mv[1]; };
      // ATTACK LINES UNDER THREAT (defendLines): the defence's own moves are single swaps, so a better line a few swaps away -- a combo of
      // outCells or more, or a chain, done before the next garbage leaves no time to break it -- is planned and offered to its ranking:
      // a line that breaks garbage before any single break, a three's included; one that breaks nothing before the breaks only out of
      // danger. The survival search proves its first swap lives like any move; the line is played on from there (arbProps)
      if (defendA && A0.defendLines && bot.preferRank) {
        var lmsD = Math.min(A0.defendLineMs || 60, due ? due - Date.now() - 2 * DEADLINE_MARGIN_MS - 100 : 1e9);
        if (lmsD >= 25) {
          if (!attacker) attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames });
          // (the whole line, not its first swap: the frame loop plays the rest of it without asking again, so the line is played on
          // the engine with the garbage on its way landing and is never dead -- at level 10's health, never idle topped out -- however
          // many swaps it takes; what the board does after it is the next decisions': continuous)
          var apD = attacker.plan(board, m.hold, { ms: lmsD, width: A0.width || 40, depth: A0.depth || 7, pool: A0.pool || 250, stopAt: 0, minChain: 0,
                                                   guideChain: A0.guideChain, rate: A0.rate, arrivals: arrivals, breakFirst: !!SH.lowestGarbageRow(board) });
          // (in time and out of danger as agro's own settings judge them: the attack block is set aside under threat)
          var fitsD = !A0.readyFrames || firstLand === Infinity || (apD.chain || 0) >= 3 || apD.seq.length * 18 + A0.readyFrames <= firstLand;
          var dangerD = CK.dangerWhy(board, realArrivals, comingRows, m.topped, A0) !== '';
          // (a line that breaks garbage counts with anything bigger than a plain three in it -- a combo of four or more sends garbage,
          // a chain links: the planner keeps the most garbage sent, so it is the biggest break in reach; one that breaks nothing
          // needs outCells)
          var bigD2 = (apD.chain || 0) >= 2 || (apD.cells || 0) > 0;
          if (apD.seq.length && apD.continuous && (apD.brk ? bigD2 : ((apD.chain || 0) >= 2 || (apD.cells || 0) >= (A0.outCells || 4))) && fitsD) {
            // (under the floor -- the lowest column of panels under floorRows -- a line that breaks nothing is not offered: its panels are
            // what the garbage is broken with)
            var floorD = !!(A0.floorRows && lowPeak(board) < A0.floorRows && !m.topped && !(m.realTop >= 11));
            var kD = arbKey(apD.seq[0]), rD = apD.brk ? (spareD ? -0.6 : 0.3) : (!dangerD && !floorD ? -0.3 : null);
            if (rD !== null) {
              arbProps = {}; arbProps[kD] = { rank: rD, src: 'fire', line: apD.seq.slice(1), planChain: apD.chain, cells: apD.cells, brk: !!apD.brk };
              var prD = bot.preferRank;
              bot.preferRank = function (c, i) { var r = prD.call(this, c, i); return c.kind === 'swap' && c.move && arbKey(c.move) === kD ? Math.min(r, rD) : r; };
              bot._defendLines = (bot._defendLines || 0) + 1;
            }
          }
        }
      }
      // THE FLOOR UNDER THREAT (floorRows): the lowest column of panels under floorRows, a clear that breaks no garbage ranks after the
      // hold -- played only when nothing ranked before it lives: the garbage is broken first, stop time only when it is needed
      // (not on a stack the game shows topped out: there a hold is a frame of health, and stop time is what is needed)
      if (defendA && A0.floorRows && bot.preferRank && lowPeak(board) < A0.floorRows && !m.topped && !(m.realTop >= 11)) {
        var prF = bot.preferRank;
        // (ranked as the arbiter ranks it: a swap that clears nothing 0.5, the hold 0.6, a clear that breaks no garbage left unranked --
        // an unranked move comes after every ranked one; the breaks, the lines and the raise keep their places before them)
        bot.preferRank = function (c, i) {
          var r = prF.call(this, c, i), rr = c.added || c.resolved;
          if (r < 0.5) {
            if (c.kind === 'swap' && rr && (rr.comboSizes || []).length && !((rr.brokeGarbage || 0) > 0) && !(r < 0)) { bot._floorHeld = (bot._floorHeld || 0) + 1; return Infinity; }
            return r;
          }
          if (c.kind === 'hold') return 0.6;
          if (c.kind === 'swap' && !(rr && (rr.comboSizes || []).length)) return 0.5;
          if (c.kind === 'swap' && rr && (rr.comboSizes || []).length && !((rr.brokeGarbage || 0) > 0)) { bot._floorHeld = (bot._floorHeld || 0) + 1; return Infinity; }
          return r;
        };
      }
      // DOWN TIME IS FOR THE SHAPE (defendFlatten): while stop time runs, or nothing is landing or on its way, a swap that leaves the
      // board flatter (its tallest column less its lowest, settled) or with less hollow under garbage than the board left alone ranks
      // before the hold and every move unranked -- the breaks, the lines and the raise still before it
      var downD = !!(defendA && A0.defendFlatten && bot.preferRank && (((board.stopTime || 0) + (board.preStopTime || 0)) > 0 || (!m.topped && !(board.incoming || []).length && !arrivals.length)));
      if (downD) {
        var colsOf = function (b) {
          var hs = [], c, r; if (!b || !b.panels) return null;
          for (c = 1; c <= 6; c++) { var h = 0; for (r = b.panels.length - 1; r >= 1 && !h; r--) { var p = b.panels[r] && b.panels[r][c]; if (p && (p.isGarbage || p.color)) h = r; } hs.push(h); }
          return hs;
        };
        var hollowB = function (b) {
          var n = 0, c, r; if (!b || !b.panels) return 0;
          for (c = 1; c <= 6; c++) { var over = false; for (r = b.panels.length - 1; r >= 1; r--) { var p = b.panels[r] && b.panels[r][c]; if (p && p.isGarbage) over = true; else if (over && !(p && p.color)) n++; } }
          return n;
        };
        var shapeOfB = function (b) { var hs = colsOf(b); return hs ? { spread: Math.max.apply(null, hs) - Math.min.apply(null, hs), hollow: hollowB(b) } : null; };
        var candsF = null, base = null, prFl = bot.preferRank;
        bot.preferRank = function (c, i) {
          var r = prFl.call(this, c, i);
          if (r < 0.5 || c.kind !== 'swap') return r;
          if (bot._allCands !== candsF) { candsF = bot._allCands; var hc = (candsF || []).filter(function (x) { return x.kind === 'hold'; })[0]; base = hc ? shapeOfB(bot._settledOf(hc)) : null; }
          var rr = c.added || c.resolved; if (!base || (rr && (rr.comboSizes || []).length)) return r;
          var sh = shapeOfB(bot._settledOf(c)); if (!sh) return r;
          if (sh.hollow < base.hollow || (sh.hollow === base.hollow && sh.spread < base.spread)) { bot._flattened = (bot._flattened || 0) + 1; return Math.min(r, 0.5 - Math.min(0.09, (base.spread - sh.spread + 2 * (base.hollow - sh.hollow)) / 100)); }
          return r;
        };
      }
      // MATERIAL UNDER THREAT (defendRaise): a stack under lowTop rows (garbage landed counted) that the game does not show topped out
      // and is in no danger is raised to lowTop, before any single break -- the defence never raises with garbage on the board, and a
      // low stack has nothing to break or attack with. The survival search proves the raise lives like any move; only a planned
      // line to a bigger break comes before it
      // (judged on the board the game shows: not topped out, its stack -- landed garbage counted, queued garbage not -- under lowTop.
      // The queue is not on it: counted as landed, ninety rows queued read as a stack topped out, and the stack was never raised)
      if (process.env.GC_RAISE_WHY && A0 && A0.defendRaise && fullTop(board) < (A0.lowTop || 6))
        console.error('RAISEWHY clock ' + board.clock + ' defend ' + defendA + ' pref ' + !!bot.preferRank + ' topped ' + !!m.topped + ' realTop ' + m.realTop + ' top ' + fullTop(board) + ' canRaise ' + bot._canRaise() +
          ' prevent ' + !!(bot.stack && bot.stack.preventManualRaise) + ' lock ' + !!(bot.stack && bot.stack.riseLock) + ' active ' + !!(bot.stack && bot.stack.hasActivePanels && bot.stack.hasActivePanels()) + ' shake ' + (bot.stack && bot.stack.shakeTime));
      if (defendA && A0.defendRaise && bot.preferRank && !(m.topped) && !(m.realTop >= 11) && fullTop(board) < (A0.lowTop || 6) && bot._canRaise()) {
        arbProps = arbProps || {};
        arbProps.raise = { rank: -0.5, src: 'raise', to: A0.lowTop || 6 };
        var prR = bot.preferRank;
        bot.preferRank = function (c, i) { var r = prR.call(this, c, i); return c.kind === 'raise' ? Math.min(r, -0.5) : r; };
        bot._defendRaises = (bot._defendRaises || 0) + 1;
      }
      if (A && A.arbiter) {
        if (!attacker) attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames });
        // TIME ATTACK: no one to send to -- only chains count, the bigger the better; a combo is no attack
        var taA = matchMode === 'timeattack';
        // BURIED: garbage on the board, the stack at the top with it, and few panels under it (lowPanels) -- the only way out is to
        // break the garbage. Only what breaks it is ranked: a break now, a line that breaks it, the break search's lines; the
        // planner looks as long and as deep as it does on a calm board.
        var buriedA = !!(SH.lowestGarbageRow(board) && (toppedReal || fullTop(board) >= (board.height || 12) - 1) && CK.panelTop(board) <= (A.lowPanels || 5));
        if (buriedA) bot._buried = (bot._buried || 0) + 1;
        var garbA = !!SH.lowestGarbageRow(board), busyA = cascadeLive(board, A.freeRaise), props = arbProps = {};
        var leftMs = function () { return due ? due - Date.now() - 2 * DEADLINE_MARGIN_MS - 100 : 1e9; };
        var worthOf = function (chain, cells) { return Math.min(0.49, ((chain || 0) * 3 + (cells || 0)) / 1000); };
        var put = function (k, r, info) { if (!props[k] || r < props[k].rank) props[k] = Object.assign({ rank: r }, info); };
        if (busyA) {
          var ems = Math.min(A.extendMs || 80, leftMs());
          if (ems >= 30) {
            var exA = attacker.extend(board, m.hold, { ms: ems, width: A.extendWidth || 40, depth: A.extendDepth || 6 });
            if (exA.seq.length && exA.cells >= exA.base + (A.extendGain || 1)) put(arbKey(exA.seq[0]), -1.5 - worthOf(0, exA.cells - exA.base), { src: 'extend', line: exA.seq.slice(1), cells: exA.cells });
          }
        }
        var quietA = !garbA && comingRows === 0 && SH.top(board) < (A.quietTop || 9), climbA = !!(A.climbBig && SH.top(board) >= (A.climbTop || 9));
        var pms = Math.min(quietA || climbA || buriedA ? (A.bigMs || 200) : (A.ms || 60), leftMs());
        if (pms >= 30) {
          // (time attack: chains only, the biggest -- no rate for speed, no combo)
          var apA = attacker.plan(board, m.hold, { ms: taA ? Math.min(A.bigMs || 200, leftMs()) : pms, width: quietA || climbA || taA || buriedA ? (A.bigWidth || 100) : (A.width || 40), depth: quietA || climbA || taA || buriedA ? (A.bigDepth || 14) : (A.depth || 7),
                                                   pool: A.pool || 250, stopAt: 0, minChain: taA ? 2 : 0, guideChain: A.guideChain, rate: taA ? 0 : A.rate, arrivals: arrivals, breakFirst: garbA });
          if (apA.seq.length && (apA.cells >= (A.outCells || 4) || apA.brk) && leavesBreakTime(apA))
            put(arbKey(apA.seq[0]), (apA.brk ? -3.5 : -1.5) - worthOf(apA.chain, apA.cells), { src: 'fire', line: apA.seq.slice(1), planChain: apA.chain, cells: apA.cells, brk: !!apA.brk });
          if (apA.setup) put(arbKey(apA.setup), -0.5, { src: busyA ? 'busySetup' : 'setup' });
        }
        // READY TO BREAK: the garbage on its way -- and, on a stack at lowTop or more with none shown, a slab the size of the tallest
        // this match has sent, landing as soon as one can -- has a break ready when it lands; the swap that makes one is proposed
        // when none is, and the stack is raised only while one is
        (m.arrivals || []).forEach(function (a) { if (a.g && a.g.height > (bot._maxSlab || 0)) bot._maxSlab = a.g.height; });
        (board.incoming || []).forEach(function (g) { if (g.height > (bot._maxSlab || 0)) bot._maxSlab = g.height; });
        var hypoA = readyArr.length ? readyArr : !taA && fullTop(board) >= (A.lowTop || 6) ? [{ at: A.readyAt || 90, width: board.width || 6, height: Math.max(bot._maxSlab || 0, A.slabGuess || 3), isChain: false, isMetal: false, capped: false }] : [];
        var rdA = null;
        var lowNowA = !!(A.floorRows && !taA && lowPeak(board) < A.floorRows);
        if (hypoA.length && (!garbA || lowNowA)) {
          var rmsA = Math.min(A.readyMs || 80, leftMs());
          rdA = rmsA >= 30 ? attacker[A.readyTime ? 'readyInTime' : 'readyFor'](board, m.hold, hypoA, { ms: rmsA }) : null;
          // (under the floor, the swap that makes the break ready comes before any attack: it is what keeps the stack)
          if (rdA && !rdA.ready && rdA.setup) put(arbKey(rdA.setup), lowNowA ? -2.9 : -1, { src: 'ready' });
        }
        var readyA = !rdA || !!rdA.ready;
        // THE RAISE: nothing popping and out of danger, a calm board (nothing on it, nothing on its way) is raised to calmRaiseTo
        // before anything but a break; a stack under lowTop, whatever is coming, before a planned fire; otherwise only up to raiseCap,
        // after the setups
        if (!busyA && !toppedForRaise && bot._canRaise()) {
          var topA = fullTop(board), calmA = !garbA && comingRows === 0 && !(board.incoming || []).length;
          // (calm: raised all the way to calmRaiseTo before anything else is built -- the break is made ready at the top; a low stack
          // with garbage on its way is raised to lowTop before a planned fire)
          // (time attack: no chain going, the stack goes up to calmRaiseTo and the next chain is built from there; a combo only to live)
          // (past lowTop the full raise goes on only while a break is ready for the next slab -- in time attack, none can come)
          // (room for the next slab: a calm stack is raised no higher than leaves the tallest slab this match has sent -- slabGuess
          // before any, and no more than slabGuess rows of one taller than that -- landing under the top row; in time attack none comes)
          var calmTo = taA ? (A.calmRaiseTo || 10) : Math.min(A.calmRaiseTo || 10, 11 - Math.min(bot._maxSlab || A.slabGuess || 3, A.slabGuess || 3));
          if ((calmA || taA) && topA < calmTo && !danger && (taA || readyA || topA < (A.lowTop || 6))) put('raise', -2.5, { src: 'raise', to: calmTo });
          else if (volleyA && topA < (A.volleyTo || 9) && !danger) put('raise', -1.4, { src: 'volley', to: A.volleyTo || 9 });   // material to break the volley with
          else if (topA < (A.lowTop || 6) && !danger) put('raise', -1.4, { src: 'raise', to: A.lowTop || 6 });   // a low stack has nothing to build with, whatever is coming
          else if (topA < raiseCap(board, comingRows, A)) put('raise', -0.3, { src: 'raise', to: raiseCap(board, comingRows, A) });
        }
        bot.SURVIVE_SEARCH_BUDGET = due ? Math.max(CHEAP, Math.min(FULL, Math.round((due - Date.now()) * nodesPerMs * SPEND))) : FULL;
        var lastResA = !!toppedReal;
        var backA = null;
        (m.backs || []).forEach(function (ids) { if (ids) { backA = backA || {}; backA[ids[1] + ',' + ids[0]] = true; } });
        // HOLLOW UNDER THE PILE: the empty cells with garbage above them in their column, on a settled grid (-2 garbage, 0 empty).
        // A move that leaves more of it than the board left alone digs under the pile -- what is on it stays up -- and is ranked
        // with none of the attacks or breaks it makes.
        var hollowOf = function (b) {
          if (!b || !b.grid) return 0;
          var n = 0, r, c, over;
          for (c = 1; c <= (b.width || 6); c++) { over = false; for (r = b.grid.length - 1; r >= 1; r--) { var v = b.grid[r] && b.grid[r][c]; if (v === -2) over = true; else if (over && !v) n++; } }
          return n;
        };
        // (the board left alone is this decision's hold: the candidates are built inside the decision, after this, so every
        // measure of it is reset the first time a ranking sees a new candidate list)
        var holdC = null, hollow0 = -1, candsSeen = null;
        // (the panels on a settled grid: every coloured cell, garbage and empty not counted)
        var panelsOf = function (b) {
          if (!b || !b.grid) return 0;
          var n = 0, r, c;
          for (r = 1; r < b.grid.length; r++) for (c = 1; c <= (b.width || 6); c++) { var v = b.grid[r] && b.grid[r][c]; if (v > 0) n++; }
          return n;
        }, panels0 = -1;
        // A BREAK IN THE TIME A CLEAR BUYS: on the board the clear settles to, a line of floorDepth swaps or fewer that breaks garbage,
        // its swaps done (swapFrames each) within the stop time and health that board has. Asked of floorAsks moves a decision at most.
        var floorAsked = 0, floorSeen = {};
        var breakAfter = function (c) {
          var key = c.move ? arbKey(c.move) : c.kind;
          if (key in floorSeen) return floorSeen[key];
          var sb = bot._settledOf(c), ms = Math.min(A.floorMs || 15, leftMs());
          if (!sb || !sb.copy || floorAsked >= (A.floorAsks || 4) || ms < 5) return (floorSeen[key] = false);
          floorAsked++;
          if (!attacker) attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames });
          var pl = attacker.plan(sb, m.hold, { ms: ms, width: 6, depth: A.floorDepth || 2, pool: 12, minChain: 99, breakFirst: true, arrivals: realArrivals });
          var time = (sb.stopTime || 0) + (sb.preStopTime || 0) + (sb.health || 0);
          return (floorSeen[key] = !!(pl && pl.brk && pl.seq.length * (A.swapFrames || 18) <= time));
        };
        // MORE GARBAGE ABOUT TO LAND ON THE GARBAGE THERE (mergeWait): a block falling now that settles on another block, or a block
        // queued (dropping as soon as the board is not topped out) or on its way within mergeWait frames that lands on a column topped
        // by garbage -- touching blocks pop together, so one break then takes them all
        var mergeSeen = null;
        var mergeA = function () {
          if (mergeSeen !== null) return mergeSeen;
          mergeSeen = false;
          if (!A.mergeWait || !holdC) return false;
          var sb = bot._settledOf(holdC), r, c, p, q, fall = {}, falling = false;
          if (!sb || !sb.panels) return false;
          var rows = Math.min(board.panels.length, (board.height || 12) + 4);
          for (r = 1; r < rows; r++) for (c = 1; c <= (board.width || 6); c++) { p = board.panels[r] && board.panels[r][c]; if (p && p.isGarbage && p.state === 'falling') { fall[p.garbageId] = true; falling = true; } }
          var srows = Math.min(sb.panels.length, (board.height || 12) + 4);
          if (falling) for (r = 2; r < srows && !mergeSeen; r++) for (c = 1; c <= (board.width || 6); c++) {
            p = sb.panels[r] && sb.panels[r][c]; q = sb.panels[r - 1] && sb.panels[r - 1][c];
            if (p && p.isGarbage && fall[p.garbageId] && q && q.isGarbage && !fall[q.garbageId]) { mergeSeen = true; break; }
          }
          var coming = ((board.incoming || []).length && !(board.isToppedOut && board.isToppedOut())) || realArrivals.some(function (a) { return a.at <= A.mergeWait; });
          if (!mergeSeen && coming) for (c = 1; c <= (board.width || 6) && !mergeSeen; c++) {
            for (r = srows - 1; r >= 1; r--) { p = sb.panels[r] && sb.panels[r][c]; if (p && (p.isGarbage || p.color)) { if (p.isGarbage) mergeSeen = true; break; } }
          }
          if (mergeSeen) bot._mergeWaits = (bot._mergeWaits || 0) + 1;
          return mergeSeen;
        };
        // (under the floor: the lowest column of panels, on the board left alone once it settles, is under floorRows)
        var lowA = function () {
          if (!A.floorRows || taA) return false;   // (time attack has no garbage to break)
          if (panels0 < 0) { var sb0 = holdC && bot._settledOf(holdC); panels0 = sb0 && sb0.panels ? lowPeak(sb0) : lowPeak(board); }
          return panels0 < A.floorRows;
        };
        // A WELL UNDER WHAT IS COMING: with garbage on the board or on its way, a move whose settled board is more uneven (the tallest
        // column less the lowest) than the board left alone, past wellRows, leaves a slab to rest on the towers over a pit. Of the
        // moves no ranking above names, the swaps that keep the board level come first, then the hold; an attack is ranked as
        // one whatever its shape, unless it digs under the pile.
        var spreadOf = function (b) {
          if (!b || !b.grid) return 0;
          var hi = 0, lo = 99, c, r;
          for (c = 1; c <= (b.width || 6); c++) { var h = 0; for (r = b.grid.length - 1; r >= 1 && !h; r--) if (b.grid[r] && b.grid[r][c]) h = r; if (h > hi) hi = h; if (h < lo) lo = h; }
          return hi - lo;
        };
        var shapeAt = !!(garbA || readyArr.length), spread0 = -1, wellRows = A.wellRows || 4;
        var queuedA = 0; (board.incoming || []).forEach(function (g) { queuedA += g.height || 0; });
        var bigQA = queuedA + comingRows >= (A.bigQueueRows || 6); var spreadT = -1;
        var shapeOf = function (c) {
          if (!shapeAt || c.kind !== 'swap') return { hollow: false, well: false };
          if (hollow0 < 0) hollow0 = holdC ? hollowOf(bot._settledOf(holdC)) : 0;
          if (spread0 < 0) spread0 = holdC ? spreadOf(bot._settledOf(holdC)) : 0;
          var sb = bot._settledOf(c);
          return { hollow: garbA && hollowOf(sb) > hollow0, well: spreadOf(sb) > Math.max(spread0, wellRows) };
        };
        bot.preferRank = function (c) {
          if (bot._allCands !== candsSeen) {
            candsSeen = bot._allCands;
            holdC = (candsSeen || []).filter(function (x) { return x.kind === 'hold'; })[0] || null;
            hollow0 = -1; spread0 = -1; spreadT = -1; panels0 = -1; mergeSeen = null;
          }
          var k = c.kind === 'swap' && c.move ? arbKey(c.move) : c.kind, r = Infinity, add = c.added || c.resolved;
          var sh = shapeOf(c);
          // A SWAP BACK -- the two panels one of the last swaps exchanged (the frame loop's own record, m.backs, by panel id) put back
          // -- clearing nothing is ranked nowhere: the frame loop would play it as a hold
          if (c.kind === 'swap' && c.move && backA && !(add && (add.comboSizes || []).length)) {
            var rowB = board.panels[c.move[0]], pa = rowB && rowB[c.move[1]], pb = rowB && rowB[c.move[1] + 1];
            if (pa && pb && backA[pa.id + ',' + pb.id]) { bot._backs = (bot._backs || 0) + 1; return Infinity; }
          }
          // A SWAP IS NOT MADE TO BE UNDONE: the pair swapped within pingFrames, again, clearing nothing, is no setup, readiness or levelling
          var again = c.kind === 'swap' && c.move && !(add && (add.comboSizes || []).length) && (bot._swapLog || []).some(function (e) { return e.pk === k && m.at - e.at < (A.pingFrames || 150) && m.at >= e.at; });
          if (again) { bot._flips = (bot._flips || 0) + 1; return Infinity; }
          if (sh.hollow && add && (add.comboSizes || []).length && !((add.brokeGarbage || 0) > 0)) { bot._digs = (bot._digs || 0) + 1; return props[k] && props[k].src !== 'fire' ? props[k].rank : Infinity; }
          if (add && c.kind === 'swap') {
            var sizes = add.comboSizes || [], big = 0, ch = add.chainLength || 0, brk = (add.brokeGarbage || 0) > 0;
            sizes.forEach(function (x) { if (x > big) big = x; });
            var atk = ch >= 2 || (big >= 4 && !taA);
            if (atk && brk) r = -4 - worthOf(ch, big);
            // (topped with no stop time the stack drains and only stop time holds it: a plain break comes after a combo or chain)
            else if (brk) r = !!toppedReal && !((board.stopTime || 0) + (board.preStopTime || 0)) && !lowA() ? -1.9 - big / 1000 : -3 - big / 1000;
            else if (atk) r = -2 - worthOf(ch, big);
            else if (sizes.length && lastResA) r = -1.8;
          }
          // TIME ATTACK, THE CYCLE: no chain going, an uneven board is levelled first -- a swap that clears nothing and leaves the board
          // less uneven than it is, before the raise -- then raised to calmRaiseTo, then the biggest chain is built; and again
          if (taA && !busyA && c.kind === 'swap' && !(add && (add.comboSizes || []).length)) {
            if (spreadT < 0) spreadT = holdC ? spreadOf(bot._settledOf(holdC)) : 0;
            if (spreadT > (A.flatRows || 2)) { var sT = spreadOf(bot._settledOf(c)); if (sT < spreadT) r = Math.min(r, -3 - (spreadT - sT) / 100); }
          }
          if (k !== 'raise' && prep.want[k] === true) r = Math.min(r, -3);
          if (props[k]) r = Math.min(r, props[k].rank);
          // A BREAK WAITS FOR WHAT IS LANDING ON IT (mergeA): breaking before it lands takes the one block and leaves the next to be broken
          // again -- it ranks after the hold, so it is played now only when waiting does not live
          if (c.kind === 'swap' && add && (add.brokeGarbage || 0) > 0 && r < 0.6 && mergeA()) { bot._merged = (bot._merged || 0) + 1; r = 0.65; }
          // UNDER THE FLOOR (floorRows): a stack whose lowest column of panels is under floorRows (on the board left alone, settled) breaks
          // the garbage before anything else -- a plain break as much as one that attacks -- and makes stop time only when nothing else
          // lives: a clear, or a planned fire or extension, that breaks nothing and is no line to a break ranks after the hold, and of
          // those the ones whose board has a break within the time they buy come first (breakAfter)
          if (lowA() && r < 0.6 && c.kind === 'swap' && !(add && (add.brokeGarbage || 0) > 0) && !(props[k] && props[k].brk) && !(k !== 'raise' && prep.want[k] === true) &&
              ((props[k] && (props[k].src === 'fire' || props[k].src === 'extend')) || (add && (add.comboSizes || []).length))) { bot._floored = (bot._floored || 0) + 1; r = breakAfter(c) ? 0.7 : 0.8; }
          // A BIG HIT ON ITS WAY (bigQueueRows rows queued or coming): an attack that breaks nothing and leaves a well past
          // wellRows spends the panels the hit is broken with and leaves a pit for it -- it ranks after the levelling swaps
          if (bigQA && r < 0 && sh.well && !(add && (add.brokeGarbage || 0) > 0)) { bot._pitAttacks = (bot._pitAttacks || 0) + 1; r = 1 - r; }
          // (buried, life first: a break now or a line to one; failing those, what keeps it alive -- a combo or chain now, or the
          // extension of the chain popping, for the stop time they buy; failing those, the survival search's own move)
          if (buriedA) {
            var breaksNow = !!(add && c.kind === 'swap' && (add.brokeGarbage || 0) > 0), breakLine = (props[k] && props[k].brk) || (k !== 'raise' && prep.want[k] === true);
            // (topped with no stop time the stack drains: only stop time holds it, so a combo or chain comes before a plain break)
            var drainA = !!toppedReal && !((board.stopTime || 0) + (board.preStopTime || 0));
            var atkNowA = !!(add && c.kind === 'swap' && ((add.chainLength || 0) >= 2 || (add.comboSizes || []).some(function (x) { return x >= 4; })));
            if (breaksNow || breakLine) return drainA && breaksNow && !atkNowA && !lowA() ? r + 2.5 : r;
            var holdsOn = (props[k] && props[k].src === 'extend') || (r <= -2 && r > -3);
            return holdsOn ? r + 1 : Infinity;
          }
          // (a hold after them: waiting is not keeping the board level; a flip ranks nowhere, so the hold comes before it; a swap that
          // clears is ranked by what it clears above, never as a levelling swap)
          if (r === Infinity) r = c.kind === 'hold' ? 0.6 : c.kind === 'swap' && !sh.hollow && !sh.well && !(add && (add.comboSizes || []).length) ? 0.5 : Infinity;
          return r;
        };
        bot._arbiter = (bot._arbiter || 0) + 1;
      }
      // THE HORIZON REACHES PAST THE STOP TIME: while stop time runs the stack cannot rise, so every move lives through it -- the
      // horizon a move must live through is the stop time left and pastStop frames after it, or the stack left at the top when
      // it runs out is seen too late
      if (A) {
        var stopNowA = (board.stopTime || 0) + (board.preStopTime || 0);
        bot.SURVIVE_FRAMES = Math.max(P.prototype.SURVIVE_FRAMES, stopNowA + (A.pastStop || P.prototype.SURVIVE_FRAMES / 2));
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
      // WHAT THE ATTACK PLAYS HAS TO LIVE (survivalFirst): wherever the board is not plainly safe, the fire, the setup, the extension or the
      // raise the attack logic chose is not played over the survival search -- it is asked for like a break, and played only if the search
      // proves it lives the horizon; otherwise the move the search proves is
      var wanted = null;
      // (continuousLines: a fire whose whole line the engine played with the garbage landing, never dead and getting out from under the
      // garbage on the board, is its own proof -- it is played, not asked for)
      if (A && A.continuousLines && d && d.src === 'fire' && d.continuous) bot._continuous = (bot._continuous || 0) + 1;
      if (A && A.survivalFirst && d && d.overruled && (d.kind === 'swap' || d.kind === 'raise') && d.src !== 'warm' && !(A.continuousLines && d.src === 'fire' && d.continuous) &&
          (danger || SH.top(board) >= (A.riskTop || 8) || SH.lowestGarbageRow(board) || comingRows > 0 || (board.incoming || []).length)) {
        wanted = d;
        var wk = d.kind === 'swap' ? d.move[0] + ',' + d.move[1] : 'raise';
        // (an attack -- a fire or an extension -- is ranked by its worth, as the attacks the survival search sees are: a bigger
        // plan before a smaller combo made at once; anything else the attack logic asks for after the breaks)
        // (with garbage on the board, only a line that gets out from under it -- continuous -- is ranked before the breaks)
        var worth = A.attackRank && (d.src === 'fire' || d.src === 'extend') && d.cells && (!SH.lowestGarbageRow(board) || d.continuous) ? (d.planChain || 0) * 3 + d.cells : 0;
        if (!prep.want[wk]) prep.want[wk] = worth ? -0.5 - Math.min(0.49, worth / 200) : 0.5;
        d = undefined; bot._survivalAsked = (bot._survivalAsked || 0) + 1;
      }
      try { if (!d) d = bot._decide(); } finally { bot._abort = null; N.deadline(0); bot.depth = depth0; bot._dueAt = 0; }
      if (arbProps && d && d.kind === 'swap' && d.move) bot._swapLog = (bot._swapLog || []).filter(function (e) { return m.at - e.at < 400; }).concat([{ pk: arbKey(d.move), at: m.at }]).slice(-12);
      if (arbProps && d) {
        var ap0 = d.kind === 'swap' && d.move ? arbProps[arbKey(d.move)] : d.kind === 'raise' ? arbProps.raise : null;
        if (ap0) {
          d.src = ap0.src; d.overruled = true; if (ap0.planChain) d.planChain = ap0.planChain; if (ap0.to) d.raiseTo = ap0.to;
          if (ap0.line && ap0.line.length) { attackLine = ap0.line; attackMove = d.move; }
          bot._arbSrc = bot._arbSrc || {}; bot._arbSrc[ap0.src] = (bot._arbSrc[ap0.src] || 0) + 1;
        } else { bot._arbSrc = bot._arbSrc || {}; bot._arbSrc[d.kind === 'swap' ? 'survival' : d.kind] = (bot._arbSrc[d.kind === 'swap' ? 'survival' : d.kind] || 0) + 1; }
      }
      if (wanted) {
        var same = d.kind === wanted.kind && (d.kind === 'raise' || (d.move && wanted.move && d.move[0] === wanted.move[0] && d.move[1] === wanted.move[1]));
        if (same) { d.src = wanted.src; d.planChain = wanted.planChain; d.overruled = true; }
        else { attackLine = null; attackMove = null; bot._survivalOver = (bot._survivalOver || 0) + 1; }
      }
      // A PLAIN THREE IS A LAST RESORT: while the board is safe it is not played -- the bot waits, and the stack rises
      // to bring more to build with. (Breaking garbage, a chain, a bigger match and a topped-out board are not plain threes.)
      // (the attack profile: a three is played only when the survival search left nothing else -- bot.threeForced)
      // (threesOnlyTopped: not even then, unless the stack is topped out -- a failsafe)
      var toppedNow = toppedReal;
      if ((((A || HT) && safeA || (A && !bot.threeForced)) || (A && A.threesOnlyTopped && !toppedNow)) && !d.overruled && d.kind === 'swap' && d.move && bot.threeOnlySwap(d.move)) { d = { kind: 'hold', overruled: true }; bot._threesHeld = (bot._threesHeld || 0) + 1; }
      // A CLEAR THAT LEAVES THE STACK UNDER minRows ROWS is not made while the stack is not topped out: panels are kept to break what lands with
      if (A && !A.arbiter && A.minRows && !toppedEarly && !danger && !d.overruled && d.kind === 'swap' && d.move) {
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
      // NO PLAIN THREE BELOW THE TOP, WHOEVER CHOSE IT (guardThrees): the move the decision ends on -- the survival search's, a fire's, a
      // setup's, an extension's -- is played out on a copy of the board, and a swap whose clears are all threes (breaking garbage or not)
      // and that makes no chain is not played unless the plan it starts is a chain. The stack is raised instead, or held.
      var guard3 = function () {
      if (A && A.guardThrees && !toppedNow && d.kind === 'swap' && d.move && !(d.planChain >= 2)) {
        var t3 = board.copy(); t3.behaviours = Object.assign({}, t3.behaviours, { passiveRaise: false }); t3.curRow = d.move[0]; t3.curCol = d.move[1];
        var g3 = garbCells(board), r3 = t3.tryQueueSwap(d.move[0], d.move[1]) ? t3.settle() : null;
        // (a three that breaks garbage is a break, not a plain three: breakFirst)
        var three3 = !!(r3 && r3.combos.length && r3.chain < 2 && r3.combos.every(function (x) { return x === 3; })) && !(A.breakFirst && garbCells(t3) < g3);
        if (three3) {
          var src3 = d.src || (d.overruled ? 'overrule' : 'default');
          bot._guarded = bot._guarded || {}; bot._guarded[src3] = (bot._guarded[src3] || 0) + 1;
          if (threeLogged++ < 80) console.error('THREE-GUARD clock ' + board.clock + ' top ' + fullTop(board) + ' src ' + src3 + (danger ? ' danger/' + dangerWhy : '') + ' forced ' + !!bot.threeForced);
          d = fullTop(board) < raiseCap(board, comingRows, A) && bot._canRaise() && !cascadeLive(board, true) ? { kind: 'raise', overruled: true } : { kind: 'hold', overruled: true };
          attackLine = null;
        }
      }
      // (the swaps behind the first are played from the line without a decision: each is played out in turn on the board the one before
      // leaves, and the line is cut at the first that is a plain three -- unless the plan it belongs to is a chain)
      if (A && A.guardThrees && !toppedNow && attackLine && attackLine.length && d.kind === 'swap' && !(d.planChain >= 2)) {
        var tl = board.copy(); tl.behaviours = Object.assign({}, tl.behaviours, { passiveRaise: false });
        var cut = attackLine.length, step;
        if (d.move) { tl.curRow = d.move[0]; tl.curCol = d.move[1]; if (tl.tryQueueSwap(d.move[0], d.move[1])) tl.settle(); }
        for (step = 0; step < attackLine.length; step++) {
          var mv = attackLine[step];
          if (!Array.isArray(mv)) continue;
          tl.curRow = mv[0]; tl.curCol = mv[1];
          if (!tl.tryQueueSwap(mv[0], mv[1])) { cut = step; break; }
          var gl0 = garbCells(tl), rl = tl.settle();
          if (rl.combos.length && rl.chain < 2 && rl.combos.every(function (x) { return x === 3; }) && !(A.breakFirst && garbCells(tl) < gl0)) { cut = step; break; }
        }
        if (cut < attackLine.length) { bot._lineCuts = (bot._lineCuts || 0) + 1; attackLine = attackLine.slice(0, cut); }
      }
      };
      guard3();
      // ON A STACK TOPPED OUT a plain three is the last resort, and only worth playing if it digs: one that breaks no garbage and leaves the
      // stack as high as it was clears nothing that matters (it gives no stop time). The move is the first of the line that goes to the
      // garbage if there is one, else a hold.
      var guardTopped = function () {
        if (!(A && A.guardThrees && A.guardUseless && toppedNow && d.kind === 'swap' && d.move && !(d.planChain >= 2) && (board.stopTime || 0) + (board.preStopTime || 0) >= (A.uselessStop || 30))) return;
        var tt = board.copy(); tt.behaviours = Object.assign({}, tt.behaviours, { passiveRaise: false }); tt.curRow = d.move[0]; tt.curCol = d.move[1];
        var rt = tt.tryQueueSwap(d.move[0], d.move[1]) ? tt.settle() : null;
        if (!(rt && rt.combos.length && rt.chain < 2 && rt.combos.every(function (x) { return x === 3; }))) return;
        var gBefore = 0, gAfter = 0;
        for (var gr = 1; gr < board.panels.length; gr++) for (var gc = 1; gc <= 6; gc++) { if (board.panels[gr][gc] && board.panels[gr][gc].isGarbage) gBefore++; if (tt.panels[gr] && tt.panels[gr][gc] && tt.panels[gr][gc].isGarbage) gAfter++; }
        if (gAfter < gBefore || fullTop(tt) < fullTop(board)) return;
        bot._useless3 = (bot._useless3 || 0) + 1;
        if (threeLogged++ < 80) console.error('THREE-USELESS clock ' + board.clock + ' top ' + fullTop(board) + ' src ' + (d.src || (d.overruled ? 'overrule' : 'default')) + ' garbage ' + gBefore + '->' + gAfter);
        var alt = br && br.path && br.path.length ? br.path[0] : null;
        d = alt && !(alt[0] === d.move[0] && alt[1] === d.move[1]) ? { kind: 'swap', move: alt, overruled: true, src: 'touchline' } : { kind: 'hold', overruled: true };
        attackLine = null;
      };
      guardTopped();
      // NEVER IDLE (noIdle): a hold on a board that is safe, with nothing resolving, is a move wasted -- the stack is raised, or the best fire
      // is played, or a swap that builds toward one
      if (A && A.noIdle && d.kind === 'hold' && !danger && !toppedForRaise && !cascadeLive(board, true)) {
        var niMs = due ? Math.min(A.noIdleMs || 80, due - Date.now() - 2 * DEADLINE_MARGIN_MS - 60) : (A.noIdleMs || 80);
        if (fullTop(board) < raiseCap(board, comingRows, A) && bot._canRaise()) { d = { kind: 'raise', overruled: true }; bot._idleFilled = (bot._idleFilled || 0) + 1; }
        else if (niMs >= 30) {
          if (!attacker) attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames });
          var nip = attacker.plan(board, m.hold, { ms: niMs, width: A.noIdleWidth || 30, depth: A.noIdleDepth || 4, pool: A.noIdleWidth ? 250 : 100, minChain: A.minChain === undefined ? 4 : A.minChain, arrivals: arrivals, rate: A.rate });
          if (nip && nip.seq.length && nip.cells >= (A.aggro ? (A.outCells || 3) : 1) && !(A.minRows && nip.after < A.minRows)) { d = { kind: 'swap', move: nip.seq[0], overruled: true, src: 'noIdle', planChain: nip.chain }; attackLine = nip.seq.slice(1); attackMove = nip.seq[0]; bot._idleFilled = (bot._idleFilled || 0) + 1; }
          else if (nip && (nip.setup || nip.anySwap)) { d = { kind: 'swap', move: nip.setup || nip.anySwap, overruled: true, src: 'noIdle' }; bot._idleFilled = (bot._idleFilled || 0) + 1; }
        }
      }
      // A HOLD IS TIME TO THINK (thinkOnHold): the whole time the answer has left goes to the next big move -- a deep search for a fire or the
      // setup toward one -- and the survival search is asked again with it wanted: it is played if the search proves it lives, else the hold stands
      if (A && A.thinkOnHold && d.kind === 'hold' && !cascadeLive(board, true) && due && board.clock - (bot._lastThink === undefined ? -9999 : bot._lastThink) >= (A.thinkEvery || 36)) {
        var hrem = due - Date.now() - 2 * DEADLINE_MARGIN_MS;
        if (hrem > (A.holdMinMs || 350)) {
          bot._lastThink = board.clock;
          try {
            if (!attacker) attacker = ATTACK({ reaction: OPTS.reaction, swapGap: OPTS.swapGap, cursorMoveFrames: OPTS.cursorMoveFrames });
            var hp = attacker.plan(board, m.hold, { ms: Math.min(A.holdMs || 500, Math.round(hrem * 0.45)), width: A.bigWidth || 100, depth: A.bigDepth || 14, pool: A.pool || 250, minChain: A.minChain === undefined ? 4 : A.minChain, arrivals: arrivals, rate: A.rate });
            var hmv = hp && hp.seq.length && hp.cells >= (A.aggro ? (A.outCells || 3) : 1) && !(A.minRows && hp.after < A.minRows) ? hp.seq[0] : (hp && (hp.setup || hp.anySwap));
            if (hmv) {
              var hk = hmv[0] + ',' + hmv[1];
              if (!prep.want[hk]) prep.want[hk] = 0.5;
              bot._abort = cfg.abort ? stale : null; N.deadline(due - DEADLINE_MARGIN_MS);
              bot.SURVIVE_SEARCH_BUDGET = Math.max(CHEAP, Math.min(FULL, Math.round((due - Date.now()) * nodesPerMs * SPEND)));
              bot._dueAt = due - LOOKAHEAD_MARGIN_MS; bot.threeForced = false;
              var d2 = null;
              try { d2 = bot._decide(); } finally { bot._abort = null; N.deadline(0); bot._dueAt = 0; }
              if (d2 && d2.kind === 'swap' && d2.move && d2.move[0] === hmv[0] && d2.move[1] === hmv[1]) {
                d = { kind: 'swap', move: hmv, overruled: true, src: 'thought', planChain: hp.chain };
                if (hp.seq.length && hp.seq[0][0] === hmv[0] && hp.seq[0][1] === hmv[1]) { attackLine = hp.seq.slice(1); attackMove = hmv; }
                bot._thoughtMoves = (bot._thoughtMoves || 0) + 1;
              } else bot._thoughtHolds = (bot._thoughtHolds || 0) + 1;
            }
          } catch (e) { bot._thinkErr = String(e && e.message || e).slice(0, 80); }
        }
      }
      // (no three is played below the top, so no aimed lineup to a break -- its last swap is a three -- is either)
      var noAimed = !!(A && A.threesOnlyTopped && !toppedNow);
      // (defendBigBreaks: the lineup forced here never replaces a bigger break or an attack line the ranking chose, and of the breaks
      // it may force, the bigger is taken)
      var keepD = defendA && spareD && A0.defendBigBreaks && d && d.kind === 'swap' && d.move && (bigOfMove(d.move) || (arbProps && arbProps[arbKey(d.move)]));
      if (!keepD) d = SP.overrule(d, noAimed ? Object.assign({}, prep, { br: null, want: {} }) : prep, bot);   // a lineup while a slab pops (survivor_prefer.js)
      else bot._keptBig = (bot._keptBig || 0) + 1;
      guard3();
      guardTopped();
      // A SWAP IS NOT MADE TO BE UNDONE (noPingPong): the pair just swapped is not swapped again within pingFrames unless this one clears
      // something -- the setup that keeps coming back changes nothing. The stack is raised instead, or the move is the hold. Never in danger:
      // there the swap is a move the survival search proved, and a hold in its place is a stack left to die.
      if (A && !A.arbiter && A.noPingPong && !danger && d.kind === 'swap' && d.move) {
        var pk = d.move[0] + ',' + d.move[1], again = (bot._swapLog || []).filter(function (e) { return e.pk === pk && m.at - e.at < (A.pingFrames || 150) && m.at >= e.at; }).length > 0;
        if (again) {
          var tp = board.copy(); tp.behaviours = Object.assign({}, tp.behaviours, { passiveRaise: false }); tp.curRow = d.move[0]; tp.curCol = d.move[1];
          var rp = tp.tryQueueSwap(d.move[0], d.move[1]) ? tp.settle() : null;
          if (!(rp && rp.combos.length)) {
            bot._pingPong = (bot._pingPong || 0) + 1;
            d = !cascadeLive(board, true) && !toppedForRaise && fullTop(board) < raiseCap(board, comingRows, A) && bot._canRaise() ? { kind: 'raise', overruled: true } : { kind: 'hold', overruled: true };
            attackLine = null; attackMove = null;
          }
        }
        if (d.kind === 'swap' && d.move) { bot._swapLog = (bot._swapLog || []).filter(function (e) { return m.at - e.at < 400; }).concat([{ pk: d.move[0] + ',' + d.move[1], at: m.at }]).slice(-12); }
      }
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
      if (A0 && A0.keepLine && br && br.touch && br.path && br.path.length > 1 && d.kind === 'swap' && d.move && br.path[0][0] === d.move[0] && br.path[0][1] === d.move[1]) {
        var refC = 0, refP = null;
        for (var rc = 1; rc <= 6 && !refP; rc++) { var rp = board.panels[1] && board.panels[1][rc]; if (rp && rp.id != null && !br.path.some(function (mv) { return mv[0] === 1 && (mv[1] === rc || mv[1] + 1 === rc); })) { refC = rc; refP = rp; } }
        if (refP) bot._keepLine = { rest: br.path.slice(1), at: m.at, row: 1, col: refC, id: refP.id };
        if (br.kept) bot._keptLines = (bot._keptLines || 0) + 1;
      }
      // THE RAISE IS GARBAGE AWARE: the button is held only until the garbage on its way lands, less a lead to act in, and not at all when
      // it lands within the lead
      var holdFrames = 0, AR = A || (defendA ? A0 : null);   // (under threat, agro's own settings: the attack block is set aside there)
      if (d.kind === 'raise' && AR && AR.holdRaise) {
        var landIn = Infinity, lead = AR.raiseLead || 10;
        arrivals.forEach(function (a) { if (a.at < landIn) landIn = a.at; });
        // (held for the rows to the arbiter's target when it set one, else to raiseCap)
        holdFrames = Math.max(18, Math.min(AR.raiseHoldMax || 54, 18 * ((d.raiseTo || raiseCap(board, comingRows, AR)) - fullTop(board))));
        if (landIn < Infinity) holdFrames = Math.min(holdFrames, landIn - lead);
        if (holdFrames < 1 && landIn <= lead) { d = { kind: 'hold', overruled: true }; holdFrames = 0; }
        else if (holdFrames < 1) holdFrames = 0;
      }
      // THE LAST WORD ON A THREE (defendNoBareThrees): whatever stage chose it, a swap whose clears are plain threes breaking no garbage
      // is not played while holding is proven to live -- on a stack topped out (or one row from it, within nearFrames) proven outright,
      // elsewhere proven or weak; the first swap of a planned chain excepted. A three that breaks nothing spends three panels and buys
      // no stop time, and under a slab the panels are what every break is made of
      if (defendA && A0.defendNoBareThrees && d && d.kind === 'swap' && d.move && !(d.src === 'fire' && (d.planChain || 0) >= 2)) {
        var toppedG = !!m.topped || (m.realTop >= 11 && m.realFtt <= (A0.nearFrames || 90));
        if (bot.threeOnlySwap(d.move)) {
          var lvG = bot._lastVerdict, hiG = -1;
          if (lvG) for (var gi = 0; gi < lvG.cands.length; gi++) if (lvG.cands[gi].kind === 'hold') { hiG = gi; break; }
          if (hiG >= 0 && (lvG.verdict[hiG] === 'proven' || (!toppedG && lvG.verdict[hiG] === 'weak'))) {
            d = { kind: 'hold', overruled: true }; attackLine = null; bot._threeHeldD = (bot._threeHeldD || 0) + 1;
          }
        }
      }
      if (planned && bot.allDoomedNow) planRealUntil = m.at + (cfg.profile.planReal || 120);
      // (GC_BREAK_WHY: every move that breaks garbage, what it clears, the rank it was given, and what was chosen -- to see a three
      // chosen over a bigger break)
      if (process.env.GC_BREAK_WHY && bot._allCands) {
        var bw = bot._allCands.filter(function (c) { var r = c.added || c.resolved; return c.kind === 'swap' && r && (r.brokeGarbage || 0) > 0; });
        if (bw.length > 1 && bw.some(function (c) { var r = c.added || c.resolved; return (r.chainLength || 0) >= 2 || (r.comboSizes || []).some(function (x) { return x >= 4; }); })) {
          console.error('BREAKWHY clock ' + board.clock + ' defend ' + defendA + ' topped ' + !!m.topped + ' chose ' + (d && d.kind === 'swap' && d.move ? d.move.join(',') : d && d.kind) + ' src ' + (d && d.src) + ' doomed ' + !!bot.allDoomedNow + ' fast ' + (bot.followFast || 0) + ' :: ' +
            bw.map(function (c) { var r = c.added || c.resolved, lv = bot._lastVerdict, vi = lv ? lv.cands.indexOf(c) : -1; return c.move.join(',') + '[' + (r.comboSizes || []).join('+') + (r.chainLength >= 2 ? ' x' + r.chainLength : '') + '] rank ' + (bot.preferRank ? bot.preferRank(c, -1) : '-') + ' ' + (vi >= 0 ? lv.verdict[vi] : 'unsearched'); }).join(' | '));
        }
      }
      // WHETHER WAITING COSTS ANYTHING (read by the frame loop's pace): holding is proven to live through the survival horizon, and no break
      // is wanted now -- a break put off is a break made later, and under a slab breaks are where the panels come from
      var lvP = (bot._verdictNo || 0) !== verdictNo0 ? bot._lastVerdict : null, holdP = false;
      if (lvP) for (var pi = 0; pi < lvP.cands.length; pi++) if (lvP.cands[pi].kind === 'hold') { holdP = lvP.verdict[pi] === 'proven'; break; }
      out = { id: m.id, epoch: m.epoch, at: m.at, threeOK: !!(A && A.realThrees && dangerWhy === 'incoming'), src: d.src || (d.overruled ? 'overrule' : 'default'), kind: d.kind, move: d.move ? [d.move[0], d.move[1]] : null, raiseFrames: holdFrames, ms: Date.now() - t0, queued: m.posted ? t0 - m.posted : 0, brMs: brMs, why: why,
            line: line, lineAt: line && !lineFree ? fl.at : null, lineFree: lineFree, pace: { hold: holdP, brk: !!(br && br.depth) },
            mem: NativeMem(),
            breaks: br && br.depth ? { offered: br.depth, lineup: !!br.lineup, touch: !!br.touch, took: !!want[d.move ? d.move[0] + ',' + d.move[1] : d.kind] } : null,
            diag: { tight: tight, budget: bot.SURVIVE_SEARCH_BUDGET, took: took, survive: bot._svMs || 0, doomed: bot.doomedDecisions, allDoomed: bot.allDoomedNow, unproven: bot.survivalUnproven || 0, fast: bot.followFast || 0, dropped: bot.doomedMovesDropped, bare3Dropped: bot.bareThreesDropped, bare3Kept: bot.bareThreesKept, bare3Topped: bot.bareThreesTopped, unaffordable: bot.unaffordableDropped, walk: walkOf(bot, d), clears: clearsOf(bot, d), attack: bot._attackCells, setups: bot._setups || 0, threesHeld: bot._threesHeld || 0, combosHeld: bot._combosHeld || 0, chainHolds: bot._chainHolds || 0, extends: bot._extends || 0, buildHolds: bot._buildHolds || 0, raises: bot._raises || 0, chainFirst: bot._chainFirst || 0, readies: bot._readies || 0, unlocks: bot._unlocks || 0, rowsHeld: bot._rowsHeld || 0, dangers: bot._dangers || 0, dangerFires: bot._dangerFires || 0, idleFilled: bot._idleFilled || 0, noRaise: bot._noRaise || null, dangerWhy: bot._dangerWhy || null, guarded: bot._guarded || null, lineCuts: bot._lineCuts || 0, useless3: bot._useless3 || 0, toppedFree: bot._toppedFree || 0, survAsked: bot._survivalAsked || 0, busySetups: bot._busySetups || 0, thought: bot._thoughtMoves || 0, thoughtHolds: bot._thoughtHolds || 0, thinkErr: bot._thinkErr || null, pingPong: bot._pingPong || 0, survOver: bot._survivalOver || 0, continuous: bot._continuous || 0, fireWhy: bot._fireWhy || null, arbSrc: bot._arbSrc || null, mode: matchMode, buried: bot._buried || 0, pitAttacks: bot._pitAttacks || 0, backs: bot._backs || 0, digs: bot._digs || 0, flips: bot._flips || 0, volley: bot._volley || 0, floored: bot._floored || 0, merged: bot._merged || 0, mergeWaits: bot._mergeWaits || 0, defended: bot._defended || 0, defendLines: bot._defendLines || 0, threeAfterBig: bot._threeAfterBig || 0, threeHeldD: bot._threeHeldD || 0, keptBig: bot._keptBig || 0, defendRaises: bot._defendRaises || 0, floorHeld: bot._floorHeld || 0, flattened: bot._flattened || 0, keptLines: bot._keptLines || 0 } };
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
  function reset() { if (bot && bot._nat) nat = bot._nat; if (bot && bot._candNat) candNat = bot._candNat; bot = null; snap = null; planRealUntil = -1; }
  // New weights take effect from the next match (reset).
  function setWeights(w) { OPTS.weights = floored(w); }
  // The match's mode (survivor.js, from the link): 'timeattack', 'vs', 'solo', 'other' or 'unknown'.
  function setMode(mode) { matchMode = mode || 'unknown'; }
  return { answer: answer, reset: reset, setWeights: setWeights, warm: warm, setMode: setMode };
};
