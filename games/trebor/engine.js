// engine.js — pure rules for TREEBOAR's dog-vs-cats deck-builder combat and
// its Slay the Spire-style run structure: pick a node each floor (fight,
// elite, or rest), fight it out, bank a card reward, repeat, then the boss.
// Knows nothing about cards/cats/floors as concepts beyond the shape handed
// to it via content.js; content.js is the only place that data lives.
// Shared between Node tests (`require("./engine.js")`) and the browser
// (`window.TreeboarEngine`), same pattern as Hypergolic Hull's engine.js.

"use strict";

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeEnemyInstance(typeId, idx, content) {
  const type = content.ENEMY_TYPES[typeId];
  if (!type) throw new Error(`Unknown enemy type: ${typeId}`);
  const pattern = type.pattern;
  return {
    id: `${typeId}-${idx}`,
    typeId,
    name: type.name,
    maxHp: type.maxHp,
    hp: type.maxHp,
    block: 0,
    patternIndex: 0,
    currentIntent: pattern[0],
    nextIntent: pattern[1 % pattern.length],
  };
}

function livingEnemies(state) {
  return state.enemies.filter((e) => e.hp > 0);
}

function applyDamage(target, amount) {
  const absorbed = Math.min(target.block, amount);
  target.block -= absorbed;
  const overflow = amount - absorbed;
  target.hp = Math.max(0, target.hp - overflow);
}

function drawCards(state, content, rng, n) {
  for (let i = 0; i < n; i++) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length === 0) return; // deck and discard both empty
      state.drawPile = shuffle(state.discardPile, rng);
      state.discardPile = [];
      state.log.push("Discard pile reshuffled into the draw pile.");
    }
    state.hand.push(state.drawPile.pop());
  }
}

function startCombat(state, content, enemyTypeIds, rng = Math.random) {
  state.status = "playing";
  state.drawPile = shuffle(state.deck, rng);
  state.discardPile = [];
  state.hand = [];
  state.player.block = 0;
  state.player.energy = state.player.maxEnergy;
  state.enemies = enemyTypeIds.map((typeId, i) => makeEnemyInstance(typeId, i, content));
  state.turnCount = 1;
  state.log = [];
  drawCards(state, content, rng, content.HAND_SIZE);
}

function advanceFloorOrBoss(state, content, rng = Math.random) {
  state.floorIndex += 1;
  state.rewardOptions = [];
  if (state.floorIndex >= content.FLOORS.length) {
    state.currentNodeType = "boss";
    startCombat(state, content, content.BOSS.enemies, rng);
  } else {
    state.status = "choosing";
    state.nodeChoices = content.FLOORS[state.floorIndex].options;
  }
}

function createGameState(content, rng = Math.random) {
  // A run opens on class selection — the deck and Hull aren't set until the
  // player picks a dog class (see chooseClass).
  const state = {
    status: "class-select",
    classId: null,
    floorIndex: 0,
    turnCount: 1,
    currentNodeType: null,
    deck: [],
    player: {
      hp: content.STARTING_HP,
      maxHp: content.STARTING_HP,
      block: 0,
      energy: content.STARTING_ENERGY,
      maxEnergy: content.STARTING_ENERGY,
    },
    drawPile: [],
    hand: [],
    discardPile: [],
    enemies: [],
    nodeChoices: [],
    rewardOptions: [],
    log: ["Choose your dog."],
  };
  return state;
}

function chooseClass(state, content, classId, rng = Math.random) {
  if (state.status !== "class-select") throw new Error(`Cannot choose a class while status is ${state.status}`);
  const cls = content.CLASSES[classId];
  if (!cls) throw new Error(`Unknown class: ${classId}`);
  state.classId = classId;
  state.deck = cls.deck.slice();
  state.player.maxHp = cls.maxHp;
  state.player.hp = cls.maxHp;
  state.floorIndex = 0;
  state.status = "choosing";
  state.nodeChoices = content.FLOORS[0].options;
  state.log = [`${cls.name} the ${cls.breed} sets out.`];
}

function chooseNode(state, content, optionIndex, rng = Math.random) {
  if (state.status !== "choosing") throw new Error(`Cannot choose a node while status is ${state.status}`);
  const option = state.nodeChoices[optionIndex];
  if (!option) throw new Error(`No node option at index ${optionIndex}`);

  if (option.type === "rest") {
    const healAmount = Math.ceil((state.player.maxHp - state.player.hp) * content.REST_HEAL_FRACTION);
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + healAmount);
    state.log = [`Rested and healed ${healAmount}.`];
    advanceFloorOrBoss(state, content, rng);
  } else {
    state.currentNodeType = option.type; // "fight" | "elite"
    startCombat(state, content, option.enemies, rng);
  }
}

function cardNeedsTarget(card) {
  return Boolean(card.damage) && !card.aoe;
}

function playCard(state, content, handIndex, targetId, rng = Math.random) {
  if (state.status !== "playing") throw new Error(`Cannot play a card while status is ${state.status}`);
  const cardId = state.hand[handIndex];
  if (cardId === undefined) throw new Error(`No card at hand index ${handIndex}`);
  const card = content.CARDS[cardId];
  if (state.player.energy < card.cost) throw new Error(`Not enough energy for ${card.name}`);

  let target = null;
  if (card.damage && !card.aoe) {
    const living = livingEnemies(state);
    if (living.length === 0) throw new Error("No living enemy to target");
    if (!targetId) {
      if (living.length > 1) throw new Error("Must specify a target when more than one enemy is alive");
      target = living[0];
    } else {
      target = state.enemies.find((e) => e.id === targetId && e.hp > 0);
      if (!target) throw new Error(`Invalid target: ${targetId}`);
    }
  }

  state.player.energy -= card.cost;
  state.hand.splice(handIndex, 1);
  state.discardPile.push(cardId);

  if (card.damage) {
    if (card.aoe) {
      for (const enemy of livingEnemies(state)) applyDamage(enemy, card.damage);
      state.log.push(`Dog plays ${card.name}, hitting every cat for ${card.damage}.`);
    } else {
      applyDamage(target, card.damage);
      state.log.push(`Dog plays ${card.name} on ${target.name} for ${card.damage}.`);
    }
  }
  if (card.block) {
    state.player.block += card.block;
    state.log.push(`Dog plays ${card.name}, +${card.block} Block.`);
  }
  if (card.energy) {
    state.player.energy += card.energy;
  }
  if (card.draw) {
    drawCards(state, content, rng, card.draw);
  }

  if (livingEnemies(state).length === 0) {
    if (state.currentNodeType === "boss") {
      state.status = "victory";
    } else {
      state.status = "reward";
      const count = state.currentNodeType === "elite" ? content.ELITE_REWARD_COUNT : content.FIGHT_REWARD_COUNT;
      state.rewardOptions = shuffle(content.REWARD_POOL, rng).slice(0, count);
    }
  }
}

function pickReward(state, content, cardId, rng = Math.random) {
  if (state.status !== "reward") throw new Error(`Cannot pick a reward while status is ${state.status}`);
  if (cardId) {
    if (!state.rewardOptions.includes(cardId)) throw new Error(`${cardId} was not offered`);
    state.deck.push(cardId);
    state.log = [`Added ${content.CARDS[cardId].name} to the deck.`];
  } else {
    state.log = ["Skipped the reward."];
  }
  advanceFloorOrBoss(state, content, rng);
}

function resolveEnemyIntent(state, enemy) {
  const intent = enemy.currentIntent;
  if (intent.type === "attack") {
    applyDamage(state.player, intent.damage);
    state.log.push(`${enemy.name} attacks for ${intent.damage}.`);
  } else if (intent.type === "guard") {
    enemy.block += intent.block;
    state.log.push(`${enemy.name} guards, +${intent.block} Block.`);
  }
}

function endPlayerTurn(state, content, rng = Math.random) {
  if (state.status !== "playing") throw new Error(`Cannot end turn while status is ${state.status}`);
  state.discardPile.push(...state.hand);
  state.hand = [];

  for (const enemy of livingEnemies(state)) {
    enemy.block = 0;
    resolveEnemyIntent(state, enemy);
    const pattern = content.ENEMY_TYPES[enemy.typeId].pattern;
    enemy.patternIndex = (enemy.patternIndex + 1) % pattern.length;
    enemy.currentIntent = enemy.nextIntent;
    enemy.nextIntent = pattern[(enemy.patternIndex + 1) % pattern.length];
  }

  if (state.player.hp <= 0) {
    state.status = "lost";
    return;
  }

  state.turnCount += 1;
  state.player.block = 0;
  state.player.energy = state.player.maxEnergy;
  drawCards(state, content, rng, content.HAND_SIZE);
}

function describeIntent(intent) {
  if (intent.type === "attack") return `Attack ${intent.damage}`;
  if (intent.type === "guard") return `Guard ${intent.block}`;
  return "Unknown";
}

const Engine = {
  createGameState,
  chooseClass,
  chooseNode,
  playCard,
  endPlayerTurn,
  pickReward,
  livingEnemies,
  cardNeedsTarget,
  describeIntent,
  shuffle,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = Engine;
}
if (typeof window !== "undefined") {
  window.TreeboarEngine = Engine;
}
