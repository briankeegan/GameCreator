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
for (const [roomId, room] of Object.entries(ROOMS)) {
  for (const ex of room.exits || []) {
    const label = `${roomId} -> ${ex.to} @ (${ex.arriveAt?.x},${ex.arriveAt?.y})`;
    const dest = ROOMS[ex.to];
    if (!dest) { console.log(`FAIL ${label}: "${ex.to}" is not a room`); problems++; continue; }
    if (!ex.arriveFacing) { console.log(`FAIL ${label}: no arriveFacing set`); problems++; }
    if (!ex.arriveAt) { console.log(`FAIL ${roomId} -> ${ex.to}: no arriveAt set`); problems++; continue; }
    const { x, y } = ex.arriveAt;
    if (!onFloor(dest, x, y)) { console.log(`FAIL ${label}: not on ${ex.to}'s floor`); problems++; }
    const obs = hitBox(dest.obstacles, x, y);
    if (obs) { console.log(`FAIL ${label}: lands inside an obstacle ${JSON.stringify(obs)}`); problems++; }
    const bounces = [];
    for (const [dirName, [dx, dy]] of Object.entries(DIRS)) {
      let bx = x, by = y;
      for (let step = 1; step <= ACCIDENTAL_BOUNCE_PX; step++) {
        bx += dx; by += dy;
        if (hitBox(dest.exits, bx, by)) { bounces.push(`${dirName}@${step}px`); break; }
      }
    }
    if (bounces.length) { console.log(`FAIL ${label}: accidental-bounce risk (${bounces.join(", ")})`); problems++; }
  }
}
if (problems === 0) console.log(`OK — every exit in ${storyPath} checks out.`);
else { console.log(`\n${problems} problem(s) found.`); process.exit(1); }
