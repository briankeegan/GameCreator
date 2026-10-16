// GAMBIT'S PROPOSERS (plans/decision.md, step 2): each kind of move the bot can make, one function each. A proposer runs its search and
// offers lines; it decides nothing. A candidate: { play, seq (the swaps), x (what the search says the line makes and when: combo, chain,
// broke, cells, done, fire, ats, earned, floor, near), aim (the list entry the search found it for, -1 for none), extend }.
//
// The searches are run once, by search(); the proposers read what they found.
var path = require('path');
var GAMBIT = require(path.join(__dirname, 'gambit.js')), SH = require(path.join(__dirname, 'survivor_shared.js'));
var CK = require(path.join(__dirname, 'survivor_checks.js'));

function cand(play, seq, x, aim, extend) { return seq && seq.length && seq[0] ? { play: play, seq: seq, x: x || {}, aim: aim, extend: !!extend } : null; }

// THE SEARCHES, run once a decision: the planner (a line for every entry of the list, in time), the extension of a chain already falling
// or a slab popping, readiness for the next block, and levelling. R: what read() found. { ap, ex, rd, lvU, lvG, tried, idleMs }
function search(c, R) {
  var GP = c.GP, A = c.attacker, board = c.board, hold = c.m.hold, arrivals = c.arrivals, out = { ap: null, ex: null, rd: null, lvU: null, lvG: null, tried: 0, idleMs: 0 };
  if (!R.preds.length) return out;
  var xMs = R.pop ? (GP.ms || 80) : (GP.extendMs || 40);
  // (a slab popping is lined up as the list is written -- the pop is the break; with garbage left, the entries that break again first)
  var xAims = !R.pop ? R.aims : R.under ? R.aims.concat(R.listAims, [{ break: true }]) : R.listAims;
  if ((CK.cascadeLive(board, true) || R.pop) && GP.extend !== false && Math.min(xMs, c.left()) >= 20) {
    out.tried++;
    out.ex = A.extend(board, hold, { ms: Math.min(xMs, c.left()), width: GP.width || 40, depth: GP.extendDepth || 6, keep: R.keepF, by: R.by || undefined,
                                     aims: xAims.map(function (a) { return function (made) { return GAMBIT.meets(a, made); }; }), near: function (made) { return GAMBIT.nearList(xAims, made); } });
    out.ex.xAims = xAims;
  }
  // (idle time is planning time: after a decision that held or had nothing to play, the planner has all the time the decision has)
  var usual = Math.min(GP.ms || 80, c.left()) - (R.pop && out.ex ? out.ex.ms : 0);
  var ms = c.bot._gambitIdle ? Math.max(usual, c.left()) : usual, extra = ms - Math.max(0, usual);
  if (ms >= 20) {
    out.tried++;
    out.ap = A.plan(board, hold, { ms: ms, width: GP.width || 40, depth: GP.depth || 7, pool: GP.pool || 250, minChain: 0, arrivals: arrivals,
                                   aims: R.preds, by: R.by || undefined, keep: R.keepF, readyAt: R.readyAt, near: function (made) { return GAMBIT.lead(R.aims, made, R.under); },
                                   dies: R.F.us.dies > 0 ? R.F.us.dies : undefined, breakAtSwap: !!R.under });
    if (extra > 0) out.idleMs = Math.max(0, Math.min(extra, out.ap.ms - Math.max(0, usual)));
  }
  out.lvU = R.under ? A.level(board, hold, arrivals, { by: R.F.us.nextLands > 0 ? R.F.us.nextLands : (R.by || undefined) }) : null;
  out.rd = !R.under && R.readyAt !== null && arrivals.length ? A.readyFor(board, hold, arrivals, { ms: Math.max(20, Math.min(60, c.left())) }) : null;
  out.lvG = !R.under && R.readyAt !== null && !(out.rd && !out.rd.ready && out.rd.setup) ? A.level(board, hold, arrivals, { by: R.readyAt || undefined }) : null;
  return out;
}

// AN ENTRY: the planner's line for each entry of the list it found one for
function entries(S) { return S.ap && S.ap.perAim ? S.ap.perAim.map(function (pa, i) { return pa ? cand('entry', pa.seq, pa, i) : null; }) : []; }
// THE EXTENSION: links that keep a chain already falling going (or a popping slab lined up), and the nearest of them to the list
function extension(S, R) {
  var ex = S.ex, out = [];
  if (!ex) return out;
  if (ex.seq.length && ex.aimIndex >= 0) {
    // (under a pop with garbage left, the extension's aims are the entries that break, the entries as written, then any break again)
    var n = R.aims.length, xi = ex.aimIndex, xa = !(R.pop && R.under) ? xi : xi < n ? xi : xi < 2 * n ? xi - n : -1;
    out.push(cand(R.pop ? 'lineup' : 'extend', ex.seq, Object.assign({ broke: ex.broke }, ex), xa, true));
  }
  if (ex.nearest) out.push(cand(R.pop ? 'lineup' : 'extend', ex.nearest.seq, ex.nearest, -1, true));
  return out;
}
// THE NEAREST: the planner's line nearest the list when it found none for an entry
function nearest(S) { var np = S.ap && S.ap.nearest; return np && np.seq.length ? [cand('nearest', np.seq, np, -1)] : []; }
// THE BREAK LINE: the planner's line in time that breaks the most garbage
function breakLine(S) { return S.ap && S.ap.quick ? [cand('break line', S.ap.quick.seq, S.ap.quick, -1)] : []; }
// THE BREAK SEARCH'S BREAKS: its line to a break, and every first swap it found breaks (a row each: it counts rows, the planner cells)
function breaks(c) {
  var br = c.br, out = [];
  if (!br || !br.depth) return out;
  var play = br.lineup ? 'lineup break' : 'break search', x = function () { return { broke: 6, done: br.at || null, fire: br.at || null }; };
  if (br.path && br.path.length) out.push(cand(play, br.path, x(), -1));
  // (a line-up is the whole line: two swaps in the pop, or one now and one once the pop is over -- 'ready', judged settle by settle. A
  // search that found a line (path) names its first swap in moves: the line is the break, its first swap alone is not offered as one)
  if (!(br.path && br.path.length)) Object.keys(br.moves || {}).forEach(function (k) {
    var k1 = cand(play, br.lines && br.lines[k] ? br.lines[k] : [k.split(',').map(Number)], x(), -1);
    if (k1 && br.lineup === 'ready' && br.lines && br.lines[k]) k1.settled = true;
    out.push(k1);
  });
  return out;
}
// TOWARD A BREAK: under garbage with none in reach, the break search's line nearest one
function toward(c, R) { return R.under && c.br && c.br.toward && c.br.toward.length ? [cand('toward', c.br.toward, {}, -1)] : []; }
// READY: the swap that leaves the next block breakable when it lands
function ready(S) { return S.rd && !S.rd.ready && S.rd.setup ? [cand('ready', [S.rd.setup], {}, -1)] : []; }
// LEVEL: the swap that flattens the stack, under garbage or before a block lands
function level(S) { return [S.lvU, S.lvG].filter(Boolean).map(function (lv) { return cand('level', [lv.move], {}, -1); }); }
// SET UP: the planner's swap toward the ask, with no block on its way
function setup(S, R) { return S.ap && S.ap.setup && typeof R.readyAt !== 'number' ? [cand('setup', [S.ap.setup], {}, -1)] : []; }
// CLEAR: the line that leaves the lowest stack (a match that touches no garbage: only for a stack about to top out)
function clear(S) { return S.ap && S.ap.lowest ? [cand('clear', S.ap.lowest.seq, S.ap.lowest, -1)] : []; }
// CARRIED ON: the rest of the line in progress, found again on this board by its bottom-row panel (the stack may have risen) and played
// on as it is pressed -- a planned line once the board has settled from the last step, any other at once -- while every step is legal and
// it still makes what it was begun for (its entry, a break). { cand, wait } -- wait: its next step must wait for the board to settle
function carried(c, R) {
  var C = c.bot._gambitCarry, board = c.board;
  if (!C || !C.rest.length || !C.anchor) return null;
  var dr = null;
  for (var r = 1; r < board.panels.length && dr === null; r++) { var p = board.panels[r] && board.panels[r][C.anchor.col]; if (p && p.id === C.anchor.id) dr = r - C.anchor.row; }
  if (dr === null) return null;
  var rest = C.rest.map(function (mv) { return [mv[0] + dr, mv[1]]; }), x, wait = false;
  if (C.settled) {
    x = c.attacker.replay(board, c.m.hold, rest, c.arrivals, { settleFirst: true, tight: c.tight });
    if (!x) return null;
    wait = x.wait > 1;
  } else {
    var j = c.attacker.judge(board, c.m.hold, rest, c.arrivals, { settled: false, tight: c.tight });
    if (!j || j.dead || j.ats.length < rest.length) return null;   // (a step no longer legal: the judge pressed fewer than the line has)
    x = { combo: j.made.combo, chain: j.made.chain, broke: j.made.broke, done: j.done, fire: j.fire, ats: j.ats };
  }
  if ((C.broke && !(x.broke > 0)) || (C.aim && !GAMBIT.meets(C.aim, x))) return null;
  var aim = -1;
  if (C.aim) R.aims.forEach(function (a, i) { if (aim < 0 && JSON.stringify(a) === JSON.stringify(C.aim)) aim = i; });
  var k = cand(wait ? 'carry wait' : 'carry', rest, x, aim);
  if (k) k.settled = !!C.settled;
  return { cand: k, wait: wait };
}

// Every candidate, in the order they are offered
function all(c, R, S) {
  return [].concat(entries(S), extension(S, R), nearest(S), breakLine(S), breaks(c), toward(c, R), ready(S), level(S), setup(S, R), clear(S)).filter(Boolean);
}

module.exports = { search: search, all: all, carried: carried,
                   entries: entries, extension: extension, nearest: nearest, breakLine: breakLine, breaks: breaks, toward: toward,
                   ready: ready, level: level, setup: setup, clear: clear };
