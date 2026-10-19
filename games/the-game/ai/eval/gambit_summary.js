#!/usr/bin/env node
// THE RUN, SUMMED: every game of a 24-game run (gambit-24.yml), read from each game's own results.txt and survivor.log -- per mode, how
// many survived and the frames the rest were lost at; the combos and chains made; the budgets (frames over the think budget, the
// slowest frame, keys dropped, late moves); and each mode's aim -- of the attacks a game played in one mode fired (combos of four or more,
// chains of two or more, as the game counts them), the share that met one of the mode's aims (gambit-rules.json). One directory per
// game (DIR/<name>/results.txt, survivor.log).
//
//   node gambit_summary.js DIR
var fs = require('fs'), path = require('path');
var DIR = process.argv[2];
if (!DIR) { console.error('usage: node gambit_summary.js DIR'); process.exit(2); }
var RULES = JSON.parse(fs.readFileSync(path.join(__dirname, 'survivor-profiles/gambit-rules.json'), 'utf8')).attack || [];
var aims = {};   // by the mode a game played throughout: { met, all }
var walk = { n: 0, cells: 0, far: 0 };   // the cells from one swap the decisions played to the next (want=r,c), and the jumps of 6 or more
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
// AGGRESSION: the blocks of garbage thrown a minute (a combo's pieces of combo garbage, a chain's slab for every link past the first),
// with the attacks that threw them and their cells, over the frames played
var aggr = { blocks: 0, attacks: 0, cells: 0, frames: 0 };
// (blocks left on the table: decisions where an option that lives throws more blocks than the one played -- the log's opts, first the
// one played, each :L when it lives and :bN for the blocks it throws)
var forgone = { decisions: 0, missed: 0, blocks: 0 };
var think = { wall: [], br: [], brUnder: [] };   // each decision's wall ms (wallMs=) and the break search's (brMs=), under garbage apart
var cutShort = { boards: 0, cut: 0 };     // decisions where the board was making a chain of its own (own=A/B), and those that cut it short
var modes = {}, links = {}, turns = {}, nturns = 0, lostIn = {}, budget = { over: 0, worst: 0, dropped: 0, late: 0, lateWorst: 0, games: 0, decisions: 0, out: 0, diverged: 0, divergedGames: 0, starved: 0, inHand: 0 };
fs.readdirSync(DIR).sort().forEach(function (g) {
  var rf = path.join(DIR, g, 'results.txt'), lf = path.join(DIR, g, 'survivor.log');
  if (!fs.existsSync(rf)) return;
  var res = fs.readFileSync(rf, 'utf8'), m = /(\w+) training (lost|survived) frames=(\d+)/.exec(res);
  if (!m) return;
  var t = modes[m[1]] || (modes[m[1]] = { survived: 0, games: 0, lost: [], combo: {}, chain: {}, dec: 0, under: 0, mat: 0, pan: 0 });
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
    var was = null, one = null, switched = false, last = null;
    lines.forEach(function (l) {
      if (l.indexOf('GAMBITD ') !== 0) return;
      var w = / want=(\d+),(\d+)/.exec(l);
      if (w) { var r = +w[1], c = +w[2]; if (last) { var d = Math.abs(r - last[0]) + Math.abs(c - last[1]); walk.n++; walk.cells += d; if (d >= 6) walk.far++; } last = [r, c]; }
      else last = null;
      var wm = / wallMs=([\d.]+)/.exec(l), bm = / brMs=([\d.]+)/.exec(l);
      // (the board's state: decisions under garbage, and the material and panels there)
      var um = / under=(\d)/.exec(l), mm = / mat=([\d.]+)/.exec(l), pm = / pan=(\d+)/.exec(l);
      if (um) { t.dec++; if (+um[1] && mm) { t.under++; t.mat += +mm[1]; t.pan += pm ? +pm[1] : 0; } }
      if (wm) think.wall.push(+wm[1]);
      if (bm) (/ under=1/.test(l) ? think.brUnder : think.br).push(+bm[1]);
      var op = / opts=(\S+)/.exec(l);
      if (op) {
        var os = op[1].split(','), bl = function (s) { var m = /:b(\d+)/.exec(s); return m ? +m[1] : 0; }, played = bl(os[0]), best = 0;
        os.forEach(function (s) { if (/:L(:|$)/.test(s)) best = Math.max(best, bl(s)); });
        forgone.decisions++;
        if (best > played) { forgone.missed++; forgone.blocks += best - played; }
      }
      var o = / own=(\d+)\/(\d+)/.exec(l);
      if (o) { cutShort.boards++; if (+o[2] < +o[1]) cutShort.cut++; }
    });
    lines.forEach(function (l) {
      var d = /^GAMBITD \d+ (.*?) play=/.exec(l);
      if (!d) return;
      if (/ switched=1/.test(l) && was && was !== d[1]) { var k = was + ' -> ' + d[1]; turns[k] = (turns[k] || 0) + 1; nturns++; }
      if (one === null) one = d[1]; else if (one !== d[1]) switched = true;
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
      if (one && !switched) aimOf(one, a);
      aggr.frames += o.frames || 0;
      Object.keys(a.combo || {}).forEach(function (z) { var g = PA.comboGarbage(+z); aggr.attacks += a.combo[z]; aggr.blocks += a.combo[z] * g.length; aggr.cells += a.combo[z] * g.reduce(function (s, w) { return s + w; }, 0); });
      Object.keys(a.chain || {}).forEach(function (z) { aggr.attacks += a.chain[z]; aggr.blocks += a.chain[z] * (+z - 1); aggr.cells += a.chain[z] * 6 * (+z - 1); });
      // (every chain link past two, by its cause: garbage's colours, a swap since the link before, or the stack alone)
      Object.keys(o.linkBy || {}).forEach(function (w) { Object.keys(o.linkBy[w]).forEach(function (z) { var m = links[w] || (links[w] = {}); m[z] = (m[z] || 0) + o.linkBy[w][z]; }); });
    }
  }
});
// (a test from the rules file: ">=8", "==5", "<=3")
function test(v, s) { var m = /^(>=|<=|==|>|<)(\d+)$/.exec(s); if (!m) return false; var n = +m[2];
  return m[1] === '>=' ? v >= n : m[1] === '<=' ? v <= n : m[1] === '==' ? v === n : m[1] === '>' ? v > n : v < n; }
// (an attack against an aim, as rules.c meets reads it: an aim naming a combo and no chain is one clear of that size)
function meetsAim(aim, combo, chain) {
  if (aim.combo && !aim.chain && chain > 1) return false;
  if (aim.combo && !test(combo, aim.combo)) return false;
  if (aim.chain && !test(chain, aim.chain)) return false;
  return !!(aim.combo || aim.chain);
}
function aimOf(mode, a) {
  var rule = RULES.filter(function (r) { return r.name === mode; })[0];
  if (!rule) return;
  var t = aims[mode] || (aims[mode] = { met: 0, all: 0 });
  var count = function (n, combo, chain) { t.all += n; if ((rule.aims || []).some(function (x) { return meetsAim(x, combo, chain); })) t.met += n; };
  Object.keys(a.combo || {}).forEach(function (z) { count(a.combo[z], +z, 1); });
  Object.keys(a.chain || {}).forEach(function (z) { count(a.chain[z], 0, +z); });
}
var all = 0, games = 0, fmt = function (o) { return Object.keys(o).sort(function (a, b) { return a - b; }).map(function (z) { return z + 'x' + o[z]; }).join(', ') || '-'; };
Object.keys(modes).sort().forEach(function (k) {
  var t = modes[k];
  all += t.survived; games += t.games;
  console.log(k + ': survived ' + t.survived + '/' + t.games + '; lost at ' + (t.lost.sort(function (a, b) { return a - b; }).join(', ') || '-') +
              '; combos ' + fmt(t.combo) + '; chains ' + fmt(t.chain) +
              (t.dec ? '; under garbage ' + Math.round(100 * t.under / t.dec) + '% of decisions, material there ' + (t.under ? (t.mat / t.under).toFixed(1) : '-') : ''));
});
console.log('SURVIVED ' + all + '/' + games);
Object.keys(aims).sort().forEach(function (k) { var t = aims[k]; console.log('aim, ' + k + ': ' + t.met + ' of ' + t.all + ' attacks met it' + (t.all ? ' (' + Math.round(100 * t.met / t.all) + '%)' : '')); });
if (nturns) {
  console.log('switches: ' + nturns + ' in all, ' + Object.keys(turns).length + ' directions -- ' + Object.keys(turns).sort().map(function (k) { return k + ' x' + turns[k]; }).join(', '));
  console.log('lost while playing: ' + (Object.keys(lostIn).sort().map(function (k) { return k + ' x' + lostIn[k]; }).join(', ') || '-'));
}
if (aggr.frames) console.log('aggression: ' + (aggr.blocks * 3600 / aggr.frames).toFixed(1) + ' blocks thrown a minute (' + (aggr.attacks * 3600 / aggr.frames).toFixed(1) + ' attacks, ' + Math.round(aggr.cells * 3600 / aggr.frames) + ' garbage cells a minute; ' + Math.round(aggr.frames / 3600) + ' minutes)');
if (forgone.decisions) console.log('blocks left on the table: ' + forgone.missed + ' of ' + forgone.decisions + ' decisions offered a line that lives and throws more than the one played (' + forgone.blocks + ' blocks)');
if (walk.n) console.log('walk: ' + (walk.cells / walk.n).toFixed(1) + ' cells from one swap to the next, ' + Math.round(100 * walk.far / walk.n) + '% of ' + walk.n + ' jumps 6 or more');
var pct = function (a, q) { if (!a.length) return '-'; var s = a.slice().sort(function (x, y) { return x - y; }); return String(Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))])); };
if (think.wall.length) console.log('think: a decision ' + pct(think.wall, 0.5) + ' ms (90% under ' + pct(think.wall, 0.9) + '); the break search ' + pct(think.brUnder, 0.5) + ' ms under garbage (90% under ' + pct(think.brUnder, 0.9) + '), ' + pct(think.br, 0.5) + ' otherwise');
console.log('the board\'s own chain: ' + cutShort.boards + ' decisions while it made one, ' + cutShort.cut + ' cut it short');
if (Object.keys(links).length) console.log('chain links past two, by cause: ' + ['garbage', 'swap', 'alone'].map(function (w) { return w + ' ' + fmt(links[w] || {}); }).join('; '));
console.log('budgets: ' + budget.over + ' frames over the think budget, slowest frame ' + budget.worst + ' ms, ' + budget.dropped + ' keys dropped, ' +
            budget.late + ' late moves (at most ' + budget.lateWorst + ' in a game), over ' + budget.games + ' games');
if (budget.decisions) console.log('decisions the clock cut: ' + budget.out + ' of ' + budget.decisions + ' (' + (100 * budget.out / budget.decisions).toFixed(1) + '%)');
// THE TRUTH: every board the frame loop predicted is the one the game made; one that is not is a plan made on a board that never was
console.log('truth: ' + budget.diverged + ' boards predicted otherwise than the game made them, in ' + budget.divergedGames + ' of ' + budget.games + ' games');
console.log('decisions left no time to judge anything: ' + budget.starved + ' (the move in hand played for ' + budget.inHand + ')');
