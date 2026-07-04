// engine.test.js — headless rules coverage for the "Step in the Cat" pin
// draft. Plain Node: `node games/trace/engine.test.js`.
"use strict";

const assert = require("assert");
const Engine = require("./engine.js");

function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---- set scoring is triangular --------------------------------------
assert.strictEqual(Engine.tri(0), 0);
assert.strictEqual(Engine.tri(1), 1);
assert.strictEqual(Engine.tri(2), 3);
assert.strictEqual(Engine.tri(3), 6);
assert.strictEqual(Engine.tri(4), 10);
assert.strictEqual(
  Engine.score({ avocado: 3, star: 2, paw: 0, fish: 0, yarn: 0 }),
  6 + 3,
  "score sums each set's triangular value"
);

// ---- a fresh game deals a full spread and empty collections ----------
const g = Engine.createGame(seeded(1));
assert.strictEqual(g.status, "playing");
assert.strictEqual(g.display.length, Engine.DISPLAY_SIZE, "five pins on show");
assert.strictEqual(
  g.deck.length,
  Engine.PIN_TYPES.length * Engine.COPIES_PER_TYPE - Engine.DISPLAY_SIZE,
  "the rest are in the deck"
);
assert.ok(g.display[0].onCat, "the front pin sits on the cat");
assert.ok(g.display.slice(1).every((p) => !p.onCat), "only the front pin is on the cat");
assert.strictEqual(Engine.score(g.you), 0);
assert.strictEqual(Engine.score(g.cat), 0);

// ---- drafting a plain pin: you gain it, the cat responds, spread refills
const plain = Engine.createGame(seeded(2));
const idx = plain.display.findIndex((p) => !p.onCat); // a non-cat pin
const takenType = plain.display[idx].type;
const deckBefore = plain.deck.length;
Engine.draft(plain, idx, seeded(2));
assert.strictEqual(plain.you[takenType], 1, "you collected the pin you tapped");
const catTotal = Object.values(plain.cat).reduce((a, b) => a + b, 0);
assert.ok(catTotal === 1 || catTotal === 2, "the cat drafted one pin (2 count if it grabbed the double)");
assert.strictEqual(plain.display.length, Engine.DISPLAY_SIZE, "the spread refilled to five");
assert.strictEqual(plain.deck.length, deckBefore - 2, "two pins left the deck (yours + the cat's)");

// ---- the on-cat pin is worth double ---------------------------------
const dbl = Engine.createGame(seeded(3));
const catType = dbl.display[0].type;
// A seed whose first roll doesn't wake the cat, so we can observe the double.
Engine.draft(dbl, 0, () => 0.99);
assert.strictEqual(dbl.you[catType], 2, "the on-cat pin counts as two of its type");
assert.ok(dbl.napChance > 0, "grabbing it raised the wake risk");

// ---- waking the cat ends the game immediately -----------------------
const wake = Engine.createGame(seeded(4));
const wokeType = wake.display[0].type;
Engine.draft(wake, 0, () => 0); // roll 0 < 0.25 → wakes
assert.strictEqual(wake.status, "over");
assert.ok(wake.woke, "the cat woke");
assert.strictEqual(wake.you[wokeType], 2, "you still keep the double pin you grabbed");
assert.match(wake.message, /woke the cat/i);
// No acting after it's over.
const overType = wake.display.length ? wake.display[0].type : null;
Engine.draft(wake, 0, () => 0.99);
assert.strictEqual(wake.status, "over", "the game stays over");
void overType;

// ---- the cat plays to build its own sets ----------------------------
// Give the cat a big head start in one type and confirm it stacks it when
// that pin is on offer.
const ai = Engine.createGame(seeded(5));
ai.cat = { avocado: 3, star: 0, paw: 0, fish: 0, yarn: 0 };
ai.display = [
  { type: "star", onCat: false },
  { type: "avocado", onCat: false },
  { type: "paw", onCat: false },
];
assert.strictEqual(
  ai.display[Engine.catChoose(ai)].type,
  "avocado",
  "the cat extends the set it's already deep in"
);

// ---- a whole game always terminates with a decided result -----------
for (let seed = 0; seed < 80; seed++) {
  const rng = seeded(500 + seed);
  const s = Engine.createGame(rng);
  let guard = 0;
  while (s.status === "playing") {
    if (++guard > 200) throw new Error("draft did not terminate");
    // Play a "sensible" human: take the on-cat double only while the wake
    // risk is low, otherwise grab a plain pin that best extends a set.
    let pick = -1;
    if (s.display[0] && s.display[0].onCat && s.napChance + 0.25 <= 0.5) pick = 0;
    if (pick === -1) {
      let best = -Infinity;
      for (let i = 0; i < s.display.length; i++) {
        const t = s.display[i].type;
        const v = s.you[t];
        if (v > best) {
          best = v;
          pick = i;
        }
      }
    }
    if (pick === -1) break;
    Engine.draft(s, pick, rng);
  }
  assert.strictEqual(s.status, "over", "every game ends");
  assert.ok(["you", "cat", "tie"].includes(s.result), "with a decided result");
  assert.strictEqual(s.youScore, Engine.score(s.you), "final score matches the collection");
}

console.log("All Step-in-the-Cat draft-engine assertions passed.");
