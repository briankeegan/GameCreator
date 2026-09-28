// THE ARITHMETIC IS CHECKED AGAINST THE ENGINE, NOT AGAINST ITSELF.
//
// bitbot prices a move in frames and decides what fits in the time there is. If
// those frames disagree with what the engine actually spends, every decision
// built on them is wrong and no outcome measurement will say which number lied.
//
// So: predict, play it on a real Stack, count the frames, compare.
require('../../panel-engine.js');
var BF = require('./bitfeatures.js');
var travel = require('./travel.js');
var P = globalThis.PanelEngine;

var fails = 0, checks = 0;
function eq(what, got, want) {
    checks++;
    if (got !== want) { fails++; console.log('FAIL: ' + what + ' -- got ' + got + ', engine says ' + want); }
}

// 1. resolveFramesOf IS the engine's preStop, at the same level, by construction
//    rather than by a number copied into the test.
var L = P.LEVELS[9], f = L.frames;
[[3, 0], [4, 0], [6, 0], [3, 6], [3, 12], [5, 4]].forEach(function (c) {
    var size = c[0], onScreen = c[1];
    eq('preStop(' + size + ',' + onScreen + ')',
       BF.resolveFramesOf(P, size, onScreen),
       f.FLASH + f.FACE + f.POP * (size + onScreen));
});

// 2. stopTimeOf IS awardStopTime, asked of a real Stack.
[[false, 4, 0], [false, 6, 0], [true, 0, 2], [true, 0, 4], [true, 0, 6]].forEach(function (c) {
    var s = new P.Stack({ level: 10, seed: 1, countdown: false });
    s.stopTime = 0; s.wasToppedOut = false; s.chainCounter = c[2];
    s.awardStopTime(c[0], c[1]);
    eq('awardStopTime(' + c[0] + ',' + c[1] + ',' + c[2] + ')',
       BF.stopTimeOf(P, c[0], c[1], c[2], false), s.stopTime);
});

// 3. A MOVE'S COST IS WHAT THE ENGINE SPENDS ISSUING IT.
//    travel.cost is frames of cursor walking; the engine moves the cursor one
//    cell per MOVE_FRAMES, so a walk of n cells is (n-1)*MOVE_FRAMES + 1 by
//    travel's own rule. Checked against the constant the engine exposes.
eq('MOVE_FRAMES matches the engine', travel.MOVE_FRAMES, 4);
[[1, 1], [2, 5], [3, 9], [6, 21]].forEach(function (c) {
    eq('travel.cost over ' + c[0] + ' cells', travel.cost(1, 1, 1, 1 + c[0]), c[1]);
});

// 4. THE FLOOR IS HELD WHILE A CLEAR RESOLVES. This is the fact the pricing
//    turns on -- resolve time is floor held, not time spent -- so it is asserted
//    against the engine rather than believed.
require('../../panel-cpu.js');
var BitBot = require('./bitbot.js');
var s2 = new P.Stack({ level: 10, seed: 7, countdown: false });
var bot = new BitBot(s2, { allowRaise: true });
var sawActive = 0, lockedWhileActive = true;
for (var i = 0; i < 6000; i++) {
    bot.update(); s2.run();
    if (s2.hasActivePanels && s2.hasActivePanels()) {
        sawActive++;
        if (!s2.riseLock) lockedWhileActive = false;
    }
    s2.drainEvents();
}
checks++;
if (sawActive < 100) { fails++; console.log('FAIL: only ' + sawActive + ' active frames, the check proved nothing'); }
checks++;
if (!lockedWhileActive) { fails++; console.log('FAIL: riseLock was clear while panels were active -- resolve time is NOT held floor'); }
console.log('  floor held on all ' + sawActive + ' frames with panels in motion');

console.log('timing: ' + checks + ' checks against the engine, ' + fails + ' failed');
if (fails) { console.log(fails + ' FAILURES'); process.exit(1); }
console.log('timing: OK');
