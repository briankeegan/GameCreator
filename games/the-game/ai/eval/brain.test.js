#!/usr/bin/env node
// THE BRAIN IS THE BOT. Run: node brain.test.js [FRAMES]
//
// The same duel twice, frame for frame: once deciding on the frame, once
// through PuyoCpu.LocalBrain asked ahead (REAL TIME in puyocpu.js) with
// answers on time. Every frame of both boards must be identical, and the
// brain's side must have played answers made ahead (not only ones asked for
// on the spot), or the test proves nothing about the ahead path.
//
// Then the same brain with its answers late: the bot must still play (the
// plan), not freeze; and with only its quick side in time, it plays that.
var fs = require('fs'), path = require('path'), assert = require('assert');
var DIR = __dirname;
require(path.join(DIR, '..', '..', 'panel-engine.js'));
require(path.join(DIR, '..', '..', 'panel-cpu.js'));
var P = require(path.join(DIR, 'puyocpu.js')), E = globalThis.PanelEngine;
var FRAMES = Number(process.argv[2] || 400), SEED = 702;
var W = ['trained.pbt.pbt-r22-s322.0926-142336.g03120.json', 'trained.pbt.pbt-r01-s301.0926-142244.g00560.json']
  .map(function (f) { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).weights; });
function opts(i) {
  return { weights: W[i], reaction: 12, depth: 2, beam: 0, rise: true, allowRaise: true, modes: true, engine: true };
}
function duel(brain) {
  var st = [0, 1].map(function () { return new E.Stack({ level: 10, seed: SEED, countdown: false }); });
  var cp = [0, 1].map(function (i) {
    var o = opts(i);
    if (brain) o.brain = brain(i, st[i]);
    return new P(st[i], o);
  });
  cp[0].opponent = st[1]; cp[1].opponent = st[0];
  return { st: st, cp: cp };
}
function step(g) {
  g.cp[0].update(); g.cp[1].update(); g.st[0].run(); g.st[1].run();
  for (var i = 0; i < 2; i++) {
    var o = g.st[i].takeDeliverableGarbage();
    if (o.length) g.st[i ^ 1].receiveGarbage(o);
    g.st[i].drainEvents();
  }
}
function key(s) { return Array.prototype.join.call(P.encodeStack(s).buf, ',') + JSON.stringify(s.input); }
function mind(i, st) { return new P.Mind(opts(i), new P(P.cloneStack(st), opts(i))); }

var A = duel(null), B = duel(function (i, st) { return new P.LocalBrain(mind(i, st), 0); }), trace = [];
for (var f = 0; f < FRAMES; f++) {
  step(A); step(B);
  for (var i = 0; i < 2; i++) {
    var k = key(A.st[i]);
    trace.push(k);
    assert.strictEqual(key(B.st[i]), k, 'side ' + i + ' parted from the bot deciding on the frame at frame ' + f);
  }
}
var ahead = B.cp[0].acted + B.cp[1].acted - (B.cp[0].missed || 0) - (B.cp[1].missed || 0);
assert.ok(ahead > 10, 'only ' + ahead + ' answers made ahead were played: the ahead path was not exercised');
console.log('ok: ' + FRAMES + ' frames identical; ' + (B.cp[0].acted + B.cp[1].acted) + ' answers played, ' +
            ((B.cp[0].missed || 0) + (B.cp[1].missed || 0)) + ' dropped for a board the prediction could not see');

// The search on worker threads (results through shared memory) is the same
// search.
var T = duel(null);
T.cp.forEach(function (c) { c.threads = 2; });
for (f = 0; f < FRAMES; f++) {
  step(T);
  for (i = 0; i < 2; i++) assert.strictEqual(key(T.st[i]), trace[2 * f + i], 'side ' + i + ' on threads parted at frame ' + f);
}
console.log('ok: ' + FRAMES + ' frames identical with the search on 2 threads');
// And on faststack.js, where the survival search keeps its boards on the
// workers (_svLevel).
var T2 = duel(null);
T2.cp.forEach(function (c) { c.threads = 2; c.fastEngine = true; });
for (f = 0; f < FRAMES; f++) {
  step(T2);
  for (i = 0; i < 2; i++) assert.strictEqual(key(T2.st[i]), trace[2 * f + i], 'side ' + i + ' on threads and FastStack parted at frame ' + f);
}
console.log('ok: ' + FRAMES + ' frames identical with the search on 2 threads on FastStack');

// A board where the search goes deep (brain.fixture.json): the same
// decision, the same verdict for every move and the same proven line.
function heavy(threads, fast) {
  var fx = JSON.parse(fs.readFileSync(path.join(DIR, 'brain.fixture.json'), 'utf8'));
  function dec(e) { return P.decodeStack({ meta: e.meta, rows: e.rows, row0: e.row0, buf: Int32Array.from(e.buf) }); }
  var o = opts(1); o.threads = threads; o.fastEngine = !!fast;
  var b = new P(dec(fx.me), o), verdicts = null, search = b._survivalSearch;
  b.opponent = dec(fx.opp); b.raiseFrames = fx.raiseFrames; b._raiseStarted = fx.raiseStarted; b._predArr = fx.arrivals;
  b._survivalSearch = function (c) { verdicts = search.call(b, c); return verdicts; };
  var d = b._decide();
  return JSON.stringify({ d: d, verdicts: verdicts,
                          line: b._proofLine && b._proofLine.line.map(function (n) { return [n.t, n.m]; }) });
}
var one = heavy(0), two = heavy(2), three = heavy(3, true);
assert.strictEqual(two, one, 'the deep search on 2 threads decided differently');
assert.strictEqual(three, one, 'the deep search on 3 threads on FastStack decided differently');
console.log('ok: a deep search decides the same on 2 threads, and on 3 on FastStack');

// Late: every answer lands 40 frames after it was asked for.
function Late(m) { this.inner = new P.LocalBrain(m, 0); }
Late.prototype.request = function (bot, point, acted) {
  var p = this.inner.request(bot, point, acted);
  p.answer = p.decision; p.decision = null; p.readyAt = bot.stack.clock + 40;
  return p;
};
Late.prototype.poll = P.LocalBrain.prototype.poll;
Late.prototype.lead = function () { return 60; };
var C = duel(function (i, st) { return new Late(mind(i, st)); });
for (f = 0; f < FRAMES; f++) step(C);
var played = C.cp.map(function (c) { return (c.acted || 0) + (c.planned || 0); });
assert.ok(played[0] > 5 && played[1] > 5, 'with late answers the bot played only ' + played + ' moves');
// 9 a side from the plan here; 3 when the plan's beats are laid out wrong
// (its boards stop matching and it is dropped).
assert.ok(C.cp[0].planned >= 6 && C.cp[1].planned >= 6, 'with late answers the plan was played only ' +
          C.cp.map(function (c) { return c.planned || 0; }) + ' times');
console.log('ok: late answers, ' + played + ' moves played (' + C.cp.map(function (c) { return c.planned || 0; }) + ' from the plan)');

// Full answers never in time, quick ones on the spot: the quick side's are
// the ones played, and the bot does not freeze.
function Slow(m, q) { this.inner = new P.LocalBrain(m, 0, q); }
Slow.prototype.request = function (bot, point, acted) {
  var q = this.inner.quickMind.think(P.message(bot, point, acted));
  var p = this.inner.request(bot, point, acted);
  p.answer = p.decision; p.decision = null; p.readyAt = Infinity;
  p.quick = q;
  return p;
};
Slow.prototype.poll = P.LocalBrain.prototype.poll;
Slow.prototype.lead = function () { return 60; };
Slow.prototype.quickLead = function () { return 1; };
var Q = duel(function (i, st) { return new Slow(mind(i, st), new P.Mind(opts(i), null, true)); });
for (f = 0; f < FRAMES; f++) step(Q);
var quick = Q.cp.map(function (c) { return c.quickPlayed || 0; });
assert.ok(quick[0] > 5 && quick[1] > 5, 'with only quick answers in time the bot played ' + quick + ' of them');
assert.ok(!Q.cp[0].acted && !Q.cp[1].acted, 'a full answer that never came was played');
console.log('ok: full answers late, ' + quick + ' quick answers played');
P.closePools();
process.exit(0);
