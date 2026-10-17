// THE LIST IN C IS gambit.js's LIST: for every mode in the rules file -- its list, and that list with the break aims the searches add
// -- what rules.c's fits, entryOf and meets say of every made line (combo 0..20, chain 0..15, broke and not, cells) is what gambit.js
// says. Run: node rules.test.js
var assert = require('assert'), path = require('path');
var GAMBIT = require(path.join(__dirname, '..', 'eval', 'gambit.js')), G = require('./gambit.js').load();
var rules = require(path.join(__dirname, '..', 'eval', 'survivor-profiles', 'gambit-rules.json')), lists = 0, checked = 0;
rules.attack.concat(rules.defend || []).forEach(function (r) {
  var aims = GAMBIT.aimsOf(r).filter(function (a) { return a && typeof a === 'object'; });
  [aims, aims.concat([{ break: true }]), aims.map(function (a) { return Object.assign({ break: true }, a); })].forEach(function (L) {
    G.list(L); lists++;
    for (var combo = 0; combo <= 20; combo++) for (var chain = 0; chain <= 15; chain++) [0, 6].forEach(function (broke) { [0, 12].forEach(function (cells) {
      var made = { combo: combo, chain: chain, broke: broke, cells: cells }, at = r.name + ' ' + JSON.stringify(L) + ' ' + JSON.stringify(made);
      assert.strictEqual(G.X.gb_fits(combo, chain, broke, cells) === 1, GAMBIT.fits(L, made), 'fits: ' + at);
      assert.strictEqual(G.X.gb_entry_of(combo, chain, broke, cells), GAMBIT.entryOf(L, made), 'entryOf: ' + at);
      L.forEach(function (a, i) { assert.strictEqual(G.X.gb_meets(i, combo, chain, broke, cells) === 1, GAMBIT.meets(a, made), 'meets ' + i + ': ' + at); });
      checked++;
    }); });
  });
});
assert.ok(lists >= 12, 'every mode\'s list checked: ' + lists);
console.log('ok: the list in C -- ' + lists + ' lists, ' + checked + ' made lines each judged by fits, entryOf and meets as gambit.js judges them');
