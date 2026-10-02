(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PAGenerator = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function wangHash64(k) {
    var M = (BigInt(1) << BigInt(64)) - BigInt(1), b = function (n) { return BigInt(n); };
    k = ((~k) + (k << b(21))) & M; k = k ^ (k >> b(24));
    k = (k + (k << b(3)) + (k << b(8))) & M; k = k ^ (k >> b(14));
    k = (k + (k << b(2)) + (k << b(4))) & M; k = k ^ (k >> b(28));
    return (k + (k << b(31))) & M;
  }
  var MH = 0x2545F491, ML = 0x4F6CDD1D;           // 2685821657736338717
  function mulHiLo(a, b) {                         // a*b, both uint32, as [hi, lo]
    var a0 = a & 0xFFFF, a1 = a >>> 16, b0 = b & 0xFFFF, b1 = b >>> 16;
    var p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
    var mid = (p00 >>> 16) + (p01 & 0xFFFF) + (p10 & 0xFFFF);
    return [(p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16)) >>> 0, ((mid & 0xFFFF) << 16 | (p00 & 0xFFFF)) >>> 0];
  }
  function LoveRng(seed) {                         // setSeed: (uint64)seed, hash until non-zero
    if (seed === undefined) return;
    var M = (BigInt(1) << BigInt(64)) - BigInt(1), s = BigInt(Math.trunc(seed)) & M;
    do { s = wangHash64(s); } while (s === BigInt(0));
    this.hi = Number(s >> BigInt(32)); this.lo = Number(s & BigInt(0xFFFFFFFF));
  }
  LoveRng.prototype.random01 = function () {
    var h = this.hi, l = this.lo;
    l = (l ^ ((l >>> 12) | (h << 20))) >>> 0; h = (h ^ (h >>> 12)) >>> 0;   // s ^= s >> 12
    h = (h ^ ((h << 25) | (l >>> 7))) >>> 0; l = (l ^ (l << 25)) >>> 0;     // s ^= s << 25
    l = (l ^ ((l >>> 27) | (h << 5))) >>> 0; h = (h ^ (h >>> 27)) >>> 0;    // s ^= s >> 27
    this.hi = h; this.lo = l;
    var p = mulHiLo(l, ML), rh = (p[0] + Math.imul(h, ML) + Math.imul(l, MH)) >>> 0;
    return (rh * 1048576 + (p[1] >>> 12)) / 4503599627370496;               // (r >> 12) * 2^-52
  };
  LoveRng.prototype.random = function (min, max) { return Math.floor(this.random01() * (max - min + 1)) + min; };
  LoveRng.prototype.copy = function () { var r = new LoveRng(); r.hi = this.hi; r.lo = this.lo; return r; };

  var TO_NUM = { J: 0, j: 0 }, UP = '0ABCDEFGHI', LO = '0abcdefghi', i;
  for (i = 0; i <= 9; i++) { TO_NUM[String(i)] = i; if (i) { TO_NUM[UP[i]] = i; TO_NUM[LO[i]] = i; } }
  function isDigit(ch) { return ch >= '0' && ch <= '9'; }   // Lua tonumber(one char) ~= nil
  function zeros(w) { var s = ''; while (s.length < w) s += '0'; return s; }
  function PanelGenerator(seed, adjacentDenialFrequency) {
    if (seed === undefined) return;
    this.rng = new LoveRng(seed); this.adf = adjacentDenialFrequency; this.accepted = 0; this.denied = 0;
  }
  PanelGenerator.prototype.generatePanels = function (w, ncolors, prev) {
    if (!prev) prev = zeros(w);
    var out = '';
    for (var n = 1; n <= w; n++) {
      var last = n > 1 ? TO_NUM[out[n - 2]] : undefined, prevTwo = n > 2 && last === TO_NUM[out[n - 3]];
      var below = TO_NUM[prev[n - 1]], color, nogood = true;
      while (nogood) {
        color = this.rng.random(1, ncolors);
        if (color === below) nogood = true;
        else if (prevTwo && color === last) nogood = true;
        else if (n > 1 && color === last) {
          if (this.adf >= 1) nogood = true;
          else if (this.adf === 0) nogood = false;
          else if (this.denied / (this.accepted + this.denied) <= this.adf) { this.denied++; nogood = true; }   // 0/0 is NaN: accept
          else { this.accepted++; nogood = false; }
        } else nogood = false;
      }
      out += String(color);
    }
    return out;
  };
  PanelGenerator.prototype.assignMetalLocations = function (row, prev) {
    var w = row.length, first, second, s = '';
    if (!prev) prev = zeros(w);
    do { first = this.rng.random(1, w); } while (!isDigit(prev[first - 1]));
    do { second = this.rng.random(1, w); } while (second === first || !isDigit(prev[second - 1]));
    for (var j = 1; j <= w; j++) {
      var ch = row[j - 1];
      s += j === first ? (isDigit(ch) ? UP[+ch] : ch) : j === second ? (isDigit(ch) ? LO[+ch] : ch) : ch;
    }
    return s;
  };
  PanelGenerator.prototype.copy = function () {
    var g = new PanelGenerator(); g.rng = this.rng.copy(); g.adf = this.adf; g.accepted = this.accepted; g.denied = this.denied; return g;
  };

  function isBadRow(r) {
    var c = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], k;
    for (k = 0; k < r.length; k++) c[+r[k]]++;
    for (k = 1; k <= 9; k++) if (c[k] !== 0 && c[k] !== 2) return false;
    return true;
  }
  function GeneratorSource(seed, shockEnabled, colors, adjacentDenialFrequency, width) {
    if (seed === undefined) return;
    this.width = width || 6; this.colors = colors; this.shockEnabled = shockEnabled;
    this.panelGenerator = new PanelGenerator(seed, adjacentDenialFrequency);
    this.garbagePanelGenerator = new PanelGenerator(Math.floor((seed + 5) / 2), 1);
    this.panelBuffer = ''; this.garbagePanelBuffer = '';
    this.panelBuffer = this.generateStartingBoard();
  }
  GeneratorSource.prototype.growPanelBuffer = function () {
    var w = this.width, last = this.panelBuffer.slice(-w), p;
    if (!this.panelBuffer.length) last = '';
    do { p = this.panelGenerator.generatePanels(w, this.colors, last); } while (isBadRow(p));
    if (this.shockEnabled) p = this.panelGenerator.assignMetalLocations(p, last);
    this.panelBuffer += p;
  };
  GeneratorSource.prototype.generateStartingBoard = function () {
    var w = this.width, k;
    for (k = 0; k < 7; k++) this.growPanelBuffer();
    var a = (zeros(w) + this.panelBuffer).split(''), h = [], toRemove = 2 * w;
    this.panelBuffer = '';
    for (k = 0; k <= w; k++) h.push(7);
    while (toRemove > 0) {
      var idx = this.panelGenerator.rng.random(1, w);
      if (h[idx] > 0) { a[idx + w * (8 - h[idx]) - 1] = '0'; h[idx]--; toRemove--; }
    }
    return a.join('').slice(w);
  };
  GeneratorSource.prototype.nextRowString = function () {
    var w = this.width;
    if (this.panelBuffer.length <= 2 * w) this.growPanelBuffer();
    var r = this.panelBuffer.slice(0, w);
    this.panelBuffer = this.panelBuffer.slice(w);
    return r;
  };
  GeneratorSource.prototype.garbageRowString = function () {
    var w = this.width;
    if (this.garbagePanelBuffer.length <= 10 * w) {
      var last = this.garbagePanelBuffer.slice(-w);
      if (!this.garbagePanelBuffer.length) last = '';
      for (var k = 0; k < 20; k++) {
        var r = this.garbagePanelGenerator.generatePanels(w, this.colors, last);
        this.garbagePanelBuffer += r; last = r;
      }
    }
    var out = this.garbagePanelBuffer.slice(0, w);
    this.garbagePanelBuffer = this.garbagePanelBuffer.slice(w);
    return out;
  };
  GeneratorSource.prototype.copy = function () {
    var g = new GeneratorSource();
    g.width = this.width; g.colors = this.colors; g.shockEnabled = this.shockEnabled;
    g.panelGenerator = this.panelGenerator.copy(); g.garbagePanelGenerator = this.garbagePanelGenerator.copy();
    g.panelBuffer = this.panelBuffer; g.garbagePanelBuffer = this.garbagePanelBuffer;
    return g;
  };
  GeneratorSource.prototype.catchUp = function (panelBuffer, garbagePanelBuffer) {
    var k;
    for (k = 0; k < 8; k++) this.nextRowString();
    for (k = 0; this.panelBuffer !== panelBuffer; k++) { if (k > 2000) return false; this.nextRowString(); }
    if (garbagePanelBuffer === '' && this.garbagePanelBuffer === '') return true;
    for (k = 0; this.garbagePanelBuffer !== garbagePanelBuffer; k++) { if (k > 2000) return false; this.garbageRowString(); }
    return true;
  };
  function safeFraction(n, d) { var v = n / d; return Math.floor(v) === v ? v : Number(v.toPrecision(14)); }

  return { LoveRng: LoveRng, PanelGenerator: PanelGenerator, GeneratorSource: GeneratorSource, isBadRow: isBadRow, safeFraction: safeFraction };
}));
