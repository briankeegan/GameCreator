// THE WEIGHTS THE GAME SHIPS MUST BE THE WEIGHTS THAT WERE TRAINED.
//
// RULE: games/the-game/ai/trained-weights.js is GENERATED from a training
// snapshot by ai/eval/export_weights.js. It is never edited by hand.
//
// WHY: it is eighteen numbers, and a wrong one is invisible. The bot still
// plays, just slightly worse than the one that earned the score written in
// the file's own header — and nothing downstream can tell a mistyped 294
// from a trained 249. The same class of failure as a screenshot that fails
// silently: it does not look like a failure, it looks like evidence.
//
// HOW: re-run the generator against the snapshot the file names, and compare.
// Byte-for-byte, because the header carries the held-out score and the
// snapshot name, and a stale header is exactly as misleading as a stale
// weight.
//
// Also checks the load-bearing wiring around it, since a correct weights file
// nothing loads is worth nothing: index.html must load every script the bot
// needs, sw.js must cache each of them (cache five of six and the PWA installs
// fine and throws only on the nightmare tier, offline), and duel.js must
// actually construct the trained bot.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const game = path.join(root, 'games/the-game');
const shipped = path.join(game, 'ai/trained-weights.js');
const fail = [];

if (!existsSync(shipped)) {
    console.error('FAIL: games/the-game/ai/trained-weights.js does not exist');
    process.exit(1);
}

const text = readFileSync(shipped, 'utf8');
const named = /source: "([^"]+)"/.exec(text);
if (!named) {
    fail.push('trained-weights.js does not name the snapshot it came from');
} else {
    const snap = path.join(game, 'ai/eval', named[1]);
    if (!existsSync(snap)) {
        fail.push(`trained-weights.js names ${named[1]}, which is not in ai/eval — ` +
                  'the snapshot it was generated from must stay in the repo, or the ' +
                  'shipped weights cannot be traced to a run');
    } else {
        // Regenerate into place and compare. export_weights.js writes the same
        // path, so restore whatever was there if they differ.
        const before = text;
        execFileSync('node', ['export_weights.js', named[1]],
                     { cwd: path.join(game, 'ai/eval'), stdio: 'pipe' });
        const after = readFileSync(shipped, 'utf8');
        if (before !== after) {
            writeBack(before);
            fail.push('trained-weights.js does not match what export_weights.js produces from ' +
                      named[1] + '. It was edited by hand, or the snapshot changed under it. ' +
                      'Regenerate: node ai/eval/export_weights.js ' + named[1]);
        }
    }
}

function writeBack(content) {
    execFileSync('node', ['-e', 'require("fs").writeFileSync(process.argv[1], process.argv[2])',
                          shipped, content], { stdio: 'pipe' });
}

// The wiring, all three files. A weights file nothing loads is worth nothing.
const NEEDED = ['ai/eval/features.js', 'ai/eval/registry.js', 'ai/eval/input.js',
                'ai/eval/travel.js', 'ai/eval/evaluator.js', 'ai/eval/puyocpu.js',
                'ai/trained-weights.js'];
const html = readFileSync(path.join(game, 'index.html'), 'utf8');
const sw = readFileSync(path.join(game, 'sw.js'), 'utf8');
for (const f of NEEDED) {
    if (!html.includes(`src="${f}"`)) fail.push(`index.html does not load ${f}`);
    if (!sw.includes(`"./${f}"`)) fail.push(`sw.js does not cache ${f} — offline, the nightmare tier throws`);
}

// Load order: every one of these reads the ones above it, and there is no
// bundler to sort it out.
const order = NEEDED.map(f => html.indexOf(`src="${f}"`));
for (let i = 1; i < order.length; i++) {
    if (order[i] < order[i - 1]) {
        fail.push(`index.html loads ${NEEDED[i]} before ${NEEDED[i - 1]}; each of these ` +
                  'reads the ones above it and there is no bundler');
    }
}

const duel = readFileSync(path.join(game, 'duel.js'), 'utf8');
if (!/PanelEval[\s\S]{0,400}PuyoCpu/.test(duel)) {
    fail.push('duel.js never constructs the trained bot, so nothing the player can pick uses it');
}

if (fail.length) {
    console.error('Shipped weights check FAILED:\n  - ' + fail.join('\n  - '));
    process.exit(1);
}
console.log('Shipped weights OK: ' + (named ? named[1] : '?') +
            ', loaded by index.html, cached by sw.js, used by duel.js');
