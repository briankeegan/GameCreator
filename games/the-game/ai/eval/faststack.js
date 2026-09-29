// THE ENGINE ON NUMBERS, for the survival search. Same rules, same order of
// operations, as panel-engine.js -- a Stack whose panels live in one Int32Array
// instead of 150 objects, so a copy is one array copy and a frame touches no
// objects. The game never runs on this; the search's scratch boards do.
//
// IT MUST BE THE ENGINE, EXACTLY. So:
//   * Panels stay things that move. A panel is a handle (an offset into D);
//     a cell holds a handle (G); switchPanels trades handles. Every function
//     that touches panels is ported line for line from panel-engine.js, under
//     the same name, visiting cells in the same order.
//   * Everything else IS the engine's: FastStack inherits Stack.prototype and
//     overrides only the functions that read or write panels. run,
//     runPhysics, the timers, rise, input, cursor, scoring, stop time,
//     outgoing garbage and swap stalling are the engine's own code. There is
//     no `panels` field, so anything left unported fails, loudly.
//   * It takes only what the search makes: a board copied by cloneStack
//     (unseen rows and breaks, no rng, no idle skip, countdown over), and a
//     panel whose fields are not the types below is refused, never coerced.
//   * toStack() gives back the Stack it stands for. faststack.test.js plays
//     the two side by side and compares every field of every panel after
//     every frame; GC_ENGINE_CHECK=1 does the same inside the search.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.PanelEval = root.PanelEval || {}).FastStack = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var G0 = typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis;
  function PE() { return G0.PanelEngine; }
  var RULES = null;
  function rules() { return RULES || (RULES = G0.PanelRules || (typeof require === 'function' ? require('../../panel-rules.js') : null)); }

  var W = 6, S8 = 8;
  // Panel fields, in panel-engine.js's names. Types: 'int', 'bool', 'nint'
  // (null or int), 'nbool' (null or bool), 'ubool' (undefined or bool),
  // 'uint' (undefined or int), 'state'.
  var FIELDS = [
    ['row', 'int'], ['col', 'int'], ['id', 'int'], ['color', 'int'], ['chaining', 'bool'], ['matching', 'bool'],
    ['timer', 'int'], ['initialTime', 'int'], ['popTime', 'int'], ['popIndex', 'int'], ['xOffset', 'nint'],
    ['yOffset', 'nint'], ['gWidth', 'int'], ['gHeight', 'int'], ['shakeTime', 'int'], ['isGarbage', 'bool'],
    ['state', 'state'], ['comboIndex', 'nint'], ['comboSize', 'nint'], ['swapFromLeft', 'nbool'],
    ['dontSwap', 'bool'], ['queuedHover', 'bool'], ['fellFromGarbage', 'int'], ['stateChanged', 'bool'],
    ['propagatesChaining', 'bool'], ['matchAnyway', 'bool'], ['propagatesFalling', 'ubool'], ['garbageId', 'uint']
  ];
  var NF = FIELDS.length;
  var ROW = 0, COL = 1, ID = 2, COLOR = 3, CHAINING = 4, MATCHING = 5, TIMER = 6, INITIALTIME = 7, POPTIME = 8,
      POPINDEX = 9, XOFF = 10, YOFF = 11, GWIDTH = 12, GHEIGHT = 13, SHAKETIME = 14, ISGARBAGE = 15, STATE = 16,
      COMBOINDEX = 17, COMBOSIZE = 18, SWAPFROMLEFT = 19, DONTSWAP = 20, QUEUEDHOVER = 21, FELL = 22,
      STATECHANGED = 23, PROPCHAIN = 24, MATCHANYWAY = 25, PROPFALL = 26, GARBAGEID = 27;
  var NUL = -2147483648, UND = -2147483647;
  var STATES = ['normal', 'dimmed', 'swapping', 'matched', 'popping', 'popped', 'hovering', 'falling', 'landing'];
  var NORMAL = 0, DIMMED = 1, SWAPPING = 2, MATCHED = 3, POPPING = 4, POPPED = 5, HOVERING = 6, FALLING = 7, LANDING = 8;

  // A null or undefined read in arithmetic, as JS reads it: null is 0.
  function nz(v) { return v === NUL ? 0 : v; }
  function out(v, type) {
    if (type === 'state') return STATES[v];
    if (v === NUL) return null;
    if (v === UND) return undefined;
    if (type === 'bool' || type === 'nbool' || type === 'ubool') return v === 1;
    return v;
  }
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
    throw new Error('FastStack: panel field ' + k + ' = ' + JSON.stringify(v) + ' is not a ' + type);
  }

  // The functions a copied board runs with (puyocpu.js registers them).
  var CLONE = null;
  function FastStack() {}
  FastStack.register = function (fns) { CLONE = fns; };
  FastStack.FIELDS = FIELDS;

  // Built on first use, so panel-engine.js may load after this file.
  function setup() {
    if (FastStack.prototype.run) return;
    var proto = Object.create(PE().Stack.prototype), own = FastStack.prototype, k;
    for (k in own) if (Object.prototype.hasOwnProperty.call(own, k)) proto[k] = own[k];
    for (k in OVERRIDES) proto[k] = OVERRIDES[k];
    proto.constructor = FastStack;
    FastStack.prototype = proto;
  }

  // ---------------------------------------------------------------- storage
  function alloc(s) {
    var h;
    if (s.free.length) h = s.free.pop();
    else {
      h = s.top; s.top += NF;
      if (s.top > s.D.length) { var d = new Int32Array(Math.max(s.top, s.D.length * 2)); d.set(s.D); s.D = d; }
    }
    return h;
  }
  function growRows(s, n) {
    if (n * S8 <= s.G.length) return;
    var g = new Int32Array(Math.max(n * S8, s.G.length * 2)); g.set(s.G); s.G = g;
  }
  function cell(s, row, col) { return s.G[row * S8 + col]; }

  // A board the search made: cloneStack's copy of it, taken over.
  FastStack.fromStack = function (src) {
    setup();
    if (!CLONE) throw new Error('FastStack: puyocpu.js has not registered the copy functions');
    var st = CLONE.cloneStack(src);
    if (st.doCountdown || st.allowIdleSkip || st.rng !== CLONE.noRng ||
        st.generateRowColors !== CLONE.unseenRow || st.garbageRowColors !== CLONE.unseenBreak) {
      throw new Error('FastStack: not a board the search copied');
    }
    var keys = [], k, r, c, f;
    for (k in st) if (Object.prototype.hasOwnProperty.call(st, k) && k !== 'panels') keys.push(k);
    var rows = st.panels, n = rows.length;
    var init = { D: new Int32Array((n * W + 8) * NF), G: new Int32Array(Math.max(n, 32) * S8), top: NF, free: [], nrows: n };
    var s = build(keys.concat(TAIL), function (x) { return init.hasOwnProperty(x) ? init[x] : st[x]; });
    s.D[WRITE] = 1;
    for (r = 0; r < n; r++) {
      if (rows[r][0] !== null) throw new Error('FastStack: row ' + r + ' has a column 0');
      for (c = 1; c <= W; c++) {
        var p = rows[r][c], h = alloc(s), D = s.D;
        for (k in p) if (Object.prototype.hasOwnProperty.call(p, k) && FIELD_INDEX[k] === undefined) throw new Error('FastStack: unknown panel field ' + k);
        for (f = 0; f < NF; f++) D[h + f] = inn(p[FIELDS[f][0]], FIELDS[f][1], FIELDS[f][0]);
        if (D[h + ROW] !== r || D[h + COL] !== c) throw new Error('FastStack: panel at ' + r + ',' + c + ' says ' + D[h + ROW] + ',' + D[h + COL]);
        s.G[r * S8 + c] = h;
      }
    }
    return s;
  };
  var FIELD_INDEX = {};
  FIELDS.forEach(function (x, i) { FIELD_INDEX[x[0]] = i; });

  // ONE SHAPE PER FIELD LIST. An object grown a field at a time drops to
  // V8's dictionary mode, and every field read on it is then a hash lookup:
  // measured, it made this engine slower than the one it replaces. So each
  // board is built by a constructor generated for its field list, as
  // cloneStack builds its copies. `pick(k)` gives each field's value.
  var makers = {};
  function build(keys, pick) {
    var sig = keys.join(','), Make = makers[sig];
    if (!Make) {
      var body = keys.map(function (k) { return 'this[' + JSON.stringify(k) + '] = pick(' + JSON.stringify(k) + ');'; }).join('\n');
      Make = makers[sig] = new Function('pick', 'keys', body + '\nthis._keys = keys;');
      Make.prototype = FastStack.prototype;
      Make.keys = keys;
    }
    return new Make(pick, Make.keys);
  }
  var TAIL = ['D', 'G', 'top', 'free', 'nrows'];
  // BOARD ARRAYS CUT FROM CHUNKS. A 16KB typed array is allocated outside
  // the JS heap, and allocating one cost as much as copying the rest of a
  // board; views into a shared 1MB chunk cost next to nothing. A slot is
  // never reused -- a chunk is freed when the last board viewing it is -- and
  // anything sent to another thread is sliced out of it first (pack).
  var CHUNK = 1 << 15, chunk = null, chunkAt = 0;
  function sliceInts(src, n) {
    if (n > CHUNK >> 2) return src.slice(0, n);
    if (!chunk || chunkAt + n > CHUNK) { chunk = new Int32Array(CHUNK); chunkAt = 0; }
    var v = chunk.subarray(chunkAt, chunkAt + n);
    chunkAt += n;
    v.set(src.subarray(0, n));
    return v;
  }
  // Copiers generated per field list, like cloneStack's: no callback, no
  // switch, one fixed shape. `mode` 'copy' keeps everything (copy()); 'clone'
  // is cloneStack's copy (clone()).
  function shallow(v) {
    if (Array.isArray(v)) return v.map(function (x) { return x && typeof x === 'object' ? Object.assign({}, x) : x; });
    return Object.assign({}, v);
  }
  var copiers = {};
  function copier(keys, mode) {
    var slot = mode === 'clone' ? '_clone' : '_copy';
    if (keys[slot]) return keys[slot];
    var sig = mode + ':' + keys.join(','), C = copiers[sig];
    if (C) return stash(keys, slot, C);
    var body = ['var v;'];
    keys.forEach(function (k) {
      var K = JSON.stringify(k), dst = 'this[' + K + ']', src = 's[' + K + ']';
      if (k === 'D') body.push(dst + ' = sliceInts(s.D, s.top);');
      else if (k === 'G') body.push(dst + ' = sliceInts(s.G, s.nrows * ' + S8 + ');');
      else if (k === 'free') body.push(dst + ' = s.free.slice();');
      else if (k === 'levelData' || k === 'frames' || k === 'top' || k === 'nrows') body.push(dst + ' = ' + src + ';');
      else if (mode === 'clone' && (k === 'events' || k === 'outgoing')) body.push(dst + ' = [];');
      else if (mode === 'clone' && k === 'rng') body.push(dst + ' = fns.noRng;');
      else if (mode === 'clone' && k === 'generateRowColors') body.push(dst + ' = fns.unseenRow;');
      else if (mode === 'clone' && k === 'garbageRowColors') body.push(dst + ' = fns.unseenBreak;');
      else if (mode === 'clone' && k === 'allowIdleSkip') body.push(dst + ' = false;');
      else if (mode === 'clone' && (k === 'unseenRows' || k === 'unseenBreaks')) body.push(dst + ' = ' + src + ' || 0;');
      else body.push('v = ' + src + '; ' + dst + ' = (v !== null && typeof v === "object") ? shallow(v) : v;');
    });
    body.push('this._keys = keys;');
    C = copiers[sig] = new Function('shallow', 'fns', 'keys', 'sliceInts', 'return function C(s) {\n' + body.join('\n') + '\n};')(shallow, CLONE, keys, sliceInts);
    C.prototype = FastStack.prototype;
    return stash(keys, slot, C);
  }
  // Kept on the field list itself, out of sight of JSON and structured clone
  // (the list travels to worker threads with each board).
  function stash(keys, slot, C) {
    Object.defineProperty(keys, slot, { value: C, enumerable: false, configurable: true, writable: true });
    return C;
  }

  // cloneStack's copy of every non-panel field.
  function copyField(k, v) {
    if (k === 'levelData' || k === 'frames') return v;
    if (k === 'events' || k === 'outgoing') return [];
    if (Array.isArray(v)) return v.map(function (x) { return x && typeof x === 'object' ? Object.assign({}, x) : x; });
    if (v && typeof v === 'object') return Object.assign({}, v);
    return v;
  }
  // What cloneStack(this.toStack()) would be, taken over.
  FastStack.prototype.clone = function () {
    var C = copier(this._keys, 'clone');
    return new C(this);
  };
  FastStack.prototype.cloneSlow = function () {
    var src = this;
    return build(this._keys, function (k) {
      switch (k) {
        case 'rng': return CLONE.noRng;
        case 'allowIdleSkip': return false;
        case 'generateRowColors': return CLONE.unseenRow;
        case 'garbageRowColors': return CLONE.unseenBreak;
        case 'unseenRows': return src.unseenRows || 0;
        case 'unseenBreaks': return src.unseenBreaks || 0;
        case 'D': return src.D.slice(0, src.top);
        case 'G': return src.G.slice(0, src.nrows * S8);
        case 'top': return src.top;
        case 'free': return src.free.slice();
        case 'nrows': return src.nrows;
      }
      return copyField(k, src[k]);
    });
  };
  // FOR ANOTHER THREAD: the numbers as they are, and every other field as
  // data. unpack(pack(s)) is s -- the functions a copied board carries and
  // the level's shared tables are put back, not sent.
  var NOT_SENT = { D: 1, G: 1, free: 1, top: 1, nrows: 1, rng: 1, generateRowColors: 1, garbageRowColors: 1, levelData: 1, frames: 1, _keys: 1 };
  // Numbers and booleans travel as float64 (NaN, -0 and the infinities
  // exactly), null and undefined as a kind; every other field -- the arrays
  // and objects -- as data in `rest`. kinds: 0 not sent, 1 number, 2 false,
  // 3 true, 4 null, 5 undefined, 6 in rest.
  FastStack.prototype.pack = function () {
    var keys = this._keys, n = keys.length, num = new Float64Array(n), kinds = '', rest = {}, i;
    for (i = 0; i < n; i++) {
      var k = keys[i], v = this[k];
      if (NOT_SENT[k]) { kinds += '0'; continue; }
      if (typeof v === 'number') { num[i] = v; kinds += '1'; }
      else if (v === false) kinds += '2';
      else if (v === true) kinds += '3';
      else if (v === null) kinds += '4';
      else if (v === undefined) kinds += '5';
      else { rest[k] = v; kinds += '6'; }
    }
    return { keys: keys, num: num, kinds: kinds, rest: rest, D: this.D.slice(0, this.top), G: this.G.slice(0, this.nrows * S8),
             free: this.free.slice(), top: this.top, nrows: this.nrows };
  };
  // `rest` may still be text from the pool (a Uint16Array): parse(rest) reads it.
  FastStack.unpack = function (p, parse) {
    setup();
    var rest = p.rest instanceof Uint16Array ? parse(p.rest) : p.rest, keys = p.keys, kinds = p.kinds, num = p.num;
    var lv = PE().LEVELS[num[keys.indexOf('level')] - 1];
    var at = {};
    for (var i = 0; i < keys.length; i++) at[keys[i]] = i;
    return build(keys, function (k) {
      switch (k) {
        case 'D': return p.D;
        case 'G': return p.G;
        case 'free': return p.free.slice();
        case 'top': return p.top;
        case 'nrows': return p.nrows;
        case 'rng': return CLONE.noRng;
        case 'generateRowColors': return CLONE.unseenRow;
        case 'garbageRowColors': return CLONE.unseenBreak;
        case 'levelData': return lv;
        case 'frames': return lv.frames;
      }
      var j = at[k];
      switch (kinds.charAt(j)) {
        case '1': return num[j];
        case '2': return false;
        case '3': return true;
        case '4': return null;
        case '5': return undefined;
      }
      return rest[k];
    });
  };
  // What the search reads off a packed board, without building it: its
  // grid and key now, its legal swaps when asked.
  FastStack.viewOf = function (p, height, clock) {
    setup();
    var v = Object.create(FastStack.prototype);
    v.D = p.D; v.G = p.G; v.nrows = p.nrows; v.height = height; v.clock = clock; v.doCountdown = false;
    return v;
  };

  // THIS BOARD, AS IT IS -- not what cloneStack makes of it. Outgoing
  // garbage and events are kept, and a chain still growing stays the same
  // object as its entry in outgoing, so play can go on from the copy exactly
  // as it would have gone on from this.
  FastStack.prototype.copy = function () {
    var chainAt = this.currentChain && this.outgoing ? this.outgoing.indexOf(this.currentChain) : -1;
    var C = copier(this._keys, 'copy'), s = new C(this);
    if (chainAt >= 0) s.currentChain = s.outgoing[chainAt];
    if (this.prevInput === this.input) s.prevInput = s.input;
    return s;
  };
  FastStack.prototype.copySlow = function () {
    var src = this, chainAt = -1;
    if (this.currentChain && this.outgoing) chainAt = this.outgoing.indexOf(this.currentChain);
    var s = build(this._keys, function (k) {
      switch (k) {
        case 'D': return src.D.slice(0, src.top);
        case 'G': return src.G.slice(0, src.nrows * S8);
        case 'free': return src.free.slice();
        case 'levelData': case 'frames': return src[k];
      }
      var v = src[k];
      if (typeof v === 'function') return v;
      if (Array.isArray(v)) return v.map(function (x) { return x && typeof x === 'object' ? Object.assign({}, x) : x; });
      if (v && typeof v === 'object') return Object.assign({}, v);
      return v;
    });
    if (chainAt >= 0) s.currentChain = s.outgoing[chainAt];
    if (this.prevInput === this.input) s.prevInput = s.input;
    return s;
  };
  // The id of row 0's first panel: it changes when, and only when, a new
  // row is made.
  FastStack.prototype.rowStamp = function () { return this.D[this.G[1] + ID]; };

  // The Stack this is: every field, every panel with all its fields.
  FastStack.prototype.toStack = function () {
    var o = Object.create(PE().Stack.prototype), k, r, c, f, D = this.D;
    for (k in this) {
      if (!Object.prototype.hasOwnProperty.call(this, k) || k === 'D' || k === 'G' || k === 'top' || k === 'free' || k === 'nrows' || k === '_keys') continue;
      var v = this[k];
      o[k] = typeof v === 'function' || k === 'levelData' || k === 'frames' ? v
           : Array.isArray(v) ? v.map(function (x) { return x && typeof x === 'object' ? Object.assign({}, x) : x; })
           : v && typeof v === 'object' ? Object.assign({}, v) : v;
    }
    var rows = new Array(this.nrows);
    for (r = 0; r < this.nrows; r++) {
      var row = [null];
      for (c = 1; c <= W; c++) {
        var h = this.G[r * S8 + c], p = {};
        for (f = 0; f < NF; f++) p[FIELDS[f][0]] = out(D[h + f], FIELDS[f][1]);
        row[c] = p;
      }
      rows[r] = row;
    }
    o.panels = rows;
    return o;
  };

  // ------------------------------------------------------ panels (Panel.lua)
  function clearFlags(D, p, clearChaining) {
    D[p + STATE] = NORMAL;
    D[p + COMBOINDEX] = NUL;
    D[p + COMBOSIZE] = NUL;
    D[p + SWAPFROMLEFT] = NUL;
    D[p + DONTSWAP] = 0;
    D[p + QUEUEDHOVER] = 0;
    if (clearChaining) D[p + CHAINING] = 0;
    D[p + FELL] = 0;
    D[p + STATECHANGED] = 0;
    D[p + PROPCHAIN] = 0;
    D[p + MATCHANYWAY] = 0;
  }
  function clearPanel(D, p, clearChaining, clearColor) {
    if (clearColor) D[p + COLOR] = 0;
    D[p + TIMER] = 0;
    D[p + INITIALTIME] = 0;
    D[p + POPTIME] = 0;
    D[p + POPINDEX] = 0;
    D[p + XOFF] = NUL;
    D[p + YOFF] = NUL;
    D[p + GWIDTH] = 0;
    D[p + GHEIGHT] = 0;
    D[p + SHAKETIME] = 0;
    D[p + ISGARBAGE] = 0;
    clearFlags(D, p, clearChaining);
  }
  function makePanel(s, row, col, id) {
    var p = alloc(s), D = s.D;
    D[p + ROW] = row; D[p + COL] = col; D[p + ID] = id; D[p + COLOR] = 0; D[p + CHAINING] = 0; D[p + MATCHING] = 0;
    clearPanel(D, p, true, true);
    D[p + PROPFALL] = UND; D[p + GARBAGEID] = UND;
    return p;
  }
  function panelBelow(s, p) { return s.G[(s.D[p + ROW] - 1) * S8 + s.D[p + COL]]; }
  function switchPanels(s, a, b) {
    var D = s.D, aRow = D[a + ROW], aCol = D[a + COL];
    D[a + ROW] = D[b + ROW]; D[a + COL] = D[b + COL];
    D[b + ROW] = aRow; D[b + COL] = aCol;
    s.G[D[a + ROW] * S8 + D[a + COL]] = a;
    s.G[D[b + ROW] * S8 + D[b + COL]] = b;
  }
  function supportedFromBelow(s, p) {
    var D = s.D;
    if (D[p + ROW] <= 1) return true;
    if (!D[p + ISGARBAGE]) return D[cell(s, D[p + ROW] - 1, D[p + COL]) + COLOR] !== 0;
    var start = D[p + COL] - nz(D[p + XOFF]);
    var end = start + D[p + GWIDTH] - 1;
    for (var col = start; col <= end; col++) {
      var below = cell(s, D[p + ROW] - 1, col);
      if (D[below + COLOR] !== 0) {
        if (!D[below + ISGARBAGE]) return true;
        if (D[p + GARBAGEID] === D[below + GARBAGEID]) {
          if (D[p + YOFF] !== D[below + YOFF]) return true;
        } else {
          return true;
        }
      }
    }
    return false;
  }
  function fall(s, p) {
    var below = panelBelow(s, p), D = s.D;
    switchPanels(s, p, below);
    if (D[p + ISGARBAGE]) {
      D[below + PROPFALL] = 1;
      D[below + STATECHANGED] = 1;
    }
    if (D[p + STATE] !== FALLING) {
      D[p + STATE] = FALLING;
      D[p + TIMER] = 0;
      D[p + STATECHANGED] = 1;
    }
  }
  function land(s, p) {
    var D = s.D;
    s.events.push({ type: "landed", row: D[p + ROW], col: D[p + COL], garbage: !!D[p + ISGARBAGE] });
    if (D[p + ISGARBAGE]) {
      onGarbageLand(s, p);
      D[p + STATE] = NORMAL;
    } else {
      D[p + FELL] = 0;
      D[p + STATE] = LANDING;
      D[p + TIMER] = 12;
    }
    D[p + STATECHANGED] = 1;
  }
  function onGarbageLand(s, p) {
    var D = s.D;
    if (D[p + SHAKETIME] && D[p + ROW] <= s.height) {
      if (s.garbageLandedThisFrame.indexOf(out(D[p + GARBAGEID], 'uint')) === -1) {
        s.shakeTimeOnFrame = Math.max(s.shakeTimeOnFrame, D[p + SHAKETIME], s.peakShakeTime);
        s.peakShakeTime = Math.max(s.shakeTimeOnFrame, s.peakShakeTime);
        s.garbageLandedThisFrame.push(out(D[p + GARBAGEID], 'uint'));
        s.events.push({ type: "garbageLand", row: D[p + ROW], col: D[p + COL] });
      }
      D[p + SHAKETIME] = 0;
    }
  }
  function enterHoverFromNormal(s, p, below, hoverTime) {
    var D = s.D;
    clearFlags(D, p, false);
    D[p + STATE] = HOVERING;
    if (D[below + PROPCHAIN]) {
      D[p + PROPCHAIN] = 1;
      D[p + CHAINING] = 1;
      if (D[below + COLOR] === 0 || D[below + MATCHANYWAY]) {
        D[p + MATCHANYWAY] = 1;
      } else {
        var source = below;
        while (D[source + STATE] === SWAPPING ||
          (D[source + STATECHANGED] && D[source + PROPCHAIN] && !D[source + MATCHANYWAY] && D[source + STATE] === HOVERING)) {
          source = panelBelow(s, source);
        }
        if (D[source + PROPCHAIN]) D[p + MATCHANYWAY] = (D[source + COLOR] === 0 || D[source + MATCHANYWAY]) ? 1 : 0;
      }
    }
    D[p + TIMER] = hoverTime;
    D[p + STATECHANGED] = 1;
  }
  function updateNormal(s, p) {
    var D = s.D;
    if (D[p + ISGARBAGE]) {
      if (!supportedFromBelow(s, p)) fall(s, p);
      return;
    }
    if (D[p + COLOR] === 0 || D[p + ROW] < 1) return;
    var below = panelBelow(s, p);
    if (!D[below + STATECHANGED]) return;
    if (D[below + STATE] === HOVERING) {
      enterHoverFromNormal(s, p, below, D[below + TIMER]);
    } else if (D[below + COLOR] === 0) {
      if (D[below + PROPFALL] === 1) {
        fall(s, p);
      } else if (D[below + STATE] === NORMAL) {
        enterHoverFromNormal(s, p, below, s.frames.HOVER);
      }
    } else if (D[below + QUEUEDHOVER] && D[below + PROPCHAIN] && D[below + STATE] === SWAPPING) {
      var hoverTime = D[below + TIMER];
      var hoverPanel = panelBelow(s, below);
      while (hoverPanel && D[hoverPanel + STATE] === SWAPPING) {
        hoverTime += D[hoverPanel + TIMER];
        hoverPanel = D[hoverPanel + ROW] > 1 ? panelBelow(s, hoverPanel) : null;
      }
      hoverTime += (hoverPanel && D[hoverPanel + STATE] === HOVERING) ? D[hoverPanel + TIMER] : s.frames.HOVER;
      enterHoverFromNormal(s, p, below, hoverTime);
    }
  }
  function finishSwap(D, p) {
    D[p + STATE] = NORMAL;
    D[p + DONTSWAP] = 0;
    D[p + SWAPFROMLEFT] = NUL;
    D[p + STATECHANGED] = 1;
  }
  function updateSwapping(s, p) {
    var D = s.D;
    if (D[p + TIMER] > 0) D[p + TIMER]--;
    if (D[p + TIMER] === 0) {
      var below = D[p + ROW] > 1 ? panelBelow(s, p) : null;
      if (D[p + COLOR] === 0 || !below) {
        finishSwap(D, p);
      } else if (D[below + COLOR] === 0 || D[below + STATE] === HOVERING || D[p + QUEUEDHOVER]) {
        clearFlags(D, p, false);
        D[p + STATE] = HOVERING;
        D[p + PROPCHAIN] = D[below + PROPCHAIN];
        D[p + MATCHANYWAY] = (D[below + COLOR] !== 0 && D[below + STATE] === HOVERING) ? D[below + MATCHANYWAY] : 0;
        D[p + TIMER] = s.frames.HOVER;
        D[p + STATECHANGED] = 1;
      } else {
        finishSwap(D, p);
      }
    } else if (D[p + ROW] > 1) {
      var b = panelBelow(s, p);
      if (b && D[b + STATECHANGED] && D[b + PROPCHAIN]) {
        D[p + QUEUEDHOVER] = D[p + COLOR] !== 0 ? 1 : 0;
        D[p + STATECHANGED] = 1;
        D[p + PROPCHAIN] = 1;
      }
    }
  }
  function updateMatched(s, p) {
    var D = s.D;
    if (D[p + TIMER] > 0) D[p + TIMER]--;
    if (D[p + ISGARBAGE] && D[p + TIMER] === D[p + POPTIME]) {
      s.events.push({ type: "pop", row: D[p + ROW], col: D[p + COL], garbage: true, index: D[p + POPINDEX] });
    }
    if (D[p + TIMER] !== 0) return;
    if (D[p + ISGARBAGE]) {
      if (D[p + YOFF] === -1) {
        clearPanel(D, p, false, false);
        D[p + CHAINING] = 1;
        D[p + PROPCHAIN] = 1;
        D[p + TIMER] = s.frames.GARBAGE_HOVER;
        D[p + FELL] = 12;
        D[p + STATE] = HOVERING;
        D[p + STATECHANGED] = 1;
      } else {
        D[p + STATE] = NORMAL;
      }
    } else {
      D[p + STATE] = POPPING;
      D[p + TIMER] = nz(D[p + COMBOINDEX]) * s.frames.POP;
      D[p + STATECHANGED] = 1;
    }
  }
  function updatePopping(s, p) {
    var D = s.D;
    if (D[p + TIMER] > 0) D[p + TIMER]--;
    if (D[p + TIMER] !== 0) return;
    s.addScore(10);
    s.events.push({ type: "pop", row: D[p + ROW], col: D[p + COL], color: D[p + COLOR],
                    index: out(D[p + COMBOINDEX], 'nint'), size: out(D[p + COMBOSIZE], 'nint') });
    if (D[p + COMBOSIZE] === D[p + COMBOINDEX]) {
      popped(s, p);
    } else {
      D[p + STATE] = POPPED;
      D[p + TIMER] = (nz(D[p + COMBOSIZE]) - nz(D[p + COMBOINDEX])) * s.frames.POP;
      D[p + STATECHANGED] = 1;
    }
  }
  function popped(s, p) {
    var D = s.D;
    s.panelsCleared++;
    clearPanel(D, p, true, true);
    D[p + PROPCHAIN] = 1;
    D[p + STATECHANGED] = 1;
  }
  function updatePopped(s, p) {
    var D = s.D;
    if (D[p + TIMER] > 0) D[p + TIMER]--;
    if (D[p + TIMER] === 0) popped(s, p);
  }
  function updateHovering(s, p) {
    var D = s.D;
    if (D[p + TIMER] > 0) D[p + TIMER]--;
    if (D[p + MATCHANYWAY]) D[p + MATCHANYWAY] = 0;
    if (D[p + TIMER] === 0) {
      var below = panelBelow(s, p);
      if (D[below + STATE] === HOVERING) {
        D[p + TIMER] = D[below + TIMER];
      } else if (D[below + COLOR] !== 0) {
        land(s, p);
      } else {
        fall(s, p);
      }
    }
    if (!D[p + STATECHANGED] && D[p + FELL]) D[p + FELL]--;
  }
  function updateFalling(s, p) {
    var D = s.D;
    if (D[p + ROW] === 1) {
      land(s, p);
    } else if (supportedFromBelow(s, p)) {
      if (D[p + ISGARBAGE]) {
        land(s, p);
      } else {
        var below = panelBelow(s, p);
        if (D[below + STATE] === HOVERING) {
          clearFlags(D, p, false);
          D[p + STATE] = HOVERING;
          D[p + STATECHANGED] = 1;
          D[p + PROPCHAIN] = D[below + PROPCHAIN];
          D[p + TIMER] = D[below + TIMER];
        } else {
          land(s, p);
        }
      }
    } else {
      fall(s, p);
    }
    if (!D[p + STATECHANGED] && D[p + FELL]) D[p + FELL]--;
  }
  function updateLanding(s, p) {
    var D = s.D;
    updateNormal(s, p);
    if (!D[p + STATECHANGED]) {
      if (D[p + TIMER] > 0) D[p + TIMER]--;
      if (D[p + TIMER] === 0) { D[p + STATE] = NORMAL; D[p + STATECHANGED] = 1; }
    }
  }
  function updatePanel(s, p) {
    var D = s.D;
    D[p + STATECHANGED] = 0;
    D[p + PROPCHAIN] = 0;
    D[p + PROPFALL] = 0;
    D[p + MATCHING] = 0;
    switch (D[p + STATE]) {
      case NORMAL: updateNormal(s, p); break;
      case SWAPPING: updateSwapping(s, p); break;
      case MATCHED: updateMatched(s, p); break;
      case POPPING: updatePopping(s, p); break;
      case POPPED: updatePopped(s, p); break;
      case HOVERING: updateHovering(s, p); break;
      case FALLING: updateFalling(s, p); break;
      case LANDING: updateLanding(s, p); break;
      default: break;
    }
  }
  function canMatch(D, p) {
    if (D[p + COLOR] === 0 || D[p + COLOR] === 9) return false;
    var st = D[p + STATE];
    return st === NORMAL || st === LANDING || (!!D[p + MATCHANYWAY] && st === HOVERING);
  }
  function allowsSwap(D, p) {
    if (D[p + DONTSWAP] || D[p + ISGARBAGE]) return false;
    var st = D[p + STATE];
    return st === NORMAL || st === SWAPPING || st === LANDING || st === FALLING;
  }
  function sortByPopOrder(D, list, isGarbage) {
    return list.sort(function (a, b) {
      if (D[a + ROW] === D[b + ROW]) return isGarbage ? D[b + COL] - D[a + COL] : D[a + COL] - D[b + COL];
      return isGarbage ? D[a + ROW] - D[b + ROW] : D[b + ROW] - D[a + ROW];
    });
  }

  // ------------------------------------------------- the Stack's panel code
  var MATCH_EFF = null, MARK_S = null, MARK_OUT = null, LAST_EFF = null, LAST_OBJ = null, LAST_EMPTY = false;
  function markMatch(mr, mc) {
    var panel = MARK_S.G[mr * S8 + mc], D = MARK_S.D;
    if (panel && !D[panel + MATCHING]) { D[panel + MATCHING] = 1; MARK_OUT.push(panel); }
  }
  function makeEmptyRow(s, row) {
    var r = [];
    for (var col = 1; col <= W; col++) r[col] = makePanel(s, row, col, ++s.panelIdCount);
    return r;
  }
  function putRow(s, row, r) { for (var c = 1; c <= W; c++) s.G[row * S8 + c] = r[c]; }

  // WHAT A BOARD'S PANELS SAY, KEPT UNTIL ONE CHANGES. D[0] counts this
  // board's writes that can change a panel; each fact is kept in D (slots 1-12,
  // which no panel uses) with the count it was read at, and holds while the
  // count is the same. The panel functions below read only panels, rows and
  // the fixed height, so a read while nothing has been written gives the same
  // answer again -- and a pass that changed nothing, run on the same panels,
  // changes nothing again, so it is not run. A copy carries its facts, true
  // of its panels because they are the same panels.
  var WRITE = 0, TOP_AT = 1, TOP_V = 2, FALL_AT = 3, FALL_V = 4, CHN_AT = 5, CHN_V = 6, CNT_AT = 7, CNT_V = 8,
      CNT_SW = 9, MATCH_AT = 10, CHAIN_AT = 11, UPD_AT = 12;
  function wrote(s) { s.D[WRITE]++; }

  var OVERRIDES = {
    panelAt: function (row, col) {
      if (row < 0 || row >= this.nrows || col < 1 || col > W) return null;
      return this.G[row * S8 + col];
    },
    isToppedOut: function () {
      var D = this.D;
      if (D[TOP_AT] === D[WRITE]) return D[TOP_V] === 1;
      var v = this._toppedOut();
      D[TOP_AT] = D[WRITE]; D[TOP_V] = v ? 1 : 0;
      return v;
    },
    _toppedOut: function () {
      var D = this.D, G = this.G;
      for (var col = 1; col <= W; col++) {
        var p = G[(this.height) * S8 + col];
        var dangerous = D[p + ISGARBAGE] ? D[p + STATE] !== FALLING : D[p + COLOR] !== 0;
        if (dangerous) return true;
      }
      return false;
    },
    hasFallingGarbage: function () {
      var D = this.D;
      if (D[FALL_AT] === D[WRITE]) return D[FALL_V] === 1;
      var v = this._fallingGarbage();
      D[FALL_AT] = D[WRITE]; D[FALL_V] = v ? 1 : 0;
      return v;
    },
    _fallingGarbage: function () {
      var D = this.D, G = this.G;
      for (var row = Math.min(this.height + 3, this.nrows - 1); row >= 1; row--) {
        for (var col = 1; col <= W; col++) {
          var p = G[(row) * S8 + col];
          if (D[p + ISGARBAGE] && D[p + STATE] === FALLING) return true;
        }
      }
      return false;
    },
    hasChainingPanels: function () {
      var D = this.D;
      if (D[CHN_AT] === D[WRITE]) return D[CHN_V] === 1;
      var v = this._chainingPanels();
      D[CHN_AT] = D[WRITE]; D[CHN_V] = v ? 1 : 0;
      return v;
    },
    _chainingPanels: function () {
      var D = this.D, G = this.G;
      for (var row = 1; row < this.nrows; row++) {
        for (var col = 1; col <= W; col++) {
          var p = G[(row) * S8 + col];
          if (D[p + CHAINING] && D[p + COLOR] !== 0) return true;
        }
      }
      return false;
    },
    countActivePanels: function () {
      var D = this.D, G = this.G;
      if (D[CNT_AT] === D[WRITE]) {
        this.nPrevActive = this.nActive;
        this.nActive = D[CNT_V];
        this.swappingCount = D[CNT_SW];
        return;
      }
      var count = 0, swapping = 0;
      for (var row = 1; row <= this.height; row++) {
        for (var col = 1; col <= W; col++) {
          var p = G[(row) * S8 + col];
          if (D[p + COLOR] === 0) continue;
          if (D[p + ISGARBAGE]) {
            if (D[p + STATE] !== NORMAL) count++;
          } else if (D[p + STATE] !== NORMAL && D[p + STATE] !== LANDING) {
            count++;
            if (D[p + STATE] === SWAPPING) swapping++;
          }
        }
      }
      this.nPrevActive = this.nActive;
      this.nActive = count;
      this.swappingCount = swapping;
      D[CNT_AT] = D[WRITE]; D[CNT_V] = count; D[CNT_SW] = swapping;
    },
    getMatchingPanels: function () {
      var D = this.D;
      if (D[MATCH_AT] === D[WRITE]) return [];
      var matching = this._matchingPanels();
      if (matching.length) wrote(this);
      else D[MATCH_AT] = D[WRITE];
      return matching;
    },
    _matchingPanels: function () {
      var matching = [], row, col, p, i, D = this.D;
      var H = this.height, stride = W + 2, need = (H + 2) * stride;
      if (!MATCH_EFF || MATCH_EFF.length < need) MATCH_EFF = new Int8Array(need);
      var eff = MATCH_EFF, G = this.G, same = LAST_OBJ === this && LAST_EFF && LAST_EFF.length >= need;
      for (row = 1; row <= H; row++) {
        var base = row * stride;
        for (col = 1; col <= W; col++) {
          p = G[row * S8 + col];
          var e = canMatch(D, p) ? D[p + COLOR] : 0;
          eff[base + col] = e;
          if (same && LAST_EFF[base + col] !== e) same = false;
        }
      }
      // scanRuns reads nothing but eff: the same eff as this board's last
      // frame, which had no run, has none now.
      if (same && LAST_EMPTY) return matching;
      MARK_S = this; MARK_OUT = matching;
      rules().scanRuns(eff, W, H, stride, markMatch);
      MARK_S = null; MARK_OUT = null;
      if (!LAST_EFF || LAST_EFF.length < need) LAST_EFF = new Int8Array(need);
      LAST_EFF.set(eff.subarray(0, need));
      LAST_OBJ = this; LAST_EMPTY = matching.length === 0;
      for (i = 0; i < matching.length; i++) {
        if (D[matching[i] + STATE] === HOVERING) D[matching[i] + CHAINING] = 0;
      }
      return matching;
    },
    getConnectedGarbagePanels: function (matchingPanels) {
      var stack = this, D = this.D;
      var ids = {};
      var found = [];
      var queue = [];
      var deltas = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      function eligible(p) {
        return D[p + ISGARBAGE] && D[p + COLOR] === 9 && D[p + STATE] === NORMAL &&
          (D[p + ROW] - nz(D[p + YOFF]) <= stack.height || D[p + GARBAGEID] <= stack.highestGarbageIdMatched);
      }
      function addNeighbourGarbage(row, col) {
        for (var d = 0; d < deltas.length; d++) {
          var p = stack.panelAt(row + deltas[d][0], col + deltas[d][1]);
          if (p && eligible(p) && !ids[D[p + GARBAGEID]]) {
            ids[D[p + GARBAGEID]] = true;
            queue.push(D[p + GARBAGEID]);
          }
        }
      }
      for (var i = 0; i < matchingPanels.length; i++) {
        addNeighbourGarbage(D[matchingPanels[i] + ROW], D[matchingPanels[i] + COL]);
      }
      while (queue.length) {
        var id = queue.shift();
        this.highestGarbageIdMatched = Math.max(this.highestGarbageIdMatched, id);
        var block = [];
        for (var row = 1; row < this.nrows; row++) {
          for (var col = 1; col <= W; col++) {
            var p = cell(this, row, col);
            if (D[p + ISGARBAGE] && D[p + GARBAGEID] === id && D[p + COLOR] === 9) block.push(p);
          }
        }
        for (var b = 0; b < block.length; b++) {
          found.push(block[b]);
          addNeighbourGarbage(D[block[b] + ROW], D[block[b] + COL]);
        }
      }
      return found;
    },
    checkMatches: function () {
      var matching = this.getMatchingPanels();
      var comboSize = matching.length;
      var i, D = this.D;
      if (comboSize > 0) {
        wrote(this);
        var f = this.frames;
        var isChainLink = false;
        for (i = 0; i < matching.length; i++) if (D[matching[i] + CHAINING]) isChainLink = true;
        if (isChainLink) this.chainCounter = this.chainCounter === 0 ? 2 : this.chainCounter + 1;
        this.manualRaise = false;
        this.riseLock = true;
        sortByPopOrder(D, matching, false);
        for (i = 0; i < comboSize; i++) {
          var p = matching[i];
          D[p + STATE] = MATCHED;
          D[p + TIMER] = f.FLASH + f.FACE + 1;
          if (isChainLink) D[p + CHAINING] = 1;
          D[p + FELL] = 0;
          D[p + COMBOINDEX] = i + 1;
          D[p + COMBOSIZE] = comboSize;
        }
        var origin = { row: D[matching[0] + ROW], col: D[matching[0] + COL] };
        var garbagePanels = this.getConnectedGarbagePanels(matching);
        var onScreen = 0;
        for (i = 0; i < garbagePanels.length; i++) if (D[garbagePanels[i] + ROW] <= this.height) onScreen++;
        if (garbagePanels.length) {
          var garbageMatchTime = f.FLASH + f.FACE + f.POP * (comboSize + onScreen);
          this.matchGarbagePanels(garbagePanels, garbageMatchTime, isChainLink, onScreen);
        }
        var preStop = f.FLASH + f.FACE + f.POP * (comboSize + onScreen);
        this.preStopTime = Math.max(this.preStopTime, preStop);
        this.awardStopTime(isChainLink, comboSize);
        this.events.push({
          type: "match", row: origin.row, col: origin.col, chain: isChainLink,
          chainCounter: this.chainCounter, size: comboSize, garbage: garbagePanels.length
        });
        if (isChainLink || comboSize > 3) this.pushGarbage(origin, isChainLink, comboSize);
        this.updateScoreWithBonus(comboSize);
      }
      this.clearChainingFlags();
    },
    matchGarbagePanels: function (garbagePanels, garbageMatchTime, isChain, onScreenCount) {
      wrote(this);
      var D = this.D;
      sortByPopOrder(D, garbagePanels, true);
      for (var i = 0; i < garbagePanels.length; i++) {
        var p = garbagePanels[i];
        D[p + YOFF] = nz(D[p + YOFF]) - 1;
        D[p + GHEIGHT] -= 1;
        D[p + STATE] = MATCHED;
        D[p + TIMER] = garbageMatchTime + 1;
        D[p + INITIALTIME] = garbageMatchTime;
        D[p + POPTIME] = this.frames.POP * (onScreenCount - (i + 1));
        D[p + POPINDEX] = Math.min(i + 1, 10);
      }
      this.convertGarbagePanels(isChain);
    },
    convertGarbagePanels: function (isChain) {
      wrote(this);
      var D = this.D;
      for (var row = 1; row < this.nrows; row++) {
        var cols = [];
        for (var col = 1; col <= W; col++) {
          var p = cell(this, row, col);
          if (D[p + YOFF] === -1 && D[p + COLOR] === 9) cols.push(col);
        }
        if (!cols.length) continue;
        var colors = this.garbageRowColors(cols.length);
        for (var i = 0; i < cols.length; i++) {
          var panel = cell(this, row, cols[i]);
          D[panel + COLOR] = colors[i];
          if (isChain) D[panel + CHAINING] = 1;
        }
      }
    },
    clearChainingFlags: function () {
      var D = this.D, G = this.G, changed = false;
      if (D[CHAIN_AT] === D[WRITE]) return;
      for (var row = 1; row <= Math.min(this.nrows - 1, this.height + 2); row++) {
        for (var col = 1; col <= W; col++) {
          var p = G[(row) * S8 + col];
          if (!D[p + MATCHING] && D[p + CHAINING] && !D[p + MATCHANYWAY] && (canMatch(D, p) || D[p + COLOR] === 9)) {
            if (row > 1) {
              if (D[G[(row - 1) * S8 + col] + STATE] !== SWAPPING) { D[p + CHAINING] = 0; changed = true; }
            } else {
              D[p + CHAINING] = 0; changed = true;
            }
          }
        }
      }
      if (changed) wrote(this);
      else D[CHAIN_AT] = D[WRITE];
    },
    shouldDropGarbage: function () {
      var garbage = this.incoming[0];
      if (!garbage) return false;
      if (this.isToppedOut()) return false;
      if (this.hasFallingGarbage()) return false;
      for (var row = this.height + 1; row < this.nrows; row++) {
        for (var col = 1; col <= W; col++) {
          if (this.D[cell(this, row, col) + COLOR] !== 0) return false;
        }
      }
      if (!this.hasActivePanels()) return true;
      return garbage.height > 1;
    },
    dropGarbage: function (width, height) {
      wrote(this);
      var originRow = this.height + 1;
      var originCol = this.garbageSpawnColumn(width);
      var id = ++this.garbageCreatedCount;
      var shake = PE().shakeFramesFor(width, height);
      for (var row = originRow; row < originRow + height; row++) {
        while (row >= this.nrows) { growRows(this, this.nrows + 1); putRow(this, this.nrows, makeEmptyRow(this, this.nrows)); this.nrows++; }
        var D = this.D;
        for (var col = originCol; col < originCol + width; col++) {
          var p = cell(this, row, col);
          clearPanel(D, p, true, true);
          D[p + GARBAGEID] = id;
          D[p + ISGARBAGE] = 1;
          D[p + COLOR] = 9;
          D[p + GWIDTH] = width;
          D[p + GHEIGHT] = height;
          D[p + YOFF] = row - originRow;
          D[p + XOFF] = col - originCol;
          D[p + SHAKETIME] = shake;
          D[p + STATE] = FALLING;
        }
      }
      this.events.push({ type: "garbageDrop", width: width, height: height, col: originCol });
    },
    newRow: function () {
      wrote(this);
      var top = this.nrows - 1, topOccupied = false, col, c, row;
      for (col = 1; col <= W; col++) if (this.D[cell(this, top, col) + COLOR] !== 0) topOccupied = true;
      if (topOccupied) {
        growRows(this, this.nrows + 1);
        putRow(this, this.nrows, makeEmptyRow(this, this.nrows));
        this.nrows++;
      } else {
        for (col = 1; col <= W; col++) this.free.push(cell(this, top, col));
        this.nrows--;
      }
      var fresh = makeEmptyRow(this, 0);
      growRows(this, this.nrows + 1);
      this.G.copyWithin(S8, 0, this.nrows * S8);
      putRow(this, 0, fresh);
      this.nrows++;
      var D = this.D;
      for (row = 0; row < this.nrows; row++) {
        for (c = 1; c <= W; c++) D[cell(this, row, c) + ROW] = row;
      }
      for (col = 1; col <= W; col++) {
        D[cell(this, 1, col) + STATE] = NORMAL;
        D[cell(this, 1, col) + STATECHANGED] = 1;
      }
      this.fillNewRow(0);
      if (this.curRow !== 0) this.curRow = Math.min(this.curRow + 1, this.topCurRow);
      if (this.queuedSwapRow > 0) this.queuedSwapRow++;
      this.displacement = 16;
      this.events.push({ type: "newRow" });
    },
    fillNewRow: function (row) {
      wrote(this);
      var D = this.D, neighborColors = null, col;
      if (row + 1 < this.nrows) {
        neighborColors = [];
        for (col = 1; col <= W; col++) neighborColors[col] = D[cell(this, row + 1, col) + COLOR];
      }
      var rowColors = this.generateRowColors(neighborColors);
      for (col = 1; col <= W; col++) {
        var panel = cell(this, row, col);
        clearPanel(D, panel, true, true);
        D[panel + COLOR] = rowColors[col];
        D[panel + STATE] = DIMMED;
      }
    },
    canSwap: function (row, col) {
      if (this.doCountdown || this.clock <= 1) return false;
      if (row < 1 || row > this.height || col < 1 || col >= W) return false;
      var D = this.D;
      var left = cell(this, row, col);
      var right = cell(this, row, col + 1);
      if (D[left + COLOR] === 0 && D[right + COLOR] === 0) return false;
      if (!allowsSwap(D, left) || !allowsSwap(D, right)) return false;
      var above1 = 0, above2 = 0;
      if (row < this.height) {
        above1 = cell(this, row + 1, col);
        above2 = cell(this, row + 1, col + 1);
        if (D[above1 + STATE] === HOVERING || D[above2 + STATE] === HOVERING) return false;
      }
      if (D[left + COLOR] === 0 || D[right + COLOR] === 0) {
        if (above1 && above2 && D[above1 + STATE] === SWAPPING && D[above2 + STATE] === SWAPPING &&
          (D[above1 + COLOR] === 0 || D[above2 + COLOR] === 0) && (D[above1 + COLOR] !== 0 || D[above2 + COLOR] !== 0)) {
          return false;
        }
        if (row > 1) {
          var below1 = cell(this, row - 1, col);
          var below2 = cell(this, row - 1, col + 1);
          if (D[below1 + STATE] === SWAPPING && D[below2 + STATE] === SWAPPING &&
            (D[below1 + COLOR] === 0 || D[below2 + COLOR] === 0) && (D[below1 + COLOR] !== 0 || D[below2 + COLOR] !== 0)) {
            return false;
          }
        }
      }
      return true;
    },
    doSwap: function (row, col) {
      wrote(this);
      var D = this.D;
      var left = cell(this, row, col);
      var right = cell(this, row, col + 1);
      startSwap(D, left, true);
      startSwap(D, right, false);
      switchPanels(this, left, right);
      var tmp = left; left = right; right = tmp;
      if (row !== 1) {
        var bl = cell(this, row - 1, col), br = cell(this, row - 1, col + 1);
        if (D[left + COLOR] !== 0 && (D[bl + COLOR] === 0 || D[bl + STATE] === FALLING)) D[left + DONTSWAP] = 1;
        if (D[right + COLOR] !== 0 && (D[br + COLOR] === 0 || D[br + STATE] === FALLING)) D[right + DONTSWAP] = 1;
      }
      if (row !== this.height) {
        if (D[left + COLOR] === 0 && D[cell(this, row + 1, col) + COLOR] !== 0) D[left + DONTSWAP] = 1;
        if (D[right + COLOR] === 0 && D[cell(this, row + 1, col + 1) + COLOR] !== 0) D[right + DONTSWAP] = 1;
      }
      this.events.push({ type: "swap", row: row, col: col });
    },
    updatePanels: function () {
      this.shakeTimeOnFrame = 0;
      var G = this.G, D = this.D, n = this.nrows, changed = false;
      if (D[UPD_AT] === D[WRITE]) return;
      for (var row = 1; row < n; row++) {
        for (var col = 1; col <= W; col++) {
          var p = G[row * S8 + col];
          if (D[p + STATE] === NORMAL) {
            // updatePanel's resets, then updateNormal, with what changes noted.
            var flags = D[p + STATECHANGED] !== 0 || D[p + PROPCHAIN] !== 0 || D[p + PROPFALL] !== 0 || D[p + MATCHING] !== 0;
            if (D[p + ISGARBAGE] === 0) {
              if (D[p + COLOR] === 0 && !flags) continue;
              if (flags) { D[p + STATECHANGED] = 0; D[p + PROPCHAIN] = 0; D[p + PROPFALL] = 0; D[p + MATCHING] = 0; changed = true; }
              if (D[p + COLOR] === 0 || !D[G[(row - 1) * S8 + col] + STATECHANGED]) continue;
              updateNormal(this, p);
              changed = true;
              continue;
            }
            if (flags) { D[p + STATECHANGED] = 0; D[p + PROPCHAIN] = 0; D[p + PROPFALL] = 0; D[p + MATCHING] = 0; changed = true; }
            if (!supportedFromBelow(this, p)) { fall(this, p); changed = true; }
            continue;
          }
          updatePanel(this, p);
          changed = true;
        }
      }
      if (changed) wrote(this);
      else D[UPD_AT] = D[WRITE];
    },
    fillRatio: function () {
      var highest = 0, D = this.D;
      for (var row = this.height; row >= 1; row--) {
        for (var col = 1; col <= W; col++) {
          if (D[cell(this, row, col) + COLOR] !== 0) { highest = row; break; }
        }
        if (highest) break;
      }
      return highest / this.height;
    },
    // Refused rather than ported: the search's boards never count down, never
    // idle-skip and never draw a board from the rng.
    runCountdown: function () { throw new Error('FastStack: no countdown'); },
    hasPendingMatch: function () { throw new Error('FastStack: no idle skip'); },
    idleSkip: function () { if (this.allowIdleSkip) throw new Error('FastStack: no idle skip'); return 0; },
    generateRowColors: function () { throw new Error('FastStack: no rng'); },
    buildStartingBoard: function () { throw new Error('FastStack: no rng'); },
    makeEmptyRow: function () { throw new Error('FastStack: rows are made inside newRow and dropGarbage'); },
    touchSwap: function () { throw new Error('FastStack: not used by the search'); }
  };
  function startSwap(D, p, fromLeft) {
    var chaining = D[p + CHAINING];
    clearFlags(D, p, false);
    D[p + STATECHANGED] = 1;
    D[p + STATE] = SWAPPING;
    D[p + CHAINING] = chaining;
    D[p + TIMER] = 4;
    D[p + SWAPFROMLEFT] = fromLeft ? 1 : 0;
    D[p + FELL] = 0;
  }

  // ------------------------------------------------------------- the check
  // THE ONE DEFINITION OF "THE SAME": every field of every panel (null,
  // undefined, false and 0 all different), and every other field of the two
  // Stacks, deeply, events included. Returns the first difference, or null.
  function same(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a === 'function' || typeof b === 'function') return a === b;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a), kb = Object.keys(b), k, i;
    for (i = 0; i < kb.length; i++) if (ka.indexOf(kb[i]) < 0 && b[kb[i]] !== undefined) return false;
    for (i = 0; i < ka.length; i++) { k = ka[i]; if (!same(a[k], b[k])) return false; }
    return true;
  }
  FastStack.same = same;
  FastStack.diff = function (a, b) {
    if (a.panels.length !== b.panels.length) return 'rows: ' + a.panels.length + ' vs ' + b.panels.length;
    for (var r = 0; r < a.panels.length; r++) {
      if (a.panels[r][0] !== b.panels[r][0]) return 'panels[' + r + '][0]';
      for (var c = 1; c <= W; c++) {
        var p = a.panels[r][c], q = b.panels[r][c];
        for (var f = 0; f < NF; f++) {
          var k = FIELDS[f][0];
          if (!Object.is(p[k], q[k])) return 'panel ' + r + ',' + c + ' ' + k + ': ' + JSON.stringify(p[k]) + ' vs ' + JSON.stringify(q[k]) +
                                            (p[k] === undefined ? ' (undefined)' : '') + (q[k] === undefined ? ' (undefined)' : '');
        }
      }
    }
    var keys = {}, k2;
    for (k2 in a) if (Object.prototype.hasOwnProperty.call(a, k2)) keys[k2] = 1;
    for (k2 in b) if (Object.prototype.hasOwnProperty.call(b, k2)) keys[k2] = 1;
    for (k2 in keys) {
      if (k2 === 'panels') continue;
      if (!same(a[k2], b[k2])) return k2 + ': ' + JSON.stringify(a[k2]) + ' vs ' + JSON.stringify(b[k2]);
    }
    return null;
  };

  // ------------------------------------------ what the search reads off it
  var STATE_CHAR = STATES.map(function (x) { return x.charAt(0); });
  // puyocpu.js engineGrid, from the numbers.
  FastStack.prototype.grid = function () {
    var H = this.height, grid = [], key = '', r, c, D = this.D;
    for (r = 0; r <= H + 1; r++) {
      var g = [0], has = r < this.nrows;
      for (c = 1; c <= W; c++) {
        var p = has ? cell(this, r, c) : 0;
        if (!p || D[p + COLOR] === 0) g[c] = 0;
        else g[c] = D[p + ISGARBAGE] ? -2 : D[p + COLOR];
        if (r >= 1 && p) key += (D[p + ISGARBAGE] ? '#' : D[p + COLOR]) + STATE_CHAR[D[p + STATE]] + (D[p + TIMER] || '') + ',';
      }
      grid[r] = g;
    }
    return { grid: grid, key: key };
  };
  // puyocpu.js legalSwaps, from the numbers.
  FastStack.prototype.legalSwaps = function () {
    var out = [], D = this.D;
    for (var r = 1; r <= this.height; r++) for (var c = 1; c < W; c++) {
      var a = cell(this, r, c), b2 = cell(this, r, c + 1);
      if (D[a + ISGARBAGE] || D[b2 + ISGARBAGE]) continue;
      if (D[a + COLOR] === 0 && D[b2 + COLOR] === 0) continue;
      if (D[a + COLOR] === D[b2 + COLOR]) continue;
      if (!this.canSwap(r, c)) continue;
      out.push([r, c]);
    }
    return out;
  };

  return FastStack;
}));
