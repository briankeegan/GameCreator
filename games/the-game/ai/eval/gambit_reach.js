#!/usr/bin/env node
// WAS THE BREAK THERE? (Every board here is under garbage, where a mode's list ends by "default": a native host's boards are searched
// with no line held to the list, as the live search was.) For every game Gambit lost in a run, the boards its break search came up empty on (GAMBITB lines: under garbage, no
// break found) in the last LAST frames before the loss, each searched again by the same break search with no time limit to speak of
// (MS each) and the same rules: a board where it now finds a break is one the live search MISSED (its reach, its time); one where it
// still finds none had no break to find (IMPOSSIBLE: the panels there cannot make one). Read from each game's own log (gambit_fetch.sh).
//
//   node gambit_reach.js DIR [LAST] [MS]       LAST frames before each loss (default 300), MS per board (default 3000)
//   node gambit_reach.js --game GAMEDIR NAME [LAST] [MS]
//                                              one game, written up by the job that played it: its lines and counts as data, in
//                                              GAMEDIR/reach.json -- a game that has one is read from it, not searched again
var fs = require('fs'), path = require('path'), v8 = require('v8');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
var ONE = process.argv[2] === '--game', av = ONE ? process.argv.slice(1) : process.argv;
var DIR = ONE ? path.dirname(path.resolve(av[2])) : av[2], ONLY = ONE ? av[3] : null, LAST = Number(av[ONE ? 4 : 3]) || 300, MS = Number(av[ONE ? 5 : 4]) || 3000;
if (!DIR || (ONE && !ONLY)) { console.error('usage: node gambit_reach.js DIR [LAST] [MS] | --game GAMEDIR NAME [LAST] [MS]'); process.exit(2); }
var O = { reaction: 12, swapGap: 12, cursorMoveFrames: 4 }, A = require('./survivor_attack.js')(O), G = new (require('../gambit/gambit.js').Gambit)(O);
var rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'survivor-profiles', 'gambit-rules.json'), 'utf8'));
var list = rules.attack.filter(function (r) { return r.name === 'finish them'; })[0].aims.filter(function (a) { return typeof a !== 'string'; });
// (a log's lines up to the game over: after it the frame loop asks on a board that no longer plays)
function played(lines) { var i = -1; lines.forEach(function (l, k) { if (l.indexOf('GAMEOVER ') === 0) i = k; }); return i < 0 ? lines : lines.slice(0, i); }
var WORK_PER_MS = G.X.gb_work_per_ms();   // (core/clock.h's: the work a live ms is)
var needs = [];
var totals = { missed: 0, impossible: 0, boards: 0, inTime: 0, notInTime: 0, shown: 0 }, turns = {}, how = {}, took = {};
function add(into, from) { Object.keys(from).forEach(function (k) { into[k] = (into[k] || 0) + from[k]; }); }
var BUCKETS = [20, 100, 300, 1000, Infinity], bucketOf = function (ms) { for (var i = 0; i < BUCKETS.length; i++) if (ms < BUCKETS[i]) return BUCKETS[i] === Infinity ? '1000+' : '<' + BUCKETS[i]; };
// One game written up: its lines, and its counts as data (what --game writes, and what a run of games adds up)
function reachGame(gdir, g) {
  var R = { name: g, lines: [], missedB: [], needs: [], totals: { missed: 0, impossible: 0, boards: 0, inTime: 0, notInTime: 0 }, turns: {}, how: {}, took: {} };
  var totals = R.totals, turns = R.turns, how = R.how, took = R.took, say = function (l) { R.lines.push(l); };
  var rf = path.join(gdir, 'results.txt'), lf = path.join(gdir, 'survivor.log');
  if (!fs.existsSync(rf) || !fs.existsSync(lf)) return R;
  var m = /(\w+) training lost frames=(\d+)/.exec(fs.readFileSync(rf, 'utf8'));
  if (!m) return R;
  R.lost = 1;
  // (the boards its break search came up empty on, and the last boards it decided on, written at the match's end: GAMBITL)
  // (a last board is searched again only when its own decision -- the one asked on its frame -- found no break: GAMBITL holds the last
  // boards whatever the live search found, GAMBITB only those it came up empty on; one board a frame)
  var all = played(fs.readFileSync(lf, 'utf8').split('\n')), broke = {}, brMsAt = {};
  all.forEach(function (l) {
    if (l.indexOf('GAMBITD ') !== 0) return;
    var b = / br=(\S+)/.exec(l), bm = / brMs=(\d+)/.exec(l), at = l.split(' ')[1];
    if (b && /^[1-9]/.test(b[1])) broke[at] = 1;
    if (bm) brMsAt[at] = +bm[1];
  });
  var lostAt = +m[2], seenAt = {}, lines = all.filter(function (l) {
    var at = l.split(' ')[1];
    if (!(l.indexOf('GAMBITB ') === 0 || (l.indexOf('GAMBITL ') === 0 && !broke[at])) || seenAt[at]) return false;
    return (seenAt[at] = 1);
  });
  // (the match's own: the last run of boards before the loss, clock forward)
  // (each board with its decision's press, where the log gives it: the allowance left and the pace -- native.c dumpBoard's a, g)
  var bs = lines.map(function (l) {
    var p = l.split(' '), a = /^a(-?\d+)$/.exec(p[4] || ''), gp = /^g(\d+)$/.exec(p[5] || '');
    return { at: +p[1], b64: p[2], arr: JSON.parse(p[3] || '[]'), press: a && gp ? { allow: +a[1], gap: +gp[1] } : null };
  }).filter(function (x) { return x.at <= lostAt && x.at >= lostAt - LAST; });
  var out = [];
  bs.forEach(function (x) {
    // (Gambit's own break search, its list and line check, with MS to spend: on a board a native host logged as the C engine's bytes, or
    // on one the JavaScript host logged, judged again on the engine)
    var line, found;
    if (/^C\d+:/.test(x.b64)) {
      line = G.breakOnBytes(x.b64.slice(x.b64.indexOf(':') + 1), x.arr, list, MS, 0, x.press);
      found = !!line;
    } else {
      var board = PA.revive(v8.deserialize(require('zlib').gunzipSync(Buffer.from(x.b64, 'base64'))));
      var arr = x.arr.map(function (a) { return { at: a[0], width: a[1], height: a[2] }; });
      line = G.breakOn(board, arr, list, MS);
      var j = line ? A.judge(board, { left: 0, started: false }, line, arr, {}) : null;
      found = !!(j && !j.dead && j.made.broke > 0);
    }
    totals.boards++; if (found) totals.missed++; else totals.impossible++;
    // (a break the search's own first step finds is one the live search could not have missed on this board: the board, whole, for a replay)
    if (found && line.how === 'first' && R.missedB.length < 12) R.missedB.push('MISSEDB ' + g + ' ' + x.at + ' ' + x.b64 + ' ' + JSON.stringify(x.arr));
    if (found && line.how) { how[line.how] = (how[line.how] || 0) + 1; var bk = bucketOf(line.ms); took[bk] = (took[bk] || 0) + 1; }
    // (IN ITS OWN WORK: the board searched again with the work the live search had -- its decision's brMs on the work clock, under the
    // decision's press -- found, the live search lost the break to how it spent that work (its resumed frontier, its share); not
    // found, to the work it was given)
    var inTime = '';
    if (found && /^C\d+:/.test(x.b64) && brMsAt[x.at] !== undefined && x.press) {
      var again = G.breakOnBytes(x.b64.slice(x.b64.indexOf(':') + 1), x.arr, list, Math.max(1, brMsAt[x.at]), 0, { allow: x.press.allow, gap: x.press.gap, work: true });
      inTime = again ? ' in its ' + brMsAt[x.at] + 'ms: found' : ' in its ' + brMsAt[x.at] + 'ms: not';
      if (again) totals.inTime++; else totals.notInTime++;
    }
    // (the work it took, against the work the live search had: what a budget would need to find it)
    if (found && brMsAt[x.at] !== undefined) { R.needs.push(Math.round(line.work / (brMsAt[x.at] * WORK_PER_MS) * 100) / 100); }
    out.push(x.at + (found ? ' MISSED(' + line.length + (line.how ? ' ' + line.how + ' ' + line.ms + 'ms ' + line.work + ' steps' : '') + inTime + ')' : ' none'));
  });
  say(g + '  ' + m[1] + ' lost at ' + lostAt + ': ' + (out.length ? out.join(', ') : 'no empty searches logged'));
  // THE TURN: the last frame a break was there -- a decision whose break search found one, or a board searched again that had one --
  // and the decisions from it to the first board after it with none to find: the moves that left the board without a break
  var ds = played(fs.readFileSync(lf, 'utf8').split('\n')).filter(function (l) { return l.indexOf('GAMBITD ') === 0; }).map(function (l) {
    var o = { at: +l.split(' ')[1] }; l.split(' ').forEach(function (p) { var i = p.indexOf('='); if (i > 0) o[p.slice(0, i)] = p.slice(i + 1); }); return o;
  }).filter(function (d) { return d.at <= lostAt && d.at >= lostAt - 3 * LAST; }).sort(function (a, b) { return a.at - b.at; });
  var none = bs.map(function (x, i) { return { at: x.at, had: /MISSED/.test(out[i]) }; }).sort(function (a, b) { return a.at - b.at; });
  var lastHad = -1;
  ds.forEach(function (d) { if (/^[1-9]/.test(d.br || '')) lastHad = Math.max(lastHad, d.at); });
  none.forEach(function (x) { if (x.had) lastHad = Math.max(lastHad, x.at); });
  var firstNone = none.filter(function (x) { return !x.had && x.at > lastHad; })[0];
  if (lastHad >= 0 && firstNone) {
    say('   THE TURN: a break was there at ' + lastHad + ', none from ' + firstNone.at + '; the decisions between:');
    ds.filter(function (d) { return d.at >= lastHad && d.at <= firstNone.at; }).forEach(function (d) {
      say('     ' + d.at + ' play=' + d.play + ' got=' + d.got + ' stop=' + d.stop + ' land=' + d.land + ' br=' + d.br + ' cands=' + d.cands + (d.opts ? ' opts=' + d.opts : ''));
      turns[d.play] = (turns[d.play] || 0) + 1;
    });
  }
  return R;
}
if (ONE) { fs.writeFileSync(path.join(DIR, path.basename(path.resolve(av[2])), 'reach.json'), JSON.stringify(reachGame(path.resolve(av[2]), ONLY))); process.exit(0); }
// (every game of the run: its own write-up where its job wrote one, else searched here -- and every lost game written up, or it fails)
var lostN = 0, gotN = 0;
fs.readdirSync(DIR).sort().forEach(function (g) {
  var gdir = path.join(DIR, g), jf = path.join(gdir, 'reach.json');
  var rf = path.join(gdir, 'results.txt');
  if (fs.existsSync(rf) && /training lost frames=/.test(fs.readFileSync(rf, 'utf8'))) lostN++;
  var R = fs.existsSync(jf) ? JSON.parse(fs.readFileSync(jf, 'utf8')) : reachGame(gdir, g);
  if (!R.lost) return;
  gotN++;
  R.missedB.forEach(function (l) { if (totals.shown++ < 12) console.log(l); });
  R.lines.forEach(function (l) { console.log(l); });
  add(totals, R.totals); add(turns, R.turns); add(how, R.how); add(took, R.took); needs = needs.concat(R.needs || []);
});
if (gotN !== lostN) { console.error('gambit_reach.js: ' + lostN + ' games lost, ' + gotN + ' written up'); process.exit(1); }
console.log('\nthe moves at the turn, every loss: ' + JSON.stringify(turns));
console.log('\n' + totals.boards + ' boards searched again: ' + totals.missed + ' had a break the live search missed, ' + totals.impossible + ' had none to find');
if (totals.inTime + totals.notInTime) console.log('the missed breaks searched again with the live search\'s own work: ' + totals.inTime + ' found (how it spent the work took them), ' + totals.notInTime + ' not (the work did)');
if (needs.length) { needs.sort(function (a, b) { return a - b; }); var q = function (f) { return needs[Math.min(needs.length - 1, Math.floor(f * needs.length))]; };
  console.log('the work a missed break took, over the work its live search had: median ' + q(0.5) + 'x, 75% under ' + q(0.75) + 'x, 90% under ' + q(0.9) + 'x (' + needs.length + ' breaks)'); }
if (totals.missed) console.log('the missed breaks, by how they were found: ' + JSON.stringify(how) + '; by the ms they took: ' + JSON.stringify(took));
