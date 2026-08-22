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
    console.log("  - title-screen: a full-screen title layer (YOUR markup/CSS) covering");
    console.log("    the whole game area, with a start button and (if you have a save)");
    console.log("    a continue button, wired via GCTitleScreen.create(gameId, {layerEl,");
    console.log("    startBtn, continueBtn, hasSave, onStart, onContinue}). Call .show()");
    console.log("    once on boot — nothing else should run before it. If your game has no");
    console.log("    save yet, adopt save-slots FIRST so hasSave() has something real to");
    console.log("    check. See games/dog-punk/app.js (search \"TITLE\") once wired.");
  }
  console.log("Run node .github/autopilot/sync-precache.js after to confirm the wiring gate passes.");
}

main();
