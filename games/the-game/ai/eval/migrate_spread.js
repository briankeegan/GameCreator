// HOW FAR THE INJECTED GENOME HAS SPREAD, and what the medians look like
// without it counted eight times.
//
// A migrated donor that wins its duels becomes the champion of several
// variants at once, and every one of them then reports the SAME holdout row.
// The median across variants is a median across genomes only while the
// genomes are distinct: once a donor is champion in 8 of 35, the raw median
// is partly a measure of the donor. Both numbers are printed so the spread
// is visible rather than folded into the result.
var fs = require('fs'), crypto = require('crypto'), path = require('path');
var dir = __dirname;
function hash(w) {
  return crypto.createHash('sha1')
    .update(Object.keys(w).sort().map(function (k) { return k + '=' + w[k]; }).join('|'))
    .digest('hex').slice(0, 10);
}
var injPath = path.join(dir, 'inject.json');
var donor = fs.existsSync(injPath) ? hash(JSON.parse(fs.readFileSync(injPath, 'utf8')).weights) : null;
var best = {};
fs.readdirSync(dir).forEach(function (n) {
  var m = n.match(/^trained\.pbt\.pbt-(r\d+|raise)-s\d+\..*\.g\d+\.json$/);
  if (!m) return;
  var s; try { s = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (e) { return; }
  if (!best[m[1]] || s.updates > best[m[1]].updates) best[m[1]] = s;
});
var groups = {};
Object.keys(best).forEach(function (v) { var h = hash(best[v].weights); (groups[h] = groups[h] || []).push(v); });
Object.keys(groups).forEach(function (h) {
  if (groups[h].length > 1) {
    console.log('same genome x' + groups[h].length +
                (h === donor ? ' [DONOR]' : ' [independent]') + ': ' + groups[h].join(','));
  }
});
function med(a) { a = a.slice().sort(function (x, y) { return x - y; }); var n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; }
function line(label, vars) {
  var rows = vars.map(function (v) {
    var h = best[v].holdout.mirror, c6 = 0, ch3 = 0;
    Object.keys(h.comboBySize || {}).forEach(function (k) { if (+k >= 6) c6 += h.comboBySize[k]; });
    Object.keys(h.chainByLinks || {}).forEach(function (k) { if (+k >= 3) ch3 += h.chainByLinks[k]; });
    return { pay: h.paylessClears || 0, c6: c6, ch3: ch3, sent: h.avgSent };
  });
  console.log(label + ' N=' + rows.length +
    '  payless ' + med(rows.map(function (r) { return r.pay; })) +
    '  6+ combos ' + med(rows.map(function (r) { return r.c6; })) +
    '  chains 3+ ' + med(rows.map(function (r) { return r.ch3; })) +
    '  avgSent ' + med(rows.map(function (r) { return r.sent; })).toFixed(1));
}
line('ALL VARIANTS     ', Object.keys(best));
line('DISTINCT GENOMES ', Object.keys(groups).map(function (h) { return groups[h][0]; }));
