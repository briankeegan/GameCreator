#!/usr/bin/env node
// THE SERVER'S ENGINE IN C IS THE SERVER'S ENGINE.
//
//   node native_pa.test.js [RECORD.jsonl[.gz]] [FRAMES] [SEED]   (default: pa.record.jsonl.gz)
//   node native_pa.test.js --record PANEL_GAME_DIR [FRAMES] [SEED]
//
// native/pa.c against pa-engine.js (which pa_engine.test.js holds to the
// server's Lua): boards taken from a recording of the Lua engine, played side
// by side on the same input -- cursor moves held and tapped, raises, swaps
// pressed -- with garbage of every kind handed over and copies taken now and
// then, and after EVERY frame every field of the stack and of every panel
// compared. The first difference fails with the frame, the field and both
// values.
var fs = require('fs'), path = require('path'), cp = require('child_process'), assert = require('assert');
var DIR = __dirname;
var PA = require(path.join(DIR, 'pa-engine.js')), N = require(path.join(DIR, 'native.js')).server.init(), X = N.exports();
var a = process.argv.slice(2), recordDir = null, file = path.join(DIR, 'pa.record.jsonl.gz');
if (a[0] === '--record') { recordDir = a[1]; a = a.slice(2); } else if (a[0] && !/^\d+$/.test(a[0])) { file = a[0]; a = a.slice(1); }
var FRAMES = Number(a[0] || 20000), SEED = Number(a[1] || 1);
var state = SEED * 2654435761 % 4294967296;
function rand(n) { state = (state * 1103515245 + 12345) % 2147483648; return Math.floor(state / 65536) % n; }

// ---- boards from the Lua
function linesOf() {
  if (!recordDir) {
    var buf = fs.readFileSync(file);
    return (/\.gz$/.test(file) ? require('zlib').gunzipSync(buf) : buf).toString('utf8').trim().split('\n');
  }
  return cp.execFileSync('luajit', [path.join(__dirname, 'lua', 'engineRecord.lua'), String(SEED), String(Math.max(3000, FRAMES / 4)), '10', '150'], {
    cwd: recordDir, maxBuffer: 1 << 31 - 1, encoding: 'utf8',
    env: Object.assign({}, process.env, { LUA_PATH: './?.lua;./common/lib/?.lua;/usr/local/share/lua/5.1/?.lua;;',
                                           LUA_CPATH: './common/lib/?.so;./common/lib/?/?.so;/usr/local/lib/lua/5.1/?.so;;' }) }).trim().split('\n');
}
var boards = [], level = null, n = 0;
linesOf().forEach(function (l) {
  var x = JSON.parse(l);
  if (x.levelData) level = { levelData: x.levelData, behaviours: x.behaviours, stackOverConditions: x.stackOverConditions };
  if (!x.state) return;
  var st = x.state.stack;
  if (x.levelData) level = { levelData: x.levelData, behaviours: x.behaviours, stackOverConditions: x.stackOverConditions };
  if (!(st.stopWatchIsRunning && !st.in_countdown && st.clock > 190)) return;
  if (n++ % 7 === 3) boards.push(PA.fromLua(x.state, level, new PA.Unseen()));
});
if (!boards.length) throw new Error('no boards past the countdown in the record');
console.log('boards: ' + boards.length + ' from the Lua');

// ---- the comparison
var SKIP = { events: 1, source: 1, input: 1, prevInput: 1, inputBits: 1, levelData: 1, frames: 1, behaviours: 1, panels: 1,
             incoming: 1, swapStallBacklog: 1, garbageLandedThisFrame: 1, dropColumnIndex: 1 };
var PANEL_KEYS = ['row', 'col', 'id', 'color', 'chaining', 'matching', 'timer', 'initialTime', 'popTime', 'popIndex', 'xOffset', 'yOffset',
                  'gWidth', 'gHeight', 'shakeTime', 'isGarbage', 'state', 'comboIndex', 'comboSize', 'swapFromLeft', 'dontSwap',
                  'queuedHover', 'fellFromGarbage', 'stateChanged', 'propagatesChaining', 'matchAnyway', 'propagatesFalling',
                  'garbageId', 'metal'];
function norm(v) { return v === undefined ? null : v; }
function diff(js, c) {
  var k;
  var keys = {};
  for (k in js) if (Object.prototype.hasOwnProperty.call(js, k) && !SKIP[k]) keys[k] = 1;
  for (k in c) if (Object.prototype.hasOwnProperty.call(c, k) && !SKIP[k]) keys[k] = 1;
  for (k in keys) {
    var u = norm(js[k]), v = norm(c[k]);
    if (k === 'unseenRows' || k === 'unseenBreaks') { u = u || 0; v = v || 0; }
    if (!Object.is(u, v)) return 'stack.' + k + ': ' + JSON.stringify(u) + ' vs C ' + JSON.stringify(v);
  }
  if (js.panels.length !== c.panels.length) return 'rows ' + js.panels.length + ' vs C ' + c.panels.length;
  for (var r = 0; r < js.panels.length; r++) for (var col = 1; col <= 6; col++) {
    var p = js.panels[r][col], q = c.panels[r][col];
    for (var i = 0; i < PANEL_KEYS.length; i++) {
      k = PANEL_KEYS[i];
      if (!Object.is(norm(p[k]), norm(q[k]))) return 'panel ' + r + ',' + col + ' ' + k + ': ' + JSON.stringify(p[k]) + ' vs C ' + JSON.stringify(q[k]);
    }
  }
  var lists = ['incoming', 'swapStallBacklog', 'garbageLandedThisFrame', 'dropColumnIndex'];
  for (i = 0; i < lists.length; i++) {
    if (JSON.stringify(js[lists[i]]) !== JSON.stringify(c[lists[i]])) return lists[i] + ': ' + JSON.stringify(js[lists[i]]) + ' vs C ' + JSON.stringify(c[lists[i]]);
  }
  return null;
}
function check(js, h, where) {
  var d = diff(js, N.toStack(h, js));
  if (d) { console.log('DIFFERENT ' + where + ': ' + d); process.exit(1); }
}

// ---- side by side
var BIT = { right: 1, left: 2, down: 4, up: 8, swap: 16, raise: 32 };
var frames = 0, runs = 0, deaths = 0, presses = 0, denied = 0, garbage = 0, metal = 0, copies = 0, rowsRisen = 0, matches = 0;
while (frames < FRAMES) {
  var b = boards[runs++ % boards.length];
  var js = b.copy(), h = N.fromStack(js), dir = null, held = 0, raise = 0;
  check(js, h, 'round trip of board ' + (runs - 1));
  var len = 200 + rand(600);
  for (var f = 0; f < len && frames < FRAMES; f++, frames++) {
    if (held-- <= 0) { dir = [null, null, 'up', 'down', 'left', 'right'][rand(6)]; held = rand(3) ? rand(4) : 12 + rand(10); }
    if (raise > 0) raise--; else if (rand(90) === 0) raise = 1 + rand(30);
    var bits = (dir ? BIT[dir] : 0) | (raise > 0 ? BIT.raise : 0) | (rand(12) === 0 ? BIT.swap : 0);
    js.setInput(bits); X.nb_set_input(h, bits);
    if (rand(5) === 0) {
      var r1 = js.tryQueueSwap(js.curRow, js.curCol), r2 = X.nb_try_queue_swap(h, js.curRow, js.curCol) === 1;
      assert.strictEqual(r2, r1, 'tryQueueSwap at frame ' + frames);
      presses++;
    }
    if (rand(100) === 0) {
      var k = rand(4), g;
      if (k === 0) g = { width: 6, height: 1 + rand(6), isChain: true, isMetal: false, finalized: true };
      else if (k === 1) { g = { width: 6, height: 1, isChain: false, isMetal: true, finalized: null }; metal++; }
      else g = { width: 3 + rand(4), height: 1, isChain: false, isMetal: false, finalized: null };
      g.frameEarned = js.stopWatch - rand(30);
      js.receiveGarbage([g]);
      X.nb_receive(h, g.width, g.height, g.isChain ? 1 : 0, g.isMetal ? 1 : 0, g.frameEarned, g.finalized === null ? -2147483648 : g.finalized ? 1 : 0);
      garbage++;
    }
    js.run();
    var err = X.nb_run(h);
    if (err) { console.log('C engine error ' + err + ' at frame ' + frames); process.exit(1); }
    js.events.forEach(function (e) { if (e.type === 'newRow') rowsRisen++; if (e.type === 'match') matches++; });
    js.events.length = 0;
    if (js.swapDeniedThisFrame) denied++;
    check(js, h, 'frame ' + f + ' of run ' + runs + ' (input ' + bits + ')');
    if (js.gameOverClock > 0) { deaths++; break; }
    if (rand(60) === 0) {
      var h2 = X.nb_new(); X.nb_clone(h2, h); X.nb_free(h); h = h2;
      js = js.copy();
      check(js, h, 'copy at frame ' + f);
      copies++;
    }
  }
  X.nb_free(h);
}
console.log('ok: ' + frames + ' frames identical over ' + runs + ' runs (' + deaths + ' deaths, ' + matches + ' matches, ' + rowsRisen +
            ' rows, ' + presses + ' swaps pressed, ' + denied + ' refused, ' + garbage + ' garbage (' + metal + ' shock), ' + copies + ' copies)');
