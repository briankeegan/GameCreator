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

  // Calls go through this object so a test can swap one step for a broken one
  // and prove the check notices.
  var api = {
    popcount: popcount,
    restingMask: restingMask,
    colourMasks: colourMasks,
    clears: clears,
    clearedCells: clearedCells
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BitMatch = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
