// THE ATTACK PLANNER: while the board is safe, the line of swaps to the biggest fire the board can reach.
//
// A beam search on the native engine over swaps that clear nothing, each board ranked by the best fire one
// swap from it; the line ends in the swap that fires the most garbage. plan() returns that line, and the
// caller plays its first swap and plans again on the board that follows (the stack rises, so a line is
// never carried across a decision). Used by survivor_think.js for a profile with `attack`.
var path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), N = require(path.join(__dirname, 'native.js')).server;
var W = 6;
function comboCells(size) { var n = 0, ps = PA.comboGarbage(size); for (var i = 0; i < ps.length; i++) n += ps[i][0] * ps[i][1]; return n; }
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
  // o: { ms, width, depth, pool }
  function plan(board, hold, o) {
    var s = search(), t0 = Date.now(), best = null;
    s.reset();
    var root = s.root(board.copy(), hold, [], false);
    var pool = [{ n: root, seq: [], h: 0 }];
    for (var d = 1; d <= o.depth && pool.length && Date.now() - t0 < o.ms; d++) {
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
          if (g.cells > it.reach) it.reach = g.cells;
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
      var keep = new Set(pool.map(function (it) { return it.n; }));
      if (best) keep.add(best.n);
      var spent = outs.filter(function (x) { return x && !x.dead && !keep.has(x); });
      old.forEach(function (it) { if (it.n !== root && !keep.has(it.n)) spent.push(it.n); });
      if (spent.length) s.drop(spent);
    }
    if (best) best.ms = Date.now() - t0;
    return best;
  }
  return { plan: plan };
};
