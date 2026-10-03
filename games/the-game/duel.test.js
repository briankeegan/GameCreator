// duel.test.js — a duel played out in the browser on the server's rules
// (pa-engine.js): the trained bot on both boards, garbage sent both ways,
// no page error.
//
//   NODE_PATH="$(npm root -g)" node games/the-game/duel.test.js
//
// Needs Playwright + a Chromium binary (see browser_test_harness.js).
"use strict";

const assert = require("assert");
const { serveRepo, launchBrowser, freshPage } = require("../../.github/scripts/browser_test_harness");

const PLAY_MS = Number(process.env.GC_DUEL_MS || 45000);

(async () => {
  const server = await serveRepo();
  const url = `http://127.0.0.1:${server.address().port}/games/the-game/index.html`;
  const browser = await launchBrowser();
  const errors = [];
  try {
    const page = await freshPage(browser, url, errors);
    // Into a file, so no menu screen holds the match.
    await page.click("#titleStart");
    await page.waitForTimeout(150);
    await page.click(".file-slot >> nth=0");
    await page.waitForTimeout(400);
    // A new file asks for its difficulty first.
    if (await page.evaluate(() => window.NewseyMenu.current()) === "difficulty") {
      await page.click("#difficultyList button >> nth=0");
      await page.waitForTimeout(400);
    }
    assert.strictEqual(await page.evaluate(() => window.NewseyMenu.current()), null, "no menu is up");
    const engine = await page.evaluate(() => {
      const D = window.NewseyDuel;
      window.__duelEnd = null;
      D.start({ opponent: { name: "Kat", level: 5, difficulty: "hard" }, playerName: "Nella", playerLevel: 5,
                onEnd: (r) => { window.__duelEnd = r; } });
      D.debug().autoplay("hard");
      const s = D.raw();
      return { pa: s.player instanceof window.PAEngine.Stack && s.foe instanceof window.PAEngine.Stack, level: s.foe.level };
    });
    assert.ok(engine.pa, "both boards are pa-engine.js stacks");
    // Garbage counted as it goes: what each side has earned, and what has landed.
    const seen = { sent: [0, 0], dropped: [0, 0], swaps: [0, 0], clock: 0, over: null };
    const start = Date.now();
    while (Date.now() - start < PLAY_MS) {
      await page.waitForTimeout(1000);
      const now = await page.evaluate(() => {
        const s = window.NewseyDuel.raw();
        if (!s) return null;
        return { sent: [s.player.outgoing.history.length, s.foe.outgoing.history.length],
                 swaps: [s.player.swapCount, s.foe.swapCount], clock: s.player.clock, over: s.over,
                 incoming: [s.player.incoming.length, s.foe.incoming.length],
                 garbage: [s.player, s.foe].map((st) => st.panels.some((r) => r.some((p) => p && p.isGarbage))) };
      });
      if (!now) break;
      for (let i = 0; i < 2; i++) {
        seen.sent[i] = Math.max(seen.sent[i], now.sent[i]);
        seen.swaps[i] = Math.max(seen.swaps[i], now.swaps[i]);
        if (now.garbage[i]) seen.dropped[i]++;
      }
      seen.clock = now.clock;
      if (now.over) { seen.over = now.over; break; }
    }
    console.log("duel: " + JSON.stringify(seen));
    console.log("brain: " + JSON.stringify(await page.evaluate(() => { const d = window.NewseyDuel.debug(); return d && d.foeBrain; })));
    if (errors.length) console.log("errors: " + errors.slice(0, 5).join("\n"));
    assert.ok(seen.clock > 1000, "the match ran (clock " + seen.clock + ")");
    assert.ok(seen.swaps[0] > 20 && seen.swaps[1] > 20, "both sides swap: " + seen.swaps);
    assert.ok(seen.sent[0] + seen.sent[1] > 0, "garbage was earned");
    assert.ok(seen.dropped[0] + seen.dropped[1] > 0, "garbage landed on a board");
    assert.deepStrictEqual(errors, [], "no page errors");
    console.log("ok: a duel on the server's rules, " + seen.clock + " frames");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
