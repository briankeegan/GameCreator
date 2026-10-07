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
var BOARD_EVERY = 60, out = [], from = last.clock - back;
for (var i = Math.max(0, h.length - 1 - back); i < h.length - 1; i += BOARD_EVERY) out = out.concat(show(h[i]), ['']);
out = out.concat(show(last), ['', 'decisions from clock ' + from + ' (id asked>for@answered kind ms budget survive-ms doomed):']);
function line(x) {
  var g = x.diag || {};
  return (x.id + ' ' + x.asked + '>' + x.at + '@' + x.now + ' ' + x.kind + (x.move ? x.move.join(',') : '') + ' ' + x.ms + 'ms b' + g.budget +
           ' s' + g.survive + ' d' + g.doomed + (g.allDoomed ? ' ALLDOOMED' : '') + (g.tight ? ' TIGHT' : ''));
}
(d.decided || []).filter(function (x) { return x.now >= from; }).forEach(function (x) { out.push(line(x)); });
// WHERE IT WAS LOST: the board the last unbroken run of all-doomed
// decisions began on, and the decisions around it.
var dec = d.decided || [], k = dec.length;
while (k > 0 && dec[k - 1].diag && dec[k - 1].diag.allDoomed) k--;
if (k < dec.length) {
  var first = dec[k], at = first.asked !== null && first.asked !== undefined ? first.asked : first.now;
  var hi = h.filter(function (e) { return e.clock <= at; }).pop();
  out.push('', 'ALL DOOMED from decision ' + first.id + ' (asked at ' + at + ')' + (k === 0 ? ', the dump\'s first kept' : '') + ':');
  if (hi) out = out.concat(show(hi));
  dec.slice(Math.max(0, k - 8), k + 4).forEach(function (x) { out.push(line(x)); });
}
console.log(out.join('\n'));
