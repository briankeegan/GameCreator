#!/usr/bin/env node
// A FIGHT RUN'S OWN REPORT: node survivor_runsummary.js [DIR]   (DIR holds fight-*.log, mind-*.log, frames-*.jsonl.gz, death-*.jsonl.gz)
//
// Per game: the result and length. Over the decisions each death file kept: what the swaps clear (nothing, a three, a combo, a chain), the
// threes by the stack as the game showed it (topped out or within 120 frames of it, or not), and how often the board a decision was made
// on held 6+ more garbage cells than the game's own board at that clock. Printed as markdown for the step summary; it never fails a run.
var fs = require('fs'), path = require('path'), cp = require('child_process'), v8 = require('v8');
var dir = process.argv[2] || '.', E = __dirname;
var PA = require(path.join(E, '..', '..', 'pa-engine.js')), CK = require('./survivor_checks.js');
function lines(f) { try { return cp.execSync('zcat "' + f + '" 2>/dev/null; true', { maxBuffer: 1 << 30 }).toString().trim().split('\n').filter(function (x) { return x.slice(-1) === '}'; }).map(JSON.parse); } catch (e) { return []; } }
function gc(b) { var n = 0; for (var r = 1; r < b.panels.length; r++) for (var c = 1; c <= 6; c++) if (b.panels[r] && b.panels[r][c] && b.panels[r][c].isGarbage && b.panels[r][c].state !== 'falling') n++; return n; }
function out(s) { process.stdout.write(s + '\n'); }
try {
  var files = fs.readdirSync(dir), fights = files.filter(function (f) { return /^fight-.*\.log$/.test(f); }), minds = files.filter(function (f) { return /^mind-.*\.log$/.test(f); });
  fights.forEach(function (f) {
    var txt = fs.readFileSync(path.join(dir, f), 'utf8'), res = (txt.match(/bot (won|lost)/g) || []).map(function (x) { return x.slice(4); });
    var frames = [];
    minds.forEach(function (m) { (fs.readFileSync(path.join(dir, m), 'utf8').match(/"frames":(\d+)/g) || []).forEach(function (x) { frames.push(+x.slice(9)); }); });
    out('### ' + f + ': ' + res.filter(function (x) { return x === 'won'; }).length + ' won, ' + res.filter(function (x) { return x === 'lost'; }).length + ' lost');
    out('games (result, frames): ' + res.map(function (x, i) { return x + ' ' + (frames[i] || '?'); }).join('; '));
  });
  var K = {}, T = {}, P = { n: 0, over: 0 };
  files.filter(function (f) { return /^death-.*\.jsonl\.gz$/.test(f); }).forEach(function (df) {
    var d = lines(path.join(dir, df)).pop(), F = lines(path.join(dir, df.replace('death-', 'frames-')));
    if (!d || !d.decided) return;
    var A = {}; (d.asked || []).forEach(function (q) { A[q.id] = q; });
    function real(c) { var cur = null; for (var i = 0; i < F.length; i++) { if (F[i].clock > c) break; if (F[i].grid) cur = F[i]; } if (!cur) return null; var t = 0, g = 0; cur.grid.split('\n').forEach(function (r) { var n = +r.slice(0, 3); if (!n) return; var b = r.slice(3); for (var k = 0; k < 6; k++) if (b[k * 2] === 'G') g++; if (/[1-9G]/.test(b)) t = Math.max(t, n); }); return { top: t, g: g, stop: cur.stop }; }
    d.decided.forEach(function (x) {
      var q = A[x.id]; if (!q) return;
      var b = PA.revive(v8.deserialize(Buffer.from(q.board, 'base64'))), rl = real(b.clock);
      if (rl) { P.n++; if (gc(b) - rl.g >= 6) P.over++; }
      if (x.kind !== 'swap' || !x.move) return;
      var t = b.copy(); t.behaviours = Object.assign({}, t.behaviours, { passiveRaise: false }); t.curRow = x.move[0]; t.curCol = x.move[1];
      if (!t.tryQueueSwap(x.move[0], x.move[1])) return;
      var r = t.settle(), kind = !r.combos.length ? 'nothing' : r.chain >= 2 ? 'chain' : r.combos.every(function (z) { return z === 3; }) ? 'three' : 'combo';
      K[kind] = (K[kind] || 0) + 1;
      if (kind === 'three' && rl) { var near = rl.top >= 11 && rl.stop <= 120, k = near ? 'near the top (last resort)' : 'NOT near the top'; T[k] = (T[k] || 0) + 1; }
    });
  });
  out('swaps by what they clear: ' + JSON.stringify(K));
  out('threes by the stack as the game showed it: ' + JSON.stringify(T));
  out('decisions on a board with 6+ more garbage cells than the game\'s: ' + P.over + ' of ' + P.n);
} catch (e) { out('(run summary failed: ' + e.message + ')'); }
