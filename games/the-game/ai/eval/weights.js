// DEFAULT WEIGHTS — every feature at zero.
//
// Zero is the honest starting point, not a placeholder to fill in later: a
// feature earns a weight by winning a measured comparison (see README.md's
// four steps), one at a time, so that every number in this file can be
// traced to the run that justified it. A block of plausible-looking
// starting values would make the first benchmark uninterpretable — no way
// to tell which of thirteen changes moved the result.
//
// Anything non-zero here MUST carry a comment naming the harness and the
// result that earned it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./registry.js'));
  else root.PanelEval = root.PanelEval || {}, root.PanelEval.weights = factory(root.PanelEval.registry);
}(this, function (registry) {
  'use strict';
  var zeros = {};
  for (var i = 0; i < registry.keys.length; i++) zeros[registry.keys[i]] = 0;
  return { ZERO: zeros };
}));
