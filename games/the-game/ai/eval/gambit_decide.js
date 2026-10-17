// GAMBIT'S DECISION (plans/decision.md): read the board, propose, judge, rank, play -- in that order, once a decision.
//
// c, the decision's context: { bot, m (the question: at, hold, topped, opp), board, arrivals, br (the break search's answer), brMs,
// attacker (survivor_attack.js), rules (GAMBIT.rulesFor), GP (the profile's gambit), pace, left() (ms the decision has left),
// canRaise() }. decide(c) is null when no rule applies; else what the decision chose (see play()).
var path = require('path');
var GAMBIT = require(path.join(__dirname, 'gambit.js')), PROPOSE = require(path.join(__dirname, 'gambit_propose.js'));
var JUDGE = require(path.join(__dirname, 'gambit_judge.js')), SH = require(path.join(__dirname, 'survivor_shared.js'));
var CK = require(path.join(__dirname, 'survivor_checks.js'));

// 1. READ: the facts of both boards, the mode and its list, the deadline, the floor every line keeps
function read(c) {
  var F = { us: GAMBIT.facts(c.board, c.arrivals, c.m.topped), enemy: GAMBIT.enemyFacts(c.m.opp) };
  // (the frames until the board is lost if nothing is done, from the engine with the garbage the game shows landing on it when it lands:
  // sooner than the rise alone takes, the garbage on its way decides it -- queueKills)
  var alone = c.attacker.diesIn(c.board, c.m.hold, c.arrivals, F.us.dies);
  F.us.queueKills = alone < F.us.dies;
  if (F.us.queueKills) F.us.dies = alone;
  var tables = c.rules.get(c.m.opp && c.m.opp.name), pick = c.GP.mode ? GAMBIT.named(tables, c.GP.mode) : GAMBIT.choose(tables, F);
  if (!pick) return null;
  var keep = pick.rule.keep || tables.keep || null, keepF = GAMBIT.floor(keep);
  // (the list as written; an entry "default" or "hold" ends it there)
  var list = GAMBIT.aimsOf(pick.rule), endAt = list.length, end = null;
  for (var i = 0; i < list.length; i++) if (typeof list[i] === 'string') { endAt = i; end = list[i]; break; }
  var aims = list.slice(0, endAt), listAims = aims, by = GAMBIT.deadline(F, pick.rule.by);
  // (every search on the engine this decision reads the list: readiness, the raise, the survival search)
  // (and the material floor: below it a step that clears and breaks nothing is out, as the judge drops it)
  var keep0 = pick.rule.keep || tables.keep || null;
  // (and a line's first swap is not the swap back the judge refuses)
  if (c.attacker.useRules) c.attacker.useRules({ fits: JUDGE.stepFits(list), floorLow: !!(keep0 && keep0.material !== undefined && !GAMBIT.test(F.us.material, keep0.material)),
                                                 first: function (mv, clears) { return !JUDGE.swapBack(c, mv, clears); } });
  // (garbage on the board: the search asks every entry to break it too; garbage on it or topped out, the deadline is a break's --
  // before the board dies; the rule's `by` is an attack's)
  // (topped out with no garbage on the board, there is nothing to break: the list as written, and the deadline is the board's)
  var under = tables.underGarbage !== 'ignore' && F.us.contact !== null;
  if (under) { aims = aims.map(function (a) { return Object.assign({}, a, { break: true }); }); end = 'default'; }
  if (under || F.us.topped) by = GAMBIT.breakBy(F);
  // (ready: garbage on its way and none on the board -- the frames until the next block lands, 0 for one queued to drop once settled)
  var readyAt = null;
  if (!under) { c.arrivals.forEach(function (a) { if (readyAt === null || a.at < readyAt) readyAt = a.at; }); if (readyAt === null && (c.board.incoming || []).length) readyAt = 0; }
  // (the opening raise: until garbage first reaches the board, below `to` rows and no chain running -- a row a decision, each decided
  // on what the board shows then; never after)
  var to = (pick.rule.raise || tables.raise || {}).to, opening = !c.bot._gambitHit && F.us.contact === null && !F.us.topped;
  var low = !!(to && opening && CK.fullTop(c.board) < to), up = low && !CK.cascadeLive(c.board, true) && c.canRaise();
  // (the raise is held for as many rows as leave the board a plan once everything the game shows has landed -- attacker.raiseReady,
  // played out on the engine; none of them: no raise now, the decision readies the board instead)
  if (up) {
    var rows = c.attacker.raiseReady(c.board, c.m.hold, c.arrivals, to - CK.fullTop(c.board), Math.min(RAISE_MS, Math.max(20, c.left())));
    if (rows <= 0) up = low = false; else to = CK.fullTop(c.board) + rows;
  }
  // (what the board left alone makes while a chain falls or a slab pops, as the game counts it -- the chain, and the clears of its own
  // the panels out of the slab make: outside the list, holding is outside it too)
  var R0 = { F: F, list: list }, aloneJ = CK.cascadeLive(c.board, true) || SH.popLeft(c.board) > 0 ? JUDGE.outcome(c, R0, [], false) : null;
  if (aloneJ && aloneJ.dead) aloneJ = null;
  var aloneChain = aloneJ ? aloneJ.chainAll || 0 : 0;
  var aloneOut = !!(aloneJ && !JUDGE.fitsList(list, { combo: 0, chain: 0 }, aloneJ));
  return { F: F, pick: pick, list: list, aloneChain: aloneChain, aloneOut: aloneOut, aims: aims, listAims: listAims, end: end, by: by, under: under, keep: keep, keepF: keepF, readyAt: readyAt,
           pop: SH.popLeft(c.board) > 0, to: to, low: low, up: up,
           preds: aims.map(function (a) { return function (made) { return GAMBIT.meets(a, made); }; }) };
}

// (the log's code for why a candidate was dropped: a swap back, outside the list, too late, below the material floor; unbroken, a line
// its search said breaks that the judge says does not -- counted, not dropped for it)
var DROP_CODE = { back: 'b', list: 'o', late: 't', floor: 'f', ready: 'r', unbroken: 'u' };
var RAISE_MS = 150;
// 2-4. PROPOSE, JUDGE AND RANK: every candidate offered -- the hold among them -- judged by its outcome (JUDGE.outcome) and put in the
// one order (JUDGE.compare). With none that lives and time left, Gambit's survival search proposes its line too (attacker.outlive: the
// default's beam), judged and ranked like the rest.
function ranked(c, R, S) {
  c.dropped = {}; c.offered = {};
  var offered = PROPOSE.all(c, R, S);
  offered.forEach(function (k) { c.offered[k.play] = (c.offered[k.play] || 0) + 1; });
  var out = offered.map(function (k) { return JUDGE.judge(c, R, k); }).filter(Boolean);
  // (the line in progress: first of its tier when its next step is due now; one whose next step must wait for the board is a hold
  // until then -- it ranks with the hold)
  var C = R.preds.length ? PROPOSE.carried(c, R) : null, cj = C && JUDGE.judge(c, R, C.cand);
  if (cj) { cj.wait = C.wait; if (cj.wait) { cj.tier = Math.max(cj.tier, JUDGE.HOLD_TIER); cj.sub = [-1]; } else cj.sub = [-Infinity].concat(cj.sub); out.push(cj); }
  // (the hold: never while the chain the board makes alone runs past the list)
  if (!R.aloneOut) out.push(JUDGE.hold(c, R, false));
  out.sort(JUDGE.compare);
  if (!(out[0] && out[0].o.lives) && c.left() > 0) {
    var sv = c.attacker.outlive(c.board, c.m.hold, c.arrivals, { to: JUDGE.HORIZON + JUDGE.REST, rest: JUDGE.REST, beam: JUDGE.BEAM, ms: c.left() });
    c.offered.survive = sv && sv.seq.length ? 1 : 0;
    var sk = sv && sv.seq.length ? JUDGE.judge(c, R, { play: 'survive', seq: sv.seq, x: {}, aim: -1, settled: false }) : null;
    if (sk) { out.push(sk); out.sort(JUDGE.compare); }
  }
  return out;
}

// 5. PLAY: the raise when the opening calls for it (R.up: raiseReady played it out), a hold while the raise waits for a busy board, else
// the first candidate in the one order -- a line's first swap, or the hold
function play(c, R, S, cands) {
  var wait = R.low && !R.up && !(cands[0] && cands[0].extend);
  var top = R.up || wait ? null : cands[0] || null;
  var line = top && !top.hold && !top.wait ? top : null, hold = !R.up && !line;
  var name = line ? line.play : R.up ? 'raise' : 'hold';
  var order = [];
  var add = function (k) { if (order.indexOf(k) < 0) order.push(k); };
  if (R.up) add('raise');
  if (wait) add('hold');
  cands.forEach(function (k) { add(k.hold || k.wait ? 'hold' : k.seq[0][0] + ',' + k.seq[0][1]); });
  // (pace: begun at once only in a window -- a chain falling, a slab popping -- or when its line is done within a pace gap of its deadline)
  var gap = (c.pace && c.pace.gap) || 0, done = line && line.ap && (line.ap.fire != null ? line.ap.fire : line.ap.done);
  var due = R.by || (R.under && R.F.us.dies > 0 ? R.F.us.dies : null) || (typeof R.readyAt === 'number' ? R.readyAt : null);
  var urgent = !!(line && line.extend) || SH.popLeft(c.board) > 0 || CK.cascadeLive(c.board, true) || (due !== null && due !== undefined && (done || 0) + gap >= due);
  var ap = S.ap, ex = S.ex;
  var pl = ap ? [ap.ms, ap.quick ? ap.quick.seq.length : 0, ap.nearest ? ap.nearest.seq.length : 0, (ap.perAim || []).filter(Boolean).length].join('/') + (ex && ex.nearest ? '+x' : '') : 'none';
  var br = c.br, chosen = R.up ? null : wait ? null : top, live = cands.filter(function (k) { return k.o && k.o.lives; }).length;
  var info = { pl: pl, table: R.pick.table, under: !!R.under, rule: R.pick.index, name: R.pick.rule.name || null, want: order[0] || null, options: order.length, order: order,
               found: !!line, play: name, entry: line ? line.aim : -1, near: line && line.near || 0, ms: ap ? ap.ms : 0,
               readyAt: typeof R.readyAt === 'number' ? R.readyAt : null, raise: R.up ? R.to : 0, wait: !!wait, extend: !!(line && line.extend), tried: S.tried,
               br: br ? [br.depth, br.toward ? br.toward.length : -1, br.lineup ? 1 : 0, br.touch ? 1 : 0] : null, brMs: c.brMs, pop: SH.popLeft(c.board),
               xs: ex ? [ex.seq.length, ex.chain, ex.cells, ex.base, ex.nearest ? ex.nearest.chain : 0] : null,
               chain: line ? line.ap.chain : 0, chainAll: line ? line.ap.chainAll || 0 : 0, combo: line ? line.ap.combo || 0 : 0, broke: line ? line.ap.broke || 0 : 0, tier: line ? line.tier : (hold ? JUDGE.HOLD_TIER : 0),
               seq: line ? line.seq.map(function (mv) { return mv.slice(); }) : null, swaps: line ? line.ap.seq.length : 0, done: line ? line.ap.done : null,
               fire: line ? line.ap.fire : null, ats: line && line.ap.ats ? line.ap.ats.join('/') : null, by: R.by,
               // (the one order's choice: whether it lives, the frame its board is lost, and how many candidates live of those ranked)
               lives: chosen ? !!chosen.o.lives : null, lostAt: chosen && chosen.o.lostAt != null ? chosen.o.lostAt : null, live: live + '/' + cands.length,
               // (per kind of move: how many were offered, and of them how many were dropped and why, DROP_CODE)
               cands: Object.keys(c.offered || {}).map(function (p) { var d = (c.dropped || {})[p]; return p.replace(/ /g, '_') + ':' + c.offered[p] + (d ? '-' + Object.keys(DROP_CODE).filter(function (w) { return d[w]; }).map(function (w) { return DROP_CODE[w] + d[w]; }).join('') : ''); }).join(',') };
  return { R: R, line: line, top: top, play: name, order: order, cands: cands, raise: R.up ? R.to : 0, urgent: urgent, info: info, idleMs: S.idleMs };
}
// THE LINE IN PROGRESS (plans/decision.md, step 5): the line of the move played, when it has more than one swap and is a play -- not a
// hold or a clear. It keeps how it is pressed (settle by settle, or swap after swap), what it was begun for (its entry, a break), and a
// panel of the bottom row it does not touch, by which it is found again once the stack has risen.
function carryOf(c, R, k) {
  if (!k || k.wait || k.seq.length < 2 || k.tier > 4) return null;
  var anchor = null;
  for (var col = 1; col <= 6 && !anchor; col++) {
    var p = c.board.panels[1] && c.board.panels[1][col];
    if (p && p.id != null && !k.seq.some(function (mv) { return mv[0] === 1 && (mv[1] === col || mv[1] + 1 === col); })) anchor = { row: 1, col: col, id: p.id };
  }
  if (!anchor) return null;
  return { rest: k.seq.slice(1).map(function (mv) { return mv.slice(); }), settled: k.settled, aim: k.aim >= 0 ? R.aims[k.aim] : null, broke: (k.ap.broke || 0) > 0, anchor: anchor };
}

function decide(c, R) {
  R = R || read(c);
  if (!R) return null;
  var S = PROPOSE.search(c, R);
  return play(c, R, S, ranked(c, R, S));
}

module.exports = { decide: decide, read: read, ranked: ranked, play: play, carryOf: carryOf };
