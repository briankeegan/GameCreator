// A survival-search worker thread (see _prefetch in puyocpu.js). Given one
// search node and its move list, computes every step with the bot's own
// _lineStep on a decoded copy of the node's board and returns the results
// encoded. Holds no state between tasks.
var wt = require('worker_threads'), path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PuyoCpu = require(path.join(__dirname, 'puyocpu.js'));
var flag = new Int32Array(wt.workerData.flag), port = wt.workerData.port;

function key(m, long) { return long ? 'long' : m === null ? 'hold' : m === 'raise' ? 'raise' : m[0] + ',' + m[1]; }

port.on('message', function (task) {
  var out;
  try {
    var bot = Object.create(PuyoCpu.prototype);
    bot.reaction = task.reaction;
    bot.cursorMoveFrames = task.cursorMoveFrames;
    bot._lineUntil = task.until || null;
    bot._restNeeded = task.rest;
    var st = PuyoCpu.decodeStack(task.enc);
    var n = bot._engineNode(st, task.t, task.hold, task.arrivals, task.fresh);
    var res = {}, transfer = [];
    for (var i = 0; i < task.moves.length; i++) {
      var m = task.moves[i], long = m === 'long';
      var r = long ? bot._lineStep(n, null, true) : bot._lineStep(n, m, false);
      var k = key(long ? null : m, long);
      if (!r) res[k] = null;
      else if (r.dead) res[k] = { dead: 1, t: r.t, parent: r.st === n.st };
      else {
        var e = PuyoCpu.encodeStack(r.st);
        transfer.push(e.buf.buffer);
        res[k] = { t: r.t, hold: r.hold, arrivals: r.arrivals, enc: e, pos: r.pos, carry: r.carry,
                   grid: r.b.grid, key: r.b.key, height: r.b.height, legal: r.b.legalSwaps() };
      }
    }
    out = { id: task.id, res: res };
    port.postMessage(out, transfer);
  } catch (err) {
    port.postMessage({ id: task.id, error: String(err && err.stack || err) });
  }
  Atomics.add(flag, 0, 1);
  Atomics.notify(flag, 0);
});
