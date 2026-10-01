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

var realDecide = BitBot.prototype.decide;
BitBot.prototype.decide = function () {
    hadBreak = false;
    var d = realDecide.apply(this, arguments);
    if (hadBreak && d) {
        var k = (d.mode && d.mode.name ? d.mode.name : '?') + ' / ' + (d.via || '?');
        chose[k] = (chose[k] || 0) + 1;
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
});

process.argv = [process.argv[0], 'why_died', '--one', PAIR];
require(path.join(EV, 'roundrobin.js'));
