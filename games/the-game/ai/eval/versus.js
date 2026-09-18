// TWO BOTS, GARBAGE CROSSING, ONE BIT OUT: WHO DIED.
//
// meatfighter's Puyo AI — the bot this evaluator is modelled on — never
// trained against a score. Its trainer holds two playfields, alternates a
// piece each, drops the excess of any clear over 4 into the OTHER board, and
// keeps whoever did not top out:
//
//     if (!searchChain.search(...)) { loser = i; break; }
//     final int removed = searchers[i].lock(...) - 4;
//     if (removed > 0) addNuisance(searchers[i ^ 1].getPlayfield(), removed);
//
// The fitness is one bit. It is rich because garbage crosses: you lose to
// what they sent, so attacking and defending are both paid for without
// anyone weighting them against each other.
//
// This is that, for Panel Attack, using the real engine. Both boards run in
// the same loop and hand each other garbage exactly as duel.js does.
//
// SAME SEED FOR BOTH BOARDS. A duel where one side draws friendlier panels
// measures the draw. Identical starting boards and identical panel sequences
// mean the only difference is the weights, so the bit that comes out is
// about them. (Two identical weight sets therefore mirror each other and
// draw, which is correct and is asserted in versus.test.js.)
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PuyoCpu = require('./puyocpu.js');
var report = require(path.join(__dirname, '..', 'experiments', 'report.js'));
var PanelEngine = (typeof window !== 'undefined' ? window : globalThis).PanelEngine;

var LEVEL = Number(process.env.GC_LEVEL || 10);

// A duel that never ends is a duel with no signal in it. Two bots that both
// survive indefinitely is a real outcome — a DRAW — not a reason to keep
// playing, and it has to be bounded or one pairing can hang a whole run.
var CEILING = Number(process.env.GC_VERSUS_CEILING || 36000);   // 10 minutes at 60fps

function makeCpu(stack, weights, opts) {
    return new PuyoCpu(stack, {
        weights: weights || {},
        reaction: 12,
        depth: opts.depth || 1,
        beam: opts.beam || 0,
        rise: opts.rise === true,
        allowRaise: opts.allowRaise === true,
        density: opts.density === true
    });
}

// One duel. Returns which side died, and the numbers worth looking at.
//
//   winner  0 | 1 | null      null is a draw: the ceiling, or both at once
exports.duel = function (weightsA, weightsB, seed, opts) {
    opts = opts || {};
    var level = opts.level || LEVEL;
    var stacks = [
        new PanelEngine.Stack({ level: level, seed: seed, countdown: false }),
        new PanelEngine.Stack({ level: level, seed: seed, countdown: false })
    ];
    var cpus = [ makeCpu(stacks[0], weightsA, opts), makeCpu(stacks[1], weightsB, opts) ];
    var sent = [0, 0];
    // WHAT KIND OF GARBAGE, not just how much. A bot that sends 20 cells in
    // 3-wide combos and one that sends 20 cells in a 5-chain are the same
    // number here and completely different players, so every piece is
    // classified by the same rule report.js uses everywhere else, as it
    // crosses. Counted per SENDER: chainDepth[0] is what side A sent.
    var chainDepth = [zeroDepth(), zeroDepth()];
    // AND THE EXACT SIZE, not only the bucket it falls in. The five
    // categories answer "roughly what kind"; these answer "how wide was the
    // combo" and "how many links was the chain", which is the question when
    // the whole point is whether the bot ever builds a long one.
    var exact = [zeroExact(), zeroExact()];

    var f = 0;
    for (; f < CEILING; f++) {
        cpus[0].update();
        cpus[1].update();
        stacks[0].run();
        stacks[1].run();

        // Garbage crosses, exactly as duel.js does it.
        for (var i = 0; i < 2; i++) {
            var out = stacks[i].takeDeliverableGarbage();
            if (out && out.length) {
                for (var k = 0; k < out.length; k++) {
                    sent[i] += (out[k].width || 0) * (out[k].height || 0);
                    chainDepth[i][report.classify(out[k])]++;
                    if (out[k].isChain) {
                        var links = out[k].height || 0;
                        exact[i].chain[links] = (exact[i].chain[links] || 0) + 1;
                    } else {
                        var wide = out[k].width || 0;
                        exact[i].combo[wide] = (exact[i].combo[wide] || 0) + 1;
                    }
                }
                stacks[i ^ 1].receiveGarbage(out);
            }
        }
        stacks[0].drainEvents();
        stacks[1].drainEvents();

        if (stacks[0].gameOver || stacks[1].gameOver) break;
    }

    // BOTH DEAD ON THE SAME FRAME IS A DRAW, not a win for whichever index
    // is checked first. duel.js gives the human the benefit of the doubt;
    // there is no human here and a coin-flip bit would be noise in the
    // training signal.
    var aDead = !!stacks[0].gameOver, bDead = !!stacks[1].gameOver;
    var winner = null;
    if (aDead && !bDead) winner = 1;
    else if (bDead && !aDead) winner = 0;

    return { winner: winner, frames: f, sent: sent, chainDepth: chainDepth, exact: exact,
             draw: winner === null,
             reason: (!aDead && !bDead) ? 'ceiling' : (aDead && bDead ? 'both' : 'death') };
};

function zeroDepth() {
    var z = {};
    report.CATEGORY_ORDER.forEach(function (c) { z[c] = 0; });
    return z;
}

// Sum one side's breakdown across several duels.
exports.addDepth = function (into, from) {
    report.CATEGORY_ORDER.forEach(function (c) { into[c] = (into[c] || 0) + (from[c] || 0); });
    return into;
};
exports.zeroDepth = zeroDepth;

function zeroExact() { return { combo: {}, chain: {} }; }

// Sum one side's exact histogram across several duels.
exports.addExact = function (into, from) {
    ['combo', 'chain'].forEach(function (kind) {
        Object.keys(from[kind] || {}).forEach(function (size) {
            into[kind][size] = (into[kind][size] || 0) + from[kind][size];
        });
    });
    return into;
};
exports.zeroExact = zeroExact;
