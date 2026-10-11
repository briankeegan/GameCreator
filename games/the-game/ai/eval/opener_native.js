// THE OPENING'S ATTACKS, on the native engine: node opener_native.js [SEEDS] [WIDTH] [DEPTH]
//
// From a match's opening board, a beam search over swaps in which a swap that fires does not end a
// line: the line goes on from the board the fire leaves, so one line can be a big chain and the
// combos after it. A line is ranked by the garbage cells its fires have sent, then by how connected
// its board is. Prints, per seed, the best line replayed on the JS engine: each fire's cells and chain.
var path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), N = require(path.join(__dirname, 'native.js')).server;
var SEEDS = (process.argv[2] || '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
var WIDTH = Number(process.argv[3]) || 150, DEPTH = Number(process.argv[4]) || 14, W = 6;

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
var S = new N.Search({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 }), grand = 0;
SEEDS.forEach(function (seed) {
  var t0 = Date.now(), b0 = opening(seed);
  S.reset();
  var root = S.root(b0.copy(), { left: 0, started: false }, [], false);
  var beam = [{ n: root, cum: 0, seq: [], h: 0 }], best = beam[0], steps = 0;
  for (var d = 1; d <= DEPTH; d++) {
    var jobs = [], meta = [];
    beam.forEach(function (it) { it.n.b.legalSwaps().forEach(function (m) { jobs.push([it.n, 'settle', m, 0]); meta.push([it, m]); }); });
    if (!jobs.length) break;
    var outs = S.advanceMany(jobs, true), seen = {}, next = [];
    steps += jobs.length;
    for (var i = 0; i < outs.length; i++) {
      var o = outs[i];
      if (!o || o.dead) continue;
      var st = S.stepStats(o), g = st.cleared > 0 ? sent(st) : { cells: 0, chain: 0 }, it = meta[i][0];
      var cand = { n: o, cum: it.cum + g.cells, seq: it.seq.concat([meta[i][1]]), h: 0 };
      var key = String(o.b.key);
      if (seen[key] && seen[key].cum >= cand.cum) continue;
      cand.h = connected(o.b.grid);
      seen[key] = cand;
    }
    Object.keys(seen).forEach(function (k) { next.push(seen[k]); });
    next.sort(function (a, b) { return b.cum - a.cum || b.h - a.h; });
    beam = next.slice(0, WIDTH);
    if (beam.length && beam[0].cum > best.cum) best = beam[0];
  }
  var fires = replay(b0, best.seq), cells = fires.reduce(function (a, f) { return a + f.cells; }, 0);
  grand += cells;
  console.log('seed ' + seed + ': ' + cells + ' cells in ' + best.seq.length + ' swaps (' + fires.map(function (f) { return 'swap ' + f.at + ': chain ' + f.chain + ' combos ' + f.combos + ' = ' + f.cells; }).join('; ') + '), ' + steps + ' steps, ' + (Date.now() - t0) + ' ms');
});
console.log('mean cells ' + (grand / SEEDS.length).toFixed(1));
