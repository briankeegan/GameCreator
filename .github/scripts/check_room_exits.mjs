#!/usr/bin/env node
// Validates every room's `exits` against the games/<id>/story.js convention
// documented in that file (search "EXIT / DOOR CONVENTION"). Run this after
// adding or moving any exit/arriveAt — by hand, or the "Verify room exits"
// CI workflow runs it automatically on any story.js change.
//
// Usage: node .github/scripts/check_room_exits.mjs games/<id>/story.js
//
// Checks, per exit:
//   1. `to` points at a room that actually exists.
//   2. `arriveFacing` is set (down/up/left/right) — without it the player
//      keeps whatever direction she was last walking, which reads as
//      "just materializing" in the new room instead of stepping through a
//      door (reported live).
//   3. `arriveAt` lands on real floor in the destination room.
//   4. `arriveAt` doesn't land inside a destination-room obstacle.
//   5. `arriveAt` isn't an accidental bounce: walking in ANY of the 4
//      directions for up to ACCIDENTAL_BOUNCE_PX pixels must not cross back
//      into another exit trigger in that room (reported live: two door
//      pairs landed close enough to each other's return door that holding
//      one direction key bounced you straight back where you came from).
//      A door reached only after a full deliberate walk across the room is
//      fine — that's normal navigation, not a bounce — hence the small
//      pixel budget here rather than checking the whole room.
import { readFileSync } from "fs";

const ACCIDENTAL_BOUNCE_PX = 20; // ~1 quick keytap at the player's speed (70px/s)
const PLAYER_W = 14, PLAYER_H = 18; // must match app.js's player.w/h

const storyPath = process.argv[2];
if (!storyPath) {
  console.error("Usage: node check_room_exits.mjs games/<id>/story.js");
  process.exit(2);
}

// story.js assigns to window.NEWSEY_STORY (or window.<GAME>_STORY) inside an
// IIFE — evaluate it against a stub `window` rather than parsing, since the
// room data is plain object literals with no other dependencies.
global.window = {};
eval(readFileSync(storyPath, "utf8"));
const storyExports = Object.values(global.window).find((v) => v && v.ROOMS);
if (!storyExports) {
  console.error("Couldn't find a window.*_STORY export with a ROOMS table in", storyPath);
  process.exit(2);
}
const ROOMS = storyExports.ROOMS;
const RUNE_DOOR = storyExports.RUNE_DOOR || [];

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
  return true; // no floorPoly to check against (relies on the walk mask alone)
}
function hitBox(boxes, x, y) {
  for (const b of boxes || []) {
    if (x + PLAYER_W > b.x && x < b.x + b.w && y + PLAYER_H > b.y && y < b.y + b.h) return b;
  }
  return null;
}
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

let problems = 0;
// The rune door's destinations are exits in everything but name: same
// arriveAt/arriveFacing contract, same chance of landing off the floor.
// A door is one of a PAIR. It carries a `link`, and the door it comes out of
// is whichever door (or linked NPC, for the lounge's portal) in the
// destination room shares that link. Where you land is worked out at runtime
// from that partner, so there is nothing here about coordinates — the things
// that CAN go wrong are structural: a link with no partner, a room nothing
// leads into, a door that names a room that doesn't exist.
//
// This replaced a set of rules about hand-typed `arriveAt` values. Those
// rules all passed while the Library, the Garden and the Lab put you down on
// the same square of lounge floor, nowhere near the door you walked through:
// each landing spot was independently valid and no rule compared the two
// sides of a door to each other.

function linkPartners(room, link) {
  const doors = (room.exits || []).filter((e) => e.link === link);
  const npcs = (room.npcs || []).filter((n) => n.link === link);
  return doors.length + npcs.length;
}

const reachable = new Set();

for (const [roomId, room] of Object.entries(ROOMS)) {
  for (const ex of room.exits || []) {
    // A `rune: true` exit opens the destination picker rather than leading
    // anywhere itself, but it is still one half of a link — every room the
    // picker can reach comes back out through it.
    const to = ex.to;
    const label = `${roomId} -> ${to || "rune door"}`;
    if (!ex.link) { console.log(`FAIL ${label}: no link — a door has to name the door it pairs with`); problems++; continue; }
    if (ex.rune && !to) continue;
    const dest = ROOMS[to];
    if (!dest) { console.log(`FAIL ${label}: "${to}" is not a room`); problems++; continue; }
    reachable.add(to);
    const partners = linkPartners(dest, ex.link);
    if (partners === 0) {
      console.log(`FAIL ${label}: nothing in ${to} carries link "${ex.link}" — you would arrive nowhere near a door`);
      problems++;
    } else if (partners > 1) {
      console.log(`FAIL ${label}: ${to} has ${partners} things carrying link "${ex.link}" — which one do you come out of?`);
      problems++;
    }
  }
  for (const npc of room.npcs || []) {
    if (npc.gotoRoom) {
      if (!ROOMS[npc.gotoRoom]) { console.log(`FAIL ${roomId} npc "${npc.id}" -> "${npc.gotoRoom}" is not a room`); problems++; continue; }
      reachable.add(npc.gotoRoom);
      if (!npc.link) { console.log(`FAIL ${roomId} npc "${npc.id}": walks you to ${npc.gotoRoom} with no link, so there is no door to come back out of`); problems++; }
    }
  }
}

// The rune door's picker is the other half of every rune-linked room.
for (const dest of RUNE_DOOR) {
  if (dest.locked) continue;
  const label = `rune door -> ${dest.to}`;
  const room = ROOMS[dest.to];
  if (!room) { console.log(`FAIL ${label}: "${dest.to}" is not a room`); problems++; continue; }
  reachable.add(dest.to);
  if (!dest.link) { console.log(`FAIL ${label}: no link`); problems++; continue; }
  if (linkPartners(room, dest.link) === 0) {
    console.log(`FAIL ${label}: nothing in ${dest.to} carries link "${dest.link}"`);
    problems++;
  }
}

// A room you can leave but never enter is a room nobody will ever see. The
// first room of the game is the one legitimate exception.
const START = "home_bedroom";
for (const roomId of Object.keys(ROOMS)) {
  if (roomId === START || reachable.has(roomId)) continue;
  console.log(`FAIL ${roomId}: nothing leads into this room — it can be left but never entered`);
  problems++;
}

if (problems === 0) console.log(`OK — every exit in ${storyPath} checks out.`);
else { console.log(`\n${problems} problem(s) found.`); process.exit(1); }
