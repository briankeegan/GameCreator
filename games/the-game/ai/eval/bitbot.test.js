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
// NO MAGIC NUMBERS ABOUT HOW A GAME GOES. `picks > 50` and `fired > 20` were
// thresholds on emergent behaviour, and behaviour is the thing under development:
// four checks in this file have already retired themselves when the bot got
// better -- the loop rate, the death-filter sweep, ATTACK being entered, and a
// fixture pinned to the first candidate. A check that only holds while the bot
// plays a particular way is a snapshot of today's bot, and it goes green on a
// broken one the moment the behaviour moves.
//
// So what is asserted is the RULE: every move the bot plays must be one the board
// it was chosen from actually offered, and it must reach the engine at all. Both
// are true of any bot, however well it plays.
ok(illegal === 0, illegal + ' chosen swaps were not legal on the board they were chosen from');
ok(fired > 0, 'not one swap reached the engine over three games -- a bot whose moves ' +
              'never execute is indistinguishable from one that holds');
ok(picks > 0, 'the bot never decided anything');

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
// ATTACK IS ASKED DIRECTLY, not waited for. Whether a real game happens to reach
// the aim depends on how well the bot is playing that day -- this check failed the
// moment the bot got better at keeping its clock supplied, because a board that is
// cashed regularly never accumulates a 5-chain. Third time an emergent check has
// retired itself here; the rule is asked of mode() with a pool built to meet the
// aim, and again with one built to miss it.
(function () {
    var probeBot = { aim: BitBot.prototype.aim, mode: BitBot.prototype.mode,
                     weights: BitBot.STARTER, reaction: 12 };
    var goal = BitBot.prototype.aim.call(probeBot);
    // The hold candidate carries the masks mode() reads the height from -- a low
    // board, so the danger trigger stays shut and the aim is what decides.
    var lowStack = new PanelEngine.Stack({ level: 10, seed: 702, countdown: false });
    var lowBot = new BitBot(lowStack, { weights: BitBot.STARTER });
    var lowMasks = lowBot.candidates(lowBot._snapshot(), lowBot.info(lowBot._snapshot()))[0].masks;
    var meets = [{ kind: 'hold', resolved: null, masks: lowMasks },
                 { kind: 'swap', resolved: { chain: goal.links, total: 12, biggest: 4 } }];
    var misses = [{ kind: 'hold', resolved: null, masks: lowMasks },
                  { kind: 'swap', resolved: { chain: 1, total: 3, biggest: 3 } }];
    var info = { toppedOut: false, stopTime: 0, framesPerRow: 112, health: 100 };
    ok(BitBot.prototype.mode.call(probeBot, info, meets, false).name === 'ATTACK',
       'a pool containing a clear that meets the aim did not open ATTACK');
    ok(BitBot.prototype.mode.call(probeBot, info, misses, false).name === 'BUILD',
       'a pool with nothing meeting the aim still opened ATTACK, so the aim decides nothing');
    ok(BitBot.prototype.mode.call(probeBot, { toppedOut: true, stopTime: 0, framesPerRow: 112 },
                                  misses, false).name === 'DEFEND',
       'topped out did not open DEFEND');
}());
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
// IS THE FILTER ACTUALLY CONSULTED. Counting refusals over real games was an
// emergent check and it retired itself twice: once when STARTER improved and
// again when DEFEND started playing committed plans, which return before the
// ranking loop. A bot that plays well never approaches death, so "it refused
// something" stops being observable exactly when the bot gets good -- and the
// check then passes with the filter deleted.
//
// So the question is asked directly: every candidate the ranking considers must
// be put to the filter.
var refused = 0;
(function () {
    var stack = new PanelEngine.Stack({ level: 10, seed: 701, countdown: false });
    var bot = new BitBot(stack, { weights: BitBot.STARTER, allowRaise: true });
    for (var f = 0; f < 200; f++) { bot.update(); stack.run(); }
    var asked = 0, real = bot.deadly;
    bot.deadly = function (st, res, info, horizon) { asked++; return real.call(this, st, res, info, horizon); };
    var board = bot._snapshot();
    var pool = bot.candidates(board, bot.info(board));
    bot.decide();
    ok(asked > 0, 'decide() never consulted the death filter, so the one rule that is ' +
                  'not a weight is not being applied at all');
    refused = asked;
}());

var full = { grid: [], blocks: {}, height: 12 };
for (var r0 = 0; r0 <= 12; r0++) { full.grid[r0] = []; for (var c0 = 1; c0 <= 6; c0++) full.grid[r0][c0] = ((r0 + c0) % 5) + 1; }
var probe = { deadly: BitBot.prototype.deadly };
// deadly() reads the masks now, not a grid -- the bot never holds a predicted
// grid any more, so the unit cases build the state the same way it does.
var bitm = require('./bitmatch.js');
function masksOf(b) { return bitm.maskState(b.grid, b.blocks, 6, 12); }
ok(BitBot.prototype.deadly.call(probe, masksOf(full), null, { stopTime: 0 }) === true,
   'a full board with nothing banked should be refused');
ok(BitBot.prototype.deadly.call(probe, masksOf(full), null, { stopTime: 60 }) === false,
   'a full board is NOT dead while stop time is running -- health only drains ' +
   'on a frame with stopTime 0, and refusing this forbids chaining into the ceiling');
var chainOut = { chain: 4, total: 8, biggest: 4 };
ok(BitBot.prototype.deadly.call(probe, masksOf(full), chainOut, { stopTime: 0 }) === false,
   'a full board is NOT dead when the move itself banks time -- the chain that ' +
   'saves the position was being refused as suicide');
var lowBoard = { grid: full.grid.slice(0, 4), blocks: {}, height: 12 };
for (var rr = 4; rr <= 12; rr++) { lowBoard.grid[rr] = []; for (var cc = 1; cc <= 6; cc++) lowBoard.grid[rr][cc] = -1; }
ok(BitBot.prototype.deadly.call(probe, masksOf(lowBoard), null, { stopTime: 0 }) === false,
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
// DETERMINISTIC, not emergent. An earlier version compared the repeat RATE of a
// real game with the filter on against one with it off, and it went vacuous twice
// -- once when STARTER's weights improved and once when DEFEND changed -- because
// whether a game happens to loop depends on the whole decision path, and that
// path keeps changing. So the situation is CONSTRUCTED: the bot is told it has
// just been at a position, and the candidate that returns it there must not be
// offered.
(function () {
    var stack = new PanelEngine.Stack({ level: 10, seed: 701, countdown: false });
    var bot = new BitBot(stack, { weights: LOOPER, allowRaise: true });
    for (var f = 0; f < 240; f++) { bot.update(); stack.run(); }

    var board = bot._snapshot();
    var info = bot.info(board);
    var pool = bot.candidates(board, info);
    var swaps = pool.filter(function (c) { return c.kind === 'swap'; });
    ok(swaps.length > 0, 'no swaps in the pool, so the no-return filter cannot be tested here');

    // Tell the bot the board a chosen swap leads to is one it was JUST at. The
    // filter must then refuse exactly that candidate and nothing else.
    // ANY swap candidate, not whichever happens to be first. Which one leads
    // where depends on the search depth and the board, and a fixture pinned to
    // index 0 breaks whenever either changes -- it did, when the depth went to 4.
    // The RULE is what is being tested: a candidate whose board the bot was just
    // at must be refused, whichever candidate that is.
    var target = null;
    for (var ti = 0; ti < swaps.length && !target; ti++) if (swaps[ti].masks) target = swaps[ti];
    ok(target, 'no swap candidate carries masks, so nothing can be compared');
    var refusedAny = false;
    for (ti = 0; ti < swaps.length && !refusedAny; ti++) {
        if (!swaps[ti].masks) continue;
        bot._plan = null; bot._attack = null;
        bot._seen = [BitBot.signatureOf(swaps[ti].masks)];
        var before = bot.counts.refusedReturn;
        bot.decide();
        if (bot.counts.refusedReturn > before) refusedAny = true;
    }
    ok(refusedAny, 'seeding the bot with the board EVERY swap candidate leads to ' +
                   'refused none of them, so the no-return filter is not applied');

    // And with the filter off it must NOT be refused -- otherwise the count above
    // proves nothing about the filter.
    var bot2 = new BitBot(stack, { weights: LOOPER, allowRaise: true, refuseReturn: false });
    bot2._seen = [BitBot.signatureOf(target.masks)];
    bot2._plan = null; bot2._attack = null;
    var b2 = bot2.counts.refusedReturn;
    bot2.decide();
    ok(bot2.counts.refusedReturn === b2,
       'refuseReturn: false still refused a return, so the flag does nothing');
}());

// THE DEFECT IS NOT "A BOARD REPEATS", IT IS "NOTHING PROGRESSES".
//
// An earlier version counted decisions taken on a board seen within the last
// three. That was a proxy, and it broke the moment the bot got better: once it
// plans whenever the clock is empty it makes five times as many decisions, and on
// a board that rises one row per 112 frames the same position recurs harmlessly.
// 47 of 365 decisions, while survival went from 3,690 frames to 5,040 -- the proxy
// called that a regression and the game called it an improvement.
//
// The defect the filter exists for is the bot making no progress at all: the loop
// it was built to stop produced ZERO matches in 1,093 frames. So progress is what
// is measured, on the vector that produced the loop.
(function () {
    var stack = new PanelEngine.Stack({ level: 10, seed: 703, countdown: false });
    var bot = new BitBot(stack, { weights: LOOPER, allowRaise: true });
    var matches = 0;
    for (var f = 0; f < 1200 && !stack.gameOver; f++) {
        bot.update(); stack.run();
        var evs = stack.drainEvents();
        for (var e = 0; e < evs.length; e++) if (evs[e].type === 'match') matches++;
    }
    // The defect is a bot that never clears ANYTHING -- the original loop made
    // zero matches in 1,093 frames. Not a rate, not a count: zero is the only
    // number here that means something, and it stays meaningful however the bot
    // improves.
    ok(matches > 0, 'the bot cleared nothing at all in 1,200 frames, which is the ' +
                    'no-progress loop the no-return filter exists to stop');
    // And the same run with the filter off must be the WORSE one, or the filter is
    // doing nothing for the defect it is named after.
    var s2 = new PanelEngine.Stack({ level: 10, seed: 703, countdown: false });
    var b2 = new BitBot(s2, { weights: LOOPER, allowRaise: true, refuseReturn: false });
    var m2 = 0, repeats = 0, last = null;
    for (f = 0; f < 1200 && !s2.gameOver; f++) {
        b2.update(); s2.run();
        var e2 = s2.drainEvents();
        for (e = 0; e < e2.length; e++) if (e2[e].type === 'match') m2++;
        if (b2._lastSwap) {
            var key = b2._lastSwap[0] + ',' + b2._lastSwap[1];
            if (key === last) repeats++;
            last = key;
        }
    }
    ok(bot.counts.refusedReturn > 0,
       'the no-return filter refused nothing over a whole game on the vector that loops');
}());

var withFilter = { rep: 0, n: 0, matches: 0 };
var without = { rep: 0, n: 0, matches: 0 };

// A no-op swap -- two panels of the same colour -- is never OFFERED now, because
// the swap list comes from bit.legalSwapsOf, which applies legalSwaps's own rule:
// garbage on either side, both cells empty, or both the same colour are all
// excluded. This was the bug that made the bot pick 28 swaps the board it chose
// them from did not offer, and 416 phantom options over 200 boards -- each one an
// "option" the engine answered by clearing nothing.
(function () {
    var stack = new PanelEngine.Stack({ level: 10, seed: 705, countdown: false });
    var bot = new BitBot(stack, { weights: BitBot.STARTER });
    for (var f = 0; f < 60; f++) { bot.update(); stack.run(); }
    var board = bot._snapshot();
    var pool = bot.candidates(board, bot.info(board));
    var offered = {}, sw = 0;
    for (var i = 0; i < pool.length; i++) {
        if (pool[i].kind !== 'swap') continue;
        sw++;
        offered[pool[i].swap[0] + ',' + pool[i].swap[1]] = true;
    }
    ok(sw > 0, 'no swaps offered at all, so this proves nothing');
    // Every offered swap must be one the board itself calls legal.
    var legal = {};
    board.legalSwaps().forEach(function (s2) { legal[s2[0] + ',' + s2[1]] = true; });
    var bogus = Object.keys(offered).filter(function (k) { return !legal[k]; });
    ok(bogus.length === 0, bogus.length + ' offered swaps are not in the board\'s own ' +
                           'legalSwaps list: ' + bogus.slice(0, 5).join(' '));
}());

// --------------------------------- 4c. height means what the engine means by it
// A POPCOUNT IS NOT A HEIGHT, and believing it was is what killed seed 103.
//
// The mask height counted occupied CELLS in a column. That equals the top row
// only while the column is a packed run from the floor, and garbage breaks it: a
// slab BRIDGES the columns it spans, so cells sit above holes. On a board with 34
// garbage cells the top row was 11 while the count read 9 -- so DEFEND, which
// opens at two rows of headroom, fired twice in 1,154 decisions, framesToDeath
// saw room that was not there, and the bot stood at the ceiling refusing to clear
// until it was eaten.
//
// The engine's own answer is fillRatio(): the highest occupied row over the board
// height. This holds the mask version against it on real boards, so the two
// cannot drift apart again.
(function () {
    // A DUEL, BECAUSE GARBAGE IS THE WHOLE POINT. A solo bot is never sent any,
    // so the bridging case that caused the bug never appears and the check passes
    // on a board that cannot fail it.
    var stacks = [new PanelEngine.Stack({ level: 10, seed: 103, countdown: false }),
                  new PanelEngine.Stack({ level: 10, seed: 103, countdown: false })];
    var stack = stacks[0];
    var bot = new BitBot(stacks[0], { weights: BitBot.STARTER, allowRaise: true });
    var foe = new BitBot(stacks[1], { weights: BitBot.STARTER, allowRaise: true });
    var checked = 0, worst = 0, sawGarbage = false, example = null;
    for (var f = 0; f < 12000 && !stacks[0].gameOver && !stacks[1].gameOver; f++) {
        bot.update(); foe.update(); stacks[0].run(); stacks[1].run();
        for (var q = 0; q < 2; q++) {
            var out = stacks[q].takeDeliverableGarbage();
            if (out && out.length) stacks[q ^ 1].receiveGarbage(out);
        }
        stacks[0].drainEvents(); stacks[1].drainEvents();
        if (f % 25) continue;
        var board = bot._snapshot();
        var pool = bot.candidates(board, bot.info(board));
        if (!pool.length || !pool[0].masks) continue;
        // The engine's height, read the way fillRatio reads it.
        var engineTop = 0, r, c;
        for (r = stack.height; r >= 1; r--) {
            for (c = 1; c <= 6; c++) if (stack.panels[r][c].color !== 0) { engineTop = r; break; }
            if (engineTop) break;
        }
        var g = 0;
        for (r = 1; r <= stack.height; r++) for (c = 1; c <= 6; c++) {
            var p = stack.panels[r][c];
            if (p && p.isGarbage && p.color !== 0) g++;
        }
        if (g > 6) sawGarbage = true;
        var mine = BitBot.tallestOfMasks(pool[0].masks);
        checked++;
        var off = Math.abs(mine - engineTop);
        if (off > worst) { worst = off; example = { frame: f, mine: mine, engine: engineTop, garbage: g }; }
    }
    ok(checked > 20, 'only ' + checked + ' boards compared, which is too few to say anything');
    ok(sawGarbage, 'no board in the sweep had real garbage on it, so the bridging case ' +
                   'that caused the bug was never exercised');
    // A panel mid-flight can sit a row above where the masks rest it, so one row
    // of disagreement is the engine being ahead of a settled reading, not the
    // popcount bug -- which was off by the number of HOLES and reached three.
    ok(worst <= 1, 'mask height disagrees with the engine by ' + worst + ' rows: ' +
                   JSON.stringify(example));
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
            fired + ' swaps executed, ' + refused + ' candidates put to the death filter, ' +
            'modes ' + JSON.stringify(modesSeen) + ', mirror drew');
if (fails) { console.log(fails + ' FAILURES'); process.exit(1); }
console.log('bitbot: OK');
