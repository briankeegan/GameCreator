// TRAINED WEIGHTS — GENERATED, DO NOT EDIT BY HAND.
//
//   node ai/eval/export_weights.js ai/eval/trained.replace.l10-puyo-dens-s2.0911-212621.g00360.json
//
// Found by the cross-entropy search in ai/eval/train.js, which stopped
// itself when the numbers stopped moving — ../ai/PUYO_REFERENCE.md's own
// rule, not a generation budget. elite of generation 360, by training fitness.
//
// Held out (seeds never trained on), against the game's previous AI:
//   learned 2683   previous 679   +295%
//
// Features absent from this list were searched and left at zero, or were
// added after this snapshot; evaluate() skips a zero weight, so either way
// they cost nothing. check_shipped_weights.mjs fails the build if this
// file stops matching the snapshot named above.
(function (root) {
  "use strict";
  root.PanelEval = root.PanelEval || {};
  root.PanelEval.trained = {
    source: "trained.replace.l10-puyo-dens-s2.0911-212621.g00360.json",
    heldOut: 2683,
    switches: {"density":true,"rise":false,"depth":1,"beam":6},
    weights: {
      matchPotential: 75,
      chainPotential: 169,
      comboPotential: 85,
      staircase: 8,
      flatTop: 86,
      links: 144,
      colourVariance: 219,
      edgePenalty: 209,
      garbageOnBoard: 104,
      maxHeight: 108,
      fillRatio: 93,
      roughness: 47,
      garbageAdjacency: 27,
      colourScarcity: 54,
      garbageSent: 193,
      chainLength: 45,
      scoreEarned: 87,
      garbageCleared: 64,
      travelCost: 13
    }
  };
}(typeof window !== "undefined" ? window : globalThis));
