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
var bitoptions = require('./bitoptions.js');

// THE RISE, OFF THE ENGINE. These said 112 -- a number no engine produces. A
// level-10 stack runs at speed 32 and riseTime(32) * 16 is 120 frames a row, so
// every rate derived from FPROW here was 7% out, in the gate that counts deaths.
var FPROW = (function () {
    var st = new globalThis.PanelEngine.Stack({ level: 10 });
    return globalThis.PanelEngine.riseTime(st.speed) * 16;
}());

var P = globalThis.PanelEngine, W = 6;

var fails = 0;
function materialRowsOf(st) {
    var n = 0, c;
    for (c = 1; c <= W; c++) {
        var g = st.garb[c] >>> 0, fl = g ? (g & -g) : 0, bel = fl ? (fl - 1) : 0xffffffff;
        var m = (st.occ[c] & ~g & bel) >>> 0, k = 0;
        while (m) { m &= m - 1; k++; }
        n += k;
    }
    return n / W;
}
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
                 framesPerRow: FPROW, framesToNextRow: FPROW };
    var board = bot._snapshot();
    var full = bit.maskState(board.grid, board.blocks, W, board.height);
    for (var c = 1; c <= W; c++) full.occ[c] = (1 << 12) - 1;   // every row occupied
    var three = { total: 3, chain: 0, garbage: 0, scope: 'panels' };
    var nothing = { total: 0, chain: 0, garbage: 0, scope: 'none' };
    ok(BF.stopTimeOf(P, false, 3, 0, true) <= 0,
       'a bare three pays stop time on this level, so it is the wrong fixture for ' +
       'the rule that a resolve holds the board WITHOUT paying any');
    ok(!bot.deadly(full, three, info, FPROW),
       'a full board was called dead with a three ready to fire -- the resolve ' +
       'holds riseLock and the drain cannot run while it does');
    ok(bot.deadly(full, nothing, info, FPROW),
       'a full board with an empty clock and nothing to fire was called survivable, ' +
       'so the filter accepts everything and refuses nothing');
    // A SHIELD SHORTER THAN AN ACTION IS NOT A SHIELD. puyocpu measured this on
    // its own deaths: 116 moves spared by banked stop time with four frames left
    // on average, and the board still topped out when it ran out.
    ok(bot.deadly(full, nothing, { toppedOut: true, stopTime: 3, incoming: 0,
                                   health: 1, framesPerRow: FPROW, framesToNextRow: FPROW }, FPROW),
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
        if (BitBot.bestAttackOf(opts, BitBot.STARTER, P, 600, st.frames, FPROW / W)) break;
    }
    ok(all && all.length > 0, 'no options found in 3,000 frames, so nothing can be compared');
    var reported = 0, i;
    for (i = 0; i < all.length; i++) if (all[i].opensHole !== undefined) reported++;
    ok(reported === all.length,
       reported + ' of ' + all.length + ' options carry opensHole -- an option the ' +
       'attack cannot ask about is an option the rule cannot refuse');
    ok(BitBot.bestAttackOf(opts, BitBot.STARTER, P, 600, st.frames, FPROW / W) !== null,
       'no board in 3,000 frames offered an attack, so this cannot test the refusal');
    for (i = 0; i < all.length; i++) all[i].opensHole = true;
    ok(BitBot.bestAttackOf(opts, BitBot.STARTER, P, 600, st.frames, FPROW / W) === null,
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

// ------------------- 10. the raise trigger, condition by condition
//
// raiseMode is where every gate this bot has got wrong tonight lived: a height
// cap, a flatness cap, a material cap, a readiness veto. It is a pure function
// of (info, base) and it decides one thing -- whether the bot is raising -- so
// each condition is checkable on its own, instantly, with no game at all.
//
// The conditions, in the order the function applies them:
//   allowRaise off, or topped out   -> never
//   the row and everything queued must fit under the ceiling
//   past the opening, material at or above the floor -> nothing to raise for
//   any garbage on the board        -> dig instead
//   nothing fireable                -> the row must not land on a dead board
(function () {
    function botOn(rows, opts) {
        var st = new P.Stack({ level: 10, seed: 101, countdown: false });
        var r, c;
        for (r = 1; r <= st.height; r++)
            for (c = 1; c <= W; c++) { st.panels[r][c].color = 0; st.panels[r][c].isGarbage = false; }
        rows.forEach(function (row, ri) {
            for (c = 1; c <= W; c++) {
                st.panels[ri + 1][c].color = row[c - 1] < 0 ? 8 : row[c - 1];
                st.panels[ri + 1][c].isGarbage = row[c - 1] < 0;
            }
        });
        var bot = new BitBot(st, opts || { allowRaise: true });
        var board = bot._snapshot();
        return { bot: bot, st: st, info: bot.info(board),
                 base: bit.maskState(board.grid, board.blocks, W, board.height) };
    }
    // Low, clean, and genuinely one swap from a clear -- swapping c3 and c4 in the
    // bottom row makes 1,1,1. A board whose 1s are merely present but two swaps
    // apart is refused, correctly, and reads as the opening being broken.
    var OPEN = [[1, 1, 2, 1, 4, 5],
                [2, 3, 4, 5, 3, 2]];

    var a = botOn(OPEN);
    a.bot._opening = true;
    ok(a.bot.raiseMode(a.info, a.base) === 'opening',
       'raise trigger: a low clean board with a clear in hand did not open, so the ' +
       'opening cannot happen at all');

    var b = botOn(OPEN, { allowRaise: false });
    b.bot._opening = true;
    ok(b.bot.raiseMode(b.info, b.base) === null,
       'raise trigger: allowRaise false still raised');

    var c2 = botOn(OPEN);
    c2.bot._opening = true;
    var infoTop = {}; Object.keys(c2.info).forEach(function (k) { infoTop[k] = c2.info[k]; });
    infoTop.toppedOut = true;
    ok(c2.bot.raiseMode(infoTop, c2.base) === null,
       'raise trigger: raised while topped out, which is the one board a row kills');
    ok(c2.bot._opening === false,
       'raise trigger: topped out did not end the opening, so it resumes raising ' +
       'the moment the board comes down');

    // NO ROOM. The row lands under the stack and lifts everything, so a board
    // filled to the ceiling has nowhere to put it.
    // EVERY NEGATIVE CASE PASSES EVERY OTHER CONDITION, or removing the one under
    // test changes nothing and the check cannot fail. So each carries the same
    // one-swap clear the opening board has.
    //
    // NO CASE FOR "no room for the row", because there is no board that only that
    // condition rejects. A board with no room carries eleven rows of material, and
    // the line above it turns the opening off when the row does not fit -- so the
    // material floor rejects it first whichever way it came in. The check is
    // redundant rather than wrong, and a test for it would pass with it deleted.

    // PAST THE OPENING, material at or above the floor is nothing to raise for.
    var deep = [[2, 3, 4, 5, 3, 2], [3, 4, 5, 2, 4, 3], [4, 5, 2, 3, 5, 4],
                [5, 2, 3, 4, 2, 5], [1, 1, 2, 1, 4, 5]];
    var e2 = botOn(deep);
    e2.bot._opening = false;
    ok(e2.bot.raiseMode(e2.info, e2.base) === null,
       'raise trigger: raised for material on a board that already has plenty');

    // GARBAGE ON THE BOARD: the answer is to dig, and a row only buries it deeper.
    var dirty = botOn([[-1, -1, -1, -1, -1, -1], [1, 1, 2, 1, 4, 5]]);
    dirty.bot._opening = true;
    ok(dirty.bot.raiseMode(dirty.info, dirty.base) === null,
       'raise trigger: raised with garbage on the board, where the row buries what ' +
       'has to be broken');

    // NOTHING TO FIRE: the row must not land on a board with no answer on it.
    var dead = botOn([[1, 2, 3, 4, 5, 6]]);
    dead.bot._opening = true;
    ok(dead.bot.raiseMode(dead.info, dead.base) === null,
       'raise trigger: raised onto a board with no clear anywhere, which is the ' +
       'board that must not be filled');
}());

// --------------------- 11. the order of the ladder, with the paths stubbed
//
// Which branch wins when more than one could fire. Every bug in this area has
// been an ordering one: levelFirst placed where `delivering` had already
// returned, so it fired zero times; the slab setup placed before levelling, so
// it searched for a break on a board too lumpy to hold one. Neither shows up in
// a test of the branches themselves -- both were correct in isolation.
//
// Stubbed rather than played, so it is the ORDER being checked and nothing else.
(function () {
    function freshBot() {
        var st = new P.Stack({ level: 10, seed: 101, countdown: false });
        var r, c;
        for (r = 1; r <= st.height; r++)
            for (c = 1; c <= W; c++) { st.panels[r][c].color = 0; st.panels[r][c].isGarbage = false; }
        [[1, 1, 2, 1, 4, 5], [2, 3, 4, 5, 3, 2]].forEach(function (row, ri) {
            for (c = 1; c <= W; c++) st.panels[ri + 1][c].color = row[c - 1];
        });
        return { bot: new BitBot(st, { allowRaise: true }), st: st };
    }

    // LEVELLING COMES BEFORE THE ROW. A raise carries the surface it has upward,
    // so a board with levelling worth doing levels first -- and the way it stops
    // the row is by dropping the intent, not by being asked later.
    var a = freshBot();
    a.bot.raiseMode = function () { return 'material'; };
    a.bot.flattenFirst = function () { return { swaps: [[1, 2]], duration: 4 }; };
    var da = a.bot.decide();
    ok(da && da.via === 'levelFirst',
       'ladder: with levelling available the bot did not level before raising -- it ' +
       'came back via `' + (da && da.via) + '`');
    ok(a.bot._wantRaise === false,
       'ladder: levelling ran but left the raise intent on, so update() keeps the ' +
       'button held and the row arrives during the levelling');

    // AND IT FIRES WHEN THE ENGINE IS NOT OFFERING A ROW YET, which is the whole
    // of the historical bug: gated on `delivering` -- the engine handing a row
    // over right now -- levelling fired zero times, because by then the row is
    // already coming and the shape it carries up is fixed. preventManualRaise
    // takes the raise out of the pool, so the intent is on and the offer is not.
    var a2 = freshBot();
    a2.st.preventManualRaise = true;
    a2.bot.raiseMode = function () { return 'material'; };
    a2.bot.flattenFirst = function () { return { swaps: [[1, 2]], duration: 4 }; };
    var da2 = a2.bot.decide();
    ok(da2 && da2.via === 'levelFirst',
       'ladder: levelling did not fire while the raise was wanted but not yet being ' +
       'handed over -- came back via `' + (da2 && da2.via) + '`. Gated on the offer ' +
       'instead of the intent, it fires zero times');

    // WITH NOTHING TO LEVEL, the raise is what happens.
    var b = freshBot();
    b.bot.raiseMode = function () { return 'opening'; };
    b.bot.flattenFirst = function () { return null; };
    var db = b.bot.decide();
    ok(db && (db.kind === 'raise' || db.via === 'raising'),
       'ladder: raising with nothing to level came back via `' + (db && db.via) +
       '` instead of taking or waiting for the row');

    // AND WITH THE RAISE OFF, neither fires and the board is played normally.
    var c3 = freshBot();
    c3.bot.raiseMode = function () { return null; };
    var stubbed = false;
    c3.bot.flattenFirst = function () { stubbed = true; return { swaps: [[1, 2]], duration: 4 }; };
    var dc = c3.bot.decide();
    ok(dc && dc.via !== 'levelFirst',
       'ladder: levelled before a raise that is not happening -- levelFirst is the ' +
       'raise preparing itself, not a move in its own right');
    ok(!stubbed,
       'ladder: the flatten route was searched for with the raise off, which is work ' +
       'done for a branch that cannot fire');
}());

// ------------------ 12. the exit gate's refusals, one rule at a time
//
// refuses() is the other half of the gating: raiseMode decides what the bot is
// doing, this decides what it may not play, and it is applied at the exit to
// whatever any path chose. Two live rules and one exemption, each checkable on
// its own because it is a pure function of (candidate, info, base, survival).
//
//   payless   a three that neither sends nor breaks spends the vertical
//             structure a chain is made of and the engine pays nothing for it
//   starving  under the working floor, only a break may clear: every panel spent
//             elsewhere is spent on never digging out
//   survival  exempt from both -- a board that needs the clock takes whatever
//             buys it, and that exemption was measured at 15 deaths in 30 when
//             it was removed
(function () {
    function setup(rows) {
        var st = new P.Stack({ level: 10, seed: 101, countdown: false });
        var r, c;
        for (r = 1; r <= st.height; r++)
            for (c = 1; c <= W; c++) { st.panels[r][c].color = 0; st.panels[r][c].isGarbage = false; }
        rows.forEach(function (row, ri) {
            for (c = 1; c <= W; c++) st.panels[ri + 1][c].color = row[c - 1];
        });
        var bot = new BitBot(st, { allowRaise: true });
        var board = bot._snapshot();
        return { bot: bot, info: bot.info(board),
                 base: bit.maskState(board.grid, board.blocks, W, board.height) };
    }
    function cand(resolved) {
        return { kind: 'swap', swap: [1, 2], masks: null, resolved: resolved };
    }
    // A three, no chain, no garbage broken: the engine's table pays nothing for
    // three panels, so this sends nothing and takes nothing off the board.
    var PAYLESS = { total: 3, chain: 1, brokeGarbage: false, garbage: 0 };
    // A clear that DOES send, so the payless rule does not catch it first and the
    // starving rule is the only thing that can refuse it. A bare three here passes
    // the test either way, which is no test at all.
    var PLAIN   = { total: 5, chain: 1, brokeGarbage: false, garbage: 0 };
    var BREAK   = { total: 3, chain: 1, brokeGarbage: true,  garbage: 6 };

    var thin = setup([[1, 2, 3, 1, 2, 3], [2, 3, 1, 2, 3, 1]]);          // 2 rows
    var fat  = setup([[1, 2, 3, 1, 2, 3], [2, 3, 1, 2, 3, 1],
                      [3, 1, 2, 3, 1, 2], [1, 2, 3, 1, 2, 3],
                      [2, 3, 1, 2, 3, 1], [3, 1, 2, 3, 1, 2]]);          // 6 rows

    ok(fat.bot.refuses(cand(PAYLESS), fat.info, fat.base, false) === 'payless',
       'refusals: a three that neither sends nor breaks was allowed -- it spends the ' +
       'structure a chain is made of and the engine pays nothing for it');

    // AND THE RULE HAS A CONDITION: a break has to be on the table for it to
    // refuse a clear in favour of one. Breaking comes first, but a board that
    // CANNOT break still needs stop time -- that is what buys the moves to reach a
    // break at all, and the clock is the one thing that cannot be earned back.
    ok(thin.bot.refuses(cand(PLAIN), thin.info, thin.base, false, true) === 'starving',
       'refusals: a plain clear was allowed on a board under the working floor, ' +
       'where every panel spent elsewhere is spent on never digging out');

    ok(thin.bot.refuses(cand(PLAIN), thin.info, thin.base, false, false) === null,
       'refusals: a clear was refused on a thin board with NO break available. ' +
       'Refusing it does not save the panels for digging -- there is nothing to ' +
       'dig with -- it spends the clock instead, and 17 held-floor clears went ' +
       'that way on a board that died of time');
    ok(thin.bot.refuses(cand(BREAK), thin.info, thin.base, false, true) === null,
       'refusals: a break was refused on a thin board, which is the one move the ' +
       'rule exists to protect');

    ok(fat.bot.refuses(cand(PLAIN), fat.info, fat.base, false) === null,
       'refusals: the same sending clear was refused on a board with material to ' +
       'spare, where there is no dig to starve');

    ok(thin.bot.refuses(cand(BREAK), thin.info, thin.base, false) !== 'starving',
       'refusals: a BREAK was refused for starving the board -- breaking is the only ' +
       'thing that takes garbage off it, and it is the exemption the rule is built ' +
       'around');

    ok(fat.bot.refuses(cand(PAYLESS), fat.info, fat.base, true) === null,
       'refusals: survival was refused a move. A board that needs the clock takes ' +
       'whatever buys it, and removing that exemption measured 15 deaths in 30');

    ok(fat.bot.refuses({ kind: 'hold' }, fat.info, fat.base, false) === null &&
       fat.bot.refuses(null, fat.info, fat.base, false) === null,
       'refusals: something other than a swap was put to the rules, which are about ' +
       'what a swap spends');
}());

// -------------- 13. shape is not something a rate gets to weigh, in EITHER path
//
// A vertical three takes three panels out of one column and drops it three below
// its neighbours; a horizontal three takes one from each of three and leaves the
// surface where it was. Same cells, different board after.
//
// bestAttack has narrowed to the shape-preserving options for a while. bestPlan
// -- the survival plan, the path that fires most -- ranked on frames bought per
// frame spent and had no shape awareness at all. That is the move that built the
// tower on the board this bot dies on: 8,5,3,5,5,9 to 8,5,0,5,2,9 in thirty
// frames, two columns each dropping by exactly three.
//
// Put to the functions directly with hand-built option lists, because the choice
// between two plans is what is being checked, not a game that reaches it.
(function () {
    var engine = P;
    function plan(o) {
        return { swaps: [[1, 1]], frames: o.frames, duration: o.frames,
                 total: o.total, chain: 1, garbage: 0, kind: 'combo',
                 size: o.total, levels: o.levels, bumps: o.levels ? 2 : 9,
                 tall: 5, mat: 4, low: 2, opensHole: false };
    }
    // The shape-costing plan is the BETTER one on rate: more cells for the same
    // frames. If shape is not consulted it wins, which is the defect.
    var costsShape = plan({ frames: 10, total: 6, levels: false });
    var keepsShape = plan({ frames: 10, total: 4, levels: true });

    var both = BitBot.bestPlanOf({ now: [costsShape, keepsShape], next: [] },
                                 0, 600, engine, false, FPROW, { FLASH: 28, FACE: 10, POP: 7 }, 5);
    ok(both && both.option === keepsShape,
       'survival plan: took the plan that costs shape over one that does not -- a ' +
       'vertical three empties a column by three and that is what a slab bridges on');

    // AND IT STANDS ASIDE WHEN EVERY PLAN COSTS SHAPE: the shape was going to be
    // paid whatever was played, so the better plan is the better plan.
    var worse = plan({ frames: 10, total: 3, levels: false });
    var onlyCosting = BitBot.bestPlanOf({ now: [costsShape, worse], next: [] },
                                        0, 600, engine, false, FPROW, { FLASH: 28, FACE: 10, POP: 7 }, 5);
    ok(onlyCosting && onlyCosting.option === costsShape,
       'survival plan: with every plan costing shape it did not take the best one, ' +
       'so the narrowing empties the list instead of standing aside');
}());

// ------------------------- 14. a break in hand is played, whatever the material
//
// It used to wait for the board to drop under six rows -- a rule about which
// candidate to prefer, borrowed as a condition on whether to play a break at
// all. So with material in hand the bot could hold a break and attack instead,
// and the slab stayed. A garbage cell comes off the board no other way.
(function () {
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var r, c;
    for (r = 1; r <= st.height; r++)
        for (c = 1; c <= W; c++) { st.panels[r][c].color = 0; st.panels[r][c].isGarbage = false; }
    // Six rows of material -- comfortably over the old threshold -- with a three
    // one swap away in the row directly under a slab, so the swap breaks it.
    var rows = [[2, 3, 4, 5, 3, 2], [3, 4, 5, 2, 4, 3], [4, 5, 2, 3, 5, 4],
                [5, 2, 3, 4, 2, 5], [2, 3, 4, 5, 3, 2], [1, 1, 2, 1, 4, 5]];
    rows.forEach(function (row, ri) {
        for (c = 1; c <= W; c++) st.panels[ri + 1][c].color = row[c - 1];
    });
    for (c = 1; c <= W; c++) { st.panels[7][c].color = 8; st.panels[7][c].isGarbage = true; }

    var bot = new BitBot(st, { allowRaise: false });
    var board = bot._snapshot();
    var base = bit.maskState(board.grid, board.blocks, W, board.height);
    ok(materialRowsOf(base) >= 6,
       'break in hand: the board carries ' + materialRowsOf(base).toFixed(1) + ' rows, ' +
       'under the six the old rule waited for, so this cannot test it');

    var d = bot.decide();
    ok(d && d.via === 'break',
       'break in hand: a break was available with six rows of material and the bot ' +
       'came back via `' + (d && d.via) + '` instead. Nothing outranks taking the ' +
       'garbage off the board');
}());

// -------------- 15. a tower is urgent, and a tower is a SPREAD
//
// towering() is the trigger that sends the bot to fix its shape while it still
// has moves to play. Two things have to hold, and neither is visible from a
// death count: it fires at WORKING_ROWS and not before, and it measures the rows
// a slab would seal rather than how bumpy the surface looks.
(function () {
    function masksOfHeights(h) {
        var st = new P.Stack({ level: 10, seed: 101, countdown: false }), r, c;
        for (r = 1; r <= st.height; r++)
            for (c = 1; c <= W; c++) { st.panels[r][c].color = 0; st.panels[r][c].isGarbage = false; }
        for (c = 1; c <= W; c++)
            for (r = 1; r <= h[c - 1]; r++) st.panels[r][c].color = 1 + ((r + c) % 3);
        var bot = new BitBot(st, { allowRaise: true }), b = bot._snapshot();
        return { bot: bot, masks: bit.maskState(b.grid, b.blocks, W, b.height) };
    }
    var N = BitBot.WORKING_ROWS;

    // THE BOUNDARY IS WORKING_ROWS, both sides of it. One row short is a board the
    // bot can still work in; at WORKING_ROWS a whole working floor goes under the
    // slab the moment a load lands.
    var under = masksOfHeights([N, 1, 1, 1, 1, 1]);          // spread N-1
    var at = masksOfHeights([N + 1, 1, 1, 1, 1, 1]);         // spread N
    ok(bitoptions.shapeOf(under.masks).spread === N - 1 &&
       bitoptions.shapeOf(at.masks).spread === N,
       'the boundary boards no longer read one either side of WORKING_ROWS (' +
       bitoptions.shapeOf(under.masks).spread + ' and ' +
       bitoptions.shapeOf(at.masks).spread + '), so this pair checks nothing');
    ok(!under.bot.towering(under.masks),
       'towering at spread ' + (N - 1) + ', one row inside the working floor -- the ' +
       'shape path then runs on boards that are still workable and there is nothing ' +
       'left between "fine" and "urgent"');
    ok(at.bot.towering(at.masks),
       'not towering at spread ' + N + ', which is a whole working floor sealed by ' +
       'the next slab');

    // AND IT IS THE SPREAD, NOT THE BUMPINESS. A smooth ramp seals four rows and
    // reads calm by neighbour steps; a sawtooth seals two and reads alarming.
    // Judged by bumps the bot goes and fixes the wrong board.
    var ramp = masksOfHeights([1, 2, 3, 4, 5, 5]);           // bumps 4, spread 4
    var saw = masksOfHeights([1, 3, 1, 3, 1, 3]);            // bumps 10, spread 2
    ok(bitoptions.shapeOf(saw.masks).bumps > bitoptions.shapeOf(ramp.masks).bumps,
       'the sawtooth no longer reads bumpier than the ramp, so this pair no longer ' +
       'separates the two measures');
    ok(ramp.bot.towering(ramp.masks),
       'the ramp seals four rows under the next slab and towering() called it fine ' +
       '-- bumpiness is what calls it fine, and it is the measure that is wrong');
    ok(!saw.bot.towering(saw.masks),
       'the sawtooth is lumpy but seals two rows, and towering() called it urgent ' +
       '-- the trigger is reading bumpiness');

    // MATERIAL ABOVE A SLAB IS NOT A TOWER. It is in another pocket: nothing the
    // bot plays spreads it sideways, and the slab it would be measured against is
    // already underneath it.
    var st2 = new P.Stack({ level: 10, seed: 101, countdown: false }), r2, c2;
    for (r2 = 1; r2 <= st2.height; r2++)
        for (c2 = 1; c2 <= W; c2++) { st2.panels[r2][c2].color = 0; st2.panels[r2][c2].isGarbage = false; }
    for (c2 = 1; c2 <= W; c2++) {
        st2.panels[1][c2].color = 1 + (c2 % 3);
        st2.panels[2][c2].color = 1 + ((c2 + 1) % 3);
        st2.panels[3][c2].color = 8; st2.panels[3][c2].isGarbage = true;
    }
    for (r2 = 4; r2 <= 8; r2++) st2.panels[r2][1].color = 1 + (r2 % 3);
    var sb = new BitBot(st2, { allowRaise: true }), sm0 = sb._snapshot();
    var sm = bit.maskState(sm0.grid, sm0.blocks, W, sm0.height);
    ok(!sb.towering(sm),
       'five panels stranded above a slab were called a tower -- they are in another ' +
       'pocket and no swap the bot plays can spread them');
}());

// ------------- 16. the tower reaches the move, and it only ADDS to the rule
//
// The recurring bug in this ladder is a rule written into a stage that does not
// feed the path that picks the move. So: the same board twice, differing only in
// whether one column runs away from the rest -- and what comes back has to
// differ with it.
//
// The option list is stubbed to one flatten route and nothing else, so the paths
// above cannot answer and the question is purely whether the shape branch
// opened; the raise is stubbed off for the same reason. Both boards have a clear
// available and the clock stopped, which is exactly the case the old rule shut
// the shape branch on.
(function () {
    var real = bitoptions.options;
    function via(cols, stopTime) {
        var st = new P.Stack({ level: 10, seed: 101, countdown: false }), r, c;
        for (r = 1; r <= st.height; r++)
            for (c = 1; c <= W; c++) { st.panels[r][c].color = 0; st.panels[r][c].isGarbage = false; }
        for (c = 1; c <= W; c++)
            for (r = 1; r <= cols[c - 1].length; r++) st.panels[r][c].color = cols[c - 1][r - 1];
        if (stopTime) st.stopTime = stopTime;
        var bot = new BitBot(st, { allowRaise: true });
        var b = bot._snapshot(), m = bit.maskState(b.grid, b.blocks, W, b.height);
        var ls = bit.legalSwapsOf(m), pick = null, i;
        for (i = 0; i < ls.length; i++) if (ls[i][0] === 1) { pick = ls[i]; break; }
        bitoptions.options = function () {
            return { now: [], next: [], cheapest: null, save: null, ready: 0,
                     flatten: { swaps: [pick], duration: 4, lands: null, value: 1 },
                     swapsConsidered: 0, refused: 0, unknown: 0 };
        };
        bot.raiseMode = function () { return null; };
        var d;
        try { d = bot.decide(); } finally { bitoptions.options = real; }
        return { via: d && d.via, clear: bit.anyOneSwapClear(m), towering: bot.towering(m) };
    }
    //          one column five deep, the rest one -- spread 4
    var TOWER = [[1, 2, 1, 2, 1], [2], [3], [2], [2], [3]];
    //          the same bottom row with the tower taken off -- spread 0
    var LEVEL = [[1], [2], [3], [2], [2], [3]];
    //          level, and nothing any single swap can fire
    var QUIET = [[1], [2], [3], [4], [5], [1]];

    var t = via(TOWER, 0), l = via(LEVEL, 0);
    ok(t.clear && l.clear && t.towering && !l.towering,
       'the two boards no longer differ in the tower alone (tower: clear ' + t.clear +
       ' towering ' + t.towering + ', level: clear ' + l.clear + ' towering ' +
       l.towering + '), so the comparison below proves nothing');
    ok(t.via === 'flatten',
       'a board with a column four rows clear of the rest came back via `' + t.via +
       '` with a clear in hand -- the tower rule does not reach the move, which is ' +
       'the shape of every other bug in this ladder');
    ok(l.via !== 'flatten',
       'a level board with a clear in hand and the clock stopped came back via ' +
       '`flatten` -- the shape branch is open on every board, so the tower is not ' +
       'what opened it and nothing is being triggered on');

    // AND THE TWO LEGS IT WAS ADDED TO STILL CARRY. A tower is one more reason to
    // fix the shape, not a replacement for the two already there.
    ok(via(LEVEL, 60).via === 'flatten',
       'a freeze no longer opens the shape branch -- while the clock runs the floor ' +
       'is held and shape work costs nothing it needs back');
    ok(via(QUIET, 0).via === 'flatten',
       'a board with nothing to fire no longer opens the shape branch, which is the ' +
       'leg the whole flatten path was built on');
}());



// -------- 17. neither path plays the move that empties a column
//
// A column at zero holds no vertical match, breaks the adjacency a horizontal
// one needs, and is where a slab bridges: garbage rests on the tall columns and
// spans the width, so the empty column is sealed and nothing under it can reach
// the slab. Seven deaths measured over two builds, every one a column at zero,
// one or two beside a tower.
//
// bestAttack has refused it for a while. bestPlan is the path that picks most of
// the moves and had no equivalent -- the same drift as `levels`, caught later.
// So it is checked on each path, because reaching one is not reaching another.
(function () {
    var engine = P, FT = { FLASH: 28, FACE: 10, POP: 7 }, WV = {};
    BF.keys().forEach(function (k) { WV[k] = 0; });
    function o(over) {
        var x = { kind: 'combo', swaps: [[1, 1]], frames: 10, duration: 10, chain: 0,
                  total: 4, size: 4, garbage: 0, tall: 5, bumps: 2, mat: 5, low: 2,
                  levels: true, opensHole: false };
        for (var k in over) x[k] = over[k];
        return x;
    }
    // The hole-opener is the BETTER move on rate -- more cells for the same
    // frames -- so if shape is not consulted it wins, which is the defect.
    var holeA = o({ total: 8, size: 8, opensHole: true, low: 0 });
    var keepA = o({ total: 4, size: 4, opensHole: false, swaps: [[1, 3]] });
    var pickA = BitBot.bestAttackOf({ now: [holeA, keepA], next: [] }, WV, engine, 600, FT, 18.7);
    ok(pickA && pickA.option === keepA,
       'attack: took the move that empties a column over one that does not');

    var holeP = o({ total: 8, size: 8, opensHole: true, low: 0 });
    var keepP = o({ total: 4, size: 4, opensHole: false, swaps: [[1, 3]] });
    var pickP = BitBot.bestPlanOf({ now: [holeP, keepP], next: [] },
                                  0, 600, engine, false, FPROW, FT, 5);
    ok(pickP && pickP.option === keepP,
       'survival plan: took the move that empties a column over one that does not. ' +
       'bestAttack has refused this for a while and this is the path that picks ' +
       'most of the moves -- the same drift `levels` had');

    // AND A BREAK IS NOT REFUSED BY IT. Its settled board is unknowable, so `low`
    // is null and opensHole is false -- exempt without being excused.
    var brk = o({ total: 3, size: 3, garbage: 4, breaks: true, opensHole: false,
                  mat: null, low: null, bumps: null, swaps: [[1, 5]] });
    var pickB = BitBot.bestPlanOf({ now: [brk], next: [] },
                                  0, 600, engine, false, FPROW, FT, 5);
    ok(pickB && pickB.option === brk,
       'survival plan: a break was refused by the hole rule -- `low` is null on a ' +
       'break and a null is not a zero');

    // AND IT IS A REFUSAL, NOT A NARROWING: with every plan opening a hole the
    // list does not empty, because `low === 0 && BASELOW > 0` is already the
    // transition. A board that already has the hole offers options that do not
    // carry the flag, so there is always something left.
    var onlyHoles = BitBot.bestPlanOf(
        { now: [o({ total: 8, size: 8, opensHole: true, low: 0 }),
                o({ total: 4, size: 4, opensHole: true, low: 0, swaps: [[1, 3]] })], next: [] },
        0, 600, engine, false, FPROW, FT, 5);
    ok(onlyHoles === null,
       'survival plan: returned a plan when every plan on offer opens a hole -- ' +
       'this is a refusal, and a board where every move empties a column is a ' +
       'board the weights fallback has to answer for');
}());

// ---- 18. neither path takes the LAST way to break
//
// A garbage cell comes off the board one way -- three panels in a line against
// it -- and a cell that never comes off is a row of ceiling gone for good. Seven
// deaths over two builds, every one a board that could still FIRE and could no
// longer BREAK.
//
// A TRANSITION, NOT A STATE, which is the whole of why this works and
// `breakReady === false` did not. Refusing the state punishes a position rather
// than the move that made it, and empties the list on a board that has already
// lost its break: measured at three deaths among STARTER and ZERO in thirteen
// pairings against none in sixty.
(function () {
    var engine = P, FT = { FLASH: 28, FACE: 10, POP: 7 }, WV = {};
    BF.keys().forEach(function (k) { WV[k] = 0; });
    function o(over) {
        var x = { kind: 'combo', swaps: [[1, 1]], frames: 10, duration: 10, chain: 0,
                  total: 4, size: 4, garbage: 0, tall: 5, bumps: 2, mat: 5, low: 2,
                  levels: true, opensHole: false, breakReady: true, closesBreak: false };
        for (var k in over) x[k] = over[k];
        return x;
    }
    // The bigger move shuts the door. Both can fire afterwards -- that is a
    // different question and not the one that killed these boards.
    var shutA = o({ total: 8, size: 8, breakReady: false, closesBreak: true });
    var keepA = o({ total: 4, size: 4, swaps: [[1, 3]] });
    var pickA = BitBot.bestAttackOf({ now: [shutA, keepA], next: [] }, WV, engine, 600, FT, 18.7);
    ok(pickA && pickA.option === keepA,
       'attack: took the bigger attack that leaves the board unable to break. It ' +
       'can still fire, which is not the same question');

    var shutP = o({ total: 8, size: 8, breakReady: false, closesBreak: true });
    var keepP = o({ total: 4, size: 4, swaps: [[1, 3]] });
    var pickP = BitBot.bestPlanOf({ now: [shutP, keepP], next: [] },
                                  0, 600, engine, false, FPROW, FT, 5);
    ok(pickP && pickP.option === keepP,
       'survival plan: took the route that leaves the board unable to break. This ' +
       'is the path that picked the move on nearly every frame of all seven boards');

    // A BOARD THAT ALREADY CANNOT BREAK IS NOT PUNISHED FOR IT. closesBreak is
    // false on every option there -- nothing can close what was never open -- so
    // the list stands and the best move is played. This is the case that made the
    // absolute form cost three deaths among STARTER and ZERO.
    var goneA = o({ total: 8, size: 8, breakReady: false, closesBreak: false });
    var goneB = o({ total: 4, size: 4, breakReady: false, closesBreak: false, swaps: [[1, 3]] });
    var pickG = BitBot.bestAttackOf({ now: [goneA, goneB], next: [] }, WV, engine, 600, FT, 18.7);
    ok(pickG && pickG.option === goneA,
       'attack: a board that had already lost its break was refused its best move ' +
       '-- the rule is a transition and nothing can close a door already shut');
    var pickG2 = BitBot.bestPlanOf({ now: [goneA, goneB], next: [] },
                                   0, 600, engine, false, FPROW, FT, 5);
    ok(pickG2 && pickG2.option === goneA,
       'survival plan: a board that had already lost its break was refused its best ' +
       'move');

    // AND A BREAK IS NEVER REFUSED BY THE BREAK RULE. Its settled board is
    // unknowable, so breakReady is null, so closesBreak is false.
    var brk = o({ total: 3, size: 3, garbage: 4, breaks: true, breakReady: null,
                  closesBreak: false, mat: null, low: null, bumps: null, swaps: [[1, 5]] });
    var pickB = BitBot.bestPlanOf({ now: [brk], next: [] },
                                  0, 600, engine, false, FPROW, FT, 5);
    ok(pickB && pickB.option === brk,
       'survival plan: a break was refused by a rule about keeping breaks alive -- ' +
       '`breakReady` is null on a break and a null is not a no');
}());

// ------- 19. the two paths refuse the same things
//
// Every shape rule in this file has been written twice, once per path, and every
// one of them has drifted: `levels` reached bestAttack only and the move that
// built the tower it was written for came via the survival plan; `opensHole`
// reached bestAttack only, through seven more deaths. Both were found on a death
// board because nothing here could notice.
//
// This notices. It puts the SAME option to both paths and requires them to agree
// about whether it is playable, so a rule added to one and not the other fails
// here rather than in a duel three hours later.
(function () {
    var engine = P, FT = { FLASH: 28, FACE: 10, POP: 7 }, WV = {};
    BF.keys().forEach(function (k) { WV[k] = 0; });
    function o(over) {
        var x = { kind: 'combo', swaps: [[1, 1]], frames: 10, duration: 10, chain: 0,
                  total: 4, size: 4, garbage: 0, tall: 5, bumps: 2, mat: 5, low: 2,
                  levels: true, opensHole: false, breakReady: true, closesBreak: false };
        for (var k in over) x[k] = over[k];
        return x;
    }
    // A plain option beside the one under test, so each path always has something
    // to fall back to and "refused" means refused rather than "nothing offered".
    var plain = o({ total: 3, size: 3, frames: 400, duration: 400, swaps: [[1, 3]] });
    function attackTakes(x) {
        var p = BitBot.bestAttackOf({ now: [x, plain], next: [] }, WV, engine, 600, FT, 18.7);
        return !!(p && p.option === x);
    }
    function planTakes(x) {
        var p = BitBot.bestPlanOf({ now: [x, plain], next: [] }, 0, 600, engine, false, FPROW, FT, 5);
        return !!(p && p.option === x);
    }

    // Each case is the SAME option, strong enough on rate that only a refusal can
    // keep it from being chosen.
    var cases = [
        ['a clean big combo',            o({ total: 8, size: 8 })],
        ['one that empties a column',    o({ total: 8, size: 8, opensHole: true, low: 0 })],
        ['one that takes the last break',o({ total: 8, size: 8, breakReady: false, closesBreak: true })],
        ['one on a board already sealed',o({ total: 8, size: 8, breakReady: false, closesBreak: false })],
        ['a break',                      o({ total: 3, size: 3, garbage: 4, breaks: true,
                                             breakReady: null, closesBreak: false,
                                             mat: null, low: null, bumps: null })]
    ];
    cases.forEach(function (c) {
        var a = attackTakes(c[1]), b = planTakes(c[1]);
        ok(a === b,
           'the two paths disagree about ' + c[0] + ': bestAttack ' +
           (a ? 'plays' : 'refuses') + ' it and bestPlan ' + (b ? 'plays' : 'refuses') +
           ' it. Every shape rule here has been written twice and every one has ' +
           'drifted -- this is the drift');
    });

    // AND THE SHARED PREDICATE IS WHAT BOTH READ, so a rule added to it lands on
    // both at once rather than on whichever caller the author was looking at.
    ok(BitBot.ruinsShapeOf(o({ opensHole: true })) === true &&
       BitBot.ruinsShapeOf(o({ closesBreak: true })) === true &&
       BitBot.ruinsShapeOf(o({})) === false,
       'the shared shape predicate does not answer for both rules, so the two ' +
       'paths are reading separate copies again');
}());

// ---------- 20. a clear is asked what it did to the way out
//
// `dig` counts the cells that would finish a line against the garbage -- the
// board's way out from under the slab, measured one cell at a time. bitoptions
// has priced it at deadline/W for a while and asked it only of routes that CLEAR
// NOTHING, so every combo and every chain was ranked without anyone asking
// whether it spent the panels that were the way out.
//
// This is the slope `breakReady` does not have. On the board it was written from
// 7,863 of 8,653 landings could not break at all: the flag said "sealed" on
// nearly everything and never said which way was out.
(function () {
    var engine = P, FT = { FLASH: 28, FACE: 10, POP: 7 }, WV = {};
    BF.keys().forEach(function (k) { WV[k] = 0; });
    function o(over) {
        // matNow BELOW THE WORKING FLOOR: buried and short is the case this term
        // is for, and the only one it is allowed to speak in. `mat` stays above
        // it so bestPlan's starving refusal is not what decides these.
        var x = { kind: 'combo', swaps: [[1, 1]], frames: 10, duration: 10, chain: 0,
                  total: 4, size: 4, garbage: 0, tall: 5, bumps: 2, mat: 5, low: 2,
                  matNow: 2, levels: true, opensHole: false, breakReady: false,
                  closesBreak: false, digGain: 0 };
        for (var k in over) x[k] = over[k];
        return x;
    }
    // BOTH land on a board that cannot break, which is the normal state of a
    // buried board -- so `breakReady` cannot separate them and only the slope can.
    // The bigger clear takes the board FURTHER from a break.
    var awayA = o({ total: 6, size: 6, digGain: -4 });
    var towardA = o({ total: 4, size: 4, digGain: +4, swaps: [[1, 3]] });
    var pickA = BitBot.bestAttackOf({ now: [awayA, towardA], next: [] },
                                    WV, engine, 600, FT, 18.7);
    ok(pickA && pickA.option === towardA,
       'attack: took the bigger clear that spends the way out from under the slab. ' +
       'Both land unable to break, so the flag cannot tell them apart and the ' +
       'gradient is the only thing that can');

    var awayP = o({ total: 6, size: 6, digGain: -4 });
    var towardP = o({ total: 4, size: 4, digGain: +4, swaps: [[1, 3]] });
    var pickP = BitBot.bestPlanOf({ now: [awayP, towardP], next: [] },
                                  0, 600, engine, false, FPROW, FT, 5);
    ok(pickP && pickP.option === towardP,
       'survival plan: took the route that spends the way out from under the slab. ' +
       'This is the path that picks most of the moves and it was never asked');

    // AND IT IS A PRICE, NOT A REFUSAL: a big enough clear still outranks a small
    // gain, because a dig cell is worth a FRACTION of a break and not a break.
    var bigA = o({ total: 40, size: 6, digGain: -1 });
    var tinyA = o({ total: 3, size: 3, digGain: +1, swaps: [[1, 3]] });
    var pickBig = BitBot.bestAttackOf({ now: [bigA, tinyA], next: [] },
                                      WV, engine, 600, FT, 18.7);
    ok(pickBig && pickBig.option === bigA,
       'attack: a one-cell loss of dig outranked a clear more than ten times the ' +
       'size, so this is a refusal wearing a price and the bot will not cash');

    // AND THE LOSS IS NOT CHARGED TWICE. Clearing removes panels, so nearly every
    // clear drops `dig` -- and those panels are already paid for, as cells sent
    // here and as o.total * perPanel in the plan. Charging again for the reach
    // they carried is the same panels twice, and it lands as a blanket tax on
    // cashing while buried: seed 103 STARTER sat on two rows of material under
    // thirty-three cells of garbage playing setups, dead at 2,319.
    //
    // Two options identical but for the reach they spend, so only a charge for
    // the loss can separate them. Equal rates go to the first seen.
    var spendsA = o({ total: 6, size: 6, digGain: -5 });
    var evenA = o({ total: 6, size: 6, digGain: 0, swaps: [[1, 3]] });
    var pickSpend = BitBot.bestAttackOf({ now: [spendsA, evenA], next: [] },
                                        WV, engine, 600, FT, 18.7);
    ok(pickSpend && pickSpend.option === spendsA,
       'attack: a clear was ranked below an identical one because it spent reach. ' +
       'Those panels are already paid for as cells sent -- this charges for them ' +
       'twice and taxes cashing on exactly the boards that need it');
    var spendsP = o({ total: 6, size: 6, digGain: -5 });
    var evenP = o({ total: 6, size: 6, digGain: 0, swaps: [[1, 3]] });
    var pickSpendP = BitBot.bestPlanOf({ now: [spendsP, evenP], next: [] },
                                       0, 600, engine, false, FPROW, FT, 5);
    ok(pickSpendP && pickSpendP.option === spendsP,
       'survival plan: a plan was ranked below an identical one because it spent ' +
       'reach, which o.total * perPanel has already paid for');

    // AND IT IS SILENT WHILE THE BOARD STILL HAS MATERIAL. `digging` is set by
    // ANY garbage cell, so priced on that alone this spoke on healthy boards
    // carrying one row of it -- and that is every board it killed: STARTER
    // against ZERO on both seeds and rand2 on 101, all three alive without it,
    // all three dead with it. The board it helps carried two rows of material
    // under thirty-three cells of garbage.
    //
    // Reaching the slab is the goal when there is nothing else left to play for.
    // With material in hand the ordinary ranking decides, which is the file's own
    // rule for the dig goal: widen the search, do not move the preference.
    var richAway = o({ total: 6, size: 6, digGain: -4, matNow: 9 });
    var richToward = o({ total: 4, size: 4, digGain: +4, matNow: 9, swaps: [[1, 3]] });
    var pickRich = BitBot.bestAttackOf({ now: [richAway, richToward], next: [] },
                                       WV, engine, 600, FT, 18.7);
    ok(pickRich && pickRich.option === richAway,
       'attack: the way out outranked a clear half again as big on a board holding ' +
       'nine rows of material. This term is for a board with nothing else left to ' +
       'play for, and priced on any garbage at all it killed three pairings');
    var pickRichP = BitBot.bestPlanOf({ now: [richAway, richToward], next: [] },
                                      0, 600, engine, false, FPROW, FT, 5);
    ok(pickRichP && pickRichP.option === richAway,
       'survival plan: the way out outranked a bigger clear on a board holding ' +
       'nine rows of material');

    // AND OFF THE SLAB IT IS SILENT: with no garbage there is nothing to dig
    // toward, digGain is zero everywhere, and the ranking is untouched.
    var cleanBig = o({ total: 8, size: 8, digGain: 0 });
    var cleanSmall = o({ total: 4, size: 4, digGain: 0, swaps: [[1, 3]] });
    var pickClean = BitBot.bestAttackOf({ now: [cleanBig, cleanSmall], next: [] },
                                        WV, engine, 600, FT, 18.7);
    ok(pickClean && pickClean.option === cleanBig,
       'attack: the bigger clear lost on a board with no garbage on it, where ' +
       'every digGain is zero and this term may not change anything');
}());

// ----- 21. within a working floor of the ceiling, keep a break alive
//
// H - WORKING_ROWS is eight of twelve. Above it there is no room left to build a
// way out and the only move that hands ceiling back is a break: a garbage cell
// comes off the board one way and a panel comes off many. Below that line the
// ordinary ranking is right, which is why this is gated -- refused everywhere,
// `breakReady === false` cost three deaths among STARTER and ZERO in thirteen
// pairings by flagging nearly every option on a healthy buried board.
(function () {
    var engine = P, FT = { FLASH: 28, FACE: 10, POP: 7 }, WV = {};
    BF.keys().forEach(function (k) { WV[k] = 0; });
    var HIGH = 12 - BitBot.WORKING_ROWS;                 // the line, from the constants
    function o(over) {
        var x = { kind: 'combo', swaps: [[1, 1]], frames: 10, duration: 10, chain: 0,
                  total: 4, size: 4, garbage: 0, tall: HIGH, bumps: 2, mat: 5, low: 2,
                  matNow: 5, levels: true, opensHole: false, breakReady: true,
                  closesBreak: false, digGain: 0 };
        for (var k in over) x[k] = over[k];
        return x;
    }
    // AT the line: the bigger clear leaves the board unable to break and loses.
    var deadA = o({ total: 8, size: 8, breakReady: false });
    var liveA = o({ total: 4, size: 4, breakReady: true, swaps: [[1, 3]] });
    ok(BitBot.bestAttackOf({ now: [deadA, liveA], next: [] }, WV, engine, 600, FT, 18.7)
         .option === liveA,
       'attack: within a working floor of the ceiling it took the bigger clear that ' +
       'leaves the board unable to break, and a break is the only move that hands ' +
       'ceiling back up there');
    ok(BitBot.bestPlanOf({ now: [deadA, liveA], next: [] }, 0, 600, engine, false, FPROW, FT, 5)
         .option === liveA,
       'survival plan: within a working floor of the ceiling it took the route that ' +
       'leaves the board unable to break');

    // ONE ROW BELOW THE LINE it must not speak: there is still room to build, and
    // this rule refused everywhere is the one that cost three STARTER/ZERO deaths.
    var lowDead = o({ total: 8, size: 8, breakReady: false, tall: HIGH - 1 });
    var lowLive = o({ total: 4, size: 4, breakReady: true, tall: HIGH - 1, swaps: [[1, 3]] });
    ok(BitBot.bestAttackOf({ now: [lowDead, lowLive], next: [] }, WV, engine, 600, FT, 18.7)
         .option === lowDead,
       'attack: the break rule fired a row BELOW the working floor, where there is ' +
       'still room to build and the ordinary ranking is right');
    ok(BitBot.bestPlanOf({ now: [lowDead, lowLive], next: [] }, 0, 600, engine, false, FPROW, FT, 5)
         .option === lowDead,
       'survival plan: the break rule fired a row below the working floor');

    // AND IT STANDS ASIDE when nothing up there keeps a break: it was going
    // whatever was played, so the better move is the better move.
    var bothDead = o({ total: 8, size: 8, breakReady: false });
    var bothDead2 = o({ total: 4, size: 4, breakReady: false, swaps: [[1, 3]] });
    ok(BitBot.bestAttackOf({ now: [bothDead, bothDead2], next: [] }, WV, engine, 600, FT, 18.7)
         .option === bothDead,
       'attack: with nothing keeping a break it took the smaller clear, so the ' +
       'narrowing empties the list instead of standing aside');

    // AND A BREAK IS NOT NARROWED OUT BY IT, nor a clean board: both carry null.
    var brk = o({ total: 3, size: 3, garbage: 4, breaks: true, breakReady: null,
                  mat: null, low: null, bumps: null, swaps: [[1, 5]] });
    var other = o({ total: 4, size: 4, frames: 300, duration: 300, swaps: [[1, 3]] });
    ok(BitBot.bestAttackOf({ now: [brk, other], next: [] }, WV, engine, 600, FT, 18.7)
         .option === brk,
       'attack: a break was narrowed out by a rule about keeping breaks alive');
}());

// ------ 22. the search is handed the price of a freeze, not a boolean
//
// The flatten used to choose its destination by `hasFireable` -- can the board
// it lands on fire at all. That is a boolean where the answer is a number: a
// bare three holds the floor for 0 frames, a combo 4 for 60 topped out, a chain
// 4 for 94, against a framesPerRow of 120. Ranking landings by the boolean
// scores those three the same.
(function () {
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var bot = new BitBot(st, { allowRaise: true });
    var info = bot.info(bot._snapshot());
    var t = bot.timing(info, 600);
    ok(typeof t.stopPrice === 'function',
       'the search is handed no way to price a landing, so it is still choosing ' +
       'its destination by whether one exists');

    // A BARE THREE BUYS NOTHING. It clears, and the engine's table pays zero for
    // it -- which is exactly the case a boolean gets wrong.
    ok(t.stopPrice({ chain: 1, total: 3 }) === 0,
       'a bare three priced at ' + t.stopPrice({ chain: 1, total: 3 }) + ' frames. ' +
       'The engine pays nothing for it and telling that apart from a chain is the ' +
       'whole point of the number');
    // AND A CHAIN BUYS A LOT. Not a threshold -- the engine's own table, whose
    // chainConstant is 56 before any coefficient.
    ok(t.stopPrice({ chain: 4, total: 12 }) >= 56,
       'a 4-chain priced at ' + t.stopPrice({ chain: 4, total: 12 }) + ' frames, ' +
       'under the engine chainConstant of 56');
    ok(t.stopPrice({ chain: 4, total: 12 }) > t.stopPrice({ chain: 2, total: 6 }),
       'a 4-chain is not priced above a 2-chain, so the number does not rank the ' +
       'thing it exists to rank');

    // AND IT FOLLOWS THE BOARD: topped out pays more, which is when it matters.
    var top = Object.create(info); top.toppedOut = true;
    var tt = bot.timing(top, 600);
    ok(tt.stopPrice({ chain: 4, total: 12 }) > t.stopPrice({ chain: 4, total: 12 }),
       'a chain is priced the same topped out as not, so the danger table is not ' +
       'being read and the freeze is undervalued exactly when it is survival');
}());

// ---- 23. with nothing to fire, dropping the stack and reaching the slab count
//
// The slab rests on the TALLEST column, so only the tallest touches it: one
// panel of height on one column puts the garbage out of reach of the other five.
// The board that died at 2,261 was FLAT -- spread 3, bumpiness 3 -- with c1 a
// single panel above the rest and 40 cells of garbage nobody could reach.
//
// This branch ranked `-bumpiness * 10000 + matchWays * 100`, a lexicographic
// sort on flatness in which one step of bumpiness outweighs a hundred ways and a
// real board carries twenty. Neither dropping the stack nor reaching the slab
// was in it.
(function () {
    // A BURIED BOARD, because that is the case this exists for -- and the case a
    // clean fixture cannot fail. Measuring the tallest CELL instead of the
    // tallest material column reads the slab at r12, which no panel move changes,
    // so the term is zero exactly where it is needed. On a clean board the two
    // numbers agree and the bug is invisible.
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var r, c;
    for (r = 1; r <= st.height; r++)
        for (c = 1; c <= W; c++) { st.panels[r][c].color = 0; st.panels[r][c].isGarbage = false; }
    // cols 5,2,3,4,4,4 under five rows of garbage: the shape that died at 2,261,
    // flat by every measure and sealed because c1 stands one panel proud.
    var cols = [[3, 3, 5, 1, 4], [1, 5], [2, 3, 4], [1, 4, 1, 3], [1, 5, 2, 3], [3, 4, 4, 6]];
    for (c = 1; c <= W; c++)
        for (r = 1; r <= cols[c - 1].length; r++) st.panels[r][c].color = cols[c - 1][r - 1];
    for (r = 6; r <= 10; r++)
        for (c = 1; c <= W; c++) { st.panels[r][c].color = 8; st.panels[r][c].isGarbage = true; }
    var bot = new BitBot(st, { allowRaise: true });
    var board = bot._snapshot();
    var info = bot.info(board);
    var base = bit.maskState(board.grid, board.blocks, W, board.height);
    ok(bitoptions.shapeOf(base).high === 5,
       'idle: the fixture is not the shape it is meant to be -- tallest material ' +
       'column reads ' + bitoptions.shapeOf(base).high + ', wanted 5');

    function candOf(masks) { return { kind: 'swap', swap: [1, 1], masks: masks, moveFrames: 0 }; }
    ok(typeof bot.idleScore === 'function', 'no idle ranking to check');

    // DROPPING THE STACK IS WORTH A ROW OF RISE. The slab rests on the tallest
    // column, so taking c1 down brings the garbage onto the rest of the board.
    var tallB = bit.copyState(base), shortB = bit.copyState(base);
    var topRow = 5, topCol = 1, bitv = 1 << (topRow - 1);
    shortB.occ[topCol] &= ~bitv;
    for (var a = 1; a <= shortB.N; a++) shortB.colour[a * (W + 2) + topCol] &= ~bitv;
    ok(bitoptions.shapeOf(shortB).high === 4,
       'idle: the shortened board still reads tallest ' + bitoptions.shapeOf(shortB).high);
    var tallScore = bot.idleScore(candOf(tallB), base, info);
    var shortScore = bot.idleScore(candOf(shortB), base, info);
    ok(shortScore > tallScore,
       'idle: taking the top panel off the tallest column scored no better than ' +
       'leaving it. The slab rests on that column -- one panel there puts the ' +
       'garbage out of reach of every other column on the board');
    ok(shortScore - tallScore >= info.framesPerRow * 0.5,
       'idle: dropping the stack was worth only ' + (shortScore - tallScore).toFixed(0) +
       ' frames against a row of rise at ' + info.framesPerRow + '. Measured on the ' +
       'tallest CELL this reads zero on a buried board, because the slab is the ' +
       'tallest cell and no panel move touches it');

    // AND REACHING THE SLAB COUNTS. A surface that can put three panels against
    // the garbage is worth the break it unlocks, and slabReadyFast is the
    // question. Stubbed, because two boards differing ONLY in slab-readiness
    // cannot be built by hand -- and a term nothing separates is a term nothing
    // checks.
    var realSlab = bitoptions.slabReadyFast;
    var yes, no;
    try {
        bitoptions.slabReadyFast = function () { return true; };
        yes = bot.idleScore(candOf(base), base, info);
        bitoptions.slabReadyFast = function () { return false; };
        no = bot.idleScore(candOf(base), base, info);
    } finally { bitoptions.slabReadyFast = realSlab; }
    ok(yes > no,
       'idle: a board that can put three against the slab scored no higher than ' +
       'one that cannot. That question already existed and reached one place -- ' +
       'the flatten\'s third winner -- and never the branch that plays when the ' +
       'board is dying');
    ok(yes - no >= info.framesPerRow * 0.5,
       'idle: reaching the slab was worth ' + (yes - no).toFixed(0) + ' frames ' +
       'against a row of rise at ' + info.framesPerRow);

    // AND FLATNESS STILL COUNTS, JUST NOT AT A HUNDRED TO ONE. Made lumpier by
    // taking a panel off a SHORT column, so the tallest is untouched and only
    // the roughness term can separate the two.
    var lumpy = bit.copyState(base);
    var lb = 1 << (2 - 1);                       // c2 tops at 2
    lumpy.occ[2] &= ~lb;
    for (var a2 = 1; a2 <= lumpy.N; a2++) lumpy.colour[a2 * (W + 2) + 2] &= ~lb;
    ok(bitoptions.shapeOf(lumpy).high === bitoptions.shapeOf(base).high,
       'idle: the lumpy fixture changed the tallest column, so the height term ' +
       'is what separates them and this checks nothing');
    var flatScore = bot.idleScore(candOf(base), base, info);
    var lumpyScore = bot.idleScore(candOf(lumpy), base, info);
    ok(flatScore > lumpyScore,
       'idle: a lumpier board scored at or above the smoother one');
    ok((flatScore - lumpyScore) < info.framesPerRow * 10,
       'idle: roughness is worth ' + (flatScore - lumpyScore).toFixed(0) + ' frames ' +
       'against a row of rise at ' + info.framesPerRow + '. At that ratio it is a ' +
       'lexicographic sort again and nothing else in the ranking can ever matter');
}());

// ------ 24. the two things that hold a full board, and what each is worth
//
// The floor is held for every frame panels are in motion -- the resolve -- and
// the engine AWARDS stop time on top, from its table, for combos over three and
// for chains. Two mechanics that add, and deadly()'s full-board branch counts
// both.
//
// The numbers are pinned here because the reasoning everywhere else rests on
// them: a break clearing exactly three panels earns NO award, and holds the
// floor through its resolve alone -- which is why counting only the award would
// price the one move that stops the board at nothing.
(function () {
    ok(BF.stopTimeOf(P, false, 3, 0, true) === 0,
       'a three-panel combo earns ' + BF.stopTimeOf(P, false, 3, 0, true) + ' awarded ' +
       'frames, not 0. The engine pays for combos over three and for chains, and a ' +
       'bare three is neither -- every rule that treats a three as payless reads this');
    ok(BF.stopTimeOf(P, false, 4, 0, true) > 0 && BF.stopTimeOf(P, true, 0, 2, true) > 0,
       'a combo 4 or a 2-chain earns nothing either, so the award table is not ' +
       'being read at all');
    // The resolve holds regardless, and scales with the garbage it pops.
    ok(BF.resolveFramesOf(P, 3, 0) > 0,
       'a three holds the floor for ' + BF.resolveFramesOf(P, 3, 0) + ' frames while ' +
       'it resolves. If that is zero, nothing holds a full board and every clear is fatal');
    ok(BF.resolveFramesOf(P, 3, 24) > BF.resolveFramesOf(P, 3, 0) * 3,
       'popping a four-row slab holds ' + BF.resolveFramesOf(P, 3, 24) + ' frames ' +
       'against ' + BF.resolveFramesOf(P, 3, 0) + ' for the same three panels alone. ' +
       'The hold scales with the garbage on screen and that is what makes a break ' +
       'worth more than the clear inside it');
}());

// ---- 25. arrange for the slab that is coming, while there is still room
//
// slabReadyFast asks whether three panels can be put against the row the next
// slab will rest on. It reached the flatten's third winner and nothing else, so
// nothing asked it while the board was healthy and firing -- which is the only
// time there is room to arrange for it.
//
// Measured on the duel this was written from: 48 decisions with garbage
// INCOMING, and the board was ready for it on ONE of them.
(function () {
    var engine = P, FT = { FLASH: 28, FACE: 10, POP: 7 }, WV = {};
    BF.keys().forEach(function (k) { WV[k] = 0; });
    function o(over) {
        var x = { kind: 'combo', swaps: [[1, 1]], frames: 10, duration: 10, chain: 0,
                  total: 4, size: 4, garbage: 0, tall: 5, bumps: 2, mat: 5, low: 2,
                  matNow: 5, levels: true, opensHole: false, breakReady: true,
                  closesBreak: false, digGain: 0, slabWorth: 0 };
        for (var k in over) x[k] = over[k];
        return x;
    }
    // What bitoptions puts on an option: ONE PANEL OF LIFE, framesPerRow / W.
    // Not a row -- a row converts to 6.4 cells here, which is a whole combo, for
    // a slab that has not landed yet.
    var READY = 120 / W;

    // TWO EQUAL CLEARS, one landing able to answer the slab and one not. Equal
    // on purpose: a panel of life is a fraction, so it decides between equals and
    // does not overturn a better move -- which is what the next case checks.
    var blindA = o({ total: 5, size: 5, slabWorth: 0 });
    var readyA = o({ total: 5, size: 5, slabWorth: READY, swaps: [[1, 3]] });
    ok(BitBot.bestAttackOf({ now: [blindA, readyA], next: [] }, WV, engine, 600, FT, 18.7)
         .option === readyA,
       'attack: took the bigger clear that leaves the board unable to answer the ' +
       'slab that is coming. Arranging for it has to happen while there is still ' +
       'room, and that is this path');
    ok(BitBot.bestPlanOf({ now: [blindA, readyA], next: [] }, 0, 600, engine, false, FPROW, FT, 5)
         .option === readyA,
       'survival plan: took the route that leaves the board unable to answer the ' +
       'slab that is coming');

    // AND IT IS A PRICE, NOT A REFUSAL: a big enough clear still outranks
    // readiness, because a slab that has not landed is worth less than cells now.
    var bigA = o({ total: 40, size: 7, slabWorth: 0 });
    var tinyReady = o({ total: 3, size: 3, slabWorth: READY, swaps: [[1, 3]] });
    ok(BitBot.bestAttackOf({ now: [bigA, tinyReady], next: [] }, WV, engine, 600, FT, 18.7)
         .option === bigA,
       'attack: readiness for a slab that has not landed outranked a clear ten ' +
       'times the size, so this is a refusal wearing a price');

    // AND IT IS SILENT WITH NOTHING TO BE READY FOR. On a clean board with no
    // queue, slabWorth is zero on every option and the ranking is untouched.
    var cleanBig = o({ total: 8, size: 8, slabWorth: 0 });
    var cleanSmall = o({ total: 4, size: 4, slabWorth: 0, swaps: [[1, 3]] });
    ok(BitBot.bestAttackOf({ now: [cleanBig, cleanSmall], next: [] }, WV, engine, 600, FT, 18.7)
         .option === cleanBig,
       'attack: the bigger clear lost on a board with no slab on it and none ' +
       'queued, where this term may not change anything');
}());

console.log('survival: 120 invariants checked without playing a game');
if (fails) { console.log(fails + ' FAILURES'); process.exit(1); }
console.log('survival: OK');
