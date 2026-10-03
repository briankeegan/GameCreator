// The page side of the bot's brain (ai/brain-worker.js). A PuyoCpu given a
// Brain walks and swaps on the page every frame and asks the worker for its
// decisions ahead of their frames, so the page never stops while the bot
// thinks (see REAL TIME in ai/eval/puyocpu.js). PuyoCpu.LocalBrain is the same
// thing on one thread, for Node.
(function (root) {
  var PanelEval = root.PanelEval = root.PanelEval || {};

  // The brain searches on threads of its own when the page is cross-origin
  // isolated (sw.js): every core but two, one the page keeps and one the
  // quick side's. The quick side is a second worker deciding the same
  // boards on a small survival budget (PuyoCpu.Mind quick), whose answer is
  // played when the full one is late.
  function Brain(opts) {
    var self = this, o = {}, k;
    for (k in opts) o[k] = opts[k];
    o.threads = Brain.threads();
    // A question carrying the server's board (a bot on a PAEngine.view) is
    // searched on native/pa.c; any other on faststack.js, the engine on
    // numbers (faststack.test.js and GC_ENGINE_CHECK hold it to
    // panel-engine.js).
    o.fastEngine = true;
    this.threads = o.threads;
    // Shared with the workers: the id of the request to stop thinking about.
    this.stop = typeof SharedArrayBuffer === 'function' && root.crossOriginIsolated ? new Int32Array(new SharedArrayBuffer(4)) : null;
    var q = {};
    for (k in o) q[k] = o[k];
    q.threads = 0;
    this.worker = this._start(o, false);
    this.quickWorker = this._start(q, true);
    this.pending = null;
    this.id = 0;
    this.pace = new PanelEval.PuyoCpu.Pace();
    this.quickPace = new PanelEval.PuyoCpu.Pace();
  }
  Brain.prototype._start = function (o, quick) {
    var self = this, w = new Worker(Brain.URL);
    w.postMessage({ type: 'init', opts: o, quick: quick, stop: this.stop && this.stop.buffer });
    w.onmessage = function (e) { self._reply(e.data, quick); };
    w.onerror = function (e) { console.error('brain worker: ' + (e.message || e)); };
    return w;
  };
  Brain.URL = 'ai/brain-worker.js';
  Brain.available = function () { return typeof Worker === 'function'; };
  Brain.threads = function () {
    if (!root.crossOriginIsolated || typeof SharedArrayBuffer !== 'function') return 0;
    var n = (root.navigator && root.navigator.hardwareConcurrency) || 1;
    return n - 2 > 1 ? n - 2 : 0;
  };

  Brain.prototype.request = function (bot, point, acted) {
    var p = { id: ++this.id, at: point.at, point: point, decision: null, quick: null, bot: bot, sentAt: bot.stack.clock };
    this.pending = p;
    [this.worker, this.quickWorker].forEach(function (w) {
      var m = PanelEval.PuyoCpu.message(bot, point, acted), transfer = [m.enc.buf.buffer];
      if (m.opp) transfer.push(m.opp.buf.buffer);
      m.type = 'decide';
      m.id = p.id;
      w.postMessage(m, transfer);
    });
    return p;
  };

  // An answer that can no longer be played: the worker stops on it (when it
  // can share memory with the page) and the reply, if one comes, is ignored.
  Brain.prototype.cancel = function (p) {
    if (this.stop) Atomics.store(this.stop, 0, p.id);
    if (this.pending === p) this.pending = null;
  };

  // How long it took is counted in game frames, the unit the bot waits in.
  Brain.prototype._reply = function (m, quick) {
    if (m.error) { console.error('brain: ' + m.error); return; }
    if (m.aborted) return;
    var p = this.pending;
    if (!p || p.id !== m.id) return;
    (quick ? this.quickPace : this.pace).took(p.bot.stack.clock - p.sentAt);
    if (quick) p.quick = m.decision;
    else p.decision = m.decision;
  };

  Brain.prototype.lead = function () { return this.pace.lead(); };
  Brain.prototype.quickLead = function () { return this.quickPace.lead(); };
  Brain.prototype.close = function () { this.worker.terminate(); this.quickWorker.terminate(); };

  PanelEval.Brain = Brain;
}(this));
