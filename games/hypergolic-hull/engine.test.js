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
// mistake/correct damage branch, Tractor Beam, Fighter Squadron, and the
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
assert.ok(LEVELS.length >= 5, "expected the five-sector tutorial campaign");
assert.deepStrictEqual(LEVELS[0].actions, ["sublight"], "Sector 1 teaches moving and nothing else");
assert.strictEqual(LEVELS[0].enemies.length, 0, "Sector 1 has no enemies");
assert.strictEqual(
  Engine.createGameState(LEVELS[0]).exitUnlocked,
  true,
  "an enemy-free sector starts with the gate online"
);
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
assert.deepStrictEqual(Engine.legalFighterTargets(tutorialState), [], "locked fighter offers no targets");
assert.throws(
  () => Engine.applyFighter(tutorialState, "e0"),
  /not unlocked/,
  "locked actions must refuse to run"
);
assert.strictEqual(tutorialState.enemies[0].alive, true, "the refused action must not change state");

// ---- rect boards: bounds, edge push-kills, and animation events ----------

const rectLevel = {
  id: 996,
  name: "rect fixture",
  board: { type: "rect", cols: 4, rows: 5 },
  playerStart: { q: 0, r: 4 }, // bottom row (col 2)
  exit: { q: 2, r: 0 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 2, r: 2 }], // col 3: the right edge of row 2
  hazards: [],
  exitRule: "all-enemies-dead",
};
const rectState = Engine.createGameState(rectLevel);
assert.strictEqual(rectState.boardHexes.length, 20, "4x5 rect board has 20 hexes");
assert.ok(Engine.onBoard(rectState, { q: -2, r: 4 }), "row 4 starts at q=-2");
assert.ok(!Engine.onBoard(rectState, { q: 2, r: 4 }), "q=2 is past row 4's right edge");
assert.ok(!Engine.onBoard(rectState, { q: 0, r: 5 }), "row 5 is off a 5-row board");

// Tractor push off a rect edge kills, and emits a kill event for the renderer.
rectState.playerPos = { q: 1, r: 2 }; // adjacent to the edge enemy at (2,2), pushing right
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
  playerStart: { q: 0, r: 4 },
  exit: { q: 2, r: 0 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 0, r: 2 }],
  hazards: [],
  exitRule: "all-enemies-dead",
  actions: ["sublight"],
};
const meleeState = Engine.createGameState(meleeLevel);
Engine.applySublight(meleeState, { q: 0, r: 3 }); // step adjacent: interceptor attacks
assert.strictEqual(meleeState.hull, 2, "a strike now costs 1 of 3 Hull — no longer instant death");
assert.strictEqual(meleeState.status, "playing", "with 3 Hull the run survives a single hit");
assert.ok(meleeState.events.some((e) => e.type === "attack"), "attacks emit an attack event");
assert.ok(meleeState.events.some((e) => e.type === "damage"), "damage emits a damage event");

// The killing blow still ends the run and emits playerDeath — it just takes
// three hits now instead of one.
const deathState = Engine.createGameState(meleeLevel);
deathState.hull = 1;
Engine.applySublight(deathState, { q: 0, r: 3 });
assert.strictEqual(deathState.status, "lost", "the final hit still ends the run");
assert.ok(deathState.events.some((e) => e.type === "playerDeath"), "lethal damage emits a playerDeath event");
assert.ok(
  meleeState.events.some((e) => e.type === "playerMove" && e.to.q === 0 && e.to.r === 3),
  "player moves emit a playerMove event (drives the flight animation)"
);

// ---- findPath: quickest-route preview --------------------------------------

const pathState = Engine.createGameState({
  id: 994,
  name: "path fixture",
  board: { type: "rect", cols: 4, rows: 5 },
  playerStart: { q: 0, r: 4 },
  exit: { q: 2, r: 0 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 1, r: 2 }],
  hazards: [],
  exitRule: "all-enemies-dead",
});
const route = Engine.findPath(pathState, pathState.playerPos, { q: 2, r: 0 });
assert.ok(route, "a route to the far corner exists");
assert.deepStrictEqual(route[0], { q: 0, r: 4 }, "the route starts at the player");
assert.deepStrictEqual(route[route.length - 1], { q: 2, r: 0 }, "the route ends at the target");
for (let i = 1; i < route.length; i++) {
  assert.strictEqual(Engine.isAdjacent(route[i - 1], route[i]), true, "every route step is one hex");
  assert.ok(!Engine.posEq(route[i], { q: 1, r: 2 }), "the route detours around the enemy");
}
assert.strictEqual(
  Engine.findPath(pathState, pathState.playerPos, { q: 1, r: 2 }),
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

// ---- step 3b: correct branch — Fighter Squadron kills Interceptor 1 outright

const correctState = clone(state);
Engine.applyFighter(correctState, interceptor1.id);

assert.strictEqual(Engine.livingEnemies(correctState).length, 0, "Interceptor 1 should be destroyed by the fighter squadron");
assert.strictEqual(correctState.hull, 3, "the correct branch should take no damage");
assert.strictEqual(correctState.status, "playing");
assert.strictEqual(correctState.rammingDisabled, true, "the Impulse Cannon should be disabled while fighters are deployed");
assert.deepStrictEqual(correctState.fighterHex, { q: interceptor1.q, r: interceptor1.r });

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
  playerStart: { q: 0, r: 4 },
  exit: { q: 2, r: 0 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 0, r: 2 }],
  hazards: [],
  exitRule: "all-enemies-dead",
};

// Moving into range auto-fires the Impulse Cannon — no separate arm-and-aim step.
let weaponState = Engine.createGameState(weaponLevel);
assert.strictEqual(weaponState.enemies[0].hp, 1, "enemies start at 1 HP");
assert.deepStrictEqual(weaponState.systems, { warpdrive: true, ram: true }, "both systems default on");
Engine.applySublight(weaponState, { q: 0, r: 3 }); // steps adjacent to the interceptor
assert.strictEqual(weaponState.enemies[0].alive, false, "moving into range auto-fires the Impulse Cannon");
assert.ok(weaponState.events.some((e) => e.type === "kill"), "the auto-attack emits a kill event");
assert.ok(
  weaponState.events.some((e) => e.type === "kill" && e.source === "weapon"),
  "the auto-attack's kill is tagged source:weapon — the renderer uses this to aim the flagship at it, distinct from a Tractor/Fighter kill"
);

// Toggling the Impulse Cannon off suppresses the auto-attack.
weaponState = Engine.createGameState(weaponLevel);
Engine.setSystem(weaponState, "ram", false);
Engine.applySublight(weaponState, { q: 0, r: 3 });
assert.strictEqual(weaponState.enemies[0].alive, true, "Impulse Cannon toggled off does not fire");

// Hold Position resolves the turn — and still auto-fires — without moving.
weaponState = Engine.createGameState(weaponLevel);
weaponState.playerPos = { q: 0, r: 3 }; // already adjacent, bypassing a staging move
Engine.applyHoldPosition(weaponState);
assert.deepStrictEqual(weaponState.playerPos, { q: 0, r: 3 }, "Hold Position never moves the flagship");
assert.strictEqual(weaponState.enemies[0].alive, false, "Hold Position still lets an armed weapon auto-fire");

// Warpdrive off blocks movement outright — Hold Position is the only option.
weaponState = Engine.createGameState(weaponLevel);
Engine.setSystem(weaponState, "warpdrive", false);
assert.throws(
  () => Engine.applySublight(weaponState, { q: 0, r: 3 }),
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
  playerStart: { q: 0, r: 6 },
  exit: { q: 2, r: 0 },
  outpost: null,
  enemies: [{ type: "sentry", q: 0, r: 2 }],
  hazards: [],
  exitRule: "all-enemies-dead",
  actions: ["sublight"], // no flagship weapons, so the Sentry lives to fire back
};
const sentryState = Engine.createGameState(sentryLevel);
const sentryStart = { q: sentryState.enemies[0].q, r: sentryState.enemies[0].r };
Engine.applySublight(sentryState, { q: 0, r: 5 }); // distance 3 — still out of the beam
assert.strictEqual(sentryState.status, "playing", "stepping to distance 3 is safe — the beam only reaches 2");
assert.deepStrictEqual(
  { q: sentryState.enemies[0].q, r: sentryState.enemies[0].r },
  sentryStart,
  "the Sentry does not move to chase — it holds its hex"
);
const hullBeforeBeam = sentryState.hull;
Engine.applySublight(sentryState, { q: 0, r: 4 }); // distance 2 — into the beam
assert.strictEqual(sentryState.hull, hullBeforeBeam - 1, "entering the Sentry's 2-hex ring takes a hit");
assert.ok(sentryState.events.some((e) => e.type === "attack"), "the Sentry's shot emits an attack event");

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
assert.strictEqual(salvageState.salvage, 0, "a fresh run starts with zero salvage");
assert.deepStrictEqual(Engine.outpostOffers(salvageState), [], "not standing on the outpost hex means no offers");

// Fighter Squadron kills the lone Interceptor instantly and drops its salvage.
Engine.applyFighter(salvageState, salvageState.enemies[0].id);
assert.strictEqual(salvageState.salvage, Engine.ENEMY_TYPES.interceptor.salvage, "a kill drops its type's salvage value");
assert.ok(salvageState.events.some((e) => e.type === "salvage"), "a kill emits a salvage event for the UI to animate");

// Walk to the outpost (2 hexes away) — shopping there must not cost a turn.
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

assert.throws(
  () => Engine.applyOutpostPurchase(salvageState, "reinforce"),
  /not enough salvage/,
  "an offer refuses when salvage can't cover its cost"
);

// Salvage and the raised max-Hull both carry into the next sector via
// createGameState's carryOver — this is how loadSector() in app.js hands a
// run's progress from one sector to the next.
const carriedState = Engine.createGameState(LEVELS[0], { salvage: 4, maxHull: salvageState.maxHull });
assert.strictEqual(carriedState.salvage, 4, "salvage carries over into the next sector");
assert.strictEqual(carriedState.maxHull, salvageState.maxHull, "a permanent max-Hull upgrade carries over too");
assert.strictEqual(carriedState.hull, carriedState.maxHull, "the new sector still starts at full (carried-over) Hull");

// ---- procedural depth: the run never hard-stops past the campaign -------
// generateLevel(depth) must produce a valid LevelDef for a wide range of
// depths — validateLevel (run inside createGameState) throws if anything's
// off-board, overlapping, or too close to the player start.

for (const depth of [6, 7, 10, 15, 25, 40]) {
  const level = generateLevel(depth);
  const s = Engine.createGameState(level); // throws if invalid
  assert.strictEqual(s.status, "playing", `generated depth ${depth} should start playable`);
  assert.strictEqual(s.exitUnlocked, true, `generated depth ${depth} starts with the gate online too`);
  assert.ok(s.enemies.length > 0, `generated depth ${depth} should have at least one enemy`);
  assert.ok(Boolean(s.outpostPos), `generated depth ${depth} should include an outpost`);
}
// Same depth deals the same board every time (reproducible runs).
assert.deepStrictEqual(generateLevel(12), generateLevel(12), "generateLevel is deterministic per depth");
// Different depths are not just reskins of each other.
assert.notDeepStrictEqual(generateLevel(6).enemies, generateLevel(20).enemies, "deeper sectors deal a different board");
assert.ok(generateLevel(20).enemies.length >= generateLevel(6).enemies.length, "enemy count scales up (or holds) with depth");

console.log("All golden-path assertions passed.");
