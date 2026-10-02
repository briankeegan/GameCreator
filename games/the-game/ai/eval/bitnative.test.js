#!/usr/bin/env node
// native/bit.wasm gives bitmatch.js's answers: every legal swap of every real board,
// resolved untimed by both, compared field by field and settled board by settled board.
var path = require('path'), fs = require('fs');
var bit = require('./bitmatch.js'), nat = require('./bitnative.js');
var src = JSON.parse(fs.readFileSync(path.join(__dirname, 'realboards.json'), 'utf8'));
var W = 6, H = 12;
function boardOf(s) {
  var grid = [], blocks = {}, r, c;
  for (r = 0; r <= H; r++) { grid[r] = []; for (c = 1; c <= W; c++) grid[r][c] = 0; }
  for (r = 1; r <= H; r++) for (c = 1; c <= W; c++) {
    var ch = s.charAt((r - 1) * W + (c - 1));
    if (!ch) continue;
    if (/[a-zA-Z]/.test(ch)) { grid[r][c] = -2; (blocks[ch] = blocks[ch] || { cells: [] }).cells.push([r, c]); }
    else grid[r][c] = Number(ch);
  }
  return bit.maskState(grid, blocks, W, H);
}
function same(a, b) {
  if (a.scope !== b.scope || a.chain !== b.chain || a.total !== b.total || a.rounds !== b.rounds || (a.frames | 0) !== (b.frames | 0)) return 'result';
  if (a.scope === 'garbage-broke' && (a.garbage !== b.garbage || a.converts !== b.converts || a.voidAfter !== b.voidAfter)) return 'break';
  if (!a.settled !== !b.settled) return 'settled presence';
  if (a.settled) {
    var x = a.settled, y = b.settled, c, i;
    if (x.N !== y.N) return 'N';
    for (c = 0; c <= W + 1; c++) if ((x.occ[c] | 0) !== (y.occ[c] | 0) || (x.inert[c] | 0) !== (y.inert[c] | 0) || (x.garb[c] | 0) !== (y.garb[c] | 0)) return 'masks';
    for (i = 0; i < x.colour.length; i++) if ((x.colour[i] | 0) !== (y.colour[i] | 0)) return 'colour';
    if (x.slabs.length !== y.slabs.length) return 'slabs';
    for (i = 0; i < x.slabs.length; i++) {
      for (c = 0; c <= W + 1; c++) if ((x.slabs[i][c] | 0) !== (y.slabs[i][c] | 0)) return 'slab ' + i;
      if (!!x.slabLocked[i] !== !!y.slabLocked[i]) return 'locked';
    }
  }
  return null;
}
var n = 0, bad = 0, broke = 0, chains = 0, skipped = 0;
src.boards.forEach(function (s, bi) {
  var st = boardOf(s);
  if (!nat.fits(st)) { skipped++; return; }
  var cases = [null].concat(bit.legalSwapsOf(st));
  cases.forEach(function (sw) {
    if (sw && !bit.swapMasks(st, sw[0], sw[1])) return;
    var a = bit.resolveFromMasks(st, true), b = nat.resolve(st, true);
    if (sw) bit.swapMasks(st, sw[0], sw[1]);
    n++;
    if (a.scope === 'garbage-broke') broke++;
    if (a.chain >= 2) chains++;
    var d = same(a, b);
    if (d && bad++ < 5) console.log('DIFFERENT board ' + bi + ' swap ' + JSON.stringify(sw) + ': ' + d + ' js ' + JSON.stringify([a.scope, a.chain, a.total, a.rounds, a.frames]) + ' native ' + JSON.stringify([b.scope, b.chain, b.total, b.rounds, b.frames]));
  });
});
console.log('bitnative: ' + n + ' resolves (' + broke + ' breaks, ' + chains + ' chains), ' + bad + ' different' + (skipped ? ', ' + skipped + ' boards too big' : ''));
process.exit(bad || !broke || !chains ? 1 : 0);
