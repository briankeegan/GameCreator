// EVERY STEP ITS OWN TIME (survivor_attack.js plan, extend): a line is in time when its LAST SWAP is begun by the deadline
// (plans/gambit.md step 2) -- the chain it sets off runs on after. A chain line whose last swap is in time and whose cascade
// settles past the deadline is kept; every line kept has its last swap by the deadline, and one time per swap. Run: node attack_fire.test.js
var assert = require('assert'), path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
var ATTACK = require('./survivor_attack.js');
var at = ATTACK({ reaction: 6, swapGap: 2, cursorMoveFrames: 4 });
var chain2 = function (made) { return made.chain >= 2; };
var found = 0, late = 0;
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
}
assert.ok(found >= 3, 'chain lines found on real boards: ' + found);
assert.ok(late >= 1, 'a line whose cascade settles past the deadline was kept');
console.log('ok: every step its own time -- ' + found + ' boards, ' + late + ' kept with the cascade settling past the deadline');
