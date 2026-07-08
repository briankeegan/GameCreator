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
    const goal = expr === "exit" ? st.exitPos : expr === "wormhole" ? st.wormholePos : st.enemies.find((e) => e.alive);
    return E.legalSublightTargets(st).reduce(
      (best, cand) => {
        const d = E.hexDistance(cand, goal);
        return !best || d < best.d ? { to: cand, d } : best;
      },
      null
    ).to;
  }, goalExpr);
}

// The end-of-run/sector overlay is held back until animations finish.
function waitForOverlay(page) {
  return page.waitForFunction(() => !document.getElementById("runOverlay").hidden);
}

async function walkToExit(page) {
  let s = await getState(page);
  for (let i = 0; i < 20 && s.status === "playing"; i++) {
    await clickHex(page, "sublight", await pickStepToward(page, "exit"));
    s = await getState(page);
  }
  return s;
}

// The flagship arrives standing directly ON the wormhole ("you start as
// if you're on top of that wormhole, not next to it") — but the very
// first action taken this sector is deliberately suppressed (app.js's
// `justArrived`) so spawning doesn't instantly bounce the flagship back
// out before it's done anything. Hold Position once to consume that
// grace, then again to actually trigger the return, then wait out the
// reverse-warp flash for levelId to rewind.
async function walkToWormhole(page) {
  const s0 = await getState(page);
  assert.ok(
    s0.playerPos.q === s0.wormholePos.q && s0.playerPos.r === s0.wormholePos.r,
    "the flagship arrives standing exactly on the wormhole"
  );
  await page.click("#holdBtn");
  assert.strictEqual((await getState(page)).levelId, s0.levelId, "the first action on arrival doesn't trigger the return");
  await page.click("#holdBtn");
  await page.waitForFunction((lvl) => window.__hhState.levelId !== lvl, s0.levelId, { timeout: 5000 });
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
  for (const m of ["tractor", "fighter"]) {
    // Locked actions are hidden entirely now — no padlocked ghost buttons.
    assert.strictEqual(await page.locator(`[data-mode="${m}"]`).isVisible(), false, `${m} is hidden until unlocked`);
  }
  // The Lance Cannon toggle is Outpost-purchase-only, hidden until bought
  // — `.system-toggle` sets `display: flex` unconditionally, which was
  // found to override the browser's default `[hidden]` behavior and show
  // it from the very start of a fresh run before this was caught.
  assert.strictEqual(await page.locator("#lanceToggleWrap").isVisible(), false, "Lance Cannon toggle is hidden until purchased");
  assert.strictEqual(
    await page.locator("#toggleRam").isDisabled(),
    false,
    "the Impulse Cannon toggle is never locked out"
  );
  assert.strictEqual(
    await page.locator("#holdBtn").isVisible(),
    true,
    "Hold Position is always available, not just when Warpdrive is off"
  );
  const boardBox = await page.locator("#board").boundingBox();
  assert.ok(boardBox.height > boardBox.width * 0.95, "the canvas grows tall to fit the Hoplite-style board");
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false, "run overlay must not show on a fresh board");

  // The legend defaults to closed (not force-shown every sector) and just
  // remembers whatever the Help toggle was last set to — it doesn't
  // auto-hide itself once a move happens.
  assert.strictEqual(await page.locator("#legend").isVisible(), false, "the legend starts closed by default");
  assert.strictEqual(await page.locator("#helpBtn").isVisible(), true, "the Help toggle is always available");
  await page.click("#helpBtn");
  assert.strictEqual(await page.locator("#legend").isVisible(), true, "Help opens the legend");
  await clickHex(page, "sublight", await pickStepToward(page, "exit"));
  assert.strictEqual(await page.locator("#legend").isVisible(), true, "the legend stays open across a move — no auto-hide");
  await page.click("#helpBtn");
  assert.strictEqual(await page.locator("#legend").isVisible(), false, "Help closes it again");

  // Tapping the weapon-stats badge expands it to the full stat sentence —
  // same "tap a thing to inspect it" pattern as clicking an enemy.
  const compactText = await page.locator("#weaponStats").textContent();
  await page.click("#weaponStats");
  const expandedText = await page.locator("#weaponStats").textContent();
  assert.ok(expandedText.length > compactText.length, "tapping the weapon-stats badge expands it to the full sentence");
  assert.ok(/Range 1/i.test(expandedText), "the expanded stats spell out Range");
  await page.click("#weaponStats");
  assert.strictEqual(await page.locator("#weaponStats").textContent(), compactText, "tapping it again collapses back to the compact badge");

  // Toggling the Impulse Cannon off stops it auto-firing — walk right up next
  // to the Interceptor with it disabled and confirm it survives.
  await page.uncheck("#toggleRam");
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
    "Impulse Cannon toggled off does not auto-fire even at point-blank range"
  );

  // The Impulse Cannon only fires dead ahead of the current facing, and the
  // organic walk above doesn't guarantee the Interceptor ended up exactly
  // there (only that it's adjacent). With Warpdrive off, tapping an adjacent
  // hex re-aims the flagship toward it for free — no move, no turn spent —
  // so line up the shot that way before committing with Hold Position.
  await page.uncheck("#toggleWarpdrive");
  const posBeforeAim = (await getState(page)).playerPos;
  const turnBeforeAim = (await getState(page)).turnCount;
  const enemyPos = (await getState(page)).enemies.find((e) => e.alive);
  const enemyCenter = await page.evaluate(({ q, r }) => window.__hhHexCenter(q, r), enemyPos);
  const aimBox = await page.locator("#board").boundingBox();
  await page.mouse.click(aimBox.x + enemyCenter.x, aimBox.y + enemyCenter.y);
  s = await getState(page);
  assert.deepStrictEqual(s.playerPos, posBeforeAim, "re-aiming with Warpdrive off never moves the flagship");
  assert.strictEqual(s.turnCount, turnBeforeAim, "re-aiming doesn't spend a turn");
  assert.strictEqual(
    s.facing,
    await page.evaluate(({ q, r }) => window.HypergolicEngine.directionIndex(window.__hhState.playerPos, { q, r }), enemyPos),
    "the flagship is now facing the Interceptor"
  );

  // Warpdrive off blocks movement — Hold Position is the only option (it's
  // always available, on top of that). Flip the Impulse Cannon back on and
  // hold position to fire it without moving.
  await page.check("#toggleRam");
  assert.strictEqual(await page.locator("#holdBtn").isVisible(), true, "Hold Position is available");
  const posBeforeHold = (await getState(page)).playerPos;
  await page.click("#holdBtn");
  s = await getState(page);
  assert.deepStrictEqual(s.playerPos, posBeforeHold, "Hold Position never moves the flagship");
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 0, "Hold Position lets the re-enabled Impulse Cannon fire in place");
  assert.strictEqual(s.exitUnlocked, true);
  await page.check("#toggleWarpdrive");

  s = await walkToExit(page);
  assert.strictEqual(s.status, "won", "Sector 1 clears once the gate is reached");
  assert.ok(s.hull > 0, "the Impulse Cannon line through Sector 1 survives");

  // ---- Sector 2: a routine clear needs no confirmation — it auto-continues --
  // (the warp-flash plays and the run just carries on into the next sector)

  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false, "a routine sector clear shows no modal");
  await page.waitForFunction(() => window.__hhState.status === "playing" && window.__hhState.levelId === 2, null, { timeout: 5000 });
  s = await getState(page);
  assert.deepStrictEqual(s.actions, ["sublight", "ramming", "tractor"], "Sector 2 unlocks exactly one new action");
  assert.ok(s.enemies.filter((e) => e.alive).length >= 1);

  // ---- New-unlock pulse: a freshly-appeared action calls attention to ------
  // itself instead of silently appearing (Clubhouse: "what is tractor beam
  // that suddenly appears?").
  assert.strictEqual(
    await page.locator('[data-mode="tractor"]').evaluate((el) => el.classList.contains("new-unlock")),
    true,
    "Tractor Beam pulses the sector it first appears, before it's ever been tapped"
  );
  await page.click('[data-mode="tractor"]');
  assert.strictEqual(
    await page.locator('[data-mode="tractor"]').evaluate((el) => el.classList.contains("new-unlock")),
    false,
    "tapping it once clears the pulse for good"
  );

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

  // Still standing on the Warp Gate — Hold Position re-triggers the win
  // check and warps back out through the normal flow.
  await page.click("#holdBtn");
  await page.waitForFunction(() => window.__hhState.levelId === 2, null, { timeout: 5000 });
  s = await getState(page);
  assert.strictEqual(s.levelId, 2, "going forward again from a rewound sector re-advances normally");
  await page.close();

  // ---- loss branch: loiter beside Sector 1's Interceptor until Hull 0 -----
  // (Impulse Cannon toggled off — with it on, moving adjacent auto-kills the
  // Interceptor before it can ever strike back, per the Sector 1 test above.)

  page = await freshPage(browser, url, errors);
  await page.uncheck("#toggleRam");

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

  await browser.close();
  server.close();

  assert.deepStrictEqual(errors, [], "no page or console errors during either playthrough");
  console.log("All browser playthrough assertions passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
