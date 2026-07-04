// browser.test.js — TREEBOAR's touch UI: the exact Room 1 golden path
// (mirroring engine.test.js's hand-traced sequence) driven through real
// taps, then a generic tap-driven bot finishing the run through Rooms 2-4
// (including the Room 3 multi-target flow) to confirm the whole loop works
// end to end, plus loss + restart.
//
// Needs Playwright + a Chromium binary:
//   NODE_PATH="$(npm root -g)" node games/trebor/browser.test.js
// Set CHROMIUM_PATH if Chromium isn't at the default /opt/pw-browsers/chromium.
"use strict";

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

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

function getState(page) {
  return page.evaluate(() => window.__tbState);
}

function cardTexts(page) {
  return page.$$eval(".card .card-name", (els) => els.map((e) => e.textContent));
}

// Drives whatever room is currently active to completion using a simple
// "play the first affordable card, targeting the first living enemy when a
// target is required" strategy, then advances past room-clear. Used for
// Rooms 2-4 once the precise Room 1 trace below has proven the primitives
// work; this part just proves the whole loop (including multi-target taps)
// converges to victory.
async function playUntil(page, targetStatuses) {
  for (let i = 0; i < 500; i++) {
    const status = await page.evaluate(() => window.__tbState.status);
    if (targetStatuses.includes(status)) return status;
    if (status === "room-clear") {
      await page.click("#nextBtn");
      continue;
    }
    const info = await page.evaluate(() => {
      const st = window.__tbState;
      const Content = window.TreeboarContent;
      const Engine = window.TreeboarEngine;
      let idx = -1;
      for (let i = 0; i < st.hand.length; i++) {
        if (st.player.energy >= Content.CARDS[st.hand[i]].cost) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return { action: "end" };
      const card = Content.CARDS[st.hand[idx]];
      const living = Engine.livingEnemies(st);
      const needsSecondTap = Engine.cardNeedsTarget(card) && living.length > 1;
      return { action: "play", idx, targetId: needsSecondTap ? living[0].id : null };
    });
    if (info.action === "end") {
      await page.click("#endTurnBtn");
    } else {
      const cards = await page.$$(".card");
      await cards[info.idx].click();
      if (info.targetId) await page.click(`[data-enemy-id="${info.targetId}"]`);
    }
  }
  throw new Error("run did not converge within 500 steps");
}

(async () => {
  const server = await serveRepo();
  const { port } = server.address();
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });

  const errors = [];
  page.on("pageerror", (err) => errors.push(err));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(new Error(msg.text()));
  });

  // Pin the shuffle to the same deterministic (rng=()=>0) sequence used by
  // engine.test.js's golden path, so the exact hand/turn trace below is
  // reproducible instead of depending on Math.random.
  await page.addInitScript(() => {
    window.__tbRng = () => 0;
  });

  await page.goto(`http://127.0.0.1:${port}/games/trebor/index.html`);
  await page.waitForSelector(".card");

  // ---- Room 1, traced exactly like engine.test.js's golden path ---------
  assert.deepStrictEqual(
    await cardTexts(page),
    ["Bite", "Good Boy", "Guard Dog", "Pounce", "Fetch"],
    "opening hand matches the deterministic shuffle"
  );
  let state = await getState(page);
  assert.strictEqual(state.enemies.length, 1);
  assert.strictEqual(state.enemies[0].hp, 14);
  assert.ok(await page.locator(".enemy-intent").textContent(), "the cat's move is telegraphed up front");

  await (await page.$$(".card"))[0].click(); // Bite -> the lone cat, auto-targeted
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.enemies[0].hp, 8);
  assert.strictEqual(state.player.energy, 2);

  await (await page.$$(".card"))[0].click(); // Good Boy -> +1 energy
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.player.energy, 3);

  await (await page.$$(".card"))[0].click(); // Guard Dog -> +10 Block
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.player.block, 10);
  assert.strictEqual(state.player.energy, 1);
  assert.deepStrictEqual(await cardTexts(page), ["Pounce", "Fetch"]);

  const pounceCard = (await page.$$(".card"))[0];
  assert.ok(await pounceCard.evaluate((el) => el.classList.contains("card-disabled")), "Pounce costs 2, only 1 energy left");
  await pounceCard.click(); // tapping a disabled card is a no-op
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.player.energy, 1, "the disabled Pounce tap did nothing");

  await (await page.$$(".card"))[1].click(); // Fetch -> cat for 3, draws a replacement
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.enemies[0].hp, 5);
  assert.strictEqual(state.player.energy, 0);

  await page.click("#endTurnBtn");
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.player.hp, 25, "10 Block fully absorbed the telegraphed Attack 6");
  assert.strictEqual(state.turnCount, 2);
  assert.deepStrictEqual(await cardTexts(page), ["Growl", "Growl", "Growl", "Bite", "Bite"]);

  await (await page.$$(".card"))[3].click(); // Bite -> lethal
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.enemies[0].hp, 0);
  assert.strictEqual(state.status, "room-clear");
  assert.strictEqual(await page.locator("#runOverlay").isHidden(), false, "the room-clear overlay is shown");
  assert.strictEqual(await page.locator("#nextBtn").isHidden(), false, "Next Room is offered (not the last room)");

  await page.click("#nextBtn");
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.roomIndex, 1);
  assert.strictEqual(state.enemies[0].typeId, "tabbyGuard");
  assert.deepStrictEqual(await cardTexts(page), ["Bite", "Good Boy", "Guard Dog", "Pounce", "Fetch"], "each room reshuffles fresh");

  // ---- Rooms 2-4 (including Room 3's two-cat multi-target flow) ---------
  const finalStatus = await playUntil(page, ["victory", "lost"]);
  assert.strictEqual(finalStatus, "victory", "the tap-driven bot should be able to clear the whole dungeon");
  assert.strictEqual(await page.locator("#runOverlayTitle").textContent(), "Victory! 🏆");
  assert.strictEqual(await page.locator("#nextBtn").isHidden(), true, "no Next Room button once the run is won");

  // ---- Restart -------------------------------------------------------------
  await page.click("#restartBtn");
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.status, "playing");
  assert.strictEqual(state.roomIndex, 0);
  assert.strictEqual(state.player.hp, state.player.maxHp);
  assert.deepStrictEqual(await cardTexts(page), ["Bite", "Good Boy", "Guard Dog", "Pounce", "Fetch"]);

  // ---- Loss path -------------------------------------------------------------
  // Force a quick loss by draining hp directly, then let a turn resolve.
  await page.evaluate(() => {
    window.__tbState.player.hp = 1;
  });
  await page.click("#endTurnBtn");
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.status, "lost");
  assert.ok((await page.locator("#runOverlayTitle").textContent()).includes("Down"));
  assert.strictEqual(await page.locator("#endTurnBtn").isDisabled(), true, "can't act once the run is over");

  await page.click("#restartBtn");
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.status, "playing");
  assert.strictEqual(state.player.hp, state.player.maxHp, "restart begins a fresh run");

  assert.deepStrictEqual(errors, [], `expected zero console/page errors, got: ${errors.map(String)}`);

  await browser.close();
  server.close();
  console.log("All browser assertions passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
