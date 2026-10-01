#!/usr/bin/env node
// WASMSURVIVOR: the survival bot, playing on the panel-game server.
//
//   node survivor.js [--port 47777] [--threads 3]
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
var net = require('net'), path = require('path'), wt = require('worker_threads');
var PA = require(path.join(__dirname, 'pa-engine.js')), SH = require(path.join(__dirname, 'survivor_shared.js'));

var args = process.argv.slice(2), opt = { port: 47777, threads: 3 };
for (var i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = Number(args[i + 1]);
var PROFILE = SH.profile(), HANDS = new SH.Hands(PROFILE), land = SH.land, arrivalsOf = SH.arrivalsOf;
var IN = PA.IN;

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
function unseen(c) { return (c >= 11 && c <= 16) || (c >= 21 && c <= 26); }
function differ(want, got) {
  var k, i;
  for (i = 0; i < STACK_KEYS.length; i++) { k = STACK_KEYS[i]; if (!Object.is(want[k], got[k])) return 'stack.' + k + ' ' + want[k] + ' vs ' + got[k]; }
  if (JSON.stringify(want.incoming) !== JSON.stringify(got.incoming)) return 'incoming ' + JSON.stringify(want.incoming) + ' vs ' + JSON.stringify(got.incoming);
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

// ---------------------------------------------------------------- the death record
// GC_SURVIVOR_DUMP=file: when this side dies, the last HISTORY frames (board,
// keys pressed, garbage on its way) and the decisions made over them are
// written there, a match per line.
var HISTORY = 300;
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
// ABORT[0]: the id of a question the mind should stop working on.
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
  this.stats = { frames: 0, decisions: 0, played: 0, late: 0, diverged: 0, refused: 0, maxMs: 0, idle: 0, lateTaken: 0, followed: 0, noLine: 0, unforeseen: 0, rewalked: 0, break1: 0, took1: 0, break2: 0, took2: 0, break3: 0, took3: 0 };
  this.history = []; this.decided = []; this.asked = []; this.dumped = false;
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
// The board at `at`, from `board` now, pressing what is planned till then.
Match.prototype.predict = function (board, at, hold) {
  var st = board.copy(), h = { left: hold.left, started: hold.started }, arrivals = this.arrivals;
  while (st.clock < at && st.gameOverClock <= 0) {
    var planned = this.plan[st.clock], bits;
    if (planned !== undefined) { bits = planned.bits; h = { left: planned.hold.left, started: planned.hold.started }; }
    else { var id = HANDS.idle(st, h, arrivals); bits = id.bits; h = id.hold; }
    st.setInput(bits & ~IN.swap);
    if (bits & IN.swap) st.pressSwap = true;
    st.run();
    land(st, arrivals);
  }
  return { board: st, hold: h };
};
Match.prototype.ask = function (at, board, hold) {
  var arrivals = this.arrivals.filter(function (a) { return a.at > board.stopWatch; });
  pending = { id: nextId++, epoch: this.epoch, at: at, board: board, hold: hold, arrivals: arrivals, knew: this.arrivals, askedAt: this.now, sent: Date.now() };
  if (process.env.GC_SURVIVOR_DUMP) {
    // The question as the mind got it, to be asked again offline (survivor_probe.js).
    this.asked.push({ id: pending.id, at: at, hold: hold, arrivals: arrivals, acted: this.acted,
                      board: require('v8').serialize(board).toString('base64') });
    if (this.asked.length > 12) this.asked.shift();
  }
  mind.postMessage({ id: pending.id, epoch: this.epoch, at: at, lead: at - this.now, board: board, hold: hold, arrivals: arrivals, acted: this.acted });
  this.stats.decisions++;
};
// The answer: its keys go in the plan, and the next decision is due on the
// frame they end on. One that came after its frame is played from this
// frame's board if its move still stands -- the frames since were held, as
// the board it was decided on assumed -- with the swap found again by its
// panels, in case a row has come up since.
function moved(from, to, move) {
  var a = from.panels[move[0]] && from.panels[move[0]][move[1]], b = from.panels[move[0]] && from.panels[move[0]][move[1] + 1];
  if (!a || !b) return null;
  for (var r = 1; r < to.panels.length; r++) {
    var row = to.panels[r];
    if (row && row[move[1]] && row[move[1]].id === a.id) return row[move[1] + 1] && row[move[1] + 1].id === b.id ? [r, move[1]] : null;
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
  var sw = this.plan[first].swap, move = moved(sw.board, truth, sw.move);
  var k = move && HANDS.keys(truth, this.hold, 'swap', move, this.arrivals);
  if (k) k.swap = { move: move, board: truth };
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
    if (process.env.GC_SURVIVOR_DEBUG && a.mem) console.error('decision ' + a.id + ' at ' + a.at + ': ' + a.ms + ' ms ' + a.kind + ' ' + JSON.stringify(a.move) + ' ' + JSON.stringify(a.diag) + ' ' + Math.round(a.mem.bytes / 1048576) + 'MB');
    if (a.error) { console.error('decision failed: ' + a.error); this.acted = false; pending = null; continue; }
    if (a.breaks) { this.stats['break' + a.breaks.offered]++; if (a.breaks.took) this.stats['took' + a.breaks.offered]++; }
    this.decided.push({ id: a.id, at: a.at, now: now, kind: a.kind, move: a.move, ms: a.ms, diag: a.diag,
                       asked: pending && pending.id === a.id ? pending.askedAt : null, trip: pending && pending.id === a.id ? a.got - pending.sent : null });
    if (this.decided.length > 60) this.decided.shift();
    if (!pending || a.id !== pending.id) continue;
    var p = pending, board = p.board, hold = p.hold, at = a.at, arrivals = p.arrivals, move = a.move, knew = p.knew;
    pending = null;
    if (a.epoch !== this.epoch) { this.stats.late++; this.acted = false; continue; }
    if (at < now) {
      if (a.kind === 'swap' && !(move = moved(p.board, truth, a.move))) { this.stats.late++; this.acted = false; continue; }
      board = truth; hold = this.hold; at = now; arrivals = this.arrivals; knew = this.arrivals;
      this.stats.lateTaken++;
    }
    var step = HANDS.keys(board, hold, a.kind, move, arrivals);
    if (!step) { this.stats.refused++; this.acted = false; continue; }
    this.acted = true;
    this.stats.played++;
    // Each planned frame carries the raise held after it.
    var sw = a.kind === 'swap' ? { move: move, board: board } : null;
    for (var i = 0; i < step.inputs.length; i++) this.plan[at + i] = { bits: step.inputs[i], hold: step.holds[i], swap: sw };
    this.nextAt = at + step.inputs.length;
    this.knew = knew;
    // The line behind the move holds from where the move ends, played as decided.
    this.line = a.line && a.lineAt === this.nextAt && at === a.at ? { steps: a.line.slice(), at: a.lineAt } : null;
  }
};
Match.prototype.frame = function (truth, arrivals) {
  var now = truth.clock, d, before = this.arrivals;
  this.now = now;
  this.arrivals = arrivals;
  this.stats.frames++;
  var wall = Date.now();
  if (this.wall) this.msPerFrame += (Math.min(100, wall - this.wall) - this.msPerFrame) / 60;
  this.wall = wall;
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
  // GARBAGE THE PLAN DID NOT KNOW OF: one landing before the plan ends voids
  // it, as a board not predicted does; the question asked without it is
  // stopped either way, and asked again.
  var off = truth.clock - truth.stopWatch, end = this.nextAt;
  if (end > now && SH.unforeseen(this.knew, arrivals).some(function (a) { return a.at + off <= end; })) {
    this.epoch++; this.plan = {}; this.nextAt = 0; this.line = null; this.acted = false;
    if (pending) Atomics.store(ABORT, 0, pending.id);
    pending = null;
    this.stats.unforeseen++;
  }
  if (pending && SH.unforeseen(pending.knew, arrivals).length) { Atomics.store(ABORT, 0, pending.id); pending = null; this.acted = false; }
  this.take(truth);
  var planned = this.plan[now];
  var bits;
  if (planned) { bits = planned.bits; this.hold = { left: planned.hold.left, started: planned.hold.started }; delete this.plan[now]; }
  else { var id = HANDS.idle(truth, this.hold, arrivals); bits = id.bits; this.hold = id.hold; this.stats.idle++; }
  // What this frame should make of the board.
  var next = truth.copy();
  next.setInput(bits & ~IN.swap);
  if (bits & IN.swap) next.pressSwap = true;
  next.run();
  land(next, arrivals);
  this.expect = next;
  if (process.env.GC_SURVIVOR_DUMP) this.record(truth, bits, arrivals);
  return bits;
};
// After the frame's keys are sent: the next decision is asked, a lead before
// it is due, on the board predicted from the one this frame makes. The plan
// never runs further ahead than that, so every decision sees the rows that
// have come up since.
Match.prototype.afterFrame = function () {
  var now = this.now, next = this.expect;
  if (!next || next.gameOverClock > 0) return;
  if (pending && this.nextAt - now === 1 && !answers.some(function (a) { return a.id === pending.id; })) {
    if (this.line) this.follow(); else this.stats.noLine++;
  }
  if (pending) return;
  var at = this.nextAt > now ? this.nextAt : now + this.soon();
  if (at - now > this.ahead()) return;
  var pr = this.predict(next, at, this.hold);
  this.ask(at, pr.board, pr.hold);
};

Match.prototype.record = function (truth, bits, arrivals) {
  this.history.push({ clock: truth.clock, stopWatch: truth.stopWatch, bits: bits, cursor: [truth.curRow, truth.curCol],
                      incoming: truth.incoming, arrivals: arrivals.map(function (a) { return [a.at, a.g.width, a.g.height, !!a.g.isChain, !!a.g.isMetal]; }),
                      grid: gridOf(truth) });
  if (this.history.length > HISTORY) this.history.shift();
};
Match.prototype.dump = function () {
  if (this.dumped || !process.env.GC_SURVIVOR_DUMP || !this.history.length) return;
  this.dumped = true;
  require('fs').appendFileSync(process.env.GC_SURVIVOR_DUMP, JSON.stringify({ stats: this.stats, decided: this.decided, asked: this.asked, history: this.history }) + '\n');
};

// THE PLAN RUNS OUT BEFORE THE ANSWER: the next step of the line the last
// decision was proven by is played instead of holding, and the question --
// about a board that will not now be reached -- is stopped; the next one is
// asked for where the step ends.
Match.prototype.follow = function () {
  var st = this.line.steps[0], kind, move = null, frames = 0;
  if (st === null) kind = 'hold';
  else if (st === 'raise') kind = 'raise';
  else if (Array.isArray(st)) { kind = 'swap'; move = st; }
  else if (st && st.long !== undefined) { kind = 'long'; frames = -Math.max(1, st.long - (this.nextAt - this.line.at)); }
  else { this.line = null; return; }
  var pr = this.predict(this.expect, this.nextAt, this.hold);
  var k = HANDS.keys(pr.board, pr.hold, kind, move, this.arrivals, frames);
  if (!k) { this.line = null; return; }
  Atomics.store(ABORT, 0, pending.id);
  pending = null; this.acted = false;
  var sw = kind === 'swap' ? { move: move, board: pr.board } : null;
  for (var i = 0; i < k.inputs.length; i++) this.plan[this.nextAt + i] = { bits: k.inputs[i], hold: k.holds[i], swap: sw };
  this.nextAt += k.inputs.length;
  this.line.steps.shift();
  if (!this.line.steps.length) this.line = null;
  this.stats.followed++;
};

// ---------------------------------------------------------------- the link
var server = net.createServer(function (sock) {
  var buf = '', match = null;
  sock.setNoDelay(true);
  sock.on('error', function (e) { console.log('link: ' + e.message); });
  sock.on('close', function () { if (match) { console.log('match over: ' + JSON.stringify(match.stats)); match.dump(); } match = null; });
  function pump() {
    var nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      var line = buf.slice(0, nl);
      if (!line) { buf = buf.slice(nl + 1); continue; }
      var m = JSON.parse(line), reply;
      if (SYNC && m.t === 'f' && match && pending && !answers.some(function (a) { return a.id === pending.id; })) { resume = pump; return; }
      buf = buf.slice(nl + 1);
      if (m.t === 'match') {
        if (match) { console.log('match over: ' + JSON.stringify(match.stats)); match.dump(); }
        match = new Match({ levelData: m.levelData, behaviours: m.behaviours, stackOverConditions: m.stackOverConditions });
        reply = { ok: true };
      } else if (m.t === 'f') {
        if (!match) { reply = { input: 0 }; }
        else {
          var truth = PA.fromLua(m.state, match.level, new PA.Unseen());
          reply = { clock: truth.clock, input: match.frame(truth, arrivalsOf(m.state)) };
        }
      } else if (m.t === 'bye') { if (match) { console.log('match over: ' + JSON.stringify(match.stats)); match.dump(); } match = null; reply = { ok: true }; }
      sock.write(JSON.stringify(reply) + '\n');
      if (match && m.t === 'f') match.afterFrame();
    }
  }
  sock.on('data', function (chunk) { buf += chunk; if (!resume) pump(); });
});
(function wait() {
  if (!mindReady) { setTimeout(wait, 20); return; }
  server.listen(opt.port, '127.0.0.1', function () { console.log(PROFILE.name + ' listening on 127.0.0.1:' + opt.port + ' (' + opt.threads + ' threads, reaction ' + PROFILE.reaction + ', cursor ' + PROFILE.cursorMoveFrames + ')'); });
})();
