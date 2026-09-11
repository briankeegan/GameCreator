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
    { key: 'matchPotential',   group: 'board',  sign: +1, fn: null,
      what: 'Merged combos of 4+ reachable next move. A PLAIN 3 scores 0 — comboGarbage() sends nothing below 4 — but a 3 that extends a chain or touches garbage still counts.' },

    { key: 'chainPotential',   group: 'board',  sign: +1, fn: null,
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
    // deliberately does not have, and which SearchCpu already implements
    // (_chainExtendMove). Adding it here would be rebuilding that bot. If a
    // brain ever does decide mid-cascade, the feature is in git history and
    // its implementation is intact in features.js.

    { key: 'comboPotential',   group: 'board',  sign: +1, fn: null,
      what: 'The biggest single clear any legal swap could make from this settled board. The other half of stored potential: chainPotential measures how DEEP a cascade could go, matchPotential counts HOW MANY swaps pay out, and neither measures how BIG one clear is — matchPotential\'s own comment reserves size for its own feature rather than smuggling it in. A chain and a combo are different attacks with different payout tables. Asked of the engine (clone, swap, resolve) like chainPotential, and the MAX rather than the sum, because payout is per-clear.' },

    { key: 'staircase',        group: 'board',  sign: +1, fn: null,
      what: 'Loaded steps: panels that would complete a horizontal three if the cell under them cleared and they fell one row. THE shape Panel de Pon players build on purpose, taken from the game\'s own documented library rather than reasoned out here (paneponattack.com, "How to Set Up a Staircase") — PUYO_REFERENCE.md\'s Tier 2 is explicit that the bot is TOLD chain shapes rather than discovering them. Not chainPotential: that needs a trigger swap to exist right now, this measures whether the board is BUILT.' },

    { key: 'flatTop',          group: 'board',  sign: -1, fn: null,
      what: 'Columns level with the tallest, scaled by how high the tallest is. The documented way to die — "the overloaded flat-top is the shape that gets intermediate players killed" — and an INTERACTION, which is why it cannot be left to roughness plus maxHeight: a weighted sum adds them, it cannot multiply them. Flat on the floor costs nothing; flat at the ceiling is the death shape.' },

    { key: 'links',            group: 'board',  sign: +1, fn: null, perPanel: true,
      what: 'Same-coloured panels orthogonally adjacent. meatfighter\'s single biggest term (25%) — the density that makes chains happen without any chain logic. perPanel: it is a COUNT OF PANELS, so it falls whenever a move clears, whatever shape the board is left in — measured at -0.639 per panel removed against garbageSent\'s +1.004, which cancelled a third of the reward for a big clear by arithmetic. In density mode it is divided by the panels it counts over, so half a board can be exactly as tidy.' },

    { key: 'colourVariance',   group: 'board',  sign: -1, fn: null,
      what: 'Per colour, the mean position of its panels and the deviation from it. Low variance means that colour is gathered rather than scattered.' },

    { key: 'edgePenalty',      group: 'board',  sign: -1, fn: null, perPanel: true,
      what: 'Panels in the side columns, which have three orthogonal neighbours instead of four and so link less.' },

    { key: 'garbageOnBoard',   group: 'board',  sign: -1, fn: null,
      what: 'Garbage cells present, on-screen weighted above off-screen.' },

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


    { key: 'maxHeight',        group: 'board',  sign: -1, fn: null,
      what: 'Highest occupied row, plus displacement.' },

    { key: 'fillRatio',        group: 'board',  sign: -1, fn: null,
      what: 'Occupied over total. Overlaps maxHeight — first candidate to cut if it earns nothing.' },

    { key: 'roughness',        group: 'board',  sign: -1, fn: null,
      what: 'Sum of absolute height differences between adjacent columns.' },

    { key: 'garbageAdjacency', group: 'board',  sign: +1, fn: null,
      what: 'Matchable panels 4-way adjacent to eligible garbage. Garbage has no colour, so touching it is the ONLY way it ever clears.' },

    { key: 'colourScarcity',   group: 'board',  sign: -1, fn: null,
      what: 'Colours with fewer than 3 matchable panels left — a colour that can no longer form a match.' },

    { key: 'garbageSent',      group: 'earned', sign: +1, fn: null,
      what: 'Combo sends a set of 1-high blocks of varying width; a chain sends ONE full-width block that grows a row per link. Two different attacks.' },

    { key: 'chainLength',      group: 'earned', sign: +1, fn: null,
      what: 'Chain counter after the move. Backward-looking: what the chain ended up worth.' },

    { key: 'scoreEarned',      group: 'earned', sign: +1, fn: null,
      what: 'THE GAME\'S OWN POINTS for the cascade this move resolved, via PanelEngine.moveScore — the real Tsu-Attack tables, not a restatement of them. It exists because the search is judged on `objective: score` and nothing it could see was denominated in that currency: garbage cells rank a 5-chain at 8x a 4-combo where the score says 15x, and a bare 3 — 54 of the shipped bot\'s 67 matches — is worth exactly 0 under the score and was worth something under every other earned feature. Overlaps garbageSent and chainLength on purpose; the search decides which currency it wants.' },

    { key: 'garbageCleared',   group: 'earned', sign: +1, fn: null,
      what: 'Garbage cells converted this move, including propagation into touching blocks.' },

    { key: 'travelCost',       group: 'move',   sign: -1, fn: null,
      what: 'Frames to bring the cursor from where it is to this candidate swap, per travel.js — real frames, since the cpu walks there (panel-cpu.js beginWalk) rather than teleporting with stack.touchSwap as it used to. One step is 1 frame, four is 13. Set by whichever seam knows the move; 0 when the move is unknown.' },

    // framesToDeath WAS HERE AND HAS BEEN REMOVED. It counted the frames
    // before this board kills you, saturating at SAFE_FRAMES for anything
    // not actively topping out.
    //
    // At level 10 it is saturated on every candidate of every decision:
    // varied in 0 of 179 decisions across five real games, biggest spread 0.
    // maxHealth is 1 there, so the window it would discriminate in — topped
    // out but not yet dead — does not exist. It added a large constant to
    // every score and never broke a tie, while being by far the biggest
    // number in the evaluator (mean 586 against everything else under 22)
    // and therefore the most dangerous thing in it if that ever changed.
    //
    // maxHeight and fillRatio carry the "how close to death is this board"
    // signal, vary between candidates, and are counts like everything else.
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
    keys: FEATURES.map(function (f) { return f.key; }),
    implemented: function () {
      return FEATURES.filter(function (f) { return typeof f.fn === 'function'; })
                     .map(function (f) { return f.key; });
    }
  };
}));
