// app.js — rendering + touch input for TREEBOAR. engine.js/content.js hold
// all the rules and data; this file only draws state and turns taps into
// Engine calls. GCStorage (loaded before this file) persists best-floor.
"use strict";

(function () {
  const GAME_ID = "trebor";
  const Engine = window.TreeboarEngine;
  const Content = window.TreeboarContent;

  // Every icon in the game — cards, node choices, portraits, intents — is
  // hand-drawn inline SVG (stroke/fill: currentColor so CSS themes each
  // one). No emoji anywhere.
  const CARD_ICONS = {
    claw: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 4 L10 20"/><path d="M9 3 L15 21"/><path d="M14 4 L20 18"/></svg>',
    burst:
      '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M12 2 L14 9 L21 7 L15.5 12 L21 17 L14 15 L12 22 L10 15 L3 17 L8.5 12 L3 7 L10 9 Z"/></svg>',
    shield:
      '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 3 L19 6 V11 C19 16 16 19.5 12 21 C8 19.5 5 16 5 11 V6 Z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M13 2 L4 14 H11 L10 22 L20 9 H13 Z"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10" cy="10" r="6"/><path d="M15 15 L21 21"/></svg>',
  };

  function cardIconKey(card) {
    if (card.aoe) return "burst";
    if (card.damage) return "claw";
    if (card.block) return "shield";
    if (card.energy) return "bolt";
    if (card.draw) return "search";
    return "claw";
  }

  const NODE_ICON = {
    fight:
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 L18 6 M14 6 H18 V10"/><path d="M20 20 L6 6 M10 6 H6 V10"/></svg>',
    elite:
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 2 C6.5 2 3 6 3 11 C3 14 4.5 16.3 6 17.5 V20 H9 V18 H11 V20 H13 V18 H15 V20 H18 V17.5 C19.5 16.3 21 14 21 11 C21 6 17.5 2 12 2 Z"/><circle cx="8.5" cy="11" r="2" fill="#170e0c"/><circle cx="15.5" cy="11" r="2" fill="#170e0c"/></svg>',
    rest: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 2 C12 6 8 8 8 13 C8 17 10 20 12 22 C14 20 16 17 16 13 C16 10 14 9 14 6 C14 9 12 9 12 6 C12 4 12 3 12 2 Z"/></svg>',
    treasure:
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M3 9 H21 V20 H3 Z"/><path d="M4 9 C4 5 8 3 12 3 C16 3 20 5 20 9" fill="none" stroke="currentColor" stroke-width="2"/><rect x="10.5" y="7" width="3" height="6" rx="1" fill="#170e0c"/></svg>',
  };

  // Intent icons — the attack/guard telegraph above an enemy showing exactly
  // what it's about to do next turn (this has driven the "no surprise hits"
  // rule since the very first version; the icons themselves used to be
  // emoji, now they're drawn).
  const INTENT_ICON = {
    attack:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 19 L17 7 M13 7 H17 V11"/></svg>',
    guard:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M12 3 L19 6 V11 C19 16 16 19.5 12 21 C8 19.5 5 16 5 11 V6 Z"/></svg>',
  };

  // ---- character art: generated PNG sprites (via the "Generate game asset"
  // workflow), rendered as <img>. The roster IS the generated set — no
  // hand-drawn fallback. Enemy files keyed by type id, dog files by class id.
  const ENEMY_IMG = {
    alleyCat: "icons/enemy-alley-cat.png",
    tabbyGuard: "icons/enemy-tabby-guard.png",
    bigTom: "icons/enemy-big-tom.png",
    feralKitten: "icons/enemy-feral-kitten.png",
    rooftopSniper: "icons/enemy-rooftop-sniper.png",
    warcatCaptain: "icons/enemy-warcat-captain.png",
    catKing: "icons/enemy-cat-king.png",
  };
  const DOG_IMG = {
    riddle: "icons/dog-riddle.png",
    koozie: "icons/dog-koozie.png",
    bevy: "icons/dog-bevy.png",
    lala: "icons/dog-lala.png",
  };
  function enemyImg(typeId) {
    return `<img class="sprite-img" src="${ENEMY_IMG[typeId]}" alt="" draggable="false" />`;
  }
  function dogImg(classId) {
    return `<img class="sprite-img" src="${DOG_IMG[classId]}" alt="" draggable="false" />`;
  }

  const gameAreaEl = document.getElementById("gameArea");
  const roomLabelEl = document.getElementById("roomLabel");
  const bestLabelEl = document.getElementById("bestLabel");
  const objectiveEl = document.getElementById("objective");
  const dogPortraitEl = document.getElementById("dogPortrait");
  const dogHpFillEl = document.getElementById("dogHpFill");
  const dogHpTextEl = document.getElementById("dogHpText");
  const dogBlockChipEl = document.getElementById("dogBlockChip");
  const dogBlockIconEl = document.getElementById("dogBlockIcon");
  const dogBlockValueEl = document.getElementById("dogBlockValue");
  dogBlockIconEl.innerHTML = CARD_ICONS.shield; // the HUD dog portrait is set per chosen class in render()
  const hudEl = document.getElementById("hud");
  const classSelectEl = document.getElementById("classSelect");
  const classOptionsEl = document.getElementById("classOptions");
  const energyPipsEl = document.getElementById("energyPips");
  const nodeChoiceEl = document.getElementById("nodeChoice");
  const nodeOptionsEl = document.getElementById("nodeOptions");
  const rewardScreenEl = document.getElementById("rewardScreen");
  const rewardOptionsEl = document.getElementById("rewardOptions");
  const skipRewardBtn = document.getElementById("skipRewardBtn");
  const bossRewardScreenEl = document.getElementById("bossRewardScreen");
  const bossRewardTitleEl = document.getElementById("bossRewardTitle");
  const bossRewardOptionsEl = document.getElementById("bossRewardOptions");
  const skipBossRewardBtn = document.getElementById("skipBossRewardBtn");
  const battlefieldEl = document.getElementById("battlefield");
  const consoleEl = document.getElementById("combatConsole");
  const handEl = document.getElementById("hand");
  const endTurnBtn = document.getElementById("endTurnBtn");
  const overlayEl = document.getElementById("runOverlay");
  const overlayTitleEl = document.getElementById("runOverlayTitle");
  const overlayBodyEl = document.getElementById("runOverlayBody");
  const restartBtn = document.getElementById("restartBtn");
  const deckBtn = document.getElementById("deckBtn");
  const deckOverlayEl = document.getElementById("deckOverlay");
  const deckCardsEl = document.getElementById("deckCards");
  const deckCountEl = document.getElementById("deckCount");
  const deckCloseBtn = document.getElementById("deckCloseBtn");
  const restSiteEl = document.getElementById("restSite");
  const restHealBtn = document.getElementById("restHealBtn");
  const restUpgradeBtn = document.getElementById("restUpgradeBtn");
  const restRemoveBtn = document.getElementById("restRemoveBtn");
  const restHealDescEl = document.getElementById("restHealDesc");

  let state = null;
  let selectedHandIndex = null; // hand index currently armed, awaiting an enemy tap
  let bestAct = GCStorage.get(GAME_ID, "bestAct", 0); // furthest act reached (1-based)

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
    const reached = state.actIndex + 1;
    if (reached > bestAct) {
      bestAct = reached;
      GCStorage.set(GAME_ID, "bestAct", bestAct);
    }
  }

  function onChooseClass(classId) {
    Engine.chooseClass(state, Content, classId, rng);
    render();
  }

  function classOptionNode(classId) {
    const cls = Content.CLASSES[classId];
    const el = document.createElement("button");
    el.type = "button";
    el.className = "class-option class-option-" + classId;
    el.innerHTML = `
      <span class="class-portrait">${dogImg(classId)}</span>
      <span class="class-name">${cls.name}</span>
      <span class="class-hp">${cls.maxHp} Hull</span>
      <span class="class-breed">${cls.breed}</span>
      <span class="class-blurb">${cls.blurb}</span>
      ${cls.mechanic ? `<span class="class-mechanic"><strong>${cls.mechanic.name}</strong> — ${cls.mechanic.text}</span>` : ""}
    `;
    el.addEventListener("click", () => onChooseClass(classId));
    return el;
  }

  function onChooseNode(idx) {
    Engine.chooseNode(state, Content, idx, rng);
    render();
  }

  function onPickReward(cardId) {
    Engine.pickReward(state, Content, cardId, rng);
    render();
  }

  function onPickBossReward(cardId) {
    Engine.chooseBossReward(state, Content, cardId, rng);
    render();
  }

  function bossRewardCardNode(cardId) {
    const card = Content.CARDS[cardId];
    const el = document.createElement("button");
    el.type = "button";
    el.className = "card reward-card " + cardTypeClass(card);
    el.innerHTML = cardFrameHtml(card);
    el.addEventListener("click", () => onPickBossReward(cardId));
    return el;
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
    // Capture everything the flight animation needs BEFORE the engine call
    // and re-render tear the tapped card out of the DOM.
    const cardEl = handEl.children[handIndex];
    const cardDef = Content.CARDS[state.hand[handIndex]];
    let targetEl = null;
    if (cardDef) {
      if (cardDef.damage) {
        // Attacks fly at their victim (the whole battlefield for an AoE);
        // everything else — block, energy, draw — flies back to the dog.
        targetEl =
          !cardDef.aoe && targetId ? battlefieldEl.querySelector(`[data-enemy-id="${targetId}"]`) : battlefieldEl;
      } else {
        targetEl = dogPortraitEl;
      }
    }
    const targetRect = targetEl ? targetEl.getBoundingClientRect() : null;
    const hpBefore = new Map(state.enemies.map((e) => [e.id, e.hp]));

    try {
      Engine.playCard(state, Content, handIndex, targetId, rng);
    } catch (err) {
      return; // UI already gates legality; a thrown error just means "no-op"
    }
    if (cardEl && targetRect) flyCard(cardEl, targetRect);
    selectedHandIndex = null;
    render();

    // Hit reactions on whoever the card just damaged (render above rebuilt
    // the enemy nodes, so query fresh ones).
    for (const enemy of state.enemies) {
      if (enemy.hp < hpBefore.get(enemy.id)) {
        const el = battlefieldEl.querySelector(`[data-enemy-id="${enemy.id}"]`);
        if (el) flashClass(el, enemy.hp <= 0 ? "enemy-dying" : "enemy-hit", 500);
      }
    }
  }

  // A cosmetic clone of the played card that flies from the hand to its
  // target and burns out. Lives directly on <body>, so the re-render that
  // rebuilds the real hand can't cut the flight short.
  function flyCard(cardEl, targetRect) {
    const from = cardEl.getBoundingClientRect();
    const clone = cardEl.cloneNode(true);
    clone.classList.add("card-flying");
    clone.classList.remove("card-selected");
    clone.style.left = `${from.left}px`;
    clone.style.top = `${from.top}px`;
    clone.style.width = `${from.width}px`;
    clone.style.height = `${from.height}px`;
    document.body.appendChild(clone);
    const dx = targetRect.left + targetRect.width / 2 - (from.left + from.width / 2);
    const dy = targetRect.top + targetRect.height / 2 - (from.top + from.height / 2);
    requestAnimationFrame(() => {
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.25) rotate(10deg)`;
      clone.style.opacity = "0";
    });
    setTimeout(() => clone.remove(), 500);
  }

  function endTurn() {
    if (!state || state.status !== "playing") return;
    const attackerIds = Engine.livingEnemies(state)
      .filter((e) => e.currentIntent.type === "attack")
      .map((e) => e.id);
    const hpBefore = state.player.hp;

    Engine.endPlayerTurn(state, Content, rng);
    selectedHandIndex = null;
    render();

    for (const id of attackerIds) {
      const el = battlefieldEl.querySelector(`[data-enemy-id="${id}"]`);
      if (el) flashClass(el, "enemy-attacking", 600);
    }
    if (state.player.hp < hpBefore) {
      // Land the hurt a beat after the lunge starts, so the cat visibly
      // reaches you before you feel it.
      setTimeout(() => {
        flashClass(document.querySelector(".hp-bar"), "hp-hit", 500);
        flashClass(gameAreaEl, "shake", 400);
        flashClass(gameAreaEl, "player-hit", 500);
      }, 220);
    }
  }

  function listNames(names) {
    if (names.length <= 1) return names.join("");
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  function flashClass(el, className, duration) {
    if (!el) return;
    el.classList.remove(className);
    // Force a reflow so re-adding the class restarts the CSS animation even
    // if it's still playing (e.g. two attacks landing in quick succession).
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), duration);
  }

  function nodeOptionNode(option, idx) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "node-option node-option-" + option.type;
    let detail;
    if (option.type === "rest") {
      detail = "Rest · sharpen · remove";
    } else if (option.type === "treasure") {
      detail = "A stash of strong gear";
    } else {
      const icons = option.enemies.map((id) => `<span class="node-enemy-icon">${enemyImg(id)}</span>`).join("");
      const rewardNote = option.type === "elite" ? ` · ${Content.ELITE_REWARD_COUNT} card reward` : "";
      detail = `<span class="node-enemy-icons">${icons}</span>${rewardNote}`;
    }
    el.innerHTML = `
      <span class="node-icon">${NODE_ICON[option.type]}</span>
      <span class="node-label">${option.label}</span>
      <span class="node-detail">${detail}</span>
    `;
    el.addEventListener("click", () => onChooseNode(idx));
    return el;
  }

  function cardFrameHtml(card) {
    return `
      <span class="card-cost">${card.cost}</span>
      <span class="card-art">${CARD_ICONS[cardIconKey(card)]}</span>
      <span class="card-name">${card.name}</span>
      <span class="card-text">${card.text}</span>
    `;
  }

  function cardTypeClass(card) {
    if (card.damage) return "card-attack";
    if (card.block) return "card-block";
    return "card-utility";
  }

  function rewardCardNode(cardId) {
    const card = Content.CARDS[cardId];
    const el = document.createElement("button");
    el.type = "button";
    el.className = "card reward-card " + cardTypeClass(card);
    el.innerHTML = cardFrameHtml(card);
    el.addEventListener("click", () => onPickReward(cardId));
    return el;
  }

  function cardNode(cardId, handIndex) {
    const card = Content.CARDS[cardId];
    const el = document.createElement("button");
    el.type = "button";
    el.className = "card " + cardTypeClass(card);
    if (state.player.energy < card.cost) el.classList.add("card-disabled");
    if (selectedHandIndex === handIndex) el.classList.add("card-selected");
    el.innerHTML = cardFrameHtml(card);
    el.addEventListener("click", () => onCardTap(handIndex));
    return el;
  }

  function enemyNode(enemy) {
    const el = document.createElement("div");
    el.className = "enemy";
    el.dataset.enemyId = enemy.id;
    if (enemy.hp <= 0) el.classList.add("enemy-dead");
    if (selectedHandIndex !== null && enemy.hp > 0) el.classList.add("enemy-targetable");

    // The intent telegraph: exactly what this cat is about to do next turn,
    // shown a full turn ahead so a hit never comes as a surprise — this is
    // the "no cheap deaths" rule the whole combat design rests on, so it
    // gets its own bold banner rather than blending into the card.
    const intentText = enemy.hp > 0 ? Engine.describeIntent(enemy.currentIntent) : "Defeated";
    const intentIcon = enemy.hp > 0 ? INTENT_ICON[enemy.currentIntent.type] : "";
    const intentClass = enemy.hp > 0 ? " enemy-intent-" + enemy.currentIntent.type : "";
    const blockNote =
      enemy.block > 0 ? `<span class="inline-icon">${CARD_ICONS.shield}</span>${enemy.block}` : "";

    el.innerHTML = `
      <span class="enemy-intent${intentClass}">${enemy.hp > 0 ? intentIcon + intentText : ""}</span>
      <span class="enemy-portrait enemy-portrait-${enemy.typeId}">${enemyImg(enemy.typeId)}</span>
      <span class="enemy-name">${enemy.name}</span>
      <div class="hp-bar hp-bar-small"><div class="hp-fill" style="width:${Math.max(0, (enemy.hp / enemy.maxHp) * 100)}%"></div></div>
      <span class="enemy-hp-text">${Math.max(0, enemy.hp)}/${enemy.maxHp}${blockNote}</span>
    `;
    el.addEventListener("click", () => onEnemyTap(enemy.id));
    return el;
  }

  function render() {
    window.__tbState = state; // exposed for tests

    // Class select: HUD/board are meaningless until a dog is picked, so show
    // only the picker.
    const selecting = state.status === "class-select";
    hudEl.hidden = selecting;
    classSelectEl.hidden = !selecting;
    deckBtn.hidden = selecting || !state.classId;
    if (selecting) {
      overlayEl.hidden = true;
      deckOverlayEl.hidden = true;
      nodeChoiceEl.hidden = true;
      rewardScreenEl.hidden = true;
      battlefieldEl.hidden = true;
      consoleEl.hidden = true;
      classOptionsEl.innerHTML = "";
      Object.keys(Content.CLASSES).forEach((id) => classOptionsEl.appendChild(classOptionNode(id)));
      return;
    }

    dogPortraitEl.innerHTML = state.classId ? dogImg(state.classId) : "";

    const act = Content.ACTS[state.actIndex];
    const actNumber = state.actIndex + 1;
    const floorNumber = Math.min(state.floorIndex + 1, act.floors.length);
    roomLabelEl.textContent =
      state.currentNodeType === "boss"
        ? `Act ${actNumber} Boss · ${act.boss.label}`
        : `${act.name} · Floor ${floorNumber}/${act.floors.length}`;
    bestLabelEl.textContent = bestAct > 0 ? `Best: Act ${bestAct}` : "";

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
    energyPipsEl.hidden = state.status !== "playing";

    nodeChoiceEl.hidden = state.status !== "choosing";
    rewardScreenEl.hidden = state.status !== "reward";
    bossRewardScreenEl.hidden = state.status !== "boss-reward";
    restSiteEl.hidden = state.status !== "rest-site";
    battlefieldEl.hidden = state.status !== "playing";
    consoleEl.hidden = state.status !== "playing";

    // Clear every screen's contents unconditionally, then only the active
    // one repopulates below — otherwise a hidden-but-still-in-the-DOM
    // screen leaves stale nodes behind (and .reward-card shares the .card
    // class with hand cards, so leftover reward cards would corrupt any
    // ".card" lookup done later).
    nodeOptionsEl.innerHTML = "";
    rewardOptionsEl.innerHTML = "";
    bossRewardOptionsEl.innerHTML = "";
    battlefieldEl.innerHTML = "";
    handEl.innerHTML = "";

    if (state.status === "choosing") {
      objectiveEl.textContent = "Choose your next room.";
      state.nodeChoices.forEach((option, idx) => nodeOptionsEl.appendChild(nodeOptionNode(option, idx)));
    } else if (state.status === "reward") {
      objectiveEl.textContent =
        state.currentNodeType === "treasure"
          ? "Treasure! Take one of these — no charge."
          : "Pick a card to add to your deck, or skip.";
      state.rewardOptions.forEach((cardId) => rewardOptionsEl.appendChild(rewardCardNode(cardId)));
    } else if (state.status === "rest-site") {
      objectiveEl.textContent = "Rest up, sharpen a card, or drop dead weight.";
      const heal = Math.ceil((state.player.maxHp - state.player.hp) * Content.REST_HEAL_FRACTION);
      restHealDescEl.textContent = state.player.hp >= state.player.maxHp ? "Already at full Hull" : `Heal ${heal} Hull`;
      restHealBtn.disabled = state.player.hp >= state.player.maxHp;
    } else if (state.status === "boss-reward") {
      objectiveEl.textContent = `Boss down! +${Content.BOSS_MAX_HULL_BONUS} max Hull and a full heal. Claim a spoil of war.`;
      bossRewardTitleEl.textContent = `${act.boss.label} defeated`;
      state.bossRewardOptions.forEach((cardId) => bossRewardOptionsEl.appendChild(bossRewardCardNode(cardId)));
    } else if (state.status === "playing") {
      const living = Engine.livingEnemies(state);
      objectiveEl.textContent =
        selectedHandIndex !== null
          ? "Tap a cat to aim it."
          : `Defeat ${listNames(living.map((e) => e.name))}.`;

      for (const enemy of state.enemies) battlefieldEl.appendChild(enemyNode(enemy));
      state.hand.forEach((cardId, i) => handEl.appendChild(cardNode(cardId, i)));
    } else {
      objectiveEl.textContent = "";
    }

    endTurnBtn.disabled = state.status !== "playing";

    if (state.status === "victory") {
      saveBest();
      showOverlay("Victory!", "You dethroned the Cat King and cleared all three acts. TREEBOAR is yours.");
    } else if (state.status === "lost") {
      saveBest();
      const where = state.currentNodeType === "boss" ? `to the ${act.boss.label}` : `in ${act.name}`;
      showOverlay("Good Boy, Down", `You fell ${where}, Act ${actNumber}.`);
    } else {
      overlayEl.hidden = true;
    }
  }

  // Deck viewer / card picker. mode: null = read-only view; "upgrade" or
  // "remove" = a rest-site picker (cards clickable; upgrade only shows cards
  // that have a + version). Grouped by card with a ×count.
  function openDeck(mode) {
    if (!state || !state.deck.length) return;
    const counts = {};
    for (const id of state.deck) counts[id] = (counts[id] || 0) + 1;
    let ids = Object.keys(counts);
    if (mode === "upgrade") ids = ids.filter((id) => Content.UPGRADES[id]);
    ids.sort((a, b) => {
      const ca = Content.CARDS[a];
      const cb = Content.CARDS[b];
      return ca.cost - cb.cost || ca.name.localeCompare(cb.name);
    });
    deckCountEl.textContent =
      mode === "upgrade" ? "Sharpen which card?" : mode === "remove" ? "Drop which card?" : state.deck.length + " cards";
    deckCardsEl.innerHTML = "";
    if (ids.length === 0) {
      deckCardsEl.innerHTML = '<span class="deck-empty">Nothing eligible.</span>';
    }
    for (const id of ids) {
      const card = Content.CARDS[id];
      const wrap = document.createElement(mode ? "button" : "div");
      wrap.className = "deck-card-wrap" + (mode ? " deck-card-pick" : "");
      const el = document.createElement("div");
      el.className = "card " + cardTypeClass(card);
      el.innerHTML = cardFrameHtml(card);
      wrap.appendChild(el);
      if (counts[id] > 1) {
        const badge = document.createElement("span");
        badge.className = "deck-card-count";
        badge.textContent = "×" + counts[id];
        wrap.appendChild(badge);
      }
      if (mode) wrap.addEventListener("click", () => onPickCard(mode, id));
      deckCardsEl.appendChild(wrap);
    }
    deckOverlayEl.hidden = false;
  }
  function closeDeck() {
    deckOverlayEl.hidden = true;
  }

  function onPickCard(mode, cardId) {
    const idx = state.deck.indexOf(cardId);
    if (idx < 0) return;
    Engine.restSite(state, Content, mode, idx, rng);
    closeDeck();
    render();
  }

  function onRestHeal() {
    if (!state || state.status !== "rest-site") return;
    Engine.restSite(state, Content, "heal", null, rng);
    render();
  }

  function showOverlay(title, body) {
    overlayTitleEl.textContent = title;
    overlayBodyEl.textContent = body;
    overlayEl.hidden = false;
  }

  endTurnBtn.addEventListener("click", endTurn);
  skipRewardBtn.addEventListener("click", () => onPickReward(null));
  skipBossRewardBtn.addEventListener("click", () => onPickBossReward(null));
  restartBtn.addEventListener("click", newRun);
  deckBtn.addEventListener("click", () => openDeck(null));
  deckCloseBtn.addEventListener("click", closeDeck);
  restHealBtn.addEventListener("click", onRestHeal);
  restUpgradeBtn.addEventListener("click", () => openDeck("upgrade"));
  restRemoveBtn.addEventListener("click", () => openDeck("remove"));
  deckOverlayEl.addEventListener("click", (e) => {
    if (e.target === deckOverlayEl) closeDeck();
  });

  newRun();
})();
