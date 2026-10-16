// EVERY STEP ITS OWN TIME (survivor_attack.js plan, extend): a line is in time when its LAST SWAP is begun by the deadline
// (plans/gambit.md step 2) -- the chain it sets off runs on after. A chain line whose last swap is in time and whose cascade
// settles past the deadline is kept; every line kept has its last swap by the deadline, and one time per swap. Run: node attack_fire.test.js
var assert = require('assert'), path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
var ATTACK = require('./survivor_attack.js'), SH = require('./survivor_shared.js');
var at = ATTACK({ reaction: 6, swapGap: 2, cursorMoveFrames: 4 });
var chain2 = function (made) { return made.chain >= 2; };
var found = 0, late = 0, carried = 0, carriedSame = 0;
for (var seed = 1; seed <= 40 && found < 3; seed++) {
  var b = PA.game({ level: 10, seed: seed, countdown: false });
  for (var f = 0; f < 200; f++) b.run();
  var free = at.plan(b, { left: 0, started: false }, { ms: 400, width: 30, depth: 4, pool: 120, aims: [chain2] }), pa = free.perAim[0];
  if (!pa) continue;
  found++;
  assert.ok(pa.ats && pa.ats.length === pa.seq.length, 'a time for every swap of the line');
  assert.strictEqual(pa.fire, pa.ats[pa.ats.length - 1], 'fire is the last swap');
  for (var k = 1; k < pa.ats.length; k++) assert.ok(pa.ats[k] >= pa.ats[k - 1], 'the swaps in order');
  assert.ok(pa.done > pa.fire, 'the cascade settles after its last swap');
  // a deadline between the last swap and the settle: a chain line is still found, its last swap by the deadline
  var by = Math.floor((pa.fire + pa.done) / 2);
  var held = at.plan(b, { left: 0, started: false }, { ms: 400, width: 30, depth: 4, pool: 120, aims: [chain2], by: by }).perAim[0];
  assert.ok(held, 'seed ' + seed + ': a chain fired by ' + by + ' (settling at ' + pa.done + ') is in time');
  assert.ok(held.fire <= by, 'its last swap is by the deadline');
  if (held.done > by) late++;
  // (a line played on: the planner's line, replayed step by step from the same board, makes what the planner said it makes)
  var rp = at.replay(b, { left: 0, started: false }, pa.seq, []);
  assert.ok(rp && rp.chain === pa.chain && rp.combo === pa.combo, 'seed ' + seed + ': the line replayed makes chain ' + pa.chain + ' combo ' + pa.combo + ', got ' + JSON.stringify(rp));
  assert.deepStrictEqual(rp.ats, pa.ats, 'each step at the same frame');
  // (the rest of a line, carried on: its first step pressed, the board still settling -- the rest waits for the settle, each step at its
  // own time, and makes what the line makes)
  if (pa.seq.length > 1) {
    var b1 = b.copy(); b1.curRow = pa.seq[0][0]; b1.curCol = pa.seq[0][1];
    if (b1.tryQueueSwap(pa.seq[0][0], pa.seq[0][1])) {
      for (var w = 0; w < 4; w++) { b1.setInput(0); b1.run(); }
      var rest = at.replay(b1, { left: 0, started: false }, pa.seq.slice(1), [], { settleFirst: true });
      assert.ok(rest && rest.wait > 0, 'seed ' + seed + ': the rest waits for the board to settle');
      carried++; if (rest.chain === pa.chain) carriedSame++;
    }
  }
}
assert.ok(found >= 3, 'chain lines found on real boards: ' + found);
assert.ok(late >= 1, 'a line whose cascade settles past the deadline was kept');
assert.ok(carried === 0 || carriedSame >= 1, 'a line carried on makes its chain: ' + carriedSame + ' of ' + carried);
// READY UNDER GARBAGE: a board with garbage on it and another block on its way is asked whether a break is ready when that block lands
var rb = PA.game({ level: 10, seed: 3, countdown: false }), rf, RH = { left: 0, started: false };
for (rf = 0; rf < 150; rf++) rb.run();
rb.incoming = [{ width: 6, height: 2 }];
for (rf = 0; rf < 260 && !SH.lowestGarbageRow(rb); rf++) rb.run();
assert.ok(SH.lowestGarbageRow(rb), 'garbage on the board');
var rr = at.readyFor(rb, RH, [{ at: 120, width: 6, height: 1 }], { ms: 200 });
assert.ok(rr && (rr.ready === true || rr.ready === false) && rr.at === 120, 'ready is judged for the block on its way, garbage on the board or not');
console.log('carried on: ' + carriedSame + ' of ' + carried + ' make the chain they were planned to');
// A LINE THAT IS TO CLEAR NOTHING, played to the board's settle: its first step that clears panels and breaks nothing -- a clear made by
// a panel falling into a match too
var H = { left: 0, started: false };
var three = PA.puzzle(['000000', '000000', '000000', '000000', '112100', '345612'].join(''));
assert.strictEqual(at.firstClear(three, H, [[2, 3]]), 0, 'a swap that makes a three clears');
assert.strictEqual(at.firstClear(three, H, [[1, 1], [2, 3]]), 1, 'the second step clears');
assert.strictEqual(at.firstClear(three, H, [[1, 1]]), -1, 'a swap that makes nothing does not');
var fall = PA.puzzle(['000000', '000000', '000000', '000200', '220000', '345612'].join(''));
assert.strictEqual(at.firstClear(fall, H, [[3, 3]]), 0, 'a panel swapped over a hole falls into a three: a clear');
console.log('ok: every step its own time -- ' + found + ' boards, ' + late + ' kept with the cascade settling past the deadline');
