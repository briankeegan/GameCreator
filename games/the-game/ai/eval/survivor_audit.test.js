// THE CLAIM AUDIT (survivor_audit.js): a line that makes what it claimed is right, one that claims more than the game made is over, one
// replaced before it has settled is cut and not scored, one carried on keeps the claim it was begun with. Run: node survivor_audit.test.js
var assert = require('assert'), AUDIT = require('./survivor_audit.js');
// a board as the game shows it: `matched` lists [row, col, id, garbage] of the panels in the matched state; chain the chain counter
function truth(clock, matched, chain) {
  var panels = [null];
  for (var r = 1; r <= 12; r++) { var row = [null]; for (var c = 1; c <= 6; c++) row.push({ id: 1000 + r * 10 + c, state: 'normal', color: 1, isGarbage: false }); panels.push(row); }
  (matched || []).forEach(function (m) { panels[m[0]][m[1]] = { id: m[2], state: 'matched', color: m[3] ? 9 : 2, isGarbage: !!m[3] }; });
  return { clock: clock, panels: panels, chainCounter: chain || 0 };
}
function run(a, from, to, events) { for (var f = from; f <= to; f++) a.frame(events[f] || truth(f)); }

// an honest line: a chain of 2 that breaks, made as claimed
var stats = {}, a = new AUDIT.Audit(stats);
a.claim({ play: 'entry', chain: 2, combo: 0, broke: 6, done: 40 }, 100);
var ev = {}; ev[105] = truth(105, [[2, 1, 1], [2, 2, 2], [2, 3, 3], [3, 1, 50, true], [3, 2, 51, true]], 1); ev[130] = truth(130, [[4, 1, 4], [4, 2, 5], [4, 3, 6]], 2);
run(a, 100, 175, ev);
assert.deepStrictEqual(stats.audit.entry, { n: 1, cut: 0, chain: [1, 0, 0], combo: [1, 0, 0], broke: [1, 0, 0] }, 'made as claimed: right');

// an over-claim: a chain of 3, a combo of 5 and a break claimed, nothing made
a.claim({ play: 'nearest', chain: 3, combo: 5, broke: 6, done: 20 }, 200);
run(a, 200, 300, {});
assert.deepStrictEqual(stats.audit.nearest, { n: 1, cut: 0, chain: [0, 1, 0], combo: [0, 1, 0], broke: [0, 1, 0] }, 'claimed more than made: over');

// under: a plain break claimed, a combo of 4 that breaks made
a.claim({ play: 'break search', chain: 0, combo: 0, broke: 0, done: 10 }, 400);
ev = {}; ev[405] = truth(405, [[2, 1, 11], [2, 2, 12], [2, 3, 13], [2, 4, 14], [3, 1, 60, true]], 1);
run(a, 400, 480, ev);
assert.deepStrictEqual(stats.audit['break search'], { n: 1, cut: 0, chain: [1, 0, 0], combo: [0, 0, 1], broke: [0, 0, 1] }, 'made more than claimed: under');

// cut: a line replaced before it settles is counted, not scored; carried on, a line keeps its claim
a.claim({ play: 'toward', chain: 2, broke: 6, done: 200 }, 500);
run(a, 500, 510, {});
a.claim({ play: 'setup', done: 10 }, 511);
assert.deepStrictEqual(stats.audit.toward, { n: 1, cut: 1, chain: [0, 0, 0], combo: [0, 0, 0], broke: [0, 0, 0] }, 'replaced before it settled: cut');
a.claim({ play: 'carry', chain: 9 }, 515);
run(a, 511, 600, {});
assert.strictEqual(stats.audit.setup.n, 1, 'carried on: the setup kept its claim'); assert.ok(!stats.audit.carry, 'no claim of its own');
console.log('ok: claim audit -- right, over, under, cut, carried');
