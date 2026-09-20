#!/usr/bin/env node
// WHAT DOES THIS WEIGHT SET ACTUALLY FIRE? — chains by link, combos by size.
//
//   node chaincombo.bench.js                  the shipped bot
//   node chaincombo.bench.js <snapshot.json>  a specific weight set
//   GC_GAMES=12                               games per scenario (default 6)
//
// THE GAP THIS EXISTS FOR. Nothing in the loop selects on chain length.
// `chainByLinks` is reported in every snapshot and then thrown away, and the
// fitness is one bit — who tops out first — so a bot that never chains and a
// bot that chains constantly score the same as long as they survive equally.
// Before changing anything to make the bot chain, there has to be a number
// that says whether it chained, or a change cannot be told from noise.
//
// IT IS THE ENGINE'S OWN ACCOUNT, FROM THE RESOLVE. Every number here comes
// from the events the engine emits for itself as a cascade settles:
// `chainEnd` carries the finished chain's true length, a `match` without a
// chain flag carries the size of a one-off clear. Nothing is derived and
// nothing is estimated. In particular it does NOT come from BoardSim, which
// settles the whole board before matching and so merges clears the engine
// fires frames apart — fine for planning, wrong for scoring what happened.
//
// PER MINUTE, NOT PER GAME. Raw counts are uncomparable the moment game
// length moves: the same bot measured over a 25-second game and a 7-minute
// game shows 132 threes and 2,300 threes, and neither number says anything
// about its behaviour. Every figure below is divided by minutes played.
//
// THE SCORE IS THE GAME'S OWN. A chain and a combo are different attacks
// with different payout tables, and this file does not invent a third: it
// asks PanelEngine.moveScore what the game would pay for what it fired.
// That is what makes a 5-link worth more than fifteen 4-wides here, as it is
// in the game. Point at a standard, never copy it.
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));

var fs = require('fs');
var bench = require('./bench.js');
var switches = require('./switches.js');

var G = (typeof window !== 'undefined' ? window : globalThis);
var loaded = switches.load(process.argv[2]);
var GAMES = Number(process.env.GC_GAMES || 6);
var SCENARIOS = (process.env.GC_ARENA || 'endless,comboStorm,factory').split(',');

function add(into, from) { for (var k in from) into[k] = (into[k] || 0) + from[k]; }
function hist(o) {
    var keys = Object.keys(o).map(Number).sort(function (a, b) { return a - b; });
    return keys.length ? keys.map(function (k) { return k + '×' + o[k]; }).join('  ') : '(none)';
}

var chain = {}, combo = {}, minutes = 0, sent = 0, deaths = 0, games = 0;
console.log('weights: ' + loaded.source + (loaded.forced ? ' (switches forced)' : ''));
console.log('switches: depth ' + loaded.switches.depth + '  beam ' + loaded.switches.beam +
            '  rise ' + (loaded.switches.rise ? 'on' : 'off') +
            '  density ' + (loaded.switches.density ? 'on' : 'off') +
            '  modes ' + (loaded.switches.modes
                ? 'ON (' + loaded.switches.fireLinks + ' links / ' + loaded.switches.fireWide +
                  ' wide / margin ' + loaded.switches.forcedMargin +
                  (loaded.switches.riseAware ? ' / rise-aware' : ' / rise-BLIND') + ')'
                : 'off'));
console.log('playing ' + GAMES + ' games x ' + SCENARIOS.length + ' scenario(s): ' + SCENARIOS.join(', '));

var modeTotals = { BUILD: 0, FIRE: 0, FORCED: 0 }, broken = 0, payless = 0, riseUn = 0;
SCENARIOS.forEach(function (sc) {
    for (var seed = 1; seed <= GAMES; seed++) {
        var r = bench.run(loaded.weights, seed, {
            brain: 'puyo', scenario: sc, checkTiming: false,
            depth: loaded.switches.depth, beam: loaded.switches.beam,
            rise: loaded.switches.rise, density: loaded.switches.density,
            modes: loaded.switches.modes, fireLinks: loaded.switches.fireLinks,
            fireWide: loaded.switches.fireWide, forcedMargin: loaded.switches.forcedMargin,
            riseAware: loaded.switches.riseAware
        });
        add(chain, r.chain); add(combo, r.combo);
        minutes += r.frames / 60 / 60;
        sent += r.sent;
        modeTotals.BUILD += r.modeCounts.BUILD;
        modeTotals.FIRE += r.modeCounts.FIRE;
        modeTotals.FORCED += r.modeCounts.FORCED;
        broken += r.brokenPlans;
        payless += r.payless;
        riseUn += r.riseUnavoidable;
        if (r.died) deaths++;
        games++;
    }
});

// The game's own valuation of what it fired. moveScore takes the sizes of
// one move's clears; a chain of N links is N clears that chained, so it is
// priced as the chain it was rather than as N separate combos.
function pointsFor(chainHist, comboHist) {
    var engine = G.PanelEngine, total = 0, k;
    if (!engine || !engine.moveScore) return null;
    for (k in comboHist) total += engine.moveScore([Number(k)]) * comboHist[k];
    for (k in chainHist) {
        var links = Number(k), sizes = [];
        for (var i = 0; i < links; i++) sizes.push(3);   // the minimum clear per link
        total += engine.moveScore(sizes) * chainHist[k];
    }
    return total;
}

var per = function (n) { return (n / minutes).toFixed(1); };
var chainFired = 0, comboFired = 0, deepFired = 0, bigFired = 0, k;
for (k in chain) { chainFired += chain[k]; if (Number(k) >= 4) deepFired += chain[k]; }
for (k in combo) { comboFired += combo[k]; if (Number(k) >= 4) bigFired += combo[k]; }

console.log('');
console.log('chains by link : ' + hist(chain));
console.log('combos by size : ' + hist(combo));
console.log('');
console.log('minutes played : ' + minutes.toFixed(1) + '   games ' + games + '   died ' + deaths);
console.log('chains   /min  : ' + per(chainFired) + '      4+ links /min : ' + per(deepFired));
console.log('combos   /min  : ' + per(comboFired) + '      4+ wide  /min : ' + per(bigFired));
console.log('garbage  /min  : ' + per(sent));
// THE THREES THAT BOUGHT NOTHING. A 3 that ate garbage is progress and sits
// in the same histogram bucket as one that did not, so the bucket alone
// cannot say whether the bot is still grinding. This can.
console.log('payless  /min  : ' + per(payless) + '   (' + payless + ' bare 3s of ' +
            (combo[3] || 0) + ' threes)');
// THE DIAGNOSTIC THAT SAYS WHY, printed beside the numbers it explains. A
// flat bench with FORCED on most decisions and a flat bench with FORCED on
// almost none are opposite bugs, and nothing above separates them. Broken
// plans are work already spent that paid nothing — the number step 2 exists
// to drive down.
var modeSum = modeTotals.BUILD + modeTotals.FIRE + modeTotals.FORCED;
if (modeSum) {
    var share = function (n) { return (100 * n / modeSum).toFixed(0) + '%'; };
    console.log('modes          : build ' + share(modeTotals.BUILD) +
                '   fire ' + share(modeTotals.FIRE) +
                '   forced ' + share(modeTotals.FORCED) +
                '   (' + modeSum + ' decisions)');
    console.log('rise forced    : ' + riseUn + ' decisions where every build move rose into a bare 3');
    console.log('broken plans   : ' + broken + '   ' + (broken / Math.max(1, games)).toFixed(1) + ' per game');
}
var pts = pointsFor(chain, combo);
console.log('game points/min: ' + (pts === null ? '(engine not loaded)' : per(pts)) +
            '   <- the number to move');
