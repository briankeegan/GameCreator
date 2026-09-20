// CAN THE BOT SEE A CHAIN CONTINUATION? Run: node chaining.test.js
//
// The engine flags a panel `chaining` when it falls because something under
// it cleared, and Stack:incrementChainCounter turns a match on a flagged
// panel into a CHAIN LINK — paying the chain stop-time formula (64 frames at
// level 10, or 94 at the ceiling under the danger bonus) instead of the
// combo one, and sending a full-width slab instead of thin pieces.
//
// LogicalBoard.resolve() models that flag WITHIN its own cascade and started
// it all-false, and snapshot() never carried the live stack's flags. So a
// swap into a cascade that is already running read as a plain three: not an
// escape, and dropped by BUILD's filter as worthless. Measured over five
// real games, the bot decides while panels are chaining on 11.2% of its
// decisions.
//
// These tests are against the ENGINE, not against a model of it.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PanelCpu = globalThis.PanelCpu;
var PuyoCpu = require('./puyocpu.js');
var switches = require('./switches.js');
var modes = require('./modes.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// Play until the stack has panels flagged `chaining`, then hand back the
// live stack at that instant. Real play, not a hand-built position: the
// shapes that produce a live cascade are the ones the bot actually meets.
function midCascade(seed, limit) {
    var L = switches.load();
    var stack = new PanelEngine.Stack({ level: 10, seed: seed, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: L.weights, depth: 1, beam: 0, rise: true });
    for (var f = 0; f < (limit || 9000); f++) {
        cpu.update(); stack.run(); stack.drainEvents();
        if (stack.gameOver) break;
        var n = 0;
        for (var r = 1; r <= stack.height; r++) {
            for (var c = 1; c <= 6; c++) {
                var p = stack.panelAt(r, c);
                if (p && p.chaining) n++;
            }
        }
        if (n > 0) return { stack: stack, cpu: cpu, flagged: n };
    }
    return null;
}

test('a mid-cascade board is reachable in real play at all', function () {
    // If this cannot be produced, every test below is vacuous.
    var found = 0;
    [101, 102, 103, 104, 105].forEach(function (s) { if (midCascade(s)) found++; });
    assert.ok(found >= 3, 'only ' + found + ' of 5 seeds ever reached a live cascade');
});

test('the snapshot carries the live chaining flags', function () {
    var m = null, seeds = [101, 102, 103, 104, 105];
    for (var i = 0; i < seeds.length && !m; i++) m = midCascade(seeds[i]);
    assert.ok(m, 'no live cascade found');

    var board = m.cpu._snapshot();
    assert.ok(board.chaining, 'the snapshot has no chaining grid on it at all');
    var carried = 0;
    for (var r = 1; r <= board.height; r++) {
        for (var c = 1; c <= board.width; c++) if (board.chaining[r][c]) carried++;
    }
    assert.ok(carried > 0,
        'the stack had ' + m.flagged + ' chaining panels and the snapshot carried none');
});

test('a clone keeps them, or every candidate loses them immediately', function () {
    var m = null, seeds = [101, 102, 103, 104, 105];
    for (var i = 0; i < seeds.length && !m; i++) m = midCascade(seeds[i]);
    assert.ok(m, 'no live cascade found');
    var board = m.cpu._snapshot(), copy = board.clone();
    assert.deepStrictEqual(copy.chaining, board.chaining);
    copy.chaining[1][1] = !copy.chaining[1][1];
    assert.notDeepStrictEqual(copy.chaining, board.chaining, 'the clone shares the array');
});

test('a match on a flagged panel resolves as a CHAIN LINK, not a combo', function () {
    // The whole point. Built on a real snapshot so the grid is one the engine
    // produced, with the flag set on the matching cells.
    var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
    var cpu = new PuyoCpu(stack, { weights: {}, depth: 1 });
    for (var f = 0; f < 400; f++) { cpu.update(); stack.run(); stack.drainEvents(); }
    var board = cpu._snapshot();

    // Find any legal swap that clears something at all.
    var swaps = board.legalSwaps(), hit = null;
    for (var i = 0; i < swaps.length && !hit; i++) {
        var t = board.clone();
        t.swap(swaps[i][0], swaps[i][1]);
        var r = t.resolve();
        if (r.comboSizes.length) hit = { move: swaps[i], plain: r };
    }
    assert.ok(hit, 'no clearing swap on this board — pick another seed');
    assert.strictEqual(hit.plain.chainLength, 1, 'expected a plain combo with no flags set');

    // Now the same swap with the cleared cells already flagged chaining.
    var flagged = board.clone();
    for (var rr = 1; rr <= flagged.height; rr++) {
        for (var cc = 1; cc <= flagged.width; cc++) flagged.chaining[rr][cc] = true;
    }
    flagged.swap(hit.move[0], hit.move[1]);
    var chained = flagged.resolve();
    assert.ok(chained.chainLength >= 2,
        'the same clear on flagged panels still reports chainLength ' + chained.chainLength +
        ' — the seeded flags are not reaching the match test');
});

test('a chain continuation counts as banking time', function () {
    // It was not an escape before, because it read as a bare three. It is
    // one of the best escapes there is: at the ceiling a chain link draws
    // the danger bonus, 94 frames against a 6-combo's 34.
    assert.strictEqual(modes.banksTime({ chainLength: 2, comboSizes: [3], brokeGarbage: 0 }), true);
    assert.strictEqual(modes.banksTime({ chainLength: 1, comboSizes: [3], brokeGarbage: 0 }), false);
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
