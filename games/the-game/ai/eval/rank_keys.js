// rank_keys.js RANK_C [LINE...]: the order's keys by their line in Gambit's rank.c -- each `cmpKey = __LINE__` and the comment it sits
// under -- as JSON {line: {fn, rule}}; with LINE arguments, only those. The decision log names the key that put the line played first by
// its line (GAMBITD won=k<line>, sooner=…:k<line>, putDown=…:k<line>), so read it against the rank.c of the build that played (the
// log's own sha). Usage: node rank_keys.js games/the-game/ai/gambit/rank.c 583 690
var fs = require('fs');
var path = process.argv[2];
if (!path) { console.error('usage: node rank_keys.js RANK_C [LINE...]'); process.exit(2); }
var lines = fs.readFileSync(path, 'utf8').split('\n');
var want = process.argv.slice(3).map(Number);
var out = {}, fn = '';
for (var i = 0; i < lines.length; i++) {
  var f = /^static\s+[a-z0-9_ *]+?\b([A-Za-z0-9_]+)\s*\(/.exec(lines[i]);
  if (f) fn = f[1];
  if (lines[i].indexOf('cmpKey = __LINE__') < 0) continue;
  // (the comment it sits under: the nearest comment line above it, then that comment's first line -- the rule's own words)
  var j = i - 1;
  while (j >= 0 && !/^\s*\/\//.test(lines[j])) j--;
  var k = j;
  while (k > 0 && /^\s*\/\//.test(lines[k - 1])) k--;
  var rule = j >= 0 ? lines.slice(k, j + 1).map(function (s) { return s.replace(/^\s*\/\/\s?/, ''); }).join(' ').replace(/\s+/g, ' ').trim() : '';
  out[i + 1] = { fn: fn, rule: rule.length > 240 ? rule.slice(0, 237) + '...' : rule };
}
var keys = Object.keys(out).map(Number);
if (!keys.length) { console.error('no keys found in ' + path); process.exit(1); }
if (want.length) { var o = {}; want.forEach(function (n) { o[n] = out[n] || null; }); out = o; }
console.log(JSON.stringify(out, null, 1));
