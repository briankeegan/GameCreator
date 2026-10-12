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
  // o: { ms, width, depth, pool, stopAt, minChain, guideChain }: only a fire of a chain of minChain links or more counts; boards are ranked by fires of guideChain links or more; stopAt ends the search at the first depth with a fire of that many cells
  function plan(board, hold, o) {
    var s = search(), t0 = Date.now(), best = null;
    s.reset();
    var root = s.root(board.copy(), hold, [], false);
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
          // a board is ranked by the chain one swap from it (guideChain links or more), the fire kept is minChain links or more
          var shown = Math.max(0, g.cells - base);
          if (g.chain >= (o.guideChain || o.minChain || 0) && shown > it.reach) it.reach = shown;
          g.cells = g.chain >= (o.minChain || 0) ? shown : 0;
          if (g.cells === 0) continue;
          if (!best || g.cells > best.cells || (g.cells === best.cells && seq.length < best.seq.length)) best = { cells: g.cells, chain: g.chain, seq: seq, n: out };
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
      // the most connected board reached so far, if better than the one now: its first swap is a setup
      if (pool.length && pool[0].h > (setup ? setup.h : rootH)) setup = { h: pool[0].h, move: pool[0].seq[0] };
      var keep = new Set(pool.map(function (it) { return it.n; }));
      if (best) keep.add(best.n);
      var spent = outs.filter(function (x) { return x && !x.dead && !keep.has(x); });
      old.forEach(function (it) { if (it.n !== root && !keep.has(it.n)) spent.push(it.n); });
      if (spent.length) s.drop(spent);
    }
    if (!best) best = { cells: 0, chain: 0, seq: [] };
    best.setup = setup ? setup.move : null;
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
        var st = s.stepStats(out), g = sent(st);
        return { cells: g.cells, chain: g.chain };
      });
    }
    var base = sends([root])[0] || { cells: 0, chain: 0 };
    var best = { cells: base.cells, chain: base.chain, seq: [], base: base.cells };
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
        if (g.cells > best.cells) best = { cells: g.cells, chain: g.chain, seq: k.seq, base: base.cells };
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
    best.ms = Date.now() - t0;
    return best;
  }
  return { plan: plan, extend: extend };
};
