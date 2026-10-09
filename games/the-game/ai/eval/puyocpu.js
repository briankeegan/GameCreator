// PuyoCpu — the bot the weights drive.
//
// Every decision: list every legal move, score the board each one leaves
// with the weighted feature sum, play the highest. No tiers, no special
// cases — so the weights decide 100% of moves.
//

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./evaluator.js'), require('./input.js'), require('./travel.js'), require('./modes.js'));
  } else {
    root.PanelEval = root.PanelEval || {};
    root.PanelEval.PuyoCpu = factory(root.PanelEval.evaluator, root.PanelEval.input, root.PanelEval.travel, root.PanelEval.modes);
  }
}(this, function (evaluator, inputMod, travel, modes) {
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
    this.rise = opts.rise === true;
    // DENSITY SCORING, also off by default — see evaluator.js. Counts that
    // are made of panels (links, edgePenalty) become densities, so clearing
    // stops subtracting tidiness it never actually lost.
    this.density = opts.density === true;
    // Frames between decisions. The weights were trained at 12; changing
    // two is about the SCORING and not about which one acts more often.
    // Every frame of it is real: the bot does nothing while it counts down.
    this.reaction = opts.reaction === undefined ? 12 : opts.reaction;
    // Frames after a swap before the bot acts again (the engine in C only);
    // the reaction unless given. A hold or a wait still takes reaction + 1.
    this.swapGap = opts.swapGap === undefined ? null : opts.swapGap;
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
    // Moves dropped by the GRADED lift: nothing survived the queue, so the
    // fallback is the moves that are not dead this instant rather than every
    // move there is.
    this.standingMovesDropped = 0;
    // Refusing a move that no line of play survives once the stack rises.
    // GC_SURVIVAL_SEARCH=0 turns the survival search off for tests of the
    // plumbing around the bot (duels, training legs, checkpoints), which pay
    // for it on every decision and test nothing it does.
    var envOff = typeof process !== 'undefined' && process.env && process.env.GC_SURVIVAL_SEARCH === '0';
    this.deepSurvival = opts.deepSurvival !== false && !envOff;
    // Opt-in: at every decision on a followed line, check the line's
    // prediction for this frame against the live board (see _checkModel).
    this.checkModel = !!opts.checkModel;
    // Where decisions come from when they cannot be made on the frame (see
    // REAL TIME). Absent, the bot decides on the frame.
    this.brain = opts.brain || null;
    var envOn = function (k) { return typeof process !== 'undefined' && process.env && process.env[k] === '1'; };
    // The search's steps on the engine in C (native.js; opts.native or
    // GC_NATIVE=1).
    this.native = !!opts.native || envOn('GC_NATIVE');
    // THE REPLIES ON THE ENGINE IN C TOO (opts.nativeCands, with serverStack):
    // every first-ply candidate also gets a node in a search context of its
    // own, settled from the server's board, and the second ply and the walk
    // toward a break step from those nodes (MK_SETTLE) instead of painting a
    // board into the JS engine for each reply -- most of a decision's time.
    this.nativeCands = !!opts.nativeCands;
    // The survival search's order: breadth first (the default) or 'best'
    // (opts.surviveSearch or GC_SURVIVE_SEARCH; experimental).
    this.surviveSearch = opts.surviveSearch || (typeof process !== 'undefined' && process.env && process.env.GC_SURVIVE_SEARCH) || null;
    // Worker threads for the survival search: opts.threads or GC_THREADS, a
    // number or 'auto' (one per core). The main thread only coordinates.
    // In a browser the page must be cross-origin isolated for shared memory.
    var want = opts.threads || (typeof process !== 'undefined' && process.env && process.env.GC_THREADS) || 0;
    if (want === 'auto') {
      if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) want = navigator.hardwareConcurrency;
      else if (typeof require === 'function') {
        var os = require('os');
        want = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
      }
    }
    var shared = typeof SharedArrayBuffer === 'function' && typeof Atomics !== 'undefined' &&
                 (typeof crossOriginIsolated === 'undefined' || crossOriginIsolated);
    this.threads = shared && Number(want) > 1 ? Number(want) : 0;
    this.modelMismatches = [];
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
    // THREES LAST (opts.threesLast): a move whose clears are all threes,
    // breaking no garbage and starting no chain, is dropped from the moves the
    // bot may play whenever any other move is left, unless the stack is topped
    // out with nothing holding it. Breaking garbage comes first: a three that
    // breaks garbage is played as any move is. It runs after the survival
    // search, so a three that is the only move proven to live is still played.
    this.refuseBareThree = opts.threesLast === true;
    this.nearestFirst = opts.nearestFirst === true;
    this.bareThreesDropped = 0;
    this.bareThreesKept = 0;
    this.bareThreesTopped = 0;
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


  // GARBAGE ALREADY IN FLIGHT, AS THE ENGINE WILL DELIVER IT.
  //
  // An attack sits in the sender's `outgoing` for GARBAGE_FLIGHT frames --
  // transit, telegraph and land delay, 151 in all -- before
  // takeDeliverableGarbage hands it to this stack's queue. It is on screen the
  // whole time, and it was invisible to the bot: nothing read
  // opponent.outgoing. Read off RULES 20's four deaths: at the last decision
  // with a move that survived, the queue was empty every time and the garbage
  // that killed it was already in flight, landing in 8, 9, 14 and 19 frames --
  // before the next decision. The check certified moves against a queue the
  // engine was about to fill.
  //
  // Delivery order is the engine's: first in, first out, and a chain still
  // running (not finalized) holds up everything behind it. Its size can still
  // grow, so it is counted at the size it has reached -- the least it will be.
  PuyoCpu.prototype._inFlight = function () {
    if (this._predArr) return this._predArr;
    if (this._carry) return this._carry.arrivals || [];
    var opp = this.opponent;
    if (!opp || !opp.outgoing || !opp.outgoing.length) return [];
    var flight = PAE().FLIGHT;
    var out = [], prev = 0, i, g, at;
    for (i = 0; i < opp.outgoing.length; i++) {
      g = opp.outgoing[i];
      // A chain still running sends when it ends, which can be the next
      // frame, at the height it has now or taller: it is counted at that
      // height, at the soonest it can land, and everything behind it waits
      // for it.
      at = g.finalized === false ? flight + 1 : (g.frameEarned || 0) + flight - (opp.clock || 0);
      if (at < prev) at = prev;
      if (at < 0) at = 0;
      out.push({ at: at, width: g.width, height: g.height, isChain: !!g.isChain });
      prev = at;
    }
    return out;
  };

  PuyoCpu.prototype._resolveCandidate = function (board, move, delay, untilRise, cap, exact) {
    PuyoCpu.steps++;
    if (!this.engine) {
      // LogicalBoard cannot be aged cheaply, so this path keeps the old
      // behaviour: the caller has already applied the swap.
      return board.resolve();
    }
    throw new Error('PuyoCpu: the engine resolves candidates only on the server\'s board (nativeCands)');
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
    var stack = this.stack, W = stack.constructor.WIDTH || PAE().WIDTH;
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
  //
  // BUT THE LIFT IS GRADED, BECAUSE THE CONDEMNATIONS ARE NOT THE SAME DEATH.
  // Three separate things condemn a candidate here: dead this instant
  // (_resolvesDead), dead before the cursor even arrives (diedInWalk), and
  // dead when the slab already queued lands (_diesToQueue). The last of those
  // is a LATER death -- the bot gets decisions in between, and a decision is
  // the only thing that can change a position -- so lifting to the whole pool
  // threw away an ordering the loop had already computed, and the score then
  // picked among deaths with no idea which was which.
  //
  // Read off frame 1190 of seed 971: 22 of 23 candidates were not dead this
  // instant, the pool lifted because all 23 died to the queue, and it played
  // the one that was already dead -- stopTime 0, shakeTime 0, against a `hold`
  // on the same list that left row 6 reading `4 4 . . 4 4`. Over 12 duels the
  // pool lifted 27 times, 7 of those with a not-dead-now candidate still in
  // it, and the bot played a dead-now move on 2 of the 7.
  //
  // allFatalNow still means "no fully surviving move", so FORCED and the
  // danger-weight rescore are unchanged: this only decides what the lift
  // falls back TO.
  //
  // ON, AND IT DOES NOT BUY TIME. 30 duels, same setting both sides: average
  // game 29.2s -> 27.6s and longest 110.3s -> 55.0s, neither a gap n=30 can
  // resolve on a game length and the longest is one duel either way. It is
  // kept because it is the requirement, not because it pays: it is what takes
  // no_self_death.test.js's "IT NEVER PLAYS A MOVE IT COULD NOT SURVIVE" to 0,
  // and a self-death read off a board is not traded for an average.
  PuyoCpu.prototype._survivors = function (cands) {
    if (!cands || !cands.length) return cands;
    var live = [], standing = [], i, b;
    for (i = 0; i < cands.length; i++) {
      b = this._settledOf(cands[i]);
      // With the survival search on, the search alone says what dies. The
      // grid tests below refuse moves it proves, and so does this resolve's
      // own death: it plays the move and then nothing, until the board is
      // still, so "died" means "dies if the bot never acts again" -- a hold
      // on the way through a proven line read as fatal (seed 700 frame 1711).
      if (this.deepSurvival && this.refuseSuicide) {
        standing.push(cands[i]);
        live.push(cands[i]);
        continue;
      }
      if (this._resolvesDead(b, cands[i].resolved)) continue;
      // The walk to this square ends in a game over.
      if (cands[i].resolved && cands[i].resolved.diedInWalk) continue;
      // Not dead THIS INSTANT, whatever the queue does to it after.
      standing.push(cands[i]);
      if (this._diesToQueue(b)) continue;
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
    if (!this.refuseSuicide) return cands;
    if (live.length) {
      if (live.length === cands.length) return cands;
      this.fatalMovesDropped += cands.length - live.length;
      return live;
    }
    if (!standing.length || standing.length === cands.length) return cands;
    this.standingMovesDropped += cands.length - standing.length;
    return standing;
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
  // THE MOVES THE BOT REALLY HAS BETWEEN TWO ROWS. It decides every 13 to 30
  // frames and a row takes 120, so it gets several moves per rise, and a move
  // that clears nothing yet is how most escapes start. The search allowed one
  // CLEARING swap per rise, and on the boards that decide a game that was not
  // enough: seed 700 frames 297 and 513 and seed 701 frame 291, 0 of 35, 28
  // and 34 moves "survived", and a search allowed two swaps of any kind before
  // each rise found a surviving line on all three in 431, 2006 and 1543
  // resolves. Played in the real game from frame 297, that line outlived every
  // slab then in flight and died twelve seconds later to garbage sent after.
  //
  // So between rises a line may make up to SWAPS_PER_RISE swaps of any kind.
  // The search has a budget, and a budget spent without an answer is not a
  // proof of death: a move is condemned only when every line has been tried.
  // As many moves as the time before the next row allows: a move whose
  // resolve brings the row ends that rise, and stop time buys room for more
  // -- earn it, then break. Five bounds the search, not the game.
  PuyoCpu.prototype.SWAPS_PER_RISE = 5;
  PuyoCpu.prototype.SURVIVAL_BUDGET = 400;
  // EVERY MOVE COSTS WHAT IT COSTS IN THE GAME. A move in a line is made by
  // walking to it from where the cursor last was and waiting out the
  // reaction, with the engine running the whole time -- rows rise, garbage
  // lands. Resolved as free, a line could make two moves before a row that
  // was fifteen frames away: seed 700 frame 2659 was certified on such a
  // line, and died one frame after the next decision when that row arrived.
  PuyoCpu.prototype._survivesRise = function (board, depth, vetted, carry, pre, budget, pos) {
    if (!budget) {
      budget = { n: this.SURVIVAL_BUDGET };
      // The candidate move itself is the first of this rise's moves.
      pre = this.SWAPS_PER_RISE - 1;
    }
    if (!pos && this.stack) pos = [this.stack.curRow, this.stack.curCol];
    // A board this function already put through the engine is alive on the
    // engine's say-so, shield and all; asking the grid again would condemn the
    // topped-out boards the engine let live.
    if (!vetted && this._boardToppedOut(board)) return false;
    if (depth <= 0) {
      if (!this._boardToppedOut(board)) return true;
      var saved0 = this._carry;
      this._carry = carry || null;
      var end = board.clone();
      end.incoming = (carry && carry.nextRow) || (board.incoming === false ? false : (board.incoming || this._incoming || null));
      var er = this._resolveCandidate(end, null, 0, true);
      this._carry = saved0;
      return !!er && !er.died && !this._boardToppedOut(end);
    }
    if (budget.n <= 0) { this.survivalUnproven = (this.survivalUnproven || 0) + 1; return true; }
    var saved = this._carry;
    // LET THE NEXT ROW COME -- the same resolve as every candidate, asked to
    // look as far as the next row, from the engine state this line has
    // reached. The engine drops whatever is queued, rises on its own timing
    // and runs its own drain; `died` is its verdict.
    this._carry = carry || null;
    var risen = board.clone();
    risen.incoming = (carry && carry.nextRow) || (board.incoming === false ? false : (board.incoming || this._incoming || null));
    var rr = this._resolveCandidate(risen, null, 0, true);
    budget.n--;
    this._carry = saved;
    if (rr && !rr.died && !this._resolvesDead(risen, rr) &&
        this._survivesRise(risen, depth - 1, true, rr.carry, this.SWAPS_PER_RISE, budget,
                           pos && [Math.min(pos[0] + (rr.rose ? 1 : 0), board.height), pos[1]])) {
      if (this._line) this._line.unshift(null);
      return true;
    }
    // OR MOVE FIRST -- any swap, before this row arrives.
    if (pre > 0) {
      var swaps = board.legalSwaps(), i, t, r;
      for (i = 0; i < swaps.length && budget.n > 0; i++) {
        t = board.clone();
        t.incoming = (carry && carry.nextRow) || (board.incoming === false ? false : (board.incoming || this._incoming || null));
        var cost = this.reaction +
                   (pos ? travel.cost(pos[0], pos[1], swaps[i][0], swaps[i][1]) : 0);
        this._carry = carry || null;
        r = this._resolveCandidate(t, swaps[i], cost);
        budget.n--;
        this._carry = saved;
        if (!r || r.refused || r.died || r.diedInWalk || this._resolvesDead(t, r)) continue;
        // A row that came during this move is this rise, done.
        if (r.rose ? (depth <= 1 ? this._survivesRise(t, 0, true, r.carry, 0, budget, swaps[i])
                                 : this._survivesRise(t, depth - 1, true, r.carry, this.SWAPS_PER_RISE, budget, swaps[i]))
                   : this._survivesRise(t, depth, true, r.carry, pre - 1, budget, swaps[i])) {
          if (this._line) this._line.unshift(swaps[i]);
          return true;
        }
      }
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

  // DROP EVERY MOVE THAT DOES NOT SURVIVE THE NEXT TWO ROWS, whenever one
  // that does is on the list. Asked on every decision.
  //
  // It used to be asked only when some candidate stood above row 8, to save
  // the cost on low boards -- on the claim that a low board survives every
  // rise. It does not: at seed 702 frame 1293 the tallest candidate stood at
  // row 8, the filter was skipped, 6 of 24 moves survived two rises, and the
  // bot played a raise that did not. A survivable move was on the list and it
  // played one that dies. The requirement is not a trade against cost.
  PuyoCpu.prototype.DOOMED_DEPTH = 2;
  // A move's line starts where the move's own resolve ended: its board, its
  // rise timer, its garbage still in the air, and the cursor on its square.
  // Starting from the live state instead hands every line back the frames
  // the move itself took.
  PuyoCpu.prototype._survivesAfter = function (cand, depth) {
    var k = cand.resolved && cand.resolved.carry;
    if (depth === this.DOOMED_DEPTH && this._board && this.stack && cand.kind !== 'raise') {
      if (cand.resolved && (cand.resolved.died || cand.resolved.diedInWalk)) return false;
      // The move itself at the same pace as the line after it; on the
      // server's board, from the decision's own root on the engine in C.
      var root = this.nativeCands && this.serverStack && this._candRoot ? this._candRoot
               : { b: this._board.clone(), carry: null, pos: [this.stack.curRow, this.stack.curCol], t: 0 };
      return this._lineSurvives(this._lineStep(root, cand.move || null, false), { n: this.SURVIVAL_BUDGET });
    }
    return this._survivesRise(this._settledOf(cand).clone(), depth, false, k || null,
                              undefined, undefined, cand.move || null);
  };

  // SAFE MEANS ALIVE FOR THE NEXT 240 FRAMES, WHATEVER THE WEIGHTS THINK.
  //
  // One question for every decision: from the board this move leaves, is
  // there a line that keeps the bot alive that long? A line is what the bot
  // can actually do -- at its own pace (walk, swap, one reaction before the
  // next decision, with panels still moving), through the engine's rules
  // (the stalling rule included) -- or waiting. The engine decides rows, stop
  // time, garbage and death.
  //
  // It replaced a check that asked "survive the next two rows, five swaps
  // before each, each after the board had settled", and a rescue bolted on
  // beside it. Topped out under stop time a row may never come while the bot
  // keeps clearing, and the saves are made mid-cascade: seed 700 frame 1867
  // had a save that check called doomed, and the weights ranked the match
  // that paid 136 frames of stop time 22nd of 23.
  //
  // So the search takes no weights. A long wait is tried first, which proves
  // an easy board in one resolve; then a beam over the bot's moves, keeping
  // the boards held longest (stop, pre-stop, shake), then least garbage,
  // then lowest stack. A line reaching the horizon alive proves the move.
  PuyoCpu.prototype.SURVIVE_FRAMES = 240;
  // A proof ends in a board that can then sit still this long past the
  // horizon. Alive at 240 and dead at 250 is a corridor, not a way out: seed
  // 702 frames 5105-5258 played three such lines into a death that a line
  // proven for 600 frames avoided.
  PuyoCpu.prototype.SURVIVE_REST = 120;
  PuyoCpu.prototype.SURVIVE_BEAM = 30;

  // ======================= LINES RUN ON THE ENGINE ITSELF =================
  //
  // A survival line is played on a copy of the live Stack object -- every
  // panel, every field -- by the bot's own update() logic: the raise it is
  // holding, its walk, its cooldown. Nothing is summarised and rebuilt, so
  // nothing can be lost in the rebuilding. What a player cannot know is all
  // that is changed: rows not yet shown and colours a break has not dealt
  // match nothing, and opponent garbage arrives only once it is truly sent.
  function unseenRow() {
    var k = (this.unseenRows = (this.unseenRows || 0) + 1), row = [null];
    for (var c = 1; c <= 6; c++) row[c] = 11 + ((c + 3 * k) % 6);
    return row;
  }
  function unseenBreak(count) {
    var k = (this.unseenBreaks = (this.unseenBreaks || 0) + 1), colors = [];
    for (var n = 0; n < count; n++) colors.push(21 + ((n + 3 * k) % 6));
    return colors;
  }
  function noRng() { return 0.5; }
  // Built by a constructor generated from the Stack's own field list, so
  // every copy has one fixed shape: an object grown field by field drops to
  // V8's dictionary mode and the engine runs several times slower on it.
  var cloneMakers = {};
  // Panels too, with one copier covering every field the engine writes on a
  // panel. garbageId and propagatesFalling are only on some panels; copied as
  // undefined where absent, which the engine reads the same. A field the
  // engine starts writing later would be dropped here -- checkModel reports
  // exactly that.
  var PANEL_FIELDS = ['row', 'col', 'id', 'color', 'chaining', 'matching', 'timer', 'initialTime', 'popTime',
                      'popIndex', 'xOffset', 'yOffset', 'gWidth', 'gHeight', 'shakeTime', 'isGarbage', 'state',
                      'comboIndex', 'comboSize', 'swapFromLeft', 'dontSwap', 'queuedHover', 'fellFromGarbage',
                      'stateChanged', 'propagatesChaining', 'matchAnyway', 'propagatesFalling', 'garbageId'];
  var copyPanel = new Function('p', 'return {' + PANEL_FIELDS.map(function (k) {
    return JSON.stringify(k) + ': p[' + JSON.stringify(k) + ']';
  }).join(', ') + '};');
  function panelCopier() { return copyPanel; }
  function copyValue(k, v) {
    if (k === 'panels') {
      var rows = new Array(v.length), copy = null, sig = null;
      for (var r = 0; r < v.length; r++) {
        var row = v[r], out = new Array(row.length);
        for (var c = 0; c < row.length; c++) {
          var p = row[c];
          if (p && typeof p === 'object') {
            if (!copy) copy = panelCopier(p);
            out[c] = copy(p);
          } else out[c] = p;
        }
        rows[r] = out;
      }
      return rows;
    }
    if (k === 'levelData' || k === 'frames') return v;
    if (k === 'events' || k === 'outgoing') return [];
    if (Array.isArray(v)) return v.map(function (x) { return x && typeof x === 'object' ? Object.assign({}, x) : x; });
    if (v && typeof v === 'object') return Object.assign({}, v);
    return v;
  }
  function cloneStack(src) {
    var keys = [];
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k) || typeof src[k] === 'function') continue;
      if (k === 'allowIdleSkip' || k === 'unseenRows' || k === 'unseenBreaks') continue;
      keys.push(k);
    }
    var sig = keys.join(',');
    var Make = cloneMakers[sig];
    if (!Make) {
      var body = keys.map(function (k2) { return 'this[' + JSON.stringify(k2) + '] = copy(' + JSON.stringify(k2) + ', s[' + JSON.stringify(k2) + ']);'; }).join('\n') +
                 '\nthis.rng = noRng; this.allowIdleSkip = false; this.generateRowColors = unseenRow;' +
                 '\nthis.garbageRowColors = unseenBreak; this.unseenRows = s.unseenRows || 0; this.unseenBreaks = s.unseenBreaks || 0;';
      Make = cloneMakers[sig] = new Function('copy', 'noRng', 'unseenRow', 'unseenBreak',
        'function C(s) {\n' + body + '\n}\nreturn C;')(copyValue, noRng, unseenRow, unseenBreak);
      Make.prototype = Object.getPrototypeOf(src);
    }
    return new Make(src);
  }
  PuyoCpu.cloneStack = cloneStack;

  // A BOARD AS NUMBERS, for handing to a worker thread. Every panel field is
  // an integer, a boolean, null, undefined or a state name; each gets its
  // own code so decoding gives back exactly what was encoded. The rest of
  // the Stack is small and travels as it is; levelData and frames are the
  // level's shared constants and are looked up on the other side.
  var NUL = -2147483648, UND = -2147483647, BT = -2147483646, BF = -2147483645, STR = -2147483600;
  var STATES = ['normal', 'dimmed', 'swapping', 'matched', 'popping', 'popped', 'hovering', 'falling', 'landing'];
  var NF = PANEL_FIELDS.length;
  function encodeStack(st) {
    var rows = st.panels, R = rows.length, buf = new Int32Array(R * 6 * NF), meta = {}, k, i = 0;
    for (k in st) {
      if (!Object.prototype.hasOwnProperty.call(st, k) || typeof st[k] === 'function') continue;
      if (k === 'panels' || k === 'levelData' || k === 'frames' || k === 'paStack') continue;
      meta[k] = st[k];
    }
    for (var r = 0; r < R; r++) {
      for (var c = 1; c <= 6; c++) {
        var p = rows[r][c];
        for (var f = 0; f < NF; f++) {
          var v = p[PANEL_FIELDS[f]];
          if (v === null) buf[i++] = NUL;
          else if (v === undefined) buf[i++] = UND;
          else if (v === true) buf[i++] = BT;
          else if (v === false) buf[i++] = BF;
          else if (typeof v === 'string') {
            var si = STATES.indexOf(v);
            if (si < 0) throw new Error('encodeStack: unknown panel state ' + v);
            buf[i++] = STR + si;
          } else {
            if ((v | 0) !== v || v <= STR + STATES.length) throw new Error('encodeStack: ' + PANEL_FIELDS[f] + '=' + v + ' is not a small integer');
            buf[i++] = v;
          }
        }
      }
    }
    return { meta: meta, rows: R, row0: rows[0] ? rows[0][0] : null, buf: buf };
  }
  var levelConsts = {};
  function decodeStack(e) {
    // rebuilt as a view of the server's board (PAEngine.View)
    var key = e.meta.level, lc = levelConsts[key];
    if (!lc) {
      var t = PAE().view(PAE().game({ level: e.meta.level }));
      lc = levelConsts[key] = { levelData: t.levelData, frames: t.frames };
    }
    var o = Object.create(PAE().View.prototype), k, i = 0, buf = e.buf;
    o.levelData = lc.levelData; o.frames = lc.frames;
    for (k in e.meta) o[k] = e.meta[k];
    var rows = new Array(e.rows);
    for (var r = 0; r < e.rows; r++) {
      var row = [e.row0];
      for (var c = 1; c <= 6; c++) {
        var p = {};
        for (var f = 0; f < NF; f++) {
          var v = buf[i++];
          p[PANEL_FIELDS[f]] = v === NUL ? null : v === UND ? undefined : v === BT ? true : v === BF ? false
            : (v >= STR && v < STR + STATES.length) ? STATES[v - STR] : v;
        }
        row[c] = p;
      }
      rows[r] = row;
    }
    o.panels = rows;
    return cloneStack(o);
  }
  PuyoCpu.encodeStack = encodeStack;
  PuyoCpu.decodeStack = decodeStack;

  function engineGrid(st) {
    var H = st.height, grid = [], key = '', r, c;
    for (r = 0; r <= H + 1; r++) {
      var row = st.panels[r], g = [0];
      for (c = 1; c <= 6; c++) {
        var p = row && row[c];
        if (!p || p.color === 0) g[c] = 0;
        else g[c] = p.isGarbage ? -2 : p.color;
        if (r >= 1 && p) key += (p.isGarbage ? '#' : p.color) + p.state.charAt(0) + (p.timer || '') + ',';
      }
      grid[r] = g;
    }
    return { grid: grid, key: key };
  }
  PuyoCpu.prototype._engineNode = function (st, t, hold, arrivals, fresh) {
    var g = engineGrid(st);
    return {
      st: st, t: t, hold: hold, arrivals: arrivals, fresh: !!fresh,
      pos: [st.curRow, st.curCol],
      carry: { stopTime: st.stopTime || 0, preStopTime: st.preStopTime || 0, shakeTime: st.shakeTime || 0,
               displacement: st.displacement, riseTimer: st.riseTimer, speed: st.speed },
      b: { grid: g.grid, key: g.key, height: st.height, width: 6,
           legalSwaps: function () {
             var out = [];
             for (var r = 1; r <= st.height; r++) for (var c = 1; c < 6; c++) {
               var a = st.panels[r][c], b2 = st.panels[r][c + 1];
               if (a.isGarbage || b2.isGarbage) continue;
               if (a.color === 0 && b2.color === 0) continue;
               if (a.color === b2.color) continue;
               if (!st.canSwap(r, c)) continue;
               out.push([r, c]);
             }
             return out;
           } }
    };
  };
  function NativeMod() {
    if (typeof module === 'object' && module.exports) return require('./native.js');
    var g = typeof self !== 'undefined' ? self : globalThis;
    return g.PanelEval && g.PanelEval.Native;
  }
  // The engine in C's nodes for this bot, emptied at each decision.
  PuyoCpu.prototype._natSearch = function () {
    // On threads, this thread and threads - 1 workers share the level loop.
    // The search plays serverStack (a pa-engine.js Stack: the panel-game
    // server's rules) on native/pa.c; the bot's own stack is the view of that
    // board the rest of the bot reads.
    if (!this._nat) this._nat = new (NativeMod().server.Search)({ reaction: this.reaction || 0, cursorMoveFrames: this.cursorMoveFrames, swapGap: this.swapGap, threads: this.threads || 1 });
    this._nat.configure(this.reaction || 0, this.cursorMoveFrames, this.SURVIVE_FRAMES, this.SURVIVE_REST);
    return this._nat;
  };
  PuyoCpu.prototype._engineRoot = function () {
    var saved = this._carry;
    this._carry = null;
    var arr = this._inFlight().map(function (a) { return { at: a.at, width: a.width, height: a.height, isChain: a.isChain }; });
    this._carry = saved;
    if (this.native && this.serverStack) {
      // Garbage in flight on the server's rules is what its caller read off the
      // senders' telegraphs (serverArrivals: at in frames from this board).
      return this._natSearch().root(this.serverStack.copy(), { left: this.raiseFrames || 0, started: !!this._raiseStarted }, this.serverArrivals || [], false);
    }
    return this._engineNode(cloneStack(this.stack), 0,
                            { left: this.raiseFrames || 0, started: !!this._raiseStarted }, arr, true);
  };
  // One decision of the bot, played frame by frame from the start of the
  // node's frame: kind 'swap' (m), 'hold', 'raise', or 'long' (hold until
  // frames have passed). Returns the node at the bot's next decision, a dead
  // marker { dead: true, t }, or null when the swap is refused.
  PuyoCpu.prototype._engineAdvance = function (node, kind, m, frames) {
    if (this._abort && this._abort()) throw ABORTED;
    if (node._nat) return node._nat.advance(node, kind, m, frames);
    return this._engineAdvanceOn(cloneStack(node.st), node, kind, m, frames);
  };
  // `plain`: the node is only the board, the frame, the raise in hand and the
  // garbage on its way (a prediction on the server's rules, _paRoot).
  PuyoCpu.prototype._engineAdvanceOn = function (st, node, kind, m, frames, plain) {
    var bot = { stack: st, cursorMoveFrames: this.cursorMoveFrames, _walk: null, cooldown: 0, _lastSwap: null,
                _beginWalk: PanelCpu.beginWalk, _driveWalk: PanelCpu.driveWalk,
                _nearestSwappable: PanelCpu.nearestSwappable,
                raiseFrames: node.hold.left, _raiseStarted: node.hold.started };
    var arr = node.arrivals.map(copyArrival);
    // The decision frame. At the root, update() has already run the raise
    // step and set this frame's input; everywhere else it runs it now.
    var input = node.fresh ? Object.assign({}, st.input) : {};
    if (!node.fresh) raiseStep(bot, st, input);
    if (kind === 'swap') {
      bot._beginWalk(m[0], m[1], this.reaction);
      bot._driveWalk(input);
    } else if (kind === 'raise') {
      bot.raiseFrames = 20; bot._raiseStarted = false; bot.cooldown = this.reaction;
    } else if (kind === 'hold') {
      bot.cooldown = this.reaction;
    }
    return this._runFrom(st, bot, arr, 0, input, node, kind, frames, plain);
  };
  function copyArrival(a) { return { at: a.at, width: a.width, height: a.height, isChain: a.isChain }; }
  // The step from frame f on: `input` is that frame's, already driven.
  PuyoCpu.prototype._runFrom = function (st, bot, arr, f, input, node, kind, frames, plain) {
    function runFrame(input) {
      st.setInput(input);
      st.run();
      st.events.length = 0;
      f++;
      for (var i = 0; i < arr.length; ) {
        if (arr[i].at <= f) {
          var g = { width: arr[i].width, height: arr[i].height, isChain: arr[i].isChain };
          if (plain) st.receiveGarbage([g]); else st.incoming.push(g);
          arr.splice(i, 1);
        } else i++;
      }
      return st.gameOver;
    }
    var refused = function () { return kind === 'swap' && !bot._walk && !bot._lastSwap; };
    if (refused() || (bot._walk && bot._walk.retries)) return null;
    if (runFrame(input)) return { dead: true, t: node.t + f };
    for (var guard = 0; guard < 4000; guard++) {
      if (kind === 'long' && f >= frames) break;
      input = {};
      raiseStep(bot, st, input);
      if (bot._walk) {
        bot._driveWalk(input);
        if (refused() || (bot._walk && bot._walk.retries)) return null;
        if (runFrame(input)) return { dead: true, t: node.t + f };
        continue;
      }
      if (kind !== 'long') {
        if (bot.cooldown > 0) { bot.cooldown--; if (runFrame(input)) return { dead: true, t: node.t + f }; continue; }
        break;
      }
      if (runFrame(input)) return { dead: true, t: node.t + f };
    }
    arr.forEach(function (a) { a.at -= f; });
    if (plain) return { st: st, t: node.t + f, hold: { left: bot.raiseFrames, started: bot._raiseStarted }, arrivals: arr, fresh: false };
    return this._engineNode(st, node.t + f, { left: bot.raiseFrames, started: bot._raiseStarted }, arr, false);
  };

  // Thrown out of a search its brain was told to stop (Mind's `abort`).
  var ABORTED = PuyoCpu.ABORTED = { aborted: true };
  PuyoCpu.prototype._engineStep = function (node, m, long) {
    var r;
    if (node._nat) {
      if (this._abort && this._abort()) throw ABORTED;
      var until = long ? (this._lineUntil || (this.SURVIVE_FRAMES + (this._restNeeded ? this.SURVIVE_REST : 0))) : 0;
      return node._nat.step(node, m, long, until);
    }
    if (long) {
      var until = this._lineUntil || (this.SURVIVE_FRAMES + (this._restNeeded ? this.SURVIVE_REST : 0));
      // THE BOT WAITS IN WHOLE HOLDS. A hold is reaction + 1 frames before it
      // can act again, so a wait the bot is to act after ends on that beat.
      var beat = (this.reaction || 0) + 1, fr = Math.max(1, until - node.t);
      r = this._engineAdvance(node, 'long', null, Math.ceil(fr / beat) * beat);
    } else if (m === 'raise') r = this._engineAdvance(node, 'raise', null, 0);
    else r = this._engineAdvance(node, m ? 'swap' : 'hold', m, 0);
    if (!r) return null;
    if (r.dead) {
      // Alive at the horizon but not through the rest: the end of the road.
      if (long && r.t >= this.SURVIVE_FRAMES) {
        return { st: node.st, b: node.b, carry: node.carry, pos: node.pos, hold: node.hold, arrivals: node.arrivals,
                 t: r.t, dead: true };
      }
      return null;
    }
    return r;
  };

  // Steps taken on this thread, for a brain that counts its time in steps
  // (LocalBrain `steps`).
  PuyoCpu.steps = 0;
  PuyoCpu.prototype._lineStep = function (node, m, long) {
    PuyoCpu.steps++;
    if (node._nat || node.st) return this._engineStep(node, m, long);
    var t = node.b.clone(), r, used, saved = this._carry, savedFrom = this._walkFrom;
    t.incoming = (node.carry && node.carry.nextRow) ||
                 (node.b.incoming === false ? false : (node.b.incoming || this._incoming || null));
    this._carry = node.carry || null;
    this._walkFrom = node.pos || null;
    if (m) {
      var w = node.pos ? travel.cost(node.pos[0], node.pos[1], m[0], m[1]) : 0;
      // The engine walks the cursor there, swaps, and runs the whole
      // reaction: the bot's next decision comes reaction + 1 frames after the
      // swap frame, the same as a hold's reaction + 1.
      r = this._resolveCandidate(t, m, w, false, this.reaction + 1, true);
      used = (r && r.walked !== undefined ? r.walked : w) + ((r && r.elapsed) || 0);
    } else if (long) {
      // To the horizon and REST frames past it, rows and all: an easy board
      // is proven in one resolve.
      var until = this._lineUntil || (this.SURVIVE_FRAMES + (this._restNeeded ? this.SURVIVE_REST : 0));
      r = this._resolveCandidate(t, null, 0, false, Math.max(1, until - node.t), true);
      used = (r && r.elapsed) || 0;
      // Alive at the horizon but not through the rest: a line, not a resting
      // place, and the end of the road for this one.
      if (r && r.died && !r.diedInWalk && node.t + (r.diedAt || 0) >= this.SURVIVE_FRAMES) {
        this._carry = saved;
        this._walkFrom = savedFrom;
        return { b: t, carry: r.carry || null, pos: node.pos, t: node.t + (r.diedAt || 0), dead: true };
      }
    } else {
      r = this._resolveCandidate(t, null, this.reaction, false, 1);
      used = this.reaction + ((r && r.elapsed) || 0);
    }
    this._carry = saved;
    this._walkFrom = savedFrom;
    if (!r || r.refused || r.died || r.diedInWalk) return null;
    var pos = r.cursor || m || (node.pos && [Math.min(node.pos[0] + (r.rose ? 1 : 0), node.b.height), node.pos[1]]);
    return { b: t, carry: r.carry || null, pos: pos, t: node.t + Math.max(1, used) };
  };
  // THE MODEL AGAINST THE GAME. The line predicted this board; the game dealt
  // one. Both are played forward through the engine, doing nothing, and the
  // first frame they part is recorded with the cells and fields that differ.
  // Garbage sent since the prediction is a real difference, not a model
  // error, and is recorded as such.
  PuyoCpu.prototype.CHECK_FRAMES = 60;
  PuyoCpu.prototype._checkModel = function (live, predicted) {
    this.modelChecks = (this.modelChecks || 0) + 1;
    if (predicted.st && live.st) {
      var a = live.st, b = predicted.st, cells = [], rr, cc;
      for (rr = 0; rr <= a.height + 1; rr++) for (cc = 1; cc <= 6; cc++) {
        var pa = a.panels[rr] && a.panels[rr][cc], pb = b.panels[rr] && b.panels[rr][cc];
        if (!pa || !pb) continue;
        if (pb.color >= 11) continue;       // dealt since: new information
        var ka = (pa.isGarbage ? '#' : pa.color) + ':' + pa.state + '/' + pa.timer,
            kb = (pb.isGarbage ? '#' : pb.color) + ':' + pb.state + '/' + pb.timer;
        if (ka !== kb) cells.push('(' + rr + ',' + cc + ') game ' + ka + ' model ' + kb);
      }
      var fields = ['stopTime', 'preStopTime', 'shakeTime', 'displacement', 'riseTimer', 'speed', 'curRow', 'curCol', 'manualRaise', 'health'], fd = [];
      fields.forEach(function (f) { if (a[f] !== b[f]) fd.push(f + ' game ' + a[f] + ' model ' + b[f]); });
      var newG = JSON.stringify(a.incoming.map(function (g) { return g.width + 'x' + g.height; })) !==
                 JSON.stringify(b.incoming.map(function (g) { return g.width + 'x' + g.height; }));
      if (cells.length || fd.length) this.modelMismatches.push({ clock: this.stack.clock, after: 0, newGarbage: newG, played: this._lastPlayed,
                                                            game: fd.join(', '), model: '', cells: cells.slice(0, 8) });
      return;
    }
    var self = this;
    function run(nd, k) {
      var t = nd.b.clone(), sv = self._carry, sf = self._walkFrom;
      t.incoming = (nd.carry && nd.carry.nextRow) ||
                   (nd.b.incoming === false ? false : (nd.b.incoming || self._incoming || null));
      self._carry = nd.carry || null;
      self._walkFrom = nd.pos || null;
      var r = self._resolveCandidate(t, null, 0, false, k, true);
      self._carry = sv; self._walkFrom = sf;
      return { b: t, r: r };
    }
    function key(x, rr, cc) {
      var g = x.b.grid[rr] && x.b.grid[rr][cc], m = x.b.motion && x.b.motion[rr] && x.b.motion[rr][cc];
      return g + ':' + (m ? m.state + '/' + m.timer : '-');
    }
    function held(x) {
      var k = x.r && x.r.carry;
      return k ? [k.stopTime, k.preStopTime, k.shakeTime, k.displacement, !!x.r.died].join(',') : '';
    }
    var queued = JSON.stringify(((predicted.carry && predicted.carry.incoming) || []).map(function (g) { return g.width + 'x' + g.height; })),
        now = JSON.stringify((this.stack.incoming || []).map(function (g) { return g.width + 'x' + g.height; }));
    for (var k = 1; k <= this.CHECK_FRAMES; k++) {
      var a = run(live, k), b = run(predicted, k), cells = [], rr, cc;
      for (rr = 0; rr <= 13; rr++) for (cc = 1; cc <= 6; cc++) {
        var ka = key(a, rr, cc), kb = key(b, rr, cc);
        // A panel the prediction could not know (a row or a break dealt
        // since) is new information, not a model error.
        var mv = b.b.grid[rr] && b.b.grid[rr][cc];
        if (ka !== kb && !(mv >= 11)) cells.push('(' + rr + ',' + cc + ') game ' + ka + ' model ' + kb);
      }
      if (cells.length || held(a) !== held(b)) {
        this.modelMismatches.push({ clock: this.stack.clock, after: k, newGarbage: queued !== now, played: this._lastPlayed,
                                    game: held(a), model: held(b), cells: cells.slice(0, 8) });
        return;
      }
    }
  };
  PuyoCpu.prototype._heldFor = function (k) {
    return k ? (k.stopTime || 0) + (k.preStopTime || 0) + (k.shakeTime || 0) : 0;
  };
  // ONE SEARCH PER DECISION, shared by every move: each first move starts a
  // branch, the branches grow together, and a move is proven the moment one of
  // its lines reaches the horizon. Proven moves stop drawing on the budget; the
  // rest keep at least SURVIVE_QUOTA boards each so none is crowded out. On an
  // easy board the first long wait proves nearly every move at once.
  PuyoCpu.prototype.SURVIVE_SEARCH_BEAM = 200;
  PuyoCpu.prototype.SURVIVE_QUOTA = 4;
  PuyoCpu.prototype.SURVIVE_SEEDS = 30;
  PuyoCpu.prototype.SURVIVE_SEARCH_BUDGET = 60000;
  PuyoCpu.prototype.SURVIVE_SEARCH_BUDGET_CHEAP = 4000;
  PuyoCpu.prototype.SURVIVE_BEST_CAP = 64;
  PuyoCpu.prototype.FOLLOW_FAST = 540;
  // The followed line replayed from this board, or null when it is not
  // followed here or no longer reaches FOLLOW_FAST frames alive.
  PuyoCpu.prototype._fastFollow = function (root, cands) {
    var fl = this._following, i, j, n, c;
    if (!fl || !fl.steps || !fl.steps.length) return null;
    if (fl.hold && fl.at > this.stack.clock) {
      var dt = fl.at - this.stack.clock;
      fl = { at: this.stack.clock, steps: [{ long: dt }].concat(fl.steps.map(function (x) { return isLong(x) ? { long: x.long + dt } : x; })) };
    }
    if (fl.at !== this.stack.clock) return null;
    var want = fl.steps[0], fi = -1;
    for (i = 0; i < cands.length; i++) {
      var ck = cands[i];
      if (want === 'raise' ? ck.kind === 'raise'
          : Array.isArray(want) ? (ck.kind === 'swap' && ck.move && ck.move[0] === want[0] && ck.move[1] === want[1])
          : ck.kind === 'hold') { fi = i; break; }
    }
    if (fi < 0) return null;
    var cd = cands[fi];
    if (cd.resolved && (cd.resolved.died || cd.resolved.diedInWalk)) return null;
    n = root;
    for (j = 0; j < fl.steps.length; j++) {
      var sm = fl.steps[j], lg = isLong(sm);
      if (lg) {
        var su = this._lineUntil;
        this._lineUntil = sm.long !== undefined ? sm.long : su;
        c = this._lineStep(n, null, true);
        this._lineUntil = su;
      } else c = this._lineStep(n, sm, false);
      if (!c || c.dead) break;
      c.prev = j ? n : null; c.m = lg ? 'long' : sm; c.tag = fi;
      n = c;
    }
    if (n === root || n.dead || n.t < this.FOLLOW_FAST) return null;
    if (this.checkModel && fl.node && fl.node.st) this._checkModel(root, fl.node);
    return { fi: fi, n: n };
  };
  function isLong(m) { return m === 'long' || (!!m && typeof m === 'object' && !Array.isArray(m) && m.long !== undefined); }
  PuyoCpu.prototype._survivalSearch = function (cands) {
    var verdict = new Array(cands.length), level = [], self = this, i, j, n, c, proofs = {}, weak = {};
    // HOW FAR EACH MOVE'S BEST LINE GOT, dead or alive, and the node that got
    // there. When no move reaches the horizon, the one that lives longest is
    // played and its line followed.
    var reach = {}, far = {};
    function note(tag, x) { if (x && (reach[tag] === undefined || x.t > reach[tag])) { reach[tag] = x.t; far[tag] = x; } }
    var FULL = this.SURVIVE_FRAMES + this.SURVIVE_REST, savedRest = this._restNeeded;
    this._restNeeded = true;
    // A real engine Stack is copied and played, and so is the server's board
    // behind a view; a harness's stand-in stack (puzzles.play.js) has no
    // engine to copy and keeps the painted path.
    var real = (this.native && this.serverStack) ||
               (this.stack && typeof this.stack.run === 'function' && typeof this.stack.setInput === 'function' && this.stack.panels);
    var root = real ? this._engineRoot()
                    : { b: this._board.clone(), carry: null, pos: [this.stack.curRow, this.stack.curCol], t: 0 };
    var open = 0;
    this._searchProofs = { cands: cands, proofs: proofs, reach: reach, far: far, root: root };
    // A FOLLOWED LINE STILL ALIVE WELL PAST THE HORIZON IS THE ANSWER. Its
    // next move is played without searching the others; the full search runs
    // again once what is left of the line drops under FOLLOW_FAST frames.
    var fast = real && this.FOLLOW_FAST ? this._fastFollow(root, cands) : null;
    if (fast) {
      for (i = 0; i < cands.length; i++) verdict[i] = i === fast.fi ? 'proven' : 'skipped';
      proofs[fast.fi] = fast.n; reach[fast.fi] = fast.n.t; far[fast.fi] = fast.n;
      this._following = null;
      this.followFast = (this.followFast || 0) + 1;
      this._restNeeded = savedRest;
      return verdict;
    }
    for (i = 0; i < cands.length; i++) {
      var cd = cands[i];
      if (cd.resolved && (cd.resolved.died || cd.resolved.diedInWalk)) { verdict[i] = 'dies'; continue; }
      c = cd.kind === 'raise'
        ? (root.st ? this._lineStep(root, 'raise', false)
                   : { b: this._settledOf(cd).clone(), carry: cd.resolved.carry || null, pos: root.pos, t: cd.resolved.elapsed || 0 })
        : this._lineStep(root, cd.move || null, false);
      if (!c) { verdict[i] = 'dies'; continue; }
      c.tag = i; c.m = cd.kind === 'raise' ? 'raise' : (cd.move || null);
      note(i, c);
      if (c.t >= FULL) { verdict[i] = 'proven'; proofs[i] = c; if (this._proofs) this._proofs[i] = c; continue; }
      if (c.t >= this.SURVIVE_FRAMES && !weak[i]) weak[i] = c;
      c.first = true; level.push(c); open++;
    }
    // THE LINE BEING FOLLOWED IS STILL A PROOF. The bot played the first move
    // of a line proven last decision, at the line's own pace, so the rest of
    // that line is alive on this board to the old horizon; a wait from its
    // end covers the frames since. Replayed first, it cannot be pruned.
    var fl = this._following;
    this._following = null;
    if (this.checkModel && fl && fl.at === this.stack.clock && fl.node && fl.node.st) this._checkModel(root, fl.node);
    // A LINE THAT STARTS WITH A WAIT is played as a hold, and the bot decides
    // again before the wait is over: the rest of the wait comes first.
    if (fl && fl.hold && fl.at > this.stack.clock) {
      var dt = fl.at - this.stack.clock;
      fl = { at: this.stack.clock, steps: [{ long: dt }].concat(fl.steps.map(function (x) { return isLong(x) ? { long: x.long + dt } : x; })) };
    }
    if (fl && fl.at === this.stack.clock && fl.steps.length) {
      var want = fl.steps[0], fi = -1;
      for (i = 0; i < cands.length; i++) {
        var ck = cands[i];
        if (want === 'raise' ? ck.kind === 'raise'
            : Array.isArray(want) ? (ck.kind === 'swap' && ck.move && ck.move[0] === want[0] && ck.move[1] === want[1])
            : ck.kind === 'hold') { fi = i; break; }
      }
      if (fi >= 0 && verdict[fi] !== 'proven') {
        this.followTried = (this.followTried || 0) + 1;
        n = root;
        // The WHOLE line, not the first horizon of it: a line extended past
        // the horizon last decision is kept, not searched for again.
        for (j = 0; j < fl.steps.length && n && !n.dead; j++) {
          var sm = fl.steps[j], lg = isLong(sm);
          if (lg) {
            // A wait ends where it ended when the line was found, not at this
            // search's horizon.
            var su = this._lineUntil;
            this._lineUntil = sm.long !== undefined ? sm.long : su;
            c = this._lineStep(n, null, true);
            this._lineUntil = su;
          } else c = this._lineStep(n, sm, false);
          if (c) { c.prev = j ? n : null; c.m = lg ? 'long' : sm; c.tag = fi; note(fi, c); }
          if (!c) break;
          // The line's wait ran out in the frames since it was proven: alive
          // at the horizon is still a fallback, and the search goes on from
          // the board before the wait, not from the dead one.
          if (c.dead) { if (c.t >= this.SURVIVE_FRAMES && !weak[fi]) weak[fi] = c; break; }
          n = c;
        }
        if (n && !n.dead && j === fl.steps.length && n.t < FULL) {
          c = this._lineStep(n, null, true);
          if (c) { c.prev = n; c.m = 'long'; c.tag = fi; note(fi, c); }
          if (c && !c.dead) n = c;
          else if (c && !weak[fi]) weak[fi] = c;
        }
        if (n && n.t >= FULL) {
          verdict[fi] = 'proven'; proofs[fi] = n; if (this._proofs) this._proofs[fi] = n;
          this.followHeld = (this.followHeld || 0) + 1;
        } else if (n && n !== root && !n.dead) {
          // The line reached the old horizon and no further: the search goes
          // on from where it ends, with a few moves to find, not a whole line.
          n.tag = fi; n.seed = true;
          level.unshift(n);
        }
      }
    }
    level = level.filter(function (x) { return !verdict[x.tag]; });
    // The one-ply bot exists to be cheap: the same search, a smaller budget.
    var budget = (this.depth || 1) > 1 ? this.SURVIVE_SEARCH_BUDGET : this.SURVIVE_SEARCH_BUDGET_CHEAP;
    function garb(b) { return b._garb !== undefined ? b._garb : (b._garb = garbageCells(b)); }
    function top(b) { return b._top !== undefined ? b._top : (b._top = topRow(b)); }
    // A board is guaranteed alive until its time plus what holds it (stop,
    // pre-stop, shake): the nearer that is to the horizon, the better.
    function better(x, y) {
      return ((y.t + self._heldFor(y.carry)) - (x.t + self._heldFor(x.carry))) || (garb(x.b) - garb(y.b)) || (top(x.b) - top(y.b));
    }
    // BEST FIRST (surviveSearch 'best', experimental): each move keeps its
    // own boards, and in turn each open move expands the one of them that
    // lives longest; a move stops at its first line to the horizon, and dies
    // when it has no board left.
    if (this.surviveSearch === 'best') {
      var heaps = {}, seenT = {}, order = [], CAP = this.SURVIVE_BEST_CAP;
      for (i = 0; i < level.length; i++) {
        var lt = level[i].tag;
        if (!heaps[lt]) { heaps[lt] = []; seenT[lt] = {}; order.push(lt); }
        heaps[lt].push(level[i]);
      }
      order.sort(function (a, b) { return a - b; });
      var anyOpen = true;
      while (anyOpen && budget > 0) {
        anyOpen = false;
        for (var oi = 0; oi < order.length && budget > 0; oi++) {
          var tg = order[oi], hp = heaps[tg];
          if (verdict[tg] || !hp.length) continue;
          anyOpen = true;
          hp.sort(function (x, y) { return (x.seed ? 0 : 1) - (y.seed ? 0 : 1) || better(x, y); });
          n = hp.shift();
          var mv = [ 'long', null ].concat(n.b.legalSwaps());
          for (j = 0; j < mv.length && budget > 0; j++) {
            budget--;
            c = mv[j] === 'long' ? this._lineStep(n, null, true) : this._lineStep(n, mv[j], false);
            if (!c) continue;
            c.tag = tg; c.prev = n; c.m = mv[j]; c.seed = n.seed;
            note(tg, c);
            if (c.t >= FULL && !c.dead) { verdict[tg] = 'proven'; proofs[tg] = c; if (this._proofs) this._proofs[tg] = c; break; }
            if (c.t >= this.SURVIVE_FRAMES && !weak[tg]) weak[tg] = c;
            if (c.dead) continue;
            var hk = (c.b.key || JSON.stringify(c.b.grid)) + '|' + this._heldFor(c.carry) + '|' + c.pos;
            if (seenT[tg][hk]) continue;
            seenT[tg][hk] = 1;
            hp.push(c);
          }
          if (hp.length > CAP) { hp.sort(better); hp.length = CAP; }
        }
      }
      level = [];
      for (i = 0; i < order.length; i++) if (!verdict[order[i]]) level = level.concat(heaps[order[i]]);
    }
    // ON THREADS every board of the level is played on the workers, which
    // keep them; what comes back is what this loop reads of each, and the
    // loop is the same one.
    // ON THE ENGINE IN C the loop below runs there (native.js loop), the same
    // loop over the same nodes.
    if (root._nat && this.surviveSearch !== 'best' && level.length && budget > 0) {
      var nl = { ntags: cands.length, verdict: verdict, proofs: proofs, weak: weak, reach: reach, far: far, level: level,
                 budget: budget, until: this._lineUntil || FULL, full: FULL, beam: this.SURVIVE_SEARCH_BEAM,
                 quota: this.SURVIVE_QUOTA, seeds: this.SURVIVE_SEEDS, newlyProven: [] };
      var left = root._nat.loop(nl, this._abort, ABORTED);
      PuyoCpu.steps += budget - left;
      budget = left; level = nl.level;
      if (this._proofs) for (i = 0; i < nl.newlyProven.length; i++) this._proofs[nl.newlyProven[i]] = proofs[nl.newlyProven[i]];
    }
    while (this.surviveSearch !== 'best' && level.length && budget > 0) {
      var next = [], seen = {};
      for (i = 0; i < level.length && budget > 0; i++) {
        n = level[i];
        if (verdict[n.tag]) continue;
        var moves = [ 'long', null ].concat(n.b.legalSwaps());
        for (j = 0; j < moves.length && budget > 0; j++) {
          budget--;
          c = moves[j] === 'long' ? this._lineStep(n, null, true) : this._lineStep(n, moves[j], false);
          if (!c) continue;
          c.tag = n.tag; c.prev = n; c.m = moves[j]; c.seed = n.seed;
          note(n.tag, c);
          if (c.t >= FULL && !c.dead) { verdict[n.tag] = 'proven'; proofs[n.tag] = c; if (this._proofs) this._proofs[n.tag] = c; break; }
          if (c.t >= this.SURVIVE_FRAMES && !weak[n.tag]) weak[n.tag] = c;
          if (c.dead) continue;
          var h = n.tag + '|' + (c.b.key || JSON.stringify(c.b.grid)) + '|' + this._heldFor(c.carry) + '|' + c.pos;
          if (seen[h]) continue;
          seen[h] = 1;
          next.push(c);
        }
      }
      next = next.filter(function (x) { return !verdict[x.tag]; });
      next.sort(better);
      var keep = [], per = {}, seeds = 0;
      // The followed line's continuations first: they are frames from the
      // horizon, where the rest of the beam starts from the root.
      for (i = 0; i < next.length && seeds < this.SURVIVE_SEEDS; i++) {
        if (next[i].seed) { keep.push(next[i]); next[i].kept = true; seeds++; }
      }
      for (i = 0; i < next.length; i++) {           // the quota first
        if (next[i].kept) continue;
        if ((per[next[i].tag] || 0) < this.SURVIVE_QUOTA) { per[next[i].tag] = (per[next[i].tag] || 0) + 1; keep.push(next[i]); next[i].kept = true; }
      }
      // A move already alive at the horizon looks for its resting place on
      // its quota alone; the rest of the beam goes to moves not yet alive.
      for (i = 0; i < next.length && keep.length < this.SURVIVE_SEARCH_BEAM; i++) if (!next[i].kept && !weak[next[i].tag]) keep.push(next[i]);
      level = keep.slice(0, seeds).concat(keep.slice(seeds).sort(better));
    }
    // A move with lines still open when the budget ran out is not proven dead.
    var alive = {};
    for (i = 0; i < level.length; i++) alive[level[i].tag] = true;
    for (i = 0; i < cands.length; i++) {
      if (verdict[i]) continue;
      // Alive at the horizon without a resting place in sight.
      if (weak[i]) { verdict[i] = 'weak'; proofs[i] = weak[i]; if (this._proofs) this._proofs[i] = weak[i]; continue; }
      verdict[i] = alive[i] && budget <= 0 ? 'unproven' : 'dies';
    }
    this._searchProofs.left = Math.max(0, budget);
    this._restNeeded = savedRest;
    return verdict;
  };

  // A node's board never changes, so what the beam sorts it by is read once.
  function garbageCells(b) { var g = 0; for (var r = 1; r < b.grid.length; r++) if (b.grid[r]) for (var q = 1; q <= b.width; q++) if (b.grid[r][q] === -2) g++; return g; }
  function topRow(b) { for (var r = b.grid.length - 1; r >= 1; r--) if (b.grid[r]) for (var q = 1; q <= b.width; q++) { var v = b.grid[r][q]; if (v && v !== -1) return r; } return 0; }
  PuyoCpu.prototype._lineSurvives = function (start, budget) {
    if (!start) return false;
    if (start.t >= this.SURVIVE_FRAMES) return true;
    var level = [start], self = this, i, j, n, c;
    function garb(b) { return b._garb !== undefined ? b._garb : (b._garb = garbageCells(b)); }
    function top(b) { return b._top !== undefined ? b._top : (b._top = topRow(b)); }
    while (level.length) {
      var next = [], seen = {};
      for (i = 0; i < level.length; i++) {
        n = level[i];
        var moves = [ 'long', null ].concat(n.b.legalSwaps());
        for (j = 0; j < moves.length; j++) {
          if (budget.n <= 0) { this.survivalUnproven = (this.survivalUnproven || 0) + 1; return true; }
          budget.n--;
          c = moves[j] === 'long' ? this._lineStep(n, null, true) : this._lineStep(n, moves[j], false);
          if (!c) continue;
          if (c.t >= this.SURVIVE_FRAMES) return true;
          var h = (c.b.key || JSON.stringify(c.b.grid)) + '|' + this._heldFor(c.carry) + '|' + c.pos;
          if (seen[h]) continue;
          seen[h] = 1;
          next.push(c);
        }
      }
      next.sort(function (x, y) {
        return (self._heldFor(y.carry) - self._heldFor(x.carry)) || (garb(x.b) - garb(y.b)) || (top(x.b) - top(y.b));
      });
      level = next.slice(0, this.SURVIVE_BEAM);
    }
    return false;
  };
  PuyoCpu.prototype._doomed = function (cands) {
    if (!this.refuseSuicide || !this.deepSurvival || !cands || cands.length < 2) return cands;
    if (!this._board) return cands;
    var i, proven = [], weakly = [], unproven = [];
    var svT = Date.now(), verdict = this._survivalSearch(cands);
    this._svMs = (this._svMs || 0) + Date.now() - svT;   // the survival search's milliseconds, read and cleared by the caller
    var breakWeak = [];
    for (i = 0; i < cands.length; i++) {
      if (verdict[i] === 'proven') proven.push(cands[i]);
      else if (verdict[i] === 'weak') {
        weakly.push(cands[i]);
        if (this.preferRank && this.preferRank(cands[i], i) === 0) breakWeak.push(cands[i]);
      }
      else if (verdict[i] === 'unproven') unproven.push(cands[i]);
    }
    if (!proven.length) proven = weakly;
    // A BREAK THE CALLER ASKS FOR (preferRank 0) THAT LIVES THE HORIZON STANDS
    // with the moves proven past it. Under a stream every line dies a little
    // past the horizon, and the ones dying last are the ones that wait, so
    // proof past it picks waiting over breaking: seed 2 frame 11557, a break
    // reaching 312 frames dropped for a wait reaching 372, dead 780 later.
    else if (breakWeak.length) proven = proven.concat(breakWeak);
    proven = this._noBareThree(proven);
    // measureLife: the proven moves the engine shows living longest, then
    // keeping the most panels, before the caller's order is applied to them.
    if (this.measureLife && proven.length > 1) proven = this._measureLife(proven);
    // The caller's moves first (preferRank, see _decide): of those proven to
    // live, before the proven ones are narrowed to the line that lives longest.
    // preferProven ranks the same way, but only here, among the proven.
    if ((this.preferRank || this.preferProven) && proven.length) proven = this._preferred(proven, proven, true);
    // A move the search ran out of budget on is a guess. When any move is
    // proven to live, the guesses are dropped.
    var live = proven.length ? proven : unproven;
    this.allDoomedNow = !live.length;
    // ALL DOOMED IS NOT GIVING UP. Under a stream no line outlives the
    // horizon, so this is most of such a game: the caller's breaks and
    // lineups (preferRank) come first, and of those the one living longest.
    if (!live.length) {
      this.doomedDecisions++;
      var breaking = this.preferRank ? this._preferred(cands, []) : [];
      return this._longestLived(breaking.length ? breaking : cands);
    }
    if (proven.length > 1) {
      // A line already known to run past the horizon (the one being followed)
      // beats lines that only reach it; nothing needs extending to see that.
      var known = this._longestKnown(live);
      if (known) live = known;
      else if (this.EXTEND_FRAMES && proven.length < cands.length) live = this._furthest(live);
    }
    if (live.length > 1) live = this._mostRoom(live, cands);
    else live = this._deepestLine(live);
    if (live.length === cands.length) return cands;
    this.doomedMovesDropped += cands.length - live.length;
    return live;
  };

  // HOW LONG EACH MOVE KEEPS THE BOARD ALIVE, MEASURED ON THE ENGINE. Each
  // proven move's line is searched on from its proof, by the same level loop,
  // to LIFE_FRAMES: what a break, a pop, a clear or a swap buys is what the
  // engine plays out, not a price set beside it. Kept, in order: the moves
  // whose line is alive at the window's end, then those whose line breaks
  // garbage (a break is what keeps the board alive past the window), then
  // those whose furthest board holds the most panels (what garbage is broken
  // with), then the longest lived. The line found becomes the proof the bot follows. It
  // searches with what the survival search left of its budget, and never
  // less than a quarter of it.
  PuyoCpu.prototype.LIFE_FRAMES = 900;
  PuyoCpu.prototype._measureLife = function (live) {
    var sp = this._searchProofs, S = this._nat, i, k;
    if (!sp || !S) return live;
    var n = sp.cands.length, verdict = [], proofs = {}, weak = {}, reach = {}, far = {}, level = [], at = [];
    for (i = 0; i < n; i++) verdict[i] = 'skip';
    for (i = 0; i < live.length; i++) {
      k = sp.cands.indexOf(live[i]);
      var pf = k >= 0 ? sp.proofs[k] : null;
      if (!pf || !pf._nat || pf.dead) continue;
      verdict[k] = false; pf.tag = k; pf.seed = false; reach[k] = pf.t; far[k] = pf;
      level.push(pf); at.push(k);
    }
    if (level.length < 2) return live;
    var o = { ntags: n, verdict: verdict, proofs: proofs, weak: weak, reach: reach, far: far, level: level,
              budget: Math.max(sp.left || 0, Math.round(this.SURVIVE_SEARCH_BUDGET / 4)), until: this.LIFE_FRAMES, full: this.LIFE_FRAMES, beam: this.SURVIVE_SEARCH_BEAM,
              quota: this.SURVIVE_QUOTA, seeds: this.SURVIVE_SEEDS, newlyProven: [] };
    S.loop(o, this._abort, ABORTED);
    function panels(x) {
      var g = x && x.b && x.b.grid, m = 0, r, c;
      if (g) for (r = 1; r < g.length; r++) if (g[r]) for (c = 1; c <= 6; c++) if (g[r][c] > 0) m++;
      return m;
    }
    var rootBrk = sp.root && sp.root._nat ? S.breaks(sp.root) : 0, key = {}, best = null;
    function before(a, b) { for (var q = 0; q < a.length; q++) if (a[q] !== b[q]) return a[q] > b[q]; return false; }
    for (i = 0; i < at.length; i++) {
      k = at[i];
      var alive = o.verdict[k] === 'proven', end = alive ? o.proofs[k] : o.far[k];
      var broke = end && end.b ? (S.breaks(end) > rootBrk ? 1 : 0) : 0;
      key[k] = [alive ? 1 : 0, broke, panels(end), alive ? this.LIFE_FRAMES : Math.min(o.reach[k] || 0, this.LIFE_FRAMES)];
      if (end && !end.dead && end.t > sp.proofs[k].t) sp.proofs[k] = end;
      if (!best || before(key[k], best)) best = key[k];
    }
    this.lifeMeasured = { alive: best[0], broke: best[1], panels: best[2], life: best[3], of: at.length };
    var out = live.filter(function (c) { var q = sp.cands.indexOf(c); return key[q] && key[q].join() === best.join(); });
    return out.length ? out : live;
  };

  // NOTHING REACHES THE HORIZON: PLAY THE MOVE THAT LIVES LONGEST. Its
  // furthest line becomes the one followed, so a line still alive is never
  // traded for one that dies sooner because both fall short of "now + horizon".
  PuyoCpu.prototype._longestLived = function (cands) {
    var sp = this._searchProofs, best = -1, i;
    if (!sp || !sp.reach) return cands;
    for (i = 0; i < cands.length; i++) if (sp.reach[i] !== undefined && sp.reach[i] > best) best = sp.reach[i];
    if (best < 0) return cands;
    var keep = [];
    for (i = 0; i < cands.length; i++) {
      if (sp.reach[i] !== best) continue;
      keep.push(cands[i]);
      sp.proofs[i] = sp.far[i];
    }
    return keep;
  };

  // SAFE MOVES ARE NOT EQUALLY SAFE. Each proven line is carried on past the
  // horizon by waiting, through the engine, and the moves whose lines live
  // longest are the ones offered; the weights choose among those. Chosen by
  // score alone, the bot walks to the edge one safe move at a time: seed 700
  // side 1, 19 proven moves, then 10, 6, 1, 2, and none.
  // TEN SECONDS OUT, NOT FOUR. On a board where some moves already die, each
  // proven line is searched on from where it ends to EXTEND_FRAMES, and the
  // moves whose lines get furthest are the ones offered; the furthest line
  // becomes the proof the bot follows. Seed 703 frame 1601: seven moves
  // proven for 360 frames, six of them good for 720, and the one played
  // was the seventh.
  PuyoCpu.prototype.EXTEND_FRAMES = 720;
  PuyoCpu.prototype.EXTEND_BEAM = 24;
  PuyoCpu.prototype.EXTEND_BUDGET = 2500;
  PuyoCpu.prototype._extendLine = function (start) {
    if (start.dead) return start;
    var self = this, until = this.EXTEND_FRAMES, best = start, budget = this.EXTEND_BUDGET, i, j, n, c;
    var saved = this._lineUntil, savedRest = this._restNeeded;
    this._lineUntil = until;
    var level = [start];
    while (level.length && budget > 0 && best.t < until) {
      var next = [], seen = {};
      for (i = 0; i < level.length && budget > 0 && best.t < until; i++) {
        n = level[i];
        var moves = [ 'long', null ].concat(n.b.legalSwaps());
        for (j = 0; j < moves.length && budget > 0; j++) {
          budget--;
          // with an answer due (_dueAt) the line is as far as it got by then
          if ((budget & 15) === 0 && this._abort && this._abort()) throw ABORTED;
          if (this._dueAt && (budget & 15) === 0 && Date.now() >= this._dueAt) { budget = 0; break; }
          c = moves[j] === 'long' ? this._lineStep(n, null, true) : this._lineStep(n, moves[j], false);
          if (!c) continue;
          c.prev = n; c.m = moves[j]; c.tag = start.tag;
          if (c.t > best.t) best = c;
          if (c.dead || c.t >= until) { if (c.t >= until) break; continue; }
          var h = (c.b.key || JSON.stringify(c.b.grid)) + '|' + this._heldFor(c.carry) + '|' + c.pos;
          if (seen[h]) continue;
          seen[h] = 1;
          next.push(c);
        }
      }
      next.sort(function (x, y) { return (y.t + self._heldFor(y.carry)) - (x.t + self._heldFor(x.carry)); });
      level = next.slice(0, this.EXTEND_BEAM);
    }
    this._lineUntil = saved;
    this._restNeeded = savedRest;
    return best;
  };
  // A proof's time.
  function proofTime(o, k) {
    var d = Object.getOwnPropertyDescriptor(o, k);
    if (d && d.get && d.get.t !== undefined) return d.get.t;
    return o[k] ? o[k].t : 0;
  }
  PuyoCpu.prototype._longestKnown = function (live) {
    var sp = this._searchProofs, FULL = this.SURVIVE_FRAMES + this.SURVIVE_REST, best = FULL, i, k, t;
    if (!sp) return null;
    for (i = 0; i < live.length; i++) {
      k = sp.cands.indexOf(live[i]);
      t = k >= 0 ? proofTime(sp.proofs, k) : 0;
      if (t > best) best = t;
    }
    if (best <= FULL) return null;
    var keep = [];
    for (i = 0; i < live.length; i++) {
      k = sp.cands.indexOf(live[i]);
      if (k >= 0 && proofTime(sp.proofs, k) === best) keep.push(live[i]);
    }
    return keep;
  };
  // IN SCORE ORDER, STOPPING AT THE FIRST LINE THAT REACHES EXTEND_FRAMES:
  // no move can beat that, so the best-scoring move alive that far is the
  // answer and the rest are not extended. With an answer due (_dueAt), a line
  // is extended only while the slowest so far would still finish before then,
  // and the moves are chosen among those extended.
  PuyoCpu.prototype._furthest = function (live) {
    var sp = this._searchProofs, best = -1, reach = [], i, k, e, q, slowest = 0;
    if (!sp) return live;
    var order = live.map(function (x, n) { return n; });
    order.sort(function (a, b) { return (live[b].score || 0) - (live[a].score || 0); });
    for (q = 0; q < order.length; q++) {
      if (this._abort && this._abort()) throw ABORTED;
      var et = Date.now();
      if (this._dueAt && et + slowest > this._dueAt) break;
      i = order[q];
      k = sp.cands.indexOf(live[i]);
      e = k >= 0 && sp.proofs[k] ? this._extendLine(sp.proofs[k]) : null;
      reach[i] = e ? Math.min(e.t, this.EXTEND_FRAMES) : 0;
      if (e && !e.dead && e.t >= sp.proofs[k].t) sp.proofs[k] = e;
      if (reach[i] > best) best = reach[i];
      if (reach[i] >= this.EXTEND_FRAMES) return [live[i]];
      slowest = Math.max(slowest, Date.now() - et);
    }
    var keep = [];
    for (i = 0; i < live.length; i++) if (reach[i] !== undefined && reach[i] === best) keep.push(live[i]);
    return keep.length ? keep : live;
  };
  PuyoCpu.prototype.SLACK_FRAMES = 480;
  PuyoCpu.prototype._slack = function (node) {
    if (node.dead) return 0;
    if (node.st) {
      var e = this._engineAdvance(node, 'long', null, this.SLACK_FRAMES);
      if (!e) return 0;
      return e.dead ? Math.max(0, e.t - node.t) : this.SLACK_FRAMES;
    }
    var t = node.b.clone(), saved = this._carry, savedFrom = this._walkFrom;
    t.incoming = (node.carry && node.carry.nextRow) ||
                 (node.b.incoming === false ? false : (node.b.incoming || this._incoming || null));
    this._carry = node.carry || null;
    this._walkFrom = node.pos || null;
    var r = this._resolveCandidate(t, null, 0, false, this.SLACK_FRAMES, true);
    this._carry = saved;
    this._walkFrom = savedFrom;
    if (!r) return 0;
    return (r.died || r.diedInWalk) ? (r.diedAt || 0) : this.SLACK_FRAMES;
  };
  PuyoCpu.prototype._mostRoom = function (live, cands) {
    var sp = this._searchProofs, best = -1, room = [], i, k, pf, slowest = 0;
    if (!sp) return live;
    // With an answer due (_dueAt), as _furthest: measured while the slowest so far would still finish.
    for (i = 0; i < live.length; i++) {
      if (this._abort && this._abort()) throw ABORTED;
      var rt = Date.now();
      if (this._dueAt && rt + slowest > this._dueAt) break;
      k = sp.cands.indexOf(live[i]);
      pf = k >= 0 ? sp.proofs[k] : null;
      room.push(pf ? this._slack(pf) : 0);
      if (room[i] > best) best = room[i];
      slowest = Math.max(slowest, Date.now() - rt);
    }
    var keep = [];
    for (i = 0; i < room.length; i++) if (room[i] === best) keep.push(live[i]);
    return keep.length ? keep : live;
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
  PuyoCpu.prototype._survivalDepth = function (cand, from, max) {
    var d = from;
    while (d < max && this._survivesAfter(cand, d + 1)) d++;
    return d;
  };
  PuyoCpu.prototype._deepestLine = function (live) {
    if (!this.deepestLine || !live || live.length < 2) return live;
    var best = -1, depths = [], i, d;
    for (i = 0; i < live.length; i++) {
      d = this._survivalDepth(live[i], this.DOOMED_DEPTH,
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
  function bareThree(c) {
    var r = c && c.resolved, sizes = r && r.comboSizes;
    if (!sizes || !sizes.length || (r.brokeGarbage || 0) > 0 || (r.chainLength || 0) >= 2) return false;
    for (var i = 0; i < sizes.length; i++) if (sizes[i] > 3) return false;
    return true;
  }
  // Is this swap, among the decision's candidates, a move of bare threes.
  PuyoCpu.prototype.threeOnlySwap = function (move) {
    var all = this._allCands || [];
    for (var i = 0; i < all.length; i++)
      if (all[i].kind === 'swap' && all[i].move && all[i].move[0] === move[0] && all[i].move[1] === move[1]) return bareThree(all[i]);
    return false;
  };
  PuyoCpu.prototype._noBareThree = function (cands) {
    if (!this.refuseBareThree || !cands || !cands.length) return cands;
    // Topped out with nothing holding the stack (no stop time, no clear
    // running, no garbage shaking it), a three is played as any move is: the
    // next frame without a clear is the last.
    var st = this.stack || {};
    var bare = !(st.stopTime > 0) && !(st.preStopTime > 0) && !(st.shakeTime > 0);
    if (bare && (st.wasToppedOut || (this._board && this._boardToppedOut(this._board)))) {
      if (cands.some(bareThree)) this.bareThreesTopped++;
      return cands;
    }
    var live = cands.filter(function (c) { return !bareThree(c); });
    if (live.length === cands.length) return cands;
    if (!live.length) { this.bareThreesKept++; return cands; }
    this.bareThreesDropped += cands.length - live.length;
    return live;
  };
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

  // THE SHORTEST WAY TO A BREAK, walked the way the game plays it. Every
  // follow-up move pays its reaction and its walk from the square before, and
  // the board ages on the engine's clock between them, as a survival line
  // does. Any garbage counts: a 5x1 lid on a low stack is where the bot held
  // for a whole row with a two-swap break on the board (seed 700 frame 520).
  // Breadth first, so a candidate is kept only if it starts a line as short
  // as the shortest found; a line cut off by the budget is not claimed.
  PuyoCpu.prototype.TOWARD_DEPTH = 2;
  PuyoCpu.prototype.TOWARD_BUDGET = 3000;
  // Each candidate's node, settled from the server's board on the engine in C
  // (nativeCands); one context for the decision, reset at its start.
  // A reply's settle runs this many frames at most: while a slab pops nothing
  // is still until it is done, and the reply's own clears are long over by then.
  PuyoCpu.prototype.REPLY_SETTLE = 180;
  PuyoCpu.prototype._nativeNodes = function (cands) {
    if (!this.nativeCands || !this.serverStack || !cands) return;
    if (cands.natDone) return;
    if (!this._candNat) this._candNat = new (NativeMod().server.Search)({ reaction: this.reaction || 0, cursorMoveFrames: this.cursorMoveFrames, swapGap: this.swapGap, threads: this.threads || 1 });
    var S = this._candNat, i;
    S.reset();
    var root = S.root(this.serverStack.copy(), { left: this.raiseFrames || 0, started: !!this._raiseStarted }, this.serverArrivals || [], false);
    this._candRoot = root;
    var steps = [], at = [], got = [];
    for (i = 0; i < cands.length; i++) {
      var c = cands[i];
      got[i] = null;
      if (c.kind === 'swap') { at.push(i); steps.push([root, c.move]); }
      else if (c.kind === 'hold') { at.push(i); steps.push([root, null]); }
      else if (c.kind === 'raise') {
        var up = S.advance(root, 'raise', null, 0);
        if (up && !up.dead) { at.push(i); steps.push([up, null]); } else got[i] = up;
      }
    }
    var settled = S.settleMany(steps, 0);
    for (i = 0; i < at.length; i++) got[at[i]] = settled[i];
    // A SETTLE THAT DIES IDLE IS NOT A MOVE THAT DIES. The settle plays no key
    // till the board is quiet, and a break keeps it busy for hundreds of
    // frames: topped out, the board lives while anything moves and dies the
    // frame it stops, so the move that buys the most life was the one judged
    // dead. Such a move is settled again to the frame before that death; the
    // survival search plays the move's own step and judges it.
    var redo = [], ri = [];
    for (i = 0; i < at.length; i++) {
      var dn = settled[i], room = dn && dn.dead ? dn.t - steps[i][0].t - 1 : 0;
      if (room >= 2) { redo.push([steps[i][0], 'settle', steps[i][1], room]); ri.push(at[i]); }
    }
    if (redo.length) {
      var again = S.advanceMany(redo);
      for (i = 0; i < ri.length; i++) if (again[i] && !again[i].dead) got[ri[i]] = again[i];
    }
    for (i = 0; i < cands.length; i++) {
      var n = got[i];
      cands[i].natNode = n && !n.dead ? n : null;
      cands[i].natDead = !!(n && n.dead);
      cands[i].natDeadAt = n && n.dead ? n.t : null;
    }
  };
  // A settle step as a resolve: the board it leaves written into `board`, and
  // what it did: chain depth, panels cleared, garbage sent.
  PuyoCpu.prototype._nativeResolved = function (n, from, board) {
    // A step that dies has no board: the reply is scored as one that dies.
    if (n.dead && !n.b) return { comboSizes: [], chainLength: 0, clearedPanels: 0, brokeGarbage: 0, stopTimeEarned: 0,
                                  garbage: [], died: true, elapsed: n.t - from.t, stopTime: 0, shakeTime: 0 };
    var g = n.b.grid, r, c;
    board.grid = [];
    for (r = 0; r < g.length; r++) { board.grid[r] = [0]; for (c = 1; c <= board.width; c++) board.grid[r][c] = g[r] ? g[r][c] || 0 : 0; }
    if (board.grid.length < board.height + 1) for (r = board.grid.length; r <= board.height; r++) { board.grid[r] = [0]; for (c = 1; c <= board.width; c++) board.grid[r][c] = 0; }
    board.blocks = {}; board.motion = null; board.chaining = null; board.queuedSwap = null;
    var st = this._candNat.stepStats(n), chain = 0;
    for (var i = 0; i < st.chainAt.length; i++) if (st.chainAt[i] > chain) chain = st.chainAt[i];
    return { comboSizes: st.comboSizes, chainLength: st.comboSizes.length ? Math.max(chain, 1) : 0,
             clearedPanels: st.cleared, brokeGarbage: st.broke, stopTimeEarned: st.earned,
             garbage: st.broke > 0 ? [[st.broke, 1]] : [], died: !!n.dead, elapsed: n.t - from.t,
             stopTime: n.carry ? n.carry.stopTime : 0, shakeTime: n.carry ? n.carry.shakeTime : 0 };
  };
  PuyoCpu.prototype._towardBreak = function (cands) {
    if (!this.towardBreak || !cands || cands.length < 2 || !this._board) return cands;
    if (!this._garbageOn(this._board) && !(this.stack && this.stack.incoming && this.stack.incoming.length)) return cands;
    var hit = [], any = false, level = [], i, j;
    var cur = this.stack ? [this.stack.curRow, this.stack.curCol] : null;
    for (i = 0; i < cands.length; i++) {
      var res = cands[i].resolved;
      if (!res || res.died || res.diedInWalk || cands[i].natDead) continue;
      if ((res.brokeGarbage || 0) > 0) { hit[i] = true; any = true; continue; }
      level.push({ root: i, board: this._settledOf(cands[i]), carry: res.carry || null,
                   pos: cands[i].move || cur, nat: cands[i].natNode && this._candNat ? cands[i].natNode : null });
    }
    var budget = this.TOWARD_BUDGET, saved = this._carry;
    for (var d = 2; !any && d <= this.TOWARD_DEPTH && level.length && budget > 0; d++) {
      var next = [];
      for (i = 0; i < level.length && budget > 0; i++) {
        var node = level[i];
        if (hit[node.root]) continue;
        if (node.nat) {
          // On the engine in C: the walk, the swap and the settle in one step.
          var ns = node.nat.b.legalSwaps(), batch = [];
          for (j = 0; j < ns.length && j < budget; j++) batch.push([node.nat, ns[j]]);
          var made = this._candNat.settleMany(batch, this.REPLY_SETTLE);
          for (j = 0; j < ns.length && budget > 0; j++) {
            var nn = made[j];
            budget--;
            if (!nn || nn.dead) continue;
            if (this._candNat.stepStats(nn).broke > 0) { hit[node.root] = true; any = true; break; }
            if (d < this.TOWARD_DEPTH) next.push({ root: node.root, nat: nn });
          }
          continue;
        }
        var swaps = node.board.legalSwaps();
        for (j = 0; j < swaps.length && budget > 0; j++) {
          var t = node.board.clone();
          t.incoming = (node.carry && node.carry.nextRow) ||
                       (node.board.incoming === false ? false : (node.board.incoming || this._incoming || null));
          var cost = this.reaction + (node.pos ? travel.cost(node.pos[0], node.pos[1], swaps[j][0], swaps[j][1]) : 0);
          this._carry = node.carry;
          var r = this._resolveCandidate(t, swaps[j], cost);
          this._carry = saved;
          budget--;
          if (!r || r.refused || r.died || r.diedInWalk) continue;
          if ((r.brokeGarbage || 0) > 0) { hit[node.root] = true; any = true; break; }
          if (d < this.TOWARD_DEPTH) next.push({ root: node.root, board: t, carry: r.carry || null, pos: swaps[j] });
        }
      }
      level = next;
    }
    if (!any) return cands;
    var live = [];
    for (i = 0; i < cands.length; i++) if (hit[i]) live.push(cands[i]);
    if (live.length === cands.length) return cands;
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

    // ON THE SERVER'S ENGINE (nativeCands): every first move is settled by the
    // engine in C from the server's board, and its resolve read from that
    // settle (_nativeResolved); a swap the engine refuses is no candidate.
    var natural = this.nativeCands && this.serverStack && this.engine, nat = null;
    if (natural) {
      nat = [{ kind: 'hold' }];
      if (this._canRaise()) nat.push({ kind: 'raise' });
      board.legalSwaps().forEach(function (m) { nat.push({ kind: 'swap', move: m }); });
      this._nativeNodes(nat);
    }
    var self = this;
    function natOf(kind, m) {
      for (var q = 0; q < nat.length; q++) if (nat[q].kind === kind && (!m || (nat[q].move[0] === m[0] && nat[q].move[1] === m[1]))) return nat[q];
      return null;
    }
    function natResolved(x, b) {
      if (!x || (!x.natNode && !x.natDead)) return { refused: true };
      var n = x.natNode || { dead: true, t: x.natDeadAt };
      return self._nativeResolved(n, self._candRoot, b);
    }
    var holdBoard = board.clone();
    var holdResolved = natural ? natResolved(natOf('hold'), holdBoard) : this._resolveCandidate(holdBoard, null, this.reaction);
    var cands = [{ kind: 'hold',
                   score: this._score(holdBoard, holdResolved, null),
                   board: this._scoredBoard,
                   settled: holdBoard,
                   resolved: holdResolved,
                   risen: this._scoredResolved,
                   travel: this._scoredTravel,
                   earnedStop: holdResolved.stopTimeEarned || 0 }];

    var natRaise = natural ? natOf('raise') : null;
    if (this._canRaise() && !(natural && !(natRaise && (natRaise.natNode || natRaise.natDead)))) {
      // The row the engine will actually deal, resolved, because a raise
      // can complete a match and that match is the reason to make it.
      var raiseBoard = board.clone().rise(this._incoming);
      // THE RAISE SPENDS THE KNOWN ROW. The one behind it is dealt from the
      // match's rng, which this code does not read, so the engine's own
      // generator makes it (false = unknown; see _resolveCandidate). Copying
      // the known row into its place invents matches the game will not deal:
      // seed 703 frame 3014 was certified on a copy and nothing survived
      // thirteen frames later on the real row. A row that matches nothing
      // forbids the ones it will: measured over the same ten games, 23.1s
      // against 28.6s without it.
      raiseBoard.incoming = false;
      var raiseResolved = natural ? natResolved(natOf('raise'), raiseBoard) : this._resolveCandidate(raiseBoard);
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
      // A RAISE IS OFFERED ONLY IF IT IS LEGAL AND DOES NOT KILL. Legal is
      // _canRaise, above. "Does not kill" is the same survival check every
      // other move faces -- asked of the raise itself, not left to the filter,
      // because the filter lets everything back in when nothing survives, and
      // a raise is the one move that pushes the stack up on purpose.
      if (!(this.refuseSuicide && (this._raiseIsSuicide(raiseBoard) ||
                                   this._raiseWhileBroke(raiseBoard, raiseResolved) ||
                                   raiseResolved.died ||
                                   this._resolvesDead(raiseBoard, raiseResolved) ||
                                   !this._lineSurvives(natural ? natOf('raise').natNode
                                                       : { b: raiseBoard.clone(), carry: raiseResolved.carry || null,
                                                           pos: [this.stack.curRow, this.stack.curCol],
                                                           t: raiseResolved.elapsed || 0 },
                                                       { n: this.SURVIVAL_BUDGET })))) {
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
      if (natural) resolved = natResolved(natOf('swap', [r, c]), trial);
      else if (this.engine) {
        // The engine ages the board and makes the swap itself.
        this._walkFrom = [this.stack.curRow, this.stack.curCol];
        resolved = this._resolveCandidate(trial, [r, c], delay);
        this._walkFrom = null;
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
    if (natural) {
      // the nodes already settled, carried over
      cands.forEach(function (cd) { var x = natOf(cd.kind, cd.kind === 'swap' ? cd.move : null); cd.natNode = x ? x.natNode : null; cd.natDead = !!(x && x.natDead); });
      cands.natDone = true;
    }
    this._nativeNodes(cands);
    this._allCands = cands;
    var out = this._levelForSlab(this._flatten(this._towardBreak(
        this._notAnUndo(this._heightCap(this._noBareThree(this._doomed(this._survivors(cands))))))));
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
  // The moves of `list` preferRank puts first, or `none` when it ranks none;
  // `proven`: the list is moves proven to live, which preferProven ranks too.
  PuyoCpu.prototype._preferred = function (list, none, proven) {
    var sp = this._searchProofs, self = this, best = Infinity;
    var ranks = list.map(function (c) {
      var i = sp ? sp.cands.indexOf(c) : -1;
      var r = self.preferRank ? self.preferRank(c, i) : Infinity;
      if (proven && self.preferProven) r = Math.min(r, self.preferProven(c, i));
      if (r < best) best = r; return r;
    });
    if (!(best < Infinity)) return none;
    var top = list.filter(function (c, i) { return ranks[i] === best; });
    // NEAREST FIRST (opts.nearestFirst): of moves ranked the same, the ones
    // the cursor reaches soonest.
    if (this.nearestFirst && top.length > 1) {
      var near = Infinity;
      top.forEach(function (c) { if (c.travel != null && c.travel < near) near = c.travel; });
      if (near < Infinity) top = top.filter(function (c) { return c.travel == null || c.travel === near; });
    }
    return top;
  };
  PuyoCpu.prototype._decide = function () {
    // The engine in C's nodes last one decision. The line being followed is
    // compared with the board next decision (checkModel), so its board is
    // read out first.
    if (this._nat) {
      if (this._following && this._following.node && this._following.node._nat) void this._following.node.st;
      this._nat.reset();
    }
    // preferRank(cand, index in the survival search's candidates): the
    // caller's order for moves to play before any other, lower first,
    // Infinity for none (survivor_mind.js: how soon a move breaks garbage).
    // Of the moves every filter kept, the best ranked are the pool; the modes
    // do not get to refuse them.
    var pool = this._candidates(), pick = this.preferRank ? this._preferred(pool, []) : [];
    var cands = pick.length ? pick : this._applyModes(pool);

    // HOLD IS CANDIDATE ZERO, not a separate case carried alongside the
    // others. It was the separate case, and that is how it ended up judged
    // one move deep while every swap was judged two -- waiting always
    // looked worse than acting, and waiting is how a chain gets built.
    // THE SECOND PLY AND THE CLOCK. With an answer due (_dueAt, Date.now()
    // time, set by the caller), it is skipped when the slowest recent one
    // (_lookMs, decaying) would not finish before then, and given up
    // part-way (_lookahead returns null) when it is running past it.
    if (this.depth > 1 && !(this._dueAt && Date.now() + (this._lookMs || 0) > this._dueAt)) {
      var lt = Date.now(), la = this._lookahead(cands);
      this._lookMs = Math.max((this._lookMs || 0) * 0.95, Date.now() - lt);
      if (la) return la;
    }

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
    var engine = PAE();
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
    // The engine already said so.
    if (resolved && (resolved.died || resolved.diedInWalk)) return true;
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
    // The proven line behind the move played, for the next decision to
    // continue (see _survivalSearch).
    var sp = this._searchProofs;
    this._searchProofs = null;
    this._following = null;
    this._proofLine = null;
    this._lastPlayed = cand ? (cand.move ? '[' + cand.move + ']' : cand.kind) : null;
    if (sp && cand && this.stack) {
      var k = sp.cands.indexOf(cand), pf = k >= 0 ? sp.proofs[k] : null, line = [];
      for (var q = pf; q; q = q.prev) line.unshift(q);
      this._proofLine = line.length > 1 ? { at: this.stack.clock, line: line } : null;
      if (line.length > 1) {
        var t0 = line[0].t;
        this._following = { at: this.stack.clock + t0, node: line[0], hold: cand.kind === 'hold',
                            steps: line.slice(1).map(function (x) { return isLong(x.m) ? { long: x.t - t0 } : x.m; }) };
      }
    }
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
    var engine = PAE();
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
    var nat = cand.natNode && this._candNat ? cand.natNode : null;
    // A move whose own settle dies on the server's rules has no replies.
    var next = cand.natDead ? [] : nat ? nat.b.legalSwaps() : cand.board.legalSwaps();
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
    var j, f, made = null;
    if (nat) {
      var batch = [];
      for (j = 0; j < next.length; j++) batch.push([nat, next[j]]);
      made = this._candNat.settleMany(batch, this.REPLY_SETTLE);
    }
    for (j = 0; j < next.length; j++) {
      var child = cand.board.clone(), childResolved;
      if (nat) {
        var n2 = made[j];
        if (!n2) continue;   // the engine refuses this swap from there
        childResolved = this._nativeResolved(n2, nat, child);
      } else {
        child.swap(next[j][0], next[j][1]);
        childResolved = this._resolveCandidate(child);
      }
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
    // Not after a raise: the engine will not serve two in a row. On the
    // server's board a move the engine in C refused or died of has no replies.
    if (cand.kind !== 'raise' && this._canRaise() && !(this.nativeCands && this.serverStack && !nat)) {
      var risen = cand.board.clone().rise(this._incoming), risenResolved;
      if (nat) {
        // On the engine in C, as the first ply raises: the raise, then the settle.
        var up = this._candNat.advance(nat, 'raise', null, 0);
        var upSettled = up && !up.dead ? this._candNat.settleMany([[up, null]], this.REPLY_SETTLE)[0] : up;
        risenResolved = upSettled ? this._nativeResolved(upSettled, nat, risen)
                                  : { comboSizes: [], chainLength: 0, clearedPanels: 0, brokeGarbage: 0, stopTimeEarned: 0,
                                      garbage: [], died: true, elapsed: 0, stopTime: 0, shakeTime: 0 };
      } else risenResolved = this._resolveCandidate(risen);
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

    // With an answer due (_dueAt), a candidate is valued only while the
    // slowest one so far would still finish before then; otherwise the
    // second ply is given up (null) and the move is chosen one deep.
    var values = new Array(expand.length), slowest = 0;
    for (i = 0; i < expand.length; i++) {
      if (this._abort && this._abort()) throw ABORTED;
      var vt = Date.now();
      if (this._dueAt && vt + slowest > this._dueAt) return null;
      values[i] = this._value(expand[i]);
      slowest = Math.max(slowest, Date.now() - vt);
    }

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

  // REAL TIME. Thinking takes time, so a decision is asked for ahead of its
  // frame, on the board the engine says that frame will hold, and played only
  // if on its frame the real board, the raise in hand and the garbage in
  // flight are the ones it was made on. The one thing a prediction cannot
  // know is the colours of rows and breaks dealt in between; it decides with
  // them unseen, as the search does beyond the board it has. A brain that
  // answers on the spot is asked about the real board instead, and then each
  // decision is exactly the one the bot makes deciding on the frame.
  //
  // Every decision comes with the line that proved it: moves and the boards
  // they lead to, alive to the horizon. That line is the plan. The next
  // decision is asked for at the first board of the plan far enough ahead
  // for the brain to finish (brain.lead() frames), and until the answer is
  // due the bot plays the plan, each move only on the board the plan
  // expected. With answers that keep up, the plan's first board is the very
  // next decision and the bot plays exactly as it does deciding on the frame.
  // With no answer and no plan to play, it holds.
  //
  // A brain has request(bot, point, acted) -> { at, point, decision }, the
  // decision filled in once made; poll(p, clock), if it has one, called on
  // every frame the answer is waited for; and lead(). `acted` says whether
  // its last decision was played.
  function raiseStep(h, st, input) {
    if (h.raiseFrames > 0) {
      if (st.manualRaise) h._raiseStarted = true;
      if (st.preventManualRaise || (h._raiseStarted && !st.manualRaise)) h.raiseFrames = 0;
      else { h.raiseFrames--; input.raise = true; }
    }
  }
  // A decision frame as update() finds it: the node's board with that frame's
  // raise step taken and its input set.
  function pointOf(n) {
    if (!n || n.dead) return null;
    var st = cloneStack(n.st), h = { raiseFrames: n.hold.left, _raiseStarted: n.hold.started }, input = {};
    raiseStep(h, st, input);
    st.setInput(input);
    return { at: st.clock, enc: encodeStack(st), raiseFrames: h.raiseFrames, raiseStarted: h._raiseStarted,
             arrivals: n.arrivals };
  }
  var pointOfStack = pointOf;

  // THE ROWS THE GAME WILL HAVE DEALT BY THEN ARE SEEN. A prediction runs on
  // a copy of the real board that keeps the game's own generator, so a row or
  // a break dealt before the frame predicted has the colours it will have --
  // the colours the bot deciding on that frame would see. (The search itself
  // still cannot see past the board it is given.) Such a point is exact, and
  // an answer made on it is played only if the board matches it exactly.
  // ON THE SERVER'S RULES. A bot whose stack is a view of a pa-engine.js board
  // (PAEngine.view: stack.paStack) predicts on a copy of that board, which
  // keeps the server's generator: every point is exact, and is the view of
  // the board predicted, as the bot will read it on that frame.
  function PAE() {
    var g = typeof window !== 'undefined' ? window : globalThis;
    return g.PAEngine || (typeof require === 'function' ? require('../../pa-engine.js') : null);
  }
  // A FRAME ON THE SERVER'S RULES: the bot reads `pa` (a pa-engine.js stack)
  // and its opponent's through PAEngine.view, and its search plays `pa` itself
  // on native/pa.c with the garbage on its way, as the game's brain does.
  PuyoCpu.prototype.onServer = function (pa, opp) {
    var P = PAE();
    this.stack = P.view(pa);
    this.opponent = opp ? P.view(opp) : null;
    this.serverStack = pa;
    this.serverArrivals = this._inFlight().map(function (a) {
      return { at: Math.max(1, a.at), width: a.width, height: a.height, isChain: !!a.isChain, isMetal: !!a.isMetal };
    });
    this.native = true;
    this.nativeCands = true;
  };
  // A bot on pa-engine.js stack `pa`, reading it afresh before every update.
  PuyoCpu.onPA = function (pa, opts, opp) {
    var cpu = new PuyoCpu(PAE().view(pa), opts), update = cpu.update;
    cpu.update = function () { this.onServer(pa, opp); return update.apply(this, arguments); };
    cpu.onServer(pa, opp);
    return cpu;
  };
  PuyoCpu.prototype._paRoot = function () {
    var pa = this.stack && this.stack.paStack;
    if (!pa) return null;
    // the view refuses a swap the board cannot make (PAEngine.view), so the copy does
    var st = pa.copy(), press = st.tryQueueSwap;
    st.tryQueueSwap = function (row, col) { return this.canSwap(row, col) && press.call(this, row, col); };
    return { st: st, t: 0, hold: { left: this.raiseFrames || 0, started: !!this._raiseStarted },
             arrivals: this._inFlight().map(copyArrival), fresh: true };
  };
  PuyoCpu.prototype._paStep = function (n, kind, m, frames) {
    if (!n || n.dead) return n;
    return this._engineAdvanceOn(n.st, n, kind, m, frames, true);
  };
  // `seen`: the board's rows and breaks are the game's own (a prediction), so
  // the point is exact. The point carries the server's board itself
  // (`server`), for a brain that searches on the server's rules.
  function paPointOf(n, unseen) {
    if (!n || n.dead || n.st.gameOver) return null;
    var st = n.st.copy(), h = { raiseFrames: n.hold.left, _raiseStarted: n.hold.started }, input = {};
    delete st.tryQueueSwap;
    var v = PAE().view(st);
    raiseStep(h, v, input);
    v.setInput(input);
    var server = {};
    for (var k in st) if (Object.prototype.hasOwnProperty.call(st, k) && k !== 'source' && typeof st[k] !== 'function') server[k] = st[k];
    var pt = { at: v.clock, enc: encodeStack(v), raiseFrames: h.raiseFrames, raiseStarted: h._raiseStarted,
               arrivals: n.arrivals.map(copyArrival), server: server };
    return unseen ? pt : exact(pt);
  }
  function stepKind(step) { return Array.isArray(step) ? 'swap' : step === 'raise' ? 'raise' : 'hold'; }
  function exact(pt) { if (pt) pt.exact = true; return pt; }
  PuyoCpu.prototype._pointAfter = function (d) {
    var pr = this._paRoot();
    if (pr) return paPointOf(this._paStep(pr, d.kind, d.kind === 'swap' ? d.move : null, 0));
    return pointOf(this._engineAdvance(this._engineRoot(), d.kind, d.kind === 'swap' ? d.move : null, 0));
  };
  PuyoCpu.prototype._pointAhead = function (frames) {
    if (frames <= 0) {
      return exact({ at: this.stack.clock, enc: encodeStack(this.stack), raiseFrames: this.raiseFrames || 0,
                     raiseStarted: !!this._raiseStarted, arrivals: this._inFlight() });
    }
    var pr = this._paRoot();
    if (pr) return paPointOf(this._paStep(pr, 'long', null, frames));
    return pointOf(this._engineAdvance(this._engineRoot(), 'long', null, frames));
  };
  // Fields a prediction does not track and no decision reads.
  var UNTRACKED = { events: 1, outgoing: 1, allowIdleSkip: 1, unseenRows: 1, unseenBreaks: 1 };
  var COLOR_FIELD = PANEL_FIELDS.indexOf('color');
  // `unseen`: a panel the prediction could not know (a row or a break dealt
  // since, colour 11 and up) matches whatever the game dealt there.
  function sameAs(st, e, unseen) {
    var ea = encodeStack(st), a = ea.buf, b = e.buf, i, k;
    if (ea.rows !== e.rows || a.length !== b.length) return false;
    for (i = 0; i < a.length; i += NF) {
      if (unseen && b[i + COLOR_FIELD] >= 11) continue;
      for (k = 0; k < NF; k++) if (a[i + k] !== b[i + k]) return false;
    }
    var keys = Object.keys(ea.meta).concat(Object.keys(e.meta));
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (!UNTRACKED[k] && JSON.stringify(ea.meta[k]) !== JSON.stringify(e.meta[k])) return false;
    }
    return true;
  }
  // `board`: the board and the raise in hand only, not the garbage in the air.
  PuyoCpu.prototype._matches = function (pt, unseen, board) {
    return (this.raiseFrames || 0) === pt.raiseFrames && !!this._raiseStarted === pt.raiseStarted &&
           (board || JSON.stringify(this._inFlight()) === JSON.stringify(pt.arrivals)) && sameAs(this.stack, pt.enc, unseen);
  };
  function decisionOf(step) {
    return Array.isArray(step) ? { kind: 'swap', move: step } : step === 'raise' ? { kind: 'raise' } : { kind: 'hold' };
  }
  // The plan's move for this frame: its board must be the one the plan
  // expected, or the plan is dropped. Garbage sent since does not drop it:
  // until it lands the board is the one the plan was proven on, and the
  // decision asked for meanwhile (on the plan's boards, with that garbage
  // known) takes over when it comes. Once it lands the board is not.
  PuyoCpu.prototype._planStep = function (now) {
    var pl = this._planned, j;
    if (!pl) return null;
    for (j = 0; j < pl.length && pl[j].at < now; j++);
    if (j < pl.length && pl[j].at === now) {
      if (!this._matches(pl[j], !pl[j].exact, true)) { this._planned = null; return null; }
      this._planned = pl.slice(j + 1);
      this.planned = (this.planned || 0) + 1;
      return decisionOf(pl[j].step);
    }
    this._planned = null;
    return null;
  };
  // THE PLAN FROM HERE, ON THE GAME'S OWN BOARD: this frame's move d, then
  // the plan's moves in order, played on the seen copy with the garbage in
  // the air now. Each board it reaches is exact, and the boards with their
  // moves become the plan, up to a move the board refuses or dies of. The
  // board to ask about is the first at least `until`, or the plan's last;
  // the plan goes on past it, to be played if that answer is not. Null when
  // d itself leads nowhere.
  PuyoCpu.prototype._replayPlan = function (d, pl, now, until) {
    var n = this._paRoot(), out = [], i = 0, pt, ask = null, self = this;
    if (!n || !d) return null;
    var point = paPointOf;
    var step = function (x, k, m) { return self._paStep(x, k, m, 0); };
    n = step(n, d.kind, d.kind === 'swap' ? d.move : null);
    while (i < pl.length && pl[i].at <= now) i++;
    for (; n && !n.dead && i < pl.length; i++) {
      pt = point(n);
      if (!pt) break;
      pt.step = pl[i].step;
      out.push(pt);
      if (!ask && pt.at >= until) ask = pt;
      // On the board itself: a copy would lose the game's generator.
      n = step(n, stepKind(pt.step), Array.isArray(pt.step) ? pt.step : null);
    }
    if (!ask && n && !n.dead) ask = point(n);
    if (!ask) ask = out[out.length - 1];
    if (!ask) return null;
    var q = {}, k;
    for (k in ask) if (k !== 'step') q[k] = ask[k];
    return { plan: out, point: q };
  };
  // Where to ask for the next decision: the first board of the plan at least
  // lead() frames on, else the board after this move, else, holding, as far
  // on as the quick side needs (quickLead()), if the brain has one: the bot
  // holds until an answer comes.
  PuyoCpu.prototype._target = function (now, d) {
    var lead = this.brain.lead(), pl = this._planned || [];
    if (pl.length && d) {
      var re = this._replayPlan(d, pl, now, now + lead);
      if (re) { this._planned = re.plan; return re.point; }
    }
    this._planned = null;
    if (this.brain.quickLead) lead = Math.min(lead, this.brain.quickLead());
    if (d) { var pa = this._pointAfter(d); if (pa) return pa; }
    // Holding that long dies: the latest board before it that is alive.
    for (var k = lead; k >= 1; k >>= 1) { var ph = this._pointAhead(k); if (ph) return ph; }
    return this._pointAhead(0);
  };
  // AN ANSWER THAT CAN NO LONGER BE PLAYED IS NOT WAITED FOR: its frame has
  // passed, or garbage the board it was made on did not have is in the air
  // and will still be in the air on its frame. The brain stops on it and is
  // asked again at once. A piece the board had as soon or sooner, and as big
  // or bigger, is one it had: a running chain's soonest landing moves later
  // every frame it goes on.
  PuyoCpu.prototype._stale = function (pt, now) {
    if (pt.at < now) return true;
    var real = this._inFlight(), ahead = pt.at - now, want = pt.arrivals || [], used = [], i, j;
    for (i = 0; i < real.length; i++) {
      var e = real[i], at = e.at - ahead;
      if (at <= 0) continue;
      for (j = 0; j < want.length; j++) {
        var w = want[j];
        if (!used[j] && w.at <= at && w.width === e.width && w.height >= e.height && !!w.isChain === !!e.isChain) { used[j] = true; break; }
      }
      if (j === want.length) return true;
    }
    return false;
  };
  // The decision to play on this frame, or null to hold.
  PuyoCpu.prototype._fromBrain = function (again) {
    var p = this._pending, now = this.stack.clock, d = null;
    // The answer: the full one, or on its frame, if that is not in yet, the
    // quick one (a brain with a quick side decides the same board on a small
    // survival budget, for when the full search is late).
    var ans = null;
    if (p) {
      if (this.brain.poll) this.brain.poll(p, now);
      ans = p.decision || (p.at === now ? p.quick : null) || null;
      if (!(ans && p.at <= now) && this._stale(p.point, now)) {
        if (this.brain.cancel) this.brain.cancel(p);
        this._pending = p = null;
        this.dropped = (this.dropped || 0) + 1;
      }
    }
    if (p && ans && p.at <= now) {
      this._pending = null;
      if (!p.decision && this.brain.cancel) this.brain.cancel(p);
      // An exact point must match exactly; a plan's own board, which could
      // not see what was dealt since, matches whatever was dealt there.
      if (p.at === now && this._matches(p.point, !p.point.exact)) {
        if (ans === p.decision) this.acted = (this.acted || 0) + 1;
        else this.quickPlayed = (this.quickPlayed || 0) + 1;
        this._played = ans === p.decision ? 'full' : 'quick';
        this._planned = ans.plan || null;
        d = decisionOf(ans.move || ans.kind);
      } else this.missed = (this.missed || 0) + 1;
    }
    // A brain that answers on the spot (lead 0) is asked about this frame
    // itself; the plan is for brains that cannot.
    if (!d && !this._pending && !again && this.brain.lead() === 0) {
      this._pending = this._ask(this._pointAhead(0));
      return this._fromBrain(true);
    }
    if (!d) d = this._planStep(now);
    if (!this._pending) this._pending = this._ask(this._target(now, d));
    if (d) this.decisions++;
    return d;
  };
  PuyoCpu.prototype._ask = function (point) {
    var played = this._played || false;
    this._played = false;
    return this.brain.request(this, point, played);
  };
  // What a brain is sent: the board it decides on, the raise in hand, the
  // garbage in flight, the other board, and which of its answers to the last
  // question was played ('full', 'quick' or false).
  PuyoCpu.message = function (bot, point, acted) {
    var e = point.enc;
    return { enc: { meta: e.meta, rows: e.rows, row0: e.row0, buf: e.buf.slice() },
             raiseFrames: point.raiseFrames, raiseStarted: point.raiseStarted, arrivals: point.arrivals,
             opp: bot.opponent ? encodeStack(bot.opponent) : null, acted: acted === true ? 'full' : acted || false,
             server: point.server || null };
  };
  // The brain's side: a bot of its own, deciding on the boards it is sent,
  // and answering with the move and the plan that proved it. A decision that
  // was not played is taken back -- the bot's own state (the line it
  // follows, the square it refuses) goes back to before it.
  // `abort`, if set, is asked between engine steps whether to stop; a search
  // stopped throws PuyoCpu.ABORTED, and the next message (never `acted`)
  // takes back what it had done.
  // `quick`: the quick side, the same bot on QUICK_BUDGET survival steps.
  function Mind(opts, bot, quick) {
    this.opts = opts; this.bot = bot || null; this._snap = null; this.abort = null; this.quick = !!quick;
    if (this.bot && quick) this.bot.SURVIVE_SEARCH_BUDGET = Mind.QUICK_BUDGET;
  }
  Mind.QUICK_BUDGET = PuyoCpu.prototype.SURVIVE_SEARCH_BUDGET_CHEAP;
  Mind.prototype.think = function (m) {
    var st = decodeStack(m.enc), bot = this.bot, k, snap = this._snap;
    if (!bot) {
      bot = this.bot = new PuyoCpu(st, this.opts);
      if (this.quick) bot.SURVIVE_SEARCH_BUDGET = Mind.QUICK_BUDGET;
    }
    if (snap && m.acted !== (this.quick ? 'quick' : 'full')) {
      for (k in bot) if (Object.prototype.hasOwnProperty.call(bot, k) && !Object.prototype.hasOwnProperty.call(snap, k)) delete bot[k];
      for (k in snap) bot[k] = snap[k];
    }
    this._snap = Object.assign({}, bot);
    bot.stack = st;
    bot.raiseFrames = m.raiseFrames; bot._raiseStarted = m.raiseStarted;
    bot.opponent = m.opp ? decodeStack(m.opp) : null;
    bot._predArr = m.arrivals;
    // ON THE SERVER'S RULES: the board as the server holds it, searched on
    // native/pa.c; garbage on its way lands that many frames on.
    if (m.server) {
      bot.serverStack = PAE().revive(m.server);
      bot.serverArrivals = m.arrivals.map(function (a) { return { at: Math.max(1, a.at), width: a.width, height: a.height, isChain: !!a.isChain, isMetal: !!a.isMetal }; });
      bot.native = true;
      bot.nativeCands = true;
      // native.js runs the server's engine on threads only in node
      if (typeof require !== 'function') bot.threads = 0;
    }
    bot._abort = this.abort;
    bot.decisions++;
    var d;
    try { d = bot._decide(); } finally { bot._predArr = null; bot._abort = null; }
    return { kind: d.kind, move: d.move ? [d.move[0], d.move[1]] : null, plan: this._planOf(bot._proofLine) };
  };
  // The proven line as the decision frames the bot will meet on it: a wait is
  // played as holds, one decision frame a beat, so it is laid out beat by
  // beat (the search rounds waits to whole beats).
  Mind.prototype._planOf = function (pl) {
    var plan = [], bot = this.bot, j, pt;
    var pointOf = bot.serverStack ? function (n) { return paPointOf(n, true); } : pointOfStack;
    for (j = 0; pl && j + 1 < pl.line.length; j++) {
      var a = pl.line[j], b = pl.line[j + 1], nx = b.m;
      if (isLong(nx)) {
        var n = a;
        while (n && !n.dead && n.t < b.t) {
          if (!(pt = pointOf(n))) return plan;
          pt.step = null;
          plan.push(pt);
          n = bot._engineAdvance(n, 'hold', null, 0);
        }
        if (!n || n.dead || n.t !== b.t) return plan;
        continue;
      }
      if (!(pt = pointOf(a))) return plan;
      pt.step = nx === 'raise' ? 'raise' : nx ? [nx[0], nx[1]] : null;
      plan.push(pt);
    }
    return plan;
  };
  PuyoCpu.Mind = Mind;
  // How far ahead to ask: half again the slowest of the last few answers, in
  // frames.
  function Pace() { this.recent = []; this.slowest = 0; }
  Pace.FIRST = 30;
  Pace.MAX = 600;
  Pace.prototype.took = function (frames) {
    this.recent.push(frames);
    if (this.recent.length > 8) this.recent.shift();
    if (frames > this.slowest) this.slowest = frames;
  };
  Pace.prototype.lead = function () {
    if (!this.recent.length) return Pace.FIRST;
    return Math.min(Pace.MAX, Math.ceil(1.5 * Math.max.apply(null, this.recent)));
  };
  PuyoCpu.Pace = Pace;
  // A brain on this thread. It decides the moment it is asked; with
  // `realtime` > 0 the answer is held back until as many frames have passed
  // as the thinking took (60 a second, times `realtime`), so a game played
  // here plays out as it would with the brain in a worker.
  // With a quick Mind too, both sides are asked, as if each were a worker of
  // its own. With `steps`, thinking takes a frame per that many search steps
  // (PuyoCpu.steps) instead of the time it took, so a game plays out the same
  // on any machine; it needs the search on this thread (threads 0).
  function LocalBrain(mind, realtime, quick, steps) {
    this.mind = mind; this.realtime = realtime || 0; this.pace = new Pace(); this.quickMind = quick || null;
    this.quickPace = quick ? new Pace() : null; this.steps = steps || 0;
  }
  LocalBrain.prototype.request = function (bot, point, acted) {
    var clock = (typeof performance !== 'undefined' && performance.now) ? performance : Date, rt = this.realtime, per = this.steps;
    function timed(mind) {
      var t0 = clock.now(), s0 = PuyoCpu.steps, d = mind.think(PuyoCpu.message(bot, point, acted));
      var frames = !rt ? 0 : per ? Math.ceil((PuyoCpu.steps - s0) / per) : Math.ceil((clock.now() - t0) * 0.06 * rt);
      return { d: d, frames: frames };
    }
    var full = timed(this.mind), q = this.quickMind && rt ? timed(this.quickMind) : null;
    if (rt) this.pace.took(full.frames);
    if (q) this.quickPace.took(q.frames);
    return { at: point.at, point: point, decision: full.frames ? null : full.d, answer: full.d, readyAt: bot.stack.clock + full.frames,
             quick: q && !q.frames ? q.d : null, quickAnswer: q ? q.d : null, quickAt: q ? bot.stack.clock + q.frames : 0 };
  };
  LocalBrain.prototype.poll = function (p, clock) {
    if (!p.decision && clock >= p.readyAt) p.decision = p.answer;
    if (!p.quick && p.quickAnswer && clock >= p.quickAt) p.quick = p.quickAnswer;
  };
  LocalBrain.prototype.lead = function () { return this.realtime ? this.pace.lead() : 0; };
  LocalBrain.prototype.quickLead = function () { return this.realtime && this.quickPace ? this.quickPace.lead() : this.lead(); };
  PuyoCpu.LocalBrain = LocalBrain;

  // One frame. A committed walk owns the frame until the cursor arrives.
  PuyoCpu.prototype.update = function () {
    var stack = this.stack;
    if (stack.gameOver) return;

    var input = {};
    // ONE RAISE IS ONE ROW. The engine re-latches manualRaise on every frame
    // the input is held while preventManualRaise is clear, and every new row
    // clears it -- so the fixed 20-frame hold, at one pixel a frame against a
    // 16-pixel row, served two or three rows for one decision the resolve had
    // judged as one. Read off seed 703 frame 1062: raised, certified to
    // survive two rises; rows then landed at 1068, 1083 and 1098 and it was
    // dead at 1098.
    //
    // Released the frame the engine HANDS THE RAISE OFF -- manualRaise goes
    // false with the last pixel given to passive raise -- not the frame the
    // row lands. run() is runPhysics, then applyInput: on the landing frame
    // newRow clears preventManualRaise and a still-held input re-latches
    // before this can see the row arrive.
    //
    // And the hand-off can happen inside ONE frame: decided with the floor a
    // pixel from its row, the engine latches the raise and hands it to passive
    // raise in the same run(), so manualRaise is never seen true here and the
    // input stayed held into the next row. The hand-off always sets
    // preventManualRaise (clear when the raise was offered -- _canRaise checks
    // it), so that is the signal. Seed 703 frame 3014: raised, rows landed at
    // 3017 and 3032, fifteen frames apart.
    raiseStep(this, stack, input);
    this._raiseNow = !!input.raise;

    // A committed move owns the frame — the cursor has to get there.
    if (this._walk) {
      this._driveWalk(input);
      stack.setInput(input);
      return;
    }
    stack.setInput(input);
    if (this.cooldown > 0) { this.cooldown--; return; }

    var decision;
    if (this.brain) {
      decision = this._fromBrain();
      if (!decision) return;
    } else {
      this.decisions++;
      decision = this._decide();
    }
    if (decision.kind === 'raise') {
      // HOLD THE INPUT LONG ENOUGH FOR THE ENGINE TO SERVE IT. setInput
      // latches manualRaise on a rising edge and the row takes frames to
      // arrive.
      this.raiseFrames = 20;
      this._raiseStarted = false;
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
