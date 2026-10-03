#!/usr/bin/env node
// CAN THE BOT SOLVE THE GAME'S OWN CHAIN PUZZLES?
//
//   node puzzles.bench.js [GC_WEIGHTS=snap.json]   (GC_DENSITY overrides)
//
// WHY THIS EXISTS. Every verdict so far has cost five hours and three seeds
// and still landed inside a 382-point noise floor. Panel Attack ships 235
// hand-authored puzzles, 84 of them typed "chain" — boards where the game
// itself asserts a chain is there to be found. That is ground truth, and
// asking "how many of them does the bot fire?" is a pass/fail count that
// runs in seconds with no noise floor at all.
//
// THE BOARDS ARE THE SERVER'S: PAEngine.puzzle sets each stack up as
// Puzzle.lua does, and every swap is played on pa-engine.js until nothing
// moves. 8 is SHOCK and 9 COLORLESS there, as in the game; puzzles with
// [====] garbage blocks are skipped rather than half-understood. The bot
// scores the board each swap settles to, read as it reads any board
// (PanelCpu.snapshot).
var path = require('path');
var fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js'));
var snapshot = globalThis.PanelCpu.snapshot;
var evaluator = require('./evaluator.js');
var inputMod = require('./input.js');
var registry = require('./registry.js');

var PANEL_GAME = process.env.GC_PANEL_GAME || '/home/user/panel-game';
var FILE = path.join(PANEL_GAME, 'client/assets/default_data/puzzles/Puzzles.json');

// A WEIGHT SET IS ONLY A BOT WHEN PAIRED WITH THE SWITCHES IT WAS FOUND
// UNDER, so the density flag comes from wherever the weights came from
// rather than from a flag somebody has to remember to type alongside
// GC_WEIGHTS. See switches.js for the four separate times that went wrong.
// This bench asks a one-move question, so depth and beam do not apply here.
var switches = require('./switches.js');
var loaded = switches.load();
var weights = loaded.weights;
var DENSITY = loaded.switches.density;
console.log(switches.describe(loaded));

function puzzles() {
    var j = JSON.parse(fs.readFileSync(FILE, 'utf8')), out = [];
    (function walk(node, trail) {
        (node['Puzzle Sets'] || []).forEach(function (s) {
            walk(s, trail.concat(s['Set Name'] || '?'));
        });
        (node['Puzzles'] || []).forEach(function (p) { out.push({ set: trail.join('/'), p: p }); });
    })(j, []);
    return out;
}

function boardFrom(stack) {
    return /[^0-9\s]/.test(String(stack)) ? null : PA.puzzle(stack);   // garbage blocks: not handled
}
// Swap m (null: hold) played on a copy until nothing moves: the board it
// settles to, as the bot reads it, and what it earned on the way.
function play(board, m) {
    var t = board.copy();
    if (m) { t.curRow = m[0]; t.curCol = m[1]; t.tryQueueSwap(m[0], m[1]); }
    var r = t.settle();
    return { board: snapshot.call({ stack: t }), res: { chainLength: r.chain, comboSizes: r.combos, garbage: r.garbage } };
}

// The bot's choice, without needing a live Stack: score the board each legal
// swap leaves, exactly as puyocpu._score does, minus the two terms that need
// a running game (garbage cleared off the live board, and cursor travel).
// Both are zero on a puzzle board, so this is the same decision.
function choose(board) {
    var legal = board.legalSwaps(), best = null;
    // HOLDING IS A CANDIDATE, because it is one in the real bot. Leaving it
    // out asks "given you must move, do you pick the chain?" — a different,
    // easier question than the one the game asks. The shipped bot answered
    // the first at 74% and the second by declining three chains in four.
    var moves = process.env.GC_NO_HOLD ? legal : [null].concat(legal);
    for (var i = 0; i < moves.length; i++) {
        var got = play(board, moves[i]);
        var input = inputMod.normalize({
            board: got.board,
            earned: { chainLength: got.res.chainLength, comboSizes: got.res.comboSizes,
                      garbageSent: got.res.garbage, garbageCleared: 0 }
        });
        var s = evaluator.evaluate(input, weights, { density: DENSITY }).score;
        if (!best || s > best.score) best = { score: s, move: moves[i], res: got.res, held: !moves[i] };
    }
    return best;
}

var all = puzzles();
var chains = all.filter(function (x) { return x.p['Puzzle Type'] === 'chain'; });
var usable = 0, solved = 0, skipped = 0, held = 0, byLinks = {}, missed = [];

chains.forEach(function (x) {
    var board = boardFrom(x.p.Stack);
    if (!board) { skipped++; return; }
    // A puzzle only tests the bot if a chain is genuinely reachable in one
    // swap from this board — otherwise a miss says nothing about the bot.
    var legal = board.legalSwaps(), reachable = 0;
    for (var i = 0; i < legal.length; i++) {
        var r = play(board, legal[i]).res;
        if (r.chainLength >= 2 && r.chainLength > reachable) reachable = r.chainLength;
    }
    if (!reachable) { skipped++; return; }
    usable++;
    var pick = choose(board);
    var got = pick && pick.res ? pick.res.chainLength : 0;
    if (pick && pick.held) held++;
    byLinks[reachable] = byLinks[reachable] || { n: 0, hit: 0 };
    byLinks[reachable].n++;
    if (got >= 2) { solved++; byLinks[reachable].hit++; }
    else missed.push({ set: x.set.split('/').pop(), best: reachable });
});

console.log('PANEL ATTACK CHAIN PUZZLES — the game\'s own ground truth\n');
console.log('  typed "chain" in Puzzles.json :', chains.length);
console.log('  usable (a chain is reachable in one swap, no garbage blocks):', usable);
console.log('  skipped :', skipped);
console.log('\n  SOLVED (the bot\'s chosen move fires a chain):', solved, '/', usable,
            usable ? '(' + (solved / usable * 100).toFixed(0) + '%)' : '');
console.log('  of the misses, it chose to HOLD:', held);
console.log('\n  by how deep a chain was available:');
Object.keys(byLinks).sort().forEach(function (k) {
    var v = byLinks[k];
    console.log('    ' + k + ' links   ' + String(v.hit).padStart(3) + ' / ' + String(v.n).padStart(3));
});
if (missed.length) {
    console.log('\n  first few misses:',
        missed.slice(0, 6).map(function (m) { return m.set + '(' + m.best + ')'; }).join(', '));
}
