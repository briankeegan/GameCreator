// Hypergolic Hull — canvas renderer + input, wired to engine.js/levels.js.
// GAME_ID must match data-game-id in index.html.
const GAME_ID = "hypergolic-hull";
const Engine = window.HypergolicEngine;

const HEX_SIZE_X = 32;
const HEX_SIZE_Y = 28;

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
const logEl = document.getElementById("log");
const overlayEl = document.getElementById("runOverlay");
const overlayTitleEl = document.getElementById("runOverlayTitle");
const overlayBodyEl = document.getElementById("runOverlayBody");
const restartBtn = document.getElementById("restartBtn");
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));

const level = HypergolicLevels.LEVELS[0];
let state = Engine.createGameState(level);
let mode = "sublight";
let bestDepth = GCStorage.get(GAME_ID, "bestDepth", 1);

function hexToPixel(hex) {
  return {
    x: HEX_SIZE_X * Math.sqrt(3) * (hex.q + hex.r / 2),
    y: HEX_SIZE_Y * 1.5 * hex.r,
  };
}

function hexCorner(center, i) {
  const angle = (Math.PI / 180) * (60 * i - 30);
  return { x: center.x + HEX_SIZE_X * Math.cos(angle), y: center.y + HEX_SIZE_Y * Math.sin(angle) };
}

function boardHexes(radius) {
  const hexes = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const hex = { q, r };
      if (Engine.inBounds(hex, radius)) hexes.push(hex);
    }
  }
  return hexes;
}

function resizeCanvas() {
  const wrap = canvas.parentElement;
  const cssWidth = Math.min(wrap.clientWidth, 520);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssWidth}px`;
  canvas.width = cssWidth * dpr;
  canvas.height = cssWidth * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
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

function draw() {
  const cssWidth = parseFloat(canvas.style.width) || 320;
  ctx.clearRect(0, 0, cssWidth, cssWidth);
  ctx.save();
  ctx.translate(cssWidth / 2, cssWidth / 2);

  const threats = Engine.computeThreatHexes(state);
  const legal = new Set(
    (MODES[mode].kind === "hex" ? MODES[mode].targets(state) : MODES[mode].targets(state)).map((h) =>
      Engine.hexKey(h)
    )
  );

  for (const hex of boardHexes(state.radius)) {
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
      ctx.fillStyle = state.exitUnlocked ? "#8ff0c0" : "#8892a8";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("GATE", center.x, center.y + 4);
    } else if (isOutpost) {
      ctx.fillStyle = "#bcd8e8";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("OUTPOST", center.x, center.y + 4);
    }
  }

  for (const enemy of Engine.livingEnemies(state)) {
    const center = hexToPixel(enemy);
    const isTarget = legal.has(Engine.hexKey(enemy));
    ctx.beginPath();
    ctx.arc(center.x, center.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = isTarget ? "#ff8f6b" : "#e0533f";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#241014";
    ctx.stroke();
  }

  if (state.fighterHex) {
    const center = hexToPixel(state.fighterHex);
    ctx.beginPath();
    ctx.arc(center.x, center.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#f2d16b";
    ctx.fill();
  }

  const playerCenter = hexToPixel(state.playerPos);
  ctx.beginPath();
  ctx.arc(playerCenter.x, playerCenter.y, 12, 0, Math.PI * 2);
  ctx.fillStyle = "#5bb8f2";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#0d2233";
  ctx.stroke();

  ctx.restore();
}

function pixelToHex(x, y) {
  const q = (Math.sqrt(3) / 3) * (x / HEX_SIZE_X) - (1 / 3) * (y / HEX_SIZE_Y);
  const r = (2 / 3) * (y / HEX_SIZE_Y);
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

function setMode(next) {
  if (state.status !== "playing") return;
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

function updateHud() {
  hullEl.textContent = `Hull ${state.hull}/${state.maxHull}`;
  levelEl.textContent = `Sector ${state.levelId} · Best ${bestDepth}`;
  logEl.textContent = state.log.slice(-3).join("  ·  ");

  if (state.status === "lost") {
    overlayTitleEl.textContent = "Flagship Destroyed";
    overlayBodyEl.textContent = "Permadeath. Your run ends here.";
    overlayEl.hidden = false;
  } else if (state.status === "won") {
    overlayTitleEl.textContent = "Level Complete";
    overlayBodyEl.textContent = "The Warp Gate carries you onward.";
    overlayEl.hidden = false;
  } else {
    overlayEl.hidden = true;
  }

  modeButtons.forEach((btn) => {
    const m = btn.dataset.mode;
    const disabled =
      state.status !== "playing" ||
      (m === "ramming" && state.rammingDisabled) ||
      (m === "fighter" && Boolean(state.fighterHex));
    btn.disabled = disabled;
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
  } catch (err) {
    pushMessage(err.message);
  }
  render();
}

canvas.addEventListener("click", (evt) => {
  if (state.status !== "playing") return;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = parseFloat(canvas.style.width) || 320;
  const scale = cssWidth / rect.width;
  const x = (evt.clientX - rect.left) * scale - cssWidth / 2;
  const y = (evt.clientY - rect.top) * scale - cssWidth / 2;
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

restartBtn.addEventListener("click", () => {
  state = Engine.createGameState(level);
  mode = "sublight";
  render();
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
render();
