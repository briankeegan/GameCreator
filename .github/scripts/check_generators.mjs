#!/usr/bin/env node
/**
 * GATE for .github/art/GENERATOR_RULES.md — the base rules every art generator
 * obeys. Read that file for the rules and why each one exists; this decides
 * them mechanically so a new generator cannot quietly skip one.
 *
 * What it checks, and what each one is protecting against:
 *
 *   1. THE TRANSPORT VAULTS. imagegen.py must restore before spending and save
 *      immediately after. It is the single place every front door sends its
 *      request, so this one assertion covers generate_row.py, room.py,
 *      tileset.py, generate_portrait.py and the icon/cutscene CLI at once —
 *      which is the whole reason the vault lives there rather than in each
 *      caller.
 *
 *   2. ANY WORKFLOW THAT SPENDS REACHES THE VAULT. A workflow that can make an
 *      image either goes through imagegen.py (and inherits it) or calls
 *      vault.py itself. The two that curl /v1/images/edits directly do the
 *      latter, and are listed by name below so the exemption cannot spread by
 *      copy-paste to the next Action somebody writes.
 *
 *   3. NO GENERATOR STAGES A WHOLE DIRECTORY. `git add games/<x>/art` in a
 *      committing job is what let a batch of concurrent runs sweep up each
 *      other's files. Stage what this run made, by name.
 *
 * Run by hand:  node .github/scripts/check_generators.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';

const problems = [];
const read = (p) => readFileSync(p, 'utf8');

// --- 1. the shared transport carries the vault -------------------------------
const imagegen = read('.github/art/imagegen.py');
if (!/vault\.restore\(/.test(imagegen)) {
  problems.push('.github/art/imagegen.py never calls vault.restore() — every generator that goes '
    + 'through it will re-buy a picture it already paid for. See GENERATOR_RULES.md §2.');
}
if (!/vault\.save\(/.test(imagegen)) {
  problems.push('.github/art/imagegen.py never calls vault.save() — a generation lost anywhere '
    + 'downstream is gone for good. See GENERATOR_RULES.md §2.');
}

// --- 2. every workflow that can spend reaches the vault ----------------------
// These two use the multipart /v1/images/edits endpoint, which imagegen.py's
// JSON build_request() does not cover yet, so they carry the rule by hand.
// Named here rather than pattern-matched: an exemption you have to add yourself
// is one you have to justify.
const DIRECT_API = new Set([
  'generate-walksheet.yml',
  'generate-referenced-asset.yml',
]);

for (const name of readdirSync('.github/workflows')) {
  if (!name.endsWith('.yml')) continue;
  const path = `.github/workflows/${name}`;
  const body = read(path);

  const callsApi = /api\.openai\.com\/v1\/images/.test(body);
  const viaTransport = /art\/imagegen\.py/.test(body)
    || /art\/(generate_row|generate_portrait|room|tileset)\.py/.test(body);
  const vaults = /art\/vault\.py/.test(body);
  const spends = callsApi || viaTransport;

  if (!spends) continue;

  if (callsApi && !DIRECT_API.has(name)) {
    problems.push(`${path} calls the images API directly. Use .github/art/imagegen.py — it is the `
      + 'one place a request is built and validated, and it is where the vault lives. If this '
      + `workflow genuinely needs the multipart /images/edits endpoint, add "${name}" to `
      + 'DIRECT_API in this script AND call vault.py from it by hand. See GENERATOR_RULES.md §1.');
  }
  if (DIRECT_API.has(name) && !vaults) {
    problems.push(`${path} bypasses imagegen.py and never calls .github/art/vault.py, so anything `
      + 'it generates is lost the moment a later step fails. Restore before generating, save '
      + 'immediately after. See GENERATOR_RULES.md §2.');
  }
  if (!callsApi && !viaTransport && !vaults) {
    problems.push(`${path} can generate art but reaches neither imagegen.py nor vault.py.`);
  }

  // --- 3. no whole-directory staging in a job that generates ----------------
  const bulkAdd = body.match(/git add\s+(?:--\s+)?["']?games\/[^"'\s]*\/art(?:-src)?["']?\s*(?:$|\n|\|\||&&)/gm);
  if (bulkAdd) {
    problems.push(`${path} stages a whole art directory (${bulkAdd[0].trim()}). A batch of these `
      + 'running at once sweeps up each other\'s files and every push then races on work it never '
      + 'did. Stage the files this run produced, by name. See GENERATOR_RULES.md §3.');
  }
}

if (problems.length) {
  console.error('Generator rule violations:');
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}
console.log('Generator rules OK (transport vaults; every spending workflow reaches it; no bulk staging).');
