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
 *   node sync-precache.js            report; exit 1 if any entry is stale
 *   node sync-precache.js --fix      drop the stale entries
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

    if (!stale.length) { console.log(`${dir}: ${listed.length} precache entries, all present`); continue; }
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
  }
  if (bad && !fix) process.exit(1);
}

main();
