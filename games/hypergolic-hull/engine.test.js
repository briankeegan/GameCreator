// engine.test.js — headless golden-path test for Level 1 (design doc §6).
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

const level1 = LEVELS.find((l) => l.id === 1);

// ---- step 1: Sublight to (1,-1); neither Interceptor is adjacent yet ----

let state = Engine.createGameState(level1);
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
