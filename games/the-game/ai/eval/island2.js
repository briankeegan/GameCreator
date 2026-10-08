// ISLAND 2.0: ten WasmSurvivors on the live server, each in its own job,
// playing each other a round at a time (island2.sh, islands2.yml). This holds
// their weights and records, one file per bot (STATE/bot<N>.json, on the
// island2-state branch), and decides who plays whom.
//
//   node island2.js seed STATE                    a bot file per champion profile (survivor-profiles/champ-svNN.json)
//   node island2.js opponent N ROUND              the bot N plays in ROUND
//   node island2.js round [EPOCH_S]               the round now: one every ROUND_S seconds, the same for every bot
//   node island2.js profile STATE N DIR           writes N's weights as a WasmSurvivor profile; prints its path
//   node island2.js record STATE N ROUND RESULT   records island2Match.lua's RESULT; a loss moves N's weights toward the winner's
//
// THE PAIRS: the circle method, so each round is five pairs and every pair
// meets once in nine rounds. A match is won by the side alive when the other
// dies; if both are alive at the ceiling, by more garbage sent; equal is a draw.
// THE UPDATE (pbt_worker.js's): the loser goes MERGE of the way to the
// winner and is jogged by up to MUTATE of the weight range. A win or a draw
// changes nothing, so the weights a bot played a round with are the ones in
// its file before and after it.
var fs = require('fs'), path = require('path');
var N_BOTS = 10, MERGE = 0.8, MUTATE = 0.05, MAX_WEIGHT = 300;
// A ROUND IS A SLOT OF THE CLOCK, the same for all ten: a match is six
// minutes (21600 frames) and the login, challenge and countdown well under
// one more, so a bot that starts late or misses one joins the next.
var ROUND_S = 480;
var KEEP = Object.keys(require('./survivor.features.json').keep);
var HISTORY = 200;   // results kept per bot file

function file(state, n) { return path.join(state, 'bot' + n + '.json'); }
function load(state, n) { return JSON.parse(fs.readFileSync(file(state, n), 'utf8')); }
function save(state, n, b) { fs.writeFileSync(file(state, n), JSON.stringify(b, null, 1) + '\n'); }
function clamp(v) { return Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, v)); }

function opponent(n, round) {
  // circle method: bot 0 stays put, the other nine turn one place a round;
  // the line is folded in half and each pairs with the one across from it
  var m = N_BOTS - 1, r = round % m, line = [0];
  for (var i = 0; i < m; i++) line.push(1 + (i + r) % m);
  var at = line.indexOf(n);
  return line[N_BOTS - 1 - at];
}
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
    save(state, n, { bot: n, name: 'isl2b' + n, seededFrom: path.basename(prof), round: 0, weights: weights,
                     record: { win: 0, loss: 0, draw: 0, none: 0, died: 0 }, history: [] });
  }
} else if (cmd === 'opponent') {
  console.log(opponent(+a[0], +a[1]));
} else if (cmd === 'round') {
  console.log(Math.floor((a[0] ? +a[0] : Date.now() / 1000) / ROUND_S));
} else if (cmd === 'profile') {
  var b = load(a[0], +a[1]), dir = a[2], base = require('./survivor.profile.json');
  var wf = path.join(dir, 'island2-weights-' + a[1] + '.json'), pf = path.join(dir, 'island2-profile-' + a[1] + '.json');
  fs.writeFileSync(wf, JSON.stringify({ weights: b.weights }) + '\n');
  var p = JSON.parse(JSON.stringify(base));
  p.weights = path.relative(__dirname, wf);
  fs.writeFileSync(pf, JSON.stringify(p, null, 1) + '\n');
  console.log(pf);
} else if (cmd === 'record') {
  var st = a[0], me = +a[1], round = +a[2], res = JSON.parse(a[3]), bme = load(st, me), opp = opponent(me, round), o = outcome(res);
  if (round < bme.round) throw new Error('island2: bot ' + me + ' has recorded round ' + (bme.round - 1) + ' already, not ' + round);
  bme.record[o]++;
  if (res.outcome === 'lost') bme.record.died++;
  var entry = { round: round, opp: opp, result: o, outcome: res.outcome || null, frames: res.frames || 0,
                sent: res.sent || 0, received: res.received || 0, late: res.late || 0, at: new Date().toISOString() };
  if (o === 'loss') {
    var w = load(st, opp).weights, out = {}, seed = (me * 7919 + round * 104729) >>> 0;
    var rng = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    KEEP.forEach(function (k) { out[k] = clamp((1 - MERGE) * (bme.weights[k] || 0) + MERGE * (w[k] || 0) + (rng() * 2 - 1) * MUTATE * MAX_WEIGHT); });
    bme.weights = out;
    entry.mergedToward = opp;
  }
  bme.history.push(entry);
  if (bme.history.length > HISTORY) bme.history.shift();
  bme.round = round + 1;
  save(st, me, bme);
  console.log(JSON.stringify(entry));
} else {
  console.error('island2.js: seed | opponent | round | profile | record'); process.exit(2);
}
