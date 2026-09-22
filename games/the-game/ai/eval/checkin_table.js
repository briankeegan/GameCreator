// LIVENESS FROM THE SNAPSHOT'S OWN STAMP, AND ONLY THIS RULES VERSION.
//
// A leg ends by writing a snapshot, so a variant with none inside the window
// has a chain that stopped. Two earlier versions of this got it wrong in
// opposite directions. File mtimes say when THIS CHECKOUT wrote the file,
// which the check-in's own fetch-and-reset refreshes wholesale — thirty-three
// dead chains read as live for three hours. Counting any snapshot commit then
// counted the PREVIOUS rules version's dying chains as this run's members.
//
// The stamp in the filename is the run's own clock and the rules field says
// which run wrote it, so the two together answer it without asking git
// anything. MMDD-HHMMSS, read as UTC in the current year.
//
// EXPECTED is stated, not counted off the files: a variant that never started
// leaves nothing behind to count.
var EXPECTED = Number(process.env.GC_VARIANTS || 35);
var WINDOW = 45 * 60 * 1000;
function stampMs(st) {
  var m = st.match(/^(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!m) return 0;
  return Date.UTC(new Date().getUTCFullYear(), +m[1] - 1, +m[2], +m[3], +m[4], +m[5]);
}

var fs = require('fs'), path = require('path'), dir = __dirname;
// NEWEST BY THE STAMP IN THE NAME, NOT BY updates.
//
// A rules change restarts every population, and a restarted run counts
// updates from zero. Ranking on updates therefore pins the table to the run
// with the MOST history, which after a restart is always the dead one — it
// kept showing a 2,720-update row per variant while the live run was landing
// snapshots at 40. The stamp is the run's own clock and cannot be beaten by
// a corpse. It is MMDD-HHMMSS, so it sorts as text within a year and not
// across one.
//
// The tag is read, not enumerated. It was `(r\d+|raise)`, which stopped
// matching the moment seed 301's tag changed to `default`, and that variant
// then had no row at all rather than a visibly missing one.
// ONE RULES VERSION PER TABLE. modes.RULES names the decision procedure, and
// a population fitted under one played a different game from a population
// fitted under the next — their rows are not rivals, they are two experiments
// printed in one grid. A snapshot records the RULES it was trained under, so
// this is decided by the file rather than by whoever is reading it.
//
// Snapshots from before the field existed are excluded for the same reason:
// an unknown procedure is not this one.
var RULES = require('./modes.js').RULES;
var best = {}, wrongRules = 0;
fs.readdirSync(dir).forEach(function (n) {
  var m = n.match(/^trained\.pbt\.pbt-([A-Za-z0-9]+)-s\d+\.(\d{4}-\d{6})\.g\d+\.json$/);
  if (!m) return;
  var s; try { s = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (e) { return; }
  if (s.rules !== RULES) { wrongRules++; return; }
  if (!best[m[1]] || m[2] > best[m[1]].stamp) { s.file = n; s.stamp = m[2]; best[m[1]] = s; }
});
// LIVE VARIANTS ONLY. A dead chain's last snapshot is not a reading, it is a
// gravestone — and printed in the same table as the running ones it reads as
// the state of the run. Stale variants are named on their own line, with how
// long they have been gone, which is the only thing about them worth knowing.
var now = Date.now(), live = {}, stale = [];
Object.keys(best).forEach(function (v) {
  var age = now - stampMs(best[v].stamp);
  if (age > WINDOW) stale.push(v + ' ' + Math.round(age / 60000) + 'm'); else live[v] = true;
});
var liveCount = Object.keys(live).length;

var rows = Object.keys(best).filter(function (v) { return live[v]; }).map(function (v) {
  var s = best[v], h = s.holdout.mirror, c4 = 0, c6 = 0, chs = [];
  Object.keys(h.comboBySize || {}).forEach(function (k) { if (+k >= 4) c4 += h.comboBySize[k]; if (+k >= 6) c6 += h.comboBySize[k]; });
  Object.keys(h.chainByLinks || {}).sort().forEach(function (k) { chs.push(k + 'x' + h.chainByLinks[k]); });
  var sec = s.holdout.avgFrames / 60;
  return { v: v, u: s.updates, ms: Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0'),
           ch: chs.join(',') || '-', c4: c4, c6: c6, thr: h.threes || 0, pay: h.paylessClears || 0,
           oc: h.openedChain || 0, br: h.brokeGarbage || 0, sent: h.avgSent };
});
rows.sort(function (a, b) { return b.u - a.u; });
console.log('rules ' + RULES + ' — ' + wrongRules + ' snapshots from an earlier rules version ignored');
console.log('LIVE ' + liveCount + '/' + EXPECTED + ' variants wrote a rules-' + RULES +
            ' snapshot within 45m');
if (stale.length) console.log('STALE: ' + stale.join(', '));
if (liveCount < EXPECTED) {
  console.log('MISSING ' + (EXPECTED - liveCount) +
              ' — re-dispatch them; a variant with no recent snapshot is not training.');
}
if (!rows.length) {
  console.log('\nNo live variant has landed a rules-' + RULES + ' snapshot yet — no table.');
  process.exit(0);
}
console.log('\nvar   upd  m:ss chainsByLink      c4+ c6+ threes(pay/open) broke  sent');
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

