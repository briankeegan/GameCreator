// The art index is only useful if it is TRUE. This checks it, both ways:
//
//   * every tool, prompt and standard that exists is listed in
//     .github/art/README.md — so adding one without registering it fails the
//     build, instead of it sitting there undiscovered;
//   * every path the index names exists — so renaming or deleting something
//     cannot quietly leave a dead pointer for the next person to chase.
//
// This is the same rule -> tool -> gate shape as everything else in the art
// pipeline, applied to the index itself. It exists because the failure it
// prevents already happened once at a larger scale: the Clubhouse autopilot
// carried its own COPY of the art rules, which drifted until it was telling
// runs to generate the legacy frame layout months after the standard changed.
// A pointer that is checked cannot drift; a copy always will.
//
// Run: node .github/scripts/check_art_registry.mjs

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const ART = ".github/art";
const INDEX = path.join(ART, "README.md");
const index = readFileSync(INDEX, "utf8");
const problems = [];

// Files that must appear in the index. Directories and caches are skipped, and
// so is the index itself.
const SKIP = new Set(["README.md", "__pycache__"]);
const listed = (name) => index.includes(name);

const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(py|txt|md)$/.test(entry.name)) continue;
    if (!listed(entry.name)) {
      problems.push(
        `${full} is not listed in ${INDEX}. Add a row for it — a tool nobody ` +
        `knows about is a tool nobody uses. If it is a helper that is only ` +
        `ever called by another tool, say so in that tool's row.`);
    }
  }
};
walk(ART);

// Standards live outside .github/art but are the point of the index.
for (const doc of ["docs/ROOM_ART_STANDARD.md", "docs/DOOR_STANDARD.md"]) {
  if (existsSync(doc) && !listed(path.basename(doc))) {
    problems.push(`${doc} is not listed in ${INDEX}.`);
  }
}

// Generator Actions.
for (const entry of readdirSync(".github/workflows")) {
  if (!entry.startsWith("generate-")) continue;
  if (!listed(entry)) {
    problems.push(
      `.github/workflows/${entry} is not listed in ${INDEX}. Every generator ` +
      `belongs in the table, including the ones that are the wrong choice for ` +
      `most jobs — saying so is what stops them being picked by accident.`);
  }
}

// And the other direction: nothing the index points at may be missing.
for (const m of index.matchAll(/\]\(([^)#]+?)\)/g)) {
  const target = path.normalize(path.join(ART, m[1]));
  if (!existsSync(target)) {
    problems.push(`${INDEX} links to ${m[1]}, which does not exist (${target}).`);
  }
}
for (const m of index.matchAll(/`(\.github\/[^`]+?\.(?:py|txt|md|yml))`/g)) {
  if (!existsSync(m[1])) problems.push(`${INDEX} names ${m[1]}, which does not exist.`);
}

if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\n${problems.length} problem(s) with the art index.`);
  process.exit(1);
}
console.log("art index OK");
