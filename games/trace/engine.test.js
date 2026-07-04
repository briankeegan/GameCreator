// engine.test.js — headless rules coverage for "Step in the Cat" (Trap the
// Cat). Plain Node: `node games/trace/engine.test.js`.
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

// ---- a fresh game: cat dead center, some walls, and room to run --------
const g = Engine.createGame(seeded(1));
assert.strictEqual(g.status, "playing");
assert.deepStrictEqual(g.cat, { r: 4, c: 4 }, "cat starts in the center");
assert.strictEqual(g.pinsUsed, 0);
assert.ok(g.pins.size >= 1, "some starting walls are seeded");
// The cat's own step and its six neighbors are never walled at the start.
assert.ok(!g.pins.has(Engine.keyOf(4, 4)), "the cat's step is open");
for (const n of Engine.neighbors(4, 4)) {
  assert.ok(!g.pins.has(Engine.keyOf(n.r, n.c)), "the ring around the cat starts open");
}

// ---- geometry: edges and neighbour counts ------------------------------
assert.ok(Engine.isEdge(0, 3) && Engine.isEdge(8, 8) && Engine.isEdge(4, 0));
assert.ok(!Engine.isEdge(4, 4));
assert.strictEqual(Engine.neighbors(4, 4).length, 6, "an interior hex has six neighbours");
assert.ok(Engine.neighbors(0, 0).length < 6, "a corner has fewer");

// ---- placing a pin: it sticks, and the cat then takes one step ---------
const play = Engine.createGame(seeded(2));
const before = { ...play.cat };
// Place somewhere that is neither the cat nor an existing pin.
let target = null;
for (let r = 0; r < 9 && !target; r++)
  for (let c = 0; c < 9; c++) {
    const k = Engine.keyOf(r, c);
    if (!play.pins.has(k) && !(play.cat.r === r && play.cat.c === c)) {
      target = { r, c };
      break;
    }
  }
Engine.placePin(play, target.r, target.c, );
assert.ok(play.pins.has(Engine.keyOf(target.r, target.c)), "the pin was placed");
assert.strictEqual(play.pinsUsed, 1, "and counted");
assert.ok(play.cat.r !== before.r || play.cat.c !== before.c, "the cat moved in response");
assert.ok(!Engine.isEdge(before.r, before.c));

// No-ops: placing on the cat, on a pin, or off-board doesn't spend a move.
const noop = Engine.createGame(seeded(3));
const pu = noop.pinsUsed;
Engine.placePin(noop, noop.cat.r, noop.cat.c); // on the cat
Engine.placePin(noop, -1, -1); // off board
const anyPin = noop.pins.values().next().value.split(",").map(Number);
Engine.placePin(noop, anyPin[0], anyPin[1]); // on an existing pin
assert.strictEqual(noop.pinsUsed, pu, "illegal placements are ignored");

// ---- winning: fully enclose the cat ------------------------------------
// Build a state with the cat boxed in except one gap, then plug it.
const win = Engine.createGame(seeded(4));
win.cat = { r: 4, c: 4 };
win.pins = new Set();
const ring = Engine.neighbors(4, 4);
// Wall every neighbour but the last, then confirm we're still playing, and
// plugging the final gap wins (no edge reachable).
for (let i = 0; i < ring.length - 1; i++) win.pins.add(Engine.keyOf(ring[i].r, ring[i].c));
const gap = ring[ring.length - 1];
// Also wall the ring-two cells the cat could reach through the gap so the
// single placement below actually seals it. Simplest: block the gap itself.
const escBefore = Engine.findEscape(win);
assert.ok(escBefore.reachable, "with a gap, the cat can still escape");
Engine.placePin(win, gap.r, gap.c);
assert.strictEqual(win.status, "won", "sealing the last neighbour traps the cat");
assert.match(win.message, /trapped/i);

// ---- losing: the cat reaches an edge -----------------------------------
const lose = Engine.createGame(seeded(5));
lose.pins = new Set();
lose.cat = { r: 1, c: 4 }; // one row from the top edge, open board
Engine.placePin(lose, 8, 8); // a harmless far corner; cat should march to the edge
assert.strictEqual(lose.status, "lost", "an open board lets the cat reach the edge");
assert.match(lose.message, /slipped out/i);

// ---- findEscape: a cat with every route walled is unreachable ----------
const boxed = Engine.createGame(seeded(6));
boxed.cat = { r: 4, c: 4 };
boxed.pins = new Set(Engine.neighbors(4, 4).map((n) => Engine.keyOf(n.r, n.c)));
assert.strictEqual(Engine.findEscape(boxed).reachable, false, "no open neighbour → no escape");

// ---- fuzz: random legal play never throws and always terminates --------
for (let seed = 0; seed < 60; seed++) {
  const rng = seeded(700 + seed);
  const s = Engine.createGame(rng);
  let guard = 0;
  while (s.status === "playing") {
    if (++guard > 400) throw new Error("game did not terminate");
    // Place a pin on a random open, non-cat step.
    const opens = [];
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++) {
        const k = Engine.keyOf(r, c);
        if (!s.pins.has(k) && !(s.cat.r === r && s.cat.c === c)) opens.push({ r, c });
      }
    if (opens.length === 0) break;
    const cell = opens[Math.floor(rng() * opens.length)];
    Engine.placePin(s, cell.r, cell.c, rng);
    assert.ok(Engine.inBounds(s.cat.r, s.cat.c), "cat stays on the board");
  }
  assert.ok(["won", "lost", "playing"].includes(s.status));
}

console.log("All Trap-the-Cat engine assertions passed.");
