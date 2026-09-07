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
// FEEDING THE TWO THAT _evaluate's SIGNATURE CANNOT REACH.
//
// _evaluate(board, cumGarbage, cumChain, cumCombo) carries no cascade
// prediction and no per-candidate cleared count, so latentChain and
// garbageCleared had nothing to read and attach() refused a weight on
// them rather than let them contribute a silent zero.
//
// Both are recoverable from `this` at call time without touching
// panel-cpu.js, which is the point of doing it here:
//
//   - the cascade prediction is a method on the SearchCpu itself
//     (_cascadePrediction), computing exactly the chain marks the feature
//     wants and then discarding them. It is called once per evaluation and
//     memoised per frame, because the prediction depends on the live
//     Stack's in-flight panels, not on the candidate board — recomputing it
//     for every candidate would be the same answer at a few hundred times
//     the cost.
//   - garbage cleared is the difference between the garbage on the live
//     board and the garbage on the candidate: the candidate has already
//     been resolved, so anything missing from it was cleared by the move.
//     Counting it here rather than plumbing a new argument through the
//     search keeps the shipped file untouched.
//
// The refusal list is therefore empty. It stays in the code because the
// NEXT feature that outruns this signature should be refused the same way
// — loudly, at attach time — rather than quietly reading zero.
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
  var UNFED_BY_THIS_SEAM = {};

  function garbageCells(grid, W, H) {
    var n = 0;
    for (var r = 1; r <= H; r++) {
      for (var c = 1; c <= W; c++) if (grid[r] && grid[r][c] === -2) n++;
    }
    return n;
  }

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
      // The cascade prediction is a property of the LIVE stack this frame,
      // not of the candidate being scored, so it is computed once and
      // reused. Keyed on the stack's own clock: a new frame invalidates it,
      // and nothing else can.
      var cascade = null;
      if (typeof this._cascadePrediction === 'function') {
        var clock = this.stack ? this.stack.clock : 0;
        if (this.__panelEvalCascadeAt !== clock) {
          this.__panelEvalCascadeAt = clock;
          try { this.__panelEvalCascade = this._cascadePrediction(); }
          catch (e) { this.__panelEvalCascade = null; }
        }
        cascade = this.__panelEvalCascade;
      }

      // Cleared = what the live board holds minus what the candidate does.
      // The candidate has already been resolved, so garbage missing from
      // it was cleared by this move. Never negative: garbage ARRIVING is
      // incomingGarbage's business, not this feature's.
      var clearedCount = 0;
      if (this.stack && board && board.grid) {
        var W = board.width, H = board.height, live = 0, r, c, p;
        for (r = 1; r <= H; r++) {
          for (c = 1; c <= W; c++) {
            p = this.stack.panelAt(r, c);
            if (p && p.isGarbage) live++;
          }
        }
        clearedCount = Math.max(0, live - garbageCells(board.grid, W, H));
      }

      var input = inputMod.fromStack(this.stack, board, {
        chainLength: cumChain,
        comboSizes: cumCombo ? [cumCombo] : [],
        garbage: cumGarbage ? [[cumGarbage, 1]] : []
      }, cascade, clearedCount);
      return evaluator.evaluate(input, weights).score;
    };
    SearchCpu.prototype._evaluate.__panelEvalAttached = true;

    return function detach() { SearchCpu.prototype._evaluate = original; };
  }

  return { attach: attach, UNFED_BY_THIS_SEAM: UNFED_BY_THIS_SEAM };
}));
