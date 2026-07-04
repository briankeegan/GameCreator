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

  // ---- character art: cel-shaded sitting-animal portraits. Bright flat base
  // color + a hard-edged core-shadow shape (lower-right) + a hard highlight
  // shape (upper-left) + a bold dark outline — crisp and readable, but with
  // real dimension rather than a muddy gradient. A cast shadow grounds each
  // one, and each character has a distinct BODY TYPE and pose, not a recolor.
  // All inline SVG, no assets.
  let iconUid = 0;
  function buildCat(o) {
    const {
      base, shade, light, belly, bellyLt, eyeCol, pupil = "#140a10", ink = "#231018",
      pose = "tall", eyeShape = "slit", browAngry = 0, scar = 0, collar = 0,
      tornEar = 0, fang = 0, glow = 0, stripe = 0, noseCol = "#c25563",
    } = o;
    const id = "tb" + iconUid++;
    const glowDef = glow ? `<defs><filter id="${id}g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.5"/></filter></defs>` : "";
    const gf = glow ? ` filter="url(#${id}g)"` : "";

    let bp, hcx, hcy, hrx, hry, earY, span;
    if (pose === "lean") {
      bp = "M50 60 C41 60 35 71 35 82 C35 91 40 96 47 96 L58 96 C65 96 68 90 68 82 C68 69 61 60 50 60 Z";
      hcx = 48; hcy = 46; hrx = 19; hry = 17; earY = 33; span = 0.92;
    } else if (pose === "wide") {
      bp = "M50 55 C35 55 25 67 24 80 C23 90 29 97 39 97 L61 97 C71 97 77 90 76 80 C75 67 65 55 50 55 Z";
      hcx = 50; hcy = 43; hrx = 26; hry = 22; earY = 25; span = 1.22;
    } else {
      bp = "M50 52 C40 52 34 63 33 76 C32 88 37 95 45 96 L55 96 C63 95 68 88 67 76 C66 63 60 52 50 52 Z";
      hcx = 50; hcy = 40; hrx = 21; hry = 19; earY = 23; span = 1;
    }

    const shadow = `<ellipse cx="50" cy="98" rx="${27 * span}" ry="5.5" fill="rgba(0,0,0,0.4)"/>`;
    const tail = `<path d="M67 90 C83 87 85 68 77 61 C82 71 75 83 63 85 Z" fill="${shade}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`;
    const earSvg = (cx, dir) =>
      tornEar && dir < 0
        ? `<path d="M${cx} ${earY + 4} L${cx - 4} ${earY - 15} L${cx + 8} ${earY - 6} L${cx + 6} ${earY} L${cx + 2} ${earY - 4} Z" fill="${base}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`
        : `<path d="M${cx} ${earY + 6} L${cx + dir * 2} ${earY - 15} L${cx + dir * 13} ${earY - 2} Z" fill="${base}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/><path d="M${cx + dir * 2.5} ${earY} L${cx + dir * 2.5} ${earY - 8} L${cx + dir * 8} ${earY - 1} Z" fill="#e39ca0"/>`;
    const ears = earSvg(hcx - hrx * 0.55, -1) + earSvg(hcx + hrx * 0.55, 1);

    const body =
      `<path d="${bp}" fill="${base}" stroke="${ink}" stroke-width="2.4"/>` +
      `<path d="M50 60 C64 60 68 76 66 86 C64 93 58 96 55 96 L45 96 C58 94 60 78 54 66 C52 62 50 60 50 60 Z" fill="${shade}" opacity="0.9"/>` +
      `<path d="M44 55 C36 57 32 66 33 74 C36 64 42 60 48 58 Z" fill="${light}" opacity="0.85"/>` +
      `<ellipse cx="50" cy="82" rx="${10 * span}" ry="12" fill="${belly}"/>` +
      `<path d="M50 70 q-6 3 -6 12 q3 -8 6 -8 z" fill="${bellyLt}" opacity="0.7"/>`;
    const paws = `<ellipse cx="${50 - 8 * span}" cy="95" rx="6" ry="4.3" fill="${base}" stroke="${ink}" stroke-width="1.6"/><ellipse cx="${50 + 8 * span}" cy="95" rx="6" ry="4.3" fill="${base}" stroke="${ink}" stroke-width="1.6"/><path d="M${50 - 8 * span} 92 v6 M${50 + 8 * span} 92 v6" stroke="${ink}" stroke-width="0.8" opacity="0.5"/>`;

    const head =
      `<ellipse cx="${hcx}" cy="${hcy}" rx="${hrx}" ry="${hry}" fill="${base}" stroke="${ink}" stroke-width="2.4"/>` +
      `<path d="M${hcx} ${hcy - hry} A ${hrx} ${hry} 0 0 1 ${hcx + hrx} ${hcy} A ${hrx} ${hry} 0 0 1 ${hcx} ${hcy + hry} Q ${hcx + hrx * 0.3} ${hcy} ${hcx} ${hcy - hry} Z" fill="${shade}" opacity="0.55"/>` +
      `<path d="M${hcx - hrx * 0.9} ${hcy - hry * 0.2} A ${hrx} ${hry} 0 0 1 ${hcx - hrx * 0.1} ${hcy - hry * 0.95} Q ${hcx - hrx * 0.5} ${hcy - hry * 0.4} ${hcx - hrx * 0.9} ${hcy - hry * 0.2} Z" fill="${light}" opacity="0.8"/>`;
    const muzzle = `<ellipse cx="${hcx}" cy="${hcy + hry * 0.4}" rx="${hrx * 0.52}" ry="${hry * 0.38}" fill="${belly}"/>`;

    const ex = hrx * 0.42, ey = hcy - hry * 0.05, er = hrx * 0.22;
    let eyes;
    if (eyeShape === "round") {
      eyes = `<ellipse cx="${hcx - ex}" cy="${ey}" rx="${er}" ry="${er * 1.15}" fill="${eyeCol}" stroke="${ink}" stroke-width="1"${gf}/><ellipse cx="${hcx + ex}" cy="${ey}" rx="${er}" ry="${er * 1.15}" fill="${eyeCol}" stroke="${ink}" stroke-width="1"${gf}/><ellipse cx="${hcx - ex}" cy="${ey}" rx="${er * 0.42}" ry="${er}" fill="${pupil}"/><ellipse cx="${hcx + ex}" cy="${ey}" rx="${er * 0.42}" ry="${er}" fill="${pupil}"/><circle cx="${hcx - ex - 1.2}" cy="${ey - 1.8}" r="1.3" fill="#fff"/><circle cx="${hcx + ex - 1.2}" cy="${ey - 1.8}" r="1.3" fill="#fff"/>`;
    } else if (eyeShape === "angry") {
      eyes = `<path d="M${hcx - ex - er} ${ey + 2.5} L${hcx - ex + er} ${ey - 3} L${hcx - ex + er} ${ey + 2} Z" fill="${eyeCol}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"${gf}/><path d="M${hcx + ex + er} ${ey + 2.5} L${hcx + ex - er} ${ey - 3} L${hcx + ex - er} ${ey + 2} Z" fill="${eyeCol}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"${gf}/><ellipse cx="${hcx - ex}" cy="${ey}" rx="1.3" ry="2.6" fill="${pupil}"/><ellipse cx="${hcx + ex}" cy="${ey}" rx="1.3" ry="2.6" fill="${pupil}"/>`;
    } else {
      eyes = `<path d="M${hcx - ex - er} ${ey} Q${hcx - ex} ${ey - er * 1.2} ${hcx - ex + er} ${ey} Q${hcx - ex} ${ey + er * 1.1} ${hcx - ex - er} ${ey} Z" fill="${eyeCol}" stroke="${ink}" stroke-width="1"${gf}/><path d="M${hcx + ex - er} ${ey} Q${hcx + ex} ${ey - er * 1.2} ${hcx + ex + er} ${ey} Q${hcx + ex} ${ey + er * 1.1} ${hcx + ex - er} ${ey} Z" fill="${eyeCol}" stroke="${ink}" stroke-width="1"${gf}/><ellipse cx="${hcx - ex}" cy="${ey}" rx="1.4" ry="${er}" fill="${pupil}"/><ellipse cx="${hcx + ex}" cy="${ey}" rx="1.4" ry="${er}" fill="${pupil}"/><circle cx="${hcx - ex + 1.4}" cy="${ey - 1.6}" r="1" fill="#fff" opacity="0.85"/><circle cx="${hcx + ex + 1.4}" cy="${ey - 1.6}" r="1" fill="#fff" opacity="0.85"/>`;
    }
    const brows = browAngry ? `<path d="M${hcx - ex - er - 1} ${ey - er - 1} L${hcx - ex + er} ${ey - 1.5}" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><path d="M${hcx + ex + er + 1} ${ey - er - 1} L${hcx + ex - er} ${ey - 1.5}" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>` : "";
    const nose = `<path d="M${hcx - 2.6} ${hcy + hry * 0.3} L${hcx + 2.6} ${hcy + hry * 0.3} L${hcx} ${hcy + hry * 0.48} Z" fill="${noseCol}" stroke="${ink}" stroke-width="0.8" stroke-linejoin="round"/>`;
    const mouth = fang
      ? `<path d="M${hcx} ${hcy + hry * 0.48} Q${hcx} ${hcy + hry * 0.72} ${hcx - 5} ${hcy + hry * 0.74} M${hcx} ${hcy + hry * 0.48} Q${hcx} ${hcy + hry * 0.72} ${hcx + 5} ${hcy + hry * 0.74}" stroke="${ink}" stroke-width="1.5" fill="none"/><path d="M${hcx - 4} ${hcy + hry * 0.7} L${hcx - 5.5} ${hcy + hry * 1.02} L${hcx - 2} ${hcy + hry * 0.72} Z" fill="#fff" stroke="${ink}" stroke-width="0.5"/><path d="M${hcx + 4} ${hcy + hry * 0.7} L${hcx + 5.5} ${hcy + hry * 1.02} L${hcx + 2} ${hcy + hry * 0.72} Z" fill="#fff" stroke="${ink}" stroke-width="0.5"/>`
      : `<path d="M${hcx} ${hcy + hry * 0.48} Q${hcx} ${hcy + hry * 0.66} ${hcx - 4} ${hcy + hry * 0.68} M${hcx} ${hcy + hry * 0.48} Q${hcx} ${hcy + hry * 0.66} ${hcx + 4} ${hcy + hry * 0.68}" stroke="${ink}" stroke-width="1.5" fill="none"/>`;
    const whisk = `<g stroke="${ink}" stroke-width="1" opacity="0.45" stroke-linecap="round"><path d="M${hcx - 6} ${hcy + hry * 0.4} Q${hcx - 19} ${hcy + hry * 0.28} ${hcx - 25} ${hcy + hry * 0.42}"/><path d="M${hcx - 6} ${hcy + hry * 0.55} Q${hcx - 19} ${hcy + hry * 0.6} ${hcx - 24} ${hcy + hry * 0.74}"/><path d="M${hcx + 6} ${hcy + hry * 0.4} Q${hcx + 19} ${hcy + hry * 0.28} ${hcx + 25} ${hcy + hry * 0.42}"/><path d="M${hcx + 6} ${hcy + hry * 0.55} Q${hcx + 19} ${hcy + hry * 0.6} ${hcx + 24} ${hcy + hry * 0.74}"/></g>`;
    const scarSvg = scar ? `<path d="M${hcx - hrx * 0.5} ${hcy - hry * 0.55} L${hcx - hrx * 0.08} ${hcy + hry * 0.25}" stroke="#f0d05a" stroke-width="2" stroke-linecap="round"/><path d="M${hcx - hrx * 0.44} ${hcy - hry * 0.4} l3 -1.2 M${hcx - hrx * 0.2} ${hcy + hry * 0.02} l3 -1.2" stroke="${ink}" stroke-width="1.2"/>` : "";
    const stripeSvg = stripe ? `<g stroke="${shade}" stroke-width="2.6" fill="none" stroke-linecap="round"><path d="M${hcx} ${hcy - hry} l0 7"/><path d="M${hcx - 6} ${hcy - hry * 0.92} l1.6 7"/><path d="M${hcx + 6} ${hcy - hry * 0.92} l-1.6 7"/></g>` : "";
    const collarSvg = collar ? `<path d="M${hcx - 13} ${hcy + hry * 0.9} Q50 ${hcy + hry * 1.35} ${hcx + 13} ${hcy + hry * 0.9} L${hcx + 11} ${hcy + hry * 1.2} Q50 ${hcy + hry * 1.6} ${hcx - 11} ${hcy + hry * 1.2} Z" fill="#a8322f" stroke="${ink}" stroke-width="1.6"/><circle cx="50" cy="${hcy + hry * 1.4}" r="3.2" fill="#f0c030" stroke="${ink}" stroke-width="1.2"/><circle cx="49" cy="${hcy + hry * 1.4 - 1}" r="1" fill="#fff" opacity="0.7"/>` : "";

    return `<svg viewBox="0 0 100 100">${glowDef}${shadow}${tail}${ears}${body}${paws}${collarSvg}${head}${stripeSvg}${muzzle}${nose}${mouth}${eyes}${brows}${scarSvg}${whisk}</svg>`;
  }

  // The hero: same cel-shaded treatment, built as a friendly golden dog —
  // floppy droopy ears, warm round eyes, a panting tongue.
  function buildDog() {
    const base = "#e6a445", shade = "#b9781f", light = "#ffce7a", belly = "#f9dea2", ink = "#3a2210", ear = "#a9661a";
    return (
      `<svg viewBox="0 0 100 100">` +
      `<ellipse cx="50" cy="98" rx="29" ry="5.5" fill="rgba(0,0,0,0.4)"/>` +
      `<path d="M30 87 C13 83 13 63 23 59 C19 69 25 81 37 83 Z" fill="${shade}" stroke="${ink}" stroke-width="2"/>` +
      `<path d="M28 37 C16 37 15 60 25 66 C31 60 33 47 34 41 Z" fill="${ear}" stroke="${ink}" stroke-width="2"/>` +
      `<path d="M72 37 C84 37 85 60 75 66 C69 60 67 47 66 41 Z" fill="${ear}" stroke="${ink}" stroke-width="2"/>` +
      `<path d="M50 53 C37 53 30 64 29 77 C28 88 34 96 43 96 L57 96 C66 96 72 88 71 77 C70 64 63 53 50 53 Z" fill="${base}" stroke="${ink}" stroke-width="2.4"/>` +
      `<path d="M50 60 C63 60 67 76 65 86 C63 93 58 96 55 96 L46 96 C58 94 60 78 54 66 Z" fill="${shade}" opacity="0.85"/>` +
      `<path d="M44 56 C37 58 33 66 34 74 C37 65 42 61 47 59 Z" fill="${light}" opacity="0.8"/>` +
      `<ellipse cx="50" cy="82" rx="11" ry="13" fill="${belly}"/>` +
      `<ellipse cx="42" cy="95" rx="6.5" ry="4.3" fill="${base}" stroke="${ink}" stroke-width="1.6"/><ellipse cx="58" cy="95" rx="6.5" ry="4.3" fill="${base}" stroke="${ink}" stroke-width="1.6"/>` +
      `<ellipse cx="50" cy="42" rx="23" ry="20" fill="${base}" stroke="${ink}" stroke-width="2.4"/>` +
      `<path d="M50 22 A23 20 0 0 1 73 42 A23 20 0 0 1 50 62 Q57 42 50 22 Z" fill="${shade}" opacity="0.5"/>` +
      `<path d="M28 36 A23 20 0 0 1 50 23 Q34 30 30 42 Z" fill="${light}" opacity="0.75"/>` +
      `<ellipse cx="50" cy="52" rx="14" ry="11" fill="${belly}"/>` +
      `<ellipse cx="40" cy="39" rx="4.2" ry="4.4" fill="#2c1a0c" stroke="${ink}" stroke-width="0.8"/><ellipse cx="60" cy="39" rx="4.2" ry="4.4" fill="#2c1a0c" stroke="${ink}" stroke-width="0.8"/>` +
      `<circle cx="41.4" cy="37.4" r="1.4" fill="#fff"/><circle cx="61.4" cy="37.4" r="1.4" fill="#fff"/>` +
      `<path d="M34 33 Q40 30 46 33" stroke="${ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M54 33 Q60 30 66 33" stroke="${ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/>` +
      `<ellipse cx="50" cy="48" rx="4.6" ry="3.5" fill="#231007" stroke="${ink}" stroke-width="0.8"/><ellipse cx="48.4" cy="46.7" rx="1.4" ry="0.9" fill="#5c4028"/>` +
      `<path d="M50 51 Q50 57 44 58 M50 51 Q50 57 56 58" stroke="${ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/>` +
      `<path d="M46 57 Q50 66 54 57 Z" fill="#ea7d8e" stroke="${ink}" stroke-width="1.2"/><path d="M50 58 v5" stroke="#c8586a" stroke-width="1"/>` +
      `</svg>`
    );
  }

  const DOG_ICON = buildDog();

  // Three distinct cats — different body types, not palette swaps: a lean
  // ginger Alley Cat with a torn ear and angry green eyes; an upright grey
  // Tabby Guard with a belled collar and round amber eyes; a big, wide,
  // scarred Big Tom with glowing red eyes and bared fangs.
  const ENEMY_ICONS = {
    alleyCat: buildCat({ pose: "lean", base: "#f0993c", shade: "#c06a1e", light: "#ffc878", belly: "#fbdca0", bellyLt: "#fff0cf", eyeCol: "#a6e84f", eyeShape: "angry", browAngry: 1, tornEar: 1, stripe: 1 }),
    tabbyGuard: buildCat({ pose: "tall", base: "#8996a4", shade: "#5c6874", light: "#c0cad4", belly: "#d6dee5", bellyLt: "#f2f6f9", eyeCol: "#ffc73a", eyeShape: "round", collar: 1, stripe: 1 }),
    bigTom: buildCat({ pose: "wide", base: "#3a2444", shade: "#22132a", light: "#5a3868", belly: "#4a2f56", bellyLt: "#6b4578", eyeCol: "#ff4536", eyeShape: "slit", browAngry: 1, scar: 1, fang: 1, glow: 1, noseCol: "#7a3040" }),
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
