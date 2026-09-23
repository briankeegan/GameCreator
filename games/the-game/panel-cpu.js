// Puzzle Attack — the board model the bot plans with.
//
// LogicalBoard is a timer-free copy of the engine's rules: clone a position,
// try a swap, resolve gravity and matches and cascades, and read what it
// paid. The bot (ai/eval/puyocpu.js) is built on it.
//
// Also here: the cursor walk and the stack -> LogicalBoard snapshot. The bot
// walks to a swap rather than teleporting, which is what travelCost prices.
(function (root) {
  // THE SHARED RULES. Resolved on first use rather than at load, so this file
  // does not care whether panel-rules.js was loaded before it.
  var RULES = null;
  function rules() {
    if (!RULES) {
      RULES = (typeof module === 'object' && module.exports)
        ? require('./panel-rules.js')
        : root.PanelRules;
      if (!RULES) throw new Error('panel-rules.js is not loaded');
    }
    return RULES;
  }

  "use strict";

  // blocks: {id: {cells: [[r,c],...]}} — every garbage cell's id must also
  // appear in `blocks`, and every cell in a block must read -2 in `grid`.
  // A cell of "loose" garbage (no real id, e.g. from comboGarbage before
  // an id was ever assigned) gets its own single-cell block.
  // WHY THERE IS A SECOND BOARD AT ALL, AND WHAT IT COSTS TO BE WRONG.
  //
  // panel-engine.js runs the game. This is a separate, fast re-implementation
  // of the same rules that the search clones a few hundred times per decision.
  // Two implementations of one ruleset, so the only question that matters is
  // where they disagree — and they do, measurably:
  //
  //   FIXED, AND MEASURED: 50,797 cases — all 3,320 real in-play boards times
  //   every legal swap on each — and this board is now IDENTICAL to the
  //   engine on every one. Chain depth, panels cleared, and the final grid
  //   cell by cell (resolve_fidelity.js, gated at 100%).
  //
  // It was not, and the bug mattered most where the bot needed it most: the
  // right panels cleared, in ONE ROUND FEWER, on exactly the deep-chain
  // shapes it is supposed to be learning to build. Three faults, each hiding
  // the next, and the first "fix" made the numbers worse before better:
  //
  //   1. THE MEASUREMENT ITSELF MOVED. riseLock is re-decided every frame, so
  //      a settle long enough to run a cascade let the reference stack climb
  //      a row. 195 of the first 213 disagreements were that — they would
  //      have been "fixed" in here, against a board that was sliding.
  //   2. THIS BOARD TELEPORTED PANELS. _applyGravity settled everything before
  //      matching, so every panel landed at the same instant. The engine makes
  //      a panel falling three rows land two frames after one falling a single
  //      row, and two groups landing frames apart are two chain links. resolve
  //      now falls ONE ROW PER TICK and matches only what has landed.
  //   3. TWO COMBOS ARE NOT A TWO-CHAIN. With the timing right, separate
  //      groups popping frames apart became separate ROUNDS — and counting
  //      rounds calls that a chain. The engine increments only when a matched
  //      panel is already flagged `chaining`, so that flag is modelled here
  //      panel by panel and travels with the panel as it falls.
  //
  // The earlier attempt recorded here as "fixed 0 of 372 and broke 32" failed
  // because it had only (2). On its own (2) is not enough and makes things
  // worse: it turns an undercount into an overcount. All three are needed.
  //
  // 349 of the 639 chip templates that fired on the engine and failed here now
  // pass both. The 290 that remain are staged shapes, not positions from play;
  // every position from play agrees.
  //
  // THE OTHER OPTION IS TO STOP HAVING A SECOND BOARD. Measured, same machine,
  // same position, per candidate move:
  //
  //     LogicalBoard clone+swap+resolve      0.017 ms
  //     real Stack, reused, paint+swap+run   1.270 ms      77x
  //
  //     30 candidates at depth 1             38 ms   of an 85ms budget
  //     180 candidates at depth 2           229 ms   does not fit
  //
  // Depth 1 on the real engine FITS, with roughly half the budget left. That
  // is a real option rather than an obviously impossible one, and it would
  // delete this whole class of disagreement instead of chasing it. It is also
  // a change to how every decision is made and would invalidate every trained
  // weight set, so it is the owner's call, not a tidy-up.
  function LogicalBoard(width, height, colors, grid, blocks, nextBlockId, chaining) {
    this.width = width;
    this.height = height;
    this.colors = colors;
    this.grid = grid; // grid[row][col], 1..height / 1..width; 0 empty, -1 busy, -2 garbage, >0 color
    this.blocks = blocks || {};
    this._nextBlockId = nextBlockId || 1;
    // WHICH PANELS ARE ALREADY FALLING BECAUSE SOMETHING UNDER THEM CLEARED.
    //
    // The engine's `chaining` flag, carried in from the live stack. resolve()
    // models the flag within its own cascade and used to start it all-false,
    // so a swap into a cascade that was ALREADY RUNNING read as a plain
    // combo — when the engine scores a match on a flagged panel as a chain
    // link, paying the chain stop-time formula and sending a full-width slab.
    // Measured: the bot decides while panels are chaining on 11.2% of its
    // decisions, and BUILD was discarding those continuations as worthless
    // threes.
    //
    // Absent means all-false, which is every caller that builds a board by
    // hand and is the old behaviour exactly.
    this.chaining = chaining || null;
  }

  // A fresh all-false flag grid, or a copy of one.
  LogicalBoard.prototype._chainingGrid = function (from) {
    var g = [];
    for (var r = 0; r <= this.height; r++) {
      g[r] = [];
      for (var c = 1; c <= this.width; c++) {
        g[r][c] = from ? !!(from[r] && from[r][c]) : false;
      }
    }
    return g;
  };

  LogicalBoard.prototype.clone = function () {
    var g = [];
    for (var r = 0; r <= this.height; r++) g[r] = this.grid[r] ? this.grid[r].slice() : [];
    var blocks = {};
    for (var id in this.blocks) if (this.blocks.hasOwnProperty(id)) {
      blocks[id] = { cells: this.blocks[id].cells.map(function (rc) { return [rc[0], rc[1]]; }) };
    }
    // The flags are COPIED, not shared: every candidate resolves its own
    // cascade and would otherwise write its chaining into its siblings.
    return new LogicalBoard(this.width, this.height, this.colors, g, blocks,
                            this._nextBlockId,
                            this.chaining ? this._chainingGrid(this.chaining) : null);
  };

  // Lowest row (0 = bottom-most playable row) any garbage cell occupies, or
  // null if there is none. A match that only clears the one real panel
  // propping up an otherwise-unsupported garbage slab drops zero garbage
  // cells directly, but lets the whole slab settle downward on the next
  // gravity pass — this is what lets that "collapse the pillar" move score
  // as progress at all.
  // RISE THE BOARD ONE ROW, the way Stack.newRow does.
  //
  // WHY A SEARCH NEEDS THIS AT ALL. Every candidate move used to be scored
  // on the board the instant its match finished popping — the ugliest
  // moment it will ever have. The hole is dug, the cluster is spent, and
  // the panels that come back to fill it never arrive, because the
  // simulation stops there. Holding, meanwhile, was scored on a board that
  // never moved. So the two were compared at different points in time, and
  // the one that had not paid for anything won: measured over 570 real
  // level-10 decisions, a swap clearing 7+ panels scored 1537 points WORSE
  // than doing nothing on the same board, and the bot held 52% of its
  // decisions with clears — including whole 3-chains — on the table.
  //
  // Rising every candidate by the same row fixes the comparison rather
  // than the weights: the stack was going to rise whatever the bot did.
  //
  // `colors[col]` is the incoming dimmed row, which the player can see and
  // so can the search (Stack row 0, already filled by fillNewRow). Pass
  // nothing and the row arrives as unknown (-1) — honest for a board whose
  // next row genuinely is not decided yet.
  //
  // OVERFLOW IS DROPPED. A panel shifted above `height` is gone from the
  // model. That only happens on a board already touching the ceiling, where
  // the real engine has stopped rising anyway (riseLock/stopTime, and
  // isToppedOut costs health instead) — so it is a state the search reaches
  // only when the game is already being lost, and maxHeight has said so
  // several rows earlier.
  LogicalBoard.prototype.rise = function (colors) {
    var r, c, cells;
    for (r = this.height; r >= 2; r--) {
      this.grid[r] = this.grid[r - 1] ? this.grid[r - 1].slice() : [];
    }
    this.grid[1] = [];
    for (c = 1; c <= this.width; c++) {
      this.grid[1][c] = (colors && colors[c] !== undefined) ? colors[c] : -1;
    }
    // Row 0 is the NEXT incoming row, which nothing can know yet.
    this.grid[0] = [];
    for (c = 1; c <= this.width; c++) this.grid[0][c] = -1;

    // Garbage blocks carry their own cell lists, and a block that drifts
    // out of step with the grid is the one way this model can go quietly
    // wrong — _pruneClearedBlocks only removes cells, it cannot repair a
    // row index. Cells pushed past the ceiling leave with their panels.
    for (var id in this.blocks) if (this.blocks.hasOwnProperty(id)) {
      cells = [];
      for (var i = 0; i < this.blocks[id].cells.length; i++) {
        var rc = this.blocks[id].cells[i];
        if (rc[0] + 1 <= this.height) cells.push([rc[0] + 1, rc[1]]);
      }
      if (cells.length) this.blocks[id].cells = cells; else delete this.blocks[id];
    }
    return this;
  };

  LogicalBoard.prototype.lowestGarbageRow = function () {
    var lowest = null;
    for (var id in this.blocks) if (this.blocks.hasOwnProperty(id)) {
      var cells = this.blocks[id].cells;
      for (var i = 0; i < cells.length; i++) {
        if (lowest === null || cells[i][0] < lowest) lowest = cells[i][0];
      }
    }
    return lowest;
  };

  // How many rows, counting up from the floor, are still entirely
  // garbage-free — i.e. how much real-panel "runway" is left before the
  // garbage wall starts. Every match that clears real panels WITHOUT
  // touching garbage shrinks this and is never replenished by gravity
  // (matched panels are just gone; only a fresh row from newRow()/raise
  // refills the well) — a board can be short on danger height and still
  // be dying, if this hits zero, because there is nothing left to build
  // a match out of.
  LogicalBoard.prototype.runwayHeight = function () {
    var h = 0;
    for (var r = 1; r <= this.height; r++) {
      var hasGarbage = false;
      for (var c = 1; c <= this.width; c++) if (this.grid[r][c] === -2) { hasGarbage = true; break; }
      if (hasGarbage) break;
      h = r;
    }
    return h;
  };

  LogicalBoard.prototype.heightOf = function (col) {
    for (var r = this.height; r >= 1; r--) if (this.grid[r][col] > 0 || this.grid[r][col] === -2) return r;
    return 0;
  };

  LogicalBoard.prototype.maxHeight = function () {
    var m = 0;
    for (var c = 1; c <= this.width; c++) m = Math.max(m, this.heightOf(c));
    return m;
  };

  LogicalBoard.prototype.fillRatio = function () { return this.maxHeight() / this.height; };

  LogicalBoard.prototype.legalSwaps = function () {
    var out = [];
    for (var r = 1; r <= this.height; r++) {
      for (var c = 1; c < this.width; c++) {
        var a = this.grid[r][c], b = this.grid[r][c + 1];
        if (a < 0 || b < 0) continue; // garbage or busy: never swappable
        if (a === 0 && b === 0) continue;
        if (a === b) continue;
        out.push([r, c]);
      }
    }
    return out;
  };

  LogicalBoard.prototype.swap = function (r, c) {
    var t = this.grid[r][c];
    this.grid[r][c] = this.grid[r][c + 1];
    this.grid[r][c + 1] = t;
  };

  // Real panels (>0) fall independently, per column, same as always —
  // garbage (-2) and busy (-1) cells are fixed obstacles during this pass,
  // never moved by it.
  // ONE ROW, ONCE — the tick resolve() falls by. _dropRealPanels compacts a
  // column completely, which is the same as saying every panel lands at the
  // same instant. The engine does not: a panel falling three rows lands two
  // frames after one falling a single row, and two groups landing frames
  // apart are two chain links rather than one merged combo.
  LogicalBoard.prototype._dropRealPanelsOneRow = function (carry) {
    var moved = false;
    for (var c = 1; c <= this.width; c++) {
      for (var r = 1; r < this.height; r++) {
        if (this.grid[r][c] === 0 && this.grid[r + 1][c] > 0) {
          this.grid[r][c] = this.grid[r + 1][c];
          this.grid[r + 1][c] = 0;
          // The chaining flag belongs to the PANEL, not the cell, so it
          // travels with it. Without this a falling panel loses the mark that
          // says "I am here because something cleared under me", which is the
          // one fact that separates a chain link from a second combo.
          if (carry) { carry[r][c] = carry[r + 1][c]; carry[r + 1][c] = false; }
          moved = true;
        }
      }
    }
    return moved;
  };

  LogicalBoard.prototype._dropRealPanels = function () {
    var changedAny = false, changed = true;
    while (changed) {
      changed = false;
      for (var c = 1; c <= this.width; c++) {
        for (var r = 1; r < this.height; r++) {
          if (this.grid[r][c] === 0 && this.grid[r + 1][c] > 0) {
            this.grid[r][c] = this.grid[r + 1][c];
            this.grid[r + 1][c] = 0;
            changed = true; changedAny = true;
          }
        }
      }
    }
    return changedAny;
  };

  LogicalBoard.prototype._blockLowestRow = function (block) {
    var lowest = null;
    for (var i = 0; i < block.cells.length; i++) {
      if (lowest === null || block.cells[i][0] < lowest) lowest = block.cells[i][0];
    }
    return lowest;
  };

  // The real engine's rule (supportedFromBelow in panel-engine.js): a
  // garbage slab falls or holds as ONE piece, and holds as soon as ANY
  // single column under its full width is blocked -- a 6-wide slab resting
  // on one panel does not fall. So this only allows a fall when EVERY
  // column under the block's current footprint is clear.
  LogicalBoard.prototype._blockCanFall = function (block) {
    var lowestByCol = {};
    for (var i = 0; i < block.cells.length; i++) {
      var r = block.cells[i][0], c = block.cells[i][1];
      if (lowestByCol[c] === undefined || r < lowestByCol[c]) lowestByCol[c] = r;
    }
    for (var col in lowestByCol) if (lowestByCol.hasOwnProperty(col)) {
      var belowRow = lowestByCol[col] - 1;
      if (belowRow < 1) return false;               // resting on the floor
      if (this.grid[belowRow][col] !== 0) return false; // blocked in this column
    }
    return true;
  };

  LogicalBoard.prototype._moveBlockDown = function (block) {
    var i, r, c;
    for (i = 0; i < block.cells.length; i++) { r = block.cells[i][0]; c = block.cells[i][1]; this.grid[r][c] = 0; }
    for (i = 0; i < block.cells.length; i++) block.cells[i][0] -= 1;
    for (i = 0; i < block.cells.length; i++) { r = block.cells[i][0]; c = block.cells[i][1]; this.grid[r][c] = -2; }
  };

  // Whole-block gravity, bottom-to-top so a block that just fell can open
  // room for the one above it within the same pass.
  LogicalBoard.prototype._dropGarbageBlocks = function () {
    var self = this;
    var ids = Object.keys(this.blocks);
    ids.sort(function (a, b) { return self._blockLowestRow(self.blocks[a]) - self._blockLowestRow(self.blocks[b]); });
    var changed = false;
    for (var i = 0; i < ids.length; i++) {
      var block = this.blocks[ids[i]];
      if (this._blockCanFall(block)) { this._moveBlockDown(block); changed = true; }
    }
    return changed;
  };

  // Drop real panels and garbage blocks to a fixed point, alternating —
  // either phase can open room the other needed. Bounded so a pathological
  // state can't loop forever.
  LogicalBoard.prototype._applyGravity = function () {
    for (var i = 0; i < this.height * 2; i++) {
      var a = this._dropRealPanels();
      var b = this._dropGarbageBlocks();
      if (!a && !b) break;
    }
  };

  // Removes any block whose cells no longer read -2 in the grid (matched
  // and cleared) -- called right after a match zeroes garbage cells, so
  // `blocks` never drifts out of sync with `grid`.
  LogicalBoard.prototype._pruneClearedBlocks = function () {
    for (var id in this.blocks) if (this.blocks.hasOwnProperty(id)) {
      var block = this.blocks[id], kept = [];
      for (var i = 0; i < block.cells.length; i++) {
        var r = block.cells[i][0], c = block.cells[i][1];
        if (this.grid[r][c] === -2) kept.push(block.cells[i]);
      }
      if (kept.length === 0) delete this.blocks[id]; else block.cells = kept;
    }
  };

  // HOT: called ~9,400 times per level-10 game, inside resolve()'s loop,
  // which is itself called once per candidate move and again for every
  // legal swap inside chainPotential. Profiled at 38% of a game's runtime.
  //
  // Rewritten to allocate nothing per cell. The previous version built a
  // `run` ARRAY per run and pushed a column index into it for every panel,
  // then walked it again to emit matches. A run is fully described by where
  // it started and how long it is, so this tracks two integers instead.
  //
  // WHAT IS DELIBERATELY UNCHANGED: the returned shape ("r:c" -> [r, c]),
  // the scan order (rows top-down then columns left-right), and therefore
  // the INSERTION ORDER of the keys. Callers iterate this with `for..in`
  // and _connectedGarbage's flood fill starts from it, so a different order
  // is a different game even when the same cells match. identity.test.js
  // hashes every frame of eight games precisely so that claim is checked
  // rather than asserted.
  // restingOnly: a panel still in the air cannot match. The engine will not
  // match a falling panel, and resolve() used to have no way to express that
  // because it moved every panel to its resting place before looking.
  var RESTING_SCRATCH = null;
  var EFF_SCRATCH = null;

  LogicalBoard.prototype._findMatches = function (restingOnly) {
    var matched = {}; // "r:c" -> [r, c]
    var H = this.height, W = this.width, grid = this.grid;
    var r, c, i, color, runStart, runLen, runColor, row;
    // WHAT COUNTS AS LANDED. "The cell below is occupied" is NOT enough: a
    // panel resting on a panel that is itself falling is falling too, and
    // treating it as landed fires a match a tick early — a whole combo the
    // engine never makes.
    //
    // AND A GARBAGE SLAB IS A FLOOR. The first version of this walked each
    // column and called everything above its lowest empty cell airborne,
    // which is right until garbage exists: a slab rests if ANY column under
    // it is blocked (supportedFromBelow), so it BRIDGES the gaps in the
    // columns it spans, and everything standing on it is resting. Treating
    // those as airborne made the simulation refuse matches that were sitting
    // on solid ground — three 4s in a row on top of a slab, scored as 0
    // against the engine's 2-chain.
    //
    // So support is computed properly, bottom up: a cell rests if it is
    // garbage whose block cannot fall, or if the cell beneath it rests.
    var resting = null;
    if (restingOnly) {
      var blockOf = {}, canFall = {};
      for (var bid in this.blocks) {
        canFall[bid] = this._blockCanFall(this.blocks[bid]);
        var bcells = this.blocks[bid].cells;
        for (var bi = 0; bi < bcells.length; bi++) blockOf[bcells[bi][0] + ':' + bcells[bi][1]] = bid;
      }
      // SUPPORT IS TRANSITIVE THROUGH SLABS. A slab resting on another slab is
      // only resting if that one is, and _blockCanFall answers for one block
      // against the grid as it stands — so a stack of two slabs over a hole
      // read as "the upper one is held up by the lower one", while the lower
      // one was on its way down and the engine took both. Everything standing
      // on the upper slab then matched a tick early: the simulation cleared
      // three panels on boards where the engine clears nothing.
      //
      // Run to a fixed point: a block falls if every column beneath it is
      // empty or belongs to a block already known to be falling. Bounded by
      // the number of blocks, since each pass can only ever mark more.
      var moved = true, guardPasses = 0;
      while (moved && guardPasses++ <= Object.keys(this.blocks).length + 1) {
        moved = false;
        for (var fid in this.blocks) {
          if (canFall[fid]) continue;
          var fcells = this.blocks[fid].cells, lowByCol = {};
          for (var fi = 0; fi < fcells.length; fi++) {
            var fr = fcells[fi][0], fc = fcells[fi][1];
            if (lowByCol[fc] === undefined || fr < lowByCol[fc]) lowByCol[fc] = fr;
          }
          var held = false;
          for (var lc2 in lowByCol) {
            var br = lowByCol[lc2] - 1;
            if (br < 1) { held = true; break; }                 // the floor
            var bv = grid[br][lc2];
            if (bv === 0) continue;                             // nothing there
            if (bv === -2) {
              var under = blockOf[br + ':' + lc2];
              if (under !== undefined && canFall[under]) continue;  // it is falling too
            }
            held = true; break;
          }
          if (!held) { canFall[fid] = true; moved = true; }
        }
      }
      // ONE SCRATCH GRID, REUSED. This used to allocate a fresh array of
      // arrays on every call: 13 allocations a time, and _findMatches runs
      // ~25,000 times in a single training game, so ~350,000 throwaway arrays
      // per game. Garbage collection was 13% of the profile.
      //
      // Safe to share because every cell of 1..H x 1..W is WRITTEN below
      // before anything reads it, and nothing re-enters: the only two callers
      // are resolve() and the one-swap scan, neither nested, and
      // _blockCanFall does not call back in. A board smaller than the scratch
      // leaves stale cells outside its own range, which at() never looks at.
      if (!RESTING_SCRATCH || RESTING_SCRATCH.length <= H) {
        RESTING_SCRATCH = [];
        for (var rr0 = 0; rr0 <= H; rr0++) RESTING_SCRATCH[rr0] = [];
      }
      resting = RESTING_SCRATCH;
      for (var rc = 1; rc <= W; rc++) {
        for (var rr = 1; rr <= H; rr++) {
          var rv = grid[rr][rc];
          if (rv === 0) { resting[rr][rc] = false; continue; }
          if (rv === -2) {
            var bidHere = blockOf[rr + ':' + rc];
            resting[rr][rc] = bidHere === undefined ? true : !canFall[bidHere];
            continue;
          }
          resting[rr][rc] = (rr === 1) ? true : !!resting[rr - 1][rc];
        }
      }
    }
    // popping: cells that have already matched and are mid-pop. They still
    // hold panels up — a popping panel is solid for ~80 frames — but they can
    // no longer take part in a match.
    var popping = this._popping;
    // IS THERE ANYTHING POPPING AT ALL? Asked ONCE, not per cell.
    //
    // at() runs for every occupied cell of both the row scan and the column
    // scan, and it was building a "r:c" string on each one purely to index an
    // object that is almost always EMPTY — _popping is reset to {} at the top
    // of every resolve() and only filled once a match has fired. Profiled on a
    // real training game, this closure was 11.5% of the whole game and a large
    // share of the 10.5% spent in garbage collection, all of it allocating
    // keys to look up nothing.
    //
    // Hoisting the emptiness test is exactly equivalent: with no popping
    // cells, popping[k] is undefined for every k, so skipping the lookup
    // cannot change an answer. Fidelity is the proof, not the argument —
    // resolve_fidelity.js re-runs all 74,821 cases against the engine.
    var hasPopping = false;
    for (var pKey in popping) { hasPopping = true; break; }

    // EVERY CELL'S EFFECTIVE COLOUR, COMPUTED ONCE, INTO A FLAT ARRAY.
    //
    // This was a closure, at(), and the scans below called it TWICE for every
    // cell — once walking rows, once walking columns — so the resting lookup,
    // the popping test and the string key were all done twice over for the
    // same answer. A closure also cannot be inlined, and reading resting[r][c]
    // is two dereferences through an array of arrays.
    //
    // One pass fills a flat Int8Array instead, and both scans then read a
    // typed array by integer index: no call, no second computation, no string.
    // Colours are small integers and the sentinels are 0, -1 and -2, so Int8
    // holds every value the grid can carry.
    var STRIDE = W + 2;
    if (!EFF_SCRATCH || EFF_SCRATCH.length < (H + 2) * STRIDE) {
      EFF_SCRATCH = new Int8Array((H + 2) * STRIDE);
    }
    var eff = EFF_SCRATCH;
    for (r = 1; r <= H; r++) {
      row = grid[r];
      var base = r * STRIDE;
      for (c = 1; c <= W; c++) {
        var v = row[c];
        if (!restingOnly || v <= 0) { eff[base + c] = v; continue; }
        if (hasPopping && popping[r + ':' + c]) { eff[base + c] = 0; continue; }
        eff[base + c] = resting[r][c] ? v : 0;
      }
    }

    // THE RUN RULE IS panel-rules.js, not a copy of it. What stays here is
    // deciding which cells can take part — resting, popping, garbage — which
    // is genuinely this board's own view. The scan itself is one rule and the
    // engine calls the same one.
    rules().scanRuns(eff, W, H, STRIDE, function (mr, mc) {
      matched[mr + ":" + mc] = [mr, mc];
    });
    return matched;
  };

  // A match that touches a garbage cell clears the whole connected garbage
  // block it's part of, not just that one cell — the same shape as the real
  // engine's "any panel in a garbage block matches, the whole block clears"
  // rule (getConnectedGarbagePanels in panel-engine.js), simplified for
  // planning. Without this, incoming garbage is a permanent wall in this
  // model — confirmed the hard way in the Python prototype: it boxed the
  // search agent into unrecoverable, un-clearable positions.
  // The BOTTOM ROW of every garbage block a match touched — what the engine
  // actually pops. Marked so the sweep knows these cells become panels of an
  // unknown colour rather than empty space.
  // Everything marked as popping actually leaves now, and whatever stood above
  // it is flagged chaining — it is falling BECAUSE of this pop.
  LogicalBoard.prototype._sweepPopped = function (chaining) {
    var pk, any = false, lowest = {};
    for (pk in this._popping) {
      var pc = this._popping[pk];
      // A POPPED GARBAGE CELL DOES NOT BECOME EMPTY — it becomes a panel whose
      // colour we are not allowed to know. -1 is exactly that on this board:
      // present, occupying space, colour unknown. Emptying it is what made the
      // stack read shorter than the engine has it.
      this.grid[pc[0]][pc[1]] = (pc[2] === 'garbage') ? -1 : 0;
      if (lowest[pc[1]] === undefined || pc[0] < lowest[pc[1]]) lowest[pc[1]] = pc[0];
      any = true;
    }
    this._popping = {};
    if (!any) return false;
    this._pruneClearedBlocks();
    for (var lc in lowest) {
      var lcol = Number(lc);
      for (var lr = lowest[lc] + 1; lr <= this.height; lr++) {
        if (this.grid[lr][lcol] > 0) chaining[lr][lcol] = true;
      }
    }
    return true;
  };

  LogicalBoard.prototype._bottomRowOfTouchedGarbage = function (matched) {
    var touched = this._connectedGarbage(matched);
    // Group the touched cells by the block they belong to, then keep each
    // block's lowest row. Blocks are rectangles, so that row is what pops.
    var byBlock = {}, k, rc, id;
    for (k in touched) {
      rc = touched[k];
      id = this._blockAt(rc[0], rc[1]);
      if (id === null) continue;
      if (!byBlock[id] || rc[0] < byBlock[id]) byBlock[id] = rc[0];
    }
    var out = {};
    for (id in byBlock) {
      var cells = this.blocks[id] ? this.blocks[id].cells : [];
      for (var i = 0; i < cells.length; i++) {
        if (cells[i][0] !== byBlock[id]) continue;
        out[cells[i][0] + ':' + cells[i][1]] = [cells[i][0], cells[i][1], 'garbage'];
      }
    }
    return out;
  };

  LogicalBoard.prototype._blockAt = function (r, c) {
    for (var id in this.blocks) {
      var cells = this.blocks[id].cells;
      for (var i = 0; i < cells.length; i++) if (cells[i][0] === r && cells[i][1] === c) return id;
    }
    return null;
  };

  // Stack.awardStopTime, the modern formula, for the case a planner can see:
  // not topped out. Breaking garbage buys frames, and frames are survival —
  // the real payoff for doing it, and invisible to the evaluator until now.
  // ASK THE ENGINE WHAT IT PAYS. Do not re-derive it.
  //
  // This was a hand-copy of Stack.awardStopTime's arithmetic, and a copy of a
  // rule drifts from the rule: it carried only the two ordinary branches and
  // silently dropped BOTH topped-out cases, which pay by a different formula
  // (dangerConstant/dangerCoefficient for a chain, a flat 2-or-3 coefficient
  // for a combo). Nothing caught it, because the fidelity harness never tops
  // a board out — the one situation where stop time matters most is the one
  // no check could see.
  //
  // So the engine's own function decides, on a Stack kept for the purpose.
  // The Stack is built once (construction runs a thousand frames of countdown)
  // and only three fields are set per call, so this stays cheap enough for the
  // per-candidate path. stopTime is zeroed first because awardStopTime only
  // ever RAISES it — leaving a previous candidate's award in place would make
  // every later one read at least as large.
  LogicalBoard.prototype._stopTimeFor = function (isChain, comboSize, chainCounter, toppedOut) {
    if (!LogicalBoard._stopStack) {
      try {
        LogicalBoard._stopStack = new root.PanelEngine.Stack({ level: 10, seed: 1 });
      } catch (e) { LogicalBoard._stopStack = null; }
    }
    var s = LogicalBoard._stopStack;
    if (!s) return 0;
    s.stopTime = 0;
    s.wasToppedOut = !!toppedOut;
    s.chainCounter = chainCounter || 0;
    s.awardStopTime(!!isChain, comboSize);
    return s.stopTime;
  };

  LogicalBoard.prototype._connectedGarbage = function (matched) {
    var self = this;
    var within = function (r, c) { return r >= 1 && r <= self.height && c >= 1 && c <= self.width; };
    // HOT, for the same reason as _findMatches: once per resolve() pass.
    // The previous version allocated a four-element array of two-element
    // arrays AND a closure for every matched cell and every popped cell,
    // just to test four neighbours. Same four tests, written out.
    //
    // THE PUSH ORDER IS PART OF THE BEHAVIOUR and is preserved exactly:
    // down, up, right, left, into a LIFO stack, so the pop order and hence
    // `seen`'s insertion order are unchanged. Reordering these four lines
    // would floods-fill the same cells in a different order — invisible in
    // most results and not in all of them.
    var seen = {};
    var stack = [];
    var k, rc, n, nr, nc, nk;
    function pushIfGarbage(r, c) {
      if (within(r, c) && self.grid[r][c] === -2) stack.push([r, c]);
    }
    for (k in matched) {
      rc = matched[k];
      pushIfGarbage(rc[0] + 1, rc[1]);
      pushIfGarbage(rc[0] - 1, rc[1]);
      pushIfGarbage(rc[0], rc[1] + 1);
      pushIfGarbage(rc[0], rc[1] - 1);
    }
    while (stack.length) {
      n = stack.pop();
      nr = n[0]; nc = n[1];
      nk = nr + ":" + nc;
      if (seen[nk]) continue;
      seen[nk] = n;
      if (within(nr + 1, nc) && self.grid[nr + 1][nc] === -2 && !seen[(nr + 1) + ":" + nc]) stack.push([nr + 1, nc]);
      if (within(nr - 1, nc) && self.grid[nr - 1][nc] === -2 && !seen[(nr - 1) + ":" + nc]) stack.push([nr - 1, nc]);
      if (within(nr, nc + 1) && self.grid[nr][nc + 1] === -2 && !seen[nr + ":" + (nc + 1)]) stack.push([nr, nc + 1]);
      if (within(nr, nc - 1) && self.grid[nr][nc - 1] === -2 && !seen[nr + ":" + (nc - 1)]) stack.push([nr, nc - 1]);
    }
    return seen;
  };

  // Resolves gravity+matching to a stable state. Returns {chainLength,
  // comboSizes, garbage: [[width,height],...]} — chainLength 0 means the
  // triggering swap matched nothing.
  LogicalBoard.prototype.resolve = function () {
    var chainLength = 0, comboSizes = [], garbage = [];
    // TWO COMBOS ARE NOT A TWO-CHAIN, and counting rounds cannot tell them
    // apart. The engine increments its chain counter only when a matched
    // panel is already flagged `chaining` — meaning it fell because something
    // below it cleared (Stack:incrementChainCounter, via isNewChainLink).
    // Two independent groups that happen to pop seven frames apart both carry
    // chainCounter 0 and the whole thing is ONE combo; resolve() counted two
    // rounds and called it a chain.
    //
    // So the flag is modelled here, panel by panel: set on everything above a
    // cleared cell, carried as that panel falls, and read when it matches.
    // THE BOT MAY ONLY KNOW WHAT THE ENGINE HAS SHOWN IT.
    //
    // A match touching a garbage slab pops ONE ROW of it, and the engine turns
    // that row into coloured panels — colours from this.rng()
    // (Stack.garbageRowColors). A planner that predicted them would be reading
    // dice it is not allowed to see, and any chain it found past that point is
    // a chain it cannot actually play.
    //
    // So the cascade STOPS at the first garbage break. What is knowable up to
    // then is reported exactly: which slab broke, how much of it, and the stop
    // time it bought. See ../GARBAGE_PLAN.md.
    var brokeGarbage = 0, truncated = false, stopTimeEarned = 0;
    // SEEDED FROM THE LIVE STACK when the snapshot carried flags, so a swap
    // into a cascade already in flight is scored as the chain link the
    // engine will score it as. All-false when it did not, which is every
    // hand-built board and the old behaviour.
    var chaining = this._chainingGrid(this.chaining);
    var counter = 0;
    this._popping = {};
    // NO SETTLE BEFORE THE FIRST LOOK EITHER, and this was the last case.
    // A swap is not a settled position: moving a panel sideways out of a
    // column opens a hole under the panels above it, and those are in the air
    // while a match elsewhere on the board is already firing. Compacting
    // first dropped them into a row they had not reached yet and invented a
    // horizontal three — board 611 read as 5 panels cleared where the engine
    // clears 3, before a single tick had passed.
    //
    // The tick loop below falls a row at a time and only matches what has
    // landed, which is the same rule the rest of the cascade already obeys.
    // On a board that IS settled this costs one extra pass and changes
    // nothing.
    var guard = 0;
    while (guard++ < this.height * 4 + 64) {
      var matched = this._findMatches(true);
      var keys = Object.keys(matched);
      if (!keys.length) {
        // Nothing has landed into a match yet. Let the board fall one more
        // row and look again; when nothing can move either, it is over.
        var movedPanels = this._dropRealPanelsOneRow(chaining);
        var movedGarbage = this._dropGarbageBlocks();
        if (movedPanels || movedGarbage) continue;
        // Still, and nothing new matched: now the popped panels actually
        // leave, and everything standing above one of them is falling
        // BECAUSE of that — the engine's chaining flag.
        if (!this._sweepPopped(chaining)) break;
        continue;
      }
      // A MATCH DOES NOT EMPTY ITS CELLS YET. In the engine a matched panel
      // flashes and pops over dozens of frames, and it keeps holding up
      // whatever sits on it the whole time. Deleting it on the spot drops
      // those panels early, so a group that was about to complete its own
      // match lands somewhere else and the match never happens: the engine
      // fires 5, then 3 at frame 85, then 4 at frame 87 — three links, twelve
      // panels — while this board cleared 5 then 3 and stopped at eight.
      //
      // Two frames apart, and both fire long before either pops. So matches
      // are MARKED here and swept once the board has come to rest.
      var isChainLink = false;
      for (var ck = 0; ck < keys.length; ck++) {
        var cell = matched[keys[ck]];
        if (chaining[cell[0]][cell[1]]) { isChainLink = true; break; }
      }
      // Stack:incrementChainCounter — the first link of a chain is an x2.
      if (isChainLink) counter = counter === 0 ? 2 : counter + 1;
      chainLength++;
      comboSizes.push(keys.length);
      // ONE ROW OF A SLAB, NOT THE WHOLE SLAB. _connectedGarbage flood-fills
      // every touching garbage cell; the engine pops the bottom row of each
      // block it touched and leaves the rest standing. Deleting the lot left
      // the board far emptier than it will be, so every height-based feature
      // read a position that was never going to exist.
      var cleared = this._bottomRowOfTouchedGarbage(matched);
      var k;
      for (k in matched) this._popping[matched[k][0] + ':' + matched[k][1]] = matched[k];
      var poppedGarbage = 0;
      for (k in cleared) { this._popping[cleared[k][0] + ':' + cleared[k][1]] = cleared[k]; poppedGarbage++; }
      // STOP TIME IS EARNED BY THE MATCH, NOT BY THE GARBAGE.
      //
      // This used to sit inside the `if (poppedGarbage)` below, so a clear
      // only reported stop time when it happened to break a slab. The engine
      // pays for any combo wider than 3 and for any chain link, garbage or
      // not — _stopTimeFor says exactly that in its own first line — so the
      // common case paid nothing here.
      //
      // The cost was a DEAD FEATURE: stopTimeEarned read zero on all 2,450
      // evaluations of puyocpu.test.js's sweep, because training boards
      // rarely break garbage. A search dimension attached to nothing, which
      // the GA still assigns weight to. Caught by the pre-flight gate before
      // it could waste a five-hour run, which is what that gate is for.
      var st = this._stopTimeFor(isChainLink, keys.length, counter);
      if (st > stopTimeEarned) stopTimeEarned = st;
      if (poppedGarbage) {
        brokeGarbage += poppedGarbage;
        truncated = true;
      }
      var pieces = root.PanelEngine.comboGarbage(keys.length);
      for (var i = 0; i < pieces.length; i++) garbage.push([pieces[i], 1]);
      // GARBAGE BROKE: apply this pop and stop. The pop still has to HAPPEN —
      // stopping before the sweep leaves the slab untouched and reports a
      // break that never landed — but nothing past it is knowable, because the
      // cells it just made are panels of a colour drawn from the engine's RNG.
      if (truncated) { this._sweepPopped(chaining); break; }
      // NO full settle here. The loop falls a row per pass, so a group with
      // less distance to travel lands, matches and scores its own link before
      // a group still on its way down arrives.
    }
    // REPORTED IN THE SAME UNITS engineboard.settle() uses, so the two are
    // comparable without either caller knowing which board it came from: a
    // plain combo (or several separate ones) is 1, a real 2-chain is 2.
    var depth = comboSizes.length ? Math.max(counter, 1) : 0;
    if (depth >= 2) garbage.push([this.width, Math.max(0, depth - 1)]);
    // `truncated` is a field rather than a silence: a caller that treats a
    // stopped resolve as a finished one is making the same mistake one layer
    // up, and nothing in the result would otherwise say which it got.
    return { chainLength: depth, comboSizes: comboSizes, garbage: garbage,
             brokeGarbage: brokeGarbage, stopTimeEarned: stopTimeEarned,
             truncated: truncated };
  };

  function garbageCells(garbage) {
    var total = 0;
    for (var i = 0; i < garbage.length; i++) total += garbage[i][0] * garbage[i][1];
    return total;
  }

  function boardPotential(board) { return potential(board.grid, board.height, board.width); }

  function garbageCellCount(board) {
    var n = 0;
    for (var r = 1; r <= board.height; r++) for (var c = 1; c <= board.width; c++) if (board.grid[r][c] === -2) n++;
    return n;
  }

  // LogicalBoard is exported for TESTS, which need to build a board by hand
  // and then ask it what a swap would actually do (clone/swap/resolve). The
  // alternative was a second implementation of gravity and matching living
  // in the test file, which is how a test ends up agreeing with itself
  // instead of with the game.
  // Cursor walking and the stack -> LogicalBoard snapshot. The bot walks to
  // a swap rather than teleporting, which is what travelCost prices.
  function beginWalk(row, col, cooldown) {
    this._walk = { row: row, col: col, timer: 0, cooldown: cooldown, retries: 0 };
  }

  function driveWalk(input) {
    var stack = this.stack, w = this._walk, width = root.PanelEngine.WIDTH;
    // The target can drift out of reach mid-walk: the stack rises, so
    // topCurRow moves under us. Clamp rather than abandon — the same clamp
    // clampCursor would apply on arrival.
    var row = Math.max(1, Math.min(w.row, stack.topCurRow));
    var col = Math.max(1, Math.min(w.col, width - 1));

    if (stack.curRow !== row || stack.curCol !== col) {
      if (w.timer > 0) { w.timer--; return; }
      // One axis at a time, which is all applyInput reads anyway (it takes
      // the first of up/down/left/right and ignores the rest).
      if (stack.curCol < col) input.right = true;
      else if (stack.curCol > col) input.left = true;
      else if (stack.curRow < row) input.up = true;
      else input.down = true;
      w.timer = this.cursorMoveFrames - 1;
      return;
    }

    // ARRIVED. tryQueueSwap is called directly rather than through
    // input.swap for one reason: it returns whether the swap actually
    // happened, and the caller needs that. It is the same function
    // applyInput calls, at the cursor's own cell, so nothing is being
    // reached that a key press could not reach.
    var ok = stack.tryQueueSwap(stack.curRow, stack.curCol);
    this._walk = null;
    if (ok) { this._lastSwap = [stack.curRow, stack.curCol]; this.cooldown = w.cooldown; return; }

    // IT FAILED WHERE WE STOOD. Stack.canSwap refuses a pull out from
    // under a hovering panel, and applySwapStalling refuses a repeat of
    // the same cell while topped out — both silently. The old code
    // answered this by scanning the whole board with touchSwap until one
    // stuck, which is a teleport hunt. Walk to the nearest cell that can
    // take a swap instead: closest first, because while topped out the
    // thing being defended is idle frames, and the nearest legal cell is
    // the one that ends them soonest.
    var alt = w.retries < 2 ? this._nearestSwappable(stack.curRow, stack.curCol) : null;
    if (alt) {
      this._beginWalk(alt[0], alt[1], w.cooldown);
      this._walk.retries = w.retries + 1;
      return;
    }
    this.cooldown = w.cooldown;
  }

  function nearestSwappable(fromRow, fromCol) {
    var stack = this.stack, width = root.PanelEngine.WIDTH;
    var best = null, bestD = Infinity;
    for (var r = 1; r <= stack.topCurRow; r++) {
      for (var c = 1; c < width; c++) {
        if (r === fromRow && c === fromCol) continue;
        var d = Math.abs(r - fromRow) + Math.abs(c - fromCol);
        if (d >= bestD) continue;
        if (!stack.canSwap(r, c)) continue;   // canSwap already covers the pair (c and c+1)
        best = [r, c]; bestD = d;
      }
    }
    return best;
  }

  function snapshot() {
    var stack = this.stack, width = root.PanelEngine.WIDTH;
    var grid = [];
    var blocks = {};
    // The engine's chaining flag, panel by panel. It belongs to the PANEL,
    // not the cell, so it is read off the same object the colour comes from.
    var chaining = [];
    // MID-FLIGHT IS A STATE, NOT JUST A PLACE. A panel already falling lands
    // sooner than one that has yet to start hovering, and the grid records
    // only where each sits. Painted without this every floating panel gets a
    // fresh full hover, lands late, and can come to rest a row high because
    // something settled underneath it first. State and timer, for the panels
    // that have one.
    var motion = [];
    for (var r = 0; r <= stack.height; r++) {
      grid[r] = [];
      chaining[r] = [];
      motion[r] = [];
      for (var c = 1; c <= width; c++) {
        var p = stack.panelAt(r, c);
        chaining[r][c] = !!(p && p.chaining);
        motion[r][c] = (p && (p.state === 'hovering' || p.state === 'falling'))
                       ? { state: p.state, timer: p.timer || 0 } : null;
        var v;
        if (!p) v = -1;
        else if (p.isGarbage) {
          v = -2;
          var id = "g" + p.garbageId;
          if (!blocks[id]) blocks[id] = { cells: [] };
          blocks[id].cells.push([r, c]);
        }
        else if (p.color === 0) v = 0;
        // A PANEL IN THE AIR IS STILL A PANEL. Every unsettled state used to
        // collapse to -1, and paint() writes -1 onto the scratch Stack as an
        // EMPTY CELL — so a panel mid-fall was erased from the board the bot
        // reasons about. It would resolve a swap as clearing nothing, walk
        // over, and by the time the swap happened the panel had landed and
        // the swap made a three. The rules were the engine's; the board was
        // not the game's.
        //
        // Falling, hovering and mid-swap panels keep their colour, at the
        // cell they currently occupy: the engine's own gravity then drops
        // them where they will actually land.
        //
        // Matched and popping panels are leaving, so their cells read empty —
        // which is what they will be by the end of the cascade being
        // resolved. Row 0 is the incoming row and stays out of the grid; it
        // reaches the search through board.incoming and rise().
        else if (p.state === "matched" || p.state === "popping" ||
                 p.state === "popped") v = 0;
        else if (p.state === "dimmed") v = -1;
        else v = p.color;
        grid[r][c] = v;
      }
    }
    var board = new LogicalBoard(width, stack.height, this.stack.colors, grid, blocks,
                                 1, chaining);
    // THE CURSOR IS PART OF THE POSITION. Without it the search cannot know
    // what any candidate COSTS: stack.touchSwap teleports, but a person
    // holds a direction and waits, and the second step in a direction is 21
    // frames (see ai/eval/travel.js, measured). topCurRow rides along
    // because clampCursor caps the cursor there — cells above the stack top
    // are unreachable rather than expensive.
    board.motion = motion;
    board.cursor = { row: stack.curRow, col: stack.curCol, topRow: stack.topCurRow };
    // THE INCOMING ROW IS VISIBLE INFORMATION, and the grid above threw it
    // away: row 0's panels are state "dimmed", which the loop maps to -1
    // (busy/unknown) along with everything else mid-animation. But a dimmed
    // row is not busy — it is drawn on screen under the stack, a person
    // plans around it, and rise() needs its colours to say what the board
    // will look like a moment from now.
    board.incoming = [];
    for (var ic = 1; ic <= width; ic++) {
      var ip = stack.panelAt(0, ic);
      board.incoming[ic] = (ip && !ip.isGarbage && ip.color) ? ip.color : -1;
    }
    return board;
  };

  root.PanelCpu = { LogicalBoard: LogicalBoard,
                    beginWalk: beginWalk, driveWalk: driveWalk,
                    nearestSwappable: nearestSwappable, snapshot: snapshot };
})(typeof window !== "undefined" ? window : globalThis);
