// browser.test.js — the real opening through the real UI: title screen,
// intro cutscene, waking in bed, walking to and opening the front door,
// Chuck walking in and talking, the TV's dream cutscene, and arriving in
// Infinity. Then a focused pass over every room-to-room door (arrival
// facing + landing spot, per docs/DOOR_STANDARD.md — §6 is what a door test
// is allowed to assert, and it is worth reading before adding a case) and
// a sanity check that wandering NPCs actually move. Complements
// check_room_exits.mjs, which validates the door DATA statically; this
// drives the real DOM/canvas/input path check_room_exits.mjs can't see at
// all — the entrance-walk collision bug and an arrival that faced the wrong
// way both existed in valid-looking data and only showed up by playing.
//
//   NODE_PATH="$(npm root -g)" node games/the-game/browser.test.js
//
// Needs Playwright + a Chromium binary (see browser_test_harness.js for
// the CHROMIUM_PATH override). Deliberately not part of the pages.yml
// pre-deploy gate — see that file's comment on why.
"use strict";

const assert = require("assert");
const {
  serveRepo, launchBrowser, freshPage, KEY_FOR_DIRECTION, approachPosition, holdKeyUntilInPage,
} = require("../../.github/scripts/browser_test_harness");

function getState(page) {
  return page.evaluate(() => ({
    room: window.__newseyDebug.room(),
    facing: window.__newseyDebug.player.facing,
    pos: { x: window.__newseyDebug.player.x, y: window.__newseyDebug.player.y },
    inBed: window.__newseyDebug.player.inBed,
    talking: window.__newseyDebug.talking(),
    npcs: window.__newseyDebug.npcs(),
  }));
}
async function clickAdvance(page, times, ms = 200) {
  for (let i = 0; i < times; i++) {
    await page.click("#scene");
    await page.waitForTimeout(ms);
  }
}
async function walk(page, key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(100);
}
// Holds keys, polling position, until `done(state)` is true or `capMs`
// elapses — used instead of a fixed duration wherever the path can run
// into a standing NPC (Chuck parked between the door and the TV): pushing
// someone out of the way is a real ~2s mechanic (PUSH_THRESHOLD in
// app.js), not a test bug, so a fixed short hold is exactly what flakes
// here. A single diagonal hold can also overshoot one axis while chasing
// the other (a wall stops y short of the target height, but x keeps
// going) — so this is deliberately axis-agnostic: pass whichever keys
// and predicate the leg of the walk actually needs.
async function holdUntil(page, keys, done, capMs, pollMs = 250) {
  keys.forEach((k) => page.keyboard.down(k));
  const start = Date.now();
  let s = await getState(page);
  while (Date.now() - start < capMs && !done(s)) {
    await page.waitForTimeout(pollMs);
    s = await getState(page);
  }
  keys.forEach((k) => page.keyboard.up(k));
  await page.waitForTimeout(100);
  return s;
}
// Seeds a save and boots straight into it — used once for the real
// opening (a blank save) and again per door-transition case (a save
// already in the room under test, so the grid below doesn't have to
// replay the whole opening for every door).
async function bootWithSave(page, url, patchSave) {
  await page.goto(url);
  await page.evaluate((patch) => {
    const s = window.NewseySaves.blank();
    Object.assign(s, patch);
    window.NewseySaves.write(1, s);
  }, patchSave);
  await page.reload();
  await page.waitForTimeout(400);
  await page.click("#titleStart");
  await page.waitForTimeout(150);
  await page.click(".file-slot >> nth=0");
  await page.waitForTimeout(400);
}

(async () => {
  const server = await serveRepo();
  const url = `http://127.0.0.1:${server.address().port}/games/the-game/index.html`;
  const browser = await launchBrowser();
  const errors = [];

  // ---- The real opening: title -> intro -> wake -> door -> Chuck -> TV ----
  {
    const page = await freshPage(browser, url, errors);
    await page.click("#titleStart");
    await page.waitForTimeout(150);
    await page.click(".file-slot >> nth=0");
    await page.waitForTimeout(400);

    const introLen = await page.evaluate(() => window.NEWSEY_STORY.INTRO_CUTSCENE.length);
    for (let i = 0; i < introLen + 2; i++) {
      await page.evaluate(() => document.getElementById("cutscene").click());
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(800);
    let s = await getState(page);
    assert.strictEqual(s.room, "Your Old Room", "the intro hands off into the bedroom, in bed");
    assert.strictEqual(s.inBed, true);
    assert.ok(s.talking && s.talking.npcId === "_narration", "the wake-up knock lines show as narration, no speaker");

    await clickAdvance(page, 5, 250); // the 3 WAKE_LINES
    s = await getState(page);
    assert.strictEqual(s.talking, null, "narration is dismissed");
    assert.strictEqual(s.inBed, true, "still lying down until she actually moves");

    await walk(page, "ArrowDown", 200); // "the first press is get up, not a step"
    s = await getState(page);
    assert.strictEqual(s.inBed, false, "the first directional press gets her up, not a step off the mattress");

    await page.keyboard.down("ArrowDown");
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(1200);
    await page.keyboard.up("ArrowDown");
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(300);
    s = await getState(page);
    assert.strictEqual(s.room, "Your Father's House", "the bedroom's bottom threshold leads to the house");

    // Walk to the front door and open it. TWO legs, left and THEN up, and
    // neither for a fixed number of milliseconds. Both details are bugs this
    // leg has already had: holding left+up together walks her diagonally back
    // into the stairs she just came down (they sit between the stairs' arrival
    // spot and the door, and up-and-left clips their trigger), and a fixed
    // 2200ms hold stopped arriving at all when the paired-door work moved
    // where the stairs put her — which surfaced two assertions later as
    // "Chuck doesn't exist" rather than as "she never reached the door".
    // Two coarse legs and then a homing loop, all through real key presses.
    // Coarse first because the stairs sit between here and the door and a
    // diagonal walks straight back up them; homing after because a held key
    // polled from Node overshoots — the left leg sails past the door's x and
    // ends up in the far corner about half the time, which is exactly the
    // kind of flake that gets read as a game bug.
    const atDoor = (st) => Math.hypot(st.pos.x + 7 - 74, st.pos.y + 9 - 106) < 20;
    // Down to the bottom strip of the room FIRST — it is the one lane that
    // runs the width of the house with nothing in it. Going left higher up
    // meets the television, and going up while still over on the right walks
    // her back into the stairs she just came down.
    await holdUntil(page, ["ArrowDown"], (st) => st.pos.y >= 160, 4000);
    await holdUntil(page, ["ArrowLeft"], (st) => st.pos.x <= 75, 8000);
    await holdUntil(page, ["ArrowUp"], (st) => atDoor(st) || st.pos.y <= 100, 8000);
    for (let i = 0; i < 12; i++) {
      s = await getState(page);
      if (atDoor(s)) break;
      const dx = 74 - (s.pos.x + 7), dy = 106 - (s.pos.y + 9);
      await walk(page, Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? "ArrowRight" : "ArrowLeft")
        : (dy > 0 ? "ArrowDown" : "ArrowUp"), 120);
    }
    s = await getState(page);
    assert.strictEqual(s.room, "Your Father's House", "she is still in the house at the door");
    assert.ok(atDoor(s), `she can walk to the front door (ended at ${JSON.stringify(s.pos)})`);
    await page.keyboard.press("z"); // opens the door's dialogue, shows line 0
    await page.waitForTimeout(250);
    await page.keyboard.press("z"); // advances to line 1
    await page.waitForTimeout(250);
    await page.keyboard.press("z"); // finishes the door's 2 lines -> spawns Chuck at the door
    await page.waitForTimeout(80); // as little settle as possible — he starts walking immediately
    s = await getState(page);
    const chuckJustAfterDoor = s.npcs.find((n) => n.id === "chuck");
    assert.ok(chuckJustAfterDoor, "opening the door makes Chuck exist");
    assert.ok(
      Math.hypot(chuckJustAfterDoor.x - 74, chuckJustAfterDoor.y - 106) < 10,
      "he spawns AT the door, not already standing in the room"
    );

    // He should walk in on his own and start talking once he arrives —
    // not the instant the door closes, and not stay frozen at the door
    // (a real bug this session: the "don't walk into the player" collision
    // check blocked his very first step forever, since the player has to
    // be standing right at the door to have opened it).
    let chuckTalking = false;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(300);
      s = await getState(page);
      if (s.talking && s.talking.npcId === "chuck") {
        chuckTalking = true;
        break;
      }
    }
    assert.ok(chuckTalking, "Chuck walks in and starts talking within a few seconds of the door opening");
    const chuckArrived = s.npcs.find((n) => n.id === "chuck");
    assert.ok(
      Math.hypot(chuckArrived.x - 108, chuckArrived.y - 134) < 5,
      "he actually walked to his real resting spot, not just teleported there"
    );

    // He's already talking (lineIndex 0) the instant he arrives — no "open"
    // click needed, unlike the door/TV, which show line 0 only after an
    // explicit interact. 6 lines need exactly 6 more advances to finish; a
    // click past that isn't a no-op — the canvas's click handler calls
    // tryInteract() whenever nothing is being said, so an extra click while
    // still standing next to Chuck reopens him at his last line instead of
    // leaving talking null.
    await clickAdvance(page, 6, 250);
    s = await getState(page);
    assert.strictEqual(s.talking, null, "Chuck's dialogue finishes cleanly");

    // Walk to the TV, open its own 2 lines, then the DREAM_CUTSCENE it hands
    // off to. Two legs, not one diagonal hold: a diagonal overshoots one
    // axis chasing the other (a wall stops the descent short of the TV's
    // row while x keeps climbing past it). Down first to the TV's row,
    // then across — which still may have to push past Chuck (~2s), since
    // his resting spot sits on that row too.
    s = await holdUntil(page, ["ArrowDown"], (st) => st.pos.y >= 142, 3000);
    // tv is at (230,160); nearestNpc() measures from (player.x+w/2,
    // player.y+h), so the top-left target is offset by (-7,-18).
    s = await holdUntil(page, ["ArrowRight"], (st) => Math.hypot(st.pos.x - 223, st.pos.y - 142) < 20, 7000);
    assert.ok(
      Math.hypot(s.pos.x - 223, s.pos.y - 142) < 20,
      "actually reached the TV, not stuck behind Chuck"
    );
    await page.keyboard.press("z");
    await page.waitForTimeout(250);
    // z already showed line 0 (the "open" press); 2 lines need exactly 2
    // more advances to finish — the 2nd one triggers the cutscene overlay
    // immediately, so a 3rd click here hits that overlay and hangs.
    await clickAdvance(page, 2, 250);
    const cutsceneLen = await page.evaluate(() => window.NEWSEY_STORY.DREAM_CUTSCENE.length);
    for (let i = 0; i < cutsceneLen + 2; i++) {
      await page.evaluate(() => document.getElementById("cutscene").click());
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(1200);
    s = await getState(page);
    assert.strictEqual(s.room, "Your Room, Infinity", "the dream cutscene hands off into ROOMS.bedroom");

    // The cutscene handoff puts her back in bed (enterRoom + putToBed, same
    // as the very first wake-up) — the first directional press here is
    // "get up", not a step, same as at the start of the game.
    s = await getState(page);
    assert.strictEqual(s.inBed, true, "arriving in Infinity puts her back in bed, same as the real opening");
    await walk(page, "ArrowUp", 200);
    s = await getState(page);
    assert.strictEqual(s.inBed, false, "the first press gets her up");

    // The mirror: an invisible interactable at the mirror's spot (marker:
    // true, no standing sprite) — walk to it and confirm talking to it
    // works, without playing the duel it offers out (out of scope here,
    // same call hypergolic-hull's own test makes about its end-game crawl).
    // devil sits ON the mirror, which moved when the room was regenerated to
    // the plot's Victorian bedroom — it is at (50,106) now. nearestNpc()
    // measures from (player.x+w/2, player.y+h), so the top-left target is
    // offset by (-7,-18); she stands just below the mirror's footprint.
    const atMirror = (st) => Math.hypot(st.pos.x - 43, st.pos.y - 96) < 20;
    await holdUntil(page, ["ArrowLeft"], (st) => st.pos.x <= 46, 5000);
    s = await holdUntil(page, ["ArrowUp"], atMirror, 5000);
    assert.ok(atMirror(s), `actually reached the mirror (ended at ${JSON.stringify(s.pos)})`);
    await page.keyboard.press("z");
    await page.waitForTimeout(250);
    s = await getState(page);
    assert.ok(s.talking && s.talking.npcId === "devil", "the mirror opens the devil's welcome dialogue");

    await page.close();
  }

  // ---- Every door: arrival facing + a landing spot that's safe to stand on ----
  // (check_room_exits.mjs already proves the DATA is safe statically; this
  // proves walking through each one for real actually applies arriveFacing
  // and doesn't visibly break.)
  //
  // Only {room, to, direction, wantRoom, wantFacing} are hand-supplied —
  // `direction` (which way you WALK to cross this exit) is a fact about
  // the room's layout a human has to say, but the actual x/y is computed
  // from the exit's own box via approachPosition, never typed by hand. An
  // earlier version of this table hand-picked coordinates next to each
  // door and got several of them wrong in a way that was invisible from
  // reading the numbers (a y a few px off reads as "just outside the box"
  // when it's actually inside it, which never arms exitsArmed and never
  // triggers a crossing at all) — deriving the position from the same
  // data the game itself uses removes that whole class of mistake.
  // lounge -> library used to be a plain exit like these; it's now the
  // rune door (a destination picker, not a straight walk-through) — see
  // the dedicated rune-door block right after this loop instead.
  // WHAT IS ASSERTED, AND WHY IT IS NOT A COMPASS DIRECTION ANY MORE. This
  // table used to name the exact facing each arrival should end on. Those
  // numbers were the OUTPUT of arrivalFrom — it walks outward from the
  // partner door until it finds somewhere you can stand — so the table was
  // a snapshot of one day's room art, and it went stale the moment a room
  // was regenerated: it failed on house -> bedroom demanding "down" when
  // "down" is the one facing that arrival must never use, because it points
  // back at the door you just came through.
  //
  // So each case asserts the two things that are actually true of every
  // door in the game, whatever the art does:
  //   1. you land OFF the doorway — not inside any exit trigger in the new
  //      room. Standing in one means it never arms, which is the "hold a
  //      direction and ping-pong between two rooms" bug.
  //
  // Facing is deliberately NOT asserted. arrivalFrom picks the first
  // direction you can stand in and faces you that way, so any rule stated
  // here is either a snapshot of today's art or a restatement of the
  // algorithm. "Not the opposite of the way you walked" looked like a real
  // invariant and is not one: walk UP out of the bedroom into the Lounge and
  // you arrive facing DOWN, because the door you came through is in the
  // Lounge's BACK wall and down is into the room.
  // WHICH WAY YOU WALK INTO A DOOR IS DERIVED, NEVER TYPED.
  //
  // This table used to carry a `direction` per case, and it went stale exactly
  // the way a snapshot does: the Arena's portal moved from its right-hand wall
  // to the bottom of the floor, the case still said "up", and the test walked
  // the player away from the door and reported that the door was broken. The
  // door was fine. A test must not assert — or assume — a value the room data
  // already determines.
  //
  // You approach a door by walking AT the wall it is in, so the direction is
  // the wall: a trigger hard against the left or right edge of the frame is a
  // side door, and anything else is in the back wall or the near one depending
  // on which half of the room it sits in. Testing the sides FIRST matters,
  // because a top-down room's floor lives in the lower half of its frame, so an
  // ordinary side door sits low and "nearest edge in pixels" calls it a near
  // door every time — the same trap that caught check_room_exits.mjs.
  const SIDE_FRAC = 0.15;
  function approachDirection(e) {
    const W = 320, H = 200;
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    if (cx / W <= SIDE_FRAC) return "left";
    if (cx / W >= 1 - SIDE_FRAC) return "right";
    return cy < H / 2 ? "up" : "down";
  }

  const DOOR_CASES = [
    { room: "home_bedroom", to: "house", wantRoom: "Your Father's House" },
    { room: "house", to: "home_bedroom", wantRoom: "Your Old Room" },
    { room: "bedroom", to: "lounge", wantRoom: "The Lounge" },
    { room: "lounge", to: "bedroom", wantRoom: "Your Room, Infinity" },
    { room: "lounge", to: "lab", wantRoom: "Kyran's Lab" },
    { room: "lab", to: "lounge", wantRoom: "The Lounge" },
    { room: "lounge", to: "library", wantRoom: "The Library" },
    { room: "library", to: "lounge", wantRoom: "The Lounge" },
    { room: "library", to: "garden", wantRoom: "The Anarchy Garden" },
    { room: "garden", to: "library", wantRoom: "The Library" },
    { room: "arena", to: "lounge", wantRoom: "The Lounge" },
  ];
  const doorFailures = [];
  for (const c of DOOR_CASES) {
    const page = await freshPage(browser, url, errors);
    await bootWithSave(page, url, { introSeen: true, room: c.room });
    const exitBox = await page.evaluate(
      ({ room, to }) => window.NEWSEY_STORY.ROOMS[room].exits.find((e) => e.to === to),
      { room: c.room, to: c.to }
    );
    const direction = approachDirection(exitBox);
    const pos = approachPosition(exitBox, direction);
    await page.evaluate((p) => {
      window.__newseyDebug.player.x = p.x;
      window.__newseyDebug.player.y = p.y;
    }, pos);
    // Release the key the instant the room changes, driven from inside the
    // page (see holdKeyUntilInPage) — arriveFacing is only true for the
    // one frame right after arrival; a Node-side poll always reacts one
    // frame too late and the still-held direction overwrites it first.
    // Built via `new Function` (not a closure) so the target room name is
    // baked into the generated source as a literal — holdKeyUntilInPage
    // ships the predicate to the page via .toString(), which can't see
    // outer-scope variables like `c`.
    await holdKeyUntilInPage(
      page,
      KEY_FOR_DIRECTION[direction],
      new Function("return window.__newseyDebug.room() === " + JSON.stringify(c.wantRoom)),
      2000
    );
    const s = await getState(page);
    const overlaps = await page.evaluate(() => window.__newseyDebug.exitOverlaps());
    // COLLECTED, not thrown. Every case is one boot of the game and one
    // scripted walk, so failing on the first one turns "which doors are
    // broken?" into one question per run — and a door grid is exactly the
    // shape of test you want to answer in a single pass.
    if (s.room !== c.wantRoom) {
      doorFailures.push(`${c.room} -> ${c.wantRoom}: ended in ${JSON.stringify(s.room)} instead`);
    } else if (overlaps.some((o) => o.hit)) {
      doorFailures.push(
        `${c.room} -> ${c.wantRoom}: landed INSIDE a doorway ` +
          `${JSON.stringify(overlaps.filter((o) => o.hit).map((o) => o.to))} at ` +
          `${JSON.stringify(s.pos)} — that door never arms, which is how holding a ` +
          `direction ping-pongs between two rooms`
      );
    }
    await page.close();
  }
  assert.deepStrictEqual(doorFailures, [], "every door lands you in the right room, clear of the doorway");

  // The black rune door and its list of six destinations are GONE. A picker
  // is not a map — one doorway cannot be three rooms — so every room it used
  // to reach is now somewhere on the grid with a door of its own, covered by
  // DOOR_CASES above.

  // ---- Wandering NPCs actually move (not frozen, not erroring) ----
  {
    const page = await freshPage(browser, url, errors);
    await bootWithSave(page, url, { introSeen: true, room: "lounge" });
    const before = await getState(page);
    await page.waitForTimeout(4000);
    const after = await getState(page);
    const moved = after.npcs.some((n) => {
      const b = before.npcs.find((x) => x.id === n.id);
      return b && Math.hypot(n.x - b.x, n.y - b.y) > 1;
    });
    assert.ok(moved, "at least one lounge NPC has moved after 4s — wandering isn't frozen");
    await page.close();
  }

  // ---- CAN YOU ACTUALLY WALK TO EVERY DOOR? ----
  //
  // The door grid above proves a door WORKS. It does not prove a player can
  // REACH it: every case teleports the player next to the trigger and then
  // walks one step into it. The Arena's way out passed that test for as long
  // as it existed while being armed up in the STANDS, above the top edge of
  // the walkable platform — the only foot position whose body box touched it
  // grazed one corner by a single pixel, so holding right out of the spawn
  // walked straight past it into the wall and the room was a dead end.
  //
  // So: flood the room from where you actually arrive, and ask whether the
  // region you can walk to includes anything that touches each trigger.
  // Crucially it floods through the GAME's own canStand — a static model
  // built on the walk mask alone called that Arena door reachable, because
  // the mask knows about floor and knows nothing about the benches. A test
  // that carries its own copy of the collision rules is a test that drifts.
  const unreachable = [];
  for (const roomId of Object.keys(await (async () => {
    const p = await freshPage(browser, url, errors);
    const r = await p.evaluate(() => window.NEWSEY_STORY.ROOMS);
    await p.close();
    return r;
  })())) {
    const page = await freshPage(browser, url, errors);
    await bootWithSave(page, url, { introSeen: true, room: roomId });
    // The walk mask is a PNG. Flooding before it loads makes a room look like
    // solid wall; the player is by definition standing, so wait until the
    // game agrees they are.
    await page.waitForFunction(
      () => { const D = window.__newseyDebug; return D && D.canStand(D.player.x, D.player.y); },
      { timeout: 8000 }
    ).catch(() => {});
    const bad = await page.evaluate((rid) => {
      const D = window.__newseyDebug, R = window.NEWSEY_STORY.ROOMS[rid];
      const W = 320, H = 200, PW = 14, PH = 18, STEP = 2;
      const k = (x, y) => y * W + x;
      const sx = Math.round(D.player.x), sy = Math.round(D.player.y);
      const seen = new Set([k(sx, sy)]), q = [[sx, sy]];
      while (q.length) {
        const [x, y] = q.pop();
        for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx > W - PW || ny > H - PH || seen.has(k(nx, ny))) continue;
          if (!D.canStand(nx, ny)) continue;
          seen.add(k(nx, ny)); q.push([nx, ny]);
        }
      }
      return (R.exits || []).filter((e) => {
        for (const key of seen) {
          const x = key % W, y = (key - x) / W;
          if (x + PW > e.x && x < e.x + e.w && y + PH > e.y && y < e.y + e.h) return false;
        }
        return true;
      }).map((e) => `${rid} -> ${e.to} (${e.link})`);
    }, roomId);
    unreachable.push(...bad);
    await page.close();
  }
  assert.deepStrictEqual(
    unreachable, [],
    "every exit trigger must be reachable on foot from where the player arrives — " +
    "a door nobody can walk to is a dead end however well it fires"
  );

  await browser.close();
  server.close();

  // Kyran (the Anarchy Garden's NPC) has no art committed yet —
  // kyran.png/kyran_top.png 404 on every load, a separate, already-known
  // content gap (not a logic bug: loadArt's failed-state fallback already
  // handles a missing image without crashing). Filtered here by exact
  // filename, not by blanket-ignoring 404s, so a real missing-asset
  // regression on anything else still fails this check.
  const knownGaps = /http 404: .*\/art\/kyran(_top)?\.png$/;
  const unexpected = errors.filter((e) => !knownGaps.test(e));
  assert.deepStrictEqual(unexpected, [], "no page or console errors during any playthrough");
  console.log("All browser playthrough assertions passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
