// WHICH MOVES A DECISION IS ALLOWED TO CHOOSE BETWEEN.
//
// The bot re-derives the world every decision and keeps nothing, so it can
// never be in the middle of building something: it takes the 3-match that is
// always there and always slightly tidies the board. No weight fixes that,
// because a weight applies to every move equally and none of them can mean
// "later".
//
// A MODE IS A FILTER ON THE POOL, NOT A SECOND WAY TO DECIDE. The evaluator
// still picks, from every candidate the mode allows. That is deliberate:
//   - puyocpu.test.js's first claim is that EVERY decision goes through the
//     evaluator, and a mode that played a move directly would end that.
//   - a weight set per mode is then a change to the weights and not to this
//     file. The seam is already where it needs to be.
//
// EVERY ANSWER HERE COMES OUT OF THE RESOLVE. resolve() already reports
// chainLength, comboSizes and brokeGarbage for every candidate, and the
// search already resolves every candidate, so the filter is free — it reads
// numbers the decision had computed anyway. No shape library, and nothing
// here knows what a chain looks like.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.PanelEval = root.PanelEval || {}; root.PanelEval.modes = factory(); }
}(this, function () {
  'use strict';

  // What a move actually fires. links is the cascade depth in the engine's
  // own units (1 is a plain combo, 2 the first real chain); wide is the
  // BIGGEST single link, because payout is per-clear and a 6 merged into one
  // link is a different attack from six 1s.
  function payout(resolved) {
    if (!resolved) return { links: 0, wide: 0, breaks: 0 };
    var sizes = resolved.comboSizes || [], wide = 0;
    for (var i = 0; i < sizes.length; i++) if (sizes[i] > wide) wide = sizes[i];
    return { links: sizes.length ? (resolved.chainLength || 0) : 0,
             wide: wide,
             breaks: resolved.brokeGarbage || 0 };
  }

  // Does this move meet the bar. Two arms, both from the resolve:
  // a cascade `T` links deep, or a single clear `S` wide. They are different
  // weapons — pushGarbage sends a chain as one full-width slab held until the
  // cascade ends, and a combo as separate one-row pieces that leave at once —
  // so neither subsumes the other and both are here. It says what a move
  // pays, never that the bot should take it — hold is always on the list
  // beside it and the weights choose.
  function fires(resolved, T, S) {
    var p = payout(resolved);
    return p.links >= T || p.wide >= S;
  }

  // May this move stay in the pool.
  //
  // A MOVE THAT CLEARS NOTHING ALWAYS MAY. That is what building IS, and it
  // is why this is a filter on cashing in rather than a demand for a payout:
  // a filter that wanted a clear every move would be the opposite bot. Hold
  // clears nothing, so hold survives, so the pool can always wait.
  //
  // Otherwise a clear has to pay: meet the bar, or break garbage. Digging is
  // progress even when the clear itself scores nothing.
  function pays(resolved, T, S) {
    var p = payout(resolved);
    if (!p.links && !p.wide) return true;
    if (p.breaks > 0) return true;
    return fires(resolved, T, S);
  }

  // WHAT THIS BOARD CAN FIRE NEXT MOVE, SIZE BY SIZE.
  //
  // One feature per target a player would name. They replace a SETTING: what
  // to build toward used to be a knob picked by hand, which made every
  // choice a guess to be swept. As features the weights decide — a bot can
  // learn that a 5-chain is worth a lot and a 4-combo a little, and that it
  // wants both.
  //
  // CUMULATIVE ON PURPOSE. Being able to fire a six means being able to fire
  // a four, so a board holding a six reads on 4, 5 and 6. A weight set that
  // values only sixes still sees them; one that values fours is not blind to
  // a board holding something better.
  //
  // Chains and combos stay separate, because they are different weapons:
  // pushGarbage sends a chain as one full-width slab held until the cascade
  // ends, and a combo as separate one-row pieces that leave at once.
  //
  // FREE at depth 2 — the search already resolves every swap from every
  // candidate board, so this reads work already done. Asking the same
  // question as a separate sweep costs ~900 resolves a decision: 166ms
  // against an 85ms budget, measured.
  // THE SIZES, FROM THE ENGINE'S OWN TABLES. A combo of 3 sends nothing —
  // COMBO_GARBAGE starts at 4 — so 4 is the floor there. A CHAIN of 2 pays
  // 50 points and sends a full-width slab, so 2 is the floor for chains;
  // treating 4 as the floor for both was wrong.
  //
  // One measurement per size, never a lumped tail bin: a bin covering "7 or
  // more" throws away the difference between a 7-chain and a 13-chain, which
  // is the information this exists to hand over. The ceilings stop where the
  // game currently reaches, and widen when it starts hitting them.
  var COMBO_SIZES = [4, 5, 6, 7, 8, 9, 10];
  var CHAIN_SIZES = [2, 3, 4, 5, 6, 7, 8];
  var REACH = ['reach4combo', 'reach5combo', 'reach6combo', 'reach7combo', 'reach8combo', 'reach9combo', 'reach10combo',
               'reach2chain', 'reach3chain', 'reach4chain', 'reach5chain', 'reach6chain', 'reach7chain', 'reach8chain'];

  function reach(r) {
    var links = (r && r.links) || 0, wide = (r && r.wide) || 0;
    // EVERY KEY, ALWAYS. A missing key reads as undefined in the evaluator
    // and scores nothing, which is a dead measurement wearing a live one's
    // name. Built rather than typed, so a size cannot be skipped.
    var out = {};
    for (var i = 0; i < COMBO_SIZES.length; i++) {
      out['reach' + COMBO_SIZES[i] + 'combo'] = wide >= COMBO_SIZES[i] ? 1 : 0;
    }
    for (var j = 0; j < CHAIN_SIZES.length; j++) {
      out['reach' + CHAIN_SIZES[j] + 'chain'] = links >= CHAIN_SIZES[j] ? 1 : 0;
    }
    return out;
  }

  // THE GOALS A PLAYER WOULD NAME. Not a range and not a continuous knob:
  // an explicit menu, so a setting is readable in a log and a sweep is a
  // short list. Nothing below 4 is on it because the engine pays nothing
  // below 4 — COMBO_GARBAGE sends nothing and a bare three scores zero.
  var GOALS = ['4-chain', '5-chain', '6-chain',
               '4-combo', '5-combo', '6-combo', '7-combo'];

  // ONE SETTING THAT SAYS THE WHOLE PLAN.
  //
  // "5-chain" means all three of: climb toward a board that can fire a
  // 5-chain, refuse to sell anything smaller, and fire the moment one
  // exists. They are one decision, and they were four separate numbers
  // (fireLinks, fireWide, fireTarget, buildToward) none of which said the
  // thing a player would say.
  //
  // ALSO-TAKE IS NOT OPTIONAL. A bot that will not cash the other weapon at
  // all starves itself: measured over 24 games apiece, a combo bar of 8 or
  // 99 gave ZERO deep chains, a third of the garbage and a 30% shorter game
  // than a bar of 6. So a goal names what it is BUILDING and still takes the
  // other weapon when it turns up big enough. It can never undercut what the
  // engine pays for.
  function goal(spec, alsoTake) {
    if (spec === null || spec === undefined) return null;
    if (GOALS.indexOf(spec) === -1) {
      throw new Error('unknown goal "' + spec + '" — one of ' + GOALS.join(', '));
    }
    var parts = spec.split('-'), size = Number(parts[0]), kind = parts[1];
    var other = alsoTake === undefined ? (kind === 'chain' ? 6 : 5) : Number(alsoTake);
    return {
      spec: spec, kind: kind, size: size,
      links: kind === 'chain' ? size : Math.max(2, other),
      wide: kind === 'combo' ? size : Math.max(4, other)
    };
  }

  // HOW FAR ALONG THE GOAL THIS BOARD IS, and it SATURATES.
  //
  // Full credit at the goal and nothing beyond it: past five links you are
  // meant to FIRE, not keep stacking. The old climb was linear and
  // unbounded, so more potential was always better forever — and cranking it
  // built a tall loaded board that died, survival falling from 10.1 minutes
  // to 7.7 as strength rose.
  //
  // Only the goal's own kind counts. Otherwise "I am building a five-chain"
  // gets pulled off course by every wide combo the board happens to offer.
  function climbTo(g, strength, reach) {
    if (!g || !strength || !reach) return 0;
    var have = g.kind === 'chain' ? (reach.links || 0) : (reach.wide || 0);
    if (have <= 0) return 0;
    return strength * Math.min(have, g.size) / g.size;
  }

  // WHAT SURVIVES, in the danger zone.
  //
  // FORCED narrows to the moves that buy time and hands the rest to the
  // evaluator. It does NOT pick one: modes filter the pool and the weights
  // choose from it, and how much the clock is worth against everything else
  // belongs in a weight set the trainer can fit, not in a rule here.
  //
  // Nothing survives means NO FILTER rather than no move: the bot still has
  // to play something, and nothing here saves it anyway.
  //
  // Candidate order is preserved so ties break exactly as they do elsewhere.
  function survivable(cands) {
    var out = [];
    for (var i = 0; i < cands.length; i++) {
      if (banksTime(cands[i].resolved)) out.push(cands[i]);
    }
    return out.length ? out : cands;
  }

  // AN ESCAPE ONE MOVE FURTHER OUT.
  //
  // banksTime reads `resolved`, which is what a swap does when it is played
  // and the board settles. A swap that SETS UP a four clears nothing, so its
  // resolved is empty and honest, and the escape is invisible. Measured on
  // two real topped-out boards: 36 and 31 legal swaps, not one of them a four
  // or a garbage break, while two-swap sequences held three and nine fours
  // and, on the second board, a break worth eight garbage cells.
  //
  // `reach` is the board the move LEAVES, which is where that four lives. It
  // is computed from the second ply, so it exists only after _lookahead has
  // valued the candidate — never at filter time.
  function reachesEscape(reach) {
    if (!reach) return false;
    for (var i = 0; i < COMBO_SIZES.length; i++) {
      if (COMBO_SIZES[i] > 3 && reach['reach' + COMBO_SIZES[i] + 'combo']) return true;
    }
    for (var j = 0; j < CHAIN_SIZES.length; j++) {
      if (CHAIN_SIZES[j] >= 2 && reach['reach' + CHAIN_SIZES[j] + 'chain']) return true;
    }
    return false;
  }

  // DOES THIS MOVE BANK TIME — the only kind of move that is a way out.
  //
  // awardStopTime is gated on `comboSize > 3 || isChain`, so a bare three
  // clears panels and banks nothing at all. Breaking garbage counts even on
  // a three: the popping garbage cells extend preStopTime (FLASH + FACE +
  // POP per panel, garbage included), which postpones the stop-time drain.
  //
  // So the two ways out are the owner's two: break something, or make a
  // combo — with a chain the biggest payer of all, since at the ceiling it
  // draws the danger bonus instead of the ordinary formula.
  function banksTime(resolved) {
    var p = payout(resolved);
    return p.links >= 2 || p.wide > 3 || p.breaks > 0;
  }

  // DID THE RISING ROW MAKE A CLEAR THAT PAID NOTHING.
  //
  // The stack comes up whether or not the bot acts, and the row that is
  // coming is known before the move is chosen — so a three the board makes
  // by itself is a move the bot should have declined. `risen` is the resolve
  // after the rows that land during this move land; `own` is what the move
  // itself fires. A rise that only extends what the move already paid for is
  // not a payless rise.
  //
  // A PREFERENCE, NOT A VETO, and its caller must treat it as one. Applied
  // as a hard filter it empties the pool — every candidate rises into
  // something once enough rows land — and an empty pool falls through to the
  // unfiltered bot, which fires MORE bare threes than no filter at all:
  // measured, 239 against 205 over ten games.
  function risesIntoPayless(risen, own, T, S) {
    if (!risen) return false;
    if (pays(risen, T, S)) return false;
    return pays(own, T, S);
  }

  // Frames of safety on the clock. decrementTimers drains preStopTime first
  // and only then stopTime, while the rise gate reads stopTime alone — so
  // pre-stop does not protect by itself, it postpones the drain. The sum is
  // how long the stack stays frozen.
  function clock(o) {
    return (o.stopTime || 0) + (o.preStopTime || 0);
  }

  // FRAMES TO REACH AN ESCAPE, exactly, rather than a round number.
  //
  // What it takes to bank stop time from here: one more decision, because
  // the bot only acts every `reaction` frames; the walk to the move, which
  // travel.cost already prices at the cursor's real cadence; and HOVER,
  // the frames panels spend falling before they can match. Below that sum
  // the bot cannot reach anything that banks stop time before the stack
  // unfreezes — and at level 10, unfreezing at the ceiling is death in one
  // frame, because maxHealth is 1.
  //
  // travel null means NO CANDIDATE CLEARS ANYTHING. No move banks stop
  // time, so no clock is long enough and the answer is not a big number, it
  // is Infinity.
  function escapeFrames(o) {
    if (o.travel === null || o.travel === undefined) return Infinity;
    return (o.reaction || 0) + o.travel + (o.hover || 0);
  }

  // TWO TRIGGERS, AND ONLY TWO.
  //
  // Topped out is the whole test. Not a deep stack — room left is room left.
  // Not an empty pool for its own sake, which is a broken plan and is counted
  // as one. The clock does not gate it: banked stop time postpones the rise,
  // it does not undo a panel already in the top row, and a floor set to the
  // frames one swap costs leaves nothing to act with.
  function forced(o) {
    if (o.broke) return true;
    return !!o.toppedOut;
  }

  // Did what BUILD was saving for disappear without being spent.
  //
  // A BROKEN PLAN IS A DEFECT, NOT A BRANCH. It is work already done that
  // paid nothing, and the whole point of showing the bot the opponent's
  // board (step 2) is to drive this number down by building plans the
  // incoming garbage will not bury. So it is counted, per game, and reported
  // beside the bench numbers.
  //
  // Spending it is not breaking it: a plan that is gone because the chain
  // fired is the plan working.
  function planBroke(before, after, didFire, T, S) {
    if (didFire) return false;
    if (!before) return false;
    var held = before.links >= T || before.wide >= S;
    if (!held) return false;
    return after.links < before.links || after.wide < before.wide;
  }

  // The best payout any candidate in this pool would fire. This IS the
  // board's chain potential, taken from resolves the decision already ran
  // rather than from a second sweep — chainPotential's own 14.9ms is the
  // cost of asking the question twice, and nothing here asks it twice.
  function bestPayout(resolveds) {
    var best = { links: 0, wide: 0, breaks: 0 };
    for (var i = 0; i < resolveds.length; i++) {
      var p = payout(resolveds[i]);
      if (p.links > best.links) best.links = p.links;
      if (p.wide > best.wide) best.wide = p.wide;
    }
    return best;
  }

  // WHAT THIS WEIGHT SET IS BUILDING TOWARD, read off the weights themselves.
  //
  // The bar is not a setting and it is not a constant. A bot that has learned
  // to value a 5-chain above every other chain size is a bot aiming at a
  // 5-chain, and that is the payout it should hold out for — so the size it
  // weights highest in each family IS the aim. Nothing here decides for it.
  //
  // FLOOR WHEN IT WANTS NOTHING. Every size at or below zero means no target
  // has been learned yet, which is where a random vector starts. The floor is
  // what the engine pays anything at all for: 2 links, 4 wide.
  //
  // Ties keep the SMALLER size. An aim it reaches often teaches the weights
  // more per leg than one it reaches never, and a tie means it likes both.
  function aim(weights) {
    var w = weights || {};
    function bestOf(sizes, suffix) {
      var at = 0, best = 0;
      for (var i = 0; i < sizes.length; i++) {
        var v = w['reach' + sizes[i] + suffix] || 0;
        if (v > best) { best = v; at = sizes[i]; }
      }
      return at;
    }
    var links = bestOf(CHAIN_SIZES, 'chain');
    var wide = bestOf(COMBO_SIZES, 'combo');
    return { links: links || 2, wide: wide || 4 };
  }

  // WHICH DECISION PROCEDURE THESE WEIGHTS WERE FITTED UNDER.
  //
  // The switches a snapshot records — rise, depth, beam, density, level —
  // describe the run. They do not describe THE RULES, which live in code: a
  // change to what the pool contains makes every earlier weight set a bot
  // that played a different game, while every switch still matches.
  //
  // BUMP THIS WHENEVER THE POOL OR THE BAR CHANGES. A peer that does not
  // match is skipped, so a run cannot measure itself against a bot whose
  // moves were chosen by rules it no longer plays by.
  //
  //   1  the floor opened the attack; the attack removed hold
  //   2  the aim opens the attack, the floor is what building refuses
  //   3  FORCED opens on topped out alone, with no clock condition
  //   4  FORCED's escape counts the board a move LEAVES, not only what it clears
  var RULES = 4;

  return { payout: payout, fires: fires, pays: pays, aim: aim, RULES: RULES,
           REACH: REACH, reach: reach,
           COMBO_SIZES: COMBO_SIZES, CHAIN_SIZES: CHAIN_SIZES,
           GOALS: GOALS, goal: goal, climbTo: climbTo, survivable: survivable,
           reachesEscape: reachesEscape,
           clock: clock, escapeFrames: escapeFrames, banksTime: banksTime,
           risesIntoPayless: risesIntoPayless,
           forced: forced, planBroke: planBroke, bestPayout: bestPayout };
}));
