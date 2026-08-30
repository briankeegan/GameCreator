// THE standard test suite: one config, every benchmark type this
// directory has, every level that matters, one combined report. Built
// because running each harness by hand, one at a time, isn't the
// standard the user wants -- this is: one command, everything.
//
// LEVEL IS NOT OPTIONAL. Every fix shipped this session was gated by
// level (dangerHeightFrac, rescueBranchCap, depth, raiseFillFrac all
// behave differently at level 3 vs 5/8/10 -- see FINDINGS.md) precisely
// because a number measured at one level says nothing about the others.
// An earlier version of this report printed stackLevel once in a header
// line and then silently dropped it from every section below, which is
// exactly the kind of thing that gets scrolled past. Every section now
// carries its own level in the label, and the default run covers all
// four tiers this session's fixes were actually gated against, not just
// one.
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
// Usage: node full_report.js [difficulty|cfgJSON] [levels] [seed] [endlessMaxFrames] [categories]
//   levels: comma-separated stack levels, default "3,5,8,10" (the four
//   tiers every gated fix this session was measured against). Pass a
//   single number for just one level, e.g. "10".
//   endlessMaxFrames: per-file cap for the "endless" real-benchmark
//   category, default 36000 (10 simulated minutes). A full 4-level run
//   at the default cap is impractically slow to run interactively (the
//   AI is strong enough that most real files run to the cap rather than
//   dying, and this is a single-process, unparallelized tool) -- pass a
//   smaller cap (e.g. 15000, ~4 simulated minutes) for a practical
//   interactive run; the comboStorm/factory/bigBlocks drills are
//   unaffected (they die fast by design, see TRAINING_CEILING below).
//   categories: comma-separated subset of comboStorm,factory,bigBlocks,
//   endless, default all four. THIS is the guardrail: when told to
//   focus on one level/one category, run e.g.
//   `node full_report.js nightmare 10 1 15000 bigBlocks` -- scoped,
//   repeatable, no ad-hoc scripts, and nothing outside the requested
//   scope gets touched or reported.
var path = require('path');
var fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var report = require('./report.js');
var attackSchedule = require('./attack_schedule.js');

var PanelEngine = global.PanelEngine;
var PanelCpu = global.PanelCpu;

var cfgArg = process.argv[2] || 'nightmare';
var levelsArg = process.argv[3] || '3,5,8,10';
var seed = parseInt(process.argv[4], 10) || 1;
var LEVELS = levelsArg.split(',').map(function (s) { return parseInt(s, 10); });
var ALL_CATEGORIES = ['comboStorm', 'factory', 'bigBlocks', 'endless'];
var categoriesArg = process.argv[6] || ALL_CATEGORIES.join(',');
var CATEGORIES = categoriesArg.split(',');

function makeCpu(stackLevel, extraOpts) {
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

function runTrainingMode(modeName, stackLevel) {
  var mode = TRAINING_MODES[modeName];
  var made = makeCpu(stackLevel);
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
var ENDLESS_MAX_FRAMES = parseInt(process.argv[5], 10) || 36000; // 10 simulated minutes per file, overridable

function runEndlessFile(filePath, stackLevel) {
  var raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  var schedule = attackSchedule.buildEventSchedule(raw, PanelEngine.GARBAGE_FLIGHT);
  var made = makeCpu(stackLevel);
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

function runEndless(stackLevel) {
  var files = fs.readdirSync(TRAINING_DIR).filter(function (f) { return /^challenge-8-\d+\.json$/.test(f); }).sort();
  var totalFrames = 0, allSent = [];
  files.forEach(function (fname) {
    var r = runEndlessFile(path.join(TRAINING_DIR, fname), stackLevel);
    totalFrames += r.framesAlive;
    allSent = allSent.concat(r.sentRecords);
  });
  return { label: 'endless (avg of ' + files.length + ' real files)', framesAlive: Math.round(totalFrames / files.length), sentRecords: allSent, fileCount: files.length };
}

// ---- Run only the requested categories, at every requested level ----
console.log('Config: ' + cfgArg + '  levels=' + LEVELS.join(',') + '  seed=' + seed + '  categories=' + CATEGORIES.join(','));
console.log('');

LEVELS.forEach(function (stackLevel) {
  console.log('#################### LEVEL ' + stackLevel + ' ####################');
  ['comboStorm', 'factory', 'bigBlocks'].forEach(function (mode) {
    if (CATEGORIES.indexOf(mode) === -1) return;
    var r = runTrainingMode(mode, stackLevel);
    report.printSummaryToStdout('L' + stackLevel + ' ' + mode + (r.died ? '' : ' (still going at ceiling)'), r.framesAlive, r.sentRecords);
  });

  if (CATEGORIES.indexOf('endless') !== -1) {
    var endless = runEndless(stackLevel);
    report.printSummaryToStdout('L' + stackLevel + ' ' + endless.label + ' -- avg frames across files', endless.framesAlive, endless.sentRecords);
  }
});
