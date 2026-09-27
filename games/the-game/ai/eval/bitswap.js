// WHAT A SWAP CLEARS, WITHOUT SIMULATING IT.
//
// Every other path here answers this by DOING it: apply the swap, run gravity,
// look for runs. That is a loop, and a loop is where the closed form went to die
// last time — an earlier attempt derived which swaps make an atom from the masks
// alone and got 76%, because the other quarter are completed by a FALL and the
// fall was the part it could not write down.
//
// It can be written down. The whole of it rests on one fact:
//
//   ON A SETTLED BOARD EVERY COLUMN IS A PACKED RUN FROM THE FLOOR.
//
// So a column is entirely described by its height, and a swap does exactly two
// things to that description:
//
//   BOTH CELLS OCCUPIED — no hole opens, nothing falls, the two colours trade
//   places. Four bit operations.
//
//   ONE CELL EMPTY — the panel crosses into the empty column and lands on top of
//   that column's run, at height + 1, however far above it started. The cell it
//   left becomes a hole, and since the column was packed, everything above the
//   hole drops by exactly one. Both are shifts:
//
//       source:  (mask & below) | ((mask & above) >> 1)
//       target:  mask | (1 << height)
//
// No gravity loop, no settle, no resolve. The post-swap board is computed, then
// the ordinary match expression reads the atom off it.
//
// WHAT IT DOES NOT COVER, and says so rather than guessing: a column holding
// garbage is not a packed run of panels — a slab bridges the columns it spans and
// does not move when a panel below it leaves — so a swap touching such a column
// is reported out of scope. A board with panels still in the air is not settled
// at all, which is the premise.
//
// This answers the FIRST clear, which is the atom. What the atom sets off is a
// cascade, and that is bitmatch's loop.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./bitmatch.js'));
    else root.BitSwap = factory(root.BitMatch);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (bit) {
    'use strict';

    function popcount(x) { var n = 0; while (x) { x &= x - 1; n++; } return n; }

    // A packed column's height is its popcount, and the premise is that it is
    // packed — asserted rather than assumed, because the whole derivation is
    // wrong on a column with a hole in it.
    function packed(occ) { return occ === ((1 << popcount(occ)) - 1); }

    // THE POST-SWAP BOARD, IN CLOSED FORM.
    //
    // st is a bitmatch maskState of a SETTLED board. Returns new colour masks
    // for the two columns the swap touches, or a reason it cannot.
    function after(st, r, c) {
        var W = st.W, stride = W + 2, o = c + 1, N = st.N, a;
        if (c < 1 || c >= W || r < 1 || r > st.H) return { scope: 'off-board' };
        if (st.garb[c] || st.garb[o]) return { scope: 'garbage-column' };
        if (!packed(st.occ[c]) || !packed(st.occ[o])) return { scope: 'not-settled' };

        var bit_r = 1 << (r - 1);
        var left = 0, right = 0;
        for (a = 1; a <= N; a++) {
            if (st.colour[a * stride + c] & bit_r) left = a;
            if (st.colour[a * stride + o] & bit_r) right = a;
        }
        if (!left && !right) return { scope: 'both-empty' };

        var colC = [], colO = [];
        for (a = 1; a <= N; a++) {
            colC[a] = st.colour[a * stride + c];
            colO[a] = st.colour[a * stride + o];
        }

        if (left && right) {
            // BOTH OCCUPIED: they trade places and nothing moves vertically.
            colC[left] &= ~bit_r; colO[left] |= bit_r;
            colO[right] &= ~bit_r; colC[right] |= bit_r;
            return { scope: 'ok', c: colC, o: colO, occC: st.occ[c], occO: st.occ[o], fell: false };
        }

        // ONE EMPTY: the panel crosses, lands on the other column's run, and the
        // hole it left closes.
        var from = left ? c : o, to = left ? o : c;
        var colour = left || right;
        var fromCol = left ? colC : colO, toCol = left ? colO : colC;
        var below = bit_r - 1;
        var above = ~((bit_r << 1) - 1);
        for (a = 1; a <= N; a++) {
            fromCol[a] = (fromCol[a] & below) | ((fromCol[a] & above) >> 1);
        }
        var occFrom = (st.occ[from] & below) | ((st.occ[from] & above) >> 1);
        // It lands ON TOP of the run it joins — height + 1 — not where it was
        // pushed, because the cell it was pushed into was empty and so is
        // everything between there and the top of that column.
        var landing = 1 << popcount(st.occ[to]);
        toCol[colour] |= landing;
        var occTo = st.occ[to] | landing;

        return { scope: 'ok',
                 c: colC, o: colO,
                 occC: left ? occFrom : occTo,
                 occO: left ? occTo : occFrom,
                 fell: true };
    }

    // The atom the swap makes, read off the computed board with the ordinary
    // match expression. Returns the cleared cells of the two columns AND of the
    // neighbours a horizontal run can reach.
    function clears(st, r, c) {
        var res = api.after(st, r, c);
        if (res.scope !== 'ok') return { scope: res.scope, total: 0, cells: {} };
        var W = st.W, stride = W + 2, N = st.N, o = c + 1, a, col;

        // The board as it now stands: two columns replaced, the rest untouched.
        var B = [];
        for (a = 1; a <= N; a++) {
            B[a] = [];
            for (col = 0; col <= W + 1; col++) {
                B[a][col] = col === c ? res.c[a] : (col === o ? res.o[a] : st.colour[a * stride + col]);
            }
        }
        var k = [];
        for (col = 0; col <= W + 1; col++) k[col] = 0;
        for (a = 1; a <= N; a++) {
            for (col = 1; col <= W; col++) {
                var b = B[a][col], cv = b & (b >> 1) & (b >> 2);
                k[col] |= cv | (cv << 1) | (cv << 2);
            }
            for (col = 1; col + 2 <= W; col++) {
                var hc = B[a][col] & B[a][col + 1] & B[a][col + 2];
                k[col] |= hc; k[col + 1] |= hc; k[col + 2] |= hc;
            }
        }
        var total = 0, cells = {};
        for (col = 1; col <= W; col++) {
            total += popcount(k[col]);
            for (var bitN = 0; bitN < st.H; bitN++) {
                if (k[col] & (1 << bitN)) cells[(bitN + 1) + ':' + col] = true;
            }
        }
        return { scope: 'ok', total: total, cells: cells, fell: res.fell };
    }

    // Calls go through this object so a test can replace the post-swap board
    // with a wrongly-derived one and prove the sweep notices.
    var api = { after: after, clears: clears, packed: packed };
    return api;
}));
