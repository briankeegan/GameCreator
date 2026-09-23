// WHY THE LOSER DIED, AND WHETHER IT HAD A WAY OUT.
//
// The duel reports one bit: who died. That says nothing about whether the
// death was forced. This runs the same duel, records every decision the
// dying side made in its last seconds, and asks of each one: was there a
// move on the board that banked stop time, and did the bot take it?
//
// A death where no candidate banked time for the last N decisions is the
// board winning. A death where one was on offer every frame and the bot
// spent its turns elsewhere is the bot losing.
var path = require('path');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PuyoCpu = require('./puyocpu.js');
var modes = require('./modes.js');
var PanelEngine = (typeof window !== 'undefined' ? window : globalThis).PanelEngine;

var LEVEL = Number(process.env.GC_LEVEL || 10);
var CEILING = Number(process.env.GC_VERSUS_CEILING || 21600);

function makeCpu(stack, weights, opts) {
    return new PuyoCpu(stack, {
        weights: weights || {}, reaction: 12,
        depth: opts.depth || 1, beam: opts.beam || 0,
        rise: opts.rise === true, allowRaise: opts.allowRaise === true,
        density: opts.density === true, modes: opts.modes === true,
        engine: opts.engine === true
    });
}

// How tall is the stack, and what is it made of.
function survey(stack) {
    var h = stack.height, w = stack.width;
    var top = 0, panels = 0, garbage = 0;
    for (var r = 1; r <= h; r++) {
        for (var c = 1; c <= w; c++) {
            var p = stack.panels[r] && stack.panels[r][c];
            if (!p || p.color === 0) continue;
            if (r > top) top = r;
            if (p.isGarbage) garbage++; else panels++;
        }
    }
    return { top: top, panels: panels, garbage: garbage };
}

// The board as it stood, one row per line, top row first. '#' is garbage,
// a digit is that panel's colour, '.' is empty. The cursor's two cells are
// marked with '[' and ']' in a second line under the same columns.
function picture(stack) {
    var h = stack.height, w = stack.width, lines = [];
    for (var r = h; r >= 1; r--) {
        var s = '';
        for (var c = 1; c <= w; c++) {
            var p = stack.panels[r] && stack.panels[r][c];
            if (!p || p.color === 0) s += '.';
            else if (p.isGarbage) s += '#';
            else s += String(p.color);
        }
        lines.push(String(r).padStart(2) + ' ' + s + (r === stack.curRow ? '  <- cursor' : ''));
    }
    var mark = '   ';
    for (var c2 = 1; c2 <= w; c2++) mark += (c2 === stack.curCol ? '[' : (c2 === stack.curCol + 1 ? ']' : ' '));
    lines.push(mark);
    return lines.join('\n');
}

function queued(stack) {
    var n = 0, q = stack.incoming || [];
    for (var i = 0; i < q.length; i++) n += (q[i].width || 0) * (q[i].height || 0);
    return n;
}

// Watch one cpu: after every decision, one row of what it saw and what it did.
function watch(cpu, log, frameOf) {
    var origCands = cpu._candidates.bind(cpu);
    cpu._candidates = function () { var c = origCands(); cpu.__all = c; return c; };
    var origDecide = cpu._decide.bind(cpu);
    cpu._decide = function () {
        var picked = origDecide();
        var all = cpu.__all || [];
        var escapes = 0, best = null, breaks = 0, clears = 0;
        for (var i = 0; i < all.length; i++) {
            if (modes.banksTime(all[i].resolved)) escapes++;
            var rv = all[i].resolved;
            if (rv && rv.garbage && rv.garbage.length) breaks++;
            if (rv && rv.clearedPanels) clears++;
        }
        best = modes.bestPayout(all.map(function (c) { return c.resolved; }));
        var tookEscape = false;
        if (cpu._lastTaken && modes.banksTime(cpu._lastTaken.resolved)) tookEscape = true;
        var s = survey(cpu.stack);
        log.push({
            f: frameOf(), mode: cpu._mode || '-', cands: all.length,
            escapes: escapes, breaks: breaks, clears: clears,
            tookEscape: tookEscape, took: picked && picked.kind,
            links: best ? best.links : 0, wide: best ? best.wide : 0,
            top: s.top, panels: s.panels, garbage: s.garbage,
            curRow: cpu.stack.curRow, curCol: cpu.stack.curCol,
            queued: queued(cpu.stack), stop: cpu.stack.stopTime || 0,
            health: cpu.stack.health
        });
        return picked;
    };
    var origTook = cpu._took.bind(cpu);
    cpu._took = function (c) { cpu._lastTaken = c; return origTook(c); };
}

exports.duel = function (weightsA, weightsB, seed, opts) {
    opts = opts || {};
    var level = opts.level || LEVEL;
    var stacks = [
        new PanelEngine.Stack({ level: level, seed: seed, countdown: false }),
        new PanelEngine.Stack({ level: level, seed: seed, countdown: false })
    ];
    var cpus = [makeCpu(stacks[0], weightsA, opts), makeCpu(stacks[1], weightsB, opts)];
    cpus[0].opponent = stacks[1];
    cpus[1].opponent = stacks[0];
    var logs = [[], []];
    var f = 0;
    watch(cpus[0], logs[0], function () { return f; });
    watch(cpus[1], logs[1], function () { return f; });

    var received = [0, 0];
    var ceiling = opts.ceiling || CEILING;
    for (; f < ceiling; f++) {
        cpus[0].update(); cpus[1].update();
        stacks[0].run(); stacks[1].run();
        for (var i = 0; i < 2; i++) {
            var out = stacks[i].takeDeliverableGarbage();
            if (out && out.length) {
                for (var k = 0; k < out.length; k++) received[i ^ 1] += (out[k].width || 0) * (out[k].height || 0);
                stacks[i ^ 1].receiveGarbage(out);
            }
            stacks[i].drainEvents();
        }
        if (stacks[0].gameOver || stacks[1].gameOver) break;
    }
    var dead = stacks[0].gameOver ? 0 : (stacks[1].gameOver ? 1 : null);
    return { dead: dead, frames: f, logs: logs, received: received,
             survey: [survey(stacks[0]), survey(stacks[1])],
             picture: [picture(stacks[0]), picture(stacks[1])],
             cursor: [{ row: stacks[0].curRow, col: stacks[0].curCol },
                      { row: stacks[1].curRow, col: stacks[1].curCol }] };
};
