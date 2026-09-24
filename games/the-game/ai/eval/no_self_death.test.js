// THE BOT MAY NOT KILL ITSELF. Run: node no_self_death.test.js
//
// Self-death is playing a move it cannot survive while a move it can
// survive is on the list. Losing to a board that offers nothing is not.
//
// Three refusals enforce it, in puyocpu.js:
//   _survivors        drops a move whose board is topped out once the rows
//                     arriving during it have landed
//   _standing         drops a move after which every reply is topped out
//   _raiseIsSuicide   drops a raise the queued garbage cannot fit under
// Each lifts when every move is fatal.
//
// It is a refusal and not a weight because maxHealth is 1 at level 10, so
// the drain runs the first frame the board reads topped out and there is no
// window after it; and because the search owns each weight's direction, so
// a protective weight can be learned negative.
//
// Real duels with trained weights, because the decisions that expose this
// only come up in a real game.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PuyoCpu = require('./puyocpu.js');
var PanelEngine = globalThis.PanelEngine;

var LEVEL = 10;
var DUELS = Number(process.env.GC_SELFDEATH_DUELS || 8);

function newest(v) {
    var f = fs.readdirSync(__dirname).filter(function (x) {
        return x.indexOf('trained.pbt.pbt-' + v + '-') === 0;
    }).sort();
    return f.length ? f[f.length - 1] : null;
}
function weightsOf(v) {
    var f = newest(v);
    if (!f) return null;
    return JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')).weights;
}

// The highest row holding a panel.
function topRow(stack) {
    for (var r = stack.height; r >= 1; r--) {
        var row = stack.panels[r];
        if (!row) continue;
        for (var c = 1; c <= stack.width; c++) {
            var p = row[c];
            if (p && p.color !== 0) return r;
        }
    }
    return 0;
}

// The board a move leaves, after the rows arriving during it have landed.
function toppedOut(board) {
    if (!board || !board.grid) return false;
    var row = board.grid[board.height];
    if (!row) return false;
    for (var c = 1; c <= board.width; c++) if (row[c] !== 0) return true;
    return false;
}

function play(wA, wB, seed, opts) {
    var stacks = [new PanelEngine.Stack({ level: LEVEL, seed: seed, countdown: false }),
                  new PanelEngine.Stack({ level: LEVEL, seed: seed, countdown: false })];
    var cpus = [0, 1].map(function (i) {
        return new PuyoCpu(stacks[i], {
            weights: i ? wB : wA, reaction: 12, depth: 2, beam: 0, rise: true,
            allowRaise: true, modes: true, engine: true,
            refuseSuicide: opts.refuseSuicide
        });
    });
    cpus[0].opponent = stacks[1];
    cpus[1].opponent = stacks[0];

    var seen = { offered: 0, tookFatal: 0, decisions: 0 };
    // Frames the board spends within two rows of the top before it dies:
    // how much warning the bot gets, and so how long it has to act.
    var danger = [null, null];
    cpus.forEach(function (c) {
        var orig = c._lookahead.bind(c);
        c._lookahead = function (cands) {
            var picked = orig(cands);
            seen.decisions++;
            var safe = 0, i;
            for (i = 0; i < cands.length; i++) if (!toppedOut(cands[i].board)) safe++;
            if (safe > 0 && safe < cands.length) {
                seen.offered++;
                if (c._lastTaken && toppedOut(c._lastTaken.board)) seen.tookFatal++;
            }
            return picked;
        };
        var took = c._took.bind(c);
        c._took = function (x) { c._lastTaken = x; return took(x); };
    });

    var f = 0;
    for (; f < 21600; f++) {
        cpus[0].update(); cpus[1].update();
        stacks[0].run(); stacks[1].run();
        for (var i = 0; i < 2; i++) {
            var top = topRow(stacks[i]);
            if (danger[i] === null && top >= stacks[i].height - 2) danger[i] = f;
            else if (danger[i] !== null && top < stacks[i].height - 3) danger[i] = null;
            var out = stacks[i].takeDeliverableGarbage();
            if (out && out.length) stacks[i ^ 1].receiveGarbage(out);
            stacks[i].drainEvents();
        }
        if (stacks[0].gameOver || stacks[1].gameOver) break;
    }
    seen.frames = f;
    seen.raisesRefused = cpus[0].suicidalRaises + cpus[1].suicidalRaises;
    var dead = stacks[0].gameOver ? 0 : (stacks[1].gameOver ? 1 : null);
    seen.warning = (dead !== null && danger[dead] !== null) ? f - danger[dead] : null;
    return seen;
}

var tests = [], failures = [];
function test(n, fn) { tests.push({ name: n, fn: fn }); }

var PAIRS = [['r01', 'r22'], ['r16', 'r06'], ['r28', 'r13']];
var ready = PAIRS.filter(function (p) { return weightsOf(p[0]) && weightsOf(p[1]); });

test('there are trained weights to check against', function () {
    assert.ok(ready.length, 'no trained snapshots found; this check needs real weights');
});

test('IT NEVER PLAYS A MOVE IT COULD NOT SURVIVE WHILE ONE IT COULD WAS ON THE LIST', function () {
    var offered = 0, fatal = 0, decisions = 0;
    ready.forEach(function (p) {
        var a = weightsOf(p[0]), b = weightsOf(p[1]);
        for (var s = 0; s < DUELS; s++) {
            var r = play(a, b, 700 + s, { refuseSuicide: true });
            offered += r.offered; fatal += r.tookFatal; decisions += r.decisions;
        }
    });
    assert.ok(decisions > 500, 'only ' + decisions + ' decisions — too few to mean anything');
    assert.strictEqual(fatal, 0,
        'the bot played a move it could not survive ' + fatal + ' times, out of ' +
        offered + ' decisions where a survivable move was also on the list');
});

test('and the check can SEE a self-death, so passing it means something', function () {
    // With the refusals off the same duels must show fatal moves taken, or
    // the check above passes for some other reason.
    var offered = 0, fatal = 0;
    var p = ready[0];
    var a = weightsOf(p[0]), b = weightsOf(p[1]);
    for (var s = 0; s < DUELS; s++) {
        var r = play(a, b, 700 + s, { refuseSuicide: false });
        offered += r.offered; fatal += r.tookFatal;
    }
    assert.ok(offered > 0, 'no decision offered both a fatal and a survivable move, ' +
        'so this run proves nothing either way');
    assert.ok(fatal > 0,
        'with the refusals OFF the bot never took a fatal move either, so the test ' +
        'above passes for a reason that has nothing to do with the refusals');
});

test('THERE IS TIME TO SAVE ITSELF: the board is in danger for seconds, not frames', function () {
    // A board that goes from safe to dead inside one decision cannot be
    // played out of. Measured at 6.7s median, and the refusals lengthen it
    // rather than shortening it.
    var warns = [];
    ready.forEach(function (p) {
        var a = weightsOf(p[0]), b = weightsOf(p[1]);
        for (var s = 0; s < DUELS; s++) {
            var r = play(a, b, 700 + s, { refuseSuicide: true });
            if (r.warning !== null) warns.push(r.warning);
        }
    });
    assert.ok(warns.length >= 8, 'only ' + warns.length + ' deaths to measure');
    warns.sort(function (x, y) { return x - y; });
    var median = warns[Math.floor(warns.length / 2)];
    assert.ok(median >= 180,
        'median warning before death is ' + (median / 60).toFixed(1) + 's; under three ' +
        'seconds there is no room to act on it');
});

test('AND THE SAVING WORKS: refusing fatal moves buys real time', function () {
    // The refusals have to lengthen the game, not just change which move is
    // played. Same weights and seeds on both sides, refusals the only
    // difference.
    function meanFrames(rule) {
        var total = 0, n = 0;
        ready.forEach(function (p) {
            var a = weightsOf(p[0]), b = weightsOf(p[1]);
            for (var s = 0; s < DUELS; s++) {
                total += play(a, b, 700 + s, { refuseSuicide: rule }).frames;
                n++;
            }
        });
        return total / n;
    }
    var off = meanFrames(false), on = meanFrames(true);
    assert.ok(on > off * 1.1,
        'refusals bought ' + (on / 60).toFixed(1) + 's against ' + (off / 60).toFixed(1) +
        's without them — under a tenth longer is not a save');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
