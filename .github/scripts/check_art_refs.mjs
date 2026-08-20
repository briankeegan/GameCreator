// EVERY ART ID A GAME NAMES MUST HAVE A FILE BEHIND IT.
//
// The game is deliberately forgiving about missing art: loadArt() on an id
// with no file just never resolves ok, and the NPC draws as a coloured circle
// with its initial in it, the room draws its flat backdrop, the talk box shows
// a letter instead of a portrait. That is the right runtime behaviour — a
// half-generated character should still be playable — but it means a missing
// file NEVER fails anything. It ships, and it is only found when somebody
// looks at the screen and asks why there is a K standing in the lab.
//
// That happened, repeatedly, across one batch of five new characters. So the
// forgiving runtime keeps its fallback and the BUILD gets strict instead:
// anything story.js names must exist by the time it deploys.
//
// What it reads, per game:
//   art:    "kyran"        -> art/kyran.png        (dialogue portrait)
//   sprite: "kyran_top"    -> art/kyran_top.png    (the in-room sprite)
//   bg:     "lounge"       -> art/bg-lounge.png    (room / cutscene backdrop)
//   props   art: "prop_x"  -> art/prop_x.png
// plus, for any character with directional walk frames, the full nine.
// A null/absent id is not a reference — the portal is drawn by app.js and
// deliberately has none — so only string ids are checked.
//
// Run: node .github/scripts/check_art_refs.mjs            (every game)
//      node .github/scripts/check_art_refs.mjs games/the-game
//
// Rule -> tool -> gate: the rule is this comment, the tool is this file, and
// the gate is the "Verify art references" step in pages.yml.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const games = process.argv.length > 2
  ? process.argv.slice(2)
  : readdirSync("games", { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => path.join("games", e.name));

const problems = [];

for (const dir of games) {
  const story = path.join(dir, "story.js");
  const art = path.join(dir, "art");
  if (!existsSync(story) || !existsSync(art)) continue;
  const src = readFileSync(story, "utf8");

  // id -> the reason it is referenced, so a failure says what will break.
  const refs = new Map();
  const note = (id, why) => {
    if (!id) return;
    if (!refs.has(id)) refs.set(id, why);
  };
  for (const m of src.matchAll(/\bart\s*:\s*"([a-z0-9_]+)"/g)) note(m[1], "a portrait / prop");
  for (const m of src.matchAll(/\bsprite\s*:\s*"([a-z0-9_]+)"/g)) note(m[1], "an in-room sprite");
  for (const m of src.matchAll(/\bbg\s*:\s*"([a-z0-9_-]+)"/g)) note("bg-" + m[1], "a backdrop");

  for (const [id, why] of refs) {
    const file = path.join(art, id + ".png");
    if (!existsSync(file)) {
      problems.push(
        `${story} names "${id}" as ${why}, but ${file} does not exist. ` +
        `It will draw as the fallback initial instead of the character.`);
    }
  }

  // A character with ANY directional frame must have all nine: a set with a
  // hole in it freezes or flickers mid-step rather than failing outright.
  const chars = new Set(
    readdirSync(art)
      .map((f) => /^(.+)_(?:down|left|up)_[012]\.png$/.exec(f))
      .filter(Boolean)
      .map((m) => m[1]));
  for (const id of chars) {
    for (const dir2 of ["down", "left", "up"]) {
      for (const n of [0, 1, 2]) {
        const f = path.join(art, `${id}_${dir2}_${n}.png`);
        if (!existsSync(f)) {
          problems.push(
            `${f} is missing. "${id}" has some walk frames, so the game will ` +
            `animate it — with a hole in the cycle it freezes or flickers ` +
            `mid-step. Regenerate the whole sheet, never one frame (see ` +
            `.github/art/CHARACTER_SHEETS.md).`);
        }
      }
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\n${problems.length} missing art reference(s).`);
  process.exit(1);
}
console.log("art references OK — every id a game names has a file behind it.");
