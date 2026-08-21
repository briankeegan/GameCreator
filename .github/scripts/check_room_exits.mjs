#!/usr/bin/env node
// THE DOOR GATE. Checks every game's ways between rooms against
// docs/DOOR_STANDARD.md — read that first; this file is the standard's third
// piece (rule -> tool -> gate), not a second copy of it.
//
//   node .github/scripts/check_room_exits.mjs              # every game it can find
//   node .github/scripts/check_room_exits.mjs games/the-game/story.js
//
// WHICH GAMES. Detected, never configured — the same reasoning as the art
// gate globbing both sprite layouts. A game is checked if it PUBLISHES its
// door data as plain data (DOOR_STANDARD §8), in one of the two shapes this
// repo actually has:
//
//   * DECLARATIVE — `games/<id>/story.js` sets `window.<GAME>_STORY` with a
//     `ROOMS` table of hand-placed rooms and `exits` rectangles. Doors can be
//     in any wall, so arrival has to be DERIVED at runtime from the partner
//     door. Newsey is the reference.
//   * GRID — `games/<id>/rooms.js` sets `window.<GAME>_ROOMS` with `COLS`,
//     `ROWS` and an array of rooms carrying a character `map`. Every room is
//     the same grid, so arrival is a CONSTANT: the gate and the spawn are the
//     same cells in every room. Dog Punk is the reference.
//
// A game whose rooms live inside app.js beside `document.getElementById`
// cannot be checked at all — evaluating that file needs a browser. That is
// why Dog Punk's maps were moved to their own rooms.js, and it is the whole
// content of §8: publish the data, get the gate for free.
//
// WHAT IS CHECKED. Every item below is a bug that shipped, or the invariant a
// shipped bug violated — see the standard for the stories. Nothing here
// asserts a value the game DERIVES (an arrival's exact x/y or facing), because
// those are recomputed from room art and a snapshot of them goes stale the
// moment a room is regenerated.
import { readFileSync, existsSync, readdirSync } from "fs";
import path from "path";

const PLAYER_W = 14, PLAYER_H = 18;  // must match app.js's player.w/h
const DOORSTEP_CLEARANCE = 8;        // must match app.js's DOORSTEP_CLEARANCE
// The wall names a room SPEC may use, and the only ones the room generator
// understands — room.py's WALL_PHRASE is the other half of this pair.
const WALLS = new Set(["back", "back-left", "back-right", "left", "right", "near"]);
const STEP_OUT = [                   // must match app.js's STEP_OUT, in order
  { dir: "down", dx: 0, dy: 1 }, { dir: "up", dx: 0, dy: -1 },
  { dir: "right", dx: 1, dy: 0 }, { dir: "left", dx: -1, dy: 0 },
];

let problems = 0;
const fail = (msg) => { console.log(`FAIL ${msg}`); problems++; };

/* ---------------------------------------------------------------- geometry */

function pointInPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function onFloor(room, x, y) {
  if (room.floorPoly) return pointInPoly(room.floorPoly, x + PLAYER_W / 2, y + PLAYER_H);
  return true; // no floorPoly — the room relies on its walk mask, which is a PNG
}
function hitBox(boxes, x, y) {
  for (const b of boxes || []) {
    if (x + PLAYER_W > b.x && x < b.x + b.w && y + PLAYER_H > b.y && y < b.y + b.h) return b;
  }
  return null;
}
function overlapsAnyExit(room, x, y, pad = 0) {
  return (room.exits || []).some((ex) =>
    x + PLAYER_W > ex.x - pad && x < ex.x + ex.w + pad &&
    y + PLAYER_H > ex.y - pad && y < ex.y + ex.h + pad);
}

/* ------------------------------------------------- declarative (story.js) */

function loadStory(storyPath) {
  global.window = {};
  // story.js is an IIFE assigning to window.<GAME>_STORY, and the room data is
  // plain object literals with no other dependencies — so evaluate it rather
  // than parse it.
  eval(readFileSync(storyPath, "utf8"));
  const exp = Object.values(global.window).find((v) => v && v.ROOMS);
  if (!exp) {
    console.error(`Couldn't find a window.*_STORY export with a ROOMS table in ${storyPath}`);
    process.exit(2);
  }
  return exp;
}

function linkedThing(room, link) {
  const doors = (room.exits || []).filter((e) => e.link === link);
  const npcs = (room.npcs || []).filter((n) => n.link === link);
  return { count: doors.length + npcs.length, door: doors[0], npc: npcs[0] };
}

// The runtime's arrivalFrom(), close enough to answer the only question that
// matters here: is there ANY spot to step out onto? The game re-derives the
// exact one against the walk mask, which this can't read — so a pass here
// means "derivable", never "it will land exactly there".
function derivableArrival(room, link) {
  const { door, npc } = linkedThing(room, link);
  const from = door
    ? { x: door.x + door.w / 2, y: door.y + door.h / 2 }
    : npc ? { x: npc.x, y: npc.y } : null;
  if (!from) return false;
  for (const s of STEP_OUT) {
    for (let dist = 12; dist <= 44; dist += 4) {
      const x = from.x + s.dx * dist - PLAYER_W / 2;
      const y = from.y + s.dy * dist - PLAYER_H;
      if (!onFloor(room, x, y)) continue;
      if (hitBox(room.obstacles, x, y)) continue;
      if (overlapsAnyExit(room, x, y, DOORSTEP_CLEARANCE)) continue;
      return true;
    }
  }
  return false;
}

// Which wall a door is in, worked out from the room itself rather than from a
// hardcoded canvas size: the room's extent is its floor plus everything it
// puts on that floor. Used only to compare against what the room SPEC says the
// art was drawn with — see checkDeclaredWalls.
function roomBounds(room) {
  const xs = [], ys = [];
  for (const [x, y] of room.floorPoly || []) { xs.push(x); ys.push(y); }
  for (const ex of room.exits || []) { xs.push(ex.x, ex.x + ex.w); ys.push(ex.y, ex.y + ex.h); }
  if (!xs.length) return null;
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
function wallOf(room, ex) {
  const b = roomBounds(room);
  if (!b) return null;
  const cx = ex.x + ex.w / 2, cy = ex.y + ex.h / 2;
  const d = { back: cy - b.y0, near: b.y1 - cy, left: cx - b.x0, right: b.x1 - cx };
  const wall = Object.keys(d).reduce((a, k) => (d[k] < d[a] ? k : a), "back");
  if (wall !== "back" && wall !== "near") return wall;
  // A back/near door is further described by which third of the wall it is
  // in, because that is how the room specs name them ("back-left").
  const third = (cx - b.x0) / (b.x1 - b.x0);
  return third < 0.34 ? `${wall}-left` : third > 0.66 ? `${wall}-right` : wall;
}

// A room's SPEC (games/<id>/rooms/<room>.json) says which wall each way out
// was DRAWN in — the art was generated from it. The exit trigger is code. When
// those two disagree the doorway is painted in one wall and armed in another,
// and no art check and no pairing check can see it.
function checkDeclaredWalls(gameDir, roomId, room) {
  const specPath = path.join(gameDir, "rooms", `${roomId}.json`);
  if (!existsSync(specPath)) return;                     // not every room has a spec yet
  let spec;
  try { spec = JSON.parse(readFileSync(specPath, "utf8")); } catch { return; }
  for (const decl of spec.doors || []) {
    if (!decl.to || !decl.wall) continue;
    // An unrecognised wall name is not a typo the prompt survives: room.py's
    // WALL_PHRASE falls back to echoing the raw string, so "south" would be
    // pasted into the generator's prompt as the word "south" and the doorway
    // would come back wherever the model felt like putting it.
    if (!WALLS.has(decl.wall)) {
      fail(`${roomId} -> ${decl.to}: "${decl.wall}" is not a wall — use one of ${[...WALLS].join(", ")} (room.py's WALL_PHRASE)`);
      continue;
    }
    const ex = (room.exits || []).find((e) => e.to === decl.to);
    if (!ex) {
      fail(`${roomId}: ${specPath} says a door to "${decl.to}" is drawn in the ${decl.wall} wall, but no exit in story.js leads there — the doorway is painted and nothing arms it`);
      continue;
    }
    const actual = wallOf(room, ex);
    // "back" vs "back-left" is a difference in thirds, not in walls; only a
    // genuine wall swap (a door drawn in the back, armed on the right) is
    // worth failing a build over.
    if (actual && actual.split("-")[0] !== decl.wall.split("-")[0]) {
      fail(`${roomId} -> ${decl.to}: drawn in the ${decl.wall} wall (${path.basename(specPath)}) but its trigger sits in the ${actual} wall — art and code disagree about where the door is`);
    }
  }
}

function checkDeclarative(gameDir, storyPath) {
  const story = loadStory(storyPath);
  const ROOMS = story.ROOMS;
  const RUNE_DOOR = story.RUNE_DOOR || [];
  const START = story.START_ROOM || "home_bedroom";
  const reachable = new Set();

  for (const [roomId, room] of Object.entries(ROOMS)) {
    for (const ex of room.exits || []) {
      const label = `${roomId} -> ${ex.to || "rune door"}`;
      // A door is one of a PAIR. It carries a `link`, and the door it comes
      // out of is whichever door (or linked NPC) in the destination shares it.
      // Everything about WHERE you land is derived from that partner at
      // runtime, so there is nothing here about coordinates — what can go
      // wrong is structural.
      if (!ex.link) { fail(`${label}: no link — a door has to name the door it pairs with`); continue; }
      if (ex.rune && !ex.to) continue;   // the picker itself leads nowhere
      const dest = ROOMS[ex.to];
      if (!dest) { fail(`${label}: "${ex.to}" is not a room`); continue; }
      reachable.add(ex.to);
      const { count } = linkedThing(dest, ex.link);
      if (count === 0) {
        fail(`${label}: nothing in ${ex.to} carries link "${ex.link}" — you would arrive nowhere near a door`);
      } else if (count > 1) {
        fail(`${label}: ${ex.to} has ${count} things carrying link "${ex.link}" — which one do you come out of?`);
      } else if (!derivableArrival(dest, ex.link)) {
        // Silent in play: arrival falls back to the room's playerStart, so you
        // walk through a door and appear in the middle of the room.
        fail(`${label}: no way to step out of the "${ex.link}" door in ${ex.to} — every spot around it is off the floor, inside an obstacle, or within ${DOORSTEP_CLEARANCE}px of a doorway`);
      }
    }

    for (const npc of room.npcs || []) {
      if (!npc.gotoRoom) continue;
      if (!ROOMS[npc.gotoRoom]) { fail(`${roomId} npc "${npc.id}" -> "${npc.gotoRoom}" is not a room`); continue; }
      reachable.add(npc.gotoRoom);
      if (!npc.link) fail(`${roomId} npc "${npc.id}": walks you to ${npc.gotoRoom} with no link, so there is no door to come back out of`);
    }

    // A spawn point standing on the room's own doorway is a dead end: doors
    // arrive disarmed and only re-arm once you step CLEAR of them, so a
    // player who starts on one can walk into it forever with nothing
    // happening. This shipped once and was found by a person playing it.
    const st = room.playerStart;
    if (st && overlapsAnyExit(room, st.x, st.y, DOORSTEP_CLEARANCE)) {
      fail(`${roomId}: playerStart (${st.x},${st.y}) is on top of one of this room's own doorways — the door never arms and the player is stuck`);
    }

    checkDeclaredWalls(gameDir, roomId, room);
  }

  for (const dest of RUNE_DOOR) {
    if (dest.locked) continue;
    const label = `rune door -> ${dest.to}`;
    const room = ROOMS[dest.to];
    if (!room) { fail(`${label}: "${dest.to}" is not a room`); continue; }
    reachable.add(dest.to);
    if (!dest.link) { fail(`${label}: no link`); continue; }
    if (linkedThing(room, dest.link).count === 0) fail(`${label}: nothing in ${dest.to} carries link "${dest.link}"`);
  }

  // A room you can leave but never enter is a room nobody will ever see. The
  // first room of the game is the one legitimate exception.
  for (const roomId of Object.keys(ROOMS)) {
    if (roomId === START || reachable.has(roomId)) continue;
    fail(`${roomId}: nothing leads into this room — it can be left but never entered`);
  }
}

/* -------------------------------------------------------- grid (rooms.js) */

const cellsOf = (map, ch) => {
  const out = [];
  map.forEach((row, r) => [...row].forEach((c, i) => { if (c === ch) out.push({ c: i, r }); }));
  return out;
};
const key = (cells) => cells.map((p) => `${p.c},${p.r}`).sort().join(" ");

function checkGrid(roomsPath, gateChar = "G", spawnChar = "P") {
  global.window = {};
  eval(readFileSync(roomsPath, "utf8"));
  const data = Object.values(global.window).find((v) => v && Array.isArray(v.ROOMS) && v.COLS);
  if (!data) {
    console.error(`Couldn't find a window.*_ROOMS export with COLS/ROWS/ROOMS in ${roomsPath}`);
    process.exit(2);
  }
  const { COLS, ROWS, ROOMS, SOLID } = data;
  let gateKey = null, spawnKey = null, gateRoom = null, spawnRoom = null;

  for (const room of ROOMS) {
    const id = room.id || "(unnamed)";
    const map = room.map || [];
    // A short row is not solid and not floor — it draws as a hole you can
    // stand inside. Dog Punk shipped a 15-character top row exactly once.
    if (map.length !== ROWS) fail(`${id}: map is ${map.length} rows, expected ${ROWS}`);
    map.forEach((row, r) => {
      if (row.length !== COLS) fail(`${id}: map row ${r} is ${row.length} characters, expected ${COLS} — a short row leaves cells that are neither wall nor floor`);
    });

    const gate = cellsOf(map, gateChar), spawn = cellsOf(map, spawnChar);
    if (!gate.length) { fail(`${id}: no '${gateChar}' gate cell — a room with no way out`); continue; }
    if (spawn.length !== 1) { fail(`${id}: ${spawn.length} '${spawnChar}' spawn cells, expected exactly 1`); continue; }

    // The gate belongs in the boundary, not loose in the middle of the floor:
    // a way out is a hole in the edge of the room, and one drawn inland reads
    // as a decoration you happen to be able to stand on.
    for (const g of gate) {
      if (g.r !== 0 && g.r !== ROWS - 1 && g.c !== 0 && g.c !== COLS - 1) {
        fail(`${id}: gate cell (${g.c},${g.r}) is not in the room's boundary wall`);
      }
    }
    // The grid shape's whole advantage is that arrival is a constant. It only
    // holds while every room agrees where the gate and the spawn are: move
    // room 2's gate and you walk out the top of room 1 and arrive somewhere
    // unrelated, with nothing to notice it — the derived shape's checks
    // cannot fire here because there is no partner to disagree with.
    if (gateKey === null) { gateKey = key(gate); gateRoom = id; }
    else if (key(gate) !== gateKey) fail(`${id}: its gate is at ${key(gate)} but ${gateRoom}'s is at ${gateKey} — every room's gate must be in the same cells, or walking out of one room puts you somewhere else in the next`);
    if (spawnKey === null) { spawnKey = key(spawn); spawnRoom = id; }
    else if (key(spawn) !== spawnKey) fail(`${id}: its spawn is at ${key(spawn)} but ${spawnRoom}'s is at ${spawnKey} — every room's spawn must be in the same cell`);

    // Arriving ON the way out is the grid version of landing on a doorstep
    // that throws you straight back: you would clear the room and be sent
    // onward before touching anything.
    const s = spawn[0];
    if (gate.some((g) => Math.abs(g.c - s.c) <= 1 && Math.abs(g.r - s.r) <= 1)) {
      fail(`${id}: the spawn (${s.c},${s.r}) is touching the gate — you arrive already leaving`);
    }
    if (SOLID && SOLID.has && SOLID.has(map[s.r][s.c])) fail(`${id}: the spawn cell is solid`);
  }
}

/* ------------------------------------------------------------------- sweep */

function detect() {
  const targets = [];
  for (const entry of readdirSync("games", { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const dir = path.join("games", entry.name);
    if (existsSync(path.join(dir, "story.js"))) targets.push({ kind: "declarative", dir, file: path.join(dir, "story.js") });
    else if (existsSync(path.join(dir, "rooms.js"))) targets.push({ kind: "grid", dir, file: path.join(dir, "rooms.js") });
  }
  return targets;
}

const arg = process.argv[2];
const targets = arg
  ? [{ kind: path.basename(arg) === "rooms.js" ? "grid" : "declarative", dir: path.dirname(arg), file: arg }]
  : detect();

if (!targets.length) {
  console.log("No game publishes door data yet — see docs/DOOR_STANDARD.md §8.");
  process.exit(0);
}
for (const t of targets) {
  console.log(`== ${t.file} (${t.kind}) ==`);
  if (t.kind === "grid") checkGrid(t.file);
  else checkDeclarative(t.dir, t.file);
}

if (problems === 0) console.log(`OK — every way between rooms checks out (${targets.length} game(s)).`);
else {
  console.log(`\n${problems} problem(s) found. The rules and the reasons are in docs/DOOR_STANDARD.md.`);
  process.exit(1);
}
