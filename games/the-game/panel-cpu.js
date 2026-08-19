// Puzzle Attack — the duel opponents' brain.
//
// The Lua reference ships a CPU (common/engine/computerPlayers) that plans
// through the full engine; this is a much smaller thing on purpose: it looks
// at the board, scores every legal swap, and plays the best one it can see
// after a reaction delay. Difficulty is three knobs — how often it looks, how
// often it fumbles, and whether it bothers keeping its stack flat.
//
// It plays through the same public entry points a human uses (touchSwap /
// raise), so nothing here can do something the player could not.
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
    brutal: { reaction: 14, mistake: 0.02, tidy: 0.9, panicAt: 0.6, patience: 0.8 }
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

  root.PanelCpu = { Cpu: Cpu, DIFFICULTIES: DIFFICULTIES };
})(typeof window !== "undefined" ? window : globalThis);
