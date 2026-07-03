// engine.test.js — headless golden-path test for the design doc's §6 board.
// Plain Node, no framework: run with `node games/hypergolic-hull/engine.test.js`.
//
// Note on coordinates: the design doc's prose narrates the first Sublight
// move as "(1,0), neither Interceptor adjacent yet" — but true axial hex
// distance puts (1,0) exactly 1 hex from Interceptor 2 at (1,1), i.e.
// already adjacent (the doc itself flags a similar hand-authored coordinate
// slip in §5's "reconciling the source sketch" note). This test uses (1,-1)
// for that first move instead, which is genuinely distance-2 from both
// Interceptors and matches the doc's stated intent ("no damage yet"). Every
// rule below — Sublight, Ramming Speed's instant-kill-before-enemy-phase,
// Interceptor pursuit AI, the mistake/correct damage branch, Tractor Beam,
// Fighter Squadron, and the exit-unlock/level-complete flow — is exercised
// exactly as specified; only the illustrative coordinate changed.
"use strict";

const assert = require("assert");
const Engine = require("./engine.js");
const { LEVELS } = require("./levels.js");

function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

// The golden path is pinned to the design doc's §6 board as an inline
// fixture. levels.js is live game content that evolves with playtest
// feedback (Sector 1 is now a gentler one-Interceptor board), and the
// engine plays any LevelDef, so the rules coverage stays put while the
// shipped levels are free to change. Shipped levels are validated below.
const goldenLevel = {
  id: 999,
  radius: 2,
  playerStart: { q: 0, r: 0 },
  exit: { q: 2, r: 0 },
  outpost: { q: -2, r: 0 },
  enemies: [
    { type: "interceptor", q: -1, r: -1 },
    { type: "interceptor", q: 1, r: 1 },
  ],
  hazards: [],
  exitRule: "all-enemies-dead",
};

// ---- every shipped level must pass engine validation --------------------

for (const level of LEVELS) {
  const s = Engine.createGameState(level); // throws if the level is invalid
  assert.strictEqual(s.status, "playing", `Level ${level.id} should start playable`);
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
};
const meleeState = Engine.createGameState(meleeLevel);
Engine.applySublight(meleeState, { q: 0, r: 3 }); // step adjacent: interceptor attacks
assert.strictEqual(meleeState.hull, 2, "the adjacent interceptor strikes");
assert.ok(meleeState.events.some((e) => e.type === "attack"), "attacks emit an attack event");
assert.ok(meleeState.events.some((e) => e.type === "damage"), "damage emits a damage event");

// ---- step 1: Sublight to (1,-1); neither Interceptor is adjacent yet ----

let state = Engine.createGameState(goldenLevel);
assert.strictEqual(state.hull, 3);
assert.strictEqual(Engine.livingEnemies(state).length, 2);

Engine.applySublight(state, { q: 1, r: -1 });

assert.deepStrictEqual(state.playerPos, { q: 1, r: -1 });
assert.strictEqual(state.hull, 3, "no enemy should be adjacent after the first exchange");
assert.strictEqual(state.status, "playing");

// ---- step 2: Ramming Speed vaporizes Interceptor 2; Interceptor 1 closes in

const e1Before = state.enemies.find((e) => e.id === "e1" && e.alive);
assert.ok(e1Before, "Interceptor 2 (e1) should still be alive before ramming");

Engine.applyRamming(state, { q: 2, r: -1 });

assert.strictEqual(state.enemies.find((e) => e.id === "e1").alive, false, "Interceptor 2 should be vaporized");
assert.strictEqual(Engine.livingEnemies(state).length, 1);

const interceptor1 = Engine.livingEnemies(state)[0];
assert.strictEqual(interceptor1.id, "e0");
assert.strictEqual(
  Engine.isAdjacent(interceptor1, state.playerPos),
  true,
  "Interceptor 1 should have closed to adjacency during the enemy phase"
);
assert.strictEqual(state.hull, 3, "ramming resolves before the enemy phase, so no damage yet");

// ---- step 3a: mistake branch — stay in range, eat the deterministic strike

const mistakeState = clone(state);
const staysAdjacent = Engine.legalSublightTargets(mistakeState).find(
  (to) => Engine.isAdjacent(to, interceptor1)
);
assert.ok(staysAdjacent, "expected a legal move that stays adjacent to Interceptor 1");
Engine.applySublight(mistakeState, staysAdjacent);
assert.strictEqual(mistakeState.hull, 2, "staying adjacent to Interceptor 1 should eat its deterministic strike (Hull 3 -> 2)");

// ---- step 3b: correct branch — Fighter Squadron kills Interceptor 1 outright

const correctState = clone(state);
Engine.applyFighter(correctState, interceptor1.id);

assert.strictEqual(Engine.livingEnemies(correctState).length, 0, "Interceptor 1 should be destroyed by the fighter squadron");
assert.strictEqual(correctState.hull, 3, "the correct branch should take no damage");
assert.strictEqual(correctState.status, "playing");
assert.strictEqual(correctState.rammingDisabled, true, "Ramming Speed should be disabled while fighters are deployed");
assert.deepStrictEqual(correctState.fighterHex, { q: interceptor1.q, r: interceptor1.r });

// ---- step 4: gate unlocks once all enemies are dead; walking onto it wins

assert.strictEqual(correctState.exitUnlocked, true, "Warp Gate should unlock once all enemies are dead");

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

console.log("All golden-path assertions passed.");
