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

  // SCRATCH, REUSED. Every one of these was a fresh array per call, and a
  // couple of them per cascade round: on a 6x12 board the arithmetic itself is
  // a few dozen integer ops and the allocation around it cost more than the
  // work. Sized on first use and never grown down.
  //
  // NOT REENTRANT. resolveBits may not be called from inside resolveBits, and
  // nothing does.
  var S = null;
  function scratch(W, H, N) {
    if (!S || S.W !== W || S.N < N) {
      S = { W: W, H: H, N: Math.max(N, 8), occ: [], chaining: [], popping: [],
            inert: [], garb: [], rest: [], k: [], colour: [], B: [] };
      for (var c = 0; c <= W + 1; c++) {
        S.occ[c] = 0; S.chaining[c] = 0; S.popping[c] = 0;
        S.inert[c] = 0; S.garb[c] = 0; S.rest[c] = 0; S.k[c] = 0;
      }
      for (var a = 0; a <= S.N; a++) {
        S.colour[a] = []; S.B[a] = [];
        for (var c2 = 0; c2 <= W + 1; c2++) { S.colour[a][c2] = 0; S.B[a][c2] = 0; }
      }
    }
    return S;
  }

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

  // HOW MANY COLOURS IS NOT A CONSTANT. The game plays 5 or 6, but a board
  // staged for a chip fills the cells the shape does not care about with
  // colours no real board uses, precisely so the filler cannot join a match.
  // The arithmetic does not care how many there are — one mask per colour —
  // so the count is read off the board rather than assumed.
  function topColour(grid, W, H) {
    var top = 0;
    for (var r = 1; r <= H; r++) {
      for (var c = 1; c <= W; c++) if (grid[r][c] > top) top = grid[r][c];
    }
    return top;
  }

  // Resting cells only, one mask per colour per column.
  function colourMasks(grid, blocks, W, H, nColours) {
    var rest = api.restingMask(grid, blocks, W, H);
    var N = nColours || api.topColour(grid, W, H);
    var B = [], a, c;
    for (a = 1; a <= N; a++) { B[a] = []; for (c = 1; c <= W; c++) B[a][c] = 0; }
    for (var r = 1; r <= H; r++) {
      for (c = 1; c <= W; c++) {
        var v = grid[r][c];
        if (v >= 1 && v <= N && (rest[c] & (1 << (r - 1)))) B[v][c] |= (1 << (r - 1));
      }
    }
    B.nColours = N;
    return B;
  }

  // The cleared cells as one mask per column, plus how many there are.
  function clears(grid, blocks, W, H, nColours) {
    var B = api.colourMasks(grid, blocks, W, H, nColours);
    var mask = [], a, c;
    for (c = 1; c <= W; c++) mask[c] = 0;
    for (a = 1; a <= B.nColours; a++) {
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
  function clearedCells(grid, blocks, W, H, nColours) {
    var out = {}, res = api.clears(grid, blocks, W, H, nColours);
    for (var c = 1; c <= W; c++) {
      for (var bit = 0; bit < H; bit++) {
        if (res.mask[c] & (1 << bit)) out[(bit + 1) + ':' + c] = true;
      }
    }
    return out;
  }

  // THE BOARD AS MASKS, BUILT ONCE.
  //
  // Reading a grid costs 72 double-indexed reads and a branch each; a swap
  // changes FOUR BITS. A caller scoring every legal swap on one board builds
  // this once and then mutates it per swap, instead of rescanning the grid ~30
  // times for a board that did not change.
  //
  // colour is one mask per colour per column, flat: colour[a * (W + 2) + c].
  function maskState(grid, blocks, W, H) {
    var st = { W: W, H: H, N: 0, occ: new Int32Array(W + 2), inert: new Int32Array(W + 2),
               garb: new Int32Array(W + 2), colour: new Int32Array(13 * (W + 2)),
               slabs: [], bad: null };
    var r, c, row;
    for (r = 1; r <= H; r++) {
      row = grid[r];
      for (c = 1; c <= W; c++) {
        var v = row[c], b = 1 << (r - 1);
        if (v === 0) continue;
        st.occ[c] |= b;
        if (v === -2) { st.inert[c] |= b; st.garb[c] |= b; continue; }
        if (v < 0) { st.bad = 'unknown-cell'; return st; }
        if (v > st.N) st.N = v;
        st.colour[v * (W + 2) + c] |= b;
      }
    }
    if (blocks) {
      for (var id in blocks) {
        var cells = blocks[id].cells, sm = new Int32Array(W + 2);
        for (var i2 = 0; i2 < cells.length; i2++) sm[cells[i2][1]] |= (1 << (cells[i2][0] - 1));
        st.slabs.push(sm);
      }
    }
    return st;
  }

  // Move one panel sideways in a mask state, or put it back: the swap and its
  // undo are the same call. Returns false when the pair cannot be swapped as
  // panels — an inert cell is not a panel and the game cannot move it.
  // EVERY SWAP THE ENGINE WOULD ACCEPT, from the masks alone.
  //
  // ONE implementation, because two drift: this is LogicalBoard.legalSwaps's rule
  // expressed in bits, and bitoptions.test.js asserts the two lists are equal.
  // Its three exclusions, and the two that a bits-only version gets wrong if it is
  // written by looking at swapMasks instead of at the rule:
  //
  //   garbage on either side   swapMasks already refuses this (inert)
  //   BOTH CELLS EMPTY         nothing moves
  //   BOTH THE SAME COLOUR     nothing changes -- and this is the one that bites,
  //                            416 phantom swaps over 200 boards, each of them an
  //                            "option" the engine answers by clearing nothing
  // A DETACHED COPY OF A STATE. Needed where a caller must keep a position that
  // the next call would otherwise overwrite -- the swapped board of a move that
  // breaks a slab, whose cascade has no knowable end and so has no settled state
  // to hand back.
  // THE BOARD AFTER THE ROW THAT IS ALREADY DRAWN.
  //
  // The engine fills the incoming row a full row of time before it enters play and
  // hands it to the bot as `board.incoming`. Every column shifts up one and that row
  // takes row 1. Garbage rises with it. Anything pushed past H leaves, which is what
  // topping out is; this answers "what will the board be", not "did it die".
  //
  // null when the row is not known -- `incoming` is false for the row behind the one
  // being dealt, because that one comes from the match rng.
  function risenMasks(st, incoming) {
    if (!st || st.bad || !incoming) return null;
    var W2 = st.W, c, v, top = (W2 + 2), lim = (1 << st.H) - 1;
    for (c = 1; c <= W2; c++) { v = incoming[c]; if (!(v > 0) || v > 12) return null; }
    var out = { W: st.W, H: st.H, N: st.N, occ: new Int32Array(top),
                inert: new Int32Array(top), garb: new Int32Array(top),
                colour: new Int32Array(13 * top), slabs: [], bad: null };
    for (c = 1; c <= W2; c++) {
      out.occ[c] = ((st.occ[c] << 1) | 1) & lim;
      out.inert[c] = (st.inert[c] << 1) & lim;
      out.garb[c] = (st.garb[c] << 1) & lim;
      v = incoming[c];
      if (v > out.N) out.N = v;
      for (var k = 1; k <= 12; k++)
        out.colour[k * top + c] = (st.colour[k * top + c] << 1) & lim;
      out.colour[v * top + c] |= 1;
    }
    for (var i = 0; i < st.slabs.length; i++) {
      var sm = new Int32Array(top);
      for (c = 1; c <= W2; c++) sm[c] = (st.slabs[i][c] << 1) & lim;
      out.slabs.push(sm);
    }
    return out;
  }

  function copyState(st) {
    var stride = st.W + 2, out = { W: st.W, H: st.H, N: st.N, occ: [], inert: [], garb: [],
                                   colour: new Int32Array((st.N + 1) * stride), slabs: [],
                                   bad: st.bad || null };
    var c, i;
    for (c = 0; c <= st.W + 1; c++) { out.occ[c] = st.occ[c]; out.inert[c] = st.inert[c]; out.garb[c] = st.garb[c]; }
    for (i = 0; i < out.colour.length && i < st.colour.length; i++) out.colour[i] = st.colour[i];
    for (i = 0; st.slabs && i < st.slabs.length; i++) out.slabs.push(Int32Array.from(st.slabs[i]));
    return out;
  }

  function legalSwapsOf(st) {
    var out = [], r, c, a, stride = st.W + 2;
    for (r = 1; r <= st.H; r++) {
      var b = 1 << (r - 1);
      for (c = 1; c < st.W; c++) {
        if ((st.inert[c] & b) || (st.inert[c + 1] & b)) continue;
        if (!((st.occ[c] | st.occ[c + 1]) & b)) continue;
        var left = 0, right = 0;
        for (a = 1; a <= st.N; a++) {
          if (st.colour[a * stride + c] & b) left = a;
          if (st.colour[a * stride + c + 1] & b) right = a;
        }
        if (left === right) continue;              // same colour, or both empty
        out.push([r, c]);
      }
    }
    return out;
  }

  // IS ANY SINGLE SWAP A CLEAR, WITHOUT RESOLVING ANYTHING.
  //
  // The question is asked in four places and answered the same way in each: apply
  // every legal swap, run a full resolve, look at the result. A resolve allocates
  // a scratch board the size of the stack, so that is one allocation per swap per
  // call, to learn one bit.
  //
  // A swap exchanges two cells and nothing else moves except a panel pushed into
  // an empty column, which falls straight down. So the only matches that can
  // appear are lines through the two cells' final positions, and a line is three
  // of a colour running from that cell in one of two directions.
  //
  // Cascades are not considered and do not need to be: a cascade begins with a
  // match, and this returns on the first one it finds.
  function anyOneSwapClear(st) {
    var W = st.W, H = st.H, N = st.N, stride = W + 2;
    var sw = legalSwapsOf(st), i, a;

    function colourAt(c, bitv) {
      for (var aa = 1; aa <= N; aa++) if (st.colour[aa * stride + c] & bitv) return aa;
      return 0;
    }
    // Where a panel pushed into column c at row r comes to rest: the lowest row
    // at or below r whose cell is empty and whose support is solid.
    function restRow(c, r, ignoreBit) {
      var rr = r;
      while (rr > 1) {
        var below = 1 << (rr - 2);
        if ((st.occ[c] & below) && !(ignoreBit && below === ignoreBit)) break;
        rr--;
      }
      return rr;
    }
    // Three of colour `a` in a line through (r,c), reading the board as it is
    // except for the two cells the swap moved.
    function lineThrough(r, c, a, over) {
      function at(rr, cc) {
        if (rr < 1 || rr > H || cc < 1 || cc > W) return -1;
        for (var k = 0; k < over.length; k++)
          if (over[k][0] === rr && over[k][1] === cc) return over[k][2];
        return colourAt(cc, 1 << (rr - 1));
      }
      var run = 1, k;
      for (k = c - 1; k >= 1 && at(r, k) === a; k--) run++;
      for (k = c + 1; k <= W && at(r, k) === a; k++) run++;
      if (run >= 3) return true;
      run = 1;
      for (k = r - 1; k >= 1 && at(k, c) === a; k--) run++;
      for (k = r + 1; k <= H && at(k, c) === a; k++) run++;
      return run >= 3;
    }

    // A SWAP INTO AN EMPTY CELL IS NOT TWO CELLS CHANGING.
    //
    // It leaves a hole, so everything above it in that column drops, and a match
    // can form among panels this never looked at. Modelling that is modelling
    // gravity, which resolveFromMasks already does -- so those swaps take the slow
    // path and the rest, which are most of them, take the arithmetic. Measured on
    // settled boards from real play: with the empty-cell case waved through as
    // arithmetic it missed 48 of 981, and every one of those was this.
    var slow = null;
    for (i = 0; i < sw.length; i++) {
      var r = sw[i][0], c = sw[i][1], bitv = 1 << (r - 1);
      var left = colourAt(c, bitv), right = colourAt(c + 1, bitv);
      if (!left || !right) {
        if (!slow) slow = copyState(st);
        if (!swapMasks(slow, r, c)) continue;
        var rz = resolveFromMasks(slow, false);
        swapMasks(slow, r, c);
        if (rz && (rz.total > 0 || rz.scope === 'garbage-broke')) return true;
        continue;
      }
      // Both occupied: nothing falls, so the board after the swap is the board
      // with two cells exchanged and a line can only run through one of them.
      var over = [[r, c, right], [r, c + 1, left]];
      if (lineThrough(r, c + 1, left, over)) return true;
      if (lineThrough(r, c, right, over)) return true;
    }
    return false;
  }

  // THE BIGGEST FREEZE ANY SINGLE SWAP CAN BUY, in frames.
  //
  // `anyOneSwapClear` answers whether a board can fire. That is a boolean where
  // the answer is a NUMBER: a bare three buys 0 held frames, a combo 4 buys 60
  // topped out, a chain 4 buys 94. A caller ranking landings by "can it fire"
  // scores those three the same, and the difference between them is most of a
  // row of ceiling.
  //
  // Stop time is a MAX, not a sum -- one freeze runs at a time -- so this is the
  // best single swap, not the total of them.
  //
  // ENGINE-FREE: `price` is handed each resolve and returns its frames, so the
  // engine's stop table stays in bitfeatures and this stays board arithmetic.
  // Requires a SETTLED board, as anyOneSwapClear does.
  //
  // Every clearing swap is resolved, because size and chain are not readable off
  // the arithmetic -- only whether a line exists. The swaps that clear are a
  // handful; resolveFromMasks does not mutate, and swapMasks is its own undo.
  function bestOneSwapStop(st, price) {
    var sw = legalSwapsOf(st), best = 0, i, r, pays;
    for (i = 0; i < sw.length; i++) {
      if (!swapMasks(st, sw[i][0], sw[i][1])) continue;
      r = resolveFromMasks(st, false);
      swapMasks(st, sw[i][0], sw[i][1]);
      if (!r || !(r.total > 0)) continue;
      pays = price(r) || 0;
      if (pays > best) best = pays;
    }
    return best;
  }

  // WHERE A SETUP COULD POSSIBLY MATTER.
  //
  // A clear is three of a colour in a line, so a swap that is not within reach of
  // an existing PAIR cannot lead to one however many plies follow it. The pairs
  // are one operation per colour:
  //
  //     vertical, in a column   P = B & (B >> 1)    completes at r-1 and r+2
  //     horizontal, across two  B[c] & B[c+1]       completes in c-1 and c+2
  //
  // The union of those completion cells, plus the pair cells themselves (a swap
  // can break a pair as easily as make one, and moving the blocker off a
  // completion cell is a setup too), is where a setup can do anything at all.
  //
  // THIS IS WHY DEPTH IS AFFORDABLE. Enumerating every legal swap at every ply is
  // 9 to 30 wide and compounds; the cells that can matter are a small fraction of
  // the board, so the deeper plies get narrow instead of exponential. Nothing is
  // lost at ply one, which stays exhaustive -- an immediate clear is never pruned,
  // only the setups that could not have led anywhere.
  function reachMask(st) {
    var W2 = st.W, stride = W2 + 2, out = [], a, c;
    for (c = 0; c <= W2 + 1; c++) out[c] = 0;
    for (a = 1; a <= st.N; a++) {
      for (c = 1; c <= W2; c++) {
        var B = st.colour[a * stride + c];
        if (!B) continue;
        // Vertical pair: rows r and r+1. The cells that would finish it are the
        // row below the pair and the row above it.
        var vp = B & (B >> 1);
        if (vp) out[c] |= vp | (vp >> 1) | (vp << 2);
        // Horizontal pair with the next column: the same rows, one column out on
        // either side.
        var hp = B & st.colour[a * stride + c + 1];
        if (hp) {
          out[c] |= hp; out[c + 1] |= hp;
          if (c > 1) out[c - 1] |= hp;
          if (c + 2 <= W2) out[c + 2] |= hp;
        }
      }
    }
    return out;
  }

  function swapMasks(st, r, c) {
    var W2 = st.W, b = 1 << (r - 1), o = c + 1;
    if ((st.inert[c] & b) || (st.inert[o] & b)) return false;
    var stride = W2 + 2, a;
    var left = 0, right = 0;
    for (a = 1; a <= st.N; a++) {
      if (st.colour[a * stride + c] & b) left = a;
      if (st.colour[a * stride + o] & b) right = a;
    }
    if (left) { st.colour[left * stride + c] &= ~b; st.colour[left * stride + o] |= b; }
    if (right) { st.colour[right * stride + o] &= ~b; st.colour[right * stride + c] |= b; }
    if (left) st.occ[o] |= b; else st.occ[o] &= ~b;
    if (right) st.occ[c] |= b; else st.occ[c] &= ~b;
    return true;
  }

  // A WHOLE CASCADE, AS BITS.
  //
  //   match -> mark -> fall a row -> match again -> sweep -> ...
  //
  // A MATCHED GROUP DOES NOT LEAVE YET. In the game a matched panel flashes
  // and pops over dozens of frames, and it holds up whatever sits on it the
  // whole time. Empty its cells the instant it matches and those panels drop
  // early: a group that was about to complete its own match lands somewhere
  // else and that match never happens. So a match is MARKED — still occupying,
  // no longer matchable — and swept once the board has come to rest.
  //
  // THE BOARD FALLS ONE ROW BETWEEN LOOKS, because panels land at different
  // times and a match fires the moment its own cells are down. Drop everything
  // to its final place at once and two matches the game fires a beat apart
  // merge into one.
  //
  // COUNTING ROUNDS IS NOT THE CHAIN COUNTER. A link counts only when a
  // matched panel is CHAINING: it fell because something below it cleared.
  // That flag is another mask, set on every survivor above a swept cell and
  // carried through the fall. The first link of a chain is an x2.
  //
  // HOW MANY COLOURS IS READ OFF THE BOARD, never assumed — a board staged for
  // a chip fills the cells its shape ignores with colours no real board uses,
  // exactly so that filler cannot join a match.
  function resolveBits(grid, blocks, W, H) {
    return resolveFromMasks(maskState(grid, blocks, W, H));
  }

  // `wantSettled` asks for the board the cascade left. OFF BY DEFAULT because it
  // allocates, and the depth-2 option sweep calls this tens of thousands of times
  // a decision where only the outcome is read -- building the state every time
  // cost 214ms of a 374ms decision. The callers that need the position ask for it.
  function resolveFromMasks(st, wantSettled) {
    var W = st.W, H = st.H, N = st.N;
    if (st.bad) return { scope: st.bad, chain: 0, total: 0, rounds: 0 };
    var S2 = scratch(W, H, Math.max(N, 12));
    var occ = S2.occ, colour = S2.colour, chaining = S2.chaining,
        popping = S2.popping, inert = S2.inert, garb = S2.garb;
    var a, c, stride = W + 2;
    for (c = 0; c <= W + 1; c++) {
      occ[c] = st.occ[c]; inert[c] = st.inert[c]; garb[c] = st.garb[c];
      chaining[c] = 0; popping[c] = 0;
    }
    for (a = 1; a <= N; a++) {
      for (c = 0; c <= W + 1; c++) colour[a][c] = st.colour[a * stride + c];
    }

    // A SLAB MOVES AS A UNIT, one mask per column it spans. It falls only when
    // EVERY column beneath it is clear, which is also why it BRIDGES: held up
    // in one column, it spans the holes in the others and everything standing
    // on it rests. A slab resting on a falling slab is falling too, so the test
    // runs to a fixed point.
    var slabs = [];
    for (var si0 = 0; si0 < st.slabs.length; si0++) slabs.push(Int32Array.from(st.slabs[si0]));
    function slabsThatFall() {
      var falling = new Array(slabs.length).fill(false), moved = true, pass = 0;
      while (moved && pass++ <= slabs.length + 1) {
        moved = false;
        for (var si = 0; si < slabs.length; si++) {
          if (falling[si]) continue;
          var sm2 = slabs[si], held = false;
          for (var cc3 = 1; cc3 <= W && !held; cc3++) {
            if (!sm2[cc3]) continue;
            var lowBit = sm2[cc3] & -sm2[cc3];
            if (lowBit === 1) { held = true; break; }          // on the floor
            var under = lowBit >> 1;
            if (!(occ[cc3] & under)) continue;                 // nothing below
            var owner = -1;
            for (var sj = 0; sj < slabs.length; sj++) if (slabs[sj][cc3] & under) owner = sj;
            if (owner >= 0 && falling[owner]) continue;        // falling too
            held = true;
          }
          if (!held) { falling[si] = true; moved = true; }
        }
      }
      return falling;
    }

    // Landed cells. With no inert cell in the column this is one expression:
    // everything from the first hole up is in the air, so resting is the bits
    // below it.
    //
    // An inert cell never moves, so it rests on its own account and is a floor
    // for whatever stands on it — which is how a slab bridges a hole in one of
    // the columns it spans. Then the run is walked from each inert cell upward,
    // over the inert cells only, rather than over all twelve rows.
    var rest = S2.rest;
    function restingOf() {
      for (var cc2 = 1; cc2 <= W; cc2++) {
        var o = occ[cc2];
        var lowestZero = (~o) & (o + 1);
        var m = o & (lowestZero - 1);
        var seeds = inert[cc2] & ~m;
        while (seeds) {
          var seed = seeds & -seeds;
          // the contiguous occupied run from this inert cell upward
          var run = seed, probe = seed;
          while ((probe <<= 1) && (o & probe)) run |= probe;
          m |= run;
          seeds &= ~run;
        }
        rest[cc2] = m;
      }
      return rest;
    }

    var counter = 0, rounds = 0, total = 0, guard = 0, LIMIT = W * H * H;
    while (guard++ <= LIMIT) {
      var rest = restingOf(), k = [], link = false, any = false;
      var B = [];
      for (a = 1; a <= N; a++) {
        B[a] = [];
        for (c = 1; c <= W; c++) {
          B[a][c] = colour[a][c] & rest[c] & ~popping[c] & ~inert[c];
        }
      }
      for (c = 0; c <= W + 1; c++) k[c] = 0;
      for (a = 1; a <= N; a++) {
        for (c = 1; c <= W; c++) {
          var bb2 = B[a][c], cv = bb2 & (bb2 >> 1) & (bb2 >> 2);
          k[c] |= cv | (cv << 1) | (cv << 2);
        }
        for (c = 1; c + 2 <= W; c++) {
          var hc = B[a][c] & B[a][c + 1] & B[a][c + 2];
          k[c] |= hc; k[c + 1] |= hc; k[c + 2] |= hc;
        }
      }
      for (c = 1; c <= W; c++) { if (k[c]) any = true; if (k[c] & chaining[c]) link = true; }

      if (any) {
        rounds++;
        if (link) counter = counter === 0 ? 2 : counter + 1;
        var brokeGarbage = false;
        for (c = 1; c <= W; c++) {
          total += popcount(k[c]);
          popping[c] |= k[c];
          // Touching a slab pops a row of it, and the engine colours that row
          // from its own rng. Nothing past that point is knowable, so the pop
          // is counted and the cascade stops — the same place resolve() stops.
          if (k[c] & ((garb[c] >> 1) | (garb[c] << 1) | garb[c - 1] | garb[c + 1])) brokeGarbage = true;
        }
        if (brokeGarbage) {
          // HOW MANY GARBAGE PANELS THIS MATCH TOUCHES, because the engine's own
          // resolve time is FLASH + FACE + POP * (comboSize + onScreen) and
          // onScreen is exactly this count. A caller that only knows a slab was
          // hit cannot price the move; the slabs are in the state, so count them.
          //
          // The whole connected slab, not the cells beside the match: the engine
          // takes getConnectedGarbagePanels(matching), so touching one cell of a
          // slab pops a row of all of it.
          var touched = 0, converts = 0;
          for (var sl = 0; sl < st.slabs.length; sl++) {
            var sm2 = st.slabs[sl], hit = false, cc;
            for (cc = 1; cc <= W && !hit; cc++) {
              if (k[cc] & ((sm2[cc] >> 1) | (sm2[cc] << 1) | sm2[cc - 1] | sm2[cc + 1])) hit = true;
            }
            // TWO DIFFERENT NUMBERS, BECAUSE THE ENGINE USES TWO.
            //
            //   touched   every on-screen cell of the connected slab. This is the
            //             engine's `onScreen`, and it sets the RESOLVE time:
            //             preStop = FLASH + FACE + POP * (comboSize + onScreen).
            //             The whole slab pops, so the whole slab is counted.
            //
            //   converts  the slab's BOTTOM ROW. Only that row becomes real panels --
            //             convertGarbagePanels takes the row with yOffset === -1 and
            //             leaves the rest garbage, which is what makes garbage chains
            //             possible. This is what a break actually hands back.
            //
            // They were one field, and the callers want different ones: the resolve
            // time wants `touched`, the value of a break wants `converts`. Collapsing
            // them to the bottom row made the resolve time too short; leaving them as
            // the whole slab made a 6-wide 3-tall slab worth 18 converted cells where 6
            // convert, and bestPlan prices those at up to deadline/W -- about 100
            // frames early in a game -- so that break was valued near 1,800 frames
            // instead of 600, overstated by the slab's HEIGHT.
            if (hit) {
              for (cc = 1; cc <= W; cc++) touched += popcount(sm2[cc]);
              var low = 32, lm;
              for (cc = 1; cc <= W; cc++) {
                lm = sm2[cc] >>> 0;
                if (!lm) continue;
                var lb = 32 - Math.clz32(lm & -lm);
                if (lb < low) low = lb;
              }
              if (low < 32) {
                var lowBit = 1 << (low - 1);
                for (cc = 1; cc <= W; cc++) if (sm2[cc] & lowBit) converts++;
              }
            }
          }
          // NOTHING PAST HERE IS KNOWABLE. Touching a slab pops a row of it and
          // the engine colours that row from its own rng, so what those panels
          // go on to do depends on the draw. The numbers up to the break are
          // reported and the scope says which kind of answer this is, so a
          // caller cannot read a stopped cascade as a finished one.
          return { scope: 'garbage-broke', chain: Math.max(counter, 1),
                   total: total, rounds: rounds, garbage: touched,
                   converts: converts };
        }
        continue;
      }

      // Nothing new matched. Fall one row: a marked group is still in place and
      // still holds up what stands on it, and an inert cell does not move, so
      // only the panels between the hole and the first inert cell above it can
      // slide down.
      var fell = false;
      for (c = 1; c <= W; c++) {
        var hole = (~occ[c]) & (occ[c] + 1);
        var above = ~((hole << 1) - 1);
        var blockAbove = (inert[c] | popping[c]) & above;
        var ceiling = blockAbove & -blockAbove;          // lowest immovable cell
        var movable = occ[c] & above & (ceiling ? (ceiling - 1) : ~0);
        if (!movable) continue;
        fell = true;
        var below = hole - 1;
        var keepPut = occ[c] & ~movable & ~below;        // above the ceiling
        for (a = 1; a <= N; a++) {
          colour[a][c] = (colour[a][c] & below) | ((colour[a][c] & movable) >> 1) |
                         (colour[a][c] & keepPut);
        }
        chaining[c] = (chaining[c] & below) | ((chaining[c] & movable) >> 1) | (chaining[c] & keepPut);
        inert[c] = (inert[c] & below) | ((inert[c] & movable) >> 1) | (inert[c] & keepPut);
        occ[c] = (occ[c] & below) | (movable >> 1) | keepPut;
      }
      // THEN THE SLABS, which is the order resolve() falls them in.
      var slabFell = slabsThatFall();
      for (var sk = 0; sk < slabs.length; sk++) {
        if (!slabFell[sk]) continue;
        fell = true;
        for (c = 1; c <= W; c++) {
          var sb = slabs[sk][c];
          if (!sb) continue;
          occ[c] &= ~sb; inert[c] &= ~sb; garb[c] &= ~sb;
          slabs[sk][c] = sb >> 1;
          occ[c] |= slabs[sk][c]; inert[c] |= slabs[sk][c]; garb[c] |= slabs[sk][c];
        }
      }
      if (fell) continue;

      // Still, and nothing new matched: the marked cells leave now, and
      // everything above one of them is falling BECAUSE of that.
      var swept = false;
      for (c = 1; c <= W; c++) {
        if (!popping[c]) continue;
        swept = true;
        var lowest = popping[c] & -popping[c];
        var keep = occ[c] & ~popping[c];
        chaining[c] = (chaining[c] | (keep & ~(lowest - 1))) & keep;
        for (a = 1; a <= N; a++) colour[a][c] &= keep;
        inert[c] &= keep;
        occ[c] = keep;
        popping[c] = 0;
      }
      if (swept) continue;
      break;
    }
    return { scope: 'ok', chain: rounds ? Math.max(counter, 1) : 0, total: total,
             rounds: rounds,
             settled: wantSettled ? settledFrom(S2, W, H, N, slabs) : null };
  }

  // THE BOARD THE CASCADE LEFT, as a state of the same shape maskState builds.
  //
  // The resolver worked on a scratch copy and reported only what happened, so a
  // caller that needed the RESULTING position had no way to get it and went back
  // to the simulation for it -- which is the one thing this module exists to
  // replace. Returned rather than exposed as the scratch itself, because the
  // scratch is reused by the next call and a caller holding it would watch its
  // board change underneath it.
  //
  // Only on the 'ok' path: a stopped cascade has no settled board to hand back,
  // which is what 'garbage-broke' means.
  function settledFrom(S, W, H, N, slabs) {
    var stride = W + 2, out = { W: W, H: H, N: N, occ: [], inert: [], garb: [],
                                colour: new Int32Array((N + 1) * stride), slabs: [], bad: null };
    var a, c, i;
    for (c = 0; c <= W + 1; c++) {
      out.occ[c] = S.occ[c]; out.inert[c] = S.inert[c]; out.garb[c] = S.garb[c];
    }
    for (a = 1; a <= N; a++) for (c = 0; c <= W + 1; c++) out.colour[a * stride + c] = S.colour[a][c];
    // THE SLABS COME WITH IT. A slab is one mask per column it spans and it is
    // what makes garbage BRIDGE -- held up in one column it spans the holes in
    // the others. A settled state handed on without them is a state where every
    // slab has silently become loose cells, so the next resolve lets garbage
    // fall through gaps the game holds it over. Copied, not shared, because the
    // resolver reuses its own arrays on the next call.
    //
    // A slab with nothing left in any column has been fully cleared and is
    // dropped rather than carried as an empty.
    for (i = 0; slabs && i < slabs.length; i++) {
      var any = false;
      for (c = 0; c <= W + 1; c++) if (slabs[i][c]) { any = true; break; }
      if (any) out.slabs.push(Int32Array.from(slabs[i]));
    }
    return out;
  }

  // Calls go through this object so a test can swap one step for a broken one
  // and prove the check notices.
  var api = {
    popcount: popcount,
    topColour: topColour,
    restingMask: restingMask,
    colourMasks: colourMasks,
    clears: clears,
    maskState: maskState,
    swapMasks: swapMasks,
    legalSwapsOf: legalSwapsOf,
    anyOneSwapClear: anyOneSwapClear,
    bestOneSwapStop: bestOneSwapStop,
    reachMask: reachMask,
    copyState: copyState,
    risenMasks: risenMasks,
    resolveFromMasks: resolveFromMasks,
    clearedCells: clearedCells,
    resolveBits: resolveBits,
    settledFrom: settledFrom
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BitMatch = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
