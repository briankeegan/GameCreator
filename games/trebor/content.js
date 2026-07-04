// content.js — the only place TREEBOAR's card/enemy/dungeon data lives.
// engine.js is pure rules and knows nothing about what a "Bite" or an
// "Alley Cat" is; it just plays whatever CARDS/ENEMY_TYPES/ROOMS say.

"use strict";

// Card effects: `damage` hits the current target, `block` shields the dog,
// `draw` pulls extra cards, `energy` refunds energy — all optional, a card
// can combine them (see Fetch).
const CARDS = {
  bite: { id: "bite", name: "Bite", cost: 1, damage: 6, text: "Deal 6 damage." },
  growl: { id: "growl", name: "Growl", cost: 1, block: 5, text: "Gain 5 Block." },
  fetch: { id: "fetch", name: "Fetch", cost: 1, damage: 3, draw: 1, text: "Deal 3 damage. Draw a card." },
  pounce: { id: "pounce", name: "Pounce", cost: 2, damage: 10, text: "Deal 10 damage." },
  guardDog: { id: "guardDog", name: "Guard Dog", cost: 2, block: 10, text: "Gain 10 Block." },
  goodBoy: { id: "goodBoy", name: "Good Boy", cost: 0, energy: 1, text: "Gain 1 Energy." },
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

// The dungeon: one room per encounter, cleared in order. The last room is
// the boss; beating it wins the run.
const ROOMS = [
  { id: 1, name: "Back Alley", enemies: ["alleyCat"] },
  { id: 2, name: "Junkyard", enemies: ["tabbyGuard"] },
  { id: 3, name: "Rooftops", enemies: ["alleyCat", "alleyCat"] },
  { id: 4, name: "The Cathouse", enemies: ["bigTom"], boss: true },
];

const STARTING_HP = 25;
const STARTING_ENERGY = 3;
const HAND_SIZE = 5;

const CONTENT = { CARDS, STARTER_DECK, ENEMY_TYPES, ROOMS, STARTING_HP, STARTING_ENERGY, HAND_SIZE };

if (typeof module !== "undefined" && module.exports) {
  module.exports = CONTENT;
}
if (typeof window !== "undefined") {
  window.TreeboarContent = CONTENT;
}
