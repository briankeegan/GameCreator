// TRAINED WEIGHTS — GENERATED, DO NOT EDIT BY HAND.
//
//   node ai/eval/export_weights.js ai/eval/trained.replace.l10-puyo-puyo18-s11.0914-020835.g00274.json
//
// Found by the cross-entropy search in ai/eval/train.js, which stopped
// itself when the numbers stopped moving, not on a generation budget.
// elite of generation 274, by training fitness.
//
// Held out (seeds never trained on), against the game's previous AI:
//   learned 3495   previous 612   +471%
//
// Features absent from this list were searched and left at zero, or were
// added after this snapshot; evaluate() skips a zero weight, so either way
// they cost nothing. check_shipped_weights.mjs fails the build if this
// file stops matching the snapshot named above.
(function (root) {
  "use strict";
  root.PanelEval = root.PanelEval || {};
  root.PanelEval.trained = {
    source: "trained.replace.l10-puyo-puyo18-s11.0914-020835.g00274.json",
    heldOut: 3495,
    switches: {"density":false,"rise":false,"depth":1,"beam":6},
    weights: {
      matchPotential: 277,
      chainPotential: 169,
      comboPotential: 167,
      staircase: 60,
      staircaseReady: 40,
      flatTop: 35,
      links: 11,
      colourVariance: 289,
      edgePenalty: 69,
      garbageOnBoard: 240,
      maxHeight: 97,
      roughness: 42,
      garbageAdjacency: 62,
      colourScarcity: 76,
      scoreEarned: 79,
      stopTimeEarned: 121,
      brokeGarbage: 192
    }
  };
}(typeof window !== "undefined" ? window : globalThis));
