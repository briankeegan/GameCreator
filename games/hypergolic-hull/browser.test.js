// browser.test.js — the tutorial campaign through the real UI (canvas
// clicks + action buttons): Sector 1's Autocannon lesson with locked
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
// app's own geometry (the canvas resizes itself to fit each board).
// Sublight has no button of its own — a plain tap lays a course in
// (tap-tap: the SECOND tap on the same hex confirms and flies it).
async function clickHex(page, mode, hex) {
  if (mode !== "sublight") await page.click(`[data-mode="${mode}"]`);
  const box = await page.locator("#board").boundingBox();
  const c = await page.evaluate(({ q, r }) => window.__hhHexCenter(q, r), { q: hex.q, r: hex.r });
  await page.mouse.click(box.x + c.x, box.y + c.y);
}

function getState(page) {
  return page.evaluate(() => window.__hhState);
}

// A stationary turn: RECHARGE is the wait ("the holding pattern would be
// recharge") — drain a point first if the tank happens to be full.
async function endRound(page) {
  await page.evaluate(() => {
    if (window.__hhState.energy >= window.__hhState.maxEnergy) window.__hhState.energy -= 1;
    window.render();
  });
  await page.click("#rechargeBtn");
}

// Tap-tap movement: first tap lays the course in, second tap (same hex)
// confirms and flies it — then wait for the flight to finish.
async function flyTo(page, hex) {
  await clickHex(page, "sublight", hex);
  await clickHex(page, "sublight", hex);
  await page.waitForFunction(() => window.__hhAutoRoute === null, null, { timeout: 20000 });
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
    // AP-round play: prefer steps that don't END the round inside anything's
    // danger zone — computeThreatHexes already projects a charged chaser's
    // move+fire reach. Fall back to any legal step when everything's hot.
    const legal = E.legalSublightTargets(st);
    const threats = E.computeThreatHexes(st);
    const safe = legal.filter((cand) => !threats.has(E.hexKey(cand)));
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

// The first living enemy inside any armed weapon's reach, or null.
function enemyInReachOf(page) {
  return page.evaluate(() => {
    const E = window.HypergolicEngine;
    const st = window.__hhState;
    return (
      st.enemies.find(
        (e) =>
          e.alive &&
          E.WEAPON_SYSTEM_KEYS.some(
            (k) =>
              (k === "ram" || st.actions.includes(k)) &&
              st.systems[k] &&
              E.weaponHexes(st.playerPos, st.facing, E.WEAPONS[k]).some((h) => h.q === e.q && h.r === e.r)
          )
      ) || null
    );
  });
}

// Play one ROUND: if a hostile is in reach, lock-and-fire it (tap to
// target, then the weapon button commits); otherwise tap-tap a safe step
// toward the goal — then End Round so each call advances one enemy phase.
async function playTurnToward(page, goalExpr) {
  const reachTarget = await enemyInReachOf(page);
  if (reachTarget) {
    await clickHex(page, "sublight", reachTarget); // lock
    await page.click(".weapon-btn:not([disabled])"); // commit with whichever gun bears
  } else {
    await flyTo(page, await pickStepToward(page, goalExpr));
  }
  const done = await page.evaluate(() => {
    const st = window.__hhState;
    return (
      st.status !== "playing" ||
      st.ap === st.maxAp || // the action itself already committed the round
      window.HypergolicEngine.wormholeAvailable(st) // a return trip is in flight — don't act in the old sector
    );
  });
  if (!done) await endRound(page);
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

// Walks to the wormhole (wherever it is) and returns via it. The flagship
// arrives standing directly ON it ("you start as if you're on top of that
// wormhole, not next to it"), but the very first action taken since
// arriving this sector is deliberately suppressed (app.js's `justArrived`)
// so spawning doesn't instantly bounce the flagship back out before it's
// done anything — that exact scenario (landing on the wormhole as the
// sector's first-ever action) is covered directly in engine.test.js. Once
// any other action has already happened this sector (e.g. an Outpost
// visit), simply moving onto the wormhole triggers the return immediately;
// the fallback End Round below only matters for the "first action" case,
// where landing on it wasn't enough by itself.
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
    // action to trigger the return — End Round is the stationary one.
    await endRound(page);
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

  // ---- Sector 1: the Autocannon lesson (the old no-op move-only Sector 1 -
  // "Level one is pointless" Clubhouse feedback - was cut) ------------------

  let page = await freshPage(browser, url, errors);
  let s = await getState(page);
  assert.strictEqual(s.levelId, 1);
  assert.strictEqual(s.enemies.length, 1, "Sector 1 has one Interceptor to learn the Autocannon on");
  assert.strictEqual(s.exitUnlocked, true, "the Warp Gate is always online");
  assert.deepStrictEqual(s.actions, ["sublight", "autocannon"], "Sector 1 unlocks Sublight + the Autocannon together");
  // Locked actions are hidden entirely now — no padlocked ghost buttons.
  // The control panel holds the actions and the
  // three mode views; weapon on/off switches live on the Systems screen
  // ("you don't need the controls on/off anymore"). Warpdrive is the
  // Target Lock button now, not a Systems row. An unowned weapon (the
  // Lance Cannon here) simply has no hardpoint row yet.
  await page.click("#shipBtn");
  assert.strictEqual(await page.locator("#holdGrid").count(), 1, "the Systems screen is the HOLD — a real equipment grid");
  assert.strictEqual(
    await page.locator("#holdGrid .hold-tile").count(),
    4,
    "the starter kit shows as four shaped tiles: Reactor Core, Sublight Drive, Scanner Array, Autocannon"
  );
  assert.strictEqual(await page.locator('#holdGrid .hold-tile[data-item-id="scanner"]').count(), 1, "the Scanner Array is a real 1x1 tile — Scan itself is hardware");
  assert.strictEqual(await page.locator('#holdGrid .hold-tile[data-item-id="autocannon"]').count(), 1, "the Autocannon is one of them");
  await page.click("#shipCloseBtn");
  assert.strictEqual(await page.locator("#targetLockBtn").count(), 0, "Target Lock is gone — tapping a hostile aims automatically");
  assert.strictEqual(await page.locator("#endTurnBtn").count(), 0, "End Round is gone — waiting is what RECHARGE is for");
  assert.strictEqual(await page.locator("#apWrap").isVisible(), false, "the Actions gauge stays hidden at one action per round");
  assert.strictEqual(await page.locator(".weapon-btn").count(), 1, "a fresh ship shows exactly one weapon control — the gun it carries");
  assert.strictEqual(await page.locator(".weapon-btn").textContent(), "Autocannon · 1⚡", "named for the hardware, with what a shot costs");
  assert.ok(
    !((await page.locator(".weapon-btn").getAttribute("class")) || "").includes("active"),
    "the weapons button only LIGHTS UP when something is in reach — unlit means a tap explains the weapon instead"
  );
  assert.strictEqual(await page.locator("#enginesBtn").isVisible(), true, "Engines is listed as equipment too");
  assert.strictEqual(await page.locator("#rechargeBtn").isVisible(), true, "the Reactor Core is on the panel too");
  const turnBeforeFullCycle = (await getState(page)).turnCount;
  await page.click("#rechargeBtn"); // at full Energy the reactor refuses with its own reason — no turn wasted
  s = await getState(page);
  assert.strictEqual(s.turnCount, turnBeforeFullCycle, "cycling a full reactor spends nothing");
  assert.ok(/already full/i.test(await page.locator("#log").textContent()), "and the reactor says why");
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
  assert.strictEqual(await page.locator("#rechargeBtn").isDisabled(), true, "actions lock out while Scan mode is open");
  // "Scan should not change the size of the board or add text" — opening
  // it must leave the canvas exactly as it was, and show nothing until
  // something is actually tapped.
  const scanBoardBox = await page.locator("#board").boundingBox();
  assert.deepStrictEqual(scanBoardBox, boardBox, "opening Scan never resizes or moves the board");
  assert.strictEqual(await page.locator("#enemyInfo").isVisible(), false, "Scan adds no standing text of its own");

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
  // The card is the SAME dashboard component as the flagship's, with the
  // enemy passed through: hull/energy gauges + salvage, nothing bespoke.
  const cardLabels = await page.locator("#enemyInfo .enemy-info-dash .stat-label").allTextContents();
  assert.deepStrictEqual(
    cardLabels.map((t) => t.trim().toUpperCase()),
    ["HULL", "ENERGY", "SALVAGE"],
    "the card carries the exact gauges the console does — HULL, ENERGY, SALVAGE — and nothing else"
  );
  assert.ok(
    (await page.locator("#enemyInfo .enemy-info-dash .stat-pip").count()) > 0,
    "…as real pips, not text"
  );
  assert.ok(
    !(await page.locator("#enemyInfo").textContent()).includes("FITTED"),
    "the old spec bullets are gone from the card — that detail lives in Systems now"
  );

  // "should show the menu... and allow you to expand Systems for that
  // ship" — the card carries a SYSTEMS button that opens the very same
  // Systems screen your own ship uses, with the contact passed through.
  await page.locator("#enemySystemsBtn").click();
  assert.strictEqual(await page.locator("#shipOverlay").isVisible(), true, "the card's SYSTEMS button expands the full overlay");
  assert.ok(
    (await page.locator("#shipOverlay h2").textContent()).includes("INTERCEPTOR"),
    "the overlay is titled for the scanned contact, not the flagship"
  );
  const enemyRows = await page.locator("#shipStats .ship-stat-row .stat-label").allTextContents();
  assert.deepStrictEqual(
    enemyRows.map((t) => t.trim()),
    ["Hull", "Energy", "Salvage"],
    "a contact's Systems screen is the flagship's own rows, in the flagship's own order — no authored prose"
  );
  // "clicking on item... should info when selected" — nothing is written
  // into the screen up front; the grid IS the information, and a tap on
  // any tile reads its specs off that item's own data.
  await page.locator("#enemyHoldGrid .hold-tile").first().click();
  const contactItemInfo = await page.locator("#holdInfo").textContent();
  assert.ok(contactItemInfo.length > 0 && !/Tap an item/.test(contactItemInfo), "tapping a contact's item reports what it is");
  assert.ok(
    (await page.locator("#enemyHoldGrid .hold-tile").count()) > 0,
    "their hold renders as a full-size ship-shaped grid of labeled equipment tiles"
  );
  assert.ok(
    (await page.locator("#enemyHoldGrid").textContent()).includes("Autocannon"),
    "an Interceptor's hold shows the very Autocannon you fly with — enemies carry player items, not enemy-only gear"
  );
  assert.strictEqual(await page.locator("#holdCargo").count(), 0, "a contact has no cargo bay to rummage through");
  await page.locator("#shipCloseBtn").click();
  assert.strictEqual(await page.locator("#shipOverlay").isVisible(), false, "Return to Helm closes the contact's Systems view");
  assert.strictEqual(await page.locator("#enemyInfo").isVisible(), true, "…and the scan card is still up underneath");

  // The Warp Gate is inspectable too, not just enemies.
  const exitCenter = await page.evaluate(() => window.__hhHexCenter(window.__hhState.exitPos.q, window.__hhState.exitPos.r));
  await page.mouse.click(scanBoardBox.x + exitCenter.x, scanBoardBox.y + exitCenter.y);
  assert.ok((await page.locator("#enemyInfo").textContent()).includes("WARP GATE"), "the Warp Gate is inspectable in Scan mode");

  await page.click("#scanBtn");
  assert.ok(!(await page.locator("#scanBtn").getAttribute("class")).includes("active"), "Scan dims when closed");
  assert.strictEqual(await page.locator("#enemyInfo").isVisible(), false, "closing Scan mode clears the inspection card too");


  // ---- The Ship screen: a full-screen flagship/loadout view --------------
  // ("a mode that goes full screen and shows ship and allows you to
  // modify") — opened from the Ship button next to Scan. Its weapon
  // toggles are the same free pre-turn switches as the console's.
  assert.strictEqual(await page.locator("#shipOverlay").isVisible(), false, "the Ship screen starts closed");
  await page.click("#shipBtn");
  assert.strictEqual(await page.locator("#shipOverlay").isVisible(), true, "the Ship button opens the full-screen view");
  // Mid-flight the Hold is a read-only schematic: refits are dock-gated.
  assert.ok(
    (await page.locator("#shipHardpoints").textContent()).includes("under way, no refits"),
    "mid-flight the Hold is an inspect-only schematic"
  );
  const refitRefusal = await page.evaluate(() => {
    try {
      window.HypergolicEngine.stowToCargo(window.__hhState, 0);
      return "no-throw";
    } catch (err) {
      return err.message;
    }
  });
  assert.ok(/Refits need a dock/.test(refitRefusal), "the engine refuses mid-flight refits outright");
  // Tapping a tile inspects it.
  await page.click('#holdGrid .hold-tile[data-item-id="autocannon"]');
  assert.ok(/Range 2/.test(await page.locator("#holdInfo").textContent()), "tapping a tile reads out the item's stats");
  await page.click("#shipCloseBtn");
  assert.strictEqual(await page.locator("#shipOverlay").isVisible(), false, "Return to Helm closes the Systems screen");

  // ---- The Map: an SVG starmap of only what the ship actually knows -------
  await page.click("#mapBtn");
  assert.strictEqual(await page.locator("#mapOverlay").isVisible(), true, "the Map button opens the starmap");
  const mapText = await page.locator("#mapChart").textContent();
  assert.ok(mapText.includes("YOU ARE HERE"), "the map marks the current sector");
  assert.ok(mapText.includes("?"), "the gate ahead shows as an uncharted ? node, not a spoiler");
  assert.strictEqual(await page.locator("#mapChart svg").count(), 1, "the map is a drawn chart, not a text list");
  await page.click("#mapCloseBtn");
  assert.strictEqual(await page.locator("#mapOverlay").isVisible(), false, "the map closes again");

  // One action per turn in play: let the Interceptor come to us (it
  // spends its rounds closing), then kill it via tap-tap: first tap
  // TARGETS, second tap FIRES ("if you click on a target it should
  // target them, and clicking again fires").
  s = await getState(page);
  assert.strictEqual(s.maxAp, 1, "one action per round is the shipped budget (AP plumbing kept underneath)");
  let fired = false;
  for (let i = 0; i < 25; i++) {
    s = await getState(page);
    if (s.status !== "playing" || s.enemies.every((e) => !e.alive)) break;
    const target = await enemyInReachOf(page);
    if (target) {
      // The button is the EQUIPMENT — with just the starting Autocannon
      // armed, it carries the weapon's own name, not the word "Fire".
      assert.strictEqual(
        await page.locator(".weapon-btn").isDisabled(),
        true,
        "the gun stays dead until a contact is marked — in reach alone isn't enough"
      );
      const energyBeforeFire = s.energy;
      await clickHex(page, "sublight", target); // first tap: target lock
      s = await getState(page);
      assert.strictEqual(s.enemies.filter((e) => e.alive).length, 1, "the first tap targets — nothing fires yet");
      assert.strictEqual(s.energy, energyBeforeFire, "and spends nothing yet");
      assert.strictEqual(await page.evaluate(() => window.__hhTargetedEnemy), target.id, "the contact is target-locked");
      assert.ok(/firing solution/i.test(await page.locator("#log").textContent()), "the readout confirms the solution, and what it costs");
      assert.strictEqual(await page.locator(".weapon-btn").isDisabled(), false, "marking the contact brings the gun live");
      assert.ok(
        ((await page.locator(".weapon-btn").getAttribute("class")) || "").includes("active"),
        "and it lights up green"
      );
      assert.ok(
        (await page.locator("#energyBar .stat-pip.pending").count()) > 0,
        "the Energy gauge ghosts the pips the shot would burn (lighter green)"
      );
      await page.click(".weapon-btn"); // the live gun commits the shot
      s = await getState(page);
      assert.ok(s.energy < energyBeforeFire, "the confirmed shot fires for real — energy spent");
      assert.strictEqual(await page.locator("#energyBar .stat-pip.pending").count(), 0, "the ghosted pips are gone once spent");
      fired = true;
    } else {
      await playTurnToward(page, "enemy");
    }
  }
  s = await getState(page);
  assert.ok(fired, "the kill went through the tap-to-target, tap-to-fire flow");
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 0, "the confirmed volley kills the Interceptor");
  assert.strictEqual(s.exitUnlocked, true);

  // The Reactor Core acts immediately now that Energy is down.
  assert.strictEqual(await page.locator("#rechargeBtn").isDisabled(), false, "the Reactor Core is tappable");
  const energyBeforeRecharge = (await getState(page)).energy;
  await page.click("#rechargeBtn");
  s = await getState(page);
  assert.strictEqual(
    s.energy,
    Math.min(s.maxEnergy, energyBeforeRecharge + 1),
    "the standard Reactor Core cycles +1 Energy for its turn"
  );
  assert.strictEqual(await page.locator("#rechargeBtn").textContent(), "Reactor Core", "the recharge button is the reactor itself");

  s = await walkToExit(page);
  assert.strictEqual(s.status, "won", "Sector 1 clears once the gate is reached");
  assert.ok(s.hull > 0, "the Impulse Cannon line through Sector 1 survives");

  // ---- Sector 2: a routine clear needs no confirmation — it auto-continues --
  // (the warp-flash plays and the run just carries on into the next sector)

  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false, "a routine sector clear shows no modal");
  await page.waitForFunction(() => window.__hhState.status === "playing" && window.__hhState.levelId === 2, null, { timeout: 5000 });
  s = await getState(page);
  assert.deepStrictEqual(s.actions, ["sublight", "autocannon"], "a new sector arrives with exactly what is fitted — nothing handed out");
  assert.ok(s.enemies.filter((e) => e.alive).length >= 1);
  // Scuttling charges: the run's own off switch, two taps deep so a stray
  // thumb can never end a run.
  await page.click("#shipBtn");
  assert.strictEqual(await page.locator("#selfDestructBtn").isVisible(), true, "the Systems screen carries scuttling charges");
  assert.ok(!(await page.locator("#selfDestructBtn").textContent()).includes("CONFIRM"), "unarmed to begin with");
  await page.click("#selfDestructBtn");
  assert.ok(
    (await page.locator("#selfDestructBtn").textContent()).includes("CONFIRM"),
    "the first tap only arms them, and says so"
  );
  let armedState = await getState(page);
  assert.ok(armedState.levelId > 1, "and nothing has happened to the run yet");
  await page.click("#shipCloseBtn"); // walking away disarms
  await page.click("#shipBtn");
  assert.ok(
    !(await page.locator("#selfDestructBtn").textContent()).includes("CONFIRM"),
    "leaving the screen disarms them again"
  );
  await page.click("#shipCloseBtn");

  // A dock is a scrapyard with a welding rig, not a showroom: Repair plus
  // exactly two things ("too many options too soon... why sell so much at
  // every station?").
  s = await walkToOutpost(page);
  assert.ok(await page.locator("#outpostOverlay").isVisible(), "docking opens the Outpost shop");
  assert.strictEqual(
    await page.locator("#outpostOffers button").count(),
    3,
    "a station stocks three things, not a nine-item catalogue"
  );
  await page.click("#outpostCloseBtn");

  // Step away from the Outpost hex before reloading — outpostDismissed
  // isn't persisted, so reloading while still docked would re-pop the
  // shop overlay (still standing right there) and block the board clicks
  // the rest of this test relies on.
  await flyTo(page, await pickStepToward(page, "wormhole"));

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
  // The SHIP travels with you: mark its live stats before jumping, and the
  // restored snapshot must carry them instead of rolling them back — a
  // chart jump restores the SECTOR as left, never old hull/salvage.
  const shipBeforeJump = { hull: s.hull, salvage: s.salvage };
  await page.click("#mapBtn");
  await page.click('#mapChart [data-chart="1"]', { force: true }); // overlapping SVG circles both carry data-chart — the delegated handler reads either
  await page.waitForFunction(() => window.__hhState.levelId === 2, null, { timeout: 5000 });
  s = await getState(page);
  assert.strictEqual(s.status, "playing", "jumping forward on the Map lands in a live board");
  assert.strictEqual(s.hull, shipBeforeJump.hull, "hull rides along on a chart jump — snapshots never roll it back");
  assert.strictEqual(s.salvage, shipBeforeJump.salvage, "salvage rides along too — no time-travel refunds");
  await page.click("#mapBtn");
  await page.click('#mapChart [data-chart="0"]', { force: true });
  await page.waitForFunction(() => window.__hhState.levelId === 1, null, { timeout: 5000 });
  s = await getState(page);
  assert.strictEqual(s.enemies.filter((e) => e.alive).length, 0, "Sector 1 is still exactly as we left it — charted, not regenerated");

  // Still standing on the Warp Gate — any action re-triggers the win
  // check; End Round is the stationary one.
  await endRound(page);
  await page.waitForFunction(() => window.__hhState.levelId === 2, null, { timeout: 5000 });
  s = await getState(page);
  assert.strictEqual(s.levelId, 2, "going forward again from a rewound sector re-advances normally");
  await page.close();

  // ---- loss branch: stand still and let Sector 1's Interceptor come ------
  // — its own 2 AP close the gap and fire, so a few passed rounds end the
  // run of a flagship that never defends itself.

  page = await freshPage(browser, url, errors);

  s = await getState(page);
  for (let i = 0; i < 15 && s.status === "playing"; i++) {
    await endRound(page); // pass both AP and give its phase the floor
    s = await getState(page);
  }
  assert.strictEqual(s.status, "lost", "doing nothing while a chaser closes must end the run");
  assert.strictEqual(s.hull, 0);
  await waitForOverlay(page);
  assert.strictEqual(await page.locator("#runOverlayTitle").textContent(), "Flagship Destroyed");

  await page.click("#restartBtn");
  await page.waitForFunction(() => window.__hhState.status === "playing");
  s = await getState(page);
  assert.strictEqual(s.levelId, 1, "New Run resets the campaign to Sector 1");
  assert.strictEqual(s.hull, s.maxHull, "and the ship comes back whole");
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false);
  await page.close();

  // ---- Tap-tap movement: course in, confirm, rethink, dismiss -------------
  // "You engage move... cancel... rethink" — the first tap lays a course
  // in and moves NOTHING; tapping elsewhere dismisses it for a new one;
  // only tapping the marked hex again actually flies it.
  page = await freshPage(browser, url, errors);
  s = await getState(page);
  const tapStart = s.playerPos;
  const firstStep = await pickStepToward(page, "exit");
  await clickHex(page, "sublight", firstStep);
  s = await getState(page);
  assert.deepStrictEqual(s.playerPos, tapStart, "the first tap only lays the course in — no movement yet");
  assert.ok(await page.evaluate(() => Boolean(window.__hhPlannedPath)), "the route preview is live");
  assert.ok(/course laid in/i.test(await page.locator("#log").textContent()), "the readout says the course is in and waiting on a confirm");
  // Rethink: tapping a DIFFERENT hex dismisses the first course and plots
  // a new one instead.
  const otherStep = await page.evaluate((skip) => {
    const E = window.HypergolicEngine;
    return E.legalSublightTargets(window.__hhState).find((h) => !(h.q === skip.q && h.r === skip.r));
  }, firstStep);
  await clickHex(page, "sublight", otherStep);
  s = await getState(page);
  assert.deepStrictEqual(s.playerPos, tapStart, "switching targets still moves nothing");
  assert.deepStrictEqual(
    await page.evaluate(() => window.__hhPlannedPath.target),
    { q: otherStep.q, r: otherStep.r },
    "the preview now points at the new hex — the old course was dismissed"
  );
  // Confirm: tapping the marked hex again flies it for real — and the
  // single action commits the round (enemy phase runs).
  const roundBefore = s.turnCount;
  await clickHex(page, "sublight", otherStep);
  await page.waitForFunction(() => window.__hhAutoRoute === null, null, { timeout: 20000 });
  s = await getState(page);
  assert.deepStrictEqual(s.playerPos, { q: otherStep.q, r: otherStep.r }, "the confirming tap flies the course");
  assert.strictEqual(s.turnCount, roundBefore + 1, "one action IS the turn — the enemy phase ran with it");
  assert.strictEqual(s.ap, s.maxAp, "and the next turn is ready");
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
  assert.ok(branchExits.length >= 2, "a generated sector's state carries every Warp Gate");
  assert.notStrictEqual(branchExits[0].variantId, branchExits[1].variantId, "the gates are tagged with different variants");
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

  // A save from the 2-AP era is otherwise VALID — but its maxAp: 2 must
  // clamp to the shipped one-action budget on restore, or an old run
  // keeps playing (and showing) two actions a round forever.
  await page.evaluate(() => {
    const apEraState = JSON.parse(JSON.stringify(window.__hhState));
    apEraState.maxAp = 2;
    apEraState.ap = 2;
    localStorage.setItem("gc:hypergolic-hull:run", JSON.stringify(apEraState));
    localStorage.setItem("gc:hypergolic-hull:levelIndex", JSON.stringify(0));
    localStorage.setItem("gc:hypergolic-hull:sectorHistory", JSON.stringify([]));
  });
  await page.reload();
  await page.waitForFunction(() => window.__hhState && window.__hhState.status === "playing");
  s = await getState(page);
  assert.strictEqual(s.maxAp, 1, "a 2-AP-era save clamps down to one action per round on restore");
  assert.strictEqual(s.ap, 1, "and the live counter clamps with it");
  assert.strictEqual(await page.locator("#apWrap").isVisible(), false, "so the Actions gauge stays hidden for old saves too");
  await page.close();

  // ---- Boss milestone: "The Bulwark Is Scrap" is a real, manual moment -------------
  // ("how do you win, or is it just runs?") — clearing the depth-20 boss
  // shows a distinct overlay instead of silently auto-continuing like a
  // routine sector clear, and offers a real choice (keep going vs. bank
  // the win). Simulated directly (playing the whole crawl for real is out of
  // scope for a test) — the win/isVictory logic itself is covered in
  // engine.test.js; this confirms app.js's UI reacts to it correctly.
  page = await freshPage(browser, url, errors);
  await page.evaluate(() => {
    const bossDepth = window.HypergolicLevels.BOSS_DEPTH;
    const bossLevel = window.HypergolicLevels.generateLevel(bossDepth);
    const fresh = window.HypergolicEngine.createGameState(bossLevel);
    fresh.playerPos = { q: bossLevel.exit.q, r: bossLevel.exit.r };
    Object.assign(window.__hhState, fresh);
    window.__hhSetLevelIndex(bossDepth - 1); // depth = index + 1 — keep advanceSector's "levelIndex + 1" in sync
    window.render();
  });
  await endRound(page); // standing on an always-online gate: any action wins it
  await page.waitForFunction(() => window.__hhState.isVictory === true);
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false, "the overlay waits for animations, same as the loss screen");
  await waitForOverlay(page);
  assert.strictEqual(await page.locator("#runOverlayTitle").textContent(), "The Bulwark Is Scrap");
  assert.strictEqual(await page.locator("#continueBtn").isVisible(), true, "Keep Flying is offered when the Bulwark dies");
  await page.click("#continueBtn");
  await page.waitForFunction(
    () => window.__hhState.levelId === window.HypergolicLevels.BOSS_DEPTH + 1 && window.__hhState.status === "playing"
  );
  s = await getState(page);
  assert.strictEqual(s.isBoss, false, "the sector past the boss is purely procedural again");
  assert.strictEqual(await page.locator("#runOverlay").isVisible(), false, "continuing closes the victory overlay");
  await page.close();

  // ---- The Hold at dock: refits are drag/tap, free, and live -------------
  // Inject a docked state with a stowed weapon in cargo, then run the
  // refit loop through the real UI: stow the Autocannon (capability lost),
  // reinstall from cargo (capability back). The grid/placement rules are
  // covered exhaustively in engine.test.js; this confirms the screen
  // drives them.
  page = await freshPage(browser, url, errors);
  await page.evaluate(() => {
    const level = window.HypergolicLevels.generateLevel(5);
    const fresh = window.HypergolicEngine.createGameState(level);
    fresh.playerPos = { q: fresh.outpostPos ? fresh.outpostPos.q : fresh.playerPos.q, r: fresh.outpostPos ? fresh.outpostPos.r : fresh.playerPos.r };
    Object.assign(window.__hhState, fresh);
    window.render();
  });
  s = await getState(page);
  if (!s.outpostPos) {
    // This depth happens to deal no Outpost — pick one that does.
    await page.evaluate(() => {
      for (let d = 5; d < 30; d++) {
        const level = window.HypergolicLevels.generateLevel(d);
        const fresh = window.HypergolicEngine.createGameState(level);
        if (fresh.outpostPos) {
          fresh.playerPos = { q: fresh.outpostPos.q, r: fresh.outpostPos.r };
          Object.assign(window.__hhState, fresh);
          window.render();
          return;
        }
      }
    });
    s = await getState(page);
  }
  assert.ok(s.outpostPos, "found a docked fixture");
  await page.evaluate(() => document.getElementById("outpostCloseBtn").click()); // undock the SHOP overlay, stay on the hex
  await page.click("#shipBtn");
  assert.ok(
    (await page.locator("#shipHardpoints").textContent()).includes("docked, free to refit"),
    "the Hold unlocks at a dock"
  );
  // Stow the Autocannon via the engine (drag mechanics are pointer-driven;
  // the engine API is the contract) and confirm the UI + capability follow.
  await page.evaluate(() => {
    const st = window.__hhState;
    const idx = st.hold.items.findIndex((it) => it.id === "autocannon");
    window.HypergolicEngine.stowToCargo(st, idx);
    window.render();
  });
  assert.strictEqual(await page.locator('#holdGrid .hold-tile[data-item-id="autocannon"]').count(), 0, "the stowed Autocannon leaves the grid");
  assert.strictEqual(await page.locator('#holdCargo .hold-cargo-tile[data-item-id="autocannon"]').count(), 1, "and appears in cargo, powered down");
  s = await getState(page);
  assert.strictEqual(s.systems.autocannon, false, "a stowed weapon is UNARMED — cargo is inert");
  // Tap the cargo chip to reinstall it (auto-places in the first free spot).
  await page.click('#holdCargo .hold-cargo-tile[data-item-id="autocannon"]');
  s = await getState(page);
  assert.strictEqual(s.systems.autocannon, true, "reinstalling from cargo re-arms the weapon");
  assert.strictEqual(await page.locator('#holdGrid .hold-tile[data-item-id="autocannon"]').count(), 1, "and the tile is back in the grid");
  await page.close();

  await browser.close();
  server.close();

  assert.deepStrictEqual(errors, [], "no page or console errors during either playthrough");
  console.log("All browser playthrough assertions passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
