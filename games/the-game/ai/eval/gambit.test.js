#!/usr/bin/env node
// GAMBIT'S RULE TABLE (gambit.js): the tests on facts, the rule chosen, the aims met, the facts read off a board, and the rules
// file read again when it changes -- per opponent, and the last good rules kept when it breaks.
//
//   node gambit.test.js
var assert = require('assert'), path = require('path'), fs = require('fs');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), G = require('./gambit.js');

// tests on a fact
assert(G.test(9, '>=9') && !G.test(8, '>=9') && G.test(3, '<4') && G.test(0, '==0') && G.test(1, '!=0'));
assert(G.test(true, true) && !G.test(false, true), 'a plain value is tested for equality');
assert(!G.test(undefined, '>=0') && !G.test(null, true), 'a fact the host does not send is never true');

// the tables: defend first (led by our board), then attack (led by the enemy's)
var tables = G.checked({
  defend: [{ name: 'dig', when: { 'us.heavy': true, 'us.contact': '>=1' }, aim: { break: true, any: [{ combo: '>=4' }, { chain: '>=2' }] } }],
  attack: [
    { name: 'finish', when: { 'enemy.topped': true }, aim: { combo: '>=4' } },
    { name: 'pressure', when: { 'enemy.height': '>=9', 'us.material': '>=12' }, aim: { chain: '>=2' } },
    { name: 'mine', when: { 'us.material': '>=24' }, aim: { chain: '>=3' } },
    { name: 'rest', when: {}, aim: { chain: '>=2' } }
  ]
});
assert.strictEqual(tables.tables.attack.length, 3, 'an attack rule that tests only our board is dropped');
assert(/mine.*tests only us\.material/.test(tables.errors.join(' ')), 'and the reason kept: ' + tables.errors);
var T = tables.tables, rules = T.attack.concat(T.defend);
assert.strictEqual(G.choose(T, { us: { heavy: true, contact: 2 }, enemy: { topped: true } }).rule.name, 'dig', 'defend comes first');
assert.strictEqual(G.choose(T, { us: { heavy: false }, enemy: { topped: true } }).rule.name, 'finish');
assert.strictEqual(G.choose(T, { us: { material: 20 }, enemy: { height: 10 } }).rule.name, 'pressure', 'an attack rule led by the enemy may add our board');
assert.strictEqual(G.choose(T, { us: { material: 5 }, enemy: { height: 10 } }).rule.name, 'rest');
assert.strictEqual(G.choose(T, { us: { heavy: true, contact: null }, enemy: {} }).table, 'attack', 'contact with no garbage is no contact');

// aims against what a line makes
var dig = T.defend[0].aim;
assert(G.meets(dig, { combo: 4, chain: 1, broke: 6, cells: 3 }), 'a combo of 4 that breaks meets the dig');
assert(G.meets(dig, { combo: 3, chain: 2, broke: 6, cells: 6 }), 'a chain of 2 that breaks meets it');
assert(!G.meets(dig, { combo: 3, chain: 1, broke: 6, cells: 0 }), 'a plain three does not');
assert(!G.meets(dig, { combo: 5, chain: 1, broke: 0, cells: 4 }), 'a combo that breaks nothing does not');
assert(G.meets({ combo: '>=5', chain: '>=3' }, { combo: 5, chain: 3, broke: 0 }) && !G.meets({ combo: '>=5', chain: '>=3' }, { combo: 5, chain: 2 }), 'both asked: both must hold');
assert(!G.meets({ break: false, combo: '>=4' }, { combo: 4, chain: 1, broke: 6 }), 'break false: a line that breaks is not the aim');

// a priority list: aims as written, or aim then else; "default" / "hold" end it
assert.deepStrictEqual(G.aimsOf({ aims: [{ chain: '>=4' }, { combo: '>=8' }, 'default'] }).length, 3);
assert.deepStrictEqual(G.aimsOf({ aim: { combo: '>=4' }, else: 'hold' }), [{ combo: '>=4' }, 'hold']);
assert(/not an aim/.test(G.checked({ attack: [{ when: {}, aims: [{ chain: '>=2' }, 'sometimes'] }] }).errors.join(' ')), 'a list entry that is no aim, default or hold is refused');

// how near a line comes: a plain three is near no chain or combo; a longer chain is nearer a chain of 8; a break aim needs a break
assert.strictEqual(G.near({ chain: '>=8' }, { chain: 1, combo: 3 }), 0, 'a plain three is not near a chain');
assert(G.near({ chain: '>=8' }, { chain: 3, combo: 3 }) > G.near({ chain: '>=8' }, { chain: 2, combo: 3 }), 'a chain of 3 is nearer 8 than a chain of 2');
assert.strictEqual(G.near({ chain: '>=8', break: true }, { chain: 3, combo: 3, broke: 0 }), 0, 'under garbage a line that breaks nothing is near nothing');
assert(G.near({ chain: '==4' }, { chain: 5 }) > 0 && G.near({ chain: '==4' }, { chain: 5 }) < 1, 'past an exact size is near, not met');
assert(G.nearList([{ chain: '>=8' }, { combo: '>=6' }], { chain: 3, combo: 3 }) > G.nearList([{ chain: '>=8' }, { combo: '>=6' }], { chain: 2, combo: 5 }), 'the first entry decides first');

// deadlines
assert.strictEqual(G.deadline({ us: { nextLands: 120 } }, 'us.nextLands'), 120);
assert.strictEqual(G.deadline({ us: {} }, 300), 300);
assert.strictEqual(G.deadline({ us: {} }, 'us.nextLands'), null, 'an unknown deadline is none');

// the facts off a board: rows top first, the third row's left half garbage
var b = PA.puzzle(['000000', '000000', '000000', '120000', '341200', '123412'].join(''));
var f = G.facts(b, [{ at: 40, height: 2 }, { at: 90, height: 12 }], false);
assert.strictEqual(f.material, 12, 'every panel counts with no garbage: ' + f.material);
assert.strictEqual(f.contact, null, 'no garbage, no contact');
assert.strictEqual(f.coming, 14); assert.strictEqual(f.heavy, true); assert.strictEqual(f.nextLands, 40);
var bq = PA.puzzle(['000000', '000000', '000000', '120000', '341200', '123412'].join('')); bq.incoming = [{ width: 6, height: 2 }]; bq.stopTime = 75;
assert.strictEqual(G.facts(bq, [], false).nextLands, 75, 'a queued block lands when the stop time runs out');
bq.stopTime = 0; assert.strictEqual(G.facts(bq, [], false).nextLands, 0, 'with no stop time it drops now');
for (var c = 1; c <= 3; c++) b.panels[4][c].isGarbage = true;   // garbage across columns 1-3 in row 4: columns 1-2 are 3 high, column 3 is 2
var f2 = G.facts(b, [], false);
assert.strictEqual(f2.contact, 2, 'columns 1 and 2 reach the garbage, column 3 does not: ' + f2.contact);
assert.strictEqual(f2.material, 12, 'every panel is under the garbage or in a column with none: ' + f2.material);
b.panels[6][1].color = 1;   // a panel above the garbage in column 1 is out of reach
assert.strictEqual(G.facts(b, [], false).material, 12, 'a panel above the garbage is not material');

// keep: what the board a line ends on must still have (a settled grid: 0 empty, -2 garbage, 1..7 colours)
var grid = [[0,0,0,0,0,0,0],[0,1,2,3,4,5,1],[0,2,3,0,0,0,0],[0,-2,-2,-2,0,0,0],[0,4,0,0,0,0,0],[0,0,0,0,0,0,0]];
var gf = G.gridFacts(grid);
assert.strictEqual(gf.material, 8, 'the panels under the garbage, not the one above it: ' + gf.material);
assert(G.keeps({ material: '>=8' }, grid) && !G.keeps({ material: '>=12' }, grid), 'a line that leaves 8 panels keeps 8, not 12');
assert(G.keeps(null, grid), 'no keep asks nothing');
assert.strictEqual(G.breakBy({ us: { dies: 97, nextLands: 1 } }), null, 'a break is due before the board dies -- the engine judges it, not the next block landing or the estimate');
assert.strictEqual(G.idleMs(24, 12), 100, 'a board lost in 24 frames plans idle for half the 12 left: 100 ms');
assert.strictEqual(G.idleMs(0, 12), Infinity, 'nothing threatening: the decision\'s time');
var fl = G.floor({ material: '>=12' });
assert(!fl(grid, { broke: 0, chain: 2 }), 'the floor holds an attack, garbage on the board or not');
assert(fl(grid, { broke: 6 }), 'a break is not held to the floor');
assert.strictEqual(G.floor(null), null, 'no keep, no floor');

// the rules file, read again when it changes
var file = path.join(__dirname, 'gambit.test.rules.json');
function write(j, ms) { fs.writeFileSync(file, JSON.stringify(j)); fs.utimesSync(file, ms / 1000, ms / 1000); }
try {
  write({ attack: [{ name: 'a', when: {}, aim: { combo: '>=4' } }] }, 1e12);
  var R = new G.Rules(file);
  assert.strictEqual(R.get().attack[0].name, 'a');
  write({ attack: [{ name: 'b', when: {}, aim: { chain: '>=3' } }], opponents: { Bob: { attack: [{ name: 'bob', when: {}, aim: { combo: '>=6' } }] } } }, 1e12 + 5000);
  assert.strictEqual(R.get().attack[0].name, 'b', 'a rewritten file is read again');
  assert.strictEqual(R.get('Bob').attack[0].name, 'bob', 'an opponent with tables of its own is played by them');
  assert.strictEqual(R.get('Alice').attack[0].name, 'b', 'any other opponent by the shared tables');
  fs.writeFileSync(file, '{ not json'); fs.utimesSync(file, 1e9 + 9, 1e9 + 9);
  assert.strictEqual(R.get().attack[0].name, 'b', 'a broken file keeps the last good tables');
  assert(R.error, 'and says why');
} finally { try { fs.unlinkSync(file); } catch (e) {} }

// under garbage the search is led by the list, a break of any kind nearer than none
var P4 = [{ chain: '==4', break: true }];
assert(G.lead(P4, { combo: 3, chain: 1, broke: 1 }, true) > G.lead(P4, { combo: 3, chain: 3, broke: 0 }, true), 'any break before a line that breaks nothing');
assert(G.lead(P4, { combo: 3, chain: 4, broke: 6 }, true) > G.lead(P4, { combo: 3, chain: 2, broke: 6 }, true), 'the list between equal breaks');
assert.strictEqual(G.lead([{ chain: '==4' }], { chain: 2, broke: 6 }, false), G.nearList([{ chain: '==4' }], { chain: 2, broke: 6 }), 'no garbage: the list');
assert(G.lead(P4, { combo: 3, chain: 1, broke: 6 }, true) > 0, 'a three that breaks is near');

// the pick's tiers: under garbage a break is a must-do; a chain that breaks nothing is still a best that fits (a topped board lives on
// its stop time), above hold (5); a clear that buys nothing is below it
assert.strictEqual(G.tier('lineup', { chain: 1, combo: 3, broke: 6, done: 30 }, -1, true, false).tier, 1, 'under garbage a three that breaks is a must-do');
function before(x, y) { for (var q = 0; q < x.sub.length; q++) if (x.sub[q] !== y.sub[q]) return x.sub[q] < y.sub[q]; return false; }
assert(G.tier('break search', { broke: 6, done: 90 }, -1, true, false).sub[0] < G.tier('lineup', { chain: 3, combo: 6, broke: 6, done: 40, floor: false }, -1, true, false).sub[0], 'of two breaks the one that keeps the floor first');
var slowAim = G.tier('entry', { chain: 2, combo: 6, broke: 6, done: 900 }, 0, true, false), fastBreak = G.tier('lineup break', { broke: 6, done: 60 }, -1, true, false);
assert(before(fastBreak, slowAim), 'under garbage a break in the list but done after the pop ranks below one made during it');
var stopT = G.tier('lineup', { chain: 6, combo: 3, broke: 0, cells: 30 }, -1, true, false, true), towardT = G.tier('toward', {}, -1, true, false, true), levelT = G.tier('level', {}, -1, true, false, true);
assert(stopT.tier === 4 && towardT.sub[0] < stopT.sub[0] && stopT.sub[0] < levelT.sub[0], 'under garbage, topped, a chain that breaks nothing buys stop time: after the line toward a break, before level and hold');
assert.strictEqual(G.tier('lineup', { chain: 6, combo: 3, broke: 0, cells: 30 }, -1, true, false, false).tier, 6, 'under garbage, not topped, a chain that breaks nothing would make the break wait: below hold');
assert.strictEqual(G.tier('clear', { chain: 1, combo: 3 }, -1, true, false).tier, 6, 'a plain clear is below hold');
assert.strictEqual(G.tier('scramble', { chain: 5, combo: 3, earned: 120 }, -1, true, false).tier, 6, 'a scramble is below hold, whatever it buys');
assert.strictEqual(G.tier('entry', { chain: 4, cells: 18 }, 0, false, false).tier, 2, 'no garbage: the aim');
assert.strictEqual(G.tier('setup', {}, -1, false, false).tier, 4, 'a setup: nothing fits');

// the profile's own rules file parses and drops nothing
var shipped = G.checked(JSON.parse(fs.readFileSync(path.join(__dirname, 'survivor-profiles', 'gambit-rules.json'), 'utf8')));
assert.deepStrictEqual(shipped.errors, [], 'the shipped rules drop nothing');
console.log('ok: gambit tables, aims, facts and the rules file');
