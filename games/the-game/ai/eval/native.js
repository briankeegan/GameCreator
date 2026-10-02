// THE ENGINE IN C, from JS. native/engine.c is panel-engine.js ported line
// for line for the search's boards; this file moves a board across and back.
//
// A board goes over as the wire engine.c defines (nb_load / nb_save): a
// float64 head whose field names engine.c itself reports, and an int32 body
// of panels and lists. Only a board the search copied (cloneStack: unseen
// rows and breaks, no rng, countdown over) is taken, and a field whose type
// is not the one the engine gives it is refused, never coerced.
// native.test.js plays the two engines side by side and compares every field
// after every frame.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.PanelEval = root.PanelEval || {}).Native = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var G0 = typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis;
  function PE() { return G0.PanelEngine; }

  var W = 6;
  // panel-engine.js's panel fields, in engine.c's order (faststack.js FIELDS).
  var FIELDS = [
    ['row', 'int'], ['col', 'int'], ['id', 'int'], ['color', 'int'], ['chaining', 'bool'], ['matching', 'bool'],
    ['timer', 'int'], ['initialTime', 'int'], ['popTime', 'int'], ['popIndex', 'int'], ['xOffset', 'nint'],
    ['yOffset', 'nint'], ['gWidth', 'int'], ['gHeight', 'int'], ['shakeTime', 'int'], ['isGarbage', 'bool'],
    ['state', 'state'], ['comboIndex', 'nint'], ['comboSize', 'nint'], ['swapFromLeft', 'nbool'],
    ['dontSwap', 'bool'], ['queuedHover', 'bool'], ['fellFromGarbage', 'int'], ['stateChanged', 'bool'],
    ['propagatesChaining', 'bool'], ['matchAnyway', 'bool'], ['propagatesFalling', 'ubool'], ['garbageId', 'uint']
  ];
  var NF = FIELDS.length;
  var NUL = -2147483648, UND = -2147483647;
  var STATES = ['normal', 'dimmed', 'swapping', 'matched', 'popping', 'popped', 'hovering', 'falling', 'landing'];
  var DIRS = ['up', 'down', 'left', 'right'];
  var INPUT = ['left', 'right', 'up', 'down', 'swap', 'raise'];

  function refuse(what, v) { throw new Error('Native: ' + what + ' = ' + JSON.stringify(v) + ' is not what the engine gives it'); }
  function inn(v, type, k) {
    switch (type) {
      case 'int': if (typeof v === 'number' && (v | 0) === v) return v; break;
      case 'bool': if (v === true || v === false) return v ? 1 : 0; break;
      case 'nint': if (v === null) return NUL; if (typeof v === 'number' && (v | 0) === v) return v; break;
      case 'nbool': if (v === null) return NUL; if (v === true || v === false) return v ? 1 : 0; break;
      case 'ubool': if (v === undefined) return UND; if (v === true || v === false) return v ? 1 : 0; break;
      case 'uint': if (v === undefined) return UND; if (typeof v === 'number' && (v | 0) === v) return v; break;
      case 'state': var s = STATES.indexOf(v); if (s >= 0) return s; break;
    }
    return refuse('panel field ' + k, v);
  }
  function out(v, type) {
    if (type === 'state') return STATES[v];
    if (v === NUL) return null;
    if (v === UND) return undefined;
    if (type === 'bool' || type === 'nbool' || type === 'ubool') return v === 1;
    return v;
  }
  function int(v, k) { if (typeof v === 'number' && (v | 0) === v) return v; return refuse(k, v); }
  function bool(v, k) { if (v === true || v === false) return v ? 1 : 0; return refuse(k, v); }
  function bits(i) { var b = 0; for (var n = 0; n < INPUT.length; n++) if (i[INPUT[n]]) b |= 1 << n; return b; }
  function unbits(b) { var o = {}; for (var n = 0; n < INPUT.length; n++) o[INPUT[n]] = !!(b & (1 << n)); return o; }

  // What each head field is on a Stack: [read, write]. write is null for the
  // level's constants, which a board never changes.
  var INTS = ['panelIdCount', 'speed', 'nextSpeedIncreaseClock', 'clock', 'displacement', 'stopTime', 'preStopTime',
              'shakeTime', 'shakeTimeOnFrame', 'peakShakeTime', 'health', 'chainCounter', 'nActive', 'nPrevActive',
              'swappingCount', 'panelsCleared', 'score', 'curRow', 'curCol', 'topCurRow', 'queuedSwapRow', 'queuedSwapCol',
              'garbageCreatedCount', 'highestGarbageIdMatched', 'cursorTimer', 'unseenRows', 'unseenBreaks'];
  var BOOLS = ['riseLock', 'hasRisen', 'manualRaise', 'manualRaiseYet', 'preventManualRaise', 'wasToppedOut', 'gameOver',
               'stopWatchIsRunning'];
  var LEVEL = { colors: 'colors', maxHealth: 'maxHealth', height: 'height' };
  var FRAMES = { fHOVER: 'HOVER', fGARBAGE_HOVER: 'GARBAGE_HOVER', fFLASH: 'FLASH', fFACE: 'FACE', fPOP: 'POP' };
  var STOP = { sComboConstant: 'comboConstant', sChainConstant: 'chainConstant', sDangerConstant: 'dangerConstant',
               sCoefficient: 'coefficient', sDangerCoefficient: 'dangerCoefficient' };
  var CHAIN = { 'chain.width': 'width', 'chain.height': 'height', 'chain.isChain': 'isChain', 'chain.frameEarned': 'frameEarned',
                'chain.finalized': 'finalized' };
  function field(name) {
    if (name === 'riseTimer') return [function (s) { if (typeof s.riseTimer !== 'number') refuse('riseTimer', s.riseTimer); return s.riseTimer; },
                                      function (s, v) { s.riseTimer = v; }];
    if (name === 'nrows') return [function (s) { return s.panels.length; }, null];
    if (LEVEL[name]) return [function (s) { return int(s[LEVEL[name]], name); }, null];
    if (FRAMES[name]) return [function (s) { return int(s.frames[FRAMES[name]], name); }, null];
    if (STOP[name]) return [function (s) { return int(s.levelData.stop[STOP[name]], name); }, null];
    if (INTS.indexOf(name) >= 0) return [function (s) { return int(s[name], name); }, function (s, v) { s[name] = v; }];
    if (BOOLS.indexOf(name) >= 0) return [function (s) { return bool(s[name], name); }, function (s, v) { s[name] = v === 1; }];
    switch (name) {
      case 'animatingCursor':
        return [function (s) { return bool(s.animatingCursorDuringCountdown, name); }, function (s, v) { s.animatingCursorDuringCountdown = v === 1; }];
      case 'cursorDirection':
        return [function (s) {
          var d = s.cursorDirection;
          if (d === undefined) return -2;
          if (d === null) return -1;
          var i = DIRS.indexOf(d); return i >= 0 ? i : refuse(name, d);
        }, function (s, v) { s.cursorDirection = v === -2 ? undefined : v === -1 ? null : DIRS[v]; }];
      case 'input': case 'prevInput':
        return [function (s) { return bits(s[name]); }, null];   // put back with the lists
      case 'hasChain': return [function (s) { return s.currentChain ? 1 : 0; }, null];
      case 'chainAt': return [function (s) { return s.currentChain ? s.outgoing.indexOf(s.currentChain) : -1; }, null];
      case 'err': return [function () { return 0; }, null];
      case 'chain.orow': return [function (s) { return s.currentChain ? int(s.currentChain.origin.row, name) : 0; }, null];
      case 'chain.ocol': return [function (s) { return s.currentChain ? int(s.currentChain.origin.col, name) : 0; }, null];
      case 'ninc': return [function (s) { return s.incoming.length; }, null];
      case 'nout': return [function (s) { return s.outgoing.length; }, null];
      case 'nstall': return [function (s) { return s.swapStallBacklog.length; }, null];
      case 'nlanded': return [function (s) { return s.garbageLandedThisFrame.length; }, null];
    }
    if (CHAIN[name]) {
      var k = CHAIN[name], b = k === 'isChain' || k === 'finalized';
      return [function (s) { return s.currentChain ? (b ? bool(s.currentChain[k], name) : int(s.currentChain[k], name)) : 0; }, null];
    }
    throw new Error('Native: engine.c sends a field this file does not know: ' + name);
  }

  // ---------------------------------------------------------------- the server's rules
  // native/pa.c, the panel-game server's engine (pa-engine.js), under the same
  // wire: its own panel fields, and a head whose names are pa-engine.js's own
  // property paths (NaN for Lua nil).
  function PA() { return G0.PAEngine || (typeof require === 'function' ? require('./pa-engine.js') : null); }
  var PA_FIELDS = [
    ['row', 'int'], ['col', 'int'], ['id', 'int'], ['color', 'int'], ['chaining', 'nbool'], ['matching', 'nbool'], ['timer', 'int'],
    ['initialTime', 'nint'], ['popTime', 'nint'], ['popIndex', 'nint'], ['xOffset', 'nint'], ['yOffset', 'nint'], ['gWidth', 'nint'],
    ['gHeight', 'nint'], ['shakeTime', 'nint'], ['isGarbage', 'bool'], ['state', 'pstate'], ['comboIndex', 'nint'], ['comboSize', 'nint'],
    ['swapFromLeft', 'nbool'], ['dontSwap', 'nbool'], ['queuedHover', 'nbool'], ['fellFromGarbage', 'nint'], ['stateChanged', 'bool'],
    ['propagatesChaining', 'bool'], ['matchAnyway', 'bool'], ['propagatesFalling', 'nbool'], ['garbageId', 'nint'], ['metal', 'nbool']
  ];
  var PA_STATES = STATES.concat(['dead']);
  var PA_BOOLS = { stopWatchIsRunning: 1, inCountdown: 1, riseLock: 1, hasRisen: 1, manualRaise: 1, manualRaiseYet: 1, preventManualRaise: 1,
                   swapThisFrame: 1, wasToppedOut: 1, gameOver: 1, pressSwap: 1, swapDeniedThisFrame: 1 };
  function paIn(v, type, k) {
    switch (type) {
      case 'int': if (typeof v === 'number' && (v | 0) === v) return v; break;
      case 'bool': if (v === true || v === false) return v ? 1 : 0; break;
      case 'nint': if (v === null) return NUL; if (typeof v === 'number' && (v | 0) === v) return v; break;
      case 'nbool': if (v === null) return NUL; if (v === true || v === false) return v ? 1 : 0; break;
      case 'pstate': var s = PA_STATES.indexOf(v); if (s >= 0) return s; break;
    }
    return refuse('panel field ' + k, v);
  }
  function paOut(v, type) {
    if (type === 'pstate') return PA_STATES[v];
    if (v === NUL) return null;
    if (type === 'bool' || type === 'nbool') return v === 1;
    return v;
  }
  function path(o, p) { var parts = p.split('.'); for (var i = 0; i < parts.length; i++) o = o[parts[i]]; return o; }
  function paField(name) {
    switch (name) {
      case 'riseTimer': return [function (s) { if (typeof s.riseTimer !== 'number') refuse('riseTimer', s.riseTimer); return s.riseTimer; },
                                function (s, v) { s.riseTimer = v; }];
      case 'nrows': return [function (s) { return s.panels.length; }, null];
      case 'cursorDirection':
        return [function (s) { var d = s.cursorDirection; if (d === null) return -1; var i = DIRS.indexOf(d); return i >= 0 ? i : refuse(name, d); },
                function (s, v) { s.cursorDirection = v === -1 ? null : DIRS[v]; }];
      case 'err': return [function () { return 0; }, null];
      case 'ninc': return [function (s) { return s.incoming.length; }, null];
      case 'nstall': return [function (s) { return s.swapStallBacklog.length; }, null];
      case 'nlanded': return [function (s) { return s.garbageLandedThisFrame.length; }, null];
      case 'unseenRows': case 'unseenBreaks':
        return [function (s) { return s[name] || 0; }, function (s, v) { s[name] = v; }];
    }
    if (name.indexOf('.') >= 0) {
      return [function (s) { var v = path(s, name); return v === true ? 1 : v === false ? 0 : int(v, name); }, null];
    }
    return [function (s) {
      var v = s[name];
      if (v === null || v === undefined) return NaN;
      if (v === true || v === false) { if (!PA_BOOLS[name]) refuse(name, v); return v ? 1 : 0; }
      return int(v, name);
    }, function (s, v) { s[name] = PA_BOOLS[name] ? v === 1 : (v !== v ? null : v); }];
  }

  function make(KIND) {
  var SERVER = KIND === 'server';
  var ABORT = null;   // the running loop's `should I stop` (Mind.abort)
  var MEM = null, THREADS = 1, WORKERS = [];
  var X = null, HEAD = null, BODY = null, NAMES = null, FIELDSOF = null, AT = {};
  // The module is compiled once per thread: from bytes where there is no file
  // system (a page, a worker), from native/engine.wasm beside this file in node.
  function imports(memory) {
    var env = { abort_poll: function () { return ABORT && ABORT() ? 1 : 0; } };
    if (memory) env.memory = memory;
    return { env: env };
  }
  function readNames() {
    NAMES = [];
    var mem = function () { return new Uint8Array(MEM.buffer); };
    for (var i = 0, n = X.nb_nhead(); i < n; i++) {
      var p = (X.nb_head_name(i) >>> 0), m = mem(), e = p;
      while (m[e]) e++;
      NAMES.push(String.fromCharCode.apply(null, m.subarray(p, e)));
    }
    NAMES.forEach(function (nm, j) { AT[nm] = j; });
    FIELDSOF = NAMES.map(SERVER ? paField : field);
  }
  // The module is compiled once per process (or page, or worker): from bytes
  // where there is no file system, from native/engine.wasm beside this file
  // in node.
  function init(bytes) {
    if (X) return Native;
    if (!bytes) bytes = require('fs').readFileSync(require('path').join(__dirname, 'native', SERVER ? 'pa.wasm' : 'engine.wasm'));
    var inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), imports(null));
    X = inst.exports; MEM = X.memory;
    readNames();
    return Native;
  }
  // THREADS: engine-mt.wasm on one shared memory, this thread and n - 1
  // workers (node worker_threads), each an instance with its own stack. The
  // level loop hands them steps; see engine.c THREADS. Once per process, and
  // before init(): a process runs one kind or the other.
  var WORKER_SRC = [
    "var wt = require('worker_threads'), d = wt.workerData;",
    "var inst = new WebAssembly.Instance(d.mod, { env: { memory: d.mem, abort_poll: function () { return 0; } } });",
    "inst.exports.__stack_pointer.value = d.sp;",
    "inst.exports.ns_thread_init(d.id);",
    "inst.exports.ns_worker_loop();"
  ].join('\n');
  function initThreads(n) {
    n = Math.max(1, n | 0);
    if (X) { if (THREADS === n || (THREADS > 1 && n > 1)) return Native; throw new Error('Native: already running on ' + THREADS + ' thread(s)'); }
    var fs = require('fs'), path = require('path'), wt = require('worker_threads');
    var mod = new WebAssembly.Module(fs.readFileSync(path.join(__dirname, 'native', SERVER ? 'pa-mt.wasm' : 'engine-mt.wasm')));
    MEM = new WebAssembly.Memory({ initial: 256, maximum: 65536, shared: true });
    X = new WebAssembly.Instance(mod, imports(MEM)).exports;
    X.ns_thread_init(0);
    THREADS = n;
    var STACK = 1 << 20;
    for (var k = 1; k < n; k++) {
      var sp = (X.ns_grab(STACK) >>> 0);
      if (!sp) throw new Error('Native: no memory for a thread');
      var w = new wt.Worker(WORKER_SRC, { eval: true, workerData: { mod: mod, mem: MEM, id: k, sp: sp + STACK } });
      w.unref();
      w.on('error', function (e) { console.error('Native worker: ' + (e && e.stack || e)); });
      WORKERS.push(w);
    }
    var nap = new Int32Array(new SharedArrayBuffer(4)), t0 = Date.now();
    while (X.ns_workers() < n - 1) {
      if (Date.now() - t0 > 30000) throw new Error('Native: workers did not start');
      Atomics.wait(nap, 0, 0, 2);
    }
    readNames();
    return Native;
  }
  function views() {
    // Memory can grow under any call; views are made fresh.
    HEAD = new Float64Array(MEM.buffer, (X.nb_io_head() >>> 0), NAMES.length);
    BODY = new Int32Array(MEM.buffer, (X.nb_io_body() >>> 0));
  }
  function searchBoard(st) {
    if (st.doCountdown || st.allowIdleSkip || !st.rng || st.rng.name !== 'noRng' ||
        !st.generateRowColors || st.generateRowColors.name !== 'unseenRow' ||
        !st.garbageRowColors || st.garbageRowColors.name !== 'unseenBreak') {
      throw new Error('Native: not a board the search copied');
    }
  }

  // A Stack (or FastStack) to a board in the engine's memory. Returns its handle.
  function fromStack(st, into) {
    init();
    if (typeof st.toStack === 'function') st = st.toStack();
    wire(st);
    var h = into || X.nb_new();
    var err = X.nb_load(h);
    if (err) throw new Error('Native: board does not fit the engine (err ' + err + ')');
    return h;
  }
  function wire(st) { if (SERVER) paWire(st); else fromStackWire(st); }
  function bodyLen(st) {
    return SERVER ? st.panels.length * W * PA_FIELDS.length + 6 * st.incoming.length + 5 * st.swapStallBacklog.length +
                    st.garbageLandedThisFrame.length + 6 : bodyLength(st);
  }
  function paWire(st) {
    if (!(st instanceof PA().Stack)) throw new Error('Native: the server engine takes a pa-engine.js Stack');
    views();
    var i, r, c, f, x = 0, NFP = PA_FIELDS.length;
    for (i = 0; i < NAMES.length; i++) HEAD[i] = FIELDSOF[i][0](st);
    for (r = 0; r < st.panels.length; r++) {
      if (st.panels[r][0] !== null) refuse('panels[' + r + '][0]', st.panels[r][0]);
      for (c = 1; c <= W; c++) {
        var p = st.panels[r][c];
        for (f = 0; f < NFP; f++) BODY[x++] = paIn(p[PA_FIELDS[f][0]], PA_FIELDS[f][1], PA_FIELDS[f][0]);
      }
    }
    st.incoming.forEach(function (g) {
      BODY[x++] = int(g.width, 'incoming'); BODY[x++] = int(g.height, 'incoming'); BODY[x++] = bool(g.isChain, 'incoming');
      BODY[x++] = bool(g.isMetal, 'incoming'); BODY[x++] = int(g.frameEarned, 'incoming');
      BODY[x++] = g.finalized === null ? NUL : bool(g.finalized, 'incoming');
    });
    st.swapStallBacklog.forEach(function (g) {
      BODY[x++] = int(g.leftId, 'stall'); BODY[x++] = int(g.rightId, 'stall'); BODY[x++] = int(g.row, 'stall');
      BODY[x++] = int(g.col, 'stall'); BODY[x++] = int(g.clock, 'stall');
    });
    st.garbageLandedThisFrame.forEach(function (id) { BODY[x++] = int(id, 'garbageLandedThisFrame'); });
    for (i = 0; i < 6; i++) BODY[x++] = int(st.dropColumnIndex[i], 'dropColumnIndex');
    if (x !== bodyLen(st)) throw new Error('Native: wrote ' + x + ' body ints, expected ' + bodyLen(st));
  }
  function paToStack(h, template) {
    var err = X.nb_save(h);
    views();
    if (HEAD[AT.err]) throw new Error('Native: the engine refused this board (err ' + HEAD[AT.err] + ')');
    var PAE = PA(), s = Object.create(PAE.Stack.prototype), k, i, r, c, f, x = 0, NFP = PA_FIELDS.length;
    for (k in template) if (Object.prototype.hasOwnProperty.call(template, k) && k !== 'panels') s[k] = template[k];
    for (i = 0; i < NAMES.length; i++) if (FIELDSOF[i][1]) FIELDSOF[i][1](s, HEAD[i]);
    var num = function (nm) { return HEAD[AT[nm]]; }, nrows = num('nrows'), rows = new Array(nrows);
    for (r = 0; r < nrows; r++) {
      var row = [null];
      for (c = 1; c <= W; c++) {
        var p = Object.create(PAE.Panel.prototype);
        for (f = 0; f < NFP; f++) p[PA_FIELDS[f][0]] = paOut(BODY[x++], PA_FIELDS[f][1]);
        row[c] = p;
      }
      rows[r] = row;
    }
    s.panels = rows;
    s.incoming = [];
    for (i = 0; i < num('ninc'); i++, x += 6) {
      s.incoming.push({ width: BODY[x], height: BODY[x + 1], isChain: BODY[x + 2] === 1, isMetal: BODY[x + 3] === 1,
                        frameEarned: BODY[x + 4], finalized: BODY[x + 5] === NUL ? null : BODY[x + 5] === 1 });
    }
    s.swapStallBacklog = [];
    for (i = 0; i < num('nstall'); i++, x += 5) s.swapStallBacklog.push({ leftId: BODY[x], rightId: BODY[x + 1], row: BODY[x + 2], col: BODY[x + 3], clock: BODY[x + 4] });
    s.garbageLandedThisFrame = [];
    for (i = 0; i < num('nlanded'); i++) s.garbageLandedThisFrame.push(BODY[x++]);
    s.dropColumnIndex = [];
    for (i = 0; i < 6; i++) s.dropColumnIndex.push(BODY[x++]);
    if (x !== err) throw new Error('Native: read ' + x + ' body ints, engine wrote ' + err);
    s.events = [];
    return s;
  }
  function bodyLength(st) {
    return st.panels.length * W * NF + 3 * st.incoming.length + 7 * st.outgoing.length + 2 * st.swapStallBacklog.length +
           st.garbageLandedThisFrame.length + 6;
  }
  // The board into the io buffers.
  function fromStackWire(st) {
    searchBoard(st);
    views();
    var i, r, c, f, x = 0;
    for (i = 0; i < NAMES.length; i++) HEAD[i] = FIELDSOF[i][0](st);
    for (r = 0; r < st.panels.length; r++) {
      if (st.panels[r][0] !== null) refuse('panels[' + r + '][0]', st.panels[r][0]);
      for (c = 1; c <= W; c++) {
        var p = st.panels[r][c];
        for (f = 0; f < NF; f++) BODY[x++] = inn(p[FIELDS[f][0]], FIELDS[f][1], FIELDS[f][0]);
      }
    }
    st.incoming.forEach(function (g) { BODY[x++] = int(g.width, 'incoming'); BODY[x++] = int(g.height, 'incoming'); BODY[x++] = bool(g.isChain, 'incoming'); });
    st.outgoing.forEach(function (g) {
      BODY[x++] = int(g.width, 'outgoing'); BODY[x++] = int(g.height, 'outgoing'); BODY[x++] = bool(g.isChain, 'outgoing');
      BODY[x++] = int(g.frameEarned, 'outgoing'); BODY[x++] = bool(g.finalized, 'outgoing');
      BODY[x++] = int(g.origin.row, 'outgoing'); BODY[x++] = int(g.origin.col, 'outgoing');
    });
    st.swapStallBacklog.forEach(function (g) { BODY[x++] = int(g.row, 'swapStallBacklog'); BODY[x++] = int(g.col, 'swapStallBacklog'); });
    st.garbageLandedThisFrame.forEach(function (id) { BODY[x++] = int(id, 'garbageLandedThisFrame'); });
    for (i = 1; i <= 6; i++) { var d = st.dropColumnIndex[i]; BODY[x++] = d === undefined ? -1 : int(d, 'dropColumnIndex'); }
    for (var dk in st.dropColumnIndex) if (!(+dk >= 1 && +dk <= 6)) refuse('dropColumnIndex key', dk);
    if (st.currentChain && st.currentChain.origin === undefined) refuse('currentChain', st.currentChain);
    if (x !== bodyLength(st)) throw new Error('Native: wrote ' + x + ' body ints, expected ' + bodyLength(st));
  }

  // The board as a Stack. `template` gives what a board never changes (the
  // level, its tables, the copy functions): a Stack of the same level the
  // search copied.
  function toStack(h, template) {
    init();
    if (SERVER) return paToStack(h, template);
    var err = X.nb_save(h);
    views();
    if (HEAD[AT.err]) throw new Error('Native: the engine refused this board (err ' + HEAD[AT.err] + ')');
    var s = Object.create(PE().Stack.prototype), k;
    for (k in template) {
      if (!Object.prototype.hasOwnProperty.call(template, k) || k === 'panels') continue;
      s[k] = template[k];
    }
    var i, r, c, f, x = 0, num = function (nm) { return HEAD[AT[nm]]; };
    for (i = 0; i < NAMES.length; i++) if (FIELDSOF[i][1]) FIELDSOF[i][1](s, HEAD[i]);
    var nrows = num('nrows'), rows = new Array(nrows);
    for (r = 0; r < nrows; r++) {
      var row = [null];
      for (c = 1; c <= W; c++) {
        var p = {};
        for (f = 0; f < NF; f++) p[FIELDS[f][0]] = out(BODY[x++], FIELDS[f][1]);
        row[c] = p;
      }
      rows[r] = row;
    }
    s.panels = rows;
    s.incoming = [];
    for (i = 0; i < num('ninc'); i++, x += 3) s.incoming.push({ width: BODY[x], height: BODY[x + 1], isChain: BODY[x + 2] === 1 });
    s.outgoing = [];
    for (i = 0; i < num('nout'); i++, x += 7) {
      s.outgoing.push({ width: BODY[x], height: BODY[x + 1], isChain: BODY[x + 2] === 1, frameEarned: BODY[x + 3],
                        finalized: BODY[x + 4] === 1, origin: { row: BODY[x + 5], col: BODY[x + 6] } });
    }
    s.swapStallBacklog = [];
    for (i = 0; i < num('nstall'); i++, x += 2) s.swapStallBacklog.push({ row: BODY[x], col: BODY[x + 1] });
    s.garbageLandedThisFrame = [];
    for (i = 0; i < num('nlanded'); i++) s.garbageLandedThisFrame.push(BODY[x++]);
    s.dropColumnIndex = {};
    for (i = 1; i <= 6; i++, x++) if (BODY[x] >= 0) s.dropColumnIndex[i] = BODY[x];
    if (x !== err) throw new Error('Native: read ' + x + ' body ints, engine wrote ' + err);
    var at = num('chainAt');
    s.currentChain = !num('hasChain') ? null : at >= 0 ? s.outgoing[at]
      : { width: num('chain.width'), height: num('chain.height'), isChain: num('chain.isChain') === 1, frameEarned: num('chain.frameEarned'),
          finalized: num('chain.finalized') === 1, origin: { row: num('chain.orow'), col: num('chain.ocol') } };
    s.input = unbits(num('input'));
    s.prevInput = num('prevInput') === num('input') ? s.input : unbits(num('prevInput'));
    s.events = [];
    return s;
  }

  // ---------------------------------------------------------------- search
  // THE SEARCH'S NODES, in the engine's memory. A node here reads as
  // puyocpu.js's own (_engineNode): t, dead, hold, arrivals, pos, carry, and
  // b with grid, key and legalSwaps(); its st is the board as a Stack, read
  // back only when something asks for it. Nodes last until reset(), which a
  // bot calls once per decision; a node read after that throws.
  var NODEOFF = null, KEYCH = ['n', 'd', 's', 'm', 'p', 'h', 'f', 'l', 'x'];
  function nodeFields() {
    if (NODEOFF) return NODEOFF;
    NODEOFF = {};
    var m = new Uint8Array(MEM.buffer);
    for (var i = 0; ; i++) {
      var p = (X.ns_field_name(i) >>> 0);
      if (!p) break;
      var e = p; while (m[e]) e++;
      NODEOFF[String.fromCharCode.apply(null, m.subarray(p, e))] = X.ns_field_off(i);
    }
    return NODEOFF;
  }
  var KIND = { long: 0, hold: 1, raise: 2, swap: 3, settle: 4 };
  function Search(cfg) {
    if (cfg.threads > 1) initThreads(cfg.threads); else init();
    nodeFields();
    this.ctx = X.ns_ctx_new();
    this.swapGap = cfg.swapGap;
    this.configure(cfg.reaction, cfg.cursorMoveFrames, cfg.surviveFrames, cfg.surviveRest);
    this.gen = 0; this.nodes = []; this.template = null;
  }
  // swapGap (the frames after a swap before the bot acts again) is the
  // reaction unless given.
  Search.prototype.configure = function (reaction, cursorMoveFrames, surviveFrames, surviveRest) {
    X.ns_ctx_set(this.ctx, reaction | 0, cursorMoveFrames | 0, surviveFrames | 0, surviveRest | 0);
    if (this.swapGap !== undefined && this.swapGap !== null) {
      if (!X.ns_ctx_gap) throw new Error('Native: this engine has no swap gap');
      X.ns_ctx_gap(this.ctx, this.swapGap | 0);
    }
  };
  Search.prototype.reset = function () {
    X.ns_reset(this.ctx);
    this.gen++; this.nodes = []; this.template = null;
  };
  // The root: a board the search copied, the raise in hand, the garbage on
  // its way, and whether update() has already run this frame's raise step.
  Search.prototype.root = function (st, hold, arrivals, fresh) {
    if (typeof st.toStack === 'function') st = st.toStack();
    this.template = st;
    wire(st);
    var body = new Int32Array(MEM.buffer, (X.nb_io_body() >>> 0)), used = bodyLen(st);
    arrivals.forEach(function (a, i) {
      body[used + 5 * i] = int(a.at, 'arrival'); body[used + 5 * i + 1] = int(a.width, 'arrival');
      body[used + 5 * i + 2] = int(a.height, 'arrival'); body[used + 5 * i + 3] = bool(!!a.isChain, 'arrival');
      body[used + 5 * i + 4] = (a.isMetal ? 1 : 0) | (a.capped ? 2 : 0);   // search.h: bit 2 is capped
    });
    var r = X.ns_root(this.ctx, int(hold.left, 'hold.left'), bool(!!hold.started, 'hold.started'), arrivals.length, fresh ? 1 : 0);
    if (r < 0) throw new Error('Native: root refused (' + r + (X.ns_root_why ? ', why ' + X.ns_root_why() : '') + ')');
    return this.wrap(r);
  };
  function moveOf(n) {
    var o = NODEOFF, v = new Int32Array(MEM.buffer, (X.ns_node(n.ctx, n.i) >>> 0), o.size >> 2);
    var mk = v[o.mk >> 2];
    return mk === 0 ? 'long' : mk === 1 ? null : mk === 2 ? 'raise' : [v[o.mr >> 2], v[o.mc >> 2]];
  }
  // A node as puyocpu.js reads one.
  Search.prototype.wrap = function (i) {
    if (this.nodes[i]) return this.nodes[i];
    var S = this, gen = this.gen, o = NODEOFF, base = (X.ns_node(this.ctx, i) >>> 0);
    var v = new Int32Array(MEM.buffer, base, o.size >> 2);
    function g(k) { return v[o[k] >> 2]; }
    function live() { if (S.gen !== gen) throw new Error('Native: a node from an earlier decision was read'); }
    // The node's garbage on its way and its board's key, read when first
    // asked for: most nodes are never asked. Read from the node where it is
    // then, since the node array moves as it grows.
    function fresh() { live(); return new Int32Array(MEM.buffer, (X.ns_node(S.ctx, i) >>> 0), o.size >> 2); }
    function readArrivals() {
      var w = fresh(), out = [], a0 = o.arr >> 2;
      for (var k = 0; k < w[o.narr >> 2]; k++) {
        var ar = { at: w[a0 + 5 * k], width: w[a0 + 5 * k + 1], height: w[a0 + 5 * k + 2], isChain: w[a0 + 5 * k + 3] === 1 };
        if (w[a0 + 5 * k + 4] & 1) ar.isMetal = true;
        if (w[a0 + 5 * k + 4] & 2) ar.capped = true;
        out.push(ar);
      }
      return out;
    }
    function readKey() {
      var w = fresh(), keyn = w[o.keyn >> 2], k0 = o.key >> 2, key = '';
      for (var k = 0; k < keyn; k++) {
        var c = w[k0 + k], col = c & 255;
        key += (col === 255 ? '#' : col === 254 ? '%' : col) + KEYCH[(c >> 8) & 15] + ((c >> 12) || '') + ',';
      }
      return key;
    }
    var rise = new Float64Array(MEM.buffer, base + o.riseTimer, 1)[0], height = S.template.height, st = null, grid = null;
    var n = {
      _nat: S, _i: i, t: g('t'), hold: { left: g('holdLeft'), started: g('holdStarted') === 1 }, fresh: g('fresh') === 1,
      pos: [g('pos0'), g('pos1')],
      carry: { stopTime: g('stopTime'), preStopTime: g('preStopTime'), shakeTime: g('shakeTime'), displacement: g('displacement'),
               riseTimer: rise, speed: g('speed') },
      b: { height: height, width: 6, _garb: g('garb'), _top: g('top'),
           legalSwaps: function () {
             live();
             var m = X.ns_legal(S.ctx, i), body = new Int32Array(MEM.buffer, (X.nb_io_body() >>> 0), Math.max(0, m)), out = [];
             if (m < 0) throw new Error('Native: board lost');
             for (var q = 0; q < m; q++) out.push([body[q] >> 3, body[q] & 7]);
             return out;
           } }
    };
    if (g('dead')) n.dead = true;
    var arrivals = null, key = null;
    Object.defineProperty(n, 'arrivals', { enumerable: true, configurable: true, get: function () { return arrivals || (arrivals = readArrivals()); }, set: function (x) { arrivals = x; } });
    Object.defineProperty(n.b, 'key', { enumerable: true, configurable: true, get: function () { return key !== null ? key : (key = readKey()); }, set: function (x) { key = x; } });
    Object.defineProperty(n.b, 'grid', { enumerable: true, configurable: true, get: function () {
      if (grid) return grid;
      live();
      var H = X.ns_grid(S.ctx, i), body = new Int32Array(MEM.buffer, (X.nb_io_body() >>> 0), (H + 2) * 7);
      if (H < 0) throw new Error('Native: board lost');
      grid = [];
      for (var r = 0; r <= H + 1; r++) grid.push(Array.prototype.slice.call(body.subarray(r * 7, r * 7 + 7)));
      return grid;
    }, set: function (x) { grid = x; } });
    Object.defineProperty(n, 'st', { enumerable: true, configurable: true, get: function () {
      if (st) return st;
      live();
      var b = X.ns_board(S.ctx, i);
      if (!b) throw new Error('Native: board lost');
      return (st = toStack(b, S.template));
    }, set: function (x) { st = x; } });
    Object.defineProperty(n, '_m', { get: function () { return moveOf({ ctx: S.ctx, i: i }); } });
    this.nodes[i] = n;
    return n;
  };
  function unstep(S, r) {
    if (r === -1) return null;
    if (r === -2) return { dead: true, t: X.ns_dead_at() };
    if (r < 0) throw new Error('Native: the step ran out of room (' + r + ')');
    return S.wrap(r);
  }
  // _engineStep: m is null (hold), 'raise' or [row, col]; long waits to until.
  Search.prototype.step = function (node, m, long, until) {
    var k = long ? 0 : m === null ? 1 : m === 'raise' ? 2 : 3;
    var r = X.ns_step(this.ctx, node._i, k, k === 3 ? m[0] : 0, k === 3 ? m[1] : 0, until | 0);
    if (r === -2) throw new Error('Native: a step reported a death it should have handled');
    return unstep(this, r);
  };
  // _engineAdvance: kind 'swap', 'hold', 'raise' or 'long' (frames).
  Search.prototype.advance = function (node, kind, m, frames) {
    var k = KIND[kind];
    if (k === undefined) throw new Error('Native: step kind ' + kind);
    return unstep(this, X.ns_advance(this.ctx, node._i, k, k >= 3 && m ? m[0] : 0, k >= 3 && m ? m[1] : 0, frames | 0));
  };
  // Many steps at once, on every thread: steps[i] is [node, kind, move,
  // frames], as advance takes them. Each answer is what advance gives; only
  // the order the nodes are made in differs.
  var ADVANCE_CHUNK = 1000;   // steps one ns_advance_many takes (its records fill the io body)
  // lite: each node as liteNode makes it.
  Search.prototype.advanceMany = function (steps, lite) {
    if (!X.ns_advance_many) throw new Error('Native: this engine does not step in batches');
    if (steps.length > ADVANCE_CHUNK) {
      var all = [];
      for (var at = 0; at < steps.length; at += ADVANCE_CHUNK) all = all.concat(this.advanceMany(steps.slice(at, at + ADVANCE_CHUNK), lite));
      return all;
    }
    var n = steps.length, io = new Int32Array(MEM.buffer, (X.nb_io_body() >>> 0), 5 * n), i;
    for (i = 0; i < n; i++) {
      var s = steps[i], k = KIND[s[1]], m = k >= 3 ? s[2] : null;
      if (k === undefined) throw new Error('Native: step kind ' + s[1]);
      io[5 * i] = s[0]._i; io[5 * i + 1] = k; io[5 * i + 2] = m ? m[0] : 0; io[5 * i + 3] = m ? m[1] : 0; io[5 * i + 4] = s[3] | 0;
    }
    var got = X.ns_advance_many(this.ctx, n);
    if (got !== n) throw new Error('Native: stepped ' + got + ' of ' + n);
    var body = new Int32Array(MEM.buffer, (X.nb_io_body() >>> 0), 4 * n), rs = [], out = [], S = this;
    for (i = 0; i < n; i++) rs.push([body[4 * i], body[4 * i + 1], body[4 * i + 2], body[4 * i + 3]]);
    for (i = 0; i < n; i++) {
      var r = rs[i][0];
      if (r === -2) out.push({ dead: true, t: rs[i][1] });
      else if (!lite || r < 0) out.push(unstep(this, r));
      else out.push(liteNode(S, r, rs[i][2], rs[i][3]));
    }
    return out;
  };
  // A node as advanceMany's caller first reads one: its frame and the garbage
  // rows broken by then (brk); the board and the rest are read when asked for.
  function liteNode(S, i, t, brk) {
    if (S.nodes[i]) return S.nodes[i];
    var gen = S.gen, full = null;
    function wrapped() { if (S.gen !== gen) throw new Error('Native: a node from an earlier decision was read'); return full || (full = S.wrap(i)); }
    return { _nat: S, _i: i, t: t, brk: brk, get b() { return wrapped().b; }, get st() { return wrapped().st; } };
  }
  // Settles from [node, move] pairs (move null: hold), at most `frames` each.
  Search.prototype.settleMany = function (steps, frames) {
    return this.advanceMany(steps.map(function (s) { return [s[0], 'settle', s[1], frames]; }));
  };
  // What a settle step did (pa.c ns_step_stats), read straight after it:
  // { comboSizes, chainAt (the chain counter each clear reached), cleared,
  // broke (garbage cells converted), earned (the most stop time one clear paid) }.
  Search.prototype.stepStats = function (node) {
    if (!X.ns_step_stats) throw new Error('Native: this engine does not count a step');
    var n = X.ns_step_stats(this.ctx, node._i);
    if (n < 0) throw new Error('Native: board lost');
    var b = new Int32Array(MEM.buffer, (X.nb_io_body() >>> 0), n), out = { comboSizes: [], chainAt: [], cleared: b[1], broke: b[2], earned: b[3] };
    for (var i = 0; i < b[0]; i++) { out.comboSizes.push(b[4 + 2 * i]); out.chainAt.push(b[5 + 2 * i]); }
    return out;
  };
  // The same decision as keys: { inputs, holds } per frame (holds: the raise
  // still held after it), or null when the move is refused. What the search
  // played is what a caller presses.
  Search.prototype.keys = function (node, kind, m, frames) {
    var k = KIND[kind];
    if (k === undefined) throw new Error('Native: step kind ' + kind);
    var n = X.ns_keys(this.ctx, node._i, k, k === 3 ? m[0] : 0, k === 3 ? m[1] : 0, frames | 0);
    if (n === -1) return null;
    if (n < 0) throw new Error('Native: the keys ran out of room (' + n + ')');
    var body = new Int32Array(MEM.buffer, (X.nb_io_body() >>> 0), 3 * n), out = { inputs: [], holds: [] };
    for (var i = 0; i < n; i++) {
      out.inputs.push(body[3 * i]);
      out.holds.push({ left: body[3 * i + 1], started: body[3 * i + 2] === 1 });
    }
    return out;
  };
  Search.prototype.steps = function () { return X.ns_steps(this.ctx); };
  // The first frame a live line of the move tagged `tag` broke garbage in the
  // last level loop (the server's engine; -1 for none).
  Search.prototype.breakAt = function (tag) { return X.ns_break_at ? X.ns_break_at(this.ctx, tag) : -1; };
  // The server's engine: garbage rows broken on a node's board so far.
  Search.prototype.breaks = function (node) {
    if (!X.ns_breaks) throw new Error('Native: this engine does not count breaks');
    return X.ns_breaks(this.ctx, node._i);
  };
  // A node the level loop made: its move, its parent and its line's tag, as
  // the JS loop would have written them on it.
  Search.prototype.wrapLoop = function (i) {
    var n = this.wrap(i), S = this;
    if (Object.prototype.hasOwnProperty.call(n, 'tag')) return n;
    var v = new Int32Array(MEM.buffer, (X.ns_node(this.ctx, i) >>> 0), NODEOFF.size >> 2), o = NODEOFF;
    var tag = v[o.tag >> 2], prev = v[o.prev >> 2], seed = v[o.seed >> 2], m = moveOf({ ctx: this.ctx, i: i });
    n.tag = tag; n.m = m;
    if (seed) n.seed = true;
    var pw = null;
    Object.defineProperty(n, 'prev', { enumerable: true, configurable: true,
      get: function () { return pw || (pw = S.wrapLoop(prev)); }, set: function (x) { pw = x; } });
    return n;
  };
  function idx(S, n) {
    if (n === undefined || n === null) return -1;
    if (n._nat !== S) throw new Error('Native: a node from another search');
    return n._i;
  }
  // _survivalSearch's level loop, run here. o carries the loop's state as
  // puyocpu.js keeps it (verdict, proofs, weak, reach, far per move; the
  // level; the budget) and gets it back changed exactly as the JS loop would
  // have changed it. Returns the budget left; o.level is the level left open.
  Search.prototype.loop = function (o, abortFn, abortValue) {
    var S = this, n = o.ntags, i;
    var base = (X.ns_tags(this.ctx, n) >>> 0), stride = X.ns_tag_stride(this.ctx);
    if (!base) throw new Error('Native: out of memory');
    var T = new Int32Array(MEM.buffer, base, stride * 7);
    for (i = 0; i < n; i++) {
      T[i] = o.verdict[i] ? 2 : 0;
      T[stride + i] = idx(S, o.proofs[i]);
      T[2 * stride + i] = idx(S, o.weak[i]);
      T[3 * stride + i] = o.reach[i] === undefined ? 0 : o.reach[i];
      T[4 * stride + i] = o.reach[i] === undefined ? 0 : 1;
      T[5 * stride + i] = idx(S, o.far[i]);
    }
    var lv = o.level, L = (X.ns_level(this.ctx, lv.length) >>> 0);
    if (!L && lv.length) throw new Error('Native: out of memory');
    var LA = new Int32Array(MEM.buffer, L, lv.length);
    for (i = 0; i < lv.length; i++) LA[i] = idx(S, lv[i]);
    for (i = 0; i < lv.length; i++) X.ns_set_tag(this.ctx, lv[i]._i, lv[i].tag, lv[i].seed ? 1 : 0);
    ABORT = abortFn || null;
    var left;
    try { left = X.ns_loop(this.ctx, o.budget, o.until, o.full, o.beam, o.quota, o.seeds); } finally { ABORT = null; }
    if (left === -10) throw abortValue;
    if (left < 0) throw new Error('Native: the level loop failed (' + left + ')');
    T = new Int32Array(MEM.buffer, (X.ns_tags(this.ctx, n) >>> 0), stride * 7);
    for (i = 0; i < n; i++) {
      if (T[i] === 1 && !o.verdict[i]) { o.verdict[i] = 'proven'; o.newlyProven.push(i); }
      if (T[stride + i] >= 0) o.proofs[i] = S.wrapLoop(T[stride + i]);
      if (T[2 * stride + i] >= 0) o.weak[i] = S.wrapLoop(T[2 * stride + i]);
      if (T[4 * stride + i]) { o.reach[i] = T[3 * stride + i]; o.far[i] = S.wrapLoop(T[5 * stride + i]); }
    }
    var ln = X.ns_level_n(this.ctx), LB = new Int32Array(MEM.buffer, (X.ns_level(this.ctx, ln) >>> 0), ln);
    o.level = [];
    for (i = 0; i < ln; i++) o.level.push(S.wrapLoop(LB[i]));
    return left;
  };

  var Native = {
    init: init,
    initThreads: initThreads,
    threads: function () { return THREADS; },
    memoryBytes: function () { return MEM ? MEM.buffer.byteLength : 0; },
    fromStack: fromStack,
    toStack: toStack,
    free: function (h) { X.nb_free(h); },
    copy: function (h) { var d = X.nb_new(); X.nb_copy(d, h); return d; },
    clone: function (h) { var d = X.nb_new(); X.nb_clone(d, h); return d; },
    setInput: function (h, input) { X.nb_set_input(h, bits(input)); },
    run: function (h) { var e = X.nb_run(h); if (e) throw new Error('Native: board out of room (err ' + e + ')'); },
    tryQueueSwap: function (h, r, c) { return X.nb_try_queue_swap(h, r, c) === 1; },
    canSwap: function (h, r, c) { return X.nb_can_swap(h, r, c) === 1; },
    pushIncoming: function (h, g) { X.nb_push_incoming(h, g.width, g.height, g.isChain ? 1 : 0, g.isMetal ? 1 : 0); },
    takeDeliverable: function (h) {
      var n = X.nb_take_deliverable(h), o = [];
      views();
      for (var i = 0; i < n; i++) {
        var x = 7 * i;
        o.push({ width: BODY[x], height: BODY[x + 1], isChain: BODY[x + 2] === 1, frameEarned: BODY[x + 3],
                 finalized: BODY[x + 4] === 1, origin: { row: BODY[x + 5], col: BODY[x + 6] } });
      }
      return o;
    },
    gameOver: function (h) { return X.nb_game_over(h) === 1; },
    Search: Search,
    exports: function () { init(); return X; }
  };
  return Native;
  }
  var game = make('game');
  game.server = make('server');
  return game;
}));
