// THE THREE SEED SETS, DEFINED ONCE.
//
// Every number this trainer produces is a score on a set of seeds, and a
// score is only comparable to another score measured on the SAME set.
// That has gone wrong three times in one evening — a champion scored on the
// held-out seeds compared against rounds scored on the finals seeds; a
// champion scored on 8 finals seeds compared against rounds scored on 12;
// and before either, a champion crowned on a single game. Every one of them
// looked exactly like the search failing, and cost a restart to find.
//
// So the sets live here, in one file, and everything that needs them reads
// them from here. A second copy is how they drift apart again.
//
// EACH SET DOES ONE JOB, AND ONLY ONE:
//
//   TRAIN (1-40)      the GA's own seeds. One is drawn per generation and
//                     every genome in that generation plays it, so
//                     selection within a generation is a fair comparison;
//                     it rotates between generations so nothing can win by
//                     memorising a board.
//
//   FINALS (201-212)  used to CHOOSE — between the finalists at the end of
//                     a round, and between rounds when deciding whether a
//                     champion has been beaten. Nothing is trained on them
//                     and nothing is reported from them.
//
//   HOLDOUT (101-112) used to REPORT, and for nothing else. The moment a
//                     champion is selected on these, the number quoted for
//                     it is inflated by exactly that selection — measured at
//                     22% when it happened.
//
// WHY TWELVE, TWICE: `endless` picks its attack file from the seed and
// there are twelve files, so twelve consecutive seeds cover all twelve
// exactly once. Eight covered two thirds of them, which let a champion be
// chosen against a subset of the real opponents. Any change to these
// lengths should keep that property; bench.fidelity.test.js checks it for
// the held-out set.
//
// The three sets must not overlap, or a seed used to choose is also a seed
// used to report. Checked below rather than eyeballed.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanelEval = root.PanelEval || {}, root.PanelEval.seeds = factory();
}(this, function () {
  'use strict';

  var TRAIN = [];
  for (var i = 1; i <= 40; i++) TRAIN.push(i);
  var HOLDOUT = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112];
  var FINALS = [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212];

  // A file that exists to stop three sets being confused should not be able
  // to ship them overlapping.
  function overlap(a, b) {
    return a.filter(function (x) { return b.indexOf(x) >= 0; });
  }
  [['train/holdout', TRAIN, HOLDOUT], ['train/finals', TRAIN, FINALS],
   ['holdout/finals', HOLDOUT, FINALS]].forEach(function (pair) {
    var both = overlap(pair[1], pair[2]);
    if (both.length) {
      throw new Error('seed sets ' + pair[0] + ' overlap on ' + both.join(',') +
        ' — a seed used to choose would also be a seed used to report');
    }
  });

  return { TRAIN: TRAIN, HOLDOUT: HOLDOUT, FINALS: FINALS };
}));
