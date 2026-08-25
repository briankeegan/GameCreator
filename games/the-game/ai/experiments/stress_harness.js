// Runs the REAL panel-engine.js Stack + panel-cpu.js SearchCpu against a
// sustained one-sided garbage stream, using whatever `_choose`/`_bestDefensiveMove`
// override the named strategy provides (see strategies.js). Prints one JSON
// line of results to stdout. Invoked by Python via subprocess so experiments
// stay statistically rigorous (many seeds, many configs) instead of eyeballed.
//
// Usage: node stress_harness.js <strategy> <framesPerAttack> <attackWidth> <attackHeight> <seed> <maxFrames>
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var strategies = require('./strategies.js');

var args = process.argv.slice(2);
var strategyName = args[0];
var framesPerAttack = parseInt(args[1], 10);
var attackWidth = parseInt(args[2], 10);
var attackHeight = parseInt(args[3], 10);
var seed = parseInt(args[4], 10);
var maxFrames = parseInt(args[5], 10);

var PanelEngine = global.PanelEngine;
var PanelCpu = global.PanelCpu;

var stack = new PanelEngine.Stack({ level: 3, seed: seed, countdown: false });
var cpu = new PanelCpu.SearchCpu(stack, { difficulty: 'diamond', seed: seed + 55 });
strategies.apply(cpu, strategyName);

var cellsCleared = 0, garbageCellsCleared = 0, matchEvents = 0, biggestChainSeen = 0;
var garbageCellsSent = 0; // what the AI throws BACK (the counterattack)
var f;
for (f = 0; f < maxFrames; f++) {
  if (f > 0 && f % framesPerAttack === 0) stack.receiveGarbage([{ width: attackWidth, height: attackHeight, isChain: false }]);
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

console.log(JSON.stringify({
  strategy: strategyName, seed: seed, framesPerAttack: framesPerAttack,
  attackWidth: attackWidth, attackHeight: attackHeight,
  survived: !stack.gameOver, framesAlive: f, secondsAlive: +(f / 60).toFixed(2),
  cellsCleared: cellsCleared, garbageCellsCleared: garbageCellsCleared,
  matchEvents: matchEvents, biggestChainSeen: biggestChainSeen,
  garbageCellsSent: garbageCellsSent, sentPerSecond: +(garbageCellsSent / (f / 60)).toFixed(3)
}));
