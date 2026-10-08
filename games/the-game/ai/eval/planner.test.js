#!/usr/bin/env node
// THE DISTANCE PLANNER ON EXAMPLE BOARDS (bot.c targetLines): it must find a
// break where one is in reach, and every line it proposes must break when
// played -- replayed here on a grid of its own (swaps, falls, clears, chains).
// Rows are given top first: digits colours, '.' empty, 'g' garbage (a run in
// a row is one slab).
var assert = require('assert'), BN = require('./bitnative.js');
var W = 6, N = 6;
function state(rows) {
  var st = { W: W, H: 12, N: N, occ: [], inert: [], garb: [], colour: new Int32Array((N + 1) * (W + 2)), slabs: [], slabLocked: [], slabAir: [] };
  for (var c = 0; c <= W + 1; c++) { st.occ[c] = 0; st.inert[c] = 0; st.garb[c] = 0; }
  rows.slice().reverse().forEach(function (row, i) {
    var b = 1 << i, slab = null;
    for (var c = 1; c <= W; c++) {
      var ch = row[c - 1];
      if (ch === '.') { slab = null; continue; }
      st.occ[c] |= b;
      if (ch === 'g') {
        if (!slab) { slab = new Int32Array(W + 2); st.slabs.push(slab); st.slabLocked.push(false); st.slabAir.push(0); }
        st.inert[c] |= b; st.garb[c] |= b; slab[c] |= b;
      } else { slab = null; st.colour[(+ch) * (W + 2) + c] |= b; }
    }
  });
  return st;
}
// the replay: g[r][c], row 0 the bottom; garbage holds where it is
function grid(rows) {
  var H = rows.length, g = [];
  for (var r = 0; r < H; r++) { g.push([]); for (var c = 0; c < W; c++) { var ch = rows[H - 1 - r][c]; g[r].push(ch === '.' ? 0 : ch === 'g' ? -1 : +ch); } }
  return g;
}
function settle(g) {
  for (var c = 0; c < W; c++) {
    var to = 0;
    for (var r = 0; r < g.length; r++) { var v = g[r][c]; if (!v) continue; if (v < 0) { to = r + 1; continue; } if (to !== r) { g[to][c] = v; g[r][c] = 0; } to++; }
  }
}
function resolve(g) {   // 1 if a clear touches garbage
  for (;;) {
    var mk = [], H = g.length;
    for (var r = 0; r < H; r++) for (var c = 0; c < W; c++) {
      var a = g[r][c], e = c, t = r, k;
      if (a <= 0) continue;
      while (e + 1 < W && g[r][e + 1] === a) e++;
      if (e - c >= 2) for (k = c; k <= e; k++) mk.push([r, k]);
      while (t + 1 < H && g[t + 1][c] === a) t++;
      if (t - r >= 2) for (k = r; k <= t; k++) mk.push([k, c]);
    }
    if (!mk.length) return 0;
    var broke = mk.some(function (p) {
      return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (d) { var rr = p[0] + d[0], cc = p[1] + d[1]; return rr >= 0 && rr < H && cc >= 0 && cc < W && g[rr][cc] === -1; });
    });
    if (broke) return 1;
    mk.forEach(function (p) { g[p[0]][p[1]] = 0; });
    settle(g);
  }
}
function breaks(rows, line) {
  var g = grid(rows);
  return line.some(function (s) {
    var r = s[0] - 1, c = s[1] - 1, x = g[r][c], y = g[r][c + 1];
    g[r][c] = y; g[r][c + 1] = x; settle(g);
    return resolve(g) === 1;
  });
}
function check(name, rows) {
  var lines = BN.targetLines(state(rows), 1, 1);
  assert.ok(lines.length > 0, name + ': no line proposed');
  lines.forEach(function (l) { if (l.whole) assert.ok(breaks(rows, l), name + ': ' + JSON.stringify(l) + ' does not break'); });
  console.log('planner: ' + name + ': ' + lines.length + ' lines, each breaks, e.g. ' + JSON.stringify(lines[0]));
}
// seed 21's last board (combo_storm): the pile rests on one 5. Moving the 3
// under column 2's 5 aside drops it; a swap then makes 5-5-5 in column 1.
check('pull a support, then swap', ['gggg..', '..gggg', '.gggg.', 'gggg..', '5.....', '55...1', '63..31', '266.26', '144155', '163322', '255233', '245516']);
// two 5s walked over column 3 drop onto its 5: three against the pile
check('walk off a ledge', ['gggggg', '5....5', '13.214', '265352', '341236', '126451', '463125', '214362']);
