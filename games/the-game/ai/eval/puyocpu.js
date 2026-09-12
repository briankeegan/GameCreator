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
    module.exports = factory(require('./evaluator.js'), require('./input.js'), require('./travel.js'), require('./engineboard.js'));
  } else {
    root.PanelEval = root.PanelEval || {};
    root.PanelEval.PuyoCpu = factory(root.PanelEval.evaluator, root.PanelEval.input, root.PanelEval.travel, root.PanelEval.engineBoard);
  }
}(this, function (evaluator, inputMod, travel, engineBoard) {
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
    // LOOKAHEAD, OFF BY DEFAULT. depth 1 is the Tier 1 bot the shipped
    // weights were trained as and identity.golden.json records; anything
    // higher is opt-in per instance. beam bounds the cost — see _lookahead.
    this.depth = opts.depth || 1;
    this.beam = opts.beam || 6;
    // RISE-ADJUSTED SCORING, OFF BY DEFAULT — see _score. Opt-in for the
    // same reason lookahead is: turning it on produces a different bot, so
    // the weights trained without it stop describing what plays. Default
    // off keeps identity.golden.json and the shipped Nightmare bot exactly
    // as they are until weights trained WITH it exist to replace them.
    // THINK WITH THE ENGINE. Off by default because it is a different bot:
    // every trained weight set describes play under LogicalBoard, and this
    // changes what a candidate is worth.
    //
    // Why it existed: LogicalBoard and panel-engine.js disagreed, measurably —
    // the right panels clearing in ONE ROUND FEWER, so the bot priced a real
    // 3-chain as a 2-chain on exactly the deep-chain shapes it is supposed to
    // be learning to build.
    //
    // THAT IS FIXED. LogicalBoard now falls a row per tick, matches only what
    // has landed, and models the engine's chaining flag; measured identical to
    // the engine on 50,797 cases — every real in-play board times every legal
    // swap — in chain depth, panels cleared and final grid
    // (ai/eval/resolve_fidelity.js, gated at 100%). See the note above
    // LogicalBoard in panel-cpu.js for the three faults and why fixing only
    // the timing made it worse.
    //
    // This switch stays, for two reasons. 290 staged chip shapes still resolve
    // differently (positions play does not produce, but shapes the library
    // contains), and a seam that can run a candidate on the real Stack is how
    // the next divergence gets found instead of assumed. It is off by default
    // and costs 1.27ms against LogicalBoard's 0.017ms.
    //
    // Cost, measured: 1.27ms a candidate against LogicalBoard's 0.017ms. 30
    // candidates at depth 1 is 38ms of an 85ms budget, so depth 1 fits and
    // depth 2 (229ms) does not.
    this.engine = opts.engine === true;
    this._scratch = null;
    this.rise = opts.rise === true;
    // DENSITY SCORING, also off by default — see evaluator.js. Counts that
    // are made of panels (links, edgePenalty) become densities, so clearing
    // stops subtracting tidiness it never actually lost.
    this.density = opts.density === true;
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
  // THREE FEATURES WERE DEAD HERE AND NOTHING SAID SO.
  //
  // An audit weighted all 18 features and counted how often each was
  // non-zero over 2,185 evaluations of real level-10 games:
  //
  //     latentChain      0.0%     garbageCleared   0.0%
  //     travelCost       0.0%
  //
  // Not because the features are wrong — because this function fed them
  // nothing. It passed cascade=null, clearedCount=0, and never set
  // travelFrames at all. The GA had been assigning them real weight
  // (latentChain 282, travelCost 173, garbageCleared 107 in one champion),
  // so three of eighteen search dimensions were knobs attached to nothing.
  //
  // travelCost being dead was the worst of them: this bot WALKS its cursor,
  // so distance is a real cost in frames that it was blind to.
  // EVERY CANDIDATE RESOLVES THROUGH HERE, so there is one place the choice
  // of board is made. Three call sites used to resolve() directly — hold,
  // swap, and the lookahead child — and a switch that reached two of three
  // would be the same silent-drift bug this whole seam exists to close.
  //
  // The engine path MUTATES the candidate board to the settled state, because
  // every feature reads board.grid afterwards.
  PuyoCpu.prototype._resolveCandidate = function (board) {
    if (!this.engine) return board.resolve();
    if (!this._scratch) this._scratch = engineBoard.scratch(10);
    engineBoard.paint(this._scratch, board.grid, board.height, board.width);
    var out = engineBoard.settle(this._scratch, 900);
    var settled = engineBoard.readGrid(this._scratch, board.height, board.width);
    for (var r = 0; r <= board.height; r++) {
      for (var c = 1; c <= board.width; c++) board.grid[r][c] = settled[r][c];
    }
    return out;
  };

  PuyoCpu.prototype._score = function (board, resolved, move) {
    this.evaluations++;

    // What this move CLEARS: garbage on the live board minus garbage left
    // on the candidate. Never negative — garbage arriving is
    // incomingGarbage's business.
    var stack = this.stack, W = stack.constructor.WIDTH ||
        (typeof window !== 'undefined' ? window : globalThis).PanelEngine.WIDTH;
    var live = 0, r, c, p;
    for (r = 1; r <= board.height; r++) {
      for (c = 1; c <= board.width; c++) {
        p = stack.panelAt(r, c);
        if (p && p.isGarbage) live++;
      }
    }
    var left = 0;
    for (r = 1; r <= board.height; r++) {
      for (c = 1; c <= board.width; c++) if (board.grid[r][c] === -2) left++;
    }
    var cleared = Math.max(0, live - left);

    // What it costs to REACH, in frames, from wherever the cursor is now.
    // A hold moves nothing, so it costs nothing.
    var frames = 0;
    if (move) frames = travel.cost(stack.curRow, stack.curCol, move[0], move[1]);

    // No cascade prediction: latentChain was the only feature that read
    // chainMarks and it has been removed, so computing one every candidate
    // would be work nothing consumes.
    // SCORE THE BOARD A MOMENT LATER, NOT AT ITS UGLIEST INSTANT.
    //
    // Without this, a candidate is scored the frame its match finishes
    // popping: the hole is open, the cluster is spent, the colour is
    // scarce, and the panels that fill it back in never arrive because the
    // simulation stops there. Holding is scored on a board that never
    // moved. Measured over 570 real level-10 decisions with the shipped
    // weights, that asymmetry is worth:
    //
    //     panels cleared   mean score vs DOING NOTHING on the same board
    //          0                     -134
    //          3                     -181
    //        4-6                    -1133
    //         7+                    -1537
    //
    // Monotonic: the more it cleared, the worse it scored. The bot held
    // 52% of its decisions — 0 of them forced — including one where a
    // whole 3-chain was on the table and roughness alone out-voted the
    // 1819 points of garbage it would have sent.
    //
    // The stack rises whatever the bot does, so charging only the swap for
    // the gap it leaves is an artefact of where the simulation stops. Rise
    // every candidate by the same row and resolve again, and the cascade
    // that rise sets off is counted too — a clear that breaks, and breaks
    // again, is worth what it actually does.
    if (this.rise) {
      var after = board.clone().rise(this._incoming);
      var second = after.resolve();
      board = after;
      left = 0;
      for (r = 1; r <= board.height; r++) {
        for (c = 1; c <= board.width; c++) if (board.grid[r][c] === -2) left++;
      }
      cleared = Math.max(0, live - left);
      if (second.chainLength || second.garbage.length) {
        resolved = {
          chainLength: Math.max(resolved.chainLength, second.chainLength),
          comboSizes: resolved.comboSizes.concat(second.comboSizes),
          garbage: resolved.garbage.concat(second.garbage)
        };
      }
    }
    var input = inputMod.fromStack(stack, board, resolved, null, cleared);
    input.travelFrames = frames;
    return evaluator.evaluate(input, this.weights, { density: this.density }).score;
  };



  // MEASURED, 2026-09-12: THE CEILING ON THIS IS 8 BOARDS OUT OF 84.
  //
  // Scoring a candidate on its FULLY RESOLVED board already puts any
  // cascade that fires NOW into the number — ai/eval/chain_reach.js shows
  // a swap setting off a 3-link chain reporting chainLength 3 and combos
  // 3+3+3 from one resolve() at depth 1. So lookahead can only ever add
  // chains that do not exist yet, and on the game's own 84 chain puzzles
  // those are mostly far away:
  //
  //     fewest swaps before a 2+ link chain exists
  //       1 swap    18 puzzles   depth 1 already takes all 18
  //       2 swaps    8 puzzles   everything depth 2 could possibly add
  //       3 swaps    4 puzzles
  //       4+/never  54 puzzles
  //
  // Six trained runs bear that out: depth 2 fires 19-22 chains of 84 and
  // depth 1 fires 21-22, with the seed spread swallowing the difference.
  // Depth 2 is not broken; there is almost nothing within its reach.
  //
  // Going deeper is closed by arithmetic rather than tuning: ~30 legal
  // swaps a ply is ~810,000 boards per decision at depth 4, against an
  // 85ms budget. Reaching the other 54 means being TOLD the shape and
  // pricing how close the board is to it — ../PUYO_REFERENCE.md's Tier 2,
  // "it does not discover chain shapes, it is told them", and
  // docs/CHAIN_SHAPES.md for the one shape Panel de Pon documents.
  //
  // LOOKAHEAD, WHICH IS THE ACTUAL TIER 2 MOVE.
  //
  // ../PUYO_REFERENCE.md's Tier 1 bot — score every move's resulting board,
  // play the best — is what this file was, and the reference is explicit
  // about where it stops: "greedy fires too early, and this is the real
  // cap". A scorer that values the board NOW takes a chain the moment one
  // exists, so potential never accumulates.
  //
  // WHAT WAS TRIED FIRST AND DID NOT WORK, because it is the reason this
  // exists rather than another feature: three features were added to the
  // weighted sum to try to buy this — staircase (the shape Panel de Pon
  // players build), flatTop (the shape that kills them), comboPotential
  // (how big a clear is available). Four training runs each, against a
  // baseline whose own spread was measured at 928 points. All three came
  // back NO EFFECT (compare_runs.js). That is the reference's other
  // prediction landing: "density is not order… random density cannot
  // produce it any more than shaking a box of dominoes stands them in a
  // line." A linear sum over board features cannot express a plan, and
  // adding terms to it does not change that.
  //
  // Tier 2's answer is not a longer feature list, it is a different
  // SELECTION POLICY: citrus610's bot is best-first plus beam search with
  // "highest expected chain score, not highest score now", looking 3 moves
  // ahead attacking and 2 defending. This is that, at the smallest honest
  // size: expand the most promising candidates one move further and choose
  // on the best board reachable in TWO moves rather than in one.
  //
  // WHY A BEAM AND NOT EVERY BRANCH. ~35 legal swaps means ~1,200 full
  // clone+resolve pairs at depth 2, and the worst decision already costs
  // 8ms of an 85ms budget. The beam keeps the top BEAM candidates by
  // immediate score and expands only those, which is exactly what beam
  // search is for — and it is measured rather than assumed, in
  // lookahead.test.js.
  //
  // DEPTH 1 IS THE OLD BOT, EXACTLY. Not approximately: the depth-1 path
  // is the original loop untouched, so every existing result, the shipped
  // weights and identity.golden.json all still describe it. Lookahead is
  // opt-in per instance, so turning it on is a decision somebody makes
  // rather than a thing that happens.
  PuyoCpu.prototype._decide = function () {
    var board = this._snapshot();
    var swaps = board.legalSwaps();
    // ONE incoming row for the whole decision. Every candidate is risen by
    // the SAME row or the comparison is back to being unfair in a new way.
    this._incoming = board.incoming || null;

    // HOLD is a candidate like any other, scored the same way. SearchCpu
    // decides between holding, raising and swapping with its own rules;
    // here the weights decide, because there is nowhere else for that
    // judgement to live — and putting a rule in would be putting back the
    // thing this brain exists to do without.
    var holdBoard = board.clone();
    var holdResolved = this._resolveCandidate(holdBoard);
    var best = { kind: 'hold' };
    var bestScore = this._score(holdBoard, holdResolved, null);

    var deeper = this.depth > 1 ? [] : null;

    for (var i = 0; i < swaps.length; i++) {
      var r = swaps[i][0], c = swaps[i][1];
      var trial = board.clone();
      trial.swap(r, c);
      var resolved = this._resolveCandidate(trial);
      var s = this._score(trial, resolved, [r, c]);
      if (deeper) deeper.push({ score: s, move: [r, c], board: trial });
      // Strictly greater, so a tie leaves the incumbent standing rather
      // than handing the decision to whichever swap legalSwaps() happened
      // to list first — list order is not a preference.
      if (s > bestScore) { bestScore = s; best = { kind: 'swap', move: [r, c] }; }
    }

    if (!deeper || !deeper.length) return best;
    return this._lookahead(deeper, best, bestScore);
  };

  // Expand the beam one move further and re-choose on what is REACHABLE.
  //
  // A candidate's value becomes the best board it can lead to next move,
  // not the board it leaves. That is the whole difference between "take
  // the chain that exists" and "keep the position that pays" — a move
  // which scores modestly now but opens a big clear beats one that banks
  // a small clear and leaves nothing.
  //
  // HOLD is left out of the expansion on purpose: it is already scored at
  // depth 1, and the board it leaves is the board we are standing on, so
  // expanding it would re-derive this same decision one ply down.
  PuyoCpu.prototype._lookahead = function (cands, best, bestScore) {
    cands.sort(function (a, b) { return b.score - a.score; });
    var beam = Math.min(this.beam, cands.length);
    var bestFuture = bestScore, chosen = best;

    for (var i = 0; i < beam; i++) {
      var cand = cands[i];
      var next = cand.board.legalSwaps();
      // A dead end is worth what it is, not nothing: a candidate with no
      // legal follow-up keeps its own score rather than being discarded,
      // or the search would refuse positions it has no reason to refuse.
      var futureBest = cand.score;
      for (var j = 0; j < next.length; j++) {
        var child = cand.board.clone();
        child.swap(next[j][0], next[j][1]);
        var childResolved = this._resolveCandidate(child);
        // The follow-up's travel is not priced. The cursor's position
        // after the first move is not known here — it depends on where
        // the walk actually ends — and inventing one would put a made-up
        // number into the comparison. The FIRST move still pays its real
        // travel cost at depth 1, which is the move actually being made.
        var f = this._score(child, childResolved, null);
        if (f > futureBest) futureBest = f;
      }
      if (futureBest > bestFuture) {
        bestFuture = futureBest;
        chosen = { kind: 'swap', move: cand.move };
      }
    }
    return chosen;
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
