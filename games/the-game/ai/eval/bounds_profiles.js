// node bounds_profiles.js: writes survivor-profiles/bounds/*.json, WasmSurvivor
// at the corners of the box its training searches (every kept weight at 0, at
// +MAX, at -MAX, and two random +-MAX mixes), with the excluded weights at 0.
// Each is played through the drills (survivor-duels.yml, input profile); a
// kept weight is only safe to train while every corner survives.
var fs = require('fs'), path = require('path');
var MAX = 300;   // train_pbt.js MAX_WEIGHT
var F = require('./survivor.features.json'), base = require('./survivor.profile.json');
var keep = Object.keys(F.keep), all = require('./registry.js').genomeKeys('');
keep.concat(F.exclude).forEach(function (k) { if (all.indexOf(k) < 0) throw new Error(k + ' is not a feature'); });
if (keep.length + F.exclude.length !== all.length) throw new Error('keep + exclude cover ' + (keep.length + F.exclude.length) + ' of ' + all.length + ' features');
var seed = 7; function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
var corners = { zero: function () { return 0; }, hi: function () { return MAX; }, lo: function () { return -MAX; },
                mixA: function () { return rng() < 0.5 ? MAX : -MAX; }, mixB: function () { return rng() < 0.5 ? MAX : -MAX; } };
var dir = path.join(__dirname, 'survivor-profiles', 'bounds');
fs.mkdirSync(dir, { recursive: true });
Object.keys(corners).forEach(function (name) {
  var p = JSON.parse(JSON.stringify(base)), o = {};
  F.exclude.forEach(function (k) { o[k] = 0; });
  keep.forEach(function (k) { o[k] = corners[name](); });
  p.overrides = o;
  fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(p, null, 2) + '\n');
  console.log(name, JSON.stringify(keep.map(function (k) { return o[k]; })));
});
