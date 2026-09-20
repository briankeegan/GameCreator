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

// A duel that never ends is a duel with no signal in it, and it has to be
// bounded or one pairing can hang a whole run. `opts.ceiling` overrides it
// per duel; GC_VERSUS_CEILING overrides the default.
var CEILING = Number(process.env.GC_VERSUS_CEILING || 36000);   // 10 minutes at 60fps

// WHO WON. Death decides it when exactly one side died. Reaching the ceiling
// alive is NOT a shared result: the higher SCORE takes it, so a bot that
// survives by declining to attack does not bank half a point for it. Only an
// exact tie — a mirror match, or two sides that died on the same frame —
// stays a draw, because there the bit would be a coin flip and noise in the
// training signal.
//
// Score is the game's own: combo and chain bonuses via Stack.addScore, capped
// at 99999. A bare three earns nothing under that table, which is the point.
exports.decideWinner = function (aDead, bDead, scores) {
    if (aDead && !bDead) return 1;
    if (bDead && !aDead) return 0;
    if (aDead && bDead) return null;
    if (scores[0] > scores[1]) return 0;
    if (scores[1] > scores[0]) return 1;
    return null;
};

function makeCpu(stack, weights, opts) {
    return new PuyoCpu(stack, {
        weights: weights || {},
        reaction: 12,
        depth: opts.depth || 1,
        beam: opts.beam || 0,
        rise: opts.rise === true,
        allowRaise: opts.allowRaise === true,
        density: opts.density === true,
        modes: opts.modes === true,
        goal: opts.goal,
        alsoTake: opts.alsoTake,
        buildToward: opts.buildToward,
        stopFloor: opts.stopFloor,
        dangerWeights: opts.dangerWeights
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
    // EACH SIDE CAN SEE THE OTHER. Without this the opponent features are
    // wired all the way to the evaluator and then handed null, which reads as
    // a feature that is correct, registered and constant — the shape of dead
    // feature this repo has produced more than once.
    cpus[0].opponent = stacks[1];
    cpus[1].opponent = stacks[0];
    var sent = [0, 0];
    // WHAT KIND OF GARBAGE, not just how much. A bot that sends 20 cells in
    // 3-wide combos and one that sends 20 cells in a 5-chain are the same
    // number here and completely different players, so every piece is
    // classified by the same rule report.js uses everywhere else, as it
    // crosses. Counted per SENDER: chainDepth[0] is what side A sent.
    var chainDepth = [zeroDepth(), zeroDepth()];
    // AND THE EXACT SIZE, FROM THE ENGINE. The five categories answer
    // "roughly what kind"; these answer "how big was the combo" and "how long
    // was the chain". Both numbers are the engine's own: a match event carries
    // `size` (panels matched) and `chainCounter`, and the engine emits
    // { type: 'chainEnd', length } with the finished chain's true length when
    // the last chaining panel settles. Nothing here derives either of them —
    // an earlier version read the chain length off the garbage HEIGHT, which
    // is links minus one, and reported every chain one link short.
    var exact = [zeroExact(), zeroExact()];

    var ceiling = opts.ceiling || CEILING;
    var f = 0;
    for (; f < ceiling; f++) {
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
                }
                stacks[i ^ 1].receiveGarbage(out);
            }
        }
        for (var e = 0; e < 2; e++) {
            var evs = stacks[e].drainEvents();
            for (var q = 0; q < evs.length; q++) {
                var ev = evs[q];
                if (ev.type === 'chainEnd') {
                    exact[e].chain[ev.length] = (exact[e].chain[ev.length] || 0) + 1;
                } else if (ev.type === 'match' && !ev.chain) {
                    exact[e].combo[ev.size] = (exact[e].combo[ev.size] || 0) + 1;
                }
            }
        }

        if (stacks[0].gameOver || stacks[1].gameOver) break;
    }

    var aDead = !!stacks[0].gameOver, bDead = !!stacks[1].gameOver;
    var scores = [stacks[0].score, stacks[1].score];
    var winner = exports.decideWinner(aDead, bDead, scores);

    // `reason` says HOW the duel ended, not who won it: a duel that reaches
    // the ceiling reads 'ceiling' whether or not the score decided it.
    return { winner: winner, frames: f, sent: sent, chainDepth: chainDepth, exact: exact,
             scores: scores, draw: winner === null,
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
