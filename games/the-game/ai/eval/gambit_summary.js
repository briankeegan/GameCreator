#!/usr/bin/env node
// THE RUN, SUMMED: every game of a 24-game run (gambit-24.yml), read from each game's own results.txt and survivor.log -- per mode, how
// many survived and the frames the rest were lost at; the combos and chains made; the budgets (frames over the think budget, the
// slowest frame, keys dropped, late moves). One directory per game (DIR/<name>/results.txt, survivor.log).
//
//   node gambit_summary.js DIR
var fs = require('fs'), path = require('path');
var DIR = process.argv[2];
if (!DIR) { console.error('usage: node gambit_summary.js DIR'); process.exit(2); }
var modes = {}, links = {}, turns = {}, nturns = 0, lostIn = {}, budget = { over: 0, worst: 0, dropped: 0, late: 0, lateWorst: 0, games: 0, decisions: 0, out: 0, diverged: 0, divergedGames: 0, starved: 0, inHand: 0 };
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
    var lines = fs.readFileSync(lf, 'utf8').split('\n');
    // (the decisions the clock cut: what a faster or slower machine would have played differently)
    lines.forEach(function (l) { if (l.indexOf('GAMBITD ') !== 0) return; var c = / out=(\d+)/.exec(l); if (!c) return; budget.decisions++; if (+c[1]) budget.out++; });
    // (SWITCHING: each switch by its direction -- the mode before it to the mode after -- and the mode a lost game was lost in)
    var was = null;
    lines.forEach(function (l) {
      var d = /^GAMBITD \d+ (.*?) play=/.exec(l);
      if (!d) return;
      if (/ switched=1/.test(l) && was && was !== d[1]) { var k = was + ' -> ' + d[1]; turns[k] = (turns[k] || 0) + 1; nturns++; }
      was = d[1];
    });
    if (m[2] === 'lost' && was) lostIn[was] = (lostIn[was] || 0) + 1;
    var over2 = lines.filter(function (l) { return l.indexOf('match over: ') >= 0; }).pop();
    if (over2) {
      var o = JSON.parse(over2.slice(over2.indexOf('match over: ') + 12));
      budget.late += o.late || 0; budget.lateWorst = Math.max(budget.lateWorst, o.late || 0);
      budget.diverged += o.diverged || 0; if (o.diverged) budget.divergedGames++;
      budget.starved += o.starved || 0; budget.inHand += o.inHand || 0;
      var a = o.attacks || {};
      ['combo', 'chain'].forEach(function (k) { Object.keys(a[k] || {}).forEach(function (z) { t[k][z] = (t[k][z] || 0) + a[k][z]; }); });
      // (every chain link past two, by its cause: garbage's colours, a swap since the link before, or the stack alone)
      Object.keys(o.linkBy || {}).forEach(function (w) { Object.keys(o.linkBy[w]).forEach(function (z) { var m = links[w] || (links[w] = {}); m[z] = (m[z] || 0) + o.linkBy[w][z]; }); });
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
if (nturns) {
  console.log('switches: ' + nturns + ' in all, ' + Object.keys(turns).length + ' directions -- ' + Object.keys(turns).sort().map(function (k) { return k + ' x' + turns[k]; }).join(', '));
  console.log('lost while playing: ' + (Object.keys(lostIn).sort().map(function (k) { return k + ' x' + lostIn[k]; }).join(', ') || '-'));
}
if (Object.keys(links).length) console.log('chain links past two, by cause: ' + ['garbage', 'swap', 'alone'].map(function (w) { return w + ' ' + fmt(links[w] || {}); }).join('; '));
console.log('budgets: ' + budget.over + ' frames over the think budget, slowest frame ' + budget.worst + ' ms, ' + budget.dropped + ' keys dropped, ' +
            budget.late + ' late moves (at most ' + budget.lateWorst + ' in a game), over ' + budget.games + ' games');
if (budget.decisions) console.log('decisions the clock cut: ' + budget.out + ' of ' + budget.decisions + ' (' + (100 * budget.out / budget.decisions).toFixed(1) + '%)');
// THE TRUTH: every board the frame loop predicted is the one the game made; one that is not is a plan made on a board that never was
console.log('truth: ' + budget.diverged + ' boards predicted otherwise than the game made them, in ' + budget.divergedGames + ' of ' + budget.games + ' games');
console.log('decisions left no time to judge anything: ' + budget.starved + ' (the move in hand played for ' + budget.inHand + ')');
