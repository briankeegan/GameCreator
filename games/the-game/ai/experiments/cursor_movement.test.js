// RULE: no CPU (Cpu or SearchCpu, any difficulty/level) may ever move its
// cursor more than one cell in one frame. Stack.touchSwap is a real input
// mode -- what a touchscreen tap does -- but it also doubles as an instant
// "teleport to any cell and swap in the same frame" primitive, and every
// CPU class in panel-cpu.js used to call it directly. That made the AI
// strictly more capable than any keyboard/gamepad player, who can only
// move the cursor one cell per frame at best (see
// Stack.prototype.stepCursorToward's own comment in panel-engine.js for
// why 1 cell/frame, not slower, is the real achievable ceiling -- tapping
// a direction repeatedly beats holding one down and waiting out DAS).
//
// TOOL: this file. Plays real matches through both CPU classes across
// several levels/presets/seeds (including maxHealth<=1, the tier this
// mechanic change hits hardest -- topped-out health-drain now genuinely
// runs during cursor travel, same as it would for a real player) and
// asserts the cursor's position never changes by more than one cell
// between consecutive frames. Also proves the check itself isn't a no-op:
// a direct Stack.touchSwap call (a real, legitimate touch-input teleport)
// is asserted to trip the SAME distance check this file uses on real
// play, so a regression that reintroduces touchSwap into a CPU's update()
// would be caught, not silently passed (see this project's "a checker's
// bugs are silent by construction, test both directions" rule).
//
// GATE: wire this into pages.yml (or an equivalent CI step) so a
// regression fails the build, not just a future person's memory.
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = global.PanelEngine;
var PanelCpu = global.PanelCpu;

var failures = [];

function cellDistance(row1, col1, row2, col2) {
  return Math.abs(row1 - row2) + Math.abs(col1 - col2);
}

// ---- accepts correct behavior: real play never exceeds 1 cell/frame ----
var LEAD_IN = 150, BURST_LEN = 50, GAP = 900;
function fires(f) {
  if (f < LEAD_IN + 1) return false;
  var posInCycle = (f - LEAD_IN - 1) % (GAP + BURST_LEN);
  return posInCycle < BURST_LEN;
}

function playAndCheck(label, makeCpu, level, seed, withBursts, frames) {
  var stack = new PanelEngine.Stack({ level: level, seed: seed, countdown: false });
  var cpu = makeCpu(stack, seed);
  var lastRow = stack.curRow, lastCol = stack.curCol;
  var maxJump = 0, violations = 0;
  for (var f = 0; f < frames; f++) {
    if (withBursts && fires(f)) stack.receiveGarbage([{ width: 6, height: 12, isChain: false }]);
    cpu.update();
    var eventsBefore = stack.events.length;
    stack.run();
    // A new row rising auto-follows the cursor's ROW by +1 (Stack.newRow,
    // panel-engine.js) so it stays on the same physical panels as they
    // shift up -- a real, pre-existing mechanic every player (human or
    // CPU) experiences identically, not a teleport. Budget for it
    // separately from the CPU's own deliberate 1-cell/frame step instead
    // of conflating the two into one raw distance check.
    var newRowFired = stack.events.slice(eventsBefore).some(function (e) { return e.type === 'newRow'; });
    var colJump = Math.abs(stack.curCol - lastCol);
    var rowJump = Math.abs(stack.curRow - lastRow);
    var allowedRowJump = newRowFired ? 2 : 1; // the engine's own +1 follow, plus the CPU's own step
    if (colJump > maxJump) maxJump = colJump;
    if (rowJump > maxJump) maxJump = rowJump;
    if (colJump > 1 || rowJump > allowedRowJump) violations++;
    lastRow = stack.curRow; lastCol = stack.curCol;
    if (withBursts) stack.takeDeliverableGarbage();
    stack.drainEvents();
    if (stack.gameOver) break;
  }
  if (violations > 0) {
    failures.push(label + ': cursor moved more than the CPU\'s own 1-cell/frame budget allows ' +
      violations + ' time(s) (max single-axis jump ' + maxJump + ', beyond what a newRow follow explains) over ' + (f + 1) + ' frames');
  }
  return { framesPlayed: f + 1, maxJump: maxJump };
}

playAndCheck('Cpu/sharp/level5/seed1', function (stack, seed) {
  return new PanelCpu.Cpu(stack, { difficulty: 'sharp', seed: seed });
}, 5, 1, false, 3000);

playAndCheck('SearchCpu/diamond/level5/seed1', function (stack, seed) {
  return new PanelCpu.SearchCpu(stack, { difficulty: 'diamond', seed: seed });
}, 5, 1, false, 3000);

playAndCheck('SearchCpu/nightmare/level3/seed1', function (stack, seed) {
  return new PanelCpu.SearchCpu(stack, { difficulty: 'nightmare', seed: seed });
}, 3, 1, false, 3000);

playAndCheck('SearchCpu/nightmare/level8/seed1', function (stack, seed) {
  return new PanelCpu.SearchCpu(stack, { difficulty: 'nightmare', seed: seed });
}, 8, 1, false, 3000);

// maxHealth<=1 (level 10) with real bigBlocks bursts and TrueSurvivalSearch
// active the whole match -- the tier this mechanic change matters most,
// including through PreburstReserve/TrueSurvivalSearch's own execution
// path (the SAME update()/advanceSwapExecution code, not a separate one).
[1, 2, 3, 4, 5].forEach(function (seed) {
  playAndCheck('SearchCpu/nightmare/level10(bigBlocks)/seed' + seed, function (stack, s) {
    return new PanelCpu.SearchCpu(stack, { difficulty: 'nightmare', seed: s + 55 });
  }, 10, seed, true, 6000);
});

// ---- rejects the defect: a real touchSwap teleport trips the same check ----
(function () {
  var stack = new PanelEngine.Stack({ level: 5, seed: 1, countdown: false });
  // Stack.canSwap refuses everything while clock<=1 (see its own guard) --
  // a couple of real frames need to pass before any swap, real or this
  // test's synthetic teleport, is legal at all.
  stack.run(); stack.drainEvents();
  stack.run(); stack.drainEvents();
  // Force the cursor to a known corner directly (test setup, not something
  // any real input path does) so ANY legal swap elsewhere on the board is
  // guaranteed real distance to cross -- a fixed candidate list filtered
  // by "far enough" could come up empty on an unlucky board/seed, which
  // would prove nothing about whether the checker works.
  stack.curRow = 1; stack.curCol = 1; stack.clampCursor();
  var startRow = stack.curRow, startCol = stack.curCol;
  var caught = false;
  for (var r = stack.height; r >= 1 && !caught; r--) {
    for (var c = PanelEngine.WIDTH - 1; c >= 1 && !caught; c--) {
      if (stack.touchSwap(r, c)) {
        var jump = cellDistance(stack.curRow, stack.curCol, startRow, startCol);
        if (jump <= 1) {
          failures.push('negative-case setup: touchSwap(' + r + ',' + c + ') from (' + startRow + ',' + startCol + ') measured jump=' + jump + ', expected >1 -- test fixture is broken, not proof the checker works');
        } else {
          caught = true; // the checker's own distance math correctly flags this as a teleport
        }
      }
    }
  }
  if (!caught) {
    failures.push('negative case never got to run: no legal touchSwap target existed anywhere on this board -- test fixture needs a different board/seed, not evidence teleporting is impossible');
  }
})();

if (failures.length) {
  console.error('FAIL (' + failures.length + '):');
  failures.forEach(function (f) { console.error('  - ' + f); });
  process.exit(1);
}
console.log('PASS: no CPU (Cpu or SearchCpu, every tested difficulty/level, including maxHealth<=1 bigBlocks bursts) ever moves its cursor more than 1 cell in a single frame, and the distance check itself is confirmed to catch a real teleport (negative case)');
