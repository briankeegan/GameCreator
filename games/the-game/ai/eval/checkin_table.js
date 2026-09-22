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

// LIVENESS FROM COMMIT TIMES, NOT FILE TIMES. A leg is 30 minutes and ends by
// committing a snapshot, so a variant with no snapshot commit in that window
// has a chain that stopped.
//
// A file's mtime is when THIS CHECKOUT wrote it, which a fetch-and-reset
// refreshes wholesale. Read that way, thirty-three dead chains reported as
// live for three hours: every snapshot file was present and every mtime was
// minutes old, because the sync had just rewritten them. The commit date is
// the only clock here that belongs to the run rather than to the reader.
//
// EXPECTED is stated, not inferred from what is on disk. Counting the
// variants that have a file cannot see the ones that never started, and a
// chain that died leaves its last file sitting there looking like a member
// in good standing.
var EXPECTED = Number(process.env.GC_VARIANTS || 35);
var WINDOW = 45 * 60 * 1000;
var cp = require('child_process');
var seen = {};
try {
  var log = cp.execSync('git log origin/main --since="6 hours ago" --format="%ct %s"',
                        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  log.split('\n').forEach(function (line) {
    var m = line.match(/^(\d+) .*\bof pbt-(r\d+|default|raise)-s\d+/);
    if (!m) return;
    var t = Number(m[1]) * 1000;
    if (!seen[m[2]] || t > seen[m[2]]) seen[m[2]] = t;
  });
} catch (e) {
  console.log('LIVENESS UNKNOWN — could not read git log: ' + e.message);
  seen = null;
}
if (seen) {
  var now = Date.now(), live = [], stale = [];
  Object.keys(seen).forEach(function (v) {
    var age = Math.round((now - seen[v]) / 60000);
    if (now - seen[v] > WINDOW) stale.push(v + ' ' + age + 'm'); else live.push(v);
  });
  console.log('LIVE ' + live.length + '/' + EXPECTED + ' variants committed a snapshot within 45m');
  if (stale.length) console.log('  STALE: ' + stale.join(', '));
  if (live.length < EXPECTED) {
    console.log('  MISSING ' + (EXPECTED - live.length) +
                ' — re-dispatch them; a variant with no recent commit is not training.');
  }
}
