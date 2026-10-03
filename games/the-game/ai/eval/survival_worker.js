// A survival-search worker (see _prefetch and _svExpand in puyocpu.js), in
// Node or a browser. Given a search node and its move list, computes every
// step with the bot's own _lineStep and writes the results to its shared
// slot. Between an 'sv-begin' and an 'sv-end' it holds the boards of one
// survival search.
(function () {
  var node = typeof importScripts !== 'function', PuyoCpu, ctl = null, slot = null;
  if (node) {
    var path = require('path');
    require(path.join(__dirname, '..', '..', 'pa-engine.js'));
    require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
    PuyoCpu = require(path.join(__dirname, 'puyocpu.js'));
  } else {
    importScripts('../../panel-rules.js', '../../pa-generator.js', '../../pa-engine.js', '../../panel-cpu.js',
                  'features.js', 'registry.js', 'input.js', 'travel.js', 'evaluator.js',
                  'engineboard.js', 'modes.js', 'puyocpu.js');
    PuyoCpu = self.PanelEval.PuyoCpu;
  }
  function handle(m) {
    if (m.type === 'init') {
      ctl = new Int32Array(m.ctl); slot = PuyoCpu.slotViews(m.slot);
      if (!node) self.postMessage({ type: 'ready' });
      return;
    }
    var out, bufs = [], texts = [];
    if (typeof m.type === 'string' && m.type.indexOf('sv-') === 0) {
      try { out = PuyoCpu.svHandle(m, bufs, texts); }
      catch (err) { out = { error: String(err && err.stack || err) }; bufs = []; texts = []; console.error('survival worker: ' + out.error); }
      if (out) PuyoCpu.sendResult(ctl, slot, out, bufs, texts);
      return;
    }
    try { out = { id: m.id, res: PuyoCpu.runSteps(m, bufs, texts) }; }
    catch (err) { out = { id: m.id, error: String(err && err.stack || err) }; bufs = []; texts = []; }
    PuyoCpu.sendResult(ctl, slot, out, bufs, texts);
  }
  if (node) require('worker_threads').parentPort.on('message', handle);
  else self.onmessage = function (e) { handle(e.data); };
}());
