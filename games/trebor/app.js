// app.js — rendering + touch input for TREEBOAR. engine.js/content.js hold
// all the rules and data; this file only draws state and turns taps into
// Engine calls. GCStorage (loaded before this file) persists best-room.
"use strict";

(function () {
  const GAME_ID = "trebor";
  const Engine = window.TreeboarEngine;
  const Content = window.TreeboarContent;

  const roomLabelEl = document.getElementById("roomLabel");
  const bestLabelEl = document.getElementById("bestLabel");
  const objectiveEl = document.getElementById("objective");
  const dogHpFillEl = document.getElementById("dogHpFill");
  const dogHpTextEl = document.getElementById("dogHpText");
  const dogBlockChipEl = document.getElementById("dogBlockChip");
  const dogBlockValueEl = document.getElementById("dogBlockValue");
  const energyPipsEl = document.getElementById("energyPips");
  const battlefieldEl = document.getElementById("battlefield");
  const handEl = document.getElementById("hand");
  const endTurnBtn = document.getElementById("endTurnBtn");
  const overlayEl = document.getElementById("runOverlay");
  const overlayTitleEl = document.getElementById("runOverlayTitle");
  const overlayBodyEl = document.getElementById("runOverlayBody");
  const nextBtn = document.getElementById("nextBtn");
  const restartBtn = document.getElementById("restartBtn");

  let state = null;
  let selectedHandIndex = null; // hand index currently armed, awaiting an enemy tap
  let bestRoom = GCStorage.get(GAME_ID, "bestRoom", 0);

  // Tests can pin window.__tbRng to a fixed generator (via addInitScript,
  // before this file runs) for a fully reproducible run; real play always
  // falls through to Math.random.
  function rng() {
    return (window.__tbRng || Math.random)();
  }

  function newRun() {
    state = Engine.createGameState(Content, rng);
    selectedHandIndex = null;
    overlayEl.hidden = true;
    render();
  }

  function saveBest() {
    if (state.roomIndex > bestRoom) {
      bestRoom = state.roomIndex;
      GCStorage.set(GAME_ID, "bestRoom", bestRoom);
    }
  }

  function onCardTap(handIndex) {
    if (!state || state.status !== "playing") return;
    const cardId = state.hand[handIndex];
    const card = Content.CARDS[cardId];
    if (state.player.energy < card.cost) return;

    if (!Engine.cardNeedsTarget(card)) {
      commitPlay(handIndex, null);
      return;
    }

    const living = Engine.livingEnemies(state);
    if (living.length === 1) {
      commitPlay(handIndex, living[0].id);
      return;
    }

    selectedHandIndex = selectedHandIndex === handIndex ? null : handIndex;
    render();
  }

  function onEnemyTap(enemyId) {
    if (selectedHandIndex === null) return;
    commitPlay(selectedHandIndex, enemyId);
  }

  function commitPlay(handIndex, targetId) {
    try {
      Engine.playCard(state, Content, handIndex, targetId, rng);
    } catch (err) {
      return; // UI already gates legality; a thrown error just means "no-op"
    }
    selectedHandIndex = null;
    render();
  }

  function endTurn() {
    if (!state || state.status !== "playing") return;
    Engine.endPlayerTurn(state, Content, rng);
    selectedHandIndex = null;
    render();
  }

  function advance() {
    Engine.advanceRoom(state, Content, rng);
    overlayEl.hidden = true;
    render();
  }

  function cardNode(cardId, handIndex) {
    const card = Content.CARDS[cardId];
    const el = document.createElement("button");
    el.type = "button";
    el.className = "card";
    if (Engine.cardNeedsTarget(card)) el.classList.add("card-attack");
    if (state.player.energy < card.cost) el.classList.add("card-disabled");
    if (selectedHandIndex === handIndex) el.classList.add("card-selected");
    el.innerHTML = `
      <span class="card-cost">${card.cost}</span>
      <span class="card-name">${card.name}</span>
      <span class="card-text">${card.text}</span>
    `;
    el.addEventListener("click", () => onCardTap(handIndex));
    return el;
  }

  function enemyNode(enemy) {
    const el = document.createElement("div");
    el.className = "enemy";
    el.dataset.enemyId = enemy.id;
    if (enemy.hp <= 0) el.classList.add("enemy-dead");
    if (selectedHandIndex !== null && enemy.hp > 0) el.classList.add("enemy-targetable");

    const intentText = enemy.hp > 0 ? Engine.describeIntent(enemy.currentIntent) : "Defeated";
    const intentIcon = enemy.hp > 0 && enemy.currentIntent.type === "attack" ? "⚔️" : "🛡️";

    el.innerHTML = `
      <span class="enemy-intent">${enemy.hp > 0 ? intentIcon + " " + intentText : ""}</span>
      <span class="enemy-portrait">${enemy.emoji}</span>
      <span class="enemy-name">${enemy.name}</span>
      <div class="hp-bar hp-bar-small"><div class="hp-fill" style="width:${Math.max(0, (enemy.hp / enemy.maxHp) * 100)}%"></div></div>
      <span class="enemy-hp-text">${Math.max(0, enemy.hp)}/${enemy.maxHp}${enemy.block > 0 ? " · 🛡️" + enemy.block : ""}</span>
    `;
    el.addEventListener("click", () => onEnemyTap(enemy.id));
    return el;
  }

  function render() {
    // Clearing the last room has no "Next Room" step to tap through — go
    // straight to victory instead of stalling on a room-clear screen with
    // no button that could ever get it there.
    if (state.status === "room-clear" && state.roomIndex === Content.ROOMS.length - 1) {
      Engine.advanceRoom(state, Content, rng);
    }

    window.__tbState = state; // exposed for tests

    const room = Content.ROOMS[Math.min(state.roomIndex, Content.ROOMS.length - 1)];
    roomLabelEl.textContent = `Room ${Math.min(state.roomIndex + 1, Content.ROOMS.length)} · ${room.name}`;
    bestLabelEl.textContent = bestRoom > 0 ? `Best: Room ${bestRoom}` : "";

    const hpPct = Math.max(0, (state.player.hp / state.player.maxHp) * 100);
    dogHpFillEl.style.width = `${hpPct}%`;
    dogHpTextEl.textContent = `${Math.max(0, state.player.hp)}/${state.player.maxHp}`;
    dogBlockChipEl.hidden = state.player.block <= 0;
    dogBlockValueEl.textContent = state.player.block;

    energyPipsEl.innerHTML = "";
    for (let i = 0; i < state.player.maxEnergy; i++) {
      const pip = document.createElement("span");
      pip.className = "energy-pip" + (i < state.player.energy ? " energy-pip-full" : "");
      energyPipsEl.appendChild(pip);
    }

    if (state.status === "playing") {
      const living = Engine.livingEnemies(state);
      objectiveEl.textContent =
        selectedHandIndex !== null
          ? "Tap a cat to aim it."
          : `Defeat ${living.map((e) => e.name).join(" and ")}${living.length > 1 ? "" : " " + living[0].emoji}.`;
    } else {
      objectiveEl.textContent = "";
    }

    battlefieldEl.innerHTML = "";
    for (const enemy of state.enemies) battlefieldEl.appendChild(enemyNode(enemy));

    handEl.innerHTML = "";
    state.hand.forEach((cardId, i) => handEl.appendChild(cardNode(cardId, i)));

    endTurnBtn.disabled = state.status !== "playing";

    if (state.status === "room-clear") {
      saveBest();
      showOverlay("Room Cleared! 🐾", "Good dog! On to the next room.", true);
    } else if (state.status === "victory") {
      saveBest();
      showOverlay("Victory! 🏆", "You cleared the whole dungeon. TREEBOAR is yours.", false);
    } else if (state.status === "lost") {
      saveBest();
      showOverlay("Good Boy, Down 🐾", `You made it to Room ${state.roomIndex + 1}.`, false);
    } else {
      overlayEl.hidden = true;
    }
  }

  function showOverlay(title, body, showNext) {
    overlayTitleEl.textContent = title;
    overlayBodyEl.textContent = body;
    nextBtn.hidden = !showNext;
    overlayEl.hidden = false;
  }

  endTurnBtn.addEventListener("click", endTurn);
  nextBtn.addEventListener("click", advance);
  restartBtn.addEventListener("click", newRun);

  newRun();
})();
