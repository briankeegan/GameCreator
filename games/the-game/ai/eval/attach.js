// THE SEAM. Plugs this evaluator into the shipped SearchCpu WITHOUT
// editing panel-cpu.js.
//
// panel-cpu.js is a live, actively-changing file, and it already carries
// its own tuned scoring that we need to keep as the A/B baseline — so the
// wrong way to do this is to go and edit _evaluate. attach() replaces the
// method on the prototype at runtime and hands back a detach function, so
// a benchmark can run the same process both ways and compare like with
// like.
//
//   var detach = attach(SearchCpu, { maxHeight: 60 });
//   ... run the benchmark ...
//   detach();   // back to the shipped scoring, exactly
//
// The weights are VALIDATED AT ATTACH TIME, not on first use. A typo'd or
// unimplemented feature key would otherwise throw thousands of positions
// into a benchmark run, or — worse, if the guard were softer — score
// nothing and report a clean null result.
//
// WHAT THIS CANNOT DO YET, stated plainly rather than discovered later:
// _evaluate's signature is (board, cumGarbage, cumChain, cumCombo), which
// carries no cascade prediction and no per-candidate garbageCleared. Those
// two inputs need a richer call site, so the features that depend on them
// (latentChain, garbageCleared) will read as absent under this adapter
// until that call site exists. attach() therefore REFUSES a non-zero
// weight on a feature it cannot feed, for the same reason evaluator.js
// refuses one on a feature nobody has written: a silently-zero term is
// worse than a failed run.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./evaluator.js'), require('./input.js'));
  } else {
    root.PanelEval = root.PanelEval || {};
    root.PanelEval.attach = factory(root.PanelEval.evaluator, root.PanelEval.input).attach;
  }
}(this, function (evaluator, inputMod) {
  'use strict';

  // Features this adapter's call site physically cannot supply. Keep this
  // list honest — shrinking it is a real change to the seam, not a config
  // tweak.
  var UNFED_BY_THIS_SEAM = {
    latentChain: '_evaluate receives no cascade prediction, so chainMarks is always null here',
    garbageCleared: '_evaluate receives no per-candidate cleared count'
  };

  function attach(SearchCpu, weights) {
    weights = weights || {};
    evaluator.validate(weights);
    for (var key in UNFED_BY_THIS_SEAM) {
      if (weights[key]) {
        throw new Error('feature "' + key + '" cannot be fed through this seam: ' +
                        UNFED_BY_THIS_SEAM[key] + '. Weighting it would contribute a ' +
                        'silent zero.');
      }
    }

    var original = SearchCpu.prototype._evaluate;
    SearchCpu.prototype._evaluate = function (board, cumGarbage, cumChain, cumCombo) {
      var input = inputMod.fromStack(this.stack, board, {
        chainLength: cumChain,
        comboSizes: cumCombo ? [cumCombo] : [],
        garbage: cumGarbage ? [[cumGarbage, 1]] : []
      }, null, 0);
      return evaluator.evaluate(input, weights).score;
    };
    SearchCpu.prototype._evaluate.__panelEvalAttached = true;

    return function detach() { SearchCpu.prototype._evaluate = original; };
  }

  return { attach: attach, UNFED_BY_THIS_SEAM: UNFED_BY_THIS_SEAM };
}));
