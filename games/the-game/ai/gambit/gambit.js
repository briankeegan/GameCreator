// GAMBIT'S LOADER: the only JavaScript of the C Gambit (PLAN.md). It loads gambit.wasm and hands it what it decides on.
var fs = require('fs'), path = require('path');

var OPS = { '>=': 1, '<=': 2, '==': 3, '!=': 4, '>': 5, '<': 6 };   // rules.c OP_*
// A test as the rules file writes it ("<=3", or a number: ==) as rules.c reads it: [op, n]. Undefined: not asked.
function testOf(t, what) {
  if (t === undefined || t === null) return [0, 0];
  if (typeof t === 'number') return [OPS['=='], t];
  var m = /^(>=|<=|==|!=|>|<)\s*(-?\d+)$/.exec(String(t).trim());
  if (!m) throw new Error('gambit: ' + what + ' test ' + JSON.stringify(t) + ' is not one rules.c reads');
  return [OPS[m[1]], +m[2]];
}
// An aim as rules.c reads it: combo, chain, send (each [op, n]) and break (-1 not asked, 0, 1). Every field meets() reads is here; an
// aim with any other is refused, so nothing in a list is dropped unseen.
var AIM_KEYS = { combo: 1, chain: 1, send: 1, break: 1 };
function aimWords(a) {
  Object.keys(a).forEach(function (k) { if (!AIM_KEYS[k]) throw new Error('gambit: an aim asks ' + k + ', which rules.c does not read'); });
  return [].concat(testOf(a.combo, 'combo'), testOf(a.chain, 'chain'), testOf(a.send, 'send'), [a.break === true ? 1 : a.break === false ? 0 : -1]);
}

// The exports of a gambit.wasm instance, bound: its io body and the calls that hand it what it decides on.
function bind(X) {
  function body(n) { return new Int32Array(X.memory.buffer, (X.nb_io_body() >>> 0), n); }
  return {
    X: X, body: body,
    // The mode's list (its aims, as the rules file has them), into rules.c.
    list: function (aims) {
      var w = [].concat.apply([], aims.map(aimWords)), b = body(w.length);
      for (var i = 0; i < w.length; i++) b[i] = w[i];
      if (X.gb_list(aims.length) !== aims.length) throw new Error('gambit: the list was refused (' + aims.length + ' aims)');
    }
  };
}
function load(file) {
  var inst = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(file || path.join(__dirname, 'gambit.wasm'))),
                                      { env: { abort_poll: function () { return 0; } } });
  return bind(inst.exports);
}

module.exports = { load: load, bind: bind, aimWords: aimWords };
