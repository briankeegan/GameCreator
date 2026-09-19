#!/usr/bin/env node
// THE CROSS-LANGUAGE DECISION FIXTURE — what the Lua brain has to PLAY.
//
//   node export_decisions.js [outfile]
//   default: ../../../../panel-game/bot/fixtures/decision_reference.json
//
// paneleval_reference.json checks that the Lua port computes the same feature
// VALUES as the JavaScript. That is necessary and it is not enough: two
// evaluators can agree on every feature and still choose different moves,
// because choosing is a search — hold is candidate zero, ties leave the
// incumbent standing, the beam must never drop hold, and at depth 2 a
// candidate is worth the best of stopping there or any single reply. Every
// one of those is a place the two implementations can drift apart silently.
//
// So this records the MOVE, on real boards from real games at level 10, with
// the weight set the bot actually ships. bot/tests/decisionVerify.lua replays
// each one and fails if Lua picks differently.
var path = require('path'), fs = require('fs');
require(path.join(__dirname, '..', '..', 'panel-engine.js'));
require(path.join(__dirname, '..', '..', 'panel-cpu.js'));
var PanelEngine = globalThis.PanelEngine;
var PuyoCpu = require('./puyocpu.js');

// Same relative hop as export_reference.js uses: up out of GameCreator, then
// across into the panel-game checkout beside it.
var PG = path.join(__dirname, '..', '..', '..', '..', '..', 'panel-game');
var OUT = process.argv[2] || path.join(PG, 'bot', 'fixtures', 'decision_reference.json');
var PROFILE = process.env.GC_PROFILE || path.join(PG, 'bot', 'profiles', 'plamp.json');

var prof = JSON.parse(fs.readFileSync(PROFILE, 'utf8'));
var W = prof.weights;
var DEPTH = prof.depth || 1, BEAM = prof.beam || 0;
// RISE IS A SWITCH OF THE BOT, NOT OF THE EXPORT. It comes off the profile
// like depth and beam, and the fixture records it, so decisionVerify runs the
// Lua brain under the same one. GC_RISE=0/1 overrides it for a run that wants
// the other half of the pair.
var RISE = process.env.GC_RISE !== undefined ? process.env.GC_RISE === '1' : !!prof.rise;

// The board as the Lua side reads it: row 1 is the floor, W chars per row,
// a digit is a colour, '#' is garbage, '.' is empty. Anything mid-animation
// is NOT settled and the Lua touchable grid refuses it, so a board with one
// in it is skipped rather than recorded as a disagreement waiting to happen.
function boardString(board) {
    var s = '', r, c, busy = false;
    for (r = 1; r <= board.height; r++) {
        for (c = 1; c <= board.width; c++) {
            var v = board.grid[r][c];
            if (v === -1) busy = true;
            s += v === 0 ? '.' : v === -2 ? '#' : v === -1 ? '?' : String(v);
        }
    }
    return busy ? null : s;
}

var LIMIT = Number(process.env.GC_DECISIONS || 200);
var SEEDS = (process.env.GC_SEEDS || '1,2,3,4').split(',').map(Number);
var rows = [];

SEEDS.forEach(function (seed) {
    if (rows.length >= LIMIT) return;
    var stack = new PanelEngine.Stack({ level: 10, seed: seed, countdown: false });
    var cpu = new PuyoCpu(stack, {
        weights: W, depth: DEPTH, beam: BEAM,
        rise: RISE, density: !!prof.density, level: 10, reaction: 12
    });
    // WHERE THE TWO MODELS STOP SEEING THE SAME BOARD. LogicalBoard cuts the
    // cascade off at the first garbage break, because the colours that row
    // turns into come off an RNG this side is not allowed to read. BoardSim
    // is handed those colours by the engine it runs inside, so it keeps
    // settling. Neither is wrong; they know different things, and a decision
    // reached through one of those breaks cannot be required to match.
    var truncated = false;
    var resolveCandidate = cpu._resolveCandidate.bind(cpu);
    cpu._resolveCandidate = function (b) {
        var out = resolveCandidate(b);
        if (out && out.truncated) truncated = true;
        return out;
    };
    for (var f = 0; f < 4000 && rows.length < LIMIT; f++) {
        if (f > 120 && f % 120 === 0) {
            stack.receiveGarbage([{ width: 6, height: 3, isChain: false }]);
        }
        if (!cpu._walk && cpu.cooldown === 0 && !stack.gameOver) {
            var board = cpu._snapshot();
            var str = boardString(board);
            if (str) {
                truncated = false;
                var played = cpu._decide();
                rows.push({
                    at: seed + '/' + f,
                    grid: str,
                    rows: board.height,
                    // THE CURSOR IS PART OF THE POSITION — it prices every
                    // candidate's travel, and travel decides how many rows
                    // land while the bot walks there.
                    cursor: [stack.curRow, stack.curCol],
                    // The dimmed row under the stack. rise() needs its
                    // colours to say what the board looks like a moment on;
                    // -1 is a cell whose colour is not decided yet.
                    nextRow: board.incoming.slice(1, 7),
                    // THE RISE CLOCK, in the two numbers that decide it and
                    // nothing about either engine's tables: frames until the
                    // next pixel of rise, and frames per pixel after that.
                    // displacement is pixels still owed to the next row.
                    clock: {
                        riseTimer: stack.riseTimer,
                        pixelFrames: PanelEngine.riseTime(stack.speed),
                        displacement: stack.displacement,
                        stopTime: stack.stopTime || 0
                    },
                    truncated: truncated,
                    kind: played.kind,
                    move: played.kind === 'swap' ? played.move : null
                });
            }
        }
        cpu.update(); stack.run(); stack.drainEvents();
        if (stack.gameOver) break;
    }
});

if (!rows.length) { console.error('no decisions captured'); process.exit(1); }

var payload = {
    _comment: 'GENERATED by ai/eval/export_decisions.js. The move the JavaScript bot ' +
              'plays on each board, with the shipped weight set. bot/tests/decisionVerify.lua ' +
              'replays these and fails if the Lua brain chooses differently.',
    profile: path.basename(PROFILE),
    depth: DEPTH, beam: BEAM, rise: RISE, density: !!prof.density, reaction: 12,
    weights: W,
    decisions: rows
};
fs.writeFileSync(OUT, JSON.stringify(payload));
var holds = rows.filter(function (d) { return d.kind !== 'swap'; }).length;
console.log('wrote ' + OUT + ': ' + rows.length + ' decisions (' + holds + ' hold, ' +
            (rows.length - holds) + ' swap), depth ' + DEPTH + ' beam ' + BEAM +
            ' rise ' + (RISE ? 'on' : 'off'));
