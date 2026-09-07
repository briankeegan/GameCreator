// THE FEATURES THEMSELVES — one pure function per feature, and nothing else.
//
// Each takes the evaluator input (see input.js for its exact shape) and
// returns a RAW, UNSIGNED magnitude: "how much of this thing is there",
// never "how good is this". Sign lives in the registry and weight lives in
// the config, so a feature never needs to know whether more of it is good —
// which means the same function can be re-signed or re-weighted without
// being rewritten, and a test can assert a count rather than a score.
//
// Rules for anything added here:
//   - PURE. Same input, same number, no reading the live Stack, no caching.
//   - Reads only `input`. Reaching for the engine is how the two
//     implementations in this repo drifted apart in the first place.
//   - Returns a finite number, or Infinity where that is the honest answer
//     (framesToDeath on a board that cannot die yet).
//
// Features are added ONE AT A TIME, each with the test that proves it
// measures what registry.js says it measures — in BOTH directions. See
// README.md for the four steps.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanelEval = root.PanelEval || {}, root.PanelEval.features = factory();
}(this, function () {
  'use strict';

  // ---------------------------------------------------------------- shared

  // Every matched cell on the board, by the engine's own rule
  // (getMatchingPanels): runs of 3+ of one colour along a row or a column,
  // both axes scanned and the results UNIONED. Garbage (-2) and busy (-1)
  // never match; empty (0) never matches.
  //
  // Returns a { "r:c": [r,c] } map. Its SIZE is the engine's comboSize —
  // board-wide, every colour, not per connected group. That is not a
  // simplification: Stack.checkMatches takes `matching.length` across the
  // whole board as the combo size, which is why an L of five pays as a
  // 5-combo and not as two 3s.
  function matchedCells(board) {
    var grid = board.grid, W = board.width, H = board.height;
    var matched = {}, r, c, i, run, colour;

    function flush(cells, axisFixed, horizontal) {
      if (cells.length < 3) return;
      for (var k = 0; k < cells.length; k++) {
        var rr = horizontal ? axisFixed : cells[k];
        var cc = horizontal ? cells[k] : axisFixed;
        matched[rr + ':' + cc] = [rr, cc];
      }
    }

    for (r = 1; r <= H; r++) {
      run = []; colour = 0;
      for (c = 1; c <= W + 1; c++) {
        var v = c <= W ? grid[r][c] : 0;
        if (v > 0 && (run.length === 0 || v === colour)) { run.push(c); colour = v; }
        else { flush(run, r, true); run = v > 0 ? [c] : []; colour = v > 0 ? v : 0; }
      }
    }
    for (c = 1; c <= W; c++) {
      run = []; colour = 0;
      for (r = 1; r <= H + 1; r++) {
        var v2 = r <= H ? grid[r][c] : 0;
        if (v2 > 0 && (run.length === 0 || v2 === colour)) { run.push(r); colour = v2; }
        else { flush(run, c, false); run = v2 > 0 ? [r] : []; colour = v2 > 0 ? v2 : 0; }
      }
    }
    return matched;
  }

  function touchesGarbage(board, matched) {
    var grid = board.grid, W = board.width, H = board.height;
    for (var k in matched) {
      if (!matched.hasOwnProperty(k)) continue;
      var r = matched[k][0], c = matched[k][1];
      var n = [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]];
      for (var i = 0; i < n.length; i++) {
        var rr = n[i][0], cc = n[i][1];
        if (rr < 1 || rr > H || cc < 1 || cc > W) continue;
        if (grid[rr][cc] === -2) return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------- matchPotential
  //
  // HOW MANY SWAPS FROM HERE WOULD PRODUCE A MATCH WORTH MAKING.
  //
  // Counts distinct legal swaps whose resulting board contains a match that
  // includes one of the two swapped cells and either
  //   - has a combo size of 4 or more, or
  //   - touches garbage.
  // A PLAIN 3 — no garbage, size 3 — scores ZERO, deliberately. It is not a
  // near-miss of a good move, it IS the bad move: comboGarbage() returns []
  // below 4, so a plain 3 sends the opponent literally nothing, and it
  // spends three panels of the material a chain would have been built from.
  // The existing agent already half-knows this (`patience: 0.85` is the
  // chance it holds a plain 3 and keeps building); this states it outright.
  //
  // A count of SWAPS, not a sum of combo sizes. Two swaps that complete the
  // same group would double-count a sum, and "how many ways can this board
  // pay out right now" is the density signal the Puyo reference argues
  // carries a bot (PUYO_REFERENCE.md: links and consecutive colours are 41%
  // of meatfighter's score). If size turns out to matter it belongs in its
  // own feature, measured on its own, not smuggled in here.
  //
  // The match rule is the engine's, via matchedCells: board-wide union,
  // both axes, so an L pays as a 5.
  //
  // TWO LIMITS, both deliberate and both asserted in the tests so they stay
  // visible rather than being rediscovered:
  //
  // 1. ONLY COLOUR-TO-COLOUR SWAPS. A swap where one side is empty slides a
  //    panel into a gap and the board then falls; judging it needs gravity,
  //    which is not a pure function of this snapshot. Real players do this
  //    constantly, so this IS a blind spot — it is left as one rather than
  //    guessed at, because a wrong gravity model here would be invisible.
  // 2. IT DOES NOT LOOK PAST ONE SWAP. Nothing about setup two moves out.
  //
  // Cost: one full-board match scan per legal swap. On a 6x12 board that is
  // ~30 swaps x 72 cells. If profiling says that is too much inside the
  // search, the fix is an incremental scan of the affected lines — NOT a
  // cheaper approximation of the rule, which is how a feature stops
  // measuring what its name says.
  function matchPotential(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    if (!W || !H) return 0;
    var count = 0;

    for (var r = 1; r <= H; r++) {
      for (var c = 1; c < W; c++) {
        var a = grid[r][c], b = grid[r][c + 1];
        if (a <= 0 || b <= 0) continue;   // limit 1: both sides must be real panels
        if (a === b) continue;            // swapping equals changes nothing

        grid[r][c] = b; grid[r][c + 1] = a;
        var matched = matchedCells(board);
        var size = Object.keys(matched).length;
        // The swap must be what CAUSED it. A settled board has no standing
        // matches, but scoring one that ignores the swapped cells would
        // credit every swap on the board with the same pre-existing find.
        var caused = matched[r + ':' + c] || matched[r + ':' + (c + 1)];
        if (caused && (size >= 4 || touchesGarbage(board, matched))) count++;
        grid[r][c] = a; grid[r][c + 1] = b;
      }
    }
    return count;
  }

  // ------------------------------------------------------------------ links
  //
  // SAME-COLOURED PANELS ORTHOGONALLY ADJACENT, COUNTED AS PAIRS.
  //
  // The biggest single term in the Puyo bot that works (25%, see
  // ../PUYO_REFERENCE.md) — and that bot contains no chain logic at all.
  // Rewarding adjacency fills the board with groups of three, one short of
  // popping, and because the reward applies everywhere those groups end up
  // packed against each other; when one finally pops, what falls lands on
  // another near-complete group. A chain is what happens when stored
  // potential is dense enough to touch.
  //
  // Pairs, not cells: a run of three is TWO links. Counting cells would
  // make this a duplicate of "how many panels are on the board", which is
  // its own feature and points the other way.
  //
  // Only real panels link. Garbage (-2) is not a colour — if it counted,
  // taking damage would read as good clustering. Busy (-1) is a panel
  // mid-animation whose colour the snapshot does not know, so pairing it
  // would be inventing one. Empty (0) is nothing.
  //
  // Diagonals never link, matching the match rule they exist to set up.
  // Only right and up are checked, which visits each pair exactly once.
  function links(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var count = 0;
    for (var r = 1; r <= H; r++) {
      for (var c = 1; c <= W; c++) {
        var v = grid[r][c];
        if (v <= 0) continue;
        if (c < W && grid[r][c + 1] === v) count++;
        if (r < H && grid[r + 1][c] === v) count++;
      }
    }
    return count;
  }

  // ------------------------------------------------------ colourVariance
  //
  // PER COLOUR: ITS MEAN POSITION, THEN THE MEAN DISTANCE OF ITS PANELS
  // FROM THAT MEAN. SUMMED OVER COLOURS.
  //
  // Returns SCATTER — how far from gathered each colour is. The registry
  // signs it negative, so gathered scores better; the function itself never
  // decides whether more is good (see the header rules).
  //
  // Two things it must not become, both of which pass a careless test:
  //
  // 1. DISTANCE FROM THE BOARD CENTRE. Subtracting each colour's OWN mean
  //    is what makes it position-invariant: the same clump in the corner
  //    and in the middle must score identically, because what is being
  //    measured is tightness, not location. Height and edge position are
  //    other features' jobs, and a variance that quietly also measured them
  //    would triple-count.
  //
  // 2. ONE MEAN FOR ALL COLOURS. Two colours in two tight clumps at
  //    opposite ends of the board is TIDY — that is exactly the structure
  //    that makes chains — and pooling them into a single mean would report
  //    it as the most scattered board possible.
  //
  // Mean absolute distance rather than squared: squaring makes one far-flung
  // panel dominate the term for its whole colour, and a stray panel is a
  // normal, recoverable state, not a catastrophe. If it turns out the
  // outlier SHOULD dominate, that is a measurable change, not a rewrite.
  //
  // A colour with one panel has no scatter, and a colour with none
  // contributes nothing — both are 0 rather than a division by zero.
  function colourVariance(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var byColour = {}, r, c, v;

    for (r = 1; r <= H; r++) {
      for (c = 1; c <= W; c++) {
        v = grid[r][c];
        if (v <= 0) continue;              // garbage, busy and empty are not colours
        if (!byColour[v]) byColour[v] = [];
        byColour[v].push([r, c]);
      }
    }

    var total = 0;
    for (var colour in byColour) {
      if (!byColour.hasOwnProperty(colour)) continue;
      var cells = byColour[colour], n = cells.length, i;
      if (n < 2) continue;                 // one panel cannot be scattered
      var mr = 0, mc = 0;
      for (i = 0; i < n; i++) { mr += cells[i][0]; mc += cells[i][1]; }
      mr /= n; mc /= n;
      var spread = 0;
      for (i = 0; i < n; i++) {
        spread += Math.abs(cells[i][0] - mr) + Math.abs(cells[i][1] - mc);
      }
      total += spread / n;
    }
    return total;
  }

  return {
    matchPotential: matchPotential,
    colourVariance: colourVariance,
    links: links,
    // exported for tests only — not features
    _matchedCells: matchedCells
  };
}));
