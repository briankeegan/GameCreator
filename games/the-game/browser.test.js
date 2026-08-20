// browser.test.js — the real opening through the real UI: title screen,
// intro cutscene, waking in bed, walking to and opening the front door,
// Chuck walking in and talking, the TV's dream cutscene, and arriving in
// Infinity. Then a focused pass over every room-to-room door (arrival
// facing + landing spot, per the EXIT / DOOR CONVENTION in story.js) and
// a sanity check that wandering NPCs actually move. Complements
// check_room_exits.mjs, which validates the door DATA statically; this
// drives the real DOM/canvas/input path check_room_exits.mjs can't see at
// all — the entrance-walk collision bug and the missing arriveFacing both
// existed in valid-looking data and only showed up by actually playing.
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

    // Walk to the front door and open it.
    await page.keyboard.down("ArrowLeft");
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(2200);
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(100);
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

    await clickAdvance(page, 7, 250); // Chuck's 6 lines
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
    // devil is at (70,102); nearestNpc() measures from (player.x+w/2,
    // player.y+h), so the top-left target is offset by (-7,-18).
    s = await holdUntil(page, ["ArrowLeft", "ArrowUp"], (st) => Math.hypot(st.pos.x - 63, st.pos.y - 84) < 20, 4000);
    assert.ok(Math.hypot(s.pos.x - 63, s.pos.y - 84) < 20, "actually reached the mirror");
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
  const DOOR_CASES = [
    { room: "home_bedroom", to: "house", direction: "down", wantRoom: "Your Father's House", wantFacing: "down" },
    { room: "house", to: "home_bedroom", direction: "up", wantRoom: "Your Old Room", wantFacing: "down" },
    { room: "bedroom", to: "lounge", direction: "up", wantRoom: "The Lounge", wantFacing: "right" },
    { room: "lounge", to: "bedroom", direction: "up", wantRoom: "Your Room, Infinity", wantFacing: "left" },
    { room: "library", to: "lounge", direction: "up", wantRoom: "The Lounge", wantFacing: "right" },
    { room: "arena", to: "lounge", direction: "up", wantRoom: "The Lounge", wantFacing: "right" },
    { room: "garden", to: "lounge", direction: "down", wantRoom: "The Lounge", wantFacing: "down" },
    { room: "lab", to: "lounge", direction: "up", wantRoom: "The Lounge", wantFacing: "down" },
  ];
  for (const c of DOOR_CASES) {
    const page = await freshPage(browser, url, errors);
    await bootWithSave(page, url, { introSeen: true, room: c.room });
    const exitBox = await page.evaluate(
      ({ room, to }) => window.NEWSEY_STORY.ROOMS[room].exits.find((e) => e.to === to),
      { room: c.room, to: c.to }
    );
    const pos = approachPosition(exitBox, c.direction);
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
      KEY_FOR_DIRECTION[c.direction],
      new Function("return window.__newseyDebug.room() === " + JSON.stringify(c.wantRoom)),
      2000
    );
    const s = await getState(page);
    assert.strictEqual(s.room, c.wantRoom, `${c.room} -> ${c.wantRoom}: actually changes room`);
    assert.strictEqual(s.facing, c.wantFacing, `${c.room} -> ${c.wantRoom}: arrives facing ${c.wantFacing}`);
    await page.close();
  }

  // ---- The rune door: accidental first trip, then the destination picker ----
  // check_room_exits.mjs already proves RUNE_DOOR's own data is right
  // (every unlocked destination has an arriveFacing) — this exists because
  // that alone wasn't enough: the picker's click handler read dest.to and
  // dest.arriveAt but had never been wired to actually pass dest.arriveFacing
  // through to enterRoom, so the data being correct never mattered. Only a
  // real click-through could have caught that.
  {
    const page = await freshPage(browser, url, errors);
    await bootWithSave(page, url, { introSeen: true, room: "lounge" });
    const runeBox = await page.evaluate(() => window.NEWSEY_STORY.ROOMS.lounge.exits.find((e) => e.rune));
    const pos = approachPosition(runeBox, "down");
    await page.evaluate((p) => {
      window.__newseyDebug.player.x = p.x;
      window.__newseyDebug.player.y = p.y;
    }, pos);
    // The first push (runeDoorLearned not set yet) sends you to the
    // Garden by accident, with narration explaining it — never the picker.
    await holdKeyUntilInPage(
      page,
      "ArrowDown",
      new Function("return window.__newseyDebug.room() === " + JSON.stringify("The Anarchy Garden")),
      2000
    );
    const s1 = await getState(page);
    assert.strictEqual(s1.room, "The Anarchy Garden", "the first, unlearned push through the rune door lands in the Garden by accident");
    assert.ok(s1.talking && s1.talking.npcId === "_narration", "…with narration explaining the accident");
    await page.close();
  }
  {
    const page = await freshPage(browser, url, errors);
    await bootWithSave(page, url, { introSeen: true, room: "lounge", flags: { runeDoorLearned: true } });
    const runeBox = await page.evaluate(() => window.NEWSEY_STORY.ROOMS.lounge.exits.find((e) => e.rune));
    const pos = approachPosition(runeBox, "down");
    await page.evaluate((p) => {
      window.__newseyDebug.player.x = p.x;
      window.__newseyDebug.player.y = p.y;
    }, pos);
    // Once learned, crossing opens the destination picker instead of
    // moving on its own — wait for the panel, not a room change.
    await holdKeyUntilInPage(page, "ArrowDown", new Function("return !document.getElementById('runeDoor').hidden"), 2000);
    await page.click("#runeList >> text=Library");
    await page.waitForTimeout(250);
    const s2 = await getState(page);
    assert.strictEqual(s2.room, "The Library", "picking Library from the rune door actually goes there");
    assert.strictEqual(s2.facing, "down", "…and applies its arriveFacing");
    await page.close();
  }

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
