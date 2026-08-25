// Named SearchCpu overrides for the stress-harness experiments. Each one
// monkey-patches the given cpu INSTANCE so the shared prototype (the
// shipped implementation) stays untouched while a variant is measured.
//
// Finding that motivated variant "raise_when_stuck": _bestDefensiveMove's
// final fallback is `gainMove || null`, and gainMove gets set for the
// FIRST swap evaluated regardless of whether its gain is positive or even
// zero -- so as long as ANY legal swap exists (even a useless one), it is
// always preferred over ever raising, no matter how unproductive it is.
// Confirmed via a real stress-test board dump: bottom rows had gone
// nearly empty (riseLock stays true while anything is active, so passive
// rise never refills them, and danger-mode swaps never raise either) while
// tall garbage sat untouched above -- with no fresh material at the
// bottom, no swap could ever reach up and touch it. The fix tested here:
// when truly stuck (no 1..4-ply match found anywhere) and no column is
// ALREADY at the very top (raising would be instant overflow there),
// prefer raising over a swap that provably helps nothing.
module.exports.apply = function (cpu, name) {
  if (name === 'baseline') return; // shipped behavior, unmodified

  if (name === 'raise_when_stuck') {
    var proto = Object.getPrototypeOf(cpu);
    var origBestDefensiveMove = proto._bestDefensiveMove;
    cpu._bestDefensiveMove = function (board) {
      var swaps = board.legalSwaps();

      // tiers 1..immediate-match already prioritize garbage/chain -- reuse
      // them by calling the ORIGINAL up to (but not including) its final
      // "always take gainMove" fallback. Simplest correct way: re-run the
      // same match/rescue tiers here directly, since they're cheap
      // relative to the swap search itself.
      var best = null, bestKey = null, i;
      var garbageBefore = 0;
      for (var r = 1; r <= board.height; r++) for (var c = 1; c <= board.width; c++) if (board.grid[r][c] === -2) garbageBefore++;
      var toppedOutNow = board.maxHeight() >= board.height;
      for (i = 0; i < swaps.length; i++) {
        var trial = board.clone();
        trial.swap(swaps[i][0], swaps[i][1]);
        var res = trial.resolve();
        if (res.chainLength === 0) continue;
        var gAfter = 0;
        for (var r2 = 1; r2 <= trial.height; r2++) for (var c2 = 1; c2 <= trial.width; c2++) if (trial.grid[r2][c2] === -2) gAfter++;
        var key = this._defensiveKey(res, garbageBefore - gAfter, toppedOutNow);
        if (bestKey === null || key > bestKey) { bestKey = key; best = swaps[i]; }
      }
      if (best) return best;

      var base = 0;
      var potential = function (b) {
        var score = 0, g = b.grid;
        for (var rr = 1; rr <= b.height; rr++) for (var cc = 1; cc <= b.width; cc++) {
          var color = g[rr][cc]; if (color <= 0) continue;
          if (cc < b.width && g[rr][cc + 1] === color) score += 1;
          if (cc < b.width - 1 && g[rr][cc + 2] === color) score += 1;
          if (rr < b.height && g[rr + 1][cc] === color) score += 2;
        }
        return score;
      };
      base = potential(board);
      var bestGain = null, gainMove = null;
      for (i = 0; i < swaps.length; i++) {
        var trial2 = board.clone();
        trial2.swap(swaps[i][0], swaps[i][1]);
        var gain = potential(trial2) - base;
        if (bestGain === null || gain > bestGain) { bestGain = gain; gainMove = swaps[i]; }
      }
      if (gainMove && bestGain > 0) return gainMove;

      var rescue = this._nPlyRescue(board, 2) || this._nPlyRescue(board, 3) || this._nPlyRescue(board, 4);
      if (rescue) return rescue;

      // Truly stuck: nothing found any match, nothing even improves
      // potential. If no column is already at the very top, raising for
      // fresh material beats repeating a swap that provably does nothing.
      if (board.maxHeight() < board.height) return null;
      return gainMove || null;
    };
    return;
  }

  // ---- offense variants: same brain, different knobs. Measured by the
  // harness's garbageCellsSent/sentPerSecond under a realistic incoming
  // rate (0.67 cells/sec, the strongest real opponent's measured peak).
  if (name === 'aggro_knobs') {
    cpu.mistake = 0;
    cpu.reaction = 18;
    cpu.depth = 3;
    cpu.beam = 8;
    cpu.patience = 0.9;
    cpu.patienceFillCeiling = 0.7;
    return;
  }
  if (name === 'nightmare_knobs') {
    cpu.mistake = 0;
    cpu.reaction = 12;
    cpu.depth = 4;
    cpu.beam = 10;
    cpu.patience = 0.85;
    cpu.patienceFillCeiling = 0.5;
    return;
  }

  throw new Error('unknown strategy: ' + name);
};
