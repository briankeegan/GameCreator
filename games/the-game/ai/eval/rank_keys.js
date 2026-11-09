// rank_keys.js RANK_C [LINE...]: the order's keys by their line in Gambit's rank.c -- each `cmpKey = __LINE__` and the comment it sits
// under -- as JSON {line: {fn, name, rule, test}} -- name the numbered heading of the rule's block in rank.c, rule the key's own comment (or
// its test where the comment above it is another line's); with LINE arguments, only those. The decision log names the key that put the line played first by
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
  // (the comment is the key's own only where nothing but the key's statement lies between them -- a comment above a line of other code is
  // that code's; then the key's own test is its name)
  var stmtStart = i; while (stmtStart > 0 && /^\s*(\|\||&&)/.test(lines[stmtStart])) stmtStart--;
  var own = j >= 0 && j === stmtStart - 1;
  var rule = own ? lines.slice(k, j + 1).map(function (s) { return s.replace(/^\s*\/\/\s?/, ''); }).join(' ').replace(/\s+/g, ' ').trim() : '';
  var test = lines.slice(stmtStart, i + 1).join(' ').replace(/\s+/g, ' ').trim().replace(/\s*return \(cmpKey = __LINE__.*$/, '');
  if (!test) test = (lines[i - 1] || '').trim();
  // (THE RULE'S NAME: the numbered heading of the block the key sits in -- "1'f. NO SLAB AT THE FINISH" -- its words up to the first colon)
  var h = i; while (h >= 0 && !/^\s*\/\/ 1['a-z0-9]*\. /.test(lines[h]) && !/^static /.test(lines[h])) h--;
  var name = h >= 0 && /^\s*\/\/ 1/.test(lines[h]) ? lines[h].replace(/^\s*\/\/\s?/, '').replace(/\s+/g, ' ').trim() : '';
  if (name) { var cut = name.search(/: |\(the owner/); if (cut > 0) name = name.slice(0, cut).trim(); }
  // (the survival keys sit between headed blocks with no heading of their own: named by their test)
  if (/walkTurns\(/.test(test)) name = 'SURVIVAL: the later loss first, the walk not counted (the walk never turns a life into a death)';
  else if (/lostOf\(x\) != lostOf\(y\)/.test(test) && /lostAlike/.test(test)) name = 'SURVIVAL: the line lost a break\'s time or more later first';
  out[i + 1] = { fn: fn, name: name || fn, rule: (rule || 'the test: ' + test).slice(0, 240), test: test.slice(0, 240) };
}
var keys = Object.keys(out).map(Number);
if (!keys.length) { console.error('no keys found in ' + path); process.exit(1); }
if (want.length) { var o = {}; want.forEach(function (n) { o[n] = out[n] || null; }); out = o; }
console.log(JSON.stringify(out, null, 1));
