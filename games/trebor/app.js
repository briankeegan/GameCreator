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

  // ---- character art: full sitting-animal portraits, built from one shared
  // template (strong silhouette, dark outline, layered shading, the
  // signature slit/round eyes) and varied per character so each reads as a
  // genuinely distinct creature, not a recolor. All inline SVG, no assets.
  function buildCat(o) {
    const {
      base, shadow, belly, ear, eye, pupil = "#0c0808", outline = "#0c0808",
      eyeShape = "slit", brow = 0, scar = false, collar = null, tornEar = false,
      fang = false, glow = false, tailSide = 1, stripes = null,
    } = o;
    const defs = glow ? '<defs><filter id="tbGlow"><feGaussianBlur stdDeviation="1.6"/></filter></defs>' : "";
    const gf = glow ? ' filter="url(#tbGlow)"' : "";
    const tail = `<path d="M${50 + tailSide * 22} 86 C${50 + tailSide * 34} 84 ${50 + tailSide * 36} 66 ${50 + tailSide * 28} 58 C${50 + tailSide * 33} 68 ${50 + tailSide * 28} 80 ${50 + tailSide * 18} 82 Z" fill="${shadow}" stroke="${outline}" stroke-width="2.5" stroke-linejoin="round"/>`;
    const body = `<path d="M50 40 C34 40 26 54 24 70 C22 82 26 92 34 95 L66 95 C74 92 78 82 76 70 C74 54 66 40 50 40 Z" fill="${base}" stroke="${outline}" stroke-width="3"/><path d="M50 62 C40 62 34 74 34 84 C34 90 38 94 44 95 L56 95 C62 94 66 90 66 84 C66 74 60 62 50 62 Z" fill="${belly}"/><ellipse cx="42" cy="93" rx="7" ry="5" fill="${base}" stroke="${outline}" stroke-width="2"/><ellipse cx="58" cy="93" rx="7" ry="5" fill="${base}" stroke="${outline}" stroke-width="2"/>`;
    const collarMark = collar ? `<path d="M34 60 Q50 68 66 60 L64 65 Q50 72 36 65 Z" fill="${collar}" stroke="${outline}" stroke-width="1.6"/><circle cx="50" cy="67" r="3" fill="#e6b95c" stroke="${outline}" stroke-width="1.2"/>` : "";
    const leftEar = tornEar
      ? `<path d="M30 30 L26 8 L40 16 L38 22 L34 18 Z" fill="${base}" stroke="${outline}" stroke-width="3" stroke-linejoin="round"/>`
      : `<path d="M30 30 L26 8 L44 22 Z" fill="${base}" stroke="${outline}" stroke-width="3" stroke-linejoin="round"/><path d="M31 24 L30 15 L38 22 Z" fill="${ear}"/>`;
    const rightEar = `<path d="M70 30 L74 8 L56 22 Z" fill="${base}" stroke="${outline}" stroke-width="3" stroke-linejoin="round"/><path d="M69 24 L70 15 L62 22 Z" fill="${ear}"/>`;
    const head = `<ellipse cx="50" cy="40" rx="26" ry="23" fill="${base}" stroke="${outline}" stroke-width="3"/>`;
    const cheeks = `<path d="M24 44 Q20 52 26 56 Q30 52 30 46 Z" fill="${shadow}"/><path d="M76 44 Q80 52 74 56 Q70 52 70 46 Z" fill="${shadow}"/>`;
    const muzzle = `<ellipse cx="50" cy="49" rx="13" ry="9" fill="${belly}"/>`;
    let eyes;
    if (eyeShape === "round") {
      eyes = `<circle cx="40" cy="38" r="5" fill="${eye}"${gf}/><circle cx="60" cy="38" r="5" fill="${eye}"${gf}/><ellipse cx="40" cy="38" rx="2" ry="4" fill="${pupil}"/><ellipse cx="60" cy="38" rx="2" ry="4" fill="${pupil}"/>`;
    } else if (eyeShape === "angry") {
      eyes = `<path d="M32 40 L48 35 L47 40 L34 43 Z" fill="${eye}"${gf}/><path d="M68 40 L52 35 L53 40 L66 43 Z" fill="${eye}"${gf}/><ellipse cx="41" cy="39" rx="1.5" ry="3.2" fill="${pupil}"/><ellipse cx="59" cy="39" rx="1.5" ry="3.2" fill="${pupil}"/>`;
    } else {
      eyes = `<path d="M33 38 Q40 33 47 38 Q40 43 33 38 Z" fill="${eye}"${gf}/><path d="M53 38 Q60 33 67 38 Q60 43 53 38 Z" fill="${eye}"${gf}/><ellipse cx="40" cy="38" rx="1.7" ry="4.5" fill="${pupil}"/><ellipse cx="60" cy="38" rx="1.7" ry="4.5" fill="${pupil}"/>`;
    }
    const brows = brow ? `<path d="M31 31 L46 34" stroke="${outline}" stroke-width="2.4" stroke-linecap="round"/><path d="M69 31 L54 34" stroke="${outline}" stroke-width="2.4" stroke-linecap="round"/>` : "";
    const nose = `<path d="M47 47 L53 47 L50 51 Z" fill="#c65a63"/>`;
    const mouth = fang
      ? `<path d="M50 51 Q50 55 44 56 M50 51 Q50 55 56 56" stroke="${outline}" stroke-width="1.6" fill="none"/><path d="M46 55 L44 60 L48 56 Z" fill="#f2ede0"/><path d="M54 55 L56 60 L52 56 Z" fill="#f2ede0"/>`
      : `<path d="M50 51 Q50 55 45 55 M50 51 Q50 55 55 55" stroke="${outline}" stroke-width="1.6" fill="none"/>`;
    const whisk = `<g stroke="${outline}" stroke-width="1" opacity=".55" stroke-linecap="round"><path d="M37 48 Q26 46 20 48"/><path d="M37 51 Q26 52 21 55"/><path d="M63 48 Q74 46 80 48"/><path d="M63 51 Q74 52 79 55"/></g>`;
    const stripeMarks = stripes ? `<g stroke="${stripes}" stroke-width="2.4" fill="none" stroke-linecap="round"><path d="M50 18 L50 28"/><path d="M44 20 L46 29"/><path d="M56 20 L54 29"/><path d="M22 62 Q30 60 32 66"/><path d="M78 62 Q70 60 68 66"/></g>` : "";
    const scarMark = scar ? `<path d="M36 30 L46 46" stroke="#d8b84a" stroke-width="2.2" stroke-linecap="round"/><path d="M35 33 L40 32 M41 40 L46 39" stroke="${outline}" stroke-width="1.4"/>` : "";
    return `<svg viewBox="0 0 100 100">${defs}${tail}${body}${collarMark}${leftEar}${rightEar}${head}${cheeks}${stripeMarks}${muzzle}${nose}${mouth}${eyes}${brows}${scarMark}${whisk}</svg>`;
  }

  // The hero: a good boy — golden, floppy-eared, panting happily, sitting alert.
  const DOG_ICON =
    '<svg viewBox="0 0 100 100">' +
    '<path d="M28 84 C10 80 8 62 18 58 C14 68 20 78 34 80 Z" fill="#c2842f" stroke="#3a2412" stroke-width="2.5" stroke-linejoin="round"/>' +
    '<path d="M50 42 C33 42 25 56 24 72 C23 84 28 93 36 95 L64 95 C72 93 77 84 76 72 C75 56 67 42 50 42 Z" fill="#e0a44e" stroke="#3a2412" stroke-width="3"/>' +
    '<path d="M50 60 C40 60 34 74 35 85 C35 91 39 94 44 95 L56 95 C61 94 65 91 65 85 C66 74 60 60 50 60 Z" fill="#f6d79a"/>' +
    '<ellipse cx="41" cy="93" rx="7.5" ry="5" fill="#e0a44e" stroke="#3a2412" stroke-width="2"/>' +
    '<ellipse cx="59" cy="93" rx="7.5" ry="5" fill="#e0a44e" stroke="#3a2412" stroke-width="2"/>' +
    '<path d="M27 34 C18 34 16 54 24 60 C30 56 32 44 33 38 Z" fill="#b5701f" stroke="#3a2412" stroke-width="2.5"/>' +
    '<path d="M73 34 C82 34 84 54 76 60 C70 56 68 44 67 38 Z" fill="#b5701f" stroke="#3a2412" stroke-width="2.5"/>' +
    '<ellipse cx="50" cy="40" rx="25" ry="22" fill="#e0a44e" stroke="#3a2412" stroke-width="3"/>' +
    '<ellipse cx="50" cy="50" rx="15" ry="11" fill="#f6d79a"/>' +
    '<circle cx="40" cy="37" r="4.2" fill="#3a2410"/><circle cx="60" cy="37" r="4.2" fill="#3a2410"/>' +
    '<circle cx="41.4" cy="35.6" r="1.4" fill="#fff"/><circle cx="61.4" cy="35.6" r="1.4" fill="#fff"/>' +
    '<path d="M35 30 Q40 28 45 30" stroke="#3a2412" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<path d="M55 30 Q60 28 65 30" stroke="#3a2412" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<ellipse cx="50" cy="46" rx="4.5" ry="3.5" fill="#2a1a10"/><ellipse cx="48.6" cy="44.8" rx="1.4" ry="1" fill="#5c4530"/>' +
    '<path d="M50 49 Q50 55 43 56 M50 49 Q50 55 57 56" stroke="#3a2412" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
    '<path d="M46 55 Q50 64 54 55 Z" fill="#e8788a" stroke="#3a2412" stroke-width="1.2"/>' +
    "</svg>";

  // Three genuinely distinct cats, not palette swaps: a scrappy ginger Alley
  // Cat with a torn ear and angry green eyes; a stout grey Tabby Guard with a
  // belled collar and alert amber eyes; a hulking scarred Big Tom with glowing
  // red eyes and bared fangs.
  const ENEMY_ICONS = {
    alleyCat: buildCat({ base: "#d98b3f", shadow: "#b56f2c", belly: "#f0c98a", ear: "#e8a97a", eye: "#8fd14f", eyeShape: "angry", brow: 1, tornEar: true, stripes: "#a15f22", tailSide: 1 }),
    tabbyGuard: buildCat({ base: "#6f7d8c", shadow: "#55636f", belly: "#c3ccd4", ear: "#9aa6b0", eye: "#e6b95c", eyeShape: "round", stripes: "#4a5560", collar: "#8b2f2f", tailSide: -1 }),
    bigTom: buildCat({ base: "#241426", shadow: "#160c18", belly: "#3a2540", ear: "#5c2f6e", eye: "#ff4d3d", eyeShape: "slit", brow: 1, scar: true, fang: true, glow: true, tailSide: 1 }),
  };

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
  dogPortraitEl.innerHTML = DOG_ICON;
  dogBlockIconEl.innerHTML = CARD_ICONS.shield;
  const energyPipsEl = document.getElementById("energyPips");
  const nodeChoiceEl = document.getElementById("nodeChoice");
  const nodeOptionsEl = document.getElementById("nodeOptions");
  const rewardScreenEl = document.getElementById("rewardScreen");
  const rewardOptionsEl = document.getElementById("rewardOptions");
  const skipRewardBtn = document.getElementById("skipRewardBtn");
  const battlefieldEl = document.getElementById("battlefield");
  const consoleEl = document.getElementById("combatConsole");
  const handEl = document.getElementById("hand");
  const endTurnBtn = document.getElementById("endTurnBtn");
  const overlayEl = document.getElementById("runOverlay");
  const overlayTitleEl = document.getElementById("runOverlayTitle");
  const overlayBodyEl = document.getElementById("runOverlayBody");
  const restartBtn = document.getElementById("restartBtn");

  let state = null;
  let selectedHandIndex = null; // hand index currently armed, awaiting an enemy tap
  let bestFloor = GCStorage.get(GAME_ID, "bestFloor", 0);

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
    if (state.floorIndex > bestFloor) {
      bestFloor = state.floorIndex;
      GCStorage.set(GAME_ID, "bestFloor", bestFloor);
    }
  }

  function onChooseNode(idx) {
    Engine.chooseNode(state, Content, idx, rng);
    render();
  }

  function onPickReward(cardId) {
    Engine.pickReward(state, Content, cardId, rng);
    render();
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
      const heal = Math.ceil((state.player.maxHp - state.player.hp) * Content.REST_HEAL_FRACTION);
      detail = state.player.hp >= state.player.maxHp ? "Already at full health" : `Heal ${heal} HP`;
    } else {
      const icons = option.enemies.map((id) => `<span class="node-enemy-icon">${ENEMY_ICONS[id]}</span>`).join("");
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
      <span class="enemy-portrait enemy-portrait-${enemy.typeId}">${ENEMY_ICONS[enemy.typeId]}</span>
      <span class="enemy-name">${enemy.name}</span>
      <div class="hp-bar hp-bar-small"><div class="hp-fill" style="width:${Math.max(0, (enemy.hp / enemy.maxHp) * 100)}%"></div></div>
      <span class="enemy-hp-text">${Math.max(0, enemy.hp)}/${enemy.maxHp}${blockNote}</span>
    `;
    el.addEventListener("click", () => onEnemyTap(enemy.id));
    return el;
  }

  function render() {
    window.__tbState = state; // exposed for tests

    const floorNumber = Math.min(state.floorIndex + 1, Content.FLOORS.length);
    roomLabelEl.textContent =
      state.currentNodeType === "boss" ? `Boss · ${Content.BOSS.label}` : `Floor ${floorNumber} of ${Content.FLOORS.length}`;
    bestLabelEl.textContent = bestFloor > 0 ? `Best: Floor ${bestFloor}` : "";

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
    battlefieldEl.hidden = state.status !== "playing";
    consoleEl.hidden = state.status !== "playing";

    // Clear every screen's contents unconditionally, then only the active
    // one repopulates below — otherwise a hidden-but-still-in-the-DOM
    // screen leaves stale nodes behind (and .reward-card shares the .card
    // class with hand cards, so leftover reward cards would corrupt any
    // ".card" lookup done later).
    nodeOptionsEl.innerHTML = "";
    rewardOptionsEl.innerHTML = "";
    battlefieldEl.innerHTML = "";
    handEl.innerHTML = "";

    if (state.status === "choosing") {
      objectiveEl.textContent = "Choose your next room.";
      state.nodeChoices.forEach((option, idx) => nodeOptionsEl.appendChild(nodeOptionNode(option, idx)));
    } else if (state.status === "reward") {
      objectiveEl.textContent = "Pick a card to add to your deck, or skip.";
      state.rewardOptions.forEach((cardId) => rewardOptionsEl.appendChild(rewardCardNode(cardId)));
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
      showOverlay("Victory!", "You cleared the whole dungeon. TREEBOAR is yours.");
    } else if (state.status === "lost") {
      saveBest();
      showOverlay("Good Boy, Down", `You made it to Floor ${floorNumber}.`);
    } else {
      overlayEl.hidden = true;
    }
  }

  function showOverlay(title, body) {
    overlayTitleEl.textContent = title;
    overlayBodyEl.textContent = body;
    overlayEl.hidden = false;
  }

  endTurnBtn.addEventListener("click", endTurn);
  skipRewardBtn.addEventListener("click", () => onPickReward(null));
  restartBtn.addEventListener("click", newRun);

  newRun();
})();
