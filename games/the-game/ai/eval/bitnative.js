(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('fs'), require('path'));
  else root.BitNative = factory(null, null);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (fs, path) {
  'use strict';
  var SCOPES = ['ok', 'garbage-broke'];
  var F = {}, FIELDS = ['KIND', 'SIZE', 'FRAMES', 'CHAIN', 'TOTAL', 'GARBAGE', 'CONVERTS', 'VOID', 'DURATION', 'HASSHAPE',
    'TALL', 'BUMPS', 'MAT', 'LOW', 'SPREAD', 'VOIDROWS', 'SLABGAP', 'READY', 'BREAKS', 'LEVELS', 'OPENSHOLE',
    'EXTRAS', 'BREAKREADY', 'CLOSESBREAK', 'DIGGAIN', 'VOIDGAIN', 'SLABGAIN', 'SLABWORTH', 'MATNOW',
    'VALUE', 'WAYS', 'LANDSTOP', 'NSW', 'SW'];
  FIELDS.forEach(function (n, i) { F[n] = i; });
  var WMAX, NCOL, MAXSLAB, OCC, INERT, GARB, BUSY, COL, SLAB, LOCK, ST_INTS, R_INTS, REC, MAXD;
  var ex = null, mem = null, dmem = null, IN = 0, OUT = 0, LIST = 0, ODATA = 0, LANDS = 0, PARAM = 0, PCHAIN = 0, PCOMBO = 0;
  function load(bytes) {
    var inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: {} });
    ex = inst.exports;
    var L = []; for (var i = 0; i < 14; i++) L.push(ex.bit_layout(i));
    WMAX = L[0]; NCOL = L[1]; MAXSLAB = L[2]; OCC = L[3]; INERT = L[4]; GARB = L[5]; BUSY = L[6]; COL = L[7];
    SLAB = L[8]; LOCK = L[9]; ST_INTS = L[10]; R_INTS = L[11]; REC = L[12]; MAXD = L[13];
    IN = ex.bit_in() >> 2; OUT = ex.bit_out() >> 2; LIST = ex.bit_list() >> 2; LANDS = ex.bit_lands() >> 2;
    ODATA = ex.bit_odata() >> 3; PARAM = ex.bit_param() >> 3; PCHAIN = ex.bit_pchain() >> 3; PCOMBO = ex.bit_pcombo() >> 3;
    mem = dmem = null;
  }
  if (fs) load(fs.readFileSync(path.join(__dirname, 'native', 'bit.wasm')));
  function heap() { if (!mem || mem.buffer !== ex.memory.buffer) mem = new Int32Array(ex.memory.buffer); return mem; }
  function dheap() { if (!dmem || dmem.buffer !== ex.memory.buffer) dmem = new Float64Array(ex.memory.buffer); return dmem; }
  function fits(st) {
    return st.W <= 6 && st.N < NCOL && (!st.slabs || st.slabs.length <= MAXSLAB);
  }
  function put(st) {
    if (!fits(st)) throw new Error('bitnative: board exceeds the native layout');
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
  function take(b, bad) {
    var m = heap(), W = m[b], H = m[b + 1], N = m[b + 2], stride = W + 2, c, a, i;
    var out = { W: W, H: H, N: N, occ: [], inert: [], garb: [], colour: new Int32Array((N + 1) * stride), slabs: [],
                slabLocked: [], bad: bad || null };
    if (m[b + 4]) out.busy = new Int32Array(W + 2);
    for (c = 0; c <= W + 1; c++) {
      out.occ[c] = m[b + OCC + c]; out.inert[c] = m[b + INERT + c]; out.garb[c] = m[b + GARB + c];
      if (out.busy) out.busy[c] = m[b + BUSY + c];
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
             settled: wantSettled ? take(o + R_INTS, st.bad) : null };
  }
  function resolve(st, wantSettled) {
    put(st);
    ex.bit_resolve(wantSettled ? 1 : 0);
    return result(st, wantSettled);
  }
  function scan(st) {
    var m, out = [], i, legal = [];
    put(st);
    var nl = ex.bit_legal(); m = heap();
    for (i = 0; i < nl; i++) legal.push([m[LIST + 2 * i], m[LIST + 2 * i + 1]]);
    put(st);
    var n = ex.bit_scan(); m = heap();
    for (i = 0; i < n; i++) {
      var sc = m[LIST + 3 * i + 2];
      out.push({ r: legal[i][0], c: legal[i][1], chain: m[LIST + 3 * i], total: m[LIST + 3 * i + 1],
                 scope: sc < 0 ? null : (SCOPES[sc] || st.bad) });
    }
    return out;
  }

  var STOPIDS = {}, nStopIds = 0, priceKey = null;
  function prices(stopPrice, stopKey) {
    var d = dheap(), i;
    if (stopKey && priceKey === stopKey) return;
    for (i = 0; i < 64; i++) d[PCHAIN + i] = i >= 2 ? (stopPrice({ chain: i, total: 3 }) || 0) : 0;
    for (i = 0; i < 256; i++) d[PCOMBO + i] = stopPrice({ chain: 1, total: i }) || 0;
    priceKey = stopKey || null;
  }
  function swapsOf(o, b) {
    var n = o[b + F.NSW], out = [], i;
    for (i = 0; i < n; i++) out.push([o[b + F.SW + 2 * i], o[b + F.SW + 2 * i + 1]]);
    return out;
  }
  function optionAt(d, b) {
    var has = d[b + F.HASSHAPE] === 1, chain = d[b + F.CHAIN], rd = d[b + F.READY];
    var o = { kind: d[b + F.KIND] ? 'chain' : 'combo', size: d[b + F.SIZE],
              swaps: swapsOf(d, b), frames: d[b + F.FRAMES], chain: chain, total: d[b + F.TOTAL],
              garbage: d[b + F.GARBAGE], converts: d[b + F.CONVERTS], voidAfter: d[b + F.VOID],
              duration: d[b + F.DURATION],
              tall: has ? d[b + F.TALL] : null, bumps: has ? d[b + F.BUMPS] : null,
              mat: has ? d[b + F.MAT] : null, low: has ? d[b + F.LOW] : null,
              spread: has ? d[b + F.SPREAD] : null, voidRows: has ? d[b + F.VOIDROWS] : null,
              slabGap: has ? d[b + F.SLABGAP] : null, ready: rd < 0 ? null : rd === 1 };
    o.breaks = d[b + F.BREAKS] === 1;
    o.levels = d[b + F.LEVELS] === 1;
    o.opensHole = d[b + F.OPENSHOLE] === 1;
    if (d[b + F.EXTRAS]) {
      var br = d[b + F.BREAKREADY];
      o.breakReady = br < 0 ? null : br === 1;
      o.closesBreak = d[b + F.CLOSESBREAK] === 1;
      o.digGain = d[b + F.DIGGAIN];
      o.voidGain = d[b + F.VOIDGAIN];
      o.slabGain = d[b + F.SLABGAIN];
      o.slabWorth = d[b + F.SLABWORTH];
      o.matNow = d[b + F.MATNOW];
    }
    return o;
  }
  function recordAt(d, b) {
    return { swaps: swapsOf(d, b), frames: d[b + F.FRAMES], value: d[b + F.VALUE], duration: d[b + F.DURATION] };
  }
  function options(st, cursor, depth, timing, dig, first) {
    var d, i, stopPrice = timing.stopPrice || null, stopKey = timing.stopKey || '';
    var W = st.W, avoid = timing.avoidSwap || [];
    put(st);
    if (stopPrice) prices(stopPrice, stopKey);
    if (stopKey && STOPIDS[stopKey] === undefined) STOPIDS[stopKey] = ++nStopIds;
    var overhead = timing.overhead || 0;
    d = dheap();
    var p = PARAM;
    d[p] = timing.framesPerRow || 0; d[p + 1] = timing.deadline || 0;
    d[p + 2] = timing.lock !== undefined ? timing.lock : Infinity;
    d[p + 3] = timing.spend || 0; d[p + 4] = timing.lean ? 1 : 0; d[p + 5] = timing.prepare ? 1 : 0;
    d[p + 6] = timing.holdWorth || 0; d[p + 7] = timing.workingRows || 0; d[p + 8] = overhead;
    d[p + 9] = overhead || timing.reaction || 0; d[p + 10] = dig ? 1 : 0; d[p + 11] = depth || 0;
    d[p + 12] = cursor[0]; d[p + 13] = cursor[1]; d[p + 14] = timing.press || 0;
    d[p + 15] = stopPrice ? 1 : 0; d[p + 16] = stopKey ? STOPIDS[stopKey] : 0;
    d[p + 17] = stopPrice ? Math.max(stopPrice({ chain: 13, total: 3 }), stopPrice({ chain: 1, total: W * 2 })) : 0;
    d[p + 18] = avoid.length;
    for (i = 0; i < avoid.length && i < 40; i++) { d[p + 19 + 2 * i] = avoid[i][0]; d[p + 20 + 2 * i] = avoid[i][1]; }
    d[p + 100] = 0;
    if (first) {
      var m = heap();
      for (i = 0; i < first.length; i++) { m[LIST + 2 * i] = first[i][0]; m[LIST + 2 * i + 1] = first[i][1]; }
      d[p + 100] = first.length;
    }
    if (ex.bit_options() !== 0) throw new Error('bitnative.options: a fixed size was exceeded');
    d = dheap();
    var o = ODATA, nNow = d[o + 1], nNext = d[o + 2], now = [], next = [], base = o + 64;
    for (i = 0; i < nNow; i++) now.push(optionAt(d, base + (4 + i) * REC));
    for (i = 0; i < nNext; i++) next.push(optionAt(d, base + (4 + nNow + i) * REC));
    var flat = null, save = null, ready = null, trigger = null;
    if (d[o + 7]) {
      var fb = base;
      flat = { swaps: swapsOf(d, fb), frames: d[fb + F.FRAMES], value: d[fb + F.VALUE],
               tall: d[fb + F.TALL], bumps: d[fb + F.BUMPS], ways: d[fb + F.WAYS], duration: d[fb + F.DURATION],
               lands: take(LANDS, st.bad) };
      if (stopPrice) flat.landStop = d[o + 11];
    }
    if (d[o + 8]) save = recordAt(d, base + REC);
    if (d[o + 9]) ready = recordAt(d, base + 2 * REC);
    if (d[o + 10]) trigger = recordAt(d, base + 3 * REC);
    return { now: now, next: next, flatten: flat, save: save, ready: ready, trigger: trigger,
             swapsConsidered: d[o + 5], refused: d[o + 3], unknown: d[o + 4],
             baseBreak: d[o + 6] < 0 ? null : d[o + 6] === 1 };
  }
  return { fits: fits, resolve: resolve, scan: scan, load: load, options: options };
}));
