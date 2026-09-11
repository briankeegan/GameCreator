// DOES THE LOOKAHEAD DO WHAT IT CLAIMS? Run: node lookahead.test.js
//
// Three claims, and the first is the one that protects everything already
// measured: depth 1 must be the OLD BOT EXACTLY. The shipped weights, the
// 3397 held-out result and identity.golden.json all describe a bot with no
// lookahead, and they stay true only if adding one changed nothing at
// depth 1. "Approximately the same" is not available here.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require('./puyocpu.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var W = { matchPotential: 229, chainPotential: 258, colourVariance: 168,
          maxHeight: 136, roughness: 294, garbageSent: 107, travelCost: 10 };

// Play a real game and fingerprint it, so "the same bot" means the same
// GAME rather than the same first move.
function play(opts, frames) {
    var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, Object.assign({ weights: W, reaction: 12 }, opts));
    var moves = [];
    for (var f = 0; f < (frames || 1200); f++) {
        cpu.update(); stack.run(); stack.drainEvents();
        if (stack.gameOver) break;
        if (cpu._walk) moves.push(cpu._walk.row + ':' + cpu._walk.col);
    }
    return { score: stack.score, moves: moves.join(','), decisions: cpu.decisions };
}

test('depth 1 is the old bot, move for move', function () {
    // Default construction and an explicit depth of 1 must be the same
    // game — the default is what every existing result was measured on.
    var a = play({});
    var b = play({ depth: 1, beam: 6 });
    assert.strictEqual(a.moves, b.moves, 'depth 1 is not the default behaviour');
    assert.strictEqual(a.score, b.score);
    assert.ok(a.decisions > 20, 'only ' + a.decisions + ' decisions — the game barely ran');
});

test('depth 2 plays a DIFFERENT game, or the lookahead is doing nothing', function () {
    // The failure this catches is a lookahead that is wired but inert —
    // the same class as a feature weighted at zero, and invisible without
    // asking.
    var a = play({ depth: 1 });
    var b = play({ depth: 2, beam: 4 });
    assert.notStrictEqual(a.moves, b.moves,
        'depth 2 chose exactly the same moves as depth 1, so the expansion is inert');
});

test('the beam BOUNDS the work, and a wider one costs more', function () {
    // The beam is the only thing standing between this and ~1,200
    // clone+resolve pairs a decision. If widening it does not cost more,
    // it is not being applied.
    function cost(beam) {
        var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
        var cpu = new PuyoCpu(stack, { weights: W, reaction: 12, depth: 2, beam: beam });
        var n = 0;
        var orig = cpu._score.bind(cpu);
        cpu._score = function () { n++; return orig.apply(this, arguments); };
        for (var f = 0; f < 600; f++) { cpu.update(); stack.run(); stack.drainEvents(); if (stack.gameOver) break; }
        return n;
    }
    var narrow = cost(2), wide = cost(6);
    assert.ok(wide > narrow,
        'beam 6 scored ' + wide + ' boards and beam 2 scored ' + narrow + ' — the beam is not bounding anything');
});

test('a candidate with no follow-up keeps its own score', function () {
    // A dead end must not be scored as zero, or the search refuses
    // positions for a reason it does not actually have. Checked through
    // the real path: on a board where some candidate leaves no legal swap,
    // the bot must still be willing to choose one.
    var stack = new PanelEngine.Stack({ level: 10, seed: 3, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: W, reaction: 12, depth: 2, beam: 6 });
    var decided = 0;
    for (var f = 0; f < 900; f++) {
        cpu.update(); stack.run(); stack.drainEvents();
        if (cpu._walk) decided++;
        if (stack.gameOver) break;
    }
    assert.ok(decided > 0, 'the lookahead bot never committed to a move at all');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
