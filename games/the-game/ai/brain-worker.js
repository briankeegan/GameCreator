// The bot's brain, off the page's thread: PuyoCpu.Mind, a PuyoCpu of its own
// loaded from the same files as the page's, deciding on the boards the page
// sends (see ai/brain.js).
importScripts('../panel-rules.js', '../panel-engine.js', '../panel-cpu.js',
              'eval/features.js', 'eval/registry.js', 'eval/input.js', 'eval/travel.js', 'eval/evaluator.js',
              'eval/engineboard.js', 'eval/modes.js', 'eval/faststack.js', 'eval/puyocpu.js', 'trained-weights.js');

var mind = null, ready = null, queued = [];

onmessage = function (e) {
  var m = e.data;
  if (m.type === 'init') {
    var opts = m.opts, P = self.PanelEval.PuyoCpu;
    mind = new P.Mind(opts);
    // Its search threads have to be running before it may wait on them.
    ready = opts.threads > 1 ? P.warmPool(opts.threads).then(function (n) { if (!n) opts.threads = 0; }) : Promise.resolve();
    return;
  }
  if (m.type !== 'decide') return;
  queued.push(m);
  ready.then(function () { while (queued.length) decide(queued.shift()); });
};

function decide(m) {
  var t0 = performance.now(), d;
  try { d = mind.think(m); }
  catch (err) { postMessage({ type: 'decision', id: m.id, error: String(err && err.stack || err) }); return; }
  postMessage({ type: 'decision', id: m.id, decision: d, ms: performance.now() - t0 });
}
