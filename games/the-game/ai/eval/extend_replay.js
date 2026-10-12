// A CHAIN GOING, CONTINUED: node extend_replay.js [SEEDS] [FRAMES]
// From each seed's opening the planner's fire is made on the JS engine and the board run FRAMES frames into the cascade.
// Every swap then made on that board is settled on the JS engine and on the native engine: the chain each reaches, how far
// the engines agree, and how much longer a swap makes the chain than leaving it.
var path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), N = require(path.join(__dirname, 'native.js')).server;
var ATTACK = require(path.join(__dirname, 'survivor_attack.js'));
var SEEDS = (process.argv[2] || '1,2,3,4,5,6,7,8,9,10').split(',').map(Number), FRAMES = (process.argv[3] || '20,40,70').split(',').map(Number), W = 6;
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
function chainOf(stat) { var m = 0; for (var i = 0; i < stat.chainAt.length; i++) if (stat.chainAt[i] > m) m = stat.chainAt[i]; return m; }
N.init();
var S = new N.Search({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 });
var attacker = ATTACK({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 });
var agree = 0, tried = 0, gained = 0, cases = 0, bestSum = 0, baseSum = 0;
SEEDS.forEach(function (seed) {
  var b0 = opening(seed), ap = attacker.plan(b0.copy(), { left: 0, started: false }, { ms: 1500, width: 100, depth: 14, pool: 250, minChain: 2 });
  if (!ap.seq.length) return;
  var fired = b0.copy();
  ap.seq.forEach(function (m) { fired.curRow = m[0]; fired.curCol = m[1]; fired.tryQueueSwap(m[0], m[1]); if (m !== ap.seq[ap.seq.length - 1]) fired.settle(); });
  FRAMES.forEach(function (F) {
    var mid = fired.copy(), i;
    for (i = 0; i < F; i++) mid.run();
    var base = mid.copy().settle().chain, best = base, bestMove = null, js = {};
    // every swap of the board, on the JS engine
    var moves = [];
    for (var r = 1; r <= 11; r++) for (var c = 1; c < W; c++) moves.push([r, c]);
    moves.forEach(function (m) {
      var u = mid.copy(); u.curRow = m[0]; u.curCol = m[1];
      if (!u.tryQueueSwap(m[0], m[1])) return;
      var ch = u.settle().chain;
      js[m] = ch;
      if (ch > best) { best = ch; bestMove = m; }
    });
    // the same swaps on the native engine
    S.reset();
    var root = S.root(mid.copy(), { left: 0, started: false }, [], false), jobs = [], ms = [];
    Object.keys(js).forEach(function (k) { var m = k.split(',').map(Number); jobs.push([root, 'settle', m, 0]); ms.push(k); });
    var outs = jobs.length ? S.advanceMany(jobs, true) : [];
    outs.forEach(function (o, j) {
      if (!o || o.dead) return;
      tried++;
      if (chainOf(S.stepStats(o)) === js[ms[j]]) agree++;
    });
    cases++; baseSum += base; bestSum += best;
    if (best > base) gained++;
    console.log('seed ' + seed + ' frame +' + F + ': chain ' + base + ' left alone, ' + best + ' with a swap' + (bestMove ? ' at ' + bestMove : ''));
  });
});
console.log('native agrees with the JS engine on ' + agree + ' of ' + tried + ' swaps; a swap lengthens the chain in ' + gained + ' of ' + cases + ' cases (mean ' + (baseSum / cases).toFixed(2) + ' -> ' + (bestSum / cases).toFixed(2) + ')');
