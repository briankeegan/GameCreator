#!/usr/bin/env node
// CAN THE PLAYER ACTUALLY WALK ONTO EVERY DOOR? Asked of the running game.
//
//   NODE_PATH="$(npm root -g)" node .github/scripts/check_door_reach.mjs games/the-game
//
// WHY THIS EXISTS SEPARATELY FROM remap_doors.py. That tool measures against
// the room's walk MASK, which is built from the floor plate — so it knows
// where the floor is and knows nothing about the props standing on it. It used
// that to push the Library's garden door out to y=0, which is inside the
// bookcases: on the floor by the mask, unreachable in the game. Every static
// answer about reachability in this codebase has been wrong at least once for
// exactly this reason.
//
// So this boots the real game, floods each room from where the player actually
// arrives using the GAME's own canStand (props, floor, everything), and reports
// two numbers per door:
//
//   reach  — how many standable positions the player can WALK TO that touch
//            the trigger. Zero means the door is decoration.
//   depth  — the deepest overlap achievable from one of those positions, in its
//            narrower axis. A door you can only graze by a pixel is a dead end
//            in play: holding a direction walks straight past it. The Arena's
//            old rectangle scored 1.
//
// Exit code 1 if any door is unreachable or below MIN_DEPTH.
import path from "path";

const MIN_DEPTH = 6;   // must match remap_doors.py's MIN_ENTRY_DEPTH

// A ROOM HAS A WALL, AND YOU CANNOT WALK INTO IT.
//
// Found by looking at where a door band had been pushed: the Library's garden
// door sat at y=0, and it was reachable — because the player can walk all the
// way to the top of that room, into the bookcases. Same in the Lounge, over
// the bar and through the back wall. The floor plates for these rooms cover
// 77-89% of the frame, so the walk mask calls the wall band floor, and the
// wall props either carry no footprint or one that does not span them.
//
// Measured, as the fraction of the frame's height above which nothing should
// be standable. The painted rooms put their floor's top edge at y=103-105 of
// 200 (51-53%); the three-pass standard says the floor fills the LOWER HALF.
// A room whose player can reach the top 15% of the frame has no wall at all,
// so that is the line — every correct room here clears it by 3x, and every
// room that fails is failing for the same reason.
const WALL_BAND = 0.15;

const gameDir = process.argv[2] || "games/the-game";
const { serveRepo, launchBrowser, freshPage } = await import(
  path.resolve(".github/scripts/browser_test_harness.js")
).then((m) => m.default || m);

const server = await serveRepo();
const url = `http://127.0.0.1:${server.address().port}/${gameDir}/index.html`;
const browser = await launchBrowser();
const errors = [];

const probe = await freshPage(browser, url, errors);
const rooms = await probe.evaluate(() => Object.keys(window.NEWSEY_STORY.ROOMS));
await probe.close();

const problems = [];
for (const room of rooms) {
  const page = await freshPage(browser, url, errors);
  await page.goto(url);
  await page.evaluate((r) => {
    const s = window.NewseySaves.blank();
    s.introSeen = true;
    s.room = r;
    window.NewseySaves.write(1, s);
  }, room);
  await page.reload();
  await page.waitForTimeout(400);
  await page.click("#titleStart");
  await page.waitForTimeout(150);
  await page.click(".file-slot >> nth=0");
  await page.waitForTimeout(700);
  // The walk mask is a PNG; flooding before it loads makes a room look like
  // solid wall. The player is by definition standing, so wait until the game
  // agrees they are.
  await page
    .waitForFunction(
      () => {
        const D = window.__newseyDebug;
        return D && D.canStand(D.player.x, D.player.y);
      },
      { timeout: 8000 }
    )
    .catch(() => {});

  const rows = await page.evaluate((rid) => {
    const D = window.__newseyDebug, R = window.NEWSEY_STORY.ROOMS[rid];
    const W = 320, H = 200, PW = 14, PH = 18, STEP = 1;
    const k = (x, y) => y * W + x;
    const sx = Math.round(D.player.x), sy = Math.round(D.player.y);
    const seen = new Set([k(sx, sy)]), q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx > W - PW || ny > H - PH) continue;
        if (seen.has(k(nx, ny)) || !D.canStand(nx, ny)) continue;
        seen.add(k(nx, ny));
        q.push([nx, ny]);
      }
    }
    let highest = H;
    for (const key of seen) { const y = (key - (key % W)) / W; if (y < highest) highest = y; }
    const exits = (R.exits || []).map((e) => {
      let reach = 0, depth = 0;
      for (const key of seen) {
        const x = key % W, y = (key - x) / W;
        const ox = Math.min(x + PW, e.x + e.w) - Math.max(x, e.x);
        const oy = Math.min(y + PH, e.y + e.h) - Math.max(y, e.y);
        if (ox > 0 && oy > 0) { reach++; depth = Math.max(depth, Math.min(ox, oy)); }
      }
      return { link: e.link, to: e.to, w: e.w, h: e.h, reach, depth };
    });
    return { exits, highest };
  }, room);

  const bandTop = Math.round(200 * WALL_BAND);
  if (rows.highest < bandTop) {
    console.log(`${room.padEnd(13)} ${"— wall band —".padEnd(11)}    player can walk up to y=${rows.highest} ` +
                `(nothing should be standable above y=${bandTop})   <-- WALKS INTO THE WALL`);
    problems.push(`${room}: the player can walk to y=${rows.highest}, inside the room's own wall`);
  }
  for (const r of rows.exits) {
    const bad = r.reach === 0 || r.depth < MIN_DEPTH;
    console.log(
      `${room.padEnd(13)} ${r.link.padEnd(11)} -> ${(r.to || "?").padEnd(13)} ` +
      `${String(r.w).padStart(2)}x${String(r.h).padEnd(2)}  reach ${String(r.reach).padStart(5)}  ` +
      `depth ${String(r.depth).padStart(2)}px${bad ? "   <-- CANNOT BE WALKED ONTO" : ""}`
    );
    if (bad) problems.push(`${room} -> ${r.to} (${r.link}): reach ${r.reach}, depth ${r.depth}px`);
  }
  await page.close();
}

await browser.close();
server.close();

if (problems.length) {
  console.log(`\n${problems.length} door(s) the player cannot walk onto:`);
  for (const p of problems) console.log("  " + p);
  console.log(
    "\nA trigger on the walk mask is not the same as a trigger a player can reach, " +
    "and a floor plate that fills its frame is not a floor: props stand on it and the " +
    "mask does not know about them. See docs/DOOR_STANDARD.md."
  );
  process.exit(1);
}
console.log("\nOK — every door can be walked onto.");
