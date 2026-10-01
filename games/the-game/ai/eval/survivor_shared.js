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
// first (the end of the list), none before the one ahead of it. A chain
// still going ships once it ends, which can be the next frame, at the
// height it has now or taller: it is counted at that height, at the
// soonest it can land, and so is everything behind it.
var STAGING = 45 + 45 + 1, LAND = 60;
function arrivalsOf(state) {
  var out = [], mine = state.stack.stopWatch;
  PA.list(state.telegraph).forEach(function (src) {
    var offset = mine - src.stopWatch;
    // Garbage due already but not on the board is held back (an attack
    // engine's waits while 72 are queued: GarbageDelivery): it lands next
    // frame at the soonest. An attack engine's is let in a batch a frame, so
    // each of its batches is due a frame after the one ahead of it.
    var capped = !!src.capped, floor = mine + 1, last = null, lastAt = 0;
    function due(at, batch) {
      if (batch !== last) { last = batch; lastAt = Math.max(at, floor); if (capped) floor = lastAt + 1; }
      return lastAt;
    }
    PA.list(src.transit).forEach(function (t) {
      var at = due(t.at + offset, 't' + t.at);
      PA.list(t.garbage).forEach(function (g) { out.push({ at: at, g: g, capped: capped }); });
    });
    var staged = PA.list(src.staged), ship = src.stopWatch;
    if (!capped) floor = -Infinity;
    for (var i = staged.length - 1; i >= 0; i--) {
      var g = staged[i];
      ship = Math.max(ship, g.frameEarned + STAGING, g.isChain && !g.finalized ? src.stopWatch + 1 : 0);
      out.push({ at: due(ship + LAND + offset, 's' + ship), g: g, capped: capped });
    }
  });
  return out.sort(function (x, y) { return x.at - y.at; });
}
// The garbage of `now` that a decision made knowing `knew` did not count on:
// each piece of `knew` accounts for one no bigger, due no sooner.
function unforeseen(knew, now) {
  var used = [];
  return now.filter(function (a) {
    for (var i = 0; i < knew.length; i++) {
      var b = knew[i];
      if (!used[i] && b.at <= a.at && b.g.width === a.g.width && b.g.height >= a.g.height &&
          !!b.g.isChain === !!a.g.isChain && !!b.g.isMetal === !!a.g.isMetal) { used[i] = true; return false; }
    }
    return true;
  });
}
// Garbage due by the frame just reached, received as the server receives it:
// an attack engine's (capped) only while fewer than CAP are queued, the
// earliest due of it a frame (search.h runFrame does the same). `pend` is
// the caller's own copy (pending()): what lands is taken out of it.
var CAP = 72;
function pending(arrivals) { return arrivals.map(function (a) { return { at: a.at, g: a.g, capped: !!a.capped }; }); }
function land(st, pend) {
  var first = Infinity, i;
  for (i = 0; i < pend.length; i++) if (pend[i].capped && pend[i].at <= st.stopWatch && pend[i].at < first) first = pend[i].at;
  var open = first < Infinity && (st.incoming || []).length < CAP;
  for (i = 0; i < pend.length; i++) {
    var a = pend[i];
    if (a.at > st.stopWatch || (a.capped && !(open && a.at === first))) continue;
    st.receiveGarbage([a.g]); pend.splice(i--, 1);
  }
}
// The same, as the search takes it: frames from this board (search.h
// runFrame), at most MAXARR (native/search.h).
function arrivalsFrom(board, arrivals) {
  var out = [], rel = 0, prev = null;
  // A capped piece already due is still held: it lands next frame at the
  // soonest, and each batch held a frame after the one ahead of it.
  arrivals.forEach(function (a) {
    if (a.at <= board.stopWatch && !a.capped) return;
    var r = a.at - board.stopWatch;
    if (a.capped) { r = a.at === prev ? rel : Math.max(r, rel + 1); rel = r; prev = a.at; }
    out.push({ at: Math.max(1, r), width: a.g.width, height: a.g.height, isChain: !!a.g.isChain, isMetal: !!a.g.isMetal, capped: !!a.capped });
  });
  return out.slice(0, 64);
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
// The highest row holding anything, on the server's board (top) and on a
// panel-engine board's grid (gridTop: 0 is empty).
function top(board) {
  for (var r = board.panels.length - 1; r >= 1; r--) {
    var row = board.panels[r];
    if (row) for (var c = 1; c <= 6; c++) if (row[c] && row[c].color) return r;
  }
  return 0;
}
function gridTop(b) {
  for (var r = b.grid.length - 1; r >= 1; r--) {
    var row = b.grid[r];
    if (row) for (var c = 1; c <= b.width; c++) if (row[c]) return r;
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

module.exports = { profile: profile, botOptions: botOptions, arrivalsOf: arrivalsOf, unforeseen: unforeseen, land: land, pending: pending, arrivalsFrom: arrivalsFrom, threat: threat, top: top, gridTop: gridTop, breakMoves: breakMoves, Hands: Hands };
