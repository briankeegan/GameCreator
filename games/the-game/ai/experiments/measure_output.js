// How much garbage can the STRONGEST buildable opponent actually throw?
// Plays a SearchCpu on its own undisturbed board (no incoming pressure) and
// sums real outgoing garbage cells (Stack.takeDeliverableGarbage) over time.
// This is the number that answers "is a synthetic stress-test rate even
// realistic" — see games/the-game/panel-cpu.js's runwayHeight comment and
// the session that added it: "heavy" (4 cells/sec) and "relentless" turned
// out to be 6-11x faster than anything a real opponent, even fully-unscaled
// nightmare-tier, can sustain (measured: nightmare ~0.37-0.65 cells/sec
// across 5 seeds, diamond ~0.42-0.51). A one-sided firehose test at a rate
// no real opponent could ever produce answers a different question than
// "is this AI unbeatable in an actual duel" — this script is how to check
// which question a given rate is actually asking.
//
// Usage: node measure_output.js <difficulty> <maxFrames> <seed>
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = global.PanelEngine, PanelCpu = global.PanelCpu;

function garbageCells(pieces) {
  var n = 0;
  for (var i = 0; i < pieces.length; i++) n += pieces[i].width * pieces[i].height;
  return n;
}

var difficulty = process.argv[2] || 'nightmare';
var maxFrames = parseInt(process.argv[3] || '18000', 10); // 5 min default
var seed = parseInt(process.argv[4] || '1', 10);

var stack = new PanelEngine.Stack({ level: 3, seed: seed, countdown: false });
var cpu = new PanelCpu.SearchCpu(stack, { difficulty: difficulty, seed: seed + 55 });

var totalSent = 0, f;
for (f = 0; f < maxFrames; f++) {
  cpu.update();
  stack.run();
  var sent = stack.takeDeliverableGarbage();
  totalSent += garbageCells(sent);
  if (stack.gameOver) break;
}
var seconds = f / 60;
console.log(JSON.stringify({
  difficulty: difficulty, seed: seed, framesAlive: f, secondsAlive: +seconds.toFixed(2),
  totalGarbageSent: totalSent, cellsPerSecond: +(totalSent / seconds).toFixed(3),
  gameOver: stack.gameOver
}));
