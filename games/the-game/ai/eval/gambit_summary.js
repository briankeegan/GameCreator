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
// (why a line in progress was not carried on, by decide.c's carryDrop code)
var carryWhy = {}, CARRY_WHY = { 1: 'its anchor panel gone', 2: 'a step no longer there', 3: 'it no longer breaks', 5: 'no longer what it was begun for (offered all the same)',
  6: 'played as a wait that is no carry', 7: 'its tier past the last, nothing broken', 8: 'no bottom-row panel to find it by', 9: 'the hold played' };
var allow = { n: 0, at: [0, 0, 0, 0], drop2: 0, drop2cut0: 0, why: { a: 0, n: 0, w: 0 }, cut: [0, 0, 0], cutBr: [0, 0, 0] };   // (the input allowance each decision was made under: 0-5, 6-20, 21-40, over 40 left; the lines in progress cut at their next swap)
var walk = { n: 0, cells: 0, far: 0 };   // the cells from one swap the decisions played to the next (want=r,c), and the jumps of 6 or more
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
// AGGRESSION: the blocks of garbage thrown a minute (a combo's pieces of combo garbage, a chain's slab for every link past the first),
// with the attacks that threw them and their cells, over the frames played
var aggr = { blocks: 0, attacks: 0, cells: 0, frames: 0 }, rule = {};
// (blocks left on the table: decisions where an option that lives throws more blocks than the one played -- the log's opts, first the
// one played, each :L when it lives and :bN for the blocks it throws)
var forgone = { decisions: 0, missed: 0, blocks: 0 };
var think = { wall: [], br: [], brUnder: [] };   // each decision's wall ms (wallMs=) and the break search's (brMs=), under garbage apart
// decisions where the board was making a chain of its own (own=A/B), and those that cut it short -- while a line that lives kept it
// (ownKept=N, the hold among them: the plan's 0), while lines lived and every one cut it, or while none lived (the line played was lost
// latest)
var cutShort = { boards: 0, cut: 0, cutKept: 0, cutAll: 0, cutNone: 0 };
// EVERY MOVE ON THE WAY: the swaps pressed by what they came to, and the cells the cursor walked (front.c moveOn)
var moves = { clear: 0, setup: 0, break: 0, none: 0, open: 0, cells: 0, together: 0, wasted: 0, wastedAlone: 0, refusedWaste: 0, saved: 0, guardLet: 0, refusedSpoil: 0 };   // (wasted: clears of three that broke nothing and were no chain's link)
// SEVERAL IDEAS AT ONCE: the lines firing two ideas offered and played (pair=N/played), the blocks the lines played threw (thrown=), and
// the ideas left ready on the board a line played leaves, where the rank asked (ideas=)
var several = { pairOff: 0, pairPlayed: 0, thrownLines: 0, thrown: 0, thrown2: 0, ideasN: 0, ideas: 0, ideas2: 0 };
var modes = {}, links = {}, turns = {}, nturns = 0, lostIn = {}, budget = { over: 0, worst: 0, dropped: 0, late: 0, lateWorst: 0, games: 0, decisions: 0, out: 0, diverged: 0, divergedGames: 0, behind: 0, behindGames: 0, behindWorst: 0, starved: 0, inHand: 0, guarded: 0, refused: 0 };
var kept = { n: 0, held: 0 };
// LOSSES BY CAUSE: the decisions of a lost game's last 600 frames read for why it was lost -- the input window run dry, the panels run
// out, the hold played over a line lost later, no break found -- the first that holds its tag; the numbers it was read from beside it
var causes = { by: {}, list: [] };
function causeOf(game, pattern, at, lines) {
  var ds = [];
  lines.forEach(function (l) {
    if (l.indexOf('GAMBITD ') !== 0) return;
    var t = +l.split(' ')[1];
    if (t <= at && t >= at - 600) ds.push({ t: t, l: l });
  });
  if (!ds.length) return;
  var num = function (l, k) { var m = new RegExp(' ' + k + '=(-?\\d+)').exec(l); return m ? +m[1] : null; };
  var last = ds.filter(function (d) { return d.t >= at - 300; });
  var minAllow = 99, holdSooner = 0, noBreak = 0, raises = 0, cut = 0;
  last.forEach(function (d) {
    var a = num(d.l, 'allow'); if (a !== null && a >= 0 && a < minAllow) minAllow = a;
    if (/ play=(hold|carry_wait) /.test(d.l) && / sooner=/.test(d.l)) holdSooner++;
    if (/ br=(0\/|none)/.test(d.l)) noBreak++;
    if (/ out=1/.test(d.l)) cut++;
  });
  ds.forEach(function (d) { if (/ play=raise /.test(d.l)) raises++; });
  var matEnd = num(ds[ds.length - 1].l, 'mat'), mat600 = num(ds[0].l, 'mat');
  var tag = minAllow <= 5 ? 'actions' : (matEnd !== null && matEnd < 20) || (mat600 !== null && mat600 < 22) ? 'panels' :
            holdSooner >= 3 ? 'hold-creep' : last.length && noBreak / last.length > 0.6 ? 'no-break' : 'other';
  causes.by[tag] = (causes.by[tag] || 0) + 1;
  causes.list.push({ game: game, at: at, tag: tag, why: 'allow min ' + minAllow + ', panels ' + mat600 + ' to ' + matEnd + ', holds lost sooner ' + holdSooner +
                     ', no break ' + noBreak + ' of ' + last.length + ', raises ' + raises + ', decisions the clock cut ' + cut });
}
var sooner = { n: 0, dec: 0, by: {} };   // (decisions that played a line lost sooner than one offered, by the key that put it first)   // (a life kept: lines that lived, nothing new told, and the next decision's)
fs.readdirSync(DIR).sort().forEach(function (g) {
  var rf = path.join(DIR, g, 'results.txt'), lf = path.join(DIR, g, 'survivor.log');
  if (!fs.existsSync(rf)) return;
  var res = fs.readFileSync(rf, 'utf8'), m = /(\w+) training (lost|survived) frames=(\d+)/.exec(res);
  if (!m) return;
  var t = modes[m[1]] || (modes[m[1]] = { survived: 0, games: 0, lost: [], combo: {}, chain: {}, dec: 0, under: 0, mat: 0, pan: 0 });
  t.games++;
  if (m[2] === 'survived') t.survived++; else t.lost.push(+m[3]);
  if (m[2] === 'lost' && fs.existsSync(lf)) causeOf(g, m[1], +m[3], fs.readFileSync(lf, 'utf8').split('\n'));
  var over = /thinkOver=(\d+)/.exec(res), worst = /thinkWorstMs=([\d.]+)/.exec(res), drop = /inputDropped=(\d+)/.exec(res);
  budget.games++;
  if (over) budget.over += +over[1];
  if (worst) budget.worst = Math.max(budget.worst, +worst[1]);
  if (drop) budget.dropped += +drop[1];
  if (fs.existsSync(lf)) {
    var lines = fs.readFileSync(lf, 'utf8').split('\n');
    // (the decisions the clock cut: what a faster or slower machine would have played differently)
    lines.forEach(function (l) { if (l.indexOf('GAMBITD ') !== 0) return; var c = / out=(\d+)/.exec(l); if (!c) return; budget.decisions++; if (+c[1]) budget.out++; });
    // (A LIFE KEPT: a line played under garbage that lives, then nothing new told -- the next block lands on the same frame, as many
    // queued -- and whether the next decision has a line that lives: the engine predicts every frame, so it should)
    var ds = lines.filter(function (l) { return l.indexOf('GAMBITD ') === 0; }), num = function (l, k) { var m = new RegExp(' ' + k + '=(-?\\d+)').exec(l); return m ? +m[1] : null; };
    for (var di = 0; di + 1 < ds.length; di++) {
      var da = ds[di], db = ds[di + 1];
      if (da.indexOf(' v=lives') < 0 || da.indexOf(' under=1') < 0 || num(da, 'land') === null || num(db, 'land') === null) continue;
      if (+da.split(' ')[1] + num(da, 'land') !== +db.split(' ')[1] + num(db, 'land') || num(da, 'qk') !== num(db, 'qk')) continue;
      kept.n++; if (num(db, 'live') > 0) kept.held++;
    }
    // (SWITCHING: each switch by its direction -- the mode before it to the mode after -- and the mode a lost game was lost in)
    var was = null, one = null, switched = false, last = null;
    lines.forEach(function (l) {
      if (l.indexOf('GAMBITD ') !== 0) return;
      var cw2 = / cutWhy=(\d+)\/(\d+)\/(\d+):(\d+)\/(\d+)\/(\d+)/.exec(l);
      if (cw2) for (var q = 0; q < 3; q++) { allow.cut[q] += +cw2[1 + q]; allow.cutBr[q] += +cw2[4 + q]; }
      var al = / allow=(-?\d+)/.exec(l);
      if (al && +al[1] >= 0) { var av = +al[1]; allow.n++; allow.at[av <= 5 ? 0 : av <= 20 ? 1 : av <= 40 ? 2 : 3]++; }
      var cd = / carryDrop=(\d+)/.exec(l); if (cd) carryWhy[cd[1]] = (carryWhy[cd[1]] || 0) + 1;
      if (/ carryDrop=2/.test(l)) { allow.drop2++; if (/ carryDrop=2:d-1:c0/.test(l)) { allow.drop2cut0++; var cw = / carryDrop=2:d-1:c0([anw])/.exec(l); if (cw) allow.why[cw[1]]++; } }
      var w = / want=(\d+),(\d+)/.exec(l);
      if (w) { var r = +w[1], c = +w[2]; if (last) { var d = Math.abs(r - last[0]) + Math.abs(c - last[1]); walk.n++; walk.cells += d; if (d >= 6) walk.far++; } last = [r, c]; }
      else last = null;
      var wm = / wallMs=([\d.]+)/.exec(l), bm = / brMs=([\d.]+)/.exec(l);
      // (the board's state: decisions under garbage, and the material and panels there)
      var um = / under=(\d)/.exec(l), mm = / mat=([\d.]+)/.exec(l), pm = / pan=(\d+)/.exec(l);
      var kp = / kept=(\d+)(\/played)?/.exec(l), rt = / route=(\d+)(\/played)?/.exec(l), wy = / way=(\d+)(\/played)?/.exec(l);
      if (kp) { rule.keptOff = (rule.keptOff || 0) + +kp[1]; if (kp[2]) rule.keptPlayed = (rule.keptPlayed || 0) + 1; }
      if (rt) { rule.routeOff = (rule.routeOff || 0) + +rt[1]; if (rt[2]) rule.routePlayed = (rule.routePlayed || 0) + 1; }
      if (wy) { rule.wayOff = (rule.wayOff || 0) + +wy[1]; if (wy[2]) rule.wayPlayed = (rule.wayPlayed || 0) + 1; }
      var rd = / rdy=(\d+)\/(\d+)/.exec(l);
      var pr = / pre=(\d+)\/(\d+)/.exec(l);
      if (pr) { rule.preHit = (rule.preHit || 0) + +pr[1]; rule.preKept = (rule.preKept || 0) + +pr[2]; }
      if (rd) { rule.rdyHit = (rule.rdyHit || 0) + +rd[1]; rule.rdyAsked = (rule.rdyAsked || 0) + +rd[2]; }
      var ru = / rule=([etl])/.exec(l);
      if (ru) { rule[ru[1]] = (rule[ru[1]] || 0) + 1; rule.n = (rule.n || 0) + 1; }
      if (um) { t.dec++; if (+um[1] && mm) { t.under++; t.mat += +mm[1]; t.pan += pm ? +pm[1] : 0; } }
      // (THE BREAK THE LINEUP MAKES: of the lines played under garbage that break it, the ones that make a chain on the way)
      var bk = / broke=(\d+)/.exec(l), ch = / chain=(\d+)/.exec(l);
      if (um && +um[1] && bk && +bk[1] > 0) { t.breaks = (t.breaks || 0) + 1; if (ch && +ch[1] >= 2) t.chainBreaks = (t.chainBreaks || 0) + 1; }
      if (wm) think.wall.push(+wm[1]);
      // (THE LINE PLAYED OVER ONE LOST LATER: answer.c sooner=, by the order's key that decided it, rank.c cmpKey)
      var so = / sooner=(\w+):(L|-?\d+):k(\d+)/.exec(l);
      if (so) { sooner.n++; sooner.by[so[3]] = (sooner.by[so[3]] || 0) + 1; }
      if (um) sooner.dec++;
      if (bm) (/ under=1/.test(l) ? think.brUnder : think.br).push(+bm[1]);
      var op = / opts=(\S+)/.exec(l);
      if (op) {
        var os = op[1].split(','), bl = function (s) { var m = /:b(\d+)/.exec(s); return m ? +m[1] : 0; }, played = bl(os[0]), best = 0;
        os.forEach(function (s) { if (/:L(:|$)/.test(s)) best = Math.max(best, bl(s)); });
        forgone.decisions++;
        if (best > played) { forgone.missed++; forgone.blocks += best - played; }
      }
      var pa = / pair=(\d+)(\/played)?/.exec(l), th = / thrown=(\d+)/.exec(l), id = / ideas=(\d+)/.exec(l);
      if (pa) { several.pairOff += +pa[1]; if (pa[2]) several.pairPlayed++; }
      if (th && +th[1] > 0) { several.thrownLines++; several.thrown += +th[1]; if (+th[1] >= 2) several.thrown2++; }
      if (id) { several.ideasN++; several.ideas += +id[1]; if (+id[1] >= 2) several.ideas2++; }
      var rf = / refill=(-?\d+)\/(\d+)\/(\d+)(\/w(\d+))?/.exec(l);
      if (rf) {
        var ra = +rf[1]; rule.refill = (rule.refill || 0) + 1;
        if (rf[4]) { rule.refillTimed = (rule.refillTimed || 0) + 1; rule.refillWait = (rule.refillWait || 0) + +rf[5]; }
        var sh = / refill=\S*\/s(\d+)/.exec(l);
        if (sh) { rule.shut = rule.shut || {}; ['prevented', 'held', 'topped', 'garbage falling', 'rise locked', 'panels moving', 'shake'].forEach(function (nm, b) { if (+sh[1] & (1 << b)) rule.shut[nm] = (rule.shut[nm] || 0) + 1; }); }
        if (ra === -1) rule.refillCasc = (rule.refillCasc || 0) + 1; else if (ra === -2) rule.refillLocked = (rule.refillLocked || 0) + 1; else if (+rf[2] > 0) rule.refillReady = (rule.refillReady || 0) + 1; else if (+rf[3] > 0) rule.refillShort = (rule.refillShort || 0) + 1; else rule.refillNone = (rule.refillNone || 0) + 1;
      }
      var o = / own=(\d+)\/(\d+)/.exec(l);
      if (o) {
        cutShort.boards++;
        if (+o[2] < +o[1]) {
          var lv = / live=(\d+)\//.exec(l), nl = lv ? +lv[1] : 0, kp = / ownKept=(\d+)/.exec(l);
          cutShort.cut++;
          if (kp ? +kp[1] > 0 : nl >= 2) cutShort.cutKept++; else if (nl > 0) cutShort.cutAll++; else cutShort.cutNone++;
        }
      }
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
      budget.behind += o.behind || 0; if (o.behind) budget.behindGames++; budget.behindWorst = Math.max(budget.behindWorst, o.behindWorst || 0);
      budget.starved += o.starved || 0; budget.inHand += o.inHand || 0; budget.guarded += o.guarded || 0; budget.refused += o.refused || 0;
      var a = o.attacks || {};
      ['combo', 'chain'].forEach(function (k) { Object.keys(a[k] || {}).forEach(function (z) { t[k][z] = (t[k][z] || 0) + a[k][z]; }); });
      if (one && !switched) aimOf(one, a);
      aggr.frames += o.frames || 0;
      Object.keys(moves).forEach(function (k) { moves[k] += (o.moves || {})[k] || 0; });
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
  var t = aims[mode] || (aims[mode] = { met: 0, all: 0, first: 0, head: JSON.stringify((rule.aims || [])[0] || {}) });
  var count = function (n, combo, chain) {
    t.all += n;
    if ((rule.aims || []).some(function (x) { return meetsAim(x, combo, chain); })) t.met += n;
    if (rule.aims && rule.aims[0] && meetsAim(rule.aims[0], combo, chain)) t.first += n;
  };
  Object.keys(a.combo || {}).forEach(function (z) { count(a.combo[z], +z, 1); });
  Object.keys(a.chain || {}).forEach(function (z) { count(a.chain[z], 0, +z); });
}
var all = 0, games = 0, fmt = function (o) { return Object.keys(o).sort(function (a, b) { return a - b; }).map(function (z) { return z + 'x' + o[z]; }).join(', ') || '-'; };
Object.keys(modes).sort().forEach(function (k) {
  var t = modes[k];
  all += t.survived; games += t.games;
  console.log(k + ': survived ' + t.survived + '/' + t.games + '; lost at ' + (t.lost.sort(function (a, b) { return a - b; }).join(', ') || '-') +
              '; combos ' + fmt(t.combo) + '; chains ' + fmt(t.chain) +
              (t.dec ? '; under garbage ' + Math.round(100 * t.under / t.dec) + '% of decisions, material there ' + (t.under ? (t.mat / t.under).toFixed(1) : '-') : '') +
              (t.breaks ? '; breaks by a chain ' + (t.chainBreaks || 0) + ' of ' + t.breaks + ' (' + Math.round(100 * (t.chainBreaks || 0) / t.breaks) + '%)' : ''));
});
console.log('SURVIVED ' + all + '/' + games);
// (WHY EACH GAME WAS LOST: causeOf, a tag a loss, the first that holds; the losses counted by tag, then each loss with its numbers)
{ var tags = Object.keys(causes.by).sort(function (a, b) { return causes.by[b] - causes.by[a]; });
  console.log('losses by cause: ' + (tags.map(function (k) { return k + ' x' + causes.by[k]; }).join(', ') || '-') +
              ' (actions: the input window at 5 or fewer in the last 300 frames; panels: under 20 at the end or 22 600 frames before; hold-creep: ' +
              '3 or more holds lost sooner than a line offered; no-break: the break search found none in most of the last 300 frames)');
  causes.list.forEach(function (c) { console.log('  lost ' + c.game + ' at ' + c.at + ': ' + c.tag + ' -- ' + c.why); }); }
Object.keys(aims).sort().forEach(function (k) { var t = aims[k]; console.log('aim, ' + k + ': ' + t.met + ' of ' + t.all + ' attacks met it' + (t.all ? ' (' + Math.round(100 * t.met / t.all) + '%)' : '') +
  '; its first aim ' + t.head + ': ' + t.first + (t.all ? ' (' + (100 * t.first / t.all).toFixed(1) + '%)' : '')); });
if (nturns) {
  console.log('switches: ' + nturns + ' in all, ' + Object.keys(turns).length + ' directions -- ' + Object.keys(turns).sort().map(function (k) { return k + ' x' + turns[k]; }).join(', '));
  console.log('lost while playing: ' + (Object.keys(lostIn).sort().map(function (k) { return k + ' x' + lostIn[k]; }).join(', ') || '-'));
}
if (rule.n) console.log('the one rule: of ' + rule.n + ' lines played that met a part of it, ' + Math.round(100 * (rule.e || 0) / rule.n) + '% an entry of the list, ' + Math.round(100 * (rule.t || 0) / rule.n) + '% a three that breaks, ' + Math.round(100 * (rule.l || 0) / rule.n) + '% a last resort');
if (rule.preKept) console.log('boards searched once: ' + rule.preHit + ' readiness checks answered by a board this decision had searched already (or a worker), of ' + rule.preKept + ' boards kept');
if (sooner.dec) console.log('played a line lost sooner than one offered: ' + sooner.n + ' of ' + sooner.dec + ' decisions, by the rule of the order that put it first (rank.c compareJudged) -- ' + (Object.keys(sooner.by).sort(function (a, b) { return sooner.by[b] - sooner.by[a]; }).map(function (k) { return 'rule ' + k + ' x' + sooner.by[k]; }).join(', ') || '-'));
if (kept.n) console.log('a life kept: ' + kept.held + ' of ' + kept.n + ' lines that lived, nothing new told, lived on at the next decision (' + Math.round(100 * kept.held / kept.n) + '%)');
if (rule.rdyAsked) console.log('kept plan: ' + rule.rdyHit + ' of ' + rule.rdyAsked + ' readiness checks answered by a break already found (' + Math.round(100 * rule.rdyHit / rule.rdyAsked) + '%)');
if (rule.keptOff || rule.routeOff || rule.wayOff) console.log('intentions: ' + (rule.keptOff || 0) + ' kept lines offered again, ' + (rule.keptPlayed || 0) + ' played; routes: ' + (rule.routeOff || 0) + ' judged, ' + (rule.routePlayed || 0) + ' played; on the way: ' + (rule.wayOff || 0) + ' offered, ' + (rule.wayPlayed || 0) + ' played');
if (rule.refill) console.log('the floor\'s raise: asked in ' + rule.refill + ' decisions -- ' + (rule.refillReady || 0) + ' raised to a break ready once everything lands, ' + (rule.refillShort || 0) + ' raised on a board too short to break, ' + (rule.refillNone || 0) + ' with no row the board lives through, ' + (rule.refillCasc || 0) + ' where the stack took no raise within 120 frames, ' + (rule.refillLocked || 0) + ' with nothing to raise once it did; ' + (rule.refillTimed || 0) + ' put off to the frame the stack took it (' + (rule.refillTimed ? (rule.refillWait / rule.refillTimed).toFixed(0) : '-') + ' frames on average)' + (rule.shut ? '; shut every frame by: ' + Object.keys(rule.shut).map(function (k) { return k + ' ' + rule.shut[k]; }).join(', ') : ''));
if (aggr.frames) console.log('aggression: ' + (aggr.blocks * 3600 / aggr.frames).toFixed(1) + ' blocks thrown a minute (' + (aggr.attacks * 3600 / aggr.frames).toFixed(1) + ' attacks, ' + Math.round(aggr.cells * 3600 / aggr.frames) + ' garbage cells a minute; ' + Math.round(aggr.frames / 3600) + ' minutes)');
if (forgone.decisions) console.log('blocks left on the table: ' + forgone.missed + ' of ' + forgone.decisions + ' decisions offered a line that lives and throws more than the one played (' + forgone.blocks + ' blocks)');
if (Object.keys(carryWhy).length) console.log('lines in progress not carried on: ' + Object.keys(carryWhy).map(function (k) { return carryWhy[k] + ' ' + (CARRY_WHY[k] || 'code ' + k); }).join(', '));
if (allow.n) console.log('the input allowance: of ' + allow.n + ' decisions, ' + allow.at.map(function (v) { return Math.round(100 * v / allow.n) + '%'; }).join(' / ') +
  ' made with 0-5 / 6-20 / 21-40 / over 40 actions left of the limit; lines in progress dropped at a step no longer there ' + allow.drop2 + ', ' + allow.drop2cut0 + ' at its next swap (' + allow.why.a + ' its walk over the allowance, ' + allow.why.n + ' no swap there, ' + allow.why.w + ' its walk not begun within a reaction)');
if (allow.cut[0] + allow.cut[1] + allow.cut[2]) console.log('lines the judge cut: ' + allow.cut[0] + ' a first walk over the allowance, ' + allow.cut[1] + ' no swap there, ' + allow.cut[2] +
  ' a walk not begun within a reaction; of the break search\'s own: ' + allow.cutBr.join(' / '));
if (walk.n) console.log('walk: ' + (walk.cells / walk.n).toFixed(1) + ' cells from one swap to the next, ' + Math.round(100 * walk.far / walk.n) + '% of ' + walk.n + ' jumps 6 or more');
var pct = function (a, q) { if (!a.length) return '-'; var s = a.slice().sort(function (x, y) { return x - y; }); return String(Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))])); };
if (think.wall.length) console.log('think: a decision ' + pct(think.wall, 0.5) + ' ms (90% under ' + pct(think.wall, 0.9) + '); the break search ' + pct(think.brUnder, 0.5) + ' ms under garbage (90% under ' + pct(think.brUnder, 0.9) + '), ' + pct(think.br, 0.5) + ' otherwise');
console.log('the board\'s own chain: ' + cutShort.boards + ' decisions while it made one, ' + cutShort.cut + ' cut it short -- ' + cutShort.cutKept +
            ' while a line that lives kept it (the plan\'s 0), ' + cutShort.cutAll + ' while every line that lives cut it, ' + cutShort.cutNone + ' while none lived (lost latest)');
var nmv = moves.clear + moves.setup + moves.break + moves.none + moves.open, share = function (v) { return nmv ? Math.round(100 * v / nmv) + '%' : '-'; };
if (nmv) console.log('every move on the way: the cursor walked ' + (aggr.frames ? (moves.cells * 3600 / aggr.frames).toFixed(0) : '-') + ' cells a minute; of ' + nmv +
                     ' swaps pressed ' + share(moves.clear) + ' cleared, ' + share(moves.setup) + ' set a clear up, ' + share(moves.break) + ' broke garbage, ' +
                     share(moves.none) + ' came to nothing (' + share(moves.open) + ' still open when the game ended)');
console.log('wasted threes: ' + moves.wasted + ' clears of three that broke no garbage and were no link of a chain, made by a swap' + (aggr.frames ? ' (' + (moves.wasted * 3600 / aggr.frames).toFixed(2) + ' a minute)' : '') + '; ' + moves.wastedAlone + ' more the stack made alone; ' + moves.refusedWaste + ' swaps refused at the press for one (' + moves.refusedSpoil + ' of them spoiling the board\'s own chain); ' + moves.saved + ' threes the board needed not to die (a save the survival search confirmed, not counted as wasted); ' + moves.guardLet + ' let through at the press as the board\'s save (lost without it in 120 frames, alive with it)');
console.log('several ideas at once: ' + moves.together + ' clears begun while another was still clearing; lines firing two ideas ' + several.pairOff +
            ' offered, ' + several.pairPlayed + ' played; of ' + several.thrownLines + ' lines played that threw, ' + several.thrown2 + ' threw two blocks or more (' +
            several.thrown + ' blocks); the board a line left held ' + (several.ideasN ? (several.ideas / several.ideasN).toFixed(2) : '-') + ' ideas ready on average, two or more ' +
            several.ideas2 + ' of ' + several.ideasN + ' times');
if (Object.keys(links).length) console.log('chain links past two, by cause: ' + ['garbage', 'swap', 'alone'].map(function (w) { return w + ' ' + fmt(links[w] || {}); }).join('; '));
console.log('budgets: ' + budget.over + ' frames over the think budget, slowest frame ' + budget.worst + ' ms, ' + budget.dropped + ' keys dropped, ' +
            budget.late + ' late moves (at most ' + budget.lateWorst + ' in a game), ' + budget.guarded + ' answers whose keys the input allowance refused, ' + budget.refused + ' with no keys to press them within a reaction, over ' + budget.games + ' games');
if (budget.decisions) console.log('decisions the clock cut: ' + budget.out + ' of ' + budget.decisions + ' (' + (100 * budget.out / budget.decisions).toFixed(1) + '%)');
// THE TRUTH: every board the frame loop predicted is the one the game made; one that is not is a plan made on a board that never was
console.log('truth: ' + budget.diverged + ' boards predicted otherwise than the game made them, in ' + budget.divergedGames + ' of ' + budget.games + ' games');
// THE LINE AS JUDGED: every swap of a line handed on is keyed from the frame the judge pressed it from; one keyed later is pressed on a board
// the judge never judged
console.log('as judged: ' + budget.behind + ' swaps keyed later than the judge pressed them, in ' + budget.behindGames + ' of ' + budget.games + ' games (at most ' + budget.behindWorst + ' frames)');
console.log('decisions left no time to judge anything: ' + budget.starved + ' (the move in hand played for ' + budget.inHand + ')');
