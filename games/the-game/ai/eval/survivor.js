#!/usr/bin/env node
// WASMSURVIVOR: the survival bot, playing on the panel-game server.
//
//   node survivor.js [--port 47777] [--host 127.0.0.1] [--threads N]   (N: the cores but one, at most 4)
//   (or GC_SURVIVOR_PORT / GC_SURVIVOR_HOST; --host 0.0.0.0 listens on every interface)
//
// panel-game's live client (bot/SurvivalLink.lua, brain "survival") runs the
// match on the server's own Lua engine and asks this, every frame, what to
// press. It sends the board as it is (lua/engineRecord.lua's form, one JSON
// line); the answer is the input for that frame.
//
// THE BOARD PLAYED IS THE BOARD DECIDED ON. Decisions are made ahead, in a
// worker (survivor_mind.js), for a frame still to come: the board then is
// predicted here on pa-engine.js (the server's rules) from the board now and
// the input planned till then. A decision is a key script -- the same walk,
// swap and reaction the search played for that move (search.h advance) --
// and the next decision is asked for the frame its script ends on, so the
// bot moves on without waiting. Every frame the board the server gives is
// compared with the one predicted for it; anything the prediction could not
// know (a row or a break's colours) aside, a difference -- garbage arriving,
// above all -- drops every plan and prediction made before it, and the bot
// holds until it has decided again on the board as it is. Garbage on its
// way, as the senders' telegraphs show it, is played into every prediction
// and handed to the search.
// THE HEAP IS LAID OUT AT START: a full collection mid-game stops this
// thread for up to 10 ms, so the old space starts big enough that a game
// never fills it and V8's memory reducer is off; the one collection is made
// at a match's start, in the countdown (gc). Those flags are only read when
// node starts, so survivor.js runs itself again with them.
var HEAP_FLAGS = ['--initial-old-space-size=64', '--heap-growing-percent=1000', '--no-memory-reducer', '--expose-gc'];
// NO WASM IS COMPILED DURING PLAY. By default V8 compiles a wasm function
// the first time it is called and recompiles hot ones in the background,
// and either can hold the frame loop on V8's compile locks. Every function is
// compiled optimized when the module is (~40 ms each, before the first match).
var WASM_FLAGS = ['--no-wasm-lazy-compilation', '--no-liftoff'];
if (!process.env.GC_SURVIVOR_CHILD) {
  var child = require('child_process').spawn(process.execPath, process.execArgv.concat(HEAP_FLAGS, WASM_FLAGS, [__filename], process.argv.slice(2)),
                                             { stdio: 'inherit', env: Object.assign({}, process.env, { GC_SURVIVOR_CHILD: '1' }) });
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(function (sig) { process.on(sig, function () { child.kill(sig); }); });
  child.on('exit', function (code, sig) { process.exit(code === null ? 1 : code); });
  return;
}
// THE FRAME LOOP STAYS OUT OF GC'S WAY: collections done on the thread that
// needs them -- V8's helper threads are the process's, and a collection here
// that waits on them waits behind the mind's. The young generation keeps its
// default size: a heap's is fixed when it is made, so a size set here would
// reach only the mind's, and there a 64 MB one held decisions for up to 130 ms
// a scavenge against 16 ms at the default (473 recorded boards, 100 ms each).
require('v8').setFlagsFromString('--no-parallel-scavenge');
require('v8').setFlagsFromString('--no-parallel-compaction');
require('v8').setFlagsFromString('--no-parallel-pointer-update');
var net = require('net'), path = require('path'), wt = require('worker_threads');
// GC pauses on this thread: the longest, and how many passed 4 ms (match stats gcMs, slowGc).
var GC = { max: 0, slow: 0 };
// GC_SURVIVOR_TIMES=file: per frame, the clock, when its line was read (epoch s), the reply's and the frame's ms, the line's length, and the time
// between frames (schedDelta's first two, ms, then switches preempted and blocking, page faults minor and major, and the
// machine's memory and io stalls, ms); written at the match's end.
var TIMES = process.env.GC_SURVIVOR_TIMES ? [] : null, performance = require('perf_hooks').performance;
var lastSched = null;   // schedstat() at the end of the last frame (TIMES)
// Where this thread's time went (Linux): on a cpu, waiting for one (ns) and
// slices (schedstat); page faults, minor and major (stat); switches made
// blocking and preempted (status); and the machine's stalls on cpu, memory
// and io (pressure, total us of some task stalled).
var SCHED_NAMES = ['on cpu', 'waiting for one', 'slices', 'minor faults', 'major faults', 'blocked', 'preempted', 'machine cpu stall', 'memory stall', 'io stall'];
function readOr(f) { try { return require('fs').readFileSync(f, 'utf8'); } catch (e) { return ''; } }
function schedstat() {
  var ss = readOr('/proc/thread-self/schedstat').split(' ').map(Number), st = readOr('/proc/thread-self/stat'), stf = st.slice(st.lastIndexOf(')') + 2).split(' ');
  var sts = readOr('/proc/thread-self/status'), sw = function (k) { var m = sts.match(new RegExp(k + ':\\s+(\\d+)')); return m ? Number(m[1]) : 0; };
  var psi = function (r) { var m = readOr('/proc/pressure/' + r).match(/some .*total=(\d+)/); return m ? Number(m[1]) : 0; };
  // stat after the name: state is field 3, minflt 10 and majflt 12
  return [ss[0] || 0, ss[1] || 0, ss[2] || 0, Number(stf[7]) || 0, Number(stf[9]) || 0, sw('voluntary_ctxt_switches'), sw('nonvoluntary_ctxt_switches'), psi('cpu'), psi('memory'), psi('io')];
}
function schedDelta(a, b) {
  return SCHED_NAMES.map(function (n, i) { var d = b[i] - a[i]; return n + ' ' + (i < 2 ? (d / 1e6).toFixed(1) + ' ms' : i >= 7 ? (d / 1e3).toFixed(1) + ' ms' : d); }).join(', ');
}
new (require('perf_hooks').PerformanceObserver)(function (l) {
  l.getEntries().forEach(function (e) { if (e.duration > GC.max) GC.max = e.duration; if (e.duration > 4) GC.slow++; if (TIMES && e.duration > 2) TIMES.push('gc ' + ((performance.timeOrigin + e.startTime) / 1000).toFixed(4) + ' ' + e.duration.toFixed(2) + ' ' + (e.detail ? e.detail.kind : e.kind)); });
}).observe({ entryTypes: ['gc'] });
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), SH = require(path.join(__dirname, 'survivor_shared.js'));

var args = process.argv.slice(2), opt = { port: Number(process.env.GC_SURVIVOR_PORT) || 47777, host: process.env.GC_SURVIVOR_HOST || '127.0.0.1', threads: Math.max(1, Math.min(4, require('os').cpus().length - 1)) };
for (var i = 0; i < args.length; i += 2) { var key = args[i].replace(/^--/, ''); opt[key] = key === 'host' ? args[i + 1] : Number(args[i + 1]); }
if (!(opt.port > 0 && opt.port < 65536)) throw new Error('survivor.js: no such port ' + opt.port);
var PROFILE = SH.profile(), HANDS = new SH.Hands(PROFILE), arrivalsOf = SH.arrivalsOf;
var SM = require(path.join(__dirname, 'survivor_match.js')), Match = SM.Match, nativeNow = SM.nativeNow, NEXT = SM.NEXT;

// ---------------------------------------------------------------- the mind
// ABORT[0]: the newest question the mind should stop working on; every one
// before it is stopped too.
var ABORT = new Int32Array(new SharedArrayBuffer(4));
var mind = new wt.Worker(path.join(__dirname, 'survivor_mind.js'), { workerData: { profile: PROFILE, threads: opt.threads, abort: ABORT } });
var mindReady = false;
// GC_SURVIVOR_SYNC=1: every decision is waited for, asked a frame ahead --
// the bot as it plays with all the time it wants, for telling what it knows
// from what it has time for.
var SYNC = process.env.GC_SURVIVOR_SYNC === '1', resume = null;
var LINK = { post: function (q) { mind.postMessage(q); }, abort: ABORT, answers: [], thinking: [], nextId: 1, pending: null, sync: SYNC, profile: PROFILE, hands: HANDS };
mind.on('message', function (m) {
  if (m.ready) { mindReady = true; return; }
  m.got = Date.now();
  LINK.answers.push(m);
  if (resume) { var r = resume; resume = null; setImmediate(r); }
});
mind.on('error', function (e) { console.error('mind: ' + (e && e.stack || e)); process.exit(1); });

// The match's stats, with this thread's GC pauses since the last match.
function overStats(match) {
  match.stats.gcMs = Math.round(GC.max * 10) / 10; match.stats.slowGc = GC.slow; GC.max = 0; GC.slow = 0;
  return JSON.stringify(match.stats);
}
// ---------------------------------------------------------------- the link
var server = net.createServer(function (sock) {
  var buf = '', match = null;
  sock.setNoDelay(true);
  sock.setEncoding('utf8');   // lines arrive as strings: no buffer made per read
  sock.on('error', function (e) { console.log('link: ' + e.message); });
  sock.on('close', function () { if (TIMES && TIMES.length) { require('fs').appendFileSync(process.env.GC_SURVIVOR_TIMES, TIMES.join('\n') + '\n'); TIMES.length = 0; } if (match) { console.log('match over: ' + overStats(match)); match.dump(); } match = null; });
  function pump() {
    var nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      var line = buf.slice(0, nl);
      if (!line) { buf = buf.slice(nl + 1); continue; }
      var sched0 = TIMES ? schedstat() : null;
      var tp = process.hrtime.bigint(), tWall = TIMES ? performance.timeOrigin + performance.now() : 0, m = JSON.parse(line), reply, tParse = process.hrtime.bigint(), tBoard = tParse;
      if (SYNC && m.t === 'f' && match && LINK.pending && !LINK.answers.some(function (a) { return a.id === LINK.pending.id; })) { resume = pump; return; }
      buf = buf.slice(nl + 1);
      if (m.t === 'match') {
        if (match) { console.log('match over: ' + overStats(match)); match.dump(); }
        // GC_SURVIVOR_RELOAD=1: the profile's weights are read again for every
        // match, so whoever keeps the file (island2) changes them between matches.
        if (process.env.GC_SURVIVOR_RELOAD === '1') mind.postMessage({ type: 'weights', weights: SH.botOptions(SH.profile(), 1).weights });
        match = new Match({ levelData: m.levelData, behaviours: m.behaviours, stackOverConditions: m.stackOverConditions }, LINK);
        nativeNow();   // the engine compiled in the countdown, not on the first frame that predicts
        if (global.gc) global.gc();   // in the countdown: no frame is waiting on it
        reply = { ok: true };
      } else if (m.t === 'f') {
        var t0 = tp;   // from the line read: its parse is part of the reply
        if (!match) { reply = { input: 0 }; }
        else {
          var truth = PA.fromLua(m.state, match.level, new PA.Unseen()), state = m.state;
          tBoard = process.hrtime.bigint();
          reply = { clock: truth.clock, input: match.frame(truth, arrivalsOf(state), function () { return PA.fromLua(state, match.level, new PA.Unseen()); }), next: match.planned(truth.clock + 1, NEXT) };
        }
      } else if (m.t === 'bye') { if (match) { console.log('match over: ' + overStats(match)); match.dump(); } match = null; reply = { ok: true }; }
      sock.write(JSON.stringify(reply) + '\n');
      if (match && m.t === 'f') {
        // what the link waits on: the frame's arrival to its reply
        var rms = Number(process.hrtime.bigint() - t0) / 1e6;
        if (rms > (match.stats.replyMs || 0)) match.stats.replyMs = Math.round(rms * 10) / 10;
        if (rms > 8) {
          match.stats.slowReplies = (match.stats.slowReplies || 0) + 1;
          var ms = function (a, b) { return (Number(b - a) / 1e6).toFixed(1); };
          console.error('slow reply ' + rms.toFixed(1) + ' ms at ' + match.now + ': parse ' + ms(tp, tParse) + ', board ' + ms(tParse, tBoard) + ', keys ' + ms(tBoard, process.hrtime.bigint()) + ' (differ ' + ms(match.parts[0], match.parts[1]) + ', checks ' + ms(match.parts[1], match.parts[2]) + ', take ' + ms(match.parts[2], match.parts[3]) + ', idle ' + ms(match.parts[3], match.parts[4]) + '), gc so far ' + GC.slow);
        }
        match.afterFrame();
        // A frame's time here, the answer and the question after it, is what
        // the link waits on for the next (SurvivalLink waits 10 ms).
        var fms = Number(process.hrtime.bigint() - t0) / 1e6;
        if (fms > match.stats.frameMs) match.stats.frameMs = Math.round(fms * 10) / 10;
        if (fms > 8) match.stats.slowFrames++;
        // and, since the last frame's reply, this thread's time on a cpu and waiting for one (ms), its switches preempted and blocking,
        // its minor and major page faults, and the machine's memory and io stalls (ms)
        if (TIMES) { var bw = lastSched && sched0 ? [(sched0[0] - lastSched[0]) / 1e6, (sched0[1] - lastSched[1]) / 1e6, sched0[6] - lastSched[6], sched0[5] - lastSched[5], sched0[3] - lastSched[3], sched0[4] - lastSched[4], (sched0[8] - lastSched[8]) / 1e3, (sched0[9] - lastSched[9]) / 1e3] : [0, 0, 0, 0, 0, 0, 0, 0];
          TIMES.push(match.now + ' ' + (tWall / 1000).toFixed(4) + ' ' + rms.toFixed(2) + ' ' + fms.toFixed(2) + ' ' + line.length + ' ' + bw[0].toFixed(1) + ' ' + bw[1].toFixed(1) + ' ' + bw[2] + ' ' + bw[3] + ' ' + bw[4] + ' ' + bw[5] + ' ' + bw[6].toFixed(1) + ' ' + bw[7].toFixed(1));
          lastSched = schedstat(); }
        if (fms > 14) {
          if (sched0) console.error('  ' + schedDelta(sched0, schedstat()));
          var A = match.aparts || [], am = function (i) { return A[i] && A[i + 1] ? (Number(A[i + 1] - A[i]) / 1e6).toFixed(1) : '-'; };
          console.error('slow frame ' + fms.toFixed(1) + ' ms at ' + match.now + ': reply ' + rms.toFixed(1) + ', next board ' + am(0) + ', plan ' + am(1) + ', predict ' + am(2) + ', gc so far ' + GC.slow);
        }
      }
    }
  }
  sock.on('data', function (chunk) { buf += chunk; if (!resume) pump(); });
});
(function wait() {
  if (!mindReady) { setTimeout(wait, 20); return; }
  nativeNow();   // compiled before the first match is offered
  // and the prediction run once, so the first frame that predicts runs it warm
  var wm = Object.create(Match.prototype), wg = PA.game({ level: 10, seed: 1 });
  while (wg.clock <= PA.COUNTDOWN_TOTAL) wg.run();
  wm.plan = {}; wm.arrivals = []; wm.L = LINK;
  for (var wi = 0; wi < 5; wi++) wm.predict(wg, wg.clock + 90, { left: 0, started: false }, []);
  server.listen(opt.port, opt.host, function () { console.log(PROFILE.name + ' listening on ' + opt.host + ':' + opt.port + ' (' + opt.threads + ' threads, reaction ' + PROFILE.reaction + ', cursor ' + PROFILE.cursorMoveFrames + ')'); });
})();
