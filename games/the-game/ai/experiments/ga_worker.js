// Forked worker for train_ga.js: evaluates whatever genomes it's handed
// against the real L10 bigBlocks drill (ga_core.js) and reports fitness
// back over IPC. Exists purely for throughput -- each genome evaluation
// is independent, so the population is split across one worker per core
// instead of evaluated one at a time in the parent.
var gaCore = require('./ga_core.js');

process.on('message', function (msg) {
  if (msg.type !== 'evaluateBatch') return;
  var results = msg.genomes.map(function (genome) {
    return gaCore.evaluate(genome);
  });
  process.send({ type: 'batchResult', batchId: msg.batchId, results: results });
});
