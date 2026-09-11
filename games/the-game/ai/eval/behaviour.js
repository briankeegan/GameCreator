#!/usr/bin/env node
// WHAT DOES THE BOT ACTUALLY DO? — a behaviour report, not a score.
//
// THE GAP THIS EXISTS FOR. Every number in this directory is a FITNESS:
// frames survived, garbage sent, a held-out total. Not one of them can tell
// you that the bot flattens the surface and then stands still, which is what
// the owner saw the first time they played the shipped Nightmare bot — and
// which was invisible in a held-out 3397 that beat the previous AI by 298%.
// A score says how well it played. This says WHAT it played.
//
// What it measures, per decision:
//   swap                 it moved
//   hold FORCED          it held because legalSwaps() offered nothing
//   hold CHOSEN          it held with real swaps on the table
// and, for the chosen holds, the per-feature decomposition of the margin
// holding won by — hold's score minus the best swap's, term by term. That
// decomposition is the point: it names the feature that is deciding, rather
// than leaving somebody to guess from the weight list.
//
// THE FIRST RUN, on the shipped weights, over three level-10 endless games:
//
//   decisions 570 | swap 271 | hold FORCED 0 | hold CHOSEN 299
//   mean margin holding won by: 18.9
//     travelCost      20.7     <- the entire margin
//     colourVariance  -4.8
//     everything else under 1.0
//
// Zero forced holds. It held 52% of its decisions with swaps available, and
// travelCost paid for all of it: a hold walks nowhere so it costs nothing,
// while every swap pays for the cursor's journey. The board terms differ by
// UNDER TWO POINTS between holding and the best swap, because one swap moves
// two panels and barely changes a board — so a correct, small travel cost
// swamps the board signal entirely and the bot optimises its own walking
// distance instead of the stack. That is the difference from Puyo nobody had
// measured: there, every move drops a piece and the candidate boards are
// genuinely different; here they are nearly identical, and whatever term is
// NOT nearly identical decides the game.
//
//   node behaviour.js [scenario] [seeds...]     (default: endless 1 2 3)
var path = require('path');
var bench = require('./bench.js');
var PuyoCpu = require('./puyocpu.js');
var evaluator = require('./evaluator.js');
require(path.join(__dirname, '..', 'trained-weights.js'));

var root = typeof window !== 'undefined' ? window : globalThis;
// WHICH WEIGHTS. Shipped by default; GC_WEIGHTS=<snapshot.json> points it at
// a run's output, which is the whole reason this is a tool and not a probe:
// "did that search produce a bot that actually plays?" is one command.
var weights = root.PanelEval.trained.weights, source = 'shipped';
if (process.env.GC_WEIGHTS) {
    var snap = JSON.parse(require('fs').readFileSync(process.env.GC_WEIGHTS, 'utf8'));
    weights = snap.weights || (snap.elite && snap.elite.weights);
    if (!weights) throw new Error(process.env.GC_WEIGHTS + ' has no weights in it');
    source = process.env.GC_WEIGHTS + (snap.rise ? '  [rise ON]' : '  [rise off]') +
             (snap.depth > 1 ? '  [depth ' + snap.depth + ']' : '');
}
var RISE = process.env.GC_RISE === '1' || process.env.GC_RISE === 'true';
var argv = process.argv.slice(2);
var scenario = argv[0] || 'endless';
var seeds = argv.length > 1 ? argv.slice(1).map(Number) : [1, 2, 3];

var forced = 0, chosen = 0, swapped = 0, gapSum = 0, contrib = {};

// DID IT BREAK ANYTHING? Holds say what it refused to do; this says what it
// actually did. The engine pays for a combo of 4+ (20 points) and for chain
// links (50 at x2, 300 at x5, 1100 at x10) and pays NOTHING AT ALL for a
// bare 3 — which is 54 of the shipped bot's 67 matches. So a bot can look
// busy, clear panels all game, and earn nothing: flattening with extra
// steps. These four lines are the difference between a bot that tidies and
// a bot that plays.
var matches = 0, sending = 0, chainLinks = 0, bySize = {}, deepest = 0;
var PanelEngine = root.PanelEngine;
var origDrain = PanelEngine.Stack.prototype.drainEvents;
PanelEngine.Stack.prototype.drainEvents = function () {
    var evs = origDrain.call(this);
    for (var i = 0; i < evs.length; i++) {
        var e = evs[i];
        if (e.type !== 'match') continue;
        matches++;
        bySize[e.size] = (bySize[e.size] || 0) + 1;
        if (e.chain) chainLinks++;
        if (e.chainCounter > deepest) deepest = e.chainCounter;
        if (e.chain || e.size > 3) sending++;
    }
    return evs;
};

// evaluate() is the only place the per-feature terms exist, so borrow them
// on the way past rather than recomputing a second, drifting copy.
var lastParts = null;
var origEval = evaluator.evaluate;
evaluator.evaluate = function (input, w) {
    var r = origEval.call(this, input, w);
    lastParts = r.parts || r.terms || null;
    return r;
};

var origDecide = PuyoCpu.prototype._decide;
PuyoCpu.prototype._decide = function () {
    var board = this._snapshot();
    var legal = board.legalSwaps();
    var holdBoard = board.clone();
    var holdScore = this._score(holdBoard, holdBoard.resolve(), null);
    var holdParts = lastParts;
    var bestScore = -Infinity, bestParts = null;
    for (var i = 0; i < legal.length; i++) {
        var t = board.clone();
        t.swap(legal[i][0], legal[i][1]);
        var s = this._score(t, t.resolve(), legal[i]);
        if (s > bestScore) { bestScore = s; bestParts = lastParts; }
    }
    var d = origDecide.call(this);
    if (d.kind === 'swap') { swapped++; return d; }
    if (!legal.length) { forced++; return d; }
    chosen++;
    gapSum += holdScore - bestScore;
    if (holdParts && bestParts) {
        Object.keys(holdParts).forEach(function (k) {
            contrib[k] = (contrib[k] || 0) + (holdParts[k] - (bestParts[k] || 0));
        });
    }
    return d;
};

console.log('weights:', source, '| rise', RISE ? 'ON' : 'off', '\n');
var totalFrames = 0;
seeds.forEach(function (seed) {
    var r = bench.run(weights, seed, { brain: 'puyo', scenario: scenario,
                                       checkTiming: false, rise: RISE });
    totalFrames += r.frames;
    console.log(scenario, 'seed', seed, '| frames', r.frames, 'sent', r.sent,
                'score', r.score);
});

console.log('\nWHAT IT BROKE');
console.log('  matches', matches,
            '| ones that SEND or SCORE anything:', sending,
            matches ? '(' + (sending / matches * 100).toFixed(1) + '%)' : '',
            '| chain links', chainLinks, '| deepest chain', deepest);
console.log('  by combo size:', JSON.stringify(bySize));
var minutes = totalFrames / 60 / 60;
console.log('  per minute of play:', (matches / minutes).toFixed(1), 'matches,',
            (sending / minutes).toFixed(1), 'that pay');

var total = forced + chosen + swapped;
console.log('\ndecisions', total, '| swap', swapped,
            '| hold FORCED (nothing legal)', forced,
            '| hold CHOSEN over real swaps', chosen);
if (!chosen) { console.log('\nno elective holds — the bot is always moving'); process.exit(0); }
console.log('mean margin holding won by:', (gapSum / chosen).toFixed(1));
console.log('\nwhich features paid for holding (mean hold-minus-best-swap, per elective hold):');
Object.keys(contrib).sort(function (a, b) { return contrib[b] - contrib[a]; })
    .forEach(function (k) {
        var v = contrib[k] / chosen;
        if (Math.abs(v) < 0.1) return;
        console.log('  ' + k.padEnd(18), v.toFixed(1));
    });
