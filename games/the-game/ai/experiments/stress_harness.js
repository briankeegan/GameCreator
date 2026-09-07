// Runs the REAL panel-engine.js Stack + panel-cpu.js SearchCpu against a
// sustained one-sided garbage stream, using whatever `_choose`/`_bestDefensiveMove`
// override the named strategy provides (see strategies.js). Prints one JSON
// line of results to stdout. Invoked by Python via subprocess so experiments
// stay statistically rigorous (many seeds, many configs) instead of eyeballed.
//
// Usage: node stress_harness.js <strategy> <framesPerAttack> <attackWidth> <attackHeight> <seed> <maxFrames> [difficulty|cfgJSON] [stackLevel]
//
// difficulty/cfgJSON defaults to 'diamond' (the shipped, deliberately
// weakened preset) for backward compat with earlier calls in this repo's
// history -- but 'diamond' is NOT what "hardest player" should ever be
// measured against. Pass 'nightmare', 'ultimate', or a JSON opts blob
// ('{"difficulty":"nightmare","reaction":8}') to test what's actually
// being tuned as the top tier.
//
// stackLevel defaults to 3 for the same backward-compat reason, but the
// SHIPPED Diamond/nightmare duel runs the foe's own Stack at level 6
// (story.js's `duel: { level: 6, ... }`), not 3 -- every survival number
// measured before this parameter existed used the wrong level. Level
// controls more than difficulty framing: startingSpeed (auto-rise speed)
// is 9 at level 3 vs 21 at level 6, and SPEED_TO_RISE_TIME means that's
// roughly one fresh real-panel row every ~9.5s at level 3 versus ~4s at
// level 6 -- more than 2x faster refill of the exact resource
// (LogicalBoard.runwayHeight) identified as the survival bottleneck all
// session. Always pass 6 (the actual foe level) when the question is
// "how does the shipped duel actually hold up," not just "how does this
// preset compare to that one" (where holding level fixed across both
// sides is still a fair, cheaper comparison).
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var strategies = require('./strategies.js');
var report = require('./report.js');

var args = process.argv.slice(2);
var strategyName = args[0];
var framesPerAttack = parseInt(args[1], 10);
var attackWidth = parseInt(args[2], 10);
var attackHeight = parseInt(args[3], 10);
var seed = parseInt(args[4], 10);
var maxFrames = parseInt(args[5], 10);
var cfgArg = args[6] || 'diamond';
var stackLevel = parseInt(args[7], 10) || 3;

var PanelEngine = global.PanelEngine;
var PanelCpu = global.PanelCpu;

var cpuOpts = cfgArg[0] === '{' ? JSON.parse(cfgArg) : { difficulty: cfgArg };
cpuOpts.seed = seed + 55;

var stack = new PanelEngine.Stack({ level: stackLevel, seed: seed, countdown: false });
var cpu = new PanelCpu.SearchCpu(stack, cpuOpts);
strategies.apply(cpu, strategyName);

var cellsCleared = 0, garbageCellsCleared = 0, matchEvents = 0, biggestChainSeen = 0;
var sentRecords = []; // what the AI throws BACK (the counterattack)
var f;
for (f = 0; f < maxFrames; f++) {
  if (f > 0 && f % framesPerAttack === 0) stack.receiveGarbage([{ width: attackWidth, height: attackHeight, isChain: false }]);
  cpu.update();
  stack.run();
  var sent = stack.takeDeliverableGarbage();
  for (var s = 0; s < sent.length; s++) sentRecords.push({ width: sent[s].width, height: sent[s].height, isChain: sent[s].isChain });
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

report.printSummary(strategyName + ' seed=' + seed, f, sentRecords);

var garbageCellsSent = report.summarize(sentRecords).totalCells;
console.log(JSON.stringify(Object.assign({
  strategy: strategyName, seed: seed, framesPerAttack: framesPerAttack,
  attackWidth: attackWidth, attackHeight: attackHeight,
  survived: !stack.gameOver, framesAlive: f, secondsAlive: +(f / 60).toFixed(2),
  survivedMMSS: report.mmss(f),
  cellsCleared: cellsCleared, garbageCellsCleared: garbageCellsCleared,
  matchEvents: matchEvents, biggestChainSeen: biggestChainSeen,
  sentPerSecond: +(garbageCellsSent / (f / 60)).toFixed(3)
}, report.summaryFields(sentRecords))));
