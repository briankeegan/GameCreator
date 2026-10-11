// THE OPENING'S ATTACKS, on the native engine: node opener_native.js [SEEDS] [WIDTH] [DEPTH] [ROUNDS]
//
// From a match's opening board: a round is a beam search over swaps that clear nothing, each board
// ranked by the best fire one more swap makes from it, ending in the line to the biggest fire found.
// The next round goes on from the board that fire leaves, so the opener is a big chain and the
// combos after it. Prints, per seed, each round's fire replayed on the JS engine.
var path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), N = require(path.join(__dirname, 'native.js')).server;
var SEEDS = (process.argv[2] || '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
var WIDTH = Number(process.argv[3]) || 120, DEPTH = Number(process.argv[4]) || 14, ROUNDS = Number(process.argv[5]) || 3, POOL = 500, W = 6;

function opening(seed) {
  var g = PA.game({ seed: seed, level: 10, countdown: false }), rows = [], r, c, top = 0;
  for (r = 1; r <= g.height; r++) for (c = 1; c <= W; c++) if (g.panels[r][c].color > 0) top = Math.max(top, r);
  for (r = g.height; r >= 1; r--) {
    var row = '';
    for (c = 1; c <= W; c++) { var p = g.panels[r][c]; row += (r <= top && p.color > 0 && p.color <= 7 && !p.isGarbage) ? p.color : 0; }
    rows.push(row);
  }
  return PA.puzzle(rows.join(''));
}
function comboCells(size) { var n = 0, ps = PA.comboGarbage(size); for (var i = 0; i < ps.length; i++) n += ps[i][0] * ps[i][1]; return n; }
// what a step's clears send: each clear's combo garbage and a slab for the chain they make
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
function replay(b0, seq) {
  var b = b0, fires = [];
  seq.forEach(function (m) {
    var t = b.copy(); t.curRow = m[0]; t.curCol = m[1]; t.tryQueueSwap(m[0], m[1]);
    var r = t.settle(), cells = 0;
    r.garbage.forEach(function (g) { cells += g[0] * g[1]; });
    if (r.chain > 0 || r.combos.length) fires.push({ at: seq.indexOf(m) + 1, cells: cells, chain: r.chain, combos: r.combos.join('+') });
    b = t;
  });
  return fires;
}
N.init();
var S = new N.Search({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 });
// One round from `root`: the line of swaps that clear nothing, ended by the swap that fires the most.
function round(root, depth) {
  var pool = [{ n: root, seq: [], h: 0 }], best = null, steps = 0;
  for (var d = 1; d <= depth && pool.length; d++) {
    var jobs = [], meta = [];
    pool.forEach(function (it) { it.n.b.legalSwaps().forEach(function (m) { jobs.push([it.n, 'settle', m, 0]); meta.push([it, m]); }); });
    var outs = S.advanceMany(jobs, true);
    steps += jobs.length;
    pool.forEach(function (it) { it.reach = 0; it.kids = []; });
    for (var i = 0; i < outs.length; i++) {
      var o = outs[i], it = meta[i][0], m = meta[i][1];
      if (!o || o.dead) continue;
      var st = S.stepStats(o);
      if (st.cleared > 0) {
        var g = sent(st), seq = it.seq.concat([m]);
        if (g.cells > it.reach) it.reach = g.cells;
        if (!best || g.cells > best.cells || (g.cells === best.cells && seq.length < best.seq.length)) best = { cells: g.cells, chain: g.chain, seq: seq, n: o };
      } else it.kids.push({ n: o, seq: it.seq.concat([m]) });
    }
    // the boards with the biggest fire one swap away carry on; of those, their quiet children
    pool.sort(function (a, b) { return b.reach - a.reach || b.h - a.h; });
    var seen = {}, next = [];
    pool.slice(0, WIDTH).forEach(function (it) {
      it.kids.forEach(function (k) {
        var key = String(k.n.b.key);
        if (seen[key]) return;
        seen[key] = 1;
        next.push({ n: k.n, seq: k.seq, h: connected(k.n.b.grid) });
      });
    });
    next.sort(function (a, b) { return b.h - a.h; });
    pool = next.slice(0, POOL);
  }
  if (best) best.steps = steps;
  return best;
}
var grand = 0;
SEEDS.forEach(function (seed) {
  var t0 = Date.now(), b0 = opening(seed), total = 0, parts = [], seq = [];
  S.reset();
  var root = S.root(b0.copy(), { left: 0, started: false }, [], false), left = DEPTH;
  for (var k = 0; k < ROUNDS; k++) {
    var got = round(root, k === 0 ? DEPTH : Math.max(3, left));
    if (!got) break;
    seq = seq.concat(got.seq);
    parts.push(got);
    root = got.n;
    left -= got.seq.length;
  }
  var fires = replay(b0, seq), cells = fires.reduce(function (a, f) { return a + f.cells; }, 0);
  grand += cells;
  console.log('seed ' + seed + ': ' + cells + ' cells in ' + seq.length + ' swaps (' + fires.map(function (f) { return 'swap ' + f.at + ': chain ' + f.chain + ' combos ' + f.combos + ' = ' + f.cells; }).join('; ') + '), ' + (Date.now() - t0) + ' ms');
});
console.log('mean cells ' + (grand / SEEDS.length).toFixed(1));
