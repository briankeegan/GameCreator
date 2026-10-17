// THE ATTACK PLANNER: while the board is safe, the line of swaps to the biggest fire the board can reach.
//
// A beam search on the native engine over swaps that clear nothing, each board ranked by the best fire one
// swap from it; the line ends in the swap that fires the most garbage. plan() returns that line. The caller
// plays its first swap, the rest of the line while the next plan is made, and plans again on the board that
// follows. Used by survivor_think.js for a profile with `attack`.
var path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), N = require(path.join(__dirname, 'native.js')).server;
var CK = require(path.join(__dirname, 'survivor_checks.js'));
var W = 6, KEYS = require(path.join(__dirname, 'survivor_keys.js'));
var pressDelay = KEYS.pressDelay;
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
  // last swap's clears done by frame o.by (frames from now), and o.keep(grid, made) true of the board it ends on; o: { ms, width, depth, pool, stopAt, minChain, guideChain, arrivals, rate }: with rate the fire kept is the best per swap of its line; arrivals is the garbage on its way, as the bot's serverArrivals; only a fire of a chain of minChain links or more counts; boards are ranked by fires of guideChain links or more; stopAt ends the search at the first depth with a fire of that many cells
  // o.near(made): with aims, how near a line comes to them (0: not at all) -- the nearest line is kept beside them (best.nearest),
  // the line to play when none meets an aim in time; and the line in time that breaks the most garbage (best.quick). o.readyAt: see READY.
  // THE SHAPE of a settled grid (0 empty, garbage 8 and up or below 0): its top row, evenness (tallest panel column less lowest) and
  // hollow (empty cells under garbage in its column)
  function shapeOf(g) {
    var top = 0, peaks = [], hollow = 0, r, c;
    for (c = 1; c <= W; c++) {
      var pk = 0, seenG = false;
      for (r = g.length - 2; r >= 1; r--) {
        var v = g[r] && g[r][c];
        if (v >= 8 || v < 0) seenG = true;
        else if (!v) { if (seenG) hollow++; }
        else if (!pk && !seenG) pk = r;
        if (v && r > top) top = r;
      }
      if (!pk) for (r = g.length - 2; r >= 1; r--) { var v2 = g[r] && g[r][c]; if (v2 > 0 && v2 < 8) { pk = r; break; } }
      peaks.push(pk);
    }
    return { top: top, even: Math.max.apply(null, peaks) - Math.min.apply(null, peaks), hollow: hollow };
  }
  var SLICE = 256;   // about 9 ms of jobs (8,987 in 318 ms on a runner's board under a slab)
  var SETTLE_SLICE = 32;   // a settle runs a cascade to its end: a popping slab's is a few hundred frames (256 of them took 160 ms here)
  function plan(board, hold, o) {
    var s = search(), t0 = Date.now(), best = null, nearest = null, quick = null, lowest = null, stopBest = null, aims = o.aims || (o.aim ? [o.aim] : null), perAim = aims ? aims.map(function () { return null; }) : null;
    s.reset();
    var root = s.root(board.copy(), hold, o.arrivals || [], false);
    // a cascade already running sends what it sends whatever is swapped: only what a swap adds to it counts
    var baseOut = s.advanceMany([[root, 'settle', null, 0]], true)[0], base = 0;
    if (baseOut && !baseOut.dead) { var bs = s.stepStats(baseOut); if (bs.cleared > 0) base = sent(bs).cells; }
    var rootH = connected(root.b.grid), setup = null;
    // (garbage broken by frame t standing still: a slab already popping goes on converting whatever is pressed)
    var stillAt = {};
    function stillBreaks(t) { if (!(t in stillAt)) { var w = t > root.t ? s.advance(root, 'long', null, t - root.t) : root; stillAt[t] = w ? s.breaks(w) : s.breaks(root); } return stillAt[t]; }
    var pool = [{ n: root, seq: [], ats: [], h: rootH }];
    for (var d = 1; d <= o.depth && pool.length && Date.now() - t0 < o.ms && !(o.stopAt && best && best.cells >= o.stopAt); d++) {
      var jobs = [], meta = [];
      pool.forEach(function (it) { it.n.b.legalSwaps().forEach(function (m) { jobs.push([it.n, 'settle', m, 0]); meta.push([it, m]); }); });
      // (the clock is read every SLICE jobs, not once a depth: one depth of a wide pool is many times the whole budget)
      var outs = [];
      for (var j0 = 0; j0 < jobs.length; j0 += SLICE) {
        if (j0 && Date.now() - t0 >= o.ms) break;
        outs = outs.concat(s.advanceMany(jobs.slice(j0, j0 + SLICE), true));
      }
      pool.forEach(function (it) { it.reach = 0; it.kids = []; });
      // (A BREAK JUDGED AT ITS BREAK, o.breakAtSwap: a line the engine settles dead -- under a stream the next slab lands while the board
      // settles -- is played again only to its swap; if the board then breaks garbage that standing still would not have by the same
      // frame, the line is a break, kept as the quick break and grown no further)
      if (o.breakAtSwap && Date.now() - t0 < o.ms) {
        var dj = [], dm = [];
        for (var di = 0; di < outs.length; di++) if (outs[di] && outs[di].dead) { dj.push([meta[di][0].n, 'swap', meta[di][1], 0]); dm.push(meta[di]); }
        if (dj.length) {
          var sw = s.advanceMany(dj, true);
          for (var dk = 0; dk < sw.length; dk++) {
            var x = sw[dk];
            if (!x || x.dead || !stepFits(s, x)) continue;   // (within the rules, useRules)
            var bk = s.breaks(x) - stillBreaks(x.t);
            if (o.by && dm[dk][0].n.t - root.t > o.by) bk = 0;   // (in time, as every line)
            if (bk > 0 && (!quick || bk > quick.broke || (bk === quick.broke && x.t - root.t < quick.done))) {
              if (quick && quick.n && quick.n !== x) { if (quick.atSwap) s.drop([quick.n]); }
              quick = { near: 0, brk: true, cells: 0, chain: 0, combo: 0, seq: dm[dk][0].seq.concat([dm[dk][1]]), n: x, broke: bk, done: x.t - root.t, fire: dm[dk][0].n.t - root.t, ats: dm[dk][0].ats.concat([dm[dk][0].n.t - root.t]), aimIndex: -1, atSwap: true };
            } else s.drop([x]);
          }
        }
      }
      for (var i = 0; i < outs.length; i++) {
        var out = outs[i], it = meta[i][0], m = meta[i][1];
        if (!out || out.dead) continue;
        // (a line that breaks the rules -- the list, the floor (useRules) -- at any step is no line, and grows no further)
        if (!stepFits(s, out)) continue;
        var st = s.stepStats(out);
        if (st.cleared > 0) {
          // (EVERY STEP ITS OWN TIME: ats[k] is the frame the line's k-th swap is begun, and `fire` its last's -- the line is in time when
          // its last swap is, plans/gambit.md step 2; `done` is when the cascade it sets off has settled)
          var g = sent(st), seq = it.seq.concat([m]), fire = it.n.t - root.t, ats = it.ats.concat([fire]);
          // (a line is kept as an answer only when it is within the rules through its settle, as the judge plays it -- allowed(), asked
          // once, only of a line about to be kept)
          var endOk = null, okE = function () { if (endOk === null) endOk = allowed(s, out); return endOk; };
          var bigC = 0; st.comboSizes.forEach(function (z) { if (z > bigC) bigC = z; });
          if (aims) {
            // (aims: the line is kept for every aim it meets, by its deadline and keeping what o.keep asks; the search goes on past it)
            var made = { combo: bigC, combos: st.comboSizes, chain: g.chain, broke: st.broke || 0, cells: Math.max(0, g.cells - base) };
            var inTime = !(o.by && fire > o.by), kept = !(o.keep && !o.keep(out.b.grid, made));
            // (floor: the board it ends on keeps the floor, a break or not -- of two breaks, the one that leaves the panels comes first)
            var floor = !(o.keep && !o.keep(out.b.grid, { broke: 0 }));
            // (CLEAR and SCRAMBLE, the plays of a board that would be lost: done before it is (o.dies), whatever the floor -- the line that
            // leaves the lowest stack, and the one that buys the most stop time)
            if (o.near && !(o.dies && out.t - root.t > o.dies)) {
              var shp = shapeOf(out.b.grid);
              if ((!lowest || shp.top < lowest.top || (shp.top === lowest.top && seq.length < lowest.seq.length)) && okE())
                lowest = { top: shp.top, cells: made.cells, chain: g.chain, combo: bigC, seq: seq, n: out, broke: made.broke, done: out.t - root.t, fire: fire, ats: ats, floor: floor, aimIndex: -1 };
              if ((st.earned || 0) > 0 && (!stopBest || st.earned > stopBest.earned || (st.earned === stopBest.earned && seq.length < stopBest.seq.length)) && okE())
                stopBest = { earned: st.earned, cells: made.cells, chain: g.chain, combo: bigC, seq: seq, n: out, broke: made.broke, done: out.t - root.t, fire: fire, ats: ats, floor: floor, aimIndex: -1 };
            }
            // (of the lines in time that break garbage at all, a plain three included, the one that breaks the most -- the sooner between
            // equals: the last line before the default's own)
            if (o.near && inTime && kept && made.broke > 0 && (!quick || made.broke > quick.broke || (made.broke === quick.broke && out.t - root.t < quick.done)) && okE())
              quick = { near: 0, brk: true, cells: made.cells, chain: g.chain, combo: bigC, seq: seq, n: out, broke: made.broke, done: out.t - root.t, fire: fire, ats: ats, floor: floor, aimIndex: -1 };
            if (o.near && inTime && kept) {
              var nr = o.near(made);
              if (nr > it.reach) it.reach = nr;   // (the beam is led by the list: a board ranks by the nearest line one swap from it)
              if (nr > 0 && (!nearest || nr > nearest.near || (nr === nearest.near && seq.length < nearest.seq.length)) && okE())
                nearest = { near: nr, brk: made.broke > 0, cells: made.cells, chain: g.chain, combo: bigC, seq: seq, n: out, broke: made.broke, done: out.t - root.t, fire: fire, ats: ats, floor: floor, aimIndex: -1 };
            }
            if (inTime && kept) for (var ai = 0; ai < aims.length; ai++) {
              if (!aims[ai] || !aims[ai](made)) continue;
              var pa = perAim[ai];
              if ((!pa || made.cells > pa.cells || (made.cells === pa.cells && seq.length < pa.seq.length)) && okE())
                perAim[ai] = { brk: made.broke > 0, cells: made.cells, chain: g.chain, combo: bigC, seq: seq, n: out, broke: made.broke, earned: st.earned || 0, done: out.t - root.t, fire: fire, ats: ats, floor: floor, aimIndex: ai };
            }
            it.kids.push({ n: out, seq: seq, ats: ats });
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
          if (better && okE()) best = { brk: brk, cells: g.cells, chain: g.chain, combo: bigC, seq: seq, n: out, broke: st.broke || 0, earned: st.earned || 0, done: out.t - root.t, fire: fire, ats: ats };
        } else it.kids.push({ n: out, seq: it.seq.concat([m]), ats: it.ats.concat([it.n.t - root.t]) });
      }
      pool.sort(function (a, b) { return b.reach - a.reach || b.h - a.h; });
      var seen = {}, next = [];
      pool.slice(0, o.width).forEach(function (it) {
        it.kids.forEach(function (k) {
          var key = String(k.n.b.key);
          if (seen[key]) return;
          seen[key] = 1;
          next.push({ n: k.n, seq: k.seq, ats: k.ats, h: connected(k.n.b.grid) });
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
      if (lowest) keep.add(lowest.n);
      if (stopBest) keep.add(stopBest.n);
      var spent = outs.filter(function (x) { return x && !x.dead && !keep.has(x); });
      old.forEach(function (it) { if (it.n !== root && !keep.has(it.n)) spent.push(it.n); });
      if (spent.length) s.drop(spent);
    }
    // READY (o.readyAt: frames from now the next block lands, garbage on its way and none on the board): a line is kept only if the
    // board it leaves breaks that block once it has landed -- one swap then breaks it -- so an attack never costs the next break its
    // deadline. The aims' lines in their order, then the nearest.
    function readyAfter(n) {
      var wait = Math.max(1, o.readyAt + 2 - (n.t - root.t)), land = s.advance(n, 'long', null, wait);
      if (land && !land.dead) { var st0 = s.advance(land, 'settle', null, 0); if (st0) { s.drop([land]); land = st0; } }
      if (!land || land.dead) return false;
      var base = s.breaks(land), outs = s.advanceMany(land.b.legalSwaps().map(function (m) { return [land, 'swap', m, 0]; }), true), any = false;
      outs.forEach(function (x) { if (x && !x.dead && (x.brk !== undefined ? x.brk : s.breaks(x)) > base) any = true; });
      s.drop([land].concat(outs.filter(function (x) { return x && !x.dead; })));
      return any;
    }
    if (o.readyAt !== undefined && o.readyAt !== null) {
      if (perAim) for (var ra = 0; ra < perAim.length; ra++) if (perAim[ra] && Date.now() - t0 < 2 * o.ms && !readyAfter(perAim[ra].n)) perAim[ra] = null;
      if (nearest && !readyAfter(nearest.n)) nearest = null;
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
    best.nearest = nearest; best.quick = quick; best.lowest = lowest; best.stopBest = stopBest; best.perAim = perAim;
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
  // settles; the line ends at the board that sends the most. o: { ms, width, depth, keep } -- with o.keep(grid), a cascade is kept for an
  // aim only when the board it settles to keeps what o.keep asks; with o.near(made) the nearest cascade is kept too (best.nearest)
  function extend(board, hold, o) {
    var s = search(), t0 = Date.now();
    s.reset();
    var root = s.root(board.copy(), hold, [], false);
    // (settled SETTLE_SLICE at a time, the clock read between: past o.ms the rest come back unsettled, as lines not there)
    function sends(nodes) {
      var outs = [];
      for (var q0 = 0; q0 < nodes.length; q0 += SETTLE_SLICE) {
        if (q0 && Date.now() - t0 >= o.ms) { while (outs.length < nodes.length) outs.push(null); break; }
        outs = outs.concat(s.advanceMany(nodes.slice(q0, q0 + SETTLE_SLICE).map(function (n) { return [n, 'settle', null, 0]; }), true));
      }
      return outs.map(function (out) {
        if (!out || out.dead) return null;
        var st = s.stepStats(out), g = sent(st), big = 0;
        st.comboSizes.forEach(function (z) { if (z > big) big = z; });
        return { cells: g.cells, chain: g.chain, combo: big, broke: st.broke || 0, kept: !(o.keep && !o.keep(out.b.grid, { broke: st.broke || 0 })), floor: !(o.keep && !o.keep(out.b.grid, { broke: 0 })), done: out.t - root.t };
      });
    }
    var base = sends([root])[0] || { cells: 0, chain: 0 };
    var best = { cells: base.cells, chain: base.chain, seq: [], base: base.cells };
    var xAims = o.aims || (o.aim ? [o.aim] : null), xPer = xAims ? xAims.map(function () { return null; }) : null, xNear = null;
    var pool = [{ n: root, seq: [] }];
    for (var d = 1; d <= o.depth && pool.length && Date.now() - t0 < o.ms; d++) {
      var jobs = [], meta = [];
      pool.forEach(function (it) { it.n.b.legalSwaps().forEach(function (m) { jobs.push([it.n, 'swap', m, 0]); meta.push([it, m]); }); });
      var outs = [], kids = [];
      for (var j0 = 0; j0 < jobs.length; j0 += SLICE) {
        if (j0 && Date.now() - t0 >= o.ms) break;
        outs = outs.concat(s.advanceMany(jobs.slice(j0, j0 + SLICE), false));
      }
      outs.forEach(function (out, i) { if (out && !out.dead && stepFits(s, out)) kids.push({ n: out, seq: meta[i][0].seq.concat([meta[i][1]]) }); });
      var got = sends(kids.map(function (k) { return k.n; })), next = [];
      kids.forEach(function (k, i) {
        var g = got[i];
        if (!g) return;
        // (a link added to a falling chain is in time when its swap is: pressed before the link it joins lands -- the engine plays it so --
        // and by the deadline; the chain it makes runs on after)
        g.fire = k.n.t - root.t;
        if (o.by && g.fire > o.by) g.kept = false;
        k.score = g.cells;
        k.h = connected(k.n.b.grid);
        // (o.aims: the cascade that ends making the most for each aim -- { combo, chain, broke, cells added } -- is kept per aim)
        if (xAims) {
          var madeX = { combo: g.combo, chain: g.chain, broke: g.broke, cells: g.cells - base.cells };
          if (o.near && g.kept) { var xn = o.near(madeX); if (xn > 0 && (!xNear || xn > xNear.near || (xn === xNear.near && g.cells > xNear.cells))) xNear = { near: xn, cells: g.cells, chain: g.chain, combo: g.combo, broke: g.broke, done: g.done, fire: g.fire, floor: g.floor, seq: k.seq, base: base.cells, aimIndex: -1 }; }
          for (var xa = 0; xa < xAims.length; xa++) if (g.kept && xAims[xa] && xAims[xa](madeX) && (!xPer[xa] || g.cells > xPer[xa].cells)) xPer[xa] = { cells: g.cells, chain: g.chain, combo: g.combo, broke: g.broke, done: g.done, fire: g.fire, floor: g.floor, seq: k.seq, base: base.cells, aimIndex: xa };
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
    best.nearest = xNear;
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
    var check = function (n) { var made = [], r = breaksAfterLanding(s, root, n, wait, made); s.drop(made); return r; };   // (the next check is made from the root)
    var now = check(root);
    if (now === null || now) return { ready: now === true, setup: null, at: first, ms: Date.now() - t0 };
    var found = null;
    var firsts = root.b.legalSwaps();
    for (var i = 0; i < firsts.length && !found && Date.now() - t0 < (o.ms || 150); i++) {
      var n1 = s.advance(root, 'swap', firsts[i], 0);
      if (!n1 || n1.dead) continue;
      var okFirst = check(n1);
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
  // THE ROWS THE RAISE MAY HOLD (raiseReady): the most rows, of `rows`, the stack can be raised by and still have a plan once all the
  // garbage the game shows has landed -- the board raised on the engine, every block landed when the game lands it, and then a line of
  // swaps to a break the board survives to play (SH.breakMoves: the stack rising as it goes, a combo or chain on the way buying its stop
  // time). With nothing shown coming, every row. ms: the time the search has, shared out over the rows tried.
  var RAISE_IN = 32, SETTLE_MAX = 600;
  // the board once every block shown has come down on it: delivered when the game delivers it, dropped from the queue, and done falling
  // (null when the board is lost first, or still busy SETTLE_MAX frames after the last is delivered)
  function landedAll(b0, pieces, last) {
    var st = b0.copy(), pend = pieces.map(function (a) { return { at: st.stopWatch + a.at, g: { width: a.width, height: a.height, isChain: !!a.isChain, isMetal: !!a.isMetal, frameEarned: st.stopWatch, finalized: true }, capped: false }; });
    for (var i = 0; i < last + 2 + SETTLE_MAX && st.gameOverClock <= 0; i++) {
      if (i > last + 1 && !pend.length && !(st.incoming || []).length && !(typeof st.hasFallingGarbage === 'function' && st.hasFallingGarbage())) return st;
      st.setInput(0); st.run(); SH.land(st, pend);
    }
    return null;
  }
  function raiseReady(board, hold, arrivals, rows, ms) {
    var last = null;
    (arrivals || []).forEach(function (a) { if (last === null || a.at > last) last = a.at; });
    if (last === null || rows <= 0) return Math.max(0, rows);
    var s = search(), t0 = Date.now(), ok = 0, top0 = CK.fullTop(board);
    for (var k = 1; k <= rows; k++) {
      var st = board.copy(), f = 0;
      while (CK.fullTop(st) < top0 + k && st.gameOverClock <= 0 && f < 40 * k) { st.setInput(RAISE_IN); st.run(); f++; }
      if (st.gameOverClock > 0 || CK.fullTop(st) < top0 + k) break;
      var left = arrivals.map(function (a) { return Object.assign({}, a, { at: Math.max(0, a.at - f) }); });
      var at = landedAll(st, left, Math.max(0, last - f));
      if (!at || Date.now() - t0 > ms) break;
      // (a plan once landed: the readiness every move is held to -- a break within two swaps that the list allows)
      s.reset();
      var made = [], rt = s.root(at, hold, [], false), r = breaksAfterLanding(s, rt, rt, 1, made);
      s.drop(made);
      if (r !== true) break;
      ok = k;
    }
    return ok;
  }
  // LEVEL: of the swaps that clear nothing and are settled by o.by (frames: the next block lands), the one that leaves the least hollow
  // under the garbage, then the flattest stack -- only one better than the board left alone. Returns { move, before, after } or null.
  function level(board, hold, arrivals, o) {
    var s = search();
    s.reset();
    var root = s.root(board.copy(), hold, arrivals || [], false), r0 = s.advanceMany([[root, 'settle', null, 0]], true)[0];
    if (!r0 || r0.dead) return null;
    var before = shapeOf(r0.b.grid), ms = root.b.legalSwaps(), outs = s.advanceMany(ms.map(function (m) { return [root, 'settle', m, 0]; }), true), bestL = null;
    outs.forEach(function (out, i) {
      if (!out || out.dead || s.stepStats(out).cleared > 0 || (o && o.by && out.t - root.t > o.by)) return;
      var sh = shapeOf(out.b.grid);
      if (sh.hollow > before.hollow || (sh.hollow === before.hollow && sh.even >= before.even)) return;
      if (!bestL || sh.hollow < bestL.after.hollow || (sh.hollow === bestL.after.hollow && sh.even < bestL.after.even)) bestL = { move: ms[i], before: before, after: sh };
    });
    s.drop([r0].concat(outs.filter(function (x) { return x && !x.dead; })));
    return bestL;
  }
  // THE FIRST CLEAR OF A LINE THAT IS TO CLEAR NOTHING: each step played on the engine to the board's settle (falls and all), in turn;
  // the index of the first that clears panels and breaks no garbage, -1 if none does (or the line cannot be played on)
  function firstClear(board, hold, seq, arrivals, o) {
    var s = search();
    s.reset();
    var n = s.root(board.copy(), hold, arrivals || [], false), made = [], at = -1;
    for (var k = 0; k < seq.length; k++) {
      var late = pressDelay(s, n, seq[k], o && o.tight);   // (pressed when the frame loop presses it)
      if (late > 0) { var waited = s.advance(n, 'long', null, late); if (!waited || waited.dead) break; made.push(waited); n = waited; }
      var out = s.advanceMany([[n, 'settle', seq[k], 0]], true)[0];
      if (!out || out.dead) break;
      made.push(out);
      var st = s.stepStats(out);
      if (st.cleared > 0 && !((st.broke || 0) > 0)) { at = k; break; }
      n = out;
    }
    if (made.length) s.drop(made);
    return at;
  }
  // A LINE PLAYED ON (the rest of a line begun): each step played on the engine to the board's settle, as the planner plays a line; what
  // its last step makes ({ combo, chain, broke, cells, earned, done, fire, ats, wait }, as the planner's lines), or null when a step is
  // not legal or the board dies. o.settleFirst: the rest of a line, whose next step is pressed once the board has settled from the last
  // -- the board is let settle first, and `wait` is the frames until it has (each step its own time)
  function replay(board, hold, seq, arrivals, o) {
    var s = search();
    s.reset();
    var root = s.root(board.copy(), hold, arrivals || [], false), n = root, made = [], ats = [], res = null;
    var baseOut = s.advanceMany([[root, 'settle', null, 0]], true)[0], base = 0;
    if (baseOut && !baseOut.dead) { var bs = s.stepStats(baseOut); if (bs.cleared > 0) base = sent(bs).cells; made.push(baseOut); }
    var wait = 0;
    if (o && o.settleFirst) { if (!baseOut || baseOut.dead) { if (made.length) s.drop(made); return null; } n = baseOut; wait = baseOut.t - root.t; }
    for (var k = 0; k < seq.length; k++) {
      var legal = n.b.legalSwaps().some(function (m) { return m[0] === seq[k][0] && m[1] === seq[k][1]; });
      if (!legal) break;
      var late = pressDelay(s, n, seq[k], o && o.tight);
      if (late > 0) { var waited = s.advance(n, 'long', null, late); if (!waited || waited.dead) break; made.push(waited); n = waited; }
      ats.push(n.t - root.t);
      var out = s.advanceMany([[n, 'settle', seq[k], 0]], true)[0];
      if (!out || out.dead) break;
      made.push(out);
      if (k === seq.length - 1) {
        var st = s.stepStats(out), g = sent(st), big = 0;
        st.comboSizes.forEach(function (z) { if (z > big) big = z; });
        res = { combo: big, chain: g.chain, broke: st.broke || 0, cells: Math.max(0, g.cells - base), earned: st.earned || 0, done: out.t - root.t, fire: ats[k], ats: ats, wait: wait };
      }
      n = out;
    }
    if (made.length) s.drop(made);
    return res;
  }
  // THE JUDGE (plans/decision.md, step 3): a line played on the engine as the game will press it -- `settled`, each step once the board
  // has settled from the last (a planned line, carried on a decision at a time); else every step at once, one after the other, the board
  // then let settle -- each swap pressed when the frame loop presses it (o.tight: walked held from two cells, pressDelay). What it makes is counted over every step and the settle after:
  // the largest match, the longest chain, the garbage broken -- beyond what the board left alone makes (a chain already falling is the
  // line's only when the line adds a link to it; a slab already popping converts its panels whatever is pressed).
  // { made: { combo, chain, broke }, cut: the first step after which ok(made so far) is false (seq.length when none is), dead: the board
  // lost on the way, ats: the frame each step is begun (from now), fire: the last's, done: frames until it has settled, node: the board
  // it ends on (for readiness, when o.keep) }. A step not legal ends the judging there, as a board lost does: whether the line lives is
  // the survival search's question.
  function judge(board, hold, seq, arrivals, o) {
    o = o || {};
    var s = search();
    s.reset();
    var root = s.root(board.copy(), hold, arrivals || [], false), n = root, made = [], cut = seq.length, dead = false, deadAt = 0, done = 0, ats = [], lastAt = 0;
    var baseOut = s.advanceMany([[root, 'settle', null, 0]], true)[0], baseChain = 0, baseCombo = 0, baseBroke = 0;
    if (baseOut && !baseOut.dead) { var bs = s.stepStats(baseOut); baseBroke = bs.broke || 0; if (bs.cleared > 0) { baseChain = sent(bs).chain; bs.comboSizes.forEach(function (z) { if (z > baseCombo) baseCombo = z; }); } made.push(baseOut); }
    var combo = 0, chain = 0, broke = 0, singles = {};
    // (the garbage the line breaks is what it breaks beyond the board left alone: a slab popping converts its panels whatever is pressed)
    var sofar = function () { return { combo: combo > baseCombo ? combo : 0, chain: chain > baseChain ? chain : 0, broke: Math.max(0, broke - baseBroke) }; };
    var count = function (out) {
      var st = s.stepStats(out), g = sent(st);
      st.comboSizes.forEach(function (z, i) { if (z > combo) combo = z; if (!(st.chainAt[i] > 1) && z >= 4) singles[z] = true; });
      if (g.chain > chain) chain = g.chain;
      broke += st.broke || 0;
    };
    for (var k = 0; k <= seq.length; k++) {
      var last = k === seq.length, mv = last ? null : seq[k];
      if (last && o.settled) break;   // (each step settled already)
      if (mv && !n.b.legalSwaps().some(function (m) { return m[0] === mv[0] && m[1] === mv[1]; })) break;
      var late = pressDelay(s, n, mv, o.tight);
      if (late > 0) { var waited = s.advance(n, 'long', null, late); if (!waited || waited.dead) { dead = true; deadAt = waited ? waited.t - root.t : n.t - root.t; break; } made.push(waited); n = waited; }
      if (mv) ats.push(n.t - root.t);
      var out = s.advanceMany([[n, last || o.settled ? 'settle' : 'swap', mv, 0]], true)[0];
      if (!out || out.dead) { dead = true; deadAt = out ? out.t - root.t : n.t - root.t; break; }
      made.push(out);
      count(out);
      done = out.t - root.t;
      if (mv) lastAt = done;
      if (o.ok && cut === seq.length && !o.ok(sofar())) { cut = last ? seq.length - 1 : k; break; }
      n = out;
    }
    // (chainAll: the chain the line reaches as the game counts it -- the chain already falling and every link after it, the board's own
    // continuation included only as far as the line leaves it running: a swap that cuts it ends it there)
    // (singles: the sizes of 4 or more of the line's matches that are clears of their own, no link of a chain -- the board's own included,
    // as far as the line leaves them to happen)
    // (dropAt: the frame, from now, the garbage queued can next drop once the line is over -- the frame its board has settled, then the
    // later of the stop time left there and the shake (they count down together, pa.c decrementInvincibilityTimers; garbage drops only
    // when both are spent): the stop a combo or chain earns and the shake a break's landing slab gives both count, as the engine runs it)
    var dropAt = dead || !n.carry ? 0 : (n.t - root.t) + Math.max((n.carry.stopTime || 0) + (n.carry.preStopTime || 0), n.carry.shakeTime || 0);
    var res = { made: sofar(), chainAll: Math.max(chain, board.chainCounter || 0), singles: Object.keys(singles).map(Number), dropAt: dropAt, cut: cut, dead: dead, done: done, ats: ats, fire: ats.length ? ats[ats.length - 1] : null };
    // (readiness, o.readyAt: the next block landed on the board the line ends on, can a break be made then -- the readiness check every
    // move that breaks nothing is held to)
    // (lostAt, o.lifeTo: the frame, from now, the board the line ends on is lost left alone -- the rise, the garbage shown landing when it
    // lands, the health drained -- Infinity when it is still alive at lifeTo; the frame the engine lost it on, when the line itself did)
    // (o.lifeRest: and that many frames past the line's own end -- the frame its last swap is made, as the survival search counts it)
    if (o.lifeTo != null) res.lostAt = dead ? deadAt : lostAlone(s, root, n, Math.max(o.lifeTo, lastAt + (o.lifeRest || 0)), made);
    // (o.readyIfLost: the readiness check, the dearer one, only when the board left alone does not stand to lifeTo)
    if (o.readyAt != null && !dead && !(o.readyIfLost && res.lostAt === Infinity)) {
      var why = o.why ? {} : null;
      res.ready = breaksAfterLanding(s, root, n, Math.max(1, o.readyAt + 2), made, why);
      if (why && why.land && why.seq) res.readyLine = { board: why.land.st, seq: why.seq };
    }
    if (made.length) s.drop(made);
    return res;
  }
  // the first frame (from the root) the board at node n, left alone, is lost before `to` -- Infinity when it is alive at `to`: one run of
  // the engine, which stops at the frame the board is lost and says which (lostMany: a batch of them, on every thread)
  function lostMany(s, root, ns, tos, made) {
    var steps = ns.map(function (n, q) { return [n, 'long', null, Math.max(1, Math.ceil(tos[q] - (n.t - root.t)))]; });
    return s.advanceMany(steps, true).map(function (x) {
      if (!x || x.dead) return x ? x.t - root.t : 0;
      made.push(x);
      return Infinity;
    });
  }
  function lostAlone(s, root, n, to, made) { return lostMany(s, root, [n], [to], made)[0]; }
  // A PLAN ONCE EVERYTHING SHOWN HAS LANDED: from node n, the board run to `wait` frames after the root (the last block the game shows
  // landed) and settled, then a break looked for in two swaps -- true when a line of one or two swaps breaks more garbage than standing
  // still, false when none does, null when the board is lost before; the nodes made are added to `made`, for the caller to let go of
  // THE LIST, as every search on the engine reads it (useList: set once a decision): fits(sizes, chain) for a step's own clears and the
  // chain it reaches; a break that makes what the list does not allow is no break
  // THE RULES, as every search on the engine reads them (useRules: set once a decision): fits(sizes, chain) -- a step's own clears and
  // the chain it reaches within the list -- and floorLow, the board below the rule's material floor, where a step that clears panels and
  // breaks no garbage spends what the board needs. allowed(s, node): a step and the settle after it both within them -- what the judge
  // filters by, so a search finds only what the judge will take
  var listFits = null, floorLow = false;
  function useRules(r) { listFits = (r && r.fits) || null; floorLow = !!(r && r.floorLow); }
  function useList(fits) { useRules({ fits: fits, floorLow: floorLow }); }
  function stepFits(s, out) {
    if (!listFits && !floorLow) return true;
    var st = s.stepStats(out);
    if (floorLow && st.comboSizes.length && !(st.broke > 0)) return false;
    return !listFits || listFits(st.comboSizes.filter(function (z, i) { return !(st.chainAt[i] > 1); }), sent(st).chain);
  }
  function allowed(s, out) {
    if (!out || out.dead || !stepFits(s, out)) return false;
    var z = s.advanceMany([[out, 'settle', null, 0]], true)[0];
    var ok = !!(z && !z.dead) && stepFits(s, z);
    if (z && !z.dead && z._i >= 0) s.drop([z]);
    return ok;
  }
  // (why, when given: the board landed and settled, and the break found on it -- what the agreement gate judges again)
  function breaksAfterLanding(s, root, n, wait, made, why) {
    var land = s.advance(n, 'long', null, Math.max(1, wait - (n.t - root.t)));
    if (!land || land.dead) return null;
    made.push(land);
    var calm = s.advanceMany([[land, 'settle', null, 0]], true)[0];
    if (calm && !calm.dead) { made.push(calm); land = calm; }
    if (why) why.land = land;
    // (a break is one the board left alone would not have made by the same frame, as the judge and the break search count it)
    var idle = {}, still = function (t) {
      if (!(t in idle)) { var w = t > land.t ? s.advance(land, 'long', null, t - land.t) : land; if (w && w !== land && !w.dead) made.push(w); idle[t] = w && !w.dead ? s.breaks(w) : s.breaks(land); }
      return idle[t];
    };
    // (and the board it breaks on lives through the break's settle, as the judge plays the line out)
    var settles = function (x) { var z = s.advanceMany([[x, 'settle', null, 0]], true)[0]; if (z && !z.dead) { made.push(z); return stepFits(s, z); } return false; };
    var brk = function (x) { return x && !x.dead && (x.brk !== undefined ? x.brk : s.breaks(x)) > still(x.t) && stepFits(s, x) && settles(x); };
    var ms1 = land.b.legalSwaps(), firsts = s.advanceMany(ms1.map(function (m) { return [land, 'swap', m, 0]; }), true), live = [];
    for (var q = 0; q < firsts.length; q++) {
      var out = firsts[q];
      if (!out || out.dead) continue;
      made.push(out);
      if (brk(out)) { if (why) why.seq = [ms1[q]]; return true; }
      if (stepFits(s, out)) live.push({ n: out, m: ms1[q] });
    }
    var seconds = [], meta = [];
    live.forEach(function (x) { x.n.b.legalSwaps().forEach(function (m) { seconds.push([x.n, 'swap', m, 0]); meta.push([x.m, m]); }); });
    var outs = s.advanceMany(seconds, true), any = false;
    outs.forEach(function (out, i) { if (out && !out.dead) { made.push(out); if (!any && brk(out)) { any = true; if (why) why.seq = meta[i]; } } });
    return any;
  }

  // THE FRAMES UNTIL THE BOARD IS LOST IF NOTHING IS DONE, on the engine: the stack rising, the garbage the game shows landing when it
  // lands, the health drained -- the first frame within `horizon` the board left alone is lost, Infinity when it lives through it
  function diesIn(board, hold, arrivals, horizon) {
    var s = search();
    s.reset();
    var root = s.root(board.copy(), hold, arrivals || [], false), made = [], lost = lostAlone(s, root, root, Math.max(1, Math.ceil(horizon)), made);
    s.drop(made);
    return lost;
  }
  // GAMBIT'S SURVIVAL SEARCH (outlive): lines of swaps played on the engine one after another, a beam of the boards lost latest left
  // alone, on the engine, of those held longest -- the frame the garbage queued could next drop (the line's frames, then the later of
  // stop + pre-stop and the shake: they count down together) -- then with the most room over the stack, then the least garbage; each step's clears held to the list (useList), for as long as o.ms lasts. The first line whose board, left alone,
  // is still alive at o.to (frames from now), and o.rest past its own end, is the answer; else the line whose board is lost latest.
  // { seq, lostAt } or null. o: { to, rest, ms, depth, beam, ok }
  function outlive(board, hold, arrivals, o) {
    var t0 = Date.now(), s = search(), depth = o.depth || 6, width = o.beam || 12, best = null, made = [];
    s.reset();
    var root = s.root(board.copy(), hold, arrivals || [], false);
    var held = function (n) { return (n.t - root.t) + Math.max((n.carry.stopTime || 0) + (n.carry.preStopTime || 0), n.carry.shakeTime || 0); };
    var level = [{ n: root, seq: [] }];
    for (var d = 1, perStep = 0; d <= depth && level.length; d++) {
      var tl = Date.now(), steps = [], meta = [];
      level.forEach(function (x) { x.n.b.legalSwaps().forEach(function (m) { steps.push([x.n, 'swap', m, 0]); meta.push(x.seq.concat([m])); }); });
      // (a level is begun only while what the last took a step, over this one's steps, is left)
      if (Date.now() - t0 + perStep * steps.length > o.ms) break;
      var outs = s.advanceMany(steps, true), kids = [], seen = {};
      outs.forEach(function (out, q) {
        if (!out || out.dead) return;
        made.push(out);
        if (!stepFits(s, out)) return;   // (the line's end is held to allowed() before it is the answer)
        var key = out.b.key;
        if (seen[key]) return;
        seen[key] = true;
        kids.push({ n: out, seq: meta[q], room: out.b.height - out.b._top, h: held(out), g: out.b._garb });
      });
      // (the boards held longest, then with the most room, then the least garbage, are each run on alone to the frame they are lost; the
      // beam keeps the ones lost latest)
      kids.sort(function (a, b) { return b.h - a.h || b.room - a.room || a.g - b.g; });
      kids = kids.slice(0, 2 * width);
      var losts = lostMany(s, root, kids.map(function (x) { return x.n; }), kids.map(function (x) { return Math.max(o.to, x.n.t - root.t + (o.rest || 0)); }), made);
      for (var i = 0; i < kids.length; i++) {
        var lost = kids[i].lost = losts[i];
        if (!(lost === Infinity ? allowed(s, kids[i].n) : true)) { kids[i].lost = -1; continue; }
        if (!best || lost > best.lostAt) best = { seq: kids[i].seq, lostAt: lost };
        if (lost === Infinity) { s.drop(made); return best; }
      }
      level = kids.sort(function (a, b) { return b.lost - a.lost; }).slice(0, width);
      // (every board not kept is let go before the next level: the search holds one level's boards)
      var keep = new Set(level.map(function (x) { return x.n; }));
      s.drop(made.filter(function (x) { return !keep.has(x); }));
      made = level.map(function (x) { return x.n; });
      perStep = (Date.now() - tl) / steps.length;
    }
    s.drop(made);
    return best;
  }
  // A LINE THAT LEAVES A PLAN (readyLines): of the lines of one swap, then of two from the first swaps that live, the first that, played
  // as pressed and run on until the last block shown has landed and the board has settled, leaves a break within two swaps
  // (breaksAfterLanding) -- each judged on the engine, for as long as `ms` lasts. { seq, at } or null
  function readyLines(board, hold, arrivals, land, ms, o) {
    var t0 = Date.now(), firsts = board.legalSwaps(), live = [];
    var top = CK.fullTop(board);
    firsts.sort(function (a, b) { return Math.abs(b[0] - top) < Math.abs(a[0] - top) ? 1 : -1; });   // (near the top of the stack first)
    var check = function (seq) { var j = judge(board, hold, seq, arrivals, { settled: false, tight: o && o.tight, readyAt: land }); return j; };
    for (var i = 0; i < firsts.length && Date.now() - t0 < ms; i++) {
      var j = check([firsts[i]]);
      if (j.dead) continue;
      if (j.ready === true) return { seq: [firsts[i]], at: j.done };
      live.push(firsts[i]);
    }
    for (i = 0; i < live.length && Date.now() - t0 < ms; i++) {
      var b1 = board.copy(); b1.curRow = live[i][0]; b1.curCol = live[i][1];
      if (!b1.tryQueueSwap(live[i][0], live[i][1])) continue;
      var seconds = b1.legalSwaps();
      for (var k = 0; k < seconds.length && Date.now() - t0 < ms; k++) {
        var j2 = check([live[i], seconds[k]]);
        if (!j2.dead && j2.ready === true) return { seq: [live[i], seconds[k]], at: j2.done };
      }
    }
    return null;
  }
  return { useRules: useRules, useList: useList, allowed: allowed, stepOk: stepFits, outlive: outlive, readyLines: readyLines, plan: plan, extend: extend, readyFor: readyFor, readyInTime: readyInTime, level: level, shapeOf: shapeOf, firstClear: firstClear, replay: replay, judge: judge, diesIn: diesIn, raiseReady: raiseReady };
};
