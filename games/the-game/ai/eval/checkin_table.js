// THE CHECK-IN TABLE: one row per variant, at its newest snapshot.
//
// Counts are the holdout mirror's own, over 12 duels, never bucketed --
// chains at every link count, combos at every size -- because a three is
// not a combo and a 2-link is not a chain of 3.
var fs = require('fs'), path = require('path'), dir = __dirname;
var best = {};
fs.readdirSync(dir).forEach(function (n) {
  var m = n.match(/^trained\.pbt\.pbt-(r\d+|raise)-s\d+\..*\.g\d+\.json$/);
  if (!m) return;
  var s; try { s = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (e) { return; }
  if (!best[m[1]] || s.updates > best[m[1]].updates) { s.file = n; best[m[1]] = s; }
});
var rows = Object.keys(best).map(function (v) {
  var s = best[v], h = s.holdout.mirror, c4 = 0, c6 = 0, chs = [];
  Object.keys(h.comboBySize || {}).forEach(function (k) { if (+k >= 4) c4 += h.comboBySize[k]; if (+k >= 6) c6 += h.comboBySize[k]; });
  Object.keys(h.chainByLinks || {}).sort().forEach(function (k) { chs.push(k + 'x' + h.chainByLinks[k]); });
  var sec = s.holdout.avgFrames / 60;
  return { v: v, u: s.updates, ms: Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0'),
           ch: chs.join(',') || '-', c4: c4, c6: c6, thr: h.threes || 0, pay: h.paylessClears || 0,
           oc: h.openedChain || 0, br: h.brokeGarbage || 0, sent: h.avgSent };
});
rows.sort(function (a, b) { return b.u - a.u; });
console.log('var   upd  m:ss chainsByLink      c4+ c6+ threes(pay/open) broke  sent');
rows.forEach(function (r) {
  console.log([r.v.padEnd(5), String(r.u).padStart(4), r.ms.padStart(5), r.ch.padEnd(17),
               String(r.c4).padStart(3), String(r.c6).padStart(3),
               (r.thr + '(' + r.pay + '/' + r.oc + ')').padStart(12),
               String(r.br).padStart(4), r.sent.toFixed(1).padStart(6)].join(' '));
});
// NO "BEST openedChain". One variant topping that column across 35 noisy
// 12-duel holdouts is a draw, not a result. The per-row count stays, since
// it is what separates a three that started a chain from a wasted one.
var bc = rows.slice().sort(function (a, b) { return b.c6 - a.c6; })[0];
console.log('best 6+ combos ' + bc.c6 + ' (' + bc.v + ')');

// LIVENESS WITHOUT THE ACTIONS API. A leg is 30 minutes and ends by
// committing a snapshot, so a variant whose newest snapshot is much older
// than that has a chain that stopped. Cheaper and just as decisive as
// listing 100 workflow runs, and it reads the thing that actually matters:
// whether work is still landing.
var now = Date.now(), stale = [];
Object.keys(best).forEach(function (v) {
  var t = fs.statSync(path.join(dir, best[v].file || '')).mtimeMs;
  if (now - t > 45 * 60 * 1000) stale.push(v + ' ' + Math.round((now - t) / 60000) + 'm');
});
console.log(stale.length ? 'STALE (>45m since last snapshot): ' + stale.join(', ')
                         : 'all ' + Object.keys(best).length + ' variants landed a snapshot within 45m');
