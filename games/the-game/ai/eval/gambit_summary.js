#!/usr/bin/env node
// THE RUN, SUMMED: every game of a 24-game run (gambit-24.yml), read from each game's own results.txt and survivor.log -- per mode, how
// many survived and the frames the rest were lost at; the combos and chains made; the budgets (frames over the think budget, the
// slowest frame, keys dropped, late moves). One directory per game (DIR/<name>/results.txt, survivor.log).
//
//   node gambit_summary.js DIR
var fs = require('fs'), path = require('path');
var DIR = process.argv[2];
if (!DIR) { console.error('usage: node gambit_summary.js DIR'); process.exit(2); }
var modes = {}, budget = { over: 0, worst: 0, dropped: 0, late: 0, lateWorst: 0, games: 0 };
fs.readdirSync(DIR).sort().forEach(function (g) {
  var rf = path.join(DIR, g, 'results.txt'), lf = path.join(DIR, g, 'survivor.log');
  if (!fs.existsSync(rf)) return;
  var res = fs.readFileSync(rf, 'utf8'), m = /(\w+) training (lost|survived) frames=(\d+)/.exec(res);
  if (!m) return;
  var t = modes[m[1]] || (modes[m[1]] = { survived: 0, games: 0, lost: [], combo: {}, chain: {} });
  t.games++;
  if (m[2] === 'survived') t.survived++; else t.lost.push(+m[3]);
  var over = /thinkOver=(\d+)/.exec(res), worst = /thinkWorstMs=([\d.]+)/.exec(res), drop = /inputDropped=(\d+)/.exec(res);
  budget.games++;
  if (over) budget.over += +over[1];
  if (worst) budget.worst = Math.max(budget.worst, +worst[1]);
  if (drop) budget.dropped += +drop[1];
  if (fs.existsSync(lf)) {
    var over2 = fs.readFileSync(lf, 'utf8').split('\n').filter(function (l) { return l.indexOf('match over: ') >= 0; }).pop();
    if (over2) {
      var o = JSON.parse(over2.slice(over2.indexOf('match over: ') + 12));
      budget.late += o.late || 0; budget.lateWorst = Math.max(budget.lateWorst, o.late || 0);
      var a = o.attacks || {};
      ['combo', 'chain'].forEach(function (k) { Object.keys(a[k] || {}).forEach(function (z) { t[k][z] = (t[k][z] || 0) + a[k][z]; }); });
    }
  }
});
var all = 0, games = 0, fmt = function (o) { return Object.keys(o).sort(function (a, b) { return a - b; }).map(function (z) { return z + 'x' + o[z]; }).join(', ') || '-'; };
Object.keys(modes).sort().forEach(function (k) {
  var t = modes[k];
  all += t.survived; games += t.games;
  console.log(k + ': survived ' + t.survived + '/' + t.games + '; lost at ' + (t.lost.sort(function (a, b) { return a - b; }).join(', ') || '-') +
              '; combos ' + fmt(t.combo) + '; chains ' + fmt(t.chain));
});
console.log('SURVIVED ' + all + '/' + games);
console.log('budgets: ' + budget.over + ' frames over the think budget, slowest frame ' + budget.worst + ' ms, ' + budget.dropped + ' keys dropped, ' +
            budget.late + ' late moves (at most ' + budget.lateWorst + ' in a game), over ' + budget.games + ' games');
