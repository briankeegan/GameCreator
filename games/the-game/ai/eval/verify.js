// THE VERDICT TOOL. Run: node verify.js trained.add.json [seeds] [startSeed]
//
// Training reports a mean over six held-out seeds. That is enough to catch
// a disaster and nowhere near enough to trust a few percent, so nothing
// gets proposed for shipping on it.
//
// This runs the trained weights and the shipped baseline over a WIDE seed
// set, on BOTH drills, and prints EVERY SEED rather than only the mean. A
// mean that improves while half the seeds get worse is a completely
// different fact from a mean that improves because every seed improved,
// and only the per-seed list distinguishes them — the same reason the door
// grid in browser.test.js collects its failures instead of throwing on the
// first one.
//
// Single-threaded on purpose: the timing guard measures wall-clock inside
// _choose, and under parallel load it is meaningless (it rejected the
// SHIPPED baseline as unsafe during training, which is why training turns
// it off). Here it is on and it means something.
var fs = require('fs');
var bench = require('./bench.js');
var registry = require('./registry.js');

var file = process.argv[2];
if (!file) { console.error('usage: node verify.js <trained.json> [seeds] [startSeed]'); process.exit(2); }
var COUNT = Number(process.argv[3] || 30);
var START = Number(process.argv[4] || 100);   // far from any seed used in training

var trained = JSON.parse(fs.readFileSync(file, 'utf8'));
var weights = trained.weights || trained;
var mode = trained.mode || 'add';

var zeros = {};
registry.keys.forEach(function (k) { zeros[k] = 0; });

var seeds = [];
for (var i = 0; i < COUNT; i++) seeds.push(START + i);

function mean(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }

// QUALITY AND TIMING ARE MEASURED SEPARATELY, AND HAVE TO BE.
//
// bench.run BREAKS OUT of the game loop when the timing guard trips. So a
// config that is slow on a seed does not merely get flagged there — its run
// is cut short and its score truncated, and the quality comparison then
// reports a number made partly of that truncation. Measured: the learned
// set read -5.5% on build with 7 of 30 seeds cut off early, which is a
// mixture of "scores less" and "was stopped".
//
// So quality runs with the guard OFF, where every run plays to its natural
// end, and timing runs as its own pass. Both still single-threaded, since
// wall-clock under parallel load means nothing.
function arm(w, scenario) {
    return seeds.map(function (s) {
        return bench.run(w, s, { mode: mode, scenario: scenario, checkTiming: false });
    });
}

function timingArm(w, scenario) {
    return seeds.map(function (s) {
        return bench.run(w, s, { mode: mode, scenario: scenario });
    });
}

console.log('verifying ' + file + '  mode=' + mode + '  seeds ' + START + '-' + (START + COUNT - 1));
console.log('weights: ' + (registry.keys.filter(function (k) { return weights[k] > 0.5; })
    .map(function (k) { return k + '=' + weights[k].toFixed(0); }).join(' ') || '(all zero)'));

var overall = {};
['build', 'siege'].forEach(function (scenario) {
    var shipped = arm(null, scenario);
    var learned = arm(weights, scenario);

    // COMPARE THE QUANTITY THE WEIGHTS WERE TRAINED ON.
    //
    // This tool originally compared frames survived, because it was written
    // when survival was the objective. The weights it is now asked to judge
    // were trained on SCORE, and the two disagree wildly: the same weight
    // set that reads +81% on score reads +1.4% on frames. Neither number is
    // wrong; only one of them is the question.
    //
    // So the metric follows the objective recorded in the trained file, and
    // the other quantities are printed beside it as diagnostics — a set
    // that wins on score while losing frames is a real and interesting
    // result, and it must be visible rather than hidden by whichever
    // column the tool happened to be built around.
    var metric = trained.objective === 'score' ? 'score' : 'frames';
    var sf = shipped.map(function (r) { return r[metric]; });
    var lf = learned.map(function (r) { return r[metric]; });
    var sFrames = shipped.map(function (r) { return r.frames; });
    var lFrames = learned.map(function (r) { return r.frames; });
    var sSent = shipped.map(function (r) { return r.sent; });
    var lSent = learned.map(function (r) { return r.sent; });
    var better = 0, worse = 0, same = 0;
    var lines = [];
    for (var i = 0; i < seeds.length; i++) {
        var d = lf[i] - sf[i];
        if (d > 0) better++; else if (d < 0) worse++; else same++;
        lines.push('  seed ' + String(seeds[i]).padStart(4) + '  shipped ' + String(sf[i]).padStart(6) +
                   '  learned ' + String(lf[i]).padStart(6) + '  ' + (d >= 0 ? '+' : '') + String(d).padStart(6) +
                   '   (frames ' + sFrames[i] + '->' + lFrames[i] +
                   ', sent ' + sSent[i] + '->' + lSent[i] + ')');
    }
    var pct = mean(sf) ? ((mean(lf) - mean(sf)) / mean(sf)) * 100 : 0;
    var timed = timingArm(weights, scenario);
    var unsafe = timed.filter(function (r) { return r.unsafe; }).length;
    var worstMs = Math.max.apply(null, timed.map(function (r) { return r.localMax; }));

    console.log('\n=== ' + scenario + ' === (metric: ' + metric + ', the trained objective)');
    console.log(lines.join('\n'));
    console.log('  mean  shipped ' + mean(sf).toFixed(0) + '  learned ' + mean(lf).toFixed(0) +
                '  ' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%   [' + metric + ']');
    console.log('  frames  shipped ' + mean(sFrames).toFixed(0) + '  learned ' + mean(lFrames).toFixed(0) +
                '   |  sent  shipped ' + mean(sSent).toFixed(1) + '  learned ' + mean(lSent).toFixed(1));
    console.log('  seeds better ' + better + ', worse ' + worse + ', identical ' + same);
    console.log('  worst decision ' + worstMs + 'ms, unsafe seeds ' + unsafe + '/' + seeds.length +
                '   (measured in its own pass, so no run is truncated)');

    // The bar, stated in the tool rather than in someone's head.
    var verdict;
    if (unsafe) verdict = 'REJECT — a config that cannot decide inside a frame is broken, not fast';
    else if (Math.abs(pct) < 3) verdict = 'NO RESULT — under 3% is noise at this sample size';
    else if (pct > 0 && better <= worse) verdict = 'SUSPECT — the mean improved but no more seeds did';
    else if (pct > 0) verdict = 'IMPROVEMENT';
    else verdict = 'WORSE';
    console.log('  verdict: ' + verdict);
    overall[scenario] = { pct: pct, better: better, worse: worse, unsafe: unsafe, verdict: verdict };
});

console.log('\n=== OVERALL ===');
var b = overall.build, s = overall.siege;
if (b.verdict === 'IMPROVEMENT' && s.verdict === 'WORSE') {
    console.log('SPECIALISED: wins the drill it trained on, loses the one it did not. Not better.');
} else if (b.verdict === 'IMPROVEMENT' && s.verdict === 'IMPROVEMENT') {
    console.log('GENUINE: improves both drills, including one it never trained against.');
} else {
    console.log('build: ' + b.verdict + '   |   siege: ' + s.verdict);
}
