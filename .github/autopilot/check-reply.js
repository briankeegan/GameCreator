#!/usr/bin/env node
"use strict";
/**
 * Check a run's reply against what it actually changed, before it is posted.
 *
 * THE FAILURE THIS CATCHES. A run's reply is written by the same model that
 * did the work, from the same context — so when that context has been
 * compacted, or the job was half-finished, the reply confidently describes work
 * that did not happen. It has happened repeatedly here:
 *
 *   - "Redid all the art as sprite sheets" while the attack sheet was never
 *     touched (its own reply admitted it nine paragraphs down);
 *   - "Shipped it, hard-refresh once" for a change the deploy had rejected;
 *   - several rounds of "the rats are fixed" with the same rats on screen.
 *
 * Every one was visible in one line of `git diff --name-only`. Nobody looked,
 * because the only thing that could look was the thing making the claim.
 *
 * So the claim is checked against the diff by something that cannot be
 * confused: if a reply says art was regenerated and no art file changed, the
 * reply gets a correction appended before it is posted.
 *
 *   node check-reply.js <reply.md> <changed-files.txt>
 *
 * It APPENDS rather than blocks. A heuristic that can silence a reply would
 * eventually eat a correct one, and a run that says nothing is the failure
 * this whole system was built to remove. Being wrong here costs one visible
 * line; being silent costs a round trip.
 */

const fs = require("fs");

// A claim phrase can appear negated ("No new art was needed") and still
// match the bare "says" pattern — caught for real on Dog Punk: "No new art
// was needed or generated" tripped the same check as claiming art WAS
// regenerated, because "new art" is a literal substring of that sentence.
// So a match only counts if it isn't immediately preceded by a negation —
// scanning ALL matches (not just the first) so one negated mention earlier
// in a long reply can't hide a real, unnegated claim later on.
function hasUnnegatedMatch(text, re) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = g.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 20), m.index);
    if (!/\b(no|not|n't|without|never|none)\W*$/i.test(before)) return true;
    if (m.index === g.lastIndex) g.lastIndex++; // guard against zero-length matches
  }
  return false;
}

const CLAIMS = [
  { what: "art was regenerated",
    says: /\b(regenerat\w+|redid|redrew|redraw\w*|new (sheet|sprite|tile|art)|fresh (sheet|art))\b/i,
    needs: /(_sheet\.png|tiles\.png|\/art\/|art-src\/|\.png)$/ },
  { what: "the level or room art changed",
    says: /\b(room art|level art|tileset|background art)\b/i,
    needs: /(tiles\.png|\/art\/|art-src\/)/ },
  { what: "code was changed",
    says: /\b(fixed|implemented|added|wired|rewrote|changed) \b/i,
    needs: /\.(js|json|html|css|py|sh|md)$/ },
];

function main() {
  const [replyPath, filesPath] = process.argv.slice(2);
  let reply = "";
  try { reply = fs.readFileSync(replyPath, "utf8"); } catch { return; }
  let files = [];
  try {
    files = fs.readFileSync(filesPath, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  } catch { files = []; }

  const notes = [];

  // The blunt case first: a reply that describes shipping something, with an
  // empty diff behind it.
  const shipped = /\b(shipped|deployed|is live|hard.?refresh|pushed)\b/i.test(reply);
  if (shipped && files.length === 0) {
    notes.push("this reply describes a change, but **no files were changed** in this run. " +
               "Nothing has shipped; treat the description as a plan, not a result.");
  }

  for (const c of CLAIMS) {
    if (!hasUnnegatedMatch(reply, c.says)) continue;
    if (files.some((f) => c.needs.test(f))) continue;
    if (files.length === 0 && shipped) continue;            // already said above
    notes.push(`this reply says ${c.what}, but nothing matching that changed ` +
               `(${files.length} file(s) touched${files.length ? ": " + files.slice(0, 6).join(", ") : ""}).`);
  }

  if (!notes.length) {
    console.error("[check-reply] claims are consistent with the diff");
    return;
  }
  const block = "\n\n---\n\n**Automated check on this reply — read this before believing it:**\n" +
    notes.map((n) => `- ${n}`).join("\n") +
    "\n\nThis note is added by the workflow, not by the model that wrote the reply " +
    "above, by comparing what it claims against the files it actually changed.";
  fs.appendFileSync(replyPath, block);
  console.error(`[check-reply] ${notes.length} unsupported claim(s) — appended a correction`);
  for (const n of notes) console.error(`  - ${n}`);
}

main();
