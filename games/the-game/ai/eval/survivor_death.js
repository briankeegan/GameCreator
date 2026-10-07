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
  // compact records ([pieces, rows], [pieces, rows, first due], one grid string), or full ones
  var inc = e.incoming || [], arr = e.arrivals || [], grid = typeof e.grid === 'string' ? e.grid.split('\n') : e.grid;
  var qn = typeof inc[0] === 'number' ? inc[0] : inc.length, qr = typeof inc[0] === 'number' ? inc[1] : rows(inc.map(function (g) { return g.height; }));
  var an = typeof arr[0] === 'number' ? arr[0] : arr.length, ar = typeof arr[0] === 'number' ? arr[1] : rows(arr.map(function (a) { return a[2]; }));
  var first = typeof arr[0] === 'number' ? arr[2] : (arr.length ? arr[0][0] : null);
  return ['clock ' + e.clock + ' cursor ' + JSON.stringify(e.cursor) + ' health ' + e.health + ' stop ' + e.stop +
          ' queued ' + qn + ' pieces (' + qr + ' rows) arriving ' + an + ' (' + ar + ' rows' + (first !== null ? ', first at ' + first : '') + ')'].concat(grid);
}
// the boards every BOARD_EVERY frames from FRAMES_BEFORE on, then every
// decision answered in those frames
var BOARD_EVERY = 60, out = [], from = last.clock - back;
for (var i = Math.max(0, h.length - 1 - back); i < h.length - 1; i += BOARD_EVERY) out = out.concat(show(h[i]), ['']);
out = out.concat(show(last), ['', 'decisions from clock ' + from + ' (id asked>for@answered kind ms budget survive-ms doomed):']);
function line(x) {
  var g = x.diag || {};
  return (x.id + ' ' + x.asked + '>' + x.at + '@' + x.now + ' ' + x.kind + (x.move ? x.move.join(',') : '') + ' ' + x.ms + 'ms b' + g.budget +
           ' s' + g.survive + ' d' + g.doomed + (g.allDoomed ? ' ALLDOOMED' : '') + (g.tight ? ' TIGHT' : '') +
           (x.breaks ? ' BREAK' + x.breaks.offered + (x.breaks.lineup ? 'L' : '') + (x.breaks.took ? ' taken' : ' NOT TAKEN') : ''));
}
(d.decided || []).filter(function (x) { return x.now >= from; }).forEach(function (x) { out.push(line(x)); });
// WHERE IT WAS LOST: the board the last unbroken run of all-doomed
// decisions began on, and the decisions around it.
var dec = d.decided || [], k = dec.length;
while (k > 0 && dec[k - 1].diag && (dec[k - 1].diag.allDoomed || dec[k - 1].diag.tight)) k--;
if (k < dec.length) {
  var first = dec[k], at = first.asked !== null && first.asked !== undefined ? first.asked : first.now;
  var hi = h.filter(function (e) { return e.clock <= at; }).pop();
  out.push('', 'ALL DOOMED from decision ' + first.id + ' (asked at ' + at + ')' + (k === 0 ? ', the dump\'s first kept' : '') + ':');
  if (hi) out = out.concat(show(hi));
  dec.slice(Math.max(0, k - 8), k + 4).forEach(function (x) { out.push(line(x)); });
}
// BREAKS NOT TAKEN: the board at each of the last four, and what was played.
var skipped = dec.filter(function (x) { return x.breaks && !x.breaks.took; }).slice(-4);
skipped.forEach(function (x) {
  var at = x.asked !== null && x.asked !== undefined ? x.asked : x.now, hi = h.filter(function (e) { return e.clock <= at; }).pop();
  out.push('', 'BREAK NOT TAKEN at decision ' + x.id + ': ' + line(x));
  if (hi) out = out.concat(show(hi));
});
console.log(out.join('\n'));
