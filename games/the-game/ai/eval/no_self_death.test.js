// THE BOT MAY NOT KILL ITSELF. Run: node no_self_death.test.js
//
// Self-death is playing a move it cannot survive while a move it can
// survive is on the list. Losing to a board that offers nothing is not.
//
// Three refusals enforce it, in puyocpu.js:
//   _survivors        drops a move the ENGINE would kill, and when nothing
//                     survives the queue falls back to the moves that are not
//                     dead this instant rather than to every move there is
//   _standing         drops a move after which every reply is topped out
//   _raiseIsSuicide   drops a raise the queued garbage cannot fit under
// Each lifts when every move is fatal.
//
// FATAL IS THE ENGINE'S QUESTION, NOT THE GRID'S -- RULES 16. checkGameOver is
// `health <= 0 && shakeTime <= 0`, and health drains only on a frame where
// `!riseLock && stopTime === 0 && isToppedOut()`, so a topped-out board holding
// stop time or shaking is ALIVE. Chaining INTO the ceiling is how the position
// is meant to be held: a link cashed while topped out pays 88 to 98 frames.
//
// This file asked the grid until RULES 16 and was never updated, so it counted
// exactly that play as a self-death and failed 17 times in 21 -- read off five
// of them, four carried a shield of 58 to 89 frames against a reaction of 12,
// and the dump said "the filter ALLOWED this" for every one. It now asks
// _resolvesDead, the same question the refusal asks, and a check below binds
// the distinction so this cannot drift back to the grid.
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

// IS THIS MOVE FATAL -- the engine's question, asked through the same method
// the refusal uses, so the check and the rule cannot disagree about what a
// death is. A board whose top row is occupied while stop time or a shaking
// slab holds the drain off is not a death; one with no shield is.
function fatalFor(cpu, cand) {
    if (!cand) return false;
    if (cand.resolved && cand.resolved.diedInWalk) return true;
    return cpu._resolvesDead(settledOf(cand), cand.resolved);
}

// The grid question, kept because the check below needs both to bind the
// difference between them.
function toppedOut(board) {
    if (!board || !board.grid) return false;
    var row = board.grid[board.height];
    if (!row) return false;
    for (var c = 1; c <= board.width; c++) if (row[c] !== 0) return true;
    return false;
}

// THE BOARD THE MOVE LEAVES, not the one it was scored on. A candidate's
// `board` is _scoredBoard -- the settled board plus `1 + _rowsArriving`
// rises, where the unconditional 1 is _score's measurement device so a move
// is not judged the frame its match finishes popping. It adds a row to every
// candidate alike, so asking "is this topped out" of it counts a move as
// fatal that leaves the stack a clear row below the lid. `settled` is what
// _resolveCandidate left, with the real floor run through the walk and the
// settle, and it is what _survivors judges.
function settledOf(cand) {
    return (cand && cand.settled) ? cand.settled : (cand ? cand.board : null);
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
            for (i = 0; i < cands.length; i++) if (!fatalFor(c, cands[i])) safe++;
            if (safe > 0 && safe < cands.length) {
                seen.offered++;
                if (c._lastTaken && fatalFor(c, c._lastTaken)) {
                    seen.tookFatal++;
                    // GC_DUMP_FATAL=1 prints the board at the moment this
                    // fires, so the count can be read rather than believed.
                    if (process.env.GC_DUMP_FATAL && seen.tookFatal <= 3) {
                        var t = c._lastTaken, sb = settledOf(t);
                        console.log('--- took a fatal move, frame ' + (c.stack.clock || 0) +
                            '  move ' + (t.move ? ('[' + t.move[0] + ',' + t.move[1] + ']') : t.kind));
                        console.log('    the filter itself said: ' +
                            (c._resolvesDead(sb, t.resolved) ? 'DEAD (so it had condemned every move and LIFTED)'
                                                             : 'LIVE (the filter ALLOWED this)'));
                        console.log('    shield on it: stopTime ' + (t.resolved ? t.resolved.stopTime : 0) +
                            '  shakeTime ' + (t.resolved ? t.resolved.shakeTime : 0) +
                            '  reaction ' + c.reaction);
                        var ln = [];
                        for (var rr = sb.height; rr >= 1; rr--) {
                            var str = '    ' + String(rr).padStart(2) + '|';
                            for (var cc = 1; cc <= sb.width; cc++) {
                                var v = sb.grid[rr] ? sb.grid[rr][cc] : 0;
                                str += (v === 0) ? ' .' : (v === -2 ? ' #' : (' ' + v));
                            }
                            ln.push(str + ' |');
                        }
                        console.log(ln.join('\n'));
                    }
                }
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

test('A SHIELD IS NOT A DEATH, AND NO SHIELD IS', function () {
    // The whole of RULES 16, bound so this file cannot drift back to asking
    // the grid. Same topped-out board both times; the only difference is
    // whether anything is holding the drain off for longer than one reaction.
    var stack = new PanelEngine.Stack({ level: LEVEL, seed: 3, countdown: false });
    var cpu = new PuyoCpu(stack, { reaction: 12, engine: true, level: LEVEL });
    var H = stack.height, W = stack.width;
    var g = [];
    for (var r = 0; r <= H; r++) { g[r] = []; for (var c = 1; c <= W; c++) g[r][c] = 1; }
    var lidFull = { grid: g, height: H, width: W };
    assert.ok(toppedOut(lidFull), 'fixture: the board must be topped out');
    var banked = { settled: lidFull, resolved: { stopTime: 88, shakeTime: 0, stillMoving: false } };
    var bare = { settled: lidFull, resolved: { stopTime: 0, shakeTime: 0, stillMoving: false } };
    assert.strictEqual(fatalFor(cpu, banked), false,
        'a chain banked into the ceiling reads as a self-death, which is the ' +
        'play the engine rewards -- 88 frames against a reaction of 12');
    assert.strictEqual(fatalFor(cpu, bare), true,
        'a topped-out board with nothing holding the drain off is not fatal, so ' +
        'this check would pass whatever the bot did');
    var brief = { settled: lidFull, resolved: { stopTime: 4, shakeTime: 0, stillMoving: false } };
    assert.strictEqual(fatalFor(cpu, brief), true,
        'a shield shorter than one reaction buys no move at all and must still ' +
        'count as a death');
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

test('THE SNAPSHOT CARRIES WHY IT DIED, and the number can see a self-death', function () {
    // versus.duel records the death so nothing has to replay the duel to
    // learn the cause. The count is only worth reading if it goes up when the
    // refusals come off, so both sides are checked here.
    var versus = require('./versus.js');
    var p = ready[0], a = weightsOf(p[0]), b = weightsOf(p[1]);
    var opts = { depth: 2, beam: 0, rise: true, allowRaise: true, modes: true, engine: true, level: LEVEL };
    function run(refuse) {
        var on = 0, n = 0, causes = 0;
        for (var s = 0; s < DUELS; s++) {
            var r = versus.duel(a, b, 700 + s, Object.assign({ refuseSuicide: refuse }, opts));
            assert.ok(Array.isArray(r.deaths), 'the duel returned no deaths array');
            r.deaths.forEach(function (d) {
                n++;
                on += d.selfInflicted;
                if (d.forcedAtDeath || d.corneredAtDeath || d.selfInflicted === 0) causes++;
            });
        }
        return { deaths: n, selfInflicted: on, causes: causes };
    }
    var off = run(false), refused = run(true);
    assert.ok(refused.deaths > 0, 'no deaths recorded at all, so nothing was measured');
    assert.ok(refused.deaths === refused.causes,
        'a death was recorded with no cause attached');
    assert.ok(off.selfInflicted > 0,
        'with the refusals OFF the recorded selfInflicted count stayed at 0, so a ' +
        'reported 0 with them on means nothing');
    assert.strictEqual(refused.selfInflicted, 0,
        'the snapshot recorded ' + refused.selfInflicted + ' self-inflicted deaths ' +
        'with the refusals on');
});

tests.forEach(function (t) {
    try { t.fn(); console.log('ok   ' + t.name); }
    catch (e) { failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failures.length) + '/' + tests.length + ' passed');
process.exit(failures.length ? 1 : 0);
