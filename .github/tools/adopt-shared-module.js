#!/usr/bin/env node
"use strict";
/**
 * Wire a game's index.html and sw.js onto shared/controls.js and/or
 * shared/save-slots.js — the mechanical half of adopting either module.
 *
 * WHY THIS EXISTS. Migrating Dog Punk onto both modules by hand meant
 * remembering, separately: add a <script> tag in the right spot, add the
 * same path to sw.js's precache array, bump the cache version so the PWA
 * actually picks up the change. None of that is a judgement call — it's
 * the same three edits every time, in the same shape, and sync-precache.js
 * (in .github/autopilot/) now GATES exactly this: it fails the build if a
 * game's own JS calls GCControls.create()/GCSaveSlots.create() without the
 * matching script tag and precache entry. This tool is what makes that
 * gate quick to satisfy instead of another manual hunt-and-fix.
 *
 * WHAT THIS DOES NOT DO, ON PURPOSE. The actual gameplay wiring — which
 * keys map to which of YOUR actions, what your save file's shape is, and a
 * settings/pause screen that looks like YOUR game rather than an imported
 * widget — is a judgement call about that specific game, the same reason
 * sync-precache.js's own header explains why it won't guess a precache
 * list either. Scripting it would produce confident, wrong boilerplate for
 * a game shaped differently from whichever one it was copied from. See
 * games/dog-punk/app.js (search "CONTROLS" and "SAVES") for a worked
 * example to adapt from, not to copy verbatim — the Newsey migration
 * (games/the-game/settings.js + saves.js) is a second, differently-shaped
 * example, since Newsey already had its own settings/save system to
 * extract rather than build fresh.
 *
 *   node adopt-shared-module.js <gameId> <controls|save-slots|title-screen|all>
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

const MODULES = {
  controls: "../../shared/controls.js",
  "save-slots": "../../shared/save-slots.js",
  "title-screen": "../../shared/title-screen.js",
};

function wireHtml(htmlPath, modulePath) {
  let html = fs.readFileSync(htmlPath, "utf8");
  if (html.includes(modulePath)) return { html, changed: false };
  const tag = `  <script src="${modulePath}"></script>\n`;
  // Insert right after shared/storage.js if present (every game that could
  // plausibly want either module already loads it) — else right before the
  // first script tag that isn't nav.js/pwa.js, which is almost always the
  // game's own entry point and needs both modules defined before it runs.
  const storageMatch = html.match(/^[ \t]*<script src="[^"]*shared\/storage\.js"[^>]*><\/script>\r?\n/m);
  if (storageMatch) {
    const at = storageMatch.index + storageMatch[0].length;
    html = html.slice(0, at) + tag + html.slice(at);
    return { html, changed: true };
  }
  const scriptTags = [...html.matchAll(/^[ \t]*<script\b[^>]*src="([^"]+)"[^>]*><\/script>\r?\n/gm)];
  const ownEntry = scriptTags.find((m) => !/shared\/(nav|pwa|storage)\.js/.test(m[1]));
  if (ownEntry) {
    html = html.slice(0, ownEntry.index) + tag + html.slice(ownEntry.index);
    return { html, changed: true };
  }
  throw new Error(`could not find a safe insertion point in ${htmlPath} — add the <script> tag by hand`);
}

// title-screen gets a THIRD wiring step the other two modules don't need:
// scaffolding the actual title-layer markup + CSS, not just a script tag.
// controls/save-slots are pure logic — GCControls.create(...) has nothing
// to look at. A title screen is a whole screen; leaving it to "wire the
// script tag, figure out the rest" is what produced Dog Punk's first pass
// (mechanically correct, wired, gated — and a placeholder nobody would
// mistake for that game's own title screen) and, worse, meant the NEXT game
// to adopt this module had to reinvent the same markup from nothing. This
// scaffolds something that already works end to end: full-screen gate,
// Start/Continue, a portrait canvas. What's left is retinting it to the
// game's own colours and wiring onShow to draw the game's own art — a
// judgement call about that game's own sprite representation, the same
// reason gameplay wiring for the other two modules isn't scripted either.
function wireTitleScreenMarkup(htmlPath, cssPath, gameName) {
  let html = fs.readFileSync(htmlPath, "utf8");
  if (/id="titleLayer"/.test(html)) return { html, changed: false };
  const mainTag = html.match(/<main\b[^>]*>/);
  if (!mainTag) {
    throw new Error(`${htmlPath}: no <main ...> tag found — add the title-layer markup by hand ` +
                    `(see shared/title-screen.js's header, or games/dog-punk/index.html for a worked example)`);
  }
  const at = mainTag.index + mainTag[0].length;
  const block = `
    <!-- Full-screen boot gate, scaffolded by adopt-shared-module.js —
         shared/title-screen.js shows/hides this and decides START vs
         CONTINUE. RETINT THIS to ${gameName}'s own colours (see the
         matching CSS block, marked the same way) and wire onShow to draw
         ${gameName}'s own character art on the portrait canvas instead of
         leaving it blank — a logo and a button is a placeholder, not a
         title screen. See shared/title-screen.js's header for the onShow
         contract, and games/dog-punk/app.js (search "drawTitlePortrait")
         for a worked example. -->
    <div class="title-layer" id="titleLayer">
      <canvas class="title-portrait" id="titlePortrait" width="64" height="64"></canvas>
      <div class="title-logo">${gameName}</div>
      <button class="title-start" id="titleStart">Start</button>
      <button class="title-continue" id="titleContinue" hidden>Continue</button>
    </div>
`;
  html = html.slice(0, at) + block + html.slice(at);
  return { html, changed: true };
}

function wireTitleScreenCss(cssPath) {
  let css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";
  if (css.includes(".title-layer")) return { css, changed: false };
  const block = `
/* Boot gate, scaffolded by adopt-shared-module.js — RETINT to match this
   game's own colours (the accent below, #f2b179, is a placeholder). Solid
   background on purpose, not a gradient: a radial gradient's falloff can
   stay translucent near an element's edge on a wide/short box, letting
   whatever's underneath bleed through faintly — found the hard way on Dog
   Punk, where it let the HUD show behind a "hidden" title screen. */
.title-layer[hidden] { display: none; }
.title-layer {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: #14121a;
  color: #eef0e2;
}
.title-portrait {
  width: 96px;
  height: 96px;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}
.title-logo {
  font-size: 2.4rem;
  font-weight: 800;
  letter-spacing: 0.02em;
}
.title-start, .title-continue {
  background: #f2b179;
  color: #201a12;
  border: none;
  font-weight: 700;
  padding: 12px 32px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1rem;
}
.title-continue {
  background: transparent;
  border: 2px solid #f2b179;
  color: #f2b179;
}
`;
  css = css.replace(/\s*$/, "\n") + block;
  return { css, changed: true };
}

function wireServiceWorker(swPath, modulePath) {
  let sw = fs.readFileSync(swPath, "utf8");
  const m = sw.match(/GCRegisterServiceWorker\(\s*"([^"]+)"\s*,\s*\[([\s\S]*?)\]\s*\)/);
  if (!m) throw new Error(`${swPath}: unrecognised GCRegisterServiceWorker(...) shape`);
  const [whole, cacheName, listBody] = m;
  if (listBody.includes(modulePath)) return { sw, changed: false };

  const bumped = cacheName.replace(/-v(\d+)$/, (_, n) => `-v${parseInt(n, 10) + 1}`);
  if (bumped === cacheName) {
    throw new Error(`${swPath}: cache name "${cacheName}" doesn't end in -vN — bump it by hand`);
  }
  const storageLine = listBody.match(/^([ \t]*)"[^"]*shared\/storage\.js",?\r?\n/m);
  let newList;
  if (storageLine) {
    const at = storageLine.index + storageLine[0].length;
    newList = listBody.slice(0, at) + `${storageLine[1]}"${modulePath}",\n` + listBody.slice(at);
  } else {
    newList = listBody.replace(/\s*$/, "") + `,\n  "${modulePath}",\n`;
  }
  sw = sw.replace(whole, `GCRegisterServiceWorker("${bumped}", [${newList}])`);
  return { sw, changed: true };
}

function findGameCss(gameDir, htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const links = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  const own = links.find((href) => !/shared\/nav\.css/.test(href));
  return own ? path.join(gameDir, own) : null;
}

function gameDisplayName(gameId) {
  const gamesJsonPath = path.join(ROOT, "games.json");
  if (fs.existsSync(gamesJsonPath)) {
    const data = JSON.parse(fs.readFileSync(gamesJsonPath, "utf8"));
    const entry = (data.games || []).find((g) => g.id === gameId);
    if (entry && entry.name) return entry.name;
  }
  return gameId.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function main() {
  const [gameId, which] = process.argv.slice(2);
  if (!gameId || !which) {
    console.error("usage: node adopt-shared-module.js <gameId> <controls|save-slots|title-screen|all>");
    process.exit(1);
  }
  const modules = (which === "all" || which === "both") ? Object.keys(MODULES) : [which];
  for (const name of modules) {
    if (!MODULES[name]) {
      console.error(`unknown module "${name}" — choices: ${Object.keys(MODULES).join(", ")}, both`);
      process.exit(1);
    }
  }

  const gameDir = path.join(ROOT, "games", gameId);
  if (!fs.existsSync(gameDir)) {
    console.error(`games/${gameId} does not exist`);
    process.exit(1);
  }
  const htmlPath = path.join(gameDir, "index.html");
  const swPath = path.join(gameDir, "sw.js");

  for (const name of modules) {
    const modulePath = MODULES[name];
    let anyChange = false;

    const { html, changed: htmlChanged } = wireHtml(htmlPath, modulePath);
    if (htmlChanged) { fs.writeFileSync(htmlPath, html); anyChange = true; }

    const { sw, changed: swChanged } = wireServiceWorker(swPath, modulePath);
    if (swChanged) { fs.writeFileSync(swPath, sw); anyChange = true; }

    console.log(anyChange
      ? `games/${gameId}: wired shared/${name}.js into index.html + sw.js (cache version bumped)`
      : `games/${gameId}: shared/${name}.js already wired — nothing to do`);

    if (name === "title-screen") {
      const cssPath = findGameCss(gameDir, htmlPath);
      if (!cssPath) {
        console.log(`games/${gameId}: no game-specific <link rel="stylesheet"> found in index.html — ` +
                    `add the title-layer markup/CSS by hand (see games/dog-punk for a worked example)`);
      } else {
        // Re-read: wireHtml above may have already rewritten this file.
        const { html: html2, changed: markupChanged } =
          wireTitleScreenMarkup(htmlPath, cssPath, gameDisplayName(gameId));
        if (markupChanged) { fs.writeFileSync(htmlPath, html2); }

        const { css, changed: cssChanged } = wireTitleScreenCss(cssPath);
        if (cssChanged) { fs.writeFileSync(cssPath, css); }

        console.log((markupChanged || cssChanged)
          ? `games/${gameId}: scaffolded #titleLayer markup + starter CSS in ${path.relative(ROOT, cssPath)}`
          : `games/${gameId}: title-layer markup already present — nothing to scaffold`);
      }
    }
  }

  console.log("");
  console.log("That's the mechanical half only. Still needed, by hand:");
  if (modules.includes("controls")) {
    console.log("  - controls: define your actions/defaultKeys/defaultPad, call");
    console.log("    GCControls.create(gameId, {...}), and wire isDown()/gamepad() into");
    console.log("    your update loop. A rebind SCREEN in your own HTML/CSS style, if you");
    console.log("    want one — see games/dog-punk/app.js (search \"CONTROLS\") or");
    console.log("    games/the-game/settings.js for two differently-styled examples.");
  }
  if (modules.includes("save-slots")) {
    console.log("  - save-slots: define blank()/normalize() for YOUR save shape, decide");
    console.log("    how many slots, and call SAVES.write()/.read() at the right moments");
    console.log("    (room transitions, etc.) — see games/dog-punk/app.js (search \"SAVES\")");
    console.log("    or games/the-game/saves.js for two differently-shaped examples.");
  }
  if (modules.includes("title-screen")) {
    console.log("  - title-screen: the #titleLayer markup + starter CSS are scaffolded and");
    console.log("    WORK as-is (full-screen gate, Start/Continue) — but the colours are a");
    console.log("    generic placeholder (#f2b179/#14121a), not this game's own. RETINT the");
    console.log("    CSS block marked \"scaffolded by adopt-shared-module.js\" to match.");
    console.log("    Wire the JS: GCTitleScreen.create(gameId, {layerEl: #titleLayer,");
    console.log("    startBtn: #titleStart, continueBtn: #titleContinue, hasSave, onStart,");
    console.log("    onContinue}), then TITLE.show() once on boot — nothing else should run");
    console.log("    before it. If your game has no save yet, adopt save-slots FIRST so");
    console.log("    hasSave() has something real to check.");
    console.log("    A LOGO AND A BUTTON IS A PLACEHOLDER, NOT A TITLE SCREEN — it will pass");
    console.log("    every mechanical check here while looking like it could be any game's");
    console.log("    title screen (this happened on Dog Punk, even after scaffolding). Pass");
    console.log("    onShow to draw THIS game's own character art on the #titlePortrait");
    console.log("    canvas, the same way a chapter-intro cutscene draws a portrait — see");
    console.log("    games/dog-punk/app.js (search \"drawTitlePortrait\") for a worked example,");
    console.log("    and shared/title-screen.js's header for the onShow contract.");
    console.log("    sync-precache.js warns (does not fail) if onShow is missing, in case a");
    console.log("    game genuinely has no art to show.");
  }
  console.log("Run node .github/autopilot/sync-precache.js after to confirm the wiring gate passes.");
}

main();
