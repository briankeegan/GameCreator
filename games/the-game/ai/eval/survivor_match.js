// WASMSURVIVOR'S FRAME LOOP: one match, a frame at a time. Each frame it is
// handed the board (truth) and the garbage on its way, and returns the keys
// pressed; after it, the next decision is asked of the mind, on the board
// predicted for the frame it is due. survivor.js runs it against the
// panel-game server; survivor_duel.js runs two against each other on
// pa-engine.js.
//
//   new Match(level, link)
//   link: { post(question), abort (Int32Array), answers [], thinking [],
//           nextId, pending, sync, profile, hands, msPerFrame? }
//   the link's owner pushes the mind's answers onto link.answers
var path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), SH = require(path.join(__dirname, 'survivor_shared.js'));
var KEYS = require('./survivor_keys.js'), land = SH.land, IN = PA.IN, V8 = require('v8');
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

// ---------------------------------------------------------------- one match
function Match(level, L) {
  this.L = L;
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
  this.stats = { frames: 0, frameMs: 0, slowFrames: 0, decisions: 0, played: 0, late: 0, diverged: 0, refused: 0, maxMs: 0, idle: 0, lateTaken: 0, followed: 0, noLine: 0, unforeseen: 0, reasked: 0, revealed: 0, lineup: 0, tookLineup: 0, touch: 0, tookTouch: 0, unasked: 0, rewalked: 0, break1: 0, took1: 0, break2: 0, took2: 0, break3: 0, took3: 0, swaps: 0, undone: 0, actions: 0, maxWindow: 0, overInput: 0, heldWalks: 0, guarded: 0 };
  this.history = []; this.decided = []; this.asked = []; this.snaps = []; this.dumped = false;
  this.msPerFrame = L.msPerFrame || 1000 / 60; this.wall = 0;   // how fast frames come (soon); a link may fix it (msPerFrame)
  // A question from the last match is not this one's: its answer is dropped.
  L.pending = null;
  L.post({ type: 'reset' });
}
// How soon an answer can be had, in frames: half again the slowest of the
// last few, at the rate frames are coming in (msPerFrame).
Match.prototype.soon = function () {
  var L = this.L;
  if (L.sync) return 1;
  var worst = L.thinking.length ? Math.max.apply(null, L.thinking) : 300;
  return Math.max(6, Math.min(600, Math.ceil(worst / this.msPerFrame * 1.5)));
};
// How far ahead a decision may be asked (the profile's `ahead`, frames): a
// long move's frames are spent deciding the next, which a short one needs.
Match.prototype.ahead = function () {
  var L = this.L;
  if (process.env.GC_SURVIVOR_LEAD) return Number(process.env.GC_SURVIVOR_LEAD);
  return L.sync ? 1 : Math.max(L.profile.ahead, this.soon());
};
// The board at `at`, from `board` now, pressing what is planned till then,
// and the garbage still to land after it (SH.land: what the game holds back
// is still L.pending).
Match.prototype.predict = function (board, at, hold, from) {
  var L = this.L;
  var fast = this.predictNative(board, at, hold, from);
  if (fast && process.env.GC_SURVIVOR_CHECK_PREDICT) {
    var slow = this.predictJS(board, at, hold, from), d = differ(slow.board, fast.board);
    if (d || JSON.stringify(slow.hold) !== JSON.stringify(fast.hold) || JSON.stringify(slow.pending) !== JSON.stringify(fast.pending)) throw new Error('survivor: predicted natively, not as played: ' + (d || 'hold or L.pending'));
  }
  if (!fast) throw new Error('survivor: the engine could not predict from clock ' + board.clock + ' to ' + at);
  return fast;
};
// The same on the engine (native/pa.c). A frame the plan has nothing for is
// L.hands.idle's: a raise still held goes on as search.h raiseStep plays it.
var NB = null;
function nativeNow() { if (!NB) { NB = require(path.join(__dirname, 'native.js')).server; NB.init(); } return NB; }
Match.prototype.predictNative = function (board, at, hold, from) {
  var L = this.L;
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
  var L = this.L;
  var st = board.copy(), h = { left: hold.left, started: hold.started }, arrivals = SH.pending(from || this.arrivals);
  while (st.clock < at && st.gameOverClock <= 0) {
    var planned = this.plan[st.clock], bits;
    if (planned !== undefined) { bits = planned.bits; h = { left: planned.hold.left, started: planned.hold.started }; }
    else { var id = L.hands.idle(st, h, arrivals); bits = id.bits; h = id.hold; }
    st.setInput(bits & ~IN.swap);
    if (bits & IN.swap) st.pressSwap = true;
    st.run();
    land(st, arrivals);
  }
  return { board: st, hold: h, pending: arrivals };
};
Match.prototype.ask = function (at, board, hold, pend) {
  var L = this.L;
  var arrivals = (pend || this.arrivals).filter(function (a) { return a.at > board.stopWatch || a.capped; });
  // The board goes and is kept as bytes, off this thread's heap: held till
  // its answer comes, a board object would outlive the young generation.
  var packed = V8.serialize(board);
  L.pending = { id: L.nextId++, epoch: this.epoch, at: at, packed: packed, hold: hold, arrivals: arrivals, knew: this.arrivals, askedAt: this.now, sent: Date.now() };
  if (process.env.GC_SURVIVOR_DUMP) {
    // The question as the mind got it, to be asked again offline (survivor_probe.js).
    this.asked.push({ id: L.pending.id, at: at, hold: hold, arrivals: arrivals, acted: this.acted,
                      board: packed.toString('base64') });
    if (this.asked.length > 40 * KEEP) this.asked.shift();
  }
  L.post({ id: L.pending.id, epoch: this.epoch, at: at, lead: at - this.now, ms: L.sync ? 0 : (at - this.now) * this.msPerFrame, posted: Date.now(), allowance: this.allowanceAt(at),
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
// Every panel's id by square, as one string; with a swap's two squares exchanged
// it is the board as that swap leaves it.
function idsOf(board, move) {
  var out = [];
  for (var r = 1; r < board.panels.length; r++) {
    var row = board.panels[r] || [], line = [];
    for (var c = 1; c <= 6; c++) {
      var k = move && r === move[0] ? (c === move[1] ? c + 1 : c === move[1] + 1 ? c - 1 : c) : c;
      line.push(row[k] ? row[k].id : '');
    }
    out.push(line.join(','));
  }
  return out.join(';');
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
  var L = this.L;
  var now = truth.clock, first = Infinity, t;
  for (t in this.plan) if (+t >= now && +t < first && (this.plan[t].bits & IN.swap) && this.plan[t].swap) first = +t;
  if (first === Infinity) return null;
  var move = moved(this.plan[first].swap, truth);
  var k = move && L.hands.keys(truth, this.hold, 'swap', move, this.arrivals);
  if (k) k.swap = swapOf(truth, move);
  return k;
};
Match.prototype.take = function (truth) {
  var L = this.L;
  var now = truth.clock;
  while (L.answers.length) {
    var a = L.answers.shift();
    if (a.aborted) continue;
    L.thinking.push(a.ms); if (L.thinking.length > 8) L.thinking.shift();
    this.stats.maxMs = Math.max(this.stats.maxMs, a.ms);
    if (a.mem) this.stats.memMB = Math.round(a.mem.bytes / 1048576);
    if (process.env.GC_SURVIVOR_DEBUG && a.mem) console.error('decision ' + a.id + ' at ' + a.at + ': ' + a.ms + ' ms (break ' + a.brMs + ') ' + a.kind + ' ' + JSON.stringify(a.move) + ' ' + JSON.stringify(a.diag) + ' ' + Math.round(a.mem.bytes / 1048576) + 'MB');
    if (a.error) { console.error('decision failed: ' + a.error); this.acted = false; L.pending = null; continue; }
    if (a.diag && a.diag.tight) this.stats.tight = (this.stats.tight || 0) + 1;
    if (a.diag && a.diag.walk != null) { this.stats.walks = (this.stats.walks || 0) + 1; this.stats.walkFrames = (this.stats.walkFrames || 0) + a.diag.walk; }
    if (a.diag && a.diag.unaffordable !== undefined) this.stats.unaffordable = a.diag.unaffordable;
    if (a.diag && a.diag.bare3Dropped !== undefined) { this.stats.bare3Dropped = a.diag.bare3Dropped; this.stats.bare3Kept = a.diag.bare3Kept; this.stats.bare3Topped = a.diag.bare3Topped; }
    if (a.breaks) { this.stats['break' + a.breaks.offered]++; if (a.breaks.took) this.stats['took' + a.breaks.offered]++; if (a.breaks.lineup) { this.stats.lineup++; if (a.breaks.took) this.stats.tookLineup++; } if (a.breaks.touch) { this.stats.touch++; if (a.breaks.took) this.stats.tookTouch++; } }
    this.decided.push({ id: a.id, at: a.at, now: now, kind: a.kind, move: a.move, ms: a.ms, diag: a.diag, breaks: a.breaks,
                       asked: L.pending && L.pending.id === a.id ? L.pending.askedAt : null, trip: L.pending && L.pending.id === a.id ? a.got - L.pending.sent : null });
    if (this.decided.length > 60 * KEEP) this.decided.shift();
    if (!L.pending || a.id !== L.pending.id) { this.stats.unasked++; continue; }
    var p = L.pending, board = unpack(p.packed), hold = p.hold, at = a.at, arrivals = p.arrivals, move = a.move, knew = p.knew;
    L.pending = null;
    if (a.epoch !== this.epoch) { this.stats.late++; this.acted = false; continue; }
    if (at < now) {
      if (a.kind === 'swap' && !(move = moved(swapOf(board, a.move), truth))) { this.stats.late++; this.acted = false; continue; }
      board = truth; hold = this.hold; at = now; arrivals = this.arrivals; knew = this.arrivals;
      this.stats.lateTaken++;
      // the latest answer taken: frames over, and where its time went
      if (!this.stats.lateWorst || now - a.at > this.stats.lateWorst.over)
        this.stats.lateWorst = { over: now - a.at, ms: a.ms, br: a.brMs, took: a.diag && a.diag.took, survive: a.diag && a.diag.survive, budget: a.diag && a.diag.budget, queued: a.queued };
    }
    // A swap that puts back the two panels the swap before it exchanged is a
    // swap back. It is played when it clears something or breaks the garbage
    // wanted, or once when something else on the board has changed since;
    // otherwise it is played as a hold. A second swap back in a row never is.
    var back = false;
    if (a.kind === 'swap' && move && this.lastSwap) {
      var us = swapOf(board, move), lw = this.lastSwap;
      back = !!(us.ids && lw.move[0] === move[0] && lw.move[1] === move[1] && lw.ids[0] === us.ids[1] && lw.ids[1] === us.ids[0]);
      if (back) {
        var clears = (a.diag && a.diag.clears > 0) || (a.breaks && a.breaks.took), changed = lw.after !== idsOf(board);
        if (!clears && !(changed && !lw.backs)) {
          a = Object.assign({}, a, { kind: 'hold', move: null, line: null });
          move = null; back = false;
          this.stats.undone++;
        }
      }
    }
    var step = L.hands.keys(board, hold, a.kind, move, arrivals);
    if (!step) { this.stats.refused++; this.acted = false; continue; }
    this.acted = true;
    this.stats.played++;
    var ins = this.holdWalks(step.inputs);
    if (!this.fits(at, ins)) { this.stats.guarded++; this.acted = false; continue; }
    this.stats.heldWalks += ins.held;
    // Each planned frame carries the raise held after it.
    var sw = a.kind === 'swap' ? swapOf(board, move) : null;
    // the swaps played
    if (a.kind === 'swap' && move && sw && sw.ids) {
      this.stats.swaps++;
      sw.after = idsOf(board, move);
      sw.backs = back ? this.lastSwap.backs + 1 : 0;
      this.lastSwap = sw;
    }
    for (var t in this.plan) if (+t >= at) delete this.plan[t];
    for (var i = 0; i < ins.length; i++) this.plan[at + i] = { bits: ins[i], hold: step.holds[i], swap: sw };
    this.nextAt = at + step.inputs.length;
    this.knew = knew;
    // The line behind the move holds from where the move ends, played as decided.
    this.line = a.line && (a.lineFree || a.lineAt === this.nextAt) && at === a.at ? { steps: a.line.slice(), at: this.nextAt } : null;
  }
};
// THE INPUT BUDGET (the game's InputBudget): swap and direction keys going down,
// at most ACTION_LIMIT of them in any ACTION_WINDOW frames (456 a minute).
var ACTION_WINDOW = 600, ACTION_LIMIT = Math.floor(456 * ACTION_WINDOW / 3600);
// How many actions the game still allows a move starting on frame `at`: the
// allowance less the presses made and planned in the window before it.
Match.prototype.allowanceAt = function (at) {
  var counted = IN.swap | IN.up | IN.down | IN.left | IN.right, lo = at - ACTION_WINDOW, used = 0, prev = this.prevBits || 0;
  (this.pressFrames || []).forEach(function (f) { if (f > lo) used++; });
  for (var t = this.now; t < at; t++) {
    var bits = this.plan[t] ? this.plan[t].bits : 0, down = bits & counted & ~prev;
    prev = bits;
    for (var k = 1; k <= 16; k <<= 1) if (down & k && t > lo) used++;
  }
  return Math.max(0, ACTION_LIMIT - used);
};
// Whether the keys `ins` from frame `at` stay inside the allowance in every window.
Match.prototype.fits = function (at, ins) {
  var counted = IN.swap | IN.up | IN.down | IN.left | IN.right, prev = this.prevBits || 0, spent = (this.pressFrames || []).slice();
  for (var t = this.now; t < at + ins.length; t++) {
    var bits = t >= at ? ins[t - at] : (this.plan[t] ? this.plan[t].bits : 0), down = bits & counted & ~prev;
    prev = bits;
    for (var k = 1; k <= 16; k <<= 1) if (down & k) {
      while (spent.length && t - spent[0] >= ACTION_WINDOW) spent.shift();
      if (spent.length >= ACTION_LIMIT) return false;
      spent.push(t);
    }
  }
  return true;
};
Match.prototype.countActions = function (bits, now) {
  var counted = IN.swap | IN.up | IN.down | IN.left | IN.right, down = bits & counted & ~(this.prevBits || 0), st = this.stats;
  this.prevBits = bits;
  var pf = this.pressFrames || (this.pressFrames = []);
  [IN.swap, IN.up, IN.down, IN.left, IN.right].forEach(function (k) { if (down & k) { pf.push(now); st.actions++; } });
  while (pf.length && now - pf[0] >= ACTION_WINDOW) pf.shift();
  if (pf.length > st.maxWindow) st.maxWindow = pf.length;
  if (pf.length > ACTION_LIMIT) st.overInput++;
};
// The keys of a decision, its walks held rather than tapped (survivor_keys.js).
Match.prototype.holdWalks = function (inputs) { return KEYS.holdWalks(inputs); };
Match.prototype.frame = function (truth, arrivals, fresh) {
  var L = this.L;
  var now = truth.clock, d, before = this.arrivals;
  this.now = now;
  this.arrivals = arrivals;
  this.stats.frames++;
  var wall = Date.now();
  if (this.wall && !L.msPerFrame) this.msPerFrame += (Math.min(100, wall - this.wall) - this.msPerFrame) / 60;
  this.wall = wall;
  var T = this.parts = [process.hrtime.bigint()];
  if (this.expect && (d = differ(this.expect, truth))) {
    // Not the board predicted (a key that never reached the game, a row
    // come up): every plan and question made before is void -- but a swap
    // not yet made is walked to again from this board, so a lost key costs
    // a frame, not the decision.
    var again = this.rewalk(truth), asking = !!L.pending;
    if (L.pending) Atomics.store(L.abort, 0, L.pending.id);
    this.epoch++; this.plan = {}; this.nextAt = 0; this.line = null; L.pending = null; this.acted = false;
    this.stats.diverged++;
    if (again) {
      var ains = this.holdWalks(again.inputs);
      for (var i = 0; i < ains.length; i++) this.plan[now + i] = { bits: ains[i], hold: again.holds[i], swap: again.swap };
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
    if (L.pending) Atomics.store(L.abort, 0, L.pending.id);
    this.epoch++; this.plan = {}; this.nextAt = 0; this.line = null; L.pending = null; this.acted = false;
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
    if (L.pending) Atomics.store(L.abort, 0, L.pending.id);
    L.pending = null;
    this.stats.unforeseen++;
  }
  if (L.pending && SH.unforeseen(L.pending.knew, arrivals).some(function (a) { return a.at + off <= L.pending.at; })) { Atomics.store(L.abort, 0, L.pending.id); L.pending = null; this.acted = false; this.stats.reasked++; }
  T.push(process.hrtime.bigint());
  this.take(truth);
  T.push(process.hrtime.bigint());
  var planned = this.plan[now];
  var bits;
  if (planned) { bits = planned.bits; this.hold = { left: planned.hold.left, started: planned.hold.started }; delete this.plan[now]; }
  else { var id = L.hands.idle(truth, this.hold, arrivals); bits = id.bits; this.hold = id.hold; this.stats.idle++; }
  T.push(process.hrtime.bigint());
  this.countActions(bits, now);
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
  var L = this.L;
  var A = this.aparts = [process.hrtime.bigint()];
  this.expectNext();
  A.push(process.hrtime.bigint());
  var now = this.now, next = this.expect;
  if (!next || next.gameOverClock > 0) return;
  if (L.pending && this.nextAt - now === 1 && !L.answers.some(function (a) { return a.id === L.pending.id; })) {
    if (this.line) this.follow(); else this.stats.noLine++;
  }
  if (L.pending) return;
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
  var L = this.L;
  var st = this.line.steps[0], kind, move = null, frames = 0;
  if (st === null) kind = 'hold';
  else if (st === 'raise') kind = 'raise';
  else if (Array.isArray(st)) { kind = 'swap'; move = st; }
  // A wait is not followed: the frames it holds are left to the next question.
  else if (isWait(st)) { this.line = null; return false; }
  else { this.line = null; return false; }
  var pr = this.predict(this.expect, this.nextAt, this.hold, this.nextPending);
  var k = L.hands.keys(pr.board, pr.hold, kind, move, pr.pending, frames);
  if (!k) { this.line = null; return false; }
  if (L.pending) Atomics.store(L.abort, 0, L.pending.id);
  L.pending = null; this.acted = false;
  var ins = this.holdWalks(k.inputs);
  if (!this.fits(this.nextAt, ins)) { this.line = null; this.stats.guarded++; return false; }
  // a step the allowance cannot pay for is not followed: the mind is asked, with the allowance
  if (kind === 'swap' && KEYS.actionsFor(pr.board.curRow, pr.board.curCol, move) > this.allowanceAt(this.nextAt)) { this.line = null; this.stats.unaffordableFollow = (this.stats.unaffordableFollow || 0) + 1; return false; }
  this.stats.heldWalks += ins.held;
  var sw = kind === 'swap' ? swapOf(pr.board, move) : null;
  for (var i = 0; i < ins.length; i++) this.plan[this.nextAt + i] = { bits: ins[i], hold: k.holds[i], swap: sw };
  this.nextAt += k.inputs.length;
  this.line.steps.shift();
  if (!this.line.steps.length) this.line = null;
  this.stats.followed++;
  return true;
};


module.exports = { Match: Match, nativeNow: nativeNow, differ: differ, gridOf: gridOf, NEXT: NEXT };
