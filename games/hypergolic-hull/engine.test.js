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
  playerStart: { q: 2, r: 3 }, // column 2
  exit: { q: 2, r: -1 },
  outpost: null,
  enemies: [{ type: "interceptor", q: 3, r: 1 }], // column 3: the rightmost column
  hazards: [],
  exitRule: "all-enemies-dead",
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
assert.deepStrictEqual(weaponState.systems, { warpdrive: true, ram: true, lance: true }, "all systems default on");
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
  assert.ok(offers.length >= 1 && offers.length <= 4, `level ${id}: 1-4 total offers (Repair plus 0-3 extras)`);
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

// ---- Energy + Random Blink: a second resource, deliberately random -------
// Energy regenerates 1/turn (distinct from Hull, which never self-heals)
// and pays for Random Blink, a genuine exception to "zero randomness in
// combat" — an unpredictable emergency teleport, not a precision tool.

const blinkLevel = {
  id: 990,
  radius: 3,
  playerStart: { q: 0, r: 0 },
  exit: { q: 3, r: 0 },
  outpost: null,
  enemies: [{ type: "interceptor", q: -3, r: 3 }],
  hazards: [],
  exitRule: "all-enemies-dead",
  actions: ["sublight", "blink"],
};
const blinkState = Engine.createGameState(blinkLevel);
assert.strictEqual(blinkState.energy, 3, "a fresh run starts at full Energy");
assert.strictEqual(blinkState.maxEnergy, 3);

assert.throws(
  () => Engine.applyBlink({ ...blinkState, energy: 1 }),
  /not enough Energy/,
  "Blink refuses when Energy is below its cost"
);

const posBeforeBlink = { q: blinkState.playerPos.q, r: blinkState.playerPos.r };
Engine.applyBlink(blinkState);
// Blink resolves a full turn (endPlayerAction runs the enemy phase, which
// regenerates 1 Energy same as any other turn), so the net change is the
// cost minus that turn's regen tick.
assert.strictEqual(blinkState.energy, 3 - Engine.BLINK_ENERGY_COST + 1, "Blink spends its Energy cost, net of that turn's regen");
assert.ok(!Engine.posEq(blinkState.playerPos, posBeforeBlink), "Blink actually moves the flagship");
assert.ok(Engine.onBoard(blinkState, blinkState.playerPos), "Blink always lands on a valid board hex");
assert.ok(blinkState.events.some((e) => e.type === "blink"), "Blink emits a blink event for the UI");

// Energy regenerates 1/turn, capped at max — a plain Sublight move (which
// still runs the enemy phase / turn counter) should tick it back up.
const energyBefore = blinkState.energy;
Engine.applyHoldPosition(blinkState);
assert.strictEqual(
  blinkState.energy,
  Math.min(blinkState.maxEnergy, energyBefore + 1),
  "Energy regenerates by 1 every turn, capped at max"
);

// Locked out entirely without "blink" unlocked.
const noBlinkState = Engine.createGameState({ ...blinkLevel, actions: ["sublight"] });
assert.throws(() => Engine.applyBlink(noBlinkState), /not unlocked/, "Blink refuses when not yet unlocked");

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
