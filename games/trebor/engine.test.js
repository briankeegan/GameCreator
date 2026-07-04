// engine.test.js — headless rules coverage for TREEBOAR's deck-builder
// combat. Plain Node, no framework: run with `node games/trebor/engine.test.js`.
"use strict";

const assert = require("assert");
const Engine = require("./engine.js");
const Content = require("./content.js");

// A fixed rng (always 0) makes shuffle() fully deterministic and
// reproducible — not "random-looking", but exactly what a golden-path test
// needs so exact hands/outcomes can be asserted below.
const rng = () => 0;

// ---------------------------------------------------------------------
// Golden path: Room 1 (single Alley Cat), traced card-by-card.
// ---------------------------------------------------------------------
const state = Engine.createGameState(Content, rng);
assert.strictEqual(state.status, "playing");
assert.strictEqual(state.roomIndex, 0);
assert.strictEqual(state.enemies.length, 1);
assert.strictEqual(state.enemies[0].typeId, "alleyCat");
assert.strictEqual(state.enemies[0].hp, 14);
assert.deepStrictEqual(
  state.hand,
  ["bite", "goodBoy", "guardDog", "pounce", "fetch"],
  "the deterministic shuffle should deal this exact opening hand"
);
assert.strictEqual(
  state.enemies[0].currentIntent.type,
  "attack",
  "the cat's first move is telegraphed before the player acts"
);

const cat = state.enemies[0];

Engine.playCard(state, Content, 0, null, rng); // Bite -> cat (auto-targets the lone enemy)
assert.strictEqual(cat.hp, 8);
assert.strictEqual(state.player.energy, 2);
assert.deepStrictEqual(state.hand, ["goodBoy", "guardDog", "pounce", "fetch"]);

Engine.playCard(state, Content, 0, null, rng); // Good Boy -> +1 energy, no target
assert.strictEqual(state.player.energy, 3);
assert.deepStrictEqual(state.hand, ["guardDog", "pounce", "fetch"]);

Engine.playCard(state, Content, 0, null, rng); // Guard Dog -> +10 Block
assert.strictEqual(state.player.block, 10);
assert.strictEqual(state.player.energy, 1);
assert.deepStrictEqual(state.hand, ["pounce", "fetch"]);

assert.throws(
  () => Engine.playCard(state, Content, 0, null, rng),
  /Not enough energy/,
  "Pounce costs 2 but only 1 energy remains"
);

Engine.playCard(state, Content, 1, null, rng); // Fetch -> cat, then redraws a card
assert.strictEqual(cat.hp, 5);
assert.strictEqual(state.player.energy, 0);
assert.deepStrictEqual(
  state.hand,
  ["pounce", "fetch"],
  "Fetch discards itself then immediately redraws one replacement card"
);

Engine.endPlayerTurn(state, Content, rng);
assert.strictEqual(state.player.hp, 25, "10 Block fully absorbed the cat's telegraphed Attack 6");
assert.strictEqual(state.player.block, 0, "Block resets at the start of the next player turn");
assert.strictEqual(state.player.energy, 3, "energy refills for the new turn");
assert.strictEqual(state.turnCount, 2);
assert.deepStrictEqual(
  state.hand,
  ["growl", "growl", "growl", "bite", "bite"],
  "the new turn draws the next 5 cards off the same deterministic shuffle"
);
assert.strictEqual(cat.currentIntent.type, "attack", "the cat's pattern advanced to its next telegraphed move");
assert.strictEqual(cat.nextIntent.type, "guard", "and previews the move after that");

Engine.playCard(state, Content, 3, null, rng); // Bite -> cat, lethal
assert.strictEqual(cat.hp, 0);
assert.strictEqual(state.status, "room-clear", "clearing the room's last living enemy ends it immediately");

Engine.advanceRoom(state, Content, rng);
assert.strictEqual(state.status, "playing");
assert.strictEqual(state.roomIndex, 1);
assert.strictEqual(state.turnCount, 1);
assert.strictEqual(state.enemies[0].typeId, "tabbyGuard");
assert.strictEqual(state.enemies[0].hp, 20);
assert.deepStrictEqual(
  state.hand,
  ["bite", "goodBoy", "guardDog", "pounce", "fetch"],
  "each room reshuffles the full deck fresh, independent of the last room"
);
assert.strictEqual(state.enemies[0].currentIntent.type, "guard", "Tabby Guard opens by guarding, not attacking");

// ---------------------------------------------------------------------
// Multi-enemy targeting: an attack card must name a target once more than
// one enemy is alive (Room 3 fields two Alley Cats at once).
// ---------------------------------------------------------------------
const multiContent = Object.assign({}, Content, {
  ROOMS: [{ id: 1, name: "Test Room", enemies: ["alleyCat", "alleyCat"] }],
});
const multiState = Engine.createGameState(multiContent, rng);
assert.strictEqual(multiState.enemies.length, 2);
const [catA, catB] = multiState.enemies;
assert.notStrictEqual(catA.id, catB.id, "two cats of the same type still get distinct ids");

assert.throws(
  () => Engine.playCard(multiState, multiContent, 0, null, rng),
  /Must specify a target/,
  "Bite needs an explicit target once two cats are alive"
);
Engine.playCard(multiState, multiContent, 0, catB.id, rng);
assert.strictEqual(catB.hp, 8, "damage landed on the named target");
assert.strictEqual(catA.hp, 14, "the untargeted cat is untouched");

// ---------------------------------------------------------------------
// Loss: a dog with 1 HP does not survive a telegraphed Attack.
// ---------------------------------------------------------------------
const bossContent = Object.assign({}, Content, {
  ROOMS: [{ id: 1, name: "Boss Test", enemies: ["bigTom"] }],
});
const lossState = Engine.createGameState(bossContent, rng);
lossState.player.hp = 1;
assert.strictEqual(lossState.enemies[0].currentIntent.type, "attack");
Engine.endPlayerTurn(lossState, bossContent, rng); // no Block played — the hit lands
assert.strictEqual(lossState.status, "lost");
assert.strictEqual(lossState.player.hp, 0, "hp clamps at 0, never negative");
assert.throws(() => Engine.playCard(lossState, bossContent, 0, null, rng), /Cannot play a card/);
assert.throws(() => Engine.endPlayerTurn(lossState, bossContent, rng), /Cannot end turn/);

// ---------------------------------------------------------------------
// Full-run smoke test: a simple "play whatever's affordable" bot should be
// able to clear every room, including the boss, without the engine ever
// throwing — this is the balance/regression backstop for content.js.
// ---------------------------------------------------------------------
function firstPlayableIndex(runState, content) {
  for (let i = 0; i < runState.hand.length; i++) {
    if (runState.player.energy >= content.CARDS[runState.hand[i]].cost) return i;
  }
  return -1;
}

const run = Engine.createGameState(Content, rng);
let guard = 0;
while (run.status !== "victory" && run.status !== "lost") {
  if (++guard > 2000) throw new Error("run did not converge — possible infinite loop");
  if (run.status === "room-clear") {
    Engine.advanceRoom(run, Content, rng);
    continue;
  }
  const idx = firstPlayableIndex(run, Content);
  if (idx === -1) {
    Engine.endPlayerTurn(run, Content, rng);
    continue;
  }
  const card = Content.CARDS[run.hand[idx]];
  const targetId = Engine.cardNeedsTarget(card) ? Engine.livingEnemies(run)[0].id : null;
  Engine.playCard(run, Content, idx, targetId, rng);
}
assert.strictEqual(run.status, "victory", "a simple bot should be able to beat the whole dungeon");
assert.strictEqual(run.roomIndex, Content.ROOMS.length, "advanceRoom stepped past the last room to trigger victory");

console.log("All golden-path assertions passed.");
