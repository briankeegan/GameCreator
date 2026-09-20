// THE MATCH RULE, ONCE.
//
// Panel Attack clears a run of three or more of one colour, horizontally or
// vertically. panel-engine.js walks its panel objects to find them and
// panel-cpu.js's LogicalBoard walks a grid of integers, and until this module
// each had its own copy of the scan. Two copies of a rule drift, and the
// whole question "does the bot plan on the board that will happen" reduces to
// whether they have.
//
// So the scan lives here and both call it. What each caller still owns is
// deciding which cells are MATCHABLE — the engine knows about panel states
// and matchAnyway, the simulation knows about resting and popping — and that
// is the right seam: the eligibility rules are genuinely different views of
// the same board, while the run rule is one rule.
//
// eff is a flat array of EFFECTIVE COLOURS, row-major with the given stride,
// where 0 means "cannot take part in a match" whatever the reason. Cells are
// addressed eff[r * stride + c], 1..h by 1..w.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PanelRules = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // Calls mark(row, col) once for every cell in a run of 3 or more. A cell
    // in both a horizontal and a vertical run is marked twice; every caller
    // already de-duplicates, and de-duplicating here would cost an allocation
    // in the hottest loop the bot has.
    function scanRuns(eff, w, h, stride, mark) {
        var r, c, i, colour, runStart, runLen, runColour;

        for (r = 1; r <= h; r++) {
            var rbase = r * stride;
            runStart = 0; runLen = 0; runColour = 0;
            // One past the end, so a run that reaches the wall is closed.
            for (c = 1; c <= w + 1; c++) {
                colour = c <= w ? eff[rbase + c] : 0;
                if (colour > 0 && (runLen === 0 || runColour === colour)) {
                    if (runLen === 0) { runStart = c; runColour = colour; }
                    runLen++;
                } else {
                    if (runLen >= 3) for (i = 0; i < runLen; i++) mark(r, runStart + i);
                    if (colour > 0) { runStart = c; runLen = 1; runColour = colour; }
                    else { runLen = 0; runColour = 0; }
                }
            }
        }

        for (c = 1; c <= w; c++) {
            runStart = 0; runLen = 0; runColour = 0;
            for (r = 1; r <= h + 1; r++) {
                colour = r <= h ? eff[r * stride + c] : 0;
                if (colour > 0 && (runLen === 0 || runColour === colour)) {
                    if (runLen === 0) { runStart = r; runColour = colour; }
                    runLen++;
                } else {
                    if (runLen >= 3) for (i = 0; i < runLen; i++) mark(runStart + i, c);
                    if (colour > 0) { runStart = r; runLen = 1; runColour = colour; }
                    else { runLen = 0; runColour = 0; }
                }
            }
        }
    }

    return { scanRuns: scanRuns };
}));
