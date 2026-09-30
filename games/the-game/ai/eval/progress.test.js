// THE BOT MUST MOVE THE BOARD.
//
//   node progress.test.js
//
// Every other gate asks whether a decision was correct. None of them asked
// whether anything HAPPENED, and that is how a bot that spent five hundred of its
// last six hundred decisions on a board that never changed passed every push.
//
// The defect that named this gate: update() drops the reaction inside a freeze,
// so the bot re-decided every frame; the board it snapshotted was mid-swap, the
// answer came back the same, and playing it restarted the swap on the same pair.
// Seed 103 ZERO held `swap r6c2` for 51 consecutive frames inside a 62-frame
// freeze and then `swap r4c4` for 107, the board alternating between exactly two
// positions, and died at 2,063 having broken 16 of the 57 garbage cells it was
// sent. gate_bitbot runs 600-frame mirror duels and never reaches a freeze under
// garbage pressure, so it saw none of it.
//
// So this is deliberately not a test of that guard -- survival.test.js invariant 8
// is. It measures the SYMPTOM, on real duels, so the next cause of it is caught
// without anyone having to think of it first.
var path = require('path');
var ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'panel-engine.js'));
require(path.join(ROOT, 'panel-cpu.js'));
var BitBot = require('./bitbot.js');
var BF = require('./bitfeatures.js');
var P = globalThis.PanelEngine, W = 6;

var fails = 0;
function ok(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }

// A vector is a vector; what matters is that the two boards differ, so each one
// faces garbage it did not choose the timing of. Seeds and vectors are the ones
// the round-robin uses, because those are the games the defect was found in.
function vec(s) {
    var w = {}, keys = BF.keys(), x = s, i;
    for (i = 0; i < keys.length; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        w[keys[i]] = Math.round(((x / 0x7fffffff) * 2 - 1) * 100);
    }
    return w;
}

// WHAT THE BOARD IS, for the purpose of "did it change". Colour and garbage per
// cell. Not heights: a horizontal swap changes no column height, which is exactly
// why the wiggle was invisible in a height trace for so long.
function boardOf(st) {
    var out = '', r, c, p;
    for (r = 1; r <= st.height; r++) {
        for (c = 1; c <= W; c++) {
            p = st.panels[r][c];
            out += (p.isGarbage ? 'g' : '') + p.color + ',';
        }
    }
    return out;
}

function run(seed, weightsA, weightsB, frames) {
    var st = [new P.Stack({ level: 10, seed: seed, countdown: false }),
              new P.Stack({ level: 10, seed: seed, countdown: false })];
    var bots = [0, 1].map(function (side) {
        var o = { allowRaise: true };
        var wv = side === 0 ? weightsA : weightsB;
        if (wv) o.weights = wv;
        return new BitBot(st[side], o);
    });
    // Per side: the longest run of consecutive frames the board did not change
    // while the bot was NOT merely sitting out its reaction, and the longest run
    // of identical swaps returned with no board change between them.
    var stat = [0, 1].map(function () {
        return { stillRun: 0, stillMax: 0, sameSwapRun: 0, sameSwapMax: 0,
                 decisions: 0, lastMove: null, frozenStill: 0, frozenStillMax: 0,
                 cycleSet: [], cycleRun: 0, cycleMax: 0 };
    });
    var prev = [null, null];
    [0, 1].forEach(function (side) {
        var real = bots[side].decide.bind(bots[side]);
        bots[side].decide = function () {
            var d = real();
            var s = stat[side];
            s.decisions++;
            // SWAPS ONLY. A hold repeated is what raising IS -- update() sends the
            // button on the mode and the bot keeps its hands off the swap button
            // while the engine hands the row over -- so counting holds here would
            // measure the raise and call it a stall.
            var sig = d.kind === 'swap' && d.move ? (d.move[0] + ':' + d.move[1]) : null;
            // AND THE BOARD HAS TO NOT HAVE MOVED. The same cell coming up again
            // is ordinary -- a break lands and the column beneath it refills, so
            // the same pair is the right answer twice. What is never right is the
            // same answer on a board that did not change in between.
            var bd = boardOf(st[side]);
            if (sig !== null && s.lastMove === sig && s.lastBoard === bd) { s.sameSwapRun++; }
            else { s.sameSwapRun = sig === null ? 0 : 1; }
            s.lastMove = sig; s.lastBoard = bd;
            if (sig !== null) s.sameSwapVia = d.via;
            if (s.sameSwapRun > s.sameSwapMax) {
                s.sameSwapMax = s.sameSwapRun; s.worstVia = d.via;
            }
            return d;
        };
    });
    var f, i, b;
    for (f = 0; f < frames && !st[0].gameOver && !st[1].gameOver; f++) {
        bots[0].update(); bots[1].update();
        st[0].run(); st[1].run();
        for (i = 0; i < 2; i++) {
            var g = st[i].takeDeliverableGarbage();
            if (g && g.length) st[i ^ 1].receiveGarbage(g);
        }
        st[0].drainEvents(); st[1].drainEvents();
        for (i = 0; i < 2; i++) {
            b = boardOf(st[i]);
            var s = stat[i];
            // AND THE BOARD HAS TO BE SETTLED FOR STILLNESS TO MEAN ANYTHING.
            //
            // A matched panel keeps its colour through FLASH and FACE -- 38 frames
            // before the first one pops -- so a big clear resolving reads as a
            // board that has not changed for a hundred frames while the engine is
            // doing exactly what it should. Measured: 98 frames of it on seed 101
            // with fifteen panels active and preStopTime running 75 down to 3.
            // nActive at zero is the difference between nothing happening and
            // plenty happening that is not visible in the colours.
            if (prev[i] === b && st[i].nActive === 0) {
                s.stillRun++;
                // A FREEZE IS THE CASE THAT MATTERS. Stop time is the one stretch
                // the bot is given for free, and standing still through it is
                // spending a life for nothing -- the reason the reaction lifts
                // there at all.
                if ((st[i].stopTime || 0) > 0) s.frozenStill++;
                else s.frozenStill = 0;
            } else {
                s.stillRun = 0; s.frozenStill = 0;
            }
            // AND THE CYCLE, WHICH STILLNESS CANNOT SEE. The wiggle changes the
            // board every decision -- it changes it BACK. So the board moves, the
            // still counter resets, and thirty-eight decisions of achieving
            // nothing read as thirty-eight decisions of progress. What both cases
            // have in common is the number of positions the bot is confined to:
            // one for standing still, two for an undo pair. Counted over settled
            // frames only, so a resolve is not mistaken for a cycle.
            if (st[i].nActive === 0) {
                if (s.cycleSet.indexOf(b) < 0) {
                    if (s.cycleSet.length < 2) s.cycleSet.push(b);
                    else { s.cycleSet = [b]; s.cycleRun = 0; }
                }
                s.cycleRun++;
                if (s.cycleRun > s.cycleMax) s.cycleMax = s.cycleRun;
            }
            if (s.stillRun > s.stillMax) s.stillMax = s.stillRun;
            if (s.frozenStill > s.frozenStillMax) s.frozenStillMax = s.frozenStill;
            prev[i] = b;
        }
    }
    return { frames: f, dead: [st[0].gameOver, st[1].gameOver], stat: stat };
}

// THE BUDGETS, AND WHERE THEY COME FROM.
//
// Measured on this build over the games below and recorded here, which is the
// only honest way to set them: a threshold picked without the numbers beside it
// is a guess that will be tuned until it passes.
//
// All three are measured on a SETTLED board, because a matched panel keeps its
// colour for 38 frames before it pops and a resolving clear is not stillness.
//
//   STILL_MAX          the board settled and unchanged. A walk is up to 64 frames
//                      and the colours do not change between risen rows, so a
//                      cursor crossing a quiet board is legitimately still.
//                      Observed on this build: 44 (seed 103 ZERO). Budget 80.
//   FROZEN_STILL_MAX   the same, inside stop time. That is the free time the
//                      reaction lifts for, so standing through it is the defect
//                      and little else. Observed: 22 (seed 103 rand1). Budget 40.
//   SAME_ANSWER_MAX    the same swap returned with the board unchanged in between.
//                      The same cell twice is ordinary -- a break lands and the
//                      column refills -- so the board not moving is the whole
//                      signal. Observed: 4. Budget 8.
//
// Before the two fixes this gate was written for, the same three read 144, 144 and
// 38, with a 151-decision run of one answer.
var STILL_MAX = 80;
var FROZEN_STILL_MAX = 40;
var SAME_ANSWER_MAX = 8;
//   CYCLE_MAX          settled frames confined to at most two board positions --
//                      standing still is one, an undo pair is two. Observed on
//                      this build: 118 (seed 103 rand1, via digPlan). Budget 140.
//
// THAT 118 IS NOT A PASS MARK, IT IS A CEILING. Two seconds of a duel spent
// between two positions is two seconds of not playing, and this number is here to
// be driven down -- the budget is set above what the build does so the gate catches
// a REGRESSION today, and it should be lowered every time the figure improves.
// Refusing the undo outright was tried and measured: it took the worst case from
// 118 to 93 and killed a board that had survived, so it is not in yet.
var CYCLE_MAX = 140;

var GAMES = [
    { seed: 101, a: null,      b: vec(7919),     name: 'STARTER vs rand1' },
    { seed: 103, a: {},        b: vec(7919),     name: 'ZERO vs rand1' },
    { seed: 103, a: vec(2*7919), b: vec(3*7919), name: 'rand2 vs rand3' }
];
var FRAMES = 3000;

var worst = { still: 0, frozen: 0, same: 0, cycle: 0 };
GAMES.forEach(function (g) {
    var r = run(g.seed, g.a, g.b, FRAMES);
    [0, 1].forEach(function (side) {
        var s = r.stat[side], who = g.name.split(' vs ')[side];
        console.log('  seed ' + g.seed + ' ' + who.padEnd(8) +
                    ' decisions ' + String(s.decisions).padStart(4) +
                    '  still ' + String(s.stillMax).padStart(4) +
                    '  still-in-freeze ' + String(s.frozenStillMax).padStart(4) +
                    '  two-position ' + String(s.cycleMax).padStart(4) +
                    '  same swap x' + String(s.sameSwapMax).padStart(3) +
                    ' (' + (s.worstVia || '-') + ')' +
                    (r.dead[side] ? '  DIED@' + r.frames : ''));
        if (s.stillMax > worst.still) worst.still = s.stillMax;
        if (s.frozenStillMax > worst.frozen) worst.frozen = s.frozenStillMax;
        if (s.sameSwapMax > worst.same) worst.same = s.sameSwapMax;
        if (s.cycleMax > (worst.cycle || 0)) worst.cycle = s.cycleMax;
        ok(s.decisions > 20, 'seed ' + g.seed + ' ' + who + ' took ' + s.decisions +
           ' decisions, too few for this to have measured anything');
        ok(s.stillMax <= STILL_MAX,
           'seed ' + g.seed + ' ' + who + ' spent ' + s.stillMax + ' consecutive ' +
           'frames on a board that did not change (budget ' + STILL_MAX + ')');
        ok(s.frozenStillMax <= FROZEN_STILL_MAX,
           'seed ' + g.seed + ' ' + who + ' spent ' + s.frozenStillMax +
           ' consecutive frames of STOP TIME on a board that did not change ' +
           '(budget ' + FROZEN_STILL_MAX + ') -- the freeze is the free time and ' +
           'it was spent standing still');
        ok(s.cycleMax <= CYCLE_MAX,
           'seed ' + g.seed + ' ' + who + ' spent ' + s.cycleMax + ' consecutive ' +
           'settled frames confined to at most two board positions (budget ' +
           CYCLE_MAX + ') -- a board that keeps changing back has not changed');
        ok(s.sameSwapMax <= SAME_ANSWER_MAX,
           'seed ' + g.seed + ' ' + who + ' returned the same answer ' +
           s.sameSwapMax + ' times in a row via ' + s.worstVia + ' WITH THE BOARD UNCHANGED (budget ' + SAME_ANSWER_MAX +
           ') -- an answer replayed is a swap undone');
    });
});

console.log('progress: worst over ' + GAMES.length + ' duels of ' + FRAMES +
            ' frames -- still ' + worst.still + ', still-in-freeze ' + worst.frozen +
            ', two-position ' + worst.cycle + ', same swap x' + worst.same +
            ' (budgets ' + STILL_MAX + '/' + FROZEN_STILL_MAX + '/' + SAME_ANSWER_MAX + ')');
if (fails) { console.log(fails + ' FAILURES'); process.exit(1); }
console.log('progress: OK');
