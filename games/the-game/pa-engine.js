(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PAEngine = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var W = 6, H = 12;

  var SPEED_TO_RISE_TIME = [
    942, 983, 838, 790, 755, 695, 649, 604, 570, 515, 474, 444, 394, 370, 347, 325, 306, 289, 271, 256,
    240, 227, 213, 201, 189, 178, 169, 158, 148, 138, 129, 120, 112, 105, 99, 92, 86, 82, 77, 73,
    69, 66, 62, 59, 56, 54, 52, 50, 48, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
    47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
    47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47
  ].map(function (x) { return x / 16; });
  var GARBAGE_SIZE_TO_SHAKE_FRAMES = [18, 18, 18, 18, 24, 42, 42, 42, 42, 42, 42, 66,
    66, 66, 66, 66, 66, 66, 66, 66, 66, 66, 66, 76];
  var DT_SPEED_INCREASE = 15 * 60;
  var COUNTDOWN_START = 8, COUNTDOWN_LENGTH = 180, COUNTDOWN_CURSOR_SPEED = 4;   // consts.lua
  var SCORE_COMBO_TA = [0, 0, 0, 0, 20, 30, 50, 60, 70, 80, 100, 140, 170, 210, 250, 290, 340, 390, 440, 490, 550,
                        610, 680, 750, 820, 900, 980, 1060, 1150, 1240, 1330];
  var SCORE_CHAIN_TA = [0, 0, 50, 80, 150, 300, 400, 500, 700, 900, 1100, 1300, 1500, 1800];
  var DROP_COLUMNS = [null, [1, 2, 3, 4, 5, 6], [1, 3, 5], [1, 4], [1, 2, 3], [1, 2], [1]];
  var LETTER = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 0,
                 a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 0 };
  var DIR_ROW = { up: 1, down: -1, left: 0, right: 0 }, DIR_COL = { up: 0, down: 0, left: -1, right: 1 };
  var IN = { right: 1, left: 2, down: 4, up: 8, swap: 16, raise: 32 };
  function bound(a, b, c) { return b < a ? a : b > c ? c : b; }
  function wrap(a, b, c) { return ((b - a) % (c - a + 1) + (c - a + 1)) % (c - a + 1) + a; }
  function set(v) { return v !== null && v !== undefined && v !== false; }   // Lua truthiness

  function clearFlags(p, clearChaining) {
    p.state = 'normal';
    p.comboIndex = null; p.comboSize = null; p.swapFromLeft = null; p.dontSwap = null; p.queuedHover = null;
    if (clearChaining) p.chaining = null;
    p.fellFromGarbage = null;
    p.stateChanged = false; p.propagatesChaining = false; p.matchAnyway = false;
  }
  function clearPanel(p, clearChaining, clearColor) {
    if (clearColor) p.color = 0;
    p.timer = 0;
    p.initialTime = null; p.popTime = null; p.popIndex = null;
    p.xOffset = null; p.yOffset = null; p.gWidth = null; p.gHeight = null;
    p.metal = null; p.shakeTime = null;
    p.isGarbage = false;
    clearFlags(p, clearChaining);
  }
  function Panel(row, col, id) {
    this.row = row; this.col = col; this.id = id;
    this.color = 0; this.chaining = null; this.matching = null; this.propagatesFalling = null; this.garbageId = null;
    clearPanel(this, true, true);
  }
  function below(panels, p) { return panels[p.row - 1][p.col]; }
  function supportedFromBelow(panels, p) {
    if (p.row <= 1) return true;
    if (p.isGarbage) {
      var start = p.col - p.xOffset, end = p.col - p.xOffset + p.gWidth - 1;
      for (var col = start; col <= end; col++) {
        var b = panels[p.row - 1][col];
        if (b.color !== 0) {
          if (b.isGarbage === false) return true;
          if (p.garbageId === b.garbageId) return p.yOffset !== b.yOffset;
          return true;
        }
      }
      return false;
    }
    return panels[p.row - 1][p.col].color !== 0;
  }
  function switchPanels(panels, a, b) {
    if (a.id !== panels[a.row][a.col].id || b.id !== panels[b.row][b.col].id ||
        Math.abs((a.row - b.row) + (a.col - b.col)) !== 1) throw new Error('PAEngine: switch');   // Panel.lua:808-814
    var r = a.row, c = a.col;
    a.row = b.row; a.col = b.col; b.row = r; b.col = c;
    panels[b.row][b.col] = b; panels[a.row][a.col] = a;
  }
  function fall(st, p) {
    var b = below(st.panels, p);
    switchPanels(st.panels, p, b);
    if (p.isGarbage) { b.propagatesFalling = true; b.stateChanged = true; }
    if (p.state !== 'falling') { p.state = 'falling'; p.timer = 0; p.stateChanged = true; }
  }
  function land(st, p) {
    st.onLand(p);
    if (p.isGarbage) p.state = 'normal';
    else {
      if (set(p.fellFromGarbage)) p.fellFromGarbage = null;
      p.state = 'landing';
      p.timer = 12;
    }
    p.stateChanged = true;
  }
  function decrementTimer(p) { if (p.timer > 0) p.timer--; }
  function enterHoverFromNormal(st, p, b, hoverTime) {
    clearFlags(p, false);
    p.state = 'hovering';
    if (b.propagatesChaining) {
      p.propagatesChaining = true;
      p.chaining = true;
      if (b.color === 0 || b.matchAnyway) p.matchAnyway = true;
      else {
        while (b.state === 'swapping' || (b.stateChanged && b.propagatesChaining && !b.matchAnyway && b.state === 'hovering')) {
          b = below(st.panels, b);
        }
        if (b.propagatesChaining) p.matchAnyway = b.color === 0 || b.matchAnyway;
      }
    }
    p.timer = hoverTime;
    p.stateChanged = true;
  }
  function updateNormal(st, p) {
    var panels = st.panels;
    if (p.isGarbage) { if (!supportedFromBelow(panels, p)) fall(st, p); return; }
    if (p.color === 0) return;
    var b = below(panels, p);
    if (!b.stateChanged) return;
    if (b.state === 'hovering') enterHoverFromNormal(st, p, b, b.timer);
    else if (b.color === 0) {
      if (set(b.propagatesFalling)) fall(st, p);
      else if (b.state === 'normal') enterHoverFromNormal(st, p, b, st.frames.HOVER);
    } else if (b.queuedHover === true && b.propagatesChaining && b.state === 'swapping') {
      var hoverTime = b.timer, hp = below(panels, b);
      while (hp && hp.state === 'swapping') { hoverTime += hp.timer; hp = below(panels, hp); }
      if (hp.state === 'hovering') hoverTime += hp.timer;
      else hoverTime += st.frames.HOVER;
      enterHoverFromNormal(st, p, b, hoverTime);
    }
  }
  function finishSwap(p) { p.state = 'normal'; p.dontSwap = null; p.swapFromLeft = null; p.stateChanged = true; }
  function updateSwapping(st, p) {
    decrementTimer(p);
    var b = below(st.panels, p);
    if (p.timer === 0) {
      if (p.color === 0) finishSwap(p);
      else if (b) {
        if (b.color === 0 || b.state === 'hovering' || set(p.queuedHover)) {
          clearFlags(p, false);
          p.state = 'hovering';
          p.propagatesChaining = b.propagatesChaining;
          p.matchAnyway = (b.color !== 0 && b.state === 'hovering') ? b.matchAnyway : false;
          p.timer = st.frames.HOVER;
          p.stateChanged = true;
        } else finishSwap(p);
      } else finishSwap(p);
    } else if (b && b.stateChanged && b.propagatesChaining) {
      p.queuedHover = p.color !== 0;
      p.stateChanged = true;
      p.propagatesChaining = true;
    }
  }
  function updateMatched(st, p) {
    decrementTimer(p);
    if (p.isGarbage && p.timer === p.popTime) st.onPop(p);
    if (p.timer !== 0) return;
    if (p.isGarbage) {
      if (p.yOffset === -1) {
        clearPanel(p, false, false);
        p.chaining = true;
        p.propagatesChaining = true;
        if (st.frames.GARBAGE_HOVER === undefined || st.frames.GARBAGE_HOVER === null) throw new Error('PAEngine: no GARBAGE_HOVER');
        p.timer = st.frames.GARBAGE_HOVER;
        p.fellFromGarbage = 12;
        p.state = 'hovering';
        p.stateChanged = true;
      } else p.state = 'normal';
    } else {
      p.state = 'popping';
      p.timer = p.comboIndex * st.frames.POP;
      p.stateChanged = true;
    }
  }
  function popped(st, p) {
    st.onPopped(p);
    clearPanel(p, true, true);
    p.propagatesChaining = true;
    p.stateChanged = true;
  }
  function updatePopping(st, p) {
    decrementTimer(p);
    if (p.timer !== 0) return;
    st.onPop(p);
    if (p.comboSize === p.comboIndex) popped(st, p);
    else {
      p.state = 'popped';
      p.timer = (p.comboSize - p.comboIndex) * st.frames.POP;
      p.stateChanged = true;
    }
  }
  function updatePopped(st, p) { decrementTimer(p); if (p.timer === 0) popped(st, p); }
  function updateHovering(st, p) {
    decrementTimer(p);
    if (p.matchAnyway) p.matchAnyway = false;
    if (p.timer === 0) {
      var b = below(st.panels, p);
      if (!b) throw new Error('PAEngine: hovering panel in row 1');
      if (b.state === 'hovering') p.timer = b.timer;
      else if (b.color !== 0) land(st, p);
      else fall(st, p);
    }
    if (!p.stateChanged && set(p.fellFromGarbage)) p.fellFromGarbage--;
  }
  function updateFalling(st, p) {
    if (p.row === 1) land(st, p);
    else if (supportedFromBelow(st.panels, p)) {
      if (p.isGarbage) land(st, p);
      else {
        var b = below(st.panels, p);
        if (b.state === 'hovering') {
          clearFlags(p, false);
          p.state = 'hovering';
          p.stateChanged = true;
          p.propagatesChaining = b.propagatesChaining;
          p.timer = b.timer;
        } else land(st, p);
      }
    } else fall(st, p);
    if (!p.stateChanged && set(p.fellFromGarbage)) p.fellFromGarbage--;
  }
  function updateLanding(st, p) {
    updateNormal(st, p);
    if (!p.stateChanged) {
      decrementTimer(p);
      if (p.timer === 0) { p.state = 'normal'; p.stateChanged = true; }
    }
  }
  function updatePanel(st, p) {
    p.stateChanged = false;
    p.propagatesChaining = false;
    p.propagatesFalling = false;
    p.matching = false;
    p.matchesMetal = false;
    p.matchesGarbage = false;
    switch (p.state) {
      case 'normal': updateNormal(st, p); break;
      case 'swapping': updateSwapping(st, p); break;
      case 'matched': updateMatched(st, p); break;
      case 'popping': updatePopping(st, p); break;
      case 'popped': updatePopped(st, p); break;
      case 'hovering': updateHovering(st, p); break;
      case 'falling': updateFalling(st, p); break;
      case 'landing': updateLanding(st, p); break;
      case 'dimmed': if (p.row >= 1) { p.state = 'normal'; p.stateChanged = true; } break;
    }
  }
  function allowsSwap(p) {
    if (set(p.dontSwap)) return false;
    if (p.isGarbage) return false;
    return p.state === 'normal' || p.state === 'swapping' || p.state === 'falling' || p.state === 'landing';
  }
  function startSwap(p, fromLeft) {
    var chaining = p.chaining;
    clearFlags(p);
    p.stateChanged = true;
    p.state = 'swapping';
    p.chaining = chaining;
    p.timer = 4;
    p.swapFromLeft = fromLeft;
    if (set(p.fellFromGarbage)) p.fellFromGarbage = null;
  }
  function dangerous(p) { return p.isGarbage ? p.state !== 'falling' : p.color !== 0; }
  function canMatch(p) {
    if (p.color === 0 || p.color === 9) return false;
    return p.state === 'normal' || p.state === 'landing' || (p.matchAnyway && p.state === 'hovering');
  }
  function matchPanel(st, p, isChainLink, comboIndex, comboSize) {
    p.state = 'matched';
    p.timer = st.frames.FLASH + st.frames.FACE + 1;
    if (isChainLink) p.chaining = true;
    if (set(p.fellFromGarbage)) p.fellFromGarbage = null;
    p.comboIndex = comboIndex;
    p.comboSize = comboSize;
  }

  var UNSEEN_ROWS = 30, UNSEEN_BREAKS = 130, UNSEEN_SPAN = 90;
  function unseenColour(base, k, c) { return base + ((W * k + c - 1) % UNSEEN_SPAN); }
  function Unseen() {}
  Unseen.prototype.row = function (st) {
    var k = (st.unseenRows = (st.unseenRows || 0) + 1), o = [];
    for (var c = 1; c <= W; c++) o.push(unseenColour(UNSEEN_ROWS, k, c));
    return o;
  };
  Unseen.prototype.garbageRow = function (st) {
    var k = (st.unseenBreaks = (st.unseenBreaks || 0) + 1), o = [];
    for (var c = 1; c <= W; c++) o.push(unseenColour(UNSEEN_BREAKS, k, c));
    return o;
  };
  Unseen.prototype.copy = function () { return this; };
  function Recorded(rows, garbageRows) { this.rows = rows; this.garbageRows = garbageRows; this.r = 0; this.g = 0; }
  Recorded.prototype.row = function () {
    if (this.r >= this.rows.length) throw new Error('PAEngine: the recording dealt no more rows');
    return this.rows[this.r++];
  };
  Recorded.prototype.garbageRow = function () {
    if (this.g >= this.garbageRows.length) throw new Error('PAEngine: the recording dealt no more garbage colours');
    var s = this.garbageRows[this.g++], o = [];
    for (var c = 1; c <= W; c++) o.push(+s.charAt(c - 1));
    return o;
  };
  Recorded.prototype.copy = function () { var x = new Recorded(this.rows, this.garbageRows); x.r = this.r; x.g = this.g; return x; };
  function Seeded(generator) { this.gen = generator; }
  Seeded.prototype.row = function () { return this.gen.nextRowString(); };
  Seeded.prototype.garbageRow = function () {
    var s = this.gen.garbageRowString(), o = [];
    for (var c = 1; c <= W; c++) o.push(+s.charAt(c - 1));
    return o;
  };
  Seeded.prototype.copy = function () { return new Seeded(this.gen.copy()); };
  function rowColours(s, metal) {
    if (Array.isArray(s)) return s.slice();               // unseen: colours already, never shock
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), code = s.charCodeAt(i), color = 0;
      if (code >= 48 && code <= 57) color = code - 48;
      else if (ch >= 'A' && ch <= 'Z') color = metal > 0 ? 8 : LETTER[ch];
      else if (ch >= 'a' && ch <= 'z') color = metal > 1 ? 8 : LETTER[ch];
      out.push(color);
    }
    return out;
  }

  // ---- OUTGOING GARBAGE (common/engine/GarbageQueue.lua, checkMatches.lua
  // Stack:pushGarbage, GarbageDelivery.lua): what a stack's clears send. A
  // piece is staged, leaves STAGING_DURATION frames after it was earned (a
  // chain only once finalized), and is in transit GARBAGE_DELAY_LAND_TIME
  // more before the opponent can take it (deliver).
  var GARBAGE_TRANSIT_TIME = 45, GARBAGE_TELEGRAPH_TIME = 45, GARBAGE_DELAY_LAND_TIME = 60;   // client/src/globals.lua
  var STAGING_DURATION = GARBAGE_TRANSIT_TIME + GARBAGE_TELEGRAPH_TIME + 1;
  var COMBO_GARBAGE = [[], [], [], [], [3], [4], [5], [6], [3, 4], [4, 4], [5, 5], [5, 6], [6, 6], [6, 6, 6], [6, 6, 6, 6]];
  COMBO_GARBAGE[20] = [6, 6, 6, 6, 6, 6]; COMBO_GARBAGE[27] = [6, 6, 6, 6, 6, 6, 6, 6];
  for (var ci = 1; ci <= 72; ci++) COMBO_GARBAGE[ci] = COMBO_GARBAGE[ci] || COMBO_GARBAGE[ci - 1];
  function orderComboGarbage(a, b) { return a.width !== b.width ? a.width > b.width : a.frameEarned < b.frameEarned; }
  function orderChainGarbage(a, b) { return a.finalized === b.finalized ? a.frameEarned > b.frameEarned : !a.finalized; }
  // Lua's table.sort comparator: true when a goes before b.
  function garbageBefore(q, a, b) {
    if (a.isChain === b.isChain) {
      if (a.isChain) return orderChainGarbage(a, b);
      if (a.isMetal === b.isMetal || q.treatMetalAsCombo) return orderComboGarbage(a, b);
      return a.isMetal;
    }
    return !a.isChain;
  }
  function GarbageQueue(allowIllegalStuff, treatMetalAsCombo) {
    this.staged = []; this.inTransit = {}; this.transitTimers = []; this.history = []; this.currentChain = null;
    this.illegalStuffIsAllowed = !!allowIllegalStuff; this.treatMetalAsCombo = !!treatMetalAsCombo; this.stuckChainWarned = false;
  }
  GarbageQueue.prototype.order = function () {
    var q = this;
    this.staged.sort(function (a, b) { return garbageBefore(q, a, b) ? -1 : garbageBefore(q, b, a) ? 1 : 0; });
  };
  GarbageQueue.prototype.push = function (g) {
    if (g.height > 1 && this.illegalStuffIsAllowed) { g.isChain = true; g.finalized = true; }   // correctChainingFlag
    this.staged.push(g); this.history.push(g);
    this.order();
  };
  // Lua passes (stopWatch, column, row + offset) to (frameEarned, row, column): kept as the server has it.
  GarbageQueue.prototype.addChainLink = function (frameEarned, row, column) {
    var c = this.currentChain;
    if (!c) {
      c = this.currentChain = { width: 6, height: 1, isMetal: false, isChain: true, frameEarned: frameEarned, finalized: false,
                                links: {}, linkTimes: [frameEarned] };
      c.links[frameEarned] = { rowEarned: row, colEarned: column };
      this.push(c);
    } else {
      c.height++; c.frameEarned = frameEarned;
      c.links[frameEarned] = { rowEarned: row, colEarned: column };
      c.linkTimes.push(frameEarned);
    }
  };
  GarbageQueue.prototype.finalizeCurrentChain = function (clock) {
    this.currentChain.finalized = true; this.currentChain.finalizedClock = clock;
    this.currentChain = null;
  };
  GarbageQueue.prototype.processStagedGarbageForClock = function (clock) {
    var popped = null;
    for (var i = this.staged.length - 1; i >= 0; i--) {
      var g = this.staged[i];
      if (g.isChain) {
        if (!g.finalized || g.frameEarned + STAGING_DURATION > clock) {
          // an unfinalized chain stuck 600 frames is finalized, so the queue moves again
          if (!g.finalized && g.frameEarned !== undefined && clock - g.frameEarned > 600) {
            this.stuckChainWarned = true;
            g.finalized = true; g.finalizedClock = clock;
            if (this.currentChain === g) this.currentChain = null;
          }
          break;
        }
        (popped || (popped = [])).push(this.staged.pop());
      } else {
        if (g.frameEarned + STAGING_DURATION > clock) break;
        (popped || (popped = [])).push(this.staged.pop());
      }
    }
    if (popped) {
      this.stuckChainWarned = false;
      var at = clock + GARBAGE_DELAY_LAND_TIME;
      this.inTransit[at] = popped;
      this.transitTimers.push(at);
    }
  };
  GarbageQueue.prototype.oldestFinishedTransitTime = function () { return this.transitTimers.length ? this.transitTimers[0] : undefined; };
  GarbageQueue.prototype.popFinishedTransitsAt = function (clock) {
    var t = this.oldestFinishedTransitTime();
    if (t === undefined) return undefined;
    // the entry stays, as in the Lua: only its timer goes
    if (t === clock || (this.illegalStuffIsAllowed && t < clock)) { this.transitTimers.shift(); return this.inTransit[t]; }
    return undefined;
  };
  function copyGarbage(g) {
    var o = {};
    for (var k in g) o[k] = k === 'links' ? JSON.parse(JSON.stringify(g.links)) : k === 'linkTimes' ? g.linkTimes.slice() : g[k];
    return o;
  }
  GarbageQueue.prototype.copy = function () {
    var q = new GarbageQueue(this.illegalStuffIsAllowed, this.treatMetalAsCombo), map = new Map(), self = this;
    function c(g) { if (!map.has(g)) map.set(g, copyGarbage(g)); return map.get(g); }
    q.staged = this.staged.map(c); q.history = this.history.map(c);
    q.currentChain = this.currentChain ? c(this.currentChain) : null;
    q.transitTimers = this.transitTimers.slice();
    Object.keys(this.inTransit).forEach(function (t) { q.inTransit[t] = self.inTransit[t].map(c); });
    q.stuckChainWarned = this.stuckChainWarned;
    return q;
  };
  // A queue as engineRecord.lua writes one ({ staged, transit, currentChainAt }).
  GarbageQueue.fromLua = function (o) {
    var q = new GarbageQueue(false, false);
    function g(x) {
      var y = { width: x.width, height: x.height, isMetal: !!x.isMetal, isChain: !!x.isChain, frameEarned: x.frameEarned };
      if (x.finalized !== undefined) y.finalized = x.finalized;
      if (x.finalizedClock !== undefined) y.finalizedClock = x.finalizedClock;
      if (x.rowEarned !== undefined) y.rowEarned = x.rowEarned;
      if (x.colEarned !== undefined) y.colEarned = x.colEarned;
      if (x.linkTimes !== undefined) { y.linkTimes = list(x.linkTimes).slice(); y.links = {}; }
      return y;
    }
    q.staged = list(o && o.staged).map(g);
    if (o && o.currentChainAt) q.currentChain = q.staged[o.currentChainAt - 1];
    // a record lists every entry, delivered or not: those still due are the timers
    list(o && o.transit).forEach(function (t) { q.inTransit[t.at] = list(t.garbage).map(g); if (o.pending === undefined || list(o.pending).indexOf(t.at) >= 0) q.transitTimers.push(t.at); });
    q.history = q.staged.slice();
    return q;
  };
  // GarbageDelivery _pushToRecipient for one sender: what `from` has ready
  // goes to `to`, before either runs its frame.
  function deliver(from, to) {
    var q = from.outgoing, t = q.oldestFinishedTransitTime();
    if (t === undefined || (q.illegalStuffIsAllowed && to.incoming.length >= 72)) return null;
    if (from.stopWatch < t) return null;
    var g = q.popFinishedTransitsAt(t);
    if (g) to.receiveGarbage(g);
    return g || null;
  }

  function Stack() {}
  Stack.prototype.frameTimes = null;
  Stack.prototype.idOf = function () { return ++this.panelIdCount; };
  Stack.prototype.createPanelAt = function (row, col) {
    var p = new Panel(row, col, this.idOf());
    this.panels[row][col] = p;
    return p;
  };
  Stack.prototype.onPop = function (p) {
    this.events.push({ type: 'panelPop', row: p.row, col: p.col, garbage: !!p.isGarbage });   // emitSignal("panelPop")
    if (!p.isGarbage) {
      this.addScore(10);
      this.panelsCleared++;
      if (this.panelsCleared % this.levelData.shockFrequency === 0) {
        this.metalPanelsQueued = Math.min(this.metalPanelsQueued + 1, this.levelData.shockCap);
      }
    }
  };
  Stack.prototype.onPopped = function () {};
  Stack.prototype.onLand = function (p) {
    this.events.push({ type: 'panelLanded', row: p.row, col: p.col, garbage: !!p.isGarbage });   // emitSignal("panelLanded")
    if (p.isGarbage && set(p.shakeTime) && p.row <= this.height) {
      if (this.garbageLandedThisFrame.indexOf(p.garbageId) < 0) {
        this.shakeTimeOnFrame = Math.max(this.shakeTimeOnFrame, p.shakeTime, this.peakShakeTime || 0);
        this.peakShakeTime = Math.max(this.shakeTimeOnFrame, this.peakShakeTime || 0);
        this.garbageLandedThisFrame.push(p.garbageId);
      }
      p.shakeTime = null;
    }
  };
  Stack.prototype.addScore = function (s) { this.score += s; if (this.score > 99999) this.score = 99999; };
  Stack.prototype.top = function () { return this.panels.length - 1; };   // Lua #panels
  Stack.prototype.hasActivePanels = function () { return this.nActive > 0 || this.nPrevActive > 0; };
  Stack.prototype.hasFallingGarbage = function () {
    for (var row = Math.min(this.height + 3, this.top()); row >= 1; row--) {
      for (var col = 1; col <= W; col++) { var p = this.panels[row][col]; if (p.isGarbage && p.state === 'falling') return true; }
    }
    return false;
  };
  Stack.prototype.swapQueued = function () { return this.queuedSwapCol !== 0 && this.queuedSwapRow !== 0; };
  Stack.prototype.isToppedOut = function () {
    for (var col = 1; col <= W; col++) if (dangerous(this.panels[this.height][col])) return true;
    return false;
  };
  Stack.prototype.hasChainingPanels = function () {
    for (var row = 1; row <= this.top(); row++) {
      for (var col = 1; col <= W; col++) { var p = this.panels[row][col]; if (set(p.chaining) && p.color !== 0) return true; }
    }
    return false;
  };
  Stack.prototype.updateActivePanelCount = function () {
    this.nPrevActive = this.nActive;
    var count = 0, swapping = 0;
    for (var row = 1; row <= this.height; row++) {
      for (var col = 1; col <= W; col++) {
        var p = this.panels[row][col];
        if (p.isGarbage) { if (p.state !== 'normal') count++; }
        else if (p.color !== 0 && p.state !== 'normal' && p.state !== 'landing') {
          count++;
          if (p.state === 'swapping') swapping++;
        }
      }
    }
    this.nActive = count; this.swappingCount = swapping;
  };
  Stack.prototype.updateRiseLock = function () {
    var prev = this.riseLock;
    if (this.swapQueued()) this.riseLock = true;
    else if (this.shakeTime > 0) this.riseLock = true;
    else if (this.hasActivePanels()) this.riseLock = true;
    else this.riseLock = false;
    if (prev && !this.riseLock) this.preventManualRaise = false;
  };
  Stack.prototype.updateSpeed = function () {
    if (this.levelData.speedIncreaseMode !== 1) throw new Error('PAEngine: speed increase mode ' + this.levelData.speedIncreaseMode);
    if (this.clock === this.nextSpeedIncreaseClock) {
      this.speed = Math.min(this.speed + 1, 99);
      this.nextSpeedIncreaseClock += DT_SPEED_INCREASE;
    }
  };
  Stack.prototype.decrementInvincibilityTimers = function () {
    this.prevShakeTime = this.shakeTime;
    this.shakeTime = Math.max(this.shakeTime - 1, this.shakeTimeOnFrame);
    if (this.shakeTime === 0) this.peakShakeTime = 0;
    if (this.preStopTime !== 0) this.preStopTime--;
    else if (this.stopTime !== 0) this.stopTime--;
  };
  Stack.prototype.advancePassiveRaise = function () {
    if (this.manualRaise) {
      if (this.displacement === 0 && this.hasRisen) { this.topCurRow = this.height; this.newRow(); }
      return false;
    }
    if (!this.riseLock && this.stopTime === 0) {
      if (this.isToppedOut()) this.health--;
      else {
        this.riseTimer--;
        if (this.riseTimer <= 0) {
          this.displacement--;
          if (this.displacement === 0) { this.preventManualRaise = false; this.topCurRow = this.height; this.newRow(); }
          this.riseTimer += SPEED_TO_RISE_TIME[this.speed - 1];
        }
      }
      return true;
    }
    return false;
  };
  Stack.prototype.checkDeath = function () {
    if (this.gameOverClock > 0) return false;
    if (this.health <= 0 && this.shakeTime <= 0) return true;
    if (!this.riseLock && this.behaviours.allowManualRaise && this.wasToppedOut && this.manualRaise) return true;
    return false;
  };
  Stack.prototype.recordDeath = function () {
    if (this.gameOverClock > 0) return;
    this.gameOverClock = this.clock;
    this.gameOver = true;
  };
  Stack.prototype.handleManualRaise = function () {
    if (!(this.behaviours.allowManualRaise && this.manualRaise)) return;
    if (!this.riseLock) {
      this.stopTime = 0;
      if (this.wasToppedOut) { if (this.checkDeath()) this.recordDeath(); }
      else {
        this.hasRisen = true;
        this.displacement--;
        if (this.displacement === 1) {
          if (!this.preventManualRaise) this.addScore(1);
          this.manualRaise = false;
          this.riseTimer = 1;
          this.preventManualRaise = true;
        }
        this.manualRaiseYet = true;
      }
    } else if (!this.manualRaiseYet) this.manualRaise = false;
    else if (this.hasFallingGarbage()) this.manualRaise = false;
  };
  Stack.prototype.moveCursorInDirection = function (d) {
    this.curRow = bound(1, this.curRow + DIR_ROW[d], this.topCurRow);
    this.curCol = bound(1, this.curCol + DIR_COL[d], W - 1);
  };
  Stack.prototype.applyCursorDirection = function (d) {
    if (d && (this.curTimer === 0 || this.curTimer === this.curWaitTime) && !set(this.cursorLock)) this.moveCursorInDirection(d);
    else this.curRow = bound(1, this.curRow, this.topCurRow);
    if (this.curTimer !== this.curWaitTime) this.curTimer++;
  };
  Stack.prototype.controls = function () {
    var b = this.inputBits, dir = null;
    var raise = !!(b & IN.raise), swap = !!(b & IN.swap);
    this.swapThisFrame = swap;
    if (this.swapThisFrame && this.swapQueued()) this.swapThisFrame = false;
    if (b & IN.up) dir = 'up';
    else if (b & IN.down) dir = 'down';
    else if (b & IN.left) dir = 'left';
    else if (b & IN.right) dir = 'right';
    if (dir === this.cursorDirection) { if (this.curTimer !== this.curWaitTime) this.curTimer++; }
    else { this.cursorDirection = dir; this.curTimer = 0; }
    if (raise && !this.preventManualRaise) { this.manualRaise = true; this.manualRaiseYet = false; }
  };

  Stack.prototype.wiggleActive = function () {
    var bh = this.behaviours;
    if (bh.swapStallingMode === 0 || bh.swapStallingPunish === 0) return false;
    if (!this.wasToppedOut || this.preStopTime !== 0 || this.stopTime !== 0 || this.shakeTime !== 0) return false;
    return (this.nActive - this.swappingCount) === 0;
  };
  Stack.prototype.wiggleCanSwap = function (p1, p2) {
    if (!this.wiggleActive()) return [true, 0];
    var row = this.curRow, col = this.curCol, log = this.swapStallBacklog;
    for (var i = 0; i < log.length; i++) {
      var o = log[i];
      if (o.clock >= this.clock) return [true, 0];
      if (o.leftId === p1.id && o.rightId === p2.id && o.row === row && o.col === col) {
        return this.health > this.behaviours.swapStallingPunish ? [true, this.behaviours.swapStallingPunish] : [false, 0];
      }
    }
    return [true, 0];
  };
  Stack.prototype.wiggleRegister = function (p1, p2, cost) {
    if (this.wiggleActive()) {
      if (cost === 0) {
        this.swapStallBacklog.push({ leftId: p2.id, rightId: p1.id, row: this.curRow, col: this.curCol, clock: this.clock });
        this.swapStallBacklog.push({ leftId: p1.id, rightId: p2.id, row: this.curRow, col: this.curCol, clock: this.clock });
      } else this.health -= cost;
    } else if (this.swapStallBacklog.length > 0) this.swapStallBacklog = [];
  };

  Stack.prototype.canSwapPanels = function (p1, p2) {
    if (Math.abs(p1.col - p2.col) !== 1 || p1.row !== p2.row) return [false];
    if (this.inCountdown || this.clock <= 1) return [false];
    if (p1.color === 0 && p2.color === 0) return [false];
    if (!allowsSwap(p1) || !allowsSwap(p2)) return [false];
    var row = p1.row, a1, a2;
    if (row < this.height) {
      a1 = this.panels[row + 1][p1.col]; a2 = this.panels[row + 1][p2.col];
      if (a1.state === 'hovering' || a2.state === 'hovering') return [false];
    }
    if (p1.color === 0 || p2.color === 0) {
      if (a1 && a2 && (a1.state === 'swapping' && a2.state === 'swapping') &&
          (a1.color === 0 || a2.color === 0) && (a1.color !== 0 || a2.color !== 0)) return [false];
      if (row > 1) {
        var b1 = this.panels[row - 1][p1.col], b2 = this.panels[row - 1][p2.col];
        if ((b1.state === 'swapping' && b2.state === 'swapping') &&
            (b1.color === 0 || b2.color === 0) && (b1.color !== 0 || b2.color !== 0)) return [false];
      }
    }
    if (this.behaviours.swapStallingMode === 1) return this.wiggleCanSwap(p1, p2);
    return [true, 0];
  };
  Stack.prototype.tryQueueSwapPanels = function (p1, p2) {
    var r = this.canSwapPanels(p1, p2);
    if (r[0]) {
      this.wiggleRegister(p1, p2, r[1] || 0);
      this.swapCount++;
      this.queuedSwapCol = Math.min(p1.col, p2.col);
      this.queuedSwapRow = p1.row;
      return true;
    }
    return false;
  };
  Stack.prototype.swap = function (row, col) {
    var panels = this.panels, left = panels[row][col], right = panels[row][col + 1];
    startSwap(left, true); startSwap(right, false);
    switchPanels(panels, left, right);
    var t = left; left = right; right = t;
    if (row !== 1) {
      if (left.color !== 0 && (panels[row - 1][col].color === 0 || panels[row - 1][col].state === 'falling')) left.dontSwap = true;
      if (right.color !== 0 && (panels[row - 1][col + 1].color === 0 || panels[row - 1][col + 1].state === 'falling')) right.dontSwap = true;
    }
    if (row !== this.height) {
      if (left.color === 0 && panels[row + 1][col].color !== 0) left.dontSwap = true;
      if (right.color === 0 && panels[row + 1][col + 1].color !== 0) right.dontSwap = true;
    }
    this.events.push({ type: 'swap', row: row, col: col });
  };

  Stack.prototype.getMatchingPanels = function () {
    var panels = this.panels, cands = [], matching = [], row, col, p, i, j;
    for (row = 1; row <= this.height; row++) for (col = 1; col <= W; col++) {
      p = panels[row][col];
      if (p.stateChanged && canMatch(p)) cands.push(p);
    }
    for (i = 0; i < cands.length; i++) {
      var cp = cands[i], vert = [], horiz = [];
      for (row = cp.row - 1; row >= 1; row--) { p = panels[row][cp.col]; if (p.color === cp.color && canMatch(p)) vert.push(p); else break; }
      for (row = cp.row + 1; row <= this.height; row++) { p = panels[row][cp.col]; if (p.color === cp.color && canMatch(p)) vert.push(p); else break; }
      for (col = cp.col - 1; col >= 1; col--) { p = panels[cp.row][col]; if (p.color === cp.color && canMatch(p)) horiz.push(p); else break; }
      for (col = cp.col + 1; col <= W; col++) { p = panels[cp.row][col]; if (p.color === cp.color && canMatch(p)) horiz.push(p); else break; }
      if ((vert.length >= 2 || horiz.length >= 2) && !set(cp.matching)) { matching.push(cp); cp.matching = true; }
      if (vert.length >= 2) for (j = 0; j < vert.length; j++) if (!set(vert[j].matching)) { vert[j].matching = true; matching.push(vert[j]); }
      if (horiz.length >= 2) for (j = 0; j < horiz.length; j++) if (!set(horiz[j].matching)) { horiz[j].matching = true; matching.push(horiz[j]); }
    }
    for (i = 0; i < matching.length; i++) if (matching[i].state === 'hovering') matching[i].chaining = null;
    return matching;
  };
  function sortByPopOrder(list, garbage) {
    return list.sort(function (a, b) {
      if (a.row === b.row) return garbage ? b.col - a.col : a.col - b.col;
      return garbage ? a.row - b.row : b.row - a.row;
    });
  }
  function matchOnContact(a, b) {
    if (a.metal !== b.metal) return false;
    if (a.top === b.bottom - 1 || a.bottom === b.top + 1) {
      return (a.left <= b.right && b.left <= a.left) || (b.left <= a.right && a.left <= b.left);
    } else if (a.right === b.left - 1 || a.left === b.right + 1) {
      return (b.top >= a.bottom && b.top <= a.top) || (a.top >= b.bottom && a.top <= b.top);
    }
    return false;
  }
  Stack.prototype.getConnectedGarbagePanels = function (matchingPanels) {
    var ids = [], seenId = {}, pieces = [], row, col, i, j;
    for (row = 1; row <= this.top(); row++) for (col = 1; col <= W; col++) {
      var p = this.panels[row][col];
      if (p.isGarbage && p.state === 'normal' && !seenId[p.garbageId] &&
          ((p.row - p.yOffset) <= this.height || p.garbageId <= this.highestGarbageIdMatched)) {
        ids.push(p.garbageId);
        seenId[p.garbageId] = 1;
        pieces.push({ left: p.col - p.xOffset, right: p.col - p.xOffset + p.gWidth - 1, top: p.row - p.yOffset + p.gHeight - 1,
                      bottom: p.row - p.yOffset, metal: set(p.metal) });
      }
    }
    if (!ids.length) return null;
    var matchedIds = [], matchedById = {};
    for (i = 0; i < ids.length; i++) {
      var g = pieces[i];
      for (j = 0; j < matchingPanels.length; j++) {
        var mp = matchingPanels[j];
        if (mp.row === g.bottom - 1 || mp.row === g.top + 1) {
          if (mp.col >= g.left && mp.col <= g.right) { matchedIds.push(ids[i]); matchedById[ids[i]] = true; }
        } else if (mp.col === g.left - 1 || mp.col === g.right + 1) {
          if (mp.row >= g.bottom && mp.row <= g.top) { matchedIds.push(ids[i]); matchedById[ids[i]] = true; }
        }
      }
    }
    if (!matchedIds.length) return null;
    var contact = {};
    for (i = 0; i < ids.length; i++) {
      contact[ids[i]] = {};
      for (j = 0; j < ids.length; j++) if (i !== j) contact[ids[i]][ids[j]] = matchOnContact(pieces[i], pieces[j]);
    }
    for (var k = 0; k < matchedIds.length; k++) {
      matchedById[matchedIds[k]] = true;
      var m = contact[matchedIds[k]];
      for (var gid in m) if (m[gid] && !matchedById[gid]) { matchedIds.push(+gid); matchedById[gid] = true; }
    }
    var out = [];
    for (i = 0; i < ids.length; i++) {
      if (!matchedById[ids[i]]) continue;
      var pc = pieces[i];
      for (row = pc.bottom; row <= pc.top; row++) for (col = pc.left; col <= pc.right; col++) out.push(this.panels[row][col]);
    }
    var hi = Math.max.apply(null, matchedIds);
    if (hi > this.highestGarbageIdMatched) this.highestGarbageIdMatched = hi;
    return out;
  };
  Stack.prototype.convertGarbagePanels = function (isChain) {
    for (var row = 1; row <= this.top(); row++) {
      var colours = null;
      for (var col = 1; col <= W; col++) {
        var p = this.panels[row][col];
        if (p.yOffset === -1 && p.color === 9) {
          if (!colours) colours = this.source.garbageRow(this);
          p.color = colours[col - 1];
          if (isChain) p.chaining = true;
        }
      }
    }
  };
  Stack.prototype.matchGarbagePanels = function (gps, matchTime, isChain, onScreen) {
    sortByPopOrder(gps, true);
    for (var i = 0; i < gps.length; i++) {
      var p = gps[i];
      p.yOffset -= 1;
      p.gHeight -= 1;
      p.state = 'matched';
      p.timer = matchTime + 1;
      p.initialTime = matchTime;
      p.popTime = this.frames.POP * (onScreen - (i + 1));
      p.popIndex = Math.min(i + 1, 10);
    }
    this.convertGarbagePanels(isChain);
  };
  Stack.prototype.calculateStopTime = function (comboSize, toppedOut, isChain, chainCounter) {
    var stop = this.levelData.stop, t = 0;
    if (stop.formula !== 1) throw new Error('PAEngine: stop formula ' + stop.formula);
    if (comboSize > 3 || isChain) {
      if (toppedOut && isChain) t = stop.dangerConstant + ((chainCounter > 4) ? 6 : chainCounter) * stop.dangerCoefficient - stop.dangerCoefficient;
      else if (toppedOut) t = stop.coefficient * ((comboSize < 9) ? 2 : 3) + stop.chainConstant;
      else if (isChain) t = stop.coefficient * Math.min(chainCounter, 13) + stop.chainConstant;
      else t = stop.coefficient * comboSize + stop.comboConstant;
    }
    return t;
  };
  Stack.prototype.pushGarbage = function (coordinate, isChain, comboSize, metalCount) {
    for (var i = 3; i <= metalCount; i++) {
      this.outgoing.push({ width: 6, height: 1, isMetal: true, isChain: false, frameEarned: this.stopWatch, rowEarned: coordinate.row, colEarned: coordinate.column });
    }
    var pieces = COMBO_GARBAGE[comboSize] || COMBO_GARBAGE[72];
    for (i = 0; i < pieces.length; i++) {
      this.outgoing.push({ width: pieces[i], height: 1, isMetal: false, isChain: false, frameEarned: this.stopWatch, rowEarned: coordinate.row, colEarned: coordinate.column });
    }
    if (isChain) this.outgoing.addChainLink(this.stopWatch, coordinate.column, coordinate.row + (pieces.length > 0 ? 1 : 0));
  };
  Stack.prototype.checkMatches = function () {
    var matching = this.getMatchingPanels(), comboSize = matching.length, i;
    if (comboSize > 0) {
      var f = this.frames, isChainLink = false;
      for (i = 0; i < matching.length; i++) if (set(matching[i].chaining)) { isChainLink = true; break; }
      if (isChainLink) this.chainCounter = this.chainCounter !== 0 ? this.chainCounter + 1 : 2;
      this.manualRaise = false;
      this.riseLock = true;
      sortByPopOrder(matching, false);
      for (i = 0; i < comboSize; i++) matchPanel(this, matching[i], isChainLink, i + 1, comboSize);
      var origin = { row: matching[0].row, column: matching[0].col };   // applyMatchToPanels' firstCellToPop
      var gps = this.getConnectedGarbagePanels(matching), onScreen = 0;
      if (gps) {
        for (i = 0; i < gps.length; i++) if (gps[i].row <= this.height) onScreen++;
        this.matchGarbagePanels(gps, f.FLASH + f.FACE + f.POP * (comboSize + onScreen), isChainLink, onScreen);
      }
      this.preStopTime = Math.max(this.preStopTime, f.FLASH + f.FACE + f.POP * (comboSize + onScreen));
      var stopTime = this.calculateStopTime(comboSize, this.wasToppedOut, isChainLink, this.chainCounter);
      if (stopTime > this.stopTime) this.stopTime = stopTime;
      this.events.push({ type: 'match', chain: isChainLink, chainCounter: this.chainCounter, size: comboSize, garbage: gps ? gps.length : 0, row: matching[0].row, col: matching[0].col });
      var metalCount = 0;
      for (i = 0; i < matching.length; i++) if (matching[i].color === 8) metalCount++;
      if (isChainLink || comboSize > 3 || metalCount > 0) this.pushGarbage(origin, isChainLink, comboSize, metalCount);
      var bonus = this.chainCounter > 13 ? 0 : this.chainCounter;
      this.addScore(SCORE_CHAIN_TA[bonus]);
      if (comboSize > 3) this.addScore(SCORE_COMBO_TA[Math.min(30, comboSize)]);
    }
    this.clearChainingFlags();
  };
  Stack.prototype.clearChainingFlags = function () {
    for (var row = 1; row <= Math.min(this.top(), this.height + 2); row++) {
      for (var col = 1; col <= W; col++) {
        var p = this.panels[row][col];
        if (!set(p.matching) && set(p.chaining) && !p.matchAnyway && (canMatch(p) || p.color === 9)) {
          if (row > 1) { if (this.panels[row - 1][col].state !== 'swapping') p.chaining = null; }
          else p.chaining = null;
        }
      }
    }
  };

  Stack.prototype.removeExtraRows = function () {
    for (var row = this.top(); row >= this.height + 1; row--) {
      for (var col = 1; col <= W; col++) if (this.panels[row][col].color !== 0) return;
      this.panels.length = row;
    }
  };
  Stack.prototype.newRow = function () {
    var panels = this.panels;
    if (this.curRow !== 0) this.curRow = bound(1, this.curRow + 1, this.topCurRow);
    if (this.queuedSwapRow > 0) this.queuedSwapRow++;
    var top = this.top() + 1;
    panels[top] = [null];
    var metal = 0;
    if (this.metalPanelsQueued > 3) { this.metalPanelsQueued -= 2; metal = 2; }
    else if (this.metalPanelsQueued > 0) { this.metalPanelsQueued -= 1; metal = 1; }
    var colours = rowColours(this.source.row(this), metal);
    for (var c = 1; c <= W; c++) { var p = this.createPanelAt(top, c); p.color = colours[c - 1]; p.state = 'dimmed'; }
    for (var row = top; row >= 1; row--) for (var col = W; col >= 1; col--) switchPanels(panels, panels[row][col], panels[row - 1][col]);
    for (var c2 = 1; c2 <= W; c2++) { panels[1][c2].state = 'normal'; panels[1][c2].stateChanged = true; }
    this.displacement = 16;
    this.events.push({ type: 'newRow' });
  };
  Stack.prototype.shouldDropGarbage = function () {
    var g = this.incoming[this.incoming.length - 1];
    if (!g) return false;
    if (this.isToppedOut()) return false;
    if (this.hasFallingGarbage()) return false;
    for (var i = this.height + 1; i <= this.top(); i++) {
      if (this.panels[i]) for (var j = 1; j <= W; j++) if (this.panels[i][j] && this.panels[i][j].color !== 0) return false;
    }
    if (!this.hasActivePanels()) return true;
    if (g.isChain) return g.height > 1;
    return g.height > 1;
  };
  Stack.prototype.dropGarbage = function (width, height, isMetal) {
    var originRow = this.height + 1, cols = DROP_COLUMNS[width];
    if (!cols) throw new Error('PAEngine: garbage width ' + width);
    var index = this.dropColumnIndex[width - 1], originCol = cols[index - 1];
    this.dropColumnIndex[width - 1] = wrap(1, index + 1, cols.length);
    this.garbageCreatedCount++;
    var count = width * height, shake = count > 24 ? 76 : GARBAGE_SIZE_TO_SHAKE_FRAMES[count - 1];
    for (var row = originRow; row <= originRow + height - 1; row++) {
      if (this.panels[row]) continue;
      if (row !== this.panels.length) throw new Error('PAEngine: garbage row ' + row + ' past a missing row');
      this.panels[row] = [null];
      for (var col = 1; col <= W; col++) {
        var p = this.createPanelAt(row, col);
        if (col >= originCol && col < originCol + width) {
          p.garbageId = this.garbageCreatedCount; p.isGarbage = true; p.color = 9; p.gWidth = width; p.gHeight = height;
          p.yOffset = row - originRow; p.xOffset = col - originCol; p.shakeTime = shake; p.state = 'falling';
          if (isMetal) p.metal = true;
        }
      }
    }
    this.events.push({ type: 'garbageDrop', width: width, height: height });
  };
  function orderBefore(a, b) {
    if (a.isChain === b.isChain) {
      if (a.isChain) {
        if (!!a.finalized === !!b.finalized) return a.frameEarned > b.frameEarned;
        return !a.finalized;
      }
      if (a.isMetal === b.isMetal) {
        if (a.width !== b.width) return a.width > b.width;
        return a.frameEarned < b.frameEarned;
      }
      return a.isMetal;
    }
    return !a.isChain;
  }
  Stack.prototype.receiveGarbage = function (list) {
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      this.incoming.push({ width: g.width, height: g.height, isChain: !!g.isChain, isMetal: !!g.isMetal,
                           frameEarned: g.frameEarned === undefined ? this.stopWatch : g.frameEarned,
                           finalized: g.finalized === undefined ? null : g.finalized });
      var q = this.incoming;
      for (var a = 1; a < q.length; a++) {
        var x = q[a], k = a - 1;
        while (k >= 0 && orderBefore(x, q[k])) { q[k + 1] = q[k]; k--; }
        q[k + 1] = x;
      }
    }
  };

  Stack.prototype.updatePanels = function () {
    this.shakeTimeOnFrame = 0;
    for (var row = 1; row <= this.top(); row++) for (var col = 1; col <= W; col++) updatePanel(this, this.panels[row][col]);
  };
  Stack.prototype.runPhysics = function () {
    this.garbageLandedThisFrame = [];
    this.wasToppedOut = this.isToppedOut();
    this.decrementInvincibilityTimers();
    this.updateRiseLock();
    this.updateSpeed();
    if (this.behaviours.passiveRaise || this.preventManualRaise) {
      if (this.advancePassiveRaise()) { if (this.checkDeath()) this.recordDeath(); }
    }
    if (!this.wasToppedOut && !this.hasFallingGarbage()) this.health = this.levelData.maxHealth;
    if (this.displacement % 16 !== 0) this.topCurRow = this.height - 1;
    if (this.swapQueued()) {
      this.swap(this.queuedSwapRow, this.queuedSwapCol);
      this.queuedSwapCol = 0; this.queuedSwapRow = 0;
    }
    this.checkMatches();
    this.updatePanels();
    this.updateActivePanelCount();
    // the chain ends with no panel chaining; an orphaned chain in the queue too
    var chainQueued = !!(this.outgoing && this.outgoing.currentChain);
    if ((this.chainCounter !== 0 || chainQueued) && !this.hasChainingPanels()) {
      this.chainCounter = 0;
      if (chainQueued) this.outgoing.finalizeCurrentChain(this.stopWatch);
    }
    if (this.outgoing) this.outgoing.processStagedGarbageForClock(this.stopWatch);
    this.removeExtraRows();
    if (this.checkDeath()) this.recordDeath();
  };
  Stack.prototype.runCountdown = function () {
    this.inCountdown = true;
    this.riseLock = true;
    if (this.clock === 0) {
      this.animatingCursorDuringCountdown = true;
      this.curRow = this.height - 1;
      this.curCol = this.width - 1;
    } else if (this.clock === COUNTDOWN_START) this.countdownTimer = COUNTDOWN_LENGTH;
    if (set(this.countdownTimer)) {
      var f = COUNTDOWN_LENGTH - this.countdownTimer;
      if (f > 0 && f % COUNTDOWN_CURSOR_SPEED === 0) {
        var move = Math.floor(f / COUNTDOWN_CURSOR_SPEED);
        if (move <= 4) this.moveCursorInDirection('down');
        else if (move <= 6) this.moveCursorInDirection('left');
        else if (move === 10) this.animatingCursorDuringCountdown = null;
      }
      if (this.countdownTimer === 0) { this.inCountdown = false; this.countdownTimer = null; }
      if (set(this.countdownTimer)) this.countdownTimer--;
    }
  };
  Stack.prototype.run = function () {
    if (this.gameOverClock > 0 && this.clock >= this.gameOverClock) return;
    var pressed = this.pressSwap || !!(this.nextInput & IN.swap), before = this.swapCount;
    this.swapDeniedThisFrame = false;
    this.inputBits = this.nextInput | (this.pressSwap ? IN.swap : 0);
    this.nextInput = 0; this.pressSwap = false;
    this.controls();
    if (this.behaviours.delaySimulationUntil === 'countdownEnded' && this.clock <= COUNTDOWN_START + COUNTDOWN_LENGTH) {
      this.runCountdown();
      if (this.clock === COUNTDOWN_START + COUNTDOWN_LENGTH) this.stopWatchIsRunning = true;
    }
    if (this.stopWatchIsRunning) this.runPhysics();
    else if (this.behaviours.delaySimulationUntil === 'firstInput' || this.behaviours.delaySimulationUntil === 'firstSwap') throw new Error('PAEngine: delaySimulationUntil ' + this.behaviours.delaySimulationUntil);
    this.applyCursorDirection(this.cursorDirection);
    if (this.swapThisFrame) this.tryQueueSwapPanels(this.panels[this.curRow][this.curCol], this.panels[this.curRow][this.curCol + 1]);
    if (pressed && this.swapCount === before) this.swapDeniedThisFrame = true;
    this.handleManualRaise();
    if (this.stopWatchIsRunning) {
      if (this.shouldDropGarbage()) {
        var g = this.incoming.pop();
        this.dropGarbage(g.width, g.height, g.isMetal);
      }
      this.stopWatch++;
    }
    this.clock++;
    this.prevInput = this.input;
  };

  function bitsOf(i) {
    if (typeof i === 'number') return i;
    var b = 0;
    if (i) for (var k in IN) if (i[k]) b |= IN[k];
    return b;
  }
  Stack.prototype.setInput = function (input) { this.nextInput = bitsOf(input); this.input = input; };
  Stack.prototype.tryQueueSwap = function (row, col) {
    if (this.gameOverClock > 0) return false;
    if (row !== this.curRow || col !== this.curCol) return false;
    this.pressSwap = true;
    return true;
  };
  Stack.prototype.canSwap = function (row, col) {
    if (row < 1 || row > this.height || col < 1 || col >= W) return false;
    return this.canSwapPanels(this.panels[row][col], this.panels[row][col + 1])[0];
  };
  Stack.prototype.drainEvents = function () { var e = this.events; this.events = []; return e; };
  // ---- what a game reads and does that the Lua leaves to its client
  Stack.prototype.panelAt = function (row, col) {
    if (row < 0 || row >= this.panels.length || col < 1 || col > W) return null;
    return this.panels[row][col];
  };
  Stack.prototype.clampCursor = function () {
    this.curRow = bound(1, this.curRow, this.topCurRow);
    this.curCol = bound(1, this.curCol, W - 1);
  };
  // A tap on a pair: the cursor goes there and swap is pressed, as a
  // controller would after walking there; the engine decides on the next
  // frame whether the swap is made.
  Stack.prototype.touchSwap = function (row, col) {
    if (!this.canSwap(row, col)) return false;
    this.curRow = row; this.curCol = col;
    this.clampCursor();
    return this.tryQueueSwap(this.curRow, this.curCol);
  };
  Stack.prototype.fillRatio = function () {
    for (var row = this.height; row >= 1; row--) for (var col = 1; col <= W; col++) if (this.panels[row][col].color !== 0) return row / this.height;
    return 0;
  };

  function copyPanel(p) { var q = Object.create(Panel.prototype); for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) q[k] = p[k]; return q; }
  Stack.prototype.copy = function () {
    var s = Object.create(Stack.prototype), k;
    for (k in this) {
      if (!Object.prototype.hasOwnProperty.call(this, k)) continue;
      var v = this[k];
      if (k === 'panels') s.panels = v.map(function (row) { return row.map(function (p) { return p ? copyPanel(p) : p; }); });
      else if (k === 'source') s.source = v.copy();
      else if (k === 'outgoing') s.outgoing = v ? v.copy() : v;
      else if (k === 'levelData' || k === 'behaviours' || k === 'frames') s[k] = v;
      else if (Array.isArray(v)) s[k] = v.map(function (x) { return x && typeof x === 'object' ? Object.assign({}, x) : x; });
      else if (v && typeof v === 'object') s[k] = Object.assign({}, v);
      else s[k] = v;
    }
    return s;
  };

  var PANEL_FROM_LUA = { row: 'row', column: 'col', id: 'id', color: 'color', chaining: 'chaining', matching: 'matching',
    timer: 'timer', initial_time: 'initialTime', pop_time: 'popTime', pop_index: 'popIndex', x_offset: 'xOffset',
    y_offset: 'yOffset', width: 'gWidth', height: 'gHeight', shake_time: 'shakeTime', isGarbage: 'isGarbage', state: 'state',
    combo_index: 'comboIndex', combo_size: 'comboSize', isSwappingFromLeft: 'swapFromLeft', dont_swap: 'dontSwap',
    queuedHover: 'queuedHover', fell_from_garbage: 'fellFromGarbage', stateChanged: 'stateChanged',
    propagatesChaining: 'propagatesChaining', matchAnyway: 'matchAnyway', propagatesFalling: 'propagatesFalling',
    garbageId: 'garbageId', metal: 'metal' };
  var STACK_FROM_LUA = { speed: 'speed', nextSpeedIncreaseClock: 'nextSpeedIncreaseClock', health: 'health',
    garbageCreatedCount: 'garbageCreatedCount', highestGarbageIdMatched: 'highestGarbageIdMatched', panelsCreatedCount: 'panelIdCount',
    displacement: 'displacement', wasToppedOut: 'wasToppedOut', rise_timer: 'riseTimer', rise_lock: 'riseLock', has_risen: 'hasRisen',
    stop_time: 'stopTime', pre_stop_time: 'preStopTime', score: 'score', chain_counter: 'chainCounter', n_active_panels: 'nActive',
    n_prev_active_panels: 'nPrevActive', swappingPanelCount: 'swappingCount', manual_raise: 'manualRaise',
    manual_raise_yet: 'manualRaiseYet', prevent_manual_raise: 'preventManualRaise', swapThisFrame: 'swapThisFrame',
    cur_wait_time: 'curWaitTime', cur_timer: 'curTimer', cursorDirection: 'cursorDirection', cur_row: 'curRow', cur_col: 'curCol',
    queuedSwapColumn: 'queuedSwapCol', queuedSwapRow: 'queuedSwapRow', top_cur_row: 'topCurRow', swapCount: 'swapCount',
    panels_cleared: 'panelsCleared', metalPanelsQueued: 'metalPanelsQueued', prev_shake_time: 'prevShakeTime',
    shake_time: 'shakeTime', shake_time_on_frame: 'shakeTimeOnFrame', peak_shake_time: 'peakShakeTime', clock: 'clock',
    stopWatch: 'stopWatch', stopWatchIsRunning: 'stopWatchIsRunning', game_over_clock: 'gameOverClock', in_countdown: 'inCountdown',
    cursorLock: 'cursorLock', height: 'height', width: 'width', countdown_timer: 'countdownTimer',
    animatingCursorDuringCountdown: 'animatingCursorDuringCountdown', countdownOffsetFrames: 'countdownOffsetFrames' };
  function list(x) { return Array.isArray(x) ? x : []; }
  function fromLua(state, level, source) {
    var s = Object.create(Stack.prototype), k, lua = state.stack;
    for (k in STACK_FROM_LUA) s[STACK_FROM_LUA[k]] = lua[k] === undefined ? null : lua[k];
    if (s.curWaitTime === null) s.curWaitTime = 20;
    if (s.inCountdown === null) s.inCountdown = false;
    if (s.gameOverClock === null) s.gameOverClock = -1;
    s.gameOver = s.gameOverClock > 0;
    var ld = level.levelData;
    s.levelData = { startingSpeed: ld.startingSpeed, colors: ld.colors, maxHealth: ld.maxHealth, shockFrequency: ld.shockFrequency,
                    shockCap: ld.shockCap, speedIncreaseMode: ld.speedIncreaseMode, stop: ld.stop };
    s.frames = ld.frameConstants;
    s.behaviours = level.behaviours;
    if (!level.stackOverConditions || level.stackOverConditions.HEALTH !== 0 || Object.keys(level.stackOverConditions).length !== 1) {
      throw new Error('PAEngine: only the HEALTH = 0 end condition');
    }
    s.panels = state.panels.map(function (row, r) {
      var out = [null];
      for (var c = 0; c < W; c++) {
        var lp = row[c];
        if (!lp) throw new Error('PAEngine: missing panel ' + r + ',' + (c + 1));
        var p = Object.create(Panel.prototype);
        for (var key in PANEL_FROM_LUA) p[PANEL_FROM_LUA[key]] = lp[key] === undefined ? null : lp[key];
        if (lp.isGarbage === undefined) p.isGarbage = false;
        out.push(p);
      }
      return out;
    });
    s.dropColumnIndex = state.dropColumns.slice();
    s.garbageLandedThisFrame = list(state.garbageLandedThisFrame).slice();
    s.swapStallBacklog = list(state.swapStallingBackLog).map(function (r) { return { leftId: r.leftId, rightId: r.rightId, row: r.row, col: r.col, clock: r.clock }; });
    s.incoming = list(state.incoming.staged).map(function (g) {
      return { width: g.width, height: g.height, isChain: !!g.isChain, isMetal: !!g.isMetal, frameEarned: g.frameEarned,
               finalized: g.finalized === undefined ? null : g.finalized };
    });
    s.outgoing = GarbageQueue.fromLua(state.outgoing);
    s.source = source || new Unseen();
    s.events = [];
    s.nextInput = 0; s.pressSwap = false; s.inputBits = 0; s.swapDeniedThisFrame = false;
    s.input = {}; s.prevInput = {};
    return s;
  }

  function f7(k) { return Number((k / 7).toPrecision(14)); }
  var MODERN = [null,
    [1, 12, 21, 5, 0, 121, -20, 80, 160, 20, 20, 12, 41, 44, 20, 9],
    [5, 14, 18, 5, f7(1), 101, -16, 77, 152, 18, 18, 12, 36, 44, 18, 9],
    [9, 16, 18, 5, f7(2), 81, -12, 74, 144, 16, 16, 11, 31, 42, 17, 8],
    [13, 19, 15, 5, f7(3), 66, -8, 71, 136, 14, 14, 10, 26, 42, 16, 8],
    [17, 23, 15, 5, f7(4), 51, -3, 68, 128, 12, 12, 9, 21, 38, 15, 8],
    [21, 26, 12, 5, f7(5), 41, 2, 65, 120, 10, 10, 6, 16, 36, 14, 8],
    [25, 29, 9, 5, f7(6), 31, 7, 62, 112, 8, 8, 5, 13, 34, 13, 8],
    [29, 33, 6, 5, 1, 21, 12, 60, 104, 6, 6, 4, 10, 32, 12, 7],
    [27, 37, 6, 6, 1, 11, 17, 58, 96, 4, 4, 6, 7, 30, 11, 7],
    [32, 41, 3, 6, 1, 1, 22, 56, 88, 2, 2, 6, 4, 28, 10, 7],
    [45, 18, 3, 6, 1, 1, 27, 53, 80, 1, 0, 3, 3, 22, 8, 6]];
  function vsLevel(n) {
    var m = MODERN[n];
    if (!m) throw new Error('PAEngine: no modern level ' + n);
    return {
      levelData: { startingSpeed: m[0], speedIncreaseMode: 1, shockFrequency: m[1], shockCap: m[2], colors: m[3], adjacentDenialFrequency: m[4],
                   maxHealth: m[5], stop: { formula: 1, comboConstant: m[6], chainConstant: m[7], dangerConstant: m[8], coefficient: m[9], dangerCoefficient: m[10] },
                   frameConstants: { HOVER: m[11], GARBAGE_HOVER: m[12], FLASH: m[13], FACE: m[14], POP: m[15] } },
      behaviours: { allowManualRaise: true, passiveRaise: true, swapStallingMode: 1, swapStallingPunish: 4 },
      stackOverConditions: { HEALTH: 0 } };
  }
  function create(level, source) {
    var lv = typeof level === 'number' ? vsLevel(level) : level, ld = lv.levelData, s = Object.create(Stack.prototype), r, c;
    if (!lv.stackOverConditions || lv.stackOverConditions.HEALTH !== 0 || Object.keys(lv.stackOverConditions).length !== 1) {
      throw new Error('PAEngine: only the HEALTH = 0 end condition');
    }
    if (ld.speedIncreaseMode !== 1) throw new Error('PAEngine: speed increase mode ' + ld.speedIncreaseMode);
    for (var k in STACK_FROM_LUA) s[STACK_FROM_LUA[k]] = null;
    s.width = W; s.height = H;
    s.levelData = { startingSpeed: ld.startingSpeed, colors: ld.colors, maxHealth: ld.maxHealth, shockFrequency: ld.shockFrequency,
                    shockCap: ld.shockCap, speedIncreaseMode: ld.speedIncreaseMode, stop: ld.stop };
    s.frames = ld.frameConstants;
    s.behaviours = {};
    for (k in lv.behaviours) s.behaviours[k] = lv.behaviours[k];
    s.source = source || new Unseen();
    s.clock = 0; s.stopWatch = 0; s.gameOverClock = -1; s.gameOver = false;
    s.swapStallBacklog = [];
    s.speed = ld.startingSpeed; s.nextSpeedIncreaseClock = DT_SPEED_INCREASE;
    s.health = ld.maxHealth;
    s.dropColumnIndex = [1, 1, 1, 1, 1, 1];
    s.garbageCreatedCount = 0; s.garbageLandedThisFrame = []; s.highestGarbageIdMatched = 0; s.panelIdCount = 0;
    s.panels = [];
    for (r = 0; r <= s.height; r++) { s.panels[r] = [null]; for (c = 1; c <= W; c++) s.createPanelAt(r, c); }
    s.displacement = 16; s.wasToppedOut = false; s.riseTimer = SPEED_TO_RISE_TIME[s.speed - 1]; s.riseLock = false; s.hasRisen = false;
    s.stopTime = 0; s.preStopTime = 0; s.score = 0; s.chainCounter = 0;
    s.nActive = 0; s.nPrevActive = 0; s.swappingCount = 0;
    s.manualRaise = false; s.manualRaiseYet = false; s.preventManualRaise = false; s.swapThisFrame = false;
    s.curWaitTime = 20; s.curTimer = 0; s.cursorDirection = null; s.curRow = 7; s.curCol = 3;
    s.queuedSwapCol = 0; s.queuedSwapRow = 0;
    s.topCurRow = s.behaviours.passiveRaise ? s.height - 1 : s.height;
    s.swapCount = 0; s.panelsCleared = 0; s.metalPanelsQueued = 0;
    s.prevShakeTime = 0; s.shakeTime = 0; s.shakeTimeOnFrame = 0; s.peakShakeTime = 0;
    s.incoming = [];
    s.outgoing = new GarbageQueue(false, false);
    s.events = [];
    s.nextInput = 0; s.pressSwap = false; s.inputBits = 0; s.swapDeniedThisFrame = false;
    s.input = {}; s.prevInput = {};
    s.inCountdown = true;
    s.countdownOffsetFrames = COUNTDOWN_START + COUNTDOWN_LENGTH;
    s.behaviours.delaySimulationUntil = 'countdownEnded';
    s.stopWatchIsRunning = false;
    for (var i = 0; i < 8; i++) { s.newRow(); s.curRow--; }
    s.events.length = 0;
    s.removeExtraRows();
    return s;
  }

  // A VS stack as Match:start makes one: modern level `level`, its rows and
  // garbage colours dealt from `seed` by the server's generator.
  function GEN() {
    if (typeof module === 'object' && module.exports) return require('./pa-generator.js');
    var g = (typeof globalThis !== 'undefined' ? globalThis : this).PAGenerator;
    if (!g) throw new Error('PAEngine: pa-generator.js is not loaded');
    return g;
  }
  function game(opts) {
    opts = opts || {};
    var lv = vsLevel(opts.level || 10), ld = lv.levelData;
    var s = create(lv, new Seeded(new (GEN().GeneratorSource)(opts.seed === undefined ? 1 : opts.seed, true, ld.colors, ld.adjacentDenialFrequency)));
    s.name = opts.name || 'player';
    s.level = opts.level || 10;
    return s;
  }
  // A puzzle's stack as Puzzle.lua sets one up, starting immediately: no
  // rise, no manual raise, no swap stalling. `stack` is the puzzle's digits,
  // top row first (Puzzles.json "Stack"); 8 is shock, 9 colourless.
  function puzzle(stack, level) {
    var lv = vsLevel(level || 10);
    lv.behaviours = { allowManualRaise: false, passiveRaise: false, swapStallingMode: 0, swapStallingPunish: 0 };
    var s = create(lv, new Unseen()), digits = String(stack).replace(/\s+/g, ''), r, c;
    if (/[^0-9]/.test(digits)) throw new Error('PAEngine: a puzzle stack is digits, not ' + JSON.stringify(stack));
    while (digits.length % W) digits = '0' + digits;
    var rows = digits.length / W;
    if (rows > H) throw new Error('PAEngine: a puzzle stack of ' + rows + ' rows');
    for (r = 1; r <= H; r++) for (c = 1; c <= W; c++) {
      var p = s.panels[r][c], k = (rows - r) * W + (c - 1);
      clearPanel(p, true, true);
      if (r <= rows) p.color = +digits.charAt(k);
    }
    delete s.behaviours.delaySimulationUntil;
    s.inCountdown = false; s.stopWatchIsRunning = true;
    s.topCurRow = s.height;
    // the two frames before a swap is taken (canSwapPanels: clock > 1)
    s.run(); s.run(); s.events.length = 0;
    return s;
  }
  // Runs the stack with no input until nothing moves: what it did on the way.
  Stack.prototype.settle = function (maxFrames) {
    var out = { frames: 0, chain: 0, combos: [], garbage: 0 }, sent = this.outgoing.history.length, quiet = 0;
    for (var f = 0; f < (maxFrames || 1200); f++) {
      this.setInput(0);
      this.run();
      out.frames++;
      for (var i = 0; i < this.events.length; i++) {
        var e = this.events[i];
        if (e.type === 'match') { out.combos.push(e.size); if (e.chainCounter > out.chain) out.chain = e.chainCounter; }
      }
      this.events.length = 0;
      // quiet twice running: a swap that has just ended is matched a frame later
      if (this.nActive === 0 && this.swappingCount === 0 && this.chainCounter === 0 && !this.swapQueued() && !this.hasChainingPanels()) {
        if (++quiet === 2) break;
      } else quiet = 0;
    }
    out.garbage = this.outgoing.history.length - sent;
    return out;
  };
  // Every pair a swap can be made on and that changes the board.
  Stack.prototype.legalSwaps = function () {
    var out = [];
    for (var r = 1; r <= this.topCurRow; r++) for (var c = 1; c < W; c++) {
      if (this.panels[r][c].color === this.panels[r][c + 1].color) continue;
      if (this.canSwap(r, c)) out.push([r, c]);
    }
    return out;
  };
  function fromPanelEngine(pe, source) {
    var s = create(pe.level || 10, source), r, c, k;
    ['speed', 'nextSpeedIncreaseClock', 'clock', 'displacement', 'stopTime', 'preStopTime', 'shakeTime', 'shakeTimeOnFrame',
     'peakShakeTime', 'health', 'chainCounter', 'nActive', 'nPrevActive', 'swappingCount', 'panelsCleared', 'score', 'curRow',
     'curCol', 'topCurRow', 'queuedSwapRow', 'queuedSwapCol', 'garbageCreatedCount', 'highestGarbageIdMatched', 'panelIdCount',
     'riseTimer'].forEach(function (k) { if (pe[k] !== undefined) s[k] = pe[k]; });
    ['riseLock', 'hasRisen', 'manualRaise', 'manualRaiseYet', 'preventManualRaise', 'wasToppedOut'].forEach(function (k) { s[k] = !!pe[k]; });
    s.inCountdown = false; s.countdownTimer = null; s.stopWatchIsRunning = true; s.stopWatch = Math.max(0, s.clock - s.countdownOffsetFrames);
    s.behaviours.delaySimulationUntil = null; s.animatingCursorDuringCountdown = null;
    s.gameOverClock = -1; s.gameOver = false;
    s.incoming = (pe.incoming || []).slice().reverse().map(function (g) {
      return { width: g.width, height: g.height, isChain: !!g.isChain, isMetal: false, frameEarned: s.stopWatch, finalized: true };
    });
    for (var w = 1; w <= W; w++) if (pe.dropColumnIndex && pe.dropColumnIndex[w] !== undefined) s.dropColumnIndex[w - 1] = pe.dropColumnIndex[w] + 1;
    s.panels = [];
    for (r = 0; r < pe.panels.length; r++) {
      s.panels[r] = [null];
      for (c = 1; c <= W; c++) {
        var q = pe.panels[r][c], p = new Panel(r, c, q.id);
        for (k in p) if (Object.prototype.hasOwnProperty.call(q, k)) p[k] = q[k];
        p.row = r; p.col = c;
        if (q.isGarbage && q.garbageId === undefined) p.garbageId = null;
        s.panels[r].push(p);
      }
    }
    s.removeExtraRows();
    return s;
  }

  // Garbage on its way from s, first to be handed over first: each piece with
  // `at`, frames of s's stopWatch until GarbageDelivery hands it to the
  // opponent, `sent` once it has left the staging queue, and `row`, the row
  // it was earned on. A chain still going ships once it ends, which can be
  // the next frame: it is counted at the soonest, and everything behind it
  // waits for it.
  function onTheWay(s) {
    var q = s.outgoing, sw = s.stopWatch, out = [], i;
    function piece(g, at, sent) {
      // a chain's link keeps its row in colEarned (addChainLink's argument order)
      var link = g.links && g.links[g.frameEarned], row = link ? link.colEarned : g.rowEarned;
      return { width: g.width, height: g.height, isChain: !!g.isChain, isMetal: !!g.isMetal,
               finalized: !g.isChain || g.finalized !== false, at: at, sent: sent, row: row === undefined ? null : row };
    }
    if (!q) return out;
    q.transitTimers.forEach(function (t) { q.inTransit[t].forEach(function (g) { out.push(piece(g, t - sw, true)); }); });
    var ship = sw;
    for (i = q.staged.length - 1; i >= 0; i--) {
      var g = q.staged[i];
      ship = Math.max(ship, g.frameEarned + STAGING_DURATION, g.isChain && g.finalized === false ? sw + 1 : 0);
      out.push(piece(g, ship + GARBAGE_DELAY_LAND_TIME - sw, false));
    }
    return out;
  }
  var FLIGHT = STAGING_DURATION + GARBAGE_DELAY_LAND_TIME;

  // A panel-engine.js Stack of s for a bot that reads one. Its `outgoing` is
  // what s has on its way, each piece earned so that panel-engine.js's flight
  // (GARBAGE_FLIGHT from frameEarned) ends when the server hands it over.
  function view(s, PE) {
    var st = toPanelEngine(s, PE), flight = PE.GARBAGE_FLIGHT || FLIGHT;
    st.outgoing = onTheWay(s).map(function (a) {
      return { width: a.width, height: a.height, isChain: a.isChain, isMetal: a.isMetal, finalized: true, frameEarned: st.clock + a.at - flight };
    });
    st.paStack = s;   // the server's own state, for a bot that plays it on the engine
    st.setInput = function (input) { PE.Stack.prototype.setInput.call(st, input); s.setInput(input); };
    st.tryQueueSwap = function (row, col) { return s.canSwap(row, col) && s.tryQueueSwap(row, col); };
    return st;
  }

  function revive(o) {
    Object.setPrototypeOf(o, Stack.prototype);
    for (var r = 0; r < o.panels.length; r++) for (var c = 1; c <= W; c++) Object.setPrototypeOf(o.panels[r][c], Panel.prototype);
    o.source = new Unseen();
    o.events = o.events || [];
    if (o.outgoing) Object.setPrototypeOf(o.outgoing, GarbageQueue.prototype);
    return o;
  }
  function toPanelEngine(s, PE) {
    var lv = 10;
    for (var li = 0; li < PE.LEVELS.length; li++) {
      var L = PE.LEVELS[li];
      if (L.startingSpeed === s.levelData.startingSpeed && L.maxHealth === s.levelData.maxHealth && L.colors === s.levelData.colors) lv = li + 1;
    }
    var st = new PE.Stack({ level: lv, seed: 1, countdown: false });
    var ints = ['speed', 'nextSpeedIncreaseClock', 'clock', 'displacement', 'stopTime', 'preStopTime', 'shakeTime', 'shakeTimeOnFrame',
                'peakShakeTime', 'health', 'chainCounter', 'nActive', 'nPrevActive', 'swappingCount', 'panelsCleared', 'score', 'curRow',
                'curCol', 'topCurRow', 'queuedSwapRow', 'queuedSwapCol', 'garbageCreatedCount', 'highestGarbageIdMatched', 'panelIdCount'];
    ints.forEach(function (k) { st[k] = s[k]; });
    st.riseTimer = s.riseTimer;
    ['riseLock', 'hasRisen', 'manualRaise', 'manualRaiseYet', 'preventManualRaise', 'wasToppedOut'].forEach(function (k) { st[k] = !!s[k]; });
    st.gameOver = s.gameOverClock > 0;
    st.stopWatchIsRunning = true; st.doCountdown = false; st.animatingCursorDuringCountdown = false;
    st.cursorDirection = null; st.cursorTimer = 0;
    st.incoming = s.incoming.slice().reverse().map(function (g) { return { width: g.width, height: g.height, isChain: !!g.isChain }; });
    st.outgoing = []; st.currentChain = null; st.swapStallBacklog = []; st.garbageLandedThisFrame = [];
    st.dropColumnIndex = {};
    for (var w = 1; w <= 6; w++) st.dropColumnIndex[w] = s.dropColumnIndex[w - 1] - 1;
    var rows = [], r, c;
    for (r = 0; r < Math.max(24, s.panels.length); r++) {
      var row = [null];
      for (c = 1; c <= W; c++) {
        var q = r < s.panels.length ? s.panels[r][c] : null, p = {};
        if (!q) {
          p = { row: r, col: c, id: ++st.panelIdCount, color: 0, chaining: false, matching: false, timer: 0, initialTime: 0, popTime: 0,
                popIndex: 0, xOffset: null, yOffset: null, gWidth: 0, gHeight: 0, shakeTime: 0, isGarbage: false, state: 'normal',
                comboIndex: null, comboSize: null, swapFromLeft: null, dontSwap: false, queuedHover: false, fellFromGarbage: 0,
                stateChanged: false, propagatesChaining: false, matchAnyway: false };
        } else {
          p = { row: r, col: c, id: q.id, color: q.color, chaining: !!q.chaining, matching: !!q.matching, timer: q.timer,
                initialTime: q.initialTime || 0, popTime: q.popTime || 0, popIndex: q.popIndex || 0, xOffset: q.xOffset, yOffset: q.yOffset,
                gWidth: q.gWidth || 0, gHeight: q.gHeight || 0, shakeTime: q.shakeTime || 0, isGarbage: !!q.isGarbage,
                state: q.state === 'dead' ? 'normal' : q.state, comboIndex: q.comboIndex, comboSize: q.comboSize,
                swapFromLeft: q.swapFromLeft, dontSwap: !!q.dontSwap, queuedHover: !!q.queuedHover,
                fellFromGarbage: Math.max(0, q.fellFromGarbage || 0), stateChanged: !!q.stateChanged,
                propagatesChaining: !!q.propagatesChaining, matchAnyway: !!q.matchAnyway };
          if (q.propagatesFalling !== null) p.propagatesFalling = !!q.propagatesFalling;
          if (q.garbageId !== null) p.garbageId = q.garbageId;
        }
        row[c] = p;
      }
      rows.push(row);
    }
    st.panels = rows;
    st.swapLatency = 1;
    st.input = { left: false, right: false, up: false, down: false, swap: false, raise: false };
    st.prevInput = st.input;
    st.events = [];
    return st;
  }

  return { Stack: Stack, Panel: Panel, fromLua: fromLua, revive: revive, toPanelEngine: toPanelEngine, fromPanelEngine: fromPanelEngine, view: view, Unseen: Unseen, Recorded: Recorded, Seeded: Seeded, create: create, vsLevel: vsLevel, PANEL_FROM_LUA: PANEL_FROM_LUA,
           STACK_FROM_LUA: STACK_FROM_LUA, IN: IN, list: list, WIDTH: W, HEIGHT: H,
           GarbageQueue: GarbageQueue, deliver: deliver, puzzle: puzzle, onTheWay: onTheWay, FLIGHT: FLIGHT, game: game, COUNTDOWN_TOTAL: COUNTDOWN_START + COUNTDOWN_LENGTH, COMBO_GARBAGE: COMBO_GARBAGE, STAGING_DURATION: STAGING_DURATION,
           GARBAGE_DELAY_LAND_TIME: GARBAGE_DELAY_LAND_TIME };
}));
