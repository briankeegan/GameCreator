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
//   - Returns a finite number.
//
// Features are added ONE AT A TIME, each with the test that proves it
// measures what registry.js says it measures — in BOTH directions. See
// README.md for the four steps.
// The cursor tap cadence travel.js prices with, in frames per step. It used
// to cite panel-cpu.js's CURSOR_MOVE_FRAMES as its source; that constant no
// longer exists, so the citation was pointing at nothing. Kept at 4 because
// travel.js's own measurements are calibrated to it (2 steps = 21 frames,
// 4 = 23) — and it is a hand-set number with no engine fact behind it any
// more, which is why it is said here rather than implied.
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

  // Legal swaps whose clear is 4+ wide, cascades (2+ links), or eats garbage. A plain 3 that does none of those counts 0.
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

  // Legal swaps whose clear is 4+ wide, cascades (2+ links), or eats garbage.
  // A plain 3 that does none of those counts 0.

  // Deepest cascade any single legal swap could set off from this board.

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

  // Same-colour orthogonal adjacencies. Counted right and up only, so each pair counts once.
  // Same colour either side of an EMPTY cell along a row: `X . X`. One panel
  // short of a three, where the missing panel arrives by FALLING — which is
  // the chain mechanic in this game. Something clears below, a panel drops
  // into the gap, the three completes, that clears, and the next drops.
  //
  // The other half of "one short" is the ADJACENT pair, and `links` already
  // counts that. Between them they cover both ways a three can be one panel
  // away, which is what meatfighter's links + consecutive colours cover in a
  // game that pops four touching blobs instead of three in a line.
  //
  // HORIZONTAL ONLY. A vertical `X . X` cannot survive gravity — the upper
  // panel falls into the gap — and the evaluator scores settled boards, so a
  // vertical arm would be a branch that never fires.
  //
  // The gap must be EMPTY. A different colour sitting in it is not one panel
  // away (it has to leave first), and garbage or a busy cell cannot be filled
  // by something falling.
  // For every horizontal swap the cursor could make, HOW MANY PANELS WOULD
  // POP — summed over the board. Not "is there a three": three is the
  // minimum, not the prize. A match is the union of every run of 3 or more
  // through the swapped cell, across its row AND its column, so an L or a T
  // pops five at once, and it is that count that feeds comboGarbage and the
  // combo score. A swap worth 5 is worth more than a swap worth 3 and this
  // says so.
  //
  // No clone and no resolve: a swap at (r,c) can only change row r and the
  // two columns it touches, so walking the runs through each swapped cell
  // answers it. The grid is swapped in place and put straight back. This is
  // the immediate pop only — nothing falls, nothing cascades, and garbage
  // dragged in by the match is left to garbageAdjacency.
  //
  // Refuses what the engine refuses: garbage and busy panels cannot be
  // swapped, and a panel swapped over a hole falls out of the row before it
  // can match. Runs are only counted through a swapped cell, so a match
  // already sitting on the board is not read as potential.
  function popThrough(grid, W, H, r, c, seen) {
    var v = grid[r][c], n, k, lo, hi, added = 0;
    if (v <= 0) return 0;
    for (lo = c; lo > 1 && grid[r][lo - 1] === v; lo--) ;
    for (hi = c; hi < W && grid[r][hi + 1] === v; hi++) ;
    if (hi - lo + 1 >= 3) {
      for (k = lo; k <= hi; k++) { if (!seen[r * 100 + k]) { seen[r * 100 + k] = 1; added++; } }
    }
    for (lo = r; lo > 1 && grid[lo - 1][c] === v; lo--) ;
    for (hi = r; hi < H && grid[hi + 1][c] === v; hi++) ;
    if (hi - lo + 1 >= 3) {
      for (k = lo; k <= hi; k++) { if (!seen[k * 100 + c]) { seen[k * 100 + c] = 1; added++; } }
    }
    return added;
  }



  // links split by direction, and the two halves add up to links exactly.
  //
  // They are separate features because the two are not the same move here.
  // The cursor swaps SIDEWAYS only, so a horizontal pair is finished by
  // bringing the third panel in yourself. A vertical pair is finished by a
  // panel FALLING in, which needs something under it to clear first — a
  // cascade, not a decision. One is a trigger, the other is fuel.
  //
  // Concretely: a broken garbage row takes its colours from garbageRowColors,
  // which refuses to repeat left to right, so a freshly converted row can
  // never hold a horizontal pair. All of its value is vertical.
  function linksH(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var count = 0;
    for (var r = 1; r <= H; r++) {
      for (var c = 1; c < W; c++) {
        var v = grid[r][c];
        if (v <= 0) continue;
        if (grid[r][c + 1] === v) count++;
      }
    }
    return count;
  }

  function linksV(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var count = 0;
    for (var r = 1; r < H; r++) {
      for (var c = 1; c <= W; c++) {
        var v = grid[r][c];
        if (v <= 0) continue;
        if (grid[r + 1][c] === v) count++;
      }
    }
    return count;
  }

  // ------------------------------------------------------------ chainLayers
  //
  // HOW MANY DIFFERENT HEIGHTS THE LINKS SIT AT.
  //
  // linksV calls stacked pairs "cascade fuel", and it is right, but it
  // cannot tell six pairs stacked in one place from six pairs spread up the
  // board. The first is one combo. The second is the shape a long chain is
  // made of: a clear at the bottom drops panels into the pair above it,
  // which clears and drops into the pair above that.
  //
  // So this counts the DISTINCT ROWS holding at least one same-coloured
  // adjacent pair. Rows rather than pairs, because a second pair on a row
  // already counted adds nothing a cascade can use -- it fires with the
  // first one, not after it.
  //
  // Both orientations count. A horizontal pair one row up is as much a
  // landing place for a falling panel as a vertical one.
  function chainLayers(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var rows = 0, r, c, v;
    for (r = 1; r <= H; r++) {
      var has = false;
      for (c = 1; c <= W && !has; c++) {
        v = grid[r][c];
        if (v <= 0) continue;
        if (c < W && grid[r][c + 1] === v) has = true;
        else if (r < H && grid[r + 1][c] === v) has = true;
      }
      if (has) rows++;
    }
    return rows;
  }

  // Per colour: the mean Manhattan distance of its panels from their centroid, summed over colours. Colours with one panel are skipped.
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

  // Panels in column 1 and column W. Side columns have three orthogonal neighbours instead of four.
  function edgePenalty(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var n = 0;
    for (var r = 1; r <= H; r++) {
      if (grid[r][1] > 0) n++;
      if (W > 1 && grid[r][W] > 0) n++;
    }
    return n;
  }

  // Topmost occupied row, plus displacement/16 for the sub-row rise offset.
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

  // PANELS THERE ARE TO WORK WITH, over total cells.
  //
  // Colour cells only. Garbage (-2) is not material -- it cannot be matched
  // and only leaves when something beside it clears -- and neither is the
  // dimmed incoming row (-1), which is not playable until it rises.
  //
  // SEPARATE FROM maxHeight ON PURPOSE. How much stock is on the board and
  // how close the stack is to the ceiling are different questions with
  // opposite answers, and a single occupancy term has to answer both with
  // one weight. Split, the weights can want a deep stack with room above it;
  // conflated, they cannot say it at any value.
  function material(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    if (!W || !H) return 0;
    var used = 0;
    for (var r = 1; r <= H; r++) {
      for (var c = 1; c <= W; c++) if (grid[r][c] > 0) used++;
    }
    return used / (W * H);
  }

  // Sum of absolute height differences between adjacent columns.

  // Garbage cells, counted flat — every cell is worth 1 wherever it sits. The board here is the VISIBLE 12 rows, so garbage above the ceiling is not in this number and cannot be.
  function garbageOnBoard(input) {
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    var n = 0;
    for (var r = 1; r <= H; r++) {
      for (var c = 1; c <= W; c++) if (grid[r][c] === -2) n++;
    }
    return n;
  }

  // ------------------------------------------------------------- reach*
  //
  // What the board a move LEAVES could fire next move, one feature per size.
  // The number is put on the input by the search, which has already resolved
  // every swap from that board to find its best follow-up — see PuyoCpu's
  // _value. A caller that has not done that (a hand-built test input) gets 0,
  // which is the honest answer rather than a second, private implementation
  // of gravity and matching.
  function reachOf(input, key) {
    return (input.reach && input.reach[key]) ? 1 : 0;
  }

  // ------------------------------------------------ pressure / overkill
  //
  // THE OTHER BOARD, IN THE ONLY FORM THAT CAN CHANGE A DECISION.
  //
  // The bot scores every legal move and takes the highest, so a number
  // identical across every candidate shifts all the scores equally and
  // cancels out of the ranking. "Their headroom is four rows" is exactly
  // that shape, and a feature of that shape does nothing whatever its
  // weight — incomingGarbage was written that way, varied in 0 of 179
  // decisions, and was removed for it.
  //
  // So the opponent arrives as something the MOVE interacts with. These two
  // are ratios of this move's send against their room, and they vary
  // candidate to candidate because the send does.
  //
  // NEITHER IS A RULE. Nothing here says what to do when they are low. The
  // information is handed over and the weights decide, the same way they do
  // with the board.

  function sentCells(input) {
    var pieces = (input.earned && input.earned.garbageSent) || [], cells = 0;
    for (var i = 0; i < pieces.length; i++) {
      cells += (pieces[i][0] || 0) * (pieces[i][1] || 0);
    }
    return cells;
  }

  // Room they have left, counting what is already flying at them as spent.
  function roomLeft(input) {
    var o = input.opponent;
    if (!o) return 0;
    var room = (o.headroomCells || 0) - (o.incomingCells || 0);
    return room > 0 ? room : 0;
  }

  // How much of the way to finishing them this move goes. 1 is a kill.
  function pressure(input) {
    var room = roomLeft(input);
    if (!room) return input.opponent ? 1 : 0;
    return sentCells(input) / room;
  }

  // The part of the send past what would finish them. Not merely wasted:
  // garbage on a board is MATERIAL, and a clear beside it turns it into
  // panels that can cascade, so over-sending hands them a counter-chain.
  // Whether that is worth minding is for the weight to decide.
  function overkill(input) {
    if (!input.opponent) return 0;
    var over = sentCells(input) - roomLeft(input);
    return over > 0 ? over : 0;
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

  // Matchable panels 4-way adjacent to a garbage cell. No eligibility test: every garbage panel reads -2 whatever its state.
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

  // Colours with one or two panels left — a colour that can no longer form a match.

  // The game's own points for this cascade, via PanelEngine.moveScore. Returns 0 if the engine is not loaded.

  // Total cells sent: width x height summed over the pieces this move sent.

  // Chain counter after the move.
  function chainLength(input) {
    return input.earned.chainLength || 0;
  }

  // Frames to walk the cursor there, converted to steps: 1 + (frames - 1) / 4.
  function travelCost(input) {
    var frames = input.travelFrames || 0;
    if (frames <= 0) return 0;
    // Inverse of travel.js's g * (steps - 1) + 1.
    return 1 + (frames - 1) / MOVE_FRAMES;
  }

  // Stop time this move actually buys: earned minus the clock already running, floored at 0, and 0 unless the board could die. awardStopTime takes a MAX, not a sum.
  var DANGER_ROWS = 1;

  function couldDie(input) {
    // The flag the engine itself acts on wins outright: a candidate board
    // that settles lower is still a board whose stack is topped out now.
    if (input.clock.toppedOut) return true;
    var board = input.board, grid = board.grid, W = board.width, H = board.height;
    for (var r = H; r >= H - DANGER_ROWS && r >= 1; r--) {
      if (!grid[r]) continue;
      for (var c = 1; c <= W; c++) if (grid[r][c] !== 0) return true;
    }
    return false;
  }

  // Stop time this move actually buys: earned minus the clock already running,
  // floored at 0, and 0 unless the board could die. awardStopTime takes a MAX.

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

  // Garbage cells gone between the board this move was made from and the board it left.
  function stopTimeEarned(input) {
    return input.earned.stopTimeEarned || 0;
  }

  // A CLEAR THAT PAID NOTHING. 1 when this move cleared panels and earned
  // neither points nor a broken garbage cell; 0 when it cleared nothing, and
  // 0 when it paid.
  //
  // The bare three is the whole case. The engine pays nothing for one --
  // no points, no garbage, no stop time, and the tables that say so live in
  // the engine, not here -- but it still tidies the board, and tidiness is
  // most of the decision, so the bot fires thousands a game.
  //
  // WHY THE TEST IS PAYMENT AND NOT SIZE. "Penalise threes" needs a list of
  // exceptions beside it: not when it chains, not when it breaks garbage.
  // Asking whether the move was PAID collapses that list into the condition
  // -- a chaining three takes the chain bonus, so scoreEarned is non-zero
  // and it is not payless; a three that pops garbage answers the second
  // half. Nothing has to be enumerated, so nothing can be forgotten.
  //
  // It reads scoreEarned rather than restating the score tables, for the
  // same reason scoreEarned itself asks the engine: a second copy of those
  // numbers is a second copy to drift.

  // Garbage cells this move popped, as reported by resolve().
  function brokeGarbage(input) {
    return input.earned.brokeGarbage || 0;
  }

  // Garbage cells gone between the board this move was made from and the board
  // it left. At depth 2 the baseline is the parent candidate, not the live stack.
  function garbageCleared(input) {
    return input.earned.garbageCleared || 0;
  }


  // Widest single clear any legal swap could make. MAX, not sum — payout is per clear.

  // Loaded steps: panels that would complete a horizontal three if the cell under them cleared and they fell one row.
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

  // Same walk as staircase, but only steps whose base can be cleared by one swap.

  // Loaded steps: panels that would complete a horizontal three if the cell
  // under them cleared and they fell one row.

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

    // THE WALK IS SHARED, AND IT LIVES ON THE INPUT.
    // staircase and staircaseReady are the same scan one flag apart — the flag
    // only decides whether a run's base has to be firable. Measured at 21.0
    // and 18.1 us against 105 us for all 23 features, so doing it twice was
    // ~17% of every candidate.
    //
    // NOT a WeakMap keyed on the board with a fingerprint, which is how
    // swapOutcomes does it: that costs a 72-cell walk and a string build to
    // validate, and measured 94% SLOWER than simply scanning twice. The
    // fingerprint earns its keep against a pass that clones and resolves
    // thirty times; it cannot against a grid walk.
    //
    // evaluate() hands the SAME input object to every feature and builds a
    // fresh one per candidate, so the input is the natural place for it and
    // needs no validation — a new candidate is a new object.
    var step = null, any = false, r, c;
    if (input._stairSteps) { step = input._stairSteps.step; any = input._stairSteps.any; }
    if (step === null) {
      step = {};
      for (r = 2; r <= H; r++) {
        for (c = 1; c <= W; c++) {
          var v = grid[r][c];
          if (v <= 0) continue;               // empty, busy (-1) and garbage (-2) are not colours
          var under = grid[r - 1][c];
          if (under === 0 || under === v) continue;  // nothing to clear, or already a match
          // The three ways the falling panel becomes the third of a row: it
          // lands to the right of a pair, between two, or to the left of a pair.
          if (pair(r - 1, c - 2, c - 1, v) ||
              pair(r - 1, c - 1, c + 1, v) ||
              pair(r - 1, c + 1, c + 2, v)) { step[r + ':' + c] = true; any = true; }
        }
      }
      try { input._stairSteps = { step: step, any: any }; } catch (e) { /* frozen input */ }
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

  // Columns within one row of the tallest, scaled by tallest/height. A product, so it sees flat-AND-high, which a weighted sum of roughness and maxHeight cannot.

  return {
    travelCost: travelCost,
    _matchedCellsNear: matchedCellsNear,
    latentChain: latentChain,
    chainLayers: chainLayers,
    garbageCleared: garbageCleared,
    stopTimeEarned: stopTimeEarned,
    brokeGarbage: brokeGarbage,
    reach4combo: function (i) { return reachOf(i, 'reach4combo'); },
    reach5combo: function (i) { return reachOf(i, 'reach5combo'); },
    reach6combo: function (i) { return reachOf(i, 'reach6combo'); },
    reach7combo: function (i) { return reachOf(i, 'reach7combo'); },
    reach8combo: function (i) { return reachOf(i, 'reach8combo'); },
    reach9combo: function (i) { return reachOf(i, 'reach9combo'); },
    reach10combo: function (i) { return reachOf(i, 'reach10combo'); },
    reach2chain: function (i) { return reachOf(i, 'reach2chain'); },
    reach3chain: function (i) { return reachOf(i, 'reach3chain'); },
    reach4chain: function (i) { return reachOf(i, 'reach4chain'); },
    reach5chain: function (i) { return reachOf(i, 'reach5chain'); },
    reach6chain: function (i) { return reachOf(i, 'reach6chain'); },
    reach7chain: function (i) { return reachOf(i, 'reach7chain'); },
    reach8chain: function (i) { return reachOf(i, 'reach8chain'); },
    pressure: pressure,
    overkill: overkill,
    chainLength: chainLength,
    garbageOnBoard: garbageOnBoard,
    incomingGarbage: incomingGarbage,
    garbageAdjacency: garbageAdjacency,
    edgePenalty: edgePenalty,
    maxHeight: maxHeight,
    material: material,
    colourVariance: colourVariance,
    linksH: linksH,
    linksV: linksV,
    // exported for tests only — not features
    _matchedCells: matchedCells
  };
}));
