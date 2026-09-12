// DOES THIS BOARD ALREADY CONTAIN A KNOWN CHAIN SHAPE?
//
// chips/ and chips-engine-only/ hold 5,000-odd chain templates ported from
// the owner's Panel Attack fork, each one verified to fire on a live engine.
// Until this file nothing read them: they were a library with no reader, and
// the bot's scoring could not see a single one of them.
//
// THIS IS AN OFFLINE TOOL. IT IS NOT A FEATURE AND MUST NOT BECOME ONE
// WITHOUT THE NUMBERS BELOW CHANGING FIRST.
//
// It was written to become one. The idea was sound on paper: 4,304 of the
// 4,875 distinct shapes take TWO swaps, chainPotential only looks one swap
// ahead, and searching the second swap is what the lookahead experiment
// measured and rejected. A chip is that second swap already solved, offline,
// once — lookup instead of search.
//
// Sampled before spending anything on it, against the 144 readable authored
// puzzle boards, and the sample refused it twice over:
//
//   1,975 us  to scan one board, against ~67 us for EVERY feature combined
//     738 us  restricted to shapes claiming chain >= 2
//     107 us  restricted to chain >= 3 — still 1.6x the whole budget
//
//   92% of boards match SOMETHING, 528 matches each. A signal that fires on
//   nearly every board cannot discriminate between boards. (chain >= 3 is
//   sharper: 13% of boards, ~23 matches — but it is the slice the library
//   barely has.)
//
// And the shape of the library itself: of 4,875 distinct shapes, 3,700 claim
// chain 2, 374 claim chain 3, and exactly THREE claim 4, 5 or 6. It is a
// catalogue of two-chain setups. It cannot teach a bot deep chains because
// it does not contain any.
//
// WHAT IT IS FOR INSTEAD. PUYO_REFERENCE.md is explicit that no Puyo bot
// carries thousands of literal templates: tier 1 is seven cheap numbers with
// zero chain logic, tier 2 SEARCHES for chain constructions, and the human
// forms those bots encode (GTR, stairs, sandwich) number a handful. The
// library's honest role is the one Puzzles.json already plays for the bench
// — ground truth, read offline where microseconds do not matter:
//
//   1. VALIDATION. Does staircase, or the corrected matchPotential, actually
//      predict a board containing a real chain shape? No feature here has
//      ever been checked against anything but a hand-built board.
//   2. DERIVATION. Cluster the shapes into recurring families and write one
//      cheap detector per family — which is what staircase already is for
//      the kaidan, but chosen by the data rather than by whoever was reading
//      the docs that day.
//
// A MATCH IS A WEAKER CLAIM THAN IT LOOKS, and this is the correction to the
// caution as first stated. It is not that unmentioned cells might be
// unsupported — a settled board has no floating panels, so support is free
// here in a way it never was in the verifier, which BUILDS boards rather
// than reading them. It is the mirror image: the verifier got to CHOOSE
// don't-care filler that provably cannot take part (the per-column distinct
// colour scheme), and a live board offers no such choice. Real colours in
// those cells can join the match, so a matched chip may clear more than it
// claims, or merge two links and clear less deeply. Claimed chain is an
// ESTIMATE, not a bound in either direction, and the way to settle it is to
// fire matched chips on the real engine — not to argue about it.
//
// WHAT A MATCH MEANS, STATED NARROWLY. A template says: these cells hold
// these colour SLOTS, these cells are empty, these cells hold a panel in no
// slot colour. It does NOT say what the unmentioned cells hold — and on a
// settled board that is safe in a way it was not in the verifier, because a
// real board has no floating panels: anything the template does not mention
// is either a panel resting on something or empty space above it. The risk
// that remains is the opposite one — a real board's actual colours can EXTEND
// a match the template sized on invented filler — so a match means "this
// shape is present", not "this shape clears exactly N". chipmatch.test.js
// measures how often the claim holds by firing matched chips on real boards.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('fs'), require('path'));
    else root.PanelEval = root.PanelEval || {}, root.PanelEval.chipmatch = factory(null, null);
}(this, function (fs, path) {
    'use strict';

    var EMPTY = 1, BLOCK = 2, SLOT = 3;

    // One compiled template: cells normalised so the lowest row and leftmost
    // column are 0, plus the span, so placement is a plain double loop.
    function compile(chip) {
        var cells = chip.tmpl;
        var minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
        for (var i = 0; i < cells.length; i++) {
            if (cells[i][0] < minR) minR = cells[i][0];
            if (cells[i][0] > maxR) maxR = cells[i][0];
            if (cells[i][1] < minC) minC = cells[i][1];
            if (cells[i][1] > maxC) maxC = cells[i][1];
        }
        var out = [];
        for (i = 0; i < cells.length; i++) {
            var k = cells[i][2];
            var kind = (k === '.' || k === 'e') ? EMPTY : (k === '@' ? BLOCK : SLOT);
            out.push({ dr: cells[i][0] - minR, dc: cells[i][1] - minC, kind: kind,
                       slot: kind === SLOT ? k : 0 });
        }
        // THE MOST CONSTRAINING CELLS FIRST. A template is rejected at its
        // first failing cell, so testing an EMPTY cell (one value passes) or
        // a BLOCK before the slots rejects most placements in one or two
        // reads instead of ten. Pure ordering — the set of matches is
        // unchanged, only how fast a non-match is found.
        out.sort(function (a, b) { return a.kind === b.kind ? 0 : (a.kind === EMPTY ? -1 : b.kind === EMPTY ? 1 : a.kind === BLOCK ? -1 : 1); });
        return { cells: out, h: maxR - minR, w: maxC - minC, chain: chip.chain,
                 nSwaps: chip.swaps.length, kind: chip.kind };
    }

    var LIBRARY = null;
    function library(dirs) {
        if (LIBRARY) return LIBRARY;
        var base = path.join(__dirname);
        var seen = {}, out = [];
        (dirs || ['chips', 'chips-engine-only']).forEach(function (d) {
            var dir = path.join(base, d);
            if (!fs.existsSync(dir)) return;
            fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort()
              .forEach(function (f) {
                JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).forEach(function (c) {
                    // MOVE_n is what a chip COSTS in cursor steps, not what
                    // it looks like; two chips with the same cells and the
                    // same swaps are one shape to a matcher.
                    var key = JSON.stringify(c.tmpl) + '#' + JSON.stringify(c.swaps);
                    if (seen[key]) { if (c.chain > seen[key].chain) seen[key].chain = c.chain; return; }
                    var comp = compile(c);
                    seen[key] = comp; out.push(comp);
                });
            });
        });
        LIBRARY = out;
        return LIBRARY;
    }

    // Slot -> colour for one placement. Reused across placements rather than
    // reallocated: this runs a few million times a second and a fresh object
    // per placement was most of the cost.
    // INT32, NOT INT8, AND THIS WAS A REAL BUG. `stamp` is an ever-rising
    // generation counter and these arrays hold the stamp a slot was last
    // written at. In an Int8Array the stored value truncates at 127, so from
    // the 128th call onward `slotSeen[s] === stamp` was comparing a truncated
    // byte against a full number and was essentially never true — which meant
    // the two constraints that give a template its teeth stopped being
    // enforced at all: cells sharing a colour slot no longer had to be the
    // same colour, and two different slots no longer had to be different
    // colours. The matcher degenerated into "are these cells non-empty".
    //
    // It matched 3,538 chips on a single real board and 92% of them cleared
    // NOTHING when fired. The tell was the number, not the code: a library
    // where nearly every shape is present on every board is not a library.
    // chipmatch.test.js pins the two constraints directly, and the real-board
    // measurement is what surfaced it — matching a chip against a board built
    // from that same chip passes either way, because there is only one
    // placement and one colour per slot to get wrong.
    var slotOf = new Int32Array(16);
    var slotSeen = new Int32Array(16);
    var colourTaken = new Int32Array(16);
    var stamp = 0;

    function matchAt(grid, tmpl, R, C) {
        var cells = tmpl.cells, n = cells.length, i, blockers = null;
        stamp++;
        for (i = 0; i < n; i++) {
            var cell = cells[i];
            var v = grid[R + cell.dr][C + cell.dc];
            if (cell.kind === EMPTY) { if (v !== 0) return false; continue; }
            if (v <= 0) return false;               // a real panel: not empty, not garbage, not busy
            if (cell.kind === BLOCK) {
                (blockers || (blockers = [])).push(v);
                continue;
            }
            var s = cell.slot;
            if (slotSeen[s] === stamp) { if (slotOf[s] !== v) return false; continue; }
            if (colourTaken[v] === stamp) return false;   // two slots cannot share a colour
            slotSeen[s] = stamp; slotOf[s] = v; colourTaken[v] = stamp;
        }
        // A blocker is "solid, and not a solving colour" — checked last,
        // because the slot colours are only all known once every slot cell
        // has been read.
        if (blockers) {
            for (i = 0; i < blockers.length; i++) if (colourTaken[blockers[i]] === stamp) return false;
        }
        return true;
    }

    // The deepest chain any known shape on this board claims, and how many
    // shapes matched. Returns both because "one 3-chain" and "forty of them"
    // are different boards and a single max cannot say which.
    function scan(board, opts) {
        var lib = library();
        var grid = board.grid, H = board.height, W = board.width;
        var minChain = (opts && opts.minChain) || 0;
        var best = 0, count = 0;
        for (var t = 0; t < lib.length; t++) {
            var tmpl = lib[t];
            if (tmpl.chain < minChain) continue;
            if (tmpl.chain <= best && !(opts && opts.countAll)) continue;  // cannot improve the max
            var maxR = H - tmpl.h, maxC = W - tmpl.w;
            for (var R = 1; R <= maxR; R++) {
                for (var C = 1; C <= maxC; C++) {
                    if (!matchAt(grid, tmpl, R, C)) continue;
                    count++;
                    if (tmpl.chain > best) best = tmpl.chain;
                    if (!(opts && opts.countAll)) { R = maxR + 1; break; }
                }
            }
        }
        return { best: best, count: count };
    }

    return { library: library, compile: compile, matchAt: matchAt, scan: scan,
             _kinds: { EMPTY: EMPTY, BLOCK: BLOCK, SLOT: SLOT } };
}));
