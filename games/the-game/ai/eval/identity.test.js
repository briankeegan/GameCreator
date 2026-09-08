// DID THE GAME CHANGE? Run: node identity.test.js
//
// THE RULE. An optimisation to the engine or the bot is allowed to make
// things faster. It is not allowed to make them DIFFERENT. Same seed, same
// weights, same frames, same cursor, same score — bit for bit, or it is not
// an optimisation, it is a new bot that happens to be quicker.
//
// WHY A FINGERPRINT PER FRAME AND NOT JUST THE FINAL SCORE. Two runs can
// reach the same final score down completely different games, and a check
// on the outcome alone would pass a change that alters every decision and
// happens to land in the same place. It has happened in this repo in the
// other direction: a 12-frame difference in a 1329-frame result came from
// a shadowed constant and only an EXACT comparison caught it. So this
// hashes the whole board, the cursor, the score and the garbage queue on
// EVERY frame, and folds that into one number per game.
//
// HOW IT IS USED. The golden file is recorded from known-good code and
// committed. After any change to panel-engine.js, panel-cpu.js, puyocpu.js
// or the evaluator, this must still pass. If the golden file is missing it
// is WRITTEN and the test says so loudly rather than passing quietly — a
// harness that silently regenerates its own expectations checks nothing.
//
// WHAT IT DELIBERATELY COVERS: both brains (the Puyo bot and SearchCpu),
// several weight sets including all-zero, and both a burst drill and a real
// attack file, at LEVEL 10. An optimisation inside resolve() or clone()
// touches every one of those paths, so a change that only shows up on one
// of them still fails here.
var assert = require('assert');
var path = require('path');
var fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PanelCpu = globalThis.PanelCpu;
var PuyoCpu = require('./puyocpu.js');
var registry = require('./registry.js');
var attach = require('./attach.js').attach;

var GOLDEN = path.join(__dirname, 'identity.golden.json');
var LEVEL = 10;
var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function zeros() { var w = {}; registry.keys.forEach(function (k) { w[k] = 0; }); return w; }
function champion() {
    var f = path.join(__dirname, 'trained.replace.l10-puyo.0908-182449.r1.json');
    return JSON.parse(fs.readFileSync(f, 'utf8')).weights;
}
function handPicked() {
    var w = zeros();
    w.links = 25; w.colourVariance = 2; w.edgePenalty = 8;
    w.maxHeight = 30; w.garbageOnBoard = 25;
    return w;
}

// FNV-1a over 32 bits, folded frame by frame. Cheap enough to run on every
// frame of every game without changing what is being measured, and it
// changes if ANY byte of the state does.
function hashInit() { return 2166136261; }
function hashNum(h, v) {
    v = v | 0;
    for (var i = 0; i < 4; i++) {
        h ^= (v >>> (i * 8)) & 0xff;
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
}

function fingerprint(stack, h) {
    var W = PanelEngine.WIDTH;
    for (var r = 1; r <= stack.height + 1; r++) {
        for (var c = 1; c <= W; c++) {
            var p = stack.panelAt(r, c);
            // Colour, garbage-ness and STATE: two runs whose panels are the
            // same colour but in different animation states are different
            // games, and the difference shows up frames later.
            h = hashNum(h, p ? (p.color | 0) : -1);
            h = hashNum(h, p ? (p.isGarbage ? 1 : 0) : 0);
            h = hashNum(h, p && p.state ? p.state.length + p.state.charCodeAt(0) : 0);
        }
    }
    h = hashNum(h, stack.curRow);
    h = hashNum(h, stack.curCol);
    h = hashNum(h, stack.score | 0);
    h = hashNum(h, stack.health | 0);
    h = hashNum(h, (stack.incoming && stack.incoming.length) | 0);
    return h;
}

// One game, played to the end, hashed every frame.
function playGame(spec) {
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: spec.seed, countdown: false });
    var cpu, detach = null;
    if (spec.brain === 'puyo') {
        cpu = new PuyoCpu(stack, { weights: spec.weights, reaction: 12 });
    } else {
        cpu = new PanelCpu.SearchCpu(stack, {
            difficulty: 'nightmare', seed: spec.seed + 55, mistake: 0, chainExtend: true
        });
        if (spec.weights) detach = attach(PanelCpu.SearchCpu, spec.weights, { mode: 'replace' });
    }
    var h = hashInit(), f, sent = 0;
    try {
        for (f = 0; f < spec.cap; f++) {
            if (f > 120 && f % 120 === 0) {
                stack.receiveGarbage([{ width: 6, height: 3, isChain: false }]);
            }
            cpu.update();
            stack.run();
            var out = stack.takeDeliverableGarbage();
            for (var i = 0; i < out.length; i++) sent += out[i].width * out[i].height;
            stack.drainEvents();
            h = fingerprint(stack, h);
            if (stack.gameOver) break;
        }
    } finally { if (detach) detach(); }
    return { frames: f, score: stack.score || 0, sent: sent, hash: h >>> 0 };
}

// THE CASES. Chosen so that a change to clone(), resolve() or a feature
// cannot hide in a path nobody plays.
function cases() {
    var champ = champion(), hand = handPicked(), zero = zeros();
    var out = [];
    [101, 102, 103].forEach(function (seed) {
        out.push({ name: 'puyo/champion/s' + seed, brain: 'puyo', weights: champ, seed: seed, cap: 4000 });
    });
    out.push({ name: 'puyo/handpicked/s101', brain: 'puyo', weights: hand, seed: 101, cap: 4000 });
    out.push({ name: 'puyo/zero/s101', brain: 'puyo', weights: zero, seed: 101, cap: 1500 });
    // The search brain exercises the beam search, the defensive tiers and
    // TrueSurvivalSearch, none of which the Puyo bot touches — and all of
    // which run the same clone()/resolve() being optimised.
    out.push({ name: 'search/shipped/s101', brain: 'search', weights: null, seed: 101, cap: 3000 });
    out.push({ name: 'search/champion/s102', brain: 'search', weights: champ, seed: 102, cap: 3000 });
    return out;
}

test('every game is bit-for-bit what it was', function () {
    var specs = cases();
    var got = {};
    specs.forEach(function (s) {
        var r = playGame(s);
        got[s.name] = r;
    });

    if (!fs.existsSync(GOLDEN)) {
        fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 2));
        assert.fail('NO GOLDEN FILE — one has been written from the CURRENT code at ' +
            path.basename(GOLDEN) + '. That is a recording, not a pass: check the code is ' +
            'known-good, commit the file, and run again. A harness that regenerates its own ' +
            'expectations and reports success checks nothing.');
    }

    var want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    var missing = Object.keys(got).filter(function (k) { return !(k in want); });
    assert.deepStrictEqual(missing, [],
        'these cases have no golden entry: ' + missing.join(', ') +
        '. Cases were added without re-recording, so they are checking nothing.');

    // COLLECTED, not thrown one at a time: "which games changed?" must cost
    // one run, not one run per game.
    var changed = [];
    Object.keys(want).forEach(function (k) {
        var a = want[k], b = got[k];
        if (!b) { changed.push(k + ': not played this run'); return; }
        if (a.frames !== b.frames || a.score !== b.score || a.sent !== b.sent || a.hash !== b.hash) {
            changed.push(k + ': was ' + a.frames + 'f/' + a.score + 'pts/' + a.sent + 'c/#' + a.hash +
                         ', now ' + b.frames + 'f/' + b.score + 'pts/' + b.sent + 'c/#' + b.hash);
        }
    });
    assert.deepStrictEqual(changed, [],
        'THE GAME CHANGED:\n  ' + changed.join('\n  ') +
        '\nA hash difference with identical frames/score means the same outcome was reached ' +
        'down a different game, which is still a behaviour change. Revert, or re-record ' +
        'deliberately and say why in the commit.');
});

test('the fingerprint actually detects a difference (the check can fail)', function () {
    // A hash that never changes would pass everything forever. Prove it
    // reacts: the same seed with different weights must fingerprint
    // differently, and the same spec twice must fingerprint the same.
    var a = playGame({ brain: 'puyo', weights: champion(), seed: 101, cap: 900 });
    var b = playGame({ brain: 'puyo', weights: handPicked(), seed: 101, cap: 900 });
    var c = playGame({ brain: 'puyo', weights: champion(), seed: 101, cap: 900 });
    assert.notStrictEqual(a.hash, b.hash,
        'two different weight sets fingerprinted identically — the hash is not reading ' +
        'enough state to notice a different game');
    assert.strictEqual(a.hash, c.hash,
        'the same game fingerprinted differently twice, so the simulation is not ' +
        'deterministic and this whole harness is meaningless');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
