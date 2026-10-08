// WasmSurvivor's mind: the survival bot deciding on the panel-game server's
// rules, in a worker thread of survivor.js so the frame loop never waits on
// it. Each request is a board the loop predicts for a frame still to come;
// the answer is the decision for that frame.
//
// The bot is puyocpu.js's, unchanged: its candidates and scores read the
// board through PAEngine.View (pa-engine.js toPanelEngine), and its
// survival search plays the server's rules on native/pa.c (serverStack).
var wt = require('worker_threads'), path = require('path'), fs = require('fs');
// The frame loop must never wait for a core: on Linux a thread's nice is its
// own, and the search threads this thread makes are born with it.
// GC_SURVIVOR_NICE (default 10; 0 leaves it).
try { require('os').setPriority(0, process.env.GC_SURVIVOR_NICE === undefined ? 10 : Number(process.env.GC_SURVIVOR_NICE)); } catch (e) {}
var DIR = __dirname;
var mind = require(path.join(DIR, 'survivor_think.js'))(wt.workerData);
wt.parentPort.on('message', function (m) {
  if (m.type === 'reset') { mind.reset(); return; }
  if (m.type === 'weights') { mind.setWeights(m.weights); mind.reset(); return; }
  wt.parentPort.postMessage(mind.answer(m));
});
wt.parentPort.postMessage({ ready: true });
