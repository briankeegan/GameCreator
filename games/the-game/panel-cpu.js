// Puzzle Attack — the duel opponents' brain.
//
// Two strategies live here, both playing through the same public entry
// points a human uses (touchSwap / raise) — nothing here can do something
// the player could not, and nothing here sees a color the player couldn't
// also see on screen.
//
//   1. THE HEURISTIC BOT (Cpu, unchanged from before) — one ply, score
//      every legal swap, take the best. Fast, simple, the baseline every
//      duel opponent used to be built from.
//
//   2. THE SEARCH BOT (SearchCpu) — genuinely plans: it holds a plain
//      3-match to keep building when the board has room, commits to a
//      multi-swap SEQUENCE toward the biggest cascade it can find rather
//      than re-deciding from scratch every frame, and refuses to ever
//      make a move that could be avoided while the board is dangerously
//      tall. Designed and proven offline in games/the-game/ai/ (Python —
//      a logical, timer-free model of the same match/chain/garbage rules,
//      tournament-tested against the heuristic bot until it won
//      consistently and without exception) before a line of it was
//      written here; see games/the-game/ai/agents.py for the full
//      reasoning behind each piece. difficulty presets exist to turn this
//      DOWN from the tournament-proven config — see DIFFICULTIES.diamond.
(function (root) {
  "use strict";

  var DIFFICULTIES = {
    // reaction: frames between moves. mistake: chance to throw a move away.
    // tidy: chance to spend a move flattening the stack when nothing matches.
    // patience: how often it passes on a plain 3-match while its board is low,
    // to keep building toward a combo worth sending. It is the difference
    // between an opponent who clears panels and one who attacks you.
    gentle: { reaction: 70, mistake: 0.45, tidy: 0.3, panicAt: 0.75, patience: 0 },
    steady: { reaction: 45, mistake: 0.25, tidy: 0.6, panicAt: 0.7, patience: 0.35 },
    sharp: { reaction: 26, mistake: 0.1, tidy: 0.8, panicAt: 0.65, patience: 0.6 },
    brutal: { reaction: 14, mistake: 0.02, tidy: 0.9, panicAt: 0.6, patience: 0.8 },
    // The SearchCpu presets. "diamond" is the shipped, scaled-back one —
    // real lookahead, but slower to react and occasionally misses on
    // purpose, so it is beatable. "nightmare" is the tournament-proven
    // config from games/the-game/ai/agents.py's SearchAgent.DEFAULT_WEIGHTS,
    // kept here for whenever a genuinely relentless opponent is wanted.
    // chainExtend: mid-cascade chain continuation (the "massive garbage"
    // knob — see _chainExtendMove). ON for both search presets; turn it
    // OFF (chainExtend: false) when scaling a weaker character back from
    // this brain, before touching anything else — it is the single
    // biggest offense lever.
    diamond: {
      brain: "search", reaction: 30, mistake: 0.08,
      depth: 2, beam: 5, patience: 0.6, patienceFillCeiling: 0.5,
      dangerHeightFrac: 0.72, chainWeight: 380, comboWeight: 70,
      garbageWeight: 90, heightPenalty: 60, potentialWeight: 5,
      chainExtend: true, sentWeight: 5000
    },
    nightmare: {
      brain: "search", reaction: 12, mistake: 0,
      depth: 4, beam: 10, patience: 0.85, patienceFillCeiling: 0.5,
      dangerHeightFrac: 0.72, chainWeight: 380, comboWeight: 70,
      garbageWeight: 90, heightPenalty: 60, potentialWeight: 5,
      chainExtend: true, sentWeight: 5000
    }
  };

  function Cpu(stack, opts) {
    opts = opts || {};
    var preset = DIFFICULTIES[opts.difficulty] || DIFFICULTIES.steady;
    this.stack = stack;
    this.reaction = opts.reaction || preset.reaction;
    this.mistake = opts.mistake === undefined ? preset.mistake : opts.mistake;
    this.tidy = opts.tidy === undefined ? preset.tidy : opts.tidy;
    this.panicAt = opts.panicAt === undefined ? preset.panicAt : opts.panicAt;
    this.patience = opts.patience === undefined ? preset.patience : opts.patience;
    this.rng = root.PanelEngine.makeRng(opts.seed || 4242);
    this.cooldown = Math.floor(this.reaction / 2);
    this.raiseFrames = 0;
  }

  // A stable panel is one that could actually take part in a match right now.
  Cpu.prototype.colorAt = function (row, col) {
    var p = this.stack.panelAt(row, col);
    if (!p || p.color === 0 || p.isGarbage) return 0;
    if (p.state !== "normal" && p.state !== "landing") return -1; // busy: can't count on it
    return p.color;
  };

  Cpu.prototype.currentGrid = function () {
    var stack = this.stack;
    var grid = [];
    for (var r = 0; r <= stack.height + 1; r++) {
      grid[r] = [];
      for (var c = 1; c <= root.PanelEngine.WIDTH; c++) grid[r][c] = this.colorAt(r, c);
    }
    return grid;
  };

  Cpu.prototype.gridAfterSwap = function (row, col) {
    var grid = this.currentGrid();
    var tmp = grid[row][col];
    grid[row][col] = grid[row][col + 1];
    grid[row][col + 1] = tmp;
    return grid;
  };

  // Counts panels that would match in this hypothetical grid, ignoring the
  // panels that are still empty air (a match cannot form in mid-air).
  function countMatches(grid, height, width) {
    var matched = {};
    var r, c, run, i;
    function flush(cells) {
      if (cells.length >= 3) for (i = 0; i < cells.length; i++) matched[cells[i]] = true;
    }
    for (r = 1; r <= height; r++) {
      run = [];
      for (c = 1; c <= width + 1; c++) {
        var color = c <= width ? grid[r][c] : 0;
        if (color > 0 && (run.length === 0 || grid[r][c - 1] === color)) run.push(r + ":" + c);
        else { flush(run); run = color > 0 ? [r + ":" + c] : []; }
      }
      flush(run);
    }
    for (c = 1; c <= width; c++) {
      run = [];
      for (r = 1; r <= height + 1; r++) {
        var col2 = r <= height ? grid[r][c] : 0;
        if (col2 > 0 && (run.length === 0 || grid[r - 1][c] === col2)) run.push(r + ":" + c);
        else { flush(run); run = col2 > 0 ? [r + ":" + c] : []; }
      }
      flush(run);
    }
    var count = 0;
    for (var key in matched) if (matched.hasOwnProperty(key)) count++;
    return count;
  }

  // How close the board is to a match: pairs sitting next to each other, and
  // split pairs one swap from closing. Scoring a swap by how much this goes UP
  // is what makes the CPU assemble matches instead of only spotting ones that
  // happen to already be there.
  function potential(grid, height, width) {
    var score = 0;
    for (var r = 1; r <= height; r++) {
      for (var c = 1; c <= width; c++) {
        var color = grid[r][c];
        if (color <= 0) continue;
        if (c < width && grid[r][c + 1] === color) score += 1;
        if (c < width - 1 && grid[r][c + 2] === color) score += 1; // one swap from a match
        if (r < height && grid[r + 1][c] === color) score += 2;    // vertical pairs are worth more
      }
    }
    return score;
  }

  // Column heights, used both for tidying and for the panic check.
  Cpu.prototype.columnHeights = function () {
    var stack = this.stack, heights = [];
    for (var col = 1; col <= root.PanelEngine.WIDTH; col++) {
      var h = 0;
      for (var row = stack.height; row >= 1; row--) {
        if (stack.panelAt(row, col).color !== 0) { h = row; break; }
      }
      heights[col] = h;
    }
    return heights;
  };

  Cpu.prototype.bestMove = function (fill) {
    var stack = this.stack;
    var width = root.PanelEngine.WIDTH;
    var heights = this.columnHeights();
    var best = null;
    var basePotential = potential(this.currentGrid(), stack.height, width);

    for (var row = 1; row <= stack.height; row++) {
      for (var col = 1; col < width; col++) {
        if (!stack.canSwap(row, col)) continue;
        var left = this.colorAt(row, col), right = this.colorAt(row, col + 1);
        if (left === -1 || right === -1) continue;
        if (left === right) continue; // pointless swap

        var score = 0;
        var grid = this.gridAfterSwap(row, col);
        var after = countMatches(grid, stack.height, width);
        if (after > 0 && after === 3 && fill < 0.55 && this.rng() < this.patience) {
          // Hold the small match: keep stacking toward something that actually
          // sends garbage. Only while there is room to be patient.
          score = 0;
        } else if (after > 0) {
          score = 1000 + after * 120 - row * 8;
          // clearing garbage is worth a lot: it is the only way out from under it
          var above = stack.panelAt(row + 1, col);
          var above2 = stack.panelAt(row + 1, col + 1);
          if ((above && above.isGarbage) || (above2 && above2.isGarbage)) score += 400;
        } else {
          // No match yet. Two things are still worth doing: build toward one,
          // and keep the stack flat.
          var gain = potential(grid, stack.height, width) - basePotential;
          if (gain > 0) score = 120 + gain * 45 - row * 3 + this.rng() * 20;
          var fromLeft = left > 0 && right === 0 && heights[col] > heights[col + 1];
          var fromRight = right > 0 && left === 0 && heights[col + 1] > heights[col];
          if (fromLeft || fromRight) score = Math.max(score, 100 - row * 4 + this.rng() * 30);
        }
        if (score > 0 && (!best || score > best.score)) best = { row: row, col: col, score: score, match: after > 0 };
      }
    }
    return best;
  };

  Cpu.prototype.update = function () {
    var stack = this.stack;
    if (stack.gameOver) return;

    // Keep the stack moving when it is nearly empty, so the CPU doesn't just
    // sit there while the player is buried.
    if (this.raiseFrames > 0) {
      this.raiseFrames--;
      stack.setInput({ raise: true });
    } else {
      stack.setInput({});
    }

    if (this.cooldown > 0) { this.cooldown--; return; }

    var fill = stack.fillRatio();
    var move = this.bestMove(fill);
    if (!move) {
      if (fill < 0.4) this.raiseFrames = 20;
      this.cooldown = this.reaction;
      return;
    }
    if (!move.match && this.rng() > this.tidy) { this.cooldown = this.reaction; return; }
    if (this.rng() < this.mistake && fill < this.panicAt) { this.cooldown = this.reaction; return; }

    stack.touchSwap(move.row, move.col);
    // It plays faster when it is in trouble, the way a person would.
    this.cooldown = Math.max(6, Math.round(this.reaction * (fill > this.panicAt ? 0.55 : 1)));
  };

  // =========================================================================
  // SEARCH BOT — a genuinely planning opponent.
  //
  // LogicalBoard is a timer-free model of the board (colors + gravity +
  // matching + garbage-clears-on-touch), the JS twin of
  // games/the-game/ai/simulate.py's Board. It's what the search plans
  // against; the real Stack is only ever touched through touchSwap/raise
  // with whatever move the plan settles on, one at a time. Rows/cols stay
  // 1-indexed throughout, same as panel-engine.js's own panels[row][col],
  // so nothing here needs to convert between two conventions.
  // =========================================================================

  // blocks: {id: {cells: [[r,c],...]}} — every garbage cell's id must also
  // appear in `blocks`, and every cell in a block must read -2 in `grid`.
  // A cell of "loose" garbage (no real id, e.g. from comboGarbage before
  // an id was ever assigned) gets its own single-cell block.
  function LogicalBoard(width, height, colors, grid, blocks, nextBlockId) {
    this.width = width;
    this.height = height;
    this.colors = colors;
    this.grid = grid; // grid[row][col], 1..height / 1..width; 0 empty, -1 busy, -2 garbage, >0 color
    this.blocks = blocks || {};
    this._nextBlockId = nextBlockId || 1;
  }

  LogicalBoard.prototype.clone = function () {
    var g = [];
    for (var r = 0; r <= this.height; r++) g[r] = this.grid[r] ? this.grid[r].slice() : [];
    var blocks = {};
    for (var id in this.blocks) if (this.blocks.hasOwnProperty(id)) {
      blocks[id] = { cells: this.blocks[id].cells.map(function (rc) { return [rc[0], rc[1]]; }) };
    }
    return new LogicalBoard(this.width, this.height, this.colors, g, blocks, this._nextBlockId);
  };

  // Lowest row (0 = bottom-most playable row) any garbage cell occupies, or
  // null if there is none. A match that only clears the one real panel
  // propping up an otherwise-unsupported garbage slab drops zero garbage
  // cells directly, but lets the whole slab settle downward on the next
  // gravity pass — this is what lets that "collapse the pillar" move score
  // as progress at all.
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

  LogicalBoard.prototype._findMatches = function () {
    var matched = {}; // "r:c" -> [r, c]
    var r, c, run, i, color;
    for (r = 1; r <= this.height; r++) {
      run = [];
      for (c = 1; c <= this.width + 1; c++) {
        color = c <= this.width ? this.grid[r][c] : 0;
        if (color > 0 && (run.length === 0 || this.grid[r][run[run.length - 1]] === color)) run.push(c);
        else {
          if (run.length >= 3) for (i = 0; i < run.length; i++) matched[r + ":" + run[i]] = [r, run[i]];
          run = color > 0 ? [c] : [];
        }
      }
    }
    for (c = 1; c <= this.width; c++) {
      run = [];
      for (r = 1; r <= this.height + 1; r++) {
        color = r <= this.height ? this.grid[r][c] : 0;
        if (color > 0 && (run.length === 0 || this.grid[run[run.length - 1]][c] === color)) run.push(r);
        else {
          if (run.length >= 3) for (i = 0; i < run.length; i++) matched[run[i] + ":" + c] = [run[i], c];
          run = color > 0 ? [r] : [];
        }
      }
    }
    return matched;
  };

  // A match that touches a garbage cell clears the whole connected garbage
  // block it's part of, not just that one cell — the same shape as the real
  // engine's "any panel in a garbage block matches, the whole block clears"
  // rule (getConnectedGarbagePanels in panel-engine.js), simplified for
  // planning. Without this, incoming garbage is a permanent wall in this
  // model — confirmed the hard way in the Python prototype: it boxed the
  // search agent into unrecoverable, un-clearable positions.
  LogicalBoard.prototype._connectedGarbage = function (matched) {
    var self = this;
    var within = function (r, c) { return r >= 1 && r <= self.height && c >= 1 && c <= self.width; };
    var seen = {};
    var stack = [];
    var k;
    for (k in matched) {
      var rc = matched[k];
      [[rc[0] + 1, rc[1]], [rc[0] - 1, rc[1]], [rc[0], rc[1] + 1], [rc[0], rc[1] - 1]].forEach(function (n) {
        if (within(n[0], n[1]) && self.grid[n[0]][n[1]] === -2) stack.push(n);
      });
    }
    while (stack.length) {
      var n = stack.pop();
      var nk = n[0] + ":" + n[1];
      if (seen[nk]) continue;
      seen[nk] = n;
      [[n[0] + 1, n[1]], [n[0] - 1, n[1]], [n[0], n[1] + 1], [n[0], n[1] - 1]].forEach(function (nn) {
        var nnk = nn[0] + ":" + nn[1];
        if (within(nn[0], nn[1]) && self.grid[nn[0]][nn[1]] === -2 && !seen[nnk]) stack.push(nn);
      });
    }
    return seen;
  };

  // Resolves gravity+matching to a stable state. Returns {chainLength,
  // comboSizes, garbage: [[width,height],...]} — chainLength 0 means the
  // triggering swap matched nothing.
  LogicalBoard.prototype.resolve = function () {
    var chainLength = 0, comboSizes = [], garbage = [];
    this._applyGravity();
    while (true) {
      var matched = this._findMatches();
      var keys = Object.keys(matched);
      if (!keys.length) break;
      chainLength++;
      comboSizes.push(keys.length);
      var cleared = this._connectedGarbage(matched);
      var k;
      for (k in matched) this.grid[matched[k][0]][matched[k][1]] = 0;
      for (k in cleared) this.grid[cleared[k][0]][cleared[k][1]] = 0;
      this._pruneClearedBlocks();
      var pieces = root.PanelEngine.comboGarbage(keys.length);
      for (var i = 0; i < pieces.length; i++) garbage.push([pieces[i], 1]);
      this._applyGravity();
    }
    if (chainLength >= 2) garbage.push([this.width, Math.max(0, chainLength - 1)]);
    return { chainLength: chainLength, comboSizes: comboSizes, garbage: garbage };
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

  // ---- SearchCpu ----

  function SearchCpu(stack, opts) {
    opts = opts || {};
    var preset = DIFFICULTIES[opts.difficulty] || DIFFICULTIES.diamond;
    this.stack = stack;
    this.reaction = opts.reaction || preset.reaction;
    // Faster reaction is a much sharper lever than dangerHeightFrac below,
    // and a much less forgiving one: swept it the same way (stress_harness.js,
    // 8 seeds/config) and it only pays off at the single most punishing
    // level. At level 10 (maxHealth === 1) reaction 12 -> 8 is a clear,
    // repeatable win (93269 -> 119315 total frames alive, 4/8 -> 6/8
    // survived, 1276 -> 1597 garbage sent, 8 seeds). But it's NOT a smooth
    // "faster is always better": the exact same change measurably HURTS at
    // level 8 (maxHealth 21) even with more seeds to rule out noise
    // (136734 -> 128004 frames, 2182 -> 1860 sent, 8 seeds) and badly hurts
    // level 3 like dangerHeightFrac did (28871 -> 15849 frames, 4 seeds) --
    // reacting faster everywhere burns the patience that builds real
    // offense at levels with any margin at all. So this only tightens at
    // the exact level that has none left (maxHealth <= 1, not the wider
    // <= 51 band dangerHeightFrac uses) -- narrower on purpose, because the
    // data doesn't support anything broader yet. Only when the caller
    // didn't explicitly pin a value, same as dangerHeightFrac below.
    if (opts.reaction === undefined && stack && stack.levelData && stack.levelData.maxHealth <= 1) {
      this.reaction = Math.min(this.reaction, 8);
    }
    // BUG (fixed): both branches read preset.X, so a caller's opts.mistake
    // / opts.patience were silently discarded and the preset value used
    // regardless -- e.g. duel_harness.js JSON-config overrides of either
    // never took effect. Cpu (above) has the correct opts.X : preset.X
    // pattern; SearchCpu didn't match it.
    this.mistake = opts.mistake === undefined ? preset.mistake : opts.mistake;
    this.depth = opts.depth || preset.depth;
    this.beam = opts.beam || preset.beam;
    this.patience = opts.patience === undefined ? preset.patience : opts.patience;
    this.patienceFillCeiling = opts.patienceFillCeiling || preset.patienceFillCeiling;
    this.dangerHeightFrac = opts.dangerHeightFrac || preset.dangerHeightFrac;
    // A level with little health buffer (LEVELS' maxHealth crashes from 121
    // at level 1 to 1 at level 10 -- panel-engine.js) leaves almost no room
    // to recover once topped out, no matter how good the search is.
    // Measured via ai/experiments/stress_harness.js: the SAME preset
    // survives 3-4x longer and sends ~2x more garbage at Stack level 8/10
    // when it starts defending at height 0.45 instead of a low-level-tuned
    // 0.72 -- but that same lower threshold measurably HURTS at level 3,
    // where the huge health buffer means panicking early only gives up
    // offense-building time it didn't need. So: tighten based on the
    // ACTUAL level being played (stack.levelData), once maxHealth crosses
    // the point where getting topped out stops being recoverable, rather
    // than a flat number tuned for one level and left to silently apply
    // (badly) everywhere else. Only when the caller didn't explicitly pin
    // a value, so a deliberate override (a tuning sweep, a future weaker
    // character) still wins.
    if (opts.dangerHeightFrac === undefined && stack && stack.levelData && stack.levelData.maxHealth <= 51) {
      this.dangerHeightFrac = Math.min(this.dangerHeightFrac, 0.45);
    }
    this.chainWeight = opts.chainWeight || preset.chainWeight;
    this.comboWeight = opts.comboWeight || preset.comboWeight;
    this.garbageWeight = opts.garbageWeight || preset.garbageWeight;
    this.heightPenalty = opts.heightPenalty || preset.heightPenalty;
    this.potentialWeight = opts.potentialWeight || preset.potentialWeight;
    this.chainExtend = opts.chainExtend !== undefined ? !!opts.chainExtend : preset.chainExtend !== false;
    // The knobs that actually govern behavior once _inDanger() is true —
    // which, at any genuinely heavy sustained rate, is nearly the whole
    // game. reaction/depth/beam/mistake/patience all get overridden or
    // capped once in danger (mistake never fires there, depth caps to 1
    // once critical, cooldown floors regardless of reaction), so tuning
    // "hardest" without touching THESE never changes survival under
    // real pressure — confirmed: nightmare (faster reaction/deeper
    // search, identical values below) measured no better than diamond
    // at a sustained heavy rate.
    this.criticalFactor = opts.criticalFactor !== undefined ? opts.criticalFactor : (preset.criticalFactor !== undefined ? preset.criticalFactor : 0.5);
    this.runwayThreshold = opts.runwayThreshold !== undefined ? opts.runwayThreshold : (preset.runwayThreshold !== undefined ? preset.runwayThreshold : 3);
    this.rescueBranchCap = opts.rescueBranchCap !== undefined ? opts.rescueBranchCap : (preset.rescueBranchCap !== undefined ? preset.rescueBranchCap : 6);
    this.dropAmountWeight = opts.dropAmountWeight !== undefined ? opts.dropAmountWeight : (preset.dropAmountWeight !== undefined ? preset.dropAmountWeight : 200);
    this.pressureThreshold = opts.pressureThreshold !== undefined ? opts.pressureThreshold : (preset.pressureThreshold !== undefined ? preset.pressureThreshold : 15);
    this.sentWeight = opts.sentWeight !== undefined ? opts.sentWeight : (preset.sentWeight !== undefined ? preset.sentWeight : 50);
    this.rng = root.PanelEngine.makeRng(opts.seed || 4242);
    this.cooldown = Math.floor(this.reaction / 2);
    this.raiseFrames = 0;
    this._lastSwap = null;
    this._plan = [];       // queued [row, col] swaps
    this._planGrid = null; // expected grid once the queued moves are consumed up to here
  }

  SearchCpu.prototype._snapshot = function () {
    var stack = this.stack, width = root.PanelEngine.WIDTH;
    var grid = [];
    var blocks = {};
    for (var r = 0; r <= stack.height; r++) {
      grid[r] = [];
      for (var c = 1; c <= width; c++) {
        var p = stack.panelAt(r, c);
        var v;
        if (!p) v = -1;
        else if (p.isGarbage) {
          v = -2;
          var id = "g" + p.garbageId;
          if (!blocks[id]) blocks[id] = { cells: [] };
          blocks[id].cells.push([r, c]);
        }
        else if (p.color === 0) v = 0;
        else if (p.state !== "normal" && p.state !== "landing") v = -1;
        else v = p.color;
        grid[r][c] = v;
      }
    }
    return new LogicalBoard(width, stack.height, this.stack.colors, grid, blocks);
  };

  // ---- manual chain extension ----
  //
  // The single biggest source of garbage in this game is a long CHAIN: a
  // chain of length N sends (N-1) full-width rows — 6 cells per extra
  // link, uncapped — while even a +8 combo sends only 7. And the way real
  // players build long chains is not planning the whole thing in advance:
  // it's MID-CASCADE play. When a match pops, every panel above it hovers
  // (carrying the `chaining` flag, panel-engine.js enterHoverFromNormal),
  // then falls; if it lands into a new match the chain extends. The
  // cleared bottom row of a garbage block converts to chaining panels
  // too. So while a pop is animating there is a ~60-100 frame window
  // (FLASH + FACE + POP*n, then HOVER) to rearrange the STABLE panels
  // underneath so the falling ones land into a match — extending the
  // chain by another link, opening another window, repeat.
  //
  // The planner can't see any of this because _snapshot marks every
  // non-normal panel as busy (-1): mid-cascade, the board it reasons
  // about is missing exactly the panels that matter. These two methods
  // close that gap, using only information a human also has (every
  // hovering/falling panel's color is visible on screen):
  //
  // _cascadePrediction builds the board as it will be AFTER the cascade
  // settles: popping panels vanish, in-flight panels drop straight down
  // their columns (per-column order is preserved, so the k panels that
  // fall in a column land as that column's top k real panels), garbage
  // blocks re-settle via the same block gravity the model already has.
  // Cells that will land carrying the chain flag are marked.
  //
  // _chainExtendMove then searches one swap among panels that are
  // swappable RIGHT NOW, in the still-stable region below the
  // disturbance, such that on the settled board a match forms that
  // includes at least one chain-flagged cell — i.e. a swap made during
  // the pop that catches the falling panels into the next link.
  SearchCpu.prototype._cascadePrediction = function () {
    var stack = this.stack, width = root.PanelEngine.WIDTH;
    var grid = [], blocks = {};
    var anyInFlight = false;
    // per column: list of {color, chain} for real panels bottom->top, and
    // the lowest disturbed row (below which the column is stable ground)
    var disturbLow = [];
    var colReal = [];
    var r, c, p;

    for (c = 1; c <= width; c++) { disturbLow[c] = stack.height + 1; colReal[c] = []; }
    for (r = 0; r <= stack.height; r++) grid[r] = [];

    for (c = 1; c <= width; c++) {
      var sawDisturb = false;
      for (r = 1; r <= stack.height; r++) {
        p = stack.panelAt(r, c);
        grid[r][c] = 0;
        if (!p) continue;
        if (p.isGarbage) {
          if (p.state === "matched" && p.yOffset === -1) {
            // bottom row of a clearing garbage block: becomes a real
            // chaining panel, but its color isn't decided until it
            // converts — occupies space, can't be planned into.
            colReal[c].push({ color: -1, chain: false });
            if (!sawDisturb) { sawDisturb = true; disturbLow[c] = r; }
            anyInFlight = true;
          } else {
            var id = "g" + p.garbageId;
            if (!blocks[id]) blocks[id] = { cells: [] };
            blocks[id].cells.push([r, c]);
            grid[r][c] = -2;
          }
          continue;
        }
        if (p.color === 0) continue;
        if (p.state === "matched" || p.state === "popping") {
          // vanishing — occupies no cell afterwards
          if (!sawDisturb) { sawDisturb = true; disturbLow[c] = r; }
          anyInFlight = true;
          continue;
        }
        if (p.state === "hovering" || p.state === "falling") {
          colReal[c].push({ color: p.color, chain: !!p.chaining });
          if (!sawDisturb) { sawDisturb = true; disturbLow[c] = r; }
          anyInFlight = true;
          continue;
        }
        // normal / landing / swapping: part of the column as it stands.
        // Above a disturbance it will fall — carrying the chain flag,
        // since enterHoverFromNormal sets chaining on everything that
        // hovers above a cleared cell. Below any disturbance it only
        // chains if it already carries the flag.
        colReal[c].push({ color: p.color, chain: sawDisturb || !!p.chaining });
      }
    }
    if (!anyInFlight) return null;

    // Lay each column's surviving real panels back down bottom-up around
    // the garbage blocks, then let block gravity settle the rest.
    for (c = 1; c <= width; c++) {
      var stackIdx = 0;
      for (r = 1; r <= stack.height && stackIdx < colReal[c].length; r++) {
        if (grid[r][c] === -2) continue;
        grid[r][c] = colReal[c][stackIdx].color === -1 ? -1 : colReal[c][stackIdx].color;
        stackIdx++;
      }
    }
    var predicted = new LogicalBoard(width, stack.height, stack.colors, grid, blocks);
    predicted._applyGravity();

    // Mark chain-flagged cells: per column, order among real panels is
    // preserved through the compaction above and through gravity, so the
    // i-th real panel from the bottom after settling is colReal[c][i].
    var chainMarks = {};
    for (c = 1; c <= width; c++) {
      var idx = 0;
      for (r = 1; r <= stack.height && idx < colReal[c].length; r++) {
        var v = predicted.grid[r][c];
        if (v === -2 || v === 0) continue;
        if (colReal[c][idx].chain) chainMarks[r + ":" + c] = true;
        idx++;
      }
    }
    return { predicted: predicted, chainMarks: chainMarks, disturbLow: disturbLow };
  };

  // A decaying average of incoming attack volume — the AI's read on "is
  // this opponent a firehose or an occasional slab," built from the same
  // telegraph a human watches. Sampled every update(): add the cells of
  // any newly queued incoming garbage, decay by 0.999/frame (~11.5s
  // half-life — deliberately slow, because the average sawtooths between
  // attacks and the trough must not dip under the threshold at rates
  // that should stay blocked; at 0.998 it did, and a mixed ~1.2
  // cells/sec smoke lost a seed through exactly that dip). Steady-state
  // ranges: 4 cells every 6s (the strongest real opponent's peak)
  // oscillates ~9-13; ~1.2 cells/sec mixed widths ~18-22; 6 cells every
  // 1.5s ~50+. The threshold of 15 sits between the first two with
  // margin on both sides.
  // Starts PESSIMISTIC (30, over the threshold) rather than at zero:
  // the opponent is assumed dangerous until ~40 quiet seconds prove
  // otherwise. Started at zero, a genuinely dangerous rate takes ~20s
  // of ramp-up before the average crosses the threshold, and that
  // window is exactly when extensions fired and set up a death the
  // fully-gated code avoids (one smoke seed died at 24s through it,
  // reproducibly, at both decay constants tried).
  SearchCpu.prototype._samplePressure = function () {
    var stack = this.stack, cells = 0;
    for (var i = 0; i < stack.incoming.length; i++) {
      var g = stack.incoming[i];
      if (!g._pressureCounted) { g._pressureCounted = true; cells += g.width * g.height; }
    }
    if (this._pressure === undefined) this._pressure = 30;
    this._pressure = this._pressure * 0.999 + cells;
    return this._pressure;
  };

  // How many garbage cells are sitting on the real stack right now.
  SearchCpu.prototype._stackGarbageCells = function () {
    var stack = this.stack, width = root.PanelEngine.WIDTH, n = 0;
    for (var r = 1; r <= stack.height; r++) {
      for (var c = 1; c <= width; c++) {
        var p = stack.panelAt(r, c);
        if (p && p.isGarbage) n++;
      }
    }
    return n;
  };

  SearchCpu.prototype._chainExtendMove = function (requireGarbage) {
    var info = this._cascadePrediction();
    if (!info) return null;
    var stack = this.stack, width = root.PanelEngine.WIDTH;
    var predicted = info.predicted, chainMarks = info.chainMarks, disturbLow = info.disturbLow;
    var garbageBefore = garbageCellCount(predicted);
    var best = null, bestScore = null;

    for (var r = 1; r <= stack.height; r++) {
      for (var c = 1; c < width; c++) {
        // both cells must be swappable NOW and in the stable region, so
        // their predicted positions are their current positions
        if (r >= disturbLow[c] || r >= disturbLow[c + 1]) continue;
        if (!stack.canSwap(r, c)) continue;
        var a = predicted.grid[r] ? predicted.grid[r][c] : 0;
        var b = predicted.grid[r] ? predicted.grid[r][c + 1] : 0;
        if (a <= 0 && b <= 0) continue;
        if (a === b) continue;
        var pa = stack.panelAt(r, c), pb = stack.panelAt(r, c + 1);
        if (!pa || !pb) continue;
        var okA = pa.color === 0 || pa.state === "normal" || pa.state === "landing";
        var okB = pb.color === 0 || pb.state === "normal" || pb.state === "landing";
        if (!okA || !okB) continue;

        var trial = predicted.clone();
        trial.swap(r, c);
        var matched = trial._findMatches();
        var touchesChain = false, size = 0, k;
        for (k in matched) {
          size++;
          if (chainMarks[k]) touchesChain = true;
        }
        if (!touchesChain) continue;
        // full value of the link: resolve for garbage-adjacency + cascades
        var res = trial.resolve();
        var gCleared = garbageBefore - garbageCellCount(trial);
        if (requireGarbage && gCleared === 0) continue;
        var score = size * 10 + res.chainLength * 100 + gCleared * 1000 + garbageCells(res.garbage);
        if (bestScore === null || score > bestScore) { bestScore = score; best = [r, c]; }
      }
    }
    return best;
  };

  SearchCpu.prototype._evaluate = function (board, cumGarbage, cumChain, cumCombo) {
    var danger = Math.max(0, board.maxHeight() - board.height * this.dangerHeightFrac);
    return cumGarbage * this.garbageWeight + cumChain * this.chainWeight + cumCombo * this.comboWeight
      + boardPotential(board) * this.potentialWeight - danger * danger * this.heightPenalty;
  };

  SearchCpu.prototype._inDanger = function (board) {
    return board.maxHeight() >= board.height * this.dangerHeightFrac;
  };

  // Shared scoring for every defensive-search tier: garbage cleared always
  // wins first (that's the actual wall closing in), then chain length —
  // weighted MUCH harder once the board is already topped out, mirroring
  // Stack:awardStopTime's own dangerConstant/dangerCoefficient bonus,
  // which pays out far more for a chain specifically while wasToppedOut
  // than the same chain gets otherwise. That stop time doesn't stop
  // garbage from landing, but it DOES pause the health-drain clock that
  // is the actual killer once physically topped out — so once there,
  // finding even a small chain over a same-size non-chain combo is the
  // single highest-leverage thing this search can do.
  SearchCpu.prototype._defensiveKey = function (res, garbageCleared, dropAmount, toppedOutNow) {
    var comboSum = 0, bigComboBonus = 0, i;
    for (i = 0; i < res.comboSizes.length; i++) {
      comboSum += res.comboSizes[i];
      // A combo of 4+ panels sends real garbage to an opponent
      // (comboGarbage in panel-engine.js) and clears far more of THIS
      // board per move than a bare 3-match — reward it superlinearly so
      // the search actually prefers setting one up over grabbing the
      // first plain triple it sees, instead of only ever breaking even
      // by coincidence.
      if (res.comboSizes[i] >= 4) bigComboBonus += res.comboSizes[i] * res.comboSizes[i] * 300;
    }
    // Garbage-cleared stays the dominant term always — it is what most
    // directly shrinks the actual danger. The chain bonus is a much
    // smaller secondary term: it can't make this pick a move that clears
    // less garbage, but it decisively breaks ties toward whichever
    // similarly-good option also chains, for the stop-time payout.
    var chainBonus = toppedOutNow && res.chainLength >= 2
      ? res.chainLength * res.chainLength * 5000
      : res.chainLength * 1000;
    // "Collapse the pillar": clearing the one real panel propping up an
    // otherwise-unsupported garbage slab clears zero garbage cells this
    // move, but the whole slab settles toward the floor on the very next
    // gravity pass (supportedFromBelow in panel-engine.js — a slab needs
    // only ONE supported column anywhere under its width to stay put).
    // Rewards that settling directly instead of only rewarding it once it
    // happens to also clear a cell, so a move can be worth taking purely
    // for what it sets up.
    //
    // Weight is 200, not games/the-game/ai/agents.py's 20000 — that value
    // was tuned in simulate.py's simplified model, which has no auto-rise
    // (newRow()) at all. Against the real Stack (stress_harness.js, which
    // does), 20000 let a bigger-drop-but-smaller-clear move regularly
    // outrank a smaller-drop move that actually chained, which cost
    // moderate-rate survival (measured: 5/12 -> 2/12 seeds surviving 60s)
    // for a gain only at the harder rates. 200 keeps this a tiebreaker —
    // it can't outweigh a real chain/combo difference — and measured
    // clean at every rate: heavy 1/12 -> 4/12, relentless 0/12 -> 3/12,
    // moderate unchanged in total survival time (avgFrames 2487 -> 2493,
    // same seeds crossing/not-crossing the 60s cutoff by chance either way).
    // What this move actually SENDS (comboGarbage(comboSize) per combo,
    // plus a chainLength-1 full-width row for a chain of 2+ — the same
    // rules panel-engine.js's own resolve()/checkMatches use) was never
    // scored directly before this — only proxied through chainBonus and
    // bigComboBonus, which correlate with it but aren't it: two moves
    // tied on chain length and combo size can still differ in raw
    // outgoing cells (e.g. one move's chain links are all combos of 4,
    // the other's are all bare 3-matches — same chainBonus, very
    // different comboGarbage output). Weighted well under the chain/
    // combo terms so it only breaks ties between otherwise-similar
    // defensive options toward whichever one ALSO attacks harder — it
    // can't make this pick a worse defensive move for more offense.
    // Weight (default/preset 5000, swept 0-100000 in 14-seed head-to-head
    // batches at the heavy stress rate): 0-8000 all land on the same,
    // strictly-better-than-off result (heavy: 583 -> 622 total cells
    // sent across 14 seeds, ~+7%, survival time unchanged); above ~9000
    // it starts occasionally overriding chainBonus/bigComboBonus on
    // ties and total sent actually drops back down (603). 5000 sits in
    // the middle of the flat plateau rather than at its edge.
    var sentCells = garbageCells(res.garbage);
    return garbageCleared * 1000000 + chainBonus + bigComboBonus + dropAmount * this.dropAmountWeight + sentCells * this.sentWeight + comboSum;
  };

  function dropAmountFor(lowestBefore, lowestAfter) {
    if (lowestBefore === null) return 0;
    if (lowestAfter === null) return lowestBefore;
    return Math.max(0, lowestBefore - lowestAfter);
  }

  // Beam search a few swaps deep, scored by _defensiveKey, keeping the
  // best-scoring outcome found ANYWHERE in the tree — not the first match
  // it trips over. Grabbing the first available 3-match (the old
  // behaviour: check 1 ply, take whatever matched) is how it kept
  // clearing single panels while leaving a same-color setup for a 4+
  // combo or a chain sitting one swap further away unexplored. Unmatched
  // branches still advance (ranked by `potential`, same signal the
  // offensive planner uses) so a first move that only SETS UP next
  // move's clear is still found. Raises while tall ONLY when starved of
  // real-panel material (see runwayHeight below) — every other path
  // never raises while tall, since raising can only make the danger
  // worse otherwise. That's the actual guarantee behind "shouldn't be
  // able to die," not a hope the scoring weights happen to produce.
  SearchCpu.prototype._bestDefensiveMove = function (board) {
    var self = this;
    var garbageBefore = garbageCellCount(board);
    var lowestBefore = board.lowestGarbageRow();
    var toppedOutNow = board.maxHeight() >= board.height;
    // Same beam width as the offensive planner (this.beam) — already
    // tuned to stay well inside a frame budget at this preset; an
    // independent, wider search here blew well past it (measured ~500ms
    // worst case at beam 8/depth 3, versus a 6-frame/~100ms cooldown
    // budget).
    var beamWidth = this.beam;
    // How close to topping out before this stops gambling a whole
    // decision cycle on a non-matching setup swap in the hope of a
    // bigger combo further out, and just takes whatever it can clear
    // RIGHT NOW instead — by capping the search to depth 1 (exhaustive,
    // still cheap) rather than this.depth. Critically, this has to be
    // decided BEFORE the search runs, not just by breaking early once
    // ply 0 finds something: an earlier version only broke early on a
    // ply-0 match, which meant that whenever ply 0 found NO match, a
    // beam-limited ply 1 still ran even while critical, and taking
    // whatever mediocre match it stumbled onto that way (instead of
    // falling straight through to the potential-gain fallback, like the
    // pre-big-block code did) measured WORSE than never searching deeper
    // at all — confirmed by isolating it: forcing depth 1 in every way
    // BUT this one still reproduced the regression exactly.
    //
    // With the depth cap actually gating the search (not just the
    // break-early check above it), the trade-off mostly disappears: 20
    // seeds/rate, 60s cap, real engine — light unaffected (20/20 both);
    // moderate 4/20 -> 9/20; heavy 6/20 -> 5/20; relentless 4/20 -> 4/20.
    // Heavy/relentless land within noise of the pre-big-block baseline
    // instead of roughly halved, while moderate keeps its full gain and
    // avgGarbageCleared/avgMatches are up at every rate — which is the
    // actual "not breaking garbage, not making big blocks" complaint
    // this was built to fix.
    var criticalFrac = this.dangerHeightFrac + (1 - this.dangerHeightFrac) * this.criticalFactor;
    var critical = board.fillRatio() >= criticalFrac;
    var maxDepth = critical ? 1 : this.depth;

    function keyFor(trial, res) {
      var garbageCleared = garbageBefore - garbageCellCount(trial);
      var dropAmount = dropAmountFor(lowestBefore, trial.lowestGarbageRow());
      return self._defensiveKey(res, garbageCleared, dropAmount, toppedOutNow);
    }

    var frontier = [{ board: board, move: null }];
    var best = null, bestKey = null, bestClearsGarbage = false;
    for (var ply = 0; ply < maxDepth; ply++) {
      var candidates = [];
      for (var f = 0; f < frontier.length; f++) {
        var node = frontier[f];
        var swaps = node.board.legalSwaps();
        for (var i = 0; i < swaps.length; i++) {
          var r = swaps[i][0], c = swaps[i][1];
          var trial = node.board.clone();
          trial.swap(r, c);
          var res = trial.resolve();
          var move = node.move || [r, c];
          var matched = res.chainLength > 0;
          var garbageCleared = matched ? garbageBefore - garbageCellCount(trial) : 0;
          var ev = matched ? keyFor(trial, res) : boardPotential(trial);
          if (matched && (bestKey === null || ev > bestKey)) {
            bestKey = ev; best = move; bestClearsGarbage = garbageCleared > 0;
          }
          candidates.push({ board: trial, move: move, ev: ev });
        }
      }
      // Take it now rather than gambling a whole decision cycle on
      // something bigger, whenever either: the board is critically
      // close to topping out, or the immediate move already clears
      // garbage. The garbage-clearing case matters even when not
      // critical — this only runs while _inDanger() is already true, so
      // an available garbage-clearing swap is exactly the thing this
      // mode exists to take; searching deeper for a bigger REAL-panel
      // combo instead measured worse at the two hardest attack rates
      // (see the commit message), because the deeper "plan" assumes a
      // board state that a fresh wave of incoming garbage can invalidate
      // before its second move ever gets played. A ply-0 match that
      // ONLY clears real panels (no garbage touched) still gets the
      // deeper search, since there's nothing time-sensitive to protect
      // by taking it immediately.
      if (ply === 0 && best && (critical || bestClearsGarbage)) break;
      if (!candidates.length) break;
      candidates.sort(function (a, b) { return b.ev - a.ev; });
      frontier = candidates.slice(0, beamWidth);
    }
    // A match that clears real panels WITHOUT touching garbage doesn't
    // just fail to help — it actively burns the one resource that
    // rebuilds a match at all (runwayHeight — see its own comment).
    // Matched panels are gone for good; only a fresh row from raising
    // (or the slow automatic rise) puts more real panels in play. Once
    // that runway is down to a couple of rows, taking a junk match
    // anyway (or endlessly REARRANGING the same dwindling scraps via the
    // potential-gain fallback below, which is just as much a dead end)
    // is how the AI kept starving itself: matchEvents in the single
    // digits and garbageCellsCleared stuck at 0 for an entire game,
    // right up until there was nothing left to swap at all. A good
    // player's actual rule: don't burn below ~3 rows of real panels —
    // either clear garbage or raise instead. This applies even while
    // critical (close to topping out): with the runway this thin,
    // refusing to raise doesn't actually make things safer, since
    // there's no material left to defend with anyway — confirmed
    // measuring it gated to !critical only first, which left the fastest
    // deaths (garbageCellsCleared stuck at 0, dying in ~18s) completely
    // unchanged, because those are exactly the boards that hit critical
    // almost immediately.
    //
    // Measured against the real engine (20 seeds/rate, 60s cap): light
    // unaffected; moderate 9/20 -> 14/20 survived, avgGarbageCleared
    // 61 -> 86; heavy survival count flat at 5/20 but avgFrames 2126 ->
    // 2460 and avgGarbageCleared 54 -> 73 (worst-case instant deaths
    // mostly gone — fewer seeds dying at ~18s with 0 garbage cleared);
    // relentless dipped slightly (4/20 -> 3/20) — at that rate even a
    // ~0.3s raise can cost more than it buys back. Net a clear win at
    // every rate that has any slack at all, and roughly a wash at the
    // one rate that doesn't.
    // ...with one hard exception: NEVER ask for a raise within ONE ROW of
    // the very top, not just already AT it. First found this needing a
    // margin of exactly 0 (a probe of a real death: width-1 garbage had
    // stacked one column to full height, the runway guard force-raised
    // straight into game over instead of spreading the tower sideways,
    // which its own fallbacks already do). That fix wasn't enough on its
    // own: newRow() (panel-engine.js) re-indexes every existing panel's
    // row by +1 when a raise delivers its row — so raising at maxHeight
    // === height-1 tops the board out MECHANICALLY, from the raise's own
    // action, with no new incoming garbage required at all. Confirmed via
    // a second real death this margin closes: the AI decided to raise at
    // maxHeight 11 of 12 (a board that looked perfectly safe), and died
    // two frames later once that raise's own row delivery pushed it over.
    var SAFE_RAISE_MARGIN = 1;
    var runwayLow = board.runwayHeight() < this.runwayThreshold && board.maxHeight() < board.height - SAFE_RAISE_MARGIN;
    if (best) {
      if (!bestClearsGarbage && runwayLow) return null;
      return best;
    }
    if (runwayLow) return null;

    var swaps0 = board.legalSwaps();
    var base = boardPotential(board), bestGain = null, gainMove = null;
    for (var j = 0; j < swaps0.length; j++) {
      var r2 = swaps0[j][0], c2 = swaps0[j][1];
      var trial2 = board.clone();
      trial2.swap(r2, c2);
      var gain = boardPotential(trial2) - base;
      if (bestGain === null || gain > bestGain) { bestGain = gain; gainMove = [r2, c2]; }
    }
    if (gainMove && bestGain > 0) return gainMove;

    // True last resort: an exhaustive (not beam-pruned) search, in case
    // the beam above pruned away the only branch that ever finds
    // anything. Rare — the beam search already covers the same depths —
    // but it is the actual backstop behind "never dies to a search that
    // gave up too early."
    var rescue = this._nPlyRescue(board, 2) || this._nPlyRescue(board, 3) || this._nPlyRescue(board, 4);
    if (rescue) return rescue;
    if (gainMove) return gainMove;

    // NEVER GO IDLE WHILE TOPPED OUT. This is the single highest-leverage
    // rule in the whole file, discovered from the real death condition,
    // not from tuning: Stack.checkGameOver (panel-engine.js) has exactly
    // two ways to lose — health hitting 0, or holding raise into an
    // already-topped-out board — and health ONLY decrements via
    // advancePassiveRaise's toppedOut branch, which is gated behind
    // `!riseLock && stopTime === 0`. riseLock is true whenever a swap is
    // queued, a match is resolving, or the board is shaking
    // (updateRiseLock). So a topped-out board that is NEVER fully idle —
    // always has some swap in flight — can NEVER have its health
    // decremented, no matter how much garbage is physically sitting on
    // it. Confirmed directly: a bare loop that swaps literally anything
    // every 5 frames, doing no matching or clearing at all, held health
    // at its exact starting value through 90+ continuous seconds topped
    // out at the heavy synthetic rate (0/12 seeds ever survived
    // previously) — it only died once garbage physically buried every
    // real panel and there was nothing left to swap at all. That is the
    // OTHER half: this needs the clearing logic above it to keep real
    // material flowing, or "never idle" alone just delays the same
    // ending. Previously, this exact gap (no match, no potential gain,
    // no rescue) fell through to raise — which is not just a missed
    // chance to stay alive, it is checkGameOver's OTHER death condition
    // the instant it isn't riseLocked (or, within SAFE_RAISE_MARGIN of
    // the top, one row from being that condition — see its own comment
    // above). _anyLegalSwap trades a random legal swap for that
    // guaranteed-or-imminent loss whenever one exists.
    if (board.maxHeight() >= board.height - SAFE_RAISE_MARGIN) {
      var stall = this._anyLegalSwap(board);
      if (stall) return stall;
    }
    return null; // null means "raise" to the caller — only reached with real margin AND zero legal swaps otherwise
  };

  // Any legal swap at all, for the "never go idle while topped out"
  // last resort above — preferring one that differs from the last swap
  // made, so two consecutive stall moves don't hit the real engine's
  // swap-stalling punish (Stack.applySwapStalling) on the exact same
  // (row, col) back to back. That check tracks every DISTINCT position
  // used during a continuous topped-out-idle streak and only resets on
  // a genuinely non-stalling swap (panel-engine.js's own comment: "any
  // non-stalling swap resets the log") — which any real match this
  // search finds already provides, so varying position is what buys
  // room between those resets rather than exhausting the backlog first.
  //
  // Checks the REAL stack's canSwap, not board.legalSwaps() — this is
  // the one place that mismatch is actively dangerous rather than just
  // suboptimal. LogicalBoard's model of "swappable" is simpler than
  // Stack.canSwap's: it has no idea a panel is unswappable because the
  // panel ABOVE it is hovering ("can't pull a panel out from under a
  // hovering one" — canSwap's own comment), among other real-time
  // details it never tracked. A move the search proposes without that
  // knowledge FAILS SILENTLY: touchSwap's return value was never
  // checked anywhere in this file, so the AI believed it had acted,
  // set its cooldown as if it had, and the board sat genuinely idle
  // for the whole cooldown window instead. Confirmed as the actual
  // cause of a real death: instrumenting touchSwap directly showed it
  // returning false right as health was draining toward 0, at a moment
  // _bestDefensiveMove had returned what LogicalBoard considered a
  // perfectly legal move. Scanning the real stack directly for this
  // one safety-critical fallback makes that failure mode structurally
  // impossible here, whatever LogicalBoard does or doesn't model next.
  SearchCpu.prototype._anyLegalSwap = function (board) {
    var stack = this.stack, width = root.PanelEngine.WIDTH;
    var fallback = null;
    for (var r = 1; r <= stack.height; r++) {
      for (var c = 1; c < width; c++) {
        if (!stack.canSwap(r, c)) continue;
        if (!this._lastSwap || this._lastSwap[0] !== r || this._lastSwap[1] !== c) return [r, c];
        if (!fallback) fallback = [r, c];
      }
    }
    return fallback; // only the exact last swap was ever legal -- take it anyway
  };

  // Exhaustive at each level's immediate swaps (cheap: legalSwaps() is at
  // most a few dozen), but caps how many unmatched branches it recurses
  // into via this.rescueBranchCap (default 6). Without a cap this is
  // legalSwaps^depth — measured 16-17 legal swaps at depth 4 taking
  // 450-550ms per call, well past the 6-frame (~100ms) decision budget,
  // and mostly finding nothing anyway. Ranking unmatched branches by
  // `potential` before capping keeps the search pointed at the same
  // promising continuations a wider, uncapped search would have found.
  SearchCpu.prototype._nPlyRescue = function (board, depth) {
    var self = this;
    var best = null, bestKey = null;
    var garbageBefore = garbageCellCount(board);
    var lowestBefore = board.lowestGarbageRow();
    var toppedOutNow = board.maxHeight() >= board.height;
    var walk = function (trial, firstMove, remaining) {
      var swaps = trial.legalSwaps();
      var unmatched = [];
      for (var i = 0; i < swaps.length; i++) {
        var r = swaps[i][0], c = swaps[i][1];
        var step = trial.clone();
        step.swap(r, c);
        var move = firstMove || [r, c];
        var res = step.resolve();
        if (res.chainLength > 0) {
          var garbageCleared = garbageBefore - garbageCellCount(step);
          var dropAmount = dropAmountFor(lowestBefore, step.lowestGarbageRow());
          var key = self._defensiveKey(res, garbageCleared, dropAmount, toppedOutNow);
          if (bestKey === null || key > bestKey) { bestKey = key; best = move; }
          continue;
        }
        if (remaining > 1) unmatched.push({ step: step, move: move, pot: boardPotential(step) });
      }
      if (remaining > 1 && unmatched.length) {
        unmatched.sort(function (a, b) { return b.pot - a.pot; });
        var capped = unmatched.slice(0, self.rescueBranchCap);
        for (var j = 0; j < capped.length; j++) walk(capped[j].step, capped[j].move, remaining - 1);
      }
    };
    walk(board, null, depth);
    return best;
  };

  // Best swap that matches something right now, plus how big that match
  // is — the caller decides whether it's worth holding out for bigger.
  SearchCpu.prototype._bestImmediateMatch = function (board) {
    var swaps = board.legalSwaps(), best = null, bestScore = null, bestInfo = null;
    for (var i = 0; i < swaps.length; i++) {
      var r = swaps[i][0], c = swaps[i][1];
      var trial = board.clone();
      trial.swap(r, c);
      var res = trial.resolve();
      if (res.chainLength === 0) continue;
      var gTotal = garbageCells(res.garbage);
      var chainBonus = res.chainLength >= 2 ? res.chainLength * res.chainLength : 0;
      var comboBonus = 0;
      for (var j = 0; j < res.comboSizes.length; j++) if (res.comboSizes[j] >= 4) comboBonus += res.comboSizes[j];
      // one extra ply: does this leave an obvious follow-up match behind?
      var followUp = 0, swaps2 = trial.legalSwaps();
      for (var k = 0; k < swaps2.length; k++) {
        var follow = trial.clone();
        follow.swap(swaps2[k][0], swaps2[k][1]);
        var fres = follow.resolve();
        if (fres.chainLength > 0) {
          var fSum = fres.comboSizes.reduce(function (a, b) { return a + b; }, 0);
          followUp = Math.max(followUp, garbageCells(fres.garbage) * this.garbageWeight
            + fres.chainLength * fres.chainLength * this.chainWeight * 0.5);
        }
      }
      var ev = this._evaluate(trial, gTotal, chainBonus, comboBonus) + followUp;
      if (bestScore === null || ev > bestScore) {
        bestScore = ev; best = [r, c];
        bestInfo = { chainLength: res.chainLength, comboSize: Math.max.apply(null, res.comboSizes.concat([0])) };
      }
    }
    if (!best) return null;
    return { move: best, chainLength: bestInfo.chainLength, comboSize: bestInfo.comboSize };
  };

  // Beam search over several plies of SWAPS ONLY (never raise inside a
  // plan — a raise reveals real new panels the plan couldn't have known
  // about, so committing to moves past one would be planning against
  // colors this bot was never shown). Looks for the sequence that
  // cascades into the biggest chain/combo; returns null if nothing in
  // the whole tree ever matched.
  SearchCpu.prototype._computePlan = function (board) {
    var frontier = [{ board: board, moves: [], g: 0, chain: 0, combo: 0 }];
    var bestPlan = null, bestPlanScore = null;
    for (var ply = 0; ply < this.depth; ply++) {
      var candidates = [];
      for (var f = 0; f < frontier.length; f++) {
        var node = frontier[f];
        var swaps = node.board.legalSwaps();
        for (var i = 0; i < swaps.length; i++) {
          var r = swaps[i][0], c = swaps[i][1];
          var trial = node.board.clone();
          trial.swap(r, c);
          var res = trial.resolve();
          var chainBonus = res.chainLength >= 2 ? res.chainLength * res.chainLength : 0;
          var comboBonus = 0;
          for (var j = 0; j < res.comboSizes.length; j++) if (res.comboSizes[j] >= 4) comboBonus += res.comboSizes[j];
          var newMoves = node.moves.concat([[r, c]]);
          var gTotal = node.g + garbageCells(res.garbage);
          var chainTotal = node.chain + chainBonus;
          var comboTotal = node.combo + comboBonus;
          var ev = this._evaluate(trial, gTotal, chainTotal, comboTotal);
          candidates.push({ ev: ev, board: trial, moves: newMoves, g: gTotal, chain: chainTotal, combo: comboTotal, matched: res.chainLength > 0 });
        }
      }
      if (!candidates.length) break;
      candidates.sort(function (a, b) { return b.ev - a.ev; });
      var top = candidates.slice(0, this.beam);
      for (var t = 0; t < top.length; t++) {
        if (top[t].matched && (bestPlanScore === null || top[t].ev > bestPlanScore)) {
          bestPlanScore = top[t].ev;
          bestPlan = { moves: top[t].moves, chain: top[t].chain, combo: top[t].combo };
        }
      }
      frontier = top;
    }
    if (!bestPlan) return null;
    var gridAfterFirst = board.grid.map(function (row) { return row.slice(); });
    var fr = bestPlan.moves[0][0], fc = bestPlan.moves[0][1];
    var tmp = gridAfterFirst[fr][fc];
    gridAfterFirst[fr][fc] = gridAfterFirst[fr][fc + 1];
    gridAfterFirst[fr][fc + 1] = tmp;
    return { moves: bestPlan.moves, chainBonus: bestPlan.chain, comboBonus: bestPlan.combo, gridAfterFirst: gridAfterFirst };
  };

  SearchCpu.prototype._raiseOrBuild = function (board) {
    var swaps = board.legalSwaps(), base = boardPotential(board), bestGain = null, best = null;
    for (var i = 0; i < swaps.length; i++) {
      var r = swaps[i][0], c = swaps[i][1];
      var trial = board.clone();
      trial.swap(r, c);
      var gain = boardPotential(trial) - base;
      if (bestGain === null || gain > bestGain) { bestGain = gain; best = [r, c]; }
    }
    if (best && bestGain > 0) return { kind: "swap", move: best };
    return { kind: "raise" };
  };

  // Returns {kind:"swap", move:[row,col]} or {kind:"raise"}.
  SearchCpu.prototype._choose = function (board) {
    if (this._inDanger(board)) {
      this._plan = [];
      var defense = this._bestDefensiveMove(board);
      return defense ? { kind: "swap", move: defense } : { kind: "raise" };
    }

    var found = this._bestImmediateMatch(board);
    if (found && (found.chainLength >= 2 || found.comboSize >= 4)) {
      this._plan = [];
      return { kind: "swap", move: found.move };
    }

    if (this._plan.length && sameGrid(this._planGrid, board.grid)) {
      var next = this._plan.shift();
      var t = this._planGrid[next[0]][next[1]];
      this._planGrid[next[0]][next[1]] = this._planGrid[next[0]][next[1] + 1];
      this._planGrid[next[0]][next[1] + 1] = t;
      return { kind: "swap", move: next };
    }
    this._plan = [];

    var plan = this._computePlan(board);
    if (plan) {
      var worthIt = plan.chainBonus > 0 || plan.comboBonus > 0;
      var safeToHold = board.fillRatio() < this.patienceFillCeiling;
      var shouldCommit = worthIt && (!found || (safeToHold && this.rng() < this.patience));
      if (shouldCommit) {
        this._plan = plan.moves.slice(1);
        this._planGrid = plan.gridAfterFirst;
        return { kind: "swap", move: plan.moves[0] };
      }
    }

    if (found) return { kind: "swap", move: found.move };
    return this._raiseOrBuild(board);
  };

  function sameGrid(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var r = 0; r < a.length; r++) {
      if (!a[r] || !b[r] || a[r].length !== b[r].length) return false;
      for (var c = 0; c < a[r].length; c++) if (a[r][c] !== b[r][c]) return false;
    }
    return true;
  }

  SearchCpu.prototype.update = function () {
    var stack = this.stack;
    if (stack.gameOver) return;

    var pressure = this._samplePressure(); // every frame, so the decay is honest

    if (this.raiseFrames > 0) {
      this.raiseFrames--;
      stack.setInput({ raise: true });
    } else {
      stack.setInput({});
    }

    if (this.cooldown > 0) { this.cooldown--; return; }

    // Chain extension outranks everything else while conditions allow:
    // a cascade is mid-air RIGHT NOW, and a swap that catches it extends
    // the chain — another full-width row sent per link, plus the
    // engine's biggest stop-time payouts. The window closes when the
    // panels land, so this can't wait a full reaction; cooldown drops to
    // the floor to get a look at the NEXT link's window too.
    //
    // "While conditions allow" carries four gates, each one bought with
    // a measured failure:
    //   - pressure < 15 (the decaying attack-volume average above):
    //     against a firehose opponent, every decision cycle belongs to
    //     defense — ungated extension turned heavy-rate survival from
    //     5/20 seeds to 0/20, and every instantaneous version of this
    //     signal (incoming non-empty, backlog size) either failed to
    //     protect heavy or blocked extension during every attack's
    //     ~2.5s flight even against a slow opponent, which is where
    //     most of the offense was being lost.
    //   - backlog <= 6 cells: more than a slab's worth on the board is
    //     a clearing job, not chain fuel.
    //   - fill below the 0.85x pre-danger band (where the swap cooldown
    //     starts accelerating): near-danger cycles are defense cycles.
    //   - clock > 600: no offense in the opening seconds — extensions
    //     there spend the well-mixed starting board that the defense is
    //     about to need, which alone was the whole remaining heavy-rate
    //     regression once the other gates were in place.
    var extSafe = this.chainExtend &&
      stack.fillRatio() < this.dangerHeightFrac * 0.85 &&
      this._stackGarbageCells() <= 6 &&
      pressure < this.pressureThreshold &&
      stack.clock > 600;
    var ext = extSafe ? this._chainExtendMove(false) : null;
    if (ext) {
      this._lastSwap = ext.slice();
      stack.touchSwap(ext[0], ext[1]);
      this.cooldown = 6;
      return;
    }

    var board = this._snapshot();
    var decision = this._choose(board);

    if (this.rng() < this.mistake) {
      // A rare, deliberate miss (never while genuinely in danger — see
      // _inDanger's own path, which is chosen before this check ever
      // runs) is what keeps a scaled-back preset beatable.
      decision = this._inDanger(board) ? decision : this._raiseOrBuild(board);
    }

    if (decision.kind === "raise") {
      this.raiseFrames = 20;
      // A raise is a committed multi-frame action, unlike a swap: it
      // needs ~16-20 held frames (Stack.handleManualRaise decrements
      // displacement, which starts at 16, by 1 per frame) to actually
      // deliver a fresh row. Tried sharing the swap cooldown's fast
      // danger-mode floor (6 frames) here, on the theory that a raise
      // held that briefly could still chain into the next one — it
      // measured WORSE at every rate (moderate 14/20 -> 10/20 seeds
      // surviving a 60s cap, heavy 5/20 -> 3/20). Cause: re-deciding
      // before a raise completes lets a subsequent SWAP decision set
      // riseLock, and Stack.handleManualRaise cancels an in-progress
      // raise outright once riseLock goes true before manualRaiseYet —
      // so the fast cooldown was mostly interrupting raises before they
      // ever delivered a row, wasting the attempt entirely. `this.reaction`
      // (30 frames for diamond) safely exceeds the ~16-20 needed, so a
      // requested raise reliably finishes before anything can cancel it.
      this.cooldown = this.reaction;
      this._lastSwap = null;
      return;
    }

    var row = decision.move[0], col = decision.move[1];
    if (this._lastSwap && this._lastSwap[0] === row && this._lastSwap[1] === col) {
      // Exact undo of last turn's swap on an unchanged board -- pick a
      // different legal swap so it can't loop forever doing nothing.
      var alt = board.legalSwaps().filter(function (s) { return s[0] !== row || s[1] !== col; });
      if (alt.length) { var pick = alt[Math.floor(this.rng() * alt.length)]; row = pick[0]; col = pick[1]; }
    }
    this._lastSwap = [row, col];
    var swapped = stack.touchSwap(row, col);
    // A move built from LogicalBoard can be illegal on the REAL stack
    // and touchSwap fails SILENTLY — no exception, nothing queued.
    // Two independent real checks LogicalBoard never modeled can each
    // cause this: Stack.canSwap refuses a pull out from under a
    // hovering panel above (its own comment), and even when canSwap
    // passes, tryQueueSwap's second check (applySwapStalling) can still
    // refuse — it punishes repeating the exact same (row,col) while
    // topped out and otherwise idle, refusing outright once health is
    // too low to pay the cost, which is precisely the moment survival
    // matters most. Every call site here used to ignore touchSwap's
    // return value entirely, so the AI believed it had acted, set its
    // cooldown as if it had, and — while topped out — spent the whole
    // window genuinely idle instead, which is exactly what
    // Stack.checkGameOver's health-drain condition punishes. Confirmed
    // as a real death's actual cause by instrumenting touchSwap
    // directly: BOTH the original move and _anyLegalSwap's first
    // (canSwap-only) proposal failed at the exact frame health hit 1,
    // the second failure specifically via applySwapStalling.
    //
    // The fix here doesn't try to replicate that layered legality
    // (canSwap + a stateful, health-dependent stalling check) a third
    // time — it just tries REAL touchSwap calls, in order, across every
    // board position, and stops at the first one that actually
    // succeeds. Safe to attempt many: a canSwap failure never reaches
    // applySwapStalling at all (tryQueueSwap short-circuits), and
    // applySwapStalling's only refusal branch mutates nothing — it
    // returns false immediately, before touching health or the
    // backlog. So nothing here can make a subsequent attempt worse.
    if (!swapped && board.maxHeight() >= board.height) {
      var retryWidth = root.PanelEngine.WIDTH;
      for (var rr = 1; rr <= stack.height && !swapped; rr++) {
        for (var cc = 1; cc < retryWidth && !swapped; cc++) {
          if (rr === row && cc === col) continue; // already just failed
          if (stack.touchSwap(rr, cc)) { this._lastSwap = [rr, cc]; swapped = true; }
        }
      }
    }
    // Under real pressure, speed IS the defense: every extra frame of
    // cooldown is a frame garbage keeps stacking uncontested. Confirmed
    // by stress-testing survival against a sustained garbage stream
    // (games/the-game/ai/ only models a symmetric duel, not this — a
    // one-sided firehose test caught what that missed): at the old 0.55x
    // reaction, clear throughput fell behind incoming faster than any
    // amount of smarter move-picking could make up. Near the 6-frame
    // floor while in real danger closes that gap.
    //
    // While topped out specifically, the floor drops further, to 3 —
    // one below a swap's own animation length (Panel.lua-equivalent
    // startSwap sets timer=4). This is not about reacting faster, it's
    // about never dying: Stack.checkGameOver's health-drain condition
    // only fires when the board is COMPLETELY idle while topped out
    // (advancePassiveRaise, gated on !riseLock && stopTime===0, and
    // riseLock covers exactly the frames a swap/match is active).
    // Tried 4 first (matching the animation length exactly) and it still
    // leaked one idle frame per cycle — cooldown counts down to 0 across
    // `cooldown` FOLLOWING frames before the action fires again, so a
    // cooldown of N produces an N+1 frame gap between actions, not N;
    // confirmed by instrumenting a real death (seed 4, heavy rate) with
    // cooldown=4: health still drained 39->37->35->...->0 one frame at
    // a time despite _bestDefensiveMove finding a real move on literally
    // every single decision. 3 closes that last frame; the same probe
    // with cooldown=3 held health at its topped-out ceiling indefinitely
    // instead. A real match's animation runs far longer than 4 frames on
    // its own, so this never makes those any faster than they already were.
    this.cooldown = board.maxHeight() >= board.height
      ? 3
      : board.fillRatio() > this.dangerHeightFrac
        ? 6
        : Math.max(6, Math.round(this.reaction * (board.fillRatio() > this.dangerHeightFrac * 0.85 ? 0.55 : 1)));
  };

  root.PanelCpu = { Cpu: Cpu, SearchCpu: SearchCpu, DIFFICULTIES: DIFFICULTIES };
})(typeof window !== "undefined" ? window : globalThis);
