// content.js — the only place TREEBOAR's card/enemy/dungeon data lives.
// engine.js is pure rules and knows nothing about what a "Bite" or an
// "Alley Cat" is; it just plays whatever CARDS/ENEMY_TYPES/FLOORS say.

"use strict";

// Card effects: `damage` hits a target (every living enemy at once if
// `aoe` is set), `block` shields the dog, `draw` pulls extra cards,
// `energy` refunds energy — a card can combine any of these (see Fetch).
const CARDS = {
  bite: { id: "bite", name: "Bite", cost: 1, damage: 6, text: "Deal 6 damage." },
  growl: { id: "growl", name: "Growl", cost: 1, block: 5, text: "Gain 5 Block." },
  fetch: { id: "fetch", name: "Fetch", cost: 1, damage: 3, draw: 1, text: "Deal 3 damage. Draw a card." },
  pounce: { id: "pounce", name: "Pounce", cost: 2, damage: 10, text: "Deal 10 damage." },
  guardDog: { id: "guardDog", name: "Guard Dog", cost: 2, block: 10, text: "Gain 10 Block." },
  goodBoy: { id: "goodBoy", name: "Good Boy", cost: 0, energy: 1, text: "Gain 1 Energy." },
  howl: { id: "howl", name: "Howl", cost: 1, damage: 4, aoe: true, text: "Deal 4 damage to ALL enemies." },
  bigBark: { id: "bigBark", name: "Big Bark", cost: 2, damage: 8, aoe: true, text: "Deal 8 damage to ALL enemies." },
  alphaStrike: { id: "alphaStrike", name: "Alpha Strike", cost: 2, damage: 14, text: "Deal 14 damage." },
  sniffOut: { id: "sniffOut", name: "Sniff Out", cost: 0, draw: 2, text: "Draw 2 cards." },
  secondWind: { id: "secondWind", name: "Second Wind", cost: 1, block: 8, draw: 1, text: "Gain 8 Block. Draw a card." },
};

// The dog's starting deck — just a flat list of card ids, duplicates allowed.
const STARTER_DECK = [
  "bite", "bite", "bite", "bite",
  "growl", "growl", "growl",
  "fetch", "fetch",
  "pounce",
  "guardDog",
  "goodBoy",
];

// Cards offered as post-combat rewards — every card is fair game, including
// extra copies of starter cards.
const REWARD_POOL = [
  "bite", "growl", "fetch", "pounce", "guardDog", "goodBoy",
  "howl", "bigBark", "alphaStrike", "sniffOut", "secondWind",
];

// Cats fight through a fixed, repeating intent pattern — telegraphed one
// turn ahead so a loss always traces back to a choice, never a surprise.
// `attack` damages the dog (after the dog's Block absorbs it); `guard` sets
// the cat's own Block (absorbing the dog's next hits) until its next turn.
const ENEMY_TYPES = {
  alleyCat: {
    id: "alleyCat",
    name: "Alley Cat",
    emoji: "😾",
    maxHp: 14,
    pattern: [
      { type: "attack", damage: 6 },
      { type: "attack", damage: 6 },
      { type: "guard", block: 6 },
    ],
  },
  tabbyGuard: {
    id: "tabbyGuard",
    name: "Tabby Guard",
    emoji: "🐈",
    maxHp: 20,
    pattern: [
      { type: "guard", block: 10 },
      { type: "attack", damage: 8 },
      { type: "attack", damage: 8 },
    ],
  },
  bigTom: {
    id: "bigTom",
    name: "Big Tom",
    emoji: "🐈‍⬛",
    maxHp: 42,
    pattern: [
      { type: "attack", damage: 9 },
      { type: "guard", block: 10 },
      { type: "attack", damage: 9 },
      { type: "attack", damage: 14 },
    ],
  },
};

// The dungeon map: a fixed sequence of floors, each offering a few node
// choices — fight, elite (tougher fight, bigger card reward), or rest
// (heal). The player picks one node per floor; the boss always follows
// the last floor with no choice involved.
const FLOORS = [
  {
    options: [
      { type: "fight", label: "Back Alley", enemies: ["alleyCat"] },
      { type: "fight", label: "Storm Drain", enemies: ["alleyCat"] },
      { type: "rest", label: "Cardboard Box" },
    ],
  },
  {
    options: [
      { type: "fight", label: "Junkyard", enemies: ["tabbyGuard"] },
      { type: "elite", label: "Guard Post", enemies: ["tabbyGuard", "alleyCat"] },
      { type: "rest", label: "Sunny Spot" },
    ],
  },
  {
    options: [
      { type: "fight", label: "Rooftops", enemies: ["alleyCat", "alleyCat"] },
      { type: "elite", label: "Fire Escape", enemies: ["tabbyGuard", "tabbyGuard"] },
      { type: "rest", label: "Water Bowl" },
    ],
  },
  {
    options: [
      { type: "fight", label: "Back Door", enemies: ["alleyCat", "tabbyGuard"] },
      { type: "elite", label: "Loading Dock", enemies: ["tabbyGuard", "alleyCat", "alleyCat"] },
      { type: "rest", label: "Old Blanket" },
    ],
  },
];

const BOSS = { label: "The Cathouse", enemies: ["bigTom"] };

const STARTING_HP = 28;
const STARTING_ENERGY = 3;
const HAND_SIZE = 5;
const REST_HEAL_FRACTION = 0.3; // of missing HP, rounded up
const FIGHT_REWARD_COUNT = 3;
const ELITE_REWARD_COUNT = 4;

const CONTENT = {
  CARDS,
  STARTER_DECK,
  REWARD_POOL,
  ENEMY_TYPES,
  FLOORS,
  BOSS,
  STARTING_HP,
  STARTING_ENERGY,
  HAND_SIZE,
  REST_HEAL_FRACTION,
  FIGHT_REWARD_COUNT,
  ELITE_REWARD_COUNT,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = CONTENT;
}
if (typeof window !== "undefined") {
  window.TreeboarContent = CONTENT;
}
