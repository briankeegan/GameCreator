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
  var WMAX, NCOL, MAXSLAB, OCC, INERT, GARB, BUSY, COL, SLAB, SL, ST_INTS, R_INTS, REC, MAXD, TIMED = 0;
  var ex = null, mem = null, dmem = null, MEMORY = null, IN = 0, OUT = 0, LIST = 0, ODATA = 0, LANDS = 0, PARAM = 0, PCHAIN = 0, PCOMBO = 0;
  var WORKER_SRC = [
    "var wt = require('worker_threads'), d = wt.workerData;",
    "var X = new WebAssembly.Instance(d.mod, { env: { memory: d.mem } }).exports;",
    "X.__stack_pointer.value = d.sp;",
    "X.bit_thread_init(d.id);",
    "X.bit_worker_loop();"
  ].join('\n');
  function threads() {
    var v = typeof process !== 'undefined' && process.env && process.env.GC_BOT_THREADS;
    return v !== undefined && v !== '' ? Math.max(1, Number(v) | 0) : 1;
  }
  function loadThreaded(bytes, n) {
    var wt = require('worker_threads'), mod = new WebAssembly.Module(bytes);
    MEMORY = new WebAssembly.Memory({ initial: 16384, maximum: 65536, shared: true });
    ex = new WebAssembly.Instance(mod, { env: { memory: MEMORY } }).exports;
    ex.bit_thread_init(0);
    var STACK = 1 << 20;
    for (var k = 1; k < n; k++) {
      var sp = ex.bit_grab(STACK) >>> 0;
      if (!sp) throw new Error('bitnative: no memory for a thread');
      var w = new wt.Worker(WORKER_SRC, { eval: true, workerData: { mod: mod, mem: MEMORY, id: k, sp: sp + STACK } });
      w.unref();
      w.on('error', function (e) { console.error('bitnative worker: ' + (e && e.stack || e)); });
    }
    var nap = new Int32Array(new SharedArrayBuffer(4)), t0 = Date.now();
    while (ex.bit_workers() < n - 1) {
      if (Date.now() - t0 > 60000) throw new Error('bitnative: workers did not start');
      Atomics.wait(nap, 0, 0, 2);
    }
  }
  function load(bytes, n) {
    if (n > 1) loadThreaded(bytes, n);
    else { ex = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: {} }).exports; MEMORY = ex.memory; }
    var L = []; for (var i = 0; i < 15; i++) L.push(ex.bit_layout(i));
    WMAX = L[0]; NCOL = L[1]; MAXSLAB = L[2]; OCC = L[3]; INERT = L[4]; GARB = L[5]; BUSY = L[6]; COL = L[7];
    SLAB = L[8]; SL = L[9]; ST_INTS = L[10]; R_INTS = L[11]; REC = L[12]; MAXD = L[13];
    TIMED = ex.bit_timed() >> 2;
    IN = ex.bit_in() >> 2; OUT = ex.bit_out() >> 2; LIST = ex.bit_list() >> 2; LANDS = ex.bit_lands() >> 2;
    ODATA = ex.bit_odata() >> 3; PARAM = ex.bit_param() >> 3; PCHAIN = ex.bit_pchain() >> 3; PCOMBO = ex.bit_pcombo() >> 3;
    mem = dmem = null;
  }
  if (fs) {
    var nThreads = threads();
    load(fs.readFileSync(path.join(__dirname, 'native', nThreads > 1 ? 'bit-mt.wasm' : 'bit.wasm')), nThreads);
  }
  function heap() { if (!mem || mem.buffer !== MEMORY.buffer) mem = new Int32Array(MEMORY.buffer); return mem; }
  function dheap() { if (!dmem || dmem.buffer !== MEMORY.buffer) dmem = new Float64Array(MEMORY.buffer); return dmem; }
  function fits(st) {
    return st.W <= 6 && st.N < NCOL && (!st.slabs || st.slabs.length <= MAXSLAB);
  }
  function put(st) { putAt(IN, st); }
  function putAt(b, st) {
    if (!fits(st)) throw new Error('bitnative: board exceeds the native layout');
    var m = heap(), c, a, i, stride = st.W + 2;
    m.fill(0, b, b + ST_INTS);
    m[b] = st.W; m[b + 1] = st.H; m[b + 2] = st.N; m[b + 3] = st.slabs ? st.slabs.length : 0;
    m[b + 4] = st.busy ? 1 : 0; m[b + 5] = st.bad ? 1 : 0;
    for (c = 0; c <= st.W + 1; c++) {
      m[b + OCC + c] = st.occ[c]; m[b + INERT + c] = st.inert[c]; m[b + GARB + c] = st.garb[c];
      if (st.busy) m[b + BUSY + c] = st.busy[c] | 0;
      for (a = 1; a <= st.N; a++) m[b + COL + a * WMAX + c] = st.colour[a * stride + c];
    }
    for (i = 0; st.slabs && i < st.slabs.length; i++) {
      for (c = 0; c <= st.W + 1; c++) m[b + SLAB + i * SL + c] = st.slabs[i][c] | 0;
      m[b + SLAB + i * SL + WMAX] = st.slabLocked && st.slabLocked[i] ? 1 : 0;
      m[b + SLAB + i * SL + WMAX + 1] = st.slabAir ? (st.slabAir[i] || 0) : 0;
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
      for (c = 0; c <= W + 1; c++) sm[c] = m[b + SLAB + i * SL + c];
      out.slabs.push(sm); out.slabLocked.push(!!m[b + SLAB + i * SL + WMAX]);
    }
    return out;
  }
  function result(st, wantSettled) {
    var m = heap(), o = OUT, scope = m[o];
    if (scope === 2) return { scope: st.bad, chain: 0, total: 0, rounds: 0 };
    if (scope === 3) return { scope: 'refused', chain: 0, total: 0, rounds: 0, frames: m[o + 4] };
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
  function putTimed(t, W) {
    var m = heap(), b = TIMED, c, f = t.frames;
    m[b] = t.popAt || 0; m[b + 1] = t.hover > 0 ? t.hover : 0; m[b + 2] = t.swap ? 1 : 0;
    m[b + 3] = t.swap ? t.swap[0] : 0; m[b + 4] = t.swap ? t.swap[1] : 0; m[b + 5] = t.at || 0;
    m[b + 6] = f.HOVER; m[b + 7] = f.FLASH; m[b + 8] = f.FACE; m[b + 9] = f.POP;
    for (c = 0; c < WMAX; c++) {
      m[b + 10 + c] = c <= W + 1 && t.chaining ? t.chaining[c] | 0 : 0;
      m[b + 10 + WMAX + c] = c <= W + 1 && t.popping ? t.popping[c] | 0 : 0;
      m[b + 10 + 2 * WMAX + c] = c <= W + 1 && t.hovering ? t.hovering[c] | 0 : 0;
    }
  }
  function resolveTimed(st, wantSettled, t) {
    put(st);
    putTimed(t, st.W);
    if (ex.bit_resolve_timed(wantSettled ? 1 : 0) !== 0) throw new Error('bitnative.resolveTimed: a fixed size was exceeded');
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

  var STOPIDS = { top: 1, free: 2 }, nStopIds = 2, priceKey = null;
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
    if (stopPrice) { prices(stopPrice, stopKey); ex.bit_price_dirty(); }
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
  function botNew(tab) {
    var id = ex.bot_new();
    if (id < 0) throw new Error('bitnative: too many bots');
    var d = dheap(), b = ex.bot_tab(id) >> 3;
    for (var i = 0; i < tab.length; i++) d[b + i] = tab[i];
    return id;
  }
  function botIn() { return { d: dheap(), at: ex.bot_in() >> 3 }; }
  function botStates(base, risen, tmst, timed) {
    putAt(IN, base);
    if (risen) putAt(ex.bot_risen() >> 2, risen);
    if (tmst) { putAt(ex.bot_tmst() >> 2, tmst); putTimed(timed, tmst.W); }
  }
  var TAPE = null;
  function region(at, bytes) { return new Uint8Array(MEMORY.buffer, at, bytes).slice(); }
  function regions(id) {
    return [[ex.bot_in(), 600 * 8], [IN * 4, ST_INTS * 4], [ex.bot_risen(), ST_INTS * 4], [ex.bot_tmst(), ST_INTS * 4],
            [ex.bit_timed(), 64 * 4], [ex.bot_state(id), ex.bot_state_size()]];
  }
  function record(on) { TAPE = on ? [] : null; }
  function recorded() { return TAPE; }
  function replay(id, rec) {
    var rg = regions(id), m = new Uint8Array(MEMORY.buffer);
    for (var i = 0; i < rg.length; i++) m.set(rec[i], rg[i][0]);
    return ex.bot_decide(id);
  }
  function botDecide(id) {
    if (TAPE) TAPE.push(regions(id).map(function (r) { return region(r[0], r[1]); }));
    var r = ex.bot_decide(id);
    priceKey = null;
    if (r !== 0) throw new Error('bitnative.botDecide: a fixed size was exceeded');
    return { d: dheap(), out: ex.bot_out() >> 3, counts: ex.bot_counts(id) >> 3 };
  }
  function botTab(id) { return { d: dheap(), at: ex.bot_tab(id) >> 3 }; }
  function botPut(which, st) { putAt(which === 'risen' ? ex.bot_risen() >> 2 : IN, st); }
  function botTest(id, fn) {
    var v = ex.bot_test(id, fn);
    return { v: v, d: dheap(), out: ex.bot_out() >> 3 };
  }
  function botPoolMasks(i, bad) { return take(ex.bot_pool(i) >> 2, bad); }
  function deadlyCalls() { return ex.bot_deadly_calls(); }
  function opening(id, set) { return ex.bot_opening(id, set === undefined ? -1 : (set ? 1 : 0)); }
  function nn(v) { return v === null || v === undefined ? NaN : Number(v); }
  function putRecords(list) {
    var d = dheap(), base = ODATA + 64 + 4 * REC, i, j;
    for (i = 0; i < list.length; i++) {
      var o = list[i], b = base + i * REC, sw = o.swaps || [];
      d.fill(0, b, b + REC);
      d[b + F.KIND] = o.kind === 'chain' ? 1 : 0; d[b + F.SIZE] = o.size || 0; d[b + F.FRAMES] = o.frames || 0;
      d[b + F.CHAIN] = o.chain || 0; d[b + F.TOTAL] = o.total || 0; d[b + F.GARBAGE] = o.garbage || 0;
      d[b + F.CONVERTS] = o.converts || 0; d[b + F.VOID] = o.voidAfter || 0; d[b + F.DURATION] = o.duration || 0;
      d[b + F.TALL] = nn(o.tall); d[b + F.BUMPS] = nn(o.bumps); d[b + F.MAT] = nn(o.mat); d[b + F.LOW] = nn(o.low);
      d[b + F.SPREAD] = nn(o.spread); d[b + F.VOIDROWS] = nn(o.voidRows); d[b + F.SLABGAP] = nn(o.slabGap);
      d[b + F.HASSHAPE] = o.tall !== null && o.tall !== undefined ? 1 : 0;
      d[b + F.BREAKS] = o.breaks ? 1 : 0; d[b + F.LEVELS] = o.levels ? 1 : 0; d[b + F.OPENSHOLE] = o.opensHole ? 1 : 0;
      d[b + F.EXTRAS] = 1;
      d[b + F.BREAKREADY] = o.breakReady === true ? 1 : o.breakReady === false ? 0 : -1;
      d[b + F.CLOSESBREAK] = o.closesBreak ? 1 : 0; d[b + F.DIGGAIN] = o.digGain || 0; d[b + F.VOIDGAIN] = o.voidGain || 0;
      d[b + F.SLABGAIN] = o.slabGain || 0; d[b + F.SLABWORTH] = o.slabWorth || 0; d[b + F.MATNOW] = nn(o.matNow);
      d[b + F.NSW] = Math.min(sw.length, MAXD);
      for (j = 0; j < sw.length && j < MAXD; j++) { d[b + F.SW + 2 * j] = sw[j][0]; d[b + F.SW + 2 * j + 1] = sw[j][1]; }
    }
  }
  function checkbf(st) { put(st); return ex.bit_checkbf(); }
  return { record: record, recorded: recorded, replay: replay, _checkbf: checkbf, fits: fits, resolve: resolve, resolveTimed: resolveTimed, scan: scan, load: load, options: options,
           botNew: botNew, botIn: botIn, botStates: botStates, botDecide: botDecide, botTab: botTab, botPut: botPut, botTest: botTest,
           botPoolMasks: botPoolMasks, deadlyCalls: deadlyCalls, opening: opening, putRecords: putRecords };
}));
