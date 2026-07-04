// engine.test.js — headless rules coverage for "Step in the Cat" (Trap the
// Cat with differentiated pins). Plain Node: `node games/trace/engine.test.js`.
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

// ---- a fresh game: cat center, a hand of pins, room to run -------------
const g = Engine.createGame(seeded(1));
assert.strictEqual(g.status, "playing");
assert.deepStrictEqual(g.cat, { r: 4, c: 4 }, "cat starts centered");
assert.strictEqual(g.hand.length, Engine.HAND_SIZE, "you start with a full hand of pins");
assert.ok(g.hand.every((t) => Engine.PIN_TYPES.includes(t)), "every held pin is a real type");
assert.ok(g.bag.length > 0, "the draw bag is stocked");
for (const n of Engine.neighbors(4, 4)) assert.ok(!g.pins.has(Engine.keyOf(n.r, n.c)), "ring around the cat is open");

// ---- a plain Wall: it sticks, the cat steps, the hand refills ----------
const wall = Engine.createGame(seeded(2));
wall.hand[0] = "wall";
const catBefore = { ...wall.cat };
let cell = null;
for (let r = 0; r < 9 && !cell; r++) for (let c = 0; c < 9; c++) if (Engine.isPlaceable(wall, r, c)) { cell = { r, c }; break; }
Engine.placePin(wall, cell.r, cell.c, 0, seeded(2));
assert.ok(wall.pins.has(Engine.keyOf(cell.r, cell.c)), "the wall was placed");
assert.strictEqual(wall.pinsUsed, 1);
assert.strictEqual(wall.hand.length, Engine.HAND_SIZE, "hand refilled to full");
assert.ok(wall.cat.r !== catBefore.r || wall.cat.c !== catBefore.c, "the cat took a step");

// ---- illegal placements are ignored ------------------------------------
const noop = Engine.createGame(seeded(3));
noop.hand[0] = "wall";
const pu = noop.pinsUsed;
Engine.placePin(noop, noop.cat.r, noop.cat.c, 0); // on the cat
Engine.placePin(noop, -1, -1, 0); // off-board
Engine.placePin(noop, 0, 0, 9); // no such hand slot
assert.strictEqual(noop.pinsUsed, pu, "illegal placements never spend a pin");

// ---- Snare: walling next to the cat stuns it (it skips a move) ---------
const snare = Engine.createGame(seeded(4));
snare.pins = new Set();
snare.cat = { r: 4, c: 4 };
snare.hand = ["snare", "wall", "wall"];
const adj = Engine.neighbors(4, 4)[0]; // a neighbour of the cat
const catPos = { ...snare.cat };
Engine.placePin(snare, adj.r, adj.c, 0, seeded(4));
assert.ok(snare.pins.has(Engine.keyOf(adj.r, adj.c)), "the snare walls its step");
assert.deepStrictEqual(snare.cat, catPos, "a snared cat does not move that turn");
assert.match(snare.message, /snared/i);

// ---- Boulder: seals two steps at once ----------------------------------
const boulder = Engine.createGame(seeded(5));
boulder.pins = new Set();
boulder.cat = { r: 4, c: 4 };
boulder.hand = ["boulder", "wall", "wall"];
// Place away from the cat so its move doesn't confuse the wall count.
Engine.placePin(boulder, 6, 4, 0, seeded(5));
let bWalls = 0;
for (const _ of boulder.pins) bWalls++;
assert.strictEqual(bWalls, 2, "a boulder drops two walls");

// ---- Lure: the cat chases the fish instead of the edge -----------------
const lure = Engine.createGame(seeded(6));
lure.pins = new Set();
lure.cat = { r: 4, c: 4 };
lure.hand = ["lure", "wall", "wall"];
// Bait it downward (away from the top edge it would otherwise sprint for).
Engine.placePin(lure, 6, 4, 0, seeded(6));
assert.strictEqual(lure.cat.r, 5, "the cat stepped down toward the fish rather than out to the nearer side edge");

// ---- winning: seal the last escape route -------------------------------
const win = Engine.createGame(seeded(7));
win.pins = new Set(Engine.neighbors(4, 4).slice(1).map((n) => Engine.keyOf(n.r, n.c))); // all but one neighbour
win.cat = { r: 4, c: 4 };
win.hand = ["wall", "wall", "wall"];
const gap = Engine.neighbors(4, 4)[0];
assert.ok(Engine.findEscape(win).reachable, "with a gap it can still get out");
Engine.placePin(win, gap.r, gap.c, 0, seeded(7));
assert.strictEqual(win.status, "won", "plugging the last gap traps it");

// ---- losing: an open board lets the cat reach the edge -----------------
const lose = Engine.createGame(seeded(8));
lose.pins = new Set();
lose.cat = { r: 1, c: 4 };
lose.hand = ["wall", "wall", "wall"];
Engine.placePin(lose, 8, 0, 0, seeded(8)); // harmless far wall
assert.strictEqual(lose.status, "lost", "the cat marched to the edge");

// ---- fuzz: random legal play never throws and always terminates --------
for (let seed = 0; seed < 60; seed++) {
  const rng = seeded(900 + seed);
  const s = Engine.createGame(rng);
  let guard = 0;
  while (s.status === "playing") {
    if (++guard > 400) throw new Error("game did not terminate");
    const opens = [];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (Engine.isPlaceable(s, r, c)) opens.push({ r, c });
    if (!opens.length) break;
    const cell = opens[Math.floor(rng() * opens.length)];
    const hi = Math.floor(rng() * s.hand.length);
    Engine.placePin(s, cell.r, cell.c, hi, rng);
    assert.ok(Engine.inBounds(s.cat.r, s.cat.c), "cat stays on the board");
    assert.strictEqual(s.hand.length, Engine.HAND_SIZE, "hand stays full");
  }
  assert.ok(["won", "lost", "playing"].includes(s.status));
}

console.log("All Trap-the-Cat (differentiated-pin) engine assertions passed.");
