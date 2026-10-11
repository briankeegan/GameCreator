// THE OPENING'S BIGGEST ATTACK: node opener_search.js [SEEDS] [MS] [WIDTH] [DEPTH]
//
// The board a match starts on is quiet for the countdown and the seconds after it. From it, a beam
// search over sequences of swaps that clear nothing, each sequence ended by the swap that fires the
// most garbage (the board as the server's rules settle it). Prints, per seed, the garbage cells the
// best sequence sends, its chain, its swaps, and the search's time.
var path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
var SEEDS = (process.argv[2] || '1,2,3,4,5,6,7,8').split(',').map(Number);
var MS = Number(process.argv[3]) || 3000, WIDTH = Number(process.argv[4]) || 40, DEPTH = Number(process.argv[5]) || 12;
var W = 6;

// the opening board as a puzzle: the same panels, no rise
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
function play(b, m) {
  var t = b.copy();
  t.curRow = m[0]; t.curCol = m[1];
  t.tryQueueSwap(m[0], m[1]);
  return { board: t, r: t.settle() };
}
function cells(r) { var n = 0; for (var i = 0; i < r.garbage.length; i++) n += r.garbage[i][0] * r.garbage[i][1]; return n; }
function key(b) { var k = ''; for (var r = 1; r <= b.height; r++) for (var c = 1; c <= W; c++) k += b.panels[r][c].color; return k; }
// how connected the board is: same-coloured neighbours, vertical ones worth more
function connected(b) {
  var n = 0, r, c;
  for (r = 1; r <= b.height; r++) for (c = 1; c <= W; c++) {
    var k = b.panels[r][c].color;
    if (k <= 0) continue;
    if (c < W && b.panels[r][c + 1].color === k) n += 1;
    if (r < b.height && b.panels[r + 1][c].color === k) n += 2;
  }
  return n;
}
function search(b0, ms) {
  var t0 = Date.now(), best = { cells: 0, chain: 0, seq: [] }, beam = [{ b: b0, seq: [] }], plays = 0;
  for (var d = 1; d <= DEPTH && Date.now() - t0 < ms; d++) {
    var seen = {}, next = [];
    for (var i = 0; i < beam.length && Date.now() - t0 < ms; i++) {
      var node = beam[i], legal = node.b.legalSwaps();
      for (var j = 0; j < legal.length; j++) {
        var got = play(node.b, legal[j]); plays++;
        var seq = node.seq.concat([legal[j]]);
        if (got.r.chain > 0 || got.r.combos.length) {
          var sc = cells(got.r);
          if (sc > best.cells || (sc === best.cells && seq.length < best.seq.length)) best = { cells: sc, chain: got.r.chain, combos: got.r.combos.join('+'), seq: seq };
        } else {
          var k = key(got.board);
          if (!seen[k]) { seen[k] = 1; next.push({ b: got.board, seq: seq, h: connected(got.board) }); }
        }
      }
    }
    next.sort(function (a, b) { return b.h - a.h; });
    beam = next.slice(0, WIDTH);
    if (!beam.length) break;
  }
  best.ms = Date.now() - t0; best.plays = plays;
  return best;
}
// the best a single swap does, for comparison
function oneSwap(b) {
  var best = 0;
  b.legalSwaps().forEach(function (m) { var c = cells(play(b, m).r); if (c > best) best = c; });
  return best;
}
var total = 0, base = 0;
SEEDS.forEach(function (seed) {
  var b = opening(seed), one = oneSwap(b), got = search(b, MS);
  total += got.cells; base += one;
  console.log('seed ' + seed + ': one swap sends ' + one + ' cells; best sequence sends ' + got.cells + ' (chain ' + got.chain + (got.combos ? ', combos ' + got.combos : '') + ') in ' + got.seq.length + ' swaps, ' + got.ms + ' ms, ' + got.plays + ' plays');
});
console.log('mean cells: one swap ' + (base / SEEDS.length).toFixed(1) + ', sequence ' + (total / SEEDS.length).toFixed(1));
