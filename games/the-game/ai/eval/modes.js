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

  // WHAT AN ESCAPE IS ACTUALLY WORTH, IN FRAMES.
  //
  // reachesEscape answers yes for a four and yes for an eight-chain. At
  // level 10 those are 30 frames and 72, and treating them as the same
  // thing is why a tier built on it kept 11.2 of 17.6 candidates and
  // changed almost nothing: two thirds of every board clears a bar set at
  // "can reach a four OR a two-chain".
  //
  // The engine's own awardStopTime says what each size is worth, so this
  // reads the same level table and the same four branches rather than
  // restating a number that would then drift.
  function escapeValue(reach, stop, toppedOut) {
    if (!reach || !stop) return 0;
    var best = 0, i, v, n;
    for (i = 0; i < COMBO_SIZES.length; i++) {
      n = COMBO_SIZES[i];
      if (n <= 3 || !reach['reach' + n + 'combo']) continue;
      v = toppedOut ? stop.coefficient * (n < 9 ? 2 : 3) + stop.chainConstant
                    : stop.coefficient * n + stop.comboConstant;
      if (v > best) best = v;
    }
    for (i = 0; i < CHAIN_SIZES.length; i++) {
      n = CHAIN_SIZES[i];
      if (n < 2 || !reach['reach' + n + 'chain']) continue;
      v = toppedOut ? stop.dangerConstant + ((n > 4 ? 6 : n) - 1) * stop.dangerCoefficient
                    : stop.coefficient * Math.min(n, 13) + stop.chainConstant;
      if (v > best) best = v;
    }
    return best;
  }

  // HOW MUCH STOP TIME WOULD CLEAR THE WARNING.
  //
  // The warning is headroom against a bar. Enough stop time to put headroom
  // back over that bar is what "a way out" has to mean here — an escape
  // worth less than this does not get the bot out of the danger it is in,
  // it just looks like an escape.
  function escapeNeeded(o) {
    var bar = isFinite(o.escape) ? o.escape
                                 : ESCAPE_RESERVE_ROWS * (o.framesPerRow || 0);
    return Math.max(0, bar - (o.headroom || 0) + 1);
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

  // FRAMES BEFORE THE FLOOR REACHES THE CEILING.
  //
  // The rows of empty space above the stack, priced at the level's own rise
  // rate, plus the stop clock, which postpones all of it. Garbage already
  // queued is headroom already spent — it has not landed yet, but nothing
  // the bot does will stop it landing, so a queued row is a row gone.
  //
  // THIS IS THE ONLY CLOCK THAT KILLS, and health is not it.
  // advancePassiveRaise decrements health only when riseLock is clear AND
  // stopTime is 0, so banked stop time is literal invulnerability; and at
  // level 10 maxHealth is 1, one frame, so once the stack is actually at the
  // top there is no reaction window left to use. Measured over ten deaths,
  // the board was topped out for between 0.0 and 1.7 seconds before dying
  // and six of the ten died on the first frame they topped out. The whole
  // window is here, before.
  function headroomFrames(o) {
    var rows = (o.rows || 0) - (o.queuedRows || 0);
    var stop = (o.stopTime || 0) + (o.preStopTime || 0);
    if (rows <= 0) return stop;
    // The stack sits part-way into its next row, so the first row costs what
    // is left of it rather than a whole period.
    var first = (o.framesToNextRow === undefined || o.framesToNextRow === null)
        ? (o.framesPerRow || 0) : o.framesToNextRow;
    return (rows - 1) * (o.framesPerRow || 0) + first + stop;
  }

  // WITH NOTHING ON THE BOARD THAT BANKS TIME, the escape clock is Infinity
  // and "could I reach an escape in time" can only answer no. The question
  // then is not whether one is reachable but whether there is room left to
  // MAKE one, and the unit for that is rows: one row is a full rise period,
  // and garbage arrives one or two rows at a time. Under two rows the next
  // delivery tops the stack out before the bot gets another decision.
  //
  // Banked stop time counts, because headroomFrames already includes it: two
  // rows plus a second of stop is not an emergency, and stops reading as one
  // the moment the bot banks something.
  var ESCAPE_RESERVE_ROWS = 2;

  // TWO TRIGGERS, AND ONLY TWO. FORCED IS STILL THE EMERGENCY.
  //
  // It is tempting to open this on the danger clock as well, because the
  // clock sees the death coming seconds earlier and this does not. It was
  // tried: FORCED went from 0.8% of decisions to 23.3%, and the bot lost
  // 8-16-16 to the same weights without it. FORCED does not merely prefer
  // an escape, it DISCARDS BUILD -- survivable() narrows the pool to moves
  // that bank time and the weights never see the rest -- and doing that on
  // a quarter of all decisions throws away the policy that was trained.
  //
  // So the clock does not come in here. It comes in as warned(), which
  // changes what is preferred without changing what is allowed.
  function forced(o) {
    if (o.broke) return true;
    return !!o.toppedOut;
  }

  // THE WARNING: the floor will arrive before an escape can be reached.
  //
  // Same clock, no emergency. BUILD keeps its pool and the weights keep
  // their ranking; all this does is tell _lookahead to prefer, among moves
  // the weights already allow, the ones that LEAVE a four or a chain on the
  // board. That is the difference between "get out now" and "make sure you
  // have a way out" -- and having a way out is the thing the bot never had:
  // over the final fifteen seconds of ten deaths, 84% of decisions had no
  // move on the board that banked any stop time at all, while the median
  // headroom was 6.5 seconds. The time was always there. The out was not.
  //
  // A caller that cannot supply the clock passes no headroom and is never
  // warned, rather than being warned on a guess.
  function warned(o) {
    if (!o || o.headroom === undefined || o.headroom === null) return false;
    if (isFinite(o.escape)) return o.headroom <= o.escape;
    // Nothing on the board banks time, so the escape clock is Infinity and
    // "could I reach one in time" can only answer no. The question is then
    // whether there is room left to MAKE one, and the unit is rows.
    return o.headroom <= ESCAPE_RESERVE_ROWS * (o.framesPerRow || 0);
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
  // THE ENGINE'S FLOOR: two links or four wide, the smallest clear it pays
  // anything at all for. Stated once, here, because the aim is defined
  // against it and two copies of it would let them drift apart.
  var FLOOR = { links: 2, wide: 4 };

  // THE AIM IS WHAT IS WORTH CASHING IN, READ OFF THE WEIGHTS.
  //
  // IT MAY BE THE FLOOR, AND FORBIDDING THAT MADE THE BOT WORSE.
  //
  // 73% of trained champions aim at exactly 2 links / 4 wide, which is the
  // floor, because 96% weight reach2chain above every other chain and 75%
  // weight reach4combo above every other combo. Since ATTACK drops hold,
  // that reads as "sell any clear the engine pays for, every time one
  // exists" -- so it looks like the reason the bot never builds.
  //
  // It is not. Clamping the aim one above the floor did exactly what it was
  // designed to do -- 4-combo cash-ins fell 69%, 2-chain sales 59% -- and
  // the bot got worse at everything else, with the gap WIDENING as the
  // populations matured rather than closing. At generations 3640-5000,
  // against RULES 9 at the same age: game 35.0s -> 23.8s, 3-link chains
  // 8.87 -> 7.20, 4-link 2.58 -> 2.28, 6-link 0.54 -> 0.28, payless share
  // 40% -> 45%.
  //
  // Suppressing the cheap sale does not produce a builder. The bot has no
  // way to assemble a chain across moves -- the search is two plies and no
  // feature measures chain structure -- so a rule that stops it selling
  // just leaves it holding a board it cannot improve.
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
    return { links: links || FLOOR.links, wide: wide || FLOOR.wide };
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
  //   5  a candidate is aged with the floor moving, so the board it is scored
  //      on is the one the cursor arrives at
  //   6  the garbage slabs are painted with it, so the engine can tell what is
  //      supported and what pops as a unit
  //   7  painted panels fall, chaining flags survive the paint, a refused swap
  //      is dropped instead of scored as a no-op, and the settled slabs go back
  //   8  the floor moves through the settle and the garbage already queued
  //      comes with it
  //   9  the scratch survives its own answer, and everything unsupported falls
  //  10  the aim may not be the floor, so ATTACK is no longer "sell anything
  //      the engine pays for"; a raise the board cannot survive is not a move
  //  11  the aim may be the floor again -- clamping it above the floor was
  //      measured worse at every matched age and the gap widened. The raise
  //      rule stays: it was measured on its own and it holds.
  //  12  a move that leaves the board topped out is not offered while one
  //      that does not exists. Topping out and dying are the same frame at
  //      level 10, so the decision before is the only one that can refuse it
  //  13  nor is a move after which EVERY reply is topped out -- the corner
  //      is entered long before it kills anything
  //  14  staying alive counts as an escape, and a raise with nothing banked
  //      and nothing earned is not a move. Every escape used to be priced in
  //      stop-time frames, so a bare three scored 0, the whole tier scored 0
  //      and the escape ranking switched itself off on the boards where
  //      nothing pays -- which is the state a death is reached in
  var RULES = 14;

  return { payout: payout, fires: fires, pays: pays, aim: aim, RULES: RULES,
           REACH: REACH, reach: reach,
           COMBO_SIZES: COMBO_SIZES, CHAIN_SIZES: CHAIN_SIZES,
           GOALS: GOALS, goal: goal, climbTo: climbTo, survivable: survivable,
           reachesEscape: reachesEscape,
           headroomFrames: headroomFrames, warned: warned, FLOOR: FLOOR,
           escapeValue: escapeValue, escapeNeeded: escapeNeeded,
           ESCAPE_RESERVE_ROWS: ESCAPE_RESERVE_ROWS,
           clock: clock, escapeFrames: escapeFrames, banksTime: banksTime,
           risesIntoPayless: risesIntoPayless,
           forced: forced, planBroke: planBroke, bestPayout: bestPayout };
}));
