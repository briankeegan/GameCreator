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
const MODES = {
};

const canvas = document.getElementById("board");
// `let`, not const: renderPortrait() temporarily points every drawing
// helper below at an offscreen portrait canvas so the Systems screen can
// show a contact's REAL ship art — the same code the board runs, so the
// portrait can never drift from what you're actually shooting at.
let ctx = canvas.getContext("2d");
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
const shipPortraitEl = document.getElementById("shipPortrait");
const contactPortraitEl = document.getElementById("contactPortrait");
const shipStatsEl = document.getElementById("shipStats");
const shipHardpointsEl = document.getElementById("shipHardpoints");
const shipCloseBtn = document.getElementById("shipCloseBtn");
const mapBtn = document.getElementById("mapBtn");
const mapOverlayEl = document.getElementById("mapOverlay");
const mapChartEl = document.getElementById("mapChart");
const mapCloseBtn = document.getElementById("mapCloseBtn");
const weaponBtnsEl = document.getElementById("weaponBtns");
const rechargeBtn = document.getElementById("rechargeBtn");
const shieldsBtn = document.getElementById("shieldsBtn");
const enginesBtn = document.getElementById("enginesBtn");
const apBarEl = document.getElementById("apBar");
const apWrapEl = document.getElementById("apWrap");
const enemyInfoEl = document.getElementById("enemyInfo");

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
  drift: [170, 235, 130], // hazy green — hazard-heavy drift fields
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

// Tap-tap confirm ("if you click on a target it should target them, and
// clicking again fires — same for move"): the first tap on a hostile
// TARGETS it (reticle + readout line), the second tap fires for real;
// moves preview their route on the first tap and fly on the second;
// tapping anywhere else dismisses the pending choice. Actions execute
// immediately on confirm — no batch queue, no separate commit button.
let targetedEnemyId = null;
// Tapping a piece of equipment that can't act right now shows what it
// covers instead of doing nothing: {hexes: Set<hexKey>, kind} washed over
// the board until the next tap/action. Color language is consistent
// everywhere ("movement should be green, attack range red"): kind "move"
// washes green, kind "attack" washes red-orange, same family as Scan's
// threat overlay.
let reachPreview = null;

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
// "ship" (your flagship) or "contact" (the scanned enemy) — set by whichever
// button opened the Systems screen, never inferred.
let systemsContext = "ship";
// Self-destruct is a two-step: the first tap arms it, the second means it.
let selfDestructArmed = false;
// The starmap — same deal.
let mapVisible = false;


// A not-yet-unlocked action button is simply hidden, then just appears the
// sector it unlocks (see updateHud) — Clubhouse feedback: "what is
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
      hull: state.hull, // hull damage is permanent — warping doesn't repair a breached deck
      maxHull: state.maxHull,
      shieldCharges: state.shieldCharges,
      maxEnergy: state.maxEnergy,
      maxAp: state.maxAp,
      // The Hold carries whole — the ship IS its equipment grid.
      hold: state.hold,
    },
    { keepWarpAnim: true, variantId: state.usedExitVariant }
  );
}

// Jump to ANY charted sector — the wormhole calls this with the previous
// index, the Map calls it with whatever star you tapped.
function jumpToChart(index) {
  if (index === chartIndex || index < 0 || index >= sectorHistory.length) return;
  snapshotLive();
  // The SHIP travels with you — a chart snapshot restores the SECTOR as
  // you left it (enemies, hazards, positions), never your ship's stats.
  // Without this, jumping back through a wormhole would roll back hull
  // damage, salvage, and purchases to whatever they were on your last
  // visit — free repairs and a time-travel exploit in one.
  const ship = {
    hull: state.hull,
    maxHull: state.maxHull,
    salvage: state.salvage,
    shieldCharges: state.shieldCharges,
    energy: state.energy,
    maxEnergy: state.maxEnergy,
    ap: state.ap,
    maxAp: state.maxAp,
    hold: JSON.parse(JSON.stringify(state.hold)),
  };
  const entry = sectorHistory[index];
  // The wormhole-flash anim (if in flight) survives the swap, same as the
  // forward warp does in loadSector — it keeps covering the screen right
  // through the moment the map changes underneath it.
  const keptAnims = anims.filter((a) => a.kind === "wormhole");
  chartIndex = index;
  levelIndex = entry.levelIndex;
  state = JSON.parse(JSON.stringify(entry.state));
  state.hull = Math.min(ship.hull, ship.maxHull);
  state.maxHull = ship.maxHull;
  state.salvage = ship.salvage;
  state.shieldCharges = ship.shieldCharges;
  state.energy = Math.min(ship.energy, ship.maxEnergy);
  state.maxEnergy = ship.maxEnergy;
  state.ap = ship.ap;
  state.maxAp = ship.maxAp;
  state.hold = ship.hold;
  Engine.syncHoldDerived(state);
  // A snapshot may be mid-"won" (captured standing on the Warp Gate).
  // Un-consume that so the board is live again — winning re-triggers
  // normally on the next action taken on the gate.
  if (state.status === "won") state.status = "playing";
  justArrived = true; // don't let standing on the wormhole/gate instantly re-trigger
  mode = null;
  anims = keptAnims;
  announceSector();
  targetedEnemyId = null;
  reachPreview = null;
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
  // Some places are tighter than others: a locale can pull the camera IN
  // (never further out than the standard board — that reads as "smaller",
  // not "bigger"), which is another way a sector announces where it is.
  const zoom = state.locale && state.locale.zoom ? Math.max(1, state.locale.zoom) : 1;
  const sx = Math.min(sxFromWidth, sxFromHeight) * zoom;
  // The canvas takes the WHOLE area it's given and the board floats in the
  // middle of it — the sky is the place, not a texture inside the grid's
  // outline. Everything around the hexes is still this sector: its planet,
  // its dust banks, its wrecks.
  const boardW = (maxX - minX + 2) * sx;
  const boardH = (maxY - minY + SQRT3 * HEX_RATIO) * sx;
  const cssW = Math.round(Math.max(boardW + 2 * pad, Math.min(availW, 520)));
  const cssH = Math.round(Math.max(boardH + 2 * pad, availH));
  geom = {
    sx,
    sy: sx * HEX_RATIO,
    offX: (cssW - boardW) / 2 + (1 - minX) * sx,
    offY: (cssH - boardH) / 2 + ((SQRT3 * HEX_RATIO) / 2 - minY) * sx,
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

// Each weapon's signature look ("weapons need unique attack appearance"):
// the Autocannon spits bolts, the Flak Burst blooms a ring across every
// adjacent hex, the Arc Beam and Railgun sweep beams in their own colors.
// One entry per weapon covers BOTH ships now that enemies carry the same
// items you do — a Cruiser's flak looks like your flak, because it is.
const WEAPON_FX = {
  autocannon: { kind: "bolt", color: "#ff8a72" },
  flakBurst: { kind: "ring", color: "#ffb36b" },
  arcBeam: { kind: "beam", color: "#8aff9e", width: 2.5 },
  railgun: { kind: "beam", color: "#ff5ad2", width: 3.5 },
};

function scheduleAnims(events) {
  const now = performance.now();
  // The enemy phase plays back SEQUENTIALLY ("enemy moves are too fast to
  // see"): each enemy action claims its own time slot instead of everything
  // resolving in one invisible instant. Player-side effects stay immediate.
  let slot = 0; // ms offset for the next enemy action
  let lastAttackSlot = 0;
  const step = events.filter((e) => e.type === "attack" || e.type === "enemyMove").length > 5 ? 240 : 340;
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
    else if (ev.type === "playerFire") {
      const fx = WEAPON_FX[ev.weapon];
      if (fx && fx.kind === "ring") {
        anims.push({ kind: "fxring", pos: ev.from, color: fx.color, start: now, dur: 420 });
      } else if (fx) {
        for (const t of ev.targets) {
          anims.push({ kind: "fxbeam", from: ev.from, to: t, color: fx.color, width: fx.width || 2.5, start: now, dur: 380 });
        }
      }
    }
    else if (ev.type === "attack") {
      slot += step;
      lastAttackSlot = slot;
      anims.push({ kind: "lunge", enemyId: ev.enemyId, start: now + slot, dur: 320 });
      const fx = WEAPON_FX[ev.weapon];
      if (fx && ev.target) {
        if (fx.kind === "bolt") {
          anims.push({ kind: "fxbolt", from: { q: ev.q, r: ev.r }, to: ev.target, color: fx.color, start: now + slot, dur: 320 });
        } else {
          anims.push({ kind: "fxbeam", from: { q: ev.q, r: ev.r }, to: ev.target, color: fx.color, width: (fx.width || 2.5), start: now + slot, dur: 420 });
        }
      }
    }
    else if (ev.type === "damage") anims.push({ kind: "flash", start: now + lastAttackSlot + 140, dur: 380 });
    else if (ev.type === "shieldAbsorb") anims.push({ kind: "flash", start: now + lastAttackSlot + 140, dur: 380 });
    else if (ev.type === "enemyMove") {
      slot += step;
      anims.push({ kind: "slide", enemyId: ev.enemyId, from: ev.from, to: ev.to, start: now + slot, dur: 240 });
    }
    else if (ev.type === "playerMove") {
      anims.push({ kind: "pslide", from: ev.from, to: ev.to, start: now, dur: 230 });
      const dir = Engine.directionIndex(ev.from, ev.to);
      if (dir >= 0) shipAngle = DIR_ANGLES[dir];
    }
    else if (ev.type === "playerDeath") anims.push({ kind: "boom", pos: ev, start: now + lastAttackSlot + 200, dur: 650, particles: makeExplosionParticles(16) });
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
// A gate is painted in the colour of what's THROUGH it, and the number of
// arcs in its ring is a property of the place too. Nothing anywhere says
// so — you learn it by going through a few and noticing that the ring with
// four broken arcs always drops you somewhere full of wrecks. (Clubhouse:
// "gates should be advertising in some secret way... people can just
// figure that out as they play.")
function gateLook(variantId) {
  const ahead = state.levelId && window.HypergolicLevels && window.HypergolicLevels.localeAhead
    ? window.HypergolicLevels.localeAhead(state.levelId, variantId)
    : null;
  if (!ahead || !ahead.hue) return { rgb: BRANCH_TINTS[variantId] || [120, 255, 210], arcs: 3, dash: false };
  const rgb = hslToRgb(ahead.hue, Math.min(85, ahead.sat + 30), 62);
  const ARCS = { shoals: 2, shallows: 3, void: 1, belt: 4, storm: 5, graveyard: 6, bulwark: 3 };
  return { rgb, arcs: ARCS[ahead.id] || 3, dash: ahead.id === "belt" || ahead.id === "graveyard" };
}

function hslToRgb(h, sPct, lPct) {
  const sat = sPct / 100;
  const light = lPct / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function drawWarpGate(center, r, online, now, rgb, look) {
  const [cr, cg, cb] = rgb || [120, 255, 210];
  const arcs = (look && look.arcs) || 3;
  const dashed = Boolean(look && look.dash);
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
    // The ring: how many arcs, and whether they're broken, is the tell.
    if (dashed) ctx.setLineDash([Math.max(2, r * 0.18), Math.max(2, r * 0.14)]);
    for (let i = 0; i < arcs; i++) {
      const a = (i * Math.PI * 2) / arcs;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, a, a + (Math.PI * 2) / arcs - 0.35);
      ctx.stroke();
    }
    ctx.setLineDash([]);
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
    // Dark, but the ring still has its shape — you can read where a gate
    // goes while you're still clearing the sector, not only once it lights.
    ctx.strokeStyle = "rgba(150,170,190,0.5)";
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.lineCap = "round";
    if (dashed) ctx.setLineDash([Math.max(2, r * 0.18), Math.max(2, r * 0.14)]);
    for (let i = 0; i < arcs; i++) {
      const a = (i * Math.PI * 2) / arcs;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, a, a + (Math.PI * 2) / arcs - 0.35);
      ctx.stroke();
    }
    ctx.setLineDash([]);
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

// ---- WHERE YOU ARE ------------------------------------------------------
// The backdrop is the PLACE, and it fills the whole frame — the hex grid
// floats on top of it as an overlay, rather than the old arrangement where
// space was painted inside the board's silhouette and everything outside
// was flat panel colour. Each locale (see levels.js LOCALES) paints its own
// sky and its own furniture: a planet's limb, dust shoals, an old wreck
// field. The point is recognition — come back through a wormhole four jumps
// later and the board should tell you where you are before any text does.
const SECTOR_BG = {
  1: ["#0a1c2e", "#04090f", "rgba(40,180,200,0.18)"], // steel cyan — the Outer Reach
  2: ["#1b1233", "#080510", "rgba(150,70,230,0.22)"], // violet nebula
  3: ["#0a2622", "#03100e", "rgba(40,220,150,0.20)"], // toxic teal — Sentry country
  4: ["#2c1024", "#0e0510", "rgba(230,60,110,0.22)"], // crimson-magenta — the Gauntlet
};

function localeOf() {
  return (state && state.locale) || null;
}

// [inner, outer, nebula-accent] — the whole sky of a place.
const SKIES = {
  shoals: ["hsl(30, 46%, 12%)", "hsl(22, 55%, 4%)", "hsla(40, 70%, 58%, 0.16)"],
  shallows: ["hsl(206, 55%, 9%)", "hsl(220, 62%, 3%)", "hsla(192, 85%, 60%, 0.14)"],
  void: ["hsl(238, 32%, 4%)", "hsl(240, 45%, 1%)", "hsla(250, 55%, 50%, 0.07)"],
  belt: ["hsl(16, 48%, 9%)", "hsl(10, 58%, 3%)", "hsla(30, 75%, 55%, 0.14)"],
  storm: ["hsl(283, 55%, 12%)", "hsl(272, 65%, 4%)", "hsla(310, 90%, 62%, 0.20)"],
  graveyard: ["hsl(168, 28%, 7%)", "hsl(178, 36%, 2%)", "hsla(150, 45%, 45%, 0.10)"],
  bulwark: ["hsl(2, 46%, 9%)", "hsl(355, 58%, 3%)", "hsla(15, 85%, 55%, 0.17)"],
};

function backdropForLevel(levelId) {
  const locale = localeOf();
  // Hand-picked per place rather than one formula off a hue: the formula
  // put every sector at the same near-black with a slight tint, which is
  // most of why they all looked alike. Dust scatters light and is genuinely
  // bright; the Deep is as close to nothing as the screen allows.
  if (locale && SKIES[locale.id]) return SKIES[locale.id];
  if (locale) {
    const accent = (locale.hue + 40) % 360;
    return [
      `hsl(${locale.hue}, ${locale.sat}%, 10%)`,
      `hsl(${locale.hue}, ${Math.min(70, locale.sat + 12)}%, 3%)`,
      `hsla(${accent}, ${Math.min(80, locale.sat + 25)}%, 55%, 0.22)`,
    ];
  }
  if (SECTOR_BG[levelId]) return SECTOR_BG[levelId];
  const theme = state.theme;
  const rng = seededRandom(`bghue-${levelId}-${theme ? theme.variant : "x"}`);
  const hue = Math.floor(rng() * 360);
  return [`hsl(${hue}, 45%, 9%)`, `hsl(${hue}, 55%, 3%)`, `hsla(${(hue + 35) % 360}, 70%, 55%, 0.20)`];
}

const starCache = new Map();
function starsFor(levelId, w, h, density) {
  const key = `${levelId}:${w}x${h}:${density}`;
  if (starCache.has(key)) return starCache.get(key);
  const rng = seededRandom(`stars-${key}`);
  const stars = [];
  for (let i = 0; i < density; i++) {
    stars.push({ x: rng() * w, y: rng() * h, r: 0.4 + rng() * 1.4, a: 0.2 + rng() * 0.6 });
  }
  starCache.set(key, stars);
  return stars;
}

// The furniture. Each locale draws one big recognisable thing plus its own
// texture, all of it behind the grid and outside the board's edges too, so
// the sector reads as a place the board is sitting IN.
// How the navigable grid is lit HERE — line colour/weight, and the wash
// that separates the board from the sky behind it. Six entries, six looks.
const GRID_LOOKS = {
  shoals: { stroke: "rgba(226,188,140,0.34)", width: 0.9, panel: ["rgba(255,214,150,0.07)", "rgba(180,120,60,0.05)"] },
  shallows: { stroke: "rgba(196,226,255,0.52)", width: 0.85, panel: ["rgba(160,215,255,0.10)", "rgba(40,90,160,0.06)"] },
  void: { stroke: "rgba(150,172,214,0.20)", width: 0.6, panel: ["rgba(120,150,210,0.035)", "rgba(60,80,140,0.02)"] },
  belt: { stroke: "rgba(240,176,116,0.46)", width: 1.05, panel: ["rgba(255,170,90,0.08)", "rgba(150,70,30,0.05)"] },
  storm: { stroke: "rgba(228,172,255,0.58)", width: 1.15, panel: ["rgba(220,150,255,0.11)", "rgba(110,50,170,0.07)"] },
  graveyard: { stroke: "rgba(154,220,200,0.30)", width: 0.8, panel: ["rgba(120,220,195,0.05)", "rgba(30,80,70,0.04)"] },
  bulwark: { stroke: "rgba(255,150,150,0.55)", width: 1.2, panel: ["rgba(255,120,110,0.10)", "rgba(120,20,20,0.07)"] },
};
const DEFAULT_GRID_LOOK = { stroke: "rgba(201,214,232,0.6)", width: 0.75, panel: ["rgba(190,225,255,0.07)", "rgba(120,170,230,0.03)"] };

function gridLook() {
  const locale = localeOf();
  return (locale && GRID_LOOKS[locale.id]) || DEFAULT_GRID_LOOK;
}

function drawLocaleFeature(feature, hue, sat) {
  const w = geom.w;
  const h = geom.h;
  const rng = seededRandom(`feature-${state.levelId}-${feature}`);
  ctx.save();
  if (feature === "planet") {
    // A world, and you are close to it. It owns most of the frame, has a
    // hard terminator and a lit atmosphere rim — not a tinted circle.
    const left = rng() < 0.5;
    const cx = w * (left ? -0.55 : 1.55);
    const cy = h * (0.05 + rng() * 0.4);
    const r = h * (0.62 + rng() * 0.18);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const body = ctx.createLinearGradient(cx + (left ? r : -r), cy, cx + (left ? -r : r), cy);
    body.addColorStop(0, `hsl(${hue}, ${sat + 25}%, 46%)`);
    body.addColorStop(0.45, `hsl(${hue - 6}, ${sat + 15}%, 24%)`);
    body.addColorStop(0.78, `hsl(${hue - 10}, ${sat}%, 8%)`);
    body.addColorStop(1, "#05070c");
    ctx.fillStyle = body;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    // Latitude banding, wide and soft — a real gas envelope.
    for (let i = 0; i < 11; i++) {
      const band = cy - r + (r * 2 * (i + 0.5)) / 11;
      ctx.globalAlpha = 0.14 + rng() * 0.12;
      ctx.fillStyle = `hsl(${(hue + (i % 3) * 9) % 360}, ${sat + 20}%, ${20 + (i % 4) * 8}%)`;
      ctx.beginPath();
      ctx.ellipse(cx, band, r, r * (0.03 + rng() * 0.05), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // One storm eye, because a planet you remember has a landmark.
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = `hsl(${(hue + 20) % 360}, ${sat + 30}%, 52%)`;
    ctx.beginPath();
    ctx.ellipse(cx + (left ? r * 0.55 : -r * 0.55), cy + r * 0.18, r * 0.13, r * 0.07, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Atmosphere: a bright rim on the lit limb, fading into the sky.
    ctx.globalAlpha = 1;
    const halo = ctx.createRadialGradient(cx, cy, r * 0.97, cx, cy, r * 1.13);
    halo.addColorStop(0, `hsla(${hue + 10}, 90%, 72%, 0.42)`);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.13, 0, Math.PI * 2);
    ctx.fill();
  } else if (feature === "dust") {
    // Shoals: you are INSIDE the dust, not looking at it. Heavy warm banks
    // that swallow the far side of the board.
    for (let i = 0; i < 7; i++) {
      const bx = rng() * w;
      const by = rng() * h;
      const br = h * (0.3 + rng() * 0.4);
      const cloud = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      cloud.addColorStop(0, `hsla(${hue + 8}, ${sat + 25}%, 44%, 0.15)`);
      cloud.addColorStop(0.5, `hsla(${hue}, ${sat + 10}%, 28%, 0.08)`);
      cloud.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cloud;
      ctx.fillRect(0, 0, w, h);
    }
    // Grit, close to the lens.
    for (let i = 0; i < 150; i++) {
      ctx.globalAlpha = 0.1 + rng() * 0.35;
      ctx.fillStyle = `hsl(${hue + rng() * 20}, ${sat + 20}%, ${55 + rng() * 25}%)`;
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, 0.6 + rng() * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (feature === "wrecks") {
    // The Breakers: a shipping lane that didn't make it. A debris LANE
    // crosses the frame on a diagonal, dense along its spine.
    const angle = -0.5 + rng() * 1.0;
    ctx.save();
    ctx.translate(w * 0.5, h * 0.5);
    ctx.rotate(angle);
    const lane = ctx.createLinearGradient(0, -h * 0.55, 0, h * 0.55);
    lane.addColorStop(0, "rgba(0,0,0,0)");
    lane.addColorStop(0.5, `hsla(${hue}, ${sat + 20}%, 40%, 0.22)`);
    lane.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lane;
    ctx.fillRect(-w, -h * 0.55, w * 2, h * 1.1);
    // Rocks and torn plate, thickest along the lane.
    for (let i = 0; i < 70; i++) {
      const x = (rng() * 2 - 1) * w;
      const spread = (rng() + rng() + rng()) / 3 - 0.5; // clustered on the spine
      const y = spread * h * 0.9;
      const size = 2 + rng() * 14 * (1 - Math.abs(spread) * 1.2);
      if (size < 1.5) continue;
      ctx.globalAlpha = 0.35 + rng() * 0.4;
      ctx.fillStyle = `hsl(${hue + rng() * 14}, ${sat - 10}%, ${16 + rng() * 22}%)`;
      ctx.beginPath();
      const pts = 5 + Math.floor(rng() * 3);
      for (let p = 0; p < pts; p++) {
        const a = (p / pts) * Math.PI * 2;
        const rr = size * (0.6 + rng() * 0.6);
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr * 0.7;
        if (p === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  } else if (feature === "hulks") {
    // The Cold Yard: big dead ships, ALL POINTING THE SAME WAY. They are
    // still holding a formation nobody stood down. That alignment is the
    // thing you recognise when you come back.
    const heading = -0.35 + rng() * 0.7;
    const rows = 4;
    for (let i = 0; i < 7; i++) {
      const x = w * (0.08 + (i % 3) * 0.36 + rng() * 0.1);
      const y = h * (0.08 + Math.floor(i / 3) * (0.9 / rows) + rng() * 0.12);
      const len = h * (0.18 + rng() * 0.22);
      const wide = len * (0.16 + rng() * 0.08);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(heading);
      ctx.globalAlpha = 0.55;
      // Hull: a long wedge with a broken spine.
      ctx.fillStyle = `hsl(${hue}, ${Math.max(8, sat - 22)}%, 13%)`;
      ctx.beginPath();
      ctx.moveTo(-len * 0.5, 0);
      ctx.lineTo(-len * 0.2, -wide * 0.5);
      ctx.lineTo(len * 0.42, -wide * 0.32);
      ctx.lineTo(len * 0.5, 0);
      ctx.lineTo(len * 0.42, wide * 0.32);
      ctx.lineTo(-len * 0.2, wide * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = `hsl(${hue + 6}, ${sat}%, 34%)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      // A few running lights nobody ever switched off.
      for (let d = 0; d < 3; d++) {
        ctx.globalAlpha = 0.25 + rng() * 0.5;
        ctx.fillStyle = `hsl(${hue + 20}, 80%, 70%)`;
        ctx.beginPath();
        ctx.arc(-len * 0.3 + d * len * 0.3, 0, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  } else if (feature === "storm") {
    // Ion front: the sky itself is the hazard. Bright curtains, top to
    // bottom, and a horizon-wide glow along one edge.
    for (let i = 0; i < 6; i++) {
      const x = rng() * w;
      const wide = w * (0.12 + rng() * 0.22);
      const curtain = ctx.createLinearGradient(x - wide, 0, x + wide, h);
      curtain.addColorStop(0, "rgba(0,0,0,0)");
      curtain.addColorStop(0.5, `hsla(${(hue + rng() * 60) % 360}, 90%, 66%, ${0.16 + rng() * 0.2})`);
      curtain.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = curtain;
      ctx.fillRect(0, 0, w, h);
    }
    const front = ctx.createLinearGradient(0, h, 0, h * 0.45);
    front.addColorStop(0, `hsla(${(hue + 30) % 360}, 95%, 62%, 0.26)`);
    front.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = front;
    ctx.fillRect(0, 0, w, h);
    // Discharge filaments.
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = `hsla(${(hue + 40) % 360}, 100%, 82%, 0.5)`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let x = rng() * w;
      let y = rng() * h * 0.3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 7; s++) {
        x += (rng() - 0.5) * w * 0.16;
        y += h * 0.08;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (feature === "void") {
    // The Deep: no furniture at all. One far-off galaxy, small enough that
    // it makes the emptiness bigger rather than filling it.
    const gx = w * (0.15 + rng() * 0.7);
    const gy = h * (0.12 + rng() * 0.6);
    const gr = h * (0.1 + rng() * 0.08);
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(rng() * Math.PI);
    ctx.scale(1, 0.32);
    const smear = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
    smear.addColorStop(0, `hsla(${hue + 20}, 60%, 78%, 0.3)`);
    smear.addColorStop(0.5, `hsla(${hue}, 50%, 55%, 0.1)`);
    smear.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = smear;
    ctx.beginPath();
    ctx.arc(0, 0, gr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// Some places are in FRONT of you as well as behind — you fly through the
// dust and the charge, not past them. This runs after the board is drawn,
// so the near side of the weather sits over the grid and the sector
// genuinely feels different to be inside of.
function drawLocaleForeground(now) {
  const locale = localeOf();
  if (!locale) return;
  const w = geom.w;
  const h = geom.h;
  const t = (now || 0) / 1000;
  ctx.save();
  if (locale.feature === "dust") {
    const rng = seededRandom(`fg-${state.levelId}`);
    for (let i = 0; i < 4; i++) {
      const bx = ((rng() * w + t * (6 + i * 4)) % (w * 1.4)) - w * 0.2;
      const by = rng() * h;
      const br = h * (0.22 + rng() * 0.2);
      const cloud = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      cloud.addColorStop(0, `hsla(${locale.hue + 10}, ${locale.sat + 20}%, 52%, 0.13)`);
      cloud.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cloud;
      ctx.fillRect(0, 0, w, h);
    }
  } else if (locale.feature === "storm") {
    // The charge crawls across everything, board included.
    const pulse = 0.05 + 0.05 * Math.sin(t * 1.7);
    const sheet = ctx.createLinearGradient(0, 0, w, h);
    sheet.addColorStop(0, `hsla(${locale.hue}, 90%, 70%, ${pulse})`);
    sheet.addColorStop(0.5, "rgba(0,0,0,0)");
    sheet.addColorStop(1, `hsla(${(locale.hue + 50) % 360}, 90%, 70%, ${pulse})`);
    ctx.fillStyle = sheet;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function drawSectorBackdrop() {
  const bg = backdropForLevel(state.levelId);
  const locale = localeOf();
  const g = ctx.createRadialGradient(geom.w * 0.5, geom.h * 0.34, geom.w * 0.08, geom.w * 0.5, geom.h * 0.52, geom.h * 0.9);
  g.addColorStop(0, bg[0]);
  g.addColorStop(1, bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, geom.w, geom.h);
  const neb = ctx.createRadialGradient(geom.w * 0.72, geom.h * 0.24, 0, geom.w * 0.72, geom.h * 0.24, geom.h * 0.7);
  neb.addColorStop(0, bg[2]);
  neb.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = neb;
  ctx.fillRect(0, 0, geom.w, geom.h);
  // Star density is part of a locale's identity: the Deep is nothing but
  // stars, the shoals are half-hidden by dust.
  const density = locale ? { void: 190, shoals: 45, shallows: 80, belt: 90, storm: 70, graveyard: 60 }[locale.id] || 90 : 90;
  ctx.save();
  for (const st of starsFor(state.levelId, Math.round(geom.w), Math.round(geom.h), density)) {
    ctx.globalAlpha = st.a;
    ctx.fillStyle = "#dbe7ff";
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (locale) drawLocaleFeature(locale.feature, locale.hue, locale.sat);
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
  // The place first, edge to edge — the sky is not something that stops at
  // the board's outline ("the full background is actually the background,
  // and the grid is just an overlay on top of it"). The board is then laid
  // over it as a lit panel of navigable space.
  drawSectorBackdrop();
  ctx.save();
  ctx.clip(boardPath());
  const panel = gridLook().panel;
  const lit = ctx.createLinearGradient(0, 0, 0, geom.h);
  lit.addColorStop(0, panel[0]);
  lit.addColorStop(1, panel[1]);
  ctx.fillStyle = lit;
  ctx.fillRect(0, 0, geom.w, geom.h);
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
        (Engine.enemyShip(scanTarget) ? Engine.enemyShip(scanTarget).weapons : [])
          .flatMap((w) => Engine.weaponHexes(scanTarget, Engine.enemyFacing(state, scanTarget), w, state))
          .filter((h) => Engine.onBoard(state, h))
          .map(Engine.hexKey)
      )
    : null;
  const legal = mode ? new Set(MODES[mode].targets(state).map((h) => Engine.hexKey(h))) : new Set();
  // The Impulse Cannon isn't a mode you arm anymore, but its current target
  // (dead ahead of facing, or every neighbor for an omnidirectional weapon)
  // is exactly the same kind of thing "outlined hex" already means, so it
  // gets folded into the same highlight instead of a separate one.
  for (const key of Engine.WEAPON_SYSTEM_KEYS) {
    if (!state.actions.includes(key) || !state.systems[key]) continue;
    for (const h of Engine.weaponHexes(state.playerPos, state.facing, Engine.WEAPONS[key], state)) {
      if (Engine.onBoard(state, h)) legal.add(Engine.hexKey(h));
    }
  }
  // Mirrors the whitish hex border, but for enemies: any enemy an unlocked action could
  // ever target, regardless of which mode happens to be armed right now —
  // not just the one enemy set belonging to the currently-selected mode.
  const targetable = new Set();
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
    // Course/route preview: green, the one color movement always wears.
    if (route.has(k)) {
      fill = blend(fill, "#2e7d52", 0.5);
      fillAlpha = Math.max(fillAlpha, 0.58);
    }
    // Equipment reach preview (tap a weapon/engines button, or lock a
    // target): green = where you can move, red-orange = what your
    // weapons cover — same color language as the Scan overlay.
    if (reachPreview && reachPreview.hexes.has(k)) {
      fill = blend(fill, reachPreview.kind === "move" ? "#2e7d52" : "#a03a26", 0.55);
      fillAlpha = Math.max(fillAlpha, 0.62);
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
      // The grid belongs to the PLACE, not to the game engine. One fixed
      // near-white lattice everywhere was doing most of the looking, which
      // is why six different skies still read as the same board — you saw
      // the lattice and a hue shift behind it. Out in the Deep it's barely
      // there; in an ion front the whole sky is charged and so are the
      // lines. ("They all look basically the same.")
      const gl = gridLook();
      stroke = gl.stroke;
      strokeWidth = gl.width;
    }
    if (legendVisible && legal.has(k)) {
      stroke = "#7fe3a8";
      strokeWidth = 3;
    }
    drawHex(center, fill, stroke, strokeWidth, fillAlpha);

    if (isExit) {
      const look = gateLook(exitHere.variantId);
      drawWarpGate(center, geom.sx * 0.5, state.exitUnlocked, now, look.rgb, look);
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

  // The gunnery target: first tap locked this contact — a pulsing red
  // reticle marks it until the confirming second tap fires (or another
  // tap stands it down). Every OTHER contact the volley would strike
  // (multi-hit weapons) gets a smaller steady crosshair, so "where it'll
  // hit" is fully visible before committing.
  if (targetedEnemyId && state.status === "playing") {
    const drawReticle = (pos, r, pulseAlpha) => {
      const c = hexToPixel(pos);
      ctx.save();
      ctx.strokeStyle = "#ff5a4a";
      ctx.globalAlpha = pulseAlpha;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const ang = (Math.PI / 2) * i + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(ang) * r * 0.72, c.y + Math.sin(ang) * r * 0.72);
        ctx.lineTo(c.x + Math.cos(ang) * r * 1.18, c.y + Math.sin(ang) * r * 1.18);
        ctx.stroke();
      }
      ctx.restore();
    };
    const target = state.enemies.find((e) => e.id === targetedEnemyId && e.alive);
    if (target) {
      const pulse = 1 + 0.08 * Math.sin(now / 160);
      drawReticle(target, geom.sx * 0.62 * pulse, 1);
      for (const v of predictedVictims(targetedEnemyId)) {
        if (v.id === targetedEnemyId) continue;
        drawReticle(v, geom.sx * 0.45, 0.75);
      }
    }
  }

  // Weapon signatures — every shot looks like ITS weapon ("weapons need
  // unique attack appearance"): expanding rings for the Shockwave (amber)
  // and Repulsor (blue), piercing beams for the Lance/Sentry/Railgun in
  // their own colors, traveling bolts for enemy cannons.
  for (const a of anims) {
    if (now < a.start || now >= a.start + a.dur) continue;
    const p = animProgress(a, now);
    if (a.kind === "fxring") {
      const c = hexToPixel(a.pos);
      ctx.save();
      ctx.globalAlpha = 0.9 * (1 - p);
      ctx.strokeStyle = a.color;
      ctx.lineWidth = 3.5 * (1 - p * 0.5);
      ctx.beginPath();
      ctx.arc(c.x, c.y, geom.sx * (0.3 + p * 1.35), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (a.kind === "fxbeam") {
      const from = hexToPixel(a.from);
      const to = hexToPixel(a.to);
      ctx.save();
      ctx.globalAlpha = Math.sin(Math.PI * p) * 0.95;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.shadowColor = a.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
    } else if (a.kind === "fxbolt") {
      const from = hexToPixel(a.from);
      const to = hexToPixel(a.to);
      const x = from.x + (to.x - from.x) * p;
      const y = from.y + (to.y - from.y) * p;
      ctx.save();
      ctx.fillStyle = a.color;
      ctx.shadowColor = a.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      // a short trail behind the bolt
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(from.x + (to.x - from.x) * Math.max(0, p - 0.18), from.y + (to.y - from.y) * Math.max(0, p - 0.18));
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
    }
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

  // ...and the near side of the weather, over the top of all of it.
  drawLocaleForeground(now);

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
function renderStatBar(el, label, filled, max, variant, pending = 0) {
  el.innerHTML = "";
  el.setAttribute("aria-label", `${label} ${filled}/${max}`);
  for (let i = 0; i < max; i++) {
    const pip = document.createElement("span");
    let cls = `stat-pip stat-pip-${variant}`;
    if (i < filled) cls += " filled";
    // The top `pending` filled pips render GHOSTED (lighter green) while a
    // target is locked — the energy the confirmed shot would burn away.
    if (pending > 0 && i >= filled - pending && i < filled) cls += " pending";
    el.appendChild(pip);
    pip.className = cls;
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

// Would a FIRE volley land from this (real or simulated) state? Drives the
// FIRE button's enabled/lit state — evaluated against the PLAN's ghost
// position, so queuing a lunge lights the button up for the follow-up shot.
function anyFireTarget(s) {
  return Engine.WEAPON_SYSTEM_KEYS.some((k) => {
    if (!s.actions.includes(k) || !s.systems[k]) return false;
    const weapon = Engine.WEAPONS[k];
    const reach = new Set(Engine.weaponHexes(s.playerPos, s.facing, weapon, s).map(Engine.hexKey));
    return Engine.livingEnemies(s).some((e) => reach.has(Engine.hexKey(e)));
  });
}

function updateHud() {
  // The Actions gauge only earns its spot when a round is more than one
  // action ("you could just hide the actions" — the AP plumbing stays for
  // a future re-expansion, the pips just stay out of the way at 1/1).
  apWrapEl.hidden = state.maxAp <= 1;
  renderStatBar(apBarEl, "Actions", state.ap, state.maxAp, "ap");
  flashOnChange("ap", state.ap, apWrapEl);
  renderStatBar(hullBarEl, "Hull", state.hull, state.maxHull, "hull");
  // Energy pays for every weapon shot, so the reactor gauge is always up.
  // While a target is locked, the pips the volley would spend go ghostly
  // ("show the energy it would cost in lighter green").
  const lockPending = targetedEnemyId ? Math.min(nextShotCost(state), state.energy) : 0;
  renderStatBar(energyBarEl, "Energy", state.energy, state.maxEnergy, "energy", lockPending);
  // Shields = generator capacity (empty sockets included, so a DOWN
  // shield is visible as an unlit pip begging to be re-raised). The gauge
  // is hidden entirely until a Shield Generator is installed — no empty
  // socket for something you may never buy; the cluster reads
  // SHIELDS | HULL, in damage order (shields absorb first).
  shieldWrapEl.hidden = state.maxShields <= 0;
  renderStatBar(shieldBarEl, "Shields", state.shieldCharges, state.maxShields, "shield");
  flashOnChange("hull", state.hull, hullWrapEl);
  flashOnChange("energy", state.energy, energyWrapEl);
  flashOnChange("shield", state.shieldCharges, shieldWrapEl);
  flashOnChange("salvage", state.salvage, salvageWrapEl);
  // ONE message at a time — three run together read as clipped word soup.
  // There is no separate instruction line above the field anymore ("remove
  // the tap info at top — distracts from game"): the readout strip is the
  // single home for every message and hint.
  logEl.textContent = state.log[state.log.length - 1] || "Helm ready. Mark a heading.";
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
    overlayBodyEl.textContent = `Lost with all hands at depth ${state.levelId}. Deepest run so far: ${bestDepth}.`;
    continueBtnEl.hidden = true;
    overlayEl.hidden = false;
  } else if (state.isVictory && !animsRunning()) {
    overlayTitleEl.textContent = "The Bulwark Is Scrap";
    overlayBodyEl.textContent = `The Bulwark is dead in the water at depth ${state.levelId}. Press on, or take the ship home.`;
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

}

// Scan mode has no icon-key overlay anymore ("all it should really be is
// when you're scanning, you just tap things") — the button lights up, the
// readout strip above the field says what to do, and tapping anything
// identifies it.
function updateLegend() {
  // Scan is HARDWARE: stow the Scanner Array and the mode itself dies.
  if (legendVisible && !state.scannerInstalled) legendVisible = false;
  scanBtn.disabled = !state.scannerInstalled;
  scanBtn.classList.toggle("active", legendVisible);
}

// The panel's action row: one button per piece of fitted hardware.
// Target Lock is the old "toggle Warpdrive off to aim" trick promoted to
// a first-class stance button: engaged = movement offline, taps aim the
// flagship, FIRE commits the shot.
// The weapons currently armed (owned + toggled on) — what the Weapons
// button represents this moment.
function armedWeaponKeys() {
  return Engine.WEAPON_SYSTEM_KEYS.filter(
    (k) => state.actions.includes(k) && state.systems[k]
  );
}

function updateSystems() {
  const busy = state.status !== "playing" || legendVisible;
  // ONE BUTTON PER FITTED WEAPON. "All Weapons" volleying everything at
  // once was never a decision — which gun answers this contact is the
  // decision, so each one is its own control, named for the hardware,
  // showing what it costs. A gun that doesn't bear on the locked contact
  // is dead until it does. With a single weapon fitted there is nothing
  // to choose, so a second tap on the hostile just fires it.
  const locked = targetedEnemyId ? state.enemies.find((e) => e.id === targetedEnemyId && e.alive) : null;
  weaponBtnsEl.innerHTML = "";
  for (const key of armedWeaponKeys()) {
    const weapon = Engine.WEAPONS[key];
    const bears = Boolean(locked) && weaponBears(state, weapon, locked);
    const affordable = state.energy >= weapon.energyCost;
    const btn = document.createElement("button");
    btn.className = "hold-btn weapon-btn";
    btn.dataset.weapon = key;
    btn.title = describeWeapon(weapon);
    btn.textContent = `${weapon.label} · ${weapon.energyCost}⚡`;
    btn.disabled = busy || !bears || !affordable;
    btn.classList.toggle("active", bears && affordable && !busy);
    btn.addEventListener("click", () => {
      const target = targetedEnemyId;
      targetedEnemyId = null;
      reachPreview = null;
      handleAction(() => Engine.applyFire(state, target, key));
    });
    weaponBtnsEl.appendChild(btn);
  }
  rechargeBtn.disabled = busy;
  rechargeBtn.textContent = "Reactor Core";
  enginesBtn.disabled = busy;
  shieldsBtn.hidden = state.maxShields <= 0;
  shieldsBtn.disabled = busy;
  shieldsBtn.textContent = "Shield Generator";
}

// Does this weapon's reach actually cover that contact, at any facing the
// ship can turn to? (Tapping a hostile already turns the nose onto it.)
function weaponBears(state, weapon, enemy) {
  for (let facing = 0; facing < 6; facing++) {
    if (Engine.weaponHexes(state.playerPos, facing, weapon, state).some((h) => Engine.posEq(h, enemy))) return true;
  }
  return false;
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

// A `damage: 0` weapon destroys via collision physics (see
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
  const spread = weapon.targets === "one" ? " · Single target" : " · Hits all in reach";
  return (
    `${weapon.label} — Range ${weapon.range} · ${describeDamage(weapon)} · ` +
    `Pattern: ${describePattern(weapon)}${spread} · Energy ${weapon.energyCost}/shot${speed}`
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


// The inspected card only ever shows in Scan mode (it's a learn-the-board
// aid, same as the legend), and only for as long as whatever's at
// inspectedHex is still there — an enemy that dies, or a Wormhole that
// only exists once you've come from a previous sector, both just clear it.
// Covers everything Scan mode promises you can look at: an enemy, the
// Warp Gate, the Outpost, the Wormhole, or an asteroid field.
function updateScanInfo() {
  if (!legendVisible || !inspectedHex) {
    enemyInfoEl.hidden = true;
    return;
  }
  const enemy = Engine.enemyAt(state, inspectedHex);
  if (enemy) {
    // A contact's card is the FLAGSHIP'S OWN DASHBOARD with the enemy
    // passed through ("reuse both components with enemy prop passed
    // through") — identical gauges, identical wording, nothing bespoke.
    const vm = shipView(enemy);
    enemyInfoEl.hidden = false;
    enemyInfoEl.classList.remove("neutral");
    enemyInfoEl.innerHTML = "";

    const header = document.createElement("div");
    header.className = "enemy-info-header";
    const name = document.createElement("span");
    name.textContent = vm.name;
    header.appendChild(name);
    enemyInfoEl.appendChild(header);

    const dash = document.createElement("div");
    dash.className = "enemy-info-dash";
    renderShipGauges(dash, vm);
    enemyInfoEl.appendChild(dash);

    // Everything beyond the gauges lives one tap deeper, in the same
    // Systems screen your own ship uses ("should show the menu... and
    // allow you to expand Systems for that ship").
    const menu = document.createElement("div");
    menu.className = "enemy-info-menu";
    const sysBtn = document.createElement("button");
    sysBtn.id = "enemySystemsBtn";
    sysBtn.textContent = "SYSTEMS ▸";
    sysBtn.addEventListener("click", () => {
      systemsContext = "contact";
      shipVisible = true;
      mapVisible = false;
      render();
    });
    menu.appendChild(sysBtn);
    enemyInfoEl.appendChild(menu);
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
    stats.textContent = "Reads online. It will take us out of this sector whenever we are ready.";
  } else if (isOutpost) {
    name.textContent = "OUTPOST";
    stats.textContent = "Trading post. They will patch a hull and sell whatever they happen to have.";
  } else if (isWormhole) {
    name.textContent = "WORMHOLE";
    stats.textContent = "Unstable throat. It goes back the way we came — roughly where we came in.";
  } else {
    name.textContent = "ASTEROID FIELD";
    stats.textContent = "Solid rock and dust. Nothing gets through it.";
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
    // A greyed-out row that only says its price reads as "useless" — it
    // should say what it's WAITING on, so the shelf is a target to hunt
    // toward rather than a list of things you can't have.
    const short = Math.max(0, offer.cost - state.salvage);
    btn.textContent = !offer.applicable
      ? `${offer.label} — not needed`
      : short > 0
        ? `${offer.label} — ${offer.cost} salvage (${short} short)`
        : `${offer.label} — ${offer.cost} salvage`;
    btn.disabled = !offer.affordable || !offer.applicable;
    btn.addEventListener("click", () => {
      handleAction(() => Engine.applyOutpostPurchase(state, offer.id));
    });
    outpostOffersEl.appendChild(btn);
  }
}

// ---- One ship, one readout --------------------------------------------
// Your flagship and any contact on the board are the same KIND of object:
// a hull, a reactor, a drive, an armament, and a hold full of shaped
// equipment. shipView() normalizes either one into a single shape, and
// every readout below renders straight from it — so a scanned enemy's
// dashboard and Systems screen ARE your own components with the enemy
// passed through, not a parallel set that can drift.
function shipView(enemy) {
  const hold = enemy ? Engine.ENEMY_TYPES[enemy.type].hold : state.hold;
  const installed = hold.items.map((it) => ({ it, eq: Engine.EQUIPMENT[it.id] }));
  const tiles = installed.map((x, i) => ({
    kind: x.eq.kind, label: x.eq.label, x: x.it.x, y: x.it.y, w: x.eq.w, h: x.eq.h,
    holdIndex: i, itemId: x.it.id,
  }));
  if (!enemy) {
    return {
      name: "FLAGSHIP",
      hull: state.hull, maxHull: state.maxHull,
      energy: state.energy, maxEnergy: state.maxEnergy,
      shields: state.shieldCharges, maxShields: state.maxShields,
      salvage: String(state.salvage),
      holdTitle: Engine.outpostAvailable(state) ? "THE HOLD — docked, free to refit" : "THE HOLD — under way, no refits",
      gridId: "holdGrid",
      cols: hold.cols, rows: hold.rows, blocked: hold.blocked || [],
      tiles,
      cargo: hold.cargo,
      interactive: true,
    };
  }
  return {
    name: enemy.type.toUpperCase(),
    hull: enemy.hp, maxHull: enemy.maxHp,
    energy: enemy.energy, maxEnergy: enemy.maxEnergy,
    shields: 0, maxShields: 0,
    salvage: `+${Engine.ENEMY_TYPES[enemy.type].salvage} on kill`,
    holdTitle: "THEIR HOLD — scanner reconstruction",
    gridId: "enemyHoldGrid",
    cols: hold.cols, rows: hold.rows, blocked: hold.blocked || [],
    tiles,
    cargo: null,
    interactive: false,
  };
}

// The gauge cluster: the same HULL / ENERGY / SHIELDS pips the console
// carries, for whichever ship the view-model describes.
function renderShipGauges(container, vm, pending) {
  const gauge = (label, filled, max, variant, ghost) => {
    const row = document.createElement("span");
    row.className = "stat-wrap";
    const name = document.createElement("span");
    name.className = "stat-label";
    name.textContent = label;
    const barEl = document.createElement("span");
    barEl.className = "stat-bar";
    renderStatBar(barEl, label, filled, max, variant, ghost);
    row.appendChild(name);
    row.appendChild(barEl);
    container.appendChild(row);
  };
  gauge("Hull", vm.hull, vm.maxHull, "hull");
  gauge("Energy", vm.energy, vm.maxEnergy, "energy", pending);
  if (vm.maxShields > 0) gauge("Shields", vm.shields, vm.maxShields, "shield");
  const salv = document.createElement("span");
  salv.className = "stat-wrap";
  const salvLabel = document.createElement("span");
  salvLabel.className = "stat-label";
  salvLabel.textContent = "Salvage";
  const salvValue = document.createElement("span");
  salvValue.className = "stat-value";
  salvValue.textContent = vm.salvage;
  salv.appendChild(salvLabel);
  salv.appendChild(salvValue);
  container.appendChild(salv);
}

// A contact's portrait: its real hull, at rest, nose-up, drawn straight
// through drawEnemyShip — the board's own renderer, pointed at the
// portrait canvas for the duration. Damage shows here too (drawEnemyShip
// cracks the hull by hp fraction), so a half-dead ship looks half-dead.
function renderPortrait(enemy) {
  const boardCtx = ctx;
  const pc = contactPortraitEl.getContext("2d");
  pc.clearRect(0, 0, contactPortraitEl.width, contactPortraitEl.height);
  ctx = pc;
  try {
    ctx.save();
    ctx.translate(contactPortraitEl.width / 2, contactPortraitEl.height / 2);
    ctx.rotate(-Math.PI / 2); // board art is drawn nose-RIGHT; a portrait reads nose-UP
    drawEnemyShip(contactPortraitEl.width * 0.33, enemy.hp / enemy.maxHp, enemy.id, enemy.type);
    ctx.restore();
  } finally {
    ctx = boardCtx;
  }
}

// The full-screen Systems view. Same component for the flagship and for a
// scanned contact — only the view-model changes, plus the drag wiring,
// which a contact's hold obviously never gets (it's a scanner
// reconstruction, not a deck you can walk).
function updateShipOverlay() {
  shipOverlayEl.hidden = !shipVisible;
  shipBtn.classList.toggle("active", shipVisible);
  if (!shipVisible) return;

  // Contextual Systems: while Scan has a contact inspected, this screen is
  // THAT ship's. No contact inspected (or it died) → your flagship.
  // Which ship this screen is about is decided by HOW it was opened: the
  // console's Systems button is always your own ship, the scan card's
  // SYSTEMS button is that contact. (Opening yours while a contact is
  // still inspected used to silently show theirs.)
  const scannedEnemy =
    systemsContext === "contact" && legendVisible && inspectedHex ? Engine.enemyAt(state, inspectedHex) : null;
  const vm = shipView(scannedEnemy);
  shipOverlayEl.querySelector("h2").textContent = scannedEnemy ? `Systems — ${vm.name}` : "Systems";
  // Whichever ship this screen is about, you see the ACTUAL ship: your
  // flagship's portrait art, or the contact's own hull drawn by the very
  // renderer that draws it on the board.
  shipPortraitEl.hidden = Boolean(scannedEnemy);
  contactPortraitEl.hidden = !scannedEnemy;
  if (scannedEnemy) renderPortrait(scannedEnemy);

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
  statRow("Hull", bar(vm.hull, vm.maxHull, "hull", "Hull"));
  statRow("Energy", bar(vm.energy, vm.maxEnergy, "energy", "Energy"));
  if (vm.maxShields > 0) statRow("Shields", bar(vm.shields, vm.maxShields, "shield", "Shields"));
  statRow("Salvage", text(vm.salvage));

  // ---- The Hold: the ship's internals as a GRID of shaped equipment ----
  // ("a grid drag and drop for different sized/shaped items") — every tile
  // is a real installed item; cargo below is aboard-but-inert. Rearranging
  // is drag-and-drop, but ONLY on your own ship, and only while docked at
  // an Outpost; otherwise the grid is a read-only schematic.
  shipHardpointsEl.innerHTML = "";
  const docked = vm.interactive && Engine.outpostAvailable(state);
  const holdTitle = document.createElement("div");
  holdTitle.className = "hold-title";
  holdTitle.textContent = vm.holdTitle;
  shipHardpointsEl.appendChild(holdTitle);

  const CELL = 44;
  const gridEl = document.createElement("div");
  gridEl.className = "hold-grid" + (docked ? " docked" : "") + (vm.interactive ? "" : " enemy-hold");
  gridEl.id = vm.gridId;
  gridEl.style.width = `${vm.cols * CELL}px`;
  gridEl.style.height = `${vm.rows * CELL}px`;
  gridEl.style.backgroundSize = `${CELL}px ${CELL}px`;
  // Void cells outside the hull — the grid IS the ship's silhouette.
  for (const key of vm.blocked) {
    const [bx, by] = key.split(",").map(Number);
    const cell = document.createElement("div");
    cell.className = "hold-cell-void";
    cell.style.left = `${bx * CELL}px`;
    cell.style.top = `${by * CELL}px`;
    cell.style.width = `${CELL}px`;
    cell.style.height = `${CELL}px`;
    gridEl.appendChild(cell);
  }
  for (const t of vm.tiles) {
    const tile = document.createElement("div");
    tile.className = `hold-tile hold-kind-${t.kind}`;
    if (t.itemId) {
      tile.dataset.holdIndex = String(t.holdIndex);
      tile.dataset.itemId = t.itemId;
    }
    tile.style.left = `${t.x * CELL}px`;
    tile.style.top = `${t.y * CELL}px`;
    tile.style.width = `${t.w * CELL - 4}px`;
    tile.style.height = `${t.h * CELL - 4}px`;
    if (t.w === 1) tile.style.fontSize = "0.48rem"; // narrow tiles wrap their label instead of clipping it
    tile.textContent = t.label;
    gridEl.appendChild(tile);
  }
  shipHardpointsEl.appendChild(gridEl);

  const holdInfo = document.createElement("p");
  holdInfo.className = "hold-info";
  holdInfo.id = "holdInfo";
  holdInfo.textContent = vm.interactive
    ? "Tap a system for its readout."
    : "Tap a system for its readout. Kill it and this is what floats free.";
  shipHardpointsEl.appendChild(holdInfo);
  wireHoldInspect(gridEl, holdInfo);

  if (vm.cargo) {
    const cargoEl = document.createElement("div");
    cargoEl.className = "hold-cargo";
    cargoEl.id = "holdCargo";
    const cargoLabel = document.createElement("span");
    cargoLabel.className = "stat-label";
    cargoLabel.textContent = vm.cargo.length ? "CARGO (inert):" : "CARGO: empty";
    cargoEl.appendChild(cargoLabel);
    vm.cargo.forEach((id, i) => {
      const eq = Engine.EQUIPMENT[id];
      const chip = document.createElement("div");
      chip.className = `hold-tile hold-cargo-tile hold-kind-${eq.kind}`;
      chip.dataset.cargoIndex = String(i);
      chip.dataset.itemId = id;
      chip.textContent = `${eq.label} (${eq.w}x${eq.h})`;
      cargoEl.appendChild(chip);
    });
    shipHardpointsEl.appendChild(cargoEl);
    wireHoldDrag(gridEl, cargoEl, CELL, docked);
  }

  if (docked) {
    const note = document.createElement("p");
    note.className = "ship-note";
    note.textContent = "Docked. Shift the load however you like — the yard does not charge for it.";
    shipHardpointsEl.appendChild(note);
  }

  // Scuttling charges. Two taps, because one stray thumb should never end
  // a run — the first arms it and says so, the second means it.
  if (vm.interactive) {
    const scuttle = document.createElement("button");
    scuttle.id = "selfDestructBtn";
    scuttle.className = "self-destruct" + (selfDestructArmed ? " armed" : "");
    scuttle.textContent = selfDestructArmed ? "CONFIRM — SCUTTLE THE SHIP" : "Scuttling Charges";
    scuttle.addEventListener("click", () => {
      if (selfDestructArmed) {
        shipVisible = false;
        scuttleShip();
        return;
      }
      selfDestructArmed = true;
      render();
    });
    shipHardpointsEl.appendChild(scuttle);
    const warn = document.createElement("p");
    warn.className = "ship-note self-destruct-note";
    warn.textContent = selfDestructArmed
      ? "Charges armed. Tap again and we scuttle her — this ship and everything in the hold."
      : "Blow the charges and start over in a fresh hull. Nothing carries over.";
    shipHardpointsEl.appendChild(warn);
  }
}

// Pointer-based drag-and-drop for the Hold. Docked: drag a tile to a new
// cell (green = fits, red = doesn't), drop past the grid's bottom edge to
// stow it; tap a cargo chip to auto-install it. Undocked: taps inspect.
// What an installed item IS, read straight off its own data — the single
// source of every spec the UI ever states about equipment, so a hostile's
// Autocannon reads exactly the same as yours.
function describeItem(id) {
  const eq = Engine.EQUIPMENT[id];
  if (eq.kind === "weapon") return describeWeapon(Engine.WEAPONS[eq.weaponKey]);
  if (eq.kind === "reactor") return `${eq.label} — holds ${eq.energyCapacity}, makes +${eq.rechargeGain} per cycle · ${eq.w}x${eq.h}`;
  if (eq.kind === "battery") return `${eq.label} — holds ${eq.energyCapacity}, generates nothing · ${eq.w}x${eq.h}`;
  if (eq.kind === "engine") return `${eq.label} — ${eq.moveRange} hex per turn · ${eq.w}x${eq.h}`;
  if (eq.kind === "shield") return `${eq.label} — raise-able charge, absorbs a volley · ${eq.w}x${eq.h}`;
  if (eq.kind === "armor") return `${eq.label} — +${eq.hullBonus} Hull, welded on · ${eq.w}x${eq.h}`;
  if (eq.kind === "sensor") return `${eq.label} — powers Scan mode · ${eq.w}x${eq.h}`;
  if (eq.kind === "utility") return `${eq.label} — ${eq.w}x${eq.h}`;
  return eq.label;
}

// Tap any tile, on either ship, and its specs land in the readout under
// the grid ("clicking on item... should info when selected"). Nothing is
// written into the screen up front — the grid IS the information.
function wireHoldInspect(gridEl, infoEl) {
  gridEl.addEventListener("click", (evt) => {
    const tile = evt.target.closest ? evt.target.closest(".hold-tile") : null;
    if (!tile || !tile.dataset.itemId) return;
    for (const other of gridEl.querySelectorAll(".hold-tile")) other.classList.remove("selected");
    tile.classList.add("selected");
    infoEl.textContent = describeItem(tile.dataset.itemId);
  });
}

function wireHoldDrag(gridEl, cargoEl, CELL, docked) {

  for (const chip of cargoEl.querySelectorAll(".hold-cargo-tile")) {
    chip.addEventListener("click", () => {
      const idx = Number(chip.dataset.cargoIndex);
      if (!docked) {
        pushMessage(describeItem(chip.dataset.itemId) + " — in the hold, powered down.");
        render();
        return;
      }
      // Tap-to-install from cargo: auto-place in the first free spot.
      const id = state.hold.cargo[idx];
      for (let y = 0; y < state.hold.rows; y++) {
        for (let x = 0; x < state.hold.cols; x++) {
          if (Engine.holdCanPlace(state.hold, id, x, y)) {
            handleAction(() => Engine.installFromCargo(state, idx, x, y));
            return;
          }
        }
      }
      pushMessage("No clearance for that — shift the load, or buy the space.");
      render();
    });
  }

  for (const tile of gridEl.querySelectorAll(".hold-tile")) {
    const idx = Number(tile.dataset.holdIndex);
    const id = tile.dataset.itemId;
    if (!docked) continue; // undocked: wireHoldInspect already reads the tile out in place
    tile.addEventListener("pointerdown", (downEvt) => {
      downEvt.preventDefault();
      tile.setPointerCapture(downEvt.pointerId);
      const gridRect = gridEl.getBoundingClientRect();
      const eq = Engine.EQUIPMENT[id];
      let moved = false;
      const onMove = (evt) => {
        moved = true;
        const px = evt.clientX - gridRect.left - (eq.w * CELL) / 2;
        const py = evt.clientY - gridRect.top - (eq.h * CELL) / 2;
        tile.style.left = `${px}px`;
        tile.style.top = `${py}px`;
        const cx = Math.round(px / CELL);
        const cy = Math.round(py / CELL);
        tile.classList.toggle("drop-ok", Engine.holdCanPlace(state.hold, id, cx, cy, idx));
        tile.classList.toggle("drop-bad", !Engine.holdCanPlace(state.hold, id, cx, cy, idx));
        tile.classList.add("dragging");
      };
      const onUp = (evt) => {
        tile.removeEventListener("pointermove", onMove);
        tile.removeEventListener("pointerup", onUp);
        if (!moved) {
          pushMessage(describeItem(id) + " — fitted and drawing power.");
          render();
          return;
        }
        const px = evt.clientX - gridRect.left - (eq.w * CELL) / 2;
        const py = evt.clientY - gridRect.top - (eq.h * CELL) / 2;
        const cx = Math.round(px / CELL);
        const cy = Math.round(py / CELL);
        if (py > gridRect.height - CELL / 2 + CELL) {
          // Dropped well below the grid: stow to cargo.
          handleAction(() => Engine.stowToCargo(state, idx));
          return;
        }
        try {
          Engine.moveHoldItem(state, idx, cx, cy);
        } catch (err) {
          pushMessage(err.message);
        }
        render();
      };
      tile.addEventListener("pointermove", onMove);
      tile.addEventListener("pointerup", onUp);
    });
  }
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
      const dir = ex.variantId === "quiet" ? -1 : ex.variantId === "drift" ? 0 : 1;
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
      const dir =
        ahead.length === 1
          ? 0
          : ex.variantId === "quiet"
            ? -1
            : ex.variantId === "aggressive"
              ? 1
              : ex.variantId === "drift"
                ? 0
                : j === 0
                  ? 1
                  : -1;
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
  window.__hhTargetedEnemy = targetedEnemyId;
}

function pushMessage(message) {
  state.log.push(message);
  if (state.log.length > 20) state.log.shift();
}

// The energy a FIRE volley would spend right now — every armed weapon
// with a target in reach bills its listed cost. Shown on the FIRE button
// and in the target-lock readout ("it should show how much energy is
// gonna potentially be used").
// Is THIS specific contact inside any armed weapon's reach right now?
function enemyInReach(s, enemy) {
  return Engine.WEAPON_SYSTEM_KEYS.some((k) => {
    if (!s.actions.includes(k) || !s.systems[k]) return false;
    return Engine.weaponHexes(s.playerPos, s.facing, Engine.WEAPONS[k], s).some((h) => Engine.posEq(h, enemy));
  });
}

// Aiming is automatic now — tapping a hostile swings the flagship to
// whatever facing brings an armed weapon to bear on it (free, no turn
// spent, same rules as the old Target Lock re-aim). Returns whether any
// facing works; already-in-reach targets need no turn at all.
function faceEnemyIfPossible(enemy) {
  if (enemyInReach(state, enemy)) return true;
  for (let f = 0; f < 6; f++) {
    const reaches = Engine.WEAPON_SYSTEM_KEYS.some((k) => {
      if (!state.actions.includes(k) || !state.systems[k]) return false;
      return Engine.weaponHexes(state.playerPos, f, Engine.WEAPONS[k], state).some((h) => Engine.posEq(h, enemy));
    });
    if (reaches) {
      Engine.setFacing(state, f);
      shipAngle = DIR_ANGLES[f]; // spin to show the new aim immediately
      return true;
    }
  }
  return false;
}

// Which fitted guns actually bear on this contact and have the charge to
// fire. One means there's nothing to decide; more than one means the
// player picks, which is the whole point of a weapon per button.
function bearingWeapons(s, enemy) {
  return armedWeaponKeys().filter((k) => {
    const weapon = Engine.WEAPONS[k];
    return weaponBears(s, weapon, enemy) && s.energy >= weapon.energyCost;
  });
}

// What the next shot costs: the one gun that bears, or the cheapest of
// the several that do (which is what an unspecified FIRE would spend).
function nextShotCost(s) {
  const locked = targetedEnemyId ? s.enemies.find((e) => e.id === targetedEnemyId && e.alive) : null;
  if (!locked) return 0;
  const keys = bearingWeapons(s, locked);
  if (!keys.length) return 0;
  return Math.min(...keys.map((k) => Engine.WEAPONS[k].energyCost));
}

// Who actually gets hit if the volley fires right now, honoring the
// target lock: single-target weapons put their shot into the locked
// contact (or their first in reach), multi-hit weapons strike everything
// they cover. Mirrors firePlayerWeapon's real selection exactly.
function predictedVictims(targetId) {
  const victims = new Map();
  for (const k of armedWeaponKeys()) {
    const weapon = Engine.WEAPONS[k];
    const reach = new Set(Engine.weaponHexes(state.playerPos, state.facing, weapon, state).map(Engine.hexKey));
    let ts = Engine.livingEnemies(state).filter((e) => reach.has(Engine.hexKey(e)));
    if (!ts.length) continue;
    if (weapon.targets === "one") {
      const preferred = targetId ? ts.find((t) => t.id === targetId) : null;
      ts = [preferred || ts[0]];
    }
    for (const t of ts) victims.set(t.id, { q: t.q, r: t.r, id: t.id });
  }
  return [...victims.values()];
}

function handleAction(fn) {
  plannedPath = null;
  reachPreview = null;
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
  targetedEnemyId = null;
  reachPreview = null;
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
    // The Hold rework: the ship is its equipment grid. A pre-Hold save
    // has no hold — drop it, start fresh.
    Boolean(s.hold && Array.isArray(s.hold.items) && Array.isArray(s.hold.cargo)) &&
    // The hull/shields rework: shields are generator capacity, not loose
    // charges. A pre-rework save has no maxShields — drop it, start fresh.
    typeof s.maxShields === "number" &&
    // The AP round rework: no ap counter = pre-rework save. Same policy.
    typeof s.ap === "number" &&
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
  // A save from the 2-AP era carries maxAp: 2 inside it and would keep
  // playing (and showing) two actions a round forever — clamp restored
  // saves down to the shipped budget. (No AP upgrades exist to preserve
  // yet; if one ships, its persistence gets designed with it.)
  const clampAp = (s) => {
    s.maxAp = Math.min(s.maxAp, Engine.START_AP);
    s.ap = Math.min(s.ap, s.maxAp);
  };
  // A save from before the Scanner Array existed would fly blind forever —
  // retrofit one into the first free cell (or cargo, worst case).
  // Equipment that no longer exists in the game (the Tractor Beam, cut
  // with the weapon roster) is still sitting in old saved holds — and the
  // Hold renders straight off EQUIPMENT, so a stale id is a ghost tile at
  // best and a crash at worst. Strip anything the registry doesn't know
  // before the rest of the restore touches it.
  const purgeRetiredGear = (s) => {
    const known = (id) => Boolean(Engine.EQUIPMENT[id]);
    const before = s.hold.items.length + s.hold.cargo.length;
    s.hold.items = s.hold.items.filter((it) => known(it.id));
    s.hold.cargo = s.hold.cargo.filter(known);
    if (s.hold.items.length + s.hold.cargo.length !== before) Engine.syncHoldDerived(s);
  };

  const ensureScanner = (s) => {
    if (s.hold.items.some((it) => it.id === "scanner") || s.hold.cargo.includes("scanner")) return;
    for (let y = 0; y < s.hold.rows; y++) {
      for (let x = 0; x < s.hold.cols; x++) {
        if (Engine.holdCanPlace(s.hold, "scanner", x, y)) {
          s.hold.items.push({ id: "scanner", x, y });
          Engine.syncHoldDerived(s);
          return;
        }
      }
    }
    s.hold.cargo.push("scanner");
  };
  clampAp(state);
  purgeRetiredGear(state);
  ensureScanner(state);
  // Same reasoning as isValidSave above, applied per-entry — drop any
  // stale chart snapshot rather than crashing a jump later.
  sectorHistory = GCStorage.get(GAME_ID, "sectorHistory", []).filter((entry) => entry && isValidSave(entry.state));
  sectorHistory.forEach((entry) => {
    clampAp(entry.state);
    purgeRetiredGear(entry.state);
    ensureScanner(entry.state);
  });
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
  targetedEnemyId = null;
  reachPreview = null;
  plannedPath = null;
  autoRoute = null;
  outpostDismissed = false;
  shipAngle = -90;
  updateGeometry();
  render();
}

scanBtn.addEventListener("click", () => {
  if (!legendVisible && !state.scannerInstalled) {
    pushMessage("No scanner array fitted. We are flying blind.");
    render();
    return;
  }
  legendVisible = !legendVisible;
  GCStorage.set(GAME_ID, "legendVisible", legendVisible);
  if (!legendVisible) inspectedHex = null; // closing Scan mode clears whatever was inspected
  render(); // full refresh — every button/toggle's disabled state depends on legendVisible now
});

shipBtn.addEventListener("click", () => {
  systemsContext = "ship";
  shipVisible = !shipVisible;
  mapVisible = false;
  render();
});
shipCloseBtn.addEventListener("click", () => {
  shipVisible = false;
  selfDestructArmed = false; // walking away disarms
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


// Equipment buttons act when they can, and EXPLAIN when they can't —
// tapping a weapon with nothing in reach washes its range over the board
// with a readout line ("if you click the weapon, it would show the range
// for it"), same idea for the engines.
enginesBtn.addEventListener("click", () => {
  targetedEnemyId = null;
  reachPreview = { hexes: new Set(Engine.legalSublightTargets(state).map(Engine.hexKey)), kind: "move" };
  pushMessage("Sublight drive — one grid a burn. Mark a heading, then confirm it.");
  render();
});
rechargeBtn.addEventListener("click", () => {
  reachPreview = null;
  handleAction(() => Engine.applyRecharge(state)); // at capacity, the reactor's own refusal explains itself
});
shieldsBtn.addEventListener("click", () => {
  reachPreview = null;
  handleAction(() => Engine.applyRaiseShields(state));
});


// Tap-tap movement: the FIRST tap on any reachable hex marks the quickest
// route to it (one hex or twenty); tapping the SAME hex again confirms and
// flies it, one real action per step, across as many rounds as it takes.
// Tapping anywhere else dismisses the preview and starts a new one.
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
  // The route preview needs its "now confirm it" instruction — it goes on
  // the readout strip like every other message.
  if (plannedPath) pushMessage("Course laid in. Confirm to burn.");
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
    if (hurt && !arrived && state.status === "playing") pushMessage("Course aborted — we are taking fire.");
    autoRoute = null;
    render();
    return;
  }
  // Recompute each step: enemies move between turns and can block the way.
  const path = Engine.findPath(state, state.playerPos, autoRoute.target);
  if (!path || path.length < 2) {
    autoRoute = null;
    pushMessage("No clear lane.");
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

  reachPreview = null; // any board tap moves on from an equipment preview
  const enemy = Engine.enemyAt(state, hex);

  // Tap-tap firing: the first tap on a hostile swings the flagship to
  // bring its weapons to bear (aiming is free and automatic — no separate
  // Target Lock mode) and TARGETS it; the second tap fires the volley.
  if (enemy) {
    plannedPath = null;
    if (targetedEnemyId === enemy.id && enemyInReach(state, enemy)) {
      // Second tap. One gun bears → fire it, no ceremony. Several bear →
      // the choice IS the move, so the console's weapon buttons stay lit
      // and the tap doesn't pick for you.
      const bearing = bearingWeapons(state, enemy);
      if (bearing.length === 1) {
        const lockedTarget = targetedEnemyId;
        targetedEnemyId = null;
        handleAction(() => Engine.applyFire(state, lockedTarget, bearing[0]));
        return;
      }
      if (bearing.length > 1) {
        pushMessage(
          `${bearing.map((k) => Engine.WEAPONS[k].label).join(" or ")} — gunnery's waiting on you.`
        );
        render();
        return;
      }
    }
    if (faceEnemyIfPossible(enemy)) {
      targetedEnemyId = enemy.id;
      // Show exactly where the volley lands ("should show where it'll
      // hit"): red wash = weapon coverage, crosshairs (drawn in draw())
      // = the contacts that actually take the hit.
      const coverage = new Set();
      for (const k of armedWeaponKeys()) {
        for (const h of Engine.weaponHexes(state.playerPos, state.facing, Engine.WEAPONS[k], state)) {
          if (Engine.onBoard(state, h)) coverage.add(Engine.hexKey(h));
        }
      }
      reachPreview = { hexes: coverage, kind: "attack" };
      const bearing = bearingWeapons(state, enemy);
      pushMessage(
        bearing.length === 1
          ? `Firing solution on ${enemy.type.toUpperCase()} — ${Engine.WEAPONS[bearing[0]].label} ready, ${Engine.WEAPONS[bearing[0]].energyCost} charge.`
          : bearing.length > 1
            ? `Firing solution on ${enemy.type.toUpperCase()} — ${bearing.map((k) => Engine.WEAPONS[k].label).join(" or ")}?`
            : `${enemy.type.toUpperCase()} marked. Nothing aboard bears on it yet.`
      );
    } else {
      targetedEnemyId = null;
      // Out of reach — say what to do instead of dying silently.
      pushMessage("Hostile out of arc. Bring us into range first.");
    }
    render();
    return;
  }

  // Any non-enemy tap stands the gunnery target down.
  targetedEnemyId = null;
  const hazardHere = Engine.hazardAt(state, hex);
  if (hazardHere && hazardHere.type === "asteroid") {
      pushMessage("Rock. Nothing gets through that — go around.");
    render();
    return;
  }

  planOrFlyRoute(hex);
});

modeButtons.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));

function scuttleShip() {
  sectorHistory = [];
  chartIndex = -1;
  selfDestructArmed = false;
  loadSector(0);
}

restartBtn.addEventListener("click", scuttleShip);

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
window.__hhLooks = { SKIES, GRID_LOOKS }; // test hook: every place has its own sky and its own lattice
// debug/test hook: sync the internal levelIndex counter after directly
// mutating window.__hhState (see browser.test.js's boss-milestone test) —
// levelIndex normally only ever changes via loadSector, which keeps it and
// state.levelId in lockstep; a synthetic state injection has to update
// both explicitly or advanceSector's "levelIndex + 1" drifts from reality.
window.__hhSetLevelIndex = (i) => {
  levelIndex = i;
};

restoreRun();
