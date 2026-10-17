// GAMBIT'S TURN (plans/decision.md): a question from the frame loop answered by Gambit alone -- its own searches, its own decision, its
// own judge of which moves live. Nothing of the older bots' search, preferences, guards or overrides.
//
//   breakSearch   the break search's lines, for the proposers
//   decide        read, propose, judge, rank (gambit_decide.js)
//   lives         which moves live, on the engine: Gambit's first in its order, then any swap that fits the list -- never one past
//                 GAMBIT.MAXCHAIN; with none that lives, the one that dies latest
//   answer        the move, the raise held, what the log and the audit read
//
// c: { bot (the survival search, puyocpu.js), m (the question), board, arrivals, due (ms clock), t0, attacker, search() (the break
// search's engine), rules, GP (the profile's gambit), pace, margin (ms), nativeMem() }
var path = require('path');
var GAMBIT = require(path.join(__dirname, 'gambit.js')), DECIDE = require(path.join(__dirname, 'gambit_decide.js')), JUDGE = require(path.join(__dirname, 'gambit_judge.js'));
var SH = require(path.join(__dirname, 'survivor_shared.js')), CK = require(path.join(__dirname, 'survivor_checks.js')), KEYS = require(path.join(__dirname, 'survivor_keys.js'));

// THE BREAK SEARCH: the lines to a break, in the share of the decision's time it is given (a line begun is carried on as the line in
// progress, not by the break search)
var BREAK_SHARE = 0.4, BREAK_MIN_MS = 40, BREAK_MAX_MS = 400, LINEUP_AFTER = 30;
function breakSearch(c) {
  var board = c.board, bot = c.bot;
  // (no break search on a question due sooner than it could take: the answer would come late)
  if (c.due && c.due - Date.now() < c.margin + BREAK_MIN_MS) return { br: null, ms: 0 };
  bot._natSearch();   // (the engine, on the bot's threads, before a second context is made on it)
  var t = Date.now(), pop = SH.popLeft(board);
  var by = c.due ? Math.min(t + Math.max(BREAK_MIN_MS, c.m.ms * BREAK_SHARE), c.due - c.margin) : t + BREAK_MAX_MS;
  var br = SH.breakMoves(c.search(), board, { left: c.m.hold.left, started: c.m.hold.started }, c.arrivals, 1, pop ? pop + LINEUP_AFTER : 0, by,
                         c.stale ? function () { return c.stale() ? c.aborted : null; } : null, null, { touchInPop: true, near: true });
  if (br) br.cut = Date.now() >= by;
  return { br: br, ms: Date.now() - t };
}

function keyOf(k) { return k.kind === 'swap' && k.move ? k.move[0] + ',' + k.move[1] : k.kind; }

// WHICH MOVES LIVE, GAMBIT'S OWN (plans/decision.md): every move judged on the engine as it will be pressed (attacker.judge), the board it
// leaves then left alone -- it lives as the default's survival search proves a move: still alive at the horizon (SURVIVE_FRAMES, or the
// line's own end if later) and SURVIVE_REST frames of standing still past it (puyocpu.js, the same numbers) -- or when, everything shown
// landed and settled, a break is left within two swaps (ready: a plan). One judge for every move: Gambit's lines, the hold, and when none
// of them lives the lines of Gambit's survival search (outlive: the default's beam, SURVIVE_BEAM wide, every clear within the list). A
// raise lives only as Gambit decided it (R.up: raiseReady played it out). With nothing living, the move whose board is lost latest --
// Gambit's order between equals.
var CPU = require(path.join(__dirname, 'puyocpu.js')).prototype;
var HORIZON = CPU.SURVIVE_FRAMES, REST = CPU.SURVIVE_REST, BEAM = CPU.SURVIVE_BEAM;
function lastLanding(c, R) {
  var land = null;
  c.arrivals.forEach(function (a) { if (land === null || a.at > land) land = a.at; });
  if (land === null && R.F.us.nextLands != null) land = R.F.us.nextLands;
  return land;
}
// one move judged: { lives, lostAt, ready } -- the readiness the decision already found for a candidate (k.ready, gambit_decide ready())
// is not looked for again; the readiness check only when the board left alone does not stand
function survives(c, R, seq, isSettled, k) {
  var land = lastLanding(c, R), known = k && k.ready !== undefined;
  var j = c.attacker.judge(c.board, c.m.hold, seq, c.arrivals, { settled: isSettled, tight: c.tight, readyAt: known ? null : land, readyIfLost: true, lifeTo: HORIZON + REST, lifeRest: REST });
  var ready = known ? k.ready : j.ready;
  // (topped out the board always has to have some stop: a plan left for later is no life for a move that buys none -- one whose garbage
  // can drop no later than it can now, the hold among them)
  var stopNow = Math.max((c.board.stopTime || 0) + (c.board.preStopTime || 0), c.board.shakeTime || 0);
  if (R.F.us.topped && !(j.dropAt > stopNow)) ready = false;
  return { lives: !j.dead && (j.lostAt === Infinity || ready === true), lostAt: j.lostAt, ready: ready, dead: j.dead };
}
function lives(c, D) {
  var left0 = Math.round(c.left()), R = D.R, order = D.order, list = R.list, seen = {}, best = null, tried = 0, live = 0, d = null, why = 'gambit', verdict = 'dies';
  var asMove = function (k) { return k === 'hold' || k === 'raise' ? { kind: k } : { kind: 'swap', move: k.split(',').map(Number) }; };
  var lineOf = function (k) {
    if (k === 'hold') return { seq: [], settled: false, k: { ready: D.R.aloneReadyJ } };
    var cand = D.cands.filter(function (x) { return !x.wait && x.seq[0][0] + ',' + x.seq[0][1] === k; })[0];
    return cand ? { seq: cand.seq, settled: !!cand.settled, k: cand } : { seq: [k.split(',').map(Number)], settled: false, k: null };
  };
  var weigh = function (k, src, given) {
    if (seen[k]) return false;
    seen[k] = true;
    if (k === 'raise') { if (!R.up) return false; d = asMove(k); verdict = 'ready'; why = src; return true; }
    var ln = given || lineOf(k), v = survives(c, R, ln.seq, ln.settled, ln.k);
    tried++;
    if (v.lives) { live++; d = asMove(k); verdict = v.ready === true ? 'ready' : 'proven'; why = src; return true; }
    if (!best || v.lostAt > best.lostAt) best = { k: k, lostAt: v.lostAt };
    return false;
  };
  // (Gambit's, in its order: the first that lives -- its place in the order first)
  for (var i = 0; i < order.length && !d; i++) if (i === 0 || c.left() > 0) weigh(order[i], 'gambit');
  // (none lives: the hold, then Gambit's survival search -- a line of swaps whose board stands, every clear on it within the list --
  // judged as every move is; its first swap is played, and the next decision searches again from the board it makes)
  if (!d) {
    if (!R.aloneOut && c.left() > 0) weigh('hold', 'fits');
    var ms = c.left();
    if (!d && ms > 0) {
      var sv = c.attacker.outlive(c.board, c.m.hold, c.arrivals, { to: HORIZON + REST, rest: REST, beam: BEAM, ms: ms });
      if (sv && sv.seq.length) {
        var k0 = sv.seq[0][0] + ',' + sv.seq[0][1], jl = c.attacker.judge(c.board, c.m.hold, sv.seq, c.arrivals, { tight: c.tight });
        if (!jl.dead && JUDGE.fitsList(list, jl.made, jl) && Math.max(jl.made.chain || 0, jl.chainAll || 0) <= GAMBIT.MAXCHAIN) {
          seen[k0] = false;
          weigh(k0, 'survive', { seq: sv.seq, settled: false, k: null });
          if (!d && sv.lostAt > ((best && best.lostAt) || 0)) best = { k: k0, lostAt: sv.lostAt };
        }
      }
    }
  }
  // (nothing lives: the move whose board is lost latest; nothing judged at all, the hold)
  if (!d) { d = best ? asMove(best.k) : { kind: 'hold' }; why = 'latest'; verdict = 'dies'; }
  // (live: of the moves judged, how many live / how many judged / how many Gambit ranked)
  return { d: d, verdict: verdict, holdLives: d.kind === 'hold' && verdict !== 'dies', gambits: order.indexOf(keyOf(d)) >= 0, cand: null, live: live + '/' + tried + '/' + order.length, why: why, left: left0 };
}

// THE RAISE HELD DOWN: the engine raises a displacement step a frame while the button is held, row after row. A raise answer presses
// the steps the row has left and leaves the button held for the rows on to the rule's `to`; the frame loop lets go when the stack tops
// out. Every decision while it is held sees the board as it is and decides again: it keeps the raise going or lets it go for the plan.
// { now, after } in frames.
var ROW_STEPS = 16;
function raiseHeld(c, to) {
  var now = Math.max(1, (c.board.displacement || ROW_STEPS) - 1), rows = Math.max(0, (to || 0) - CK.fullTop(c.board) - 1);
  return { now: now, after: rows * ROW_STEPS };
}

// THE CLAIM (survivor_audit.js): what the line Gambit chose said it would make, when the move played is its first swap
function claimOf(info, d) {
  if (!info || !info.found || d.kind !== 'swap' || !info.order || info.order[0] !== keyOf(d)) return null;
  return { play: info.play, chain: info.chain || 0, chainAll: info.chainAll || 0, combo: info.combo || 0, broke: info.broke || 0, done: info.done != null ? info.done : (info.fire || 0), seq: info.seq || null };
}

// the panels on the board whose colour the game has not shown yet (a broken slab's row before it is revealed: 130..219)
function unseenOf(b) { var n = 0; for (var r = 0; r < b.panels.length; r++) for (var k = 1; k <= 6; k++) { var p = b.panels[r] && b.panels[r][k]; if (p && p.color >= 130 && p.color <= 219) n++; } return n; }

// ONE LINE A DECISION on stderr, the survivor's log: what Gambit chose, what was played and why, the verdict, the board
function logLine(c, D, L, br, brMs) {
  var g = D.info, F = D.R.F.us, d = L.d;
  console.error('GAMBITD ' + c.m.at + ' ' + (g.name || '') + ' play=' + (g.play || '-') + ' want=' + (g.want || '-') + ' got=' + (d.kind === 'swap' && d.move ? d.move.join(',') : d.kind) +
    ' src=' + (L.gambits ? 'gambit' : 'survival') + ' v=' + L.verdict + ' under=' + (g.under ? 1 : 0) + ' mat=' + F.material + ' chain=' + (g.chain || 0) + ' combo=' + (g.combo || 0) +
    ' broke=' + (g.broke || 0) + ' tier=' + (g.tier || 0) + ' by=' + (g.by || '-') + ' plan=' + (g.pl || '-') + ' done=' + (g.done != null ? g.done : '-') + ' fire=' + (g.fire != null ? g.fire : '-') +
    ' ats=' + (g.ats || '-') + ' swaps=' + (g.swaps || 0) + ' land=' + (F.nextLands != null ? F.nextLands : '-') + ' dies=' + F.dies + (F.queueKills ? ' qk=1' : '') + (D.R.aloneOut ? ' alone=' + D.R.aloneChain : '') + ' casc=' + (CK.cascadeLive(c.board, true) ? 1 : 0) +
    ' pop=' + SH.popLeft(c.board) + ' stop=' + F.stop + ' waits=' + (F.breakWaits ? 1 : 0) + ' unseen=' + unseenOf(c.board) + ' tight=' + (c.tight ? 1 : 0) +
    ' br=' + (br ? (br.depth || 0) + '/' + (br.path ? br.path.length : br.toward ? 't' + br.toward.length : 0) + (br.cut ? '/cut' : '') : 'none') + ' brMs=' + brMs + ' cands=' + (g.cands || '-') + ' live=' + L.live + ' left=' + (L.left > 1e8 ? '-' : L.left) + ' wallMs=' + (c.wall0 ? Number(process.hrtime.bigint() - c.wall0) / 1e6 : 0).toFixed(1) + ' why=' + L.why);
}

function answer(c) {
  var bot = c.bot, m = c.m;
  c.wall0 = process.hrtime.bigint();   // (the decision's real time, whatever clock the searches read: GC_FIXED_CLOCK)
  // (the input budget tight: the frame loop walks held from two cells, so every line is judged pressed as it walks -- attacker.judge)
  c.tight = m.allowance != null && m.allowance <= KEYS.HOLDTIGHT;
  var B = breakSearch(c);
  c.br = B.br; c.brMs = B.ms;
  c.canRaise = function () { return bot._canRaise(); };
  c.left = function () { return c.due ? c.due - Date.now() - 2 * c.margin - 100 : 1e9; };
  var D = DECIDE.decide(c);
  if (!D) return null;
  if (D.R.F.us.contact !== null || D.R.F.us.topped) bot._gambitHit = true;
  var L = lives(c, D), d = L.d;
  // (the line in progress is the line of the move played; a hold for a waiting line in progress keeps it)
  if (!(d.kind === 'hold' && D.line && D.line.wait)) {
    var playedK = d.kind === 'swap' ? D.cands.filter(function (k) { return !k.wait && k.seq[0][0] === d.move[0] && k.seq[0][1] === d.move[1]; })[0] : null;
    bot._gambitCarry = DECIDE.carryOf(c, D.R, playedK);
  }
  // (no swap back: the pair the last swap swapped is kept out for a second when it is swapped three times running)
  var pr = d.kind === 'swap' && c.board.panels[d.move[0]], pa = pr && pr[d.move[1]], pb = pr && pr[d.move[1] + 1];
  var pair = pa && pb && pa.id != null && pb.id != null ? [pa.id, pb.id].sort().join(',') : (d.kind === 'swap' ? null : bot._gambitLastPair);
  bot._gambitPairRuns = pair && pair === bot._gambitLastPair ? (bot._gambitPairRuns || 0) + 1 : 0;
  if (bot._gambitPairRuns >= 2) bot._gambitBlock = { pair: pair, until: m.at + 60 };
  bot._gambitLastPair = pair;
  bot._gambitIdle = d.kind === 'hold' || !D.info.want;
  D.info.verdict = L.verdict; D.info.live = L.live; D.info.why = L.why;
  logLine(c, D, L, c.br, c.brMs);
  var made = L.gambits && d.kind === 'swap' ? { combo: D.info.combo || 0, chain: D.info.chain || 0, broke: D.info.broke || 0 } : { combo: 0, chain: 0, broke: 0 }, held = d.kind === 'raise' ? raiseHeld(c, D.R.to) : { now: 0, after: 0 };
  return { id: m.id, epoch: m.epoch, at: m.at, src: L.gambits ? 'gambit' : 'survival', kind: d.kind, move: d.move ? [d.move[0], d.move[1]] : null,
           raiseFrames: held.now, raiseAfter: held.after, ms: Date.now() - c.t0, idleMs: D.idleMs || 0,
           claim: claimOf(D.info, d), queued: m.posted ? c.t0 - m.posted : 0, brMs: c.brMs,
           // (every swap is its own decision, judged on the board as it is when it is pressed: the frame loop is handed no line to press
           // on its own clock -- the rest of a line is carried on by the next decisions, as the line in progress)
           line: null, lineAt: null, lineFree: false,
           pace: { hold: L.holdLives, brk: !!(c.br && c.br.depth), urgent: !!D.urgent },
           mem: c.nativeMem(),
           breaks: c.br && c.br.depth ? { offered: c.br.depth, lineup: !!c.br.lineup, touch: !!c.br.touch, took: !!(c.br.moves && d.move && c.br.moves[keyOf(d)]) } : null,
           diag: { walk: null,
                   clears: (made.combo > 0 || made.broke > 0) ? 1 : 0, gambit: D.info } };
}

module.exports = { answer: answer, lives: lives, survives: survives, breakSearch: breakSearch };
