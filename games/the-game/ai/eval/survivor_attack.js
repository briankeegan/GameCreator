// THE ATTACK PLANNER: while the board is safe, the line of swaps to the biggest fire the board can reach.
//
// A beam search on the native engine over swaps that clear nothing, each board ranked by the best fire one
// swap from it; the line ends in the swap that fires the most garbage. plan() returns that line. The caller
// plays its first swap, the rest of the line while the next plan is made, and plans again on the board that
// follows. Used by survivor_think.js for a profile with `attack`.
var path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), N = require(path.join(__dirname, 'native.js')).server;
var W = 6;
// a combo's garbage is a list of widths, one row each (PA.COMBO_GARBAGE)
function comboCells(size) { var n = 0, ps = PA.comboGarbage(size); for (var i = 0; i < ps.length; i++) n += ps[i]; return n; }
// the garbage a step's clears send: each clear's combo garbage and a slab for the chain they make
function sent(stat) {
  var n = 0, chain = 0;
  for (var i = 0; i < stat.comboSizes.length; i++) { n += comboCells(stat.comboSizes[i]); if (stat.chainAt[i] > chain) chain = stat.chainAt[i]; }
  if (chain > 1) n += W * (chain - 1);
  return { cells: n, chain: chain };
}
function connected(grid) {
  var n = 0, r, c;
  for (r = 1; r < grid.length - 1; r++) for (c = 1; c <= W; c++) {
    var k = grid[r][c];
    if (!(k > 0 && k < 8)) continue;
    if (c < W && grid[r][c + 1] === k) n += 1;
    if (r + 1 < grid.length && grid[r + 1][c] === k) n += 2;
  }
  return n;
}
module.exports = function (opts) {
  var S = null;
  function search() {
    if (!S) S = new N.Search({ reaction: opts.reaction, swapGap: opts.swapGap, cursorMoveFrames: opts.cursorMoveFrames, threads: 1 });
    return S;
  }
  // o.aims: a priority list of aims, searched in one beam -- the best line for each aim is kept, and the line returned is the first
  // aim's that has one (best.aimIndex); o.aim is a list of one.
  // o.aim (with o.by): a line counts only when what it makes meets the aim -- aim({ combo, combos, chain, broke, cells }) -- with its
  // last swap's clears done by frame o.by (frames from now), and o.keep(grid) true of the board it ends on; o: { ms, width, depth, pool, stopAt, minChain, guideChain, arrivals, rate }: with rate the fire kept is the best per swap of its line; arrivals is the garbage on its way, as the bot's serverArrivals; only a fire of a chain of minChain links or more counts; boards are ranked by fires of guideChain links or more; stopAt ends the search at the first depth with a fire of that many cells
  // o.near(made): with aims, how near a line comes to them (0: not at all) -- the nearest line is kept beside them (best.nearest),
  // the line to play when none meets an aim in time; and the soonest line that breaks garbage (best.quick).
  function plan(board, hold, o) {
    var s = search(), t0 = Date.now(), best = null, nearest = null, quick = null, aims = o.aims || (o.aim ? [o.aim] : null), perAim = aims ? aims.map(function () { return null; }) : null;
    s.reset();
    var root = s.root(board.copy(), hold, o.arrivals || [], false);
    // a cascade already running sends what it sends whatever is swapped: only what a swap adds to it counts
    var baseOut = s.advanceMany([[root, 'settle', null, 0]], true)[0], base = 0;
    if (baseOut && !baseOut.dead) { var bs = s.stepStats(baseOut); if (bs.cleared > 0) base = sent(bs).cells; }
    var rootH = connected(root.b.grid), setup = null;
    var pool = [{ n: root, seq: [], h: rootH }];
    for (var d = 1; d <= o.depth && pool.length && Date.now() - t0 < o.ms && !(o.stopAt && best && best.cells >= o.stopAt); d++) {
      var jobs = [], meta = [];
      pool.forEach(function (it) { it.n.b.legalSwaps().forEach(function (m) { jobs.push([it.n, 'settle', m, 0]); meta.push([it, m]); }); });
      var outs = s.advanceMany(jobs, true);
      pool.forEach(function (it) { it.reach = 0; it.kids = []; });
      for (var i = 0; i < outs.length; i++) {
        var out = outs[i], it = meta[i][0], m = meta[i][1];
        if (!out || out.dead) continue;
        var st = s.stepStats(out);
        if (st.cleared > 0) {
          var g = sent(st), seq = it.seq.concat([m]);
          var bigC = 0; st.comboSizes.forEach(function (z) { if (z > bigC) bigC = z; });
          if (aims) {
            // (aims: the line is kept for every aim it meets, by its deadline and keeping what o.keep asks; the search goes on past it)
            var made = { combo: bigC, combos: st.comboSizes, chain: g.chain, broke: st.broke || 0, cells: Math.max(0, g.cells - base) };
            var inTime = !(o.by && out.t - root.t > o.by), kept = !(o.keep && !o.keep(out.b.grid));
            // (the soonest line that breaks garbage at all, a plain three included: the last line before the default's own)
            if (o.near && inTime && kept && made.broke > 0 && (!quick || out.t - root.t < quick.done || (out.t - root.t === quick.done && seq.length < quick.seq.length)))
              quick = { near: 0, brk: true, cells: made.cells, chain: g.chain, combo: bigC, seq: seq, n: out, broke: made.broke, done: out.t - root.t, aimIndex: -1 };
            if (o.near && inTime && kept) {
              var nr = o.near(made);
              if (nr > it.reach) it.reach = nr;   // (the beam is led by the list: a board ranks by the nearest line one swap from it)
              if (nr > 0 && (!nearest || nr > nearest.near || (nr === nearest.near && seq.length < nearest.seq.length)))
                nearest = { near: nr, brk: made.broke > 0, cells: made.cells, chain: g.chain, combo: bigC, seq: seq, n: out, broke: made.broke, done: out.t - root.t, aimIndex: -1 };
            }
            if (inTime && kept) for (var ai = 0; ai < aims.length; ai++) {
              if (!aims[ai] || !aims[ai](made)) continue;
              var pa = perAim[ai];
              if (!pa || made.cells > pa.cells || (made.cells === pa.cells && seq.length < pa.seq.length))
                perAim[ai] = { brk: made.broke > 0, cells: made.cells, chain: g.chain, combo: bigC, seq: seq, n: out, broke: made.broke, earned: st.earned || 0, done: out.t - root.t, aimIndex: ai };
            }
            it.kids.push({ n: out, seq: seq });
            continue;
          }
          // a board is ranked by the chain one swap from it (guideChain links or more), the fire kept is minChain links or more
          var shown = Math.max(0, g.cells - base);
          if (g.chain >= (o.guideChain || o.minChain || 0) && shown > it.reach) it.reach = shown;
          g.cells = g.chain >= (o.minChain || 0) ? shown : 0;
          // (breakFirst, garbage on the board: a line that breaks some is kept however little it sends, and ranks before any that breaks none)
          var brk = (o.breakFirst || o.aim) && (st.broke || 0) > 0;
          if (g.cells === 0 && !brk && !o.aim) continue;
          // the fire kept: the most garbage, or with o.rate the most garbage for the time it takes (cells over swaps + rate) -- pressure, not the biggest
          var rated = o.rate ? g.cells / (seq.length + o.rate) : g.cells, bestRated = best ? (o.rate ? best.cells / (best.seq.length + o.rate) : best.cells) : -1;
          var better = !best || (o.breakFirst && brk !== !!best.brk ? brk : rated > bestRated || (rated === bestRated && seq.length < best.seq.length));
          if (better) best = { brk: brk, cells: g.cells, chain: g.chain, combo: bigC, seq: seq, n: out, broke: st.broke || 0, earned: st.earned || 0, done: out.t - root.t };
        } else it.kids.push({ n: out, seq: it.seq.concat([m]) });
      }
      pool.sort(function (a, b) { return b.reach - a.reach || b.h - a.h; });
      var seen = {}, next = [];
      pool.slice(0, o.width).forEach(function (it) {
        it.kids.forEach(function (k) {
          var key = String(k.n.b.key);
          if (seen[key]) return;
          seen[key] = 1;
          next.push({ n: k.n, seq: k.seq, h: connected(k.n.b.grid) });
        });
      });
      next.sort(function (a, b) { return b.h - a.h; });
      var old = pool;
      pool = next.slice(0, o.pool);
      // the most connected board reached so far, if better than the one now: its first swap is a setup -- with o.near, a board
      // nearer the list one swap on comes first (its reach), so the setup is played toward the same list
      if (o.near) old.forEach(function (it) { if (it.seq.length && (it.reach > (setup ? setup.reach || 0 : 0) || (!(setup && setup.reach) && !it.reach && it.h > (setup ? setup.h : rootH)))) setup = { reach: it.reach, h: it.h, move: it.seq[0] }; });
      else if (pool.length && pool[0].h > (setup ? setup.h : rootH)) setup = { h: pool[0].h, move: pool[0].seq[0] };
      var keep = new Set(pool.map(function (it) { return it.n; }));
      if (best) keep.add(best.n);
      if (perAim) perAim.forEach(function (pa) { if (pa) keep.add(pa.n); });
      if (nearest) keep.add(nearest.n);
      if (quick) keep.add(quick.n);
      var spent = outs.filter(function (x) { return x && !x.dead && !keep.has(x); });
      old.forEach(function (it) { if (it.n !== root && !keep.has(it.n)) spent.push(it.n); });
      if (spent.length) s.drop(spent);
    }
    if (perAim) { best = null; for (var fa = 0; fa < perAim.length && !best; fa++) if (perAim[fa]) best = perAim[fa]; }
    if (!best) best = { cells: 0, chain: 0, seq: [], aimIndex: -1 };
    // A LINE THAT RUNS ON: every step of it was played on the engine with the garbage on its way landing at its time, and no
    // step left the board dead (a dead node is never grown), so it is continuous to its end. `continuous` says it also ends
    // with no garbage left on the board, or having broken some -- it gets the board out from under what is on it.
    else if (best.n && best.n.b && best.n.b.grid) {
      var gl = best.n.b.grid, left = false;
      for (var r0 = 1; r0 < gl.length && !left; r0++) for (var c0 = 1; c0 <= W && !left; c0++) if (gl[r0] && gl[r0][c0] >= 8) left = true;
      best.continuous = !!(o.arrivals && (!left || best.broke > 0));
      // ... and the board it ends on, left alone, lives through what is on its way and the survival horizon after it: a line
      // that ends with garbage perched on a tower it cannot break is not a way out
      if (best.continuous && o.horizon) {
        var lastAt = 0;
        (o.arrivals || []).forEach(function (a) { if (a.at > lastAt) lastAt = a.at; });
        var wait = s.advanceMany([[best.n, 'long', null, Math.max(0, lastAt - best.n.t) + o.horizon]], true)[0];
        if (!wait || wait.dead) best.continuous = false;
        if (wait && !wait.dead) s.drop([wait]);
      }
    }
    else { // the lowest peak of the board the fire leaves: the fewest panels any column has
      var ga = best.n && best.n.b && best.n.b.grid, low = 99, rr, cc, pk;
      if (ga) {
        for (cc = 1; cc <= W; cc++) { pk = 0; for (rr = ga.length - 2; rr >= 1 && !pk; rr--) if (ga[rr] && ga[rr][cc] > 0 && ga[rr][cc] < 8) pk = rr; if (pk < low) low = pk; }
        best.after = low;
      } else best.after = 0;
    }
    best.setup = setup ? setup.move : null;
    best.nearest = nearest; best.quick = quick;
    // any swap at all: one that moves nothing that matters is how the rise is let go of (see survivor_think.js, unlock)
    var legal = root.b.legalSwaps(), same = null, g0 = root.b.grid;
    legal.forEach(function (m) { if (!same && g0[m[0]] && g0[m[0]][m[1]] > 0 && g0[m[0]][m[1]] < 8 && g0[m[0]][m[1]] === g0[m[0]][m[1] + 1]) same = m; });
    best.anySwap = same || (legal.length ? legal[0] : null);
    best.base = base;
    best.ms = Date.now() - t0;
    return best;
  }
  // A CHAIN GOING IS CONTINUED: from a board mid-cascade (stop time running), the swaps made while it pops that make
  // it longer. A beam over swaps played as the cascade runs, each board ranked by what the cascade sends once it
  // settles; the line ends at the board that sends the most. o: { ms, width, depth }
  function extend(board, hold, o) {
    var s = search(), t0 = Date.now();
    s.reset();
    var root = s.root(board.copy(), hold, [], false);
    function sends(nodes) {
      var outs = s.advanceMany(nodes.map(function (n) { return [n, 'settle', null, 0]; }), true);
      return outs.map(function (out) {
        if (!out || out.dead) return null;
        var st = s.stepStats(out), g = sent(st), big = 0;
        st.comboSizes.forEach(function (z) { if (z > big) big = z; });
        return { cells: g.cells, chain: g.chain, combo: big, broke: st.broke || 0 };
      });
    }
    var base = sends([root])[0] || { cells: 0, chain: 0 };
    var best = { cells: base.cells, chain: base.chain, seq: [], base: base.cells };
    var xAims = o.aims || (o.aim ? [o.aim] : null), xPer = xAims ? xAims.map(function () { return null; }) : null;
    var pool = [{ n: root, seq: [] }];
    for (var d = 1; d <= o.depth && pool.length && Date.now() - t0 < o.ms; d++) {
      var jobs = [], meta = [];
      pool.forEach(function (it) { it.n.b.legalSwaps().forEach(function (m) { jobs.push([it.n, 'swap', m, 0]); meta.push([it, m]); }); });
      var outs = s.advanceMany(jobs, false), kids = [];
      outs.forEach(function (out, i) { if (out && !out.dead) kids.push({ n: out, seq: meta[i][0].seq.concat([meta[i][1]]) }); });
      var got = sends(kids.map(function (k) { return k.n; })), next = [];
      kids.forEach(function (k, i) {
        var g = got[i];
        if (!g) return;
        k.score = g.cells;
        k.h = connected(k.n.b.grid);
        // (o.aims: the cascade that ends making the most for each aim -- { combo, chain, broke, cells added } -- is kept per aim)
        if (xAims) {
          var madeX = { combo: g.combo, chain: g.chain, broke: g.broke, cells: g.cells - base.cells };
          for (var xa = 0; xa < xAims.length; xa++) if (xAims[xa] && xAims[xa](madeX) && (!xPer[xa] || g.cells > xPer[xa].cells)) xPer[xa] = { cells: g.cells, chain: g.chain, combo: g.combo, seq: k.seq, base: base.cells, aimIndex: xa };
        } else if (g.cells > best.cells) best = { cells: g.cells, chain: g.chain, combo: g.combo, seq: k.seq, base: base.cells };
        next.push(k);
      });
      var seen = {};
      next = next.filter(function (k) { var key = String(k.n.b.key); if (seen[key]) return false; seen[key] = 1; return true; });
      next.sort(function (a, b) { return b.score - a.score || b.h - a.h; });
      var keepNodes = next.slice(0, o.width);
      var keep = new Set(keepNodes.map(function (k) { return k.n; }));
      var spent = [];
      outs.forEach(function (out) { if (out && !out.dead && !keep.has(out)) spent.push(out); });
      pool.forEach(function (it) { if (it.n !== root && !keep.has(it.n)) spent.push(it.n); });
      if (spent.length) s.drop(spent);
      pool = keepNodes;
    }
    if (xPer) { for (var fx = 0; fx < xPer.length; fx++) if (xPer[fx]) { best = xPer[fx]; break; } if (!best.seq.length) best.aimIndex = -1; }
    best.ms = Date.now() - t0;
    return best;
  }
  // READY FOR THE GARBAGE ON ITS WAY: the board is played on to the frame the first arrival lands, and a swap that breaks it
  // then (a three, a combo, anything) means the break is ready. Not ready: the swap made now after which it is.
  // arrivals as the bot's serverArrivals; o: { ms }. Returns { ready, setup, at }.
  function readyFor(board, hold, arrivals, o) {
    var s = search(), t0 = Date.now(), first = null;
    (arrivals || []).forEach(function (a) { if (first === null || a.at < first) first = a.at; });
    if (first === null) return { ready: true, setup: null, at: 0 };
    s.reset();
    var root = s.root(board.copy(), hold, arrivals, false), wait = Math.max(1, first + 2);
    function breaksAfterLanding(n) {
      var land = n === root ? s.advance(n, 'long', null, wait) : s.advance(n, 'long', null, Math.max(1, wait - (n.t - root.t)));
      if (!land || land.dead) return null;
      var base = s.breaks(land), swaps = land.b.legalSwaps(), outs = s.advanceMany(swaps.map(function (m) { return [land, 'swap', m, 0]; }), true), any = false;
      var made = [land];
      outs.forEach(function (out) { if (out && !out.dead) { made.push(out); if ((out.brk !== undefined ? out.brk : s.breaks(out)) > base) any = true; } });
      s.drop(made);   // the nodes of this check are let go of: the next is made from the root
      return any;
    }
    var now = breaksAfterLanding(root);
    if (now === null || now) return { ready: now === true, setup: null, at: first, ms: Date.now() - t0 };
    var found = null;
    var firsts = root.b.legalSwaps();
    for (var i = 0; i < firsts.length && !found && Date.now() - t0 < (o.ms || 150); i++) {
      var n1 = s.advance(root, 'swap', firsts[i], 0);
      if (!n1 || n1.dead) continue;
      var okFirst = breaksAfterLanding(n1);
      s.drop([n1]);
      if (okFirst) found = firsts[i];
    }
    return { ready: false, setup: found, at: first, ms: Date.now() - t0 };
  }
  // READY WITHIN THE TIME THERE IS (readyInTime): the garbage on its way is landed on the board (the engine run to its landing) and a break
  // is looked for there as a line of swaps the board survives to play (SH.breakMoves, up to three swaps, the stack rising as it goes) --
  // not only a single swap. Not ready: the swap, from the top of the stack, after which one is.
  var SH = require(path.join(__dirname, 'survivor_shared.js'));
  function landed(b0, pieces, first) {
    var st = b0.copy(), pend = pieces.map(function (a) { return { at: st.stopWatch + a.at, g: { width: a.width, height: a.height, isChain: !!a.isChain, isMetal: !!a.isMetal, frameEarned: st.stopWatch, finalized: true }, capped: false }; });
    for (var i = 0; i < first + 2 && st.gameOverClock <= 0; i++) { st.setInput(0); st.run(); SH.land(st, pend); }
    return st;
  }
  function readyInTime(board, hold, arrivals, o) {
    var t0 = Date.now(), first = null, ms = (o && o.ms) || 220;
    (arrivals || []).forEach(function (a) { if (first === null || a.at < first) first = a.at; });
    if (first === null) return { ready: true, setup: null, at: 0 };
    var s = search();
    function breaks(st, share) { var r = SH.breakMoves(s, st, hold, [], 3, 0, Date.now() + share); return r && r.depth > 0; }
    if (breaks(landed(board, arrivals, first), Math.max(40, ms / 2))) return { ready: true, setup: null, at: first, ms: Date.now() - t0 };
    var top = 0, r, c;
    for (r = 1; r < board.panels.length; r++) for (c = 1; c <= 6; c++) { var p = board.panels[r] && board.panels[r][c]; if (p && (p.color || p.isGarbage) && r > top) top = r; }
    var cands = board.legalSwaps().filter(function (m) { return m[0] >= top - 2; }).sort(function (a, b) { return b[0] - a[0]; }), found = null;
    for (var i = 0; i < cands.length && !found && Date.now() - t0 < ms; i++) {
      var b1 = board.copy(); b1.curRow = cands[i][0]; b1.curCol = cands[i][1];
      if (!b1.tryQueueSwap(cands[i][0], cands[i][1])) continue;
      if (breaks(landed(b1, arrivals, first), 40)) found = cands[i];
    }
    return { ready: false, setup: found, at: first, ms: Date.now() - t0 };
  }
  return { plan: plan, extend: extend, readyFor: readyFor, readyInTime: readyInTime };
};
