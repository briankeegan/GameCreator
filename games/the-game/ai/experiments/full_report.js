// THE standard test suite: one config, every benchmark type this
// directory has, one combined report. Built because running each
// harness by hand, one at a time, isn't the standard the user wants --
// this is: one command, everything.
//
// Four categories, in increasing order of realism:
//   comboStorm   - TrainingMenu.lua drill, 4x1 combo blocks, unbeatable
//                  by design (see FINDINGS.md) -- included anyway so a
//                  regression there is still visible, not because
//                  surviving it is a real target.
//   factory      - TrainingMenu.lua drill, 6x2 blocks, same caveat.
//   bigBlocks    - TrainingMenu.lua drill, 6x12 (largeGarbage), same
//                  caveat -- named "bigBlocks" here to match how the
//                  user actually refers to it.
//   endless      - the REAL benchmark: all 12 challenge-8-*.json files
//                  (real recorded human attack output, the source
//                  game's actual winnable Challenge Mode), run to
//                  natural game-over or a long cap, averaged. This is
//                  the one number that predicts real performance --
//                  see FINDINGS.md's "misleading synthetic benchmark"
//                  section for why the drills above don't.
//
// Usage: node full_report.js [difficulty|cfgJSON] [stackLevel] [seed]
var path = require('path');
var fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var report = require('./report.js');
var attackSchedule = require('./attack_schedule.js');

var PanelEngine = global.PanelEngine;
var PanelCpu = global.PanelCpu;

var cfgArg = process.argv[2] || 'nightmare';
var stackLevel = parseInt(process.argv[3], 10) || 10;
var seed = parseInt(process.argv[4], 10) || 1;

function makeCpu(extraOpts) {
  var opts = cfgArg[0] === '{' ? JSON.parse(cfgArg) : { difficulty: cfgArg };
  Object.assign(opts, extraOpts || {});
  opts.seed = seed + 55;
  var stack = new PanelEngine.Stack({ level: stackLevel, seed: seed, countdown: false });
  var cpu = new PanelCpu.SearchCpu(stack, opts);
  return { stack: stack, cpu: cpu };
}

// ---- Training-mode drills (comboStorm, factory, bigBlocks) ----
var TRAINING_MODES = {
  comboStorm: { width: 4, height: 1 },
  factory: { width: 6, height: 2 },
  bigBlocks: { width: 6, height: 12 }
};
var LEAD_IN = 150, BURST_LEN = 50, GAP = 900;
var CYCLE = GAP + (LEAD_IN + BURST_LEN) - LEAD_IN;
var TRAINING_CEILING = 60 * 60 * 5; // 5 simulated minutes is plenty -- these drills die fast

function runTrainingMode(modeName) {
  var mode = TRAINING_MODES[modeName];
  var made = makeCpu();
  var stack = made.stack, cpu = made.cpu;
  function fires(f) {
    if (f < LEAD_IN + 1) return false;
    var posInCycle = (f - LEAD_IN - 1) % CYCLE;
    return posInCycle < BURST_LEN;
  }
  var sentRecords = [], f;
  for (f = 0; f < TRAINING_CEILING; f++) {
    if (fires(f)) stack.receiveGarbage([{ width: mode.width, height: mode.height, isChain: false }]);
    cpu.update();
    stack.run();
    var sent = stack.takeDeliverableGarbage();
    for (var s = 0; s < sent.length; s++) sentRecords.push({ width: sent[s].width, height: sent[s].height, isChain: sent[s].isChain });
    stack.drainEvents();
    if (stack.gameOver) break;
  }
  return { label: modeName, framesAlive: f, died: stack.gameOver, sentRecords: sentRecords };
}

// ---- Endless: the real 12-file benchmark ----
var TRAINING_DIR = '/home/user/briankeegan/panel-game/client/assets/default_data/training';
var ENDLESS_MAX_FRAMES = 36000; // 10 simulated minutes per file

function runEndlessFile(filePath) {
  var raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  var schedule = attackSchedule.buildEventSchedule(raw, PanelEngine.GARBAGE_FLIGHT);
  var made = makeCpu();
  var stack = made.stack, cpu = made.cpu;
  var sentRecords = [], f;
  for (f = 0; f < ENDLESS_MAX_FRAMES; f++) {
    var fired = attackSchedule.eventsAt(schedule, f);
    for (var i = 0; i < fired.length; i++) stack.receiveGarbage([{ width: fired[i].width, height: fired[i].height, isChain: fired[i].isChain }]);
    cpu.update();
    stack.run();
    var sent = stack.takeDeliverableGarbage();
    for (var s = 0; s < sent.length; s++) sentRecords.push({ width: sent[s].width, height: sent[s].height, isChain: sent[s].isChain });
    stack.drainEvents();
    if (stack.gameOver) break;
  }
  return { framesAlive: f, sentRecords: sentRecords };
}

function runEndless() {
  var files = fs.readdirSync(TRAINING_DIR).filter(function (f) { return /^challenge-8-\d+\.json$/.test(f); }).sort();
  var totalFrames = 0, allSent = [];
  files.forEach(function (fname) {
    var r = runEndlessFile(path.join(TRAINING_DIR, fname));
    totalFrames += r.framesAlive;
    allSent = allSent.concat(r.sentRecords);
  });
  return { label: 'endless (avg of ' + files.length + ' real files)', framesAlive: Math.round(totalFrames / files.length), sentRecords: allSent, fileCount: files.length };
}

// ---- Run all four, print one combined report ----
console.log('Config: ' + cfgArg + '  stackLevel=' + stackLevel + '  seed=' + seed);
console.log('');

['comboStorm', 'factory', 'bigBlocks'].forEach(function (mode) {
  var r = runTrainingMode(mode);
  report.printSummaryToStdout(mode + (r.died ? '' : ' (still going at ceiling)'), r.framesAlive, r.sentRecords);
});

var endless = runEndless();
report.printSummaryToStdout(endless.label + ' -- avg frames across files', endless.framesAlive, endless.sentRecords);
