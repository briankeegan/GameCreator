// A FIXED CORPUS OF REAL POSITIONS, WITH WHAT THE ENGINE ACTUALLY DID.
//
// live_fidelity measures the resolve against live play, so the sample moves
// every time the resolve changes: the bot plays differently, reaches different
// boards, and the counts stop being comparable run to run. This records the
// positions and the engine's own answer ONCE. verify_resolve_corpus.js then
// replays them against whatever the resolve currently is, deterministically,
// as often as it likes.
//
// Each entry carries everything _resolveCandidate is given: the board, the
// swap, and the stack state it reads for the rise and the queued garbage.
var path = require('path'), DIR = __dirname;
require(path.join(DIR, '..', '..', 'panel-engine.js'));
require(path.join(DIR, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require(path.join(DIR, 'puyocpu.js'));
var SEEDS = require(path.join(DIR, 'seeds.js'));
var fs = require('fs');

// Weights older than the registry carry keys it no longer has; the evaluator
// refuses them outright, and they are nothing to do with what is being
// measured here.
var registry = require(path.join(DIR, 'registry.js'));
var rawWeights = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).weights;
var snapWeights = {}, dropped = [];
Object.keys(rawWeights).forEach(function (k) {
    if (registry.byKey[k]) snapWeights[k] = rawWeights[k]; else dropped.push(k);
});
if (dropped.length) console.log('dropped ' + dropped.length + ' weight(s) the registry no longer has: ' + dropped.join(', '));
var NSEEDS = Number(process.argv[3] || 6);
var OUT = process.argv[4] || path.join(DIR, 'resolve_corpus.json');

function gridOf(b) {
    var g = [];
    for (var r = 0; r <= b.height; r++) g[r] = (b.grid[r] || []).slice();
    return g;
}
function slabsOf(b) {
    var o = {};
    for (var id in b.blocks) if (b.blocks.hasOwnProperty(id)) {
        var c = b.blocks[id].cells || b.blocks[id];
        if (c && c.length) o[id] = c.map(function (rc) { return [rc[0], rc[1]]; });
    }
    return o;
}
function key(grid, slabs) {
    var rows = [];
    for (var r = 1; r < grid.length; r++) rows.push((grid[r] || []).slice(1).join(','));
    var sl = Object.keys(slabs).map(function (k) {
        return slabs[k].map(function (rc) { return rc[0] + ':' + rc[1]; }).sort().join(' ');
    }).sort();
    return rows.join('|') + ' #' + sl.join('/');
}

var corpus = [];
SEEDS.HOLDOUT.slice(0, NSEEDS).forEach(function (seed) {
    var stacks = [new PanelEngine.Stack({ level: 10, seed: seed, countdown: false }),
                  new PanelEngine.Stack({ level: 10, seed: seed, countdown: false })];
    function mk(st) {
        return new PuyoCpu(st, { weights: snapWeights, reaction: 12, depth: 2, beam: 0,
                                 rise: true, density: false, modes: true, engine: true });
    }
    var cpus = [mk(stacks[0]), mk(stacks[1])];
    cpus[0].opponent = stacks[1]; cpus[1].opponent = stacks[0];
    var open = null;
    var origQueue = PanelEngine.Stack.prototype.tryQueueSwap;
    // ONE KIND PER PASS. A swap window stays open until the board has been
    // still for eight frames, which is most of the time the board is moving —
    // so an air window competing with it never opens. GC_CORPUS_MODE=air turns
    // the swap capture off and takes mid-flight positions instead.
    var MODE = process.env.GC_CORPUS_MODE || 'swap';
    stacks[0].tryQueueSwap = function (row, col) {
        if (MODE === 'air') { if (air) air.dirty = true; return origQueue.call(this, row, col); }
        if (!open && this.canSwap(row, col)) {
            var b = cpus[0]._snapshot();
            open = {
                seed: seed, swap: [row, col],
                board: { grid: gridOf(b), blocks: slabsOf(b), chaining: b.chaining,
                         motion: b.motion, incoming: b.incoming,
                         width: b.width, height: b.height },
                stack: { riseTimer: this.riseTimer, displacement: this.displacement,
                         speed: this.speed, stopTime: this.stopTime,
                         preStopTime: this.preStopTime,
                         incoming: (this.incoming || []).map(function (g) {
                             return { width: g.width, height: g.height, isChain: g.isChain }; }) },
                since: 0, stable: 0, dirty: false, links: 0
            };
        }
        else if (open) open.dirty = true;
        if (air) air.dirty = true;
        return origQueue.call(this, row, col);
    };
    function settled(s) { return !s.hasActivePanels() && !s.hasChainingPanels(); }

    // AND POSITIONS WITH PANELS STILL IN THE AIR.
    //
    // Every entry above is captured at the instant of a swap, when the board
    // is quiet — a swap made mid-cascade opens no window because one is
    // already open. So nothing in the corpus exercised the part of paint()
    // that places falling and hovering panels, which is most of what the
    // resolve is handed in real play. These take no swap at all: snapshot a
    // board mid-flight, ask the resolve what it settles to, and let the engine
    // answer the same question.
    var air = null, airCooldown = 0;
    function tryOpenAir(stack, cpu) {
        if (MODE !== 'air') return;
        if (air || airCooldown > 0) return;
        if (settled(stack)) return;
        var inFlight = 0;
        for (var r = 1; r <= stack.height; r++) {
            for (var c = 1; c <= 6; c++) {
                var p = stack.panelAt(r, c);
                if (p && !p.isGarbage && p.color &&
                    (p.state === 'hovering' || p.state === 'falling')) inFlight++;
            }
        }
        if (!inFlight) return;
        var b = cpu._snapshot();
        air = { seed: seed, swap: null, inFlight: inFlight,
                board: { grid: gridOf(b), blocks: slabsOf(b), chaining: b.chaining,
                         motion: b.motion, incoming: b.incoming,
                         width: b.width, height: b.height },
                stack: { riseTimer: stack.riseTimer, displacement: stack.displacement,
                         speed: stack.speed, stopTime: stack.stopTime,
                         preStopTime: stack.preStopTime,
                         incoming: (stack.incoming || []).map(function (g) {
                             return { width: g.width, height: g.height, isChain: g.isChain }; }) },
                since: 0, stable: 0, dirty: false, links: 0 };
    }
    for (var f = 0; f < 21600; f++) {
        cpus[0].update(); cpus[1].update();
        stacks[0].run(); stacks[1].run();
        for (var i = 0; i < 2; i++) {
            var out = stacks[i].takeDeliverableGarbage();
            if (out && out.length) { if (i === 1 && open) open.dirty = true; stacks[i ^ 1].receiveGarbage(out); }
        }
        var evs = stacks[0].drainEvents();
        stacks[1].drainEvents();
        tryOpenAir(stacks[0], cpus[0]);
        if (air) {
            for (var aq = 0; aq < evs.length; aq++) {
                var at = evs[aq].type;
                if (at === 'chainEnd') air.links = evs[aq].length;
                else if (at === 'match' && !evs[aq].chain && !air.links) air.links = 1;
                if (at === 'garbageDrop') air.dirty = true;
            }
            air.since++;
            air.stable = settled(stacks[0]) ? air.stable + 1 : 0;
            if (air.since > 2 && air.stable >= 8) {
                if (!air.dirty) {
                    var afterAir = cpus[0]._snapshot();
                    air.truth = { key: key(gridOf(afterAir), slabsOf(afterAir)), links: air.links };
                    delete air.since; delete air.stable; delete air.dirty;
                    corpus.push(air);
                }
                air = null; airCooldown = 120;
            }
        }
        if (airCooldown > 0) airCooldown--;
        if (open) {
            for (var q = 0; q < evs.length; q++) {
                var t = evs[q].type;
                if (t === 'chainEnd') open.links = evs[q].length;
                else if (t === 'match' && !evs[q].chain && !open.links) open.links = 1;
                if (t === 'garbageDrop') open.dirty = true;   // the opponent acting: unknowable
            }
            open.since++;
            open.stable = settled(stacks[0]) ? open.stable + 1 : 0;
            if (open.since > 2 && open.stable >= 8) {
                if (!open.dirty) {
                    var after = cpus[0]._snapshot();
                    open.truth = { key: key(gridOf(after), slabsOf(after)), links: open.links };
                    delete open.since; delete open.stable; delete open.dirty;
                    corpus.push(open);
                }
                open = null;
            }
        }
        if (stacks[0].gameOver || stacks[1].gameOver) break;
    }
});
fs.writeFileSync(OUT, JSON.stringify(corpus));
console.log('captured ' + corpus.length + ' positions from ' + NSEEDS + ' seeds -> ' + path.basename(OUT));
