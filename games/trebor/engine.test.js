// engine.test.js — headless rules coverage for TREEBOAR's deck-builder run:
// class select, node choices (fight/elite/rest), combat, card rewards, and
// the boss. Plain Node, no framework: run with `node games/trebor/engine.test.js`.
"use strict";

const assert = require("assert");
const Engine = require("./engine.js");
const Content = require("./content.js");

// A fixed rng (always 0) makes shuffle() fully deterministic and
// reproducible — exactly what these tests need to assert exact hands/outcomes.
const rng = () => 0;

// A minimally sensible bot: block when a hit is coming and Block wouldn't
// cover it, otherwise make damage progress.
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
// Class select gates the run: nothing else is legal until a dog is picked.
// ---------------------------------------------------------------------
const gate = Engine.createGameState(Content, rng);
assert.strictEqual(gate.status, "class-select");
assert.strictEqual(gate.classId, null);
assert.strictEqual(gate.deck.length, 0);
assert.throws(() => Engine.chooseNode(gate, Content, 0, rng), /Cannot choose a node/);
assert.throws(() => Engine.playCard(gate, Content, 0, null, rng), /Cannot play a card/);
assert.throws(() => Engine.chooseClass(gate, Content, "notADog", rng), /Unknown class/);

// Each class sets its own Hull and 12-card deck.
const hpByClass = { riddle: 24, koozie: 32, bevy: 28 };
for (const id of Object.keys(Content.CLASSES)) {
  const s = Engine.createGameState(Content, rng);
  Engine.chooseClass(s, Content, id, rng);
  assert.strictEqual(s.status, "choosing");
  assert.strictEqual(s.classId, id);
  assert.strictEqual(s.player.maxHp, hpByClass[id], `${id} has the right Hull`);
  assert.strictEqual(s.player.hp, hpByClass[id]);
  assert.strictEqual(s.deck.length, 12, `${id} opens with a 12-card deck`);
  assert.throws(() => Engine.chooseClass(s, Content, id, rng), /Cannot choose a class/, "can't re-pick mid-run");
}

// ---------------------------------------------------------------------
// Floor 1 fight (as Koozie), traced through the key mechanics.
// ---------------------------------------------------------------------
const state = Engine.createGameState(Content, rng);
Engine.chooseClass(state, Content, "koozie", rng);
assert.deepStrictEqual(
  state.nodeChoices.map((o) => o.type),
  ["fight", "fight", "rest"],
  "Floor 1 offers two fights and a rest, no elite yet"
);

Engine.chooseNode(state, Content, 0, rng); // "Back Alley" — fight an Alley Cat
assert.strictEqual(state.status, "playing");
assert.strictEqual(state.enemies[0].typeId, "alleyCat");
assert.strictEqual(state.enemies[0].hp, 14);
assert.deepStrictEqual(
  state.hand,
  ["bite", "fetch", "goodBoy", "secondWind", "guardDog"],
  "Koozie's deterministic opening hand"
);
assert.strictEqual(state.enemies[0].currentIntent.type, "attack", "the cat telegraphs before the player acts");

const cat = state.enemies[0];
Engine.playCard(state, Content, 0, null, rng); // Bite -> cat
assert.strictEqual(cat.hp, 8);
assert.strictEqual(state.player.energy, 2);

Engine.playCard(state, Content, 1, null, rng); // Good Boy -> +1 energy (hand: fetch, goodBoy, secondWind, guardDog)
assert.strictEqual(state.player.energy, 3);

Engine.playCard(state, Content, 2, null, rng); // Guard Dog -> +10 Block, costs 2 (hand: fetch, secondWind, guardDog)
assert.strictEqual(state.player.block, 10);
assert.strictEqual(state.player.energy, 1);

Engine.endPlayerTurn(state, Content, rng);
assert.strictEqual(state.player.hp, 32, "10 Block fully absorbed the telegraphed Attack 6");
assert.strictEqual(state.player.block, 0, "Block resets at the next turn");
assert.strictEqual(state.player.energy, 3);

playOutCombat(state, Content); // finish the cat
assert.strictEqual(state.status, "reward", "a non-boss win goes to a card reward");
assert.strictEqual(state.rewardOptions.length, Content.FIGHT_REWARD_COUNT);
assert.ok(state.rewardOptions.every((id) => Content.CARDS[id]), "every reward is a real card");
assert.throws(() => Engine.pickReward(state, Content, "not-a-card", rng), /was not offered/);

const chosen = state.rewardOptions[0];
Engine.pickReward(state, Content, chosen, rng);
assert.strictEqual(state.deck.length, 13, "picking a reward grows the deck");
assert.strictEqual(state.deck[state.deck.length - 1], chosen);
assert.strictEqual(state.status, "choosing");
assert.strictEqual(state.floorIndex, 1);
assert.ok(state.nodeChoices.some((o) => o.type === "elite"), "Floor 2 has an elite");

// ---------------------------------------------------------------------
// New enemies: a Feral Kitten swarm and a Rooftop Sniper exist and fight.
// ---------------------------------------------------------------------
assert.strictEqual(Content.ENEMY_TYPES.feralKitten.maxHp, 7);
assert.strictEqual(Content.ENEMY_TYPES.rooftopSniper.pattern[1].damage, 13, "the sniper's telegraphed big shot");
const swarmContent = Object.assign({}, Content, {
  ACTS: [
    {
      name: "Test Act",
      floors: [{ options: [{ type: "fight", label: "Test Litter", enemies: ["feralKitten", "feralKitten", "feralKitten"] }] }],
      boss: { label: "Test Boss", enemies: ["bigTom"] },
    },
  ],
});
const swarm = Engine.createGameState(swarmContent, rng);
Engine.chooseClass(swarm, swarmContent, "riddle", rng);
Engine.chooseNode(swarm, swarmContent, 0, rng);
assert.strictEqual(swarm.enemies.length, 3, "the Litter fields three kittens");

// AoE hits every kitten at once, no target needed.
assert.strictEqual(Engine.cardNeedsTarget(Content.CARDS.bigBark), false);
swarm.hand.unshift("bigBark");
swarm.player.energy = 3;
Engine.playCard(swarm, swarmContent, 0, null, rng); // Big Bark -> all three for 8
assert.ok(swarm.enemies.every((e) => e.hp <= 0), "Big Bark (8) clears the 7-HP kittens in one hit");
assert.strictEqual(swarm.status, "reward");

// ---------------------------------------------------------------------
// Single-target still needs an explicit target with multiple enemies alive.
// ---------------------------------------------------------------------
const multi = Engine.createGameState(swarmContent, rng);
Engine.chooseClass(multi, swarmContent, "koozie", rng);
Engine.chooseNode(multi, swarmContent, 0, rng);
const biteIdx = multi.hand.indexOf("bite");
assert.ok(biteIdx >= 0);
assert.throws(() => Engine.playCard(multi, swarmContent, biteIdx, null, rng), /Must specify a target/);
const first = multi.enemies[1];
Engine.playCard(multi, swarmContent, biteIdx, first.id, rng);
assert.strictEqual(first.hp, 1, "Bite (6) hit the named 7-HP kitten");
assert.strictEqual(multi.enemies[0].hp, 7, "the others are untouched");

// ---------------------------------------------------------------------
// Loss: a dog at 1 Hull does not survive a telegraphed Attack.
// ---------------------------------------------------------------------
const loss = Engine.createGameState(Content, rng);
Engine.chooseClass(loss, Content, "bevy", rng);
Engine.chooseNode(loss, Content, 0, rng);
loss.player.hp = 1;
assert.strictEqual(loss.enemies[0].currentIntent.type, "attack");
Engine.endPlayerTurn(loss, Content, rng);
assert.strictEqual(loss.status, "lost");
assert.strictEqual(loss.player.hp, 0, "hp clamps at 0");
assert.throws(() => Engine.playCard(loss, Content, 0, null, rng), /Cannot play a card/);

// ---------------------------------------------------------------------
// Three acts: content.js declares exactly three, each with its own boss,
// each boss meaner than the last.
// ---------------------------------------------------------------------
assert.strictEqual(Content.ACTS.length, 3, "the dungeon has three acts");
const bossHps = Content.ACTS.map((a) => Content.ENEMY_TYPES[a.boss.enemies[0]].maxHp);
assert.ok(bossHps[0] < bossHps[1] && bossHps[1] < bossHps[2], "each act's boss has more Hull than the last");
assert.strictEqual(Content.ACTS[2].boss.enemies[0], "catKing", "the final boss is the Cat King");

// ---------------------------------------------------------------------
// Boss reward: felling a non-final act boss opens a boss-reward pick that
// grants a boss-only card, +max Hull, a full heal, and rolls into the next
// act's first floor. (Constructed directly at the boss-reward state.)
// ---------------------------------------------------------------------
const br = Engine.createGameState(Content, rng);
Engine.chooseClass(br, Content, "koozie", rng); // 32 Hull
br.status = "boss-reward";
br.actIndex = 0;
br.currentNodeType = "boss";
br.player.hp = 5;
br.bossRewardOptions = ["maul", "bulwark", "reserves"];
assert.throws(() => Engine.chooseBossReward(br, Content, "bite", rng), /was not offered/);
const deckBefore = br.deck.length;
Engine.chooseBossReward(br, Content, "maul", rng);
assert.strictEqual(br.deck.length, deckBefore + 1, "the boss-reward card joins the deck");
assert.strictEqual(br.deck[br.deck.length - 1], "maul");
assert.strictEqual(br.player.maxHp, 32 + Content.BOSS_MAX_HULL_BONUS, "boss kill permanently raises max Hull");
assert.strictEqual(br.player.hp, br.player.maxHp, "boss reward heals to full");
assert.strictEqual(br.actIndex, 1, "advanced into the next act");
assert.strictEqual(br.floorIndex, 0);
assert.strictEqual(br.status, "choosing");
assert.deepStrictEqual(br.nodeChoices, Content.ACTS[1].floors[0].options, "onto Act 2's first floor");

// Skipping the boss reward still heals and advances, just without a card.
const brSkip = Engine.createGameState(Content, rng);
Engine.chooseClass(brSkip, Content, "riddle", rng);
brSkip.status = "boss-reward";
brSkip.actIndex = 0;
brSkip.player.hp = 3;
brSkip.bossRewardOptions = ["maul"];
const skipDeck = brSkip.deck.length;
Engine.chooseBossReward(brSkip, Content, null, rng);
assert.strictEqual(brSkip.deck.length, skipDeck, "skipping adds no card");
assert.strictEqual(brSkip.player.hp, brSkip.player.maxHp, "skipping still heals to full");
assert.strictEqual(brSkip.actIndex, 1);

// ---------------------------------------------------------------------
// Full-run smoke test per class: a cautious player (rest when hurt, never
// elite, bank the first reward, take the first boss reward) should be able
// to clear all three acts with each of the three classes. Balance/regression
// backstop for content.js.
// ---------------------------------------------------------------------
for (const id of Object.keys(Content.CLASSES)) {
  const run = Engine.createGameState(Content, rng);
  Engine.chooseClass(run, Content, id, rng);
  let steps = 0;
  while (run.status !== "victory" && run.status !== "lost") {
    if (++steps > 4000) throw new Error(`run (${id}) did not converge`);
    if (run.status === "choosing") {
      const hurt = run.player.hp < run.player.maxHp * 0.7;
      const restIdx = run.nodeChoices.findIndex((o) => o.type === "rest");
      const fightIdx = run.nodeChoices.findIndex((o) => o.type === "fight");
      Engine.chooseNode(run, Content, hurt && restIdx !== -1 ? restIdx : fightIdx, rng);
    } else if (run.status === "reward") {
      Engine.pickReward(run, Content, run.rewardOptions[0], rng);
    } else if (run.status === "boss-reward") {
      Engine.chooseBossReward(run, Content, run.bossRewardOptions[0], rng);
    } else if (run.status === "playing") {
      playOutCombat(run, Content);
    }
  }
  assert.strictEqual(run.status, "victory", `${id} should be able to clear all three acts`);
}

console.log("All golden-path assertions passed.");
