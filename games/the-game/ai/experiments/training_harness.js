// Runs the REAL panel-engine.js Stack + panel-cpu.js SearchCpu against one
// of Panel Attack's actual named training-mode attack patterns, ported
// EXACTLY from the source game (/home/user/briankeegan/panel-game --
// client/src/scenes/TrainingMenu.lua's createBasicTrainingMode +
// common/engine/AttackEngine.lua's AttackEngine.run), not guessed:
//
//   comboStorm : width=4, height=1
//   factory    : width=6, height=2
//   largeGarbage: width=6, height=12  (a full-board-height block --
//                  panel-engine.js's HEIGHT is 12)
//
// Every mode fires the SAME shape: 50 individual attacks, one per frame
// (a ~0.8s burst), preceded by a 150-frame lead-in and followed by a
// 900-frame (~15s) silent gap, then the whole thing repeats forever. This
// is a genuine burst-then-recover challenge pattern, not the steady drip
// stress_harness.js's `baseline` mode uses -- source's own numbers:
//   delayBeforeStart = 150, delayBeforeRepeat = 900, attacksPerVolley = 50,
//   attackPatterns[i].startTime = delayBeforeStart + i  for i = 1..50
//   cycle period = delayBeforeRepeat + highestStartTime - delayBeforeStart
//                = 900 + (150+50) - 150 = 950 frames
//
// No fixed survival cap: runs until the real Stack actually tops out, or
// until SAFETY_CEILING_FRAMES is hit -- which is reported as "stillGoing",
// not as a confirmed survival result.
//
// Usage: node training_harness.js <mode> <seed> [difficulty|cfgJSON] [stackLevel] [ceilingFrames]
//   mode: comboStorm | factory | largeGarbage
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));

var PanelEngine = global.PanelEngine;
var PanelCpu = global.PanelCpu;

var MODES = {
  comboStorm: { width: 4, height: 1 },
  factory: { width: 6, height: 2 },
  largeGarbage: { width: 6, height: 12 }
};

var LEAD_IN = 150;
var BURST_LEN = 50;       // one attack per frame
var GAP = 900;            // silent frames after the burst before it repeats
var CYCLE = GAP + (LEAD_IN + BURST_LEN) - LEAD_IN; // = 950, matches source's totalAttackTimeBeforeRepeat

var args = process.argv.slice(2);
var modeName = args[0];
var seed = parseInt(args[1], 10);
var cfgArg = args[2] || 'nightmare';
var stackLevel = parseInt(args[3], 10) || 3;
var ceilingFrames = parseInt(args[4], 10) || 60 * 60 * 60; // 60 simulated minutes, default safety ceiling

var mode = MODES[modeName];
if (!mode) throw new Error('unknown training mode: ' + modeName + ' (want comboStorm|factory|largeGarbage)');

var cpuOpts = cfgArg[0] === '{' ? JSON.parse(cfgArg) : { difficulty: cfgArg };
cpuOpts.seed = seed + 55;

var stack = new PanelEngine.Stack({ level: stackLevel, seed: seed, countdown: false });
var cpu = new PanelCpu.SearchCpu(stack, cpuOpts);

// Whether frame f fires an attack, replicating AttackEngine.run's modulo
// check for the 50 identical patterns sharing one width/height.
function fires(f) {
  if (f < LEAD_IN + 1) return false;
  var posInCycle = (f - LEAD_IN - 1) % CYCLE; // 0-indexed offset from the lead-in
  return posInCycle < BURST_LEN;
}

var cellsCleared = 0, garbageCellsCleared = 0, matchEvents = 0, biggestChainSeen = 0;
var garbageCellsSent = 0, attacksFired = 0;
var f;
for (f = 0; f < ceilingFrames; f++) {
  if (fires(f)) {
    stack.receiveGarbage([{ width: mode.width, height: mode.height, isChain: false }]);
    attacksFired++;
  }
  cpu.update();
  stack.run();
  var sent = stack.takeDeliverableGarbage();
  for (var s = 0; s < sent.length; s++) garbageCellsSent += sent[s].width * sent[s].height;
  var evs = stack.drainEvents();
  for (var i = 0; i < evs.length; i++) {
    if (evs[i].type === 'match') {
      matchEvents++;
      cellsCleared += evs[i].size;
      garbageCellsCleared += evs[i].garbage || 0;
      if (evs[i].chainCounter > biggestChainSeen) biggestChainSeen = evs[i].chainCounter;
    }
  }
  if (stack.gameOver) break;
}

var died = stack.gameOver;
console.log(JSON.stringify({
  mode: modeName, seed: seed, stackLevel: stackLevel,
  attackWidth: mode.width, attackHeight: mode.height,
  died: died, stillGoing: !died,
  framesAlive: f, secondsAlive: +(f / 60).toFixed(2),
  attacksFired: attacksFired,
  cellsCleared: cellsCleared, garbageCellsCleared: garbageCellsCleared,
  matchEvents: matchEvents, biggestChainSeen: biggestChainSeen,
  garbageCellsSent: garbageCellsSent
}));
