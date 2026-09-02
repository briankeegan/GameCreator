#!/usr/bin/env node
/**
 * RULE: every character spec says where each of its details CAME FROM.
 *
 * Newsey is an adaptation of a plot the owner wrote, and the art is generated
 * FROM these specs — `generate_row.py` builds the prompt out of them and
 * `verify_sheet.py character` checks finished sheets against them. That makes
 * the spec the place a detail becomes canon: regenerate the art and whatever is
 * written here is what ships, whether or not the plot ever said it.
 *
 * An audit of the fourteen Newsey specs against the verbatim plot found five
 * details that had quietly become facts: Eric's robe had drifted grey-green
 * when the plot says "gray robe" twice, May's robe was drawn neat when the plot
 * has it "ripped to shreds, barely hanging on her shoulders", Rex had grown
 * Chuck's beard, John had aged from "late 30s" into an old man, and the Devil
 * had lost the only two words that describe him — "cartoon" and "little".
 * Nothing was wrong with any individual note; what was missing was any record
 * of which notes were quoting and which were inventing.
 *
 * So each spec carries `plotQuote` — the verbatim source text, copied not
 * paraphrased — and each material carries `source`: "plot" (the quote states
 * it; don't change it without the owner) or "design" (we chose it; open to
 * change). This script is the gate: a spec missing either, or claiming
 * source "plot" while its game has no plotQuote to check against, fails.
 *
 * Only games that HAVE character specs are checked, and only games that set
 * `"adaptedFrom"` in art-style.json are required to carry plotQuote — a game
 * invented from scratch has no source text to quote, and every material in it
 * is a design choice by definition.
 *
 * Run by hand:  node .github/scripts/check_character_specs.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// THREE sources, not two. "owner" is a detail the owner decided directly in
// conversation rather than in the source text — Kat's avatar has a cat's head,
// which the plot only hints at ("almost purring", and the name). It carries the
// same authority as "plot": do not change it without asking. Only "design" is
// ours to revise freely. Keeping them apart is the whole point of this file —
// the audit that started it found five details that had quietly become canon.
const VALID = new Set(['plot', 'owner', 'design']);
const problems = [];
let checked = 0;

for (const game of readdirSync('games', { withFileTypes: true })) {
  if (!game.isDirectory() || game.name.startsWith('_')) continue;
  const path = `games/${game.name}/art-style.json`;
  if (!existsSync(path)) continue;

  let style;
  try {
    style = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    problems.push(`${path}: not valid JSON — ${err.message}`);
    continue;
  }

  let buildMissing = false;
  const chars = style.characters;
  if (!chars || !Object.keys(chars).length) continue;
  const adapted = Boolean(style.adaptedFrom);

  for (const [id, spec] of Object.entries(chars)) {
    checked++;
    const where = `${path}: characters.${id}`;
    const mats = spec.materials || {};
    if (!Object.keys(mats).length) {
      problems.push(`${where} has no materials`);
      continue;
    }
    for (const [mat, info] of Object.entries(mats)) {
      if (typeof info !== 'object' || info === null) continue;
      if (!('source' in info)) {
        problems.push(`${where}.materials.${mat} has no "source" — say "plot", "owner" or "design"`);
      } else if (!VALID.has(info.source)) {
        problems.push(`${where}.materials.${mat} source="${info.source}" — must be "plot", "owner" or "design"`);
      } else if (info.source === 'plot' && !adapted) {
        problems.push(`${where}.materials.${mat} claims source "plot", but ${path} has no "adaptedFrom"`);
      }
    }
    // THE SHARED BUILD MUST ACTUALLY BE SHARED. Proportions were prose retyped
    // into thirteen specs, nothing compared them, and characters generated one
    // at a time drifted — one ended up with a head a third of its body while
    // everyone else was four and a half heads tall. A game with characters now
    // declares one `build` at the top level that every prompt inherits, and a
    // character's own `proportions` says only how they differ from it.
    if (!String(style.build || '').trim()) {
      buildMissing = true;
    }

    const claimsPlot = Object.values(mats).some((m) => m && m.source === 'plot');
    if (claimsPlot && !String(spec.plotQuote || '').trim()) {
      problems.push(`${where} has materials sourced to the plot but no "plotQuote" to check them against`);
    }
  }

  if (buildMissing) {
    problems.push(`${path} has characters but no top-level "build" — the body plan they all share. `
      + 'Without it every spec restates its own proportions, nothing compares them, and independently '
      + 'generated characters drift apart. generate_row.spec_to_prompt() puts this in front of every '
      + 'prompt; a character\'s own `proportions` should say only how they DIFFER from it.');
  }
}

if (problems.length) {
  console.error('Character spec provenance problems:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nSee `characterSpecRule` in the game\'s art-style.json, and the header of this script.');
  process.exit(1);
}
console.log(`Character spec provenance OK (${checked} spec${checked === 1 ? '' : 's'}).`);
