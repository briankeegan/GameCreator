// Plays a REAL recorded human's raw per-frame controller input (decoded
// by replay_decode.js from a full PvP match replay -- richer than
// attack_file_harness.js's extracted attack timing, since it's the
// actual raw cursor/swap/raise stream, not just when garbage arrived)
// against the shipped Nightmare AI, garbage exchanged exactly like
// duel_harness.js (takeDeliverableGarbage -> receiveGarbage each frame).
//
// CAVEAT this harness cannot get around: panel-engine.js uses mulberry32
// (see its own comment) for determinism, not the real Lua engine's RNG,
// so seeding with the replay's real seed does NOT reproduce the actual
// recorded match's panel colors or outcome -- there is no way to verify
// "does this replay the real game exactly." What IS real: the human
// player's actual raw input rhythm (cursor movement timing, swap
// cadence, when they chose to raise), replayed frame-for-frame against
// a freshly (differently) colored board. That's a genuinely richer
// opponent-behavior source than an extracted attack schedule, just not
// a byte-exact replay of the original match.
//
// A recorded human's inputs are FIXED regardless of what the AI sends
// back -- same non-interactivity limitation attack_file_harness.js
// already has with its extracted schedules, not a new one.
//
// Usage: node real_match_harness.js <replayFile> [aiCfg] [side] [maxFrames]
//   side: "p1" (default) or "p2" -- which recorded player's inputs
//   drive the human-side Stack (the other player's inputs are unused).
var fs = require('fs');
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var report = require('./report.js');
var replayDecode = require('./replay_decode.js');

var PanelEngine = global.PanelEngine;
var PanelCpu = global.PanelCpu;

var filePath = process.argv[2];
var aiCfgArg = process.argv[3] || 'nightmare';
var side = process.argv[4] || 'p1';
var maxFramesArg = parseInt(process.argv[5], 10);

var raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
var replay = replayDecode.decodeReplay(raw);
var humanInputs = side === 'p2' ? replay.p2 : replay.p1;
var humanLevel = (side === 'p2' ? replay.p2Level : replay.p1Level) || 10;
var maxFrames = maxFramesArg || humanInputs.length;

// countdown left at its default (true) deliberately: the recorded input
// stream includes the real pre-match countdown (COUNTDOWN_START +
// COUNTDOWN_LENGTH = 188 frames, panel-engine.js), during which physics
// stays frozen in the real game. Passing countdown:false here made a
// harmless held-raise input recorded during that frozen window act as a
// REAL raise from frame 0 -- toppled the human stack at exactly frame
// 188, the countdown's own length, before this was caught.
var human = new PanelEngine.Stack({ level: humanLevel, seed: replay.seed });
var aiOpts = aiCfgArg[0] === '{' ? JSON.parse(aiCfgArg) : { difficulty: aiCfgArg };
aiOpts.seed = (replay.seed || 1) + 55;
var ai = new PanelEngine.Stack({ level: humanLevel, seed: (replay.seed || 1) + 1 });
var cpu = new PanelCpu.SearchCpu(ai, aiOpts);

var humanSentRecords = [], aiSentRecords = [];
var f;
for (f = 0; f < maxFrames; f++) {
  var frameInput = humanInputs[f] || { raise: false, swap: false, up: false, down: false, left: false, right: false };
  human.setInput(frameInput);
  cpu.update();
  human.run();
  ai.run();
  var fromHuman = human.takeDeliverableGarbage();
  for (var i = 0; i < fromHuman.length; i++) { humanSentRecords.push({ width: fromHuman[i].width, height: fromHuman[i].height, isChain: fromHuman[i].isChain }); }
  if (fromHuman.length) ai.receiveGarbage(fromHuman);
  var fromAi = ai.takeDeliverableGarbage();
  for (var j = 0; j < fromAi.length; j++) { aiSentRecords.push({ width: fromAi[j].width, height: fromAi[j].height, isChain: fromAi[j].isChain }); }
  if (fromAi.length) human.receiveGarbage(fromAi);
  human.drainEvents();
  ai.drainEvents();
  if (human.gameOver || ai.gameOver) break;
}

var result = human.gameOver && ai.gameOver ? 'draw' : ai.gameOver ? 'human' : human.gameOver ? 'ai' : 'timeout(ran out of recorded input)';

report.printSummary('human(' + side + ') seed=' + replay.seed, f, humanSentRecords);
report.printSummary('AI(' + aiCfgArg + ')', f, aiSentRecords);

console.log(JSON.stringify(Object.assign({
  file: path.basename(filePath), side: side, aiCfg: aiCfgArg,
  humanLevel: humanLevel, seed: replay.seed,
  recordedFrames: humanInputs.length, framesPlayed: f,
  winner: result, survivedMMSS: report.mmss(f),
  aiTopped: ai.gameOver, humanTopped: human.gameOver,
  humanSent: report.summarize(humanSentRecords).totalCells,
  aiSent: report.summarize(aiSentRecords).totalCells
}, {})));
