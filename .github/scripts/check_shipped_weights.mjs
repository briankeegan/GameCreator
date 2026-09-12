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

// THE SWITCHES MUST TRAVEL WITH THE WEIGHTS.
//
// A weight set is only a bot when paired with the scoring it was found
// under. The set shipped here was trained with density scoring ON, and the
// same nineteen numbers with density OFF are a different, never-measured
// player — which is exactly the mismatch that made a rise-trained set read
// as "holds 71%" the first time it was measured, because the measuring tool
// had the switch off.
//
// So the file records what its run used, and duel.js must spread that
// object into the bot rather than hand-writing options. A hand-written list
// is how depth, then rise, then density each got dropped somewhere between
// the trainer and the game.
if (!/switches:\s*\{/.test(readFileSync(shipped, 'utf8'))) {
    fail.push('trained-weights.js records no `switches`, so nothing says which scoring ' +
              'these weights were found under — regenerate it with export_weights.js');
}
if (!/trained\.switches/.test(duel)) {
    fail.push('duel.js ignores trained.switches, so the shipped weights can run against ' +
              'scoring they were never trained on and nothing would say so');
}

// AND THE MEASURING TOOLS MUST READ THEM TOO.
//
// duel.js spreading trained.switches only fixes the GAME. Every number in
// this project's arguments comes out of a measuring tool, and each of those
// grew its own hand-written switch list: behaviour.js read GC_DENSITY and
// never depth or beam, so a depth-2 snapshot was measured playing greedy;
// puzzles.bench.js took density only from GC_DENSITY, so benchmarking a
// snapshot meant remembering to type the flag that matched it. Neither
// misreports anything visible — they print a confident number for a bot
// that does not exist, which is the screenshot-that-fails-silently shape.
//
// So there is ONE loader, ai/eval/switches.js, and the tools must go
// through it. Reaching straight for process.env.GC_DENSITY (or GC_RISE,
// GC_DEPTH, GC_BEAM) is how each copy drifted, so that is what fails here.
const loader = path.join(game, 'ai/eval/switches.js');
if (!existsSync(loader)) {
    fail.push('ai/eval/switches.js is missing — it is the one place that pairs a weight ' +
              'set with the switches it was found under');
} else {
    for (const tool of ['behaviour.js', 'puzzles.bench.js']) {
        const f = path.join(game, 'ai/eval', tool);
        if (!existsSync(f)) { fail.push(`ai/eval/${tool} is missing`); continue; }
        const src = readFileSync(f, 'utf8');
        if (!/require\(['"]\.\/switches\.js['"]\)/.test(src)) {
            fail.push(`${tool} does not load switches.js, so it decides for itself which ` +
                      'scoring a weight set was found under — that is how depth, rise and ' +
                      'density each got dropped between the trainer and a measurement');
        }
        // The loader owns the env overrides; a tool reading them directly is
        // the hand-written list growing back.
        const direct = src.replace(/require\(['"]\.\/switches\.js['"]\)/g, '')
                          .match(/process\.env\.GC_(DENSITY|RISE|DEPTH|BEAM)/g);
        if (direct) {
            fail.push(`${tool} reads ${[...new Set(direct)].join(', ')} directly instead of ` +
                      'letting switches.js resolve it — the override belongs in one place');
        }
    }
}

if (fail.length) {
    console.error('Shipped weights check FAILED:\n  - ' + fail.join('\n  - '));
    process.exit(1);
}
console.log('Shipped weights OK: ' + (named ? named[1] : '?') +
            ', loaded by index.html, cached by sw.js, used by duel.js');
