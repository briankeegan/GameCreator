// Runs the REAL panel-engine.js Stack + panel-cpu.js SearchCpu against an
// ACTUAL recorded attack file from the source game
// (briankeegan/panel-game -- client/assets/default_data/training/
// challenge-<difficulty>-<stage>.json). These are not synthetic: each one
// is a captured replay of a real player's real attack output (see the
// file's own `extraInfo.gpm`/`playerName`/`matchLength`), used as the
// opponent's attack schedule in the source game's actual winnable
// Challenge Mode -- a completely different, much gentler animal than
// TrainingMenu's raw 50-attacks-in-under-a-second drill (training_harness.js).
//
// Attack file schema (AttackEngine.lua, ported faithfully):
//   delayBeforeStart, delayBeforeRepeat: frame offsets
//   attackPatterns: list of either
//     - a flat block: {width, height, startTime, metal}
//     - a real chain: {chain: [startTime, ...linkTimes], chainEndTime}
//       -- NOT N separate deliveries. GarbageQueue:addChainLink (real
//       engine) keeps ONE piece staged and grows it by one row per link
//       (currentChain.height += 1); it only actually lands, as a single
//       6-wide block N rows tall (N = link count), when
//       finalizeCurrentChain fires at chainEndTime. Modeled here as one
//       isChain:true delivery at chainEndTime sized 6xN.
//   All start times repeat every (delayBeforeRepeat + maxStartTime -
//   delayBeforeStart) frames, exactly like training_harness.js's burst
//   cycle but usually with far fewer, far more spread out events.
//
// Usage: node attack_file_harness.js <attackFile.json> <seed> [difficulty|cfgJSON] [stackLevel] [maxFrames]
var fs = require('fs');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var report = require('./report.js');
var attackSchedule = require('./attack_schedule.js');

var PanelEngine = global.PanelEngine;
var PanelCpu = global.PanelCpu;

var args = process.argv.slice(2);
var filePath = args[0];
var seed = parseInt(args[1], 10);
var cfgArg = args[2] || 'nightmare';
var stackLevel = parseInt(args[3], 10) || 3;
var maxFrames = parseInt(args[4], 10) || 60 * 60 * 10; // 10 simulated minutes default

var raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// See attack_schedule.js for the two real-engine behaviors this has to
// stay faithful to (chain-as-one-block, GARBAGE_FLIGHT delay) and
// harness_fidelity.test.js for the regression test that checks them.
var schedule = attackSchedule.buildEventSchedule(raw, PanelEngine.GARBAGE_FLIGHT);
var cyclePeriod = schedule.cyclePeriod;
function eventsAt(f) { return attackSchedule.eventsAt(schedule, f); }

var cpuOpts = cfgArg[0] === '{' ? JSON.parse(cfgArg) : { difficulty: cfgArg };
cpuOpts.seed = seed + 55;

var stack = new PanelEngine.Stack({ level: stackLevel, seed: seed, countdown: false });
var cpu = new PanelCpu.SearchCpu(stack, cpuOpts);

var cellsCleared = 0, garbageCellsCleared = 0, matchEvents = 0, biggestChainSeen = 0;
var sentRecords = [], attacksFired = 0;
var f;
for (f = 0; f < maxFrames; f++) {
  var fired = eventsAt(f);
  for (var i = 0; i < fired.length; i++) {
    stack.receiveGarbage([{ width: fired[i].width, height: fired[i].height, isChain: fired[i].isChain }]);
    attacksFired++;
  }
  cpu.update();
  stack.run();
  var sent = stack.takeDeliverableGarbage();
  for (var s = 0; s < sent.length; s++) sentRecords.push({ width: sent[s].width, height: sent[s].height, isChain: sent[s].isChain });
  var evs = stack.drainEvents();
  for (var j = 0; j < evs.length; j++) {
    if (evs[j].type === 'match') {
      matchEvents++;
      cellsCleared += evs[j].size;
      garbageCellsCleared += evs[j].garbage || 0;
      if (evs[j].chainCounter > biggestChainSeen) biggestChainSeen = evs[j].chainCounter;
    }
  }
  if (stack.gameOver) break;
}

report.printSummary(path.basename(filePath) + ' seed=' + seed + ' L' + stackLevel, f, sentRecords);

var garbageCellsSent = report.summarize(sentRecords).totalCells;
console.log(JSON.stringify(Object.assign({
  file: path.basename(filePath), seed: seed, stackLevel: stackLevel,
  extraInfo: raw.extraInfo || null, cyclePeriodFrames: cyclePeriod,
  survived: !stack.gameOver, framesAlive: f, secondsAlive: +(f / 60).toFixed(2),
  survivedMMSS: report.mmss(f),
  attacksFired: attacksFired,
  cellsCleared: cellsCleared, garbageCellsCleared: garbageCellsCleared,
  matchEvents: matchEvents, biggestChainSeen: biggestChainSeen,
  sentPerSecond: +(garbageCellsSent / (f / 60)).toFixed(3)
}, report.summaryFields(sentRecords))));
