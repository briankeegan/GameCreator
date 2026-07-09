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
// Tractor/Fighter still need you to pick a mode and then a target enemy.
const MODES = {
  tractor: {
    label: "Tractor Beam",
    targets: Engine.legalTractorTargets,
    kind: "enemy",
    // Shown in the objective line while armed (Clubhouse: "what IS Tractor
    // Beam... weird that I'm able to click on it" — arming a mode used to
    // give no in-the-moment hint at all about what to do next).
    hint: "Tractor Beam armed — tap an adjacent enemy to shove it one hex away. Off the edge, into another ship, or into a hazard = destroyed.",
  },
  fighter: {
    label: "Fighter Squadron",
    targets: Engine.legalFighterTargets,
    kind: "enemy",
    hint: "Fighter Squadron armed — tap any enemy on the board to destroy it at range. Your fighters land on that hex; fly there later to retrieve them and re-enable the Shockwave.",
  },
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
const continueBtnEl = document.getElementById("continueBtn");
const salvageValueEl = document.getElementById("salvageValue");
const shieldWrapEl = document.getElementById("shieldWrap");
const shieldValueEl = document.getElementById("shieldValue");
const energyWrapEl = document.getElementById("energyWrap");
const energyValueEl = document.getElementById("energyValue");
const energyMaxValueEl = document.getElementById("energyMaxValue");
const blinkBtn = document.getElementById("blinkBtn");
const outpostOverlayEl = document.getElementById("outpostOverlay");
const outpostSalvageEl = document.getElementById("outpostSalvage");
const outpostOffersEl = document.getElementById("outpostOffers");
const outpostCloseBtn = document.getElementById("outpostCloseBtn");
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

// Every purchased weapon beyond the base Shockwave (Lance Cannon,
// Repulsor, ...) gets the same UI treatment: hidden until bought, a
// toggle, a tap-to-expand stats badge. Data-driven so adding the next one
// is adding an entry here, not copy-pasting another whole block.
const PURCHASABLE_WEAPON_UI = [
  {
    action: "lance",
    toggleWrap: document.getElementById("lanceToggleWrap"),
    toggle: document.getElementById("toggleLance"),
    stats: document.getElementById("lanceStats"),
    weapon: Engine.WEAPONS.lance,
    expanded: false,
  },
  {
    action: "repulsor",
    toggleWrap: document.getElementById("repulsorToggleWrap"),
    toggle: document.getElementById("toggleRepulsor"),
    stats: document.getElementById("repulsorStats"),
    weapon: Engine.WEAPONS.repulsor,
    expanded: false,
  },
];

// Every piece on the board is custom-drawn (see drawPlayerShip/
// drawEnemyShip/drawWarpGate/drawOutpost/drawFighterMarker below) — no emoji
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

// Whether the legend is open is a remembered player preference, not a
// per-sector default — it starts closed the first time you ever play, and
// after that just stays wherever you last left it (see the Help button).
let legendVisible = GCStorage.get(GAME_ID, "legendVisible", false);

// Each legend key can be independently muted while the legend is open. The
// bold/colored board overlays they describe only ever show while the legend
// itself is open — once it's tucked away, legal-move hexes fall back to a
// plain, always-on whitish border (see draw()) instead of disappearing.
let showThreatKey = true;
let showLegalKey = true;

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

// Tapping an enemy while Help is open inspects it — its stats/weapon/pattern
// show in a small card up top instead of (or alongside) acting on it.
let inspectedEnemyId = null;

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
// sort of thing." Each cleared sector's exact state (enemies dead, salvage
// spent, Outpost visited) is snapshotted before advancing, so returning to
// it later shows it exactly as you left it, not a freshly-regenerated
// board. A wormhole (Engine.wormholeAvailable, drawn as a distinct portal
// — see drawWormhole) appears somewhere on the new board whenever there's
// a sector to go back to; flying onto it triggers the return, no button.
// Going forward again from a rewound sector just re-advances normally —
// no redo stack, only undo.
let sectorHistory = [];

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

function advanceSector() {
  sectorHistory.push({ levelIndex, state: JSON.parse(JSON.stringify(state)) });
  loadSector(
    levelIndex + 1,
    {
      salvage: state.salvage,
      maxHull: state.maxHull,
      shieldCharges: state.shieldCharges,
      maxEnergy: state.maxEnergy,
      // A purchased weapon (Lance Cannon, Repulsor, ...) isn't part of any
      // level's own baked-in actions list, so it has to be carried forward
      // explicitly or the next sector would "forget" it.
      extraActions: Engine.PURCHASABLE_ACTIONS.filter((a) => state.actions.includes(a)),
    },
    { keepWarpAnim: true, variantId: state.usedExitVariant }
  );
}

function returnToPreviousSector() {
  if (!sectorHistory.length) return;
  const prev = sectorHistory.pop();
  // The wormhole-flash anim (if in flight) survives the swap, same as the
  // forward warp does in loadSector — it keeps covering the screen right
  // through the moment the map changes underneath it.
  const keptAnims = anims.filter((a) => a.kind === "wormhole");
  levelIndex = prev.levelIndex;
  state = prev.state;
  // The saved snapshot is mid-"won" (that's the moment it was captured, on
  // the Warp Gate). Un-consume that so the board is live again — moving or
  // Hold Position on the gate re-triggers the normal win check and warps
  // back out through advanceSector, same as clearing it the first time.
  if (state.status === "won") state.status = "playing";
  mode = null;
  anims = keptAnims;
  plannedPath = null;
  autoRoute = null;
  outpostDismissed = false;
  shipAngle = -90;
  updateGeometry();
  render();
}

// The outpost shop pops up automatically the moment the flagship is docked
// on the outpost hex. "Undock" just hides it for as long as you stay parked
// there — flying off and back re-opens it, so this resets whenever the ship
// leaves the hex (see updateOutpost).
let outpostDismissed = false;

// Whether the weapon-stats badge is showing its full sentence (tapped open)
// or just the compact abbreviation (the default). Every purchasable
// weapon's own expanded state lives on its PURCHASABLE_WEAPON_UI entry
// instead of a matching standalone flag here.
let weaponStatsExpanded = false;

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
    else if (ev.type === "blink") anims.push({ kind: "teleport", from: ev.from, to: ev.to, start: now, dur: 400 });
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

// The deployed Fighter Squadron marker: a small drawn craft (not an emoji),
// in the flagship's own gold/gunmetal colorway since these are your ships.
function drawFighterMarker(center, size) {
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.fillStyle = "#3a4358";
  ctx.strokeStyle = "#ffce8a";
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.beginPath();
  ctx.moveTo(size * 0.55, 0);
  ctx.lineTo(-size * 0.4, size * 0.42);
  ctx.lineTo(-size * 0.15, 0);
  ctx.lineTo(-size * 0.4, -size * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#6ee7ff";
  ctx.beginPath();
  ctx.arc(-size * 0.32, 0, size * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
  const rng = seededRandom(`bghue-${levelId}`);
  const hue = Math.floor(rng() * 360);
  const accentHue = (hue + 35 + Math.floor(rng() * 40)) % 360;
  return [
    `hsl(${hue}, 45%, 9%)`,
    `hsl(${hue}, 55%, 3%)`,
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
    if (threats.has(k) && legendVisible && showThreatKey) {
      fill = blend(fill, "#7a1f2b", 0.55);
      fillAlpha = Math.max(fillAlpha, 0.62);
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
    if (legendVisible && legal.has(k) && showLegalKey) {
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
    // Sentry and Railgun are fixed emplacements — they don't pivot to face
    // you (the Railgun's 6 barrels already cover every direction at once);
    // every other enemy points its nose at the flagship.
    if (enemy.type !== "sentry" && enemy.type !== "railgun") {
      ctx.rotate((angleToward(enemy, state.playerPos) * Math.PI) / 180);
    }
    drawEnemyShip(geom.sx * 0.46, enemy.hp / enemy.maxHp, enemy.id, enemy.type);
    ctx.restore();
  }

  if (state.fighterHex) {
    drawFighterMarker(hexToPixel(state.fighterHex), geom.sx * 0.47);
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

  // Random Blink: a quick expanding ring at both the departure and arrival
  // hexes, since the ship just snaps to its new (unpredictable) position.
  for (const a of anims) {
    if (a.kind !== "teleport" || now >= a.start + a.dur) continue;
    const p = animProgress(a, now);
    const ringAlpha = 1 - p;
    for (const pos of [a.from, a.to]) {
      const c = hexToPixel(pos);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(200, 160, 255, ${ringAlpha})`;
      ctx.lineWidth = 2;
      ctx.arc(c.x, c.y, geom.sx * (0.3 + p * 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();

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
  updateHud(); // swaps the objective line to this mode's hint immediately
  draw();
}

function persist() {
  GCStorage.set(GAME_ID, "run", state);
  GCStorage.set(GAME_ID, "levelIndex", levelIndex);
  GCStorage.set(GAME_ID, "sectorHistory", sectorHistory);
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
  salvageValueEl.textContent = state.salvage;
  shieldWrapEl.hidden = state.shieldCharges <= 0;
  shieldValueEl.textContent = state.shieldCharges;
  const blinkUnlocked = state.actions.includes("blink");
  energyWrapEl.hidden = !blinkUnlocked;
  energyValueEl.textContent = state.energy;
  energyMaxValueEl.textContent = state.maxEnergy;

  // The Warp Gate is always online — fighting is never mandatory to leave.
  // Say so, but remind the player that living enemies are still salvage on
  // the table if they want it. While a mode is armed, replace this with a
  // concrete instruction for what tapping the board will actually do —
  // arming used to give no in-the-moment hint at all (Clubhouse: "what IS
  // Tractor Beam... weird that I'm able to click on it").
  const remaining = Engine.livingEnemies(state).length;
  objectiveEl.textContent =
    mode && MODES[mode]
      ? MODES[mode].hint
      : remaining > 0
        ? `Fly to the Warp Gate to warp out — or destroy ${remaining} enemy ${remaining === 1 ? "ship" : "ships"} first for salvage`
        : "Fly to the Warp Gate to warp out!";

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
    overlayBodyEl.textContent = "Permadeath. Your run ends here.";
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
    btn.disabled = state.status !== "playing" || (m === "fighter" && Boolean(state.fighterHex));
    btn.classList.toggle("new-unlock", !locked && !usedActions.has(m));
  });

  blinkBtn.hidden = !blinkUnlocked;
  blinkBtn.disabled = state.status !== "playing" || state.energy < Engine.BLINK_ENERGY_COST;
  blinkBtn.classList.toggle("new-unlock", blinkUnlocked && !usedActions.has("blink"));
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
  const lockedPrefix = unlocked ? "" : "offline · ";
  weaponStatsEl.textContent = lockedPrefix + (weaponStatsExpanded ? describeWeapon(weapon) : describeWeaponCompact(weapon));
  weaponStatsEl.classList.toggle("expanded", weaponStatsExpanded);

  // Every purchased weapon (Lance Cannon, Repulsor, ...) is Outpost-
  // purchase-only (see OUTPOST_OFFER_POOL), not sector-unlocked — hidden
  // entirely until bought, same "simply hidden, no padlock" convention as
  // Tractor Beam/Fighter Squadron before their sector.
  for (const cfg of PURCHASABLE_WEAPON_UI) {
    const owned = state.actions.includes(cfg.action);
    cfg.toggleWrap.hidden = !owned;
    cfg.stats.hidden = !owned;
    if (owned) {
      cfg.toggle.checked = state.systems[cfg.action];
      cfg.stats.textContent = cfg.expanded ? describeWeapon(cfg.weapon) : describeWeaponCompact(cfg.weapon);
      cfg.stats.classList.toggle("expanded", cfg.expanded);
    }
  }
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

function render() {
  updateHud();
  updateLegend();
  updateSystems();
  updateEnemyInfo();
  updateOutpost();
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
  // A wormhole back appears whenever there's a previous sector saved to
  // return to (sectorHistory is empty right after "New Run") — every
  // caller gets this automatically rather than having to remember it.
  // opts.variantId (which of a branching sector's Warp Gates was used —
  // see advanceSector) picks which content generateLevel deals for this
  // depth; omitted for the campaign and for a fresh "New Run".
  state = Engine.createGameState(levelForIndex(levelIndex, opts && opts.variantId), {
    ...carryOver,
    hasPrevious: sectorHistory.length > 0,
  });
  justArrived = true;
  mode = null;
  anims = keptAnims;
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
  return Boolean(s) && Array.isArray(s.exits) && s.playerPos && typeof s.levelId === "number";
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
  // stale history snapshot rather than crashing returnToPreviousSector
  // later when it's popped.
  sectorHistory = GCStorage.get(GAME_ID, "sectorHistory", []).filter((entry) => entry && isValidSave(entry.state));
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

for (const cfg of PURCHASABLE_WEAPON_UI) {
  cfg.toggle.addEventListener("change", () => {
    Engine.setSystem(state, cfg.action, cfg.toggle.checked);
    render();
  });
  cfg.stats.addEventListener("click", () => {
    cfg.expanded = !cfg.expanded;
    updateSystems();
  });
}

holdBtn.addEventListener("click", () => {
  handleAction(() => Engine.applyHoldPosition(state));
});

blinkBtn.addEventListener("click", () => {
  markActionUsed("blink");
  handleAction(() => Engine.applyBlink(state));
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

restartBtn.addEventListener("click", () => {
  sectorHistory = [];
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
