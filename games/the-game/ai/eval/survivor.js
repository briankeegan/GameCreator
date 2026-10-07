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
if (!process.env.GC_SURVIVOR_CHILD) {
  var child = require('child_process').spawn(process.execPath, process.execArgv.concat(HEAP_FLAGS, [__filename], process.argv.slice(2)),
                                             { stdio: 'inherit', env: Object.assign({}, process.env, { GC_SURVIVOR_CHILD: '1' }) });
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(function (sig) { process.on(sig, function () { child.kill(sig); }); });
  child.on('exit', function (code, sig) { process.exit(code === null ? 1 : code); });
  return;
}
// THE FRAME LOOP STAYS OUT OF GC'S WAY: a young generation big enough that
// it rarely fills mid-frame, and collections done on the thread that needs
// them -- V8's helper threads are the process's, and a collection here that
// waits on them waits behind the mind's.
require('v8').setFlagsFromString('--max-semi-space-size=64');
require('v8').setFlagsFromString('--no-parallel-scavenge');
require('v8').setFlagsFromString('--no-parallel-compaction');
require('v8').setFlagsFromString('--no-parallel-pointer-update');
var net = require('net'), path = require('path'), wt = require('worker_threads');
// GC pauses on this thread: the longest, and how many passed 4 ms (match stats gcMs, slowGc).
var GC = { max: 0, slow: 0 };
// GC_SURVIVOR_TIMES=file: per frame, the clock, when its line was read (epoch s), the reply's and the frame's ms; written at the match's end.
var TIMES = process.env.GC_SURVIVOR_TIMES ? [] : null, performance = require('perf_hooks').performance;
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
var PROFILE = SH.profile(), HANDS = new SH.Hands(PROFILE), land = SH.land, arrivalsOf = SH.arrivalsOf;
var IN = PA.IN, V8 = require('v8');
function unpack(packed) { return PA.revive(V8.deserialize(packed)); }

// ---------------------------------------------------------------- the board, as predicted
// Two boards agree when every panel and every counter does, except the
// colours of what the prediction dealt unseen: a row not shown yet
// (11-16) and the panels a break turns into (21-26).
var PANEL_KEYS = ['color', 'state', 'timer', 'isGarbage', 'chaining', 'metal', 'garbageId', 'xOffset', 'yOffset', 'gWidth', 'gHeight',
                  'comboIndex', 'comboSize', 'matchAnyway', 'propagatesChaining', 'stateChanged', 'dontSwap', 'queuedHover', 'shakeTime',
                  'fellFromGarbage', 'popTime', 'popIndex', 'initialTime'];
var STACK_KEYS = ['clock', 'speed', 'displacement', 'riseTimer', 'riseLock', 'hasRisen', 'manualRaise', 'manualRaiseYet', 'preventManualRaise',
                  'stopTime', 'preStopTime', 'shakeTime', 'peakShakeTime', 'health', 'chainCounter', 'nActive', 'nPrevActive', 'curRow',
                  'curCol', 'topCurRow', 'queuedSwapRow', 'queuedSwapCol', 'curTimer', 'cursorDirection', 'metalPanelsQueued',
                  'garbageCreatedCount', 'highestGarbageIdMatched', 'gameOverClock', 'panelsCleared', 'swapCount'];
function unseen(c) { return (c >= 30 && c <= 119) || (c >= 130 && c <= 219); }
// The queue the game has is the one predicted less pieces it has not let in
// yet (GarbageDelivery holds an attack engine's back while 72 are queued):
// a plan made with them is made with more garbage than there is.
function heldBack(want, got) {
  if (!got || !want || got.length >= want.length) return false;
  var left = want.map(function (g) { return JSON.stringify(g); });
  return got.every(function (g) { var i = left.indexOf(JSON.stringify(g)); if (i < 0) return false; left.splice(i, 1); return true; });
}
function differ(want, got) {
  var k, i;
  for (i = 0; i < STACK_KEYS.length; i++) { k = STACK_KEYS[i]; if (!Object.is(want[k], got[k])) return 'stack.' + k + ' ' + want[k] + ' vs ' + got[k]; }
  if (JSON.stringify(want.incoming) !== JSON.stringify(got.incoming) && !heldBack(want.incoming, got.incoming)) return 'incoming ' + JSON.stringify(want.incoming) + ' vs ' + JSON.stringify(got.incoming);
  if (JSON.stringify(want.swapStallBacklog) !== JSON.stringify(got.swapStallBacklog)) return 'swap-stall log';
  if (want.panels.length !== got.panels.length) return 'rows';
  for (var r = 0; r < want.panels.length; r++) for (var c = 1; c <= 6; c++) {
    var p = want.panels[r][c], q = got.panels[r][c];
    for (i = 0; i < PANEL_KEYS.length; i++) {
      k = PANEL_KEYS[i];
      if (k === 'color' && unseen(p.color)) continue;
      if (!Object.is(p[k], q[k])) return 'panel ' + r + ',' + c + ' ' + k + ' ' + p[k] + ' vs ' + q[k];
    }
  }
  return null;
}
// A broken slab's colours shown: a panel predicted with a garbage row's
// unseen colour (Unseen.garbageRow, 130..219) that the game now shows.
function revealed(want, got) {
  for (var r = 0; r < want.panels.length && r < got.panels.length; r++) for (var c = 1; c <= 6; c++) {
    var p = want.panels[r] && want.panels[r][c], q = got.panels[r] && got.panels[r][c];
    if (p && q && p.color >= 130 && p.color <= 219 && q.color >= 1 && q.color <= 10) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the death record
// GC_SURVIVOR_DUMP=file: when this side dies, the last HISTORY frames (board,
// keys pressed, health, stop and shake time, garbage on its way) and the
// decisions made over them are
// written there, a match per line.
var KEEP = Number(process.env.GC_SURVIVOR_KEEP) || 1;   // how many times the default the dump keeps
var HISTORY = 300 * KEEP, SNAP_EVERY = 600;   // and the board every SNAP_EVERY frames of the match (snaps)
function gridOf(st) {
  var rows = [];
  for (var r = st.panels.length - 1; r >= 0; r--) {
    var row = st.panels[r], line = '';
    for (var c = 1; c <= PA.WIDTH; c++) {
      var p = row && row[c];
      line += !p || !p.color ? '.' : p.isGarbage ? (p.metal ? 'M' : 'G') : (p.color > 10 ? '?' : String(p.color));
      line += !p || !p.color || p.state === 'normal' ? ' ' : p.state[0];
    }
    rows.push((r < 10 ? ' ' : '') + r + ' ' + line);
  }
  return rows;
}

// ---------------------------------------------------------------- the mind
// ABORT[0]: the newest question the mind should stop working on; every one
// before it is stopped too.
var ABORT = new Int32Array(new SharedArrayBuffer(4));
var mind = new wt.Worker(path.join(__dirname, 'survivor_mind.js'), { workerData: { profile: PROFILE, threads: opt.threads, abort: ABORT } });
var mindReady = false, nextId = 1, pending = null, answers = [], thinking = [];
// GC_SURVIVOR_SYNC=1: every decision is waited for, asked a frame ahead --
// the bot as it plays with all the time it wants, for telling what it knows
// from what it has time for.
var SYNC = process.env.GC_SURVIVOR_SYNC === '1', resume = null;
mind.on('message', function (m) {
  if (m.ready) { mindReady = true; return; }
  m.got = Date.now();
  answers.push(m);
  if (resume) { var r = resume; resume = null; setImmediate(r); }
});
mind.on('error', function (e) { console.error('mind: ' + (e && e.stack || e)); process.exit(1); });

// ---------------------------------------------------------------- one match
function Match(level) {
  this.level = level;
  this.epoch = 0;          // bumped when the board is not the one predicted
  this.plan = {};          // clock -> input planned for that frame
  this.expect = null;      // the board predicted for the next frame
  this.hold = { left: 0, started: false };
  this.acted = true;       // whether the mind's last decision was played
  this.nextAt = 0;         // the frame the plan ends on
  this.arrivals = [];      // garbage on its way (arrivalsOf)
  this.line = null;        // the proven line after the plan: { steps, at } (follow)
  this.knew = [];          // the garbage on its way the plan was decided knowing
  this.stats = { frames: 0, frameMs: 0, slowFrames: 0, decisions: 0, played: 0, late: 0, diverged: 0, refused: 0, maxMs: 0, idle: 0, lateTaken: 0, followed: 0, noLine: 0, unforeseen: 0, reasked: 0, revealed: 0, lineup: 0, tookLineup: 0, touch: 0, tookTouch: 0, unasked: 0, rewalked: 0, break1: 0, took1: 0, break2: 0, took2: 0, break3: 0, took3: 0 };
  this.history = []; this.decided = []; this.asked = []; this.snaps = []; this.dumped = false;
  this.msPerFrame = 1000 / 60; this.wall = 0;   // how fast frames come (soon)
  // A question from the last match is not this one's: its answer is dropped.
  pending = null;
  mind.postMessage({ type: 'reset' });
}
// How soon an answer can be had, in frames: half again the slowest of the
// last few, at the rate frames are coming in (msPerFrame).
Match.prototype.soon = function () {
  if (SYNC) return 1;
  var worst = thinking.length ? Math.max.apply(null, thinking) : 300;
  return Math.max(6, Math.min(600, Math.ceil(worst / this.msPerFrame * 1.5)));
};
// How far ahead a decision may be asked (the profile's `ahead`, frames): a
// long move's frames are spent deciding the next, which a short one needs.
Match.prototype.ahead = function () {
  if (process.env.GC_SURVIVOR_LEAD) return Number(process.env.GC_SURVIVOR_LEAD);
  return SYNC ? 1 : Math.max(PROFILE.ahead, this.soon());
};
// The board at `at`, from `board` now, pressing what is planned till then,
// and the garbage still to land after it (SH.land: what the game holds back
// is still pending).
Match.prototype.predict = function (board, at, hold, from) {
  var fast = this.predictNative(board, at, hold, from);
  if (fast && process.env.GC_SURVIVOR_CHECK_PREDICT) {
    var slow = this.predictJS(board, at, hold, from), d = differ(slow.board, fast.board);
    if (d || JSON.stringify(slow.hold) !== JSON.stringify(fast.hold) || JSON.stringify(slow.pending) !== JSON.stringify(fast.pending)) throw new Error('survivor: predicted natively, not as played: ' + (d || 'hold or pending'));
  }
  if (!fast) throw new Error('survivor: the engine could not predict from clock ' + board.clock + ' to ' + at);
  return fast;
};
// The same on the engine (native/pa.c). A frame the plan has nothing for is
// HANDS.idle's: a raise still held goes on as search.h raiseStep plays it.
var NB = null;
function nativeNow() { if (!NB) { NB = require(path.join(__dirname, 'native.js')).server; NB.init(); } return NB; }
Match.prototype.predictNative = function (board, at, hold, from) {
  if (!NB) nativeNow();
  var X = NB.exports(), h = { left: hold.left, started: hold.started }, arrivals = SH.pending(from || this.arrivals), b = NB.fromStack(board);
  for (var clock = board.clock; clock < at && X.nb_over_clock(b) <= 0; clock = X.nb_clock(b)) {
    var planned = this.plan[clock], bits = 0;
    if (planned !== undefined) { bits = planned.bits; h = { left: planned.hold.left, started: planned.hold.started }; }
    else if (h.left > 0) {
      var rs = X.nb_raise_state(b), started = h.started || !!(rs & 1);
      if ((rs & 2) || (started && !(rs & 1))) h = { left: 0, started: started };
      else { h = { left: h.left - 1, started: started }; bits = IN.raise; }
    }
    X.nb_set_input(b, bits & ~IN.swap);
    if (bits & IN.swap) X.nb_press_swap(b);
    var err = X.nb_run(b);
    if (err) { X.nb_free(b); throw new Error('survivor: the engine failed (err ' + err + ') at clock ' + clock + ', predicting ' + board.clock + ' to ' + at); }
    // SH.land, on the engine's board
    var sw = X.nb_stopwatch(b), first = Infinity, i;
    for (i = 0; i < arrivals.length; i++) if (arrivals[i].capped && arrivals[i].at <= sw && arrivals[i].at < first) first = arrivals[i].at;
    var open = first < Infinity && X.nb_ninc(b) < SH.CAP;
    for (i = 0; i < arrivals.length; i++) {
      var a = arrivals[i], g = a.g;
      if (a.at > sw || (a.capped && !(open && a.at === first))) continue;
      X.nb_receive(b, g.width, g.height, g.isChain ? 1 : 0, g.isMetal ? 1 : 0, g.frameEarned === undefined ? sw : g.frameEarned,
                   g.finalized === undefined || g.finalized === null ? -2147483648 : g.finalized ? 1 : 0);
      arrivals.splice(i--, 1);
    }
  }
  var st = NB.toStack(b, board);
  X.nb_free(b);
  return { board: st, hold: h, pending: arrivals };
};
Match.prototype.predictJS = function (board, at, hold, from) {
  var st = board.copy(), h = { left: hold.left, started: hold.started }, arrivals = SH.pending(from || this.arrivals);
  while (st.clock < at && st.gameOverClock <= 0) {
    var planned = this.plan[st.clock], bits;
    if (planned !== undefined) { bits = planned.bits; h = { left: planned.hold.left, started: planned.hold.started }; }
    else { var id = HANDS.idle(st, h, arrivals); bits = id.bits; h = id.hold; }
    st.setInput(bits & ~IN.swap);
    if (bits & IN.swap) st.pressSwap = true;
    st.run();
    land(st, arrivals);
  }
  return { board: st, hold: h, pending: arrivals };
};
Match.prototype.ask = function (at, board, hold, pend) {
  var arrivals = (pend || this.arrivals).filter(function (a) { return a.at > board.stopWatch || a.capped; });
  // The board goes and is kept as bytes, off this thread's heap: held till
  // its answer comes, a board object would outlive the young generation.
  var packed = V8.serialize(board);
  pending = { id: nextId++, epoch: this.epoch, at: at, packed: packed, hold: hold, arrivals: arrivals, knew: this.arrivals, askedAt: this.now, sent: Date.now() };
  if (process.env.GC_SURVIVOR_DUMP) {
    // The question as the mind got it, to be asked again offline (survivor_probe.js).
    this.asked.push({ id: pending.id, at: at, hold: hold, arrivals: arrivals, acted: this.acted,
                      board: packed.toString('base64') });
    if (this.asked.length > 40 * KEEP) this.asked.shift();
  }
  mind.postMessage({ id: pending.id, epoch: this.epoch, at: at, lead: at - this.now, ms: SYNC ? 0 : (at - this.now) * this.msPerFrame, posted: Date.now(),
                    packed: packed, hold: hold, arrivals: arrivals, acted: this.acted });
  this.stats.decisions++;
};
// The answer: its keys go in the plan, and the next decision is due on the
// frame they end on. One that came after its frame is played from this
// frame's board if its move still stands -- the frames since were held, as
// the board it was decided on assumed -- with the swap found again by its
// panels, in case a row has come up since.
// A swap as the plan keeps it: the move and the ids of its two panels on the
// board it was decided on (not the board: a plan outlives many frames).
function swapOf(board, move) {
  var row = board.panels[move[0]], a = row && row[move[1]], b = row && row[move[1] + 1];
  return { move: move, ids: a && b ? [a.id, b.id] : null };
}
function moved(sw, to) {
  var ids = sw.ids, c = sw.move[1];
  if (!ids) return null;
  for (var r = 1; r < to.panels.length; r++) {
    var row = to.panels[r];
    if (row && row[c] && row[c].id === ids[0]) return row[c + 1] && row[c + 1].id === ids[1] ? [r, c] : null;
  }
  return null;
}
// The keys from `truth` to the first swap the plan has yet to press (each
// planned frame of a swap carries it: { move, board }), the move found again
// by its panels.
Match.prototype.rewalk = function (truth) {
  var now = truth.clock, first = Infinity, t;
  for (t in this.plan) if (+t >= now && +t < first && (this.plan[t].bits & IN.swap) && this.plan[t].swap) first = +t;
  if (first === Infinity) return null;
  var move = moved(this.plan[first].swap, truth);
  var k = move && HANDS.keys(truth, this.hold, 'swap', move, this.arrivals);
  if (k) k.swap = swapOf(truth, move);
  return k;
};
Match.prototype.take = function (truth) {
  var now = truth.clock;
  while (answers.length) {
    var a = answers.shift();
    if (a.aborted) continue;
    thinking.push(a.ms); if (thinking.length > 8) thinking.shift();
    this.stats.maxMs = Math.max(this.stats.maxMs, a.ms);
    if (a.mem) this.stats.memMB = Math.round(a.mem.bytes / 1048576);
    if (process.env.GC_SURVIVOR_DEBUG && a.mem) console.error('decision ' + a.id + ' at ' + a.at + ': ' + a.ms + ' ms (break ' + a.brMs + ') ' + a.kind + ' ' + JSON.stringify(a.move) + ' ' + JSON.stringify(a.diag) + ' ' + Math.round(a.mem.bytes / 1048576) + 'MB');
    if (a.error) { console.error('decision failed: ' + a.error); this.acted = false; pending = null; continue; }
    if (a.diag && a.diag.tight) this.stats.tight = (this.stats.tight || 0) + 1;
    if (a.breaks) { this.stats['break' + a.breaks.offered]++; if (a.breaks.took) this.stats['took' + a.breaks.offered]++; if (a.breaks.lineup) { this.stats.lineup++; if (a.breaks.took) this.stats.tookLineup++; } if (a.breaks.touch) { this.stats.touch++; if (a.breaks.took) this.stats.tookTouch++; } }
    this.decided.push({ id: a.id, at: a.at, now: now, kind: a.kind, move: a.move, ms: a.ms, diag: a.diag, breaks: a.breaks,
                       asked: pending && pending.id === a.id ? pending.askedAt : null, trip: pending && pending.id === a.id ? a.got - pending.sent : null });
    if (this.decided.length > 60 * KEEP) this.decided.shift();
    if (!pending || a.id !== pending.id) { this.stats.unasked++; continue; }
    var p = pending, board = unpack(p.packed), hold = p.hold, at = a.at, arrivals = p.arrivals, move = a.move, knew = p.knew;
    pending = null;
    if (a.epoch !== this.epoch) { this.stats.late++; this.acted = false; continue; }
    if (at < now) {
      if (a.kind === 'swap' && !(move = moved(swapOf(board, a.move), truth))) { this.stats.late++; this.acted = false; continue; }
      board = truth; hold = this.hold; at = now; arrivals = this.arrivals; knew = this.arrivals;
      this.stats.lateTaken++;
      // the latest answer taken: frames over, and where its time went
      if (!this.stats.lateWorst || now - a.at > this.stats.lateWorst.over)
        this.stats.lateWorst = { over: now - a.at, ms: a.ms, br: a.brMs, took: a.diag && a.diag.took, survive: a.diag && a.diag.survive, budget: a.diag && a.diag.budget, queued: a.queued };
    }
    var step = HANDS.keys(board, hold, a.kind, move, arrivals);
    if (!step) { this.stats.refused++; this.acted = false; continue; }
    this.acted = true;
    this.stats.played++;
    // Each planned frame carries the raise held after it.
    var sw = a.kind === 'swap' ? swapOf(board, move) : null;
    for (var t in this.plan) if (+t >= at) delete this.plan[t];
    for (var i = 0; i < step.inputs.length; i++) this.plan[at + i] = { bits: step.inputs[i], hold: step.holds[i], swap: sw };
    this.nextAt = at + step.inputs.length;
    this.knew = knew;
    // The line behind the move holds from where the move ends, played as decided.
    this.line = a.line && (a.lineFree || a.lineAt === this.nextAt) && at === a.at ? { steps: a.line.slice(), at: this.nextAt } : null;
  }
};
Match.prototype.frame = function (truth, arrivals, fresh) {
  var now = truth.clock, d, before = this.arrivals;
  this.now = now;
  this.arrivals = arrivals;
  this.stats.frames++;
  var wall = Date.now();
  if (this.wall) this.msPerFrame += (Math.min(100, wall - this.wall) - this.msPerFrame) / 60;
  this.wall = wall;
  var T = this.parts = [process.hrtime.bigint()];
  if (this.expect && (d = differ(this.expect, truth))) {
    // Not the board predicted (a key that never reached the game, a row
    // come up): every plan and question made before is void -- but a swap
    // not yet made is walked to again from this board, so a lost key costs
    // a frame, not the decision.
    var again = this.rewalk(truth), asking = !!pending;
    if (pending) Atomics.store(ABORT, 0, pending.id);
    this.epoch++; this.plan = {}; this.nextAt = 0; this.line = null; pending = null; this.acted = false;
    this.stats.diverged++;
    if (again) {
      for (var i = 0; i < again.inputs.length; i++) this.plan[now + i] = { bits: again.inputs[i], hold: again.holds[i], swap: again.swap };
      this.nextAt = now + again.inputs.length;
      this.acted = !asking;
      this.stats.rewalked++;
    }
    if (process.env.GC_SURVIVOR_DEBUG) console.error('clock ' + now + ' (stopWatch ' + truth.stopWatch + '): ' + d + ' arrivals before ' + JSON.stringify(before.map(function (a) { return a.at; })));
  }
  // A BROKEN SLAB SHOWS ITS COLOURS: every plan and question made before
  // was made without them, while there is still time to line up under the
  // panels before they drop. They are void, and the next question is asked
  // on the board as it is now.
  T.push(process.hrtime.bigint());
  if (!d && this.expect && revealed(this.expect, truth)) {
    if (pending) Atomics.store(ABORT, 0, pending.id);
    this.epoch++; this.plan = {}; this.nextAt = 0; this.line = null; pending = null; this.acted = false;
    this.stats.revealed++;
  }
  // GARBAGE THE PLAN DID NOT KNOW OF: one landing before the plan ends voids
  // it, as a board not predicted does, and one landing before the frame a
  // question is about stops the question, which is asked again. Garbage due
  // later is the next question's: a volley shows a new piece every frame,
  // and stopping on each would never let an answer finish.
  var off = truth.clock - truth.stopWatch, end = this.nextAt;
  if (end > now && SH.unforeseen(this.knew, arrivals).some(function (a) { return a.at + off <= end; })) {
    this.epoch++; this.plan = {}; this.nextAt = 0; this.line = null; this.acted = false;
    if (pending) Atomics.store(ABORT, 0, pending.id);
    pending = null;
    this.stats.unforeseen++;
  }
  if (pending && SH.unforeseen(pending.knew, arrivals).some(function (a) { return a.at + off <= pending.at; })) { Atomics.store(ABORT, 0, pending.id); pending = null; this.acted = false; this.stats.reasked++; }
  T.push(process.hrtime.bigint());
  this.take(truth);
  T.push(process.hrtime.bigint());
  var planned = this.plan[now];
  var bits;
  if (planned) { bits = planned.bits; this.hold = { left: planned.hold.left, started: planned.hold.started }; delete this.plan[now]; }
  else { var id = HANDS.idle(truth, this.hold, arrivals); bits = id.bits; this.hold = id.hold; this.stats.idle++; }
  T.push(process.hrtime.bigint());
  if (process.env.GC_SURVIVOR_DUMP) this.record(truth, bits, arrivals);
  this.made = { truth: truth, bits: bits, arrivals: arrivals, fresh: fresh };   // what the frame makes, worked out after the reply (expectNext)
  this.expect = null;
  return bits;
};
// What this frame makes of the board, once its keys are sent: truth as it
// came, made again from the state (fresh, a seventh of a copy) or copied, and
// run on them.
Match.prototype.expectNext = function () {
  var m = this.made;
  if (!m) return;
  this.made = null;
  var next = m.fresh ? m.fresh() : m.truth.copy();
  if (process.env.GC_SURVIVOR_CHECK_FRESH && m.fresh && JSON.stringify(next) !== JSON.stringify(m.truth)) throw new Error('survivor: the board made again is not the one that came');
  next.setInput(m.bits & ~IN.swap);
  if (m.bits & IN.swap) next.pressSwap = true;
  next.run();
  var pend = SH.pending(m.arrivals);
  land(next, pend);
  this.expect = next; this.nextPending = pend;   // the garbage still to land after it
};
// After the frame's keys are sent: the next decision is asked, a lead before
// it is due, on the board predicted from the one this frame makes. The plan
// never runs further ahead than that, so every decision sees the rows that
// have come up since.
Match.prototype.afterFrame = function () {
  var A = this.aparts = [process.hrtime.bigint()];
  this.expectNext();
  A.push(process.hrtime.bigint());
  var now = this.now, next = this.expect;
  if (!next || next.gameOverClock > 0) return;
  if (pending && this.nextAt - now === 1 && !answers.some(function (a) { return a.id === pending.id; })) {
    if (this.line) this.follow(); else this.stats.noLine++;
  }
  if (pending) return;
  // A question due sooner than an answer can come is asked further on: the
  // line behind the move is played till then -- but never a long wait of
  // it, which would leave the frames after it undecided.
  while (this.line && this.nextAt > now && this.nextAt - now < this.soon() && !isWait(this.line.steps[0]) && this.follow()) {}
  // Never sooner than an answer can come: the frames between are held.
  // While a slab pops nothing can die, so with nothing planned the question
  // is asked a quarter of the pop on (at most `ahead`): the lineup it needs
  // has the time to be found and the pop's frames to be played in.
  var lead = this.nextAt > now ? this.soon() : Math.max(this.soon(), Math.min(this.ahead(), Math.floor(SH.popLeft(next) / 4)));
  var at = Math.max(this.nextAt > now ? this.nextAt : 0, now + lead);
  if (at - now > this.ahead()) return;
  A.push(process.hrtime.bigint());
  var pr = this.predict(next, at, this.hold, this.nextPending);
  A.push(process.hrtime.bigint());
  // Dead by then on what is planned: the question is about the latest of the
  // next few frames the board is still alive on (an answer takes ~25 ms, a
  // frame ~17), at worst the next frame's board, answered late and played
  // from the board it reaches.
  for (var soonAt = Math.min(at - 1, now + 3); pr.board.gameOverClock > 0 && soonAt > now + 1; soonAt--) {
    pr = this.predict(next, soonAt, this.hold, this.nextPending);
    if (pr.board.gameOverClock <= 0) at = soonAt;
  }
  if (pr.board.gameOverClock > 0) { at = now + 1; pr = { board: next, hold: this.hold, pending: this.nextPending }; }
  this.ask(at, pr.board, pr.hold, pr.pending);
};

// The keys planned from frame `from` on, at most n, up to the first frame
// with nothing planned: sent with each answer, so a frame whose answer comes
// too late presses what was planned for it rather than nothing.
var NEXT = 30;
Match.prototype.planned = function (from, n) {
  var out = [];
  for (var t = from; t < from + n && this.plan[t]; t++) out.push(this.plan[t].bits);
  return out;
};
function rowsOf(gs) { var n = 0; for (var i = 0; i < gs.length; i++) n += gs[i].height; return n; }
Match.prototype.record = function (truth, bits, arrivals) {
  this.history.push({ clock: truth.clock, stopWatch: truth.stopWatch, bits: bits, cursor: [truth.curRow, truth.curCol],
                      health: truth.health, stop: truth.stopTime + truth.preStopTime, shake: truth.shakeTime, lock: !!truth.riseLock,
                      // compact, as it is kept for many frames: [pieces, rows] queued,
                      // [pieces, rows, first due] on the way, and the grid as one string
                      incoming: [truth.incoming.length, rowsOf(truth.incoming)],
                      arrivals: [arrivals.length, rowsOf(arrivals.map(function (a) { return a.g; })), arrivals.length ? arrivals[0].at : null],
                      grid: gridOf(truth).join('\n') });
  if (this.history.length > HISTORY) this.history.shift();
  if (truth.clock % SNAP_EVERY === 0) this.snaps.push({ clock: truth.clock, grid: gridOf(truth) });
};
Match.prototype.dump = function () {
  if (this.dumped || !process.env.GC_SURVIVOR_DUMP || !this.history.length) return;
  this.dumped = true;
  require('fs').appendFileSync(process.env.GC_SURVIVOR_DUMP, JSON.stringify({ stats: this.stats, decided: this.decided, asked: this.asked, history: this.history, snaps: this.snaps }) + '\n');
};

// THE PLAN RUNS OUT BEFORE THE ANSWER: the next step of the line the last
// decision was proven by is played instead of holding, and the question --
// about a board that will not now be reached -- is stopped; the next one is
// asked for where the step ends.
function isWait(st) { return !!st && typeof st === 'object' && !Array.isArray(st) && st.long !== undefined; }
Match.prototype.follow = function () {
  var st = this.line.steps[0], kind, move = null, frames = 0;
  if (st === null) kind = 'hold';
  else if (st === 'raise') kind = 'raise';
  else if (Array.isArray(st)) { kind = 'swap'; move = st; }
  // A wait is not followed: the frames it holds are left to the next question.
  else if (isWait(st)) { this.line = null; return false; }
  else { this.line = null; return false; }
  var pr = this.predict(this.expect, this.nextAt, this.hold, this.nextPending);
  var k = HANDS.keys(pr.board, pr.hold, kind, move, pr.pending, frames);
  if (!k) { this.line = null; return false; }
  if (pending) Atomics.store(ABORT, 0, pending.id);
  pending = null; this.acted = false;
  var sw = kind === 'swap' ? swapOf(pr.board, move) : null;
  for (var i = 0; i < k.inputs.length; i++) this.plan[this.nextAt + i] = { bits: k.inputs[i], hold: k.holds[i], swap: sw };
  this.nextAt += k.inputs.length;
  this.line.steps.shift();
  if (!this.line.steps.length) this.line = null;
  this.stats.followed++;
  return true;
};

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
      if (SYNC && m.t === 'f' && match && pending && !answers.some(function (a) { return a.id === pending.id; })) { resume = pump; return; }
      buf = buf.slice(nl + 1);
      if (m.t === 'match') {
        if (match) { console.log('match over: ' + overStats(match)); match.dump(); }
        match = new Match({ levelData: m.levelData, behaviours: m.behaviours, stackOverConditions: m.stackOverConditions });
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
        if (TIMES) TIMES.push(match.now + ' ' + (tWall / 1000).toFixed(4) + ' ' + rms.toFixed(2) + ' ' + fms.toFixed(2) + ' ' + line.length);
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
  server.listen(opt.port, opt.host, function () { console.log(PROFILE.name + ' listening on ' + opt.host + ':' + opt.port + ' (' + opt.threads + ' threads, reaction ' + PROFILE.reaction + ', cursor ' + PROFILE.cursorMoveFrames + ')'); });
})();
