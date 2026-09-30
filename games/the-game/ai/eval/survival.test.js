#!/usr/bin/env node
// THE RULES THAT ARE NOT THE VECTOR'S TO CHOOSE.
//
//   node survival.test.js
//
// Checked as properties, not by playing games. The bot costs about 47ms a
// decision, so a duel-based gate is slow by construction -- a death count is a
// benchmark to run by hand, not something to put in front of every push. These
// are the mechanical invariants, and they run in milliseconds.
var path = require('path');
var ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'panel-engine.js'));
require(path.join(ROOT, 'panel-cpu.js'));
var BitBot = require('./bitbot.js');
var BF = require('./bitfeatures.js');
var bit = require('./bitmatch.js');
var P = globalThis.PanelEngine, W = 6;

var fails = 0;
function ok(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }
function hostile() {
    var w = {};
    BF.keys().forEach(function (k) { w[k] = 0; });
    w.bumpiness = 200; w.tallest = 200;      // asks for towers
    return w;
}

// ---------------------------------------------- 1. a tower is never preferred
(function () {
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var bot = new BitBot(st, { weights: hostile(), allowRaise: true });
    var board = bot._snapshot();
    var info = bot.info(board);
    var flat = bit.maskState(board.grid, board.blocks, W, board.height);
    var tower = bit.copyState(flat);
    tower.occ[1] |= 0x0F << 8;
    ok(bot.score(tower, 0, null, info) < bot.score(flat, 0, null, info),
       'a vector asking for towers scored the towered board higher, so bumpiness ' +
       'and tallest are weights rather than floors');
}());

// ---------------------------------------------- 2. a fatal raise is not offered
//
// The pool is where legality lives: an illegal swap is not in it, and neither is
// a raise the board would not survive. Built by filling the stack to the ceiling
// and asking for the candidates.
(function () {
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var bot = new BitBot(st, { allowRaise: true });
    var board = bot._snapshot();
    var info = bot.info(board);
    var full = { toppedOut: false, stopTime: 0, incoming: 0,
                 cursorRow: info.cursorRow, cursorCol: info.cursorCol,
                 health: info.health, fillRatio: 1,
                 framesPerRow: info.framesPerRow,
                 framesToNextRow: info.framesToNextRow };
    // Every queued cell lands, so a queue deep enough to top the board out must
    // take the raise off the table however empty the stack looks.
    full.incoming = W * 12;
    var pool = bot.candidates(board, full);
    var offered = false, i;
    for (i = 0; i < pool.length; i++) if (pool[i].kind === 'raise') offered = true;
    ok(!offered,
       'a raise was offered with twelve rows of garbage already queued, so the ' +
       'height bound is not counting what is on its way');
}());

// ---------------------------------------------- 3. the engine's refusals hold
(function () {
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var bot = new BitBot(st, { allowRaise: true });
    bot.raiseFrames = 20;                       // a raise already in flight
    ok(!bot.canRaise(), 'asked for a second raise while one was still being held');
    bot.raiseFrames = 0;
    st.riseLock = true;
    ok(!bot.canRaise(), 'asked the engine for a raise while riseLock was set');
    st.riseLock = false;
    ok(bot.canRaise(), 'refused a raise the engine would have granted');
}());

// ---------------------------------------------- 4. allowRaise is honoured
(function () {
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var bot = new BitBot(st, { allowRaise: false });
    ok(!bot.canRaise(), 'raised with raising switched off');
    var pool = bot.candidates(bot._snapshot(), bot.info(bot._snapshot()));
    var any = false;
    for (var i = 0; i < pool.length; i++) if (pool[i].kind === 'raise') any = true;
    ok(!any, 'a raise was in the pool with raising switched off');
}());

// ------------------------------- 5. what holds a full board is the clock OR motion
//
// At level 10 maxHealth is 1, so a board that is full, settled and off the clock
// dies on that frame -- and the drain is gated behind riseLock, which is set for
// the whole of a resolve. So a clear holds a full board for as long as it takes
// to resolve, whether or not it pays any stop time. Judging a full board on
// banked stop time alone refused the one move that saves it: a bare three pays
// nothing and holds the floor for 59 frames, which is exactly the three the save
// is kept for.
//
// Both directions, because a filter that accepts everything is not a filter.
(function () {
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var bot = new BitBot(st, { allowRaise: true });
    var info = { toppedOut: true, stopTime: 0, incoming: 0, health: 1,
                 framesPerRow: 112, framesToNextRow: 112 };
    var board = bot._snapshot();
    var full = bit.maskState(board.grid, board.blocks, W, board.height);
    for (var c = 1; c <= W; c++) full.occ[c] = (1 << 12) - 1;   // every row occupied
    var three = { total: 3, chain: 0, garbage: 0, scope: 'panels' };
    var nothing = { total: 0, chain: 0, garbage: 0, scope: 'none' };
    ok(BF.stopTimeOf(P, false, 3, 0, true) <= 0,
       'a bare three pays stop time on this level, so it is the wrong fixture for ' +
       'the rule that a resolve holds the board WITHOUT paying any');
    ok(!bot.deadly(full, three, info, 112),
       'a full board was called dead with a three ready to fire -- the resolve ' +
       'holds riseLock and the drain cannot run while it does');
    ok(bot.deadly(full, nothing, info, 112),
       'a full board with an empty clock and nothing to fire was called survivable, ' +
       'so the filter accepts everything and refuses nothing');
    // A SHIELD SHORTER THAN AN ACTION IS NOT A SHIELD. puyocpu measured this on
    // its own deaths: 116 moves spared by banked stop time with four frames left
    // on average, and the board still topped out when it ran out.
    ok(bot.deadly(full, nothing, { toppedOut: true, stopTime: 3, incoming: 0,
                                   health: 1, framesPerRow: 112, framesToNextRow: 112 }, 112),
       'three frames of stop time counted as holding a full board, and nothing ' +
       'can be played in three frames');
}());

// ------------------------ 6. a rule reaches the move, whichever path chose it
//
// THE BUG THIS EXISTS FOR, three times over: the beam cut breaks before the
// break-priority rule saw them; the save rule wired into the candidate loop
// only ever narrowed the weights fallback; and "breaking garbage is the
// priority" left bestAttack free to attack with a break in the pool. The attack,
// the survival plan and the flatten plan all read the OPTION list, and the
// candidate list is read by the fallback alone -- the path that runs least.
//
// So this does not test any particular rule. It tests the WIRING: a rule that
// refuses the chosen move must be enforced on it even when the move came from a
// path that never looks at the candidate list.
(function () {
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var bot = new BitBot(st, { allowRaise: true });
    var real = BitBot.prototype._decide, forced = null;
    // Stand in for the attack path: pick some legal swap the ordinary decision
    // did not, and hand it back as though bestAttack had chosen it.
    bot._decide = function () {
        var d = real.call(this), i;
        for (i = 0; i < this._lastPool.length; i++) {
            var c = this._lastPool[i];
            if (c.kind !== 'swap' || !c.masks) continue;
            if (d.move && c.swap[0] === d.move[0] && c.swap[1] === d.move[1]) continue;
            forced = c; break;
        }
        if (!forced) return d;
        return { kind: 'swap', move: forced.swap, mode: d.mode, alive: d.alive,
                 via: 'bestAttack' };
    };
    bot.refuses = function (cand) { return cand === forced ? 'test' : null; };
    var out = bot.decide();
    ok(forced, 'no second swap in the pool, so this proves nothing');
    ok(out && out.kind === 'swap' && out.move, 'the gate refused to move at all');
    ok(out.move[0] !== forced.swap[0] || out.move[1] !== forced.swap[1],
       'a rule refused the chosen move and it was played anyway -- the gate is ' +
       'not enforcing on moves that come from the attack and plan paths, which ' +
       'is the whole reason it exists');
}());

// ------------------------------ 7. an attack may not be the move that opens a hole
//
// A column at zero holds no vertical match and breaks the adjacency a horizontal
// one needs, and it is where a slab bridges. bestAttack ranks cells over frames
// and its shape tiebreak needs exactly equal rates, so it never fires; score()'s
// bumpiness floor ranks the weights fallback only. Both deaths this exists for
// went 2,6,6,6,7,4 -> 2,6,6,6,7,0 and 6,4,2,1,6,8 -> 6,0,1,4,5,7 via this path.
//
// The flag is the option's, so the check is that it is honoured: an option that
// opens a hole must not be chosen while one that does not is available, and the
// one that does not must still be chosen when it is all there is.
(function () {
    // A BOARD WITH AN ATTACK ON IT. At frame 0 every clear is a bare three, which
    // sends nothing, so bestAttack returns null whatever the shape rule does and
    // the check would pass on a board that cannot fail it.
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var bot = new BitBot(st, { allowRaise: true });
    var f, opts = null, all = null;
    for (f = 0; f < 3000 && !st.gameOver; f++) {
        bot.update(); st.run(); st.takeDeliverableGarbage(); st.drainEvents();
        if (f % 50) continue;
        var board = bot._snapshot(), info = bot.info(board);
        opts = require('./bitoptions.js').options(null, W, 12,
                   [info.cursorRow, info.cursorCol], 2,
                   bit.maskState(board.grid, board.blocks, W, board.height),
                   bot.timing(info, 600), false);
        all = opts.now.concat(opts.next);
        if (BitBot.bestAttackOf(opts, BitBot.STARTER, P, 600, st.frames, 112 / W)) break;
    }
    ok(all && all.length > 0, 'no options found in 3,000 frames, so nothing can be compared');
    var reported = 0, i;
    for (i = 0; i < all.length; i++) if (all[i].opensHole !== undefined) reported++;
    ok(reported === all.length,
       reported + ' of ' + all.length + ' options carry opensHole -- an option the ' +
       'attack cannot ask about is an option the rule cannot refuse');
    ok(BitBot.bestAttackOf(opts, BitBot.STARTER, P, 600, st.frames, 112 / W) !== null,
       'no board in 3,000 frames offered an attack, so this cannot test the refusal');
    for (i = 0; i < all.length; i++) all[i].opensHole = true;
    ok(BitBot.bestAttackOf(opts, BitBot.STARTER, P, 600, st.frames, 112 / W) === null,
       'every option opens a hole and an attack was still chosen, so the refusal is ' +
       'not wired into the ranking');
}());

// ------------------ 8. a cooldown lift does not interrupt the bot's own swap
//
// The reaction lifts inside a freeze and inside a reveal window, because an idle
// frame there is a frame of life spent for nothing. But a swap is not finished
// when it is queued: the engine switches the two panels at once and leaves them
// in `swapping` for a few frames, and a match is only read off `normal` panels.
// So a decision taken then is taken on a board between two positions, comes back
// with the same answer, and playing it RESTARTS the animation on the same pair --
// which never completes, so the match under it never fires. Seed 103, ZERO: 51
// frames on one swap inside a 62-frame freeze, then 107 on the next, the board
// alternating between exactly two positions, dead at 2,063 having broken 16 of
// the 57 garbage cells it was sent. With the lift held off until the swap lands:
// alive at 30,000, 289 of 292.
//
// Both directions. A lift that never fires is the bug this rule replaced.
(function () {
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var bot = new BitBot(st, { allowRaise: false });
    var i;
    for (i = 0; i < 400; i++) { bot.update(); st.run(); st.drainEvents(); }

    // The freeze is the lift, and the in-flight swap is what holds it back.
    st.stopTime = 60;
    bot.cooldown = 5;
    st.queuedSwapRow = 0; st.swappingCount = 0;
    // A COMMITTED WALK OWNS THE FRAME and returns above the cooldown block, so
    // each case starts with none in progress or it measures the walk instead.
    bot._walk = null;
    var before = bot.spend.decided;
    bot.update();
    ok(bot.spend.decided > before,
       'a freeze with nothing in flight did not lift the cooldown, so the free ' +
       'frames a freeze exists for are still being thrown away');

    st.stopTime = 60;
    bot.cooldown = 5;
    st.swappingCount = 2;
    bot._walk = null;
    before = bot.spend.decided;
    var cd = bot.cooldown;
    bot.update();
    ok(bot.spend.decided === before,
       'decided again while its own swap was still animating -- replaying that ' +
       'answer restarts the swap and the match under it never fires');
    ok(bot.cooldown === cd - 1,
       'the cooldown did not tick while a swap was landing, so it never runs out');

    st.swappingCount = 0; st.queuedSwapRow = 3;
    bot.cooldown = 5;
    bot._walk = null;
    before = bot.spend.decided;
    bot.update();
    ok(bot.spend.decided === before,
       'decided again with a swap queued and not yet executed, which is the same ' +
       'board mid-change');
    st.queuedSwapRow = 0;
}());

// ------------- 9. emptying a column shapes the choice, it does not forbid it
//
// A column at zero holds no vertical match, breaks the adjacency a horizontal one
// needs, and is where a slab bridges: garbage rests on the tall columns and spans
// the width, so the empty column is sealed and nothing under it reaches the slab.
// Three deaths over seed 101 are that board -- 7,3,2,1,3,4 at 1,446; 8,7,3,1,2,3
// at 14,959; 7,3,4,1,5,7 at 19,371.
//
// It was tried as a refusal at the exit, where it would reach every path, and
// measured over 60 boards: 7 deaths without it, 9 refusing the hole everywhere, 14
// refusing it only under garbage. Taking the move away leaves the bot somewhere
// worse than the hole does, so it stays a preference -- opensHole out of bestAttack
// (invariant 7 above) and score()'s floor on bumpiness and tallest.
//
// What is checked here is that it is NOT a refusal, because re-adding it is the
// obvious thing to try and it has already been paid for three times.
(function () {
    var bo = require('./bitoptions.js');
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var bot = new BitBot(st, { allowRaise: false });
    var i;
    for (i = 0; i < 300; i++) { bot.update(); st.run(); st.drainEvents(); }
    var board = bot._snapshot();
    var info = bot.info(board);
    var base = bit.maskState(board.grid, board.blocks, W, board.height);

    var dirty = bit.copyState(base);
    dirty.occ[1] |= 1 << 8; dirty.inert[1] |= 1 << 8; dirty.garb[1] |= 1 << 8;

    var holed = bit.copyState(base);
    holed.occ[3] = 0; holed.inert[3] = 0; holed.garb[3] = 0;
    for (var a = 1; a <= holed.N; a++) holed.colour[a * (W + 2) + 3] = 0;
    ok(bo.shapeOf(holed).low === 0 && bo.shapeOf(dirty).low > 0,
       'the stub boards do not set up the case, so this checks nothing');

    var cand = { kind: 'swap', swap: [1, 1], masks: holed,
                 resolved: { total: 0, garbage: 0, brokeGarbage: false, chain: null } };
    ok(bot.refuses(cand, info, dirty, false) !== 'hole',
       'emptying a column is being refused at the exit again -- measured at 9 and ' +
       '14 deaths in 60 against 7 without it, in the everywhere and under-garbage ' +
       'forms. It belongs in the ranking, not in the refusals');
}());

// ------------ 10. every board produces a legal action, and no board produces
//                  the same one forever
//
// The two ways the decision ladder fails are DOING NOTHING while something is
// possible, and doing the same thing over and over. Both have happened: a bot
// that spent five hundred of its last six hundred decisions on a board that
// never changed, and a pair of swaps played back and forth for a whole freeze.
//
// The duel gate catches those after the fact over thousands of frames. This
// catches the shapes they come from, instantly, on boards built to be awkward:
// empty, one panel, a single colour with no clear anywhere, a full board, and a
// board buried under garbage with its material out of reach. Each has to yield
// an action that is legal on the board it was asked about.
(function () {
    var boards = {
        empty:       [],
        onePanel:    [[1, 0, 0, 0, 0, 0]],
        oneColour:   [[1, 1, 1, 1, 1, 1]],   // resolves away; nothing to set up
        noClear:     [[1, 2, 3, 1, 2, 3], [2, 3, 1, 2, 3, 1]],
        nearlyFull:  [[1, 2, 3, 1, 2, 3], [2, 3, 1, 2, 3, 1], [3, 1, 2, 3, 1, 2],
                      [1, 2, 3, 1, 2, 3], [2, 3, 1, 2, 3, 1], [3, 1, 2, 3, 1, 2],
                      [1, 2, 3, 1, 2, 3], [2, 3, 1, 2, 3, 1], [3, 1, 2, 3, 1, 2],
                      [1, 2, 3, 1, 2, 3], [2, 3, 1, 2, 3, 1]]
    };
    Object.keys(boards).forEach(function (name) {
        var st = new P.Stack({ level: 10, seed: 101, countdown: false });
        var r, c;
        for (r = 1; r <= st.height; r++)
            for (c = 1; c <= W; c++) { st.panels[r][c].color = 0; st.panels[r][c].isGarbage = false; }
        boards[name].forEach(function (row, ri) {
            for (c = 1; c <= W; c++) st.panels[ri + 1][c].color = row[c - 1];
        });
        var bot = new BitBot(st, { allowRaise: true });
        var d = null, threw = null;
        try { d = bot.decide(); } catch (e) { threw = e; }
        ok(!threw, 'board "' + name + '" threw from decide(): ' + (threw && threw.message));
        ok(d && (d.kind === 'swap' || d.kind === 'hold' || d.kind === 'raise'),
           'board "' + name + '" produced no action at all -- the ladder must always ' +
           'return, because doing nothing is the failure it exists to prevent');
        if (d && d.kind === 'swap') {
            var legal = bit.legalSwapsOf(bot._lastBase), i, found = false;
            for (i = 0; i < legal.length; i++)
                if (legal[i][0] === d.move[0] && legal[i][1] === d.move[1]) { found = true; break; }
            ok(found, 'board "' + name + '" chose a swap the board does not allow, at r' +
               d.move[0] + 'c' + d.move[1]);
        }
    });

    // THE LOOP ITSELF CANNOT BE CHECKED HERE, and the numbers say so. Driving a
    // solo board 3,000 frames, the longest run of one answer with the board
    // unchanged is 3 -- and 1 with the swap-in-flight guard deliberately removed,
    // which is the defect. It takes two boards trading garbage to produce a
    // freeze long enough to wiggle inside, so the duel gate measures it
    // (progress.test.js, `same swap`) and invariant 8 above checks the mechanism
    // that caused it. A check here would pass either way.
}());

console.log('survival: 32 invariants checked without playing a game');
if (fails) { console.log(fails + ' FAILURES'); process.exit(1); }
console.log('survival: OK');
