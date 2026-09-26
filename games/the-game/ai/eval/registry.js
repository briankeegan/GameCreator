// THE FEATURE REGISTRY — the one list of what the evaluator can measure.
//
// Every feature this evaluator knows about is declared here, whether or not
// it is built yet. A declaration carries its sign, the group it belongs to,
// and a one-line statement of what it measures; `fn` stays null until the
// feature is actually implemented and tested.
//
// WHY DECLARE THE UNBUILT ONES. The alternative is a stub that returns 0,
// and a stub returning 0 is indistinguishable from a feature that computes
// correctly and finds nothing — which is the failure this whole directory
// exists to avoid. Declared-but-null means `evaluate` can REFUSE a non-zero
// weight on a feature nobody has written (see evaluator.js), so a config
// naming a feature that does not exist fails loudly instead of quietly
// scoring every move the same.
//
// Adding a feature is three edits, in this order:
//   1. implement it in features.js
//   2. point `fn` at it here
//   3. add its case to features.test.js — a hand-built board whose answer
//      is known by eye, asserting BOTH that it fires on the thing it is for
//      and that it stays quiet on the near-miss
// Skipping 3 is how a feature that measures the wrong thing gets tuned for
// weeks; the number still moves, so it still looks like it is working.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./features.js'));
  else root.PanelEval = root.PanelEval || {}, root.PanelEval.registry = factory(root.PanelEval.features);
}(this, function (F) {
  'use strict';

  // group: 'board'  — what the position looks like once the move settles
  //        'earned' — what this move just paid out
  //        'clock'  — how long until death
  //        'move'   — what this candidate costs to PLAY, not what it leaves
  // REMOVED, and not coming back without a reason:
  //   staircase, staircaseReady — SHAPES. This bot answers "what would this
  //     swap DO" by resolving it, never by matching a picture of a known
  //     pattern. The library version was ruled out deliberately.
  //   chainPotential, comboPotential, matchPotential — superseded by the
  //     reach* measurements, which are the same question answered size by
  //     size, so a weight can say a 6-chain is worth more than a 3 instead
  //     of one number conflating them.
  //   popSize, roughness, flatTop — overlap the height and shape group, and
  //     none survived a conversation about what the bot actually needs told.
  //   links — linksH and linksV already carry it, split by direction.
  //   scoreEarned — the same event as chainLength under another name.
  //   stopTimeGain — stopTimeEarned is the measurement; the "gain" version
  //     needs three rare things at once and read constant 0 across 4,381
  //     candidates.
  var FEATURES = [


    // latentChain WAS HERE AND HAS BEEN REMOVED. It scored whether a cell
    // already carrying the chain flag settles into a match — the
    // forward-looking half of chainLength, meant to spot a move that
    // EXTENDS a cascade already in flight.
    //
    // It never fired. Not in one brain, in either of them, ever. It sat on
    // wiring.test.js's UNREACHABLE list for the search brain the whole time
    // it existed, and under the Puyo brain it measured a spread of 0.00
    // across the candidates of every decision in three full games — while
    // the GA, unable to tell that a dimension does nothing, assigned it 267
    // out of 300. One of eighteen search dimensions was a knob attached to
    // nothing, being tuned every round.
    //
    // The reason is structural, not a wiring fault: it needs a decision
    // made MID-CASCADE, and _cascadePrediction returns null unless panels
    // are in flight. Both brains decide on cooldown boundaries, when the
    // board has settled — 0 of 33 calls returned anything in a full game.
    //
    // Making it fire would mean a bot that re-decides during a cascade,
    // which is chain-extension logic — a mechanism the Puyo design
    // deliberately does not have. If a brain ever does decide mid-cascade,
    // the implementation is intact in features.js.






    { key: 'linksH',           group: 'board',  sign: +1, norm: 24, fn: F.linksH, perPanel: true,
      what: 'Same-coloured panels SIDE BY SIDE. The half of links the cursor can finish by itself: swaps are sideways, so the third panel is one walk and one swap away. A trigger you hold rather than fuel you wait on.' },

    { key: 'linksV',           group: 'board',  sign: +1, norm: 24, fn: F.linksV, perPanel: true,
      what: 'Same-coloured panels STACKED. The half of links that finishes by a panel FALLING into place, which needs something below to clear first — cascade fuel, not a decision. Split from linksH because a broken garbage row takes its colours from garbageRowColors, which refuses to repeat left to right, so a freshly converted row can never hold a horizontal pair and all of its value is vertical. linksH + linksV equals links on every board.' },


    { key: 'chainLayers',      group: 'board',  sign: +1, norm: 12, fn: F.chainLayers,
      what: 'Distinct ROWS holding at least one same-coloured adjacent pair. linksV calls stacked pairs cascade fuel and is right, but counts six pairs gathered in one place the same as six spread up the board -- the first is one combo, the second is the shape a long chain is made of. Rows rather than pairs: a second pair on a row already counted fires WITH the first, not after it. Divisor is the board height, the analytic bound, since at most one row can be counted per row. NOT chainPotential UNDER A NEW NAME: reach* asks whether ONE SWAP from here fires an N-chain, which is a trigger already loaded, and chainPotential was removed as its duplicate. This asks what STRUCTURE is stacked up whether or not any trigger exists yet, which is where the middle of a multi-move build lives -- the moves reach* scores as worthless because nothing fires at the end of them.' },

    { key: 'breakPairs',       group: 'board',  sign: +1, norm: 11, fn: F.breakPairs,
      what: 'Colour panels touching garbage that ALREADY have a same-coloured neighbour: one panel short of a match that pops the lid. Garbage clears only when a match touches it, so these are the only panels on the board that can take any of it away. garbageAdjacency counts panels resting against garbage whether or not they are near matching, and reachBreak asks the binary question one ply out; this counts how much of the surface under the lid is loaded. Divisor 11, the maximum observed over 945,796 candidate evaluations of live play; nonzero on 33.9% of them, 1 or 2 on 30%.' },

    { key: 'colourVariance',   group: 'board',  sign: -1, norm: 32, fn: null,
      what: 'Per colour, the mean position of its panels and the deviation from it. Low variance means that colour is gathered rather than scattered.' },

    { key: 'edgePenalty',      group: 'board',  sign: -1, norm: 24, fn: null, perPanel: true,
      what: 'Panels in the side columns, which have three orthogonal neighbours instead of four and so link less.' },

    { key: 'garbageOnBoard',   group: 'board',  sign: -1, norm: 72, fn: null,
      what: 'Garbage cells, counted flat — every cell is worth 1 wherever it sits. The board here is the VISIBLE 12 rows, so garbage above the ceiling is not in this number and cannot be.' },

    // incomingGarbage WAS HERE AND HAS BEEN REMOVED. It measured the garbage
    // queued against this board — which matters enormously to how the game
    // should be played, and which this scoring scheme cannot act on.
    //
    // It is a property of the QUEUE, not of the move. Every candidate in a
    // decision faces the same incoming garbage, so it contributes the
    // identical number to all of them and cancels out of the ranking.
    // Measured: varied in 0 of 179 decisions across five real games. Not
    // rarely — never, and by construction.
    //
    // Using it would need an INTERACTION — "when garbage is coming, care
    // more about height" — and a weighted sum cannot express one. That is a
    // limit of the method rather than of the wiring, and it is why all seven
    // of meatfighter's features describe the board a move LEAVES instead of
    // any global state.
    //
    // The information is not lost: garbageCleared (does this move clear a
    // slab), garbageAdjacency (does it set one up) and garbageOnBoard (what
    // is left afterwards) all vary between candidates and are alive.


    { key: 'maxHeight',        group: 'board',  sign: -1, norm: 13, fn: null,
      what: 'Highest occupied row, plus displacement.' },

    { key: 'material',         group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Colour panels over total cells — the stock a move leaves to build with. Garbage and the dimmed incoming row are not material. Already a share, so the divisor is 1. Held apart from maxHeight so depth of stock and nearness to the ceiling carry their own weights.' },


    { key: 'garbageAdjacency', group: 'board',  sign: +1, norm: 24, fn: null,
      what: 'Matchable panels 4-way adjacent to a garbage cell. Garbage has no colour, so touching it is the only way it clears. No eligibility test: every garbage panel reads -2 whatever its state.' },




    { key: 'reachBreak',       group: 'board',  sign: +1, norm: 1, fn: F.reachBreak,
      what: 'Can the board this move LEAVES break garbage next move. Garbage clears only when a match touches it, so the move BEFORE the break -- the one that lines a match up against the garbage -- is where the break is decided, and nothing pays for it. brokeGarbage pays once the break happens; garbageAdjacency counts panels resting against garbage whether or not they are near matching. Free at depth 2, where the second ply already resolves every swap from that board. Lives on about 11% of decisions, so it cannot carry a run on its own.' },

    { key: 'reach4combo',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a combo 4 wide next move. One measurement per size, so WHICH sizes are worth building toward is a weight rather than a setting picked by hand. Cumulative: a board holding a 7 reads on every size up to 7. Free at depth 2, where the second ply already resolves every swap from that board. 4 is the floor because COMBO_GARBAGE sends nothing below it.' },
    { key: 'reach5combo',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a combo 5 wide next move. One measurement per size, so WHICH sizes are worth building toward is a weight rather than a setting picked by hand. Cumulative: a board holding a 7 reads on every size up to 7. Free at depth 2, where the second ply already resolves every swap from that board. 4 is the floor because COMBO_GARBAGE sends nothing below it.' },
    { key: 'reach6combo',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a combo 6 wide next move. One measurement per size, so WHICH sizes are worth building toward is a weight rather than a setting picked by hand. Cumulative: a board holding a 7 reads on every size up to 7. Free at depth 2, where the second ply already resolves every swap from that board. 4 is the floor because COMBO_GARBAGE sends nothing below it.' },
    { key: 'reach7combo',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a combo 7 wide next move. One measurement per size, so WHICH sizes are worth building toward is a weight rather than a setting picked by hand. Cumulative: a board holding a 7 reads on every size up to 7. Free at depth 2, where the second ply already resolves every swap from that board. 4 is the floor because COMBO_GARBAGE sends nothing below it.' },
    { key: 'reach8combo',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a combo 8 wide next move. One measurement per size, so WHICH sizes are worth building toward is a weight rather than a setting picked by hand. Cumulative: a board holding a 7 reads on every size up to 7. Free at depth 2, where the second ply already resolves every swap from that board. 4 is the floor because COMBO_GARBAGE sends nothing below it.' },
    { key: 'reach9combo',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a combo 9 wide next move. One measurement per size, so WHICH sizes are worth building toward is a weight rather than a setting picked by hand. Cumulative: a board holding a 7 reads on every size up to 7. Free at depth 2, where the second ply already resolves every swap from that board. 4 is the floor because COMBO_GARBAGE sends nothing below it.' },
    { key: 'reach10combo',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a combo 10 wide next move. One measurement per size, so WHICH sizes are worth building toward is a weight rather than a setting picked by hand. Cumulative: a board holding a 7 reads on every size up to 7. Free at depth 2, where the second ply already resolves every swap from that board. 4 is the floor because COMBO_GARBAGE sends nothing below it.' },
    { key: 'reach2chain',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a chain 2 links deep next move. Counted apart from combos because they are different weapons: pushGarbage sends a chain as one full-width slab held until the cascade ends, and a combo as separate one-row pieces that leave at once. 2 is the floor because a 2-chain already pays 50 points and sends a slab.' },
    { key: 'reach3chain',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a chain 3 links deep next move. Counted apart from combos because they are different weapons: pushGarbage sends a chain as one full-width slab held until the cascade ends, and a combo as separate one-row pieces that leave at once. 2 is the floor because a 2-chain already pays 50 points and sends a slab.' },
    { key: 'reach4chain',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a chain 4 links deep next move. Counted apart from combos because they are different weapons: pushGarbage sends a chain as one full-width slab held until the cascade ends, and a combo as separate one-row pieces that leave at once. 2 is the floor because a 2-chain already pays 50 points and sends a slab.' },
    { key: 'reach5chain',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a chain 5 links deep next move. Counted apart from combos because they are different weapons: pushGarbage sends a chain as one full-width slab held until the cascade ends, and a combo as separate one-row pieces that leave at once. 2 is the floor because a 2-chain already pays 50 points and sends a slab.' },
    { key: 'reach6chain',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a chain 6 links deep next move. Counted apart from combos because they are different weapons: pushGarbage sends a chain as one full-width slab held until the cascade ends, and a combo as separate one-row pieces that leave at once. 2 is the floor because a 2-chain already pays 50 points and sends a slab.' },
    { key: 'reach7chain',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a chain 7 links deep next move. Counted apart from combos because they are different weapons: pushGarbage sends a chain as one full-width slab held until the cascade ends, and a combo as separate one-row pieces that leave at once. 2 is the floor because a 2-chain already pays 50 points and sends a slab.' },
    { key: 'reach8chain',      group: 'board',  sign: +1, norm: 1, fn: null,
      what: 'Can the board this move LEAVES fire a chain 8 links deep next move. Counted apart from combos because they are different weapons: pushGarbage sends a chain as one full-width slab held until the cascade ends, and a combo as separate one-row pieces that leave at once. 2 is the floor because a 2-chain already pays 50 points and sends a slab. MEASURED, 2 seeds x 4 scenarios, 688 decisions at depth 2: this size separates the candidates of a decision on 0.0% of them -- reach6chain 0.4%, reach7chain 0.0%, reach10combo 4.5%. A feature that never tells two candidates apart cannot be learned however much it varies over a game, and feature_liveness.js second table is that measurement.' },

    { key: 'pressure',         group: 'earned', sign: +1, norm: 1, fn: null,
      what: 'This move\'s send measured against the room the opponent has left, counting what is already flying at them as spent. 1 means it finishes them. THE ONLY SHAPE THE OTHER BOARD CAN USEFULLY TAKE: the bot takes the highest-scoring candidate, so a number identical across every candidate cancels out of the ranking — which is why a plain "their headroom" feature does nothing and why incomingGarbage was removed after varying in 0 of 179 decisions. This varies with the send, so it varies candidate to candidate. It states no rule about what to do when they are low.' },

    { key: 'overkill',         group: 'earned', sign: -1, norm: 24, fn: null,
      what: 'Cells sent past what would finish the opponent. Not merely wasted: garbage sitting on a board is MATERIAL, and a clear beside it turns it into panels that can cascade, so over-sending hands them a counter-chain. Signed negative, but the weight decides how much that matters.' },

    // garbageSent WAS HERE AND HAS BEEN REMOVED. It counted the cells this
    // move sends, blind to who they were going to. `pressure` is the same
    // count divided by the room the opponent has left — and that room is
    // identical for every candidate in a decision, so within any one
    // decision the two are exactly proportional. Collinear terms split their
    // weight arbitrarily, which is why 193 against 45 cannot be read.
    //
    // pressure is the one that survives: it says what a send is WORTH
    // against the board it is going to, and the training runs are
    // head-to-head, so there is always a board to measure against.

    { key: 'chainLength',      group: 'earned', sign: +1, norm: 13, fn: null,
      what: 'Chain counter after the move. Backward-looking: what the chain ended up worth.' },


    { key: 'stopTimeEarned',   group: 'earned', sign: +1, norm: 100, fn: null,
      what: 'Frames of stop time this move bought — the stack stops rising for that long. The real payoff for breaking garbage, and invisible to the evaluator until resolve() started reporting it.' },


    { key: 'brokeGarbage',     group: 'earned', sign: +1, norm: 72, fn: null,
      what: 'Garbage cells this move popped — one row of a slab per match, which is what the engine does rather than the whole slab.' },

    { key: 'garbageCleared',   group: 'earned', sign: +1, norm: 72, fn: null,
      what: 'Garbage cells converted this move, including propagation into touching blocks.' },

    { key: 'travelCost',       group: 'move',   sign: -1, norm: 16, fn: null,
      what: 'Frames to bring the cursor from where it is to this candidate swap, per travel.js — real frames, since the cpu walks there (panel-cpu.js beginWalk) rather than teleporting with stack.touchSwap as it used to. One step is 1 frame, four is 13. Set by whichever seam knows the move; 0 when the move is unknown.' },

  ];

  var byKey = {};
  for (var i = 0; i < FEATURES.length; i++) {
    var f = FEATURES[i];
    if (byKey[f.key]) throw new Error('duplicate feature key: ' + f.key);
    f.fn = (F && F[f.key]) || null;
    byKey[f.key] = f;
  }

  return {
    all: FEATURES,
    byKey: byKey,
    // THE DEFAULT GENOME. optIn features are NOT in here. A feature added to
    // this list joins every run's KEYS the moment it exists, and KEYS is in
    // the island fingerprint -- so adding one would make every chain in
    // flight read its saved population as foreign and start again from
    // random vectors. A run that wants one names it.
    keys: FEATURES.filter(function (f) { return !f.optIn; })
                  .map(function (f) { return f.key; }),
    optIn: FEATURES.filter(function (f) { return f.optIn; })
                   .map(function (f) { return f.key; }),

    // THE GENOME A RUN ACTUALLY SEARCHES, worked out in ONE place.
    //
    // Four files built this list by hand -- train.js, train_pbt.js,
    // train_versus.js and pbt_worker.js -- and pbt_worker has to agree with
    // train_pbt exactly or the workers score a different genome than the
    // parent thinks it dealt them. Four copies of a filter is four chances
    // to disagree, and the disagreement would be silent.
    //
    // exclude drops a default key. include adds an optIn one, and refuses a
    // name that is not opt-in: a typo that quietly searched nothing new
    // would look exactly like a feature that did not help.
    genomeKeys: function (excludeStr, includeStr) {
      var out = [], i;
      var ex = String(excludeStr || '').split(',').map(function (x) { return x.trim(); })
                                       .filter(Boolean);
      var inc = String(includeStr || '').split(',').map(function (x) { return x.trim(); })
                                        .filter(Boolean);
      for (i = 0; i < FEATURES.length; i++) {
        var f = FEATURES[i];
        if (f.optIn) continue;
        if (ex.indexOf(f.key) < 0) out.push(f.key);
      }
      for (i = 0; i < inc.length; i++) {
        var f2 = byKey[inc[i]];
        if (!f2) throw new Error('GC_INCLUDE names "' + inc[i] + '", which is not a feature');
        if (!f2.optIn) {
          throw new Error('GC_INCLUDE names "' + inc[i] + '", which is not opt-in — it is ' +
                          'already in the genome unless GC_EXCLUDE drops it');
        }
        if (out.indexOf(f2.key) < 0) out.push(f2.key);
      }
      return out;
    },
    implemented: function () {
      return FEATURES.filter(function (f) { return typeof f.fn === 'function'; })
                     .map(function (f) { return f.key; });
    }
  };
}));
