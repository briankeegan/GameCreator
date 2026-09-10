// TRAINED WEIGHTS — GENERATED, DO NOT EDIT BY HAND.
//
//   node ai/eval/export_weights.js ai/eval/trained.replace.l10-puyo.0909-190108.g00360.json
//
// Found by the cross-entropy search in ai/eval/train.js, which stopped
// itself when the numbers stopped moving — ../ai/PUYO_REFERENCE.md's own
// rule, not a generation budget. elite of generation 360, by training fitness.
//
// Held out (seeds never trained on), against the game's previous AI:
//   learned 3397   previous 854   +298%
//
// Features absent from this list were searched and left at zero, or were
// added after this snapshot; evaluate() skips a zero weight, so either way
// they cost nothing. check_shipped_weights.mjs fails the build if this
// file stops matching the snapshot named above.
(function (root) {
  "use strict";
  root.PanelEval = root.PanelEval || {};
  root.PanelEval.trained = {
    source: "trained.replace.l10-puyo.0909-190108.g00360.json",
    heldOut: 3397,
    weights: {
      matchPotential: 229,
      chainPotential: 258,
      links: 2,
      colourVariance: 168,
      edgePenalty: 82,
      garbageOnBoard: 64,
      maxHeight: 136,
      fillRatio: 124,
      roughness: 294,
      garbageAdjacency: 21,
      colourScarcity: 281,
      garbageSent: 107,
      chainLength: 66,
      garbageCleared: 187,
      travelCost: 10
    }
  };
}(typeof window !== "undefined" ? window : globalThis));
