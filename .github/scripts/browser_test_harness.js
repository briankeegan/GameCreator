// Shared plumbing for a game's browser.test.js — the real-UI playthrough
// suite that complements engine.test.js (see games/hypergolic-hull's and
// games/trebor's for the established shape: Node's own `assert`, one big
// scripted playthrough, comments tied to real reported bugs). Extracted
// from hypergolic-hull's copy of this exact boilerplate so a new game
// doesn't have to hand-roll its own HTTP server and error plumbing —
// that part is identical for every game; only "how do I reach a testable
// state" (clicking through a title screen, seeding a save, whatever) is
// actually game-specific and stays in each game's own file.
//
// HOW TO ADD browser.test.js FOR A NEW GAME
// ------------------------------------------
// 1. `const { serveRepo, launchBrowser, freshPage } = require("../../.github/scripts/browser_test_harness");`
// 2. In an async IIFE: `const server = await serveRepo(); const url =
//    \`http://127.0.0.1:${server.address().port}/games/<id>/index.html\`;
//    const browser = await launchBrowser(); const errors = [];`
// 3. Get one page per fresh run with `freshPage(browser, url, errors)` —
//    it wires up pageerror/console-error collection and clears
//    localStorage before returning. It does NOT know how to get your
//    game into a "ready to test" state (title screens, save slots, and
//    boot sequences all differ) — do that yourself right after, the same
//    way hypergolic-hull's freshPage() wraps this one and waits for its
//    own `window.__hhState.status === "playing"`.
// 4. Read game state through whatever debug hook your game already
//    exposes (or add one — see the-game's `window.__newseyDebug`, a
//    read-only object with no gameplay effect, added for exactly this).
//    Drive it through the real UI (clicks/keys), not by calling internal
//    functions directly — the whole point is exercising the actual wiring
//    a player hits, the same reasoning engine.test.js already covers the
//    rules headlessly.
// 5. ALWAYS finish with:
//      await browser.close(); server.close();
//      assert.deepStrictEqual(errors, [], "no page or console errors during the playthrough");
// 6. Run it: `NODE_PATH="$(npm root -g)" node games/<id>/browser.test.js`
//    (needs Playwright + a Chromium binary — set CHROMIUM_PATH if it's
//    not at the default /opt/pw-browsers/chromium).
// 7. This is deliberately NOT part of the pages.yml pre-deploy gate —
//    Playwright/Chromium browser tests have shown real timing flakiness
//    in that environment, which would risk blocking every game's deploy
//    over one game's unrelated animation timing. Run it by hand, or wire
//    it into its own non-blocking workflow_dispatch if a game wants CI
//    coverage badly enough to accept that trade-off.
// 8. Testing a room-to-room door/exit? Use approachPosition(exitBox,
//    direction) below instead of typing an x/y next to the door by hand
//    — read the exit's own box out of the game's story data and compute
//    the starting spot from it. See the-game's browser.test.js DOOR_CASES
//    for the pattern (declare {room, to, direction}, look the exit up,
//    derive both the position and the key from that one direction).
//    Then cross it with holdKeyUntilInPage, not a fixed-duration hold or
//    a Node-side poll loop — anything that's true for only one frame
//    right after the crossing (like an arrival-facing snap) gets
//    stomped by the still-held key before a Node poll can react in time.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

// Serves the whole repo over plain HTTP on a free local port. Real HTTP,
// not file://, matters: file:// origins fail same-origin canvas checks
// (getImageData throws "tainted by cross-origin data" the moment anything
// calls it, e.g. a screenshot helper) in a way a real page load never
// does, and the shared PWA plumbing (service workers, manifest fetches)
// doesn't run under file:// either.
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

function launchBrowser() {
  return chromium.launch({ executablePath: CHROMIUM });
}

// One fresh page: error collection wired up, a clean localStorage (so one
// test's save file can't bleed into the next), reloaded so the clear
// actually takes before the caller starts driving it. Push everything
// this returns into a shared `errors` array and assert it's empty at the
// very end of the file — a silently-swallowed exception mid-playthrough
// is exactly the kind of bug a headless engine test can't see at all.
async function freshPage(browser, url, errors, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 900, height: 700 } });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("console: " + msg.text());
  });
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return page;
}

// Direction -> the arrow key that walks it. Exported so a game's own
// door-case table can declare a direction ("up") instead of a raw key
// string, matching approachPosition's vocabulary.
const KEY_FOR_DIRECTION = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };

// Given an exit trigger's own box ({x,y,w,h}, straight from the room's
// `exits` data) and the direction you're about to walk it with, returns a
// starting position safely OUTSIDE the box on the approach side — e.g.
// direction "up" returns a point below the box, since walking up is how
// you'd cross into it from there.
//
// This exists because hand-picking x/y next to a door by eyeballing the
// room's numbers is exactly how a door test breaks: the-game's first
// attempt at a door-case table placed the player ALREADY INSIDE several
// exit boxes it meant to approach with "up" (a coordinate a few pixels
// off from the box's own y-range reads as "just below it" when it's
// actually within it) — exitsArmed never re-arms from inside a trigger,
// so those cases silently never crossed at all. Deriving the position
// from the box itself removes the chance of that mismatch: it can't
// disagree with the data it's testing, because it's computed from that
// same data. A new game's door test should read the exit straight out of
// its own story data (however that game exposes it — the-game reads
// `window.NEWSEY_STORY.ROOMS[id].exits`) and call this instead of typing
// coordinates by hand.
function approachPosition(exitBox, direction, margin = 15) {
  const cx = exitBox.x + exitBox.w / 2, cy = exitBox.y + exitBox.h / 2;
  if (direction === "up") return { x: cx, y: exitBox.y + exitBox.h + margin };
  if (direction === "down") return { x: cx, y: exitBox.y - margin };
  if (direction === "left") return { x: exitBox.x + exitBox.w + margin, y: cy };
  if (direction === "right") return { x: exitBox.x - margin, y: cy };
  throw new Error("approachPosition: direction must be up/down/left/right, got " + direction);
}

// Holds `key` down and releases it the instant `predicateFn()` (a
// zero-arg function evaluated INSIDE THE PAGE, not in Node) becomes true
// — driven by the page's own requestAnimationFrame loop, not polled from
// Node with a setTimeout. That distinction matters whenever what you're
// testing is only true for a single frame while the key is held: this
// game's arriveFacing (set the instant a door crossing lands you in the
// new room) gets overwritten back to the walking direction on the very
// next frame if that direction is still held, because ordinary movement
// recomputes facing from live input every frame. Polling from Node — even
// on a tight interval — always loses that race: there is at least one
// full animation frame of network + event-loop latency between the
// browser crossing the threshold and Node's next poll actually reading
// it and sending a keyup, and that's enough time for the still-held key
// to fire once more and stomp the value being tested. Driving the
// keydown/predicate/keyup loop with requestAnimationFrame from inside the
// page removes that gap: the release happens on the same frame the
// predicate goes true, before the game's own next update() call.
//
// predicateFn must be a plain function with no closure over outer
// variables (it's shipped to the page as source text via toString() and
// reconstructed there) — reference only globals the page itself exposes
// (e.g. `window.__yourGameDebug.room()`).
async function holdKeyUntilInPage(page, key, predicateFn, capMs = 4000) {
  return page.evaluate(
    ({ key, predicateSrc, capMs }) => {
      return new Promise((resolve) => {
        const predicate = new Function("return (" + predicateSrc + ")")();
        window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        const start = performance.now();
        function tick() {
          if (predicate() || performance.now() - start > capMs) {
            window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    },
    { key, predicateSrc: predicateFn.toString(), capMs }
  );
}

module.exports = {
  serveRepo, launchBrowser, freshPage, REPO_ROOT, CHROMIUM,
  KEY_FOR_DIRECTION, approachPosition, holdKeyUntilInPage,
};
