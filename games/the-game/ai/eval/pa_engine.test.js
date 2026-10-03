#!/usr/bin/env node
// THE SERVER'S ENGINE IN JS IS THE SERVER'S ENGINE.
//
//   node pa_engine.test.js [RECORD.jsonl[.gz] ...]    (default: pa.record.jsonl.gz)
//   node pa_engine.test.js --record PANEL_GAME_DIR SEED FRAMES [...]
//
// A record is lua/engineRecord.lua (run in a panel-game checkout): a real VS match on the
// server's Lua engine, side 1 written out whole after every frame. From a
// frame past the countdown, pa-engine.js takes the Lua state, is dealt the
// rows and garbage colours the Lua dealt and handed the garbage the Lua was
// handed, and plays the same input; after EVERY frame every field of the
// stack and of every panel is compared with the Lua's. The first difference
// fails with the frame, the field and both values.
var fs = require('fs'), path = require('path'), cp = require('child_process');
var PA = require(path.join(__dirname, 'pa-engine.js')), GEN = require(path.join(__dirname, 'pa-generator.js'));

// Each source is a stream of record lines: a file, or panel-game's recorder
// run as a child process (records are too big to keep: ~20KB a frame).
function sources() {
  var a = process.argv.slice(2);
  if (a[0] === '--record') {
    // --record DIR FRAMES SEED[:GARBAGE_EVERY] ...
    var dir = a[1], frames = Number(a[2] || 3000), seeds = a.slice(3);
    if (!seeds.length) seeds = ['1'];
    return seeds.map(function (spec) {
      var seed = spec.split(':')[0], every = spec.split(':')[1] || '150';
      return { name: 'seed ' + spec, open: function () {
        var ch = cp.spawn('luajit', [path.join(__dirname, 'lua', 'engineRecord.lua'), seed, String(frames), '10', every], {
          cwd: dir, stdio: ['ignore', 'pipe', 'inherit'],
          env: Object.assign({}, process.env, {
            LUA_PATH: './?.lua;./common/lib/?.lua;/usr/local/share/lua/5.1/?.lua;;',
            LUA_CPATH: './common/lib/?.so;./common/lib/?/?.so;/usr/local/lib/lua/5.1/?.so;;' }) });
        return ch.stdout;
      } };
    });
  }
  if (!a.length) a = [path.join(__dirname, 'pa.record.jsonl.gz')];
  return a.map(function (f) {
    return { name: path.basename(f), open: function () {
      var st = fs.createReadStream(f);
      return /\.gz$/.test(f) ? st.pipe(require('zlib').createGunzip()) : st;
    } };
  });
}
// side 2 as far as side 1's outgoing garbage goes: it takes whatever is delivered
var SINK = { incoming: [], receiveGarbage: function (g) { seen.delivered += g.length; } };
function luaValue(v) { return v === undefined ? null : v; }
function same(a, b) { return a === b || (typeof a === 'number' && typeof b === 'number' && Object.is(a, b)); }
function compare(s, lua, where) {
  var k, ls = lua.stack;
  for (k in PA.STACK_FROM_LUA) {
    var want = luaValue(ls[k]), got = s[PA.STACK_FROM_LUA[k]];
    if (k === 'cur_wait_time' && want === null) want = 20;
    if (k === 'in_countdown' && want === null) want = false;
    if (k === 'game_over_clock' && want === null) want = -1;
    if (k === 'cursorLock' && want === null && got === null) continue;
    if (!same(got, want)) return where + ': stack.' + k + ' ' + JSON.stringify(got) + ' vs Lua ' + JSON.stringify(want);
  }
  if (s.panels.length !== lua.panels.length) return where + ': rows ' + s.panels.length + ' vs Lua ' + lua.panels.length;
  for (var r = 0; r < s.panels.length; r++) {
    for (var c = 1; c <= 6; c++) {
      var p = s.panels[r][c], lp = lua.panels[r][c - 1];
      for (k in PA.PANEL_FROM_LUA) {
        var w = luaValue(lp[k]), g = p[PA.PANEL_FROM_LUA[k]];
        if (k === 'isGarbage' && w === null) w = false;
        if (!same(g, w)) return where + ': panel ' + r + ',' + c + ' ' + k + ' ' + JSON.stringify(g) + ' vs Lua ' + JSON.stringify(w);
      }
    }
  }
  var inc = PA.list(lua.incoming.staged).map(function (g) {
    return [g.width, g.height, !!g.isChain, !!g.isMetal, g.frameEarned, g.finalized === undefined ? null : g.finalized];
  });
  var mine = s.incoming.map(function (g) { return [g.width, g.height, g.isChain, g.isMetal, g.frameEarned, g.finalized]; });
  if (JSON.stringify(inc) !== JSON.stringify(mine)) return where + ': incoming ' + JSON.stringify(mine) + ' vs Lua ' + JSON.stringify(inc);
  // what this stack's clears send (GarbageQueue): staged, in transit, the chain being built
  function og(g) {
    return [g.width, g.height, !!g.isChain, !!g.isMetal, g.frameEarned, g.finalized === undefined ? null : g.finalized,
            g.finalizedClock === undefined ? null : g.finalizedClock, g.rowEarned === undefined ? null : g.rowEarned,
            g.colEarned === undefined ? null : g.colEarned, g.linkTimes ? PA.list(g.linkTimes) : null];
  }
  var lo = lua.outgoing || {}, q = s.outgoing;
  // in transit: every entry the queue has had (the Lua keeps them), by delivery
  // frame; the pieces too where the record has them (it cuts deep tables short)
  var lt = PA.list(lo.transit), deep = lt.some(function (t) { return PA.list(t.garbage).some(function (g) { return typeof g !== 'object'; }); });
  var at = Object.keys(q.inTransit).map(Number).sort(function (x, y) { return x - y; });
  var wantOut = { staged: PA.list(lo.staged).map(og), transit: lt.map(function (t) { return deep ? t.at : [t.at, PA.list(t.garbage).map(og)]; }),
                  chainAt: lo.currentChainAt || null };
  var gotOut = { staged: q.staged.map(og), transit: at.map(function (t) { return deep ? t : [t, q.inTransit[t].map(og)]; }),
                 chainAt: q.currentChain ? q.staged.indexOf(q.currentChain) + 1 : null };
  if (lo.pending !== undefined) { wantOut.pending = PA.list(lo.pending); gotOut.pending = q.transitTimers.slice(); }
  if (JSON.stringify(wantOut) !== JSON.stringify(gotOut)) return where + ': outgoing ' + JSON.stringify(gotOut) + ' vs Lua ' + JSON.stringify(wantOut);
  if (q.staged.length || q.transitTimers.length) seen.outgoing++;
  var log = PA.list(lua.swapStallingBackLog).map(function (x) { return [x.leftId, x.rightId, x.row, x.col, x.clock]; });
  var mylog = s.swapStallBacklog.map(function (x) { return [x.leftId, x.rightId, x.row, x.col, x.clock]; });
  if (JSON.stringify(log) !== JSON.stringify(mylog)) return where + ': swap-stall log ' + JSON.stringify(mylog) + ' vs Lua ' + JSON.stringify(log);
  if (JSON.stringify(lua.dropColumns) !== JSON.stringify(s.dropColumnIndex)) return where + ': drop columns ' + JSON.stringify(s.dropColumnIndex) + ' vs Lua ' + JSON.stringify(lua.dropColumns);
  var landed = PA.list(lua.garbageLandedThisFrame);
  if (JSON.stringify(landed) !== JSON.stringify(s.garbageLandedThisFrame)) return where + ': landed ' + JSON.stringify(s.garbageLandedThisFrame) + ' vs Lua ' + JSON.stringify(landed);
  return null;
}

function sorted(o) { if (!o || typeof o !== 'object') return o; var r = {}; Object.keys(o).sort().forEach(function (k) { r[k] = sorted(o[k]); }); return r; }
var seen = { outgoing: 0, delivered: 0, fromStart: 0, compared: 0, metalGarbage: 0, shockPanels: 0, frames: 0, matches: 0, chains: 0, garbageDrops: 0, garbageClears: 0, shockRows: 0, metalDrops: 0, rows: 0, stalls: 0, deaths: 0 };
// The match's seed: a record carries it (SEED * 1000 + match); one written
// before it did is found by trying SEED 1..99 against the recorded buffers.
function seedOf(seed, fr, ld, match) {
  var seeds = [], S;
  if (seed !== undefined) seeds.push(seed); else for (S = 1; S < 100; S++) seeds.push(S * 1000 + match);
  for (var i = 0; i < seeds.length; i++) {
    var g = new GEN.GeneratorSource(seeds[i], true, ld.colors, ld.adjacentDenialFrequency);
    if (g.catchUp(fr.state.panelBuffer, fr.state.garbagePanelBuffer)) return seeds[i];
  }
  return null;
}
// The match's generator, fresh or brought to a recorded state; every row and
// garbage row it deals from then on is kept in `dealt`.
function generator(seed, ld, fr) {
  var g = new GEN.GeneratorSource(seed, true, ld.colors, ld.adjacentDenialFrequency);
  if (fr) g.catchUp(fr.state.panelBuffer, fr.state.garbagePanelBuffer);
  g.dealt = [];
  var row = g.nextRowString, garbageRow = g.garbageRowString;
  g.nextRowString = function () { var r = row.call(this); this.dealt.push(r); return r; };
  g.garbageRowString = function () { var r = garbageRow.call(this); this.dealt.push(r); return r; };
  return g;
}
// One match, a line at a time.
function Replay(name) { this.name = name; this.s = null; this.src = null; this.lines = 0; this.done = false; this.level = null; }
Replay.prototype.line = function (fr) {
  if (this.done) return;
  this.lines++;
  if (!this.level) { this.level = { levelData: fr.levelData, behaviours: fr.behaviours, stackOverConditions: fr.stackOverConditions }; this.match = fr.match || 1; this.seed = fr.seed; }
  var d;
  if (!this.s) {
    // A record that writes the state only now and then starts where it does.
    if (!fr.state) return;
    var st = fr.state.stack, ld = this.level.levelData, seed = seedOf(this.seed, fr, ld, this.match);
    if (seed === null) fail(this.name + ': no seed deals the recorded buffers');
    if (st.clock === 1) {
      // From the first frame: the stack Match:start makes from the seed, with
      // rows and garbage colours from the seed, as on the server.
      var lv = PA.vsLevel(10);
      if (JSON.stringify(sorted(lv.levelData)) !== JSON.stringify(sorted(ld))) fail(this.name + ': levelData ' + JSON.stringify(ld) + ' is not modern level 10 ' + JSON.stringify(lv.levelData));
      this.gen = generator(seed, ld, null);
      this.src = new PA.Seeded(this.gen);
      this.s = PA.create(this.level, this.src);
      seen.fromStart++;
      this.start = this.lines - 1;
    } else {
      // Otherwise from the first state past the countdown.
      if (!(st.stopWatchIsRunning && !st.in_countdown && st.clock > 190)) return;
      this.gen = generator(seed, ld, fr);
      this.src = new PA.Seeded(this.gen);
      this.s = PA.fromLua(fr.state, this.level, this.src);
      this.start = this.lines;
      d = compare(this.s, fr.state, this.name + ' start (clock ' + this.s.clock + ')');
      if (d) fail(d);
      return;
    }
  }
  var s = this.s, before = s.clock;
  var rowsBefore = this.gen.dealt.length;
  // the opponent takes what side 1 has ready (GarbageDelivery tickPreSim) before the
  // stacks run and again after: Match:run's loop goes round once more once they have
  PA.deliver(s, SINK);
  PA.list(fr.received).forEach(function (g) { if (g.clock === before) s.receiveGarbage([g]); });
  s.setInput(fr.input !== undefined ? fr.input : fr.state.input);
  s.run();
  PA.deliver(s, SINK);
  PA.list(fr.received).forEach(function (g) { if (g.clock !== before) s.receiveGarbage([g]); });
  var dealt = this.gen.dealt.slice(rowsBefore), want = PA.list(fr.newRows).concat(PA.list(fr.garbageRows));
  if (dealt.join() !== want.join()) fail(this.name + ' line ' + this.lines + ': dealt ' + JSON.stringify(dealt) + ' vs Lua ' + JSON.stringify(want));
  s.events.forEach(function (e) {
    if (e.type === 'match') { seen.matches++; if (e.chain) seen.chains++; if (e.garbage) seen.garbageClears++; }
    if (e.type === 'garbageDrop') seen.garbageDrops++;
    if (e.type === 'newRow') seen.rows++;
  });
  s.events.length = 0;
  PA.list(fr.newRows).forEach(function (r) { if (/[A-Za-z]/.test(r)) seen.shockRows++; });
  for (var r = 1; r < s.panels.length; r++) for (var c = 1; c <= 6; c++) if (s.panels[r][c].color === 8) { seen.shockPanels++; r = 99; break; }
  for (r = 1; r < s.panels.length; r++) for (c = 1; c <= 6; c++) if (s.panels[r][c].metal) { seen.metalGarbage++; r = 99; break; }
  if (s.swapStallBacklog.length) seen.stalls++;
  seen.frames++;
  if (fr.clock !== undefined && fr.clock !== s.clock) fail(this.name + ' line ' + this.lines + ': clock ' + s.clock + ' vs Lua ' + fr.clock);
  if (fr.state) {
    seen.compared++;
    d = compare(s, fr.state, this.name + ' line ' + this.lines + ' (clock ' + before + ' -> ' + s.clock + ')');
    if (d) fail(d);
  }
  if (s.gameOverClock > 0) { seen.deaths++; this.finish(); }
};
Replay.prototype.finish = function () {
  if (this.done) return;
  this.done = true;
  if (this.s) console.log('ok: ' + this.name + ': ' + (this.lines - this.start) + ' frames identical to the Lua');
};
function fail(d) { console.log('DIFFERENT ' + d); process.exit(1); }
var readline = require('readline');
(function next(list) {
  if (!list.length) { report(); return; }
  var src = list[0], cur = null, m = -1, count = 0;
  var rl = readline.createInterface({ input: src.open(), crlfDelay: Infinity });
  rl.on('line', function (l) {
    if (!l) return;
    var x = JSON.parse(l);
    // A match starts where its number changes, or where the level is written out.
    if ((x.match || 1) !== m || x.levelData) { if (cur) cur.finish(); m = x.match || 1; cur = new Replay(src.name + ' match ' + (++count)); }
    cur.line(x);
  });
  rl.on('close', function () { if (cur) cur.finish(); next(list.slice(1)); });
})(sources());
function report() {
  console.log('exercised: ' + JSON.stringify(seen));
}
