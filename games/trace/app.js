// app.js — rendering + input for "Step in the Cat" (Trap the Cat with
// differentiated pins). engine.js holds the rules; this file draws the hex
// board + your hand of pins, and turns "pick a pin, tap a step" into an
// Engine.placePin() call. GCStorage keeps the best trap and win count.
"use strict";

(function () {
  const GAME_ID = "trace";
  const Engine = window.StepCatEngine;

  const CAT_IMG = "icons/cat.png";
  // Each pin type is one of the enamel sprites, with a name + one-line hint.
  const PIN_META = {
    wall: { img: "icons/pin-paw.png", name: "Wall", hint: "Blocks one step." },
    snare: { img: "icons/pin-star.png", name: "Snare", hint: "Blocks a step; stuns the cat if it's right next to it." },
    lure: { img: "icons/pin-fish.png", name: "Lure", hint: "No wall — the cat chases the fish next move. Bait it into a corner." },
    tangle: { img: "icons/pin-yarn.png", name: "Tangle", hint: "Blocks a step AND its neighbours for the cat's next move only." },
    boulder: { img: "icons/pin-avocado.png", name: "Boulder", hint: "Blocks a step and one next to it at once." },
  };
  // Walls placed on the board cycle through the sprites for variety.
  const WALL_SPRITES = Object.values(PIN_META).map((m) => m.img);
  function wallSpriteFor(r, c) {
    return WALL_SPRITES[(r * 7 + c * 3) % WALL_SPRITES.length];
  }

  const boardEl = document.getElementById("board");
  const pinsValueEl = document.getElementById("pinsValue");
  const bestValueEl = document.getElementById("bestValue");
  const winsValueEl = document.getElementById("winsValue");
  const tickerEl = document.getElementById("ticker");
  const pinHintEl = document.getElementById("pinHint");
  const pinHandEl = document.getElementById("pinHand");
  const overlayEl = document.getElementById("runOverlay");
  const overlayTitleEl = document.getElementById("overlayTitle");
  const overlayBodyEl = document.getElementById("overlayBody");
  const restartBtn = document.getElementById("restartBtn");

  let state = null;
  let selected = 0; // which hand slot is armed
  let bestTrap = GCStorage.get(GAME_ID, "bestTrap", 0);
  let wins = GCStorage.get(GAME_ID, "wins", 0);

  function rng() {
    return (window.__scRng || Math.random)();
  }

  function newGame() {
    state = Engine.createGame(rng);
    selected = 0;
    overlayEl.hidden = true;
    render();
  }

  function onTap(r, c) {
    if (!state || state.status !== "playing") return;
    if (!Engine.isPlaceable(state, r, c)) return;
    const before = state.status;
    Engine.placePin(state, r, c, selected, rng);
    if (selected >= state.hand.length) selected = 0;
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
          cell.innerHTML = `<img class="hex-img pin" src="${wallSpriteFor(r, c)}" alt="wall" draggable="false" />`;
        } else {
          cell.addEventListener("click", () => onTap(r, c));
        }
        row.appendChild(cell);
      }
      boardEl.appendChild(row);
    }

    renderHand();
  }

  function renderHand() {
    pinHandEl.innerHTML = "";
    state.hand.forEach((type, i) => {
      const meta = PIN_META[type];
      const btn = document.createElement("button");
      btn.className = "pin-slot" + (i === selected ? " pin-slot-sel" : "");
      btn.disabled = state.status !== "playing";
      btn.innerHTML =
        `<img src="${meta.img}" alt="${meta.name}" draggable="false" />` + `<span class="pin-slot-name">${meta.name}</span>`;
      btn.addEventListener("click", () => {
        selected = i;
        render();
      });
      pinHandEl.appendChild(btn);
    });
    const sel = state.hand[selected];
    pinHintEl.textContent = sel ? PIN_META[sel].name + " — " + PIN_META[sel].hint : "";
  }

  function showOverlay() {
    if (state.status === "won") {
      overlayTitleEl.textContent = "Trapped it! 🐾";
      overlayBodyEl.textContent = `You fenced the cat in with ${state.pinsUsed} pins.` + (bestTrap ? ` Best: ${bestTrap}.` : "");
    } else {
      overlayTitleEl.textContent = "It got away!";
      overlayBodyEl.textContent = "The cat reached the edge and slipped out. Lure it into a dead end, then seal it.";
    }
    overlayEl.hidden = false;
  }

  restartBtn.addEventListener("click", newGame);
  window.addEventListener("resize", () => {
    if (state) render();
  });
  newGame();
})();
