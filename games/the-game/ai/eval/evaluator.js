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
    root.PanelEval.evaluate = factory(root.PanelEval.registry, root.PanelEval.input).evaluate;
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
  function evaluate(raw, weights) {
    weights = weights || {};
    validate(weights);
    var input = inputMod.normalize(raw);
    var features = {}, terms = {}, score = 0;
    for (var i = 0; i < registry.all.length; i++) {
      var f = registry.all[i];
      var w = weights[f.key];
      if (!w) continue;
      var v = f.fn(input);
      features[f.key] = v;
      var term = f.sign * w * v;
      terms[f.key] = term;
      score += term;
    }
    return { score: score, features: features, terms: terms };
  }

  return { evaluate: evaluate, validate: validate };
}));
