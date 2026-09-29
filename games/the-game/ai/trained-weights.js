// TRAINED WEIGHTS — GENERATED, DO NOT EDIT BY HAND.
//
//   node ai/eval/export_weights.js ai/eval/trained.pbt.pbt-r22-s322.0926-142336.g03120.json
//
// Found by population-based training in ai/eval/train_pbt.js:
// champion of 4 islands after 3120 updates.
//
// This snapshot carries no held-out comparison against the previous AI.
//
// Features absent from this list were searched and left at zero, or were
// added after this snapshot; evaluate() skips a zero weight, so either way
// they cost nothing. check_shipped_weights.mjs fails the build if this
// file stops matching the snapshot named above.
(function (root) {
  "use strict";
  root.PanelEval = root.PanelEval || {};
  root.PanelEval.trained = {
    source: "trained.pbt.pbt-r22-s322.0926-142336.g03120.json",
    heldOut: 0,
    switches: {"density":false,"rise":true,"depth":2,"beam":0,"allowRaise":true,"engine":true,"modes":true},
    weights: {
      linksH: 39,
      linksV: 80,
      chainLayers: 46,
      breakPairs: 61,
      colourVariance: 91,
      edgePenalty: 59,
      garbageOnBoard: 78,
      maxHeight: 81,
      material: 68,
      garbageAdjacency: 101,
      reachBreak: 34,
      reach4combo: 47,
      reach5combo: 79,
      reach6combo: 26,
      reach7combo: 75,
      reach8combo: 24,
      reach9combo: 5,
      reach10combo: 28,
      reach2chain: 120,
      reach3chain: 99,
      reach4chain: 34,
      reach5chain: 42,
      reach6chain: 64,
      reach7chain: 40,
      reach8chain: 11,
      pressure: 16,
      overkill: 85,
      chainLength: 47,
      stopTimeEarned: 39,
      brokeGarbage: 37,
      garbageCleared: 64,
      travelCost: -4
    }
  };
}(typeof window !== "undefined" ? window : globalThis));
