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

// WHETHER A LINE FITS THE LIST: what it makes fits it (its own clears: a combo it makes alone is a combo, a link it adds is the chain's),
// and so does what the board makes along it as the game counts it (j: attacker.judge's answer) -- the chain it reaches (chainAll: a chain
// already falling, the links before it and the board's own continuation as far as the line leaves it running) and every clear of its own
// (singles: panels out of a broken slab falling into a match of their own among them)
function fitsList(list, m, j) {
  return GAMBIT.fits(list, m) && !(j && j.chainAll >= 2 && !GAMBIT.fits(list, { combo: 0, chain: j.chainAll })) &&
         !(j && (j.singles || []).some(function (z) { return !GAMBIT.fits(list, { combo: z, chain: 1 }); }));
}

// THE LIST FOR ONE STEP ON THE ENGINE (attacker.useList): its own clears each fit, and the chain it reaches fits and is within MAXCHAIN
function stepFits(list) {
  return function (sizes, chain) {
    return chain <= GAMBIT.MAXCHAIN && (chain < 2 || GAMBIT.fits(list, { combo: 0, chain: chain })) && sizes.every(function (z) { return GAMBIT.fits(list, { combo: z, chain: 1 }); });
  };
}

// THE OUTCOME OF A LINE (plans/decision.md, step 3): the whole line played on the engine as it will be pressed (attacker.judge), once per
// line a decision, and every fact the decision reads about it taken from that one playing -- no search, filter or rank works any out
// for itself:
//   made, chainAll, singles   what it makes, as the game counts it; fits: all of it within the list (fitsList)
//   done, fire, ats           when it is done, its last swap begun, every swap begun
//   dropAt                    the frame garbage can next drop once it is over (stop, pre-stop, shake)
//   lostAt                    the frame its board, left alone, is lost -- Infinity when it stands to the horizon (SURVIVE_FRAMES, or its
//                             last swap if later) and SURVIVE_REST past it, as the default's survival search proves a move
//   ready                     once everything shown has landed and settled, a break within two swaps the list allows
//   lives                     it stands, or it leaves a plan -- with garbage on its way, a line that breaks nothing only by the plan;
//                             topped out, a plan only for a line that buys stop: the board always has to have some stop
// { dead, lostAt } when the judge could not play the line out (its board lost on the way, or a step not legal).
var CPU = require(path.join(__dirname, 'puyocpu.js')).prototype, HORIZON = CPU.SURVIVE_FRAMES, REST = CPU.SURVIVE_REST, BEAM = CPU.SURVIVE_BEAM;
function lastLanding(c, R) {
  var land = null;
  c.arrivals.forEach(function (a) { if (land === null || a.at > land) land = a.at; });
  if (land === null && R.F.us.nextLands != null) land = R.F.us.nextLands;
  return land;
}
function outcome(c, R, seq, isSettled) {
  var key = (isSettled ? 's ' : 'r ') + seq.map(function (mv) { return mv[0] + ',' + mv[1]; }).join(' ');
  c.outcomes = c.outcomes || {};
  if (key in c.outcomes) return c.outcomes[key];
  // (garbage on its way -- shown arriving, or queued to drop: a line that breaks nothing lives only when a break is there once it has all
  // landed, however long the stop it stands on lasts -- ready when everything lands, with a plan; the readiness is asked of it always.
  // A break, or a board with nothing coming, lives by standing to the horizon too)
  var land = lastLanding(c, R), timeLeft = !c.left || c.left() > 0, coming = land !== null && land !== undefined;
  var j = c.attacker.judge(c.board, c.m.hold, seq, c.arrivals, { settled: isSettled, tight: c.tight, readyAt: timeLeft ? land : null, readyIfLost: !coming, readyIfBreak: true,
                                                                          readyBy: c.due ? c.due - c.margin : null, lifeTo: HORIZON + REST, lifeRest: REST });
  var o = { dead: true, lostAt: j.lostAt, lives: false };
  if (!j.dead) {
    var stopNow = Math.max((c.board.stopTime || 0) + (c.board.preStopTime || 0), c.board.shakeTime || 0);
    var ready = R.F.us.topped && !(j.dropAt > stopNow) ? false : j.ready, breaks = (j.made.broke || 0) > 0, stands = j.lostAt === Infinity;
    var lives = breaks || !coming ? stands || ready === true : ready === true || (ready === undefined && stands);
    o = { made: j.made, chainAll: j.chainAll || 0, singles: j.singles || [], fits: fitsList(R.list, j.made, j) && Math.max(j.made.chain || 0, j.chainAll || 0) <= GAMBIT.MAXCHAIN,
          done: j.done, fire: j.fire, ats: j.ats, dropAt: j.dropAt, lostAt: j.lostAt, ready: ready, lives: lives };
  }
  c.outcomes[key] = o;
  return o;
}

// THE SHARED LINE CHECK (attacker.useRules line, every play's): the whole line judged once on the engine, in a context of its own so a
// search can ask it mid-search (attacker.judgeIn), and taken as the ranking takes it -- what it makes and sets off fits the list, the chain
// is within MAXCHAIN, and below the rule's material floor it does not clear panels and break nothing. Cached per decision. { ok, made }
function lineFits(c, R, seq, isSettled) {
  var key = (isSettled ? 's ' : 'r ') + seq.map(function (mv) { return mv[0] + ',' + mv[1]; }).join(' ');
  c.fitsOf = c.fitsOf || {};
  if (key in c.fitsOf) return c.fitsOf[key];
  // (the searches asking it are the decision's work: a check not begun by the decision's deadline keeps no line)
  if (c.due && Date.now() >= c.due - (c.margin || 0)) return { ok: false, made: null, late: true };
  var A = c.attacker, j = (A.judgeIn || A.judge)(c.board, c.m.hold, seq, c.arrivals, { settled: isSettled, tight: c.tight }), m = j.made, ok = !j.dead;
  ok = ok && fitsList(R.list, m, j) && Math.max(m.chain || 0, j.chainAll || 0) <= GAMBIT.MAXCHAIN;
  ok = ok && !(R.keep && R.keep.material !== undefined && !GAMBIT.test(R.F.us.material, R.keep.material) && (m.combo > 0 || m.chain > 0) && !(m.broke > 0));
  return (c.fitsOf[key] = { ok: ok, made: m });
}

// THE JUDGE: a candidate, filtered and ranked -- null when it is no candidate. { play, seq, tier, sub, ap, aim, extend, near }
// (why each candidate was dropped, counted per decision for the log: c.dropped[play] = { back, list, late, floor, ready }; and unbroken,
// a line its search said breaks that the judge says does not -- counted, not dropped for it)
function drop(c, play, why) { var d = c.dropped || (c.dropped = {}), t = d[play] || (d[play] = { back: 0, list: 0, late: 0, floor: 0, ready: 0, unbroken: 0 }); t[why] = (t[why] || 0) + 1; return null; }
function judge(c, R, k) {
  if (!k) return null;
  var x = k.x, play = k.play, seq = k.seq, aim = k.aim;
  // (what it makes is the whole line on the engine, as the judge counts it -- every step's clears, the chain broken garbage sets off, a
  // link added to a chain already falling, the garbage broken beyond what the board breaks alone -- not what the search that found it
  // counted; a line the judge could not play out is judged on the search's word)
  var st = k.settled !== undefined ? k.settled : settled(play), oc = outcome(c, R, seq, st), j = oc.dead ? null : oc, w = j ? j.made : null;
  var m = w ? { combo: w.combo, chain: w.chain, broke: w.broke, cells: x.cells || 0 } : x;
  // (the search that found it said it breaks and the judge, playing it as it will be pressed, says it does not: counted for the log)
  if (w && x.broke > 0 && !(w.broke > 0)) drop(c, play, 'unbroken');
  if (swapBack(c, seq[0], (m.combo || 0) > 0 || (m.chain || 0) > 0 || (m.broke || 0) > 0)) return drop(c, play, 'back');
  // (it fits the list, or it is no candidate -- the chain as the game counts it: with a chain already falling, what the board makes after
  // the move, its own continuation and every link the move adds; its place in the list is the first entry it matches)
  if (!fitsList(R.list, m, j)) return drop(c, k.play, 'list');
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
    var fc = c.attacker.firstClear(c.board, c.m.hold, seq, c.arrivals, { tight: c.tight });
    if (fc === 0) { play = 'clear'; x = { combo: 3, chain: 1 }; m = x; }
    else if (fc > 0) seq = seq.slice(0, fc);
  }
  // (ranked on the judge's count and time: what the line makes, and when it is done)
  var t = GAMBIT.tier(play, Object.assign({}, x, { combo: m.combo, chain: m.chain, broke: m.broke, done: j ? j.done : x.done, dropAt: j ? j.dropAt : 0 }), aim, R.under, !!R.F.enemy.topped, !!R.F.us.topped, !!R.F.us.breakWaits);
  // (topped out, the stop time and the shake are the board's life: a line that keeps it held past what is left now comes first -- in the list's
  // order, the longer stop only between two of the same entry)
  var stopNow = Math.max((c.board.stopTime || 0) + (c.board.preStopTime || 0), c.board.shakeTime || 0);
  if (R.F.us.topped && j && j.dropAt > stopNow) t = { tier: 0, sub: [aim >= 0 ? aim : 99, -j.dropAt] };
  return { play: play, seq: seq, settled: st, tier: t.tier, sub: t.sub, aim: aim, extend: k.extend, near: x.near || 0, o: oc,
           ap: { seq: seq, done: j ? j.done : (x.done || null), fire: fire, ats: j ? j.ats : (x.ats || null), chain: m.chain || 0, chainAll: j ? j.chainAll || 0 : 0, combo: m.combo || 0, broke: m.broke || 0, played: !!j } };
}
// THE HOLD, a candidate like any other: nothing pressed, its outcome the board's own -- below every play that fits, above a clear
var HOLD_TIER = 5;
function hold(c, R, wait) {
  var oc = outcome(c, R, [], false), j = oc.dead ? null : oc;
  return { play: 'hold', seq: [], settled: false, tier: HOLD_TIER, sub: wait ? [-1] : [0], aim: -1, near: 0, o: oc, hold: true, wait: !!wait,
           ap: { seq: [], done: j ? j.done : null, fire: null, ats: null, chain: 0, chainAll: j ? j.chainAll : 0, combo: 0, broke: 0, played: !!j } };
}

// A DIG THAT CAN WAIT (gambit_decide.js ranked): a line toward a break that lives no longer than the hold H, and is still done before the
// hold is lost after `react` frames more
function digWaits(k, H, react) {
  return k.play === 'toward' && !k.o.lives && !H.o.lives && H.o.lostAt != null && k.o.done != null && k.o.lostAt <= H.o.lostAt && H.o.lostAt - k.o.done > react;
}

// THE RANK, one order for every candidate (plans/decision.md, step 4): a line that lives before one that does not; of two that live, the
// tier (the list's order and the engine's timing within it), then each sub-key in turn; of two that do not, the one whose board is lost
// later, then the tier
function lostOf(x) { return x.o && x.o.lostAt != null ? x.o.lostAt : -1; }
function compare(x, y) {
  var lx = !!(x.o && x.o.lives), ly = !!(y.o && y.o.lives);
  if (lx !== ly) return lx ? -1 : 1;
  if (!lx && lostOf(x) !== lostOf(y)) return lostOf(y) - lostOf(x);
  if (x.tier !== y.tier) return x.tier - y.tier;
  for (var q = 0; q < Math.min(x.sub.length, y.sub.length); q++) if (x.sub[q] !== y.sub[q]) return x.sub[q] - y.sub[q];
  return 0;
}

module.exports = { stepFits: stepFits, fitsList: fitsList, lineFits: lineFits, outcome: outcome, hold: hold, HOLD_TIER: HOLD_TIER, HORIZON: HORIZON, REST: REST, BEAM: BEAM, lastLanding: lastLanding, judge: judge, compare: compare, digWaits: digWaits, settled: settled, SETTLED: SETTLED, swapBack: swapBack, drop: drop };
