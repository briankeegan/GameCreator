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

function pickFrom(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// Roll one floor's worth of node choices from an act template. Always at
// least one fight so the run can always progress; the last floor before a
// boss always also offers a rest (a breather to heal/sharpen first). The
// remaining slots are weighted heavily toward fights and elites — a rest
// shows up sometimes, and a treasure stash is deliberately RARE (a real find,
// not a floor-by-floor handout). At most one rest and one treasure per floor.
function generateFloorOptions(act, guaranteeRest, content, rng) {
  const options = [makeNode("fight", act, content, rng)];
  if (guaranteeRest) options.push(makeNode("rest", act, content, rng));
  const bag = ["fight", "fight", "fight", "fight", "elite", "elite", "elite", "rest", "rest", "treasure"];
  const used = new Set(options.map((o) => o.type));
  let guard = 0;
  while (options.length < 3 && guard++ < 60) {
    const t = pickFrom(bag, rng);
    if ((t === "rest" || t === "treasure") && used.has(t)) continue; // one rest, one treasure max
    used.add(t);
    options.push(makeNode(t, act, content, rng));
  }
  return options;
}

function makeNode(type, act, content, rng) {
  const label = pickFrom(content.NODE_LABELS[type], rng);
  if (type === "fight") return { type, label, enemies: pickFrom(act.fightPool, rng) };
  if (type === "elite") return { type, label, enemies: pickFrom(act.elitePool, rng) };
  return { type, label };
}

// Build a whole run's map from the act templates. Each act keeps its fixed
// boss but rolls fresh floors, so the route differs every run.
function generateMap(content, rng) {
  return content.ACTS.map((act) => {
    // The floor before the boss always offers a rest; longer acts (3+ floors)
    // also guarantee a rest option at the midpoint so the extra attrition on
    // the way to the boss is survivable, not a pure grind.
    const lastFloor = act.floorCount - 1;
    const midRestFloor = act.floorCount >= 3 ? Math.floor(lastFloor / 2) : -1;
    return {
      name: act.name,
      boss: act.boss,
      floors: Array.from({ length: act.floorCount }, (_, fi) => ({
        options: generateFloorOptions(act, fi === lastFloor || fi === midRestFloor, content, rng),
      })),
    };
  });
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

// The chosen class's passive (drawBonus / turnBlock / energyBonus / strength),
// or an empty object before a class is picked.
function classMechanic(state, content) {
  const cls = content.CLASSES[state.classId];
  return (cls && cls.mechanic) || {};
}

// Applied at the top of every combat turn (the first turn in startCombat and
// each later turn in endPlayerTurn): the class's per-turn passives.
function applyTurnStartMechanic(state, content, rng) {
  const mech = classMechanic(state, content);
  if (mech.turnBlock) state.player.block += mech.turnBlock;
  if (mech.drawBonus) drawCards(state, content, rng, mech.drawBonus);
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
  applyTurnStartMechanic(state, content, rng);
}

function advanceFloorOrBoss(state, content, rng = Math.random) {
  state.floorIndex += 1;
  state.rewardOptions = [];
  const act = state.map[state.actIndex];
  if (state.floorIndex >= act.floors.length) {
    state.currentNodeType = "boss";
    startCombat(state, content, act.boss.enemies, rng);
  } else {
    state.status = "choosing";
    state.nodeChoices = act.floors[state.floorIndex].options;
  }
}

function createGameState(content, rng = Math.random) {
  // A run opens on class selection — the deck and Hull aren't set until the
  // player picks a dog class (see chooseClass).
  const state = {
    status: "class-select",
    classId: null,
    actIndex: 0,
    floorIndex: 0,
    turnCount: 1,
    currentNodeType: null,
    deck: [],
    map: [],
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
    bossRewardOptions: [],
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
  // Boundless-style classes carry extra Energy for the whole run.
  const energyBonus = (cls.mechanic && cls.mechanic.energyBonus) || 0;
  state.player.maxEnergy = content.STARTING_ENERGY + energyBonus;
  state.player.energy = state.player.maxEnergy;
  state.actIndex = 0;
  state.floorIndex = 0;
  state.map = generateMap(content, rng); // a fresh, randomized route every run
  state.status = "choosing";
  state.nodeChoices = state.map[0].floors[0].options;
  state.log = [`${cls.name} the ${cls.breed} sets out.`];
}

function chooseNode(state, content, optionIndex, rng = Math.random) {
  if (state.status !== "choosing") throw new Error(`Cannot choose a node while status is ${state.status}`);
  const option = state.nodeChoices[optionIndex];
  if (!option) throw new Error(`No node option at index ${optionIndex}`);

  if (option.type === "rest") {
    // A rest site is now a choice: heal, sharpen a card, or ditch dead weight.
    state.currentNodeType = "rest";
    state.status = "rest-site";
    state.log = ["A safe spot. Rest up, sharpen a card, or drop dead weight."];
  } else if (option.type === "treasure") {
    // A stash — a free pick from the strong treasure pool, no fight.
    state.currentNodeType = "treasure";
    state.status = "reward";
    state.rewardOptions = shuffle(content.TREASURE_POOL, rng).slice(0, content.TREASURE_REWARD_COUNT);
    state.log = ["You found a stash of gear!"];
  } else {
    state.currentNodeType = option.type; // "fight" | "elite"
    startCombat(state, content, option.enemies, rng);
  }
}

// Rest-site actions: "heal" (recover Hull), "remove" (delete deck[index]), or
// "upgrade" (swap deck[index] for its + version). Any of them ends the visit.
function restSite(state, content, action, deckIndex, rng = Math.random) {
  if (state.status !== "rest-site") throw new Error(`Cannot use a rest site while status is ${state.status}`);
  if (action === "heal") {
    const healAmount = Math.ceil((state.player.maxHp - state.player.hp) * content.REST_HEAL_FRACTION);
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + healAmount);
    state.log = [`Rested and healed ${healAmount}.`];
  } else if (action === "remove") {
    if (deckIndex == null || deckIndex < 0 || deckIndex >= state.deck.length) throw new Error("No such card to remove");
    const removed = state.deck.splice(deckIndex, 1)[0];
    state.log = [`Dropped ${content.CARDS[removed].name} from the deck.`];
  } else if (action === "upgrade") {
    if (deckIndex == null || deckIndex < 0 || deckIndex >= state.deck.length) throw new Error("No such card to upgrade");
    const id = state.deck[deckIndex];
    const up = content.UPGRADES[id];
    if (!up) throw new Error(`${id} cannot be upgraded`);
    state.deck[deckIndex] = up;
    state.log = [`Sharpened ${content.CARDS[id].name} into ${content.CARDS[up].name}.`];
  } else {
    throw new Error(`Unknown rest-site action: ${action}`);
  }
  advanceFloorOrBoss(state, content, rng);
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
    // Strength-style mechanics add flat damage to every attack.
    const dmg = card.damage + (classMechanic(state, content).strength || 0);
    if (card.aoe) {
      for (const enemy of livingEnemies(state)) applyDamage(enemy, dmg);
      state.log.push(`Dog plays ${card.name}, hitting every cat for ${dmg}.`);
    } else {
      applyDamage(target, dmg);
      state.log.push(`Dog plays ${card.name} on ${target.name} for ${dmg}.`);
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
      if (state.actIndex >= content.ACTS.length - 1) {
        // Felled the final act's boss — the run is won.
        state.status = "victory";
      } else {
        // An act boss down: offer the elite boss-reward pick before the
        // next act. chooseBossReward heals up and advances the act.
        state.status = "boss-reward";
        state.bossRewardOptions = shuffle(content.BOSS_REWARD_POOL, rng).slice(0, content.BOSS_REWARD_COUNT);
      }
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

function chooseBossReward(state, content, cardId, rng = Math.random) {
  if (state.status !== "boss-reward") throw new Error(`Cannot pick a boss reward while status is ${state.status}`);
  if (cardId) {
    if (!state.bossRewardOptions.includes(cardId)) throw new Error(`${cardId} was not offered`);
    state.deck.push(cardId);
  }
  // A boss kill permanently raises max Hull and heals to full before the
  // harder act ahead — the reward for surviving.
  state.player.maxHp += content.BOSS_MAX_HULL_BONUS;
  state.player.hp = state.player.maxHp;
  state.bossRewardOptions = [];
  state.actIndex += 1;
  state.floorIndex = 0;
  state.status = "choosing";
  state.currentNodeType = null;
  state.floorIndex = 0;
  state.nodeChoices = state.map[state.actIndex].floors[0].options;
  const gained = cardId ? `Took ${content.CARDS[cardId].name}. ` : "";
  state.log = [`${gained}+${content.BOSS_MAX_HULL_BONUS} max Hull, fully healed. ${state.map[state.actIndex].name} awaits.`];
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
  applyTurnStartMechanic(state, content, rng);
}

function describeIntent(intent) {
  if (intent.type === "attack") return `Attack ${intent.damage}`;
  if (intent.type === "guard") return `Guard ${intent.block}`;
  return "Unknown";
}

const Engine = {
  createGameState,
  generateMap,
  chooseClass,
  chooseNode,
  restSite,
  playCard,
  endPlayerTurn,
  pickReward,
  chooseBossReward,
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
