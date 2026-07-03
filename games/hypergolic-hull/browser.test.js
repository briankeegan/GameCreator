// browser.test.js — the tutorial campaign through the real UI (canvas
// clicks + action buttons): Sector 1's move-only lesson with locked
// actions, the Next Sector handoff, Sector 2's ramming lesson, the loss
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
async function clickHex(page, mode, hex) {
  await page.click(`[data-mode="${mode}"]`);
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
  for (let i = 0; i < 12 && s.status === "playing"; i++) {
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

  // ---- Sector 1: move-only tutorial, everything else visibly locked ------

  let page = await freshPage(browser, url, errors);
  let s = await getState(page);
  assert.strictEqual(s.levelId, 1);
  assert.strictEqual(s.enemies.length, 0, "Sector 1 teaches moving: no enemies");
  assert.strictEqual(s.exitUnlocked, true, "no enemies means the gate starts online");
  assert.deepStrictEqual(s.actions, ["sublight"], "only Sublight is unlocked in Sector 1");
  for (const m of ["ramming", "tractor", "fighter"]) {
    assert.strictEqual(await page.locator(`[data-mode="${m}"]`).isDisabled(), true, `${m} is locked in Sector 1`);
    assert.ok((await page.locator(`[data-mode="${m}"]`).textContent()).startsWith("🔒"), `${m} shows its padlock`);
  }
  const boardBox = await page.locator("#board").boundingBox();
  assert.ok(boardBox.height > boardBox.width * 0.95, "the canvas grows tall to fit the Hoplite-style board");
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false, "run overlay must not show on a fresh board");

  s = await walkToExit(page);
  assert.strictEqual(s.status, "won", "walking to the online gate clears Sector 1");
  await waitForOverlay(page);
  assert.strictEqual(await page.locator("#runOverlayTitle").textContent(), "Sector Clear");

  // ---- Next Sector: Sector 2 unlocks Ramming Speed ------------------------

  await page.click("#nextBtn");
  await page.waitForFunction(() => window.__hhState.status === "playing" && window.__hhState.levelId === 2);
  s = await getState(page);
  assert.deepStrictEqual(s.actions, ["sublight", "ramming"], "Sector 2 unlocks exactly one new action");
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 1);
  assert.strictEqual(await page.locator('[data-mode="ramming"]').isDisabled(), false, "ramming is usable in Sector 2");

  // Close in until Ramming Speed has a legal destination, then use it.
  for (let i = 0; i < 12; i++) {
    s = await getState(page);
    if (s.enemies.every((e) => !e.alive) || s.status !== "playing") break;
    const ram = await page.evaluate(() => {
      const targets = window.HypergolicEngine.legalRammingTargets(window.__hhState);
      return targets.length ? targets[0] : null;
    });
    if (ram) await clickHex(page, "ramming", ram);
    else await clickHex(page, "sublight", await pickStepToward(page, "enemy"));
  }
  s = await getState(page);
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 0, "Ramming Speed vaporizes the Interceptor");
  assert.strictEqual(s.exitUnlocked, true);

  s = await walkToExit(page);
  assert.strictEqual(s.status, "won", "Sector 2 clears once the gate is reached");
  assert.ok(s.hull > 0, "the ramming line through Sector 2 survives");
  await waitForOverlay(page);
  assert.strictEqual(await page.locator("#nextBtn").isVisible(), true, "Sector 3 awaits");
  await page.close();

  // ---- loss branch: loiter beside Sector 2's Interceptor until Hull 0 -----

  page = await freshPage(browser, url, errors);
  s = await walkToExit(page); // clear Sector 1 again
  await waitForOverlay(page);
  await page.click("#nextBtn");
  await page.waitForFunction(() => window.__hhState.status === "playing" && window.__hhState.levelId === 2);

  s = await getState(page);
  for (let i = 0; i < 14 && s.status === "playing"; i++) {
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
