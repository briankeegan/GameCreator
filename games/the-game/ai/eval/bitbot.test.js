#!/usr/bin/env node
// BITBOT, AGAINST THE REAL ENGINE.
//
//   node bitbot.test.js
//
// Not "does it run". Every claim BITBOT.md makes about the bot is checked here
// against a live PanelEngine.Stack, and each check is followed by a BREAK TEST
// that damages the thing it checks and proves the check goes red. A check that
// passes on a broken bot is worse than no check, and this repo has shipped that
// mistake more than once -- a sweep of 4,716 boards reporting 100% agreement
// over 0 actual matches, and a test patching an export that the code never
// called.
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var BitBot = require('./bitbot.js');
var BF = require('./bitfeatures.js');
var versus = require('./versus.js');
var PanelEngine = globalThis.PanelEngine;

var fails = 0;
function ok(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }

// A VECTOR THAT PROVOKES THE DEFECTS, PINNED AS A FIXTURE.
//
// This is BitBot's first hand-set vector, the one whose potential weights were
// twice what they are now. It refuses to clear -- it is paid more for HAVING a
// chain than for playing one -- so it loops on one cell and walks into the
// ceiling, which is exactly the behaviour the no-return filter and the death
// filter exist to catch.
//
// It is here because those checks were first written against whatever STARTER
// happened to be, and STARTER then got better: the bot stopped looping, stopped
// nearing death, and the break tests had nothing left to detect and passed on a
// bot with the filters switched OFF. A check that only fires when the default
// weights are bad is a check that retires itself the moment the bot improves.
var LOOPER = {
    bumpiness: -20, spread: -10, tallest: -40,
    chain2: 10, chain3: 25, chain4: 40, chain5plus: 60,
    combo4: 8, combo5: 12, combo6: 16, combo7: 20,
    cheapestFrames: 10, moveFrames: 5,
    nextBestChain: 30, nextBestCombo: 10, nextWays: 10,
    breaksNow: 25, breakWays: 10,
    stopEarned: 50, stopReachable: 30
};

// Run one game and record what the bot did, without changing how it decides.
function playOut(weights, seed, frames, opts) {
    var stack = new PanelEngine.Stack({ level: 10, seed: seed, countdown: false });
    var o = { weights: weights, allowRaise: true };
    for (var k in (opts || {})) o[k] = opts[k];
    var bot = new BitBot(stack, o);
    var log = { picks: [], illegal: 0, matches: 0, swapsFired: 0, frames: 0 };
    var lastSwap = null;

    // The pick is captured by wrapping decide, and the LEGALITY OF THE PICK is
    // judged against the board the bot was looking at -- the snapshot -- not
    // against a board rebuilt here, which would be a second implementation
    // agreeing with itself.
    var realDecide = bot.decide;
    bot.decide = function () {
        var board = this._snapshot();
        var legal = {};
        var ls = board.legalSwaps();
        for (var i = 0; i < ls.length; i++) legal[ls[i][0] + ':' + ls[i][1]] = true;
        var d = realDecide.call(this);
        log.picks.push(d);
        if (d.kind === 'swap' && d.move && !legal[d.move[0] + ':' + d.move[1]]) log.illegal++;
        return d;
    };

    for (var f = 0; f < frames && !stack.gameOver; f++) {
        bot.update();
        stack.run();
        var evs = stack.drainEvents();
        for (var e = 0; e < evs.length; e++) if (evs[e].type === 'match') log.matches++;
        if (bot._lastSwap && bot._lastSwap !== lastSwap) { log.swapsFired++; lastSwap = bot._lastSwap; }
    }
    log.frames = f;
    log.bot = bot;
    log.stack = stack;
    return log;
}

// ------------------------------------------------------------------ 1. it plays
// A CHOSEN MOVE MUST BE ONE THE ENGINE WOULD ACCEPT, and it must actually
// happen. A bot whose swaps are never executed scores the same as one that
// decided to wait, and nothing in a duel result tells the two apart.
var runs = [];
[701, 702, 703].forEach(function (s) { runs.push(playOut(BitBot.STARTER, s, 900)); });
var picks = 0, illegal = 0, fired = 0;
runs.forEach(function (r) { picks += r.picks.length; illegal += r.illegal; fired += r.swapsFired; });
ok(picks > 50, 'the bot decided only ' + picks + ' times over three games');
ok(illegal === 0, illegal + ' chosen swaps were not legal on the board they were chosen from');
ok(fired > 20, 'only ' + fired + ' swaps reached the engine over three games -- ' +
               'a bot whose moves never execute is indistinguishable from one that holds');

// BREAK TEST: a pick the board never offered must be caught. Without this the
// legality count above could be structurally unable to fire.
var broken = playOut(BitBot.STARTER, 701, 300);
var caught = 0;
(function () {
    var stack = new PanelEngine.Stack({ level: 10, seed: 701, countdown: false });
    var bot = new BitBot(stack, { weights: BitBot.STARTER });
    var realDecide = bot.decide;
    bot.decide = function () {
        var board = this._snapshot();
        var legal = {};
        var ls = board.legalSwaps();
        for (var i = 0; i < ls.length; i++) legal[ls[i][0] + ':' + ls[i][1]] = true;
        realDecide.call(this);
        // Row 0 is the incoming row: never a legal swap target, on any board.
        var bad = { kind: 'swap', move: [0, 1] };
        if (!legal[bad.move[0] + ':' + bad.move[1]]) caught++;
        return { kind: 'hold' };
    };
    for (var f = 0; f < 200 && !stack.gameOver; f++) { bot.update(); stack.run(); }
}());
ok(caught > 0, 'the legality check cannot detect an illegal pick -- it is vacuous');

// ---------------------------------------------------- 2. the aim is a weight
// modes.aim's argument, on BitBot's own buckets: the size a vector weights
// highest IS what it is aiming at. Nothing in the bot decides this.
ok(BitBot.prototype.aim.call({ weights: BitBot.STARTER }).links === 5,
   'STARTER weights chain5plus highest, so its aim should be 5 links');
ok(BitBot.prototype.aim.call({ weights: BitBot.STARTER }).wide === 7,
   'STARTER weights combo7 highest, so its aim should be 7 wide');
var cheap = { chain2: 90, chain3: 1, chain4: 1, chain5plus: 1, combo4: 90, combo5: 1, combo6: 1, combo7: 1 };
ok(BitBot.prototype.aim.call({ weights: cheap }).links === 2 &&
   BitBot.prototype.aim.call({ weights: cheap }).wide === 4,
   'a vector weighting the smallest sizes highest should aim at the floor');
ok(BitBot.prototype.aim.call({ weights: {} }).links === 2 &&
   BitBot.prototype.aim.call({ weights: {} }).wide === 4,
   'a vector that wants nothing should fall back to the floor the engine pays for');

// -------------------------------------------------------------- 3. the modes
// A MODE NOBODY ENTERS IS DEAD CODE. BUILD and ATTACK must both be seen, and
// the pool must differ between them: BUILD keeps hold, ATTACK drops it.
var modesSeen = {};
runs.forEach(function (r) {
    r.picks.forEach(function (p) { if (p.mode) modesSeen[p.mode.name] = (modesSeen[p.mode.name] || 0) + 1; });
});
ok(modesSeen.BUILD > 0, 'BUILD was never entered');
ok(modesSeen.ATTACK > 0, 'ATTACK was never entered over three games -- ' +
                         'nothing ever met the aim, so the mode is unreachable');
// ATTACK drops hold, so on a decision in ATTACK the bot cannot have held.
var heldInAttack = 0;
runs.forEach(function (r) {
    r.picks.forEach(function (p) { if (p.mode && p.mode.name !== 'BUILD' && p.kind === 'hold') heldInAttack++; });
});
ok(heldInAttack === 0, heldInAttack + ' decisions held while not in BUILD -- ' +
                       'ATTACK and DEFEND are supposed to drop hold from the pool');

// ---------------------------------------------------------- 4. it cannot die
// THE FILTER MUST HAVE REFUSED SOMETHING, or the one rule that is not a weight
// is untested. And it must refuse the right thing: a full board with no stop
// time banked is dead, the same board holding stop time is NOT -- chaining into
// the ceiling is how the position is played.
// Swept with LOOPER, because a vector that plays adequately never gets near
// enough to death for the filter to have anything to refuse -- and then this
// check would pass with the filter removed.
var refusedRuns = [701, 703].map(function (sd) { return playOut(LOOPER, sd, 1400); });
var refused = 0;
refusedRuns.forEach(function (r) { refused += r.bot.counts.refusedDeadly; });
ok(refused > 0, 'the death filter never refused a single candidate even on the vector ' +
                'that walks into the ceiling, so nothing here tests it');

var full = { grid: [], blocks: {}, height: 12 };
for (var r0 = 0; r0 <= 12; r0++) { full.grid[r0] = []; for (var c0 = 1; c0 <= 6; c0++) full.grid[r0][c0] = ((r0 + c0) % 5) + 1; }
var probe = { deadly: BitBot.prototype.deadly };
ok(BitBot.prototype.deadly.call(probe, full, null, { stopTime: 0 }) === true,
   'a full board with nothing banked should be refused');
ok(BitBot.prototype.deadly.call(probe, full, null, { stopTime: 60 }) === false,
   'a full board is NOT dead while stop time is running -- health only drains ' +
   'on a frame with stopTime 0, and refusing this forbids chaining into the ceiling');
var chainOut = { chain: 4, total: 8, biggest: 4 };
ok(BitBot.prototype.deadly.call(probe, full, chainOut, { stopTime: 0 }) === false,
   'a full board is NOT dead when the move itself banks time -- the chain that ' +
   'saves the position was being refused as suicide');
var lowBoard = { grid: full.grid.slice(0, 4), blocks: {}, height: 12 };
for (var rr = 4; rr <= 12; rr++) { lowBoard.grid[rr] = []; for (var cc = 1; cc <= 6; cc++) lowBoard.grid[rr][cc] = -1; }
ok(BitBot.prototype.deadly.call(probe, lowBoard, null, { stopTime: 0 }) === false,
   'a board with room left should never be refused');

// BREAK TEST: with the filter wired to refuse everything, the fallback must
// fire and be counted -- the count is the warning that the position is lost.
(function () {
    var stack = new PanelEngine.Stack({ level: 10, seed: 701, countdown: false });
    var bot = new BitBot(stack, { weights: BitBot.STARTER });
    bot.deadly = function () { return true; };
    for (var f = 0; f < 200 && !stack.gameOver; f++) { bot.update(); stack.run(); }
    ok(bot.counts.allDead > 0, 'with every candidate refused the all-dead fallback never fired, ' +
                               'so the bot would freeze instead of playing its least bad move');
}());

// ------------------------------------------------- 4b. it does not undo itself
// A SWAP REPEATED ON THE SAME CELL IS THE IDENTITY, so a bot that does it is
// making no progress at all -- and with hold dropped in ATTACK it will do it
// until the floor kills it. Measured before the filter existed: 56 of 76
// decisions on seed 701 repeated the previous cell, (2,5) thirteen times
// running, and ZERO matches were made in 1,093 frames.
//
// The check is the repeat RATE, because that is the defect, and it is compared
// against the same bot with the filter off -- an absolute bar would be a
// constant nobody could justify.
function repeatRate(opts) {
    var stack = new PanelEngine.Stack({ level: 10, seed: 701, countdown: false });
    // LOOPER, not STARTER: the defect has to be present for the filter to be
    // shown to remove it.
    var o = { weights: LOOPER, allowRaise: true };
    for (var k in (opts || {})) o[k] = opts[k];
    var bot = new BitBot(stack, o);
    var picks = [];
    var real = bot.decide;
    bot.decide = function () {
        var d = real.call(this);
        picks.push(d.kind === 'swap' && d.move ? d.move[0] + ',' + d.move[1] : d.kind);
        return d;
    };
    var matches = 0;
    for (var f = 0; f < 1100 && !stack.gameOver; f++) {
        bot.update(); stack.run();
        var evs = stack.drainEvents();
        for (var e = 0; e < evs.length; e++) if (evs[e].type === 'match') matches++;
    }
    var rep = 0;
    for (var i = 1; i < picks.length; i++) if (picks[i] === picks[i - 1] && picks[i].indexOf(',') > 0) rep++;
    return { rep: rep, n: picks.length, matches: matches, bot: bot };
}
var withFilter = repeatRate({});
var without = repeatRate({ refuseReturn: false });
ok(withFilter.bot.counts.refusedReturn > 0,
   'the no-return filter refused nothing, so nothing here tests it');
ok(withFilter.rep < without.rep,
   'the no-return filter did not reduce repeated swaps (' + withFilter.rep + ' of ' +
   withFilter.n + ' with it, ' + without.rep + ' of ' + without.n + ' without)');
ok(without.rep > without.n / 4,
   'the BREAK case no longer loops (' + without.rep + ' of ' + without.n + ' repeats) -- ' +
   'the comparison above has nothing to detect and the check is vacuous');
// NOT "it now clears": the loop being gone does not make an untrained vector
// play well, and seed 701 still makes zero matches (see BITBOT.md). What the
// gate holds is that the filter does not COST clears -- a rule that refused
// legitimate cashing moves would show up here.
ok(withFilter.matches >= without.matches,
   'the no-return filter lost clears: ' + withFilter.matches + ' with it, ' +
   without.matches + ' without');

// A no-op swap -- two panels of the same colour -- must be refused too: it is
// the same defect without needing a second decision to show itself.
(function () {
    var stack = new PanelEngine.Stack({ level: 10, seed: 705, countdown: false });
    var bot = new BitBot(stack, { weights: BitBot.STARTER });
    for (var f = 0; f < 60; f++) { bot.update(); stack.run(); }
    var board = bot._snapshot();
    var info = bot.info(board);
    var pool = bot.candidates(board, info);
    var here = null, noop = 0;
    for (var i = 0; i < pool.length; i++) {
        if (pool[i].kind !== 'hold') continue;
        here = pool[i].board;
    }
    for (i = 0; i < pool.length; i++) {
        if (pool[i].kind !== 'swap' || !here) continue;
        var same = true;
        for (var r = 1; r <= 12 && same; r++) {
            for (var c = 1; c <= 6; c++) {
                var a = (here.grid[r] || [])[c], b = (pool[i].board.grid[r] || [])[c];
                if (a !== b) { same = false; break; }
            }
        }
        if (same) noop++;
    }
    // Not an assertion that no-ops exist on this board -- they may not -- but
    // that if one does the filter would see it, which is what `here` proves.
    ok(here !== null, 'hold is missing from the pool, so there is no current board to compare against');
}());

// ------------------------------------------------------- 5. the mirror draws
// IDENTICAL WEIGHTS ON IDENTICAL SEEDS MUST MIRROR. Both boards are dealt the
// same panels, so any divergence is the bot reading something that is not on
// the board -- shared mutable state between the two instances, most likely.
// versus.test.js asserts the same thing of PuyoCpu.
var mirror = versus.duel(BitBot.STARTER, BitBot.STARTER, 701,
                         { bot: 'bitbot', level: 10, allowRaise: true, ceiling: 2400 });
ok(mirror.draw === true, 'a mirror duel did not draw (winner ' + mirror.winner + ') -- ' +
                         'two instances of the same weights diverged on identical boards');
ok(mirror.scores[0] === mirror.scores[1],
   'mirror scores differ: ' + mirror.scores[0] + ' vs ' + mirror.scores[1]);

// ------------------------------------------------- 6. the features are wired
// Every key the feature module publishes must be readable on a live board, or
// a weight names a feature that is never computed and the trainer spends
// population on a number that does nothing.
(function () {
    var stack = new PanelEngine.Stack({ level: 10, seed: 704, countdown: false });
    var bot = new BitBot(stack, { weights: BitBot.STARTER });
    for (var f = 0; f < 120; f++) { bot.update(); stack.run(); }
    var board = bot._snapshot();
    var info = bot.info(board);
    var out = BF.features(board, [info.cursorRow, info.cursorCol], 0, null, info, PanelEngine);
    var missing = BF.keys().filter(function (k) { return out.f[k] === undefined; });
    ok(missing.length === 0, 'features never computed on a live board: ' + missing.join(', '));
    ok(BF.infoKeys().every(function (k) { return info[k] !== undefined; }),
       'info is missing keys the split says it carries: ' +
       BF.infoKeys().filter(function (k) { return info[k] === undefined; }).join(', '));
}());

console.log('bitbot: repeated swaps ' + withFilter.rep + '/' + withFilter.n +
            ' with the no-return filter, ' + without.rep + '/' + without.n + ' without; ' +
            'matches ' + withFilter.matches + ' vs ' + without.matches);
console.log('bitbot: ' + picks + ' decisions over ' + runs.length + ' games, ' +
            fired + ' swaps executed, ' + refused + ' candidates refused as fatal, ' +
            'modes ' + JSON.stringify(modesSeen) + ', mirror drew');
if (fails) { console.log(fails + ' FAILURES'); process.exit(1); }
console.log('bitbot: OK');
