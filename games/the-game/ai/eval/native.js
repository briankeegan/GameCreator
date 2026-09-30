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

  var ABORT = null;   // the running loop's `should I stop` (Mind.abort)
  var X = null, HEAD = null, BODY = null, NAMES = null, FIELDSOF = null, AT = {};
  // The module is compiled once per thread: from bytes where there is no file
  // system (a page, a worker), from native/engine.wasm beside this file in node.
  function init(bytes) {
    if (X) return Native;
    if (!bytes) bytes = require('fs').readFileSync(require('path').join(__dirname, 'native', 'engine.wasm'));
    var inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { abort_poll: function () { return ABORT && ABORT() ? 1 : 0; } } });
    X = inst.exports;
    NAMES = [];
    var mem = function () { return new Uint8Array(X.memory.buffer); };
    for (var i = 0, n = X.nb_nhead(); i < n; i++) {
      var p = X.nb_head_name(i), m = mem(), e = p;
      while (m[e]) e++;
      NAMES.push(String.fromCharCode.apply(null, m.subarray(p, e)));
    }
    NAMES.forEach(function (nm, j) { AT[nm] = j; });
    FIELDSOF = NAMES.map(field);
    return Native;
  }
  function views() {
    // Memory can grow under any call; views are made fresh.
    HEAD = new Float64Array(X.memory.buffer, X.nb_io_head(), NAMES.length);
    BODY = new Int32Array(X.memory.buffer, X.nb_io_body());
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
    fromStackWire(st);
    var h = into || X.nb_new();
    var err = X.nb_load(h);
    if (err) throw new Error('Native: board does not fit the engine (err ' + err + ')');
    return h;
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
  var NODEOFF = null, KEYCH = ['n', 'd', 's', 'm', 'p', 'h', 'f', 'l'];
  function nodeFields() {
    if (NODEOFF) return NODEOFF;
    NODEOFF = {};
    var m = new Uint8Array(X.memory.buffer);
    for (var i = 0; ; i++) {
      var p = X.ns_field_name(i);
      if (!p) break;
      var e = p; while (m[e]) e++;
      NODEOFF[String.fromCharCode.apply(null, m.subarray(p, e))] = X.ns_field_off(i);
    }
    return NODEOFF;
  }
  var KIND = { long: 0, hold: 1, raise: 2, swap: 3 };
  function Search(cfg) {
    init(); nodeFields();
    this.ctx = X.ns_ctx_new();
    X.ns_ctx_set(this.ctx, cfg.reaction | 0, cfg.cursorMoveFrames | 0, cfg.surviveFrames | 0, cfg.surviveRest | 0);
    this.gen = 0; this.nodes = []; this.template = null;
  }
  Search.prototype.configure = function (reaction, cursorMoveFrames, surviveFrames, surviveRest) {
    X.ns_ctx_set(this.ctx, reaction | 0, cursorMoveFrames | 0, surviveFrames | 0, surviveRest | 0);
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
    fromStackWire(st);
    var body = new Int32Array(X.memory.buffer, X.nb_io_body()), used = bodyLength(st);
    arrivals.forEach(function (a, i) {
      body[used + 4 * i] = int(a.at, 'arrival'); body[used + 4 * i + 1] = int(a.width, 'arrival');
      body[used + 4 * i + 2] = int(a.height, 'arrival'); body[used + 4 * i + 3] = bool(!!a.isChain, 'arrival');
    });
    var r = X.ns_root(this.ctx, int(hold.left, 'hold.left'), bool(!!hold.started, 'hold.started'), arrivals.length, fresh ? 1 : 0);
    if (r < 0) throw new Error('Native: root refused (' + r + ')');
    return this.wrap(r);
  };
  function moveOf(n) {
    var o = NODEOFF, v = new Int32Array(X.memory.buffer, X.ns_node(n.ctx, n.i), o.size >> 2);
    var mk = v[o.mk >> 2];
    return mk === 0 ? 'long' : mk === 1 ? null : mk === 2 ? 'raise' : [v[o.mr >> 2], v[o.mc >> 2]];
  }
  // A node as puyocpu.js reads one.
  Search.prototype.wrap = function (i) {
    if (this.nodes[i]) return this.nodes[i];
    var S = this, gen = this.gen, o = NODEOFF, base = X.ns_node(this.ctx, i);
    var v = new Int32Array(X.memory.buffer, base, o.size >> 2);
    function g(k) { return v[o[k] >> 2]; }
    function live() { if (S.gen !== gen) throw new Error('Native: a node from an earlier decision was read'); }
    var arr = [], a0 = o.arr >> 2;
    for (var k = 0; k < g('narr'); k++) arr.push({ at: v[a0 + 4 * k], width: v[a0 + 4 * k + 1], height: v[a0 + 4 * k + 2], isChain: v[a0 + 4 * k + 3] === 1 });
    var keyn = g('keyn'), k0 = o.key >> 2, key = '';
    for (k = 0; k < keyn; k++) {
      var c = v[k0 + k], col = c & 255;
      key += (col === 255 ? '#' : col) + KEYCH[(c >> 8) & 15] + ((c >> 12) || '') + ',';
    }
    var rise = new Float64Array(X.memory.buffer, base + o.riseTimer, 1)[0], height = S.template.height, st = null, grid = null;
    var n = {
      _nat: S, _i: i, t: g('t'), hold: { left: g('holdLeft'), started: g('holdStarted') === 1 }, arrivals: arr, fresh: g('fresh') === 1,
      pos: [g('pos0'), g('pos1')],
      carry: { stopTime: g('stopTime'), preStopTime: g('preStopTime'), shakeTime: g('shakeTime'), displacement: g('displacement'),
               riseTimer: rise, speed: g('speed') },
      b: { key: key, height: height, width: 6, _garb: g('garb'), _top: g('top'),
           legalSwaps: function () {
             live();
             var m = X.ns_legal(S.ctx, i), body = new Int32Array(X.memory.buffer, X.nb_io_body(), Math.max(0, m)), out = [];
             if (m < 0) throw new Error('Native: board lost');
             for (var q = 0; q < m; q++) out.push([body[q] >> 3, body[q] & 7]);
             return out;
           } }
    };
    if (g('dead')) n.dead = true;
    Object.defineProperty(n.b, 'grid', { enumerable: true, configurable: true, get: function () {
      if (grid) return grid;
      live();
      var H = X.ns_grid(S.ctx, i), body = new Int32Array(X.memory.buffer, X.nb_io_body(), (H + 2) * 7);
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
    return unstep(this, X.ns_advance(this.ctx, node._i, k, k === 3 ? m[0] : 0, k === 3 ? m[1] : 0, frames | 0));
  };
  Search.prototype.steps = function () { return X.ns_steps(this.ctx); };
  // A node the level loop made: its move, its parent and its line's tag, as
  // the JS loop would have written them on it.
  Search.prototype.wrapLoop = function (i) {
    var n = this.wrap(i), S = this;
    if (Object.prototype.hasOwnProperty.call(n, 'tag')) return n;
    var v = new Int32Array(X.memory.buffer, X.ns_node(this.ctx, i), NODEOFF.size >> 2), o = NODEOFF;
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
    var base = X.ns_tags(this.ctx, n), stride = X.ns_tag_stride(this.ctx);
    if (!base) throw new Error('Native: out of memory');
    var T = new Int32Array(X.memory.buffer, base, stride * 7);
    for (i = 0; i < n; i++) {
      T[i] = o.verdict[i] ? 2 : 0;
      T[stride + i] = idx(S, o.proofs[i]);
      T[2 * stride + i] = idx(S, o.weak[i]);
      T[3 * stride + i] = o.reach[i] === undefined ? 0 : o.reach[i];
      T[4 * stride + i] = o.reach[i] === undefined ? 0 : 1;
      T[5 * stride + i] = idx(S, o.far[i]);
    }
    var lv = o.level, L = X.ns_level(this.ctx, lv.length);
    if (!L && lv.length) throw new Error('Native: out of memory');
    var LA = new Int32Array(X.memory.buffer, L, lv.length);
    for (i = 0; i < lv.length; i++) LA[i] = idx(S, lv[i]);
    for (i = 0; i < lv.length; i++) X.ns_set_tag(this.ctx, lv[i]._i, lv[i].tag, lv[i].seed ? 1 : 0);
    ABORT = abortFn || null;
    var left;
    try { left = X.ns_loop(this.ctx, o.budget, o.until, o.full, o.beam, o.quota, o.seeds); } finally { ABORT = null; }
    if (left === -10) throw abortValue;
    if (left < 0) throw new Error('Native: the level loop failed (' + left + ')');
    T = new Int32Array(X.memory.buffer, X.ns_tags(this.ctx, n), stride * 7);
    for (i = 0; i < n; i++) {
      if (T[i] === 1 && !o.verdict[i]) { o.verdict[i] = 'proven'; o.newlyProven.push(i); }
      if (T[stride + i] >= 0) o.proofs[i] = S.wrapLoop(T[stride + i]);
      if (T[2 * stride + i] >= 0) o.weak[i] = S.wrapLoop(T[2 * stride + i]);
      if (T[4 * stride + i]) { o.reach[i] = T[3 * stride + i]; o.far[i] = S.wrapLoop(T[5 * stride + i]); }
    }
    var ln = X.ns_level_n(this.ctx), LB = new Int32Array(X.memory.buffer, X.ns_level(this.ctx, ln), ln);
    o.level = [];
    for (i = 0; i < ln; i++) o.level.push(S.wrapLoop(LB[i]));
    return left;
  };

  var Native = {
    init: init,
    fromStack: fromStack,
    toStack: toStack,
    free: function (h) { X.nb_free(h); },
    copy: function (h) { var d = X.nb_new(); X.nb_copy(d, h); return d; },
    clone: function (h) { var d = X.nb_new(); X.nb_clone(d, h); return d; },
    setInput: function (h, input) { X.nb_set_input(h, bits(input)); },
    run: function (h) { var e = X.nb_run(h); if (e) throw new Error('Native: board out of room (err ' + e + ')'); },
    tryQueueSwap: function (h, r, c) { return X.nb_try_queue_swap(h, r, c) === 1; },
    canSwap: function (h, r, c) { return X.nb_can_swap(h, r, c) === 1; },
    pushIncoming: function (h, g) { X.nb_push_incoming(h, g.width, g.height, g.isChain ? 1 : 0); },
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
}));
