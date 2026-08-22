// engine.test.js — headless golden-path test for the design doc's §6 board.
// Plain Node, no framework: run with `node games/hypergolic-hull/engine.test.js`.
//
// Note on coordinates: this no longer matches the design doc's original §6
// coordinates. Once the Impulse Cannon became a forward-facing-only weapon
// (Clubhouse feedback: "it fires at [dead ahead], relative to ship"), the
// doc's tight radius-2 board didn't leave enough room to line up a clean
// shot on one Interceptor before the other closed to attack range — every
// sequence within reach on that board took unavoidable damage before the
// mistake/correct branch was even supposed to begin. This fixture widens to
// radius 3 with the Interceptors spaced further out, which preserves every
// rule the golden path exists to exercise — Sublight, the Impulse Cannon's
// forward-facing auto-fire-before-enemy-phase, Interceptor pursuit AI, the
// mistake/correct damage branch and the
// exit-unlock/level-complete flow — just with room for the new aiming rule
// to actually land a shot.
"use strict";

const assert = require("assert");
const Engine = require("./engine.js");
const HypergolicLevels = require("./levels.js");
const { LEVELS, generateLevel, BOSS_DEPTH } = HypergolicLevels;

function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

// The golden path is a from-scratch fixture exercising every rule in the
// design doc (not literally its §6 coordinates — see the note above).
// levels.js is live game content that evolves with playtest feedback
// (Sector 1 is now a gentler one-Interceptor board), and the engine plays
// any LevelDef, so the rules coverage stays put while the shipped levels
// are free to change. Shipped levels are validated below.
const goldenLevel = {
  id: 999,
  radius: 3,
  playerStart: { q: 0, r: 0 },
  exit: { q: 3, r: 0 },
  outpost: { q: -3, r: 0 },
  enemies: [
    { type: "interceptor", q: -1, r: -2 },
    { type: "interceptor", q: 1, r: 2 },
  ],
  hazards: [],
  exitRule: "all-enemies-dead",
};

// ---- every shipped level must pass engine validation --------------------

for (const level of LEVELS) {
  const s = Engine.createGameState(level); // throws if the level is invalid
  assert.strictEqual(s.status, "playing", `Level ${level.id} should start playable`);
  assert.strictEqual(s.exitUnlocked, true, `Level ${level.id}: the Warp Gate is always online — clearing enemies is optional, never required to leave`);
}
// Sector 1 used to be a no-op "learn to move, no enemies" board — cut per
// Clubhouse feedback ("Level one is pointless"). The campaign now opens
// directly on the Autocannon lesson.
assert.ok(LEVELS.length >= 4, "expected the four-sector tutorial campaign");
assert.deepStrictEqual(LEVELS[0].actions, ["sublight", "autocannon"], "Sector 1 teaches Sublight + the Autocannon together");
assert.strictEqual(LEVELS[0].enemies.length, 1, "Sector 1 has exactly one Interceptor to learn the Autocannon on");
for (let i = 1; i < LEVELS.length; i++) {
  const prev = LEVELS[i - 1].actions || Engine.ALL_ACTIONS;
  const cur = LEVELS[i].actions || Engine.ALL_ACTIONS;
  assert.ok(
    prev.every((a) => cur.includes(a)) && cur.length > prev.length - 1,
    `Sector ${LEVELS[i].id} must keep every action the previous sector unlocked`
  );
}
assert.ok(
  LEVELS.every((l) => l.enemies.every((e) => Engine.hexDistance(l.playerStart, e) >= 2)),
  "the player never starts next to an enemy"
);
const lastBoard = LEVELS[LEVELS.length - 1].board;
assert.ok(lastBoard.rows > lastBoard.cols, "the campaign grows into taller-than-wide Hoplite-style boards");

// ---- action gating: locked actions throw and offer no targets -----------

const tutorialState = Engine.createGameState(LEVELS[1]); // sublight + ramming only

// ---- rect boards: bounds, edge push-kills, and animation events ----------

const rectLevel = {
  id: 996,
  name: "rect fixture",
  board: { type: "rect", cols: 4, rows: 5 },
  playerStart: { q: 2, r: 3 }, // column 2
  exit: { q: 2, r: -1 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 3, r: 1 }], // column 3: the rightmost column
  hazards: [],
  exitRule: "all-enemies-dead",
  actions: ["sublight", "autocannon"],
};
const rectState = Engine.createGameState(rectLevel);
assert.strictEqual(rectState.boardHexes.length, 20, "4x5 rect board has 20 hexes");
// Flat-top rect boards are offset by COLUMN, not row (see buildBoardHexes):
// column c spans r = -floor(c/2) .. rows-1-floor(c/2).
assert.ok(Engine.onBoard(rectState, { q: 0, r: 0 }) && Engine.onBoard(rectState, { q: 0, r: 4 }), "column 0 spans r=0..4");
assert.ok(!Engine.onBoard(rectState, { q: 0, r: 5 }), "column 0 is only 5 hexes tall");
assert.ok(!Engine.onBoard(rectState, { q: 4, r: 0 }), "q=4 is past the board's 4-column width");
assert.ok(
  Engine.onBoard(rectState, { q: 3, r: -1 }) && !Engine.onBoard(rectState, { q: 3, r: -2 }),
  "column 3 (rightmost) is shifted up by one row, per the flat-top column stagger"
);

// Attacks and damage emit events too (drives the lunge + hit-flash animations).
// Impulse Cannon locked out (actions: ["sublight"]) so the interceptor survives
// to strike back instead of being auto-killed on approach.
const meleeLevel = {
  id: 995,
  name: "melee fixture",
  board: { type: "rect", cols: 4, rows: 5 },
  playerStart: { q: 2, r: 3 },
  exit: { q: 2, r: -1 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 1, r: 2 }],
  hazards: [],
  exitRule: "all-enemies-dead",
  actions: ["sublight"],
};
const meleeState = Engine.createGameState(meleeLevel);
Engine.applySublight(meleeState, { q: 2, r: 2 }); // step adjacent (straight up, direction 2) — 1 AP, no reaction yet
assert.ok(
  meleeState.events.some((e) => e.type === "playerMove" && e.to.q === 2 && e.to.r === 2),
  "player moves emit a playerMove event (drives the flight animation)"
);
assert.strictEqual(meleeState.hull, Engine.START_HULL - 1, "a strike costs 1 Hull — no longer instant death");
assert.strictEqual(meleeState.status, "playing", "the run survives a single hit");
assert.ok(meleeState.events.some((e) => e.type === "attack"), "attacks emit an attack event");
assert.ok(meleeState.events.some((e) => e.type === "damage"), "damage emits a damage event");

// The killing blow still ends the run and emits playerDeath — it just takes
// three hits now instead of one.
const deathState = Engine.createGameState(meleeLevel);
deathState.hull = 1;
Engine.applySublight(deathState, { q: 2, r: 2 });
assert.strictEqual(deathState.status, "lost", "the final hit still ends the run");
assert.ok(deathState.events.some((e) => e.type === "playerDeath"), "lethal damage emits a playerDeath event");

// ---- findPath: quickest-route preview --------------------------------------

const pathState = Engine.createGameState({
  id: 994,
  name: "path fixture",
  board: { type: "rect", cols: 4, rows: 5 },
  playerStart: { q: 2, r: 3 },
  exit: { q: 2, r: -1 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 2, r: 1 }],
  hazards: [],
  exitRule: "all-enemies-dead",
});
const route = Engine.findPath(pathState, pathState.playerPos, { q: 2, r: -1 });
assert.ok(route, "a route to the far corner exists");
assert.deepStrictEqual(route[0], { q: 2, r: 3 }, "the route starts at the player");
assert.deepStrictEqual(route[route.length - 1], { q: 2, r: -1 }, "the route ends at the target");
for (let i = 1; i < route.length; i++) {
  assert.strictEqual(Engine.isAdjacent(route[i - 1], route[i]), true, "every route step is one hex");
  assert.ok(!Engine.posEq(route[i], { q: 2, r: 1 }), "the route detours around the enemy");
}
assert.strictEqual(
  Engine.findPath(pathState, pathState.playerPos, { q: 2, r: 1 }),
  null,
  "an enemy-occupied hex is not a routable destination"
);
assert.strictEqual(
  Engine.findPath(pathState, pathState.playerPos, { q: 9, r: 9 }),
  null,
  "off-board hexes are not routable"
);

// ---- the golden path, one action per round ------------------------------
// One action IS the round ("maybe you could just do one thing, and that
// is a turn") — for the flagship and every enemy alike. Your action
// resolves immediately, then the enemy phase runs: a FIRE kill lands
// before the target ever gets its phase, and a chaser spends its one
// point closing OR firing, never both. The AP plumbing stays underneath
// (see the bookkeeping section below) for a future re-expansion.

let state = Engine.createGameState(goldenLevel);
assert.strictEqual(state.hull, Engine.START_HULL, "the flagship starts a run at full Hull");
assert.strictEqual(state.energy, 6, "and a full Energy budget");
assert.strictEqual(state.ap, 1, "one action per round — the AP counter idles at 1");
assert.strictEqual(state.maxAp, 1, "1 is the standard budget now (the plumbing supports more)");
assert.strictEqual(Engine.livingEnemies(state).length, 2);
assert.strictEqual(state.exitUnlocked, true, "the Warp Gate is online from the start — clearing enemies is optional, for salvage only");

// A 1-AP chaser moves OR fires — its danger zone is exactly its weapon's
// current reach, no move+fire projection. (An Interceptor's Autocannon
// reaches two down its lanes, so distance-2 hexes ON those lanes are
// genuinely threatened; three is where the projection would start.)
const openingThreats = Engine.computeThreatHexes(state);
assert.ok(
  Engine.livingEnemies(state).every((e) =>
    state.boardHexes
      .filter((h) => Engine.hexDistance(h, e) === 3)
      .every((h) => !openingThreats.has(Engine.hexKey(h)))
  ),
  "the threat overlay marks only a chaser's actual weapon reach — no move+fire projection at 1 AP"
);

let fireActions = 0;
let guard = 0;
while (state.status === "playing" && Engine.livingEnemies(state).length > 0 && guard++ < 60) {
  const living = Engine.livingEnemies(state);
  const contact = living.find((e) => Engine.isAdjacent(e, state.playerPos));
  if (contact) {
    const before = living.length;
    // The Autocannon only covers the three hexes off the nose, so a shot
    // means pointing at something first — exactly what tapping a hostile
    // does in the UI (faceEnemyIfPossible).
    Engine.setFacing(state, Engine.directionIndex(state.playerPos, contact));
    Engine.applyFire(state); // resolves in YOUR phase — the dead don't get one of their own
    fireActions++;
    assert.ok(Engine.livingEnemies(state).length < before, "a point-blank FIRE volley kills a chaser (the single-target Autocannon takes exactly one)");
    continue;
  }
  // Stalk: step toward the nearest survivor, but never END a round inside
  // anything's reach — the chaser closes the last hex itself, and then
  // YOUR next action is the kill.
  const prey = living.reduce((best, e) => {
    const d = Engine.hexDistance(state.playerPos, e);
    return !best || d < best.d ? { e, d } : best;
  }, null);
  const candidates = Engine.legalSublightTargets(state).filter((cand) =>
    living.every((e) => Engine.hexDistance(cand, e) > 1)
  );
  if (!candidates.length) {
    Engine.applyEndTurn(state); // nowhere safe to step — hold position instead
    continue;
  }
  const step = candidates.reduce((best, cand) => {
    const d = Engine.hexDistance(cand, prey.e);
    return !best || d < best.d ? { to: cand, d } : best;
  }, null);
  Engine.applySublight(state, step.to);
}
assert.strictEqual(Engine.livingEnemies(state).length, 0, "both Interceptors die to FIRE volleys");
assert.ok(fireActions >= 1, "at least one round was spent on the FIRE action");
// The single-target Autocannon means getting double-teamed costs a hit (one
// dies, the other shoots) — perfect play keeps it to at most one.
assert.ok(state.hull >= 2, "the stalking line survives comfortably — at most one double-team hit");
assert.strictEqual(state.status, "playing");

// ---- single-target base weapon: the shot goes ONE place -----------------
// ("change base weapon to only attack one place") — with two contacts
// adjacent at once, the Autocannon strikes the target-locked one and the
// other survives untouched.
const singleLevel = {
  id: 983,
  radius: 2,
  playerStart: { q: 0, r: 0 },
  exit: { q: 2, r: 0 },
  outpost: null,
  enemies: [
    { type: "interceptor", q: 0, r: -2 },
    { type: "interceptor", q: -2, r: 0 },
  ],
  hazards: [],
  exitRule: "all-enemies-dead",
};
const singleState = Engine.createGameState(singleLevel);
singleState.enemies[0].q = 0;
singleState.enemies[0].r = -1; // adjacent, up
singleState.enemies[1].q = -1;
singleState.enemies[1].r = 0; // adjacent, left
Engine.setFacing(singleState, Engine.directionIndex(singleState.playerPos, singleState.enemies[1])); // the Autocannon has to point at it
Engine.applyFire(singleState, "e1"); // lock the SECOND contact
assert.strictEqual(singleState.enemies.find((e) => e.id === "e1").alive, false, "the locked contact takes the whole shot");
assert.strictEqual(singleState.enemies.find((e) => e.id === "e0").alive, true, "the other adjacent contact is untouched — single target means single target");
const singleState2 = Engine.createGameState(singleLevel);
singleState2.enemies[0].q = 0;
singleState2.enemies[0].r = -1;
Engine.applyFire(singleState2); // no lock: the shot picks the first in reach
assert.strictEqual(
  singleState2.enemies.filter((e) => !e.alive).length,
  1,
  "with no lock, a single-target weapon still fires exactly one shot at one contact"
);

// ---- the mistake, shown directly: ending your turn in a chaser's reach --
// The position your action leaves you on is the one the enemy phase
// punishes — move to a hex still beside a charged chaser and its shot
// lands the moment your turn commits.
const mistakeState = Engine.createGameState(goldenLevel);
mistakeState.enemies[0].q = mistakeState.playerPos.q;
mistakeState.enemies[0].r = mistakeState.playerPos.r - 1; // adjacent, directly up
const stillInReach = Engine.legalSublightTargets(mistakeState).find((to) => Engine.isAdjacent(to, mistakeState.enemies[0]));
assert.ok(stillInReach, "expected a destination still inside the chaser's reach");
Engine.applySublight(mistakeState, stillInReach);
assert.strictEqual(mistakeState.hull, Engine.START_HULL - 1, "moving while engaged eats the strike — the turn went to repositioning, not defense");
assert.strictEqual(mistakeState.enemies[0].alive, true, "and moving killed nothing — shooting is its own action");

// ---- AP bookkeeping: one action commits the round; plumbing is intact ---
const apState = Engine.createGameState(goldenLevel);
apState.enemies.forEach((e) => (e.alive = false)); // quiet board — this tests the counter, not combat
Engine.applySublight(apState, Engine.legalSublightTargets(apState)[0]);
assert.strictEqual(apState.turnCount, 1, "a single action runs the enemy phase — one action IS the round");
assert.strictEqual(apState.ap, apState.maxAp, "and the budget refills for the new round");
// Hold position (tap-tap on your own ship in the UI) passes the round.
const turnBeforePass = apState.turnCount;
Engine.applyEndTurn(apState);
assert.strictEqual(apState.turnCount, turnBeforePass + 1, "holding position commits the round immediately");
assert.strictEqual(apState.ap, apState.maxAp, "and the next round starts fresh");
// maxAp carries across sectors — a future "+1 AP" upgrade (or putting
// 2-AP rounds back) is pure data, no new plumbing.
const apCarryState = Engine.createGameState(goldenLevel, { maxAp: 2 });
assert.strictEqual(apCarryState.maxAp, 2, "maxAp carries via carryOver — re-expansion plumbing is already in place");
assert.strictEqual(apCarryState.ap, 2, "and the round starts with the full carried budget");
// With a 2-AP carryOver, free-form spending still works exactly as built.
apCarryState.enemies.forEach((e) => (e.alive = false));
apCarryState.energy = 1;
Engine.applyRecharge(apCarryState);
assert.strictEqual(apCarryState.turnCount, 0, "at 2 AP, the round isn't over after one action");
Engine.applyRecharge(apCarryState);
assert.strictEqual(apCarryState.turnCount, 1, "two actions = one full round");
assert.strictEqual(apCarryState.energy, 1 + 2 * Engine.RECHARGE_ENERGY_GAIN, "both AP can go to the same action");

// ---- RECHARGE: the only way Energy comes back mid-sector ----------------
const rechargeProbe = Engine.createGameState(goldenLevel);
rechargeProbe.energy = 1;
Engine.applyRecharge(rechargeProbe);
assert.strictEqual(rechargeProbe.energy, 1 + Engine.RECHARGE_ENERGY_GAIN, "RECHARGE adds its listed Energy");
assert.ok(rechargeProbe.events.some((e) => e.type === "energyGain"), "and emits an energyGain event for the UI float");
rechargeProbe.energy = rechargeProbe.maxEnergy;
assert.throws(() => Engine.applyRecharge(rechargeProbe), /already full/, "RECHARGE refuses at full Energy — no wasted turns");
// A MOVE ticks the turn counter but never regenerates Energy anymore.
const drained = Engine.createGameState(goldenLevel);
drained.enemies.forEach((e) => (e.alive = false)); // clear the board so the walk below is quiet
drained.energy = 2;
Engine.applySublight(drained, Engine.legalSublightTargets(drained)[0]);
assert.strictEqual(drained.energy, 2, "no passive Energy regen — the budget only comes back via RECHARGE or a warp jump");
// FIRE with nothing in range refuses instead of wasting the turn.
assert.throws(() => Engine.applyFire(drained), /Nothing in arc/, "FIRE refuses when no fitted weapon bears on anything");

const correctState = state; // cleared board, full hull — carry on to the gate

// ---- step 4: the gate was online the whole time; walking onto it wins ----

assert.strictEqual(correctState.exitUnlocked, true, "the Warp Gate stays online after clearing the last enemy, same as before");

while (!Engine.posEq(correctState.playerPos, correctState.exitPos)) {
  const step = Engine.legalSublightTargets(correctState).reduce((best, cand) => {
    const d = Engine.hexDistance(cand, correctState.exitPos);
    return !best || d < best.d ? { to: cand, d } : best;
  }, null);
  assert.ok(step, "expected a legal path toward the Warp Gate");
  Engine.applySublight(correctState, step.to);
}

assert.strictEqual(correctState.status, "won", "reaching the unlocked Warp Gate should complete the level");

// ---- Weapon systems: stat-driven, armed, fired on command ---------------
// (Turn Model v2: weapons NEVER fire on their own. FIRE is the action —
// every armed weapon volleys, in initiative order. Toggles on the Systems
// screen choose what's armed; Target Lock/warpdrive-off gates movement
// for aiming.)

const weaponLevel = {
  id: 993,
  name: "weapon fixture",
  board: { type: "rect", cols: 4, rows: 5 },
  playerStart: { q: 2, r: 3 },
  exit: { q: 2, r: -1 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 1, r: 2 }],
  hazards: [],
  exitRule: "all-enemies-dead",
};

// A move never fires anything — even point-blank.
let weaponState = Engine.createGameState(weaponLevel);
assert.strictEqual(weaponState.enemies[0].hp, 1, "enemies start at 1 HP");
// Derived rather than spelled out: the point is that exactly ONE gun reads
// armed and it's the one in the hold, not that the registry has a
// particular membership on the day this was written.
assert.strictEqual(weaponState.systems.warpdrive, true, "the warp drive is always available");
assert.deepStrictEqual(
  Engine.WEAPON_SYSTEM_KEYS.filter((k) => weaponState.systems[k]),
  ["autocannon"],
  "arming derives from the Hold — only the installed Autocannon reads armed"
);
assert.deepStrictEqual(
  Object.keys(weaponState.systems).slice().sort(),
  ["warpdrive", ...Engine.WEAPON_SYSTEM_KEYS].sort(),
  "and every gun in the registry has a flag, so none is silently unarmable"
);
Engine.applySublight(weaponState, { q: 2, r: 2 }); // steps adjacent to the interceptor
assert.strictEqual(weaponState.enemies[0].alive, true, "moving fires NOTHING — shooting is its own action now");

// FIRE volleys the armed Autocannon and kills it.
Engine.applyFire(weaponState);
assert.strictEqual(weaponState.enemies[0].alive, false, "FIRE kills the adjacent Interceptor");
assert.ok(weaponState.events.some((e) => e.type === "kill"), "the volley emits a kill event");
assert.ok(
  weaponState.events.some((e) => e.type === "kill" && e.source === "weapon"),
  "the kill is tagged source:weapon — the renderer uses this to aim the flagship at it"
);
assert.deepStrictEqual(weaponState.playerPos, { q: 2, r: 2 }, "FIRE never moves the flagship");

// With the Autocannon pulled out of the grid, FIRE has nothing to shoot with.
weaponState = Engine.createGameState(weaponLevel);
const autocannonIdx = weaponState.hold.items.findIndex((it) => it.id === "autocannon");
weaponState.hold.cargo.push(weaponState.hold.items.splice(autocannonIdx, 1)[0].id);
Engine.syncHoldDerived(weaponState);
weaponState.playerPos = { q: 2, r: 2 };
assert.throws(() => Engine.applyFire(weaponState), /Nothing in arc/, "FIRE refuses with every weapon uninstalled");

// No drive in the grid = the ship doesn't move. Equipment is capability.
weaponState = Engine.createGameState(weaponLevel);
const driveIdx = weaponState.hold.items.findIndex((it) => it.id === "sublightDrive");
weaponState.hold.cargo.push(weaponState.hold.items.splice(driveIdx, 1)[0].id);
Engine.syncHoldDerived(weaponState);
assert.throws(
  () => Engine.applySublight(weaponState, { q: 2, r: 2 }),
  /No drive fitted/,
  "movement is blocked with no drive in the Hold"
);

// Re-aiming (no move, no turn) works regardless of what's installed.
const facingBefore = weaponState.facing;
Engine.setFacing(weaponState, (facingBefore + 2) % 6);
assert.strictEqual(weaponState.facing, (facingBefore + 2) % 6, "setFacing re-aims the flagship");
assert.deepStrictEqual(weaponState.playerPos, weaponLevel.playerStart, "re-aiming never moves the flagship");
assert.strictEqual(weaponState.turnCount, 0, "re-aiming doesn't consume a turn — no enemy phase runs");
assert.throws(() => Engine.setFacing(weaponState, 6), /Invalid facing/, "facing must be one of the 6 hex directions");

// The price a shelf rolled for THIS visit, which is what a purchase
// actually charges (see applyOutpostPurchase) — the pool's `cost` is only
// the fallback. Reading the flat cost meant these fixtures broke, with a
// confusing "the full cost is spent" failure, the moment anything changed
// the offer pool and re-rolled the prices.
function priceOf(state, id) {
  return (state.outpostOfferPrices && state.outpostOfferPrices[id]) ?? Engine.OUTPOST_OFFER_POOL.find((o) => o.id === id).cost;
}

// ---- The Hold: "a grid drag and drop for different sized/shaped items" --
// The ship's internals are a grid; every item is a shaped tile and its
// footprint is the equip cost. What's INSTALLED is what works; cargo is
// inert. Rearranging is free but dock-gated.
// Derived from the registry rather than retyped: every WEAPONS entry has
// to be a system key, or the renderer's arming loop silently skips a gun
// you own (which is exactly how the Mortar and the Lancer once shipped
// invisible). Asserting the LIST by hand meant adding a weapon broke this
// line before it broke anything real.
assert.deepStrictEqual(
  Engine.WEAPON_SYSTEM_KEYS.slice().sort(),
  Object.keys(Engine.WEAPONS).sort(),
  "every weapon in the registry is a system key — nothing owned is unfireable"
);
// "Anything an enemy can use, a player can get." Every gun in the game is
// either the one you start with or something a station sells — no
// enemy-only hardware, ever.
for (const key of Engine.WEAPON_SYSTEM_KEYS) {
  if (key === "autocannon") continue; // you begin with it
  assert.ok(
    Engine.OUTPOST_OFFER_POOL.some((o) => o.id === key),
    `${key} is fitted to something out there, so it has to be buyable — nothing is enemy-only`
  );
}

let holdState = Engine.createGameState(weaponLevel);
assert.strictEqual(holdState.hold.cols, 5, "the starter hold is 5 cells wide");
assert.strictEqual(holdState.hold.rows, 6, "and 6 tall");
assert.ok(holdState.hold.blocked.length > 0, "with cells masked OUT — the grid is the shape of the ship, not a rectangle");
assert.strictEqual(
  Engine.holdCanPlace(holdState.hold, "autocannon", 0, 0),
  false,
  "nothing can be installed outside the hull silhouette"
);
assert.deepStrictEqual(
  holdState.hold.items.map((it) => it.id).sort(),
  ["autocannon", "reactorCore", "scanner", "sublightDrive"],
  "the starter kit: Reactor Core + Sublight Drive + Scanner Array + Autocannon, all placed in the grid"
);
// The Scanner Array is hardware too ("the scanner should itself be a
// small item") — pull it and the scannerInstalled flag dies with it.
assert.strictEqual(holdState.scannerInstalled, true, "a fresh ship has its Scanner Array powered");
{
  const scanIdx = holdState.hold.items.findIndex((it) => it.id === "scanner");
  holdState.hold.cargo.push(holdState.hold.items.splice(scanIdx, 1)[0].id);
  Engine.syncHoldDerived(holdState);
  assert.strictEqual(holdState.scannerInstalled, false, "a stowed Scanner Array powers nothing — the ship flies blind");
}
assert.strictEqual(Engine.EQUIPMENT.reactorCore.w * Engine.EQUIPMENT.reactorCore.h, 4, "the Reactor Core is a 2x2 tile");
assert.strictEqual(Engine.EQUIPMENT.sublightDrive.h, 3, "the Sublight Drive is a 1x3 tile");
// Placement rules: bounds and overlaps are rejected.
const reactorIdx = holdState.hold.items.findIndex((it) => it.id === "reactorCore");
const reactorTile = holdState.hold.items[reactorIdx];
assert.strictEqual(
  Engine.holdCanPlace(holdState.hold, "autocannon", reactorTile.x, reactorTile.y),
  false,
  "a tile can't sit on top of another"
);
assert.strictEqual(Engine.holdCanPlace(holdState.hold, "reactorCore", 4, 3), false, "a tile can't hang off the grid edge");

// Rearranging is DOCK-GATED ("it doesn't make sense to change mid route").
assert.throws(
  () => Engine.stowToCargo(holdState, reactorIdx),
  /Refits need a dock/,
  "no rearranging mid-flight"
);

const holdOutpostLevel = { ...weaponLevel, id: 995, playerStart: { q: 3, r: 3 }, outpost: { q: 2, r: 3 }, enemies: [{ type: "interceptor", q: 1, r: 0 }] };
let dockState = Engine.createGameState(holdOutpostLevel);
dockState.playerPos = { q: 2, r: 3 }; // docked
const turnsBeforeRefit = dockState.turnCount;
const dockReactorIdx = dockState.hold.items.findIndex((it) => it.id === "reactorCore");
Engine.stowToCargo(dockState, dockReactorIdx);
assert.strictEqual(dockState.turnCount, turnsBeforeRefit, "refits at dock are free — no turn spent");
assert.ok(dockState.hold.cargo.includes("reactorCore"), "the stowed reactor sits in cargo");
assert.throws(() => Engine.applyRecharge(dockState), /No reactor installed/, "a stowed reactor powers NOTHING — cargo is inert");
{
  const cargoIdx = dockState.hold.cargo.indexOf("reactorCore");
  let spot = null;
  for (let y = 0; y < dockState.hold.rows && !spot; y++) {
    for (let x = 0; x < dockState.hold.cols && !spot; x++) {
      if (Engine.holdCanPlace(dockState.hold, "reactorCore", x, y)) spot = { x, y };
    }
  }
  Engine.installFromCargo(dockState, cargoIdx, spot.x, spot.y);
}
assert.ok(dockState.hold.items.some((it) => it.id === "reactorCore"), "installing from cargo puts the tile back in the grid");
dockState.energy = 0;
Engine.applyRecharge(dockState); // must not throw — capability restored with the hardware
assert.ok(dockState.energy > 0, "and the reactor cycles again");

// Buying with no room left lands in cargo; a Hold Expansion adds a row.
// The sale is NOT refused — the shelf is randomized, so refusing would let
// a whole run go by with a gun permanently unbuyable. It's announced
// instead: outpostOffers() reports fits:false and the purchase logs where
// the crate actually went.
dockState.outpostOfferIds = ["repair", "shield", "hardpoint"];
dockState.salvage = 50;
while (true) {
  const before = dockState.hold.items.length;
  Engine.applyOutpostPurchase(dockState, "shield");
  dockState.outpostOfferIds.push("shield"); // re-stock for the test loop
  if (dockState.hold.items.length === before) break; // this one didn't fit — it went to cargo
}
assert.ok(dockState.hold.cargo.includes("shieldGenerator"), "a purchase that doesn't fit the grid waits in cargo");
assert.ok(
  dockState.log.some((line) => /stowed in cargo/.test(line)),
  "and it says so — a crate going inert is never silent"
);
assert.strictEqual(
  Engine.outpostOffers(dockState).find((o) => o.id === "shield").fits,
  false,
  "the shelf can warn about it before you pay, too"
);
const rowsBefore = dockState.hold.rows;
dockState.salvage = 20;
Engine.applyOutpostPurchase(dockState, "hardpoint");
assert.strictEqual(dockState.hold.rows, rowsBefore + 1, "Hold Expansion grows the grid by a row");
const shieldsBeforeInstall = dockState.maxShields;
const cargoGenIdx = dockState.hold.cargo.indexOf("shieldGenerator");
let placed = false;
for (let y = 0; y < dockState.hold.rows && !placed; y++) {
  for (let x = 0; x < dockState.hold.cols && !placed; x++) {
    if (Engine.holdCanPlace(dockState.hold, "shieldGenerator", x, y)) {
      Engine.installFromCargo(dockState, cargoGenIdx, x, y);
      placed = true;
    }
  }
}
assert.ok(placed, "the new row makes room for the waiting generator");
assert.strictEqual(dockState.maxShields, shieldsBeforeInstall + 1, "the freshly-installed generator adds live shield capacity");

// Reactor Upgrade raises the Energy cap (and fills the new capacity
// immediately, same as Reinforce Hull).
dockState.outpostOfferIds = ["repair", "reactor"];
dockState.salvage = 12;
const maxEnergyBefore = dockState.maxEnergy;
const energyBeforeUpgrade = dockState.energy;
Engine.applyOutpostPurchase(dockState, "reactor");
assert.strictEqual(dockState.maxEnergy, maxEnergyBefore + 1, "Reactor Upgrade raises max Energy by 1");
assert.strictEqual(dockState.energy, energyBeforeUpgrade + 1, "and the new capacity arrives charged");

// The whole hold carries across sectors — the ship IS its hold.
const holdCarryState = Engine.createGameState(
  { ...weaponLevel, id: 994 },
  { hasPrevious: true, hold: dockState.hold, maxEnergy: dockState.maxEnergy }
);
assert.deepStrictEqual(holdCarryState.hold, dockState.hold, "the hold carries whole via carryOver");
assert.strictEqual(holdCarryState.maxEnergy, maxEnergyBefore + 1, "maxEnergy carries across sectors");

// Enemies fight through the same WEAPONS/ENEMY_TYPES stat blocks as the
// flagship — not hardcoded adjacency/damage constants — so the threat
// overlay, attack range, and damage-per-hit are all read off the
// Interceptor's own weapon rather than special-cased.
assert.deepStrictEqual(
  Engine.ENEMY_TYPES.interceptor.ship.weapons,
  [Engine.WEAPONS.autocannon],
  "an Interceptor shoots you with the very Autocannon you fly with — no enemy-only gear"
);
const interceptorPos = { q: 0, r: 0 };
const interceptorWeapon = Engine.ENEMY_TYPES.interceptor.ship.weapons[0];
// A chaser turns its nose toward the flagship (the board draws it doing
// exactly that), so its forward-arc gun aims the same way yours does.
const facedState = Engine.createGameState(goldenLevel);
facedState.enemies[0].q = facedState.playerPos.q;
facedState.enemies[0].r = facedState.playerPos.r - 1; // adjacent
assert.strictEqual(
  Engine.enemyFacing(facedState, facedState.enemies[0]),
  Engine.directionIndex(facedState.enemies[0], facedState.playerPos),
  "a hostile's facing is simply 'toward you'"
);
// And it still points the right way from across the board, where there is
// no single adjacency direction to read.
facedState.enemies[0].r = facedState.playerPos.r - 4;
const farFacing = Engine.enemyFacing(facedState, facedState.enemies[0]);
assert.ok(
  Engine.hexDistance(Engine.neighbor(facedState.enemies[0], farFacing), facedState.playerPos) <
    Engine.hexDistance(facedState.enemies[0], facedState.playerPos),
  "from range, its nose still points at the hex that closes the gap"
);
// The contact gun covers all six hexes touching the hull, on both sides of
// the board. It was a three-hex wedge off the nose, which gave every chaser
// in the game a blind side you could stand in for free — and Hoplite's
// footman, the thing this class IS, "can only attack adjacent tiles" with no
// arc at all. Facing stops mattering at contact, which is also why Hoplite
// has no facing.
const aimedHexes = Engine.weaponHexes(interceptorPos, 0, interceptorWeapon);
assert.strictEqual(aimedHexes.length, 6, "its Autocannon covers every hex touching it — no blind side");
assert.ok(
  aimedHexes.every((h) => Engine.hexDistance(interceptorPos, h) === 1),
  "and nothing further out than contact"
);
assert.deepStrictEqual(
  Engine.weaponHexes(interceptorPos, 0, interceptorWeapon).map(Engine.hexKey).sort(),
  Engine.weaponHexes(interceptorPos, 3, interceptorWeapon).map(Engine.hexKey).sort(),
  "facing makes no difference to it at all"
);
assert.ok(!aimedHexes.some((h) => Engine.posEq(h, interceptorPos)), "a weapon never threatens its own hex");
assert.ok(
  aimedHexes.every((h) => Engine.hexDistance(h, interceptorPos) === 1),
  "and it has to be in contact to use it — reach is a thing you BUY"
);

// The Autocannon covers CONTACT, all the way round. It was a wedge off the
// nose, which meant every chaser in the game had three hexes behind it you
// could stand in for free — and the class carrying it is a footman, which
// "can only attack adjacent tiles" with no arc anywhere in the rule. What
// you buy past it is reach and coverage-at-range, not coverage at contact.
const pulseCannon = Engine.WEAPONS.autocannon;
const autocannonHexes = Engine.weaponHexes(interceptorPos, 0, pulseCannon);
assert.strictEqual(autocannonHexes.length, 6, "the Autocannon covers every hex touching the hull");
assert.ok(
  autocannonHexes.every((h) => Engine.hexDistance(h, interceptorPos) === 1),
  "every hex it reaches is exactly one out — and nothing further"
);
// No blind side, and no cost to turning: facing is simply not part of it.
assert.deepStrictEqual(
  autocannonHexes.map(Engine.hexKey).sort(),
  Engine.weaponHexes(interceptorPos, 3, pulseCannon).map(Engine.hexKey).sort(),
  "there is no behind — the same six hexes whichever way it points"
);
// The Flak Burst is what you buy to cover the whole ring at once.
assert.deepStrictEqual(
  Engine.WEAPONS.flakBurst.pattern.slice().sort(),
  [0, 1, 2, 3, 4, 5],
  "the Flak Burst IS the omnidirectional answer — every direction, every adjacent contact"
);

// ---- new enemy classes: Cruiser (heavy) and Sentry (stationary turret) -----
// Variety beyond the lone Interceptor: a Cruiser takes two hits, and a Sentry
// never moves but its beam reaches two hexes in every direction.
// Hull is no longer the difficulty lever anywhere in the roster. Hoplite
// has NO hp variance — every demon dies in one hit — and toughness measured
// out badly here twice: a 3-Hull Carrier took good-play wins from 19/40 to
// zero, and the 2-Hull Cruiser cost exactly one hull in 40 of 40 runs.
// Extra hull doesn't add difficulty, it adds DURATION, and duration is what
// the rest of the board converts into damage. What a class is now lives in
// the shape it covers and the rhythm it fires on.
assert.strictEqual(Engine.ENEMY_TYPES.cruiser.maxHull, 1, "the Cruiser dies to one shot, like almost everything else");
assert.strictEqual(Engine.ENEMY_TYPES.interceptor.maxHull, 1, "the Interceptor is still a 1-Hull glass cannon");
// Glass: it denies ground and dies to one shot. At 2 Hull a pair of
// them walled a whole board — the question a Sentry asks should be "can
// you reach it", not "can you out-trade it".
assert.strictEqual(Engine.ENEMY_TYPES.sentry.maxHull, 1, "the Sentry is a ONE-Hull emplacement");
assert.strictEqual(Engine.ENEMY_TYPES.sentry.ship.hasDrive, false, "the Sentry never chases — there is no drive in it");
assert.deepStrictEqual(Engine.ENEMY_TYPES.sentry.ship.weapons, [Engine.WEAPONS.arcBeam], "the Sentry fires the Arc Beam");
assert.strictEqual(Engine.WEAPONS.arcBeam.range, 2, "the Arc Beam reaches two hexes");

const sentryHexes = Engine.weaponHexes({ q: 0, r: 0 }, 0, Engine.WEAPONS.arcBeam);
// The SHELL at exactly two — the whole ring, off-axis hexes included, and
// a hole in the middle. Reach is bought, not given: this gun out-ranges a
// chaser and then cannot touch it once it closes to contact. (It used to
// cover everything within two, which made it a strict upgrade on the Flak
// Burst and made "which gun" a non-question.)
assert.strictEqual(sentryHexes.length, 12, "the Arc Beam covers the full ring at two — every hex, not just the axes");
assert.ok(
  sentryHexes.every((h) => Engine.hexDistance(h, { q: 0, r: 0 }) === 2),
  "and NOTHING closer — the hole in the middle is the point of it"
);
assert.ok(
  sentryHexes.some((h) => Engine.hexDistance(h, { q: 0, r: 0 }) === 2 && h.q !== 0 && h.r !== 0),
  "including the off-axis ones"
);

// Behavior: a Sentry holds position while the player is out of range, then
// fires the instant the player steps into its 2-hex ring (costs a Hull).
const sentryLevel = {
  id: 993,
  name: "sentry fixture",
  board: { type: "rect", cols: 5, rows: 9 },
  playerStart: { q: 2, r: 5 }, // same column as the sentry, distance 4 — straight up (direction 2) closes in one step at a time
  exit: { q: 2, r: -1 },
  outpost: null,
  enemies: [{ type: "sentry", q: 2, r: 1 }],
  hazards: [],
  exitRule: "all-enemies-dead",
  actions: ["sublight"], // no flagship weapons, so the Sentry lives to fire back
};
const sentryState = Engine.createGameState(sentryLevel);
// A board is guaranteed to have a lane past its fixed guns (see
// openALane), which can move an emplacement off a choke point — so read
// where this one actually ended up rather than assuming the authored hex.
const sentryStart = { q: sentryState.enemies[0].q, r: sentryState.enemies[0].r };
const stepAt = (dist) =>
  sentryState.boardHexes.find(
    (h) =>
      Engine.hexDistance(h, sentryStart) === dist &&
      Engine.legalSublightTargets(sentryState).some((l) => Engine.posEq(l, h))
  );
sentryState.playerPos = sentryState.boardHexes.find((h) => Engine.hexDistance(h, sentryStart) === 4);
const safeStep = stepAt(3);
Engine.applySublight(sentryState, safeStep); // distance 3 — still out of the beam
assert.strictEqual(sentryState.status, "playing", "stepping to distance 3 is safe — the beam only reaches 2");
assert.deepStrictEqual(
  { q: sentryState.enemies[0].q, r: sentryState.enemies[0].r },
  sentryStart,
  "the Sentry does not move to chase — it holds its hex"
);
const hullBeforeBeam = sentryState.hull;
Engine.applySublight(sentryState, stepAt(2)); // into the beam
assert.strictEqual(sentryState.hull, hullBeforeBeam - 1, "entering the Sentry's 2-hex ring takes a hit");
assert.ok(sentryState.events.some((e) => e.type === "attack"), "the Sentry's shot emits an attack event");

// ---- Railgun Destroyer: the long gun, and it FLIES. It was bolted down
// for no reason its own hull ever supported — engine bells, fins, and the
// word "destroyer" in the name. What keeps it fair is the hardware: two big
// banks on one small generator, so its slug is telegraphed by a bus you can
// watch filling, and one action a round means it can reposition or fire,
// never both.
assert.strictEqual(Engine.ENEMY_TYPES.railgun.maxHull, 1, "the Railgun is glass — its reach is the threat, not its hull");
assert.strictEqual(Engine.ENEMY_TYPES.railgun.ship.hasDrive, true, "and it moves, like the ship it is drawn as");
assert.strictEqual(Engine.ENEMY_TYPES.railgun.startsEmpty, true, "arriving with an empty bus is the telegraph");
assert.strictEqual(Engine.WEAPONS.railgun.range, 20, "the Railgun's shot is effectively board-spanning");

const railgunLevel = {
  id: 995,
  name: "railgun fixture",
  board: { type: "rect", cols: 5, rows: 9 },
  playerStart: { q: 2, r: 5 }, // same column as the railgun — aligned on its vertical axis
  exit: { q: 2, r: -1 },
  outpost: null,
  enemies: [{ type: "railgun", q: 2, r: 1 }], // distance 4 — well beyond the Sentry's reach, still lethal here
  hazards: [],
  exitRule: "all-enemies-dead",
  actions: ["sublight"], // no flagship weapons, so the Railgun lives to fire back
};
const railgunState = Engine.createGameState(railgunLevel);
const railgunStart = { q: railgunState.enemies[0].q, r: railgunState.enemies[0].r };
// Its reactor spawns empty (the charge-up telegraph — see the enemy-
// reactor section below for the full rhythm), so pre-charge it here to
// test the range/axis geometry itself.
railgunState.enemies[0].energy = Engine.WEAPONS.railgun.energyCost;
const hullBeforeRailgun = railgunState.hull;
// Park the ship three out on one of the Railgun's own axes, wherever the
// lane guarantee ended up putting it, then take a step along that lane.
const railgunLane = Engine.weaponHexes(railgunStart, 0, Engine.WEAPONS.railgun, railgunState).filter((h) =>
  Engine.onBoard(railgunState, h)
);
const standOff = railgunLane.find((h) => Engine.hexDistance(h, railgunStart) === 4);
const intoLine = railgunLane.find((h) => Engine.hexDistance(h, railgunStart) === 3);
railgunState.playerPos = { q: standOff.q, r: standOff.r };
Engine.applySublight(railgunState, intoLine); // three out and aligned — the long shot reaches it
assert.strictEqual(
  railgunState.hull,
  hullBeforeRailgun - Engine.WEAPONS.railgun.damage,
  "aligned on the Railgun's axis at distance 3 is already lethal — its range dwarfs the Sentry's, and it hits for 2"
);
assert.deepStrictEqual(
  { q: railgunState.enemies[0].q, r: railgunState.enemies[0].r },
  railgunStart,
  "the Railgun does not move to chase either — it holds its hex"
);
// Enemies pay energy for a shot on the same rule the flagship does (see
// enemyPhase), but nothing ever SAID so on screen — reported live: "I'm
// not seeing their energy deplete." The single-line hit-report log is the
// one place that can say it without adding a second line that would just
// get overwritten (see pushLog's one-message-at-a-time design), so it
// reports the shooter's energy right after paying for the shot.
assert.ok(
  railgunState.log[railgunState.log.length - 1].includes("RAILGUN energy 0/5"),
  "the hit-report log names the shooter and its post-shot energy, so the spend is visible even though the reactor refills before the player's next glance at it"
);

// Off-axis, the Railgun's shot never reaches at all, no matter the range.
const railgunOffAxisLevel = { ...railgunLevel, id: 996, playerStart: { q: 0, r: 5 } };
const railgunOffAxisState = Engine.createGameState(railgunOffAxisLevel);
railgunOffAxisState.enemies[0].energy = Engine.WEAPONS.railgun.energyCost; // charged, so the miss below is about geometry, not energy
const offAxisGun = railgunOffAxisState.enemies[0];
const offAxisLine = new Set(
  Engine.weaponHexes(offAxisGun, 0, Engine.WEAPONS.railgun, railgunOffAxisState).map(Engine.hexKey)
);
// Somewhere close to it but on none of its six lanes.
const offLane = railgunOffAxisState.boardHexes.filter(
  (h) => !offAxisLine.has(Engine.hexKey(h)) && !Engine.enemyAt(railgunOffAxisState, h)
);
// Two adjacent hexes, both off every lane, as close to the gun as the
// board allows — so the step below is a move it watches and cannot hit.
let offAxisPerch = null;
let offAxisStep = null;
for (const a of offLane) {
  const b = offLane.find((h) => Engine.hexDistance(h, a) === 1);
  if (!b) continue;
  if (!offAxisPerch || Engine.hexDistance(a, offAxisGun) < Engine.hexDistance(offAxisPerch, offAxisGun)) {
    offAxisPerch = a;
    offAxisStep = b;
  }
}
assert.ok(offAxisPerch && offAxisStep, "the board has somewhere off every lane to stand");
railgunOffAxisState.playerPos = { q: offAxisPerch.q, r: offAxisPerch.r };
const hullBeforeOffAxis = railgunOffAxisState.hull;
Engine.applySublight(railgunOffAxisState, offAxisStep);
assert.strictEqual(
  railgunOffAxisState.hull,
  hullBeforeOffAxis,
  "off one of the 6 axes, the Railgun's shot never reaches, however close"
);

// ---- salvage economy + Sector Outpost shop -------------------------------
// Every kill drops salvage (see ENEMY_TYPES[type].salvage), spendable at an
// outpost hex without spending a turn. Two offers: repair and a permanent
// max-Hull bump, both gated on affordability/applicability.

const salvageLevel = {
  id: 992,
  name: "salvage fixture",
  radius: 2,
  playerStart: { q: 0, r: 0 },
  exit: { q: 2, r: 0 },
  outpost: { q: -2, r: 0 },
  enemies: [{ type: "interceptor", q: 0, r: -2 }],
  hazards: [],
  exitRule: "all-enemies-dead",
};
const salvageState = Engine.createGameState(salvageLevel);
assert.ok(salvageState.outpostOfferIds.includes("repair"), "Repair is always on offer at an outpost");
// Force the second offer to "reinforce" for the rest of this test — which
// non-repair offer a given level deals is randomized (see the pool-variety
// test below), and this fixture just needs a stable one to exercise.
salvageState.outpostOfferIds = ["repair", "reinforce"];
assert.strictEqual(salvageState.salvage, 0, "a fresh run starts with zero salvage");
assert.deepStrictEqual(Engine.outpostOffers(salvageState), [], "not standing on the outpost hex means no offers");

// Step into range, then FIRE — the kill drops its salvage.
Engine.applySublight(salvageState, { q: 0, r: -1 });
Engine.applyFire(salvageState);
assert.strictEqual(salvageState.enemies[0].alive, false, "the FIRE volley kills the adjacent Interceptor");
// A wreck is worth its type's value PLUS a depth bounty — deeper sectors
// pay better, so the shop keeps up with the sectors instead of staying
// priced against sector 2 forever.
assert.strictEqual(
  salvageState.salvage,
  Engine.ENEMY_TYPES.interceptor.salvage + Math.floor(salvageLevel.id / 2),
  "a kill drops its type's salvage value, scaled by how deep the sector is"
);
assert.ok(salvageState.events.some((e) => e.type === "salvage"), "a kill emits a salvage event for the UI to animate");
// Ending the approach MOVE adjacent to the live Interceptor ate its shot
// (one action per turn — that's the rule). Reset hull: the shop test
// below manages its own damage explicitly.
salvageState.hull = salvageState.maxHull;

// Walk to the outpost — shopping there must not cost a turn.
Engine.applySublight(salvageState, { q: -1, r: 0 });
const turnBeforeShop = salvageState.turnCount;
Engine.applySublight(salvageState, { q: -2, r: 0 });
assert.ok(Engine.outpostAvailable(salvageState), "standing on the outpost hex makes it available");
const turnAfterArrival = salvageState.turnCount;

salvageState.hull -= 1; // simulate battle damage so Repair has something to do
const offersBefore = Engine.outpostOffers(salvageState);
const repairOffer = offersBefore.find((o) => o.id === "repair");
const reinforceOffer = offersBefore.find((o) => o.id === "reinforce");
assert.ok(repairOffer.applicable, "Repair is applicable once Hull is below max");
assert.strictEqual(reinforceOffer.affordable, salvageState.salvage >= reinforceOffer.cost);
salvageState.salvage = repairOffer.cost; // guarantee affordability for the purchase below

const hullBeforeRepair = salvageState.hull;
const salvageBeforeRepair = salvageState.salvage;
Engine.applyOutpostPurchase(salvageState, "repair");
assert.strictEqual(salvageState.hull, hullBeforeRepair + 1, "Repair restores 1 Hull");
assert.strictEqual(salvageState.salvage, salvageBeforeRepair - repairOffer.cost, "Repair costs its listed salvage");
assert.strictEqual(salvageState.turnCount, turnAfterArrival, "shopping does not advance the turn counter");

salvageState.salvage = repairOffer.cost; // afford another repair, to isolate the "already full" refusal
assert.throws(
  () => Engine.applyOutpostPurchase(salvageState, "repair"),
  /hull is sound/,
  "Repair refuses once Hull is already at max"
);

// Reinforce Hull permanently raises the cap — force affordability regardless
// of how much salvage the fixture happened to earn above.
salvageState.salvage = reinforceOffer.cost;
const maxHullBefore = salvageState.maxHull;
Engine.applyOutpostPurchase(salvageState, "reinforce");
assert.strictEqual(salvageState.maxHull, maxHullBefore + 1, "Reinforce Hull raises the cap by 1");
// ...and it does so by welding a real crate of Ablative Plating into the
// hold — the same item a Cruiser carries. Extra hull is hardware you can
// point at, not a number on a sheet.
assert.ok(
  salvageState.hold.items.some((it) => it.id === "ablativePlating"),
  "Reinforce Hull installs actual plating, the same item the hostiles carry"
);
assert.strictEqual(salvageState.salvage, 0, "Reinforce Hull spent all the salvage set aside for it");

// Every offer except Repair is one-time per outpost — buying it removes
// it from what's on offer here, so it can't just be bought over and over.
assert.ok(
  !salvageState.outpostOfferIds.includes("reinforce"),
  "Reinforce Hull is removed from this outpost's offers once bought"
);
assert.throws(
  () => Engine.applyOutpostPurchase(salvageState, "reinforce"),
  /not on offer here/,
  "a one-time offer refuses a second purchase, even with the salvage to afford it"
);

// A still-available offer separately refuses when salvage falls short.
salvageState.outpostOfferIds = ["repair", "shield"];
salvageState.salvage = 0;
assert.throws(
  () => Engine.applyOutpostPurchase(salvageState, "shield"),
  /Not enough salvage/,
  "an offer refuses when salvage can't cover its cost"
);

// Salvage, the raised max-Hull, shield capacity/charges, AND hull damage
// all carry into the next sector via createGameState's carryOver — this is
// how loadSector() in app.js hands a run's progress from one sector to the
// next. Hull damage is permanent: warping doesn't repair a breached deck,
// only an Outpost does.
const carriedHold = {
  cols: 5,
  rows: 4,
  items: [
    { id: "reactorCore", x: 0, y: 0 },
    { id: "sublightDrive", x: 2, y: 0 },
    { id: "autocannon", x: 3, y: 0 },
    { id: "shieldGenerator", x: 0, y: 2 },
    { id: "shieldGenerator", x: 3, y: 1 },
    { id: "ablativePlating", x: 4, y: 0 },
  ],
  cargo: [],
};
const carriedState = Engine.createGameState(LEVELS[0], {
  salvage: 4,
  hull: 1,
  shieldCharges: 2,
  hold: carriedHold,
});
assert.strictEqual(carriedState.salvage, 4, "salvage carries over into the next sector");
// The upgrade carries because the PLATING carries — max hull isn't a
// separate number riding along beside the ship, it's part of the ship.
assert.strictEqual(carriedState.maxHull, Engine.START_HULL + 1, "the welded-in plating is still welded in next sector");
assert.strictEqual(carriedState.hull, 1, "hull DAMAGE carries over — a jump never repairs the ship");
assert.strictEqual(carriedState.shieldCharges, 2, "raised shield charges carry over too");
assert.strictEqual(carriedState.maxShields, 2, "capacity derives from the two installed generators in the carried hold");
// A fresh run (no carryOver) starts whole, and with no shields at all —
// shields only exist once a Shield Generator is bought.
const freshState = Engine.createGameState(LEVELS[0]);
assert.strictEqual(freshState.hull, freshState.maxHull, "a fresh run starts at full hull");
assert.strictEqual(freshState.maxShields, 0, "a fresh run has NO shield capacity");
assert.strictEqual(freshState.shieldCharges, 0, "and no shield charges");
// Charges can never exceed capacity — a stale carryOver with more charges
// than installed generators clamps down instead of smuggling extras in.
const oneGenHold = JSON.parse(JSON.stringify(carriedHold));
oneGenHold.items = oneGenHold.items.filter((it, i) => !(it.id === "shieldGenerator" && i === 4));
const clampedState = Engine.createGameState(LEVELS[0], { shieldCharges: 3, hold: oneGenHold });
assert.strictEqual(clampedState.shieldCharges, 1, "carried charges clamp to installed generator capacity");

// ---- Starting loadouts: alternate ways to begin a run --------------------
// Meta-progression (Requisition, unlocked between runs — see app.js)
// changes WHICH kit a fresh run starts with, never anything mid-run — so
// every loadout only has to prove itself as a valid, sane FRESH ship.
{
  const ids = Object.keys(Engine.STARTING_LOADOUTS);
  assert.ok(ids.includes("standard") && ids.length >= 3, "at least the default plus two real alternatives exist");
  for (const id of ids) {
    const loadout = Engine.STARTING_LOADOUTS[id];
    const s = Engine.createGameState(LEVELS[0], { startingLoadout: id });
    assert.ok(s.hold.items.length >= loadout.kit.length, `${id}: every kit item actually placed in the Hold`);
    assert.ok(s.actions.includes("sublight"), `${id}: every loadout can still move — sublight never locked`);
    assert.ok(s.maxHull >= Engine.START_HULL, `${id}: never LESS hull than the baseline airframe`);
  }
  assert.strictEqual(
    JSON.stringify(Engine.createGameState(LEVELS[0]).hold.items),
    JSON.stringify(Engine.createGameState(LEVELS[0], { startingLoadout: "standard" }).hold.items),
    "omitting startingLoadout is identical to explicitly picking Standard — unlocking nothing changes nothing"
  );
  // Escort Start's whole point is a shield ready on turn one, not a Hold
  // slot you have to spend a turn charging before it does anything.
  const escort = Engine.createGameState(LEVELS[0], { startingLoadout: "escort" });
  assert.ok(escort.maxShields > 0, "Escort Start actually carries a Shield Generator");
  assert.strictEqual(escort.shieldCharges, escort.maxShields, "...and it arrives already raised");
  // Salvager Start trades the exact same thing Escort does (reactor
  // capacity) for a different benefit (+1 max Hull instead of a shield).
  const salvager = Engine.createGameState(LEVELS[0], { startingLoadout: "salvager" });
  const standard = Engine.createGameState(LEVELS[0], { startingLoadout: "standard" });
  assert.ok(salvager.maxHull > standard.maxHull, "Salvager Start has more max Hull than Standard");
  assert.ok(salvager.maxEnergy < standard.maxEnergy, "...paid for with less max Energy, same as Escort Start");
  // No loadout may be a STRICT upgrade over another (equal-or-better on
  // every stat, worse on none) — a first pass at this shipped with
  // Salvager strictly better than Standard for zero cost, which made
  // Standard pointless the moment it was unlocked. Compares every pair
  // across Hull/Energy/Shields; a strict dominance either way is a bug.
  const previews = Object.keys(Engine.STARTING_LOADOUTS).map((id) => Engine.previewLoadout(id));
  for (const a of previews) {
    for (const b of previews) {
      if (a.id === b.id) continue;
      const stats = ["maxHull", "maxEnergy", "maxShields"];
      const aStrictlyBetter = stats.every((k) => a[k] >= b[k]) && stats.some((k) => a[k] > b[k]);
      assert.ok(!aStrictlyBetter, `${a.id} must not be a strict upgrade over ${b.id} on every stat`);
    }
  }
  // A carryOver.startingLoadout pointing at an id that doesn't exist (a
  // stale localStorage value from a renamed/removed loadout) must fall
  // back to Standard rather than throw or silently produce a broken ship —
  // this is what actually keeps "the chosen chip" from ever wedging a run.
  const unknownFallback = Engine.createGameState(LEVELS[0], { startingLoadout: "some-removed-id" });
  assert.strictEqual(
    JSON.stringify(unknownFallback.hold.items),
    JSON.stringify(Engine.createGameState(LEVELS[0], { startingLoadout: "standard" }).hold.items),
    "an unrecognized startingLoadout id falls back to Standard, same as omitting it entirely"
  );
}

// ---- outpost offer variety: not the same fixed shop every visit ---------
// Repair is always offered (the reliable baseline); how many EXTRA offers
// sit alongside it varies (0-2), picked deterministically per level id, so
// different levels vary while a given level always deals the same shop
// (reproducible runs) — a fixed count every time read as "too easy and not
// very interesting."
function outpostFixture(id) {
  return Engine.createGameState({
    id,
    radius: 2,
    playerStart: { q: 0, r: 0 },
    exit: { q: 2, r: 0 },
    outpost: { q: -2, r: 0 },
    enemies: [],
    hazards: [],
    exitRule: "all-enemies-dead",
  });
}
// A station is a scrapyard with a welding rig, not a showroom: Repair
// plus TWO things, and WHICH two is what varies from dock to dock
// (Clubhouse: "too many options too soon... why sell so much at every
// station?"). Nine offers in one list read as a catalogue, and most of it
// was greyed out on early-run salvage anyway.
const stockAcrossLevels = new Set();
for (let id = 900; id < 920; id++) {
  const offers = outpostFixture(id).outpostOfferIds;
  assert.strictEqual(offers[0], "repair", `level ${id}: Repair is always the first offer`);
  assert.strictEqual(offers.length, 4, `level ${id}: a station stocks Repair plus exactly three things — six weapons need a wider shelf`);
  assert.strictEqual(new Set(offers).size, offers.length, `level ${id}: no duplicate offers`);
  stockAcrossLevels.add(offers.slice(1).sort().join("+"));
}
assert.ok(stockAcrossLevels.size > 1, "WHAT a station stocks varies dock to dock, even though how much never does");
assert.deepStrictEqual(
  outpostFixture(905).outpostOfferIds,
  outpostFixture(905).outpostOfferIds,
  "the same level id always deals the same offers (reproducible)"
);

// ---- outpost rarity, price, and the rare-item bad-luck guarantee --------
// Clubhouse feedback: even varied-per-level stock was the exact same
// stock every single time you replayed that sector — reproducible had
// quietly become boring for a "luck and skill" crawler. Fixed by tying the
// roll to state.runSeed (a fresh one per RUN, not per level id) plus three
// things borrowed from how established roguelikes actually do drop
// tables: weighted rarity (Slay the Spire's shop odds, Risk of Rain 2's
// item tiers — commons common, rares an event), price variance per visit,
// and a bad-luck guarantee (Slay the Spire's rare-card pity offset) so a
// genuinely unlucky run still isn't an unsolvable one.
function outpostRunFixture(levelId, runSeed, raresSkipped) {
  return Engine.createGameState(
    {
      id: levelId,
      radius: 2,
      playerStart: { q: 0, r: 0 },
      exit: { q: 2, r: 0 },
      outpost: { q: -2, r: 0 },
      enemies: [],
      hazards: [],
      exitRule: "all-enemies-dead",
    },
    { runSeed, raresSkipped }
  );
}
assert.deepStrictEqual(
  outpostRunFixture(950, 42, 0).outpostOfferIds,
  outpostRunFixture(950, 42, 0).outpostOfferIds,
  "same level id + same run seed + same pity state always deals the same shop (reproducible within a run)"
);
assert.notDeepStrictEqual(
  outpostRunFixture(950, 1, 0).outpostOfferIds,
  outpostRunFixture(950, 2, 0).outpostOfferIds,
  "a different run seed can deal Sector 950 a genuinely different shop — replaying a sector isn't guaranteed identical anymore"
);
// Rarity actually weights the roll. Measured PER ITEM, not per tier: there
// are three commons and six rares now, so counting whole tiers said rares
// were winning when each individual rare was still much scarcer than each
// individual common. Sampled with the guarantees held off — a ship with no
// second gun is promised one, and a ship with no screen is promised that,
// so a fixture flying naked measures the promises rather than the roll.
{
  const tally = {};
  const kitted = ["shieldGenerator", "arcBeam"]; // nothing forced: has a screen, has a second gun
  for (let levelId = 950; levelId < 1050; levelId++) {
    const s = Engine.createGameState(
      {
        id: levelId, radius: 2,
        playerStart: { q: 0, r: 0 }, exit: { q: 2, r: 0 }, outpost: { q: -2, r: 0 },
        enemies: [], hazards: [], exitRule: "all-enemies-dead",
      },
      { runSeed: 99, raresSkipped: 0, extraActions: kitted.filter((k) => Engine.WEAPON_SYSTEM_KEYS.includes(k)) }
    );
    for (const it of kitted) if (!s.hold.items.some((h) => h.id === it)) s.hold.items.push({ id: it, x: 0, y: 0 });
    for (const id of s.outpostOfferIds) tally[id] = (tally[id] || 0) + 1;
  }
  const perItem = (ids) => ids.reduce((n, id) => n + (tally[id] || 0), 0) / ids.length;
  const commonEach = perItem(["reinforce", "reactor"]);
  const rareEach = perItem(["mortar", "flankTubes", "railgun", "missilePod", "arcProjector", "demolitionCharge"]);
  assert.ok(
    commonEach > rareEach * 1.5,
    `each common (${commonEach.toFixed(1)} sightings) turns up meaningfully more than each rare (${rareEach.toFixed(1)}) — rarity weighting is real, not cosmetic`
  );
}
// Prices roll within a modest band of the pool's listed cost — a real
// swing ("a cheap Railgun!"), never enough to break the hand-tuned cost
// curve ("weapons should be way more expensive... you have to save up").
{
  let sawADifferentPrice = false;
  for (let levelId = 950; levelId < 980; levelId++) {
    const s = outpostRunFixture(levelId, 7, 0);
    for (const id of s.outpostOfferIds) {
      if (id === "repair") continue;
      const base = Engine.OUTPOST_OFFER_POOL.find((o) => o.id === id).cost;
      const rolled = s.outpostOfferPrices[id];
      assert.ok(
        rolled >= Math.floor(base * 0.85) && rolled <= Math.ceil(base * 1.15),
        `level ${levelId}: rolled price ${rolled} for ${id} stays within the tuned band around ${base}`
      );
      if (rolled !== base) sawADifferentPrice = true;
    }
  }
  assert.ok(sawADifferentPrice, "prices actually DO vary visit to visit, not just in theory");
}
// Bad-luck protection: three straight Outpost visits with nothing
// rare-tier on the shelf force the fourth to deal one — a dry streak
// longer than that isn't luck, it's a run that can't get the shapes it
// needs to answer what it's fighting.
{
  // Read the tier off the pool rather than restating it — a new rare (the
  // Missile Pod) was added and this list silently stopped describing the
  // shelf it was meant to be checking.
  const RARE_IDS = new Set(
    Engine.OUTPOST_OFFER_POOL.filter((o) => o.rarity === "rare").map((o) => o.id)
  );
  let raresSkipped = 0;
  let dryStreak = 0;
  let worstDryStreak = 0;
  for (let levelId = 950; levelId < 1010; levelId++) {
    const s = outpostRunFixture(levelId, 2024, raresSkipped);
    const gotRare = s.outpostOfferIds.some((id) => RARE_IDS.has(id));
    dryStreak = gotRare ? 0 : dryStreak + 1;
    worstDryStreak = Math.max(worstDryStreak, dryStreak);
    raresSkipped = s.raresSkipped;
  }
  assert.ok(
    worstDryStreak <= 3,
    `no run of Outposts should go more than 3 straight visits without a rare-tier item (worst streak seen: ${worstDryStreak})`
  );
}

// ---- Shields: a raised charge absorbs one full hit, then is spent --------
const shieldLevel = {
  id: 991,
  name: "shield fixture",
  board: { type: "rect", cols: 4, rows: 5 },
  playerStart: { q: 2, r: 3 },
  exit: { q: 2, r: -1 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 1, r: 2 }],
  hazards: [],
  exitRule: "all-enemies-dead",
  actions: ["sublight"], // Impulse Cannon locked out so the interceptor survives to strike back
};
const shieldState = Engine.createGameState(shieldLevel);
shieldState.shieldCharges = 1;
const hullBeforeShield = shieldState.hull;
Engine.applySublight(shieldState, { q: 2, r: 2 }); // step adjacent — the move commits the round, the interceptor attacks
assert.strictEqual(shieldState.hull, hullBeforeShield, "a raised Shield charge fully absorbs the phase — no Hull lost");
assert.strictEqual(shieldState.shieldCharges, 0, "absorbing consumes the Shield charge");
assert.ok(shieldState.events.some((e) => e.type === "shieldAbsorb"), "absorbing emits a shieldAbsorb event for the UI");
// A separate fixture (no Shield charge banked) confirms the same hit costs
// Hull normally once there's nothing left to absorb it.
const noShieldState = Engine.createGameState(shieldLevel);
const hullBeforeNoShield = noShieldState.hull;
Engine.applySublight(noShieldState, { q: 2, r: 2 });
assert.strictEqual(noShieldState.hull, hullBeforeNoShield - 1, "with no Shield charge banked, the hit costs Hull as normal");

// ---- Shield Generator + Raise Shields: energy pays for protection --------
// Buying the generator at an Outpost is the one-time salvage purchase
// (+1 capacity, arrives raised); every re-raise after that costs Energy
// and a full turn via applyRaiseShields — protection competes with FIRE
// and RECHARGE for the same one-action economy.
salvageState.salvage = priceOf(salvageState, "shield");
Engine.applyOutpostPurchase(salvageState, "shield");
assert.strictEqual(salvageState.maxShields, 1, "the Shield Generator installs +1 permanent capacity");
assert.strictEqual(salvageState.shieldCharges, 1, "the new capacity arrives raised — the upgrade feels immediate");
assert.strictEqual(salvageState.salvage, 0, "the generator costs its full salvage price");

const raiseState = Engine.createGameState(shieldLevel);
raiseState.hold.items.push({ id: "shieldGenerator", x: 3, y: 0 }); // fixture: install a generator directly
Engine.syncHoldDerived(raiseState);
assert.strictEqual(raiseState.maxShields, 1, "an installed generator IS the capacity");
assert.strictEqual(raiseState.shieldCharges, 0, "capacity without carried charges starts DOWN — raising costs energy");
const energyBeforeRaise = raiseState.energy;
const turnBeforeRaise = raiseState.turnCount;
Engine.applyRaiseShields(raiseState);
assert.strictEqual(raiseState.shieldCharges, 1, "Raise Shields brings one charge up");
assert.strictEqual(raiseState.energy, energyBeforeRaise - Engine.SHIELD_RAISE_COST, "raising a charge costs energy");
assert.strictEqual(raiseState.turnCount, turnBeforeRaise + 1, "raising shields spends the turn like everything else");
assert.ok(raiseState.events.some((e) => e.type === "energySpend"), "raising emits the energySpend float for the UI");
assert.throws(() => Engine.applyRaiseShields(raiseState), /already up/, "can't raise past generator capacity");
raiseState.shieldCharges = 0;
raiseState.energy = Engine.SHIELD_RAISE_COST - 1;
assert.throws(() => Engine.applyRaiseShields(raiseState), /Not enough charge/, "raising refuses without the energy to pay");
const noGeneratorState = Engine.createGameState(shieldLevel);
assert.throws(
  () => Engine.applyRaiseShields(noGeneratorState),
  /No shield generator/,
  "no generator installed = no shields to raise"
);

// ---- The purchasable weapons: Flak Burst, Arc Beam, Railgun ------------
// Clubhouse feedback: "rethink all of those weapons... they all seem super
// similar and similarly priced." Each of the three now answers a situation
// the Autocannon can't — crowds, standoff, sniping — on a real price curve,
// and each is the exact item a hostile class already carries.
const shopLevel = {
  id: 992,
  name: "weapon shop fixture",
  board: { type: "rect", cols: 5, rows: 8 },
  playerStart: { q: 2, r: 6 },
  exit: { q: 4, r: -2 },
  outpost: { q: 0, r: 0 },
  enemies: [{ type: "interceptor", q: 2, r: 3 }],
  hazards: [],
  exitRule: "all-enemies-dead",
};

// ARC BEAM — standoff. Reaches two hexes, so it kills things on approach.
const arcState = Engine.createGameState(shopLevel);
assert.strictEqual(arcState.actions.includes("arcBeam"), false, "Arc Beam isn't part of the starting kit");
assert.strictEqual(Engine.outpostOffers(arcState).length, 0, "not docked yet — no offers visible");
arcState.playerPos = { q: shopLevel.outpost.q, r: shopLevel.outpost.r };
arcState.outpostOfferIds = ["repair", "arcBeam"];
assert.throws(
  () => Engine.applyOutpostPurchase(arcState, "arcBeam"),
  /not enough salvage/i,
  "gated on affordability like every other offer"
);
arcState.salvage = priceOf(arcState, "arcBeam");
Engine.applyOutpostPurchase(arcState, "arcBeam");
assert.strictEqual(arcState.actions.includes("arcBeam"), true, "purchasing it unlocks the action");
assert.strictEqual(arcState.salvage, 0, "the full cost is spent");
assert.strictEqual(
  arcState.outpostOfferIds.includes("arcBeam"),
  false,
  "one-time purchase per outpost, same as every non-Repair offer"
);
assert.strictEqual(arcState.systems.arcBeam, true, "the toggle defaults on once purchased");
assert.ok(
  arcState.hold.items.some((it) => it.id === "arcBeam") || arcState.hold.cargo.includes("arcBeam"),
  "and it arrives as a physical 2x2 item — fitted if it fits, in cargo if it doesn't"
);

// What the Arc Beam buys is the SHELL at two: it holds a contact on its
// approach, from any direction, with no facing required — and it cannot
// touch anything closer than that. Reach costs you the close-in fight.
arcState.playerPos = { q: 2, r: 5 };
arcState.enemies[0].q = 3;
arcState.enemies[0].r = 3; // two out, off every axis
Engine.setFacing(arcState, 3); // nose pointed the other way entirely
assert.ok(
  !Engine.weaponHexes(arcState.playerPos, arcState.facing, Engine.WEAPONS.autocannon, arcState).some((h) =>
    Engine.posEq(h, arcState.enemies[0])
  ),
  "the Autocannon genuinely cannot bring that contact into its arc from here"
);
Engine.applyFire(arcState, "e0", "arcBeam");
assert.strictEqual(arcState.enemies[0].alive, false, "the Arc Beam takes it anyway — no facing required");
assert.ok(
  arcState.log.some((line) => /Arc Beam: \w+ destroyed/.test(line)),
  "and the kill is attributed to the gun that actually fired"
);
// ...and the hole in the middle is real. Let something reach contact and
// the standoff gun is a passenger — that trade IS the weapon.
assert.ok(
  !Engine.weaponHexes({ q: 0, r: 0 }, 0, Engine.WEAPONS.arcBeam).some(
    (h) => Engine.hexDistance(h, { q: 0, r: 0 }) < 2
  ),
  "an Arc Beam cannot answer anything in contact — that is what buying reach costs"
);

// A purchased weapon has to be carried forward explicitly into the next
// sector (see app.js's advanceSector) — the engine side is extraActions.
const nextSectorState = Engine.createGameState(
  { ...shopLevel, id: 993 },
  { hasPrevious: true, extraActions: ["arcBeam"] }
);
assert.strictEqual(nextSectorState.actions.includes("arcBeam"), true, "extraActions carries a purchased weapon into the next sector");

// FLAK BURST — the crowd answer, and the ONLY weapon that hits more than
// one contact: being cornered stops being fatal.
const flakLevel = {
  ...shopLevel,
  id: 994,
  enemies: [
    { type: "cruiser", q: 2, r: 3 },
    { type: "cruiser", q: 1, r: 3 },
  ],
};
const flakState = Engine.createGameState(flakLevel);
assert.strictEqual(flakState.actions.includes("flakBurst"), false, "Flak Burst isn't in the starting kit either");
flakState.playerPos = { q: flakLevel.outpost.q, r: flakLevel.outpost.r };
flakState.outpostOfferIds = ["repair", "flakBurst"];
flakState.salvage = priceOf(flakState, "flakBurst");
Engine.applyOutpostPurchase(flakState, "flakBurst");
assert.strictEqual(flakState.systems.flakBurst, true, "the toggle defaults on once purchased");

// Two Cruisers, both adjacent, one volley — the Flak Burst damages BOTH.
flakState.playerPos = { q: 2, r: 5 };
flakState.enemies[0].q = 2;
flakState.enemies[0].r = 4;
flakState.enemies[1].q = 1;
flakState.enemies[1].r = 5;
flakState.energy = flakState.maxEnergy;
flakState.systems.autocannon = false; // isolate the burst — the Autocannon is adjacent too and would double up on one of them
Engine.applyFire(flakState);
assert.deepStrictEqual(
  flakState.enemies.map((e) => e.alive),
  [false, false],
  "one Flak Burst volley hits every adjacent contact at once — no other weapon does"
);

// RAILGUN — the sniper: any axis, the length of the board, 2 damage, and a
// four-round charge cycle against a +1/cycle reactor.
const railgunBuyState = Engine.createGameState({ ...shopLevel, id: 995 });
railgunBuyState.playerPos = { q: shopLevel.outpost.q, r: shopLevel.outpost.r };
railgunBuyState.outpostOfferIds = ["repair", "railgun"];
railgunBuyState.salvage = priceOf(railgunBuyState, "railgun");
// Footprint is a real constraint: a 1x4 spine does NOT fit around the
// starting kit, so it arrives inert in cargo until you make room — and the
// shelf warns you of exactly that before you hand over the salvage.
assert.strictEqual(
  Engine.outpostOffers(railgunBuyState).find((o) => o.id === "railgun").fits,
  false,
  "the shop knows the spine won't fit a stock hold"
);
Engine.applyOutpostPurchase(railgunBuyState, "railgun");
assert.strictEqual(railgunBuyState.systems.railgun, false, "bought but unfitted — a 1x4 spine has nowhere to go in a stock hold");
assert.ok(railgunBuyState.hold.cargo.includes("railgun"), "so it rides in cargo, powered down, until the Hold has room");
railgunBuyState.hold.rows += 1; // Hold Expansion — buy the space, then fit the gun
const railgunCargoIdx = railgunBuyState.hold.cargo.indexOf("railgun");
let railgunFitted = false;
for (let y = 0; y < railgunBuyState.hold.rows && !railgunFitted; y++) {
  for (let x = 0; x < railgunBuyState.hold.cols && !railgunFitted; x++) {
    if (Engine.holdCanPlace(railgunBuyState.hold, "railgun", x, y)) {
      railgunBuyState.playerPos = { q: shopLevel.outpost.q, r: shopLevel.outpost.r }; // refits are dock-gated
      Engine.installFromCargo(railgunBuyState, railgunCargoIdx, x, y);
      railgunFitted = true;
    }
  }
}
assert.strictEqual(railgunFitted, true, "one extra row of hold is enough to fit the spine");
assert.strictEqual(railgunBuyState.systems.railgun, true, "and installing it arms the weapon");
assert.strictEqual(Engine.WEAPONS.railgun.damage, 2, "the Railgun hits for 2 — it one-shots anything, including the Bulwark's plating");
// The three lane guns are a strict ladder — a Railgun's line swallows an
// Arc Projector's, which swallows a Beam Lance's — so each one up has to
// cost another charge or the one below it is obsolete. That ordering is
// the assertion; the exact numbers are free to move together.
assert.ok(
  Engine.WEAPONS.beamLance.energyCost < Engine.WEAPONS.arcProjector.energyCost &&
    Engine.WEAPONS.arcProjector.energyCost < Engine.WEAPONS.railgun.energyCost,
  "reach costs rate: Beam Lance < Arc Projector < Railgun, in charge per shot"
);
railgunBuyState.playerPos = { q: 2, r: 6 };
railgunBuyState.enemies[0].type = "cruiser";
railgunBuyState.enemies[0].hp = 2;
railgunBuyState.enemies[0].q = 2;
railgunBuyState.enemies[0].r = 1; // five hexes away, aligned on an axis
railgunBuyState.energy = railgunBuyState.maxEnergy;
Engine.applyFire(railgunBuyState);
assert.strictEqual(railgunBuyState.enemies[0].alive, false, "the Railgun kills across the whole board");

// The gear rule, both directions. It used to be asserted as an exact 1:1
// list, which was only ever true by accident of there being six classes
// and six weapons — classes share weapons now (an Escort and a Scout both
// fly an Autocannon, the Bulwark carries two guns), and that is the
// point: what a hostile has is a loadout, not a species.
const carriedWeapons = new Set(Object.values(Engine.ENEMY_TYPES).flatMap((t) => t.ship.weaponKeys));
for (const key of Engine.WEAPON_SYSTEM_KEYS) {
  assert.ok(carriedWeapons.has(key), `${key} must exist in the world on some hostile — nothing is player-only`);
}
for (const key of carriedWeapons) {
  assert.ok(
    Engine.WEAPON_SYSTEM_KEYS.includes(key),
    `${key} is carried by a hostile, so it has to be a gun you can buy and fit — no enemy-only gear`
  );
}
// And every crate in a hostile hold is a crate from the same catalogue.
for (const [name, def] of Object.entries(Engine.ENEMY_TYPES)) {
  for (const it of def.hold.items) {
    assert.ok(Engine.EQUIPMENT[it.id], `${name} carries "${it.id}", which is not real equipment`);
  }
}

// ---- the second wave: five classes, no new rules ------------------------
// Every one of them is a different arrangement of the same crates, and the
// engine reads their stats off the hold exactly as it reads yours.
// The Scout is gone — it and the Picket carried near-identical guns, which
// is why both read thin. One archer, and the Picket is it.
assert.strictEqual(Engine.ENEMY_TYPES.scout, undefined, "there is one archer in the game, not two");
assert.strictEqual(Engine.ENEMY_TYPES.picket.ship.hasDrive, true, "and it flies");
assert.deepStrictEqual(Engine.ENEMY_TYPES.picket.ship.weaponKeys, ["beamLance"], "carrying the archer's beam");
assert.strictEqual(Engine.ENEMY_TYPES.escort.ship.maxShields, 1, "the Escort is the first hostile with a screen");
assert.strictEqual(Engine.ENEMY_TYPES.carrier.maxHull, 1, "the Carrier is one Hull — two GUNS is what it is, not two hit points");
assert.deepStrictEqual(
  Engine.ENEMY_TYPES.carrier.ship.weaponKeys.slice().sort(),
  ["missilePod", "siegeMaul"],
  "and the only MOBILE hostile carrying two guns — that, not a bigger hull, is what it is"
);
assert.strictEqual(
  Object.values(Engine.ENEMY_TYPES).filter((t) => t.ship.hasDrive && t.ship.weaponKeys.length > 1).length,
  1,
  "exactly one mobile class carries a second gun — it stays a distinct thing"
);
assert.deepStrictEqual(
  Engine.ENEMY_TYPES.salvager.ship.weaponKeys,
  [],
  "the Salvager has NO gun of any kind — it is a decision about time, not a threat"
);
assert.ok(
  Engine.ENEMY_TYPES.salvager.salvage > Engine.ENEMY_TYPES.carrier.salvage,
  "and it is the richest wreck on any ordinary board, which is the whole reason to stop for it"
);
assert.strictEqual(Engine.ENEMY_TYPES.bulwark.maxHull, 2, "the Bulwark is the one thing that takes a second shot");
// ...and it is the ONLY armed class that does. Everything else is glass.
{
  const tough = Object.entries(Engine.ENEMY_TYPES)
    .filter(([, t]) => t.ship.weapons.length && t.maxHull > 1)
    .map(([n]) => n);
  assert.deepStrictEqual(tough, ["bulwark"], `only the boss survives a hit (${tough.join(", ")})`);
}
assert.strictEqual(Engine.ENEMY_TYPES.bulwark.ship.hasDrive, false, "bolted down — it is a fortress, not a ship");
assert.deepStrictEqual(
  Engine.ENEMY_TYPES.bulwark.ship.weaponKeys.slice().sort(),
  ["flakBurst", "railgun"],
  "carrying both ends of the roster: the lane and the contact ring"
);
assert.strictEqual(Engine.ENEMY_TYPES.bulwark.startsEmpty, true, "and it charges its first slug in front of you");
// Its two guns together leave exactly one kind of ground to stand on:
// off its axes, outside contact. That gap is the fight, so prove it exists.
{
  const probe = Engine.createGameState({
    id: 970,
    name: "bulwark geometry",
    board: { type: "rect", cols: 9, rows: 11 },
    playerStart: { q: 4, r: 8 },
    exit: { q: 8, r: -4 },
    outpost: null,
    enemies: [{ type: "bulwark", q: 4, r: 3 }],
    hazards: [],
    exitRule: "all-enemies-dead",
  });
  const gun = probe.enemies[0];
  const covered = new Set();
  for (const key of Engine.ENEMY_TYPES.bulwark.ship.weaponKeys) {
    for (const h of Engine.weaponHexes(gun, 0, Engine.WEAPONS[key], probe)) covered.add(Engine.hexKey(h));
  }
  const safe = probe.boardHexes.filter((h) => !covered.has(Engine.hexKey(h)) && !Engine.posEq(h, gun));
  assert.ok(safe.length > 0, "there IS ground the Bulwark cannot reach — the fight is findable");
  assert.ok(
    safe.some((h) => Engine.hexDistance(h, gun) <= 3),
    "and some of it is close enough to shoot back from"
  );
  assert.ok(
    !safe.some((h) => Engine.hexDistance(h, gun) === 1),
    "but none of it is in contact — the Flak Burst owns every adjacent hex"
  );
}

// A hostile screen absorbs exactly one hit, then it's spent — the same
// rule your own Shield Generator follows, because it IS the same item.
{
  const shielded = Engine.createGameState({
    id: 969,
    name: "escort fixture",
    board: { type: "rect", cols: 5, rows: 7 },
    playerStart: { q: 2, r: 4 },
    exit: { q: 2, r: -1 },
    outpost: null,
    enemies: [{ type: "escort", q: 2, r: 1 }],
    hazards: [],
    exitRule: "all-enemies-dead",
    actions: ["sublight", "autocannon"],
  });
  const escort = shielded.enemies[0];
  assert.strictEqual(escort.shieldCharges, 1, "an Escort spawns with its screen raised");
  // Step into contact so the Autocannon (a three-hex arc off the nose) bears.
  escort.q = shielded.playerPos.q;
  escort.r = shielded.playerPos.r - 1;
  Engine.setFacing(shielded, Engine.directionIndex(shielded.playerPos, escort));
  Engine.applyFire(shielded);
  assert.strictEqual(escort.alive, true, "the shot that kills an Interceptor outright only pops the bubble");
  assert.strictEqual(escort.shieldCharges, 0, "the charge is spent");
  assert.strictEqual(escort.hp, escort.maxHp, "and no Hull was touched");
  assert.ok(
    shielded.events.some((e) => e.type === "enemyShieldAbsorb"),
    "the absorb emits its own event so the board can show it"
  );
  shielded.energy = shielded.maxEnergy;
  Engine.applyFire(shielded);
  assert.strictEqual(escort.alive, false, "the second shot goes through");
}

// ---- weapons are shapes, and every shape has a hole --------------------
// The roster used to be six ways of saying "everything within N", where a
// bigger N was strictly better and where you stood never mattered beyond
// counting hexes. Each gun now covers a footprint with somewhere it
// cannot reach, so "which gun answers THIS contact, standing THERE" is a
// real question. This block is the guard on that.
{
  const origin = { q: 0, r: 0 };
  // The ground a gun THREATENS, which for most weapons is simply where it
  // reaches. A weapon that PLACES something is different: weaponHexes is
  // only where the thing lands, and what it actually threatens is that hex
  // plus its blast. Comparing throw rings would have called the Demolition
  // Charge a worse Arc Beam — same ring at two, more charge — when it
  // covers seven hexes for the Beam's one.
  const at = (w) => {
    const weapon = Engine.WEAPONS[w];
    const landed = Engine.weaponHexes(origin, 0, weapon);
    if (!weapon.places) return landed;
    const out = new Map();
    for (const hex of landed) {
      for (let dq = -weapon.blast; dq <= weapon.blast; dq++) {
        for (let dr = -weapon.blast; dr <= weapon.blast; dr++) {
          const h = { q: hex.q + dq, r: hex.r + dr };
          if (Engine.hexDistance(hex, h) > weapon.blast) continue;
          out.set(Engine.hexKey(h), h);
        }
      }
    }
    return [...out.values()];
  };
  const distances = (w) => new Set(at(w).map((h) => Engine.hexDistance(origin, h)));

  // Three shells, at exactly one, two and three. Nothing in the middle of
  // any of them — the ladder is the design.
  assert.deepStrictEqual([...distances("autocannon")], [1], "the Autocannon is contact, all the way round");
  assert.deepStrictEqual([...distances("flakBurst")], [1], "Flak Burst is the shell at contact and nothing further");
  assert.deepStrictEqual([...distances("arcBeam")], [2], "the Arc Beam is the shell at two, with a hole inside it");
  assert.deepStrictEqual([...distances("mortar")], [3], "the Mortar is the shell at three, with a bigger hole inside it");
  assert.strictEqual(at("flakBurst").length, 6, "six hexes touching the hull");
  assert.strictEqual(at("arcBeam").length, 12, "twelve at two");
  assert.strictEqual(at("mortar").length, 18, "eighteen at three");

  // No gun is a strict upgrade on another. Covering strictly more ground
  // is allowed — a Railgun's lanes swallow the Autocannon's wedge — but
  // only if you PAY for it, in charge or in damage. Nothing may be wider
  // AND cheaper AND harder-hitting than something else, or fitting the
  // second gun stops being a decision.
  const keys = Engine.WEAPON_SYSTEM_KEYS;
  for (const a of keys) {
    for (const b of keys) {
      if (a === b) continue;
      const wa = Engine.WEAPONS[a];
      const wb = Engine.WEAPONS[b];
      const bHexes = new Set(at(b).map(Engine.hexKey));
      const aCovered = at(a).every((h) => bHexes.has(Engine.hexKey(h)));
      if (!aCovered) continue; // b doesn't cover a's ground at all
      // Covering the same hexes isn't the same as doing the same job: a gun
      // that hits EVERYTHING in its footprint is not out-classed by a
      // cheaper one that picks a single target out of it. The Autocannon
      // and the Flak Burst share a ring and are not each other's upgrade.
      if (wa.targets === "all" && wb.targets === "one") continue;
      // Nor is ground the same as a ship. A charge covers a lot of hexes
      // and hits nothing for two rounds, which is time enough to walk out
      // of all of them — what it gives up is immediacy, and no footprint
      // comparison can see that.
      if (wb.places && !wa.places) continue;
      assert.ok(
        wb.energyCost > wa.energyCost || wb.damage < wa.damage,
        `${b} covers everything ${a} does, so it has to give something up — charge or stopping power`
      );
    }
  }

  // The Flank Tubes are the exact complement of a Railgun's lanes: the six
  // gaps between the axes, at two. Nothing they cover is on an axis.
  const tubes = at("flankTubes");
  assert.strictEqual(tubes.length, 6, "six tubes, six gaps");
  assert.ok(tubes.every((h) => Engine.hexDistance(origin, h) === 2), "all of them two out");
  const lanes = new Set(
    Engine.weaponHexes(origin, 0, Engine.WEAPONS.railgun).map(Engine.hexKey)
  );
  assert.ok(
    tubes.every((h) => !lanes.has(Engine.hexKey(h))),
    "and not one of them on a lane — the Tubes cover precisely what a Railgun never can"
  );

  // Cover cuts both ways. A rock breaks a Railgun's lane; a Mortar lobs
  // straight over it. That asymmetry is what makes an asteroid field a
  // decision instead of just a wall.
  const coverLevel = {
    id: 989,
    name: "cover fixture",
    board: { type: "rect", cols: 5, rows: 9 },
    playerStart: { q: 2, r: 6 },
    exit: { q: 2, r: -1 },
    outpost: null,
    enemies: [{ type: "interceptor", q: 2, r: 3 }], // three straight up
    hazards: [{ type: "asteroid", q: 2, r: 4 }], // a rock in between
    exitRule: "all-enemies-dead",
    actions: ["sublight"],
  };
  const coverState = Engine.createGameState(coverLevel);
  const foe = coverState.enemies[0];
  assert.ok(
    !Engine.weaponHexes(coverState.playerPos, 2, Engine.WEAPONS.railgun, coverState).some((h) => Engine.posEq(h, foe)),
    "the rock stops the Railgun's slug dead — that lane is closed"
  );
  assert.ok(
    Engine.weaponHexes(coverState.playerPos, 2, Engine.WEAPONS.mortar, coverState).some((h) => Engine.posEq(h, foe)),
    "and the Mortar drops one on it anyway — hiding behind rock is no defence against indirect fire"
  );
}

// ---- one set of rules, both sides --------------------------------------
// There is no second rulebook for hostiles. Everything a contact can do is
// read off its hold by the same deriveShip() the flagship runs through, and
// it flies by the same movement rule. This block is the guard on that:
// "the enemy should be working exactly the same way that the user is...
// they can't move without the item that lets them move. They can't attack
// without the item that lets them attack."
{
  // Nothing on this board flies through a rock. A chaser boxed in by
  // asteroids stays put instead of walking over one — cover has to be
  // cover for both sides or it's worth nothing.
  const rockLevel = {
    id: 992,
    name: "rock parity fixture",
    board: { type: "rect", cols: 5, rows: 9 },
    playerStart: { q: 2, r: 7 },
    exit: { q: 2, r: -1 },
    outpost: null,
    enemies: [{ type: "interceptor", q: 2, r: 2 }],
    // A full wall across the chaser's only approach.
    hazards: [0, 1, 2, 3, 4].map((q) => ({ type: "asteroid", q, r: 3 })),
    exitRule: "all-enemies-dead",
    actions: ["sublight"],
  };
  const rockState = Engine.createGameState(rockLevel);
  const chaser = rockState.enemies[0];
  const rocks = new Set(rockState.hazards.map((h) => Engine.hexKey(h)));
  for (let round = 0; round < 8; round++) {
    Engine.applyEndTurn(rockState);
    assert.ok(
      !rocks.has(Engine.hexKey(chaser)),
      "a hostile never ends a burn inside an asteroid — the rock stops it exactly like it stops you"
    );
    assert.ok(chaser.r < 3, "and it never gets past the wall it can't fly through");
  }

  // Capability comes from hardware, and ONLY from hardware. Take the drive
  // out and the same class stops chasing; take the gun out and it stops
  // shooting. Nothing else in the file gets a vote.
  const grounded = Engine.deriveShip({
    items: Engine.ENEMY_TYPES.interceptor.hold.items.filter((it) => it.id !== "sublightDrive"),
  });
  assert.strictEqual(grounded.hasDrive, false, "pull an Interceptor's drive and it is an emplacement");
  const disarmed = Engine.deriveShip({
    items: Engine.ENEMY_TYPES.interceptor.hold.items.filter((it) => it.id !== "autocannon"),
  });
  assert.deepStrictEqual(disarmed.weapons, [], "pull its gun and it has nothing to shoot you with");

  // And that isn't just theory about a derived object — an actual grounded
  // contact on an actual board never moves.
  Engine.ENEMY_TYPES.__testHulk = {
    hull: 1, salvage: 1,
    hold: { cols: 2, rows: 2, blocked: [], items: [{ id: "microReactor", x: 0, y: 0 }] },
  };
  Engine.ENEMY_TYPES.__testHulk.ship = Engine.deriveShip(Engine.ENEMY_TYPES.__testHulk.hold);
  Engine.ENEMY_TYPES.__testHulk.maxHull = 1;
  const hulkState = Engine.createGameState({ ...rockLevel, id: 991, hazards: [], enemies: [{ type: "__testHulk", q: 2, r: 2 }] });
  const hulk = hulkState.enemies[0];
  const hulkStart = Engine.hexKey(hulk);
  const hullBeforeHulk = hulkState.hull;
  for (let round = 0; round < 6; round++) Engine.applyEndTurn(hulkState);
  assert.strictEqual(Engine.hexKey(hulk), hulkStart, "no drive fitted, no flying — for them exactly as for you");
  assert.strictEqual(hulkState.hull, hullBeforeHulk, "no gun fitted, no shooting");
  delete Engine.ENEMY_TYPES.__testHulk;

  // Every class's numbers ARE its hold's numbers. If someone hand-writes a
  // stat block again, this fails.
  for (const [name, def] of Object.entries(Engine.ENEMY_TYPES)) {
    const fresh = Engine.deriveShip(def.hold);
    assert.deepStrictEqual(fresh.weaponKeys, def.ship.weaponKeys, `${name}'s armament is its hold's armament`);
    assert.strictEqual(fresh.maxEnergy, def.ship.maxEnergy, `${name}'s bus is the reactors it carries`);
    assert.strictEqual(def.maxHull, def.hull + fresh.hullBonus, `${name}'s hull is airframe plus plating`);
    assert.ok(fresh.rechargeGain > 0, `${name} carries a generator, not just batteries — it can actually refill`);
    // A class with no gun at all is legal and deliberate (the Salvager) —
    // but anything that DOES carry one has to be able to pay for it, or
    // it's an enemy that stands there forever with its safety on.
    if (fresh.weapons.length) {
      assert.ok(
        fresh.maxEnergy >= Math.min(...fresh.weapons.map((w) => w.energyCost)),
        `${name} can eventually afford to fire`
      );
    }
  }

  // The Salvager is the live proof of the weaponless case: it flies (it
  // has a drive), it closes, and it cannot hurt you, because there is no
  // gun in its hold — not because anything special-cases it.
  {
    const tugLevel = { ...rockLevel, id: 990, hazards: [], enemies: [{ type: "salvager", q: 2, r: 0 }] };
    const tugState = Engine.createGameState(tugLevel);
    const tug = tugState.enemies[0];
    const startKey = Engine.hexKey(tug);
    const hullBefore = tugState.hull;
    for (let round = 0; round < 8; round++) Engine.applyEndTurn(tugState);
    assert.notStrictEqual(Engine.hexKey(tug), startKey, "the Salvager closes — it has a drive like anything else");
    assert.strictEqual(tugState.hull, hullBefore, "and it never lands a hit, because it has nothing to hit with");
    assert.strictEqual(tugState.status, "playing", "you can stand next to one all day");
  }
}

// ---- missiles: ordnance that exists on the board -------------------------
// Everything else in the game resolves the instant it fires. A missile
// doesn't: it becomes a thing standing on a hex, flying at exactly your
// speed toward whoever it was launched at. You can always outrun it — what
// you cannot do is outrun it AND shoot in the same round, which is the
// whole decision it poses. Descended from Hoplite's bomber: telegraphed,
// dodgeable, and perfectly happy to kill the side that launched it.
{
  const board = {
    id: 953,
    name: "missile fixture",
    board: { type: "rect", cols: 9, rows: 11 },
    playerStart: { q: 4, r: 8 },
    exit: { q: 8, r: -4 },
    outpost: null,
    enemies: [{ type: "carrier", q: 4, r: 3 }],
    hazards: [],
    exitRule: "all-enemies-dead",
  };
  assert.ok(
    Engine.ENEMY_TYPES.carrier.ship.weaponKeys.includes("missilePod"),
    "the Carrier's bay doors are missile tubes"
  );
  assert.strictEqual(Engine.WEAPONS.missilePod.launches, true, "and a launcher is flagged as one");

  // Stand still and it lands.
  const still = Engine.createGameState(board);
  still.enemies[0].energy = still.enemies[0].maxEnergy;
  let sawMissile = false;
  for (let round = 0; round < 9 && still.status === "playing"; round++) {
    Engine.applyEndTurn(still);
    if ((still.missiles || []).length) sawMissile = true;
  }
  assert.ok(sawMissile, "a launcher puts ordnance on the board rather than dealing damage on the spot");
  assert.ok(still.hull < Engine.START_HULL, "and standing in its way costs you hull");

  // A missile detonates on the FIRST ship it reaches, whoever's side.
  const friendly = Engine.createGameState(board);
  friendly.missiles = [{ id: "m1", q: 4, r: 5, damage: 2, fuse: 5, ownerId: "e0" }];
  // A Sentry, deliberately: ordnance flies AFTER everyone has moved, so a
  // chaser would simply have stepped out of the way before it arrived.
  // An emplacement has no drive and has to wear it.
  const bystander = {
    id: "e9", type: "sentry", q: 4, r: 6, alive: true,
    hp: 1, maxHp: 1, energy: 0, maxEnergy: 3, shieldCharges: 0, maxShields: 0,
  };
  friendly.enemies.push(bystander);
  const hullBefore = friendly.hull;
  Engine.applyEndTurn(friendly);
  assert.strictEqual(bystander.alive, false, "it detonated on the hostile standing in its path");
  assert.strictEqual(friendly.hull, hullBefore, "and never reached the flagship at all");

  // Rock stops it: a missile that cannot step anywhere useful gives out.
  const walled = Engine.createGameState({ ...board, id: 952, hazards: [{ type: "asteroid", q: 4, r: 6 }] });
  walled.missiles = [{ id: "m2", q: 4, r: 5, damage: 2, fuse: 2, ownerId: "e0" }];
  const wallHull = walled.hull;
  Engine.applyEndTurn(walled);
  Engine.applyEndTurn(walled);
  assert.strictEqual(walled.hull, wallHull, "a rock in the lane is a rock in the lane");

  // A fuse is finite — nothing herds you for the whole sector.
  const burnout = Engine.createGameState({ ...board, id: 951, enemies: [] });
  burnout.missiles = [{ id: "m3", q: 0, r: 0, damage: 2, fuse: 1, ownerId: "e0" }];
  Engine.applyEndTurn(burnout);
  assert.strictEqual((burnout.missiles || []).length, 0, "it burns out rather than chasing forever");

  // Same crate both ways round: yours flies at THEM.
  const mine = Engine.createGameState({ ...board, id: 950 });
  mine.hold.items.push({ id: "missilePod", x: 0, y: 4 });
  Engine.syncHoldDerived(mine);
  if (mine.systems.missilePod) {
    mine.energy = mine.maxEnergy;
    mine.enemies[0].q = mine.playerPos.q;
    mine.enemies[0].r = mine.playerPos.r - 3; // inside the pod's ring
    Engine.applyFire(mine, null, "missilePod");
    assert.ok((mine.missiles || []).some((m) => !m.ownerId), "the flagship's own launch is on the board too");
  }
}

// ---- nothing shoots through its own side --------------------------------
// Hoplite's roster is built on this: its bomber won't drop a bomb beside
// another demon, its wizard won't fire at all with a demon within five. It
// is what turns a crowd from "more hit points" into terrain you can work
// against — stand so a hostile's own wingman is in the way and it costs
// them the shot. Blocking already handled the LINE (see blocksShot); this
// is the SPREAD, which is the half that matters for a Flak Burst.
{
  const pack = Engine.createGameState({
    id: 955,
    name: "friendly fire fixture",
    board: { type: "rect", cols: 7, rows: 9 },
    playerStart: { q: 3, r: 6 },
    exit: { q: 6, r: -3 },
    outpost: null,
    enemies: [
      { type: "cruiser", q: 3, r: 2 }, // Flak Burst: every adjacent hex at once
      { type: "cutter", q: 1, r: 4 },
    ],
    hazards: [],
    exitRule: "all-enemies-dead",
  });
  const gunner = pack.enemies[0];
  const wingman = pack.enemies[1];
  // Player in contact: with nobody else touching the gunner, it fires.
  pack.playerPos = { q: gunner.q, r: gunner.r + 1 };
  assert.ok(
    Engine.computeThreatHexes(pack).has(Engine.hexKey(pack.playerPos)),
    "a clear Flak Burst threatens the hex you are standing on"
  );
  const hullBefore = pack.hull;
  Engine.applyEndTurn(pack);
  assert.ok(pack.hull < hullBefore, "and it takes the shot");

  // Now park its wingman inside the same burst. It holds fire.
  const jammed = Engine.createGameState({
    id: 954,
    name: "jammed fixture",
    board: { type: "rect", cols: 7, rows: 9 },
    playerStart: { q: 3, r: 6 },
    exit: { q: 6, r: -3 },
    outpost: null,
    enemies: [
      { type: "cruiser", q: 3, r: 2 },
      { type: "interceptor", q: 3, r: 1 }, // adjacent to the gunner, so inside its own burst
    ],
    hazards: [],
    exitRule: "all-enemies-dead",
  });
  const jammedGun = jammed.enemies[0];
  jammed.playerPos = { q: jammedGun.q, r: jammedGun.r + 1 };
  assert.strictEqual(
    Engine.computeThreatHexes(jammed).has(Engine.hexKey(jammed.playerPos)),
    false,
    "with its own wingman in the burst, the overlay stops marking that hex — the telegraph tells the truth"
  );
  const safeHull = jammed.hull;
  Engine.applyEndTurn(jammed);
  assert.strictEqual(jammed.hull, safeHull, "and it genuinely holds fire rather than eating its own");
  // The wingman moving out un-jams it — this is a position, not a permanent state.
  jammed.enemies[1].q = 0;
  jammed.enemies[1].r = 7;
  assert.ok(
    Engine.computeThreatHexes(jammed).has(Engine.hexKey(jammed.playerPos)),
    "once the wingman clears the blast, the gun is live again"
  );
}

// ---- coming back to a sector you left -----------------------------------
// A chart snapshot used to restore every contact frozen on the exact hex
// it occupied, forever: fly out and back and the board was a diorama.
{
  const board = {
    id: 958,
    name: "return fixture",
    board: { type: "rect", cols: 9, rows: 11 },
    playerStart: { q: 4, r: 8 },
    exit: { q: 8, r: -4 },
    outpost: null,
    enemies: [
      { type: "sentry", q: 2, r: 2 },
      { type: "railgun", q: 6, r: 1 },
      { type: "interceptor", q: 4, r: 3 },
      { type: "cruiser", q: 2, r: 6 },
    ],
    hazards: [],
    exitRule: "all-enemies-dead",
  };
  const st = Engine.createGameState(board);
  st.runSeed = 12345;
  const at = (type) => st.enemies.find((e) => e.type === type);
  const before = Object.fromEntries(st.enemies.map((e) => [e.type, Engine.hexKey(e)]));
  // Battle damage, and a reactor part-way through a charge.
  at("cruiser").hp = 1;
  at("railgun").energy = 1;
  // Derived, not listed: the Railgun Destroyer flies now, and a hardcoded
  // pair of names is exactly how that kind of thing goes stale.
  const drivelessKeys = st.enemies.filter((e) => !Engine.ENEMY_TYPES[e.type].ship.hasDrive).map((e) => e.type);

  Engine.reenterSector(st, { nonce: 1 });

  for (const type of drivelessKeys) {
    assert.strictEqual(
      Engine.hexKey(at(type)),
      before[type],
      `the ${type} has no engine, so it is exactly where it was — the same rule that makes it an emplacement`
    );
  }
  const driven = st.enemies.filter((e) => Engine.ENEMY_TYPES[e.type].ship.hasDrive).map((e) => e.type);
  assert.ok(
    driven.some((t) => Engine.hexKey(at(t)) !== before[t]),
    "anything with a drive has been flying, not parked"
  );
  assert.strictEqual(at("cruiser").hp, 1, "damage persists — nobody is patching hull out here");
  assert.strictEqual(
    at("railgun").energy,
    at("railgun").maxEnergy,
    "reactors refill, exactly as the flagship's does between sectors — and so fleeing a charging gun can't freeze it"
  );
  assert.ok(
    Engine.livingEnemies(st).every((e) => Engine.hexDistance(e, st.playerPos) >= 2),
    "nothing may be sitting on top of you the instant you materialise"
  );
  assert.ok(
    Engine.livingEnemies(st).every((e) => Engine.onBoard(st, e)),
    "and nothing drifted off the board"
  );
  // Drift is a short wander, not a re-roll: a re-rolled board throws away
  // everything you learned about it. Two hexes, hard ceiling.
  for (const t of ["interceptor", "cruiser"]) {
    const wasAt = before[t].split(",").map(Number);
    assert.ok(
      Engine.hexDistance(at(t), { q: wasAt[0], r: wasAt[1] }) <= 2,
      `${t} drifted at most two hexes, it did not relocate`
    );
  }
  // Drift is rolled PER SHIP, so a board reads as a patrol rather than as
  // everything shuffling in lockstep: across repeated returns some
  // contacts have moved and some haven't, and the fixed guns never do.
  {
    let anyMoved = false;
    let anyStill = false;
    for (let visit = 0; visit < 25; visit++) {
      const trip = Engine.createGameState(board);
      trip.runSeed = 4242;
      const wasAt = Object.fromEntries(trip.enemies.map((e) => [e.type, Engine.hexKey(e)]));
      Engine.reenterSector(trip, { nonce: visit });
      const find = (t) => trip.enemies.find((e) => e.type === t);
      for (const t of ["interceptor", "cruiser", "picket"]) {
        const e = find(t);
        if (!e) continue;
        if (Engine.hexKey(e) === wasAt[t]) anyStill = true;
        else anyMoved = true;
      }
      for (const e of trip.enemies.filter((x) => !Engine.ENEMY_TYPES[x.type].ship.hasDrive)) {
        const t = e.type;
        assert.strictEqual(Engine.hexKey(find(t)), wasAt[t], `the ${t} never budges — it has no engine`);
      }
    }
    assert.ok(anyMoved, "contacts do wander between visits");
    assert.ok(anyStill, "and some are found right where you left them — 0 is a legal roll");
  }

  // A cleared sector stays cleared.
  const emptied = Engine.createGameState(board);
  emptied.enemies.forEach((e) => (e.alive = false));
  Engine.reenterSector(emptied, {});
  assert.strictEqual(Engine.livingEnemies(emptied).length, 0, "nothing wanders back into a sector you emptied");
}

// Following you through a gate: only something that can actually fly, and
// only if it genuinely had you, not merely if it was alive somewhere.
{
  const chased = Engine.createGameState({
    id: 957,
    name: "follow fixture",
    board: { type: "rect", cols: 9, rows: 11 },
    playerStart: { q: 4, r: 8 },
    exit: { q: 8, r: -4 },
    outpost: null,
    enemies: [
      { type: "sentry", q: 4, r: 6 }, // bolted down, and deliberately in range
      { type: "interceptor", q: 2, r: 2 }, // can fly, but nowhere near you
    ],
    hazards: [],
    exitRule: "all-enemies-dead",
  });
  assert.deepStrictEqual(
    Engine.enemiesThatCanFollow(chased).map((e) => e.type),
    [],
    "a gun bolted to a rock follows nobody, and neither does something across the board"
  );
  // Put the chaser in contact and it comes with you.
  const chaser = chased.enemies[1];
  chaser.q = chased.playerPos.q;
  chaser.r = chased.playerPos.r - 1;
  assert.deepStrictEqual(
    Engine.enemiesThatCanFollow(chased).map((e) => e.type),
    ["interceptor"],
    "something in contact with a drive fitted can"
  );
  // It arrives as the SAME ship — the damage came with it.
  chaser.hp = 1;
  const arrivalBoard = Engine.createGameState({
    id: 956,
    name: "arrival fixture",
    board: { type: "rect", cols: 9, rows: 11 },
    playerStart: { q: 4, r: 8 },
    exit: { q: 8, r: -4 },
    outpost: null,
    enemies: [],
    hazards: [],
    exitRule: "all-enemies-dead",
  });
  arrivalBoard.runSeed = 999;
  Engine.placeArrivals(arrivalBoard, [chaser], 3);
  const landed = Engine.livingEnemies(arrivalBoard);
  assert.strictEqual(landed.length, 1, "the follower is on the new board");
  assert.strictEqual(landed[0].hp, 1, "carrying the damage you already did to it");
  assert.ok(
    Engine.hexDistance(landed[0], arrivalBoard.playerPos) >= 2,
    "and never in your lap — you always get an action first"
  );
  assert.ok(
    arrivalBoard.log.some((line) => /came through behind us/i.test(line)),
    "and it announces itself"
  );
}

// ---- routing goes AROUND the shooting -----------------------------------
// The route preview was a plain shortest-hop walk: it would run the whole
// length of a Sentry's ring because every individual step was legal, and
// the player got shot for taking the course the game drew for them. (The
// playtest harness's own pilot had been weighting this search by danger
// for months — the AI routed around kill zones while the UI didn't.)
{
  const gauntlet = {
    id: 960,
    name: "gauntlet",
    board: { type: "rect", cols: 9, rows: 11 },
    playerStart: { q: 4, r: 8 },
    exit: { q: 8, r: -4 },
    outpost: null,
    enemies: [{ type: "sentry", q: 4, r: 3 }], // parked squarely between start and goal
    hazards: [],
    exitRule: "all-enemies-dead",
  };
  const gs = Engine.createGameState(gauntlet);
  const goal = { q: 4, r: -2 }; // straight past the emplacement
  const threats = Engine.computeThreatHexes(gs);
  const zones = Engine.staticKillZones(gs);
  const countIn = (path, set) => path.filter((h) => set.has(Engine.hexKey(h))).length;

  const plain = Engine.findPath(gs, gs.playerPos, goal);
  const safe = Engine.findPath(gs, gs.playerPos, goal, { avoidThreats: true });
  assert.ok(plain && safe, "both routes exist");
  assert.ok(countIn(plain, zones) > 0, "the direct line really does cross the Sentry's live zone (else this proves nothing)");
  assert.strictEqual(countIn(safe, zones), 0, "the threat-aware route crosses NONE of it");
  assert.strictEqual(countIn(safe, threats), 0, "and stays out of every firing solution on the board");
  assert.ok(safe.length > plain.length, "which costs a few extra hexes — that is the trade, and it is worth it");
  assert.ok(Engine.posEq(safe[safe.length - 1], goal), "a detour still arrives where you tapped");
  for (let i = 1; i < safe.length; i++) {
    assert.strictEqual(Engine.isAdjacent(safe[i - 1], safe[i]), true, "every step of a detour is still one hex");
  }

  // Costs, not walls. Tap a hex INSIDE the kill zone and the route still
  // goes there — declining to plot a course at all would be far worse than
  // plotting a dangerous one.
  const insideZone = gs.boardHexes.find(
    (h) => zones.has(Engine.hexKey(h)) && !Engine.enemyAt(gs, h) && !Engine.posEq(h, gs.playerPos)
  );
  assert.ok(insideZone, "the fixture has somewhere dangerous to tap");
  const intoDanger = Engine.findPath(gs, gs.playerPos, insideZone, { avoidThreats: true });
  assert.ok(intoDanger, "a course into a kill zone is still plotted — danger is a cost, never a refusal");
  assert.ok(Engine.posEq(intoDanger[intoDanger.length - 1], insideZone), "and it arrives");

  // Weighting must never make the route DITHER. A course is re-plotted
  // every step, so if the search weighted things that move, the ship would
  // step aside to dodge a chaser, the chaser would follow, and the new
  // cheapest route would run back the way it came — measured doing exactly
  // that: two rounds, two Hull, net displacement zero. Simulate the
  // re-plot loop against a chaser that closes each round and require real
  // progress every single step.
  {
    const chase = Engine.createGameState({
      id: 959,
      name: "dither fixture",
      board: { type: "rect", cols: 9, rows: 11 },
      playerStart: { q: 4, r: 8 },
      exit: { q: 8, r: -4 },
      outpost: null,
      enemies: [{ type: "interceptor", q: 4, r: 6 }],
      hazards: [],
      exitRule: "all-enemies-dead",
    });
    const goal = { q: 4, r: 0 };
    const seen = new Set([Engine.hexKey(chase.playerPos)]);
    let last = Engine.hexDistance(chase.playerPos, goal);
    for (let step = 0; step < 12 && !Engine.posEq(chase.playerPos, goal); step++) {
      const path = Engine.findPath(chase, chase.playerPos, goal, { avoidThreats: true });
      assert.ok(path && path.length > 1, "a re-plot always finds the way on");
      chase.playerPos = { q: path[1].q, r: path[1].r };
      const key = Engine.hexKey(chase.playerPos);
      assert.ok(!seen.has(key), `the burn never revisits a hex it already flew (${key}) — that is dithering`);
      seen.add(key);
      // Not "every step closes the gap" — stepping sideways around a
      // hostile that is physically standing in the lane is correct, and
      // asserting otherwise flagged exactly that as a fault. Dithering is
      // specifically going BACK over ground already flown, which the
      // revisit check above catches on its own.
      last = Engine.hexDistance(chase.playerPos, goal);
      // The chaser closes, exactly as it would in the enemy phase.
      const toward = Engine.findPath(chase, chase.enemies[0], chase.playerPos);
      if (toward && toward.length > 1) {
        chase.enemies[0].q = toward[1].q;
        chase.enemies[0].r = toward[1].r;
      }
    }
    assert.ok(Engine.posEq(chase.playerPos, goal), "and it actually arrives while being chased the whole way");
  }

  // The weighting must never lose a route that plain pathing would find.
  // Swept across every shipped and generated sector, every reachable hex.
  let checked = 0;
  for (let depth = 1; depth <= 12; depth++) {
    const level = depth <= LEVELS.length ? LEVELS[depth - 1] : generateLevel(depth, null);
    const st = Engine.createGameState(level);
    for (const h of st.boardHexes) {
      const a = Engine.findPath(st, st.playerPos, h);
      const b = Engine.findPath(st, st.playerPos, h, { avoidThreats: true });
      assert.strictEqual(Boolean(a), Boolean(b), `depth ${depth} ${Engine.hexKey(h)}: danger-weighting must not lose a route`);
      if (b) {
        assert.ok(Engine.posEq(b[b.length - 1], h), `depth ${depth} ${Engine.hexKey(h)}: route ends where asked`);
        for (let i = 1; i < b.length; i++) assert.strictEqual(Engine.isAdjacent(b[i - 1], b[i]), true, "one hex per step");
      }
      checked++;
    }
  }
  assert.ok(checked > 500, `swept a real number of destinations (${checked})`);
}

// ---- maps as PLACES -----------------------------------------------------
// A sector should be somewhere, not a numbered room: its own colour of
// space, its own furniture, its own reasons to go there — and a fork worth
// thinking about. Come back through a wormhole four jumps later and the
// board should tell you where you are before any text does.
{
  const seen = new Map();
  let oneWayOut = 0;
  let docks = 0;
  let sectors = 0;
  for (let depth = 5; depth <= 30; depth++) {
    for (const variant of ["aggressive", "quiet", "drift"]) {
      const level = generateLevel(depth, variant);
      assert.ok(level.locale && level.locale.name, `depth ${depth} knows where it is`);
      // The boss is the one sector that doesn't fork — both roads converge
      // on it, which is the point of it.
      if (level.isBoss) continue;
      sectors++;
      assert.ok(level.exits.length >= 2, `depth ${depth} always forks — a single exit is a corridor`);
      if (level.exits.length < 3) oneWayOut++;
      if (level.outpost) docks++;
      seen.set(level.locale.id, (seen.get(level.locale.id) || 0) + 1);
      // Nothing parked on the doorstep: every gate is a real crossing.
      for (const gate of level.exits) {
        assert.ok(
          Engine.hexDistance(level.playerStart, gate) >= 6,
          `depth ${depth}: gate ${gate.variantId} is a proper distance from where you come in`
        );
      }
    }
  }
  assert.ok(seen.size >= 5, "the crawl visits genuinely different kinds of space, not one with a hue shift");
  assert.ok(oneWayOut < sectors * 0.4, "three-way forks are the common case, not the exception");
  // Not every sector trades — a dry stretch is a real thing that happens,
  // and a reason to take the other gate.
  assert.ok(docks < sectors * 0.75, "docks are not guaranteed everywhere");
  assert.ok(docks > sectors * 0.25, "...but the crawl isn't a desert either");
}

// Every sector is a NAME, not a category label. Four "The Cold Yard"s on
// one chart is a list of types; "Winter Line" and "Hollis Mausoleum" are
// two places you actually went.
{
  const names = new Set();
  let sectors = 0;
  for (let depth = 5; depth <= 30; depth++) {
    for (const variant of ["aggressive", "quiet", "drift"]) {
      const level = generateLevel(depth, variant);
      if (level.isBoss) continue;
      sectors++;
      names.add(level.name);
      assert.ok(level.name && level.name !== level.locale.name, `depth ${depth} ${variant} has a name of its own`);
    }
  }
  assert.ok(names.size > sectors * 0.6, "sector names are mostly distinct across a crawl, not a handful repeated");
  // ...and a place keeps its name: the chart you drew stays true.
  assert.equal(generateLevel(9, "quiet").name, generateLevel(9, "quiet").name);
}

// A gate advertises where it goes — honestly. Nothing in the UI says so;
// the tell is only worth learning if it's never a lie, so localeAhead must
// match the sector you actually arrive in.
{
  for (let depth = 4; depth <= 20; depth++) {
    for (const variant of ["aggressive", "quiet", "drift"]) {
      const promised = HypergolicLevels.localeAhead(depth, variant);
      const arrived = generateLevel(depth + 1, variant);
      assert.equal(promised.id, arrived.locale.id, `depth ${depth} ${variant} gate tells the truth about what's through it`);
    }
  }
  // Two gates out of the same sector shouldn't usually promise the same
  // place, or there'd be nothing to read off them.
  let differ = 0;
  let total = 0;
  for (let depth = 4; depth <= 30; depth++) {
    const a = HypergolicLevels.localeAhead(depth, "aggressive");
    const q = HypergolicLevels.localeAhead(depth, "quiet");
    total++;
    if (a.id !== q.id) differ++;
  }
  assert.ok(differ > total * 0.5, "the fork is usually a choice between two different kinds of space");
}

// The hand-authored campaign obeys the same rule as everything else. It
// used to be exempt by accident — all four sectors were 9x11, the biggest
// board in the game, with rosters of 1, 2, 2 and 3. Sector 1 in particular
// was ninety-nine hexes holding a single contact, which is the first thing
// anyone ever sees of this game.
{
  for (const level of LEVELS) {
    const area = level.board.cols * level.board.rows;
    const foes = level.enemies.length;
    assert.ok(area <= 99, `sector ${level.id} never exceeds the ceiling`);
    assert.ok(
      area <= 56 + foes * 12,
      `sector ${level.id} is sized to its ${foes}-hostile roster, not dealt the biggest board going (area ${area})`
    );
    for (const gate of [level.exit, ...(level.exits || [])].filter(Boolean)) {
      assert.ok(
        Engine.hexDistance(level.playerStart, gate) >= 6,
        `sector ${level.id}: the gate is a crossing, not a doorstep`
      );
    }
    for (const foe of level.enemies) {
      assert.ok(Engine.hexDistance(level.playerStart, foe) >= 2, `sector ${level.id}: nothing spawns in your lap`);
    }
    assert.ok(level.board.rows >= level.board.cols, `sector ${level.id} is never wider than tall — this is a portrait cockpit`);
  }
  // The opening sector is the smallest of them, because it holds the
  // smallest fight.
  const first = LEVELS[0];
  assert.strictEqual(first.enemies.length, 1, "sector 1 is still the one-contact lesson");
  assert.ok(
    first.board.cols * first.board.rows <= 60,
    "and it is dealt a board that fits one contact"
  );
}

// A sector is sized to the FIGHT it holds. Board size and roster used to
// be rolled independently and reconciled afterwards, which let a quiet
// sector deal a big empty board to trudge across. Deciding the fight
// first and then giving it a room to happen in is what makes the early
// crawl tight without making the late crawl airless. ("Smaller boards,
// particularly when there are less enemies... generally smaller boards
// in the beginning.")
{
  const shapes = new Map();
  const areaByRoster = new Map();
  for (let depth = 1; depth <= 40; depth++) {
    for (const variant of ["aggressive", "quiet", "drift"]) {
      const level = generateLevel(depth, variant);
      if (level.isBoss) continue;
      const { cols, rows } = level.board;
      assert.ok(cols <= 9 && rows <= 11, `depth ${depth} never deals a board bigger than the old fixed one`);
      assert.ok(rows >= 7, `depth ${depth} is still big enough that a gate isn't on the doorstep`);
      shapes.set(`${cols}x${rows}`, (shapes.get(`${cols}x${rows}`) || 0) + 1);
      const n = level.enemies.length;
      if (!areaByRoster.has(n)) areaByRoster.set(n, []);
      areaByRoster.get(n).push(cols * rows);
    }
  }
  assert.ok(shapes.size >= 4, "sectors come in genuinely different shapes, not one");
  // More hostiles, more room — monotonically, with no roster ever getting
  // a smaller board than a lighter one.
  const rosters = [...areaByRoster.keys()].sort((a, b) => a - b);
  assert.ok(rosters.length >= 4, "rosters genuinely vary across a crawl");
  for (let i = 1; i < rosters.length; i++) {
    const lighter = Math.max(...areaByRoster.get(rosters[i - 1]));
    const heavier = Math.max(...areaByRoster.get(rosters[i]));
    assert.ok(heavier >= lighter, `a ${rosters[i]}-hostile sector is never given less room than a ${rosters[i - 1]}-hostile one`);
  }
  // And the sectors you meet first are the small ones, because they hold
  // the smallest fights. The aggressive fork is exempt on purpose: taking
  // it early means asking for a heavier roster, and a heavier roster is
  // owed the room to fight it in — that's the deal that gate offers.
  for (let depth = 1; depth <= 4; depth++) {
    for (const variant of ["quiet", "drift"]) {
      const level = generateLevel(depth, variant);
      assert.ok(
        level.board.cols * level.board.rows <= 72,
        `depth ${depth} (${variant}) starts tight — a run should get moving straight away`
      );
    }
  }
}

// The dock moves. It used to be nailed to hex (0,0) on every single board
// in the game, which made "is there a shop" the only question a station
// ever asked. ("Why is the outpost always in the same place?")
{
  const berths = new Map();
  let docks = 0;
  for (let depth = 2; depth <= 40; depth++) {
    for (const variant of ["aggressive", "quiet", "drift"]) {
      const level = generateLevel(depth, variant);
      if (level.isBoss || !level.outpost) continue;
      docks++;
      berths.set(`${level.outpost.q},${level.outpost.r}`, true);
      assert.ok(
        Engine.hexDistance(level.playerStart, level.outpost) >= 4,
        `depth ${depth}: the dock is a trip, not something you spawn on top of`
      );
      for (const gate of level.exits) {
        assert.ok(
          Engine.hexDistance(level.outpost, gate) >= 3,
          `depth ${depth}: docking is a decision, not something you do in passing on the way out`
        );
      }
    }
  }
  assert.ok(berths.size >= 8, "stations berth all over the place, not in one corner forever");
  assert.ok(berths.size > docks * 0.25, "and no single berth dominates the crawl");
}

// ---- rare Discoveries: derelict wrecks, silent outposts, uncharted body -
// Clubhouse: "random unlikely, occasional finds... rare... an abandoned
// ship, an abandoned outpost." Pure upside, no menu — resolved the instant
// the flagship lands on the hex (see checkDiscovery/resolveDiscoveryReward
// in engine.js).
{
  // generateLevel's discoveryCandidates must always be valid, unoccupied
  // ground — never on top of an enemy, a hazard, the Outpost, a gate, or
  // the player's own start.
  let sectors = 0;
  let sectorsWithCandidates = 0;
  for (let depth = 5; depth <= 40; depth++) {
    for (const variant of ["aggressive", "quiet", "drift"]) {
      const level = generateLevel(depth, variant);
      if (level.isBoss) continue;
      sectors++;
      if ((level.discoveryCandidates || []).length) sectorsWithCandidates++;
      const occupied = new Set([
        ...level.hazards.map((h) => `${h.q},${h.r}`),
        ...level.enemies.map((e) => `${e.q},${e.r}`),
        ...(level.outpost ? [`${level.outpost.q},${level.outpost.r}`] : []),
        ...level.exits.map((ex) => `${ex.q},${ex.r}`),
        `${level.playerStart.q},${level.playerStart.r}`,
      ]);
      for (const c of level.discoveryCandidates || []) {
        assert.ok(
          !occupied.has(`${c.q},${c.r}`),
          `depth ${depth} ${variant}: a discovery candidate never overlaps another entity`
        );
      }
    }
  }
  assert.ok(
    sectorsWithCandidates > sectors * 0.8,
    "nearly every procedural sector has SOMEWHERE a Discovery could go, even on the (common) roll where none actually appears"
  );
}
// Presence/position is real per-RUN luck, not baked into the board — the
// exact bug already fixed once for the campaign Outpost (levels.js's own
// rng is seeded purely off depth/variant), guarded here so it can't
// quietly regress for Discoveries: same depth+variant, different runSeed,
// can genuinely differ on whether/where one shows up.
{
  const fixedLevel = generateLevel(15, "quiet");
  let withDiscovery = 0;
  const total = 300;
  for (let seed = 0; seed < total; seed++) {
    if (Engine.createGameState(fixedLevel, { runSeed: seed }).discoveryPos) withDiscovery++;
  }
  const rate = withDiscovery / total;
  assert.ok(
    rate > 0.03 && rate < 0.15,
    `discovery spawn rate (${(rate * 100).toFixed(1)}%) lands in the "rare, occasional" ballpark, not never and not routine`
  );
  assert.deepStrictEqual(
    Engine.createGameState(fixedLevel, { runSeed: 42 }).discoveryPos,
    Engine.createGameState(fixedLevel, { runSeed: 42 }).discoveryPos,
    "same run seed always deals the same Discovery (reproducible within a run)"
  );
}
// End-to-end: flying onto it pays out exactly once, never a downside, and
// re-crossing the (now-claimed) hex later does nothing more.
{
  function discoveryFixture(runSeed) {
    return Engine.createGameState(
      {
        id: 30,
        board: { type: "rect", cols: 7, rows: 9 },
        playerStart: { q: 3, r: 7 },
        exit: { q: 6, r: -3 },
        outpost: null,
        enemies: [],
        hazards: [],
        exitRule: "all-enemies-dead",
        discoveryCandidates: [{ q: 3, r: 3 }],
      },
      { runSeed }
    );
  }
  let hitSeed = null;
  for (let seed = 0; seed < 500 && hitSeed === null; seed++) {
    if (discoveryFixture(seed).discoveryPos) hitSeed = seed;
  }
  assert.ok(hitSeed !== null, "found a seed that rolls a Discovery on the fixture within 500 tries");
  const s = discoveryFixture(hitSeed);
  const salvageBefore = s.salvage;
  const hullBefore = s.hull;
  s.playerPos = { q: 4, r: 3 }; // adjacent — test-only teleport straight to the doorstep
  Engine.applySublight(s, s.discoveryPos);
  assert.strictEqual(s.discoveryPos, null, "a Discovery is consumed the instant it resolves");
  assert.ok(
    s.salvage > salvageBefore || s.hold.items.length + s.hold.cargo.length > 0,
    "landing on it actually granted something"
  );
  assert.ok(hullBefore === s.hull, "a Discovery is never a downside — Hull never drops from finding one");
  assert.ok(s.log.some((line) => /salvaged/.test(line)), "the find gets a log line naming what it was");
  const salvageAfterFirst = s.salvage;
  const holdAfterFirst = JSON.stringify(s.hold);
  s.playerPos = { q: 4, r: 3 };
  Engine.applySublight(s, { q: 3, r: 3 });
  assert.strictEqual(s.salvage, salvageAfterFirst, "re-crossing an already-claimed Discovery hex grants no more salvage");
  assert.strictEqual(JSON.stringify(s.hold), holdAfterFirst, "...or any more equipment");
}
// Sampled over many resolutions, the free-item half of the reward table
// never hands out a rare-tier weapon — Railgun/Flank Tubes/Mortar stay a
// paid-for, saved-up purchase, never a free roll of the dice.
{
  const rareEquipmentIds = new Set(
    Engine.OUTPOST_OFFER_POOL.filter((o) => o.rarity === "rare").map((o) => o.id)
  );
  let itemGrants = 0;
  for (let seed = 0; seed < 500; seed++) {
    const level = {
      id: 30, // depth 30: every weapon (including every rare one) is otherwise eligible by depth
      board: { type: "rect", cols: 9, rows: 11 },
      playerStart: { q: 4, r: 8 },
      exit: { q: 8, r: -4 },
      outpost: null,
      enemies: [],
      hazards: [],
      exitRule: "all-enemies-dead",
      discoveryCandidates: [{ q: 4, r: 4 }],
    };
    const s = Engine.createGameState(level, { runSeed: seed });
    if (!s.discoveryPos) continue;
    s.playerPos = { q: 5, r: 4 };
    Engine.applySublight(s, s.discoveryPos);
    const grant = s.events.find((e) => e.type === "discovery" && e.kind === "item");
    if (!grant) continue;
    itemGrants++;
    assert.ok(
      !rareEquipmentIds.has(grant.itemId),
      `a Discovery granted "${grant.itemId}" for free, which is rare-tier — that's meant to stay a paid purchase`
    );
  }
  assert.ok(itemGrants > 0, "at least some Discoveries across the sample actually granted a free item, not always salvage");
}

// A locale is a real difference, not a paint job: what's out there changes
// what the sector is made of.
{
  const tally = {};
  for (let depth = 5; depth <= 40; depth++) {
    const level = generateLevel(depth, "quiet");
    const t = (tally[level.locale.id] = tally[level.locale.id] || { rocks: 0, foes: 0, n: 0 });
    t.rocks += level.hazards.length;
    t.foes += level.enemies.length;
    t.n++;
  }
  const ids = Object.keys(tally);
  assert.ok(ids.length >= 3, "a decent spread of locales shows up across a run's worth of depths");
  const rockRates = ids.map((id) => tally[id].rocks / tally[id].n);
  assert.ok(
    Math.max(...rockRates) - Math.min(...rockRates) >= 1,
    "different places genuinely have different amounts of cover in them"
  );
}

// ---- procedural depth: the run never hard-stops past the campaign -------
// generateLevel(depth) must produce a valid LevelDef for a wide range of
// depths — validateLevel (run inside createGameState) throws if anything's
// off-board, overlapping, or too close to the player start.

// Not every generated sector has an Outpost anymore (~60% do — a
// guaranteed safe restock every time made runs "too easy and not very
// interesting"), so check presence varies across a wide depth range
// instead of asserting every single one has one.
let outpostCount = 0;
for (const depth of [6, 7, 10, 15, 25, 40]) {
  const level = generateLevel(depth);
  const s = Engine.createGameState(level); // throws if invalid
  assert.strictEqual(s.status, "playing", `generated depth ${depth} should start playable`);
  assert.strictEqual(s.exitUnlocked, true, `generated depth ${depth} starts with the gate online too`);
  assert.ok(s.enemies.length > 0, `generated depth ${depth} should have at least one enemy`);
  if (s.outpostPos) outpostCount += 1;
}
assert.ok(outpostCount > 0 && outpostCount < 6, "outposts appear sometimes but not on every generated sector");
// Same depth deals the same board every time (reproducible runs).
assert.deepStrictEqual(generateLevel(12), generateLevel(12), "generateLevel is deterministic per depth");
// Different depths are not just reskins of each other. (Depth 20 is the
// fixed boss milestone — see below — so this compares two purely
// procedural depths instead.)
assert.notDeepStrictEqual(generateLevel(6).enemies, generateLevel(21).enemies, "deeper sectors deal a different board");
assert.ok(generateLevel(21).enemies.length >= generateLevel(6).enemies.length, "enemy count scales up (or holds) with depth");

// ---- Boss milestone: "how do you win, or is it just runs?" --------------
// Depth 20 is a single, fixed "Run Complete" moment, not another
// procedural roll and not a repeating pattern.
const bossLevelDef = generateLevel(BOSS_DEPTH);
assert.strictEqual(bossLevelDef.isBoss, true, "the boss depth is the boss sector");
assert.strictEqual(bossLevelDef.name, "The Bulwark");
assert.ok(bossLevelDef.outpost, "the boss sector has a guaranteed Outpost — shop before the fight");
assert.deepStrictEqual(generateLevel(BOSS_DEPTH, "aggressive"), generateLevel(BOSS_DEPTH), "the boss ignores variantId — no branching into it");
assert.notStrictEqual(generateLevel(BOSS_DEPTH - 1).isBoss, true, "the depth before it is still purely procedural");
assert.notStrictEqual(generateLevel(BOSS_DEPTH + 1).isBoss, true, "past the boss is purely procedural too — one milestone, not a repeating pattern");

const bossState = Engine.createGameState(bossLevelDef);
assert.strictEqual(bossState.isBoss, true);
assert.strictEqual(bossState.isVictory, false, "not won yet");
// The Warp Gate is always online (combat is optional everywhere, boss
// sectors included — see checkExitUnlock), so reaching it is enough to
// win; combat itself is already covered thoroughly elsewhere in this
// file. This test only cares whether clearing a BOSS sector flips
// isVictory, not how the fight plays out.
bossState.playerPos = { q: bossLevelDef.exit.q, r: bossLevelDef.exit.r };
bossState.energy = 0; // any turn-ending action triggers the win check — RECHARGE is the stationary one
Engine.applyRecharge(bossState);
assert.strictEqual(bossState.status, "won", "reaching the gate wins, same as any other sector");
assert.strictEqual(bossState.isVictory, true, "clearing the BOSS sector sets isVictory — a real Run Complete, not a routine clear");

// ---- Branching Warp Gates: "different sort of paths... based on the ------
// different portals" (Clubhouse feedback) — every generated sector offers
// 2 exits, each biasing what comes next, deterministically per variant.
const branchLevel = generateLevel(30);
assert.ok(
  branchLevel.exits.length >= 2 && branchLevel.exits.length <= 3,
  "a generated sector offers 2 or 3 Warp Gates"
);
assert.deepStrictEqual(branchLevel.exit, branchLevel.exits[0], "the singular `exit` field is just the first gate, for single-exit callers");
const branchIds = branchLevel.exits.map((e) => e.variantId);
assert.deepStrictEqual(new Set(branchIds).size, branchLevel.exits.length, "every gate is tagged with a distinct variant id");
// The maze mixes fork sizes ("should have multiple directions — that's
// how it's a maze"): across a run of depths, some sectors deal 2 gates
// and some deal 3 — never a uniform ladder.
const gateCounts = new Set();
for (let depth = 21; depth <= 40; depth++) gateCounts.add(generateLevel(depth).exits.length);
assert.ok(gateCounts.has(2) && gateCounts.has(3), "both 2-gate and 3-gate sectors occur across depths");
// The third direction is a real destination: arriving THROUGH a drift
// gate deals a valid, deterministic sector like any other variant.
assert.deepStrictEqual(generateLevel(31, "drift"), generateLevel(31, "drift"), "drift arrivals are deterministic");
Engine.createGameState(generateLevel(31, "drift")); // throws if invalid

const branchState = Engine.createGameState(branchLevel);
assert.strictEqual(branchState.exits.length, branchLevel.exits.length, "state.exits mirrors every one of the level's gates");
assert.ok(Engine.posEq(branchState.exitPos, branchState.exits[0]), "state.exitPos is still the primary/first gate");
assert.strictEqual(branchState.usedExitVariant, null, "no gate has been used yet");

// "Aggressive" and "quiet" arrivals at the SAME depth deal different boards
// — the incoming variant is folded into the seed, not just a label.
const aggressive = generateLevel(31, "aggressive");
const quiet = generateLevel(31, "quiet");
assert.notDeepStrictEqual(aggressive.enemies, quiet.enemies, "different incoming variants deal genuinely different boards at the same depth");
assert.ok(aggressive.enemies.length >= quiet.enemies.length, "the 'aggressive' variant never has fewer enemies than 'quiet' at the same depth");
assert.deepStrictEqual(generateLevel(31, "aggressive"), generateLevel(31, "aggressive"), "a given depth+variant pair is still fully deterministic");

// Flying through the SECOND gate (not just the first) is what advanceSector
// reads to pick the next sector's variant — see app.js.
const secondGateLevel = {
  id: 989,
  board: { type: "rect", cols: 5, rows: 5 },
  playerStart: { q: 2, r: 3 }, // bottom of the middle column (col 2: r ranges -1..3)
  exits: [
    { q: 4, r: -2, variantId: "aggressive" }, // top of the rightmost column (col 4: r ranges -2..2)
    { q: 2, r: -1, variantId: "quiet" }, // top of the middle column
  ],
  outpost: null,
  enemies: [],
  hazards: [],
  exitRule: "all-enemies-dead",
};
const secondGateState = Engine.createGameState(secondGateLevel);
let cur = secondGateState.playerPos;
while (!Engine.posEq(cur, secondGateLevel.exits[1])) {
  const step = Engine.legalSublightTargets(secondGateState).reduce((best, cand) => {
    const d = Engine.hexDistance(cand, secondGateLevel.exits[1]);
    return !best || d < best.d ? { to: cand, d } : best;
  }, null).to;
  Engine.applySublight(secondGateState, step);
  cur = secondGateState.playerPos;
}
assert.strictEqual(secondGateState.status, "won", "reaching either gate completes the sector");
assert.strictEqual(secondGateState.usedExitVariant, "quiet", "usedExitVariant records exactly which gate was actually used");

// ---- Energy: one reactor model for everything ----------------------------
// ("make everything work within the system") — Energy regenerates 1/turn
// (distinct from Hull, which never self-heals) and pays for EVERY weapon
// shot, the flagship's and every enemy's. A weapon that would fire but
// can't afford its cost holds fire, with a log line explaining why.

const energyLevel = {
  id: 990,
  name: "energy fixture",
  board: { type: "rect", cols: 5, rows: 8 },
  playerStart: { q: 2, r: 5 },
  exit: { q: 4, r: -2 },
  outpost: null,
  enemies: [{ type: "cruiser", q: 2, r: 2 }],
  hazards: [],
  exitRule: "all-enemies-dead",
};
let energyState = Engine.createGameState(energyLevel, { extraActions: ["arcBeam"] });
assert.strictEqual(energyState.energy, 6, "a fresh run starts at full Energy");
assert.strictEqual(energyState.maxEnergy, 6);
// Energy is a pure budget now — nothing regenerates passively, every
// shot draws it down, and only RECHARGE or a warp jump refills it.
assert.ok(Engine.WEAPONS.arcBeam.energyCost > Engine.WEAPONS.autocannon.energyCost, "the Arc Beam is thirstier than the Autocannon — reach costs");

// One action fires ONE gun — you pick which ("was supposed to show each
// option... otherwise you have to choose"). Naming it spends exactly that
// weapon's charge and nothing else.
energyState.enemies[0].q = 2;
energyState.enemies[0].r = 3; // two straight up — on the Arc Beam's shell, not inside it
Engine.setFacing(energyState, 2);
Engine.applyFire(energyState, "e0", "arcBeam");
assert.strictEqual(energyState.enemies[0].alive, false, "the named gun fired — and only it");
assert.strictEqual(
  energyState.energy,
  6 - Engine.WEAPONS.arcBeam.energyCost,
  "the Arc Beam's charge came off the bus; the Autocannon never fired, so it cost nothing"
);
assert.ok(
  energyState.events.some((e) => e.type === "energySpend"),
  "a paid shot emits an energySpend event — the UI floats the cost so the drain is visible in the moment"
);

// Naming a gun that can't reach is a refusal, not a silent substitution.
// (Everything is one-shot now, so put the target back on its feet first —
// otherwise FIRE refuses for having nothing to shoot at, which is a
// different refusal than the one under test.)
energyState.enemies[0].alive = true;
energyState.enemies[0].hp = energyState.enemies[0].maxHp;
assert.throws(
  () => Engine.applyFire(energyState, "e0", "railgun"),
  /isn't fitted/,
  "you can't fire a gun the ship isn't carrying"
);

// With no gun named, a ship fires the cheapest thing that bears — a
// one-weapon ship should never be asked to choose.
energyState = Engine.createGameState(energyLevel, { extraActions: ["arcBeam"] });
energyState.enemies[0].q = 2;
energyState.enemies[0].r = 4;
Engine.setFacing(energyState, 2);
Engine.applyFire(energyState);
assert.strictEqual(
  energyState.energy,
  6 - Engine.WEAPONS.autocannon.energyCost,
  "unspecified FIRE takes the cheapest gun that bears"
);

// A gun you can't afford refuses by name rather than quietly doing nothing.
energyState = Engine.createGameState(energyLevel, { extraActions: ["arcBeam"] });
energyState.enemies[0].q = 2;
energyState.enemies[0].r = 3; // on the Arc Beam's shell, so the refusal is about charge
energyState.energy = 1;
Engine.setFacing(energyState, 2);
assert.throws(
  () => Engine.applyFire(energyState, "e0", "arcBeam"),
  /charge at 1 of 2/,
  "an unaffordable gun says what it's short of"
);

// A MOVE spends no Energy at all.
energyState = Engine.createGameState(energyLevel);
const energyBeforeEmptyTurn = energyState.energy;
Engine.applySublight(energyState, { q: 2, r: 4 }); // cruiser is 2 hexes away — nothing fires either side
assert.strictEqual(energyState.energy, energyBeforeEmptyTurn, "a MOVE turn touches no Energy — no spend, no regen");

// ---- Enemy reactors: the Railgun's charge-up telegraph -------------------
// Enemies run the same energy rules. A cost-1 chaser regens its shot every
// turn (fires exactly as often as before energy existed); the cost-4
// Railgun spawns EMPTY and visibly charges 4 turns between shots, then
// hits for 2 — the design doc's "telegraphs the line" made real through
// the shared system, and it's the same item you can buy for 30 salvage.

// Roomy enough that the lane guarantee (see openALane) has no reason to
// touch the emplacement — this fixture is about the charge rhythm, and a
// board where the gun's lanes cover every approach is a different test.
const railgunEnergyLevel = {
  id: 988,
  name: "railgun energy fixture",
  board: { type: "rect", cols: 9, rows: 11 },
  playerStart: { q: 4, r: 8 },
  exit: { q: 8, r: -4 },
  outpost: null,
  enemies: [{ type: "railgun", q: 4, r: 3 }], // same column: on-axis, in range from spawn
  hazards: [],
  exitRule: "all-enemies-dead",
};
const railgunEnergyState = Engine.createGameState(railgunEnergyLevel);
assert.strictEqual(railgunEnergyState.enemies[0].energy, 0, "a Railgun spawns with an empty reactor — it can't snipe on turn 1");
assert.strictEqual(Engine.computeThreatHexes(railgunEnergyState).size, 0, "a charging Railgun threatens nothing — the overlay shows only what can actually fire next turn");

const hullTimeline = [];
for (let t = 1; t <= 8; t++) {
  Engine.applyEndTurn(railgunEnergyState); // hold position — one full round per END TURN
  hullTimeline.push(railgunEnergyState.hull);
}
// Written against START_HULL rather than the literal 3 it used to assume,
// so the ship's hull can move without this failing for the wrong reason.
// What is being asserted is the RHYTHM: nothing for five rounds, then two
// hull at once.
const H = Engine.START_HULL;
assert.deepStrictEqual(
  hullTimeline,
  [H, H, H, H, H, H - 2, H - 2, H - 2],
  "the Railgun charges five rounds, then takes 2 Hull in one shot — a readable rhythm, not a constant beam"
);

// Once charged, its whole line lights up in the threat overlay again.
const chargedRailgunState = Engine.createGameState(railgunEnergyLevel);
chargedRailgunState.enemies[0].energy = Engine.WEAPONS.railgun.energyCost;
assert.ok(Engine.computeThreatHexes(chargedRailgunState).size > 0, "a fully-charged Railgun's line is a live threat");

// ---- Phases are sequential; `speed` orders each side's own barrage ------
// Under the AP round model your FIRE resolves immediately in YOUR phase —
// a kill removes the target before its phase ever comes, whatever its
// weapon's speed. The speed stat still orders the shots WITHIN a volley
// (fast weapons claim Energy and targets first) and within the enemy
// phase's barrage.
assert.strictEqual(Engine.WEAPONS.autocannon.speed, 3, "the Autocannon is FAST — fires first in a volley");
assert.strictEqual(Engine.WEAPONS.flakBurst.speed, 2, "the Flak Burst is STANDARD");
assert.strictEqual(Engine.WEAPONS.arcBeam.speed, 2, "so is the Arc Beam");
assert.strictEqual(Engine.WEAPONS.railgun.speed, 1, "the Railgun is HEAVY — fires last in a volley");

const initiativeLevel = {
  id: 986,
  name: "phase fixture",
  board: { type: "rect", cols: 5, rows: 8 },
  playerStart: { q: 2, r: 5 },
  exit: { q: 4, r: -2 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 2, r: 3 }],
  hazards: [],
  exitRule: "all-enemies-dead",
  actions: ["sublight"], // no Autocannon — the Railgun only, via extraActions below
};
// Even the slowest weapon kills WITHOUT a reply now — the target dies in
// your phase and never gets its own.
const slowInitState = Engine.createGameState(initiativeLevel, { extraActions: ["railgun"] });
slowInitState.enemies[0].q = 2;
slowInitState.enemies[0].r = 4; // adjacent, directly up
Engine.setFacing(slowInitState, 2);
Engine.applyFire(slowInitState);
assert.strictEqual(slowInitState.enemies[0].alive, false, "the Railgun kills its target");
assert.strictEqual(slowInitState.hull, Engine.START_HULL, "a kill in your phase means no reply — phases are sequential, not simultaneous");

// One action per round means closing the gap is its own turn — approach
// a charged interceptor to adjacency and it fires when your turn
// commits; the NEXT round, your FIRE kills it before it acts again.
const tradeState = Engine.createGameState({ ...initiativeLevel, id: 985, actions: ["sublight", "autocannon"] });
tradeState.enemies[0].q = 2;
tradeState.enemies[0].r = 3; // distance 2, dead ahead
Engine.applySublight(tradeState, { q: 2, r: 4 }); // close to adjacent — the round commits
assert.strictEqual(tradeState.hull, Engine.START_HULL - 1, "ending your turn beside a charged chaser eats its shot");
Engine.applyFire(tradeState); // your phase first: the kill lands before its next shot
assert.strictEqual(tradeState.enemies[0].alive, false, "the next round's FIRE kills it");
assert.strictEqual(tradeState.hull, Engine.START_HULL - 1, "with no reply — the dead don't get a phase");
assert.strictEqual(tradeState.turnCount, 2, "the exchange took two full rounds");

// The enemy phase runs on the same 1-AP budget: a chaser out of range
// spends its round closing, and fires the round it can.
const closerState = Engine.createGameState({ ...initiativeLevel, id: 984 });
closerState.enemies[0].q = 2;
closerState.enemies[0].r = 3; // distance 2 — outside a contact weapon's reach
Engine.applyEndTurn(closerState); // hold: its phase spends its one point closing
assert.strictEqual(
  Engine.isAdjacent(closerState.enemies[0], closerState.playerPos),
  true,
  "the chaser closed a hex"
);
assert.strictEqual(closerState.hull, Engine.START_HULL, "moving was its whole turn — no shot yet");
Engine.applyEndTurn(closerState); // hold again: now it fires
assert.strictEqual(closerState.hull, Engine.START_HULL - 1, "the following round it spends its point on the shot");

// A cost-1 gun against a cost-1 reactor now ALTERNATES fire and recharge
// rounds — same "1 to 1, nothing for free" rule the flagship's own
// Reactor Core plays by: a shot that empties the bus costs the round
// after it too, spent refilling instead of firing again. Recharging used
// to tick for free every round no matter what the enemy's action was, so
// a cost-1 gun never had a gap; now the round it recharges is a round it
// doesn't shoot, exactly like a player who has to spend a turn on Reactor
// Core instead of firing back.
const chaserEnergyLevel = {
  id: 987,
  name: "chaser energy fixture",
  board: { type: "rect", cols: 5, rows: 8 },
  playerStart: { q: 2, r: 5 },
  exit: { q: 4, r: -2 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 2, r: 3 }],
  hazards: [],
  exitRule: "all-enemies-dead",
  actions: ["sublight"], // no Autocannon — let it survive to attack repeatedly
};
const chaserEnergyState = Engine.createGameState(chaserEnergyLevel);
const chaserHullTimeline = [];
for (let t = 1; t <= 6; t++) {
  Engine.applyEndTurn(chaserEnergyState);
  chaserHullTimeline.push(chaserEnergyState.hull);
}
const CH = Engine.START_HULL;
assert.deepStrictEqual(
  chaserHullTimeline,
  [CH, CH - 1, CH - 1, CH - 2, CH - 2, CH - 3],
  "closes round 1, then alternates a shot with a recharge round — no shot two rounds running"
);

// ---- Asteroid fields: genuinely impassable terrain, distinct from a ------
// blackhole's instant-destruction trap. Clubhouse feedback: "places you
// can't hit... asteroid fields" — a wall, not just more damage.
const terrainLevel = {
  id: 989,
  radius: 3,
  playerStart: { q: 0, r: 0 },
  exit: { q: 3, r: 0 },
  outpost: null,
  enemies: [],
  hazards: [
    { type: "asteroid", q: 1, r: 0 },
    { type: "blackhole", q: -1, r: 0 },
  ],
  exitRule: "all-enemies-dead",
};
const terrainState = Engine.createGameState(terrainLevel);
assert.ok(
  !Engine.legalSublightTargets(terrainState).some((h) => Engine.posEq(h, { q: 1, r: 0 })),
  "an asteroid field is not a legal move target at all"
);
assert.throws(
  () => Engine.applySublight(terrainState, { q: 1, r: 0 }),
  /Rock in the way/,
  "moving into an asteroid field is refused outright, not just punished"
);
assert.ok(
  Engine.legalSublightTargets(terrainState).some((h) => Engine.posEq(h, { q: -1, r: 0 })),
  "a blackhole IS a legal (if lethal) move target — the original instant-destruction trap"
);
const blackholeState = Engine.createGameState(terrainLevel);
Engine.applySublight(blackholeState, { q: -1, r: 0 });
assert.strictEqual(blackholeState.status, "lost", "entering a blackhole is still instant destruction");

// ---- Wormhole: an in-world way back, not a UI button --------------------
// Clubhouse feedback: "it should be, like... a wormhole sort of thing" —
// only present when there's actually a previous sector to return to, and
// its position isn't fixed ("shouldn't always just end up in the exact
// same place").
const wormholeLevel = {
  id: 988,
  radius: 3,
  playerStart: { q: 0, r: 0 },
  exit: { q: 3, r: 0 },
  outpost: null,
  enemies: [],
  hazards: [],
  exitRule: "all-enemies-dead",
};
const noHistoryState = Engine.createGameState(wormholeLevel);
assert.strictEqual(noHistoryState.wormholePos, null, "no wormhole on the very first sector — nothing to go back to");
assert.strictEqual(Engine.wormholeAvailable(noHistoryState), false);

const withHistoryState = Engine.createGameState(wormholeLevel, { hasPrevious: true });
assert.ok(withHistoryState.wormholePos, "a wormhole appears once a previous sector exists");
assert.ok(
  Engine.onBoard(withHistoryState, withHistoryState.wormholePos),
  "the wormhole always lands on a valid board hex"
);
assert.ok(
  !Engine.posEq(withHistoryState.wormholePos, withHistoryState.exitPos),
  "the wormhole doesn't overlap the Warp Gate"
);
// "When you come out the other side of the wormhole, you start as if
// you're on top of that wormhole, not next to it" — the flagship spawns
// standing directly on the portal it arrived through, and it's
// immediately usable from the engine's point of view (wormholeAvailable
// is a pure position check). Suppressing an instant bounce-back on the
// very first action taken after arrival is a UI-timing concern app.js's
// handleAction owns, not something the engine needs to know about — see
// the browser.test.js coverage for that.
assert.ok(
  Engine.posEq(withHistoryState.wormholePos, withHistoryState.playerPos),
  "the flagship arrives standing exactly on the portal it came through"
);
assert.strictEqual(
  Engine.wormholeAvailable(withHistoryState),
  true,
  "available immediately on arrival, since the flagship is already standing on it"
);

// Different level ids place the wormhole at different spots — deterministic
// per id (reproducible), but not hardcoded to one fixed hex.
const positions = new Set();
for (let id = 500; id < 510; id++) {
  const s = Engine.createGameState({ ...wormholeLevel, id }, { hasPrevious: true });
  positions.add(Engine.hexKey(s.wormholePos));
}
assert.ok(positions.size > 1, "the wormhole's position varies across levels, not fixed at one spot");
assert.deepStrictEqual(
  Engine.createGameState({ ...wormholeLevel, id: 505 }, { hasPrevious: true }).wormholePos,
  Engine.createGameState({ ...wormholeLevel, id: 505 }, { hasPrevious: true }).wormholePos,
  "the same level id always places the wormhole at the same spot (reproducible)"
);

// ---- Demolition charges: the one weapon that threatens GROUND ----------
// Everything else in the roster says "don't be standing here when I fire".
// A charge says "this ground is going away" — it does no damage at all the
// round it's used, and two rounds later it takes the hex it landed on and
// all six around it, whoever is in them.
{
  const bombLevel = {
    id: 970,
    name: "charge fixture",
    board: { type: "rect", cols: 9, rows: 11 },
    playerStart: { q: 4, r: 6 },
    exit: { q: 8, r: -4 },
    outpost: null,
    enemies: [{ type: "demolitionist", q: 4, r: 4 }],
    hazards: [],
    exitRule: "all-enemies-dead",
  };

  const charge = Engine.WEAPONS.demolitionCharge;
  assert.ok(charge.places, "a charge is PLACED, not fired at somebody");
  assert.strictEqual(charge.blast, 1, "and what it takes is a full ring around where it lands");

  // The blast is seven hexes: the one it sits on, and the six touching it.
  const blastState = Engine.createGameState(bombLevel);
  const blast = Engine.chargeBlastHexes(blastState, { q: 4, r: 4, blast: 1 });
  assert.strictEqual(blast.length, 7, "seven hexes — its own and the six around it");
  assert.ok(
    blast.every((h) => Engine.hexDistance({ q: 4, r: 4 }, h) <= 1),
    "and nothing further out than one"
  );

  // THE FUSE HAS TO OUTLAST THE RADIUS. A charge is thrown during the enemy
  // phase and its fuse ticks at the end of that same phase, so a flat
  // two-round fuse left exactly ONE move to clear a blast that reaches one
  // hex in every direction — which is impossible, because one step from the
  // centre is still inside it. Being caught by a bomb has to be a decision.
  {
    let st = Engine.createGameState(bombLevel);
    st.enemies[0].energy = charge.energyCost;
    st.playerPos = { q: 4, r: 4 }; // standing two off the thrower, inside its throw ring
    st.enemies[0].q = 4;
    st.enemies[0].r = 2;
    st.energy = 0; // so Recharge is a legal way to spend the turn
    Engine.applyRecharge(st); // burn a turn so the enemy phase runs
    assert.ok(Engine.chargedHexes(st).size > 0, "the Demolitionist threw one, and the board can see where it will go off");
    assert.ok(
      Engine.chargedHexes(st).has(Engine.hexKey(st.playerPos)),
      "it threw it AT us — this fixture is worthless if we aren't standing in the blast"
    );
    const start = { q: st.playerPos.q, r: st.playerPos.r };
    let moves = 0;
    while (Engine.chargedHexes(st).has(Engine.hexKey(st.playerPos)) && st.status === "playing" && moves < 6) {
      const away = Engine.legalSublightTargets(st).reduce(
        (best, h) => (!best || Engine.hexDistance(h, start) > Engine.hexDistance(best, start) ? h : best),
        null
      );
      Engine.applySublight(st, away);
      moves += 1;
    }
    assert.ok(moves <= 2, `two moves is enough to walk out of a blast (took ${moves})`);
    assert.strictEqual(st.status, "playing", "and walking out of it means you are not in it when it goes");
  }

  // It kills its own side just as happily — which is exactly why the class
  // that carries one refuses to throw it near a friend (below).
  {
    const st = Engine.createGameState(bombLevel);
    st.enemies.push({ ...st.enemies[0], id: "e9", q: 4, r: 5, alive: true, hp: 1, maxHp: 1, energy: 0, shieldCharges: 0 });
    const bystander = st.enemies[st.enemies.length - 1];
    st.charges = [{ id: "c1", q: 4, r: 5, damage: 1, blast: 1, fuse: 1, ownerId: st.enemies[0].id }];
    st.energy = 0;
    Engine.applyRecharge(st);
    assert.strictEqual(bystander.alive, false, "a charge does not care whose side is standing in it");
  }
}

// ---- Inhibitions: Hoplite's real lesson ---------------------------------
// Every demon in Hoplite has a hole AND a rule its own side can trigger, so
// crowds make its enemies WEAKER and positioning is about jamming them
// against each other. We had exactly one of these, buried in the weapons
// (a spread gun holds fire rather than catching a friend). These are the
// per-class ones.
{
  const inhLevel = {
    id: 971,
    name: "inhibition fixture",
    board: { type: "rect", cols: 9, rows: 11 },
    playerStart: { q: 4, r: 8 },
    exit: { q: 8, r: -4 },
    outpost: null,
    enemies: [{ type: "demolitionist", q: 4, r: 5 }],
    hazards: [],
    exitRule: "all-enemies-dead",
  };

  // blastSafe — the Demolitionist will not throw one that would take a
  // friend with it. Stand next to another hostile and the bomb never comes,
  // which makes a crowd the one place a bomber can't reach you.
  {
    const alone = Engine.createGameState(inhLevel);
    alone.enemies[0].energy = Engine.WEAPONS.demolitionCharge.energyCost;
    alone.enemies[0].q = alone.playerPos.q;
    alone.enemies[0].r = alone.playerPos.r - 2;
    alone.energy = 0;
    Engine.applyRecharge(alone);
    assert.ok(Engine.chargedHexes(alone).size > 0, "on its own it throws");

    const crowded = Engine.createGameState(inhLevel);
    crowded.enemies[0].energy = Engine.WEAPONS.demolitionCharge.energyCost;
    crowded.enemies[0].q = crowded.playerPos.q;
    crowded.enemies[0].r = crowded.playerPos.r - 2;
    crowded.enemies.push({
      ...crowded.enemies[0], id: "e9", type: "interceptor",
      q: crowded.playerPos.q, r: crowded.playerPos.r - 1, energy: 0,
    });
    crowded.energy = 0;
    Engine.applyRecharge(crowded);
    assert.strictEqual(
      Engine.chargedHexes(crowded).size,
      0,
      "with one of its own beside the target it holds the charge — a crowd switches a bomber off"
    );
  }

  // loner — the Railgun Destroyer won't fire at all while another hostile
  // is close to IT. The counter is to bring its own side to it, which is
  // the opposite of what every other threat on the board teaches.
  {
    const solo = Engine.createGameState({ ...inhLevel, enemies: [{ type: "railgun", q: 4, r: 0 }] });
    solo.enemies[0].energy = Engine.WEAPONS.railgun.energyCost;
    solo.playerPos = { q: 4, r: 4 }; // straight down its lane
    assert.ok(
      Engine.computeThreatHexes(solo).has(Engine.hexKey(solo.playerPos)),
      "alone, its lane is live"
    );

    const escorted = Engine.createGameState({
      ...inhLevel,
      enemies: [{ type: "railgun", q: 4, r: 0 }, { type: "interceptor", q: 4, r: 1 }],
    });
    escorted.enemies[0].energy = Engine.WEAPONS.railgun.energyCost;
    escorted.playerPos = { q: 4, r: 4 };
    assert.strictEqual(
      Engine.computeThreatHexes(escorted).has(Engine.hexKey(escorted.playerPos)),
      false,
      "with a wingman inside three of it, the lane goes quiet — and the overlay says so"
    );
  }
}

console.log("All golden-path assertions passed.");
