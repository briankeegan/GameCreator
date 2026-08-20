// Puzzle Attack — the duel screen.
//
// Owns everything the engine deliberately doesn't: the canvas, the input, the
// two-stack match loop and the presentation (attack animations, chain cards,
// countdown, result). panel-engine.js is the rules; this is the game.
//
// The match loop is a fixed 60 Hz accumulator — the engine counts in frames,
// exactly like the Lua original, so it must never be stepped by delta time.
window.NewseyDuel = (function () {
  "use strict";

  var E = window.PanelEngine;
  var FRAME = 1000 / 60;
  var COUNTDOWN_FRAMES = 180; // 3 seconds, same as the original

  // Panel colors. Each one also carries a shape, so panels stay tellable apart
  // when they flash, when the board goes red, and for anyone who reads shape
  // faster than hue.
  var PALETTES = {
    pink: {
      frame: "#ff8ac4", frameDark: "#6d2049", bg: "#2a1030", grid: "rgba(255,255,255,0.05)",
      colors: [null, "#ff5470", "#3ec9c0", "#ffd166", "#a06bff", "#4ea8ff", "#8ee34d"]
    },
    red: {
      frame: "#ff4d4d", frameDark: "#5a0d0d", bg: "#2a0a0c", grid: "rgba(255,255,255,0.05)",
      colors: [null, "#ff3b3b", "#ff8c42", "#ffe066", "#c04dff", "#4ea8ff", "#7bd648"]
    }
  };
  var SHAPES = [null, "circle", "triangle", "diamond", "star", "square", "cross"];

  var els = null;
  var state = null;
  var rafId = null;

  function el(id) { return document.getElementById(id); }

  function grabElements() {
    if (els) return els;
    els = {
      screen: el("duelScreen"),
      canvas: el("duelCanvas"),
      raise: el("duelRaise"),
      swap: el("duelSwap"),
      controls: document.querySelector(".duel-controls"),
      dpad: document.querySelectorAll(".duel-dpad button"),
      result: el("duelResult"),
      resultTitle: el("duelResultTitle"),
      resultText: el("duelResultText"),
      resultBtn: el("duelResultBtn"),
      hint: el("duelHint")
    };
    els.ctx = els.canvas.getContext("2d");
    SETTINGS.onChange(function () { applyControlsSetting(); applyButtonMapping(); });
    return els;
  }

  // =========================================================================
  // START / STOP
  // =========================================================================
  // opts: { opponent: {id,name,portrait,level,difficulty,theme,taunt,winLine,loseLine},
  //         playerName, playerLevel, onEnd(result) }
  function start(opts) {
    grabElements();
    var opponent = opts.opponent || {};
    var seed = (Date.now() % 100000) + 1;

    var player = new E.Stack({
      level: opts.playerLevel || 2,
      seed: seed,
      name: opts.playerName || "Nella"
    });
    var foe = new E.Stack({
      level: opponent.level || 3,
      seed: seed + 101,
      name: opponent.name || "Opponent"
    });

    state = {
      player: player,
      foe: foe,
      cpu: new window.PanelCpu.Cpu(foe, { difficulty: opponent.difficulty || "steady", seed: seed + 55 }),
      opponent: opponent,
      palette: PALETTES[opponent.theme === "red" ? "red" : "pink"],
      countdown: COUNTDOWN_FRAMES,
      over: null,
      overDelay: 0,
      acc: 0,
      last: null,
      keys: {},
      buttons: { left: false, right: false, up: false, down: false, swap: false, raise: false },
      // A tap can start and end inside a single 60 Hz frame, which would make
      // the press invisible to the engine. Anything pressed is latched here
      // until at least one frame has read it.
      latched: {},
      keyLatch: {},
      pointer: null,
      selection: null, // tap-to-select: the panel waiting for a partner
      effects: [],
      cards: [],
      swapCount: 0,
      onEnd: opts.onEnd || function () {},
      layout: null
    };

    els.screen.hidden = false;
    els.result.hidden = true;
    els.hint.textContent = "tap between two panels to swap them, or drag one sideways"
      + (isTouch() ? "" : " · keyboard and controller work too");
    applyControlsSetting();
    applyButtonMapping();
    bindInput();
    resize();
    state.last = null;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    unbindInput();
    if (els) els.screen.hidden = true;
    state = null;
  }

  var SETTINGS = window.NewseySettings;
  function isTouch() { return SETTINGS.isTouchDevice(); }

  // The on-screen pad is the player's choice (settings.js), on both screens.
  function applyControlsSetting() {
    if (!els) return;
    els.controls.hidden = !SETTINGS.showOnScreenControls();
    els.controls.classList.toggle("pad-right", SETTINGS.padSide() === "right");
  }

  // Button faces say what they actually do, so the mapping is visible.
  function applyButtonMapping() {
    if (!els) return;
    els.swap.textContent = SETTINGS.buttonLabel("primary").toUpperCase();
    els.raise.textContent = SETTINGS.buttonLabel("secondary").toUpperCase();
  }

  // =========================================================================
  // INPUT
  // =========================================================================
  var handlers = {};

  function bindInput() {
    handlers.keydown = function (e) {
      if (!state || SETTINGS.isCapturing()) return; // a rebind owns the keys
      if (window.NewseyMenu && window.NewseyMenu.current()) return; // menu is up
      state.keys[e.key] = true;
      state.keyLatch[e.key] = true; // a very short tap must survive one frame
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.key) !== -1) e.preventDefault();
    };
    handlers.keyup = function (e) { if (state) state.keys[e.key] = false; };
    window.addEventListener("keydown", handlers.keydown);
    window.addEventListener("keyup", handlers.keyup);

    var canvas = els.canvas;
    handlers.down = function (e) { pointerDown(e); };
    handlers.move = function (e) { pointerMove(e); };
    handlers.up = function (e) { pointerUp(e); };
    canvas.addEventListener("pointerdown", handlers.down);
    canvas.addEventListener("pointermove", handlers.move);
    window.addEventListener("pointerup", handlers.up);
    handlers.cancel = function () { if (state) state.pointer = null; };
    window.addEventListener("pointercancel", handlers.cancel);

    handlers.resize = function () { resize(); };
    window.addEventListener("resize", handlers.resize);

    els.resultBtn.onclick = function () { finish(); };
    // Every on-screen control is a HOLD, not a click: directions repeat through
    // the engine's own key-repeat, raise keeps raising while held, and swap is
    // edge-detected engine-side so holding it doesn't spam swaps.
    // These two buttons do whatever they are mapped to (settings.js) — on a
    // phone they ARE the controls, so the mapping has to reach them.
    holdButton(els.swap, function () { return SETTINGS.buttonAction("primary"); });
    holdButton(els.raise, function () { return SETTINGS.buttonAction("secondary"); });
    for (var i = 0; i < els.dpad.length; i++) holdButton(els.dpad[i], els.dpad[i].dataset.dir);
  }

  // Binds one on-screen button to one input flag for as long as it is held.
  // `flag` may be a function, for buttons whose action the player can change.
  function holdButton(button, flag) {
    var resolve = typeof flag === "function" ? flag : function () { return flag; };
    var held = null;
    var set = function (e) {
      e.preventDefault();
      held = resolve();
      if (state) { state.buttons[held] = true; state.latched[held] = true; }
      if (button.setPointerCapture && e.pointerId !== undefined) {
        try { button.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
      }
    };
    var clear = function () { if (state && held) state.buttons[held] = false; };
    button.onpointerdown = set;
    button.onpointerup = clear;
    button.onpointercancel = clear;
    button.onpointerleave = clear;
  }

  function unbindInput() {
    window.removeEventListener("keydown", handlers.keydown);
    window.removeEventListener("keyup", handlers.keyup);
    window.removeEventListener("pointerup", handlers.up);
    window.removeEventListener("pointercancel", handlers.cancel);
    window.removeEventListener("resize", handlers.resize);
    if (els) {
      els.canvas.removeEventListener("pointerdown", handlers.down);
      els.canvas.removeEventListener("pointermove", handlers.move);
    }
  }

  // Pointer -> board cell. Returns null when the pointer isn't over the
  // player's board. The board slides upward as the stack rises, so the rise
  // offset has to come out of the y before the row is worked out — without it
  // taps near a row boundary land on the wrong panel.
  function cellAt(e) {
    var layout = state && state.layout;
    if (!layout) return null;
    var rect = els.canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    var b = layout.player;
    var rise = ((16 - state.player.displacement) / 16) * layout.cell;
    var col = Math.floor((x - b.x) / layout.cell) + 1;
    var row = Math.floor((b.y + layout.boardH - y - rise) / layout.cell) + 1;
    if (col < 1 || col > E.WIDTH || row < 1 || row > E.HEIGHT) return null;
    // fx is where the tap landed ACROSS the cell, 0 at its left edge and 1 at
    // its right — what tells a tap on a panel apart from a tap on the seam
    // between two of them.
    var fx = ((x - b.x) / layout.cell) % 1;
    if (fx < 0) fx += 1;
    return { row: row, col: col, fx: fx };
  }

  function pointerDown(e) {
    if (!state || state.over || state.countdown > 0) return;
    var cell = cellAt(e);
    if (!cell) { state.selection = null; return; }
    state.pointer = { row: cell.row, col: cell.col, dragged: false };
    state.player.curRow = cell.row;
    state.player.curCol = Math.min(cell.col, E.WIDTH - 1);
    state.player.clampCursor();
  }

  // Dragging sideways drags the panel with you, one swap per column crossed —
  // the same feel as the original's touch mode.
  function pointerMove(e) {
    if (!state || !state.pointer || state.over) return;
    var cell = cellAt(e);
    if (!cell || cell.row !== state.pointer.row) return;
    while (cell.col > state.pointer.col) {
      if (!state.player.touchSwap(state.pointer.row, state.pointer.col)) break;
      state.pointer.col++;
      state.pointer.dragged = true;
      state.selection = null;
    }
    while (cell.col < state.pointer.col) {
      if (!state.player.touchSwap(state.pointer.row, state.pointer.col - 1)) break;
      state.pointer.col--;
      state.pointer.dragged = true;
      state.selection = null;
    }
  }

  // A tap that never became a drag picks a panel; tapping the panel beside it
  // swaps the two. Dragging is faster once you know it exists, but nobody
  // discovers it on their own — tapping is what people try first.
  function pointerUp(e) {
    if (!state) return;
    var pointer = state.pointer;
    state.pointer = null;
    if (!pointer || pointer.dragged || state.over || state.countdown > 0) return;
    var cell = cellAt(e);
    if (!cell) { state.selection = null; return; }

    // Tapping the SEAM between two panels swaps that pair outright — no
    // selecting one and then the other. It's the gesture the board invites:
    // the thing you want to move is the boundary, not either panel. Works
    // against an empty cell too; the engine already allows swapping a panel
    // into a hole, and refuses the swap if it isn't legal.
    var seam = seamAt(cell);
    if (seam !== null) {
      state.player.touchSwap(cell.row, seam);
      state.selection = null;
      return;
    }

    var selection = state.selection;
    if (selection && selection.row === cell.row && Math.abs(selection.col - cell.col) === 1) {
      state.player.touchSwap(cell.row, Math.min(selection.col, cell.col));
      state.selection = null;
    } else if (selection && selection.row === cell.row && selection.col === cell.col) {
      state.selection = null; // tapping the same panel again lets it go
    } else {
      state.selection = { row: cell.row, col: cell.col };
    }
  }

  // How close to a cell edge counts as tapping the seam rather than the
  // panel. Narrow enough that a tap aimed at a panel still selects it.
  var SEAM_BAND = 0.22;
  // Returns the LEFT column of the pair a seam-tap is asking to swap, or null
  // if the tap was on a panel rather than a seam. The board's outer edges are
  // not seams — there is nothing on the far side to swap with.
  function seamAt(cell) {
    if (cell.fx === undefined) return null;
    if (cell.fx < SEAM_BAND && cell.col > 1) return cell.col - 1;
    if (cell.fx > 1 - SEAM_BAND && cell.col < E.WIDTH) return cell.col;
    return null;
  }

  // Keyboard, on-screen buttons and gamepad all feed the same input — any one
  // of them can drive the whole game. Which key does what comes from
  // settings.js, so a rebind applies here too.
  function readKeyboard() {
    var b = state.buttons, latched = state.latched, keyLatch = state.keyLatch;
    var keys = state.keys;
    var k = {};
    for (var name in keys) if (keys[name]) k[name] = true;
    for (var pressed in keyLatch) k[pressed] = true;
    function held(flag) { return b[flag] || latched[flag]; }
    state.latched = {};   // every latched press survives exactly one frame
    state.keyLatch = {};
    var pad = SETTINGS.gamepad();
    function on(action) {
      return !!(SETTINGS.isDown(action, k) || held(action) || (pad && pad[action]));
    }
    return {
      left: on("left"),
      right: on("right"),
      up: on("up"),
      down: on("down"),
      swap: on("swap") || !!(pad && pad.interact),
      raise: on("raise")
    };
  }

  function finish() {
    if (!state) return;
    var onEnd = state.onEnd;
    var result = state.over || "quit";
    stop();
    onEnd({ result: result });
  }

  // =========================================================================
  // MATCH LOOP
  // =========================================================================
  function loop(t) {
    if (!state) return;
    rafId = requestAnimationFrame(loop);
    if (state.last === null) state.last = t;
    var elapsed = Math.min(200, t - state.last); // never simulate more than ~12 frames of catch-up
    state.last = t;
    state.acc += elapsed;
    while (state.acc >= FRAME) {
      state.acc -= FRAME;
      step();
    }
    render();
  }

  function step() {
    var s = state;
    // Paused while any menu screen is up: nothing rises while the player is
    // reading a menu.
    if (window.NewseyMenu && window.NewseyMenu.current()) return;
    if (s.countdown > 0) { s.countdown--; return; }
    if (s.over) {
      if (s.overDelay > 0 && --s.overDelay === 0) showResult();
      stepEffects();
      return;
    }

    // state.autopilot is only ever set by the debug hook below (headless
    // smoke tests need to be able to actually play a duel out).
    if (s.autopilot) s.autopilot.update(); else s.player.setInput(readKeyboard());
    s.cpu.update();
    s.player.run();
    s.foe.run();

    var sent = s.player.takeDeliverableGarbage();
    if (sent.length) s.foe.receiveGarbage(sent);
    var received = s.foe.takeDeliverableGarbage();
    if (received.length) s.player.receiveGarbage(received);

    collectEvents(s.player, true);
    collectEvents(s.foe, false);
    stepEffects();

    if (s.player.gameOver || s.foe.gameOver) {
      // If both die on the same frame the player gets the benefit of the doubt.
      s.over = s.foe.gameOver ? "win" : "lose";
      s.overDelay = 90;
    }
  }

  function collectEvents(stack, isPlayer) {
    var events = stack.drainEvents();
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.type === "match") {
        if (ev.chain && ev.chainCounter > 1) addCard(isPlayer, ev.row, ev.col, "x" + ev.chainCounter, "#ffd166");
        else if (ev.size > 3) addCard(isPlayer, ev.row, ev.col, ev.size + " combo", "#7ee6ff");
      } else if (ev.type === "pop") {
        addSparks(isPlayer, ev.row, ev.col, ev.garbage ? "#c9a7ff" : null);
      } else if (ev.type === "swap" && isPlayer) {
        state.swapCount++;
      } else if (ev.type === "newRow" && isPlayer) {
        // The whole board just moved up a row; anything the player has their
        // finger on moved with it.
        if (state.selection) state.selection.row++;
        if (state.pointer) state.pointer.row++;
        if (state.selection && state.selection.row > E.HEIGHT) state.selection = null;
      }
    }
  }

  function addCard(isPlayer, row, col, text, color) {
    state.cards.push({ isPlayer: isPlayer, row: row, col: col, text: text, color: color, life: 70, age: 0 });
  }

  function addSparks(isPlayer, row, col, color) {
    for (var i = 0; i < 6; i++) {
      state.effects.push({
        isPlayer: isPlayer, row: row, col: col, age: 0, life: 20 + Math.random() * 12,
        vx: (Math.random() - 0.5) * 2.4, vy: -Math.random() * 2.2 - 0.6, color: color
      });
    }
  }

  function stepEffects() {
    var i;
    for (i = state.effects.length - 1; i >= 0; i--) {
      var fx = state.effects[i];
      fx.age++;
      fx.vy += 0.12;
      if (fx.age > fx.life) state.effects.splice(i, 1);
    }
    for (i = state.cards.length - 1; i >= 0; i--) {
      state.cards[i].age++;
      if (state.cards[i].age > state.cards[i].life) state.cards.splice(i, 1);
    }
  }

  function showResult() {
    var opponent = state.opponent || {};
    var won = state.over === "win";
    els.resultTitle.textContent = won ? "YOU WIN" : "SMASHED FLAT";
    els.resultTitle.style.color = won ? "#ffd166" : "#ff6b6b";
    // winLine / loseLine are written from the PLAYER's side: winLine is what
    // you read when you win, loseLine when you don't.
    els.resultText.textContent = won
      ? (opponent.winLine || ((opponent.name || "They") + " bows out. The slabs land on their side of the glass."))
      : (opponent.loseLine || ((opponent.name || "They") + " stacks it up faster than you can clear. Not this time."));
    els.result.hidden = false;
  }

  // =========================================================================
  // LAYOUT + RENDER
  // =========================================================================
  function resize() {
    if (!state) return;
    var canvas = els.canvas;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = canvas.clientWidth || 640;
    var h = canvas.clientHeight || 400;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    els.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout(w, h);
  }

  // Two boards side by side, sized to whatever box the stage gives us — the
  // stage is 8:5 on desktop and much taller on a phone, so nothing here can be
  // a fixed pixel size.
  function layout(w, h) {
    var topBar = 26, bottomBar = 20, gap = Math.max(14, Math.round(w * 0.05));
    var cellW = Math.floor((w - gap - 16) / (E.WIDTH * 2));
    var cellH = Math.floor((h - topBar - bottomBar) / E.HEIGHT);
    var cell = Math.max(8, Math.min(cellW, cellH));
    var boardW = cell * E.WIDTH, boardH = cell * E.HEIGHT;
    var totalW = boardW * 2 + gap;
    var x0 = Math.round((w - totalW) / 2);
    var y0 = Math.round(topBar + (h - topBar - bottomBar - boardH) / 2);
    state.layout = {
      cell: cell, boardW: boardW, boardH: boardH, gap: gap, w: w, h: h,
      player: { x: x0, y: y0 },
      foe: { x: x0 + boardW + gap, y: y0 }
    };
  }

  function render() {
    var s = state;
    if (!s || !s.layout) return;
    var ctx = els.ctx, L = s.layout, pal = s.palette;

    ctx.clearRect(0, 0, L.w, L.h);
    // backdrop
    var bg = ctx.createLinearGradient(0, 0, 0, L.h);
    bg.addColorStop(0, pal.bg);
    bg.addColorStop(1, "#0b0410");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, L.w, L.h);

    drawBoard(s.player, L.player, true);
    drawBoard(s.foe, L.foe, false);
    drawAttacks();
    drawCards();
    drawHud();
    if (s.countdown > 0) drawCountdown();
  }

  function boardShake(stack) {
    if (stack.shakeTime <= 0) return 0;
    return Math.sin(stack.shakeTime * 1.6) * Math.min(4, stack.shakeTime / 6);
  }

  function drawBoard(stack, pos, isPlayer) {
    var ctx = els.ctx, L = state.layout, pal = state.palette, cell = L.cell;
    var shake = boardShake(stack);
    var x = pos.x, y = pos.y + shake;

    ctx.save();
    // frame
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, x - 4, y - 4, L.boardW + 8, L.boardH + 8, 6);
    ctx.fill();
    ctx.strokeStyle = stack.wasToppedOut ? "#ff5470" : pal.frame;
    ctx.lineWidth = 2;
    ctx.stroke();

    // playfield clip: panels rising from below must not spill out
    ctx.beginPath();
    ctx.rect(x, y, L.boardW, L.boardH);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x, y, L.boardW, L.boardH);
    for (var g = 1; g < E.WIDTH; g++) {
      ctx.fillStyle = pal.grid;
      ctx.fillRect(x + g * cell, y, 1, L.boardH);
    }

    // The board slides up as the stack rises: displacement counts 16 -> 0.
    var rise = ((16 - stack.displacement) / 16) * cell;
    var bottom = y + L.boardH;
    for (var row = 0; row <= E.HEIGHT + 1; row++) {
      for (var col = 1; col <= E.WIDTH; col++) {
        var p = stack.panelAt(row, col);
        if (!p || p.color === 0) continue;
        var px = x + (col - 1) * cell;
        var py = bottom - row * cell - rise;
        if (p.state === "swapping") {
          var t = p.timer / 4;
          px += (p.swapFromLeft ? -t : t) * cell;
        }
        drawPanel(ctx, p, px, py, cell, row === 0, stack);
      }
    }
    ctx.restore();

    // name plate + incoming garbage warning
    ctx.fillStyle = isPlayer ? "#ffd166" : "#ff9ecb";
    ctx.font = "bold " + Math.max(9, Math.round(cell * 0.42)) + "px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(stack.name, x, pos.y - 8);

    if (stack.incoming.length) {
      ctx.fillStyle = "#ff5470";
      ctx.textAlign = "right";
      ctx.fillText("▼ " + stack.incoming.length, x + L.boardW, pos.y - 8);
    }

    drawEffects(isPlayer, x, y, cell, bottom, rise);
    if (isPlayer && !stack.gameOver) {
      if (state.selection) drawSelection(state.selection, x, cell, bottom, rise);
      drawCursor(stack, x, y, cell, bottom, rise);
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPanel(ctx, p, x, y, cell, dimmed, stack) {
    var pal = state.palette;
    var inset = Math.max(1, Math.round(cell * 0.06));
    var size = cell - inset * 2;

    if (p.isGarbage) { drawGarbagePanel(ctx, p, x, y, cell, stack); return; }

    var color = pal.colors[p.color] || "#888";
    var alpha = 1;
    var scale = 1;

    if (p.state === "matched") {
      // flash white, then sit there with a "face" before popping
      var flashing = p.timer > stack.frames.FACE;
      color = flashing && (p.timer % 6 < 3) ? "#ffffff" : color;
    } else if (p.state === "popping") {
      scale = 1 + 0.12 * Math.sin(p.timer * 0.6);
      color = "#ffffff";
    } else if (p.state === "popped") {
      alpha = 0.15;
    } else if (dimmed) {
      alpha = 0.45;
    } else if (p.state === "landing" && p.timer > 6) {
      scale = 1.06;
    }
    // danger wiggle: panels at the very top jitter as a warning
    if (!dimmed && p.row >= stack.height - 1 && stack.wasToppedOut) {
      y += Math.sin((stack.clock + p.col * 3) * 0.5) * 1.5;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    var w = size * scale, h = size * scale;
    var px = x + inset - (w - size) / 2, py = y + inset - (h - size) / 2;
    var grad = ctx.createLinearGradient(px, py, px, py + h);
    grad.addColorStop(0, lighten(color, 0.25));
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    roundRect(ctx, px, py, w, h, Math.max(2, cell * 0.16));
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    drawShape(ctx, SHAPES[p.color], px + w / 2, py + h / 2, w * 0.26);
    ctx.restore();
  }

  function drawGarbagePanel(ctx, p, x, y, cell, stack) {
    var matched = p.state === "matched";
    var flash = matched && p.timer % 8 < 4;
    ctx.save();
    ctx.fillStyle = flash ? "#ffffff" : (p.color === 9 ? "#4a2f6a" : "#6a4a2f");
    ctx.fillRect(x, y, cell, cell);
    // block edges: only draw a border where the neighbour isn't the same slab
    ctx.strokeStyle = flash ? "#ffffff" : "#c9a7ff";
    ctx.lineWidth = 2;
    var sides = [
      [p.row + 1, p.col, x, y, x + cell, y],
      [p.row - 1, p.col, x, y + cell, x + cell, y + cell],
      [p.row, p.col - 1, x, y, x, y + cell],
      [p.row, p.col + 1, x + cell, y, x + cell, y + cell]
    ];
    for (var i = 0; i < sides.length; i++) {
      var n = stack.panelAt(sides[i][0], sides[i][1]);
      if (!n || !n.isGarbage || n.garbageId !== p.garbageId) {
        ctx.beginPath();
        ctx.moveTo(sides[i][2], sides[i][3]);
        ctx.lineTo(sides[i][4], sides[i][5]);
        ctx.stroke();
      }
    }
    // the slab's "face" sits on the centre panel of the block
    if (p.xOffset === Math.floor((p.gWidth - 1) / 2) && p.yOffset === Math.floor((p.gHeight - 1) / 2)) {
      ctx.fillStyle = flash ? "#4a2f6a" : "rgba(255,255,255,0.75)";
      var r = cell * 0.1;
      ctx.beginPath(); ctx.arc(x + cell * 0.35, y + cell * 0.42, r, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + cell * 0.65, y + cell * 0.42, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x + cell * 0.3, y + cell * 0.68, cell * 0.4, Math.max(1, cell * 0.07));
    }
    ctx.restore();
  }

  function drawShape(ctx, shape, cx, cy, r) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    switch (shape) {
      case "circle":
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        break;
      case "triangle":
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r);
        break;
      case "diamond":
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
        break;
      case "star":
        for (var i = 0; i < 10; i++) {
          var ang = (Math.PI / 5) * i - Math.PI / 2;
          var rad = i % 2 === 0 ? r : r * 0.45;
          ctx[i === 0 ? "moveTo" : "lineTo"](cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
        }
        break;
      case "square":
        ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
        break;
      default: // cross
        ctx.rect(cx - r, cy - r * 0.34, r * 2, r * 0.68);
        ctx.rect(cx - r * 0.34, cy - r, r * 0.68, r * 2);
        break;
    }
    ctx.fill();
  }

  function lighten(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, ((n >> 16) & 255) + Math.round(255 * amount));
    var g = Math.min(255, ((n >> 8) & 255) + Math.round(255 * amount));
    var b = Math.min(255, (n & 255) + Math.round(255 * amount));
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function drawCursor(stack, x, y, cell, bottom, rise) {
    var ctx = els.ctx;
    var cx = x + (stack.curCol - 1) * cell;
    var cy = bottom - stack.curRow * cell - rise;
    var pulse = 1 + Math.sin(stack.clock * 0.15) * 0.04;
    var w = cell * 2 * pulse, h = cell * pulse;
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(2, cell * 0.09);
    ctx.shadowColor = "rgba(255,255,255,0.6)";
    ctx.shadowBlur = 6;
    roundRect(ctx, cx - (w - cell * 2) / 2, cy - (h - cell) / 2, w, h, cell * 0.2);
    ctx.stroke();
    ctx.restore();
  }

  // The panel a tap has picked up, waiting for its partner.
  function drawSelection(selection, x, cell, bottom, rise) {
    var ctx = els.ctx;
    var sx = x + (selection.col - 1) * cell;
    var sy = bottom - selection.row * cell - rise;
    ctx.save();
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = Math.max(2, cell * 0.1);
    ctx.setLineDash([cell * 0.25, cell * 0.18]);
    ctx.lineDashOffset = -(state.player.clock % 60) * 0.5;
    roundRect(ctx, sx + 1, sy + 1, cell - 2, cell - 2, cell * 0.2);
    ctx.stroke();
    ctx.restore();
  }

  function drawEffects(isPlayer, x, y, cell, bottom, rise) {
    var ctx = els.ctx;
    for (var i = 0; i < state.effects.length; i++) {
      var fx = state.effects[i];
      if (fx.isPlayer !== isPlayer) continue;
      var px = x + (fx.col - 0.5) * cell + fx.vx * fx.age;
      var py = bottom - fx.row * cell - rise + cell / 2 + fx.vy * fx.age + 0.06 * fx.age * fx.age;
      ctx.globalAlpha = Math.max(0, 1 - fx.age / fx.life);
      ctx.fillStyle = fx.color || "#fff";
      ctx.fillRect(px, py, Math.max(2, cell * 0.12), Math.max(2, cell * 0.12));
      ctx.globalAlpha = 1;
    }
  }

  function drawCards() {
    var ctx = els.ctx, L = state.layout, cell = L.cell;
    for (var i = 0; i < state.cards.length; i++) {
      var card = state.cards[i];
      var pos = card.isPlayer ? L.player : L.foe;
      var rise2 = card.age * 0.5;
      var x = pos.x + (card.col - 0.5) * cell;
      var y = pos.y + L.boardH - card.row * cell - rise2;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - card.age / card.life);
      ctx.font = "bold " + Math.round(cell * 0.6) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(card.text, x, y);
      ctx.fillStyle = card.color;
      ctx.fillText(card.text, x, y);
      ctx.restore();
    }
  }

  // Garbage in flight, drawn as a slab arcing from the sender to the target.
  // A chain that is still building sits above its owner's board and grows.
  function drawAttacks() {
    drawAttacksFor(state.player, state.layout.player, state.layout.foe);
    drawAttacksFor(state.foe, state.layout.foe, state.layout.player);
  }

  function drawAttacksFor(stack, from, to) {
    var ctx = els.ctx, L = state.layout, cell = L.cell;
    for (var i = 0; i < stack.outgoing.length; i++) {
      var g = stack.outgoing[i];
      var sx = from.x + L.boardW / 2;
      var sy = from.y + L.boardH - (g.origin ? g.origin.row : 6) * cell;
      var tx = to.x + L.boardW / 2;
      var ty = to.y - cell * 0.6;
      var w = cell * Math.min(g.width, 6) * 0.5;
      var h = Math.max(cell * 0.3, cell * 0.32 * g.height);
      var x, y, alpha = 1;

      if (!g.finalized) {
        // still growing: park it over the sender's board and pulse
        x = sx; y = from.y - cell * 0.7;
        alpha = 0.7 + 0.3 * Math.sin(stack.clock * 0.2);
      } else {
        var p = Math.min(1, Math.max(0, (stack.clock - g.frameEarned) / E.GARBAGE_FLIGHT));
        x = sx + (tx - sx) * p;
        y = sy + (ty - sy) * p - Math.sin(p * Math.PI) * L.boardH * 0.25;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g.isChain ? "#c9a7ff" : "#ff8ac4";
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (g.isChain && g.height > 1) {
        ctx.fillStyle = "#2a1030";
        ctx.font = "bold " + Math.round(cell * 0.4) + "px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(g.height + "", x, y);
      }
      ctx.restore();
    }
  }

  function drawHud() {
    var ctx = els.ctx, L = state.layout, s = state;
    ctx.save();
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("score " + s.player.score, L.player.x + L.boardW / 2, L.player.y + L.boardH + 15);
    ctx.fillText("score " + s.foe.score, L.foe.x + L.boardW / 2, L.foe.y + L.boardH + 15);

    // stop time: the pause you earn from a chain/combo, the thing that keeps
    // you alive when topped out
    if (s.player.stopTime > 0) {
      ctx.fillStyle = "#7ee6ff";
      ctx.fillText("STOP " + Math.ceil(s.player.stopTime / 60) + "s", L.player.x + L.boardW / 2, L.player.y - 8);
    }
    ctx.restore();
  }

  function drawCountdown() {
    var ctx = els.ctx, L = state.layout;
    var seconds = Math.ceil(state.countdown / 60);
    var text = seconds > 0 ? String(seconds) : "GO";
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, L.w, L.h);
    ctx.font = "bold " + Math.round(L.h * 0.3) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffd166";
    ctx.fillText(text, L.w / 2, L.h / 2);
    ctx.font = "bold " + Math.round(L.h * 0.05) + "px system-ui, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText((state.opponent.name || "Opponent") + " has entered the arena",
      L.w / 2, L.h / 2 + L.h * 0.22);
    ctx.restore();
  }

  return {
    start: start,
    stop: stop,
    isActive: function () { return !!state; },
    // Hook for the headless smoke test: read the match state, and (only when
    // asked) hand the player's board to a CPU so a duel can be played out
    // without a human at the keyboard.
    debug: function () {
      if (!state) return null;
      return {
        countdown: state.countdown,
        over: state.over,
        playerFill: state.player.fillRatio(),
        foeFill: state.foe.fillRatio(),
        playerScore: state.player.score,
        foeScore: state.foe.score,
        playerSwaps: state.swapCount,
        cursor: state.player.curRow + "," + state.player.curCol,
        selection: state.selection && (state.selection.row + "," + state.selection.col),
        pointer: state.pointer && (state.pointer.row + "," + state.pointer.col + (state.pointer.dragged ? ",dragged" : "")),
        displacement: state.player.displacement,
        board: state.layout && {
          x: state.layout.player.x, y: state.layout.player.y,
          cell: state.layout.cell, height: state.layout.boardH
        },
        clock: state.player.clock,
        autoplay: function (difficulty) {
          state.autopilot = new window.PanelCpu.Cpu(state.player, {
            difficulty: difficulty || "brutal", seed: 99
          });
        }
      };
    }
  };
})();
