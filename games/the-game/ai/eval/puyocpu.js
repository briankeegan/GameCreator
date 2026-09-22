// PuyoCpu — the bot the weights drive.
//
// Every decision: list every legal move, score the board each one leaves
// with the weighted feature sum, play the highest. No tiers, no special
// cases — so the weights decide 100% of moves.
//

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./evaluator.js'), require('./input.js'), require('./travel.js'), require('./engineboard.js'), require('./modes.js'));
  } else {
    root.PanelEval = root.PanelEval || {};
    root.PanelEval.PuyoCpu = factory(root.PanelEval.evaluator, root.PanelEval.input, root.PanelEval.travel, root.PanelEval.engineBoard, root.PanelEval.modes);
  }
}(this, function (evaluator, inputMod, travel, engineBoard, modes) {
  'use strict';

  // Options: weights, depth (1 = greedy, 2 = one move of lookahead), beam
  // (0 = expand every candidate), rise, density, allowRaise, reaction.
  function PuyoCpu(stack, opts) {
    opts = opts || {};
    var PanelCpu = (typeof window !== 'undefined' ? window : globalThis).PanelCpu;
    this.stack = stack;
    // A COPY, because the target's potential term is added to it below. A
    // trainer scoring many genomes from one object would otherwise
    // accumulate that term every time it built a bot.
    this.weights = Object.assign({}, opts.weights || {});
    // A SECOND WEIGHT SET FOR THE DANGER ZONE. The same features, different
    // numbers: what makes a good board to build on and what keeps you alive
    // one frame from the ceiling are not the same question, and one set of
    // weights cannot answer both. Which matters when is then something the
    // trainer fits rather than something asserted here.
    //
    // Absent means the ordinary weights, so a bot without one is exactly the
    // bot that has always existed.
    this.dangerWeights = opts.dangerWeights
        ? Object.assign({}, opts.dangerWeights) : null;
    // Borrowed rather than reimplemented: the cursor walk and the board
    // snapshot are how the game works, not part of what is being tested,
    // and a second copy of either would drift from the first.
    this._beginWalk = PanelCpu.beginWalk;
    this._driveWalk = PanelCpu.driveWalk;
    this._nearestSwappable = PanelCpu.nearestSwappable;
    this._snapshot = PanelCpu.snapshot;
    this.cursorMoveFrames = opts.cursorMoveFrames || 4;
    // LOOKAHEAD, OFF BY DEFAULT. depth 1 is the Tier 1 bot the shipped
    // weights were trained as and identity.golden.json records; anything
    // higher is opt-in per instance. beam bounds the cost — see _lookahead.
    this.depth = opts.depth || 1;
    // NO BEAM BY DEFAULT. A beam over the IMMEDIATE ranking is exactly the
    // wrong filter for a search whose entire purpose is finding the move
    // that looks poor now and pays next move — measured on real level-10
    // play, the best two-move future ranked as low as #27 of 29 by
    // immediate score. Full expansion is ~900 clone+resolve pairs a
    // decision, which LogicalBoard does in ~15ms; a cap is opt-in for the
    // engine path, where a candidate costs 1.27ms instead of 0.017ms.
    this.beam = opts.beam || 0;
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
    // Frames between decisions. The weights were trained at 12; changing
    // two is about the SCORING and not about which one acts more often.
    // Every frame of it is real: the bot does nothing while it counts down.
    this.reaction = opts.reaction === undefined ? 12 : opts.reaction;
    this.cooldown = Math.floor(this.reaction / 2);
    this.raiseFrames = 0;
    // Raising is a CONTROL, like swapping and moving the cursor, so it is on
    // unless a caller takes it away. A bot that cannot raise cannot play the
    // build the rise exists for: shape the board, then push it up and let the
    // arriving row complete what was already there.
    this.allowRaise = opts.allowRaise !== false;
    // THE OTHER BOARD, when there is one. Optional: solo play has none, and
    // every number this repo has was taken without one.
    this.opponent = opts.opponent || null;
    // Does this weight set actually want the seven targets. If not, the
    // second ply does not rescore for them and the bot is byte-for-byte the
    // one that existed before they were added.
    this._usesReach = false;
    for (var rk = 0; rk < modes.REACH.length; rk++) {
      if (this.weights[modes.REACH[rk]] ||
          (this.dangerWeights && this.dangerWeights[modes.REACH[rk]])) {
        this._usesReach = true; break;
      }
    }
    this._walk = null;
    this._lastSwap = null;
    // Instrumentation, not decoration: the claim this brain exists to make
    // is that EVERY decision goes through the evaluator, and a counter is
    // how that stops being a claim.
    this.decisions = 0;
    this.evaluations = 0;

    // MODES, OFF BY DEFAULT — see modes.js. On, a mode narrows the pool of
    // candidates and the evaluator still picks from what is left; off, the
    // pool is every candidate, which is every number this repo already has.
    //
    // Opt-in for the same reason depth, beam, rise, density and allowRaise
    // are: it is a different bot, so weights trained without it describe
    // something else.
    this.modes = opts.modes === true;
    // WHAT THIS BOT IS BUILDING, as one setting a player would recognise:
    // "5-chain", "6-combo", or null for no target at all. It says the whole
    // plan — climb toward it, refuse to sell below it, fire when it exists —
    // because those are one decision, not three. modes.GOALS is the menu.
    //
    // It replaced fireLinks, fireWide, fireTarget and buildToward's target
    // half: four abstract numbers for one idea, none of which said the thing
    // a player would say.
    this.goal = modes.goal(opts.goal === undefined ? null : opts.goal, opts.alsoTake);
    // What to still cash if the OTHER weapon turns up this big. Not optional:
    // a bot that refuses the other weapon entirely starves — measured, a
    // combo bar of 8 or 99 gave zero deep chains and a 30% shorter game.
    this.alsoTake = opts.alsoTake;

    // HOW HARD IT WALKS TOWARD THE TARGET. The bars say what not to sell;
    // this says what to move toward, by giving the target's potential
    // the search's own second ply already resolved. See modes.climb.
    //
    // 20 by default, from measurement rather than taste. 120 games a
    // condition, shipped weights, depth 2 beam 0 rise on, FORCED closed,
    // fireWide 6, against a noise floor of 78 points a minute (2 sem):
    //
    //            points/min   4+ link chains   minutes survived
    //   toward 0     584          18 (0.39/m)        46.4
    //   toward 8     655          28 (0.50/m)        55.9
    //   toward 20    700          28 (0.55/m)        51.0
    //
    // 0 -> 20 is +116/min and clears the floor; 0 -> 8 is +71 and does not;
    // 8 and 20 cannot be told apart by this many games. 20 is chosen for
    // having the larger gap from zero, not for beating 8.
    //
    // SCALE IT AGAINST THE SPREAD, not against the weights. The values a
    // decision is choosing between differ by a median of 7 points, so a
    // strength of 120 is not a nudge — it is several times the whole spread,
    // and the bot stops weighing anything else. Measured harmful there.
    //
    // 0 costs nothing rather than merely meaning nothing: evaluate() skips a
    // zero-weight feature, and chainPotential is the most expensive one in
    // the registry.
    var towardGiven = opts.buildToward !== undefined;
    this.buildToward = towardGiven ? opts.buildToward : 20;
    // FRAMES OF STOP TIME BELOW WHICH, WHILE TOPPED OUT, the bot is about to
    // die. See modes.forced: stop time freezes the stack entirely, so danger
    // is the ceiling AND an empty clock, never height on its own.
    //
    // 0 MEANS DERIVE IT, and that is the default. The bot is a computer, so
    // the floor is not a round number: it is reaction + the walk to the
    // nearest move that clears anything + HOVER, which is exactly the point
    // below which it cannot bank stop time before the stack unfreezes. See
    // modes.escapeFrames. A positive number overrides it with a fixed floor,
    // which is for experiments.
    //
    // For scale at level 10: a 6-wide combo banks 34 frames of stop time, a
    // 4-link chain 64, and a 4-link chain fired WHILE TOPPED OUT banks 94 —
    // the danger bonus is the designed way out, so the bot must still be
    // free to take it rather than thrashing below the floor.
    this.stopFloor = opts.stopFloor === undefined ? 0 : opts.stopFloor;
    // JUDGE A CANDIDATE ON WHAT THE RISE LEAVES. The stack comes up whether
    // or not the bot acts and the row that is coming is known before the
    // move is chosen, so a three the board makes by itself is a move the bot
    // should have declined rather than something unavoidable.
    //
    // It costs nothing: _score already rises every candidate and merges that
    // resolve when rise is on, so this reads a number that was computed
    // either way. With rise off there is no second resolve and this is the
    // pre-rise one, which is all there is.
    //
    // The switch exists so the two can be measured against each other.
    this._riseAware = opts.riseAware !== false;
    // Instrumentation, and load-bearing: a flat bench with FORCED at 85% of
    // decisions and a flat bench with FORCED at 5% are opposite bugs, and
    // nothing else in the output tells them apart.
    this.modeCounts = { BUILD: 0, ATTACK: 0, FORCED: 0 };
    this.brokenPlans = 0;
    // Decisions where every build move rose into a clear that paid nothing.
    // Not a defect of the filter — the board genuinely offered no clean
    // move — but it has to be visible, because a preference that never
    // applies and a preference that always applies look the same from here.
    this.riseUnavoidable = 0;
    // The best payout the board offered last decision, and whether we spent
    // it. Together they are the only state that survives a decision.
    this._plan = null;
    this._firedLast = false;

    // THE CLIMB IS THE LOOKAHEAD, so it needs one.
    //
    // At depth 2 the second ply already resolves every swap from every
    // candidate board to find its best follow-up, and the deepest cascade
    // among those children IS that board's chain potential — 2,151
    // agreements out of 2,151 over real play. _value reads it off the
    // search and it costs nothing.
    //
    // At depth 1 there is no second ply. Asking the same question as a
    // FEATURE synthesises one, at ~900 extra resolves a decision: measured
    // at 166ms a decision, 344ms targeting chains, against an 85ms budget.
    // That path also cannot be switched off for FORCED, because the weights
    // are fixed at construction and the mode is not known until after
    // scoring — so FORCED would stop being the unfiltered bot.
    //
    // Unusable, unmeasured and semantically inconsistent. Refused, rather
    // than silently ignored: a knob that is set and does nothing is the
    // failure this repo has paid for more than once.
    // ASKED FOR IT AND IT CANNOT BE DONE: say so. Got it from the default
    // and it cannot be done: drop it. A default must not demand a depth the
    // caller never asked for — depth 1 is a real bot here — but a knob
    // somebody SET and that quietly does nothing is the failure this repo
    // has paid for more than once.
    if (this.modes && this.buildToward && this.depth < 2) {
      if (towardGiven) {
        throw new Error('buildToward needs a lookahead: it reads what the second ply ' +
                        'already resolved, and depth ' + this.depth + ' has no second ply. ' +
                        'Use depth 2, or set buildToward to 0.');
      }
      this.buildToward = 0;
    }
  }

  // Settle a candidate board: gravity, matches, cascades. Returns what the
  // move earned — chain length, combo sizes, garbage sent, stop time.
  // THE SWAP HAPPENS WHEN THE CURSOR ARRIVES, NOT WHEN THE BOT DECIDES.
  //
  // `move` and `delay` are the engine path only: the board is painted as it
  // stands, run forward `delay` frames — the reaction plus the walk — and
  // the swap is then made on whatever board is there, which is what the game
  // does. Resolving a swap against the board at the moment of DECIDING is
  // resolving it against a board that will not exist by the time it happens:
  // panels land in those frames, and a move that cleared nothing then clears
  // three now.
  //
  // A swap the aged board refuses is a swap that will really be refused —
  // canSwap is the engine's own — and it resolves to nothing, which is the
  // honest answer rather than a prediction made on a board that is gone.
  PuyoCpu.prototype._resolveCandidate = function (board, move, delay) {
    if (!this.engine) {
      // LogicalBoard cannot be aged cheaply, so this path keeps the old
      // behaviour: the caller has already applied the swap.
      return board.resolve();
    }
    if (!this._scratch) this._scratch = engineBoard.scratch(10);
    var st = this._scratch;
    engineBoard.paint(st, board.grid, board.height, board.width);
    var wait = Math.max(0, delay || 0);
    // AGE IT WITH THE FLOOR MOVING. paint() parks the rise — riseLock true and
    // riseTimer at 1e9 — because a rise DURING THE SETTLE shifts the board out
    // from under the read. But the wait below is not a settle: it is the walk
    // to the square, and the rise is the one thing that moves the board while
    // the cursor is travelling. Frozen, the search ages the board with nothing
    // changing, so a three it lined up is still lined up when it swaps —
    // in the scratch. On the real board it has climbed.
    //
    // Measured before this: of 980 swaps, 256 did not do what the search said,
    // and the largest class by far was an attack that vanished — 88 swaps
    // predicted a 4-combo and cleared nothing.
    //
    // The real stack's rise state is copied so the wait ages at the speed and
    // phase the match is actually at, then the floor is parked again for the
    // swap and the settle.
    if (wait > 0 && this.stack) {
      st.riseLock = false;
      st.riseTimer = this.stack.riseTimer;
      st.displacement = this.stack.displacement;
      st.speed = this.stack.speed;
      st.stopTime = this.stack.stopTime || 0;
      st.preStopTime = this.stack.preStopTime || 0;
      // AND THE ROW THAT IS ABOUT TO ARRIVE, not one the scratch invents.
      // paint() reseeds the scratch's RNG, so a rise during the wait fills
      // row 0 from that seed and deals panels the match will never see. The
      // row entering play is the dimmed one the player can already look at,
      // which snapshot() publishes as board.incoming; painted here, the rise
      // brings in the real panels and only the row BEHIND it is invented —
      // one further out than any walk reaches.
      // clone() does not carry `incoming` — it rebuilds a LogicalBoard from
      // grid, blocks and chaining only — so a candidate's trial board has
      // none and this read must fall back to the live snapshot.
      var inc = board.incoming || (this._board && this._board.incoming);
      if (inc && st.panels[0]) {
        for (var ic = 1; ic <= board.width; ic++) {
          var ip = st.panels[0][ic];
          if (!ip) continue;
          var col = inc[ic];
          ip.color = (col && col > 0) ? col : 0;
          ip.isGarbage = false; ip.state = 'normal';
          ip.timer = 0; ip.chaining = false; ip.matching = false;
          ip.gWidth = 0; ip.gHeight = 0; ip.xOffset = null; ip.yOffset = null;
        }
      }
    }
    for (var f = 0; f < wait; f++) {
      st.events.length = 0;
      st.run();
      if (st.gameOver) break;
    }
    st.riseLock = true;
    st.riseTimer = 1e9;
    st.stopTime = 0; st.preStopTime = 0;
    if (move && st.canSwap(move[0], move[1])) st.doSwap(move[0], move[1]);
    var out = engineBoard.settle(st, 900);
    var settled = engineBoard.readGrid(st, board.height, board.width);
    for (var r = 0; r <= board.height; r++) {
      for (var c = 1; c <= board.width; c++) board.grid[r][c] = settled[r][c];
    }
    return out;
  };

  // Score one candidate: build the feature input for the board this move
  // leaves, then run the weighted sum.
  //
  // baseline is the board the move was made FROM — the live stack at ply 1,
  // the parent candidate at ply 2 — so garbage cleared is this move's only.
  //
  // With rise on, the board is advanced before scoring: one settle row so a
  // candidate is judged after the panels fall back in rather than at the
  // instant its match pops, plus any rows that genuinely land while the bot
  // walks (_rowsArriving).
  PuyoCpu.prototype._score = function (board, resolved, move, from, plyClock, baseline) {
    this.evaluations++;
    // The board this call scored. Same object unless rise replaces it — see
    // the rise branch below. Read by _decide, never by anything else.
    this._scoredBoard = board;

    // What this move CLEARS: garbage on the live board minus garbage left
    // on the candidate. Never negative — garbage arriving is
    // incomingGarbage's business.
    var stack = this.stack, W = stack.constructor.WIDTH ||
        (typeof window !== 'undefined' ? window : globalThis).PanelEngine.WIDTH;
    // THE BASELINE IS THE BOARD THIS MOVE WAS MADE FROM, not always the live
    // stack. At ply 1 they are the same thing; at ply 2 they are not, because
    // the candidate is two moves ahead — so diffing it against the LIVE stack
    // counted the FIRST move's garbage too and handed the whole total to the
    // second move.
    //
    // Measured at depth 2 over three bigBlocks games before this fix:
    // garbageCleared and brokeGarbage are identical on all 812 ply-1
    // candidates and differ on 112 of 21,597 ply-2 candidates, by up to 6
    // cells. _value takes max(stand-pat, best reply), so that put a
    // systematically larger number on every second move.
    var live = 0, r, c, p;
    for (r = 1; r <= board.height; r++) {
      for (c = 1; c <= board.width; c++) {
        if (baseline) {
          if (baseline.grid[r] && baseline.grid[r][c] === -2) live++;
        } else {
          p = stack.panelAt(r, c);
          if (p && p.isGarbage) live++;
        }
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
    if (move) {
      var fr = from ? from[0] : stack.curRow, fc = from ? from[1] : stack.curCol;
      frames = travel.cost(fr, fc, move[0], move[1]);
    }

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
    // ONE ROW TO SETTLE, PLUS THE ROWS THAT ACTUALLY ARRIVE.
    //
    // TWO DIFFERENT JOBS, and conflating them cost a whole round of dead
    // training runs. The first row is not about time passing at all -- it is
    // about WHEN a candidate is measured. Without it a candidate is scored
    // the frame its match finishes popping: the hole is open, the cluster is
    // spent, the colour is scarce, and the panels that fill it back in never
    // arrive because the simulation stops there. Measured over 570 real
    // level-10 decisions, that asymmetry is worth -134 for a 0-panel move,
    // -424 for a 3, -652 for a 4-6 and -988 for a 7+ -- monotonic, so the
    // more a move cleared the worse it scored, and the bot held 52% of its
    // decisions rather than cash in. rise.test.js's last test is that
    // measurement, and making the row conditional brought every one of those
    // numbers straight back.
    //
    // So the settle row is unconditional whenever rise is on, and
    // _rowsArriving adds the rows that genuinely land during the walk on top
    // of it. A slow move is judged two rows later than a fast one, which is
    // the timing difference; both are judged on a board that has refilled,
    // which is the measurement fix. Neither job can be done by the other.
    //
    // PLUS THE BOT'S OWN CADENCE. A hold is not free in time: the bot waits
    // `reaction` frames before deciding again, and the stack rises for all
    // of them. Charging only travel would rise every swap and never a hold,
    // which favours waiting for a reason that is an artefact of the model.
    var rowsArriving = this.rise
        ? 1 + this._rowsArriving(frames + this.reaction, plyClock) : 0;
    for (var n = 0; n < rowsArriving; n++) {
      var after = board.clone().rise(this._incoming);
      var second = after.resolve();
      board = after;
      // THE BOARD THIS ACTUALLY SCORED, handed to the search rather than
      // written back over the caller's.
      //
      // The rise must reach the second ply: scoring a candidate on its
      // risen state and then searching its UN-risen state is two different
      // positions wearing one number. The obvious way to do that — rise the
      // caller's board in place — is WRONG, and rise.test.js says so. Its
      // sweep scores a candidate and THEN counts the panels on it to see
      // how much the move cleared; a _score that adds a row on the way
      // through makes every one of those counts wrong, and the bucket a
      // candidate lands in is decided by that count.
      //
      // So _score never touches what it was given. It publishes what it
      // scored, and _decide attaches that to the candidate.
      this._scoredBoard = board;
      left = 0;
      for (r = 1; r <= board.height; r++) {
        for (c = 1; c <= board.width; c++) if (board.grid[r][c] === -2) left++;
      }
      cleared = Math.max(0, live - left);
      if (second.chainLength || second.garbage.length) {
        // EVERY KEY resolve() REPORTS, not the three this used to name.
        // Rebuilding the object by hand silently dropped stopTimeEarned and
        // brokeGarbage whenever rise merged a second resolve — the same
        // "present, correct, quietly discarded one layer down" shape that
        // input.js's liveBoard comment was written about. Merged explicitly
        // so a new key cannot go missing here without someone deciding how
        // it merges.
        resolved = {
          chainLength: Math.max(resolved.chainLength, second.chainLength),
          comboSizes: resolved.comboSizes.concat(second.comboSizes),
          garbage: resolved.garbage.concat(second.garbage),
          // Stop time does not add up: the engine awards the LARGER, it does
          // not bank both.
          stopTimeEarned: Math.max(resolved.stopTimeEarned || 0,
                                   second.stopTimeEarned || 0),
          // Cells broken DO add up — two clears break two lots of garbage.
          brokeGarbage: (resolved.brokeGarbage || 0) + (second.brokeGarbage || 0),
          truncated: !!(resolved.truncated || second.truncated)
        };
      }
    }
    var input = inputMod.fromStack(stack, board, resolved, null, cleared, this.opponent);
    // WHAT THIS BOARD COULD FIRE NEXT MOVE, when the search has worked it
    // out. _value resolves every swap from a candidate's board to find its
    // best follow-up and records the best payout it saw; that IS this
    // board's reach, and it is set on the candidate before the rescore.
    // Null at ply 1 of a depth-1 bot, which has no second ply to ask.
    input.reach = this._reachNow || null;
    input.travelFrames = frames;
    // WHAT TIME IT IS FOR THIS PLY.
    //
    // fromStack reads the clock off the LIVE stack, which is right for a
    // move being made now and wrong for one imagined a move later: the
    // second ply was being scored against the clock as it stood BEFORE the
    // first ply happened. So "fire the chain now" and "hold, then fire it"
    // scored identically on stop time, and they are not the same move --
    // awardStopTime takes a MAX, so firing under a full clock buys nothing
    // and firing under an empty one buys everything.
    //
    // Only what _plyClock can state exactly is overridden; see its comment.
    // Everything else about the clock stays as the live stack reports it.
    if (plyClock) {
      input.clock.stopTime = plyClock.stopTime;
      input.clock.toppedOut = plyClock.toppedOut;
    }
    // WHAT THIS ACTUALLY SCORED, published the same way _scoredBoard is and
    // for the same reason. With rise on, the loop above merged the clears
    // the RISING ROW sets off into `resolved`; the caller's copy is the
    // pre-rise one. A filter reading the caller's copy cannot see a three
    // the rise is about to make, which is most of the threes.
    this._scoredResolved = resolved;
    // What reaching this move costs, published for the same reason the board
    // and the resolve are: the escape-frame floor needs it and recomputing a
    // walk the scorer already priced would be a second answer to one
    // question.
    this._scoredTravel = frames;
    return evaluator.evaluate(input, this._weightsNow(), { density: this.density }).score;
  };

  // Whether the engine will serve a manual raise this frame.
  PuyoCpu.prototype._canRaise = function () {
    // Off only when a caller asks for it off -- a harness pinning the old
    // choice set to compare against it. It changes what the bot may do, so
    // it changes the fingerprint.
    if (!this.allowRaise) return false;
    var stack = this.stack;
    if (stack.preventManualRaise) return false;
    if (stack.manualRaise) return false;
    if (typeof stack.isToppedOut === 'function' && stack.isToppedOut()) return false;
    if (typeof stack.hasFallingGarbage === 'function' && stack.hasFallingGarbage()) return false;
    return true;
  };

  // Every move available: hold, raise, and every legal swap. Each carries
  // the board it was scored on, so the second ply branches from the same
  // position the number describes.
  PuyoCpu.prototype._candidates = function () {
    var board = this._snapshot();
    // Kept for the mode filter's runway, which needs the live board's height
    // and must not pay for a second snapshot to get it.
    this._board = board;
    // ONE incoming row for the whole decision. Every candidate is risen by
    // the SAME row or the comparison is back to being unfair in a new way.
    this._incoming = board.incoming || null;

    var holdBoard = board.clone();
    var holdResolved = this._resolveCandidate(holdBoard, null, this.reaction);
    var cands = [{ kind: 'hold',
                   score: this._score(holdBoard, holdResolved, null),
                   board: this._scoredBoard,
                   resolved: holdResolved,
                   risen: this._scoredResolved,
                   travel: this._scoredTravel,
                   earnedStop: holdResolved.stopTimeEarned || 0 }];

    if (this._canRaise()) {
      // The row the engine will actually deal, resolved, because a raise
      // can complete a match and that match is the reason to make it.
      var raiseBoard = board.clone().rise(this._incoming);
      var raiseResolved = this._resolveCandidate(raiseBoard);
      cands.push({ kind: 'raise',
                   score: this._score(raiseBoard, raiseResolved, null),
                   board: this._scoredBoard,
                   resolved: raiseResolved,
                   risen: this._scoredResolved,
                   travel: this._scoredTravel,
                   earnedStop: raiseResolved.stopTimeEarned || 0 });
    }

    var swaps = board.legalSwaps();
    for (var i = 0; i < swaps.length; i++) {
      var r = swaps[i][0], c = swaps[i][1];
      var trial = board.clone();
      // THE WALK ONLY. reaction is already spent when this runs: update()
      // decrements cooldown and returns while it is above zero, so a decision
      // happens on the frame the wait ENDS, and a swap goes straight from
      // _decide into _beginWalk. Charging it again resolved every candidate
      // against a board `reaction` frames further into the future than the
      // one the swap lands on -- measured at exactly -12 frames on 205 of 281
      // swaps, with reaction 12. A hold still pays it, because after a hold
      // the bot really does wait that long before acting again.
      var delay = travel.cost(this.stack.curRow, this.stack.curCol, r, c);
      var resolved;
      if (this.engine) {
        // The engine ages the board and makes the swap itself.
        resolved = this._resolveCandidate(trial, [r, c], delay);
      } else {
        trial.swap(r, c);
        resolved = this._resolveCandidate(trial);
      }
      cands.push({ kind: 'swap',
                   score: this._score(trial, resolved, [r, c]),
                   move: [r, c],
                   board: this._scoredBoard,
                   resolved: resolved,
                   risen: this._scoredResolved,
                   travel: this._scoredTravel,
                   earnedStop: resolved.stopTimeEarned || 0 });
    }
    return cands;
  };

  // Narrow the pool to the moves this decision is allowed to choose between,
  // and record which mode did it. The evaluator still picks from what is
  // left — see the header of modes.js for why that is the whole design.
  //
  // Three pools. BUILD may hold and may dig, and refuses a clear below the
  // aim. ATTACK is the aim being available: cash-ins only, the weights pick
  // which. FORCED is the aim being irrelevant: whatever survives. When to cash in is a weights question, so no
  // mode answers it.
  PuyoCpu.prototype._applyModes = function (cands) {
    if (!this.modes) return cands;
    var bar = this._bar(), F = this._floor();
    var T = bar.links, S = bar.wide, i;

    var resolveds = new Array(cands.length);
    for (i = 0; i < cands.length; i++) resolveds[i] = cands[i].resolved;
    // The best payout on offer right now. This IS the board's chain
    // potential, read off resolves the decision already ran rather than from
    // a second sweep of clone+swap+resolve.
    var avail = modes.bestPayout(resolveds);

    var broke = modes.planBroke(this._plan, avail, this._firedLast, T, S);
    if (broke) this.brokenPlans++;

    var pool, mode;
    var stack = this.stack;
    // THE CHEAPEST WAY OUT, in frames. Only a move that BANKS TIME is a way
    // out — a bare three clears panels and awards nothing, so it is not an
    // escape however near the cursor it sits. None at all leaves the floor
    // at Infinity, which is the honest answer: no clock is long enough when
    // nothing pays.
    var nearest = null;
    for (i = 0; i < cands.length; i++) {
      if (!modes.banksTime(cands[i].resolved)) continue;
      var t = cands[i].travel || 0;
      if (nearest === null || t < nearest) nearest = t;
    }
    var floor = this.stopFloor > 0 ? this.stopFloor : modes.escapeFrames({
      reaction: this.reaction, travel: nearest, hover: this._hoverFrames()
    });
    this._lastFloor = floor;
    if (modes.forced({ toppedOut: this._boardToppedOut(this._board) || !!stack.wasToppedOut,
                       stopTime: stack.stopTime || 0,
                       preStopTime: stack.preStopTime || 0,
                       stopFloor: floor, broke: broke })) {
      pool = cands;
      mode = 'FORCED';
      // THE BEST WAY OUT, NOT THE TIDIEST BOARD. The weights score board
      // quality, which is not what matters one frame from death — the clock
      // is. Among moves that bank time, the most time wins. Null when none
      // does, and then the ordinary ranking stands, because no move here
      // saves it anyway.
      pool = modes.survivable(cands);
    } else if (avail.links >= T || avail.wide >= S) {
      // WHAT IT WAS BUILDING FOR IS ON THE BOARD. The pool becomes the moves
      // that cash in, and the weights pick WHICH — a 4-combo over a 6-combo
      // if that is what they say. Nothing here ranks them; taking the biggest
      // would be the bot's choice made for it.
      //
      // The bar is the aim, never the floor. Opening this at the smallest
      // payout the engine pays for makes every turn an attack turn, and the
      // only attacks available are scraps: it sells the smallest chain that
      // exists, every time one exists.
      pool = cands.filter(function (c) { return modes.fires(c.resolved, T, S); });
      mode = 'ATTACK';
    } else {
      // BUILDING. Every move that pays, and HOLD, which pays by clearing
      // nothing. Only the clear that sends nothing is refused; a payout under
      // the aim stays on the list and the weights say whether to take it.
      pool = cands.filter(function (c) { return modes.pays(c.resolved, F.links, F.wide); });
      mode = 'BUILD';
      // SECOND STAGE, AND IT YIELDS. Among the moves that are not a cheap
      // cash-in, prefer the ones the RISING ROW does not turn into one. When
      // every one of them rises into something, the preference is dropped
      // rather than emptying the pool — an empty pool falls through to the
      // unfiltered bot, which fires more bare threes than no filter at all.
      if (this._riseAware && pool.length) {
        var clean = pool.filter(function (c) {
          return !modes.risesIntoPayless(c.risen, c.resolved, F.links, F.wide);
        });
        if (clean.length) pool = clean; else this.riseUnavoidable++;
      }
    }

    // AN EMPTY POOL IS A BROKEN PLAN, NOT A THIRD TRIGGER. It means every
    // move on the board cashes in cheaply, which is the board forcing a hand
    // that had something to protect. Counted as the defect it is rather than
    // quietly widened, because "the filter emptied" and "the filter is
    // wrong" look identical from outside if nobody counts it.
    if (!pool.length) {
      this.brokenPlans++;
      pool = cands;
      mode = 'FORCED';
    }

    this.modeCounts[mode]++;
    this._mode = mode;
    // RE-SCORED UNDER THE DANGER WEIGHTS. _candidates scored everything with
    // the building set before the mode was known — it cannot know sooner,
    // because a broken plan is only visible once every candidate is
    // resolved. Rescoring is confined to the survivors of a mode that is
    // meant to be rare, so it costs a handful of evaluations when it costs
    // anything at all.
    if (mode === 'FORCED' && this.dangerWeights) {
      for (i = 0; i < pool.length; i++) {
        var c = pool[i];
        pool[i].score = this._score(c.board, c.resolved,
                                    c.kind === 'swap' ? c.move : null);
      }
    }
    this._plan = avail;
    return pool;
  };

  // Pick a move. Greedy at depth 1; at depth 2 hand off to _lookahead.
  PuyoCpu.prototype._decide = function () {
    var cands = this._applyModes(this._candidates());

    // HOLD IS CANDIDATE ZERO, not a separate case carried alongside the
    // others. It was the separate case, and that is how it ended up judged
    // one move deep while every swap was judged two -- waiting always
    // looked worse than acting, and waiting is how a chain gets built.
    if (this.depth > 1) return this._lookahead(cands);

    // Strictly greater, so a tie leaves the incumbent standing rather than
    // handing the decision to whichever candidate happened to be built
    // first -- list order is not a preference.
    var best = cands[0];
    for (var i = 1; i < cands.length; i++) if (cands[i].score > best.score) best = cands[i];
    this._took(best);
    return best.kind === 'swap' ? { kind: 'swap', move: best.move } : { kind: best.kind };
  };

  // How many rows land during `frames`, given the stop clock. Rows do not
  // move while stop time is running.
  PuyoCpu.prototype._rowsArriving = function (frames, plyClock) {
    if (!this.rise) return 0;
    var stack = this.stack;
    var paused = plyClock ? plyClock.stopTime : (stack.stopTime || 0);
    var moving = frames - paused;
    if (moving <= 0) return 0;
    var engine = (typeof window !== 'undefined' ? window : globalThis).PanelEngine;
    var first = stack.riseTimer;
    if (moving < first) return 0;
    var pixels = 1 + Math.floor((moving - first) / engine.riseTime(stack.speed));
    // No `pixels < displacement` guard: the floor below already returns 0
    // for every pixel count short of the next row, and a branch no test can
    // reach is a branch nobody can be wrong about. Proved by mutation --
    // removing that guard changed no answer and failed no test, which is
    // what an unreachable line looks like.
    return 1 + Math.floor((pixels - stack.displacement) / 16);
  };

  // The clock as it stands after ply 1: stop time is the engine's MAX of
  // what was banked and what this candidate earned, not their sum.
  PuyoCpu.prototype._plyClock = function (cand) {
    var stack = this.stack;
    return {
      stopTime: Math.max(stack.stopTime || 0, cand.earnedStop || 0),
      toppedOut: !!stack.wasToppedOut || this._boardToppedOut(cand.board)
    };
  };

  // Is this board topped out.
  PuyoCpu.prototype._boardToppedOut = function (board) {
    if (!board || !board.grid) return false;
    var row = board.grid[board.height];
    if (!row) return false;
    for (var c = 1; c <= board.width; c++) if (row[c] !== 0) return true;
    return false;
  };

  // Is ply 2 filtered this decision. FORCED means play like the bot with no
  // modes at all, and that has to hold at BOTH plies: a decision that takes
  // every move at ply 1 and then values them by a filtered future is neither
  // bot. Everywhere else ply 2 uses BUILD's predicate — having fired, the
  // next move is building again.
  // The two bars this bot is playing to. No relative floor at ply 2: the
  // best on offer there is a different board's, and pricing an imagined
  // move against this board's table is the mismatch _value's own comment
  // was written about.
  // The two bars this bot plays to. With a goal they ARE the goal; without
  // one they are the engine's own floor, which is the plain filter.
  // THE MOVE ACTUALLY TAKEN, not the one that was available. planBroke asks
  // whether what the bot was saving for vanished without being spent, and a
  // decision where a payout was on offer and the bot held is exactly the case
  // it has to be able to see. Reading it off the mode would answer "something
  // was offered", which is a different question and hides the break.
  PuyoCpu.prototype._took = function (cand) {
    var bar = this._bar();
    this._firedLast = !!cand && modes.fires(cand.resolved, bar.links, bar.wide);
  };

  // TWO NUMBERS, AND THEY ARE NOT THE SAME NUMBER.
  //
  // The FLOOR is what building refuses: a clear the engine pays nothing for
  // and sends nothing for. It is the engine's tables, not a preference, so
  // it never moves. Everything at or above it stays in the pool and the
  // weights decide whether this is the moment.
  //
  // The AIM is what opens the attack, read off the weights. Making the aim
  // do both jobs makes building refuse every clear below it: at an aim of
  // 9-wide the bot held 159 of 163 decisions and suffocated.
  PuyoCpu.prototype._floor = function () {
    return { links: 2, wide: 4 };
  };
  PuyoCpu.prototype._bar = function () {
    if (this.goal) return this.goal;
    if (!this._aim) this._aim = modes.aim(this.weights);
    return this._aim;
  };

  // The engine's own HOVER for this level: the frames a panel spends falling
  // before it can match. Read from the level table, never restated here.
  PuyoCpu.prototype._hoverFrames = function () {
    var lvl = this.stack && this.stack.levelData;
    return (lvl && lvl.frames && lvl.frames.HOVER) || 0;
  };

  // The weight set this decision is scoring with.
  PuyoCpu.prototype._weightsNow = function () {
    return (this._mode === 'FORCED' && this.dangerWeights) ? this.dangerWeights : this.weights;
  };

  PuyoCpu.prototype._filtering = function () {
    return this.modes && this._mode !== 'FORCED';
  };

  // The best two-move future reachable from a candidate. Ply 2 gets the same
  // choice set as ply 1: every legal swap, standing pat (v starts at the
  // candidate's own score), and a raise — except after a raise, which the
  // engine will not serve twice in a row.
  PuyoCpu.prototype._value = function (cand) {
    var next = cand.board.legalSwaps();
    var from = cand.kind === 'swap' ? cand.move : null;   // hold and raise move nothing
    // THE CANDIDATE'S OWN VALUE, and it is where reach belongs: reach* says
    // what the board this move LEAVES could fire next move, which is a
    // property of this candidate rather than of any child. It is scored here
    // because only the loop below knows it — the second ply resolves every
    // swap from that board anyway, so the number is free.
    //
    // ONLY WHEN THE WEIGHTS ASK. A set with no reach weight gets the score
    // it already had, so a bot that does not use these features plays
    // exactly the game it always played and pays nothing for them.
    var v = cand.score;
    // Computed ONCE per candidate: every child of this candidate follows the
    // same first move, so they all inherit the same clock.
    var clock = this._plyClock(cand);
    // baseline = cand.board, so garbage cleared is the SECOND move's only.
    // THE BEST ANY ONE SWAP COULD FIRE from the board this candidate leaves,
    // taken from the resolves this loop runs anyway. This is the candidate's
    // chain and combo potential, and reading it here is what makes the climb
    // free — see the constructor.
    var reach = { links: 0, wide: 0 };
    var j, f;
    for (j = 0; j < next.length; j++) {
      var child = cand.board.clone();
      child.swap(next[j][0], next[j][1]);
      var childResolved = this._resolveCandidate(child);
      var cp = modes.payout(childResolved);
      if (cp.links > reach.links) reach.links = cp.links;
      if (cp.wide > reach.wide) reach.wide = cp.wide;
      // PLY 2 OBEYS THE SAME FILTER AS PLY 1, for the reason spelled out
      // below: a move the bot cannot make at ply 1 must not be what ply 2
      // values a candidate for, or the imagined future is a different game
      // from the real one.
      if (this._filtering() && !modes.pays(childResolved, this._floor().links, this._floor().wide)) continue;
      f = this._score(child, childResolved, next[j], from, clock, cand.board);
      if (f > v) v = f;
    }

    // THE SECOND PLY GETS THE SAME CHOICE SET AS THE FIRST. A move the bot
    // can make at ply 1 and cannot make at ply 2 is one it can never PLAN,
    // only stumble into — the imagined future is then a different game from
    // the real one, and every number the search reports is about that other
    // game. Raising was missing: ply 2 enumerated legalSwaps() and nothing
    // else, so "swap, then raise" was unthinkable. Holding was always here —
    // v starts at cand.score, which IS the value of stopping after one move.
    //
    // Not after a raise: the engine will not serve two in a row.
    if (cand.kind !== 'raise' && this._canRaise()) {
      var risen = cand.board.clone().rise(this._incoming);
      var risenResolved = this._resolveCandidate(risen);
      var rp = modes.payout(risenResolved);
      if (rp.links > reach.links) reach.links = rp.links;
      if (rp.wide > reach.wide) reach.wide = rp.wide;
      if (!this._filtering() || modes.pays(risenResolved, this._bar().links, this._bar().wide)) {
        f = this._score(risen, risenResolved, null, from, clock, cand.board);
        if (f > v) v = f;
      }
    }
    // Added to the CANDIDATE's value, not to any one child's: how close the
    // board it leaves is to the target is a property of this move.
    //
    // NOT WHILE FORCED. FORCED means play like the bot with no modes at all
    // — it is entered because the runway is gone or the plan broke, and
    // climbing toward a five-chain is the opposite of what either calls for.
    // It also keeps the guarantee the filter already has: FORCED every
    // decision is exactly the unfiltered bot, at both plies and now in the
    // scoring too.
    if (this._usesReach) {
      this._reachNow = modes.reach(reach);
      cand.reach = this._reachNow;
      var withReach = this._score(cand.board, cand.resolved,
                                  cand.kind === 'swap' ? cand.move : null);
      this._reachNow = null;
      if (withReach > v) v = withReach;
    }
    if (this._filtering() && this.buildToward && this.goal) {
      v += modes.climbTo(this.goal, this.buildToward, reach);
    }
    return v;
  };

  // Play the candidate with the best two-move future. A beam expands only
  // the top candidates by immediate score, which hides the move worth
  // searching for; beam 0 expands all of them.
  PuyoCpu.prototype._lookahead = function (cands) {
    var expand = cands, i;
    // An explicit beam bounds the cost for the engine path. It never drops
    // hold: leaving the do-nothing move out of the pool is defect 2 in a
    // cheaper disguise.
    if (this.beam && this.beam < cands.length) {
      var ranked = cands.slice().sort(function (a, b) { return b.score - a.score; });
      for (i = 0; i < cands.length; i++) cands[i]._keep = false;
      for (i = 0; i < this.beam; i++) ranked[i]._keep = true;
      cands[0]._keep = true;
      // Filtered rather than taken from the ranking, so the pool stays in
      // candidate order and ties break as they do at depth 1.
      expand = cands.filter(function (c) { return c._keep; });
    }

    var values = new Array(expand.length);
    for (i = 0; i < expand.length; i++) values[i] = this._value(expand[i]);

    // THE ESCAPE IS PICKED HERE, NOT AT FILTER TIME. _value is what attaches
    // `reach` to a candidate, so the board a move leaves is unknown until
    // this loop has run — _applyModes cannot see it and neither can
    // survivable(). While FORCED, a move that banks time now or leaves a
    // board holding a four or a chain outranks every move that does neither,
    // and the ordinary values still choose among those.
    var tier = null;
    if (this._mode === 'FORCED') {
      tier = [];
      for (i = 0; i < expand.length; i++) {
        if (modes.banksTime(expand[i].resolved) || modes.reachesEscape(expand[i].reach)) tier.push(i);
      }
      if (!tier.length) tier = null;
    }

    var order = tier || expand.map(function (c, k) { return k; });
    var chosen = expand[order[0]], bestValue = values[order[0]];
    for (i = 1; i < order.length; i++) {
      if (values[order[i]] > bestValue) { bestValue = values[order[i]]; chosen = expand[order[i]]; }
    }
    this._took(chosen);
    return chosen.kind === 'swap' ? { kind: 'swap', move: chosen.move } : { kind: chosen.kind };
  };

  // One frame. A committed walk owns the frame until the cursor arrives.
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
    if (decision.kind === 'raise') {
      // HOLD THE INPUT LONG ENOUGH FOR THE ENGINE TO SERVE IT. setInput
      // latches manualRaise on a rising edge and the row takes frames to
      // arrive.
      this.raiseFrames = 20;
      this.cooldown = this.reaction;
      return;
    }
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
