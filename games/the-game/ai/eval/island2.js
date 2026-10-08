// ISLAND 2.0: ten WasmSurvivors on the live server, each in its own job,
// sitting in the lobby and challenging their next opponent by name
// (island2.sh, lua/island2Bot.lua, islands2.yml). This holds their weights and
// records, one file per bot (STATE/bot<N>.json, on the island2-state branch),
// and who each plays next.
//
//   node island2.js seed STATE                    a bot file per champion profile (survivor-profiles/champ-svNN.json)
//   node island2.js next STATE N                  the bot N plays next
//   node island2.js profile STATE N DIR           writes N's weights as a WasmSurvivor profile; prints its path
//   node island2.js record STATE N OPP RESULT     records a match against bot OPP (lua/island2Bot.lua's result); a loss moves N's weights toward OPP's
//
// THE PAIRS: bot N's k-th match is against opponent(N, k), the circle
// method, so the k-th match of each pair is the same match from both sides
// and every pair meets once in nine. No clock: a pair plays as soon as both
// are free.
// A match is won by the side alive when the other dies; if both are alive at
// the ceiling, by more garbage sent; equal is a draw.
// THE UPDATE (pbt_worker.js's): the loser goes MERGE of the way to the
// winner and is jogged by up to MUTATE of the weight range. A win or a draw
// changes nothing, so the weights a bot played a match with are the ones in
// its file before and after it.
var fs = require('fs'), path = require('path');
var N_BOTS = 10, MERGE = 0.8, MUTATE = 0.05, MAX_WEIGHT = 300;
var KEEP = Object.keys(require('./survivor.features.json').keep);
var HISTORY = 200;   // results kept per bot file

function file(state, n) { return path.join(state, 'bot' + n + '.json'); }
function load(state, n) { return JSON.parse(fs.readFileSync(file(state, n), 'utf8')); }
function save(state, n, b) { fs.writeFileSync(file(state, n), JSON.stringify(b, null, 1) + '\n'); }
function clamp(v) { return Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, v)); }

function opponent(n, k) {
  // circle method: bot 0 stays put, the other nine turn one place a round;
  // the line is folded in half and each pairs with the one across from it
  var m = N_BOTS - 1, r = k % m, line = [0];
  for (var i = 0; i < m; i++) line.push(1 + (i + r) % m);
  return line[N_BOTS - 1 - line.indexOf(n)];
}
function matchesOf(b) { return b.matches !== undefined ? b.matches : b.round || 0; }
function outcome(res) {
  if (!res.played) return 'none';
  if (res.outcome === 'won') return 'win';
  if (res.outcome === 'lost') return 'loss';
  return res.sent > res.received ? 'win' : res.sent < res.received ? 'loss' : 'draw';
}

var cmd = process.argv[2], a = process.argv.slice(3);
if (cmd === 'seed') {
  var state = a[0];
  fs.mkdirSync(state, { recursive: true });
  for (var n = 0; n < N_BOTS; n++) {
    if (fs.existsSync(file(state, n))) continue;
    var prof = path.join(__dirname, 'survivor-profiles', 'champ-sv' + String(n + 1).padStart(2, '0') + '.json');
    var w = JSON.parse(fs.readFileSync(path.join(__dirname, require(prof).weights), 'utf8')).weights, weights = {};
    KEEP.forEach(function (k) { weights[k] = w[k] || 0; });
    save(state, n, { bot: n, name: 'isl2b' + n, seededFrom: path.basename(prof), matches: 0, weights: weights,
                     record: { win: 0, loss: 0, draw: 0, none: 0, died: 0 }, history: [] });
  }
} else if (cmd === 'next') {
  console.log(opponent(+a[1], matchesOf(load(a[0], +a[1]))));
} else if (cmd === 'profile') {
  var b = load(a[0], +a[1]), dir = a[2], base = require('./survivor.profile.json');
  var wf = path.join(dir, 'island2-weights-' + a[1] + '.json'), pf = path.join(dir, 'island2-profile-' + a[1] + '.json');
  fs.writeFileSync(wf, JSON.stringify({ weights: b.weights }) + '\n');
  var p = JSON.parse(JSON.stringify(base));
  p.weights = path.relative(__dirname, wf);
  fs.writeFileSync(pf, JSON.stringify(p, null, 1) + '\n');
  console.log(pf);
} else if (cmd === 'record') {
  var st = a[0], me = +a[1], opp = +a[2], res = JSON.parse(a[3]), bme = load(st, me), o = outcome(res);
  if (bme.matches === undefined) { bme.matches = bme.round || 0; delete bme.round; }
  bme.record[o]++;
  if (res.outcome === 'lost') bme.record.died++;
  var entry = { match: bme.matches, opp: opp, result: o, outcome: res.outcome || null, frames: res.frames || 0,
                sent: res.sent || 0, received: res.received || 0, late: res.late || 0, topped: res.topped, at: new Date().toISOString() };
  if (o === 'loss') {
    var w = load(st, opp).weights, out = {}, seed = (me * 7919 + bme.matches * 104729) >>> 0;
    var rng = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    KEEP.forEach(function (k) { out[k] = clamp((1 - MERGE) * (bme.weights[k] || 0) + MERGE * (w[k] || 0) + (rng() * 2 - 1) * MUTATE * MAX_WEIGHT); });
    bme.weights = out;
    entry.mergedToward = opp;
  }
  bme.history.push(entry);
  if (bme.history.length > HISTORY) bme.history.shift();
  bme.matches++;
  save(st, me, bme);
  console.log(JSON.stringify(entry));
} else {
  console.error('island2.js: seed | next | profile | record'); process.exit(2);
}
