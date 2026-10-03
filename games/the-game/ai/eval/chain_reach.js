// HOW FAR AWAY IS THE NEXT CHAIN? Run: node chain_reach.js
//
// THE QUESTION THIS SETTLES. Scoring a move on its FULLY RESOLVED board
// should make lookahead unnecessary for any chain that fires now: the
// cascade is already in the number. So if depth 2 buys nothing, either the
// resolve is not really cascading, or the chains it would find are further
// away than one extra ply. This measures both, on the game's own 84 chain
// puzzles, in about half a minute.
//
// ANSWER, on the server's rules (pa-engine.js, PAEngine.puzzle):
//   Q1  a swap that sets off a 3-link cascade is seen whole by settling the
//       board once: chain 3, combos 3+3+3.
//   Q2  fewest swaps before a 2+ link chain exists at all:
//           1 swap   15 puzzles     <- depth 1 already takes all 15
//           2 swaps  15 puzzles     <- the entire ceiling on depth 2
//           3 swaps  19 puzzles
//           4+/never 35 puzzles
//
// Reaching the other 35 means searching four-plus swaps ahead: ~30 legal
// swaps a ply is ~810,000 boards per decision against an 85ms budget, so
// that door is closed by arithmetic, not by tuning.
//
// Which is the reference's point in ../PUYO_REFERENCE.md: Tier 2 is search
// AND named chain templates, "it does not discover chain shapes, it is told
// them". You cannot search your way to a chain that is four swaps out; you
// price how close the board is to a shape you already know.
var path = require('path'), fs = require('fs');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
var FILE = process.env.GC_PUZZLES || path.join(__dirname, '..', '..', '..', '..', '..', 'panel-game', 'client', 'assets', 'default_data', 'puzzles', 'Puzzles.json');
function puzzles() {
  var j = JSON.parse(fs.readFileSync(FILE, 'utf8')), o = [];
  (function w(n, t) {
    (n['Puzzle Sets'] || []).forEach(function (s) { w(s, t.concat(s['Set Name'] || '?')); });
    (n['Puzzles'] || []).forEach(function (p) { o.push({ set: t.join('/'), p: p }); });
  })(j, []);
  return o;
}
// The puzzle's stack on the server's rules, or null when it is not all digits.
function boardFrom(stack) { return /[^0-9\s]/.test(String(stack)) ? null : PA.puzzle(stack); }
// The board after swap m, played until nothing moves, and what it did.
function play(b, m) {
  var t = b.copy();
  t.curRow = m[0]; t.curCol = m[1];
  t.tryQueueSwap(m[0], m[1]);
  return { board: t, r: t.settle() };
}
function key(b) {
  var k = '';
  for (var r = 1; r <= b.height; r++) for (var c = 1; c <= 6; c++) k += b.panels[r][c].color;
  return k;
}

var chains = puzzles().filter(function (x) { return x.p['Puzzle Type'] === 'chain'; });

// ---- Q1 ----
var deep = null;
chains.forEach(function (x) {
  if (deep) return;
  var b = boardFrom(x.p.Stack);
  if (!b) return;
  b.legalSwaps().forEach(function (m) {
    if (deep) return;
    var r = play(b, m).r;
    if (r.chain >= 3) deep = { set: x.set.split('/').pop(), m: m, r: r };
  });
});
if (deep) {
  console.log('Q1  ' + deep.set + ': swap ' + JSON.stringify(deep.m) + ' -> a ' + deep.r.chain + '-link chain, combos ' +
              deep.r.combos.join('+') + ', ' + deep.r.garbage.length + ' garbage pieces earned, in ' + deep.r.frames + ' frames.');
}

// ---- Q2: minimum swaps to make a chain appear, brute force ----
function minSwapsToChain(b, limit) {
  var seen = {}, frontier = [b];
  for (var d = 1; d <= limit; d++) {
    var next = [];
    for (var i = 0; i < frontier.length; i++) {
      var legal = frontier[i].legalSwaps();
      for (var j = 0; j < legal.length; j++) {
        var got = play(frontier[i], legal[j]);
        if (got.r.chain >= 2) return d;
        if (d < limit) { var k = key(got.board); if (!seen[k]) { seen[k] = 1; next.push(got.board); } }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return null;
}

var hist = {}, none = 0, n = 0;
chains.forEach(function (x) {
  var b = boardFrom(x.p.Stack);
  if (!b) return;
  n++;
  var d = minSwapsToChain(b, 3);
  if (d === null) none++; else hist[d] = (hist[d] || 0) + 1;
});
console.log('\nQ2  fewest swaps needed before a 2+ link chain fires, over ' + n + ' chain puzzles:');
Object.keys(hist).sort().forEach(function (k) { console.log('      ' + k + ' swap(s): ' + hist[k]); });
console.log('      more than 3 (or never): ' + none);
