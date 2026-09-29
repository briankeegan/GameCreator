#!/usr/bin/env node
// THE FAST ENGINE IS THE ENGINE. Run: node faststack.test.js [FRAMES] [SEED]
//
// Boards come from real duels (level 10, garbage sent both ways), taken the
// way the search takes them (cloneStack). From each one the real engine and
// FastStack are played side by side on the same input -- cursor moves held
// and tapped, swap presses, swaps queued directly the way the bot's walk does,
// raises held, garbage of every size dropped in -- and after EVERY frame the
// two are compared field for field (FastStack.diff), with what the search
// reads off a board (grid, key, legal swaps, every canSwap) compared too. The
// pair is copied every so often and play goes on from the copies, so clone()
// is checked the same way. The first difference fails the test and prints the
// frame, the field and the board.
var fs = require('fs'), path = require('path'), assert = require('assert');
var DIR = __dirname;
require(path.join(DIR, '..', '..', 'panel-engine.js'));
require(path.join(DIR, '..', '..', 'panel-cpu.js'));
var P = require(path.join(DIR, 'puyocpu.js')), E = globalThis.PanelEngine, F = P.FastStack;
var FRAMES = Number(process.argv[2] || 60000), SEED = Number(process.argv[3] || 1);
var rng = E.makeRng(SEED);
function rand(n) { return Math.floor(rng() * n); }

// ---- boards from real duels
function boards(count) {
  var W = JSON.parse(fs.readFileSync(path.join(DIR, 'trained.pbt.pbt-r22-s322.0926-142336.g03120.json'), 'utf8')).weights;
  var out = [], seed = 700 + SEED * 1000;
  while (out.length < count) {
    var st = [0, 1].map(function () { return new E.Stack({ level: 10, seed: seed, countdown: false }); });
    var cp = [0, 1].map(function (i) {
      return new P(st[i], { weights: W, reaction: 12 + 6 * i, depth: 1, rise: true, allowRaise: true, deepSurvival: false });
    });
    cp[0].opponent = st[1]; cp[1].opponent = st[0];
    for (var f = 0; f < 6000 && !st[0].gameOver && !st[1].gameOver; f++) {
      cp[0].update(); cp[1].update(); st[0].run(); st[1].run();
      for (var i = 0; i < 2; i++) {
        var o = st[i].takeDeliverableGarbage();
        if (o.length) st[i ^ 1].receiveGarbage(o);
        st[i].drainEvents();
      }
      if (f % 97 === 13) out.push(P.cloneStack(st[f & 1]));
    }
    seed++;
  }
  return out;
}

function view(st) {
  if (st instanceof F) {
    var g = st.grid(), cs = [];
    for (var r = 0; r <= st.height + 1; r++) for (var c = 0; c <= 7; c++) cs.push(st.canSwap(r, c));
    return JSON.stringify([g.grid, g.key, st.legalSwaps(), cs, st.isToppedOut(), st.hasFallingGarbage(), st.fillRatio()]);
  }
  var n = Object.create(P.prototype)._engineNode(st, 0, { left: 0, started: false }, [], false), cs2 = [];
  for (var r2 = 0; r2 <= st.height + 1; r2++) for (var c2 = 0; c2 <= 7; c2++) cs2.push(st.canSwap(r2, c2));
  return JSON.stringify([n.b.grid, n.b.key, n.b.legalSwaps(), cs2, st.isToppedOut(), st.hasFallingGarbage(), st.fillRatio()]);
}
function draw(s) {
  var o = [];
  for (var r = Math.min(s.panels.length - 1, s.height + 4); r >= 0; r--) {
    var line = String(r).padStart(2) + '|';
    for (var c = 1; c <= 6; c++) {
      var p = s.panels[r][c];
      line += ' ' + (p.color === 0 ? '.' : p.isGarbage ? '#' : p.color) + p.state.charAt(0) + String(p.timer).padStart(2);
    }
    o.push(line);
  }
  return o.join('\n');
}
function check(real, fast, where) {
  var d = F.diff(real, fast.toStack());
  if (!d) { var a = view(real), b = view(fast); if (a !== b) d = 'what the search reads: ' + a.slice(0, 300) + ' vs ' + b.slice(0, 300); }
  if (d) {
    console.log('DIFFERENT ' + where + ': ' + d + '\nreal:\n' + draw(real) + '\nfast:\n' + draw(fast.toStack()));
    process.exit(1);
  }
}

// What the frames exercised, from the events and the boards, so a run that
// never reached a mechanic cannot pass as having checked it.
var seen = { chainLink: 0, garbageClear: 0, garbagePop: 0, garbageDrop: 0, garbageLand: 0, newRow: 0, chainEnd: 0,
             converted: 0, highChaining: 0, death: 0 };
function tally(st) {
  st.events.forEach(function (e) {
    if (e.type === 'match' && e.chain) seen.chainLink++;
    if (e.type === 'match' && e.garbage) seen.garbageClear++;
    if (e.type === 'pop' && e.garbage) seen.garbagePop++;
    if (e.type === 'garbageDrop') seen.garbageDrop++;
    if (e.type === 'garbageLand') seen.garbageLand++;
    if (e.type === 'newRow') seen.newRow++;
    if (e.type === 'chainEnd') seen.chainEnd++;
  });
  for (var r = 1; r < st.panels.length; r++) for (var c = 1; c <= 6; c++) {
    var p = st.panels[r][c];
    if (p.fellFromGarbage > 0 && p.state === 'falling') seen.converted++;
    if (r > st.height && p.chaining) seen.highChaining++;
  }
  if (st.gameOver) seen.death++;
}

var start = boards(Math.max(20, Math.ceil(FRAMES / 400)));
// 1. The trip there and back is exact.
start.forEach(function (b, i) { check(P.cloneStack(b), F.fromStack(b), 'round trip of board ' + i); });
console.log('ok: ' + start.length + ' boards from real duels survive the trip there and back');

// 2. Side by side, frame by frame.
var frames = 0, runs = 0, events = 0, games = 0, garbage = 0, swaps = 0, raises = 0, clones = 0;
while (frames < FRAMES) {
  var b = start[runs++ % start.length];
  var real = P.cloneStack(b), fast = F.fromStack(b), dir = null, held = 0, raise = 0;
  var len = 200 + rand(600);
  for (var f = 0; f < len && frames < FRAMES; f++, frames++) {
    if (held-- <= 0) { dir = [null, null, 'up', 'down', 'left', 'right'][rand(6)]; held = rand(3) ? rand(4) : 25 + rand(10); }
    if (raise > 0) raise--; else if (rand(90) === 0) { raise = 1 + rand(30); raises++; }
    var input = { swap: rand(5) === 0, raise: raise > 0 };
    if (dir) input[dir] = true;
    real.setInput(input); fast.setInput(input);
    if (rand(6) === 0) {
      var r = 1 + rand(real.height), c = 1 + rand(5);
      assert.strictEqual(fast.tryQueueSwap(r, c), real.tryQueueSwap(r, c), 'tryQueueSwap(' + r + ',' + c + ') at frame ' + frames);
      swaps++;
    }
    if (rand(120) === 0) {
      var g = rand(3) ? { width: 1 + rand(6), height: 1, isChain: false } : { width: 6, height: 1 + rand(8), isChain: true };
      real.incoming.push(Object.assign({}, g)); fast.incoming.push(Object.assign({}, g));
      garbage++;
    }
    real.run(); fast.run();
    events += real.events.length;
    tally(real);
    check(real, fast, 'frame ' + f + ' of run ' + runs + ' (' + JSON.stringify(input) + ')');
    real.events.length = 0; fast.events.length = 0;
    if (real.gameOver) { games++; break; }
    if (rand(60) === 0) { real = P.cloneStack(real); fast = fast.clone(); check(real, fast, 'copy at frame ' + f); clones++; }
  }
}
console.log('ok: ' + frames + ' frames identical over ' + runs + ' runs (' + games + ' ended in a death, ' + events + ' events, ' +
            garbage + ' garbage drops, ' + swaps + ' direct swaps, ' + raises + ' raises, ' + clones + ' copies)');

// The mirror board as it is, without the two functions put on it to copy
// what the bot does.
function unwrapped(m) {
  var o = Object.create(Object.getPrototypeOf(m));
  for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k) && k !== 'setInput' && k !== 'tryQueueSwap') o[k] = m[k];
  return o;
}
// 3. The bot's own play: real duels, each real board mirrored by a fast one
// fed the same input, the same swaps and the same garbage. This is where
// chains, garbage clears and converted garbage come from.
(function () {
  var W = JSON.parse(fs.readFileSync(path.join(DIR, 'trained.pbt.pbt-r22-s322.0926-142336.g03120.json'), 'utf8')).weights;
  var done = 0, seed = 900 + SEED * 1000, duels = 0;
  while (done < FRAMES) {
    var st = [0, 1].map(function () { return new E.Stack({ level: 10, seed: seed, countdown: false }); });
    var fa = st.map(function (x) { return F.fromStack(x); });
    var mirror = st.map(function (x) { return P.cloneStack(x); });
    // The bot plays the mirror copy (a Stack like the one the search copies);
    // what it does to it is done to the fast one too.
    [0, 1].forEach(function (i) {
      var m = mirror[i], f = fa[i], set = m.setInput, tq = m.tryQueueSwap;
      m.setInput = function (inp) { f.setInput(inp); return set.call(m, inp); };
      m.tryQueueSwap = function (r, c) {
        var a = tq.call(m, r, c), b = f.tryQueueSwap(r, c);
        assert.strictEqual(b, a, 'tryQueueSwap(' + r + ',' + c + ') in a duel');
        return a;
      };
    });
    var cp = [0, 1].map(function (i) {
      return new P(mirror[i], { weights: W, reaction: 12, depth: 1, rise: true, allowRaise: true, deepSurvival: false });
    });
    cp[0].opponent = mirror[1]; cp[1].opponent = mirror[0];
    for (var f = 0; f < 8000 && done < FRAMES && !mirror[0].gameOver && !mirror[1].gameOver; f++, done++) {
      cp[0].update(); cp[1].update();
      for (var i = 0; i < 2; i++) { mirror[i].run(); fa[i].run(); }
      for (i = 0; i < 2; i++) {
        tally(mirror[i]);
        check(unwrapped(mirror[i]), fa[i], 'duel ' + duels + ' side ' + i + ' frame ' + f);
        var o = mirror[i].takeDeliverableGarbage(), o2 = fa[i].takeDeliverableGarbage();
        assert.ok(F.same(o, o2), 'deliverable garbage differs in duel ' + duels + ' at frame ' + f);
        if (o.length) { mirror[i ^ 1].receiveGarbage(o); fa[i ^ 1].receiveGarbage(o2); }
        // More garbage than two bots send each other, so boards reach the top.
        if (rand(150) === 0) {
          var extra = rand(2) ? [{ width: 3 + rand(4), height: 1, isChain: false }] : [{ width: 6, height: 1 + rand(6), isChain: true }];
          mirror[i].receiveGarbage(extra); fa[i].receiveGarbage(extra);
        }
        mirror[i].events.length = 0; fa[i].events.length = 0;
      }
    }
    duels++; seed++;
  }
  console.log('ok: ' + done + ' frames of ' + duels + ' duels identical on both boards');
})();

console.log('exercised: ' + JSON.stringify(seen));
// Floors: half of what a 20000-frame run of each part exercised (seed 1:
// chainLink 61, garbageClear 40, garbagePop 501, garbageDrop 381,
// garbageLand 398, newRow 196, chainEnd 49, converted 419, highChaining 0,
// death 88), scaled to the frames asked for. Chaining above the visible
// board never happened in these runs; engine_check.test.js reaches it.
var FLOORS = { chainLink: 30, garbageClear: 20, garbagePop: 250, garbageDrop: 190, garbageLand: 199, newRow: 98, chainEnd: 24,
               converted: 209, death: 44 };
var scale = FRAMES / 20000;
Object.keys(FLOORS).forEach(function (k) {
  assert.ok(seen[k] >= Math.floor(FLOORS[k] * scale), 'only ' + seen[k] + ' ' + k + ': the frames did not exercise it');
});
