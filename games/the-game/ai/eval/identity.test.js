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
// THE WEIGHT SETS. Hand-written, and NOT a trained champion file.
//
// The golden was recorded once from a champion and it was worthless: that
// champion had been trained while travelCost was DEAD (it always measured
// 0, so the GA gave it 154 for free), and the moment travelCost started
// reporting real frames, a 154x penalty on every possible move meant HOLD
// won every decision forever. Three of the seven cases were a bot standing
// still, and one of them fingerprinted BIT-IDENTICAL to the all-zero
// control — a golden over a frozen board, checking nothing.
//
// So the sets here are written by hand, chosen because they PLAY, and the
// test asserts below that they still do. A saved champion is a moving
// target that can quietly go degenerate; a literal cannot.
function aggressive() {
    var w = zeros();
    w.matchPotential = 40; w.chainPotential = 60; w.garbageSent = 30;
    w.garbageCleared = 25; w.travelCost = 3; w.maxHeight = 15;
    return w;
}
function tidy() {
    var w = zeros();
    w.roughness = 35; w.fillRatio = 45; w.maxHeight = 40; w.colourScarcity = 10;
    w.garbageAdjacency = 12; w.travelCost = 6; w.chainLength = 20;
    return w;
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
    // SWAPS ARE COUNTED because a golden recorded from a bot that never
    // moves is a golden over a frozen board — see the note on the weight
    // sets. Counting them is what turns "these weights play" from an
    // assumption into an assertion.
    //
    // COUNTED ON THE CPU, NEVER ON THE STACK. The first version of this
    // wrapped stack.tryQueueSwap, and that CHANGED THE GAME: an own field
    // on a Stack instance shadows the prototype, TrueSurvivalSearch's
    // _cloneStack copies own fields, and a copied closure is still bound to
    // the ORIGINAL stack — so every swap inside a simulated future was
    // applied to the live match. 546 frames became 681 and nothing looked
    // wrong. _cloneStack now refuses to copy function fields, but the
    // lesson stands on its own: instrument the thing doing the deciding,
    // not the thing being simulated. _beginWalk is called once per
    // committed swap by both brains and is not part of any clone.
    var swaps = 0, realBegin = cpu._beginWalk;
    cpu._beginWalk = function () { swaps++; return realBegin.apply(this, arguments); };
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
    return { frames: f, score: stack.score || 0, sent: sent, hash: h >>> 0, swaps: swaps };
}

// THE CASES. Chosen so that a change to clone(), resolve() or a feature
// cannot hide in a path nobody plays.
function cases() {
    var hand = handPicked(), agg = aggressive(), neat = tidy(), zero = zeros();
    var out = [];
    out.push({ name: 'puyo/handpicked/s101', brain: 'puyo', weights: hand, seed: 101, cap: 4000, plays: true });
    out.push({ name: 'puyo/handpicked/s102', brain: 'puyo', weights: hand, seed: 102, cap: 4000, plays: true });
    out.push({ name: 'puyo/aggressive/s101', brain: 'puyo', weights: agg, seed: 101, cap: 4000, plays: true });
    out.push({ name: 'puyo/aggressive/s102', brain: 'puyo', weights: agg, seed: 102, cap: 4000, plays: true });
    out.push({ name: 'puyo/tidy/s102', brain: 'puyo', weights: neat, seed: 102, cap: 4000, plays: true });
    // The all-zero control is the one case that is ALLOWED not to play:
    // every candidate scores 0, so nothing ever beats the incumbent. It is
    // here to pin down the do-nothing path, and its hash must not equal any
    // playing case's — which is exactly the check the old champion failed.
    out.push({ name: 'puyo/zero/s101', brain: 'puyo', weights: zero, seed: 101, cap: 1500, plays: false });
    // The search brain exercises the beam search, the defensive tiers and
    // TrueSurvivalSearch, none of which the Puyo bot touches — and all of
    // which run the same clone()/resolve() being optimised.
    out.push({ name: 'search/shipped/s101', brain: 'search', weights: null, seed: 101, cap: 3000, plays: true });
    out.push({ name: 'search/aggressive/s102', brain: 'search', weights: agg, seed: 102, cap: 3000, plays: true });
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
        if (a.frames !== b.frames || a.score !== b.score || a.sent !== b.sent ||
            a.hash !== b.hash || a.swaps !== b.swaps) {
            changed.push(k + ': was ' + a.frames + 'f/' + a.score + 'pts/' + a.sent + 'c/' +
                         a.swaps + 'sw/#' + a.hash +
                         ', now ' + b.frames + 'f/' + b.score + 'pts/' + b.sent + 'c/' +
                         b.swaps + 'sw/#' + b.hash);
        }
    });
    assert.deepStrictEqual(changed, [],
        'THE GAME CHANGED:\n  ' + changed.join('\n  ') +
        '\nA hash difference with identical frames/score means the same outcome was reached ' +
        'down a different game, which is still a behaviour change. Revert, or re-record ' +
        'deliberately and say why in the commit.');
});

test('every case is actually playing the game, not standing still', function () {
    // WHY THIS EXISTS. The first golden recorded here had a bot that made
    // ZERO swaps in 429 frames on three of its seven cases, and nothing
    // said so: a frozen board hashes perfectly consistently, so the
    // identity check passed forever while covering nothing. A golden is
    // only worth what the games behind it did.
    //
    // Five is deliberately low. The point is "this weight set moves", not
    // "this weight set is good" — a threshold tuned to a bot's quality
    // would fail every time the bot changed, which is the opposite of what
    // an identity check is for.
    var MIN_SWAPS = 5;
    var idle = [];
    cases().forEach(function (s) {
        if (!s.plays) return;
        var r = playGame(s);
        if (r.swaps < MIN_SWAPS) {
            idle.push(s.name + ': ' + r.swaps + ' swaps in ' + r.frames + ' frames');
        }
    });
    assert.deepStrictEqual(idle, [],
        'these cases barely touched the board:\n  ' + idle.join('\n  ') +
        '\nA weight set that never moves fingerprints a frozen board. Check the ' +
        'weights above (a large travelCost with nothing to beat it makes HOLD win ' +
        'every decision) rather than lowering the threshold.');
});

test('no two cases are the same game wearing different names', function () {
    // The failure this catches, exactly as it happened: a champion weight
    // set that had gone degenerate fingerprinted BIT-IDENTICAL to the
    // all-zero control. Two entries in the golden, one game between them.
    var seen = {}, dupes = [];
    cases().forEach(function (s) {
        var r = playGame(s);
        if (seen[r.hash]) dupes.push(seen[r.hash] + ' == ' + s.name + ' (#' + r.hash + ')');
        else seen[r.hash] = s.name;
    });
    assert.deepStrictEqual(dupes, [],
        'these cases played identical games:\n  ' + dupes.join('\n  ') +
        '\nThey are one case in the golden, not two, so whichever path the ' +
        'second was meant to cover is uncovered.');
});

test('the fingerprint actually detects a difference (the check can fail)', function () {
    // A hash that never changes would pass everything forever. Prove it
    // reacts: the same seed with different weights must fingerprint
    // differently, and the same spec twice must fingerprint the same.
    var a = playGame({ brain: 'puyo', weights: aggressive(), seed: 101, cap: 900 });
    var b = playGame({ brain: 'puyo', weights: handPicked(), seed: 101, cap: 900 });
    var c = playGame({ brain: 'puyo', weights: aggressive(), seed: 101, cap: 900 });
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
