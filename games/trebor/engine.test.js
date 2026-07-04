// engine.test.js — headless rules coverage for TREEBOAR's deck-builder run:
// node choices (fight/elite/rest), combat, card rewards, and the boss.
// Plain Node, no framework: run with `node games/trebor/engine.test.js`.
"use strict";

const assert = require("assert");
const Engine = require("./engine.js");
const Content = require("./content.js");

// A fixed rng (always 0) makes shuffle() fully deterministic and
// reproducible — not "random-looking", but exactly what these tests need
// to assert exact hands/rewards/outcomes.
const rng = () => 0;

// A minimally sensible bot: block when a hit is actually coming and
// current Block wouldn't cover it, otherwise make damage progress. Not
// optimal play, just enough to stand in for "a player who reacts to what
// the telegraphed intents show."
function chooseCardIndex(state, content) {
  const incoming = Engine.livingEnemies(state)
    .filter((e) => e.currentIntent.type === "attack")
    .reduce((sum, e) => sum + e.currentIntent.damage, 0);
  const affordable = [];
  for (let i = 0; i < state.hand.length; i++) {
    if (state.player.energy >= content.CARDS[state.hand[i]].cost) affordable.push(i);
  }
  if (affordable.length === 0) return -1;
  if (incoming > state.player.block) {
    const blockIdx = affordable.find((i) => content.CARDS[state.hand[i]].block);
    if (blockIdx !== undefined) return blockIdx;
  }
  const dmgIdx = affordable.find((i) => content.CARDS[state.hand[i]].damage);
  return dmgIdx !== undefined ? dmgIdx : affordable[0];
}

// Plays out the current combat with the bot above, stopping once combat
// ends (status is no longer "playing"). The underlying draw/play/discard
// mechanics are the same ones already exercised card-by-card below on
// Floor 1; this just finishes a fight without hand-tracing every card.
function playOutCombat(state, content) {
  let guard = 0;
  while (state.status === "playing") {
    if (++guard > 500) throw new Error("combat did not converge");
    const idx = chooseCardIndex(state, content);
    if (idx === -1) {
      Engine.endPlayerTurn(state, content, rng);
      continue;
    }
    const card = content.CARDS[state.hand[idx]];
    const targetId = Engine.cardNeedsTarget(card) ? Engine.livingEnemies(state)[0].id : null;
    Engine.playCard(state, content, idx, targetId, rng);
  }
}

// ---------------------------------------------------------------------
// Floor 1, Fight: traced card-by-card (same primitives as before, now
// reached via chooseNode instead of starting automatically).
// ---------------------------------------------------------------------
const state = Engine.createGameState(Content, rng);
assert.strictEqual(state.status, "choosing");
assert.strictEqual(state.floorIndex, 0);
assert.strictEqual(state.deck.length, Content.STARTER_DECK.length);
assert.deepStrictEqual(
  state.nodeChoices.map((o) => o.type),
  ["fight", "fight", "rest"],
  "Floor 1 offers two fights and a rest, no elite yet"
);

Engine.chooseNode(state, Content, 0, rng); // "Back Alley" — fight an Alley Cat
assert.strictEqual(state.status, "playing");
assert.strictEqual(state.currentNodeType, "fight");
assert.strictEqual(state.enemies.length, 1);
assert.strictEqual(state.enemies[0].typeId, "alleyCat");
assert.strictEqual(state.enemies[0].hp, 14);
assert.deepStrictEqual(
  state.hand,
  ["bite", "goodBoy", "guardDog", "pounce", "fetch"],
  "the deterministic shuffle deals this exact opening hand, same as a fresh deck always would"
);
assert.strictEqual(state.enemies[0].currentIntent.type, "attack", "the cat's first move is telegraphed before the player acts");

const cat = state.enemies[0];

Engine.playCard(state, Content, 0, null, rng); // Bite -> cat (auto-targets the lone enemy)
assert.strictEqual(cat.hp, 8);
assert.strictEqual(state.player.energy, 2);

Engine.playCard(state, Content, 0, null, rng); // Good Boy -> +1 energy
assert.strictEqual(state.player.energy, 3);

Engine.playCard(state, Content, 0, null, rng); // Guard Dog -> +10 Block
assert.strictEqual(state.player.block, 10);
assert.strictEqual(state.player.energy, 1);
assert.deepStrictEqual(state.hand, ["pounce", "fetch"]);

assert.throws(() => Engine.playCard(state, Content, 0, null, rng), /Not enough energy/, "Pounce costs 2 but only 1 energy remains");

Engine.playCard(state, Content, 1, null, rng); // Fetch -> cat, then redraws a card
assert.strictEqual(cat.hp, 5);
assert.strictEqual(state.player.energy, 0);

Engine.endPlayerTurn(state, Content, rng);
assert.strictEqual(state.player.hp, 28, "10 Block fully absorbed the cat's telegraphed Attack 6");
assert.strictEqual(state.player.block, 0, "Block resets at the start of the next player turn");
assert.deepStrictEqual(state.hand, ["growl", "growl", "growl", "bite", "bite"]);

Engine.playCard(state, Content, 3, null, rng); // Bite -> lethal
assert.strictEqual(cat.hp, 0);
assert.strictEqual(state.status, "reward", "a non-boss combat win goes straight to a card reward, not a dead-end clear screen");
assert.strictEqual(state.rewardOptions.length, Content.FIGHT_REWARD_COUNT, "a plain fight offers the normal reward count");
assert.ok(state.rewardOptions.every((id) => Content.CARDS[id]), "every offered reward id is a real card");
assert.strictEqual(new Set(state.rewardOptions).size, state.rewardOptions.length, "no duplicate offers");

assert.throws(() => Engine.pickReward(state, Content, "not-a-real-card", rng), /was not offered/);

const chosenCard = state.rewardOptions[0];
Engine.pickReward(state, Content, chosenCard, rng);
assert.strictEqual(state.deck.length, Content.STARTER_DECK.length + 1, "picking a reward permanently grows the deck");
assert.strictEqual(state.deck[state.deck.length - 1], chosenCard);
assert.strictEqual(state.status, "choosing");
assert.strictEqual(state.floorIndex, 1);
assert.deepStrictEqual(
  state.nodeChoices.map((o) => o.type),
  ["fight", "elite", "rest"],
  "Floor 2 introduces an elite option"
);

// ---------------------------------------------------------------------
// Rest node: heals a fraction of missing HP and advances the floor with
// no combat at all.
// ---------------------------------------------------------------------
state.player.hp = 10; // simulate having taken damage
const expectedHeal = Math.ceil((state.player.maxHp - state.player.hp) * Content.REST_HEAL_FRACTION);
Engine.chooseNode(state, Content, 2, rng); // "Sunny Spot" — rest
assert.strictEqual(state.player.hp, 10 + expectedHeal);
assert.strictEqual(state.status, "choosing", "resting skips straight to the next floor's choices, no combat");
assert.strictEqual(state.floorIndex, 2);

// ---------------------------------------------------------------------
// Elite node: tougher fight, a bigger reward offer. Top off HP first —
// this test is about elite mechanics (enemy count, reward count), not
// about whether the naive bot below can survive at reduced HP.
// ---------------------------------------------------------------------
state.player.hp = state.player.maxHp;
Engine.chooseNode(state, Content, 1, rng); // "Fire Escape" — elite (two Tabby Guards)
assert.strictEqual(state.currentNodeType, "elite");
assert.strictEqual(state.enemies.length, 2);
assert.ok(state.enemies.every((e) => e.typeId === "tabbyGuard"));
playOutCombat(state, Content);
assert.strictEqual(state.status, "reward");
assert.strictEqual(state.rewardOptions.length, Content.ELITE_REWARD_COUNT, "an elite offers one extra reward option");
Engine.pickReward(state, Content, null, rng); // skip the reward entirely
assert.strictEqual(state.deck.length, Content.STARTER_DECK.length + 1, "skipping a reward leaves the deck unchanged");
assert.strictEqual(state.floorIndex, 3);

// ---------------------------------------------------------------------
// AoE cards hit every living enemy at once, and need no explicit target
// even when more than one enemy is alive.
// ---------------------------------------------------------------------
Engine.chooseNode(state, Content, 0, rng); // Floor 4's plain fight: Alley Cat + Tabby Guard
assert.strictEqual(state.enemies.length, 2);
assert.strictEqual(Engine.cardNeedsTarget(Content.CARDS.howl), false, "an AoE card needs no explicit target");
state.hand.unshift("howl");
state.player.energy = 3;
const [beforeA, beforeB] = state.enemies.map((e) => e.hp);
Engine.playCard(state, Content, 0, null, rng); // Howl -> both enemies, no target given
assert.strictEqual(state.enemies[0].hp, beforeA - 4);
assert.strictEqual(state.enemies[1].hp, beforeB - 4, "Howl hit the second enemy too, without ever naming it");

// Finish this floor's fight, and Floor 4's last elite fight, to reach the boss.
playOutCombat(state, Content);
if (state.status === "reward") Engine.pickReward(state, Content, null, rng);
assert.strictEqual(state.status, "playing", "clearing the last floor drops straight into the boss fight, no node choice");
assert.strictEqual(state.currentNodeType, "boss");
assert.strictEqual(state.enemies[0].typeId, "bigTom");

// ---------------------------------------------------------------------
// Multi-enemy targeting still requires an explicit target for non-AoE
// damage once more than one enemy is alive.
// ---------------------------------------------------------------------
const multiState = Engine.createGameState(Content, rng);
Engine.chooseNode(multiState, Content, 2, rng); // Floor 1: rest, straight to Floor 2 untouched
Engine.chooseNode(multiState, Content, 0, rng); // Floor 2: fight
playOutCombat(multiState, Content);
Engine.pickReward(multiState, Content, null, rng); // -> Floor 3
// Floor 3's plain fight fields two Alley Cats.
Engine.chooseNode(multiState, Content, 0, rng);
assert.strictEqual(multiState.enemies.length, 2);
const [catA, catB] = multiState.enemies;
assert.throws(
  () => Engine.playCard(multiState, Content, 0, null, rng),
  /Must specify a target/,
  "a single-target attack needs an explicit target once two cats are alive"
);
Engine.playCard(multiState, Content, 0, catB.id, rng);
assert.strictEqual(catB.hp, 8, "damage landed on the named target");
assert.strictEqual(catA.hp, 14, "the untargeted cat is untouched");

// ---------------------------------------------------------------------
// Loss: a dog with 1 HP does not survive a telegraphed Attack.
// ---------------------------------------------------------------------
const lossState = Engine.createGameState(Content, rng);
Engine.chooseNode(lossState, Content, 0, rng);
lossState.player.hp = 1;
assert.strictEqual(lossState.enemies[0].currentIntent.type, "attack");
Engine.endPlayerTurn(lossState, Content, rng); // no Block played — the hit lands
assert.strictEqual(lossState.status, "lost");
assert.strictEqual(lossState.player.hp, 0, "hp clamps at 0, never negative");
assert.throws(() => Engine.playCard(lossState, Content, 0, null, rng), /Cannot play a card/);
assert.throws(() => Engine.endPlayerTurn(lossState, Content, rng), /Cannot end turn/);

// ---------------------------------------------------------------------
// Full-run smoke test: never the riskier elite, rest when hurt, always
// bank the first offered reward — a cautious-but-sensible player using
// every system on offer (rest sites, reward growth) should be able to
// beat the boss. This is the balance/regression backstop for content.js.
// ---------------------------------------------------------------------
const run = Engine.createGameState(Content, rng);
let steps = 0;
while (run.status !== "victory" && run.status !== "lost") {
  if (++steps > 3000) throw new Error("run did not converge — possible infinite loop");
  if (run.status === "choosing") {
    const hurt = run.player.hp < run.player.maxHp * 0.7;
    const restIdx = run.nodeChoices.findIndex((o) => o.type === "rest");
    const fightIdx = run.nodeChoices.findIndex((o) => o.type === "fight");
    Engine.chooseNode(run, Content, hurt && restIdx !== -1 ? restIdx : fightIdx, rng);
  } else if (run.status === "reward") {
    Engine.pickReward(run, Content, run.rewardOptions[0], rng);
  } else if (run.status === "playing") {
    playOutCombat(run, Content);
  }
}
assert.strictEqual(run.status, "victory", "a cautious player resting when hurt and fighting otherwise should beat the dungeon");

console.log("All golden-path assertions passed.");
