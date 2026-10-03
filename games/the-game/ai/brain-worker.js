// The bot's brain, off the page's thread: PuyoCpu.Mind, a PuyoCpu of its own
// loaded from the same files as the page's, deciding on the boards the page
// sends (see ai/brain.js).
importScripts('../panel-rules.js', '../panel-cpu.js', '../pa-generator.js', '../pa-engine.js', 'eval/native.js',
              'eval/features.js', 'eval/registry.js', 'eval/input.js', 'eval/travel.js', 'eval/evaluator.js',
              'eval/modes.js', 'eval/puyocpu.js', 'trained-weights.js');

var mind = null, ready = null, queued = [], current = 0;

onmessage = function (e) {
  var m = e.data;
  if (m.type === 'init') {
    var opts = m.opts, P = self.PanelEval.PuyoCpu;
    mind = new P.Mind(opts, null, !!m.quick);
    var stop = m.stop ? new Int32Array(m.stop) : null;
    if (stop) mind.abort = function () { return Atomics.load(stop, 0) === current; };
    // The search plays the server's rules on native/pa.c.
    ready = fetch('eval/native/pa.wasm').then(function (r) { return r.arrayBuffer(); })
      .then(function (b) { self.PanelEval.Native.server.init(new Uint8Array(b)); });
    return;
  }
  if (m.type !== 'decide') return;
  queued.push(m);
  ready.then(function () { while (queued.length) decide(queued.shift()); });
};

function decide(m) {
  var t0 = performance.now(), d, P = self.PanelEval.PuyoCpu;
  current = m.id;
  try { d = mind.think(m); }
  catch (err) {
    if (err === P.ABORTED) { postMessage({ type: 'decision', id: m.id, aborted: true }); return; }
    postMessage({ type: 'decision', id: m.id, error: String(err && err.stack || err) });
    return;
  }
  postMessage({ type: 'decision', id: m.id, decision: d, ms: performance.now() - t0 });
}
