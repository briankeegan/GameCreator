// DID THE MODE FOLLOW THE ENEMY'S BOARD? Every decision of a Gambit log (its GAMBITD lines) names the rule it played under and, when an
// enemy was read, ` enemy=height/topped/stop` -- the facts that picked it (answer.c). This re-picks the rule from those facts by the
// rules file's own tables (facts.c chooseRule: the first defend rule whose `when` holds, else the first attack rule) and counts every
// decision whose rule is not the one the facts call for.
//
//   node gambit_modes.js [--rules FILE] LOG...      (FILE default survivor-profiles/gambit-rules.json; a LOG of - is stdin)
//
// A fight with no mode named opens with the opener (tables.opener) until either board tops out; our own board's topping out is not
// logged, so the opener is over at the first decision that reads the enemy topped out or plays another mode with the enemy read, and
// agrees until then. In a fight (a log that reads an enemy anywhere) the decisions before the enemy is first read are the opener's too.
//
// Prints one JSON object: decisions read, how many disagree, each (played -> called-for) pair's count and the first few disagreeing
// lines. Exits 1 on any disagreement, 2 when nothing was read. A profile that names its mode (gambit.mode) plays that mode whatever the
// enemy does, so its logs are not this check's.
'use strict';
var fs = require('fs'), path = require('path');
var G = require(path.join(__dirname, '..', 'gambit', 'gambit.js'));

var args = process.argv.slice(2), rulesFile = path.join(__dirname, 'survivor-profiles', 'gambit-rules.json');
if (args[0] === '--rules') { rulesFile = path.resolve(args[1]); args = args.slice(2); }
if (!args.length) { console.error('gambit_modes.js: [--rules FILE] LOG...'); process.exit(2); }
var tables = G.checked(JSON.parse(fs.readFileSync(rulesFile, 'utf8'))).tables;

// a `when` test as testOf reads it, applied as facts.c test() does
function passes(v, t) {
  if (typeof t === 'number' || typeof t === 'boolean') return v === +t;
  var m = /^(>=|<=|==|!=|>|<)\s*(-?\d+)$/.exec(String(t).trim()), n = m ? +m[2] : NaN;
  if (!m) throw new Error('gambit_modes.js: a `when` test ' + JSON.stringify(t) + ' is not one rules.c reads');
  return { '>=': v >= n, '<=': v <= n, '==': v === n, '!=': v !== n, '>': v > n, '<': v < n }[m[1]];
}
function holds(facts, r) {
  return Object.keys(r.when || {}).every(function (k) { return k in facts && passes(facts[k], r.when[k]); });
}
function called(facts) {
  var all = (tables.defend || []).concat(tables.attack || []);
  for (var i = 0; i < all.length; i++) if (holds(facts, all[i])) return all[i].name;
  // (nobody across and no rule asks it: the first rule, decide.c)
  return facts['enemy.none'] && all.length ? all[0].name : null;
}

var OPENER = (tables.opener || [])[0] ? tables.opener[0].name : null;
var MODE_DEBOUNCE = 60;   // (decide.c's: a mode the facts call is played once called this many frames running; topped out, at once)
var LINE = /GAMBITD (\d+) (.*?) play=/, ENEMY = / enemy=(-?\d+)\/(-?\d+)\/(-?\d+)/;
var out = { rules: path.relative(process.cwd(), rulesFile), decisions: 0, withEnemy: 0, disagree: 0, pairs: {}, first: [] };
args.forEach(function (f) {
  var last = Infinity, opening = !!OPENER, steady = null, cand = null, candAt = 0;
  var text = fs.readFileSync(f === '-' ? 0 : f, 'utf8');
  // (A FIGHT: a log that reads an enemy anywhere. Its opening is the opener's from the first decision, the ones before the enemy's board
  // is first read too -- the countdown's plan is the opener's, never the no-enemy mode's)
  var fight = ENEMY.test(text);
  text.split('\n').forEach(function (l) {
    var m = LINE.exec(l);
    if (!m) return;
    // (a game's frames start again from the countdown: a new game opens again)
    if (+m[1] < last - 100) { opening = !!OPENER; steady = cand = null; }
    last = +m[1];
    var e = ENEMY.exec(l), facts = { 'enemy.none': e ? 0 : 1 };
    // (us.* facts are not logged: a defend rule cannot be re-picked, and the tables in use have none)
    if (e) { out.withEnemy++; facts['enemy.height'] = +e[1]; facts['enemy.topped'] = +e[2] ? 1 : 0; if (+e[3] >= 0) facts['enemy.stop'] = +e[3]; }
    out.decisions++;
    if (opening && (facts['enemy.topped'] || (m[2] !== OPENER && e))) opening = false;
    var want = opening && (e || fight) ? OPENER : called(facts);
    // (the mode debounced as decide.c plays it -- the owner: topped out calls finish them at once, any other change once called
    // MODE_DEBOUNCE frames running)
    if (!(opening && (e || fight)) && want) {
      var fr = +m[1];
      if (steady === null || want === steady || facts['enemy.topped']) { steady = want; cand = null; }
      else { if (cand !== want) { cand = want; candAt = fr; } if (fr - candAt >= MODE_DEBOUNCE) { steady = want; cand = null; } else want = steady; }
    }
    if (want === m[2]) return;
    out.disagree++;
    var key = m[2] + ' -> ' + want;
    out.pairs[key] = (out.pairs[key] || 0) + 1;
    if (out.first.length < 10) out.first.push(path.basename(f) + ': frame ' + m[1] + ' ' + key + (e ? ' enemy=' + e[1] + '/' + e[2] + '/' + e[3] : ' (no enemy read)'));
  });
});
if ((tables.defend || []).length) out.note = 'the tables have defend rules, which read our own board: those decisions are not re-picked here';
console.log(JSON.stringify(out, null, 1));
process.exit(!out.decisions ? 2 : out.disagree ? 1 : 0);
