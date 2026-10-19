// WASMSURVIVOR's parts that survivor.js (the frame loop) and survivor_mind.js
// (the search) both use, so each lives once: the profile, the garbage on its
// way, and the bot's hands -- which are search.h's own walk (native/pa.c
// ns_keys), so the keys pressed are the ones the search played.
var fs = require('fs'), path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));

// ---------------------------------------------------------------- the profile
// survivor.profile.json: the weights and the switches they play under, and
// how far ahead (frames) the frame loop may ask for a decision.
// GC_SURVIVOR_PROFILE names another file.
function profile() {
  var file = process.env.GC_SURVIVOR_PROFILE || path.join(__dirname, 'survivor.profile.json');
  // (base: another profile, relative to this one's folder, that this one changes -- its keys over the base's, an object key merged a
  // level; a base may have a base of its own)
  var read = function (f, depth) {
    var own = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!own.base) return own;
    if (depth > 8) throw new Error('survivor profile ' + file + ': bases nested past 8');
    var b = read(path.resolve(path.dirname(f), own.base), depth + 1), q = Object.assign({}, b);
    Object.keys(own).forEach(function (k) { q[k] = own[k] && typeof own[k] === 'object' && !Array.isArray(own[k]) && b[k] && typeof b[k] === 'object' ? Object.assign({}, b[k], own[k]) : own[k]; });
    delete q.base;
    return q;
  };
  var p = read(file, 0);
  // (a Gambit profile decides by its own rules: it has no modes)
  ['name', 'weights', 'reaction', 'cursorMoveFrames', 'depth', 'ahead'].concat(p.gambit ? [] : ['modes']).forEach(function (k) {
    if (p[k] === undefined) throw new Error('survivor profile ' + file + ': no ' + k);
  });
  if (p.name.length > 16) throw new Error('survivor profile: name "' + p.name + '" is over the server\'s 16 characters');
  return p;
}
// THE CURSOR WALKS AS LITTLE AS IT CAN. Its walk always costs at least
// TRAVEL_FLOOR (a travelCost below it is raised to it, in every weight set
// loaded), so no weight set treats a long walk as a good thing; and of moves
// the rules rank the same, the nearest is played (PuyoCpu nearestFirst).
// Neither is a profile switch.
var TRAVEL_FLOOR = 60;
function floorTravel(w) {
  if ((w.travelCost || 0) >= TRAVEL_FLOOR) return w;
  w = Object.assign({}, w); w.travelCost = TRAVEL_FLOOR;
  return w;
}
// What PuyoCpu is built with for a profile.
function botOptions(p, threads) {
  var weights = JSON.parse(fs.readFileSync(path.join(__dirname, p.weights), 'utf8')).weights;
  // overrides: weights set by the profile over the trained ones.
  Object.keys(p.overrides || {}).forEach(function (k) {
    if (!(k in weights)) throw new Error('survivor profile: override ' + k + ' is not a weight');
    weights[k] = p.overrides[k];
  });
  weights = floorTravel(weights);
  var goal = {};
  if (p.goal) goal.goal = p.goal;
  if (p.alsoTake !== undefined) goal.alsoTake = p.alsoTake;
  if (p.buildToward !== undefined) goal.buildToward = p.buildToward;
  return Object.assign(goal, { weights: weights,
           reaction: p.reaction, swapGap: p.swapGap, cursorMoveFrames: p.cursorMoveFrames, depth: p.depth, beam: 0, rise: true, allowRaise: true,
           modes: p.modes, engine: true, native: true, nativeCands: !!p.nativeCands, threesLast: !!p.threesLast, threeBreaksLast: !!p.threeBreaksLast, threesOnlyTopped: !!(p.attack && p.attack.threesOnlyTopped), attackFirst: !!(p.attack && p.attack.attackRank), nearestFirst: true, threads: threads,
           // (a Gambit bot's survival search judges a raise by whether the board lives, as every move: no rule of its own for the raise)
           refuseBrokeRaise: p.gambit ? false : undefined });
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
function land(st, pend, hold) {
  var first = Infinity, i;
  for (i = 0; i < pend.length; i++) if (pend[i].capped && pend[i].at <= st.stopWatch && pend[i].at < first) first = pend[i].at;
  var open = first < Infinity && (st.incoming || []).length < CAP;
  for (i = 0; i < pend.length; i++) {
    var a = pend[i];
    if (a.at > st.stopWatch || (a.capped && !(open && a.at === first)) || (hold && hold(a))) continue;
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
    out.push({ at: Math.max(1, r), width: a.g.width, height: a.g.height, isChain: !!a.g.isChain, isMetal: !!a.g.isMetal, capped: !!a.capped, held: !!(a.g.isChain && a.g.finalized === false) });
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
// A BOARD'S PLACE, as a dig reads it: every panel's colour and garbage, row by row -- the same panels in the same places are the
// same board, whatever the timers. boardAfter(board, move): the place the swap leaves once its panels have swapped
function boardKey(board) {
  var k = '';
  for (var r = 1; r < board.panels.length; r++) {
    var row = board.panels[r]; if (!row) continue;
    for (var c = 1; c <= 6; c++) { var p = row[c]; k += p ? (p.isGarbage ? 'G' : String(p.color || 0)) : '.'; }
    k += '|';
  }
  return k;
}
function boardAfter(board, mv) {
  var b = board.copy();
  b.curRow = mv[0]; b.curCol = mv[1];
  if (b.tryQueueSwap(mv[0], mv[1])) for (var f = 0; f < 6; f++) b.run();
  return boardKey(b);
}
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
var TOUCH_DEPTH = 8, TOUCH_BEAM = 30, TOUCH_WIDER = [100];
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
// HOW MANY SWAPS AWAY THE NEAREST BREAK IS: the fewest swaps that line up a match of three with a panel touching garbage (above, below
// or beside it) -- each other panel of the match brought along its own row, one swap a column, over cells that hold it up and are not
// garbage. Infinity when no match is in reach that way. grid: rows 0 (coming up) to the top, columns 1-6; >0 a colour, <0 garbage.
function breakNear(grid) {
  var top = grid.length - 2, best = Infinity, r, c;
  var cell = function (q, k) { return q >= 1 && q <= top && grid[q] ? grid[q][k] : 0; };
  var held = function (q, k) { return cell(q, k) >= 0 && (q === 1 || cell(q - 1, k) !== 0); };
  // the swaps that bring a panel of colour `want` in row q to column k, not taking any column in `used`
  var bring = function (q, k, want, used) {
    if (cell(q, k) === want && !used[k]) return { d: 0, from: k };
    var out = null;
    for (var dir = -1; dir <= 1; dir += 2) {
      for (var j = k + dir, ok = held(q, k); j >= 1 && j <= 6 && ok; j += dir) {
        if (cell(q, j) === want && !used[j]) { if (!out || Math.abs(j - k) < out.d) out = { d: Math.abs(j - k), from: j }; break; }
        if (!held(q, j)) ok = false;
      }
    }
    return out;
  };
  for (r = 1; r <= top; r++) for (c = 1; c <= 6; c++) {
    var k = cell(r, c);
    if (!(k > 0) || !(cell(r + 1, c) < 0 || cell(r - 1, c) < 0 || cell(r, c - 1) < 0 || cell(r, c + 1) < 0)) continue;
    // a column of three through it: every other row brings a panel of its colour to this column
    for (var r0 = r - 2; r0 <= r; r0++) {
      if (r0 < 1 || r0 + 2 > top) continue;
      var dv = 0;
      for (var q = r0; q <= r0 + 2 && dv < best; q++) { if (q === r) continue; var b = bring(q, c, k, {}); dv = b ? dv + b.d : Infinity; }
      if (dv < best) best = dv;
    }
    // a row of three through it: two other panels of its colour in its row brought beside it
    for (var c0 = c - 2; c0 <= c; c0++) {
      if (c0 < 1 || c0 + 2 > 6) continue;
      var used = {}, dh = 0;
      used[c] = true;
      for (var t = c0; t <= c0 + 2 && dh < best; t++) { if (t === c) continue; var bh = bring(r, t, k, used); if (bh) { used[bh.from] = true; dh += bh.d; } else dh = Infinity; }
      if (dh < best) best = dh;
    }
  }
  return best;
}
// The break search's beam ranked by how near a break is (breakNear), then by how even the stack under the garbage is
var NEAR_MISS = 20;
function nearScore(grid) { return -1000 * Math.min(NEAR_MISS, breakNear(grid)) - uneven(grid); }
// stop(): the question is no longer wanted; checked between batches, and
// throws what it returns (survivor_think.js: PuyoCpu.ABORTED).
function breakMoves(S, board, hold, arrivals, maxDepth, wait, deadline, stop, keep, opts) {
  maxDepth = maxDepth || 3;
  deadline = deadline || Infinity;
  var g = lowestGarbageRow(board);
  if (!g) return { depth: 0, moves: {} };
  S.reset();
  var root = S.root(board.copy(), hold, arrivals, false), i, j, k, steps = 0, idle = {};
  // A break is one standing still would not have made by the same frame: a
  // popping slab goes on converting whatever is pressed.
  function still(t) { if (!(t in idle)) { var w = t > root.t ? S.advance(root, 'long', null, t - root.t) : root; idle[t] = w ? S.breaks(w) : S.breaks(root); } return idle[t]; }
  // (opts.ok(S, n): the caller's rules for a break -- Gambit's: within the list, played through its settle (attacker.allowed))
  // (opts.stepOk(S, n): the same rules for every step of a line -- a node made from a parent that broke them, or by a step that breaks
  // them, is out (outside[i]), so a break counts only on a line within them from its first swap)
  var stepOk = opts && opts.stepOk, outside = {};
  function mark(steps, outs) {
    if (stepOk) outs.forEach(function (o, q) {
      if (!o || o.dead || !(o._i >= 0)) return;
      var par = steps[q][0], fromRoot = par === root || (par && par._i === root._i);
      // (a line's first swap: not the swap back the judge refuses -- opts.firstOk(move, clears))
      var firstBad = fromRoot && steps[q][1] === 'swap' && opts.firstOk && !opts.firstOk(steps[q][2], S.stepStats(o).cleared > 0 || S.breaks(o) > still(o.t));
      outside[o._i] = !!(par && par._i >= 0 && outside[par._i]) || firstBad || !stepOk(S, o, still);
    });
    return outs;
  }
  // (opts.lineOk(path): the shared line check, asked of the whole line a break was found on -- one the judge would not take is passed
  // over and the search goes on for one it will. Its checks are the search's work: past `deadline` none is asked, so no break is found)
  function breaks(n, path) {
    if (!(n && !n.dead && !(stepOk && outside[n._i]) && (n.brk !== undefined ? n.brk : S.breaks(n)) > still(n.t))) return false;
    if ((opts && (opts.ok || (path && opts.lineOk))) && Date.now() >= deadline) return false;
    return (!opts || !opts.ok || opts.ok(S, n, still)) && (!path || !opts || !opts.lineOk || opts.lineOk(path, false));
  }
  function within(n) { return !(stepOk && n && n._i >= 0 && outside[n._i]); }
  function swapsOf(n, near) {
    var ms = n.b.legalSwaps();
    return near ? ms.filter(function (m) { return m[0] >= g - 3 && m[0] <= g + 1; }) : ms;
  }
  // Steps go to the engine a batch at a time, played on every thread; each is
  // read in the order the one-at-a-time loop would have read it. Past
  // `deadline` the steps not yet played come back null, as lines that are not
  // there; the first swaps (made, below) are always played.
  var BATCH = 64;
  function many(steps, whole) {
    if (!steps.length) return [];
    if (whole) return mark(steps, S.advanceMany(steps, true));
    var got = [];
    for (var b = 0; b < steps.length; b += BATCH) {
      var halt = stop && stop();
      if (halt) throw halt;
      if (Date.now() >= deadline) { while (got.length < steps.length) got.push(null); break; }
      var part = steps.slice(b, b + BATCH);
      got = got.concat(mark(part, S.advanceMany(part, true)));
    }
    return got;
  }
  function swapsFrom(n, ms, whole) { return many(ms.map(function (m) { return [n, 'swap', m, 0]; }), whole); }
  var firsts = swapsOf(root).map(function (m) { return { key: m[0] + ',' + m[1], m: m }; }), found = {}, any = false;
  var toward = null;
  var made = swapsFrom(root, firsts.map(function (f) { return f.m; }), true);
  var at1 = null;
  firsts.forEach(function (f, q) { f.n = made[q]; if (breaks(f.n, [f.m])) { found[f.key] = true; any = true; if (at1 === null || f.n.t - root.t < at1) at1 = f.n.t - root.t; } });
  if (any) return { depth: 1, moves: found, at: at1 };
  // GARBAGE RESTING, NOTHING POPPING: a break sooner rather than later. A
  // beam of lines up to TOUCH_DEPTH swaps, kept by how near the row under the
  // garbage is to a match (touchScore), for as long as `deadline` allows. A
  // line is played on the engine with the stack rising as it does, so one the
  // board would die on before its break is never offered.
  // A LINE BEGUN IS PLAYED ON (keep: the rest of the last decision's touch line, on this board's rows): while every step of it is still
  // legal and it still breaks before the board dies, it is the break -- the beam would find another line each decision and finish none
  if (!(wait > 0) && keep && keep.length) {
    var kn = root, kp = [];
    for (i = 0; i < keep.length && kn && !kn.dead; i++) {
      var km = keep[i], legal = kn.b.legalSwaps().some(function (m) { return m[0] === km[0] && m[1] === km[1]; });
      if (!legal) { kn = null; break; }
      var kst = [[kn, 'swap', km, 0]]; kn = mark(kst, S.advanceMany(kst, true))[0]; kp.push(km);
      if (breaks(kn, kp)) return { depth: 1, moves: (function (o) { o[keep[0][0] + ',' + keep[0][1]] = true; return o; })({}), touch: true, path: kp, kept: true };
    }
  }
  // (how near a break each line's board is, read on the board once what the line cleared has fallen: a clear under the slab lets it
  // down onto more panels, which the board at the swap does not show yet)
  function nearScores(ns) {
    var clearing = [], at = [];
    ns.forEach(function (n, q) { if (S.stepStats && S.stepStats(n).cleared > 0) { clearing.push([n, 'settle', null, 0]); at.push(q); } });
    var settled = clearing.length ? S.advanceMany(clearing, true) : [], out = ns.map(function (n) { return nearScore(n.b.grid); });
    at.forEach(function (q, i) { var w = settled[i]; if (w && !w.dead) out[q] = Math.max(out[q], nearScore(w.b.grid)); });
    if (S.drop) S.drop(settled.filter(function (w) { return w && !w.dead && w._i >= 0; }));
    return out;
  }
  // THE SEARCH CARRIED ON (opts.resume, opts.keepOut): the lines the last decision's beam was growing, on this board -- the caller has
  // taken off the swap played since and moved their rows by the stack's rise -- are played again, swap by swap within the rules, and
  // join the first swaps as the beam's start, so the search goes on from where it stopped instead of beginning again; a line that now
  // breaks is the break. keepOut.paths gets this beam's best lines, for the next decision to carry on.
  var KEEPN = TOUCH_BEAM, LONGEST = 2 * TOUCH_DEPTH;
  function resumed() {
    var act = ((opts && opts.resume) || []).filter(function (p) { return p.length && p.length < LONGEST; }).map(function (p) { return { p: p, n: root, k: 0 }; }), done = [];
    while (act.length) {
      var st = [], who = [];
      act.forEach(function (a) {
        var mv = a.p[a.k];
        if (a.n.b.legalSwaps().some(function (m) { return m[0] === mv[0] && m[1] === mv[1]; })) { st.push([a.n, 'swap', mv, 0]); who.push(a); }
      });
      var got = many(st, true), next = [];
      got.forEach(function (n, q) {
        var a = who[q];
        if (!n || n.dead || !within(n)) return;
        a.n = n; a.k++;
        if (a.k === a.p.length) done.push({ key: a.p[0][0] + ',' + a.p[0][1], n: n, path: a.p.slice() }); else next.push(a);
      });
      act = next;
    }
    return done;
  }
  // (TOWARDS: the lines toward a break to choose among, best first -- the frontier the beam has grown furthest, which the next decision
  // carries on, then the best line it saw at any depth)
  function towardsOf() {
    var out = (opts && opts.keepOut && opts.keepOut.paths ? opts.keepOut.paths.slice() : []);
    if (toward && toward.path) out.push(toward.path);
    return out.length ? out : null;
  }
  function touchBeam() {
    var seeds = resumed();
    // (what is carried on stays carried until this beam grows past it)
    if (opts && opts.keepOut && seeds.length) opts.keepOut.paths = seeds.slice(0, KEEPN).map(function (x) { return x.path.map(function (mv) { return mv.slice(); }); });
    for (var si = 0; si < seeds.length; si++) if (breaks(seeds[si].n, seeds[si].path)) { found[seeds[si].key] = true; return { depth: 1, moves: found, touch: true, path: seeds[si].path, at: seeds[si].n.t - root.t, carried: true }; }
    var tl0 = seeds.concat(firsts.filter(function (f) { return f.n && !f.n.dead && within(f.n); }).map(function (f) { return { key: f.key, n: f.n, path: [f.m] }; })), tpath = null, tat = null;
    // TOUCH_BEAM first; finding nothing, wider (TOUCH_WIDER) while time is left.
    for (var tb = 0; tb < TOUCH_WIDER.length + 1 && !tpath && Date.now() < deadline; tb++) {
      var beam = tb ? TOUCH_WIDER[tb - 1] : TOUCH_BEAM, tl = tl0;
      for (var td = 2; td <= TOUCH_DEPTH && tl.length && !tpath && Date.now() < deadline; td++) {
        var ts = S.touchScores ? S.touchScores(tl.map(function (x) { return x.n; })) : null;
        if (ts && opts && opts.near) ts.score = nearScores(tl.map(function (x) { return x.n; }));
        tl.forEach(function (x, q) { x.s = ts ? ts.score[q] : opts && opts.near ? nearScore(x.n.b.grid) : touchScore(x.n.b.grid); x.h = ts ? ts.hash[q] : 0; });
        tl.sort(function (a, b) { return b.s - a.s; });
        // (the line nearest a break the beam has seen: TOWARD, returned when no break is found, the swaps that build toward one)
        if (tl.length && (!toward || tl[0].s > toward.s)) toward = { s: tl[0].s, path: tl[0].path };
        if (opts && opts.keepOut && tl.length) opts.keepOut.paths = tl.slice(0, KEEPN).filter(function (x) { return x.path.length < LONGEST; }).map(function (x) { return x.path.map(function (mv) { return mv.slice(); }); });
        // Swaps made in another order often leave the same board: each board
        // is kept once, its best-scoring line. Equal boards have equal hashes,
        // so only boards whose hashes meet are told apart by key.
        var kept = [], boards = {}, byHash = {};
        for (i = 0; i < tl.length && kept.length < beam; i++) {
          var x = tl[i];
          if (!ts) { var bk = x.n.b.key; if (boards[bk]) continue; boards[bk] = true; kept.push(x); continue; }
          var list = byHash[x.h];
          if (list) {
            var xk = x.n.b.key, dup = false;
            for (k = 0; k < list.length && !dup; k++) dup = list[k].n.b.key === xk;
            if (dup) continue;
            list.push(x);
          } else byHash[x.h] = [x];
          kept.push(x);
        }
        kept.forEach(function (x) { x.kept = true; });
        // the lines the beam lets go are never read again: their boards go
        var first = tl === tl0;   // the first swaps' boards stay: every beam starts from them
        if (S.drop && !first) S.drop(tl.filter(function (x) { return !x.kept; }).map(function (x) { return x.n; }));
        tl = kept;
        // The level's swaps in one batch, read in the order the beam keeps.
        var tms = tl.map(function (x) { return swapsOf(x.n); }), all = [], tn = [];
        tl.forEach(function (x, q) { tms[q].forEach(function (m) { all.push([x.n, 'swap', m, 0]); }); });
        var made = many(all), at = 0;
        for (i = 0; i < tl.length && !tpath; i++) {
          for (j = 0; j < tms[i].length; j++) {
            var t3 = made[at + j];
            if (!t3 || t3.dead) continue;
            var tp = tl[i].path.concat([tms[i][j]]);
            if (breaks(t3, tp)) { found[tl[i].key] = true; any = true; tpath = tp; tat = t3.t - root.t; break; }
            if (within(t3)) tn.push({ key: tl[i].key, n: t3, path: tp });
          }
          at += tms[i].length;
        }
        // and the level expanded: its boards are its children's now -- the frontier the next decision carries on, in its parents' order
        if (opts && opts.keepOut && tn.length) opts.keepOut.paths = tn.slice(0, KEEPN).filter(function (x) { return x.path.length < LONGEST; }).map(function (x) { return x.path.map(function (mv) { return mv.slice(); }); });
        if (S.drop && !first) S.drop(tl.map(function (x) { return x.n; }));
        tl = tn;
      }
    }
    // (wide: the beam the break was found in -- 0 TOUCH_BEAM, then TOUCH_WIDER's)
    if (any) return { depth: 1, moves: found, touch: true, path: tpath, at: tat, wide: tb - 1 };
    return null;
  }
  if (!(wait > 0)) { var tb0 = touchBeam(); if (tb0) return tb0; }
  var waited0 = wait > 0 ? S.advance(root, 'long', null, wait) : null;
  if (waited0 && waited0._i >= 0) delete outside[waited0._i];   // (made from the root: within the rules so far)
  if (wait > 0 && !breaks(waited0)) {
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
    // Each parent's swaps in turn, as many as `cap` tries leave, till one of
    // them hits (hitsOf, of the nodes made): a hit marks the parent's first
    // move and the next parent goes on. Played a batch at a time from the
    // parent the reading has got to, as if none hits; after a hit the rest
    // is played again, with the tries it left.
    // (a hit is a line of two swaps, the parent's and the one after it: pairOf, the whole line, so it is judged as it will be pressed)
    var pairOf = {};
    function inTurn(parents, cap, hitsOf) {
      var k = 0;
      while (k < parents.length && tries < cap) {
        var plan = [], left = cap - tries, st = [], at = 0, again = false;
        for (var q = k; q < parents.length && left > 0; q++) { var mq = swapsOf(parents[q].n).slice(0, left); plan.push({ q: q, ms: mq }); left -= mq.length; }
        plan.forEach(function (p) { p.ms.forEach(function (m) { st.push([parents[p.q].n, 'swap', m, 0]); }); });
        var hit = hitsOf(many(st));
        for (var x = 0; x < plan.length && !again; x++) {
          var p = plan[x];
          k = p.q + 1;
          for (j = 0; j < p.ms.length && tries < cap; j++) { tries++; if (hit[at + j]) { found[parents[p.q].key] = true; pairOf[parents[p.q].key] = [parents[p.q].m, p.ms[j]]; any = true; again = true; break; } }
          at += p.ms.length;
        }
        if (!again) break;
      }
    }
    inTurn(firsts.filter(function (f) { return f.n && !f.n.dead && f.n.t < end; }), LINEUP_BUDGET,
           function (n2s) { return linedAll(n2s.map(function (n2) { return n2 && n2.t < end ? n2 : null; })); });
    if (any) return { depth: 1, moves: found, lineup: 2, lines: pairOf };
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
        // the level's swaps in one batch and their waits to the pop's end in
        // another, read in the order the beam keeps
        var next = [], ms2s = level.map(function (x) { return swapsOf(x.n); }), all2 = [];
        level.forEach(function (x, q) { ms2s[q].forEach(function (m) { all2.push([x.n, 'swap', m, 0]); }); });
        var n3s = many(all2), scs = n3s.map(function (n3) { return !n3 || n3.dead || n3.t >= end ? -1 : pairs(n3.b.grid, want); });
        var l3 = linedAll(n3s.map(function (n3, q) { return scs[q] >= PAIR ? n3 : null; })), at3 = 0;
        for (i = 0; i < level.length && !path; i++) {
          for (j = 0; j < ms2s[i].length; j++) {
            var q3 = at3 + j, n3 = n3s[q3];
            if (scs[q3] < 0) continue;
            var sc = scs[q3], p3 = level[i].path.concat([ms2s[i][j]]);
            if (l3[q3]) { found[level[i].key] = true; any = true; path = p3; break; }
            next.push({ key: level[i].key, n: n3, s: sc, path: p3 });
          }
          at3 += ms2s[i].length;
        }
        level = next;
      }
      if (any) return { depth: 1, moves: found, lineup: 'aimed', path: path };
    }
    // failing that, a first swap leaving a break one swap away once the board has settled from it (the pop over, its panels down) -- the
    // second swap pressed when the frame loop would press it, as the judge plays a settled line
    if (tries < 2 * LINEUP_BUDGET) {
      var rs = firsts.filter(function (f) { return f.n && !f.n.dead; }), ws = many(rs.map(function (f) { return [f.n, 'settle', null, 0]; }));
      inTurn(rs.map(function (f, q) { return { key: f.key, n: ws[q], m: f.m }; }).filter(function (x) { return x.n && !x.n.dead; }), 2 * LINEUP_BUDGET,
             function (wn) { return wn.map(function (n) { return breaks(n); }); });
    }
    if (any) return { depth: 1, moves: found, lineup: 'ready', lines: pairOf };
  }
  // (opts.touchInPop: no line-up of the popping slab breaks again -- a break of the garbage elsewhere while it pops, the cursor being free)
  if (wait > 0 && opts && opts.touchInPop) { var tb1 = touchBeam(); if (tb1) return tb1; }
  if (maxDepth < 2) return { depth: 0, moves: {}, toward: toward ? toward.path : null, towards: towardsOf() };
  var held0 = S.advance(root, 'hold', null, 0);
  if (held0 && held0._i >= 0) delete outside[held0._i];
  firsts.push({ key: 'hold', n: held0 });
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
  if (maxDepth < 3) return { depth: 0, moves: {}, toward: toward ? toward.path : null, towards: towardsOf() };
  for (i = 0; i < live.length && steps < BREAK_BUDGET; i++) {
    var f = live[i];
    for (j = 0; j < f.seconds.length && !found[f.key] && steps < BREAK_BUDGET; j++) {
      var n2 = f.seconds[j];
      if (!n2 || n2.dead) continue;
      var thirds = swapsOf(n2, true), n3m = swapsFrom(n2, thirds);
      for (k = 0; k < thirds.length; k++) { steps++; if (breaks(n3m[k])) { found[f.key] = true; any = true; break; } }
    }
  }
  return { depth: any ? 3 : 0, moves: found, toward: !any && toward ? toward.path : null, towards: any ? null : towardsOf() };
}


// PANELS UP TO THE ROOM ARE KEPT, PAST IT SPENT. A pop turns the bottom row
// of every piece it holds into panels, so the stack it leaves is the panels
// there now and those cells (convertingOf). Up to ROOM panels (eight rows)
// each is worth 100; past it each costs 200, so a pop about to bury the stack
// is met by clearing. A drill of one-row pieces converts them all at once.
var ROOM = 48;
function convertingOf(board) {
  var n = 0;
  board.panels.forEach(function (row) { if (row) for (var c = 1; c <= 6; c++) { var p = row[c]; if (p && p.isGarbage && p.state === 'matched' && p.yOffset === -1) n++; } });
  return n;
}
function keepRank(b, converting) {
  var total = panelsOf(b) + (converting || 0);
  return -100 * Math.min(total, ROOM) + 200 * Math.max(0, total - ROOM);
}
function panelsOf(b) {
  var n = 0;
  if (b && b.grid) for (var r = 1; r < b.grid.length; r++) { var row = b.grid[r]; if (row) for (var c = 1; c <= b.width; c++) if (row[c] > 0) n++; }
  return n;
}

// ---------------------------------------------------------------- the hands
// Hands(p): keys(board, hold, kind, move, arrivals) is the decision played
// from `board` as { inputs, holds } per frame, or null when it is refused.
// idle(board, hold) is a frame with nothing decided: the raise in hand goes
// on being held.
function Hands(p) {
  var N = require(path.join(__dirname, 'native.js')).server;
  this.through = !!(p.attack && p.attack.holdThrough);
  if (this.through) N.holdThrough();
  this.S = new N.Search({ reaction: p.reaction, swapGap: p.swapGap, cursorMoveFrames: p.cursorMoveFrames, threads: 1 });
}
Hands.prototype.keys = function (board, hold, kind, move, arrivals, frames) {
  this.S.reset();
  var root = this.S.root(board, hold, arrivalsFrom(board, arrivals), false), k = this.S.keys(root, kind, move, frames || 0);
  this.S.reset();   // nothing of the board is held till the next call
  return k;
};
// The held raise's frame is the search's own rule (search.h raiseStep), read off the board as it stands: no search is built
// for it, so a frame with nothing decided costs the frame loop nothing.
Hands.prototype.idle = function (board, hold) {
  if (!hold.left) return { bits: 0, hold: hold };
  var started = hold.started || !!board.manualRaise;
  if (this.through ? (board.preventManualRaise && !started) : (board.preventManualRaise || (started && !board.manualRaise))) return { bits: 0, hold: { left: 0, started: started } };
  return { bits: PA.IN.raise, hold: { left: hold.left - 1, started: started } };
};
// The same frame as the search plays it, for the test that holds idle to it.
Hands.prototype.idleSearched = function (board, hold, arrivals) {
  if (!hold.left) return { bits: 0, hold: hold };
  var k = this.keys(board, hold, 'long', null, arrivals, 1);
  return { bits: k.inputs[0], hold: k.holds[0] };
};

module.exports = { touchScore: touchScore, breakNear: breakNear, nearScore: nearScore, profile: profile, botOptions: botOptions, floorTravel: floorTravel, TRAVEL_FLOOR: TRAVEL_FLOOR, arrivalsOf: arrivalsOf, unforeseen: unforeseen, land: land, pending: pending, arrivalsFrom: arrivalsFrom, threat: threat, top: top, gridTop: gridTop, popLeft: popLeft, lowestGarbageRow: lowestGarbageRow, boardKey: boardKey, boardAfter: boardAfter, breakMoves: breakMoves, Hands: Hands, convertingOf: convertingOf, keepRank: keepRank, panelsOf: panelsOf, ROOM: ROOM, CAP: CAP };
