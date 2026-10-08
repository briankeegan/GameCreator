// WASMSURVIVOR IN ONE PROCESS: the profile's bot on a pa-engine.js stack,
// deciding as survivor_mind.js does -- the survival search, then
// survivor_prefer.js's order among the moves proven to live, then the weights
// -- on the clock the game gives it: each decision is due a reaction's frames
// after it is asked (o.ms, default reaction x 1000/60 ms; 0 is no clock).
// versus.js plays it for opts.bot 'survivor', so a duel between two weight
// vectors is a duel between two WasmSurvivors that differ only in them.
//
//   survivorBot(view, weights, { profile, threads, ms })
//     view     PAEngine.view of the stack; versus.js's look() calls onServer
//              every frame, which reads the board and the garbage on its way
//     weights  replace the profile's (a feature absent counts 0)
//     profile  a profile object (default: survivor.profile.json, or
//              GC_SURVIVOR_PROFILE); its switches, never its weights
var path = require('path');
var P = require(path.join(__dirname, 'puyocpu.js'));
var SH = require(path.join(__dirname, 'survivor_shared.js')), SP = require(path.join(__dirname, 'survivor_prefer.js'));
// survivor_mind.js's: the searches end MARGIN_MS before the answer is due,
// the second ply LOOK_MS before; due sooner than TIGHT_MS is one move deep;
// the survival search's budget is SPEND of what the last decisions searched
// in the time there is.
var MARGIN_MS = 30, LOOK_MS = 15, TIGHT_MS = 80, SPEND = 0.6;
var N = require(path.join(__dirname, 'native.js')).server;
// NATIVE CONTEXTS ARE NEVER FREED (search.h ns_ctx_new carves them from the
// engine's arena), so a bot's are handed back when its duel ends (release,
// which versus.duel calls) and the next bot takes them, as survivor_mind.js
// keeps one across matches.
var POOL = [];
module.exports = function survivorBot(view, weights, o) {
  o = o || {};
  var profile = o.profile || SH.profile(), opts = SH.botOptions(profile, o.threads || 1);
  opts.weights = weights || {};
  var cpu = new P(view, opts), decide = cpu._decide, BS = null, kept = POOL.pop();
  if (kept) { cpu._nat = kept.nat; cpu._candNat = kept.cand; BS = kept.bs; }
  function search() {
    if (!BS) BS = new (require(path.join(__dirname, 'native.js')).server.Search)({ reaction: opts.reaction, swapGap: opts.swapGap, cursorMoveFrames: opts.cursorMoveFrames, threads: opts.threads || 1 });
    return BS;
  }
  var MS = o.ms !== undefined ? o.ms : Math.round(opts.reaction * 1000 / 60), rates = [];
  var FULL = P.prototype.SURVIVE_SEARCH_BUDGET, CHEAP = P.prototype.SURVIVE_SEARCH_BUDGET_CHEAP;
  cpu._decide = function () {
    var due = MS ? Date.now() + MS : 0, arrivals = this.serverArrivals || [], rows = 0;
    arrivals.forEach(function (a) { rows += a.height || 0; });
    var prep = SP.prepare(this, this.serverStack, { profile: profile, hold: { left: this.raiseFrames || 0, started: !!this._raiseStarted },
                                                    arrivals: arrivals, comingRows: rows, due: due, ms: MS, margin: MARGIN_MS, search: search });
    var npm = rates.length ? Math.min.apply(null, rates) : 30, depth0 = this.depth, d, t1 = Date.now();
    this.SURVIVE_SEARCH_BUDGET = due ? Math.max(CHEAP, Math.min(FULL, Math.round((due - Date.now()) * npm * SPEND))) : FULL;
    if (due) N.deadline(due - MARGIN_MS);
    if (due && due - Date.now() < TIGHT_MS) this.depth = 1;
    this._dueAt = due ? due - LOOK_MS : 0;
    try { d = decide.apply(this, arguments); } finally { N.deadline(0); this.depth = depth0; this._dueAt = 0; }
    var took = Date.now() - t1;
    if (took > 20) { rates.push(this.SURVIVE_SEARCH_BUDGET / took); if (rates.length > 8) rates.shift(); }
    return d ? SP.overrule(d, prep) : d;
  };
  cpu.release = function () {
    if (cpu._nat || cpu._candNat || BS) POOL.push({ nat: cpu._nat || null, cand: cpu._candNat || null, bs: BS });
    cpu._nat = null; cpu._candNat = null; BS = null;
  };
  return cpu;
};
