// browser.test.js — full playthrough of Sector 1 through the real UI
// (canvas clicks + action buttons): win branch + Next Sector handoff into
// Sector 2, loss branch, and restart. Complements engine.test.js, which
// covers the movement/combat rules headlessly on a pinned fixture board.
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

// Click the hex at axial (q,r) after arming the given action mode. Mirrors
// app.js's hexToPixel: the board is drawn centered in the canvas.
async function clickHex(page, mode, hex) {
  await page.click(`[data-mode="${mode}"]`);
  const box = await page.locator("#board").boundingBox();
  const HEX_SIZE_X = 32, HEX_SIZE_Y = 28;
  const px = HEX_SIZE_X * Math.sqrt(3) * (hex.q + hex.r / 2);
  const py = HEX_SIZE_Y * 1.5 * hex.r;
  await page.mouse.click(box.x + box.width / 2 + px, box.y + box.height / 2 + py);
}

function getState(page) {
  return page.evaluate(() => window.__hhState);
}

// One greedy sublight step that shrinks the distance to `goalOf(state)`.
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

async function freshPage(browser, url, errors) {
  const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
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

  // ---- win branch: fighters kill the lone Interceptor, walk to the gate,
  // ---- then Next Sector hands off to the two-Interceptor board

  let page = await freshPage(browser, url, errors);
  let s = await getState(page);
  assert.strictEqual(s.levelId, 1);
  assert.strictEqual(s.hull, 3);
  assert.deepStrictEqual({ q: s.playerPos.q, r: s.playerPos.r }, { q: -2, r: 1 }, "the player starts on the left edge, not the middle");
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 1, "Sector 1 is the gentle opener: one enemy");
  assert.strictEqual(
    await page.evaluate(() => {
      const E = window.HypergolicEngine;
      const st = window.__hhState;
      return E.hexDistance(st.playerPos, st.enemies[0]);
    }),
    4,
    "the enemy starts across the board from the player"
  );
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false, "run overlay must not show on a fresh board");
  assert.ok(
    (await page.locator("#objective").textContent()).includes("Destroy 1 enemy"),
    "the objective line tells the player what to do"
  );
  assert.strictEqual(await page.locator(".legend").isVisible(), true, "the legend explains the pieces and colors");

  // Fighter Squadron kills the Interceptor at range; ramming locks until retrieval.
  const target = s.enemies.find((e) => e.alive);
  await clickHex(page, "fighter", target);
  s = await getState(page);
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 0);
  assert.strictEqual(s.rammingDisabled, true, "Ramming Speed is disabled while fighters are deployed");
  assert.strictEqual(s.exitUnlocked, true, "gate unlocks once all enemies are dead");
  assert.strictEqual(await page.locator('[data-mode="ramming"]').isDisabled(), true);
  assert.ok(
    (await page.locator("#objective").textContent()).includes("Gate online"),
    "the objective line flips once the gate is powered"
  );

  // Walk to the Warp Gate, greedily reducing distance each turn.
  for (let i = 0; i < 8 && s.status === "playing"; i++) {
    await clickHex(page, "sublight", await pickStepToward(page, "exit"));
    s = await getState(page);
  }
  assert.strictEqual(s.status, "won", "reaching the unlocked gate should complete the sector");
  assert.strictEqual(s.hull, 3, "the clean line through Sector 1 takes zero damage");
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), true);
  assert.strictEqual(await page.locator("#runOverlayTitle").textContent(), "Sector Clear");
  assert.strictEqual(await page.locator("#nextBtn").isVisible(), true, "a cleared sector offers Next Sector");

  await page.click("#nextBtn");
  await page.waitForFunction(() => window.__hhState.status === "playing" && window.__hhState.levelId === 2);
  s = await getState(page);
  assert.strictEqual(s.hull, 3);
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 2, "Sector 2 brings the two-Interceptor board");
  assert.deepStrictEqual({ q: s.playerPos.q, r: s.playerPos.r }, { q: -2, r: 1 }, "Sector 2 also starts the player on the edge");
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false);
  await page.close();

  // ---- loss branch: chase the Interceptor and loiter next to it until Hull 0

  page = await freshPage(browser, url, errors);
  s = await getState(page);
  for (let i = 0; i < 10 && s.status === "playing"; i++) {
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
  assert.strictEqual(await page.locator("#runOverlayTitle").textContent(), "Flagship Destroyed");
  assert.strictEqual(await page.locator("#nextBtn").isVisible(), false, "permadeath offers no Next Sector");

  await page.click("#restartBtn");
  await page.waitForFunction(() => window.__hhState.status === "playing");
  s = await getState(page);
  assert.strictEqual(s.levelId, 1, "New Run resets to a fresh Sector 1");
  assert.strictEqual(s.hull, 3);
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 1);
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
