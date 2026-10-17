// GAMBIT'S TURN (plans/decision.md): a question from the frame loop answered by Gambit alone -- its own searches, its own decision, its
// own judge of which moves live. Nothing of the older bots' search, preferences, guards or overrides.
//
//   breakSearch   the break search's lines, for the proposers
//   decide        read, propose, judge, rank (gambit_decide.js)
//   chosen        the one order's choice, played as it is
//   answer        the move, the raise held, what the log and the audit read
//
// c: { bot (the survival search, puyocpu.js), m (the question), board, arrivals, due (ms clock), t0, attacker, search() (the break
// search's engine), rules, GP (the profile's gambit), pace, margin (ms), nativeMem() }
var path = require('path');
var GAMBIT = require(path.join(__dirname, 'gambit.js')), DECIDE = require(path.join(__dirname, 'gambit_decide.js')), JUDGE = require(path.join(__dirname, 'gambit_judge.js'));
var SH = require(path.join(__dirname, 'survivor_shared.js')), CK = require(path.join(__dirname, 'survivor_checks.js')), KEYS = require(path.join(__dirname, 'survivor_keys.js'));

// THE BREAK SEARCH: the lines to a break, in the share of the decision's time it is given -- carried on from the last decision's
// (bot._brKeep) while it digs toward the same garbage: its best lines, less the swap played since, their rows moved by the stack's rise
// (BREAK_SHARE: of the decision's time; UNDER_SHARE with garbage on the board -- there the break is what saves the board, and the
// searches after it are left the rest: gambit_reach.js found two in three of the boards it came up empty on before a loss had a break)
var BREAK_SHARE = 0.4, UNDER_SHARE = 0.75, BREAK_MIN_MS = 5, BREAK_MAX_MS = 400, LINEUP_AFTER = 30;
// (the garbage the search digs toward: the id of the lowest block on the board)
function digTarget(board) {
  var r = SH.lowestGarbageRow(board), row = r && board.panels[r];
  if (row) for (var k = 1; k <= 6; k++) if (row[k] && row[k].isGarbage) return row[k].garbageId;
  return null;
}
// (the rows the stack has risen since the kept search: by a bottom-row panel it did not move)
function riseSince(board, anchor) {
  for (var r = 1; r < board.panels.length; r++) { var p = board.panels[r] && board.panels[r][anchor.col]; if (p && p.id === anchor.id) return r - anchor.row; }
  return null;
}
// (the swaps played since the kept search: the move decided, then as many of the line handed on as the frame loop says it pressed --
// the question's lineFrom and linePressed)
function playedSince(c, K) {
  if (K.played === 'hold') return [];
  var n = c.m.lineFrom === K.id && K.handed ? Math.min(c.m.linePressed || 0, K.handed.length) : 0;
  return [K.played].concat(K.handed ? K.handed.slice(0, n) : []);
}
function carriedPaths(c) {
  var K = c.bot._brKeep;
  if (!K || !K.paths || !K.anchor || K.played === undefined || digTarget(c.board) !== K.gid) return null;
  var dr = riseSince(c.board, K.anchor);
  if (dr === null) return null;
  var pre = playedSince(c, K);
  return K.paths.filter(function (p) { return p.length > pre.length && pre.every(function (mv, i) { return p[i][0] === mv[0] && p[i][1] === mv[1]; }); })
                .map(function (p) { return p.slice(pre.length).map(function (m) { return [m[0] + dr, m[1]]; }); });
}
// (what the next decision carries on: this beam's lines, on this board, the garbage they dig toward, the move played and the line
// handed on after it, and a bottom-row panel none of them touches)
function keep(c, br, keepOut, d, handed) {
  var bot = c.bot;
  bot._brKeep = null;
  if (!keepOut.paths || !keepOut.paths.length || (br && br.depth) || !(d.kind === 'hold' || d.kind === 'swap')) return;
  var moved = d.kind === 'swap' ? [d.move].concat(handed || []) : [], anchor = null;
  for (var col = 1; col <= 6 && !anchor; col++) {
    var p = c.board.panels[1] && c.board.panels[1][col];
    if (p && p.id != null && !moved.some(function (mv) { return mv[0] === 1 && (mv[1] === col || mv[1] + 1 === col); })) anchor = { row: 1, col: col, id: p.id };
  }
  if (anchor) bot._brKeep = { paths: keepOut.paths, gid: digTarget(c.board), anchor: anchor, id: c.m.id, played: d.kind === 'hold' ? 'hold' : d.move.slice(), handed: handed || null };
}
function breakSearch(c, R) {
  var board = c.board, bot = c.bot, share = R && R.under ? UNDER_SHARE : BREAK_SHARE;
  c.keepOut = {};
  // (no break search on a question due sooner than it could take: the answer would come late)
  if (c.due && c.due - Date.now() < c.margin + BREAK_MIN_MS) return { br: null, ms: 0 };
  bot._natSearch();   // (the engine, on the bot's threads, before a second context is made on it)
  var t = Date.now(), pop = SH.popLeft(board), resume = carriedPaths(c);
  var by = c.due ? Math.min(t + Math.max(BREAK_MIN_MS, (c.due - c.t0) * share), c.due - c.margin) : t + BREAK_MAX_MS;
  var br = SH.breakMoves(c.search(), board, { left: c.m.hold.left, started: c.m.hold.started }, c.arrivals, 1, pop ? pop + LINEUP_AFTER : 0, by,
                         c.stale ? function () { return c.stale() ? c.aborted : null; } : null, null,
                         { touchInPop: true, near: true, ok: c.attacker.allowed, stepOk: c.attacker.stepOk, firstOk: c.attacker.firstOk, resume: resume, keepOut: c.keepOut });
  if (br) { br.cut = Date.now() >= by; br.resumed = resume ? resume.length : 0; }
  return { br: br, ms: Date.now() - t };
}

function keyOf(k) { return k.kind === 'swap' && k.move ? k.move[0] + ',' + k.move[1] : k.kind; }

// THE MOVE: the one order's choice (gambit_decide.js, JUDGE.compare) -- the raise the opening called for, a line's first swap, or the
// hold. Nothing after the order overrides it.
function chosen(D) {
  var d = D.R.up ? { kind: 'raise' } : D.line ? { kind: 'swap', move: D.line.seq[0].slice() } : { kind: 'hold' };
  var top = D.R.up ? null : D.top;
  return { d: d, verdict: D.R.up ? 'raise' : top && top.o ? (top.o.lives ? 'lives' : 'dies') : 'none', holdLives: d.kind === 'hold' && !!(top && top.o && top.o.lives),
           gambits: true, live: D.info.live, why: top ? top.play.replace(/ /g, '_') : d.kind };
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
    ' pop=' + SH.popLeft(c.board) + ' hp=' + (c.board.health || 0) + ' stop=' + F.stop + ' waits=' + (F.breakWaits ? 1 : 0) + ' unseen=' + unseenOf(c.board) + ' tight=' + (c.tight ? 1 : 0) +
    ' br=' + (br ? (br.depth || 0) + '/' + (br.path ? br.path.length : br.toward ? 't' + br.toward.length : 0) + (br.cut ? '/cut' : '') + (br.resumed ? '/r' + br.resumed : '') + (br.carried ? '/carried' : '') : 'none') + ' brMs=' + brMs + ' cands=' + (g.cands || '-') + ' live=' + L.live + ' lost=' + (g.lostAt == null ? '-' : g.lostAt === Infinity ? 'inf' : g.lostAt) + ' wallMs=' + (c.wall0 ? Number(process.hrtime.bigint() - c.wall0) / 1e6 : 0).toFixed(1) + ' why=' + L.why);
}

function answer(c) {
  var bot = c.bot, m = c.m;
  c.wall0 = process.hrtime.bigint();   // (the decision's real time, whatever clock the searches read: GC_FIXED_CLOCK)
  // (the input budget tight: the frame loop walks held from two cells, so every line is judged pressed as it walks -- attacker.judge)
  c.tight = m.allowance != null && m.allowance <= KEYS.HOLDTIGHT;
  c.canRaise = function () { return bot._canRaise(); };
  // (what the searches may take: the decision's time less the answer's margin and a quarter of it kept for judging what they found)
  var span = c.due ? c.due - c.t0 : 0;
  c.left = function () { return c.due ? c.due - Date.now() - c.margin - span / 4 : 1e9; };
  bot._natSearch();   // (the engine, on the bot's threads, before a second context is made on it)
  // (THE DIG: the boards stood on since the garbage the break search digs toward was first the lowest -- a line toward a break never
  // brings one back, PROPOSE.toward)
  var gid = digTarget(c.board);
  if (gid === null) bot._dig = null;
  else { if (!bot._dig || bot._dig.gid !== gid) bot._dig = { gid: gid, seen: new Set() }; bot._dig.seen.add(SH.boardKey(c.board)); }
  c.seenDig = bot._dig ? bot._dig.seen : null;
  // (the rules read first -- the list, the floor -- so the break search finds only breaks the judge will take)
  var R = DECIDE.read(c);
  if (!R) return null;
  var B = breakSearch(c, R);
  c.br = B.br; c.brMs = B.ms;
  var D = DECIDE.decide(c, R);
  if (D.R.F.us.contact !== null || D.R.F.us.topped) bot._gambitHit = true;
  var L = chosen(D), d = L.d;
  // (THE LINE PRESSED ON: a line the judge plays swap after swap -- not settle by settle -- is handed to the frame loop whole, which
  // presses the swaps after the first as the judge pressed them while the next decision is thought about; the next decision sees the
  // board they make and its answer replaces the rest. A line handed on is not carried as well: the frame loop is pressing it)
  var handOn = d.kind === 'swap' && D.line && !D.line.settled && D.line.seq.length > 1 ? D.line.seq.slice(1).map(function (mv) { return mv.slice(); }) : null;
  // (the break search's work carried on to the next decision, past the move and as much of the line handed on as gets pressed)
  keep(c, c.br, c.keepOut || {}, d, handOn);
  if (handOn) bot._gambitCarry = null;
  else if (!(d.kind === 'hold' && D.top && D.top.wait)) bot._gambitCarry = DECIDE.carryOf(c, D.R, D.line);
  // (no swap back: the pair the last swap swapped is kept out for a second when it is swapped three times running)
  var pr = d.kind === 'swap' && c.board.panels[d.move[0]], pa = pr && pr[d.move[1]], pb = pr && pr[d.move[1] + 1];
  var pair = pa && pb && pa.id != null && pb.id != null ? [pa.id, pb.id].sort().join(',') : (d.kind === 'swap' ? null : bot._gambitLastPair);
  bot._gambitPairRuns = pair && pair === bot._gambitLastPair ? (bot._gambitPairRuns || 0) + 1 : 0;
  if (bot._gambitPairRuns >= 2) bot._gambitBlock = { pair: pair, until: m.at + 60 };
  bot._gambitLastPair = pair;
  bot._gambitIdle = d.kind === 'hold' || !D.info.want;
  D.info.verdict = L.verdict; D.info.live = L.live; D.info.why = L.why;
  logLine(c, D, L, c.br, c.brMs);
  // (THE BOARD THE BREAK SEARCH CAME UP EMPTY ON, under garbage, for gambit_reach.js to search again without a time limit: was a break
  // there to find? At most one every 30 frames)
  if (D.R.under && !(c.br && c.br.depth) && (!bot._emptyAt || c.m.at - bot._emptyAt >= 30 || c.m.at < bot._emptyAt)) {
    bot._emptyAt = c.m.at;
    var pk = require('v8').serialize(c.board);   // (the board as Gambit judged it -- its health the plan's -- not as the question carried it)
    console.error('GAMBITB ' + c.m.at + ' ' + require('zlib').gzipSync(Buffer.from(pk)).toString('base64') + ' ' + JSON.stringify((c.arrivals || []).map(function (a) { return [a.at, a.width, a.height]; })));
  }
  var made = L.gambits && d.kind === 'swap' ? { combo: D.info.combo || 0, chain: D.info.chain || 0, broke: D.info.broke || 0 } : { combo: 0, chain: 0, broke: 0 }, held = d.kind === 'raise' ? raiseHeld(c, D.R.to) : { now: 0, after: 0 };
  return { id: m.id, epoch: m.epoch, at: m.at, src: L.gambits ? 'gambit' : 'survival', kind: d.kind, move: d.move ? [d.move[0], d.move[1]] : null,
           raiseFrames: held.now, raiseAfter: held.after, ms: Date.now() - c.t0, idleMs: D.idleMs || 0,
           claim: claimOf(D.info, d), queued: m.posted ? c.t0 - m.posted : 0, brMs: c.brMs,
           line: handOn, lineAt: null, lineFree: !!handOn,
           pace: { hold: L.holdLives, brk: !!(c.br && c.br.depth), urgent: !!D.urgent },
           mem: c.nativeMem(),
           breaks: c.br && c.br.depth ? { offered: c.br.depth, lineup: !!c.br.lineup, touch: !!c.br.touch, took: !!(c.br.moves && d.move && c.br.moves[keyOf(d)]) } : null,
           diag: { walk: null,
                   clears: (made.combo > 0 || made.broke > 0) ? 1 : 0, gambit: D.info } };
}

module.exports = { answer: answer, chosen: chosen, breakSearch: breakSearch, carriedPaths: carriedPaths };
