// WASMSURVIVOR's parts that survivor.js (the frame loop) and survivor_mind.js
// (the search) both use, so each lives once: the profile, the garbage on its
// way, and the bot's hands -- which are search.h's own walk (native/pa.c
// ns_keys), so the keys pressed are the ones the search played.
var fs = require('fs'), path = require('path');
var PA = require(path.join(__dirname, 'pa-engine.js'));

// ---------------------------------------------------------------- the profile
// survivor.profile.json: the weights and the switches they play under, and
// how far ahead (frames) the frame loop may ask for a decision.
// GC_SURVIVOR_PROFILE names another file.
function profile() {
  var file = process.env.GC_SURVIVOR_PROFILE || path.join(__dirname, 'survivor.profile.json');
  var p = JSON.parse(fs.readFileSync(file, 'utf8'));
  ['name', 'weights', 'reaction', 'cursorMoveFrames', 'depth', 'modes', 'ahead'].forEach(function (k) {
    if (p[k] === undefined) throw new Error('survivor profile ' + file + ': no ' + k);
  });
  if (p.name.length > 16) throw new Error('survivor profile: name "' + p.name + '" is over the server\'s 16 characters');
  return p;
}
// What PuyoCpu is built with for a profile.
function botOptions(p, threads) {
  var weights = JSON.parse(fs.readFileSync(path.join(__dirname, p.weights), 'utf8')).weights;
  // overrides: weights set by the profile over the trained ones.
  Object.keys(p.overrides || {}).forEach(function (k) {
    if (!(k in weights)) throw new Error('survivor profile: override ' + k + ' is not a weight');
    weights[k] = p.overrides[k];
  });
  return { weights: weights,
           reaction: p.reaction, cursorMoveFrames: p.cursorMoveFrames, depth: p.depth, beam: 0, rise: true, allowRaise: true,
           modes: p.modes, engine: true, native: true, threads: threads };
}

// ---------------------------------------------------------------- garbage on its way
// What the senders' telegraphs show (bot/SurvivalLink.lua telegraph), as the
// garbage this board will receive and the stopWatch it arrives on: garbage
// due at T is received once the frame before T has run, so the board sent
// for frame T already holds it. A sender stages garbage for STAGING frames,
// then it lands LAND frames later; the staged are shipped highest priority
// first (the end of the list) and an unfinished chain holds back everything
// behind it, so nothing past one is counted on.
var STAGING = 45 + 45 + 1, LAND = 60;
function arrivalsOf(state) {
  var out = [], mine = state.stack.stopWatch;
  PA.list(state.telegraph).forEach(function (src) {
    var offset = mine - src.stopWatch;
    PA.list(src.transit).forEach(function (t) {
      PA.list(t.garbage).forEach(function (g) { out.push({ at: t.at + offset, g: g }); });
    });
    var staged = PA.list(src.staged), ship = src.stopWatch;
    for (var i = staged.length - 1; i >= 0; i--) {
      var g = staged[i];
      if (g.isChain && !g.finalized) break;
      ship = Math.max(ship, g.frameEarned + STAGING);
      out.push({ at: ship + LAND + offset, g: g });
    }
  });
  return out.sort(function (x, y) { return x.at - y.at; });
}
// Garbage due on the frame just reached, received as the server receives it.
function land(st, arrivals) {
  for (var i = 0; i < arrivals.length; i++) if (arrivals[i].at === st.stopWatch) st.receiveGarbage([arrivals[i].g]);
}
// The same, as the search takes it: frames from this board (search.h
// runFrame), at most MAXARR.
function arrivalsFrom(board, arrivals) {
  var out = [];
  arrivals.forEach(function (a) {
    if (a.at > board.stopWatch) out.push({ at: a.at - board.stopWatch, width: a.g.width, height: a.g.height, isChain: !!a.g.isChain, isMetal: !!a.g.isMetal });
  });
  return out.slice(0, 16);
}

// THE THREAT: garbage not yet in any telegraph cannot land sooner than
// STAGING + LAND frames from now. The profile's `threat` ({ width, height,
// isChain }, or null) is a piece assumed to land then, so the survival
// search keeps room for what could still be sent. `lead`: how far the board
// asked about is ahead of now.
function threat(p, lead) {
  if (!p.threat) return null;
  return { at: Math.max(1, STAGING + LAND - lead), width: p.threat.width, height: p.threat.height, isChain: !!p.threat.isChain, isMetal: false };
}

// ---------------------------------------------------------------- breaking garbage
// The moves from `board` that break garbage soonest, played on the server's
// rules (search S, native.js server Search): the swaps whose own step
// breaks a row; failing those, the first moves (swaps and a hold) after
// which one swap does; failing those, after which two do -- the last swap
// only where a match can touch garbage, the rows under its lowest. Returns
// { depth, moves } (keys "row,col" or "hold"), depth 0 for none.
function lowestGarbageRow(board) {
  for (var r = 1; r < board.panels.length; r++) {
    var row = board.panels[r];
    if (row) for (var c = 1; c <= 6; c++) if (row[c] && row[c].isGarbage) return r;
  }
  return 0;
}
var BREAK_BUDGET = 2500;   // steps past the first level: the search stops there
function breakMoves(S, board, hold, arrivals, maxDepth) {
  maxDepth = maxDepth || 3;
  var g = lowestGarbageRow(board);
  if (!g) return { depth: 0, moves: {} };
  S.reset();
  var root = S.root(board.copy(), hold, arrivals, false), base = S.breaks(root), i, j, k, steps = 0;
  function breaks(n) { return n && !n.dead && S.breaks(n) > base; }
  function swapsOf(n, near) {
    var ms = n.b.legalSwaps();
    return near ? ms.filter(function (m) { return m[0] >= g - 3 && m[0] <= g + 1; }) : ms;
  }
  var firsts = swapsOf(root).map(function (m) { return { key: m[0] + ',' + m[1], m: m }; }), found = {}, any = false;
  firsts.forEach(function (f) { f.n = S.advance(root, 'swap', f.m, 0); if (breaks(f.n)) { found[f.key] = true; any = true; } });
  if (any) return { depth: 1, moves: found };
  if (maxDepth < 2) return { depth: 0, moves: {} };
  firsts.push({ key: 'hold', n: S.advance(root, 'hold', null, 0) });
  var live = firsts.filter(function (f) { return f.n && !f.n.dead; });
  live.forEach(function (f) {
    if (steps >= BREAK_BUDGET) { f.seconds = []; return; }
    f.seconds = swapsOf(f.n).map(function (m) { steps++; return S.advance(f.n, 'swap', m, 0); });
    if (f.seconds.some(breaks)) { found[f.key] = true; any = true; }
  });
  if (any) return { depth: 2, moves: found };
  if (maxDepth < 3) return { depth: 0, moves: {} };
  for (i = 0; i < live.length && steps < BREAK_BUDGET; i++) {
    var f = live[i];
    for (j = 0; j < f.seconds.length && !found[f.key] && steps < BREAK_BUDGET; j++) {
      var n2 = f.seconds[j];
      if (!n2 || n2.dead) continue;
      var thirds = swapsOf(n2, true);
      for (k = 0; k < thirds.length; k++) { steps++; if (breaks(S.advance(n2, 'swap', thirds[k], 0))) { found[f.key] = true; any = true; break; } }
    }
  }
  return { depth: any ? 3 : 0, moves: found };
}

// ---------------------------------------------------------------- the hands
// Hands(p): keys(board, hold, kind, move, arrivals) is the decision played
// from `board` as { inputs, holds } per frame, or null when it is refused.
// idle(board, hold) is a frame with nothing decided: the raise in hand goes
// on being held.
function Hands(p) {
  this.S = new (require(path.join(__dirname, 'native.js')).server.Search)({ reaction: p.reaction, cursorMoveFrames: p.cursorMoveFrames, threads: 1 });
}
Hands.prototype.keys = function (board, hold, kind, move, arrivals, frames) {
  this.S.reset();
  var root = this.S.root(board.copy(), hold, arrivalsFrom(board, arrivals), false);
  return this.S.keys(root, kind, move, frames || 0);
};
Hands.prototype.idle = function (board, hold, arrivals) {
  if (!hold.left) return { bits: 0, hold: hold };
  var k = this.keys(board, hold, 'long', null, arrivals, 1);
  return { bits: k.inputs[0], hold: k.holds[0] };
};

module.exports = { profile: profile, botOptions: botOptions, arrivalsOf: arrivalsOf, land: land, arrivalsFrom: arrivalsFrom, threat: threat, breakMoves: breakMoves, Hands: Hands };
