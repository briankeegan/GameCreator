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
// panel-cpu.js's CURSOR_MOVE_FRAMES — the tap cadence travel.js prices with.
var MOVE_FRAMES = 4;

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
  // Only the swapped ROW and the two swapped COLUMNS can gain a run, so
  // only those three lines are scanned rather than the whole board. On a
  // settled position — which is what the search scores — there are no
  // standing matches anywhere else to miss, so this returns exactly what a
  // full scan returns. Measured at 69.3% of all feature cost before this,
  // 25x the next most expensive feature; the equality with the full scan is
  // asserted in features.test.js rather than argued here.
  function matchedCellsNear(board, row, colA, colB) {
    var grid = board.grid, W = board.width, H = board.height;
    var matched = {};
    var run, colour, i, k, v;

    run = []; colour = 0;
    for (k = 1; k <= W + 1; k++) {
      v = k <= W ? grid[row][k] : 0;
      if (v > 0 && (run.length === 0 || v === colour)) { run.push(k); colour = v; }
      else {
        if (run.length >= 3) for (i = 0; i < run.length; i++) matched[row + ':' + run[i]] = [row, run[i]];
        run = v > 0 ? [k] : []; colour = v > 0 ? v : 0;
      }
    }
    [colA, colB].forEach(function (col) {
      var crun = [], ccolour = 0, r2, cv;
      for (r2 = 1; r2 <= H + 1; r2++) {
        cv = r2 <= H ? grid[r2][col] : 0;
        if (cv > 0 && (crun.length === 0 || cv === ccolour)) { crun.push(r2); ccolour = cv; }
        else {
          if (crun.length >= 3) for (var j = 0; j < crun.length; j++) matched[crun[j] + ':' + col] = [crun[j], col];
          crun = cv > 0 ? [r2] : []; ccolour = cv > 0 ? cv : 0;
        }
      }
    });
    return matched;
  }

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
        var matched = matchedCellsNear(board, r, c, c + 1);
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

  // -------------------------------------------------------- chainPotential
  //
  // THE BIGGEST CHAIN THIS BOARD COULD FIRE, WITHOUT FIRING IT.
  //
  // PUYO_REFERENCE.md names greedy-fires-too-early as the real cap on this
  // whole approach, and gives the fix in two halves: a patience term, and
  // "an evaluation that scores the biggest chain I COULD fire rather than
  // the biggest chain available now". This is the second half, and nothing
  // here measured it.
  //
  // Every other feature reads the board as it stands or a cascade already
  // running — chainLength scores a chain being fired, latentChain one in
  // flight. STORED potential had no representation at all, so "I am sitting
  // on a loaded 5-chain and choosing not to trigger it" was not a state the
  // evaluator could describe. The consequence was measured before this
  // existed: a trained set whose LARGEST weight was chainLength=278
  // produced 0% medium chains on three of four drills. The search could not
  // find the behaviour because no weight could express it.
  //
  // Note what this does NOT score: the swap being considered. It scores the
  // board that swap LEAVES — its readiness to chain — which is exactly what
  // a patient player is building and an impatient one is spending. A move
  // that fires a 2-chain now and leaves a board with nothing loaded will
  // rank below one that fires nothing and leaves a 4 waiting, if the weight
  // says so. Whether it should is the search's business, not this
  // function's.
  //
  // COST. This clones and fully resolves the board once per legal swap
  // (~16-17 on a real board), so it is far and away the most expensive
  // feature here — everything else reads the grid. Profiled and recorded in
  // FINDINGS.md rather than assumed; if it has to come down, the lever is
  // scoring only swaps that matchPotential already flagged.
  function chainPotential(input) {
    // liveBoard, not board: input.js flattens `board` to a plain shape on
    // purpose, which strips the clone/swap/resolve this needs. See the
    // comment on liveBoard there. Falls back to `board` for direct callers
    // (the tests) that hand over a real LogicalBoard themselves.
    var board = input.liveBoard || input.board;
    // A hand-built plain object has none of those methods, and the honest
    // answer there is 0 rather than a number derived from a second, private
    // implementation of gravity and matching.
    if (!board || typeof board.legalSwaps !== 'function' ||
        typeof board.clone !== 'function' || typeof board.resolve !== 'function') return 0;
    var swaps = board.legalSwaps(), best = 0;
    for (var i = 0; i < swaps.length; i++) {
      var trial = board.clone();
      trial.swap(swaps[i][0], swaps[i][1]);
      var r = trial.resolve();
      if (r.chainLength > best) best = r.chainLength;
    }
    return best;
  }

  // A CHEAP FILTER WAS TRIED HERE AND IS WRONG. The idea: a swap that
  // matches nothing on the spot cannot start a cascade, so skip the
  // clone+resolve for those. It passes the 120-board random test in
  // chainpotential.test.js and it is still wrong — resolve() applies
  // GRAVITY first, so a swap that drops a panel over a hole can match after
  // falling, and the filter never sees it. Measured against the full
  // version on 3,000 boards captured from real play: 10 disagreements, all
  // that shape, for a 27% saving (66 -> 48 us). Not worth it, and recorded
  // here so the same shortcut is not re-derived and shipped on the strength
  // of the random-board test alone.

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

  // --------------------------------------------------------- edgePenalty
  //
  // PANELS IN THE SIDE COLUMNS.
  //
  // A panel against a wall has three orthogonal neighbours instead of four,
  // so it can link less and is worth less as chain material
  // (../PUYO_REFERENCE.md, 8% of meatfighter's score). A plain count, which
  // is what the reference measures; if it turns out the penalty should
  // scale with how built-up the board is, that is a measurable change.
  //
  // Only real panels. Garbage on an edge is not material we are trying to
  // link, and a busy cell's colour is unknown to the snapshot.
  function edgePenalty(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var n = 0;
    for (var r = 1; r <= H; r++) {
      if (grid[r][1] > 0) n++;
      if (W > 1 && grid[r][W] > 0) n++;
    }
    return n;
  }

  // ----------------------------------------------------------- maxHeight
  //
  // THE TALLEST COLUMN, PLUS THE RISE ALREADY UNDER IT.
  //
  // Occupancy, not colour: garbage is in the way exactly as much as a
  // panel, and a busy cell is a panel mid-animation. A buried gap does not
  // reduce it — what matters is how close the top of the stack is to the
  // ceiling, which is what tops a board out.
  //
  // Displacement is the part that gets left off. It is 0..15 sub-row pixels
  // of rise, so a board one pixel from gaining a row is genuinely taller
  // than one that just gained one; adding displacement/16 keeps the
  // ordering right without ever double-counting the row it is about to
  // become.
  function maxHeight(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var top = 0;
    for (var c = 1; c <= W; c++) {
      for (var r = H; r >= 1; r--) {
        if (grid[r][c] !== 0) { if (r > top) top = r; break; }
      }
    }
    return top + (input.displacement || 0) / 16;
  }

  // ----------------------------------------------------------- fillRatio
  //
  // OCCUPIED CELLS OVER TOTAL CELLS.
  //
  // NOT LogicalBoard.fillRatio, which returns maxHeight/height and is
  // therefore a second copy of maxHeight under a misleading name. This one
  // is about DENSITY: how much of the board is spent, regardless of shape.
  // The two are kept apart on purpose and the tests assert the separation —
  // a tall thin column and a flat wide layer of the same panel count score
  // the same here and differently on maxHeight. If they ever stop
  // disagreeing, one of them should be cut rather than tuned.
  function fillRatio(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    if (!W || !H) return 0;
    var used = 0;
    for (var r = 1; r <= H; r++) {
      for (var c = 1; c <= W; c++) if (grid[r][c] !== 0) used++;
    }
    return used / (W * H);
  }

  // ----------------------------------------------------------- roughness
  //
  // THE SUM OF ABSOLUTE HEIGHT DIFFERENCES BETWEEN ADJACENT COLUMNS.
  //
  // A jagged surface is hard to build matches on and hard to land garbage
  // flat against. It is NOT height: a uniformly tall board is perfectly
  // smooth and scores zero here, which is what keeps this from being a
  // third copy of maxHeight.
  //
  // Column height is the topmost occupied row, so a BURIED hole does not
  // register. Buried holes are a real problem and deliberately not this
  // feature's — noted here rather than half-solved, since a roughness that
  // sometimes counted holes would be neither measure.
  function roughness(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var heights = [], c, r;
    for (c = 1; c <= W; c++) {
      heights[c] = 0;
      for (r = H; r >= 1; r--) if (grid[r][c] !== 0) { heights[c] = r; break; }
    }
    var sum = 0;
    for (c = 1; c < W; c++) sum += Math.abs(heights[c] - heights[c + 1]);
    return sum;
  }

  // ------------------------------------------------------ garbageOnBoard
  //
  // GARBAGE CELLS PRESENT. Cells, not blocks: a 6x2 slab is twelve cells of
  // wall, and counting it as one would make a full-board block look like a
  // pebble beside a single dropped row.
  function garbageOnBoard(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var n = 0;
    for (var r = 1; r <= H; r++) {
      for (var c = 1; c <= W; c++) if (grid[r][c] === -2) n++;
    }
    return n;
  }

  // ----------------------------------------------------- incomingGarbage
  //
  // ATTACKS QUEUED BUT NOT LANDED, IN CELLS.
  //
  // The grid cannot show these, and that is the point. panel-cpu.js records
  // this as the mechanism behind its worst deaths: a burst arrives back to
  // back, danger only trips once each piece has physically landed, and by
  // then there was never a calm moment to react in — the danger was real
  // the instant the queue filled and invisible until each piece arrived.
  //
  // Cells rather than rows (_queuedGarbageHeight divides by width) because
  // a 3-wide piece and a 6-wide piece are not the same threat, and dividing
  // throws that away before the weight ever sees it.
  function incomingGarbage(input) {
    var q = input.incoming, cells = 0;
    for (var i = 0; i < q.length; i++) cells += (q[i].width || 0) * (q[i].height || 0);
    return cells;
  }

  // ---------------------------------------------------- garbageAdjacency
  //
  // MATCHABLE PANELS ORTHOGONALLY TOUCHING GARBAGE.
  //
  // Garbage has no colour and can never be matched, so touching it with a
  // match is the only way it ever clears. This counts PANELS, not contacts:
  // a panel wedged in a garbage pocket is one opportunity, not three, since
  // one match through it clears everything it touches (and the clear then
  // propagates block to block anyway).
  //
  // Deliberately not a second count of garbage — the tests pin that by
  // scoring the same garbage buried among panels and alone on the board.
  function garbageAdjacency(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var n = 0;
    for (var r = 1; r <= H; r++) {
      for (var c = 1; c <= W; c++) {
        if (grid[r][c] <= 0) continue;          // only a matchable panel can do this
        if ((r < H && grid[r + 1][c] === -2) ||
            (r > 1 && grid[r - 1][c] === -2) ||
            (c < W && grid[r][c + 1] === -2) ||
            (c > 1 && grid[r][c - 1] === -2)) n++;
      }
    }
    return n;
  }

  // ------------------------------------------------------ colourScarcity
  //
  // COLOURS DOWN TO FEWER THAN THREE MATCHABLE PANELS.
  //
  // Three is the match length, so a colour below it cannot form a match at
  // all — the panels are dead weight until more of that colour rises. This
  // is the "stuck" death panel-cpu.js describes: once no legal swap can
  // match anything, the real AI wiggles in place until the anti-stall
  // punishment kills it.
  //
  // A colour with ZERO panels is NOT scarce, and that is the whole trap.
  // You cannot be stuck for want of a colour you are not holding, and
  // counting absent colours would make an empty board — the safest board
  // there is — score as the most desperate.
  //
  // Which is why this reads only the board and NOT input.colours, despite
  // the level's colour count being available. Iterating the colours in
  // play would have to decide what a count of zero means, and every answer
  // is wrong: zero is not scarcity, so it would be skipped, which is
  // exactly what counting only the colours present already does — with one
  // fewer input to get out of step with the board.
  //
  // Garbage and busy cells are not supply: a wall of garbage does not help
  // you match, and a panel mid-animation has no colour this snapshot knows.
  function colourScarcity(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var counts = {}, r, c, v;
    for (r = 1; r <= H; r++) {
      for (c = 1; c <= W; c++) {
        v = grid[r][c];
        if (v > 0) counts[v] = (counts[v] || 0) + 1;
      }
    }
    var scarce = 0;
    for (var colour in counts) {
      if (counts.hasOwnProperty(colour) && counts[colour] > 0 && counts[colour] < 3) scarce++;
    }
    return scarce;
  }

  // ---------------------------------------------------------- garbageSent
  //
  // THE ATTACK THIS MOVE LAUNCHED, IN CELLS.
  //
  // Cells rather than pieces, because the two ways of attacking are shaped
  // differently and pieces would flatten them. pushGarbage sends a COMBO as
  // a set of 1-high blocks whose widths come from COMBO_GARBAGE, and a
  // CHAIN as ONE full-width block that grows a row per link. So a 4-combo
  // is a handful of cells in one row; a 4-chain is three full rows. Cells
  // is the common currency between them.
  //
  // Note what is NOT here: any judgement about a combo being worth more or
  // less than a chain of the same cell count. If that turns out to matter
  // it is a second feature with its own weight, measured on its own —
  // not a fudge factor hidden inside this one.
  function garbageSent(input) {
    var pieces = input.earned.garbageSent, cells = 0;
    for (var i = 0; i < pieces.length; i++) {
      cells += (pieces[i][0] || 0) * (pieces[i][1] || 0);
    }
    return cells;
  }

  // ---------------------------------------------------------- chainLength
  //
  // THE CHAIN COUNTER AFTER THE MOVE.
  //
  // Backward-looking: what the chain ended up worth. latentChain is the
  // forward-looking half — whether a landing will CONTINUE one.
  //
  // The off-by-one is the whole feature. The match that STARTS a chain is
  // not a link; the first link makes it x2 (incrementChainCounter, which
  // sets the counter to 2 rather than incrementing from 1). So the counter
  // is 0 or 2 or more, and there is no such thing as a chain of one. A
  // feature that normalised it to "links + 1" would be wrong by one for
  // every chain in the game.
  //
  // Passed straight through rather than transformed, because the engine's
  // number IS the quantity awardStopTime and pushGarbage both pay on.
  function chainLength(input) {
    return input.earned.chainLength || 0;
  }

  // ----------------------------------------------------------- travelCost
  //
  // WHAT THIS CANDIDATE COSTS TO REACH, IN FRAMES.
  //
  // The only feature that measures the MOVE rather than the board it
  // leaves. It was added while the bot could still teleport — stack.touchSwap
  // queues a swap anywhere and moves the cursor there in the same frame —
  // which made it a price on a cost the simulation never charged. The cpu
  // walks now (panel-cpu.js, beginWalk), so the frames this counts are
  // frames the game actually takes: at the cadence the cpu plays, one step
  // is 1 frame and four is 13.
  //
  // A swap worth slightly less but one cell away can therefore be worth far
  // more than the better one across the board, and no version of this bot
  // could express that before.
  //
  // The number is supplied by whichever seam knows which move produced the
  // candidate. A seam that cannot see the move passes nothing and this
  // reads 0 — better than inventing a cost, which would price every
  // candidate identically and quietly re-introduce teleporting.
  // MEASURED IN CURSOR STEPS, NOT FRAMES, AND THAT IS THE WHOLE POINT.
  //
  // Every other feature here is a COUNT of something — panels, links, rows,
  // colours — and lands between 0 and about 3 across the candidates of a
  // decision. This one returned FRAMES. Measured spread within a decision:
  //
  //     travelCost   21.12        links             2.82
  //     roughness     2.21        colourVariance    1.68
  //     everything else below 1.1
  //
  // Seven times the next-biggest, so at any weight that matters it does not
  // contribute to a decision, it IS the decision. Both consequences were
  // visible: the GA settled it at exactly 0, the only value that does not
  // wreck the bot, and a champion trained while this feature was
  // accidentally dead collapsed from 1123 frames to 429 the instant it went
  // live at weight 173 — it had decided moving was never worth it.
  //
  // Neither of those means travel does not matter. It matters a great deal:
  // this bot walks its cursor and pays real frames for distance. They mean
  // a unit mismatch left the search no way to say "care a little".
  //
  // Steps put it in the same range as everything else — a 4-step move reads
  // 4, not 13 — so a weight of 50 here means what a weight of 50 means
  // anywhere else. No information is lost: travel.js's frame cost is
  // monotonic in steps, and the CADENCE belongs in the simulation that
  // charges for it, not counted twice in the feature and again in the
  // weight.
  function travelCost(input) {
    var frames = input.travelFrames || 0;
    if (frames <= 0) return 0;
    // Inverse of travel.js's g * (steps - 1) + 1.
    return 1 + (frames - 1) / MOVE_FRAMES;
  }

  // -------------------------------------------------------- framesToDeath
  //
  // HOW MANY FRAMES THIS BOARD HAS LEFT.
  //
  // ONE feature, where the obvious design is three. Stop time, health and
  // shake do not sit beside each other as resources to bank — they PAUSE
  // each other, and the engine says so in three places:
  //
  //   - advancePassiveRaise decrements health only inside
  //     (!riseLock && stopTime === 0), so stop time and riseLock both
  //     freeze the clock rather than adding to a separate pool.
  //   - checkGameOver needs health <= 0 AND shakeTime <= 0, so shake is
  //     death protection: more frames, not a different currency.
  //   - decrementTimers drains preStopTime first and only then stopTime,
  //     so the real stop clock is their sum.
  //
  // As three additive features the search would double-count every one of
  // those interactions. As one, "how long have I got" is a single number
  // the weight can be honest about.
  //
  // AND STOP TIME DOES NOT BANK. awardStopTime ends
  // `if (stopTime > this.stopTime) this.stopTime = stopTime` — a MAX, not
  // a +=. A 4-chain paying 90 frames while 120 are still on the clock earns
  // NOTHING. That is why "stop time earned" is not a feature here: scored
  // separately from "stop time banked", the two would sum, and the search
  // would learn that chaining during stop pays when it is exactly the
  // moment it does not. This feature reads the resulting clock, so the max
  // is already applied by the engine and cannot be double-counted.
  //
  // IT SATURATES. IT DOES NOT RETURN INFINITY.
  //
  // Infinity was the first answer, and the reasoning was that a sentinel is
  // a number the weight multiplies while Infinity is the honest answer to
  // "how long until this kills me" on a board that cannot die. The honesty
  // is real and the consequence is fatal: a weighted SUM containing
  // Infinity is Infinity, so every candidate scores Infinity, every
  // candidate TIES, and every other feature on the board is annihilated the
  // moment this one carries any weight at all.
  //
  // Measured, not reasoned: with framesToDeath at 1 and maxHeight at 50, a
  // board holding one panel and a board filled to the ceiling both scored
  // Infinity. The search was choosing between candidates it could not tell
  // apart. That is worse than the feature not existing.
  //
  // So a safe board returns SAFE_FRAMES — a cap, not a sentinel. The cap is
  // the point: past about ten seconds of cushion, more cushion is not
  // better in any way the search should trade board quality for. A board
  // with an enormous stop-time bank and a board that is simply fine are
  // both, correctly, "fine". Anything genuinely dying scores below it and
  // the ordering near death — the only place this feature has to be right —
  // is untouched.
  var SAFE_FRAMES = 600;   // 10s at 60fps

  function framesToDeath(input) {
    var clock = input.clock;
    if (!clock.toppedOut) return SAFE_FRAMES;
    if (clock.riseLock) return SAFE_FRAMES;
    var left = (clock.preStopTime || 0) + (clock.stopTime || 0) +
               (clock.shakeTime || 0) + (clock.health || 0);
    return Math.min(left, SAFE_FRAMES);
  }

  // ---------------------------------------------------------- latentChain
  //
  // WILL THIS LANDING CONTINUE THE CHAIN.
  //
  // Counts cells that carry the chain flag AND sit inside a match on the
  // settled board. The forward-looking half of chainLength: that one says
  // what a chain ended up worth, this one says whether the next link is
  // already on its way.
  //
  // The flags are what make it decidable. A panel gets `chaining` by
  // falling because of an earlier clear (enterHoverFromNormal), and a
  // hovering panel can never START a chain (Panel.matchAnyway). So a match
  // built only of freshly-fallen but unflagged panels is a NEW COMBO, not a
  // link — and nothing counting cells or colours can tell those two apart.
  // Without the flags this feature would inflate every ordinary match into
  // a chain, which is the most expensive way to be wrong here: chains are
  // where all the garbage comes from, so overstating them mis-prices every
  // move on the board.
  //
  // chainMarks null means NOT MID-CASCADE and returns 0, which is a
  // different fact from {} — mid-cascade with nothing landing chaining —
  // even though both score zero. input.js keeps them distinct on purpose;
  // collapsing them is how a feature starts reporting on boards it knows
  // nothing about.
  //
  // Cells rather than a boolean: two flagged cells landing in the same
  // match is a more certain link than one, and a weight can decide what
  // that is worth.
  function latentChain(input) {
    var marks = input.chainMarks;
    if (!marks) return 0;
    var matched = matchedCells(input.board);
    var n = 0;
    for (var key in marks) {
      if (marks.hasOwnProperty(key) && marks[key] && matched[key]) n++;
    }
    return n;
  }

  // ------------------------------------------------------- garbageCleared
  //
  // GARBAGE CELLS THIS MOVE CONVERTED, PROPAGATION INCLUDED.
  //
  // Comes from the resolved candidate rather than being recomputed here:
  // one match clears every connected garbage block it touches AND every
  // block those touch in turn (getConnectedGarbagePanels), so the number
  // depends on the resolve, not on the settled grid this feature can see.
  // Recomputing it from the board would be a second, worse implementation
  // of a rule the engine already applied.
  function garbageCleared(input) {
    return input.earned.garbageCleared || 0;
  }

  return {
    SAFE_FRAMES: SAFE_FRAMES,
    matchPotential: matchPotential,
    chainPotential: chainPotential,
    travelCost: travelCost,
    _matchedCellsNear: matchedCellsNear,
    latentChain: latentChain,
    garbageCleared: garbageCleared,
    framesToDeath: framesToDeath,
    garbageSent: garbageSent,
    chainLength: chainLength,
    garbageOnBoard: garbageOnBoard,
    incomingGarbage: incomingGarbage,
    garbageAdjacency: garbageAdjacency,
    colourScarcity: colourScarcity,
    edgePenalty: edgePenalty,
    maxHeight: maxHeight,
    fillRatio: fillRatio,
    roughness: roughness,
    colourVariance: colourVariance,
    links: links,
    // exported for tests only — not features
    _matchedCells: matchedCells
  };
}));
