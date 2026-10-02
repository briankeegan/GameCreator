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
           reaction: p.reaction, swapGap: p.swapGap, cursorMoveFrames: p.cursorMoveFrames, depth: p.depth, beam: 0, rise: true, allowRaise: true,
           modes: p.modes, engine: true, native: true, nativeCands: !!p.nativeCands, threads: threads };
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
var LINEUP_BUDGET = 400;   // pairs of swaps tried for a lineup
var LINEUP_DEPTH = 8, LINEUP_BEAM = 8;   // the aimed lineup's swaps and lines kept
// LINING UP: while a broken slab pops (popLeft, frames) its new row cannot
// move, but what is under it can; once the pop ends the row matches what it
// rests on, and a match there touches the slab again. A first swap after
// which waiting `wait` frames breaks garbage is a break at depth 1.
function popLeft(board) {
  var t = 0;
  board.panels.forEach(function (row) { if (row) for (var c = 1; c <= 6; c++) { var p = row[c]; if (p && p.isGarbage && p.state === 'matched' && p.timer > t) t = p.timer; } });
  return t;
}
// The colours the row a popping slab converts has dealt, per column (0
// where none), from the board as the game shows it; null when none is known.
function converting(board) {
  for (var r = 1; r < board.panels.length; r++) {
    var row = board.panels[r], out = [0], any = false;
    if (!row) continue;
    for (var c = 1; c <= 6; c++) { var p = row[c]; if (p && p.isGarbage && p.state === 'matched' && p.color >= 1 && p.color <= 8) { out[c] = p.color; any = true; } else out[c] = 0; }
    if (any) return out;
  }
  return null;
}
// How far a grid is toward lining up with `want`: per column, its top panel
// below the lowest garbage of that colour, and the one under it too.
var PAIR = 5;
function pairs(grid, want) {
  var G = grid.length, r, c, s = 0;
  for (r = 1; r < grid.length && G === grid.length; r++) if (grid[r]) for (c = 1; c <= 6; c++) if (grid[r][c] < 0) { G = r; break; }
  for (c = 1; c <= 6; c++) {
    if (!want[c]) continue;
    var t = 0;
    for (r = 1; r < G; r++) if (grid[r] && grid[r][c] > 0) t = r;
    if (t && grid[t][c] === want[c]) s += t > 1 && grid[t - 1][c] === want[c] ? PAIR : 1;
  }
  return s;
}
// How near the row under the lowest garbage is to a match touching it: per
// column resting on the garbage, a pair standing under it and a pair beside it
// in that row; less how uneven the stack under it is.
var TOUCH_DEPTH = 8, TOUCH_BEAM = 30;
// How uneven the stack under the lowest garbage is: each column's shortfall
// from the tallest, squared, so a panel moved from a tall column into a well
// counts though the tallest stays as it was. Garbage rests on the tallest column, so a well is a
// column the next slab cannot be touched from.
function uneven(grid) {
  var G = grid.length, r, c, hi = 0, tops = [], u = 0;
  for (r = 1; r < grid.length && G === grid.length; r++) if (grid[r]) for (c = 1; c <= 6; c++) if (grid[r][c] < 0) { G = r; break; }
  for (c = 1; c <= 6; c++) { var t = 0; for (r = 1; r < G; r++) if (grid[r] && grid[r][c] > 0) t = r; tops.push(t); if (t > hi) hi = t; }
  tops.forEach(function (t) { u += (hi - t) * (hi - t); });
  return u;
}
function touchScore(grid) {
  var G = 0, r, c, top = [0], s = 0;
  for (r = 1; r < grid.length && !G; r++) if (grid[r]) for (c = 1; c <= 6; c++) if (grid[r][c] < 0) { G = r; break; }
  if (!G) return 0;
  for (c = 1; c <= 6; c++) { var t = 0; for (r = 1; r < G; r++) if (grid[r] && grid[r][c] > 0) t = r; top[c] = t; }
  s -= uneven(grid);
  var u = G - 1;
  for (c = 1; c <= 6; c++) {
    if (top[c] !== u) continue;
    if (u > 1 && grid[u - 1][c] === grid[u][c]) s += 4;
    if (c < 6 && top[c + 1] === u && grid[u][c + 1] === grid[u][c]) s += 3;
  }
  return s;
}
function breakMoves(S, board, hold, arrivals, maxDepth, wait, deadline) {
  maxDepth = maxDepth || 3;
  deadline = deadline || Infinity;
  var g = lowestGarbageRow(board);
  if (!g) return { depth: 0, moves: {} };
  S.reset();
  var root = S.root(board.copy(), hold, arrivals, false), i, j, k, steps = 0, idle = {};
  // A break is one standing still would not have made by the same frame: a
  // popping slab goes on converting whatever is pressed.
  function still(t) { if (!(t in idle)) { var w = t > root.t ? S.advance(root, 'long', null, t - root.t) : root; idle[t] = w ? S.breaks(w) : S.breaks(root); } return idle[t]; }
  function breaks(n) { return n && !n.dead && S.breaks(n) > still(n.t); }
  function swapsOf(n, near) {
    var ms = n.b.legalSwaps();
    return near ? ms.filter(function (m) { return m[0] >= g - 3 && m[0] <= g + 1; }) : ms;
  }
  // Steps go to the engine a batch at a time, played on every thread; each is
  // read in the order the one-at-a-time loop would have read it.
  function many(steps) { return steps.length ? S.advanceMany(steps) : []; }
  function swapsFrom(n, ms) { return many(ms.map(function (m) { return [n, 'swap', m, 0]; })); }
  var firsts = swapsOf(root).map(function (m) { return { key: m[0] + ',' + m[1], m: m }; }), found = {}, any = false;
  var made = swapsFrom(root, firsts.map(function (f) { return f.m; }));
  firsts.forEach(function (f, q) { f.n = made[q]; if (breaks(f.n)) { found[f.key] = true; any = true; } });
  if (any) return { depth: 1, moves: found };
  // GARBAGE RESTING, NOTHING POPPING: a break sooner rather than later. A
  // beam of lines up to TOUCH_DEPTH swaps, kept by how near the row under the
  // garbage is to a match (touchScore), for as long as `deadline` allows. A
  // line is played on the engine with the stack rising as it does, so one the
  // board would die on before its break is never offered.
  if (!(wait > 0)) {
    var tl = firsts.filter(function (f) { return f.n && !f.n.dead; }).map(function (f) { return { key: f.key, n: f.n, path: [f.m] }; }), tpath = null;
    for (var td = 2; td <= TOUCH_DEPTH && tl.length && !tpath && Date.now() < deadline; td++) {
      tl.forEach(function (x) { x.s = touchScore(x.n.b.grid); });
      tl.sort(function (a, b) { return b.s - a.s; });
      tl = tl.slice(0, TOUCH_BEAM);
      var tn = [];
      for (i = 0; i < tl.length && !tpath && Date.now() < deadline; i++) {
        var tm = swapsOf(tl[i].n), tmade = swapsFrom(tl[i].n, tm);
        for (j = 0; j < tm.length; j++) {
          var t3 = tmade[j];
          if (!t3 || t3.dead) continue;
          var tp = tl[i].path.concat([tm[j]]);
          if (breaks(t3)) { found[tl[i].key] = true; any = true; tpath = tp; break; }
          tn.push({ key: tl[i].key, n: t3, path: tp });
        }
      }
      tl = tn;
    }
    if (any) return { depth: 1, moves: found, touch: true, path: tpath };
  }
  if (wait > 0 && !breaks(S.advance(root, 'long', null, wait))) {
    // till the pop is over, from wherever a line has got to
    var end = root.t + wait;
    // whether each node breaks once the pop is over, all at once
    function linedAll(ns) {
      var at = [], st = [], out = ns.map(function () { return false; });
      ns.forEach(function (n, q) { if (n && !n.dead) { at.push(q); st.push([n, 'long', null, Math.max(1, end - n.t)]); } });
      many(st).forEach(function (w, q) { out[at[q]] = breaks(w); });
      return out;
    }
    linedAll(firsts.map(function (f) { return f.n; })).forEach(function (l, q) { if (l) { found[firsts[q].key] = true; any = true; } });
    if (any) return { depth: 1, moves: found, lineup: true };
    // a pop is long enough for two swaps: the first of a pair that lines up
    var tries = 0;
    for (i = 0; i < firsts.length && tries < LINEUP_BUDGET; i++) {
      var f = firsts[i];
      if (!f.n || f.n.dead || f.n.t >= end) continue;
      var ms = swapsOf(f.n).slice(0, LINEUP_BUDGET - tries), n2s = swapsFrom(f.n, ms);
      var l2 = linedAll(n2s.map(function (n2) { return n2 && n2.t < end ? n2 : null; }));
      for (j = 0; j < ms.length && tries < LINEUP_BUDGET; j++) {
        tries++;
        if (l2[j]) { found[f.key] = true; any = true; break; }
      }
    }
    if (any) return { depth: 1, moves: found, lineup: 2 };
    // Further, aimed: the colours the row turns into are known from the
    // pop's start, and two of a column's colour on top of that column make
    // three with the panel landing there, under the slab. A beam of lines up
    // to LINEUP_DEPTH swaps, kept by how many such pairs they stand up and then
    // how flat they leave the stack, for as
    // long as `deadline` (ms since the epoch) allows; the line found is the
    // path, every swap of it, for the frame loop to play on.
    var want = converting(board);
    if (want) {
      var level = firsts.filter(function (f) { return f.n && !f.n.dead && f.n.t < end; }).map(function (f) { return { key: f.key, n: f.n, path: [f.m] }; }), path = null;
      for (var dpt = 2; dpt <= LINEUP_DEPTH && level.length && !path && Date.now() < deadline; dpt++) {
        level.forEach(function (x) { x.s = 10 * pairs(x.n.b.grid, want) - uneven(x.n.b.grid); });
        level.sort(function (a, b) { return b.s - a.s; });
        level = level.slice(0, LINEUP_BEAM);
        var next = [];
        for (i = 0; i < level.length && !path && Date.now() < deadline; i++) {
          var ms2 = swapsOf(level[i].n), n3s = swapsFrom(level[i].n, ms2), scs = [];
          n3s.forEach(function (n3, q) { scs[q] = !n3 || n3.dead || n3.t >= end ? -1 : pairs(n3.b.grid, want); });
          var l3 = linedAll(n3s.map(function (n3, q) { return scs[q] >= PAIR ? n3 : null; }));
          for (j = 0; j < ms2.length; j++) {
            var n3 = n3s[j];
            if (scs[j] < 0) continue;
            var sc = scs[j], p3 = level[i].path.concat([ms2[j]]);
            if (l3[j]) { found[level[i].key] = true; any = true; path = p3; break; }
            next.push({ key: level[i].key, n: n3, s: sc, path: p3 });
          }
        }
        level = next;
      }
      if (any) return { depth: 1, moves: found, lineup: 'aimed', path: path };
    }
    // failing that, a first swap leaving a break one swap away when the pop ends
    for (i = 0; i < firsts.length && tries < 2 * LINEUP_BUDGET; i++) {
      var r = firsts[i].n, w = r && !r.dead ? S.advance(r, 'long', null, Math.max(1, end - r.t)) : null;
      if (!w || w.dead) continue;
      var ws = swapsOf(w).slice(0, 2 * LINEUP_BUDGET - tries), wn = swapsFrom(w, ws);
      for (j = 0; j < ws.length && tries < 2 * LINEUP_BUDGET; j++) { tries++; if (breaks(wn[j])) { found[firsts[i].key] = true; any = true; break; } }
    }
    if (any) return { depth: 1, moves: found, lineup: 'ready' };
  }
  if (maxDepth < 2) return { depth: 0, moves: {} };
  firsts.push({ key: 'hold', n: S.advance(root, 'hold', null, 0) });
  var live = firsts.filter(function (f) { return f.n && !f.n.dead; });
  var all = [];
  live.forEach(function (f) {
    if (steps >= BREAK_BUDGET) { f.seconds = []; return; }
    f.ms = swapsOf(f.n); steps += f.ms.length;
    f.ms.forEach(function (m) { all.push([f.n, 'swap', m, 0]); });
  });
  var seconds = many(all), at = 0;
  live.forEach(function (f) {
    if (!f.ms) return;
    f.seconds = seconds.slice(at, at += f.ms.length);
    if (f.seconds.some(breaks)) { found[f.key] = true; any = true; }
  });
  if (any) return { depth: 2, moves: found };
  if (maxDepth < 3) return { depth: 0, moves: {} };
  for (i = 0; i < live.length && steps < BREAK_BUDGET; i++) {
    var f = live[i];
    for (j = 0; j < f.seconds.length && !found[f.key] && steps < BREAK_BUDGET; j++) {
      var n2 = f.seconds[j];
      if (!n2 || n2.dead) continue;
      var thirds = swapsOf(n2, true), n3m = swapsFrom(n2, thirds);
      for (k = 0; k < thirds.length; k++) { steps++; if (breaks(n3m[k])) { found[f.key] = true; any = true; break; } }
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
  this.S = new (require(path.join(__dirname, 'native.js')).server.Search)({ reaction: p.reaction, swapGap: p.swapGap, cursorMoveFrames: p.cursorMoveFrames, threads: 1 });
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

module.exports = { profile: profile, botOptions: botOptions, arrivalsOf: arrivalsOf, unforeseen: unforeseen, land: land, pending: pending, arrivalsFrom: arrivalsFrom, threat: threat, top: top, gridTop: gridTop, popLeft: popLeft, lowestGarbageRow: lowestGarbageRow, breakMoves: breakMoves, Hands: Hands };
