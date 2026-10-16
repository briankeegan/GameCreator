// THE STANDING PLAN (gambit_plan.js): kept from one decision to the next and grown while the board stands -- on a real board with garbage
// on its way, the best line lives at least as long as holding, the lines grow over decisions, and a kept line is found again on the board
// after its first swap is pressed and the stack has risen, moved on past that swap. Run: node gambit_plan.test.js
var assert = require('assert'), path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), GAMBIT = require('./gambit.js'), PLAN = require('./gambit_plan.js');
var at = require('./survivor_attack.js')({ reaction: 12, swapGap: 12, cursorMoveFrames: 4 }), hold = { left: 0, started: false };
var list = [{ combo: '>=5' }, { chain: '>=2' }, { combo: '<=3', chain: '==1' }];
var checked = 0, grew = 0, found = 0;
for (var seed = 1; seed <= 8; seed++) {
  var b = PA.game({ level: 10, seed: seed, countdown: false });
  for (var f = 0; f < 300; f++) b.run();
  var arr = [{ at: 120, width: 6, height: 2 }, { at: 200, width: 6, height: 2 }];
  var bot = {}, c = { bot: bot, board: b, m: { hold: hold }, arrivals: arr, attacker: at, tight: false, left: function () { return 400; } };
  var R = { list: list };
  var P1 = PLAN.grow(c, R, []);
  if (!P1.best) continue;
  checked++;
  assert.ok(P1.best.dies >= P1.alone, 'seed ' + seed + ': the best line lives at least as long as holding (' + P1.best.dies + ' against ' + P1.alone + ')');
  var len1 = P1.best.seq.length, P2 = PLAN.grow(c, R, []);
  if (P2.best && P2.best.seq.length > len1) grew++;
  // (its first swap pressed and the board run on: the rest of a kept line is among the lines judged again)
  var kept = bot._gambitPlan.lines.filter(function (s) { return s.length > 1; })[0];
  if (!kept) continue;
  var nb = b.copy(), mv = kept[0];
  nb.curRow = mv[0]; nb.curCol = mv[1];
  if (!nb.tryQueueSwap(mv[0], mv[1])) continue;
  for (f = 0; f < 60; f++) nb.run();
  var rise = null, a = bot._gambitPlan.anchor;
  for (var r = 1; r < nb.panels.length && rise === null; r++) { var p = nb.panels[r] && nb.panels[r][a.col]; if (p && p.id === a.id) rise = r - 1; }
  if (rise === null) continue;
  var want = kept.slice(1).map(function (m) { return [m[0] + rise, m[1]]; }), seenRest = false;
  var c2 = Object.assign({}, c, { board: nb, attacker: { judge: function (bd, h, seq, ar, o) { if (JSON.stringify(seq) === JSON.stringify(want)) seenRest = true; return at.judge(bd, h, seq, ar, o); } } });
  bot._gambitPlayed = mv;
  PLAN.grow(c2, R, []);
  assert.ok(seenRest, 'seed ' + seed + ': the rest of the kept line, moved by the rise of ' + rise + ', is judged again');
  found++;
}
assert.ok(checked >= 4 && found >= 2, 'boards planned on: ' + checked + ', kept lines found again: ' + found);
console.log('ok: standing plan -- ' + checked + ' boards, ' + grew + ' grown over a decision, ' + found + ' kept lines found again after a swap and a rise');
