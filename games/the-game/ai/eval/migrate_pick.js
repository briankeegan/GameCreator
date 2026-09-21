// Rank each variant by the MEDIAN of its last N snapshots, not its newest.
// One snapshot is 12 duels and swings hard: r03 went 19.7 -> 11.4 avgSent and
// 16 -> 1 six-plus combos in 40 updates. A donor picked off a single high
// reading is picked off noise.
var fs = require('fs'), N = Number(process.argv[2] || 3);
var f = fs.readdirSync('.').filter(function (n) { return /^trained\.pbt\.pbt-(r\d+|raise)-s\d+\..*\.g\d+\.json$/.test(n); });
var by = {};
f.forEach(function (n) {
  var m = n.match(/pbt-(r\d+|raise)-/); var s;
  try { s = JSON.parse(fs.readFileSync(n, 'utf8')); } catch (e) { return; }
  (by[m[1]] = by[m[1]] || []).push({ n: n, s: s });
});
function med(a) { a = a.slice().sort(function (x, y) { return x - y; }); var k = a.length; return k % 2 ? a[(k - 1) / 2] : (a[k / 2 - 1] + a[k / 2]) / 2; }
function score(s) {
  var h = s.holdout.mirror, F = s.holdout.avgFrames * h.duels / 1000, c6 = 0, ch3 = 0;
  Object.keys(h.comboBySize || {}).forEach(function (k) { if (+k >= 6) c6 += h.comboBySize[k]; });
  Object.keys(h.chainByLinks || {}).forEach(function (k) { if (+k >= 3) ch3 += h.chainByLinks[k]; });
  return h.avgSent + 4 * (c6 / F) + 20 * (ch3 / F) - 3 * (h.paylessClears / F);
}
var rows = Object.keys(by).map(function (v) {
  var list = by[v].sort(function (a, b) { return b.s.updates - a.s.updates; }).slice(0, N);
  return { v: v, k: list.length, r: med(list.map(function (e) { return score(e.s); })),
           top: list.map(function (e) { return { f: e.n, sc: score(e.s) }; }).sort(function (a, b) { return b.sc - a.sc; })[0] };
});
rows.sort(function (a, b) { return b.r - a.r; });
rows.slice(0, 8).forEach(function (r) { console.log(r.v, 'n=' + r.k, 'medrank', r.r.toFixed(1)); });
console.log('DONOR', rows[0].v, rows[0].top.f);
