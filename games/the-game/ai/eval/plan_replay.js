// A BOARD FROM A LIVE MATCH, ONE SWAP, THREE WAYS: node plan_replay.js
// The swap is made on the native engine (lite and not) and on the JS engine, and each says the chain it makes.
var path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), N = require(path.join(__dirname, 'native.js')).server;
// the grid printed by the match, row 9 down to row 1
var G = ['4 . . 2 1 .', '3 2 . 4 3 .', '2 1 3 6 6 .', '6 1 5 3 6 2', '5 4 1 5 5 2', '1 4 2 4 3 4', '3 6 4 1 6 2', '2 1 2 5 1 4', '3 4 3 2 3 6'];
var digits = G.map(function (r) { return r.split(' ').map(function (c) { return c === '.' ? '0' : c; }).join(''); }).join('');
function sent(stat) { var chain = 0, n = 0; for (var i = 0; i < stat.comboSizes.length; i++) if (stat.chainAt[i] > chain) chain = stat.chainAt[i]; return chain; }
var move = [3, 2];
var b = PA.puzzle(digits);
console.log('JS engine:');
var t = b.copy(); t.curRow = move[0]; t.curCol = move[1]; t.tryQueueSwap(move[0], move[1]);
var r = t.settle();
console.log('  chain ' + r.chain + ' combos ' + r.combos.join('+') + ' garbage ' + JSON.stringify(r.garbage));
N.init();
[true, false].forEach(function (lite) {
  var S = new N.Search({ reaction: 12, swapGap: 12, cursorMoveFrames: 4, threads: 1 });
  S.reset();
  var root = S.root(PA.puzzle(digits), { left: 0, started: false }, [], false);
  var out = S.advanceMany([[root, 'settle', move, 0]], lite)[0];
  var st = S.stepStats(out);
  console.log('native lite=' + lite + ': chain ' + sent(st) + ' sizes ' + JSON.stringify(st.comboSizes) + ' chainAt ' + JSON.stringify(st.chainAt) + ' cleared ' + st.cleared);
});
