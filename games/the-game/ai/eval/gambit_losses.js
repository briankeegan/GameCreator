#!/usr/bin/env node
// THE LOSS REPORT: for every game Gambit lost in a run, what it decided before it died and why -- read from each game's own log, never
// recalled. One directory per game, each holding the game's survivor.log and results.txt (gambit_fetch.sh writes them).
//
//   node gambit_losses.js DIR [LAST]       LAST: the decisions shown before each loss (default 12)
//
// Per lost game: the mode, the frame it was lost, then its decisions up to the last one with the board still having frames left --
// the frame and the frames since the decision before it, what Gambit's ranking wanted, what was played, how it was chosen (why), how many of the moves judged lived (live), the stop time, the frames the board had left (dies), the frames
// until the next block lands (land), and every proposer's candidates with why each was dropped (o outside the list, t too late, r not
// ready, b swap back, f below the floor, u the judge broke nothing). Across every loss: how the moves of the last LAST decisions were
// chosen, and the drop codes counted.
var fs = require('fs'), path = require('path');
var DIR = process.argv[2], LAST = Number(process.argv[3]) || 12;
if (!DIR) { console.error('usage: node gambit_losses.js DIR [LAST]'); process.exit(2); }
var FIELDS = ['play', 'want', 'got', 'why', 'live', 'under', 'stop', 'dies', 'land', 'br', 'cands'];
function parse(line) {
  var o = {}, parts = line.split(' ');
  o.at = +parts[1];
  parts.forEach(function (p) { var i = p.indexOf('='); if (i > 0) o[p.slice(0, i)] = p.slice(i + 1); });
  return o;
}
var games = fs.readdirSync(DIR).filter(function (d) { return fs.existsSync(path.join(DIR, d, 'results.txt')); }).sort();
var lost = 0, won = 0, whyAll = {}, dropAll = {};
games.forEach(function (g) {
  var res = fs.readFileSync(path.join(DIR, g, 'results.txt'), 'utf8'), m = /(\w+) training (lost|survived) frames=(\d+)/.exec(res);
  if (!m) return;
  if (m[2] === 'survived') { won++; return; }
  lost++;
  var logf = path.join(DIR, g, 'survivor.log');
  var ds = fs.existsSync(logf) ? fs.readFileSync(logf, 'utf8').split('\n').filter(function (l) { return l.indexOf('GAMBITD ') === 0; }).map(parse) : [];
  // (the match is the last run of decisions: a log may hold a pre-flight before it, which starts again from the opening; decisions
  // re-asked near the end step back a few frames, which is the same match)
  var start = 0;
  for (var i = 1; i < ds.length; i++) if (ds[i].at < 400 && ds[i - 1].at > 1000) start = i;
  ds = ds.slice(start).sort(function (a, b) { return a.at - b.at; });
  // (the turning point: the last decision the board still had a reaction's worth of frames -- what is shown is the LAST decisions up
  // to and including it, and the first after it)
  var turn = ds.length - 1;
  while (turn > 0 && !(Number(ds[turn].dies) > 12)) turn--;
  var tail = ds.slice(Math.max(0, turn - LAST + 2), turn + 2);
  console.log('\n== ' + g + '  ' + m[1] + ' lost at frame ' + m[3] + '  (' + ds.length + ' decisions)');
  tail.forEach(function (d, q) {
    var prevAt = q > 0 ? tail[q - 1].at : null;
    console.log('  ' + String(d.at).padStart(6) + ' ' + ('+' + (prevAt === null ? '-' : d.at - prevAt)).padStart(5) + '  ' + FIELDS.map(function (k) { return k + '=' + (d[k] === undefined ? '-' : d[k]); }).join(' '));
    whyAll[d.why] = (whyAll[d.why] || 0) + 1;
    String(d.cands || '').split(',').forEach(function (c) {
      var x = /-(.*)$/.exec(c);
      if (x) x[1].replace(/([a-z])(\d+)/g, function (_, code, k) { dropAll[code] = (dropAll[code] || 0) + Number(k); });
    });
  });
});
console.log('\n' + lost + ' lost, ' + won + ' survived, of ' + (lost + won));
console.log('how the moves were chosen, last ' + LAST + ' decisions of every loss: ' + JSON.stringify(whyAll));
console.log('candidates dropped there, by why (o list, t late, r ready, b back, f floor, u unbroken): ' + JSON.stringify(dropAll));
