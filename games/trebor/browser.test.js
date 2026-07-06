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

    if (status === "class-select") {
      await (await page.$$(".class-option"))[0].click();
      continue;
    }

    if (status === "choosing") {
      const idx = await page.evaluate(() => {
        const st = window.__tbState;
        const hurt = st.player.hp < st.player.maxHp * 0.7;
        const restIdx = st.nodeChoices.findIndex((o) => o.type === "rest");
        const fightIdx = st.nodeChoices.findIndex((o) => o.type === "fight");
        return hurt && restIdx !== -1 ? restIdx : fightIdx;
      });
      await (await page.$$(".map-node-active"))[idx].click();
      continue;
    }

    if (status === "reward") {
      await (await page.$$("#rewardOptions .reward-card"))[0].click();
      continue;
    }

    if (status === "boss-reward") {
      await (await page.$$("#bossRewardOptions .reward-card"))[0].click();
      continue;
    }

    if (status === "rest-site") {
      await page.click("#restHealBtn"); // a cautious dog heals
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

  // Capture JS errors, but ignore resource-load failures (a missing sprite
  // PNG is a deploy/asset concern, not a script-correctness one — this test
  // exercises game logic through the UI, not asset presence).
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !/Failed to load resource|net::ERR|\.png/i.test(text)) {
      errors.push(new Error(text));
    }
  });

  // Pin the shuffle to the same deterministic (rng=()=>0) sequence used by
  // engine.test.js's golden path, so the exact hand/turn trace below is
  // reproducible instead of depending on Math.random.
  await page.addInitScript(() => {
    window.__tbRng = () => 0;
  });

  await page.goto(`http://127.0.0.1:${port}/games/trebor/index.html`);
  await page.waitForSelector(".class-option");

  // ---- Class select ----------------------------------------------------
  let state = await getState(page);
  assert.strictEqual(state.status, "class-select");
  assert.strictEqual((await page.$$(".class-option")).length, 4, "four dog classes offered");

  await page.click(".class-option-koozie"); // Irish Water Spaniel, 32 Hull
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.status, "choosing");
  assert.strictEqual(state.classId, "koozie");
  assert.strictEqual(state.player.maxHp, 32);
  assert.strictEqual(state.nodeChoices.length, 3, "the floor offers three rooms");
  assert.ok(state.nodeChoices.some((o) => o.type === "fight"), "at least one is a fight");

  await (await page.$$(".map-node-active"))[0].click(); // first room — a fight
  await page.waitForTimeout(80);

  // ---- Floor 1 combat, traced like engine.test.js's Koozie golden path -
  assert.deepStrictEqual(
    await cardTexts(page),
    ["Riptide", "Counter-Surge", "Counter-Surge", "Brace", "Brace"],
    "Koozie's deterministic opening hand (its own block-heavy deck)"
  );
  state = await getState(page);
  assert.strictEqual(state.enemies[0].hp, 28);
  assert.strictEqual(state.player.block, 3, "Waterproof opens the turn with 3 Block");
  assert.ok(await page.locator(".enemy-intent").textContent(), "the cat's move is telegraphed up front");

  // The draw/discard piles are visible during combat and open a viewer.
  assert.strictEqual(await page.locator("#drawPileBtn").isVisible(), true, "the draw pile badge shows during combat");
  assert.strictEqual(
    await page.locator("#drawPileCount").textContent(),
    String(state.drawPile.length),
    "the draw pile badge shows the live draw-pile count"
  );
  await page.click("#drawPileBtn");
  assert.strictEqual(await page.locator("#deckOverlay").isVisible(), true, "tapping the draw pile opens the card viewer");
  assert.ok((await page.locator("#deckCount").textContent()).startsWith("Draw pile"), "the viewer is titled for the draw pile");
  await page.click("#deckCloseBtn");

  await (await page.$$("#hand .card"))[3].click(); // Brace -> +8 Block
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.player.block, 11);
  assert.strictEqual(state.player.energy, 2);

  await (await page.$$("#hand .card"))[3].click(); // Brace -> +8 Block
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.player.block, 19);
  assert.strictEqual(state.player.energy, 1);

  await (await page.$$("#hand .card"))[0].click(); // Riptide -> 5 dmg + 5 Block, auto-targeted
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.enemies[0].hp, 23);
  assert.strictEqual(state.player.block, 24);
  assert.strictEqual(state.player.energy, 0);

  await page.click("#endTurnBtn");
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.player.hp, 32, "24 Block swallowed the telegraphed Attack whole");
  assert.strictEqual(state.player.block, 3, "Block resets, then Waterproof re-applies 3");
  assert.strictEqual(state.turnCount, 2);

  // Finish Floor 1 and the rest of the run tap-driven, through elites, the
  // new enemies (kittens, sniper), rest sites, and the bosses — confirming the
  // whole UI loop works end to end. The dungeon is deliberately hard now
  // (balance is asserted separately, and to a competent standard, in
  // engine.test.js); this cautious tap-bot may or may not clear the pinned
  // worst-case (rng=()=>0) route, so we only require the run to reach a
  // terminal state and render the matching end-of-run overlay.
  const finalStatus = await playUntil(page, ["victory", "lost"]);
  assert.ok(finalStatus === "victory" || finalStatus === "lost", "the run reaches a terminal state");
  const overlayTitle = await page.locator("#runOverlayTitle").textContent();
  if (finalStatus === "victory") {
    assert.strictEqual(overlayTitle, "Victory!", "a cleared run shows the Victory overlay");
  } else {
    assert.ok(overlayTitle.includes("Down"), "a lost run shows the defeat overlay");
  }

  // ---- Restart returns to class select --------------------------------
  await page.click("#restartBtn");
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.status, "class-select", "New Run sends you back to pick a dog again");
  assert.strictEqual(state.classId, null);

  // ---- Loss path (as a different class) --------------------------------
  await page.click(".class-option-riddle"); // Wire Fox Terrier, 36 Hull
  await page.waitForTimeout(80);
  state = await getState(page);
  assert.strictEqual(state.player.maxHp, 36);
  await (await page.$$(".map-node-active"))[0].click(); // into a fight
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
  assert.strictEqual(state.status, "class-select", "restart begins a fresh class pick");

  assert.deepStrictEqual(errors, [], `expected zero console/page errors, got: ${errors.map(String)}`);

  await browser.close();
  server.close();
  console.log("All browser assertions passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
