// A SHIPPED CHANGE THAT THE PLAYER NEVER RECEIVES IS NOT SHIPPED.
//
// Every game's service worker caches a precache list under a version name,
// and sw-core's fetch handler is network-first with a fall back to cache on
// ANY failed fetch — which on a phone is a dropped packet, not an offline
// device. So one hiccup pins a single file at whatever was cached, and the
// page runs a mix of two builds with nothing able to see it: the deploy
// check compares the repo against the live SITE and passes, because the
// site is correct and the phone is not.
//
// The version string is the only thing that makes `install` refetch that
// list. Hypergolic Hull's sat at v78 across every change the game ever had,
// and a player was reading a levels.js from weeks ago under a current app.js.
//
// So: if a commit changes any file a game's sw.js precaches, that sw.js must
// change its version too.
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const base = process.env.GC_BASE_REF || "origin/main";
const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

let range;
try {
  range = `${sh(`git merge-base HEAD ${base}`)}..HEAD`;
} catch {
  console.log(`check_sw_version: no merge base with ${base}; nothing to compare`);
  process.exit(0);
}
const changed = sh(`git diff --name-only ${range}`).split("\n").filter(Boolean);
if (!changed.length) {
  console.log("check_sw_version: no changes in range");
  process.exit(0);
}

const swFiles = sh("git ls-files 'games/*/sw.js'").split("\n").filter(Boolean);
let bad = 0;

for (const sw of swFiles) {
  const dir = dirname(sw);
  const src = readFileSync(sw, "utf8");
  // The precache list, as the worker actually declares it.
  const listed = [...src.matchAll(/"(\.\/[^"]*|\.\.\/\.\.\/[^"]*)"/g)].map((m) => m[1]);
  const guarded = new Set();
  for (const rel of listed) {
    if (rel.endsWith("/")) continue; // "./" is the directory, not a file
    const path = normalize(join(dir, rel));
    if (existsSync(path)) guarded.add(path);
  }
  const touched = changed.filter((f) => guarded.has(normalize(f)));
  if (!touched.length) continue;

  const versionOf = (text) => (text.match(/GCRegisterServiceWorker\(\s*"([^"]+)"/) || [])[1] || null;
  // THE BADGE IS THE VERSION, so it has to be the same one. They were two
  // numbers kept by hand in two files: the header said v1 from the day the
  // game shipped and the worker said v78, and a player reading the badge
  // learned nothing about what they were running.
  const indexPath = join(dir, "index.html");
  if (existsSync(indexPath)) {
    const shown = (readFileSync(indexPath, "utf8").match(/data-version="([^"]*)"/) || [])[1];
    const tail = (versionOf(src) || "").split("-").pop();
    if (shown && tail && shown !== tail) {
      bad++;
      console.error(
        `FAIL ${dir}: the header shows "${shown}" and the worker caches "${versionOf(src)}".\n` +
          `      One number, both jobs — the badge is how a player says which build they are on.`
      );
    }
  }
  let before = null;
  try {
    before = versionOf(sh(`git show ${range.split("..")[0]}:${sw}`));
  } catch {
    before = null; // new game: nothing to compare against
  }
  const after = versionOf(src);
  if (before && after && before === after) {
    bad++;
    console.error(
      `FAIL ${sw}: still "${after}" while these precached files changed:\n` +
        touched.map((f) => `        ${f}`).join("\n") +
        `\n      Players keep the cached copy on any failed fetch. Bump the version.`
    );
  } else {
    console.log(`ok ${sw}: "${before || "(new)"}" -> "${after}" for ${touched.length} changed file(s)`);
  }
}

if (bad) process.exit(1);
console.log("check_sw_version: every game that changed shipped files bumped its worker");
