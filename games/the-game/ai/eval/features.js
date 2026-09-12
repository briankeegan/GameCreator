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
  // LIMIT 1 IS GONE, AND IT WAS THE EXPENSIVE ONE. This used to skip every
  // swap where one side was empty, on the reasoning that judging it needs
  // gravity and gravity "is not a pure function of this snapshot". That was
  // true of the snapshot and false of the situation: LogicalBoard.resolve()
  // IS the gravity the bot plans with, and input.js already carries a real
  // board through as `liveBoard` for exactly this — chainPotential and
  // comboPotential have used it all along.
  //
  // Sliding a panel over a hole is not a corner case, it is most of the
  // game. Measured on Panel Attack's own 144 readable authored puzzle
  // boards: 55% of the swaps that clear anything need an empty cell, 65% of
  // the swaps that fire a chain do, and 36 of the 144 boards have their best
  // chain reachable ONLY that way. The old version scored 27 where this one
  // scores 91, and returned 0 on 33 boards that had a real answer.
  //
  // It is the same defect the chip verifier had, in the other direction:
  // there, staging read "unmentioned" as air when it was ground; here,
  // scoring read a swap as finished when the panels had not landed yet.
  // Both are "the board was judged before it stopped moving".
  //
  // THE ONE REMAINING LIMIT: it does not look past one swap. Nothing about
  // setup two moves out. Asserted in the tests so it stays visible.
  //
  // The "did the swap cause it" test is gone too, and did not need
  // replacing: the board being scored is SETTLED, so it has no standing
  // matches, and anything resolve() clears afterwards was caused by the
  // swap by construction.
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

  // How many garbage cells are sitting on a board. Used to decide whether a
  // swap CLEARED garbage, which is the thing "a plain 3 that touches
  // garbage" was always a proxy for — with gravity in play the proxy is no
  // longer needed, because the clear either happens or it does not.
  // ONE RESOLVE PASS, SHARED BY EVERY FEATURE THAT ASKS "WHAT IF I SWAPPED?"
  //
  // matchPotential, comboPotential, chainPotential and clearableByOneSwap all
  // ask the same question of the same board — clone it, make each legal swap,
  // let it settle — and each used to run that loop itself. Four identical
  // passes. Profiled on Panel Attack's own 144 readable authored puzzle
  // boards (profile_features.js), those four were 94% of all feature cost.
  //
  // THIS IS NOT AN APPROXIMATION. It is the same clone, the same swap and the
  // same resolve(); the only change is that the answer is computed once and
  // read four times, so every feature returns bit-for-bit what it returned
  // when it ran its own loop. That equality is asserted on all 144 real
  // boards in features.shared.test.js rather than argued here — a "faster
  // version that computes the same thing" is exactly the claim that needs a
  // test, because when it is wrong nothing looks wrong.
  //
  // CACHED PER BOARD, AND THE CACHE CANNOT GO STALE SILENTLY. Keyed on the
  // board object, which is a fresh clone per candidate, so a WeakMap would
  // almost always be right — and "almost always" is how this directory
  // produces bugs nobody can see. Every hit re-checks a fingerprint of the
  // grid it was computed from, so a board mutated between two features
  // recomputes instead of answering from a stale pass. The fingerprint is
  // one walk of 72 cells against a pass that clones and resolves ~30 times.
  var outcomeCache = (typeof WeakMap === 'function') ? new WeakMap() : null;

  function fingerprint(board) {
    var grid = board.grid, h = board.height, w = board.width, s = h + 'x' + w;
    for (var r = 1; r <= h; r++) {
      for (var c = 1; c <= w; c++) s += ',' + grid[r][c];
    }
    return s;
  }

  // A real board, or null. The four features below all take the same shape of
  // input and all owe the same answer when there is no board to plan on.
  function planBoard(input) {
    var board = input.liveBoard || input.board;
    if (!board || typeof board.legalSwaps !== 'function' ||
        typeof board.clone !== 'function' || typeof board.resolve !== 'function') return null;
    return board;
  }

  function swapOutcomes(board) {
    var fp = fingerprint(board);
    if (outcomeCache) {
      var hit = outcomeCache.get(board);
      if (hit && hit.fp === fp) return hit.out;
    }
    var before = garbageCells(board);
    var swaps = board.legalSwaps(), out = [];
    for (var i = 0; i < swaps.length; i++) {
      var trial = board.clone();
      trial.swap(swaps[i][0], swaps[i][1]);
      var res = trial.resolve();
      var sizes = res.comboSizes || [];
      var biggest = 0;
      for (var k = 0; k < sizes.length; k++) if (sizes[k] > biggest) biggest = sizes[k];
      out.push({
        cleared: sizes.length > 0,
        biggest: biggest,
        chainLength: res.chainLength,
        ateGarbage: garbageCells(trial) < before,
        grid: trial.grid
      });
    }
    if (outcomeCache) outcomeCache.set(board, { fp: fp, out: out });
    return out;
  }

  function garbageCells(board) {
    var grid = board.grid, n = 0;
    for (var r = 1; r <= board.height; r++)
      for (var c = 1; c <= board.width; c++) if (grid[r][c] === -2) n++;
    return n;
  }

  function matchPotential(input) {
    // liveBoard, not board: this needs the clone/swap/resolve that input.js
    // flattens away, exactly as chainPotential and comboPotential do. A
    // caller with no real board gets 0 rather than a number derived from a
    // second, private implementation of gravity.
    var board = planBoard(input);
    if (!board) return 0;
    var out = swapOutcomes(board), count = 0;
    for (var i = 0; i < out.length; i++) {
      var o = out[i];
      if (!o.cleared) continue;
      // Worth a count if it PAYS: a merged clear of 4+ (comboGarbage sends
      // nothing below 4), or a clear that cascades, or one that eats
      // garbage. A lone plain 3 that does none of those still scores 0,
      // which is the whole point of the feature.
      if (o.biggest >= 4 || o.chainLength >= 2 || o.ateGarbage) count++;
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
    var out = swapOutcomes(board), best = 0;
    for (var i = 0; i < out.length; i++) if (out[i].chainLength > best) best = out[i].chainLength;
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

  // --------------------------------------------------------- scoreEarned
  //
  // WHAT THIS MOVE EARNED, IN THE POINTS THE SEARCH IS JUDGED ON.
  //
  // Every other earned feature measures a proxy. garbageSent counts cells,
  // chainLength counts links, and the run's fitness is `score` — so the bot
  // was being graded in a currency it could not see. The proxies do not
  // even rank the same way: against a 4-combo, a 5-chain is 8x in garbage
  // cells and 15x in points.
  //
  // The tables are NOT restated here. PanelEngine.moveScore owns them, and
  // owns the chain-counter quirk that makes the first link of a cascade
  // earn only its combo bonus (Stack:incrementChainCounter goes 0 -> 2,
  // never 1). A bare 3 is worth 0, which is the fact this feature exists to
  // put in front of the search: 54 of the shipped bot's 67 matches across
  // three games earned nothing at all.
  function scoreEarned(input) {
    var engine = (typeof window !== 'undefined' ? window : globalThis).PanelEngine;
    if (!engine || !engine.moveScore) return 0;
    return engine.moveScore(input.earned.comboSizes);
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


  // ------------------------------------------------------- comboPotential
  //
  // THE BIGGEST SINGLE CLEAR ANY LEGAL SWAP COULD MAKE FROM THIS BOARD.
  //
  // The other half of stored potential. A board pays out two different ways
  // and they are separate attacks: a CHAIN is links deep and sends one
  // full-width block that grows a row per link; a COMBO is one clear wide
  // and sends a set of 1-high blocks. chainPotential measures the first —
  // the deepest cascade a swap could set off. Nothing measured the second,
  // and matchPotential says why in its own comment: it counts HOW MANY
  // swaps pay out, deliberately not how big, and records that if size
  // matters it belongs in its own feature "measured on its own, not
  // smuggled in here". This is that feature.
  //
  // So a board one swap from a five-panel clear and a board one swap from a
  // bare three both score 1 on matchPotential and 0 on chainPotential, and
  // are worth very different amounts: the engine ports Panel Attack's real
  // Tsu-Attack tables, where combo payout climbs with size and a plain 3
  // sends nothing at all.
  //
  // ASKED OF THE ENGINE, NOT RECOMPUTED. Same shape as chainPotential:
  // clone, swap, let the engine resolve, read the combo sizes it reports.
  // The alternative is a second implementation of gravity and matching
  // inside features.js, which is how two copies of the rules drift apart —
  // and the engine's counter is the one the game actually scores with.
  //
  // The MAX, not the sum. The payout table is per-clear, so one clear of
  // seven is worth more than two of three, and summing would rank a board
  // full of small clears above the one big one that actually pays.
  //
  // Cost: a clone+resolve per legal swap, the same loop chainPotential
  // runs, so having both roughly doubles the most expensive feature here
  // (~66us). Measured worst decision was 8ms against an 85ms guard before
  // this, so there is room; if that stops being true the fix is to resolve
  // each candidate ONCE and let both features read the result, not to make
  // either of them guess more cheaply.
  function comboPotential(input) {
    var board = planBoard(input);
    if (!board) return 0;
    var out = swapOutcomes(board), best = 0;
    for (var i = 0; i < out.length; i++) if (out[i].biggest > best) best = out[i].biggest;
    return best;
  }

  // -------------------------------------------------------------- staircase
  //
  // THE LONGEST DIAGONAL RUN OF LOADED STEPS — the depth of the deepest
  // staircase built on this board.
  //
  // THE SHAPE IS DOCUMENTED, NOT INVENTED, and that is the whole point of
  // it. PUYO_REFERENCE.md's Tier 2 section says the competitive Puyo bot
  // "does not discover chain shapes, it is told them" — humans worked the
  // shapes out over decades and the bot matches against that library. Panel
  // de Pon has its own, and this is the one every guide teaches:
  //
  //   "a diagonal arrangement of matching panels, offset by one column and
  //    one row at each step, so that clearing the lowest match causes
  //    falling panels to complete the next match, which in turn feeds the
  //    one above it"  — paneponattack.com, "How to Set Up a Staircase"
  //
  // THE FIRST VERSION COUNTED LOOSE STEPS AND THE SEARCH REJECTED IT: it
  // settled at 13 out of 300, the treatment reserved here for a feature that
  // does nothing. It was not mis-wired — a board carrying steps held a
  // firable chain 40.4% of the time against 6.6% for a board with none, a
  // sixfold lift over 1,246 real level-10 boards. It was measuring the wrong
  // thing in two ways, both of which that same measurement shows:
  //
  //   1. It was a WORSE COPY OF chainPotential. Loose loaded steps predict
  //      "there is a chain here", and chainPotential answers that question
  //      exactly rather than by proxy — which is why it carries 185 and this
  //      carried 13. A feature earns its dimension by seeing something no
  //      other feature can.
  //   2. It counted steps that had nothing to do with each other. Three
  //      loaded panels in three unrelated corners scored 3, the same as
  //      three that feed each other. The by-step-count numbers say so
  //      outright and are not monotonic anywhere: 1 step 46.8%, 2 steps
  //      11.1%, 3 steps 0.0%, 4 steps 72.7%. A staircase is not a quantity
  //      of steps, it is steps ARRANGED — "offset by one column and one row
  //      at each step" is the whole definition and the first version did not
  //      implement it.
  //
  // So this measures the diagonal run: how many loaded steps chain into each
  // other, one column across and one row up, which is how deep the cascade
  // goes when the bottom one is triggered. That is a number chainPotential
  // cannot produce — chainPotential needs a trigger swap to exist RIGHT NOW,
  // and a half-built staircase with no trigger yet reads 0 there while
  // reading its true depth here. Depth rather than count, because the score
  // table is what makes building worth anything: a 4-combo pays 20 and a
  // 5-chain pays 300, so two shallow staircases are worth a fraction of one
  // deep one and must not score the same.
  //
  // WHAT COUNTS AS A STEP. A settled board has no floating panels, so the
  // gap the guide describes ("a pair of colour B with a gap directly beneath
  // it") exists only after the trigger clears. The invariant that survives
  // on a settled board is that same shape read one row down: a panel that
  // WOULD complete a horizontal three in the row beneath it if the cell
  // under it cleared and it fell. Clear underneath, it drops, the match
  // completes, the chain takes its next link.
  //
  // Horizontal only. A fall cannot complete a VERTICAL three, because the
  // whole column drops together and keeps its spacing — the panels that
  // would have to close up never move relative to each other.
  //
  // The cell below a step must be occupied by a DIFFERENT colour: if it
  // already matched, the board would have resolved it, and a shape that has
  // already fired is not stored potential.
  // CAN ONE SWAP CLEAR THIS EXACT CELL?
  //
  // The staircase's base, in other words. Tries every legal horizontal swap
  // and asks whether the match it causes CONTAINS the target — not whether a
  // match happens somewhere, which is what matchPotential answers and is a
  // different question: a 4-combo across the board does nothing for a
  // staircase whose base is still sitting there.
  //
  // Restores the grid it borrows. A swap left in place would corrupt every
  // feature computed after this one, silently, on the same input object.
  // SAME CORRECTION AS matchPotential, and for the same reason: this used to
  // consider only colour-to-colour swaps and read the match off instantly,
  // so a base cleared by sliding a panel over a hole did not count and the
  // staircase above it scored 0. That is 65% of the chain-firing swaps on
  // the real puzzle set. Resolves on a clone instead, which is the gravity
  // the bot plans with.
  //
  // Needs a real board; a plain snapshot gets `false`, which leaves
  // staircaseReady reading 0 rather than inventing a trigger.
  function clearableByOneSwap(board, row, col) {
    if (!board || typeof board.legalSwaps !== 'function' ||
        typeof board.clone !== 'function' || typeof board.resolve !== 'function') return false;
    if (row < 1 || row > board.height || board.grid[row][col] <= 0) return false;
    var out = swapOutcomes(board);
    for (var i = 0; i < out.length; i++) {
      if (!out[i].cleared) continue;
      // The cell is cleared if nothing of its colour is left standing there
      // once the board stops moving. Compared against the ORIGINAL colour,
      // since a cascade may drop a different panel into the same cell.
      if (out[i].grid[row][col] !== board.grid[row][col]) return true;
    }
    return false;
  }

  // ----------------------------------------------------- staircaseReady
  //
  // A STAIRCASE YOU CAN FIRE, WHICH IS NOT THE SAME THING AS A STAIRCASE.
  //
  // docs/CHAIN_SHAPES.md, from the game's own documented library: the shape
  // is a diagonal of B-pairs each with a gap beneath, and it goes off when
  // an A MATCH AT THE BASE clears and lets the lowest B fall. Without that
  // trigger the diagonal is a stack of loaded pairs with no way to set them
  // off — worth nothing until one appears.
  //
  // `staircase` counts the diagonal and never looks for the trigger, so a
  // shape that fires and a shape that cannot score identically. That is a
  // candidate explanation for it measuring NO EFFECT over four runs: half of
  // what it was rewarding was inert.
  //
  // This counts the longest run whose base can be cleared BY ONE SWAP, which
  // is the definition of ready. Returns the run length, so a 3-step ready
  // staircase reads 3 and an unfireable 5-step one reads 0.
  function staircaseReady(input) {
    return staircaseRuns(input, true);
  }

  function staircase(input) {
    return staircaseRuns(input, false);
  }

  // The shared walk. `requireTrigger` is the only difference between the two
  // features above, and it is deliberately ONE function so they can never
  // drift into measuring different diagonals.
  function staircaseRuns(input, requireTrigger) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    // The shape is read off the snapshot; the TRIGGER needs real gravity,
    // so it is asked of liveBoard when there is one.
    var live = input.liveBoard || (typeof board.resolve === 'function' ? board : null);

    function pair(row, a, b, v) {
      return a >= 1 && b >= 1 && a <= W && b <= W && grid[row][a] === v && grid[row][b] === v;
    }

    var step = {}, any = false, r, c;
    for (r = 2; r <= H; r++) {
      for (c = 1; c <= W; c++) {
        var v = grid[r][c];
        if (v <= 0) continue;                 // empty, busy (-1) and garbage (-2) are not colours
        var under = grid[r - 1][c];
        if (under === 0 || under === v) continue;  // nothing to clear, or already a match
        // The three ways the falling panel becomes the third of a row: it
        // lands to the right of a pair, between two, or to the left of a pair.
        if (pair(r - 1, c - 2, c - 1, v) ||
            pair(r - 1, c - 1, c + 1, v) ||
            pair(r - 1, c + 1, c + 2, v)) { step[r + ':' + c] = true; any = true; }
      }
    }
    if (!any) return 0;

    // The longest run of steps each offset one column and one row from the
    // last. A run keeps its direction: a staircase climbs one way, and a
    // shape that zigzags is two staircases meeting, not one deeper one.
    var best = 0;
    for (r = 2; r <= H; r++) {
      for (c = 1; c <= W; c++) {
        if (!step[r + ':' + c]) continue;
        for (var d = -1; d <= 1; d += 2) {
          // Only start a run where one cannot already be running, or the
          // same staircase is measured once per step it contains.
          if (step[(r - 1) + ':' + (c - d)]) continue;
          var len = 1, rr = r, cc = c;
          while (step[(rr + 1) + ':' + (cc + d)]) { len++; rr++; cc += d; }
          // THE BASE IS WHAT MAKES IT A CHAIN. The lowest step fires when
          // the cell UNDER it clears, so a run is ready only if some legal
          // swap produces a match containing that cell. Checked once per
          // maximal run, not once per step, because the scan above already
          // refuses to start a run inside another one.
          if (requireTrigger && !clearableByOneSwap(live, r - 1, c)) continue;
          if (len > best) best = len;
        }
      }
    }
    return best;
  }

  // --------------------------------------------------------------- flatTop
  //
  // THE DOCUMENTED WAY TO DIE: FLAT, AND HIGH UP.
  //
  // The same library names this one as a mistake rather than a shape to
  // build: "the overloaded flat-top is the shape that gets intermediate
  // players killed — it looks productive and quietly walks you into the top
  // line", against which "the flat board is where you live between setups,
  // not a chaining plan" (paneponattack.com). Flat near the floor is normal;
  // flat near the ceiling is the death shape.
  //
  // WHY IT HAS TO BE ITS OWN FEATURE. Flat is good and low is good, and this
  // evaluator already pays for both separately — roughness for flat,
  // maxHeight and fillRatio for low. What kills you is the CONJUNCTION, and
  // a weighted sum cannot express one: it can add "how flat" to "how high",
  // never multiply them. That is the limit that removed incomingGarbage (see
  // registry.js), met from the other side — there the interaction could not
  // be expressed, so the feature went; here the interaction is put INSIDE
  // the feature, which is the only place a linear scorer can hold one.
  //
  // AND IT IS THE SHAPE OUR OWN BOT BUILDS. Its swaps optimise roughness,
  // colour clustering and stack height, which is a description of the
  // overloaded flat-top. Measured over 12 level-10 games: the chain
  // structure sitting in the random opening board (mean best chain 2.34,
  // a real chain available in 61% of decisions) was gone by the first third
  // of the game (0.68, 12%) and never came back. The bot is not failing to
  // build — it is flattening away structure it starts with.
  function flatTop(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var heights = [], c, r, tallest = 0;
    for (c = 1; c <= W; c++) {
      heights[c] = 0;
      for (r = H; r >= 1; r--) if (grid[r][c] !== 0) { heights[c] = r; break; }
      if (heights[c] > tallest) tallest = heights[c];
    }
    if (!tallest) return 0;
    // Within one row counts as level: a single-panel step is the texture of
    // ordinary play, not a flat top, and demanding exact equality would make
    // the feature fire almost nowhere.
    var level = 0;
    for (c = 1; c <= W; c++) if (tallest - heights[c] <= 1) level++;
    return level * (tallest / H);
  }

  return {
    SAFE_FRAMES: SAFE_FRAMES,
    matchPotential: matchPotential,
    chainPotential: chainPotential,
    comboPotential: comboPotential,
    staircase: staircase,
    staircaseReady: staircaseReady,
    flatTop: flatTop,
    travelCost: travelCost,
    _matchedCellsNear: matchedCellsNear,
    latentChain: latentChain,
    garbageCleared: garbageCleared,
    framesToDeath: framesToDeath,
    scoreEarned: scoreEarned,
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
