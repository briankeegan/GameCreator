#!/usr/bin/env node
// THE CHECKS THE ATTACK PROFILES MAKE (survivor_checks.js), against the engine.
//
//   node survivor_checks.test.js
//
// Boards come from pa-engine.js (PA.puzzle digits, a stack run on), so the fields the checks read are the ones the engine writes.
var assert = require('assert'), path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), C = require('./survivor_checks.js');
// rows top first, 6 digits a row (0 empty)
function board(rows) { return PA.puzzle(rows.join('')); }
var low = board(['000000', '000000', '120000', '341200', '123412']);
assert.strictEqual(C.panelTop(low), 5 - 2, 'five rows given, the top two empty: three rows high');
// puzzle rows count from the bottom: 5 rows given means the panels sit in rows 1..5, the first two rows of the list empty
assert.strictEqual(C.fullTop(low), C.panelTop(low), 'no garbage: the full height is the panel height');
assert.strictEqual(C.lowPeak(low), 1, 'the columns are 3, 3, 2, 2, 1, 1 high: the lowest peak is 1');
// lowest peak: a column with nothing in it is a peak of 0
var gap = board(['100000', '100000', '100000', '123456']);
assert.strictEqual(C.lowPeak(gap), 1, 'five columns one panel high, one four: the lowest peak is 1');
var even = board(['111111', '222222', '333333']);
assert.strictEqual(C.lowPeak(even), 3);
assert.strictEqual(C.panelCount(even), 18);
var grid = [[0, 0, 0, 0, 0, 0, 0], [0, 1, 1, 1, 1, 1, 1], [0, 2, 2, 2, 2, 2, 0], [0, 3, 3, 3, -2, 0, 0], [0, 0, 0, 0, 0, 0, 0]];
assert.strictEqual(C.lowPeakOf(grid), 1, 'a column holding only row 1 (garbage and holes above) is a peak of 1');
assert.strictEqual(C.lowPeakOf([[0, 0, 0, 0, 0, 0, 0], [0, 1, 1, 1, 1, 1, 0], [0, 0, 0, 0, 0, 0, 0]]), 0, 'a column with nothing in it is a peak of 0');
// a clear going: live while its panels move, free once they have settled whatever stop time is left (a combo of five: stop time outlasts it)
var b = board(['111211']);
b.curRow = 1; b.curCol = 4;
assert.strictEqual(b.tryQueueSwap(1, 4), true);
var liveFree = false, liveHeld = false, settledWithStop = false, strictHolds = false, i;
for (i = 0; i < 400; i++) {
  b.run();
  var free = C.cascadeLive(b, true), held = C.cascadeLive(b, false);
  if (free) liveFree = true;
  if (held) liveHeld = true;
  if (!free && (b.stopTime + b.preStopTime) > 0 && b.nActive === 0 && b.nPrevActive === 0) { settledWithStop = true; if (held) strictHolds = true; }
}
assert(liveFree, 'a clear going is live');
assert(liveHeld, 'and so, by stop time, in the strict form');
assert(settledWithStop, 'panels settled with stop time left exists in a combo of five');
assert(strictHolds, 'and there the strict form still holds, the free one does not');
assert.strictEqual(C.cascadeLive(b, true), false, 'and at the end of it nothing is live');
assert.strictEqual(C.cascadeLive(b, false), false);
// garbage counts for the height and not for the panels
var withGarbage = board(['111111', '222222']);
withGarbage.panels[5][3].isGarbage = true;
assert.strictEqual(C.fullTop(withGarbage), 5, 'garbage in row 5 makes the stack 5 high');
assert.strictEqual(C.panelTop(withGarbage), 2, 'and the panels 2');
assert.strictEqual(C.lowPeak(withGarbage), 2);
// topped out: a panel in the top row
var full = board(['111111', '222222', '333333', '444444', '555555', '666666', '111111', '222222', '333333', '444444', '555555', '666666']);
assert.strictEqual(full.isToppedOut(), true);
assert.strictEqual(C.toppedOrNearly(full, false), true);
assert.strictEqual(C.toppedOrNearly(even, false), false);
assert.strictEqual(C.toppedOrNearly(even, true), true, 'the frame loop says topped out');
var eleven = board(['111111', '222222', '333333', '444444', '555555', '666666', '111111', '222222', '333333', '444444', '555555']);
assert.strictEqual(C.panelTop(eleven), 11);
assert.strictEqual(eleven.isToppedOut(), false);
eleven.stopTime = 0; eleven.preStopTime = 0;
// framesToTop is the engine's: run the stack until a panel is in the top row and compare
function framesUntilTopped(st) { var n = 0; st = st.copy(); st.behaviours.passiveRaise = true; st.stopTime = 0; st.preStopTime = 0; while (!st.isToppedOut() && n < 5000) { st.run(); n++; } return n; }
[1, 10, 30].forEach(function (speed) {
  var e = board(['111111', '222222', '333333', '444444', '555555', '666666', '111111', '222222', '333333', '444444', '555555']);
  e.speed = speed; e.displacement = 16; e.riseTimer = PA.riseTime(speed); e.stopTime = 0; e.preStopTime = 0;
  var want = framesUntilTopped(e), got = C.framesToTop(e);
  assert(Math.abs(want - got) <= 2, 'speed ' + speed + ': the engine tops it out in ' + want + ' frames, framesToTop says ' + got);
  var ten = board(['111111', '222222', '333333', '444444', '555555', '666666', '111111', '222222', '333333', '444444']);
  ten.speed = speed; ten.displacement = 16; ten.riseTimer = PA.riseTime(speed); ten.stopTime = 0; ten.preStopTime = 0;
  want = framesUntilTopped(ten); got = C.framesToTop(ten);
  assert(Math.abs(want - got) <= 40, 'speed ' + speed + ' one row lower: the engine tops it out in ' + want + ' frames, framesToTop says ' + got);
});
eleven.speed = 1;
assert.strictEqual(C.toppedOrNearly(eleven, false), false, 'one row from the top, a row of rise away: time to act in, not topped out');
eleven.speed = 99; eleven.displacement = 3; eleven.riseTimer = 2;
assert.strictEqual(C.toppedOrNearly(eleven, false), true, 'one row from the top and the row nearly risen: as good as topped out');
eleven.speed = 1; eleven.displacement = 16; eleven.riseTimer = 50;
var garbageEleven = board(['111111', '222222']);
garbageEleven.panels[11][2].isGarbage = true; garbageEleven.stopTime = 0; garbageEleven.preStopTime = 0;
garbageEleven.speed = 99; garbageEleven.displacement = 2; garbageEleven.riseTimer = 1;
assert.strictEqual(C.toppedOrNearly(garbageEleven, false), true, 'garbage in row 11 and the next row about to rise: the next row up tops it out');
eleven.speed = 99; eleven.displacement = 3; eleven.riseTimer = 2; eleven.stopTime = 200;
assert.strictEqual(C.toppedOrNearly(eleven, false), false, 'with a long stop time running it is not');
eleven.stopTime = 0;
// raise cap
var A = { raiseMax: 10, raiseStopBonus: 1, raiseStopFrames: 60 };
even.stopTime = 0; even.preStopTime = 0;
assert.strictEqual(C.raiseCap(even, 0, A), 10);
even.stopTime = 70;
assert.strictEqual(C.raiseCap(even, 0, A), 11, 'one more while stop time runs');
even.stopTime = 30;
assert.strictEqual(C.raiseCap(even, 0, A), 10, 'not for a short stop');
assert.strictEqual(C.raiseCap(even, 3, { raiseMax: 10, raiseLeaveRoom: true }), 7, 'room left for the rows coming');
assert.strictEqual(C.raiseCap(even, 3, { raiseMax: 10 }), 10, 'garbage coming is a reason to raise, not to hold back');
// danger
even.stopTime = 0;
var tall = board(['111111', '222222', '333333', '444444', '555555', '666666', '111111', '222222', '333333', '444444']);
assert.strictEqual(C.panelTop(tall), 10);
assert.strictEqual(C.inDanger(tall, [], 0, false, {}), false, 'a stack raised to row 10 with nothing coming is not in danger');
assert.strictEqual(C.inDanger(tall, [{ at: 60 }], 2, false, {}), false, 'row 10 and a hit of 2 rows lands exactly on the top: not over');
assert.strictEqual(C.inDanger(tall, [{ at: 60 }], 3, false, {}), true, 'a hit of 3 rows would overflow it');
assert.strictEqual(C.inDanger(tall, [{ at: 400 }], 3, false, {}), false, 'a hit still far off is not an emergency yet');
assert.strictEqual(C.inDanger(full, [], 0, false, {}), true, 'topped out');
assert.strictEqual(C.inDanger(even, [], 0, true, {}), true, 'the frame loop says topped out');
var buried = board(['111111', '222222', '333333', '444444', '555555']);
buried.panels[11][2].isGarbage = true;
buried.speed = 99; buried.displacement = 3; buried.riseTimer = 2; buried.stopTime = 0; buried.preStopTime = 0;
assert.strictEqual(C.inDanger(buried, [], 0, false, {}), true, 'garbage in row 11 with the next row nearly up: the stack is as good as topped');
buried.speed = 1; buried.displacement = 16; buried.riseTimer = 900;
assert.strictEqual(C.inDanger(buried, [], 0, false, {}), false, 'garbage in row 11 with a whole row of rise to go is a stack with time, not one in danger');
assert.strictEqual(C.dangerWhy(buried, [{ at: 60 }], 3, false, {}), 'incoming', 'a hit that would overflow it is the reason when the stack is not the one');
assert.strictEqual(C.dangerWhy(full, [], 0, false, {}), 'topped');
console.log('survivor_checks: ok');
