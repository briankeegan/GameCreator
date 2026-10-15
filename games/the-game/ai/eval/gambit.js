// GAMBIT: a bot whose aims are a rule table. Each decision reads the same facts off both boards, takes the first rule whose `when`
// holds, and searches for a line that makes what its `aim` asks by its `by`; the survival search only vetoes a line that dies, so the
// aim is chased while the board lives. The rules live in a JSON file (the profile's `gambit.rules`) read again whenever it changes.
//
//   rule: { name, when: { field: test, ... }, aim: { ... }, by: frames | field, else: aim | "default" | "hold" }
//   field: "us.<fact>" or "enemy.<fact>"; test: a value (equal) or a string ">=9", "<4", "==0", "!=0"
//   aim: { combo: test, chain: test, break: true | false, send: test (cells), any: [aim, ...] }  -- every key given must hold
//
// Facts, the same names for both boards (an enemy fact the host does not send is undefined, and a test on it is false):
//   topped, stop (frames), height (rows, garbage included), material (panels under the garbage), contact (columns reaching the
//   garbage), evenness (tallest panel column less lowest), coming (rows on their way), heavy (coming > 8), nextLands (frames)
var fs = require('fs'), path = require('path');

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
  (board.incoming || []).slice(0, 1).forEach(function (g) { coming += g.height || 0; if (next === null) next = 0; });
  return {
    topped: !!topped, stop: stop, height: top, material: material, contact: garb ? contact : null,
    evenness: Math.max.apply(null, peaks) - Math.min.apply(null, peaks), coming: coming, heavy: coming > 8, nextLands: next
  };
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
// A deadline: frames, or a fact ("us.nextLands", "enemy.stop", ...). An unknown one is no deadline.
function deadline(F, by) {
  if (typeof by === 'number') return by;
  if (typeof by === 'string') { var v = field(F, by); return typeof v === 'number' ? v : null; }
  return null;
}
// The rule that applies: the first whose `when` holds. { rule, index } or null.
function choose(rules, F) {
  for (var i = 0; i < (rules || []).length; i++) if (holds(F, rules[i].when)) return { rule: rules[i], index: i };
  return null;
}

// THE RULES FILE, read again whenever it changes (its mtime): it may be rewritten between matches or while one runs, and the next
// decision plays by it. { rules: [...], opponents: { "<name>": [...] } } -- an opponent with rules of its own is played by those.
// A file that fails to read or parse leaves the last good rules in force.
function Rules(file) { this.file = file; this.mtime = -1; this.all = { rules: [] }; this.error = null; }
Rules.prototype.get = function (opponent) {
  try {
    var st = fs.statSync(this.file);
    if (st.mtimeMs !== this.mtime) {
      var j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.all = Array.isArray(j) ? { rules: j } : { rules: j.rules || [], opponents: j.opponents || {} };
      this.mtime = st.mtimeMs; this.error = null;
      console.error('GAMBIT rules ' + this.file + ': ' + this.all.rules.length + ' rules, ' + Object.keys(this.all.opponents || {}).length + ' opponents');
    }
  } catch (e) { this.error = String(e && e.message || e); }
  var own = opponent && this.all.opponents && this.all.opponents[opponent];
  return own || this.all.rules;
};
function rulesFor(profile, dir) {
  var g = profile && profile.gambit;
  if (!g) return null;
  if (Array.isArray(g.rules)) return { get: function () { return g.rules; } };
  // (GC_GAMBIT_RULES names another file: a run can hand the bot its own rules without touching the profile)
  if (process.env.GC_GAMBIT_RULES) return new Rules(process.env.GC_GAMBIT_RULES);
  return new Rules(path.isAbsolute(g.rules) ? g.rules : path.join(dir, g.rules));
}

module.exports = { facts: facts, enemyFacts: enemyFacts, test: test, holds: holds, meets: meets, deadline: deadline, choose: choose, Rules: Rules, rulesFor: rulesFor };
