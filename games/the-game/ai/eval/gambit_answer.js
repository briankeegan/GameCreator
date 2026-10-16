// GAMBIT'S TURN (plans/decision.md): a question from the frame loop answered by Gambit alone -- its own searches, its own decision, and
// the survival search asked one thing only: which moves live. Nothing of the older bots' preferences, guards or overrides.
//
//   breakSearch   the break search's lines, for the proposers
//   decide        read, propose, judge, rank (gambit_decide.js)
//   lives         the survival search, asked of every move: of those that live, Gambit's in its order, then any that fits the list,
//                 then any other -- never one past GAMBIT.MAXCHAIN; with none that lives, the one that dies latest
//   answer        the move, the raise held, what the log and the audit read
//
// c: { bot (the survival search, puyocpu.js), m (the question), board, arrivals, due (ms clock), t0, attacker, search() (the break
// search's engine), rules, GP (the profile's gambit), pace, margin (ms), nativeMem() }
var path = require('path');
var GAMBIT = require(path.join(__dirname, 'gambit.js')), DECIDE = require(path.join(__dirname, 'gambit_decide.js'));
var SH = require(path.join(__dirname, 'survivor_shared.js')), CK = require(path.join(__dirname, 'survivor_checks.js'));

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
                         c.stale ? function () { return c.stale() ? c.aborted : null; } : null, null, { touchInPop: true });
  if (br) br.cut = Date.now() >= by;
  return { br: br, ms: Date.now() - t };
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
  // (none of Gambit's moves lives -- the survival exception: every move found live is judged as Gambit judges its own (attacker.judge:
  // every link it adds to a chain already falling counted), and the first that fits the list is played -- a three that breaks garbage
  // fits; only with none, the survival search's pick, never past MAXCHAIN)
  if (V && order.indexOf(keyOf(d)) < 0 && d.kind === 'swap') {
    var madeBy = function (mv) { var j = c.attacker.judge(c.board, c.m.hold, [mv], c.arrivals, {}); return j.dead ? null : j.made; };
    var fitting = null, own = madeBy(d.move);
    if (!(own && GAMBIT.fits(list, own))) {
      for (var q = 0; q < V.cands.length && !fitting; q++) {
        var vc = V.cands[q];
        if (vc.kind !== 'swap' || !vc.move || (V.verdict[q] !== 'proven' && V.verdict[q] !== 'weak')) continue;
        var mk = madeBy(vc.move);
        if (mk && GAMBIT.fits(list, mk)) fitting = vc;
      }
      if (fitting) { d = { kind: 'swap', move: [fitting.move[0], fitting.move[1]] }; verdict = V.verdict[V.cands.indexOf(fitting)]; }
      else if (own && own.chain > GAMBIT.MAXCHAIN) d = { kind: 'hold' };
    }
  }
  var cand = (bot._allCands || []).filter(function (k) { return keyOf(k) === keyOf(d); })[0] || null;
  // (live: of Gambit's moves, how many the survival search searched and how many it found live)
  return { d: d, verdict: verdict, holdLives: holdLives, gambits: order.indexOf(keyOf(d)) >= 0, cand: cand, live: live + '/' + searched + '/' + order.length };
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
  return { play: info.play, chain: info.chain || 0, combo: info.combo || 0, broke: info.broke || 0, done: info.done != null ? info.done : (info.fire || 0), seq: info.seq || null };
}

// ONE LINE A DECISION on stderr, the survivor's log: what Gambit chose, what was played and why, the verdict, the board
function logLine(c, D, L, br, brMs) {
  var g = D.info, F = D.R.F.us, d = L.d;
  console.error('GAMBITD ' + c.m.at + ' ' + (g.name || '') + ' play=' + (g.play || '-') + ' want=' + (g.want || '-') + ' got=' + (d.kind === 'swap' && d.move ? d.move.join(',') : d.kind) +
    ' src=' + (L.gambits ? 'gambit' : 'survival') + ' v=' + L.verdict + ' under=' + (g.under ? 1 : 0) + ' mat=' + F.material + ' chain=' + (g.chain || 0) + ' combo=' + (g.combo || 0) +
    ' broke=' + (g.broke || 0) + ' tier=' + (g.tier || 0) + ' by=' + (g.by || '-') + ' plan=' + (g.pl || '-') + ' done=' + (g.done != null ? g.done : '-') + ' fire=' + (g.fire != null ? g.fire : '-') +
    ' ats=' + (g.ats || '-') + ' swaps=' + (g.swaps || 0) + ' land=' + (F.nextLands != null ? F.nextLands : '-') + ' dies=' + F.dies + ' casc=' + (CK.cascadeLive(c.board, true) ? 1 : 0) +
    ' pop=' + SH.popLeft(c.board) + ' stop=' + F.stop + ' waits=' + (F.breakWaits ? 1 : 0) +
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
  D.info.verdict = L.verdict;
  logLine(c, D, L, c.br, c.brMs);
  var made = L.cand ? madeOf(L.cand) : { combo: 0, chain: 0, broke: 0 }, held = d.kind === 'raise' ? raiseHeld(c, D.R.to) : { now: 0, after: 0 };
  return { id: m.id, epoch: m.epoch, at: m.at, src: L.gambits ? 'gambit' : 'survival', kind: d.kind, move: d.move ? [d.move[0], d.move[1]] : null,
           raiseFrames: held.now, raiseAfter: held.after, ms: Date.now() - c.t0, idleMs: D.idleMs || 0,
           claim: claimOf(D.info, d), queued: m.posted ? c.t0 - m.posted : 0, brMs: c.brMs,
           // (every swap is its own decision, judged on the board as it is when it is pressed: the frame loop is handed no line to press
           // on its own clock -- the rest of a line is carried on by the next decisions, as the line in progress)
           line: null, lineAt: null, lineFree: false,
           pace: { hold: L.holdLives, brk: !!(c.br && c.br.depth), urgent: !!(bot.allDoomedNow || D.urgent) },
           mem: c.nativeMem(),
           breaks: c.br && c.br.depth ? { offered: c.br.depth, lineup: !!c.br.lineup, touch: !!c.br.touch, took: !!(c.br.moves && d.move && c.br.moves[keyOf(d)]) } : null,
           diag: { budget: bot.SURVIVE_SEARCH_BUDGET, allDoomed: bot.allDoomedNow, walk: L.cand && L.cand.travel != null ? L.cand.travel : null,
                   clears: (made.combo > 0 || made.broke > 0) ? 1 : 0, gambit: D.info } };
}

module.exports = { answer: answer, lives: lives, breakSearch: breakSearch, madeOf: madeOf };
