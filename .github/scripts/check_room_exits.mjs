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

// Which wall a door is in, worked out from the game's own frame rather than a
// hardcoded canvas size. It has to be the frame every room SHARES, not one
// room's own geometry: a floor-plate room declares no floorPoly at all, so
// bounds taken from a single room collapse to whatever that room happens to
// list — for the bedroom, its one exit, which then sat dead-centre of its own
// "room" and was reported as being in whichever wall rounding preferred.
//
// Props are deliberately EXCLUDED from the frame. They overhang it on purpose
// (a wall panel starts at x = -6 so the wall runs off the edge of the picture),
// and letting them set the bounds stretches the frame sideways until every
// side door reads as a near-wall one.
function gameBounds(ROOMS) {
  const xs = [], ys = [];
  for (const room of Object.values(ROOMS)) {
    for (const [x, y] of room.floorPoly || []) { xs.push(x); ys.push(y); }
    for (const ex of room.exits || []) { xs.push(ex.x, ex.x + ex.w); ys.push(ex.y, ex.y + ex.h); }
  }
  if (!xs.length) return null;
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

// A SIDE door is one hard against the left or right edge of the frame; a
// back/near door is one high or low in it. Testing the sides FIRST matters:
// the floor of a top-down room lives in the lower half of the frame, so a
// perfectly ordinary side door sits low and "which edge is nearest in pixels"
// calls it a near-wall door every time. That is what this check first did.
//
// Calibrated on the rooms that exist, as fractions of the frame. Side doors:
// 0.93 and 0.93 (bedroom and lounge, right), 0.07 and 0.04 (lounge and lab,
// left). The nearest a NON-side door gets to either edge is 0.33 (the lounge's
// back-left arch), so 0.15 sits with a wide margin on both sides. Vertically,
// back doors are at 0.09 and near doors at 0.99, against a 0.35/0.75 split.
const SIDE_FRAC = 0.15, BACK_FRAC = 0.35, NEAR_FRAC = 0.75;
function wallOf(b, ex) {
  if (!b) return null;
  const cx = ex.x + ex.w / 2, cy = ex.y + ex.h / 2;
  const fx = (cx - b.x0) / (b.x1 - b.x0), fy = (cy - b.y0) / (b.y1 - b.y0);
  if (fx <= SIDE_FRAC) return "left";
  if (fx >= 1 - SIDE_FRAC) return "right";
  const wall = fy <= BACK_FRAC ? "back" : fy >= NEAR_FRAC ? "near" : null;
  if (!wall) return null;   // mid-frame and mid-wall: nothing to say, so say nothing
  // A back/near door is further described by which third of the wall it is in,
  // because that is how the room specs name them ("back-left").
  return fx < 0.34 ? `${wall}-left` : fx > 0.66 ? `${wall}-right` : wall;
}

// A room's SPEC (games/<id>/rooms/<room>.json) says which wall each way out
// was DRAWN in — the art was generated from it. The exit trigger is code. When
// those two disagree the doorway is painted in one wall and armed in another,
// and no art check and no pairing check can see it.
function checkDeclaredWalls(gameDir, roomId, room, bounds) {
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
    const actual = wallOf(bounds, ex);
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
  const bounds = gameBounds(ROOMS);
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

    checkDeclaredWalls(gameDir, roomId, room, bounds);
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

// Which boundary a gate is in, and which boundary a spawn stands against. A
// spawn is one cell INSIDE the wall (you cannot stand in the wall), so it is
// classified by the boundary it is nearest rather than by sitting on one.
function gateSide(cells, COLS, ROWS) {
  const p = cells[0];
  if (p.r === 0) return "top";
  if (p.r === ROWS - 1) return "bottom";
  if (p.c === 0) return "left";
  if (p.c === COLS - 1) return "right";
  return null;
}
function spawnSide(p, COLS, ROWS) {
  if (p.r <= 1) return "top";
  if (p.r >= ROWS - 2) return "bottom";
  if (p.c <= 1) return "left";
  if (p.c >= COLS - 2) return "right";
  return null;
}
const OPPOSITE = { top: "bottom", bottom: "top", left: "right", right: "left" };
// How far out of line with the gate a spawn may be, in cells. Every real pair
// in Dog Punk is 0 — the spawn sits inside the gate's own span — so 1 is a
// margin, not a fudge.
const ALIGN_TOLERANCE = 1;

function checkGrid(roomsPath, gateChar = "G", spawnChar = "P") {
  global.window = {};
  eval(readFileSync(roomsPath, "utf8"));
  const data = Object.values(global.window).find((v) => v && Array.isArray(v.ROOMS) && v.COLS);
  if (!data) {
    console.error(`Couldn't find a window.*_ROOMS export with COLS/ROWS/ROOMS in ${roomsPath}`);
    process.exit(2);
  }
  const { COLS, ROWS, ROOMS, SOLID } = data;
  const seen = [];

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
    // Arriving ON the way out is the grid version of landing on a doorstep
    // that throws you straight back: you would clear the room and be sent
    // onward before touching anything.
    const s = spawn[0];
    if (gate.some((g) => Math.abs(g.c - s.c) <= 1 && Math.abs(g.r - s.r) <= 1)) {
      fail(`${id}: the spawn (${s.c},${s.r}) is touching the gate — you arrive already leaving`);
    }
    if (SOLID && SOLID.has && SOLID.has(map[s.r][s.c])) fail(`${id}: the spawn cell is solid`);

    seen.push({ id, gate, spawn: s, gside: gateSide(gate, COLS, ROWS), sside: spawnSide(s, COLS, ROWS) });
  }

  // THE PAIRING RULE, in the form a grid takes it. In the derived shape a door
  // names its partner and arrival is computed from it; here the partner is
  // implicit — the next room in the list — and arrival is a fixed cell. So the
  // thing to check is that those two agree: you leave through one room's wall
  // and arrive against the FACING wall of the next, lined up with the way you
  // came out. Get it wrong and you walk out of one room and appear somewhere
  // unrelated in the next, with nothing to notice it, because there is no
  // partner to disagree with.
  //
  // This started life as "every room's gate is in the same cells". That was
  // true of a chapter which was one straight column of three rooms and false
  // the moment it grew to fifteen and started turning corners — the rule was a
  // description of one level's layout rather than of what makes doors work.
  for (let i = 0; i < seen.length - 1; i++) {
    const a = seen[i], b = seen[i + 1];
    if (!a.gside) { fail(`${a.id}: can't tell which wall its gate is in`); continue; }
    if (!b.sside) { fail(`${b.id}: its spawn (${b.spawn.c},${b.spawn.r}) is not against any wall — there is no doorway it could have come through`); continue; }
    if (b.sside !== OPPOSITE[a.gside]) {
      fail(`${a.id} -> ${b.id}: you leave through the ${a.gside} wall but arrive against ${b.id}'s ${b.sside} wall — walking out one side and in the same side means the world folds back on itself`);
      continue;
    }
    // Lined up across the shared edge: leaving by the 8th column means
    // arriving in about the 8th column, not at the far end of the next room.
    const horizontal = a.gside === "top" || a.gside === "bottom";
    const span = a.gate.map((g) => (horizontal ? g.c : g.r));
    const at = horizontal ? b.spawn.c : b.spawn.r;
    const off = Math.max(Math.min(...span) - at, at - Math.max(...span), 0);
    if (off > ALIGN_TOLERANCE) {
      fail(`${a.id} -> ${b.id}: the gate spans ${Math.min(...span)}-${Math.max(...span)} but you arrive at ${at}, ${off} cells out of line — the street jumps sideways under the player`);
    }
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

// A door-data file the game does not actually LOAD is worse than none: the
// game dies at startup on the missing global. One it does not PRECACHE works
// online and breaks the moment the PWA is offline, which is the failure nobody
// hits until they are on a train. Both are plain text searches, so neither is
// a judgement call — sync-precache.js deliberately answers only "does every
// listed file exist", not "is every needed file listed", so this half belongs
// to whoever owns the file. That is this gate.
function checkWiring(dir, file) {
  const rel = "./" + path.basename(file);
  for (const [page, what] of [["index.html", "load"], ["sw.js", "precache"]]) {
    const p = path.join(dir, page);
    if (!existsSync(p)) continue;
    const src = readFileSync(p, "utf8");
    if (!src.includes(path.basename(file))) {
      fail(`${dir}: ${page} does not ${what} ${rel} — ` + (what === "load"
        ? "the game dies at startup on the missing global"
        : "the game works online and breaks the moment the PWA is offline"));
    }
  }
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
  checkWiring(t.dir, t.file);
  if (t.kind === "grid") checkGrid(t.file);
  else checkDeclarative(t.dir, t.file);
}

if (problems === 0) console.log(`OK — every way between rooms checks out (${targets.length} game(s)).`);
else {
  console.log(`\n${problems} problem(s) found. The rules and the reasons are in docs/DOOR_STANDARD.md.`);
  process.exit(1);
}
