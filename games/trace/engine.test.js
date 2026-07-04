// engine.test.js — headless rules coverage for "Step in the Cat".
// Plain Node, no framework: `node games/trace/engine.test.js`.
"use strict";

const assert = require("assert");
const Engine = require("./engine.js");

// Deterministic rng for reproducible level generation / cat wander.
function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------
// A fresh game starts on level 1, playing, with a sensible board.
// ---------------------------------------------------------------------
const g = Engine.createGame(seeded(1));
assert.strictEqual(g.status, "playing");
assert.strictEqual(g.level, 1);
assert.strictEqual(g.score, 0);
assert.strictEqual(g.W, 5);
assert.strictEqual(g.H, 6, "level 1 is 6 rows tall");
assert.deepStrictEqual(g.player, { r: 5, c: 2 }, "player starts bottom-center");
assert.deepStrictEqual(g.exit, { r: 0, c: 2 }, "exit is top-center");
assert.ok(g.cats.length === 1, "level 1 has a single cat");
assert.ok(g.pins.length >= 4, "level 1 has a handful of pins");
assert.ok(g.pinTarget >= 1 && g.pinTarget <= g.pins.length, "target is collectable");
assert.ok(
  g.cats.every((cat) => Engine.manhattan(cat, g.player) >= 3),
  "no cat opens within pouncing distance of the player"
);
assert.ok(
  g.cats.every((cat) => Engine.inBounds(g, cat.next.r, cat.next.c)),
  "every cat telegraphs an in-bounds next step"
);

// ---------------------------------------------------------------------
// Off-board moves are ignored and never burn a turn.
// ---------------------------------------------------------------------
const noop = Engine.createGame(seeded(2));
const beforeTurn = noop.turn;
const beforePos = { ...noop.player };
Engine.move(noop, "down", seeded(2)); // player is on the bottom row already
assert.strictEqual(noop.turn, beforeTurn, "an illegal move doesn't advance the turn");
assert.deepStrictEqual(noop.player, beforePos, "an illegal move doesn't move the player");

// ---------------------------------------------------------------------
// Stepping onto a cat's cell loses immediately.
// ---------------------------------------------------------------------
const step = Engine.createGame(seeded(3));
// Plant a cat directly above the player and walk up into it.
step.cats = [{ r: step.player.r - 1, c: step.player.c, next: { r: step.player.r - 1, c: step.player.c } }];
Engine.move(step, "up", seeded(3));
assert.strictEqual(step.status, "lost");
assert.match(step.message, /stepped on the cat/i);
// Once lost, further moves are inert.
const lostTurn = step.turn;
Engine.move(step, "left", seeded(3));
assert.strictEqual(step.turn, lostTurn, "no acting after a loss");

// ---------------------------------------------------------------------
// A cat that pounces onto your step also loses (telegraph resolves after
// the player's move).
// ---------------------------------------------------------------------
const pounce = Engine.createGame(seeded(4));
pounce.pins = []; // clear the board so the only event is the cat
// Cat two above the player, telegraphed to step down onto where the player
// will be after moving up.
const px = pounce.player;
pounce.cats = [{ r: px.r - 2, c: px.c, next: { r: px.r - 1, c: px.c } }];
Engine.move(pounce, "up", seeded(4)); // player moves to px.r-1; cat steps to px.r-1
assert.strictEqual(pounce.status, "lost");
assert.match(pounce.message, /pounced/i);

// ---------------------------------------------------------------------
// Pins: walking onto one collects it and scores its value.
// ---------------------------------------------------------------------
const grab = Engine.createGame(seeded(5));
grab.cats = []; // isolate pin logic
const up = { r: grab.player.r - 1, c: grab.player.c };
grab.pins = [{ r: up.r, c: up.c, type: "avocado", value: 3 }];
const scoreBefore = grab.score;
Engine.move(grab, "up", seeded(5));
assert.strictEqual(grab.collected, 1, "the pin was collected");
assert.strictEqual(grab.score, scoreBefore + 3, "its value was scored");
assert.strictEqual(grab.pins.length, 0, "and it left the board");

// ---------------------------------------------------------------------
// Exit gating: the door is locked until the pin target is met, then
// reaching it advances the level (score carries, level resets its count).
// ---------------------------------------------------------------------
const climb = Engine.createGame(seeded(6));
climb.cats = [];
climb.pins = [];
climb.collected = 0;
// Stand on the exit without enough pins — should stay put, still level 1.
climb.player = { r: climb.exit.r + 1, c: climb.exit.c };
climb.pinTarget = 2;
Engine.move(climb, "up", seeded(6)); // onto the exit, but 0/2 pins
assert.strictEqual(climb.level, 1, "locked door does not advance");
assert.match(climb.message, /locked/i);
assert.deepStrictEqual(climb.player, climb.exit, "player is standing on the locked door");

// Now satisfy the target and step onto the door again.
climb.collected = 2;
climb.pinTarget = 2;
climb.player = { r: climb.exit.r + 1, c: climb.exit.c };
const scoreCarried = climb.score;
Engine.move(climb, "up", seeded(6));
assert.strictEqual(climb.level, 2, "meeting the target advances a level");
assert.strictEqual(climb.status, "playing");
assert.strictEqual(climb.collected, 0, "the new level resets the pin count");
assert.strictEqual(climb.score, scoreCarried, "score carries across levels");
assert.strictEqual(climb.H, 7, "level 2 is one row taller");
assert.ok(climb.justAdvanced, "the advance flag is set for the UI");

// ---------------------------------------------------------------------
// Difficulty scales: cat count steps up with the level.
// ---------------------------------------------------------------------
assert.strictEqual(Engine.generateLevel(1, seeded(7)).cats.length, 1);
assert.strictEqual(Engine.generateLevel(3, seeded(7)).cats.length, 2);
assert.strictEqual(Engine.generateLevel(6, seeded(7)).cats.length, 3);

// ---------------------------------------------------------------------
// "wait" is a real, legal action: the player holds, the cats still move.
// ---------------------------------------------------------------------
const hold = Engine.createGame(seeded(8));
hold.pins = [];
const holdPos = { ...hold.player };
const t0 = hold.turn;
Engine.move(hold, "wait", seeded(8));
assert.deepStrictEqual(hold.player, holdPos, "waiting keeps the player in place");
assert.ok(hold.status === "playing", "a safe wait is survivable");
assert.strictEqual(hold.turn, t0 + 1, "but the turn (and the cats) still advanced");

// ---------------------------------------------------------------------
// Fuzz: a legal sequence of moves never throws and never leaves a cat or
// the player off the board.
// ---------------------------------------------------------------------
for (let seed = 0; seed < 60; seed++) {
  const rng = seeded(1000 + seed);
  const s = Engine.createGame(rng);
  const dirs = ["up", "down", "left", "right", "wait"];
  for (let i = 0; i < 200 && s.status === "playing"; i++) {
    Engine.move(s, dirs[Math.floor(rng() * dirs.length)], rng);
    assert.ok(Engine.inBounds(s, s.player.r, s.player.c), "player stays on the board");
    for (const cat of s.cats) assert.ok(Engine.inBounds(s, cat.r, cat.c), "cats stay on the board");
  }
}

console.log("All Step-in-the-Cat engine assertions passed.");
