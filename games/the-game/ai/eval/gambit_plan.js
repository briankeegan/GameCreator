// THE STANDING PLAN (plans/decision.md): lines kept from one decision to the next and grown while the board stands. Each is played out on
// the engine with the garbage the game shows landing when it lands (attacker.judge, diesAfter), and ranked by how long the board then
// lives, then the garbage it breaks, then the fewest swaps; a line outside the list is no plan. Each decision re-anchors the kept lines to
// the board (by a bottom-row panel: the stack may have risen), moves them on past the swap that was played, judges them again with the
// decision's candidates beside them, and grows the best by a swap each -- for as long as its share of the decision's time lasts.
//
// grow(c, R, cands) -> { best: { seq, dies, broke } | null, alone: the frames the board left alone lives, judged: lines judged }
var path = require('path');
var JUDGE = require(path.join(__dirname, 'gambit_judge.js'));

var KEEP = 6;            // lines kept for the next decision
var GROW = 3;            // of them, the best grown by a swap each decision
var SEEDS = 6;           // the decision's candidates, in rank order, judged as plans beside them
var PLAN_SHARE = 0.5, PLAN_MAX_MS = 150;   // the share of the decision's time left, and the most, the plan takes
var BEYOND = 600;        // frames the horizon runs past the last block shown landing

function anchorOf(board) {
  for (var col = 1; col <= 6; col++) { var p = board.panels[1] && board.panels[1][col]; if (p && p.id != null && p.color > 0) return { col: col, id: p.id }; }
  return null;
}
function riseOf(board, anchor) {
  for (var r = 1; r < board.panels.length; r++) { var p = board.panels[r] && board.panels[r][anchor.col]; if (p && p.id === anchor.id) return r - 1; }
  return null;
}
var keyOf = function (seq) { return seq.map(function (mv) { return mv[0] + ',' + mv[1]; }).join(' '); };
function better(a, b) {
  if (a.dies !== b.dies) return a.dies > b.dies ? -1 : 1;
  if (a.broke !== b.broke) return b.broke - a.broke;
  return a.seq.length - b.seq.length;
}

function grow(c, R, cands) {
  var bot = c.bot, t0 = Date.now(), ms = Math.min(PLAN_MAX_MS, Math.max(0, c.left() * PLAN_SHARE));
  var last = 0; (c.arrivals || []).forEach(function (a) { if (a.at > last) last = a.at; });
  var horizon = last + BEYOND, judged = 0, seen = {}, lines = [];
  var judge = function (seq) {
    var k = keyOf(seq);
    if (seen[k] !== undefined) return seen[k];
    var j = c.attacker.judge(c.board, c.m.hold, seq, c.arrivals, { settled: false, tight: c.tight, diesAfter: horizon });
    judged++;
    // (a line the board is lost on is kept, as long as it lasts: when every line loses it, the latest loss is the plan)
    var L = !j || (!j.dead && j.ats.length < seq.length) || !JUDGE.fitsList(R.list, j.made, j) ? null :
            { seq: seq, dies: j.dead ? j.done : j.dies, broke: j.made.broke || 0, ends: j.dead ? [] : j.ends || [] };
    seen[k] = L;
    return L;
  };
  var aloneJ = c.attacker.judge(c.board, c.m.hold, [], c.arrivals, { tight: c.tight, diesAfter: horizon }), alone = aloneJ.dead ? 0 : aloneJ.dies;
  // (the kept lines, on this board: moved by the rise, and on past the swap played since)
  var P = bot._gambitPlan, played = bot._gambitPlayed;
  if (P && P.anchor) {
    var dr = riseOf(c.board, P.anchor);
    if (dr !== null) P.lines.forEach(function (seq) {
      if (played && seq.length && seq[0][0] === played[0] && seq[0][1] === played[1]) seq = seq.slice(1);
      if (seq.length) lines.push(seq.map(function (mv) { return [mv[0] + dr - P.rise, mv[1]]; }));
    });
  }
  (cands || []).slice(0, SEEDS).forEach(function (k) { if (!k.wait) lines.push(k.seq.map(function (mv) { return mv.slice(); })); });
  // (and every swap the board allows now, while half the time is left: a plan can begin anywhere)
  c.board.legalSwaps().forEach(function (mv) { lines.push([mv]); });
  var live = [];
  lines.forEach(function (seq, i) { if (Date.now() - t0 < (seq.length > 1 || i < SEEDS ? ms : ms / 2)) { var L = judge(seq); if (L) live.push(L); } });
  live.sort(better);
  // (the best grown by a swap each, while the time lasts)
  live.slice(0, GROW).forEach(function (L) {
    for (var i = 0; i < L.ends.length && Date.now() - t0 < ms; i++) { var G = judge(L.seq.concat([L.ends[i]])); if (G) live.push(G); }
  });
  var uniq = {}, kept = [];
  live.sort(better).forEach(function (L) { var k = keyOf(L.seq); if (!uniq[k] && kept.length < KEEP) { uniq[k] = true; kept.push(L); } });
  var anchor = anchorOf(c.board);
  bot._gambitPlan = anchor ? { anchor: anchor, rise: riseOf(c.board, anchor), lines: kept.map(function (L) { return L.seq; }) } : null;
  return { best: kept[0] || null, alone: alone, judged: judged };
}

// The frames the board lives after a line, judged as the plan judges its own (null when it is no plan: outside the list, not played out)
function diesOf(c, R, seq) {
  var last = 0; (c.arrivals || []).forEach(function (a) { if (a.at > last) last = a.at; });
  var j = c.attacker.judge(c.board, c.m.hold, seq, c.arrivals, { settled: false, tight: c.tight, diesAfter: last + BEYOND });
  if (!j || (!j.dead && j.ats.length < seq.length) || !JUDGE.fitsList(R.list, j.made, j)) return null;
  return j.dead ? j.done : j.dies;
}

module.exports = { grow: grow, better: better, diesOf: diesOf };
