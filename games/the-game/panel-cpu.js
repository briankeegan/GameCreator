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
    diamond: {
      brain: "search", reaction: 30, mistake: 0.08,
      depth: 2, beam: 5, patience: 0.6, patienceFillCeiling: 0.5,
      dangerHeightFrac: 0.72, chainWeight: 380, comboWeight: 70,
      garbageWeight: 90, heightPenalty: 60, potentialWeight: 5
    },
    nightmare: {
      brain: "search", reaction: 12, mistake: 0,
      depth: 4, beam: 10, patience: 0.85, patienceFillCeiling: 0.5,
      dangerHeightFrac: 0.72, chainWeight: 380, comboWeight: 70,
      garbageWeight: 90, heightPenalty: 60, potentialWeight: 5
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

  function LogicalBoard(width, height, colors, grid) {
    this.width = width;
    this.height = height;
    this.colors = colors;
    this.grid = grid; // grid[row][col], 1..height / 1..width; 0 empty, -1 busy, -2 garbage, >0 color
  }

  LogicalBoard.prototype.clone = function () {
    var g = [];
    for (var r = 0; r <= this.height; r++) g[r] = this.grid[r] ? this.grid[r].slice() : [];
    return new LogicalBoard(this.width, this.height, this.colors, g);
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

  LogicalBoard.prototype._applyGravity = function () {
    for (var c = 1; c <= this.width; c++) {
      var stack = [];
      for (var r = 1; r <= this.height; r++) if (this.grid[r][c] !== 0) stack.push(this.grid[r][c]);
      for (var r2 = 1; r2 <= this.height; r2++) this.grid[r2][c] = r2 <= stack.length ? stack[r2 - 1] : 0;
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

  // ---- SearchCpu ----

  function SearchCpu(stack, opts) {
    opts = opts || {};
    var preset = DIFFICULTIES[opts.difficulty] || DIFFICULTIES.diamond;
    this.stack = stack;
    this.reaction = opts.reaction || preset.reaction;
    this.mistake = opts.mistake === undefined ? preset.mistake : preset.mistake;
    this.depth = opts.depth || preset.depth;
    this.beam = opts.beam || preset.beam;
    this.patience = opts.patience === undefined ? preset.patience : preset.patience;
    this.patienceFillCeiling = preset.patienceFillCeiling;
    this.dangerHeightFrac = preset.dangerHeightFrac;
    this.chainWeight = preset.chainWeight;
    this.comboWeight = preset.comboWeight;
    this.garbageWeight = preset.garbageWeight;
    this.heightPenalty = preset.heightPenalty;
    this.potentialWeight = preset.potentialWeight;
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
    for (var r = 0; r <= stack.height; r++) {
      grid[r] = [];
      for (var c = 1; c <= width; c++) {
        var p = stack.panelAt(r, c);
        var v;
        if (!p) v = -1;
        else if (p.isGarbage) v = -2;
        else if (p.color === 0) v = 0;
        else if (p.state !== "normal" && p.state !== "landing") v = -1;
        else v = p.color;
        grid[r][c] = v;
      }
    }
    return new LogicalBoard(width, stack.height, this.stack.colors, grid);
  };

  SearchCpu.prototype._evaluate = function (board, cumGarbage, cumChain, cumCombo) {
    var danger = Math.max(0, board.maxHeight() - board.height * this.dangerHeightFrac);
    return cumGarbage * this.garbageWeight + cumChain * this.chainWeight + cumCombo * this.comboWeight
      + boardPotential(board) * this.potentialWeight - danger * danger * this.heightPenalty;
  };

  SearchCpu.prototype._inDanger = function (board) {
    return board.maxHeight() >= board.height * this.dangerHeightFrac;
  };

  // Pure survival: the biggest immediate clear, or (if none) the swap
  // that improves `potential` the most, searched progressively deeper
  // (1, then 2, then 3 swaps) until something is found. NEVER raises
  // while tall — raising can only make the danger worse. That's the
  // actual guarantee behind "shouldn't be able to die," not a hope the
  // scoring weights happen to produce.
  SearchCpu.prototype._bestDefensiveMove = function (board) {
    var best = null, bestKey = null, swaps = board.legalSwaps(), i;
    for (i = 0; i < swaps.length; i++) {
      var r = swaps[i][0], c = swaps[i][1];
      var trial = board.clone();
      trial.swap(r, c);
      var res = trial.resolve();
      if (res.chainLength === 0) continue;
      var comboSum = res.comboSizes.reduce(function (a, b) { return a + b; }, 0);
      var key = res.chainLength * 1000 + comboSum;
      if (bestKey === null || key > bestKey) { bestKey = key; best = [r, c]; }
    }
    if (best) return best;

    var base = boardPotential(board), bestGain = null, gainMove = null;
    for (i = 0; i < swaps.length; i++) {
      var r2 = swaps[i][0], c2 = swaps[i][1];
      var trial2 = board.clone();
      trial2.swap(r2, c2);
      var gain = boardPotential(trial2) - base;
      if (bestGain === null || gain > bestGain) { bestGain = gain; gainMove = [r2, c2]; }
    }
    if (gainMove && bestGain > 0) return gainMove;

    var rescue = this._nPlyRescue(board, 2) || this._nPlyRescue(board, 3);
    if (rescue) return rescue;
    return gainMove || null; // null means "raise" to the caller
  };

  SearchCpu.prototype._nPlyRescue = function (board, depth) {
    var best = null, bestKey = null;
    var walk = function (trial, firstMove, remaining) {
      var swaps = trial.legalSwaps();
      for (var i = 0; i < swaps.length; i++) {
        var r = swaps[i][0], c = swaps[i][1];
        var step = trial.clone();
        step.swap(r, c);
        var move = firstMove || [r, c];
        var res = step.resolve();
        if (res.chainLength > 0) {
          var comboSum = res.comboSizes.reduce(function (a, b) { return a + b; }, 0);
          var key = res.chainLength * 1000 + comboSum;
          if (bestKey === null || key > bestKey) { bestKey = key; best = move; }
          continue;
        }
        if (remaining > 1) walk(step, move, remaining - 1);
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

    if (this.raiseFrames > 0) {
      this.raiseFrames--;
      stack.setInput({ raise: true });
    } else {
      stack.setInput({});
    }

    if (this.cooldown > 0) { this.cooldown--; return; }

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
    stack.touchSwap(row, col);
    this.cooldown = Math.max(6, Math.round(this.reaction * (board.fillRatio() > this.dangerHeightFrac ? 0.55 : 1)));
  };

  root.PanelCpu = { Cpu: Cpu, SearchCpu: SearchCpu, DIFFICULTIES: DIFFICULTIES };
})(typeof window !== "undefined" ? window : globalThis);
