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

// the first rule whose `when` holds
var rules = [
  { name: 'finish', when: { 'enemy.topped': true }, aim: { combo: '>=4' } },
  { name: 'dig', when: { 'us.heavy': true, 'us.contact': '>=1' }, aim: { break: true, any: [{ combo: '>=4' }, { chain: '>=2' }] } },
  { name: 'rest', when: {}, aim: { chain: '>=2' } }
];
assert.strictEqual(G.choose(rules, { us: {}, enemy: { topped: true } }).rule.name, 'finish');
assert.strictEqual(G.choose(rules, { us: { heavy: true, contact: 2 }, enemy: { topped: false } }).rule.name, 'dig');
assert.strictEqual(G.choose(rules, { us: { heavy: true, contact: null }, enemy: {} }).rule.name, 'rest', 'contact with no garbage is no contact');

// aims against what a line makes
var dig = rules[1].aim;
assert(G.meets(dig, { combo: 4, chain: 1, broke: 6, cells: 3 }), 'a combo of 4 that breaks meets the dig');
assert(G.meets(dig, { combo: 3, chain: 2, broke: 6, cells: 6 }), 'a chain of 2 that breaks meets it');
assert(!G.meets(dig, { combo: 3, chain: 1, broke: 6, cells: 0 }), 'a plain three does not');
assert(!G.meets(dig, { combo: 5, chain: 1, broke: 0, cells: 4 }), 'a combo that breaks nothing does not');
assert(G.meets({ combo: '>=5', chain: '>=3' }, { combo: 5, chain: 3, broke: 0 }) && !G.meets({ combo: '>=5', chain: '>=3' }, { combo: 5, chain: 2 }), 'both asked: both must hold');
assert(!G.meets({ break: false, combo: '>=4' }, { combo: 4, chain: 1, broke: 6 }), 'break false: a line that breaks is not the aim');

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
for (var c = 1; c <= 3; c++) b.panels[4][c].isGarbage = true;   // garbage across columns 1-3 in row 4: columns 1-2 are 3 high, column 3 is 2
var f2 = G.facts(b, [], false);
assert.strictEqual(f2.contact, 2, 'columns 1 and 2 reach the garbage, column 3 does not: ' + f2.contact);
assert.strictEqual(f2.material, 12, 'every panel is under the garbage or in a column with none: ' + f2.material);
b.panels[6][1].color = 1;   // a panel above the garbage in column 1 is out of reach
assert.strictEqual(G.facts(b, [], false).material, 12, 'a panel above the garbage is not material');

// the rules file, read again when it changes
var file = path.join(__dirname, 'gambit.test.rules.json');
function write(j, ms) { fs.writeFileSync(file, JSON.stringify(j)); fs.utimesSync(file, ms / 1000, ms / 1000); }
try {
  write({ rules: [{ name: 'a', when: {}, aim: { combo: '>=4' } }] }, 1e12);
  var R = new G.Rules(file);
  assert.strictEqual(R.get()[0].name, 'a');
  write({ rules: [{ name: 'b', when: {}, aim: { chain: '>=3' } }], opponents: { Bob: [{ name: 'bob', when: {}, aim: { combo: '>=6' } }] } }, 1e12 + 5000);
  assert.strictEqual(R.get()[0].name, 'b', 'a rewritten file is read again');
  assert.strictEqual(R.get('Bob')[0].name, 'bob', 'an opponent with rules of its own is played by them');
  assert.strictEqual(R.get('Alice')[0].name, 'b', 'any other opponent by the shared rules');
  fs.writeFileSync(file, '{ not json'); fs.utimesSync(file, 1e9 + 9, 1e9 + 9);
  assert.strictEqual(R.get()[0].name, 'b', 'a broken file keeps the last good rules');
  assert(R.error, 'and says why');
} finally { try { fs.unlinkSync(file); } catch (e) {} }

// the profile's own rules file parses and every rule has an aim
var shipped = JSON.parse(fs.readFileSync(path.join(__dirname, 'survivor-profiles', 'gambit-rules.json'), 'utf8'));
shipped.rules.forEach(function (r, i) { assert(r.aim && typeof r.aim === 'object', 'rule ' + i + ' has no aim'); });
console.log('ok: gambit rules, aims, facts and the rules file');
