#!/usr/bin/env node
// WHY DID IT DIE: COULD IT NOT SEE, OR DID IT NOT CHOOSE?
//
//   node why_died.js 101:rand2:rand3
//
// Every death this session was diagnosed by reading the 60-decision ring and
// guessing, and the guesses were wrong three times out of three -- holds during a
// cascade looked like idling (3 idle holds in a game, not 30), `raise no` looked
// like the raise being blocked (it fired 621 times), and the depth looked capped at
// 2 (it is 20). Six changes went into widening a search that was not narrow.
//
// So this does not print a trace. It answers the two questions a death can have, as
// counts:
//
//   SEEN     for every decision with garbage on the board, a 1- and 2-swap break is
//            enumerated INDEPENDENTLY of the search, and compared against whether
//            options() returned anything marked `breaks`. "Existed but not listed"
//            is a search problem. Anything else is not.
//
//   CHOSE    for every decision that HAD a break on the list, which mode and which
//            route actually played. A route that wins while a break is available is
//            a route taking precedence over breaking, which is a priority problem
//            and lives in the route order, not in the search.
//
// On seed 101 rand2 v rand3 this said: 1,717 of 3,775 buried decisions had a break
// listed, no one-swap break was ever missed, and 314 of 681 of them played
// levelFirst -- the flatten that precedes a raise, which is the FIRST route in the
// order. That is the whole diagnosis, and it took one run.
var path = require('path');
var EV = __dirname;
require(path.join(EV, '..', '..', 'panel-engine.js'));
require(path.join(EV, '..', '..', 'panel-cpu.js'));
var bo = require(path.join(EV, 'bitoptions.js'));
var bit = require(path.join(EV, 'bitmatch.js'));
var BitBot = require(path.join(EV, 'bitbot.js'));

var PAIR = process.argv[2];
if (!PAIR || !/^\d+:[A-Za-z0-9]+:[A-Za-z0-9]+$/.test(PAIR)) {
    console.error('usage: node why_died.js <seed:A:B>   e.g. 101:rand2:rand3');
    process.exit(2);
}

var seen = { calls: 0, truth: 0, listed: 0, truthOnly: 0, missedOne: 0 };
var chose = {};
var hadBreak = false;

// GROUND TRUTH, not the search's opinion: every legal swap, resolved, then every
// legal swap of each settled board. Expensive, which is why it is a tool and not a
// gate.
function reallyBreaks(st) {
    var sw = bit.legalSwapsOf(st), i, j, r;
    for (i = 0; i < sw.length; i++) {
        if (!bit.swapMasks(st, sw[i][0], sw[i][1])) continue;
        r = bit.resolveFromMasks(st, true);
        bit.swapMasks(st, sw[i][0], sw[i][1]);
        if (r.scope === 'garbage-broke') return 1;
    }
    for (i = 0; i < sw.length; i++) {
        if (!bit.swapMasks(st, sw[i][0], sw[i][1])) continue;
        r = bit.resolveFromMasks(st, true);
        bit.swapMasks(st, sw[i][0], sw[i][1]);
        if (!r.settled || r.total > 0) continue;
        var sw2 = bit.legalSwapsOf(r.settled);
        for (j = 0; j < sw2.length; j++) {
            if (!bit.swapMasks(r.settled, sw2[j][0], sw2[j][1])) continue;
            var r2 = bit.resolveFromMasks(r.settled, false);
            bit.swapMasks(r.settled, sw2[j][0], sw2[j][1]);
            if (r2.scope === 'garbage-broke') return 2;
        }
    }
    return 0;
}

var realOptions = bo.options;
bo.options = function (board, W, H, cursor, depth, st, timing, dig) {
    var out = realOptions.apply(this, arguments);
    if (st && out && out.now) {
        var garb = false;
        for (var c = 1; c <= (st.W || 6); c++) if (st.garb[c]) { garb = true; break; }
        if (garb) {
            var listed = out.now.concat(out.next || []).some(function (o) { return o.breaks; });
            var d = reallyBreaks(st);
            seen.calls++;
            if (d) seen.truth++;
            if (listed) seen.listed++;
            if (d && !listed) { seen.truthOnly++; if (d === 1) seen.missedOne++; }
            hadBreak = listed;
        }
    }
    return out;
};

// AND THE THIRD QUESTION, WHICH IS NOT ABOUT BREAKS: WITH A CLEAR ON THE BOARD,
// DID IT CASH? Two deaths read the same way -- the stack rising a row at a time with
// `clr` 1 on every decision and the move clearing nothing. 101 rand2 v rand3 went
// 5,5,5,5,5,5 to 8,8,8,8,8,8 over 25 decisions and 450 frames holding one three, no
// garbage on the board and none incoming, and died at 4,543.
//
// Counted per height band, because "held a clear" is correct play on a low board and
// is how a board dies on a high one. A route that appears only in the tall bands is
// the one refusing to cash when cashing is the job.
var passed = {}, byBand = {};
function bandOf(t) {
    return t <= 4 ? ' 0-4' : t <= 6 ? ' 5-6' : t <= 8 ? ' 7-8' : t <= 10 ? ' 9-10' : '11-12';
}
function bestClearOf(st) {
    var sw = bit.legalSwapsOf(st), best = 0, i, r;
    for (i = 0; i < sw.length; i++) {
        if (!bit.swapMasks(st, sw[i][0], sw[i][1])) continue;
        r = bit.resolveFromMasks(st, true);
        bit.swapMasks(st, sw[i][0], sw[i][1]);
        if (r.total > best) best = r.total;
        if (r.scope === 'garbage-broke' && best < 1) best = 1;
    }
    return best;
}
function clearsOf(st, mv) {
    if (!bit.swapMasks(st, mv[0], mv[1])) return 0;
    var r = bit.resolveFromMasks(st, true);
    bit.swapMasks(st, mv[0], mv[1]);
    return (r.total || 0) + (r.scope === 'garbage-broke' ? 1 : 0);
}

var realDecide = BitBot.prototype.decide;
BitBot.prototype.decide = function () {
    hadBreak = false;
    var d = realDecide.apply(this, arguments);
    if (hadBreak && d) {
        var k = (d.mode && d.mode.name ? d.mode.name : '?') + ' / ' + (d.via || '?');
        chose[k] = (chose[k] || 0) + 1;
    }
    var st = this._lastBase;
    if (d && st) {
        var tall = 0, c;
        for (c = 1; c <= 6; c++) {
            var t = 32 - Math.clz32(st.occ[c] >>> 0);
            if (t > tall) tall = t;
        }
        var avail = bestClearOf(st);
        if (avail > 0) {
            var took = d.kind === 'swap' && d.move ? clearsOf(st, d.move) : 0;
            var band = bandOf(tall);
            var b = byBand[band] || (byBand[band] = { had: 0, took: 0 });
            b.had++;
            if (took > 0) b.took++;
            else {
                var kk = band + '  ' + (d.mode && d.mode.name ? d.mode.name : '?') +
                         ' / ' + (d.via || '?');
                passed[kk] = (passed[kk] || 0) + 1;
            }
        }
    }
    return d;
};

process.on('exit', function () {
    console.log('');
    console.log('SEEN -- can the search see a break that is really there?');
    console.log('  buried decisions examined            ' + seen.calls);
    console.log('  a 1- or 2-swap break really existed   ' + seen.truth);
    console.log('  the option list contained a break     ' + seen.listed);
    console.log('  existed but NOT on the list           ' + seen.truthOnly +
                '   <- a search problem only if this is large');
    console.log('  of those, a ONE-swap break missed     ' + seen.missedOne);
    var keys = Object.keys(chose).sort(function (a, b) { return chose[b] - chose[a]; });
    var tot = keys.reduce(function (s, k) { return s + chose[k]; }, 0);
    console.log('');
    console.log('CHOSE -- with a break on the list, what played? (' + tot + ' decisions)');
    keys.slice(0, 16).forEach(function (k) {
        console.log('  ' + String(chose[k]).padStart(6) + '  ' + k);
    });
    console.log('');
    console.log('CASHED -- with a clear available, did the move clear?');
    Object.keys(byBand).sort().forEach(function (b) {
        var v = byBand[b];
        console.log('  tall ' + b + '   had a clear ' + String(v.had).padStart(5) +
                    '   cashed ' + String(v.took).padStart(5) +
                    '   (' + Math.round(100 * v.took / v.had) + '%)');
    });
    var pk = Object.keys(passed).sort(function (a, b) { return passed[b] - passed[a]; });
    console.log('');
    console.log('PASSED -- a clear was there and the move cleared nothing, by band and route');
    pk.slice(0, 20).forEach(function (k) {
        console.log('  ' + String(passed[k]).padStart(6) + '  ' + k);
    });
    console.log('');
});

process.argv = [process.argv[0], 'why_died', '--one', PAIR];
require(path.join(EV, 'roundrobin.js'));
