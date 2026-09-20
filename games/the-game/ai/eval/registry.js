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
  var FEATURES = [
    { key: 'matchPotential',   group: 'board',  sign: +1, norm: 16, fn: null,
      what: 'Merged combos of 4+ reachable next move. A PLAIN 3 scores 0 — comboGarbage() sends nothing below 4 — but a 3 that extends a chain or touches garbage still counts.' },

    { key: 'chainPotential',   group: 'board',  sign: +1, norm: 16, fn: null,
      what: 'The deepest cascade any single legal swap could set off from this settled board. The board it LEAVES, not the move being made — stored potential, which nothing else here could see. PUYO_REFERENCE.md names its absence as the real cap: a scorer that values the board now fires the moment a chain exists, so potential never accumulates. Costs ~66us (a clone+resolve per legal swap), by far the most expensive feature here.' },

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

    { key: 'comboPotential',   group: 'board',  sign: +1, norm: 36, fn: null,
      what: 'The biggest single clear any legal swap could make from this settled board. The other half of stored potential: chainPotential measures how DEEP a cascade could go, matchPotential counts HOW MANY swaps pay out, and neither measures how BIG one clear is — matchPotential\'s own comment reserves size for its own feature rather than smuggling it in. A chain and a combo are different attacks with different payout tables. Asked of the engine (clone, swap, resolve) like chainPotential, and the MAX rather than the sum, because payout is per-clear.' },

    { key: 'staircase',        group: 'board',  sign: +1, norm: 4, fn: null,
      what: 'Loaded steps: panels that would complete a horizontal three if the cell under them cleared and they fell one row. THE shape Panel de Pon players build on purpose, taken from the game\'s own documented library rather than reasoned out here (paneponattack.com, "How to Set Up a Staircase") — PUYO_REFERENCE.md\'s Tier 2 is explicit that the bot is TOLD chain shapes rather than discovering them. Not chainPotential: that needs a trigger swap to exist right now, this measures whether the board is BUILT.' },

    { key: 'staircaseReady',  group: 'board',  sign: +1, norm: 4, fn: null,
      what: 'The longest staircase whose BASE can be cleared by one swap — the shape from docs/CHAIN_SHAPES.md, which fires only when a trigger match at the bottom goes off and lets the lowest step fall. staircase counts the diagonal and never looks for that trigger, so an unfireable stack of loaded pairs scores the same as a loaded gun with a finger on it; this is the half that can actually go off. Same walk as staircase, one flag apart, so the two can never drift into measuring different diagonals.' },

    { key: 'flatTop',          group: 'board',  sign: -1, norm: 12, fn: null,
      what: 'Columns level with the tallest, scaled by how high the tallest is. The documented way to die — "the overloaded flat-top is the shape that gets intermediate players killed" — and an INTERACTION, which is why it cannot be left to roughness plus maxHeight: a weighted sum adds them, it cannot multiply them. Flat on the floor costs nothing; flat at the ceiling is the death shape.' },

    { key: 'popSize',          group: 'board',  sign: +1, norm: 36, fn: F.popSize, perPanel: true,
      what: 'For every horizontal swap the cursor could make, how many panels would pop, summed over the board. Three is the minimum to pop, not the prize: a match is the union of every run of 3 or more through the swapped cell, row AND column, so an L or a T pops five, and comboSize is what feeds comboGarbage and the combo score. This is the Panel Attack half of meatfighter\'s consecutive colours: his game pops four touching blobs so his links term covers one-short-of-popping, ours pops three in a LINE and swaps sideways only, so what matters is whether the third panel is one move from its slot and how much comes with it. Not matchPotential: no clone and no resolve, immediate pop only, so it costs a run-length walk instead of a cascade. Obeys the engine — garbage and busy panels cannot be swapped, and a panel swapped over a hole falls out of the row first.' },

    { key: 'linksH',           group: 'board',  sign: +1, norm: 24, fn: F.linksH, perPanel: true,
      what: 'Same-coloured panels SIDE BY SIDE. The half of links the cursor can finish by itself: swaps are sideways, so the third panel is one walk and one swap away. A trigger you hold rather than fuel you wait on.' },

    { key: 'linksV',           group: 'board',  sign: +1, norm: 24, fn: F.linksV, perPanel: true,
      what: 'Same-coloured panels STACKED. The half of links that finishes by a panel FALLING into place, which needs something below to clear first — cascade fuel, not a decision. Split from linksH because a broken garbage row takes its colours from garbageRowColors, which refuses to repeat left to right, so a freshly converted row can never hold a horizontal pair and all of its value is vertical. linksH + linksV equals links on every board.' },

    { key: 'links',            group: 'board',  sign: +1, norm: 24, fn: null, perPanel: true,
      what: 'Same-coloured panels orthogonally adjacent. meatfighter\'s single biggest term (25%) — the density that makes chains happen without any chain logic. perPanel: it is a COUNT OF PANELS, so it falls whenever a move clears, whatever shape the board is left in — measured at -0.639 per panel removed against garbageSent\'s +1.004, which cancelled a third of the reward for a big clear by arithmetic. In density mode it is divided by the panels it counts over, so half a board can be exactly as tidy.' },

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

    { key: 'fillRatio',        group: 'board',  sign: -1, norm: 1, fn: null,
      what: 'Occupied over total. Overlaps maxHeight — first candidate to cut if it earns nothing.' },

    { key: 'roughness',        group: 'board',  sign: -1, norm: 36, fn: null,
      what: 'Sum of absolute height differences between adjacent columns.' },

    { key: 'garbageAdjacency', group: 'board',  sign: +1, norm: 24, fn: null,
      what: 'Matchable panels 4-way adjacent to a garbage cell. Garbage has no colour, so touching it is the only way it clears. No eligibility test: every garbage panel reads -2 whatever its state.' },

    { key: 'colourScarcity',   group: 'board',  sign: -1, norm: 6, fn: null,
      what: 'Colours with fewer than 3 matchable panels left — a colour that can no longer form a match.' },

    { key: 'paylessClear',     group: 'earned', sign: -1, norm: 1, fn: null, optIn: true,
      what: '1 when this move cleared panels and the clear paid NOTHING: no points from the engine\'s own tables, and no garbage broken. The bare three is the case - COMBO_GARBAGE is empty below 4 and SCORE_COMBO_TA[3] is 0, so it sends nothing, scores nothing and earns no stop time, yet it still tidies the board (fewer panels, shorter stack) and tidiness is most of the decision, so the bot fires thousands a game. Nothing else here can say that a clear was worthless: every neighbouring feature REWARDS a payout and none punishes its absence, and a weighted sum cannot turn a missing reward into a cost. ONE CONDITION, NO EXEMPTION LIST: a three that is a link in a cascade takes the chain bonus and is not payless, a three that pops garbage is not payless, so the cases worth keeping fall out of the test instead of being listed beside it. OPT-IN, and that is load-bearing: optIn features are absent from registry.keys, so a run that does not name it searches exactly the keys it searched before - and KEYS is in the island fingerprint, so a key list that moves makes every chain in flight read its own population as foreign and restart from random vectors.' },

    { key: 'pressure',         group: 'earned', sign: +1, norm: 1, fn: null,
      what: 'This move\'s send measured against the room the opponent has left, counting what is already flying at them as spent. 1 means it finishes them. THE ONLY SHAPE THE OTHER BOARD CAN USEFULLY TAKE: the bot takes the highest-scoring candidate, so a number identical across every candidate cancels out of the ranking — which is why a plain "their headroom" feature does nothing and why incomingGarbage was removed after varying in 0 of 179 decisions. This varies with the send, so it varies candidate to candidate. It states no rule about what to do when they are low.' },

    { key: 'overkill',         group: 'earned', sign: -1, norm: 24, fn: null,
      what: 'Cells sent past what would finish the opponent. Not merely wasted: garbage sitting on a board is MATERIAL, and a clear beside it turns it into panels that can cascade, so over-sending hands them a counter-chain. Signed negative, but the weight decides how much that matters.' },

    { key: 'garbageSent',      group: 'earned', sign: +1, norm: 24, fn: null,
      what: 'Combo sends a set of 1-high blocks of varying width; a chain sends ONE full-width block that grows a row per link. Two different attacks.' },

    { key: 'chainLength',      group: 'earned', sign: +1, norm: 13, fn: null,
      what: 'Chain counter after the move. Backward-looking: what the chain ended up worth.' },

    { key: 'scoreEarned',      group: 'earned', sign: +1, norm: 1000, fn: null,
      what: 'THE GAME\'S OWN POINTS for the cascade this move resolved, via PanelEngine.moveScore — the real Tsu-Attack tables, not a restatement of them. It exists because the search is judged on `objective: score` and nothing it could see was denominated in that currency: garbage cells rank a 5-chain at 8x a 4-combo where the score says 15x, and a bare 3 — 54 of the shipped bot\'s 67 matches — is worth exactly 0 under the score and was worth something under every other earned feature. Overlaps garbageSent and chainLength on purpose; the search decides which currency it wants.' },

    { key: 'stopTimeEarned',   group: 'earned', sign: +1, norm: 100, fn: null,
      what: 'Frames of stop time this move bought — the stack stops rising for that long. The real payoff for breaking garbage, and invisible to the evaluator until resolve() started reporting it.' },

    { key: 'stopTimeGain',     group: 'earned', sign: +1, norm: 100, fn: null,
      what: 'The stop-time frames this move actually BUYS: max(0, earned - the stop clock already running), and 0 unless the board could die (topped out, or within DANGER_ROWS of the ceiling). stopTimeEarned is flat and ignores the clock -- awardStopTime takes a MAX, so earning 90 under a 120 clock buys nothing, and 60 frames on a safe board buy nothing that matters. A weighted sum cannot multiply stop time by danger, so the conjunction lives inside the feature, as it does in flatTop. Unlike the removed framesToDeath, it VARIES BETWEEN CANDIDATES: the banked half is per-decision, the earned half is per-candidate.' },

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
