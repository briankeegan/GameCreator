// Hypergolic Hull — canvas renderer + input, wired to engine.js/levels.js.
// GAME_ID must match data-game-id in index.html.
const GAME_ID = "hypergolic-hull";
const Engine = window.HypergolicEngine;

const HEX_RATIO = 28 / 32; // pixel-art hex proportion: sy = sx * ratio
const SQRT3 = Math.sqrt(3);

// Flat-top hexes: a vertex points left/right, flat edges top/bottom. This
// (matched by buildBoardHexes' column-offset layout in engine.js) is what
// makes hex-direction {q:0,r:-1} a true single-step "up" and {q:0,r:1}
// "down" — Clubhouse feedback: "the board needs to be turned so you can go
// straight up," which pointy-top hexes genuinely cannot do in one step.
//
// pixel(q,r) = (sx * 1.5*q, sy * SQRT3*(r + q/2)) — center-to-center column
// spacing is 1.5*sx, row spacing (within a column) is SQRT3*sy, and
// adjacent columns are offset by half that. Corners sit at angles 0°, 60°,
// …, 300° (a vertex points due right at i=0), vs. pointy-top's -30° start.

// Sublight and Impulse Cannon aren't manually-armed modes anymore — movement
// always works via a plain tap (see the canvas click handler), and the Pulse
// Cannon auto-fires as a side effect of that movement (see engine.js). Only
// the Tractor Beam still needs you to pick a mode and then a target enemy.
const MODES = {
  tractor: {
    label: "Tractor Beam",
    targets: Engine.legalTractorTargets,
    kind: "enemy",
    // Shown in the objective line while armed (Clubhouse: "what IS Tractor
    // Beam... weird that I'm able to click on it" — arming a mode used to
    // give no in-the-moment hint at all about what to do next).
    hint: "Tractor armed — tap an enemy beside you to shove it",
  },
};

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const boardWrapEl = document.getElementById("boardWrap");
const hullBarEl = document.getElementById("hullBar");
const logEl = document.getElementById("log");
const overlayEl = document.getElementById("runOverlay");
const overlayTitleEl = document.getElementById("runOverlayTitle");
const overlayBodyEl = document.getElementById("runOverlayBody");
const restartBtn = document.getElementById("restartBtn");
const continueBtnEl = document.getElementById("continueBtn");
const salvageValueEl = document.getElementById("salvageValue");
const shieldWrapEl = document.getElementById("shieldWrap");
const shieldBarEl = document.getElementById("shieldBar");
const energyBarEl = document.getElementById("energyBar");
const hullWrapEl = document.getElementById("hullWrap");
const energyWrapEl = document.getElementById("energyWrap");
const salvageWrapEl = document.getElementById("salvageWrap");
const outpostOverlayEl = document.getElementById("outpostOverlay");
const outpostSalvageEl = document.getElementById("outpostSalvage");
const outpostOffersEl = document.getElementById("outpostOffers");
const outpostCloseBtn = document.getElementById("outpostCloseBtn");
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
const scanBtn = document.getElementById("scanBtn");
const shipBtn = document.getElementById("shipBtn");
const shipOverlayEl = document.getElementById("shipOverlay");
const shipStatsEl = document.getElementById("shipStats");
const shipHardpointsEl = document.getElementById("shipHardpoints");
const shipCloseBtn = document.getElementById("shipCloseBtn");
const mapBtn = document.getElementById("mapBtn");
const mapOverlayEl = document.getElementById("mapOverlay");
const mapChartEl = document.getElementById("mapChart");
const mapCloseBtn = document.getElementById("mapCloseBtn");
const targetLockBtn = document.getElementById("targetLockBtn");
const fireBtn = document.getElementById("fireBtn");
const rechargeBtn = document.getElementById("rechargeBtn");
const tractorStatsEl = document.getElementById("tractorStats");
const enemyInfoEl = document.getElementById("enemyInfo");
const scanReadoutEl = document.getElementById("scanReadout");
const scanHintEl = document.getElementById("scanHint");

// Every piece on the board is custom-drawn (see drawPlayerShip/
// drawEnemyShip/drawWarpGate/drawOutpost below) — no emoji
// sprites anywhere on the actual playfield.

const LEVELS = HypergolicLevels.LEVELS;
// The hand-authored campaign (LEVELS) is the tutorial; every sector past it
// is generated on demand — the run never hard-stops. Same LevelDef shape
// either way, so nothing downstream (engine, renderer, save system) needs
// to know or care which kind a given sector is. `variantId` picks which of
// a branching sector's Warp Gates you came through — see BRANCH_TINTS and
// the "Branching Warp Gates" note near drawWarpGate's call site below.
function levelForIndex(index, variantId) {
  return index < LEVELS.length ? LEVELS[index] : HypergolicLevels.generateLevel(index + 1, variantId);
}
let levelIndex = 0;

// Every procedurally-generated sector (past the hand-authored campaign)
// offers 2 Warp Gates instead of 1 — Clubhouse feedback: "different sort of
// paths you could take and options based on the different portals." Each
// gate's color is real and consistent (same variant always tends the same
// way — see generateLevel's BRANCH_VARIANTS in levels.js) but deliberately
// undocumented anywhere in the UI ("maybe color coordinated, but maybe not
// tell people") — it's meta-knowledge you pick up by flying them, not a
// stated rule. Single-exit sectors (the whole hand-authored campaign, plus
// the first procedural sector) pass no tint and get the original cyan gate.
const BRANCH_TINTS = {
  aggressive: [255, 120, 90], // warm — heavier resistance, less likely to have an Outpost
  quiet: [120, 190, 255], // cool — lighter resistance, more likely to have an Outpost
};
let state = Engine.createGameState(levelForIndex(levelIndex));
// null means no mode armed — plain moves/route-preview work regardless.
let mode = null;
let bestDepth = GCStorage.get(GAME_ID, "bestDepth", 1);

// Tap a far-away hex once to preview the quickest route, tap it again to fly
// it. plannedPath holds the preview; autoRoute drives the step-by-step flight
// (each step is a real turn — it aborts the moment the flagship takes damage).
let plannedPath = null;
let autoRoute = null;

// Whether Scan mode is open is a remembered player preference, not a
// per-sector default — it starts closed the first time you ever play, and
// after that just stays wherever you last left it (see the Scan button).
// Scan mode shows the legend AND is a real inspect-only mode: movement and
// every action lock out while it's open — the no-commitment way to look at
// anything on the board without acting on it.
let legendVisible = GCStorage.get(GAME_ID, "legendVisible", false);

// The full-screen Systems view ("a mode that goes full screen and shows
// ship and allows you to modify") — session-only, always starts closed.
let shipVisible = false;
// The starmap — same deal.
let mapVisible = false;


// A not-yet-unlocked action button is simply hidden, then just appears the
// sector it unlocks (see updateHud) — Clubhouse feedback: "what is tractor
// beam that suddenly appears?" The sector's intro line explains it, but
// that's easy to miss in the scrolling log. Every action/ability button
// pulses the FIRST time it's ever shown unused, across every run (tracked
// permanently, not just this sector) — see updateHud/markActionUsed.
let usedActions = new Set(GCStorage.get(GAME_ID, "usedActions", []));
function markActionUsed(m) {
  if (usedActions.has(m)) return;
  usedActions.add(m);
  GCStorage.set(GAME_ID, "usedActions", Array.from(usedActions));
}

// Tapping anything on the board in Scan mode inspects it — an enemy, the
// Warp Gate, the Outpost, the Wormhole, or an asteroid field — showing its
// info in a small card up top. Scan mode is inspect-only (see the canvas
// click handler below), so this never competes with acting on the tap.
let inspectedHex = null;

// Clearing a sector needs no confirmation at all now (Clubhouse feedback:
// "why say Next Sector each time... weird... there's no reason for a user
// to confirm as they go") — a warp-flash animation plays (see the "warp"
// case in draw(), triggered from handleAction), and the actual sector swap
// happens AT the flash's peak opacity (see the setTimeout in handleAction)
// so the map changes while it's fully obscured, not after the animation
// finishes and drops you into a hard cut. Permadeath still waits on a
// manual New Run tap — that's a weightier moment than a routine clear.
// Sectors aren't one-way — Clubhouse feedback: "the ability to go forward
// or backwards... you could potentially go back to an area you were at
// before," and it "shouldn't just be a button you click... a wormhole
// sort of thing." The run is a persistent CHART now, not an undo stack
// ("maze like, and maybe you can jump back and forth"): every sector
// entered stays on it, exactly as you left it, and you can jump to ANY
// charted sector — back via the wormhole (one step) or straight from the
// full-screen Map (tap a charted star). Advancing through a NEW gate from
// a rewound sector abandons the chain that used to be ahead of it.
let sectorHistory = []; // [{levelIndex, state}] — every sector entered, in order
let chartIndex = -1; // which chart entry is the LIVE sector

// The flagship spawns standing directly ON the wormhole when arriving via
// portal ("you start as if you're on top of that wormhole, not next to
// it" — Clubhouse feedback), which means Engine.wormholeAvailable is true
// from turn zero. Left unguarded, the very first action taken (e.g. Hold
// Position, without moving off it) would instantly bounce the flagship
// right back out before the player had done anything. This flag
// suppresses exactly that one action's trigger — set whenever a sector is
// (re)loaded, consumed by the first handleAction call afterward, however
// that first action turns out (move, hold, whatever).
let justArrived = false;

// Mirrors the live sector back into its chart slot — called before any
// jump/advance so the chart always holds each sector exactly as last left.
function snapshotLive() {
  if (chartIndex >= 0 && sectorHistory[chartIndex]) {
    sectorHistory[chartIndex] = { levelIndex, state: JSON.parse(JSON.stringify(state)) };
  }
}

function advanceSector() {
  snapshotLive();
  // Advancing from a rewound sector abandons the old forward chain — you
  // chose a gate, that's the route now.
  sectorHistory = sectorHistory.slice(0, chartIndex + 1);
  loadSector(
    levelIndex + 1,
    {
      salvage: state.salvage,
      maxHull: state.maxHull,
      shieldCharges: state.shieldCharges,
      maxEnergy: state.maxEnergy,
      weaponSlots: state.weaponSlots, // Hardpoint Expansions are permanent, same as Reactor/Hull upgrades
      // A purchased weapon (Lance Cannon, Repulsor, ...) isn't part of any
      // level's own baked-in actions list, so it has to be carried forward
      // explicitly or the next sector would "forget" it.
      extraActions: Engine.PURCHASABLE_ACTIONS.filter((a) => state.actions.includes(a)),
    },
    { keepWarpAnim: true, variantId: state.usedExitVariant }
  );
}

// Jump to ANY charted sector — the wormhole calls this with the previous
// index, the Map calls it with whatever star you tapped.
function jumpToChart(index) {
  if (index === chartIndex || index < 0 || index >= sectorHistory.length) return;
  snapshotLive();
  const entry = sectorHistory[index];
  // The wormhole-flash anim (if in flight) survives the swap, same as the
  // forward warp does in loadSector — it keeps covering the screen right
  // through the moment the map changes underneath it.
  const keptAnims = anims.filter((a) => a.kind === "wormhole");
  chartIndex = index;
  levelIndex = entry.levelIndex;
  state = JSON.parse(JSON.stringify(entry.state));
  // A snapshot may be mid-"won" (captured standing on the Warp Gate).
  // Un-consume that so the board is live again — winning re-triggers
  // normally on the next action taken on the gate.
  if (state.status === "won") state.status = "playing";
  justArrived = true; // don't let standing on the wormhole/gate instantly re-trigger
  mode = null;
  anims = keptAnims;
  announceSector();
  plannedPath = null;
  autoRoute = null;
  outpostDismissed = false;
  mapVisible = false;
  shipAngle = -90;
  updateGeometry();
  render();
}

function returnToPreviousSector() {
  jumpToChart(chartIndex - 1);
}

// The outpost shop pops up automatically the moment the flagship is docked
// on the outpost hex. "Undock" just hides it for as long as you stay parked
// there — flying off and back re-opens it, so this resets whenever the ship
// leaves the hex (see updateOutpost).
let outpostDismissed = false;

// Whether the Tractor Beam's stats badge is showing its full sentence
// (tapped open) or just the compact abbreviation (the default). The other
// weapons' stats live on the Ship screen now, spelled out in words — no
// badges left on the console for them.
let tractorStatsExpanded = false;

// The flagship's facing, in degrees (canvas convention: 0 = screen-right,
// increases clockwise). Updated whenever the ship actually moves.
const DIR_ANGLES = Engine.DIRECTIONS.map((d) => {
  const dx = 1.5 * d.q;
  const dy = SQRT3 * HEX_RATIO * (d.r + d.q / 2);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
});
let shipAngle = -90; // start facing "up", toward the gate; the custom ship shape is drawn nose-right at angle 0

// Continuous version of the DIR_ANGLES lookup above (which only covers the
// 6 adjacent-hex directions) — a weapon should aim straight at its actual
// target regardless of range, not just the direction the flagship walked.
function angleToward(from, to) {
  const dx = 1.5 * (to.q - from.q);
  const dy = SQRT3 * HEX_RATIO * (to.r - from.r + (to.q - from.q) / 2);
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
    const x = 1.5 * h.q;
    const y = SQRT3 * HEX_RATIO * (h.r + h.q / 2);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pad = 10;
  // Flat-top full extents (at unit sx=1): width (vertex-to-vertex) is 2,
  // height (flat-to-flat) is SQRT3*HEX_RATIO — the reverse pairing from
  // pointy-top, where width used the SQRT3 factor and height used 2.
  const sxFromWidth = (availW - 2 * pad) / (maxX - minX + 2);
  const sxFromHeight = (availH - 2 * pad) / (maxY - minY + SQRT3 * HEX_RATIO);
  const sx = Math.min(sxFromWidth, sxFromHeight);
  const cssW = Math.round((maxX - minX + 2) * sx + 2 * pad);
  const cssH = Math.round((maxY - minY + SQRT3 * HEX_RATIO) * sx + 2 * pad);
  geom = {
    sx,
    sy: sx * HEX_RATIO,
    offX: pad + (1 - minX) * sx,
    offY: pad + ((SQRT3 * HEX_RATIO) / 2 - minY) * sx,
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
    x: geom.offX + geom.sx * 1.5 * hex.q,
    y: geom.offY + geom.sy * SQRT3 * (hex.r + hex.q / 2),
  };
}

function pixelToHex(x, y) {
  const q = (2 / 3) * ((x - geom.offX) / geom.sx);
  const r = (y - geom.offY) / (geom.sy * SQRT3) - q / 2;
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
  const angle = (Math.PI / 180) * (60 * i); // flat-top: a vertex points due right at i=0 (no -30° offset)
  return { x: center.x + geom.sx * Math.cos(angle), y: center.y + geom.sy * Math.sin(angle) };
}

// ---- animations: short, non-blocking cues fed by engine events ------------

let anims = [];

// The sector's name sweeps across the viewport on arrival, then fades —
// replacing the permanent "SECTOR 1 — OUTER REACH" chip that sat over the
// board as clutter. You learn where you are the moment you get there; the
// Map remembers it after that.
function announceSector() {
  anims.push({ kind: "sectorTitle", name: state.levelName, start: performance.now(), dur: 2600 });
  requestAnimationFrame(tickAnims);
}

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
    else if (ev.type === "energyGain") {
      anims.push({ kind: "efloat", amount: `+${ev.amount}`, pos: { q: state.playerPos.q, r: state.playerPos.r }, start: now, dur: 900 });
    }
    else if (ev.type === "energySpend") {
      // A rising "-N ENERGY" over the flagship on every paid shot — the
      // energy economy was invisible without it (a Shockwave turn drains
      // and regens between renders, so only a live cue shows the spend).
      const priorFloats = anims.filter((a) => a.kind === "efloat").length;
      anims.push({ kind: "efloat", amount: `-${ev.amount}`, pos: { q: state.playerPos.q, r: state.playerPos.r }, start: now + priorFloats * 260, dur: 900 });
    }
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

function drawHex(center, fill, stroke, lineWidth, fillAlpha) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const corner = hexCorner(center, i);
    if (i === 0) ctx.moveTo(corner.x, corner.y);
    else ctx.lineTo(corner.x, corner.y);
  }
  ctx.closePath();
  if (fill) {
    // Translucent — an opaque fill would completely paint over the sector
    // backdrop's stars/nebula (which is clipped to this exact same hex
    // silhouette), hiding them instead of just keeping them off the
    // unreachable canvas corners. Plain floor defaults to mostly
    // transparent (Clubhouse feedback: "the blocks... can just be
    // transparent for the most part... you just have unique backgrounds
    // that look really cool per sector"); callers pass a higher alpha for
    // tiles that need to read clearly regardless of the backdrop
    // (hazards, the exit, the outpost, threat/route highlights).
    ctx.save();
    ctx.globalAlpha = fillAlpha === undefined ? 0.22 : fillAlpha;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }
  ctx.lineWidth = lineWidth || 1.5;
  ctx.strokeStyle = stroke || "#1a2233";
  ctx.stroke();
}

// ---- ship sprites -----------------------------------------------------------
// The flagship and Interceptor are pixel-art PNGs generated via the
// "Generate game asset" pipeline (games/hypergolic-hull/art-style.json),
// with the old hand-drawn vector shapes (drawHero/drawEnemyFighter, below)
// kept as a fallback for the brief window before an image finishes loading
// (or if it 404s). The source art is authored nose-UP; every caller here
// (shipAngle, DIR_ANGLES, angleToward) assumes nose-RIGHT at rotation 0 —
// drawShipImage() rotates 90° internally to reconcile the two so nothing
// else about the rotation math has to change.
const flagshipImg = new Image();
flagshipImg.src = "icons/flagship.png";
flagshipImg.onload = () => draw();
const interceptorImg = new Image();
interceptorImg.src = "icons/interceptor.png";
interceptorImg.onload = () => draw();

function drawShipImage(img, s) {
  if (!img.complete || !img.naturalWidth) return false;
  ctx.save();
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -s * 1.1, -s * 1.1, s * 2.2, s * 2.2);
  ctx.restore();
  return true;
}

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

function lgrad(x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

// The flagship is deliberately NOT a jet: it's a chunky industrial gunship —
// a "hull" — with a blunt rounded nose, twin barrel engines, side armor pods
// and a cockpit dome, matching the orange reference sprite. Authored
// nose-right (+x); the caller rotates it to facing.
function rivets(pts, r, col) {
  ctx.fillStyle = col;
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHero(s, thrust) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const O = "#241407";

  if (thrust > 0) {
    for (const dy of [-s * 0.34, s * 0.34]) {
      ctx.fillStyle = lgrad(-s * 0.9, dy, -s * (1.5 + thrust), dy, [[0, "rgba(255,255,255,.9)"], [0.3, "rgba(150,220,255,.8)"], [1, "rgba(80,180,230,0)"]]);
      ctx.beginPath();
      ctx.moveTo(-s * 0.9, dy - s * 0.13);
      ctx.lineTo(-s * (1.5 + thrust * 0.6), dy);
      ctx.lineTo(-s * 0.9, dy + s * 0.13);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Twin barrel engines: gunmetal cylinders with top sheen, banding, hot core.
  for (const dy of [-s * 0.34, s * 0.34]) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-s * 0.98, dy - s * 0.21, s * 1.18, s * 0.42, s * 0.13);
    else ctx.rect(-s * 0.98, dy - s * 0.21, s * 1.18, s * 0.42);
    ctx.fillStyle = lgrad(0, dy - s * 0.21, 0, dy + s * 0.21, [[0, "#aab4c0"], [0.35, "#7a8492"], [0.65, "#4a5460"], [1, "#2e3742"]]);
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.strokeStyle = O;
    ctx.stroke();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-s * 0.9, dy - s * 0.17, s * 1.0, s * 0.09, s * 0.04);
    else ctx.rect(-s * 0.9, dy - s * 0.17, s * 1.0, s * 0.09);
    ctx.fillStyle = "rgba(255,255,255,.28)";
    ctx.fill();
    ctx.strokeStyle = "rgba(15,20,28,.65)";
    ctx.lineWidth = Math.max(1, s * 0.045);
    for (const bx of [-0.6, -0.28, 0.05]) {
      ctx.beginPath();
      ctx.moveTo(s * bx, dy - s * 0.19);
      ctx.lineTo(s * bx, dy + s * 0.19);
      ctx.stroke();
    }
    const gl = ctx.createRadialGradient(-s * 0.92, dy, 0, -s * 0.92, dy, s * (0.17 + 0.06 * thrust));
    gl.addColorStop(0, "rgba(255,255,255,.95)");
    gl.addColorStop(0.4, "rgba(150,230,255,.8)");
    gl.addColorStop(1, "rgba(70,180,230,0)");
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.arc(-s * 0.92, dy, s * (0.17 + 0.06 * thrust), 0, Math.PI * 2);
    ctx.fill();
  }

  // Main hull: chunky blunt-nosed body.
  const hull = () => {
    ctx.beginPath();
    ctx.moveTo(s * 0.72, -s * 0.18);
    ctx.quadraticCurveTo(s * 1.02, -s * 0.14, s * 1.02, 0);
    ctx.quadraticCurveTo(s * 1.02, s * 0.14, s * 0.72, s * 0.18);
    ctx.lineTo(s * 0.2, s * 0.5);
    ctx.lineTo(-s * 0.6, s * 0.46);
    ctx.lineTo(-s * 0.72, s * 0.2);
    ctx.lineTo(-s * 0.72, -s * 0.2);
    ctx.lineTo(-s * 0.6, -s * 0.46);
    ctx.lineTo(s * 0.2, -s * 0.5);
    ctx.closePath();
  };
  hull();
  ctx.fillStyle = lgrad(-s * 0.6, -s * 0.45, s * 0.9, s * 0.45, [[0, "#a85f22"], [0.45, "#e88a30"], [0.75, "#ffab52"], [1, "#ffd89a"]]);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.055);
  ctx.strokeStyle = O;
  ctx.stroke();

  // Glossy top sheen + centerline shadow trough (clipped to the hull).
  ctx.save();
  hull();
  ctx.clip();
  ctx.fillStyle = "rgba(255,246,220,.32)";
  ctx.beginPath();
  ctx.moveTo(s * 0.9, -s * 0.06);
  ctx.lineTo(s * 0.1, -s * 0.44);
  ctx.lineTo(-s * 0.6, -s * 0.4);
  ctx.lineTo(-s * 0.6, -s * 0.16);
  ctx.lineTo(s * 0.5, -s * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(90,44,10,.4)";
  ctx.beginPath();
  ctx.moveTo(s * 0.55, 0);
  ctx.lineTo(-s * 0.6, -s * 0.16);
  ctx.lineTo(-s * 0.66, 0);
  ctx.lineTo(-s * 0.6, s * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Panel seams + rivets.
  ctx.strokeStyle = "rgba(50,24,6,.55)";
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(s * 0.2, -s * 0.48);
  ctx.lineTo(s * 0.2, s * 0.48);
  ctx.moveTo(-s * 0.22, -s * 0.45);
  ctx.lineTo(-s * 0.22, s * 0.45);
  ctx.moveTo(s * 0.56, -s * 0.15);
  ctx.lineTo(s * 0.56, s * 0.15);
  ctx.stroke();
  rivets([[s * 0.2, -s * 0.4], [s * 0.2, -s * 0.2], [s * 0.2, s * 0.2], [s * 0.2, s * 0.4], [-s * 0.22, -s * 0.36], [-s * 0.22, 0], [-s * 0.22, s * 0.36]], Math.max(0.6, s * 0.022), "rgba(40,20,4,.6)");

  // Hull insignia plate near the nose.
  ctx.fillStyle = "rgba(40,20,4,.5)";
  ctx.fillRect(s * 0.12 - s * 0.03, -s * 0.13, s * 0.06, s * 0.26);

  // Side armor pods with wingtip running lights.
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, dir * s * 0.44);
    ctx.lineTo(-s * 0.35, dir * s * 0.66);
    ctx.lineTo(-s * 0.55, dir * s * 0.62);
    ctx.lineTo(-s * 0.5, dir * s * 0.42);
    ctx.closePath();
    ctx.fillStyle = lgrad(-s * 0.1, 0, -s * 0.55, dir * s * 0.6, [[0, "#8a5420"], [1, "#5a3610"]]);
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.strokeStyle = O;
    ctx.stroke();
    ctx.fillStyle = "#ffd24a";
    ctx.beginPath();
    ctx.arc(-s * 0.45, dir * s * 0.58, s * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rim light on the lit upper edge.
  ctx.strokeStyle = "rgba(255,240,200,.5)";
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(s * 0.2, -s * 0.49);
  ctx.lineTo(s * 0.7, -s * 0.19);
  ctx.quadraticCurveTo(s * 1.0, -s * 0.14, s * 1.0, -s * 0.02);
  ctx.stroke();

  // Cockpit dome.
  ctx.beginPath();
  ctx.ellipse(s * 0.52, 0, s * 0.23, s * 0.17, 0, 0, Math.PI * 2);
  ctx.fillStyle = O;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(s * 0.54, 0, s * 0.16, s * 0.11, 0, 0, Math.PI * 2);
  ctx.fillStyle = lgrad(s * 0.38, -s * 0.12, s * 0.72, s * 0.12, [[0, "#0d2740"], [0.6, "#2f7fb0"], [1, "#bff0ff"]]);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(s * 0.6, -s * 0.04, s * 0.06, s * 0.04, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,.7)";
  ctx.fill();
}

// The Interceptor is the opposite silhouette: a sleek predator with a narrow
// dagger fuselage, long swept blade-wings, and a single glowing red sensor
// eye — angular and aggressive where the flagship is chunky and rugged.
function drawEnemyFighter(s, thrust) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const O = "#0c0512";

  if (thrust > 0) {
    ctx.fillStyle = lgrad(-s * 0.6, 0, -s * (1.4 + thrust), 0, [[0, "rgba(255,180,120,.9)"], [0.3, "rgba(255,90,60,.8)"], [1, "rgba(0,0,0,0)"]]);
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, -s * 0.12);
    ctx.lineTo(-s * (1.4 + thrust * 0.7), 0);
    ctx.lineTo(-s * 0.55, s * 0.12);
    ctx.closePath();
    ctx.fill();
  }

  // Long swept blade wings with a glowing leading edge and a tip light.
  const wing = (dir) => {
    ctx.beginPath();
    ctx.moveTo(s * 0.5, dir * s * 0.06);
    ctx.lineTo(-s * 0.15, dir * s * 1.18);
    ctx.lineTo(-s * 0.33, dir * s * 1.14);
    ctx.lineTo(-s * 0.35, dir * s * 0.2);
    ctx.closePath();
    ctx.fillStyle = lgrad(0, 0, 0, dir * s * 1.1, [[0, "#8a2456"], [0.5, "#5a1740"], [1, "#2e0c26"]]);
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.045);
    ctx.strokeStyle = O;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.46, dir * s * 0.08);
    ctx.lineTo(-s * 0.15, dir * s * 1.12);
    ctx.strokeStyle = "rgba(255,120,90,.5)";
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.stroke();
    ctx.strokeStyle = "#ff5540";
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.stroke();
    ctx.fillStyle = "#ff6a4a";
    ctx.beginPath();
    ctx.arc(-s * 0.22, dir * s * 1.08, s * 0.04, 0, Math.PI * 2);
    ctx.fill();
  };
  wing(1);
  wing(-1);

  // Narrow dagger fuselage.
  const fus = () => {
    ctx.beginPath();
    ctx.moveTo(s * 1.08, 0);
    ctx.lineTo(s * 0.1, -s * 0.26);
    ctx.lineTo(-s * 0.5, -s * 0.2);
    ctx.lineTo(-s * 0.62, -s * 0.09);
    ctx.lineTo(-s * 0.62, s * 0.09);
    ctx.lineTo(-s * 0.5, s * 0.2);
    ctx.lineTo(s * 0.1, s * 0.26);
    ctx.closePath();
  };
  fus();
  ctx.fillStyle = lgrad(-s * 0.5, -s * 0.28, s * 0.9, s * 0.28, [[0, "#1c0a24"], [0.45, "#42184f"], [0.75, "#6b2b6f"], [1, "#9a4593"]]);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = O;
  ctx.stroke();

  // Top sheen, spine, and angular panel cuts (clipped to the fuselage).
  ctx.save();
  fus();
  ctx.clip();
  ctx.fillStyle = "rgba(200,140,220,.25)";
  ctx.beginPath();
  ctx.moveTo(s * 0.9, -s * 0.03);
  ctx.lineTo(s * 0.05, -s * 0.22);
  ctx.lineTo(-s * 0.5, -s * 0.16);
  ctx.lineTo(-s * 0.5, -s * 0.04);
  ctx.lineTo(s * 0.6, -s * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(10,4,16,.6)";
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(s * 0.9, 0);
  ctx.lineTo(-s * 0.5, 0);
  ctx.moveTo(s * 0.55, -s * 0.18);
  ctx.lineTo(s * 0.35, 0);
  ctx.lineTo(s * 0.55, s * 0.18);
  ctx.stroke();
  ctx.restore();

  // Rim light along the top edge.
  ctx.strokeStyle = "rgba(230,160,240,.45)";
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(s * 1.02, -s * 0.02);
  ctx.lineTo(s * 0.1, -s * 0.24);
  ctx.lineTo(-s * 0.5, -s * 0.18);
  ctx.stroke();

  // Glowing red sensor eye with a flare streak.
  const eye = ctx.createRadialGradient(s * 0.4, 0, 0, s * 0.4, 0, s * 0.24);
  eye.addColorStop(0, "rgba(255,240,220,1)");
  eye.addColorStop(0.3, "rgba(255,70,50,.98)");
  eye.addColorStop(1, "rgba(200,30,25,0)");
  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.arc(s * 0.4, 0, s * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(s * 0.4, 0, s * 0.055, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,120,90,.5)";
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.beginPath();
  ctx.moveTo(s * 0.12, 0);
  ctx.lineTo(s * 0.68, 0);
  ctx.stroke();

  for (const dy of [-s * 0.12, s * 0.12]) {
    const gl = ctx.createRadialGradient(-s * 0.58, dy, 0, -s * 0.58, dy, s * 0.13);
    gl.addColorStop(0, "rgba(255,200,150,.9)");
    gl.addColorStop(0.5, "rgba(220,60,45,.55)");
    gl.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.arc(-s * 0.58, dy, s * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayerShip(size, thrustFrac, hpFrac) {
  ctx.save();
  if (!drawShipImage(flagshipImg, size)) {
    drawHero(size, thrustFrac);
  }
  drawCracks(size, hpFrac, "player");
  ctx.restore();
}

// A Heavy Cruiser: a chunky armored gunship, clearly bulkier than the
// dagger-like Interceptor, in cold steel-blue with a crimson armor stripe and
// twin forward guns — reads instantly as "the tanky one." Authored nose-right.
function drawCruiser(s) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const O = "#0a0a12";
  for (const dy of [-s * 0.34, s * 0.34]) {
    const gl = ctx.createRadialGradient(-s * 0.78, dy, 0, -s * 0.78, dy, s * 0.22);
    gl.addColorStop(0, "rgba(255,210,160,.9)");
    gl.addColorStop(0.5, "rgba(255,90,50,.5)");
    gl.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.arc(-s * 0.78, dy, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  const hull = () => {
    ctx.beginPath();
    ctx.moveTo(s * 1.02, 0);
    ctx.lineTo(s * 0.52, -s * 0.5);
    ctx.lineTo(-s * 0.5, -s * 0.62);
    ctx.lineTo(-s * 0.85, -s * 0.32);
    ctx.lineTo(-s * 0.85, s * 0.32);
    ctx.lineTo(-s * 0.5, s * 0.62);
    ctx.lineTo(s * 0.52, s * 0.5);
    ctx.closePath();
  };
  hull();
  ctx.fillStyle = lgrad(-s * 0.6, -s * 0.5, s * 0.9, s * 0.5, [[0, "#22303f"], [0.45, "#3b5568"], [0.75, "#5c7d92"], [1, "#8fb0c4"]]);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.strokeStyle = O;
  ctx.stroke();
  ctx.save();
  hull();
  ctx.clip();
  ctx.fillStyle = "rgba(196,44,52,.9)";
  ctx.fillRect(-s * 0.22, -s * 0.7, s * 0.26, s * 1.4);
  ctx.strokeStyle = "rgba(10,14,20,.55)";
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(s * 0.9, 0);
  ctx.lineTo(-s * 0.8, 0);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#2a3a48";
  for (const dy of [-s * 0.28, s * 0.28]) ctx.fillRect(s * 0.5, dy - s * 0.05, s * 0.52, s * 0.1);
  const eye = ctx.createRadialGradient(s * 0.05, 0, 0, s * 0.05, 0, s * 0.24);
  eye.addColorStop(0, "rgba(220,245,255,1)");
  eye.addColorStop(0.4, "rgba(90,180,255,.95)");
  eye.addColorStop(1, "rgba(30,80,160,0)");
  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.arc(s * 0.05, 0, s * 0.24, 0, Math.PI * 2);
  ctx.fill();
}

// A Sentry Turret: a stationary hexagonal gun platform (not a ship — no nose),
// in toxic teal-green with three radiating barrels and a big green sensor eye.
// Drawn axis-aligned; the caller does NOT rotate it toward the player.
function drawSentry(s) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const O = "#06120f";
  const hexPath = (rad) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = "#0c241f";
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * 2 * Math.PI) / 3);
    ctx.fillRect(s * 0.35, -s * 0.09, s * 0.78, s * 0.18);
    ctx.strokeStyle = O;
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.strokeRect(s * 0.35, -s * 0.09, s * 0.78, s * 0.18);
    ctx.restore();
  }
  hexPath(s * 0.92);
  ctx.fillStyle = lgrad(-s * 0.7, -s * 0.7, s * 0.7, s * 0.7, [[0, "#0f2a26"], [0.5, "#1c4a41"], [1, "#2f6f60"]]);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.strokeStyle = O;
  ctx.stroke();
  hexPath(s * 0.58);
  ctx.fillStyle = "#123a33";
  ctx.fill();
  ctx.stroke();
  const eye = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.32);
  eye.addColorStop(0, "rgba(230,255,235,1)");
  eye.addColorStop(0.35, "rgba(70,240,150,.95)");
  eye.addColorStop(1, "rgba(20,120,80,0)");
  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

// The Railgun Destroyer — a stationary hexagonal platform like the Sentry,
// but with a long barrel down all 6 axes instead of 3 short arms (marking
// it as the long-range unit at a glance) and a cold blue/steel palette
// instead of the Sentry's green, so the two stationary turrets never read
// as the same threat from a distance.
function drawRailgun(s) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const O = "#06101a";
  const hexPath = (rad) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = "#0c1b24";
  ctx.strokeStyle = O;
  ctx.lineWidth = Math.max(1, s * 0.05);
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 3);
    ctx.fillRect(s * 0.35, -s * 0.06, s * 1.3, s * 0.12);
    ctx.strokeRect(s * 0.35, -s * 0.06, s * 1.3, s * 0.12);
    ctx.restore();
  }
  hexPath(s * 0.85);
  ctx.fillStyle = lgrad(-s * 0.7, -s * 0.7, s * 0.7, s * 0.7, [
    [0, "#0d1e2c"],
    [0.5, "#1d3d57"],
    [1, "#2f6f9c"],
  ]);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.strokeStyle = O;
  ctx.stroke();
  hexPath(s * 0.5);
  ctx.fillStyle = "#12283a";
  ctx.fill();
  ctx.stroke();
  const eye = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.3);
  eye.addColorStop(0, "rgba(220,240,255,1)");
  eye.addColorStop(0.35, "rgba(90,170,255,.95)");
  eye.addColorStop(1, "rgba(20,80,160,0)");
  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function drawEnemyShip(size, hpFrac, crackSeed, type) {
  ctx.save();
  // High-contrast hostile halo, color-coded per enemy class so each one reads
  // at a glance even before you clock its silhouette: the enemy hulls are
  // deliberately dark and vanished against the dark board otherwise.
  const HALO = {
    interceptor: ["rgba(255,110,70,0.55)", "rgba(255,60,45,0.28)", "rgba(255,50,40,0)"],
    cruiser: ["rgba(255,170,60,0.55)", "rgba(240,120,30,0.30)", "rgba(240,110,30,0)"],
    sentry: ["rgba(70,240,150,0.50)", "rgba(40,200,120,0.26)", "rgba(30,190,110,0)"],
    railgun: ["rgba(90,170,255,0.50)", "rgba(50,120,220,0.26)", "rgba(40,100,200,0)"],
  };
  const hc = HALO[type] || HALO.interceptor;
  const halo = ctx.createRadialGradient(0, 0, size * 0.15, 0, 0, size * 1.25);
  halo.addColorStop(0, hc[0]);
  halo.addColorStop(0.55, hc[1]);
  halo.addColorStop(1, hc[2]);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, size * 1.25, 0, Math.PI * 2);
  ctx.fill();
  if (type === "cruiser") {
    drawCruiser(size * 1.12);
  } else if (type === "sentry") {
    drawSentry(size * 1.05);
  } else if (type === "railgun") {
    drawRailgun(size * 1.1);
  } else if (!drawShipImage(interceptorImg, size)) {
    drawEnemyFighter(size, 0);
  }
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

// The Warp Gate, drawn as real art instead of a 🌀 emoji: concentric rings
// with a swirling luminous core. Online = a live portal (spinning arms + a
// pulsing bright core), tinted `rgb` (defaults to cyan-green — the plain,
// unbranched Warp Gate every hand-authored sector and the very first
// procedural one uses); not-yet-powered = a dim inert grey ring, so it
// still reads as "the exit, just not open yet." A branching sector's two
// gates each get a different `rgb` (see BRANCH_TINTS) — Clubhouse feedback:
// "maybe we could have [them] color coordinated, but maybe not tell
// people" — so the color is real and consistent, but never spelled out in
// the legend; you learn what each one tends to mean by flying it.
function drawWarpGate(center, r, online, now, rgb) {
  const [cr, cg, cb] = rgb || [120, 255, 210];
  ctx.save();
  ctx.translate(center.x, center.y);
  const t = (now || 0) / 1000;
  if (online) {
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.4);
    glow.addColorStop(0, `rgba(${cr},${cg},${cb},0.5)`);
    glow.addColorStop(0.6, `rgba(${Math.round(cr * 0.5)},${Math.round(cg * 0.78)},${Math.round(cb * 0.7)},0.22)`);
    glow.addColorStop(1, `rgba(${Math.round(cr * 0.33)},${Math.round(cg * 0.7)},${Math.round(cb * 0.63)},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.rotate(t * 0.8);
    ctx.strokeStyle = `rgba(${Math.min(255, cr + 60)},${Math.min(255, cg + 20)},${Math.min(255, cb + 25)},0.9)`;
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, a, a + Math.PI * 0.68);
      ctx.stroke();
    }
    ctx.restore();
    const pulse = 0.75 + 0.25 * Math.sin(t * 3);
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.42 * pulse);
    core.addColorStop(0, "rgba(255,255,255,0.95)");
    core.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.42 * pulse, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = "rgba(150,170,190,0.5)";
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(110,130,150,0.38)";
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// The wormhole back to the previous sector — an in-world object (Clubhouse
// feedback: "not just a button... a wormhole sort of thing"), deliberately
// styled as the Warp Gate's opposite: amber instead of cyan, spinning the
// other way, so "going back" reads as visually distinct from "going on."
function drawWormhole(center, r, now) {
  ctx.save();
  ctx.translate(center.x, center.y);
  const t = (now || 0) / 1000;
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.4);
  glow.addColorStop(0, "rgba(255,190,110,0.5)");
  glow.addColorStop(0.6, "rgba(220,130,50,0.22)");
  glow.addColorStop(1, "rgba(200,110,40,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.rotate(-t * 0.8);
  ctx.strokeStyle = "rgba(255,215,170,0.9)";
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, a, a + Math.PI * 0.68);
    ctx.stroke();
  }
  ctx.restore();
  const pulse = 0.75 + 0.25 * Math.sin(t * 3);
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.42 * pulse);
  core.addColorStop(0, "rgba(255,255,255,0.95)");
  core.addColorStop(1, "rgba(255,190,110,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.42 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// An asteroid field: genuinely impassable terrain (see engine.js's
// isBlockingHazard), not just a colored hex — a small cluster of jagged
// dark rocks reads as "a wall," distinct from the smooth circular Outpost/
// Warp Gate. Shape is seeded per hex so it doesn't jitter frame to frame,
// but still varies field to field.
function drawAsteroidField(center, r, seed) {
  const rng = seededRandom(`asteroid-${seed}`);
  ctx.save();
  ctx.translate(center.x, center.y);
  const rockCount = 4;
  for (let i = 0; i < rockCount; i++) {
    const angle = (i / rockCount) * Math.PI * 2 + rng() * 0.6;
    const dist = r * (0.18 + rng() * 0.22);
    const rockR = r * (0.24 + rng() * 0.16);
    const cx = Math.cos(angle) * dist;
    const cy = Math.sin(angle) * dist;
    const points = 6 + Math.floor(rng() * 2);
    ctx.beginPath();
    for (let p = 0; p < points; p++) {
      const pa = (p / points) * Math.PI * 2;
      const pr = rockR * (0.75 + rng() * 0.35);
      const px = cx + Math.cos(pa) * pr;
      const py = cy + Math.sin(pa) * pr;
      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = "#4a3d38";
    ctx.fill();
    ctx.strokeStyle = "#241c19";
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.stroke();
    // A small rim highlight on the upper-left, like sunlit rock.
    ctx.strokeStyle = "rgba(180,150,120,0.35)";
    ctx.lineWidth = Math.max(1, r * 0.03);
    ctx.beginPath();
    ctx.arc(cx - rockR * 0.15, cy - rockR * 0.15, rockR * 0.7, Math.PI * 0.9, Math.PI * 1.6);
    ctx.stroke();
  }
  ctx.restore();
}

// The Sector Outpost: a small drawn space station, not a 🛠️ emoji — matches
// the vector-art treatment the flagship/Interceptor/Warp Gate already got.
// A gunmetal hub with two docking struts and a slow amber beacon so it
// reads as "a place," not a tool icon.
function drawOutpost(center, r, now) {
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.fillStyle = "#3a4358";
  ctx.strokeStyle = "#8fa2c2";
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Two docking struts, opposite each other.
  ctx.fillStyle = "#4a5570";
  for (const angle of [0, Math.PI]) {
    ctx.save();
    ctx.rotate(angle);
    ctx.fillRect(r * 0.42, -r * 0.12, r * 0.5, r * 0.24);
    ctx.strokeRect(r * 0.42, -r * 0.12, r * 0.5, r * 0.24);
    ctx.restore();
  }
  // A slow-pulsing amber beacon at the hub's core — "open for business."
  const t = (now || 0) / 1000;
  const pulse = 0.6 + 0.4 * Math.sin(t * 2);
  const beacon = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.3 * pulse);
  beacon.addColorStop(0, "rgba(255,206,138,0.95)");
  beacon.addColorStop(1, "rgba(255,160,60,0)");
  ctx.fillStyle = beacon;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.3 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Each sector gets its own deep-space mood — a tinted nebula wash plus a
// sparse, sector-specific starfield — so the campaign visibly changes scenery
// as you advance instead of every board reading identically (doubly so now
// that sectors aren't one-way — a distinct look per sector is how you tell
// where you are as you go back and forth). Colors are [core, edge] of a
// radial gradient; the starfield is seeded per sector so it stays put
// frame-to-frame rather than twinkling into new positions.
// [coreTint, edgeTint, nebulaAccent] — the first two are the base wash; the
// third is a big soft off-center glow layered on top so each sector has its
// own unmistakable color of deep space, not just a barely-there tint.
const SECTOR_BG = {
  1: ["#0a1c2e", "#04090f", "rgba(40,180,200,0.18)"], // steel cyan — Shockwave
  2: ["#1b1233", "#080510", "rgba(150,70,230,0.22)"], // violet nebula — Tractor Beam
  3: ["#0a2622", "#03100e", "rgba(40,220,150,0.20)"], // toxic teal — Sentry country
  4: ["#2c1024", "#0e0510", "rgba(230,60,110,0.22)"], // crimson-magenta — Full Fleet
};
// Every sector past the hand-authored campaign gets its OWN deterministic
// palette too, instead of just repeating Sector 1's blue forever — a
// rotating hue keeps deep runs visually distinct sector to sector.
// Clubhouse feedback: "unique backgrounds that look really cool per
// sector... it's kind of lame background-wise right now [past the start]."
function backdropForLevel(levelId) {
  if (SECTOR_BG[levelId]) return SECTOR_BG[levelId];
  // Gate color = destination mood ("when you're jumping into a color, it
  // should kinda match that theme"): a sector reached through the warm/
  // aggressive gate lives in warm hostile hues, the cool/quiet gate in
  // cool calm ones, the boss in its own iron-grey-red. The depth band
  // walks the base hue within each family, so depth 6 and depth 16 read
  // as different regions of the same kind of space.
  const theme = state.theme;
  const rng = seededRandom(`bghue-${levelId}-${theme ? theme.variant : "x"}`);
  const band = theme ? theme.band : 0;
  let hue;
  let sat = 45;
  if (theme && theme.variant === "aggressive") {
    hue = (350 + band * 18 + Math.floor(rng() * 14)) % 360; // reds → oranges, deeper = hotter
    sat = 55;
  } else if (theme && theme.variant === "quiet") {
    hue = 185 + ((band * 16 + Math.floor(rng() * 14)) % 70); // teals → blues → indigos
  } else if (theme && theme.variant === "boss") {
    hue = 355;
    sat = 30;
  } else {
    hue = Math.floor(rng() * 360); // neutral arrival — anything goes
  }
  const accentHue = (hue + 35 + Math.floor(rng() * 40)) % 360;
  return [
    `hsl(${hue}, ${sat}%, 9%)`,
    `hsl(${hue}, ${sat + 10}%, 3%)`,
    `hsla(${accentHue}, 70%, 55%, 0.20)`,
  ];
}
const starCache = new Map();
function starsFor(levelId, w, h) {
  const key = `${levelId}:${w}x${h}`;
  if (starCache.has(key)) return starCache.get(key);
  const rng = seededRandom(`stars-${key}`);
  const stars = [];
  for (let i = 0; i < 90; i++) {
    stars.push({ x: rng() * w, y: rng() * h, r: 0.4 + rng() * 1.3, a: 0.25 + rng() * 0.55 });
  }
  starCache.set(key, stars);
  return stars;
}
function drawSectorBackdrop() {
  const bg = backdropForLevel(state.levelId);
  const g = ctx.createRadialGradient(geom.w * 0.5, geom.h * 0.34, geom.w * 0.08, geom.w * 0.5, geom.h * 0.52, geom.h * 0.8);
  g.addColorStop(0, bg[0]);
  g.addColorStop(1, bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, geom.w, geom.h);
  // A large soft nebula glow, offset to one corner, in the sector's accent
  // color — this is what makes each sector read as its own place at a glance.
  const neb = ctx.createRadialGradient(geom.w * 0.72, geom.h * 0.24, 0, geom.w * 0.72, geom.h * 0.24, geom.h * 0.7);
  neb.addColorStop(0, bg[2]);
  neb.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = neb;
  ctx.fillRect(0, 0, geom.w, geom.h);
  ctx.save();
  for (const st of starsFor(state.levelId, Math.round(geom.w), Math.round(geom.h))) {
    ctx.globalAlpha = st.a;
    ctx.fillStyle = "#dbe7ff";
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// The union of every board hex, as one path — hexes are true regular
// hexagons, so a rect-shaped Hoplite board still has a jagged (non-
// rectangular) silhouette. Clipping the starfield/nebula backdrop to this
// path keeps it from spilling into the canvas's rectangular corners, which
// otherwise read as reachable space when they're not (Clubhouse feedback:
// "why do I see the star background [in] areas you can't go?" — Hoplite's
// own board floats on flat black with no such no-man's-land).
function boardPath() {
  const path = new Path2D();
  for (const hex of state.boardHexes) {
    const center = hexToPixel(hex);
    for (let i = 0; i < 6; i++) {
      const c = hexCorner(center, i);
      if (i === 0) path.moveTo(c.x, c.y);
      else path.lineTo(c.x, c.y);
    }
    path.closePath();
  }
  return path;
}

function draw() {
  const now = performance.now();
  ctx.clearRect(0, 0, geom.w, geom.h);
  ctx.save();
  ctx.clip(boardPath());
  drawSectorBackdrop();
  ctx.restore();
  ctx.save();

  // Screen shake while a damage flash is running.
  const flash = anims.find((a) => a.kind === "flash" && now < a.start + a.dur);
  if (flash) {
    const p = animProgress(flash, now);
    ctx.translate(Math.sin(p * 30) * 4 * (1 - p), Math.cos(p * 23) * 3 * (1 - p));
  }

  const threats = Engine.computeThreatHexes(state);
  // The selected contact in Scan mode gets its PERSONAL strike zone lit up
  // (regardless of charge state — this is its reach, the INTENT line on
  // its card says whether it can afford to fire yet), drawn brighter than
  // the aggregate red wash so "what can THIS thing hit" stands out.
  const scanTarget = legendVisible && inspectedHex ? Engine.enemyAt(state, inspectedHex) : null;
  const scanTargetHexes = scanTarget
    ? new Set(
        Engine.weaponHexes(scanTarget, 0, Engine.ENEMY_TYPES[scanTarget.type].weapon)
          .filter((h) => Engine.onBoard(state, h))
          .map(Engine.hexKey)
      )
    : null;
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
  const targetable = new Set(Engine.legalTractorTargets(state).map((e) => e.id));
  const routeHexes = (plannedPath && plannedPath.hexes) || (autoRoute && autoRoute.path) || null;
  const route = new Set((routeHexes || []).slice(1).map((h) => Engine.hexKey(h)));

  for (const hex of state.boardHexes) {
    const center = hexToPixel(hex);
    const k = Engine.hexKey(hex);
    const exitHere = state.exits.find((e) => Engine.posEq(hex, e));
    const isExit = Boolean(exitHere);
    const isOutpost = state.outpostPos && Engine.posEq(hex, state.outpostPos);
    const isWormhole = state.wormholePos && Engine.posEq(hex, state.wormholePos);
    const isHazard = Engine.hazardAt(state, hex);

    let fill = "#182238";
    let fillAlpha = 0.22; // plain floor: mostly transparent, the sector backdrop does the talking
    if (isHazard) {
      fill = isHazard.type === "asteroid" ? "#241f1c" : "#3a1030";
      fillAlpha = 0.8;
    } else if (isExit) {
      fill = state.exitUnlocked ? "#1f4d3a" : "#2a2f45";
      fillAlpha = 0.8;
    } else if (isOutpost) {
      fill = "#2a3f4d";
      fillAlpha = 0.8;
    } else if (isWormhole) {
      fill = "#3a2a1c";
      fillAlpha = 0.8;
    }
    // The red strike-range wash is one of the legend's toggleable keys —
    // like the legal-move outline below, it's only ever drawn while the
    // legend is open (and its own checkbox is checked). Safety-critical, so
    // it stays legible even over an otherwise-transparent floor tile.
    if (threats.has(k) && legendVisible) {
      fill = blend(fill, "#7a1f2b", 0.55);
      fillAlpha = Math.max(fillAlpha, 0.62);
    }
    if (scanTargetHexes && scanTargetHexes.has(k)) {
      fill = blend(fill, "#e0533f", 0.6);
      fillAlpha = Math.max(fillAlpha, 0.75);
    }
    // Movable/targetable hexes keep their normal color — only the border
    // marks them, so the board doesn't turn into a wall of green.
    if (route.has(k)) {
      fill = blend(fill, "#2e5f96", 0.45);
      fillAlpha = Math.max(fillAlpha, 0.55);
    }

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
    if (legendVisible && legal.has(k)) {
      stroke = "#7fe3a8";
      strokeWidth = 3;
    }
    drawHex(center, fill, stroke, strokeWidth, fillAlpha);

    if (isExit) {
      drawWarpGate(center, geom.sx * 0.5, state.exitUnlocked, now, BRANCH_TINTS[exitHere.variantId]);
    } else if (isOutpost) {
      drawOutpost(center, geom.sx * 0.56, now);
    } else if (isWormhole) {
      drawWormhole(center, geom.sx * 0.5, now);
    } else if (isHazard && isHazard.type === "asteroid") {
      drawAsteroidField(center, geom.sx * 0.56, k);
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
      if (legendVisible && legal.has(Engine.hexKey(enemy))) {
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
    // Sentry and Railgun are fixed emplacements — they don't pivot to face
    // you (the Railgun's 6 barrels already cover every direction at once);
    // every other enemy points its nose at the flagship.
    if (enemy.type !== "sentry" && enemy.type !== "railgun") {
      ctx.rotate((angleToward(enemy, state.playerPos) * Math.PI) / 180);
    }
    drawEnemyShip(geom.sx * 0.46, enemy.hp / enemy.maxHp, enemy.id, enemy.type);
    ctx.restore();
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

  // Rising energy-spend readouts, above the ships but below explosions.
  for (const a of anims) {
    if (a.kind !== "efloat" || now < a.start || now >= a.start + a.dur) continue;
    const p = animProgress(a, now);
    const c = hexToPixel(a.pos);
    ctx.save();
    ctx.globalAlpha = 1 - p * p;
    ctx.fillStyle = "#7fe3a8";
    ctx.font = `700 ${Math.max(11, geom.sx * 0.34)}px "SF Mono", "Menlo", "Consolas", monospace`;
    ctx.textAlign = "center";
    ctx.fillText(`${a.amount} ENERGY`, c.x, c.y - geom.sx * (0.75 + p * 1.1));
    ctx.restore();
  }

  // Explosions on top of everything.
  for (const a of anims) {
    if (a.kind !== "boom" || now >= a.start + a.dur) continue;
    const p = animProgress(a, now);
    drawExplosion(hexToPixel(a.pos), p, a.particles, geom.sx * 0.9);
  }

  ctx.restore();

  // Sector arrival title: the place's name sweeps in big across the upper
  // viewport and fades — where you are, told once, then out of the way.
  const title = anims.find((a) => a.kind === "sectorTitle" && now < a.start + a.dur);
  if (title) {
    const p = animProgress(title, now);
    const alpha = p < 0.15 ? p / 0.15 : p > 0.65 ? Math.max(0, (1 - p) / 0.35) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    const size = Math.max(16, Math.min(26, geom.w * 0.052));
    ctx.font = `700 ${size}px "SF Mono", "Menlo", "Consolas", monospace`;
    ctx.fillStyle = "#dbe4f2";
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 8;
    ctx.fillText(title.name.toUpperCase(), geom.w / 2, geom.h * 0.16);
    ctx.font = `${Math.max(9, size * 0.42)}px "SF Mono", "Menlo", "Consolas", monospace`;
    ctx.fillStyle = "#7fe3a8";
    ctx.fillText("ENTERING SECTOR", geom.w / 2, geom.h * 0.16 - size * 1.15);
    ctx.restore();
  }

  // Warp-out flash: plays once a sector clears (triggered in handleAction),
  // then the run just continues into the next sector on its own — no
  // confirmation needed for a routine clear (see updateHud/advanceSector).
  const warp = anims.find((a) => a.kind === "warp" && now < a.start + a.dur);
  if (warp) {
    const p = animProgress(warp, now);
    const cx = geom.w / 2, cy = geom.h / 2;
    ctx.save();
    const streakAlpha = Math.sin(Math.PI * Math.min(p * 1.4, 1)) * 0.9;
    ctx.strokeStyle = `rgba(180, 230, 255, ${streakAlpha})`;
    ctx.lineWidth = 2;
    const streakCount = 24;
    const maxLen = Math.max(geom.w, geom.h) * (0.3 + p * 0.9);
    for (let i = 0; i < streakCount; i++) {
      const angle = (i / streakCount) * Math.PI * 2;
      const innerR = maxLen * 0.15;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
      ctx.lineTo(cx + Math.cos(angle) * maxLen, cy + Math.sin(angle) * maxLen);
      ctx.stroke();
    }
    const flashAlpha = Math.max(0, 1 - Math.abs(p - 0.55) * 2.4);
    ctx.fillStyle = `rgba(210, 235, 255, ${flashAlpha * 0.85})`;
    ctx.fillRect(0, 0, geom.w, geom.h);
    ctx.restore();
  }

  // Wormhole flash: reverse-warp back to a previous sector — same beat as
  // the forward warp, but streaks pull INWARD (you're retreating through
  // the wormhole, not blasting out a gate) and amber-tinted to read as
  // distinct from the cyan forward warp.
  const wormhole = anims.find((a) => a.kind === "wormhole" && now < a.start + a.dur);
  if (wormhole) {
    const p = animProgress(wormhole, now);
    const cx = geom.w / 2, cy = geom.h / 2;
    ctx.save();
    const streakAlpha = Math.sin(Math.PI * Math.min(p * 1.4, 1)) * 0.9;
    ctx.strokeStyle = `rgba(255, 195, 110, ${streakAlpha})`;
    ctx.lineWidth = 2;
    const streakCount = 24;
    const maxLen = Math.max(geom.w, geom.h) * (0.3 + p * 0.9);
    for (let i = 0; i < streakCount; i++) {
      const angle = (i / streakCount) * Math.PI * 2;
      const outerR = maxLen;
      const innerR = maxLen * (1 - Math.min(p * 1.4, 1)) * 0.85 + maxLen * 0.15;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
      ctx.lineTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
      ctx.stroke();
    }
    const flashAlpha = Math.max(0, 1 - Math.abs(p - 0.55) * 2.4);
    ctx.fillStyle = `rgba(255, 220, 170, ${flashAlpha * 0.85})`;
    ctx.fillRect(0, 0, geom.w, geom.h);
    ctx.restore();
  }
}

// ---- HUD / state plumbing ---------------------------------------------------

function setMode(next) {
  if (state.status !== "playing" || !state.actions.includes(next)) return;
  mode = next;
  markActionUsed(next);
  modeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
    if (btn.dataset.mode === next) btn.classList.remove("new-unlock");
  });
  // Arming a mode logs a concrete "what tapping does now" instruction —
  // the panel's readout strip is the one place instructions live.
  pushMessage(MODES[next].hint);
  updateHud();
  draw();
}

function persist() {
  GCStorage.set(GAME_ID, "run", state);
  GCStorage.set(GAME_ID, "levelIndex", levelIndex);
  GCStorage.set(GAME_ID, "sectorHistory", sectorHistory);
  GCStorage.set(GAME_ID, "chartIndex", chartIndex);
  if (state.status === "won") {
    bestDepth = Math.max(bestDepth, state.levelId);
    GCStorage.set(GAME_ID, "bestDepth", bestDepth);
  }
}

function animsRunning() {
  const now = performance.now();
  return anims.some((a) => now < a.start + a.dur);
}

// One renderer for every HUD gauge — a labeled row of colored pips
// ("stats (green bars) at top to indicate better what is there"), so
// Hull/Energy/Shield all read the same way at a glance instead of some
// being bars and some bare numbers.
function renderStatBar(el, label, filled, max, variant) {
  el.innerHTML = "";
  el.setAttribute("aria-label", `${label} ${filled}/${max}`);
  for (let i = 0; i < max; i++) {
    const pip = document.createElement("span");
    pip.className = `stat-pip stat-pip-${variant}` + (i < filled ? " filled" : "");
    el.appendChild(pip);
  }
}

// The panel is dynamic: a gauge that just changed flashes for a beat, so
// a drained reactor or a lost hull pip registers even if you weren't
// staring at that exact spot.
const lastGauges = {};
function flashOnChange(key, value, wrapEl) {
  if (lastGauges[key] !== undefined && lastGauges[key] !== value) {
    wrapEl.classList.remove("flash");
    void wrapEl.offsetWidth; // restart the animation even on back-to-back changes
    wrapEl.classList.add("flash");
  }
  lastGauges[key] = value;
}

// Would a FIRE volley land right now? Drives the FIRE button's enabled
// (and lit-up) state — the button itself is the "you can shoot" signal.
function anyFireTarget() {
  return Engine.WEAPON_SYSTEM_KEYS.some((k) => {
    if (!(k === "ram" || state.actions.includes(k)) || !state.systems[k]) return false;
    const weapon = Engine.WEAPONS[k];
    const reach = new Set(Engine.weaponHexes(state.playerPos, state.facing, weapon).map(Engine.hexKey));
    return Engine.livingEnemies(state).some((e) => reach.has(Engine.hexKey(e)));
  });
}

function updateHud() {
  renderStatBar(hullBarEl, "Hull", state.hull, state.maxHull, "hull");
  // Energy pays for every weapon shot, so the reactor gauge is always up.
  renderStatBar(energyBarEl, "Energy", state.energy, state.maxEnergy, "energy");
  // Shield charges have no cap — the bar is however many are banked, all
  // lit. Hidden entirely at zero rather than showing an empty socket for
  // something you may never buy; the gauge cluster reads SHIELDS | HULL,
  // in damage order (shields absorb first).
  shieldWrapEl.hidden = state.shieldCharges <= 0;
  renderStatBar(shieldBarEl, "Shields", state.shieldCharges, state.shieldCharges, "shield");
  flashOnChange("hull", state.hull, hullWrapEl);
  flashOnChange("energy", state.energy, energyWrapEl);
  flashOnChange("shield", state.shieldCharges, shieldWrapEl);
  flashOnChange("salvage", state.salvage, salvageWrapEl);
  // ONE message at a time — three run together read as clipped word soup.
  // There is no separate instruction line above the field anymore ("remove
  // the tap info at top — distracts from game"): the readout strip is the
  // single home for every message and hint.
  logEl.textContent = state.log[state.log.length - 1] || "Tap a hex beside your ship to move.";
  salvageValueEl.textContent = state.salvage;

  // Hold the end-of-run overlay back until the death/kill animation finishes.
  // A routine win never actually reaches this "not animating" state as
  // "won" — the warp-flash swaps the sector at its peak opacity (see
  // handleAction), so status has already flipped to "playing" for the new
  // sector well before its own anim finishes. No modal, no button, for a
  // routine clear. A BOSS win (isVictory) is the one exception — see
  // handleAction, which deliberately skips the auto-continue for it — so
  // this overlay is how "Run Complete" actually gets shown to the player.
  if (state.status === "lost" && !animsRunning()) {
    overlayTitleEl.textContent = "Flagship Destroyed";
    overlayBodyEl.textContent = `Permadeath. Your run ends here. Best depth: ${bestDepth}.`;
    continueBtnEl.hidden = true;
    overlayEl.hidden = false;
  } else if (state.isVictory && !animsRunning()) {
    overlayTitleEl.textContent = "Run Complete";
    overlayBodyEl.textContent = `The Bulwark falls at depth ${state.levelId}. Keep flying for a higher depth, or bank the win and start fresh.`;
    continueBtnEl.hidden = false;
    overlayEl.hidden = false;
  } else {
    overlayEl.hidden = true;
  }

  modeButtons.forEach((btn) => {
    const m = btn.dataset.mode;
    const locked = !state.actions.includes(m);
    // A not-yet-unlocked action is simply hidden — no padlock, no greyed-out
    // ghost button cluttering the console. It appears the sector it unlocks.
    btn.hidden = locked;
    btn.textContent = MODES[m].label;
    // Scan mode is inspect-only — every action locks out while it's open
    // (see the canvas click handler), so the buttons themselves go dead
    // too instead of sitting there clickable but doing nothing.
    btn.disabled = state.status !== "playing" || legendVisible;
    btn.classList.toggle("new-unlock", !locked && !usedActions.has(m));
  });

  // Tractor Beam gets the same tap-to-expand stats badge as every
  // purchased weapon (see PURCHASABLE_WEAPON_UI) — it just lives in the
  // actions-grid next to its button instead of a systems-toggle row,
  // since it's armed-and-aimed rather than an ambient auto-fire.
  const tractorOwned = state.actions.includes("tractor");
  tractorStatsEl.hidden = !tractorOwned;
  if (tractorOwned) {
    const tractorWeapon = Engine.WEAPONS.tractor;
    tractorStatsEl.textContent = tractorStatsExpanded
      ? describeWeapon(tractorWeapon)
      : describeWeaponCompact(tractorWeapon);
    tractorStatsEl.classList.toggle("expanded", tractorStatsExpanded);
  }
}

// Scan mode has no icon-key overlay anymore ("all it should really be is
// when you're scanning, you just tap things") — the button lights up, the
// readout strip above the field says what to do, and tapping anything
// identifies it.
function updateLegend() {
  scanBtn.classList.toggle("active", legendVisible);
}

// The panel's action row: Fire, Recharge, Tractor Beam, Target Lock.
// Target Lock is the old "toggle Warpdrive off to aim" trick promoted to
// a first-class stance button: engaged = movement offline, taps aim the
// flagship, FIRE commits the shot.
function updateSystems() {
  // FIRE is only live when an armed weapon actually has a target — the
  // button itself tells you whether shooting this turn does anything.
  const canFire = anyFireTarget();
  fireBtn.disabled = state.status !== "playing" || legendVisible || !canFire;
  fireBtn.classList.toggle("active", canFire && state.status === "playing" && !legendVisible);
  rechargeBtn.disabled = state.status !== "playing" || legendVisible || state.energy >= state.maxEnergy;
  targetLockBtn.disabled = state.status !== "playing" || legendVisible;
  targetLockBtn.classList.toggle("active", !state.systems.warpdrive);
}

// Shared by the systems-row stats line and the click-an-enemy-for-info panel
// below, so both always describe a weapon the same way.
function describePattern(weapon) {
  if (weapon.pattern.length >= 6) return "all directions";
  if (weapon.pattern.length === 1 && weapon.pattern[0] === 0) return "forward only";
  const set = new Set(weapon.pattern);
  if (weapon.pattern.length === 3 && set.has(0) && set.has(1) && set.has(5)) return "forward + both sides";
  return `${weapon.pattern.length} directions`;
}

// Tractor Beam's `damage: 0` (it destroys via collision physics — see
// pushEnemyInDirection — not a direct hit) would otherwise read as "Damage
// 0", which looks like a bug rather than the intended push-only weapon.
function describeDamage(weapon) {
  return weapon.damage > 0 ? `Damage ${weapon.damage}` : "Push";
}

// Initiative tiers, spelled out — "make sure it's very obvious":
// 3 fires first, 2 is standard, 1 fires last.
function speedWord(weapon) {
  if (weapon.speed >= 3) return "FAST — fires first";
  if (weapon.speed === 2) return "STANDARD";
  return "HEAVY — fires last";
}

function describeWeapon(weapon) {
  const speed = weapon.speed ? ` · Speed: ${speedWord(weapon)}` : "";
  return (
    `${weapon.label} — Range ${weapon.range} · ${describeDamage(weapon)} · ` +
    `Pattern: ${describePattern(weapon)} · Energy ${weapon.energyCost}/shot${speed}`
  );
}

// Short enough to sit inline on the console instead of needing its own
// extra-wide line — the full
// sentence is still one tap/hover away via the title tooltip.
function describeWeaponCompact(weapon) {
  const pattern = weapon.pattern.length >= 6 ? "ALL" : "FWD";
  const dmg = weapon.damage > 0 ? `D${weapon.damage}` : "PUSH";
  const spd = weapon.speed ? ` · SPD${weapon.speed}` : "";
  return `R${weapon.range} · ${dmg} · E${weapon.energyCost}${spd} · ${pattern}`;
}


// Is there anything inspectable at this hex? Mirrors exactly what
// updateScanInfo below knows how to describe — when there isn't, the
// readout strip keeps showing its "tap anything" hint instead of a card.
function somethingAtHex(hex) {
  return Boolean(
    Engine.enemyAt(state, hex) ||
      state.exits.some((ex) => Engine.posEq(ex, hex)) ||
      (state.outpostPos && Engine.posEq(state.outpostPos, hex)) ||
      (state.wormholePos && Engine.posEq(state.wormholePos, hex)) ||
      Engine.hazardAt(state, hex)
  );
}

// The inspected card only ever shows in Scan mode (it's a learn-the-board
// aid, same as the legend), and only for as long as whatever's at
// inspectedHex is still there — an enemy that dies, or a Wormhole that
// only exists once you've come from a previous sector, both just clear it.
// Covers everything Scan mode promises you can look at: an enemy, the
// Warp Gate, the Outpost, the Wormhole, or an asteroid field.
function updateScanInfo() {
  // The readout strip lives ABOVE the field ("move it up where the tap
  // info is") and only exists while Scan mode is open — showing/hiding it
  // changes how much room the board has, so re-fit the canvas whenever it
  // toggles. Within Scan mode its height is fixed: tapping different
  // contacts swaps the card in place without the board ever resizing.
  const slotWasHidden = scanReadoutEl.hidden;
  scanReadoutEl.hidden = !legendVisible;
  if (slotWasHidden !== scanReadoutEl.hidden) updateGeometry();
  scanHintEl.hidden = !legendVisible || Boolean(inspectedHex && somethingAtHex(inspectedHex));
  if (!legendVisible || !inspectedHex) {
    enemyInfoEl.hidden = true;
    return;
  }
  const enemy = Engine.enemyAt(state, inspectedHex);
  if (enemy) {
    const def = Engine.ENEMY_TYPES[enemy.type];
    enemyInfoEl.hidden = false;
    enemyInfoEl.classList.remove("neutral");
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

    // The INTENT line: what this contact will do, derived straight from
    // the real enemy AI (decideIntent's rules) — never a guess, always a
    // statement conditional on you staying put, since enemies decide
    // AFTER you act. Its personal strike zone lights up on the board too
    // (see draw()) while it's the selected contact.
    const intent = document.createElement("div");
    intent.className = "enemy-info-stats enemy-info-intent";
    const charged = enemy.energy >= def.weapon.energyCost;
    const inRange = Engine.weaponHexes(enemy, 0, def.weapon).some((h) => Engine.posEq(h, state.playerPos));
    // Initiative, stated plainly: does this contact shoot before or after
    // your armed weapons? (Ties go to you — see engine.js resolveCombat.)
    const activeSpeeds = Engine.WEAPON_SYSTEM_KEYS.filter(
      (k) => (k === "ram" || state.actions.includes(k)) && state.systems[k]
    ).map((k) => Engine.WEAPONS[k].speed);
    const fastest = activeSpeeds.length ? Math.max(...activeSpeeds) : 0;
    const order =
      fastest >= def.weapon.speed
        ? " Your weapons fire FIRST."
        : " It fires BEFORE your weapons.";
    let intentText;
    if (!charged) {
      intentText = `INTENT: CHARGING ${enemy.energy}/${def.weapon.energyCost} — cannot fire yet`;
    } else if (inRange) {
      intentText = "INTENT: YOU ARE IN ITS RANGE — fires this turn if you stay put." + order;
    } else if (def.movesTowardPlayer) {
      intentText = "INTENT: PURSUING — closes 1 hex/turn, fires the turn you're in range." + order;
    } else {
      intentText = "INTENT: HOLDING — never moves, fires the turn you enter its reach." + order;
    }
    intent.textContent = intentText;
    enemyInfoEl.appendChild(intent);
    return;
  }

  const isGate = state.exits.some((ex) => Engine.posEq(ex, inspectedHex));
  const isOutpost = Boolean(state.outpostPos) && Engine.posEq(state.outpostPos, inspectedHex);
  const isWormhole = Boolean(state.wormholePos) && Engine.posEq(state.wormholePos, inspectedHex);
  const hazard = Engine.hazardAt(state, inspectedHex);
  if (!isGate && !isOutpost && !isWormhole && !hazard) {
    enemyInfoEl.hidden = true; // nothing at this hex to report
    return;
  }

  enemyInfoEl.hidden = false;
  enemyInfoEl.classList.add("neutral");
  enemyInfoEl.innerHTML = "";
  const header = document.createElement("div");
  header.className = "enemy-info-header";
  const name = document.createElement("span");
  const stats = document.createElement("div");
  stats.className = "enemy-info-stats";
  if (isGate) {
    name.textContent = "WARP GATE";
    stats.textContent = state.exitUnlocked
      ? "Online — fly here to warp out and clear the sector."
      : "Offline — clear the sector's objective to unlock it.";
  } else if (isOutpost) {
    name.textContent = "OUTPOST";
    stats.textContent = "Dock here to spend Salvage on repairs and upgrades.";
  } else if (isWormhole) {
    name.textContent = "WORMHOLE";
    stats.textContent = "Fly here to return to the previous sector. It doesn't always land in the same spot.";
  } else {
    name.textContent = "ASTEROID FIELD";
    stats.textContent = "Impassable — route around it.";
  }
  header.appendChild(name);
  enemyInfoEl.appendChild(header);
  enemyInfoEl.appendChild(stats);
}

// Rebuilds the outpost shop's offer buttons from Engine.outpostOffers every
// render — it's cheap (two offers) and keeps the panel from ever drifting
// out of sync with actual affordability/applicability as salvage/hull change.
function updateOutpost() {
  const docked = state.status === "playing" && Engine.outpostAvailable(state);
  if (!docked) outpostDismissed = false; // re-arm for the next visit
  const show = docked && !outpostDismissed;
  outpostOverlayEl.hidden = !show;
  if (!show) return;

  outpostSalvageEl.textContent = state.salvage;
  outpostOffersEl.innerHTML = "";
  for (const offer of Engine.outpostOffers(state)) {
    const btn = document.createElement("button");
    btn.textContent = `${offer.label} — ${offer.cost} salvage`;
    btn.disabled = !offer.affordable || !offer.applicable;
    btn.addEventListener("click", () => {
      handleAction(() => Engine.applyOutpostPurchase(state, offer.id));
    });
    outpostOffersEl.appendChild(btn);
  }
}

// The full-screen Ship view: the flagship, every gauge, and each owned
// weapon system as a hardpoint row with its real toggle. Rebuilt from
// state on every render (same approach as the Outpost shop) — cheap, and
// it can never drift from what the console toggles say.
function updateShipOverlay() {
  shipOverlayEl.hidden = !shipVisible;
  shipBtn.classList.toggle("active", shipVisible);
  if (!shipVisible) return;

  shipStatsEl.innerHTML = "";
  const statRow = (label, build) => {
    const row = document.createElement("div");
    row.className = "ship-stat-row";
    const name = document.createElement("span");
    name.className = "stat-label";
    name.textContent = label;
    row.appendChild(name);
    row.appendChild(build());
    shipStatsEl.appendChild(row);
  };
  const bar = (filled, max, variant, label) => () => {
    const b = document.createElement("span");
    b.className = "stat-bar";
    renderStatBar(b, label, filled, max, variant);
    return b;
  };
  const text = (value) => () => {
    const v = document.createElement("span");
    v.className = "stat-value";
    v.textContent = value;
    return v;
  };
  statRow("Hull", bar(state.hull, state.maxHull, "hull", "Hull"));
  statRow("Energy", bar(state.energy, state.maxEnergy, "energy", "Energy"));
  if (state.shieldCharges > 0) statRow("Shield", bar(state.shieldCharges, state.shieldCharges, "shield", "Shield"));
  statRow("Salvage", text(state.salvage));
  statRow("Weapon slots", text(`${Engine.usedWeaponSlots(state)}/${state.weaponSlots} in use`));
  statRow("Recharge", text(`+${Engine.RECHARGE_ENERGY_GAIN} per RECHARGE action`));
  statRow("Warp jump", text("refills Energy to full"));

  shipHardpointsEl.innerHTML = "";
  // Builds one toggle row — the ONLY place system on/off switches live now
  // ("you don't need the controls on/off anymore... it's in Ship"): the
  // console keeps just the actions (Fire/Recharge/Tractor/Target Lock).
  const systemRow = (key, label, statsText) => {
    const row = document.createElement("div");
    row.className = "ship-hardpoint";
    const head = document.createElement("label");
    head.className = "system-toggle ship-hardpoint-head";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.dataset.system = key; // stable hook for tests and future styling
    toggle.checked = state.systems[key];
    toggle.addEventListener("change", () => {
      // A free pre-turn switch — can throw on the weapon-slot cap;
      // handleAction logs it and render() re-syncs the box.
      handleAction(() => Engine.setSystem(state, key, toggle.checked));
    });
    head.appendChild(toggle);
    head.appendChild(document.createTextNode(` ${label}`));
    row.appendChild(head);
    const statsLine = document.createElement("div");
    statsLine.className = "ship-hardpoint-stats";
    statsLine.textContent = statsText;
    row.appendChild(statsLine);
    shipHardpointsEl.appendChild(row);
  };
  const WEAPON_INFO = { ram: Engine.WEAPONS.ram, lance: Engine.WEAPONS.lance, repulsor: Engine.WEAPONS.repulsor };
  for (const key of Engine.WEAPON_SYSTEM_KEYS) {
    const owned = key === "ram" || state.actions.includes(key);
    if (!owned) continue;
    const weapon = WEAPON_INFO[key];
    systemRow(key, weapon.label, describeWeapon(weapon) + ` · ${weapon.slots} slot${weapon.slots === 1 ? "" : "s"}`);
  }
  if (state.actions.includes("tractor")) {
    const row = document.createElement("div");
    row.className = "ship-hardpoint";
    const head = document.createElement("div");
    head.className = "ship-hardpoint-head";
    head.textContent = "TRACTOR BEAM";
    row.appendChild(head);
    const statsLine = document.createElement("div");
    statsLine.className = "ship-hardpoint-stats";
    statsLine.textContent = describeWeapon(Engine.WEAPONS.tractor) + " · aimed action, no slot";
    row.appendChild(statsLine);
    shipHardpointsEl.appendChild(row);
  }
  const note = document.createElement("p");
  note.className = "ship-note";
  note.textContent = "Loadout changes are free — they never spend a turn. Buy more slots, Energy capacity, and weapons at Outposts.";
  shipHardpointsEl.appendChild(note);
}

// The starmap: an actual chart, not a list — your route through the gates
// drawn as a constellation, built ONLY from what the ship knows. Reads
// bottom-up like the board (you fly "up" through sectors). The line bends
// by which gate you took (cool-tinted gate = left, warm = right), the
// gate you DIDN'T take at each fork shows as a short dashed stub in its
// tint (the road not taken), and the gates ahead branch to hollow "?"
// stars. Gate tints are never explained in words — same rule as the
// board ("maybe color coordinated, but maybe not tell people").
function updateMapOverlay() {
  mapOverlayEl.hidden = !mapVisible;
  mapBtn.classList.toggle("active", mapVisible);
  if (!mapVisible) return;

  // The chart IS the chain now — including sectors ahead of you if you've
  // jumped back. The live sector substitutes its chart snapshot.
  const chain = sectorHistory.map((entry, i) => {
    const st = i === chartIndex ? state : entry.state;
    return {
      name: st.levelName,
      levelId: st.levelId,
      tookVariant: st.usedExitVariant || null, // gate used to LEAVE this sector
      exits: st.exits || [],
      current: i === chartIndex,
      chartIdx: i,
    };
  });
  if (!chain.length) return;

  const W = 340;
  const STEP = 62;
  const BOTTOM_PAD = 34;
  const TOP_PAD = 70;
  const H = BOTTOM_PAD + TOP_PAD + STEP * Math.max(1, chain.length - 1) + (state.status === "playing" ? STEP : 0);
  const tintOf = (variantId) => {
    const t = variantId && BRANCH_TINTS[variantId];
    return t ? `rgb(${t[0]}, ${t[1]}, ${t[2]})` : "#6ee7ff";
  };
  // x drifts by the gate taken INTO each sector: quiet (cool) bends left,
  // aggressive (warm) bends right, campaign/single-gate stays the course.
  const xs = [];
  let x = W / 2;
  for (let i = 0; i < chain.length; i++) {
    if (i > 0) {
      const via = chain[i - 1].tookVariant;
      if (via === "quiet") x -= 46;
      else if (via === "aggressive") x += 46;
      x = Math.max(48, Math.min(W - 48, x));
    }
    xs.push(x);
  }
  const yOf = (i) => H - BOTTOM_PAD - i * STEP;

  const svg = [];
  svg.push(`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">`);
  // Background starfield — deterministic off the run's shape so the map
  // doesn't twinkle differently every render.
  let seed = 0;
  for (const n of chain) seed = (seed * 31 + n.levelId) >>> 0;
  const rng = seededRandom(seed + 7);
  for (let i = 0; i < 40; i++) {
    const sx = rng() * W;
    const sy = rng() * H;
    const r = 0.5 + rng() * 1.1;
    svg.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r.toFixed(1)}" fill="#2a3652"/>`);
  }
  // Route edges (solid), drawn under the nodes.
  for (let i = 1; i < chain.length; i++) {
    svg.push(
      `<line x1="${xs[i - 1]}" y1="${yOf(i - 1)}" x2="${xs[i]}" y2="${yOf(i)}" stroke="${tintOf(chain[i - 1].tookVariant)}" stroke-width="2" opacity="0.75"/>`
    );
  }
  // Roads not taken: at each PAST fork, a short dashed stub for the gate
  // you skipped, in its tint.
  for (let i = 0; i < chain.length - 1; i++) {
    const n = chain[i];
    if (!n.exits || n.exits.length < 2 || !n.tookVariant) continue;
    for (const ex of n.exits) {
      if (ex.variantId === n.tookVariant) continue;
      const dir = ex.variantId === "quiet" ? -1 : 1;
      svg.push(
        `<line x1="${xs[i]}" y1="${yOf(i)}" x2="${xs[i] + dir * 34}" y2="${yOf(i) - 26}" stroke="${tintOf(ex.variantId)}" stroke-width="1.5" stroke-dasharray="3 4" opacity="0.5"/>` +
          `<circle cx="${xs[i] + dir * 34}" cy="${yOf(i) - 26}" r="3" fill="none" stroke="${tintOf(ex.variantId)}" stroke-width="1" stroke-dasharray="2 2" opacity="0.5"/>`
      );
    }
  }
  // Gates ahead: dashed branches up to hollow "?" stars — only from the
  // end of the charted route (mid-chain, the way forward is already drawn).
  const cur = chartIndex;
  if (state.status === "playing" && cur === chain.length - 1) {
    const ahead = chain[cur].exits || [];
    ahead.forEach((ex, j) => {
      const dir = ahead.length === 1 ? 0 : ex.variantId === "quiet" ? -1 : ex.variantId === "aggressive" ? 1 : j === 0 ? 1 : -1;
      const ax = Math.max(40, Math.min(W - 40, xs[cur] + dir * 78));
      const ay = yOf(cur) - STEP;
      svg.push(
        `<line x1="${xs[cur]}" y1="${yOf(cur)}" x2="${ax}" y2="${ay}" stroke="${tintOf(ex.variantId)}" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.8"/>` +
          `<circle cx="${ax}" cy="${ay}" r="9" fill="none" stroke="${tintOf(ex.variantId)}" stroke-width="1.5" stroke-dasharray="3 3"/>` +
          `<text x="${ax}" y="${ay + 3.5}" text-anchor="middle" fill="${tintOf(ex.variantId)}" font-size="10" font-family="monospace">?</text>`
      );
    });
  }
  // Charted star nodes, with labels. Every non-current node is TAPPABLE —
  // tap a charted star to jump back (or forward) to it, exactly as you
  // left it ("maybe you can jump back and forth between them").
  for (let i = 0; i < chain.length; i++) {
    const n = chain[i];
    const cx = xs[i];
    const cy = yOf(i);
    if (n.current) {
      svg.push(
        `<circle cx="${cx}" cy="${cy}" r="12" fill="none" stroke="#7fe3a8" stroke-width="1" opacity="0.5" class="map-pulse"/>` +
          `<circle cx="${cx}" cy="${cy}" r="6" fill="#7fe3a8"/>`
      );
    } else {
      // A generous invisible hit-circle under the visible star, tagged for
      // the tap-to-jump handler below.
      svg.push(
        `<circle cx="${cx}" cy="${cy}" r="16" fill="rgba(0,0,0,0.01)" data-chart="${n.chartIdx}" style="cursor:pointer"/>` +
          `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#9fb0c9" data-chart="${n.chartIdx}" style="cursor:pointer"/>`
      );
    }
    const labelSide = cx > W / 2 ? -1 : 1;
    const tx = cx + labelSide * 16;
    const anchor = labelSide === 1 ? "start" : "end";
    svg.push(
      `<text x="${tx}" y="${cy + 3.5}" text-anchor="${anchor}" fill="${n.current ? "#7fe3a8" : "#7a8bab"}" font-size="10" font-family="monospace"${n.current ? "" : ` data-chart="${n.chartIdx}" style="cursor:pointer"`}>${n.name.toUpperCase()}</text>`
    );
    if (n.current) {
      svg.push(
        `<text x="${tx}" y="${cy + 15}" text-anchor="${anchor}" fill="#7fe3a8" font-size="8" font-family="monospace" opacity="0.8">YOU ARE HERE</text>`
      );
    } else {
      svg.push(
        `<text x="${tx}" y="${cy + 15}" text-anchor="${anchor}" fill="#5b6b8a" font-size="7" font-family="monospace" data-chart="${n.chartIdx}" style="cursor:pointer">TAP TO JUMP</text>`
      );
    }
  }
  svg.push("</svg>");
  mapChartEl.innerHTML = svg.join("");
}

function render() {
  updateHud();
  updateLegend();
  updateSystems();
  updateScanInfo();
  updateOutpost();
  updateShipOverlay();
  updateMapOverlay();
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
  const wasJustArrived = justArrived;
  justArrived = false;
  try {
    fn();
    mode = null;
    modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
    scheduleAnims(state.events);
    // A boss win (isVictory) deliberately skips the auto-continue warp —
    // "Run Complete" is a real milestone, not a routine clear, and gets a
    // manual overlay instead (see updateHud). continueBtn triggers the
    // exact same advanceSector flow, just player-initiated.
    if (state.status === "won" && !state.isVictory && !anims.some((a) => a.kind === "warp")) {
      const warpDur = 900;
      anims.push({ kind: "warp", start: performance.now(), dur: warpDur });
      requestAnimationFrame(tickAnims);
      // Swap to the next sector right at the flash's peak opacity (see the
      // flashAlpha curve in draw()'s "warp" case, centered at p=0.55) —
      // the screen is fully obscured at that instant, so the map changes
      // underneath the flash instead of after it finishes.
      setTimeout(advanceSector, warpDur * 0.55);
    } else if (
      state.status === "playing" &&
      Engine.wormholeAvailable(state) &&
      !wasJustArrived &&
      !anims.some((a) => a.kind === "wormhole")
    ) {
      // Flying onto the wormhole is the return trip — same peak-opacity
      // swap timing as the forward warp, tinted differently (see draw()'s
      // "wormhole" case) so going back reads as distinct from going on.
      const warpDur = 900;
      anims.push({ kind: "wormhole", start: performance.now(), dur: warpDur });
      requestAnimationFrame(tickAnims);
      setTimeout(returnToPreviousSector, warpDur * 0.55);
    }
  } catch (err) {
    pushMessage(err.message);
  }
  render();
}

function loadSector(index, carryOver, opts) {
  // The warp-flash anim (if any) survives the swap so it keeps covering
  // the screen through the moment the map actually changes underneath it
  // — its start/dur are timestamps from the real clock, unaffected by
  // state being replaced, so it just keeps fading out over the new sector.
  const keptAnims = opts && opts.keepWarpAnim ? anims.filter((a) => a.kind === "warp") : [];
  levelIndex = index;
  // A wormhole back appears whenever there's a previous charted sector to
  // return to (the chart is empty right after "New Run") — every caller
  // gets this automatically rather than having to remember it.
  // opts.variantId (which of a branching sector's Warp Gates was used —
  // see advanceSector) picks which content generateLevel deals for this
  // depth; omitted for the campaign and for a fresh "New Run".
  state = Engine.createGameState(levelForIndex(levelIndex, opts && opts.variantId), {
    ...carryOver,
    hasPrevious: sectorHistory.length > 0,
  });

  // This brand-new sector joins the chart as the live entry.
  sectorHistory.push({ levelIndex, state: JSON.parse(JSON.stringify(state)) });
  chartIndex = sectorHistory.length - 1;
  justArrived = true;
  mode = null;
  anims = keptAnims;
  announceSector(); // AFTER the anims reset, or the title gets wiped with them
  plannedPath = null;
  autoRoute = null;
  outpostDismissed = false;
  shipAngle = -90;
  updateGeometry();
  render();
}

// A saved state can predate an engine change that altered what
// Engine.createGameState's output looks like (e.g. Branching Warp Gates
// adding `exits`) — restoreRun() loads a state object straight out of
// storage rather than freshly building one via createGameState, so it
// doesn't get a new field for free. Without a check, a stale save would
// hit `state.exits.find(...)` on `undefined` the instant draw() touched
// the first board hex, throwing mid-render and silently blanking the
// whole canvas (confirmed live via a Clubhouse screenshot). This is a
// single-player save with no install base to migrate forward — rather
// than maintaining a migration chain for every past shape, just check
// the save still looks like a currently-valid state, and if not, drop it
// and start fresh instead of trying to patch it.
function isValidSave(s) {
  return (
    Boolean(s) &&
    Array.isArray(s.exits) &&
    s.playerPos &&
    typeof s.levelId === "number" &&
    // The systems rework: ships carry weaponSlots, enemies carry their own
    // reactors. A pre-rework save has neither — drop it, start fresh.
    typeof s.weaponSlots === "number" &&
    (s.enemies || []).every((e) => typeof e.energy === "number")
  );
}

// A run used to be write-only — persist() saved it, but nothing ever read
// it back, so any page reload silently restarted from Sector 1 no matter
// how deep you'd gotten (Clubhouse feedback: "the levels should be
// remembered"). Called once at boot instead of an unconditional
// loadSector(0); falls back to a fresh run if there's nothing saved (or
// nothing valid saved) yet.
function restoreRun() {
  const savedState = GCStorage.get(GAME_ID, "run", null);
  const savedIndex = GCStorage.get(GAME_ID, "levelIndex", null);
  if (!isValidSave(savedState) || savedIndex === null) {
    loadSector(0);
    return;
  }
  levelIndex = savedIndex;
  state = savedState;
  // Same reasoning as isValidSave above, applied per-entry — drop any
  // stale chart snapshot rather than crashing a jump later.
  sectorHistory = GCStorage.get(GAME_ID, "sectorHistory", []).filter((entry) => entry && isValidSave(entry.state));
  const savedChartIndex = GCStorage.get(GAME_ID, "chartIndex", sectorHistory.length - 1);
  chartIndex = Math.max(0, Math.min(savedChartIndex, sectorHistory.length - 1));
  if (!sectorHistory.length) {
    // A valid live state but no chart (older save) — seed the chart with it.
    sectorHistory = [{ levelIndex, state: JSON.parse(JSON.stringify(state)) }];
    chartIndex = 0;
  } else {
    // The live state is the freshest version of its chart slot.
    sectorHistory[chartIndex] = { levelIndex, state: JSON.parse(JSON.stringify(state)) };
  }
  // A save can land mid-"won" (captured the instant a warp animation
  // started) — the animation itself doesn't survive a reload, so just
  // un-consume it back to "playing", same fix as the wormhole return.
  if (state.status === "won") state.status = "playing";
  // Same arrival grace as loadSector — harmless even if the flagship
  // wasn't actually standing on a wormhole when this was saved.
  justArrived = true;
  mode = null;
  anims = [];
  plannedPath = null;
  autoRoute = null;
  outpostDismissed = false;
  shipAngle = -90;
  updateGeometry();
  render();
}

scanBtn.addEventListener("click", () => {
  legendVisible = !legendVisible;
  GCStorage.set(GAME_ID, "legendVisible", legendVisible);
  if (!legendVisible) inspectedHex = null; // closing Scan mode clears whatever was inspected
  render(); // full refresh — every button/toggle's disabled state depends on legendVisible now
});

shipBtn.addEventListener("click", () => {
  shipVisible = !shipVisible;
  mapVisible = false;
  render();
});
shipCloseBtn.addEventListener("click", () => {
  shipVisible = false;
  render();
});
mapBtn.addEventListener("click", () => {
  mapVisible = !mapVisible;
  shipVisible = false;
  render();
});
mapCloseBtn.addEventListener("click", () => {
  mapVisible = false;
  render();
});
// Tap a charted star on the Map to jump to that sector, as you left it.
mapChartEl.addEventListener("click", (evt) => {
  const target = evt.target.closest ? evt.target.closest("[data-chart]") : null;
  if (!target) return;
  jumpToChart(Number(target.dataset.chart));
});
targetLockBtn.addEventListener("click", () => {
  Engine.setSystem(state, "warpdrive", !state.systems.warpdrive);
  pushMessage(
    state.systems.warpdrive
      ? "Target Lock disengaged — Warpdrive back online."
      : "Target Lock engaged — tap an adjacent hex to aim, then FIRE."
  );
  render();
});

tractorStatsEl.addEventListener("click", () => {
  tractorStatsExpanded = !tractorStatsExpanded;
  updateHud();
});

fireBtn.addEventListener("click", () => {
  handleAction(() => Engine.applyFire(state));
});
rechargeBtn.addEventListener("click", () => {
  handleAction(() => Engine.applyRecharge(state));
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
    autoRoute = { target: plannedPath.target, path: plannedPath.hexes, hullAtStart: state.hull, stepIndex: 0 };
    plannedPath = null;
    stepRoute();
    return;
  }
  const path = Engine.findPath(state, state.playerPos, hex);
  plannedPath = path && path.length > 1 ? { target: { q: hex.q, r: hex.r }, hexes: path } : null;
  // The route preview needs its "now confirm it" instruction — with no
  // separate coach line above the field anymore, it goes on the readout
  // strip like every other message.
  if (plannedPath) pushMessage("Course plotted — tap the marked hex again to fly it.");
  render();
}

// Starts at a leisurely, easy-to-track pace and ramps up over the first
// few steps to a much faster cruise speed — Clubhouse feedback: flying a
// long route "feels like it takes forever" at a flat per-step delay.
// Floors out fast rather than instant so a kill/damage mid-route is still
// visible, not just a blur.
function autoRouteDelay(stepIndex) {
  const maxDelay = 300, minDelay = 70, rampSteps = 8;
  const t = Math.min(stepIndex / rampSteps, 1);
  return Math.round(maxDelay - (maxDelay - minDelay) * t);
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
  if (autoRoute) {
    autoRoute.stepIndex += 1;
    setTimeout(stepRoute, autoRouteDelay(autoRoute.stepIndex));
  }
}

canvas.addEventListener("click", (evt) => {
  if (state.status !== "playing" || autoRoute) return;

  const rect = canvas.getBoundingClientRect();
  const scale = geom.w / rect.width;
  const x = (evt.clientX - rect.left) * scale;
  const y = (evt.clientY - rect.top) * scale;
  const hex = pixelToHex(x, y);

  // Scan mode is inspect-only — tapping anything on the board (an enemy,
  // the Warp Gate, the Outpost, the Wormhole, an asteroid field) shows its
  // info and nothing else happens: no move, no action, no turn spent.
  // Scan mode is the no-commitment way to look at anything, so it can't
  // let a tap fall through into a real move or action underneath it.
  if (legendVisible) {
    inspectedHex = { q: hex.q, r: hex.r };
    updateScanInfo();
    return;
  }

  // Target Lock engaged: movement is off the table, and tapping an
  // adjacent hex re-aims the flagship toward it — free, no turn spent —
  // so you can dial in a forward-only weapon's direction, then commit
  // with FIRE.
  if (!state.systems.warpdrive) {
    const dir = Engine.directionIndex(state.playerPos, hex);
    if (dir >= 0) {
      Engine.setFacing(state, dir);
      shipAngle = DIR_ANGLES[dir]; // spin to show the new aim immediately
    } else {
      pushMessage("Target Lock engaged — tap an adjacent hex to aim, then FIRE.");
    }
    render();
    return;
  }

  // Movement never needs a mode armed: any tap that isn't a legal target
  // for an armed Tractor Beam falls back to a plain move (adjacent) or the
  // route preview (further away). Moving IS the turn's action now —
  // weapons only fire on an explicit FIRE.
  const isPlainMove = Engine.legalSublightTargets(state).some((h) => Engine.posEq(h, hex));

  if (mode) {
    const enemy = Engine.enemyAt(state, hex);
    const legal = MODES[mode].targets(state);
    if (enemy && legal.some((e) => e.id === enemy.id)) {
      handleAction(() => {
        if (mode === "tractor") Engine.applyTractor(state, enemy.id);
      });
      return;
    }
  }
  if (isPlainMove) {
    handleAction(() => Engine.applySublight(state, hex));
    return;
  }
  if (Engine.enemyAt(state, hex)) {
    // Tapping a hostile used to do NOTHING, silently — the single most
    // confusing dead-end in playtesting. Say what to do instead.
    pushMessage("That's a hostile — get beside it, then press FIRE.");
    render();
    return;
  }
  const hazardHere = Engine.hazardAt(state, hex);
  if (hazardHere && hazardHere.type === "asteroid") {
    pushMessage("Asteroid field — impassable. Fly around it.");
    render();
    return;
  }
  planOrFlyRoute(hex);
});

modeButtons.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));

restartBtn.addEventListener("click", () => {
  sectorHistory = [];
  chartIndex = -1;
  loadSector(0);
});

continueBtnEl.addEventListener("click", () => {
  advanceSector();
});

outpostCloseBtn.addEventListener("click", () => {
  outpostDismissed = true;
  render();
});

window.addEventListener("resize", () => {
  updateGeometry();
  draw();
});

window.__hhHexCenter = (q, r) => hexToPixel({ q, r }); // debug/test hook: CSS-pixel center of a hex
// debug/test hook: sync the internal levelIndex counter after directly
// mutating window.__hhState (see browser.test.js's boss-milestone test) —
// levelIndex normally only ever changes via loadSector, which keeps it and
// state.levelId in lockstep; a synthetic state injection has to update
// both explicitly or advanceSector's "levelIndex + 1" drifts from reality.
window.__hhSetLevelIndex = (i) => {
  levelIndex = i;
};

restoreRun();
