#!/usr/bin/env node
/**
 * THE DECLAWED-GATE LINT.
 *
 * Every art check in this repo ran on every push and none of them could fail.
 * The shape was always the same: run the checker, record its verdict, then
 *
 *     [ "$status" = 0 ] || echo "..." >> $RUNNER_TEMP/art-problems
 *     exit 0
 *
 * — a step that reports a failure and then reports success. A later step turned
 * the file into a `::warning::` and a step-summary bullet, and the run went
 * green. So a green run said nothing whatever about the art while looking
 * exactly like it did, which is strictly worse than having no check: it is a
 * checkmark standing in for evidence. A character shipped headless in six of
 * nine frames past a full set of green checks.
 *
 * The reason it was built that way is real and still holds — pages.yml produces
 * ONE artifact for every game, so one character's frames failing took the whole
 * site down, five deploys in a row. The fix is not a toothless check; it is to
 * separate the questions. The site always ships (pages.yml). The art is still
 * wrong, loudly (art-checks.yml, red on the commit, blocking nothing).
 *
 * WHAT THIS DECIDES: a workflow step whose script BOTH records a failure and
 * then unconditionally exits 0. That is the pattern, and it is decidable from
 * the text. Wanting a step not to fail is legitimate — put it in a workflow
 * that is allowed to be red, rather than making the step lie.
 *
 * Run by hand:  node .github/scripts/check_gate_wiring.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';

const problems = [];

for (const name of readdirSync('.github/workflows')) {
  if (!name.endsWith('.yml')) continue;
  const path = `.github/workflows/${name}`;
  const body = readFileSync(path, 'utf8');
  // Split into steps so the check is per-step, not per-file: a workflow may
  // legitimately contain both a gate and a best-effort step.
  const steps = body.split(/\n {6}- (?:name|uses):/);
  for (const step of steps) {
    const title = (step.match(/^ ?(.+)/) || [, '?'])[1].trim().replace(/^["']|["']$/g, '');
    const lines = step.split('\n').map((l) => l.trim());

    // ONLY STEPS WHOSE JOB IS TO DECIDE CORRECTNESS. A retry or a recovery
    // step is SUPPOSED to swallow a failure — that is what recovery means, and
    // the autopilot's "Retry or report failure" is right to exit 0. The lint is
    // about gates: steps that verify something and are the only thing standing
    // between a defect and a green run. Named, because a name is what a person
    // reads when they ask "did anything check this?".
    if (!/^(verify|check|test|assert|lint|validate)\b/i.test(title)) continue;

    // Does it notice a failure at all?
    const notices = lines.some((l) => /\|\|\s*(echo|status=1|broken=)/.test(l))
      || lines.some((l) => /status=1/.test(l));
    if (!notices) continue;

    // ...and then swallow it? An `exit 0` that is not inside a conditional
    // early-return (those look like `... || { ...; exit 0; }` on one line).
    const swallows = lines.some((l) => /^exit 0$/.test(l));
    // A `continue-on-error: true` is the same lie by another spelling.
    const continues = /continue-on-error:\s*true/.test(step);

    if (swallows || continues) {
      problems.push(`${path} — step "${title}" records a failure and then ${
        swallows ? 'exits 0' : 'sets continue-on-error'}, so it can never turn the run red. `
        + 'If this check must not block, move it to a workflow that is allowed to fail '
        + '(see .github/workflows/art-checks.yml) rather than making the step report '
        + 'success it did not have.');
    }
  }
}

if (problems.length) {
  console.error('Gates that cannot fail:');
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}
console.log('Gate wiring OK — no check records a failure and then reports success.');
