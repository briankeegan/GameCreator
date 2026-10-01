// THE SERVER'S ENGINE, IN JS. The Panel Attack server (panel-game, bramp
// branch) plays VS on common/engine/{Stack,Panel,checkMatches,WigglePay}.lua.
// panel-engine.js is this game's own engine and differs from it in ways a
// live match reaches (shock panels, garbage queued by priority, input read
// before physics, the cursor's repeat, swap stalling by panel id), so a bot
// that plays on that server searches on this: the Lua, line for line, for one
// stack past its countdown, with the names panel-engine.js uses so puyocpu.js
// can drive it.
//
// Lua nil is null here, and Lua truthiness is kept where the Lua relies on it
// (0 is true in Lua: a fell_from_garbage or shake_time of 0 is still "set").
// Garbage this stack sends goes nowhere: nothing on this stack's own board
// depends on it.
//
// Rows and garbage colours come from a SOURCE: `unseen` deals the colours no
// player can know yet (as puyocpu.js's search does); a recording's source
// deals what the Lua dealt, to check this against it (pa_engine.test.js, on
// recordings lua/engineRecord.lua makes in a panel-game checkout).
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

  // ----------------------------------------------------------------- panels
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
    // colours past 10 are unseen (Unseen): they match nothing
    if (p.color === 0 || p.color === 9 || p.color > 10) return false;
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

  // ----------------------------------------------------------------- sources
  // Rows the search cannot see yet, and the colours a break it cannot see
  // yet turns into (puyocpu.js unseenRow / unseenBreak, per column).
  function Unseen() {}
  Unseen.prototype.row = function (st) {
    var k = (st.unseenRows = (st.unseenRows || 0) + 1), s = '';
    for (var c = 1; c <= W; c++) s += String.fromCharCode(64 + 11 + ((c + 3 * k) % 6));   // not a digit: see rowColours
    return s;
  };
  Unseen.prototype.garbageRow = function (st) {
    var k = (st.unseenBreaks = (st.unseenBreaks || 0) + 1), o = [];
    for (var c = 1; c <= W; c++) o.push(21 + ((c + 3 * k) % 6));
    return o;
  };
  Unseen.prototype.copy = function () { return this; };
  // What a recording says was dealt, in order.
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
  // GeneratorSource convertMetalPanels. An unseen row's letters are past J
  // (colours 11-16): never shock, since where shock may go is not known yet.
  function rowColours(s, metal) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), code = s.charCodeAt(i), color = 0;
      if (code >= 48 && code <= 57) color = code - 48;
      else if (code >= 75 && code <= 90) color = code - 64;               // unseen: K.. = 11..
      else if (ch >= 'A' && ch <= 'Z') color = metal > 0 ? 8 : LETTER[ch];
      else if (ch >= 'a' && ch <= 'z') color = metal > 1 ? 8 : LETTER[ch];
      out.push(color);
    }
    return out;
  }

  // ----------------------------------------------------------------- stack
  function Stack() {}
  Stack.prototype.frameTimes = null;
  Stack.prototype.idOf = function () { return ++this.panelIdCount; };
  Stack.prototype.createPanelAt = function (row, col) {
    var p = new Panel(row, col, this.idOf());
    this.panels[row][col] = p;
    return p;
  };
  Stack.prototype.onPop = function (p) {
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

  // ---- WigglePay
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

  // ---- swapping
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

  // ---- matches (checkMatches.lua)
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
    // Positions are distinct, so the order is total and any sort agrees with table.sort.
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
    // Contact between pieces, both ways (Lua reads garbageMatching[a][b] with
    // pairs, whose order does not change which ids are reached).
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
      var gps = this.getConnectedGarbagePanels(matching), onScreen = 0;
      if (gps) {
        for (i = 0; i < gps.length; i++) if (gps[i].row <= this.height) onScreen++;
        this.matchGarbagePanels(gps, f.FLASH + f.FACE + f.POP * (comboSize + onScreen), isChainLink, onScreen);
      }
      this.preStopTime = Math.max(this.preStopTime, f.FLASH + f.FACE + f.POP * (comboSize + onScreen));
      var stopTime = this.calculateStopTime(comboSize, this.wasToppedOut, isChainLink, this.chainCounter);
      if (stopTime > this.stopTime) this.stopTime = stopTime;
      this.events.push({ type: 'match', chain: isChainLink, size: comboSize, garbage: gps ? gps.length : 0 });
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

  // ---- rows and garbage
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
  // GarbageQueue order: priority rising with index, the next to drop last.
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
  // BaseStack:receiveGarbage: every piece pushed, the queue re-ordered after
  // each. (Pieces the order cannot tell apart are the same garbage.)
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

  // ---- the frame
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
    if (this.chainCounter !== 0 && !this.hasChainingPanels()) this.chainCounter = 0;
    this.removeExtraRows();
    if (this.checkDeath()) this.recordDeath();
  };
  // Stack:run, past the countdown.
  Stack.prototype.run = function () {
    if (this.gameOverClock > 0 && this.clock >= this.gameOverClock) return;
    if (this.inCountdown || !this.stopWatchIsRunning) throw new Error('PAEngine: only a stack past its countdown');
    var pressed = this.pressSwap || !!(this.nextInput & IN.swap), before = this.swapCount;
    this.swapDeniedThisFrame = false;
    this.inputBits = this.nextInput | (this.pressSwap ? IN.swap : 0);
    this.nextInput = 0; this.pressSwap = false;
    this.controls();
    this.runPhysics();
    this.applyCursorDirection(this.cursorDirection);
    if (this.swapThisFrame) this.tryQueueSwapPanels(this.panels[this.curRow][this.curCol], this.panels[this.curRow][this.curCol + 1]);
    // A swap pressed and not taken, for whatever reason (not allowed, or one
    // already queued), is a swap refused.
    if (pressed && this.swapCount === before) this.swapDeniedThisFrame = true;
    this.handleManualRaise();
    if (this.shouldDropGarbage()) {
      var g = this.incoming.pop();
      this.dropGarbage(g.width, g.height, g.isMetal);
    }
    this.stopWatch++;
    this.clock++;
    this.prevInput = this.input;
  };

  // ---- what a bot calls (panel-engine.js's names)
  function bitsOf(i) {
    if (typeof i === 'number') return i;
    var b = 0;
    if (i) for (var k in IN) if (i[k]) b |= IN[k];
    return b;
  }
  // The input the next frame runs with.
  Stack.prototype.setInput = function (input) { this.nextInput = bitsOf(input); this.input = input; };
  // Press swap on the next frame, with the cursor at (row, col). Whether the
  // swap is taken is up to that frame (Stack:run queues it after physics,
  // at the cursor as it then is); swapDeniedThisFrame says it was not.
  Stack.prototype.tryQueueSwap = function (row, col) {
    if (this.gameOverClock > 0) return false;
    if (row !== this.curRow || col !== this.curCol) return false;
    this.pressSwap = true;
    return true;
  };
  // Whether a swap at (row, col) would be allowed on the board as it is now.
  Stack.prototype.canSwap = function (row, col) {
    if (row < 1 || row > this.height || col < 1 || col >= W) return false;
    return this.canSwapPanels(this.panels[row][col], this.panels[row][col + 1])[0];
  };
  Stack.prototype.drainEvents = function () { var e = this.events; this.events = []; return e; };
  Stack.prototype.fillRatio = function () {
    for (var row = this.height; row >= 1; row--) for (var col = 1; col <= W; col++) if (this.panels[row][col].color !== 0) return row / this.height;
    return 0;
  };

  // ---- copies
  function copyPanel(p) { var q = Object.create(Panel.prototype); for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) q[k] = p[k]; return q; }
  Stack.prototype.copy = function () {
    var s = Object.create(Stack.prototype), k;
    for (k in this) {
      if (!Object.prototype.hasOwnProperty.call(this, k)) continue;
      var v = this[k];
      if (k === 'panels') s.panels = v.map(function (row) { return row.map(function (p) { return p ? copyPanel(p) : p; }); });
      else if (k === 'source') s.source = v.copy();
      else if (k === 'levelData' || k === 'behaviours' || k === 'frames') s[k] = v;
      else if (Array.isArray(v)) s[k] = v.map(function (x) { return x && typeof x === 'object' ? Object.assign({}, x) : x; });
      else if (v && typeof v === 'object') s[k] = Object.assign({}, v);
      else s[k] = v;
    }
    return s;
  };

  // ---- from the Lua (lua/engineRecord.lua's state)
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
    cursorLock: 'cursorLock', height: 'height', width: 'width' };
  // A stack from a recorded state. `level` is the recording's levelData,
  // behaviours and stackOverConditions; `source` deals its rows.
  // Lua writes an empty table as {}.
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
    s.source = source || new Unseen();
    s.events = [];
    s.nextInput = 0; s.pressSwap = false; s.inputBits = 0; s.swapDeniedThisFrame = false;
    s.input = {}; s.prevInput = {};
    return s;
  }

  // A board sent to another thread comes back a plain object: give it its
  // prototypes again (the source is unseen: a search's).
  function revive(o) {
    Object.setPrototypeOf(o, Stack.prototype);
    for (var r = 0; r < o.panels.length; r++) for (var c = 1; c <= W; c++) Object.setPrototypeOf(o.panels[r][c], Panel.prototype);
    o.source = new Unseen();
    o.events = o.events || [];
    return o;
  }
  // THE SAME BOARD AS panel-engine.js HOLDS ONE, for the parts of a bot that
  // read a board rather than play it (candidates, their scores): nil is the
  // engine's default, shock panels are the colour 8 they match as, shock
  // garbage is garbage. Nothing is played on this; searches play the Stack.
  function toPanelEngine(s, PE) {
    var st = new PE.Stack({ level: 10, seed: 1, countdown: false });
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
    st.input = { left: false, right: false, up: false, down: false, swap: false, raise: false };
    st.prevInput = st.input;
    st.events = [];
    return st;
  }

  return { Stack: Stack, Panel: Panel, fromLua: fromLua, revive: revive, toPanelEngine: toPanelEngine, Unseen: Unseen, Recorded: Recorded, PANEL_FROM_LUA: PANEL_FROM_LUA,
           STACK_FROM_LUA: STACK_FROM_LUA, IN: IN, list: list, WIDTH: W, HEIGHT: H };
}));
