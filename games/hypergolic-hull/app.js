// Hypergolic Hull — canvas renderer + input, wired to engine.js/levels.js.
// GAME_ID must match data-game-id in index.html.
const GAME_ID = "hypergolic-hull";
const Engine = window.HypergolicEngine;

const HEX_RATIO = 28 / 32; // pixel-art hex proportion: sy = sx * ratio
const SQRT3 = Math.sqrt(3);

const MODES = {
  sublight: { label: "Sublight Impulse", targets: Engine.legalSublightTargets, kind: "hex" },
  ramming: { label: "Ramming Speed", targets: Engine.legalRammingTargets, kind: "hex" },
  tractor: { label: "Tractor Beam", targets: Engine.legalTractorTargets, kind: "enemy" },
  fighter: { label: "Fighter Squadron", targets: Engine.legalFighterTargets, kind: "enemy" },
};

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const hullEl = document.getElementById("hull");
const levelEl = document.getElementById("levelLabel");
const objectiveEl = document.getElementById("objective");
const logEl = document.getElementById("log");
const overlayEl = document.getElementById("runOverlay");
const overlayTitleEl = document.getElementById("runOverlayTitle");
const overlayBodyEl = document.getElementById("runOverlayBody");
const restartBtn = document.getElementById("restartBtn");
const nextBtn = document.getElementById("nextBtn");
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));

// Everything on the board is an emoji sprite so the pieces read at a glance
// (see the legend under the action buttons).
const SPRITES = {
  player: "🚀",
  interceptor: "👾",
  fighters: "🛩️",
  gateLocked: "🔒",
  gateOnline: "🌀",
  outpost: "🛠️",
  boom: "💥",
};

const LEVELS = HypergolicLevels.LEVELS;
let levelIndex = 0;
let state = Engine.createGameState(LEVELS[levelIndex]);
let mode = "sublight";
let bestDepth = GCStorage.get(GAME_ID, "bestDepth", 1);

// ---- geometry: the canvas grows/shrinks (and gets taller) with the board --

let geom = { sx: 32, sy: 28, offX: 0, offY: 0, w: 320, h: 320 };

function updateGeometry() {
  const wrap = canvas.parentElement;
  const cssW = Math.min(wrap.clientWidth || 320, 520);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const h of state.boardHexes) {
    const x = SQRT3 * (h.q + h.r / 2);
    const y = 1.5 * HEX_RATIO * h.r;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pad = 10;
  const sx = (cssW - 2 * pad) / (maxX - minX + SQRT3);
  const cssH = Math.round((maxY - minY + 2 * HEX_RATIO) * sx + 2 * pad);
  geom = {
    sx,
    sy: sx * HEX_RATIO,
    offX: pad + (SQRT3 / 2 - minX) * sx,
    offY: pad + (HEX_RATIO - minY) * sx,
    w: cssW,
    h: cssH,
  };
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function hexToPixel(hex) {
  return {
    x: geom.offX + geom.sx * SQRT3 * (hex.q + hex.r / 2),
    y: geom.offY + geom.sy * 1.5 * hex.r,
  };
}

function pixelToHex(x, y) {
  const r = (2 / 3) * ((y - geom.offY) / geom.sy);
  const q = (x - geom.offX) / (geom.sx * SQRT3) - r / 2;
  return hexRound(q, r);
}

function hexRound(q, r) {
  const x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const xDiff = Math.abs(rx - x), yDiff = Math.abs(ry - y), zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

function hexCorner(center, i) {
  const angle = (Math.PI / 180) * (60 * i - 30);
  return { x: center.x + geom.sx * Math.cos(angle), y: center.y + geom.sy * Math.sin(angle) };
}

// ---- animations: short, non-blocking cues fed by engine events ------------

let anims = [];

function scheduleAnims(events) {
  const now = performance.now();
  for (const ev of events) {
    if (ev.type === "kill") anims.push({ kind: "boom", pos: ev, start: now, dur: 450 });
    else if (ev.type === "attack") anims.push({ kind: "lunge", enemyId: ev.enemyId, start: now, dur: 320 });
    else if (ev.type === "damage") anims.push({ kind: "flash", start: now, dur: 380 });
    else if (ev.type === "enemyMove") anims.push({ kind: "slide", enemyId: ev.enemyId, from: ev.from, to: ev.to, start: now, dur: 220 });
    else if (ev.type === "playerDeath") anims.push({ kind: "boom", pos: ev, start: now, dur: 650 });
  }
  if (anims.length) requestAnimationFrame(tickAnims);
}

function tickAnims() {
  draw();
  const now = performance.now();
  const stillRunning = anims.some((a) => now < a.start + a.dur);
  anims = anims.filter((a) => now < a.start + a.dur);
  if (stillRunning) requestAnimationFrame(tickAnims);
  else {
    draw();
    updateHud(); // reveal any win/lose overlay held back during the animation
  }
}

function animProgress(a, now) {
  return Math.min(1, Math.max(0, (now - a.start) / a.dur));
}

// ---- rendering -------------------------------------------------------------

function blend(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

function drawHex(center, fill, stroke) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const corner = hexCorner(center, i);
    if (i === 0) ctx.moveTo(corner.x, corner.y);
    else ctx.lineTo(corner.x, corner.y);
  }
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke || "#1a2233";
  ctx.stroke();
}

function drawSprite(center, glyph, size, alpha) {
  ctx.save();
  if (alpha !== undefined) ctx.globalAlpha = alpha;
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#dbe4f2";
  ctx.fillText(glyph, center.x, center.y + 1);
  ctx.restore();
}

function draw() {
  const now = performance.now();
  ctx.clearRect(0, 0, geom.w, geom.h);
  ctx.save();

  // Screen shake while a damage flash is running.
  const flash = anims.find((a) => a.kind === "flash" && now < a.start + a.dur);
  if (flash) {
    const p = animProgress(flash, now);
    ctx.translate(Math.sin(p * 30) * 4 * (1 - p), Math.cos(p * 23) * 3 * (1 - p));
  }

  const threats = Engine.computeThreatHexes(state);
  const legal = new Set(MODES[mode].targets(state).map((h) => Engine.hexKey(h)));

  for (const hex of state.boardHexes) {
    const center = hexToPixel(hex);
    const k = Engine.hexKey(hex);
    const isExit = Engine.posEq(hex, state.exitPos);
    const isOutpost = state.outpostPos && Engine.posEq(hex, state.outpostPos);
    const isHazard = Engine.hazardAt(state, hex);

    let fill = "#182238";
    if (isHazard) fill = "#3a1030";
    else if (isExit) fill = state.exitUnlocked ? "#1f4d3a" : "#2a2f45";
    else if (isOutpost) fill = "#2a3f4d";
    if (threats.has(k)) fill = blend(fill, "#7a1f2b", 0.55);
    if (legal.has(k)) fill = blend(fill, "#2f8f5b", 0.35);

    drawHex(center, fill, legal.has(k) ? "#7fe3a8" : "#1a2233");

    if (isExit) {
      drawSprite(center, state.exitUnlocked ? SPRITES.gateOnline : SPRITES.gateLocked, geom.sx * 0.62);
    } else if (isOutpost) {
      drawSprite(center, SPRITES.outpost, geom.sx * 0.56);
    }
  }

  // Per-enemy pixel overrides while a lunge/slide animation runs.
  const playerCenter = hexToPixel(state.playerPos);
  const overrides = new Map();
  for (const a of anims) {
    if (now >= a.start + a.dur) continue;
    const p = animProgress(a, now);
    if (a.kind === "slide") {
      const from = hexToPixel(a.from), to = hexToPixel(a.to);
      overrides.set(a.enemyId, { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p });
    } else if (a.kind === "lunge") {
      const enemy = state.enemies.find((e) => e.id === a.enemyId);
      if (enemy) {
        const base = hexToPixel(enemy);
        const t = Math.sin(p * Math.PI) * 0.45; // simple move-into-the-target and back
        overrides.set(a.enemyId, { x: base.x + (playerCenter.x - base.x) * t, y: base.y + (playerCenter.y - base.y) * t });
      }
    }
  }

  for (const enemy of Engine.livingEnemies(state)) {
    const base = hexToPixel(enemy);
    if (legal.has(Engine.hexKey(enemy))) {
      ctx.beginPath();
      ctx.arc(base.x, base.y, geom.sx * 0.47, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#7fe3a8";
      ctx.stroke();
    }
    drawSprite(overrides.get(enemy.id) || base, SPRITES[enemy.type] || SPRITES.interceptor, geom.sx * 0.69);
  }

  if (state.fighterHex) {
    drawSprite(hexToPixel(state.fighterHex), SPRITES.fighters, geom.sx * 0.47);
  }

  // The flagship: red hit-flash ring while taking damage; hidden once destroyed
  // (the explosion animation takes its place).
  if (state.status !== "lost") {
    if (flash) {
      const p = animProgress(flash, now);
      ctx.beginPath();
      ctx.arc(playerCenter.x, playerCenter.y, geom.sx * 0.56, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(224, 83, 63, ${0.55 * (1 - p)})`;
      ctx.fill();
    }
    drawSprite(playerCenter, SPRITES.player, geom.sx * 0.75);
  }

  // Explosions on top of everything.
  for (const a of anims) {
    if (a.kind !== "boom" || now >= a.start + a.dur) continue;
    const p = animProgress(a, now);
    drawSprite(hexToPixel(a.pos), SPRITES.boom, geom.sx * (0.6 + 0.7 * p), 1 - p * p);
  }

  ctx.restore();
}

// ---- HUD / state plumbing ---------------------------------------------------

function setMode(next) {
  if (state.status !== "playing" || !state.actions.includes(next)) return;
  mode = next;
  modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
  draw();
}

function persist() {
  GCStorage.set(GAME_ID, "run", state);
  if (state.status === "won") {
    bestDepth = Math.max(bestDepth, state.levelId);
    GCStorage.set(GAME_ID, "bestDepth", bestDepth);
  }
}

function animsRunning() {
  const now = performance.now();
  return anims.some((a) => now < a.start + a.dur);
}

function updateHud() {
  hullEl.textContent = `Hull ${state.hull}/${state.maxHull}`;
  levelEl.textContent = `Sector ${state.levelId}: ${state.levelName} · Best ${bestDepth}`;
  logEl.textContent = state.log.slice(-3).join("  ·  ");

  const remaining = Engine.livingEnemies(state).length;
  if (state.exitUnlocked) {
    objectiveEl.textContent = "Gate online — fly your 🚀 to the 🌀 to warp out!";
  } else {
    objectiveEl.textContent = `Destroy ${remaining} enemy ${remaining === 1 ? "ship" : "ships"} 👾 to power up the Warp Gate`;
  }

  // Hold the end-of-run overlay back until the death/kill animation finishes.
  if (state.status === "lost" && !animsRunning()) {
    overlayTitleEl.textContent = "Flagship Destroyed";
    overlayBodyEl.textContent = "Permadeath. Your run ends here.";
    nextBtn.hidden = true;
    overlayEl.hidden = false;
  } else if (state.status === "won" && !animsRunning()) {
    const hasNext = levelIndex + 1 < LEVELS.length;
    overlayTitleEl.textContent = "Sector Clear";
    overlayBodyEl.textContent = hasNext
      ? "The Warp Gate carries you onward."
      : "You've cleared every charted sector. More coming soon!";
    nextBtn.hidden = !hasNext;
    overlayEl.hidden = false;
  } else {
    overlayEl.hidden = true;
  }

  modeButtons.forEach((btn) => {
    const m = btn.dataset.mode;
    const locked = !state.actions.includes(m);
    btn.classList.toggle("locked", locked);
    btn.textContent = locked ? `🔒 ${MODES[m].label}` : MODES[m].label;
    btn.disabled =
      locked ||
      state.status !== "playing" ||
      (m === "ramming" && state.rammingDisabled) ||
      (m === "fighter" && Boolean(state.fighterHex));
  });
}

function render() {
  updateHud();
  draw();
  persist();
  window.__hhState = state; // debug hook: deterministic + serializable, safe to inspect
}

function pushMessage(message) {
  state.log.push(message);
  if (state.log.length > 20) state.log.shift();
}

function handleAction(fn) {
  try {
    fn();
    mode = "sublight";
    modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
    scheduleAnims(state.events);
  } catch (err) {
    pushMessage(err.message);
  }
  render();
}

function loadSector(index) {
  levelIndex = index;
  state = Engine.createGameState(LEVELS[levelIndex]);
  mode = "sublight";
  anims = [];
  updateGeometry();
  render();
}

canvas.addEventListener("click", (evt) => {
  if (state.status !== "playing") return;
  const rect = canvas.getBoundingClientRect();
  const scale = geom.w / rect.width;
  const x = (evt.clientX - rect.left) * scale;
  const y = (evt.clientY - rect.top) * scale;
  const hex = pixelToHex(x, y);

  if (MODES[mode].kind === "hex") {
    const legal = MODES[mode].targets(state);
    if (!legal.some((h) => Engine.posEq(h, hex))) return;
    handleAction(() => {
      if (mode === "sublight") Engine.applySublight(state, hex);
      else if (mode === "ramming") Engine.applyRamming(state, hex);
    });
  } else {
    const enemy = Engine.enemyAt(state, hex);
    if (!enemy) return;
    const legal = MODES[mode].targets(state);
    if (!legal.some((e) => e.id === enemy.id)) return;
    handleAction(() => {
      if (mode === "tractor") Engine.applyTractor(state, enemy.id);
      else if (mode === "fighter") Engine.applyFighter(state, enemy.id);
    });
  }
});

modeButtons.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));

restartBtn.addEventListener("click", () => loadSector(0));

nextBtn.addEventListener("click", () => {
  if (state.status !== "won" || levelIndex + 1 >= LEVELS.length) return;
  loadSector(levelIndex + 1);
});

window.addEventListener("resize", () => {
  updateGeometry();
  draw();
});

window.__hhHexCenter = (q, r) => hexToPixel({ q, r }); // debug/test hook: CSS-pixel center of a hex

loadSector(0);
