#!/usr/bin/env node
// COMBOS OF EIGHT AND UP, BY THE MODE THEY WERE MADE IN: every game of a gambit-24.yml run (DIR/<name>/survivor.log). Each combo of five
// or more (GAMBITC, front.c) is put to the mode the last decision before it was asked in (GAMBITD); a mode's minutes are the frames from
// each of its decisions to the next. Prints, per mode, its minutes, its combos of 8+ and of 5-7, and 8+ a minute; then, where the log
// says (twinLo, propose.c twinLines), how often a mode other than finish them had an eight loaded -- one swap away -- and how many of the
// switches into finish them found one loaded.
//
//   node gambit_eights.js DIR [--json]
var fs = require('fs'), path = require('path');
var DIR = process.argv[2], JSONOUT = process.argv.indexOf('--json') > 0;
if (!DIR) { console.error('usage: node gambit_eights.js DIR [--json]'); process.exit(2); }
var FINISH = 'finish them';
var modes = {}, combos = 0, put = 0, loadedAsked = 0, loaded = 0, entries = 0, entriesLoaded = 0, games = 0;
function M(name) { return modes[name] || (modes[name] = { frames: 0, big: 0, mid: 0 }); }
fs.readdirSync(DIR).forEach(function (g) {
  var f = path.join(DIR, g, 'survivor.log');
  if (!fs.existsSync(f)) return;
  games++;
  var mode = null, at = -1, lastLoaded = null;
  fs.readFileSync(f, 'utf8').split('\n').forEach(function (l) {
    var d = /^GAMBITD (\d+) (.+?) play=/.exec(l);
    if (d) {
      var t = +d[1], name = d[2];
      if (mode !== null && t > at) M(mode).frames += t - at;
      if (name === FINISH && mode !== null && mode !== FINISH) { entries++; if (lastLoaded) entriesLoaded++; }
      var tw = / twinLo=(-?\d+)/.exec(l);
      if (tw && name !== FINISH) { loadedAsked++; lastLoaded = +tw[1] === 0; if (lastLoaded) loaded++; }
      mode = name; at = t;
      return;
    }
    var c = /^GAMBITC (\d+) (\d+)/.exec(l);
    if (c) {
      combos++;
      if (mode === null) return;
      var n = +c[2]; put++;
      if (n >= 8) M(mode).big++; else M(mode).mid++;
    }
  });
});
var unplaced = combos - put;
if (JSONOUT) { console.log(JSON.stringify({ games: games, combos: combos, unplaced: unplaced, modes: modes, loadedAsked: loadedAsked, loaded: loaded, entries: entries, entriesLoaded: entriesLoaded })); process.exit(0); }
console.log(games + ' games; ' + combos + ' combos of 5 or more logged, ' + unplaced + ' before the first decision');
Object.keys(modes).sort().forEach(function (k) {
  var m = modes[k], min = m.frames / 3600;
  console.log('  ' + k + ': ' + min.toFixed(1) + ' min, 8+ ' + m.big + ' (' + (min ? (m.big / min).toFixed(2) : '-') + ' a minute), 5-7 ' + m.mid);
});
if (loadedAsked) console.log('an eight loaded in ' + loaded + ' of ' + loadedAsked + ' decisions outside ' + FINISH + ' that asked (' + (100 * loaded / loadedAsked).toFixed(1) + '%); ' +
  entriesLoaded + ' of ' + entries + ' switches into ' + FINISH + ' found one loaded');
else console.log('no twinLo in the log: whether an eight was loaded is not told');
