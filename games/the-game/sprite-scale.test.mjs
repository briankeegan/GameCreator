#!/usr/bin/env node
/**
 * A CHARACTER MUST NOT CHANGE SHAPE AS THEY WALK.
 *
 * Reported live as "the characters keep changing sizes". spriteDrawSize() drew
 * every frame at a fixed height and clamped its width into a narrow band, but a
 * frame file is trimmed to its own bounding box, so its dimensions describe the
 * POSE, not the character — a mid-step frame is wider because the legs are
 * apart. Forcing one width therefore squeezed the wide poses and stretched the
 * narrow ones: measured on May at targetH 30, her neutral frame was stretched
 * +66% and her step frames +44%, so she fattened and thinned on every stride.
 *
 * The rule is the one the sheet-based games already follow: scale a character
 * by ONE factor, taken from their neutral standing frame, and let each frame
 * keep its own proportions.
 *
 * Two things are asserted, and the first is the one that actually broke:
 *   1. every frame is drawn at its NATURAL aspect ratio — nothing is squashed
 *      or stretched to fit;
 *   2. every frame of one character is drawn at the SAME scale, so their size
 *      on screen does not depend on which foot is forward.
 *
 * Reads the real spriteDrawSize out of app.js rather than restating it, so the
 * test cannot pass while the shipped function does something else.
 *
 * Run:  node games/the-game/sprite-scale.test.mjs
 */
import { readFileSync, existsSync } from 'node:fs';

const src = readFileSync('games/the-game/app.js', 'utf8');
const m = src.match(/function spriteDrawSize\([\s\S]*?\n  \}/);
if (!m) {
  console.error('FAIL: could not find spriteDrawSize() in app.js');
  process.exit(1);
}
const spriteDrawSize = new Function(`${m[0]}; return spriteDrawSize;`)();

// PNG header read — no image library, no dependency to install.
function size(path) {
  const b = readFileSync(path);
  return { naturalWidth: b.readUInt32BE(16), naturalHeight: b.readUInt32BE(20) };
}

const CHARS = ['nella', 'nella_human', 'kat', 'may', 'timothy', 'rex', 'diamond',
               'eric', 'magma', 'john', 'michael', 'kyran', 'chuck', 'devil'];
const DIRS = ['down', 'left', 'up'];
const TARGET = 30;
const fails = [];

for (const c of CHARS) {
  const refPath = `games/the-game/art/${c}_down_1.png`;
  if (!existsSync(refPath)) continue;
  const ref = size(refPath);
  const scales = [];

  for (const d of DIRS) {
    for (const n of [0, 1, 2]) {
      const p = `games/the-game/art/${c}_${d}_${n}.png`;
      if (!existsSync(p)) { fails.push(`${c}: ${d}_${n} missing`); continue; }
      const img = size(p);
      const out = spriteDrawSize(img, TARGET, ref);

      // 1. NATURAL ASPECT. This is the assertion the old clamp failed.
      const natural = img.naturalWidth / img.naturalHeight;
      const drawn = out.w / out.h;
      if (Math.abs(drawn - natural) / natural > 0.01) {
        fails.push(`${c} ${d}_${n}: drawn at aspect ${drawn.toFixed(3)} but the frame's own `
          + `aspect is ${natural.toFixed(3)} — it is being squashed or stretched to fit, so the `
          + `character changes shape when this frame is shown.`);
      }
      scales.push(out.h / img.naturalHeight);
    }
  }

  // 2. ONE SCALE for the whole character.
  if (scales.length) {
    const lo = Math.min(...scales), hi = Math.max(...scales);
    if ((hi - lo) / lo > 0.01) {
      fails.push(`${c}: frames are drawn at different scales (${lo.toFixed(4)}..${hi.toFixed(4)}), `
        + `so this character grows and shrinks while walking. Scale every frame by the neutral `
        + `frame's factor.`);
    }
  }
}

if (fails.length) {
  console.error('Sprite scaling problems:');
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`Sprite scaling OK — ${CHARS.length} characters, every frame at its natural aspect and one scale each.`);
