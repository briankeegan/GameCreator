// engine.js — pure rules for TREEBOAR's dog-vs-cats deck-builder combat.
// Knows nothing about cards/cats/rooms as concepts beyond the shape handed
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
    emoji: type.emoji,
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

function startRoom(state, content, rng = Math.random) {
  const room = content.ROOMS[state.roomIndex];
  if (!room) throw new Error(`No room at index ${state.roomIndex}`);
  state.drawPile = shuffle(content.STARTER_DECK, rng);
  state.discardPile = [];
  state.hand = [];
  state.player.block = 0;
  state.player.energy = state.player.maxEnergy;
  state.enemies = room.enemies.map((typeId, i) => makeEnemyInstance(typeId, i, content));
  state.turnCount = 1;
  state.log = [`Room ${state.roomIndex + 1}: ${room.name}`];
  drawCards(state, content, rng, content.HAND_SIZE);
}

function createGameState(content, rng = Math.random) {
  const state = {
    status: "playing",
    roomIndex: 0,
    turnCount: 1,
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
    log: [],
  };
  startRoom(state, content, rng);
  return state;
}

function cardNeedsTarget(card) {
  return Boolean(card.damage);
}

function playCard(state, content, handIndex, targetId, rng = Math.random) {
  if (state.status !== "playing") throw new Error(`Cannot play a card while status is ${state.status}`);
  const cardId = state.hand[handIndex];
  if (cardId === undefined) throw new Error(`No card at hand index ${handIndex}`);
  const card = content.CARDS[cardId];
  if (state.player.energy < card.cost) throw new Error(`Not enough energy for ${card.name}`);

  let target = null;
  if (card.damage) {
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
    applyDamage(target, card.damage);
    state.log.push(`Dog plays ${card.name} on ${target.name} for ${card.damage}.`);
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
    state.status = "room-clear";
  }
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

function advanceRoom(state, content, rng = Math.random) {
  if (state.status !== "room-clear") throw new Error(`Cannot advance room while status is ${state.status}`);
  state.roomIndex += 1;
  if (state.roomIndex >= content.ROOMS.length) {
    state.status = "victory";
    return;
  }
  state.status = "playing";
  startRoom(state, content, rng);
}

function describeIntent(intent) {
  if (intent.type === "attack") return `Attack ${intent.damage}`;
  if (intent.type === "guard") return `Guard ${intent.block}`;
  return "Unknown";
}

const Engine = {
  createGameState,
  playCard,
  endPlayerTurn,
  advanceRoom,
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
