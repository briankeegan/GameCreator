// WASMSURVIVOR IN ONE PROCESS: the profile's bot on a pa-engine.js stack,
// deciding as survivor_mind.js does with no clock -- the survival search, then
// survivor_prefer.js's order among the moves proven to live, then the weights.
// versus.js plays it for opts.bot 'survivor', so a duel between two weight
// vectors is a duel between two WasmSurvivors that differ only in them.
//
//   survivorBot(view, weights, { profile, threads })
//     view     PAEngine.view of the stack; versus.js's look() calls onServer
//              every frame, which reads the board and the garbage on its way
//     weights  replace the profile's (a feature absent counts 0)
//     profile  a profile object (default: survivor.profile.json, or
//              GC_SURVIVOR_PROFILE); its switches, never its weights
var path = require('path');
var P = require(path.join(__dirname, 'puyocpu.js'));
var SH = require(path.join(__dirname, 'survivor_shared.js')), SP = require(path.join(__dirname, 'survivor_prefer.js'));
var MARGIN_MS = 30;   // survivor_mind.js DEADLINE_MARGIN_MS; with no clock it bounds nothing
module.exports = function survivorBot(view, weights, o) {
  o = o || {};
  var profile = o.profile || SH.profile(), opts = SH.botOptions(profile, o.threads || 1);
  opts.weights = weights || {};
  var cpu = new P(view, opts), decide = cpu._decide, BS = null;
  function search() {
    if (!BS) BS = new (require(path.join(__dirname, 'native.js')).server.Search)({ reaction: opts.reaction, swapGap: opts.swapGap, cursorMoveFrames: opts.cursorMoveFrames, threads: opts.threads || 1 });
    return BS;
  }
  cpu._decide = function () {
    var arrivals = this.serverArrivals || [], rows = 0;
    arrivals.forEach(function (a) { rows += a.height || 0; });
    var prep = SP.prepare(this, this.serverStack, { profile: profile, hold: { left: this.raiseFrames || 0, started: !!this._raiseStarted },
                                                    arrivals: arrivals, comingRows: rows, due: 0, ms: 0, margin: MARGIN_MS, search: search });
    var d = decide.apply(this, arguments);
    return d ? SP.overrule(d, prep) : d;
  };
  return cpu;
};
