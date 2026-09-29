#!/usr/bin/env node
// A VECTOR CANNOT CHOOSE TO DIE.
//
//   node survival.test.js
//
// The weights say which shapes the bot prefers. They do not say whether it
// survives, and this is the check that they cannot: six vectors -- the shipped
// one, an all-zero one and four random ones -- against the shipped bot on the
// same seeds, counted by deaths.
//
// Duels, not solo. Solo there is no garbage, so the thing that kills a board is
// absent and every vector lives; the number below only means anything against
// an opponent that is attacking.
var path = require('path');
var ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'panel-engine.js'));
require(path.join(ROOT, 'panel-cpu.js'));
var BitBot = require('./bitbot.js');
var BF = require('./bitfeatures.js');
var bit = require('./bitmatch.js');
var P = globalThis.PanelEngine, W = 6;

var fails = 0;
function ok(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }

// ------------------------------------------------ 1. the floors are floors
// Cheap and exact: whatever a vector says about flatness and height, the score
// must move the way STARTER's numbers say. A tower is where the board dies.
(function () {
    var st = new P.Stack({ level: 10, seed: 101, countdown: false });
    var hostile = {};
    BF.keys().forEach(function (k) { hostile[k] = 0; });
    hostile.bumpiness = 200; hostile.tallest = 200;   // asks for towers
    var bot = new BitBot(st, { weights: hostile, allowRaise: true });
    var board = bot._snapshot();
    var info = bot.info(board);
    var flat = bit.maskState(board.grid, board.blocks, W, board.height);
    var tower = bit.copyState(flat);
    // One column raised by four, everything else untouched.
    tower.occ[1] |= 0x0F << 8;
    var sFlat = bot.score(flat, 0, null, info);
    var sTower = bot.score(tower, 0, null, info);
    ok(sTower < sFlat,
       'a vector asking for towers got one: the tower board scored ' + sTower +
       ' against the flat board\'s ' + sFlat + ', so bumpiness and tallest are ' +
       'still weights rather than floors');
}());

// ------------------------------------------------ 2. and the boards survive
function vec(seed) {
    var w = {}, x = seed, keys = BF.keys();
    for (var i = 0; i < keys.length; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        w[keys[i]] = Math.round(((x / 0x7fffffff) * 2 - 1) * 100);
    }
    return w;
}
var VECTORS = [['STARTER', null], ['ZERO', {}]];
for (var v = 1; v <= 4; v++) VECTORS.push(['rand' + v, vec(v * 7919)]);
var SEEDS = [101, 103];
var FRAMES = 30000;

// THE NUMBER IS MEASURED, NOT PICKED. Over the full six vectors and four seeds
// this bot dies 3 times in 24; on the two seeds here, 1 in 12. The budget is 3,
// which is the noise this leaves and nothing like the 12 in 24 the bot scored
// when a vector could still decide whether to dig.
var BUDGET = 3;

function popc(n) { var c = 0; while (n) { n &= n - 1; c++; } return c; }
var deaths = 0, landed = 0, broke = 0, lines = [];
VECTORS.forEach(function (V) {
    var line = V[0].padEnd(8);
    SEEDS.forEach(function (sd) {
        var st = [new P.Stack({ level: 10, seed: sd, countdown: false }),
                  new P.Stack({ level: 10, seed: sd, countdown: false })];
        var o = { allowRaise: true };
        if (V[1]) o.weights = V[1];
        var b = [new BitBot(st[0], o), new BitBot(st[1], { allowRaise: true })];
        var f = 0, prev = null, i, c;
        for (; f < FRAMES && !st[0].gameOver && !st[1].gameOver; f++) {
            b[0].update(); b[1].update(); st[0].run(); st[1].run();
            for (i = 0; i < 2; i++) {
                var g = st[i].takeDeliverableGarbage();
                if (g && g.length) st[i ^ 1].receiveGarbage(g);
            }
            st[0].drainEvents(); st[1].drainEvents();
            var bd = b[0]._snapshot(), m = bit.maskState(bd.grid, bd.blocks, W, bd.height), gar = 0;
            for (c = 1; c <= W; c++) gar += popc(m.garb[c]);
            if (prev !== null) { if (gar < prev) broke += prev - gar; else if (gar > prev) landed += gar - prev; }
            prev = gar;
        }
        if (st[0].gameOver) deaths++;
        line += ' ' + sd + ':' + (st[0].gameOver ? ('DEAD@' + f) : 'alive  ');
    });
    lines.push(line);
});
lines.forEach(function (l) { console.log('  ' + l); });

// AND THAT IT DIGS ITSELF OUT, which is the mechanism behind the number above.
// A bot that survives by luck of the draw carries its garbage; this one converts
// it. Under a vector that could refuse, the ratio ran as low as 0.67 and that
// vector died in 3 duels of 4.
var ratio = landed ? broke / landed : 1;
ok(deaths <= BUDGET,
   deaths + ' deaths in ' + (VECTORS.length * SEEDS.length) + ' duels, over the budget of ' +
   BUDGET + ' -- some vector is choosing to die');
ok(ratio >= 0.9,
   'only ' + (100 * ratio).toFixed(0) + '% of the garbage that landed was converted (' +
   broke + ' of ' + landed + '), so the boards are carrying it to the ceiling');

console.log('survival: ' + deaths + ' deaths in ' + (VECTORS.length * SEEDS.length) +
            ' duels (budget ' + BUDGET + '), ' + broke + '/' + landed +
            ' garbage converted (' + (100 * ratio).toFixed(0) + '%)');
if (fails) { console.log(fails + ' FAILURES'); process.exit(1); }
console.log('survival: OK');
