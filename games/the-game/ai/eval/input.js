// THE EVALUATOR'S INPUT — the one snapshot every feature reads.
//
// This exists because the seam it replaces could not carry the questions we
// want to ask. panel-cpu.js's _evaluate(board, cumGarbage, cumChain,
// cumCombo) sees a settled grid and three running totals; half the features
// in registry.js are not reachable from that. Queued attacks live on
// stack.incoming, the death clock lives on stack.stopTime/health/shakeTime,
// and "will this landing continue the chain" needs the chain flags that
// SearchCpu._cascadePrediction already computes and then throws away.
//
// So the input is defined FIRST, as a plain object with no engine types in
// it, and the features are written against that. Two consequences worth
// having: a test can build one by hand in a few lines, and the evaluator
// can be run against a recorded position with no Stack in the process at
// all.
//
// SHAPE
//   board    { width, height, grid, blocks }
//              grid[row][col], rows 1..height, cols 1..width, exactly
//              LogicalBoard's encoding:
//                 0  empty
//                -1  busy (mid-animation: matched, hovering, falling, swapping)
//                -2  garbage
//                >0  a colour id
//              blocks { id: { cells: [[row,col],...] } } — garbage blocks,
//              needed because clearing propagates block to block, so a
//              cell's block membership decides how much one match removes.
//   displacement  0..15, the sub-row pixel offset of the rise. Real height
//              is maxHeight + displacement/16; a board one pixel from a new
//              row is not the same board as one that just gained a row.
//   chainMarks {"r:c": true} or null — cells that will SETTLE carrying the
//              chain flag. null means "not mid-cascade", which is different
//              from {} ("mid-cascade, nothing will land chaining").
//   earned   { chainLength, comboSizes: [n,...], garbageSent: [[w,h],...],
//              garbageCleared } — what the move being scored actually paid.
//              comboSizes is a LIST because one move can fire several
//              separate combos, and awardStopTime pays per combo size, not
//              on the total.
//   incoming [{ width, height }] — attacks that have arrived and are queued
//              but have not landed. Committed height the grid cannot show.
//   clock    { toppedOut, riseLock, preStopTime, stopTime, shakeTime,
//              health, maxHealth } — every term framesToDeath needs, and
//              nothing else.
//
// Everything is optional and defaulted, so a test builds only the part it
// is testing. A feature reading a field nobody supplied gets the neutral
// value, never undefined.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanelEval = root.PanelEval || {}, root.PanelEval.input = factory();
}(this, function () {
  'use strict';

  var EMPTY_CLOCK = {
    toppedOut: false, riseLock: false,
    preStopTime: 0, stopTime: 0, shakeTime: 0,
    health: 0, maxHealth: 0
  };

  var EMPTY_EARNED = { chainLength: 0, comboSizes: [], garbageSent: [], garbageCleared: 0 };

  // Fills in every field a feature may read. Deliberately shallow-copies
  // rather than mutating the caller's object: the search evaluates
  // thousands of candidate positions per move and must never find one
  // scored against another's leftovers.
  function normalize(raw) {
    raw = raw || {};
    var board = raw.board || {};
    var clock = raw.clock || {};
    var earned = raw.earned || {};
    return {
      board: {
        width: board.width || 0,
        height: board.height || 0,
        grid: board.grid || [],
        blocks: board.blocks || {}
      },
      displacement: raw.displacement || 0,
      chainMarks: raw.chainMarks === undefined ? null : raw.chainMarks,
      earned: {
        chainLength: earned.chainLength || 0,
        comboSizes: earned.comboSizes || EMPTY_EARNED.comboSizes,
        garbageSent: earned.garbageSent || EMPTY_EARNED.garbageSent,
        garbageCleared: earned.garbageCleared || 0
      },
      incoming: raw.incoming || [],
      clock: {
        toppedOut: !!clock.toppedOut,
        riseLock: !!clock.riseLock,
        preStopTime: clock.preStopTime || 0,
        stopTime: clock.stopTime || 0,
        shakeTime: clock.shakeTime || 0,
        health: clock.health || 0,
        maxHealth: clock.maxHealth || 0
      }
    };
  }

  // Builds an input from a live engine Stack plus the LogicalBoard the
  // search has already resolved for the candidate move. Kept here rather
  // than in panel-cpu.js so there is ONE definition of how engine state
  // maps into a feature input, and the shipped file needs no edit to use
  // it (see attach.js).
  //
  // `resolved` is what LogicalBoard.resolve() returned for this candidate:
  // { chainLength, comboSizes, garbage }. `cascade` is
  // SearchCpu._cascadePrediction()'s result, or null when not mid-cascade.
  function fromStack(stack, board, resolved, cascade, garbageCleared) {
    resolved = resolved || {};
    var incoming = [];
    if (stack && stack.incoming) {
      for (var i = 0; i < stack.incoming.length; i++) {
        incoming.push({ width: stack.incoming[i].width, height: stack.incoming[i].height });
      }
    }
    return normalize({
      board: board,
      displacement: stack ? stack.displacement : 0,
      chainMarks: cascade ? cascade.chainMarks : null,
      earned: {
        chainLength: resolved.chainLength || 0,
        comboSizes: resolved.comboSizes || [],
        garbageSent: resolved.garbage || [],
        garbageCleared: garbageCleared || 0
      },
      incoming: incoming,
      clock: stack ? {
        // wasToppedOut, not isToppedOut(): the engine's own health drain and
        // stop-time award both read the flag latched at the top of the
        // frame, so a feature reading the live predicate would disagree
        // with the rule it is trying to model.
        toppedOut: !!stack.wasToppedOut,
        riseLock: !!stack.riseLock,
        preStopTime: stack.preStopTime || 0,
        stopTime: stack.stopTime || 0,
        shakeTime: stack.shakeTime || 0,
        health: stack.health || 0,
        maxHealth: (stack.levelData && stack.levelData.maxHealth) || 0
      } : EMPTY_CLOCK
    });
  }

  return { normalize: normalize, fromStack: fromStack };
}));
