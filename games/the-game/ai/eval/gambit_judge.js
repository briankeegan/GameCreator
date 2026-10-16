// GAMBIT'S JUDGE (plans/decision.md, steps 3 and 4): every candidate a proposer offers is played on the engine as the game will press
// it, then filtered and given its rank. One function for every kind of move.
var path = require('path');
var GAMBIT = require(path.join(__dirname, 'gambit.js'));

// THE PLAYS JUDGED SETTLE BY SETTLE: a planned line presses each step once the board has settled from the last, and is judged so; any
// other line is a run of swaps made one after the other, and is judged so. (Every swap is still its own decision: each later step is
// judged again, on the board as it then is.)
var SETTLED = ['entry', 'nearest', 'break line', 'carry', 'carry wait', 'clear'];
function settled(play) { return SETTLED.indexOf(play) >= 0; }
// THE SET-UPS: plays that move panels toward the ask or a break and clear nothing on the way
var SETUPS = ['setup', 'level', 'ready', 'toward'];

// A SWAP BACK: the same two panels the last swap swapped, which puts the board back as it was -- no play, unless the line clears or
// breaks on this board (as the judge plays it); and even then not after the same pair twice running -- a clear predicted on panels not
// yet seen that never comes is the same loop
function swapBack(c, mv, clears) {
  var bot = c.bot, row = c.board.panels[mv[0]], a = row && row[mv[1]], b = row && row[mv[1] + 1];
  var ids = a && b && a.id != null && b.id != null ? [a.id, b.id].sort().join(',') : null;
  if (ids && bot._gambitBlock && bot._gambitBlock.pair === ids && c.m.at < bot._gambitBlock.until) return true;
  return !!(bot._gambitLastPair && ids === bot._gambitLastPair && (!clears || (bot._gambitPairRuns || 0) >= 2));
}

// The whole line played as it will be pressed (attacker.judge), once per line a decision: what it makes and when each step is begun --
// null when the judge could not play it out
function played(c, seq, isSettled) {
  var key = (isSettled ? 's ' : 'r ') + seq.map(function (mv) { return mv[0] + ',' + mv[1]; }).join(' ');
  if (!(key in c.judged)) { var j = c.attacker.judge(c.board, c.m.hold, seq, c.arrivals, { settled: isSettled, tight: c.tight }); c.judged[key] = j && !j.dead ? j : null; }
  return c.judged[key];
}

// THE JUDGE: a candidate, filtered and ranked -- null when it is no candidate. { play, seq, tier, sub, ap, aim, extend, near }
// (why each candidate was dropped, counted per decision for the log: c.dropped[play] = { back, list, late, floor, ready })
function drop(c, play, why) { var d = c.dropped || (c.dropped = {}), t = d[play] || (d[play] = { back: 0, list: 0, late: 0, floor: 0, ready: 0 }); t[why]++; return null; }
function judge(c, R, k) {
  if (!k) return null;
  var x = k.x, play = k.play, seq = k.seq, aim = k.aim;
  // (what it makes is the whole line on the engine, as the judge counts it -- every step's clears, the chain broken garbage sets off, a
  // link added to a chain already falling, the garbage broken beyond what the board breaks alone -- not what the search that found it
  // counted; a line the judge could not play out is judged on the search's word)
  var st = k.settled !== undefined ? k.settled : settled(play), j = played(c, seq, st), w = j ? j.made : null;
  var m = w ? { combo: w.combo, chain: w.chain, broke: w.broke, cells: x.cells || 0 } : x;
  if (swapBack(c, seq[0], (m.combo || 0) > 0 || (m.chain || 0) > 0 || (m.broke || 0) > 0)) return drop(c, play, 'back');
  // (it fits the list, or it is no candidate; its place in the list is the first entry it matches)
  if (!GAMBIT.fits(R.list, m)) return drop(c, k.play, 'list');
  // (below the rule's material floor -- `keep: { material }` -- a line that clears panels and breaks no garbage spends what the board
  // needs: no candidate, whoever offered it. A break is never held to the floor: it is where the panels come from)
  if (R.keep && R.keep.material !== undefined && !GAMBIT.test(R.F.us.material, R.keep.material) && (m.combo > 0 || m.chain > 0) && !(m.broke > 0)) return drop(c, k.play, 'floor');
  var entry = GAMBIT.entryOf(R.aims, m);
  if (entry >= 0 && (aim < 0 || entry < aim)) aim = entry;
  // (in time: every step its own time, the line's last swap begun by the deadline -- the frame the judge pressed it, for every move; the
  // search's own word only when the judge could not play the line out. The cascade it sets off runs on after.)
  var fire = j && j.fire != null ? j.fire : (x.fire != null ? x.fire : x.done);
  if (R.by && fire != null && fire > R.by) return drop(c, k.play, 'late');
  // (a set-up -- setup, level, ready, a step toward a break -- is to clear nothing: played to the board's settle step by step it ends
  // before its first step that clears panels and breaks nothing, and when that is its first, the play is a clear)
  if (SETUPS.indexOf(play) >= 0) {
    var fc = c.attacker.firstClear(c.board, c.m.hold, seq, c.arrivals);
    if (fc === 0) { play = 'clear'; x = { combo: 3, chain: 1 }; m = x; }
    else if (fc > 0) seq = seq.slice(0, fc);
  }
  // (ranked on the judge's count and time: what the line makes, and when it is done)
  var t = GAMBIT.tier(play, Object.assign({}, x, { combo: m.combo, chain: m.chain, broke: m.broke, done: j ? j.done : x.done }), aim, R.under, !!R.F.enemy.topped, !!R.F.us.topped, !!R.F.us.breakWaits);
  return { play: play, seq: seq, settled: st, tier: t.tier, sub: t.sub, aim: aim, extend: k.extend, near: x.near || 0,
           ap: { seq: seq, done: j ? j.done : (x.done || null), fire: fire, ats: j ? j.ats : (x.ats || null), chain: m.chain || 0, combo: m.combo || 0, broke: m.broke || 0 } };
}

// THE RANK: lower tier first, then each sub-key in turn
function compare(x, y) {
  if (x.tier !== y.tier) return x.tier - y.tier;
  for (var q = 0; q < x.sub.length; q++) if (x.sub[q] !== y.sub[q]) return x.sub[q] - y.sub[q];
  return 0;
}

module.exports = { judge: judge, compare: compare, settled: settled, SETTLED: SETTLED, swapBack: swapBack, drop: drop };
