// Shared, standardized end-of-run summary for every harness in this
// directory. Printed to STDERR (never stdout) so every harness's stdout
// stays pure JSON for tooling that captures and parses it whole
// (sweep_real.sh's `out=$(node ... )` would break if anything but the
// JSON object landed on stdout) -- a human running a harness directly in
// a terminal sees both: the summary block first, then the JSON line.
//
// Reports two things every harness call was asked for: survival time as
// MM:SS (not just raw frames/seconds), and a breakdown of SENT garbage by
// type -- not just a total cell count, which conflates a combo-heavy AI
// with a chain-heavy one. Categories mirror how the real engine itself
// treats these differently (Stack.pushGarbage/awardStopTime,
// panel-engine.js): combo garbage is 1-row-tall slabs 3-6 wide
// (COMBO_GARBAGE table); chain garbage is always 6 wide and N tall, N
// being the chain length. "big block" (the user's term) = the widest
// combo tier (5-6 wide, i.e. a 10+ panel combo); chain length buckets
// follow the same short/medium/long break points Stack.awardStopTime
// itself uses to escalate stop-time payout.
(function () {
  function mmss(frames) {
    var totalSeconds = Math.floor(frames / 60);
    var m = Math.floor(totalSeconds / 60), s = totalSeconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function classify(g) {
    if (g.isChain) {
      if (g.height <= 3) return 'chain-short';
      if (g.height <= 6) return 'chain-medium';
      return 'chain-long';
    }
    return g.width >= 5 ? 'combo-big' : 'combo-small';
  }

  var CATEGORY_ORDER = ['combo-small', 'combo-big', 'chain-short', 'chain-medium', 'chain-long'];
  var CATEGORY_LABEL = {
    'combo-small': 'small combo (3-4 wide)',
    'combo-big': 'big combo (5-6 wide)',
    'chain-short': 'short chain (2-3 links)',
    'chain-medium': 'medium chain (4-6 links)',
    'chain-long': 'long chain (7+ links)'
  };

  // sentRecords: array of {width, height, isChain} as returned by
  // Stack.takeDeliverableGarbage(), accumulated by the caller over the run.
  function summarize(sentRecords) {
    var byCat = {};
    CATEGORY_ORDER.forEach(function (c) { byCat[c] = { cells: 0, pieces: 0 }; });
    var totalCells = 0;
    sentRecords.forEach(function (g) {
      var cat = classify(g), cells = g.width * g.height;
      byCat[cat].cells += cells;
      byCat[cat].pieces += 1;
      totalCells += cells;
    });
    return { byCat: byCat, totalCells: totalCells, totalPieces: sentRecords.length };
  }

  // Flattens summarize()'s byCat into plain {catCells, catPieces, ...}
  // fields, safe to spread straight into a harness's JSON result object.
  function summaryFields(sentRecords) {
    var s = summarize(sentRecords);
    var out = { garbageCellsSent: s.totalCells, garbagePiecesSent: s.totalPieces };
    CATEGORY_ORDER.forEach(function (c) {
      out[c.replace(/-([a-z])/g, function (_, ch) { return ch.toUpperCase(); }) + 'Cells'] = s.byCat[c].cells;
      out[c.replace(/-([a-z])/g, function (_, ch) { return ch.toUpperCase(); }) + 'Pieces'] = s.byCat[c].pieces;
    });
    return out;
  }

  function formatSummary(label, framesAlive, sentRecords) {
    var s = summarize(sentRecords);
    var lines = [];
    lines.push('=== ' + label + ' ===');
    lines.push('Survived: ' + mmss(framesAlive) + ' (' + framesAlive + ' frames)');
    lines.push('Sent: ' + s.totalCells + ' cells in ' + s.totalPieces + ' pieces');
    CATEGORY_ORDER.forEach(function (c) {
      var e = s.byCat[c];
      if (e.pieces === 0) return;
      var pct = s.totalCells > 0 ? (100 * e.cells / s.totalCells).toFixed(0) : '0';
      lines.push('  ' + CATEGORY_LABEL[c] + ': ' + e.cells + ' cells (' + e.pieces + ' pieces, ' + pct + '%)');
    });
    return { lines: lines, summary: s };
  }

  // For harnesses whose stdout is captured whole as JSON by other tooling
  // (sweep_real.sh's `out=$(node ...)`) -- keeps the human-readable block
  // off stdout so it can't corrupt that capture.
  function printSummary(label, framesAlive, sentRecords) {
    var f = formatSummary(label, framesAlive, sentRecords);
    process.stderr.write(f.lines.join('\n') + '\n');
    return f.summary;
  }

  // For a standalone report tool (full_report.js) with no JSON consumer
  // capturing its stdout -- the summary IS the output a human reads.
  function printSummaryToStdout(label, framesAlive, sentRecords) {
    var f = formatSummary(label, framesAlive, sentRecords);
    process.stdout.write(f.lines.join('\n') + '\n\n');
    return f.summary;
  }

  module.exports = {
    mmss: mmss, classify: classify, summarize: summarize,
    summaryFields: summaryFields, printSummary: printSummary,
    printSummaryToStdout: printSummaryToStdout,
    CATEGORY_ORDER: CATEGORY_ORDER, CATEGORY_LABEL: CATEGORY_LABEL
  };
})();
