#!/usr/bin/env node
"use strict";
/**
 * Choose a run's reference material FOR it, deterministically.
 *
 * The prompt used to say "read the rules card for what you are drawing — and
 * only that one". That is a request, and a request has three ways to go wrong
 * that a script does not: the run reads the wrong card, reads three of them,
 * or reads none and works from memory. Tonight's runs did all three at
 * different points, and every one of them costs tokens the run then spends
 * compacting.
 *
 * So the workflow classifies the request and INLINES the right card into the
 * prompt. The run does not choose, does not open a file, and cannot pick
 * wrong. Nothing to obey.
 *
 *   node select-context.js <message-file> [game-dir] > context.md
 *
 * Classification is deliberately dumb and generous: keyword sets per art kind,
 * and if a request straddles two (a level with characters in it), BOTH cards
 * go in — being slightly over-supplied is much cheaper than a run reading the
 * wrong standard and generating art that has to be redone. If nothing matches,
 * no card is inlined at all: most Clubhouse messages are code changes and need
 * none of this.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

const KINDS = [
  { card: ".github/art/CHARACTER_SHEETS.rules.md", name: "characters",
    re: /\b(character|sprite|hero|enem(y|ies)|walk|walking|attack|slash|animat|frame|mohawk|npc|rat|monster|boss|idle|facing|mirror)/i },
  { card: "docs/ROOM_ART_STANDARD.rules.md", name: "rooms",
    re: /\b(room|background|bg|scene|prop|furniture|floor plate|walkmask|doorway|interior|garden|lounge|bedroom)/i },
  { card: "docs/TILED_LEVEL_STANDARD.rules.md", name: "tiled levels",
    re: /\b(tile|tileset|tiled|level art|ground|terrain|wall|fence|floor|map)/i },
  // Doors are the one kind here that is as much code as art — a doorway is
  // drawn in a wall AND armed by a rectangle, and the standard is what keeps
  // those two agreeing. So this card is selected on the ART test below being
  // bypassed for it: a request to move a door is usually not phrased as art
  // at all ("you come out of the library in the wrong place").
  { card: "docs/DOOR_STANDARD.rules.md", name: "doors", always: true,
    re: /\b(door|doorway|exit|entrance|gate|portal|arriv|spawn|walk (in|out)|come out|room to room|between rooms|stairs)/i },
];

// Art at all? If the request is "make the enemies flash red when hit" there is
// nothing to draw and no card belongs in the prompt.
const ART = /\b(art|draw|drawn|redraw|generat|sprite|sheet|pixel|colou?r|palette|animat|tile|room|background|scene|prop|look|visual|graphic)/i;

function main() {
  const msgFile = process.argv[2];
  const gameDir = process.argv[3];
  let msg = "";
  try { msg = fs.readFileSync(msgFile, "utf8"); } catch { msg = ""; }

  const out = [];
  const picked = [];
  for (const k of KINDS) {
    // `always` kinds are matched on their own keywords whether or not the
    // request reads as an art request at all — see the door card's comment.
    if (!k.always && !ART.test(msg)) continue;
    if (k.re.test(msg)) picked.push(k);
  }

  if (picked.length) {
    out.push("=== ART RULES FOR THIS REQUEST ===");
    out.push("Selected from the message, so you do NOT need to open a standard or");
    out.push("a rules card — these ARE the rules, extracted from the standards and");
    out.push("CI-checked against them. Open the full standard (same path without");
    out.push("`.rules`) only if a rule makes no sense without its reason.");
    out.push("");
    for (const k of picked) {
      try {
        const body = fs.readFileSync(path.join(ROOT, k.card), "utf8")
          .replace(/^<!--[\s\S]*?-->\n*/, "");   // strip the generated-file banner
        out.push(`----- ${k.name} (${k.card}) -----`);
        out.push(body.trim());
        out.push("");
      } catch (e) {
        out.push(`(could not read ${k.card}: ${e.message})`);
      }
    }
  }

  // The character specs are the other thing every art run needs and every art
  // run had to go and find. They are small and they are the contract.
  if (picked.some((k) => k.name === "characters") && gameDir) {
    try {
      const style = JSON.parse(fs.readFileSync(path.join(ROOT, gameDir, "art-style.json"), "utf8"));
      if (style.characters) {
        out.push("=== THIS GAME'S CHARACTER SPECS (art-style.json `characters`) ===");
        out.push("The contract. Prompts are built from it and sheets are checked");
        out.push("against it. `appears: always` is enforced.");
        out.push("```json");
        out.push(JSON.stringify(style.characters, null, 1));
        out.push("```");
        out.push("");
      }
    } catch { /* no contract yet — the prompt already says to create one */ }
  }

  const res = out.join("\n").replace(/\n*$/, "\n");
  process.stdout.write(picked.length ? res : "");
  console.error(`[context] ${picked.length ? picked.map((k) => k.name).join(" + ") : "no art detected"}`
                + ` — ${res.length}B inlined`);
}

main();
