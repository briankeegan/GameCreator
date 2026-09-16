// CAN THE BOT RAISE AT ALL? Run: node raise.test.js
//
// THE RULE: raising is a MOVE, ranked by the weights like any other.
//
// The puyo brain could not raise. `raiseFrames` was declared in the
// constructor and decremented in update(), and NOTHING EVER SET IT -- dead
// wiring that reads exactly like a working feature. _decide returned `hold`
// or `swap` and nothing else, so raise was not in the choice set and no
// weight could ever select it. The shipped SearchCpu has it
// (_raiseOrBuild, {kind:"raise"} among its candidates, a tuned
// raiseFillFrac of 0.80); the rewrite dropped it.
//
// WHY IT MATTERS, and it is the same shape as the garbage finding: on a low
// board with nothing worth swapping, the bot's only options were to wait for
// the passive rise -- 120 frames a row at level 10 -- or play a swap it did
// not want. Raising is what ends the dead time and brings new panels up to
// work with, and it was the one action unavailable.
//
// NO RULE DECIDES WHEN. SearchCpu raises on `fillRatio < 0.4`, a hand-set
// threshold. Here the raise candidate is SCORED like the others, on the
// board as it will be once the row has landed and resolved, so maxHeight,
// fillRatio and garbageOnBoard already say "not when you are near the
// ceiling" and "not while garbage is on the board" in the weights' own
// terms. Putting a threshold in would be putting back the thing this brain
// exists to do without.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require('./puyocpu.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var W = { colourVariance: 168, maxHeight: 136, roughness: 294, travelCost: 10 };

function started(opts) {
    var stack = new PanelEngine.Stack({ level: 10, seed: 7, countdown: false });
    var guard = 0;
    while (!stack.stopWatchIsRunning && guard++ < 1000) stack.run();
    return new PuyoCpu(stack, Object.assign({ weights: W, reaction: 12, allowRaise: true }, opts || {}));
}

// Strip the board down to `rows` occupied rows at the bottom, so there is
// room above and raising is legal. Returns the cpu.
function lowBoard(cpu, rows) {
    var s = cpu.stack;
    for (var r = 1; r <= s.height; r++) {
        for (var c = 1; c <= PanelEngine.WIDTH; c++) {
            var p = s.panelAt(r, c);
            p.isGarbage = false;
            p.state = 'normal';
            p.color = r <= rows ? ((r + 2 * c) % 3) + 1 : 0;   // no run of three
        }
    }
    s.run();
    return cpu;
}

test('RAISE IS A CANDIDATE: _decide returns one when it scores best', function () {
    // The whole defect in one line: kind was only ever 'hold' or 'swap',
    // whatever any weight said, because raise was not in the choice set.
    //
    // WHETHER it wins is the weights' business and this test does not
    // assert a policy -- _score is stubbed so the raise IS the best
    // candidate, and the only question asked is whether the search can
    // then return it.
    var cpu = lowBoard(started(), 2);
    var real = cpu._score;
    cpu._score = function (board, resolved, move) {
        this._scoredBoard = board;
        return move ? 1 : (this._raiseTurn ? 100 : 10);
    };
    // hold is built first, raise second: flag the second _score call.
    var calls = 0;
    var wrapped = cpu._score;
    cpu._score = function () { this._raiseTurn = (calls++ === 1); return wrapped.apply(this, arguments); };
    var d;
    try { d = cpu._decide(); } finally { cpu._score = real; }
    assert.strictEqual(d.kind, 'raise',
        'the raise scored 100 against a hold at 10 and swaps at 1, and the bot played ' + d.kind);
});

test('the weights can also refuse it: a raise that scores worst is not played', function () {
    // The ACCEPT half. A raise wired in as a rule rather than a candidate
    // would be played whatever the board said, which is what the
    // fillRatio < 0.4 threshold in SearchCpu does.
    var cpu = lowBoard(started(), 2);
    var real = cpu._score;
    var calls = 0;
    cpu._score = function (board, resolved, move) {
        this._scoredBoard = board;
        var isRaise = (calls++ === 1);
        return isRaise ? -1000 : (move ? 5 : 0);
    };
    var d;
    try { d = cpu._decide(); } finally { cpu._score = real; }
    assert.notStrictEqual(d.kind, 'raise', 'a raise scoring -1000 was played anyway');
});

test('and it is SCORED, not triggered by a threshold', function () {
    // If a rule decided it, the weights could not turn it off. They can.
    var cpu = lowBoard(started(), 2);
    var candidates = cpu._candidates();
    var raise = candidates.filter(function (c) { return c.kind === 'raise'; })[0];
    assert.ok(raise, 'no raise candidate was built on a low board');
    assert.strictEqual(typeof raise.score, 'number', 'the raise candidate carries no score');
    assert.ok(isFinite(raise.score), 'the raise candidate scored ' + raise.score);
});

test('the raise candidate is scored on the board AFTER the row lands', function () {
    // Scoring it on the board as it stands would make raising look free:
    // identical to holding, and holding wins ties. The point of the move is
    // the row, so the row has to be in the number.
    var cpu = lowBoard(started(), 2);
    var cands = cpu._candidates();
    var raise = cands.filter(function (c) { return c.kind === 'raise'; })[0];
    var hold = cands.filter(function (c) { return c.kind === 'hold'; })[0];
    assert.notStrictEqual(JSON.stringify(raise.board.grid), JSON.stringify(hold.board.grid),
        'raising and holding were scored on the same board — the row is not in it');
});

test('ACCEPT: no raise candidate when the stack is topped out', function () {
    // The engine refuses it (isToppedOut -> no room), so offering it would
    // put a move in the choice set that cannot be played, and the search
    // would happily pick it and stand still.
    var cpu = started();
    var s = cpu.stack;
    for (var r = 1; r <= s.height; r++) {
        for (var c = 1; c <= PanelEngine.WIDTH; c++) {
            var p = s.panelAt(r, c);
            p.isGarbage = false; p.state = 'normal';
            p.color = ((r + 2 * c) % 3) + 1;
        }
    }
    s.run();
    assert.ok(s.wasToppedOut, 'setup failed: the stack is not topped out');
    var raise = cpu._candidates().filter(function (c) { return c.kind === 'raise'; });
    assert.deepStrictEqual(raise, [], 'a raise was offered on a topped-out board');
});

test('ACCEPT: no raise candidate while garbage is falling', function () {
    // hasFallingGarbage is the engine's own "not now" for the same reason.
    var cpu = lowBoard(started(), 2);
    assert.ok(cpu._candidates().some(function (c) { return c.kind === 'raise'; }),
        'setup failed: no raise offered on the clear low board');
    cpu.stack.receiveGarbage([{ width: 6, height: 3, isChain: false }]);
    for (var i = 0; i < 4; i++) { cpu.stack.run(); }
    if (cpu.stack.hasFallingGarbage()) {
        assert.deepStrictEqual(
            cpu._candidates().filter(function (c) { return c.kind === 'raise'; }), [],
            'a raise was offered with garbage in the air');
    }
});

test('CHOOSING a raise actually raises the stack', function () {
    // The wiring that was missing entirely: raiseFrames was decremented by
    // update() and set by NOBODY, so even a chosen raise would have done
    // nothing at all and the bot would simply have stood still.
    var cpu = lowBoard(started(), 2);
    var real = cpu._decide;
    cpu._decide = function () { return { kind: 'raise' }; };
    var asked = false;
    try {
        for (var i = 0; i < 60 && !asked; i++) {
            cpu.update();
            if (cpu.stack.input && cpu.stack.input.raise) asked = true;
            cpu.stack.run(); cpu.stack.drainEvents();
        }
    } finally { cpu._decide = real; }
    assert.ok(asked, 'the bot chose to raise and never sent the engine a raise input');
    assert.ok(cpu.raiseFrames >= 0, 'raiseFrames went negative');
});

test('a raise costs no travel: the cursor does not move', function () {
    // travelCost is charged from the cursor to the swap's cell. A raise has
    // no cell, so charging it anything would be inventing a cost.
    var cpu = lowBoard(started(), 2);
    var travel = require('./travel.js');
    var asked = [];
    var real = travel.cost;
    travel.cost = function () { asked.push(Array.prototype.slice.call(arguments)); return real.apply(this, arguments); };
    var n;
    try { n = cpu._candidates().filter(function (c) { return c.kind === 'raise'; }).length; }
    finally { travel.cost = real; }
    assert.strictEqual(n, 1, 'expected exactly one raise candidate, got ' + n);
});

test('OFF BY DEFAULT: without the option there is no raise candidate at all', function () {
    // Raising changes the CHOICE SET, so a bot with it is a different bot
    // and every number taken without it describes the other one. Same rule
    // depth, beam, rise and density all follow.
    var cpu = lowBoard(started({ allowRaise: false }), 2);
    assert.deepStrictEqual(cpu._candidates().filter(function (c) { return c.kind === 'raise'; }), [],
        'a raise was offered with the option off');
});

tests.forEach(function (t) {
    try { t.fn(); process.stdout.write('  ok   ' + t.name + '\n'); }
    catch (e) { failures.push(t.name + '\n       ' + e.message); process.stdout.write('  FAIL ' + t.name + '\n'); }
});
if (failures.length) {
    process.stdout.write('\n' + failures.length + ' failed:\n\n' + failures.join('\n\n') + '\n');
    process.exit(1);
}
process.stdout.write('\n' + tests.length + ' passed — raising is a move the weights can choose.\n');
