#!/usr/bin/env node
"use strict";
/**
 * Find service-worker precache entries that point at files which do not exist.
 *
 * WHY ONLY THAT HALF. `cache.addAll()` REJECTS if any single URL 404s, so one
 * stale entry means the service worker fails to install AT ALL — the whole
 * offline mode of that game, killed by one renamed sprite. It is also entirely
 * decidable: the list says a path, the path is there or it is not.
 *
 * The other half — "should this file BE in the precache?" — is deliberately
 * NOT checked, and the first version of this script was wrong to try. It
 * concluded that Trebor should precache three hundred card icons and that
 * every game should precache its test files, because "an asset exists" says
 * nothing about whether the game needs it before first paint. That is a
 * judgement about the game, so it stays with whoever is writing the game;
 * scripting it would have produced confident, wrong rewrites of eight games.
 *
 * Script what is decidable. Do not dress a guess up as a check.
 *
 * A SECOND decidable check lives here too: a game whose own JS calls
 * window.GCControls.create(...), window.GCSaveSlots.create(...), or
 * window.GCTitleScreen.create(...) (the shared/controls.js,
 * shared/save-slots.js and shared/title-screen.js modules) but doesn't load
 * that script in its index.html, or doesn't precache it in sw.js, ships
 * broken (ReferenceError at load) or goes stale offline (works online,
 * breaks the moment the PWA is actually offline) — caught for real
 * migrating Dog Punk onto both modules by hand, where every one of these
 * was a separate thing to remember. "Does this game's code reference the
 * module" and "is the module's script tag/precache entry present" are both
 * plain text search, not a judgement call, so it belongs in this same gate
 * rather than staying something a human (or a model) has to remember.
 *
 *   node sync-precache.js            report; exit 1 if anything is wrong
 *   node sync-precache.js --fix      drop stale entries (does NOT add
 *                                    missing shared-module wiring — see
 *                                    .github/tools/adopt-shared-module.js
 *                                    for that, which is a judgement call
 *                                    about WHERE to insert a script tag)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function main() {
  const fix = process.argv.includes("--fix");
  const dirs = fs.readdirSync(path.join(ROOT, "games"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_template")
    .map((e) => "games/" + e.name);

  let bad = 0;
  for (const dir of dirs) {
    const swPath = path.join(ROOT, dir, "sw.js");
    if (!fs.existsSync(swPath)) continue;
    const sw = fs.readFileSync(swPath, "utf8");
    const m = sw.match(/GCRegisterServiceWorker\(\s*"([^"]+)"\s*,\s*\[([\s\S]*?)\]\s*\)/);
    if (!m) { console.log(`${dir}/sw.js: unrecognised shape — skipped`); continue; }

    const listed = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const stale = listed.filter((entry) => {
      if (entry === "./" || entry.endsWith("/")) return false;   // the app root, not a file
      const rel = entry.startsWith("./") ? path.join(dir, entry.slice(2))
                                         : path.normalize(path.join(dir, entry));
      return !fs.existsSync(path.join(ROOT, rel));
    });

    if (stale.length) {
      bad += stale.length;
      for (const e of stale) {
        console.log(`${dir}: STALE precache entry "${e}" — the file does not exist, so ` +
                    `cache.addAll() 404s and the service worker never installs.`);
      }
      if (fix) {
        const kept = listed.filter((e) => !stale.includes(e));
        const body = kept.map((e) => `  "${e}",`).join("\n");
        fs.writeFileSync(swPath, sw.replace(m[0], `GCRegisterServiceWorker("${m[1]}", [\n${body}\n])`));
        console.log(`${dir}: removed ${stale.length} stale entr(y|ies)`);
      }
    } else {
      console.log(`${dir}: ${listed.length} precache entries, all present`);
    }

    // SECOND CHECK: a game using shared/controls.js or shared/save-slots.js
    // must load it (index.html) and precache it (sw.js) — see the file
    // header for why this is decidable rather than a judgement call.
    const gameJsFiles = fs.readdirSync(path.join(ROOT, dir))
      .filter((f) => f.endsWith(".js"))
      .map((f) => fs.readFileSync(path.join(ROOT, dir, f), "utf8"))
      .join("\n");
    const htmlPath = path.join(ROOT, dir, "index.html");
    const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, "utf8") : "";
    const SHARED_MODULES = [
      { ref: /\bGCControls\.create\b/, file: "../../shared/controls.js", name: "shared/controls.js" },
      { ref: /\bGCSaveSlots\.create\b/, file: "../../shared/save-slots.js", name: "shared/save-slots.js" },
      { ref: /\bGCTitleScreen\.create\b/, file: "../../shared/title-screen.js", name: "shared/title-screen.js" },
    ];
    for (const mod of SHARED_MODULES) {
      if (!mod.ref.test(gameJsFiles)) continue;
      const missing = [];
      if (!html.includes(mod.file)) missing.push("index.html (no <script> tag)");
      if (!listed.includes(mod.file)) missing.push("sw.js (not precached)");
      if (missing.length) {
        bad += missing.length;
        console.log(`${dir}: uses ${mod.name} but it's missing from ${missing.join(" and ")} — ` +
                    `offline mode will 404 or the game will throw. See .github/tools/adopt-shared-module.js.`);
      }
    }
  }
  if (bad && !fix) process.exit(1);
}

main();
