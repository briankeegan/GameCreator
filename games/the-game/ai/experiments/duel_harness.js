// A REAL duel between two SearchCpu/Cpu configs: two Stacks, garbage
// exchanged exactly like duel.js does it (takeDeliverableGarbage ->
// receiveGarbage each frame), run until someone tops out.
//
// NOT the primary validation for "hardest/most survivable" — that's
// stress_harness.js against a sustained one-sided garbage stream
// (survival under non-stop heavy pressure, topped out, is the actual
// target). This is a secondary tool for a different question: given
// two specific configs, who wins a symmetric fight — useful for
// checking relative balance between two named presets/characters, not
// for tuning either one's survivability.
//
// Usage: node duel_harness.js <cfgA> <cfgB> <seed> [maxFrames]
//   cfg is either a difficulty name (diamond, nightmare, brutal, ...)
//   or a JSON object of SearchCpu opts, e.g. '{"difficulty":"nightmare","reaction":18}'
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var report = require('./report.js');

var PanelEngine = global.PanelEngine;
var PanelCpu = global.PanelCpu;

function makeCpu(stack, cfg, seed) {
  var opts = cfg[0] === '{' ? JSON.parse(cfg) : { difficulty: cfg };
  opts.seed = seed;
  var preset = PanelCpu.DIFFICULTIES[opts.difficulty] || {};
  var Ctor = preset.brain === "search" ? PanelCpu.SearchCpu : PanelCpu.Cpu;
  return new Ctor(stack, opts);
}

var cfgA = process.argv[2], cfgB = process.argv[3];
var seed = parseInt(process.argv[4], 10) || 1;
var maxFrames = parseInt(process.argv[5], 10) || 60 * 60 * 5;

var a = new PanelEngine.Stack({ level: 6, seed: seed, countdown: false });
var b = new PanelEngine.Stack({ level: 6, seed: seed + 1, countdown: false });
var cpuA = makeCpu(a, cfgA, seed + 100);
var cpuB = makeCpu(b, cfgB, seed + 200);

var sentRecordsA = [], sentRecordsB = [], chainA = 0, chainB = 0;
var f;
for (f = 0; f < maxFrames; f++) {
  cpuA.update(); cpuB.update();
  a.run(); b.run();
  var ga = a.takeDeliverableGarbage();
  for (var i = 0; i < ga.length; i++) sentRecordsA.push({ width: ga[i].width, height: ga[i].height, isChain: ga[i].isChain });
  if (ga.length) b.receiveGarbage(ga);
  var gb = b.takeDeliverableGarbage();
  for (var j = 0; j < gb.length; j++) sentRecordsB.push({ width: gb[j].width, height: gb[j].height, isChain: gb[j].isChain });
  if (gb.length) a.receiveGarbage(gb);
  var evs = a.drainEvents();
  for (var k = 0; k < evs.length; k++) if (evs[k].type === 'match' && evs[k].chainCounter > chainA) chainA = evs[k].chainCounter;
  evs = b.drainEvents();
  for (var m = 0; m < evs.length; m++) if (evs[m].type === 'match' && evs[m].chainCounter > chainB) chainB = evs[m].chainCounter;
  if (a.gameOver || b.gameOver) break;
}

var result = a.gameOver && b.gameOver ? 'draw' : a.gameOver ? 'B' : b.gameOver ? 'A' : 'timeout';
report.printSummary('A(' + cfgA + ') seed=' + seed, f, sentRecordsA);
report.printSummary('B(' + cfgB + ') seed=' + seed, f, sentRecordsB);

console.log(JSON.stringify({
  a: cfgA, b: cfgB, seed: seed, winner: result,
  frames: f, seconds: +(f / 60).toFixed(1), survivedMMSS: report.mmss(f),
  sentA: report.summarize(sentRecordsA).totalCells, sentB: report.summarize(sentRecordsB).totalCells,
  sentBreakdownA: report.summarize(sentRecordsA).byCat, sentBreakdownB: report.summarize(sentRecordsB).byCat,
  biggestChainA: chainA, biggestChainB: chainB
}));
