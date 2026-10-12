// THE ATTACK PLANNER ON A MATCH'S OPENING: node opener_plan.js [SEEDS] [OPTIONS-JSON]
// The line survivor_attack.js plans from each seed's opening board, replayed on the JS engine: the chain it makes.
var path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), N = require(path.join(__dirname, 'native.js')).server;
var ATTACK = require(path.join(__dirname, 'survivor_attack.js'));
var SEEDS = (process.argv[2] || '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
var OPTS = Object.assign({ ms: 1500, width: 100, depth: 14, pool: 250, minChain: 4 }, JSON.parse(process.argv[3] || '{}')), W = 6;
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
// the line played on the JS engine: the chain of the swap that fires
function replay(b0, seq) {
  var b = b0, last = null;
  seq.forEach(function (m) {
    var t = b.copy(); t.curRow = m[0]; t.curCol = m[1]; t.tryQueueSwap(m[0], m[1]);
    var r = t.settle();
    if (r.chain > 0 || r.combos.length) last = { chain: r.chain, combos: r.combos.join('+') };
    b = t;
  });
  return last;
}
N.init();
var attacker = ATTACK({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 }), got = {}, total = 0;
SEEDS.forEach(function (seed) {
  var b0 = opening(seed), ap = attacker.plan(b0.copy(), { left: 0, started: false }, OPTS), re = ap.seq.length ? replay(b0, ap.seq) : null;
  var chain = re ? re.chain : 0;
  got[chain] = (got[chain] || 0) + 1;
  total += chain;
  console.log('seed ' + seed + ': planned chain ' + ap.chain + ' (' + ap.cells + ' cells) in ' + ap.seq.length + ' swaps, ' + ap.ms + ' ms; the JS engine makes chain ' + chain + (re ? ' combos ' + re.combos : ''));
});
console.log('chains made: ' + JSON.stringify(got) + ', mean ' + (total / SEEDS.length).toFixed(2));
