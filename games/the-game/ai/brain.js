// The page side of the bot's brain (ai/brain-worker.js). A PuyoCpu given a
// Brain walks and swaps on the page every frame and asks the worker for its
// decisions ahead of their frames, so the page never stops while the bot
// thinks (see REAL TIME in ai/eval/puyocpu.js). PuyoCpu.LocalBrain is the same
// thing on one thread, for Node.
(function (root) {
  var PanelEval = root.PanelEval = root.PanelEval || {};

  // The brain searches on threads of its own when the page is cross-origin
  // isolated (sw.js); every core but one, which the page keeps.
  function Brain(opts) {
    var self = this, o = {}, k;
    for (k in opts) o[k] = opts[k];
    o.threads = Brain.threads();
    this.threads = o.threads;
    this.worker = new Worker(Brain.URL);
    // Shared with the worker: the id of the request to stop thinking about.
    this.stop = typeof SharedArrayBuffer === 'function' && root.crossOriginIsolated ? new Int32Array(new SharedArrayBuffer(4)) : null;
    this.worker.postMessage({ type: 'init', opts: o, stop: this.stop && this.stop.buffer });
    this.worker.onmessage = function (e) { self._reply(e.data); };
    this.worker.onerror = function (e) { console.error('brain worker: ' + (e.message || e)); };
    this.pending = null;
    this.id = 0;
    this.pace = new PanelEval.PuyoCpu.Pace();
  }
  Brain.URL = 'ai/brain-worker.js';
  Brain.available = function () { return typeof Worker === 'function'; };
  Brain.threads = function () {
    if (!root.crossOriginIsolated || typeof SharedArrayBuffer !== 'function') return 0;
    var n = (root.navigator && root.navigator.hardwareConcurrency) || 1;
    return n - 1 > 1 ? n - 1 : 0;
  };

  Brain.prototype.request = function (bot, point, acted) {
    var m = PanelEval.PuyoCpu.message(bot, point, acted), transfer = [m.enc.buf.buffer];
    if (m.opp) transfer.push(m.opp.buf.buffer);
    var p = { id: ++this.id, at: point.at, point: point, decision: null, bot: bot, sentAt: bot.stack.clock };
    m.type = 'decide';
    m.id = p.id;
    this.pending = p;
    this.worker.postMessage(m, transfer);
    return p;
  };

  // An answer that can no longer be played: the worker stops on it (when it
  // can share memory with the page) and the reply, if one comes, is ignored.
  Brain.prototype.cancel = function (p) {
    if (this.stop) Atomics.store(this.stop, 0, p.id);
    if (this.pending === p) this.pending = null;
  };

  // How long it took is counted in game frames, the unit the bot waits in.
  Brain.prototype._reply = function (m) {
    if (m.error) { console.error('brain: ' + m.error); return; }
    if (m.aborted) return;
    var p = this.pending;
    if (!p || p.id !== m.id) return;
    this.pace.took(p.bot.stack.clock - p.sentAt);
    p.decision = m.decision;
  };

  Brain.prototype.lead = function () { return this.pace.lead(); };
  Brain.prototype.close = function () { this.worker.terminate(); };

  PanelEval.Brain = Brain;
}(this));
