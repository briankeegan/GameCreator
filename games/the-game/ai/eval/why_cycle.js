#!/usr/bin/env node
// WHY IS IT PLAYING THE SAME SWAP OVER AND OVER?
//
//   node why_cycle.js 103:rand2:rand3 27100 27260 [side]
//
// Three rules exist to stop a loop and a loop still happened, so the question is
// which of them stood aside. For every decision in the window it prints the route,
// the move, the signature of the board the decision was made ON, and what each
// filter did to the list: how many candidates the no-return rule refused, whether it
// stood aside because refusing left nothing, and the same for the same-two-cells
// rule. A signature alternating between two values with both filters standing aside
// is the loop; a signature that never repeats is a different bug.
var path = require('path');
var EV = __dirname;
require(path.join(EV, '..', '..', 'panel-engine.js'));
require(path.join(EV, '..', '..', 'panel-cpu.js'));
var bit = require(path.join(EV, 'bitmatch.js'));
var BitBot = require(path.join(EV, 'bitbot.js'));

var PAIR = process.argv[2], FROM = Number(process.argv[3]), TO = Number(process.argv[4]);
var SIDE = process.argv[5] === undefined ? null : Number(process.argv[5]);
if (!PAIR || !(TO > FROM)) {
    console.error('usage: node why_cycle.js <seed:A:B> <from> <to> [side]');
    process.exit(2);
}

var sigs = {}, nextId = 1;
function idOf(s) { if (!sigs[s]) sigs[s] = nextId++; return sigs[s]; }

var realDecide = BitBot.prototype.decide;
BitBot.prototype.decide = function () {
    var before = {
        ret: this.counts.refusedReturn || 0,
        same: this.counts.refusedSameSwap || 0,
        dead: this.counts.refusedDeadly || 0,
        str: this.counts.refusedStranded || 0,
        fail: this.counts.refusedNoFailsafe || 0
    };
    var clock = this.stack.clock;
    var d = realDecide.apply(this, arguments);
    if (!this._tag) this._tag = 'bot' + (BitBot._tags = (BitBot._tags || 0) + 1);
    if (clock >= FROM && clock <= TO) {
        var base = this._lastBase;
        var sig = base ? idOf(BitBot.signatureOf(base)) : 0;
        console.log('  ' + this._tag + ' f' + String(clock).padStart(6) +
                    '  on #' + String(sig).padStart(3) +
                    '  ' + String(d && d.via).padEnd(13) +
                    ' move ' + (d && d.move ? d.move.join('-') : d && d.kind) +
                    '   pool ' + String(this._lastPool ? this._lastPool.length : 0).padStart(3) +
                    '   refused: return ' + ((this.counts.refusedReturn || 0) - before.ret) +
                    '  sameSwap ' + ((this.counts.refusedSameSwap || 0) - before.same) +
                    '  deadly ' + ((this.counts.refusedDeadly || 0) - before.dead) +
                    '  stranded ' + ((this.counts.refusedStranded || 0) - before.str) +
                    '  noFailsafe ' + ((this.counts.refusedNoFailsafe || 0) - before.fail));
    }
    return d;
};

process.on('exit', function () {
    console.log('');
    console.log(Object.keys(sigs).length + ' distinct boards in the window; #n is the order first seen.');
});

process.argv = [process.argv[0], 'why_cycle', '--one', PAIR];
if (SIDE !== null) process.env.GC_TRACE_SIDE = String(SIDE);
require(path.join(EV, 'roundrobin.js'));
