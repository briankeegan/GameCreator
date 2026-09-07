// THE FEATURES THEMSELVES — one pure function per feature, and nothing else.
//
// Each takes the evaluator input (see input.js for its exact shape) and
// returns a RAW, UNSIGNED magnitude: "how much of this thing is there",
// never "how good is this". Sign lives in the registry and weight lives in
// the config, so a feature never needs to know whether more of it is good —
// which means the same function can be re-signed or re-weighted without
// being rewritten, and a test can assert a count rather than a score.
//
// Rules for anything added here:
//   - PURE. Same input, same number, no reading the live Stack, no caching.
//   - Reads only `input`. Reaching for the engine is how the two
//     implementations in this repo drifted apart in the first place.
//   - Returns a finite number, or Infinity where that is the honest answer
//     (framesToDeath on a board that cannot die yet).
//
// Empty on purpose: features are added ONE AT A TIME, each with the test
// that proves it measures what the registry says it measures. See
// registry.js for the declared thirteen and the order of the three edits.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanelEval = root.PanelEval || {}, root.PanelEval.features = factory();
}(this, function () {
  'use strict';
  return {};
}));
