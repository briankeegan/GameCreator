// A PUYO BOT, BUILT THE WAY THE PUYO BOT IS BUILT.
//
// ../PUYO_REFERENCE.md, "how it plays": enumerate every legal move, score
// the BOARD each one leaves with a weighted sum of features, play the
// highest. That is the whole bot. meatfighter's has seven features, no
// chain logic, no danger mode, no lookahead past the pieces it can see —
// and it reaches score levels nothing hand-written did.
//
// WHY A NEW BRAIN INSTEAD OF MORE SEAMS IN SearchCpu.
//
// SearchCpu is a good bot and it is not this bot. It is a stack of
// independent decision systems — a beam search, a defensive tier, a
// pre-burst reserve, and TrueSurvivalSearch, which clones the real engine
// and plays futures forward — each gated on its own conditions, each with
// its own idea of what a good move is. The evaluator was attached to it
// through seams, and at level 3 that works: 100% of decisions consult it.
// At level 10 it does not. Measured over one game, 234 decisions:
//
//     _evaluate called 34 times          — 4% of decisions
//     TrueSurvivalSearch decided the rest
//
// Weights trained at level 10 against SearchCpu would therefore be weights
// for 4% of the game, and this repo's own wiring law — more than half of
// decisions must consult the evaluator, or the GA is fitting noise — would
// correctly reject them. The answer is not another seam into a system that
// already decides for itself. It is a bot whose ONLY decision procedure is
// the weighted sum, which is what the reference describes and what the
// weights are for.
//
// WHAT THIS DELIBERATELY DOES NOT HAVE, all of which SearchCpu does:
//   - a danger mode, or any branch on how full the board is;
//   - rollouts, or any simulation of the real engine;
//   - chain extension, garbage-clearing bonuses, stop-time reasoning;
//   - depth. It scores the board ONE move ahead and nothing further.
// Every one of those exists in SearchCpu because it was measured to help
// there. Adding them back one at a time would end at SearchCpu again and
// would never answer the question this exists to ask: how far does a
// learned static evaluation get on its own, at the level that matters?
//
// WHAT IT KEEPS, because these are the game rather than the strategy:
//   - the cursor walks (panel-cpu.js beginWalk/driveWalk), so a move on
//     the far side of the board costs real frames to reach;
//   - a reaction cooldown between decisions, so it plays at a human
//     cadence instead of re-deciding every frame;
//   - legality decided by the real Stack, never by the plan.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./evaluator.js'), require('./input.js'));
  } else {
    root.PanelEval = root.PanelEval || {};
    root.PanelEval.PuyoCpu = factory(root.PanelEval.evaluator, root.PanelEval.input);
  }
}(this, function (evaluator, inputMod) {
  'use strict';

  function PuyoCpu(stack, opts) {
    opts = opts || {};
    var PanelCpu = (typeof window !== 'undefined' ? window : globalThis).PanelCpu;
    this.stack = stack;
    this.weights = opts.weights || {};
    // Borrowed rather than reimplemented: the cursor walk and the board
    // snapshot are how the game works, not part of what is being tested,
    // and a second copy of either would drift from the first.
    this._beginWalk = PanelCpu.SearchCpu.prototype._beginWalk;
    this._driveWalk = PanelCpu.SearchCpu.prototype._driveWalk;
    this._nearestSwappable = PanelCpu.SearchCpu.prototype._nearestSwappable;
    this._snapshot = PanelCpu.SearchCpu.prototype._snapshot;
    this.cursorMoveFrames = opts.cursorMoveFrames || 4;
    // Same as SearchCpu's nightmare preset, so a comparison between the
    // two is about the SCORING and not about which one acts more often.
    // Every frame of it is real: the bot does nothing while it counts down.
    this.reaction = opts.reaction === undefined ? 12 : opts.reaction;
    this.cooldown = Math.floor(this.reaction / 2);
    this.raiseFrames = 0;
    this._walk = null;
    this._lastSwap = null;
    // Instrumentation, not decoration: the claim this brain exists to make
    // is that EVERY decision goes through the evaluator, and a counter is
    // how that stops being a claim.
    this.decisions = 0;
    this.evaluations = 0;
  }

  // Score the board a candidate LEAVES. Not the move — the board. That
  // distinction is the whole reference: "it never scores a move, it scores
  // the board the move results in", which is why a chain needs no special
  // case here. The chain has already happened in the board being looked at.
  PuyoCpu.prototype._score = function (board, resolved) {
    this.evaluations++;
    var input = inputMod.fromStack(this.stack, board, resolved, null, 0);
    return evaluator.evaluate(input, this.weights).score;
  };

  PuyoCpu.prototype._decide = function () {
    var board = this._snapshot();
    var swaps = board.legalSwaps();

    // HOLD is a candidate like any other, scored the same way. SearchCpu
    // decides between holding, raising and swapping with its own rules;
    // here the weights decide, because there is nowhere else for that
    // judgement to live — and putting a rule in would be putting back the
    // thing this brain exists to do without.
    var holdBoard = board.clone();
    var holdResolved = holdBoard.resolve();
    var best = { kind: 'hold' };
    var bestScore = this._score(holdBoard, holdResolved);

    for (var i = 0; i < swaps.length; i++) {
      var r = swaps[i][0], c = swaps[i][1];
      var trial = board.clone();
      trial.swap(r, c);
      var resolved = trial.resolve();
      var s = this._score(trial, resolved);
      // Strictly greater, so a tie leaves the incumbent standing rather
      // than handing the decision to whichever swap legalSwaps() happened
      // to list first — list order is not a preference.
      if (s > bestScore) { bestScore = s; best = { kind: 'swap', move: [r, c] }; }
    }
    return best;
  };

  PuyoCpu.prototype.update = function () {
    var stack = this.stack;
    if (stack.gameOver) return;

    var input = {};
    if (this.raiseFrames > 0) { this.raiseFrames--; input.raise = true; }

    // A committed move owns the frame — the cursor has to get there.
    if (this._walk) {
      this._driveWalk(input);
      stack.setInput(input);
      return;
    }
    stack.setInput(input);
    if (this.cooldown > 0) { this.cooldown--; return; }

    this.decisions++;
    var decision = this._decide();
    if (decision.kind === 'hold') {
      this.cooldown = this.reaction;
      return;
    }
    this._beginWalk(decision.move[0], decision.move[1], this.reaction);
    this._driveWalk(input);
    stack.setInput(input);
  };

  return PuyoCpu;
}));
