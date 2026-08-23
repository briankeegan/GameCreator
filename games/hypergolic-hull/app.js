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
const overlayRequisitionEl = document.getElementById("runOverlayRequisition");
const loadoutPickerEl = document.getElementById("loadoutPicker");
const loadoutDetailEl = document.getElementById("loadoutDetail");
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
const outpostRefitBtn = document.getElementById("outpostRefitBtn");
const outpostDetailEl = document.getElementById("outpostDetail");
const shipOverlayEl = document.getElementById("shipOverlay");
const shipPortraitEl = document.getElementById("shipPortrait");
const scuttleFxEl = document.getElementById("scuttleFx");
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
// The one deliberate use of real (non-seeded) randomness in this game: a
// fresh whole-run seed, rolled once when a genuinely NEW run starts (see
// loadSector(0) callers and scuttleShip below) and then carried sector to
// sector via carryOver.runSeed for the rest of that run. Everything that
// USES it (which Outpost berth, which shop stock) stays a deterministic
// seededRandom() inside engine.js — this is the only spot that has to
// touch Math.random() at all, and it does so once per run, not per turn,
// keeping every combat rule exactly as deterministic as it always was.
function freshRunSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
// Requisition: a SECOND currency, wholly separate from in-run salvage
// (never spendable mid-run, so the tuned "save up for weapons" economy
// stays untouched) — earned once per run, when the run actually ends, and
// spent between runs unlocking alternate starting loadouts (see
// Engine.STARTING_LOADOUTS). The point: even a loss banks something, and
// that something is a real choice next time, not just a bigger number —
// mirrors games/trebor's existing achievement→unlock pattern, the only
// precedent for cross-run progression in this repo.
let requisition = GCStorage.get(GAME_ID, "requisition", 0);
let unlockedLoadouts = new Set(GCStorage.get(GAME_ID, "unlockedLoadouts", ["standard"]));
let selectedLoadout = GCStorage.get(GAME_ID, "selectedLoadout", "standard");
// Guards the award below against firing again on every repeated render of
// the same death/victory frame — reset in loadSector, same lifecycle as
// outpostDismissed/shipAngle just below it.
let requisitionAwardedThisEnding = false;
let requisitionEarnedThisEnding = 0;

function persistUnlocks() {
  GCStorage.set(GAME_ID, "requisition", requisition);
  GCStorage.set(GAME_ID, "unlockedLoadouts", Array.from(unlockedLoadouts));
  GCStorage.set(GAME_ID, "selectedLoadout", selectedLoadout);
}

// How much a run banks, once — legible on the overlay ("you got to depth
// 7, that's 3"). Depth past the campaign is the whole signal: it's the
// same thing bestDepth already tracks, just turned into something spendable
// instead of only a number on a screen. A boss clear is a real milestone
// on top of that, same as isVictory gets its own distinct overlay.
function requisitionEarnedFor(finishedState) {
  return Math.max(0, finishedState.levelId - 4) + (finishedState.isVictory ? 15 : 0);
}

let state = Engine.createGameState(levelForIndex(levelIndex), {
  runSeed: freshRunSeed(),
  startingLoadout: selectedLoadout,
});
// null means no mode armed — plain moves/route-preview work regardless.
let mode = null;
let bestDepth = GCStorage.get(GAME_ID, "bestDepth", 1);

// Tap a far-away hex once to preview the quickest route, tap it again to fly
// it. plannedPath holds the preview; autoRoute drives the step-by-step flight
// (each step is a real turn — it aborts the moment the flagship takes damage).
let plannedPath = null;
let autoRoute = null;

// Drop the current course AND any timer it has in flight. Nulling the
// route alone left the pending setTimeout alive, so it re-entered and
// drove whatever course came next as a second chain.
function cancelRoute() {
  if (autoRoute && autoRoute.timer) clearTimeout(autoRoute.timer);
  autoRoute = null;
}

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
//
// SESSION-ONLY, deliberately. It used to be a remembered preference, which
// meant leaving Scan on and closing the tab came back to a ship that could
// not move, could not fire, and said nothing about why — the helm held,
// every button greyed, the readout frozen on whatever it last said, and
// the only tell a CSS class on one button. That is an indefinite input
// lock stored on disk. A mode that takes the controls away starts off.
let legendVisible = false;

// The full-screen Systems view ("a mode that goes full screen and shows
// ship and allows you to modify") — session-only, always starts closed.
let shipVisible = false;
// "ship" (your flagship) or "contact" (the scanned enemy) — set by whichever
// button opened the Systems screen, never inferred.
let systemsContext = "ship";
// Self-destruct is a two-step: the first tap arms it, the second means it.
let selfDestructArmed = false;
// True for the whole blast animation, not just until the click handler
// returns — updateSystems() rebuilds #selfDestructBtn from scratch on
// every render, and selfDestructArmed alone stays true until playScuttle()
// resolves, so a render mid-animation (any other cause, not just this
// button) would otherwise hand back a fresh, enabled CONFIRM button and
// let a second tap queue a second blast concurrently.
let scuttling = false;
// Set when the current "lost" overlay was reached by scuttling rather than
// dying, so it can read "Charges Blown" instead of "Flagship Destroyed" —
// same overlay, same loadout picker, different framing.
let voluntaryScuttle = false;
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

// Rounds flown across the WHOLE run, not per sector. Sector turnCounts
// reset; this doesn't, so it stays a stable nonce for the per-return drift
// roll (see Engine.reenterSector) — two visits to the same sector don't
// deal the same wander.
let voyageTurns = 0;
// A contact that was on you when you left, riding along to the next
// sector. At most one per transit — a leash, or a long run turns into a
// conga line you cannot outrun.
let pendingArrivals = [];

// The flagship spawns standing directly ON the wormhole when arriving via
// portal ("you start as if you're on top of that wormhole, not next to
// it" — Clubhouse feedback), and a wormhole return lands it standing on
// the previous sector's Warp Gate. Both hexes are live triggers, so
// arriving has to suppress them until the ship has actually LEFT.
//
// This used to be a one-shot boolean consumed by the first handleAction
// call. That was wrong in three ways at once, and together they are the
// "it keeps taking us back" report: a second action taken while still
// parked on the hex (Recharge, Raise Shields, firing) bounced you out; a
// failed action that never took a turn burned the flag just the same; and
// the win branch had no guard at all, so you'd land on a gate, get yanked
// forward again on your next action, and — because advanceSector truncates
// the chart — arrive in a freshly REGENERATED sector with your kills undone.
//
// It's positional now: the hex you arrived on is inert until you're
// somewhere else. That's the rule the player already believes.
let arrivedOn = null;

// Whether the flagship is still sitting on the hex it arrived on, and so
// whether gate/wormhole triggers are still suppressed. Leaving that hex
// LATCHES the suppression off for good — flying back onto the wormhole
// later is a deliberate return trip and has to work.
function stillOnArrivalHex() {
  if (!arrivedOn) return false;
  if (!Engine.posEq(state.playerPos, arrivedOn)) {
    arrivedOn = null;
    return false;
  }
  return true;
}

// Called on every load/jump: remember where we came in.
function markArrival() {
  arrivedOn = { q: state.playerPos.q, r: state.playerPos.r };
}

// Mirrors the live sector back into its chart slot — called before any
// jump/advance so the chart always holds each sector exactly as last left.
// Called the instant before the live sector is swapped away. Hands back
// the one contact, if any, that was close enough to come with us —
// removed from the sector it is leaving, so it is the SAME ship carrying
// the SAME damage, not a copy.
function departLiveSector() {
  const candidates = Engine.enemiesThatCanFollow(state);
  if (!candidates.length) return [];
  const chosen = candidates[0];
  state.enemies = state.enemies.filter((e) => e !== chosen);
  return [chosen];
}

function snapshotLive() {
  if (chartIndex >= 0 && sectorHistory[chartIndex]) {
    sectorHistory[chartIndex] = {
      levelIndex,
      // Which gate led HERE — advanceSector matches on it so re-entering
      // by the same gate restores this sector instead of regenerating it.
      variantId: sectorHistory[chartIndex].variantId,
      state: JSON.parse(JSON.stringify(state)),
    };
  }
}

function advanceSector() {
  const arrivals = departLiveSector();
  snapshotLive();
  // Going forward through a gate you have ALREADY been through returns you
  // to that charted sector, exactly as you left it. It used to truncate
  // the chart and generate a brand-new sector every time, which meant a
  // trip back through a wormhole and forward again silently resurrected
  // every enemy you'd killed and undid the salvage you'd taken.
  const ahead = sectorHistory[chartIndex + 1];
  if (ahead && ahead.levelIndex === levelIndex + 1 && ahead.variantId === (state.usedExitVariant || null)) {
    jumpToChart(chartIndex + 1, { arrivals });
    return;
  }
  pendingArrivals = arrivals;
  // Advancing through a DIFFERENT gate than last time abandons the old
  // forward chain — you chose a gate, that's the route now.
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
      // Whole run shares one seed — carried forward, never rerolled
      // mid-run, so the "luck" a run got is that run's, start to finish.
      runSeed: state.runSeed,
      // The rare-item bad-luck counter (see RARE_PITY_VISITS) tracks
      // across the whole run too — a dry streak follows you sector to
      // sector, same as the seed it's derived from.
      raresSkipped: state.raresSkipped,
      outpostStockIds: state.outpostStockIds,
      // The Hold carries whole — the ship IS its equipment grid.
      hold: state.hold,
      // Which loadout's art the ship shows — carried whole, same reason as
      // runSeed/raresSkipped above (see the field's own comment in
      // engine.js's createGameState).
      startingLoadout: state.startingLoadout,
    },
    { keepWarpAnim: true, variantId: state.usedExitVariant }
  );
}

// Jump to ANY charted sector — the wormhole calls this with the previous
// index, the Map calls it with whatever star you tapped.
// opts.arrivals — contacts the CALLER already pulled out of the live
// sector (advanceSector does this before deciding which way it is going).
// Without it this would depart twice and recruit a second follower.
function jumpToChart(index, opts) {
  if (index === chartIndex || index < 0 || index >= sectorHistory.length) return;
  const arrivals = (opts && opts.arrivals) || departLiveSector();
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
  // Time passed while we were elsewhere. Emplacements are exactly where we
  // left them (no engine — the same rule that makes them emplacements);
  // anything with a drive has been flying, and every reactor out there has
  // been refilling, the same way ours does between sectors. Damage stays.
  Engine.reenterSector(state, { arrivals, nonce: voyageTurns });
  // A snapshot may be mid-"won" (captured standing on the Warp Gate).
  // Un-consume that so the board is live again — winning re-triggers
  // normally on the next action taken on the gate.
  if (state.status === "won") state.status = "playing";
  markArrival(); // standing on the wormhole/gate doesn't re-trigger until we leave it
  mode = null;
  anims = keptAnims;
  announceSector();
  targetedEnemyId = null;
  reachPreview = null;
  plannedPath = null;
  cancelRoute();
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
// Which offer is being read right now. Buying is a second, separate tap
// (see updateOutpost) — the shelf inspects, the button spends.
let selectedOfferId = null;

// The flagship's facing, in degrees (canvas convention: 0 = screen-right,
// increases clockwise). Updated whenever the ship actually moves.
const DIR_ANGLES = Engine.DIRECTIONS.map((d) => {
  const dx = 1.5 * d.q;
  const dy = SQRT3 * HEX_RATIO * (d.r + d.q / 2);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
});
let shipAngle = -90; // start facing "up", toward the gate; the custom ship shape is drawn nose-right at angle 0

// The drawn nose is a VIEW of state.facing, never its own truth. Anything
// that changes facing calls this; nothing else moves the sprite.
function syncShipAngle() {
  if (state && typeof state.facing === "number" && DIR_ANGLES[state.facing] !== undefined) {
    shipAngle = DIR_ANGLES[state.facing];
  }
}

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
  // The board is fitted to the space available, FULL STOP. A locale's
  // "zoom" used to multiply this, which made the canvas element bigger
  // than the box it lives in; `max-width:100%` then squashed it back
  // horizontally ONLY, so the canvas ended up laid out at 0.898 across and
  // 1.0 down. Two things went wrong with that. The board was visibly
  // squashed, and — much worse — the tap handler converts screen pixels to
  // hexes with a single scale factor, so vertical taps landed up to a
  // whole hex off and taps near the bottom edge (where the flagship
  // normally sits) fell off the board entirely and did nothing at all.
  // That is the "I can't move or attack" report, and it only ever
  // happened on the five locales with a zoom above 1.
  //
  // Wanting a place to feel closer is a fine instinct; it belongs to the
  // ART, not the playfield. drawSectorBackdrop applies locale.zoom to the
  // sky. The grid always fits.
  const sx = Math.min(sxFromWidth, sxFromHeight);
  // The canvas takes the WHOLE area it's given and the board floats in the
  // middle of it — the sky is the place, not a texture inside the grid's
  // outline. Everything around the hexes is still this sector: its planet,
  // its dust banks, its wrecks.
  const boardW = (maxX - minX + 2) * sx;
  const boardH = (maxY - minY + SQRT3 * HEX_RATIO) * sx;
  // Never bigger than the box: an oversized canvas gets scaled by the
  // browser, and every screen-to-hex conversion in the game assumes one
  // canvas pixel is one CSS pixel.
  const cssW = Math.round(Math.min(Math.max(boardW + 2 * pad, Math.min(availW, 520)), availW));
  const cssH = Math.round(Math.min(Math.max(boardH + 2 * pad, availH), availH));
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
  mortar: { kind: "ring", color: "#ffe28a" },
  flankTubes: { kind: "bolt", color: "#8ad6ff" },
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
    }
    else if (ev.type === "hit") {
      // NOTE: landing a shot used to swing the sprite round to point at
      // whatever it hit. It looked good and it was a lie — `state.facing`
      // never moved, so from the next round on the nose pointed one way
      // while every arc weapon fired somewhere else, and the reach preview
      // (which reads facing, correctly) lit hexes that had nothing to do
      // with where the ship appeared to be aimed. The ship now turns only
      // when it actually turns: applySublight on a move, and setFacing when
      // faceEnemyIfPossible has to re-aim to bring a gun to bear. Both of
      // those go through syncShipAngle below.
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
      else syncShipAngle();
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
// One look per starting loadout (see Engine.STARTING_LOADOUTS) — "different
// looking ships" for the choice made at the start of the run. Fixed for the
// whole run, not read off live equipment: a look that changed the instant
// you bolted on a second gun or a screen ("when you change equipment...
// your ship looks totally different") read as the wrong ship, not an
// upgrade — you pick your ship at the start and fly THAT one, cosmetically,
// no matter what ends up in the Hold along the way.
const flagshipEscortImg = new Image();
flagshipEscortImg.src = "icons/flagship-escort.png";
flagshipEscortImg.onload = () => draw();
const flagshipArmoredImg = new Image();
flagshipArmoredImg.src = "icons/flagship-armored.png";
flagshipArmoredImg.onload = () => draw();
const LOADOUT_SPRITES = { standard: flagshipImg, escort: flagshipEscortImg, salvager: flagshipArmoredImg };
// Shared by the live HUD (the ship actually being flown) and the
// death-overlay's loadout preview (a hypothetical one) — same lookup
// either way, keyed purely on which loadout, never on current stats.
function spriteForLoadout(loadoutId) {
  return LOADOUT_SPRITES[loadoutId] || flagshipImg;
}
function flagshipSprite() {
  return spriteForLoadout(state.startingLoadout);
}
const interceptorImg = new Image();
interceptorImg.src = "icons/interceptor.png";
interceptorImg.onload = () => draw();

// One sprite per hostile class. This used to be an if-chain with three
// branches and a fallback, which meant every class added after those three
// silently inherited the Interceptor's hull — the Mortar Platform and the
// Lancer were both rendering as Interceptors, byte for byte, while
// finished art for them sat unreferenced in icons/. A lookup can't drift
// like that: a class either has a sprite here or it visibly has none.
const ENEMY_SPRITES = {};
for (const [type, file] of Object.entries({
  interceptor: "icons/interceptor.png",
  cruiser: "icons/enemy-cruiser.png",
  sentry: "icons/enemy-sentry.png",
  picket: "icons/enemy-picket.png",
  demolitionist: "icons/enemy-demolitionist.png",
  cutter: "icons/enemy-cutter.png",
  bombard: "icons/enemy-bomber.png", // four lit thrusters and swept wings — it flies
  lancer: "icons/enemy-minelayer.png", // pods held out wide, like the Tubes fire
  railgun: "icons/enemy-railgun.png",
  escort: "icons/enemy-escort.png", // the hull that visibly has a bubble around it
  carrier: "icons/enemy-carrier.png",
  salvager: "icons/enemy-tug.png", // grapples and a tractor lens, no gun anywhere on it
  bulwark: "icons/enemy-bulwark.png",
})) {
  const img = new Image();
  img.src = file;
  img.onload = () => draw();
  ENEMY_SPRITES[type] = img;
}

function drawShipImage(img, s) {
  if (!img || !img.complete || !img.naturalWidth) return false; // a class with no sprite falls through to the shapes below
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
  if (!drawShipImage(flagshipSprite(), size) && !drawShipImage(flagshipImg, size)) {
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

// How big a class draws relative to a standard hull. A boss that arrives
// at exactly the size of the Interceptor you killed at depth 1 does not
// read as the thing the sector is named after.
const SHIP_SCALE = { bulwark: 1.45, carrier: 1.18, salvager: 1.12, picket: 0.95, demolitionist: 1.1, cutter: 0.95 };

// A gun's charge, on the gun. The danger overlay already goes dark while
// a weapon is discharged, but that only says "not this round" — it never
// said HOW LONG. A Cruiser reloads over three rounds and a Railgun over
// four, and those are the windows the whole fight is played inside, so
// they belong on the board rather than in the player's memory.
//
// Filled pips are charge in hand; hollow ones are what it still needs
// before its cheapest gun fires. Nothing is drawn once it's ready and
// showing — at that point the red wash under it is the message.
function drawChargePips(center, enemy) {
  const ship = Engine.ENEMY_TYPES[enemy.type] && Engine.ENEMY_TYPES[enemy.type].ship;
  if (!ship || !ship.weapons.length) return;
  const cheapest = Math.min(...ship.weapons.map((w) => w.energyCost));
  if (cheapest <= 1 || enemy.energy >= cheapest) return; // nothing to count down
  const w = geom.sx * 0.13;
  const gap = w * 0.5;
  const total = cheapest * w + (cheapest - 1) * gap;
  const y = center.y + geom.sx * 0.52;
  ctx.save();
  for (let i = 0; i < cheapest; i++) {
    const x = center.x - total / 2 + i * (w + gap);
    ctx.beginPath();
    ctx.rect(x, y, w, w * 0.62);
    if (i < enemy.energy) {
      ctx.fillStyle = "rgba(255,196,110,0.92)";
      ctx.fill();
    } else {
      ctx.strokeStyle = "rgba(255,196,110,0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Ordnance in flight. It has to read as a THING on a hex — something you
// can count the distance to and walk away from — rather than as an effect,
// because the whole decision it poses is spatial: outrun it, put a rock in
// its way, or steer it into somebody else. Nose points where it's going.
// A charge on the ground, and the hexes it is going to take with it. This
// is the most literal danger the game has — a number counting down on a
// patch of board — so it is drawn as exactly that: the blast shaded and
// outlined so you can see its edge, and the fuse printed on the charge
// itself. Anything less and a bomb is an ambush rather than a decision.
function drawCharge(charge, now) {
  const pulse = 0.5 + 0.5 * Math.sin(now / (charge.fuse <= 1 ? 90 : 190));
  const blast = Engine.chargeBlastHexes(state, charge);
  ctx.save();
  for (const hex of blast) {
    const c = hexToPixel(hex);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      const x = c.x + geom.sx * Math.cos(a);
      const y = c.y + geom.sx * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(255,110,50,${(charge.fuse <= 1 ? 0.2 : 0.12) + 0.09 * pulse})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,150,70,${0.35 + 0.3 * pulse})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  const centre = hexToPixel(charge);
  const s = geom.sx * 0.32;
  ctx.translate(centre.x, centre.y);
  ctx.fillStyle = `rgba(30,16,10,0.92)`;
  ctx.beginPath();
  ctx.arc(0, 0, s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(255,170,80,${0.7 + 0.3 * pulse})`;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.fillStyle = "#ffd9a6";
  ctx.font = `700 ${Math.round(s * 1.25)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(charge.fuse), 0, 1);
  ctx.restore();
}

function drawMissile(center, missile, now) {
  const s = geom.sx * 0.3;
  const target = missile.ownerId ? state.playerPos : nearestLivingEnemy(missile);
  const ang = target ? (angleToward(missile, target) * Math.PI) / 180 : 0;
  const pulse = 0.55 + 0.45 * Math.sin(now / 110);
  ctx.save();
  ctx.translate(center.x, center.y);
  // A warning halo so it never hides under the grid.
  const halo = ctx.createRadialGradient(0, 0, s * 0.2, 0, 0, s * 2.1);
  halo.addColorStop(0, `rgba(255,150,60,${0.34 * pulse})`);
  halo.addColorStop(1, "rgba(255,120,40,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, s * 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(ang);
  // Exhaust, then the body: a stubby dart, unmistakably not a ship.
  ctx.fillStyle = `rgba(255,196,90,${0.5 + 0.4 * pulse})`;
  ctx.beginPath();
  ctx.moveTo(-s * 0.9, 0);
  ctx.lineTo(-s * 2.0 - s * pulse, -s * 0.28);
  ctx.lineTo(-s * 2.0 - s * pulse, s * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#e8ecf5";
  ctx.beginPath();
  ctx.moveTo(s * 1.15, 0);
  ctx.lineTo(-s * 0.55, -s * 0.42);
  ctx.lineTo(-s * 0.9, 0);
  ctx.lineTo(-s * 0.55, s * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#c0392b";
  ctx.beginPath();
  ctx.arc(s * 0.45, 0, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function nearestLivingEnemy(from) {
  return Engine.livingEnemies(state).reduce(
    (best, e) => (!best || Engine.hexDistance(from, e) < Engine.hexDistance(from, best) ? e : best),
    null
  );
}

function drawEnemyShip(size, hpFrac, crackSeed, type, shielded) {
  size *= SHIP_SCALE[type] || 1;
  ctx.save();
  // High-contrast hostile halo, color-coded per enemy class so each one reads
  // at a glance even before you clock its silhouette: the enemy hulls are
  // deliberately dark and vanished against the dark board otherwise.
  const HALO = {
    interceptor: ["rgba(255,110,70,0.55)", "rgba(255,60,45,0.28)", "rgba(255,50,40,0)"],
    cruiser: ["rgba(255,170,60,0.55)", "rgba(240,120,30,0.30)", "rgba(240,110,30,0)"],
    sentry: ["rgba(70,240,150,0.50)", "rgba(40,200,120,0.26)", "rgba(30,190,110,0)"],
    // The Picket carries the Scout's gun, so it carries a cooler cousin of
    // the Scout's sand — related at a glance, not mistakable for it.
    picket: ["rgba(210,215,175,0.50)", "rgba(160,175,120,0.26)", "rgba(150,165,110,0)"],
    // Fuse-orange, the same colour its charges burn — the only class whose
    // glow is a warning about the ground rather than about the ship.
    demolitionist: ["rgba(255,150,60,0.55)", "rgba(225,105,30,0.29)", "rgba(210,90,25,0)"],
    // Cold white-green: the one beam that reaches you at contact.
    cutter: ["rgba(190,255,210,0.52)", "rgba(110,215,160,0.27)", "rgba(90,200,145,0)"],
    // Every class needs its own, or it silently borrows the Interceptor's
    // red and two different threats look like the same threat.
    bombard: ["rgba(235,220,110,0.52)", "rgba(200,180,60,0.27)", "rgba(190,170,50,0)"],
    lancer: ["rgba(205,120,255,0.52)", "rgba(160,70,220,0.27)", "rgba(150,60,210,0)"],
    railgun: ["rgba(90,170,255,0.50)", "rgba(50,120,220,0.26)", "rgba(40,100,200,0)"],
    // The second wave. Each one is keyed to the hull's own paint so the
    // glow and the ship read as one object: the Scout's sand, the
    // Escort's shield blue, the Carrier's violet, the Salvager's brass
    // (the only friendly-looking glow out there, on the only thing that
    // can't shoot you), and the Bulwark's furnace red.
    escort: ["rgba(130,205,255,0.55)", "rgba(70,150,230,0.28)", "rgba(60,130,215,0)"],
    carrier: ["rgba(190,120,240,0.55)", "rgba(140,60,200,0.30)", "rgba(125,50,185,0)"],
    salvager: ["rgba(120,235,205,0.50)", "rgba(210,170,60,0.26)", "rgba(200,160,50,0)"],
    bulwark: ["rgba(255,90,60,0.62)", "rgba(200,35,25,0.34)", "rgba(180,25,20,0)"],
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
  // The sprite is the ship. The hand-drawn shapes below are only what you
  // get in the moment before its PNG has finished loading.
  if (!drawShipImage(ENEMY_SPRITES[type], size)) {
    if (type === "cruiser") drawCruiser(size * 1.12);
    else if (type === "sentry" || type === "picket") drawSentry(size * 1.05);
    else if (type === "railgun") drawRailgun(size * 1.1);
    else if (!drawShipImage(interceptorImg, size)) drawEnemyFighter(size, 0);
  }
  drawCracks(size, hpFrac, crackSeed);
  // A raised hostile screen is drawn, because it changes what your next
  // shot does: this contact eats one full hit before its hull is touched.
  // Same information your own SHIELDS pip carries, in the place you're
  // actually looking.
  if (shielded) {
    ctx.save();
    ctx.setLineDash([size * 0.22, size * 0.16]);
    ctx.strokeStyle = "rgba(150,215,255,0.85)";
    ctx.lineWidth = Math.max(1.4, size * 0.09);
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.02, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
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
// THE colour rule, in one function: a place has a hue, and everything
// that refers to that place wears it — the sky when you arrive, the grid
// you fly over, the gate that leads there, and the line to it on the
// chart. Nothing gets its own private palette. (The chart used to colour
// routes by which GATE you took — warm/cool/green — while the board
// coloured the same gates by where they GO, so the two screens disagreed
// about what a colour meant. They don't now.)
function localeRgbAhead(levelId, variantId) {
  const ahead = levelId && window.HypergolicLevels && window.HypergolicLevels.localeAhead
    ? window.HypergolicLevels.localeAhead(levelId, variantId)
    : null;
  if (!ahead || !ahead.hue) return null;
  return { id: ahead.id, rgb: hslToRgb(ahead.hue, Math.min(85, ahead.sat + 30), 62) };
}

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
    // Rock that reads on a black sky. The old #4a3d38 body outlined in a
    // darker #241c19 was a dark shape edged in a darker shape — fine on
    // paper, invisible in the Deep.
    ctx.fillStyle = "#6d5a4f";
    ctx.fill();
    ctx.strokeStyle = "#201916";
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.stroke();
    // A small rim highlight on the upper-left, like sunlit rock.
    ctx.strokeStyle = "rgba(255,214,170,0.6)";
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
const outpostImg = new Image();
outpostImg.src = "icons/outpost.png";
outpostImg.onload = () => draw();

// Rare Discoveries: a derelict wreck, a silent outpost, an uncharted body
// — one mechanic (see Engine's pickDiscovery), three generated sprites
// picked by state.discoveryFlavor, each with its own look but the same
// cyan "sensor contact" halo and beacon so it reads as one kind of thing
// regardless of which flavor it rolled.
const discoveryImgs = {
  derelict: new Image(),
  outpost: new Image(),
  wreckage: new Image(),
};
discoveryImgs.derelict.src = "icons/discovery-derelict.png";
discoveryImgs.outpost.src = "icons/discovery-outpost.png";
discoveryImgs.wreckage.src = "icons/discovery-wreckage.png";
Object.values(discoveryImgs).forEach((img) => {
  img.onload = () => draw();
});

function drawDiscovery(center, r, now, flavor, seedKey) {
  ctx.save();
  ctx.translate(center.x, center.y);
  // A cool cyan halo — "sensor contact, worth a look" — same construction
  // as the Outpost's rare-stock halo and the enemy classes' per-type
  // glow, its own hue so it never reads as either of those.
  const halo = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.25);
  halo.addColorStop(0, "rgba(110,230,225,0.45)");
  halo.addColorStop(0.55, "rgba(70,190,190,0.22)");
  halo.addColorStop(1, "rgba(60,170,175,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.25, 0, Math.PI * 2);
  ctx.fill();

  const img = discoveryImgs[flavor] || discoveryImgs.wreckage;
  if (!drawShipImage(img, r * 0.98)) {
    // Vector fallback for the moment before that flavor's sprite loads: a
    // small cluster of jagged debris shards, same seeded-shape technique
    // drawAsteroidField uses, so it never reads as an empty hex.
    const rng = seededRandom(`discovery-${seedKey}`);
    ctx.fillStyle = "#5a6270";
    ctx.strokeStyle = "#8fa2c2";
    ctx.lineWidth = Math.max(1, r * 0.05);
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + rng() * 0.6;
      const dist = r * (0.15 + rng() * 0.2);
      const sz = r * (0.16 + rng() * 0.14);
      ctx.save();
      ctx.translate(Math.cos(ang) * dist, Math.sin(ang) * dist);
      ctx.rotate(rng() * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(-sz, -sz * 0.6);
      ctx.lineTo(sz, -sz * 0.3);
      ctx.lineTo(sz * 0.6, sz);
      ctx.lineTo(-sz * 0.7, sz * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
  // A slow pulsing cyan core, same beacon technique as the Outpost's, a
  // different hue so the two are never mistaken for the same kind of
  // place at a glance.
  const t = (now || 0) / 1000;
  const pulse = 0.6 + 0.4 * Math.sin(t * 2.4);
  const beacon = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.26 * pulse);
  beacon.addColorStop(0, "rgba(180,255,250,0.9)");
  beacon.addColorStop(1, "rgba(90,220,215,0)");
  ctx.fillStyle = beacon;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.26 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Whether THIS visit's shelf has a rare-tier item on it (Mortar/Flank
// Tubes/Railgun — see Engine.OUTPOST_OFFER_POOL) — the beacon reads it, so
// a station worth detouring for looks different from a routine one before
// you're even docked. Nothing in the UI states what the color means (same
// treatment as the gate tints — "maybe color coordinated, but maybe not
// tell people"); fly a few and you learn to read it.
function outpostHasRareStock(state) {
  return (state.outpostOfferIds || []).some((id) => {
    const offer = Engine.OUTPOST_OFFER_POOL.find((o) => o.id === id);
    return offer && offer.rarity === "rare";
  });
}

function drawOutpost(center, r, now, hasRareStock) {
  ctx.save();
  ctx.translate(center.x, center.y);
  // A wide outer halo, same construction as drawEnemyShip's per-class
  // glow — that one reads at a glance from across the board because it's
  // sized to stand off the dark floor, not just tint the sprite itself.
  // The small inner beacon below already changed color, but at real board
  // zoom it was too small to actually notice; this is the part that
  // carries the signal from a distance.
  if (hasRareStock) {
    const outerHalo = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.3);
    outerHalo.addColorStop(0, "rgba(215,80,255,0.5)");
    outerHalo.addColorStop(0.55, "rgba(180,50,225,0.26)");
    outerHalo.addColorStop(1, "rgba(160,40,210,0)");
    ctx.fillStyle = outerHalo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  // A finished station sprite was sitting in icons/ unreferenced while
  // this function painted one from scratch. The shape below is the
  // fallback for the moment before it loads.
  const usedSprite = drawShipImage(outpostImg, r * 0.98);
  if (!usedSprite) {
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
  }
  // A slow-pulsing beacon at the hub's core — "open for business," same as
  // always, in the usual amber. Drawn over the loaded sprite too, not just
  // the vector fallback: the PNG is one flat static image, so without this
  // every station would look identical regardless of what it's stocking.
  // A rare-tier item on the shelf turns it hot violet instead — the same
  // "color means something, nobody tells you what" language the Warp
  // Gates already use for their branch tints.
  const t = (now || 0) / 1000;
  const pulse = 0.6 + 0.4 * Math.sin(t * 2);
  const core = hasRareStock ? "255,225,255" : "255,206,138";
  const edge = hasRareStock ? "215,80,255" : "255,160,60";
  const beacon = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.3 * pulse);
  beacon.addColorStop(0, `rgba(${core},0.95)`);
  beacon.addColorStop(1, `rgba(${edge},0)`);
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
  rings: ["hsl(44, 50%, 11%)", "hsl(38, 58%, 3%)", "hsla(52, 80%, 60%, 0.16)"],
  nursery: ["hsl(330, 56%, 12%)", "hsl(318, 64%, 4%)", "hsla(345, 92%, 64%, 0.24)"],
  binary: ["hsl(190, 44%, 11%)", "hsl(198, 52%, 3%)", "hsla(182, 85%, 66%, 0.20)"],
  maw: ["hsl(268, 58%, 8%)", "hsl(275, 70%, 2%)", "hsla(280, 90%, 58%, 0.18)"],
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

// A point in the sky AROUND the board rather than on top of it — the
// margins down either side and the strip along the top. Anything bright
// and small (a sun, a newborn star) gets placed with this, because a hard
// highlight sitting between two hexes is the one thing that reliably makes
// a ship on those hexes impossible to see.
function edgeOfSky(rng, w, h) {
  const side = rng();
  if (side < 0.4) return { x: w * (-0.05 + rng() * 0.18), y: h * rng() };
  if (side < 0.8) return { x: w * (0.87 + rng() * 0.18), y: h * rng() };
  return { x: w * rng(), y: h * (-0.04 + rng() * 0.14) };
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
  // The Deep's lattice was the faintest in the game (a quarter of its hex
  // edges failed both contrast and colour-difference tests) — its sky is
  // flat and empty, so the grid is the only thing holding the board
  // together and it has to actually be drawn.
  void: { stroke: "rgba(150,172,214,0.34)", width: 0.9, panel: ["rgba(120,150,210,0.035)", "rgba(60,80,140,0.02)"] },
  belt: { stroke: "rgba(240,176,116,0.46)", width: 1.05, panel: ["rgba(255,170,90,0.08)", "rgba(150,70,30,0.05)"] },
  storm: { stroke: "rgba(228,172,255,0.58)", width: 1.15, panel: ["rgba(220,150,255,0.11)", "rgba(110,50,170,0.07)"] },
  rings: { stroke: "rgba(246,214,140,0.44)", width: 0.95, panel: ["rgba(255,224,140,0.08)", "rgba(150,110,30,0.05)"] },
  nursery: { stroke: "rgba(255,168,206,0.52)", width: 1.0, panel: ["rgba(255,140,190,0.10)", "rgba(150,30,80,0.06)"] },
  binary: { stroke: "rgba(170,238,246,0.50)", width: 0.85, panel: ["rgba(150,235,245,0.09)", "rgba(30,110,130,0.05)"] },
  maw: { stroke: "rgba(196,158,255,0.36)", width: 0.7, panel: ["rgba(160,110,255,0.06)", "rgba(50,20,100,0.04)"] },
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
    // Shoals: a nebula has STRUCTURE — filaments running one way, dark
    // absorption lanes cutting across them, a couple of bright knots where
    // it's thickest. Soft even blobs average out to a flat brown wash,
    // which is exactly what this used to be.
    const flow = -0.6 + rng() * 1.2; // the whole bank drifts one way
    for (let i = 0; i < 8; i++) {
      const bx = rng() * w;
      const by = rng() * h;
      const len = h * (0.35 + rng() * 0.45);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(flow + (rng() - 0.5) * 0.5);
      ctx.scale(1, 0.28 + rng() * 0.2);
      const fil = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
      fil.addColorStop(0, `hsla(${hue + 10}, ${sat + 30}%, 52%, 0.26)`);
      fil.addColorStop(0.45, `hsla(${hue - 4}, ${sat + 15}%, 34%, 0.13)`);
      fil.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = fil;
      ctx.beginPath();
      ctx.arc(0, 0, len, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Dark lanes: the dust you can't see through, which is what makes the
    // rest read as dust rather than a gradient.
    for (let i = 0; i < 5; i++) {
      const bx = rng() * w;
      const by = rng() * h;
      const len = h * (0.3 + rng() * 0.4);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(flow + (rng() - 0.5) * 0.9);
      ctx.scale(1, 0.1 + rng() * 0.12);
      const lane = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
      lane.addColorStop(0, "rgba(6,3,1,0.5)");
      lane.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = lane;
      ctx.beginPath();
      ctx.arc(0, 0, len, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Two hot knots — somewhere in there something is still lit.
    for (let i = 0; i < 2; i++) {
      const kx = w * (0.15 + rng() * 0.7);
      const ky = h * (0.15 + rng() * 0.7);
      const kr = h * (0.08 + rng() * 0.09);
      const knot = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
      knot.addColorStop(0, `hsla(${hue + 22}, 95%, 72%, 0.34)`);
      knot.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = knot;
      ctx.fillRect(0, 0, w, h);
    }
    // Grit close to the lens.
    for (let i = 0; i < 130; i++) {
      ctx.globalAlpha = 0.1 + rng() * 0.35;
      ctx.fillStyle = `hsl(${hue + rng() * 20}, ${sat + 20}%, ${55 + rng() * 25}%)`;
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, 0.6 + rng() * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (feature === "wrecks") {
    // The Breakers: real rocks, at real sizes, with a lit edge and a dark
    // body so they read as objects you are flying past rather than smudges.
    // A debris lane crosses the frame; the big ones cluster along it.
    const angle = -0.5 + rng() * 1.0;
    ctx.save();
    ctx.translate(w * 0.5, h * 0.5);
    ctx.rotate(angle);
    const lane = ctx.createLinearGradient(0, -h * 0.5, 0, h * 0.5);
    lane.addColorStop(0, "rgba(0,0,0,0)");
    lane.addColorStop(0.5, `hsla(${hue}, ${sat + 25}%, 42%, 0.2)`);
    lane.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lane;
    ctx.fillRect(-w, -h * 0.5, w * 2, h);
    const rocks = [];
    for (let i = 0; i < 34; i++) {
      const spread = (rng() + rng() + rng()) / 3 - 0.5; // clustered on the spine
      rocks.push({
        x: (rng() * 2 - 1) * w * 0.9,
        y: spread * h * 0.95,
        size: (5 + rng() * 46) * (1 - Math.abs(spread) * 0.9),
        seed: rng(),
      });
    }
    rocks.sort((a, b) => a.size - b.size); // big ones nearest, drawn last
    for (const rock of rocks) {
      if (rock.size < 3) continue;
      const lit = -2.1 + rock.seed * 0.4; // one light source for the whole field
      ctx.save();
      ctx.translate(rock.x, rock.y);
      ctx.beginPath();
      const pts = 7 + Math.floor(rng() * 4);
      const radii = [];
      for (let p = 0; p < pts; p++) radii.push(rock.size * (0.62 + rng() * 0.5));
      for (let p = 0; p < pts; p++) {
        const a = (p / pts) * Math.PI * 2;
        const px = Math.cos(a) * radii[p];
        const py = Math.sin(a) * radii[p] * 0.82;
        if (p === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const shade = ctx.createLinearGradient(
        Math.cos(lit) * rock.size, Math.sin(lit) * rock.size,
        -Math.cos(lit) * rock.size, -Math.sin(lit) * rock.size
      );
      shade.addColorStop(0, `hsl(${hue + 12}, ${sat}%, ${30 + rock.seed * 14}%)`);
      shade.addColorStop(0.55, `hsl(${hue + 4}, ${sat - 8}%, ${13 + rock.seed * 6}%)`);
      shade.addColorStop(1, "hsl(12, 30%, 5%)");
      ctx.fillStyle = shade;
      ctx.globalAlpha = 0.62 + rock.seed * 0.3;
      ctx.fill();
      // A hairline of sunlight on the lit edge — the thing that makes a
      // polygon read as a rock.
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = `hsl(${hue + 25}, ${sat + 25}%, ${52 + rock.seed * 15}%)`;
      ctx.lineWidth = Math.max(0.6, rock.size * 0.04);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
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
    // Three curtains, not six, and each one a third as strong. Six
    // stacked full-canvas gradients at 16-36% alpha each added up to a
    // flat pink wall: measured, EVERY hex on this board put an enemy
    // sprite below a 1.5 contrast ratio, and the warp gate failed on 82%
    // of them. A curtain should be something you see through.
    for (let i = 0; i < 3; i++) {
      const x = rng() * w;
      const wide = w * (0.12 + rng() * 0.22);
      const curtain = ctx.createLinearGradient(x - wide, 0, x + wide, h);
      curtain.addColorStop(0, "rgba(0,0,0,0)");
      curtain.addColorStop(0.5, `hsla(${(hue + rng() * 60) % 360}, 90%, 66%, ${0.07 + rng() * 0.07})`);
      curtain.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = curtain;
      ctx.fillRect(0, 0, w, h);
    }
    const front = ctx.createLinearGradient(0, h, 0, h * 0.45);
    front.addColorStop(0, `hsla(${(hue + 30) % 360}, 95%, 62%, 0.10)`);
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
  } else if (feature === "rings") {
    // A ringed giant, seen near enough that the ring plane runs right
    // across the sky as a hard band with a gap in it — the one silhouette
    // nobody mistakes for anywhere else.
    const left = rng() < 0.5;
    const cx = w * (left ? -0.3 : 1.3);
    const cy = h * (0.2 + rng() * 0.4);
    const r = h * (0.42 + rng() * 0.12);
    const tilt = (left ? 1 : -1) * (0.22 + rng() * 0.22);
    // Rings behind the body first, then the body, then rings in front —
    // that overlap is what sells the plane.
    const drawRings = (clipFront) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.scale(1, 0.17);
      if (clipFront) {
        ctx.beginPath();
        ctx.rect(-r * 4, 0, r * 8, r * 4);
        ctx.clip();
      } else {
        ctx.beginPath();
        ctx.rect(-r * 4, -r * 4, r * 8, r * 4);
        ctx.clip();
      }
      const bands = [
        [1.35, 1.72, 0.4], [1.78, 2.05, 0.16], [2.12, 2.55, 0.34], [2.62, 2.78, 0.1], [2.84, 3.1, 0.24],
      ];
      for (const [inner, outer, alpha] of bands) {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = `hsl(${hue + 8}, ${sat + 25}%, ${58 + rng() * 12}%)`;
        ctx.lineWidth = r * (outer - inner);
        ctx.beginPath();
        ctx.arc(0, 0, r * (inner + outer) * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    };
    drawRings(false);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    // The lit limb tops out at 30% lightness, not 52%. At 52% this was the
    // brightest surface in the game and it sat under 63% of the board's
    // hexes — the grid's own pale-yellow stroke measured a 1.21 contrast
    // ratio against it, i.e. gone.
    const body = ctx.createLinearGradient(cx + (left ? r : -r), cy, cx + (left ? -r : r), cy);
    body.addColorStop(0, `hsl(${hue}, ${sat + 22}%, 30%)`);
    body.addColorStop(0.5, `hsl(${hue - 8}, ${sat + 10}%, 16%)`);
    body.addColorStop(1, "#06060a");
    ctx.fillStyle = body;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    for (let i = 0; i < 8; i++) {
      ctx.globalAlpha = 0.16 + rng() * 0.12;
      ctx.fillStyle = `hsl(${(hue + (i % 3) * 10) % 360}, ${sat + 18}%, ${24 + (i % 4) * 9}%)`;
      ctx.beginPath();
      ctx.ellipse(cx, cy - r + (r * 2 * (i + 0.5)) / 8, r, r * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    drawRings(true);
    // The ring's shadow, thrown across the planet's face.
    ctx.globalAlpha = 0.3;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillRect(-r, -r * 0.06, r * 2, r * 0.12);
    ctx.restore();
    ctx.globalAlpha = 1;
  } else if (feature === "nursery") {
    // A star nursery: towering pillars of gas lit from within, and young
    // stars burning holes in them. Bright, hot, crowded.
    for (let i = 0; i < 4; i++) {
      const px = w * (0.1 + rng() * 0.8);
      const base = h * (0.75 + rng() * 0.35);
      const top = h * (0.05 + rng() * 0.35);
      const wide = w * (0.1 + rng() * 0.16);
      ctx.globalAlpha = 0.5;
      const col = ctx.createLinearGradient(px, base, px, top);
      col.addColorStop(0, `hsla(${hue - 12}, ${sat + 25}%, 26%, 0.6)`);
      col.addColorStop(0.6, `hsla(${hue + 10}, ${sat + 35}%, 42%, 0.4)`);
      col.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(px - wide, base);
      ctx.lineTo(px - wide * (0.25 + rng() * 0.3), top);
      ctx.lineTo(px + wide * (0.25 + rng() * 0.3), top + h * 0.06);
      ctx.lineTo(px + wide, base);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Newborn stars, out at the margins. They used to be scattered across
    // the whole canvas at a 0.85-white core, which put a hard glare
    // directly under the hexes — 47% of them made an enemy sprite
    // unreadable. A star belongs in the sky around the board, not on it.
    for (let i = 0; i < 5; i++) {
      const { x: sx, y: sy } = edgeOfSky(rng, w, h);
      const sr = h * (0.05 + rng() * 0.08);
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      glow.addColorStop(0, "rgba(255,255,255,0.55)");
      glow.addColorStop(0.25, `hsla(${hue + 25}, 100%, 74%, 0.35)`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      // Diffraction spikes — a hot young star, not a dot. Short and thick:
      // at 1px they were the same weight and colour as the hex grid and
      // the route-preview dashes, and read as false board edges.
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = "rgba(255,240,250,0.7)";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sx - sr * 1.1, sy); ctx.lineTo(sx + sr * 1.1, sy);
      ctx.moveTo(sx, sy - sr * 1.1); ctx.lineTo(sx, sy + sr * 1.1);
      ctx.stroke();
      ctx.restore();
    }
  } else if (feature === "binary") {
    // Two suns. Hard, shadowless light from both sides at once, and a
    // pale gulf of glare in between.
    // Both suns sit off past the board's edges. They used to be placed at
    // 10-26% and 72-90% of the canvas width — inside the play area — and a
    // 0.95-white core between the hexes wiped the grid out entirely there
    // (contrast ratio 1.02, i.e. not drawn).
    const suns = [
      { x: w * (-0.14 + rng() * 0.16), y: h * (0.08 + rng() * 0.3), r: h * 0.09, h: hue - 25 },
      { x: w * (0.98 + rng() * 0.18), y: h * (0.5 + rng() * 0.35), r: h * 0.065, h: hue + 30 },
    ];
    const bridge = ctx.createLinearGradient(suns[0].x, suns[0].y, suns[1].x, suns[1].y);
    bridge.addColorStop(0, `hsla(${suns[0].h}, 80%, 62%, 0.16)`);
    bridge.addColorStop(0.5, `hsla(${hue}, 60%, 50%, 0.06)`);
    bridge.addColorStop(1, `hsla(${suns[1].h}, 85%, 64%, 0.14)`);
    ctx.fillStyle = bridge;
    ctx.fillRect(0, 0, w, h);
    for (const sun of suns) {
      const glow = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, sun.r * 4.5);
      glow.addColorStop(0, "rgba(255,255,255,0.45)");
      glow.addColorStop(0.12, `hsla(${sun.h}, 100%, 76%, 0.35)`);
      glow.addColorStop(0.45, `hsla(${sun.h}, 90%, 58%, 0.1)`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      // Short, thick, round-capped flares. At 1.2px and five radii long
      // they were the same weight and colour family as the hex grid AND
      // the dashed route preview, and read as board geometry that wasn't
      // there.
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = `hsla(${sun.h}, 100%, 85%, 0.8)`;
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      for (let a = 0; a < 4; a++) {
        const ang = (a * Math.PI) / 4 + 0.2;
        ctx.beginPath();
        ctx.moveTo(sun.x - Math.cos(ang) * sun.r * 2.2, sun.y - Math.sin(ang) * sun.r * 2.2);
        ctx.lineTo(sun.x + Math.cos(ang) * sun.r * 2.2, sun.y + Math.sin(ang) * sun.r * 2.2);
        ctx.stroke();
      }
      ctx.restore();
    }
  } else if (feature === "maw") {
    // Something out here eats light: an accretion disc seen almost
    // edge-on, its far side bent up over the top, and a hole in the middle
    // with nothing in it at all.
    // It used to be drawn at the size of the thing it depicts, which is
    // the wrong instinct on a 520px board: the hole alone covered 41% of
    // the hexes in flat #000, and the disc bands ran off both edges at up
    // to 75px wide. You cannot fight on that. It's a landmark now — off to
    // one side, half the radius, and every band thin enough to read as
    // structure rather than weather.
    const cx = w * (0.14 + rng() * 0.24) + (rng() < 0.5 ? 0 : w * 0.48);
    const cy = h * (0.1 + rng() * 0.2);
    const r = h * (0.085 + rng() * 0.035);
    const tilt = -0.5 + rng() * 1.0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    // Lensed far side: a bright arc standing above the hole.
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = `hsla(${hue + 40}, 95%, 72%, 0.75)`;
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.5, Math.PI * 1.06, Math.PI * 1.94);
    ctx.stroke();
    // The disc itself, flattened.
    ctx.save();
    ctx.scale(1, 0.2);
    for (let i = 0; i < 5; i++) {
      ctx.globalAlpha = 0.2 - i * 0.03;
      ctx.strokeStyle = `hsla(${hue + 30 + i * 12}, 95%, ${74 - i * 8}%, 0.8)`;
      ctx.lineWidth = r * 0.15;
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.5 + i * 0.45), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    // The hole. Deep violet-black rather than an opaque #000 hole punched
    // through the play area — it still eats the light behind it, it just
    // no longer takes the board with it.
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = "#06030f";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // A thin photon ring right at the edge.
    ctx.strokeStyle = `hsla(${hue + 45}, 100%, 85%, 0.6)`;
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.06, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
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
  // Weather goes in FRONT of the sector but never in front of the board.
  // Both of these are full-canvas washes and they were being laid over the
  // finished grid, on top of the same locales that were already the two
  // haziest in the game — a second veil over the one surface that has to
  // stay readable. Clipped out of the play area, they still sell the place
  // and cost the player nothing.
  ctx.clip(skyOutsideBoardPath(), "evenodd");
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
    // The charge crawls across everything around the board.
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
  // "Sometimes a little more zoomed in" — applied to the view of the
  // place, which is what that was ever about, and never to the grid.
  const zoom = locale && locale.zoom ? Math.max(1, locale.zoom) : 1;
  ctx.save();
  if (zoom !== 1) {
    ctx.translate(geom.w / 2, geom.h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-geom.w / 2, -geom.h / 2);
  }
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
  const density = locale ? { void: 190, shoals: 45, shallows: 80, belt: 90, storm: 70, graveyard: 60, rings: 70, nursery: 110, binary: 130, maw: 150 }[locale.id] || 90 : 90;
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

// Everything EXCEPT the board: the whole canvas with the board punched out
// of it, for clipping weather that should pass behind the play area.
// (Path2D has no boolean ops — the even-odd fill rule does the subtraction:
// a point inside both the rect and the board crosses two boundaries and so
// counts as outside.)
function skyOutsideBoardPath() {
  const path = new Path2D();
  path.rect(0, 0, geom.w, geom.h);
  path.addPath(boardPath());
  return path;
}

// The board floor: whatever the sky is doing, the play area lands in a
// narrow, readable band of brightness before a single hex is drawn.
//
// This exists because the art kept winning arguments with the gameplay.
// Measured across all ten locales, the backdrop swung 232x in brightness
// UNDER the board on the maw (an opaque black disc covering 41% of the
// hexes), and 27x on binary (a white sun core sitting between them). On
// those hexes an enemy sprite measured a contrast ratio of 1.0 against
// what was behind it — literally invisible — and the grid lines vanished
// too. The old separator wash was 2-11% alpha, which moved board
// luminance by under 0.01 and never stood a chance.
//
// Two passes do it: a dark fill compresses everything bright down, then a
// faint lift raises everything black up. Both are clipped to the board, so
// the sky outside the play area keeps its full range and the place still
// reads as a place — it's only the ~80 hexes you actually have to see
// things on that get held to a standard.
function drawBoardFloor() {
  ctx.save();
  ctx.clip(boardPath());
  ctx.fillStyle = "rgba(5,8,18,0.46)"; // pull the highlights down
  ctx.fillRect(0, 0, geom.w, geom.h);
  const panel = gridLook().panel;
  const lit = ctx.createLinearGradient(0, 0, 0, geom.h);
  lit.addColorStop(0, panel[0]);
  lit.addColorStop(1, panel[1]);
  ctx.fillStyle = lit;
  ctx.fillRect(0, 0, geom.w, geom.h);
  // ...and lift the blacks, so a locale whose sky is 0.0007 luminance
  // still gives the grid and the sprites something to sit on.
  ctx.fillStyle = "rgba(140,160,215,0.05)";
  ctx.fillRect(0, 0, geom.w, geom.h);
  ctx.restore();
}

function draw() {
  const now = performance.now();
  ctx.clearRect(0, 0, geom.w, geom.h);
  // The place first, edge to edge — the sky is not something that stops at
  // the board's outline ("the full background is actually the background,
  // and the grid is just an overlay on top of it"). The board is then laid
  // over it as a lit panel of navigable space.
  drawSectorBackdrop();
  drawBoardFloor();
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
    const isDiscovery = state.discoveryPos && Engine.posEq(hex, state.discoveryPos);
    const isHazard = Engine.hazardAt(state, hex);

    // Plain floor gets NO fill at all. It used to get a 22%-opacity navy
    // wash, which sounds like nothing until you notice it covers the
    // entire board — i.e. nearly the whole screen — in every sector. That
    // veil was blue-shifting and flattening every locale toward the same
    // grey-navy no matter what sky was painted behind it, which is why six
    // different places kept reading as one. The sky is the background now,
    // full stop; the grid is a lattice drawn on top of it.
    let fill = null;
    let fillAlpha = 0;
    if (isHazard) {
      fill = isHazard.type === "asteroid" ? "#38302b" : "#3a1030";
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
    } else if (isDiscovery) {
      fill = "#1f4a4a";
      fillAlpha = 0.8;
    }
    // Where you will be shot — shown on demand, in Scan, not permanently.
    // Scan costs no turn, so this is deliberate information rather than
    // hidden information: you look, you close it, you move. (Hoplite paints
    // its whole threat picture all the time; that was tried here and the
    // board reads better kept clean, with the danger a thing you ask for.)
    // The overlay honours a gun's CHARGE — a discharged weapon lights
    // nothing — so what you're reading is the live rhythm, not a static
    // range chart.
    if (threats.has(k) && legendVisible) {
      fill = blend(fill || "#182238", "#7a1f2b", 0.55);
      fillAlpha = Math.max(fillAlpha, 0.62);
    }
    if (scanTargetHexes && scanTargetHexes.has(k)) {
      fill = blend(fill || "#182238", "#e0533f", 0.6);
      fillAlpha = Math.max(fillAlpha, 0.75);
    }
    // Movable/targetable hexes keep their normal color — only the border
    // marks them, so the board doesn't turn into a wall of green.
    // Course/route preview: green, the one color movement always wears.
    if (route.has(k)) {
      fill = blend(fill || "#182238", "#2e7d52", 0.5);
      fillAlpha = Math.max(fillAlpha, 0.58);
    }
    // Equipment reach preview (tap a weapon/engines button, or lock a
    // target): green = where you can move, red-orange = what your
    // weapons cover — same color language as the Scan overlay.
    if (reachPreview && reachPreview.hexes.has(k)) {
      fill = blend(fill || "#182238", reachPreview.kind === "move" ? "#2e7d52" : "#a03a26", 0.55);
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
    if (isHazard) {
      // A wall you cannot see is not a wall. This tile used to be a fixed
      // near-black brown outlined in an even darker navy, which cannot
      // separate from a near-black sky by definition — measured invisible
      // on 100% of hexes in the Deep, the graveyard and the belt, and on
      // most of the maw and the shoals. It wears a bright warm rim now, on
      // every sky, because "can I fly through this" is the single most
      // consequential thing a hex says.
      stroke = isHazard.type === "asteroid" ? "rgba(255,214,168,0.72)" : "rgba(255,150,235,0.72)";
      strokeWidth = 2;
    } else {
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
      drawOutpost(center, geom.sx * 0.56, now, outpostHasRareStock(state));
    } else if (isWormhole) {
      drawWormhole(center, geom.sx * 0.5, now);
    } else if (isDiscovery) {
      drawDiscovery(center, geom.sx * 0.56, now, state.discoveryFlavor, `${state.levelId}-${k}`);
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
    // Anything without an engine can't turn to face you, and everything
    // bolted down out here covers all six directions at once anyway. Read
    // off the hold rather than a list of names: the list said "sentry and
    // railgun", and the Railgun Destroyer flies now.
    const def = Engine.ENEMY_TYPES[enemy.type];
    if (!def || def.ship.hasDrive) {
      ctx.rotate((angleToward(enemy, state.playerPos) * Math.PI) / 180);
    }
    drawEnemyShip(geom.sx * 0.46, enemy.hp / enemy.maxHp, enemy.id, enemy.type, enemy.shieldCharges > 0);
    ctx.restore();
    drawChargePips(center, enemy);
  }

  // Charges under the ordnance and under the ships: it's ground, and
  // whatever is standing on it has to stay readable on top of it.
  for (const charge of state.charges || []) {
    if (!charge.spent) drawCharge(charge, now);
  }

  for (const missile of state.missiles || []) {
    drawMissile(hexToPixel(missile), missile, now);
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
  // Written every render, same as "run" itself — otherwise a page reload
  // while sitting on the death/victory overlay (state.status still "lost"
  // in the restored save) would find the in-memory guard reset to false
  // and bank Requisition for the same ending a second time.
  GCStorage.set(GAME_ID, "requisitionAwardedThisEnding", requisitionAwardedThisEnding);
  GCStorage.set(GAME_ID, "requisitionEarnedThisEnding", requisitionEarnedThisEnding);
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
  if ((state.status === "lost" || state.isVictory) && !animsRunning() && !requisitionAwardedThisEnding) {
    // Banked once, the moment the run actually ends (loss, or a boss
    // clear) — never on "Keep Flying" past the Bulwark, since that isn't
    // the run ending. Depth past the campaign is the same number
    // bestDepth already tracks, just turned into something spendable.
    requisitionEarnedThisEnding = requisitionEarnedFor(state);
    requisition += requisitionEarnedThisEnding;
    requisitionAwardedThisEnding = true;
    persistUnlocks();
  }
  if (state.status === "lost" && !animsRunning()) {
    if (voluntaryScuttle) {
      overlayTitleEl.textContent = "Charges Blown";
      overlayBodyEl.textContent = `Scuttled at depth ${state.levelId}. Deepest run so far: ${bestDepth}.`;
    } else {
      overlayTitleEl.textContent = "Flagship Destroyed";
      overlayBodyEl.textContent = `Lost with all hands at depth ${state.levelId}. Deepest run so far: ${bestDepth}.`;
    }
    overlayRequisitionEl.textContent = `+${requisitionEarnedThisEnding} Requisition — ${requisition} banked.`;
    updateLoadoutPicker();
    continueBtnEl.hidden = true;
    overlayEl.hidden = false;
  } else if (state.isVictory && !animsRunning()) {
    overlayTitleEl.textContent = "The Bulwark Is Scrap";
    overlayBodyEl.textContent = `The Bulwark is dead in the water at depth ${state.levelId}. Press on, or take the ship home.`;
    overlayRequisitionEl.textContent = `+${requisitionEarnedThisEnding} Requisition — ${requisition} banked.`;
    updateLoadoutPicker();
    continueBtnEl.hidden = false;
    overlayEl.hidden = false;
  } else {
    overlayEl.hidden = true;
    previewedLoadout = null; // re-arm for the next time this overlay shows
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
    // With nothing marked, the button is not dead — it SHOWS YOU WHERE
    // THIS GUN REACHES. "Can the Arc Beam even get that far" is a question
    // you should be able to ask before committing to anything, and asking
    // it costs nothing: no AP, no energy, just the wash on the board.
    // Tap again (or tap the board) to put it away.
    const previewing = reachPreview && reachPreview.weaponKey === key;
    btn.disabled = busy || !affordable || (Boolean(locked) && !bears);
    btn.classList.toggle("active", (bears && affordable && !busy) || previewing);
    btn.addEventListener("click", () => {
      if (!locked) {
        if (previewing) {
          reachPreview = null;
          pushMessage("Fire plot down.");
        } else {
          reachPreview = {
            hexes: new Set(
              Engine.weaponHexes(state.playerPos, state.facing, weapon, state)
                .filter((h) => Engine.onBoard(state, h))
                .map(Engine.hexKey)
            ),
            kind: "attack",
            weaponKey: key,
          };
          pushMessage(`${weapon.label}: this is everything it covers from here.`);
        }
        render();
        return;
      }
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
// A gun's FOOTPRINT is the interesting thing about it now, so that's what
// the readout leads with — where it lands, and where it doesn't.
function describePattern(weapon) {
  // A charge is described by what it DOES, not by the ring it's thrown to
  // — "the ring at exactly two" is true and completely misleading about a
  // weapon whose point is the seven hexes it takes two rounds later.
  if (weapon.places) {
    return `lobbed ${weapon.range} out, then it takes that hex and every hex touching it, two rounds later`;
  }
  if (weapon.shape === "ring") {
    const min = weapon.minRange || 1;
    if (min === weapon.range && min > 1) {
      return `the ring at exactly ${min} — nothing closer${weapon.ignoresCover ? ", and rock is no cover" : ""}`;
    }
    return `every hex touching the hull${weapon.targets === "all" ? ", all at once" : ""}`;
  }
  if (weapon.shape === "lane") {
    // Two lances now, and they differ ONLY in which part of the lane they
    // own — so a blanket "straight down any axis" left the whole decision
    // between them invisible.
    const min = weapon.minRange || 1;
    if (weapon.range >= 20) return "straight down any axis, until it hits something";
    const band = min === weapon.range ? `exactly ${min}` : `${min} to ${weapon.range}`;
    return `straight down any axis, ${band} out — nothing inside ${min}`;
  }
  if (weapon.shape === "offAxis") return "the six gaps between the axes, two out";
  if (weapon.shape === "arc") {
    return `a wedge off the nose, ${weapon.range} deep`;
  }
  return "all directions";
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
    `${weapon.label} — ${describePattern(weapon)} · ${describeDamage(weapon)}` +
    `${spread} · Energy ${weapon.energyCost}/shot${speed}`
  );
}

// Short enough to sit inline on the console instead of needing its own
// extra-wide line — the full
// sentence is still one tap/hover away via the title tooltip.
function describeWeaponCompact(weapon) {
  const SHAPE = { ring: "RING", lane: "LANE", offAxis: "GAPS", arc: "WEDGE" };
  const band =
    weapon.shape === "ring"
      ? `@${weapon.minRange || 1}`
      : weapon.shape === "lane"
        ? "@ANY"
        : `@${weapon.range}`;
  const dmg = weapon.damage > 0 ? `D${weapon.damage}` : "PUSH";
  return `${SHAPE[weapon.shape] || "ARC"}${band} · ${dmg} · E${weapon.energyCost}`;
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
  const isDiscovery = Boolean(state.discoveryPos) && Engine.posEq(state.discoveryPos, inspectedHex);
  const hazard = Engine.hazardAt(state, inspectedHex);
  if (!isGate && !isOutpost && !isWormhole && !isDiscovery && !hazard) {
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
  } else if (isDiscovery) {
    name.textContent = (state.discoveryLabel || "WRECKAGE").toUpperCase();
    stats.textContent = "Unclaimed. Worth a look — flying onto it is enough.";
  } else {
    name.textContent = "ASTEROID FIELD";
    stats.textContent = "Solid rock and dust. Nothing gets through it.";
  }
  header.appendChild(name);
  enemyInfoEl.appendChild(header);
  enemyInfoEl.appendChild(stats);
}

// Which loadout chip is currently being INSPECTED — separate from
// selectedLoadout (which one is actually armed for the next run). Tapping
// a chip only previews it; a distinct button in the detail box below
// commits. Same two-step shape as the Outpost's shelf/selectedOfferId,
// deliberately: a single tap that both bought AND armed something at once
// read as "I don't understand what I'm choosing" (Clubhouse: "what...
// this isn't normally how unlocks work... you select the next one, it
// shows what's available, then you confirm").
let previewedLoadout = null;

// Rebuilds the death/victory overlay's starting-loadout chips from
// Engine.STARTING_LOADOUTS every time it's shown — same "cheap enough to
// just rebuild it" approach as updateOutpost below.
function updateLoadoutPicker() {
  loadoutPickerEl.innerHTML = "";
  const ids = Object.keys(Engine.STARTING_LOADOUTS);
  if (previewedLoadout && !ids.includes(previewedLoadout)) previewedLoadout = null;
  // A selection pointing at an id that no longer exists (a stale
  // localStorage value from before a loadout was renamed/removed) must
  // never mean "no chip checked, silently fly Standard anyway" — that's
  // exactly the kind of desync the chosen chip needs to never suffer.
  // Self-heal to Standard and persist the correction so it doesn't
  // recur every render.
  if (!ids.includes(selectedLoadout)) {
    selectedLoadout = "standard";
    persistUnlocks();
  }
  for (const id of ids) {
    const loadout = Engine.STARTING_LOADOUTS[id];
    const btn = document.createElement("button");
    const owned = unlockedLoadouts.has(id);
    const active = selectedLoadout === id;
    btn.textContent = active ? `${loadout.label} ✓` : loadout.label;
    btn.classList.toggle("selected", previewedLoadout === id);
    btn.addEventListener("click", () => {
      previewedLoadout = previewedLoadout === id ? null : id;
      updateLoadoutPicker();
      updateLoadoutDetail();
    });
    loadoutPickerEl.appendChild(btn);
  }
  updateLoadoutDetail();
}

// The readout for whichever chip is currently previewed — what it gives
// you, what it costs to fit, and a single button that actually commits
// (unlock-and-select if locked, select if already owned, or just "this is
// what's flying next" if it's already the active pick).
function updateLoadoutDetail() {
  loadoutDetailEl.hidden = false;
  loadoutDetailEl.innerHTML = "";
  if (!previewedLoadout) {
    const empty = document.createElement("div");
    empty.className = "loadout-detail-empty";
    empty.textContent = "Tap a start to see what it gives you.";
    loadoutDetailEl.appendChild(empty);
    return;
  }

  const preview = Engine.previewLoadout(previewedLoadout);
  const owned = unlockedLoadouts.has(previewedLoadout);
  const active = selectedLoadout === previewedLoadout;

  // The hull itself first — same lookup flagshipSprite() uses, just keyed
  // on the loadout being previewed instead of the run actually in flight.
  const body = document.createElement("div");
  const figure = document.createElement("img");
  figure.className = "loadout-ship-figure";
  figure.src = spriteForLoadout(previewedLoadout).src;
  figure.alt = preview.label;
  body.appendChild(figure);
  // Stats first, always visible even if the blurb wraps long enough to
  // need the box's scroll — the numbers are what actually distinguishes
  // one loadout from another; the blurb is the why.
  const stats = document.createElement("div");
  stats.className = "loadout-stats";
  stats.textContent =
    `Hull ${preview.maxHull} · Energy ${preview.maxEnergy}` +
    (preview.maxShields > 0 ? ` · Shields ${preview.maxShields} (raised)` : "");
  body.appendChild(stats);
  const blurb = document.createElement("span");
  blurb.className = "hold-info-text";
  blurb.textContent = preview.blurb;
  body.appendChild(blurb);
  loadoutDetailEl.appendChild(body);

  const confirm = document.createElement("button");
  confirm.className = "loadout-confirm";
  if (active) {
    confirm.textContent = "This is flying next";
    confirm.disabled = true;
  } else if (owned) {
    confirm.textContent = "Select for next run";
    confirm.disabled = false;
  } else {
    const short = Math.max(0, preview.cost - requisition);
    confirm.textContent = short > 0 ? `Unlock — ${preview.cost} req. (${short} short)` : `Unlock — ${preview.cost} req.`;
    confirm.disabled = short > 0;
  }
  confirm.addEventListener("click", () => {
    if (!owned) {
      requisition -= preview.cost;
      unlockedLoadouts.add(previewedLoadout);
    }
    selectedLoadout = previewedLoadout;
    persistUnlocks();
    // A full render, not just updateLoadoutPicker() — unlocking spends
    // Requisition, and the "X banked" line just above the picker only
    // gets touched by updateHud(). Calling the narrower refresh left that
    // number stale (still the pre-spend total) until whatever redrew the
    // overlay next, same pattern every other state-changing click in this
    // file already follows (see the Outpost's buy button via handleAction).
    render();
  });
  loadoutDetailEl.appendChild(confirm);
}

// Rebuilds the outpost shop's offer buttons from Engine.outpostOffers every
// render — it's cheap (two offers) and keeps the panel from ever drifting
// out of sync with actual affordability/applicability as salvage/hull change.
function updateOutpost() {
  const docked = state.status === "playing" && Engine.outpostAvailable(state);
  if (!docked) {
    outpostDismissed = false; // re-arm for the next visit
    selectedOfferId = null;
  }
  const show = docked && !outpostDismissed;
  outpostOverlayEl.hidden = !show;
  if (!show) return;

  outpostSalvageEl.textContent = state.salvage;
  outpostOffersEl.innerHTML = "";
  const offers = Engine.outpostOffers(state);
  // A selection that is no longer on the shelf (you just bought it) stops
  // being selected, rather than leaving a readout for something that isn't
  // there any more.
  if (selectedOfferId && !offers.some((o) => o.id === selectedOfferId)) selectedOfferId = null;

  for (const offer of offers) {
    const btn = document.createElement("button");
    // A greyed-out row that only says its price reads as "useless" — it
    // should say what it's WAITING on, so the shelf is a target to hunt
    // toward rather than a list of things you can't have.
    const short = Math.max(0, offer.cost - state.salvage);
    // The shelf carries the NAME and the price; everything else about the
    // thing lives in the readout below, now that there is one. The pool's
    // labels tack the shape onto the name in brackets, which made every
    // row a paragraph.
    const name = offer.label.replace(/\s*\(.*\)\s*$/, "");
    btn.textContent = !offer.applicable
      ? `${name} — not needed`
      : short > 0
        ? `${name} — ${offer.cost} salvage (${short} short)`
        : `${name} — ${offer.cost} salvage`;
    // Tapping the shelf INSPECTS. It used to buy on the spot, so the only
    // way to find out what a gun's footprint looked like was to own it —
    // and a mis-tap spent salvage you were saving. Even an offer you can't
    // afford is worth reading: that's how you decide what to save for.
    btn.classList.toggle("selected", offer.id === selectedOfferId);
    btn.addEventListener("click", () => {
      selectedOfferId = selectedOfferId === offer.id ? null : offer.id;
      render();
    });
    outpostOffersEl.appendChild(btn);
  }

  // The readout box is ALWAYS on screen, selected or not. Showing it only
  // when something is picked meant the shelf and the Undock button below
  // it jumped down the moment you tapped a row — and jumped again between
  // a one-line offer and a weapon's footprint diagram.
  const selected = offers.find((o) => o.id === selectedOfferId) || null;
  outpostDetailEl.hidden = false;
  outpostDetailEl.innerHTML = "";
  if (!selected) {
    const empty = document.createElement("div");
    empty.className = "outpost-detail-empty";
    empty.textContent = "Tap anything on the shelf to look it over.";
    outpostDetailEl.appendChild(empty);
    return;
  }

  // The same readout the Hold gives a fitted item — footprint diagram and
  // all — for anything that actually delivers a crate. Offers that don't
  // (a patch, another row of hull) describe themselves.
  const body = document.createElement("div");
  if (selected.itemId) {
    renderItemReadout(body, selected.itemId);
  } else {
    body.innerHTML = `<span class="hold-info-text">${escapeHtml(OFFER_BLURB[selected.id] || selected.label)}</span>`;
  }
  outpostDetailEl.appendChild(body);

  if (selected.fits === false) {
    const warn = document.createElement("p");
    warn.className = "outpost-note";
    warn.textContent = "No room in the Hold — it rides in cargo until you make space.";
    outpostDetailEl.appendChild(warn);
  }

  const buy = document.createElement("button");
  buy.className = "outpost-buy";
  buy.textContent = !selected.applicable
    ? "Not needed"
    : selected.affordable
      ? `Buy — ${selected.cost} salvage`
      : `${selected.cost - state.salvage} salvage short`;
  buy.disabled = !selected.affordable || !selected.applicable;
  buy.addEventListener("click", () => {
    const id = selected.id;
    selectedOfferId = null;
    handleAction(() => Engine.applyOutpostPurchase(state, id));
  });
  outpostDetailEl.appendChild(buy);
}

// What the offers that DON'T hand you a crate actually do. Anything that
// delivers real equipment is described by describeItem instead, off the
// item itself, so it can never drift from the thing you receive.
const OFFER_BLURB = {
  repair: "Patch 1 Hull. Welded plate over the worst of it — the only way hull comes back mid-run.",
  hardpoint: "One more row of internal space. Nothing works until it's fitted, and this is where it fits.",
};

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
    drawEnemyShip(contactPortraitEl.width * 0.33, enemy.hp / enemy.maxHp, enemy.id, enemy.type, enemy.shieldCharges > 0);
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
  else shipPortraitEl.src = flagshipSprite().src;

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
    // A gun gets its own picture on the tile. The Hold is the one screen
    // where hardware IS the content, and every tile in it was a coloured
    // rectangle with a word in it — the icons say something the word
    // can't: the Flank Tubes visibly point outward, the Railgun is a
    // spine, the Mortar is a fat throat. Label stays, because at this
    // size the picture alone isn't enough to pick a gun by.
    const eq = t.itemId && Engine.EQUIPMENT[t.itemId];
    if (eq && eq.kind === "weapon") {
      tile.classList.add("has-icon");
      tile.style.backgroundImage = `url("icons/weapon-${eq.weaponKey}.png")`;
    }
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
    let warnText = null; // filled in just below; the confirm handler speaks through it
    const scuttle = document.createElement("button");
    scuttle.id = "selfDestructBtn";
    scuttle.className = "self-destruct" + (selfDestructArmed ? " armed" : "");
    scuttle.textContent = scuttling ? "CHARGES AWAY" : selfDestructArmed ? "CONFIRM — SCUTTLE THE SHIP" : "Scuttling Charges";
    scuttle.disabled = scuttling;
    scuttle.addEventListener("click", async () => {
      if (scuttling) return; // already mid-blast — see the `scuttling` declaration
      if (selfDestructArmed) {
        // Watch her go first. The screen stays put through the blast, then
        // the death overlay comes up same as any other run ending — same
        // Requisition payout, same loadout picker to arm the next hull —
        // "New Ship" there is what actually starts the fresh run.
        scuttling = true;
        scuttle.disabled = true;
        scuttle.textContent = "CHARGES AWAY";
        warnText.textContent = "Charges blown. It has been an honour.";
        await playScuttle();
        shipVisible = false;
        selfDestructArmed = false;
        voluntaryScuttle = true;
        state.status = "lost";
        scuttling = false;
        render();
        return;
      }
      selfDestructArmed = true;
      render();
    });
    shipHardpointsEl.appendChild(scuttle);
    const warn = document.createElement("p");
    warnText = warn;
    warn.className = "ship-note self-destruct-note";
    warn.textContent = scuttling
      ? "Charges blown. It has been an honour."
      : selfDestructArmed
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

// A weapon's FOOTPRINT, drawn as the hex field it actually covers, from
// the point of view of whatever ship is carrying it. A sentence can say
// "the ring at exactly two" but the shape is the thing you have to hold in
// your head while you fly, so the readout draws it ("when you select a
// weapon it should show how it works grid-wise"). Same geometry and the
// same colours as the board: flat-top hexes, the carrier in amber, covered
// ground in the red the board washes threatened hexes with.
const FOOT_SPAN = 3; // far enough for the Mortar's shell; lanes say so in words
function weaponFootprintSVG(weapon) {
  const S = 13;
  const centre = (q, r) => ({ x: S * 1.5 * q, y: S * Math.sqrt(3) * (r + q / 2) });
  const corners = (cx, cy) => {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      pts.push(`${(cx + S * Math.cos(a)).toFixed(1)},${(cy + S * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(" ");
  };
  const origin = { q: 0, r: 0 };
  const landed = Engine.weaponHexes(origin, 0, weapon);
  const covered = new Set(
    landed.filter((h) => Engine.hexDistance(origin, h) <= FOOT_SPAN).map(Engine.hexKey)
  );
  // A weapon that PLACES something threatens two different things and the
  // diagram has to say so: the ring it can throw TO, and — bigger, and
  // the part that actually kills — the blast around wherever it lands.
  // Drawing only the throw ring made a Demolition Charge look like a worse
  // Arc Beam.
  const blastZone = new Set();
  if (weapon.places) {
    for (let q = -FOOT_SPAN; q <= FOOT_SPAN; q++) {
      for (let r = -FOOT_SPAN; r <= FOOT_SPAN; r++) {
        const h = { q, r };
        if (Engine.hexDistance(origin, h) > FOOT_SPAN) continue;
        if (covered.has(Engine.hexKey(h))) continue;
        if (landed.some((t) => Engine.hexDistance(t, h) <= (weapon.blast || 1))) blastZone.add(Engine.hexKey(h));
      }
    }
  }
  const cells = [];
  for (let q = -FOOT_SPAN; q <= FOOT_SPAN; q++) {
    for (let r = -FOOT_SPAN; r <= FOOT_SPAN; r++) {
      if (Engine.hexDistance(origin, { q, r }) > FOOT_SPAN) continue;
      cells.push({ q, r });
    }
  }
  const pts = cells.map((c) => centre(c.q, c.r));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = S + 2;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) + pad - minX;
  const h = Math.max(...ys) + pad - minY;
  const parts = [
    `<svg class="foot" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" role="img" aria-label="${weapon.label}: ${describePattern(weapon)}">`,
  ];
  for (const c of cells) {
    const p = centre(c.q, c.r);
    const self = c.q === 0 && c.r === 0;
    const lit = covered.has(Engine.hexKey(c));
    const splash = blastZone.has(Engine.hexKey(c));
    const fill = self
      ? "rgba(255,156,74,0.34)"
      : lit
        ? "rgba(224,83,63,0.42)"
        : splash
          ? "rgba(224,83,63,0.18)"
          : "rgba(255,255,255,0.02)";
    const stroke = self ? "#ff9c4a" : lit ? "#e0533f" : splash ? "#8d3a2f" : "#2a3652";
    parts.push(
      `<polygon points="${corners(p.x, p.y)}" fill="${fill}" stroke="${stroke}" stroke-width="${self || lit ? 1.3 : splash ? 1 : 0.7}"/>`
    );
  }
  const o = centre(0, 0);
  parts.push(`<circle cx="${o.x}" cy="${o.y}" r="3.6" fill="#ff9c4a"/></svg>`);
  return parts.join("");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// The readout for one tapped tile: what it is, and — for a gun — the shape
// it covers.
function renderItemReadout(infoEl, id) {
  const eq = Engine.EQUIPMENT[id];
  const text = `<span class="hold-info-text">${escapeHtml(describeItem(id))}</span>`;
  if (!eq || eq.kind !== "weapon") {
    infoEl.innerHTML = text;
    return;
  }
  const weapon = Engine.WEAPONS[eq.weaponKey];
  const note = weapon.shape === "lane" ? '<span class="foot-note">…and onward to the board edge</span>' : "";
  const cover = weapon.ignoresCover ? '<span class="foot-note foot-warn">lobbed — rock is no cover</span>' : "";
  const fuse = weapon.places
    ? '<span class="foot-note foot-warn">lands where you aim, goes off two rounds later — pale hexes are the blast, and it does not care whose ship is in it</span>'
    : "";
  infoEl.innerHTML = `<span class="hold-info-figure">${weaponFootprintSVG(weapon)}${note}${cover}${fuse}</span>${text}`;
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
    renderItemReadout(infoEl, tile.dataset.itemId);
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
  // Same colour the gate itself wore on the board — see localeRgbAhead.
  const tintOf = (levelId, variantId) => {
    const ahead = localeRgbAhead(levelId, variantId);
    if (ahead) return `rgb(${ahead.rgb[0]}, ${ahead.rgb[1]}, ${ahead.rgb[2]})`;
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
      `<line x1="${xs[i - 1]}" y1="${yOf(i - 1)}" x2="${xs[i]}" y2="${yOf(i)}" stroke="${tintOf(chain[i - 1].levelId, chain[i - 1].tookVariant)}" stroke-width="2" opacity="0.75"/>`
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
      const tint = tintOf(n.levelId, ex.variantId);
      svg.push(
        `<line x1="${xs[i]}" y1="${yOf(i)}" x2="${xs[i] + dir * 34}" y2="${yOf(i) - 26}" stroke="${tint}" stroke-width="1.5" stroke-dasharray="3 4" opacity="0.5"/>` +
          `<circle cx="${xs[i] + dir * 34}" cy="${yOf(i) - 26}" r="3" fill="none" stroke="${tint}" stroke-width="1" stroke-dasharray="2 2" opacity="0.5"/>`
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
      const tint = tintOf(chain[cur].levelId, ex.variantId);
      svg.push(
        `<line x1="${xs[cur]}" y1="${yOf(cur)}" x2="${ax}" y2="${ay}" stroke="${tint}" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.8"/>` +
          `<circle cx="${ax}" cy="${ay}" r="9" fill="none" stroke="${tint}" stroke-width="1.5" stroke-dasharray="3 3"/>` +
          `<text x="${ax}" y="${ay + 3.5}" text-anchor="middle" fill="${tint}" font-size="10" font-family="monospace">?</text>`
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
  // The nose can never drift from the engine's facing: whatever just
  // happened, this is the last word before anything is drawn.
  if (!anims.some((a) => a.kind === "pslide")) syncShipAngle();
  window.__hhState = state; // debug hook: deterministic + serializable, safe to inspect
  window.__hhPlannedPath = plannedPath;
  window.__hhAutoRoute = autoRoute;
  window.__hhTargetedEnemy = targetedEnemyId;
  window.__hhReachPreview = reachPreview;
  window.__hhShipAngle = shipAngle; // test hook: where the sprite is actually pointing
  window.__hhDirAngles = DIR_ANGLES; // test hook: the angle each facing should draw at
  window.__hhEnemySprites = ENEMY_SPRITES; // test hook: one hull per class, no sharing // test hook: the equipment plot currently on the board
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

// A sector swap runs off a timer, outside handleAction's try/catch. If one
// of those throws part-way — before `state` has been replaced — the run is
// left in status "won" with no overlay, every button disabled and the board
// tap handler bailing out early: no way back but a page reload. The turn
// loop already guards its own render for exactly this reason; the swaps
// were the last unguarded path into that dead end.
function runTransition(swap, animKind) {
  try {
    swap();
  } catch (err) {
    console.error("sector transition failed", err);
    if (state && state.status === "won") state.status = "playing";
    anims = anims.filter((a) => a.kind !== animKind);
    pushMessage("Jump aborted — hold position.");
    try {
      render();
    } catch (renderErr) {
      console.error("render failed", renderErr);
    }
  }
}

// opts.allowTransition — whether flying onto a Warp Gate or a wormhole on
// THIS action is allowed to change sector. False for the intermediate hops
// of a plotted course: a route that merely passes over the wormhole used to
// yank you back to the previous sector two hexes into a seven-hex burn.
// Only the step that actually lands on the route's destination counts.
function handleAction(fn, opts) {
  const allowTransition = !opts || opts.allowTransition !== false;
  let ok = false;
  plannedPath = null;
  reachPreview = null;
  const turnsBefore = state.turnCount;
  try {
    fn();
    // The run's own clock. Sector turnCounts reset; this doesn't, so "how
    // long has that sector been alone" stays answerable across the chart.
    if (state.turnCount > turnsBefore) voyageTurns += state.turnCount - turnsBefore;
    // Did that action take us off the hex we arrived on? Checked every
    // action, not just the ones that end on a gate — the flag has to
    // latch off the moment the ship leaves, or flying back onto the
    // wormhole later would find it still suppressed and do nothing.
    const parked = stillOnArrivalHex();
    // The engine wins the sector on ANY action taken while standing on a
    // Warp Gate — it has no idea you were put down on one by a wormhole
    // or a chart jump. Suppressing just the warp would leave the run
    // stuck in status "won": no overlay, every control disabled, board
    // taps ignored. So un-consume the win outright, exactly as jumpToChart
    // and restoreRun already do for a snapshot captured mid-jump. Fly off
    // the gate and back on and it wins for real.
    if (parked && state.status === "won") {
      state.status = "playing";
      state.isVictory = false;
      state.usedExitVariant = null;
    }
    mode = null;
    modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
    scheduleAnims(state.events);
    // A boss win (isVictory) deliberately skips the auto-continue warp —
    // "Run Complete" is a real milestone, not a routine clear, and gets a
    // manual overlay instead (see updateHud). continueBtn triggers the
    // exact same advanceSector flow, just player-initiated.
    if (
      allowTransition &&
      state.status === "won" &&
      !state.isVictory &&
      // (A win while parked on the arrival hex was already un-consumed
      // above, so reaching here means it's a real one.)
      !anims.some((a) => a.kind === "warp")
    ) {
      const warpDur = 900;
      anims.push({ kind: "warp", start: performance.now(), dur: warpDur });
      requestAnimationFrame(tickAnims);
      // Swap to the next sector right at the flash's peak opacity (see the
      // flashAlpha curve in draw()'s "warp" case, centered at p=0.55) —
      // the screen is fully obscured at that instant, so the map changes
      // underneath the flash instead of after it finishes.
      setTimeout(() => runTransition(advanceSector, "warp"), warpDur * 0.55);
    } else if (
      allowTransition &&
      state.status === "playing" &&
      Engine.wormholeAvailable(state) &&
      !parked &&
      // Nowhere to go back TO. A chart/save desync could otherwise arm
      // this every single action: a full-screen flash, 900ms, and then
      // jumpToChart(-1) quietly doing nothing.
      chartIndex > 0 &&
      !anims.some((a) => a.kind === "wormhole")
    ) {
      // Flying onto the wormhole is the return trip — same peak-opacity
      // swap timing as the forward warp, tinted differently (see draw()'s
      // "wormhole" case) so going back reads as distinct from going on.
      const warpDur = 900;
      anims.push({ kind: "wormhole", start: performance.now(), dur: warpDur });
      requestAnimationFrame(tickAnims);
      setTimeout(() => runTransition(returnToPreviousSector, "wormhole"), warpDur * 0.55);
    }
    ok = true;
  } catch (err) {
    pushMessage(err.message);
  }
  // render() used to sit OUTSIDE this guard. A throw in here therefore
  // escaped handleAction, escaped stepRoute, and left `autoRoute` set —
  // and since a board tap is ignored while a route is in flight, that
  // silently deafened the whole board: no moving, no firing, no way back
  // except a reload. Whatever goes wrong, the turn ends cleanly.
  try {
    render();
  } catch (err) {
    console.error("render failed", err);
  }
  return ok;
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

  // Anything that chased us through a gate arrives on the fresh board too
  // — placement only, so the sector's own contacts keep the positions and
  // the empty reactors they were authored with.
  if (pendingArrivals.length) {
    Engine.placeArrivals(state, pendingArrivals, voyageTurns);
    pendingArrivals = [];
  }

  // This brand-new sector joins the chart as the live entry.
  sectorHistory.push({
    levelIndex,
    variantId: (opts && opts.variantId) || null,
    state: JSON.parse(JSON.stringify(state)),
  });
  chartIndex = sectorHistory.length - 1;
  markArrival();
  mode = null;
  anims = keptAnims;
  announceSector(); // AFTER the anims reset, or the title gets wiped with them
  targetedEnemyId = null;
  reachPreview = null;
  plannedPath = null;
  cancelRoute();
  outpostDismissed = false;
  shipAngle = -90;
  requisitionAwardedThisEnding = false;
  requisitionEarnedThisEnding = 0;
  voluntaryScuttle = false;
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
    // The per-run luck seed: a pre-rework save has no runSeed, which would
    // otherwise silently fall back to the deterministic default (0) for
    // the rest of that run instead of getting a real one. Same policy.
    typeof s.runSeed === "number" &&
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
    loadSector(0, { runSeed: freshRunSeed(), startingLoadout: selectedLoadout });
    return;
  }
  levelIndex = savedIndex;
  state = savedState;
  // Restored in lockstep with "run" (see persist()) — otherwise reloading
  // while sitting on the death/victory overlay would re-bank Requisition
  // for the same ending, since the in-memory guard defaults to false on
  // every fresh page load.
  requisitionAwardedThisEnding = GCStorage.get(GAME_ID, "requisitionAwardedThisEnding", false);
  requisitionEarnedThisEnding = GCStorage.get(GAME_ID, "requisitionEarnedThisEnding", 0);
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
    sectorHistory[chartIndex] = {
      levelIndex,
      variantId: sectorHistory[chartIndex].variantId || null,
      state: JSON.parse(JSON.stringify(state)),
    };
  }
  // A save can land mid-"won" (captured the instant a warp animation
  // started) — the animation itself doesn't survive a reload, so just
  // un-consume it back to "playing", same fix as the wormhole return.
  if (state.status === "won") state.status = "playing";
  // Same arrival grace as loadSector — harmless even if the flagship
  // wasn't actually standing on a wormhole when this was saved.
  markArrival();
  mode = null;
  anims = [];
  targetedEnemyId = null;
  reachPreview = null;
  plannedPath = null;
  cancelRoute();
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
  if (!legendVisible) inspectedHex = null; // closing Scan mode clears whatever was inspected
  render(); // full refresh — every button/toggle's disabled state depends on legendVisible now
});

shipBtn.addEventListener("click", () => {
  systemsContext = "ship";
  shipVisible = !shipVisible;
  mapVisible = false;
  render();
});
// A berth is for two things and the overlay only ever advertised one.
// This takes you straight to the Hold with the dock still under you, so
// the refit half of the game is reachable without already knowing the
// Systems screen exists and that it behaves differently while docked.
outpostRefitBtn.addEventListener("click", () => {
  outpostDismissed = true; // step out of the shop, stay berthed
  systemsContext = "ship";
  shipVisible = true;
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
    autoRoute = { target: plannedPath.target, path: plannedPath.hexes, damageTaken: 0, stepIndex: 0 };
    plannedPath = null;
    // Answer the instruction the moment it's obeyed. Nothing in the move
    // path writes to the readout, so "Course laid in. Confirm to burn."
    // used to sit there through the whole burn and well past arrival —
    // a screen still asking you to confirm something you already did is
    // what a frozen game looks like, and it's the line every "it's stuck"
    // report quotes whether or not anything is actually wrong.
    pushMessage("Burning.");
    stepRoute();
    return;
  }
  // Plot AROUND the shooting, not through it. The preview used to be a
  // plain shortest-hop walk that happily ran the length of a Sentry's ring
  // because every individual step was legal — while playtest.js's pilot AI
  // had been weighting the same search by danger for months. Same rule
  // both sides now: a detour that keeps you out of a firing solution beats
  // a shorter line that doesn't, and if the only way through is hot the
  // route still exists, it just costs.
  const path = Engine.findPath(state, state.playerPos, hex, { avoidThreats: true });
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
  try {
    stepRouteInner();
  } catch (err) {
    // Nothing that happens mid-flight is worth losing the controls over.
    cancelRoute();
    pushMessage("Course aborted.");
    console.error("route step failed", err);
    render();
  }
}

// When a burn gives up. This used to be "the instant hull drops, stop" —
// and since every step of a course is a full round, and on any board with
// hostiles on it something hits you most rounds, that meant a plotted
// nine-hex course reliably flew ONE hex and quit. Measured across four
// depths: asked for 9, flew 1; asked for 12, flew 2; asked for 10, flew 1.
// The player experiences that as "I can only move two hexes", because
// that is precisely what happens, and re-plotting just repeats it.
//
// Retreating while a chaser plinks at you is not a mistake to be
// protected from — it's the whole reason to cross ground. So a single hit
// no longer ends the burn. What ends it is the ship being in real
// trouble: a SECOND hit in the same course, or hull down to its last
// point, where every further step is the run. Either way the rest of the
// course stays laid in, so one tap resumes it instead of starting over.
// And a tap anywhere still cancels a burn at any moment (see the canvas
// handler) — control was never actually taken away, only movement was.
// One number: a course carries a damage budget of 2 Hull, and stops once
// it's spent. That covers both "a chaser hit me twice" and "a Railgun put
// two through me at once", without ever depending on how much hull the
// ship happened to start with — a first attempt at this checked
// `hull <= 1` and turned into a different lockout entirely: at one Hull
// the route refused to move a single hex, forever.
const ROUTE_DAMAGE_BUDGET = 2;

function routeStop(route) {
  return route.damageTaken >= ROUTE_DAMAGE_BUDGET
    ? "Course held — we are taking real damage. Taking stock."
    : null;
}

function stepRouteInner() {
  if (!autoRoute) return;
  const arrived = Engine.posEq(state.playerPos, autoRoute.target);
  const stopReason = arrived ? null : routeStop(autoRoute);
  if (arrived || stopReason || state.status !== "playing") {
    if (stopReason && state.status === "playing") {
      pushMessage(stopReason);
      // Leave the remainder laid in — the plan was fine, the moment
      // wasn't. Confirming once picks it straight back up.
      const rest = Engine.findPath(state, state.playerPos, autoRoute.target, { avoidThreats: true });
      plannedPath = rest && rest.length > 1 ? { target: { ...autoRoute.target }, hexes: rest } : null;
    } else if (arrived && state.status === "playing") {
      pushMessage("In position.");
    }
    cancelRoute();
    render();
    return;
  }
  // Recompute each step: enemies move between turns and can block the way.
  // Re-plotted every step, threat-weighted every step: enemies move
  // between rounds, so the safe lane when you laid the course in is not
  // necessarily the safe lane three hexes later. The burn re-reads the
  // board rather than following a plan that has gone stale.
  const path = Engine.findPath(state, state.playerPos, autoRoute.target, { avoidThreats: true });
  if (!path || path.length < 2) {
    cancelRoute();
    pushMessage("No clear lane.");
    render();
    return;
  }
  autoRoute.path = path;
  const hullBefore = state.hull;
  // If the burn itself was refused, the route is over — retrying the same
  // blocked step on a timer forever is how a flight turns into a lockout.
  const flew = handleAction(() => Engine.applySublight(state, path[1]), {
    allowTransition: Engine.posEq(path[1], autoRoute.target),
  });
  if (autoRoute && state.hull < hullBefore) autoRoute.damageTaken += hullBefore - state.hull;
  if (!flew) {
    cancelRoute();
    render();
    return;
  }
  if (autoRoute) {
    autoRoute.stepIndex += 1;
    // Held so cancelling a course actually stops it. An orphaned timer
    // used to survive the cancel and then drive the NEXT course as a
    // second chain, flying it at roughly double speed.
    autoRoute.timer = setTimeout(stepRoute, autoRouteDelay(autoRoute.stepIndex));
  }
}

canvas.addEventListener("click", (evt) => {
  if (state.status !== "playing") return;
  // A tap during a flight CANCELS it rather than being thrown away. It
  // reads better — you can change your mind halfway down a long burn —
  // and it means the board can never be left permanently deaf to input,
  // whatever else goes wrong: one tap always does something.
  if (autoRoute) {
    cancelRoute();
    pushMessage("Course aborted — holding here.");
    render();
    return;
  }

  // Per-AXIS scaling. This used to use one factor for both, which is only
  // right while the canvas keeps its aspect ratio — and it didn't.
  const rect = canvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * (geom.w / (rect.width || geom.w));
  const y = (evt.clientY - rect.top) * (geom.h / (rect.height || geom.h));
  const hex = pixelToHex(x, y);

  // Scan mode is inspect-only — tapping anything on the board (an enemy,
  // the Warp Gate, the Outpost, the Wormhole, an asteroid field) shows its
  // info and nothing else happens: no move, no action, no turn spent.
  // Scan mode is the no-commitment way to look at anything, so it can't
  // let a tap fall through into a real move or action underneath it.
  if (legendVisible) {
    inspectedHex = { q: hex.q, r: hex.r };
    // Always SAY something. A tap that inspects empty space used to be a
    // completely silent no-op — no card, no message, no redraw — which is
    // indistinguishable from a frozen game, and is how "I can't move or
    // attack" gets reported when the helm is merely being held.
    pushMessage(
      Engine.enemyAt(state, hex)
        ? "Scanning contact — helm is holding. Tap Scan to resume."
        : "Scanning — helm is holding. Tap Scan to resume."
    );
    updateScanInfo();
    render();
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

  // Tapping the berth you are already standing on re-opens it. "Undock"
  // only ever hid the panel — the ship never actually left — but with the
  // panel gone there was no way back to it without flying off the hex and
  // returning, which reads as the dock being a one-shot thing you can
  // accidentally close forever.
  if (Engine.outpostAvailable(state) && Engine.posEq(hex, state.playerPos)) {
    outpostDismissed = false;
    pushMessage("Back alongside. Trading and refits both open.");
    render();
    return;
  }
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
  // A new run rolls a new seed — same sector, different luck: which
  // Outposts you find and what they're stocked with can genuinely differ
  // from the last time you flew Sector 2. It also starts with whatever
  // loadout is currently selected (see the death-overlay picker) —
  // Standard unless something else has been unlocked and chosen.
  loadSector(0, { runSeed: freshRunSeed(), startingLoadout: selectedLoadout });
  // Arrive like you arrived anywhere else — the flash, then the sector.
  // Cutting straight to a fresh board read like the page had reloaded
  // rather than like a new hull warping in.
  anims.push({ kind: "warp", start: performance.now(), dur: 900 });
  requestAnimationFrame(tickAnims);
}

// Blowing the charges is the loudest thing you can do to your own ship, so
// you watch it happen — on the Systems screen you armed them from, with
// the portrait coming apart under the blast. Same drawExplosion the board
// uses when anything else dies out there; no second explosion renderer.
// Resolves when the fire is out, and only then does the run reset.
const SCUTTLE_MS = 1250;
function playScuttle() {
  return new Promise((resolve) => {
    const fx = scuttleFxEl;
    if (!fx || !fx.getContext) {
      resolve();
      return;
    }
    shipPortraitEl.classList.add("scuttling");
    fx.hidden = false;
    const fxCtx = fx.getContext("2d");
    const boardCtx = ctx;
    const center = { x: fx.width / 2, y: fx.height / 2 };
    // Three staggered blasts — a magazine goes up in pieces, not at once.
    const blasts = [
      { at: 0, off: { x: 0, y: 0 }, size: fx.width * 0.5, parts: makeExplosionParticles(14) },
      { at: 210, off: { x: -fx.width * 0.13, y: fx.height * 0.1 }, size: fx.width * 0.44, parts: makeExplosionParticles(12) },
      { at: 400, off: { x: fx.width * 0.12, y: -fx.height * 0.09 }, size: fx.width * 0.52, parts: makeExplosionParticles(14) },
      { at: 560, off: { x: 0, y: 0 }, size: fx.width * 0.95, parts: makeExplosionParticles(22) },
    ];
    const start = performance.now();
    const step = (now) => {
      const t = now - start;
      fxCtx.clearRect(0, 0, fx.width, fx.height);
      ctx = fxCtx;
      try {
        for (const b of blasts) {
          const p = (t - b.at) / 700;
          if (p < 0 || p > 1) continue;
          drawExplosion({ x: center.x + b.off.x, y: center.y + b.off.y }, p, b.parts, b.size);
        }
      } finally {
        ctx = boardCtx;
      }
      if (t < SCUTTLE_MS) {
        requestAnimationFrame(step);
        return;
      }
      fxCtx.clearRect(0, 0, fx.width, fx.height);
      fx.hidden = true;
      shipPortraitEl.classList.remove("scuttling");
      resolve();
    };
    requestAnimationFrame(step);
  });
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

window.__hhHexCenter = (q, r) => hexToPixel({ q, r });
window.__hhPixelToHex = (x, y) => pixelToHex(x, y); // test hook: the tap conversion, so a round-trip can be proven
window.__hhGetInspected = () => inspectedHex;
// test hook: the chart, so a test can prove a return trip is even armed
window.__hhChart = () => ({ chartIndex, length: sectorHistory.length, arrivedOn, voyageTurns });
// test hook: drive a chart jump the way tapping a star on the Map does,
// so the leave-and-return rules can be exercised end to end
window.__hhJumpToChart = (i) => jumpToChart(i);
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
