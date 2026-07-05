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
  digIn: { id: "digIn", name: "Dig In", cost: 0, damage: 3, text: "Deal 3 damage." },
  riptide: { id: "riptide", name: "Riptide", cost: 1, damage: 5, block: 5, text: "Deal 5 damage. Gain 5 Block." },
  rally: { id: "rally", name: "Rally", cost: 0, block: 3, draw: 1, text: "Gain 3 Block. Draw a card." },
  lockJaw: { id: "lockJaw", name: "Lock Jaw", cost: 1, damage: 9, text: "Deal 9 damage." },
  // More class-signature cards, so each dog's deck is its own thing:
  scurry: { id: "scurry", name: "Scurry", cost: 0, damage: 2, draw: 1, text: "Deal 2 damage. Draw a card." }, // Riddle
  brace: { id: "brace", name: "Brace", cost: 1, block: 8, text: "Gain 8 Block." }, // Koozie
  counterSurge: { id: "counterSurge", name: "Counter-Surge", cost: 1, damage: 6, block: 3, text: "Deal 6 damage. Gain 3 Block." }, // Koozie
  flurry: { id: "flurry", name: "Flurry", cost: 1, damage: 4, draw: 1, text: "Deal 4 damage. Draw a card." }, // Bevy
  chomp: { id: "chomp", name: "Chomp", cost: 1, damage: 7, text: "Deal 7 damage." }, // Lala
  bodySlam: { id: "bodySlam", name: "Body Slam", cost: 2, damage: 12, text: "Deal 12 damage." }, // Lala
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
    blurb: "A relentless digger — fast attacks and card draw. Fragile but hits early and often, if you spend your Energy well.",
    maxHp: 28,
    // Frenzy: she draws an extra card AND runs on 4 Energy, so the extra draw is
    // a real choice — see 6 cards, pick the best 4 to play — instead of a pile
    // of free cards spammed for nothing. Fast and hits hard, but paper-thin.
    mechanic: { drawBonus: 1, energyBonus: 1, name: "Frenzy", text: "Draw an extra card and gain +1 Energy each turn (4 total)." },
    deck: ["bite", "bite", "bite", "fetch", "fetch", "growl", "pounce", "scurry", "scurry", "digIn", "digIn", "sniffOut"],
  },
  koozie: {
    id: "koozie",
    name: "Koozie",
    breed: "Irish Water Spaniel",
    blurb: "Weathers any storm — heavy Block and counter-punches. Tanky; outlasts the enemy.",
    maxHp: 32,
    // Waterproof: opens every turn already holding Block, so it out-defends anything.
    mechanic: { turnBlock: 3, name: "Waterproof", text: "Start each turn with 3 Block." },
    deck: ["riptide", "riptide", "riptide", "growl", "growl", "growl", "guardDog", "guardDog", "brace", "brace", "counterSurge", "counterSurge"],
  },
  bevy: {
    id: "bevy",
    name: "Bevy",
    breed: "Flat-haired Goldendoodle",
    blurb: "Endlessly adaptable — draws cards and makes energy. Build whatever play the turn needs.",
    maxHp: 28,
    // Boundless: an extra Energy every turn, so it can chain its cheap draw cards.
    mechanic: { energyBonus: 1, name: "Boundless", text: "+1 Energy every turn (4 total)." },
    deck: ["rally", "rally", "rally", "fetch", "fetch", "fetch", "flurry", "flurry", "sniffOut", "sniffOut", "bite", "bite"],
  },
  lala: {
    id: "lala",
    name: "Lala",
    breed: "Pit Bull / German Shepherd",
    blurb: "Loyal powerhouse — hits like a truck and guards her own. Sturdy and forgiving; her Lock Jaw never lets go.",
    maxHp: 36,
    // Lock Jaw: raw Strength — every attack she plays hits for extra.
    mechanic: { strength: 3, name: "Lock Jaw", text: "+3 damage on every attack." },
    deck: ["lockJaw", "lockJaw", "lockJaw", "chomp", "chomp", "bodySlam", "bodySlam", "growl", "growl", "guardDog", "guardDog", "scurry"],
  },
};

// Fallback starter deck (used only if a run somehow has no class picked).
const STARTER_DECK = CLASSES.bevy.deck.slice();

// Cards you can be offered from the very first run.
const BASE_REWARD_POOL = [
  "bite", "growl", "fetch", "pounce", "guardDog", "goodBoy", "sniffOut",
  "digIn", "riptide", "rally", "lockJaw",
  "scurry", "brace", "counterSurge", "flurry", "chomp", "bodySlam",
];

// Fancier cards that UNLOCK into the reward pool as you get deeper across
// runs (gated by the furthest act you've ever reached). `act` is the
// 1-based act you must have reached before these show up.
const REWARD_UNLOCKS = [
  { act: 2, cards: ["howl", "bigBark"] }, // reach the Rooftops → AoE cards
  { act: 3, cards: ["alphaStrike", "secondWind"] }, // reach the Cathouse → heavy hitters
];

// The full pool (base + every unlockable), used as the ceiling / fallback.
// The app narrows the live REWARD_POOL down to what's actually unlocked.
const REWARD_POOL = BASE_REWARD_POOL.concat(...REWARD_UNLOCKS.map((u) => u.cards));

// The elite cards, only offered after downing an act's boss — a run-defining
// pick you can't get anywhere else.
const BOSS_REWARD_POOL = ["maul", "warCry", "bulwark", "huntersMark", "reserves"];

// Treasure nodes (found instead of a rest on some floors) hand you a pick
// from a stash of strong cards — better than a normal fight reward.
const TREASURE_POOL = ["maul", "warCry", "bulwark", "huntersMark", "reserves", "alphaStrike", "bigBark"];

// Regenerate a card's text from its effect fields, so upgraded cards read
// correctly instead of keeping the base card's numbers.
function cardTextOf(c) {
  const parts = [];
  if (c.damage) parts.push(`Deal ${c.damage}${c.aoe ? " to ALL enemies" : ""}.`);
  if (c.block) parts.push(`Gain ${c.block} Block.`);
  if (c.energy) parts.push(`Gain ${c.energy} Energy.`);
  if (c.draw) parts.push(`Draw ${c.draw} card${c.draw > 1 ? "s" : ""}.`);
  return parts.join(" ");
}

// Card upgrades: at a rest site you can sharpen a card into its "+" version
// (bigger numbers). Generated programmatically so every runnable card has an
// upgrade without hand-writing each one. UPGRADES maps base id -> upgraded id.
const UPGRADABLE = [
  "bite", "growl", "fetch", "pounce", "guardDog", "goodBoy", "howl", "bigBark",
  "alphaStrike", "sniffOut", "secondWind", "digIn", "riptide", "rally", "lockJaw",
  "scurry", "brace", "counterSurge", "flurry", "chomp", "bodySlam",
];
const UPGRADES = {};
for (const id of UPGRADABLE) {
  const base = CARDS[id];
  const up = Object.assign({}, base, { id: id + "Plus", name: base.name + "+", upgraded: true });
  if (base.damage) up.damage = base.damage + 2;
  if (base.block) up.block = base.block + 2;
  if (base.energy) up.energy = base.energy + 1;
  if (base.draw && !base.damage && !base.block) up.draw = base.draw + 1; // pure draw cards draw more
  up.text = cardTextOf(up) || base.text;
  CARDS[up.id] = up;
  UPGRADES[id] = up.id;
}

// Cats fight through a fixed, repeating intent pattern — telegraphed one
// turn ahead so a loss always traces back to a choice, never a surprise.
// `attack` damages the dog (after the dog's Block absorbs it); `guard` sets
// the cat's own Block (absorbing the dog's next hits) until its next turn.
const ENEMY_TYPES = {
  alleyCat: {
    id: "alleyCat",
    name: "Alley Cat",
    maxHp: 16,
    pattern: [
      { type: "attack", damage: 9 },
      { type: "attack", damage: 9 },
      { type: "guard", block: 6 },
    ],
  },
  tabbyGuard: {
    id: "tabbyGuard",
    name: "Tabby Guard",
    maxHp: 30,
    pattern: [
      { type: "guard", block: 14 },
      { type: "attack", damage: 13 },
      { type: "attack", damage: 13 },
    ],
  },
  bigTom: {
    id: "bigTom",
    name: "Big Tom",
    maxHp: 58,
    pattern: [
      { type: "attack", damage: 13 },
      { type: "guard", block: 14 },
      { type: "attack", damage: 14 },
      { type: "attack", damage: 21 },
    ],
  },
  // A small, relentless swarm unit — low HP, never guards, comes in numbers.
  feralKitten: {
    id: "feralKitten",
    name: "Feral Kitten",
    maxHp: 7,
    pattern: [
      { type: "attack", damage: 5 },
      { type: "attack", damage: 5 },
      { type: "attack", damage: 7 },
    ],
  },
  // A glass-cannon sniper — winds up behind cover, then a big telegraphed
  // shot. Kill it or block the wind-up.
  rooftopSniper: {
    id: "rooftopSniper",
    name: "Rooftop Sniper",
    maxHp: 18,
    pattern: [
      { type: "guard", block: 5 },
      { type: "attack", damage: 18 },
    ],
  },
  // Act 2 boss — a heavy officer cat: hits hard, guards, then a crushing blow.
  warcatCaptain: {
    id: "warcatCaptain",
    name: "Warcat Captain",
    maxHp: 76,
    pattern: [
      { type: "attack", damage: 17 },
      { type: "guard", block: 16 },
      { type: "attack", damage: 20 },
      { type: "attack", damage: 26 },
    ],
  },
  // Act 3 boss — the tyrant king: relentless, escalating, ends in a haymaker.
  catKing: {
    id: "catKing",
    name: "The Cat King",
    maxHp: 94,
    pattern: [
      { type: "attack", damage: 16 },
      { type: "guard", block: 14 },
      { type: "attack", damage: 22 },
      { type: "guard", block: 12 },
      { type: "attack", damage: 29 },
    ],
  },
};

// The dungeon: three ACTS, each a difficulty TEMPLATE rather than a fixed
// map. At the start of a run the engine (generateMap) rolls each act's floors
// from these pools, so the route — which enemies show up, and whether a floor
// offers an elite, a rest, or a treasure — differs every run. Each act still
// ends with its own fixed, escalating boss. `fightPool`/`elitePool` are the
// enemy line-ups that can appear; the first entry of each is the gentlest
// (used as the deterministic pick under a fixed test rng).
const ACTS = [
  {
    name: "The Back Alleys",
    floorCount: 2,
    boss: { label: "Big Tom", enemies: ["bigTom"] },
    fightPool: [
      ["alleyCat"],
      ["alleyCat", "alleyCat"],
      ["tabbyGuard"],
      ["feralKitten", "feralKitten", "feralKitten"],
      ["alleyCat", "feralKitten"],
    ],
    elitePool: [
      ["tabbyGuard", "alleyCat"],
      ["tabbyGuard", "feralKitten", "feralKitten"],
    ],
  },
  {
    name: "The Rooftops",
    floorCount: 2,
    boss: { label: "The Warcat Captain", enemies: ["warcatCaptain"] },
    fightPool: [
      ["alleyCat", "rooftopSniper"],
      ["tabbyGuard", "feralKitten"],
      ["rooftopSniper", "alleyCat"],
      ["tabbyGuard", "tabbyGuard"],
      ["rooftopSniper", "feralKitten", "feralKitten"],
    ],
    elitePool: [
      ["rooftopSniper", "tabbyGuard"],
      ["tabbyGuard", "tabbyGuard", "feralKitten"],
    ],
  },
  {
    name: "The Cathouse",
    floorCount: 2,
    boss: { label: "The Cat King", enemies: ["catKing"] },
    fightPool: [
      ["tabbyGuard", "alleyCat", "rooftopSniper"],
      ["bigTom"],
      ["feralKitten", "feralKitten", "rooftopSniper"],
      ["tabbyGuard", "rooftopSniper"],
      ["tabbyGuard", "tabbyGuard"],
    ],
    elitePool: [
      ["tabbyGuard", "tabbyGuard", "rooftopSniper"],
      ["bigTom", "feralKitten", "feralKitten"],
    ],
  },
];

// Flavor names drawn at random for each generated node.
const NODE_LABELS = {
  fight: ["Back Alley", "Storm Drain", "Gutter Run", "Fire Escape", "Junkyard", "Dark Stairwell", "Scrap Heap", "Narrow Ledge", "Litter", "Courtyard"],
  elite: ["Guard Post", "Loading Dock", "Ambush", "Royal Guard", "The Gauntlet"],
  rest: ["Cardboard Box", "Sunny Spot", "Water Bowl", "Old Blanket", "Velvet Cushion", "Warm Vent"],
  treasure: ["Dumpster Score", "Stashed Crate", "Hidden Cache", "Royal Hoard", "Lost Satchel"],
};

const STARTING_HP = 28;
const STARTING_ENERGY = 3;
const HAND_SIZE = 5;
const REST_HEAL_FRACTION = 0.3; // of missing HP, rounded up
const FIGHT_REWARD_COUNT = 3;
const ELITE_REWARD_COUNT = 4;
const BOSS_REWARD_COUNT = 3; // boss-reward cards offered to pick from
const TREASURE_REWARD_COUNT = 3; // strong cards offered at a treasure node
const BOSS_MAX_HULL_BONUS = 8; // permanent +maxHull granted on a boss kill

const CONTENT = {
  CARDS,
  CLASSES,
  STARTER_DECK,
  REWARD_POOL,
  BASE_REWARD_POOL,
  REWARD_UNLOCKS,
  BOSS_REWARD_POOL,
  TREASURE_POOL,
  UPGRADES,
  ENEMY_TYPES,
  ACTS,
  NODE_LABELS,
  STARTING_HP,
  STARTING_ENERGY,
  HAND_SIZE,
  REST_HEAL_FRACTION,
  FIGHT_REWARD_COUNT,
  ELITE_REWARD_COUNT,
  BOSS_REWARD_COUNT,
  TREASURE_REWARD_COUNT,
  BOSS_MAX_HULL_BONUS,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = CONTENT;
}
if (typeof window !== "undefined") {
  window.TreeboarContent = CONTENT;
}
