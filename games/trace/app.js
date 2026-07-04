// app.js — rendering + input for "Step in the Cat" (Trap the Cat).
// engine.js holds the rules; this file draws the hex board and turns a tap
// on an open step into an Engine.placePin() call. GCStorage keeps the best
// trap (fewest pins) and the win count.
"use strict";

(function () {
  const GAME_ID = "trace";
  const Engine = window.StepCatEngine;

  const CAT_IMG = "icons/cat.png";
  const PIN_IMGS = [
    "icons/pin-avocado.png",
    "icons/pin-star.png",
    "icons/pin-paw.png",
    "icons/pin-fish.png",
    "icons/pin-yarn.png",
  ];
  // A stable, scattered-looking pin sprite per cell so the walls have
  // variety without flickering between renders.
  function pinImgFor(r, c) {
    return PIN_IMGS[(r * 7 + c * 3) % PIN_IMGS.length];
  }

  const boardEl = document.getElementById("board");
  const pinsValueEl = document.getElementById("pinsValue");
  const bestValueEl = document.getElementById("bestValue");
  const winsValueEl = document.getElementById("winsValue");
  const tickerEl = document.getElementById("ticker");
  const overlayEl = document.getElementById("runOverlay");
  const overlayTitleEl = document.getElementById("overlayTitle");
  const overlayBodyEl = document.getElementById("overlayBody");
  const restartBtn = document.getElementById("restartBtn");

  let state = null;
  let bestTrap = GCStorage.get(GAME_ID, "bestTrap", 0); // fewest pins to trap (0 = none yet)
  let wins = GCStorage.get(GAME_ID, "wins", 0);

  function rng() {
    return (window.__scRng || Math.random)();
  }

  function newGame() {
    state = Engine.createGame(rng);
    overlayEl.hidden = true;
    render();
  }

  function onTap(r, c) {
    if (!state || state.status !== "playing") return;
    const before = state.status;
    Engine.placePin(state, r, c);
    render();
    if (before === "playing" && state.status !== "playing") finishRun();
  }

  function finishRun() {
    if (state.status === "won") {
      wins += 1;
      GCStorage.set(GAME_ID, "wins", wins);
      if (bestTrap === 0 || state.pinsUsed < bestTrap) {
        bestTrap = state.pinsUsed;
        GCStorage.set(GAME_ID, "bestTrap", bestTrap);
      }
    }
    showOverlay();
  }

  function sizeHex() {
    const availW = boardEl.parentElement.clientWidth;
    // W + 0.5 columns wide (odd rows are offset by half a hex).
    const hexW = Math.max(24, Math.floor((availW - 4) / (state.W + 0.5)));
    boardEl.style.setProperty("--hex-w", hexW + "px");
  }

  function render() {
    window.__scState = state; // exposed for tests

    pinsValueEl.textContent = state.pinsUsed;
    bestValueEl.textContent = bestTrap > 0 ? bestTrap : "—";
    winsValueEl.textContent = wins;
    tickerEl.textContent = state.message || "";

    sizeHex();
    boardEl.innerHTML = "";
    for (let r = 0; r < state.H; r++) {
      const row = document.createElement("div");
      row.className = "hex-row" + (r % 2 === 1 ? " hex-row-odd" : "");
      for (let c = 0; c < state.W; c++) {
        const isCat = state.cat.r === r && state.cat.c === c;
        const isPin = state.pins.has(Engine.keyOf(r, c));
        const edge = Engine.isEdge(r, c);
        const cell = document.createElement("button");
        cell.className =
          "hex" + (isCat ? " hex-cat" : isPin ? " hex-pin" : " hex-open") + (edge && !isCat && !isPin ? " hex-edge" : "");
        cell.disabled = isCat || isPin || state.status !== "playing";
        if (isCat) {
          cell.innerHTML = `<img class="hex-img cat" src="${CAT_IMG}" alt="cat" draggable="false" />`;
        } else if (isPin) {
          cell.innerHTML = `<img class="hex-img pin" src="${pinImgFor(r, c)}" alt="pin" draggable="false" />`;
        } else {
          cell.addEventListener("click", () => onTap(r, c));
        }
        row.appendChild(cell);
      }
      boardEl.appendChild(row);
    }
  }

  function showOverlay() {
    if (state.status === "won") {
      overlayTitleEl.textContent = "Trapped it! 🐾";
      overlayBodyEl.textContent = `You fenced the cat in with ${state.pinsUsed} pins.` + (bestTrap ? ` Best: ${bestTrap}.` : "");
    } else {
      overlayTitleEl.textContent = "It got away!";
      overlayBodyEl.textContent = "The cat reached the edge and slipped out. Try cutting off its exit sooner.";
    }
    overlayEl.hidden = false;
  }

  restartBtn.addEventListener("click", newGame);
  window.addEventListener("resize", () => {
    if (state) render();
  });
  newGame();
})();
