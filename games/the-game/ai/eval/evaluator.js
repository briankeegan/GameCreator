// THE EVALUATOR — weights times features, and a guard that makes a
// misconfigured run fail instead of quietly scoring nothing.
//
// evaluate(input, weights) -> { score, features, terms }
//
// It returns the BREAKDOWN, not just the total. That is the whole reason
// this is a module rather than a five-line sum: when the search picks a
// move nobody would have picked, the question is always "which term won?",
// and a bare number cannot answer it. `features` is the raw magnitude each
// one measured; `terms` is that times sign times weight — what actually
// competed.
//
// TWO GUARDS, both for failures this repo has already had:
//
//   1. A NON-ZERO WEIGHT ON AN UNIMPLEMENTED FEATURE THROWS. Weighting a
//      feature whose fn is null would silently contribute nothing, so a
//      config full of carefully tuned numbers would score every move
//      identically and look like "the features don't help". Declared but
//      unbuilt is a known state (registry.js); pretending otherwise is not.
//
//   2. AN UNKNOWN WEIGHT KEY THROWS. A typo'd key is the same failure
//      wearing a different hat — `roughnes: 40` tunes nothing, changes
//      nothing, and reports nothing.
//
// Both are cheap, and both fire at configuration time rather than after a
// benchmark has run for an hour.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./registry.js'), require('./input.js'));
  } else {
    root.PanelEval = root.PanelEval || {};
    // The whole module is published, not just evaluate(): attach.js asks for
    // PanelEval.evaluator and calls validate() on it. Exporting only the one
    // function left the browser path broken — every module here had only ever
    // been loaded through CommonJS, and the game is a no-bundler static site
    // that loads plain <script> tags, so the path that matters was the one
    // nothing exercised. Found by running the real game in a real browser.
    var mod = factory(root.PanelEval.registry, root.PanelEval.input);
    root.PanelEval.evaluator = mod;
    root.PanelEval.evaluate = mod.evaluate;
  }
}(this, function (registry, inputMod) {
  'use strict';

  function validate(weights) {
    for (var key in weights) {
      if (!weights.hasOwnProperty(key)) continue;
      var w = weights[key];
      if (!w) continue;                       // zero/absent weight: nothing to check
      var f = registry.byKey[key];
      if (!f) {
        throw new Error('unknown feature "' + key + '" in weights — known: ' +
                        registry.keys.join(', '));
      }
      if (typeof f.fn !== 'function') {
        throw new Error('feature "' + key + '" is declared but not implemented, so a ' +
                        'weight of ' + w + ' would silently do nothing. Implement it in ' +
                        'features.js and add its case to features.test.js first.');
      }
    }
  }

  // A feature is computed only when its weight is non-zero. That is not
  // just a speed choice: it means adding a feature to the registry cannot
  // change any existing result until somebody deliberately weights it, so
  // "this commit provably changes nothing" is checkable rather than
  // asserted.
  // DENSITY MODE: A COUNT THAT SHRINKS BECAUSE THE BOARD DID IS NOT A
  // JUDGEMENT ABOUT THE BOARD.
  //
  // Some features COUNT things that are made of panels — adjacent same-
  // colour pairs, panels against a side wall. Clearing removes panels, so
  // those counts fall whatever shape the board is left in, and the fall is
  // charged against the move as if the board had got worse. Measured over
  // three real level-10 games, on a swap clearing 7+ panels:
  //
  //     links          -4.66   (-0.639 per panel removed)
  //     garbageSent    +7.31   (+1.004 per panel removed)
  //
  // Near-identical per-panel slopes in opposite directions, so roughly a
  // third of the reward for a big clear was cancelled by arithmetic before
  // anything about the resulting board was weighed. roughness was NOT part
  // of this — it punishes small clears and is exactly 0.00 on large ones,
  // which is why it is left alone: it is measuring real shape.
  //
  // Dividing those counts by the panels they are counted over makes them
  // densities, so a board half the size can be exactly as tidy. Which
  // features are counts is declared in the registry (`perPanel`), not
  // decided here.
  //
  // OFF BY DEFAULT, like rise and depth: it rescales every affected
  // feature, so weights found without it stop meaning the same thing.
  function panelCount(input) {
    var board = input.board, n = 0, r, c;
    if (!board || !board.grid) return 0;
    for (r = 1; r <= board.height; r++) {
      for (c = 1; c <= board.width; c++) if (board.grid[r][c] > 0) n++;
    }
    return n;
  }

  function evaluate(raw, weights, opts) {
    weights = weights || {};
    validate(weights);
    var input = inputMod.normalize(raw);
    var density = !!(opts && opts.density);
    var panels = density ? panelCount(input) : 0;
    var features = {}, terms = {}, score = 0;
    for (var i = 0; i < registry.all.length; i++) {
      var f = registry.all[i];
      var w = weights[f.key];
      if (!w) continue;
      var v = f.fn(input);
      // An empty board has nothing to be a density OF; leave the raw count
      // (which is 0 for every perPanel feature anyway) rather than dividing
      // by zero and handing the search a NaN it would silently propagate.
      if (density && f.perPanel && panels > 0) v = v / panels;
      features[f.key] = v;
      var term = f.sign * w * v;
      terms[f.key] = term;
      score += term;
    }
    return { score: score, features: features, terms: terms };
  }

  return { evaluate: evaluate, validate: validate };
}));
