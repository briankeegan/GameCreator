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

  var cascadeFor = null, clearedBetween = null;

  function garbageCells(grid, W, H) {
    var n = 0;
    for (var r = 1; r <= H; r++) {
      for (var c = 1; c <= W; c++) if (grid[r] && grid[r][c] === -2) n++;
    }
    return n;
  }

  // Ranks every legal swap by the evaluator and returns the best move, or
  // null when there is nothing to rank. Shared by the building and
  // defensive seams so there is ONE definition of "score a candidate swap".
  function bestSwapBy(cpu, board, weights) {
    var swaps = board.legalSwaps ? board.legalSwaps() : [];
    var best = null, bestScore = null;
    for (var i = 0; i < swaps.length; i++) {
      var r = swaps[i][0], c = swaps[i][1];
      var trial = board.clone();
      trial.swap(r, c);
      // Resolve before scoring, exactly as the shipped search does: a
      // feature must see the board the move LEAVES, cascade included, not
      // the instant after the swap. Scoring the unresolved board would
      // credit a move with panels that are about to vanish.
      var res = trial.resolve ? trial.resolve() : {};
      var input = inputMod.fromStack(cpu.stack, trial, {
        chainLength: res.chainLength || 0,
        comboSizes: res.comboSizes || [],
        garbage: res.garbage || []
      }, cascadeFor(cpu), clearedBetween(cpu, trial));
      var score = evaluator.evaluate(input, weights).score;
      if (bestScore === null || score > bestScore) { bestScore = score; best = [r, c]; }
    }
    return best;
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

    // Hoisted out of _evaluate so the building and defensive seams can use
    // the same two derivations, rather than each growing its own copy.
    cascadeFor = function (cpu) {
      if (typeof cpu._cascadePrediction !== 'function') return null;
      var clock = cpu.stack ? cpu.stack.clock : 0;
      if (cpu.__panelEvalCascadeAt !== clock) {
        cpu.__panelEvalCascadeAt = clock;
        try { cpu.__panelEvalCascade = cpu._cascadePrediction(); }
        catch (e) { cpu.__panelEvalCascade = null; }
      }
      return cpu.__panelEvalCascade;
    };
    clearedBetween = function (cpu, board) {
      if (!cpu.stack || !board || !board.grid) return 0;
      var W = board.width, H = board.height, live = 0, r, c, p;
      for (r = 1; r <= H; r++) {
        for (c = 1; c <= W; c++) {
          p = cpu.stack.panelAt(r, c);
          if (p && p.isGarbage) live++;
        }
      }
      return Math.max(0, live - garbageCells(board.grid, W, H));
    };

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

    // ---- THE BUILDING DECISION ----
    //
    // _raiseOrBuild is 13% of decisions and, before this, ranked every
    // legal swap by one hand-written `boardPotential(trial) - base` while
    // never calling _evaluate. It is the move made when nothing is urgent —
    // the BUILDING move — and therefore the only place the density
    // features (links, roughness, edgePenalty, matchPotential,
    // colourScarcity, colourVariance) can possibly act. With the evaluator
    // absent from it, weighting any of them changed zero moves out of 143.
    //
    // Only the CHOICE OF SWAP is re-ranked. The shipped function still
    // decides WHETHER a swap is worth making at all, and whether to raise
    // or hold when it is not — so its verdict is asked for first and
    // returned untouched unless it was a swap. Taking that decision too
    // would mean a second copy of a live rule sitting in a file that
    // cannot see it change.
    var originalRaiseOrBuild = SearchCpu.prototype._raiseOrBuild;
    SearchCpu.prototype._raiseOrBuild = function (board) {
      var shipped = originalRaiseOrBuild.call(this, board);
      if (!shipped || shipped.kind !== 'swap') return shipped;
      var best = bestSwapBy(this, board, weights);
      return best ? { kind: 'swap', move: best } : shipped;
    };
    SearchCpu.prototype._raiseOrBuild.__panelEvalAttached = true;

    return function detach() {
      SearchCpu.prototype._evaluate = original;
      SearchCpu.prototype._raiseOrBuild = originalRaiseOrBuild;
    };
  }

  return { attach: attach, UNFED_BY_THIS_SEAM: UNFED_BY_THIS_SEAM };
}));
