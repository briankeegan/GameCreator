// WHAT CLEARS ON A BOARD, AS BIT ARITHMETIC.
//
// The same answer _findMatches gives, computed without walking the grid for
// runs. One 12-bit integer per (colour, column): bit (r - 1) is set when row r
// of that column holds that colour. A match is then two AND expressions:
//
//   vertical    cv = B & (B>>1) & (B>>2)          three stacked in a column
//               cleared = cv | cv<<1 | cv<<2      the core expanded to the run
//   horizontal  hc = B[c] & B[c+1] & B[c+2]       three across at one height
//               cleared: hc credited to c, c+1, c+2
//
// Combo size is popcount of the union. There is no notion of shape, run
// length or combo size anywhere in it — a run of six clears because it
// contains four overlapping cores, not because six is a case. That is the
// point: one expression covers every size, and sizes nobody enumerated.
//
// WHAT CONSTRAINS IT
//
//   * The board must be a settled-or-not snapshot with its garbage blocks, and
//     only RESTING cells may match. See restingMask.
//   * Colours are 1..6. Garbage (-2), shock (8) and colourless (9) never join
//     a match and are therefore never in a colour mask; they still occupy
//     space, so they count for support.
//   * Board height must be <= 31 for the masks to stay in one integer.
//   * It answers ONE round. A cascade is this, then gravity, then this again.
//
// Nothing in the bot's decision path imports this. It is checked against
// _findMatches by bitmatch.test.js over every legal swap on every real board.
(function (root) {
  'use strict';

  function popcount(x) {
    var n = 0;
    while (x) { x &= x - 1; n++; }
    return n;
  }

  // WHICH CELLS HAVE LANDED.
  //
  // A panel matches only once it is resting, and "resting" is not "there is
  // something directly below": a panel standing on a falling panel is falling
  // too. Within a column that makes resting the run of occupied cells reaching
  // the floor.
  //
  // A GARBAGE SLAB BRIDGES. A slab falls only if EVERY column beneath it is
  // clear, so a slab held up in one column spans the holes in the others and
  // everything standing on it rests — over a hole in its own column. So this
  // cannot be read off a column's lowest gap; it is computed bottom-up with
  // resting slab cells as extra floor, after settling the slabs to a fixed
  // point (a slab resting on a falling slab is falling).
  function restingMask(grid, blocks, W, H) {
    var occ = [], c, r, i;
    for (c = 1; c <= W; c++) {
      occ[c] = 0;
      for (r = 1; r <= H; r++) if (grid[r][c] !== 0) occ[c] |= (1 << (r - 1));
    }

    var ids = Object.keys(blocks || {}), owner = {}, falling = {};
    for (i = 0; i < ids.length; i++) {
      var cells = blocks[ids[i]].cells;
      for (var j = 0; j < cells.length; j++) owner[cells[j][0] + ':' + cells[j][1]] = ids[i];
    }
    // Bounded by the number of blocks: a pass can only ever mark more falling.
    var moved = true, guard = 0;
    while (moved && guard++ <= ids.length + 1) {
      moved = false;
      for (i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (falling[id]) continue;
        var bcells = blocks[id].cells, low = {};
        for (var k = 0; k < bcells.length; k++) {
          var br = bcells[k][0], bc = bcells[k][1];
          if (low[bc] === undefined || br < low[bc]) low[bc] = br;
        }
        var held = false;
        for (var lc in low) {
          var under = low[lc] - 1;
          if (under < 1) { held = true; break; }          // the floor
          var v = grid[under][lc];
          if (v === 0) continue;                          // nothing there
          if (v === -2) {
            var oid = owner[under + ':' + lc];
            if (oid !== undefined && falling[oid]) continue;   // falling too
          }
          held = true; break;
        }
        if (!held) { falling[id] = true; moved = true; }
      }
    }

    var seed = [];     // resting garbage: floor for whatever stands on it
    for (c = 1; c <= W; c++) seed[c] = 0;
    for (c = 1; c <= W; c++) {
      for (r = 1; r <= H; r++) {
        if (grid[r][c] !== -2) continue;
        var own = owner[r + ':' + c];
        if (own !== undefined && !falling[own]) seed[c] |= (1 << (r - 1));
      }
    }

    var rest = [];
    for (c = 1; c <= W; c++) {
      var o = occ[c], m = 0;
      for (r = 1; r <= H; r++) {
        var bit = 1 << (r - 1);
        if (!(o & bit)) continue;
        if (r === 1 || (m & (bit >> 1)) || (seed[c] & bit)) m |= bit;
      }
      rest[c] = m;
    }
    return rest;
  }

  // Resting cells only, one mask per colour per column.
  function colourMasks(grid, blocks, W, H) {
    var rest = api.restingMask(grid, blocks, W, H);
    var B = [], a, c;
    for (a = 1; a <= 6; a++) { B[a] = []; for (c = 1; c <= W; c++) B[a][c] = 0; }
    for (var r = 1; r <= H; r++) {
      for (c = 1; c <= W; c++) {
        var v = grid[r][c];
        if (v >= 1 && v <= 6 && (rest[c] & (1 << (r - 1)))) B[v][c] |= (1 << (r - 1));
      }
    }
    return B;
  }

  // The cleared cells as one mask per column, plus how many there are.
  function clears(grid, blocks, W, H) {
    var B = api.colourMasks(grid, blocks, W, H);
    var mask = [], a, c;
    for (c = 1; c <= W; c++) mask[c] = 0;
    for (a = 1; a <= 6; a++) {
      for (c = 1; c <= W; c++) {
        var b = B[a][c], cv = b & (b >> 1) & (b >> 2);
        mask[c] |= cv | (cv << 1) | (cv << 2);
      }
      for (c = 1; c + 2 <= W; c++) {
        var hc = B[a][c] & B[a][c + 1] & B[a][c + 2];
        mask[c] |= hc; mask[c + 1] |= hc; mask[c + 2] |= hc;
      }
    }
    var total = 0;
    for (c = 1; c <= W; c++) total += popcount(mask[c]);
    return { mask: mask, total: total };
  }

  // Same answer as an "r:c" -> true map, for comparing against _findMatches.
  function clearedCells(grid, blocks, W, H) {
    var out = {}, res = api.clears(grid, blocks, W, H);
    for (var c = 1; c <= W; c++) {
      for (var bit = 0; bit < H; bit++) {
        if (res.mask[c] & (1 << bit)) out[(bit + 1) + ':' + c] = true;
      }
    }
    return out;
  }

  // GRAVITY IS ONE OPERATION: keep the bits the clear did not take, packed
  // down. That is a parallel bit extract — every colour plane, and the
  // chaining mask, compacted with the SAME selector, so they stay in step
  // without anything tracking which panel is which.
  function pext(bits, keep) {
    var out = 0, n = 0;
    for (var i = 0; i < 32; i++) {
      var b = 1 << i;
      if (!(keep & b)) continue;
      if (bits & b) out |= (1 << n);
      n++;
    }
    return out;
  }

  // A WHOLE CASCADE, AS BITS.
  //
  //   clear -> compact -> clear again, until nothing clears.
  //
  // COUNTING ROUNDS IS NOT THE CHAIN COUNTER. Two combos that happen to fire
  // in separate rounds are still one combo: a link counts only when a matched
  // panel is CHAINING — it fell because something below it cleared. So a
  // chaining mask rides along, set on every survivor above a cleared cell and
  // compacted with the same selector, and a round is a link when the clear
  // intersects it. The first link of a chain is an x2, as the engine counts.
  //
  // IT STOPS AT GARBAGE. A match touching a slab pops one row and the engine
  // turns that row into panels whose colours come from its own rng, so
  // anything past that point is unknowable. Boards carrying garbage are
  // reported as out of scope rather than guessed at.
  function resolveBits(grid, blocks, W, H) {
    if (blocks && Object.keys(blocks).length) return { scope: 'garbage', chain: 0, total: 0, rounds: 0 };
    var occ = [], colour = [], chaining = [], a, c, r;
    for (a = 1; a <= 6; a++) { colour[a] = []; for (c = 1; c <= W; c++) colour[a][c] = 0; }
    for (c = 1; c <= W; c++) { occ[c] = 0; chaining[c] = 0; }
    for (r = 1; r <= H; r++) {
      for (c = 1; c <= W; c++) {
        var v = grid[r][c];
        if (v === 0) continue;
        if (v < 1 || v > 6) return { scope: 'unknown-cell', chain: 0, total: 0, rounds: 0 };
        occ[c] |= (1 << (r - 1));
        colour[v][c] |= (1 << (r - 1));
      }
    }

    var counter = 0, rounds = 0, total = 0, guard = 0;
    while (guard++ <= H * W) {
      // Only landed cells match, and with no garbage that is the run of
      // occupied bits reaching the floor: everything from the first hole up
      // is in the air.
      var rest = [], link = false, any = false, k = [];
      for (c = 1; c <= W; c++) {
        var o = occ[c], lowestZero = (~o) & (o + 1);
        rest[c] = o & (lowestZero - 1);
      }
      var B = [];
      for (a = 1; a <= 6; a++) { B[a] = []; for (c = 1; c <= W; c++) B[a][c] = colour[a][c] & rest[c]; }
      for (c = 1; c <= W; c++) k[c] = 0;
      for (a = 1; a <= 6; a++) {
        for (c = 1; c <= W; c++) {
          var b = B[a][c], cv = b & (b >> 1) & (b >> 2);
          k[c] |= cv | (cv << 1) | (cv << 2);
        }
        for (c = 1; c + 2 <= W; c++) {
          var hc = B[a][c] & B[a][c + 1] & B[a][c + 2];
          k[c] |= hc; k[c + 1] |= hc; k[c + 2] |= hc;
        }
      }
      for (c = 1; c <= W; c++) { if (k[c]) any = true; if (k[c] & chaining[c]) link = true; }
      if (!any) {
        // NOTHING HAS LANDED INTO A MATCH YET. A swap that moves a panel
        // sideways leaves a hole, and what stands over it is in the air, so
        // the match it will make has not happened yet.
        //
        // ONE ROW, NOT ALL THE WAY DOWN. Panels land at different times, and
        // a match fires the moment its own cells are down — while the rest of
        // the board is still falling. Dropping everything to its final place
        // in one go makes two matches that the game fires a beat apart happen
        // together, and a chain reads one link short. So: shift the run above
        // the lowest hole down by one, and look again.
        var fell = false;
        for (c = 1; c <= W; c++) {
          var hole = (~occ[c]) & (occ[c] + 1);
          if (!(occ[c] & ~((hole << 1) - 1))) continue;   // nothing above it
          fell = true;
          var below = (hole - 1), above = ~((hole << 1) - 1);
          for (a = 1; a <= 6; a++) {
            colour[a][c] = (colour[a][c] & below) | ((colour[a][c] & above) >> 1);
          }
          chaining[c] = (chaining[c] & below) | ((chaining[c] & above) >> 1);
          occ[c] = (occ[c] & below) | ((occ[c] & above) >> 1);
        }
        if (fell) continue;
        break;
      }
      rounds++;
      if (link) counter = counter === 0 ? 2 : counter + 1;
      for (c = 1; c <= W; c++) total += popcount(k[c]);

      // Everything still standing above the lowest cell this clear took is
      // falling BECAUSE of it: that is the chaining flag, in one expression.
      for (c = 1; c <= W; c++) {
        if (!k[c]) { continue; }
        var lowest = k[c] & -k[c];
        chaining[c] |= occ[c] & ~k[c] & ~(lowest - 1);
      }
      // The cleared cells leave; what stood on them is now falling BECAUSE
      // of that, and the one-row fall above brings it down a row at a time.
      for (c = 1; c <= W; c++) {
        if (!k[c]) continue;
        var keep = occ[c] & ~k[c];
        for (a = 1; a <= 6; a++) colour[a][c] &= keep;
        chaining[c] &= keep;
        occ[c] = keep;
      }
    }
    return { scope: 'ok', chain: rounds ? Math.max(counter, 1) : 0, total: total, rounds: rounds };
  }

  // Calls go through this object so a test can swap one step for a broken one
  // and prove the check notices.
  var api = {
    popcount: popcount,
    restingMask: restingMask,
    colourMasks: colourMasks,
    clears: clears,
    clearedCells: clearedCells,
    pext: pext,
    resolveBits: resolveBits
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BitMatch = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
