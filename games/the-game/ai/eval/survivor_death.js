// node survivor_death.js DUMP [FRAMES_BEFORE]: the board a WasmSurvivor game
// died on, from the match survivor.js dumped (GC_SURVIVOR_DUMP): the grid
// FRAMES_BEFORE (default 60) frames before the end and at the end, with
// the garbage queued, and the last decisions taken.
var fs = require('fs');
var lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n'), d = JSON.parse(lines[lines.length - 1]);
var back = Number(process.argv[3]) || 60, h = d.history || [];
if (!h.length) { console.log('no history in the dump'); process.exit(0); }
var last = h[h.length - 1], earlier = h[Math.max(0, h.length - 1 - back)];
function rows(hs) { return hs.reduce(function (t, h) { return t + h; }, 0); }
function show(e) {
  var inc = e.incoming || [], arr = e.arrivals || [];
  return ['clock ' + e.clock + ' cursor ' + JSON.stringify(e.cursor) + ' health ' + e.health + ' stop ' + e.stop +
          ' queued ' + inc.length + ' pieces (' + rows(inc.map(function (g) { return g.height; })) + ' rows)' +
          ' arriving ' + arr.length + ' (' + rows(arr.map(function (a) { return a[2]; })) + ' rows' + (arr.length ? ', first at ' + arr[0][0] : '') + ')'].concat(e.grid);
}
var out = show(earlier).concat([''], show(last), ['', 'last decisions:']);
(d.decided || []).slice(-6).forEach(function (x) {
  out.push('  #' + x.id + ' at ' + x.at + ' (asked ' + x.asked + ') ' + x.kind + ' ' + JSON.stringify(x.move) + ' ' + x.ms + ' ms' +
           (x.diag ? ' doomed ' + x.diag.doomed + ' allDoomed ' + x.diag.allDoomed + ' tight ' + !!x.diag.tight : ''));
});
console.log(out.join('\n'));
