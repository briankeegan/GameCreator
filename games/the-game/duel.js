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
  // The countdown itself is entirely panel-engine.js's call (Stack:runCountdown,
  // 1:1 with the reference — riseLock held, cursor scripted, physics frozen
  // until clock reaches this many frames). state.countdown here is only a
  // derived readout for the overlay/input gating, never its own clock.
  var COUNTDOWN_FRAMES = E.COUNTDOWN_TOTAL;

  // "diamond" and "nightmare" are the SearchCpu presets (see panel-cpu.js);
  // every other named difficulty is the older single-ply heuristic bot.
  // One call site so nothing forgets which class a difficulty needs.
  function makeCpu(stack, difficulty, seed) {
    var Ctor = (difficulty === "diamond" || difficulty === "nightmare")
      ? window.PanelCpu.SearchCpu : window.PanelCpu.Cpu;
    return new Ctor(stack, { difficulty: difficulty || "steady", seed: seed });
  }

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
      cpu: makeCpu(foe, opponent.difficulty, seed + 55),
      opponent: opponent,
      // A duel can be a SET rather than a single game — Kat's is "first to
      // five wins", straight out of the plot. firstTo 1 (the default) behaves
      // exactly as a single game always did.
      seed: seed,
      playerLevel: opts.playerLevel || 2,
      playerSprite: opts.playerSprite || "nella_top",
      foeSprite: opponent.sprite || (opponent.id ? opponent.id + "_top" : null),
      crush: null,
      firstTo: Math.max(1, opts.firstTo || 1),
      wins: { player: 0, foe: 0 },
      palette: PALETTES[opponent.theme === "red" ? "red" : "pink"],
      countdown: COUNTDOWN_FRAMES,
      over: null,
      overDelay: 0,
      acc: 0,
      tick: 0,
      cheer: 0,   // 0..1, spikes on a big chain and decays — the crowd reacts     // frames since the match began — drives the orb/ribbon motion
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
      state.tick++;
      step();
    }
    render();
  }

  function step() {
    var s = state;
    // Paused while any menu screen is up: nothing rises while the player is
    // reading a menu.
    if (window.NewseyMenu && window.NewseyMenu.current()) return;
    if (s.countdown > 0) {
      // Both stacks still tick every frame during the countdown — the
      // engine holds its own physics off internally (Stack:runCountdown)
      // and drives the scripted cursor dance, so there's nothing left for
      // this screen to gate beyond reading back how much is left.
      s.player.run();
      s.foe.run();
      s.countdown = Math.max(0, E.COUNTDOWN_TOTAL - s.player.clock);
      return;
    }
    if (s.crush) {
      stepCrush();
      // The moment she is whole again, hand over to the result card.
      var done = s.crush.restAt !== null &&
                 s.crush.t >= s.crush.restAt + CRUSH_HOLD + CRUSH_GONE + CRUSH_BACK;
      if (done && s.overDelay > 1) s.overDelay = 1;
    }
    if (s.cheer > 0) s.cheer = Math.max(0, s.cheer - 0.012);
    if (s.over) {
      if (s.overDelay > 0 && --s.overDelay === 0) {
        if (setDecided()) showResult(); else showRoundCard();
      }
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
      if (s.over === "win") s.wins.player++; else s.wins.foe++;
      // "the concrete slabs fell and literally smashed me flat, I felt the
      // crunch of my own bones. I seemed to dissolve, and then reappear in
      // front of Kat in one piece." Everything queued over the loser's board
      // comes down on them, they squash, dissolve, and re-form — and only then
      // does the card come up.
      startCrush(s.over === "win" ? "foe" : "player");
      // The card waits for the SIMULATION, not a countdown: how long the
      // blocks take to stop moving depends on how many there were and how
      // they piled, and no number computed up front knows that. overDelay is
      // only a backstop now — stepCrush pulls it to 1 the frame the whole
      // sequence finishes, and this cap means a wedged block can still never
      // leave the match hanging.
      s.overDelay = CRUSH_MAX_FALL + CRUSH_HOLD + CRUSH_GONE + CRUSH_BACK + 60;
    }
  }

  function collectEvents(stack, isPlayer) {
    var events = stack.drainEvents();
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.type === "match") {
        if (ev.chain && ev.chainCounter > 1) {
          addCard(isPlayer, ev.row, ev.col, "x" + ev.chainCounter, "#ffd166");
          state.cheer = Math.min(1, state.cheer + 0.25 * ev.chainCounter);
        }
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

  function setDecided() {
    var s = state;
    return s.wins.player >= s.firstTo || s.wins.foe >= s.firstTo;
  }

  // Between games of a set: the running score and a button that deals the
  // next board, rather than the card that ends the whole thing.
  function showRoundCard() {
    var s = state, won = s.over === "win";
    var them = s.opponent.name || "Opponent";
    els.resultTitle.textContent = won ? "GAME TO YOU" : "GAME TO " + them.toUpperCase();
    els.resultTitle.style.color = won ? "#ffd166" : "#ff6b6b";
    els.resultText.textContent = s.player.name + " " + s.wins.player + " — " +
      s.wins.foe + " " + them + ". First to " + s.firstTo + " takes the set.";
    els.resultBtn.textContent = "Next game ▸";
    els.resultBtn.onclick = function () { els.result.hidden = true; nextGame(); };
    els.result.hidden = false;
  }

  // Fresh boards, same set. The seed moves on with the score so the next game
  // isn't the same board again.
  function nextGame() {
    var s = state, o = s.opponent;
    s.seed = (s.seed + s.wins.player * 7919 + s.wins.foe * 104729 + 13) >>> 0;
    s.player = new E.Stack({ level: s.playerLevel, seed: s.seed, name: s.player.name });
    s.foe = new E.Stack({ level: o.level || 3, seed: s.seed + 101, name: s.foe.name });
    s.cpu = makeCpu(s.foe, o.difficulty, s.seed + 55);
    s.over = null;
    s.overDelay = 0;
    s.crush = null;
    s.countdown = COUNTDOWN_FRAMES;
    s.effects = [];
    s.cards = [];
    s.selection = null;
    s.pointer = null;
    s.latched = {};
    s.keyLatch = {};
    s.tick = 0;
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
    els.resultBtn.textContent = "Back to Infinity ▸";
    els.resultBtn.onclick = function () { finish(); };
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
    // The top bar carries the two names AND the orb the ribbons unroll from
    // (see drawArena) — the orb needs its own room reserved here, or the
    // boards grow to fill the whole frame and it gets squashed against the
    // top edge with the ribbons bulging out sideways to reach it.
    var orbRoom = Math.round(Math.max(40, Math.min(104, h * 0.14)));
    // ...and a strip along the bottom for the duellists themselves. The plot
    // has them standing on the arena floor looking UP at the panels and at the
    // slabs balanced overhead — "about 10 feet directly above me" — so the
    // board is something they stand under, not a box floating on a gradient.
    var floorRoom = Math.round(Math.max(30, Math.min(76, h * 0.11)));
    var topBar = 26 + orbRoom, bottomBar = 18 + floorRoom;
    var gap = Math.max(14, Math.round(w * 0.05));
    var cellW = Math.floor((w - gap - 16) / (E.WIDTH * 2));
    var cellH = Math.floor((h - topBar - bottomBar) / E.HEIGHT);
    var cell = Math.max(8, Math.min(cellW, cellH));
    var boardW = cell * E.WIDTH, boardH = cell * E.HEIGHT;
    var totalW = boardW * 2 + gap;
    var x0 = Math.round((w - totalW) / 2);
    var y0 = Math.round(topBar + (h - topBar - bottomBar - boardH) / 2);
    state.layout = {
      cell: cell, boardW: boardW, boardH: boardH, gap: gap, w: w, h: h,
      orbRoom: orbRoom, floorRoom: floorRoom, bottomBar: bottomBar,
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
    drawCrowd();
    drawArena();

    drawBoard(s.player, L.player, true);
    drawBoard(s.foe, L.foe, false);
    // Once the crush starts, the loser's queued slabs are falling rather than
    // hanging, so drawCrushFall owns them from that frame on.
    if (!s.crush || s.crush.side !== "player") drawSlabs(s.player, L.player);
    if (!s.crush || s.crush.side !== "foe") drawSlabs(s.foe, L.foe);
    drawDuellists();
    drawCrushFall();
    drawAttacks();
    drawCards();
    drawHud();
    if (s.countdown > 0) drawCountdown();
  }

  // The plot describes exactly what a duel looks like from inside the arena:
  // "In the middle of the ceiling was a gigantic swirling golden orb... The
  // giant golden orb in the middle of the map suddenly cracked, and from it
  // unrolled two gigantic golden ribbons. On the ribbons, there were the same
  // shapes from the game Puzzle Attack." So the two boards are not floating
  // panels on a gradient — they ARE the ribbons, and this draws the orb they
  // hang from and the ribbons behind the panels.
  function drawArena() {
    var ctx = els.ctx, L = state.layout, t = state.tick / 60;
    var r = Math.max(9, Math.min(L.orbRoom * 0.42, L.gap * 1.1, 30));
    var ox = L.w / 2, oy = 26 + L.orbRoom * 0.5;

    ribbon(L.player, -1);
    ribbon(L.foe, 1);

    ctx.save();
    ctx.translate(ox, oy);
    var glow = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2.2);
    glow.addColorStop(0, "rgba(255,196,84,0.26)");
    glow.addColorStop(1, "rgba(255,170,60,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2); ctx.fill();

    var body = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    body.addColorStop(0, "#ffe9a8");
    body.addColorStop(0.55, "#f0a93c");
    body.addColorStop(1, "#8a4a12");
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    // the crack it split along, and the swirl still turning under the surface
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#fff0c0";
    ctx.lineWidth = Math.max(1, r * 0.07);
    for (var a = 0; a < 3; a++) {
      ctx.beginPath();
      for (var k = 0; k <= 10; k++) {
        var f = k / 10, rr = r * (0.15 + f * 0.8);
        var ang = a * 2.1 + t * 0.8 + f * 2.2;
        var x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(60,24,6,0.85)";
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(-r, -r * 0.35);
    ctx.lineTo(-r * 0.3, -r * 0.1);
    ctx.lineTo(-r * 0.45, r * 0.25);
    ctx.lineTo(r * 0.25, r * 0.05);
    ctx.lineTo(r, r * 0.4);
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    // A band of gold running from under the orb down past the board, so the
    // panels read as sitting ON it rather than in a floating box. The control
    // points stay inside the span it has to cover — pushed outside, the curve
    // bulged into a blob that swallowed the whole screen.
    function ribbon(pos, side) {
      var topInX = ox + side * r * 0.12, topOutX = ox + side * r * 0.62;
      var topY = oy + r * 0.7;
      var bx0 = pos.x - 7, bx1 = pos.x + L.boardW + 7;
      var outX = side < 0 ? bx0 : bx1, inX = side < 0 ? bx1 : bx0;
      var shoulder = pos.y - 5, foot = pos.y + L.boardH + 9;
      var midY = (topY + shoulder) / 2;
      var sway = Math.sin(t * 1.1 + side) * Math.min(8, L.gap * 0.2);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(topOutX, topY);
      ctx.quadraticCurveTo(topOutX + sway, midY, outX, shoulder);
      ctx.lineTo(outX, foot);
      ctx.lineTo(inX, foot);
      ctx.lineTo(inX, shoulder);
      ctx.quadraticCurveTo(topInX + sway, midY, topInX, topY);
      ctx.closePath();
      var g = ctx.createLinearGradient(0, topY, 0, foot);
      g.addColorStop(0, "#f4c15a");
      g.addColorStop(0.3, "#d99a35");
      g.addColorStop(1, "#7d4e13");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,232,168,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  // =========================================================================
  // THE ARENA FLOOR — the duellists, the slabs over them, and the crush
  // =========================================================================

  // Sprite art, loaded once and cached. A duel that can't find a character's
  // art draws a plain silhouette rather than a letter in a disc: this screen
  // is the one place a fallback token would be unmissable.
  var sprites = {};
  function sprite(id) {
    if (!id) return null;
    if (!(id in sprites)) {
      var img = new Image();
      img.src = "art/" + id + ".png";
      sprites[id] = { img: img, ok: false };
      img.onload = function () { sprites[id].ok = true; };
      img.onerror = function () { sprites[id].ok = false; };
    }
    return sprites[id];
  }

  function groundLine() {
    var L = state.layout;
    return L.h - L.bottomBar + L.floorRoom - 6;
  }

  function drawDuellists() {
    var L = state.layout, s = state;
    var g = groundLine();
    // facing each other across the arena
    drawFighter(s.playerSprite, L.player.x + L.boardW / 2, g, false,
                s.crush && s.crush.side === "player" ? s.crush : null, "#ffd166");
    drawFighter(s.foeSprite, L.foe.x + L.boardW / 2, g, true,
                s.crush && s.crush.side === "foe" ? s.crush : null, "#ff9ecb");
  }

  function drawFighter(id, cx, groundY, mirror, crush, tint) {
    var ctx = els.ctx, L = state.layout;
    var h = L.floorRoom * 0.92, w = h * 0.62;
    var entry = sprite(id);
    if (entry && entry.ok && entry.img.naturalHeight) {
      w = h * (entry.img.naturalWidth / entry.img.naturalHeight);
    }

    // The crush: flattened, then gone, then whole again.
    var squash = 1, spread = 1, alpha = 1;
    if (crush) {
      // SHE is the thing that squashes — the blocks are rigid. How far she
      // goes down tracks how much of the board has actually landed on her
      // (crushFlatten), so a nearly-empty board barely presses her and a full
      // one puts her on the floor, without a frame count deciding it.
      var f = crushFlatten(crush);
      var fade = crushFade(crush);
      squash = 1 - 0.78 * f;
      spread = 1 + 0.55 * f;
      alpha = fade.fighter;
      // ...and she comes back whole, so the squash unwinds as she re-forms.
      if (fade.back !== undefined) {
        squash = 0.22 + 0.78 * fade.back;
        spread = 1.55 - 0.55 * fade.back;
      }
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    // a shadow, so nobody stands on nothing
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx, groundY, w * 0.42 * spread, Math.max(2, h * 0.07), 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(cx, groundY);
    ctx.scale(mirror ? -spread : spread, squash);
    if (entry && entry.ok && entry.img.naturalHeight) {
      ctx.drawImage(entry.img, -w / 2, -h, w, h);
    } else {
      // a silhouette: a body and a head, in the character's own colour
      ctx.fillStyle = tint;
      ctx.globalAlpha = alpha * 0.85;
      roundRect(ctx, -w * 0.34, -h * 0.72, w * 0.68, h * 0.72, w * 0.18);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -h * 0.82, h * 0.17, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Slabs waiting overhead. Several hundred pounds each, balanced as if by
  // magic — so they hang, and they sway a little, and they are obviously
  // going to land on somebody.
  function drawSlabs(stack, pos) {
    var ctx = els.ctx, L = state.layout, s = state;
    var n = Math.min(5, stack.incoming.length);
    if (!n) return;
    // Over the DUELLIST's head, not over the board — "I nervously looked up
    // and saw the attacks that Kat had created as represented by large
    // concrete slabs... balanced as if by magic about 10 feet directly above
    // me." Hung over the board instead they also collided with the name
    // plates and the set tally, which is how this got noticed.
    var slabW = L.boardW * 0.52, slabH = Math.max(4, L.floorRoom * 0.15);
    var cx = pos.x + L.boardW / 2;
    var head = groundLine() - L.floorRoom * 0.92 - 6;
    for (var i = 0; i < n; i++) {
      var sway = Math.sin(s.tick / 26 + i * 1.3) * 2.2;
      var y = head - i * (slabH + 3);
      ctx.save();
      ctx.translate(cx + sway, y);
      var g = ctx.createLinearGradient(0, -slabH / 2, 0, slabH / 2);
      g.addColorStop(0, "#9aa0ad");
      g.addColorStop(0.5, "#6d7482");
      g.addColorStop(1, "#40454f");
      ctx.fillStyle = g;
      roundRect(ctx, -slabW / 2, -slabH / 2, slabW, slabH, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(20,18,26,0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    if (stack.incoming.length > n) {
      ctx.fillStyle = "rgba(230,225,240,0.8)";
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("+" + (stack.incoming.length - n), cx, head - n * (slabH + 3) - 4);
    }
  }

  // WHEN YOU LOSE, YOUR BOARD FALLS ON YOU.
  //
  // The board's bottom edge is the SLAB HOLDING IT ALL UP, and it gets pulled
  // out from under her — withdrawing left to right. As each column loses its
  // support that column drops, so the stack collapses as a wave running
  // across the board rather than all at once. Every block falls straight down
  // its own column until it lands on whatever is already down there: the
  // arena floor, or the top of the block below it. That is the whole model.
  // Blocks stay in their columns, they stay on top of each other, and the
  // pile ends up being her board with the gaps closed, on the floor, on her.
  //
  // Getting here took four wrong versions, all of them clever:
  //   * Five anonymous grey slabs. Read as scenery falling, not as the game.
  //   * The real panels, but SHRINKING on the way down. There is no
  //     perspective change between the board and a floor a few pixels below
  //     it; the shrink existed only to make a pre-computed pile fit.
  //   * Panels SQUASHING flat when they landed. Backwards — the blocks are
  //     the rigid things here. She is what squashes.
  //   * A per-block physics sim with a height map, scattered release order,
  //     tumbling, bouncing and rolling. It spent its time building scree
  //     slopes: blocks skating out to both walls, blocks hanging in mid-air
  //     over gaps, and a heap that climbed hundreds of pixels UP the screen,
  //     so it read as blocks rising while every one of them was falling.
  // Every one of those simulated something nobody asked for. Things fall
  // down, and they stay on top of each other.
  var CRUSH_GRAVITY = 0.62;    // px per frame squared
  var CRUSH_COL_STEP = 5;      // frames the slab takes to clear one column
  var CRUSH_HOLD = 14;         // beat where it sits there, buried
  var CRUSH_GONE = 26, CRUSH_BACK = 20;
  var CRUSH_MAX_FALL = 240;    // backstop, so nothing can leave the match hanging

  // Which sides of a falling garbage cell are outer edges, from where its
  // slab-mates actually are right now. Two cells are joined when they belong
  // to the same slab and their rects are still touching — so a slab that has
  // sheared in half down the middle grows a new border down the split, which
  // is what it should look like.
  function crushGarbageEdges(c, blk) {
    var e = { top: true, bottom: true, left: true, right: true };
    var tol = Math.max(1, blk.w * 0.08);
    for (var i = 0; i < c.blocks.length; i++) {
      var o = c.blocks[i];
      if (o === blk || !o.garbage || o.garbageId !== blk.garbageId) continue;
      var dx = o.x - blk.x, dy = o.y - blk.y;
      if (Math.abs(dy) < tol) {
        if (Math.abs(dx - blk.w) < tol) e.right = false;
        if (Math.abs(dx + blk.w) < tol) e.left = false;
      } else if (Math.abs(dx) < tol) {
        if (Math.abs(dy - blk.w) < tol) e.bottom = false;
        if (Math.abs(dy + blk.w) < tol) e.top = false;
      }
    }
    return e;
  }

  function startCrush(side) {
    var L = state.layout, cell = L.cell;
    var pos = side === "player" ? L.player : L.foe;
    var stack = side === "player" ? state.player : state.foe;
    var g = groundLine();
    var blocks = [];

    // Snapshot the board EXACTLY as drawBoard is drawing it this frame — same
    // columns, same rows, same rise, same cell size. drawBoard then renders
    // that side empty, so what falls is precisely what was up there rather
    // than a re-creation of it.
    var bottom = pos.y + L.boardH;
    var rise = ((16 - stack.displacement) / 16) * cell;
    for (var row = 1; row <= E.HEIGHT + 1; row++) {
      for (var col = 1; col <= E.WIDTH; col++) {
        var p = stack.panelAt(row, col);
        if (!p || p.color === 0 || p.state === "popped") continue;
        // A garbage cell is only bordered where its neighbour is not part of
        // the SAME slab — that is what makes a row of them read as one
        // concrete block instead of six outlined empty boxes. The edges have
        // to be worked out PER FRAME from where the blocks actually are (see
        // crushGarbageEdges), not baked in here: columns let go at different
        // moments as the slab withdraws, so a garbage row shears apart on the
        // way down, and flags captured off the intact board leave the halves
        // drawn as open-ended boxes with a side missing.
        var face = p.isGarbage &&
                   p.xOffset === Math.floor((p.gWidth - 1) / 2) &&
                   p.yOffset === Math.floor((p.gHeight - 1) / 2);
        blocks.push({
          col: col,
          x: pos.x + (col - 1) * cell,
          y: bottom - row * cell - rise,
          w: cell, h: cell,
          vy: 0,
          color: p.color,
          garbage: !!p.isGarbage,
          garbageId: p.garbageId,
          face: face,
          // A column falls the moment the slab clears IT — so the collapse
          // runs left to right with the withdrawal, and a column's own blocks
          // all let go together, keeping their order on the way down.
          release: (col - 1) * CRUSH_COL_STEP,
          settled: false
        });
      }
    }

    // The garbage queued overhead comes down last, still slabs, landing on
    // top of everything her board left.
    var slabH = Math.max(4, L.floorRoom * 0.17);
    var queued = Math.min(5, stack.incoming.length);
    var lastRelease = 0;
    for (var b = 0; b < blocks.length; b++) {
      if (blocks[b].release > lastRelease) lastRelease = blocks[b].release;
    }
    for (var i = 0; i < queued; i++) {
      blocks.push({
        col: 0,                              // spans the board, see crushRestFor
        x: pos.x + L.boardW * 0.17 + (i % 2 ? 1 : -1) * (2 + i),
        y: g - L.floorRoom * 0.92 - 6 - i * (slabH + 3),
        w: L.boardW * 0.66, h: slabH,
        vy: 0, slab: true,
        release: lastRelease + 6 + i * 3,
        settled: false
      });
    }

    // Where the next block to land in each column comes to rest. Starts at
    // the arena floor; every landing lifts it by that block's height. This is
    // the whole of the collision model, and it is why nothing can float, roll
    // away, or stack into a pile that is anything but its column's contents.
    var colTop = {};
    for (var cc = 0; cc <= E.WIDTH; cc++) colTop[cc] = g;

    state.crush = {
      side: side, t: 0, pos: pos, stack: stack, ground: g,
      cell: cell, boardBottom: bottom, boardW: L.boardW,
      blocks: blocks, colTop: colTop,
      moving: blocks.length,
      contacts: 0,
      restAt: null
    };
  }

  // What a block rests on. A panel sees only its own column. A slab spans the
  // board, so it rests on the highest column under it — it is one wide rigid
  // thing and cannot sink into the gaps.
  function crushRestFor(c, blk) {
    if (!blk.slab) return c.colTop[blk.col];
    var top = c.ground;
    for (var col = 1; col <= E.WIDTH; col++) {
      if (c.colTop[col] < top) top = c.colTop[col];
    }
    return top;
  }

  function crushLand(c, blk) {
    if (!blk.slab) { c.colTop[blk.col] -= blk.h; return; }
    var to = crushRestFor(c, blk) - blk.h;
    for (var col = 1; col <= E.WIDTH; col++) {
      if (c.colTop[col] > to) c.colTop[col] = to;
    }
  }

  function stepCrush() {
    var c = state.crush;
    if (!c) return;
    c.t++;
    if (c.restAt !== null) return;

    for (var i = 0; i < c.blocks.length; i++) {
      var blk = c.blocks[i];
      if (blk.settled || c.t < blk.release) continue;
      blk.vy += CRUSH_GRAVITY;
      blk.y += blk.vy;
      var rest = crushRestFor(c, blk) - blk.h;
      if (blk.y >= rest) {
        blk.y = rest;
        blk.vy = 0;
        blk.settled = true;
        c.moving--;
        c.contacts++;
        crushLand(c, blk);
      }
    }

    if (c.moving <= 0 || c.t > CRUSH_MAX_FALL) {
      for (var j = 0; j < c.blocks.length; j++) c.blocks[j].settled = true;
      c.restAt = c.t;
    }
  }

  // How flat the loser is: she goes down as the blocks actually pile onto
  // her, not on a timer. A nearly-empty board barely presses her; a full one
  // puts her on the floor.
  function crushFlatten(c) {
    if (!c) return 0;
    if (c.restAt !== null) return 1;
    return Math.min(1, c.contacts / Math.max(1, c.blocks.length * 0.55));
  }

  // Dissolve, then whole again: "I seemed to dissolve, and then reappear in
  // front of Kat in one piece." The pile and the fighter both run off this,
  // so it can't outlive her and leave the result card sitting over a heap
  // with nobody visible under it.
  function crushFade(c) {
    if (!c || c.restAt === null) return { rubble: 1, fighter: 1 };
    var k = c.t - c.restAt - CRUSH_HOLD;
    if (k <= 0) return { rubble: 1, fighter: 1 };
    if (k < CRUSH_GONE) {
      var f = 1 - k / CRUSH_GONE;
      return { rubble: f, fighter: f };
    }
    var b = Math.min(1, (k - CRUSH_GONE) / CRUSH_BACK);
    return { rubble: 0, fighter: b, back: b };
  }

  // One block of the falling board. Same gradient, corner and glyph drawPanel
  // gives it in the stack, so what comes down is recognisably what was
  // sitting there. Kept separate from drawPanel because that one needs a live
  // engine panel and its stack for neighbour lookups, and this is a snapshot
  // with neither.
  function drawLoosePanel(ctx, blk) {
    var pal = state.palette;
    if (blk.slab) {
      var sg = ctx.createLinearGradient(0, blk.y, 0, blk.y + blk.h);
      sg.addColorStop(0, "#9aa0ad");
      sg.addColorStop(0.5, "#6d7482");
      sg.addColorStop(1, "#40454f");
      ctx.fillStyle = sg;
      roundRect(ctx, blk.x, blk.y, blk.w, blk.h, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(20,18,26,0.75)";
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }
    if (blk.garbage) {
      var gx = blk.x, gy = blk.y, gc = blk.w;
      var e = crushGarbageEdges(state.crush, blk);
      ctx.save();
      ctx.fillStyle = blk.color === 9 ? "#4a2f6a" : "#6a4a2f";
      ctx.fillRect(gx, gy, gc, gc);
      ctx.strokeStyle = "#c9a7ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (!e || e.top) { ctx.moveTo(gx, gy); ctx.lineTo(gx + gc, gy); }
      if (!e || e.bottom) { ctx.moveTo(gx, gy + gc); ctx.lineTo(gx + gc, gy + gc); }
      if (!e || e.left) { ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + gc); }
      if (!e || e.right) { ctx.moveTo(gx + gc, gy); ctx.lineTo(gx + gc, gy + gc); }
      ctx.stroke();
      // the slab's face, on its centre cell, same as on the board
      if (blk.face) {
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        var r = gc * 0.1;
        ctx.beginPath(); ctx.arc(gx + gc * 0.35, gy + gc * 0.42, r, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(gx + gc * 0.65, gy + gc * 0.42, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(gx + gc * 0.3, gy + gc * 0.68, gc * 0.4, Math.max(1, gc * 0.07));
      }
      ctx.restore();
      return;
    }
    var cell = blk.w;
    var inset = Math.max(1, Math.round(cell * 0.06));
    var size = cell - inset * 2;
    var color = pal.colors[blk.color] || "#888";
    ctx.save();
    ctx.translate(blk.x + inset, blk.y + inset);
    var grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, lighten(color, 0.25));
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    roundRect(ctx, 0, 0, size, size, Math.max(2, cell * 0.16));
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    drawShape(ctx, SHAPES[blk.color], size / 2, size / 2, size * 0.26);
    ctx.restore();
  }

  function drawCrushFall() {
    var c = state.crush;
    if (!c) return;
    var ctx = els.ctx;
    var fade = crushFade(c);
    if (fade.rubble <= 0) return;

    ctx.save();
    ctx.globalAlpha = fade.rubble;

    // THE GATE. It is what the board has been standing on all match, and when
    // you lose it GOES — vanishing left to right, a column at a time, so you
    // can see why each column lets go instead of columns just deciding to
    // fall. Its left end is the release front: everything left of it is
    // already unsupported and on its way down.
    // Drawn earlier as a bar sliding out sideways, which made no sense —
    // there is nowhere for a board-width slab to slide TO, and it read as an
    // object flying off the screen rather than as the floor giving way.
    var gone = (c.t / CRUSH_COL_STEP) * c.cell;
    var gateLeft = c.pos.x + gone;
    var gateRight = c.pos.x + c.boardW;
    if (gateLeft < gateRight) {
      // Thick enough to read as the thing holding the board up. At 0.16 of a
      // cell it sat on the board's own frame line and vanished into it.
      var sh = Math.max(4, c.cell * 0.24);
      var sy = c.boardBottom + 2;
      var sg = ctx.createLinearGradient(0, sy, 0, sy + sh);
      sg.addColorStop(0, "#9aa0ad");
      sg.addColorStop(0.55, "#6d7482");
      sg.addColorStop(1, "#3a3f49");
      ctx.fillStyle = sg;
      ctx.fillRect(gateLeft, sy, gateRight - gateLeft, sh);
      ctx.strokeStyle = "rgba(20,18,26,0.8)";
      ctx.lineWidth = 1;
      ctx.strokeRect(gateLeft, sy, gateRight - gateLeft, sh);
      // the edge that is currently dissolving, so the front is visible
      ctx.fillStyle = "rgba(255,209,102,0.55)";
      ctx.fillRect(gateLeft, sy, Math.max(2, c.cell * 0.06), sh);
    }

    for (var i = 0; i < c.blocks.length; i++) drawLoosePanel(ctx, c.blocks[i]);
    ctx.restore();

    // Dust, kicked up while blocks are still arriving. Tied to landings
    // rather than a frame number, so it puffs when things actually hit.
    if (c.restAt === null && c.contacts > 0) {
      var d = Math.min(1, c.contacts / Math.max(1, c.blocks.length));
      var gx = c.pos.x + state.layout.boardW / 2;
      ctx.save();
      ctx.globalAlpha = 0.3 * (1 - d) + 0.08;
      ctx.fillStyle = "#c9c2d6";
      for (var q = 0; q < 7; q++) {
        var a = q * 0.9;
        ctx.beginPath();
        ctx.arc(gx + Math.cos(a) * (12 + d * 46), c.ground - 2 - Math.sin(a) * d * 14,
                2.5 + d * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // The stands, and the people in them. "He pointed to the 'stands', which I
  // hadn't noticed being in this library-like stadium. I saw most of the
  // people who were at the bar standing up there and cheering." Drawn rather
  // than generated: they are twenty pixels tall and nobody will ever look at
  // one closely.
  var CROWD = 26;
  function drawCrowd() {
    var ctx = els.ctx, L = state.layout, s = state;
    var rows = 2;
    var top = 8;
    for (var r = 0; r < rows; r++) {
      var y = top + r * 9;
      for (var i = 0; i < CROWD; i++) {
        // a fixed pseudo-random spread, so the crowd doesn't shimmer
        var seed = (i * 73 + r * 131) % 97;
        var x = (i + (seed % 5) * 0.12) * (L.w / CROWD) + (r ? L.w / CROWD / 2 : 0);
        // they bob, and they bob harder just after somebody lands a big chain
        var lift = Math.sin(s.tick / 12 + seed) * (1 + s.cheer * 2.5);
        var hue = 200 + (seed % 7) * 18;
        ctx.fillStyle = "hsla(" + hue + ",22%," + (26 + (seed % 4) * 4) + "%,0.85)";
        ctx.beginPath();
        ctx.arc(x, y - lift, 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x - 1.9, y - lift + 1.4, 3.8, 4.4);
      }
    }
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
    // Nearly opaque: the gold ribbon runs behind the board (drawArena), and a
    // translucent playfield let it wash through as a flat olive slab instead
    // of reading as panels lying ON a ribbon.
    ctx.fillStyle = "rgba(10,4,18,0.86)";
    ctx.fillRect(x, y, L.boardW, L.boardH);
    for (var g = 1; g < E.WIDTH; g++) {
      ctx.fillStyle = pal.grid;
      ctx.fillRect(x + g * cell, y, 1, L.boardH);
    }

    // The board slides up as the stack rises: displacement counts 16 -> 0.
    var rise = ((16 - stack.displacement) / 16) * cell;
    var bottom = y + L.boardH;
    // While the crush runs, the loser's panels are falling on them (see
    // startCrush) — drawing them here as well would show the same stack in
    // two places at once.
    var emptied = !!(state.crush &&
                     (state.crush.side === "player") === !!isPlayer);
    for (var row = 0; !emptied && row <= E.HEIGHT + 1; row++) {
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

    // Name plate on the OUTER top corner and the incoming-garbage warning on
    // the inner one: the ribbon narrows to its neck between the two boards, so
    // a name pinned to the inner corner sat on top of the gold and vanished.
    ctx.fillStyle = isPlayer ? "#ffd166" : "#ff9ecb";
    ctx.font = "bold " + Math.max(9, Math.round(cell * 0.42)) + "px system-ui, sans-serif";
    ctx.textAlign = isPlayer ? "left" : "right";
    ctx.fillText(stack.name, isPlayer ? x : x + L.boardW, pos.y - 10);

    // Incoming garbage is drawn as the slabs it is (drawSlabs), not counted in
    // a corner — the plot has her look UP and see them balanced overhead, and
    // a number can't be looked up at.

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
    // The loser's score line sits in the gap between their board and the
    // arena floor, which is exactly where their board lands on them. Drawn
    // through the rubble it reads as a rendering fault, and the game is over
    // anyway — the result card is a second away.
    var crushed = s.crush && s.crush.side;
    if (crushed !== "player") {
      ctx.fillText("score " + s.player.score, L.player.x + L.boardW / 2, L.player.y + L.boardH + 15);
    }
    if (crushed !== "foe") {
      ctx.fillText("score " + s.foe.score, L.foe.x + L.boardW / 2, L.foe.y + L.boardH + 15);
    }
    if (s.firstTo > 1) {
      ctx.fillStyle = "#ffd166";
      ctx.fillText(s.wins.player + " — " + s.wins.foe + "   (first to " + s.firstTo + ")",
                   L.w / 2, L.player.y - 10);
    }

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
    // Headless tests need to reach into the live stacks (to top a board out
    // without playing five real games, say). Not for game code to use.
    raw: function () { return state; },
    debug: function () {
      if (!state) return null;
      return {
        countdown: state.countdown,
        over: state.over,
        firstTo: state.firstTo,
        wins: { player: state.wins.player, foe: state.wins.foe },
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
        // What the crush is made of, so a check can assert it is the BOARD
        // coming down rather than a handful of anonymous slabs.
        crush: state.crush && {
          side: state.crush.side, t: state.crush.t,
          panels: state.crush.blocks.filter(function (p) { return !p.slab; }).length,
          slabs: state.crush.blocks.filter(function (p) { return !!p.slab; }).length,
          moving: state.crush.moving,
          contacts: state.crush.contacts,
          restAt: state.crush.restAt,
          ground: state.crush.ground,
          // Every block's size and where it is, so a check can assert they
          // never shrink, never rise, and never come to rest in mid-air.
          sizes: state.crush.blocks.map(function (p) { return p.w; }),
          tops: state.crush.blocks.map(function (p) { return Math.round(p.y); }),
          bots: state.crush.blocks.map(function (p) { return Math.round(p.y + p.h); }),
          colors: state.crush.blocks.filter(function (p) { return !p.slab; })
                       .map(function (p) { return p.color; }),
          // When each one starts falling, in board order, so a check can see
          // that the collapse is SCATTERED rather than a tidy top-down wave.
          delays: state.crush.blocks.filter(function (p) { return !p.slab; })
                       .map(function (p) { return p.release; })
        },
        autoplay: function (difficulty) {
          state.autopilot = makeCpu(state.player, difficulty || "brutal", 99);
        }
      };
    }
  };
})();
