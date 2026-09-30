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

var fs = require('fs');
var args = process.argv.slice(2), ROOT = null, JOBS = 0, want = [], ONE = null;
for (var i = 0; i < args.length; i++) {
    if (args[i] === '--root') ROOT = args[++i];
    else if (args[i] === '--jobs') JOBS = Number(args[++i]);
    else if (args[i] === '--one') ONE = args[++i];
    else want.push(args[i]);
}
ROOT = ROOT || path.join(__dirname, '..', '..');
// THE ROOT IS CHECKED HERE, ONCE. A wrong one makes every child die on a
// require, and a tally built from children that never ran reads as a clean
// sweep. Fail before fanning out, not fourteen times in the output.
['panel-engine.js', 'panel-cpu.js', path.join('ai', 'eval', 'bitbot.js')]
    .forEach(function (f) {
        if (!fs.existsSync(path.join(ROOT, f))) {
            console.error('roundrobin: --root ' + ROOT + ' has no ' + f +
                          '. Point it at the GAME directory (games/the-game).');
            process.exit(2);
        }
    });
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
    // THE BOARD A DEATH HAPPENED ON, KEPT AS IT GOES. Re-running a whole duel
    // afterwards to look at the board costs minutes and the run already had it.
    var bit = require(path.join(ROOT, 'ai', 'eval', 'bitmatch.js'));
    var opts = require(path.join(ROOT, 'ai', 'eval', 'bitoptions.js'));
    function popc(n) { var k = 0; while (n) { n &= n - 1; k++; } return k; }
    var ring = [[], []];
    var broke = [0, 0], lastGar = [null, null];
    [0, 1].forEach(function (side) {
        var real = bots[side].decide.bind(bots[side]);
        bots[side].decide = function () {
            var d = real();
            var b = bots[side]._snapshot();
            var m = bit.maskState(b.grid, b.blocks, 6, b.height);
            var sh = opts.shapeOf(m), h = [], gar = 0, tall = 0, c;
            for (c = 1; c <= 6; c++) {
                var g = m.garb[c] >>> 0, fl = g ? (g & -g) : 0, bel = fl ? (fl - 1) : 0xffffffff;
                h.push(popc((m.occ[c] & ~g & bel) >>> 0));
                gar += popc(g);
                var t = 32 - Math.clz32(m.occ[c] >>> 0); if (t > tall) tall = t;
            }
            // AND THE MOVE ITSELF, plus whether the return guard could have seen
            // it. A trace of board shapes shows a bot stuck flipping one pair back
            // and forth but not WHY the guard let it: `seen` is where the landing
            // sits in the bot's own history, and `cands` is how much choice it had.
            var mv = d && d.move ? (d.move[0] + '-' + d.move[1]) : (d ? d.kind : '?');
            var seenAt = '-';
            if (d && d.kind === 'swap' && d.move && bots[side]._lastPool) {
                var pl = bots[side]._lastPool;
                for (var pi = 0; pi < pl.length; pi++) {
                    var pc = pl[pi];
                    if (pc.swap && pc.swap[0] === d.move[0] && pc.swap[1] === d.move[1] && pc.masks) {
                        var sg = Bot.signatureOf(pc.masks);
                        var ix = bots[side]._seen.indexOf(sg);
                        seenAt = (ix < 0 ? 'new' : String(ix)) + '/' + bots[side]._seen.length;
                        break;
                    }
                }
            }
            // AND WHAT WAS ON THE TABLE, not only what was played. A board that
            // dies with a chain sitting on it is a different failure from a board
            // with nothing to fire, and the trace could not tell them apart.
            var clr = 0, chainBest = 0, sws = bit.legalSwapsOf(m);
            for (var si = 0; si < sws.length; si++) {
                if (!bit.swapMasks(m, sws[si][0], sws[si][1])) continue;
                var rz = bit.resolveFromMasks(m, true);
                bit.swapMasks(m, sws[si][0], sws[si][1]);
                if (rz.total > 0 || rz.scope === 'garbage-broke') {
                    clr++;
                    if ((rz.chain || 0) > chainBest) chainBest = rz.chain;
                }
            }
            // GARBAGE CELLS TAKEN OFF THE BOARD -- THE END GOAL.
            //
            // Combos, chains and flattening are means; a broken slab is the only
            // thing that removes garbage permanently, and a run that reports deaths
            // and frames says nothing about whether the bot is doing the job. The
            // count falls only when a break lands, so summing the falls is the cells
            // broken. It rises when garbage ARRIVES, which is not progress and is
            // not counted.
            if (lastGar[side] !== null && gar < lastGar[side]) broke[side] += lastGar[side] - gar;
            lastGar[side] = gar;
            ring[side].push({ clr: clr, ch: chainBest,
                              f: st[side].clock, via: d && d.via, alive: d && d.alive,
                              mode: d && d.mode && d.mode.name, cols: h.join(','),
                              sp: sh ? sh.spread : 0, gar: gar, tall: tall,
                              mv: mv, seen: seenAt,
                              cands: bots[side]._lastPool ? bots[side]._lastPool.length : 0 });
            if (ring[side].length > 14) ring[side].shift();
            return d;
        };
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
                '  [sent ' + sent[0] + '/' + sent[1] + ']  frames ' + f +
                '  broke ' + broke[0] + '/' + broke[1]);
    var D = st[0].gameOver ? 0 : (st[1].gameOver ? 1 : -1);
    if (D >= 0) {
        console.log('  --- ' + [A, Bn][D] + ' died. last decisions:');
        console.log('   frame alive mode    via           tall gar spread cols          move  seen cands');
        ring[D].forEach(function (r) {
            console.log('  ' + String(r.f).padStart(6) + String(r.alive).padStart(5) + '  ' +
                        String(r.mode).padEnd(7) + ' ' + String(r.via).padEnd(13) +
                        String(r.tall).padStart(4) + String(r.gar).padStart(4) +
                        String(r.sp).padStart(6) + '  ' + String(r.cols).padEnd(12) +
                        ' ' + String(r.mv).padStart(6) + String(r.seen).padStart(5) +
                        String(r.cands).padStart(6) +
                        String(r.clr).padStart(7) + String(r.ch).padStart(6));
        });
        for (var rr = st[D].height; rr >= 1; rr--) {
            var line = '  r' + String(rr).padStart(2) + ' ';
            for (var cc = 1; cc <= 6; cc++) {
                var pp = st[D].panels[rr][cc];
                line += pp.color === 0 ? ' . ' : (pp.isGarbage ? '[#]' : ' ' + pp.color + ' ');
            }
            console.log(line);
        }
    }
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
var next = 0, live = 0, done = 0, deaths = 0, hard = 0, broken = 0, lines = [];
var frames = 0, pairings = 0, brokeAll = 0;
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
    ch.on('close', function (code) {
        live--; done++;
        var line = buf.trim();
        // A CHILD THAT DID NOT RUN IS NOT A CHILD THAT SURVIVED. A non-zero exit
        // or stdout with no result line in it means this pairing was never
        // played, and counting it as zero deaths turns a broken harness into a
        // clean sweep. Counted apart and the tally refuses to stand on it.
        if (code !== 0 || !/^seed \d+/m.test(line)) {
            broken++;
            console.log('  [' + done + '/' + jobs.length + '] ' + job +
                        ' DID NOT RUN (exit ' + code + ')');
        } else {
            lines.push(line);
            var n = (line.match(/DEAD@/g) || []).length;
            deaths += n;
            if (n && /(STARTER|ZERO)\s+DEAD@/.test(line)) hard += n;
            // HOW LONG IT LASTED, NOT ONLY WHETHER IT DIED.
            //
            // Deaths are a two-gradation ruler on fourteen boards: a change that
            // takes a board from 30,000 frames to 2,424 and saves a different one
            // reads as no change at all. The frames are already in the line and
            // they move continuously, so a run says which direction a change went
            // even when the count does not.
            var fm = line.match(/frames (\d+)/);
            if (fm) { frames += Number(fm[1]); pairings++; }
            var bm = line.match(/broke (\d+)\/(\d+)/);
            if (bm) { brokeAll += Number(bm[1]) + Number(bm[2]); }
            console.log('  [' + done + '/' + jobs.length + '] ' + line);
        }
        if (done === jobs.length) {
            var played = jobs.length - broken;
            if (broken) {
                console.log('\nNO RESULT: ' + broken + ' of ' + jobs.length +
                            ' pairings did not run. Nothing is measured.');
                process.exit(2);
            }
            console.log('\n' + deaths + ' deaths / ' + (played * 2) + ' boards' +
                        '   STARTER or ZERO: ' + hard);
            console.log('frames ' + frames + ' of ' + (pairings * 30000) +
                        '   mean ' + Math.round(frames / Math.max(1, pairings)) +
                        '   (' + Math.round(100 * frames / Math.max(1, pairings * 30000)) + '%)');
            console.log('garbage broken ' + brokeAll + ' cells   mean ' +
                        Math.round(brokeAll / Math.max(1, pairings * 2)) + ' a board' +
                        '   (the end goal; combos and flattening are means to it)');
            process.exit(hard ? 1 : 0);
        }
        pump();
    });
}
pump();
