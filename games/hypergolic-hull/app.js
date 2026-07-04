// Hypergolic Hull — canvas renderer + input, wired to engine.js/levels.js.
// GAME_ID must match data-game-id in index.html.
const GAME_ID = "hypergolic-hull";
const Engine = window.HypergolicEngine;

const HEX_RATIO = 28 / 32; // pixel-art hex proportion: sy = sx * ratio
const SQRT3 = Math.sqrt(3);

// Sublight and Impulse Cannon aren't manually-armed modes anymore — movement
// always works via a plain tap (see the canvas click handler), and the Pulse
// Cannon auto-fires as a side effect of that movement (see engine.js). Only
// Tractor/Fighter still need you to pick a mode and then a target enemy.
const MODES = {
  tractor: { label: "Tractor Beam", targets: Engine.legalTractorTargets, kind: "enemy" },
  fighter: { label: "Fighter Squadron", targets: Engine.legalFighterTargets, kind: "enemy" },
};

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const boardWrapEl = document.getElementById("boardWrap");
const hullBarEl = document.getElementById("hullBar");
const levelEl = document.getElementById("levelLabel");
const objectiveEl = document.getElementById("objective");
const logEl = document.getElementById("log");
const overlayEl = document.getElementById("runOverlay");
const overlayTitleEl = document.getElementById("runOverlayTitle");
const overlayBodyEl = document.getElementById("runOverlayBody");
const restartBtn = document.getElementById("restartBtn");
const nextBtn = document.getElementById("nextBtn");
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
const helpBtn = document.getElementById("helpBtn");
const legendEl = document.getElementById("legend");
const toggleThreatEl = document.getElementById("toggleThreat");
const toggleLegalEl = document.getElementById("toggleLegal");
const toggleWarpdriveEl = document.getElementById("toggleWarpdrive");
const toggleRamEl = document.getElementById("toggleRam");
const holdBtn = document.getElementById("holdBtn");
const ramLabelEl = document.getElementById("ramLabel");
const ramLabelLegendEl = document.getElementById("ramLabelLegend");
const weaponStatsEl = document.getElementById("weaponStats");
const enemyInfoEl = document.getElementById("enemyInfo");

// The flagship and Interceptors are custom-drawn vector ships (see
// drawPlayerShip/drawEnemyShip below) — everything else on the board stays
// a plain emoji sprite so the pieces still read at a glance (see the legend
// under the action buttons).
const SPRITES = {
  fighters: "🛩️",
  gateLocked: "🔒",
  gateOnline: "🌀",
  outpost: "🛠️",
};

const LEVELS = HypergolicLevels.LEVELS;
let levelIndex = 0;
let state = Engine.createGameState(LEVELS[levelIndex]);
// null means no mode armed — plain moves/route-preview work regardless.
let mode = null;
let bestDepth = GCStorage.get(GAME_ID, "bestDepth", 1);

// Tap a far-away hex once to preview the quickest route, tap it again to fly
// it. plannedPath holds the preview; autoRoute drives the step-by-step flight
// (each step is a real turn — it aborts the moment the flagship takes damage).
let plannedPath = null;
let autoRoute = null;

// Whether the legend is open is a remembered player preference, not a
// per-sector default — it starts closed the first time you ever play, and
// after that just stays wherever you last left it (see the ❓ Help button).
let legendVisible = GCStorage.get(GAME_ID, "legendVisible", false);

// Each legend key can be independently muted while the legend is open. The
// bold/colored board overlays they describe only ever show while the legend
// itself is open — once it's tucked away, legal-move hexes fall back to a
// plain, always-on whitish border (see draw()) instead of disappearing.
let showThreatKey = true;
let showLegalKey = true;

// Tapping an enemy while Help is open inspects it — its stats/weapon/pattern
// show in a small card up top instead of (or alongside) acting on it.
let inspectedEnemyId = null;

// Whether the weapon-stats badge is showing its full sentence (tapped open)
// or just the compact abbreviation (the default).
let weaponStatsExpanded = false;

// The flagship's facing, in degrees (canvas convention: 0 = screen-right,
// increases clockwise). Updated whenever the ship actually moves.
const DIR_ANGLES = Engine.DIRECTIONS.map((d) => {
  const dx = SQRT3 * (d.q + d.r / 2);
  const dy = HEX_RATIO * 1.5 * d.r;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
});
let shipAngle = -90; // start facing "up", toward the gate; the custom ship shape is drawn nose-right at angle 0

// Continuous version of the DIR_ANGLES lookup above (which only covers the
// 6 adjacent-hex directions) — a weapon should aim straight at its actual
// target regardless of range, not just the direction the flagship walked.
function angleToward(from, to) {
  const dx = SQRT3 * (to.q - from.q + (to.r - from.r) / 2);
  const dy = HEX_RATIO * 1.5 * (to.r - from.r);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

// ---- geometry: the canvas grows/shrinks (and gets taller) with the board,
// bounded by both the available width AND height — the game area is a fixed
// cockpit that never scrolls, so the board has to letterbox to fit whatever
// room is actually left rather than just picking a height and hoping.

let geom = { sx: 32, sy: 28, offX: 0, offY: 0, w: 320, h: 320 };

function updateGeometry() {
  const availW = Math.min(boardWrapEl.clientWidth || 320, 520);
  const availH = boardWrapEl.clientHeight || 320;
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
  const sxFromWidth = (availW - 2 * pad) / (maxX - minX + SQRT3);
  const sxFromHeight = (availH - 2 * pad) / (maxY - minY + 2 * HEX_RATIO);
  const sx = Math.min(sxFromWidth, sxFromHeight);
  const cssW = Math.round((maxX - minX + SQRT3) * sx + 2 * pad);
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
  return { q: rx === 0 ? 0 : rx, r: rz === 0 ? 0 : rz }; // strip -0 so hexes compare cleanly
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
    if (ev.type === "kill") {
      anims.push({ kind: "boom", pos: ev, start: now, dur: 450, particles: makeExplosionParticles(9) });
      // A weapon's kill always comes after any playerMove event this same
      // turn, so this correctly overrides the movement-direction facing
      // above with "aim straight at what you just fired on" instead.
      if (ev.source === "weapon") shipAngle = angleToward(state.playerPos, ev);
    }
    else if (ev.type === "hit") {
      if (ev.source === "weapon") shipAngle = angleToward(state.playerPos, ev);
    }
    else if (ev.type === "attack") anims.push({ kind: "lunge", enemyId: ev.enemyId, start: now, dur: 320 });
    else if (ev.type === "damage") anims.push({ kind: "flash", start: now, dur: 380 });
    else if (ev.type === "enemyMove") anims.push({ kind: "slide", enemyId: ev.enemyId, from: ev.from, to: ev.to, start: now, dur: 220 });
    else if (ev.type === "playerMove") {
      anims.push({ kind: "pslide", from: ev.from, to: ev.to, start: now, dur: 230 });
      const dir = Engine.directionIndex(ev.from, ev.to);
      if (dir >= 0) shipAngle = DIR_ANGLES[dir];
    }
    else if (ev.type === "playerDeath") anims.push({ kind: "boom", pos: ev, start: now, dur: 650, particles: makeExplosionParticles(16) });
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

function drawHex(center, fill, stroke, lineWidth) {
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
  ctx.lineWidth = lineWidth || 1.5;
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

// ---- custom-drawn ships (no emoji) ----------------------------------------
// Both ships are authored nose-right (pointing along +x) at rotation 0, so
// callers just ctx.translate to the ship's center and ctx.rotate to its
// facing in degrees before calling these — no glyph-specific angle offset
// needed, unlike the emoji sprites these replaced.

// A tiny deterministic PRNG seeded from a string id, so a ship's crack
// pattern is stable frame-to-frame (Math.random() here would make the
// cracks flicker into new positions every repaint) but still differs per
// ship instance.
function seededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  return function next() {
    h = (Math.imul(h, 1103515245) + 12345) | 0;
    return ((h >>> 0) % 100000) / 100000;
  };
}

const crackCache = new Map();
function crackSpecsFor(seed) {
  if (crackCache.has(seed)) return crackCache.get(seed);
  const rng = seededRandom(seed);
  const specs = [];
  for (let i = 0; i < 6; i++) {
    specs.push({ angle: rng() * Math.PI * 2, len: 0.22 + rng() * 0.3, spread: 0.4 + rng() * 0.5 });
  }
  crackCache.set(seed, specs);
  return specs;
}

// Damage cracks fan out from the ship's center, more of them (and darker)
// the lower hpFrac gets — called inside the same rotated/translated space
// as the hull itself, so the pattern rides along with the ship.
function drawCracks(size, hpFrac, seed) {
  const damage = 1 - hpFrac;
  if (damage <= 0.02) return;
  const specs = crackSpecsFor(seed);
  const visible = Math.max(1, Math.round(damage * specs.length));
  ctx.save();
  ctx.strokeStyle = `rgba(10,8,10,${0.45 + 0.4 * damage})`;
  ctx.lineWidth = Math.max(1, size * 0.035);
  ctx.lineCap = "round";
  for (let i = 0; i < visible; i++) {
    const s = specs[i];
    const cx = Math.cos(s.angle) * size * 0.12;
    const cy = Math.sin(s.angle) * size * 0.12;
    const mx = cx + Math.cos(s.angle + s.spread) * size * s.len;
    const my = cy + Math.sin(s.angle + s.spread) * size * s.len;
    const ex = mx + Math.cos(s.angle - s.spread * 0.6) * size * s.len * 0.5;
    const ey = my + Math.sin(s.angle - s.spread * 0.6) * size * s.len * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(mx, my);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.restore();
}

// A detailed top-down fighter, authored nose-right (+x). Layered hull, swept
// wings with accent stripes and panel lines, a cockpit canopy with a glint,
// and twin engine nozzles that flare on thrust — styled after the reference
// sprite art. `pal` is the colorway (flagship gold, Interceptor purple).
function lgrad(x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function drawFighter(size, thrust, pal) {
  const s = size;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (thrust > 0) {
    ctx.fillStyle = lgrad(-s * 0.7, 0, -s * (1.5 + thrust), 0, [[0, pal.flame], [1, "rgba(0,0,0,0)"]]);
    ctx.beginPath();
    ctx.moveTo(-s * 0.62, -s * 0.18);
    ctx.lineTo(-s * (1.5 + thrust * 0.7), 0);
    ctx.lineTo(-s * 0.62, s * 0.18);
    ctx.closePath();
    ctx.fill();
  }

  // Swept wings (behind the fuselage), each with an accent stripe + panel line.
  const wing = (dir) => {
    ctx.beginPath();
    ctx.moveTo(s * 0.34, dir * s * 0.2);
    ctx.lineTo(-s * 0.5, dir * s * 1.02);
    ctx.lineTo(-s * 0.74, dir * s * 0.98);
    ctx.lineTo(-s * 0.45, dir * s * 0.34);
    ctx.lineTo(-s * 0.05, dir * s * 0.2);
    ctx.closePath();
    ctx.fillStyle = pal.wing;
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.05, dir * s * 0.26);
    ctx.lineTo(-s * 0.48, dir * s * 0.9);
    ctx.lineTo(-s * 0.6, dir * s * 0.88);
    ctx.lineTo(-s * 0.12, dir * s * 0.3);
    ctx.closePath();
    ctx.fillStyle = pal.accent;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.02, dir * s * 0.34);
    ctx.lineTo(-s * 0.5, dir * s * 0.9);
    ctx.strokeStyle = pal.panel;
    ctx.lineWidth = Math.max(0.5, s * 0.028);
    ctx.stroke();
  };
  wing(1);
  wing(-1);

  // Lower hull layer, showing at the edges for depth.
  ctx.beginPath();
  ctx.moveTo(s * 1.02, 0);
  ctx.lineTo(s * 0.2, -s * 0.42);
  ctx.lineTo(-s * 0.62, -s * 0.32);
  ctx.lineTo(-s * 0.62, s * 0.32);
  ctx.lineTo(s * 0.2, s * 0.42);
  ctx.closePath();
  ctx.fillStyle = pal.underhull;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = pal.outline;
  ctx.stroke();

  // Main fuselage (top plate).
  ctx.beginPath();
  ctx.moveTo(s * 0.98, 0);
  ctx.lineTo(s * 0.28, -s * 0.3);
  ctx.lineTo(-s * 0.5, -s * 0.24);
  ctx.lineTo(-s * 0.58, -s * 0.12);
  ctx.lineTo(-s * 0.58, s * 0.12);
  ctx.lineTo(-s * 0.5, s * 0.24);
  ctx.lineTo(s * 0.28, s * 0.3);
  ctx.closePath();
  ctx.fillStyle = lgrad(-s * 0.5, -s * 0.3, s, s * 0.3, pal.body);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.045);
  ctx.strokeStyle = pal.outline;
  ctx.stroke();

  // Nose accent.
  ctx.beginPath();
  ctx.moveTo(s * 0.96, 0);
  ctx.lineTo(s * 0.45, -s * 0.12);
  ctx.lineTo(s * 0.45, s * 0.12);
  ctx.closePath();
  ctx.fillStyle = pal.accent;
  ctx.fill();

  // Panel lines.
  ctx.strokeStyle = pal.panel;
  ctx.lineWidth = Math.max(0.5, s * 0.028);
  ctx.beginPath();
  ctx.moveTo(s * 0.2, -s * 0.24);
  ctx.lineTo(-s * 0.45, -s * 0.18);
  ctx.moveTo(s * 0.2, s * 0.24);
  ctx.lineTo(-s * 0.45, s * 0.18);
  ctx.moveTo(s * 0.05, -s * 0.2);
  ctx.lineTo(s * 0.05, s * 0.2);
  ctx.stroke();

  // Cockpit canopy with a glint.
  ctx.beginPath();
  ctx.ellipse(s * 0.34, 0, s * 0.2, s * 0.13, 0, 0, Math.PI * 2);
  ctx.fillStyle = pal.outline;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(s * 0.36, 0, s * 0.15, s * 0.09, 0, 0, Math.PI * 2);
  ctx.fillStyle = lgrad(s * 0.2, -s * 0.1, s * 0.5, s * 0.1, pal.glass);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(s * 0.4, -s * 0.02, s * 0.06, s * 0.035, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill();

  // Twin engine nozzles + glow.
  for (const dy of [-s * 0.16, s * 0.16]) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-s * 0.66, dy - s * 0.08, s * 0.16, s * 0.16, s * 0.03);
    else ctx.rect(-s * 0.66, dy - s * 0.08, s * 0.16, s * 0.16);
    ctx.fillStyle = pal.underhull;
    ctx.fill();
    ctx.lineWidth = Math.max(0.5, s * 0.03);
    ctx.strokeStyle = pal.outline;
    ctx.stroke();
    const r = s * (0.13 + 0.05 * thrust);
    const gl = ctx.createRadialGradient(-s * 0.6, dy, 0, -s * 0.6, dy, r);
    gl.addColorStop(0, pal.glow0);
    gl.addColorStop(0.5, pal.glow1);
    gl.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.arc(-s * 0.6, dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

const FLAGSHIP_PAL = {
  body: [[0, "#8a5320"], [0.5, "#e0862e"], [1, "#ffd08a"]],
  underhull: "#5a3a1c", wing: "#c47526", accent: "#e0533f", panel: "rgba(60,30,8,0.5)",
  glass: [[0, "#173a5c"], [1, "#8fd3ff"]], outline: "#2a1808",
  glow0: "rgba(190,245,255,0.95)", glow1: "rgba(70,180,230,0.5)", flame: "rgba(150,220,255,0.9)",
};
const ENEMY_PAL = {
  body: [[0, "#2a1030"], [0.5, "#5c2168"], [1, "#8b3a86"]],
  underhull: "#1a0a20", wing: "#7a1f4f", accent: "#e0533f", panel: "rgba(10,4,16,0.5)",
  glass: [[0, "#3a1030"], [1, "#ff8a9a"]], outline: "#0c0512",
  glow0: "rgba(255,150,120,0.95)", glow1: "rgba(200,50,40,0.55)", flame: "rgba(255,120,90,0.9)",
};

function drawPlayerShip(size, thrustFrac, hpFrac) {
  ctx.save();
  drawFighter(size, thrustFrac, FLAGSHIP_PAL);
  drawCracks(size, hpFrac, "player");
  ctx.restore();
}

function drawEnemyShip(size, hpFrac, crackSeed) {
  ctx.save();
  drawFighter(size, 0, ENEMY_PAL);
  drawCracks(size, hpFrac, crackSeed);
  ctx.restore();
}

// A radiating debris + fireball burst, replacing the old scaling 💥 emoji.
// `particles` is generated once when the anim is scheduled (see
// scheduleAnims) so the burst pattern is fixed for its whole lifetime
// instead of reshuffling every frame.
function drawExplosion(center, p, particles, maxSize) {
  ctx.save();
  const coreAlpha = 1 - p * p;
  const coreR = maxSize * (0.25 + 0.55 * p);
  const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, coreR);
  grad.addColorStop(0, `rgba(255,240,200,${coreAlpha})`);
  grad.addColorStop(0.4, `rgba(255,150,60,${coreAlpha * 0.8})`);
  grad.addColorStop(1, "rgba(200,40,20,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(center.x, center.y, coreR, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(255,205,130,${1 - p})`;
  ctx.lineWidth = Math.max(1, maxSize * 0.06 * (1 - p));
  ctx.lineCap = "round";
  for (const part of particles) {
    const dist = maxSize * part.speed * p * 1.6;
    const x1 = center.x + Math.cos(part.angle) * dist;
    const y1 = center.y + Math.sin(part.angle) * dist;
    const x2 = x1 + Math.cos(part.angle) * maxSize * part.len;
    const y2 = y1 + Math.sin(part.angle) * maxSize * part.len;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

function makeExplosionParticles(count) {
  const particles = [];
  for (let i = 0; i < count; i++) {
    particles.push({ angle: Math.random() * Math.PI * 2, speed: 0.4 + Math.random() * 0.5, len: 0.12 + Math.random() * 0.2 });
  }
  return particles;
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
  const legal = mode ? new Set(MODES[mode].targets(state).map((h) => Engine.hexKey(h))) : new Set();
  // The Impulse Cannon isn't a mode you arm anymore, but its current target
  // (dead ahead of facing, or every neighbor for an omnidirectional weapon)
  // is exactly the same kind of thing "outlined hex" already means, so it
  // gets folded into the same highlight instead of a separate one.
  if (state.actions.includes("ramming") && state.systems.ram) {
    for (const h of Engine.weaponHexes(state.playerPos, state.facing, Engine.WEAPONS.ram)) {
      if (Engine.onBoard(state, h)) legal.add(Engine.hexKey(h));
    }
  }
  // Mirrors the whitish hex border, but for enemies: any enemy an unlocked action could
  // ever target, regardless of which mode happens to be armed right now —
  // not just the one enemy set belonging to the currently-selected mode.
  const targetable = new Set([
    ...Engine.legalTractorTargets(state).map((e) => e.id),
    ...Engine.legalFighterTargets(state).map((e) => e.id),
  ]);
  const routeHexes = (plannedPath && plannedPath.hexes) || (autoRoute && autoRoute.path) || null;
  const route = new Set((routeHexes || []).slice(1).map((h) => Engine.hexKey(h)));

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
    // The red strike-range wash is one of the legend's toggleable keys —
    // like the legal-move outline below, it's only ever drawn while the
    // legend is open (and its own checkbox is checked).
    if (threats.has(k) && legendVisible && showThreatKey) fill = blend(fill, "#7a1f2b", 0.55);
    // Movable/targetable hexes keep their normal color — only the border
    // marks them, so the board doesn't turn into a wall of green.
    if (route.has(k)) fill = blend(fill, "#2e5f96", 0.45);

    // The whitish border marks a tile's own type ("this is normal, walkable
    // ground") — not whether anyone currently happens to be standing on it,
    // so an enemy or the flagship sitting on a tile doesn't hide it. Only
    // hazard tiles (which already read as different via their fill) skip it.
    // While the legend is open (and its checkbox is on), the current mode's
    // specific legal targets get a bold bright outline layered on top, right
    // next to the key explaining it.
    let stroke = "#1a2233";
    let strokeWidth = 1.5;
    if (!isHazard) {
      stroke = "#c9d6e8";
      strokeWidth = 0.75;
    }
    if (legendVisible && legal.has(k) && showLegalKey) {
      stroke = "#7fe3a8";
      strokeWidth = 3;
    }
    drawHex(center, fill, stroke, strokeWidth);

    if (isExit) {
      drawSprite(center, state.exitUnlocked ? SPRITES.gateOnline : SPRITES.gateLocked, geom.sx * 0.62);
    } else if (isOutpost) {
      drawSprite(center, SPRITES.outpost, geom.sx * 0.56);
    }
  }

  // Route preview: a dashed flight line with a ring on the destination.
  if (routeHexes && routeHexes.length > 1) {
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 5]);
    routeHexes.forEach((h, i) => {
      const c = hexToPixel(h);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.strokeStyle = "#8fc7ff";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.setLineDash([]);
    const t = hexToPixel(routeHexes[routeHexes.length - 1]);
    ctx.beginPath();
    ctx.arc(t.x, t.y, geom.sx * 0.38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
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
    // Same layering as the hex border: any targetable enemy always gets a
    // thin ring, regardless of which action mode is currently armed. The
    // bold ring on top is specific to the currently-armed mode's targets.
    if (targetable.has(enemy.id)) {
      ctx.beginPath();
      ctx.arc(base.x, base.y, geom.sx * 0.47, 0, Math.PI * 2);
      if (legendVisible && showLegalKey && legal.has(Engine.hexKey(enemy))) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#7fe3a8";
      } else {
        ctx.lineWidth = 0.75;
        ctx.strokeStyle = "#c9d6e8";
      }
      ctx.stroke();
    }
    const center = overrides.get(enemy.id) || base;
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate((angleToward(enemy, state.playerPos) * Math.PI) / 180);
    drawEnemyShip(geom.sx * 0.46, enemy.hp / enemy.maxHp, enemy.id);
    ctx.restore();
  }

  if (state.fighterHex) {
    drawSprite(hexToPixel(state.fighterHex), SPRITES.fighters, geom.sx * 0.47);
  }

  // The flagship: slides along its move, flashes red on damage, hidden once
  // destroyed (the explosion animation takes its place).
  if (state.status !== "lost") {
    let shipCenter = playerCenter;
    const pslide = anims.find((a) => a.kind === "pslide" && now < a.start + a.dur);
    if (pslide) {
      const p = animProgress(pslide, now);
      const from = hexToPixel(pslide.from), to = hexToPixel(pslide.to);
      shipCenter = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p };
    }
    if (flash) {
      const p = animProgress(flash, now);
      ctx.beginPath();
      ctx.arc(shipCenter.x, shipCenter.y, geom.sx * 0.56, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(224, 83, 63, ${0.55 * (1 - p)})`;
      ctx.fill();
    }
    ctx.save();
    ctx.translate(shipCenter.x, shipCenter.y);
    ctx.rotate((shipAngle * Math.PI) / 180);
    drawPlayerShip(geom.sx * 0.52, pslide ? 1 - Math.abs(animProgress(pslide, now) - 0.5) * 2 : 0, state.hull / state.maxHull);
    ctx.restore();
  }

  // Explosions on top of everything.
  for (const a of anims) {
    if (a.kind !== "boom" || now >= a.start + a.dur) continue;
    const p = animProgress(a, now);
    drawExplosion(hexToPixel(a.pos), p, a.particles, geom.sx * 0.9);
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
  hullBarEl.innerHTML = "";
  hullBarEl.setAttribute("aria-label", `Hull ${state.hull}/${state.maxHull}`);
  for (let i = 0; i < state.maxHull; i++) {
    const pip = document.createElement("span");
    pip.className = "hull-pip" + (i < state.hull ? " filled" : "");
    hullBarEl.appendChild(pip);
  }
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
      (m === "fighter" && Boolean(state.fighterHex));
  });
}

function updateLegend() {
  legendEl.classList.toggle("hidden", !legendVisible);
  helpBtn.classList.toggle("active", legendVisible);
}

// The Warpdrive/Impulse Cannon checkboxes and the Hold Position button —
// always available (not just when Warpdrive is off), since holding position
// on purpose to let an armed weapon fire without moving is a legitimate
// choice any turn, not just a fallback when movement is blocked.
function updateSystems() {
  toggleWarpdriveEl.checked = state.systems.warpdrive;
  toggleRamEl.checked = state.systems.ram;
  // The toggle itself is never locked out — you can flip it whether or not
  // the weapon is unlocked yet this sector; it just has nothing to do until
  // then (applyWeaponAutoAttacks in engine.js gates on `ramming` being
  // unlocked regardless of this switch's position).
  const unlocked = state.actions.includes("ramming");
  holdBtn.disabled = state.status !== "playing";

  // Read live off Engine.WEAPONS (rather than hardcoding text here) so the
  // label/stats can never drift from what the engine actually uses, and so
  // a future upgrade system that changes these numbers shows up here for
  // free instead of needing its own display code.
  const weapon = Engine.WEAPONS.ram;
  ramLabelEl.textContent = weapon.label;
  ramLabelLegendEl.textContent = weapon.label;
  // Tap the badge to inspect it: expands from the compact abbreviation to
  // the full Range/Damage/Pattern/Speed/Energy sentence, same "tap a thing
  // to learn about it" pattern as clicking an enemy while Help is open.
  // Stats are readable either way, locked or not — locked only means the
  // weapon isn't firing yet, not that you can't go look at its numbers.
  const lockedPrefix = unlocked ? "" : "🔒 ";
  weaponStatsEl.textContent = lockedPrefix + (weaponStatsExpanded ? describeWeapon(weapon) : describeWeaponCompact(weapon));
  weaponStatsEl.classList.toggle("expanded", weaponStatsExpanded);
}

// Shared by the systems-row stats line and the click-an-enemy-for-info panel
// below, so both always describe a weapon the same way.
function describePattern(weapon) {
  if (weapon.pattern.length >= 6) return "all directions";
  if (weapon.pattern.length === 1 && weapon.pattern[0] === 0) return "forward only";
  return `${weapon.pattern.length} directions`;
}

function describeWeapon(weapon) {
  return (
    `${weapon.label} — Range ${weapon.range} · Damage ${weapon.damage} · ` +
    `Pattern: ${describePattern(weapon)} · Speed ${weapon.speed} · Energy ${weapon.energyCost}`
  );
}

// Short enough to sit inline in the systems row next to the toggles and
// Hold Position instead of needing its own full-width line — the full
// sentence is still one tap/hover away via the title tooltip.
function describeWeaponCompact(weapon) {
  const pattern = weapon.pattern.length >= 6 ? "ALL" : "FWD";
  return `R${weapon.range} · D${weapon.damage} · SPD${weapon.speed} · E${weapon.energyCost} · ${pattern}`;
}

// The inspected enemy's card only ever shows while Help is open (it's a
// learn-the-board aid, same as the legend) and only for as long as that
// enemy is still alive on the board.
function updateEnemyInfo() {
  const enemy = inspectedEnemyId && state.enemies.find((e) => e.id === inspectedEnemyId && e.alive);
  if (!legendVisible || !enemy) {
    enemyInfoEl.hidden = true;
    return;
  }
  const def = Engine.ENEMY_TYPES[enemy.type];
  enemyInfoEl.hidden = false;
  enemyInfoEl.innerHTML = "";

  const header = document.createElement("div");
  header.className = "enemy-info-header";
  const hpPips = document.createElement("div");
  hpPips.className = "enemy-info-hp";
  for (let i = 0; i < enemy.maxHp; i++) {
    const pip = document.createElement("span");
    pip.className = "enemy-info-pip" + (i < enemy.hp ? " filled" : "");
    hpPips.appendChild(pip);
  }
  const name = document.createElement("span");
  name.textContent = enemy.type.toUpperCase();
  header.appendChild(name);
  header.appendChild(hpPips);
  enemyInfoEl.appendChild(header);

  const stats = document.createElement("div");
  stats.className = "enemy-info-stats";
  stats.textContent = describeWeapon(def.weapon);
  enemyInfoEl.appendChild(stats);
}

function render() {
  updateHud();
  updateLegend();
  updateSystems();
  updateEnemyInfo();
  draw();
  persist();
  window.__hhState = state; // debug hook: deterministic + serializable, safe to inspect
  window.__hhPlannedPath = plannedPath;
  window.__hhAutoRoute = autoRoute;
}

function pushMessage(message) {
  state.log.push(message);
  if (state.log.length > 20) state.log.shift();
}

function handleAction(fn) {
  plannedPath = null;
  try {
    fn();
    mode = null;
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
  mode = null;
  anims = [];
  plannedPath = null;
  autoRoute = null;
  shipAngle = -90;
  updateGeometry();
  render();
}

helpBtn.addEventListener("click", () => {
  legendVisible = !legendVisible;
  GCStorage.set(GAME_ID, "legendVisible", legendVisible);
  updateLegend();
  draw();
});

toggleThreatEl.addEventListener("change", () => {
  showThreatKey = toggleThreatEl.checked;
  draw();
});

toggleLegalEl.addEventListener("change", () => {
  showLegalKey = toggleLegalEl.checked;
  draw();
});

toggleWarpdriveEl.addEventListener("change", () => {
  Engine.setSystem(state, "warpdrive", toggleWarpdriveEl.checked);
  render();
});

toggleRamEl.addEventListener("change", () => {
  Engine.setSystem(state, "ram", toggleRamEl.checked);
  render();
});

weaponStatsEl.addEventListener("click", () => {
  weaponStatsExpanded = !weaponStatsExpanded;
  updateSystems();
});

holdBtn.addEventListener("click", () => {
  handleAction(() => Engine.applyHoldPosition(state));
});

// First tap on a distant hex: preview the quickest route. Second tap on the
// same hex: fly it, one real turn per step.
function planOrFlyRoute(hex) {
  if (Engine.posEq(hex, state.playerPos)) {
    plannedPath = null;
    render();
    return;
  }
  if (plannedPath && Engine.posEq(plannedPath.target, hex)) {
    autoRoute = { target: plannedPath.target, path: plannedPath.hexes, hullAtStart: state.hull };
    plannedPath = null;
    stepRoute();
    return;
  }
  const path = Engine.findPath(state, state.playerPos, hex);
  plannedPath = path && path.length > 1 ? { target: { q: hex.q, r: hex.r }, hexes: path } : null;
  render();
}

function stepRoute() {
  if (!autoRoute) return;
  const arrived = Engine.posEq(state.playerPos, autoRoute.target);
  const hurt = state.hull < autoRoute.hullAtStart;
  if (arrived || hurt || state.status !== "playing") {
    if (hurt && !arrived && state.status === "playing") pushMessage("Route aborted — taking fire!");
    autoRoute = null;
    render();
    return;
  }
  // Recompute each step: enemies move between turns and can block the way.
  const path = Engine.findPath(state, state.playerPos, autoRoute.target);
  if (!path || path.length < 2) {
    autoRoute = null;
    pushMessage("Route blocked.");
    render();
    return;
  }
  autoRoute.path = path;
  handleAction(() => Engine.applySublight(state, path[1]));
  if (autoRoute) setTimeout(stepRoute, 300);
}

canvas.addEventListener("click", (evt) => {
  if (state.status !== "playing" || autoRoute) return;

  const rect = canvas.getBoundingClientRect();
  const scale = geom.w / rect.width;
  const x = (evt.clientX - rect.left) * scale;
  const y = (evt.clientY - rect.top) * scale;
  const hex = pixelToHex(x, y);

  // Inspecting an enemy (while Help is open) is informational, not an
  // action — it doesn't consume the turn, so it works even with Warpdrive
  // offline, and doesn't preempt whatever the tap would otherwise do below.
  if (legendVisible) {
    const inspected = Engine.enemyAt(state, hex);
    if (inspected) {
      inspectedEnemyId = inspected.id;
      updateEnemyInfo();
    }
  }

  // Warpdrive offline means movement itself is off the table this turn, but
  // tapping an adjacent hex still re-aims the flagship toward it — free,
  // doesn't end the turn, doesn't move — so you can dial in a forward-only
  // weapon's direction before actually committing with Hold Position
  // (always available; see holdBtn below), the only way to end the turn
  // while Warpdrive's off.
  if (!state.systems.warpdrive) {
    const dir = Engine.directionIndex(state.playerPos, hex);
    if (dir >= 0) {
      Engine.setFacing(state, dir);
      shipAngle = DIR_ANGLES[dir]; // spin to show the new aim immediately
    } else {
      pushMessage("Warpdrive offline — tap an adjacent hex to aim, or Hold Position to act.");
    }
    render();
    return;
  }

  // Movement never needs a mode armed: any tap that isn't a legal target for
  // an armed Tractor/Fighter falls back to a plain move (adjacent) or the
  // route preview (further away). The Impulse Cannon auto-fires as a side
  // effect of the move itself — see engine.js — so there's no "ramming"
  // mode to arm either.
  const isPlainMove = Engine.legalSublightTargets(state).some((h) => Engine.posEq(h, hex));

  if (mode) {
    const enemy = Engine.enemyAt(state, hex);
    const legal = MODES[mode].targets(state);
    if (enemy && legal.some((e) => e.id === enemy.id)) {
      handleAction(() => {
        if (mode === "tractor") Engine.applyTractor(state, enemy.id);
        else if (mode === "fighter") Engine.applyFighter(state, enemy.id);
      });
      return;
    }
  }
  if (isPlainMove) {
    handleAction(() => Engine.applySublight(state, hex));
    return;
  }
  if (!Engine.enemyAt(state, hex)) planOrFlyRoute(hex);
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
