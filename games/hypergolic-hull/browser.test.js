// browser.test.js — the tutorial campaign through the real UI (canvas
// clicks + action buttons): Sector 1's move-only lesson with locked
// actions, the Next Sector handoff, Sector 2's Impulse Cannon lesson, the loss
// branch, and restart. Complements engine.test.js, which covers the
// movement/combat rules headlessly on pinned fixture boards.
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
    const goal = expr === "exit" ? st.exitPos : st.enemies.find((e) => e.alive);
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

  // ---- Sector 1: move-only tutorial; not-yet-unlocked actions are hidden --

  let page = await freshPage(browser, url, errors);
  let s = await getState(page);
  assert.strictEqual(s.levelId, 1);
  assert.strictEqual(s.enemies.length, 0, "Sector 1 teaches moving: no enemies");
  assert.strictEqual(s.exitUnlocked, true, "no enemies means the gate starts online");
  assert.deepStrictEqual(s.actions, ["sublight"], "only Sublight is unlocked in Sector 1");
  for (const m of ["tractor", "fighter"]) {
    // Locked actions are hidden entirely now — no padlocked ghost buttons.
    assert.strictEqual(await page.locator(`[data-mode="${m}"]`).isVisible(), false, `${m} is hidden until unlocked in Sector 1`);
  }
  assert.strictEqual(
    await page.locator("#toggleRam").isDisabled(),
    false,
    "the Impulse Cannon toggle is never locked out, even before the weapon itself is unlocked"
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
  // remembers whatever the ❓ Help toggle was last set to — it doesn't
  // auto-hide itself once a move happens. Test the toggle with one manual
  // step (not the auto-route below, which fires its own actions on a timer
  // and would race a check).
  assert.strictEqual(await page.locator("#legend").isVisible(), false, "the legend starts closed by default");
  assert.strictEqual(await page.locator("#helpBtn").isVisible(), true, "the Help toggle is always available");
  await page.click("#helpBtn");
  assert.strictEqual(await page.locator("#legend").isVisible(), true, "Help opens the legend");
  await clickHex(page, "sublight", await pickStepToward(page, "exit"));
  assert.strictEqual(await page.locator("#legend").isVisible(), true, "the legend stays open across a move — no auto-hide");
  await page.click("#helpBtn");
  assert.strictEqual(await page.locator("#legend").isVisible(), false, "Help closes it again");

  // The quickest-route preview: tap the far-away gate once to see the path,
  // tap it again to fly the rest of the route (one real turn per step).
  s = await getState(page);
  await clickHex(page, "sublight", s.exitPos);
  await page.waitForFunction(() => window.__hhPlannedPath);
  const preview = await page.evaluate(() => window.__hhPlannedPath);
  assert.deepStrictEqual(preview.target, { q: 2, r: 0 }, "the preview targets the tapped hex");
  assert.ok(preview.hexes.length > 2, "the previewed route spans the remaining board");
  await clickHex(page, "sublight", s.exitPos);
  await page.waitForFunction(() => window.__hhState.status === "won", null, { timeout: 30000 });
  s = await getState(page);
  assert.strictEqual(s.status, "won", "flying the previewed route clears Sector 1");
  await waitForOverlay(page);
  assert.strictEqual(await page.locator("#runOverlayTitle").textContent(), "Sector Clear");

  // ---- Next Sector: Sector 2 unlocks the Impulse Cannon -----------------------

  await page.click("#nextBtn");
  await page.waitForFunction(() => window.__hhState.status === "playing" && window.__hhState.levelId === 2);
  s = await getState(page);
  assert.deepStrictEqual(s.actions, ["sublight", "ramming"], "Sector 2 unlocks exactly one new action");
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 1);
  assert.strictEqual(await page.locator("#toggleRam").isDisabled(), false, "the Impulse Cannon toggle is usable in Sector 2");

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
  assert.strictEqual(s.status, "won", "Sector 2 clears once the gate is reached");
  assert.ok(s.hull > 0, "the Impulse Cannon line through Sector 2 survives");
  await waitForOverlay(page);
  assert.strictEqual(await page.locator("#nextBtn").isVisible(), true, "Sector 3 awaits");
  await page.close();

  // ---- loss branch: loiter beside Sector 2's Interceptor until Hull 0 -----
  // (Impulse Cannon toggled off — with it on, moving adjacent auto-kills the
  // Interceptor before it can ever strike back, per the Sector 2 test above.)

  page = await freshPage(browser, url, errors);
  s = await walkToExit(page); // clear Sector 1 again
  await waitForOverlay(page);
  await page.click("#nextBtn");
  await page.waitForFunction(() => window.__hhState.status === "playing" && window.__hhState.levelId === 2);
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
  assert.strictEqual(await page.locator("#nextBtn").isVisible(), false, "permadeath offers no Next Sector");

  await page.click("#restartBtn");
  await page.waitForFunction(() => window.__hhState.status === "playing");
  s = await getState(page);
  assert.strictEqual(s.levelId, 1, "New Run resets the campaign to Sector 1");
  assert.strictEqual(s.hull, 3);
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false);
  await page.close();

  await browser.close();
  server.close();

  assert.deepStrictEqual(errors, [], "no page or console errors during either playthrough");
  console.log("All browser playthrough assertions passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
