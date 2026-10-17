#!/usr/bin/env node
// WAS THE BREAK THERE? For every game Gambit lost in a run, the boards its break search came up empty on (GAMBITB lines: under garbage, no
// break found) in the last LAST frames before the loss, each searched again by the same break search with no time limit to speak of
// (MS each) and the same rules: a board where it now finds a break is one the live search MISSED (its reach, its time); one where it
// still finds none had no break to find (IMPOSSIBLE: the panels there cannot make one). Read from each game's own log (gambit_fetch.sh).
//
//   node gambit_reach.js DIR [LAST] [MS]       LAST frames before each loss (default 300), MS per board (default 3000)
var fs = require('fs'), path = require('path'), v8 = require('v8');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
var DIR = process.argv[2], LAST = Number(process.argv[3]) || 300, MS = Number(process.argv[4]) || 3000;
if (!DIR) { console.error('usage: node gambit_reach.js DIR [LAST] [MS]'); process.exit(2); }
var O = { reaction: 12, swapGap: 12, cursorMoveFrames: 4 }, A = require('./survivor_attack.js')(O), G = new (require('../gambit/gambit.js').Gambit)(O);
var rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'survivor-profiles', 'gambit-rules.json'), 'utf8'));
var list = rules.attack.filter(function (r) { return r.name === 'finish them'; })[0].aims.filter(function (a) { return typeof a !== 'string'; });
var totals = { missed: 0, impossible: 0, boards: 0 }, turns = {};
fs.readdirSync(DIR).sort().forEach(function (g) {
  var rf = path.join(DIR, g, 'results.txt'), lf = path.join(DIR, g, 'survivor.log');
  if (!fs.existsSync(rf) || !fs.existsSync(lf)) return;
  var m = /(\w+) training lost frames=(\d+)/.exec(fs.readFileSync(rf, 'utf8'));
  if (!m) return;
  var lostAt = +m[2], lines = fs.readFileSync(lf, 'utf8').split('\n').filter(function (l) { return l.indexOf('GAMBITB ') === 0; });
  // (the match's own: the last run of boards before the loss, clock forward)
  var bs = lines.map(function (l) { var p = l.split(' '); return { at: +p[1], b64: p[2], arr: JSON.parse(p[3] || '[]') }; }).filter(function (x) { return x.at <= lostAt && x.at >= lostAt - LAST; });
  var out = [];
  bs.forEach(function (x) {
    // (Gambit's own break search, its list and line check, with MS to spend: on a board a native host logged as the C engine's bytes, or
    // on one the JavaScript host logged, judged again on the engine)
    var line, found;
    if (/^C\d+:/.test(x.b64)) {
      line = G.breakOnBytes(x.b64.slice(x.b64.indexOf(':') + 1), x.arr, list, MS);
      found = !!line;
    } else {
      var board = PA.revive(v8.deserialize(require('zlib').gunzipSync(Buffer.from(x.b64, 'base64'))));
      var arr = x.arr.map(function (a) { return { at: a[0], width: a[1], height: a[2] }; });
      line = G.breakOn(board, arr, list, MS);
      var j = line ? A.judge(board, { left: 0, started: false }, line, arr, {}) : null;
      found = !!(j && !j.dead && j.made.broke > 0);
    }
    totals.boards++; if (found) totals.missed++; else totals.impossible++;
    out.push(x.at + (found ? ' MISSED(' + line.length + ')' : ' none'));
  });
  console.log(g + '  ' + m[1] + ' lost at ' + lostAt + ': ' + (out.length ? out.join(', ') : 'no empty searches logged'));
  // THE TURN: the last frame a break was there -- a decision whose break search found one, or a board searched again that had one --
  // and the decisions from it to the first board after it with none to find: the moves that left the board without a break
  var ds = fs.readFileSync(lf, 'utf8').split('\n').filter(function (l) { return l.indexOf('GAMBITD ') === 0; }).map(function (l) {
    var o = { at: +l.split(' ')[1] }; l.split(' ').forEach(function (p) { var i = p.indexOf('='); if (i > 0) o[p.slice(0, i)] = p.slice(i + 1); }); return o;
  }).filter(function (d) { return d.at <= lostAt && d.at >= lostAt - 3 * LAST; }).sort(function (a, b) { return a.at - b.at; });
  var none = bs.map(function (x, i) { return { at: x.at, had: /MISSED/.test(out[i]) }; }).sort(function (a, b) { return a.at - b.at; });
  var lastHad = -1;
  ds.forEach(function (d) { if (/^[1-9]/.test(d.br || '')) lastHad = Math.max(lastHad, d.at); });
  none.forEach(function (x) { if (x.had) lastHad = Math.max(lastHad, x.at); });
  var firstNone = none.filter(function (x) { return !x.had && x.at > lastHad; })[0];
  if (lastHad >= 0 && firstNone) {
    console.log('   THE TURN: a break was there at ' + lastHad + ', none from ' + firstNone.at + '; the decisions between:');
    ds.filter(function (d) { return d.at >= lastHad && d.at <= firstNone.at; }).forEach(function (d) {
      console.log('     ' + d.at + ' play=' + d.play + ' got=' + d.got + ' stop=' + d.stop + ' land=' + d.land + ' br=' + d.br + ' cands=' + d.cands);
      turns[d.play] = (turns[d.play] || 0) + 1;
    });
  }
});
console.log('\nthe moves at the turn, every loss: ' + JSON.stringify(turns));
console.log('\n' + totals.boards + ' boards searched again: ' + totals.missed + ' had a break the live search missed, ' + totals.impossible + ' had none to find');
