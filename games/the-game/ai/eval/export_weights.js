// SHIP A TRAINED WEIGHT SET INTO THE GAME.
//
//   node export_weights.js <snapshot.json>   -> ../trained-weights.js
//
// GENERATED, NEVER HAND-COPIED. Eighteen numbers typed across by eye is a
// transcription error waiting to happen, and the error would be invisible:
// the bot would still play, just slightly wrong, and nothing downstream
// could tell a mistyped 294 from a trained 249. So the file carries the
// snapshot it came from and the held-out score that snapshot earned, and
// check_shipped_weights.mjs re-runs this and fails the build if what is
// committed differs.
//
// It writes a browser module rather than JSON because the game loads plain
// scripts with no bundler — the same shape every other file in ai/eval uses.
var fs = require('fs');
var path = require('path');
var registry = require('./registry.js');

var src = process.argv[2];
if (!src) { console.error('usage: node export_weights.js <snapshot.json>'); process.exit(1); }
var snap = JSON.parse(fs.readFileSync(src, 'utf8'));
var w = snap.weights || {};

// A weight naming a feature that no longer exists would be dropped silently
// by evaluate(), so the shipped bot would quietly differ from the trained
// one. Fail instead.
Object.keys(w).forEach(function (k) {
    if (!registry.byKey[k]) {
        throw new Error('snapshot weights name "' + k + '", which is not a feature any more — ' +
                        'this snapshot predates a registry change and cannot be shipped as is');
    }
});

var held = snap.holdout && snap.holdout.learned && snap.holdout.learned.fitness;
var shipped = snap.holdout && snap.holdout.shipped && snap.holdout.shipped.fitness;
var keys = registry.keys.filter(function (k) { return w[k]; });

var body = keys.map(function (k) {
    return '    ' + k + ': ' + Math.round(w[k]);
}).join(',\n');

var out = [
    '// TRAINED WEIGHTS — GENERATED, DO NOT EDIT BY HAND.',
    '//',
    '//   node ai/eval/export_weights.js ai/eval/' + path.basename(src),
    '//',
    '// Found by the cross-entropy search in ai/eval/train.js, which stopped',
    '// itself when the numbers stopped moving — ../ai/PUYO_REFERENCE.md\'s own',
    '// rule, not a generation budget. ' + snap.selection + '.',
    '//',
    '// Held out (seeds never trained on), against the game\'s previous AI:',
    '//   learned ' + Math.round(held || 0) + '   previous ' + Math.round(shipped || 0) +
        '   +' + Math.round(((held - shipped) / shipped) * 100) + '%',
    '//',
    '// Features absent from this list were searched and left at zero, or were',
    '// added after this snapshot; evaluate() skips a zero weight, so either way',
    '// they cost nothing. check_shipped_weights.mjs fails the build if this',
    '// file stops matching the snapshot named above.',
    '(function (root) {',
    '  "use strict";',
    '  root.PanelEval = root.PanelEval || {};',
    '  root.PanelEval.trained = {',
    '    source: ' + JSON.stringify(path.basename(src)) + ',',
    '    heldOut: ' + Math.round(held || 0) + ',',
    // THE SWITCHES SHIP WITH THE WEIGHTS. A weight set is only a bot when
    // paired with the scoring it was found under: the same numbers under
    // density on and density off are two different players, and the file
    // used to say nothing at all about which one it meant. duel.js reads
    // this object and hands it straight to PuyoCpu, so the game cannot
    // quietly run trained weights against scoring they never saw.
    '    switches: ' + JSON.stringify({
        density: !!snap.density,
        rise: !!snap.rise,
        depth: snap.depth || 1,
        beam: snap.beam || 6
    }) + ',',
    '    weights: {',
    body.split('\n').map(function (l) { return '  ' + l; }).join(',\n').replace(/,,/g, ','),
    '    }',
    '  };',
    '}(typeof window !== "undefined" ? window : globalThis));',
    ''
].join('\n');

var dest = path.join(__dirname, '..', 'trained-weights.js');
fs.writeFileSync(dest, out);
console.log('wrote ' + dest + ' (' + keys.length + ' non-zero weights, held-out ' +
            Math.round(held || 0) + ')');
