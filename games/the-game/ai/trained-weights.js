// TRAINED WEIGHTS — GENERATED, DO NOT EDIT BY HAND.
//
//   node ai/eval/export_weights.js ai/eval/trained.pbt.pbt-norm-s120-s120.0919-012538.g03000.json
//
// Found by the cross-entropy search in ai/eval/train.js, which stopped
// itself when the numbers stopped moving, not on a generation budget.
// champion of 4 islands after 3000 updates.
//
// Held out (seeds never trained on), against the game's previous AI:
//   learned 1   previous 0   +Infinity%
//
// Features absent from this list were searched and left at zero, or were
// added after this snapshot; evaluate() skips a zero weight, so either way
// they cost nothing. check_shipped_weights.mjs fails the build if this
// file stops matching the snapshot named above.
(function (root) {
  "use strict";
  root.PanelEval = root.PanelEval || {};
  root.PanelEval.trained = {
    source: "trained.pbt.pbt-norm-s120-s120.0919-012538.g03000.json",
    heldOut: 1,
    switches: {"density":false,"rise":true,"depth":2,"beam":0},
    weights: {
      linksH: -21,
      linksV: 30,
      colourVariance: 147,
      edgePenalty: 75,
      garbageOnBoard: 14,
      maxHeight: 24,
      fillRatio: 144,
      garbageAdjacency: -35,
      garbageSent: -77,
      stopTimeEarned: 12
    }
  };
}(typeof window !== "undefined" ? window : globalThis));
