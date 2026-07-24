// browser.test.js — the tutorial campaign through the real UI (canvas
// clicks + action buttons): Sector 1's Shockwave lesson with locked
// actions, the Next Sector handoff, Sector 2's unlock, the loss branch, and
// restart. Complements engine.test.js, which covers the movement/combat
// rules headlessly on pinned fixture boards.
//
// Needs Playwright + a Chromium binary:
//   NODE_PATH="$(npm root -g)" node games/hypergolic-hull/browser.test.js
// Set CHROMIUM_PATH if Chromium isn't at the default /opt/pw-browsers/chromium.
"use strict";

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

function serveRepo() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const filePath = path.join(REPO_ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Click the hex at axial (q,r) after arming the given action mode, using the
// app's own geometry (the canvas now resizes itself to fit each board).
// Sublight has no button of its own — a plain move or route-preview click
// works regardless of which mode (if any) happens to be armed.
async function clickHex(page, mode, hex) {
  if (mode !== "sublight") await page.click(`[data-mode="${mode}"]`);
  const box = await page.locator("#board").boundingBox();
  const c = await page.evaluate(({ q, r }) => window.__hhHexCenter(q, r), { q: hex.q, r: hex.r });
  await page.mouse.click(box.x + c.x, box.y + c.y);
}

function getState(page) {
  return page.evaluate(() => window.__hhState);
}

function pickStepToward(page, goalExpr) {
  return page.evaluate((expr) => {
    const E = window.HypergolicEngine;
    const st = window.__hhState;
    const goal =
      expr === "exit"
        ? st.exitPos
        : expr === "wormhole"
          ? st.wormholePos
          : expr === "outpost"
            ? st.outpostPos
            : st.enemies.find((e) => e.alive);
    // Turn Model v2 play: prefer steps that don't END inside a living
    // enemy's reach (a MOVE turn doesn't defend you) — fall back to any
    // legal step when everything's dangerous.
    const legal = E.legalSublightTargets(st);
    const safe = legal.filter((cand) => !st.enemies.some((e) => e.alive && E.isAdjacent(e, cand)));
    const pool = safe.length ? safe : legal;
    return pool.reduce(
      (best, cand) => {
        const d = E.hexDistance(cand, goal);
        return !best || d < best.d ? { to: cand, d } : best;
      },
      null
    ).to;
  }, goalExpr);
}

// Play a turn the v2 way: FIRE if anything's in reach of an armed weapon
// (the button only lights up when a volley would land), otherwise take a
// safe step toward the goal.
async function playTurnToward(page, goalExpr) {
  if (!(await page.locator("#fireBtn").isDisabled())) {
    await page.click("#fireBtn");
    return;
  }
  await clickHex(page, "sublight", await pickStepToward(page, goalExpr));
}

// The end-of-run/sector overlay is held back until animations finish.
function waitForOverlay(page) {
  return page.waitForFunction(() => !document.getElementById("runOverlay").hidden);
}

async function walkToExit(page) {
  let s = await getState(page);
  for (let i = 0; i < 30 && s.status === "playing"; i++) {
    await playTurnToward(page, "exit");
    s = await getState(page);
  }
  return s;
}

async function walkToOutpost(page) {
  let s = await getState(page);
  // Bounded like walkToExit — a greedy nearest-hex walk has no lookahead,
  // so a chasing enemy (e.g. Sector 2's Cruiser) repositioning every turn
  // can stall it against an obstacle indefinitely otherwise.
  for (let i = 0; i < 30 && s.status === "playing" && !(s.playerPos.q === s.outpostPos.q && s.playerPos.r === s.outpostPos.r); i++) {
    await playTurnToward(page, "outpost");
    s = await getState(page);
  }
  return s;
}

// Claims an Outpost offer by matching its button text (see updateOutpost —
// `${offer.label} — ${offer.cost} salvage`), rather than hardcoding a
// selector, since the offers are built dynamically from Engine.outpostOffers.
async function claimOutpostOffer(page, labelSubstring) {
  await page.click(`#outpostOffers button:has-text("${labelSubstring}")`);
  return getState(page);
}

// All system on/off switches live on the Ship screen now — open it, flip
// the one system, close it again.
async function setShipSystem(page, key, on) {
  await page.click("#shipBtn");
  const sel = `#shipHardpoints input[data-system="${key}"]`;
  if (on) await page.check(sel);
  else await page.uncheck(sel);
  await page.click("#shipCloseBtn");
}

// Walks to the wormhole (wherever it is) and returns via it. The flagship
// arrives standing directly ON it ("you start as if you're on top of that
// wormhole, not next to it"), but the very first action taken since
// arriving this sector is deliberately suppressed (app.js's `justArrived`)
// so spawning doesn't instantly bounce the flagship back out before it's
// done anything — that exact scenario (landing on the wormhole as the
// sector's first-ever action) is covered directly in engine.test.js. Once
// any other action has already happened this sector (e.g. an Outpost
// visit), simply moving onto the wormhole triggers the return immediately;
// the fallback Hold Position below only matters for the "first action"
// case, where landing on it wasn't enough by itself.
async function walkToWormhole(page) {
  let s = await getState(page);
  const startLevel = s.levelId;
  // Bounded for the same reason as walkToOutpost — no lookahead against a
  // chasing enemy.
  for (
    let i = 0;
    i < 30 && s.status === "playing" && (s.playerPos.q !== s.wormholePos.q || s.playerPos.r !== s.wormholePos.r);
    i++
  ) {
    await playTurnToward(page, "wormhole");
    s = await getState(page);
  }
  if (s.levelId === startLevel) {
    // Standing on the wormhole as the sector's first action needs one more
    // turn-ending action to trigger the return — RECHARGE is the
    // stationary one (drain a point first if the tank is full).
    await page.evaluate(() => {
      if (window.__hhState.energy >= window.__hhState.maxEnergy) window.__hhState.energy -= 1;
    });
    await page.click("#rechargeBtn");
  }
  await page.waitForFunction((lvl) => window.__hhState.levelId !== lvl, startLevel, { timeout: 5000 });
  return getState(page);
}

async function freshPage(browser, url, errors) {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("console: " + msg.text());
  });
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__hhState && window.__hhState.status === "playing");
  return page;
}

(async () => {
  const server = await serveRepo();
  const url = `http://127.0.0.1:${server.address().port}/games/hypergolic-hull/index.html`;
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const errors = [];

  // ---- Sector 1: the Shockwave lesson (the old no-op move-only Sector 1 -
  // "Level one is pointless" Clubhouse feedback - was cut) ------------------

  let page = await freshPage(browser, url, errors);
  let s = await getState(page);
  assert.strictEqual(s.levelId, 1);
  assert.strictEqual(s.enemies.length, 1, "Sector 1 has one Interceptor to learn the Shockwave on");
  assert.strictEqual(s.exitUnlocked, true, "the Warp Gate is always online");
  assert.deepStrictEqual(s.actions, ["sublight", "ramming"], "Sector 1 unlocks Sublight + the Shockwave together");
  // Locked actions are hidden entirely now — no padlocked ghost buttons.
  assert.strictEqual(await page.locator('[data-mode="tractor"]').isVisible(), false, "tractor is hidden until unlocked");
  // The control panel holds the actions (Hold/Tractor/Target Lock) and the
  // three mode views; weapon on/off switches live on the Systems screen
  // ("you don't need the controls on/off anymore"). Warpdrive is the
  // Target Lock button now, not a Systems row. An unowned weapon (the
  // Lance Cannon here) simply has no hardpoint row yet.
  await page.click("#shipBtn");
  assert.strictEqual(await page.locator('#shipHardpoints input[data-system="warpdrive"]').count(), 0, "Warpdrive is no longer a Systems row — Target Lock owns it");
  assert.strictEqual(await page.locator('#shipHardpoints input[data-system="ram"]').isVisible(), true, "the Systems screen carries the Shockwave's switch");
  assert.strictEqual(await page.locator('#shipHardpoints input[data-system="lance"]').count(), 0, "an unpurchased weapon has no hardpoint row yet");
  await page.click("#shipCloseBtn");
  assert.strictEqual(await page.locator("#targetLockBtn").isVisible(), true, "Target Lock sits on the panel's action row");
  assert.strictEqual(await page.locator("#fireBtn").isVisible(), true, "FIRE is a real button — shooting is its own action now");
  assert.strictEqual(await page.locator("#fireBtn").isDisabled(), true, "FIRE stays dark with nothing in reach — the button itself says whether shooting does anything");
  assert.strictEqual(await page.locator("#rechargeBtn").isVisible(), true, "RECHARGE is on the panel too");
  assert.strictEqual(await page.locator("#rechargeBtn").isDisabled(), true, "and it's dark at full Energy — no wasted turns");
  assert.strictEqual(
    await page.locator("#energyBar").isVisible(),
    true,
    "the Energy bar shows from turn one — it pays for every weapon shot now"
  );
  assert.strictEqual(
    await page.locator("#energyBar .stat-pip.filled").count(),
    6,
    "a fresh run's Energy bar starts with all 6 pips lit"
  );
  const boardBox = await page.locator("#board").boundingBox();
  assert.ok(boardBox.height > boardBox.width * 0.95, "the canvas grows tall to fit the Hoplite-style board");
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false, "run overlay must not show on a fresh board");

  // Scan is a pure inspect mode — no icon-key overlay anymore ("all it
  // should really be is when you're scanning, you just tap things"):
  // the button lights up, the readout strip above the field explains,
  // actions lock out, and tapping anything on the board identifies it.
  assert.strictEqual(await page.locator("#scanBtn").isVisible(), true, "the Scan toggle is always available");
  await page.click("#scanBtn");
  assert.ok((await page.locator("#scanBtn").getAttribute("class")).includes("active"), "Scan lights up while active");
  assert.ok(
    /scan active/i.test(await page.locator("#scanHint").textContent()),
    "the readout strip above the field says what Scan mode is"
  );
  assert.strictEqual(await page.locator("#targetLockBtn").isDisabled(), true, "actions lock out while Scan mode is open");
  // Opening Scan reserves the readout strip above the field, which re-fits
  // the canvas — every click below must use the post-scan bounding box.
  const scanBoardBox = await page.locator("#board").boundingBox();

  const posBeforeScanTap = (await getState(page)).playerPos;
  const turnBeforeScanTap = (await getState(page)).turnCount;
  await clickHex(page, "sublight", await pickStepToward(page, "exit"));
  s = await getState(page);
  assert.deepStrictEqual(s.playerPos, posBeforeScanTap, "tapping the board in Scan mode never moves the flagship");
  assert.strictEqual(s.turnCount, turnBeforeScanTap, "and never spends a turn");

  // The tapped hex is inspected instead — an enemy's info card shows up.
  const scanTargetPos = s.enemies.find((e) => e.alive);
  const enemyBox = await page.evaluate(({ q, r }) => window.__hhHexCenter(q, r), scanTargetPos);
  await page.mouse.click(scanBoardBox.x + enemyBox.x, scanBoardBox.y + enemyBox.y);
  assert.strictEqual(await page.locator("#enemyInfo").isVisible(), true, "tapping an enemy in Scan mode shows its info card");
  assert.ok((await page.locator("#enemyInfo").textContent()).includes("INTERCEPTOR"), "the card names the inspected enemy");
  assert.ok(
    (await page.locator("#enemyInfo").textContent()).includes("INTENT"),
    "the selected contact's card states its intent — what it will do, straight from the real AI"
  );

  // The Warp Gate is inspectable too, not just enemies.
  const exitCenter = await page.evaluate(() => window.__hhHexCenter(window.__hhState.exitPos.q, window.__hhState.exitPos.r));
  await page.mouse.click(scanBoardBox.x + exitCenter.x, scanBoardBox.y + exitCenter.y);
  assert.ok((await page.locator("#enemyInfo").textContent()).includes("WARP GATE"), "the Warp Gate is inspectable in Scan mode");

  await page.click("#scanBtn");
  assert.ok(!(await page.locator("#scanBtn").getAttribute("class")).includes("active"), "Scan dims when closed");
  assert.strictEqual(await page.locator("#enemyInfo").isVisible(), false, "closing Scan mode clears the inspection card too");
  assert.strictEqual(await page.locator("#targetLockBtn").isDisabled(), false, "actions are usable again once Scan mode closes");

  // ---- The Ship screen: a full-screen flagship/loadout view --------------
  // ("a mode that goes full screen and shows ship and allows you to
  // modify") — opened from the Ship button next to Scan. Its weapon
  // toggles are the same free pre-turn switches as the console's.
  assert.strictEqual(await page.locator("#shipOverlay").isVisible(), false, "the Ship screen starts closed");
  await page.click("#shipBtn");
  assert.strictEqual(await page.locator("#shipOverlay").isVisible(), true, "the Ship button opens the full-screen view");
  assert.ok((await page.locator("#shipStats").textContent()).includes("Weapon slots"), "the Ship screen lists the slot capacity");
  const turnBeforeShipToggle = (await getState(page)).turnCount;
  await page.uncheck('#shipHardpoints input[data-system="ram"]');
  s = await getState(page);
  assert.strictEqual(s.systems.ram, false, "the Ship screen's toggle drives the real system state");
  assert.strictEqual(s.turnCount, turnBeforeShipToggle, "loadout changes on the Ship screen never spend a turn");
  assert.ok((await page.locator("#shipHardpoints").textContent()).includes("Range 1"), "hardpoint rows spell out the weapon's stats in words");
  await page.check('#shipHardpoints input[data-system="ram"]');
  s = await getState(page);
  assert.strictEqual(s.systems.ram, true, "toggling back on works the same way");
  await page.click("#shipCloseBtn");
  assert.strictEqual(await page.locator("#shipOverlay").isVisible(), false, "Back to the fight closes the Ship screen");

  // ---- The Map: an SVG starmap of only what the ship actually knows -------
  await page.click("#mapBtn");
  assert.strictEqual(await page.locator("#mapOverlay").isVisible(), true, "the Map button opens the starmap");
  const mapText = await page.locator("#mapChart").textContent();
  assert.ok(mapText.includes("YOU ARE HERE"), "the map marks the current sector");
  assert.ok(mapText.includes("?"), "the gate ahead shows as an uncharted ? node, not a spoiler");
  assert.strictEqual(await page.locator("#mapChart svg").count(), 1, "the map is a drawn chart, not a text list");
  await page.click("#mapCloseBtn");
  assert.strictEqual(await page.locator("#mapOverlay").isVisible(), false, "the map closes again");

  // One action per turn: walk right up next to the Interceptor — moving
  // never fires anything, so it survives point-blank contact.
  for (let i = 0; i < 20; i++) {
    const adjacent = await page.evaluate(() => {
      const E = window.HypergolicEngine;
      const st = window.__hhState;
      return st.enemies.some((e) => e.alive && E.isAdjacent(e, st.playerPos));
    });
    s = await getState(page);
    if (adjacent || s.status !== "playing") break;
    await clickHex(page, "sublight", await pickStepToward(page, "enemy"));
  }
  s = await getState(page);
  assert.strictEqual(
    s.enemies.filter((e) => e.alive).length,
    1,
    "moving never kills anything — shooting is its own action"
  );

  // Target Lock: movement offline, taps re-aim for free.
  await page.click("#targetLockBtn"); // engage
  const posBeforeAim = (await getState(page)).playerPos;
  const turnBeforeAim = (await getState(page)).turnCount;
  const enemyPos = (await getState(page)).enemies.find((e) => e.alive);
  const enemyCenter = await page.evaluate(({ q, r }) => window.__hhHexCenter(q, r), enemyPos);
  const aimBox = await page.locator("#board").boundingBox();
  await page.mouse.click(aimBox.x + enemyCenter.x, aimBox.y + enemyCenter.y);
  s = await getState(page);
  assert.deepStrictEqual(s.playerPos, posBeforeAim, "re-aiming with Target Lock engaged never moves the flagship");
  assert.strictEqual(s.turnCount, turnBeforeAim, "re-aiming doesn't spend a turn");
  assert.strictEqual(
    s.facing,
    await page.evaluate(({ q, r }) => window.HypergolicEngine.directionIndex(window.__hhState.playerPos, { q, r }), enemyPos),
    "the flagship is now facing the Interceptor"
  );

  // FIRE: lit up (something's in reach), kills the Interceptor in place.
  assert.strictEqual(await page.locator("#fireBtn").isDisabled(), false, "FIRE lights up with a target in reach");
  const posBeforeFire = (await getState(page)).playerPos;
  const energyBeforeFire = (await getState(page)).energy;
  await page.click("#fireBtn");
  s = await getState(page);
  assert.deepStrictEqual(s.playerPos, posBeforeFire, "FIRE never moves the flagship");
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 0, "the FIRE volley kills the adjacent Interceptor");
  assert.ok(s.energy < energyBeforeFire, "and the shot visibly cost Energy");
  assert.strictEqual(s.exitUnlocked, true);
  await page.click("#targetLockBtn"); // disengage — Warpdrive back online

  // RECHARGE lights up now that Energy is down, and refills +2.
  assert.strictEqual(await page.locator("#rechargeBtn").isDisabled(), false, "RECHARGE lights up once Energy is spent");
  const energyBeforeRecharge = (await getState(page)).energy;
  await page.click("#rechargeBtn");
  s = await getState(page);
  assert.strictEqual(s.energy, Math.min(s.maxEnergy, energyBeforeRecharge + 2), "RECHARGE adds +2 Energy for the turn");

  s = await walkToExit(page);
  assert.strictEqual(s.status, "won", "Sector 1 clears once the gate is reached");
  assert.ok(s.hull > 0, "the Impulse Cannon line through Sector 1 survives");

  // ---- Sector 2: a routine clear needs no confirmation — it auto-continues --
  // (the warp-flash plays and the run just carries on into the next sector)

  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false, "a routine sector clear shows no modal");
  await page.waitForFunction(() => window.__hhState.status === "playing" && window.__hhState.levelId === 2, null, { timeout: 5000 });
  s = await getState(page);
  assert.deepStrictEqual(s.actions, ["sublight", "ramming"], "Sector 2 no longer hands out Tractor Beam automatically");
  assert.ok(s.enemies.filter((e) => e.alive).length >= 1);
  assert.strictEqual(await page.locator('[data-mode="tractor"]').isVisible(), false, "hidden until claimed, same as any other locked action");

  // ---- Tractor Beam: claimed at the Outpost, not handed out for free -------
  // (Clubhouse: "you should not start with it") — free (0 salvage), but
  // you have to actually dock and claim it.
  s = await walkToOutpost(page);
  const salvageBeforeClaim = s.salvage;
  assert.ok(await page.locator("#outpostOverlay").isVisible(), "docking opens the Outpost shop");
  assert.ok(
    await page.locator('#outpostOffers button:has-text("Tractor Beam")').textContent(),
    "the Tractor Beam claim is on offer here"
  );
  s = await claimOutpostOffer(page, "Tractor Beam");
  assert.strictEqual(s.actions.includes("tractor"), true, "claiming it unlocks the action");
  assert.strictEqual(s.salvage, salvageBeforeClaim, "the claim was free — no salvage spent");
  await page.click("#outpostCloseBtn");

  // ---- New-unlock pulse: a freshly-appeared action calls attention to ------
  // itself instead of silently appearing (Clubhouse: "what is tractor beam
  // that suddenly appears?").
  assert.strictEqual(
    await page.locator('[data-mode="tractor"]').evaluate((el) => el.classList.contains("new-unlock")),
    true,
    "Tractor Beam pulses the first time it's shown, before it's ever been tapped"
  );
  await page.click('[data-mode="tractor"]');
  assert.strictEqual(
    await page.locator('[data-mode="tractor"]').evaluate((el) => el.classList.contains("new-unlock")),
    false,
    "tapping it once clears the pulse for good"
  );
  // Arming a mode used to give zero in-the-moment guidance (Clubhouse:
  // "what IS Tractor Beam... weird that I'm able to click on it") — it
  // now drops a concrete instruction onto the panel's readout strip.
  assert.ok(
    /tractor armed/i.test(await page.locator("#log").textContent()),
    "arming Tractor Beam puts a concrete instruction on the readout strip"
  );

  // Step away from the Outpost hex before reloading — outpostDismissed
  // isn't persisted, so reloading while still docked would re-pop the
  // shop overlay (still standing right there) and block the board clicks
  // the rest of this test relies on.
  await clickHex(page, "sublight", await pickStepToward(page, "wormhole"));

  // ---- Run persistence: reloading resumes exactly where you left off ------
  // ("the levels should be remembered" — a reload used to always restart at
  // Sector 1, since persist() saved a run but nothing ever read it back.)
  await page.reload();
  await page.waitForFunction(() => window.__hhState && window.__hhState.status === "playing");
  s = await getState(page);
  assert.strictEqual(s.levelId, 2, "reloading resumes the in-progress sector, not a fresh Sector 1");
  assert.ok(s.wormholePos, "the wormhole back to Sector 1 survives a reload too (sectorHistory is persisted)");

  // ---- Wormhole: sectors aren't one-way ------------------------------------
  // (no button — flying onto the wormhole hex is the return trip; per
  // Clubhouse feedback its position is randomized each time, not fixed)

  assert.ok(s.wormholePos, "a cleared sector leaves a wormhole back, once there's history to return to");
  s = await walkToWormhole(page);
  assert.strictEqual(s.levelId, 1, "flying onto the wormhole rewinds to the previous sector");
  // The saved snapshot is un-consumed back to "playing" (it was mid-"won",
  // captured standing on the Warp Gate) so the board is live again, not a
  // frozen dead end — every action asserts status==="playing".
  assert.strictEqual(s.status, "playing", "the board is interactive again, not frozen on the win screen");
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 0, "the Interceptor is still dead — it's the saved state, not regenerated");
  assert.strictEqual(s.wormholePos, null, "no further history left to go back to from the first sector");

  // ---- The chart is a maze you can jump around ("jump back and forth") ----
  // Sector 2 is still charted ahead of us — tap its star on the Map to
  // jump forward to it, then tap Sector 1's to come straight back.
  await page.click("#mapBtn");
  await page.click('#mapChart [data-chart="1"]', { force: true }); // overlapping SVG circles both carry data-chart — the delegated handler reads either
  await page.waitForFunction(() => window.__hhState.levelId === 2, null, { timeout: 5000 });
  s = await getState(page);
  assert.strictEqual(s.status, "playing", "jumping forward on the Map lands in a live board");
  await page.click("#mapBtn");
  await page.click('#mapChart [data-chart="0"]', { force: true });
  await page.waitForFunction(() => window.__hhState.levelId === 1, null, { timeout: 5000 });
  s = await getState(page);
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 0, "Sector 1 is still exactly as we left it — charted, not regenerated");

  // Still standing on the Warp Gate — any turn-ending action re-triggers
  // the win check; RECHARGE is the stationary one (drain a point first if
  // the tank happens to be full).
  await page.evaluate(() => {
    if (window.__hhState.energy >= window.__hhState.maxEnergy) window.__hhState.energy -= 1;
    window.render();
  });
  await page.click("#rechargeBtn");
  await page.waitForFunction(() => window.__hhState.levelId === 2, null, { timeout: 5000 });
  s = await getState(page);
  assert.strictEqual(s.levelId, 2, "going forward again from a rewound sector re-advances normally");
  await page.close();

  // ---- loss branch: keep MOVING beside Sector 1's Interceptor until ------
  // Hull 0 — one action per turn means repositioning inside its reach
  // never defends you, so three careless moves end the run.

  page = await freshPage(browser, url, errors);

  s = await getState(page);
  for (let i = 0; i < 20 && s.status === "playing"; i++) {
    const next = await page.evaluate(() => {
      const E = window.HypergolicEngine;
      const st = window.__hhState;
      const living = st.enemies.filter((e) => e.alive);
      const targets = E.legalSublightTargets(st);
      return targets.find((t) => living.some((e) => E.isAdjacent(e, t))) || null;
    });
    await clickHex(page, "sublight", next || (await pickStepToward(page, "enemy")));
    s = await getState(page);
  }
  assert.strictEqual(s.status, "lost", "loitering in threat range must end the run");
  assert.strictEqual(s.hull, 0);
  await waitForOverlay(page);
  assert.strictEqual(await page.locator("#runOverlayTitle").textContent(), "Flagship Destroyed");

  await page.click("#restartBtn");
  await page.waitForFunction(() => window.__hhState.status === "playing");
  s = await getState(page);
  assert.strictEqual(s.levelId, 1, "New Run resets the campaign to Sector 1");
  assert.strictEqual(s.hull, 3);
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false);
  await page.close();

  // ---- Branching Warp Gates: two gates render without errors ---------------
  // ("different sort of paths... based on the different portals" — the
  // decision logic is covered in engine.test.js; this just confirms app.js's
  // renderer doesn't choke on a real two-exit state.) window.__hhState is a
  // live reference into app.js's internal state (see render()), so mutate it
  // in place rather than reassigning — a reassignment wouldn't touch what
  // the renderer actually reads.
  page = await freshPage(browser, url, errors);
  await page.evaluate(() => {
    const branchLevel = window.HypergolicLevels.generateLevel(30);
    const fresh = window.HypergolicEngine.createGameState(branchLevel);
    Object.assign(window.__hhState, fresh);
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(50);
  const branchExits = await page.evaluate(() => window.__hhState.exits);
  assert.strictEqual(branchExits.length, 2, "a generated sector's state carries both Warp Gates");
  assert.notStrictEqual(branchExits[0].variantId, branchExits[1].variantId, "the two gates are tagged with different variants");
  await page.close();

  // ---- Backward-compat: a stale save missing a newer field must not -------
  // blank the board. A real in-progress Sector 3 run went fully blank
  // (backdrop visible, zero hexes/ships/gate drawn) once `exits` shipped,
  // because restoreRun() loaded the old save as-is and draw() threw on
  // `state.exits.find(...)` being undefined. Single-player save, no install
  // base to migrate forward — isValidSave() in app.js just drops anything
  // that doesn't look current and starts a fresh run instead of crashing.
  page = await freshPage(browser, url, errors);
  await page.evaluate(() => {
    const staleState = { ...window.__hhState };
    delete staleState.exits;
    localStorage.setItem("gc:hypergolic-hull:run", JSON.stringify(staleState));
    localStorage.setItem("gc:hypergolic-hull:levelIndex", JSON.stringify(3));
    localStorage.setItem("gc:hypergolic-hull:sectorHistory", JSON.stringify([]));
  });
  await page.reload();
  await page.waitForFunction(() => window.__hhState && window.__hhState.status === "playing");
  s = await getState(page);
  assert.strictEqual(s.levelId, 1, "a stale save missing `exits` is dropped for a fresh Sector 1 run, not trusted as-is");
  assert.ok(Array.isArray(s.exits) && s.exits.length >= 1, "the fresh run has a valid, current-shaped state");
  await page.close();

  // ---- Boss milestone: "Run Complete" is a real, manual moment -------------
  // ("how do you win, or is it just runs?") — clearing the depth-20 boss
  // shows a distinct overlay instead of silently auto-continuing like a
  // routine sector clear, and offers a real choice (keep going vs. bank
  // the win). Simulated directly (playing to depth 20 for real is out of
  // scope for a test) — the win/isVictory logic itself is covered in
  // engine.test.js; this confirms app.js's UI reacts to it correctly.
  page = await freshPage(browser, url, errors);
  await page.evaluate(() => {
    const bossLevel = window.HypergolicLevels.generateLevel(20);
    const fresh = window.HypergolicEngine.createGameState(bossLevel);
    fresh.playerPos = { q: bossLevel.exit.q, r: bossLevel.exit.r };
    Object.assign(window.__hhState, fresh);
    window.__hhState.energy -= 1; // so RECHARGE (the stationary action) is available to trigger the win check
    window.__hhSetLevelIndex(19); // depth = index + 1 — keep advanceSector's "levelIndex + 1" in sync
    window.render();
  });
  await page.click("#rechargeBtn"); // standing on an always-online gate: any turn-ending action wins it
  await page.waitForFunction(() => window.__hhState.isVictory === true);
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false, "the overlay waits for animations, same as the loss screen");
  await waitForOverlay(page);
  assert.strictEqual(await page.locator("#runOverlayTitle").textContent(), "Run Complete");
  assert.strictEqual(await page.locator("#continueBtn").isVisible(), true, "Keep Flying is offered on a boss win");
  await page.click("#continueBtn");
  await page.waitForFunction(() => window.__hhState.levelId === 21 && window.__hhState.status === "playing");
  s = await getState(page);
  assert.strictEqual(s.isBoss, false, "the sector past the boss is purely procedural again");
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false, "continuing closes the victory overlay");
  await page.close();

  // ---- Weapon-slot cap in the UI: "there should be rules about what you --
  // can equip" (Clubhouse) — with Lance and Repulsor both owned, only 2 of
  // the 3 toggle-fired weapons can run at once. The cap itself is covered
  // exhaustively in engine.test.js; this just confirms app.js surfaces it —
  // the label appears, a rejected toggle click reverts the checkbox and
  // logs why, and freeing a slot lets the next toggle succeed. Owning both
  // weapons is simulated directly (grinding real salvage for both purchases
  // is exercised elsewhere) — same state-injection pattern as the boss
  // milestone test above.
  page = await freshPage(browser, url, errors);
  await page.evaluate(() => {
    const level = window.HypergolicLevels.generateLevel(5);
    const fresh = window.HypergolicEngine.createGameState(level, { extraActions: ["lance", "repulsor"] });
    Object.assign(window.__hhState, fresh);
    window.render(); // resize alone only redraws the canvas — the systems panel needs a full render()
  });
  await page.waitForTimeout(50);
  s = await getState(page);
  assert.deepStrictEqual(
    s.systems,
    { warpdrive: true, ram: true, lance: true, repulsor: false },
    "owning all 3 weapon systems starts with only the first 2 (Shockwave + Lance) active"
  );
  await page.click("#shipBtn");
  assert.ok(
    (await page.locator("#shipStats").textContent()).includes("2/2 in use"),
    "the Ship screen shows both weapon slots occupied"
  );

  // Trying to arm the 3rd (Repulsor) while Shockwave+Lance already fill
  // both slots must be rejected — the checkbox reverts, and the log
  // explains why.
  await page.check('#shipHardpoints input[data-system="repulsor"]').catch(() => {}); // Playwright's own "state didn't change" error is expected here — see the reset assertion below
  s = await getState(page);
  assert.strictEqual(s.systems.repulsor, false, "the rejected toggle never took effect in state");
  assert.strictEqual(await page.locator('#shipHardpoints input[data-system="repulsor"]').isChecked(), false, "and the checkbox visually reverts to match");
  assert.ok(
    (await page.locator("#log").textContent()).includes("Weapon slots full"),
    "the rejection reason is logged"
  );

  // Freeing a slot lets the next toggle through.
  await page.uncheck('#shipHardpoints input[data-system="lance"]');
  await page.check('#shipHardpoints input[data-system="repulsor"]');
  s = await getState(page);
  assert.strictEqual(s.systems.repulsor, true, "with a slot free, Repulsor arms successfully");
  assert.ok(
    (await page.locator("#shipStats").textContent()).includes("2/2 in use"),
    "Shockwave + Repulsor is the new 2/2"
  );
  await page.close();

  await browser.close();
  server.close();

  assert.deepStrictEqual(errors, [], "no page or console errors during either playthrough");
  console.log("All browser playthrough assertions passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
