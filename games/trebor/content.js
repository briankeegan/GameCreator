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
  // Class signature cards (each dog class opens with copies of its own):
  digIn: { id: "digIn", name: "Dig In", cost: 0, damage: 4, text: "Deal 4 damage." },
  riptide: { id: "riptide", name: "Riptide", cost: 1, damage: 5, block: 5, text: "Deal 5 damage. Gain 5 Block." },
  rally: { id: "rally", name: "Rally", cost: 0, block: 3, draw: 1, text: "Gain 3 Block. Draw a card." },
  lockJaw: { id: "lockJaw", name: "Lock Jaw", cost: 1, damage: 9, text: "Deal 9 damage." },
  // Boss-reward cards — powerful, only offered after felling an act boss:
  maul: { id: "maul", name: "Maul", cost: 2, damage: 18, text: "Deal 18 damage." },
  warCry: { id: "warCry", name: "War Cry", cost: 2, damage: 10, aoe: true, block: 6, text: "Deal 10 to ALL enemies. Gain 6 Block." },
  bulwark: { id: "bulwark", name: "Bulwark", cost: 1, block: 14, text: "Gain 14 Block." },
  huntersMark: { id: "huntersMark", name: "Hunter's Mark", cost: 0, damage: 8, text: "Deal 8 damage." },
  reserves: { id: "reserves", name: "Reserves", cost: 0, draw: 2, energy: 1, text: "Draw 2 cards. Gain 1 Energy." },
};

// The three playable dog classes — Slay the Spire-style, each with its own
// starting deck and Hull (HP) so it plays distinctly. `deck` is a flat list
// of card ids (duplicates allowed). Chosen once at the start of a run.
const CLASSES = {
  riddle: {
    id: "riddle",
    name: "Riddle",
    breed: "Wire Fox Terrier",
    blurb: "A relentless digger — cheap, fast attacks and card draw. Fragile but hits early and often.",
    maxHp: 24,
    deck: ["bite", "bite", "bite", "digIn", "digIn", "fetch", "fetch", "growl", "growl", "pounce", "goodBoy", "sniffOut"],
  },
  koozie: {
    id: "koozie",
    name: "Koozie",
    breed: "Irish Water Spaniel",
    blurb: "Weathers any storm — heavy Block and counter-punches. Tanky; outlasts the enemy.",
    maxHp: 32,
    deck: ["bite", "bite", "bite", "growl", "growl", "growl", "riptide", "riptide", "guardDog", "secondWind", "goodBoy", "fetch"],
  },
  bevy: {
    id: "bevy",
    name: "Bevy",
    breed: "Flat-haired Goldendoodle",
    blurb: "Endlessly adaptable — draws cards and makes energy. Build whatever play the turn needs.",
    maxHp: 28,
    deck: ["bite", "bite", "bite", "growl", "growl", "fetch", "fetch", "rally", "rally", "goodBoy", "sniffOut", "pounce"],
  },
  lala: {
    id: "lala",
    name: "Lala",
    breed: "Pit Bull / German Shepherd",
    blurb: "Loyal powerhouse — hits like a truck and guards her own. Sturdy and forgiving; her Lock Jaw never lets go.",
    maxHp: 32,
    deck: ["bite", "bite", "bite", "lockJaw", "lockJaw", "growl", "growl", "guardDog", "pounce", "fetch", "goodBoy", "secondWind"],
  },
};

// Fallback starter deck (used only if a run somehow has no class picked).
const STARTER_DECK = CLASSES.bevy.deck.slice();

// Cards offered as post-combat rewards — every card is fair game, including
// the class signature cards and extra copies of starters.
const REWARD_POOL = [
  "bite", "growl", "fetch", "pounce", "guardDog", "goodBoy",
  "howl", "bigBark", "alphaStrike", "sniffOut", "secondWind",
  "digIn", "riptide", "rally", "lockJaw",
];

// The elite cards, only offered after downing an act's boss — a run-defining
// pick you can't get anywhere else.
const BOSS_REWARD_POOL = ["maul", "warCry", "bulwark", "huntersMark", "reserves"];

// Cats fight through a fixed, repeating intent pattern — telegraphed one
// turn ahead so a loss always traces back to a choice, never a surprise.
// `attack` damages the dog (after the dog's Block absorbs it); `guard` sets
// the cat's own Block (absorbing the dog's next hits) until its next turn.
const ENEMY_TYPES = {
  alleyCat: {
    id: "alleyCat",
    name: "Alley Cat",
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
    maxHp: 42,
    pattern: [
      { type: "attack", damage: 9 },
      { type: "guard", block: 10 },
      { type: "attack", damage: 9 },
      { type: "attack", damage: 14 },
    ],
  },
  // A small, relentless swarm unit — low HP, never guards, comes in numbers.
  feralKitten: {
    id: "feralKitten",
    name: "Feral Kitten",
    maxHp: 7,
    pattern: [
      { type: "attack", damage: 3 },
      { type: "attack", damage: 3 },
      { type: "attack", damage: 5 },
    ],
  },
  // A glass-cannon sniper — winds up behind cover, then a big telegraphed
  // shot. Kill it or block the wind-up.
  rooftopSniper: {
    id: "rooftopSniper",
    name: "Rooftop Sniper",
    maxHp: 13,
    pattern: [
      { type: "guard", block: 4 },
      { type: "attack", damage: 13 },
    ],
  },
  // Act 2 boss — a heavy officer cat: hits hard, guards, then a crushing blow.
  warcatCaptain: {
    id: "warcatCaptain",
    name: "Warcat Captain",
    maxHp: 58,
    pattern: [
      { type: "attack", damage: 12 },
      { type: "guard", block: 12 },
      { type: "attack", damage: 14 },
      { type: "attack", damage: 18 },
    ],
  },
  // Act 3 boss — the tyrant king: relentless, escalating, ends in a haymaker.
  catKing: {
    id: "catKing",
    name: "The Cat King",
    maxHp: 74,
    pattern: [
      { type: "attack", damage: 12 },
      { type: "guard", block: 10 },
      { type: "attack", damage: 17 },
      { type: "guard", block: 8 },
      { type: "attack", damage: 22 },
    ],
  },
};

// The dungeon map: three ACTS, each a short run of floors capped by its own
// boss. Every floor offers a few node choices — fight, elite (tougher fight,
// bigger card reward), or rest (heal). The player picks one node per floor;
// each act's boss always follows its last floor with no choice involved, and
// is meaningfully harder than the last act's. Downing a non-final boss opens
// a boss-reward pick and heals up before the next act begins.
const ACTS = [
  {
    name: "The Back Alleys",
    floors: [
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
          { type: "fight", label: "Litter", enemies: ["feralKitten", "feralKitten", "feralKitten"] },
          { type: "elite", label: "Guard Post", enemies: ["tabbyGuard", "alleyCat"] },
          { type: "rest", label: "Sunny Spot" },
        ],
      },
    ],
    boss: { label: "Big Tom", enemies: ["bigTom"] },
  },
  {
    name: "The Rooftops",
    floors: [
      {
        options: [
          { type: "fight", label: "Rooftops", enemies: ["alleyCat", "rooftopSniper"] },
          { type: "fight", label: "Gutter Run", enemies: ["tabbyGuard", "feralKitten"] },
          { type: "rest", label: "Water Bowl" },
        ],
      },
      {
        options: [
          { type: "fight", label: "Fire Escape", enemies: ["rooftopSniper", "tabbyGuard"] },
          { type: "elite", label: "Loading Dock", enemies: ["rooftopSniper", "feralKitten", "feralKitten"] },
          { type: "rest", label: "Old Blanket" },
        ],
      },
    ],
    boss: { label: "The Warcat Captain", enemies: ["warcatCaptain"] },
  },
  {
    name: "The Cathouse",
    floors: [
      {
        options: [
          { type: "fight", label: "Grand Foyer", enemies: ["tabbyGuard", "alleyCat", "rooftopSniper"] },
          { type: "fight", label: "The Kennels", enemies: ["bigTom"] },
          { type: "rest", label: "Velvet Cushion" },
        ],
      },
      {
        options: [
          { type: "elite", label: "Royal Guard", enemies: ["tabbyGuard", "tabbyGuard", "rooftopSniper"] },
          { type: "fight", label: "Courtiers", enemies: ["feralKitten", "feralKitten", "rooftopSniper"] },
          { type: "rest", label: "Sunbeam Throne" },
        ],
      },
    ],
    boss: { label: "The Cat King", enemies: ["catKing"] },
  },
];

const STARTING_HP = 28;
const STARTING_ENERGY = 3;
const HAND_SIZE = 5;
const REST_HEAL_FRACTION = 0.3; // of missing HP, rounded up
const FIGHT_REWARD_COUNT = 3;
const ELITE_REWARD_COUNT = 4;
const BOSS_REWARD_COUNT = 3; // boss-reward cards offered to pick from
const BOSS_MAX_HULL_BONUS = 8; // permanent +maxHull granted on a boss kill

const CONTENT = {
  CARDS,
  CLASSES,
  STARTER_DECK,
  REWARD_POOL,
  BOSS_REWARD_POOL,
  ENEMY_TYPES,
  ACTS,
  STARTING_HP,
  STARTING_ENERGY,
  HAND_SIZE,
  REST_HEAL_FRACTION,
  FIGHT_REWARD_COUNT,
  ELITE_REWARD_COUNT,
  BOSS_REWARD_COUNT,
  BOSS_MAX_HULL_BONUS,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = CONTENT;
}
if (typeof window !== "undefined") {
  window.TreeboarContent = CONTENT;
}
