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
var CEILING = Number(process.env.GC_VERSUS_CEILING || 21600);   // 6 minutes at 60fps

// WHO WON. Death decides it when exactly one side died. Reaching the ceiling
// alive is NOT a shared result: the higher SCORE takes it, so a bot that
// survives by declining to attack does not bank half a point for it. Only an
// exact tie — a mirror match, or two sides that died on the same frame —
// stays a draw, because there the bit would be a coin flip and noise in the
// training signal.
//
// Score is the game's own, capped at 99999: the combo and chain tables, which
// pay nothing for a bare three, PLUS a flat +10 for every panel that finishes
// popping, which pays 30 for one. So the score does reward a payless clear,
// and on a ceiling duel the fitness would pay for grinding threes.
//
// It does not bite at the settings trained at. The ceiling is 21600 frames
// and duels run about 1,100, topping out around 2,700, so every duel is
// decided by who died. If the ceiling is ever reached, this tie-break stops
// meaning what it says.
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
        // OFF ONLY FOR THE HARNESS THAT MEASURES WHAT THE REFUSALS ARE WORTH,
        // and absent means on. Not forwarding it meant a duel asked to run
        // without them ran with them, so the measurement that proves the
        // self-death counters can move compared a run against itself.
        refuseSuicide: opts.refuseSuicide !== false,
        rules14: opts.rules14 !== false,
        sinkingEscape: opts.sinkingEscape,
        refuseBrokeRaise: opts.refuseBrokeRaise,
        goal: opts.goal,
        alsoTake: opts.alsoTake,
        buildToward: opts.buildToward,
        stopFloor: opts.stopFloor,
        dangerWeights: opts.dangerWeights,
        // THINK WITH THE ENGINE. _resolveCandidate then runs a real Stack
        // instead of LogicalBoard, which is the only way the bot and the game
        // cannot disagree: there is no second implementation left to drift.
        engine: opts.engine === true
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

    // Matches that opened a cascade, waiting to learn what the cascade became.
    //
    // A LIST, AND EACH ONE REMEMBERS ITS OWN CHAIN COUNTER. Holding a single
    // opener and crediting it to the next chaining match that arrives credits
    // the wrong one whenever a fresh match fires while a cascade is still
    // running: the new opener takes the credit for the old chain's next link,
    // and openedChain comes out ahead of the chains that actually finished.
    // The engine stamps every match with chainCounter, so a link belongs to
    // the opener one below it and to no other.
    // HOW LONG THE BOARD WAS IN TROUBLE BEFORE IT DIED. A board that goes
    // from safe to dead inside one decision cannot be played out of; one
    // that sits in the top three rows for seconds could have been. Reset
    // whenever the stack drops back out of the top rows, so this is the
    // length of the LAST run of danger, not the total.
    var dangerFrom = [null, null];
    function inDanger(st) {
        for (var r = st.height; r > st.height - 3; r--) {
            var row = st.panels[r];
            if (!row) continue;
            for (var c = 1; c <= st.width; c++) if (row[c] && row[c].color !== 0) return true;
        }
        return false;
    }

    var pendingOpen = [[], []];
    function settleOne(side, open) {
        if (open.size <= 3 && !open.garbage) exact[side].payless++;
    }
    // Everything still held is alone: called when a fresh cascade begins,
    // because the engine's counter has gone back to 0 and nothing older can
    // be extended, and again at the end of the duel.
    function settleOpener(side) {
        var list = pendingOpen[side];
        for (var i = 0; i < list.length; i++) settleOne(side, list[i]);
        pendingOpen[side] = [];
    }

    var ceiling = opts.ceiling || CEILING;
    var f = 0;
    for (; f < ceiling; f++) {
        cpus[0].update();
        cpus[1].update();
        stacks[0].run();
        stacks[1].run();
        for (var dg = 0; dg < 2; dg++) {
            if (inDanger(stacks[dg])) { if (dangerFrom[dg] === null) dangerFrom[dg] = f; }
            else dangerFrom[dg] = null;
        }

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
                } else if (ev.type === 'match') {
                    if (!ev.chain) exact[e].combo[ev.size] = (exact[e].combo[ev.size] || 0) + 1;
                    // DID IT PAY, JUDGED BY WHAT THE CASCADE BECAME.
                    //
                    // The opening match of a chain carries chain=false --  it
                    // is what STARTS the chain, not a link in it -- so asking
                    // at the moment it fires calls the first move of every
                    // chain a worthless three. It also counts it a second
                    // time under combo[3]. A five-chain opened by a three is
                    // the best move in the game and was being scored as the
                    // worst, in the number we read to decide whether the bot
                    // is improving.
                    //
                    // So an opener is HELD. A chaining match settles it as
                    // paid; the next opener settles the one before it as
                    // alone, since the engine emits chainEnd only when a
                    // chain actually formed and a lone match announces
                    // nothing at all. Anything still held when the duel ends
                    // is flushed below.
                    if (!ev.chain) {
                        // A MATCH OUTSIDE A CASCADE ENDS THE LAST ONE'S STORY.
                        // Inside one (counter above 0) it is a separate combo
                        // that the running chain's links must not be able to
                        // claim, so it is held apart.
                        if (!ev.chainCounter) settleOpener(e);
                        pendingOpen[e].push({ size: ev.size, garbage: !!ev.garbage,
                                              counter: ev.chainCounter });
                    } else if (ev.chainCounter === 2) {
                        // THE SECOND LINK, AND ONLY THE SECOND LINK.
                        // chainCounter goes 0 at the opener and straight to 2
                        // on the first link that chains -- it is never 1 --
                        // and every later link is 3, 4, 5. So counter 2 marks
                        // exactly one moment per chain, which is what makes
                        // openedChain equal the number of chainEnd events
                        // rather than the number of links.
                        // THE MOST RECENT ONE, whatever counter it carried.
                        // An opener can fire while the previous cascade is
                        // still finishing, so it is held at that cascade's
                        // counter rather than at 0; requiring 0 loses it and
                        // the chain it went on to open goes uncredited.
                        var list = pendingOpen[e];
                        if (list.length) {
                            exact[e].openedChain++;
                            list.pop();
                        }
                    }
                    if (ev.garbage) exact[e].broke++;
                }
            }
        }

        if (stacks[0].gameOver || stacks[1].gameOver) break;
    }

    settleOpener(0);
    settleOpener(1);

    var aDead = !!stacks[0].gameOver, bDead = !!stacks[1].gameOver;

    // WHY THE LOSER DIED, recorded here so nothing has to replay the duel to
    // find out. `forced` and `cornered` are decisions where every move on the
    // board was fatal, so the refusals lifted and the board decided; a death
    // with both at zero and `refusedFatal` above zero is one the refusals
    // steered away from and something else finished. `warning` is how long the
    // stack sat in the top three rows before the end.
    var deaths = [];
    [aDead, bDead].forEach(function (isDead, sd) {
        if (!isDead) return;
        var st = stacks[sd], cpu = cpus[sd], q = st.incoming || [], rows = 0;
        for (var i = 0; i < q.length; i++) rows += (q[i].height || 0);
        var garbage = 0, panels = 0, top = 0;
        for (var r = 1; r <= st.height; r++) {
            var row = st.panels[r];
            if (!row) continue;
            for (var c = 1; c <= st.width; c++) {
                var p = row[c];
                if (!p || p.color === 0) continue;
                if (r > top) top = r;
                if (p.isGarbage) garbage++; else panels++;
            }
        }
        deaths.push({
            side: sd, frame: f,
            warning: dangerFrom[sd] === null ? null : f - dangerFrom[sd],
            top: top, panels: panels, garbage: garbage, queuedRows: rows,
            stop: st.stopTime || 0, shake: st.shakeTime || 0,
            // At the decision it died on: was every move fatal, and did every
            // move lead to a board with nowhere to stand.
            forcedAtDeath: !!cpu.allFatalNow, corneredAtDeath: !!cpu.allCorneredNow,
            selfInflicted: cpu.selfInflicted || 0,
            forced: cpu.forcedDecisions || 0, cornered: cpu.corneredDecisions || 0,
            refusedFatal: cpu.fatalMovesDropped || 0,
            refusedCornering: cpu.corneringMovesDropped || 0,
            refusedRaises: cpu.suicidalRaises || 0
        });
    });

    var scores = [stacks[0].score, stacks[1].score];
    var winner = exports.decideWinner(aDead, bDead, scores);

    // `reason` says HOW the duel ended, not who won it: a duel that reaches
    // the ceiling reads 'ceiling' whether or not the score decided it.
    return { winner: winner, frames: f, sent: sent, chainDepth: chainDepth, exact: exact,
             scores: scores, draw: winner === null, deaths: deaths,
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

function zeroExact() { return { combo: {}, chain: {}, payless: 0, openedChain: 0, broke: 0 }; }

// Sum one side's exact histogram across several duels.
exports.addExact = function (into, from) {
    ['combo', 'chain'].forEach(function (kind) {
        Object.keys(from[kind] || {}).forEach(function (size) {
            into[kind][size] = (into[kind][size] || 0) + from[kind][size];
        });
    });
    into.payless = (into.payless || 0) + (from.payless || 0);
    into.openedChain = (into.openedChain || 0) + (from.openedChain || 0);
    into.broke = (into.broke || 0) + (from.broke || 0);
    return into;
};
exports.zeroExact = zeroExact;
