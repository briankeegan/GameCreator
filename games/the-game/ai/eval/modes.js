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

  // WHICH WEAPON THIS BOT IS GOING FOR, as a pair of bars.
  //
  // A TARGET RAISES THE OTHER ARM'S BAR AND NEVER CLOSES IT. Measured over
  // 24 games apiece at T=4: a combo bar of 6 gives 0.7 deep chains a minute
  // and 728 game points a minute, while bars of 8 and 99 give ZERO deep
  // chains, a third of the garbage and a game 30% shorter. A bot that will
  // not cash a combo at all starves itself of the pressure and the stop
  // time it needs to build anything, so "chains only" is not a stronger
  // version of "prefer chains", it is a worse bot.
  //
  // The off-target bar also cannot UNDERCUT the base bar: a target must
  // never make the bot sell cheaper than `either` would.
  function bars(target, fireLinks, fireWide, offWide, offLinks) {
    if (target === 'either' || target === undefined) {
      return { links: fireLinks, wide: fireWide };
    }
    if (target === 'chain') {
      return { links: fireLinks, wide: Math.max(fireWide, offWide) };
    }
    if (target === 'combo') {
      return { links: Math.max(fireLinks, offLinks), wide: fireWide };
    }
    // Not a silent fallback to `either`: a typo in a switch would then read
    // as a deliberate setting and quietly measure the wrong bot.
    throw new Error('unknown fire target "' + target + '" — either, chain or combo');
  }

  // WHAT THE BOT WALKS TOWARD, as weights to add to its own.
  //
  // THE FLOOR AND THE CLIMB ARE THE SAME IDEA FROM TWO DIRECTIONS, and a
  // mode with only the floor is half a mode. `pays` says what not to sell;
  // this says what to move toward. Without it the bot scores TIDINESS —
  // clustering, height, edges, garbage — so a six-wide only ever turns up by
  // accident and the bot waits for one instead of arranging it.
  //
  // Both are the resolve asked one move further out than `pays` asks it:
  // chainPotential is the deepest cascade, and comboPotential the biggest
  // single clear, that any one swap could make from the board a move LEAVES.
  // Still no shape library, still nothing here knowing what a chain looks
  // like.
  //
  // STRENGTH 0 RETURNS NOTHING, and that is load-bearing rather than tidy:
  // evaluate() skips a feature whose weight is 0, and chainPotential is the
  // most expensive feature in the registry at 14.9ms of an 85ms budget. Off
  // has to cost nothing, not merely mean nothing.
  function toward(target, strength) {
    if (strength < 0) throw new Error('buildToward cannot be negative — ' +
        'climbing away from the target is not a setting');
    if (target !== 'either' && target !== 'chain' && target !== 'combo' &&
        target !== undefined) {
      throw new Error('unknown fire target "' + target + '" — either, chain or combo');
    }
    if (!strength) return {};
    if (target === 'chain') return { chainPotential: strength };
    if (target === 'combo') return { comboPotential: strength };
    return { chainPotential: strength, comboPotential: strength };
  }

  // Divisors from the registry, so a weight means the same thing here as it
  // does when the same idea is asked as a feature. Copied deliberately
  // rather than imported: registry.js requires features.js, features.js is
  // what this file exists to stay out of, and a cycle to fetch two integers
  // is a worse dependency than two integers. climb.test asserts they match.
  var CHAIN_NORM = 16, COMBO_NORM = 36;

  // HOW MUCH BETTER A BOARD IS FOR BEING CLOSER TO THE TARGET.
  //
  // `reach` is the best payout any single swap could fire from the board a
  // move LEAVES — chain depth and combo width. At depth 2 the search has
  // already resolved every one of those swaps to find its best follow-up,
  // so this number is free: measured over 2,151 candidate boards, the
  // deepest chain among the search's own children equalled the
  // chainPotential feature's answer 2,151 times out of 2,151.
  //
  // WHY IT IS NOT JUST THE FEATURE. Asking it as a feature re-runs those
  // ~900 resolves a second time. Measured at depth 2 beam 0: 32ms a decision
  // without it, 166ms with it and 344ms targeting chains, against an 85ms
  // budget. Correct answer, unusable bot.
  //
  // `either` takes the BETTER of the two, never the sum: one good chain and
  // one good combo on the same board is not twice as good a board, and
  // adding them would make `either` pull twice as hard as a target for no
  // stated reason.
  function climb(target, strength, reach) {
    if (!strength || !reach) return 0;
    var chain = (reach.links || 0) / CHAIN_NORM * strength;
    var combo = (reach.wide || 0) / COMBO_NORM * strength;
    if (target === 'chain') return chain;
    if (target === 'combo') return combo;
    if (target === 'either' || target === undefined) return Math.max(chain, combo);
    throw new Error('unknown fire target "' + target + '" — either, chain or combo');
  }

  // Is this move worth stopping to cash in. Two arms, both from the resolve:
  // a cascade `T` links deep, or a single clear `S` wide. They are different
  // weapons — pushGarbage sends a chain as one full-width slab held until the
  // cascade ends, and a combo as separate one-row pieces that leave at once —
  // so neither subsumes the other and both are here.
  function fires(resolved, T, S) {
    var p = payout(resolved);
    return p.links >= T || p.wide >= S;
  }

  // May this move stay in BUILD's pool.
  //
  // A MOVE THAT CLEARS NOTHING ALWAYS MAY. That is what building IS, and it
  // is why this is a filter on cashing in rather than a demand for a payout:
  // a filter that wanted a clear every move would be the opposite bot. Hold
  // clears nothing, so hold survives, so the pool can always wait.
  //
  // Otherwise a clear has to pay: fire at threshold, or break garbage.
  // Breaking garbage pays because digging is progress even when the clear
  // itself scores nothing.
  function pays(resolved, T, S) {
    var p = payout(resolved);
    if (!p.links && !p.wide) return true;
    if (p.breaks > 0) return true;
    return fires(resolved, T, S);
  }

  // DID THE RISING ROW MAKE A CLEAR THAT PAID NOTHING.
  //
  // The stack comes up whether or not the bot acts, and the row that is
  // coming is known before the move is chosen — so a three the board makes
  // by itself is a move the bot should have declined, not something
  // unavoidable. `risen` is the resolve of the board after the rows that
  // land during this move actually land; `own` is what the move itself
  // fires. A rise that only extends what the move already paid for is not a
  // payless rise.
  //
  // THIS IS A PREFERENCE, NOT A VETO, and its caller must treat it as one.
  // Applied as a hard filter it empties the pool — every candidate rises
  // into something once enough rows land — and an empty pool falls through
  // to the unfiltered bot, which fires MORE bare threes than no filter at
  // all. Measured: 239 against 205 over ten games.
  function risesIntoPayless(risen, own, T, S) {
    if (!risen) return false;
    if (pays(risen, T, S)) return false;
    // The move already paid; the rise riding along on top of it is not a
    // reason to decline a move that was worth making.
    return pays(own, T, S);
  }

  // Rows before this board tops out. Garbage already queued has spent its
  // rows the moment it is sent, not when it lands — a board with four rows
  // in the air is four rows nearer the ceiling than it looks, and that is
  // the case a height check misses.
  function runway(board, incomingRows) {
    var left = (board.height || 0) - (board.top || 0) - (incomingRows || 0);
    return left > 0 ? left : 0;
  }

  // TWO TRIGGERS, AND ONLY TWO.
  //
  // Not a deep stack: room left is room left. Not an empty pool for its own
  // sake — that is a broken plan, and it is counted as one.
  //
  // `runway` here is rows rather than frames against the time the held
  // payoff takes to cash in. Frame costs are not in the resolve, so rows is
  // what can be measured honestly today and `margin` is the tunable. The
  // frame version belongs with the opponent model, which needs a clock
  // anyway.
  function forced(o) {
    if (o.broke) return true;
    return o.runway <= o.margin;
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

  return { payout: payout, fires: fires, pays: pays, bars: bars, toward: toward,
           climb: climb, CHAIN_NORM: CHAIN_NORM, COMBO_NORM: COMBO_NORM,
           runway: runway,
           risesIntoPayless: risesIntoPayless,
           forced: forced, planBroke: planBroke, bestPayout: bestPayout };
}));
