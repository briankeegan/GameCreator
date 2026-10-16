// GAMBIT'S TURN (plans/decision.md): a question from the frame loop answered by Gambit alone -- its own searches, its own decision, and
// the survival search asked one thing only: which moves live. Nothing of the older bots' preferences, guards or overrides.
//
//   breakSearch   the break search's lines, for the proposers
//   decide        read, propose, judge, rank (gambit_decide.js)
//   lives         the survival search, asked of every move: of those that live, Gambit's in its order, then any that fits the list,
//                 then any other -- never one past GAMBIT.MAXCHAIN; with none that lives, the one that dies latest
//   answer        the move, the rest of its line for the frame loop, the raise held, what the log and the audit read
//
// c: { bot (the survival search, puyocpu.js), m (the question), board, arrivals, due (ms clock), t0, attacker, search() (the break
// search's engine), rules, GP (the profile's gambit), pace, margin (ms), nativeMem() }
var path = require('path');
var GAMBIT = require(path.join(__dirname, 'gambit.js')), DECIDE = require(path.join(__dirname, 'gambit_decide.js'));
var SH = require(path.join(__dirname, 'survivor_shared.js')), CK = require(path.join(__dirname, 'survivor_checks.js'));

// THE BREAK SEARCH: the lines to a break, in the share of the decision's time it is given; the rest of the line begun last decision is
// played on while it still breaks (found again on this board by a bottom-row panel's id, the stack having risen since)
var BREAK_SHARE = 0.4, BREAK_MIN_MS = 40, BREAK_MAX_MS = 400, KEEP_FRAMES = 180, LINEUP_AFTER = 30;
function breakSearch(c) {
  var board = c.board, bot = c.bot, keep = null, K = bot._gambitKeep;
  if (K && c.m.at > K.at && c.m.at - K.at <= KEEP_FRAMES) {
    for (var r = 1; r < board.panels.length && keep === null; r++) {
      var p = board.panels[r] && board.panels[r][K.col];
      if (p && p.id === K.id) { var dr = r - K.row; keep = K.rest.map(function (mv) { return [mv[0] + dr, mv[1]]; }); }
    }
  }
  bot._gambitKeep = null;
  // (no break search on a question due sooner than it could take: the answer would come late)
  if (c.due && c.due - Date.now() < c.margin + BREAK_MIN_MS) return { br: null, ms: 0 };
  bot._natSearch();   // (the engine, on the bot's threads, before a second context is made on it)
  var t = Date.now(), pop = SH.popLeft(board);
  var by = c.due ? Math.min(t + Math.max(BREAK_MIN_MS, c.m.ms * BREAK_SHARE), c.due - c.margin) : t + BREAK_MAX_MS;
  var br = SH.breakMoves(c.search(), board, { left: c.m.hold.left, started: c.m.hold.started }, c.arrivals, 1, pop ? pop + LINEUP_AFTER : 0, by,
                         c.stale ? function () { return c.stale() ? c.aborted : null; } : null, keep, { touchInPop: true });
  if (br) br.cut = Date.now() >= by;
  return { br: br, ms: Date.now() - t };
}
// The line the break search began, kept for the next decision when its first swap is the move played
function keepBreakLine(c, br, d) {
  if (!(br && br.touch && br.path && br.path.length > 1 && d.kind === 'swap' && br.path[0][0] === d.move[0] && br.path[0][1] === d.move[1])) return;
  for (var col = 1; col <= 6; col++) {
    var p = c.board.panels[1] && c.board.panels[1][col];
    if (p && p.id != null && !br.path.some(function (mv) { return mv[0] === 1 && (mv[1] === col || mv[1] + 1 === col); })) {
      c.bot._gambitKeep = { rest: br.path.slice(1), at: c.m.at, row: 1, col: col, id: p.id };
      return;
    }
  }
}

// What a survival candidate's own swap makes, as the list reads it
function madeOf(k) {
  var r = k.added || k.resolved;
  if (!r) return { combo: 0, chain: 0, broke: 0 };
  var big = 0; (r.comboSizes || []).forEach(function (z) { if (z > big) big = z; });
  return { combo: big, chain: r.chainLength || 0, broke: r.brokeGarbage || 0 };
}
function keyOf(k) { return k.kind === 'swap' && k.move ? k.move[0] + ',' + k.move[1] : k.kind; }

// LIVES: the survival search over every move (none past MAXCHAIN); of the ones it finds live, Gambit's first in its order, then a move
// that fits the list, then any other. It returns its choice (puyocpu.js _decide: preferRank picks the moves it searches, preferProven
// orders the ones that live; with none that lives, the one living longest).
function lives(c, D) {
  var bot = c.bot, order = D.order, list = D.R.list;
  bot.preferRank = function (k) { return madeOf(k).chain > GAMBIT.MAXCHAIN ? Infinity : 5; };
  bot.preferProven = function (k) {
    var at = order.indexOf(keyOf(k));
    return at >= 0 ? -1e6 + at : GAMBIT.fits(list, madeOf(k)) ? -1e3 : -1;
  };
  var before = bot._verdictNo || 0, d = bot._decide();
  var V = (bot._verdictNo || 0) !== before ? bot._lastVerdict : null, verdict = 'unsearched', holdLives = false, live = 0, searched = 0;
  if (V) for (var i = 0; i < V.cands.length; i++) {
    var k = keyOf(V.cands[i]);
    if (k === keyOf(d)) verdict = V.verdict[i];
    if (k === 'hold') holdLives = V.verdict[i] === 'proven';
    if (order.indexOf(k) >= 0) { searched++; if (V.verdict[i] === 'proven' || V.verdict[i] === 'weak') live++; }
  }
  var cand = (bot._allCands || []).filter(function (k) { return keyOf(k) === keyOf(d); })[0] || null;
  // (live: of Gambit's moves, how many the survival search searched and how many it found live)
  return { d: d, verdict: verdict, holdLives: holdLives, gambits: order.indexOf(keyOf(d)) >= 0, cand: cand, live: live + '/' + searched + '/' + order.length };
}

// THE RAISE HELD FOR ONE ROW: the engine raises a row a press, a displacement step a frame, so the button is held for the steps the
// row has left -- up to the garbage on its way landing, less a lead to act in. The next decision sees the board it leaves and decides
// again: another row, or the plan.
var RAISE_LEAD = 10;
function raiseFrames(c) {
  var land = Infinity;
  c.arrivals.forEach(function (a) { if (a.at < land) land = a.at; });
  var f = Math.max(1, (c.board.displacement || 16) - 1);
  return land < Infinity ? Math.max(0, Math.min(f, land - RAISE_LEAD)) : f;
}

// THE CLAIM (survivor_audit.js): what the line Gambit chose said it would make, when the move played is its first swap
function claimOf(info, d) {
  if (!info || !info.found || d.kind !== 'swap' || !info.order || info.order[0] !== keyOf(d)) return null;
  return { play: info.play, chain: info.chain || 0, combo: info.combo || 0, broke: info.broke || 0, done: info.done != null ? info.done : (info.fire || 0), seq: info.seq || null };
}

// ONE LINE A DECISION on stderr, the survivor's log: what Gambit chose, what was played and why, the verdict, the board
function logLine(c, D, L, br, brMs) {
  var g = D.info, F = D.R.F.us, d = L.d;
  console.error('GAMBITD ' + c.m.at + ' ' + (g.name || '') + ' play=' + (g.play || '-') + ' want=' + (g.want || '-') + ' got=' + (d.kind === 'swap' && d.move ? d.move.join(',') : d.kind) +
    ' src=' + (L.gambits ? 'gambit' : 'survival') + ' v=' + L.verdict + ' under=' + (g.under ? 1 : 0) + ' mat=' + F.material + ' chain=' + (g.chain || 0) + ' combo=' + (g.combo || 0) +
    ' broke=' + (g.broke || 0) + ' tier=' + (g.tier || 0) + ' by=' + (g.by || '-') + ' plan=' + (g.pl || '-') + ' done=' + (g.done != null ? g.done : '-') + ' fire=' + (g.fire != null ? g.fire : '-') +
    ' ats=' + (g.ats || '-') + ' swaps=' + (g.swaps || 0) + ' land=' + (F.nextLands != null ? F.nextLands : '-') + ' dies=' + F.dies + ' casc=' + (CK.cascadeLive(c.board, true) ? 1 : 0) +
    ' pop=' + SH.popLeft(c.board) + ' stop=' + F.stop + ' fall=' + (F.falling ? 1 : 0) +
    ' br=' + (br ? (br.depth || 0) + '/' + (br.path ? br.path.length : br.toward ? 't' + br.toward.length : 0) + (br.cut ? '/cut' : '') : 'none') + ' brMs=' + brMs + ' cands=' + (g.cands || '-') + ' live=' + L.live);
}

function answer(c) {
  var bot = c.bot, m = c.m;
  var B = breakSearch(c);
  c.br = B.br; c.brMs = B.ms;
  c.canRaise = function () { return bot._canRaise(); };
  c.left = function () { return c.due ? c.due - Date.now() - 2 * c.margin - 100 : 1e9; };
  var D = DECIDE.decide(c);
  if (!D) return null;
  if (D.carry !== 'keep') bot._gambitCarry = D.carry;
  if (D.R.F.us.contact !== null || D.R.F.us.topped) bot._gambitHit = true;
  var L = lives(c, D), d = L.d;
  // (the rest of a line Gambit chose is pressed by the frame loop; a planned line is carried on by the next decision instead)
  var line = L.gambits && d.kind === 'swap' ? D.lines[keyOf(d)] || null : null;
  keepBreakLine(c, c.br, d);
  // (no swap back: the pair the last swap swapped is kept out for a second when it is swapped three times running)
  var pr = d.kind === 'swap' && c.board.panels[d.move[0]], pa = pr && pr[d.move[1]], pb = pr && pr[d.move[1] + 1];
  var pair = pa && pb && pa.id != null && pb.id != null ? [pa.id, pb.id].sort().join(',') : (d.kind === 'swap' ? null : bot._gambitLastPair);
  bot._gambitPairRuns = pair && pair === bot._gambitLastPair ? (bot._gambitPairRuns || 0) + 1 : 0;
  if (bot._gambitPairRuns >= 2) bot._gambitBlock = { pair: pair, until: m.at + 60 };
  bot._gambitLastPair = pair;
  bot._gambitIdle = d.kind === 'hold' || !D.info.want;
  D.info.verdict = L.verdict;
  logLine(c, D, L, c.br, c.brMs);
  var made = L.cand ? madeOf(L.cand) : { combo: 0, chain: 0, broke: 0 };
  return { id: m.id, epoch: m.epoch, at: m.at, src: L.gambits ? 'gambit' : 'survival', kind: d.kind, move: d.move ? [d.move[0], d.move[1]] : null,
           raiseFrames: d.kind === 'raise' ? raiseFrames(c) : 0, ms: Date.now() - c.t0, idleMs: D.idleMs || 0,
           claim: claimOf(D.info, d), queued: m.posted ? c.t0 - m.posted : 0, brMs: c.brMs,
           line: line, lineAt: null, lineFree: !!line,
           pace: { hold: L.holdLives, brk: !!(c.br && c.br.depth), urgent: !!(bot.allDoomedNow || D.urgent) },
           mem: c.nativeMem(),
           breaks: c.br && c.br.depth ? { offered: c.br.depth, lineup: !!c.br.lineup, touch: !!c.br.touch, took: !!(c.br.moves && d.move && c.br.moves[keyOf(d)]) } : null,
           diag: { budget: bot.SURVIVE_SEARCH_BUDGET, allDoomed: bot.allDoomedNow, walk: L.cand && L.cand.travel != null ? L.cand.travel : null,
                   clears: (made.combo > 0 || made.broke > 0) ? 1 : 0, gambit: D.info } };
}

module.exports = { answer: answer, lives: lives, breakSearch: breakSearch, madeOf: madeOf };
