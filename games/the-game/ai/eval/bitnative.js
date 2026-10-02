(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('fs'), require('path'));
  else root.BitNative = factory(null, null);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (fs, path) {
  'use strict';
  var WMAX = 8, NCOL = 13, MAXSLAB = 64;
  var OCC = 8, INERT = 16, GARB = 24, BUSY = 32, COL = 40, SLAB = COL + NCOL * WMAX, LOCK = SLAB + MAXSLAB * WMAX,
      AIR = LOCK + MAXSLAB, ST_INTS = AIR + MAXSLAB, R_INTS = 8;
  var SCOPES = ['ok', 'garbage-broke'];
  var ex = null, mem = null, IN = 0, OUT = 0, LIST = 0;
  function load(bytes) {
    var inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: {} });
    ex = inst.exports;
    IN = ex.bit_in() >> 2; OUT = ex.bit_out() >> 2; LIST = ex.bit_list() >> 2;
  }
  if (fs) load(fs.readFileSync(path.join(__dirname, 'native', 'bit.wasm')));
  function heap() { if (!mem || mem.buffer !== ex.memory.buffer) mem = new Int32Array(ex.memory.buffer); return mem; }
  function fits(st) {
    return st.W <= 6 && st.N < NCOL && (!st.slabs || st.slabs.length <= MAXSLAB);
  }
  function put(st) {
    var m = heap(), b = IN, c, a, i, stride = st.W + 2;
    m.fill(0, b, b + ST_INTS);
    m[b] = st.W; m[b + 1] = st.H; m[b + 2] = st.N; m[b + 3] = st.slabs ? st.slabs.length : 0;
    m[b + 4] = st.busy ? 1 : 0; m[b + 5] = st.bad ? 1 : 0;
    for (c = 0; c <= st.W + 1; c++) {
      m[b + OCC + c] = st.occ[c]; m[b + INERT + c] = st.inert[c]; m[b + GARB + c] = st.garb[c];
      if (st.busy) m[b + BUSY + c] = st.busy[c] | 0;
      for (a = 1; a <= st.N; a++) m[b + COL + a * WMAX + c] = st.colour[a * stride + c];
    }
    for (i = 0; st.slabs && i < st.slabs.length; i++) {
      for (c = 0; c <= st.W + 1; c++) m[b + SLAB + i * WMAX + c] = st.slabs[i][c] | 0;
      m[b + LOCK + i] = st.slabLocked && st.slabLocked[i] ? 1 : 0;
    }
  }
  function take(b) {
    var m = heap(), W = m[b], H = m[b + 1], N = m[b + 2], stride = W + 2, c, a, i;
    var out = { W: W, H: H, N: N, occ: [], inert: [], garb: [], colour: new Int32Array((N + 1) * stride), slabs: [], slabLocked: [], bad: null };
    for (c = 0; c <= W + 1; c++) {
      out.occ[c] = m[b + OCC + c]; out.inert[c] = m[b + INERT + c]; out.garb[c] = m[b + GARB + c];
      for (a = 1; a <= N; a++) out.colour[a * stride + c] = m[b + COL + a * WMAX + c];
    }
    for (i = 0; i < m[b + 3]; i++) {
      var sm = new Int32Array(W + 2);
      for (c = 0; c <= W + 1; c++) sm[c] = m[b + SLAB + i * WMAX + c];
      out.slabs.push(sm); out.slabLocked.push(!!m[b + LOCK + i]);
    }
    return out;
  }
  function result(st, wantSettled) {
    var m = heap(), o = OUT, scope = m[o];
    if (scope === 2) return { scope: st.bad, chain: 0, total: 0, rounds: 0 };
    if (scope === 1) return { scope: 'garbage-broke', chain: m[o + 1], total: m[o + 2], rounds: m[o + 3], garbage: m[o + 5],
                              converts: m[o + 6], frames: m[o + 4], voidAfter: m[o + 7] };
    return { scope: 'ok', chain: m[o + 1], total: m[o + 2], rounds: m[o + 3], frames: m[o + 4],
             settled: wantSettled ? take(o + R_INTS) : null };
  }
  function resolve(st, wantSettled) {
    put(st);
    ex.bit_resolve(wantSettled ? 1 : 0);
    return result(st, wantSettled);
  }
  function scan(st) {
    put(st);
    var n = ex.bit_scan(), m = heap(), out = [], i;
    var legal = [];
    put(st);
    var nl = ex.bit_legal();
    for (i = 0; i < nl; i++) legal.push([m[LIST + 2 * i], m[LIST + 2 * i + 1]]);
    put(st); n = ex.bit_scan(); m = heap();
    for (i = 0; i < n; i++) {
      var sc = m[LIST + 3 * i + 2];
      out.push({ r: legal[i][0], c: legal[i][1], chain: m[LIST + 3 * i], total: m[LIST + 3 * i + 1],
                 scope: sc < 0 ? null : (SCOPES[sc] || st.bad) });
    }
    return out;
  }
  return { fits: fits, resolve: resolve, scan: scan, load: load };
}));
