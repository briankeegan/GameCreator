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

console.log('survival: 7 invariants checked without playing a game');
if (fails) { console.log(fails + ' FAILURES'); process.exit(1); }
console.log('survival: OK');
