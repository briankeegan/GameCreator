(function (root) {
  'use strict';

  var S = null;
  function scratch(W, H, N) {
    if (!S || S.W !== W || S.N < N) {
      S = { W: W, H: H, N: Math.max(N, 8), occ: [], chaining: [], popping: [],
            inert: [], garb: [], rest: [], k: [], free: [], colour: [], B: [] };
      for (var c = 0; c <= W + 1; c++) {
        S.occ[c] = 0; S.chaining[c] = 0; S.popping[c] = 0;
        S.inert[c] = 0; S.garb[c] = 0; S.rest[c] = 0; S.k[c] = 0; S.free[c] = 0;
      }
      for (var a = 0; a <= S.N; a++) {
        S.colour[a] = []; S.B[a] = [];
        for (var c2 = 0; c2 <= W + 1; c2++) { S.colour[a][c2] = 0; S.B[a][c2] = 0; }
      }
    }
    return S;
  }

  function popcount(x) {
    var n = 0;
    while (x) { x &= x - 1; n++; }
    return n;
  }

  function restingMask(grid, blocks, W, H) {
    var occ = [], c, r, i;
    for (c = 1; c <= W; c++) {
      occ[c] = 0;
      for (r = 1; r <= H; r++) if (grid[r][c] !== 0) occ[c] |= (1 << (r - 1));
    }

    var ids = Object.keys(blocks || {}), owner = {}, falling = {};
    for (i = 0; i < ids.length; i++) {
      var cells = blocks[ids[i]].cells;
      for (var j = 0; j < cells.length; j++) owner[cells[j][0] + ':' + cells[j][1]] = ids[i];
    }
    var moved = true, guard = 0;
    while (moved && guard++ <= ids.length + 1) {
      moved = false;
      for (i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (falling[id]) continue;
        var bcells = blocks[id].cells, low = {};
        for (var k = 0; k < bcells.length; k++) {
          var br = bcells[k][0], bc = bcells[k][1];
          if (low[bc] === undefined || br < low[bc]) low[bc] = br;
        }
        var held = false;
        for (var lc in low) {
          var under = low[lc] - 1;
          if (under < 1) { held = true; break; }          // the floor
          var v = grid[under][lc];
          if (v === 0) continue;                          // nothing there
          if (v === -2) {
            var oid = owner[under + ':' + lc];
            if (oid !== undefined && falling[oid]) continue;   // falling too
          }
          held = true; break;
        }
        if (!held) { falling[id] = true; moved = true; }
      }
    }

    var seed = [];     // resting garbage: floor for whatever stands on it
    for (c = 1; c <= W; c++) seed[c] = 0;
    for (c = 1; c <= W; c++) {
      for (r = 1; r <= H; r++) {
        if (grid[r][c] !== -2) continue;
        var own = owner[r + ':' + c];
        if (own !== undefined && !falling[own]) seed[c] |= (1 << (r - 1));
      }
    }

    var rest = [];
    for (c = 1; c <= W; c++) {
      var o = occ[c], m = 0;
      for (r = 1; r <= H; r++) {
        var bit = 1 << (r - 1);
        if (!(o & bit)) continue;
        if (r === 1 || (m & (bit >> 1)) || (seed[c] & bit)) m |= bit;
      }
      rest[c] = m;
    }
    return rest;
  }

  function topColour(grid, W, H) {
    var top = 0;
    for (var r = 1; r <= H; r++) {
      for (var c = 1; c <= W; c++) if (grid[r][c] > top) top = grid[r][c];
    }
    return top;
  }

  function colourMasks(grid, blocks, W, H, nColours) {
    var rest = api.restingMask(grid, blocks, W, H);
    var N = nColours || api.topColour(grid, W, H);
    var B = [], a, c;
    for (a = 1; a <= N; a++) { B[a] = []; for (c = 1; c <= W; c++) B[a][c] = 0; }
    for (var r = 1; r <= H; r++) {
      for (c = 1; c <= W; c++) {
        var v = grid[r][c];
        if (v >= 1 && v <= N && (rest[c] & (1 << (r - 1)))) B[v][c] |= (1 << (r - 1));
      }
    }
    B.nColours = N;
    return B;
  }

  function clears(grid, blocks, W, H, nColours) {
    var B = api.colourMasks(grid, blocks, W, H, nColours);
    var mask = [], a, c;
    for (c = 1; c <= W; c++) mask[c] = 0;
    for (a = 1; a <= B.nColours; a++) {
      for (c = 1; c <= W; c++) {
        var b = B[a][c], cv = b & (b >> 1) & (b >> 2);
        mask[c] |= cv | (cv << 1) | (cv << 2);
      }
      for (c = 1; c + 2 <= W; c++) {
        var hc = B[a][c] & B[a][c + 1] & B[a][c + 2];
        mask[c] |= hc; mask[c + 1] |= hc; mask[c + 2] |= hc;
      }
    }
    var total = 0;
    for (c = 1; c <= W; c++) total += popcount(mask[c]);
    return { mask: mask, total: total };
  }

  function clearedCells(grid, blocks, W, H, nColours) {
    var out = {}, res = api.clears(grid, blocks, W, H, nColours);
    for (var c = 1; c <= W; c++) {
      for (var bit = 0; bit < H; bit++) {
        if (res.mask[c] & (1 << bit)) out[(bit + 1) + ':' + c] = true;
      }
    }
    return out;
  }

  function busyMask(grid, motion, W, H) {
    var busy = new Int32Array(W + 2);
    if (!motion) return busy;
    function allows(m) {
      if (!m) return true;
      if (m.dontSwap || m.isGarbage) return false;
      return m.state === 'normal' || m.state === 'swapping' ||
             m.state === 'landing' || m.state === 'falling';
    }
    for (var r = 1; r <= H; r++) {
      var b = 1 << (r - 1);
      for (var c = 1; c <= W; c++) {
        var m = motion[r] && motion[r][c];
        if (!allows(m)) { busy[c] |= b; continue; }
        var up = (r < H) && motion[r + 1] && motion[r + 1][c];
        if (up && up.state === 'hovering') busy[c] |= b;
      }
    }
    return busy;
  }

  function maskState(grid, blocks, W, H, motion) {
    var st = { W: W, H: H, N: 0, occ: new Int32Array(W + 2), inert: new Int32Array(W + 2),
               garb: new Int32Array(W + 2), colour: new Int32Array(13 * (W + 2)),
               busy: busyMask(grid, motion, W, H),
               slabs: [], slabLocked: [], slabAir: [], bad: null };
    var r, c, row;
    for (r = 1; r <= H; r++) {
      row = grid[r];
      for (c = 1; c <= W; c++) {
        var v = row[c], b = 1 << (r - 1);
        if (v === 0) continue;
        st.occ[c] |= b;
        if (v === -2) { st.inert[c] |= b; st.garb[c] |= b; continue; }
        if (v < 0) { st.bad = 'unknown-cell'; return st; }
        if (v > st.N) st.N = v;
        st.colour[v * (W + 2) + c] |= b;
      }
    }
    if (blocks) {
      for (var id in blocks) {
        var cells = blocks[id].cells, sm = new Int32Array(W + 2), locked = false, air = false;
        for (var i2 = 0; i2 < cells.length; i2++) {
          sm[cells[i2][1]] |= (1 << (cells[i2][0] - 1));
          var mo = motion && motion[cells[i2][0]] && motion[cells[i2][0]][cells[i2][1]];
          if (mo && ((mo.state !== 'normal' && mo.state !== 'falling') || (mo.color !== undefined && mo.color !== 9))) locked = true;
          if (mo && mo.state === 'falling') air = true;
        }
        st.slabs.push(sm);
        st.slabLocked.push(locked);
        st.slabAir.push(air ? 2 : 0);
      }
    }
    return st;
  }

  function risenMasks(st, incoming) {
    if (!st || st.bad || !incoming) return null;
    var W2 = st.W, c, v, top = (W2 + 2), lim = (1 << st.H) - 1;
    for (c = 1; c <= W2; c++) { v = incoming[c]; if (!(v > 0) || v > 12) return null; }
    var out = { W: st.W, H: st.H, N: st.N, occ: new Int32Array(top),
                inert: new Int32Array(top), garb: new Int32Array(top),
                colour: new Int32Array(13 * top), slabs: [],
                slabLocked: (st.slabLocked || []).slice(), bad: null };
    for (c = 1; c <= W2; c++) {
      out.occ[c] = ((st.occ[c] << 1) | 1) & lim;
      out.inert[c] = (st.inert[c] << 1) & lim;
      out.garb[c] = (st.garb[c] << 1) & lim;
      v = incoming[c];
      if (v > out.N) out.N = v;
      for (var k = 1; k <= 12; k++)
        out.colour[k * top + c] = (st.colour[k * top + c] << 1) & lim;
      out.colour[v * top + c] |= 1;
    }
    for (var i = 0; i < st.slabs.length; i++) {
      var sm = new Int32Array(top);
      for (c = 1; c <= W2; c++) sm[c] = (st.slabs[i][c] << 1) & lim;
      out.slabs.push(sm);
    }
    return out;
  }

  function copyState(st) {
    var stride = st.W + 2, out = { W: st.W, H: st.H, N: st.N, occ: [], inert: [], garb: [],
                                   colour: new Int32Array((st.N + 1) * stride), slabs: [],
                                   slabLocked: (st.slabLocked || []).slice(), bad: st.bad || null };
    if (st.busy) out.busy = Int32Array.from(st.busy);
    if (st.slabAir) out.slabAir = st.slabAir.slice();
    var c, i;
    for (c = 0; c <= st.W + 1; c++) { out.occ[c] = st.occ[c]; out.inert[c] = st.inert[c]; out.garb[c] = st.garb[c]; }
    for (i = 0; i < out.colour.length && i < st.colour.length; i++) out.colour[i] = st.colour[i];
    for (i = 0; st.slabs && i < st.slabs.length; i++) out.slabs.push(Int32Array.from(st.slabs[i]));
    return out;
  }

  function legalSwapsOf(st) {
    var out = [], r, c, a, stride = st.W + 2;
    for (r = 1; r <= st.H; r++) {
      var b = 1 << (r - 1);
      for (c = 1; c < st.W; c++) {
        if ((st.inert[c] & b) || (st.inert[c + 1] & b)) continue;
        if (st.busy && ((st.busy[c] | st.busy[c + 1]) & b)) continue;   // engine declines
        if (!((st.occ[c] | st.occ[c + 1]) & b)) continue;
        var left = 0, right = 0;
        for (a = 1; a <= st.N; a++) {
          if (st.colour[a * stride + c] & b) left = a;
          if (st.colour[a * stride + c + 1] & b) right = a;
        }
        if (left === right) continue;              // same colour, or both empty
        out.push([r, c]);
      }
    }
    return out;
  }

  function anyOneSwapClear(st) {
    var W = st.W, H = st.H, N = st.N, stride = W + 2;
    var sw = legalSwapsOf(st), i, a;

    function colourAt(c, bitv) {
      for (var aa = 1; aa <= N; aa++) if (st.colour[aa * stride + c] & bitv) return aa;
      return 0;
    }
    function restRow(c, r, ignoreBit) {
      var rr = r;
      while (rr > 1) {
        var below = 1 << (rr - 2);
        if ((st.occ[c] & below) && !(ignoreBit && below === ignoreBit)) break;
        rr--;
      }
      return rr;
    }
    function lineThrough(r, c, a, over) {
      function at(rr, cc) {
        if (rr < 1 || rr > H || cc < 1 || cc > W) return -1;
        for (var k = 0; k < over.length; k++)
          if (over[k][0] === rr && over[k][1] === cc) return over[k][2];
        return colourAt(cc, 1 << (rr - 1));
      }
      var run = 1, k;
      for (k = c - 1; k >= 1 && at(r, k) === a; k--) run++;
      for (k = c + 1; k <= W && at(r, k) === a; k++) run++;
      if (run >= 3) return true;
      run = 1;
      for (k = r - 1; k >= 1 && at(k, c) === a; k--) run++;
      for (k = r + 1; k <= H && at(k, c) === a; k++) run++;
      return run >= 3;
    }

    var slow = null;
    for (i = 0; i < sw.length; i++) {
      var r = sw[i][0], c = sw[i][1], bitv = 1 << (r - 1);
      var left = colourAt(c, bitv), right = colourAt(c + 1, bitv);
      if (!left || !right) {
        if (!slow) slow = copyState(st);
        if (!swapMasks(slow, r, c)) continue;
        var rz = resolveFromMasks(slow, false);
        swapMasks(slow, r, c);
        if (rz && (rz.total > 0 || rz.scope === 'garbage-broke')) return true;
        continue;
      }
      var over = [[r, c, right], [r, c + 1, left]];
      if (lineThrough(r, c + 1, left, over)) return true;
      if (lineThrough(r, c, right, over)) return true;
    }
    return false;
  }

  function atRest(st) {
    if (st._rest !== undefined) return st._rest;
    var W = st.W, stride = W + 2, c, a, rest = true;
    if (st.busy) for (c = 1; c <= W; c++) if (st.busy[c]) rest = false;
    for (c = 1; rest && c <= W; c++) {
      var o = st.occ[c], m = o & (((~o) & (o + 1)) - 1), seeds = st.inert[c] & ~m;
      while (seeds) {
        var seed = seeds & -seeds, run = seed, probe = seed;
        while ((probe <<= 1) && (o & probe)) run |= probe;
        m |= run; seeds &= ~run;
      }
      if (m !== o) rest = false;
    }
    for (a = 1; rest && a <= st.N; a++) {
      for (c = 1; c <= W; c++) {
        var b = st.colour[a * stride + c] & ~st.inert[c];
        if (b & (b >> 1) & (b >> 2)) { rest = false; break; }
        if (c + 2 <= W && b & st.colour[a * stride + c + 1] & st.colour[a * stride + c + 2] & ~st.inert[c + 1] & ~st.inert[c + 2]) { rest = false; break; }
      }
    }
    return (st._rest = rest);
  }
  function swapCanClear(st, r, c) {
    if (!atRest(st)) return true;
    var W = st.W, H = st.H, N = st.N, stride = W + 2, bitv = 1 << (r - 1), a, left = 0, right = 0;
    for (a = 1; a <= N; a++) {
      if (st.colour[a * stride + c] & bitv) left = a;
      if (st.colour[a * stride + c + 1] & bitv) right = a;
    }
    if (!left || !right) return true;
    function colourAt(rr, cc) {
      if (rr < 1 || rr > H || cc < 1 || cc > W) return -1;
      if (rr === r && cc === c) return right;
      if (rr === r && cc === c + 1) return left;
      var bb = 1 << (rr - 1);
      if (st.inert[cc] & bb) return 0;
      for (var aa = 1; aa <= N; aa++) if (st.colour[aa * stride + cc] & bb) return aa;
      return 0;
    }
    function line(rr, cc, col) {
      var run = 1, k;
      for (k = cc - 1; k >= 1 && colourAt(rr, k) === col; k--) run++;
      for (k = cc + 1; k <= W && colourAt(rr, k) === col; k++) run++;
      if (run >= 3) return true;
      run = 1;
      for (k = rr - 1; k >= 1 && colourAt(k, cc) === col; k--) run++;
      for (k = rr + 1; k <= H && colourAt(k, cc) === col; k++) run++;
      return run >= 3;
    }
    return line(r, c, right) || line(r, c + 1, left);
  }

  function bestOneSwapStop(st, price) {
    var sw = legalSwapsOf(st), best = 0, i, r, pays;
    for (i = 0; i < sw.length; i++) {
      if (!swapCanClear(st, sw[i][0], sw[i][1])) continue;
      if (!swapMasks(st, sw[i][0], sw[i][1])) continue;
      r = resolveFromMasks(st, false);
      swapMasks(st, sw[i][0], sw[i][1]);
      if (!r || !(r.total > 0)) continue;
      pays = price(r) || 0;
      if (pays > best) best = pays;
    }
    return best;
  }

  function reachMask(st) {
    var W2 = st.W, stride = W2 + 2, out = [], a, c;
    for (c = 0; c <= W2 + 1; c++) out[c] = 0;
    for (a = 1; a <= st.N; a++) {
      for (c = 1; c <= W2; c++) {
        var B = st.colour[a * stride + c];
        if (!B) continue;
        var vp = B & (B >> 1);
        if (vp) out[c] |= vp | (vp >> 1) | (vp << 2);
        var hp = B & st.colour[a * stride + c + 1];
        if (hp) {
          out[c] |= hp; out[c + 1] |= hp;
          if (c > 1) out[c - 1] |= hp;
          if (c + 2 <= W2) out[c + 2] |= hp;
        }
      }
    }
    return out;
  }

  function swapMasks(st, r, c) {
    var W2 = st.W, b = 1 << (r - 1), o = c + 1;
    if ((st.inert[c] & b) || (st.inert[o] & b)) return false;
    if (st.busy && ((st.busy[c] | st.busy[o]) & b)) return false;      // engine declines
    var stride = W2 + 2, a;
    var left = 0, right = 0;
    for (a = 1; a <= st.N; a++) {
      if (st.colour[a * stride + c] & b) left = a;
      if (st.colour[a * stride + o] & b) right = a;
    }
    st._shape = undefined; st._fire = undefined; st._rest = undefined;   // what was carried with the board
    if (left) { st.colour[left * stride + c] &= ~b; st.colour[left * stride + o] |= b; }
    if (right) { st.colour[right * stride + o] &= ~b; st.colour[right * stride + c] |= b; }
    if (left) st.occ[o] |= b; else st.occ[o] &= ~b;
    if (right) st.occ[c] |= b; else st.occ[c] &= ~b;
    return true;
  }

  function resolveBits(grid, blocks, W, H) {
    return resolveFromMasks(maskState(grid, blocks, W, H));
  }

  function resolveFromMasks(st, wantSettled, timed) {
    var W = st.W, H = st.H, N = st.N;
    if (st.bad) return { scope: st.bad, chain: 0, total: 0, rounds: 0 };
    var S2 = scratch(W, H, Math.max(N, 12));
    var occ = S2.occ, colour = S2.colour, chaining = S2.chaining,
        popping = S2.popping, inert = S2.inert, garb = S2.garb;
    var a, c, stride = W + 2;
    for (c = 0; c <= W + 1; c++) {
      occ[c] = st.occ[c]; inert[c] = st.inert[c]; garb[c] = st.garb[c];
      chaining[c] = timed && timed.chaining ? (timed.chaining[c] | 0) & occ[c] : 0;
      popping[c] = timed && timed.popping ? (timed.popping[c] | 0) & occ[c] : 0;
    }
    for (a = 1; a <= N; a++) {
      for (c = 0; c <= W + 1; c++) colour[a][c] = st.colour[a * stride + c];
    }

    var slabs = [], air = [];
    for (var si0 = 0; si0 < st.slabs.length; si0++) {
      slabs.push(Int32Array.from(st.slabs[si0]));
      air.push(timed && st.slabAir ? (st.slabAir[si0] || 0) : 0);
    }
    var fallingScratch = [];
    function slabsThatFall() {
      var falling = fallingScratch, moved = true, pass = 0;
      falling.length = slabs.length;
      for (var f0 = 0; f0 < slabs.length; f0++) falling[f0] = false;
      while (moved && pass++ <= slabs.length + 1) {
        moved = false;
        for (var si = 0; si < slabs.length; si++) {
          if (falling[si]) continue;
          if (locked[si]) continue;
          var sm2 = slabs[si], held = false;
          for (var cc3 = 1; cc3 <= W && !held; cc3++) {
            if (!sm2[cc3]) continue;
            var lowBit = sm2[cc3] & -sm2[cc3];
            if (lowBit === 1) { held = true; break; }          // on the floor
            var under = lowBit >> 1;
            if (!(occ[cc3] & under)) continue;                 // nothing below
            var owner = -1;
            for (var sj = 0; sj < slabs.length; sj++) if (slabs[sj][cc3] & under) owner = sj;
            if (owner >= 0 && falling[owner]) continue;        // falling too
            held = true;
          }
          if (!held) { falling[si] = true; moved = true; }
        }
      }
      return falling;
    }

    var locked = st.slabLocked || [];
    function lowestRow(m) {
      var lo = 32;
      for (var c0 = 1; c0 <= W; c0++) {
        var v = m[c0] >>> 0;
        if (v) { var b0 = 32 - Math.clz32(v & -v); if (b0 < lo) lo = b0; }
      }
      return lo;
    }
    function nextTo(a, b) {          // any cell of b 4-adjacent to any cell of a
      for (var c1 = 1; c1 <= W; c1++) {
        if (b[c1] & ((a[c1] >> 1) | (a[c1] << 1) | a[c1 - 1] | a[c1 + 1])) return true;
      }
      return false;
    }
    function connectedGroup(k, run) {
      var inGroup = [], any = false, sl, sk;
      function eligible(i) { return !locked[i] && lowestRow(slabs[i]) <= H && run >= air[i]; }
      for (sl = 0; sl < slabs.length; sl++) {
        inGroup[sl] = eligible(sl) && nextTo(k, slabs[sl]);
        if (inGroup[sl]) any = true;
      }
      for (var grew = any; grew; ) {
        grew = false;
        for (sl = 0; sl < slabs.length; sl++) {
          if (inGroup[sl] || !eligible(sl)) continue;
          for (sk = 0; sk < slabs.length; sk++) {
            if (inGroup[sk] && nextTo(slabs[sk], slabs[sl])) { inGroup[sl] = true; grew = true; break; }
          }
        }
      }
      return { inGroup: inGroup, any: any };
    }

    var rest = S2.rest;
    function restingOf() {
      for (var cc2 = 1; cc2 <= W; cc2++) {
        var o = occ[cc2];
        var lowestZero = (~o) & (o + 1);
        var m = o & (lowestZero - 1);
        var seeds = inert[cc2] & ~m;
        while (seeds) {
          var seed = seeds & -seeds;
          var run = seed, probe = seed;
          while ((probe <<= 1) && (o & probe)) run |= probe;
          m |= run;
          seeds &= ~run;
        }
        rest[cc2] = m;
      }
      return rest;
    }

    var counter = 0, rounds = 0, total = 0, guard = 0, LIMIT = W * H * H;
    var T = 0, sweepAt = (timed && timed.popAt) || 0, hoverUntil = 0, made = !timed || !timed.swap, refused = false, moved = false;
    var holds = [];
    function held(c7) { var h7 = 0; for (var i7 = 0; i7 < holds.length; i7++) h7 |= holds[i7].m[c7]; return h7; }
    function nextRelease() { var u7 = Infinity; for (var i7 = 0; i7 < holds.length; i7++) u7 = Math.min(u7, holds[i7].until); return u7; }
    function release() {
      var any7 = false;
      for (var i7 = 0; i7 < holds.length; i7++) {
        var h8 = holds[i7];
        if (T < h8.until - 1) continue;
        holds.splice(i7, 1); i7--; any7 = true;
        if (!h8.swap) continue;
        var again = new Int32Array(W + 2), anyAgain = false;
        for (var c8 = 1; c8 <= W; c8++) {
          var air = h8.m[c8] & ~(occ[c8] << 1) & ~1;
          if (air) { again[c8] = air; anyAgain = true; }
        }
        if (anyAgain) holds.push({ m: again, until: h8.until + timed.frames.HOVER, swap: false });
      }
      if (any7) moved = true;
      return any7;
    }
    function hoverMask() {
      var hv = hovering(), out9 = [];
      for (var c9 = 0; c9 <= W + 1; c9++) out9[c9] = (T < hoverUntil ? (hv[c9] | 0) : 0);
      for (var i9 = 0; i9 < holds.length; i9++) if (!holds[i9].swap) for (c9 = 1; c9 <= W; c9++) out9[c9] |= holds[i9].m[c9];
      return out9;
    }
    function hovering() {
      var hv = [];
      for (var c4 = 1; c4 <= W; c4++) {
        var hole4 = (~occ[c4]) & (occ[c4] + 1), above4 = ~((hole4 << 1) - 1);
        var block4 = (inert[c4] | popping[c4]) & above4, ceil4 = block4 & -block4;
        hv[c4] = occ[c4] & above4 & (ceil4 ? (ceil4 - 1) : ~0);
      }
      hv[0] = 0; hv[W + 1] = 0;
      return hv;
    }
    function makeSwap(hv) {
      made = true;
      var r5 = timed.swap[0], c5 = timed.swap[1], b5 = 1 << (r5 - 1), d5 = c5 + 1;
      if ((popping[c5] | popping[d5] | inert[c5] | inert[d5]) & b5) { refused = true; return; }
      if (!((occ[c5] | occ[d5]) & b5)) { refused = true; return; }
      if (hv && ((hv[c5] | hv[d5]) & (b5 | (b5 << 1)))) { refused = true; return; }
      function trade(arr) {
        var x = (arr[c5] & b5) ? 1 : 0, y = (arr[d5] & b5) ? 1 : 0;
        if (x === y) return;
        arr[c5] ^= b5; arr[d5] ^= b5;
      }
      trade(occ); trade(chaining);
      for (var a5 = 1; a5 <= N; a5++) trade(colour[a5]);
      var sm5 = new Int32Array(W + 2);
      sm5[c5] = occ[c5] & b5; sm5[d5] = occ[d5] & b5;
      holds.push({ m: sm5, until: T + 4, swap: true });
    }
    if (timed && timed.hovering && timed.hover > 0) {
      var hm = new Int32Array(W + 2);
      for (c = 1; c <= W; c++) hm[c] = (timed.hovering[c] | 0) & occ[c];
      holds.push({ m: hm, until: timed.hover, swap: false });
    }
    while (guard++ <= LIMIT) {
      if (refused) return { scope: 'refused', chain: 0, total: 0, rounds: 0, frames: T };
      if (timed) {
        if (!made && T >= timed.at && timed.at < nextRelease() - 1) { makeSwap(hoverMask()); if (refused) continue; }
        release();
        if (!made && T >= timed.at) { makeSwap(hoverMask()); if (refused) continue; }
      }
      var rest = restingOf(), k = S2.k, link = false, any = false;
      var B = S2.B, free = S2.free;
      for (c = 1; c <= W; c++) free[c] = rest[c] & ~popping[c] & ~inert[c] & (timed ? ~held(c) : ~0);
      for (a = 1; a <= N; a++) {
        var Ba = B[a], ca = colour[a];
        for (c = 1; c <= W; c++) Ba[c] = ca[c] & free[c];
      }
      for (c = 0; c <= W + 1; c++) k[c] = 0;
      for (a = 1; a <= N; a++) {
        for (c = 1; c <= W; c++) {
          var bb2 = B[a][c], cv = bb2 & (bb2 >> 1) & (bb2 >> 2);
          k[c] |= cv | (cv << 1) | (cv << 2);
        }
        for (c = 1; c + 2 <= W; c++) {
          var hc = B[a][c] & B[a][c + 1] & B[a][c + 2];
          k[c] |= hc; k[c + 1] |= hc; k[c + 2] |= hc;
        }
      }
      for (c = 1; c <= W; c++) { if (k[c]) any = true; if (k[c] & chaining[c]) link = true; }
      if (timed) for (c = 1; c <= W; c++) chaining[c] &= ~(rest[c] & ~k[c] & ~popping[c] & ~inert[c] & ~held(c));

      if (any) {
        rounds++;
        if (link) counter = counter === 0 ? 2 : counter + 1;
        if (timed) {
          var size = 0;
          for (c = 1; c <= W; c++) size += popcount(k[c]);
          var f6 = timed.frames;
          var mRun = T + (moved ? 2 : 1);
          sweepAt = Math.max(sweepAt, mRun + f6.FLASH + f6.FACE + f6.POP * size);
        }
        var brokeGarbage = false;
        for (c = 1; c <= W; c++) {
          total += popcount(k[c]);
          popping[c] |= k[c];
          if (k[c] & ((garb[c] >> 1) | (garb[c] << 1) | garb[c - 1] | garb[c + 1])) brokeGarbage = true;
        }
        var group = brokeGarbage && slabs.length ? connectedGroup(k, T + (moved ? 2 : 1)) : null;
        if (group && !group.any) brokeGarbage = false;
        if (brokeGarbage) {
          var touched = 0, converts = 0, convCol = [];
          var inGroup = group ? group.inGroup : [], sl, cc;
          for (sl = 0; sl < slabs.length; sl++) {
            var sm2 = slabs[sl], hit = !!inGroup[sl];
            if (hit) {
              for (cc = 1; cc <= W; cc++) touched += popcount(sm2[cc]);
              var low = 32, lm;
              for (cc = 1; cc <= W; cc++) {
                lm = sm2[cc] >>> 0;
                if (!lm) continue;
                var lb = 32 - Math.clz32(lm & -lm);
                if (lb < low) low = lb;
              }
              if (low < 32) {
                var lowBit = 1 << (low - 1);
                for (cc = 1; cc <= W; cc++) if (sm2[cc] & lowBit) { converts++; convCol[cc] = 1; }
              }
            }
          }
          var hMax = 0, hs = [], vAfter = 0;
          for (cc = 1; cc <= W; cc++) {
            var gc = garb[cc] >>> 0, fl = gc ? (gc & -gc) : 0;
            var under = (occ[cc] & ~gc & ~popping[cc] & (fl ? fl - 1 : 0xffffffff)) >>> 0;
            hs[cc] = popcount(under) + (convCol[cc] || 0);
            if (convCol[cc] && hs[cc] > hMax) hMax = hs[cc];
          }
          for (cc = 1; cc <= W; cc++) if (convCol[cc]) vAfter += hMax - hs[cc];
          return { scope: 'garbage-broke', chain: Math.max(counter, 1),
                   total: total, rounds: rounds, garbage: touched,
                   converts: converts, frames: T, voidAfter: vAfter };
        }
        continue;
      }

      var fell = false;
      for (c = 1; c <= W; c++) {
        var o2 = occ[c], fixed = (inert[c] | popping[c] | (timed ? held(c) : 0)) & o2;
        var holds2 = o2 & (((~o2) & (o2 + 1)) - 1), seeds2 = fixed & ~holds2;
        while (seeds2) {
          var sd = seeds2 & -seeds2, x2 = o2 & ~(sd - 1), run2 = x2 & ~(x2 + sd);
          holds2 |= run2;
          seeds2 &= ~run2;
        }
        var movable = o2 & ~holds2;
        if (!movable) continue;
        fell = true;
        var keepPut = occ[c] & ~movable;
        for (a = 1; a <= N; a++) {
          colour[a][c] = (colour[a][c] & keepPut) | ((colour[a][c] & movable) >>> 1);
        }
        chaining[c] = (chaining[c] & keepPut) | ((chaining[c] & movable) >>> 1);
        occ[c] = keepPut | (movable >>> 1);
      }
      var slabFell = slabsThatFall();
      for (var sk = 0; sk < slabs.length; sk++) {
        if (!slabFell[sk]) continue;
        fell = true;
        for (c = 1; c <= W; c++) {
          var sb = slabs[sk][c];
          if (!sb) continue;
          occ[c] &= ~sb; inert[c] &= ~sb; garb[c] &= ~sb;
          slabs[sk][c] = sb >> 1;
          occ[c] |= slabs[sk][c]; inert[c] |= slabs[sk][c]; garb[c] |= slabs[sk][c];
        }
      }
      if (fell) {
        if (timed && T < hoverUntil - 1) T = hoverUntil - 1;
        T++;
        for (sk = 0; sk < slabs.length; sk++) if (slabFell[sk]) air[sk] = T + 2;
        moved = true; continue;
      }
      moved = false;

      var anyPopping = false;
      for (c = 1; c <= W; c++) if (popping[c]) { anyPopping = true; break; }
      if (timed && anyPopping) {
        var nr = nextRelease() - 1;
        if (!made && timed.at < sweepAt && timed.at <= nr) { T = Math.max(T, timed.at); makeSwap(hoverMask()); continue; }
        if (nr < sweepAt) { T = Math.max(T, nr); continue; }
        T = Math.max(T, sweepAt);
      }
      var swept = false;
      for (c = 1; c <= W; c++) {
        if (!popping[c]) continue;
        swept = true;
        var lowest = popping[c] & -popping[c];
        var keep = occ[c] & ~popping[c];
        chaining[c] = (chaining[c] | (keep & ~(lowest - 1))) & keep;
        for (a = 1; a <= N; a++) colour[a][c] &= keep;
        inert[c] &= keep;
        occ[c] = keep;
        popping[c] = 0;
      }
      if (swept) {
        if (timed) {
          hoverUntil = T + timed.frames.HOVER;
          if (!made && timed.at <= hoverUntil && timed.at < nextRelease() - 1) { T = Math.max(T, timed.at); makeSwap(hoverMask()); }
        }
        continue;
      }
      if (timed && holds.length) { T = Math.max(T, nextRelease() - 1); continue; }
      if (timed && !made) { T = Math.max(T, timed.at, hoverUntil); makeSwap(hoverMask()); if (!refused) continue; }
      if (refused) return { scope: 'refused', chain: 0, total: 0, rounds: 0, frames: T };
      break;
    }
    return { scope: 'ok', chain: rounds ? Math.max(counter, 1) : 0, total: total,
             rounds: rounds, frames: T,
             settled: wantSettled ? settledFrom(S2, W, H, N, slabs, locked) : null };
  }

  function settledFrom(S, W, H, N, slabs, locked) {
    var stride = W + 2, out = { W: W, H: H, N: N, occ: [], inert: [], garb: [],
                                colour: new Int32Array((N + 1) * stride), slabs: [],
                                slabLocked: [], bad: null };
    var a, c, i;
    for (c = 0; c <= W + 1; c++) {
      out.occ[c] = S.occ[c]; out.inert[c] = S.inert[c]; out.garb[c] = S.garb[c];
    }
    for (a = 1; a <= N; a++) for (c = 0; c <= W + 1; c++) out.colour[a * stride + c] = S.colour[a][c];
    for (i = 0; slabs && i < slabs.length; i++) {
      var any = false;
      for (c = 0; c <= W + 1; c++) if (slabs[i][c]) { any = true; break; }
      if (any) { out.slabs.push(Int32Array.from(slabs[i])); out.slabLocked.push(!!(locked && locked[i])); }
    }
    return out;
  }

  var api = {
    popcount: popcount,
    topColour: topColour,
    restingMask: restingMask,
    colourMasks: colourMasks,
    clears: clears,
    maskState: maskState,
    swapMasks: swapMasks,
    legalSwapsOf: legalSwapsOf,
    anyOneSwapClear: anyOneSwapClear, swapCanClear: swapCanClear, atRest: atRest,
    bestOneSwapStop: bestOneSwapStop,
    reachMask: reachMask,
    copyState: copyState,
    risenMasks: risenMasks,
    resolveFromMasks: resolveFromMasks,
    clearedCells: clearedCells,
    resolveBits: resolveBits,
    settledFrom: settledFrom
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BitMatch = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
