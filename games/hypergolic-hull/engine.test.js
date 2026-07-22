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
// mistake/correct damage branch, Tractor Beam, and the
// exit-unlock/level-complete flow — just with room for the new aiming rule
// to actually land a shot.
"use strict";

const assert = require("assert");
const Engine = require("./engine.js");
const { LEVELS, generateLevel } = require("./levels.js");

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
// directly on the Shockwave lesson.
assert.ok(LEVELS.length >= 4, "expected the four-sector tutorial campaign");
assert.deepStrictEqual(LEVELS[0].actions, ["sublight", "ramming"], "Sector 1 teaches Sublight + the Shockwave together");
assert.strictEqual(LEVELS[0].enemies.length, 1, "Sector 1 has exactly one Interceptor to learn the Shockwave on");
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
assert.deepStrictEqual(Engine.legalTractorTargets(tutorialState), [], "locked tractor offers no targets");
assert.throws(
  () => Engine.applyTractor(tutorialState, "e0"),
  /not unlocked/,
  "locked actions must refuse to run"
);
assert.strictEqual(tutorialState.enemies[0].alive, true, "the refused action must not change state");

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
  actions: ["sublight", "ramming", "tractor"], // Tractor Beam is purchase-only now (see PURCHASABLE_ACTIONS) — explicit here since this fixture tests the push mechanic itself, not the unlock gate
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

// Tractor push off a rect edge kills, and emits a kill event for the renderer.
rectState.playerPos = { q: 2, r: 1 }; // adjacent to the edge enemy at (3,1), pushing right off the board
Engine.applyTractor(rectState, "e0");
assert.strictEqual(rectState.enemies[0].alive, false, "pushing an enemy off a rect edge destroys it");
assert.ok(rectState.events.some((e) => e.type === "kill"), "kills emit a kill event");

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
Engine.applySublight(meleeState, { q: 2, r: 2 }); // step adjacent (straight up, direction 2): interceptor attacks
assert.strictEqual(meleeState.hull, 2, "a strike now costs 1 of 3 Hull — no longer instant death");
assert.strictEqual(meleeState.status, "playing", "with 3 Hull the run survives a single hit");
assert.ok(meleeState.events.some((e) => e.type === "attack"), "attacks emit an attack event");
assert.ok(meleeState.events.some((e) => e.type === "damage"), "damage emits a damage event");

// The killing blow still ends the run and emits playerDeath — it just takes
// three hits now instead of one.
const deathState = Engine.createGameState(meleeLevel);
deathState.hull = 1;
Engine.applySublight(deathState, { q: 2, r: 2 });
assert.strictEqual(deathState.status, "lost", "the final hit still ends the run");
assert.ok(deathState.events.some((e) => e.type === "playerDeath"), "lethal damage emits a playerDeath event");
assert.ok(
  meleeState.events.some((e) => e.type === "playerMove" && e.to.q === 2 && e.to.r === 2),
  "player moves emit a playerMove event (drives the flight animation)"
);

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

// ---- steps 1-3: three Sublight moves close in on Interceptor 2 (e1) along
// a single approach line. The Impulse Cannon only fires dead ahead of the
// flagship's current facing (not omnidirectionally), so e1 has to actually
// end up directly in front after a move, not just anywhere in range —
// that's what step 3's move achieves. Interceptor 1 (e0) is closing in from
// a different angle the whole time and isn't yet adjacent when e1 dies.

let state = Engine.createGameState(goldenLevel);
assert.strictEqual(state.hull, 3, "the flagship starts a run with 3 Hull");
assert.strictEqual(Engine.livingEnemies(state).length, 2);
assert.strictEqual(state.exitUnlocked, true, "the Warp Gate is online from the start — clearing enemies is optional, for salvage only");

Engine.applySublight(state, { q: 1, r: -1 });
Engine.applySublight(state, { q: 2, r: -2 });
assert.strictEqual(state.hull, 3, "no shot has lined up yet — no damage taken closing in");
assert.strictEqual(Engine.livingEnemies(state).length, 2, "both Interceptors still alive before the lined-up shot");

Engine.applySublight(state, { q: 2, r: -1 });

assert.deepStrictEqual(state.playerPos, { q: 2, r: -1 });
assert.strictEqual(state.enemies.find((e) => e.id === "e1").alive, false, "Interceptor 2 should be destroyed once dead ahead of the flagship");
assert.strictEqual(Engine.livingEnemies(state).length, 1);
assert.strictEqual(state.hull, 3, "the Shockwave resolves before the enemy phase, so no damage yet");
assert.strictEqual(state.status, "playing");

const interceptor1 = Engine.livingEnemies(state)[0];
assert.strictEqual(interceptor1.id, "e0");
assert.strictEqual(
  Engine.isAdjacent(interceptor1, state.playerPos),
  true,
  "Interceptor 1 should have closed to adjacency by now"
);

// ---- step 3a: mistake branch — stay in range and eat the deterministic
// strike, which is now instantly lethal (permadeath, one hull point).
// Impulse Cannon toggled off so this reliably demonstrates taking a hit,
// regardless of whether the chosen adjacent hex happens to also line up
// Interceptor 1 dead ahead (which would auto-kill it instead, same as e1
// above — that's the "correct-ish by accident" case, not what this branch
// is illustrating).

const mistakeState = clone(state);
Engine.setSystem(mistakeState, "ram", false);
const staysAdjacent = Engine.legalSublightTargets(mistakeState).find(
  (to) => Engine.isAdjacent(to, interceptor1)
);
assert.ok(staysAdjacent, "expected a legal move that stays adjacent to Interceptor 1");
Engine.applySublight(mistakeState, staysAdjacent);
assert.strictEqual(mistakeState.hull, 2, "staying adjacent to Interceptor 1 eats its deterministic strike — 1 of 3 Hull gone");
assert.strictEqual(mistakeState.status, "playing", "with 3 Hull a single strike is a scratch, not death");

// ---- step 3b: correct branch — the Shockwave (left armed, unlike the
// mistake branch) kills Interceptor 1 the moment any move keeps it inside
// the blast ring: omnidirectional, resolves before the enemy phase, so
// the strike never lands. (This branch used to be Fighter Squadron,
// which was cut — everything runs on the weapon systems now.)

const correctState = clone(state);
const stayInRange = Engine.legalSublightTargets(correctState).find((to) => Engine.isAdjacent(to, interceptor1));
assert.ok(stayInRange, "expected a legal move that keeps Interceptor 1 in Shockwave range");
Engine.applySublight(correctState, stayInRange);

assert.strictEqual(Engine.livingEnemies(correctState).length, 0, "Interceptor 1 should be destroyed by the Shockwave");
assert.strictEqual(correctState.hull, 3, "the correct branch should take no damage");
assert.strictEqual(correctState.status, "playing");

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

// ---- Tractor Beam: edge push-kill and collision push-kill ---------------
// (Not exercised by the golden path above, so covered directly here.)

const edgeLevel = {
  id: 998,
  radius: 2,
  playerStart: { q: 0, r: 0 },
  exit: { q: -2, r: 0 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 2, r: -1 }],
  hazards: [],
  exitRule: "all-enemies-dead",
  actions: ["sublight", "ramming", "tractor"], // purchase-only now — explicit here, this fixture tests the push mechanic itself
};

const edgeState = Engine.createGameState(edgeLevel);
edgeState.playerPos = { q: 1, r: -1 }; // stand adjacent to (2,-1), on the map-center side (bypasses a staging turn so the AI can't reposition the target first)
Engine.applyTractor(edgeState, "e0");
assert.strictEqual(edgeState.enemies.find((e) => e.id === "e0").alive, false, "pushing an enemy off the map edge destroys it");

const collideLevel = {
  id: 997,
  radius: 2,
  playerStart: { q: -2, r: 0 },
  exit: { q: 2, r: 0 },
  outpost: null,
  enemies: [
    { type: "interceptor", q: 0, r: 0 }, // pushed away from the player, into e1
    { type: "interceptor", q: 1, r: 0 }, // the collision victim
  ],
  hazards: [],
  exitRule: "all-enemies-dead",
  actions: ["sublight", "ramming", "tractor"], // purchase-only now — explicit here, this fixture tests the push mechanic itself
};

const collideState = Engine.createGameState(collideLevel);
collideState.playerPos = { q: -1, r: 0 }; // adjacent to e0 at (0,0) (bypasses a staging turn so e1 can't wander off its hex first)
Engine.applyTractor(collideState, "e0");
assert.strictEqual(collideState.enemies.find((e) => e.id === "e0").alive, false, "the pushed enemy is destroyed on collision");
assert.strictEqual(collideState.enemies.find((e) => e.id === "e1").alive, false, "the collided-with unit takes lethal damage too");

// ---- Weapon systems: stat-driven, toggleable, auto-firing --------------
// (Clubhouse feedback: Ramming Speed became a weapon stat block that
// auto-fires on any move — or Hold Position — instead of a separate
// aim-and-fire action; Warpdrive is a matching pre-turn toggle that gates
// movement itself.)

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

// Moving into range auto-fires the Impulse Cannon — no separate arm-and-aim step.
let weaponState = Engine.createGameState(weaponLevel);
assert.strictEqual(weaponState.enemies[0].hp, 1, "enemies start at 1 HP");
assert.deepStrictEqual(
  weaponState.systems,
  { warpdrive: true, ram: true, lance: true, repulsor: true },
  "all systems default on"
);
Engine.applySublight(weaponState, { q: 2, r: 2 }); // steps adjacent to the interceptor
assert.strictEqual(weaponState.enemies[0].alive, false, "moving into range auto-fires the Impulse Cannon");
assert.ok(weaponState.events.some((e) => e.type === "kill"), "the auto-attack emits a kill event");
assert.ok(
  weaponState.events.some((e) => e.type === "kill" && e.source === "weapon"),
  "the auto-attack's kill is tagged source:weapon — the renderer uses this to aim the flagship at it, distinct from a Tractor/Fighter kill"
);

// Toggling the Impulse Cannon off suppresses the auto-attack.
weaponState = Engine.createGameState(weaponLevel);
Engine.setSystem(weaponState, "ram", false);
Engine.applySublight(weaponState, { q: 2, r: 2 });
assert.strictEqual(weaponState.enemies[0].alive, true, "Impulse Cannon toggled off does not fire");

// Hold Position resolves the turn — and still auto-fires — without moving.
weaponState = Engine.createGameState(weaponLevel);
weaponState.playerPos = { q: 2, r: 2 }; // already adjacent, bypassing a staging move
Engine.applyHoldPosition(weaponState);
assert.deepStrictEqual(weaponState.playerPos, { q: 2, r: 2 }, "Hold Position never moves the flagship");
assert.strictEqual(weaponState.enemies[0].alive, false, "Hold Position still lets an armed weapon auto-fire");

// Warpdrive off blocks movement outright — Hold Position is the only option.
weaponState = Engine.createGameState(weaponLevel);
Engine.setSystem(weaponState, "warpdrive", false);
assert.throws(
  () => Engine.applySublight(weaponState, { q: 2, r: 2 }),
  /Warpdrive/,
  "movement requires Warpdrive to be toggled on"
);

// But re-aiming (no move, no turn) still works with Warpdrive off — that's
// how you dial in a forward-only weapon's direction before committing with
// Hold Position.
const facingBefore = weaponState.facing;
Engine.setFacing(weaponState, (facingBefore + 2) % 6);
assert.strictEqual(weaponState.facing, (facingBefore + 2) % 6, "setFacing re-aims the flagship");
assert.deepStrictEqual(weaponState.playerPos, weaponLevel.playerStart, "re-aiming never moves the flagship");
assert.strictEqual(weaponState.turnCount, 0, "re-aiming doesn't consume a turn — no enemy phase runs");
assert.throws(() => Engine.setFacing(weaponState, 6), /Invalid facing/, "facing must be one of the 6 hex directions");

// ---- Weapon slots: "there should be rules about what you can equip" ----
// (Clubhouse feedback) — the toggle-fired weapons (Shockwave/Lance/
// Repulsor) compete for state.weaponSlots, each occupying its
// WEAPONS[key].slots while armed. Ship data (upgradable via the
// Hardpoint Expansion Outpost offer), not a hardcoded constant. Tractor
// Beam is a one-off action (slots: 0), and Warpdrive is movement, not a
// weapon — neither competes for a slot.
assert.deepStrictEqual(Engine.WEAPON_SYSTEM_KEYS, ["ram", "lance", "repulsor"]);
assert.strictEqual(Engine.WEAPONS.tractor.slots, 0, "the Tractor Beam never occupies a weapon slot");

// Lance and Repulsor default systems[key] === true even before they're
// purchased (see createGameState) — they simply don't fire until owned.
// The cap must only count weapons actually unlocked, or a fresh flagship
// with just the Shockwave would already read as "2 active" and get
// blocked from re-enabling it.
let capState = Engine.createGameState(weaponLevel);
assert.ok(
  !capState.actions.includes("lance") && !capState.actions.includes("repulsor"),
  "a fresh flagship hasn't unlocked Lance/Repulsor yet"
);
assert.strictEqual(capState.weaponSlots, 2, "a fresh flagship has 2 weapon slots");
assert.strictEqual(Engine.usedWeaponSlots(capState), 1, "only the owned, armed Shockwave counts against them");
Engine.setSystem(capState, "ram", false);
Engine.setSystem(capState, "ram", true); // must not throw — lance/repulsor aren't actually owned
assert.strictEqual(capState.systems.ram, true);

// Once Lance and Repulsor are both owned, the cap bites: Shockwave +
// Lance is already 2/2 (createGameState itself clamps the 3rd default-on
// system, Repulsor, back off — see clampWeaponSystems), so arming
// Repulsor on top must be rejected.
capState = Engine.createGameState(weaponLevel, { extraActions: ["lance", "repulsor"] });
assert.ok(
  capState.actions.includes("lance") && capState.actions.includes("repulsor"),
  "extraActions carries Lance and Repulsor into the fresh state"
);
assert.deepStrictEqual(
  capState.systems,
  { warpdrive: true, ram: true, lance: true, repulsor: false },
  "owning all 3 weapon systems at once starts with only the first 2 (in Shockwave/Lance/Repulsor order) active — the cap is enforced from turn zero, not just on the next toggle"
);
assert.throws(
  () => Engine.setSystem(capState, "repulsor", true),
  /Weapon slots full/,
  "a 3rd weapon system can't be armed while both slots are occupied"
);
// Toggling one off first frees a slot.
Engine.setSystem(capState, "ram", false);
Engine.setSystem(capState, "repulsor", true); // now Lance + Repulsor, 2/2 — must not throw
assert.strictEqual(capState.systems.repulsor, true);
// Disabling a system is always allowed, cap or no cap.
Engine.setSystem(capState, "lance", false);
assert.strictEqual(capState.systems.lance, false);

// The cap also has to hold at the moment of purchase, not just on the next
// toggle — buying a 3rd weapon system while the other 2 are already
// running must not silently leave all 3 flagged "active".
const capOutpostLevel = { ...weaponLevel, id: 995, playerStart: { q: 3, r: 3 }, outpost: { q: 2, r: 3 } };
let purchaseState = Engine.createGameState(capOutpostLevel, { extraActions: ["lance"] });
assert.deepStrictEqual(
  purchaseState.systems,
  { warpdrive: true, ram: true, lance: true, repulsor: true },
  "Shockwave + Lance is exactly 2/2 already — Repulsor still reads active by default, but it isn't owned yet so it doesn't count"
);
purchaseState.playerPos = { q: capOutpostLevel.outpost.q, r: capOutpostLevel.outpost.r };
purchaseState.outpostOfferIds = ["repair", "repulsorWeapon"];
purchaseState.salvage = 20;
Engine.applyOutpostPurchase(purchaseState, "repulsorWeapon");
assert.strictEqual(purchaseState.actions.includes("repulsor"), true, "the purchase still unlocks the action");
assert.strictEqual(
  purchaseState.systems.repulsor,
  false,
  "but it doesn't auto-arm — Shockwave and Lance already filled both slots, so the newly-bought Repulsor starts off"
);
assert.strictEqual(purchaseState.systems.ram, true, "the 2 systems that were already active are untouched by the purchase");
assert.strictEqual(purchaseState.systems.lance, true);

// Hardpoint Expansion raises the ship's slot capacity — after buying it,
// the third weapon CAN be armed alongside the other two.
purchaseState.outpostOfferIds = ["repair", "hardpoint"];
purchaseState.salvage = 20;
Engine.applyOutpostPurchase(purchaseState, "hardpoint");
assert.strictEqual(purchaseState.weaponSlots, 3, "Hardpoint Expansion adds a weapon slot");
Engine.setSystem(purchaseState, "repulsor", true); // must not throw anymore
assert.strictEqual(purchaseState.systems.repulsor, true, "with 3 slots, all 3 weapon systems can run at once");

// Reactor Upgrade raises the Energy cap (and fills the new capacity
// immediately, same as Reinforce Hull).
purchaseState.outpostOfferIds = ["repair", "reactor"];
purchaseState.salvage = 12;
const maxEnergyBefore = purchaseState.maxEnergy;
const energyBeforeUpgrade = purchaseState.energy;
Engine.applyOutpostPurchase(purchaseState, "reactor");
assert.strictEqual(purchaseState.maxEnergy, maxEnergyBefore + 1, "Reactor Upgrade raises max Energy by 1");
assert.strictEqual(purchaseState.energy, energyBeforeUpgrade + 1, "and the new capacity arrives charged");

// Both upgrades carry into the next sector via carryOver, same as
// maxHull/maxEnergy always have.
const upgradedCarryState = Engine.createGameState(
  { ...weaponLevel, id: 994 },
  { hasPrevious: true, weaponSlots: purchaseState.weaponSlots, maxEnergy: purchaseState.maxEnergy }
);
assert.strictEqual(upgradedCarryState.weaponSlots, 3, "weaponSlots carries across sectors");
assert.strictEqual(upgradedCarryState.maxEnergy, maxEnergyBefore + 1, "maxEnergy carries across sectors");

// Enemies fight through the same WEAPONS/ENEMY_TYPES stat blocks as the
// flagship — not hardcoded adjacency/damage constants — so the threat
// overlay, attack range, and damage-per-hit are all read off the
// Interceptor's own weapon rather than special-cased.
assert.strictEqual(
  Engine.ENEMY_TYPES.interceptor.weapon,
  Engine.WEAPONS.interceptorCannon,
  "the Interceptor's attack is a WEAPONS entry, same shape as the flagship's Impulse Cannon"
);
const interceptorPos = { q: 0, r: 0 };
const interceptorWeapon = Engine.ENEMY_TYPES.interceptor.weapon;
assert.deepStrictEqual(
  interceptorWeapon.pattern.slice().sort(),
  [0, 1, 2, 3, 4, 5],
  "the Interceptor Cannon is omnidirectional (every direction offset)"
);
// facing is irrelevant to an omnidirectional pattern — passing 0 here still
// covers every direction, which is exactly the point.
const omniHexes = Engine.weaponHexes(interceptorPos, 0, interceptorWeapon);
assert.strictEqual(omniHexes.length, 6, "a range-1 omnidirectional weapon threatens exactly the 6 neighboring hexes");
assert.ok(!omniHexes.some((h) => Engine.posEq(h, interceptorPos)), "a weapon never threatens its own hex");
assert.ok(
  omniHexes.every((h) => Engine.hexDistance(h, interceptorPos) === 1),
  "every hex an omnidirectional range-1 weapon reaches is exactly 1 hex away"
);

// The Shockwave (the free auto-weapon) now fires in ALL six directions — an
// encircling blast that defends you from every side, no aiming required.
const pulseCannon = Engine.WEAPONS.ram;
assert.deepStrictEqual(pulseCannon.pattern.slice().sort(), [0, 1, 2, 3, 4, 5], "the Shockwave is omnidirectional");
const shockHexes = Engine.weaponHexes(interceptorPos, 0, pulseCannon);
assert.strictEqual(shockHexes.length, 6, "the Shockwave reaches all six neighboring hexes");
assert.ok(
  shockHexes.every((h) => Engine.hexDistance(h, interceptorPos) === 1),
  "every hex the Shockwave reaches is exactly one hex away (range 1, all directions)"
);

// ---- new enemy classes: Cruiser (heavy) and Sentry (stationary turret) -----
// Variety beyond the lone Interceptor: a Cruiser takes two hits, and a Sentry
// never moves but its beam reaches two hexes in every direction.
assert.strictEqual(Engine.ENEMY_TYPES.cruiser.hp, 2, "the Cruiser is a 2-Hull heavy (survives a single hit)");
assert.strictEqual(Engine.ENEMY_TYPES.interceptor.hp, 1, "the Interceptor is still a 1-Hull glass cannon");
assert.strictEqual(Engine.ENEMY_TYPES.sentry.hp, 2, "the Sentry is a 2-Hull emplacement");
assert.strictEqual(Engine.ENEMY_TYPES.sentry.movesTowardPlayer !== true, true, "the Sentry never chases");
assert.strictEqual(Engine.ENEMY_TYPES.sentry.weapon, Engine.WEAPONS.sentryBeam, "the Sentry fires the Sentry Beam");
assert.strictEqual(Engine.WEAPONS.sentryBeam.range, 2, "the Sentry Beam reaches two hexes");

const sentryHexes = Engine.weaponHexes({ q: 0, r: 0 }, 0, Engine.WEAPONS.sentryBeam);
assert.strictEqual(sentryHexes.length, 12, "a range-2 omnidirectional beam threatens 6 near + 6 far hexes");
assert.ok(
  sentryHexes.some((h) => Engine.hexDistance(h, { q: 0, r: 0 }) === 2),
  "and it genuinely reaches out to distance 2, not just the neighbors"
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
const sentryStart = { q: sentryState.enemies[0].q, r: sentryState.enemies[0].r };
Engine.applySublight(sentryState, { q: 2, r: 4 }); // distance 3 — still out of the beam
assert.strictEqual(sentryState.status, "playing", "stepping to distance 3 is safe — the beam only reaches 2");
assert.deepStrictEqual(
  { q: sentryState.enemies[0].q, r: sentryState.enemies[0].r },
  sentryStart,
  "the Sentry does not move to chase — it holds its hex"
);
const hullBeforeBeam = sentryState.hull;
Engine.applySublight(sentryState, { q: 2, r: 3 }); // distance 2 — into the beam
assert.strictEqual(sentryState.hull, hullBeforeBeam - 1, "entering the Sentry's 2-hex ring takes a hit");
assert.ok(sentryState.events.some((e) => e.type === "attack"), "the Sentry's shot emits an attack event");

// ---- Railgun Destroyer: the original design doc's long-range emplacement,
// built at last ("what about... basic enemy variety") — stationary like
// the Sentry, but its shot reaches the length of the board along any of
// the 6 axes instead of a short ring.
assert.strictEqual(Engine.ENEMY_TYPES.railgun.hp, 2, "the Railgun is a 2-Hull emplacement, same tier as the Sentry");
assert.strictEqual(Engine.ENEMY_TYPES.railgun.movesTowardPlayer !== true, true, "the Railgun never chases either");
assert.strictEqual(Engine.WEAPONS.railgunBeam.range, 20, "the Railgun's shot is effectively board-spanning");

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
railgunState.enemies[0].energy = 3;
const hullBeforeRailgun = railgunState.hull;
Engine.applySublight(railgunState, { q: 2, r: 4 }); // still distance 3, but already aligned — the long shot reaches it
assert.strictEqual(
  railgunState.hull,
  hullBeforeRailgun - 1,
  "aligned on the Railgun's axis at distance 3 is already lethal — its range dwarfs the Sentry's"
);
assert.deepStrictEqual(
  { q: railgunState.enemies[0].q, r: railgunState.enemies[0].r },
  railgunStart,
  "the Railgun does not move to chase either — it holds its hex"
);

// Off-axis, the Railgun's shot never reaches at all, no matter the range.
const railgunOffAxisLevel = { ...railgunLevel, id: 996, playerStart: { q: 0, r: 5 } };
const railgunOffAxisState = Engine.createGameState(railgunOffAxisLevel);
railgunOffAxisState.enemies[0].energy = 3; // charged, so the miss below is about geometry, not energy
const hullBeforeOffAxis = railgunOffAxisState.hull;
Engine.applySublight(railgunOffAxisState, { q: 0, r: 4 });
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

// Stepping into range lets the Shockwave kill the lone Interceptor — the
// kill drops its salvage.
Engine.applySublight(salvageState, { q: 0, r: -1 });
assert.strictEqual(salvageState.enemies[0].alive, false, "the Shockwave kills the adjacent Interceptor");
assert.strictEqual(salvageState.salvage, Engine.ENEMY_TYPES.interceptor.salvage, "a kill drops its type's salvage value");
assert.ok(salvageState.events.some((e) => e.type === "salvage"), "a kill emits a salvage event for the UI to animate");

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
  /already full/,
  "Repair refuses once Hull is already at max"
);

// Reinforce Hull permanently raises the cap — force affordability regardless
// of how much salvage the fixture happened to earn above.
salvageState.salvage = reinforceOffer.cost;
const maxHullBefore = salvageState.maxHull;
Engine.applyOutpostPurchase(salvageState, "reinforce");
assert.strictEqual(salvageState.maxHull, maxHullBefore + 1, "Reinforce Hull raises the cap by 1");
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
  /not enough salvage/,
  "an offer refuses when salvage can't cover its cost"
);

// Salvage, the raised max-Hull, and any banked Shield charges all carry
// into the next sector via createGameState's carryOver — this is how
// loadSector() in app.js hands a run's progress from one sector to the next.
const carriedState = Engine.createGameState(LEVELS[0], { salvage: 4, maxHull: salvageState.maxHull, shieldCharges: 2 });
assert.strictEqual(carriedState.salvage, 4, "salvage carries over into the next sector");
assert.strictEqual(carriedState.maxHull, salvageState.maxHull, "a permanent max-Hull upgrade carries over too");
assert.strictEqual(carriedState.hull, carriedState.maxHull, "the new sector still starts at full (carried-over) Hull");
assert.strictEqual(carriedState.shieldCharges, 2, "banked Shield charges carry over too");

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
const lengthsAcrossLevels = new Set();
for (let id = 900; id < 920; id++) {
  const offers = outpostFixture(id).outpostOfferIds;
  assert.strictEqual(offers[0], "repair", `level ${id}: Repair is always the first offer`);
  assert.ok(offers.length >= 1 && offers.length <= 7, `level ${id}: 1-7 total offers (Repair plus 0-6 extras, now that Reactor/Hardpoint upgrades joined the pool)`);
  assert.strictEqual(new Set(offers).size, offers.length, `level ${id}: no duplicate offers`);
  lengthsAcrossLevels.add(offers.length);
}
assert.ok(lengthsAcrossLevels.size > 1, "the offer COUNT varies across levels, not always the same shop size");
assert.deepStrictEqual(
  outpostFixture(905).outpostOfferIds,
  outpostFixture(905).outpostOfferIds,
  "the same level id always deals the same offers (reproducible)"
);

// ---- Emergency Shield: absorbs one full hit, then is consumed ------------
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
Engine.applySublight(shieldState, { q: 2, r: 2 }); // step adjacent: interceptor attacks
assert.strictEqual(shieldState.hull, hullBeforeShield, "a banked Shield charge fully absorbs the hit — no Hull lost");
assert.strictEqual(shieldState.shieldCharges, 0, "absorbing a hit consumes the Shield charge");
assert.ok(shieldState.events.some((e) => e.type === "shieldAbsorb"), "absorbing emits a shieldAbsorb event for the UI");
// A separate fixture (no Shield charge banked) confirms the same hit costs
// Hull normally once there's nothing left to absorb it.
const noShieldState = Engine.createGameState(shieldLevel);
const hullBeforeNoShield = noShieldState.hull;
Engine.applySublight(noShieldState, { q: 2, r: 2 });
assert.strictEqual(noShieldState.hull, hullBeforeNoShield - 1, "with no Shield charge banked, the hit costs Hull as normal");

// ---- Lance Cannon: bought at an Outpost, not handed out for free --------
// Clubhouse feedback: "what about different options and different
// weapons... you have to pay for them" — a new weapon beyond the base kit
// is a purchase, not another automatic per-sector unlock.
const lanceLevel = {
  id: 992,
  name: "lance fixture",
  board: { type: "rect", cols: 5, rows: 6 },
  playerStart: { q: 2, r: 4 },
  exit: { q: 4, r: -2 },
  outpost: { q: 0, r: 0 },
  enemies: [{ type: "interceptor", q: 2, r: 1 }], // 3 hexes straight ahead of playerStart
  hazards: [],
  exitRule: "all-enemies-dead",
};
const lanceState = Engine.createGameState(lanceLevel);
assert.strictEqual(lanceState.actions.includes("lance"), false, "Lance Cannon isn't part of the starting kit");
assert.strictEqual(Engine.outpostOffers(lanceState).length, 0, "not docked yet — no offers visible");

// Dock at the Outpost directly (walking there is already covered by other
// tests) and force it onto this outpost's menu — offer selection is
// otherwise seeded per-level and not guaranteed to include Lance Cannon.
lanceState.playerPos = { q: lanceLevel.outpost.q, r: lanceLevel.outpost.r };
lanceState.outpostOfferIds = ["repair", "lanceCannon"];
assert.throws(
  () => Engine.applyOutpostPurchase(lanceState, "lanceCannon"),
  /not enough salvage/i,
  "gated on affordability like every other offer"
);
lanceState.salvage = 25;
Engine.applyOutpostPurchase(lanceState, "lanceCannon");
assert.strictEqual(lanceState.actions.includes("lance"), true, "purchasing it unlocks the action");
assert.strictEqual(lanceState.salvage, 0, "the full cost is spent");
assert.strictEqual(
  lanceState.outpostOfferIds.includes("lanceCannon"),
  false,
  "one-time purchase per outpost, same as every non-Repair offer"
);
assert.strictEqual(lanceState.systems.lance, true, "the toggle defaults on once purchased");

// Back at playerStart, face the interceptor (3 hexes dead ahead) and
// confirm the Lance Cannon actually fires — forward-only (pattern [0])
// reaches its full range, unlike the omnidirectional Shockwave.
lanceState.playerPos = { q: lanceLevel.playerStart.q, r: lanceLevel.playerStart.r };
Engine.setFacing(lanceState, 2); // "up" — toward the interceptor
Engine.applyHoldPosition(lanceState);
assert.strictEqual(lanceState.enemies[0].alive, false, "the Lance Cannon hits a target 3 hexes dead ahead");
assert.ok(
  lanceState.log.some((line) => line.includes("Lance Cannon destroyed")),
  "the kill is attributed to the Lance Cannon specifically, not the Shockwave"
);

// A purchased weapon has to be carried forward explicitly into the next
// sector (see app.js's advanceSector) — the engine side of that contract
// is `carryOver.extraActions`.
const nextSectorState = Engine.createGameState(
  { ...lanceLevel, id: 993 },
  { hasPrevious: true, extraActions: ["lance"] }
);
assert.strictEqual(nextSectorState.actions.includes("lance"), true, "extraActions carries a purchased weapon into the next sector");

// ---- Repulsor: a second purchasable weapon, knockback instead of just ---
// damage. Clubhouse feedback: "make that bad or good depending [how it's
// used]" — every surviving hit gets shoved a hex directly away.
const repulsorLevel = {
  id: 994,
  name: "repulsor fixture",
  board: { type: "rect", cols: 5, rows: 6 },
  playerStart: { q: 2, r: 4 },
  exit: { q: 4, r: -2 },
  outpost: { q: 0, r: 0 },
  enemies: [{ type: "cruiser", q: 2, r: 2 }], // >=2 hexes from playerStart, per spawn-safety validation
  hazards: [],
  exitRule: "all-enemies-dead",
};
const repulsorState = Engine.createGameState(repulsorLevel);
assert.strictEqual(repulsorState.actions.includes("repulsor"), false, "Repulsor isn't part of the starting kit either");
repulsorState.playerPos = { q: repulsorLevel.outpost.q, r: repulsorLevel.outpost.r };
repulsorState.outpostOfferIds = ["repair", "repulsorWeapon"];
repulsorState.salvage = 20;
Engine.applyOutpostPurchase(repulsorState, "repulsorWeapon");
assert.strictEqual(repulsorState.actions.includes("repulsor"), true, "purchasing it unlocks the action");
assert.strictEqual(repulsorState.systems.repulsor, true, "the toggle defaults on once purchased");

// Reposition the Cruiser adjacent "up" from playerStart to actually fire
// on it — the level's own spawn position just needs to satisfy authoring
// validation above, not the exact firing geometry this checks.
repulsorState.playerPos = { q: repulsorLevel.playerStart.q, r: repulsorLevel.playerStart.r };
repulsorState.enemies[0].q = repulsorLevel.playerStart.q;
repulsorState.enemies[0].r = repulsorLevel.playerStart.r - 1;
repulsorState.systems.ram = false; // isolate the Repulsor — both it and the Shockwave are adjacent/omnidirectional and would otherwise double up on the same hit
const hullBeforeRepulsor = repulsorState.hull;
Engine.applyHoldPosition(repulsorState); // omnidirectional (range 1) — no facing management needed, unlike the Lance Cannon
assert.strictEqual(repulsorState.enemies[0].alive, true, "1 damage isn't enough to kill a 2-HP Cruiser outright");
assert.strictEqual(repulsorState.enemies[0].hp, 1, "the Repulsor still deals its own damage on top of the knockback");
// The push happens before the enemy phase, so knocking the Cruiser out of
// adjacency means it has to close the gap again instead of attacking —
// the flagship takes no damage this turn purely because of the knockback.
// (Its own chase AI immediately starts closing that gap again afterward,
// so the exact landing hex isn't asserted here — a stationary enemy would
// dodge the "not attacking" signal entirely, e.g. a Sentry's range-2 beam
// still reaches one hex further out.)
assert.strictEqual(
  repulsorState.hull,
  hullBeforeRepulsor,
  "the knockback pushed the Cruiser out of strike range before the enemy phase — no counter-attack this turn"
);
assert.ok(
  repulsorState.log.some((line) => line.includes("Repulsor hit") || line.includes("Repulsor-pushed")),
  "both the hit and the push are logged"
);

// ---- Tractor Beam: no longer free, claimed at Sector 2's Outpost --------
// Clubhouse feedback: "you should not start with it" — unlike every other
// campaign action, Tractor Beam isn't in Sector 2's own `actions` list
// anymore; it's a free (cost 0) claim, guaranteed on offer at that
// specific sector's Outpost only.
assert.strictEqual(LEVELS[1].actions.includes("tractor"), false, "Sector 2 no longer hands out Tractor Beam for free");
assert.strictEqual(LEVELS[2].actions.includes("tractor"), false, "neither does Sector 3");
const sector2State = Engine.createGameState(LEVELS[1]);
assert.strictEqual(sector2State.actions.includes("tractor"), false, "not unlocked on arrival");
assert.strictEqual(sector2State.outpostOfferIds.includes("tractorBeam"), true, "guaranteed on offer at Sector 2's Outpost specifically");
sector2State.playerPos = { q: LEVELS[1].outpost.q, r: LEVELS[1].outpost.r };
const salvageBeforeClaim = sector2State.salvage; // 0 on a fresh run — the claim must not require any
Engine.applyOutpostPurchase(sector2State, "tractorBeam");
assert.strictEqual(sector2State.actions.includes("tractor"), true, "claiming it unlocks the action");
assert.strictEqual(sector2State.salvage, salvageBeforeClaim, "the claim costs nothing");
assert.ok(sector2State.log.some((line) => line.includes("claimed Tractor Beam")), "claiming (not buying) is reflected in the log");

// It's excluded from the general per-level random pool — other outposts
// never randomly offer it, only Sector 2's does.
let anyOtherOutpostOffersTractor = false;
for (let id = 5; id < 60; id++) {
  if (Engine.createGameState(generateLevel(id)).outpostOfferIds.includes("tractorBeam")) {
    anyOtherOutpostOffersTractor = true;
    break;
  }
}
assert.strictEqual(anyOtherOutpostOffersTractor, false, "Tractor Beam never shows up at a random generated outpost — Sector 2 is the one guaranteed source");

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
const bossLevelDef = generateLevel(20);
assert.strictEqual(bossLevelDef.isBoss, true, "depth 20 is the boss sector");
assert.strictEqual(bossLevelDef.name, "The Bulwark");
assert.ok(bossLevelDef.outpost, "the boss sector has a guaranteed Outpost — shop before the fight");
assert.deepStrictEqual(generateLevel(20, "aggressive"), generateLevel(20), "the boss ignores variantId — no branching into it");
assert.notStrictEqual(generateLevel(19).isBoss, true, "depth 19 is still purely procedural");
assert.notStrictEqual(generateLevel(21).isBoss, true, "depth 21 (past the boss) is purely procedural too — one milestone, not a repeating pattern");

const bossState = Engine.createGameState(bossLevelDef);
assert.strictEqual(bossState.isBoss, true);
assert.strictEqual(bossState.isVictory, false, "not won yet");
// The Warp Gate is always online (combat is optional everywhere, boss
// sectors included — see checkExitUnlock), so reaching it is enough to
// win; combat itself is already covered thoroughly elsewhere in this
// file. This test only cares whether clearing a BOSS sector flips
// isVictory, not how the fight plays out.
bossState.playerPos = { q: bossLevelDef.exit.q, r: bossLevelDef.exit.r };
Engine.applyHoldPosition(bossState);
assert.strictEqual(bossState.status, "won", "reaching the gate wins, same as any other sector");
assert.strictEqual(bossState.isVictory, true, "clearing the BOSS sector sets isVictory — a real Run Complete, not a routine clear");

// ---- Branching Warp Gates: "different sort of paths... based on the ------
// different portals" (Clubhouse feedback) — every generated sector offers
// 2 exits, each biasing what comes next, deterministically per variant.
const branchLevel = generateLevel(30);
assert.strictEqual(branchLevel.exits.length, 2, "a generated sector always offers 2 Warp Gates");
assert.deepStrictEqual(branchLevel.exit, branchLevel.exits[0], "the singular `exit` field is just the first gate, for single-exit callers");
const branchIds = branchLevel.exits.map((e) => e.variantId);
assert.deepStrictEqual(new Set(branchIds).size, 2, "the two gates are tagged with different variant ids");

const branchState = Engine.createGameState(branchLevel);
assert.strictEqual(branchState.exits.length, 2, "state.exits mirrors the level's two gates");
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
let energyState = Engine.createGameState(energyLevel, { extraActions: ["lance"] });
assert.strictEqual(energyState.energy, 3, "a fresh run starts at full Energy");
assert.strictEqual(energyState.maxEnergy, 3);
assert.strictEqual(Engine.WEAPONS.ram.energyCost, 1, "the Shockwave costs exactly the per-turn regen — sustainable alone");
assert.ok(Engine.WEAPONS.lance.energyCost > 1, "the Lance Cannon costs more than the per-turn regen — a real drain");

// A full volley pays for every weapon that fires: Shockwave (1) + Lance
// (2) against an adjacent dead-ahead Cruiser = 3 spent, +1 regen.
energyState.enemies[0].q = 2;
energyState.enemies[0].r = 4; // adjacent, directly up (facing 2)
Engine.setFacing(energyState, 2);
Engine.applyHoldPosition(energyState);
assert.strictEqual(energyState.enemies[0].alive, false, "Shockwave + Lance Cannon volley kills a 2-HP Cruiser");
assert.strictEqual(energyState.energy, 3 - 1 - 2 + 1, "every shot in the volley was paid for, net of the turn's regen");

// With only 1 Energy left, the Shockwave (first in firing order) claims
// it and the Lance Cannon holds fire — logged, not silent.
energyState = Engine.createGameState(energyLevel, { extraActions: ["lance"] });
energyState.enemies[0].q = 2;
energyState.enemies[0].r = 4;
energyState.energy = 1;
Engine.setFacing(energyState, 2);
Engine.applyHoldPosition(energyState);
assert.strictEqual(energyState.enemies[0].alive, true, "1 Shockwave hit alone leaves a 2-HP Cruiser alive");
assert.strictEqual(energyState.enemies[0].hp, 1, "the Shockwave still fired on the Energy that was left");
assert.ok(
  energyState.log.some((line) => /Lance Cannon holds fire/.test(line)),
  "the unaffordable Lance Cannon holds fire with a log line, not silently"
);

// No target in range = no shot = no Energy spent.
energyState = Engine.createGameState(energyLevel);
const energyBeforeEmptyTurn = energyState.energy;
Engine.applySublight(energyState, { q: 2, r: 4 }); // cruiser is 2 hexes away — out of Shockwave range
assert.strictEqual(
  energyState.energy,
  Math.min(energyState.maxEnergy, energyBeforeEmptyTurn + 1),
  "a turn with nothing in range spends no Energy, just regens"
);

// The Tractor Beam draws from the same reactor.
const tractorEnergyState = Engine.createGameState({ ...energyLevel, id: 989 }, { extraActions: ["tractor"] });
tractorEnergyState.enemies[0].q = 2;
tractorEnergyState.enemies[0].r = 4;
Engine.setSystem(tractorEnergyState, "ram", false); // isolate the Tractor's own cost
tractorEnergyState.energy = 0;
assert.throws(
  () => Engine.applyTractor(tractorEnergyState, "e0"),
  /not enough Energy/,
  "the Tractor Beam refuses without the Energy to power it"
);
tractorEnergyState.energy = 1;
Engine.applyTractor(tractorEnergyState, "e0");
assert.strictEqual(
  tractorEnergyState.energy,
  1 - Engine.WEAPONS.tractor.energyCost + 1,
  "a Tractor push costs its listed Energy, net of the turn's regen"
);

// ---- Enemy reactors: the Railgun's charge-up telegraph -------------------
// Enemies run the same energy rules. A cost-1 chaser regens its shot every
// turn (fires exactly as often as before energy existed); the cost-3
// Railgun spawns EMPTY and visibly charges 3 turns between shots — the
// design doc's "telegraphs the line" made real through the shared system.

const railgunEnergyLevel = {
  id: 988,
  name: "railgun energy fixture",
  board: { type: "rect", cols: 5, rows: 8 },
  playerStart: { q: 2, r: 5 },
  exit: { q: 4, r: -2 },
  outpost: null,
  enemies: [{ type: "railgun", q: 2, r: 0 }], // same column: on-axis, in range from spawn
  hazards: [],
  exitRule: "all-enemies-dead",
};
const railgunEnergyState = Engine.createGameState(railgunEnergyLevel);
assert.strictEqual(railgunEnergyState.enemies[0].energy, 0, "a Railgun spawns with an empty reactor — it can't snipe on turn 1");
assert.strictEqual(Engine.computeThreatHexes(railgunEnergyState).size, 0, "a charging Railgun threatens nothing — the overlay shows only what can actually fire next turn");

const hullTimeline = [];
for (let t = 1; t <= 8; t++) {
  Engine.applyHoldPosition(railgunEnergyState);
  hullTimeline.push(railgunEnergyState.hull);
}
assert.deepStrictEqual(
  hullTimeline,
  [3, 3, 3, 2, 2, 2, 1, 1],
  "the Railgun fires on turn 4 and every 3rd turn after — a readable rhythm, not a constant beam"
);

// Once charged, its whole line lights up in the threat overlay again.
const chargedRailgunState = Engine.createGameState(railgunEnergyLevel);
chargedRailgunState.enemies[0].energy = 3;
assert.ok(Engine.computeThreatHexes(chargedRailgunState).size > 0, "a fully-charged Railgun's line is a live threat");

// A cost-1 enemy is unchanged by the energy system: it fires every turn.
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
  actions: ["sublight"], // no Shockwave — let it survive to attack repeatedly
};
const chaserEnergyState = Engine.createGameState(chaserEnergyLevel);
Engine.applyHoldPosition(chaserEnergyState); // it closes to adjacent
Engine.applyHoldPosition(chaserEnergyState); // strike 1
Engine.applyHoldPosition(chaserEnergyState); // strike 2 — no charge gap
assert.strictEqual(chaserEnergyState.hull, 1, "a cost-1 chaser fires every single turn, same cadence as before energy existed");

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
  /blocked by an asteroid field/,
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

console.log("All golden-path assertions passed.");
