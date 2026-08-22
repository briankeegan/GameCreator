// Puzzle Attack — the panel engine.
//
// A JS port of the core of `briankeegan/panel-game` (the Lua/LÖVE Panel
// Attack fork listed as the reference source in reference/the-game/PLOT.md).
// This file is deliberately headless: no DOM, no canvas, no audio. It is a
// deterministic, frame-stepped simulation (60 fps, integer frame timers) that
// duel.js renders and drives, and that panel-cpu.js reads to play the
// opponent. Keeping it DOM-free is what makes it testable from node in the
// smoke test, and what lets both stacks in a duel run off one clock.
//
// What is ported 1:1 from the Lua engine (same numbers, same frame counts):
//   * the panel state machine — normal / swapping / matched / popping /
//     popped / hovering / falling / landing (common/engine/Panel.lua)
//   * the level table: rise speed, colors, health, stop-time formula and the
//     FLASH / FACE / POP / HOVER / GARBAGE_HOVER frame constants
//     (common/data/LevelPresets.lua, "modern" 1-10)
//   * SPEED_TO_RISE_TIME and the speed-up interval (common/engine/consts.lua)
//   * the combo -> garbage width table and chain -> garbage height rule,
//     and the garbage-size -> shake-frames table (common/engine/checkMatches.lua,
//     common/engine/Stack.lua)
//   * garbage physics: falls as one block, clears when a match touches it,
//     bottom row converts to panels and hovers for GARBAGE_HOVER, the rest
//     stays garbage (this is what makes garbage chains possible)
//
// What is deliberately left out (and why):
//   * shock/metal panels — a whole extra panel class for one attack type the
//     plot never mentions; every level here runs with shockCap 0.
//   * rollback/netplay, replays, puzzles, score modes — single-machine game.
//   * PA's exact "matchAnyway" propagation through simultaneous swaps. The
//     common cases (chain through a hover, chain out of cleared garbage) are
//     ported; the rare swap-timing corner cases are not.
(function (root) {
  "use strict";

  var W = 6;          // board width in columns
  var HEIGHT = 12;    // visible rows; row 0 is the dimmed row rising in from below
  var MAX_ROWS = 24;  // allocated rows (garbage lands above the visible board)
  var DT_SPEED_INCREASE = 15 * 60; // frames between passive speed level-ups

  // consts.SPEED_TO_RISE_TIME: frames it takes to rise ONE PIXEL of the 16
  // pixels that make up a row. Yes, 2 is slower than 1, and 50..99 are equal —
  // that is faithful to the original table.
  var SPEED_TO_RISE_TIME = [
    942, 983, 838, 790, 755, 695, 649, 604, 570, 515,
    474, 444, 394, 370, 347, 325, 306, 289, 271, 256,
    240, 227, 213, 201, 189, 178, 169, 158, 148, 138,
    129, 120, 112, 105, 99, 92, 86, 82, 77, 73,
    69, 66, 62, 59, 56, 54, 52, 50, 48, 47,
    47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
    47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
    47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
    47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
    47, 47, 47, 47, 47, 47, 47, 47, 47
  ].map(function (x) { return x / 16; });

  function riseTime(speed) {
    return SPEED_TO_RISE_TIME[Math.min(SPEED_TO_RISE_TIME.length, Math.max(1, speed)) - 1];
  }

  // LevelPresets "modern" 1-10, minus the shock-panel fields.
  function level(startingSpeed, colors, maxHealth, comboConstant, chainConstant,
                dangerConstant, coefficient, dangerCoefficient, hover, garbageHover, flash, face, pop,
                adjacentDenialFrequency) {
    return {
      startingSpeed: startingSpeed,
      colors: colors,
      maxHealth: maxHealth,
      stop: {
        comboConstant: comboConstant, chainConstant: chainConstant,
        dangerConstant: dangerConstant, coefficient: coefficient,
        dangerCoefficient: dangerCoefficient
      },
      frames: { HOVER: hover, GARBAGE_HOVER: garbageHover, FLASH: flash, FACE: face, POP: pop },
      // How often a freshly-generated row rerolls a horizontally-adjacent
      // same-color pair instead of accepting it (PanelGenerator.lua) — 0
      // means never reroll (always allow pairs), 1 means always reroll
      // (never spawn a pair). Levels 1-7 ramp from 0 to 6/7; 8-10 are all 1.
      adjacentDenialFrequency: adjacentDenialFrequency
    };
  }

  var LEVELS = [
    level(1, 5, 121, -20, 80, 160, 20, 20, 12, 41, 44, 20, 9, 0),
    level(5, 5, 101, -16, 77, 152, 18, 18, 12, 36, 44, 18, 9, 1 / 7),
    level(9, 5, 81, -12, 74, 144, 16, 16, 11, 31, 42, 17, 8, 2 / 7),
    level(13, 5, 66, -8, 71, 136, 14, 14, 10, 26, 42, 16, 8, 3 / 7),
    level(17, 5, 51, -3, 68, 128, 12, 12, 9, 21, 38, 15, 8, 4 / 7),
    level(21, 5, 41, 2, 65, 120, 10, 10, 6, 16, 36, 14, 8, 5 / 7),
    level(25, 5, 31, 7, 62, 112, 8, 8, 5, 13, 34, 13, 8, 6 / 7),
    level(29, 5, 21, 12, 60, 104, 6, 6, 4, 10, 32, 12, 7, 1),
    level(27, 6, 11, 17, 58, 96, 4, 4, 6, 7, 30, 11, 7, 1),
    level(32, 6, 1, 22, 56, 88, 2, 2, 6, 4, 28, 10, 7, 1)
  ];

  // checkMatches.lua COMBO_GARBAGE: a combo of N panels sends these garbage
  // widths (each 1 row tall). Anything below +4 sends nothing.
  var COMBO_GARBAGE = { 4: [3], 5: [4], 6: [5], 7: [6], 8: [3, 4], 9: [4, 4],
    10: [5, 5], 11: [5, 6], 12: [6, 6], 13: [6, 6, 6], 14: [6, 6, 6, 6],
    20: [6, 6, 6, 6, 6, 6], 27: [6, 6, 6, 6, 6, 6, 6, 6] };
  function comboGarbage(size) {
    for (var i = Math.min(size, 27); i >= 4; i--) {
      if (COMBO_GARBAGE[i]) return COMBO_GARBAGE[i];
    }
    return [];
  }

  // Stack.lua GARBAGE_SIZE_TO_SHAKE_FRAMES, indexed by panel count.
  var SHAKE_FRAMES = [18, 18, 18, 18, 24, 42, 42, 42, 42, 42, 42, 66,
    66, 66, 66, 66, 66, 66, 66, 66, 66, 66, 66, 76];
  function shakeFramesFor(width, height) {
    var count = width * height;
    if (count <= 0) return 0;
    return SHAKE_FRAMES[Math.min(count, SHAKE_FRAMES.length) - 1];
  }

  // client/src/globals.lua: an attack spends this long in transit + telegraph
  // before it can land on the opponent. Same numbers, so the "attack flies
  // across the screen" animation has the same weight as the original.
  var GARBAGE_TRANSIT_TIME = 45;
  var GARBAGE_TELEGRAPH_TIME = 45;
  var GARBAGE_DELAY_LAND_TIME = 60;
  // GarbageQueue.lua's STAGING_DURATION is TRANSIT + TELEGRAPH + 1 (a
  // historical "+1 to compensate for a compensation someone made," per its
  // own comment) before garbage leaves staging into transit, then
  // GARBAGE_DELAY_LAND_TIME more before it can land — so the real total is
  // 151 frames, not the naive 150 you'd get by adding the three raw
  // constants without that +1.
  var GARBAGE_FLIGHT = GARBAGE_TRANSIT_TIME + GARBAGE_TELEGRAPH_TIME + 1 + GARBAGE_DELAY_LAND_TIME;

  // checkMatches.lua's TA (Tsu-Attack) score tables. Index 0 is always 0 —
  // that's what makes a plain match (comboSize<=3, not chaining) score 0.
  var SCORE_COMBO_TA = [0, 0, 0, 0, 20, 30, 50, 60, 70, 80, 100, 140, 170, 210, 250, 290, 340, 390, 440, 490, 550, 610, 680, 750, 820, 900, 980, 1060, 1150, 1240, 1330];
  // Note index 1 is unused (0) — chain_counter jumps 0 -> 2 directly, never 1
  // (Stack:incrementChainCounter), so index 2 (a x2 chain) is the first
  // meaningful entry.
  var SCORE_CHAIN_TA = [0, 0, 50, 80, 150, 300, 400, 500, 700, 900, 1100, 1300, 1500, 1800];

  // Deterministic RNG (mulberry32) so a duel replays identically from a seed —
  // Math.random would make the smoke test unreproducible.
  function makeRng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // =========================================================================
  // PANELS
  // Panel.lua, as plain objects. color 0 = empty, 1..6 = colors, 9 = garbage.
  // =========================================================================
  function clearFlags(p, clearChaining) {
    p.state = "normal";
    p.comboIndex = null;
    p.comboSize = null;
    p.swapFromLeft = null;
    p.dontSwap = false;
    p.queuedHover = false;
    if (clearChaining) p.chaining = false;
    p.fellFromGarbage = 0;
    p.stateChanged = false;
    p.propagatesChaining = false;
    p.matchAnyway = false;
  }

  function clearPanel(p, clearChaining, clearColor) {
    if (clearColor) p.color = 0;
    p.timer = 0;
    p.initialTime = 0;
    p.popTime = 0;
    p.popIndex = 0;
    p.xOffset = null;
    p.yOffset = null;
    p.gWidth = 0;
    p.gHeight = 0;
    p.shakeTime = 0;
    p.isGarbage = false;
    clearFlags(p, clearChaining);
  }

  function makePanel(row, col, id) {
    var p = { row: row, col: col, id: id, color: 0, chaining: false, matching: false };
    clearPanel(p, true, true);
    return p;
  }

  function panelBelow(stack, p) { return stack.panels[p.row - 1][p.col]; }

  // Two adjacent panels trade places in the grid. Used both for falling and
  // for swapping — "a switch is not a swap" (Panel.lua).
  function switchPanels(stack, a, b) {
    var aRow = a.row, aCol = a.col;
    a.row = b.row; a.col = b.col;
    b.row = aRow; b.col = aCol;
    stack.panels[a.row][a.col] = a;
    stack.panels[b.row][b.col] = b;
  }

  function supportedFromBelow(stack, p) {
    if (p.row <= 1) return true;
    if (!p.isGarbage) return stack.panels[p.row - 1][p.col].color !== 0;
    // Garbage counts as supported if ANY column under the whole block is
    // blocked — a 6-wide slab resting on one panel does not fall.
    var start = p.col - p.xOffset;
    var end = start + p.gWidth - 1;
    for (var col = start; col <= end; col++) {
      var below = stack.panels[p.row - 1][col];
      if (below.color !== 0) {
        if (!below.isGarbage) return true;
        if (p.garbageId === below.garbageId) {
          if (p.yOffset !== below.yOffset) return true;
        } else {
          return true;
        }
      }
    }
    return false;
  }

  function fall(stack, p) {
    var below = panelBelow(stack, p);
    switchPanels(stack, p, below);
    // `below` is now the panel ABOVE p. Panels above falling garbage skip
    // their hover and fall with it.
    if (p.isGarbage) {
      below.propagatesFalling = true;
      below.stateChanged = true;
    }
    if (p.state !== "falling") {
      p.state = "falling";
      p.timer = 0;
      p.stateChanged = true;
    }
  }

  function land(stack, p) {
    if (p.isGarbage) {
      onGarbageLand(stack, p);
      p.state = "normal";
    } else {
      p.fellFromGarbage = 0;
      p.state = "landing";
      p.timer = 12; // animation only
    }
    p.stateChanged = true;
  }

  function onGarbageLand(stack, p) {
    if (p.shakeTime && p.row <= stack.height) {
      if (stack.garbageLandedThisFrame.indexOf(p.garbageId) === -1) {
        stack.shakeTimeOnFrame = Math.max(stack.shakeTimeOnFrame, p.shakeTime, stack.peakShakeTime);
        stack.peakShakeTime = Math.max(stack.shakeTimeOnFrame, stack.peakShakeTime);
        stack.garbageLandedThisFrame.push(p.garbageId);
        stack.events.push({ type: "garbageLand", row: p.row, col: p.col });
      }
      p.shakeTime = 0;
    }
  }

  function enterHoverFromNormal(stack, p, below, hoverTime) {
    clearFlags(p, false);
    p.state = "hovering";
    if (below.propagatesChaining) {
      p.propagatesChaining = true;
      p.chaining = true;
      // Panels above a match that just finished popping are matchable for one
      // frame on entering hover (that is how a chain link is detected).
      // Panels above CLEARED GARBAGE are not — below.color is non-zero there.
      p.matchAnyway = below.color === 0 || below.matchAnyway;
    }
    p.timer = hoverTime;
    p.stateChanged = true;
  }

  function updateNormal(stack, p) {
    if (p.isGarbage) {
      if (!supportedFromBelow(stack, p)) fall(stack, p);
      return;
    }
    if (p.color === 0 || p.row < 1) return;
    var below = panelBelow(stack, p);
    if (!below.stateChanged) return;
    if (below.state === "hovering") {
      enterHoverFromNormal(stack, p, below, below.timer);
    } else if (below.color === 0) {
      if (below.propagatesFalling) {
        fall(stack, p);
      } else if (below.state === "normal") {
        enterHoverFromNormal(stack, p, below, stack.frames.HOVER);
      }
      // if the empty panel below is swapping we wait for the swap to finish
    } else if (below.queuedHover && below.propagatesChaining && below.state === "swapping") {
      // Hover time is the remaining swap time(s) below plus the hover of the
      // first hovering panel found under them.
      var hoverTime = below.timer;
      var hoverPanel = panelBelow(stack, below);
      while (hoverPanel && hoverPanel.state === "swapping") {
        hoverTime += hoverPanel.timer;
        hoverPanel = hoverPanel.row > 1 ? panelBelow(stack, hoverPanel) : null;
      }
      hoverTime += (hoverPanel && hoverPanel.state === "hovering") ? hoverPanel.timer : stack.frames.HOVER;
      enterHoverFromNormal(stack, p, below, hoverTime);
    }
  }

  function finishSwap(p) {
    p.state = "normal";
    p.dontSwap = false;
    p.swapFromLeft = null;
    p.stateChanged = true;
  }

  function updateSwapping(stack, p) {
    if (p.timer > 0) p.timer--;
    if (p.timer === 0) {
      var below = p.row > 1 ? panelBelow(stack, p) : null;
      if (p.color === 0 || !below) {
        finishSwap(p);
      } else if (below.color === 0 || below.state === "hovering" || p.queuedHover) {
        clearFlags(p, false);
        p.state = "hovering";
        p.propagatesChaining = below.propagatesChaining;
        p.matchAnyway = (below.color !== 0 && below.state === "hovering") ? below.matchAnyway : false;
        p.timer = stack.frames.HOVER; // swapping panels always get full hover
        p.stateChanged = true;
      } else {
        finishSwap(p);
      }
    } else if (p.row > 1) {
      // A pop below while this panel is mid-swap still has to hand the chain
      // on to everything above it.
      var b = panelBelow(stack, p);
      if (b && b.stateChanged && b.propagatesChaining) {
        p.queuedHover = p.color !== 0;
        p.stateChanged = true;
        p.propagatesChaining = true;
      }
    }
  }

  function updateMatched(stack, p) {
    if (p.timer > 0) p.timer--;
    if (p.isGarbage && p.timer === p.popTime) {
      stack.events.push({ type: "pop", row: p.row, col: p.col, garbage: true, index: p.popIndex });
    }
    if (p.timer !== 0) return;
    if (p.isGarbage) {
      if (p.yOffset === -1) {
        // The bottom row of a cleared garbage block becomes real panels, which
        // hover for GARBAGE_HOVER and carry the chain flag — this is what lets
        // cleared garbage keep a chain alive.
        clearPanel(p, false, false);
        p.chaining = true;
        p.propagatesChaining = true;
        p.timer = stack.frames.GARBAGE_HOVER;
        p.fellFromGarbage = 12;
        p.state = "hovering";
        p.stateChanged = true;
      } else {
        p.state = "normal"; // upper rows go back to being plain garbage
      }
    } else {
      p.state = "popping";
      p.timer = p.comboIndex * stack.frames.POP;
      p.stateChanged = true;
    }
  }

  function updatePopping(stack, p) {
    if (p.timer > 0) p.timer--;
    if (p.timer !== 0) return;
    stack.events.push({ type: "pop", row: p.row, col: p.col, color: p.color, index: p.comboIndex, size: p.comboSize });
    if (p.comboSize === p.comboIndex) {
      popped(stack, p);
    } else {
      p.state = "popped";
      p.timer = (p.comboSize - p.comboIndex) * stack.frames.POP;
      p.stateChanged = true;
    }
  }

  function popped(stack, p) {
    stack.panelsCleared++;
    clearPanel(p, true, true);
    // flag so panels above know they are chaining
    p.propagatesChaining = true;
    p.stateChanged = true;
  }

  function updatePopped(stack, p) {
    if (p.timer > 0) p.timer--;
    if (p.timer === 0) popped(stack, p);
  }

  function updateHovering(stack, p) {
    if (p.timer > 0) p.timer--;
    if (p.matchAnyway) p.matchAnyway = false;
    if (p.timer === 0) {
      var below = panelBelow(stack, p);
      if (below.state === "hovering") {
        p.timer = below.timer; // hover together with the panel below
      } else if (below.color !== 0) {
        land(stack, p);
      } else {
        fall(stack, p);
      }
    }
    if (!p.stateChanged && p.fellFromGarbage) p.fellFromGarbage--;
  }

  function updateFalling(stack, p) {
    if (p.row === 1) {
      land(stack, p);
    } else if (supportedFromBelow(stack, p)) {
      if (p.isGarbage) {
        land(stack, p);
      } else {
        var below = panelBelow(stack, p);
        if (below.state === "hovering") {
          clearFlags(p, false);
          p.state = "hovering";
          p.stateChanged = true;
          p.propagatesChaining = below.propagatesChaining;
          p.timer = below.timer;
        } else {
          land(stack, p);
        }
      }
    } else {
      fall(stack, p);
    }
    if (!p.stateChanged && p.fellFromGarbage) p.fellFromGarbage--;
  }

  function updateLanding(stack, p) {
    updateNormal(stack, p);
    if (!p.stateChanged) {
      if (p.timer > 0) p.timer--;
      if (p.timer === 0) { p.state = "normal"; p.stateChanged = true; }
    }
  }

  function updatePanel(stack, p) {
    p.stateChanged = false;
    p.propagatesChaining = false;
    p.propagatesFalling = false;
    p.matching = false;
    switch (p.state) {
      case "normal": updateNormal(stack, p); break;
      case "swapping": updateSwapping(stack, p); break;
      case "matched": updateMatched(stack, p); break;
      case "popping": updatePopping(stack, p); break;
      case "popped": updatePopped(stack, p); break;
      case "hovering": updateHovering(stack, p); break;
      case "falling": updateFalling(stack, p); break;
      case "landing": updateLanding(stack, p); break;
      default: break;
    }
  }

  function canMatch(p) {
    if (p.color === 0 || p.color === 9) return false;
    return p.state === "normal" || p.state === "landing" || (p.matchAnyway && p.state === "hovering");
  }

  // Panel.allowsSwap in the reference also allows "falling" — catching a
  // panel mid-fall and redirecting it sideways is a core Panel-Attack
  // mechanic, not an edge case. Missing here meant a falling panel could
  // never be swapped at all.
  function allowsSwap(p) {
    if (p.dontSwap || p.isGarbage) return false;
    return p.state === "normal" || p.state === "swapping" || p.state === "landing" || p.state === "falling";
  }

  // =========================================================================
  // STACK — one player's board (Stack.lua)
  // =========================================================================
  function Stack(opts) {
    opts = opts || {};
    var levelIndex = Math.min(LEVELS.length, Math.max(1, opts.level || 3));
    this.levelData = LEVELS[levelIndex - 1];
    this.level = levelIndex;
    this.frames = this.levelData.frames;
    this.colors = opts.colors || this.levelData.colors;
    this.maxHealth = this.levelData.maxHealth;
    this.width = W;
    this.height = HEIGHT;
    this.name = opts.name || "player";
    this.rng = makeRng(opts.seed || 1);
    // PanelGenerator's adaptive horizontal-pair denial: NOT a per-pick
    // probability roll — it tracks how many pair-rolls have actually been
    // accepted vs denied over the stack's whole lifetime and denies the
    // next one whenever the running denial RATE hasn't yet caught up to
    // adjacentDenialFrequency. See generateRowColors.
    this.adjacentDenialFrequency = this.levelData.adjacentDenialFrequency;
    this.adjacentAccepted = 0;
    this.adjacentDenied = 0;

    this.panels = [];
    this.panelIdCount = 0;
    for (var row = 0; row < MAX_ROWS; row++) this.panels.push(this.makeEmptyRow(row));

    this.speed = this.levelData.startingSpeed;
    this.nextSpeedIncreaseClock = DT_SPEED_INCREASE;
    this.clock = 0;
    this.displacement = 16;
    this.riseTimer = riseTime(this.speed);
    this.riseLock = false;
    this.hasRisen = false;
    this.manualRaise = false;
    this.manualRaiseYet = false;
    this.preventManualRaise = false;

    this.stopTime = 0;
    this.preStopTime = 0;
    this.shakeTime = 0;
    this.shakeTimeOnFrame = 0;
    this.peakShakeTime = 0;
    this.health = this.maxHealth;
    this.wasToppedOut = false;

    this.chainCounter = 0;
    this.currentChain = null;
    this.nActive = 0;
    this.nPrevActive = 0;
    this.swappingCount = 0;
    this.swapStallBacklog = [];
    this.panelsCleared = 0;
    this.score = 0;

    this.curRow = 7; // Stack.lua:254 default
    this.curCol = 3; // cursor covers curCol and curCol + 1
    this.topCurRow = this.height - 1;
    this.queuedSwapRow = 0;
    this.queuedSwapCol = 0;

    this.incoming = [];  // garbage that has arrived and is waiting for a gap
    this.outgoing = [];  // garbage this stack has sent, still in flight
    this.garbageCreatedCount = 0;
    // Highest garbageId that has ever legitimately been matched (either
    // on-screen, or already matched before) — see getConnectedGarbagePanels.
    this.highestGarbageIdMatched = 0;
    this.garbageLandedThisFrame = [];
    this.dropColumnIndex = {};

    this.gameOver = false;
    this.won = false;
    this.events = []; // drained by the renderer each frame

    this.input = { left: false, right: false, up: false, down: false, swap: false, raise: false };
    this.prevInput = { left: false, right: false, up: false, down: false, swap: false, raise: false };
    this.cursorTimer = 0;

    this.buildStartingBoard();
  }

  Stack.prototype.makeEmptyRow = function (row) {
    var r = [];
    r[0] = null; // 1-indexed columns, like the original
    for (var col = 1; col <= W; col++) r[col] = makePanel(row, col, ++this.panelIdCount);
    return r;
  };

  // GeneratorSource:isBadRow — an entire generated row is rerolled if every
  // color present in it appears exactly 0 or 2 times (too evenly "paired up"
  // to read as random). row is a 1-indexed color array like this.panels[r].
  function isBadRow(row) {
    var counts = {};
    for (var c = 1; c <= 9; c++) counts[c] = 0;
    for (var col = 1; col < row.length; col++) counts[row[col]] = (counts[row[col]] || 0) + 1;
    for (var color = 1; color <= 9; color++) {
      var count = counts[color];
      if (count !== 0 && count !== 2) return false;
    }
    return true;
  }

  // PanelGenerator:generatePanels — generates one full row of colors given
  // the fixed neighbor row it can't vertically match (neighborColors, a
  // 1-indexed array, or null/undefined for "no neighbor"). Never a third
  // color in a row; a second-in-a-row (horizontal adjacency) is allowed or
  // denied per this level's adjacentDenialFrequency, using the same
  // lifetime accepted/denied counters as the reference (so the very first
  // adjacent-pair roll of the whole game is always accepted, since
  // 0/0 is NaN and NaN <= x is false). The whole row is rerolled if it ends
  // up "bad" (see isBadRow).
  Stack.prototype.generateRowColors = function (neighborColors) {
    var row;
    do {
      row = [];
      row[0] = null;
      for (var n = 1; n <= W; n++) {
        var previousTwoMatch = n > 2 && row[n - 1] === row[n - 2];
        var belowColor = neighborColors ? neighborColors[n] : 0;
        var color, nogood = true;
        while (nogood) {
          color = 1 + Math.floor(this.rng() * this.colors);
          if (color === belowColor) {
            nogood = true;
          } else if (previousTwoMatch && color === row[n - 1]) {
            nogood = true;
          } else if (n > 1 && color === row[n - 1]) {
            if (this.adjacentDenialFrequency >= 1) {
              nogood = true;
            } else if (this.adjacentDenialFrequency === 0) {
              nogood = false;
            } else {
              var frequency = this.adjacentDenied / (this.adjacentAccepted + this.adjacentDenied);
              if (frequency <= this.adjacentDenialFrequency) {
                this.adjacentDenied++;
                nogood = true;
              } else {
                this.adjacentAccepted++;
                nogood = false;
              }
            }
          } else {
            nogood = false;
          }
        }
        row[n] = color;
      }
    } while (isBadRow(row));
    return row;
  };

  // GeneratorSource:getStartingBoardHeight — always 7, regardless of level.
  var STARTING_BOARD_HEIGHT = 7;

  // A fresh board is not a flat rectangle in the reference engine
  // (GeneratorSource:generateStartingBoard) — it fills a full 7-row
  // rectangle, then randomly clears 2*width panels, each time picking a
  // random column and removing its CURRENT topmost occupied cell. That's
  // what gives a new game a jagged, per-column-staggered starting board
  // instead of a dead-flat one — visible on literally the first frame of
  // every game, so it's not a subtle port detail.
  Stack.prototype.buildStartingBoard = function () {
    var neighborColors = null;
    for (var row = 1; row <= STARTING_BOARD_HEIGHT; row++) {
      var rowColors = this.generateRowColors(neighborColors);
      for (var col = 1; col <= W; col++) this.panels[row][col].color = rowColors[col];
      neighborColors = rowColors;
    }
    var height = [];
    for (var c = 1; c <= W; c++) height[c] = STARTING_BOARD_HEIGHT;
    var toRemove = 2 * W;
    while (toRemove > 0) {
      var idx = 1 + Math.floor(this.rng() * W);
      if (height[idx] > 0) {
        this.panels[height[idx]][idx].color = 0;
        height[idx]--;
        toRemove--;
      }
    }
    this.fillNewRow(0);
  };

  // Row 0 is the dimmed row waiting below the board. Its colors also may not
  // complete a match the moment it becomes row 1.
  Stack.prototype.fillNewRow = function (row) {
    var above1 = this.panels[row + 1];
    var neighborColors = null;
    if (above1) {
      neighborColors = [];
      for (var col = 1; col <= W; col++) neighborColors[col] = above1[col].color;
    }
    var rowColors = this.generateRowColors(neighborColors);
    for (var col = 1; col <= W; col++) {
      var panel = this.panels[row][col];
      clearPanel(panel, true, true);
      panel.color = rowColors[col];
      panel.state = "dimmed";
    }
  };

  // GeneratorSource:clone always constructs the garbage-panel generator at
  // adjacentDenialFrequency 1, regardless of level — so unlike the main
  // board, colors converted from cleared garbage never repeat the color
  // immediately before them, no exceptions. Since frequency>=1 makes the
  // horizontal-adjacency check an unconditional deny, the 3rd-in-a-row rule
  // (which only exists to catch what the 2nd-in-a-row check would otherwise
  // let through) never actually triggers — so this reduces to "never match
  // the previous pick." Converted colors don't correlate with vertical
  // neighbors the way board rows do (garbage panel generation is its own
  // independent stream in the reference), so there's no neighbor-row ban.
  Stack.prototype.garbageRowColors = function (count) {
    var colors = [];
    for (var n = 0; n < count; n++) {
      var color;
      do {
        color = 1 + Math.floor(this.rng() * this.colors);
      } while (n > 0 && color === colors[n - 1]);
      colors.push(color);
    }
    return colors;
  };

  Stack.prototype.panelAt = function (row, col) {
    if (row < 0 || row >= this.panels.length || col < 1 || col > W) return null;
    return this.panels[row][col];
  };

  // Panel:dangerous — a non-garbage panel counts the instant it has a color,
  // no matter its state (falling, swapping, matched...); only GARBAGE panels
  // get a state exemption (falling garbage doesn't count as topped out yet).
  // Applying the falling exemption to every panel, as this port used to,
  // is more forgiving than the reference: a non-garbage panel mid-fall
  // through the top row should already count as toppled.
  Stack.prototype.isToppedOut = function () {
    for (var col = 1; col <= W; col++) {
      var p = this.panels[this.height][col];
      var dangerous = p.isGarbage ? p.state !== "falling" : p.color !== 0;
      if (dangerous) return true;
    }
    return false;
  };

  Stack.prototype.hasActivePanels = function () { return this.nActive > 0 || this.nPrevActive > 0; };

  Stack.prototype.hasFallingGarbage = function () {
    for (var row = Math.min(this.height + 3, this.panels.length - 1); row >= 1; row--) {
      for (var col = 1; col <= W; col++) {
        var p = this.panels[row][col];
        if (p.isGarbage && p.state === "falling") return true;
      }
    }
    return false;
  };

  Stack.prototype.hasChainingPanels = function () {
    for (var row = 1; row < this.panels.length; row++) {
      for (var col = 1; col <= W; col++) {
        var p = this.panels[row][col];
        if (p.chaining && p.color !== 0) return true;
      }
    }
    return false;
  };

  Stack.prototype.countActivePanels = function () {
    var count = 0, swapping = 0;
    // Only the visible board counts, exactly as in the original — garbage
    // still falling in above row 12 is handled by hasFallingGarbage().
    for (var row = 1; row <= this.height; row++) {
      for (var col = 1; col <= W; col++) {
        var p = this.panels[row][col];
        if (p.color === 0) continue;
        if (p.isGarbage) {
          if (p.state !== "normal") count++;
        } else if (p.state !== "normal" && p.state !== "landing") {
          count++;
          if (p.state === "swapping") swapping++;
        }
      }
    }
    this.nPrevActive = this.nActive;
    this.nActive = count;
    this.swappingCount = swapping;
  };

  Stack.prototype.swapQueued = function () { return this.queuedSwapRow > 0; };

  // ---------------- matches ----------------
  // Every matchable panel is scanned each frame (72 cells — the original's
  // stateChanged culling is a speed optimisation we don't need here).
  Stack.prototype.getMatchingPanels = function () {
    var matching = [];
    var row, col, run, i, p;
    function mark(panel) {
      if (!panel.matching) { panel.matching = true; matching.push(panel); }
    }
    for (row = 1; row <= this.height; row++) {
      run = [];
      for (col = 1; col <= W + 1; col++) {
        p = col <= W ? this.panels[row][col] : null;
        if (p && canMatch(p) && (run.length === 0 || run[0].color === p.color)) {
          run.push(p);
        } else {
          if (run.length >= 3) for (i = 0; i < run.length; i++) mark(run[i]);
          run = (p && canMatch(p)) ? [p] : [];
        }
      }
    }
    for (col = 1; col <= W; col++) {
      run = [];
      for (row = 1; row <= this.height + 1; row++) {
        p = row <= this.height ? this.panels[row][col] : null;
        if (p && canMatch(p) && (run.length === 0 || run[0].color === p.color)) {
          run.push(p);
        } else {
          if (run.length >= 3) for (i = 0; i < run.length; i++) mark(run[i]);
          run = (p && canMatch(p)) ? [p] : [];
        }
      }
    }
    // Hovering panels that match can never START a chain (Panel.matchAnyway).
    for (i = 0; i < matching.length; i++) {
      if (matching[i].state === "hovering") matching[i].chaining = false;
    }
    return matching;
  };

  // All garbage panels touched by this match, plus every garbage block those
  // touch in turn (garbage clears propagate block to block).
  //
  // Two guards a garbage panel must pass to be eligible, both ported from
  // getConnectedGarbagePanels2 in the reference — missing either is a real,
  // reachable bug, not a style nit:
  //   - state === "normal": a garbage block keeps color 9 for its ENTIRE
  //     multi-frame clear animation (state "matched", then "falling" for
  //     its own bottom-row conversion) — without this, a second match
  //     touching it mid-animation re-enters matchGarbagePanels, which
  //     unconditionally decrements yOffset/gHeight and resets its timer a
  //     second time, corrupting the block already clearing.
  //   - on-screen OR already matched before (highestGarbageIdMatched):
  //     stops garbage that spawned entirely above the visible board and
  //     was never shown to the player from being insta-matched with 0 pop
  //     time the instant it happens to touch a new match.
  Stack.prototype.getConnectedGarbagePanels = function (matchingPanels) {
    var stack = this;
    var ids = {};
    var found = [];
    var queue = [];
    var deltas = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    function eligible(p) {
      return p.isGarbage && p.color === 9 && p.state === "normal" &&
        (p.row - p.yOffset <= stack.height || p.garbageId <= stack.highestGarbageIdMatched);
    }

    function addNeighbourGarbage(row, col) {
      for (var d = 0; d < deltas.length; d++) {
        var p = stack.panelAt(row + deltas[d][0], col + deltas[d][1]);
        if (p && eligible(p) && !ids[p.garbageId]) {
          ids[p.garbageId] = true;
          queue.push(p.garbageId);
        }
      }
    }

    for (var i = 0; i < matchingPanels.length; i++) {
      addNeighbourGarbage(matchingPanels[i].row, matchingPanels[i].col);
    }

    while (queue.length) {
      var id = queue.shift();
      this.highestGarbageIdMatched = Math.max(this.highestGarbageIdMatched, id);
      var block = [];
      for (var row = 1; row < this.panels.length; row++) {
        for (var col = 1; col <= W; col++) {
          var p = this.panels[row][col];
          if (p.isGarbage && p.garbageId === id && p.color === 9) block.push(p);
        }
      }
      for (var b = 0; b < block.length; b++) {
        found.push(block[b]);
        addNeighbourGarbage(block[b].row, block[b].col);
      }
    }
    return found;
  };

  // Matches pop top to bottom, left to right; garbage pops bottom to top,
  // right to left (sortByPopOrder in checkMatches.lua).
  function sortByPopOrder(list, isGarbage) {
    return list.sort(function (a, b) {
      if (a.row === b.row) return isGarbage ? b.col - a.col : a.col - b.col;
      return isGarbage ? a.row - b.row : b.row - a.row;
    });
  }

  Stack.prototype.checkMatches = function () {
    var matching = this.getMatchingPanels();
    var comboSize = matching.length;
    var i;

    if (comboSize > 0) {
      var f = this.frames;
      var isChainLink = false;
      for (i = 0; i < matching.length; i++) if (matching[i].chaining) isChainLink = true;
      // The match that STARTS a chain isn't a link; the first link makes it an
      // x2 chain (Stack:incrementChainCounter).
      if (isChainLink) this.chainCounter = this.chainCounter === 0 ? 2 : this.chainCounter + 1;

      // a match interrupts a manual raise
      this.manualRaise = false;
      this.riseLock = true;

      sortByPopOrder(matching, false);
      for (i = 0; i < comboSize; i++) {
        var p = matching[i];
        p.state = "matched";
        p.timer = f.FLASH + f.FACE + 1;
        if (isChainLink) p.chaining = true;
        p.fellFromGarbage = 0;
        p.comboIndex = i + 1;
        p.comboSize = comboSize;
      }
      var origin = { row: matching[0].row, col: matching[0].col };

      var garbagePanels = this.getConnectedGarbagePanels(matching);
      var onScreen = 0;
      for (i = 0; i < garbagePanels.length; i++) if (garbagePanels[i].row <= this.height) onScreen++;
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
  };

  Stack.prototype.matchGarbagePanels = function (garbagePanels, garbageMatchTime, isChain, onScreenCount) {
    sortByPopOrder(garbagePanels, true);
    for (var i = 0; i < garbagePanels.length; i++) {
      var p = garbagePanels[i];
      p.yOffset -= 1;
      p.gHeight -= 1;
      p.state = "matched";
      p.timer = garbageMatchTime + 1;
      p.initialTime = garbageMatchTime;
      p.popTime = this.frames.POP * (onScreenCount - (i + 1));
      p.popIndex = Math.min(i + 1, 10);
    }
    this.convertGarbagePanels(isChain);
  };

  // The bottom row of cleared garbage takes on real colors (it turns into
  // panels when its matched timer runs out). Colors are generated a whole
  // converting row at a time (see garbageRowColors) rather than cell by
  // cell, so the adjacency rule actually has neighbors to compare against.
  Stack.prototype.convertGarbagePanels = function (isChain) {
    for (var row = 1; row < this.panels.length; row++) {
      var cols = [];
      for (var col = 1; col <= W; col++) {
        var p = this.panels[row][col];
        if (p.yOffset === -1 && p.color === 9) cols.push(col);
      }
      if (!cols.length) continue;
      var colors = this.garbageRowColors(cols.length);
      for (var i = 0; i < cols.length; i++) {
        var panel = this.panels[row][cols[i]];
        panel.color = colors[i];
        if (isChain) panel.chaining = true;
      }
    }
  };

  // A chaining panel that was eligible to match but didn't loses its flag —
  // otherwise a chain would never end.
  Stack.prototype.clearChainingFlags = function () {
    for (var row = 1; row <= Math.min(this.panels.length - 1, this.height + 2); row++) {
      for (var col = 1; col <= W; col++) {
        var p = this.panels[row][col];
        if (!p.matching && p.chaining && !p.matchAnyway && (canMatch(p) || p.color === 9)) {
          if (row > 1) {
            if (this.panels[row - 1][col].state !== "swapping") p.chaining = false;
          } else {
            p.chaining = false;
          }
        }
      }
    }
  };

  // Stack:addScore — every score gain funnels through here so the 99999 cap
  // (checkMatches.lua's "lol owned") always applies.
  Stack.prototype.addScore = function (score) {
    this.score += score;
    if (this.score > 99999) this.score = 99999;
  };

  // Stack:updateScoreWithChain — always awarded, chaining or not (chainCounter
  // is 0 outside a chain, and SCORE_CHAIN_TA[0] is 0, so a plain match adds
  // nothing here). A chain longer than 13 links resets its bonus to 0 rather
  // than clamping to the table's top entry — a faithfully-ported quirk, not
  // a bug in this port.
  Stack.prototype.updateScoreWithChain = function () {
    var chainBonus = this.chainCounter;
    if (chainBonus > 13) chainBonus = 0;
    this.addScore(SCORE_CHAIN_TA[chainBonus]);
  };

  // Stack:updateScoreWithCombo.
  Stack.prototype.updateScoreWithCombo = function (comboSize) {
    if (comboSize > 3) this.addScore(SCORE_COMBO_TA[Math.min(30, comboSize)]);
  };

  // Stack:updateScoreWithBonus — call after chainCounter has already been
  // incremented for this match.
  Stack.prototype.updateScoreWithBonus = function (comboSize) {
    this.updateScoreWithChain();
    this.updateScoreWithCombo(comboSize);
  };

  // Stack:calculateStopTime, MODERN formula.
  Stack.prototype.awardStopTime = function (isChain, comboSize) {
    var stop = this.levelData.stop;
    var stopTime = 0;
    var toppedOut = this.wasToppedOut;
    if (comboSize > 3 || isChain) {
      if (toppedOut && isChain) {
        var length = this.chainCounter > 4 ? 6 : this.chainCounter;
        stopTime = stop.dangerConstant + (length - 1) * stop.dangerCoefficient;
      } else if (toppedOut) {
        stopTime = stop.coefficient * (comboSize < 9 ? 2 : 3) + stop.chainConstant;
      } else if (isChain) {
        stopTime = stop.coefficient * Math.min(this.chainCounter, 13) + stop.chainConstant;
      } else {
        stopTime = stop.coefficient * comboSize + stop.comboConstant;
      }
    }
    if (stopTime > this.stopTime) this.stopTime = stopTime;
  };

  // ---------------- outgoing garbage ----------------
  Stack.prototype.pushGarbage = function (origin, isChain, comboSize) {
    var pieces = comboGarbage(comboSize);
    for (var i = 0; i < pieces.length; i++) {
      this.outgoing.push({
        width: pieces[i], height: 1, isChain: false,
        frameEarned: this.clock, finalized: true, origin: origin
      });
    }
    if (isChain) {
      if (!this.currentChain) {
        this.currentChain = {
          width: W, height: 1, isChain: true,
          frameEarned: this.clock, finalized: false, origin: origin
        };
        this.outgoing.push(this.currentChain);
      } else {
        this.currentChain.height += 1;
        this.currentChain.frameEarned = this.clock;
      }
    }
  };

  Stack.prototype.finalizeCurrentChain = function () {
    if (this.currentChain) {
      this.currentChain.finalized = true;
      this.currentChain.frameEarned = this.clock;
      this.events.push({ type: "chainEnd", length: this.chainCounter });
      this.currentChain = null;
    }
  };

  // Garbage stays "in flight" for transit + telegraph + land delay before the
  // opponent can receive it; the queue is strictly ordered, so a chain still
  // building holds up everything queued behind it.
  Stack.prototype.takeDeliverableGarbage = function () {
    var out = [];
    while (this.outgoing.length) {
      var g = this.outgoing[0];
      if (!g.finalized) break;
      if (g.frameEarned + GARBAGE_FLIGHT > this.clock) break;
      out.push(this.outgoing.shift());
    }
    return out;
  };

  Stack.prototype.receiveGarbage = function (garbage) {
    for (var i = 0; i < garbage.length; i++) {
      this.incoming.push({ width: garbage[i].width, height: garbage[i].height, isChain: garbage[i].isChain });
    }
  };

  // ---------------- incoming garbage ----------------
  Stack.prototype.shouldDropGarbage = function () {
    var garbage = this.incoming[0];
    if (!garbage) return false;
    if (this.isToppedOut()) return false;       // no room
    if (this.hasFallingGarbage()) return false; // garbage drops one at a time
    for (var row = this.height + 1; row < this.panels.length; row++) {
      for (var col = 1; col <= W; col++) {
        if (this.panels[row][col].color !== 0) return false;
      }
    }
    if (!this.hasActivePanels()) return true;
    // Tall chain garbage lands even mid-action; combo garbage waits for calm.
    return garbage.height > 1;
  };

  // Stack:new — garbageSizeDropColumnMaps. Fixed for board width 6: each
  // garbage width has its own repeating sequence of spawn columns (not
  // every possible left-edge position), so e.g. width-2 garbage always
  // lands at column 1, 3 or 5, cycling in that order, never 2 or 4.
  var GARBAGE_DROP_COLUMN_MAPS = {
    1: [1, 2, 3, 4, 5, 6],
    2: [1, 3, 5],
    3: [1, 4],
    4: [1, 2, 3],
    5: [1, 2],
    6: [1]
  };

  Stack.prototype.garbageSpawnColumn = function (width) {
    var columns = GARBAGE_DROP_COLUMN_MAPS[width] || [1];
    var index = this.dropColumnIndex[width] || 0;
    this.dropColumnIndex[width] = (index + 1) % columns.length;
    return columns[index];
  };

  Stack.prototype.dropGarbage = function (width, height) {
    var originRow = this.height + 1;
    var originCol = this.garbageSpawnColumn(width);
    var id = ++this.garbageCreatedCount;
    var shake = shakeFramesFor(width, height);
    for (var row = originRow; row < originRow + height; row++) {
      // Grow the row array instead of truncating — a tall enough chain
      // garbage could need more headroom than has been allocated yet
      // (rows only grow via newRow(), +1 per rise event), and silently
      // dropping the remaining rows here means part of the attack just
      // never gets created, with no error.
      while (row >= this.panels.length) this.panels.push(this.makeEmptyRow(this.panels.length));
      for (var col = originCol; col < originCol + width; col++) {
        var p = this.panels[row][col];
        clearPanel(p, true, true);
        p.garbageId = id;
        p.isGarbage = true;
        p.color = 9;
        p.gWidth = width;
        p.gHeight = height;
        p.yOffset = row - originRow;
        p.xOffset = col - originCol;
        p.shakeTime = shake;
        p.state = "falling";
      }
    }
    this.events.push({ type: "garbageDrop", width: width, height: height, col: originCol });
  };

  // ---------------- rising ----------------
  Stack.prototype.newRow = function () {
    // Everything shifts up one row; a fresh dimmed row appears at row 0.
    var top = this.panels[this.panels.length - 1];
    var topOccupied = false;
    for (var col = 1; col <= W; col++) if (top[col].color !== 0) topOccupied = true;
    if (topOccupied) {
      this.panels.push(this.makeEmptyRow(this.panels.length));
    } else {
      this.panels.pop();
    }
    var fresh = this.makeEmptyRow(0);
    this.panels.unshift(fresh);
    for (var row = 0; row < this.panels.length; row++) {
      for (var c = 1; c <= W; c++) this.panels[row][c].row = row;
    }
    // the row that just entered play is no longer dimmed
    for (var col2 = 1; col2 <= W; col2++) {
      this.panels[1][col2].state = "normal";
      this.panels[1][col2].stateChanged = true;
    }
    this.fillNewRow(0);

    if (this.curRow !== 0) this.curRow = Math.min(this.curRow + 1, this.topCurRow);
    if (this.queuedSwapRow > 0) this.queuedSwapRow++;
    this.displacement = 16;
    this.events.push({ type: "newRow" });
  };

  Stack.prototype.advancePassiveRaise = function () {
    if (this.manualRaise) {
      if (this.displacement === 0 && this.hasRisen) {
        this.topCurRow = this.height;
        this.newRow();
      }
      return false;
    }
    if (!this.riseLock && this.stopTime === 0) {
      if (this.isToppedOut()) {
        this.health--;
      } else {
        this.riseTimer--;
        if (this.riseTimer <= 0) {
          this.displacement--;
          if (this.displacement === 0) {
            this.preventManualRaise = false;
            this.topCurRow = this.height;
            this.newRow();
          }
          this.riseTimer += riseTime(this.speed);
        }
      }
      return true;
    }
    return false;
  };

  Stack.prototype.handleManualRaise = function () {
    if (!this.manualRaise) return;
    if (!this.riseLock) {
      this.stopTime = 0;
      if (this.wasToppedOut) {
        if (this.checkGameOver()) this.setGameOver();
      } else {
        this.hasRisen = true;
        this.displacement--;
        if (this.displacement === 1) {
          // the last pixel is handed to passive raise on the next frame
          if (!this.preventManualRaise) this.addScore(1);
          this.manualRaise = false;
          this.riseTimer = 1;
          this.preventManualRaise = true;
        }
        this.manualRaiseYet = true;
      }
    } else if (!this.manualRaiseYet) {
      this.manualRaise = false;
    } else if (this.hasFallingGarbage()) {
      this.manualRaise = false;
    }
  };

  Stack.prototype.updateRiseLock = function () {
    var previous = this.riseLock;
    if (this.swapQueued() || this.shakeTime > 0 || this.hasActivePanels()) this.riseLock = true;
    else this.riseLock = false;
    if (previous && !this.riseLock) this.preventManualRaise = false;
  };

  Stack.prototype.updateSpeed = function () {
    if (this.clock === this.nextSpeedIncreaseClock) {
      this.speed = Math.min(this.speed + 1, 99);
      this.nextSpeedIncreaseClock += DT_SPEED_INCREASE;
    }
  };

  Stack.prototype.decrementTimers = function () {
    this.shakeTime = Math.max(this.shakeTime - 1, this.shakeTimeOnFrame, 0);
    if (this.shakeTime === 0) this.peakShakeTime = 0;
    if (this.preStopTime !== 0) this.preStopTime--;
    else if (this.stopTime !== 0) this.stopTime--;
  };

  // ---------------- swapping ----------------
  Stack.prototype.canSwap = function (row, col) {
    if (this.clock <= 1) return false;
    if (row < 1 || row > this.height || col < 1 || col >= W) return false;
    var left = this.panels[row][col];
    var right = this.panels[row][col + 1];
    if (left.color === 0 && right.color === 0) return false;
    if (!allowsSwap(left) || !allowsSwap(right)) return false;

    var above1 = null, above2 = null;
    if (row < this.height) {
      above1 = this.panels[row + 1][col];
      above2 = this.panels[row + 1][col + 1];
      // can't pull a panel out from under a hovering one
      if (above1.state === "hovering" || above2.state === "hovering") return false;
    }
    if (left.color === 0 || right.color === 0) {
      if (above1 && above2 && above1.state === "swapping" && above2.state === "swapping" &&
        (above1.color === 0 || above2.color === 0) && (above1.color !== 0 || above2.color !== 0)) {
        return false;
      }
      if (row > 1) {
        var below1 = this.panels[row - 1][col];
        var below2 = this.panels[row - 1][col + 1];
        if (below1.state === "swapping" && below2.state === "swapping" &&
          (below1.color === 0 || below2.color === 0) && (below1.color !== 0 || below2.color !== 0)) {
          return false;
        }
      }
    }
    return true;
  };

  // ---- swap stalling (common/engine/WigglePay.lua in the reference engine)
  // ----
  // Topped out, a player who keeps swapping the SAME two cells back and
  // forth ("wiggling") can stall death indefinitely for free: each swap
  // sets that cell's panel to "swapping" for a few frames, which keeps
  // hasActivePanels() true, which keeps riseLock true, which is exactly
  // the condition advancePassiveRaise's health drain is gated behind —
  // reported live as "you don't die when topped out". The reference
  // engine's default behaviour (StackBehaviours.getV049Default:
  // swapStallingMode 1, swapStallingPunish 4) exists specifically to close
  // this: the first escape swap at a cell pair is free, but reversing that
  // exact swap again (which is what a wiggle is) costs health, or is
  // refused outright if there isn't enough left to pay for it. Simplified
  // from the original's per-panel-id backlog to a plain (row, col) key —
  // this port has no panel ids and no rollback netcode to be careful of,
  // just the reported exploit: staying alive forever by wiggling.
  var SWAP_STALLING_PUNISH = 4;

  Stack.prototype.wigglePayActive = function () {
    return this.wasToppedOut && this.stopTime === 0 && this.shakeTime === 0 &&
      (this.nActive - this.swappingCount) === 0;
  };

  // Charges health for a repeated stalling swap, or refuses it outright
  // when there isn't enough health to pay for it. Returns false only in
  // the refusal case — tryQueueSwap must not queue the swap then.
  Stack.prototype.applySwapStalling = function (row, col) {
    if (!this.wigglePayActive()) {
      this.swapStallBacklog.length = 0; // any non-stalling swap resets the log
      return true;
    }
    for (var i = 0; i < this.swapStallBacklog.length; i++) {
      var rec = this.swapStallBacklog[i];
      if (rec.row === row && rec.col === col) {
        if (this.health <= SWAP_STALLING_PUNISH) return false;
        this.health -= SWAP_STALLING_PUNISH;
        return true;
      }
    }
    this.swapStallBacklog.push({ row: row, col: col });
    return true;
  };

  Stack.prototype.tryQueueSwap = function (row, col) {
    if (this.gameOver) return false;
    if (!this.canSwap(row, col)) return false;
    if (!this.applySwapStalling(row, col)) return false;
    this.queuedSwapRow = row;
    this.queuedSwapCol = col;
    return true;
  };

  Stack.prototype.doSwap = function (row, col) {
    var panels = this.panels;
    var left = panels[row][col];
    var right = panels[row][col + 1];
    startSwap(left, true);
    startSwap(right, false);
    switchPanels(this, left, right);
    var tmp = left; left = right; right = tmp; // they traded places

    // A panel swapped over a hole (or a falling panel) can't be swapped back —
    // it is about to fall.
    if (row !== 1) {
      if (left.color !== 0 && (panels[row - 1][col].color === 0 || panels[row - 1][col].state === "falling")) left.dontSwap = true;
      if (right.color !== 0 && (panels[row - 1][col + 1].color === 0 || panels[row - 1][col + 1].state === "falling")) right.dontSwap = true;
    }
    if (row !== this.height) {
      if (left.color === 0 && panels[row + 1][col].color !== 0) left.dontSwap = true;
      if (right.color === 0 && panels[row + 1][col + 1].color !== 0) right.dontSwap = true;
    }
    this.events.push({ type: "swap", row: row, col: col });
  };

  function startSwap(p, fromLeft) {
    var chaining = p.chaining;
    clearFlags(p, false);
    p.stateChanged = true;
    p.state = "swapping";
    p.chaining = chaining;
    p.timer = 4;
    p.swapFromLeft = fromLeft;
    p.fellFromGarbage = 0;
  }

  // ---------------- input ----------------
  var DAS_DELAY = 20; // frames a direction must be held before it repeats

  Stack.prototype.setInput = function (input) {
    this.input = {
      left: !!input.left, right: !!input.right, up: !!input.up, down: !!input.down,
      swap: !!input.swap, raise: !!input.raise
    };
  };

  Stack.prototype.applyInput = function () {
    var i = this.input, prev = this.prevInput;

    if (i.swap && !prev.swap) this.tryQueueSwap(this.curRow, this.curCol);

    var dir = null;
    if (i.up) dir = "up";
    else if (i.down) dir = "down";
    else if (i.left) dir = "left";
    else if (i.right) dir = "right";

    if (dir !== this.cursorDirection) {
      this.cursorDirection = dir;
      this.cursorTimer = 0;
      if (dir) this.moveCursor(dir);
    } else if (dir) {
      this.cursorTimer++;
      if (this.cursorTimer >= DAS_DELAY) this.moveCursor(dir);
    }

    if (i.raise && !this.preventManualRaise) {
      this.manualRaise = true;
      this.manualRaiseYet = false;
    }
  };

  Stack.prototype.moveCursor = function (dir) {
    if (dir === "up") this.curRow++;
    else if (dir === "down") this.curRow--;
    else if (dir === "left") this.curCol--;
    else if (dir === "right") this.curCol++;
    this.clampCursor();
  };

  Stack.prototype.clampCursor = function () {
    this.curRow = Math.max(1, Math.min(this.curRow, this.topCurRow));
    this.curCol = Math.max(1, Math.min(this.curCol, W - 1));
  };

  // Touch/pointer input: put the cursor on a pair and swap it in one go.
  Stack.prototype.touchSwap = function (row, col) {
    if (!this.tryQueueSwap(row, col)) return false;
    this.curRow = row;
    this.curCol = col;
    this.clampCursor();
    return true;
  };

  // ---------------- the frame ----------------
  Stack.prototype.updatePanels = function () {
    this.shakeTimeOnFrame = 0;
    for (var row = 1; row < this.panels.length; row++) {
      for (var col = 1; col <= W; col++) {
        updatePanel(this, this.panels[row][col]);
      }
    }
  };

  // The reference engine (Stack:checkGameOver) has TWO death conditions, not
  // one — this port only ever had the first. Health hitting 0 while settled
  // (shakeTime<=0) is the drain-while-topped-out path, gated behind
  // advancePassiveRaise. But advancePassiveRaise returns early — skipping
  // that entire health-drain block — whenever manualRaise is held (see its
  // own comment), which makes it the WRONG place to also catch "you raised
  // yourself into a topped-out board": while actively raising, health never
  // moves, so a health check alone can never trigger. The reference's
  // second condition is exactly that missing case: holding manual raise
  // into an already-topped-out board (riseLock clear, so it isn't merely
  // resolving an in-flight match) is instant death regardless of health —
  // confirmed live: holding raise at the top of a full board never killed
  // the player no matter how long it was held, because nothing was
  // checking for it at all.
  Stack.prototype.checkGameOver = function () {
    if (this.health <= 0 && this.shakeTime <= 0) return true;
    if (!this.riseLock && this.wasToppedOut && this.manualRaise) return true;
    return false;
  };

  Stack.prototype.setGameOver = function () {
    if (this.gameOver) return;
    this.gameOver = true;
    this.events.push({ type: "gameOver" });
  };

  Stack.prototype.runPhysics = function () {
    this.garbageLandedThisFrame.length = 0;
    this.wasToppedOut = this.isToppedOut();

    this.decrementTimers();
    this.updateRiseLock();
    this.updateSpeed();

    if (this.advancePassiveRaise()) {
      if (this.checkGameOver()) this.setGameOver();
    }

    if (!this.wasToppedOut && !this.hasFallingGarbage()) this.health = this.maxHealth;
    if (this.displacement % 16 !== 0) this.topCurRow = this.height - 1;

    if (this.swapQueued()) {
      this.doSwap(this.queuedSwapRow, this.queuedSwapCol);
      this.queuedSwapRow = 0;
      this.queuedSwapCol = 0;
    }

    this.checkMatches();
    this.updatePanels();
    this.countActivePanels();

    if (this.chainCounter !== 0 && !this.hasChainingPanels()) {
      this.chainCounter = 0;
      this.finalizeCurrentChain();
    }

    if (this.checkGameOver()) this.setGameOver();
  };

  // One frame. Call at a fixed 60 Hz.
  Stack.prototype.run = function () {
    if (this.gameOver) return;
    this.runPhysics();
    this.applyInput();
    this.handleManualRaise();
    if (this.shouldDropGarbage()) {
      var garbage = this.incoming.shift();
      this.dropGarbage(garbage.width, garbage.height);
    }
    this.clampCursor();
    this.prevInput = this.input;
    this.clock++;
  };

  Stack.prototype.drainEvents = function () {
    var events = this.events;
    this.events = [];
    return events;
  };

  // How full the board is, 0..1 — the renderer paints the danger state from
  // this and the CPU uses it to decide whether to panic.
  Stack.prototype.fillRatio = function () {
    var highest = 0;
    for (var row = this.height; row >= 1; row--) {
      for (var col = 1; col <= W; col++) {
        if (this.panels[row][col].color !== 0) { highest = row; break; }
      }
      if (highest) break;
    }
    return highest / this.height;
  };

  root.PanelEngine = {
    Stack: Stack,
    LEVELS: LEVELS,
    WIDTH: W,
    HEIGHT: HEIGHT,
    GARBAGE_FLIGHT: GARBAGE_FLIGHT,
    comboGarbage: comboGarbage,
    riseTime: riseTime,
    makeRng: makeRng
  };
})(typeof window !== "undefined" ? window : globalThis);
