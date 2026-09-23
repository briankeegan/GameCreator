// WHO BEATS WHO. The only ranking that matches the goal.
//
// A snapshot records mirror-duel statistics — the bot against a copy of
// itself — and no win data across variants at all. Every "leader" reported
// from those numbers is a leader of some composite of sent, combos, chains and
// payless, which is a preference invented by whoever wrote the composite. The
// trainer's own fitness is one bit, who died, and it does not care how. This
// plays the champions against each other and ranks them by that bit.
//
// Sides are alternated on the same seed so a side advantage cannot be read as
// a result.
var path = require('path'), DIR = __dirname;
require(path.join(DIR, '..', '..', 'panel-engine.js'));
require(path.join(DIR, '..', '..', 'panel-cpu.js'));
require(path.join(DIR, 'puyocpu.js'));
var versus = require(path.join(DIR, 'versus.js'));
var registry = require(path.join(DIR, 'registry.js'));
var modes = require(path.join(DIR, 'modes.js'));
var fs = require('fs');

var OPPONENTS = Number(process.env.GC_TOURNEY_OPPONENTS || 2);
var SEEDS = Number(process.env.GC_TOURNEY_SEEDS || 1);
var OUT = process.env.GC_TOURNEY_OUT || path.join(DIR, 'tournament.json');
var RULES = Number(process.env.GC_TOURNEY_RULES || modes.RULES);

// The newest snapshot per variant, this rules version only.
var best = {};
fs.readdirSync(DIR).forEach(function (n) {
    var m = n.match(/^trained\.pbt\.pbt-([A-Za-z0-9]+)-s\d+\.(\d{4}-\d{6})\.g\d+\.json$/);
    if (!m) return;
    var s; try { s = JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8')); } catch (e) { return; }
    // Rank within ONE rules version: two populations fitted under different
    // decision procedures played different games. Defaults to the current one;
    // GC_TOURNEY_RULES ranks an older field that still has champions on disk.
    if (s.rules !== RULES) return;
    if (!best[m[1]] || m[2] > best[m[1]].stamp) best[m[1]] = { stamp: m[2], w: s.weights, updates: s.updates };
});
var names = Object.keys(best).sort();
if (names.length < 2) { console.log('need at least two rules-' + RULES + ' champions; found ' + names.length); process.exit(0); }

function clean(w) {
    var o = {};
    Object.keys(w).forEach(function (k) { if (registry.byKey[k]) o[k] = w[k]; });
    return o;
}
var W = {}; names.forEach(function (n) { W[n] = clean(best[n].w); });

var rec = {}; names.forEach(function (n) { rec[n] = { w: 0, l: 0, d: 0 }; });
var opts = { depth: 2, beam: 0, rise: true, allowRaise: true, modes: true, engine: true, level: 10 };
var pairs = [];
names.forEach(function (a, i) {
    for (var k = 1; k <= OPPONENTS; k++) pairs.push([a, names[(i + k) % names.length]]);
});
console.log(names.length + ' champions, ' + pairs.length * SEEDS * 2 + ' duels');
var done = 0;
pairs.forEach(function (p) {
    for (var s = 0; s < SEEDS; s++) {
        for (var flip = 0; flip < 2; flip++) {
            var A = flip ? p[1] : p[0], B = flip ? p[0] : p[1];
            var r = versus.duel(W[A], W[B], 5000 + s, opts);
            if (r.winner === 0) { rec[A].w++; rec[B].l++; }
            else if (r.winner === 1) { rec[B].w++; rec[A].l++; }
            else { rec[A].d++; rec[B].d++; }
            done++;
            if (done % 10 === 0) console.log('  ' + done + ' duels');
        }
    }
});
var rows = names.map(function (n) {
    var r = rec[n], played = r.w + r.l + r.d;
    return { v: n, w: r.w, l: r.l, d: r.d, updates: best[n].updates,
             rate: played ? r.w / played : 0 };
}).sort(function (a, b) { return b.rate - a.rate || b.w - a.w; });
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
console.log('\nvar    W   L   D   win%   updates');
rows.forEach(function (r) {
    console.log(r.v.padEnd(6) + String(r.w).padStart(2) + '  ' + String(r.l).padStart(2) +
        '  ' + String(r.d).padStart(2) + '   ' + (100 * r.rate).toFixed(0).padStart(3) + '%   ' + r.updates);
});
