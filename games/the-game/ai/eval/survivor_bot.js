// WASMSURVIVOR IN A DUEL: one side of versus.duel (opts.bot 'survivor') played
// by WasmSurvivor's own frame loop (survivor_match.js) and its own thinking
// (survivor_think.js), in-process, so a duel between two weight vectors is
// two WasmSurvivors that differ only in them, playing as they play the game.
//
// Each frame the side is handed its board with the rows still to come unseen
// (pa-engine.js Unseen, as the server's state is read) and the garbage on its
// way as the opponent's telegraph shows it (bot/SurvivalLink.lua telegraph),
// and presses what the frame loop returns. Its questions are answered at
// once, and each answer is taken on the frame its thinking time would bring
// it on at 60 frames a second.
//
//   survivorBot(view, weights, { profile, think })
//     versus.duel calls onServer(stack, opponent) and update() each frame,
//     afterRun() once the frame has run, and release() when the duel ends
var path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), SH = require(path.join(__dirname, 'survivor_shared.js'));
var SM = require(path.join(__dirname, 'survivor_match.js')), think = require(path.join(__dirname, 'survivor_think.js'));
var MS_PER_FRAME = 1000 / 60, IN = PA.IN;
// THINKING AS THE GAME GIVES IT. A side thinks on one thread; the game's
// WasmSurvivor thinks on three (survivor.js --threads 3), 2.2 times as fast:
// 119 recorded questions took 31.8 s on one, 14.5 s on three, with the same
// moves. o.think (GC_SURVIVOR_THINK) is that ratio: a question is given
// think times its time, and its answer is taken as if it came think times
// as fast. 1 is this machine's own speed.
var THINK = Number(process.env.GC_SURVIVOR_THINK) || 1;
// MINDS ARE KEPT: native contexts are never freed (search.h ns_ctx_new carves
// them from the engine's arena), so a duel's minds go back here when it ends
// and the next duel's sides take them.
var POOL = [];
function garbageList(gs) {
  return (gs || []).map(function (g) { return { width: g.width, height: g.height, isMetal: !!g.isMetal, isChain: !!g.isChain, frameEarned: g.frameEarned, finalized: g.finalized }; });
}
// bot/SurvivalLink.lua telegraph, of a pa-engine.js stack
function telegraph(src) {
  var q = src.outgoing;
  return { stopWatch: src.stopWatch, staged: garbageList(q.staged),
           transit: q.transitTimers.map(function (t) { return { at: t, garbage: garbageList(q.inTransit[t]) }; }),
           capped: !!q.illegalStuffIsAllowed };
}
module.exports = function survivorBot(view, weights, o) {
  o = o || {};
  var profile = o.profile || SH.profile(), abort = new Int32Array(1), ratio = o.think || THINK;
  var mind = POOL.pop() || { think: think({ profile: profile, threads: 1, abort: abort }), abort: abort };
  mind.abort[0] = 0;
  mind.think.setWeights(weights || {});
  var side = { stack: null, opp: null, match: null, inFlight: [], bits: 0 };
  var L = { post: function (q) {
              if (q.type === 'reset') { mind.think.reset(); return; }
              if (q.ms) q.ms *= ratio;
              var t = Date.now(), a = mind.think.answer(q);
              a.got = Date.now();
              a.ms = Math.round(a.ms / ratio);   // as the game would have taken it (Match.soon reads it)
              side.inFlight.push({ frame: side.stack.clock + Math.max(1, Math.ceil((a.got - t) / ratio / MS_PER_FRAME)), a: a });
            },
            abort: mind.abort, answers: [], thinking: [], nextId: 1, pending: null, sync: false,
            profile: profile, hands: new SH.Hands(profile), msPerFrame: MS_PER_FRAME };
  side.onServer = function (stack, opp) {
    side.stack = stack; side.opp = opp;
    if (!side.match) side.match = new SM.Match({ levelData: stack.levelData, behaviours: stack.behaviours, stackOverConditions: { HEALTH: 0 } }, L);
  };
  side.update = function () {
    var st = side.stack, i;
    if (st.gameOver) return;
    for (i = 0; i < side.inFlight.length; i++) if (side.inFlight[i].frame <= st.clock) { L.answers.push(side.inFlight[i].a); side.inFlight.splice(i--, 1); }
    var truth = st.copy();
    truth.source = new PA.Unseen();
    var arrivals = SH.arrivalsOf({ stack: { stopWatch: st.stopWatch }, telegraph: side.opp ? [telegraph(side.opp)] : [] });
    var bits = side.match.frame(truth, arrivals, null);
    st.setInput(bits & ~IN.swap);
    if (bits & IN.swap) st.pressSwap = true;
  };
  side.afterRun = function () { if (!side.stack.gameOver) side.match.afterFrame(); };
  side.release = function () { if (mind) { POOL.push(mind); mind = null; } };
  side.stats = function () { return side.match ? side.match.stats : null; };
  return side;
};
