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
    // THE DANGER CLOCK, OFF UNTIL IT HAS BEATEN THE BOT WITHOUT IT.
    //
    // It is built, tested and wired; what it is not is proven. Played against
    // the same weights with the clock off it stands at 3-7-30 over 40 seeds,
    // which is ten decided duels and therefore nothing, and the weights it
    // was measured with were fitted under the decision procedure it changes,
    // which biases the comparison against it. Both are reasons to keep
    // measuring, neither is a reason to turn it on for a training run.
    //
    // On, the clock does not seize the wheel: see modes.warned(). Opening
    // FORCED on it instead was tried and lost 8-16-16.
    this.dangerClock = opts.dangerClock === true;
    // Raises refused because the board could not survive them. Counted, so
    // "it never chooses to die any more" is a number rather than a claim.
    this.suicidalRaises = 0;
    // Moves refused because the board they leave is topped out, which at
    // level 10 is the same thing as dead.
    this.fatalMovesDropped = 0;
    // Moves refused because every reply to them is topped out.
    this.corneringMovesDropped = 0;
    // Decisions where EVERY move left the board topped out, and every move
    // led to a board with nowhere to stand. The filters lift here because
    // there is nothing to choose between, so these are the decisions where
    // the board, not the bot, decided. A death with these above zero was
    // forced; a death with both at zero was not.
    this.forcedDecisions = 0;
    this.corneredDecisions = 0;
    // THE STATE OF THE LAST DECISION, not a total over the duel. Whether a
    // death was forced is a fact about the decision the bot died on; a duel
    // that passed through one forced decision forty seconds earlier and then
    // recovered says nothing about how it ended.
    this.allFatalNow = false;
    this.allCorneredNow = false;
    // THE ONE NUMBER THAT SAYS THE BOT KILLED ITSELF: it played a move whose
    // board is topped out while a move whose board is not was on the list.
    // _survivors makes that unreachable, so this reads 0 while the refusals
    // hold and is the alarm if one ever stops holding.
    this.selfInflicted = 0;
    this.hadSurvivorNow = false;
    // Refusing a move that no line of play survives once the stack rises.
    this.deepSurvival = opts.deepSurvival !== false;
    this.doomedDecisions = 0;
    this.doomedMovesDropped = 0;
    // ON. 65% survival against an unconstrained equal over 96 duels, 62 of
    // 96 against 48 expected, with sent RISING 35.7 -> 37.0: it is not
    // trading attack for safety, it is clearing instead of being buried.
    this.heightCap = opts.heightCap !== false;
    this.cappedDecisions = 0;
    this.cappedMovesDropped = 0;
    this.allDoomedNow = false;
    // Off only for the harness that measures what the rule is worth. A rule
    // that cannot be switched off cannot be shown to be doing anything.
    this.refuseSuicide = opts.refuseSuicide !== false;
    // OFF. MEASURED ONE-SIDED AND IT LOSES, badly: 120 duels with sides
    // alternated, 37% survival against 63% for the same bot without it, 76
    // deaths against 44. Banning the repeat costs more than the repeat does
    // -- the cursor is already on that square, and forcing a different one
    // spends travel frames and leaves it out of position.
    this.refuseUndo = opts.refuseUndo === true;
    // OFF. A WASH, AND IT IS NOT FREE. 120 duels with sides alternated: 58
    // deaths against 62, 52% against 48% -- 0.4 sigma, nothing. A 60-duel
    // read said 57% against 43% and that was noise; the repo's own rule is
    // that one run per condition measures nothing. It costs a depth-4 search
    // on every near-ceiling decision, so a wash is a loss.
    this.deepestLine = opts.deepestLine === true;
    // OFF, AND REJECTED ON ITS OWN OBJECTIVE. With it narrowing on 12
    // decisions across three games the garbage came down 5 times for 66
    // cells; without it, 6 times for 82. Forcing the break CLEARS LESS
    // GARBAGE. Taking a break the moment it appears cashes a small one;
    // leaving it lets the same lid come off inside a chain that takes far
    // more. "Break it too soon and you die, break it half a second later
    // and you don't" -- the owner, before this was measured.
    this.breakingEscape = opts.breakingEscape === true;
    this.towardBreak = opts.towardBreak !== false;
    // OFF, AND THE THEORY BEHIND IT IS WRONG. It works mechanically -- it
    // fires 192 times over 20 games and lifts the average columns touching
    // the lid from 1.89 to 2.25 -- and every downstream number gets WORSE:
    // breaks 37 against 43, cells cleared 383 against 538, peak garbage 26.6
    // against 24.0, games 35.1s against 39.3s, deaths 10 of 20 against 8.
    //
    // The 3%-to-21% table below is a CORRELATION ACROSS BOARDS, not a lever.
    // Boards with five columns at the lid have breaks because of whatever
    // shaped them that way; putting a column there on purpose does not create
    // one. Read a cross-section, treated it as causal, and the intervention
    // reversed the sign.
    this.flattenToLid = opts.flattenToLid === true;
    // OFF. It fires 110 times over 20 games and buys nothing: breaks 44
    // against 43, cells cleared 527 against 538, deaths 8 of 20 either way,
    // peak garbage 26.6 against 24.0 -- worse. Games run 42.2s against 39.3s,
    // which does not matter at the same death rate.
    //
    // NOT FULLY MEASURED, and the gap is mine: the harness reported columns
    // touching the lid, which was flattenToLid's target, not the colour STEP
    // this rule moves. So whether it reduced the step is unverified. What is
    // verified is that it changed no outcome.
    //
    // It also weakens the tower reading: if levelling BEFORE the slab lands
    // changes nothing, a slab perched on a tower may be a symptom of a game
    // already being lost rather than the cause of losing it.
    this.levelForSlab = opts.levelForSlab === true;
    // ON, AND IT CANNOT BE CREDITED WITH ANYTHING. It fires 6 times over 20
    // games -- it needs allDoomedNow AND a candidate that actually breaks,
    // and those rarely coincide: doomed stretches are common, available
    // breaks are not. Measured: 41 breaks against 43, 532 cells against 538,
    // 9 deaths of 20 against 8. Six firings cannot move twenty games; this is
    // indistinguishable from nothing, which is NOT what the rules that were
    // switched off measured -- those were worse.
    //
    // Kept as a correctness guard rather than a performance bet: in those six
    // cases the bot was dead on the board with a break in front of it and
    // spent the decision elsewhere. The rule makes "if it dies it is because
    // nothing it could have played would have helped" literally true there.
    this.lastResortBreak = opts.lastResortBreak !== false;
    this.lastResortDecisions = 0;
    this.levelMovesDropped = 0;
    this.levelDecisions = 0;
    this.flattenMovesDropped = 0;
    this.flattenDecisions = 0;
    this.towardMovesDropped = 0;
    this.towardDecisions = 0;
    this._line = null;
    this.shallowMovesDropped = 0;
    this.undoMovesDropped = 0;
    this._lastSquare = null;
    this.engineDeath = opts.engineDeath !== false;
    // RULES 14's two rules, behind one switch so the pair can be measured
    // against the procedure they changed. A rule that cannot be switched off
    // cannot be shown to be doing anything.
    this.rules14 = opts.rules14 !== false;
    // The two separately, so each can be measured on its own rather than as
    // a pair whose halves might cancel.
    // OFF BY DEFAULT, AND MEASURED THAT WAY. Counting a stack-lowering clear
    // as an escape did nothing on its own (39.7s -> 39.5s) and CANCELLED the
    // broke-raise rule's gain when both ran: raise alone 44.9s, the pair
    // 39.2s. It stays in the file behind an opt-in because the idea is sound
    // and the implementation is the part that failed; it does not ship on.
    this.sinkingEscape = opts.sinkingEscape === true;
    this.refuseBrokeRaise = opts.refuseBrokeRaise === undefined ? this.rules14 : opts.refuseBrokeRaise !== false;
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
  // THE FLOOR MOVES AT THE SPEED AND PHASE THE MATCH IS ACTUALLY AT.
  //
  // riseLock is not copied because it is not state: updateRiseLock recomputes
  // it from swapQueued, shakeTime and hasActivePanels on the first frame of
  // run(), so setting it false here only stops a stale lock outliving its
  // cause.
  //
  // SHAKE TIME IS THE PIECE THAT WAS MISSING. paint() zeroes it, and a stack
  // with shakeTime 0 has a free floor while the real one is pinned -- so the
  // resolve aged the board with the rise running through a window the game
  // spends standing still, and handed back the live board SHIFTED UP A ROW.
  // Read off the boards at frame 785 of seed 970: live rows 9/10/11 full and
  // 12 empty, shakeTime 38, riseLock true; the candidate had the same panels
  // in rows 10/11/12 and read topped out. All 28 candidates read topped out,
  // so _survivors saw no survivor, lifted, and the bot chose unfiltered for
  // three decisions with two empty rows in hand.
  PuyoCpu.prototype._copyRiseState = function (st) {
    var live = this.stack;
    if (!live) {
      st.riseLock = true; st.riseTimer = 1e9;
      st.stopTime = 0; st.preStopTime = 0;
      st.shakeTime = 0; st.peakShakeTime = 0;
      return;
    }
    st.riseLock = false;
    st.riseTimer = live.riseTimer;
    st.displacement = live.displacement;
    st.speed = live.speed;
    st.stopTime = live.stopTime || 0;
    st.preStopTime = live.preStopTime || 0;
    st.shakeTime = live.shakeTime || 0;
    st.peakShakeTime = live.peakShakeTime || 0;
  };

  PuyoCpu.prototype._resolveCandidate = function (board, move, delay) {
    if (!this.engine) {
      // LogicalBoard cannot be aged cheaply, so this path keeps the old
      // behaviour: the caller has already applied the swap.
      return board.resolve();
    }
    if (!this._scratch) this._scratch = engineBoard.scratch(10);
    var st = this._scratch;
    // WITH THE SLABS, not just the cells that read -2. The engine walks
    // gWidth, gHeight and each cell's offset to decide whether a garbage block
    // is supported and to pop it as a unit; painted without them it is a
    // rectangle the engine cannot reason about, so every resolve involving
    // garbage was answering about a board the game will never have. The board
    // carries them from snapshot(); paint wants cells per id, not {cells}.
    var slabs = null;
    if (board.blocks) {
      slabs = {};
      for (var bid in board.blocks) {
        if (!board.blocks.hasOwnProperty(bid)) continue;
        var bc = board.blocks[bid];
        var cells = bc && bc.cells ? bc.cells : bc;
        if (cells && cells.length) slabs[bid] = cells;
      }
    }
    // AND THE CHAINING FLAGS. A clear is a chain LINK because the panels
    // carry the flag, not because of anything in the grid, so a board painted
    // without them resolves a chain as a plain combo.
    engineBoard.paint(st, board.grid, board.height, board.width, slabs,
                      board.chaining || null, board.motion || null);
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
    // THE GARBAGE ALREADY QUEUED. paint() clears stack.incoming as part of
    // resetting the scratch, which is right for a board built from nothing and
    // wrong for a board copied from a live match: that queue is garbage that
    // has ALREADY ARRIVED and is waiting for a gap to drop into. The bot can
    // see it coming and the resolve was throwing it away, so a slab that lands
    // during the settle was a surprise to the simulation and not to the game.
    if (this.stack && this.stack.incoming && this.stack.incoming.length && st.incoming) {
      for (var q0 = 0; q0 < this.stack.incoming.length; q0++) {
        var gq = this.stack.incoming[q0];
        st.incoming.push({ width: gq.width, height: gq.height, isChain: gq.isChain });
      }
    }

    // THE ROW THAT IS ARRIVING, painted whatever happens next. A rise can
    // land during the wait OR during the settle, and either way the row that
    // enters play is the dimmed one already on screen. Only the row BEHIND it
    // is the game's own RNG, which nothing can know.
    var inc0 = board.incoming || (this._board && this._board.incoming);
    if (inc0 && st.panels[0]) {
      for (var i0 = 1; i0 <= board.width; i0++) {
        var p0 = st.panels[0][i0];
        if (!p0) continue;
        var c0 = inc0[i0];
        p0.color = (c0 && c0 > 0) ? c0 : 0;
        p0.isGarbage = false; p0.state = 'normal'; p0.timer = 0;
        p0.chaining = false; p0.matching = false; p0.dontSwap = false;
        p0.gWidth = 0; p0.gHeight = 0; p0.xOffset = null; p0.yOffset = null;
      }
    }
    if (wait > 0 && this.stack) this._copyRiseState(st);
    // DEAD BEFORE THE CURSOR ARRIVES IS NOT A MOVE IT CAN PLAY.
    //
    // The loop already knew: it breaks on gameOver. What followed did the
    // swap anyway -- doSwap writes to the grid directly, not through run(),
    // so the panels move on a stack whose game is over -- and readGrid handed
    // back a board that cannot exist, with nothing on the result to say so.
    // Three deaths read off the boards were this: the bot predicted a garbage
    // break worth ten panels, walked to a square it never reached, and the
    // engine's board was the live one shifted up a row with the swap never
    // made. The score had picked the prettiest board in a future it died on
    // the way to.
    var diedInWalk = false;
    for (var f = 0; f < wait; f++) {
      st.events.length = 0;
      st.run();
      if (st.gameOver) { diedInWalk = true; break; }
    }
    // THE FLOOR KEEPS MOVING THROUGH THE SETTLE TOO.
    //
    // A settle runs 60 to 90 frames and the stack climbs during them, so
    // parking the rise here answers "what settles if the floor never moves" —
    // a board the game never has. Eight of every fifteen positions the
    // fidelity check threw away were thrown away for exactly this: a row rose
    // and the simulation had not been told it could.
    //
    // Everything needed is on the stack: riseTimer, displacement and speed say
    // when the next row lands, and board.incoming says what is in it.
    this._copyRiseState(st);
    // A REFUSED SWAP IS NOT A QUIET NO-OP. canSwap and LogicalBoard.legalSwaps
    // disagree on 3.5% of the moves the search is handed, and resolving the
    // UNMOVED board scores the candidate as "this move changes nothing" —
    // a phantom the bot then reasons about and sometimes plays.
    var refused = false;
    if (move) {
      if (st.canSwap(move[0], move[1])) st.doSwap(move[0], move[1]);
      else refused = true;
    }
    var out = engineBoard.settle(st, 900);
    if (refused) out.refused = true;
    if (diedInWalk) out.diedInWalk = true;
    // WHAT IS HOLDING THE BOARD UP WHEN THE DUST SETTLES.
    //
    // The engine does not kill you for being topped out. checkGameOver is
    // `health <= 0 && shakeTime <= 0`, and health only drains on a frame where
    // `!riseLock && stopTime === 0 && isToppedOut()`. So a topped-out board
    // with stop time banked, a slab still shaking, or panels still in motion
    // is a board that is alive -- and banking stop time by chaining INTO the
    // ceiling is how the game is meant to be survived: a chain link cashed
    // while topped out pays 88 to 98 frames.
    //
    // Read off 190 decisions where every move read fatal: only 14% were dead
    // within a second and 36% were still alive twenty seconds later. The
    // verdict was a proxy -- "row 12 holds a panel" -- and it was wrong most
    // of the times it fired, which is what emptied _survivors and left the bot
    // choosing unfiltered at exactly the decisions that decide the game.
    out.toppedOut = st.isToppedOut ? !!st.isToppedOut() : false;
    out.stopTime = st.stopTime || 0;
    out.shakeTime = st.shakeTime || 0;
    out.stillMoving = (typeof st.hasActivePanels === 'function')
                      ? !!st.hasActivePanels() : false;
    var settled = engineBoard.readGrid(st, board.height, board.width);
    for (var r = 0; r <= board.height; r++) {
      for (var c = 1; c <= board.width; c++) board.grid[r][c] = settled[r][c];
    }
    // AND THE SLABS THE SETTLE LEFT. The grid goes back and the blocks did
    // not, so the board handed to the second ply carried the garbage
    // structure from BEFORE the swap — a slab that has just been broken, or
    // fallen, or split, still described as it was. readBlocks exists for
    // this and nothing called it, which is the same defect as painting
    // without slabs, one ply deeper.
    board.blocks = {};
    var after = engineBoard.readBlocks(st, board.height, board.width);
    for (var bk in after) {
      if (after.hasOwnProperty(bk)) board.blocks[bk] = { cells: after[bk] };
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

  // A MOVE THAT LEAVES THE BOARD TOPPED OUT IS NOT A MOVE.
  //
  // Not a preference, and not about the last second: at level 10 maxHealth
  // is 1 and the health drain runs the FIRST frame the board reads topped
  // out, so topping out and dying are the same event. Over twenty deaths
  // the board was never topped out on the frame before -- it went from
  // clear to topped out to dead, in that order, on consecutive frames.
  //
  // So the only moment that decides it is the decision before, and there
  // the bot already knows: `board` here is the board the move leaves AFTER
  // the rows arriving during it have landed, which is the thing that tops
  // it out. Of those twenty deaths, twelve had a candidate whose risen
  // board was not topped out and the bot took one in four of them. Eight
  // died with a safe move in hand -- on one board 23 of 32 candidates were
  // safe and it picked a fatal one.
  //
  // WHEN EVERY MOVE IS FATAL THE FILTER LIFTS, because then it is not a
  // choice and an empty pool would fall through to no bot at all.
  PuyoCpu.prototype._survivors = function (cands) {
    if (!cands || !cands.length) return cands;
    var live = [], i;
    for (i = 0; i < cands.length; i++) {
      if (this._resolvesDead(this._settledOf(cands[i]), cands[i].resolved)) continue;
      if (this._diesToQueue(this._settledOf(cands[i]))) continue;
      // The walk to this square ends in a game over.
      if (cands[i].resolved && cands[i].resolved.diedInWalk) continue;
      live.push(cands[i]);
    }
    // MEASURED ALWAYS, REFUSED ONLY WHEN THE RULE IS ON. These read the board,
    // they do not change the move, and the harness that switches the refusals
    // off is the only thing that can show the count works -- so gating them on
    // refuseSuicide left selfInflicted pinned at 0 in the one mode where it
    // had to rise.
    this.allFatalNow = !live.length;
    this.hadSurvivorNow = live.length > 0;
    if (!live.length) this.forcedDecisions++;
    if (!this.refuseSuicide || !live.length || live.length === cands.length) return cands;
    this.fatalMovesDropped += cands.length - live.length;
    return live;
  };

  // A MOVE INTO A CORNER IS A MOVE INTO DEATH, one decision further out.
  //
  // _value has already settled every reply to every candidate, so it knows
  // which candidates leave nowhere to stand -- `cornered` is that, and it
  // costs nothing because the loop runs anyway. This is _survivors' rule
  // applied to the board after NEXT time rather than this time, and it
  // lifts the same way: when every move is a corner it is not a choice.
  //
  // 13 of 30 deaths were spent cornered, most of them for five to twelve
  // consecutive decisions, so the corner was entered long before it killed
  // anything. Refusing the avoidable ones takes the mean duel from 17.3s to
  // 20.8s; the cornered deaths themselves only fall from 16 to 14, because
  // some boards corner you whatever you do.
  //
  // `tier` is the escape preference _lookahead may already have built. This
  // narrows it rather than replacing it, and leaves it alone if narrowing
  // would empty it.
  PuyoCpu.prototype._standing = function (expand, tier) {
    if (!expand || !expand.length) return tier;
    var standing = [], i;
    for (i = 0; i < expand.length; i++) if (!expand[i].cornered) standing.push(i);
    this.allCorneredNow = !standing.length;
    if (!standing.length) this.corneredDecisions++;
    if (!this.refuseSuicide || !standing.length || standing.length === expand.length) return tier;
    this.corneringMovesDropped += expand.length - standing.length;
    if (!tier) return standing;
    var keep = [];
    for (i = 0; i < tier.length; i++) if (!expand[tier[i]].cornered) keep.push(tier[i]);
    return keep.length ? keep : tier;
  };

  // DON'T PUSH THE STACK UP WHEN YOU CANNOT PAY FOR IT.
  //
  // _raiseIsSuicide refuses a raise that kills on the spot. This refuses the
  // one that is plainly a step toward it: the stack is already in the top
  // rows, no stop time is banked, nothing is shaking, and the raise itself
  // earns nothing. In the death this was written for the bot raised four
  // times in a row in that state with its stop time running 48 -> 40 -> 0,
  // and every one of those raises was legal by the on-the-spot rule.
  //
  // THE HEIGHT CONDITION IS THE WHOLE RULE. Without it this refuses an
  // ordinary raise on a quiet low board, which is how the bot gets panels
  // to work with at all -- it dropped one legal move from every decision of
  // a calm game.
  //
  // A raise that completes a match is not this: that match is the reason to
  // raise, and it pays.
  PuyoCpu.prototype.BROKE_RAISE_ROWS = 3;
  PuyoCpu.prototype._raiseWhileBroke = function (raiseBoard, raiseResolved) {
    var stack = this.stack;
    if (!this.refuseBrokeRaise || !stack) return false;
    if ((stack.stopTime || 0) > 0) return false;
    if ((stack.shakeTime || 0) > 0) return false;
    if (raiseResolved && raiseResolved.clearedPanels) return false;
    var top = this._topRowOf(raiseBoard);
    return top > 0 && top > (raiseBoard.height - this.BROKE_RAISE_ROWS);
  };

  // IS THERE A LINE OUT OF HERE, ONCE THE STACK ACTUALLY RISES.
  //
  // _standing asks whether any REPLY to a move survives, but it asks it of
  // the board the move leaves -- which never rises. In the real game a row
  // arrives between every pair of decisions, so a move can pass that check
  // and be dead on arrival. That is the whole of the `toRise` column: 5518
  // of 9480 deaths took a move that was safe when it was played.
  //
  // So this rises the board first, then asks. Depth is in RISES, not plies:
  // depth 2 means "and still alive after the row after that".
  //
  // ONLY CLEARING SWAPS ARE FOLLOWED past the first rise. A swap that clears
  // nothing cannot lower the stack, so it cannot answer a rise -- following
  // them multiplies the work by ten and cannot change the answer.
  PuyoCpu.prototype._survivesRise = function (board, depth) {
    if (this._boardToppedOut(board)) return false;
    // The queue lands whatever the floor does.
    if (this._diesToQueue(board)) return false;
    if (depth <= 0) return true;
    var risen = board.clone().rise(this._incoming);
    // TOPPED OUT BEFORE THE CASCADE, NOT AFTER IT. The resolve below settles
    // the whole cascade in zero time; the engine takes flash + face + pop to
    // do it, dozens of frames, and the board is topped out for every one of
    // them. maxHealth is 1 at level 10, so the drain kills it on the FIRST
    // such frame -- traced: f902 the row lands and the top reads 12, f903
    // health 0. Asking after the resolve let a rise that pushed row 11 into
    // row 12 report survival because the new bottom row happened to complete
    // a match, and the bot played it. That is the death this check exists to
    // refuse.
    if (this._boardToppedOut(risen)) return false;
    this._resolveCandidate(risen);
    // A TOPPED-OUT BOARD HAS NO NEXT MOVE. maxHealth is 1 at level 10, so the
    // drain runs the first frame the board reads topped out and the game is
    // over on it -- there is no turn afterwards in which to play the clearing
    // swap that would have saved it. Searching for one anyway is what made
    // this report survival on 14 of 36 deaths: row 11 full, row 12 empty, the
    // rise pushes it over, and a swap on the dead board answered yes.
    if (this._boardToppedOut(risen) || this._diesToQueue(risen)) return false;
    // THE LINE, NOT JUST THE VERDICT. Waiting is a step like any other, so
    // it is recorded too -- a line that says "hold, then swap here" is the
    // commonest escape there is.
    if (this._survivesRise(risen, depth - 1)) { if (this._line) this._line.unshift(null); return true; }
    var swaps = risen.legalSwaps(), i, t, r;
    for (i = 0; i < swaps.length; i++) {
      t = risen.clone();
      t.swap(swaps[i][0], swaps[i][1]);
      r = this._resolveCandidate(t);
      if (!r || !r.clearedPanels) continue;
      if (this._boardToppedOut(t)) continue;
      if (this._survivesRise(t, depth - 1)) { if (this._line) this._line.unshift(swaps[i]); return true; }
    }
    return false;
  };

  // THE ESCAPE THE SEARCH FOUND, KEPT.
  //
  // _survivesRise proves a line exists by playing its own swaps, and then
  // threw every one of them away and answered true. _doomed used that as a
  // gate, the evaluator picked among the survivors by score, and at the next
  // decision the whole thing ran again from nothing -- so the bot never
  // walked the line that was found for it. Read off seed 971: frame 1351,
  // 8 of 12 moves survived the rise; it played one of the 8; twenty-two
  // frames later 0 of 15 survived, with the garbage unchanged at 32 cells,
  // an empty queue and no shake. Nothing happened to it. It chose its way
  // from eight lines to none.
  //
  // So the search hands the line back. _lineFor runs it for one candidate
  // and returns the swaps, deepest first tried.
  PuyoCpu.prototype._lineFor = function (board, depth) {
    this._line = [];
    var ok = this._survivesRise(board, depth);
    var line = this._line;
    this._line = null;
    return ok ? line : null;
  };

  // Only worth asking when the stack is high enough for a rise to matter,
  // bought at ten times the price otherwise.
  //
  // THE BOARDS THIS FILTER JUDGES, NOT THE ONE IT IS STANDING ON. The gate
  // read the LIVE board's top row while every test below is applied to a
  // candidate's SETTLED board -- which can be rows taller, because a raise
  // adds one, a slab can land during the settle, and a candidate that clears
  // nothing still carries the rise the walk paid for. So the gate answered a
  // question about a board nothing was being asked about.
  //
  // Read off 20 duels: the gate was shut on 101 decisions where some
  // candidates were doomed and others were not -- 69 of them at a live top
  // row of exactly 8, one row under the threshold, with up to 8 of 18
  // candidates dead -- and on 15 more where EVERY candidate was doomed, which
  // also left allDoomedNow unset and _lastResort blind. The old comment
  // claimed "on a low board every move survives every rise and the answer is
  // always yes"; it was false on all 116.
  //
  // Reading the tallest candidate instead recovers 71 of those 113 for 75
  // extra decisions filtered -- 57.7% of decisions against 55.8%, a 3.5% cost.
  // The 48 it still misses are boards whose candidates all settle at row 8 or
  // lower and die to the SECOND rise; DOOMED_ROWS is where that trade sits.
  PuyoCpu.prototype.DOOMED_ROWS = 4;
  PuyoCpu.prototype.DOOMED_DEPTH = 2;
  PuyoCpu.prototype._doomed = function (cands) {
    if (!this.refuseSuicide || !this.deepSurvival || !cands || cands.length < 2) return cands;
    if (!this._board) return cands;
    var i, top = 0, t;
    for (i = 0; i < cands.length; i++) {
      t = this._topRowOf(this._settledOf(cands[i]));
      if (t > top) top = t;
    }
    if (!top || top <= (this._board.height - this.DOOMED_ROWS)) return cands;
    var live = [];
    for (i = 0; i < cands.length; i++) {
      if (this._survivesRise(this._settledOf(cands[i]), this.DOOMED_DEPTH)) live.push(cands[i]);
    }
    this.allDoomedNow = !live.length;
    if (!live.length) { this.doomedDecisions++; return cands; }
    live = this._deepestLine(live);
    if (live.length === cands.length) return cands;
    this.doomedMovesDropped += cands.length - live.length;
    return live;
  };

  // A LINE EXISTING IS NOT A LINE BEING FOLLOWED.
  //
  // _doomed keeps every move from which some surviving line exists, and then
  // the evaluator picks among them by SCORE -- and at the next decision it
  // picks by score again. So the bot never walks the line the search found
  // for it. Read off seed 971: at frame 1351, 8 of 12 moves survived the
  // rise; it played one of the 8; twenty-two frames later 0 of 15 survived,
  // with the garbage unchanged at 32 cells, an empty queue and no shake.
  // Nothing happened to it. It chose its way from eight lines to none.
  //
  // MEASURED AND OFF: 52% survival against 48% over 120 duels, 0.4 sigma.
  // The reasoning below is still the right diagnosis -- the bot does choose
  // its way from eight lines to none -- but preferring depth among the
  // survivors does not fix it, because the thing that kills it is upstream:
  // garbage comes down on ONE FRAME PER GAME, peak 28 cells against a single
  // break of about 8. A bot that reads its board perfectly still dies if it
  // clears garbage once a game.
  //
  // So depth is the preference, not just the threshold: of the moves that
  // survive, keep the ones that survive LONGEST. Survival is monotone --
  // surviving d rises implies surviving d-1 -- so this walks up from the
  // depth already proven and stops at the first failure.
  PuyoCpu.prototype.DEEPEST_MAX = 4;
  PuyoCpu.prototype._survivalDepth = function (board, from, max) {
    var d = from;
    while (d < max && this._survivesRise(board, d + 1)) d++;
    return d;
  };
  PuyoCpu.prototype._deepestLine = function (live) {
    if (!this.deepestLine || !live || live.length < 2) return live;
    var best = -1, depths = [], i, d;
    for (i = 0; i < live.length; i++) {
      d = this._survivalDepth(this._settledOf(live[i]), this.DOOMED_DEPTH,
                              this.DEEPEST_MAX);
      depths.push(d);
      if (d > best) best = d;
    }
    var keep = [];
    for (i = 0; i < live.length; i++) if (depths[i] === best) keep.push(live[i]);
    if (!keep.length || keep.length === live.length) return live;
    this.shallowMovesDropped += live.length - keep.length;
    return keep;
  };

  // THE STACK DOES NOT GO ABOVE THE CAP WHILE A MOVE EXISTS THAT KEEPS IT
  // BELOW. An invariant on the board, with no horizon at all.
  //
  // Every lookahead refusal in this file answers a question about the next
  // two to five decisions. The option set that ends a game drains over
  // TWENTY-FIVE TO FORTY of them -- moves that survive fall 89% to 43% while
  // the bot picks a surviving move every single time one exists -- so no
  // reachable horizon sees the loss coming. A cap does not need to see it:
  // it binds on the first decision of the drift and on every one after.
  //
  // It is satisfiable where it matters. With the stack at or below row 7,
  // which is where it sits eighty decisions before a death, a move leaving
  // it at 8 or lower exists on 100% of decisions. By row 11 one exists on
  // 23% and the game is already decided.
  //
  // WHEN NO MOVE KEEPS IT UNDER, THE CAP LIFTS. Building needs height and a
  // bot that may never exceed row 8 can never hold a chain; the rule is that
  // it may not CHOOSE to go higher while a way down is on the table.
  // ROOM FOR WHAT IS ALREADY COMING. The cap is not a number, it is the
  // ceiling minus the rows queued against this board minus a margin.
  //
  // registry.js records why this cannot be a feature: the queue is a
  // property of the BOARD, not of the move, so it contributes the identical
  // number to every candidate and cancels out of the ranking -- it varied in
  // 0 of 179 decisions and was removed. features.js records that the same
  // queue is the mechanism behind the worst deaths: the danger is real the
  // instant the queue fills and invisible until each piece lands.
  //
  // A RULE CAN USE WHAT A SCORE CANNOT. Being identical across candidates is
  // exactly what makes it useless as a ranking term and right as a
  // threshold: the cap moves with the queue, and candidates are filtered by
  // their own height, which does vary.
  //
  // Read off a real death: six rows queued against a twelve-row board, so
  // the stack had to be at row 5. It was at row 8 with a surviving line
  // still available, the slab landed, and from the next decision no line
  // survived -- fourteen decisions of a game that was already over.
  // No fixed ceiling: a cap of 10 measured bit-identical to none, so the
  // whole effect is the queue term. Margin 2 beat margin 3 (65% against 56%).
  PuyoCpu.prototype.HEIGHT_CAP = 12;
  PuyoCpu.prototype.HEIGHT_MARGIN = 2;
  PuyoCpu.prototype._queuedRows = function () {
    var st = this.stack, w = this._board ? this._board.width : 6;
    if (!st || !st.incoming || !st.incoming.length || !w) return 0;
    var cells = 0, i;
    for (i = 0; i < st.incoming.length; i++) {
      cells += (st.incoming[i].width || 0) * (st.incoming[i].height || 0);
    }
    return Math.ceil(cells / w);
  };
  // PUTTING A PANEL BACK WHERE IT WAS IS NOT A MOVE.
  //
  // The evaluator scores every candidate on its own board and has no memory,
  // so on a quiet board the swap it liked last decision is still the one it
  // likes -- and playing it again just undoes it. Measured over 1,334
  // decisions in six duels: 263 of them, ONE IN FIVE, played the same square
  // twice in a row, and only 21% of decisions cleared anything at all.
  //
  // It is not merely wasted time. handleManualRaise returns while riseLock is
  // set, and updateRiseLock sets it on swapQueued() or hasActivePanels() --
  // so a bot that is always mid-swap can never raise. Read off 335 decisions
  // where the stack was starved under the lid (two panels or fewer touching
  // the slab) with three or more rows of headroom: RAISE was not on the
  // candidate list at all on 251 of them. No raise means no new panels, a
  // starved interface means no match can reach the slab, and the garbage only
  // ever accumulates.
  //
  // MEASURED AND OFF. The reasoning above is sound and the rule does what it
  // says -- undos fall from 263 of 1,334 decisions to 119, and decisions that
  // clear something rise from 21% to 23%. It still LOSES: 120 duels, sides
  // alternated, 37% survival against 63% without it. Keeping the cursor where
  // it already is buys more than the wasted swap costs.
  //
  // Narrow on purpose: only the SAME SQUARE as the move just taken, only when
  // that move cleared nothing, and it lifts if it would empty the pool.
  PuyoCpu.prototype._notAnUndo = function (cands) {
    if (!this.refuseUndo || !cands || cands.length < 2) return cands;
    var last = this._lastSquare;
    if (!last) return cands;
    var live = [], i, m;
    for (i = 0; i < cands.length; i++) {
      m = cands[i].move;
      if (m && m[0] === last[0] && m[1] === last[1]) continue;
      live.push(cands[i]);
    }
    if (!live.length || live.length === cands.length) return cands;
    this.undoMovesDropped += cands.length - live.length;
    return live;
  };

  PuyoCpu.prototype._heightCap = function (cands) {
    if (!this.heightCap || !cands || cands.length < 2) return cands;
    var h = this._board ? this._board.height : 12;
    var cap = Math.min(this.HEIGHT_CAP, h - this._queuedRows() - this.HEIGHT_MARGIN);
    var live = [], i, t;
    for (i = 0; i < cands.length; i++) {
      t = this._topRowOf(this._settledOf(cands[i]));
      if (t <= cap) live.push(cands[i]);
    }
    this.allAboveCapNow = !live.length;
    if (!live.length) { this.cappedDecisions++; return cands; }
    if (live.length === cands.length) return cands;
    this.cappedMovesDropped += cands.length - live.length;
    return live;
  };

  // THE MOVES THAT LEAVE A LOWER, LIVING BOARD.
  //
  // Only consulted when no candidate banks any stop time. `drop` is rows
  // taken off the top; a move that clears without lowering the stack is not
  // a way out of a board that is too tall.
  // BREAKING THE LID IS AN ESCAPE, AND IT IS THE ONLY ONE THAT LASTS.
  //
  // The escape tier ranks two things: a move that banks stop time, and, when
  // nothing pays, a move that sinks the stack. Neither notices the one move
  // that takes GARBAGE off the board, and garbage is what the bot dies
  // under. Measured over whole games with the count taken every frame: the
  // garbage on the board goes DOWN on one frame per game -- peak 28 cells,
  // a single break of about 8, and the rest only ever accumulates.
  //
  // Stop time and a lower stack both buy one more turn. A break is the only
  // move that makes the next turn EASIER rather than merely available, so it
  // is consulted before either, and ranked by how much of the lid it takes.
  //
  // The settled grid cannot show this on its own -- the resolve deliberately
  // stops AT a garbage break, because the colours the popped row becomes are
  // rng the planner may not read -- so it is the count on the board now
  // against the count the candidate leaves, which is the same diff _score
  // credits as garbageCleared.
  // WALK TOWARD THE BREAK. The bot cannot hold a plan, so give it a gradient.
  //
  // A garbage break is NEVER one swap away, is two swaps away on a third of
  // boards and beyond three on the rest. The bot picks every move
  // independently on a two-ply horizon, so it arrives at a board where the
  // colours for a break are already against the lid -- a pair or better of
  // one colour on 43 of 71 decisions -- and walks away from it, the same way
  // it walked out of eight surviving lines at frame 1351. It takes every
  // break it is offered, 3 of 3; a break is simply offered on 3 of 71.
  //
  // No plan is stored and none has to be. If a move leaves a board from
  // which ONE swap breaks the lid, then playing it makes the break available
  // next decision, and the bot already takes a break when it sees one. The
  // gradient does the carrying: at distance two, prefer distance one; at
  // distance one, the break itself is on the list.
  //
  // MEASURED. Over 20 games against the same seeds with it off: 43 garbage
  // breaks against 18, 538 cells cleared against 224 -- 2.4x on both, which
  // is far outside any noise at that sample -- peak garbage 24.0 against
  // 25.3, games 39.3s against 31.7s. Head to head over 120 duels, one-sided
  // with optsB and sides alternated: 56 deaths against 64, 53% against 47%,
  // garbage@death 27.8 against 30.5; at 240 duels 116 against 124, 52%
  // against 48%, garbage@death 28.0 against 30.7. The edge is 0.5 sigma, NOT
  // established; the clearing is. ON because the clearing is the cause of
  // death and the edge points the right way, not because 53% means anything.
  //
  // It only narrows -- it never invents a move -- and it lifts when no
  // candidate is closer, which is most of the time.
  PuyoCpu.prototype.TOWARD_MIN_GARBAGE = 6;
  // FLATTEN, THEN BREAK. Reach the lid with more columns before trying to pop it.
  //
  // Breaking garbage needs a match TOUCHING the slab, so only the columns that
  // reach its underside can ever take part. Measured over 20 games and 1,289
  // decisions with six or more cells of garbage up, by how many of the six
  // columns touch the lid:
  //
  //     0 cols  119 decisions   a break existed on  8%
  //     1 col   415 decisions                       3%
  //     2 cols  391 decisions                       5%
  //     3 cols  201 decisions                       5%
  //     4 cols   97 decisions                      11%
  //     5 cols   52 decisions                      21%
  //
  // Seven-fold from one column to five -- and the bot spends 63% of its time
  // at one or two, where a break essentially never exists. The slab lands flat
  // across the width and comes to rest on the TALLEST column, so a ragged
  // surface leaves it perched out of everything else's reach: read off seed
  // 972, three full rows of garbage with column 1 at row 6 and every other
  // column stopping at row 4, one panel touching the lid.
  //
  // So when garbage is up and nothing on the list breaks it, prefer the moves
  // that put more columns against it. _towardBreak already handles the case
  // where a break is one swap off; this is the move before that.
  PuyoCpu.prototype._lidCols = function (board) {
    if (!board || !board.grid) return 0;
    var n = 0, c, r, v, above;
    for (c = 1; c <= board.width; c++) {
      for (r = 1; r < board.height; r++) {
        v = board.grid[r] ? board.grid[r][c] : 0;
        above = board.grid[r + 1] ? board.grid[r + 1][c] : 0;
        if (v !== 0 && v !== -2 && above === -2) { n++; break; }
      }
    }
    return n;
  };
  // THE STEP IS ONLY FIXABLE BEFORE THE SLAB LANDS.
  //
  // A slab lands flat across the width and comes to rest on the TALLEST
  // column. Over 103 landings the colour surface carried a 3 to 5 row step
  // at the moment of landing. When it does, the slab bridges a gap: seed
  // 970, garbage at rows 10-12 resting on column 1 at row 9 while columns
  // 2-6 stop at rows 5-6 and rows 7-9 sit empty beneath it. That board
  // cannot be broken by construction -- panels FALL, so nothing is ever
  // lifted into the gap, and the only way to fill it is a rise, which drives
  // the tower into the ceiling.
  //
  // So the step is worth levelling only while garbage is IN FLIGHT. Once it
  // has landed the damage is done, which is why flattenToLid -- which waited
  // for garbage to be on the board -- made everything worse.
  PuyoCpu.prototype.STEP_MAX = 3;
  PuyoCpu.prototype._colourStep = function (board) {
    if (!board || !board.grid) return 0;
    var hi = 0, lo = 99, c, r, v, top;
    for (c = 1; c <= board.width; c++) {
      top = 0;
      for (r = board.height; r >= 1; r--) {
        v = board.grid[r] ? board.grid[r][c] : 0;
        if (v !== 0 && v !== -2) { top = r; break; }
      }
      if (top > hi) hi = top;
      if (top < lo) lo = top;
    }
    return (lo === 99) ? 0 : hi - lo;
  };
  // WHEN NOTHING SURVIVES, RACE FOR THE LID.
  //
  // _doomed lifts when every move is doomed -- correctly, since an empty pool
  // is no bot at all -- and the evaluator then picks by score, which has no
  // idea the position is lost. Read off seed 981: seven consecutive decisions
  // with 17 candidates, all alive this instant, ZERO surviving the rise,
  // topped out at row 12 under 39 cells of garbage, playing the identical
  // move [3,1] every time. Then one decision took the garbage from 39 to 18
  // -- a 21-cell break, and it died 30 frames later anyway.
  //
  // The break was there. It arrived too late because nothing was steering
  // toward it while the bot was already dead on the board.
  //
  // Forcing a break in general is WORSE and was measured so: taking one the
  // instant it appears cashes a small break where waiting lets the same lid
  // come off inside a chain (5 breaks/66 cells against 6/82). That argument
  // is about preserving a future. Here there is no future to preserve --
  // every move on the list dies to the next rise -- so the break costs
  // nothing and is the only thing that can change the position.
  PuyoCpu.prototype._lastResort = function (cands) {
    if (!this.lastResortBreak || !cands || cands.length < 2) return cands;
    if (!this.allDoomedNow || !this._board) return cands;
    var now = this._garbageOn(this._board);
    if (!now) return cands;
    var best = 0, got = [], i, b, broke;
    for (i = 0; i < cands.length; i++) {
      b = this._settledOf(cands[i]);
      if (!b) continue;
      broke = now - this._garbageOn(b);
      if (broke > best) { best = broke; got = [cands[i]]; }
      else if (broke === best && best > 0) got.push(cands[i]);
    }
    if (!best || !got.length || got.length === cands.length) return cands;
    this.lastResortDecisions++;
    return got;
  };

  PuyoCpu.prototype._levelForSlab = function (cands) {
    if (!this.levelForSlab || !cands || cands.length < 2 || !this._board) return cands;
    // Only while something is on its way. Nothing queued, nothing to level for.
    if (!this._queuedRows || !this._queuedRows()) return cands;
    if (this._colourStep(this._board) <= this.STEP_MAX) return cands;
    var best = Infinity, got = [], i, b, k;
    for (i = 0; i < cands.length; i++) {
      b = this._settledOf(cands[i]);
      if (!b || this._resolvesDead(b, cands[i].resolved)) continue;
      k = this._colourStep(b);
      if (k < best) { best = k; got = [cands[i]]; }
      else if (k === best) got.push(cands[i]);
    }
    if (!got.length || got.length === cands.length) return cands;
    if (best >= this._colourStep(this._board)) return cands;
    this.levelMovesDropped += cands.length - got.length;
    this.levelDecisions++;
    return got;
  };

  PuyoCpu.prototype._flatten = function (cands) {
    if (!this.flattenToLid || !cands || cands.length < 2 || !this._board) return cands;
    var now = this._garbageOn(this._board);
    if (now < this.TOWARD_MIN_GARBAGE) return cands;
    var best = this._lidCols(this._board), got = [], i, b, k;
    for (i = 0; i < cands.length; i++) {
      b = this._settledOf(cands[i]);
      if (!b) continue;
      // A move that breaks the lid outright is not this rule's business.
      if (this._garbageOn(b) < now) return cands;
      if (this._resolvesDead(b, cands[i].resolved)) continue;
      k = this._lidCols(b);
      if (k > best) { best = k; got = [cands[i]]; }
      else if (k === best && got.length) got.push(cands[i]);
    }
    if (got.length < 1 || got.length === cands.length) return cands;
    this.flattenMovesDropped += cands.length - got.length;
    this.flattenDecisions++;
    return got;
  };

  PuyoCpu.prototype._towardBreak = function (cands) {
    if (!this.towardBreak || !cands || cands.length < 2 || !this._board) return cands;
    var now = this._garbageOn(this._board);
    if (now < this.TOWARD_MIN_GARBAGE) return cands;
    var live = [], i, j, b, swaps, t;
    for (i = 0; i < cands.length; i++) {
      b = this._settledOf(cands[i]);
      if (!b) continue;
      // A move that breaks the lid outright is already the best case.
      if (this._garbageOn(b) < now) { live.push(cands[i]); continue; }
      if (this._resolvesDead(b, cands[i].resolved)) continue;
      swaps = b.legalSwaps();
      for (j = 0; j < swaps.length; j++) {
        t = b.clone();
        t.swap(swaps[j][0], swaps[j][1]);
        this._resolveCandidate(t);
        if (this._garbageOn(t) < now) { live.push(cands[i]); break; }
      }
    }
    if (!live.length || live.length === cands.length) return cands;
    this.towardMovesDropped += cands.length - live.length;
    this.towardDecisions++;
    return live;
  };

  PuyoCpu.prototype._breaking = function (expand) {
    if (!this.breakingEscape || !this._board) return null;
    var now = this._garbageOn(this._board);
    if (!now) return null;
    var best = 0, i, broke, gone = new Array(expand.length);
    for (i = 0; i < expand.length; i++) {
      gone[i] = 0;
      var b = this._settledOf(expand[i]);
      if (!b) continue;
      if (this._resolvesDead(b, expand[i].resolved)) continue;
      broke = now - this._garbageOn(b);
      if (broke <= 0) continue;
      gone[i] = broke;
      if (broke > best) best = broke;
    }
    if (!best) return null;
    var out = [];
    for (i = 0; i < expand.length; i++) if (gone[i] === best) out.push(i);
    return out;
  };

  PuyoCpu.prototype._garbageOn = function (board) {
    if (!board || !board.grid) return 0;
    var n = 0, r, c;
    for (r = 1; r <= board.height; r++) {
      if (!board.grid[r]) continue;
      for (c = 1; c <= board.width; c++) if (board.grid[r][c] === -2) n++;
    }
    return n;
  };

  PuyoCpu.prototype._sinking = function (expand) {
    var best = 0, i, drop, tops = new Array(expand.length);
    var now = this._board ? this._topRowOf(this._board) : 0;
    for (i = 0; i < expand.length; i++) {
      tops[i] = 0;
      var c = expand[i];
      if (!c.resolved || !c.resolved.clearedPanels) continue;
      if (this._boardToppedOut(c.board)) continue;
      drop = now - this._topRowOf(c.board);
      if (drop <= 0) continue;
      tops[i] = drop;
      if (drop > best) best = drop;
    }
    if (!best) return null;
    var out = [];
    for (i = 0; i < expand.length; i++) if (tops[i] === best) out.push(i);
    return out;
  };

  // The highest row holding anything, on a candidate board.
  PuyoCpu.prototype._topRowOf = function (board) {
    if (!board || !board.grid) return 0;
    for (var r = board.height; r >= 1; r--) {
      var row = board.grid[r];
      if (!row) continue;
      for (var c = 1; c <= board.width; c++) if (row[c] !== 0) return r;
    }
    return 0;
  };

  // WOULD THIS RAISE KILL IT.
  //
  // Not "is it risky" -- would the board it leaves have nowhere for the
  // garbage that is already queued to land. The engine's own second
  // game-over condition is holding raise on a topped-out board, and its
  // first is the health drain, which at level 10 is one frame; between them
  // there is no reaction window, so the only place to refuse this is before
  // the move is offered.
  //
  // Measured on ten deaths: one of them took `raise` with 12 cells of
  // garbage queued at a board already 9 rows deep, went from 9 rows to
  // topped out when it landed, and died 71 frames later. Nothing in the
  // weights forbade it and nothing could -- a weight applies to every raise
  // equally, and most raises are fine.
  //
  // `raiseBoard` has been resolved, so its grid is the board AFTER the new
  // row lands and everything it triggers settles.
  PuyoCpu.prototype._raiseIsSuicide = function (raiseBoard) {
    if (!raiseBoard || !raiseBoard.grid) return false;
    // The raise itself already topped the board out.
    if (this._boardToppedOut(raiseBoard)) return true;
    // Or the garbage on its way has nowhere left to land. Rows, because a
    // row is what costs headroom.
    var top = 0, r, c;
    for (r = raiseBoard.height; r >= 1; r--) {
      var row = raiseBoard.grid[r];
      if (!row) continue;
      var any = false;
      for (c = 1; c <= raiseBoard.width; c++) if (row[c] !== 0) { any = true; break; }
      if (any) { top = r; break; }
    }
    var queuedRows = 0, q = (this.stack && this.stack.incoming) || [];
    for (var i = 0; i < q.length; i++) queuedRows += (q[i].height || 0);
    return (raiseBoard.height - top) - queuedRows <= 0;
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
    // THE ENGINE WILL NOT ACT ON IT WHILE THE FLOOR IS LOCKED.
    //
    // handleManualRaise returns immediately unless riseLock is false, and
    // updateRiseLock sets it whenever a swap is queued, the screen is shaking
    // or ANY panel is in motion. On a stack full of holes something is always
    // falling, so the raise was offered, scored as though a fresh row
    // arrives, chosen -- and nothing happened. Read off one board: six raises
    // in a row with row 1 unchanged at 252132 throughout, while the panels
    // under the garbage drained from three to one.
    //
    // A move the engine refuses is not a move. The lock is re-decided every
    // frame, so a raise blocked by a passing cascade is available again at
    // the next decision twelve frames later.
    if (stack.riseLock) return false;
    if (typeof stack.hasActivePanels === 'function' && stack.hasActivePanels()) return false;
    if ((stack.shakeTime || 0) > 0) return false;
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
    // A VERDICT FROM A DECISION AGO IS NOT A VERDICT ABOUT THIS ONE.
    //
    // These three say "every candidate here is doomed / above the cap /
    // cornered", and each is written by a filter that can decline to run --
    // on its own gate, on a pool of one, or because the rule is switched off.
    // Unreset, the last answer stood in for the missing one: _lastResort
    // reads allDoomedNow and so could fire on a decision nothing had judged,
    // using a verdict from an earlier board. Their own comment already says
    // they are "THE STATE OF THE LAST DECISION, not a total over the duel";
    // this is what makes that true. Unknown reads as false, which is the
    // value that keeps every consumer quiet.
    this.allDoomedNow = false;
    this.allAboveCapNow = false;
    this.allCorneredNow = false;

    var holdBoard = board.clone();
    var holdResolved = this._resolveCandidate(holdBoard, null, this.reaction);
    var cands = [{ kind: 'hold',
                   score: this._score(holdBoard, holdResolved, null),
                   board: this._scoredBoard,
                   settled: holdBoard,
                   resolved: holdResolved,
                   risen: this._scoredResolved,
                   travel: this._scoredTravel,
                   earnedStop: holdResolved.stopTimeEarned || 0 }];

    if (this._canRaise()) {
      // The row the engine will actually deal, resolved, because a raise
      // can complete a match and that match is the reason to make it.
      var raiseBoard = board.clone().rise(this._incoming);
      var raiseResolved = this._resolveCandidate(raiseBoard);
      // A MOVE THAT KILLS YOU IS NOT A MOVE. Raising is the one thing the
      // bot does that pushes its own stack up, and it is the only way it
      // can shorten its own clock on purpose -- so it is the only place
      // "chose to die" is literally true, and it is not a preference to be
      // weighted against tidiness. See _raiseIsSuicide.
      // SCORED FIRST, REFUSED SECOND. Every legal move goes through the
      // evaluator -- puyocpu.test.js checks that count against the board's
      // own legalSwaps() -- and a refusal decides whether the scored move is
      // offered, not whether it is looked at.
      var raiseScore = this._score(raiseBoard, raiseResolved, null);
      if (!(this.refuseSuicide && (this._raiseIsSuicide(raiseBoard) ||
                                   this._raiseWhileBroke(raiseBoard, raiseResolved)))) {
        cands.push({ kind: 'raise',
                     score: raiseScore,
                     board: this._scoredBoard,
                     settled: raiseBoard,
                     resolved: raiseResolved,
                     risen: this._scoredResolved,
                     travel: this._scoredTravel,
                     earnedStop: raiseResolved.stopTimeEarned || 0 });
      } else {
        this.suicidalRaises++;
      }
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
      // The engine would not make this swap on the board the cursor arrives
      // at, so there is no honest score for it.
      if (resolved && resolved.refused) continue;
      cands.push({ kind: 'swap',
                   score: this._score(trial, resolved, [r, c]),
                   move: [r, c],
                   board: this._scoredBoard,
                   settled: trial,
                   resolved: resolved,
                   risen: this._scoredResolved,
                   travel: this._scoredTravel,
                   earnedStop: resolved.stopTimeEarned || 0 });
    }
    var out = this._levelForSlab(this._flatten(this._towardBreak(
        this._notAnUndo(this._heightCap(this._doomed(this._survivors(cands)))))));
    return this._lastResort(out);
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
    // THE CLOCK, NOT JUST THE CEILING. floor above is how long it takes to
    // REACH an escape; this is how long there is before the floor arrives.
    // Both were already computable here and only the first was computed.
    var clockNow = this.dangerClock ? this._dangerClock()
                                    : { headroom: null, framesPerRow: 0 };
    this._lastHeadroom = clockNow.headroom;
    // WARNED IS NOT FORCED. It leaves the pool and the ranking exactly as
    // they were and only changes what _lookahead prefers among them.
    var clockArgs = { headroom: clockNow.headroom,
                      framesPerRow: clockNow.framesPerRow,
                      escape: floor };
    this._warned = modes.warned(clockArgs);
    // AND HOW BIG AN ESCAPE HAS TO BE TO COUNT AS ONE. A move that reaches
    // a four when the bot needs 90 frames is not a way out of this board.
    this._escapeNeeded = this._warned ? modes.escapeNeeded(clockArgs) : 0;
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
  // A MOVE THAT THE QUEUED GARBAGE WILL KILL IS A FATAL MOVE.
  //
  // The survival check tested the board against the FLOOR rising and never
  // against the ceiling arriving, so it passed the move the bot died playing
  // on 42 of 84 deaths: it asked "do I survive the stack creeping up two
  // rows" while six rows of garbage were already in flight. The queue is
  // visible the instant the attack crosses. Stack height plus queued rows
  // over the ceiling is death, and nothing tested that sum.
  PuyoCpu.prototype._diesToQueue = function (board) {
    if (!board || !board.grid) return false;
    var q = this._nextGarbageRows();
    if (!q) return false;
    return this._topRowOf(board) + q > board.height;
  };

  // THE NEXT PIECE, NOT THE WHOLE QUEUE. shouldDropGarbage takes
  // incoming.shift() one at a time and hasFallingGarbage() blocks the next
  // until that one has landed, so six queued rows are not six rows arriving
  // together -- the bot gets decisions in between. Summing the queue refuses
  // moves that were never fatal.
  PuyoCpu.prototype._nextGarbageRows = function () {
    var st = this.stack, w = this._board ? this._board.width : 6;
    if (!st || !st.incoming || !st.incoming.length || !w) return 0;
    var g = st.incoming[0];
    return Math.ceil(((g.width || 0) * (g.height || 0)) / w);
  };

  // IS THIS BOARD ACTUALLY DEAD, or only standing in the top row.
  //
  // _boardToppedOut answers the grid question and is kept for the places that
  // want it. This answers the engine's: topped out AND nothing holding the
  // drain off. Without the resolve there is nothing to ask, so it falls back
  // to the grid -- a board with no account of itself is judged as before.
  // THE BOARD THE MOVE LEAVES, NOT THE BOARD IT WAS SCORED ON.
  //
  // `board` on a candidate is _scoredBoard: the settled board plus
  // `1 + _rowsArriving` rises. The unconditional 1 is a MEASUREMENT DEVICE --
  // _score's own comment says it "is not about time passing at all, it is
  // about WHEN a candidate is measured", so a move is not judged the frame
  // its match finishes popping. Scoring needs it. Survival must never see it:
  // it adds a row to every candidate alike, and a row is the whole distance
  // between alive and dead near the ceiling.
  //
  // Read off seed 973 frame 1561, live top 11, seventeen candidates: thirteen
  // moves read top 12 and were condemned while a clean re-resolve of the same
  // move leaves top 11, and the move the bot PLAYED read top 10 while a clean
  // re-resolve leaves top 12. The filter was inverted -- it refused thirteen
  // survivable moves and cleared the one that killed it. Sixteen of the
  // seventeen disagreed with their own resolve.
  //
  // `settled` is what _resolveCandidate left: the engine ran the real floor
  // through the walk and the settle, so it is the board the game will have.
  PuyoCpu.prototype._settledOf = function (cand) {
    return (cand && cand.settled) ? cand.settled : (cand ? cand.board : null);
  };

  PuyoCpu.prototype._resolvesDead = function (board, resolved) {
    if (!this._boardToppedOut(board)) return false;
    // OFF IS THE OLD VERDICT, so one side of a duel can be asked the grid
    // question while the other is asked the engine's. A rule that both sides
    // get cannot be measured -- the record is 50% by construction.
    if (this.engineDeath === false) return true;
    if (!resolved) return true;
    // A SHIELD THAT EXPIRES BEFORE YOU CAN MOVE IS NOT A SHIELD.
    //
    // Stop time and a shaking slab both hold the drain off, so the first
    // version of this asked only whether one was present. Read off the last
    // decision of 18 deaths: 178 moves were judged safe, 134 of them topped
    // out but "shielded", and 116 of those were spared by banked stop time
    // with an average of FOUR FRAMES LEFT. Four frames is a fifteenth of a
    // second. The board was still topped out when it ran out.
    //
    // The bot cannot act for `reaction` frames after a decision -- update()
    // returns while the cooldown is above zero -- so a shield shorter than
    // that buys no move at all, and the board it leaves is the board it dies
    // on. Anything that will still be standing when the cursor is free again
    // is a real reprieve; anything shorter is death with a delay.
    if (resolved.stillMoving) return false;
    var shield = resolved.stopTime || 0;
    if ((resolved.shakeTime || 0) > shield) shield = resolved.shakeTime;
    return shield <= this.reaction;
  };

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
    // The square to refuse next time: only a swap that changed nothing.
    this._lastSquare = (cand && cand.move && cand.resolved &&
                        !cand.resolved.clearedPanels) ? cand.move : null;
    var bar = this._bar();
    this._firedLast = !!cand && modes.fires(cand.resolved, bar.links, bar.wide);
    // THE SAME QUESTION THE FILTER ASKED. selfInflicted means "it chose a
    // board it cannot survive while one it could survive was on the list",
    // and _survivors decides what cannot be survived. While this asked the
    // grid and the filter asked the engine, a board legitimately held up by a
    // chain's stop time was counted as a suicide -- the two have to agree or
    // the count is measuring a rule nothing enforces.
    if (cand && this.hadSurvivorNow &&
        this._resolvesDead(this._settledOf(cand), cand.resolved)) this.selfInflicted++;
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
    return modes.FLOOR;
  };
  PuyoCpu.prototype._bar = function () {
    if (this.goal) return this.goal;
    if (!this._aim) this._aim = modes.aim(this.weights);
    return this._aim;
  };

  // HOW LONG BEFORE THE FLOOR REACHES THE CEILING.
  //
  // Every term is the engine's own and every one of them was already in
  // reach of this function: the rows of empty space above the stack, the
  // pixels left of the row currently rising, the level's rise rate, the
  // stop clock, and the garbage sitting in `incoming` waiting to land.
  // Nothing here estimates anything -- it is arithmetic on state the bot
  // was already holding and never subtracted.
  //
  // Queued garbage is counted in ROWS, because a row is what costs
  // headroom. A 12-cell delivery is two rows and erases 240 frames at
  // level 10, and it is visible in `incoming` before it lands.
  PuyoCpu.prototype._dangerClock = function () {
    var stack = this.stack;
    if (!stack) return { headroom: null, framesPerRow: 0 };
    var engine = (typeof window !== 'undefined' ? window : globalThis).PanelEngine;
    var perPixel = engine && engine.riseTime ? engine.riseTime(stack.speed) : 0;
    var framesPerRow = perPixel * 16;
    // displacement counts the pixels left before the next row lands.
    var toNextRow = (stack.displacement === undefined || stack.displacement === null)
        ? framesPerRow : stack.displacement * perPixel;

    var top = 0, r, c;
    for (r = stack.height; r >= 1; r--) {
      var row = stack.panels[r];
      if (!row) continue;
      var filled = false;
      for (c = 1; c <= stack.width; c++) {
        var p = row[c];
        if (p && p.color !== 0) { filled = true; break; }
      }
      if (filled) { top = r; break; }
    }

    var queuedRows = 0, q = stack.incoming || [];
    for (var i = 0; i < q.length; i++) queuedRows += (q[i].height || 0);

    return {
      framesPerRow: framesPerRow,
      headroom: modes.headroomFrames({
        rows: stack.height - top, queuedRows: queuedRows,
        framesPerRow: framesPerRow, framesToNextRow: toNextRow,
        stopTime: stack.stopTime || 0, preStopTime: stack.preStopTime || 0
      })
    };
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
    // DOES THIS MOVE LEAVE ANYWHERE TO STAND. The same loop already settles
    // every swap from the board this candidate leaves, so asking whether any
    // of them is survivable costs nothing. A move after which EVERY reply is
    // topped out is a move into a corner, and 13 of 30 deaths were spent
    // cornered -- for five to twelve consecutive decisions in most of them,
    // so the corner was entered long before it was fatal.
    var anyReplyLives = false;
    var j, f;
    for (j = 0; j < next.length; j++) {
      var child = cand.board.clone();
      child.swap(next[j][0], next[j][1]);
      var childResolved = this._resolveCandidate(child);
      if (!this._boardToppedOut(child)) anyReplyLives = true;
      if (childResolved && childResolved.garbage && childResolved.garbage.length) reach.breaks = 1;
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
      if (!this._boardToppedOut(risen)) anyReplyLives = true;
      if (risenResolved && risenResolved.garbage && risenResolved.garbage.length) reach.breaks = 1;
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
      cand.cornered = !anyReplyLives;
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
    // survivable(). While FORCED, or merely WARNED by the danger clock, a
    // move that banks time now or leaves a board holding a four or a chain
    // outranks every move that does neither, and the ordinary values still
    // choose among those.
    //
    // Warned, this is the ONLY thing that changes: the pool is still BUILD's
    // and the weights still rank it. Opening FORCED on the clock instead was
    // tried and lost 8-16-16, because FORCED discards BUILD.
    var tier = null;
    if (this._mode === 'FORCED' || this._warned) {
      // THE BIGGEST WAY OUT THERE IS, NOT ONLY ONE BIG ENOUGH TO SAVE IT.
      //
      // A threshold was tried -- admit an escape only if it banks enough to
      // clear the danger outright -- and it refuses the escapes that
      // actually exist. In the last five seconds before death 72% of
      // decisions hold a two-swap escape and the median one is worth 60
      // frames, a two-chain, while the frames needed to clear the danger
      // are usually more than that. The threshold took qualifying escapes
      // from 81% of warned decisions to 22%: it was throwing away real
      // outs for not being complete rescues. Sixty frames is sixty frames.
      //
      // So the tier is the BEST escape on offer and everything tied with
      // it. A bare "can reach a four or a two-chain" bar is no good either
      // -- two thirds of every board clears it, and the tier kept 11.2 of
      // 17.6 candidates and decided nothing. Ranking by what the engine
      // would actually pay separates them.
      var stopTable = this.stack && this.stack.levelData && this.stack.levelData.stop;
      var toppedOut = !!(this.stack && this.stack.wasToppedOut);
      var worth = new Array(expand.length), bestWorth = 0;
      for (i = 0; i < expand.length; i++) {
        // A move that banks time NOW is a real escape, not a promised one,
        // so it is worth what it actually earned.
        worth[i] = modes.banksTime(expand[i].resolved)
            ? Math.max(expand[i].earnedStop || 0,
                       modes.escapeValue(expand[i].reach, stopTable, toppedOut))
            : modes.escapeValue(expand[i].reach, stopTable, toppedOut);
        if (worth[i] > bestWorth) bestWorth = worth[i];
      }
      tier = [];
      if (bestWorth > 0) {
        for (i = 0; i < expand.length; i++) if (worth[i] === bestWorth) tier.push(i);
      }
      // STAYING ALIVE IS AN ESCAPE TOO.
      //
      // Everything above is denominated in stop-time frames, and a bare
      // three earns none -- so escapeValue reads 0 for it, bestWorth reads
      // 0, and the escape ranking switched itself OFF on exactly the boards
      // where nothing pays. In a real death the last nine decisions had no
      // banking move anywhere while two moves still cleared, and the bot
      // spent them on ordinary scoring.
      //
      // A three does not buy frames but it takes panels off the stack, and
      // a lower stack is the other way to still be here next decision. So
      // when nothing on the board pays, rank by what survives: clears
      // something and leaves a board that is not topped out, best first by
      // how far it drops the top row. It cannot outrank a real escape
      // because it is only consulted when there is none.
      if (!tier.length && this.sinkingEscape) tier = this._sinking(expand);
      if (!tier || !tier.length) tier = null;
    }

    // THE LID COMES OFF IN BUILD TOO.
    //
    // The escape tier is gated behind FORCED or the danger clock, and
    // measured over a whole game that gate opens on TWO of 89 decisions --
    // BUILD 74, ATTACK 13, FORCED 2, warned 0. So the entire survival
    // ranking, _sinking included, never gets a vote, in a game that ends
    // under 32 cells of garbage. A third escape added inside that gate fired
    // zero times.
    //
    // Breaking the lid is not an emergency measure. It is the only move that
    // removes garbage, and garbage is what the bot dies under -- so it is
    // asked on every decision that has a lid to break, whatever the mode.
    // It still only narrows when a break is actually on offer: _breaking
    // returns null when nothing takes a cell off, which is most of the time.
    if (!tier) {
      var lid = this._breaking(expand);
      if (lid && lid.length && lid.length < expand.length) tier = lid;
    }

    tier = this._standing(expand, tier);

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
