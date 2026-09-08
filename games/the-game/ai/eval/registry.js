// THE FEATURE REGISTRY — the one list of what the evaluator can measure.
//
// Every feature this evaluator knows about is declared here, whether or not
// it is built yet. A declaration carries its sign, the group it belongs to,
// and a one-line statement of what it measures; `fn` stays null until the
// feature is actually implemented and tested.
//
// WHY DECLARE THE UNBUILT ONES. The alternative is a stub that returns 0,
// and a stub returning 0 is indistinguishable from a feature that computes
// correctly and finds nothing — which is the failure this whole directory
// exists to avoid. Declared-but-null means `evaluate` can REFUSE a non-zero
// weight on a feature nobody has written (see evaluator.js), so a config
// naming a feature that does not exist fails loudly instead of quietly
// scoring every move the same.
//
// Adding a feature is three edits, in this order:
//   1. implement it in features.js
//   2. point `fn` at it here
//   3. add its case to features.test.js — a hand-built board whose answer
//      is known by eye, asserting BOTH that it fires on the thing it is for
//      and that it stays quiet on the near-miss
// Skipping 3 is how a feature that measures the wrong thing gets tuned for
// weeks; the number still moves, so it still looks like it is working.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./features.js'));
  else root.PanelEval = root.PanelEval || {}, root.PanelEval.registry = factory(root.PanelEval.features);
}(this, function (F) {
  'use strict';

  // group: 'board'  — what the position looks like once the move settles
  //        'earned' — what this move just paid out
  //        'clock'  — how long until death
  //        'move'   — what this candidate costs to PLAY, not what it leaves
  var FEATURES = [
    { key: 'matchPotential',   group: 'board',  sign: +1, fn: null,
      what: 'Merged combos of 4+ reachable next move. A PLAIN 3 scores 0 — comboGarbage() sends nothing below 4 — but a 3 that extends a chain or touches garbage still counts.' },

    { key: 'latentChain',      group: 'board',  sign: +1, fn: null,
      what: 'Will this landing continue the chain: does a cell carrying the chain flag settle into a match. Forward-looking half of chainLength.' },

    { key: 'links',            group: 'board',  sign: +1, fn: null,
      what: 'Same-coloured panels orthogonally adjacent. meatfighter\'s single biggest term (25%) — the density that makes chains happen without any chain logic.' },

    { key: 'colourVariance',   group: 'board',  sign: -1, fn: null,
      what: 'Per colour, the mean position of its panels and the deviation from it. Low variance means that colour is gathered rather than scattered.' },

    { key: 'edgePenalty',      group: 'board',  sign: -1, fn: null,
      what: 'Panels in the side columns, which have three orthogonal neighbours instead of four and so link less.' },

    { key: 'garbageOnBoard',   group: 'board',  sign: -1, fn: null,
      what: 'Garbage cells present, on-screen weighted above off-screen.' },

    { key: 'incomingGarbage',  group: 'board',  sign: -1, fn: null,
      what: 'Attacks queued but not yet landed, by panel count. Committed height the board cannot see yet.' },

    { key: 'maxHeight',        group: 'board',  sign: -1, fn: null,
      what: 'Highest occupied row, plus displacement.' },

    { key: 'fillRatio',        group: 'board',  sign: -1, fn: null,
      what: 'Occupied over total. Overlaps maxHeight — first candidate to cut if it earns nothing.' },

    { key: 'roughness',        group: 'board',  sign: -1, fn: null,
      what: 'Sum of absolute height differences between adjacent columns.' },

    { key: 'garbageAdjacency', group: 'board',  sign: +1, fn: null,
      what: 'Matchable panels 4-way adjacent to eligible garbage. Garbage has no colour, so touching it is the ONLY way it ever clears.' },

    { key: 'colourScarcity',   group: 'board',  sign: -1, fn: null,
      what: 'Colours with fewer than 3 matchable panels left — a colour that can no longer form a match.' },

    { key: 'garbageSent',      group: 'earned', sign: +1, fn: null,
      what: 'Combo sends a set of 1-high blocks of varying width; a chain sends ONE full-width block that grows a row per link. Two different attacks.' },

    { key: 'chainLength',      group: 'earned', sign: +1, fn: null,
      what: 'Chain counter after the move. Backward-looking: what the chain ended up worth.' },

    { key: 'garbageCleared',   group: 'earned', sign: +1, fn: null,
      what: 'Garbage cells converted this move, including propagation into touching blocks.' },

    { key: 'travelCost',       group: 'move',   sign: -1, fn: null,
      what: 'Frames to bring the cursor from where it is to this candidate swap, per travel.js. The bot could always teleport (stack.touchSwap) so it never paid for distance; a person holds a direction and waits, and the second step costs 21 frames. Set by whichever seam knows the move; 0 when the move is unknown.' },

    { key: 'framesToDeath',    group: 'clock',  sign: +1, fn: null,
      what: 'toppedOut ? preStop + stop + shake + health : Infinity — and Infinity while riseLock holds, since health only drains inside (!riseLock && stopTime === 0). Replaces stop/health/shake as separate features: they do not sit beside each other, they PAUSE each other.' }
  ];

  var byKey = {};
  for (var i = 0; i < FEATURES.length; i++) {
    var f = FEATURES[i];
    if (byKey[f.key]) throw new Error('duplicate feature key: ' + f.key);
    f.fn = (F && F[f.key]) || null;
    byKey[f.key] = f;
  }

  return {
    all: FEATURES,
    byKey: byKey,
    keys: FEATURES.map(function (f) { return f.key; }),
    implemented: function () {
      return FEATURES.filter(function (f) { return typeof f.fn === 'function'; })
                     .map(function (f) { return f.key; });
    }
  };
}));
