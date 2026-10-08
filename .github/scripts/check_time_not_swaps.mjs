// TIME, NEVER SWAPS. BitBot's lines are as good as the frame they are done,
// however many swaps they take: every search that grows lines is the one
// shared search (native/bot.c searchInTime), bounded by the time there is and
// a share of the decision's work, never by a count of swaps. This holds that
// mechanically, two ways:
//
//   * the depth caps the shared search replaced never come back by name;
//   * the places that list a board's swaps by hand (legal / legalG calls) are
//     counted. A new one is a search outside searchInTime until shown
//     otherwise: if it is not (a pool, the masks, a test hook), raise its
//     count here with the reason beside it.
//
// Run: node .github/scripts/check_time_not_swaps.mjs

import { readFileSync } from "node:fs";

const DIR = "games/the-game/ai/eval/native/";
const RETIRED = ["LUBEAM", "KEEPDEPTH", "BREAKDEEP", "twoSetups", "anyOneSwapClear", "bestOneSwapStop", "breakAfterDropOf", "readyAhead"];
// legal( / legalG( mentions per file, and what each is
const HAND = {
  // the pool's routes (decideCore, the planned route's first step), whether
  // any next swap lives (lookahead's stranded), the topped drain's clears
  // (clearBack, waitForDrain), and searchInTime itself
  "bot.c": 6,
  // the two definitions, the option search's plies and first-round masks, its exports and tests
  "bit.c": 9,
  // front_probe: a diagnostic for drill.c GC_PROBE, not a decision
  "front.c": 1,
};

const problems = [];
for (const [file, most] of Object.entries(HAND)) {
  const src = readFileSync(DIR + file, "utf8");
  for (const name of RETIRED) if (new RegExp(`\\b${name}\\b`).test(src)) problems.push(`${file}: ${name} is back -- a cap in swaps the shared search replaced`);
  const n = (src.match(/\blegalG?\(/g) || []).length;
  if (n > most) problems.push(`${file}: ${n} places list a board's swaps by hand, ${most} recorded -- a search outside searchInTime? (see this script's header)`);
}
if (!/static int searchInTime\(/.test(readFileSync(DIR + "bot.c", "utf8"))) problems.push("bot.c: searchInTime, the shared search, is gone");
if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log("time, never swaps: OK");
