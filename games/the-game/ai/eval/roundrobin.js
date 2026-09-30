#!/usr/bin/env node
// THE ROUND ROBIN AS A COMMAND, ONE PROCESS PER PAIRING.
//
//   node roundrobin.js                          the full round robin, both seeds
//   node roundrobin.js 103:STARTER:rand1 ...     only the pairings named
//   node roundrobin.js --root /path/to/the-game  measure a pinned worktree
//   node roundrobin.js --jobs 2                  fewer processes than cores
//
// ONE PROCESS PER PAIRING, up to the core count. Hand-sharding a run into two
// or three processes leaves cores idle and stalls on whichever shard drew the
// long duels -- a pairing that dies at 2,000 frames takes seconds and one that
// survives all 30,000 takes minutes, so fixed shards are always unbalanced.
//
// Results print as they land, one line each, then a tally. A pinned worktree is
// the only honest thing to measure: never a tree being edited.
var path = require('path');
var cp = require('child_process');
var os = require('os');

var args = process.argv.slice(2), ROOT = null, JOBS = 0, want = [], ONE = null;
for (var i = 0; i < args.length; i++) {
    if (args[i] === '--root') ROOT = args[++i];
    else if (args[i] === '--jobs') JOBS = Number(args[++i]);
    else if (args[i] === '--one') ONE = args[++i];
    else want.push(args[i]);
}
ROOT = ROOT || path.join(__dirname, '..', '..');
JOBS = JOBS || os.cpus().length;

function vectors(BF) {
    var KEYS = BF.keys();
    function vec(s) {
        var w = {}, x = s;
        for (var k = 0; k < KEYS.length; k++) {
            x = (x * 1103515245 + 12345) & 0x7fffffff;
            w[KEYS[k]] = Math.round(((x / 0x7fffffff) * 2 - 1) * 100);
        }
        return w;
    }
    var V = { STARTER: null, ZERO: {} };
    for (var n = 1; n <= 4; n++) V['rand' + n] = vec(n * 7919);
    return V;
}
var NAMES = ['STARTER', 'ZERO', 'rand1', 'rand2', 'rand3', 'rand4'];

// ---- child: run exactly one pairing and print one line
if (ONE) {
    var parts = ONE.split(':'), seed = Number(parts[0]), A = parts[1], Bn = parts[2];
    require(path.join(ROOT, 'panel-engine.js'));
    require(path.join(ROOT, 'panel-cpu.js'));
    var Bot = require(path.join(ROOT, 'ai', 'eval', 'bitbot.js'));
    var BF = require(path.join(ROOT, 'ai', 'eval', 'bitfeatures.js'));
    var P = globalThis.PanelEngine, V = vectors(BF);
    var st = [new P.Stack({ level: 10, seed: seed, countdown: false }),
              new P.Stack({ level: 10, seed: seed, countdown: false })];
    var bots = [A, Bn].map(function (nm, side) {
        var o = { allowRaise: true };
        if (V[nm]) o.weights = V[nm];
        return new Bot(st[side], o);
    });
    var sent = [0, 0], f;
    for (f = 0; f < 30000 && !st[0].gameOver && !st[1].gameOver; f++) {
        bots[0].update(); bots[1].update(); st[0].run(); st[1].run();
        for (var s2 = 0; s2 < 2; s2++) {
            var g = st[s2].takeDeliverableGarbage();
            if (g && g.length) {
                g.forEach(function (b) { sent[s2] += b.width * b.height; });
                st[s2 ^ 1].receiveGarbage(g);
            }
        }
        st[0].drainEvents(); st[1].drainEvents();
    }
    function died(k) { return st[k].gameOver ? 'DEAD@' + st[k].clock : 'alive'; }
    console.log('seed ' + seed + '  ' + A.padEnd(8) + died(0).padEnd(11) +
                ' vs ' + Bn.padEnd(8) + died(1).padEnd(11) +
                '  [sent ' + sent[0] + '/' + sent[1] + ']  frames ' + f);
    process.exit(0);
}

// ---- parent: build the list, fan out one child per pairing
var jobs = want.slice();
if (!jobs.length) {
    [101, 103].forEach(function (sd) {
        for (var a = 0; a < NAMES.length; a++)
            for (var b = a + 1; b < NAMES.length; b++)
                jobs.push(sd + ':' + NAMES[a] + ':' + NAMES[b]);
    });
}
console.log(jobs.length + ' pairings, ' + Math.min(JOBS, jobs.length) + ' at a time, root ' + ROOT);
var next = 0, live = 0, done = 0, deaths = 0, hard = 0, lines = [];
function pump() {
    while (live < JOBS && next < jobs.length) {
        // ONE CLOSURE PER CHILD. `var` is function-scoped, so a buffer declared
        // in this loop is ONE buffer shared by every child started in the same
        // pass -- four children appending to it and each printing the lot.
        spawnOne(jobs[next++]);
    }
}
function spawnOne(job) {
    live++;
    var ch = cp.spawn(process.execPath,
        [__filename, '--root', ROOT, '--one', job], { stdio: ['ignore', 'pipe', 'inherit'] });
    var buf = '';
    ch.stdout.on('data', function (d) { buf += d; });
    ch.on('close', function () {
        live--; done++;
        var line = buf.trim();
        if (line) {
            lines.push(line);
            var n = (line.match(/DEAD@/g) || []).length;
            deaths += n;
            if (n && /(STARTER|ZERO)\s+DEAD@/.test(line)) hard += n;
            console.log('  [' + done + '/' + jobs.length + '] ' + line);
        }
        if (done === jobs.length) {
            console.log('\n' + deaths + ' deaths / ' + (jobs.length * 2) + ' boards' +
                        '   STARTER or ZERO: ' + hard);
            process.exit(hard ? 1 : 0);
        }
        pump();
    });
}
pump();
