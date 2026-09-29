// The bot's brain, off the page's thread: PuyoCpu.Mind, a PuyoCpu of its own
// loaded from the same files as the page's, deciding on the boards the page
// sends (see ai/brain.js).
importScripts('../panel-rules.js', '../panel-engine.js', '../panel-cpu.js',
              'eval/features.js', 'eval/registry.js', 'eval/input.js', 'eval/travel.js', 'eval/evaluator.js',
              'eval/engineboard.js', 'eval/modes.js', 'eval/puyocpu.js', 'trained-weights.js');

var mind = null;

onmessage = function (e) {
  var m = e.data;
  if (m.type === 'init') { mind = new self.PanelEval.PuyoCpu.Mind(m.opts); return; }
  if (m.type !== 'decide') return;
  var t0 = performance.now(), d = mind.think(m);
  postMessage({ type: 'decision', id: m.id, decision: d, ms: performance.now() - t0 });
};
