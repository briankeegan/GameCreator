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

var PanelEngine = global.PanelEngine;
var PanelCpu = global.PanelCpu;

var args = process.argv.slice(2);
var filePath = args[0];
var seed = parseInt(args[1], 10);
var cfgArg = args[2] || 'nightmare';
var stackLevel = parseInt(args[3], 10) || 3;
var maxFrames = parseInt(args[4], 10) || 60 * 60 * 10; // 10 simulated minutes default

var raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
var delayBeforeStart = raw.delayBeforeStart || 0;
var delayBeforeRepeat = raw.delayBeforeRepeat || 0;

// Flatten into a list of {frame, width, height, isChain} events, exactly
// matching AttackEngine.addAttackPatternsFromTable's expansion.
var events = [];
var maxStart = 0;
(raw.attackPatterns || []).forEach(function (p) {
  if (p.chain) {
    // BUG (fixed): this used to deliver each chain link as its own
    // immediate small block. GarbageQueue:addChainLink (the real engine)
    // does something different -- a chain garbage piece stays STAGED
    // (not yet in transit/deliverable) and GROWS by one row per link
    // (currentChain.height += 1), only actually landing as ONE combined
    // block once finalizeCurrentChain fires at chainEndTime. So an
    // N-link chain is one 6-wide, N-tall block delivered all at once at
    // the end, not N separate 6x1 (or 6x1..N) deliveries spread across
    // the chain's own duration.
    var times = Array.isArray(p.chain) ? p.chain : null;
    var endTime = p.chainEndTime;
    if (times && endTime !== undefined) {
      var start = delayBeforeStart + endTime;
      events.push({ frame: start, width: 6, height: times.length, isChain: true });
      maxStart = Math.max(maxStart, start);
      // The chain's own link times still push the cycle-repeat window out
      // even though nothing lands until chainEndTime.
      times.forEach(function (t) { maxStart = Math.max(maxStart, delayBeforeStart + t); });
    }
  } else {
    var start = delayBeforeStart + p.startTime;
    events.push({ frame: start, width: p.width, height: p.height || 1, isChain: false });
    maxStart = Math.max(maxStart, start);
  }
});
var cyclePeriod = delayBeforeRepeat + maxStart - delayBeforeStart;
events.sort(function (a, b) { return a.frame - b.frame; });

function eventsAt(f) {
  if (cyclePeriod <= 0) return [];
  var out = [];
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    if (f < e.frame) continue;
    if ((f - e.frame) % cyclePeriod === 0) out.push(e);
  }
  return out;
}

var cpuOpts = cfgArg[0] === '{' ? JSON.parse(cfgArg) : { difficulty: cfgArg };
cpuOpts.seed = seed + 55;

var stack = new PanelEngine.Stack({ level: stackLevel, seed: seed, countdown: false });
var cpu = new PanelCpu.SearchCpu(stack, cpuOpts);

var cellsCleared = 0, garbageCellsCleared = 0, matchEvents = 0, biggestChainSeen = 0;
var garbageCellsSent = 0, attacksFired = 0;
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
  for (var s = 0; s < sent.length; s++) garbageCellsSent += sent[s].width * sent[s].height;
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

console.log(JSON.stringify({
  file: path.basename(filePath), seed: seed, stackLevel: stackLevel,
  extraInfo: raw.extraInfo || null, cyclePeriodFrames: cyclePeriod,
  survived: !stack.gameOver, framesAlive: f, secondsAlive: +(f / 60).toFixed(2),
  attacksFired: attacksFired,
  cellsCleared: cellsCleared, garbageCellsCleared: garbageCellsCleared,
  matchEvents: matchEvents, biggestChainSeen: biggestChainSeen,
  garbageCellsSent: garbageCellsSent, sentPerSecond: +(garbageCellsSent / (f / 60)).toFixed(3)
}));
