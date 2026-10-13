// survivor_idle.test.js -- a frame with nothing decided (Hands.idle) holds the raise by the search's own rule (search.h
// raiseStep), read off the board, with no search built: on boards of a game played with raises pressed and let go, it
// gives the keys and the hold the search gives for that frame.
//   node games/the-game/ai/eval/survivor_idle.test.js
var path = require('path'), assert = require('assert');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), SH = require(path.join(__dirname, 'survivor_shared.js'));
var H = new SH.Hands(SH.profile()), n = 0;
[3, 7, 11].forEach(function (seed) {
  var st = PA.game({ level: 10, seed: seed, countdown: false });
  for (var f = 0; f < 900; f++) {
    [[1, false], [6, false], [6, true], [30, true]].forEach(function (hs) {
      var h = { left: hs[0], started: hs[1] }, a = H.idle(st, h), b = H.idleSearched(st, h, []);
      assert.deepStrictEqual([a.bits, a.hold.left, !!a.hold.started], [b.bits, b.hold.left, !!b.hold.started], 'seed ' + seed + ' frame ' + f + ' hold ' + JSON.stringify(h));
      n++;
    });
    st.setInput(f % 97 < 30 ? PA.IN.raise : 0);
    st.run();
  }
});
console.log('survivor_idle: ok (' + n + ' frames, the held raise as the search plays it)');
