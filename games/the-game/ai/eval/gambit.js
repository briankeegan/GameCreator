// GAMBIT: a bot whose aims are two rule tables. Each decision reads the same facts off both boards. The DEFEND table is read first:
// its `when` is led by our own board (us.*). If none of its rules holds, the ATTACK table is: its `when` is led by the enemy's board
// (enemy.*), with our board at most an extra condition -- the attack pattern is chosen by the enemy's state. The rule taken sets the aim, a line that makes what it asks by
// its `by` is searched for, and the survival search only vetoes a line that dies, so the aim is chased while the board lives. The
// tables live in a JSON file (the profile's `gambit.rules`) read again whenever it changes.
//
//   file: { defend: [rule, ...], attack: [rule, ...], opponents: { "<name>": { defend, attack } } }
//   rule: { name, when: { field: test, ... }, aims: [aim, aim, ..., "default" | "hold"], by: frames | field, keep: { fact: test } }
//   aims: a priority list -- the first entry a line can make in time is played; "default" (the default bot's own move) or "hold" ends it
//   (aim + else is a list of two). A list with no end is played toward even when no entry fits: the line nearest its first entry
//   (`near`), else a setup
//   underGarbage (the file's): "break" (the default) -- with garbage on our board, or topped out, every aim must break it too, and with
//   no line that does both the default's own move (which breaks it) is played; "ignore" -- aims are played as written
//   raise (the file's, or a rule's): { to: rows } -- with no entry in time, not under garbage, the stack is raised to `to` in one held press
//   keep: what our board must still have once the line is done (material, height, evenness); the file's own `keep` is every rule's
//   that has none
//   field: "us.<fact>" or "enemy.<fact>"; test: a value (equal) or a string ">=9", "<4", "==0", "!=0"
//   aim: { combo: test, chain: test, break: true | false, send: test (cells), any: [aim, ...] }  -- every key given must hold
//
// Facts, the same names for both boards (an enemy fact the host does not send is undefined, and a test on it is false):
//   topped, stop (frames), height (rows, garbage included), material (panels under the garbage), contact (columns reaching the
//   garbage), evenness (tallest panel column less lowest), coming (rows on their way), heavy (coming > 8), nextLands (frames),
//   dies (frames until the board is lost if nothing is done)
var fs = require('fs'), path = require('path'), CK = require('./survivor_checks.js');

function cellOf(b, r, c) { var p = b.panels[r] && b.panels[r][c]; return !p ? 0 : p.isGarbage ? -1 : (p.color || 0); }

// THE FACTS OF A BOARD (pa-engine board, the garbage on its way as arrivalsFrom gives it: { at, width, height })
function facts(board, arrivals, topped) {
  var H = board.panels.length - 1, c, r, peaks = [], low = -1, top = 0, material = 0, contact = 0, garb = false;
  for (c = 1; c <= 6; c++) {
    var pk = 0, g = 0;
    for (r = 1; r <= H; r++) {
      var v = cellOf(board, r, c);
      if (v === -1) { if (!g) g = r; garb = true; }
      else if (v > 0 && !g) { pk = r; material++; }
      if (v !== 0 && r > top) top = r;
    }
    peaks.push(pk);
    if (g && pk === g - 1) contact++;
  }
  var stop = (board.stopTime || 0) + (board.preStopTime || 0), coming = 0, next = null;
  (arrivals || []).forEach(function (a) { coming += a.height || 0; if (next === null || a.at < next) next = a.at; });
  // (a block queued for the board drops once the stop time runs out: its landing is the stop time left)
  (board.incoming || []).slice(0, 1).forEach(function (g) { coming += g.height || 0; if (next === null || stop < next) next = stop; });
  // (dies: the frames until the board is lost if nothing is done -- the stop time, the rise to the top row unless already topped, then
  // the health it drains there)
  var dies = topped ? stop + (board.health || 0) : CK.framesToTop(board) + (board.health || 0);
  return {
    topped: !!topped, stop: stop, height: top, material: material, contact: garb ? contact : null, dies: dies,
    evenness: Math.max.apply(null, peaks) - Math.min.apply(null, peaks), coming: coming, heavy: coming > 8, nextLands: next
  };
}
// The facts of a settled grid the search leaves (0 empty, garbage 8 and up or below 0, 1..7 colours): what a line's end board keeps.
function gridFacts(grid) {
  var top = 0, material = 0, peaks = [], c, r;
  for (c = 1; c <= 6; c++) {
    var pk = 0, g = 0;
    for (r = 1; r < grid.length - 1; r++) {
      var v = grid[r] && grid[r][c];
      var garbage = v >= 8 || v < 0;
      if (garbage) { if (!g) g = r; }
      else if (v > 0 && !g) { pk = r; material++; }
      if (v && r > top) top = r;
    }
    peaks.push(pk);
  }
  return { height: top, material: material, evenness: Math.max.apply(null, peaks) - Math.min.apply(null, peaks) };
}
// KEEP: what our board must still have once a line is done ({ material: ">=12", height: "<=9", ... }); every key given must hold.
function keeps(keep, grid) {
  if (!keep || !grid) return true;
  var f = gridFacts(grid);
  return Object.keys(keep).every(function (k) { return test(f[k.replace(/^us\./, '')], keep[k]); });
}
// A BREAK'S DEADLINE (plays.md): before the board dies, however soon the next block lands (that is the level's and the ready's) -- and the
// engine is the judge of that: every line is played on it with the garbage landing, and one the board dies on is never offered. The
// estimate of the frames left (dies) is no deadline for a break; it is what the pace hurries for
function breakBy(F) { return null; }
// THE FLOOR (a rule's or the file's `keep`): a line's board must keep it -- unless the line breaks garbage, which is made with any
// allowed move, garbage on the board or not. null: no floor.
function floor(keep) {
  if (!keep) return null;
  return function (grid, made) { return !!(made && made.broke > 0) || keeps(keep, grid); };
}
// The enemy's facts, from what the host sends of the enemy's board (opp: { out, top, stop, ... }); the rest stay undefined.
function enemyFacts(opp) {
  if (!opp) return {};
  return { topped: !!opp.out, height: opp.top, stop: opp.stop };
}

function test(v, t) {
  if (v === undefined || v === null) return false;
  if (typeof t !== 'string') return v === t;
  var m = /^(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)$/.exec(t.trim());
  if (!m) return String(v) === t;
  var n = +m[2];
  return m[1] === '>=' ? v >= n : m[1] === '<=' ? v <= n : m[1] === '>' ? v > n : m[1] === '<' ? v < n : m[1] === '==' ? v === n : v !== n;
}
function field(F, name) { var i = name.indexOf('.'); var side = F[name.slice(0, i)]; return side ? side[name.slice(i + 1)] : undefined; }
function holds(F, when) { return Object.keys(when || {}).every(function (k) { return test(field(F, k), when[k]); }); }

// What a line makes ({ combo, combos, chain, broke, cells }) against an aim.
function meets(aim, made) {
  if (!aim) return false;
  if (aim.any && !aim.any.some(function (a) { return meets(a, made); })) return false;
  if (aim.combo !== undefined && !test(made.combo, aim.combo)) return false;
  if (aim.chain !== undefined && !test(made.chain, aim.chain)) return false;
  if (aim.send !== undefined && !test(made.cells, aim.send)) return false;
  if (aim.break === true && !(made.broke > 0)) return false;
  if (aim.break === false && made.broke > 0) return false;
  return true;
}
// HOW NEAR a line comes to an aim, 0..1 (1: it meets it): a chain is measured from one link, a combo from three panels, so a plain
// three is near no chain and no combo. An aim that asks a break is not neared by a line that breaks nothing.
var FROM = { chain: 1, combo: 3 };
function nearKey(v, t, b) {
  var m = typeof t === 'string' && /^(>=|<=|==|>|<)\s*(\d+)$/.exec(t.trim());
  if (!m) return test(v, t) ? 1 : 0;
  var n = +m[2] + (m[1] === '>' ? 1 : 0);
  if (m[1] === '<' || m[1] === '<=') return test(v, t) ? 1 : 0;
  if (n <= b) return v === n || (m[1] !== '==' && v > n) ? 1 : 0;
  var up = Math.max(0, Math.min(1, (v - b) / (n - b)));
  return m[1] === '==' && v > n ? Math.max(0, 1 - (v - n) / (n - b + 1)) : up;
}
function near(aim, made) {
  if (!aim || typeof aim !== 'object') return 0;
  if (meets(aim, made)) return 1;
  if (aim.break === true && !(made.broke > 0)) return 0;
  if (aim.break === false && made.broke > 0) return 0;
  if (aim.any) return Math.max.apply(null, aim.any.map(function (a) { return near(a, made); }).concat([0]));
  var ks = ['chain', 'combo'].filter(function (k) { return aim[k] !== undefined; });
  if (!ks.length) return 0;
  return ks.reduce(function (s, k) { return s + nearKey(made[k] || 0, aim[k], FROM[k]); }, 0) / ks.length;
}
// How near a line comes to a priority list: the first entry first, a later one only between lines as near the ones before it.
function nearList(aims, made) {
  var s = 0, w = 1;
  for (var i = 0; i < aims.length; i++) { s += Math.round(near(aims[i], made) * 100) * w; w /= 101; }
  return s;
}
// What leads the search: the list -- under garbage its entries ask a break, so a line that breaks nothing is near none of them -- and
// any line that breaks a little nearer than one that does not, a three included. The pick's order (tier) chooses among what is found.
function lead(aims, made, under) { return nearList(aims, made) + (under && made.broke > 0 ? 0.5 : 0); }
// THE PICK: every move is the next step of the ask -- the mode's list entry -- and the ask runs the whole time: while it is built the
// garbage is broken, for the panels the build is made of, and the board is set up. Lower first; x is what the line makes ({ combo,
// chain, broke, earned, done, near: how near the list it leaves the board }), aim its entry in the list (-1: none), under garbage on
// the board or topped. Live and in time are the engine's: a line that dies, or is done after its deadline, is never a candidate.
//   1 FIRE an entry: a line that makes it, in the list's order -- under garbage one that breaks too before one that does not
//   2 BREAK, while building: any break -- one that buys stop time before a plain three, then the one nearest the ask, then more broken
//   3 SET UP the ask, flattening included: nearest the list first
//   5 hold, only with no move; 6 clear (a match that touches no garbage), only for a stack about to top out with nothing else
function tier(play, x, aim, under) {
  x = x || {};
  var combo = x.combo || 0, chain = x.chain || 0, broke = x.broke || 0, stop = x.earned || 0, near = x.near || 0;
  var buys = combo >= 4 || chain >= 2;
  if (aim >= 0) return { tier: 1, sub: [aim, under && broke > 0 ? 0 : 1, x.done || 0] };
  if (under && broke > 0) return { tier: 2, sub: [buys ? 0 : 1, -near, -broke] };
  if (play === 'clear') return { tier: 6, sub: [-stop] };
  return { tier: 3, sub: [-near] };
}
// A rule's priority list: `aims` as written, or aim then else. Entries are aims, or "default" / "hold", which end the list.
function aimsOf(rule) {
  if (Array.isArray(rule.aims)) return rule.aims;
  var l = []; if (rule.aim) l.push(rule.aim); if (rule.else) l.push(rule.else); return l;
}
// A deadline: frames, or a fact ("us.nextLands", "enemy.stop", ...). An unknown one is no deadline.
function deadline(F, by) {
  if (typeof by === 'number') return by;
  if (typeof by === 'string') { var v = field(F, by); return typeof v === 'number' ? v : null; }
  return null;
}
// The rule that applies: the first defend rule whose `when` holds, else the first attack rule. { rule, index, table } or null.
function choose(tables, F) {
  var order = ['defend', 'attack'];
  for (var t = 0; t < order.length; t++) {
    var rules = (tables && tables[order[t]]) || [];
    for (var i = 0; i < rules.length; i++) if (holds(F, rules[i].when)) return { rule: rules[i], index: i, table: order[t] };
  }
  return null;
}
// One rule by its name, whatever its `when` (the profile's gambit.mode: a mode played the whole game, to test it on its own).
function named(tables, name) {
  var order = ['defend', 'attack'];
  for (var t = 0; t < order.length; t++) {
    var rules = (tables && tables[order[t]]) || [];
    for (var i = 0; i < rules.length; i++) if (rules[i].name === name) return { rule: rules[i], index: i, table: order[t] };
  }
  return null;
}
// A table's rules, each `when` led by its own side's board: an attack rule tests the enemy (enemy.*), a defend rule our board (us.*);
// either may add a test on the other side, and an empty `when` is the table's catch-all. A rule that tests only the other side is
// dropped, and the reason kept.
var SIDE = { defend: 'us.', attack: 'enemy.' };
function checked(tables) {
  var out = { defend: [], attack: [] }, errors = [];
  ['defend', 'attack'].forEach(function (t) {
    ((tables && tables[t]) || []).forEach(function (r, i) {
      var keys = Object.keys(r.when || {}), own = keys.filter(function (k) { return k.indexOf(SIDE[t]) === 0; });
      if (keys.length && !own.length) errors.push(t + ' rule ' + i + ' (' + (r.name || '') + ') tests only ' + keys.join(', ') + ': a ' + t + ' rule tests ' + SIDE[t] + '* first');
      else if (!aimsOf(r).length || !aimsOf(r).every(function (a) { return (a && typeof a === 'object') || a === 'default' || a === 'hold'; })) errors.push(t + ' rule ' + i + ' (' + (r.name || '') + ') has no aims, or one that is not an aim, "default" or "hold"');
      else out[t].push(r);
    });
  });
  return { tables: out, errors: errors };
}

// THE RULES FILE, read again whenever it changes (its mtime): it may be rewritten between matches or while one runs, and the next
// decision plays by it. An opponent with tables of its own is played by those. A file that fails to read or parse leaves the last
// good tables in force; the rules it drops (a when on the wrong side's board, no aim) are listed in `errors`.
function Rules(file) { this.file = file; this.mtime = -1; this.all = { defend: [], attack: [] }; this.own = {}; this.error = null; this.errors = []; }
Rules.prototype.get = function (opponent) {
  try {
    var st = fs.statSync(this.file);
    if (st.mtimeMs !== this.mtime) {
      var j = JSON.parse(fs.readFileSync(this.file, 'utf8')), c = checked(j), own = {}, errs = c.errors.slice();
      Object.keys(j.opponents || {}).forEach(function (name) { var co = checked(j.opponents[name]); own[name] = co.tables; co.errors.forEach(function (e) { errs.push(name + ': ' + e); }); });
      this.all = c.tables; this.all.keep = j.keep || null; this.all.raise = j.raise || null; this.all.underGarbage = j.underGarbage || 'break'; this.own = own; this.errors = errs;
      Object.keys(own).forEach(function (n) { own[n].keep = (j.opponents[n] && j.opponents[n].keep) || j.keep || null; own[n].raise = (j.opponents[n] && j.opponents[n].raise) || j.raise || null; own[n].underGarbage = (j.opponents[n] && j.opponents[n].underGarbage) || j.underGarbage || 'break'; });
      this.mtime = st.mtimeMs; this.error = null;
      console.error('GAMBIT rules ' + this.file + ': ' + this.all.defend.length + ' defend, ' + this.all.attack.length + ' attack, ' + Object.keys(own).length + ' opponents' + (errs.length ? '; dropped: ' + errs.join(' | ') : ''));
    }
  } catch (e) { this.error = String(e && e.message || e); }
  return (opponent && this.own[opponent]) || this.all;
};
function rulesFor(profile, dir) {
  var g = profile && profile.gambit;
  if (!g) return null;
  if (g.rules && typeof g.rules === 'object') { var fixed = checked(g.rules).tables; return { get: function () { return fixed; } }; }
  // (GC_GAMBIT_RULES names another file: a run can hand the bot its own rules without touching the profile)
  if (process.env.GC_GAMBIT_RULES) return new Rules(process.env.GC_GAMBIT_RULES);
  return new Rules(path.isAbsolute(g.rules) ? g.rules : path.join(dir, g.rules));
}

module.exports = { named: named, near: near, nearList: nearList, lead: lead, tier: tier, floor: floor, breakBy: breakBy, aimsOf: aimsOf, gridFacts: gridFacts, keeps: keeps, facts: facts, enemyFacts: enemyFacts, test: test, holds: holds, meets: meets, deadline: deadline, choose: choose, checked: checked, Rules: Rules, rulesFor: rulesFor };
