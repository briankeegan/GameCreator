// app.js — rendering + input for "Step in the Cat", the pin-draft duel.
// engine.js holds the rules; this file draws the spread + collections and
// turns a tap on a pin into an Engine.draft() call. GCStorage persists the
// best score and win count.
"use strict";

(function () {
  const GAME_ID = "trace";
  const Engine = window.StepCatEngine;

  const PIN_IMG = {
    avocado: "icons/pin-avocado.png",
    star: "icons/pin-star.png",
    paw: "icons/pin-paw.png",
    fish: "icons/pin-fish.png",
    yarn: "icons/pin-yarn.png",
  };
  const PIN_NAME = { avocado: "Avocado", star: "Star", paw: "Paw", fish: "Fish", yarn: "Yarn" };

  const youScoreEl = document.getElementById("youScore");
  const catScoreEl = document.getElementById("catScore");
  const wakeValueEl = document.getElementById("wakeValue");
  const bestLineEl = document.getElementById("bestLine");
  const displayEl = document.getElementById("display");
  const youPinsEl = document.getElementById("youPins");
  const catPinsEl = document.getElementById("catPins");
  const tickerEl = document.getElementById("ticker");
  const sleepingCatEl = document.getElementById("sleepingCat");
  const zzzEl = document.querySelector(".zzz");
  const overlayEl = document.getElementById("runOverlay");
  const overlayTitleEl = document.getElementById("overlayTitle");
  const overlayBodyEl = document.getElementById("overlayBody");
  const restartBtn = document.getElementById("restartBtn");

  let state = null;
  let bestScore = GCStorage.get(GAME_ID, "bestScore", 0);
  let wins = GCStorage.get(GAME_ID, "wins", 0);

  function rng() {
    return (window.__scRng || Math.random)();
  }

  function newGame() {
    state = Engine.createGame(rng);
    overlayEl.hidden = true;
    sleepingCatEl.classList.remove("awake");
    render();
  }

  function pinChip(type, count, extraClass) {
    // A collection chip: the pin sprite, a ×count badge, and the set's
    // current point value so the triangular scoring is legible.
    const val = Engine.tri(count);
    return (
      `<span class="chip ${extraClass || ""}">` +
      `<img src="${PIN_IMG[type]}" alt="${PIN_NAME[type]}" draggable="false" />` +
      `<span class="chip-count">×${count}</span>` +
      `<span class="chip-val">${val}</span>` +
      `</span>`
    );
  }

  function renderTray(el, collection, lastPick) {
    const owned = Engine.PIN_TYPES.filter((t) => collection[t] > 0);
    if (owned.length === 0) {
      el.innerHTML = '<span class="tray-empty">—</span>';
      return;
    }
    el.innerHTML = owned
      .map((t) => pinChip(t, collection[t], lastPick && lastPick.type === t ? "chip-fresh" : ""))
      .join("");
  }

  function render() {
    window.__scState = state; // exposed for tests

    youScoreEl.textContent = Engine.score(state.you);
    catScoreEl.textContent = Engine.score(state.cat);
    bestLineEl.textContent = `Best ${bestScore}`;

    const hasCatPin = state.status === "playing" && state.display.length > 0 && state.display[0].onCat;
    wakeValueEl.textContent = hasCatPin ? Math.round(Engine.nextWakeRisk(state) * 100) + "%" : "—";

    tickerEl.textContent = state.message || "";

    const woke = state.woke;
    sleepingCatEl.classList.toggle("awake", woke);
    if (zzzEl) zzzEl.style.visibility = woke ? "hidden" : "visible";

    // The spread of draftable pins. The front pin sits on the cat (×2).
    displayEl.innerHTML = "";
    state.display.forEach((pin, i) => {
      const btn = document.createElement("button");
      btn.className = "pin-card" + (pin.onCat ? " on-cat" : "");
      btn.disabled = state.status !== "playing";
      btn.innerHTML =
        `<img src="${PIN_IMG[pin.type]}" alt="${PIN_NAME[pin.type]}" draggable="false" />` +
        (pin.onCat ? '<span class="dbl-badge">×2</span><span class="oncat-tag">on the cat</span>' : "");
      btn.addEventListener("click", () => onDraft(i));
      displayEl.appendChild(btn);
    });
    if (state.display.length === 0) {
      displayEl.innerHTML = '<span class="display-empty">The pins are gone.</span>';
    }

    renderTray(youPinsEl, state.you, state.lastYou);
    renderTray(catPinsEl, state.cat, state.lastCat);

    if (state.status === "over") showOverlay();
  }

  function onDraft(index) {
    if (!state || state.status !== "playing") return;
    Engine.draft(state, index, rng);
    if (state.status === "over") saveBest();
    render();
  }

  function saveBest() {
    const ys = Engine.score(state.you);
    if (ys > bestScore) {
      bestScore = ys;
      GCStorage.set(GAME_ID, "bestScore", bestScore);
    }
    if (state.result === "you") {
      wins += 1;
      GCStorage.set(GAME_ID, "wins", wins);
    }
  }

  function showOverlay() {
    const ys = state.youScore;
    const cs = state.catScore;
    let title;
    if (state.woke && state.result === "you") title = "You woke the cat — and still won!";
    else if (state.woke) title = "You woke the cat!";
    else if (state.result === "you") title = "You win! 🏆";
    else if (state.result === "cat") title = "The cat wins!";
    else title = "It's a tie!";
    overlayTitleEl.textContent = title;
    overlayBodyEl.textContent = `You ${ys} — Cat ${cs}.  Best ${bestScore}, wins ${wins}.`;
    overlayEl.hidden = false;
  }

  restartBtn.addEventListener("click", newGame);
  newGame();
})();
