#!/usr/bin/env node
// IS THERE A SOLVE? For every game Gambit lost in a run, the boards its break search came up empty on (GAMBITB) in the last LAST
// frames: the panels under the lowest garbage counted by colour, and the break search asked again (MS). A board with three or more of
// a colour under the garbage and no break found is one the search's reach is in question on -- printed, the grid drawn, for a look.
//
//   node gambit_solvable.js RUN [LAST] [MS] [DRAW]     LAST frames before each loss (600), MS a board (1000), DRAW boards drawn (6)
var fs = require('fs'), path = require('path');
var RUN = process.argv[2], LAST = Number(process.argv[3]) || 600, MS = Number(process.argv[4]) || 1000, DRAW = process.argv[5] === undefined ? 6 : Number(process.argv[5]);
if (!RUN) { console.error('usage: node gambit_solvable.js RUN [LAST] [MS] [DRAW]'); process.exit(2); }
var O = { reaction: 12, swapGap: 12, cursorMoveFrames: 4 }, G = new (require('../gambit/gambit.js').Gambit)(O);
var rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'survivor-profiles', 'gambit-rules.json'), 'utf8'));
var list = rules.attack.filter(function (r) { return r.name === 'finish them'; })[0].aims.filter(function (a) { return typeof a !== 'string'; });
var X = G.X, COL = ' RGBYPCMSX';
function cells() {
  var n = X.gb_cells(), w = new Int32Array(X.memory.buffer, X.gb_io() >>> 0, n), rows = w[0], g = [];
  for (var r = 0; r < rows; r++) { g.push([]); for (var c = 0; c < 6; c++) { var k = 3 + (r * 6 + c) * 3; g[r].push({ color: w[k], garbage: w[k + 1], state: w[k + 2] }); } }
  return g;
}
var tot = { boards: 0, three: 0, threeNone: 0, none: 0, popping: 0, falling: 0, rest: 0 }, drawn = 0, games = 0, lostGames = 0;
fs.readdirSync(RUN).filter(function (d) { return d.indexOf('gambit-') === 0; }).forEach(function (d) {
  var res = path.join(RUN, d, 'results.txt'); if (!fs.existsSync(res)) return;
  var m = /lost frames=(\d+)/.exec(fs.readFileSync(res, 'utf8')); games++; if (!m) return; lostGames++;
  var end = Number(m[1]), seen = {};
  fs.readFileSync(path.join(RUN, d, 'survivor.log'), 'utf8').split('\n').forEach(function (l) {
    if (l.indexOf('GAMBITB ') !== 0) return;
    var p = l.split(' '), at = Number(p[1]); if (end - at > LAST || seen[at]) return; seen[at] = 1;
    var b = /C\d+:(\S+)/.exec(l); if (!b) return;
    var arr = []; try { arr = JSON.parse(p[3] || '[]'); } catch (e) { arr = []; }
    var found = G.breakOnBytes(b[1], arr, list, MS, 0, null);
    var g = cells(), low = g.length;
    for (var r = 0; r < g.length && low === g.length; r++) for (var c = 0; c < 6; c++) if (g[r][c].garbage) { low = r; break; }
    var by = {}; for (var r2 = 1; r2 < low; r2++) for (var c2 = 0; c2 < 6; c2++) { var v = g[r2][c2]; if (!v.garbage && v.color > 0 && v.color < 8) by[v.color] = (by[v.color] || 0) + 1; }
    var most = Math.max.apply(null, [0].concat(Object.keys(by).map(function (k) { return by[k]; })));
    // (what the garbage is doing: popping -- a break already converting it, no new one possible on it till it ends; falling; at rest)
    var gs = 'rest'; g.forEach(function (row) { row.forEach(function (v) { if (!v.garbage) return; if (v.state >= 3 && v.state <= 5) gs = 'popping'; else if ((v.state === 6 || v.state === 7) && gs === 'rest') gs = 'falling'; }); });
    tot.boards++; if (!found) tot.none++; if (most >= 3) { tot.three++; if (!found) { tot.threeNone++; tot[gs]++; } }
    if (!found && most >= 3 && gs === 'rest' && drawn < DRAW) {
      drawn++;
      console.log(d + ' frame ' + at + ' (' + ((end - at) / 60).toFixed(1) + 's before the loss): no break found in ' + MS + 'ms; under the garbage ' + JSON.stringify(by));
      for (var r3 = g.length - 1; r3 >= 0; r3--) {
        var s = '';
        for (var c3 = 0; c3 < 6; c3++) { var q = g[r3][c3]; s += q.garbage ? '#' : q.color ? COL[q.color] || '?' : '.'; }
        if (s !== '......') console.log('   ' + (r3 < 10 ? ' ' : '') + r3 + ' ' + s + (r3 === low ? '   <- lowest garbage' : ''));
      }
    }
  });
});
console.log(JSON.stringify({ games: games, lost: lostGames, boards: tot.boards, noBreakFound: tot.none, threeOfAColourUnderGarbage: tot.three, threeButNoBreakFound: tot.threeNone, ofThemGarbagePopping: tot.popping, falling: tot.falling, atRest: tot.rest }));
