// browser.test.js — TREEBOAR's touch UI: the exact Floor 1 golden path
// (mirroring engine.test.js's hand-traced sequence) driven through real
// taps — node choice, combat, and the card reward screen — then a
// tap-driven bot finishing the rest of the run (including an elite fight
// and the boss) to confirm the whole loop works end to end, plus loss and
// restart.
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
  return page.$$eval("#hand .card .card-name", (els) => els.map((e) => e.textContent));
}

// Drives the rest of the run to completion: rests when hurt, otherwise
// fights (never the riskier elite); blocks when a hit is actually coming,
// otherwise makes damage progress; always banks the first offered reward.
// Same "sensible but not omniscient" strategy as engine.test.js's bot,
// just issued as real taps instead of direct Engine calls.
async function playUntil(page, targetStatuses) {
  for (let i = 0; i < 800; i++) {
    const status = await page.evaluate(() => window.__tbState.status);
    if (targetStatuses.includes(status)) return status;

    if (status === "choosing") {
      const idx = await page.evaluate(() => {
        const st = window.__tbState;
        const hurt = st.player.hp < st.player.maxHp * 0.7;
        const restIdx = st.nodeChoices.findIndex((o) => o.type === "rest");
        const fightIdx = st.nodeChoices.findIndex((o) => o.type === "fight");
        return hurt && restIdx !== -1 ? restIdx : fightIdx;
      });
      await (await page.$$(".node-option"))[idx].click();
      continue;
    }

    if (status === "reward") {
      await (await page.$$("#rewardOptions .reward-card"))[0].click();
      continue;
    }

    // status === "playing"
    const info = await page.evaluate(() => {
      const st = window.__tbState;
      const Content = window.TreeboarContent;
      const Engine = window.TreeboarEngine;
      const incoming = Engine.livingEnemies(st)
        .filter((e) => e.currentIntent.type === "attack")
        .reduce((sum, e) => sum + e.currentIntent.damage, 0);
      const affordable = [];
      for (let i = 0; i < st.hand.length; i++) {
        if (st.player.energy >= Content.CARDS[st.hand[i]].cost) affordable.push(i);
      }
      let idx = -1;
      if (affordable.length > 0) {
        if (incoming > st.player.block) {
          idx = affordable.find((i) => Content.CARDS[st.hand[i]].block);
        }
        if (idx === undefined || idx === -1) {
          idx = affordable.find((i) => Content.CARDS[st.hand[i]].damage);
        }
        if (idx === undefined || idx === -1) idx = affordable[0];
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
      const cards = await page.$$("#hand .card");
      await cards[info.idx].click();
      if (info.targetId) await page.click(`[data-enemy-id="${info.targetId}"]`);
    }
  }
  throw new Error("run did not converge within 800 steps");
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
  await page.waitForSelector(".node-option");

  // ---- Floor 1 node choice --------------------------------------------
  let state = await getState(page);
  assert.strictEqual(state.status, "choosing");
  assert.deepStrictEqual(state.nodeChoices.map((o) => o.type), ["fight", "fight", "rest"]);
  assert.strictEqual((await page.$$(".node-option")).length, 3);

  await (await page.$$(".node-option"))[0].click(); // "Back Alley" — fight
  await page.waitForTimeout(80);

  // ---- Floor 1 combat, traced exactly like engine.test.js's golden path -
  assert.deepStrictEqual(
    await cardTexts(page),
    ["Bite", "Good Boy", "Guard Dog", "Pounce", "Fetch"],
    "opening hand matches the deterministic shuffle"
  );
  state = await getState(page);
  assert.strictEqual(state.enemies.length, 1);
  assert.strictEqual(state.enemies[0].hp, 14);
  assert.ok(await page.locator(".enemy-intent").textContent(), "the cat's move is telegraphed up front");

  await (await page.$$("#hand .card"))[0].click(); // Bite -> the lone cat, auto-targeted
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.enemies[0].hp, 8);
  assert.strictEqual(state.player.energy, 2);

  await (await page.$$("#hand .card"))[0].click(); // Good Boy -> +1 energy
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.player.energy, 3);

  await (await page.$$("#hand .card"))[0].click(); // Guard Dog -> +10 Block
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.player.block, 10);
  assert.strictEqual(state.player.energy, 1);
  assert.deepStrictEqual(await cardTexts(page), ["Pounce", "Fetch"]);

  const pounceCard = (await page.$$("#hand .card"))[0];
  assert.ok(await pounceCard.evaluate((el) => el.classList.contains("card-disabled")), "Pounce costs 2, only 1 energy left");
  await pounceCard.click(); // tapping a disabled card is a no-op
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.player.energy, 1, "the disabled Pounce tap did nothing");

  await (await page.$$("#hand .card"))[1].click(); // Fetch -> cat for 3, draws a replacement
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.enemies[0].hp, 5);
  assert.strictEqual(state.player.energy, 0);

  await page.click("#endTurnBtn");
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.player.hp, 28, "10 Block fully absorbed the telegraphed Attack 6");
  assert.strictEqual(state.turnCount, 2);
  assert.deepStrictEqual(await cardTexts(page), ["Growl", "Growl", "Growl", "Bite", "Bite"]);

  await (await page.$$("#hand .card"))[3].click(); // Bite -> lethal
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.enemies[0].hp, 0);
  assert.strictEqual(state.status, "reward", "a plain fight win goes straight to a card reward");
  assert.strictEqual((await page.$$("#rewardOptions .reward-card")).length, 3);

  await (await page.$$("#rewardOptions .reward-card"))[0].click();
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.deck.length, 13, "the picked reward permanently grew the deck");
  assert.strictEqual(state.status, "choosing");
  assert.deepStrictEqual(state.nodeChoices.map((o) => o.type), ["fight", "elite", "rest"], "Floor 2 introduces an elite option");

  // ---- Rest of the run, tap-driven (elite fight, boss, victory) ---------
  const finalStatus = await playUntil(page, ["victory", "lost"]);
  assert.strictEqual(finalStatus, "victory", "the tap-driven bot should be able to clear the whole dungeon");
  assert.strictEqual(await page.locator("#runOverlayTitle").textContent(), "Victory!");

  // ---- Restart ------------------------------------------------------------
  await page.click("#restartBtn");
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.status, "choosing");
  assert.strictEqual(state.floorIndex, 0);
  assert.strictEqual(state.player.hp, state.player.maxHp);
  assert.strictEqual(state.deck.length, 12, "restart begins with the plain starter deck again");

  // ---- Loss path ------------------------------------------------------------
  await (await page.$$(".node-option"))[0].click(); // back into a fight
  await page.waitForTimeout(80);
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
  assert.strictEqual(state.status, "choosing");
  assert.strictEqual(state.player.hp, state.player.maxHp, "restart begins a fresh run");

  assert.deepStrictEqual(errors, [], `expected zero console/page errors, got: ${errors.map(String)}`);

  await browser.close();
  server.close();
  console.log("All browser assertions passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
