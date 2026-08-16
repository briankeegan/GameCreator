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
  const pt = await hexScreenPoint(page, hex);
  await page.mouse.click(pt.x, pt.y);
}

// Where a hex actually IS on screen. The canvas can be laid out at a
// different size than it was drawn at, and this test suite used to ignore
// that — which is how it kept passing while real taps were landing a row
// off on every zoomed locale.
function hexScreenPoint(page, hex) {
  return page.evaluate(({ q, r }) => {
    const c = window.__hhHexCenter(q, r);
    const canvas = document.getElementById("board");
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + c.x * (rect.width / parseFloat(canvas.style.width)),
      y: rect.top + c.y * (rect.height / parseFloat(canvas.style.height)),
    };
  }, { q: hex.q, r: hex.r });
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

// Claims an Outpost offer by matching its button text, rather than
// hardcoding a selector, since the offers are built dynamically from
// Engine.outpostOffers. Buying is TWO taps now: the shelf inspects, and a
// separate button spends the salvage — a single tap used to buy on the
// spot, so a mis-tap cost you the salvage you were saving and a weapon's
// footprint could only be seen by owning it.
async function claimOutpostOffer(page, labelSubstring) {
  await page.click(`#outpostOffers button:has-text("${labelSubstring}")`);
  await page.click("#outpostDetail .outpost-buy");
  return getState(page);
}

// Walks to the wormhole (wherever it is) and returns via it. The flagship
// arrives standing directly ON it ("you start as if you're on top of that
// wormhole, not next to it"), and the return trip is suppressed for as
// long as it stays on that hex — arriving somewhere must never bounce you
// straight back out, and no number of actions taken while parked there
// changes that (Recharge, Raise Shields and firing all used to). Leaving
// the hex arms it permanently, so the way to take a wormhole you spawned
// on is to step off and fly back onto it.
async function walkToWormhole(page) {
  let s = await getState(page);
  const startLevel = s.levelId;
  // Spawned on it? Step off first — the return only arms once we've left.
  if (s.playerPos.q === s.wormholePos.q && s.playerPos.r === s.wormholePos.r) {
    const off = await page.evaluate(
      () => window.HypergolicEngine.legalSublightTargets(window.__hhState)[0]
    );
    await flyTo(page, off);
    s = await getState(page);
  }
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
  // ...but it is never SILENT. A held helm that says nothing is
  // indistinguishable from a frozen game: taps did nothing, no card
  // appeared, no message was written and the screen wasn't even redrawn.
  assert.ok(
    /helm is holding/i.test(s.log[s.log.length - 1]),
    `a Scan tap always says the helm is held (got "${s.log[s.log.length - 1]}")`
  );

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

  // Scan is SESSION-ONLY. It used to be a remembered preference, so
  // leaving it on and closing the tab came back to a ship that could not
  // move, could not fire, and said nothing about why — an input lock
  // persisted to disk.
  await page.click("#scanBtn");
  assert.ok((await page.locator("#scanBtn").getAttribute("class")).includes("active"), "Scan is on");
  await page.reload();
  await page.waitForFunction(() => window.__hhState && window.__hhState.status === "playing");
  assert.ok(
    !(await page.locator("#scanBtn").getAttribute("class")).includes("active"),
    "a reload never comes back with the helm still held"
  );
  assert.strictEqual(await page.locator("#rechargeBtn").isDisabled(), false, "and the controls are live again");


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
  // The readout leads with the gun's FOOTPRINT — where it lands is the
  // interesting thing about it, not a range number — and it DRAWS it,
  // because a sentence describing a hex pattern is a poor substitute for
  // the pattern ("when you select a weapon it should show how it works
  // grid-wise").
  assert.ok(
    /three hexes off the nose/.test(await page.locator("#holdInfo").textContent()),
    "tapping a tile reads out the shape the item covers"
  );
  assert.strictEqual(
    await page.locator("#holdInfo svg.foot polygon").count() > 0,
    true,
    "and draws that shape as a hex field"
  );
  const litCount = await page.locator("#holdInfo svg.foot polygon[stroke='#e0533f']").count();
  assert.strictEqual(litCount, 3, "the Autocannon lights exactly its three hexes");
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
      // Being in reach isn't enough to FIRE — a contact has to be marked
      // first. But the button isn't dead while you decide: with nothing
      // marked it plots the gun's reach instead, which spends nothing.
      const apBeforePlot = s.ap;
      await page.locator(".weapon-btn").first().click();
      assert.strictEqual(
        (await getState(page)).ap,
        apBeforePlot,
        "tapping a gun with nothing marked plots its reach — it never quietly spends the turn"
      );
      await page.locator(".weapon-btn").first().click(); // put the plot away again
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

  // ---- Parked on the arrival hex is INERT, however long you sit there ---
  // The flagship spawns standing ON the wormhole back, and the arrival
  // grace used to be a single-use flag consumed by the first action taken.
  // So the SECOND action while still parked there — Recharge, Raise
  // Shields, a shot, anything — bounced you straight back out. ("Once
  // again, this doesn't work, taking us back.") The grace is positional
  // now: the hex you came in on does nothing until the ship has left it.
  assert.deepStrictEqual(
    { q: s.playerPos.q, r: s.playerPos.r },
    { q: s.wormholePos.q, r: s.wormholePos.r },
    "arriving by warp puts the flagship on the wormhole back"
  );
  for (let i = 0; i < 4; i++) {
    await endRound(page);
    await page.waitForTimeout(600); // long enough for a jump to have fired
    const parked = await getState(page);
    assert.strictEqual(parked.levelId, 2, `action ${i + 1} taken while parked on the wormhole must not jump`);
    assert.strictEqual(parked.status, "playing", "and must not freeze the board");
    if (parked.playerPos.q !== s.wormholePos.q || parked.playerPos.r !== s.wormholePos.r) break;
  }
  s = await getState(page);
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
  // exactly three things ("too many options too soon... why sell so much at
  // every station?"). Three, not two, since the roster went to six shapes —
  // a two-slot shelf measured out as never once offering the Arc Beam
  // across sixty runs.
  s = await walkToOutpost(page);
  assert.ok(await page.locator("#outpostOverlay").isVisible(), "docking opens the Outpost shop");
  assert.strictEqual(
    await page.locator("#outpostOffers button").count(),
    4,
    "a station stocks four things, not a nine-item catalogue"
  );
  await page.click("#outpostCloseBtn");
  assert.strictEqual(await page.locator("#outpostOverlay").isVisible(), false, "Undock closes the panel");

  // ...but the ship never actually LEFT, so tapping the berth it is
  // standing on brings the panel straight back. Without this, "Undock"
  // read as a one-way door you could shut on yourself: the only way back
  // was to fly off the hex and return, and nothing said so.
  s = await getState(page);
  await clickHex(page, "sublight", s.playerPos);
  assert.ok(
    await page.locator("#outpostOverlay").isVisible(),
    "tapping the berth you are standing on re-opens the Outpost"
  );

  // Tapping the shelf INSPECTS; it must not spend anything. And what it
  // shows is the same readout the Hold gives a fitted item — for a weapon
  // that includes the hex footprint it covers, which previously could only
  // be discovered by buying the gun.
  {
    const before = await getState(page);
    await page.click("#outpostOffers button >> nth=0");
    const after = await getState(page);
    assert.strictEqual(after.salvage, before.salvage, "tapping an offer costs nothing — it reads it out");
    assert.strictEqual(after.turnCount, before.turnCount, "and spends no turn");
    assert.ok(await page.locator("#outpostDetail").isVisible(), "the readout opens under the shelf");
    assert.ok(await page.locator("#outpostDetail .outpost-buy").isVisible(), "with a separate button to actually buy");

    // The box never changes size between offers, so the shelf and Undock
    // don't move under your thumb while you're comparing things.
    const undockY = async () => Math.round((await page.locator("#outpostCloseBtn").boundingBox()).y);
    const seen = new Set([await undockY()]);
    const count = await page.locator("#outpostOffers button").count();
    for (let i = 0; i < count; i++) {
      await page.click(`#outpostOffers button >> nth=${i}`);
      seen.add(await undockY());
    }
    assert.strictEqual(seen.size, 1, `Undock stays put while browsing the shelf (saw ${[...seen].join(", ")})`);
  }

  // A dock is for two things, and the panel used to advertise one. The
  // Hold can ONLY be rearranged while berthed, so the refit half of the
  // game lived behind a screen you had to already know about. The button
  // carries that on its own — no paragraph explaining it.
  assert.ok(await page.locator("#outpostRefitBtn").isVisible(), "the panel offers the Hold, not just the shelf");
  await page.click("#outpostRefitBtn");
  assert.ok(await page.locator("#shipOverlay").isVisible(), "and the button takes you straight to the Hold");
  assert.strictEqual(
    await page.locator("#outpostOverlay").isVisible(),
    false,
    "stepping into the Hold steps out of the shop"
  );
  assert.ok(
    /docked/i.test(await page.locator("#shipOverlay").textContent()),
    "the Hold shows itself as docked and refittable, not under way"
  );
  assert.ok(
    await page.locator(".hold-grid.docked").count() > 0,
    "and the grid is in its refittable state"
  );
  await page.click("#shipCloseBtn");
  // Still berthed after all that — the shop is one tap away again.
  s = await getState(page);
  await clickHex(page, "sublight", s.playerPos);
  assert.ok(await page.locator("#outpostOverlay").isVisible(), "still berthed, so the shop comes back");
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

  // Standing on the Warp Gate, because that's where the snapshot was
  // taken. Arriving on it must NOT re-win — the ship has to actually
  // leave the hex and fly back onto it. (Before, any action at all threw
  // you forward from here, which combined with the two-way wormhole into
  // an endless sector ping-pong you couldn't act your way out of.)
  const onGate = { q: s.playerPos.q, r: s.playerPos.r };
  assert.deepStrictEqual(onGate, s.exitPos, "the rewound sector puts us back on its Warp Gate");
  await endRound(page);
  await page.waitForTimeout(700);
  s = await getState(page);
  assert.strictEqual(s.levelId, 1, "an action taken while parked on the gate does NOT re-trigger the jump");
  assert.strictEqual(s.status, "playing", "and the board stays live");

  // Leave the hex, then fly back onto it — that is a real jump.
  const offGate = await page.evaluate(() => window.HypergolicEngine.legalSublightTargets(window.__hhState)[0]);
  await flyTo(page, offGate);
  await flyTo(page, onGate);
  await page.waitForFunction(() => window.__hhState.levelId === 2, null, { timeout: 5000 });
  s = await getState(page);
  assert.strictEqual(s.levelId, 2, "going forward again from a rewound sector re-advances normally");
  // ...and it re-advances into the sector ALREADY CHARTED ahead, not a
  // freshly generated one. advanceSector used to truncate the chart and
  // regenerate unconditionally, so a trip back through a wormhole and
  // forward again silently resurrected everything you'd killed.
  assert.strictEqual(
    s.enemies.filter((e) => e.alive).length,
    0,
    "Sector 2 is the one we cleared — coming back to it must not regenerate it"
  );
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
  // A weapon button with nothing marked is not a dead button — it answers
  // "where does this gun even reach from here", for free, before you
  // commit to anything. ("When you click a weapon and an enemy is not
  // selected, it should show range.")
  {
    if (await page.locator("#shipOverlay").isVisible()) await page.click("#shipCloseBtn");
    await page.evaluate(() => {
      const E = window.HypergolicEngine;
      const st = window.__hhState;
      st.hold.rows += 2;
      for (let y = 0; y < st.hold.rows; y++) {
        let done = false;
        for (let x = 0; x < st.hold.cols && !done; x++) {
          if (E.holdCanPlace(st.hold, "arcBeam", x, y)) { st.hold.items.push({ id: "arcBeam", x, y }); done = true; }
        }
        if (done) break;
      }
      E.syncHoldDerived(st);
      window.render();
    });
    const arc = page.locator('.weapon-btn[data-weapon="arcBeam"]');
    assert.strictEqual(await arc.isDisabled(), false, "with nothing marked, a gun you can afford is still worth tapping");
    await arc.click();
    const reach = await page.evaluate(() => {
      const r = window.__hhReachPreview;
      if (!r) return null;
      const E = window.HypergolicEngine;
      const me = window.__hhState.playerPos;
      const dists = [...r.hexes].map((k) => {
        const [q, e] = k.split(",").map(Number);
        return E.hexDistance(me, { q, r: e });
      });
      return { kind: r.kind, key: r.weaponKey, n: r.hexes.size, dists: [...new Set(dists)] };
    });
    assert.ok(reach, "tapping it plots the gun's reach");
    assert.strictEqual(reach.kind, "attack", "in the colour weapons always wear");
    assert.strictEqual(reach.key, "arcBeam", "for THAT gun, not whichever fired last");
    // The plot is clipped to the board, so the COUNT depends on where the
    // ship happens to be standing. The shape doesn't: every hex it plots
    // is exactly two out, hole in the middle and all.
    assert.ok(reach.n > 0, "the Arc Beam plots something");
    assert.deepStrictEqual(reach.dists, [2], "and every hex of it is exactly two out — the shell, with its hole");
    assert.ok(
      ((await arc.getAttribute("class")) || "").includes("active"),
      "and the button shows it's the one doing the talking"
    );
    await arc.click();
    assert.strictEqual(await page.evaluate(() => window.__hhReachPreview), null, "tapping again puts the plot away");
    assert.strictEqual(
      await page.evaluate(() => window.__hhState.ap),
      await page.evaluate(() => window.__hhState.maxAp),
      "asking the question costs nothing — no AP, no energy"
    );
  }

  // The nose you can see and the facing the engine fires from are the same
  // thing. They used to come apart: landing a shot swung the sprite round
  // to point at whatever it hit, while state.facing never moved — so from
  // the next round the ship appeared to aim one way and every arc weapon,
  // and the reach preview, worked off another. ("When I select the gun it
  // shows where it can hit incorrectly.")
  {
    const noseMatchesFacing = () =>
      page.evaluate(() => {
        const st = window.__hhState;
        const drawn = window.__hhShipAngle;
        const want = window.__hhDirAngles[st.facing];
        // Degrees wrap; compare the short way round.
        const off = Math.abs(((drawn - want + 540) % 360) - 180);
        return { facing: st.facing, drawn: Math.round(drawn), want: Math.round(want), off: Math.round(off) };
      });

    let aim = await noseMatchesFacing();
    assert.strictEqual(aim.off, 0, `a fresh ship's nose matches its facing (drawn ${aim.drawn}, facing ${aim.facing})`);

    // Park a hostile off the nose and shoot it — the case that used to lie.
    await page.evaluate(() => {
      const st = window.__hhState;
      const e = st.enemies.find((x) => x.alive) || st.enemies[0];
      e.alive = true;
      e.hp = 1;
      e.q = st.playerPos.q - 1;
      e.r = st.playerPos.r;
      st.energy = st.maxEnergy;
      window.render();
    });
    const target = await page.evaluate(() => window.__hhState.enemies.find((x) => x.alive));
    await clickHex(page, "sublight", target);
    const gun = page.locator(".weapon-btn:not([disabled])").first();
    if (await gun.count()) {
      await gun.click();
      await page.waitForTimeout(900);
      aim = await noseMatchesFacing();
      assert.strictEqual(aim.off, 0, `after firing, the nose still matches facing (drawn ${aim.drawn}, facing ${aim.facing})`);
    }

    // ...and the reach plot agrees with the nose, which is the thing the
    // player actually reads off the board.
    const agrees = await page.evaluate(() => {
      const E = window.HypergolicEngine;
      const st = window.__hhState;
      const fromFacing = E.weaponHexes(st.playerPos, st.facing, E.WEAPONS.autocannon, st).map(E.hexKey).sort();
      const fromDrawn = E.weaponHexes(st.playerPos, window.__hhDirAngles.indexOf(window.__hhShipAngle), E.WEAPONS.autocannon, st).map(E.hexKey).sort();
      return JSON.stringify(fromFacing) === JSON.stringify(fromDrawn);
    });
    assert.ok(agrees, "the hexes a gun covers are the hexes off the nose you can see");
  }

  // The board can never be left deaf to input. A flight used to swallow
  // every tap until it finished, and handleAction's render() sat outside
  // its own try/catch — so one throw mid-route left `autoRoute` set and
  // the whole board stopped responding: no moving, no firing, no way out
  // but a reload. ("On this map I can't move or attack.")
  {
    // Lay a long course and confirm it, then tap again mid-flight.
    const far = await page.evaluate(() => {
      const st = window.__hhState;
      return st.exits && st.exits[0] ? { q: st.exits[0].q, r: st.exits[0].r } : null;
    });
    if (far) {
      await clickHex(page, "sublight", far); // lay in
      await clickHex(page, "sublight", far); // confirm — the burn starts
      await page.waitForTimeout(120);
      const flying = await page.evaluate(() => window.__hhAutoRoute !== null);
      if (flying) {
        await clickHex(page, "sublight", far); // a tap DURING the flight
        assert.strictEqual(
          await page.evaluate(() => window.__hhAutoRoute),
          null,
          "a tap mid-flight aborts the course instead of being swallowed"
        );
      }
      // ...and whatever happened, the controls answer again.
      await page.waitForFunction(() => window.__hhAutoRoute === null, null, { timeout: 15000 });
      const alive = await page.evaluate(() => {
        const st = window.__hhState;
        return st.status !== "playing" || window.__hhAutoRoute === null;
      });
      assert.ok(alive, "the board is taking input again once the burn ends");
    }
  }

  // Every hostile class has a hull of its own. This used to be an if-chain
  // with three branches and a fallback, so the Mortar Platform and the
  // Lancer both rendered as Interceptors — byte for byte — while finished
  // art for them sat unreferenced in icons/. A class either has a sprite
  // or it visibly has none; two classes never share one.
  {
    const fleet = await page.evaluate(() => {
      const classes = Object.keys(window.HypergolicEngine.ENEMY_TYPES);
      const sprites = window.__hhEnemySprites || {};
      return classes.map((c) => ({
        type: c,
        src: sprites[c] ? sprites[c].src.split("/").pop() : null,
        loaded: sprites[c] ? sprites[c].complete && sprites[c].naturalWidth > 0 : false,
      }));
    });
    for (const ship of fleet) {
      assert.ok(ship.src, `${ship.type} has a sprite of its own, not a fallback to somebody else's hull`);
      assert.ok(ship.loaded, `${ship.type}'s sprite (${ship.src}) actually loads`);
    }
    const srcs = fleet.map((f) => f.src);
    assert.strictEqual(new Set(srcs).size, srcs.length, `no two classes share a hull (${srcs.join(", ")})`);
  }

  // Every gun carries its own module art on its Hold tile. A CSS
  // background that 404s fails silently — the tile just looks like the
  // coloured rectangle it used to be — so this checks the files actually
  // decode, not merely that a url() got set.
  {
    const icons = await page.evaluate(async () => {
      const E = window.HypergolicEngine;
      const out = [];
      for (const key of E.WEAPON_SYSTEM_KEYS) {
        const src = `icons/weapon-${key}.png`;
        const ok = await new Promise((res) => {
          const img = new Image();
          img.onload = () => res(img.naturalWidth > 0);
          img.onerror = () => res(false);
          img.src = src;
        });
        out.push({ key, src, ok });
      }
      return out;
    });
    for (const icon of icons) {
      assert.ok(icon.ok, `${icon.key} has module art that loads (${icon.src})`);
    }
    // ...and the tile in the Hold is actually wired to it.
    const tile = await page.evaluate(() => {
      const el = document.querySelector('#holdGrid .hold-tile[data-item-id="autocannon"]');
      return el ? { icon: el.classList.contains("has-icon"), bg: el.style.backgroundImage } : null;
    });
    assert.ok(tile && tile.icon, "a weapon tile is marked as carrying art");
    assert.ok(/weapon-autocannon\.png/.test(tile.bg), `and points at its own module (${tile && tile.bg})`);
  }

  // A tap must land on the hex you aimed at. This is the one that got
  // away: a locale's "zoom" multiplied the hex size AFTER the board had
  // been fitted, so the canvas element came out bigger than its box and
  // the browser squashed it horizontally only — laid out at 0.898 across
  // and 1.0 down. The tap handler converted screen pixels to hexes with a
  // single scale factor, so vertical taps landed up to a whole hex low and
  // taps near the bottom edge, where the flagship normally sits, fell off
  // the board and did nothing at all. Measured on the old code: 67 of 90
  // taps on a shallows board hit the wrong hex.
  //
  // Scan mode is used to sweep because a tap there only inspects — no
  // move, no turn spent.
  {
    const before = await page.evaluate(() => document.getElementById("scanBtn").classList.contains("active"));
    if (!before) await page.click("#scanBtn");
    let taps = 0;
    const wrong = [];
    for (const idx of [0, 6, 9]) {
      await page.evaluate((i) => window.loadSector(i, { hasPrevious: i > 0 }), idx);
      await page.waitForTimeout(60);
      if (!(await page.evaluate(() => document.getElementById("scanBtn").classList.contains("active")))) {
        await page.click("#scanBtn");
      }
      const info = await page.evaluate(() => ({
        locale: (window.__hhState.locale || {}).id || "campaign",
        hexes: window.__hhState.boardHexes.slice(),
      }));
      for (const h of info.hexes) {
        const pt = await hexScreenPoint(page, h);
        await page.mouse.click(pt.x, pt.y);
        const got = await page.evaluate(() => window.__hhGetInspected());
        taps++;
        if (!got || got.q !== h.q || got.r !== h.r) {
          wrong.push(`${info.locale} wanted ${h.q},${h.r} got ${got ? got.q + "," + got.r : "nothing"}`);
        }
      }
      // The canvas must also never be laid out at a size it wasn't drawn
      // at — that mismatch is what broke the mapping in the first place.
      const fit = await page.evaluate(() => {
        const c = document.getElementById("board");
        const r = c.getBoundingClientRect();
        return { xs: r.width / parseFloat(c.style.width), ys: r.height / parseFloat(c.style.height) };
      });
      assert.ok(
        Math.abs(fit.xs - 1) < 0.01 && Math.abs(fit.ys - 1) < 0.01,
        `${info.locale}: the board is drawn at the size it is laid out at (x ${fit.xs.toFixed(3)}, y ${fit.ys.toFixed(3)})`
      );
    }
    assert.deepStrictEqual(wrong, [], `every one of ${taps} taps landed on the hex it was aimed at`);
    await page.click("#scanBtn"); // back out of Scan
  }

  // A plotted course has to actually FLY. The burn used to abort the
  // instant hull dropped, and since every step of a course is a full
  // round — enemy phase and all — anything shooting at you ended the
  // course on its first step. Measured before the fix: asked for 9 hexes,
  // flew 1; asked for 12, flew 2; asked for 10, flew 1. Re-plotting just
  // repeated it, so movement across a contested board degraded to one hex
  // per double-tap and read, correctly, as "I can only click two away".
  {
    // A controlled board: one chaser in contact so damage is certain, and
    // a long clear lane to run down.
    const flight = await page.evaluate(() => {
      const E = window.HypergolicEngine;
      const st = window.__hhState;
      st.hazards = [];
      st.hull = st.maxHull;
      st.shieldCharges = 0;
      // Put the flagship at one end of the longest column available.
      const col = st.playerPos.q;
      const lane = st.boardHexes.filter((h) => h.q === col).sort((a, b) => a.r - b.r);
      st.playerPos = { q: lane[lane.length - 1].q, r: lane[lane.length - 1].r };
      const def = E.ENEMY_TYPES.interceptor;
      st.enemies = [
        {
          id: "chase", type: "interceptor", alive: true,
          q: st.playerPos.q, r: st.playerPos.r - 1,
          hp: def.maxHull, maxHp: def.maxHull,
          energy: def.ship.maxEnergy, maxEnergy: def.ship.maxEnergy,
          shieldCharges: 0, maxShields: 0,
        },
      ];
      window.render();
      return { from: { ...st.playerPos }, target: lane[0], hull: st.hull };
    });
    const askedFor = await page.evaluate(
      ({ a, b }) => window.HypergolicEngine.hexDistance(a, b), { a: flight.from, b: flight.target }
    );
    assert.ok(askedFor >= 5, `the fixture lane is worth flying (${askedFor} hexes)`);
    await flyTo(page, flight.target);
    const after = await getState(page);
    const flew = await page.evaluate(
      ({ a, b }) => window.HypergolicEngine.hexDistance(a, b), { a: flight.from, b: after.playerPos }
    );
    assert.ok(after.hull < flight.hull, "the fixture really does take fire mid-burn (otherwise this proves nothing)");
    assert.ok(
      flew > 1,
      `a course under fire flies on: asked for ${askedFor}, flew ${flew}, hull ${flight.hull} -> ${after.hull}`
    );
    // ...and when it does stop, the rest of the course stays laid in, so
    // one tap resumes rather than starting the whole plot over.
    if (flew < askedFor && after.status === "playing") {
      const resumable = await page.evaluate(() => Boolean(window.__hhPlannedPath));
      assert.ok(resumable, "a held course leaves its remainder plotted");
    }
  }

  // A course must never refuse to move at ALL. An earlier attempt at the
  // fix above stopped any burn while hull was at 1, which checked BEFORE
  // taking a step — so on a low hull the ship sat still however far you
  // asked it to go. That is the same lockout wearing a different hat.
  {
    const lowHull = await page.evaluate(() => {
      const st = window.__hhState;
      st.enemies = [];
      st.hazards = [];
      st.hull = 1;
      const col = st.playerPos.q;
      const lane = st.boardHexes.filter((h) => h.q === col).sort((a, b) => a.r - b.r);
      st.playerPos = { q: lane[lane.length - 1].q, r: lane[lane.length - 1].r };
      window.render();
      return { from: { ...st.playerPos }, target: lane[0] };
    });
    await flyTo(page, lowHull.target);
    const after = await getState(page);
    assert.deepStrictEqual(
      { q: after.playerPos.q, r: after.playerPos.r },
      { q: lowHull.target.q, r: lowHull.target.r },
      "on a clear board a course flies its whole length, whatever the hull is down to"
    );
  }

  // Blowing the scuttling charges is something you WATCH. The ship comes
  // apart on the Systems screen you armed them from, and only once the
  // fire is out does the run reset ("show the ship explode").
  {
    if (!(await page.locator("#shipOverlay").isVisible())) await page.click("#shipBtn");
    await page.click("#selfDestructBtn"); // arms
    assert.ok(
      (await page.locator("#selfDestructBtn").textContent()).includes("CONFIRM"),
      "one tap arms the charges and says so — it never just ends the run"
    );
    await page.click("#selfDestructBtn"); // fires
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator("#scuttleFx").isVisible(), true, "the charges go off on screen");
    assert.ok(
      ((await page.locator("#shipPortrait").getAttribute("class")) || "").includes("scuttling"),
      "and the hull is coming apart while they do"
    );
    assert.strictEqual(await page.locator("#shipOverlay").isVisible(), true, "the screen holds through the blast");
    await page.waitForTimeout(1400);
    assert.strictEqual(await page.locator("#scuttleFx").isVisible(), false, "the fire goes out");
    assert.strictEqual(await page.locator("#shipOverlay").isVisible(), false, "then the screen clears");
    const after = await getState(page);
    assert.strictEqual(after.levelId, 1, "and the fresh hull is back at the start of the crawl");
    assert.strictEqual(after.hull, after.maxHull, "undamaged — nothing carried over");
  }

  // Every place looks like itself. Six sectors that differ only by a hue
  // shift behind an identical white lattice are six copies of one board —
  // "they all look basically the same". So: each locale gets its own sky
  // AND its own grid, and no two are the same.
  {
    const looks = await page.evaluate(() => {
      const ids = window.HypergolicLevels.LOCALES.map((l) => l.id);
      return ids.map((id) => ({
        id,
        sky: (window.__hhLooks.SKIES[id] || []).join("|"),
        grid: JSON.stringify(window.__hhLooks.GRID_LOOKS[id] || null),
      }));
    });
    for (const look of looks) {
      assert.ok(look.sky, `${look.id} has a sky of its own, not a formula off its hue`);
      assert.ok(look.grid !== "null", `${look.id} lights its grid its own way`);
    }
    assert.strictEqual(new Set(looks.map((l) => l.sky)).size, looks.length, "no two places share a sky");
    assert.strictEqual(new Set(looks.map((l) => l.grid)).size, looks.length, "no two places share a lattice");

    // ...and a place's colour MEANS that place. The gate that leads there,
    // the line to it on the chart, the grid you fly over and the sky you
    // arrive under all carry the locale's own hue. A gate that promised
    // violet and dropped you somewhere amber would make the tell worthless.
    const hues = await page.evaluate(() => {
      // Pull the hue back out of the hand-tuned sky and grid so we're
      // checking the ART, not the table that generated it.
      const hueOfRgb = (r, g, b) => {
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        if (mx === mn) return null;
        const d = mx - mn;
        let h;
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        return ((h * 60) % 360 + 360) % 360;
      };
      return window.HypergolicLevels.LOCALES.map((l) => {
        const sky = window.__hhLooks.SKIES[l.id][0].match(/hsl\((\d+)/);
        const grid = window.__hhLooks.GRID_LOOKS[l.id].stroke.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return {
          id: l.id,
          locale: l.hue,
          sky: Number(sky[1]),
          grid: hueOfRgb(Number(grid[1]), Number(grid[2]), Number(grid[3])),
        };
      });
    });
    const apart = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    for (const h of hues) {
      assert.ok(apart(h.locale, h.sky) <= 20, `${h.id}: the sky is the colour the place is (${h.sky} vs ${h.locale})`);
      assert.ok(apart(h.locale, h.grid) <= 35, `${h.id}: so is the grid over it (${h.grid} vs ${h.locale})`);
    }
    // Ten places, ten hues, none of them close enough to be confused for
    // each other at a glance.
    const spread = hues.map((h) => h.locale).sort((a, b) => a - b);
    for (let i = 1; i < spread.length; i++) {
      assert.ok(spread[i] - spread[i - 1] >= 15, `places are told apart by colour alone (${spread[i - 1]} vs ${spread[i]})`);
    }
  }

  await page.close();

  await browser.close();
  server.close();

  assert.deepStrictEqual(errors, [], "no page or console errors during either playthrough");
  console.log("All browser playthrough assertions passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
