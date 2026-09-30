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
var PA = require(path.join(__dirname, 'pa-engine.js'));

var args = process.argv.slice(2), opt = { port: 47777, threads: 3 };
for (var i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = Number(args[i + 1]);
var CFG = { reaction: 12, cursorMoveFrames: 4, threads: opt.threads, weights: 'trained.pbt.pbt-r22-s322.0926-142336.g03120.json' };
var IN = PA.IN;

// ---------------------------------------------------------------- garbage on its way
// What the senders' telegraphs show (bot/SurvivalLink.lua telegraph), as the
// garbage this board will receive and the stopWatch it arrives on: garbage
// due at T is received once the frame before T has run, so the board sent
// for frame T already holds it. A sender stages garbage for STAGING frames, then it lands
// LAND frames later; the staged are shipped highest priority first (the
// end of the list) and an unfinished chain holds back everything behind it,
// so nothing past one is counted on.
var STAGING = 45 + 45 + 1, LAND = 60;
function arrivalsOf(state) {
  var out = [], mine = state.stack.stopWatch;
  PA.list(state.telegraph).forEach(function (src) {
    var offset = mine - src.stopWatch;
    PA.list(src.transit).forEach(function (t) {
      PA.list(t.garbage).forEach(function (g) { out.push({ at: t.at + offset, g: g }); });
    });
    var staged = PA.list(src.staged), ship = src.stopWatch;
    for (var i = staged.length - 1; i >= 0; i--) {
      var g = staged[i];
      if (g.isChain && !g.finalized) break;
      ship = Math.max(ship, g.frameEarned + STAGING);
      out.push({ at: ship + LAND + offset, g: g });
    }
  });
  return out.sort(function (x, y) { return x.at - y.at; });
}
// Garbage due on the frame just reached, received as the server receives it.
function land(st, arrivals) {
  for (var i = 0; i < arrivals.length; i++) if (arrivals[i].at === st.stopWatch) st.receiveGarbage([arrivals[i].g]);
}

// ---------------------------------------------------------------- the hands
// search.h's walk, swap, raise and reaction on a pa-engine.js board: the
// frames a decision takes and the keys pressed on each.
function raiseStep(h, st) {
  var bits = 0;
  if (h.left > 0) {
    if (st.manualRaise) h.started = true;
    if (st.preventManualRaise || (h.started && !st.manualRaise)) h.left = 0;
    else { h.left--; bits |= IN.raise; }
  }
  return bits;
}
// Returns { inputs, end, hold } or null when the move is refused. `end` is
// the board at the decision after this one; `hold` the raise still held.
function playStep(board, hold, kind, move, arrivals) {
  var st = board.copy(), h = { left: hold.left, started: hold.started }, inputs = [], holds = [];
  var walk = null, cooldown = 0, lastSwap = false, reaction = CFG.reaction;
  function driveWalk() {
    var w = walk, bits = 0;
    if (w.disp !== undefined && st.displacement > w.disp) w.row++;
    w.disp = st.displacement;
    var row = Math.max(1, Math.min(w.row, st.topCurRow)), col = Math.max(1, Math.min(w.col, 5));
    if (st.curRow !== row || st.curCol !== col) {
      if (w.timer > 0) { w.timer--; return 0; }
      if (st.curCol < col) bits |= IN.right;
      else if (st.curCol > col) bits |= IN.left;
      else if (st.curRow < row) bits |= IN.up;
      else bits |= IN.down;
      w.timer = CFG.cursorMoveFrames - 1;
      return bits;
    }
    var ok = st.tryQueueSwap(st.curRow, st.curCol);
    walk = null;
    if (ok) { lastSwap = true; cooldown = w.cooldown; return 0; }
    return null;                        // refused where it stood: search.h's retry is a refusal too
  }
  function frame(bits) {
    var sent = bits | (st.pressSwap ? IN.swap : 0);
    st.setInput(bits);
    st.run();
    land(st, arrivals);
    inputs.push(sent);
    holds.push({ left: h.left, started: h.started });
    if (kind === 'swap' && st.swapDeniedThisFrame) return false;
    return true;
  }
  var bits = raiseStep(h, st);
  if (kind === 'swap') {
    walk = { row: move[0], col: move[1], timer: 0, cooldown: reaction, retries: 0 };
    var b = driveWalk();
    if (b === null) return null;
    bits |= b;
  } else if (kind === 'raise') { h.left = 20; h.started = false; cooldown = reaction; }
  else cooldown = reaction;
  if (kind === 'swap' && !walk && !lastSwap) return null;
  if (!frame(bits)) return null;
  for (var guard = 0; guard < 4000 && st.gameOverClock <= 0; guard++) {
    bits = raiseStep(h, st);
    if (walk) {
      var b2 = driveWalk();
      if (b2 === null) return null;
      if (!frame(bits | b2)) return null;
      continue;
    }
    if (cooldown > 0) { cooldown--; if (!frame(bits)) return null; continue; }
    break;
  }
  return { inputs: inputs, holds: holds, end: st, hold: h };
}

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

// ---------------------------------------------------------------- the mind
var mind = new wt.Worker(path.join(__dirname, 'survivor_mind.js'), { workerData: CFG });
var mindReady = false, nextId = 1, pending = null, answers = [], thinking = [];
mind.on('message', function (m) { if (m.ready) { mindReady = true; return; } answers.push(m); });
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
  this.stats = { frames: 0, decisions: 0, played: 0, late: 0, diverged: 0, refused: 0, maxMs: 0 };
  // A question from the last match is not this one's: its answer is dropped.
  pending = null;
  mind.postMessage({ type: 'reset' });
}
// How far ahead to ask: half again the slowest of the last few answers.
Match.prototype.lead = function () {
  var worst = thinking.length ? Math.max.apply(null, thinking) : 500;
  return Math.max(6, Math.min(600, Math.ceil(worst * 0.06 * 1.5)));
};
// The board at `at`, from `board` now, pressing what is planned till then.
Match.prototype.predict = function (board, at, hold) {
  var st = board.copy(), h = { left: hold.left, started: hold.started }, arrivals = this.arrivals;
  while (st.clock < at && st.gameOverClock <= 0) {
    var planned = this.plan[st.clock], bits = planned !== undefined ? planned.bits : raiseStep(h, st);
    if (planned !== undefined) h = { left: planned.hold.left, started: planned.hold.started };
    st.setInput(bits & ~IN.swap);
    if (bits & IN.swap) st.pressSwap = true;
    st.run();
    land(st, arrivals);
  }
  return { board: st, hold: h };
};
Match.prototype.ask = function (at, board, hold) {
  var arrivals = this.arrivals.filter(function (a) { return a.at > board.stopWatch; });
  pending = { id: nextId++, epoch: this.epoch, at: at, board: board, hold: hold, arrivals: arrivals };
  mind.postMessage({ id: pending.id, epoch: this.epoch, at: at, board: board, hold: hold, arrivals: arrivals, acted: this.acted });
  this.stats.decisions++;
};
// The answer, if it is for a board still to come: its keys go in the plan,
// and the next decision is due on the frame they end on.
Match.prototype.take = function (now) {
  while (answers.length) {
    var a = answers.shift();
    thinking.push(a.ms); if (thinking.length > 8) thinking.shift();
    this.stats.maxMs = Math.max(this.stats.maxMs, a.ms);
    if (a.mem) this.stats.memMB = Math.round(a.mem.bytes / 1048576);
    if (process.env.GC_SURVIVOR_DEBUG && a.mem) console.error('decision ' + a.id + ' at ' + a.at + ': ' + a.ms + ' ms ' + a.kind + ' ' + JSON.stringify(a.move) + ' ' + JSON.stringify(a.diag) + ' ' + Math.round(a.mem.bytes / 1048576) + 'MB');
    if (a.error) { console.error('decision failed: ' + a.error); this.acted = false; pending = null; continue; }
    if (!pending || a.id !== pending.id) continue;
    var p = pending;
    pending = null;
    if (a.epoch !== this.epoch || a.at < now) { this.stats.late++; this.acted = false; continue; }
    var step = playStep(p.board, p.hold, a.kind, a.move, p.arrivals);
    if (!step) { this.stats.refused++; this.acted = false; continue; }
    this.acted = true;
    this.stats.played++;
    // The frames till it starts are holds, as predicted; each planned frame
    // carries the raise held after it.
    for (var i = 0; i < step.inputs.length; i++) this.plan[a.at + i] = { bits: step.inputs[i], hold: step.holds[i] };
    this.nextAt = a.at + step.inputs.length;
  }
};
Match.prototype.frame = function (truth, arrivals) {
  var now = truth.clock, d, before = this.arrivals;
  this.arrivals = arrivals;
  this.stats.frames++;
  if (this.expect && (d = differ(this.expect, truth))) {
    // Not the board predicted: every plan and question made before is void.
    this.epoch++; this.plan = {}; this.nextAt = 0; pending = null; this.acted = false;
    this.stats.diverged++;
    if (process.env.GC_SURVIVOR_DEBUG) console.error('clock ' + now + ' (stopWatch ' + truth.stopWatch + '): ' + d + ' arrivals before ' + JSON.stringify(before.map(function (a) { return a.at; })));
  }
  this.take(now);
  // The next decision is asked a lead before it is due, on the board
  // predicted from this one: the plan never runs further ahead than that, so
  // every decision sees the rows that have come up since.
  var planned = this.plan[now], lead = this.lead();
  if (!pending && truth.gameOverClock <= 0) {
    var at = this.nextAt > now ? this.nextAt : now + lead;
    if (at - now <= lead) { var pr = this.predict(truth, at, this.hold); this.ask(at, pr.board, pr.hold); }
  }
  var bits;
  if (planned) { bits = planned.bits; this.hold = { left: planned.hold.left, started: planned.hold.started }; delete this.plan[now]; }
  else bits = raiseStep(this.hold, truth);
  // What this frame should make of the board.
  var next = truth.copy();
  next.setInput(bits & ~IN.swap);
  if (bits & IN.swap) next.pressSwap = true;
  next.run();
  land(next, arrivals);
  this.expect = next;
  return bits;
};

// ---------------------------------------------------------------- the link
var server = net.createServer(function (sock) {
  var buf = '', match = null;
  sock.setNoDelay(true);
  sock.on('error', function (e) { console.log('link: ' + e.message); });
  sock.on('close', function () { if (match) console.log('match over: ' + JSON.stringify(match.stats)); match = null; });
  sock.on('data', function (chunk) {
    buf += chunk;
    var nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      var line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line) continue;
      var m = JSON.parse(line), reply;
      if (m.t === 'match') {
        if (match) console.log('match over: ' + JSON.stringify(match.stats));
        match = new Match({ levelData: m.levelData, behaviours: m.behaviours, stackOverConditions: m.stackOverConditions });
        reply = { ok: true };
      } else if (m.t === 'f') {
        if (!match) { reply = { input: 0 }; }
        else {
          var truth = PA.fromLua(m.state, match.level, new PA.Unseen());
          reply = { clock: truth.clock, input: match.frame(truth, arrivalsOf(m.state)) };
        }
      } else if (m.t === 'bye') { if (match) console.log('match over: ' + JSON.stringify(match.stats)); match = null; reply = { ok: true }; }
      sock.write(JSON.stringify(reply) + '\n');
    }
  });
  sock.on('close', function () { if (match) console.log('link closed: ' + JSON.stringify(match.stats)); });
});
(function wait() {
  if (!mindReady) { setTimeout(wait, 20); return; }
  server.listen(opt.port, '127.0.0.1', function () { console.log('WasmSurvivor listening on 127.0.0.1:' + opt.port + ' (' + CFG.threads + ' threads)'); });
})();
