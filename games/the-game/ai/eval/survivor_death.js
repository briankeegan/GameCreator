// node survivor_death.js DUMP [FRAMES_BEFORE]: the board a WasmSurvivor game
// died on, from the match survivor.js dumped (GC_SURVIVOR_DUMP): the grid
// FRAMES_BEFORE (default 200) frames before the end on, with the garbage
// queued, and every decision answered in those frames.
var fs = require('fs');
var lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n'), d = JSON.parse(lines[lines.length - 1]);
var back = Number(process.argv[3]) || 200, h = d.history || [];
if (!h.length) { console.log('no history in the dump'); process.exit(0); }
var last = h[h.length - 1], earlier = h[Math.max(0, h.length - 1 - back)];
function rows(hs) { return hs.reduce(function (t, h) { return t + h; }, 0); }
function show(e) {
  var inc = e.incoming || [], arr = e.arrivals || [];
  return ['clock ' + e.clock + ' cursor ' + JSON.stringify(e.cursor) + ' health ' + e.health + ' stop ' + e.stop +
          ' queued ' + inc.length + ' pieces (' + rows(inc.map(function (g) { return g.height; })) + ' rows)' +
          ' arriving ' + arr.length + ' (' + rows(arr.map(function (a) { return a[2]; })) + ' rows' + (arr.length ? ', first at ' + arr[0][0] : '') + ')'].concat(e.grid);
}
// the boards every BOARD_EVERY frames from FRAMES_BEFORE on, then every
// decision answered in those frames
var BOARD_EVERY = 40, out = [], from = last.clock - back;
for (var i = Math.max(0, h.length - 1 - back); i < h.length - 1; i += BOARD_EVERY) out = out.concat(show(h[i]), ['']);
out = out.concat(show(last), ['', 'decisions from clock ' + from + ':']);
(d.decided || []).filter(function (x) { return x.now >= from; }).forEach(function (x) {
  var g = x.diag || {};
  out.push('  #' + x.id + ' for ' + x.at + ' asked ' + x.asked + ' got ' + x.now + ': ' + x.kind + ' ' + JSON.stringify(x.move) + ' ' + x.ms + ' ms' +
           ' | budget ' + g.budget + ' took ' + g.took + ' survive ' + g.survive + ' doomed ' + g.doomed + ' allDoomed ' + g.allDoomed +
           ' unproven ' + g.unproven + (g.tight ? ' TIGHT' : ''));
});
console.log(out.join('\n'));
