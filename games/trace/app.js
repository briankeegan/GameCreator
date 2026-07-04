// app.js — rendering + input for "Step in the Cat". engine.js holds the
// rules; this file only draws state onto a grid and turns taps / d-pad /
// arrow keys into Engine.move() calls. GCStorage persists the best run.
"use strict";

(function () {
  const GAME_ID = "trace";
  const Engine = window.StepCatEngine;

  const PIN_IMG = {
    avocado: "icons/pin-avocado.png",
    star: "icons/pin-star.png",
    paw: "icons/pin-paw.png",
  };
  const CAT_IMG = "icons/cat.png";
  const PLAYER_IMG = "icons/player.png";

  // A door for the exit and a paw for the cat's telegraph — the only two
  // bits of UI that aren't generated art, kept as crisp inline SVG.
  const DOOR_SVG =
    '<svg class="door" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17" fill="#3b2a1e" stroke="#c9a26a" stroke-width="1.4"/><rect x="7" y="5" width="10" height="15" rx="1" fill="#5a3d28"/><circle cx="15" cy="13" r="1" fill="#f0c674"/></svg>';
  const PAW_SVG =
    '<svg class="paw" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="15" rx="5" ry="4"/><ellipse cx="6" cy="9" rx="2" ry="2.6"/><ellipse cx="12" cy="6.5" rx="2.2" ry="2.8"/><ellipse cx="18" cy="9" rx="2" ry="2.6"/></svg>';

  const boardEl = document.getElementById("board");
  const levelFlashEl = document.getElementById("levelFlash");
  const levelValueEl = document.getElementById("levelValue");
  const pinsValueEl = document.getElementById("pinsValue");
  const scoreValueEl = document.getElementById("scoreValue");
  const bestValueEl = document.getElementById("bestValue");
  const tickerEl = document.getElementById("ticker");
  const overlayEl = document.getElementById("runOverlay");
  const overlayTitleEl = document.getElementById("overlayTitle");
  const overlayBodyEl = document.getElementById("overlayBody");
  const restartBtn = document.getElementById("restartBtn");

  let state = null;
  let bestScore = GCStorage.get(GAME_ID, "bestScore", 0);
  let bestLevel = GCStorage.get(GAME_ID, "bestLevel", 1);

  // Tests pin window.__scRng to a fixed generator for reproducible runs.
  function rng() {
    return (window.__scRng || Math.random)();
  }

  function newRun() {
    state = Engine.createGame(rng);
    overlayEl.hidden = true;
    render();
  }

  function cellKey(r, c) {
    return r + "," + c;
  }

  // Fit the whole board in the space between the ticker and the controls,
  // sizing square cells to the tighter of the width/height budget so even a
  // 10-row late level shows entirely without scrolling.
  const GAP = 3;
  function sizeBoard() {
    if (!state) return;
    const wrap = boardEl.parentElement;
    const availW = wrap.clientWidth;
    const availH = wrap.clientHeight;
    if (!availW || !availH) return;
    const cw = (availW - GAP * (state.W - 1)) / state.W;
    const ch = (availH - GAP * (state.H - 1)) / state.H;
    const cell = Math.max(24, Math.floor(Math.min(cw, ch)));
    boardEl.style.setProperty("--cell", cell + "px");
  }
  window.addEventListener("resize", () => {
    if (state) render();
  });

  function doMove(dir) {
    if (!state || state.status !== "playing") return;
    Engine.move(state, dir, rng);

    if (state.justAdvanced) flashLevel();
    render();

    saveBest();
    if (state.status === "lost") {
      shake();
      showOverlay();
    }
  }

  function saveBest() {
    if (state.score > bestScore) {
      bestScore = state.score;
      GCStorage.set(GAME_ID, "bestScore", bestScore);
    }
    if (state.level > bestLevel) {
      bestLevel = state.level;
      GCStorage.set(GAME_ID, "bestLevel", bestLevel);
    }
  }

  function flashLevel() {
    levelFlashEl.textContent = "Level " + state.level;
    levelFlashEl.hidden = false;
    levelFlashEl.classList.remove("show");
    void levelFlashEl.offsetWidth;
    levelFlashEl.classList.add("show");
    setTimeout(() => {
      levelFlashEl.hidden = true;
    }, 900);
  }

  function shake() {
    boardEl.classList.remove("shake");
    void boardEl.offsetWidth;
    boardEl.classList.add("shake");
    setTimeout(() => boardEl.classList.remove("shake"), 450);
  }

  function showOverlay() {
    overlayTitleEl.textContent = state.message || "Caught!";
    overlayBodyEl.textContent = `You reached Level ${state.level} and scored ${state.score}. Best: ${bestScore}.`;
    overlayEl.hidden = false;
  }

  function render() {
    window.__scState = state; // exposed for tests

    levelValueEl.textContent = state.level;
    pinsValueEl.textContent = `${state.collected}/${state.pinTarget}`;
    scoreValueEl.textContent = state.score;
    bestValueEl.textContent = bestScore;
    tickerEl.textContent = state.message || "";

    boardEl.style.setProperty("--cols", state.W);
    boardEl.style.setProperty("--rows", state.H);
    sizeBoard();

    // Index everything by cell for a single pass over the grid.
    const telegraph = new Set(state.cats.map((c) => cellKey(c.next.r, c.next.c)));
    const catCells = new Map(state.cats.map((c) => [cellKey(c.r, c.c), c]));
    const pinCells = new Map(state.pins.map((p) => [cellKey(p.r, p.c), p]));

    boardEl.innerHTML = "";
    for (let r = 0; r < state.H; r++) {
      for (let c = 0; c < state.W; c++) {
        const key = cellKey(r, c);
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.r = r;
        cell.dataset.c = c;
        if ((r + c) % 2 === 0) cell.classList.add("cell-alt");
        if (r === state.exit.r && c === state.exit.c) cell.classList.add("cell-exit");
        if (telegraph.has(key)) cell.classList.add("cell-telegraph");

        let html = "";
        if (r === state.exit.r && c === state.exit.c) html += DOOR_SVG;
        if (telegraph.has(key)) html += `<span class="telegraph">${PAW_SVG}</span>`;
        const pin = pinCells.get(key);
        if (pin) html += `<img class="tok pin" src="${PIN_IMG[pin.type]}" alt="${pin.type} pin" draggable="false" />`;
        const isPlayer = r === state.player.r && c === state.player.c;
        if (isPlayer) html += `<img class="tok player" src="${PLAYER_IMG}" alt="you" draggable="false" />`;
        if (catCells.has(key)) html += `<img class="tok cat" src="${CAT_IMG}" alt="cat" draggable="false" />`;
        cell.innerHTML = html;

        cell.addEventListener("click", () => onCellTap(r, c));
        boardEl.appendChild(cell);
      }
    }
  }

  // Tap an orthogonally-adjacent step to move there; tap your own step to
  // wait. Anything further is ignored.
  function onCellTap(r, c) {
    if (!state || state.status !== "playing") return;
    const dr = r - state.player.r;
    const dc = c - state.player.c;
    if (dr === 0 && dc === 0) return doMove("wait");
    if (dr === -1 && dc === 0) return doMove("up");
    if (dr === 1 && dc === 0) return doMove("down");
    if (dr === 0 && dc === -1) return doMove("left");
    if (dr === 0 && dc === 1) return doMove("right");
  }

  // ---- input: d-pad, keyboard, swipe -----------------------------------
  document.getElementById("btnUp").addEventListener("click", () => doMove("up"));
  document.getElementById("btnDown").addEventListener("click", () => doMove("down"));
  document.getElementById("btnLeft").addEventListener("click", () => doMove("left"));
  document.getElementById("btnRight").addEventListener("click", () => doMove("right"));
  document.getElementById("btnWait").addEventListener("click", () => doMove("wait"));
  restartBtn.addEventListener("click", newRun);

  document.addEventListener("keydown", (e) => {
    const map = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      s: "down",
      a: "left",
      d: "right",
      " ": "wait",
    };
    const dir = map[e.key];
    if (dir) {
      e.preventDefault();
      doMove(dir);
    }
  });

  let touchStart = null;
  boardEl.addEventListener(
    "touchstart",
    (e) => {
      const t = e.changedTouches[0];
      touchStart = { x: t.clientX, y: t.clientY };
    },
    { passive: true }
  );
  boardEl.addEventListener(
    "touchend",
    (e) => {
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return; // a tap — let the cell handler run
      if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? "right" : "left");
      else doMove(dy > 0 ? "down" : "up");
    },
    { passive: true }
  );

  newRun();
})();
