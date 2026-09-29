#!/usr/bin/env node
// ONE FULL DUEL, BOTH SIDES THE DEEP-SURVIVAL BOT. Run: node survival_game.js SEED [FRAMES]
//
// Level 10, the survival search on, garbage sent both ways. Ends when a side
// dies or at FRAMES (default 21600, six minutes). A death prints the dying
// side's last decisions and its board before and at the death. The last line
// is data: RESULT {"seed":..,"frames":..,"died":null|0|1,"seconds":..}.
// GC_REALTIME=X: each side decides through a brain whose answers arrive as
// many frames after they are asked for as the thinking took (60 a second,
// times X), as in the browser; 0 or unset decides on the frame. Each brain
// has a quick side too (PuyoCpu.Mind quick), unless GC_QUICK=0. GC_THREADS:
// worker threads for the search.
//
// survival-games.yml runs one seed per runner.
var fs = require('fs'), path = require('path');
var DIR = __dirname;
require(path.join(DIR, '..', '..', 'panel-engine.js'));
require(path.join(DIR, '..', '..', 'panel-cpu.js'));
var PuyoCpu = require(path.join(DIR, 'puyocpu.js'));
var PanelEngine = globalThis.PanelEngine;

var SEED = Number(process.argv[2]), FRAMES = Number(process.argv[3] || 21600);
if (!isFinite(SEED)) { console.error('usage: node survival_game.js SEED [FRAMES]'); process.exit(2); }
var WEIGHTS = ['trained.pbt.pbt-r22-s322.0926-142336.g03120.json',
               'trained.pbt.pbt-r01-s301.0926-142244.g00560.json']
  .map(function (f) { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).weights; });

var st = [0, 1].map(function () { return new PanelEngine.Stack({ level: 10, seed: SEED, countdown: false }); });
var REALTIME = Number(process.env.GC_REALTIME || 0);
function opts(i) {
  return { weights: WEIGHTS[i], reaction: 12, depth: 2, beam: 0, rise: true, allowRaise: true, modes: true,
           engine: true, checkModel: true, threads: process.env.GC_THREADS || 0 };
}
// With a brain, the side's decisions are made by the brain's own bot (mind[i]).
var mind = [0, 1].map(function (i) { return REALTIME ? new PuyoCpu(PuyoCpu.cloneStack(st[i]), opts(i)) : null; });
var cp = [0, 1].map(function (i) {
  var o = opts(i);
  if (REALTIME) o.brain = new PuyoCpu.LocalBrain(new PuyoCpu.Mind(opts(i), mind[i]), REALTIME,
                                                 process.env.GC_QUICK === '0' ? null : new PuyoCpu.Mind(opts(i), null, true));
  return new PuyoCpu(st[i], o);
});
cp[0].opponent = st[1]; cp[1].opponent = st[0];

function draw(s) {
  var o = [];
  for (var r = s.height; r >= 1; r--) {
    var line = String(r).padStart(2) + '|';
    for (var c = 1; c <= 6; c++) {
      var p = s.panels[r] && s.panels[r][c];
      var ch = (!p || p.color === 0) ? '.' : (p.isGarbage ? '#' : String(p.color));
      var cur = r === s.curRow && (c === s.curCol || c === s.curCol + 1);
      line += cur ? '[' + ch + ']' : ' ' + ch + ' ';
    }
    o.push(line + '|');
  }
  return o.join('\n');
}

// The last few decisions of each side: what the search said and what was played.
var log = [[], []];
[0, 1].forEach(function (i) {
  var c = mind[i] || cp[i], last = null;
  var search = c._survivalSearch;
  c._survivalSearch = function (cands) {
    var v = search.call(c, cands), n = {};
    v.forEach(function (x) { n[x] = (n[x] || 0) + 1; });
    last = { verdicts: n, cands: cands, v: v };
    return v;
  };
  var took = c._took;
  c._took = function (cand) {
    var sp = c._searchProofs, k = sp ? sp.cands.indexOf(cand) : -1, pf = k >= 0 ? sp.proofs[k] : null;
    log[i].push('f' + c.stack.clock + ' plays ' + (cand && cand.move ? cand.move.join(',') : cand && cand.kind) +
                (last && k >= 0 && last.cands === sp.cands ? ' (' + last.v[k] + ')' : '') +
                (pf ? ' line to +' + pf.t : '') + (last ? ' ' + JSON.stringify(last.verdicts) : ''));
    if (log[i].length > 12) log[i].shift();
    return took.apply(c, arguments);
  };
});

var before = [[], []], t0 = Date.now(), died = null, mismatches = [0, 0], f;
for (f = 0; f < FRAMES; f++) {
  cp[0].update(); cp[1].update(); st[0].run(); st[1].run();
  for (var i = 0; i < 2; i++) {
    var out = st[i].takeDeliverableGarbage();
    if (out && out.length) st[i ^ 1].receiveGarbage(out);
    st[i].drainEvents();
    before[i].push(draw(st[i])); if (before[i].length > 31) before[i].shift();
    var mm = (mind[i] || cp[i]).modelMismatches || [];
    while (mismatches[i] < mm.length) {
      var x = mm[mismatches[i]++];
      console.log('MISMATCH side ' + i + ' at ' + x.clock + ' after ' + x.played + ': ' + x.cells.join(' ; '));
    }
  }
  if ((f + 1) % 1000 === 0) console.log('frame ' + (f + 1) + ' [' + ((Date.now() - t0) / 1000).toFixed(0) + 's]');
  if (st[0].gameOver || st[1].gameOver) { died = st[0].gameOver ? 0 : 1; f++; break; }
}
if (died !== null) {
  console.log('side ' + died + ' DIED at frame ' + st[died].clock);
  console.log('last decisions:\n  ' + log[died].join('\n  '));
  console.log('board 30 frames before:\n' + before[died][0]);
  console.log('board at death:\n' + before[died][before[died].length - 1]);
} else console.log('both alive at frame ' + f);
console.log('RESULT ' + JSON.stringify({ seed: SEED, frames: f, died: died,
                                         mismatches: mismatches[0] + mismatches[1],
                                         acted: REALTIME ? cp.map(function (c) { return c.acted || 0; }) : undefined,
                                         planned: REALTIME ? cp.map(function (c) { return c.planned || 0; }) : undefined,
                                         missed: REALTIME ? cp.map(function (c) { return c.missed || 0; }) : undefined,
                                         dropped: REALTIME ? cp.map(function (c) { return c.dropped || 0; }) : undefined,
                                         quick: REALTIME ? cp.map(function (c) { return c.quickPlayed || 0; }) : undefined,
                                         seconds: Math.round((Date.now() - t0) / 1000) }));
process.exit(died === null ? 0 : 1);
