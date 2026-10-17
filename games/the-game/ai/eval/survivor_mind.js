// WasmSurvivor's mind: the survival bot deciding on the panel-game server's
// rules, in a worker thread of survivor.js so the frame loop never waits on
// it. Each request is a board the loop predicts for a frame still to come;
// the answer is the decision for that frame.
//
// The bot is puyocpu.js's, unchanged: its candidates and scores read the
// board through PAEngine.View (pa-engine.js toPanelEngine), and its
// survival search plays the server's rules on native/pa.c (serverStack).
var wt = require('worker_threads'), path = require('path'), fs = require('fs');
// GC_FIXED_CLOCK=1: the mind's clock counts the work done, not the wall -- the frames the engine has simulated (native.js work()) at
// FIXED_FRAMES_PER_MS, the wall's rate in real decisions (1,378 frames a ms measured over 30 judged lines), and a hundredth of a ms each
// time it is read, so a loop that simulates nothing still ends. Every search then stops after the same work and a seed plays the same
// game every time (lua/gambitTrain.lua). Off: the wall clock.
var FIXED_FRAMES_PER_MS = 1378;
if (process.env.GC_FIXED_CLOCK === '1') (function () {
  var N = require(path.join(__dirname, 'native.js')).server, t0 = Date.now(), reads = 0;
  Date.now = function () { reads++; return Math.round(t0 + N.work() / FIXED_FRAMES_PER_MS + reads * 0.01); };
})();
// The frame loop must never wait for a core: on Linux a thread's nice is its
// own, and the search threads this thread makes are born with it.
// GC_SURVIVOR_NICE (default 10; 0 leaves it).
try { require('os').setPriority(0, process.env.GC_SURVIVOR_NICE === undefined ? 10 : Number(process.env.GC_SURVIVOR_NICE)); } catch (e) {}
var DIR = __dirname;
var mind = require(path.join(DIR, 'survivor_think.js'))(wt.workerData);
wt.parentPort.on('message', function (m) {
  if (m.type === 'reset') { mind.reset(); return; }
  if (m.type === 'warm') { mind.warm(m); return; }
  if (m.type === 'mode') { mind.setMode(m.mode); return; }
  if (m.type === 'weights') { mind.setWeights(m.weights); mind.reset(); return; }
  wt.parentPort.postMessage(mind.answer(m));
});
wt.parentPort.postMessage({ ready: true });
