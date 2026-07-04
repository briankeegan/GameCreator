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

  // ---- character art: volumetric sitting-animal portraits. Each part is a
  // radial-gradient "sphere" (highlight top-left → core shadow) with a cast
  // shadow on the ground, an occlusion seam where head meets body, and a rim
  // light on the lit edge — so they read as rendered, dimensional creatures
  // rather than flat glyphs. Each character also has a distinct BODY TYPE and
  // pose, not just a recolor. All inline SVG, no assets.
  let iconUid = 0;
  function buildCat(o) {
    const {
      lit, mid, dark, belly, eyeCol, pupil = "#0a0608", pose = "tall",
      eyeShape = "slit", browAngry = 0, scar = 0, collar = 0, tornEar = 0,
      fang = 0, glow = 0, stripe = 0,
    } = o;
    const id = "tb" + iconUid++;
    const sphere = (gid, cx, cy) =>
      `<radialGradient id="${gid}" cx="${cx}" cy="${cy}" r="75%"><stop offset="0%" stop-color="${lit}"/><stop offset="55%" stop-color="${mid}"/><stop offset="100%" stop-color="${dark}"/></radialGradient>`;
    const defs =
      `<defs>${sphere(id + "b", "38%", "30%")}${sphere(id + "h", "38%", "28%")}` +
      `<radialGradient id="${id}bel" cx="50%" cy="35%" r="70%"><stop offset="0%" stop-color="${belly}"/><stop offset="100%" stop-color="${mid}"/></radialGradient>` +
      (glow ? `<filter id="${id}g"><feGaussianBlur stdDeviation="1.4"/></filter>` : "") +
      "</defs>";
    const gf = glow ? ` filter="url(#${id}g)"` : "";

    let bodyPath, hcx, hcy, hrx, hry, earY, span;
    if (pose === "lean") {
      bodyPath = "M50 58 C40 58 33 70 33 82 C33 91 38 96 46 96 L60 96 C67 96 70 90 70 82 C70 68 62 58 50 58 Z";
      hcx = 48; hcy = 44; hrx = 20; hry = 18; earY = 30; span = 1;
    } else if (pose === "wide") {
      bodyPath = "M50 54 C34 54 24 66 23 80 C22 90 28 97 38 97 L62 97 C72 97 78 90 77 80 C76 66 66 54 50 54 Z";
      hcx = 50; hcy = 42; hrx = 27; hry = 23; earY = 24; span = 1.25;
    } else {
      bodyPath = "M50 50 C39 50 33 62 32 76 C31 88 36 95 44 96 L56 96 C64 95 69 88 68 76 C67 62 61 50 50 50 Z";
      hcx = 50; hcy = 38; hrx = 22; hry = 20; earY = 22; span = 1;
    }

    const shadow = `<ellipse cx="50" cy="98" rx="${28 * span}" ry="6" fill="rgba(0,0,0,0.45)"/>`;
    const tail = `<path d="M68 88 C84 84 86 66 78 60 C83 70 76 82 64 84 Z" fill="${dark}"/>`;
    const ear = (cx, dir) =>
      tornEar && dir < 0
        ? `<path d="M${cx} ${earY + 4} L${cx - 4} ${earY - 16} L${cx + 8} ${earY - 6} L${cx + 6} ${earY} L${cx + 2} ${earY - 4} Z" fill="${mid}" stroke="${dark}" stroke-width="1.5" stroke-linejoin="round"/>`
        : `<path d="M${cx} ${earY + 6} L${cx + dir * 2} ${earY - 16} L${cx + dir * 14} ${earY - 2} Z" fill="${mid}" stroke="${dark}" stroke-width="1.5" stroke-linejoin="round"/><path d="M${cx + dir * 3} ${earY} L${cx + dir * 3} ${earY - 9} L${cx + dir * 9} ${earY - 2} Z" fill="#d98a86"/>`;
    const ears = ear(hcx - hrx * 0.55, -1) + ear(hcx + hrx * 0.55, 1);
    const body =
      `<path d="${bodyPath}" fill="url(#${id}b)" stroke="${dark}" stroke-width="2"/>` +
      `<ellipse cx="${hcx}" cy="${hcy + hry * 0.9}" rx="${hrx * 0.7}" ry="${hry * 0.5}" fill="rgba(0,0,0,0.18)"/>` +
      `<ellipse cx="50" cy="80" rx="${11 * span}" ry="14" fill="url(#${id}bel)" opacity="0.9"/>`;
    const paws = `<ellipse cx="${50 - 8 * span}" cy="95" rx="6" ry="4.5" fill="${mid}" stroke="${dark}" stroke-width="1.4"/><ellipse cx="${50 + 8 * span}" cy="95" rx="6" ry="4.5" fill="${mid}" stroke="${dark}" stroke-width="1.4"/>`;
    const head = `<ellipse cx="${hcx}" cy="${hcy}" rx="${hrx}" ry="${hry}" fill="url(#${id}h)" stroke="${dark}" stroke-width="2"/>`;
    const rim = `<path d="M${hcx - hrx * 0.8} ${hcy - hry * 0.3} A ${hrx} ${hry} 0 0 1 ${hcx + hrx * 0.2} ${hcy - hry * 0.95}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2" stroke-linecap="round"/>`;
    const muzzle = `<ellipse cx="${hcx}" cy="${hcy + hry * 0.35}" rx="${hrx * 0.5}" ry="${hry * 0.36}" fill="url(#${id}bel)"/>`;
    const ex = hrx * 0.42, ey = hcy - hry * 0.05, er = hrx * 0.2;
    let eyes;
    if (eyeShape === "round") {
      eyes = `<ellipse cx="${hcx - ex}" cy="${ey}" rx="${er}" ry="${er * 1.1}" fill="${eyeCol}"${gf}/><ellipse cx="${hcx + ex}" cy="${ey}" rx="${er}" ry="${er * 1.1}" fill="${eyeCol}"${gf}/><ellipse cx="${hcx - ex}" cy="${ey}" rx="${er * 0.4}" ry="${er * 0.9}" fill="${pupil}"/><ellipse cx="${hcx + ex}" cy="${ey}" rx="${er * 0.4}" ry="${er * 0.9}" fill="${pupil}"/><circle cx="${hcx - ex - 1}" cy="${ey - 2}" r="1.2" fill="#fff"/><circle cx="${hcx + ex - 1}" cy="${ey - 2}" r="1.2" fill="#fff"/>`;
    } else if (eyeShape === "angry") {
      eyes = `<path d="M${hcx - ex - er} ${ey + 2} L${hcx - ex + er} ${ey - 3} L${hcx - ex + er} ${ey + 2} L${hcx - ex - er} ${ey + 4} Z" fill="${eyeCol}"${gf}/><path d="M${hcx + ex + er} ${ey + 2} L${hcx + ex - er} ${ey - 3} L${hcx + ex - er} ${ey + 2} L${hcx + ex + er} ${ey + 4} Z" fill="${eyeCol}"${gf}/><ellipse cx="${hcx - ex}" cy="${ey + 1}" rx="1.3" ry="2.6" fill="${pupil}"/><ellipse cx="${hcx + ex}" cy="${ey + 1}" rx="1.3" ry="2.6" fill="${pupil}"/>`;
    } else {
      eyes = `<path d="M${hcx - ex - er} ${ey} Q${hcx - ex} ${ey - er} ${hcx - ex + er} ${ey} Q${hcx - ex} ${ey + er} ${hcx - ex - er} ${ey} Z" fill="${eyeCol}"${gf}/><path d="M${hcx + ex - er} ${ey} Q${hcx + ex} ${ey - er} ${hcx + ex + er} ${ey} Q${hcx + ex} ${ey + er} ${hcx + ex - er} ${ey} Z" fill="${eyeCol}"${gf}/><ellipse cx="${hcx - ex}" cy="${ey}" rx="1.3" ry="${er}" fill="${pupil}"/><ellipse cx="${hcx + ex}" cy="${ey}" rx="1.3" ry="${er}" fill="${pupil}"/>`;
    }
    const brows = browAngry ? `<path d="M${hcx - ex - er} ${ey - er - 1} L${hcx - ex + er} ${ey - 1}" stroke="${dark}" stroke-width="2.2" stroke-linecap="round"/><path d="M${hcx + ex + er} ${ey - er - 1} L${hcx + ex - er} ${ey - 1}" stroke="${dark}" stroke-width="2.2" stroke-linecap="round"/>` : "";
    const nose = `<path d="M${hcx - 2.5} ${hcy + hry * 0.3} L${hcx + 2.5} ${hcy + hry * 0.3} L${hcx} ${hcy + hry * 0.45} Z" fill="#c65a63"/>`;
    const mouth = fang
      ? `<path d="M${hcx} ${hcy + hry * 0.45} Q${hcx} ${hcy + hry * 0.7} ${hcx - 5} ${hcy + hry * 0.72} M${hcx} ${hcy + hry * 0.45} Q${hcx} ${hcy + hry * 0.7} ${hcx + 5} ${hcy + hry * 0.72}" stroke="${dark}" stroke-width="1.4" fill="none"/><path d="M${hcx - 4} ${hcy + hry * 0.68} L${hcx - 5.5} ${hcy + hry} L${hcx - 2} ${hcy + hry * 0.7} Z" fill="#fff"/><path d="M${hcx + 4} ${hcy + hry * 0.68} L${hcx + 5.5} ${hcy + hry} L${hcx + 2} ${hcy + hry * 0.7} Z" fill="#fff"/>`
      : `<path d="M${hcx} ${hcy + hry * 0.45} Q${hcx} ${hcy + hry * 0.65} ${hcx - 4} ${hcy + hry * 0.66} M${hcx} ${hcy + hry * 0.45} Q${hcx} ${hcy + hry * 0.65} ${hcx + 4} ${hcy + hry * 0.66}" stroke="${dark}" stroke-width="1.4" fill="none"/>`;
    const whisk = `<g stroke="${dark}" stroke-width="0.9" opacity="0.5" stroke-linecap="round"><path d="M${hcx - 6} ${hcy + hry * 0.4} Q${hcx - 20} ${hcy + hry * 0.25} ${hcx - 26} ${hcy + hry * 0.4}"/><path d="M${hcx - 6} ${hcy + hry * 0.55} Q${hcx - 20} ${hcy + hry * 0.6} ${hcx - 25} ${hcy + hry * 0.75}"/><path d="M${hcx + 6} ${hcy + hry * 0.4} Q${hcx + 20} ${hcy + hry * 0.25} ${hcx + 26} ${hcy + hry * 0.4}"/><path d="M${hcx + 6} ${hcy + hry * 0.55} Q${hcx + 20} ${hcy + hry * 0.6} ${hcx + 25} ${hcy + hry * 0.75}"/></g>`;
    const scarSvg = scar ? `<path d="M${hcx - hrx * 0.5} ${hcy - hry * 0.5} L${hcx - hrx * 0.1} ${hcy + hry * 0.2}" stroke="#e6c24a" stroke-width="2" stroke-linecap="round"/><path d="M${hcx - hrx * 0.45} ${hcy - hry * 0.35} l3 -1 M${hcx - hrx * 0.25} ${hcy} l3 -1" stroke="${dark}" stroke-width="1.2"/>` : "";
    const stripeSvg = stripe ? `<g stroke="${dark}" stroke-width="2" fill="none" opacity="0.4" stroke-linecap="round"><path d="M${hcx} ${hcy - hry} l0 8"/><path d="M${hcx - 6} ${hcy - hry * 0.9} l1.5 8"/><path d="M${hcx + 6} ${hcy - hry * 0.9} l-1.5 8"/></g>` : "";
    const collarSvg = collar ? `<path d="M${hcx - 14} ${hcy + hry * 0.85} Q50 ${hcy + hry * 1.3} ${hcx + 14} ${hcy + hry * 0.85} L${hcx + 12} ${hcy + hry * 1.15} Q50 ${hcy + hry * 1.55} ${hcx - 12} ${hcy + hry * 1.15} Z" fill="#8b2f2f" stroke="${dark}" stroke-width="1.4"/><circle cx="50" cy="${hcy + hry * 1.35}" r="3" fill="#e6b95c" stroke="${dark}" stroke-width="1"/>` : "";

    return `<svg viewBox="0 0 100 100">${defs}${shadow}${tail}${ears}${body}${paws}${collarSvg}${head}${rim}${stripeSvg}${muzzle}${nose}${mouth}${eyes}${brows}${scarSvg}${whisk}</svg>`;
  }

  // The hero: same volumetric treatment, built as a friendly golden dog —
  // floppy droopy ears, warm round eyes, a panting tongue.
  function buildDog() {
    const id = "tb" + iconUid++;
    const lit = "#f0c070", mid = "#d99a3e", dark = "#9c661f", belly = "#f8dea0", dk2 = "#6e4514";
    return (
      `<svg viewBox="0 0 100 100"><defs>` +
      `<radialGradient id="${id}b" cx="40%" cy="30%" r="75%"><stop offset="0%" stop-color="${lit}"/><stop offset="55%" stop-color="${mid}"/><stop offset="100%" stop-color="${dark}"/></radialGradient>` +
      `<radialGradient id="${id}h" cx="40%" cy="28%" r="72%"><stop offset="0%" stop-color="${lit}"/><stop offset="55%" stop-color="${mid}"/><stop offset="100%" stop-color="${dark}"/></radialGradient>` +
      `<radialGradient id="${id}m" cx="50%" cy="30%" r="70%"><stop offset="0%" stop-color="${belly}"/><stop offset="100%" stop-color="${mid}"/></radialGradient></defs>` +
      `<ellipse cx="50" cy="98" rx="30" ry="6" fill="rgba(0,0,0,0.45)"/>` +
      `<path d="M30 86 C12 82 12 62 22 58 C18 68 24 80 36 82 Z" fill="${dark}"/>` +
      `<path d="M28 36 C16 36 14 60 24 66 C31 60 33 46 34 40 Z" fill="${dk2}" stroke="${dark}" stroke-width="1.5"/>` +
      `<path d="M72 36 C84 36 86 60 76 66 C69 60 67 46 66 40 Z" fill="${dk2}" stroke="${dark}" stroke-width="1.5"/>` +
      `<path d="M50 52 C36 52 28 64 27 78 C26 89 32 96 41 96 L59 96 C68 96 74 89 73 78 C72 64 64 52 50 52 Z" fill="url(#${id}b)" stroke="${dark}" stroke-width="2"/>` +
      `<ellipse cx="50" cy="80" rx="12" ry="15" fill="url(#${id}m)" opacity="0.9"/>` +
      `<ellipse cx="42" cy="95" rx="6.5" ry="4.5" fill="${mid}" stroke="${dark}" stroke-width="1.4"/><ellipse cx="58" cy="95" rx="6.5" ry="4.5" fill="${mid}" stroke="${dark}" stroke-width="1.4"/>` +
      `<ellipse cx="50" cy="42" rx="24" ry="21" fill="url(#${id}h)" stroke="${dark}" stroke-width="2"/>` +
      `<path d="M30 34 A24 21 0 0 1 52 22" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2" stroke-linecap="round"/>` +
      `<ellipse cx="50" cy="52" rx="14" ry="11" fill="url(#${id}m)"/>` +
      `<circle cx="40" cy="39" r="4" fill="#3a2410"/><circle cx="60" cy="39" r="4" fill="#3a2410"/>` +
      `<circle cx="41.4" cy="37.4" r="1.4" fill="#fff"/><circle cx="61.4" cy="37.4" r="1.4" fill="#fff"/>` +
      `<path d="M34 33 Q40 30 46 33" stroke="${dark}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
      `<path d="M54 33 Q60 30 66 33" stroke="${dark}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
      `<ellipse cx="50" cy="48" rx="4.5" ry="3.4" fill="#241009"/><ellipse cx="48.5" cy="46.8" rx="1.3" ry="0.9" fill="#5c4530"/>` +
      `<path d="M50 51 Q50 57 44 58 M50 51 Q50 57 56 58" stroke="${dark}" stroke-width="1.6" fill="none" stroke-linecap="round"/>` +
      `<path d="M46 57 Q50 66 54 57 Z" fill="#e8788a" stroke="${dark}" stroke-width="1.2"/><path d="M50 58 L50 63" stroke="#c65a68" stroke-width="1"/>` +
      `</svg>`
    );
  }

  const DOG_ICON = buildDog();

  // Three distinct cats — different body types, not palette swaps: a lean
  // ginger Alley Cat with a torn ear and angry green eyes; an upright grey
  // Tabby Guard with a belled collar and round amber eyes; a big, wide,
  // scarred Big Tom with glowing red eyes and bared fangs.
  const ENEMY_ICONS = {
    alleyCat: buildCat({ pose: "lean", lit: "#f0a850", mid: "#d07f2c", dark: "#8a4e18", belly: "#f6d29a", eyeCol: "#9be04f", eyeShape: "angry", browAngry: 1, tornEar: 1, stripe: 1 }),
    tabbyGuard: buildCat({ pose: "tall", lit: "#9aa6b2", mid: "#6f7d8c", dark: "#41505e", belly: "#cdd5dc", eyeCol: "#f0c34a", eyeShape: "round", collar: 1, stripe: 1 }),
    bigTom: buildCat({ pose: "wide", lit: "#4a2f52", mid: "#2c1830", dark: "#160b1a", belly: "#4a2f52", eyeCol: "#ff4d3d", eyeShape: "slit", browAngry: 1, scar: 1, fang: 1, glow: 1 }),
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
