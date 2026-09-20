// CAN THE BOT SEE THE OTHER BOARD, AND CAN IT ACT ON WHAT IT SEES?
// Run: node opponent.test.js
//
// THE CONSTRAINT THAT DECIDES THE SHAPE. The bot scores every legal move and
// takes the highest. A number that is the SAME for every candidate shifts
// every score equally and cancels out of the ranking — so "their headroom is
// 4 rows" as a feature does nothing at all, whatever weight it carries. That
// is not a theory: incomingGarbage was written exactly that way and varied
// in 0 of 179 decisions before being removed.
//
// So the opponent enters as something that INTERACTS with what the move
// does. `pressure` is this move's send measured against the room they have
// left; `overkill` is the part of the send past what would finish them.
// Both vary candidate to candidate, because the send does.
//
// Nothing here is a rule. No threshold says "if they are low, do X" — the
// information is handed over and the weights decide, exactly as with the
// board.
var assert = require('assert');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require('./puyocpu.js');
var features = require('./features.js');
var registry = require('./registry.js');
var inputMod = require('./input.js');
var switches = require('./switches.js');

var tests = [], failures = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function opp(o) {
    return { headroomCells: o.headroomCells === undefined ? 36 : o.headroomCells,
             toppedOut: !!o.toppedOut, clock: o.clock || 0,
             garbageCells: o.garbageCells || 0, incomingCells: o.incomingCells || 0 };
}
function sent(cells) {
    // resolve() reports garbage as [[width, height], ...]
    return { earned: { garbageSent: cells ? [[6, cells / 6]] : [] } };
}

// ---------------------------------------------------------------- pressure

test('pressure is this move\'s send against the room they have left', function () {
    var input = { earned: sent(18).earned, opponent: opp({ headroomCells: 36 }) };
    assert.strictEqual(features.pressure(input), 0.5);
});

test('the same send is worth more against a fuller board', function () {
    // The whole point of the interaction: 18 cells is half a kill against a
    // roomy board and a whole one against a cramped board. The move is
    // identical; what it is WORTH is not.
    var roomy = { earned: sent(18).earned, opponent: opp({ headroomCells: 36 }) };
    var cramped = { earned: sent(18).earned, opponent: opp({ headroomCells: 18 }) };
    assert.ok(features.pressure(cramped) > features.pressure(roomy));
});

test('pressure VARIES between candidates, which is the thing that matters', function () {
    // A feature constant across a decision cannot change the ranking. This
    // is the property incomingGarbage did not have.
    var o = opp({ headroomCells: 36 });
    var a = features.pressure({ earned: sent(0).earned, opponent: o });
    var b = features.pressure({ earned: sent(12).earned, opponent: o });
    var c = features.pressure({ earned: sent(24).earned, opponent: o });
    assert.ok(a < b && b < c, 'pressure did not move with the send: ' + [a, b, c]);
});

test('garbage already in the air at them counts as room already spent', function () {
    var clear = { earned: sent(12).earned, opponent: opp({ headroomCells: 36 }) };
    var loaded = { earned: sent(12).earned, opponent: opp({ headroomCells: 36, incomingCells: 18 }) };
    assert.ok(features.pressure(loaded) > features.pressure(clear));
});

test('no opponent means no pressure, not a divide by zero', function () {
    assert.strictEqual(features.pressure({ earned: sent(18).earned, opponent: null }), 0);
    assert.strictEqual(features.pressure({ earned: sent(18).earned }), 0);
});

// ---------------------------------------------------------------- overkill

test('overkill is the send past what would finish them', function () {
    var input = { earned: sent(30).earned, opponent: opp({ headroomCells: 12 }) };
    assert.strictEqual(features.overkill(input), 18);
});

test('a send that does not finish them is not overkill at all', function () {
    assert.strictEqual(features.overkill({ earned: sent(12).earned,
                                           opponent: opp({ headroomCells: 36 }) }), 0);
});

test('overkill needs an opponent too', function () {
    assert.strictEqual(features.overkill({ earned: sent(30).earned, opponent: null }), 0);
});

// -------------------------------------------------------------- the wiring

test('both are in the registry, with a divisor', function () {
    ['pressure', 'overkill'].forEach(function (k) {
        var f = registry.byKey ? registry.byKey[k] : null;
        assert.ok(registry.keys.indexOf(k) >= 0, k + ' is not in the registry');
        if (f) assert.ok(f.norm > 0, k + ' has no divisor');
    });
});

test('the input carries the opponent when there is one', function () {
    var L = switches.load();
    var a = new PanelEngine.Stack({ level: 10, seed: 1, countdown: false });
    var b = new PanelEngine.Stack({ level: 10, seed: 2, countdown: false });
    var cpu = new PuyoCpu(a, { weights: L.weights, depth: 1, opponent: b });
    for (var f = 0; f < 300; f++) { cpu.update(); a.run(); b.run(); a.drainEvents(); b.drainEvents(); }
    var board = cpu._snapshot();
    var input = inputMod.fromStack(a, board, {}, null, 0, b);
    assert.ok(input.opponent, 'no opponent on the input at all');
    assert.ok(input.opponent.headroomCells > 0, 'their headroom reads as zero on a fresh board');
});

test('no opponent is not a crash — solo play is still a thing', function () {
    var L = switches.load();
    var a = new PanelEngine.Stack({ level: 10, seed: 1, countdown: false });
    var cpu = new PuyoCpu(a, { weights: L.weights, depth: 1 });
    for (var f = 0; f < 600; f++) { cpu.update(); a.run(); a.drainEvents(); if (a.gameOver) break; }
    assert.ok(cpu.decisions > 0);
});

test('pressure is LIVE only as often as the send itself varies', function () {
    // MEASURED, and it is the limit of this feature as written. Over 512
    // decisions of a real duel:
    //
    //   garbageSent varied across candidates :  2  (0%)
    //   pressure    varied across candidates :  2  (0%)
    //
    // pressure scales this move's send by the opponent's room, and the room
    // is the same for every candidate in a decision — so pressure varies
    // exactly when the send varies, and in 99.6% of decisions no candidate
    // sends anything at all. A feature that does not vary cannot change the
    // ranking and cannot be learned.
    //
    // So this asserts the property rather than a behaviour change: pressure
    // moves WITH the send, which is what makes it usable at all, and what a
    // standalone "their headroom" feature could never do.
    var view = { headroomCells: 36, incomingCells: 0 };
    var none = features.pressure({ earned: { garbageSent: [] }, opponent: view });
    var some = features.pressure({ earned: { garbageSent: [[6, 2]] }, opponent: view });
    var lots = features.pressure({ earned: { garbageSent: [[6, 4]] }, opponent: view });
    assert.ok(none < some && some < lots, 'pressure does not track the send');

    // And the same send against two different opponents is worth different
    // amounts, which is the whole reason the opponent is here.
    var roomy = features.pressure({ earned: { garbageSent: [[6, 2]] },
                                    opponent: { headroomCells: 60, incomingCells: 0 } });
    assert.ok(some > roomy);
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
